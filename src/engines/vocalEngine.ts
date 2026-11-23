import {
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type EnergyLevel,
  type KeyName,
  type MidiNote,
  type ScaleType,
  type VocalHarmonyMode,
} from '../types/song';
import { getActiveChordAtTick } from '../lib/chordTimeline';
import {
  fitPitchClassToRange,
  getScalePitchClasses,
  noteNameToSemitone,
  type ParsedChord,
} from '../lib/chordUtils';
import { createSeededRng } from '../lib/random';
import type { EngineInput } from './types';
import {
  GENRE_VOCAL_GRAMMARS,
  VOCAL_RHYTHM_CELLS,
  type GenreVocalGrammar,
  type PhrasePlan,
  type PhraseRole,
  type RhythmCell,
  type SyllableSlot,
} from './vocalRhythmCells';

export {
  GENRE_VOCAL_GRAMMARS,
  VOCAL_RHYTHM_CELLS,
  type GenreVocalGrammar,
  type PhrasePlan,
  type PhraseRole,
  type RhythmCell,
  type SyllableSlot,
};

export const TPQN = 480;
export const BEAT_TICKS = 480;
export const BAR_TICKS = 1920;

export const VOCAL_MIN_PITCH = 48; // C3
export const VOCAL_MAX_PITCH = 76; // E5

export type ChapterMiddleType =
  | 'stay_rhythm'
  | 'stay_float'
  | 'dip_arch'
  | 'rap_flow';

export type NormalizedSectionRole =
  | 'verse'
  | 'pre_chorus'
  | 'chorus'
  | 'bridge'
  | 'instrumental';

export interface SectionDynamicsModifier {
  role: NormalizedSectionRole;
  pitchBiasSemitones: number;
  timingOffset: number;
  articulation: number;
  restRatioTarget: number;
  landingDurationRange: [number, number];
  pickupProbability: number;
  preChorusMode?: 'linear_push' | 'dip_hold';
  preChorusBreakStyle?: 'silence_break' | 'long_hold';
  bridgeMode?: 'otoshisabi' | 'overshoot';
}

export interface ChapterPlan {
  chapterIndex: number;
  startTick: number;
  endTick: number;
  headRange: [number, number];
  middleRange: [number, number];
  endingRange: [number, number];
  breathStartTick: number;
  middleType: ChapterMiddleType;
  sourceChapterIndex?: number;
  isFinalChapterInSection: boolean;
}

export type MelodyStyleProfileId =
  | 'alt_hypnotic'
  | 'deftones_float'
  | 'posthc_leap'
  | 'jrock_drive'
  | 'jpop_anthem'
  | 'linkin_hybrid'
  | 'rap_mixture_flow';

export interface MelodyStyleProfile {
  id: MelodyStyleProfileId;
  motifRepeatFidelity: number; // 0..1 A -> A' repetition fidelity
  tailTwist:
    | 'leap_or_float'
    | 'soar_float'
    | 'climax_breakthrough'
    | 'climb_chorus'
    | 'anthem_resolve'
    | 'freeze_break';
  syncopationRate: number; // 0..1 offbeat / pickup entry probability
  laidbackEntry: boolean; // intentionally rests on beat 1 and enters offbeat
  crossBarTieRate: number; // 0..1 long tone crossing barline probability
  repeatNoteRun: readonly [number, number]; // min..max consecutive monotone hits
  breathRestTicks: number; // phrase-end silent break in ticks
  stepwiseRatio: number; // 0..1 proportion of stepwise motion vs leaps
  leapSemitoneTarget: number; // emotional climax leap target in semitones
  tensionLandingWeight: number; // 0..1 weight for 7th/9th/11th vs Root/3rd/5th
  energyOctaveShift: Record<EnergyLevel, number>; // semitone bias per energy
  grammar: GenreVocalGrammar;
}

export const MELODY_STYLE_PROFILES: Record<MelodyStyleProfileId, MelodyStyleProfile> = {
  alt_hypnotic: {
    id: 'alt_hypnotic',
    motifRepeatFidelity: 0.85,
    tailTwist: 'leap_or_float',
    syncopationRate: 0.35,
    laidbackEntry: false,
    crossBarTieRate: 0.3,
    repeatNoteRun: [3, 6],
    breathRestTicks: 480,
    stepwiseRatio: 0.8,
    leapSemitoneTarget: 9,
    tensionLandingWeight: 0.78,
    energyOctaveShift: { Low: -2, Mid: 0, High: 3 },
    grammar: GENRE_VOCAL_GRAMMARS.alt_hypnotic,
  },
  deftones_float: {
    id: 'deftones_float',
    motifRepeatFidelity: 0.72,
    tailTwist: 'soar_float',
    syncopationRate: 0.75,
    laidbackEntry: true,
    crossBarTieRate: 0.85,
    repeatNoteRun: [2, 3],
    breathRestTicks: 600,
    stepwiseRatio: 0.62,
    leapSemitoneTarget: 12,
    tensionLandingWeight: 0.88,
    energyOctaveShift: { Low: -2, Mid: 0, High: 4 },
    grammar: GENRE_VOCAL_GRAMMARS.deftones_float,
  },
  posthc_leap: {
    id: 'posthc_leap',
    motifRepeatFidelity: 0.8,
    tailTwist: 'climax_breakthrough',
    syncopationRate: 0.68,
    laidbackEntry: true,
    crossBarTieRate: 0.78,
    repeatNoteRun: [2, 4],
    breathRestTicks: 360,
    stepwiseRatio: 0.58,
    leapSemitoneTarget: 12,
    tensionLandingWeight: 0.52,
    energyOctaveShift: { Low: 0, Mid: 2, High: 5 },
    grammar: GENRE_VOCAL_GRAMMARS.posthc_leap,
  },
  jrock_drive: {
    id: 'jrock_drive',
    motifRepeatFidelity: 0.82,
    tailTwist: 'climb_chorus',
    syncopationRate: 0.8,
    laidbackEntry: false,
    crossBarTieRate: 0.45,
    repeatNoteRun: [2, 4],
    breathRestTicks: 480,
    stepwiseRatio: 0.72,
    leapSemitoneTarget: 7,
    tensionLandingWeight: 0.35,
    energyOctaveShift: { Low: -1, Mid: 1, High: 4 },
    grammar: GENRE_VOCAL_GRAMMARS.jrock_drive,
  },
  jpop_anthem: {
    id: 'jpop_anthem',
    motifRepeatFidelity: 0.9,
    tailTwist: 'anthem_resolve',
    syncopationRate: 0.42,
    laidbackEntry: false,
    crossBarTieRate: 0.25,
    repeatNoteRun: [2, 3],
    breathRestTicks: 360,
    stepwiseRatio: 0.76,
    leapSemitoneTarget: 8,
    tensionLandingWeight: 0.15,
    energyOctaveShift: { Low: -1, Mid: 1, High: 4 },
    grammar: GENRE_VOCAL_GRAMMARS.jpop_anthem,
  },
  linkin_hybrid: {
    id: 'linkin_hybrid',
    motifRepeatFidelity: 0.82,
    tailTwist: 'freeze_break',
    syncopationRate: 0.65,
    laidbackEntry: false,
    crossBarTieRate: 0.1,
    repeatNoteRun: [4, 6],
    breathRestTicks: 720,
    stepwiseRatio: 0.88,
    leapSemitoneTarget: 2,
    tensionLandingWeight: 0.2,
    energyOctaveShift: { Low: -2, Mid: 0, High: 2 },
    grammar: GENRE_VOCAL_GRAMMARS.linkin_hybrid,
  },
  rap_mixture_flow: {
    id: 'rap_mixture_flow',
    motifRepeatFidelity: 0.85,
    tailTwist: 'freeze_break',
    syncopationRate: 0.7,
    laidbackEntry: false,
    crossBarTieRate: 0.0,
    repeatNoteRun: [4, 8],
    breathRestTicks: 480,
    stepwiseRatio: 0.9,
    leapSemitoneTarget: 2,
    tensionLandingWeight: 0.15,
    energyOctaveShift: { Low: -2, Mid: 0, High: 1 },
    grammar: GENRE_VOCAL_GRAMMARS.rap_mixture_flow,
  },
};

/** Pure deterministic Mulberry32 PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeSectionRole(
  sectionType?: string,
  energy?: EnergyLevel,
  sectionName?: string
): NormalizedSectionRole {
  const combined = `${sectionType ?? ''} ${sectionName ?? ''}`.toLowerCase();
  if (
    combined.includes('pre-chorus') ||
    combined.includes('pre_chorus') ||
    combined.includes('bメロ') ||
    combined.includes('b-melo')
  ) {
    return 'pre_chorus';
  }
  if (
    combined.includes('bridge') ||
    combined.includes('cメロ') ||
    combined.includes('落ちサビ') ||
    combined.includes('otoshisabi')
  ) {
    return 'bridge';
  }
  if (
    combined.includes('chorus') ||
    combined.includes('サビ') ||
    combined.includes('大サビ')
  ) {
    return 'chorus';
  }
  if (
    combined.includes('verse') ||
    combined.includes('aメロ') ||
    combined.includes('a-melo')
  ) {
    return 'verse';
  }
  if (combined.includes('intro') || combined.includes('outro')) {
    return 'instrumental';
  }
  if (energy === 'High') return 'chorus';
  if (energy === 'Low') return 'verse';
  return 'verse';
}

export function resolveSectionDynamicsModifier(
  role: NormalizedSectionRole,
  energy: EnergyLevel,
  sectionName: string | undefined,
  rng: () => number
): SectionDynamicsModifier {
  if (role === 'verse') {
    return {
      role: 'verse',
      pitchBiasSemitones: -2,
      timingOffset: -0.25,
      articulation: 0.3,
      restRatioTarget: 0.42,
      landingDurationRange: [480, 720],
      pickupProbability: 0.35,
    };
  }
  if (role === 'pre_chorus') {
    const isLinear = rng() < 0.55;
    const isBreak = rng() < 0.5;
    return {
      role: 'pre_chorus',
      pitchBiasSemitones: isLinear ? 0 : -1,
      timingOffset: isLinear ? -0.35 : -0.2,
      articulation: 0.65,
      restRatioTarget: 0.16,
      landingDurationRange: [720, 960],
      pickupProbability: 0.78,
      preChorusMode: isLinear ? 'linear_push' : 'dip_hold',
      preChorusBreakStyle: isBreak ? 'silence_break' : 'long_hold',
    };
  }
  if (role === 'chorus') {
    return {
      role: 'chorus',
      pitchBiasSemitones: 1,
      timingOffset: 0.0,
      articulation: 0.9,
      restRatioTarget: 0.22,
      landingDurationRange: [720, 1440],
      pickupProbability: 0.3,
    };
  }
  if (role === 'bridge') {
    const isOtoshisabi =
      energy === 'Low' ||
      (sectionName ?? '').includes('落ちサビ') ||
      rng() < 0.5;
    if (isOtoshisabi) {
      return {
        role: 'bridge',
        pitchBiasSemitones: -4,
        timingOffset: 0.15,
        articulation: 0.25,
        restRatioTarget: 0.35,
        landingDurationRange: [960, 1440],
        pickupProbability: 0.45,
        bridgeMode: 'otoshisabi',
      };
    }
    return {
      role: 'bridge',
      pitchBiasSemitones: 3,
      timingOffset: -0.1,
      articulation: 1.0,
      restRatioTarget: 0.2,
      landingDurationRange: [720, 1200],
      pickupProbability: 0.6,
      bridgeMode: 'overshoot',
    };
  }
  return {
    role: 'instrumental',
    pitchBiasSemitones: 0,
    timingOffset: 0,
    articulation: 0.5,
    restRatioTarget: 0.35,
    landingDurationRange: [480, 720],
    pickupProbability: 0.2,
  };
}

export function buildChapterPlans(
  bars: number,
  middleType: ChapterMiddleType,
  modifier: SectionDynamicsModifier
): ChapterPlan[] {
  const effectiveMiddle: ChapterMiddleType =
    modifier.role === 'pre_chorus' && modifier.preChorusMode === 'dip_hold'
      ? 'dip_arch'
      : middleType;
  const chapterBars = 4;
  const totalChapters = Math.max(1, Math.ceil(bars / chapterBars));
  const plans: ChapterPlan[] = [];

  for (let c = 0; c < totalChapters; c++) {
    const startTick = c * 7680;
    const endTick = Math.min(bars * BAR_TICKS, startTick + 7680);
    const len = endTick - startTick;
    plans.push({
      chapterIndex: c,
      startTick,
      endTick,
      headRange: [startTick, Math.min(endTick, startTick + 1680)],
      middleRange: [
        Math.min(endTick, startTick + 1680),
        Math.min(endTick, startTick + 5520),
      ],
      endingRange: [
        Math.min(endTick, startTick + Math.min(5760, Math.floor(len * 0.75))),
        Math.max(startTick, endTick - 240),
      ],
      breathStartTick: Math.max(startTick, endTick - 240),
      middleType: effectiveMiddle,
      sourceChapterIndex: c % 2 === 1 ? c - 1 : undefined,
      isFinalChapterInSection: c === totalChapters - 1,
    });
  }
  return plans;
}

function generateRapMixtureFlowNotes(
  input: EngineInput,
  modifier: SectionDynamicsModifier,
  scalePcs: ReadonlySet<number>,
  keySemitone: number,
  bandMin: number,
  bandMax: number,
  rng: () => number
): MidiNote[] {
  const { song, section } = input;
  const sectionEnd = section.bars * BAR_TICKS;
  const bpm = song.bpm;
  const vocalDensity = Math.max(1.0, Math.min(5.0, section.vocalDensity ?? 3));
  const densityNorm = (vocalDensity - 1.0) / 4.0; // 0.0..1.0

  const scaleGrid = buildScaleGrid(
    scalePcs,
    Math.max(VOCAL_MIN_PITCH, bandMin - 2),
    Math.min(VOCAL_MAX_PITCH, bandMax + 2)
  );
  const safeGrid =
    scaleGrid.length > 0
      ? scaleGrid
      : [nearestScalePitch(57, scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH)];

  const rootPitch = pickClosestFromList(
    Math.round((safeGrid[0] + safeGrid[safeGrid.length - 1]) / 2) - 2,
    safeGrid.filter((p) => p % 12 === keySemitone)
  );
  const fifthPitch = pickClosestFromList(
    rootPitch + 7,
    safeGrid.filter((p) => p % 12 === (keySemitone + 7) % 12)
  );
  const accentChoices = safeGrid.filter(
    (p) => p > rootPitch && p <= rootPitch + 3
  );
  const accentPitch =
    accentChoices.length > 0 ? accentChoices[0] : fifthPitch;

  // Fast BPM (>= 120): tight 1-2 note percussive lock (<= 3 unique pitches); Slow BPM (< 120): 3-5 note melodic flow
  const isFastRap = bpm >= 120;
  const fastPitchPool = Array.from(
    new Set([rootPitch, accentPitch])
  ).slice(0, 2);
  const slowRootIdx = Math.max(0, safeGrid.indexOf(rootPitch));
  const slowPitchPool = safeGrid.slice(
    Math.max(0, slowRootIdx - 1),
    Math.min(safeGrid.length, slowRootIdx + 4)
  );

  const chapterBars = 4;
  const numChapters = Math.max(1, Math.ceil(section.bars / chapterBars));
  const notes: MidiNote[] = [];

  for (let ch = 0; ch < numChapters; ch++) {
    const chStartBar = ch * chapterBars;
    const chBars = Math.min(chapterBars, section.bars - chStartBar);

    // Best-of-4 groove selection for bars 0..(chBars-2) + final bar stop
    let bestCand: MidiNote[] = [];
    let bestScore = -Infinity;

    for (let candIdx = 0; candIdx < 4; candIdx++) {
      const candNotes: MidiNote[] = [];
      const candRng = mulberry32(
        ((input.seed + ch * 977 + candIdx * 131) >>> 0) || 1
      );
      let prevSlowIdx = Math.min(slowPitchPool.length - 1, 1);

      for (let b = 0; b < chBars; b++) {
        const barIdx = chStartBar + b;
        const barStart = barIdx * BAR_TICKS;
        const isChapterEndBar = b === chBars - 1;

        if (isChapterEndBar) {
          // 4th bar "Ending": rhythmic buildup then sharp low-root stop on beat 4 snare (1440)
          const preStops =
            densityNorm >= 0.6
              ? [0, 240, 480, 720, 960, 1200]
              : densityNorm >= 0.3
                ? [0, 480, 960]
                : [0, 960];
          for (const off of preStops) {
            if (barStart + off >= sectionEnd) continue;
            const p = isFastRap
              ? fastPitchPool[0]
              : slowPitchPool[Math.max(0, Math.min(slowPitchPool.length - 1, prevSlowIdx))];
            candNotes.push({
              pitch: p,
              velocity: clampVelocity(86 + (off % 480 === 0 ? 8 : 0)),
              startTick: barStart + off,
              durationTicks: 120,
              channel: TRACK_CHANNELS.vocal,
            });
          }
          const stopTick = barStart + 1440;
          if (stopTick < sectionEnd) {
            candNotes.push({
              pitch: rootPitch,
              velocity: 108,
              startTick: stopTick,
              durationTicks: Math.min(360, sectionEnd - stopTick),
              channel: TRACK_CHANNELS.vocal,
            });
          }
          continue;
        }

        // Standard rap bars: 16th/8th grid with snare-aligned rhymes (480, 1440)
        const step = isFastRap && densityNorm >= 0.45 ? 120 : 240;
        const baseProb = 0.25 + 0.65 * densityNorm;
        let runLen = 0;

        for (let off = 0; off < BAR_TICKS - 240; off += step) {
          const isSnarePos = off === 480 || off === 1440;
          const prob = isSnarePos ? Math.min(0.96, baseProb + 0.25) : baseProb;
          if (runLen >= 5) {
            runLen = 0;
            continue; // Breath pocket
          }
          if (candRng() > prob) {
            runLen = 0;
            continue;
          }
          runLen++;

          let p: number;
          if (isFastRap) {
            p =
              isSnarePos && candRng() < 0.45 && fastPitchPool.length > 1
                ? fastPitchPool[1]
                : fastPitchPool[0];
          } else {
            const delta = candRng() < 0.6 ? 1 : -1;
            prevSlowIdx = Math.max(
              0,
              Math.min(slowPitchPool.length - 1, prevSlowIdx + (candRng() < 0.35 ? 0 : delta))
            );
            p = slowPitchPool[prevSlowIdx];
          }

          // Crisp staccato separation (120 ticks gap before next grid if fast)
          const dur = isFastRap
            ? Math.min(step, 120)
            : Math.min(step - 20, 220);

          candNotes.push({
            pitch: p,
            velocity: clampVelocity((isSnarePos ? 104 : 84) + Math.round(modifier.articulation * 8)),
            startTick: barStart + off,
            durationTicks: Math.max(80, dur),
            channel: TRACK_CHANNELS.vocal,
          });
        }
      }

      // Score candidate: snare alignment + target density match
      const snareHits = candNotes.filter(
        (n) => n.startTick % BAR_TICKS === 480 || n.startTick % BAR_TICKS === 1440
      ).length;
      const targetNotes = Math.max(4, Math.round(chBars * (4 + densityNorm * 10)));
      const densityErr = Math.abs(candNotes.length - targetNotes);
      const score = snareHits * 3.0 - densityErr * 0.8;
      if (score > bestScore) {
        bestScore = score;
        bestCand = candNotes;
      }
    }

    notes.push(...bestCand);
  }

  void rng;
  return enforceMonophonicAndClip(notes, sectionEnd);
}

function applySectionCrossPickup(
  notes: MidiNote[],
  input: EngineInput,
  modifier: SectionDynamicsModifier,
  scalePcs: ReadonlySet<number>,
  bandMin: number,
  bandMax: number,
  rng: () => number
): MidiNote[] {
  const { song, section, nextSectionFirstChord } = input;
  const sectionEnd = section.bars * BAR_TICKS;
  if (!nextSectionFirstChord || sectionEnd < BAR_TICKS) {
    return notes;
  }

  const shouldPickup =
    modifier.role === 'pre_chorus' || rng() < modifier.pickupProbability;
  if (!shouldPickup) {
    return notes;
  }

  const out = notes.map((n) => ({ ...n }));
  const pickupStart = sectionEnd - 240;
  const breathRequiredBefore = pickupStart - 240; // Minimum 240-tick breath before pickup

  // Clip or remove any note encroaching into [breathRequiredBefore, sectionEnd)
  for (let i = out.length - 1; i >= 0; i--) {
    const n = out[i];
    if (n.startTick >= breathRequiredBefore) {
      out.splice(i, 1);
    } else if (n.startTick + n.durationTicks > breathRequiredBefore) {
      n.durationTicks = Math.max(120, breathRequiredBefore - n.startTick);
    }
  }

  const nextRootPc = noteNameToSemitone(nextSectionFirstChord.replace(/[^A-G#b]/g, '').slice(0, 2) || song.key);
  const scaleGrid = buildScaleGrid(scalePcs, bandMin, bandMax);
  const targetPitch = pickClosestFromList(
    out.length > 0 ? out[out.length - 1].pitch + 2 : 64,
    scaleGrid.filter((p) => p % 12 === nextRootPc).length > 0
      ? scaleGrid.filter((p) => p % 12 === nextRootPc)
      : scaleGrid
  );
  const leadPitch = nearestScalePitch(targetPitch - 2, scalePcs, bandMin, bandMax);

  out.push({
    pitch: leadPitch,
    velocity: clampVelocity(92 + Math.round(modifier.articulation * 12)),
    startTick: pickupStart,
    durationTicks: 240,
    channel: TRACK_CHANNELS.vocal,
  });

  return enforceMonophonicAndClip(out, sectionEnd);
}

function applySectionRoleAndChapterPostProcess(
  rawNotes: MidiNote[],
  input: EngineInput,
  modifier: SectionDynamicsModifier,
  scalePcs: ReadonlySet<number>,
  bandMin: number,
  bandMax: number,
  preset: string,
  rng: () => number
): MidiNote[] {
  const { section } = input;
  const sectionEnd = section.bars * BAR_TICKS;
  if (rawNotes.length === 0) return [];

  let notes = rawNotes.map((n) => ({ ...n }));
  const vocalDensity = Math.max(1.0, Math.min(5.0, section.vocalDensity ?? 3));

  // 1. Continuous decimal vocalDensity interpolation (handles fractional values like 1.8, 2.5, 3.3, 4.2)
  if (
    !Number.isInteger(vocalDensity) &&
    preset !== 'melody_call_response' &&
    preset !== 'melody_soar_long' &&
    preset !== 'melody_shoegaze_float'
  ) {
    if (vocalDensity < 2.8) {
      // Thin non-anchor notes proportionally
      const keepProb = 0.55 + ((vocalDensity - 1.0) / 1.8) * 0.45;
      notes = notes.filter((n, idx) => {
        if (idx === 0 || idx === notes.length - 1) return true;
        if (n.durationTicks >= 480) return true;
        return rng() <= keepProb;
      });
    } else if (vocalDensity > 3.2) {
      // Subdivide eligible long/medium notes proportionally to fractional density
      const addProb = Math.min(0.85, ((vocalDensity - 3.0) / 2.0) * 0.85);
      const subdivided: MidiNote[] = [];
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const isLast = i === notes.length - 1;
        if (
          !isLast &&
          n.durationTicks >= 480 &&
          n.durationTicks <= 720 &&
          n.startTick % BAR_TICKS < 1200 &&
          rng() < addProb
        ) {
          const half = Math.floor(n.durationTicks / 2);
          const stepPitch = nearestScalePitch(
            n.pitch + (rng() < 0.5 ? 2 : -2),
            scalePcs,
            bandMin,
            bandMax
          );
          subdivided.push({ ...n, durationTicks: half });
          subdivided.push({
            ...n,
            pitch: stepPitch,
            startTick: n.startTick + half,
            durationTicks: n.durationTicks - half,
            velocity: clampVelocity(n.velocity - 4),
          });
        } else {
          subdivided.push(n);
        }
      }
      notes = subdivided;
    }
  }

  const isRoleAwarePreset =
    preset === 'auto' ||
    preset === 'melody_alt_hypnotic' ||
    preset === 'melody_deftones_float' ||
    preset === 'melody_posthc_leap' ||
    preset === 'melody_jrock_drive' ||
    preset === 'melody_jpop_anthem';

  // 2. Section Role Dynamics (Verse / Pre-Chorus / Chorus / Bridge)
  if (modifier.role === 'verse' && isRoleAwarePreset && section.energy !== 'High') {
    // Shift downbeat phrase entries (localTick === 0) to offbeat (+240) when space permits,
    // keep resting pockets wide, shorten landing durations to 480..720, and soften velocity to 72..88
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const next = i + 1 < notes.length ? notes[i + 1] : null;
      const localTick = n.startTick % BAR_TICKS;
      if (localTick === 0 && (!next || next.startTick - n.startTick >= 480)) {
        n.startTick += 240;
        n.durationTicks = Math.max(120, n.durationTicks - 240);
      }
    }
    // Enforce >= 360..720 rest pocket at bar/phrase ends & keep landing duration in [480, 720]
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const next = i + 1 < notes.length ? notes[i + 1] : null;
      const isPhraseTail = !next || next.startTick - (n.startTick + n.durationTicks) >= 240;
      if (isPhraseTail && n.durationTicks > 720) {
        n.durationTicks = 600;
      }
      n.velocity = Math.min(88, Math.max(72, n.velocity - 10));
    }
    // Thin middle notes symmetrically by chapter offset if rest ratio is below verse target
    const totalDur = notes.reduce((s, n) => s + n.durationTicks, 0);
    if (totalDur / Math.max(1, sectionEnd) > 0.62 && notes.length > 6) {
      notes = notes.filter((n, idx) => {
        if (idx === 0 || idx === notes.length - 1) return true;
        const chLocal = n.startTick % 7680;
        if (chLocal < 1200 || chLocal % BAR_TICKS >= 1200) return true;
        return (chLocal / 120) % 3 !== 1;
      });
    }
  } else if (modifier.role === 'pre_chorus') {
    const lastBarStart = (section.bars - 1) * BAR_TICKS;
    if (modifier.preChorusBreakStyle === 'silence_break') {
      // Clear final 2-3 beats (480..720 ticks before section end, leaving pickup room if needed)
      const breakStart = sectionEnd - 720;
      for (let i = notes.length - 1; i >= 0; i--) {
        if (notes[i].startTick >= breakStart) {
          notes.splice(i, 1);
        } else if (notes[i].startTick + notes[i].durationTicks > breakStart) {
          notes[i].durationTicks = Math.max(120, breakStart - notes[i].startTick);
        }
      }
    } else {
      // Long-hold tension landing (720..960 ticks) into final bar
      const tailNotes = notes.filter((n) => n.startTick >= lastBarStart);
      if (tailNotes.length > 0) {
        const anchor = tailNotes[0];
        notes = notes.filter((n) => n.startTick <= anchor.startTick);
        anchor.durationTicks = Math.min(960, Math.max(720, sectionEnd - anchor.startTick - 240));
      }
    }
  } else if (modifier.role === 'chorus') {
    // High articulation, strong beat landing, long sustained chapter endings
    for (const n of notes) {
      n.velocity = Math.min(116, Math.max(96, n.velocity + 4));
    }
    const numChapters = Math.max(1, Math.ceil(section.bars / 4));
    for (let c = 0; c < numChapters; c++) {
      const chEnd = Math.min(sectionEnd, (c + 1) * 7680);
      const chNotes = notes.filter((n) => n.startTick >= c * 7680 && n.startTick < chEnd);
      if (chNotes.length > 0) {
        const last = chNotes[chNotes.length - 1];
        const minTarget = c === numChapters - 1 ? 960 : 720;
        if (last.durationTicks < minTarget && last.startTick + minTarget <= chEnd) {
          last.durationTicks = Math.min(1440, Math.max(minTarget, chEnd - last.startTick - 240));
        }
      }
    }
  } else if (modifier.role === 'bridge') {
    if (modifier.bridgeMode === 'otoshisabi') {
      // 0.60x thinning, -4 semitone shift, long sustain 960..1440, soft velocity
      notes = notes.filter((_, idx) => idx % 5 !== 2 && idx % 5 !== 4);
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        n.pitch = nearestScalePitch(n.pitch - 4, scalePcs, bandMin, bandMax);
        n.velocity = Math.min(82, Math.max(62, n.velocity - 16));
        const nextStart = i + 1 < notes.length ? notes[i + 1].startTick : sectionEnd;
        if (nextStart - n.startTick >= 960) {
          n.durationTicks = Math.min(1440, nextStart - n.startTick - 120);
        }
      }
    } else {
      // Overshoot climax: +3 semitones upward shift
      for (const n of notes) {
        n.pitch = nearestScalePitch(n.pitch + 3, scalePcs, bandMin, Math.min(VOCAL_MAX_PITCH, bandMax + 3));
        n.velocity = Math.min(122, Math.max(98, n.velocity + 8));
      }
    }
  }

  // 3. Section cross-pickup (auftakt)
  notes = applySectionCrossPickup(notes, input, modifier, scalePcs, bandMin, bandMax, rng);

  // 4. VoiSona micro-gap glue (0 ticks gap inside phrases, >= 240 ticks breath at phrase boundaries)
  notes = enforceMonophonicAndClip(notes, sectionEnd);
  for (let i = 0; i < notes.length - 1; i++) {
    const curr = notes[i];
    const next = notes[i + 1];
    const gap = next.startTick - (curr.startTick + curr.durationTicks);
    if (gap > 0 && gap < 240) {
      curr.durationTicks = next.startTick - curr.startTick;
    }
  }

  return enforceMonophonicAndClip(notes, sectionEnd);
}

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

function clampVocalPitch(p: number): number {
  let shifted = Math.round(p);
  while (shifted < VOCAL_MIN_PITCH) shifted += 12;
  while (shifted > VOCAL_MAX_PITCH) shifted -= 12;
  return Math.min(VOCAL_MAX_PITCH, Math.max(VOCAL_MIN_PITCH, shifted));
}

function enforceMonophonicAndClip(
  rawNotes: readonly MidiNote[],
  sectionEnd: number
): MidiNote[] {
  const valid = rawNotes
    .map((n) => ({
      pitch: Math.min(127, Math.max(0, Math.round(n.pitch))),
      velocity: clampVelocity(n.velocity),
      startTick: Math.max(0, Math.round(n.startTick)),
      durationTicks: Math.max(1, Math.round(n.durationTicks)),
      channel: TRACK_CHANNELS.vocal,
    }))
    .filter((n) => n.startTick < sectionEnd);

  valid.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  const deduped: MidiNote[] = [];
  for (const n of valid) {
    if (
      deduped.length > 0 &&
      deduped[deduped.length - 1].startTick === n.startTick
    ) {
      continue;
    }
    deduped.push(n);
  }

  for (let i = 0; i < deduped.length; i++) {
    const curr = deduped[i];
    const maxAllowed =
      i + 1 < deduped.length
        ? Math.min(
            sectionEnd - curr.startTick,
            deduped[i + 1].startTick - curr.startTick
          )
        : sectionEnd - curr.startTick;
    curr.durationTicks = Math.max(1, Math.min(curr.durationTicks, maxAllowed));
  }

  return deduped;
}

function buildScaleGrid(
  scalePcs: ReadonlySet<number>,
  minP = 52,
  maxP = 72
): number[] {
  const out: number[] = [];
  for (let p = minP; p <= maxP; p++) {
    if (scalePcs.has(p % 12)) {
      out.push(p);
    }
  }
  return out;
}

function nearestScalePitch(
  target: number,
  scalePcs: ReadonlySet<number>,
  minP = 52,
  maxP = 72
): number {
  const clamped = Math.min(maxP, Math.max(minP, Math.round(target)));
  if (scalePcs.has(clamped % 12)) {
    return clamped;
  }
  let best = clamped;
  let bestDist = Infinity;
  for (let p = minP; p <= maxP; p++) {
    if (!scalePcs.has(p % 12)) continue;
    const d = Math.abs(p - clamped);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function getScaleChordTones(
  chord: ParsedChord,
  scalePcs: ReadonlySet<number>,
  minP: number,
  maxP: number
): number[] {
  const candidatePcs: number[] = [];
  for (const iv of chord.intervals) {
    const pc = (chord.rootSemitone + iv) % 12;
    if (scalePcs.has(pc) && !candidatePcs.includes(pc)) {
      candidatePcs.push(pc);
    }
  }
  // Include 7th and 9th diatonic color tones if in scale
  for (const ext of [10, 11, 14]) {
    const pc = (chord.rootSemitone + ext) % 12;
    if (scalePcs.has(pc) && !candidatePcs.includes(pc)) {
      candidatePcs.push(pc);
    }
  }

  const pitches: number[] = [];
  for (let p = minP; p <= maxP; p++) {
    if (candidatePcs.includes(p % 12)) {
      pitches.push(p);
    }
  }
  if (pitches.length > 0) return pitches;

  const fallback = buildScaleGrid(scalePcs, minP, maxP);
  return fallback.length > 0 ? fallback : [nearestScalePitch(60, scalePcs, 48, 76)];
}

/**
 * Stage 2 helper: separates diatonic stable chord tones (Root/3rd/5th)
 * from open "question" guide tones (3rd/5th/7th/9th) strictly inside Key/Scale.
 */
function getDiatonicGuideToneBuckets(
  chord: ParsedChord,
  scalePcs: ReadonlySet<number>,
  minP: number,
  maxP: number
): { stableTones: number[]; questionTones: number[] } {
  const stablePcs = new Set<number>();
  const questionPcs = new Set<number>();

  // Root, 3rd, 5th inside chord intervals & scale
  for (let i = 0; i < chord.intervals.length; i++) {
    const iv = chord.intervals[i];
    const pc = (chord.rootSemitone + iv) % 12;
    if (!scalePcs.has(pc)) continue;
    stablePcs.add(pc);
    if (iv !== 0) {
      questionPcs.add(pc);
    }
  }
  // Diatonic 7th & 9th guide/color extensions
  for (const ext of [10, 11, 14]) {
    const pc = (chord.rootSemitone + ext) % 12;
    if (scalePcs.has(pc)) {
      questionPcs.add(pc);
    }
  }

  const stableTones: number[] = [];
  const questionTones: number[] = [];
  for (let p = minP; p <= maxP; p++) {
    const pc = p % 12;
    if (stablePcs.has(pc)) stableTones.push(p);
    if (questionPcs.has(pc)) questionTones.push(p);
  }

  const fallback = buildScaleGrid(scalePcs, minP, maxP);
  const safeFallback =
    fallback.length > 0 ? fallback : [nearestScalePitch(60, scalePcs, 48, 76)];
  return {
    stableTones: stableTones.length > 0 ? stableTones : safeFallback,
    questionTones: questionTones.length > 0 ? questionTones : stableTones.length > 0 ? stableTones : safeFallback,
  };
}

function pickClosestFromList(target: number, candidates: readonly number[]): number {
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - target);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function computeContinuityRange(
  energy: 'Low' | 'Mid' | 'High',
  prevVocalAvgPitch?: number
): { minP: number; maxP: number } {
  if (prevVocalAvgPitch === undefined || Number.isNaN(prevVocalAvgPitch)) {
    if (energy === 'Low') return { minP: 54, maxP: 66 };
    if (energy === 'High') return { minP: 57, maxP: 72 };
    return { minP: 55, maxP: 69 };
  }

  // Smooth transition from previous section (e.g., Rap -> Chorus Melody):
  // center lifts at most +4..+5 semitones and ceiling stays <= prevCenter + 7 (clamped to 52..72)
  const prevCenter = Math.min(70, Math.max(54, Math.round(prevVocalAvgPitch)));
  const maxLift = energy === 'High' ? 4 : energy === 'Low' ? -2 : 2;
  const targetCenter = Math.min(68, Math.max(54, prevCenter + maxLift));
  const minP = Math.max(52, Math.min(prevCenter - 2, targetCenter - 5));
  const maxP = Math.min(72, Math.max(minP + 7, prevCenter + 7));
  return { minP, maxP };
}

export function generateVocalNotes(input: EngineInput): MidiNote[] {
  const { song, section, style, seed, params, prevVocalAvgPitch } = input;
  const member = song.members.vocal;
  if (!member?.enabled || section.enabledParts?.vocal === false) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;
  const vocalDensity = section.vocalDensity ?? 3;

  // Mode A: Custom recorded/edited Vocal Melody priority mode
  const melody = section.vocalMelody;
  if (melody && melody.notes.length > 0) {
    const maxSourceEnd = melody.notes.reduce(
      (max, n) => Math.max(max, n.startTick + n.durationTicks),
      0
    );
    const loopBars = Math.max(
      1,
      Math.min(4, melody.bars ?? Math.ceil(maxSourceEnd / TICKS_PER_BAR))
    );
    const loopLen = loopBars * TICKS_PER_BAR;
    const expanded: MidiNote[] = [];

    for (let base = 0; base < sectionEnd; base += loopLen) {
      for (let i = 0; i < melody.notes.length; i++) {
        const src = melody.notes[i];
        const absTick = base + src.startTick;
        if (absTick < 0 || absTick >= sectionEnd) continue;

        let pitch = clampVocalPitch(src.pitch);
        let velocity = src.velocity;
        let durationTicks = Math.max(1, src.durationTicks);

        if (style === 'A') {
          velocity = clampVelocity(
            Math.min(params.velocityCap, velocity + rng.nextInt(-4, 4))
          );
        } else if (style === 'B') {
          const isDownbeat = src.startTick % 960 === 0;
          velocity = clampVelocity(velocity + (isDownbeat ? 5 : -3));
          durationTicks = Math.max(60, Math.round(durationTicks * 0.9));
        } else {
          velocity = clampVelocity(velocity + rng.nextInt(-6, 8));
          if (
            section.energy !== 'Low' &&
            i === melody.notes.length - 1 &&
            rng.chance(0.45) &&
            pitch + 2 <= VOCAL_MAX_PITCH
          ) {
            pitch = pitch + (rng.chance(0.5) ? 2 : -2);
          }
        }

        expanded.push({
          pitch,
          velocity,
          startTick: absTick,
          durationTicks,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    }

    return enforceMonophonicAndClip(expanded, sectionEnd);
  }

  // Mode B: Preset-based Vocal / Rap Generator
  const preset =
    section.patternPresets?.vocal ??
    section.partPresets?.vocal ??
    member.patternPreset ??
    'auto';
  const keySemitone = noteNameToSemitone(song.key);
  const scalePcs = new Set(getScalePitchClasses(song.key, song.scale));
  const { minP: bandMin, maxP: bandMax } = computeContinuityRange(
    section.energy,
    prevVocalAvgPitch
  );
  const scaleNotes = buildScaleGrid(scalePcs, 52, 72);

  // Rap anchor strictly within song Key/Scale around E3..F4
  const rawAnchor = fitPitchClassToRange(
    keySemitone,
    Math.max(54, bandMin),
    Math.min(64, bandMax)
  );
  const rapAnchor = nearestScalePitch(rawAnchor, scalePcs, 52, 68);
  const anchorIdx = Math.max(
    0,
    scaleNotes.indexOf(rapAnchor)
  );
  const scaleStep = (delta: number): number => {
    const idx = Math.min(
      scaleNotes.length - 1,
      Math.max(0, anchorIdx + delta)
    );
    return scaleNotes[idx] ?? rapAnchor;
  };
  const rapBelow = scaleStep(-1);
  const rapTwoBelow = scaleStep(-2);
  const rapSecond = scaleStep(1);
  const rapThird = scaleStep(2);
  const rapFifth = scaleStep(4);

  const baseVel =
    section.energy === 'High' ? 104 : section.energy === 'Low' ? 78 : 92;
  const notes: MidiNote[] = [];

  // Draw 5 Performance Variants from seeded RNG so every 🎲 re-roll creates fresh phrasing
  type ArticulationStyle =
    | 'staccato_chop'
    | 'dramatic_hold'
    | 'contrast_stop'
    | 'flowing_legato';
  type ContourShape =
    | 'arch'
    | 'ascending_launch'
    | 'descending_cascade'
    | 'wave_pendulum';
  type EntryTiming = 'on_beat' | 'auftakt_pickup' | 'syncopated_after';
  type HookDevice = 'octave_leap' | 'machinegun_repeat' | 'call_response_drop';
  type RapFlowVariant =
    | 'rapid_then_freeze'
    | 'laidback_triplet'
    | 'melodic_hook_tail'
    | 'sparse_punchline';

  const articulationStyle: ArticulationStyle =
    preset === 'melody_staccato_chop' || preset === 'melody_staccato_rock'
      ? 'staccato_chop'
      : preset === 'melody_shoegaze_float' ||
          preset === 'melody_soar_long' ||
          preset === 'melody_ballad_breath' ||
          preset === 'melody_ballad'
        ? 'dramatic_hold'
        : rng.pick([
            'dramatic_hold',
            'contrast_stop',
            'flowing_legato',
            'staccato_chop',
          ]);

  const contourShape: ContourShape =
    preset === 'melody_anthem_climb'
      ? 'ascending_launch'
      : preset === 'melody_grunge_drag'
        ? 'descending_cascade'
        : rng.pick([
            'arch',
            'ascending_launch',
            'descending_cascade',
            'wave_pendulum',
          ]);

  const entryTiming: EntryTiming =
    preset === 'melody_staccato_chop' || preset === 'melody_syncopated_hook'
      ? 'syncopated_after'
      : preset === 'melody_ballad' || preset === 'melody_soar_long'
        ? 'on_beat'
        : rng.pick(['on_beat', 'auftakt_pickup', 'syncopated_after']);

  const hookDevice: HookDevice = rng.pick([
    'octave_leap',
    'machinegun_repeat',
    'call_response_drop',
  ]);

  const rapFlowVariant: RapFlowVariant =
    preset === 'rap_stop_and_go'
      ? 'rapid_then_freeze'
      : preset === 'rap_triplet_bounce'
        ? 'laidback_triplet'
        : preset === 'rap_spoken_tension'
          ? 'melodic_hook_tail'
          : rng.pick([
              'rapid_then_freeze',
              'laidback_triplet',
              'melodic_hook_tail',
              'sparse_punchline',
            ]);

  const role = normalizeSectionRole(section.type, section.energy, section.name);
  const roleRng = mulberry32(((seed ^ 0x4b1d2e3f) >>> 0) || 1);
  const modifier = resolveSectionDynamicsModifier(
    role,
    section.energy,
    section.name,
    roleRng
  );

  if (preset === 'rap_mixture_flow') {
    const rapNotes = generateRapMixtureFlowNotes(
      input,
      modifier,
      scalePcs,
      keySemitone,
      bandMin,
      bandMax,
      roleRng
    );
    return applySectionCrossPickup(
      rapNotes,
      input,
      modifier,
      scalePcs,
      bandMin,
      bandMax,
      roleRng
    );
  }

  const isRapPreset = preset.startsWith('rap_') && preset !== 'rap_linkin_hybrid';
  if (isRapPreset) {
    // Prepare deterministic 2-bar motif for rap_hook_chant
    const hookVariant = rng.nextInt(0, 2);
    const hookMotifBar0 =
      hookVariant === 0
        ? [0, 360, 480, 960, 1200, 1440]
        : hookVariant === 1
          ? [0, 240, 480, 840, 960, 1440]
          : [0, 480, 720, 960, 1320, 1440];
    const hookMotifBar1 =
      style === 'C'
        ? [0, 240, 480, 720, 960, 1200]
        : [0, 360, 480, 960, 1200];

    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * TICKS_PER_BAR;
      const isPhraseEndBar = bar % 2 === 1 || bar === section.bars - 1;

      if (preset === 'rap_16th_push' || preset === 'rap_double_time') {
        const isDouble = preset === 'rap_double_time';
        const restStartStep =
          vocalDensity <= 1
            ? 8
            : vocalDensity === 2
              ? 10
              : isDouble
                ? rng.nextInt(10, 12)
                : style === 'B'
                  ? 14
                  : style === 'C'
                    ? rng.nextInt(10, 13)
                    : rng.nextInt(12, 14);
        const burstGapStep = style === 'A' ? 7 : rng.nextInt(5, 8);
        const stepStride =
          vocalDensity === 1 ? 4 : vocalDensity === 2 ? 2 : 1;

        for (let s = 0; s < 16; s += stepStride) {
          if (s >= restStartStep) continue;
          if (
            vocalDensity === 3 &&
            s === burstGapStep &&
            rng.chance(isDouble ? 0.25 : 0.6)
          ) {
            continue;
          }
          if (
            vocalDensity <= 3 &&
            style === 'A' &&
            !isDouble &&
            s % 4 === 3 &&
            rng.chance(0.45)
          ) {
            continue;
          }
          if (vocalDensity === 5 && s >= restStartStep && isDouble) continue;

          let pitch = rapAnchor;
          if (s === restStartStep - stepStride && isPhraseEndBar) {
            pitch = rng.chance(0.5) ? rapTwoBelow : rapBelow;
          } else if (s % 4 === 2 && rng.chance(style === 'C' ? 0.55 : 0.3)) {
            pitch = rapThird;
          } else if (s === 0 && bar > 0 && rng.chance(0.25)) {
            pitch = isDouble ? rapSecond : rapFifth;
          } else if (s % 8 === 7 && rng.chance(0.4)) {
            pitch = rapBelow;
          }

          const accent = s % 4 === 0 ? 8 : s % 2 === 0 ? 0 : -10;
          const dur =
            vocalDensity === 1
              ? 360
              : vocalDensity === 2
                ? 190
                : 100;
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel + accent + rng.nextInt(-4, 4)),
            startTick: barStart + s * 120,
            durationTicks: dur,
            channel: TRACK_CHANNELS.vocal,
          });
        }
        // High vocalDensity extra pickup on bar rest pocket
        if (vocalDensity >= 4 && !isPhraseEndBar) {
          for (const extra of vocalDensity === 5 ? [1440, 1560, 1680, 1800] : [1440, 1680]) {
            if (extra >= restStartStep * 120) {
              notes.push({
                pitch: extra === 1800 ? rapBelow : rapAnchor,
                velocity: clampVelocity(baseVel - 6 + rng.nextInt(-3, 4)),
                startTick: barStart + extra,
                durationTicks: 100,
                channel: TRACK_CHANNELS.vocal,
              });
            }
          }
        }
      } else if (preset === 'rap_triplet_trap') {
        const dropBeat =
          style === 'B' ? 3 : style === 'C' ? rng.nextInt(1, 2) : 2;
        for (let beat = 0; beat < 4; beat++) {
          if (vocalDensity === 1 && (beat === 1 || beat === 3)) continue;
          if (beat === 3 && isPhraseEndBar && vocalDensity <= 3 && rng.chance(0.65)) {
            continue;
          }
          if (
            vocalDensity <= 3 &&
            beat === dropBeat &&
            rng.chance(style === 'B' ? 0.25 : 0.55)
          ) {
            continue;
          }
          const tupleCount =
            vocalDensity === 1
              ? 1
              : vocalDensity === 2
                ? 2
                : vocalDensity >= 4
                  ? 3
                  : style === 'C' && beat === 2
                    ? 3
                    : rng.chance(0.6)
                      ? 3
                      : 2;
          for (let sub = 0; sub < tupleCount; sub++) {
            const tick = barStart + beat * 480 + sub * 160;
            let pitch = rapAnchor;
            if (beat === 3 && sub === tupleCount - 1) {
              pitch = rapTwoBelow;
            } else if (sub === 1 && rng.chance(0.35)) {
              pitch = rapThird;
            } else if (beat === 1 && sub === 0 && rng.chance(0.25)) {
              pitch = rapBelow;
            }
            notes.push({
              pitch,
              velocity: clampVelocity(
                baseVel + (sub === 0 ? 6 : -8) + rng.nextInt(-4, 4)
              ),
              startTick: tick,
              durationTicks: vocalDensity <= 2 ? 260 : 135,
              channel: TRACK_CHANNELS.vocal,
            });
          }
        }
      } else if (preset === 'rap_laidback_groove') {
        // Offbeat-heavy laid-back pocket sitting low around root/below
        const laidBackSteps =
          vocalDensity <= 1
            ? [240, 1200]
            : vocalDensity === 2
              ? [240, 720, 1200, 1680]
              : vocalDensity >= 4
                ? [0, 240, 360, 600, 840, 960, 1080, 1320, 1560, 1680]
                : style === 'C'
                  ? [240, 360, 600, 840, 1080, 1320, 1680]
                  : [240, 600, 840, 1200, 1560];
        for (let i = 0; i < laidBackSteps.length; i++) {
          const off = laidBackSteps[i];
          if (vocalDensity === 3 && i > 1 && rng.chance(0.15)) continue;
          const pitch =
            isPhraseEndBar && i === laidBackSteps.length - 1
              ? rapTwoBelow
              : i % 3 === 1
                ? rapBelow
                : i % 4 === 2
                  ? rapSecond
                  : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel - 4 + (off % 480 === 240 ? 6 : -2) + rng.nextInt(-4, 4)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 280 : 160,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_hook_chant') {
        // Repeating 2-bar anthem hook motif
        const motif = bar % 2 === 0 ? hookMotifBar0 : hookMotifBar1;
        const activeSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? motif.filter((_, idx) => idx % 2 === 0)
              : vocalDensity >= 4
                ? Array.from(new Set([...motif, 240, 720, 1560])).sort((a, b) => a - b)
                : motif;
        for (let i = 0; i < activeSteps.length; i++) {
          const off = activeSteps[i];
          const pitch =
            bar % 2 === 1 && i === activeSteps.length - 1
              ? rapThird
              : off === 480 || off === 1440
                ? rapAnchor
                : off === 1200
                  ? rapSecond
                  : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (off % 480 === 0 ? 10 : -2) + rng.nextInt(-3, 3)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 320 : 180,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_nu_metal') {
        const basePattern =
          vocalDensity <= 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960, 1440]
              : vocalDensity >= 4
                ? [0, 120, 240, 360, 480, 720, 840, 960, 1200, 1320, 1440, 1560, 1680]
                : style === 'B'
                  ? [0, 360, 480, 720, 960, 1200, 1440, 1680]
                  : style === 'C'
                    ? [0, 120, 360, 480, 840, 960, 1200, 1440, 1560, 1680]
                    : [0, 360, 480, 840, 960, 1320, 1440, 1680];
        for (let i = 0; i < basePattern.length; i++) {
          const off = basePattern[i];
          if (vocalDensity <= 3 && isPhraseEndBar && off > 1560) continue;
          if (vocalDensity === 3 && i > 0 && i < basePattern.length - 2 && rng.chance(0.18)) {
            continue;
          }
          let pitch = rapAnchor;
          if (off === 360 || off === 840) {
            pitch = rapThird;
          } else if (off === 1440 && bar % 2 === 1) {
            pitch = rapFifth;
          } else if (off === 1680) {
            pitch = rapTwoBelow;
          }
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (off === 480 || off === 1440 ? 10 : 0) + rng.nextInt(-3, 5)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 260 : 110,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_jhiphop_bounce') {
        const bounceSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960, 1440]
              : vocalDensity === 3
                ? [0, 240, 480, 720, 960, 1200, 1440]
                : vocalDensity === 4
                  ? [0, 240, 360, 480, 720, 960, 1080, 1200, 1440, 1680]
                  : [0, 120, 240, 360, 480, 720, 840, 960, 1080, 1200, 1440, 1560, 1680];
        for (let i = 0; i < bounceSteps.length; i++) {
          const off = bounceSteps[i];
          const isTail = i === bounceSteps.length - 1;
          const pitch = isTail
            ? isPhraseEndBar
              ? rapThird
              : rapBelow
            : off % 480 === 240
              ? rapSecond
              : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (isTail ? 10 : off % 480 === 240 ? 4 : 0) + rng.nextInt(-3, 3)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 240 : isTail ? 260 : 150,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_mixture_melodic') {
        const mixSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 360, 960, 1440]
              : vocalDensity === 3
                ? [0, 360, 480, 840, 960, 1200, 1440]
                : vocalDensity === 4
                  ? [0, 120, 360, 480, 720, 840, 960, 1200, 1440, 1680]
                  : [0, 120, 240, 360, 480, 600, 840, 960, 1080, 1200, 1320, 1440, 1680];
        const riseBar = bar === section.bars - 1 || isPhraseEndBar;
        for (let i = 0; i < mixSteps.length; i++) {
          const off = mixSteps[i];
          let pitch = rapAnchor;
          if (riseBar && i >= Math.max(1, mixSteps.length - 3)) {
            const stepPos = i - Math.max(1, mixSteps.length - 3);
            pitch = stepPos === 0 ? rapSecond : stepPos === 1 ? rapThird : rapFifth;
          } else if (off === 360 || off === 840) {
            pitch = rapThird;
          } else if (off % 480 === 0 && rng.chance(0.25)) {
            pitch = rapBelow;
          }
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (riseBar && i === mixSteps.length - 1 ? 12 : 4) + rng.nextInt(-3, 3)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 250 : riseBar && i === mixSteps.length - 1 ? 300 : 140,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_hybrid_soar') {
        const frontSteps =
          vocalDensity === 1
            ? [0]
            : vocalDensity === 2
              ? [0, 240, 480]
              : vocalDensity === 3
                ? [0, 120, 240, 360, 480, 720]
                : [0, 120, 240, 360, 480, 600, 720, 840];
        for (let i = 0; i < frontSteps.length; i++) {
          const off = frontSteps[i];
          notes.push({
            pitch: i % 3 === 2 ? rapSecond : rapAnchor,
            velocity: clampVelocity(baseVel + (off === 0 ? 6 : 0) + rng.nextInt(-3, 3)),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 200 : 100,
            channel: TRACK_CHANNELS.vocal,
          });
        }
        // Sustained melodic sing tail starting at beat 3 using diatonic guide tones
        const barChord = getActiveChordAtTick(
          section.chords,
          barStart + 960,
          song.key,
          song.scale,
          section.bars
        ).parsed;
        const { stableTones, questionTones } = getDiatonicGuideToneBuckets(
          barChord,
          scalePcs,
          bandMin,
          bandMax
        );
        const singCandidates = isPhraseEndBar ? stableTones : questionTones;
        const singPitch = pickClosestFromList(
          bar % 2 === 1 ? rapFifth : rapThird,
          singCandidates
        );
        const singVel = clampVelocity(
          bar % 2 === 1 ? Math.min(110, baseVel + 8) : Math.max(78, baseVel - 4)
        );
        notes.push({
          pitch: singPitch,
          velocity: singVel,
          startTick: barStart + 960,
          durationTicks: isPhraseEndBar ? 720 : 840,
          channel: TRACK_CHANNELS.vocal,
        });
      } else if (preset === 'rap_cinematic_burst') {
        // Dramatic beat 1-3 burst followed by beat 4 dramatic silence
        const burstSteps =
          vocalDensity === 1
            ? [0, 480]
            : vocalDensity === 2
              ? [0, 240, 480, 960]
              : vocalDensity === 3
                ? [0, 120, 240, 480, 600, 720, 960, 1200]
                : [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200, 1320];
        for (let i = 0; i < burstSteps.length; i++) {
          const off = burstSteps[i];
          const pitch =
            i === burstSteps.length - 1
              ? rapFifth
              : off >= 960
                ? rapThird
                : i % 4 === 2
                  ? rapSecond
                  : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (off >= 960 ? 10 : off % 480 === 0 ? 6 : -2)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 220 : 105,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_emo_sparse') {
        const emoSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960]
              : vocalDensity === 3
                ? [0, 360, 960, 1320]
                : vocalDensity === 4
                  ? [0, 240, 360, 720, 960, 1200, 1560]
                  : [0, 120, 360, 480, 720, 960, 1200, 1320, 1560];
        for (let i = 0; i < emoSteps.length; i++) {
          const off = emoSteps[i];
          const pitch =
            i === 0 ? rapBelow : i % 2 === 1 ? rapTwoBelow : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel - 12 + (off % 960 === 0 ? 6 : 0)),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 360 : 210,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_stop_and_go') {
        // 16th machine-gun bursts followed by complete silent freeze break
        const burstSteps =
          vocalDensity === 1
            ? [0, 240]
            : vocalDensity === 2
              ? [0, 120, 240, 480]
              : vocalDensity === 3
                ? [0, 120, 240, 360, 480, 600, 720, 840]
                : [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080];
        for (let i = 0; i < burstSteps.length; i++) {
          const off = burstSteps[i];
          notes.push({
            pitch: i === burstSteps.length - 1 ? rapThird : i % 3 === 1 ? rapSecond : rapAnchor,
            velocity: clampVelocity(baseVel + (i === burstSteps.length - 1 ? 10 : 4)),
            startTick: barStart + off,
            durationTicks: 85,
            channel: TRACK_CHANNELS.vocal,
          });
        }
        // Leaves 960..1920 (or 1200..1920 at dense) as sudden freeze silence!
      } else if (preset === 'rap_triplet_bounce') {
        const tripSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 320, 960, 1280]
              : vocalDensity === 3
                ? [0, 160, 320, 480, 800, 960, 1120, 1440]
                : [0, 160, 320, 480, 640, 800, 960, 1120, 1280, 1440, 1600, 1760];
        for (let i = 0; i < tripSteps.length; i++) {
          const off = tripSteps[i];
          const pitch =
            off === 800 || off === 1600
              ? rapThird
              : i % 3 === 1
                ? rapSecond
                : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel + (off % 480 === 0 ? 8 : -2) + rng.nextInt(-3, 3)),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 220 : 125,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_linkin_hybrid') {
        // LINKIN PARK verse style: tight percussive 16th monotone & m2/M2 step bursts in beats 1-2,
        // followed by a crisp dead-stop silent break in beats 3-4 (>= 720 ticks)
        const burstSteps =
          vocalDensity === 1
            ? [0, 240, 480]
            : vocalDensity === 2
              ? [0, 120, 240, 480, 720]
              : vocalDensity === 3
                ? [0, 120, 240, 360, 480, 600, 720, 840]
                : vocalDensity === 4
                  ? [0, 120, 240, 360, 480, 600, 720, 840, 960]
                  : [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080];
        const rapStepUp = scaleStep(1);
        for (let i = 0; i < burstSteps.length; i++) {
          const off = burstSteps[i];
          const isAccent = off % 480 === 0 || i === burstSteps.length - 1;
          // Mostly tight monotone anchor with occasional +/- 1 scale-step percussive bite
          const pitch =
            i === burstSteps.length - 1
              ? isPhraseEndBar
                ? rapBelow
                : rapStepUp
              : i % 4 === 3
                ? rapStepUp
                : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel + (isAccent ? 12 : -4) + rng.nextInt(-2, 2)),
            startTick: barStart + off,
            durationTicks: i === burstSteps.length - 1 ? 120 : 85,
            channel: TRACK_CHANNELS.vocal,
          });
        }
        // Beats 3-4 remain a crisp dead-stop silence (>= 720..960 ticks) for dramatic contrast
      } else if (preset === 'rap_spoken_tension') {
        const spokenSteps =
          vocalDensity === 1
            ? [0, 1440]
            : vocalDensity === 2
              ? [0, 480, 1440]
              : vocalDensity === 3
                ? [0, 240, 480, 720, 960, 1440]
                : [0, 120, 240, 480, 600, 720, 960, 1080, 1440, 1680];
        for (let i = 0; i < spokenSteps.length; i++) {
          const off = spokenSteps[i];
          const isBarEndLift = off >= 1440;
          const pitch = isBarEndLift ? rapFifth : i % 2 === 1 ? rapBelow : rapTwoBelow;
          notes.push({
            pitch,
            velocity: clampVelocity(isBarEndLift ? baseVel + 12 : baseVel - 10),
            startTick: barStart + off,
            durationTicks: isBarEndLift ? 360 : 170,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else {
        // rap_monotone_chant & flow variant influence
        const baseChant =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960]
              : vocalDensity >= 4
                ? [0, 120, 240, 480, 720, 960, 1200, 1320, 1440, 1680]
                : rapFlowVariant === 'sparse_punchline'
                  ? [480, 960, 1200, 1440]
                  : style === 'C'
                    ? [0, 240, 480, 840, 960, 1200, 1440]
                    : style === 'B'
                      ? [0, 480, 960, 1200, 1440]
                      : [0, 240, 480, 960, 1200];
        for (let i = 0; i < baseChant.length; i++) {
          const off = baseChant[i];
          if (vocalDensity <= 3 && isPhraseEndBar && i === baseChant.length - 1 && rng.chance(0.45)) {
            continue;
          }
          const isTail = isPhraseEndBar && i === baseChant.length - 1;
          const pitch = isTail ? rapBelow : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (off % 960 === 0 ? 6 : -4) + rng.nextInt(-3, 3)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 360 : 180,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      }
    }

    const baseResult = enforceMonophonicAndClip(notes, sectionEnd);
    return applySectionRoleAndChapterPostProcess(
      baseResult,
      input,
      modifier,
      scalePcs,
      bandMin,
      bandMax,
      preset,
      roleRng
    );
  }

  // =========================================================================
  // Next-Gen 6-Stage Vocal Melody Architecture
  // =========================================================================
  const DNA_PRESET_MAP: Partial<Record<string, MelodyStyleProfileId>> = {
    melody_alt_hypnotic: 'alt_hypnotic',
    melody_deftones_float: 'deftones_float',
    melody_posthc_leap: 'posthc_leap',
    melody_jrock_drive: 'jrock_drive',
    melody_jpop_anthem: 'jpop_anthem',
    rap_linkin_hybrid: 'linkin_hybrid',
  };
  const dnaProfileId = DNA_PRESET_MAP[preset];
  if (dnaProfileId) {
    const profile = MELODY_STYLE_PROFILES[dnaProfileId];
    const grammar = profile.grammar;
    const isChorusSection =
      section.type === 'Chorus' || section.energy === 'High';
    const coupling = isChorusSection
      ? grammar.harmonicCouplingChorus
      : grammar.harmonicCouplingVerse;

    // Singable range clamped within max 16 semitones & connected smoothly to prevVocalAvgPitch
    const energyShift =
      prevVocalAvgPitch !== undefined
        ? 0
        : profile.energyOctaveShift[section.energy];
    const rawMinP =
      dnaProfileId === 'linkin_hybrid'
        ? Math.max(VOCAL_MIN_PITCH, bandMin - 2)
        : Math.max(VOCAL_MIN_PITCH, Math.min(VOCAL_MAX_PITCH - 12, bandMin + Math.min(0, energyShift)));
    const rawMaxP =
      dnaProfileId === 'linkin_hybrid'
        ? Math.min(VOCAL_MAX_PITCH, rawMinP + 10)
        : Math.min(
            VOCAL_MAX_PITCH,
            Math.max(
              rawMinP + 10,
              Math.min(
                rawMinP + 15,
                bandMax + Math.max(0, energyShift) + (dnaProfileId === 'posthc_leap' || dnaProfileId === 'deftones_float' ? 3 : 2)
              )
            )
          );
    const scalePitchesBase = buildScaleGrid(scalePcs, rawMinP, rawMaxP);
    const scalePitches =
      scalePitchesBase.length > 0
        ? scalePitchesBase
        : [nearestScalePitch(60, scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH)];
    const minPitchBound = scalePitches[0];
    const maxPitchBound = scalePitches[scalePitches.length - 1];

    const pentOffsets =
      song.scale === 'Major' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
    const pentPcs = new Set(pentOffsets.map((o) => (keySemitone + o) % 12));

    // -----------------------------------------------------------------------
    // Step 1: Phrase & Breath Macro-Planner
    // -----------------------------------------------------------------------
    const planPhrases = (): PhrasePlan[] => {
      const plans: PhrasePlan[] = [];
      const baseBreathMid = Math.round(
        ((grammar.targetRestRatio[0] + grammar.targetRestRatio[1]) * 0.5) * 1920
      );
      const densityAdj = (3 - vocalDensity) * 90;
      const defaultBreath = Math.max(
        240,
        Math.min(960, Math.round((baseBreathMid + densityAdj) / 120) * 120)
      );

      if (section.bars === 8) {
        const roles: PhraseRole[] = [
          'statement',
          'antecedent',
          'variation',
          'consequent',
        ];
        const peaks = [3, 5, 8, 6];
        const ratios = [0.65, 0.72, 0.85, 0.28];
        for (let p = 0; p < 4; p++) {
          const startTick = p * 3840;
          const endTick = startTick + 3840;
          plans.push({
            phraseId: p,
            startTick,
            endTick,
            singEndTick: endTick - defaultBreath,
            role: roles[p],
            peakOffsetSemitones: peaks[p],
            peakPositionRatio: ratios[p],
            motifSourcePhraseId: p === 2 ? 0 : p === 3 ? 1 : undefined,
          });
        }
        return plans;
      }

      if (section.bars === 4) {
        return [
          {
            phraseId: 0,
            startTick: 0,
            endTick: 3840,
            singEndTick: 3840 - defaultBreath,
            role: 'statement',
            peakOffsetSemitones: 4,
            peakPositionRatio: 0.65,
          },
          {
            phraseId: 1,
            startTick: 3840,
            endTick: 7680,
            singEndTick: 7680 - defaultBreath,
            role: 'consequent',
            peakOffsetSemitones: 7,
            peakPositionRatio: 0.38,
          },
        ];
      }

      const totalBlocks = Math.ceil(section.bars / 2);
      for (let p = 0; p < totalBlocks; p++) {
        const startTick = p * 3840;
        const endTick = Math.min(sectionEnd, startTick + 3840);
        const span = endTick - startTick;
        const breath = Math.min(Math.max(240, Math.floor(span * 0.22 / 120) * 120), defaultBreath);
        const role: PhraseRole =
          p === totalBlocks - 1
            ? 'consequent'
            : p === 0
              ? 'statement'
              : p % 2 === 1
                ? 'antecedent'
                : 'variation';
        plans.push({
          phraseId: p,
          startTick,
          endTick,
          singEndTick: Math.max(startTick + 480, endTick - breath),
          role,
          peakOffsetSemitones: role === 'consequent' ? 6 : 4,
          peakPositionRatio: role === 'consequent' ? 0.35 : 0.65,
          motifSourcePhraseId: role === 'variation' && p >= 2 ? 0 : undefined,
        });
      }
      return plans;
    };

    const phrases = planPhrases();

    // -----------------------------------------------------------------------
    // Step 2: Human Syllable Rhythm Cell Selection & BPM Tempo Guard
    // -----------------------------------------------------------------------
    const bpm = song.bpm ?? 120;
    const selectAndScaleRhythmCell = (phrase: PhrasePlan): SyllableSlot[] => {
      const phraseLen = (phrase.endTick - phrase.startTick) >= 3840 ? 3840 : 1920;
      const genreCells = VOCAL_RHYTHM_CELLS.filter(
        (c) =>
          c.lengthTicks === phraseLen &&
          c.genres.includes(dnaProfileId) &&
          (bpm > 120 ? !c.hasSixteenths : true)
      );
      const densityMatched = genreCells.filter(
        (c) =>
          vocalDensity >= c.densityRange[0] && vocalDensity <= c.densityRange[1]
      );
      const cellPool =
        densityMatched.length > 0
          ? densityMatched
          : genreCells.length > 0
            ? genreCells
            : VOCAL_RHYTHM_CELLS.filter((c) => c.lengthTicks === phraseLen);

      const chosenCell = rng.pick(cellPool);
      let slots: SyllableSlot[] = chosenCell.slots.map((s) => ({ ...s }));

      // Density 1..2 thinning: drop weak stress===0 slots into previous note
      if (vocalDensity <= 2 && slots.length > 4) {
        const thinned: SyllableSlot[] = [];
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          if (
            s.stress === 0 &&
            thinned.length > 0 &&
            slots.length - (i - thinned.length) > 4
          ) {
            thinned[thinned.length - 1].baseDuration += s.baseDuration;
          } else {
            thinned.push(s);
          }
        }
        slots = thinned;
      }

      // Density 4..5 enrichment: split at most 1 non-final long tone (>= 720) into two 8ths
      if (vocalDensity >= 4 && slots.length < 11) {
        for (let i = 0; i < slots.length - 1; i++) {
          if (slots[i].baseDuration >= 720) {
            const half = Math.max(240, Math.floor(slots[i].baseDuration / 2 / 120) * 120);
            const rem = slots[i].baseDuration - half;
            if (half >= 240 && rem >= 240) {
              slots[i].baseDuration = half;
              slots.splice(i + 1, 0, {
                offsetTick: slots[i].offsetTick + half,
                baseDuration: rem,
                stress: 0,
              });
              break;
            }
          }
        }
      }

      // Enforce human note count window [3, 14] and respect singEndTick breath window
      const singSpan = Math.max(480, phrase.singEndTick - phrase.startTick);
      slots = slots.filter((s) => s.offsetTick < singSpan).slice(0, 14);
      if (slots.length < 3) {
        slots = [
          { offsetTick: 0, baseDuration: 480, stress: 2 as const },
          { offsetTick: 480, baseDuration: 480, stress: 1 as const },
          { offsetTick: 960, baseDuration: Math.max(240, Math.min(720, singSpan - 960)), stress: 2 as const },
        ].filter((s) => s.offsetTick < singSpan);
      }

      return slots;
    };

    // -----------------------------------------------------------------------
    // Step 5 Helper: Organic Motif Variation (P2 <- P0, P3 <- P1)
    // -----------------------------------------------------------------------
    const applyMotifVariation = (
      sourceSlots: readonly SyllableSlot[],
      phrase: PhrasePlan
    ): SyllableSlot[] => {
      const singSpan = Math.max(480, phrase.singEndTick - phrase.startTick);
      const keepRatio = 0.65 + rng.next() * 0.1; // 65%..75% inheritance
      const keepCount = Math.max(
        2,
        Math.min(sourceSlots.length - 1, Math.round(sourceSlots.length * keepRatio))
      );
      const inherited = sourceSlots.slice(0, keepCount).map((s) => ({ ...s }));
      const tailSource = sourceSlots.slice(keepCount).map((s) => ({ ...s }));

      if (tailSource.length === 0) {
        return inherited.filter((s) => s.offsetTick < singSpan);
      }

      const op = rng.pick(['long_hold', 'eighth_climb', 'beat4_syncopate'] as const);
      if (op === 'long_hold') {
        const last = tailSource[tailSource.length - 1];
        last.baseDuration = Math.max(last.baseDuration, Math.min(1200, singSpan - last.offsetTick));
        return [...inherited, last].filter((s) => s.offsetTick < singSpan);
      }
      if (op === 'eighth_climb' && tailSource.length >= 1) {
        const anchor = tailSource[0];
        const nextTick = anchor.offsetTick + 240;
        if (nextTick + 240 <= singSpan) {
          return [
            ...inherited,
            { ...anchor, baseDuration: 240, stress: 1 },
            {
              offsetTick: nextTick,
              baseDuration: Math.max(240, Math.min(960, singSpan - nextTick)),
              stress: 2,
              leapSlot: anchor.leapSlot,
            },
          ];
        }
      }
      // 'beat4_syncopate': anticipate final tail note -240 ticks earlier
      const tailOut = tailSource.map((s, idx) => {
        if (idx === tailSource.length - 1 && s.offsetTick >= 480) {
          const prevEnd =
            idx > 0
              ? tailSource[idx - 1].offsetTick + 240
              : inherited[inherited.length - 1].offsetTick + 240;
          if (s.offsetTick - 240 >= prevEnd) {
            return {
              ...s,
              offsetTick: s.offsetTick - 240,
              baseDuration: s.baseDuration + 240,
              isAnticipation: true,
            };
          }
        }
        return s;
      });
      return [...inherited, ...tailOut].filter((s) => s.offsetTick < singSpan);
    };

    // -----------------------------------------------------------------------
    // Step 3: Melodic Arch Curve
    // -----------------------------------------------------------------------
    const basePitchCenter = (() => {
      if (prevVocalAvgPitch !== undefined && !Number.isNaN(prevVocalAvgPitch)) {
        const shift = section.energy === 'High' ? 3 : section.energy === 'Low' ? -1 : 1;
        return Math.min(
          maxPitchBound - 2,
          Math.max(minPitchBound + 2, Math.round(prevVocalAvgPitch) + shift)
        );
      }
      const mid = (minPitchBound + maxPitchBound) / 2;
      const eShift = section.energy === 'High' ? 2 : section.energy === 'Low' ? -2 : 0;
      return Math.min(maxPitchBound - 2, Math.max(minPitchBound + 2, Math.round(mid + eShift)));
    })();

    const computeTargetArchPitch = (
      absTick: number,
      phrase: PhrasePlan
    ): number => {
      const sectionRatio = Math.min(1, Math.max(0, absTick / Math.max(1, sectionEnd)));
      const phraseSpan = Math.max(1, phrase.singEndTick - phrase.startTick);
      const localRatio = Math.min(
        1,
        Math.max(0, (absTick - phrase.startTick) / phraseSpan)
      );

      // Macro section curve: peaks at ~0.72..0.82 (Bar 6-7 on 8-bar) or ~0.68 (Bar 3 on 4-bar)
      const climaxPos = section.bars >= 8 ? 0.78 : 0.68;
      const macroRise =
        sectionRatio <= climaxPos
          ? (sectionRatio / climaxPos) * 4.5
          : 4.5 * (1 - (sectionRatio - climaxPos) / Math.max(0.01, 1 - climaxPos)) * 0.7;

      // Local phrase arch shaped by grammar.archShape
      let localArc = 0;
      if (grammar.archShape === 'flat_low') {
        localArc = localRatio > 0.75 ? 2.5 : Math.sin(localRatio * Math.PI) * 1.5;
      } else if (grammar.archShape === 'soar_drop') {
        localArc =
          localRatio < phrase.peakPositionRatio
            ? (localRatio / Math.max(0.1, phrase.peakPositionRatio)) * phrase.peakOffsetSemitones * 0.6
            : phrase.peakOffsetSemitones * 0.6 * (1 - (localRatio - phrase.peakPositionRatio) * 0.55);
      } else if (grammar.archShape === 'late_climb') {
        localArc = localRatio * phrase.peakOffsetSemitones * 0.65;
      } else if (grammar.archShape === 'tight_burst') {
        localArc = localRatio < 0.5 ? 1.0 : -0.5;
      } else {
        // classic_arch
        localArc = Math.sin(localRatio * Math.PI) * (phrase.peakOffsetSemitones * 0.55);
      }

      return Math.min(
        maxPitchBound,
        Math.max(minPitchBound, basePitchCenter - 1.5 + macroRise + localArc)
      );
    };

    // -----------------------------------------------------------------------
    // Step 4: Weighted Gravity & Harmony Pitch Solver
    // -----------------------------------------------------------------------
    const solveNextPitch = (ctx: {
      absTick: number;
      slot: SyllableSlot;
      isFinalNoteOfPhrase: boolean;
      phrase: PhrasePlan;
      prevPitch: number;
      prevPrevPitch: number;
      consecutiveUnisons: number;
      motifDirHint?: number;
    }): number => {
      const {
        absTick,
        slot,
        isFinalNoteOfPhrase,
        phrase,
        prevPitch,
        prevPrevPitch,
        consecutiveUnisons,
        motifDirHint,
      } = ctx;

      // 4.1 Anticipatory Lookahead (+240 ticks on anticipation slots)
      const lookupTick = slot.isAnticipation
        ? Math.min(sectionEnd - 1, absTick + 240)
        : Math.min(sectionEnd - 1, absTick);
      const chord = getActiveChordAtTick(
        section.chords,
        lookupTick,
        song.key,
        song.scale,
        section.bars
      ).parsed;

      // Check if chord is non-diatonic (e.g. dim7, tritone sub, borrowed)
      const chordRootInScale = scalePcs.has(chord.rootSemitone % 12);
      const chordPcs = new Set(
        chord.intervals.map((iv) => (chord.rootSemitone + iv) % 12)
      );
      const nextLookupChord = getActiveChordAtTick(
        section.chords,
        Math.min(sectionEnd - 1, lookupTick + 480),
        song.key,
        song.scale,
        section.bars
      ).parsed;
      const nextResolveTargets = [
        nextResolvePc(nextLookupChord, 0),
        nextResolvePc(nextLookupChord, 3),
        nextResolvePc(nextLookupChord, 4),
      ].filter((pc): pc is number => pc !== null);

      const targetArch = computeTargetArchPitch(absTick, phrase);
      const prevInterval = prevPitch - prevPrevPitch;
      const top30Threshold = minPitchBound + (maxPitchBound - minPitchBound) * 0.7;

      const scores: number[] = [];
      for (const cand of scalePitches) {
        let score = 0;
        const pc = cand % 12;
        const relChordSemi = (pc - chord.rootSemitone + 12) % 12;
        const relKeySemi = (pc - keySemitone + 12) % 12;

        // 4.2 Harmonic Score (MHD Blend)
        let localHarmonic = 0;
        if (relChordSemi === 0) localHarmonic += grammar.toneWeights.root;
        else if (relChordSemi === 3 || relChordSemi === 4) localHarmonic += grammar.toneWeights.third;
        else if (relChordSemi === 7 || (chord.quality === 'dim' && relChordSemi === 6))
          localHarmonic += grammar.toneWeights.fifth;
        else if (relChordSemi === 10 || relChordSemi === 11 || (chord.quality === 'dim' && relChordSemi === 9))
          localHarmonic += grammar.toneWeights.seventh;
        else if (relChordSemi === 2) localHarmonic += grammar.toneWeights.ninth;
        else if (relChordSemi === 5) localHarmonic += grammar.toneWeights.eleventh;
        else localHarmonic += slot.stress === 0 ? 0.5 : -0.6;

        // Passing tones allowed on weak stress === 0
        if (slot.stress === 0 && !chordPcs.has(pc)) {
          localHarmonic += 0.35;
        }

        // Non-diatonic guide-tone bonus (shared chord tone or step to next root/3rd)
        if (!chordRootInScale || chord.quality === 'dim') {
          if (chordPcs.has(pc)) {
            localHarmonic += 1.5;
          } else if (
            nextResolveTargets.some((npc) => {
              const stepDist = Math.min((pc - npc + 12) % 12, (npc - pc + 12) % 12);
              return stepDist >= 1 && stepDist <= 2;
            })
          ) {
            localHarmonic += 1.5;
          }
        }

        let mhdAxis = 0;
        if (pentPcs.has(pc)) mhdAxis += grammar.toneWeights.pentatonic;
        if (relKeySemi === 0 || relKeySemi === 7) mhdAxis += 0.8;

        score += coupling * localHarmonic + (1 - coupling) * mhdAxis;

        // 4.3 Pitch Proximity & Low-Skip Bias
        const diff = cand - prevPitch;
        const absDiff = Math.abs(diff);
        if (absDiff === 0) {
          if (consecutiveUnisons >= grammar.maxConsecutiveUnisons) {
            score -= 8.0;
          } else {
            score += grammar.unisonWeight * 1.5;
          }
        } else if (absDiff <= 2) {
          score += 2.8;
        } else if (absDiff <= 4) {
          score += 1.8;
        } else if (absDiff === 5) {
          score += 0.4;
        } else if (absDiff === 6) {
          score -= 2.5;
        } else if (absDiff <= 9) {
          if (
            slot.leapSlot &&
            diff > 0 &&
            rng.chance(grammar.signatureLeapChance + 0.35)
          ) {
            score += 2.2;
          } else {
            score -= 2.0;
          }
        } else if (absDiff <= 12) {
          if (
            slot.leapSlot &&
            diff > 0 &&
            (dnaProfileId === 'deftones_float' || dnaProfileId === 'posthc_leap')
          ) {
            score += 1.8;
          } else {
            score -= 4.0;
          }
        } else {
          score -= 10.0;
        }

        // Low-Skip Bias
        if (prevPitch >= top30Threshold && diff >= 5) {
          score -= 2.5;
        }

        // 4.4 Post-Skip Reversal / Gap-Fill
        const absPrevInt = Math.abs(prevInterval);
        if (absPrevInt >= 5) {
          const isOpposite =
            (prevInterval > 0 && diff < 0) || (prevInterval < 0 && diff > 0);
          if (isOpposite && absDiff >= 1 && absDiff <= 4) {
            score += absPrevInt >= 7 ? 6.0 : 4.5;
          } else if (isOpposite && absDiff === 5) {
            score += 2.5;
          } else if (!isOpposite && absDiff >= 1) {
            score -= absPrevInt >= 7 ? 8.0 : 5.0;
          }
          if (absDiff >= 6) {
            score -= 9.0;
          }
        } else if (
          prevInterval !== 0 &&
          diff !== 0 &&
          Math.sign(prevInterval) !== Math.sign(diff) &&
          absPrevInt <= 2 &&
          absDiff <= 2
        ) {
          // Gentle anti-zigzag penalty
          score -= 1.2;
        }

        // 4.5 Arch Tracking Score
        score -= 0.45 * Math.abs(cand - targetArch);

        // 4.6 Cadence Score
        if (isFinalNoteOfPhrase) {
          if (phrase.role === 'antecedent') {
            if (
              relKeySemi === 2 ||
              relKeySemi === 7 ||
              relKeySemi === 10 ||
              relKeySemi === 11 ||
              relChordSemi === 2 ||
              relChordSemi === 3 ||
              relChordSemi === 4
            ) {
              score += 2.0;
            }
            if (relKeySemi === 0) {
              score -= 1.0;
            }
          } else if (phrase.role === 'consequent') {
            if (
              relKeySemi === 0 ||
              relKeySemi === 3 ||
              relKeySemi === 4 ||
              relChordSemi === 0 ||
              relChordSemi === 3 ||
              relChordSemi === 4
            ) {
              score += 3.5 * grammar.cadenceResolutionStrength;
            }
          }
        }

        // Step 5 Motif Contour Consistency Bonus
        if (motifDirHint !== undefined && motifDirHint !== 0) {
          if (Math.sign(diff) === motifDirHint) {
            score += 2.2;
          }
        }

        scores.push(score);
      }

      // Deterministic Temperature Softmax Selection
      const temperature = 0.45;
      const maxScore = Math.max(...scores);
      const weights = scores.map((s) => Math.exp((s - maxScore) / temperature));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let r = rng.next() * totalWeight;
      for (let i = 0; i < scalePitches.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          return scalePitches[i];
        }
      }
      return scalePitches[scores.indexOf(maxScore)];
    };

    function nextResolvePc(chord: ParsedChord, iv: number): number | null {
      if (!chord.intervals.includes(iv) && iv !== 0) return null;
      return (chord.rootSemitone + iv) % 12;
    }

    // -----------------------------------------------------------------------
    // Execute Phrases (Steps 2 -> 5 -> 4)
    // -----------------------------------------------------------------------
    interface TaggedNote extends MidiNote {
      phraseId: number;
    }

    const phraseSlotStore = new Map<number, SyllableSlot[]>();
    const phrasePitchStore = new Map<number, number[]>();
    const rawTagged: TaggedNote[] = [];

    // Choose initial pitch inside lower-mid scale range
    const startChord = getActiveChordAtTick(
      section.chords,
      0,
      song.key,
      song.scale,
      section.bars
    ).parsed;
    const startIdeal =
      prevVocalAvgPitch !== undefined && !Number.isNaN(prevVocalAvgPitch)
        ? prevVocalAvgPitch
        : minPitchBound + (maxPitchBound - minPitchBound) * 0.35;
    const startScaleChordTones = getScaleChordTones(
      startChord,
      scalePcs,
      minPitchBound,
      maxPitchBound
    );
    let currPitch = pickClosestFromList(startIdeal, startScaleChordTones);
    let prevPrevPitch = currPitch;
    let consecutiveUnisons = 0;
    let phraseClusterCounter = 0;

    for (let pIdx = 0; pIdx < phrases.length; pIdx++) {
      const phrase = phrases[pIdx];
      let slots: SyllableSlot[];
      let motifDirs: number[] | undefined;

      if (
        phrase.motifSourcePhraseId !== undefined &&
        phraseSlotStore.has(phrase.motifSourcePhraseId)
      ) {
        const srcSlots = phraseSlotStore.get(phrase.motifSourcePhraseId)!;
        const srcPitches = phrasePitchStore.get(phrase.motifSourcePhraseId) ?? [];
        slots = applyMotifVariation(srcSlots, phrase);
        motifDirs = srcPitches.map((p, k) =>
          k === 0 ? 0 : Math.sign(p - srcPitches[k - 1])
        );
      } else {
        slots = selectAndScaleRhythmCell(phrase);
      }

      phraseSlotStore.set(phrase.phraseId, slots);
      const chosenPitches: number[] = [];

      // Split sub-phrase cluster IDs across intentional mid-cell silent breaks (>= 360 ticks)
      // so Step 6 preserves deliberate freeze rests (e.g. Linkin Park verse) while keeping 0 micro-gaps
      let activeClusterId = phraseClusterCounter++;

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const absTick = phrase.startTick + slot.offsetTick;
        if (absTick >= sectionEnd || absTick >= phrase.singEndTick) continue;

        if (i > 0) {
          const prevSlot = slots[i - 1];
          const prevEnd = prevSlot.offsetTick + prevSlot.baseDuration;
          if (slot.offsetTick - prevEnd >= 360) {
            activeClusterId = phraseClusterCounter++;
          }
        }

        const isLastSlot =
          i === slots.length - 1 ||
          phrase.startTick + slots[i + 1].offsetTick >= phrase.singEndTick;

        const nextPitch =
          pIdx === 0 && i === 0
            ? currPitch
            : solveNextPitch({
                absTick,
                slot,
                isFinalNoteOfPhrase: isLastSlot,
                phrase,
                prevPitch: currPitch,
                prevPrevPitch,
                consecutiveUnisons,
                motifDirHint: motifDirs?.[i],
              });

        if (nextPitch === currPitch) {
          consecutiveUnisons += 1;
        } else {
          consecutiveUnisons = 0;
        }
        prevPrevPitch = currPitch;
        currPitch = nextPitch;
        chosenPitches.push(nextPitch);

        const maxDurToSingEnd = Math.max(
          120,
          Math.min(slot.baseDuration, phrase.singEndTick - absTick, sectionEnd - absTick)
        );
        const relPos = (nextPitch - minPitchBound) / Math.max(1, maxPitchBound - minPitchBound);
        const vel = clampVelocity(
          baseVel +
            (slot.stress === 2 ? 8 : slot.stress === 0 ? -6 : 0) +
            Math.round(relPos * 10) +
            rng.nextInt(-3, 3)
        );

        rawTagged.push({
          pitch: nextPitch,
          velocity: vel,
          startTick: absTick,
          durationTicks: maxDurToSingEnd,
          channel: TRACK_CHANNELS.vocal,
          phraseId: activeClusterId,
        });
      }

      phrasePitchStore.set(phrase.phraseId, chosenPitches);
    }

    // -----------------------------------------------------------------------
    // Step 6: VoiSona-Optimized Legato & Monophony Post-Processor
    // -----------------------------------------------------------------------
    const postProcessVocalNotes = (inputNotes: TaggedNote[]): MidiNote[] => {
      if (inputNotes.length === 0) return [];
      const sorted = inputNotes
        .filter((n) => n.startTick >= 0 && n.startTick < sectionEnd)
        .sort((a, b) => a.startTick - b.startTick);

      // Deduplicate identical startTicks cleanly
      const unique: TaggedNote[] = [];
      for (const n of sorted) {
        if (unique.length > 0 && unique[unique.length - 1].startTick === n.startTick) {
          continue;
        }
        unique.push({ ...n });
      }

      // 6.1 & 6.2: Intra-phrase legato (0 gap) and Inter-phrase breath (>= 240 ticks)
      for (let i = 0; i + 1 < unique.length; i++) {
        const curr = unique[i];
        const next = unique[i + 1];
        const span = next.startTick - curr.startTick;

        if (curr.phraseId === next.phraseId) {
          // Strict 0-tick micro-gap inside phrase for VoiSona legato singing
          curr.durationTicks = Math.max(120, span);
        } else {
          // Ensure >= 240-tick breath gap across phrase / sub-phrase boundary
          const maxAllowed = span - 240;
          if (curr.durationTicks > maxAllowed) {
            curr.durationTicks = Math.max(120, Math.min(span, maxAllowed));
          }
          // Eliminate any accidental 1..239 tick micro-gap by extending or keeping >= 240 breath
          const gap = next.startTick - (curr.startTick + curr.durationTicks);
          if (gap > 0 && gap < 240) {
            if (span - 240 >= 120) {
              curr.durationTicks = span - 240;
            } else {
              curr.durationTicks = span;
            }
          }
        }
      }

      // 6.3: Eliminate < 120-tick micro-notes & clamp final note to sectionEnd
      const merged: TaggedNote[] = [];
      for (let i = 0; i < unique.length; i++) {
        const curr = unique[i];
        if (curr.durationTicks < 120 && merged.length > 0) {
          merged[merged.length - 1].durationTicks += curr.durationTicks;
          continue;
        }
        merged.push(curr);
      }

      // 6.4: Final guardrail verification (strict monophony, >= 120 duration, 100% scale)
      const finalOut: MidiNote[] = [];
      for (let i = 0; i < merged.length; i++) {
        const curr = merged[i];
        const safePitch = scalePcs.has(curr.pitch % 12)
          ? curr.pitch
          : nearestScalePitch(curr.pitch, scalePcs, minPitchBound, maxPitchBound);
        const maxDur =
          i + 1 < merged.length
            ? Math.min(sectionEnd - curr.startTick, merged[i + 1].startTick - curr.startTick)
            : sectionEnd - curr.startTick;
        const safeDur = Math.min(curr.durationTicks, maxDur);
        if (safeDur < 120) continue;

        finalOut.push({
          pitch: safePitch,
          velocity: clampVelocity(curr.velocity),
          startTick: curr.startTick,
          durationTicks: safeDur,
          channel: TRACK_CHANNELS.vocal,
        });
      }

      return finalOut;
    };

    const nextGenNotes = postProcessVocalNotes(rawTagged);
    return applySectionRoleAndChapterPostProcess(
      nextGenNotes,
      input,
      modifier,
      scalePcs,
      minPitchBound,
      maxPitchBound,
      preset,
      roleRng
    );
  }

  // =========================================================================
  // 3-Stage Melodic Soul Pipeline (100% Key/Scale + Monophonic + Motif A->A')
  // =========================================================================
  const pentOffsets =
    song.scale === 'Major' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
  const pentPcs = new Set(pentOffsets.map((o) => (keySemitone + o) % 12));
  const pentGrid = buildScaleGrid(pentPcs, bandMin, bandMax);
  const fullSoulGrid = buildScaleGrid(scalePcs, bandMin, bandMax);
  const soulGridBase =
    preset === 'melody_alt_minor' || preset === 'melody_britpop_catchy'
      ? pentGrid.length >= 4
        ? pentGrid
        : fullSoulGrid
      : fullSoulGrid.length > 0
        ? fullSoulGrid
        : scaleNotes;
  const soulGrid =
    soulGridBase.length > 0
      ? soulGridBase
      : [nearestScalePitch(60, scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH)];

  const findGridIdx = (targetPitch: number): number => {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < soulGrid.length; i++) {
      const d = Math.abs(soulGrid[i] - targetPitch);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  const velocityArc = (
    gridIdx: number,
    isPeak: boolean,
    isBreathTail: boolean
  ): number => {
    const ratio =
      soulGrid.length <= 1 ? 0.5 : gridIdx / Math.max(1, soulGrid.length - 1);
    if (isBreathTail) {
      return clampVelocity(Math.round(73 + ratio * 11)); // 73..84 soft tail release before breath
    }
    if (isPeak) {
      return clampVelocity(Math.round(96 + ratio * 16)); // 96..112 emotional climax peak
    }
    return clampVelocity(Math.round(86 + ratio * 20)); // 86..106 expressive stepwise phrase
  };

  const initialAnchor = fitPitchClassToRange(
    keySemitone,
    bandMin,
    Math.min(bandMin + 7, bandMax)
  );
  let prevPitch = nearestScalePitch(initialAnchor, scalePcs, bandMin, bandMax);

  // Special mode: jrock_anticipation keeps beat 4-and (1680) barline anticipation across all 5 parts
  if (preset === 'jrock_anticipation') {
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * TICKS_PER_BAR;
      const chord = getActiveChordAtTick(
        section.chords,
        barStart,
        song.key,
        song.scale,
        section.bars
      ).parsed;
      const chordTones = getScaleChordTones(chord, scalePcs, bandMin, bandMax);
      const bodyOffsets =
        bar === 0
          ? vocalDensity <= 2
            ? [0, 960]
            : vocalDensity >= 4
              ? [0, 240, 480, 720, 960, 1200]
              : [0, 480, 960]
          : vocalDensity <= 2
            ? [720, 1200]
            : vocalDensity >= 4
              ? [480, 720, 960, 1200, 1440]
              : [480, 960, 1200];

      let currIdx = findGridIdx(prevPitch);
      for (let i = 0; i < bodyOffsets.length; i++) {
        const off = bodyOffsets[i];
        const step = i === 0 ? 0 : rng.pick([0, 1, 1, -1]);
        currIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + step));
        const pitch =
          off === 0
            ? pickClosestFromList(soulGrid[currIdx], chordTones)
            : soulGrid[currIdx];
        currIdx = findGridIdx(pitch);
        prevPitch = pitch;
        notes.push({
          pitch,
          velocity: velocityArc(currIdx, false, false),
          startTick: barStart + off,
          durationTicks: vocalDensity >= 4 ? 200 : 380,
          channel: TRACK_CHANNELS.vocal,
        });
      }

      const antTick = barStart + 1680;
      if (antTick < sectionEnd) {
        const nextChord = getActiveChordAtTick(
          section.chords,
          Math.min(sectionEnd - 1, barStart + TICKS_PER_BAR),
          song.key,
          song.scale,
          section.bars
        ).parsed;
        const nextChordTones = getScaleChordTones(
          nextChord,
          scalePcs,
          bandMin,
          bandMax
        );
        const antPitch = pickClosestFromList(prevPitch + 2, nextChordTones);
        const antIdx = findGridIdx(antPitch);
        prevPitch = antPitch;
        notes.push({
          pitch: antPitch,
          velocity: velocityArc(antIdx, true, false),
          startTick: antTick,
          durationTicks: 700,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    }
    const baseResult = enforceMonophonicAndClip(notes, sectionEnd);
    return applySectionRoleAndChapterPostProcess(
      baseResult,
      input,
      modifier,
      scalePcs,
      bandMin,
      bandMax,
      preset,
      roleRng
    );
  }

  // Stage 1 Types: 2-Bar Rhythm Motif Skeleton
  type RhythmRole = 'word' | 'peak' | 'tail';
  interface RhythmSlot {
    localTick: number; // 0 .. (blockBars * TICKS_PER_BAR - 1)
    durationTicks: number;
    role: RhythmRole;
  }

  const usesAuftakt =
    preset === 'melody_syncopated_hook' ||
    preset === 'melody_britpop_catchy' ||
    preset === 'melody_alt_soar' ||
    entryTiming === 'auftakt_pickup' ||
    entryTiming === 'syncopated_after';

  const isStaccatoPreset =
    preset === 'melody_staccato_rock' || preset === 'melody_staccato_chop';
  const isLongHoldPreset =
    preset === 'melody_shoegaze_float' ||
    preset === 'melody_soar_long' ||
    preset === 'melody_ballad_breath' ||
    preset === 'melody_anthem_climb';

  const buildPhraseRhythmSkeleton = (
    blockBars: number,
    isAPrime: boolean,
    motifASkeleton: RhythmSlot[] | null
  ): RhythmSlot[] => {
    // 1-bar single-section fallback
    if (blockBars === 1) {
      if (preset === 'melody_soar_long' || preset === 'melody_shoegaze_float') {
        return [{ localTick: 0, durationTicks: 1440, role: 'tail' }];
      }
      if (isStaccatoPreset) {
        const offs = vocalDensity === 1 ? [0, 960] : [0, 240, 480, 960];
        return offs.map((t, idx) => ({
          localTick: t,
          durationTicks: idx === offs.length - 1 ? 180 : 110,
          role: idx === 1 ? 'peak' : idx === offs.length - 1 ? 'tail' : 'word',
        }));
      }
      if (vocalDensity === 1) {
        return [{ localTick: 0, durationTicks: 1440, role: 'tail' }];
      }
      if (vocalDensity === 2) {
        return [
          { localTick: 0, durationTicks: 420, role: 'word' },
          { localTick: 480, durationTicks: 1080, role: 'tail' },
        ];
      }
      return [
        { localTick: usesAuftakt ? 240 : 0, durationTicks: 210, role: 'word' },
        { localTick: 480, durationTicks: 210, role: 'peak' },
        { localTick: 720, durationTicks: 960, role: 'tail' },
      ];
    }

    // Standard 2-bar (Phrase A or Phrase A') rhythm skeleton (0..3840 ticks)
    // Always preserve >= 240..480 ticks of human breath rest at phrase end (ending by tick 3360..3480)
    if (isAPrime && motifASkeleton && motifASkeleton.length > 0) {
      // Inherit 75..85%+ of Phrase A's front & peak rhythm verbatim, slightly adapting tail if density allows
      const inherited: RhythmSlot[] = motifASkeleton.map((s) => ({ ...s }));
      if (
        preset !== 'melody_soar_long' &&
        !isStaccatoPreset &&
        vocalDensity >= 3 &&
        inherited.length >= 4
      ) {
        const lastIdx = inherited.length - 1;
        if (inherited[lastIdx].role === 'tail' && inherited[lastIdx].localTick === TICKS_PER_BAR + 480) {
          inherited[lastIdx] = {
            localTick: TICKS_PER_BAR + 480,
            durationTicks: preset === 'melody_shoegaze_float' ? 1200 : 1080,
            role: 'tail',
          };
        }
      }
      return inherited;
    }

    // Phrase A ("Question") Construction
    const slots: RhythmSlot[] = [];

    if (isStaccatoPreset) {
      const bar0 =
        vocalDensity === 1
          ? [0, 960]
          : vocalDensity === 2
            ? [0, 480, 960]
            : preset === 'melody_staccato_chop'
              ? vocalDensity >= 4
                ? [240, 360, 720, 840, 1200, 1440, 1680]
                : [240, 720, 960, 1200, 1680]
              : vocalDensity >= 4
                ? [0, 240, 480, 600, 720, 960, 1200, 1440]
                : [0, 240, 480, 960, 1200, 1440];
      const bar1 =
        vocalDensity === 1
          ? [0, 960]
          : vocalDensity === 2
            ? [0, 480, 960]
            : preset === 'melody_staccato_chop'
              ? [0, 240, 720, 1200]
              : [0, 240, 480, 960, 1200];
      for (let i = 0; i < bar0.length; i++) {
        const nextT = i + 1 < bar0.length ? bar0[i + 1] : TICKS_PER_BAR;
        slots.push({
          localTick: bar0[i],
          durationTicks: Math.max(55, Math.min(200, Math.round((nextT - bar0[i]) * 0.45))),
          role: 'word',
        });
      }
      for (let i = 0; i < bar1.length; i++) {
        const nextT = i + 1 < bar1.length ? bar1[i + 1] : 1440;
        slots.push({
          localTick: TICKS_PER_BAR + bar1[i],
          durationTicks: Math.max(55, Math.min(200, Math.round((nextT - bar1[i]) * 0.45))),
          role: i === 0 ? 'peak' : i === bar1.length - 1 ? 'tail' : 'word',
        });
      }
      return slots;
    }

    if (preset === 'melody_soar_long' || preset === 'melody_shoegaze_float') {
      const frontOffs =
        preset === 'melody_shoegaze_float'
          ? vocalDensity <= 2
            ? [0]
            : [0, 960]
          : vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960, 1440]
              : vocalDensity === 3
                ? [0, 240, 480, 960, 1200, 1680]
                : vocalDensity === 4
                  ? [0, 240, 360, 480, 720, 960, 1200, 1440, 1680]
                  : [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200, 1440, 1680];
      for (let i = 0; i < frontOffs.length; i++) {
        const t = frontOffs[i];
        const nextT = i + 1 < frontOffs.length ? frontOffs[i + 1] : TICKS_PER_BAR;
        const durCap =
          preset === 'melody_shoegaze_float'
            ? 1400
            : vocalDensity === 1
              ? 880
              : vocalDensity >= 4
                ? 190
                : 380;
        slots.push({
          localTick: t,
          durationTicks: Math.min(durCap, Math.max(100, nextT - t - 20)),
          role: 'word',
        });
      }
      // Bar 1 sustained >= 1440 long tone + 480-tick breath rest
      slots.push({
        localTick: TICKS_PER_BAR,
        durationTicks: 1440,
        role: 'peak',
      });
      return slots;
    }

    // Standard 2-bar Melodic Soul skeleton driven by Performance Variants + Vocal Density
    if (vocalDensity === 1 || preset === 'melody_ballad_breath') {
      return [
        { localTick: 0, durationTicks: 960, role: 'word' },
        { localTick: TICKS_PER_BAR, durationTicks: 1440, role: 'peak' }, // sustained 1440 + 480 breath rest
      ];
    }

    if (vocalDensity === 2) {
      return [
        { localTick: 0, durationTicks: 420, role: 'word' },
        { localTick: 480, durationTicks: 420, role: 'word' },
        { localTick: 960, durationTicks: 420, role: 'word' },
        { localTick: 1440, durationTicks: 400, role: 'word' },
        { localTick: TICKS_PER_BAR, durationTicks: 440, role: 'peak' },
        { localTick: TICKS_PER_BAR + 480, durationTicks: 1080, role: 'tail' }, // 360 breath rest
      ];
    }

    // vocalDensity 3..5: Shaped cleanly by entryTiming & articulationStyle
    let frontBar0: number[];
    if (vocalDensity >= 5) {
      frontBar0 = [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200, 1320, 1440, 1680];
    } else if (vocalDensity === 4) {
      frontBar0 =
        preset === 'melody_syncopated_hook'
          ? [0, 120, 360, 600, 840, 960, 1200, 1560]
          : entryTiming === 'syncopated_after'
            ? [240, 360, 720, 840, 1200, 1440, 1680]
            : [240, 360, 480, 720, 960, 1200, 1440, 1680];
    } else {
      // vocalDensity === 3
      if (preset === 'melody_syncopated_hook') {
        frontBar0 = [0, 360, 720, 1200, 1560];
      } else if (preset === 'melody_grunge_drag') {
        frontBar0 = [0, 270, 510, 990, 1470];
      } else if (preset === 'melody_ballad' || preset === 'melody_emo_screamo') {
        frontBar0 = [0, 480, 960, 1440];
      } else if (articulationStyle === 'contrast_stop') {
        // Pack 4 fast 16th/8th syllables in beat 1..2, then stop suddenly for 480-tick break!
        frontBar0 = [0, 120, 240, 480, 1200, 1440, 1680];
      } else if (entryTiming === 'syncopated_after') {
        frontBar0 = [240, 480, 720, 1200, 1560];
      } else if (usesAuftakt) {
        frontBar0 = [240, 480, 720, 1200, 1440, 1680];
      } else {
        frontBar0 = [0, 240, 480, 960, 1200, 1680];
      }
    }

    for (let i = 0; i < frontBar0.length; i++) {
      const t = frontBar0[i];
      const nextT = i + 1 < frontBar0.length ? frontBar0[i + 1] : TICKS_PER_BAR;
      const gap = nextT - t;
      let dur: number;
      if (articulationStyle === 'staccato_chop' && vocalDensity <= 4) {
        dur = Math.max(70, Math.min(180, Math.round(gap * 0.52)));
      } else if (articulationStyle === 'flowing_legato' && vocalDensity <= 4) {
        dur = Math.max(100, Math.min(440, gap - 8));
      } else {
        const maxDur = vocalDensity >= 5 ? 110 : vocalDensity === 4 ? 190 : 380;
        dur = Math.max(90, Math.min(maxDur, gap - 15));
      }
      slots.push({
        localTick: t,
        durationTicks: dur,
        role: 'word',
      });
    }

    // Bar 1: climax leap pickup (peak -> gap-fill descent) + >= 960 sustained landing + 360 breath rest
    const bar1Pickups =
      vocalDensity >= 4
        ? [0, 120, 240, 360]
        : preset === 'melody_syncopated_hook'
          ? [0, 360]
          : isLongHoldPreset
            ? [0]
            : [0, 240];
    for (let i = 0; i < bar1Pickups.length; i++) {
      const t = bar1Pickups[i];
      const nextT = i + 1 < bar1Pickups.length ? bar1Pickups[i + 1] : 480;
      const dur =
        vocalDensity >= 4
          ? Math.min(110, nextT - t - 10)
          : articulationStyle === 'staccato_chop'
            ? Math.max(90, Math.round((nextT - t) * 0.6))
            : Math.max(100, nextT - t - 20);
      slots.push({
        localTick: TICKS_PER_BAR + t,
        durationTicks: dur,
        role: i === 0 ? 'peak' : 'word',
      });
    }

    slots.push({
      localTick: TICKS_PER_BAR + 480,
      durationTicks: 1080, // >= 960 sustained long tone; ends at 3480, leaving 360-tick breath rest
      role: 'tail',
    });

    return slots;
  };

  // Stage 2 & Stage 3 Execution Loop (2-bar blocks across section)
  let motifASkeleton: RhythmSlot[] | null = null;
  let motifARelativeContour: number[] | null = null;
  let currIdx = findGridIdx(prevPitch);
  let lastWasBigUpLeap = false;

  for (let blockStartBar = 0; blockStartBar < section.bars; blockStartBar += 2) {
    const phraseIndex = Math.floor(blockStartBar / 2);
    const blockBars = Math.min(2, section.bars - blockStartBar);
    const isAPrime = phraseIndex % 2 === 1;

    // Preserve Call & Response 4-bar resting structure (bars 2 & 3 respond gently / rest)
    if (preset === 'melody_call_response' && isAPrime) {
      if (vocalDensity >= 3) {
        const echoChord = getActiveChordAtTick(
          section.chords,
          blockStartBar * TICKS_PER_BAR,
          song.key,
          song.scale,
          section.bars
        ).parsed;
        const { stableTones } = getDiatonicGuideToneBuckets(
          echoChord,
          scalePcs,
          bandMin,
          bandMax
        );
        const echoPitch = pickClosestFromList(soulGrid[currIdx], stableTones);
        currIdx = findGridIdx(echoPitch);
        lastWasBigUpLeap = false;
        notes.push({
          pitch: echoPitch,
          velocity: velocityArc(currIdx, false, true),
          startTick: blockStartBar * TICKS_PER_BAR,
          durationTicks: 480,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    // STAGE 1: Generate/inherit rhythm skeleton
    const skeleton = buildPhraseRhythmSkeleton(blockBars, isAPrime, motifASkeleton);

    // STAGE 2: Guide-tone anchor selection per timeline chord in this block
    const frontChord = getActiveChordAtTick(
      section.chords,
      blockStartBar * TICKS_PER_BAR,
      song.key,
      song.scale,
      section.bars
    ).parsed;
    const tailChord = getActiveChordAtTick(
      section.chords,
      Math.min(sectionEnd - 1, (blockStartBar + blockBars - 1) * TICKS_PER_BAR + 960),
      song.key,
      song.scale,
      section.bars
    ).parsed;
    const frontBuckets = getDiatonicGuideToneBuckets(frontChord, scalePcs, bandMin, bandMax);
    const tailBuckets = getDiatonicGuideToneBuckets(tailChord, scalePcs, bandMin, bandMax);

    // Phrase start anchor: voice-lead to front chord's guide tones within smooth step reach
    const startTargetPitch = pickClosestFromList(
      blockStartBar === 0 ? initialAnchor : soulGrid[currIdx],
      frontBuckets.questionTones.length > 0 ? frontBuckets.questionTones : frontBuckets.stableTones
    );
    const rawStartIdx = findGridIdx(startTargetPitch);
    const shoegazeMinIdx = Math.max(0, soulGrid.length - 3);
    if (preset === 'melody_shoegaze_float') {
      currIdx = Math.max(shoegazeMinIdx, Math.min(soulGrid.length - 1, Math.max(rawStartIdx, shoegazeMinIdx)));
    } else if (blockStartBar === 0) {
      currIdx =
        preset === 'melody_grunge_drag' || contourShape === 'descending_cascade'
          ? Math.min(Math.max(0, soulGrid.length - 4), rawStartIdx + 2)
          : contourShape === 'ascending_launch'
            ? Math.max(0, Math.min(soulGrid.length - 5, rawStartIdx - 1))
            : Math.min(Math.max(0, soulGrid.length - 4), rawStartIdx);
    } else if (lastWasBigUpLeap) {
      // Gap-fill continuation across bar boundary
      currIdx = Math.max(0, currIdx - 1);
      lastWasBigUpLeap = false;
    } else if (hookDevice === 'call_response_drop' && isAPrime) {
      // Smooth 2-step drop into lower responsive register for Phrase A'
      currIdx = Math.max(0, currIdx - 2);
    } else {
      const startDiff = Math.max(-2, Math.min(2, rawStartIdx - currIdx));
      currIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + startDiff));
    }

    // Phrase landing anchor: Phrase A -> Question (3rd/5th/7th/9th), Phrase A' -> Stable Answer (Root/3rd/5th)
    const endPool = isAPrime ? tailBuckets.stableTones : tailBuckets.questionTones;
    const endAnchorPitch = pickClosestFromList(
      soulGrid[Math.min(soulGrid.length - 1, currIdx + (isAPrime ? 0 : 1))],
      endPool
    );
    const endAnchorIdx = findGridIdx(endAnchorPitch);

    // STAGE 3: Stepwise + Lyric Repetition + 1-Point Climax Leap + Gap-Fill
    const leapMagnitude =
      hookDevice === 'octave_leap'
        ? Math.min(6, Math.max(4, soulGrid.length - 2))
        : preset === 'melody_alt_soar' ||
            preset === 'melody_metalcore_chorus' ||
            preset === 'melody_emo_screamo' ||
            preset === 'melody_anthem_climb'
          ? isAPrime
            ? 5
            : 4
          : isAPrime
            ? 4
            : 3;

    const blockBaseTick = blockStartBar * TICKS_PER_BAR;
    const wordContourForMotif: number[] = [];

    for (let i = 0; i < skeleton.length; i++) {
      const slot = skeleton[i];
      let nextIdx = currIdx;

      if (preset === 'melody_shoegaze_float') {
        const floatStep = slot.role === 'peak' ? 1 : i % 2 === 0 ? 1 : -1;
        nextIdx = Math.max(shoegazeMinIdx, Math.min(soulGrid.length - 1, currIdx + floatStep));
        lastWasBigUpLeap = false;
      } else if (i === 0 && slot.role !== 'peak') {
        nextIdx = currIdx;
        lastWasBigUpLeap = false;
      } else if (slot.role === 'peak') {
        const roomCeiling = soulGrid.length - 1;
        const maxPrePeak = Math.max(0, roomCeiling - 3);
        const baseForLeap = Math.min(currIdx, maxPrePeak);
        const minValidLeap = Math.min(roomCeiling - baseForLeap, 3);
        const chosenLeap = Math.max(minValidLeap, Math.min(leapMagnitude, roomCeiling - baseForLeap));
        nextIdx = Math.min(roomCeiling, baseForLeap + chosenLeap);
        lastWasBigUpLeap = nextIdx - currIdx >= 3;
      } else if (lastWasBigUpLeap) {
        // Strict Gap-Fill principle: immediately after an upward leap, step DOWN (-1..-2 scale steps)
        const desiredStepDown =
          slot.role === 'tail' && Math.abs(endAnchorIdx - currIdx) <= 2 && endAnchorIdx < currIdx
            ? endAnchorIdx - currIdx
            : -1;
        nextIdx = Math.max(0, currIdx + Math.min(-1, desiredStepDown));
        lastWasBigUpLeap = false;
      } else if (slot.role === 'tail') {
        const toEnd = endAnchorIdx - currIdx;
        const clampedToEnd = Math.max(-2, Math.min(2, toEnd));
        nextIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + clampedToEnd));
      } else {
        const prePeakIdx = skeleton.findIndex((s) => s.role === 'peak');
        const beforePeak = prePeakIdx === -1 || i < prePeakIdx;
        const prePeakCap = Math.max(1, soulGrid.length - 4);

        let delta: number;
        if (
          isAPrime &&
          motifARelativeContour &&
          i < motifARelativeContour.length
        ) {
          delta = motifARelativeContour[i];
        } else if (hookDevice === 'machinegun_repeat' && i <= 3) {
          delta = 0; // Rapid syllable lyric repeat before moving
        } else if (contourShape === 'descending_cascade' || preset === 'melody_grunge_drag') {
          delta = i % 3 === 0 ? 0 : -1;
        } else if (contourShape === 'ascending_launch') {
          delta = i % 2 === 0 ? 1 : 0;
        } else if (contourShape === 'wave_pendulum') {
          delta = i % 2 === 1 ? 1 : -1;
        } else if (preset === 'melody_emo_screamo') {
          delta = i % 2 === 0 ? 0 : 1;
        } else if (i % 4 === 1) {
          delta = 0;
        } else if (beforePeak && currIdx >= prePeakCap) {
          delta = -1;
        } else {
          delta = rng.pick([1, 0, 1, -1, 2]);
        }

        delta = Math.max(-2, Math.min(2, delta));
        if (beforePeak && currIdx + delta > prePeakCap && delta > 0) {
          delta = 0;
        }
        nextIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + delta));
        wordContourForMotif.push(nextIdx - currIdx);
      }

      currIdx = nextIdx;
      const pitch = soulGrid[currIdx];
      prevPitch = pitch;

      const isBreathTail =
        slot.role === 'tail' ||
        i === skeleton.length - 1 ||
        (preset === 'melody_emo_screamo' && slot.localTick < TICKS_PER_BAR);

      notes.push({
        pitch,
        velocity: velocityArc(
          currIdx,
          slot.role === 'peak',
          isBreathTail && slot.role !== 'peak'
        ),
        startTick: blockBaseTick + slot.localTick,
        durationTicks: slot.durationTicks,
        channel: TRACK_CHANNELS.vocal,
      });
    }

    if (!isAPrime) {
      motifASkeleton = skeleton;
      motifARelativeContour = wordContourForMotif;
    }
  }

  const baseGeneric = enforceMonophonicAndClip(notes, sectionEnd);
  return applySectionRoleAndChapterPostProcess(
    baseGeneric,
    input,
    modifier,
    scalePcs,
    bandMin,
    bandMax,
    preset,
    roleRng
  );
}

/**
 * Generates diatonic or octave harmony notes from the resolved main Vocal melody.
 */
export function generateVocalHarmonyNotes(
  melodyNotes: readonly MidiNote[],
  key: KeyName,
  scale: ScaleType,
  mode: VocalHarmonyMode
): MidiNote[] {
  if (mode === 'off' || melodyNotes.length === 0) {
    return [];
  }

  const scalePcs = new Set(getScalePitchClasses(key, scale));
  const scaleGrid = buildScaleGrid(scalePcs, 24, 96);

  return melodyNotes.map((n) => {
    let pitch = n.pitch;
    if (mode === 'octave_up') {
      pitch = n.pitch + 12;
      while (pitch > 88) pitch -= 12;
    } else if (mode === 'octave_down') {
      pitch = n.pitch - 12;
      while (pitch < 40) pitch += 12;
    } else {
      const snapped = nearestScalePitch(n.pitch, scalePcs, 24, 96);
      const idx = scaleGrid.indexOf(snapped);
      const stepDelta =
        mode === 'upper_3rd' ? 2 : mode === 'lower_3rd' ? -2 : 4; // upper_5th = +4 scale steps
      if (idx >= 0) {
        const targetIdx = Math.max(
          0,
          Math.min(scaleGrid.length - 1, idx + stepDelta)
        );
        pitch = scaleGrid[targetIdx];
      } else {
        pitch =
          mode === 'upper_3rd'
            ? n.pitch + 4
            : mode === 'lower_3rd'
              ? n.pitch - 4
              : n.pitch + 7;
      }
    }

    return {
      pitch: Math.max(0, Math.min(127, Math.round(pitch))),
      velocity: Math.max(45, Math.min(127, Math.round(n.velocity * 0.82))),
      startTick: n.startTick,
      durationTicks: n.durationTicks,
      channel: TRACK_CHANNELS.vocalHarmony,
    };
  });
}
