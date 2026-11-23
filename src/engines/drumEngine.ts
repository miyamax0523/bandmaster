import {
  getDefaultDrumFillEnabled,
  type BeatPatternId,
  type KickTake,
  type MidiNote,
  type SectionType,
} from '../types/song';
import { getTimelineBoundaryChanges } from '../lib/chordTimeline';
import { normalizeMasterGenreId, type MasterGenreId } from '../lib/masterGenres';
import type { EngineInput } from './types';

// ===========================================================================
// 1. Constants, Core Types & MIDI Output Maps (GM Standard / SSD 5.5 Native)
// ===========================================================================
export const TPQN = 480 as const;
export const STEP_TICKS = 120 as const; // 16th note
export const BAR_TICKS = 1920 as const; // 4/4 bar
export const BEAT_TICKS = 480 as const;
export const EIGHTH_TICKS = 240 as const;
export const SIXTEENTH_TICKS = 120 as const;

export const GM_DRUM = {
  KICK: 36,
  KICK_ALT: 35,
  RIMSHOT: 37,
  SIDE_STICK: 37,
  SNARE: 38,
  SNARE_RIMSHOT: 40,
  LOW_FLOOR_TOM: 41,
  CLOSED_HH: 42,
  FLOOR_TOM: 43,
  HIGH_FLOOR_TOM: 43,
  PEDAL_HH: 44,
  MID_TOM: 45,
  LOW_TOM: 45,
  OPEN_HH: 46,
  LOW_MID_TOM: 47,
  HIGH_TOM: 48,
  HI_MID_TOM: 48,
  CRASH: 49,
  CRASH_1: 49,
  HIGH_TOM_50: 50,
  RIDE: 51,
  CHINA: 52,
  RIDE_BELL: 53,
  SPLASH: 55,
  CRASH_2: 57,
} as const;

export type StepIndex =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15;

export type Limb = 'RH' | 'LH' | 'RF' | 'LF';

export type DrumVoice =
  | 'KICK_MAIN'
  | 'KICK_ALT'
  | 'SNARE_MAIN'
  | 'SNARE_RIMSHOT'
  | 'SNARE_SIDESTICK'
  | 'HH_CLOSED'
  | 'HH_PEDAL'
  | 'HH_HALF_OPEN'
  | 'HH_OPEN'
  | 'RIDE_BOW'
  | 'RIDE_BELL'
  | 'CRASH_L'
  | 'CRASH_R'
  | 'CHINA'
  | 'TOM_HI'
  | 'TOM_MID'
  | 'TOM_FLOOR';

export type MidiMapMode = 'GM_STANDARD' | 'SSD5_NATIVE';

export const MIDI_NOTE_MAP: Record<MidiMapMode, Record<DrumVoice, number>> = {
  GM_STANDARD: {
    KICK_MAIN: 36,
    KICK_ALT: 35,
    SNARE_MAIN: 38,
    SNARE_RIMSHOT: 40,
    SNARE_SIDESTICK: 37,
    HH_CLOSED: 42,
    HH_PEDAL: 44,
    HH_HALF_OPEN: 46,
    HH_OPEN: 46,
    RIDE_BOW: 51,
    RIDE_BELL: 53,
    CRASH_L: 49,
    CRASH_R: 57,
    CHINA: 52,
    TOM_HI: 48,
    TOM_MID: 45,
    TOM_FLOOR: 43,
  },
  SSD5_NATIVE: {
    KICK_MAIN: 36,
    KICK_ALT: 35,
    SNARE_MAIN: 38,
    SNARE_RIMSHOT: 40,
    SNARE_SIDESTICK: 37,
    HH_CLOSED: 42,
    HH_PEDAL: 44,
    HH_HALF_OPEN: 62,
    HH_OPEN: 64,
    RIDE_BOW: 51,
    RIDE_BELL: 53,
    CRASH_L: 55,
    CRASH_R: 57,
    CHINA: 31,
    TOM_HI: 48,
    TOM_MID: 47,
    TOM_FLOOR: 43,
  },
};

export type { BeatPatternId, KickTake };

export type EventRole =
  | 'SNARE_BACKBEAT'
  | 'KICK_DOUBLE_RF'
  | 'KICK_DOUBLE_LF'
  | 'KICK_CORE'
  | 'TIMEKEEP'
  | 'CRASH_ACCENT'
  | 'FILL_EVENT'
  | 'KICK_CHORD_TRACK'
  | 'ORNAMENT';

export interface InternalDrumEvent {
  readonly tick: number;
  readonly durationTicks: number;
  readonly voice: DrumVoice;
  readonly velocity: number;
  readonly limb: Limb;
  readonly role: EventRole;
  readonly barIndex: number;
  readonly stepIndex: StepIndex;
  readonly fixedTiming?: boolean;
  readonly fixedVelocity?: boolean;
  readonly isAnchor?: boolean;
  readonly rawMidiPitch?: number;
}

// ===========================================================================
// 2. Layer 1: 8 Basic Beat Skeletons × 3 Kick Takes (A / B / C)
// ===========================================================================
export interface BeatTemplate {
  readonly id: BeatPatternId;
  readonly label: string;
  readonly snareSteps: readonly StepIndex[];
  readonly snareStepsByTake?: Partial<Record<KickTake, readonly StepIndex[]>>;
  readonly timekeepSteps: readonly StepIndex[];
  readonly kickTakes: Record<KickTake, readonly StepIndex[]>;
  readonly defaultTimekeepVoice: DrumVoice;
  readonly supportsSwing16th: boolean;
  readonly supportsHat16th: boolean;
  readonly isDoubleBass?: boolean;
}

export const BEAT_TEMPLATES: Record<BeatPatternId, BeatTemplate> = {
  EIGHT_BEAT: {
    id: 'EIGHT_BEAT',
    label: '王道8ビート',
    snareSteps: [4, 12],
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 8, 10], // ドッ・タン・ドド・タン
      B: [0, 10], // ドッ・タン・ン・ド・タン（3拍目表抜き→3拍目裏）
      C: [0, 2, 8, 10], // ドド・タン・ドド・タン
    },
    defaultTimekeepVoice: 'HH_CLOSED',
    supportsSwing16th: false,
    supportsHat16th: true,
  },
  SIXTEEN_BEAT: {
    id: 'SIXTEEN_BEAT',
    label: '16ビート',
    snareSteps: [4, 12],
    timekeepSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    kickTakes: {
      A: [0, 7, 8, 10],
      B: [0, 3, 6, 10, 14],
      C: [0, 2, 7, 8, 10, 15],
    },
    defaultTimekeepVoice: 'HH_CLOSED',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  FOUR_ON_FLOOR: {
    id: 'FOUR_ON_FLOOR',
    label: '頭打ち・四つ打ち',
    snareSteps: [4, 12],
    timekeepSteps: [0, 4, 8, 12],
    kickTakes: {
      A: [0, 4, 8, 12],
      B: [0, 4, 8, 10, 12, 14],
      C: [0, 4, 8, 12, 14, 15],
    },
    defaultTimekeepVoice: 'HH_CLOSED',
    supportsSwing16th: false,
    supportsHat16th: true,
  },
  UPBEAT: {
    id: 'UPBEAT',
    label: '裏打ち・アップビート',
    snareSteps: [4, 12],
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 4, 8, 12],
      B: [0, 8, 10],
      C: [0, 4, 8, 10, 12],
    },
    defaultTimekeepVoice: 'HH_OPEN',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  TWO_BEAT: {
    id: 'TWO_BEAT',
    label: 'ツービート',
    snareSteps: [2, 6, 10, 14],
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 4, 8, 12],
      B: [0, 3, 4, 8, 11, 12],
      C: [0, 4, 7, 8, 12, 15],
    },
    defaultTimekeepVoice: 'HH_HALF_OPEN',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  BOUNCE: {
    id: 'BOUNCE',
    label: 'バウンス（跳ね系）',
    snareSteps: [4, 12],
    timekeepSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    kickTakes: {
      A: [0, 4, 8, 12],
      B: [0, 3, 6, 8, 10],
      C: [0, 3, 4, 7, 8, 12, 15],
    },
    defaultTimekeepVoice: 'HH_CLOSED',
    supportsSwing16th: true,
    supportsHat16th: false,
  },
  HALF_TIME: {
    id: 'HALF_TIME',
    label: 'ハーフタイム',
    snareSteps: [8],
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 10],
      B: [0, 6, 10, 14],
      C: [0, 2, 5, 10, 11],
    },
    defaultTimekeepVoice: 'HH_HALF_OPEN',
    supportsSwing16th: false,
    supportsHat16th: true,
  },
  DOUBLE_BASS: {
    id: 'DOUBLE_BASS',
    label: 'ツーバス・ドコドコ',
    snareSteps: [4, 12],
    snareStepsByTake: {
      C: [8],
    },
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      B: [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15],
      C: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    },
    defaultTimekeepVoice: 'CHINA',
    supportsSwing16th: false,
    supportsHat16th: false,
    isDoubleBass: true,
  },
};

export const ALL_BEAT_PATTERN_IDS: readonly BeatPatternId[] = [
  'EIGHT_BEAT',
  'SIXTEEN_BEAT',
  'FOUR_ON_FLOOR',
  'UPBEAT',
  'TWO_BEAT',
  'BOUNCE',
  'HALF_TIME',
  'DOUBLE_BASS',
];

// ===========================================================================
// 3. Layer 2: 5 Master Genre Flavor Profiles & Section Deployment Mapping
// ===========================================================================
export interface GenreFlavorProfile {
  readonly id: MasterGenreId;
  readonly microtiming: {
    readonly snareOffsetMs: number; // clamped to [-8, +8]
    readonly kickBeforeSnareMs: number;
    readonly maxJitterMs: number; // clamped to <= 2.5
    readonly bounceSwingTicks: number; // +16..+24
  };
  readonly dynamics: {
    readonly kickBaseVel: number;
    readonly snareBaseVel: number;
    readonly ghostSnareVel: number;
    readonly timekeepOnBeatVel: number;
    readonly timekeepOffBeatVel: number;
    readonly timekeepSubVel: number;
    readonly crashVel: number;
    readonly doubleBassLfDelta: number; // -6..-12
  };
  readonly accentCymbal: DrumVoice;
  readonly chorusTimekeepVoice: DrumVoice;
  readonly highBpmDoubleBassCymbal: DrumVoice;
}

export const GENRE_FLAVOR_PROFILES: Record<MasterGenreId, GenreFlavorProfile> = {
  alt_shoegaze: {
    id: 'alt_shoegaze',
    microtiming: {
      snareOffsetMs: 5,
      kickBeforeSnareMs: -2.5,
      maxJitterMs: 2.0,
      bounceSwingTicks: 18,
    },
    dynamics: {
      kickBaseVel: 114,
      snareBaseVel: 118,
      ghostSnareVel: 42,
      timekeepOnBeatVel: 94,
      timekeepOffBeatVel: 70,
      timekeepSubVel: 54,
      crashVel: 116,
      doubleBassLfDelta: -8,
    },
    accentCymbal: 'CHINA',
    chorusTimekeepVoice: 'HH_HALF_OPEN',
    highBpmDoubleBassCymbal: 'CHINA',
  },
  emo_jrock: {
    id: 'emo_jrock',
    microtiming: {
      snareOffsetMs: -1.5,
      kickBeforeSnareMs: -2.5,
      maxJitterMs: 1.5,
      bounceSwingTicks: 16,
    },
    dynamics: {
      kickBaseVel: 115,
      snareBaseVel: 118,
      ghostSnareVel: 38,
      timekeepOnBeatVel: 96,
      timekeepOffBeatVel: 74,
      timekeepSubVel: 56,
      crashVel: 116,
      doubleBassLfDelta: -8,
    },
    accentCymbal: 'CRASH_L',
    chorusTimekeepVoice: 'HH_HALF_OPEN',
    highBpmDoubleBassCymbal: 'CRASH_R',
  },
  numetal_mixture: {
    id: 'numetal_mixture',
    microtiming: {
      snareOffsetMs: 0,
      kickBeforeSnareMs: -2.5,
      maxJitterMs: 1.5,
      bounceSwingTicks: 16,
    },
    dynamics: {
      kickBaseVel: 116,
      snareBaseVel: 120,
      ghostSnareVel: 40,
      timekeepOnBeatVel: 95,
      timekeepOffBeatVel: 72,
      timekeepSubVel: 55,
      crashVel: 118,
      doubleBassLfDelta: -8,
    },
    accentCymbal: 'CHINA',
    chorusTimekeepVoice: 'CHINA',
    highBpmDoubleBassCymbal: 'CHINA',
  },
  royal_jpop: {
    id: 'royal_jpop',
    microtiming: {
      snareOffsetMs: 1.5,
      kickBeforeSnareMs: -2.5,
      maxJitterMs: 2.0,
      bounceSwingTicks: 20,
    },
    dynamics: {
      kickBaseVel: 112,
      snareBaseVel: 114,
      ghostSnareVel: 36,
      timekeepOnBeatVel: 92,
      timekeepOffBeatVel: 66,
      timekeepSubVel: 52,
      crashVel: 114,
      doubleBassLfDelta: -8,
    },
    accentCymbal: 'CRASH_L',
    chorusTimekeepVoice: 'HH_HALF_OPEN',
    highBpmDoubleBassCymbal: 'RIDE_BELL',
  },
  chill_ballad: {
    id: 'chill_ballad',
    microtiming: {
      snareOffsetMs: 6,
      kickBeforeSnareMs: -2.0,
      maxJitterMs: 2.2,
      bounceSwingTicks: 22,
    },
    dynamics: {
      kickBaseVel: 102,
      snareBaseVel: 104,
      ghostSnareVel: 32,
      timekeepOnBeatVel: 84,
      timekeepOffBeatVel: 60,
      timekeepSubVel: 46,
      crashVel: 106,
      doubleBassLfDelta: -8,
    },
    accentCymbal: 'CRASH_L',
    chorusTimekeepVoice: 'RIDE_BOW',
    highBpmDoubleBassCymbal: 'RIDE_BELL',
  },
};

export interface SectionSkeletonLock {
  readonly genreId: MasterGenreId;
  readonly patternId: BeatPatternId;
  readonly kickTake: KickTake;
  readonly timekeepVoice: DrumVoice;
  readonly snareVoice: DrumVoice;
  readonly timekeepSteps: readonly StepIndex[];
  readonly snareSteps: readonly StepIndex[];
  readonly isTwoHanded16th: boolean;
  readonly preChorusProgressiveKick: boolean; // A -> B lift in Pre-Chorus
  readonly isDiscoBoogieLegacy: boolean;
  readonly isTrapSubStepMode: boolean;
  readonly isBuildUpLegacy: boolean;
  readonly isMinimalLegacy: boolean;
}

export interface DrumGenerationResult {
  notes: MidiNote[];
  events: InternalDrumEvent[];
  kickTicks: number[];
  patternId: BeatPatternId;
  kickTake: KickTake;
  genreId: MasterGenreId;
  midiMapMode: MidiMapMode;
  skeleton: SectionSkeletonLock;
}

// ===========================================================================
// Deterministic Utilities
// ===========================================================================
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

export function msToTicks(ms: number, bpm: number): number {
  return Math.round(ms * bpm * 0.008);
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function rngInt(rng: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

function isKickVoice(voice: DrumVoice): boolean {
  return voice === 'KICK_MAIN' || voice === 'KICK_ALT';
}

function isHiHatClosedOrPedalVoice(voice: DrumVoice): boolean {
  return voice === 'HH_CLOSED' || voice === 'HH_PEDAL';
}

function isHiHatOpenVoice(voice: DrumVoice): boolean {
  return voice === 'HH_OPEN' || voice === 'HH_HALF_OPEN';
}

// ===========================================================================
// Stage 1: Genre & Section Skeleton Lock
// ===========================================================================
export function resolveMasterGenreIdForDrum(
  presetId: string | undefined,
  bpm: number,
  beatFeel?: string,
  sectionType?: SectionType | string
): MasterGenreId {
  const id = (presetId ?? 'auto').trim();

  // Direct canonical or legacy DNA IDs
  if (
    id === 'alt_shoegaze' ||
    id === 'alt_heavy_shoegaze' ||
    id === 'halftime_heavy' ||
    id === 'breakdown_heavy'
  ) {
    return 'alt_shoegaze';
  }
  if (
    id === 'emo_jrock' ||
    id === 'emo_jrock_fast' ||
    id === 'rock_drive' ||
    id === 'jrock_anticipation'
  ) {
    return 'emo_jrock';
  }
  if (
    id === 'numetal_mixture' ||
    id === 'metal_double' ||
    id === 'trap_sparse' ||
    id === 'trap_active'
  ) {
    return 'numetal_mixture';
  }
  if (
    id === 'chill_ballad' ||
    id === 'chill_lofi_ballad' ||
    id === 'rim_chill'
  ) {
    return 'chill_ballad';
  }
  if (
    id === 'royal_jpop' ||
    id === 'jpop_melodic' ||
    id === 'fusion_funk' ||
    id === 'straight_8' ||
    id === 'straight_16' ||
    id === 'four_on_floor' ||
    id === 'bounce_shuffle' ||
    id === 'disco_boogie_bounce'
  ) {
    return 'royal_jpop';
  }

  // Infer from song characteristics when 'auto'
  if (bpm <= 92 && (sectionType === 'Intro' || sectionType === 'Bridge' || beatFeel === 'Bounce')) {
    return 'chill_ballad';
  }
  if (beatFeel === 'Half-Time') return 'alt_shoegaze';
  if (beatFeel === 'Driving') return 'emo_jrock';

  return normalizeMasterGenreId(id);
}

export function resolveSectionPatternAndTake(
  genreId: MasterGenreId,
  sectionType: SectionType | string,
  bpm: number,
  rng: () => number
): {
  patternId: BeatPatternId;
  kickTake: KickTake;
  snareVoiceOverride?: DrumVoice;
  timekeepVoiceOverride?: DrumVoice;
  preChorusProgressiveKick?: boolean;
} {
  switch (genreId) {
    case 'alt_shoegaze':
      switch (sectionType) {
        case 'Intro':
        case 'Verse':
          return { patternId: 'EIGHT_BEAT', kickTake: 'B' };
        case 'Pre-Chorus':
          return {
            patternId: 'FOUR_ON_FLOOR',
            kickTake: 'A',
            preChorusProgressiveKick: true,
          };
        case 'Chorus':
          return rng() < 0.55
            ? { patternId: 'HALF_TIME', kickTake: 'B' }
            : { patternId: 'EIGHT_BEAT', kickTake: 'C' };
        case 'Bridge':
        case 'Outro':
        default:
          return { patternId: 'HALF_TIME', kickTake: 'A' };
      }

    case 'emo_jrock':
      switch (sectionType) {
        case 'Intro':
          return { patternId: 'TWO_BEAT', kickTake: 'A' };
        case 'Verse':
          return rng() < 0.45
            ? { patternId: 'UPBEAT', kickTake: 'A' }
            : { patternId: 'EIGHT_BEAT', kickTake: 'A' };
        case 'Pre-Chorus':
          return { patternId: 'FOUR_ON_FLOOR', kickTake: 'B' };
        case 'Chorus': {
          const r = rng();
          if (r < 0.35) return { patternId: 'TWO_BEAT', kickTake: 'A' };
          if (r < 0.65) return { patternId: 'TWO_BEAT', kickTake: 'B' };
          return { patternId: 'EIGHT_BEAT', kickTake: 'C' };
        }
        case 'Bridge':
        case 'Outro':
        default:
          return { patternId: 'HALF_TIME', kickTake: 'A' };
      }

    case 'numetal_mixture':
      switch (sectionType) {
        case 'Intro':
          return { patternId: 'HALF_TIME', kickTake: 'B' };
        case 'Verse':
          return {
            patternId: 'EIGHT_BEAT',
            kickTake: rng() < 0.5 ? 'A' : 'B',
          };
        case 'Pre-Chorus':
          return { patternId: 'FOUR_ON_FLOOR', kickTake: 'B' };
        case 'Chorus':
          if (bpm >= 145) {
            return {
              patternId: 'DOUBLE_BASS',
              kickTake: rng() < 0.6 ? 'A' : 'C',
            };
          }
          return { patternId: 'EIGHT_BEAT', kickTake: 'C' };
        case 'Bridge':
        case 'Outro':
        default:
          return { patternId: 'HALF_TIME', kickTake: 'A' };
      }

    case 'chill_ballad':
      switch (sectionType) {
        case 'Intro':
          return {
            patternId: 'HALF_TIME',
            kickTake: 'A',
            timekeepVoiceOverride: 'HH_CLOSED',
          };
        case 'Verse':
          return {
            patternId: 'EIGHT_BEAT',
            kickTake: 'A',
            snareVoiceOverride: 'SNARE_SIDESTICK',
            timekeepVoiceOverride: 'HH_CLOSED',
          };
        case 'Pre-Chorus':
          return {
            patternId: 'EIGHT_BEAT',
            kickTake: 'A',
            snareVoiceOverride: 'SNARE_MAIN',
            timekeepVoiceOverride: 'HH_CLOSED',
          };
        case 'Chorus':
          return {
            patternId: 'HALF_TIME',
            kickTake: 'A',
            snareVoiceOverride: 'SNARE_MAIN',
            timekeepVoiceOverride: 'RIDE_BOW',
          };
        case 'Bridge':
        case 'Outro':
        default:
          return {
            patternId: 'HALF_TIME',
            kickTake: 'A',
            snareVoiceOverride: 'SNARE_SIDESTICK',
            timekeepVoiceOverride: 'HH_CLOSED',
          };
      }

    case 'royal_jpop':
    default:
      switch (sectionType) {
        case 'Intro':
          return { patternId: 'EIGHT_BEAT', kickTake: 'A' };
        case 'Verse': {
          const r = rng();
          if (r < 0.34) return { patternId: 'UPBEAT', kickTake: 'B' };
          if (r < 0.66) return { patternId: 'BOUNCE', kickTake: 'A' };
          return { patternId: 'EIGHT_BEAT', kickTake: 'A' };
        }
        case 'Pre-Chorus':
          return {
            patternId: 'FOUR_ON_FLOOR',
            kickTake: 'A',
            preChorusProgressiveKick: true,
          };
        case 'Chorus':
          return {
            patternId: 'EIGHT_BEAT',
            kickTake: rng() < 0.5 ? 'A' : 'C',
          };
        case 'Bridge':
        case 'Outro':
        default:
          return { patternId: 'HALF_TIME', kickTake: 'A' };
      }
  }
}

export function lockSectionSkeleton(
  input: EngineInput,
  rng: () => number
): SectionSkeletonLock {
  const { song, section, params } = input;
  const bpm = input.bpm ?? song.bpm;
  const drumPreset =
    section.patternPresets?.drums ??
    section.partPresets?.drums ??
    song.members.drums.patternPreset ??
    'auto';

  const genreId = resolveMasterGenreIdForDrum(
    drumPreset,
    bpm,
    song.beatFeel,
    section.type
  );
  const flavor = GENRE_FLAVOR_PROFILES[genreId];
  const explicitPattern = input.drumPatternId ?? section.drumPatternId;
  const explicitTake = input.drumKickTake ?? section.drumKickTake;

  const autoResolved = resolveSectionPatternAndTake(
    genreId,
    section.type,
    bpm,
    rng
  );

  let patternId: BeatPatternId = autoResolved.patternId;
  let kickTake: KickTake = autoResolved.kickTake;
  let snareVoice: DrumVoice = autoResolved.snareVoiceOverride ?? 'SNARE_MAIN';
  let timekeepVoice: DrumVoice =
    autoResolved.timekeepVoiceOverride ?? BEAT_TEMPLATES[patternId].defaultTimekeepVoice;
  let preChorusProgressiveKick = Boolean(autoResolved.preChorusProgressiveKick);

  const isExplicitPattern = Boolean(explicitPattern && explicitPattern !== 'auto');
  const isDiscoBoogieLegacy = !isExplicitPattern && drumPreset === 'disco_boogie_bounce';
  const isTrapSubStepMode =
    !isExplicitPattern &&
    (drumPreset === 'trap_sparse' ||
      drumPreset === 'trap_active' ||
      params.hatSubdivision === 4);
  const isBuildUpLegacy = !isExplicitPattern && drumPreset === 'build_up';
  const isMinimalLegacy = !isExplicitPattern && drumPreset === 'simple_minimal';

  if (isExplicitPattern) {
    patternId = explicitPattern as BeatPatternId;
    preChorusProgressiveKick = false;
  } else {
    // Legacy preset mapping for 100% backwards compatibility
    switch (drumPreset) {
      case 'straight_8':
      case 'jrock_anticipation':
      case 'simple_minimal':
        patternId = 'EIGHT_BEAT';
        kickTake = 'A';
        preChorusProgressiveKick = false;
        break;
      case 'straight_16':
      case 'fusion_funk':
        patternId = 'SIXTEEN_BEAT';
        kickTake = 'A';
        preChorusProgressiveKick = false;
        break;
      case 'four_on_floor':
      case 'build_up':
        patternId = 'FOUR_ON_FLOOR';
        kickTake = 'A';
        preChorusProgressiveKick = false;
        break;
      case 'bounce_shuffle':
      case 'disco_boogie_bounce':
        patternId = 'BOUNCE';
        kickTake = 'A';
        preChorusProgressiveKick = false;
        break;
      case 'halftime_heavy':
      case 'breakdown_heavy':
        patternId = 'HALF_TIME';
        kickTake = 'B';
        preChorusProgressiveKick = false;
        break;
      case 'metal_double':
        patternId = 'DOUBLE_BASS';
        kickTake = 'A';
        preChorusProgressiveKick = false;
        break;
      case 'rock_drive':
        patternId = bpm >= 155 ? 'TWO_BEAT' : 'EIGHT_BEAT';
        kickTake = bpm >= 155 ? 'A' : 'C';
        preChorusProgressiveKick = false;
        break;
      case 'rim_chill':
        patternId = 'EIGHT_BEAT';
        kickTake = 'A';
        snareVoice = 'SNARE_SIDESTICK';
        preChorusProgressiveKick = false;
        break;
      case 'trap_sparse':
      case 'trap_active':
        patternId = 'HALF_TIME';
        kickTake = 'A';
        preChorusProgressiveKick = false;
        break;
      default:
        // Keyword/PlayStyle hints only when 'auto'
        if (drumPreset === 'auto' && params.kickPattern === 'fourOnFloor') {
          patternId = 'FOUR_ON_FLOOR';
          kickTake = 'A';
        }
        break;
    }
  }

  if (explicitTake && explicitTake !== 'auto') {
    kickTake = explicitTake;
    preChorusProgressiveKick = false;
  }

  const template = BEAT_TEMPLATES[patternId];

  // Resolve timekeeping voice by pattern, genre & section energy
  if (!autoResolved.timekeepVoiceOverride || isExplicitPattern) {
    if (patternId === 'DOUBLE_BASS') {
      timekeepVoice =
        bpm >= 155 ? flavor.highBpmDoubleBassCymbal : 'HH_HALF_OPEN';
    } else if (patternId === 'HALF_TIME') {
      if (genreId === 'chill_ballad') {
        timekeepVoice = section.type === 'Chorus' ? 'RIDE_BOW' : 'HH_CLOSED';
      } else if (section.type === 'Chorus' || section.energy === 'High') {
        timekeepVoice = flavor.chorusTimekeepVoice;
      } else {
        timekeepVoice = 'HH_CLOSED';
      }
    } else if (patternId === 'UPBEAT') {
      timekeepVoice = 'HH_OPEN';
    } else if (patternId === 'TWO_BEAT') {
      timekeepVoice = section.energy === 'High' ? 'HH_HALF_OPEN' : 'HH_CLOSED';
    } else if (patternId === 'FOUR_ON_FLOOR') {
      timekeepVoice =
        section.type === 'Pre-Chorus' || section.energy === 'High'
          ? 'HH_HALF_OPEN'
          : 'HH_CLOSED';
    } else {
      timekeepVoice =
        section.type === 'Chorus' && section.energy === 'High'
          ? flavor.chorusTimekeepVoice
          : template.defaultTimekeepVoice;
    }
  }

  // Resolve timekeeping steps
  const isTwoHanded16th = patternId === 'SIXTEEN_BEAT' && bpm >= 100;
  let timekeepSteps: StepIndex[];

  if (patternId === 'DOUBLE_BASS') {
    timekeepSteps = bpm >= 155 ? [0, 4, 8, 12] : [0, 2, 4, 6, 8, 10, 12, 14];
  } else if (patternId === 'FOUR_ON_FLOOR') {
    timekeepSteps =
      section.type === 'Pre-Chorus' && section.energy === 'High'
        ? [0, 2, 4, 6, 8, 10, 12, 14]
        : [...template.timekeepSteps];
  } else if (isTwoHanded16th) {
    // Two-handed 16th: omit LH hi-hat on snare backbeat steps 4 and 12
    timekeepSteps = template.timekeepSteps.filter((s) => s !== 4 && s !== 12);
  } else {
    timekeepSteps = [...template.timekeepSteps];
  }

  // Respect explicit hatDensity === 1 or 5 (when user explicitly changes density)
  if (!isExplicitPattern && section.hatDensity === 1) {
    timekeepSteps = [0, 4, 8, 12];
  } else if (
    !isExplicitPattern &&
    section.hatDensity === 5 &&
    (patternId === 'EIGHT_BEAT' || patternId === 'FOUR_ON_FLOOR' || patternId === 'HALF_TIME')
  ) {
    timekeepSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  }

  const snareSteps =
    template.snareStepsByTake?.[kickTake] ?? template.snareSteps;

  return {
    genreId,
    patternId,
    kickTake,
    timekeepVoice,
    snareVoice,
    timekeepSteps,
    snareSteps,
    isTwoHanded16th,
    preChorusProgressiveKick,
    isDiscoBoogieLegacy,
    isTrapSubStepMode,
    isBuildUpLegacy,
    isMinimalLegacy,
  };
}

// ===========================================================================
// Uploaded External Drum Loop Expansion (Backwards Compatible)
// ===========================================================================
function inferVoiceFromMidiPitch(pitch: number): DrumVoice {
  switch (pitch) {
    case 35:
      return 'KICK_ALT';
    case 36:
      return 'KICK_MAIN';
    case 37:
      return 'SNARE_SIDESTICK';
    case 38:
      return 'SNARE_MAIN';
    case 40:
      return 'SNARE_RIMSHOT';
    case 42:
      return 'HH_CLOSED';
    case 44:
      return 'HH_PEDAL';
    case 46:
      return 'HH_OPEN';
    case 51:
      return 'RIDE_BOW';
    case 53:
      return 'RIDE_BELL';
    case 49:
      return 'CRASH_L';
    case 57:
      return 'CRASH_R';
    case 52:
      return 'CHINA';
    case 48:
    case 50:
      return 'TOM_HI';
    case 45:
    case 47:
      return 'TOM_MID';
    case 43:
    case 41:
    default:
      return 'TOM_FLOOR';
  }
}

function inferLimbFromVoice(voice: DrumVoice): Limb {
  if (voice === 'KICK_MAIN') return 'RF';
  if (voice === 'KICK_ALT' || voice === 'HH_PEDAL') return 'LF';
  if (voice === 'SNARE_MAIN' || voice === 'SNARE_RIMSHOT' || voice === 'SNARE_SIDESTICK') {
    return 'LH';
  }
  return 'RH';
}

function inferRoleFromVoice(voice: DrumVoice, velocity: number): EventRole {
  if (voice === 'KICK_MAIN' || voice === 'KICK_ALT') return 'KICK_CORE';
  if (voice === 'SNARE_MAIN' || voice === 'SNARE_RIMSHOT' || voice === 'SNARE_SIDESTICK') {
    return velocity <= 60 ? 'ORNAMENT' : 'SNARE_BACKBEAT';
  }
  if (voice === 'CRASH_L' || voice === 'CRASH_R' || voice === 'CHINA') return 'CRASH_ACCENT';
  if (voice === 'TOM_HI' || voice === 'TOM_MID' || voice === 'TOM_FLOOR') return 'FILL_EVENT';
  return 'TIMEKEEP';
}

function generateExternalLoopEvents(
  input: EngineInput,
  rng: () => number
): InternalDrumEvent[] {
  const { song, section, style } = input;
  const loopSource = section.uploadedDrumLoop ?? song.uploadedDrumLoop;
  if (!loopSource) return [];

  const sectionEnd = section.bars * BAR_TICKS;
  const hatDensity = section.hatDensity ?? 3;
  const kickDensity = section.kickDensity ?? 3;
  const loopLen = Math.max(1, loopSource.bars) * BAR_TICKS;
  const events: InternalDrumEvent[] = [];

  for (let base = 0; base < sectionEnd; base += loopLen) {
    for (const srcNote of loopSource.notes) {
      const absTick = base + srcNote.startTick;
      if (absTick < 0 || absTick >= sectionEnd) continue;
      if (kickDensity === 1 && srcNote.pitch === GM_DRUM.KICK && srcNote.startTick % 960 !== 0) {
        continue;
      }
      if (
        hatDensity === 1 &&
        (srcNote.pitch === GM_DRUM.CLOSED_HH || srcNote.pitch === GM_DRUM.OPEN_HH) &&
        srcNote.startTick % 480 !== 0
      ) {
        continue;
      }
      const velDelta = style === 'B' ? rngInt(rng, -10, 10) : 0;
      const vel = clamp(srcNote.velocity + velDelta, 1, 127);
      const voice = inferVoiceFromMidiPitch(srcNote.pitch);
      const barIndex = Math.floor(absTick / BAR_TICKS);
      const stepIndex = (Math.floor((absTick % BAR_TICKS) / STEP_TICKS) % 16) as StepIndex;
      events.push({
        tick: absTick,
        durationTicks: Math.max(15, srcNote.durationTicks),
        voice,
        velocity: vel,
        limb: inferLimbFromVoice(voice),
        role: inferRoleFromVoice(voice, vel),
        barIndex,
        stepIndex,
        fixedTiming: true,
        fixedVelocity: true,
        rawMidiPitch: srcNote.pitch,
      });
    }
  }

  if (style === 'B') {
    const sixteenthOffbeats = [120, 360, 600, 840, 1080, 1320, 1560, 1800];
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * BAR_TICKS;
      for (const off of sixteenthOffbeats) {
        const t = barStart + off;
        if (t >= sectionEnd) continue;
        if (events.some((e) => Math.abs(e.tick - t) < 60)) continue;
        if (rng() < 0.35) {
          const isSnareGhost = rng() < 0.6;
          events.push({
            tick: t,
            durationTicks: 70,
            voice: isSnareGhost ? 'SNARE_MAIN' : 'HH_CLOSED',
            velocity: rngInt(rng, 32, 50),
            limb: isSnareGhost ? 'LH' : 'RH',
            role: 'ORNAMENT',
            barIndex: bar,
            stepIndex: (Math.floor(off / STEP_TICKS) % 16) as StepIndex,
            fixedTiming: true,
            fixedVelocity: true,
          });
        }
      }
    }
  }

  if (style === 'C') {
    const lastBarIndex = section.bars - 1;
    const lastBarStart = lastBarIndex * BAR_TICKS;
    const fillStart = lastBarStart + 960;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].tick >= fillStart && !isKickVoice(events[i].voice)) {
        events.splice(i, 1);
      }
    }
    const fillVoices: DrumVoice[] = ['SNARE_MAIN', 'TOM_HI', 'TOM_MID', 'TOM_FLOOR'];
    for (let off = 0; off < 960; off += STEP_TICKS) {
      const t = fillStart + off;
      if (t >= sectionEnd) break;
      const voice = fillVoices[rngInt(rng, 0, fillVoices.length - 1)];
      events.push({
        tick: t,
        durationTicks: 100,
        voice,
        velocity: clamp(82 + Math.round((off / 960) * 32), 1, 127),
        limb: (off / STEP_TICKS) % 2 === 0 ? 'RH' : 'LH',
        role: 'FILL_EVENT',
        barIndex: lastBarIndex,
        stepIndex: (8 + off / STEP_TICKS) as StepIndex,
        fixedTiming: true,
        fixedVelocity: true,
      });
    }

    if (!events.some((e) => e.voice === 'CRASH_L' && e.tick === 0)) {
      events.push({
        tick: 0,
        durationTicks: 480,
        voice: 'CRASH_L',
        velocity: 112,
        limb: 'RH',
        role: 'CRASH_ACCENT',
        barIndex: 0,
        stepIndex: 0,
        fixedTiming: true,
        fixedVelocity: true,
        isAnchor: true,
      });
    }
    if (720 < sectionEnd) {
      events.push({
        tick: 720,
        durationTicks: 220,
        voice: 'HH_OPEN',
        velocity: 92,
        limb: 'RH',
        role: 'ORNAMENT',
        barIndex: 0,
        stepIndex: 6,
        fixedTiming: true,
        fixedVelocity: true,
      });
    }
  }

  return events;
}

// ===========================================================================
// Stage 2: Base Skeleton Expansion + Safe drumHat16thEnabled
// ===========================================================================
function expandBaseSkeleton(
  input: EngineInput,
  lock: SectionSkeletonLock,
  rng: () => number
): InternalDrumEvent[] {
  const { song, section, params } = input;
  const bpm = input.bpm ?? song.bpm;
  const totalBars = Math.max(1, section.bars);
  const template = BEAT_TEMPLATES[lock.patternId];
  const flavor = GENRE_FLAVOR_PROFILES[lock.genreId];
  const hat16thEnabled =
    input.drumHat16thEnabled ?? section.drumHat16thEnabled ?? false;

  const events: InternalDrumEvent[] = [];

  for (let barIndex = 0; barIndex < totalBars; barIndex++) {
    const barStart = barIndex * BAR_TICKS;
    const isBarAPrime = barIndex % 2 === 1;

    // -----------------------------------------------------------------------
    // 2A. Legacy Disco Boogie exact groove (backwards compat)
    // -----------------------------------------------------------------------
    if (lock.isDiscoBoogieLegacy) {
      for (const s of [0, 4, 8, 12] as const) {
        events.push({
          tick: barStart + s * STEP_TICKS,
          durationTicks: 120,
          voice: 'KICK_MAIN',
          velocity: 112,
          limb: 'RF',
          role: 'KICK_CORE',
          barIndex,
          stepIndex: s,
          fixedTiming: true,
          fixedVelocity: true,
        });
      }
      for (const s of [4, 12] as const) {
        events.push({
          tick: barStart + s * STEP_TICKS,
          durationTicks: 120,
          voice: 'SNARE_MAIN',
          velocity: 114,
          limb: 'LH',
          role: 'SNARE_BACKBEAT',
          barIndex,
          stepIndex: s,
          fixedTiming: true,
          fixedVelocity: true,
        });
      }
      const openOffs = [240, 720, 1200, 1680];
      for (const off of openOffs) {
        events.push({
          tick: barStart + off,
          durationTicks: 180,
          voice: 'HH_OPEN',
          velocity: 92,
          limb: 'RH',
          role: 'TIMEKEEP',
          barIndex,
          stepIndex: (off / STEP_TICKS) as StepIndex,
          fixedTiming: true,
          fixedVelocity: true,
        });
      }
      const closedStarts = [0, 136, 376, 480, 616, 856, 960, 1096, 1336, 1440, 1576, 1816];
      for (const off of closedStarts) {
        events.push({
          tick: barStart + off,
          durationTicks: 95,
          voice: 'HH_CLOSED',
          velocity: off % 480 === 0 ? 94 : 74,
          limb: 'RH',
          role: 'TIMEKEEP',
          barIndex,
          stepIndex: (Math.floor(off / STEP_TICKS) % 16) as StepIndex,
          fixedTiming: true,
          fixedVelocity: true,
        });
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // 2B. Kick Skeleton
    // -----------------------------------------------------------------------
    let activeKickTake: KickTake = lock.kickTake;
    if (lock.preChorusProgressiveKick && barIndex >= Math.floor(totalBars / 2)) {
      activeKickTake = 'B';
    }

    let kickSteps: StepIndex[] = [...template.kickTakes[activeKickTake]];

    if (lock.isMinimalLegacy || section.kickDensity === 1) {
      kickSteps = [0, 8];
    } else if (
      section.kickDensity === 5 &&
      lock.patternId !== 'DOUBLE_BASS' &&
      !kickSteps.includes(14)
    ) {
      kickSteps = [...kickSteps, 14];
    }

    // Bar A' subtle tail pickup (never touches steps 0..7, never adds step 8 on EIGHT_BEAT Take B)
    if (
      isBarAPrime &&
      !lock.isMinimalLegacy &&
      section.kickDensity !== 1 &&
      lock.patternId !== 'DOUBLE_BASS' &&
      lock.patternId !== 'FOUR_ON_FLOOR'
    ) {
      if (lock.patternId === 'EIGHT_BEAT' && activeKickTake === 'B') {
        if (rng() < 0.35 && !kickSteps.includes(14)) {
          kickSteps.push(14);
        }
      } else if (lock.patternId === 'EIGHT_BEAT' && rng() < 0.4 && !kickSteps.includes(14)) {
        kickSteps.push(14);
      }
    }

    for (const step of kickSteps) {
      if (lock.patternId === 'DOUBLE_BASS') {
        const isEven = step % 2 === 0;
        events.push({
          tick: barStart + step * STEP_TICKS,
          durationTicks: 100,
          voice: isEven ? 'KICK_MAIN' : 'KICK_ALT',
          velocity: flavor.dynamics.kickBaseVel,
          limb: isEven ? 'RF' : 'LF',
          role: isEven ? 'KICK_DOUBLE_RF' : 'KICK_DOUBLE_LF',
          barIndex,
          stepIndex: step,
        });
      } else {
        const isDownbeat = step === 0;
        const velOffset = isDownbeat ? 4 : step % 4 === 0 ? 0 : -4;
        events.push({
          tick: barStart + step * STEP_TICKS,
          durationTicks: 120,
          voice: 'KICK_MAIN',
          velocity: clamp(flavor.dynamics.kickBaseVel + velOffset, 1, 127),
          limb: 'RF',
          role: 'KICK_CORE',
          barIndex,
          stepIndex: step,
        });
      }
    }

    // -----------------------------------------------------------------------
    // 2C. Snare Backbeat Skeleton
    // -----------------------------------------------------------------------
    for (const step of lock.snareSteps) {
      const snareVel =
        lock.snareVoice === 'SNARE_SIDESTICK'
          ? clamp(flavor.dynamics.snareBaseVel - 28, 65, 88)
          : flavor.dynamics.snareBaseVel;
      events.push({
        tick: barStart + step * STEP_TICKS,
        durationTicks: 120,
        voice: lock.snareVoice,
        velocity: snareVel,
        limb: 'LH',
        role: 'SNARE_BACKBEAT',
        barIndex,
        stepIndex: step,
      });
    }

    // Pre-Chorus 2nd half / build_up snare+floor-tom 8th crescendo on FOUR_ON_FLOOR
    if (
      lock.patternId === 'FOUR_ON_FLOOR' &&
      (lock.isBuildUpLegacy ||
        (section.type === 'Pre-Chorus' && barIndex >= Math.floor(totalBars / 2))) &&
      isBarAPrime
    ) {
      for (const s of [8, 10, 14] as const) {
        const ramp = Math.round(((s - 8) / 6) * 20);
        events.push({
          tick: barStart + s * STEP_TICKS - 2,
          durationTicks: 100,
          voice: 'SNARE_MAIN',
          velocity: clamp(86 + ramp, 70, 122),
          limb: 'LH',
          role: 'ORNAMENT',
          barIndex,
          stepIndex: s,
          fixedTiming: true,
        });
        events.push({
          tick: barStart + s * STEP_TICKS + 2,
          durationTicks: 110,
          voice: 'TOM_FLOOR',
          velocity: clamp(84 + ramp, 70, 120),
          limb: 'RH',
          role: 'ORNAMENT',
          barIndex,
          stepIndex: s,
          fixedTiming: true,
        });
      }
    }

    // -----------------------------------------------------------------------
    // 2D. Timekeeping Cymbal Skeleton (RH / LH)
    // -----------------------------------------------------------------------
    const placeSectionCrash =
      barIndex === 0 && (section.type === 'Chorus' || section.energy === 'High');

    for (const step of lock.timekeepSteps) {
      // Bar 0 step 0 Chorus/High crash replaces HH on RH
      if (placeSectionCrash && step === 0) {
        events.push({
          tick: barStart,
          durationTicks: 480,
          voice: 'CRASH_L',
          velocity: Math.max(114, flavor.dynamics.crashVel),
          limb: 'RH',
          role: 'CRASH_ACCENT',
          barIndex,
          stepIndex: 0,
          fixedTiming: true,
          fixedVelocity: true,
          isAnchor: true,
        });
        continue;
      }

      if (lock.patternId === 'UPBEAT') {
        const isDownbeat = step % 4 === 0;
        events.push({
          tick: barStart + step * STEP_TICKS,
          durationTicks: isDownbeat ? 80 : 210,
          voice: isDownbeat ? 'HH_CLOSED' : 'HH_OPEN',
          velocity: isDownbeat ? 64 : 96,
          limb: 'RH',
          role: 'TIMEKEEP',
          barIndex,
          stepIndex: step,
        });
        continue;
      }

      if (lock.patternId === 'TWO_BEAT') {
        // Weak downbeat, strong upbeat accent
        const isUpbeat = step % 4 === 2;
        events.push({
          tick: barStart + step * STEP_TICKS,
          durationTicks: isUpbeat ? 160 : 90,
          voice: lock.timekeepVoice,
          velocity: isUpbeat ? 100 : 72,
          limb: 'RH',
          role: 'TIMEKEEP',
          barIndex,
          stepIndex: step,
        });
        continue;
      }

      if (lock.patternId === 'BOUNCE') {
        const isOpenSpot = step === 10 || step === 14;
        const isQuarter = step % 4 === 0;
        const isEighth = step % 2 === 0;
        const vel = isOpenSpot
          ? 94
          : isQuarter
            ? flavor.dynamics.timekeepOnBeatVel
            : isEighth
              ? flavor.dynamics.timekeepOffBeatVel
              : flavor.dynamics.timekeepSubVel;
        events.push({
          tick: barStart + step * STEP_TICKS,
          durationTicks: isOpenSpot ? 180 : 85,
          voice: isOpenSpot ? 'HH_OPEN' : 'HH_CLOSED',
          velocity: vel,
          limb: step % 2 === 1 ? 'LH' : 'RH',
          role: 'TIMEKEEP',
          barIndex,
          stepIndex: step,
        });
        continue;
      }

      if (lock.patternId === 'SIXTEEN_BEAT') {
        const isOdd = step % 2 === 1;
        const isQuarter = step % 4 === 0;
        const vel = isQuarter
          ? flavor.dynamics.timekeepOnBeatVel
          : !isOdd
            ? flavor.dynamics.timekeepOffBeatVel
            : flavor.dynamics.timekeepSubVel;
        events.push({
          tick: barStart + step * STEP_TICKS,
          durationTicks: 75,
          voice: lock.timekeepVoice,
          velocity: vel,
          limb: lock.isTwoHanded16th && isOdd ? 'LH' : 'RH',
          role: 'TIMEKEEP',
          barIndex,
          stepIndex: step,
        });
        continue;
      }

      // Standard timekeeping (EIGHT_BEAT, FOUR_ON_FLOOR, HALF_TIME, DOUBLE_BASS)
      const isQuarter = step % 4 === 0;
      const isEighth = step % 2 === 0;
      const vel = isQuarter
        ? flavor.dynamics.timekeepOnBeatVel
        : isEighth
          ? flavor.dynamics.timekeepOffBeatVel
          : flavor.dynamics.timekeepSubVel;
      events.push({
        tick: barStart + step * STEP_TICKS,
        durationTicks:
          lock.timekeepVoice === 'HH_HALF_OPEN' || lock.timekeepVoice === 'RIDE_BOW'
            ? 180
            : 110,
        voice: lock.timekeepVoice,
        velocity: vel,
        limb: 'RH',
        role: 'TIMEKEEP',
        barIndex,
        stepIndex: step,
      });
    }

    // -----------------------------------------------------------------------
    // 2E. Safe drumHat16thEnabled Modifier (Stage 2)
    // Auto-disabled for UPBEAT, TWO_BEAT, DOUBLE_BASS, SIXTEEN_BEAT, BOUNCE, or bpm > 145
    // -----------------------------------------------------------------------
    if (hat16thEnabled && template.supportsHat16th && bpm <= 145) {
      const ornVoice: DrumVoice =
        lock.timekeepVoice === 'RIDE_BOW' || lock.timekeepVoice === 'RIDE_BELL'
          ? 'RIDE_BOW'
          : 'HH_CLOSED';
      const oddSteps: readonly StepIndex[] = [1, 3, 5, 7, 9, 11, 13, 15];
      for (const s of oddSteps) {
        events.push({
          tick: barStart + s * STEP_TICKS,
          durationTicks: 65,
          voice: ornVoice,
          velocity: flavor.dynamics.timekeepSubVel,
          limb: 'LH',
          role: 'ORNAMENT',
          barIndex,
          stepIndex: s,
        });
      }
    }

    // -----------------------------------------------------------------------
    // 2F. Legacy Trap sub-step rolls when hatSubdivision === 4 or trap_active
    // -----------------------------------------------------------------------
    if (
      lock.isTrapSubStepMode &&
      (params.hatSubdivision === 4 ||
        (section.patternPresets?.drums ?? song.members.drums.patternPreset) === 'trap_active') &&
      (section.hatDensity === undefined || section.hatDensity >= 3)
    ) {
      const rollSpots = [
        { start: 360, div: 2 }, // 60 ticks
        { start: 840, div: 3 }, // 40 ticks
        { start: 1560, div: 4 }, // 30 ticks
      ];
      for (const spot of rollSpots) {
        const subStep = Math.round(120 / spot.div);
        for (let r = 0; r < spot.div; r++) {
          const t = barStart + spot.start + r * subStep;
          events.push({
            tick: t,
            durationTicks: Math.max(15, subStep - 5),
            voice: 'HH_CLOSED',
            velocity: clamp(58 + r * 6, 40, 96),
            limb: 'RH',
            role: 'ORNAMENT',
            barIndex,
            stepIndex: (Math.floor((spot.start + r * subStep) / STEP_TICKS) % 16) as StepIndex,
            fixedTiming: true,
          });
        }
      }
    }
  }

  // Unison Riff accent Kicks (protected anchors)
  if (section.unisonRiff && section.unisonRiff.accentTicks.length > 0) {
    const sectionEnd = totalBars * BAR_TICKS;
    for (const accTick of section.unisonRiff.accentTicks) {
      if (accTick < 0 || accTick >= sectionEnd) continue;
      const barIndex = Math.floor(accTick / BAR_TICKS);
      const stepIndex = (Math.floor((accTick % BAR_TICKS) / STEP_TICKS) % 16) as StepIndex;
      // Remove non-anchor kick at exact same bar/step so anchor wins cleanly
      for (let i = events.length - 1; i >= 0; i--) {
        if (
          events[i].barIndex === barIndex &&
          events[i].stepIndex === stepIndex &&
          isKickVoice(events[i].voice) &&
          !events[i].isAnchor
        ) {
          events.splice(i, 1);
        }
      }
      events.push({
        tick: accTick,
        durationTicks: 120,
        voice: 'KICK_MAIN',
        velocity: 110,
        limb: 'RF',
        role: 'KICK_CORE',
        barIndex,
        stepIndex,
        fixedTiming: true,
        fixedVelocity: true,
        isAnchor: true,
      });
    }
  }

  return events;
}

// ===========================================================================
// Stage 3: Non-Destructive Chord Change & Offbeat Anticipation Tracking
// ===========================================================================
function applyChordAndAnticipationTracking(
  input: EngineInput,
  lock: SectionSkeletonLock,
  events: InternalDrumEvent[]
): InternalDrumEvent[] {
  const { song, section } = input;
  const totalBars = Math.max(1, section.bars);
  const drumAnticipationMode = section.drumAnticipationMode ?? 'sync';
  if (drumAnticipationMode === 'keep') {
    return events;
  }

  const drumPreset =
    section.patternPresets?.drums ??
    section.partPresets?.drums ??
    song.members.drums.patternPreset ??
    'auto';
  const flavor = GENRE_FLAVOR_PROFILES[lock.genreId];

  const barEndAntBars = new Set<number>();
  const midBarSyncBars = new Set<number>();

  const timelineChanges = getTimelineBoundaryChanges(
    section.chords,
    totalBars,
    song.key,
    song.scale
  );
  for (const ch of timelineChanges) {
    const b = Math.floor(ch.changeTick / BAR_TICKS);
    if (b < 0 || b >= totalBars) continue;
    const localTick = ch.changeTick - b * BAR_TICKS;
    if (ch.isOffbeat && Math.abs(localTick - 1680) <= 30) {
      barEndAntBars.add(b);
    } else if (ch.isOffbeat && Math.abs(localTick - 720) <= 30) {
      midBarSyncBars.add(b);
    }
  }

  if (drumPreset === 'jrock_anticipation') {
    for (let b = 0; b < totalBars - 1; b++) {
      barEndAntBars.add(b);
    }
  }

  if (barEndAntBars.size === 0 && midBarSyncBars.size === 0) {
    return events;
  }

  let out = [...events];

  for (const b of midBarSyncBars) {
    const t = b * BAR_TICKS + 720;
    out.push({
      tick: t,
      durationTicks: 120,
      voice: 'KICK_MAIN',
      velocity: clamp(flavor.dynamics.kickBaseVel, 1, 127),
      limb: 'RF',
      role: 'KICK_CHORD_TRACK',
      barIndex: b,
      stepIndex: 6,
      fixedTiming: true,
    });
  }

  for (const b of barEndAntBars) {
    const antTick = b * BAR_TICKS + 1680; // Step 14
    const nextBar = b + 1;

    // Replace RH timekeep at Step 14 with Crash/OpenHH accent, and add KICK_CHORD_TRACK
    out = out.filter(
      (ev) => !(ev.barIndex === b && ev.stepIndex === 14 && ev.limb === 'RH')
    );
    out.push({
      tick: antTick,
      durationTicks: 120,
      voice: 'KICK_MAIN',
      velocity: clamp(flavor.dynamics.kickBaseVel + 4, 1, 127),
      limb: 'RF',
      role: 'KICK_CHORD_TRACK',
      barIndex: b,
      stepIndex: 14,
      fixedTiming: true,
    });
    out.push({
      tick: antTick,
      durationTicks: 360,
      voice: 'CRASH_L',
      velocity: flavor.dynamics.crashVel,
      limb: 'RH',
      role: 'CRASH_ACCENT',
      barIndex: b,
      stepIndex: 14,
      fixedTiming: true,
    });

    // Suppress colliding downbeat kick & downbeat crash on next bar Step 0,
    // while guaranteeing timekeeping continues at Step 0 (or Step 2)
    if (nextBar < totalBars) {
      out = out.filter(
        (ev) =>
          !(
            ev.barIndex === nextBar &&
            ev.stepIndex === 0 &&
            (isKickVoice(ev.voice) || ev.role === 'CRASH_ACCENT') &&
            !ev.isAnchor
          )
      );
      const hasEarlyNextBarTimekeep = out.some(
        (ev) =>
          ev.barIndex === nextBar &&
          (ev.stepIndex === 0 || ev.stepIndex === 2) &&
          ev.role === 'TIMEKEEP'
      );
      if (!hasEarlyNextBarTimekeep) {
        out.push({
          tick: nextBar * BAR_TICKS,
          durationTicks: 120,
          voice: lock.timekeepVoice === 'HH_OPEN' ? 'HH_CLOSED' : lock.timekeepVoice,
          velocity: flavor.dynamics.timekeepOnBeatVel,
          limb: 'RH',
          role: 'TIMEKEEP',
          barIndex: nextBar,
          stepIndex: 0,
        });
      }
    }
  }

  return out;
}

// ===========================================================================
// Stage 4: Safe drumFillEnabled / drumBreakEnabled
// ===========================================================================
function applyFillsAndBreaks(
  input: EngineInput,
  lock: SectionSkeletonLock,
  events: InternalDrumEvent[],
  rng: () => number
): InternalDrumEvent[] {
  const { section, style } = input;
  const totalBars = Math.max(1, section.bars);
  const flavor = GENRE_FLAVOR_PROFILES[lock.genreId];

  const fillEnabled =
    input.drumFillEnabled ??
    section.drumFillEnabled ??
    getDefaultDrumFillEnabled(section.type, section.bars);
  const breakEnabled =
    input.drumBreakEnabled ?? section.drumBreakEnabled ?? false;

  // Legacy disco_boogie_bounce Take C always includes final bar tom fill
  const effectiveFillEnabled =
    fillEnabled || (lock.isDiscoBoogieLegacy && style === 'C');

  if (!effectiveFillEnabled && !breakEnabled) {
    return events;
  }

  let out = [...events];
  const lastBarIndex = totalBars - 1;

  // 1. Internal 4-bar boundaries (barIndex % 4 === 3 && barIndex < lastBarIndex)
  if (effectiveFillEnabled) {
    for (let b = 3; b < lastBarIndex; b += 4) {
      const barStart = b * BAR_TICKS;
      const roll = rng();

      if (roll < 0.7) {
        // 70%: subtle non-destructive turnaround (preserves skeleton!)
        if (lock.patternId === 'DOUBLE_BASS') {
          // METAL_QUAD_CHINA accent on Step 14
          out.push({
            tick: barStart + 14 * STEP_TICKS,
            durationTicks: 240,
            voice: 'CHINA',
            velocity: flavor.dynamics.crashVel,
            limb: 'RH',
            role: 'FILL_EVENT',
            barIndex: b,
            stepIndex: 14,
          });
        } else if (roll < 0.25) {
          // OPEN_HH_4AND on Step 14
          out = out.filter(
            (e) => !(e.barIndex === b && e.stepIndex === 14 && e.role === 'TIMEKEEP')
          );
          out.push({
            tick: barStart + 14 * STEP_TICKS,
            durationTicks: 200,
            voice: 'HH_OPEN',
            velocity: 96,
            limb: 'RH',
            role: 'TIMEKEEP',
            barIndex: b,
            stepIndex: 14,
          });
        } else if (roll < 0.5) {
          // KICK_DOUBLE_PICKUP on Steps 14-15
          out.push({
            tick: barStart + 15 * STEP_TICKS,
            durationTicks: 100,
            voice: 'KICK_MAIN',
            velocity: clamp(flavor.dynamics.kickBaseVel - 10, 80, 120),
            limb: 'RF',
            role: 'FILL_EVENT',
            barIndex: b,
            stepIndex: 15,
          });
        } else {
          // SNARE_DOUBLE_TAIL on Step 15
          out.push({
            tick: barStart + 15 * STEP_TICKS,
            durationTicks: 100,
            voice: lock.snareVoice,
            velocity: clamp(flavor.dynamics.snareBaseVel - 12, 70, 120),
            limb: 'LH',
            role: 'FILL_EVENT',
            barIndex: b,
            stepIndex: 15,
          });
        }
      } else {
        // 30%: compact 1-beat tom turnaround on Steps 12..15 + crash landing on next bar Step 0
        out = out.filter(
          (e) =>
            !(
              e.barIndex === b &&
              e.stepIndex >= 12 &&
              (e.role === 'TIMEKEEP' || e.role === 'ORNAMENT')
            )
        );
        const voices: DrumVoice[] = ['TOM_HI', 'TOM_MID', 'TOM_MID', 'TOM_FLOOR'];
        for (let idx = 0; idx < 4; idx++) {
          const step = (12 + idx) as StepIndex;
          out.push({
            tick: barStart + step * STEP_TICKS,
            durationTicks: 105,
            voice: voices[idx],
            velocity: clamp(92 + idx * 6, 75, 122),
            limb: idx % 2 === 0 ? 'RH' : 'LH',
            role: 'FILL_EVENT',
            barIndex: b,
            stepIndex: step,
          });
        }
        // Crash + Kick landing on next bar Step 0
        const nextBar = b + 1;
        out = out.filter(
          (e) => !(e.barIndex === nextBar && e.stepIndex === 0 && e.role === 'TIMEKEEP')
        );
        out.push({
          tick: nextBar * BAR_TICKS,
          durationTicks: 480,
          voice: 'CRASH_L',
          velocity: flavor.dynamics.crashVel,
          limb: 'RH',
          role: 'CRASH_ACCENT',
          barIndex: nextBar,
          stepIndex: 0,
        });
      }
    }
  }

  // 2. Section final bar: Fill / Break / Fill+Break
  const lastBarStart = lastBarIndex * BAR_TICKS;

  if (effectiveFillEnabled && !breakEnabled) {
    // COMPACT_TOM_2BEAT on Steps 8..15 (removes groove cymbals & ornaments in 8..15)
    out = out.filter(
      (e) =>
        !(
          e.barIndex === lastBarIndex &&
          e.stepIndex >= 8 &&
          !isKickVoice(e.voice)
        )
    );
    const tomSeq: Array<{ step: StepIndex; voice: DrumVoice; vel: number }> = [
      { step: 8, voice: 'SNARE_MAIN', vel: 106 },
      { step: 9, voice: 'TOM_HI', vel: 92 },
      { step: 10, voice: 'TOM_HI', vel: 102 },
      { step: 11, voice: 'TOM_MID', vel: 94 },
      { step: 12, voice: 'TOM_MID', vel: 108 },
      { step: 13, voice: 'TOM_FLOOR', vel: 98 },
      { step: 14, voice: 'TOM_FLOOR', vel: 112 },
      { step: 15, voice: 'SNARE_MAIN', vel: 116 },
    ];
    for (let i = 0; i < tomSeq.length; i++) {
      const item = tomSeq[i];
      out.push({
        tick: lastBarStart + item.step * STEP_TICKS,
        durationTicks: 105,
        voice: item.voice,
        velocity: item.vel,
        limb: i % 2 === 0 ? 'RH' : 'LH',
        role: 'FILL_EVENT',
        barIndex: lastBarIndex,
        stepIndex: item.step,
      });
    }
  } else if (effectiveFillEnabled && breakEnabled) {
    // Fill + Break combo: compact tom fill on beats 2-3 (Steps 4..11), dead silence on beat 4 (Steps 12..15)
    out = out.filter(
      (e) => !(e.barIndex === lastBarIndex && e.stepIndex >= 4)
    );
    const fillSeq: Array<{ step: StepIndex; voice: DrumVoice; vel: number }> = [
      { step: 4, voice: 'SNARE_MAIN', vel: 112 },
      { step: 6, voice: 'TOM_HI', vel: 100 },
      { step: 7, voice: 'TOM_HI', vel: 94 },
      { step: 8, voice: 'TOM_MID', vel: 106 },
      { step: 9, voice: 'TOM_MID', vel: 98 },
      { step: 10, voice: 'TOM_FLOOR', vel: 112 },
      { step: 11, voice: 'SNARE_MAIN', vel: 116 },
    ];
    for (let i = 0; i < fillSeq.length; i++) {
      const item = fillSeq[i];
      out.push({
        tick: lastBarStart + item.step * STEP_TICKS,
        durationTicks: 105,
        voice: item.voice,
        velocity: item.vel,
        limb: i % 2 === 0 ? 'RH' : 'LH',
        role: 'FILL_EVENT',
        barIndex: lastBarIndex,
        stepIndex: item.step,
        fixedTiming: true,
      });
    }
    // Anchor kick on beat 3 (step 8)
    out.push({
      tick: lastBarStart + 8 * STEP_TICKS,
      durationTicks: 120,
      voice: 'KICK_MAIN',
      velocity: 114,
      limb: 'RF',
      role: 'KICK_CORE',
      barIndex: lastBarIndex,
      stepIndex: 8,
      fixedTiming: true,
    });
  } else if (!effectiveFillEnabled && breakEnabled) {
    // Break only: Beat 3 hit (Step 8, tick +960) + clean silence on Steps 10..15 [1200..1920)
    out = out.filter(
      (e) => !(e.barIndex === lastBarIndex && e.stepIndex >= 8)
    );
    out.push({
      tick: lastBarStart + 8 * STEP_TICKS,
      durationTicks: 140,
      voice: 'KICK_MAIN',
      velocity: 116,
      limb: 'RF',
      role: 'KICK_CORE',
      barIndex: lastBarIndex,
      stepIndex: 8,
      fixedTiming: true,
      isAnchor: true,
    });
    out.push({
      tick: lastBarStart + 8 * STEP_TICKS,
      durationTicks: 220,
      voice: 'CRASH_L',
      velocity: flavor.dynamics.crashVel,
      limb: 'RH',
      role: 'CRASH_ACCENT',
      barIndex: lastBarIndex,
      stepIndex: 8,
      fixedTiming: true,
    });
  }

  return out;
}

// ===========================================================================
// Stage 5: Priority-Based 4-Limb Conflict Solver & Hi-Hat Choke
// ===========================================================================
const ROLE_PRIORITY: Record<EventRole, number> = {
  SNARE_BACKBEAT: 1,
  KICK_DOUBLE_RF: 2,
  KICK_DOUBLE_LF: 2,
  KICK_CORE: 3,
  TIMEKEEP: 4,
  CRASH_ACCENT: 5,
  FILL_EVENT: 6,
  KICK_CHORD_TRACK: 7,
  ORNAMENT: 8,
};

export function resolveLimbConflicts(
  events: InternalDrumEvent[],
  lockLeftFootForDoubleBass: boolean
): InternalDrumEvent[] {
  const grouped = new Map<string, InternalDrumEvent[]>();
  const subStepExtras: InternalDrumEvent[] = [];

  for (const ev of events) {
    if (lockLeftFootForDoubleBass && ev.voice === 'HH_PEDAL') continue;

    // Preserve sub-16th trap rolls or bounced disco 16ths that sit at distinct ticks
    if (ev.fixedTiming && ev.tick % STEP_TICKS !== 0) {
      subStepExtras.push(ev);
      continue;
    }

    const key = `${ev.barIndex}:${ev.stepIndex}:${ev.limb}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(ev);
    grouped.set(key, bucket);
  }

  const resolved: InternalDrumEvent[] = [...subStepExtras];
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]);
    resolved.push(bucket[0]);
  }

  // Prevent simultaneous HH_OPEN / HH_HALF_OPEN with HH_CLOSED / HH_PEDAL on the same step
  const openStepSet = new Set<string>();
  for (const ev of resolved) {
    if (isHiHatOpenVoice(ev.voice)) {
      openStepSet.add(`${ev.barIndex}:${ev.stepIndex}`);
    }
  }
  const filtered = resolved.filter((ev) => {
    if (isHiHatClosedOrPedalVoice(ev.voice) && !ev.fixedTiming) {
      if (openStepSet.has(`${ev.barIndex}:${ev.stepIndex}`)) {
        return false;
      }
    }
    return true;
  });

  return filtered.sort((a, b) => a.tick - b.tick);
}

// ===========================================================================
// Stage 6: Genre Flavor, Swing, Microtiming, Double-Bass Physics & Invariants
// ===========================================================================
export function applyGenreFlavor(
  events: InternalDrumEvent[],
  template: { supportsSwing16th: boolean },
  flavor: {
    microtiming: {
      snareOffsetMs: number;
      kickBeforeSnareMs: number;
      maxJitterMs: number;
      bounceSwingTicks: number;
    };
    dynamics: {
      doubleBassLfDelta: number;
    };
  },
  bpm: number,
  rng: () => number
): InternalDrumEvent[] {
  const snareStepSet = new Set(
    events
      .filter((e) => e.role === 'SNARE_BACKBEAT')
      .map((e) => `${e.barIndex}:${e.stepIndex}`)
  );
  const doubleBassMaxVel = clamp(
    Math.round(112 - Math.max(0, bpm - 135) * 0.42),
    82,
    112
  );

  return events.map((ev) => {
    if (ev.fixedTiming && ev.fixedVelocity) {
      return ev;
    }

    let tickShift = 0;
    let vel = ev.velocity;

    if (!ev.fixedTiming) {
      if (template.supportsSwing16th && ev.stepIndex % 2 === 1) {
        tickShift += flavor.microtiming.bounceSwingTicks;
      }

      const isSnareCoincident = snareStepSet.has(`${ev.barIndex}:${ev.stepIndex}`);
      if (ev.role === 'SNARE_BACKBEAT') {
        tickShift += msToTicks(clamp(flavor.microtiming.snareOffsetMs, -8, 8), bpm);
      } else if (isKickVoice(ev.voice) && isSnareCoincident) {
        tickShift += msToTicks(flavor.microtiming.kickBeforeSnareMs, bpm);
      }

      // Protect Step 0 downbeat kick (always 0 jitter), and Step 0 / Step 10 anchors on BOUNCE
      const isProtectedAnchor =
        (ev.stepIndex === 0 && ev.voice === 'KICK_MAIN') ||
        (template.supportsSwing16th && (ev.stepIndex === 0 || ev.stepIndex === 10));

      if (!isProtectedAnchor) {
        const jitterMs = (rng() * 2 - 1) * Math.min(flavor.microtiming.maxJitterMs, 2.5);
        tickShift += msToTicks(jitterMs, bpm);
      }
    }

    if (!ev.fixedVelocity) {
      const isSnareCoincident = snareStepSet.has(`${ev.barIndex}:${ev.stepIndex}`);
      if (ev.role === 'KICK_DOUBLE_RF') {
        const beatAccent = ev.stepIndex % 4 === 0 ? 5 : 0;
        vel = Math.min(vel, doubleBassMaxVel) + beatAccent;
      } else if (ev.role === 'KICK_DOUBLE_LF') {
        vel = Math.min(vel, doubleBassMaxVel) + flavor.dynamics.doubleBassLfDelta;
      }

      if (isKickVoice(ev.voice) && isSnareCoincident) {
        vel -= 18;
      }
    }

    return {
      ...ev,
      tick: Math.max(0, ev.tick + tickShift),
      velocity: clamp(Math.round(vel), 1, 127),
    };
  });
}

export function enforceFinalInvariants(
  events: InternalDrumEvent[],
  sectionStartTick: number,
  sectionEndTick: number,
  midiMapMode: MidiMapMode
): InternalDrumEvent[] {
  if (sectionEndTick <= sectionStartTick) return [];
  const maxStart = Math.max(sectionStartTick, sectionEndTick - 15);
  const noteMap = MIDI_NOTE_MAP[midiMapMode];

  const clamped: InternalDrumEvent[] = [];
  for (const ev of events) {
    const tick = Math.min(maxStart, Math.max(sectionStartTick, Math.round(ev.tick)));
    const maxDur = Math.max(15, sectionEndTick - tick);
    const durationTicks = Math.max(15, Math.min(Math.round(ev.durationTicks), maxDur));
    if (tick < sectionStartTick || tick >= sectionEndTick) continue;
    clamped.push({
      ...ev,
      tick,
      durationTicks,
      velocity: clamp(Math.round(ev.velocity), 1, 127),
    });
  }

  // Deduplicate identical (mappedPitch, tick), keeping highest velocity
  const dedupMap = new Map<string, InternalDrumEvent>();
  for (const ev of clamped) {
    const pitch = ev.rawMidiPitch ?? noteMap[ev.voice];
    const key = `${pitch}:${ev.tick}`;
    const existing = dedupMap.get(key);
    if (!existing || ev.velocity > existing.velocity) {
      dedupMap.set(key, ev);
    }
  }

  const finalList = Array.from(dedupMap.values()).sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    const pa = a.rawMidiPitch ?? noteMap[a.voice];
    const pb = b.rawMidiPitch ?? noteMap[b.voice];
    return pa - pb;
  });

  // Hi-hat choke: clamp Open/Half-Open HH duration before next Closed/Pedal HH
  for (let i = 0; i < finalList.length; i++) {
    const ev = finalList[i];
    if (!isHiHatOpenVoice(ev.voice)) continue;
    for (let j = i + 1; j < finalList.length; j++) {
      const next = finalList[j];
      if (next.tick > ev.tick && isHiHatClosedOrPedalVoice(next.voice)) {
        const chokedDur = Math.max(15, Math.min(ev.durationTicks, next.tick - ev.tick));
        if (chokedDur !== ev.durationTicks) {
          finalList[i] = { ...ev, durationTicks: chokedDur };
        }
        break;
      }
    }
  }

  return finalList;
}

// ===========================================================================
// Main Entry Points
// ===========================================================================
export function generateDrumResult(input: EngineInput): DrumGenerationResult {
  const { song, section, seed } = input;
  const bpm = input.bpm ?? song.bpm;
  const midiMapMode: MidiMapMode = input.midiMapMode ?? 'GM_STANDARD';
  const rng = mulberry32(seed);

  // Stage 1: Section Skeleton Lock
  const skeleton = lockSectionSkeleton(input, rng);

  if (!song.members.drums.enabled || section.enabledParts?.drums === false) {
    return {
      notes: [],
      events: [],
      kickTicks: [],
      patternId: skeleton.patternId,
      kickTake: skeleton.kickTake,
      genreId: skeleton.genreId,
      midiMapMode,
      skeleton,
    };
  }

  const sectionStartTick = 0;
  const sectionEndTick = Math.max(1, section.bars) * BAR_TICKS;
  const noteMap = MIDI_NOTE_MAP[midiMapMode];

  // External uploaded drum loop short-circuit (immutable, deterministic)
  if (section.uploadedDrumLoop ?? song.uploadedDrumLoop) {
    const loopEvents = generateExternalLoopEvents(input, rng);
    const finalLoopEvents = enforceFinalInvariants(
      loopEvents,
      sectionStartTick,
      sectionEndTick,
      midiMapMode
    );
    const notes: MidiNote[] = finalLoopEvents.map((ev) => ({
      pitch: ev.rawMidiPitch ?? noteMap[ev.voice],
      velocity: ev.velocity,
      startTick: ev.tick,
      durationTicks: ev.durationTicks,
      channel: 9,
    }));
    const kickTicks = finalLoopEvents
      .filter((ev) => isKickVoice(ev.voice))
      .map((ev) => ev.tick);
    return {
      notes,
      events: finalLoopEvents,
      kickTicks,
      patternId: skeleton.patternId,
      kickTake: skeleton.kickTake,
      genreId: skeleton.genreId,
      midiMapMode,
      skeleton,
    };
  }

  // Stage 2: Base Skeleton Expansion + Safe drumHat16thEnabled
  const stage2 = expandBaseSkeleton(input, skeleton, rng);

  // Stage 3: Non-Destructive Chord Change & Offbeat Anticipation Tracking
  const stage3 = applyChordAndAnticipationTracking(input, skeleton, stage2);

  // Stage 4: Safe drumFillEnabled / drumBreakEnabled
  const stage4 = applyFillsAndBreaks(input, skeleton, stage3, rng);

  // Stage 5: Priority-Based 4-Limb Conflict Solver
  const lockLeftFoot = skeleton.patternId === 'DOUBLE_BASS';
  const stage5 = resolveLimbConflicts(stage4, lockLeftFoot);

  // Stage 6: Genre Flavor, Swing, Microtiming, Double-Bass Physics & MIDI Map
  const template = BEAT_TEMPLATES[skeleton.patternId];
  const flavor = GENRE_FLAVOR_PROFILES[skeleton.genreId];
  const stage6 = applyGenreFlavor(stage5, template, flavor, bpm, rng);
  const finalEvents = enforceFinalInvariants(
    stage6,
    sectionStartTick,
    sectionEndTick,
    midiMapMode
  );

  const notes: MidiNote[] = finalEvents.map((ev) => ({
    pitch: ev.rawMidiPitch ?? noteMap[ev.voice],
    velocity: ev.velocity,
    startTick: ev.tick,
    durationTicks: ev.durationTicks,
    channel: 9,
  }));

  const kickTicks = finalEvents
    .filter((ev) => isKickVoice(ev.voice))
    .map((ev) => ev.tick);

  return {
    notes,
    events: finalEvents,
    kickTicks,
    patternId: skeleton.patternId,
    kickTake: skeleton.kickTake,
    genreId: skeleton.genreId,
    midiMapMode,
    skeleton,
  };
}

export function generateDrumNotes(input: EngineInput): MidiNote[] {
  return generateDrumResult(input).notes;
}
