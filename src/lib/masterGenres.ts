import type { BeatFeel, InstrumentType, ScaleType } from '../types/song';

export type MasterGenreId =
  | 'alt_shoegaze'
  | 'emo_jrock'
  | 'numetal_mixture'
  | 'royal_jpop'
  | 'chill_ballad';

export interface MasterGenrePartDna {
  drums: string;
  bass: string;
  keyboard: string;
  pad: string;
  vocal: string;
  vocalVerse?: string;
}

export interface MasterGenreMeta {
  id: MasterGenreId;
  label: string;
  shortLabel: string;
  icon: string;
  desc: string;
  recommendedBpm: number;
  defaultScale: ScaleType;
  beatFeel: BeatFeel;
  partDna: MasterGenrePartDna;
  defaultPresets: Record<InstrumentType, string>;
}

export const MASTER_GENRES: Record<MasterGenreId, MasterGenreMeta> = {
  alt_shoegaze: {
    id: 'alt_shoegaze',
    label: 'オルタナ・ヘヴィ／シューゲイザー',
    shortLabel: 'オルタナ',
    icon: '🌊',
    desc: 'Deftones / Nirvana / スーパーカー / Radiohead 系',
    recommendedBpm: 118,
    defaultScale: 'Minor',
    beatFeel: 'Half-Time',
    partDna: {
      drums: 'alt_heavy_shoegaze',
      bass: 'alt_heavy_rock',
      keyboard: 'alt_heavy_shoegaze',
      pad: 'alt_shoegaze',
      vocal: 'deftones_float',
      vocalVerse: 'alt_hypnotic',
    },
    defaultPresets: {
      drums: 'halftime_heavy',
      bass: 'auto',
      keyboard: 'floating_tension',
      pad: 'floating_9th',
      vocal: 'melody_deftones_float',
    },
  },
  emo_jrock: {
    id: 'emo_jrock',
    label: '疾走エモ・J-ROCK',
    shortLabel: 'エモ・J-ROCK',
    icon: '⚡',
    desc: 'ELLEGARDEN / STRAIGHTENER / ACIDMAN / SAOSIN 系',
    recommendedBpm: 162,
    defaultScale: 'Major',
    beatFeel: 'Driving',
    partDna: {
      drums: 'emo_jrock_fast',
      bass: 'emo_jrock',
      keyboard: 'emo_jrock',
      pad: 'emo_jrock',
      vocal: 'jrock_drive',
      vocalVerse: 'jrock_drive',
    },
    defaultPresets: {
      drums: 'rock_drive',
      bass: 'jrock_anticipation',
      keyboard: 'chord_eighth',
      pad: 'high_shimmer',
      vocal: 'melody_jrock_drive',
    },
  },
  numetal_mixture: {
    id: 'numetal_mixture',
    label: 'ミクスチャー・ニューメタル',
    shortLabel: 'ミクスチャー',
    icon: '🔥',
    desc: 'LINKIN PARK（Faint 等）系',
    recommendedBpm: 135,
    defaultScale: 'Minor',
    beatFeel: 'Straight',
    partDna: {
      drums: 'numetal_mixture',
      bass: 'alt_heavy_rock',
      keyboard: 'alt_heavy_shoegaze',
      pad: 'numetal_electro',
      vocal: 'linkin_hybrid',
      vocalVerse: 'rap_mixture_flow',
    },
    defaultPresets: {
      drums: 'breakdown_heavy',
      bass: 'metal_gallop',
      keyboard: 'rock_power_riff',
      pad: 'sidechain_pulse',
      vocal: 'rap_linkin_hybrid',
    },
  },
  royal_jpop: {
    id: 'royal_jpop',
    label: '王道J-POP・ロック',
    shortLabel: '王道J-POP',
    icon: '✨',
    desc: 'GLAY / aiko / フジファブリック / Chevon / NEE 系',
    recommendedBpm: 145,
    defaultScale: 'Major',
    beatFeel: 'Straight',
    partDna: {
      drums: 'jpop_melodic',
      bass: 'jpop_melodic',
      keyboard: 'jpop_melodic',
      pad: 'jpop_ballad',
      vocal: 'jpop_anthem',
      vocalVerse: 'jpop_anthem',
    },
    defaultPresets: {
      drums: 'straight_8',
      bass: 'kick_lock',
      keyboard: 'syncopated_comp',
      pad: 'strings_ensemble',
      vocal: 'melody_jpop_anthem',
    },
  },
  chill_ballad: {
    id: 'chill_ballad',
    label: 'チル・バラード',
    shortLabel: 'バラード',
    icon: '🌙',
    desc: 'メロウ・静かな曲・落ちサビ基調',
    recommendedBpm: 86,
    defaultScale: 'Major',
    beatFeel: 'Bounce',
    partDna: {
      drums: 'chill_lofi_ballad',
      bass: 'chill_lofi_ballad',
      keyboard: 'chill_lofi_ballad',
      pad: 'chill_lofi_ambient',
      vocal: 'alt_hypnotic',
      vocalVerse: 'deftones_float',
    },
    defaultPresets: {
      drums: 'rim_chill',
      bass: 'melodic_walk',
      keyboard: 'whole_sustain',
      pad: 'warm_whole',
      vocal: 'melody_ballad',
    },
  },
};

export const MASTER_GENRE_LIST: readonly MasterGenreMeta[] = [
  MASTER_GENRES.alt_shoegaze,
  MASTER_GENRES.emo_jrock,
  MASTER_GENRES.numetal_mixture,
  MASTER_GENRES.royal_jpop,
  MASTER_GENRES.chill_ballad,
];

/**
 * Normalizes any current or legacy genre ID (including removed fusion/funk IDs)
 * to one of the 5 canonical MasterGenreIds for 100% backwards compatibility.
 */
export function normalizeMasterGenreId(raw?: string): MasterGenreId {
  switch ((raw ?? '').trim()) {
    case 'alt_shoegaze':
    case 'alt_heavy_shoegaze':
    case 'alt_heavy_rock':
    case 'shoegaze':
      return 'alt_shoegaze';
    case 'emo_jrock':
    case 'emo_jrock_fast':
    case 'metal3Piece':
      return 'emo_jrock';
    case 'numetal_mixture':
    case 'numetal_electro':
    case 'trapHybrid':
      return 'numetal_mixture';
    case 'chill_ballad':
    case 'chill_lofi_ballad':
    case 'chill_lofi_ambient':
      return 'chill_ballad';
    case 'royal_jpop':
    case 'jpop_melodic':
    case 'jpop_ballad':
    case 'rockBand':
    case 'fusion_funk':
    case 'fusion_crossover':
    case 'slap_funk':
    default:
      return 'royal_jpop';
  }
}
