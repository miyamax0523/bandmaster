import type {
  AccompanimentTake,
  BassSkeletonId,
  BeatPatternId,
  KeyboardSkeletonId,
  PadSkeletonId,
  SectionType,
} from '../types/song';
import { normalizeMasterGenreId, type MasterGenreId } from '../lib/masterGenres';
import type { SubdivisionMode } from './musicCore';

export type EnsembleCue = 'NONE' | 'PPPH' | 'SOCA' | 'TRAIN' | 'SLIP';

export interface DrumSyncRule {
  readonly strictGroove: boolean;
  readonly subdivision: SubdivisionMode;
  readonly cue: EnsembleCue;
  readonly bassSkeleton: BassSkeletonId;
  readonly keyboardSkeleton: KeyboardSkeletonId;
  readonly padSkeleton: PadSkeletonId;
}

export const DRUM_SYNC_TABLE: Record<BeatPatternId, DrumSyncRule> = {
  EIGHT_BEAT: {
    strictGroove: false,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'EIGHTH_ROOT',
    keyboardSkeleton: 'QUARTER_CHOP',
    padSkeleton: 'WARM_SUSTAIN',
  },
  SIXTEEN_BEAT: {
    strictGroove: false,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'SIXTEENTH_SYNC',
    keyboardSkeleton: 'SYNCOPATED_RIFF',
    padSkeleton: 'WARM_SUSTAIN',
  },
  ATAMA_UCHI: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'KICK_LOCK',
    keyboardSkeleton: 'OFFBEAT_STAB',
    padSkeleton: 'SIDECHAIN_PULSE',
  },
  FOUR_ON_FLOOR: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'OCTAVE_GROOVE',
    keyboardSkeleton: 'QUARTER_CHOP',
    padSkeleton: 'SIDECHAIN_PULSE',
  },
  UPBEAT: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'OCTAVE_GROOVE',
    keyboardSkeleton: 'OFFBEAT_STAB',
    padSkeleton: 'SIDECHAIN_PULSE',
  },
  TWO_BEAT: {
    strictGroove: false,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'EIGHTH_ROOT',
    keyboardSkeleton: 'QUARTER_CHOP',
    padSkeleton: 'WARM_SUSTAIN',
  },
  BOUNCE: {
    strictGroove: true,
    subdivision: 'BOUNCE_16',
    cue: 'NONE',
    bassSkeleton: 'OCTAVE_GROOVE',
    keyboardSkeleton: 'OFFBEAT_STAB',
    padSkeleton: 'SIDECHAIN_PULSE',
  },
  HALF_TIME: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'LONG_SUSTAIN',
    keyboardSkeleton: 'SUSTAIN_CHORD',
    padSkeleton: 'PEDAL_DRONE',
  },
  DOUBLE_BASS: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'KICK_LOCK',
    keyboardSkeleton: 'SUSTAIN_CHORD',
    padSkeleton: 'PEDAL_DRONE',
  },
  SOCA: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'SOCA',
    bassSkeleton: 'OCTAVE_GROOVE',
    keyboardSkeleton: 'OFFBEAT_STAB',
    padSkeleton: 'SIDECHAIN_PULSE',
  },
  SLIP_BEAT: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'SLIP',
    bassSkeleton: 'KICK_LOCK',
    keyboardSkeleton: 'SYNCOPATED_RIFF',
    padSkeleton: 'WARM_SUSTAIN',
  },
  SHUFFLE: {
    strictGroove: true,
    subdivision: 'SHUFFLE_8',
    cue: 'NONE',
    bassSkeleton: 'TRIPLET_SHUFFLE',
    keyboardSkeleton: 'TRIPLET_COMP',
    padSkeleton: 'WARM_SUSTAIN',
  },
  HALF_TIME_SHUFFLE: {
    strictGroove: true,
    subdivision: 'HALF_TIME_SHUFFLE',
    cue: 'NONE',
    bassSkeleton: 'TRIPLET_SHUFFLE',
    keyboardSkeleton: 'TRIPLET_COMP',
    padSkeleton: 'WARM_SUSTAIN',
  },
  JUNGLE: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'LONG_SUSTAIN',
    keyboardSkeleton: 'OFFBEAT_STAB',
    padSkeleton: 'PEDAL_DRONE',
  },
  TRAIN: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'TRAIN',
    bassSkeleton: 'EIGHTH_ROOT',
    keyboardSkeleton: 'OFFBEAT_STAB',
    padSkeleton: 'WARM_SUSTAIN',
  },
  MARCH: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'KICK_LOCK',
    keyboardSkeleton: 'QUARTER_CHOP',
    padSkeleton: 'BUILDUP_SWELL',
  },
  PPPH: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'PPPH',
    bassSkeleton: 'KICK_LOCK',
    keyboardSkeleton: 'SYNCOPATED_RIFF',
    padSkeleton: 'BUILDUP_SWELL',
  },
  FOUR_BEAT: {
    strictGroove: true,
    subdivision: 'SHUFFLE_8',
    cue: 'NONE',
    bassSkeleton: 'TRIPLET_SHUFFLE',
    keyboardSkeleton: 'TRIPLET_COMP',
    padSkeleton: 'WARM_SUSTAIN',
  },
  SAMBA: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'OCTAVE_GROOVE',
    keyboardSkeleton: 'SYNCOPATED_RIFF',
    padSkeleton: 'SIDECHAIN_PULSE',
  },
  SONGO: {
    strictGroove: true,
    subdivision: 'STRAIGHT',
    cue: 'NONE',
    bassSkeleton: 'SIXTEENTH_SYNC',
    keyboardSkeleton: 'SYNCOPATED_RIFF',
    padSkeleton: 'WARM_SUSTAIN',
  },
};

export interface GenreAccompanimentFlavor {
  readonly id: MasterGenreId;
  readonly bassVelocityScale: number;
  readonly keyboardVelocityScale: number;
  readonly padVelocityScale: number;
  readonly keyboardRange: { min: number; max: number };
  readonly padRange: { min: number; max: number };
  readonly defaultBassBySection: Partial<Record<SectionType, BassSkeletonId>>;
  readonly defaultKeyboardBySection: Partial<Record<SectionType, KeyboardSkeletonId>>;
  readonly defaultPadBySection: Partial<Record<SectionType, PadSkeletonId>>;
  readonly defaultTakeBySection: Partial<Record<SectionType, AccompanimentTake>>;
}

export const GENRE_ACCOMPANIMENT_FLAVORS: Record<
  MasterGenreId,
  GenreAccompanimentFlavor
> = {
  alt_shoegaze: {
    id: 'alt_shoegaze',
    bassVelocityScale: 0.96,
    keyboardVelocityScale: 0.9,
    padVelocityScale: 1.0,
    keyboardRange: { min: 52, max: 72 },
    padRange: { min: 55, max: 79 },
    defaultBassBySection: {
      Intro: 'LONG_SUSTAIN',
      Verse: 'EIGHTH_ROOT',
      'Pre-Chorus': 'KICK_LOCK',
      Chorus: 'EIGHTH_ROOT',
      Bridge: 'LONG_SUSTAIN',
      Outro: 'LONG_SUSTAIN',
    },
    defaultKeyboardBySection: {
      Intro: 'SUSTAIN_CHORD',
      Verse: 'ARPEGGIO_8TH_16TH',
      'Pre-Chorus': 'QUARTER_CHOP',
      Chorus: 'SUSTAIN_CHORD',
      Bridge: 'SUSTAIN_CHORD',
      Outro: 'SUSTAIN_CHORD',
    },
    defaultPadBySection: {
      Intro: 'PEDAL_DRONE',
      Verse: 'WARM_SUSTAIN',
      'Pre-Chorus': 'BUILDUP_SWELL',
      Chorus: 'PEDAL_DRONE',
      Bridge: 'PEDAL_DRONE',
      Outro: 'WARM_SUSTAIN',
    },
    defaultTakeBySection: {
      Intro: 'A',
      Verse: 'A',
      'Pre-Chorus': 'B',
      Chorus: 'C',
      Bridge: 'B',
      Outro: 'A',
    },
  },
  emo_jrock: {
    id: 'emo_jrock',
    bassVelocityScale: 1.04,
    keyboardVelocityScale: 0.98,
    padVelocityScale: 0.96,
    keyboardRange: { min: 55, max: 74 },
    padRange: { min: 57, max: 79 },
    defaultBassBySection: {
      Intro: 'EIGHTH_ROOT',
      Verse: 'KICK_LOCK',
      'Pre-Chorus': 'EIGHTH_ROOT',
      Chorus: 'EIGHTH_ROOT',
      Bridge: 'LONG_SUSTAIN',
      Outro: 'EIGHTH_ROOT',
    },
    defaultKeyboardBySection: {
      Intro: 'ARPEGGIO_8TH_16TH',
      Verse: 'QUARTER_CHOP',
      'Pre-Chorus': 'SYNCOPATED_RIFF',
      Chorus: 'QUARTER_CHOP',
      Bridge: 'SUSTAIN_CHORD',
      Outro: 'QUARTER_CHOP',
    },
    defaultPadBySection: {
      Intro: 'WARM_SUSTAIN',
      Verse: 'WARM_SUSTAIN',
      'Pre-Chorus': 'BUILDUP_SWELL',
      Chorus: 'WARM_SUSTAIN',
      Bridge: 'PEDAL_DRONE',
      Outro: 'WARM_SUSTAIN',
    },
    defaultTakeBySection: {
      Intro: 'A',
      Verse: 'B',
      'Pre-Chorus': 'B',
      Chorus: 'C',
      Bridge: 'A',
      Outro: 'B',
    },
  },
  numetal_mixture: {
    id: 'numetal_mixture',
    bassVelocityScale: 1.08,
    keyboardVelocityScale: 0.95,
    padVelocityScale: 0.95,
    keyboardRange: { min: 53, max: 74 },
    padRange: { min: 57, max: 81 },
    defaultBassBySection: {
      Intro: 'RIFF_CHUG',
      Verse: 'KICK_LOCK',
      'Pre-Chorus': 'RIFF_CHUG',
      Chorus: 'RIFF_CHUG',
      Bridge: 'LONG_SUSTAIN',
      Outro: 'RIFF_CHUG',
    },
    defaultKeyboardBySection: {
      Intro: 'SUSTAIN_CHORD',
      Verse: 'SYNCOPATED_RIFF',
      'Pre-Chorus': 'QUARTER_CHOP',
      Chorus: 'SUSTAIN_CHORD',
      Bridge: 'SUSTAIN_CHORD',
      Outro: 'SUSTAIN_CHORD',
    },
    defaultPadBySection: {
      Intro: 'PEDAL_DRONE',
      Verse: 'PEDAL_DRONE',
      'Pre-Chorus': 'BUILDUP_SWELL',
      Chorus: 'PEDAL_DRONE',
      Bridge: 'PEDAL_DRONE',
      Outro: 'PEDAL_DRONE',
    },
    defaultTakeBySection: {
      Intro: 'A',
      Verse: 'B',
      'Pre-Chorus': 'C',
      Chorus: 'C',
      Bridge: 'A',
      Outro: 'C',
    },
  },
  royal_jpop: {
    id: 'royal_jpop',
    bassVelocityScale: 1.0,
    keyboardVelocityScale: 1.0,
    padVelocityScale: 0.98,
    keyboardRange: { min: 55, max: 76 },
    padRange: { min: 57, max: 79 },
    defaultBassBySection: {
      Intro: 'EIGHTH_ROOT',
      Verse: 'OCTAVE_GROOVE',
      'Pre-Chorus': 'EIGHTH_ROOT',
      Chorus: 'EIGHTH_ROOT',
      Bridge: 'LONG_SUSTAIN',
      Outro: 'EIGHTH_ROOT',
    },
    defaultKeyboardBySection: {
      Intro: 'ARPEGGIO_8TH_16TH',
      Verse: 'SYNCOPATED_RIFF',
      'Pre-Chorus': 'QUARTER_CHOP',
      Chorus: 'QUARTER_CHOP',
      Bridge: 'ARPEGGIO_8TH_16TH',
      Outro: 'SUSTAIN_CHORD',
    },
    defaultPadBySection: {
      Intro: 'WARM_SUSTAIN',
      Verse: 'WARM_SUSTAIN',
      'Pre-Chorus': 'BUILDUP_SWELL',
      Chorus: 'WARM_SUSTAIN',
      Bridge: 'WARM_SUSTAIN',
      Outro: 'WARM_SUSTAIN',
    },
    defaultTakeBySection: {
      Intro: 'A',
      Verse: 'B',
      'Pre-Chorus': 'B',
      Chorus: 'C',
      Bridge: 'B',
      Outro: 'A',
    },
  },
  chill_ballad: {
    id: 'chill_ballad',
    bassVelocityScale: 0.88,
    keyboardVelocityScale: 0.86,
    padVelocityScale: 0.92,
    keyboardRange: { min: 53, max: 74 },
    padRange: { min: 55, max: 76 },
    defaultBassBySection: {
      Intro: 'LONG_SUSTAIN',
      Verse: 'LONG_SUSTAIN',
      'Pre-Chorus': 'KICK_LOCK',
      Chorus: 'EIGHTH_ROOT',
      Bridge: 'LONG_SUSTAIN',
      Outro: 'LONG_SUSTAIN',
    },
    defaultKeyboardBySection: {
      Intro: 'SUSTAIN_CHORD',
      Verse: 'ARPEGGIO_8TH_16TH',
      'Pre-Chorus': 'ARPEGGIO_8TH_16TH',
      Chorus: 'SUSTAIN_CHORD',
      Bridge: 'SUSTAIN_CHORD',
      Outro: 'SUSTAIN_CHORD',
    },
    defaultPadBySection: {
      Intro: 'WARM_SUSTAIN',
      Verse: 'WARM_SUSTAIN',
      'Pre-Chorus': 'BUILDUP_SWELL',
      Chorus: 'WARM_SUSTAIN',
      Bridge: 'PEDAL_DRONE',
      Outro: 'WARM_SUSTAIN',
    },
    defaultTakeBySection: {
      Intro: 'A',
      Verse: 'A',
      'Pre-Chorus': 'B',
      Chorus: 'B',
      Bridge: 'A',
      Outro: 'A',
    },
  },
};

export interface EnsembleSyncPlan {
  readonly drumPatternId: BeatPatternId;
  readonly genreId: MasterGenreId;
  readonly strictGroove: boolean;
  readonly subdivision: SubdivisionMode;
  readonly cue: EnsembleCue;
  readonly ppphDoubleTime: boolean;
  readonly bassSkeleton: BassSkeletonId;
  readonly bassTake: AccompanimentTake;
  readonly keyboardSkeleton: KeyboardSkeletonId;
  readonly keyboardTake: AccompanimentTake;
  readonly padSkeleton: PadSkeletonId;
  readonly padTake: AccompanimentTake;
  readonly bassVelocityScale: number;
  readonly keyboardVelocityScale: number;
  readonly padVelocityScale: number;
  readonly keyboardRange: { min: number; max: number };
  readonly padRange: { min: number; max: number };
}

export function getDrumSyncRule(
  drumPatternId: BeatPatternId | 'auto' | string | undefined
): DrumSyncRule {
  if (drumPatternId && drumPatternId !== 'auto' && drumPatternId in DRUM_SYNC_TABLE) {
    return DRUM_SYNC_TABLE[drumPatternId as BeatPatternId];
  }
  return DRUM_SYNC_TABLE.EIGHT_BEAT;
}

export function resolveEnsembleSyncPlan(options: {
  drumPatternId?: BeatPatternId | 'auto' | string;
  masterGenreId?: MasterGenreId | string;
  sectionType?: SectionType;
  bpm?: number;
  bassSkeleton?: BassSkeletonId | 'auto';
  bassTake?: AccompanimentTake | 'auto';
  keyboardSkeleton?: KeyboardSkeletonId | 'auto';
  keyboardTake?: AccompanimentTake | 'auto';
  padSkeleton?: PadSkeletonId | 'auto';
  padTake?: AccompanimentTake | 'auto';
}): EnsembleSyncPlan {
  const resolvedDrum: BeatPatternId =
    options.drumPatternId &&
    options.drumPatternId !== 'auto' &&
    options.drumPatternId in DRUM_SYNC_TABLE
      ? (options.drumPatternId as BeatPatternId)
      : 'EIGHT_BEAT';
  const rule = DRUM_SYNC_TABLE[resolvedDrum];
  const genreId = normalizeMasterGenreId(options.masterGenreId);
  const flavor = GENRE_ACCOMPANIMENT_FLAVORS[genreId];
  const secType: SectionType = options.sectionType ?? 'Verse';
  const bpm = options.bpm ?? 130;

  const autoBass = rule.strictGroove
    ? rule.bassSkeleton
    : (flavor.defaultBassBySection[secType] ?? rule.bassSkeleton);
  const autoKeyboard = rule.strictGroove
    ? rule.keyboardSkeleton
    : (flavor.defaultKeyboardBySection[secType] ?? rule.keyboardSkeleton);
  const autoPad =
    secType === 'Pre-Chorus' && !rule.strictGroove
      ? 'BUILDUP_SWELL'
      : rule.strictGroove
        ? rule.padSkeleton
        : (flavor.defaultPadBySection[secType] ?? rule.padSkeleton);

  const defaultTake = flavor.defaultTakeBySection[secType] ?? 'A';

  return {
    drumPatternId: resolvedDrum,
    genreId,
    strictGroove: rule.strictGroove,
    subdivision: rule.subdivision,
    cue: rule.cue,
    ppphDoubleTime: rule.cue === 'PPPH' && bpm >= 155,
    bassSkeleton:
      options.bassSkeleton && options.bassSkeleton !== 'auto'
        ? options.bassSkeleton
        : autoBass,
    bassTake:
      options.bassTake && options.bassTake !== 'auto'
        ? options.bassTake
        : defaultTake,
    keyboardSkeleton:
      options.keyboardSkeleton && options.keyboardSkeleton !== 'auto'
        ? options.keyboardSkeleton
        : autoKeyboard,
    keyboardTake:
      options.keyboardTake && options.keyboardTake !== 'auto'
        ? options.keyboardTake
        : defaultTake,
    padSkeleton:
      options.padSkeleton && options.padSkeleton !== 'auto'
        ? options.padSkeleton
        : autoPad,
    padTake:
      options.padTake && options.padTake !== 'auto'
        ? options.padTake
        : defaultTake,
    bassVelocityScale: flavor.bassVelocityScale,
    keyboardVelocityScale: flavor.keyboardVelocityScale,
    padVelocityScale: flavor.padVelocityScale,
    keyboardRange: flavor.keyboardRange,
    padRange: flavor.padRange,
  };
}
