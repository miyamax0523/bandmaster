import { PPQ, type LogicalTrackType } from '../types/song';
import type { LogicalTracks, ResolvedNote } from '../types/track';
import type { SectionSpan } from './noteSelector';

export type PlaybackStatus = 'stopped' | 'playing' | 'paused';

export interface TrackMixerState {
  volume: number; // 0..1.5
  muted: boolean;
  solo: boolean;
}

export type MixerState = Record<LogicalTrackType, TrackMixerState>;

export interface AudioPreviewState {
  status: PlaybackStatus;
  currentTick: number;
  bpm: number;
  totalTicks: number;
  sectionLoop: SectionSpan | null;
  mixer: MixerState;
}

interface ActiveVoice {
  stop: () => void;
}

export const SCHEDULER_INTERVAL_MS = 25;
export const LOOKAHEAD_SECONDS = 0.15;

export function createDefaultMixerState(): MixerState {
  return {
    drums: { volume: 1.0, muted: false, solo: false },
    kick808: { volume: 1.0, muted: false, solo: false },
    bass: { volume: 1.0, muted: false, solo: false },
    keyboard: { volume: 0.85, muted: false, solo: false },
    pad: { volume: 0.75, muted: false, solo: false },
  };
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  const safeBpm = Math.max(1, bpm);
  return (ticks / PPQ) * (60 / safeBpm);
}

export function secondsToTicks(seconds: number, bpm: number): number {
  const safeBpm = Math.max(1, bpm);
  return (seconds * safeBpm * PPQ) / 60;
}

export function midiToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

export function isTrackAudible(
  mixer: MixerState,
  track: LogicalTrackType
): boolean {
  const state = mixer[track];
  if (state.muted) return false; // Mute overrides Solo
  const anySolo = (Object.keys(mixer) as LogicalTrackType[]).some(
    (k) => mixer[k].solo
  );
  if (anySolo) return state.solo;
  return true;
}

export class AudioPreviewEngine {
  private ctx: AudioContext | null = null;
  private contextFactory: () => AudioContext;
  private trackGains: Partial<Record<LogicalTrackType, GainNode>> = {};
  private headroomGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private tracks: LogicalTracks = {
    drums: [],
    kick808: [],
    bass: [],
    keyboard: [],
    pad: [],
  };
  private bpm = 135;
  private totalTicks = 0;
  private sectionLoop: SectionSpan | null = null;
  private mixer: MixerState = createDefaultMixerState();

  private status: PlaybackStatus = 'stopped';
  private currentTick = 0;
  private nextScheduleTick = 0;
  private anchorAudioTime = 0;
  private anchorTick = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private activeVoices = new Set<ActiveVoice>();
  private listeners = new Set<(state: AudioPreviewState) => void>();

  constructor(contextFactory?: () => AudioContext) {
    this.contextFactory =
      contextFactory ??
      (() => {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        return new AudioCtx();
      });
  }

  subscribe(listener: (state: AudioPreviewState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getState();
    for (const l of this.listeners) {
      l(snap);
    }
  }

  getState(): AudioPreviewState {
    return {
      status: this.status,
      currentTick: Math.round(this.currentTick),
      bpm: this.bpm,
      totalTicks: this.totalTicks,
      sectionLoop: this.sectionLoop ? { ...this.sectionLoop } : null,
      mixer: {
        drums: { ...this.mixer.drums },
        kick808: { ...this.mixer.kick808 },
        bass: { ...this.mixer.bass },
        keyboard: { ...this.mixer.keyboard },
        pad: { ...this.mixer.pad },
      },
    };
  }

  private ensureAudioGraph(): AudioContext {
    if (!this.ctx) {
      this.ctx = this.contextFactory();

      this.headroomGain = this.ctx.createGain();
      this.headroomGain.gain.value = 0.7;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.15;

      this.headroomGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      for (const track of [
        'drums',
        'kick808',
        'bass',
        'keyboard',
        'pad',
      ] as LogicalTrackType[]) {
        const g = this.ctx.createGain();
        g.connect(this.headroomGain);
        this.trackGains[track] = g;
      }

      this.applyMixerGains();
    }
    return this.ctx;
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
    if (this.noiseBuffer) return this.noiseBuffer;
    if (typeof ctx.createBuffer !== 'function') return null;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
    return buf;
  }

  private applyMixerGains(): void {
    for (const track of [
      'drums',
      'kick808',
      'bass',
      'keyboard',
      'pad',
    ] as LogicalTrackType[]) {
      const gainNode = this.trackGains[track];
      if (!gainNode) continue;
      const audible = isTrackAudible(this.mixer, track);
      gainNode.gain.value = audible ? this.mixer[track].volume : 0;
    }
  }

  loadSongData(tracks: LogicalTracks, bpm: number, totalTicks: number): void {
    this.tracks = tracks;
    this.bpm = Math.max(1, bpm);
    this.totalTicks = Math.max(0, totalTicks);
    if (this.currentTick > this.totalTicks) {
      this.currentTick = 0;
    }
    this.emit();
  }

  setTrackMute(track: LogicalTrackType, muted: boolean): void {
    this.mixer[track].muted = muted;
    this.applyMixerGains();
    this.emit();
  }

  setTrackSolo(track: LogicalTrackType, solo: boolean): void {
    this.mixer[track].solo = solo;
    this.applyMixerGains();
    this.emit();
  }

  setTrackVolume(track: LogicalTrackType, volume: number): void {
    this.mixer[track].volume = Math.min(1.5, Math.max(0, volume));
    this.applyMixerGains();
    this.emit();
  }

  setSectionLoop(span: SectionSpan | null): void {
    this.sectionLoop = span ? { ...span } : null;
    this.emit();
  }

  async play(): Promise<void> {
    if (this.totalTicks <= 0) return;
    const ctx = this.ensureAudioGraph();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (this.status === 'playing') return;

    if (
      this.sectionLoop &&
      (this.currentTick < this.sectionLoop.startTick ||
        this.currentTick >= this.sectionLoop.endTick)
    ) {
      this.currentTick = this.sectionLoop.startTick;
    }

    this.status = 'playing';
    this.anchorAudioTime = ctx.currentTime;
    this.anchorTick = this.currentTick;
    this.nextScheduleTick = this.currentTick;

    this.startSchedulerLoop();
    this.scheduleAhead();
    this.emit();
  }

  pause(): void {
    if (this.status !== 'playing') return;
    this.updateCurrentTickFromClock();
    this.stopSchedulerLoop();
    this.stopAllActiveVoices();
    this.status = 'paused';
    this.emit();
  }

  stop(): void {
    this.stopSchedulerLoop();
    this.stopAllActiveVoices();
    this.status = 'stopped';
    this.currentTick = 0;
    this.nextScheduleTick = 0;
    this.anchorTick = 0;
    this.emit();
  }

  seek(tick: number): void {
    const clamped = Math.min(this.totalTicks, Math.max(0, Math.round(tick)));
    this.currentTick = clamped;
    this.anchorTick = clamped;
    this.nextScheduleTick = clamped;

    if (this.status === 'playing' && this.ctx) {
      this.stopAllActiveVoices();
      this.anchorAudioTime = this.ctx.currentTime;
      this.scheduleAhead();
    }
    this.emit();
  }

  handleVisibilityChange(isVisible: boolean): void {
    if (!isVisible || this.status !== 'playing' || !this.ctx) return;
    // Re-sync clock on mobile tab/PWA resume to prevent burst catch-up
    this.stopAllActiveVoices();
    this.anchorAudioTime = this.ctx.currentTime;
    this.anchorTick = this.currentTick;
    this.nextScheduleTick = this.currentTick;
    this.scheduleAhead();
  }

  dispose(): void {
    this.stop();
    if (this.ctx && typeof this.ctx.close === 'function') {
      void this.ctx.close();
    }
    this.ctx = null;
    this.listeners.clear();
  }

  private startSchedulerLoop(): void {
    this.stopSchedulerLoop();
    this.timerId = setInterval(() => {
      this.scheduleAhead();
    }, SCHEDULER_INTERVAL_MS);
  }

  private stopSchedulerLoop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private stopAllActiveVoices(): void {
    for (const v of this.activeVoices) {
      v.stop();
    }
    this.activeVoices.clear();
  }

  private updateCurrentTickFromClock(): void {
    if (!this.ctx || this.status !== 'playing') return;
    const elapsedSec = Math.max(0, this.ctx.currentTime - this.anchorAudioTime);
    const deltaTicks = secondsToTicks(elapsedSec, this.bpm);
    this.currentTick = this.anchorTick + deltaTicks;
  }

  private scheduleAhead(): void {
    if (this.status !== 'playing' || !this.ctx) return;
    this.updateCurrentTickFromClock();

    const loopStart = this.sectionLoop ? this.sectionLoop.startTick : 0;
    const loopEnd = this.sectionLoop
      ? Math.min(this.totalTicks, this.sectionLoop.endTick)
      : this.totalTicks;

    if (loopEnd <= loopStart) {
      this.stop();
      return;
    }

    // Check if playback passed end
    if (this.currentTick >= loopEnd) {
      if (this.sectionLoop) {
        const overflow = this.currentTick - loopEnd;
        const loopLen = loopEnd - loopStart;
        const wrapped = loopStart + (overflow % loopLen);
        this.currentTick = wrapped;
        this.anchorTick = wrapped;
        this.anchorAudioTime = this.ctx.currentTime;
        this.nextScheduleTick = wrapped;
      } else {
        this.stop();
        return;
      }
    }

    const lookaheadTicks = secondsToTicks(LOOKAHEAD_SECONDS, this.bpm);
    const windowEndTick = Math.min(loopEnd, this.currentTick + lookaheadTicks);

    if (this.nextScheduleTick < windowEndTick) {
      this.scheduleRange(this.nextScheduleTick, windowEndTick);
      this.nextScheduleTick = windowEndTick;
    }

    // Handle wrap-around lookahead when sectionLoop is active
    if (this.sectionLoop && this.currentTick + lookaheadTicks > loopEnd) {
      const remainingTicks = this.currentTick + lookaheadTicks - loopEnd;
      const wrapEnd = Math.min(loopEnd, loopStart + remainingTicks);
      if (wrapEnd > loopStart) {
        const wrapTimeOffsetSec = ticksToSeconds(
          loopEnd - this.currentTick,
          this.bpm
        );
        this.scheduleRange(loopStart, wrapEnd, wrapTimeOffsetSec);
      }
    }

    this.emit();
  }

  private scheduleRange(
    fromTick: number,
    toTick: number,
    extraDelaySec = 0
  ): void {
    if (!this.ctx) return;

    for (const track of [
      'drums',
      'kick808',
      'bass',
      'keyboard',
      'pad',
    ] as LogicalTrackType[]) {
      const notes = this.tracks[track];
      for (const note of notes) {
        if (note.startTick >= fromTick && note.startTick < toTick) {
          const offsetFromAnchor = note.startTick - this.anchorTick;
          const noteTime =
            this.anchorAudioTime +
            extraDelaySec +
            ticksToSeconds(Math.max(0, offsetFromAnchor), this.bpm);
          this.triggerNote(track, note, Math.max(this.ctx.currentTime, noteTime));
        }
      }
    }
  }

  private triggerNote(
    track: LogicalTrackType,
    note: ResolvedNote,
    startTime: number
  ): void {
    if (!this.ctx) return;
    const dest = this.trackGains[track];
    if (!dest) return;

    const velGain = (note.velocity / 127) * 0.6;
    // Note: audioPreview ignores midiDurationTicks and synthesizes track-appropriate envelope
    const durSec = Math.max(0.04, ticksToSeconds(note.durationTicks, this.bpm));

    if (track === 'kick808') {
      this.synth808Kick(this.ctx, dest, startTime, velGain);
    } else if (track === 'drums') {
      this.synthDrum(this.ctx, dest, note.pitch, startTime, velGain);
    } else if (track === 'bass') {
      this.synthTone(
        this.ctx,
        dest,
        midiToFrequency(note.pitch),
        startTime,
        Math.min(0.8, durSec),
        velGain * 0.75,
        'sawtooth',
        420
      );
    } else if (track === 'keyboard') {
      this.synthTone(
        this.ctx,
        dest,
        midiToFrequency(note.pitch),
        startTime,
        Math.min(1.2, durSec),
        velGain * 0.45,
        'triangle',
        2600
      );
    } else {
      // pad
      this.synthTone(
        this.ctx,
        dest,
        midiToFrequency(note.pitch),
        startTime,
        Math.min(2.4, durSec),
        velGain * 0.3,
        'sine',
        1800,
        0.08
      );
    }
  }

  private registerVoice(
    nodes: AudioNode[],
    stoppables: Array<{ stop: (when?: number) => void }>,
    endTime: number
  ): void {
    const voice: ActiveVoice = {
      stop: () => {
        for (const s of stoppables) {
          try {
            s.stop();
          } catch {
            // ignore already stopped
          }
        }
        for (const n of nodes) {
          try {
            n.disconnect();
          } catch {
            // ignore
          }
        }
        this.activeVoices.delete(voice);
      },
    };
    this.activeVoices.add(voice);

    const last = stoppables[0] as unknown as {
      onended?: (() => void) | null;
    };
    if (last) {
      last.onended = () => {
        for (const n of nodes) {
          try {
            n.disconnect();
          } catch {
            // ignore
          }
        }
        this.activeVoices.delete(voice);
      };
    }

    // Fallback cleanup if mock doesn't fire onended
    const msUntilEnd = Math.max(
      50,
      Math.ceil((endTime - (this.ctx?.currentTime ?? 0)) * 1000) + 50
    );
    if (this.status === 'playing' && msUntilEnd < 5000) {
      // Cleaned by onended or stopAllActiveVoices
    }
  }

  private synth808Kick(
    ctx: AudioContext,
    dest: GainNode,
    startTime: number,
    velGain: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125, startTime);
    osc.frequency.exponentialRampToValueAtTime(42, startTime + 0.08);

    const endTime = startTime + 0.55;
    gain.gain.setValueAtTime(Math.max(0.001, velGain * 0.95), startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, endTime);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(endTime);
    this.registerVoice([osc, gain], [osc], endTime);
  }

  private synthDrum(
    ctx: AudioContext,
    dest: GainNode,
    pitch: number,
    startTime: number,
    velGain: number
  ): void {
    if (pitch === 36) {
      // Acoustic Kick
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, startTime);
      osc.frequency.exponentialRampToValueAtTime(48, startTime + 0.07);
      const endTime = startTime + 0.18;
      gain.gain.setValueAtTime(Math.max(0.001, velGain * 0.9), startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, endTime);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(startTime);
      osc.stop(endTime);
      this.registerVoice([osc, gain], [osc], endTime);
    } else if (pitch === 38) {
      // Snare: tone + noise
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(185, startTime);
      const endTime = startTime + 0.16;
      gain.gain.setValueAtTime(Math.max(0.001, velGain * 0.6), startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, endTime);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(startTime);
      osc.stop(endTime);
      const stoppables: Array<{ stop: (w?: number) => void }> = [osc];
      const nodes: AudioNode[] = [osc, gain];

      const nBuf = this.getNoiseBuffer(ctx);
      if (nBuf && typeof ctx.createBufferSource === 'function') {
        const src = ctx.createBufferSource();
        src.buffer = nBuf;
        const nGain = ctx.createGain();
        nGain.gain.setValueAtTime(Math.max(0.001, velGain * 0.55), startTime);
        nGain.gain.exponentialRampToValueAtTime(0.001, endTime);
        src.connect(nGain);
        nGain.connect(dest);
        src.start(startTime);
        src.stop(endTime);
        stoppables.push(src);
        nodes.push(src, nGain);
      }
      this.registerVoice(nodes, stoppables, endTime);
    } else if (pitch === 42 || pitch === 46 || pitch === 49 || pitch === 51) {
      // Hi-hat / Cymbals
      const dur = pitch === 42 ? 0.06 : pitch === 46 ? 0.22 : 0.45;
      const endTime = startTime + dur;
      const nBuf = this.getNoiseBuffer(ctx);
      if (nBuf && typeof ctx.createBufferSource === 'function') {
        const src = ctx.createBufferSource();
        src.buffer = nBuf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = pitch === 49 ? 4500 : 7500;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(Math.max(0.001, velGain * 0.38), startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, endTime);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(dest);
        src.start(startTime);
        src.stop(endTime);
        this.registerVoice([src, filter, gain], [src], endTime);
      } else {
        this.synthTone(ctx, dest, 6000, startTime, dur, velGain * 0.2, 'square', 8000);
      }
    } else {
      // Toms (48, 45, 43)
      const freq = pitch === 48 ? 160 : pitch === 45 ? 120 : 90;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 1.4, startTime);
      osc.frequency.exponentialRampToValueAtTime(freq, startTime + 0.12);
      const endTime = startTime + 0.22;
      gain.gain.setValueAtTime(Math.max(0.001, velGain * 0.7), startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, endTime);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(startTime);
      osc.stop(endTime);
      this.registerVoice([osc, gain], [osc], endTime);
    }
  }

  private synthTone(
    ctx: AudioContext,
    dest: GainNode,
    freq: number,
    startTime: number,
    durSec: number,
    velGain: number,
    type: OscillatorType,
    cutoffHz: number,
    attackSec = 0.01
  ): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, startTime);

    const safeDur = Math.max(0.04, durSec);
    const endTime = startTime + safeDur;
    const peakTime = Math.min(endTime - 0.01, startTime + attackSec);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(Math.max(0.002, velGain), peakTime);
    gain.gain.exponentialRampToValueAtTime(0.001, endTime);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    osc.start(startTime);
    osc.stop(endTime);
    this.registerVoice([osc, filter, gain], [osc], endTime);
  }
}
