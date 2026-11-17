import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  amplitudeToVelocity,
  analyzeAudioFileToMidi,
  analyzePcmAudioToMidi,
  AUDIO_DECODE_ERROR_MESSAGE,
  AudioDecodeError,
  BASIC_PITCH_SAMPLE_RATE,
  isAbortError,
  normalizePeak,
  SIMPLE_FALLBACK_NOTICE,
} from '../src/lib/audioToMidi';
import { processGuitarRiff } from '../src/lib/riffProcessor';

const mockState = {
  shouldRejectModel: false,
  shouldThrowEvaluate: false,
  mockNoteEvents: [
    {
      startTimeSeconds: 0.0,
      durationSeconds: 0.25,
      pitchMidi: 52, // E3 -> -12 = 40 (E2)
      amplitude: 0.8,
    },
    {
      startTimeSeconds: 0.5,
      durationSeconds: 0.25,
      pitchMidi: 55, // G3 -> -12 = 43 (G2)
      amplitude: 0.5,
    },
  ],
  onProgressTick: null as (() => void) | null,
};

vi.mock('@spotify/basic-pitch', () => {
  class MockBasicPitch {
    model: Promise<unknown>;
    constructor() {
      this.model = mockState.shouldRejectModel
        ? Promise.reject(new Error('Model load failed'))
        : Promise.resolve({ mocked: true });
    }
    async evaluateModel(
      _audio: Float32Array,
      onComplete: (f: number[][], o: number[][], c: number[][]) => void,
      percentCb: (p: number) => void
    ) {
      if (mockState.shouldThrowEvaluate) {
        throw new Error('Inference crashed');
      }
      percentCb(0.5);
      mockState.onProgressTick?.();
      onComplete([[0.9]], [[0.9]], [[0.9]]);
      percentCb(1.0);
    }
  }

  return {
    BasicPitch: MockBasicPitch,
    outputToNotesPoly: () => [{ mock: true }],
    noteFramesToTime: () => mockState.mockNoteEvents,
  };
});

describe('audioToMidi', () => {
  beforeEach(() => {
    mockState.shouldRejectModel = false;
    mockState.shouldThrowEvaluate = false;
    mockState.onProgressTick = null;
  });

  it('converts Basic Pitch amplitude to velocity and feeds cleanly into riffProcessor', async () => {
    expect(amplitudeToVelocity(0.8)).toBe(102);
    expect(amplitudeToVelocity(0.5)).toBe(64);
    expect(amplitudeToVelocity(0)).toBe(1);

    const samples = new Float32Array(BASIC_PITCH_SAMPLE_RATE);
    samples[100] = 0.25;
    const progressEvents: string[] = [];

    const res = await analyzePcmAudioToMidi(samples, {
      bpm: 120,
      onProgress: (p) => progressEvents.push(p.stage),
    });

    expect(res.analysisMethod).toBe('basic-pitch');
    expect(res.usedFallback).toBe(false);
    expect(res.rawNotes.length).toBe(2);
    expect(res.rawNotes[0].velocity).toBe(102);
    expect(res.rawNotes[1].velocity).toBe(64);
    expect(progressEvents).toContain('loading-model');
    expect(progressEvents).toContain('analyzing');
    expect(progressEvents).toContain('done');

    const processed = processGuitarRiff(res.rawNotes, {
      bpm: 120,
      bars: 1,
      grid: 'straight16',
    });
    expect(processed.cleanedBassNotes.map((n) => n.pitch)).toEqual([40, 43]);
  });

  it('throws AudioDecodeError with WAV/manual guidance when decodeAudioData fails', async () => {
    const failingCtx = () =>
      ({
        decodeAudioData: async () => {
          throw new Error('Unable to decode audio data');
        },
        close: async () => {},
      }) as unknown as AudioContext;

    const dummyBuf = new ArrayBuffer(16);
    await expect(
      analyzeAudioFileToMidi(dummyBuf, {
        bpm: 120,
        createAudioContext: failingCtx,
      })
    ).rejects.toThrow(AudioDecodeError);

    await expect(
      analyzeAudioFileToMidi(dummyBuf, {
        bpm: 120,
        createAudioContext: failingCtx,
      })
    ).rejects.toThrow(AUDIO_DECODE_ERROR_MESSAGE);
  });

  it('falls back to autocorrelation+RMS with explicit notice when Basic Pitch inference fails', async () => {
    mockState.shouldThrowEvaluate = true;

    // Synthesize 1 second of 110 Hz (A2 = MIDI 45) sine wave at 22050 Hz
    const len = BASIC_PITCH_SAMPLE_RATE;
    const sine = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      sine[i] = 0.5 * Math.sin((2 * Math.PI * 110 * i) / BASIC_PITCH_SAMPLE_RATE);
    }

    const res = await analyzePcmAudioToMidi(sine, { bpm: 120 });
    expect(res.analysisMethod).toBe('simple-fallback');
    expect(res.usedFallback).toBe(true);
    expect(res.notice).toBe(SIMPLE_FALLBACK_NOTICE);
    expect(res.rawNotes.length).toBeGreaterThan(0);
    expect(res.rawNotes[0].pitch).toBe(45);
  });

  it('aborts cleanly without falling back when cancelled via AbortController', async () => {
    const controller = new AbortController();
    mockState.onProgressTick = () => {
      controller.abort();
    };

    const samples = new Float32Array(BASIC_PITCH_SAMPLE_RATE);
    let caught: unknown;
    try {
      await analyzePcmAudioToMidi(samples, {
        bpm: 120,
        signal: controller.signal,
      });
    } catch (err) {
      caught = err;
    }
    expect(isAbortError(caught)).toBe(true);
  });

  it('peak-normalizes audio to 0.95 without trimming leading silence', () => {
    const samples = new Float32Array([0, 0, 0, 0.25, -0.5, 0.1]);
    const norm = normalizePeak(samples, 0.95);
    expect(norm[0]).toBe(0);
    expect(norm[1]).toBe(0);
    expect(norm[2]).toBe(0);
    expect(norm[4]).toBeCloseTo(-0.95, 5);
    expect(norm[3]).toBeCloseTo(0.475, 5);
  });
});
