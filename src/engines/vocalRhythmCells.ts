import type { MelodyStyleProfileId } from './vocalEngine';

export type PhraseRole = 'statement' | 'antecedent' | 'variation' | 'consequent';

export interface SyllableSlot {
  /** Relative tick from start of 2-bar (3840) or 1-bar (1920) cell */
  offsetTick: number;
  /** Base duration (ticks) before legato / breath post-processing */
  baseDuration: number;
  /** Metrical / linguistic stress: 0=weak/passing, 1=medium, 2=strong/hook */
  stress: 0 | 1 | 2;
  /** When true, looks ahead +240 ticks to anticipate the upcoming chord */
  isAnticipation?: boolean;
  /** Candidate point for an intentional expressive leap */
  leapSlot?: boolean;
}

export interface RhythmCell {
  id: string;
  /** Cell length: 1 bar (1920) or 2 bars (3840) */
  lengthTicks: 1920 | 3840;
  genres: MelodyStyleProfileId[];
  densityRange: [number, number];
  /** True if cell contains 16th-note (120-tick) spacing; filtered when BPM > 120 */
  hasSixteenths: boolean;
  /** Standard trailing breath rest (ticks) reserved at cell end */
  trailingBreathTicks: number;
  slots: SyllableSlot[];
}

export interface PhrasePlan {
  phraseId: number;
  startTick: number;
  endTick: number;
  /** No new note onset allowed at or after singEndTick */
  singEndTick: number;
  role: PhraseRole;
  peakOffsetSemitones: number;
  peakPositionRatio: number;
  motifSourcePhraseId?: number;
}

export interface GenreVocalGrammar {
  /** 0.0=tonic/pentatonic MHD axis .. 1.0=strict local chord coupling */
  harmonicCouplingVerse: number;
  harmonicCouplingChorus: number;
  /** Target rest ratio [min, max] across the section */
  targetRestRatio: [number, number];
  /** Unison repetition preference (-1.0..+2.0) and max consecutive cap */
  unisonWeight: number;
  maxConsecutiveUnisons: number;
  /** Signature leap interval range in semitones [min, max] and probability */
  signatureLeapRange: [number, number];
  signatureLeapChance: number;
  /** Tone preference weights on strong beats / landings */
  toneWeights: {
    root: number;
    third: number;
    fifth: number;
    seventh: number;
    ninth: number;
    eleventh: number;
    pentatonic: number;
  };
  /** 0.0=floating tension tail .. 1.0=decisive Root/3rd cadence */
  cadenceResolutionStrength: number;
  archShape: 'flat_low' | 'classic_arch' | 'late_climb' | 'soar_drop' | 'tight_burst';
}

export const GENRE_VOCAL_GRAMMARS: Record<MelodyStyleProfileId, GenreVocalGrammar> = {
  alt_hypnotic: {
    harmonicCouplingVerse: 0.35,
    harmonicCouplingChorus: 0.7,
    targetRestRatio: [0.25, 0.38],
    unisonWeight: 1.0,
    maxConsecutiveUnisons: 4,
    signatureLeapRange: [5, 8],
    signatureLeapChance: 0.25,
    toneWeights: {
      root: 1.4,
      third: 2.2,
      fifth: 1.5,
      seventh: 1.2,
      ninth: 1.2,
      eleventh: 1.0,
      pentatonic: 1.6,
    },
    cadenceResolutionStrength: 0.55,
    archShape: 'flat_low',
  },
  deftones_float: {
    harmonicCouplingVerse: 0.45,
    harmonicCouplingChorus: 0.65,
    targetRestRatio: [0.22, 0.35],
    unisonWeight: 0.4,
    maxConsecutiveUnisons: 3,
    signatureLeapRange: [8, 12],
    signatureLeapChance: 0.4,
    toneWeights: {
      root: 0.9,
      third: 1.5,
      fifth: 1.3,
      seventh: 2.0,
      ninth: 2.2,
      eleventh: 1.6,
      pentatonic: 1.0,
    },
    cadenceResolutionStrength: 0.25,
    archShape: 'soar_drop',
  },
  posthc_leap: {
    harmonicCouplingVerse: 0.65,
    harmonicCouplingChorus: 0.9,
    targetRestRatio: [0.2, 0.3],
    unisonWeight: 0.3,
    maxConsecutiveUnisons: 2,
    signatureLeapRange: [7, 12],
    signatureLeapChance: 0.45,
    toneWeights: {
      root: 1.8,
      third: 2.0,
      fifth: 2.2,
      seventh: 1.1,
      ninth: 1.3,
      eleventh: 0.8,
      pentatonic: 1.2,
    },
    cadenceResolutionStrength: 0.85,
    archShape: 'soar_drop',
  },
  jrock_drive: {
    harmonicCouplingVerse: 0.55,
    harmonicCouplingChorus: 0.85,
    targetRestRatio: [0.15, 0.25],
    unisonWeight: 0.6,
    maxConsecutiveUnisons: 3,
    signatureLeapRange: [4, 7],
    signatureLeapChance: 0.25,
    toneWeights: {
      root: 1.8,
      third: 2.0,
      fifth: 1.9,
      seventh: 0.9,
      ninth: 1.0,
      eleventh: 0.7,
      pentatonic: 1.6,
    },
    cadenceResolutionStrength: 0.85,
    archShape: 'late_climb',
  },
  jpop_anthem: {
    harmonicCouplingVerse: 0.75,
    harmonicCouplingChorus: 0.95,
    targetRestRatio: [0.2, 0.32],
    unisonWeight: 0.2,
    maxConsecutiveUnisons: 2,
    signatureLeapRange: [5, 9],
    signatureLeapChance: 0.3,
    toneWeights: {
      root: 2.0,
      third: 2.4,
      fifth: 2.0,
      seventh: 0.7,
      ninth: 1.1,
      eleventh: 0.5,
      pentatonic: 1.8,
    },
    cadenceResolutionStrength: 0.95,
    archShape: 'classic_arch',
  },
  linkin_hybrid: {
    harmonicCouplingVerse: 0.25,
    harmonicCouplingChorus: 0.55,
    targetRestRatio: [0.32, 0.48],
    unisonWeight: 1.8,
    maxConsecutiveUnisons: 5,
    signatureLeapRange: [3, 5],
    signatureLeapChance: 0.1,
    toneWeights: {
      root: 2.2,
      third: 1.7,
      fifth: 2.0,
      seventh: 0.6,
      ninth: 0.5,
      eleventh: 0.4,
      pentatonic: 1.8,
    },
    cadenceResolutionStrength: 0.75,
    archShape: 'tight_burst',
  },
};

function makeSlots(
  defs: ReadonlyArray<
    [number, number, 0 | 1 | 2, boolean?, boolean?]
  >
): SyllableSlot[] {
  return defs.map(([offsetTick, baseDuration, stress, isAnticipation, leapSlot]) => ({
    offsetTick,
    baseDuration,
    stress,
    ...(isAnticipation ? { isAnticipation: true } : {}),
    ...(leapSlot ? { leapSlot: true } : {}),
  }));
}

/**
 * 38 curated human-singable rhythm cells (>= 6 per genre across densities 1..5).
 */
export const VOCAL_RHYTHM_CELLS: readonly RhythmCell[] = [
  // =========================================================================
  // 1. alt_hypnotic (Nirvana / Supercar / Radiohead) - 6 cells
  // =========================================================================
  {
    id: 'alt_sparse_pulse',
    lengthTicks: 3840,
    genres: ['alt_hypnotic'],
    densityRange: [1, 2],
    hasSixteenths: false,
    trailingBreathTicks: 960,
    slots: makeSlots([
      [0, 480, 2],
      [480, 480, 1],
      [960, 720, 2],
      [1920, 480, 2],
      [2400, 480, 1, false, true],
    ]),
  },
  {
    id: 'alt_hypnotic_8th_chant',
    lengthTicks: 3840,
    genres: ['alt_hypnotic'],
    densityRange: [2, 4],
    hasSixteenths: false,
    trailingBreathTicks: 720,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 0, true],
      [960, 480, 2],
      [1440, 480, 1],
      [1920, 240, 2],
      [2160, 240, 0],
      [2400, 720, 2, false, true],
    ]),
  },
  {
    id: 'alt_supercar_float',
    lengthTicks: 3840,
    genres: ['alt_hypnotic'],
    densityRange: [2, 4],
    hasSixteenths: false,
    trailingBreathTicks: 720,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 480, 1, true],
      [1200, 480, 1],
      [1680, 480, 2, true, true],
      [2160, 960, 2],
    ]),
  },
  {
    id: 'alt_radiohead_sync',
    lengthTicks: 3840,
    genres: ['alt_hypnotic'],
    densityRange: [3, 5],
    hasSixteenths: false,
    trailingBreathTicks: 600,
    slots: makeSlots([
      [240, 240, 1],
      [480, 240, 2],
      [720, 240, 0, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 480, 1],
      [1920, 240, 2],
      [2160, 240, 0],
      [2400, 240, 1, false, true],
      [2640, 600, 2],
    ]),
  },
  {
    id: 'alt_dense_drone',
    lengthTicks: 3840,
    genres: ['alt_hypnotic'],
    densityRange: [4, 5],
    hasSixteenths: false,
    trailingBreathTicks: 480,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 0, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 240, 1],
      [1680, 240, 1, true],
      [1920, 240, 2],
      [2160, 240, 0],
      [2400, 240, 1, false, true],
      [2640, 720, 2],
    ]),
  },
  {
    id: 'alt_onebar_cell',
    lengthTicks: 1920,
    genres: ['alt_hypnotic'],
    densityRange: [1, 5],
    hasSixteenths: false,
    trailingBreathTicks: 480,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 480, 1],
      [960, 480, 2, false, true],
    ]),
  },

  // =========================================================================
  // 2. deftones_float (Deftones / Shoegaze Metal) - 6 cells
  // =========================================================================
  {
    id: 'def_laidback_whisper',
    lengthTicks: 3840,
    genres: ['deftones_float'],
    densityRange: [1, 2],
    hasSixteenths: false,
    trailingBreathTicks: 720,
    slots: makeSlots([
      [480, 480, 1],
      [960, 720, 2],
      [1680, 1440, 2, true, true],
    ]),
  },
  {
    id: 'def_beat2_soar',
    lengthTicks: 3840,
    genres: ['deftones_float'],
    densityRange: [2, 4],
    hasSixteenths: false,
    trailingBreathTicks: 720,
    slots: makeSlots([
      [240, 240, 0],
      [480, 480, 2],
      [960, 240, 1],
      [1200, 480, 1],
      [1680, 1440, 2, true, true],
    ]),
  },
  {
    id: 'def_sway_crossbar',
    lengthTicks: 3840,
    genres: ['deftones_float'],
    densityRange: [2, 4],
    hasSixteenths: false,
    trailingBreathTicks: 600,
    slots: makeSlots([
      [480, 240, 1],
      [720, 480, 1, true],
      [1200, 480, 1],
      [1680, 720, 2, true, true],
      [2400, 840, 2],
    ]),
  },
  {
    id: 'def_languid_drift',
    lengthTicks: 3840,
    genres: ['deftones_float'],
    densityRange: [3, 5],
    hasSixteenths: false,
    trailingBreathTicks: 600,
    slots: makeSlots([
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 0, true],
      [960, 480, 2],
      [1440, 240, 0],
      [1680, 480, 2, true, true],
      [2160, 1080, 2],
    ]),
  },
  {
    id: 'def_dense_float',
    lengthTicks: 3840,
    genres: ['deftones_float'],
    densityRange: [4, 5],
    hasSixteenths: false,
    trailingBreathTicks: 480,
    slots: makeSlots([
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 0, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 240, 1],
      [1680, 480, 2, true, true],
      [2160, 240, 0],
      [2400, 960, 2],
    ]),
  },
  {
    id: 'def_onebar_cell',
    lengthTicks: 1920,
    genres: ['deftones_float'],
    densityRange: [1, 5],
    hasSixteenths: false,
    trailingBreathTicks: 480,
    slots: makeSlots([
      [240, 240, 0],
      [480, 960, 2, false, true],
    ]),
  },

  // =========================================================================
  // 3. posthc_leap (SAOSIN / LINKIN PARK Chorus) - 6 cells
  // =========================================================================
  {
    id: 'posthc_sparse_soar',
    lengthTicks: 3840,
    genres: ['posthc_leap'],
    densityRange: [1, 2],
    hasSixteenths: false,
    trailingBreathTicks: 720,
    slots: makeSlots([
      [480, 480, 1],
      [960, 720, 2],
      [1680, 960, 2, true, true],
      [2640, 480, 1],
    ]),
  },
  {
    id: 'posthc_offbeat_climb',
    lengthTicks: 3840,
    genres: ['posthc_leap'],
    densityRange: [2, 4],
    hasSixteenths: false,
    trailingBreathTicks: 480,
    slots: makeSlots([
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 0, true],
      [960, 480, 2],
      [1440, 240, 1],
      [1680, 960, 2, true, true],
      [2640, 240, 0],
      [2880, 480, 1],
    ]),
  },
  {
    id: 'posthc_staircase_emo',
    lengthTicks: 3840,
    genres: ['posthc_leap'],
    densityRange: [3, 5],
    hasSixteenths: false,
    trailingBreathTicks: 480,
    slots: makeSlots([
      [240, 240, 1],
      [480, 240, 2],
      [720, 240, 0, true],
      [960, 240, 1],
      [1200, 480, 1],
      [1680, 960, 2, true, true],
      [2640, 240, 0],
      [2880, 240, 1],
      [3120, 240, 1],
    ]),
  },
  {
    id: 'posthc_16th_surge',
    lengthTicks: 3840,
    genres: ['posthc_leap'],
    densityRange: [4, 5],
    hasSixteenths: true,
    trailingBreathTicks: 360,
    slots: makeSlots([
      [240, 120, 1],
      [360, 120, 0],
      [480, 240, 2],
      [720, 240, 0, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 240, 1],
      [1680, 960, 2, true, true],
      [2640, 240, 0],
      [2880, 600, 2],
    ]),
  },
  {
    id: 'posthc_dense_cascade',
    lengthTicks: 3840,
    genres: ['posthc_leap'],
    densityRange: [4, 5],
    hasSixteenths: false,
    trailingBreathTicks: 360,
    slots: makeSlots([
      [240, 240, 0],
      [480, 240, 2],
      [720, 240, 0, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 240, 1],
      [1680, 720, 2, true, true],
      [2400, 240, 1],
      [2640, 240, 0],
      [2880, 600, 2],
    ]),
  },
  {
    id: 'posthc_onebar_cell',
    lengthTicks: 1920,
    genres: ['posthc_leap'],
    densityRange: [1, 5],
    hasSixteenths: false,
    trailingBreathTicks: 360,
    slots: makeSlots([
      [240, 240, 0],
      [480, 240, 1],
      [720, 840, 2, true, true],
    ]),
  },

  // =========================================================================
  // 4. jrock_drive (ELLEGARDEN / STRAIGHTENER / ACIDMAN) - 7 cells
  // =========================================================================
  {
    id: 'jrock_sparse_push',
    lengthTicks: 3840,
    genres: ['jrock_drive'],
    densityRange: [1, 2],
    hasSixteenths: false,
    trailingBreathTicks: 600,
    slots: makeSlots([
      [0, 480, 2],
      [720, 480, 1, true],
      [1680, 480, 2, true, true],
      [2160, 480, 1],
      [2640, 600, 2],
    ]),
  },
  {
    id: 'jrock_pickup_drive',
    lengthTicks: 3840,
    genres: ['jrock_drive'],
    densityRange: [2, 4],
    hasSixteenths: false,
    trailingBreathTicks: 480,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 1, true],
      [960, 480, 2],
      [1440, 240, 0],
      [1680, 480, 2, true, true],
      [2160, 240, 0],
      [2400, 240, 1],
      [2640, 720, 2],
    ]),
  },
  {
    id: 'jrock_straight_8th',
    lengthTicks: 3840,
    genres: ['jrock_drive'],
    densityRange: [3, 5],
    hasSixteenths: false,
    trailingBreathTicks: 480,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 1, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 240, 1],
      [1680, 240, 2, true, true],
      [1920, 240, 1],
      [2160, 240, 0],
      [2400, 240, 1],
      [2640, 720, 2],
    ]),
  },
  {
    id: 'jrock_16th_rush',
    lengthTicks: 3840,
    genres: ['jrock_drive'],
    densityRange: [4, 5],
    hasSixteenths: true,
    trailingBreathTicks: 360,
    slots: makeSlots([
      [0, 240, 2],
      [240, 120, 0],
      [360, 120, 0],
      [480, 240, 1],
      [720, 240, 1, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 240, 1],
      [1680, 480, 2, true, true],
      [2160, 240, 1],
      [2400, 240, 1],
      [2640, 840, 2],
    ]),
  },
  {
    id: 'jrock_stop_and_climb',
    lengthTicks: 3840,
    genres: ['jrock_drive'],
    densityRange: [2, 4],
    hasSixteenths: false,
    trailingBreathTicks: 720,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 1, true],
      [1440, 240, 1],
      [1680, 480, 2, true, true],
      [2160, 240, 0],
      [2400, 720, 2],
    ]),
  },
  {
    id: 'jrock_dense_sync',
    lengthTicks: 3840,
    genres: ['jrock_drive'],
    densityRange: [4, 5],
    hasSixteenths: false,
    trailingBreathTicks: 360,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 1, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 240, 1],
      [1680, 240, 2, true, true],
      [1920, 240, 2],
      [2160, 240, 0],
      [2400, 240, 1],
      [2640, 240, 0],
      [2880, 600, 2],
    ]),
  },
  {
    id: 'jrock_onebar_cell',
    lengthTicks: 1920,
    genres: ['jrock_drive'],
    densityRange: [1, 5],
    hasSixteenths: false,
    trailingBreathTicks: 240,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 1, true],
      [960, 480, 2, false, true],
      [1440, 240, 1],
    ]),
  },

  // =========================================================================
  // 5. jpop_anthem (Melodic J-POP) - 7 cells
  // =========================================================================
  {
    id: 'jpop_sparse_ballad',
    lengthTicks: 3840,
    genres: ['jpop_anthem'],
    densityRange: [1, 2],
    hasSixteenths: false,
    trailingBreathTicks: 600,
    slots: makeSlots([
      [0, 480, 2],
      [480, 480, 1],
      [960, 720, 2],
      [1920, 480, 2, false, true],
      [2400, 840, 2],
    ]),
  },
  {
    id: 'jpop_catchy_8th',
    lengthTicks: 3840,
    genres: ['jpop_anthem'],
    densityRange: [2, 4],
    hasSixteenths: false,
    trailingBreathTicks: 480,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 1, true],
      [960, 480, 2],
      [1440, 480, 1],
      [1920, 240, 2, false, true],
      [2160, 240, 0],
      [2400, 960, 2],
    ]),
  },
  {
    id: 'jpop_golden_hook',
    lengthTicks: 3840,
    genres: ['jpop_anthem'],
    densityRange: [3, 5],
    hasSixteenths: false,
    trailingBreathTicks: 480,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 1, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 240, 1],
      [1680, 240, 1, true, true],
      [1920, 240, 2],
      [2160, 240, 0],
      [2400, 960, 2],
    ]),
  },
  {
    id: 'jpop_syllable_step',
    lengthTicks: 3840,
    genres: ['jpop_anthem'],
    densityRange: [3, 5],
    hasSixteenths: false,
    trailingBreathTicks: 360,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 1, true],
      [960, 480, 2],
      [1440, 240, 0],
      [1680, 240, 1, true],
      [1920, 240, 2, false, true],
      [2160, 240, 0],
      [2400, 1080, 2],
    ]),
  },
  {
    id: 'jpop_16th_ornament',
    lengthTicks: 3840,
    genres: ['jpop_anthem'],
    densityRange: [4, 5],
    hasSixteenths: true,
    trailingBreathTicks: 360,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 120, 1],
      [600, 120, 0],
      [720, 240, 1, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 240, 1],
      [1680, 240, 1, true, true],
      [1920, 240, 2],
      [2160, 240, 0],
      [2400, 1080, 2],
    ]),
  },
  {
    id: 'jpop_dense_chorus',
    lengthTicks: 3840,
    genres: ['jpop_anthem'],
    densityRange: [4, 5],
    hasSixteenths: false,
    trailingBreathTicks: 360,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 1, true],
      [960, 240, 2],
      [1200, 240, 0],
      [1440, 240, 1],
      [1680, 240, 1, true, true],
      [1920, 240, 2],
      [2160, 240, 0],
      [2400, 240, 1],
      [2640, 840, 2],
    ]),
  },
  {
    id: 'jpop_onebar_cell',
    lengthTicks: 1920,
    genres: ['jpop_anthem'],
    densityRange: [1, 5],
    hasSixteenths: false,
    trailingBreathTicks: 360,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 1, true, true],
      [960, 600, 2],
    ]),
  },

  // =========================================================================
  // 6. linkin_hybrid (LINKIN PARK Verse) - 6 cells
  // =========================================================================
  {
    id: 'lp_sparse_punch',
    lengthTicks: 3840,
    genres: ['linkin_hybrid'],
    densityRange: [1, 2],
    hasSixteenths: false,
    trailingBreathTicks: 960,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 1],
      [480, 240, 2],
      [1920, 240, 2],
      [2160, 240, 1],
      [2400, 240, 2],
    ]),
  },
  {
    id: 'lp_8th_stop_freeze',
    lengthTicks: 3840,
    genres: ['linkin_hybrid'],
    densityRange: [2, 4],
    hasSixteenths: false,
    trailingBreathTicks: 840,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 2],
      [1920, 240, 2],
      [2160, 240, 0],
      [2400, 240, 1],
      [2640, 240, 2],
    ]),
  },
  {
    id: 'lp_tight_16th_burst',
    lengthTicks: 3840,
    genres: ['linkin_hybrid'],
    densityRange: [3, 5],
    hasSixteenths: true,
    trailingBreathTicks: 960,
    slots: makeSlots([
      [0, 120, 2],
      [120, 120, 0],
      [240, 120, 1],
      [360, 120, 0],
      [480, 240, 2],
      [720, 240, 1],
      [1920, 120, 2],
      [2040, 120, 0],
      [2160, 120, 1],
      [2280, 120, 0],
      [2400, 240, 2],
      [2640, 240, 1],
    ]),
  },
  {
    id: 'lp_staccato_8th_drive',
    lengthTicks: 3840,
    genres: ['linkin_hybrid'],
    densityRange: [3, 5],
    hasSixteenths: false,
    trailingBreathTicks: 720,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 0],
      [960, 240, 2],
      [1920, 240, 2],
      [2160, 240, 0],
      [2400, 240, 1],
      [2640, 240, 0],
      [2880, 240, 2],
    ]),
  },
  {
    id: 'lp_dense_chop',
    lengthTicks: 3840,
    genres: ['linkin_hybrid'],
    densityRange: [4, 5],
    hasSixteenths: false,
    trailingBreathTicks: 720,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 0],
      [960, 240, 2],
      [1920, 240, 2],
      [2160, 240, 0],
      [2400, 240, 1],
      [2640, 240, 0],
      [2880, 240, 1],
      [3120, 120, 2],
    ]),
  },
  {
    id: 'lp_onebar_cell',
    lengthTicks: 1920,
    genres: ['linkin_hybrid'],
    densityRange: [1, 5],
    hasSixteenths: false,
    trailingBreathTicks: 720,
    slots: makeSlots([
      [0, 240, 2],
      [240, 240, 0],
      [480, 240, 1],
      [720, 240, 2],
    ]),
  },
];
