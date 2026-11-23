import {
  type ChordSlot,
  type EnergyLevel,
  type InstrumentType,
  type KeyName,
  type ScaleType,
  type Section,
  type SectionType,
  type SongConfig,
} from '../types/song';
import { shiftChordBoundary } from '../lib/chordTimeline';
import {
  noteNameToSemitone,
  parseChord,
  semitoneToKeyName,
  transposeChords,
} from '../lib/chordUtils';

export type QuickGenreId =
  | 'alt_heavy_shoegaze'
  | 'emo_jrock'
  | 'royal_jpop'
  | 'numetal_mixture'
  | 'fusion_funk'
  | 'chill_lofi_ballad';

export type QuickSongLengthId = 'short_loop' | 'one_chorus' | 'full_chorus';

export type QuickStructureTemplateId =
  | 'short_ab'
  | 'short_chorus_loop'
  | 'one_standard'
  | 'one_aiko_style'
  | 'full_standard'
  | 'full_dramatic';

export type QuickChordPresetId =
  | 'auto_by_genre'
  | 'royal_4536'
  | 'komuro_6451'
  | 'canon_15634145'
  | 'alt_floating'
  | 'emo_driving'
  | 'custom';

export interface QuickSongSetupParams {
  keyRoot: string;
  scaleType: string;
  bpm: number;
  genre: QuickGenreId;
  songLength: QuickSongLengthId;
  structureTemplate: QuickStructureTemplateId;
  chordPreset: QuickChordPresetId;
  customChordsText?: string;
  includeAnticipation?: boolean;
}

export interface QuickGenreMeta {
  id: QuickGenreId;
  label: string;
  icon: string;
  desc: string;
  recommendedBpm: number;
  defaultScale: ScaleType;
  beatFeel: SongConfig['beatFeel'];
}

export const QUICK_GENRE_META: Record<QuickGenreId, QuickGenreMeta> = {
  alt_heavy_shoegaze: {
    id: 'alt_heavy_shoegaze',
    label: 'オルタナ / シューゲイザー',
    icon: '🌊',
    desc: '重厚ハーフタイム + 浮遊9th空間',
    recommendedBpm: 118,
    defaultScale: 'Minor',
    beatFeel: 'Half-Time',
  },
  emo_jrock: {
    id: 'emo_jrock',
    label: '疾走エモ / J-ROCK',
    icon: '⚡',
    desc: 'ツービート疾走 + 食い込みドライブ',
    recommendedBpm: 168,
    defaultScale: 'Major',
    beatFeel: 'Driving',
  },
  royal_jpop: {
    id: 'royal_jpop',
    label: '王道 J-POP / メロディック',
    icon: '✨',
    desc: 'キャッチー歌メロ + 王道バンド編成',
    recommendedBpm: 132,
    defaultScale: 'Major',
    beatFeel: 'Straight',
  },
  numetal_mixture: {
    id: 'numetal_mixture',
    label: 'ニューメタル / ミクスチャー',
    icon: '🔥',
    desc: 'ラップフロウ + ヘヴィリフ刻み',
    recommendedBpm: 105,
    defaultScale: 'Minor',
    beatFeel: 'Half-Time',
  },
  fusion_funk: {
    id: 'fusion_funk',
    label: 'フュージョン / ファンク',
    icon: '🎷',
    desc: '16分スラップ + 9th/13thコンピング',
    recommendedBpm: 124,
    defaultScale: 'Minor',
    beatFeel: 'Bounce',
  },
  chill_lofi_ballad: {
    id: 'chill_lofi_ballad',
    label: 'チル / ローファイバラード',
    icon: '🌙',
    desc: 'レイドバック + 温かみのある空間',
    recommendedBpm: 84,
    defaultScale: 'Major',
    beatFeel: 'Bounce',
  },
};

interface StructureSectionSpec {
  type: SectionType;
  name: string;
  bars: number;
  role: 'intro' | 'verse' | 'pre_chorus' | 'chorus' | 'otoshisabi' | 'interlude' | 'outro';
}

export const QUICK_STRUCTURE_TEMPLATES: Record<
  QuickStructureTemplateId,
  {
    id: QuickStructureTemplateId;
    lengthId: QuickSongLengthId;
    label: string;
    sections: readonly StructureSectionSpec[];
  }
> = {
  short_ab: {
    id: 'short_ab',
    lengthId: 'short_loop',
    label: 'Aメロ(8) → サビ(8) [16小節]',
    sections: [
      { type: 'Verse', name: 'Aメロ', bars: 8, role: 'verse' },
      { type: 'Chorus', name: 'サビ', bars: 8, role: 'chorus' },
    ],
  },
  short_chorus_loop: {
    id: 'short_chorus_loop',
    lengthId: 'short_loop',
    label: 'サビ(8)ループ [8小節]',
    sections: [{ type: 'Chorus', name: 'サビ', bars: 8, role: 'chorus' }],
  },
  one_standard: {
    id: 'one_standard',
    lengthId: 'one_chorus',
    label: 'Intro(4) → A(8) → B(4) → サビ(8) → Outro(4) [28小節]',
    sections: [
      { type: 'Intro', name: 'Intro', bars: 4, role: 'intro' },
      { type: 'Verse', name: 'Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: 'Bメロ', bars: 4, role: 'pre_chorus' },
      { type: 'Chorus', name: 'サビ', bars: 8, role: 'chorus' },
      { type: 'Outro', name: 'Outro', bars: 4, role: 'outro' },
    ],
  },
  one_aiko_style: {
    id: 'one_aiko_style',
    lengthId: 'one_chorus',
    label: 'Intro(4) → A(8) → B(4) → 大サビ(16) → Outro(4) [36小節]',
    sections: [
      { type: 'Intro', name: 'Intro', bars: 4, role: 'intro' },
      { type: 'Verse', name: 'Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: 'Bメロ', bars: 4, role: 'pre_chorus' },
      { type: 'Chorus', name: '大サビ', bars: 16, role: 'chorus' },
      { type: 'Outro', name: 'Outro', bars: 4, role: 'outro' },
    ],
  },
  full_standard: {
    id: 'full_standard',
    lengthId: 'full_chorus',
    label: 'フル標準 [56小節]',
    sections: [
      { type: 'Intro', name: 'Intro', bars: 4, role: 'intro' },
      { type: 'Verse', name: '1Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: '1Bメロ', bars: 4, role: 'pre_chorus' },
      { type: 'Chorus', name: '1サビ', bars: 8, role: 'chorus' },
      { type: 'Bridge', name: '間奏', bars: 4, role: 'interlude' },
      { type: 'Verse', name: '2Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: '2Bメロ', bars: 4, role: 'pre_chorus' },
      { type: 'Chorus', name: '大サビ', bars: 12, role: 'chorus' },
      { type: 'Outro', name: 'Outro', bars: 4, role: 'outro' },
    ],
  },
  full_dramatic: {
    id: 'full_dramatic',
    lengthId: 'full_chorus',
    label: 'フルドラマチック（落ちサビ付）[60小節]',
    sections: [
      { type: 'Intro', name: 'Intro', bars: 4, role: 'intro' },
      { type: 'Verse', name: '1Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: '1Bメロ', bars: 4, role: 'pre_chorus' },
      { type: 'Chorus', name: '1サビ', bars: 8, role: 'chorus' },
      { type: 'Bridge', name: '間奏', bars: 4, role: 'interlude' },
      { type: 'Verse', name: '2Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: '2Bメロ', bars: 4, role: 'pre_chorus' },
      { type: 'Bridge', name: '落ちサビ', bars: 4, role: 'otoshisabi' },
      { type: 'Chorus', name: '大サビ', bars: 12, role: 'chorus' },
      { type: 'Outro', name: 'Outro', bars: 4, role: 'outro' },
    ],
  },
};

export const QUICK_CHORD_PRESETS: Array<{ id: QuickChordPresetId; label: string }> = [
  { id: 'auto_by_genre', label: 'スタイルにおまかせ' },
  { id: 'royal_4536', label: '王道進行 (IV-V-IIIm-VIm)' },
  { id: 'komuro_6451', label: '小室進行 (VIm-IV-V-I)' },
  { id: 'canon_15634145', label: 'カノン進行 (I-V-VIm-IIIm...)' },
  { id: 'alt_floating', label: 'オルタナ浮遊 (Im7-bVI-bIII-bVII)' },
  { id: 'emo_driving', label: 'エモ疾走 (IV-I-V-VIm)' },
  { id: 'custom', label: 'カスタム入力' },
];

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeKeyName(raw: string): KeyName {
  const map: Record<string, KeyName> = {
    Db: 'C#',
    Eb: 'D#',
    Gb: 'F#',
    Ab: 'G#',
    Bb: 'A#',
  };
  const trimmed = raw.trim();
  if (trimmed in map) return map[trimmed];
  return semitoneToKeyName(noteNameToSemitone(trimmed));
}

export function normalizeScaleType(raw: string): ScaleType {
  return raw.toLowerCase().includes('minor') ? 'Minor' : 'Major';
}

function parseCustomChords(text: string | undefined): string[] {
  if (!text) return [];
  const tokens = text
    .split(/[\s,|/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const valid: string[] = [];
  for (const tok of tokens) {
    try {
      parseChord(tok);
      valid.push(tok);
    } catch {
      // Ignore invalid token
    }
  }
  return valid;
}

function resolveBaseChordsInC(
  chordPreset: QuickChordPresetId,
  genre: QuickGenreId,
  scale: ScaleType,
  role: StructureSectionSpec['role']
): string[] {
  const effectivePreset: QuickChordPresetId =
    chordPreset !== 'auto_by_genre'
      ? chordPreset
      : genre === 'alt_heavy_shoegaze' || genre === 'numetal_mixture'
        ? 'alt_floating'
        : genre === 'emo_jrock'
          ? 'emo_driving'
          : genre === 'fusion_funk'
            ? 'royal_4536'
            : genre === 'chill_lofi_ballad'
              ? 'royal_4536'
              : 'royal_4536';

  if (scale === 'Minor') {
    // Base progressions in C Minor (C=0, Eb=3, F=5, G=7, Ab=8, Bb=10)
    switch (effectivePreset) {
      case 'komuro_6451':
        return role === 'verse'
          ? ['Cm7', 'Abmaj7', 'Bb', 'Gm7']
          : ['Abmaj7', 'Bb', 'Gm7', 'Cm7'];
      case 'canon_15634145':
        return ['Cm', 'Gm', 'Ab', 'Eb', 'Fm', 'Cm', 'Fm', 'G7'];
      case 'alt_floating':
        return role === 'verse'
          ? ['Cm7', 'Cm7', 'Abmaj7', 'Bbsus4']
          : ['Cm7', 'Abmaj7', 'Ebmaj7', 'Bb'];
      case 'emo_driving':
        return role === 'verse'
          ? ['Cm', 'Ab', 'Eb', 'Bb']
          : ['Ab', 'Eb', 'Bb', 'Cm'];
      case 'royal_4536':
      default:
        return role === 'verse'
          ? ['Cm7', 'Fm7', 'Abmaj7', 'G7']
          : ['Fm7', 'Bb7', 'Ebmaj7', 'Abmaj7'];
    }
  }

  // Base progressions in C Major
  switch (effectivePreset) {
    case 'komuro_6451':
      return role === 'verse' ? ['Am7', 'F', 'G', 'C'] : ['Am', 'F', 'G', 'C'];
    case 'canon_15634145':
      return ['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G'];
    case 'alt_floating':
      return role === 'verse'
        ? ['Am7', 'Am7', 'Fmaj7', 'Gsus4']
        : ['Fmaj7', 'G6', 'Am9', 'C'];
    case 'emo_driving':
      return role === 'verse' ? ['Am', 'F', 'C', 'G'] : ['F', 'C', 'G', 'Am'];
    case 'royal_4536':
    default:
      if (genre === 'fusion_funk') {
        return role === 'verse'
          ? ['Dm9', 'G13', 'Em7', 'A7']
          : ['Fmaj7', 'G6', 'Em7', 'Am9'];
      }
      if (genre === 'chill_lofi_ballad') {
        return role === 'verse'
          ? ['Cmaj7', 'Am7', 'Dm9', 'G7']
          : ['Fmaj7', 'G6', 'Em7', 'Am9'];
      }
      return role === 'verse'
        ? ['C', 'G', 'Am', 'F']
        : ['F', 'G', 'Em', 'Am'];
  }
}

function buildDeterministicChordTimeline(
  chords: readonly string[],
  bars: number,
  secIdx: number,
  seed: number
): ChordSlot[] {
  const safeChords = chords.length > 0 ? chords : ['C', 'G', 'Am', 'F'];
  const slots: ChordSlot[] = [];
  for (let b = 0; b < bars; b++) {
    slots.push({
      id: `qs-slot-${seed}-${secIdx}-${b}`,
      chord: safeChords[b % safeChords.length],
      startBeat: b * 4,
      durationBeats: 4,
    });
  }
  return slots;
}

function resolveSectionPresetsForGenre(
  genre: QuickGenreId,
  role: StructureSectionSpec['role']
): Record<InstrumentType, string> {
  const isHigh = role === 'chorus';
  const isLow = role === 'intro' || role === 'outro' || role === 'otoshisabi';

  switch (genre) {
    case 'alt_heavy_shoegaze':
      return {
        drums: isHigh ? 'halftime_heavy' : isLow ? 'simple_minimal' : 'breakdown_heavy',
        bass: isLow ? 'root_whole' : 'auto',
        keyboard: isHigh ? 'floating_tension' : 'whole_sustain',
        pad: isHigh ? 'floating_9th' : 'fifth_drone',
        vocal: isHigh ? 'melody_deftones_float' : 'melody_alt_hypnotic',
      };
    case 'emo_jrock':
      return {
        drums: isHigh ? 'rock_drive' : isLow ? 'simple_minimal' : 'straight_8',
        bass: role === 'pre_chorus' || isHigh ? 'jrock_anticipation' : 'root_steady',
        keyboard: isHigh ? 'chord_eighth' : 'emo_arp_cascade',
        pad: isHigh ? 'high_shimmer' : 'octave_layer',
        vocal: isHigh ? 'melody_posthc_leap' : 'melody_jrock_drive',
      };
    case 'numetal_mixture':
      return {
        drums: isHigh ? 'breakdown_heavy' : isLow ? 'trap_sparse' : 'trap_active',
        bass: isHigh ? 'metal_gallop' : 'sub_808_glide',
        keyboard: isHigh ? 'rock_power_riff' : 'dark_low_riff',
        pad: isHigh ? 'sidechain_pulse' : 'dark_cinematic',
        vocal: role === 'verse' ? 'rap_mixture_flow' : 'melody_posthc_leap',
      };
    case 'fusion_funk':
      return {
        drums: isHigh ? 'straight_16' : 'four_on_floor',
        bass: isHigh ? 'slap_funk' : 'syncopated_groove',
        keyboard: isHigh ? 'fusion_ep_comp' : 'funk_16th_clav',
        pad: isHigh ? 'choir_open_voicing' : 'floating_9th',
        vocal: isHigh ? 'melody_jpop_anthem' : 'melody_syncopated_hook',
      };
    case 'chill_lofi_ballad':
      return {
        drums: isLow ? 'simple_minimal' : 'rim_chill',
        bass: isLow ? 'root_whole' : 'melodic_walk',
        keyboard: isHigh ? 'floating_tension' : 'whole_sustain',
        pad: isHigh ? 'warm_whole' : 'analog_warm_drift',
        vocal: isHigh ? 'melody_ballad' : 'melody_ballad_breath',
      };
    case 'royal_jpop':
    default:
      return {
        drums: isLow ? 'simple_minimal' : 'straight_8',
        bass: isHigh ? 'kick_lock' : 'melodic_walk',
        keyboard: isHigh ? 'syncopated_comp' : 'broken_chord',
        pad: isHigh ? 'strings_ensemble' : 'warm_whole',
        vocal: 'melody_jpop_anthem',
      };
  }
}

export function buildSongFromQuickSetup(
  params: QuickSongSetupParams,
  seed = 1000
): SongConfig {
  const rng = mulberry32(seed);
  void rng(); // Consume deterministically so seed variations can branch cleanly if needed

  const key = normalizeKeyName(params.keyRoot);
  const scale = normalizeScaleType(params.scaleType);
  const bpm = Math.max(60, Math.min(200, Math.round(params.bpm)));
  const genreMeta = QUICK_GENRE_META[params.genre];
  const template = QUICK_STRUCTURE_TEMPLATES[params.structureTemplate];
  const includeAnticipation = params.includeAnticipation ?? true;

  const customChords =
    params.chordPreset === 'custom'
      ? parseCustomChords(params.customChordsText)
      : [];
  const semitoneShift = noteNameToSemitone(key);

  const sections: Section[] = template.sections.map((spec, idx) => {
    const baseChordsInC =
      customChords.length > 0
        ? customChords
        : transposeChords(
            resolveBaseChordsInC(
              params.chordPreset,
              params.genre,
              scale,
              spec.role
            ),
            semitoneShift
          );

    let chords = buildDeterministicChordTimeline(
      baseChordsInC,
      spec.bars,
      idx,
      seed
    );

    if (
      includeAnticipation &&
      spec.role === 'pre_chorus' &&
      chords.length >= 2
    ) {
      chords = shiftChordBoundary(chords, chords.length - 1, -0.5);
    }

    const energy: EnergyLevel =
      spec.role === 'chorus'
        ? 'High'
        : spec.role === 'pre_chorus' || spec.role === 'interlude'
          ? 'Mid'
          : spec.role === 'verse'
            ? params.genre === 'emo_jrock' || params.genre === 'fusion_funk'
              ? 'Mid'
              : 'Low'
            : 'Low';

    const vocalDensity =
      spec.role === 'intro' || spec.role === 'outro' || spec.role === 'interlude'
        ? 1.0
        : spec.role === 'otoshisabi'
          ? 2.2
          : spec.role === 'verse'
            ? params.genre === 'numetal_mixture' || params.genre === 'emo_jrock'
              ? 3.2
              : 2.6
            : spec.role === 'pre_chorus'
              ? 3.1
              : 3.8;

    const presets = resolveSectionPresetsForGenre(params.genre, spec.role);
    const isIntroOrOutro = spec.role === 'intro' || spec.role === 'outro' || spec.role === 'interlude';

    return {
      id: `qs-sec-${seed}-${idx}`,
      type: spec.type,
      name: spec.name,
      bars: spec.bars,
      energy,
      kickMode: params.genre === 'numetal_mixture' ? '808' : 'acoustic',
      drumAnticipationMode: 'sync',
      hatDensity: energy === 'High' ? 4 : energy === 'Mid' ? 3 : 2,
      kickDensity: energy === 'High' ? 4 : 3,
      keyboardDensity: energy === 'High' ? 5 : 4,
      vocalDensity,
      vocalHarmony: spec.role === 'chorus' ? 'upper_3rd' : 'off',
      bassChromaticEnabled:
        params.genre === 'fusion_funk' ||
        params.genre === 'alt_heavy_shoegaze' ||
        params.genre === 'numetal_mixture',
      bassFillEnabled: spec.role === 'pre_chorus' || spec.role === 'chorus',
      bassFillSeed: seed + idx,
      patternPresets: { ...presets },
      partPresets: { ...presets },
      chords,
      enabledParts: {
        drums: true,
        bass: true,
        keyboard: true,
        pad: true,
        vocal: !isIntroOrOutro,
      },
    };
  });

  const defaultPresets = resolveSectionPresetsForGenre(params.genre, 'chorus');

  return {
    title: `${genreMeta.label} (${key} ${scale})`,
    bpm,
    key,
    scale,
    timeSignature: '4/4',
    beatFeel: genreMeta.beatFeel,
    swing: params.genre === 'fusion_funk' || params.genre === 'chill_lofi_ballad' ? 16 : 0,
    swingTarget: '8th',
    exportOnlyActiveTracks: true,
    split808KickTrack: true,
    members: {
      drums: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: defaultPresets.drums,
        drumStyle: 'Standard',
        instructionText: '',
      },
      bass: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: defaultPresets.bass,
        bassStyle: 'Root Sync',
        bass808Behavior: 'octaveUp',
        instructionText: '',
      },
      keyboard: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: defaultPresets.keyboard,
        keyboardStyle: 'Rhythm Backing',
        instructionText: '',
      },
      pad: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: defaultPresets.pad,
        padStyle: 'Power',
        instructionText: '',
      },
      vocal: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: defaultPresets.vocal,
        instructionText: '',
      },
    },
    sections,
  };
}
