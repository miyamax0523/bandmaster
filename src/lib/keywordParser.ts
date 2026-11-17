import type { ResolvedInstrumentParams } from '../engines/types';
import type {
  InstrumentType,
  Section,
  SongConfig,
  TakeStyle,
} from '../types/song';

interface KeywordGroup {
  triggers: readonly string[];
  label: string;
}

export const KEYWORD_GROUPS: readonly KeywordGroup[] = [
  {
    triggers: ['ツーバス', 'パワーメタル', 'double kick', '激しい'],
    label: 'ツーバス/激しい',
  },
  {
    triggers: ['四つ打ち', 'ダンス', '裏打ち', 'four'],
    label: '四つ打ち',
  },
  {
    triggers: ['ハーフ', '重く', 'ヘヴィ', 'heavy', 'half'],
    label: 'ハーフ/ヘヴィ',
  },
  {
    triggers: ['トラップ', 'ロール', 'サブステップ', 'trap', 'flam'],
    label: 'トラップ/ロール',
  },
  {
    triggers: ['オクターブ', 'スラップ', '動く', 'メロディアス'],
    label: 'オクターブ/動く',
  },
  {
    triggers: ['タイト', 'シンプル', '抑える', '静か'],
    label: 'タイト/抑える',
  },
  {
    triggers: [
      '浮遊',
      'シューゲイザー',
      '空間',
      'エモい',
      'deftones',
      'radiohead',
    ],
    label: '浮遊/空間系',
  },
  {
    triggers: ['ユニゾン', 'リフ重視'],
    label: 'ユニゾン/リフ重視',
  },
];

export function extractMatchedKeywords(instructionText: string): string[] {
  const lower = instructionText.toLowerCase();
  const matched: string[] = [];
  for (const group of KEYWORD_GROUPS) {
    for (const trig of group.triggers) {
      if (lower.includes(trig.toLowerCase())) {
        matched.push(trig);
      }
    }
  }
  return matched;
}

function getBaseTakeDefaults(style: TakeStyle) {
  switch (style) {
    case 'A':
      return {
        humanizeTicks: 6,
        velocityJitter: 8,
        fillNoteRange: { min: 4, max: 7 },
        kickSyncRate: 0.8,
        octaveProb: 0.25,
        passingProb: 0.25,
      };
    case 'B':
      return {
        humanizeTicks: 2,
        velocityJitter: 4,
        fillNoteRange: { min: 2, max: 3 },
        kickSyncRate: 0.95,
        octaveProb: 0.05,
        passingProb: 0.05,
      };
    case 'C':
      return {
        humanizeTicks: 8,
        velocityJitter: 14,
        fillNoteRange: { min: 8, max: 16 },
        kickSyncRate: 0.7,
        octaveProb: 0.6,
        passingProb: 0.6,
      };
  }
}

/**
 * Resolves parameters with strict priority:
 * keywordParser > PlayStyle > BeatFeel > Section.energy
 */
export function resolveInstrumentParams(
  song: SongConfig,
  section: Section,
  instrument: InstrumentType,
  style: TakeStyle
): ResolvedInstrumentParams {
  const takeDefaults = getBaseTakeDefaults(style);
  const member = song.members[instrument];

  const params: ResolvedInstrumentParams = {
    humanizeTicks: takeDefaults.humanizeTicks,
    velocityJitter: takeDefaults.velocityJitter,
    velocityCap: 127,
    velocityBoost: 0,
    fillNoteRange: { ...takeDefaults.fillNoteRange },
    forceRiffStrictUnison: false,

    kickPattern: 'standard',
    doubleKickProb: 0,
    snareHalfTime: false,
    hatSubdivision: 1,
    flamEnabled: false,
    offbeatOpenHat: false,

    rangeMin: 28,
    rangeMax: 55,
    barHeadRootMin: 28,
    barHeadRootMax: 39,
    kickSyncRate: takeDefaults.kickSyncRate,
    octaveProb: takeDefaults.octaveProb,
    passingProb: takeDefaults.passingProb,
    forcePassingFill: false,

    add9: false,
    add7: false,
    sus2: false,
    voicingMin: instrument === 'keyboard' ? 60 : 48,
    voicingMax: instrument === 'keyboard' ? 84 : 76,

    matchedKeywords: [],
  };

  // 1. Section.energy (lowest priority among overrides)
  if (section.energy === 'Low') {
    params.velocityCap = 105;
    params.doubleKickProb = 0;
  } else if (section.energy === 'High') {
    params.velocityBoost = 6;
    params.doubleKickProb = 0.2;
  }

  // 2. Song.beatFeel
  if (song.beatFeel === 'Half-Time') {
    params.snareHalfTime = true;
    params.kickPattern = 'standard';
  } else if (song.beatFeel === 'Bounce') {
    params.kickPattern = 'syncopated';
  } else if (song.beatFeel === 'Driving') {
    params.kickPattern = 'standard';
    params.doubleKickProb = Math.max(params.doubleKickProb, 0.25);
  } else {
    params.kickPattern = 'standard';
    params.snareHalfTime = false;
  }

  // 3. Instrument PlayStyle
  if (instrument === 'drums') {
    switch (member.drumStyle) {
      case 'Four-on-the-Floor':
        params.kickPattern = 'fourOnFloor';
        params.offbeatOpenHat = true;
        params.snareHalfTime = false;
        break;
      case 'Heavy / Half-Time':
        params.snareHalfTime = true;
        params.kickPattern = 'standard';
        break;
      case 'Double Kick':
        params.doubleKickProb = Math.max(params.doubleKickProb, 0.7);
        break;
      case 'Sub-Step / Trap':
        params.hatSubdivision = 4;
        params.flamEnabled = true;
        break;
      case 'Standard':
      default:
        break;
    }
  } else if (instrument === 'bass') {
    switch (member.bassStyle) {
      case 'Root Sync':
        params.octaveProb = Math.min(params.octaveProb, 0.1);
        params.passingProb = Math.min(params.passingProb, 0.1);
        break;
      case 'Driving 8th':
        params.kickSyncRate = Math.max(params.kickSyncRate, 0.85);
        break;
      case 'Octave / Melodic':
        params.octaveProb = Math.min(1.0, params.octaveProb + 0.35);
        params.forcePassingFill = true;
        break;
      case 'Minimal':
        params.octaveProb = 0;
        params.passingProb = 0;
        params.kickSyncRate = 1.0;
        break;
      default:
        break;
    }
  } else if (instrument === 'pad') {
    switch (member.padStyle) {
      case 'Floating Tension':
        params.add9 = true;
        params.add7 = true;
        params.sus2 = true;
        params.voicingMin = 48;
        params.voicingMax = 76;
        break;
      case 'Dark Ambient':
        params.voicingMin = 48;
        params.voicingMax = 67;
        break;
      case 'Power':
      default:
        params.voicingMin = 48;
        params.voicingMax = 76;
        break;
    }
  }

  // 4. Natural Language Keyword Dictionary (highest priority)
  const text = (member.instructionText ?? '').toLowerCase();
  const matched = extractMatchedKeywords(member.instructionText ?? '');
  params.matchedKeywords = matched;

  const hasAny = (triggers: readonly string[]) =>
    triggers.some((t) => text.includes(t.toLowerCase()));

  if (hasAny(['ツーバス', 'パワーメタル', 'double kick', '激しい'])) {
    params.doubleKickProb = Math.min(1.0, params.doubleKickProb + 0.5);
    params.velocityBoost = 12;
  }

  if (hasAny(['四つ打ち', 'ダンス', '裏打ち', 'four'])) {
    params.kickPattern = 'fourOnFloor';
    params.offbeatOpenHat = true;
  }

  const is808OctaveUp =
    section.kickMode === '808' &&
    (song.members.bass.bass808Behavior ?? 'octaveUp') === 'octaveUp';

  if (hasAny(['ハーフ', '重く', 'ヘヴィ', 'heavy', 'half'])) {
    params.snareHalfTime = true;
    if (!(instrument === 'bass' && is808OctaveUp)) {
      params.rangeMax = 43;
    }
  }

  if (hasAny(['トラップ', 'ロール', 'サブステップ', 'trap', 'flam'])) {
    params.hatSubdivision = 4;
    params.flamEnabled = true;
  }

  if (hasAny(['オクターブ', 'スラップ', '動く', 'メロディアス'])) {
    params.octaveProb = Math.min(1.0, params.octaveProb + 0.45);
    params.forcePassingFill = true;
  }

  if (hasAny(['タイト', 'シンプル', '抑える', '静か'])) {
    params.fillNoteRange = {
      min: takeDefaults.fillNoteRange.min,
      max: takeDefaults.fillNoteRange.min,
    };
    params.velocityCap = 95;
  }

  if (
    hasAny([
      '浮遊',
      'シューゲイザー',
      '空間',
      'エモい',
      'deftones',
      'radiohead',
    ])
  ) {
    params.add9 = true;
    params.add7 = true;
    params.sus2 = true;
  }

  if (hasAny(['ユニゾン', 'リフ重視'])) {
    params.kickSyncRate = 1.0;
    params.passingProb = 0;
    params.forceRiffStrictUnison = true;
  }

  // Enforce 808 octaveUp Bass range priority over Half-Time 43 cap
  if (instrument === 'bass' && is808OctaveUp) {
    params.rangeMin = 40;
    params.rangeMax = 55;
    params.barHeadRootMin = 40;
    params.barHeadRootMax = 51;
  }

  return params;
}
