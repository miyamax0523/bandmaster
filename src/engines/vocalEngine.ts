import {
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type EnergyLevel,
  type ExportTarget,
  type FallExpressionConfig,
  type KeyName,
  type MidiNote,
  type NoteRole,
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
import {
  normalizeMasterGenreId,
  type MasterGenreId,
} from '../lib/masterGenres';
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
  type ExportTarget,
  type FallExpressionConfig,
  type GenreVocalGrammar,
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

export function adaptNotesForExportTarget(
  notes: readonly GeneratedVocalNote[],
  target: ExportTarget
): { notes: GeneratedVocalNote[]; pitchBends: PitchBendEvent[] } {
  if (target === 'voisona_clean_smf') {
    const BREATH_THRESHOLD_TICKS = 180;
    const cleanNotes = notes.map((n, i) => {
      const next = notes[i + 1];
      const gap = next
        ? next.startTick - (n.startTick + n.gridDuration)
        : PHRASE_2BAR_TICKS;
      const rawFinalDur =
        next && gap < BREATH_THRESHOLD_TICKS
          ? next.startTick - n.startTick
          : n.gridDuration;
      const finalDur = next
        ? Math.max(120, Math.min(rawFinalDur, next.startTick - n.startTick))
        : Math.max(120, rawFinalDur);
      return {
        ...n,
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
    return generateLegacyRapPresetNotes(input, preset, scalePcs, keySemitone);
  }

  // Execute Rhythm-First 4-Stage Vocal Melody Pipeline
  return generateRhythmFirstVocal(input).midiNotes;
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
