import {
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type ChapterInternalForm,
  type ChapterRole,
  type ChordEvent,
  type EightBarScheme,
  type EnergyLevel,
  type ExportTarget,
  type FallExpressionConfig,
  type KeyName,
  type MidiNote,
  type NoteFunctionTag,
  type NoteRole,
  type ScaleType,
  type VocalHarmonyMode,
  type VocalVoiceProfile,
} from '../types/song';
import { getActiveChordAtTick } from '../lib/chordTimeline';
import {
  fitPitchClassToRange,
  getScalePitchClasses,
  noteNameToSemitone,
  type ParsedChord,
} from '../lib/chordUtils';
import {
  normalizeMasterGenreId,
  type MasterGenreId,
} from '../lib/masterGenres';
import { createSeededRng } from '../lib/random';
import { buildSectionChordEvents } from './harmonyEngine';
import {
  computeVocalMinMidiByBar,
  deriveSubSeed,
  resolveVocalVoiceProfile,
} from './musicCore';
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
  type ChapterInternalForm,
  type ChapterRole,
  type EightBarScheme,
  type ExportTarget,
  type FallExpressionConfig,
  type GenreVocalGrammar,
  type NoteFunctionTag,
  type NoteRole,
  type PhrasePlan,
  type PhraseRole,
  type RhythmCell,
  type SyllableSlot,
};

export const TPQN = 480 as const;
export const BEAT_TICKS = TPQN;
export const BAR_TICKS = TPQN * 4;              // 1920 ticks (4/4)
export const PHRASE_2BAR_TICKS = BAR_TICKS * 2; // 3840 ticks
export const CHAPTER_TICKS = BAR_TICKS * 2;     // 3840 ticks
export const EIGHT_BAR_TICKS = CHAPTER_TICKS * 4; // 15360 ticks
export const VOISONA_MIN_GAP_TICKS = 20;

export type MasterGenre = MasterGenreId;

export interface DialecticalChapterPlan {
  readonly chapterIndex: number;
  readonly startTick: number;
  readonly role: ChapterRole;
  readonly form: ChapterInternalForm;
  readonly anchorPitch: number;
  readonly topPitch: number;
  readonly isRunwayToSynthesis: boolean;
  readonly isStrongCadence: boolean;
}

export interface GenreDialecticalProfile {
  readonly chorusTatsProb: number;
  readonly pattern2Prob: number;
  readonly synthesisContinuousProb: number;
  readonly antithesisDropRange: readonly [number, number];
  readonly synthesisReboundRange: readonly [number, number];
  readonly allowSyncopatedPickup: boolean;
  readonly fallSemitones: number;
  readonly maxNotesPerChapter: number;
}

export const GENRE_DIALECTICAL_PROFILES: Record<MasterGenre, GenreDialecticalProfile> = {
  royal_jpop: {
    chorusTatsProb: 0.85,
    pattern2Prob: 0.5,
    synthesisContinuousProb: 0.95,
    antithesisDropRange: [-3, -2],
    synthesisReboundRange: [3, 5],
    allowSyncopatedPickup: true,
    fallSemitones: 2.0,
    maxNotesPerChapter: 12,
  },
  emo_jrock: {
    chorusTatsProb: 0.75,
    pattern2Prob: 0.65,
    synthesisContinuousProb: 0.9,
    antithesisDropRange: [-3, -2],
    synthesisReboundRange: [3, 5],
    allowSyncopatedPickup: true,
    fallSemitones: 2.0,
    maxNotesPerChapter: 13,
  },
  chill_ballad: {
    chorusTatsProb: 0.65,
    pattern2Prob: 0.25,
    synthesisContinuousProb: 1.0,
    antithesisDropRange: [-3, -1],
    synthesisReboundRange: [2, 4],
    allowSyncopatedPickup: false,
    fallSemitones: 2.0,
    maxNotesPerChapter: 11,
  },
  alt_shoegaze: {
    chorusTatsProb: 0.35,
    pattern2Prob: 0.3,
    synthesisContinuousProb: 0.9,
    antithesisDropRange: [-2, -1],
    synthesisReboundRange: [2, 3],
    allowSyncopatedPickup: false,
    fallSemitones: 1.5,
    maxNotesPerChapter: 11,
  },
  numetal_mixture: {
    chorusTatsProb: 0.3,
    pattern2Prob: 0.75,
    synthesisContinuousProb: 0.8,
    antithesisDropRange: [-2, -1],
    synthesisReboundRange: [2, 4],
    allowSyncopatedPickup: true,
    fallSemitones: 2.0,
    maxNotesPerChapter: 12,
  },
};

export interface DialecticalVocalNote extends GeneratedVocalNote {
  readonly pitch: number;
  readonly tag: NoteFunctionTag;
  readonly chapterIndex: number;
}

export interface DialecticalGenerationResult {
  readonly genreId: MasterGenre;
  readonly profile: GenreDialecticalProfile;
  readonly scheme: EightBarScheme;
  readonly thesisForm: ChapterInternalForm;
  readonly chapters: readonly DialecticalChapterPlan[];
  readonly notes: DialecticalVocalNote[];
  readonly midiNotes: MidiNote[];
}

/** MIR-based Pattern 2 core motif similarity metric (used by engine guard & Vitest). */
export function computePattern2CoreSimilarity(
  chapterNotes: readonly { startTick: number; pitch: number }[],
  chapterStartTick: number,
  tolTicks = 60
): { rhythmIoU: number; contourSim: number; combined: number } {
  const core1 = chapterNotes
    .map((n) => ({ rel: n.startTick - chapterStartTick, pitch: n.pitch }))
    .filter((n) => n.rel >= 0 && n.rel < 1440);

  const core2 = chapterNotes
    .map((n) => ({
      rel: n.startTick - chapterStartTick - BAR_TICKS,
      pitch: n.pitch,
    }))
    .filter((n) => n.rel >= 0 && n.rel < 1440);

  if (core1.length === 0 || core2.length === 0) {
    return { rhythmIoU: 0, contourSim: 0, combined: 0 };
  }

  const used2 = new Set<number>();
  const matched: Array<[(typeof core1)[number], (typeof core2)[number]]> = [];

  for (const n1 of core1) {
    let bestJ = -1;
    let bestDt = tolTicks + 1;
    for (let j = 0; j < core2.length; j++) {
      if (used2.has(j)) continue;
      const dt = Math.abs(n1.rel - core2[j].rel);
      if (dt <= tolTicks && dt < bestDt) {
        bestDt = dt;
        bestJ = j;
      }
    }
    if (bestJ !== -1) {
      used2.add(bestJ);
      matched.push([n1, core2[bestJ]]);
    }
  }

  const rhythmIoU = matched.length / (core1.length + core2.length - matched.length);

  let contourSim = 0;
  if (matched.length >= 2) {
    let ivMatch = 0;
    for (let k = 0; k < matched.length - 1; k++) {
      const iv1 = matched[k + 1][0].pitch - matched[k][0].pitch;
      const iv2 = matched[k + 1][1].pitch - matched[k][1].pitch;
      if (iv1 === iv2 || (iv1 * iv2 > 0 && Math.abs(iv1 - iv2) <= 1)) {
        ivMatch++;
      }
    }
    contourSim = ivMatch / (matched.length - 1);
  }

  return {
    rhythmIoU,
    contourSim,
    combined: 0.55 * rhythmIoU + 0.45 * contourSim,
  };
}

export const VOCAL_MIN_PITCH = 48; // C3
export const VOCAL_MAX_PITCH = 76; // E5

export interface RhythmGateCell {
  readonly startTick: number;
  readonly gridDuration: number;
  readonly gateRatio: number;
  readonly role: NoteRole;
  readonly velocityScale: number;
}

export interface PitchBendEvent {
  readonly tick: number;
  readonly value14Bit: number;
  readonly semitoneOffset: number;
}

export interface GeneratedVocalNote {
  readonly startTick: number;
  readonly gridDuration: number;
  readonly gateDuration: number;
  readonly midiPitch: number;
  readonly velocity: number;
  readonly role: NoteRole;
  readonly hasFall: boolean;
  readonly fallConfig?: FallExpressionConfig;
}

export type NormalizedSectionRole =
  | 'verse'
  | 'pre_chorus'
  | 'chorus'
  | 'bridge'
  | 'instrumental';

export interface PitchTrajectoryPhrasePlan {
  readonly phraseIndex: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly anchorOffsetSemitones: number;
  readonly plannedAnchorPitch: number;
  readonly isRunway: boolean;
  readonly motifSourcePhraseIndex?: number;
}

export interface PitchTrajectoryPlan {
  readonly genreId: MasterGenreId;
  readonly sectionRole: NormalizedSectionRole;
  readonly sectionShiftSemitones: number;
  readonly baseAnchorPitch: number;
  readonly phrases: readonly PitchTrajectoryPhrasePlan[];
}

export interface RhythmFirstGenreProfile {
  readonly genreId: MasterGenreId;
  readonly label: string;
  readonly sectionShifts: Readonly<Record<NormalizedSectionRole, number>>;
  readonly baseGateRatio: number;
  readonly minRestAndGateOffRatio: number;
  readonly minDurationContrast: number;
  readonly maxUniquePitchesPerPhrase: number;
  readonly maxRiseFromOnset: number;
  readonly maxPhraseAmbitus: number;
  readonly samePitchRepeatBias: number;
  readonly maxAdjacentTessituraJump: number;
  readonly maxAdjacentTopNoteJump: number;
  readonly maxPhraseEndUpwardLeap: number;
  readonly fallConfig: FallExpressionConfig;
  readonly templates2Bar: readonly (readonly RhythmGateCell[])[];
  readonly sparseTemplate2Bar: readonly RhythmGateCell[];
  readonly denseTemplate2Bar: readonly RhythmGateCell[];
}

// Legacy compatibility types exported for vocalRhythmCells.ts & callers
export type MelodyStyleProfileId =
  | 'alt_hypnotic'
  | 'deftones_float'
  | 'posthc_leap'
  | 'jrock_drive'
  | 'jpop_anthem'
  | 'linkin_hybrid'
  | 'rap_mixture_flow';

export type ChapterMiddleType =
  | 'stay_rhythm'
  | 'stay_float'
  | 'dip_arch'
  | 'rap_flow';

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

function cell(
  startTick: number,
  gridDuration: number,
  gateRatio: number,
  role: NoteRole,
  velocityScale = 1.0
): RhythmGateCell {
  return { startTick, gridDuration, gateRatio, role, velocityScale };
}

/**
 * Canonical 5 Master Genre Rhythm-First Vocal Profiles.
 * Separates pure breath rests (>= 240t) from gate Ratio articulation (0.55..0.95).
 */
export const RHYTHM_FIRST_GENRE_PROFILES: Readonly<
  Record<MasterGenreId, RhythmFirstGenreProfile>
> = {
  alt_shoegaze: {
    genreId: 'alt_shoegaze',
    label: 'ロングトーン解放型',
    sectionShifts: {
      verse: 0,
      pre_chorus: 2,
      chorus: 4,
      bridge: 3,
      instrumental: 0,
    },
    baseGateRatio: 0.9,
    minRestAndGateOffRatio: 0.28,
    minDurationContrast: 2.5,
    maxUniquePitchesPerPhrase: 4,
    maxRiseFromOnset: 4,
    maxPhraseAmbitus: 5,
    samePitchRepeatBias: 0.4,
    maxAdjacentTessituraJump: 3.5,
    maxAdjacentTopNoteJump: 4,
    maxPhraseEndUpwardLeap: 2,
    fallConfig: {
      probability: 0.65,
      minGridDurationTicks: 720,
      minTrailingRestTicks: 240,
      bendRangeSemitones: 4,
      dropSemitones: 3.5,
      fallDurationRatio: 0.38,
      curveSteps: 6,
      resetMarginTicks: 15,
    },
    templates2Bar: [
      [
        cell(240, 240, 0.86, 'pickup', 0.86),
        cell(480, 480, 0.9, 'anchor', 0.96),
        cell(960, 720, 0.92, 'sync_tie', 1.0),
        cell(1920, 360, 0.88, 'step', 0.92),
        cell(2280, 1080, 0.92, 'top_fall', 1.05),
      ],
      [
        cell(0, 360, 0.88, 'anchor', 0.95),
        cell(360, 360, 0.88, 'step', 0.9),
        cell(720, 720, 0.92, 'sync_tie', 1.02),
        cell(1920, 240, 0.85, 'pickup', 0.88),
        cell(2160, 960, 0.92, 'top_fall', 1.06),
      ],
      [
        cell(480, 240, 0.86, 'pickup', 0.88),
        cell(720, 480, 0.9, 'sync_tie', 0.96),
        cell(1200, 480, 0.9, 'step', 0.94),
        cell(1920, 240, 0.86, 'step', 0.92),
        cell(2160, 1200, 0.93, 'top_fall', 1.06),
      ],
    ],
    sparseTemplate2Bar: [
      cell(240, 360, 0.88, 'pickup', 0.86),
      cell(600, 1080, 0.92, 'anchor', 0.98),
      cell(1920, 1200, 0.92, 'top_fall', 1.04),
    ],
    denseTemplate2Bar: [
      cell(0, 240, 0.82, 'anchor', 0.94),
      cell(240, 240, 0.8, 'step', 0.88),
      cell(480, 240, 0.82, 'step', 0.92),
      cell(720, 480, 0.88, 'sync_tie', 0.98),
      cell(1200, 240, 0.8, 'step', 0.9),
      cell(1440, 240, 0.8, 'pickup', 0.9),
      cell(1920, 240, 0.82, 'step', 0.92),
      cell(2160, 240, 0.82, 'step', 0.94),
      cell(2400, 840, 0.9, 'top_fall', 1.05),
    ],
  },

  emo_jrock: {
    genreId: 'emo_jrock',
    label: 'タメ→詰め型',
    sectionShifts: {
      verse: 0,
      pre_chorus: 3,
      chorus: 6,
      bridge: 4,
      instrumental: 0,
    },
    baseGateRatio: 0.8,
    minRestAndGateOffRatio: 0.25,
    minDurationContrast: 2.0,
    maxUniquePitchesPerPhrase: 5,
    maxRiseFromOnset: 5,
    maxPhraseAmbitus: 7,
    samePitchRepeatBias: 0.35,
    maxAdjacentTessituraJump: 4.0,
    maxAdjacentTopNoteJump: 5,
    maxPhraseEndUpwardLeap: 2,
    fallConfig: {
      probability: 0.45,
      minGridDurationTicks: 480,
      minTrailingRestTicks: 240,
      bendRangeSemitones: 2,
      dropSemitones: 2.0,
      fallDurationRatio: 0.36,
      curveSteps: 6,
      resetMarginTicks: 15,
    },
    templates2Bar: [
      [
        cell(0, 480, 0.82, 'anchor', 0.98),
        cell(480, 240, 0.76, 'rush', 0.9),
        cell(720, 240, 0.78, 'rush', 0.94),
        cell(960, 240, 0.76, 'rush', 0.92),
        cell(1200, 480, 0.82, 'hook_stab', 1.0),
        cell(1920, 240, 0.78, 'rush', 0.95),
        cell(2160, 240, 0.78, 'step', 0.96),
        cell(2400, 960, 0.85, 'top_fall', 1.08),
      ],
      [
        cell(240, 480, 0.82, 'pickup', 0.94),
        cell(720, 480, 0.82, 'sync_tie', 1.0),
        cell(1200, 240, 0.75, 'rush', 0.92),
        cell(1440, 240, 0.75, 'rush', 0.94),
        cell(1680, 480, 0.84, 'sync_tie', 1.04),
        cell(2160, 240, 0.76, 'step', 0.94),
        cell(2400, 240, 0.78, 'step', 0.96),
        cell(2640, 720, 0.85, 'top_fall', 1.08),
      ],
      [
        cell(0, 240, 0.75, 'hook_stab', 1.0),
        cell(240, 240, 0.75, 'rush', 0.9),
        cell(480, 480, 0.82, 'anchor', 0.98),
        cell(1200, 240, 0.76, 'rush', 0.92),
        cell(1440, 240, 0.76, 'rush', 0.95),
        cell(1920, 480, 0.82, 'anchor', 1.0),
        cell(2400, 240, 0.76, 'step', 0.94),
        cell(2640, 720, 0.85, 'top_fall', 1.08),
      ],
    ],
    sparseTemplate2Bar: [
      cell(0, 480, 0.82, 'anchor', 0.96),
      cell(720, 960, 0.84, 'sync_tie', 1.0),
      cell(1920, 1200, 0.86, 'top_fall', 1.06),
    ],
    denseTemplate2Bar: [
      cell(0, 240, 0.72, 'hook_stab', 0.98),
      cell(240, 240, 0.7, 'rush', 0.9),
      cell(480, 240, 0.72, 'rush', 0.94),
      cell(720, 240, 0.72, 'sync_tie', 0.96),
      cell(960, 240, 0.72, 'rush', 0.94),
      cell(1200, 240, 0.7, 'rush', 0.9),
      cell(1440, 240, 0.72, 'rush', 0.92),
      cell(1680, 240, 0.76, 'pickup', 0.98),
      cell(1920, 240, 0.74, 'step', 0.96),
      cell(2160, 240, 0.74, 'step', 0.96),
      cell(2400, 720, 0.84, 'top_fall', 1.08),
    ],
  },

  numetal_mixture: {
    genreId: 'numetal_mixture',
    label: 'タイト急停止型',
    sectionShifts: {
      verse: 0,
      pre_chorus: 2,
      chorus: 5,
      bridge: 3,
      instrumental: 0,
    },
    baseGateRatio: 0.72,
    minRestAndGateOffRatio: 0.32,
    minDurationContrast: 2.0,
    maxUniquePitchesPerPhrase: 3,
    maxRiseFromOnset: 3,
    maxPhraseAmbitus: 4,
    samePitchRepeatBias: 0.55,
    maxAdjacentTessituraJump: 3.5,
    maxAdjacentTopNoteJump: 4,
    maxPhraseEndUpwardLeap: 2,
    fallConfig: {
      probability: 0.75,
      minGridDurationTicks: 480,
      minTrailingRestTicks: 240,
      bendRangeSemitones: 4,
      dropSemitones: 3.5,
      fallDurationRatio: 0.4,
      curveSteps: 6,
      resetMarginTicks: 15,
    },
    templates2Bar: [
      [
        cell(0, 240, 0.68, 'hook_stab', 1.02),
        cell(240, 240, 0.65, 'rush', 0.9),
        cell(480, 240, 0.7, 'hook_stab', 0.98),
        cell(720, 240, 0.65, 'rush', 0.9),
        cell(960, 480, 0.72, 'hard_cut', 1.04),
        cell(1920, 240, 0.68, 'hook_stab', 1.0),
        cell(2160, 240, 0.68, 'rush', 0.92),
        cell(2400, 720, 0.78, 'top_fall', 1.1),
      ],
      [
        cell(0, 240, 0.68, 'hook_stab', 1.02),
        cell(240, 240, 0.65, 'rush', 0.88),
        cell(480, 480, 0.74, 'hard_cut', 1.02),
        cell(1200, 240, 0.68, 'rush', 0.94),
        cell(1920, 240, 0.68, 'hook_stab', 1.0),
        cell(2160, 240, 0.66, 'rush', 0.92),
        cell(2400, 240, 0.7, 'step', 0.96),
        cell(2640, 600, 0.78, 'top_fall', 1.1),
      ],
      [
        cell(0, 180, 0.68, 'rush', 0.96),
        cell(180, 180, 0.68, 'rush', 0.9),
        cell(360, 360, 0.72, 'hook_stab', 1.02),
        cell(720, 480, 0.74, 'hard_cut', 1.04),
        cell(1920, 240, 0.68, 'hook_stab', 0.98),
        cell(2160, 240, 0.68, 'rush', 0.94),
        cell(2400, 720, 0.8, 'top_fall', 1.1),
      ],
    ],
    sparseTemplate2Bar: [
      cell(0, 360, 0.7, 'hook_stab', 1.0),
      cell(360, 720, 0.74, 'hard_cut', 1.02),
      cell(1920, 240, 0.68, 'hook_stab', 0.98),
      cell(2160, 840, 0.78, 'top_fall', 1.08),
    ],
    denseTemplate2Bar: [
      cell(0, 180, 0.67, 'rush', 0.98),
      cell(180, 180, 0.67, 'rush', 0.9),
      cell(360, 180, 0.67, 'rush', 0.92),
      cell(540, 180, 0.67, 'rush', 0.92),
      cell(720, 480, 0.72, 'hard_cut', 1.04),
      cell(1920, 180, 0.67, 'rush', 0.96),
      cell(2100, 180, 0.67, 'rush', 0.92),
      cell(2280, 240, 0.68, 'hook_stab', 0.98),
      cell(2520, 600, 0.78, 'top_fall', 1.1),
    ],
  },

  royal_jpop: {
    genreId: 'royal_jpop',
    label: 'シンコペーション伸縮型',
    sectionShifts: {
      verse: 0,
      pre_chorus: 3,
      chorus: 7,
      bridge: 5,
      instrumental: 0,
    },
    baseGateRatio: 0.85,
    minRestAndGateOffRatio: 0.22,
    minDurationContrast: 2.5,
    maxUniquePitchesPerPhrase: 6,
    maxRiseFromOnset: 5,
    maxPhraseAmbitus: 9,
    samePitchRepeatBias: 0.28,
    maxAdjacentTessituraJump: 4.5,
    maxAdjacentTopNoteJump: 5,
    maxPhraseEndUpwardLeap: 2,
    fallConfig: {
      probability: 0.35,
      minGridDurationTicks: 480,
      minTrailingRestTicks: 240,
      bendRangeSemitones: 2,
      dropSemitones: 2.0,
      fallDurationRatio: 0.35,
      curveSteps: 6,
      resetMarginTicks: 15,
    },
    templates2Bar: [
      [
        cell(0, 240, 0.82, 'anchor', 0.98),
        cell(240, 240, 0.8, 'step', 0.9),
        cell(480, 240, 0.82, 'step', 0.94),
        cell(720, 480, 0.86, 'sync_tie', 1.02),
        cell(1200, 480, 0.85, 'anchor', 0.96),
        cell(1920, 240, 0.82, 'pickup', 0.95),
        cell(2160, 240, 0.82, 'step', 0.96),
        cell(2400, 960, 0.88, 'top_fall', 1.08),
      ],
      [
        cell(240, 240, 0.8, 'pickup', 0.9),
        cell(480, 480, 0.85, 'anchor', 0.98),
        cell(960, 240, 0.82, 'step', 0.92),
        cell(1200, 480, 0.85, 'sync_tie', 0.98),
        cell(1680, 480, 0.86, 'sync_tie', 1.04),
        cell(2160, 240, 0.82, 'step', 0.94),
        cell(2400, 960, 0.88, 'top_fall', 1.08),
      ],
      [
        cell(0, 360, 0.84, 'hook_stab', 1.0),
        cell(360, 360, 0.84, 'sync_tie', 0.96),
        cell(720, 240, 0.8, 'step', 0.9),
        cell(960, 480, 0.86, 'anchor', 0.98),
        cell(1920, 240, 0.82, 'pickup', 0.94),
        cell(2160, 240, 0.82, 'step', 0.96),
        cell(2400, 1080, 0.88, 'top_fall', 1.08),
      ],
    ],
    sparseTemplate2Bar: [
      cell(0, 360, 0.85, 'anchor', 0.96),
      cell(360, 1080, 0.9, 'sync_tie', 1.0),
      cell(1920, 1200, 0.9, 'top_fall', 1.06),
    ],
    denseTemplate2Bar: [
      cell(0, 240, 0.72, 'anchor', 0.96),
      cell(240, 240, 0.72, 'step', 0.9),
      cell(480, 240, 0.72, 'step', 0.92),
      cell(720, 240, 0.74, 'sync_tie', 0.96),
      cell(960, 240, 0.72, 'step', 0.94),
      cell(1200, 240, 0.72, 'step', 0.9),
      cell(1440, 240, 0.72, 'pickup', 0.92),
      cell(1920, 240, 0.74, 'step', 0.96),
      cell(2160, 240, 0.74, 'step', 0.96),
      cell(2400, 840, 0.86, 'top_fall', 1.08),
    ],
  },

  chill_ballad: {
    genreId: 'chill_ballad',
    label: 'ブレス浮遊型',
    sectionShifts: {
      verse: 0,
      pre_chorus: 2,
      chorus: 5,
      bridge: 3,
      instrumental: 0,
    },
    baseGateRatio: 0.92,
    minRestAndGateOffRatio: 0.35,
    minDurationContrast: 3.0,
    maxUniquePitchesPerPhrase: 5,
    maxRiseFromOnset: 5,
    maxPhraseAmbitus: 7,
    samePitchRepeatBias: 0.38,
    maxAdjacentTessituraJump: 3.5,
    maxAdjacentTopNoteJump: 4,
    maxPhraseEndUpwardLeap: 1,
    fallConfig: {
      probability: 0.5,
      minGridDurationTicks: 720,
      minTrailingRestTicks: 240,
      bendRangeSemitones: 2,
      dropSemitones: 1.5,
      fallDurationRatio: 0.38,
      curveSteps: 6,
      resetMarginTicks: 15,
    },
    templates2Bar: [
      [
        cell(240, 240, 0.88, 'pickup', 0.84),
        cell(480, 480, 0.92, 'anchor', 0.92),
        cell(960, 480, 0.92, 'step', 0.9),
        cell(1920, 240, 0.88, 'step', 0.88),
        cell(2160, 960, 0.94, 'top_fall', 1.0),
      ],
      [
        cell(0, 480, 0.92, 'anchor', 0.92),
        cell(480, 240, 0.88, 'step', 0.86),
        cell(720, 720, 0.93, 'sync_tie', 0.96),
        cell(1920, 960, 0.94, 'top_fall', 1.0),
      ],
      [
        cell(480, 240, 0.88, 'pickup', 0.84),
        cell(720, 480, 0.92, 'anchor', 0.92),
        cell(1920, 240, 0.88, 'step', 0.88),
        cell(2160, 240, 0.88, 'step', 0.9),
        cell(2400, 960, 0.94, 'top_fall', 1.02),
      ],
    ],
    sparseTemplate2Bar: [
      cell(480, 360, 0.9, 'pickup', 0.84),
      cell(1920, 1200, 0.94, 'top_fall', 0.98),
    ],
    denseTemplate2Bar: [
      cell(0, 240, 0.85, 'anchor', 0.9),
      cell(240, 240, 0.84, 'step', 0.86),
      cell(480, 240, 0.85, 'step', 0.88),
      cell(720, 480, 0.9, 'sync_tie', 0.94),
      cell(1920, 240, 0.85, 'pickup', 0.88),
      cell(2160, 240, 0.85, 'step', 0.9),
      cell(2400, 780, 0.92, 'top_fall', 1.0),
    ],
  },
};

export interface MelodyStyleProfile {
  id: MelodyStyleProfileId;
  masterGenreId: MasterGenreId;
  grammar: GenreVocalGrammar;
}

export const MELODY_STYLE_PROFILES: Record<MelodyStyleProfileId, MelodyStyleProfile> = {
  alt_hypnotic: {
    id: 'alt_hypnotic',
    masterGenreId: 'alt_shoegaze',
    grammar: GENRE_VOCAL_GRAMMARS.alt_hypnotic,
  },
  deftones_float: {
    id: 'deftones_float',
    masterGenreId: 'alt_shoegaze',
    grammar: GENRE_VOCAL_GRAMMARS.deftones_float,
  },
  posthc_leap: {
    id: 'posthc_leap',
    masterGenreId: 'emo_jrock',
    grammar: GENRE_VOCAL_GRAMMARS.posthc_leap,
  },
  jrock_drive: {
    id: 'jrock_drive',
    masterGenreId: 'emo_jrock',
    grammar: GENRE_VOCAL_GRAMMARS.jrock_drive,
  },
  jpop_anthem: {
    id: 'jpop_anthem',
    masterGenreId: 'royal_jpop',
    grammar: GENRE_VOCAL_GRAMMARS.jpop_anthem,
  },
  linkin_hybrid: {
    id: 'linkin_hybrid',
    masterGenreId: 'numetal_mixture',
    grammar: GENRE_VOCAL_GRAMMARS.linkin_hybrid,
  },
  rap_mixture_flow: {
    id: 'rap_mixture_flow',
    masterGenreId: 'numetal_mixture',
    grammar: GENRE_VOCAL_GRAMMARS.rap_mixture_flow,
  },
};

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
  const isLinear = rng() < 0.55;
  const isBreak = rng() < 0.5;
  if (role === 'pre_chorus') {
    return {
      role: 'pre_chorus',
      pitchBiasSemitones: 2,
      timingOffset: 0,
      articulation: 0.75,
      restRatioTarget: 0.28,
      landingDurationRange: [720, 960],
      pickupProbability: 0.5,
      preChorusMode: isLinear ? 'linear_push' : 'dip_hold',
      preChorusBreakStyle: isBreak ? 'silence_break' : 'long_hold',
    };
  }
  if (role === 'chorus') {
    return {
      role: 'chorus',
      pitchBiasSemitones: 5,
      timingOffset: 0,
      articulation: 0.88,
      restRatioTarget: 0.25,
      landingDurationRange: [720, 1200],
      pickupProbability: 0.35,
    };
  }
  if (role === 'bridge') {
    const isOtoshisabi =
      energy === 'Low' || (sectionName ?? '').includes('落ちサビ');
    return {
      role: 'bridge',
      pitchBiasSemitones: 3,
      timingOffset: 0,
      articulation: isOtoshisabi ? 0.6 : 0.9,
      restRatioTarget: 0.35,
      landingDurationRange: [720, 1200],
      pickupProbability: 0.4,
      bridgeMode: isOtoshisabi ? 'otoshisabi' : 'overshoot',
    };
  }
  return {
    role,
    pitchBiasSemitones: 0,
    timingOffset: 0,
    articulation: 0.7,
    restRatioTarget: 0.32,
    landingDurationRange: [480, 960],
    pickupProbability: 0.3,
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
  const chapterBars = 2;
  const totalChapters = Math.max(1, Math.ceil(bars / chapterBars));
  const plans: ChapterPlan[] = [];

  for (let c = 0; c < totalChapters; c++) {
    const startTick = c * PHRASE_2BAR_TICKS;
    const endTick = Math.min(bars * BAR_TICKS, startTick + PHRASE_2BAR_TICKS);
    const len = endTick - startTick;
    plans.push({
      chapterIndex: c,
      startTick,
      endTick,
      headRange: [startTick, Math.min(endTick, startTick + 960)],
      middleRange: [
        Math.min(endTick, startTick + 960),
        Math.min(endTick, startTick + 2400),
      ],
      endingRange: [
        Math.min(endTick, startTick + Math.floor(len * 0.62)),
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

/**
 * Maps any vocal preset ID, legacy genre ID, or SongConfig metadata onto one of the 5 MasterGenreIds.
 */
export function resolveMasterGenreForVocal(
  inputOrPreset: EngineInput | string
): MasterGenreId {
  if (typeof inputOrPreset === 'string') {
    return mapPresetStringToGenre(inputOrPreset);
  }
  if (inputOrPreset.masterGenreId) {
    return normalizeMasterGenreId(inputOrPreset.masterGenreId);
  }

  const { song, section } = inputOrPreset;
  const preset = (
    section.patternPresets?.vocal ??
    section.partPresets?.vocal ??
    song.members.vocal?.patternPreset ??
    'auto'
  ).trim();

  if (preset && preset !== 'auto') {
    return mapPresetStringToGenre(preset);
  }

  const titleAndInst = `${song.title} ${song.members.keyboard?.instructionText ?? ''} ${song.members.pad?.instructionText ?? ''}`.toLowerCase();
  if (
    titleAndInst.includes('オルタナ') ||
    titleAndInst.includes('シューゲイザー') ||
    titleAndInst.includes('shoegaze') ||
    titleAndInst.includes('deftones') ||
    song.beatFeel === 'Half-Time'
  ) {
    return 'alt_shoegaze';
  }
  if (
    titleAndInst.includes('ミクスチャー') ||
    titleAndInst.includes('mixture') ||
    song.sections.some((s) => s.kickMode === '808')
  ) {
    return 'numetal_mixture';
  }
  if (
    titleAndInst.includes('バラード') ||
    titleAndInst.includes('チル') ||
    titleAndInst.includes('ballad') ||
    song.bpm <= 96 ||
    song.beatFeel === 'Bounce'
  ) {
    return 'chill_ballad';
  }
  if (
    titleAndInst.includes('エモ') ||
    titleAndInst.includes('j-rock') ||
    song.beatFeel === 'Driving' ||
    song.bpm >= 156
  ) {
    return 'emo_jrock';
  }
  return 'royal_jpop';
}

function mapPresetStringToGenre(preset: string): MasterGenreId {
  switch (preset) {
    case 'alt_shoegaze':
    case 'alt_heavy_shoegaze':
    case 'shoegaze':
    case 'melody_alt_hypnotic':
    case 'melody_deftones_float':
    case 'melody_shoegaze_float':
    case 'melody_alt_minor':
    case 'melody_alt_soar':
    case 'melody_grunge_drag':
    case 'alt_hypnotic':
    case 'deftones_float':
      return 'alt_shoegaze';

    case 'emo_jrock':
    case 'emo_jrock_fast':
    case 'metal3Piece':
    case 'melody_jrock_drive':
    case 'melody_posthc_leap':
    case 'melody_emo_screamo':
    case 'melody_metalcore_chorus':
    case 'melody_staccato_rock':
    case 'jrock_anticipation':
    case 'jrock_drive':
    case 'posthc_leap':
      return 'emo_jrock';

    case 'numetal_mixture':
    case 'trapHybrid':
    case 'rap_linkin_hybrid':
    case 'linkin_hybrid':
      return 'numetal_mixture';

    case 'chill_ballad':
    case 'chill_lofi_ballad':
    case 'melody_ballad':
    case 'melody_ballad_breath':
      return 'chill_ballad';

    case 'royal_jpop':
    case 'rockBand':
    case 'melody_jpop_anthem':
    case 'melody_pop':
    case 'melody_soar_long':
    case 'melody_syncopated_hook':
    case 'melody_call_response':
    case 'melody_britpop_catchy':
    case 'melody_anthem_climb':
    case 'melody_staccato_chop':
    case 'jpop_anthem':
    default:
      return normalizeMasterGenreId(preset);
  }
}

export function computeWeightedTessitura(
  notes: readonly GeneratedVocalNote[]
): number {
  let num = 0;
  let den = 0;
  for (const n of notes) {
    num += n.midiPitch * n.gridDuration;
    den += n.gridDuration;
  }
  return den > 0 ? num / den : 60;
}

export function buildFallPitchBendEvents(
  note: GeneratedVocalNote,
  nextNoteStartTick: number
): PitchBendEvent[] {
  if (!note.hasFall || !note.fallConfig) return [];
  const cfg = note.fallConfig;
  const fallDur = Math.max(60, Math.round(note.gateDuration * cfg.fallDurationRatio));
  const noteOffTick = note.startTick + note.gateDuration;
  const fallStart = noteOffTick - fallDur;
  const events: PitchBendEvent[] = [
    { tick: fallStart, value14Bit: 8192, semitoneOffset: 0 },
  ];

  for (let s = 1; s <= cfg.curveSteps; s++) {
    const t = s / cfg.curveSteps;
    const tick = fallStart + Math.round(fallDur * t);
    const semi = -cfg.dropSemitones * (t * t * t); // Cubic Ease-In
    const val = Math.max(
      0,
      Math.min(16383, Math.round(8192 + (semi / cfg.bendRangeSemitones) * 8191))
    );
    events.push({ tick, value14Bit: val, semitoneOffset: semi });
  }

  const resetTick = Math.min(
    noteOffTick + cfg.resetMarginTicks,
    nextNoteStartTick - 10
  );
  events.push({
    tick: Math.max(noteOffTick + 1, resetTick),
    value14Bit: 8192,
    semitoneOffset: 0,
  });
  return events;
}

export const VOISONA_QUANTIZE_TICKS = 60 as const;

export function validateVoisonaVocalNotes(
  notes: readonly { startTick: number; durationTicks: number }[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (let i = 0; i < notes.length; i++) {
    const curr = notes[i];
    if (curr.startTick % VOISONA_QUANTIZE_TICKS !== 0) {
      errors.push(
        `Note ${i} startTick (${curr.startTick}) is not quantized to ${VOISONA_QUANTIZE_TICKS} ticks`
      );
    }
    if (
      curr.durationTicks < VOISONA_QUANTIZE_TICKS ||
      curr.durationTicks % VOISONA_QUANTIZE_TICKS !== 0
    ) {
      errors.push(
        `Note ${i} durationTicks (${curr.durationTicks}) is not a positive multiple of ${VOISONA_QUANTIZE_TICKS} ticks`
      );
    }
    if (i + 1 < notes.length) {
      const next = notes[i + 1];
      const end = curr.startTick + curr.durationTicks;
      if (end > next.startTick) {
        errors.push(
          `Note ${i} (${curr.startTick}..${end}) overlaps Note ${i + 1} (${next.startTick})`
        );
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function adaptNotesForExportTarget(
  notes: readonly GeneratedVocalNote[],
  target: ExportTarget
): { notes: GeneratedVocalNote[]; pitchBends: PitchBendEvent[] } {
  if (target === 'voisona_clean_smf') {
    const BREATH_THRESHOLD_TICKS = 180;
    const Q = VOISONA_QUANTIZE_TICKS; // 60 ticks (1/32 note at 480 TPQN)
    if (notes.length === 0) {
      return { notes: [], pitchBends: [] };
    }

    // 1. Snap startTicks to strict 60-tick grid and deduplicate any colliding starts
    const snappedStarts: Array<{ src: GeneratedVocalNote; qStart: number }> = [];
    for (const n of notes) {
      const qStart = Math.max(0, Math.round(n.startTick / Q) * Q);
      if (
        snappedStarts.length > 0 &&
        qStart <= snappedStarts[snappedStarts.length - 1].qStart
      ) {
        const prevStart = snappedStarts[snappedStarts.length - 1].qStart;
        // Shift by +60 if room exists before next note, else skip duplicate onset
        const shifted = prevStart + Q;
        if (n.startTick + n.gridDuration > shifted) {
          snappedStarts.push({ src: n, qStart: shifted });
        }
        continue;
      }
      snappedStarts.push({ src: n, qStart });
    }

    // 2. Snap durations to multiples of 60 ticks, glue micro-gaps < 180t, and guarantee zero overlap
    const cleanNotes: GeneratedVocalNote[] = snappedStarts.map((item, i) => {
      const { src, qStart } = item;
      const next = snappedStarts[i + 1];
      const qGrid = Math.max(120, Math.round(src.gridDuration / Q) * Q);
      if (!next) {
        return {
          ...src,
          startTick: qStart,
          gridDuration: qGrid,
          gateDuration: qGrid,
          hasFall: false,
          fallConfig: undefined,
        };
      }

      const availSpan = Math.max(Q, next.qStart - qStart);
      if (availSpan <= 180) {
        // Span is <= 180 ticks: glue directly to next onset with zero gap & zero overlap
        return {
          ...src,
          startTick: qStart,
          gridDuration: availSpan,
          gateDuration: availSpan,
          hasFall: false,
          fallConfig: undefined,
        };
      }

      const rawGap = next.qStart - (qStart + qGrid);
      let finalDur: number;
      if (rawGap < BREATH_THRESHOLD_TICKS) {
        // Micro-gap < 180 ticks -> legato glue to next note onset
        finalDur = availSpan;
      } else {
        // Pure breath gap >= 180 ticks -> preserve quantized duration (multiple of 60)
        finalDur = Math.max(120, Math.min(qGrid, availSpan - BREATH_THRESHOLD_TICKS));
        finalDur = Math.max(Q, Math.floor(finalDur / Q) * Q);
      }

      return {
        ...src,
        startTick: qStart,
        gridDuration: Math.max(finalDur, Math.min(qGrid, availSpan)),
        gateDuration: finalDur,
        hasFall: false,
        fallConfig: undefined,
      };
    });

    return { notes: cleanNotes, pitchBends: [] };
  }

  if (target === 'cubase_smf_expressive') {
    const pitchBends: PitchBendEvent[] = [];
    for (let i = 0; i < notes.length; i++) {
      const nextStart =
        i + 1 < notes.length ? notes[i + 1].startTick : notes[i].startTick + 960;
      pitchBends.push(...buildFallPitchBendEvents(notes[i], nextStart));
    }
    return { notes: [...notes], pitchBends };
  }

  const expanded: GeneratedVocalNote[] = [];
  for (const n of notes) {
    if (n.hasFall && n.gateDuration >= 360) {
      const tailDur = 120;
      expanded.push({
        ...n,
        gateDuration: n.gateDuration - tailDur,
        hasFall: false,
        fallConfig: undefined,
      });
      expanded.push({
        ...n,
        startTick: n.startTick + n.gateDuration - tailDur,
        gridDuration: tailDur,
        gateDuration: tailDur - 15,
        midiPitch: Math.max(VOCAL_MIN_PITCH, n.midiPitch - 2),
        velocity: Math.max(1, Math.round(n.velocity * 0.6)),
        hasFall: false,
        fallConfig: undefined,
      });
    } else {
      expanded.push({ ...n, hasFall: false, fallConfig: undefined });
    }
  }
  return { notes: expanded, pitchBends: [] };
}

export function scheduleWebAudioFall(
  osc: OscillatorNode,
  noteStartSec: number,
  gateDurationSec: number,
  cfg: FallExpressionConfig
): void {
  const fallSec = gateDurationSec * cfg.fallDurationRatio;
  const fallStartSec = noteStartSec + gateDurationSec - fallSec;
  const samples = 32;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    curve[i] = -cfg.dropSemitones * 100 * (t * t * t);
  }
  osc.detune.setValueAtTime(0, noteStartSec);
  osc.detune.setValueCurveAtTime(curve, fallStartSec, fallSec);
  osc.detune.setValueAtTime(0, noteStartSec + gateDurationSec + 0.005);
}

export function toMidiNotesFromGenerated(
  notes: readonly GeneratedVocalNote[]
): MidiNote[] {
  return notes.map((n) => ({
    pitch: n.midiPitch,
    velocity: clampVelocity(n.velocity),
    startTick: n.startTick,
    durationTicks: n.gateDuration,
    channel: TRACK_CHANNELS.vocal,
    gridDurationTicks: n.gridDuration,
    role: n.role,
    hasFall: n.hasFall,
    ...(n.hasFall && n.fallConfig ? { fallConfig: { ...n.fallConfig } } : {}),
  }));
}

export function toGeneratedVocalNotes(
  midiNotes: readonly MidiNote[]
): GeneratedVocalNote[] {
  return midiNotes.map((n, idx) => {
    const next = midiNotes[idx + 1];
    const maxGrid = next
      ? Math.max(1, next.startTick - n.startTick)
      : Math.max(120, n.durationTicks);
    const rawGrid = n.gridDurationTicks ?? n.durationTicks;
    const gridDuration = Math.max(n.durationTicks, Math.min(rawGrid, maxGrid));
    return {
      startTick: n.startTick,
      gridDuration,
      gateDuration: n.durationTicks,
      midiPitch: n.pitch,
      velocity: n.velocity,
      role: n.role ?? 'step',
      hasFall: Boolean(n.hasFall && n.fallConfig),
      fallConfig: n.hasFall && n.fallConfig ? { ...n.fallConfig } : undefined,
    };
  });
}

// ===========================================================================
// Stage 1: Macro Pitch Trajectory (PitchTrajectoryPlan)
// ===========================================================================

function getMacroOffsetsForPhraseCount(numPhrases: number): number[] {
  if (numPhrases <= 1) return [0];
  if (numPhrases === 2) return [0, 2];
  if (numPhrases === 3) return [0, 2, 1];
  if (numPhrases === 4) return [0, 2, 3, 1]; // Canonical 8-bar trajectory
  if (numPhrases === 8) return [0, 1, 2, 2, 3, 4, 3, 1]; // Canonical 16-bar trajectory

  const template8 = [0, 1, 2, 2, 3, 4, 3, 1];
  const out: number[] = [];
  for (let i = 0; i < numPhrases; i++) {
    const pos = Math.round((i / Math.max(1, numPhrases - 1)) * (template8.length - 1));
    out.push(template8[pos]);
  }
  return out;
}

export function buildPitchTrajectoryPlan(
  genreId: MasterGenreId,
  sectionRole: NormalizedSectionRole,
  bars: number,
  baseVocalRegisterPitch = 58,
  prevVocalAvgPitch?: number
): PitchTrajectoryPlan {
  const profile = RHYTHM_FIRST_GENRE_PROFILES[genreId];
  const sectionShift = profile.sectionShifts[sectionRole] ?? 0;
  const totalSectionTicks = Math.max(BAR_TICKS, bars * BAR_TICKS);
  const numPhrases = Math.max(1, Math.ceil(bars / 2));
  const offsets = getMacroOffsetsForPhraseCount(numPhrases);
  const maxOffset = Math.max(...offsets, 0);

  let rawBase = baseVocalRegisterPitch + sectionShift;
  if (prevVocalAvgPitch !== undefined && !Number.isNaN(prevVocalAvgPitch)) {
    const clampedLift = Math.max(
      prevVocalAvgPitch - 3,
      Math.min(prevVocalAvgPitch + 4.5, rawBase)
    );
    rawBase = Math.round(clampedLift);
  }

  // Ensure trajectory + peak room stays strictly inside [VOCAL_MIN_PITCH, VOCAL_MAX_PITCH]
  const ceilingSafeMax = VOCAL_MAX_PITCH - maxOffset - 3;
  const floorSafeMin = VOCAL_MIN_PITCH + 3;
  const baseAnchorPitch = Math.max(
    floorSafeMin,
    Math.min(ceilingSafeMax, Math.round(rawBase))
  );

  const phrases: PitchTrajectoryPhrasePlan[] = [];
  for (let p = 0; p < numPhrases; p++) {
    const startTick = p * PHRASE_2BAR_TICKS;
    const endTick = Math.min(totalSectionTicks, startTick + PHRASE_2BAR_TICKS);
    const offset = offsets[p];
    const isRunway = p + 1 < numPhrases && offsets[p + 1] > offset;
    const motifSourcePhraseIndex =
      p === 1
        ? 0
        : numPhrases >= 8 && p === 5
          ? 4
          : undefined;
    phrases.push({
      phraseIndex: p,
      startTick,
      endTick,
      anchorOffsetSemitones: offset,
      plannedAnchorPitch: baseAnchorPitch + offset,
      isRunway,
      motifSourcePhraseIndex,
    });
  }

  return {
    genreId,
    sectionRole,
    sectionShiftSemitones: sectionShift,
    baseAnchorPitch,
    phrases,
  };
}

// ===========================================================================
// Stage 2: Rhythm & Gate Cell Selection
// ===========================================================================

const ONE_BAR_FALLBACK_CELLS: Readonly<Record<MasterGenreId, readonly RhythmGateCell[]>> = {
  alt_shoegaze: [
    cell(240, 240, 0.88, 'pickup', 0.88),
    cell(480, 960, 0.92, 'top_fall', 1.04),
  ],
  emo_jrock: [
    cell(0, 240, 0.78, 'hook_stab', 0.96),
    cell(240, 240, 0.76, 'rush', 0.9),
    cell(480, 960, 0.84, 'top_fall', 1.06),
  ],
  numetal_mixture: [
    cell(0, 240, 0.68, 'hook_stab', 1.0),
    cell(240, 240, 0.66, 'rush', 0.9),
    cell(480, 720, 0.76, 'top_fall', 1.08),
  ],
  royal_jpop: [
    cell(0, 240, 0.82, 'anchor', 0.96),
    cell(240, 240, 0.8, 'step', 0.9),
    cell(480, 960, 0.88, 'top_fall', 1.06),
  ],
  chill_ballad: [
    cell(240, 240, 0.88, 'pickup', 0.86),
    cell(480, 960, 0.93, 'top_fall', 1.0),
  ],
};

function selectBase2BarTemplate(
  profile: RhythmFirstGenreProfile,
  vocalDensity: number,
  rng: () => number,
  preset?: string
): readonly RhythmGateCell[] {
  if (preset === 'jrock_anticipation' && profile.genreId === 'emo_jrock') {
    return profile.templates2Bar[1].map((c) => ({ ...c }));
  }
  if (vocalDensity <= 1.6) {
    return profile.sparseTemplate2Bar;
  }
  if (vocalDensity >= 4.4) {
    return profile.denseTemplate2Bar;
  }

  const baseIdx = Math.floor(rng() * profile.templates2Bar.length);
  const chosen = profile.templates2Bar[baseIdx].map((c) => ({ ...c }));

  // Smooth continuous decimal interpolation for intermediate vocalDensity (1.7..2.4 or 3.6..4.3)
  if (vocalDensity < 2.4 && chosen.length > 4) {
    // Merge one rush/step pair into a longer tone to thin syllable count while preserving contrast & silence
    for (let i = 0; i + 1 < chosen.length - 1; i++) {
      const a = chosen[i];
      const b = chosen[i + 1];
      if (
        a.startTick + a.gridDuration === b.startTick &&
        a.gridDuration <= 240 &&
        b.gridDuration <= 240 &&
        Math.floor((a.startTick + a.gridDuration + b.gridDuration - 1) / BAR_TICKS) ===
          Math.floor(a.startTick / BAR_TICKS)
      ) {
        chosen.splice(i, 2, {
          startTick: a.startTick,
          gridDuration: a.gridDuration + b.gridDuration,
          gateRatio: profile.baseGateRatio,
          role: a.role,
          velocityScale: a.velocityScale,
        });
        break;
      }
    }
  } else if (vocalDensity > 3.6) {
    // Split one 480-tick non-final slot into two crisp 240-tick syllables
    const splitsTarget = vocalDensity >= 4.1 ? 2 : 1;
    let splitsDone = 0;
    for (let i = 0; i < chosen.length - 1 && splitsDone < splitsTarget; i++) {
      const c = chosen[i];
      if (c.gridDuration === 480 && c.role !== 'top_fall') {
        const subGate = Math.max(0.62, Math.min(0.84, c.gateRatio - 0.05));
        chosen.splice(
          i,
          1,
          {
            startTick: c.startTick,
            gridDuration: 240,
            gateRatio: subGate,
            role: c.role,
            velocityScale: c.velocityScale,
          },
          {
            startTick: c.startTick + 240,
            gridDuration: 240,
            gateRatio: subGate,
            role: 'step',
            velocityScale: Math.max(0.8, c.velocityScale - 0.04),
          }
        );
        i++;
        splitsDone++;
      }
    }
  }

  return chosen;
}

// ===========================================================================
// Stage 3 & Stage 4: Narrow Pitch Pool + Runway Guard + Fall Expression
// ===========================================================================

function buildNarrowPitchPool(
  fullScale: readonly number[],
  profile: RhythmFirstGenreProfile,
  clampedAnchor: number,
  prevTopNote?: number
): number[] {
  const ambitus = profile.maxPhraseAmbitus;
  const maxUnique = profile.maxUniquePitchesPerPhrase;

  const belowHalf = Math.floor((ambitus - 1) * 0.4);
  let winMin = Math.round(clampedAnchor) - belowHalf;
  let winMax = winMin + ambitus;

  if (winMin < VOCAL_MIN_PITCH) {
    winMin = VOCAL_MIN_PITCH;
    winMax = winMin + ambitus;
  }
  if (winMax > VOCAL_MAX_PITCH) {
    winMax = VOCAL_MAX_PITCH;
    winMin = Math.max(VOCAL_MIN_PITCH, winMax - ambitus);
  }

  if (prevTopNote !== undefined) {
    const maxAllowedTop = prevTopNote + profile.maxAdjacentTopNoteJump;
    const minAllowedTop = prevTopNote - profile.maxAdjacentTopNoteJump;
    if (winMax > maxAllowedTop) {
      winMax = maxAllowedTop;
      winMin = Math.max(VOCAL_MIN_PITCH, winMax - ambitus);
    }
    if (winMax < minAllowedTop) {
      winMax = Math.min(VOCAL_MAX_PITCH, minAllowedTop + 1);
      winMin = Math.max(VOCAL_MIN_PITCH, winMax - ambitus);
    }
  }

  let pool = fullScale.filter((p) => p >= winMin && p <= winMax);

  // If tritone window yielded fewer than 2 notes or exceeded ambitus, pick consecutive slice around anchor
  if (pool.length < 2) {
    const anchorIdx = findClosestIndex(fullScale, clampedAnchor);
    const start = Math.max(0, anchorIdx - 1);
    pool = fullScale.slice(start, Math.min(fullScale.length, start + maxUnique));
    while (pool.length > 1 && pool[pool.length - 1] - pool[0] > ambitus) {
      pool.pop();
    }
  }

  // Trim to maxUniquePitchesPerPhrase centered around clampedAnchor while keeping top-note reach
  while (pool.length > maxUnique) {
    const distLow = Math.abs(pool[0] - clampedAnchor);
    const distHigh = Math.abs(pool[pool.length - 1] - clampedAnchor);
    if (
      prevTopNote !== undefined &&
      pool.length >= 2 &&
      pool[pool.length - 2] < prevTopNote - profile.maxAdjacentTopNoteJump
    ) {
      pool.shift();
    } else if (distHigh > distLow) {
      pool.pop();
    } else {
      pool.shift();
    }
  }

  return pool;
}

function findClosestIndex(arr: readonly number[], target: number): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - target);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function computeBarAverageStats(
  notes: readonly GeneratedVocalNote[],
  barIndex: number
): { mean: number; weighted: number } | null {
  const barStart = barIndex * BAR_TICKS;
  const barEnd = barStart + BAR_TICKS;
  const inBar = notes.filter((n) => n.startTick >= barStart && n.startTick < barEnd);
  if (inBar.length === 0) return null;
  const sum = inBar.reduce((s, n) => s + n.midiPitch, 0);
  return {
    mean: sum / inBar.length,
    weighted: computeWeightedTessitura(inBar),
  };
}

export interface RhythmFirstGenerationResult {
  readonly genreId: MasterGenreId;
  readonly profile: RhythmFirstGenreProfile;
  readonly trajectory: PitchTrajectoryPlan;
  readonly notes: GeneratedVocalNote[];
  readonly midiNotes: MidiNote[];
}

export function generateRhythmFirstVocal(
  input: EngineInput
): RhythmFirstGenerationResult {
  const { song, section, seed, style, prevVocalAvgPitch } = input;
  const genreId = resolveMasterGenreForVocal(input);
  const profile = RHYTHM_FIRST_GENRE_PROFILES[genreId];
  const sectionRole = normalizeSectionRole(section.type, section.energy, section.name);
  const styleOffsetSeed = style === 'B' ? 0x1f3d5b79 : style === 'C' ? 0x5a3c9e17 : 0;
  const rng = mulberry32((((seed ^ styleOffsetSeed) >>> 0) + 1) >>> 0);

  const keySemitone = noteNameToSemitone(song.key);
  const scalePcs = new Set(getScalePitchClasses(song.key, song.scale));
  const fullScale = buildScaleGrid(scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH);
  const safeFullScale =
    fullScale.length > 0
      ? fullScale
      : [nearestScalePitch(60, scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH)];

  // Base register around C4 (57..60) aligned to song key tonic/3rd/5th
  const baseRegisterTarget =
    genreId === 'numetal_mixture'
      ? 57
      : genreId === 'chill_ballad'
        ? 58
        : 59;
  const tonicNearBase = fitPitchClassToRange(
    keySemitone,
    baseRegisterTarget - 3,
    baseRegisterTarget + 3
  );
  const initialBase = nearestScalePitch(
    Math.round((baseRegisterTarget + tonicNearBase) * 0.5),
    scalePcs,
    54,
    63
  );

  // Stage 1: Macro Pitch Trajectory Plan
  const trajectory = buildPitchTrajectoryPlan(
    genreId,
    sectionRole,
    section.bars,
    initialBase,
    prevVocalAvgPitch
  );

  const vocalDensity = Math.max(1.0, Math.min(5.0, section.vocalDensity ?? 3.0));
  const baseVelocity =
    sectionRole === 'chorus' || section.energy === 'High'
      ? 104
      : sectionRole === 'bridge' && section.energy === 'Low'
        ? 80
        : section.energy === 'Low'
          ? 84
          : 94;

  const activePreset = (
    section.patternPresets?.vocal ??
    section.partPresets?.vocal ??
    song.members.vocal?.patternPreset ??
    'auto'
  ).trim();

  // Stage 2: Determine RhythmGateCell[] per phrase (preserving A -> A' motif identity)
  const phraseCellsList: (readonly RhythmGateCell[])[] = [];
  for (let p = 0; p < trajectory.phrases.length; p++) {
    const pPlan = trajectory.phrases[p];
    const phraseSpanTicks = pPlan.endTick - pPlan.startTick;
    if (phraseSpanTicks <= BAR_TICKS) {
      phraseCellsList.push(ONE_BAR_FALLBACK_CELLS[genreId]);
      continue;
    }
    if (
      pPlan.motifSourcePhraseIndex !== undefined &&
      phraseCellsList[pPlan.motifSourcePhraseIndex]
    ) {
      // Exact RhythmGateCell[] reuse for A -> A' hook repetition
      phraseCellsList.push(
        phraseCellsList[pPlan.motifSourcePhraseIndex].map((c) => ({ ...c }))
      );
    } else {
      phraseCellsList.push(
        selectBase2BarTemplate(profile, vocalDensity, rng, activePreset)
      );
    }
  }

  // Stage 3: Narrow-Ambitus Pitch Pool & Realized-Tessitura Runway Guard
  const phraseNotesStore: GeneratedVocalNote[][] = [];
  const phraseRelativeContours: number[][] = [];
  let prevTessitura: number | undefined = prevVocalAvgPitch;
  let prevTopNote: number | undefined;
  let prevBarStats: { mean: number; weighted: number } | null = null;

  for (let p = 0; p < trajectory.phrases.length; p++) {
    const pPlan = trajectory.phrases[p];
    const cells = phraseCellsList[p];
    const phraseBars = Math.max(1, Math.round((pPlan.endTick - pPlan.startTick) / BAR_TICKS));
    const startBarIdx = Math.floor(pPlan.startTick / BAR_TICKS);

    // Pre-selection anchor clamping against realized previous tessitura & bar average
    let clampedAnchor: number = pPlan.plannedAnchorPitch;
    if (prevTessitura !== undefined) {
      const safeStep = p === 0 ? 4.0 : profile.maxAdjacentTessituraJump * 0.65;
      clampedAnchor = Math.max(
        prevTessitura - safeStep,
        Math.min(prevTessitura + safeStep, clampedAnchor)
      );
    }
    if (prevBarStats !== null) {
      const safeBarStep = profile.maxAdjacentTessituraJump * 0.7;
      clampedAnchor = Math.max(
        prevBarStats.weighted - safeBarStep,
        Math.min(prevBarStats.weighted + safeBarStep, clampedAnchor)
      );
    }

    const pitchPool = buildNarrowPitchPool(
      safeFullScale,
      profile,
      clampedAnchor,
      prevTopNote
    );
    const anchorPitch = pickClosestFromList(Math.round(clampedAnchor), pitchPool);
    const maxBarJumpAllowed = profile.maxAdjacentTessituraJump + 0.85;

    // Chord tone pitch classes in this phrase for subtle harmonic consonance inside pitchPool
    const chordPcsBySlot = cells.map((c) => {
      const absTick = Math.min(
        section.bars * BAR_TICKS - 1,
        pPlan.startTick + c.startTick
      );
      const parsed = getActiveChordAtTick(
        section.chords,
        absTick,
        song.key,
        song.scale,
        section.bars
      ).parsed;
      return new Set(parsed.intervals.map((iv) => (parsed.rootSemitone + iv) % 12));
    });

    const sourceContour =
      pPlan.motifSourcePhraseIndex !== undefined
        ? phraseRelativeContours[pPlan.motifSourcePhraseIndex]
        : undefined;

    const buildCandidateNotes = (pitches: readonly number[]): GeneratedVocalNote[] =>
      cells.map((c, idx) => {
        const gateDur = Math.max(
          120,
          Math.min(c.gridDuration, Math.round(c.gridDuration * c.gateRatio))
        );
        return {
          startTick: pPlan.startTick + c.startTick,
          gridDuration: c.gridDuration,
          gateDuration: gateDur,
          midiPitch: pitches[idx],
          velocity: clampVelocity(Math.round(baseVelocity * c.velocityScale)),
          role: c.role,
          hasFall: false,
        };
      });

    const checkHardInvariants = (candNotes: readonly GeneratedVocalNote[]): boolean => {
      if (candNotes.length === 0) return true;
      const pitches = candNotes.map((n) => n.midiPitch);
      const onset = pitches[0];
      const minP = Math.min(...pitches);
      const maxP = Math.max(...pitches);

      // 1. Phrase-end leap invariant
      if (pitches.length >= 2) {
        const endDelta = pitches[pitches.length - 1] - pitches[pitches.length - 2];
        if (!pPlan.isRunway) {
          if (endDelta > 0 || endDelta < -4) return false;
        } else {
          if (endDelta > profile.maxPhraseEndUpwardLeap || endDelta < -4) return false;
        }
      }
      // 2. Max rise from onset
      if (maxP - onset > profile.maxRiseFromOnset) return false;
      // 3. Phrase ambitus
      if (maxP - minP > profile.maxPhraseAmbitus) return false;
      // 4. Unique pitches per phrase
      if (new Set(pitches).size > profile.maxUniquePitchesPerPhrase) return false;
      // 5 & 6. Adjacent phrase tessitura & top-note continuity (from phrase 1 onward)
      if (p > 0 && prevTessitura !== undefined) {
        const tess = computeWeightedTessitura(candNotes);
        if (Math.abs(tess - prevTessitura) > profile.maxAdjacentTessituraJump - 0.02) {
          return false;
        }
      }
      if (p > 0 && prevTopNote !== undefined) {
        if (Math.abs(maxP - prevTopNote) > profile.maxAdjacentTopNoteJump) {
          return false;
        }
      }
      // 7. Continuous bar-to-bar average pitch continuity (both mean & weighted)
      let runningBar = prevBarStats;
      for (let b = 0; b < phraseBars; b++) {
        const stats = computeBarAverageStats(candNotes, startBarIdx + b);
        if (stats && runningBar) {
          if (Math.abs(stats.mean - runningBar.mean) > maxBarJumpAllowed) return false;
          if (Math.abs(stats.weighted - runningBar.weighted) > maxBarJumpAllowed) {
            return false;
          }
        }
        if (stats) runningBar = stats;
      }
      return true;
    };

    let bestNotes: GeneratedVocalNote[] | null = null;
    let bestScore = -Infinity;

    // Sample 10 deterministic candidates from pitchPool and pick the most musical valid take
    for (let attempt = 0; attempt < 10; attempt++) {
      const pitches: number[] = [];

      // Choose onset pitch allowing room to reach required top note & stay near anchorPitch
      const minOnsetForTop =
        p > 0 && prevTopNote !== undefined
          ? prevTopNote - profile.maxAdjacentTopNoteJump - profile.maxRiseFromOnset
          : VOCAL_MIN_PITCH;
      const validOnsets = pitchPool.filter((cand) => cand >= minOnsetForTop);
      const onsetCandidates = validOnsets.length > 0 ? validOnsets : pitchPool;
      const anchorOnsetIdx = findClosestIndex(onsetCandidates, anchorPitch);
      const jitterChoices = [0, 0, -1, 1];
      const onsetChoiceIdx = Math.max(
        0,
        Math.min(
          onsetCandidates.length - 1,
          anchorOnsetIdx + jitterChoices[Math.floor(rng() * jitterChoices.length)]
        )
      );
      const onsetPitch = onsetCandidates[onsetChoiceIdx];
      const ceilingFromOnset = onsetPitch + profile.maxRiseFromOnset;
      const activePool = pitchPool.filter((cand) => cand <= ceilingFromOnset);
      const safePool = activePool.length > 0 ? activePool : [onsetPitch];

      pitches.push(onsetPitch);
      let currPoolIdx = Math.max(0, safePool.indexOf(onsetPitch));
      let sameRun = 1;

      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        const isLast = i === cells.length - 1;
        const isSecondHalf =
          i >= Math.floor(cells.length / 2) || c.startTick >= BAR_TICKS;
        const prevP = pitches[i - 1];

        if (isLast) {
          const maxUp = pPlan.isRunway ? profile.maxPhraseEndUpwardLeap : 0;
          const endValid = safePool.filter(
            (cand) => cand - prevP <= maxUp && cand - prevP >= -4
          );
          const choices = endValid.length > 0 ? endValid : [prevP];
          let chosenEnd: number;
          if (pPlan.isRunway) {
            const upChoices = choices.filter((cand) => cand >= anchorPitch && cand >= prevP);
            const poolForEnd = upChoices.length > 0 ? upChoices : choices;
            chosenEnd = poolForEnd[Math.floor(rng() * poolForEnd.length)];
          } else {
            // Settle cleanly downward or hold unison
            const chordMatches = choices.filter((cand) => chordPcsBySlot[i].has(cand % 12));
            const poolForEnd = chordMatches.length > 0 && rng() < 0.7 ? chordMatches : choices;
            chosenEnd = poolForEnd[Math.floor(rng() * poolForEnd.length)];
          }
          pitches.push(chosenEnd);
          continue;
        }

        // Follow A -> A' relative pool-step contour when available
        if (sourceContour && i < sourceContour.length && rng() < 0.8) {
          const hintedIdx = Math.max(
            0,
            Math.min(safePool.length - 1, currPoolIdx + sourceContour[i])
          );
          currPoolIdx = hintedIdx;
          const nextP = safePool[currPoolIdx];
          sameRun = nextP === prevP ? sameRun + 1 : 1;
          pitches.push(nextP);
          continue;
        }

        // Same-pitch hook repetition bias
        if (sameRun < 4 && rng() < profile.samePitchRepeatBias) {
          if (!pPlan.isRunway || !isSecondHalf || prevP >= anchorPitch) {
            sameRun++;
            pitches.push(prevP);
            continue;
          }
        }

        // Stepwise / hook movement inside safePool
        let stepDelta: number;
        if (pPlan.isRunway && isSecondHalf) {
          // Runway second-half bias: favor >= anchorPitch
          stepDelta = safePool[currPoolIdx] < anchorPitch ? 1 : rng() < 0.65 ? 1 : 0;
        } else if (c.role === 'top_fall' || c.role === 'hook_stab' || c.role === 'sync_tie') {
          stepDelta = rng() < 0.65 ? 1 : rng() < 0.5 ? 0 : -1;
        } else {
          const stepOpts = [-1, 0, 1, 1, -1];
          stepDelta = stepOpts[Math.floor(rng() * stepOpts.length)];
        }

        currPoolIdx = Math.max(0, Math.min(safePool.length - 1, currPoolIdx + stepDelta));
        const nextP = safePool[currPoolIdx];
        sameRun = nextP === prevP ? sameRun + 1 : 1;
        pitches.push(nextP);
      }

      // If p > 0 and max(pitches) is slightly below prevTopNote - maxAdjacentTopNoteJump, lift one middle note
      if (
        p > 0 &&
        prevTopNote !== undefined &&
        Math.max(...pitches) < prevTopNote - profile.maxAdjacentTopNoteJump &&
        safePool.length > 0
      ) {
        const peakPitch = safePool[safePool.length - 1];
        if (
          peakPitch >= prevTopNote - profile.maxAdjacentTopNoteJump &&
          cells.length >= 3
        ) {
          const midIdx = Math.max(1, cells.length - 2);
          pitches[midIdx] = peakPitch;
          // Re-verify last note delta after lifting midIdx
          const lastIdx = cells.length - 1;
          const maxUp = pPlan.isRunway ? profile.maxPhraseEndUpwardLeap : 0;
          const d = pitches[lastIdx] - pitches[midIdx];
          if (d > maxUp || d < -4) {
            const fixedEnds = safePool.filter(
              (c) => c - pitches[midIdx] <= maxUp && c - pitches[midIdx] >= -4
            );
            pitches[lastIdx] = fixedEnds.length > 0 ? fixedEnds[0] : pitches[midIdx];
          }
        }
      }

      const candNotes = buildCandidateNotes(pitches);
      if (!checkHardInvariants(candNotes)) {
        continue;
      }

      // Score valid candidate for hook catchiness & chord-tone consonance
      const tess = computeWeightedTessitura(candNotes);
      let score = -Math.abs(tess - clampedAnchor) * 1.4;
      for (let i = 0; i < pitches.length; i++) {
        if (chordPcsBySlot[i].has(pitches[i] % 12)) {
          score += cells[i].gridDuration >= 480 ? 1.5 : 0.6;
        }
      }
      // Reward moderate melodic motion (at least 2 unique pitches) so hooks aren't flat
      const uniqCount = new Set(pitches).size;
      if (uniqCount >= 2) score += 2.0;
      if (uniqCount >= 3 && profile.maxUniquePitchesPerPhrase >= 4) score += 1.0;

      if (score > bestScore) {
        bestScore = score;
        bestNotes = candNotes;
      }
    }

    // Deterministic guaranteed-safe fallback if all 10 stochastic draws missed a continuity edge
    if (!bestNotes) {
      const safeCenterTarget =
        p > 0 && prevTessitura !== undefined ? prevTessitura : clampedAnchor;
      const baseP = pickClosestFromList(Math.round(safeCenterTarget), pitchPool);
      const fallbackPitches = cells.map(() => baseP);
      if (
        p > 0 &&
        prevTopNote !== undefined &&
        baseP < prevTopNote - profile.maxAdjacentTopNoteJump
      ) {
        const neededTop = pickClosestFromList(
          prevTopNote - profile.maxAdjacentTopNoteJump + 1,
          pitchPool.filter((cand) => cand <= baseP + profile.maxRiseFromOnset)
        );
        if (neededTop !== undefined && fallbackPitches.length >= 2) {
          const peakPos = Math.max(0, fallbackPitches.length - 2);
          fallbackPitches[peakPos] = neededTop;
          if (neededTop - fallbackPitches[fallbackPitches.length - 1] > 4) {
            fallbackPitches[fallbackPitches.length - 1] = neededTop;
          }
        }
      }
      bestNotes = buildCandidateNotes(fallbackPitches);
    }

    // Record relative pool-step contour for A -> A' motif inheritance
    const relSteps: number[] = [0];
    for (let i = 1; i < bestNotes.length; i++) {
      const prevIdx = findClosestIndex(pitchPool, bestNotes[i - 1].midiPitch);
      const currIdx = findClosestIndex(pitchPool, bestNotes[i].midiPitch);
      relSteps.push(currIdx - prevIdx);
    }

    phraseNotesStore.push(bestNotes);
    phraseRelativeContours.push(relSteps);
    prevTessitura = computeWeightedTessitura(bestNotes);
    prevTopNote = Math.max(...bestNotes.map((n) => n.midiPitch));
    for (let b = 0; b < phraseBars; b++) {
      const bStats = computeBarAverageStats(bestNotes, startBarIdx + b);
      if (bStats) prevBarStats = bStats;
    }
  }

  // Stage 4: Top-Note Fall Expression Assignment
  const sectionEndTick = section.bars * BAR_TICKS;
  const flatNotes = phraseNotesStore.flat();
  const finalGenerated: GeneratedVocalNote[] = flatNotes.map((n, idx) => {
    const nextStart =
      idx + 1 < flatNotes.length ? flatNotes[idx + 1].startTick : sectionEndTick;
    const trailingPureRest = nextStart - (n.startTick + n.gridDuration);
    const phraseIdx = Math.min(
      trajectory.phrases.length - 1,
      Math.floor(n.startTick / PHRASE_2BAR_TICKS)
    );
    const pNotes = phraseNotesStore[phraseIdx] ?? [];
    const isLastInPhrase =
      pNotes.length > 0 && pNotes[pNotes.length - 1].startTick === n.startTick;
    const phraseAnchor = trajectory.phrases[phraseIdx]?.plannedAnchorPitch ?? 60;

    const fallCfg = profile.fallConfig;
    const eligibleRole =
      n.role === 'top_fall' || (isLastInPhrase && n.midiPitch >= phraseAnchor - 1);
    const eligible =
      eligibleRole &&
      n.gridDuration >= fallCfg.minGridDurationTicks &&
      trailingPureRest >= fallCfg.minTrailingRestTicks;

    const triggerFall = eligible && rng() < fallCfg.probability;
    return triggerFall
      ? { ...n, hasFall: true, fallConfig: { ...fallCfg } }
      : { ...n, hasFall: false, fallConfig: undefined };
  });

  return {
    genreId,
    profile,
    trajectory,
    notes: finalGenerated,
    midiNotes: toMidiNotesFromGenerated(finalGenerated),
  };
}

// ===========================================================================
// Legacy Pure Rap Presets (Deterministic Backwards Compatibility)
// ===========================================================================

function generateLegacyRapPresetNotes(
  input: EngineInput,
  preset: string,
  scalePcs: ReadonlySet<number>,
  keySemitone: number
): MidiNote[] {
  const { song, section, style, seed } = input;
  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * BAR_TICKS;
  const vocalDensity = Math.max(1.0, Math.min(5.0, section.vocalDensity ?? 3));

  if (preset === 'rap_mixture_flow') {
    const densityNorm = (vocalDensity - 1.0) / 4.0;
    const scaleGrid = buildScaleGrid(scalePcs, 53, 68);
    const safeGrid =
      scaleGrid.length > 0
        ? scaleGrid
        : [nearestScalePitch(57, scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH)];
    const rootPitch = pickClosestFromList(
      58,
      safeGrid.filter((p) => p % 12 === keySemitone).length > 0
        ? safeGrid.filter((p) => p % 12 === keySemitone)
        : safeGrid
    );
    const accentChoices = safeGrid.filter((p) => p > rootPitch && p <= rootPitch + 3);
    const accentPitch = accentChoices[0] ?? safeGrid[Math.min(safeGrid.length - 1, 1)];
    const isFastRap = song.bpm >= 120;
    const fastPitchPool = Array.from(new Set([rootPitch, accentPitch])).slice(0, 2);
    const slowRootIdx = Math.max(0, safeGrid.indexOf(rootPitch));
    const slowPitchPool = safeGrid.slice(
      Math.max(0, slowRootIdx - 1),
      Math.min(safeGrid.length, slowRootIdx + 4)
    );

    const out: MidiNote[] = [];
    const candRng = mulberry32(((seed + 977) >>> 0) || 1);
    let prevSlowIdx = Math.min(slowPitchPool.length - 1, 1);

    for (let b = 0; b < section.bars; b++) {
      const barStart = b * BAR_TICKS;
      const isChapterEndBar = b % 4 === 3 || b === section.bars - 1;
      if (isChapterEndBar && section.bars >= 2) {
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
          out.push({
            pitch: p,
            velocity: clampVelocity(90),
            startTick: barStart + off,
            durationTicks: 140,
            channel: TRACK_CHANNELS.vocal,
          });
        }
        if (barStart + 1440 < sectionEnd) {
          out.push({
            pitch: rootPitch,
            velocity: 108,
            startTick: barStart + 1440,
            durationTicks: Math.min(360, sectionEnd - (barStart + 1440)),
            channel: TRACK_CHANNELS.vocal,
          });
        }
        continue;
      }

      const step = isFastRap && densityNorm >= 0.45 ? 120 : 240;
      const baseProb = 0.3 + 0.6 * densityNorm;
      for (let off = 0; off < BAR_TICKS - 240; off += step) {
        const isSnarePos = off === 480 || off === 1440;
        if (!isSnarePos && candRng() > baseProb) continue;
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
            Math.min(slowPitchPool.length - 1, prevSlowIdx + (candRng() < 0.3 ? 0 : delta))
          );
          p = slowPitchPool[prevSlowIdx];
        }
        out.push({
          pitch: p,
          velocity: clampVelocity(isSnarePos ? 104 : 88),
          startTick: barStart + off,
          durationTicks: isFastRap ? 120 : 180,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    }
    return enforceMonophonicAndClip(out, sectionEnd);
  }

  const scaleNotes = buildScaleGrid(scalePcs, 52, 70);
  const rawAnchor = fitPitchClassToRange(keySemitone, 55, 63);
  const rapAnchor = nearestScalePitch(rawAnchor, scalePcs, 52, 66);
  const anchorIdx = Math.max(0, scaleNotes.indexOf(rapAnchor));
  const scaleStep = (delta: number): number =>
    scaleNotes[Math.min(scaleNotes.length - 1, Math.max(0, anchorIdx + delta))] ?? rapAnchor;

  const rapBelow = scaleStep(-1);
  const rapTwoBelow = scaleStep(-2);
  const rapSecond = scaleStep(1);
  const rapThird = scaleStep(2);
  const rapFifth = scaleStep(4);
  const baseVel = section.energy === 'High' ? 104 : section.energy === 'Low' ? 78 : 92;
  const notes: MidiNote[] = [];

  const hookMotifBar0 = [0, 360, 480, 960, 1200, 1440];
  const hookMotifBar1 = style === 'C' ? [0, 240, 480, 720, 960, 1200] : [0, 360, 480, 960, 1200];

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * BAR_TICKS;
    const isPhraseEndBar = bar % 2 === 1 || bar === section.bars - 1;

    if (preset === 'rap_16th_push' || preset === 'rap_double_time') {
      const isDouble = preset === 'rap_double_time';
      const restStartStep =
        vocalDensity <= 1 ? 8 : vocalDensity <= 2 ? 10 : style === 'B' ? 14 : rng.nextInt(11, 14);
      const stride = vocalDensity <= 1 ? 4 : vocalDensity <= 2 ? 2 : 1;
      for (let s = 0; s < restStartStep; s += stride) {
        if (vocalDensity <= 3 && !isDouble && s === 7 && rng.chance(0.5)) continue;
        const pitch =
          s === restStartStep - stride && isPhraseEndBar
            ? rapBelow
            : s % 4 === 2 && rng.chance(style === 'C' ? 0.55 : 0.3)
              ? rapThird
              : rapAnchor;
        notes.push({
          pitch,
          velocity: clampVelocity(baseVel + (s % 4 === 0 ? 8 : -4) + rng.nextInt(-3, 3)),
          startTick: barStart + s * 120,
          durationTicks: vocalDensity <= 1 ? 360 : vocalDensity <= 2 ? 190 : 100,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    } else if (preset === 'rap_triplet_trap' || preset === 'rap_triplet_bounce') {
      const tripSteps =
        vocalDensity <= 1
          ? [0, 960]
          : vocalDensity <= 2
            ? [0, 320, 960, 1280]
            : vocalDensity >= 4
              ? [0, 160, 320, 480, 640, 800, 960, 1120, 1280, 1440]
              : [0, 160, 320, 480, 800, 960, 1120, 1440];
      for (let i = 0; i < tripSteps.length; i++) {
        const off = tripSteps[i];
        notes.push({
          pitch: i % 3 === 1 ? rapSecond : off === 800 ? rapThird : rapAnchor,
          velocity: clampVelocity(baseVel + (off % 480 === 0 ? 6 : -4) + rng.nextInt(-3, 3)),
          startTick: barStart + off,
          durationTicks: vocalDensity <= 2 ? 240 : 125,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    } else if (preset === 'rap_laidback_groove') {
      const steps =
        vocalDensity <= 1
          ? [240, 1200]
          : vocalDensity >= 4
            ? [0, 240, 360, 600, 840, 960, 1200, 1560]
            : [240, 600, 840, 1200, 1560];
      for (let i = 0; i < steps.length; i++) {
        notes.push({
          pitch: i % 3 === 1 ? rapBelow : rapAnchor,
          velocity: clampVelocity(baseVel + rng.nextInt(-4, 4)),
          startTick: barStart + steps[i],
          durationTicks: vocalDensity <= 2 ? 260 : 160,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    } else if (preset === 'rap_hook_chant') {
      const motif = bar % 2 === 0 ? hookMotifBar0 : hookMotifBar1;
      const steps = vocalDensity <= 1 ? [0, 960] : motif;
      for (let i = 0; i < steps.length; i++) {
        notes.push({
          pitch: i === steps.length - 1 && bar % 2 === 1 ? rapThird : rapAnchor,
          velocity: clampVelocity(baseVel + (steps[i] % 480 === 0 ? 8 : 0)),
          startTick: barStart + steps[i],
          durationTicks: 180,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    } else if (preset === 'rap_nu_metal') {
      const steps =
        vocalDensity <= 1
          ? [0, 960]
          : vocalDensity >= 4
            ? [0, 120, 240, 360, 480, 720, 840, 960, 1200, 1440, 1680]
            : [0, 360, 480, 840, 960, 1320, 1440];
      for (const off of steps) {
        notes.push({
          pitch: off === 360 || off === 840 ? rapThird : rapAnchor,
          velocity: clampVelocity(baseVel + (off === 480 || off === 1440 ? 10 : 0)),
          startTick: barStart + off,
          durationTicks: vocalDensity <= 2 ? 240 : 120,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    } else if (preset === 'rap_hybrid_soar') {
      const front = vocalDensity <= 1 ? [0] : vocalDensity >= 4 ? [0, 120, 240, 360, 480, 720] : [0, 240, 480, 720];
      for (let i = 0; i < front.length; i++) {
        notes.push({
          pitch: i % 2 === 1 ? rapSecond : rapAnchor,
          velocity: clampVelocity(baseVel),
          startTick: barStart + front[i],
          durationTicks: 120,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      notes.push({
        pitch: bar % 2 === 1 ? rapFifth : rapThird,
        velocity: clampVelocity(baseVel + 8),
        startTick: barStart + 960,
        durationTicks: 760,
        channel: TRACK_CHANNELS.vocal,
      });
    } else if (preset === 'rap_cinematic_burst' || preset === 'rap_stop_and_go') {
      const steps =
        vocalDensity <= 1
          ? [0, 480]
          : vocalDensity >= 4
            ? [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080]
            : [0, 120, 240, 480, 600, 720, 960];
      for (let i = 0; i < steps.length; i++) {
        notes.push({
          pitch: i === steps.length - 1 ? rapThird : rapAnchor,
          velocity: clampVelocity(baseVel + (i === steps.length - 1 ? 10 : 2)),
          startTick: barStart + steps[i],
          durationTicks: 110,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    } else if (preset === 'rap_monotone_chant') {
      const steps =
        vocalDensity <= 1
          ? [0, 960]
          : vocalDensity >= 4
            ? [0, 240, 480, 720, 960, 1200, 1440]
            : [0, 240, 480, 960, 1200];
      for (let i = 0; i < steps.length; i++) {
        notes.push({
          pitch: isPhraseEndBar && i === steps.length - 1 ? rapBelow : rapAnchor,
          velocity: clampVelocity(baseVel + rng.nextInt(-3, 3)),
          startTick: barStart + steps[i],
          durationTicks: 180,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    } else {
      // rap_jhiphop_bounce, rap_mixture_melodic, rap_emo_sparse, rap_spoken_tension
      const steps =
        vocalDensity <= 1
          ? [0, 960]
          : vocalDensity <= 2
            ? [0, 480, 960]
            : vocalDensity >= 4
              ? [0, 240, 360, 480, 720, 960, 1200, 1440, 1680]
              : [0, 240, 480, 960, 1200, 1440];
      for (let i = 0; i < steps.length; i++) {
        const off = steps[i];
        const p =
          i === steps.length - 1
            ? isPhraseEndBar
              ? rapThird
              : rapTwoBelow
            : off % 480 === 240
              ? rapSecond
              : rapAnchor;
        notes.push({
          pitch: p,
          velocity: clampVelocity(baseVel + rng.nextInt(-3, 4)),
          startTick: barStart + off,
          durationTicks: vocalDensity <= 2 ? 260 : 160,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    }
  }

  return enforceMonophonicAndClip(notes, sectionEnd);
}

// ===========================================================================
// Main Entry Point: generateVocalNotes & generateVocalHarmonyNotes
// ===========================================================================

export function generateVocalNotes(input: EngineInput): MidiNote[] {
  const { song, section, style, seed, params } = input;
  const member = song.members.vocal;
  if (!member?.enabled || section.enabledParts?.vocal === false) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;

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

  // Mode B: Check legacy pure rap presets vs Rhythm-First 4-Stage Vocal Engine
  const preset = (
    section.patternPresets?.vocal ??
    section.partPresets?.vocal ??
    member.patternPreset ??
    'auto'
  ).trim();

  const isLegacyPureRap =
    preset.startsWith('rap_') && preset !== 'rap_linkin_hybrid';
  if (isLegacyPureRap) {
    const keySemitone = noteNameToSemitone(song.key);
    const scalePcs = new Set(getScalePitchClasses(song.key, song.scale));
    const voice = input.vocalVoiceProfile ?? resolveVocalVoiceProfile(song);
    const rawRap = generateLegacyRapPresetNotes(input, preset, scalePcs, keySemitone);
    return rawRap.map((n) => ({
      ...n,
      pitch: fitNoteIntoVoiceRange(n.pitch, voice.minMidi, voice.maxMidi, scalePcs),
    }));
  }

  // Execute Phase 2 Harmonic & Voice-Profile Aware Dialectical Vocal Pipeline
  return generateHarmonicVocalResult(input).midiNotes;
}

// ===========================================================================
// Phase 2: Chord-Aware & Voice-Profile Aware Harmonic Vocal Engine
// ===========================================================================

export interface HarmonicVocalGenerationResult {
  readonly genreId: MasterGenre;
  readonly voiceProfile: VocalVoiceProfile;
  readonly chordEvents: readonly ChordEvent[];
  readonly scheme: EightBarScheme;
  readonly thesisForm: ChapterInternalForm;
  readonly chapters: readonly DialecticalChapterPlan[];
  readonly notes: GeneratedVocalNote[];
  readonly midiNotes: MidiNote[];
  readonly vocalMinMidiByBar: Array<number | null>;
}

/**
 * Resolves the effective ChordEvent governing a vocal note, including <= 240-tick
 * syncopated anticipation lookahead across upcoming chord boundaries.
 */
export function resolveEffectiveChord(
  noteStartTick: number,
  noteDurationTicks: number,
  chordEvents: readonly ChordEvent[]
): ChordEvent {
  if (chordEvents.length === 0) {
    throw new Error('resolveEffectiveChord requires at least one ChordEvent');
  }
  const safeTick = Math.max(0, noteStartTick);
  const safeEnd = safeTick + Math.max(1, noteDurationTicks);

  let activeIdx = 0;
  for (let i = 0; i < chordEvents.length; i++) {
    const ev = chordEvents[i];
    if (safeTick >= ev.startTick) {
      activeIdx = i;
    } else {
      break;
    }
  }

  // Anticipation lookahead: if note starts within <= 240 ticks before next chord
  // AND crosses or touches the upcoming chord boundary, target the upcoming chord.
  if (activeIdx + 1 < chordEvents.length) {
    const nextChord = chordEvents[activeIdx + 1];
    const leadTicks = nextChord.startTick - safeTick;
    if (leadTicks > 0 && leadTicks <= 240 && safeEnd >= nextChord.startTick) {
      return nextChord;
    }
  }

  return chordEvents[activeIdx];
}

/**
 * Attenuates 16th-note (120t) syncopated anticipation probability at fast tempos (BPM > 120).
 */
export function computeAnticipationProbability(
  baseProb: number,
  bpm: number,
  gridTicks: number
): number {
  if (bpm <= 120) return baseProb;
  if (gridTicks <= 120) {
    const factor = Math.max(0.15, 1 - (bpm - 120) / 75);
    return baseProb * factor;
  }
  if (gridTicks <= 240 && bpm >= 165) {
    return baseProb * 0.75;
  }
  return baseProb;
}

function fitNoteIntoVoiceRange(
  pitch: number,
  minMidi: number,
  maxMidi: number,
  scalePcs: ReadonlySet<number>
): number {
  let p = Math.round(pitch);
  while (p < minMidi) p += 12;
  while (p > maxMidi) p -= 12;
  if (p >= minMidi && p <= maxMidi && scalePcs.has(p % 12)) {
    return p;
  }
  let best = Math.max(minMidi, Math.min(maxMidi, p));
  let bestDist = Infinity;
  for (let cand = minMidi; cand <= maxMidi; cand++) {
    if (!scalePcs.has(cand % 12)) continue;
    const d = Math.abs(cand - pitch);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

function sampleTopKSoftmax(
  scored: ReadonlyArray<{ pitch: number; score: number }>,
  topK: number,
  temperature: number,
  rng: () => number
): number {
  if (scored.length === 0) return 60;
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.pitch - b.pitch);
  const kSlice = sorted.slice(0, Math.max(1, Math.min(topK, sorted.length)));
  if (kSlice.length === 1 || temperature <= 0.05) {
    return kSlice[0].pitch;
  }
  const maxScore = kSlice[0].score;
  const weights = kSlice.map((c) =>
    Math.exp(Math.max(-20, (c.score - maxScore) / temperature))
  );
  const sumW = weights.reduce((acc, w) => acc + w, 0);
  if (sumW <= 0) return kSlice[0].pitch;

  const r = rng() * sumW;
  let cum = 0;
  for (let i = 0; i < kSlice.length; i++) {
    cum += weights[i];
    if (r <= cum) return kSlice[i].pitch;
  }
  return kSlice[kSlice.length - 1].pitch;
}

export function generateHarmonicVocalResult(
  input: EngineInput
): HarmonicVocalGenerationResult {
  const { song, section, seed, style, prevVocalAvgPitch } = input;
  const genreId: MasterGenre = resolveMasterGenreForVocal(input);
  const profile = GENRE_DIALECTICAL_PROFILES[genreId];
  const rfProfile = RHYTHM_FIRST_GENRE_PROFILES[genreId];
  const sectionRole = normalizeSectionRole(section.type, section.energy, section.name);

  const voice = input.vocalVoiceProfile ?? resolveVocalVoiceProfile(song);
  const chordEvents: readonly ChordEvent[] =
    input.chordEvents && input.chordEvents.length > 0
      ? input.chordEvents
      : buildSectionChordEvents(section, song.key, song.scale);

  // Stage-isolated deterministic RNG (independent of keyboard/pad settings)
  const vocalSubSeed = deriveSubSeed(
    seed,
    `vocal:sec${input.sectionIndex}:${style}:${voice.id}:${voice.minMidi}-${voice.maxMidi}`
  );
  const rng = mulberry32(vocalSubSeed);

  const keySemitone = noteNameToSemitone(song.key);
  const parentScalePcs = new Set(getScalePitchClasses(song.key, song.scale));
  const pentaOffsets =
    song.scale === 'Minor' ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const pentatonicPcs = new Set(pentaOffsets.map((o) => (keySemitone + o) % 12));

  // Section tessitura gradient: Verse (-2) -> Pre-Chorus (0) -> Chorus (+2, Final Chorus +3)
  const sectionOffset =
    sectionRole === 'chorus'
      ? input.isFinalChorusSection
        ? 3
        : 2
      : sectionRole === 'pre_chorus'
        ? 0
        : sectionRole === 'bridge'
          ? section.energy === 'Low'
            ? -2
            : 1
          : sectionRole === 'instrumental'
            ? -1
            : -2;

  let sectionCenter = voice.optimalTessituraCenter + sectionOffset;
  if (prevVocalAvgPitch !== undefined && !Number.isNaN(prevVocalAvgPitch)) {
    sectionCenter = Math.max(
      prevVocalAvgPitch - 1.5,
      Math.min(prevVocalAvgPitch + 5.5, sectionCenter)
    );
  }
  const safeMinCenter = Math.min(voice.maxMidi - 2, voice.minMidi + 3);
  const safeMaxCenter = Math.max(safeMinCenter, voice.maxMidi - 3);
  sectionCenter = Math.max(safeMinCenter, Math.min(safeMaxCenter, sectionCenter));

  const schemeOverride =
    input.vocalDialecticalScheme ?? section.vocalDialecticalScheme ?? 'auto';
  const formOverride =
    input.vocalChapterForm ?? section.vocalChapterForm ?? 'auto';
  const activePreset = (
    section.patternPresets?.vocal ??
    section.partPresets?.vocal ??
    song.members.vocal?.patternPreset ??
    'auto'
  ).trim();
  const vocalDensity = Math.max(1.0, Math.min(5.0, section.vocalDensity ?? 3.0));
  const sectionEndTick = section.bars * BAR_TICKS;

  // Build dialectical chapter roles & forms
  const numChapters = Math.max(1, Math.ceil(section.bars / 2));
  const isClimaxSection = sectionRole === 'chorus' || sectionRole === 'bridge';
  let scheme: EightBarScheme;
  if (schemeOverride === 'T-A-T-A' || schemeOverride === 'T-A-T-S') {
    scheme = schemeOverride;
  } else if (section.bars === 16) {
    scheme = 'T-A-T-S';
  } else {
    const prob = isClimaxSection
      ? profile.chorusTatsProb
      : profile.chorusTatsProb * 0.45;
    scheme = rng() < prob ? 'T-A-T-S' : 'T-A-T-A';
  }

  const thesisForm: ChapterInternalForm =
    formOverride === 'two_bar_continuous' ||
    formOverride === 'one_bar_repeat_with_passing'
      ? formOverride
      : rng() < profile.pattern2Prob
        ? 'one_bar_repeat_with_passing'
        : 'two_bar_continuous';

  const roles: ChapterRole[] = [];
  if (numChapters === 8) {
    const secondHalfFinal: ChapterRole =
      schemeOverride === 'T-A-T-A' ? 'antithesis' : 'synthesis';
    roles.push(
      'thesis',
      'antithesis',
      'thesis',
      'antithesis',
      'thesis',
      'antithesis',
      'thesis',
      secondHalfFinal
    );
  } else if (numChapters === 4) {
    roles.push(
      'thesis',
      'antithesis',
      'thesis',
      scheme === 'T-A-T-S' ? 'synthesis' : 'antithesis'
    );
  } else if (numChapters === 2) {
    roles.push('thesis', scheme === 'T-A-T-S' ? 'synthesis' : 'antithesis');
  } else {
    for (let c = 0; c < numChapters; c++) {
      if (c === numChapters - 1 && numChapters >= 3 && scheme === 'T-A-T-S') {
        roles.push('synthesis');
      } else {
        roles.push(c % 2 === 0 ? 'thesis' : 'antithesis');
      }
    }
  }

  // Reserve highest 1..2 semitones of voice range exclusively for Chorus 2nd-half climax
  const nonClimaxMaxMidi = Math.max(voice.minMidi + 8, voice.maxMidi - 2);
  const thesisAnchor = fitNoteIntoVoiceRange(
    Math.round(sectionCenter),
    voice.minMidi + 2,
    Math.max(voice.minMidi + 2, nonClimaxMaxMidi - 2),
    parentScalePcs
  );
  const thesisTop = fitNoteIntoVoiceRange(
    thesisAnchor + 3,
    thesisAnchor + 1,
    nonClimaxMaxMidi,
    parentScalePcs
  );
  const antiAnchor = fitNoteIntoVoiceRange(
    thesisAnchor - 2,
    voice.minMidi,
    Math.max(voice.minMidi, thesisAnchor - 1),
    parentScalePcs
  );
  const antiTop = fitNoteIntoVoiceRange(
    thesisTop - 2,
    voice.minMidi + 1,
    Math.max(voice.minMidi + 1, thesisTop - 1),
    parentScalePcs
  );
  const synthTop = fitNoteIntoVoiceRange(
    thesisTop + 3,
    Math.min(voice.maxMidi, thesisTop + 1),
    sectionRole === 'chorus' ? voice.maxMidi : nonClimaxMaxMidi,
    parentScalePcs
  );
  const synthAnchor = fitNoteIntoVoiceRange(
    thesisAnchor + 2,
    thesisAnchor,
    Math.max(thesisAnchor, synthTop - 1),
    parentScalePcs
  );

  const chapters: DialecticalChapterPlan[] = roles.map((role, idx) => {
    const isRunwayToSynthesis =
      idx + 1 < roles.length && roles[idx + 1] === 'synthesis';
    const isStrongCadence = idx === roles.length - 1;
    const form: ChapterInternalForm =
      role === 'synthesis'
        ? formOverride === 'two_bar_continuous'
          ? 'two_bar_continuous'
          : rng() < profile.synthesisContinuousProb
            ? 'two_bar_continuous'
            : 'one_bar_repeat_with_passing'
        : formOverride === 'two_bar_continuous' ||
            formOverride === 'one_bar_repeat_with_passing'
          ? formOverride
          : thesisForm;

    return {
      chapterIndex: idx,
      startTick: idx * CHAPTER_TICKS,
      role,
      form,
      anchorPitch:
        role === 'synthesis'
          ? synthAnchor
          : role === 'antithesis'
            ? antiAnchor
            : thesisAnchor,
      topPitch:
        role === 'synthesis'
          ? synthTop
          : role === 'antithesis'
            ? antiTop
            : thesisTop,
      isRunwayToSynthesis,
      isStrongCadence,
    };
  });

  const thesisZone1Template =
    PATTERN2_ZONE1_TEMPLATES[
      Math.floor(rng() * PATTERN2_ZONE1_TEMPLATES.length)
    ];
  const thesisContinuousTemplate =
    PATTERN1_CONTINUOUS_TEMPLATES[
      Math.floor(rng() * PATTERN1_CONTINUOUS_TEMPLATES.length)
    ];

  const baseVelocity =
    sectionRole === 'chorus' || section.energy === 'High'
      ? 104
      : section.energy === 'Low'
        ? 84
        : 94;
  const fallCfg: FallExpressionConfig = {
    ...rfProfile.fallConfig,
    dropSemitones: profile.fallSemitones,
  };
  const temperature = style === 'A' ? 0.55 : style === 'B' ? 0.75 : 0.95;

  // Track reference Thesis step contour & climax peak quota
  let referenceThesisDeltas: number[] | null = null;
  let climaxHighCount = 0;
  let prevNotePitch: number | undefined;
  let prevDelta = 0;
  let prevWasHookOrGuide = false;
  let prevChordRootPc: number | undefined;
  let samePitchRun = 0;

  // Physiological breath tracking (continuous singing duration in ticks)
  const maxPhraseTicks = Math.max(
    BAR_TICKS,
    Math.round((voice.maxPhraseDurationSec * song.bpm * TPQN) / 60)
  );
  let activePhraseStartTick: number | null = null;
  let lastNoteOffTick = -BAR_TICKS;

  const generatedNotes: GeneratedVocalNote[] = [];

  for (let cIdx = 0; cIdx < chapters.length; cIdx++) {
    const ch = chapters[cIdx];
    const chEndTick = Math.min(sectionEndTick, ch.startTick + CHAPTER_TICKS);
    const chLen = chEndTick - ch.startTick;

    // Attenuate syncopated pickup when BPM > 120
    const attenuatedProfile: GenreDialecticalProfile =
      song.bpm > 120
        ? {
            ...profile,
            allowSyncopatedPickup:
              profile.allowSyncopatedPickup &&
              rng() < computeAnticipationProbability(1.0, song.bpm, 120),
          }
        : profile;

    const slots = buildChapterSlotsForForm({
      chapter: ch,
      chapterLenTicks: chLen,
      profile: attenuatedProfile,
      rfProfile,
      vocalDensity,
      activePreset,
      formOverride,
      thesisZone1Template,
      thesisContinuousTemplate,
      rng,
    });

    const isChorusSecondHalfClimax =
      sectionRole === 'chorus' &&
      (ch.role === 'synthesis' || cIdx >= Math.floor(chapters.length / 2));

    const chapterCenter =
      sectionCenter +
      (ch.role === 'synthesis' ? 2.5 : ch.role === 'antithesis' ? -2.0 : 0);

    const chapterPitches: number[] = [];
    const chapterDeltas: number[] = [];
    const zone1Pitches: number[] = [];

    for (let sIdx = 0; sIdx < slots.length; sIdx++) {
      const s = slots[sIdx];
      const absStart = ch.startTick + s.relTick;
      if (absStart >= sectionEndTick) continue;

      const nextSlotStart =
        sIdx + 1 < slots.length
          ? ch.startTick + slots[sIdx + 1].relTick
          : chEndTick;
      const maxSpan = Math.max(60, nextSlotStart - absStart);
      let gridDur = Math.max(
        120,
        Math.min(s.gridDuration, maxSpan)
      );
      // Quantize gridDur cleanly to 60-tick units
      gridDur = Math.max(60, Math.round(gridDur / 60) * 60);
      if (gridDur > maxSpan) {
        gridDur = Math.max(60, Math.floor(maxSpan / 60) * 60);
      }

      // Physiological breath guard: enforce >= 240-tick rest before exceeding maxPhraseDurationSec
      const gapSinceLast = absStart - lastNoteOffTick;
      if (gapSinceLast >= 240 || activePhraseStartTick === null) {
        activePhraseStartTick = absStart;
      } else {
        const projectedSpan = absStart + gridDur - activePhraseStartTick;
        if (projectedSpan > maxPhraseTicks) {
          // If this is a short passing/step note and not the chapter onset or cadence, skip it to create a breath!
          const isSkippable =
            sIdx > 0 &&
            sIdx < slots.length - 1 &&
            gridDur <= 360 &&
            !s.isPeakSlot;
          if (isSkippable) {
            activePhraseStartTick = null;
            continue;
          }
          // Otherwise trim previous note by >= 240 ticks if previous note was >= 600 ticks
          const prevGen = generatedNotes[generatedNotes.length - 1];
          if (prevGen && prevGen.gateDuration >= 600) {
            const trimmedDur = Math.max(
              240,
              Math.min(prevGen.gateDuration, absStart - 240 - prevGen.startTick)
            );
            if (trimmedDur >= 240 && absStart - (prevGen.startTick + trimmedDur) >= 240) {
              generatedNotes[generatedNotes.length - 1] = {
                ...prevGen,
                gridDuration: trimmedDur,
                gateDuration: trimmedDur,
                hasFall: false,
                fallConfig: undefined,
              };
              lastNoteOffTick = prevGen.startTick + trimmedDur;
              activePhraseStartTick = absStart;
            }
          }
        }
      }

      const effChord = resolveEffectiveChord(absStart, gridDur, chordEvents);
      const nextChordIdx = chordEvents.indexOf(effChord) + 1;
      const nextChord =
        nextChordIdx > 0 && nextChordIdx < chordEvents.length
          ? chordEvents[nextChordIdx]
          : undefined;

      // Determine ceiling for this slot (reserving top 1..2 semitones for Chorus 2nd-half climax, max 2 hits)
      const allowClimaxTop =
        isChorusSecondHalfClimax &&
        climaxHighCount < 2 &&
        Boolean(s.isPeakSlot || ch.role === 'synthesis');
      const slotMaxMidi = allowClimaxTop ? voice.maxMidi : nonClimaxMaxMidi;
      const slotMinMidi = voice.minMidi;

      // Build candidate pitches strictly inside [voice.minMidi, slotMaxMidi]
      const ctSet = new Set(effChord.chordTonePcs);
      const gtSet = new Set(effChord.guideTonePcs);
      const atSet = new Set(effChord.availableTensionPcs);
      const avSet = new Set(effChord.avoidPcs);
      const hookSet = new Set(effChord.hookPcs);
      const chordScaleSet = new Set(effChord.scalePcs);
      const nextCtSet = nextChord ? new Set(nextChord.chordTonePcs) : null;

      const isStrongOrLong =
        gridDur >= 480 || STRONG_BEAT_REL_TICKS.has(s.relTick) || s.tag === 'cadence';

      // Target contour delta from Thesis T1 (or Zone 1 repeat in Pattern 2)
      let targetStepDelta: number | undefined;
      if (
        ch.form === 'one_bar_repeat_with_passing' &&
        s.relTick >= BAR_TICKS &&
        s.relTick < 3360 &&
        zone1Pitches.length >= 2
      ) {
        const z3Pos = chapterPitches.length - zone1Pitches.length - 1;
        if (z3Pos >= 1 && z3Pos < zone1Pitches.length) {
          targetStepDelta = zone1Pitches[z3Pos] - zone1Pitches[z3Pos - 1];
        }
      } else if (
        referenceThesisDeltas &&
        sIdx > 0 &&
        sIdx < referenceThesisDeltas.length
      ) {
        targetStepDelta = referenceThesisDeltas[sIdx];
      }

      const scoredCandidates: Array<{ pitch: number; score: number }> = [];
      for (let p = slotMinMidi; p <= slotMaxMidi; p++) {
        const pc = p % 12;

        // When chord is diatonic, strictly stay inside parent key scale (100% key conformance)
        if (!effChord.isNonDiatonic && !parentScalePcs.has(pc)) {
          continue;
        }
        // When chord is non-diatonic, stay inside active chord scale / chord tones / hook tones
        if (
          effChord.isNonDiatonic &&
          !chordScaleSet.has(pc) &&
          !ctSet.has(pc) &&
          !hookSet.has(pc) &&
          !parentScalePcs.has(pc)
        ) {
          continue;
        }

        // 1. H(p, effChord): Harmonic consonance vs tension vs avoid
        let hScore = 0;
        if (gtSet.has(pc)) {
          hScore = isStrongOrLong ? 3.5 : 2.3;
        } else if (ctSet.has(pc)) {
          hScore = isStrongOrLong ? 3.1 : 2.1;
        } else if (atSet.has(pc)) {
          hScore = isStrongOrLong ? 2.2 : 1.9;
        } else if (avSet.has(pc)) {
          hScore = isStrongOrLong ? -6.5 : -1.4;
        } else if (chordScaleSet.has(pc)) {
          hScore = isStrongOrLong ? 0.4 : 1.4;
        } else {
          hScore = -8.0;
        }

        // Cadence tonic gravity at final note of section
        if (ch.isStrongCadence && sIdx === slots.length - 1 && pc === keySemitone) {
          hScore += 2.2;
        }

        // 2. K(p, effChord, nextChord): Non-diatonic color-tone hook & smooth resolution
        let kScore = 0;
        if (effChord.isNonDiatonic && hookSet.has(pc)) {
          kScore += isStrongOrLong ? 3.0 : 2.0;
        }
        if (
          prevNotePitch !== undefined &&
          prevWasHookOrGuide &&
          prevChordRootPc !== undefined &&
          prevChordRootPc !== effChord.rootPc &&
          Math.abs(p - prevNotePitch) >= 1 &&
          Math.abs(p - prevNotePitch) <= 2 &&
          ctSet.has(pc)
        ) {
          kScore += 2.8;
        }
        if (
          nextCtSet &&
          nextChord &&
          nextChord.rootPc !== effChord.rootPc &&
          absStart + gridDur >= nextChord.startTick - 240
        ) {
          const resolvesClose =
            nextCtSet.has((pc + 1) % 12) ||
            nextCtSet.has((pc + 11) % 12) ||
            nextCtSet.has((pc + 2) % 12) ||
            nextCtSet.has((pc + 10) % 12);
          if (resolvesClose) kScore += 1.0;
        }

        // 3. Prox(p, prevP): Melodic proximity & anti-monotone
        let proxScore = 0;
        if (prevNotePitch !== undefined) {
          const dist = Math.abs(p - prevNotePitch);
          if (dist === 0) {
            proxScore = samePitchRun >= 3 ? -2.2 : 0.9;
          } else if (dist <= 2) {
            proxScore = 2.5;
          } else if (dist <= 4) {
            proxScore = 1.3;
          } else if (dist === 5 || dist === 7) {
            proxScore = s.isPeakSlot ? 1.1 : -0.5;
          } else if (dist === 6) {
            proxScore = -6.0; // Avoid melodic tritone leap
          } else {
            proxScore = -4.5 - (dist - 7) * 1.3;
          }

          // Guard chapter-end upward leap
          if (sIdx === slots.length - 1) {
            const maxEndUp = ch.isRunwayToSynthesis ? 2 : 0;
            if (p - prevNotePitch > maxEndUp) {
              proxScore -= 6.0;
            }
          }
        }

        // 4. Rev(p, prevP, prevDelta): Post-skip (>= 5st) gap-fill reversal
        let revScore = 0;
        if (prevNotePitch !== undefined && Math.abs(prevDelta) >= 5) {
          const currStep = p - prevNotePitch;
          if (currStep * prevDelta < 0 && Math.abs(currStep) >= 1 && Math.abs(currStep) <= 3) {
            revScore = 3.4;
          } else if (currStep * prevDelta > 0) {
            revScore = -4.2;
          }
        }

        // 5. Cont(p): Dialectical Thesis contour preservation across changing chords
        let contScore = 0;
        if (prevNotePitch !== undefined && targetStepDelta !== undefined) {
          const currDelta = p - prevNotePitch;
          if (Math.sign(currDelta) === Math.sign(targetStepDelta)) {
            contScore += 2.3;
          }
          if (Math.abs(currDelta - targetStepDelta) <= 2) {
            contScore += 1.7;
          }
        } else if (s.isPeakSlot) {
          // Encourage reaching chapter top target on peak slot
          contScore += -0.35 * Math.abs(p - ch.topPitch);
        }

        // 6. G(p): Pentatonic singability gravity
        const gScore = pentatonicPcs.has(pc) ? 0.85 : 0;

        // 7. Tess(p): Voice profile optimal tessitura pull
        const tessDiff = p - chapterCenter;
        const tessScore = -0.15 * tessDiff * tessDiff;

        const totalScore =
          hScore + kScore + proxScore + revScore + contScore + gScore + tessScore;
        scoredCandidates.push({ pitch: p, score: totalScore });
      }

      const chosenPitch =
        scoredCandidates.length > 0
          ? sampleTopKSoftmax(scoredCandidates, 3, temperature, rng)
          : fitNoteIntoVoiceRange(
              Math.round(chapterCenter),
              voice.minMidi,
              slotMaxMidi,
              parentScalePcs
            );

      if (chosenPitch >= voice.maxMidi - 1) {
        climaxHighCount++;
      }

      const stepDelta =
        prevNotePitch !== undefined ? chosenPitch - prevNotePitch : 0;
      samePitchRun =
        prevNotePitch !== undefined && chosenPitch === prevNotePitch
          ? samePitchRun + 1
          : 1;
      prevDelta = stepDelta;
      prevNotePitch = chosenPitch;
      prevWasHookOrGuide =
        hookSet.has(chosenPitch % 12) || gtSet.has(chosenPitch % 12);
      prevChordRootPc = effChord.rootPc;

      chapterPitches.push(chosenPitch);
      chapterDeltas.push(stepDelta);
      if (s.relTick < 1440) {
        zone1Pitches.push(chosenPitch);
      }

      const maxGateWithGap =
        sIdx + 1 < slots.length || chEndTick < sectionEndTick
          ? Math.max(120, maxSpan - VOISONA_MIN_GAP_TICKS)
          : maxSpan;
      const gateDur = Math.max(
        120,
        Math.min(gridDur, maxGateWithGap, Math.round(gridDur * s.gateRatio))
      );

      const trailingPureRest = nextSlotStart - (absStart + gridDur);
      const isFallCandidate =
        (s.role === 'top_fall' || Boolean(ch.role === 'synthesis' && s.isPeakSlot)) &&
        gridDur >= fallCfg.minGridDurationTicks &&
        trailingPureRest >= fallCfg.minTrailingRestTicks;
      const hasFall = isFallCandidate && rng() < fallCfg.probability;

      generatedNotes.push({
        startTick: absStart,
        gridDuration: gridDur,
        gateDuration: gateDur,
        midiPitch: chosenPitch,
        velocity: clampVelocity(Math.round(baseVelocity * s.velocityScale)),
        role: s.role,
        hasFall,
        fallConfig: hasFall ? { ...fallCfg } : undefined,
      });

      lastNoteOffTick = absStart + gateDur;
    }

    if (ch.role === 'thesis' && referenceThesisDeltas === null && chapterDeltas.length > 0) {
      referenceThesisDeltas = chapterDeltas;
    }
  }

  const midiNotes: MidiNote[] = toMidiNotesFromGenerated(generatedNotes);
  const vocalMinMidiByBar = computeVocalMinMidiByBar(midiNotes, section.bars);

  return {
    genreId,
    voiceProfile: voice,
    chordEvents,
    scheme,
    thesisForm,
    chapters,
    notes: generatedNotes,
    midiNotes,
    vocalMinMidiByBar,
  };
}

// ===========================================================================
// Dialectical 3-Chapter Model (T-A-T-A / T-A-T-S) x 2 Internal Forms
// ===========================================================================

function nearestScalePitchInRange(
  target: number,
  minAllowed: number,
  maxAllowed: number,
  scalePcs: ReadonlySet<number>
): number {
  const lo = Math.max(VOCAL_MIN_PITCH, Math.min(VOCAL_MAX_PITCH, Math.round(minAllowed)));
  const hi = Math.max(lo, Math.min(VOCAL_MAX_PITCH, Math.round(maxAllowed)));
  let best = -1;
  let bestDist = Infinity;
  for (let p = lo; p <= hi; p++) {
    if (!scalePcs.has(p % 12)) continue;
    const d = Math.abs(p - target);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (best !== -1) return best;
  return nearestScalePitch(target, scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH);
}

function stepInScale(
  pitch: number,
  deltaSteps: number,
  fullScale: readonly number[],
  minP = VOCAL_MIN_PITCH,
  maxP = VOCAL_MAX_PITCH
): number {
  const idx = findClosestIndex(fullScale, pitch);
  const nextIdx = Math.max(0, Math.min(fullScale.length - 1, idx + deltaSteps));
  const cand = fullScale[nextIdx];
  if (cand < minP) {
    return fullScale.find((p) => p >= minP) ?? cand;
  }
  if (cand > maxP) {
    for (let i = fullScale.length - 1; i >= 0; i--) {
      if (fullScale[i] <= maxP) return fullScale[i];
    }
  }
  return cand;
}

interface DialecticalCellSlot {
  readonly relTick: number;
  readonly gridDuration: number;
  readonly gateRatio: number;
  readonly role: NoteRole;
  readonly tag: NoteFunctionTag;
  readonly velocityScale: number;
  readonly isPeakSlot?: boolean;
}

const PATTERN2_ZONE1_TEMPLATES: readonly (readonly DialecticalCellSlot[])[] = [
  [
    { relTick: 0, gridDuration: 480, gateRatio: 0.84, role: 'anchor', tag: 'core', velocityScale: 0.98 },
    { relTick: 480, gridDuration: 480, gateRatio: 0.84, role: 'step', tag: 'core', velocityScale: 0.94, isPeakSlot: true },
    { relTick: 960, gridDuration: 480, gateRatio: 0.84, role: 'hook_stab', tag: 'core', velocityScale: 1.0 },
  ],
  [
    { relTick: 0, gridDuration: 240, gateRatio: 0.8, role: 'anchor', tag: 'core', velocityScale: 0.98 },
    { relTick: 240, gridDuration: 480, gateRatio: 0.84, role: 'sync_tie', tag: 'core', velocityScale: 1.0, isPeakSlot: true },
    { relTick: 720, gridDuration: 480, gateRatio: 0.84, role: 'step', tag: 'core', velocityScale: 0.94 },
  ],
  [
    { relTick: 0, gridDuration: 360, gateRatio: 0.82, role: 'hook_stab', tag: 'core', velocityScale: 1.0 },
    { relTick: 360, gridDuration: 360, gateRatio: 0.82, role: 'sync_tie', tag: 'core', velocityScale: 0.96, isPeakSlot: true },
    { relTick: 720, gridDuration: 480, gateRatio: 0.84, role: 'step', tag: 'core', velocityScale: 0.94 },
  ],
];

const PATTERN1_CONTINUOUS_TEMPLATES: readonly (readonly DialecticalCellSlot[])[] = [
  [
    { relTick: 0, gridDuration: 480, gateRatio: 0.86, role: 'anchor', tag: 'core', velocityScale: 0.96 },
    { relTick: 480, gridDuration: 240, gateRatio: 0.82, role: 'step', tag: 'arc', velocityScale: 0.92 },
    { relTick: 720, gridDuration: 480, gateRatio: 0.86, role: 'sync_tie', tag: 'arc', velocityScale: 1.0 },
    { relTick: 1200, gridDuration: 480, gateRatio: 0.86, role: 'hook_stab', tag: 'arc', velocityScale: 1.04, isPeakSlot: true },
    { relTick: 1920, gridDuration: 480, gateRatio: 0.86, role: 'step', tag: 'arc', velocityScale: 0.96 },
    { relTick: 2400, gridDuration: 960, gateRatio: 0.88, role: 'top_fall', tag: 'cadence', velocityScale: 1.02 },
  ],
  [
    { relTick: 240, gridDuration: 240, gateRatio: 0.82, role: 'pickup', tag: 'core', velocityScale: 0.88 },
    { relTick: 480, gridDuration: 480, gateRatio: 0.86, role: 'anchor', tag: 'core', velocityScale: 0.96 },
    { relTick: 960, gridDuration: 720, gateRatio: 0.88, role: 'sync_tie', tag: 'arc', velocityScale: 1.04, isPeakSlot: true },
    { relTick: 1920, gridDuration: 240, gateRatio: 0.82, role: 'step', tag: 'arc', velocityScale: 0.92 },
    { relTick: 2160, gridDuration: 240, gateRatio: 0.82, role: 'step', tag: 'arc', velocityScale: 0.94 },
    { relTick: 2400, gridDuration: 960, gateRatio: 0.9, role: 'top_fall', tag: 'cadence', velocityScale: 1.04 },
  ],
  [
    { relTick: 0, gridDuration: 480, gateRatio: 0.86, role: 'anchor', tag: 'core', velocityScale: 0.98 },
    { relTick: 480, gridDuration: 480, gateRatio: 0.86, role: 'step', tag: 'arc', velocityScale: 0.95 },
    { relTick: 960, gridDuration: 480, gateRatio: 0.88, role: 'hook_stab', tag: 'arc', velocityScale: 1.04, isPeakSlot: true },
    { relTick: 1440, gridDuration: 480, gateRatio: 0.86, role: 'step', tag: 'arc', velocityScale: 0.98 },
    { relTick: 1920, gridDuration: 480, gateRatio: 0.86, role: 'step', tag: 'arc', velocityScale: 0.94 },
    { relTick: 2400, gridDuration: 960, gateRatio: 0.88, role: 'top_fall', tag: 'cadence', velocityScale: 1.04 },
  ],
];

const PATTERN1_SYNTHESIS_TEMPLATES: readonly (readonly DialecticalCellSlot[])[] = [
  [
    { relTick: 0, gridDuration: 480, gateRatio: 0.88, role: 'anchor', tag: 'core', velocityScale: 1.0 },
    { relTick: 480, gridDuration: 480, gateRatio: 0.88, role: 'step', tag: 'arc', velocityScale: 1.02 },
    { relTick: 960, gridDuration: 720, gateRatio: 0.9, role: 'top_fall', tag: 'arc', velocityScale: 1.1, isPeakSlot: true },
    { relTick: 1920, gridDuration: 480, gateRatio: 0.86, role: 'step', tag: 'arc', velocityScale: 1.0 },
    { relTick: 2400, gridDuration: 960, gateRatio: 0.9, role: 'phrase_land', tag: 'cadence', velocityScale: 1.05 },
  ],
  [
    { relTick: 0, gridDuration: 480, gateRatio: 0.86, role: 'anchor', tag: 'core', velocityScale: 1.0 },
    { relTick: 480, gridDuration: 480, gateRatio: 0.88, role: 'step', tag: 'arc', velocityScale: 1.04 },
    { relTick: 960, gridDuration: 480, gateRatio: 0.88, role: 'hook_stab', tag: 'arc', velocityScale: 1.08, isPeakSlot: true },
    { relTick: 1440, gridDuration: 480, gateRatio: 0.88, role: 'sync_tie', tag: 'arc', velocityScale: 1.1, isPeakSlot: true },
    { relTick: 1920, gridDuration: 480, gateRatio: 0.86, role: 'step', tag: 'arc', velocityScale: 1.0 },
    { relTick: 2400, gridDuration: 960, gateRatio: 0.9, role: 'top_fall', tag: 'cadence', velocityScale: 1.06 },
  ],
];

const ANTICIPATION_TEMPLATE_2BAR: readonly DialecticalCellSlot[] = [
  { relTick: 240, gridDuration: 480, gateRatio: 0.82, role: 'pickup', tag: 'core', velocityScale: 0.94 },
  { relTick: 720, gridDuration: 480, gateRatio: 0.82, role: 'sync_tie', tag: 'arc', velocityScale: 1.0 },
  { relTick: 1200, gridDuration: 240, gateRatio: 0.75, role: 'rush', tag: 'arc', velocityScale: 0.92 },
  { relTick: 1440, gridDuration: 240, gateRatio: 0.75, role: 'rush', tag: 'arc', velocityScale: 0.94 },
  { relTick: 1680, gridDuration: 480, gateRatio: 0.84, role: 'sync_tie', tag: 'arc', velocityScale: 1.06, isPeakSlot: true },
  { relTick: 2160, gridDuration: 240, gateRatio: 0.78, role: 'step', tag: 'arc', velocityScale: 0.94 },
  { relTick: 2400, gridDuration: 960, gateRatio: 0.86, role: 'top_fall', tag: 'cadence', velocityScale: 1.06 },
];

export function planDialecticalChapters(params: {
  genreId: MasterGenre;
  sectionRole: NormalizedSectionRole;
  bars: number;
  scalePcs: ReadonlySet<number>;
  keySemitone: number;
  rng: () => number;
  schemeOverride?: EightBarScheme | 'auto';
  formOverride?: ChapterInternalForm | 'auto';
  prevVocalAvgPitch?: number;
}): {
  scheme: EightBarScheme;
  thesisForm: ChapterInternalForm;
  chapters: DialecticalChapterPlan[];
} {
  const {
    genreId,
    sectionRole,
    bars,
    scalePcs,
    keySemitone,
    rng,
    schemeOverride,
    formOverride,
    prevVocalAvgPitch,
  } = params;
  const profile = GENRE_DIALECTICAL_PROFILES[genreId];
  const rfProfile = RHYTHM_FIRST_GENRE_PROFILES[genreId];
  const numChapters = Math.max(1, Math.ceil(bars / 2));

  // Resolve 8-bar scheme
  const isClimaxSection = sectionRole === 'chorus' || sectionRole === 'bridge';
  let scheme: EightBarScheme;
  if (schemeOverride === 'T-A-T-A' || schemeOverride === 'T-A-T-S') {
    scheme = schemeOverride;
  } else if (bars === 16) {
    scheme = 'T-A-T-S';
  } else {
    const prob = isClimaxSection ? profile.chorusTatsProb : profile.chorusTatsProb * 0.45;
    scheme = rng() < prob ? 'T-A-T-S' : 'T-A-T-A';
  }

  // Resolve thesis internal form (shared between T1 and T2, and between 1st & 2nd 8-bar halves in 16-bar)
  const thesisForm: ChapterInternalForm =
    formOverride === 'two_bar_continuous' || formOverride === 'one_bar_repeat_with_passing'
      ? formOverride
      : rng() < profile.pattern2Prob
        ? 'one_bar_repeat_with_passing'
        : 'two_bar_continuous';

  // Compute comfortable thesis anchor & top pitch with guaranteed room for antithesis (-4) and synthesis (+5)
  const sectionShift = rfProfile.sectionShifts[sectionRole] ?? 0;
  const baseRegister =
    genreId === 'numetal_mixture' ? 57 : genreId === 'chill_ballad' ? 58 : 59;
  const tonicNear = fitPitchClassToRange(keySemitone, baseRegister - 2, baseRegister + 2);
  let rawAnchor = Math.round((baseRegister + tonicNear) * 0.5) + sectionShift;
  if (prevVocalAvgPitch !== undefined && !Number.isNaN(prevVocalAvgPitch)) {
    rawAnchor = Math.round(
      Math.max(prevVocalAvgPitch - 2.5, Math.min(prevVocalAvgPitch + 4.0, rawAnchor))
    );
  }
  const thesisAnchor = nearestScalePitchInRange(rawAnchor, 56, 66, scalePcs);
  const thesisTop = nearestScalePitchInRange(
    thesisAnchor + 3,
    thesisAnchor + 2,
    Math.min(70, thesisAnchor + 4),
    scalePcs
  );

  // Antithesis drop (-1..-4 semitones, preferring genre antithesisDropRange)
  const [dropMin, dropMax] = profile.antithesisDropRange;
  const dropChoices: number[] = [];
  for (let d = dropMin; d <= dropMax; d++) dropChoices.push(d);
  const chosenDrop = dropChoices[Math.floor(rng() * dropChoices.length)] ?? dropMin;
  const antiTop = nearestScalePitchInRange(
    thesisTop + chosenDrop,
    thesisTop - 4,
    thesisTop - 1,
    scalePcs
  );
  const antiAnchor = nearestScalePitchInRange(
    thesisAnchor + chosenDrop,
    Math.max(VOCAL_MIN_PITCH + 2, thesisAnchor - 4),
    Math.min(antiTop, thesisAnchor - 1),
    scalePcs
  );

  // Synthesis rebound (+2..+5 semitones, preferring genre synthesisReboundRange)
  const [rebMin, rebMax] = profile.synthesisReboundRange;
  const rebChoices: number[] = [];
  for (let r = rebMin; r <= rebMax; r++) rebChoices.push(r);
  const chosenRebound = rebChoices[Math.floor(rng() * rebChoices.length)] ?? rebMin;
  const synthTop = nearestScalePitchInRange(
    thesisTop + chosenRebound,
    thesisTop + 2,
    Math.min(VOCAL_MAX_PITCH, thesisTop + 5),
    scalePcs
  );
  const synthAnchor = nearestScalePitchInRange(
    thesisAnchor + Math.max(1, chosenRebound - 2),
    thesisAnchor + 1,
    Math.max(thesisAnchor + 1, synthTop - 1),
    scalePcs
  );

  // Build chapter roles
  const roles: ChapterRole[] = [];
  if (numChapters === 8) {
    // 16-bar structure: first 8 bars = T-A-T-A, second 8 bars = T-A-T-S (unless explicitly forced T-A-T-A)
    const secondHalfFinal: ChapterRole =
      schemeOverride === 'T-A-T-A' ? 'antithesis' : 'synthesis';
    roles.push(
      'thesis',
      'antithesis',
      'thesis',
      'antithesis',
      'thesis',
      'antithesis',
      'thesis',
      secondHalfFinal
    );
  } else if (numChapters === 4) {
    roles.push(
      'thesis',
      'antithesis',
      'thesis',
      scheme === 'T-A-T-S' ? 'synthesis' : 'antithesis'
    );
  } else if (numChapters === 2) {
    roles.push('thesis', scheme === 'T-A-T-S' ? 'synthesis' : 'antithesis');
  } else {
    for (let c = 0; c < numChapters; c++) {
      if (c === numChapters - 1 && numChapters >= 3 && scheme === 'T-A-T-S') {
        roles.push('synthesis');
      } else {
        roles.push(c % 2 === 0 ? 'thesis' : 'antithesis');
      }
    }
  }

  const chapters: DialecticalChapterPlan[] = roles.map((role, idx) => {
    const isRunwayToSynthesis =
      idx + 1 < roles.length && roles[idx + 1] === 'synthesis';
    const isStrongCadence = idx === roles.length - 1;

    let form: ChapterInternalForm;
    if (role === 'thesis') {
      form = thesisForm;
    } else if (role === 'synthesis') {
      form =
        formOverride === 'two_bar_continuous'
          ? 'two_bar_continuous'
          : rng() < profile.synthesisContinuousProb
            ? 'two_bar_continuous'
            : 'one_bar_repeat_with_passing';
    } else {
      // antithesis
      form =
        formOverride === 'two_bar_continuous' || formOverride === 'one_bar_repeat_with_passing'
          ? formOverride
          : thesisForm;
    }

    const anchorPitch =
      role === 'synthesis'
        ? synthAnchor
        : role === 'antithesis'
          ? antiAnchor
          : thesisAnchor;
    const topPitch =
      role === 'synthesis'
        ? synthTop
        : role === 'antithesis'
          ? antiTop
          : thesisTop;

    return {
      chapterIndex: idx,
      startTick: idx * CHAPTER_TICKS,
      role,
      form,
      anchorPitch,
      topPitch,
      isRunwayToSynthesis,
      isStrongCadence,
    };
  });

  return { scheme, thesisForm, chapters };
}

function buildChapterSlotsForForm(params: {
  chapter: DialecticalChapterPlan;
  chapterLenTicks: number;
  profile: GenreDialecticalProfile;
  rfProfile: RhythmFirstGenreProfile;
  vocalDensity: number;
  activePreset: string;
  formOverride?: ChapterInternalForm | 'auto';
  thesisZone1Template: readonly DialecticalCellSlot[];
  thesisContinuousTemplate: readonly DialecticalCellSlot[];
  rng: () => number;
}): DialecticalCellSlot[] {
  const {
    chapter,
    chapterLenTicks,
    profile,
    rfProfile,
    vocalDensity,
    activePreset,
    formOverride,
    thesisZone1Template,
    thesisContinuousTemplate,
    rng,
  } = params;

  // 1-bar fallback for odd-bar / 1-bar sections
  if (chapterLenTicks <= BAR_TICKS) {
    return [
      { relTick: 0, gridDuration: 240, gateRatio: 0.82, role: 'anchor', tag: 'core', velocityScale: 0.96 },
      { relTick: 240, gridDuration: 240, gateRatio: 0.8, role: 'step', tag: 'arc', velocityScale: 0.92 },
      { relTick: 480, gridDuration: 960, gateRatio: 0.88, role: 'top_fall', tag: 'cadence', velocityScale: 1.04, isPeakSlot: true },
    ];
  }

  // Band-unison bar-crossing anticipation preset
  if (activePreset === 'jrock_anticipation') {
    return ANTICIPATION_TEMPLATE_2BAR.map((s) => ({ ...s }));
  }

  // Density extreme scaling when vocalDensity <= 1.5 or >= 4.5 (when form is auto)
  if (
    vocalDensity <= 1.5 &&
    formOverride !== 'one_bar_repeat_with_passing'
  ) {
    return [
      { relTick: 0, gridDuration: 480, gateRatio: 0.88, role: 'anchor', tag: 'core', velocityScale: 0.95 },
      { relTick: 480, gridDuration: 960, gateRatio: 0.9, role: 'sync_tie', tag: 'arc', velocityScale: 1.02, isPeakSlot: true },
      { relTick: 1920, gridDuration: 1200, gateRatio: 0.9, role: 'top_fall', tag: 'cadence', velocityScale: 1.04 },
    ];
  }
  if (
    vocalDensity >= 4.5 &&
    formOverride !== 'one_bar_repeat_with_passing'
  ) {
    return [
      { relTick: 0, gridDuration: 240, gateRatio: 0.72, role: 'anchor', tag: 'core', velocityScale: 0.96 },
      { relTick: 240, gridDuration: 240, gateRatio: 0.72, role: 'rush', tag: 'arc', velocityScale: 0.9 },
      { relTick: 480, gridDuration: 240, gateRatio: 0.72, role: 'rush', tag: 'arc', velocityScale: 0.94 },
      { relTick: 720, gridDuration: 240, gateRatio: 0.74, role: 'sync_tie', tag: 'arc', velocityScale: 0.98 },
      { relTick: 960, gridDuration: 240, gateRatio: 0.74, role: 'hook_stab', tag: 'arc', velocityScale: 1.04, isPeakSlot: true },
      { relTick: 1200, gridDuration: 240, gateRatio: 0.72, role: 'step', tag: 'arc', velocityScale: 0.94 },
      { relTick: 1440, gridDuration: 240, gateRatio: 0.72, role: 'step', tag: 'arc', velocityScale: 0.92 },
      { relTick: 1920, gridDuration: 240, gateRatio: 0.74, role: 'step', tag: 'arc', velocityScale: 0.96 },
      { relTick: 2160, gridDuration: 240, gateRatio: 0.74, role: 'step', tag: 'arc', velocityScale: 0.96 },
      { relTick: 2400, gridDuration: 840, gateRatio: 0.85, role: 'top_fall', tag: 'cadence', velocityScale: 1.06 },
    ];
  }

  // Pattern 2: one_bar_repeat_with_passing
  if (chapter.form === 'one_bar_repeat_with_passing') {
    const z1 = thesisZone1Template.map((s) => ({
      ...s,
      gateRatio: Math.min(0.9, Math.max(0.66, (s.gateRatio + rfProfile.baseGateRatio) * 0.5)),
    }));
    const slots: DialecticalCellSlot[] = [...z1];

    // Zone 2: 1440..1919 passing connector (compress to 1 note [1680] when competing with Runway)
    const useTwoPassing =
      !chapter.isRunwayToSynthesis &&
      z1.length * 2 + 2 <= profile.maxNotesPerChapter &&
      (profile.allowSyncopatedPickup ? rng() < 0.65 : rng() < 0.45);
    if (useTwoPassing) {
      slots.push(
        { relTick: 1440, gridDuration: 240, gateRatio: 0.78, role: 'step', tag: 'passing', velocityScale: 0.9 },
        { relTick: 1680, gridDuration: 240, gateRatio: 0.8, role: 'pickup', tag: 'passing', velocityScale: 0.94 }
      );
    } else {
      slots.push({
        relTick: 1680,
        gridDuration: 240,
        gateRatio: 0.8,
        role: 'pickup',
        tag: 'passing',
        velocityScale: 0.92,
      });
    }

    // Zone 3: 1920..3359 exact Bar 2 core repeat of Zone 1
    for (let i = 0; i < z1.length; i++) {
      const src = z1[i];
      const isLastZ3 = i === z1.length - 1;
      const z3Rel = BAR_TICKS + src.relTick;
      const z3Grid = isLastZ3
        ? chapter.isRunwayToSynthesis
          ? Math.max(240, 3360 - z3Rel)
          : Math.min(960, 3600 - z3Rel)
        : src.gridDuration;
      slots.push({
        relTick: z3Rel,
        gridDuration: z3Grid,
        gateRatio: isLastZ3 && !chapter.isRunwayToSynthesis ? Math.min(0.92, rfProfile.baseGateRatio) : src.gateRatio,
        role: isLastZ3 && !chapter.isRunwayToSynthesis ? 'top_fall' : src.role,
        tag: isLastZ3 && !chapter.isRunwayToSynthesis ? 'cadence' : 'core',
        velocityScale: isLastZ3 ? 1.04 : src.velocityScale,
        isPeakSlot: src.isPeakSlot,
      });
    }

    // Zone 4: 3360..3839 Runway (2 ascending scale notes at 3360, 3600) ONLY on isRunwayToSynthesis
    if (chapter.isRunwayToSynthesis) {
      slots.push(
        { relTick: 3360, gridDuration: 240, gateRatio: 0.82, role: 'pickup', tag: 'runway', velocityScale: 0.96 },
        { relTick: 3600, gridDuration: 240, gateRatio: 0.86, role: 'pickup', tag: 'runway', velocityScale: 1.04 }
      );
    }

    return slots.slice(0, profile.maxNotesPerChapter);
  }

  // Pattern 1: two_bar_continuous
  const baseTpl =
    chapter.role === 'synthesis'
      ? PATTERN1_SYNTHESIS_TEMPLATES[
          Math.floor(rng() * PATTERN1_SYNTHESIS_TEMPLATES.length)
        ]
      : thesisContinuousTemplate;

  const slots: DialecticalCellSlot[] = baseTpl.map((s) => ({
    ...s,
    gateRatio: Math.min(0.92, Math.max(0.68, (s.gateRatio + rfProfile.baseGateRatio) * 0.5)),
  }));

  if (chapter.isRunwayToSynthesis) {
    // Trim any tail encroaching into 3360..3839 and append 2 ascending runway notes
    const trimmed: DialecticalCellSlot[] = [];
    for (const s of slots) {
      if (s.relTick >= 3360) continue;
      const maxGrid = 3360 - s.relTick;
      trimmed.push({
        ...s,
        gridDuration: Math.max(240, Math.min(s.gridDuration, maxGrid)),
        role: s.relTick + s.gridDuration >= 3360 ? 'step' : s.role,
      });
    }
    trimmed.push(
      { relTick: 3360, gridDuration: 240, gateRatio: 0.82, role: 'pickup', tag: 'runway', velocityScale: 0.96 },
      { relTick: 3600, gridDuration: 240, gateRatio: 0.86, role: 'pickup', tag: 'runway', velocityScale: 1.04 }
    );
    return trimmed.slice(0, profile.maxNotesPerChapter);
  }

  return slots.slice(0, profile.maxNotesPerChapter);
}

const STRONG_BEAT_REL_TICKS = new Set([0, 480, 960, 1920, 2400, 2880]);

export function generateDialecticalVocal(
  input: EngineInput
): DialecticalGenerationResult {
  const { song, section, seed, style, prevVocalAvgPitch } = input;
  const genreId: MasterGenre = resolveMasterGenreForVocal(input);
  const profile = GENRE_DIALECTICAL_PROFILES[genreId];
  const rfProfile = RHYTHM_FIRST_GENRE_PROFILES[genreId];
  const sectionRole = normalizeSectionRole(section.type, section.energy, section.name);

  const styleOffsetSeed = style === 'B' ? 0x1f3d5b79 : style === 'C' ? 0x5a3c9e17 : 0;
  const rng = mulberry32((((seed ^ styleOffsetSeed) >>> 0) + 1) >>> 0);

  const keySemitone = noteNameToSemitone(song.key);
  const scalePcs = new Set(getScalePitchClasses(song.key, song.scale));
  const fullScale = buildScaleGrid(scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH);
  const safeFullScale =
    fullScale.length > 0
      ? fullScale
      : [nearestScalePitch(60, scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH)];

  const schemeOverride =
    input.vocalDialecticalScheme ?? section.vocalDialecticalScheme ?? 'auto';
  const formOverride =
    input.vocalChapterForm ?? section.vocalChapterForm ?? 'auto';
  const activePreset = (
    section.patternPresets?.vocal ??
    section.partPresets?.vocal ??
    song.members.vocal?.patternPreset ??
    'auto'
  ).trim();
  const vocalDensity = Math.max(1.0, Math.min(5.0, section.vocalDensity ?? 3.0));
  const sectionEndTick = section.bars * BAR_TICKS;

  const { scheme, thesisForm, chapters } = planDialecticalChapters({
    genreId,
    sectionRole,
    bars: section.bars,
    scalePcs,
    keySemitone,
    rng,
    schemeOverride,
    formOverride,
    prevVocalAvgPitch,
  });

  // Shared thesis rhythm skeletons (guaranteed identical across T1, T2, and 16-bar T3/T4)
  const thesisZone1Template =
    PATTERN2_ZONE1_TEMPLATES[Math.floor(rng() * PATTERN2_ZONE1_TEMPLATES.length)];
  const thesisContinuousTemplate =
    PATTERN1_CONTINUOUS_TEMPLATES[
      Math.floor(rng() * PATTERN1_CONTINUOUS_TEMPLATES.length)
    ];

  // Shared thesis Zone 1 diatonic step offsets for catchy T1/T2 motif identity
  const thesisZone1RelSteps: number[] = [0, 1, 0];
  if (rng() < 0.5) {
    thesisZone1RelSteps[1] = 1;
    thesisZone1RelSteps[2] = -1;
  }

  const baseVelocity =
    sectionRole === 'chorus' || section.energy === 'High'
      ? 104
      : section.energy === 'Low'
        ? 84
        : 94;

  const fallCfg: FallExpressionConfig = {
    ...rfProfile.fallConfig,
    dropSemitones: profile.fallSemitones,
  };

  const chapterNotesMap = new Map<number, DialecticalVocalNote[]>();
  let lastThesisMeanPitch: number | undefined;
  let lastThesisTopPitch: number | undefined;

  for (let cIdx = 0; cIdx < chapters.length; cIdx++) {
    const ch = chapters[cIdx];
    const chEndTick = Math.min(sectionEndTick, ch.startTick + CHAPTER_TICKS);
    const chLen = chEndTick - ch.startTick;

    const slots = buildChapterSlotsForForm({
      chapter: ch,
      chapterLenTicks: chLen,
      profile,
      rfProfile,
      vocalDensity,
      activePreset,
      formOverride,
      thesisZone1Template,
      thesisContinuousTemplate,
      rng,
    });

    const minChPitch = Math.max(VOCAL_MIN_PITCH, ch.anchorPitch - 4);
    const maxChPitch = ch.topPitch;
    const rawPitches: number[] = [];

    // 1. Generate raw scale-conforming dialectical contour per slot
    if (ch.form === 'one_bar_repeat_with_passing') {
      const z1Pitches: number[] = [];
      let z1Idx = 0;
      let z3Idx = 0;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.relTick < 1440) {
          // Zone 1 core motif
          let p: number;
          if (s.isPeakSlot) {
            p = maxChPitch;
          } else {
            const stepOff = thesisZone1RelSteps[z1Idx % thesisZone1RelSteps.length] ?? 0;
            p = stepInScale(ch.anchorPitch, stepOff, safeFullScale, minChPitch, maxChPitch);
          }
          z1Pitches.push(p);
          rawPitches.push(p);
          z1Idx++;
        } else if (s.tag === 'passing') {
          // Zone 2 passing connector (pure scale tone stepping smoothly toward Zone 3)
          const prevP = rawPitches[rawPitches.length - 1] ?? ch.anchorPitch;
          const stepDir = prevP >= ch.anchorPitch ? -1 : 1;
          const p = stepInScale(prevP, stepDir, safeFullScale, minChPitch, maxChPitch);
          rawPitches.push(p);
        } else if (s.tag === 'runway') {
          // Zone 4 ascending runway notes toward next synthesis chapter
          const nextCh = chapters[cIdx + 1];
          const targetNext = nextCh ? nextCh.anchorPitch : ch.topPitch;
          const isSecondRunway = i === slots.length - 1;
          const prevP = rawPitches[rawPitches.length - 1] ?? ch.anchorPitch;
          if (!isSecondRunway) {
            const r1 = stepInScale(
              Math.min(targetNext - 2, ch.anchorPitch),
              0,
              safeFullScale,
              minChPitch,
              Math.max(minChPitch, maxChPitch - 1)
            );
            rawPitches.push(r1);
          } else {
            const r2 = stepInScale(prevP, 1, safeFullScale, prevP + 1, maxChPitch);
            rawPitches.push(Math.min(maxChPitch, r2));
          }
        } else {
          // Zone 3 exact Bar 2 core repeat (preserves diatonic contour for combined >= 0.70)
          const mirrored = z1Pitches[z3Idx] ?? ch.anchorPitch;
          rawPitches.push(mirrored);
          z3Idx++;
        }
      }
    } else {
      // Pattern 1: two_bar_continuous (or synthesis soaring arch)
      let prevP = ch.anchorPitch;
      let peakPlaced = false;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const isLast = i === slots.length - 1;
        let p: number;

        if (s.tag === 'runway') {
          const isSecondRunway = i === slots.length - 1;
          if (!isSecondRunway) {
            p = stepInScale(
              ch.anchorPitch,
              0,
              safeFullScale,
              minChPitch,
              Math.max(minChPitch, maxChPitch - 1)
            );
          } else {
            p = stepInScale(prevP, 1, safeFullScale, prevP + 1, maxChPitch);
          }
        } else if (ch.role === 'synthesis') {
          // Synthesis: peak in mid-chapter (960..1920), followed by Post-skip Reversal stepwise descent
          if (s.isPeakSlot && s.relTick >= 960 && s.relTick <= 1920) {
            p = maxChPitch;
            peakPlaced = true;
          } else if (peakPlaced) {
            // Post-skip reversal: step smoothly downward toward anchor / tonic
            p = stepInScale(prevP, -1, safeFullScale, minChPitch, Math.max(minChPitch, maxChPitch - 1));
          } else {
            // Lead-in climb toward mid-chapter climax
            p = stepInScale(
              ch.anchorPitch,
              i === 0 ? 0 : 1,
              safeFullScale,
              minChPitch,
              Math.max(minChPitch, maxChPitch - 1)
            );
          }
        } else if (s.isPeakSlot && !isLast) {
          p = maxChPitch;
          peakPlaced = true;
        } else if (isLast) {
          // Chapter cadence landing (never leaps upward >= +5; settles downward or holds)
          const cadenceTarget = ch.isStrongCadence
            ? fitPitchClassToRange(keySemitone, minChPitch, ch.anchorPitch)
            : ch.anchorPitch;
          const snappedCadence = nearestScalePitchInRange(
            cadenceTarget,
            Math.max(minChPitch, prevP - 4),
            Math.min(maxChPitch, prevP),
            scalePcs
          );
          p = snappedCadence;
        } else if (i === 0) {
          p = ch.anchorPitch;
        } else {
          const stepDelta = peakPlaced ? -1 : rng() < 0.55 ? 1 : 0;
          p = stepInScale(prevP, stepDelta, safeFullScale, minChPitch, maxChPitch);
        }

        rawPitches.push(p);
        prevP = p;
      }
    }

    // 2. Harmonic Snapping (Zone 1 & Zone 3 strong beats + cadence only; never Zone 2 passing / Zone 4 runway)
    const snappedPitches = [...rawPitches];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.tag === 'passing' || s.tag === 'runway') continue;
      if (s.isPeakSlot && snappedPitches[i] === maxChPitch) continue; // Preserve exact dialectical topPitch
      const isStrongOrCadence =
        STRONG_BEAT_REL_TICKS.has(s.relTick) || s.tag === 'cadence';
      if (!isStrongOrCadence) continue;

      // For Pattern 2 Zone 3, avoid breaking Zone 1 <-> Zone 3 contour similarity
      if (ch.form === 'one_bar_repeat_with_passing' && s.relTick >= BAR_TICKS && s.tag !== 'cadence') {
        continue;
      }

      const absTick = Math.min(sectionEndTick - 1, ch.startTick + s.relTick);
      const activeChord = getActiveChordAtTick(
        section.chords,
        absTick,
        song.key,
        song.scale,
        section.bars
      ).parsed;
      const chordPcs = new Set(
        activeChord.intervals.map((iv) => (activeChord.rootSemitone + iv) % 12)
      );
      const currP = snappedPitches[i];
      if (chordPcs.has(currP % 12)) continue;

      let bestCand = currP;
      let bestDist = 3; // <= 2 semitones only
      for (const delta of [-1, 1, -2, 2]) {
        const cand = currP + delta;
        if (
          cand >= minChPitch &&
          cand <= maxChPitch &&
          scalePcs.has(cand % 12) &&
          chordPcs.has(cand % 12) &&
          Math.abs(delta) < bestDist
        ) {
          bestDist = Math.abs(delta);
          bestCand = cand;
        }
      }
      snappedPitches[i] = bestCand;
    }

    // 3. Post-Snap Boundary Verification Pass (guarantees all dialectical invariants 100%)
    // 3a. Guarantee realized topPitch === ch.topPitch
    if (snappedPitches.length > 0 && Math.max(...snappedPitches) !== maxChPitch) {
      const peakSlotIdx = slots.findIndex((s) => s.isPeakSlot);
      const safePeakIdx =
        peakSlotIdx !== -1
          ? peakSlotIdx
          : Math.min(Math.max(0, slots.length - 2), Math.floor(slots.length / 2));
      snappedPitches[safePeakIdx] = maxChPitch;
    }
    // Cap every note <= maxChPitch
    for (let i = 0; i < snappedPitches.length; i++) {
      if (snappedPitches[i] > maxChPitch) {
        snappedPitches[i] = maxChPitch;
      }
    }

    // 3b. Guarantee Pattern 2 Zone 3 contour similarity >= 0.70 after snapping
    if (ch.form === 'one_bar_repeat_with_passing') {
      const z1Indices = slots
        .map((s, idx) => (s.relTick < 1440 ? idx : -1))
        .filter((idx) => idx !== -1);
      const z3Indices = slots
        .map((s, idx) => (s.relTick >= BAR_TICKS && s.relTick < 3360 ? idx : -1))
        .filter((idx) => idx !== -1);
      const pairCount = Math.min(z1Indices.length, z3Indices.length);
      for (let k = 0; k < pairCount; k++) {
        snappedPitches[z3Indices[k]] = snappedPitches[z1Indices[k]];
      }
    }

    // 3c. Guarantee Antithesis strict drop: anti.meanPitch < thesis.meanPitch & 1 <= thesisTop - antiTop <= 4
    if (ch.role === 'antithesis' && lastThesisMeanPitch !== undefined) {
      const meanOf = (arr: number[]) =>
        arr.reduce((sum, v) => sum + v, 0) / Math.max(1, arr.length);
      let guard = 0;
      while (meanOf(snappedPitches) >= lastThesisMeanPitch - 0.05 && guard < 16) {
        guard++;
        let lowered = false;
        const maxVal = Math.max(...snappedPitches);
        let peakKept = false;
        for (let i = 0; i < snappedPitches.length; i++) {
          if (snappedPitches[i] === maxVal && !peakKept) {
            peakKept = true;
            continue;
          }
          const lower = stepInScale(snappedPitches[i], -1, safeFullScale, VOCAL_MIN_PITCH, maxChPitch);
          if (lower < snappedPitches[i]) {
            snappedPitches[i] = lower;
            lowered = true;
          }
        }
        // Keep Pattern 2 Zone 3 aligned with Zone 1 if lowered
        if (ch.form === 'one_bar_repeat_with_passing') {
          const z1Indices = slots
            .map((s, idx) => (s.relTick < 1440 ? idx : -1))
            .filter((idx) => idx !== -1);
          const z3Indices = slots
            .map((s, idx) => (s.relTick >= BAR_TICKS && s.relTick < 3360 ? idx : -1))
            .filter((idx) => idx !== -1);
          for (let k = 0; k < Math.min(z1Indices.length, z3Indices.length); k++) {
            snappedPitches[z3Indices[k]] = snappedPitches[z1Indices[k]];
          }
        }
        if (!lowered) break;
      }
    }

    // 3d. Guarantee NO extreme chapter-end upward leap (last.pitch - prev.pitch < 5; <= 2 on runway, <= 0 on normal)
    if (snappedPitches.length >= 2) {
      const lastIdx = snappedPitches.length - 1;
      const prevP = snappedPitches[lastIdx - 1];
      const maxEndUp = ch.isRunwayToSynthesis ? 2 : 0;
      if (snappedPitches[lastIdx] - prevP > maxEndUp) {
        snappedPitches[lastIdx] = nearestScalePitchInRange(
          prevP + maxEndUp,
          Math.max(VOCAL_MIN_PITCH, prevP - 2),
          Math.min(maxChPitch, prevP + maxEndUp),
          scalePcs
        );
      }
    }

    // 4. Construct DialecticalVocalNote[] with strict monophony (minGap >= VOISONA_MIN_GAP_TICKS) & Fall expression
    const chNotes: DialecticalVocalNote[] = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const absStart = ch.startTick + s.relTick;
      if (absStart >= sectionEndTick) continue;

      const nextStart =
        i + 1 < slots.length
          ? ch.startTick + slots[i + 1].relTick
          : chEndTick;
      const maxSpan = Math.max(1, nextStart - absStart);
      const gridDur = Math.max(120, Math.min(s.gridDuration, maxSpan));
      const maxGateWithGap =
        i + 1 < slots.length || chEndTick < sectionEndTick
          ? Math.max(120, maxSpan - VOISONA_MIN_GAP_TICKS)
          : maxSpan;
      const gateDur = Math.max(
        120,
        Math.min(gridDur, maxGateWithGap, Math.round(gridDur * s.gateRatio))
      );

      const trailingPureRest = nextStart - (absStart + gridDur);
      const isFallCandidate =
        (s.role === 'top_fall' || Boolean(ch.role === 'synthesis' && s.isPeakSlot)) &&
        gridDur >= fallCfg.minGridDurationTicks &&
        trailingPureRest >= fallCfg.minTrailingRestTicks;
      const hasFall = isFallCandidate && rng() < fallCfg.probability;

      const pitch = snappedPitches[i];
      chNotes.push({
        startTick: absStart,
        gridDuration: gridDur,
        gateDuration: gateDur,
        midiPitch: pitch,
        pitch,
        velocity: clampVelocity(Math.round(baseVelocity * s.velocityScale)),
        role: s.role,
        tag: s.tag,
        chapterIndex: ch.chapterIndex,
        hasFall,
        fallConfig: hasFall ? { ...fallCfg } : undefined,
      });
    }

    chapterNotesMap.set(ch.chapterIndex, chNotes);
    if (ch.role === 'thesis' && chNotes.length > 0) {
      lastThesisMeanPitch =
        chNotes.reduce((sum, n) => sum + n.midiPitch, 0) / chNotes.length;
      lastThesisTopPitch = Math.max(...chNotes.map((n) => n.midiPitch));
    }
  }

  void lastThesisTopPitch;

  const allNotes: DialecticalVocalNote[] = [];
  for (const ch of chapters) {
    const chNotes = chapterNotesMap.get(ch.chapterIndex) ?? [];
    allNotes.push(...chNotes);
  }

  const midiNotes: MidiNote[] = allNotes.map((n) => ({
    pitch: n.midiPitch,
    velocity: n.velocity,
    startTick: n.startTick,
    durationTicks: n.gateDuration,
    channel: TRACK_CHANNELS.vocal,
    gridDurationTicks: n.gridDuration,
    role: n.role,
    tag: n.tag,
    hasFall: n.hasFall,
    ...(n.hasFall && n.fallConfig ? { fallConfig: { ...n.fallConfig } } : {}),
  }));

  return {
    genreId,
    profile,
    scheme,
    thesisForm,
    chapters,
    notes: allNotes,
    midiNotes,
  };
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

// ===========================================================================
// Internal Helpers
// ===========================================================================

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
      ...n,
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
  minP = VOCAL_MIN_PITCH,
  maxP = VOCAL_MAX_PITCH
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
  minP = VOCAL_MIN_PITCH,
  maxP = VOCAL_MAX_PITCH
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

// Keep ParsedChord reference used if needed
export type { ParsedChord };
