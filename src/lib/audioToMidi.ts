import { PPQ, type AnalysisMethod } from '../types/song';
import type { RawRiffNote } from './riffProcessor';

export const BASIC_PITCH_SAMPLE_RATE = 22050;
export const DEFAULT_BASIC_PITCH_MODEL_URL = `${
  (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
}models/basic-pitch/model.json`;

export const AUDIO_DECODE_ERROR_MESSAGE =
  'この音声形式はブラウザでデコードできませんでした。WAV形式に変換して読み込むか、手動グリッド/MIDI読込をご利用ください';

export const SIMPLE_FALLBACK_NOTICE =
  '簡易解析モード（低精度：単音の基音推定用であり、和音や歪みギターでは正確な解析を保証しません）';

export type AudioAnalysisStage =
  | 'decoding'
  | 'loading-model'
  | 'analyzing'
  | 'fallback'
  | 'done';

export interface AudioAnalysisProgress {
  stage: AudioAnalysisStage;
  percent: number; // 0..100
  message: string;
}

export interface AnalyzeAudioOptions {
  bpm: number;
  modelUrl?: string;
  signal?: AbortSignal;
  onProgress?: (progress: AudioAnalysisProgress) => void;
}

export interface AudioToMidiResult {
  rawNotes: RawRiffNote[];
  analysisMethod: AnalysisMethod;
  usedFallback: boolean;
  notice?: string;
}

export class AudioDecodeError extends Error {
  constructor(message = AUDIO_DECODE_ERROR_MESSAGE) {
    super(message);
    this.name = 'AudioDecodeError';
  }
}

export function createAbortError(message = '解析がキャンセルされました'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

export function isAbortError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name?: string }).name === 'AbortError'
  );
}

/**
 * Peak-normalizes audio samples to targetPeak (0.95).
 * Does NOT trim leading silence (onset head trim is performed once in riffProcessor).
 */
export function normalizePeak(
  samples: Float32Array,
  targetPeak = 0.95
): Float32Array {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > maxAbs) maxAbs = a;
  }
  const out = new Float32Array(samples.length);
  if (maxAbs === 0) {
    return out;
  }
  const scale = targetPeak / maxAbs;
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] * scale;
  }
  return out;
}

export function downmixAndResampleTo22050(
  channels: readonly Float32Array[],
  srcSampleRate: number
): Float32Array {
  if (channels.length === 0 || channels[0].length === 0) {
    return new Float32Array(0);
  }
  const srcLen = channels[0].length;
  const mono = new Float32Array(srcLen);
  const numCh = channels.length;
  for (let i = 0; i < srcLen; i++) {
    let sum = 0;
    for (let c = 0; c < numCh; c++) {
      sum += channels[c][i] ?? 0;
    }
    mono[i] = sum / numCh;
  }

  if (srcSampleRate === BASIC_PITCH_SAMPLE_RATE) {
    return mono;
  }

  const ratio = srcSampleRate / BASIC_PITCH_SAMPLE_RATE;
  const targetLen = Math.max(1, Math.floor(srcLen / ratio));
  const resampled = new Float32Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = mono[idx] ?? 0;
    const s1 = mono[Math.min(srcLen - 1, idx + 1)] ?? s0;
    resampled[i] = s0 + (s1 - s0) * frac;
  }
  return resampled;
}

export function extractChannelsFromAudioBuffer(
  buffer: AudioBuffer
): Float32Array[] {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  return channels;
}

export async function decodeAudioArrayBuffer(
  arrayBuffer: ArrayBuffer,
  createContext?: () => AudioContext
): Promise<{ samples22050: Float32Array; sampleRate: number }> {
  const AudioCtx =
    typeof window !== 'undefined'
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;

  if (!createContext && !AudioCtx) {
    throw new AudioDecodeError();
  }

  const ctx = createContext ? createContext() : new AudioCtx!();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channels = extractChannelsFromAudioBuffer(decoded);
    const mono22k = downmixAndResampleTo22050(channels, decoded.sampleRate);
    return {
      samples22050: normalizePeak(mono22k, 0.95),
      sampleRate: BASIC_PITCH_SAMPLE_RATE,
    };
  } catch {
    throw new AudioDecodeError();
  } finally {
    if (typeof ctx.close === 'function') {
      await ctx.close().catch(() => {});
    }
  }
}

export function amplitudeToVelocity(amplitude: number): number {
  return Math.min(127, Math.max(1, Math.round(amplitude * 127)));
}

/**
 * Fallback monophonic autocorrelation + RMS analyzer for when Basic Pitch fails.
 */
export function analyzeWithSimpleFallback(
  samples: Float32Array,
  sampleRate: number,
  bpm: number
): RawRiffNote[] {
  if (samples.length === 0) return [];

  const frameSize = Math.max(512, Math.round(sampleRate * 0.045));
  const hopSize = Math.max(256, Math.round(sampleRate * 0.02));
  const minLag = Math.max(2, Math.floor(sampleRate / 1000)); // ~1000Hz
  const maxLag = Math.min(frameSize - 1, Math.ceil(sampleRate / 70)); // ~70Hz

  const ticksPerSec = (Math.max(1, bpm) / 60) * PPQ;
  const rmsThreshold = 0.06;

  interface FrameEstimate {
    timeSec: number;
    midi: number | null;
    rms: number;
  }

  const estimates: FrameEstimate[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let sumSq = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = samples[start + i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / frameSize);
    const timeSec = start / sampleRate;

    if (rms < rmsThreshold) {
      estimates.push({ timeSec, midi: null, rms });
      continue;
    }

    // Normalized autocorrelation
    let bestLag = -1;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0;
      let normA = 0;
      let normB = 0;
      const limit = frameSize - lag;
      for (let i = 0; i < limit; i++) {
        const a = samples[start + i];
        const b = samples[start + i + lag];
        num += a * b;
        normA += a * a;
        normB += b * b;
      }
      const denom = Math.sqrt(normA * normB);
      const corr = denom > 0 ? num / denom : 0;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    if (bestLag > 0 && bestCorr > 0.55) {
      const freq = sampleRate / bestLag;
      const midi = Math.round(69 + 12 * Math.log2(freq / 440));
      estimates.push({
        timeSec,
        midi: midi >= 36 && midi <= 88 ? midi : null,
        rms,
      });
    } else {
      estimates.push({ timeSec, midi: null, rms });
    }
  }

  // Group consecutive frames with same MIDI pitch into notes
  const rawNotes: RawRiffNote[] = [];
  let activeMidi: number | null = null;
  let activeStartSec = 0;
  let activeMaxRms = 0;
  const hopSec = hopSize / sampleRate;

  const flushNote = (endSec: number) => {
    if (activeMidi === null) return;
    const durSec = Math.max(hopSec, endSec - activeStartSec);
    const amp = Math.min(1, Math.max(0.1, activeMaxRms * 1.4));
    rawNotes.push({
      pitch: activeMidi,
      startTick: Math.round(activeStartSec * ticksPerSec),
      durationTicks: Math.max(30, Math.round(durSec * ticksPerSec)),
      amplitude: amp,
      velocity: amplitudeToVelocity(amp),
    });
    activeMidi = null;
  };

  for (const est of estimates) {
    if (est.midi === null) {
      flushNote(est.timeSec);
    } else if (activeMidi === null) {
      activeMidi = est.midi;
      activeStartSec = est.timeSec;
      activeMaxRms = est.rms;
    } else if (Math.abs(est.midi - activeMidi) >= 1) {
      flushNote(est.timeSec);
      activeMidi = est.midi;
      activeStartSec = est.timeSec;
      activeMaxRms = est.rms;
    } else {
      activeMaxRms = Math.max(activeMaxRms, est.rms);
    }
  }
  if (estimates.length > 0) {
    flushNote(estimates[estimates.length - 1].timeSec + hopSec);
  }

  return rawNotes;
}

/**
 * Runs Basic Pitch inference on mono 22050Hz peak-normalized samples,
 * falling back to autocorrelation+RMS on load/inference failure.
 */
export async function analyzePcmAudioToMidi(
  mono22050Samples: Float32Array,
  options: AnalyzeAudioOptions
): Promise<AudioToMidiResult> {
  const {
    bpm,
    modelUrl = DEFAULT_BASIC_PITCH_MODEL_URL,
    signal,
    onProgress,
  } = options;

  const checkAborted = () => {
    if (signal?.aborted) {
      throw createAbortError();
    }
  };

  checkAborted();
  const normalized = normalizePeak(mono22050Samples, 0.95);

  try {
    onProgress?.({
      stage: 'loading-model',
      percent: 10,
      message: 'モデル初回ロード中...',
    });

    const bpMod = await import('@spotify/basic-pitch');
    checkAborted();

    const basicPitch = new bpMod.BasicPitch(modelUrl);
    await basicPitch.model;
    checkAborted();

    onProgress?.({
      stage: 'analyzing',
      percent: 25,
      message: '音声解析中...',
    });

    const frames: number[][] = [];
    const onsets: number[][] = [];

    await basicPitch.evaluateModel(
      normalized,
      (f: number[][], o: number[][]) => {
        if (signal?.aborted) return;
        frames.push(...f);
        onsets.push(...o);
      },
      (ratio: number) => {
        if (signal?.aborted) return;
        const pct = Math.min(95, Math.max(25, Math.round(25 + ratio * 70)));
        onProgress?.({
          stage: 'analyzing',
          percent: pct,
          message: `音声解析中... (${pct}%)`,
        });
      }
    );

    checkAborted();

    const noteEvents = bpMod.noteFramesToTime(
      bpMod.outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)
    );

    const ticksPerSec = (Math.max(1, bpm) / 60) * PPQ;
    const rawNotes: RawRiffNote[] = noteEvents.map((ev) => ({
      pitch: Math.round(ev.pitchMidi),
      startTick: Math.max(0, Math.round(ev.startTimeSeconds * ticksPerSec)),
      durationTicks: Math.max(
        1,
        Math.round(ev.durationSeconds * ticksPerSec)
      ),
      amplitude: ev.amplitude,
      velocity: amplitudeToVelocity(ev.amplitude),
    }));

    onProgress?.({
      stage: 'done',
      percent: 100,
      message: 'Basic Pitch 解析完了',
    });

    return {
      rawNotes,
      analysisMethod: 'basic-pitch',
      usedFallback: false,
    };
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) {
      throw createAbortError();
    }

    onProgress?.({
      stage: 'fallback',
      percent: 80,
      message: 'Basic Pitch 失敗のため簡易解析モードで解析中...',
    });

    const fallbackNotes = analyzeWithSimpleFallback(
      normalized,
      BASIC_PITCH_SAMPLE_RATE,
      bpm
    );

    onProgress?.({
      stage: 'done',
      percent: 100,
      message: '簡易解析モード完了',
    });

    return {
      rawNotes: fallbackNotes,
      analysisMethod: 'simple-fallback',
      usedFallback: true,
      notice: SIMPLE_FALLBACK_NOTICE,
    };
  }
}

export async function analyzeAudioFileToMidi(
  arrayBuffer: ArrayBuffer,
  options: AnalyzeAudioOptions & { createAudioContext?: () => AudioContext }
): Promise<AudioToMidiResult> {
  options.onProgress?.({
    stage: 'decoding',
    percent: 5,
    message: '音声ファイルをデコード中...',
  });

  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const { samples22050 } = await decodeAudioArrayBuffer(
    arrayBuffer,
    options.createAudioContext
  );

  return analyzePcmAudioToMidi(samples22050, options);
}

export interface MicRecordingHandle {
  cancel: () => void;
  promise: Promise<Float32Array>;
}

/**
 * Captures mono mic audio with echoCancellation/noiseSuppression/autoGainControl disabled,
 * plays a 4-beat count-in at `bpm`, records for `bars`, and returns peak-normalized 22050Hz Float32Array.
 */
export function startMicRiffRecording(options: {
  bpm: number;
  bars: number;
  onBeatCountIn?: (beat: number) => void;
  onRecordingProgress?: (percent: number) => void;
}): MicRecordingHandle {
  let cancelled = false;
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;

  const cleanup = () => {
    try {
      processor?.disconnect();
    } catch {
      // ignore
    }
    try {
      source?.disconnect();
    } catch {
      // ignore
    }
    if (stream) {
      for (const t of stream.getTracks()) {
        t.stop();
      }
      stream = null;
    }
    if (audioCtx && typeof audioCtx.close === 'function') {
      void audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  };

  const promise = (async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('このブラウザではマイク録音がサポートされていません');
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    if (cancelled) {
      cleanup();
      throw createAbortError();
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const beatSec = 60 / Math.max(1, options.bpm);

    // 4-beat count-in click
    for (let b = 1; b <= 4; b++) {
      if (cancelled) {
        cleanup();
        throw createAbortError();
      }
      options.onBeatCountIn?.(b);
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = b === 1 ? 1200 : 880;
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.07);

      await new Promise((r) => setTimeout(r, beatSec * 1000));
    }

    if (cancelled) {
      cleanup();
      throw createAbortError();
    }

    options.onBeatCountIn?.(0); // Count-in finished

    const totalRecordSec = options.bars * 4 * beatSec;
    const sampleRate = audioCtx.sampleRate;
    const targetSamples = Math.ceil(totalRecordSec * sampleRate);
    const chunks: Float32Array[] = [];
    let collected = 0;

    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    await new Promise<void>((resolve, reject) => {
      if (!processor || !source || !audioCtx) {
        reject(new Error('Audio recorder initialization failed'));
        return;
      }
      processor.onaudioprocess = (ev) => {
        if (ev.outputBuffer.numberOfChannels > 0) {
          ev.outputBuffer.getChannelData(0).fill(0);
        }
        if (cancelled) {
          resolve();
          return;
        }
        const input = ev.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        chunks.push(copy);
        collected += copy.length;
        options.onRecordingProgress?.(
          Math.min(100, Math.round((collected / targetSamples) * 100))
        );
        if (collected >= targetSamples) {
          resolve();
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    });

    cleanup();

    if (cancelled) {
      throw createAbortError();
    }

    const merged = new Float32Array(Math.min(collected, targetSamples));
    let offset = 0;
    for (const c of chunks) {
      const remaining = merged.length - offset;
      if (remaining <= 0) break;
      const slice = c.length > remaining ? c.subarray(0, remaining) : c;
      merged.set(slice, offset);
      offset += slice.length;
    }

    const resampled = downmixAndResampleTo22050([merged], sampleRate);
    return normalizePeak(resampled, 0.95);
  })();

  return {
    cancel: () => {
      cancelled = true;
      cleanup();
    },
    promise,
  };
}
