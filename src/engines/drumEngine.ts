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
  | 'SNARE_FLAM'
  | 'SNARE_ROLL'
  | 'HH_CLOSED'
  | 'HH_PEDAL'
  | 'HH_HALF_OPEN'
  | 'HH_OPEN'
  | 'RIDE_BOW'
  | 'RIDE_BELL'
  | 'CRASH_L'
  | 'CRASH_R'
  | 'CHINA'
  | 'SPLASH'
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
    SNARE_FLAM: 38,
    SNARE_ROLL: 38,
    HH_CLOSED: 42,
    HH_PEDAL: 44,
    HH_HALF_OPEN: 46,
    HH_OPEN: 46,
    RIDE_BOW: 51,
    RIDE_BELL: 53,
    CRASH_L: 49,
    CRASH_R: 57,
    CHINA: 52,
    SPLASH: 55,
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
    SNARE_FLAM: 38,
    SNARE_ROLL: 21,
    HH_CLOSED: 42,
    HH_PEDAL: 44,
    HH_HALF_OPEN: 62,
    HH_OPEN: 64,
    RIDE_BOW: 51,
    RIDE_BELL: 53,
    CRASH_L: 55,
    CRASH_R: 57,
    CHINA: 31,
    SPLASH: 50,
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
// 2. Layer 1: 20 Beat Skeletons (17 Core + 3 Specialty) × 3 Takes (A / B / C)
// ===========================================================================
export type BeatPatternCategory =
  | 'BASIC_ROCK'
  | 'DANCE_MODERN'
  | 'SHUFFLE_ORGANIC'
  | 'JAZZ_LATIN';

export type BeatGridType = 'straight' | 'triplet';

export interface BeatTemplate {
  readonly id: BeatPatternId;
  readonly label: string;
  readonly category: BeatPatternCategory;
  readonly gridType?: BeatGridType;
  readonly customSkeleton?: boolean;
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
    category: 'BASIC_ROCK',
    gridType: 'straight',
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
    category: 'BASIC_ROCK',
    gridType: 'straight',
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
  ATAMA_UCHI: {
    id: 'ATAMA_UCHI',
    label: '頭打ち（邦ロック式）',
    category: 'BASIC_ROCK',
    gridType: 'straight',
    customSkeleton: true,
    snareSteps: [0, 4, 8, 12],
    timekeepSteps: [0, 4, 8, 12],
    kickTakes: {
      A: [2, 6, 10, 14],
      B: [10, 14],
      C: [0, 2, 6, 10, 14],
    },
    defaultTimekeepVoice: 'HH_CLOSED',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  FOUR_ON_FLOOR: {
    id: 'FOUR_ON_FLOOR',
    label: '四つ打ち（ダンス系）',
    category: 'DANCE_MODERN',
    gridType: 'straight',
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
    category: 'DANCE_MODERN',
    gridType: 'straight',
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
    category: 'BASIC_ROCK',
    gridType: 'straight',
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
    category: 'BASIC_ROCK',
    gridType: 'straight',
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
    category: 'BASIC_ROCK',
    gridType: 'straight',
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
    category: 'BASIC_ROCK',
    gridType: 'straight',
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
  SOCA: {
    id: 'SOCA',
    label: 'ソカ（3-3-2疾走）',
    category: 'DANCE_MODERN',
    gridType: 'straight',
    customSkeleton: true,
    snareSteps: [3, 6, 11, 14],
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 4, 8, 12],
      B: [0, 4, 8, 12],
      C: [0, 4, 8, 12, 15],
    },
    defaultTimekeepVoice: 'HH_CLOSED',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  SLIP_BEAT: {
    id: 'SLIP_BEAT',
    label: 'スリップビート（Shake系）',
    category: 'DANCE_MODERN',
    gridType: 'straight',
    customSkeleton: true,
    snareSteps: [4, 10, 14],
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 5, 8, 12],
      B: [0, 2, 6, 10, 13],
      C: [0, 4, 7, 12],
    },
    defaultTimekeepVoice: 'HH_CLOSED',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  SHUFFLE: {
    id: 'SHUFFLE',
    label: 'シャッフル（3連）',
    category: 'SHUFFLE_ORGANIC',
    gridType: 'triplet',
    customSkeleton: true,
    snareSteps: [4, 12],
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 6, 8],
      B: [0, 2, 8, 10, 14],
      C: [0, 2, 4, 6, 8, 10, 12, 14],
    },
    defaultTimekeepVoice: 'HH_CLOSED',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  HALF_TIME_SHUFFLE: {
    id: 'HALF_TIME_SHUFFLE',
    label: 'ハーフタイムシャッフル',
    category: 'SHUFFLE_ORGANIC',
    gridType: 'triplet',
    customSkeleton: true,
    snareSteps: [8],
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 6, 14],
      B: [0, 2, 6, 14],
      C: [0, 4, 6, 9, 13],
    },
    defaultTimekeepVoice: 'HH_CLOSED',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  JUNGLE: {
    id: 'JUNGLE',
    label: 'ジャングルビート（タム主体）',
    category: 'SHUFFLE_ORGANIC',
    gridType: 'straight',
    customSkeleton: true,
    snareSteps: [12],
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 4, 8, 12],
      B: [0, 6, 8, 13],
      C: [1, 3, 5, 7, 9, 11, 13, 15],
    },
    defaultTimekeepVoice: 'TOM_FLOOR',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  TRAIN: {
    id: 'TRAIN',
    label: 'トレインビート（16分スネア）',
    category: 'SHUFFLE_ORGANIC',
    gridType: 'straight',
    customSkeleton: true,
    snareSteps: [4, 12],
    timekeepSteps: [4, 12],
    kickTakes: {
      A: [0, 8],
      B: [0, 6, 8],
      C: [0, 4, 8, 12],
    },
    defaultTimekeepVoice: 'HH_PEDAL',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  MARCH: {
    id: 'MARCH',
    label: 'マーチ（行進ルーディメンツ）',
    category: 'SHUFFLE_ORGANIC',
    gridType: 'straight',
    customSkeleton: true,
    snareSteps: [0, 4, 8, 12],
    timekeepSteps: [4, 12],
    kickTakes: {
      A: [0, 4, 8, 12],
      B: [0, 4, 8, 12],
      C: [0, 4, 8, 12],
    },
    defaultTimekeepVoice: 'HH_PEDAL',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  PPPH: {
    id: 'PPPH',
    label: 'PPPH（Bメロ定番）',
    category: 'DANCE_MODERN',
    gridType: 'straight',
    customSkeleton: true,
    snareSteps: [0, 6, 8],
    timekeepSteps: [0, 6, 8],
    kickTakes: {
      A: [0, 6, 8],
      B: [0, 6, 8],
      C: [0, 6, 8, 12, 14],
    },
    defaultTimekeepVoice: 'HH_OPEN',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  FOUR_BEAT: {
    id: 'FOUR_BEAT',
    label: '4ビート（ジャズ・スウィング）',
    category: 'JAZZ_LATIN',
    gridType: 'triplet',
    customSkeleton: true,
    snareSteps: [],
    timekeepSteps: [0, 4, 6, 8, 12, 14],
    kickTakes: {
      A: [0, 4, 8, 12],
      B: [0, 8],
      C: [0, 6, 12],
    },
    defaultTimekeepVoice: 'RIDE_BOW',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  SAMBA: {
    id: 'SAMBA',
    label: 'サンバ／ボサノヴァ',
    category: 'JAZZ_LATIN',
    gridType: 'straight',
    customSkeleton: true,
    snareSteps: [],
    timekeepSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickTakes: {
      A: [0, 3, 4, 7, 8, 11, 12, 15],
      B: [0, 3, 4, 7, 8, 11, 12, 15],
      C: [0, 3, 4, 7, 8, 11, 12, 15],
    },
    defaultTimekeepVoice: 'RIDE_BOW',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
  SONGO: {
    id: 'SONGO',
    label: 'ソンゴ（キューバン・リニア）',
    category: 'JAZZ_LATIN',
    gridType: 'straight',
    customSkeleton: true,
    snareSteps: [4, 10],
    timekeepSteps: [0, 2, 5, 8, 9, 12, 15],
    kickTakes: {
      A: [3, 6, 11, 14],
      B: [3, 6, 11, 14],
      C: [0, 3, 6, 11, 14],
    },
    defaultTimekeepVoice: 'HH_CLOSED',
    supportsSwing16th: false,
    supportsHat16th: false,
  },
};

export const LEGACY_8_BEAT_PATTERN_IDS: readonly BeatPatternId[] = [
  'EIGHT_BEAT',
  'SIXTEEN_BEAT',
  'FOUR_ON_FLOOR',
  'UPBEAT',
  'TWO_BEAT',
  'BOUNCE',
  'HALF_TIME',
  'DOUBLE_BASS',
];

export const ALL_BEAT_PATTERN_IDS: readonly BeatPatternId[] = [
  'EIGHT_BEAT',
  'SIXTEEN_BEAT',
  'ATAMA_UCHI',
  'FOUR_ON_FLOOR',
  'UPBEAT',
  'TWO_BEAT',
  'BOUNCE',
  'HALF_TIME',
  'DOUBLE_BASS',
  'SOCA',
  'SLIP_BEAT',
  'SHUFFLE',
  'HALF_TIME_SHUFFLE',
  'JUNGLE',
  'TRAIN',
  'MARCH',
  'PPPH',
  'FOUR_BEAT',
  'SAMBA',
  'SONGO',
];

export const BEAT_PATTERN_CATEGORIES: ReadonlyArray<{
  readonly id: BeatPatternCategory;
  readonly label: string;
  readonly collapsible?: boolean;
  readonly patterns: readonly BeatPatternId[];
}> = [
  {
    id: 'BASIC_ROCK',
    label: 'Basic & Rock（基本7種）',
    patterns: [
      'EIGHT_BEAT',
      'SIXTEEN_BEAT',
      'ATAMA_UCHI',
      'TWO_BEAT',
      'HALF_TIME',
      'BOUNCE',
      'DOUBLE_BASS',
    ],
  },
  {
    id: 'DANCE_MODERN',
    label: 'Dance & Modern（ダンス・モダン5種）',
    patterns: ['FOUR_ON_FLOOR', 'UPBEAT', 'SOCA', 'SLIP_BEAT', 'PPPH'],
  },
  {
    id: 'SHUFFLE_ORGANIC',
    label: 'Shuffle & Organic（跳ね・ノンシンバル5種）',
    patterns: ['SHUFFLE', 'HALF_TIME_SHUFFLE', 'JUNGLE', 'TRAIN', 'MARCH'],
  },
  {
    id: 'JAZZ_LATIN',
    label: 'Specialty / Jazz & Latin（拡張3種）',
    collapsible: true,
    patterns: ['FOUR_BEAT', 'SAMBA', 'SONGO'],
  },
];

export function isTripletSkeleton(patternId: BeatPatternId): boolean {
  return BEAT_TEMPLATES[patternId]?.gridType === 'triplet';
}

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

export type FillTemplateId =
  | 'FILL_1B_STRAIGHT_TOM_SNARE'
  | 'FILL_1B_LINEAR_RLKK'
  | 'FILL_1B_TRIPLET_BONHAM'
  | 'FILL_2B_CLASSIC_TOM_RUN'
  | 'FILL_2B_LINEAR_RLRLKK_RL'
  | 'FILL_2B_FLAM_ROCK'
  | 'FILL_2B_6TUPLET_SHUFFLE'
  | 'FILL_4B_SNARE_CRESCENDO'
  | 'FILL_4B_3OVER4_TOM_SYNC'
  | 'FILL_4B_BREAK_KIME_ANISON';

export interface FillTemplateEventSpec {
  readonly offsetTick: number;
  readonly voice: DrumVoice;
  readonly velocity: number;
  readonly limb: Limb;
  readonly durationTicks?: number;
  readonly role?: EventRole;
}

export interface FillTemplate {
  readonly id: FillTemplateId;
  readonly label: string;
  readonly beats: 1 | 2 | 4;
  readonly fillStartTick: 0 | 960 | 1440;
  readonly grid: BeatGridType;
  readonly maxSafeBpm?: number;
  readonly isBreakKime?: boolean;
  readonly events: readonly FillTemplateEventSpec[];
}

export const FILL_TEMPLATES: readonly FillTemplate[] = [
  // 1-beat turnaround (fillStartTick: 1440)
  {
    id: 'FILL_1B_STRAIGHT_TOM_SNARE',
    label: '1拍 ストレートタム＆スネア',
    beats: 1,
    fillStartTick: 1440,
    grid: 'straight',
    events: [
      { offsetTick: 1440, voice: 'SNARE_MAIN', velocity: 108, limb: 'RH' },
      { offsetTick: 1560, voice: 'SNARE_MAIN', velocity: 88, limb: 'LH' },
      { offsetTick: 1680, voice: 'TOM_HI', velocity: 104, limb: 'RH' },
      { offsetTick: 1800, voice: 'TOM_FLOOR', velocity: 112, limb: 'LH' },
    ],
  },
  {
    id: 'FILL_1B_LINEAR_RLKK',
    label: '1拍 リニア RLKK',
    beats: 1,
    fillStartTick: 1440,
    grid: 'straight',
    events: [
      { offsetTick: 1440, voice: 'SNARE_MAIN', velocity: 112, limb: 'RH' },
      { offsetTick: 1560, voice: 'TOM_HI', velocity: 102, limb: 'LH' },
      { offsetTick: 1680, voice: 'KICK_MAIN', velocity: 110, limb: 'RF' },
      { offsetTick: 1800, voice: 'KICK_MAIN', velocity: 114, limb: 'RF' },
    ],
  },
  {
    id: 'FILL_1B_TRIPLET_BONHAM',
    label: '1拍 3連ボンゾ風',
    beats: 1,
    fillStartTick: 1440,
    grid: 'triplet',
    events: [
      { offsetTick: 1440, voice: 'SNARE_MAIN', velocity: 110, limb: 'RH' },
      { offsetTick: 1600, voice: 'TOM_HI', velocity: 102, limb: 'LH' },
      { offsetTick: 1760, voice: 'KICK_MAIN', velocity: 112, limb: 'RF' },
    ],
  },
  // 2-beat cadence (fillStartTick: 960)
  {
    id: 'FILL_2B_CLASSIC_TOM_RUN',
    label: '2拍 王道降下タム回し',
    beats: 2,
    fillStartTick: 960,
    grid: 'straight',
    events: [
      { offsetTick: 960, voice: 'SNARE_MAIN', velocity: 104, limb: 'RH' },
      { offsetTick: 1080, voice: 'SNARE_MAIN', velocity: 90, limb: 'LH' },
      { offsetTick: 1200, voice: 'TOM_HI', velocity: 102, limb: 'RH' },
      { offsetTick: 1320, voice: 'TOM_HI', velocity: 94, limb: 'LH' },
      { offsetTick: 1440, voice: 'TOM_MID', velocity: 104, limb: 'RH' },
      { offsetTick: 1560, voice: 'TOM_MID', velocity: 96, limb: 'LH' },
      { offsetTick: 1680, voice: 'TOM_FLOOR', velocity: 110, limb: 'RH' },
      { offsetTick: 1800, voice: 'TOM_FLOOR', velocity: 116, limb: 'LH' },
    ],
  },
  {
    id: 'FILL_2B_LINEAR_RLRLKK_RL',
    label: '2拍 リニア RLRLKK-RL',
    beats: 2,
    fillStartTick: 960,
    grid: 'straight',
    events: [
      { offsetTick: 960, voice: 'SNARE_MAIN', velocity: 106, limb: 'RH' },
      { offsetTick: 1080, voice: 'SNARE_MAIN', velocity: 92, limb: 'LH' },
      { offsetTick: 1200, voice: 'TOM_HI', velocity: 104, limb: 'RH' },
      { offsetTick: 1320, voice: 'TOM_MID', velocity: 100, limb: 'LH' },
      { offsetTick: 1440, voice: 'KICK_MAIN', velocity: 108, limb: 'RF' },
      { offsetTick: 1560, voice: 'KICK_MAIN', velocity: 112, limb: 'RF' },
      { offsetTick: 1680, voice: 'SNARE_MAIN', velocity: 116, limb: 'RH' },
      { offsetTick: 1800, voice: 'TOM_FLOOR', velocity: 118, limb: 'LH' },
    ],
  },
  {
    id: 'FILL_2B_FLAM_ROCK',
    label: '2拍 フラムロック',
    beats: 2,
    fillStartTick: 960,
    grid: 'straight',
    events: [
      { offsetTick: 960, voice: 'SNARE_FLAM', velocity: 110, limb: 'RH' },
      { offsetTick: 1200, voice: 'KICK_MAIN', velocity: 108, limb: 'RF' },
      { offsetTick: 1320, voice: 'SNARE_MAIN', velocity: 104, limb: 'LH' },
      { offsetTick: 1440, voice: 'SNARE_FLAM', velocity: 114, limb: 'RH' },
      { offsetTick: 1680, voice: 'TOM_HI', velocity: 106, limb: 'RH' },
      { offsetTick: 1800, voice: 'TOM_FLOOR', velocity: 116, limb: 'LH' },
    ],
  },
  {
    id: 'FILL_2B_6TUPLET_SHUFFLE',
    label: '2拍 6連シャッフルタム',
    beats: 2,
    fillStartTick: 960,
    grid: 'triplet',
    maxSafeBpm: 155,
    events: [
      { offsetTick: 960, voice: 'SNARE_MAIN', velocity: 106, limb: 'RH', durationTicks: 70 },
      { offsetTick: 1040, voice: 'SNARE_MAIN', velocity: 86, limb: 'LH', durationTicks: 70 },
      { offsetTick: 1120, voice: 'TOM_HI', velocity: 98, limb: 'RH', durationTicks: 70 },
      { offsetTick: 1200, voice: 'TOM_HI', velocity: 90, limb: 'LH', durationTicks: 70 },
      { offsetTick: 1280, voice: 'TOM_MID', velocity: 100, limb: 'RH', durationTicks: 70 },
      { offsetTick: 1360, voice: 'TOM_MID', velocity: 92, limb: 'LH', durationTicks: 70 },
      { offsetTick: 1440, voice: 'SNARE_MAIN', velocity: 108, limb: 'RH', durationTicks: 70 },
      { offsetTick: 1520, voice: 'TOM_HI', velocity: 96, limb: 'LH', durationTicks: 70 },
      { offsetTick: 1600, voice: 'TOM_MID', velocity: 104, limb: 'RH', durationTicks: 70 },
      { offsetTick: 1680, voice: 'TOM_FLOOR', velocity: 108, limb: 'LH', durationTicks: 70 },
      { offsetTick: 1760, voice: 'TOM_FLOOR', velocity: 112, limb: 'RH', durationTicks: 70 },
      { offsetTick: 1840, voice: 'SNARE_MAIN', velocity: 118, limb: 'LH', durationTicks: 70 },
    ],
  },
  // 4-beat section transition (fillStartTick: 0)
  {
    id: 'FILL_4B_SNARE_CRESCENDO',
    label: '4拍 スネアクレッシェンド',
    beats: 4,
    fillStartTick: 0,
    grid: 'straight',
    events: [
      ...Array.from({ length: 16 }, (_, idx): FillTemplateEventSpec => ({
        offsetTick: idx * 120,
        voice: 'SNARE_MAIN',
        velocity: Math.round(58 + ((122 - 58) * idx) / 15),
        limb: idx % 2 === 0 ? 'RH' : 'LH',
        durationTicks: 90,
      })),
      { offsetTick: 0, voice: 'KICK_MAIN', velocity: 108, limb: 'RF', role: 'KICK_CORE' },
      { offsetTick: 480, voice: 'KICK_MAIN', velocity: 108, limb: 'RF', role: 'KICK_CORE' },
      { offsetTick: 960, voice: 'KICK_MAIN', velocity: 112, limb: 'RF', role: 'KICK_CORE' },
      { offsetTick: 1440, voice: 'KICK_MAIN', velocity: 116, limb: 'RF', role: 'KICK_CORE' },
      { offsetTick: 0, voice: 'HH_PEDAL', velocity: 78, limb: 'LF', role: 'TIMEKEEP' },
      { offsetTick: 480, voice: 'HH_PEDAL', velocity: 82, limb: 'LF', role: 'TIMEKEEP' },
      { offsetTick: 960, voice: 'HH_PEDAL', velocity: 86, limb: 'LF', role: 'TIMEKEEP' },
      { offsetTick: 1440, voice: 'HH_PEDAL', velocity: 90, limb: 'LF', role: 'TIMEKEEP' },
    ],
  },
  {
    id: 'FILL_4B_3OVER4_TOM_SYNC',
    label: '4拍 3対4ポリリズムタム',
    beats: 4,
    fillStartTick: 0,
    grid: 'straight',
    events: [
      { offsetTick: 0, voice: 'TOM_HI', velocity: 108, limb: 'RH' },
      { offsetTick: 120, voice: 'TOM_FLOOR', velocity: 102, limb: 'LH' },
      { offsetTick: 240, voice: 'KICK_MAIN', velocity: 110, limb: 'RF' },
      { offsetTick: 360, voice: 'TOM_HI', velocity: 108, limb: 'RH' },
      { offsetTick: 480, voice: 'TOM_FLOOR', velocity: 104, limb: 'LH' },
      { offsetTick: 600, voice: 'KICK_MAIN', velocity: 110, limb: 'RF' },
      { offsetTick: 720, voice: 'TOM_HI', velocity: 110, limb: 'RH' },
      { offsetTick: 840, voice: 'TOM_FLOOR', velocity: 106, limb: 'LH' },
      { offsetTick: 960, voice: 'KICK_MAIN', velocity: 112, limb: 'RF' },
      { offsetTick: 1080, voice: 'TOM_HI', velocity: 112, limb: 'RH' },
      { offsetTick: 1200, voice: 'TOM_MID', velocity: 108, limb: 'LH' },
      { offsetTick: 1320, voice: 'KICK_MAIN', velocity: 112, limb: 'RF' },
      { offsetTick: 1440, voice: 'SNARE_FLAM', velocity: 116, limb: 'RH' },
      { offsetTick: 1680, voice: 'TOM_FLOOR', velocity: 114, limb: 'RH' },
      { offsetTick: 1800, voice: 'SNARE_MAIN', velocity: 120, limb: 'LH' },
    ],
  },
  {
    id: 'FILL_4B_BREAK_KIME_ANISON',
    label: '4拍 ブレイク＆キメ（アニソン式）',
    beats: 4,
    fillStartTick: 0,
    grid: 'straight',
    isBreakKime: true,
    events: [
      { offsetTick: 0, voice: 'CRASH_L', velocity: 118, limb: 'RH', durationTicks: 420, role: 'CRASH_ACCENT' },
      { offsetTick: 0, voice: 'KICK_MAIN', velocity: 118, limb: 'RF', durationTicks: 140, role: 'KICK_CORE' },
      { offsetTick: 0, voice: 'SNARE_MAIN', velocity: 118, limb: 'LH', durationTicks: 140, role: 'SNARE_BACKBEAT' },
      // 480..1439: complete dead silence break
      { offsetTick: 1440, voice: 'SNARE_MAIN', velocity: 108, limb: 'RH' },
      { offsetTick: 1560, voice: 'TOM_HI', velocity: 104, limb: 'LH' },
      { offsetTick: 1680, voice: 'TOM_MID', velocity: 110, limb: 'RH' },
      { offsetTick: 1800, voice: 'TOM_FLOOR', velocity: 116, limb: 'LH' },
    ],
  },
];

export interface DrumGenerationResult {
  notes: MidiNote[];
  events: InternalDrumEvent[];
  stage4Events?: InternalDrumEvent[];
  selectedFillIds?: FillTemplateId[];
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
/** Pure deterministic 32-bit hash mixer for per-bar PRNG isolation. */
export function hash32(a: number, b: number, c: number, d: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) ^ (c >>> 0), 0xc2b2ae35) >>> 0;
  h = Math.imul((h ^ (h >>> 16)) ^ (d >>> 0), 0x27d4eb2d) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
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

function makeBarEvent(
  barIndex: number,
  localTick: number,
  voice: DrumVoice,
  velocity: number,
  limb: Limb,
  role: EventRole,
  durationTicks = 110,
  opts?: { fixedTiming?: boolean; fixedVelocity?: boolean; isAnchor?: boolean }
): InternalDrumEvent {
  const stepIndex = (Math.floor(localTick / STEP_TICKS) % 16) as StepIndex;
  return {
    tick: barIndex * BAR_TICKS + localTick,
    durationTicks,
    voice,
    velocity: clamp(Math.round(velocity), 1, 127),
    limb,
    role,
    barIndex,
    stepIndex,
    ...opts,
  };
}

function expandCustomSkeletonBar(
  patternId: BeatPatternId,
  take: KickTake,
  barIndex: number,
  bpm: number,
  sectionType: SectionType,
  energy: string,
  flavor: GenreFlavorProfile
): InternalDrumEvent[] {
  const out: InternalDrumEvent[] = [];
  const kVel = flavor.dynamics.kickBaseVel;
  const sVel = flavor.dynamics.snareBaseVel;
  const hhOn = flavor.dynamics.timekeepOnBeatVel;
  const hhOff = flavor.dynamics.timekeepOffBeatVel;
  const placeCrashBar0 = barIndex === 0 && (sectionType === 'Chorus' || energy === 'High');

  switch (patternId) {
    case 'ATAMA_UCHI': {
      const hhVoice: DrumVoice =
        sectionType === 'Chorus' || energy === 'High' ? 'HH_HALF_OPEN' : 'HH_CLOSED';
      const hhDur = hhVoice === 'HH_HALF_OPEN' ? 180 : 100;
      const quarterTicks = [0, 480, 960, 1440];
      for (const t of quarterTicks) {
        out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
        out.push(makeBarEvent(barIndex, t, hhVoice, hhOn, 'RH', 'TIMEKEEP', hhDur));
      }
      const kickTicks =
        take === 'A'
          ? [240, 720, 1200, 1680]
          : take === 'B'
            ? [1200, 1680]
            : [0, 240, 720, 1200, 1680];
      for (const t of kickTicks) {
        out.push(
          makeBarEvent(barIndex, t, 'KICK_MAIN', t === 0 ? kVel + 4 : kVel, 'RF', 'KICK_CORE', 120)
        );
      }
      break;
    }

    case 'SOCA': {
      for (const t of [0, 480, 960, 1440]) {
        out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
      }
      if (take === 'B') {
        const sideTicks = [360, 720, 1080, 1320, 1680];
        for (const t of sideTicks) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_SIDESTICK', 84, 'LH', 'SNARE_BACKBEAT', 100));
        }
        const sideSet = new Set(sideTicks);
        for (let step = 0; step < 16; step++) {
          const t = step * STEP_TICKS;
          if (sideSet.has(t)) continue;
          const limb: Limb = step % 2 === 0 ? 'RH' : 'LH';
          const vel = step % 4 === 0 ? hhOn : step % 2 === 0 ? hhOff : flavor.dynamics.timekeepSubVel;
          out.push(makeBarEvent(barIndex, t, 'HH_CLOSED', vel, limb, 'TIMEKEEP', 75));
        }
      } else {
        for (const t of [360, 720, 1320, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 110));
        }
        for (const t of [0, 480, 960, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'HH_CLOSED', hhOn, 'RH', 'TIMEKEEP', 90));
        }
        for (const t of [240, 720, 1200, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'HH_OPEN', 94, 'RH', 'TIMEKEEP', 190));
        }
        if (take === 'C') {
          out.push(makeBarEvent(barIndex, 1800, 'KICK_MAIN', kVel - 4, 'RF', 'KICK_CORE', 100));
          out.push(
            makeBarEvent(barIndex, 1080, 'SNARE_MAIN', 54, 'LH', 'ORNAMENT', 80, {
              fixedVelocity: true,
            })
          );
        }
      }
      break;
    }

    case 'SLIP_BEAT': {
      if (take === 'A') {
        for (const t of [0, 600, 960, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
        }
        for (const t of [480, 1200, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 115));
        }
        out.push(
          makeBarEvent(barIndex, 840, 'SNARE_MAIN', 42, 'LH', 'ORNAMENT', 80, {
            fixedVelocity: true,
          })
        );
        for (const t of [0, 240, 480, 720, 960, 1440]) {
          out.push(
            makeBarEvent(barIndex, t, 'HH_CLOSED', t % 480 === 0 ? hhOn : hhOff, 'RH', 'TIMEKEEP', 95)
          );
        }
        for (const t of [1200, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'HH_OPEN', 96, 'RH', 'TIMEKEEP', 190));
        }
      } else if (take === 'B') {
        for (const t of [0, 240, 720, 1200, 1560]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 115));
        }
        for (const t of [360, 1080, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 115));
        }
        out.push(
          makeBarEvent(barIndex, 600, 'SNARE_MAIN', 44, 'LH', 'ORNAMENT', 80, {
            fixedVelocity: true,
          })
        );
        out.push(
          makeBarEvent(barIndex, 1440, 'SNARE_MAIN', 46, 'LH', 'ORNAMENT', 80, {
            fixedVelocity: true,
          })
        );
        for (let t = 0; t < BAR_TICKS; t += 240) {
          out.push(
            makeBarEvent(barIndex, t, 'HH_CLOSED', t % 480 === 0 ? hhOn : hhOff, 'RH', 'TIMEKEEP', 95)
          );
        }
      } else {
        for (const t of [0, 480, 840, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 115));
        }
        for (const t of [240, 720, 1200, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 115));
        }
        for (let t = 0; t < BAR_TICKS; t += 240) {
          out.push(
            makeBarEvent(barIndex, t, 'RIDE_BOW', t % 480 === 0 ? hhOn : hhOff, 'RH', 'TIMEKEEP', 180)
          );
        }
      }
      break;
    }

    case 'SHUFFLE': {
      const kickTicks =
        take === 'A'
          ? [0, 800, 960]
          : take === 'B'
            ? [0, 320, 960, 1280, 1760]
            : [0, 320, 480, 800, 960, 1280, 1440, 1760];
      for (const t of kickTicks) {
        out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
      }
      for (const t of [480, 1440]) {
        out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
      }
      if (take === 'B') {
        for (const [idx, t] of [160, 640, 1120, 1600].entries()) {
          out.push(
            makeBarEvent(barIndex, t, 'SNARE_MAIN', idx % 2 === 0 ? 36 : 38, 'LH', 'ORNAMENT', 80, {
              fixedVelocity: true,
            })
          );
        }
      }
      if (take === 'C') {
        for (const t of [0, 480, 960, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'HH_OPEN', 94, 'RH', 'TIMEKEEP', 240));
        }
      } else {
        for (const t of [0, 480, 960, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'HH_CLOSED', 92, 'RH', 'TIMEKEEP', 110));
        }
        for (const t of [320, 800, 1280, 1760]) {
          out.push(makeBarEvent(barIndex, t, 'HH_CLOSED', 72, 'RH', 'TIMEKEEP', 95));
        }
      }
      break;
    }

    case 'HALF_TIME_SHUFFLE': {
      const kickTicks =
        take === 'A'
          ? [0, 800, 1760]
          : take === 'B'
            ? [0, 320, 800, 1760]
            : [0, 480, 800, 1120, 1600];
      for (const t of kickTicks) {
        out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
      }
      const accentVel = take === 'A' ? 116 : take === 'B' ? 118 : 120;
      out.push(
        makeBarEvent(barIndex, 960, 'SNARE_MAIN', accentVel, 'LH', 'SNARE_BACKBEAT', 120, {
          fixedVelocity: true,
        })
      );
      const ghostTicks = take === 'B' ? [640, 1600] : [160, 640, 1120, 1600];
      const ghostVel = take === 'B' ? 38 : 36;
      for (const t of ghostTicks) {
        out.push(
          makeBarEvent(barIndex, t, 'SNARE_MAIN', ghostVel, 'LH', 'ORNAMENT', 80, {
            fixedVelocity: true,
          })
        );
      }
      const openTick = take === 'A' ? 800 : take === 'B' ? 320 : 1760;
      const shuffleHatTicks = [0, 320, 480, 800, 960, 1280, 1440, 1760];
      for (const t of shuffleHatTicks) {
        if (t === openTick) {
          out.push(makeBarEvent(barIndex, t, 'HH_OPEN', 92, 'RH', 'TIMEKEEP', 150));
        } else {
          out.push(
            makeBarEvent(barIndex, t, 'HH_CLOSED', t % 480 === 0 ? 90 : 70, 'RH', 'TIMEKEEP', 95)
          );
        }
      }
      break;
    }

    case 'JUNGLE': {
      if (take === 'A') {
        for (const t of [0, 480, 960, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
        }
        for (let t = 0; t < BAR_TICKS; t += 240) {
          out.push(
            makeBarEvent(barIndex, t, 'TOM_FLOOR', t % 480 === 0 ? 92 : 74, 'RH', 'TIMEKEEP', 140)
          );
        }
        for (const t of [360, 1320]) {
          out.push(makeBarEvent(barIndex, t, 'TOM_HI', 96, 'LH', 'ORNAMENT', 110));
        }
        out.push(makeBarEvent(barIndex, 600, 'TOM_MID', 94, 'LH', 'ORNAMENT', 110));
        out.push(makeBarEvent(barIndex, 1440, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
        for (const t of [480, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 74, 'LF', 'TIMEKEEP', 90));
        }
      } else if (take === 'B') {
        for (const t of [0, 720, 960, 1560]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
        }
        for (let t = 0; t < BAR_TICKS; t += 240) {
          out.push(
            makeBarEvent(barIndex, t, 'TOM_FLOOR', t % 480 === 0 ? 92 : 74, 'RH', 'TIMEKEEP', 140)
          );
        }
        for (const t of [480, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
          out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 74, 'LF', 'TIMEKEEP', 90));
        }
        for (const t of [600, 1320]) {
          out.push(makeBarEvent(barIndex, t, 'TOM_HI', 94, 'LH', 'ORNAMENT', 110));
        }
        for (const t of [840, 1800]) {
          out.push(makeBarEvent(barIndex, t, 'TOM_MID', 96, 'LH', 'ORNAMENT', 110));
        }
      } else {
        for (let t = 120; t < BAR_TICKS; t += 240) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel - 6, 'RF', 'KICK_CORE', 100));
        }
        for (let t = 0; t < BAR_TICKS; t += 240) {
          out.push(
            makeBarEvent(barIndex, t, 'TOM_FLOOR', t % 480 === 0 ? 96 : 78, 'RH', 'TIMEKEEP', 120)
          );
        }
        for (const t of [480, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
        }
        out.push(makeBarEvent(barIndex, 1200, 'TOM_HI', 96, 'LH', 'ORNAMENT', 110));
        for (const t of [0, 480, 960, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 76, 'LF', 'TIMEKEEP', 90));
        }
      }
      break;
    }

    case 'TRAIN': {
      const kickTicks =
        take === 'A' ? [0, 960] : take === 'B' ? [0, 720, 960] : [0, 480, 960, 1440];
      for (const t of kickTicks) {
        out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 115));
      }
      const accentTicks =
        take === 'B' ? new Set([360, 480, 1320, 1440]) : new Set([480, 1440]);
      for (let step = 0; step < 16; step++) {
        const t = step * STEP_TICKS;
        const limb: Limb = step % 2 === 0 ? 'RH' : 'LH';
        if (accentTicks.has(t)) {
          const voice: DrumVoice = take === 'C' ? 'SNARE_RIMSHOT' : 'SNARE_MAIN';
          const vel = take === 'A' ? 112 : take === 'B' ? 110 : 120;
          out.push(
            makeBarEvent(barIndex, t, voice, vel, limb, 'SNARE_BACKBEAT', 105, {
              fixedVelocity: true,
            })
          );
        } else {
          const isEighth = step % 2 === 0;
          const ghostVel =
            take === 'C' ? (isEighth ? 58 : 44) : take === 'B' ? (isEighth ? 46 : 36) : isEighth ? 48 : 36;
          out.push(
            makeBarEvent(barIndex, t, 'SNARE_MAIN', ghostVel, limb, 'ORNAMENT', 75, {
              fixedVelocity: true,
            })
          );
        }
      }
      const pedalTicks =
        take === 'A'
          ? [480, 1440]
          : take === 'B'
            ? [240, 720, 1200, 1680]
            : [0, 480, 960, 1440];
      for (const t of pedalTicks) {
        out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 76, 'LF', 'TIMEKEEP', 90));
      }
      break;
    }

    case 'MARCH': {
      for (const t of [0, 480, 960, 1440]) {
        out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
      }
      if (placeCrashBar0 && take === 'C') {
        out.push(
          makeBarEvent(barIndex, 0, 'CRASH_L', Math.max(114, flavor.dynamics.crashVel), 'RH', 'CRASH_ACCENT', 480, {
            fixedTiming: true,
            fixedVelocity: true,
            isAnchor: true,
          })
        );
      }
      if (take === 'A') {
        for (const t of [0, 960]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_FLAM', 114, 'RH', 'SNARE_BACKBEAT', 110));
        }
        for (const t of [480, 720, 1200, 1440, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', 104, 'RH', 'SNARE_BACKBEAT', 100));
        }
        for (const t of [360, 840, 1320, 1800]) {
          out.push(
            makeBarEvent(barIndex, t, 'SNARE_MAIN', 44, 'LH', 'ORNAMENT', 75, {
              fixedVelocity: true,
            })
          );
        }
        for (const t of [480, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 76, 'LF', 'TIMEKEEP', 90));
        }
      } else if (take === 'B') {
        for (const t of [0, 360, 720, 1080, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', 106, 'RH', 'SNARE_BACKBEAT', 105));
        }
        for (const t of [120, 600, 840, 1320, 1560, 1800]) {
          out.push(
            makeBarEvent(barIndex, t, 'SNARE_MAIN', 44, 'LH', 'ORNAMENT', 75, {
              fixedVelocity: true,
            })
          );
        }
        for (const t of [480, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 76, 'LF', 'TIMEKEEP', 90));
        }
      } else {
        for (const t of [0, 480, 960, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_FLAM', 114, 'RH', 'SNARE_BACKBEAT', 110));
        }
        for (const t of [240, 720, 1200, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', 92, 'RH', 'ORNAMENT', 95));
        }
        for (const t of [120, 360, 600, 840, 1080, 1320, 1560, 1800]) {
          out.push(
            makeBarEvent(barIndex, t, 'SNARE_MAIN', 42, 'LH', 'ORNAMENT', 70, {
              fixedVelocity: true,
            })
          );
        }
        for (const t of [0, 480, 960, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 76, 'LF', 'TIMEKEEP', 90));
        }
      }
      break;
    }

    case 'PPPH': {
      const doubleTime = bpm >= 155;
      if (!doubleTime) {
        // 1-bar cycle (bpm < 155)
        if (take === 'A') {
          for (const t of [0, 720, 960]) {
            out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
            out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
            out.push(makeBarEvent(barIndex, t, 'HH_OPEN', 100, 'RH', 'TIMEKEEP', 220));
          }
          out.push(
            makeBarEvent(barIndex, 1440, 'HH_PEDAL', 82, 'LF', 'TIMEKEEP', 90, {
              fixedTiming: true,
            })
          );
        } else if (take === 'B') {
          for (const t of [0, 720, 960]) {
            out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
            out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
          }
          for (const t of [0, 480, 960, 1440]) {
            out.push(makeBarEvent(barIndex, t, 'HH_CLOSED', hhOn, 'RH', 'TIMEKEEP', 90));
          }
          for (const t of [240, 720, 1200, 1680]) {
            out.push(makeBarEvent(barIndex, t, 'HH_OPEN', 94, 'RH', 'TIMEKEEP', 190));
          }
        } else {
          for (const t of [0, 960]) {
            out.push(makeBarEvent(barIndex, t, 'CRASH_L', flavor.dynamics.crashVel, 'RH', 'CRASH_ACCENT', 360));
          }
          for (const t of [0, 720, 960]) {
            out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
            out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
          }
          out.push(makeBarEvent(barIndex, 1440, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
          out.push(makeBarEvent(barIndex, 1440, 'TOM_FLOOR', 110, 'RH', 'ORNAMENT', 120));
          out.push(makeBarEvent(barIndex, 1440, 'TOM_HI', 106, 'LH', 'ORNAMENT', 120));
          out.push(makeBarEvent(barIndex, 1680, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
          out.push(makeBarEvent(barIndex, 1680, 'TOM_FLOOR', 114, 'RH', 'ORNAMENT', 120));
          out.push(makeBarEvent(barIndex, 1680, 'TOM_MID', 110, 'LH', 'ORNAMENT', 120));
        }
      } else {
        // 2-bar cycle double-time (bpm >= 155)
        const isSecondBar = barIndex % 2 === 1;
        if (take === 'A') {
          if (!isSecondBar) {
            for (const t of [0, 1440]) {
              out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
              out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
              out.push(makeBarEvent(barIndex, t, 'HH_OPEN', 100, 'RH', 'TIMEKEEP', 240));
            }
            for (const t of [480, 960]) {
              out.push(
                makeBarEvent(barIndex, t, 'HH_PEDAL', 78, 'LF', 'TIMEKEEP', 90, {
                  fixedTiming: true,
                })
              );
            }
          } else {
            out.push(makeBarEvent(barIndex, 0, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
            out.push(makeBarEvent(barIndex, 0, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
            out.push(makeBarEvent(barIndex, 0, 'HH_OPEN', 100, 'RH', 'TIMEKEEP', 240));
            out.push(
              makeBarEvent(barIndex, 480, 'HH_PEDAL', 84, 'LF', 'TIMEKEEP', 90, {
                fixedTiming: true,
              })
            );
          }
        } else if (take === 'B') {
          const hitTicks = isSecondBar ? [0] : [0, 1440];
          for (const t of hitTicks) {
            out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
            out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
          }
          for (const t of [0, 480, 960, 1440]) {
            out.push(makeBarEvent(barIndex, t, 'HH_CLOSED', hhOn, 'RH', 'TIMEKEEP', 90));
          }
          for (const t of [240, 720, 1200, 1680]) {
            out.push(makeBarEvent(barIndex, t, 'HH_OPEN', 94, 'RH', 'TIMEKEEP', 190));
          }
        } else {
          if (!isSecondBar) {
            for (const t of [0, 1440]) {
              out.push(makeBarEvent(barIndex, t, 'CRASH_L', flavor.dynamics.crashVel, 'RH', 'CRASH_ACCENT', 360));
              out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
              out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
            }
            for (const t of [480, 960]) {
              out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel - 4, 'RF', 'KICK_CORE', 120));
            }
          } else {
            out.push(makeBarEvent(barIndex, 0, 'CRASH_L', flavor.dynamics.crashVel, 'RH', 'CRASH_ACCENT', 360));
            out.push(makeBarEvent(barIndex, 0, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
            out.push(makeBarEvent(barIndex, 0, 'SNARE_MAIN', sVel, 'LH', 'SNARE_BACKBEAT', 120));
            for (const t of [960, 1440]) {
              out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 120));
              out.push(makeBarEvent(barIndex, t, 'TOM_FLOOR', 112, 'RH', 'ORNAMENT', 120));
              out.push(makeBarEvent(barIndex, t, 'TOM_MID', 108, 'LH', 'ORNAMENT', 120));
            }
          }
        }
      }
      break;
    }

    case 'FOUR_BEAT': {
      // Triplet ride legato (0, 480, 800, 960, 1440, 1760) + 2/4 HHP
      const ridePattern: Array<{ t: number; vel: number; voice?: DrumVoice }> = [
        { t: 0, vel: 94 },
        { t: 480, vel: 92 },
        { t: 800, vel: 70 },
        { t: 960, vel: 94, voice: take === 'C' ? 'RIDE_BELL' : 'RIDE_BOW' },
        { t: 1440, vel: 92 },
        { t: 1760, vel: 70 },
      ];
      for (const r of ridePattern) {
        out.push(makeBarEvent(barIndex, r.t, r.voice ?? 'RIDE_BOW', r.vel, 'RH', 'TIMEKEEP', 150));
      }
      for (const t of [480, 1440]) {
        out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 76, 'LF', 'TIMEKEEP', 90));
      }
      if (take === 'A') {
        for (const t of [0, 480, 960, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', 52, 'RF', 'KICK_CORE', 120));
        }
        out.push(makeBarEvent(barIndex, 800, 'SNARE_MAIN', 64, 'LH', 'ORNAMENT', 95));
        out.push(makeBarEvent(barIndex, 1600, 'SNARE_MAIN', 58, 'LH', 'ORNAMENT', 95));
      } else if (take === 'B') {
        for (const t of [0, 960]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', 56, 'RF', 'KICK_CORE', 120));
        }
        out.push(makeBarEvent(barIndex, 320, 'SNARE_MAIN', 68, 'LH', 'ORNAMENT', 95));
        out.push(makeBarEvent(barIndex, 1120, 'SNARE_MAIN', 62, 'LH', 'ORNAMENT', 95));
        out.push(makeBarEvent(barIndex, 1760, 'SNARE_MAIN', 72, 'LH', 'ORNAMENT', 95));
      } else {
        for (const t of [0, 800, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', 68, 'RF', 'KICK_CORE', 120));
        }
        out.push(makeBarEvent(barIndex, 480, 'SNARE_MAIN', 74, 'LH', 'ORNAMENT', 100));
        out.push(makeBarEvent(barIndex, 1280, 'SNARE_MAIN', 70, 'LH', 'ORNAMENT', 100));
      }
      break;
    }

    case 'SAMBA': {
      // Surdo kick + 8th-offbeat HHP
      const surdoTicks = [0, 360, 480, 840, 960, 1320, 1440, 1800];
      for (const t of surdoTicks) {
        const isDown = t % 480 === 0;
        const vel = take === 'B' ? (isDown ? 82 : 64) : isDown ? 106 : 84;
        out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', vel, 'RF', 'KICK_CORE', 110));
      }
      for (const t of [240, 720, 1200, 1680]) {
        out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 74, 'LF', 'TIMEKEEP', 90));
      }
      if (take === 'B') {
        // Bossa Nova
        for (let t = 0; t < BAR_TICKS; t += 240) {
          out.push(
            makeBarEvent(barIndex, t, 'HH_CLOSED', t % 480 === 0 ? 78 : 62, 'RH', 'TIMEKEEP', 90)
          );
        }
        for (const t of [0, 360, 720, 1200, 1560]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_SIDESTICK', 80, 'LH', 'SNARE_BACKBEAT', 100));
        }
      } else if (take === 'C') {
        for (let t = 0; t < BAR_TICKS; t += 240) {
          out.push(
            makeBarEvent(barIndex, t, 'RIDE_BELL', t % 480 === 0 ? 96 : 76, 'RH', 'TIMEKEEP', 150)
          );
        }
        for (const t of [360, 840, 1320, 1800]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', 96, 'LH', 'SNARE_BACKBEAT', 100));
        }
      } else {
        const rideStep = bpm > 142 ? 240 : 120;
        for (let t = 0; t < BAR_TICKS; t += rideStep) {
          out.push(
            makeBarEvent(
              barIndex,
              t,
              'RIDE_BOW',
              t % 480 === 0 ? 90 : t % 240 === 0 ? 74 : 58,
              'RH',
              'TIMEKEEP',
              rideStep === 120 ? 80 : 140
            )
          );
        }
        for (const t of [0, 360, 720, 1200, 1560]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_SIDESTICK', 84, 'LH', 'SNARE_BACKBEAT', 100));
        }
      }
      break;
    }

    case 'SONGO': {
      if (take === 'A') {
        for (const t of [360, 720, 1320, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 115));
        }
        out.push(makeBarEvent(barIndex, 480, 'SNARE_MAIN', 108, 'LH', 'SNARE_BACKBEAT', 110));
        out.push(makeBarEvent(barIndex, 840, 'SNARE_MAIN', 68, 'LH', 'ORNAMENT', 90));
        out.push(makeBarEvent(barIndex, 1200, 'SNARE_MAIN', 106, 'LH', 'SNARE_BACKBEAT', 110));
        out.push(makeBarEvent(barIndex, 1560, 'SNARE_MAIN', 68, 'LH', 'ORNAMENT', 90));
        for (const t of [0, 240, 600, 960, 1080, 1440, 1800]) {
          out.push(makeBarEvent(barIndex, t, 'HH_CLOSED', t % 480 === 0 ? hhOn : hhOff, 'RH', 'TIMEKEEP', 90));
        }
        for (const t of [0, 960]) {
          out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 74, 'LF', 'TIMEKEEP', 90));
        }
      } else if (take === 'B') {
        for (const t of [360, 720, 1320, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 115));
        }
        for (const t of [480, 1200]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', 106, 'LH', 'SNARE_BACKBEAT', 110));
        }
        for (const t of [120, 840, 1560]) {
          out.push(
            makeBarEvent(barIndex, t, 'SNARE_MAIN', 48, 'LH', 'ORNAMENT', 80, {
              fixedVelocity: true,
            })
          );
        }
        for (const t of [0, 240, 360, 600, 960, 1080, 1320, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'RIDE_BOW', t % 480 === 0 ? 94 : 76, 'RH', 'TIMEKEEP', 130));
        }
      } else {
        // Mozambique bell
        for (const t of [0, 360, 720, 1320, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'KICK_MAIN', kVel, 'RF', 'KICK_CORE', 115));
        }
        for (const t of [0, 240, 480, 600, 840, 1080, 1200, 1440, 1680]) {
          out.push(makeBarEvent(barIndex, t, 'RIDE_BELL', t % 480 === 0 ? 100 : 82, 'RH', 'TIMEKEEP', 120));
        }
        for (const t of [480, 1200]) {
          out.push(makeBarEvent(barIndex, t, 'SNARE_MAIN', 106, 'LH', 'SNARE_BACKBEAT', 110));
        }
        for (const t of [960, 1560]) {
          out.push(makeBarEvent(barIndex, t, 'TOM_FLOOR', 98, 'LH', 'ORNAMENT', 110));
        }
        for (const t of [0, 480, 960, 1440]) {
          out.push(makeBarEvent(barIndex, t, 'HH_PEDAL', 76, 'LF', 'TIMEKEEP', 90));
        }
      }
      break;
    }

    default:
      break;
  }

  return out;
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
    // 2A-2. Extended 12 Custom Skeletons (480 TPQN exact tick placement)
    // -----------------------------------------------------------------------
    if (template.customSkeleton) {
      const barEvents = expandCustomSkeletonBar(
        lock.patternId,
        lock.kickTake,
        barIndex,
        bpm,
        section.type,
        section.energy,
        flavor
      );
      events.push(...barEvents);
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
// Stage 4: 10-Template Context Fill Pipeline, Pre-Fill Groove Masking & Breaks
// ===========================================================================
export function selectFillTemplate(options: {
  beats: 1 | 2 | 4;
  patternId: BeatPatternId;
  bpm: number;
  breakEnabled: boolean;
  lastFillId: FillTemplateId | null;
  rng: () => number;
}): FillTemplate {
  const { beats, patternId, bpm, breakEnabled, lastFillId, rng } = options;
  const tripletMode = isTripletSkeleton(patternId);

  const scoreCandidates = (list: readonly FillTemplate[]) => {
    const scored: Array<{ tpl: FillTemplate; weight: number }> = [];
    for (const tpl of list) {
      if (tpl.maxSafeBpm !== undefined && bpm > tpl.maxSafeBpm) continue;
      if (tpl.isBreakKime && !breakEnabled) continue;

      let weight = 1.0;
      if (tripletMode) {
        if (tpl.grid === 'triplet') {
          weight *= 3.0;
        } else if (bpm > 130) {
          continue; // Suppress straight 16th fills on triplet skeletons when bpm > 130
        } else {
          weight *= 0.4;
        }
      } else if (tpl.grid === 'triplet') {
        weight *= 0.35;
      }

      if (breakEnabled && tpl.isBreakKime) {
        weight *= 6.0;
      }

      if (lastFillId && tpl.id === lastFillId) {
        weight *= 0.15;
      }

      if (weight > 0) {
        scored.push({ tpl, weight });
      }
    }
    return scored;
  };

  let candidates = scoreCandidates(FILL_TEMPLATES.filter((t) => t.beats === beats));
  if (candidates.length === 0) {
    // Fallback: e.g. triplet skeleton at bpm > 155 where 2-beat 6-tuplet is excluded -> 1-beat triplet
    candidates = scoreCandidates(FILL_TEMPLATES.filter((t) => t.grid === (tripletMode ? 'triplet' : 'straight')));
  }
  if (candidates.length === 0) {
    return FILL_TEMPLATES[0];
  }

  const totalWeight = candidates.reduce((acc, c) => acc + c.weight, 0);
  let target = rng() * totalWeight;
  for (const c of candidates) {
    target -= c.weight;
    if (target <= 0) return c.tpl;
  }
  return candidates[candidates.length - 1].tpl;
}

function applyPreFillGrooveMaskAndRender(
  events: InternalDrumEvent[],
  barIndex: number,
  tpl: FillTemplate,
  lockLeftFootForDoubleBass: boolean
): InternalDrumEvent[] {
  const barStart = barIndex * BAR_TICKS;
  const fillStartAbs = barStart + tpl.fillStartTick;

  // Check if HH_OPEN / HH_HALF_OPEN was the last hi-hat hit before fillStartTick in this bar
  let lastHatBeforeFill: InternalDrumEvent | null = null;
  for (const ev of events) {
    if (ev.barIndex !== barIndex || ev.tick >= fillStartAbs) continue;
    if (isHiHatOpenVoice(ev.voice) || isHiHatClosedOrPedalVoice(ev.voice)) {
      if (!lastHatBeforeFill || ev.tick >= lastHatBeforeFill.tick) {
        lastHatBeforeFill = ev;
      }
    }
  }

  // Mask all skeleton events at or after fillStartTick in this bar
  const out = events.filter(
    (e) => !(e.barIndex === barIndex && e.tick >= fillStartAbs)
  );

  // Auto-insert HH_PEDAL choke at fillStartTick if open hat was ringing
  if (
    tpl.fillStartTick > 0 &&
    !lockLeftFootForDoubleBass &&
    lastHatBeforeFill &&
    isHiHatOpenVoice(lastHatBeforeFill.voice)
  ) {
    out.push({
      tick: fillStartAbs,
      durationTicks: 85,
      voice: 'HH_PEDAL',
      velocity: 80,
      limb: 'LF',
      role: 'TIMEKEEP',
      barIndex,
      stepIndex: (Math.floor(tpl.fillStartTick / STEP_TICKS) % 16) as StepIndex,
      fixedTiming: true,
    });
  }

  // Render template events
  for (const spec of tpl.events) {
    out.push({
      tick: barStart + spec.offsetTick,
      durationTicks: spec.durationTicks ?? 105,
      voice: spec.voice,
      velocity: spec.velocity,
      limb: spec.limb,
      role: spec.role ?? 'FILL_EVENT',
      barIndex,
      stepIndex: (Math.floor(spec.offsetTick / STEP_TICKS) % 16) as StepIndex,
    });
  }

  return out;
}

function applyFillsAndBreaks(
  input: EngineInput,
  lock: SectionSkeletonLock,
  events: InternalDrumEvent[],
  _rng: () => number
): { events: InternalDrumEvent[]; selectedFillIds: FillTemplateId[] } {
  const { song, section, style, seed, sectionIndex } = input;
  const bpm = input.bpm ?? song.bpm;
  const totalBars = Math.max(1, section.bars);
  const flavor = GENRE_FLAVOR_PROFILES[lock.genreId];
  const lockLeftFoot = lock.patternId === 'DOUBLE_BASS';

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
    return { events, selectedFillIds: [] };
  }

  let out = [...events];
  const selectedFillIds: FillTemplateId[] = [];
  let lastFillId: FillTemplateId | null = null;
  const lastBarIndex = totalBars - 1;

  // 1. Internal 4-bar boundaries (barIndex % 4 === 3 && barIndex < lastBarIndex)
  if (effectiveFillEnabled) {
    for (let b = 3; b < lastBarIndex; b += 4) {
      const barStart = b * BAR_TICKS;
      const barSeed = hash32(seed, sectionIndex, b, 0xf111);
      const barRng = mulberry32(barSeed);
      const roll = barRng();

      if (roll < 0.7) {
        // 70%: subtle non-destructive turnaround (preserves skeleton!)
        if (lock.patternId === 'DOUBLE_BASS') {
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
        } else if (isTripletSkeleton(lock.patternId)) {
          // Triplet-safe turnaround on 1760 (last 8th triplet)
          out.push({
            tick: barStart + 1760,
            durationTicks: 100,
            voice: 'SNARE_MAIN',
            velocity: clamp(flavor.dynamics.snareBaseVel - 10, 72, 118),
            limb: 'LH',
            role: 'FILL_EVENT',
            barIndex: b,
            stepIndex: 14,
          });
        } else if (roll < 0.25) {
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
        } else if (roll < 0.5 && bpm <= 165) {
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
        // 30%: 1-beat turnaround fill from 10-template library + crash landing on next bar Step 0
        const tpl = selectFillTemplate({
          beats: 1,
          patternId: lock.patternId,
          bpm,
          breakEnabled: false,
          lastFillId,
          rng: barRng,
        });
        out = applyPreFillGrooveMaskAndRender(out, b, tpl, lockLeftFoot);
        selectedFillIds.push(tpl.id);
        lastFillId = tpl.id;

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
  const lastBarSeed = hash32(seed, sectionIndex, lastBarIndex, 0xf111);
  const lastBarRng = mulberry32(lastBarSeed);

  if (effectiveFillEnabled && !breakEnabled) {
    const wants4Beat =
      totalBars >= 8 &&
      (section.type === 'Pre-Chorus' || section.energy === 'High') &&
      !isTripletSkeleton(lock.patternId) &&
      lastBarRng() < 0.4;
    const tpl = selectFillTemplate({
      beats: wants4Beat ? 4 : 2,
      patternId: lock.patternId,
      bpm,
      breakEnabled: false,
      lastFillId,
      rng: lastBarRng,
    });
    out = applyPreFillGrooveMaskAndRender(out, lastBarIndex, tpl, lockLeftFoot);
    selectedFillIds.push(tpl.id);
    lastFillId = tpl.id;
  } else if (effectiveFillEnabled && breakEnabled) {
    if (totalBars >= 8) {
      // 8+ bar section with break enabled: prioritize FILL_4B_BREAK_KIME_ANISON
      const tpl = selectFillTemplate({
        beats: 4,
        patternId: lock.patternId,
        bpm,
        breakEnabled: true,
        lastFillId,
        rng: lastBarRng,
      });
      out = applyPreFillGrooveMaskAndRender(out, lastBarIndex, tpl, lockLeftFoot);
      selectedFillIds.push(tpl.id);
      lastFillId = tpl.id;
    } else {
      // 4-bar Fill + Break combo (backwards-compatible with drumEngine.test.ts):
      // compact tom fill on beats 2-3 (Steps 4..11), dead silence on beat 4 (Steps 12..15)
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
    }
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

  return { events: out, selectedFillIds };
}

// ===========================================================================
// Biomechanical Speed Guard (runs on pure integer grid BEFORE Stage 4 Solver)
// ===========================================================================
export function applyBiomechanicalGuard(
  events: InternalDrumEvent[],
  patternId: BeatPatternId,
  bpm: number
): InternalDrumEvent[] {
  let out = events.map((e) => ({ ...e }));

  // 1. One-handed 16th guard (bpm > 142): switch continuous RH 16th timekeep to alternating R-L-R-L
  if (bpm > 142) {
    const snareTicks = new Set(
      out
        .filter((e) => e.role === 'SNARE_BACKBEAT' && e.limb === 'LH')
        .map((e) => e.tick)
    );
    const rhTimekeep = out
      .filter((e) => e.role === 'TIMEKEEP' && e.limb === 'RH' && !e.fixedTiming)
      .sort((a, b) => a.tick - b.tick);
    const fastRhTicks = new Set<number>();
    let run = 1;
    for (let i = 1; i < rhTimekeep.length; i++) {
      if (rhTimekeep[i].tick - rhTimekeep[i - 1].tick === STEP_TICKS) {
        run++;
        if (run >= 4) {
          fastRhTicks.add(rhTimekeep[i].tick);
          fastRhTicks.add(rhTimekeep[i - 1].tick);
          fastRhTicks.add(rhTimekeep[i - 2].tick);
          fastRhTicks.add(rhTimekeep[i - 3].tick);
        }
      } else {
        run = 1;
      }
    }
    if (fastRhTicks.size > 0) {
      out = out
        .map((e) => {
          if (e.role === 'TIMEKEEP' && e.limb === 'RH' && fastRhTicks.has(e.tick)) {
            const isOddStep = e.stepIndex % 2 === 1;
            if (isOddStep) {
              return { ...e, limb: 'LH' as Limb };
            }
          }
          return e;
        })
        .filter(
          (e) =>
            !(
              e.role === 'TIMEKEEP' &&
              e.limb === 'LH' &&
              fastRhTicks.has(e.tick) &&
              snareTicks.has(e.tick)
            )
        );
    }
  }

  // 2. 32nd-note snare roll guard (bpm > 120): collapse 60t snare runs into SNARE_ROLL
  if (bpm > 120) {
    const snareIndices = out
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => e.voice === 'SNARE_MAIN' && !e.fixedTiming)
      .sort((a, b) => a.e.tick - b.e.tick);
    const toRemove = new Set<number>();
    const toRoll = new Set<number>();
    let i = 0;
    while (i < snareIndices.length) {
      let j = i;
      while (
        j + 1 < snareIndices.length &&
        snareIndices[j + 1].e.tick - snareIndices[j].e.tick <= 65 &&
        snareIndices[j + 1].e.tick - snareIndices[j].e.tick > 0
      ) {
        j++;
      }
      if (j - i >= 2) {
        toRoll.add(snareIndices[i].idx);
        for (let k = i + 1; k <= j; k++) {
          toRemove.add(snareIndices[k].idx);
        }
      }
      i = j + 1;
    }
    if (toRoll.size > 0) {
      out = out
        .map((e, idx) =>
          toRoll.has(idx)
            ? {
                ...e,
                voice: 'SNARE_ROLL' as DrumVoice,
                limb: 'RH' as Limb,
                durationTicks: 180,
              }
            : e
        )
        .filter((_, idx) => !toRemove.has(idx));
    }
  }

  // 3. Single-pedal 3+ consecutive 16th kicks guard (outside DOUBLE_BASS)
  //    Active when bpm > 165 or 16th IOI < 95ms
  const sixteenthMs = 15000 / Math.max(1, bpm);
  if (patternId !== 'DOUBLE_BASS' && (bpm > 165 || sixteenthMs < 95)) {
    const kickEntries = out
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => isKickVoice(e.voice) && !e.isAnchor)
      .sort((a, b) => a.e.tick - b.e.tick);

    const rhOccupiedTicks = new Set(
      out.filter((e) => e.limb === 'RH').map((e) => e.tick)
    );
    const replaced = new Set<number>();

    for (let i = 0; i + 2 < kickEntries.length; i++) {
      if (replaced.has(kickEntries[i].idx) || replaced.has(kickEntries[i + 1].idx)) {
        continue;
      }
      const k0 = kickEntries[i];
      const k1 = kickEntries[i + 1];
      const k2 = kickEntries[i + 2];
      const d1 = k1.e.tick - k0.e.tick;
      const d2 = k2.e.tick - k1.e.tick;
      if (d1 > 0 && d1 <= 130 && d2 > 0 && d2 <= 130) {
        // Prefer replacing 1800:K (before next bar 0:K), else replace tail k2
        const target =
          k1.e.tick % BAR_TICKS === 1800 ? k1 : k2;
        const useSnare = rhOccupiedTicks.has(target.e.tick);
        out[target.idx] = {
          ...target.e,
          voice: useSnare ? 'SNARE_MAIN' : 'TOM_FLOOR',
          limb: useSnare ? 'LH' : 'RH',
          role: 'FILL_EVENT',
        };
        replaced.add(target.idx);
      }
    }
  }

  return out;
}

// ===========================================================================
// Stage 4 Solver v2: Priority-Based 4-Limb + Flam 2-Hand + Hi-Hat Continuity
// (Always executed on pure integer grid BEFORE Stage 5 expansion/microtiming)
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

function compareEventPriority(a: InternalDrumEvent, b: InternalDrumEvent): number {
  if (Boolean(a.isAnchor) !== Boolean(b.isAnchor)) {
    return a.isAnchor ? -1 : 1;
  }
  const pd = ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
  if (pd !== 0) return pd;
  return b.velocity - a.velocity;
}

export function resolveLimbConflicts(
  events: InternalDrumEvent[],
  lockLeftFootForDoubleBass: boolean
): InternalDrumEvent[] {
  // 1. Group by exact integer tick to enforce strict simultaneous 4-limb & flam 2-hand occupancy
  const byTick = new Map<number, InternalDrumEvent[]>();
  for (const ev of events) {
    if (lockLeftFootForDoubleBass && ev.voice === 'HH_PEDAL') continue;
    const bucket = byTick.get(ev.tick) ?? [];
    bucket.push(ev);
    byTick.set(ev.tick, bucket);
  }

  const tickResolved: InternalDrumEvent[] = [];
  for (const bucket of byTick.values()) {
    const rf: InternalDrumEvent[] = [];
    const lf: InternalDrumEvent[] = [];
    const upper: InternalDrumEvent[] = [];

    for (const ev of bucket) {
      if (ev.limb === 'RF') rf.push(ev);
      else if (ev.limb === 'LF') lf.push(ev);
      else upper.push(ev);
    }

    if (rf.length > 0) {
      rf.sort(compareEventPriority);
      tickResolved.push(rf[0]);
    }
    if (lf.length > 0) {
      lf.sort(compareEventPriority);
      tickResolved.push(lf[0]);
    }

    if (upper.length > 0) {
      const flams = upper.filter((e) => e.voice === 'SNARE_FLAM');
      const nonFlams = upper.filter((e) => e.voice !== 'SNARE_FLAM');
      const anchorCrash = nonFlams.find(
        (e) => e.role === 'CRASH_ACCENT' && (e.isAnchor || e.voice === 'CRASH_L')
      );

      if (flams.length > 0 && anchorCrash) {
        // Crash + Flam collision on downbeat: downgrade SNARE_FLAM to single-hand SNARE_MAIN (LH)
        flams.sort(compareEventPriority);
        tickResolved.push(anchorCrash);
        tickResolved.push({
          ...flams[0],
          voice: 'SNARE_MAIN',
          limb: 'LH',
        });
      } else if (flams.length > 0) {
        // SNARE_FLAM occupies BOTH upper limbs (2 slots)
        flams.sort(compareEventPriority);
        tickResolved.push(flams[0]);
      } else {
        const rh = nonFlams.filter((e) => e.limb === 'RH').sort(compareEventPriority);
        const lh = nonFlams.filter((e) => e.limb === 'LH').sort(compareEventPriority);
        if (rh.length > 0) tickResolved.push(rh[0]);
        if (lh.length > 0) tickResolved.push(lh[0]);
      }
    }
  }

  // 2. Hi-hat simultaneous state continuity on exact tick:
  //    Never allow HH_OPEN / HH_HALF_OPEN together with HH_CLOSED / HH_PEDAL on same tick
  const openTickSet = new Set<number>();
  const fixedChokeTickSet = new Set<number>();
  for (const ev of tickResolved) {
    if (isHiHatOpenVoice(ev.voice)) openTickSet.add(ev.tick);
    if (isHiHatClosedOrPedalVoice(ev.voice) && ev.fixedTiming) {
      fixedChokeTickSet.add(ev.tick);
    }
  }
  const hatClean = tickResolved.filter((ev) => {
    if (isHiHatOpenVoice(ev.voice) && fixedChokeTickSet.has(ev.tick)) {
      return false;
    }
    if (isHiHatClosedOrPedalVoice(ev.voice) && !ev.fixedTiming && openTickSet.has(ev.tick)) {
      return false;
    }
    return true;
  });

  // 3. Ensure (barIndex, stepIndex, limb) uniqueness for standard 16th-aligned events
  const stepLimbMap = new Map<string, InternalDrumEvent>();
  const subStepExtras: InternalDrumEvent[] = [];
  for (const ev of hatClean) {
    if (ev.fixedTiming && ev.tick % STEP_TICKS !== 0) {
      subStepExtras.push(ev);
      continue;
    }
    const key = `${ev.barIndex}:${ev.stepIndex}:${ev.limb}`;
    const existing = stepLimbMap.get(key);
    if (!existing || compareEventPriority(ev, existing) < 0) {
      stepLimbMap.set(key, ev);
    }
  }

  return [...subStepExtras, ...stepLimbMap.values()].sort((a, b) => a.tick - b.tick);
}

// ===========================================================================
// Stage 5: Flam Grace Expansion, Genre Flavor, Swing, Microtiming & Physics
// ===========================================================================
export function expandFlamsAndRollsStage5(
  events: InternalDrumEvent[],
  bpm: number,
  midiMapMode: MidiMapMode
): InternalDrumEvent[] {
  const flamOffset = Math.max(8, msToTicks(25, bpm));
  const out: InternalDrumEvent[] = [];

  for (const ev of events) {
    if (ev.voice === 'SNARE_FLAM') {
      const graceVel = clamp(Math.round(ev.velocity * 0.58), 24, 96);
      if (ev.tick > 0) {
        out.push({
          ...ev,
          tick: Math.max(0, ev.tick - flamOffset),
          durationTicks: 40,
          voice: 'SNARE_MAIN',
          velocity: graceVel,
          limb: 'LH',
          fixedTiming: true,
          fixedVelocity: true,
        });
        out.push({
          ...ev,
          voice: 'SNARE_MAIN',
          limb: 'RH',
        });
      } else {
        out.push({
          ...ev,
          tick: 0,
          durationTicks: 40,
          voice: 'SNARE_MAIN',
          velocity: graceVel,
          limb: 'LH',
          fixedTiming: true,
          fixedVelocity: true,
        });
        out.push({
          ...ev,
          tick: flamOffset,
          voice: 'SNARE_MAIN',
          limb: 'RH',
          fixedTiming: true,
        });
      }
      continue;
    }

    if (ev.voice === 'SNARE_ROLL' && midiMapMode === 'GM_STANDARD') {
      // GM fallback for 32nd-note roll > 120 BPM: drag/flam approximation on Note 38
      const graceVel = clamp(Math.round(ev.velocity * 0.58), 24, 96);
      out.push({
        ...ev,
        tick: Math.max(0, ev.tick - flamOffset),
        durationTicks: 40,
        voice: 'SNARE_MAIN',
        velocity: graceVel,
        limb: 'LH',
        fixedTiming: true,
        fixedVelocity: true,
      });
      out.push({
        ...ev,
        voice: 'SNARE_MAIN',
        limb: 'RH',
      });
      continue;
    }

    out.push(ev);
  }

  return out;
}
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

  // Stage 3.5: 10-Template Context Fill Pipeline & Breaks + Biomechanical Guard
  const fillRes = applyFillsAndBreaks(input, skeleton, stage3, rng);
  const bioGuarded = applyBiomechanicalGuard(
    fillRes.events,
    skeleton.patternId,
    bpm
  );

  // Stage 4: Priority-Based 4-Limb + Flam 2-Hand + Hi-Hat Solver v2 (Pure Integer Grid)
  const lockLeftFoot = skeleton.patternId === 'DOUBLE_BASS';
  const stage4Events = resolveLimbConflicts(bioGuarded, lockLeftFoot);

  // Stage 5: Flam Grace Expansion, Genre Flavor, Swing, Microtiming, Double-Bass Physics & MIDI Map
  const template = BEAT_TEMPLATES[skeleton.patternId];
  const flavor = GENRE_FLAVOR_PROFILES[skeleton.genreId];
  const stage5Expanded = expandFlamsAndRollsStage5(stage4Events, bpm, midiMapMode);
  const stage5Flavored = applyGenreFlavor(stage5Expanded, template, flavor, bpm, rng);
  const finalEvents = enforceFinalInvariants(
    stage5Flavored,
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
    stage4Events,
    selectedFillIds: fillRes.selectedFillIds,
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
