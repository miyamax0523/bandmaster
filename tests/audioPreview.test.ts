import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioPreviewEngine,
  createDefaultMixerState,
  isTrackAudible,
  SCHEDULER_INTERVAL_MS,
} from '../src/lib/audioPreview';
import type { LogicalTracks } from '../src/types/track';

function createMockAudioContext() {
  const createdGains: Array<{
    gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const createdOscs: Array<{
    type: string;
    frequency: { setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }> = [];
  const compressors: Array<{
    threshold: { value: number };
    knee: { value: number };
    ratio: { value: number };
    attack: { value: number };
    release: { value: number };
    connect: ReturnType<typeof vi.fn>;
  }> = [];

  const mockCtx = {
    currentTime: 0,
    sampleRate: 44100,
    state: 'suspended' as AudioContextState,
    destination: { kind: 'destination' },
    resume: vi.fn(async () => {
      mockCtx.state = 'running';
    }),
    close: vi.fn(async () => {
      mockCtx.state = 'closed';
    }),
    createGain: vi.fn(() => {
      const g = {
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      createdGains.push(g);
      return g;
    }),
    createDynamicsCompressor: vi.fn(() => {
      const c = {
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
        connect: vi.fn(),
      };
      compressors.push(c);
      return c;
    }),
    createOscillator: vi.fn(() => {
      const o = {
        type: 'sine',
        frequency: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      createdOscs.push(o);
      return o;
    }),
    createBiquadFilter: vi.fn(() => ({
      type: 'lowpass',
      frequency: { value: 1000, setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createBuffer: vi.fn(() => ({
      getChannelData: () => new Float32Array(100),
    })),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    })),
  };

  return {
    mockCtx,
    createdGains,
    createdOscs,
    compressors,
  };
}

function makeTracks(): LogicalTracks {
  return {
    drums: [{ pitch: 36, velocity: 110, startTick: 0, durationTicks: 120, channel: 9 }],
    kick808: [{ pitch: 36, velocity: 115, startTick: 960, durationTicks: 120, midiDurationTicks: 900, channel: 3 }],
    bass: [
      { pitch: 40, velocity: 100, startTick: 0, durationTicks: 240, channel: 0 },
      { pitch: 43, velocity: 100, startTick: 480, durationTicks: 240, channel: 0 },
      { pitch: 45, velocity: 100, startTick: 1440, durationTicks: 240, channel: 0 },
    ],
    keyboard: [],
    pad: [],
  };
}

describe('audioPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds headroom (0.7) -> compressor (-12dB) -> destination and schedules 150ms lookahead on 25ms ticks', async () => {
    const { mockCtx, createdGains, createdOscs, compressors } =
      createMockAudioContext();
    const engine = new AudioPreviewEngine(
      () => mockCtx as unknown as AudioContext
    );
    // 120 BPM => 1 beat (480 ticks) = 0.5s, 150ms = 144 ticks
    engine.loadSongData(makeTracks(), 120, 1920);

    await engine.play();
    expect(mockCtx.resume).toHaveBeenCalledTimes(1);
    expect(createdGains[0].gain.value).toBe(0.7); // Master headroom gain
    expect(compressors[0].threshold.value).toBe(-12);
    expect(compressors[0].knee.value).toBe(10);
    expect(compressors[0].ratio.value).toBe(8);

    // At t=0: tick 0 notes (drums kick + bass 40) are within 150ms lookahead -> 2 oscs
    const initialCount = createdOscs.length;
    expect(initialCount).toBe(2);

    // Advance AudioContext clock to 0.4s (tick 384 -> lookahead reaches tick 528 -> schedules bass 43 at tick 480)
    mockCtx.currentTime = 0.4;
    vi.advanceTimersByTime(SCHEDULER_INTERVAL_MS);
    expect(createdOscs.length).toBe(3);

    engine.dispose();
  });

  it('supports seek (resets voices when playing), pause (retains tick), and stop (resets to 0)', async () => {
    const { mockCtx, createdOscs } = createMockAudioContext();
    const engine = new AudioPreviewEngine(
      () => mockCtx as unknown as AudioContext
    );
    engine.loadSongData(makeTracks(), 120, 1920);

    await engine.play();
    expect(createdOscs.length).toBe(2);

    // Seek to tick 960 while playing -> stops active voices & schedules kick808 at 960
    engine.seek(960);
    expect(createdOscs[0].stop).toHaveBeenCalled();
    expect(createdOscs.length).toBe(3); // kick808 scheduled immediately
    expect(engine.getState().currentTick).toBe(960);

    // Pause keeps position
    mockCtx.currentTime = 0.25; // +240 ticks at 120bpm
    engine.pause();
    expect(engine.getState().status).toBe('paused');
    expect(engine.getState().currentTick).toBe(1200);

    // Seek while paused updates position without scheduling oscillators
    const countBeforeSeek = createdOscs.length;
    engine.seek(1440);
    expect(createdOscs.length).toBe(countBeforeSeek);
    expect(engine.getState().currentTick).toBe(1440);

    // Stop resets to 0
    engine.stop();
    expect(engine.getState().status).toBe('stopped');
    expect(engine.getState().currentTick).toBe(0);

    engine.dispose();
  });

  it('supports multi-solo and Mute overriding Solo on logical tracks including kick808', async () => {
    const mixer = createDefaultMixerState();
    expect(isTrackAudible(mixer, 'drums')).toBe(true);
    expect(isTrackAudible(mixer, 'kick808')).toBe(true);

    // Multi-solo: drums + kick808
    mixer.drums.solo = true;
    mixer.kick808.solo = true;
    expect(isTrackAudible(mixer, 'drums')).toBe(true);
    expect(isTrackAudible(mixer, 'kick808')).toBe(true);
    expect(isTrackAudible(mixer, 'bass')).toBe(false);

    // Mute overrides Solo
    mixer.kick808.muted = true;
    expect(isTrackAudible(mixer, 'kick808')).toBe(false);
    expect(isTrackAudible(mixer, 'drums')).toBe(true);

    // Verify engine updates track gain nodes cleanly
    const { mockCtx, createdGains } = createMockAudioContext();
    const engine = new AudioPreviewEngine(
      () => mockCtx as unknown as AudioContext
    );
    engine.loadSongData(makeTracks(), 120, 1920);
    await engine.play();

    // createdGains: [0]=headroom, [1]=drums, [2]=kick808, [3]=bass, [4]=keyboard, [5]=pad
    engine.setTrackSolo('kick808', true);
    expect(createdGains[2].gain.value).toBe(1.0);
    expect(createdGains[1].gain.value).toBe(0);

    engine.setTrackMute('kick808', true);
    expect(createdGains[2].gain.value).toBe(0);

    engine.dispose();
  });
});
