import {
  getDefaultDrumFillEnabled,
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
import {
  MASTER_GENRES,
  MASTER_GENRE_LIST,
  normalizeMasterGenreId,
  type MasterGenreId,
  type MasterGenreMeta,
} from '../lib/masterGenres';

export type LegacyQuickGenreId =
  | 'alt_heavy_shoegaze'
  | 'fusion_funk'
  | 'chill_lofi_ballad';

export type QuickGenreId = MasterGenreId | LegacyQuickGenreId;

export type QuickSongLengthId = 'short_loop' | 'one_chorus' | 'full_chorus';

export type QuickStructureTemplateId =
  | 'short_ab'
  | 'short_chorus_loop'
  | 'one_half'
  | 'one_standard'
  | 'one_aiko_style'
  | 'full_standard'
  | 'full_chorus_start'
  | 'full_two_chorus'
  | 'full_ballad_60'
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

export type QuickGenreMeta = MasterGenreMeta;

/** Canonical 5 master genres exposed to UI */
export const QUICK_GENRE_META: Record<MasterGenreId, QuickGenreMeta> = MASTER_GENRES;
export const QUICK_GENRE_LIST: readonly QuickGenreMeta[] = MASTER_GENRE_LIST;

export interface StructureSectionSpec {
  type: SectionType;
  name: string;
  bars: number;
  role: 'intro' | 'verse' | 'pre_chorus' | 'chorus' | 'otoshisabi' | 'interlude' | 'outro';
}

export interface QuickStructureTemplate {
  id: QuickStructureTemplateId;
  lengthId: QuickSongLengthId;
  label: string;
  sections: readonly StructureSectionSpec[];
}

export const QUICK_STRUCTURE_TEMPLATES: Record<
  Exclude<QuickStructureTemplateId, 'full_dramatic'>,
  QuickStructureTemplate
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
  one_half: {
    id: 'one_half',
    lengthId: 'one_chorus',
    label: 'ワンハーフ凝縮（約1分30秒）[56小節]',
    sections: [
      { type: 'Intro', name: 'イントロ', bars: 4, role: 'intro' },
      { type: 'Verse', name: 'Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: 'Bメロ', bars: 8, role: 'pre_chorus' },
      { type: 'Chorus', name: 'サビ', bars: 8, role: 'chorus' },
      { type: 'Bridge', name: 'Cメロ', bars: 8, role: 'otoshisabi' },
      { type: 'Chorus', name: 'ラスサビ', bars: 16, role: 'chorus' },
      { type: 'Outro', name: 'アウトロ', bars: 4, role: 'outro' },
    ],
  },
  one_standard: {
    id: 'one_standard',
    lengthId: 'one_chorus',
    label: 'ワンコーラス標準 [28小節]',
    sections: [
      { type: 'Intro', name: 'イントロ', bars: 4, role: 'intro' },
      { type: 'Verse', name: 'Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: 'Bメロ', bars: 4, role: 'pre_chorus' },
      { type: 'Chorus', name: 'サビ', bars: 8, role: 'chorus' },
      { type: 'Outro', name: 'アウトロ', bars: 4, role: 'outro' },
    ],
  },
  one_aiko_style: {
    id: 'one_aiko_style',
    lengthId: 'one_chorus',
    label: 'ワンコーラス大サビ [36小節]',
    sections: [
      { type: 'Intro', name: 'イントロ', bars: 4, role: 'intro' },
      { type: 'Verse', name: 'Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: 'Bメロ', bars: 4, role: 'pre_chorus' },
      { type: 'Chorus', name: '大サビ', bars: 16, role: 'chorus' },
      { type: 'Outro', name: 'アウトロ', bars: 4, role: 'outro' },
    ],
  },
  full_standard: {
    id: 'full_standard',
    lengthId: 'full_chorus',
    label: '標準フル（約2分半・王道2B省略型）[84小節]',
    sections: [
      { type: 'Intro', name: 'イントロ', bars: 8, role: 'intro' },
      { type: 'Verse', name: '1Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: '1Bメロ', bars: 8, role: 'pre_chorus' },
      { type: 'Chorus', name: '1サビ', bars: 8, role: 'chorus' },
      { type: 'Bridge', name: '間奏', bars: 4, role: 'interlude' },
      { type: 'Verse', name: '2Aメロ', bars: 8, role: 'verse' },
      { type: 'Chorus', name: '2サビ', bars: 8, role: 'chorus' },
      { type: 'Bridge', name: 'Cメロ（落ちサビ）', bars: 8, role: 'otoshisabi' },
      { type: 'Chorus', name: 'ラスサビ', bars: 16, role: 'chorus' },
      { type: 'Outro', name: 'アウトロ', bars: 8, role: 'outro' },
    ],
  },
  full_chorus_start: {
    id: 'full_chorus_start',
    lengthId: 'full_chorus',
    label: 'サビ始まり疾走（約2分半）[88小節]',
    sections: [
      { type: 'Chorus', name: 'サビ頭', bars: 8, role: 'chorus' },
      { type: 'Intro', name: 'イントロ', bars: 8, role: 'intro' },
      { type: 'Verse', name: '1Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: '1Bメロ', bars: 8, role: 'pre_chorus' },
      { type: 'Chorus', name: '1サビ', bars: 8, role: 'chorus' },
      { type: 'Verse', name: '2Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: '2Bメロ', bars: 4, role: 'pre_chorus' },
      { type: 'Chorus', name: '2サビ', bars: 8, role: 'chorus' },
      { type: 'Bridge', name: '落ちサビ', bars: 8, role: 'otoshisabi' },
      { type: 'Chorus', name: 'ラスサビ', bars: 16, role: 'chorus' },
      { type: 'Outro', name: 'アウトロ', bars: 4, role: 'outro' },
    ],
  },
  full_two_chorus: {
    id: 'full_two_chorus',
    lengthId: 'full_chorus',
    label: '王道2コーラス完備（約2分45秒）[92小節]',
    sections: [
      { type: 'Intro', name: 'イントロ', bars: 8, role: 'intro' },
      { type: 'Verse', name: '1Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: '1Bメロ', bars: 8, role: 'pre_chorus' },
      { type: 'Chorus', name: '1サビ', bars: 8, role: 'chorus' },
      { type: 'Bridge', name: '間奏', bars: 4, role: 'interlude' },
      { type: 'Verse', name: '2Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: '2Bメロ', bars: 8, role: 'pre_chorus' },
      { type: 'Chorus', name: '2サビ', bars: 8, role: 'chorus' },
      { type: 'Bridge', name: 'Cメロ', bars: 8, role: 'otoshisabi' },
      { type: 'Chorus', name: 'ラスサビ', bars: 16, role: 'chorus' },
      { type: 'Outro', name: 'アウトロ', bars: 8, role: 'outro' },
    ],
  },
  full_ballad_60: {
    id: 'full_ballad_60',
    lengthId: 'full_chorus',
    label: 'バラード専用フル（約2分半）[60小節]',
    sections: [
      { type: 'Intro', name: 'イントロ', bars: 4, role: 'intro' },
      { type: 'Verse', name: '1Aメロ', bars: 8, role: 'verse' },
      { type: 'Pre-Chorus', name: '1Bメロ', bars: 4, role: 'pre_chorus' },
      { type: 'Chorus', name: '1サビ', bars: 8, role: 'chorus' },
      { type: 'Verse', name: '2Aメロ', bars: 8, role: 'verse' },
      { type: 'Chorus', name: '2サビ', bars: 8, role: 'chorus' },
      { type: 'Bridge', name: '落ちサビ', bars: 8, role: 'otoshisabi' },
      { type: 'Chorus', name: 'ラスサビ', bars: 8, role: 'chorus' },
      { type: 'Outro', name: 'アウトロ', bars: 4, role: 'outro' },
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

export function resolveEffectiveStructureTemplate(
  templateId: QuickStructureTemplateId,
  genre: QuickGenreId,
  bpm: number
): QuickStructureTemplate {
  const normalizedGenre = normalizeMasterGenreId(genre);
  const baseTemplate =
    templateId === 'full_dramatic'
      ? QUICK_STRUCTURE_TEMPLATES.full_standard
      : QUICK_STRUCTURE_TEMPLATES[templateId] ?? QUICK_STRUCTURE_TEMPLATES.full_standard;

  if (
    baseTemplate.lengthId === 'full_chorus' &&
    (normalizedGenre === 'chill_ballad' || bpm <= 95)
  ) {
    return QUICK_STRUCTURE_TEMPLATES.full_ballad_60;
  }

  return baseTemplate;
}

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
  genre: MasterGenreId,
  scale: ScaleType,
  role: StructureSectionSpec['role']
): string[] {
  const effectivePreset: QuickChordPresetId =
    chordPreset !== 'auto_by_genre'
      ? chordPreset
      : genre === 'alt_shoegaze' || genre === 'numetal_mixture'
        ? 'alt_floating'
        : genre === 'emo_jrock'
          ? 'emo_driving'
          : 'royal_4536';

  if (scale === 'Minor') {
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
      if (genre === 'chill_ballad') {
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
  genre: MasterGenreId,
  role: StructureSectionSpec['role']
): Record<InstrumentType, string> {
  const isHigh = role === 'chorus';
  const isLow = role === 'intro' || role === 'outro' || role === 'otoshisabi';

  switch (genre) {
    case 'alt_shoegaze':
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
        vocal: role === 'verse' ? 'rap_mixture_flow' : 'rap_linkin_hybrid',
      };
    case 'chill_ballad':
      return {
        drums: isLow ? 'simple_minimal' : 'rim_chill',
        bass: isLow ? 'root_whole' : 'melodic_walk',
        keyboard: isHigh ? 'floating_tension' : 'whole_sustain',
        pad: isHigh ? 'warm_whole' : 'analog_warm_drift',
        vocal: isHigh ? 'melody_deftones_float' : 'melody_alt_hypnotic',
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
  void rng();

  const key = normalizeKeyName(params.keyRoot);
  const scale = normalizeScaleType(params.scaleType);
  const bpm = Math.max(60, Math.min(200, Math.round(params.bpm)));
  const normalizedGenre = normalizeMasterGenreId(params.genre);
  const genreMeta = MASTER_GENRES[normalizedGenre];
  const template = resolveEffectiveStructureTemplate(
    params.structureTemplate,
    normalizedGenre,
    bpm
  );
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
              normalizedGenre,
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
            ? normalizedGenre === 'emo_jrock' || normalizedGenre === 'royal_jpop'
              ? 'Mid'
              : 'Low'
            : 'Low';

    const vocalDensity =
      spec.role === 'intro' || spec.role === 'outro' || spec.role === 'interlude'
        ? 1.0
        : spec.role === 'otoshisabi'
          ? 2.2
          : spec.role === 'verse'
            ? normalizedGenre === 'numetal_mixture' || normalizedGenre === 'emo_jrock'
              ? 3.2
              : 2.6
            : spec.role === 'pre_chorus'
              ? 3.1
              : 3.8;

    const presets = resolveSectionPresetsForGenre(normalizedGenre, spec.role);
    const isIntroOrOutro =
      spec.role === 'intro' || spec.role === 'outro' || spec.role === 'interlude';

    return {
      id: `qs-sec-${seed}-${idx}`,
      type: spec.type,
      name: spec.name,
      bars: spec.bars,
      energy,
      kickMode: normalizedGenre === 'numetal_mixture' ? '808' : 'acoustic',
      drumAnticipationMode: 'sync',
      drumHat16thEnabled: false,
      drumFillEnabled: getDefaultDrumFillEnabled(spec.type, spec.bars),
      drumBreakEnabled: false,
      hatDensity: energy === 'High' ? 4 : energy === 'Mid' ? 3 : 2,
      kickDensity: energy === 'High' ? 4 : 3,
      keyboardDensity: energy === 'High' ? 5 : 4,
      vocalDensity,
      vocalHarmony: spec.role === 'chorus' ? 'upper_3rd' : 'off',
      bassChromaticEnabled:
        normalizedGenre === 'alt_shoegaze' || normalizedGenre === 'numetal_mixture',
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

  const defaultPresets = resolveSectionPresetsForGenre(normalizedGenre, 'chorus');

  return {
    title: `${genreMeta.label} (${key} ${scale})`,
    bpm,
    key,
    scale,
    timeSignature: '4/4',
    beatFeel: genreMeta.beatFeel,
    swing: normalizedGenre === 'chill_ballad' ? 14 : 0,
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
