import {
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type AccompanimentTake,
  type KeyName,
  type MidiControlChangeEvent,
  type MidiNote,
  type PadSkeletonId,
  type ScaleType,
} from '../types/song';
import {
  getActiveChordAtTick,
  getTimelineBoundaryChanges,
} from '../lib/chordTimeline';
import {
  fitPitchClassToRange,
  getScalePitchClasses,
  noteNameToSemitone,
  resolveChordForBar,
  type ParsedChord,
} from '../lib/chordUtils';
import {
  buildChordWindows,
  clamp as clampCore,
  getParsedChordPitchClasses,
  resolveSmoothVoicing,
  sanitizeTrackNotes,
} from './musicCore';
import {
  resolveEnsembleSyncPlan,
  type EnsembleSyncPlan,
} from './ensembleSync';
import type { EngineInput } from './types';

export const TPQN = 480;
export const BEAT_TICKS = 480;
export const BAR_TICKS = 1920;
export const EIGHTH_TICKS = 240;
export const SIXTEENTH_TICKS = 120;
export const MIN_SAME_PITCH_GAP = 12;

export type PadGenreDnaId =
  | 'alt_shoegaze'
  | 'emo_jrock'
  | 'jpop_ballad'
  | 'numetal_electro'
  | 'fusion_crossover'
  | 'chill_lofi_ambient';

export type PadEnergyLevel = 'low' | 'mid' | 'high';

export type PadVoicingStyle =
  | 'open_5th_9th'
  | 'drop2'
  | 'drop3'
  | 'drop2_4'
  | 'quartal_shell'
  | 'octave_9th';

export type PedalStrategy = 'inverted' | 'internal' | 'double_1_5' | 'minimal';

export interface PadGenreDnaProfile {
  id: PadGenreDnaId;
  preferredVoicing: PadVoicingStyle;
  voiceCountByEnergy: Record<PadEnergyLevel, number>;
  range: { minMidi: number; maxMidi: number };
  velocityRange: { min: number; max: number };
  omitThirdBias: number;
  omitFifthBias: number;
  tensionWeights: {
    add9: number;
    maj7: number;
    sus2: number;
    sus4: number;
    sixth: number;
    eleventh: number;
    sharp11: number;
    thirteenth: number;
  };
  pedalStrategy: PedalStrategy;
  pedalWeight: number;
  guideToneWeight: number;
  tieCommonTones: boolean;
  followAnticipation: boolean;
  phraseCrescendoGain: number;
}

export interface ExternalNoteRef {
  pitch: number;
  startTick: number;
  durationTick: number;
  velocity?: number;
}

export interface PadGenerationContext {
  vocalNotes?: ExternalNoteRef[];
  keyboardNotes?: ExternalNoteRef[];
  bassNotes?: ExternalNoteRef[];
  prevVocalAvgPitch?: number;
  genreDna?: PadGenreDnaId;
  energy?: PadEnergyLevel;
  sectionType?: 'intro' | 'verse' | 'pre_chorus' | 'chorus' | 'bridge' | 'outro' | string;
  seed?: number;
  bpm?: number;
}

export const PAD_GENRE_DNA_PROFILES: Record<PadGenreDnaId, PadGenreDnaProfile> = {
  alt_shoegaze: {
    id: 'alt_shoegaze',
    preferredVoicing: 'open_5th_9th',
    voiceCountByEnergy: { low: 2, mid: 3, high: 4 },
    range: { minMidi: 55, maxMidi: 81 },
    velocityRange: { min: 52, max: 74 },
    omitThirdBias: 0.65,
    omitFifthBias: 0.35,
    tensionWeights: {
      add9: 0.85,
      maj7: 0.4,
      sus2: 0.75,
      sus4: 0.45,
      sixth: 0.15,
      eleventh: 0.35,
      sharp11: 0.3,
      thirteenth: 0.1,
    },
    pedalStrategy: 'inverted',
    pedalWeight: 1.8,
    guideToneWeight: 0.8,
    tieCommonTones: true,
    followAnticipation: true,
    phraseCrescendoGain: 4,
  },
  emo_jrock: {
    id: 'emo_jrock',
    preferredVoicing: 'octave_9th',
    voiceCountByEnergy: { low: 2, mid: 3, high: 4 },
    range: { minMidi: 55, maxMidi: 79 },
    velocityRange: { min: 50, max: 78 },
    omitThirdBias: 0.45,
    omitFifthBias: 0.4,
    tensionWeights: {
      add9: 0.9,
      maj7: 0.55,
      sus2: 0.6,
      sus4: 0.5,
      sixth: 0.2,
      eleventh: 0.3,
      sharp11: 0.2,
      thirteenth: 0.15,
    },
    pedalStrategy: 'double_1_5',
    pedalWeight: 1.4,
    guideToneWeight: 1.1,
    tieCommonTones: true,
    followAnticipation: true,
    phraseCrescendoGain: 6,
  },
  jpop_ballad: {
    id: 'jpop_ballad',
    preferredVoicing: 'drop2',
    voiceCountByEnergy: { low: 2, mid: 3, high: 4 },
    range: { minMidi: 55, maxMidi: 79 },
    velocityRange: { min: 50, max: 76 },
    omitThirdBias: 0.15,
    omitFifthBias: 0.55,
    tensionWeights: {
      add9: 0.8,
      maj7: 0.75,
      sus2: 0.35,
      sus4: 0.45,
      sixth: 0.3,
      eleventh: 0.35,
      sharp11: 0.25,
      thirteenth: 0.3,
    },
    pedalStrategy: 'internal',
    pedalWeight: 1.2,
    guideToneWeight: 1.5,
    tieCommonTones: true,
    followAnticipation: true,
    phraseCrescendoGain: 5,
  },
  numetal_electro: {
    id: 'numetal_electro',
    preferredVoicing: 'drop3',
    voiceCountByEnergy: { low: 2, mid: 3, high: 4 },
    range: { minMidi: 57, maxMidi: 81 },
    velocityRange: { min: 52, max: 78 },
    omitThirdBias: 0.55,
    omitFifthBias: 0.45,
    tensionWeights: {
      add9: 0.7,
      maj7: 0.35,
      sus2: 0.65,
      sus4: 0.5,
      sixth: 0.15,
      eleventh: 0.4,
      sharp11: 0.2,
      thirteenth: 0.1,
    },
    pedalStrategy: 'inverted',
    pedalWeight: 1.9,
    guideToneWeight: 1.0,
    tieCommonTones: true,
    followAnticipation: true,
    phraseCrescendoGain: 5,
  },
  fusion_crossover: {
    id: 'fusion_crossover',
    preferredVoicing: 'quartal_shell',
    voiceCountByEnergy: { low: 3, mid: 4, high: 4 },
    range: { minMidi: 57, maxMidi: 79 },
    velocityRange: { min: 56, max: 78 },
    omitThirdBias: 0.1,
    omitFifthBias: 0.7,
    tensionWeights: {
      add9: 0.75,
      maj7: 0.85,
      sus2: 0.25,
      sus4: 0.5,
      sixth: 0.6,
      eleventh: 0.65,
      sharp11: 0.75,
      thirteenth: 0.8,
    },
    pedalStrategy: 'minimal',
    pedalWeight: 0.8,
    guideToneWeight: 1.8,
    tieCommonTones: false,
    followAnticipation: true,
    phraseCrescendoGain: 4,
  },
  chill_lofi_ambient: {
    id: 'chill_lofi_ambient',
    preferredVoicing: 'drop3',
    voiceCountByEnergy: { low: 3, mid: 3, high: 4 },
    range: { minMidi: 55, maxMidi: 76 },
    velocityRange: { min: 48, max: 68 },
    omitThirdBias: 0.3,
    omitFifthBias: 0.6,
    tensionWeights: {
      add9: 0.85,
      maj7: 0.9,
      sus2: 0.45,
      sus4: 0.35,
      sixth: 0.55,
      eleventh: 0.45,
      sharp11: 0.4,
      thirteenth: 0.55,
    },
    pedalStrategy: 'internal',
    pedalWeight: 1.6,
    guideToneWeight: 1.1,
    tieCommonTones: true,
    followAnticipation: false,
    phraseCrescendoGain: 2,
  },
};

export interface ChordEventWindow {
  index: number;
  startTick: number;
  endTick: number;
  parsed: ParsedChord;
  slashBassPc: number | null;
  isOffbeatAnticipation: boolean;
  isBreak: boolean;
  safeMinMidi: number;
  kbPitches: number[];
  kbAvgPitch: number | null;
  kbTargetCenter: number;
  vocalImportantPitches: number[];
  vocalAvgPitch: number | null;
  vocalMinPitch: number | null;
  vocalMaxPitch: number | null;
  vocalActiveRatio: number;
  vocalPlacementMode: 'neutral' | 'above_vocal' | 'below_vocal';
}

interface InternalPadNote {
  pitch: number;
  velocity: number;
  startTick: number;
  durationTicks: number;
  windowIndex: number;
  isNewAttack: boolean;
  voiceRole: 'bass' | 'inner' | 'tension' | 'top';
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

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

/** Resolves any legacy preset ID or explicit genreDna into one of the 6 PadGenreDnaProfiles. */
export function resolvePadGenreDna(
  presetId?: string,
  genreDna?: PadGenreDnaId
): PadGenreDnaProfile {
  if (genreDna && genreDna in PAD_GENRE_DNA_PROFILES) {
    return PAD_GENRE_DNA_PROFILES[genreDna];
  }
  const id = (presetId ?? 'auto').trim();
  if (id in PAD_GENRE_DNA_PROFILES) {
    return PAD_GENRE_DNA_PROFILES[id as PadGenreDnaId];
  }
  switch (id) {
    case 'floating_9th':
    case 'fifth_drone':
    case 'shimmer_arp_pad':
      return PAD_GENRE_DNA_PROFILES.alt_shoegaze;
    case 'octave_layer':
    case 'jrock_anticipation':
    case 'high_shimmer':
      return PAD_GENRE_DNA_PROFILES.emo_jrock;
    case 'sidechain_pulse':
    case 'dark_cinematic':
      return PAD_GENRE_DNA_PROFILES.numetal_electro;
    case 'choir_open_voicing':
      return PAD_GENRE_DNA_PROFILES.fusion_crossover;
    case 'analog_warm_drift':
      return PAD_GENRE_DNA_PROFILES.chill_lofi_ambient;
    case 'warm_whole':
    case 'strings_ensemble':
    case 'swell_half':
    case 'auto':
    default:
      return PAD_GENRE_DNA_PROFILES.jpop_ballad;
  }
}

function normalizeEnergy(
  input: EngineInput,
  ctx?: PadGenerationContext
): PadEnergyLevel {
  if (ctx?.energy) return ctx.energy;
  const raw = input.section.energy;
  if (raw === 'Low') return 'low';
  if (raw === 'High') return 'high';
  return 'mid';
}

function normalizeSectionType(
  input: EngineInput,
  ctx?: PadGenerationContext
): string {
  if (ctx?.sectionType) return ctx.sectionType;
  const t = input.section.type;
  if (t === 'Pre-Chorus') return 'pre_chorus';
  return t.toLowerCase();
}

function toExternalRefs(notes?: readonly MidiNote[] | readonly ExternalNoteRef[]): ExternalNoteRef[] {
  if (!notes || notes.length === 0) return [];
  return notes.map((n) => ({
    pitch: n.pitch,
    startTick: n.startTick,
    durationTick: 'durationTick' in n ? n.durationTick : n.durationTicks,
    velocity: n.velocity,
  }));
}

// ===========================================================================
// Stage 1: Multi-Part Register & Timeline "Kime" Analysis
// ===========================================================================
export function analyzePadContext(
  input: EngineInput,
  dna: PadGenreDnaProfile,
  extCtx?: PadGenerationContext
): { windows: ChordEventWindow[]; sectionEndTick: number } {
  const { song, section } = input;
  const sectionEndTick = Math.max(1, section.bars) * BAR_TICKS;
  const energy = normalizeEnergy(input, extCtx);
  const sectionType = normalizeSectionType(input, extCtx);

  const bassRefs = extCtx?.bassNotes ?? toExternalRefs(input.bassNotes);
  const kbRefs = extCtx?.keyboardNotes ?? toExternalRefs(input.keyboardNotes);
  const vocalRefs = extCtx?.vocalNotes ?? toExternalRefs(input.vocalNotes);
  const prevVocalAvg = extCtx?.prevVocalAvgPitch ?? input.prevVocalAvgPitch;

  const boundaryChanges = getTimelineBoundaryChanges(
    section.chords,
    section.bars,
    song.key,
    song.scale
  );

  const changeMap = new Map<number, { isOffbeat: boolean }>();
  changeMap.set(0, { isOffbeat: false });
  for (const ch of boundaryChanges) {
    if (ch.changeTick <= 0 || ch.changeTick >= sectionEndTick) continue;
    // When followAnticipation=false, only snap strong/non-offbeat changes unless major root movement
    if (!dna.followAnticipation && ch.isOffbeat) {
      const snappedBarTick = Math.round(ch.changeTick / BAR_TICKS) * BAR_TICKS;
      if (snappedBarTick > 0 && snappedBarTick < sectionEndTick) {
        changeMap.set(snappedBarTick, { isOffbeat: false });
      }
      continue;
    }
    changeMap.set(ch.changeTick, { isOffbeat: ch.isOffbeat });
  }

  const ticks = Array.from(changeMap.keys()).sort((a, b) => a - b);
  const windows: ChordEventWindow[] = [];

  for (let i = 0; i < ticks.length; i++) {
    const startTick = ticks[i];
    const endTick = i + 1 < ticks.length ? ticks[i + 1] : sectionEndTick;
    if (endTick <= startTick) continue;

    const parsed = getActiveChordAtTick(
      section.chords,
      startTick,
      song.key,
      song.scale,
      section.bars
    ).parsed;

    const slashBassPc =
      parsed.bassPitchClass !== undefined && parsed.bassPitchClass !== parsed.rootPitchClass
        ? parsed.bassPitchClass
        : null;

    // Bass register analysis
    const winBass = bassRefs.filter(
      (n) => n.startTick < endTick && n.startTick + n.durationTick > startTick
    );
    const bassMaxPitch =
      winBass.length > 0 ? Math.max(...winBass.map((n) => n.pitch)) : null;
    const safeMinMidi = Math.max(
      55,
      dna.range.minMidi,
      bassMaxPitch !== null ? Math.min(60, bassMaxPitch + 7) : dna.range.minMidi
    );

    // Keyboard register analysis
    const winKb = kbRefs.filter(
      (n) => n.startTick < endTick && n.startTick + n.durationTick > startTick
    );
    const kbPitches = Array.from(new Set(winKb.map((n) => n.pitch)));
    const kbAvgPitch =
      winKb.length > 0
        ? winKb.reduce((s, n) => s + n.pitch, 0) / winKb.length
        : null;
    const kbTargetCenter = clamp((kbAvgPitch ?? 58) + 7, 64, 74);

    // Vocal register analysis
    const winVocal = vocalRefs.filter(
      (n) => n.startTick < endTick && n.startTick + n.durationTick > startTick
    );
    const importantVocals = winVocal.filter((n) => n.durationTick >= 180);
    const vocalImportantPitches = Array.from(
      new Set((importantVocals.length > 0 ? importantVocals : winVocal).map((n) => n.pitch))
    );

    let coveredTicks = 0;
    let weightedSum = 0;
    let weightTotal = 0;
    let vocalMinPitch: number | null = null;
    let vocalMaxPitch: number | null = null;

    for (const vn of winVocal) {
      const ovStart = Math.max(startTick, vn.startTick);
      const ovEnd = Math.min(endTick, vn.startTick + vn.durationTick);
      const ov = Math.max(0, ovEnd - ovStart);
      coveredTicks += ov;
      weightedSum += vn.pitch * ov;
      weightTotal += ov;
      vocalMinPitch =
        vocalMinPitch === null ? vn.pitch : Math.min(vocalMinPitch, vn.pitch);
      vocalMaxPitch =
        vocalMaxPitch === null ? vn.pitch : Math.max(vocalMaxPitch, vn.pitch);
    }

    const vocalActiveRatio = coveredTicks / Math.max(1, endTick - startTick);
    const vocalAvgPitch =
      weightTotal > 0 ? weightedSum / weightTotal : prevVocalAvg ?? null;

    let vocalPlacementMode: ChordEventWindow['vocalPlacementMode'] = 'neutral';
    if (vocalActiveRatio >= 0.15 && vocalAvgPitch !== null) {
      if (
        vocalAvgPitch <= 68 &&
        (energy === 'high' ||
          sectionType === 'chorus' ||
          dna.pedalStrategy === 'inverted')
      ) {
        vocalPlacementMode = 'above_vocal';
      } else {
        vocalPlacementMode = 'below_vocal';
      }
    }

    windows.push({
      index: windows.length,
      startTick,
      endTick,
      parsed,
      slashBassPc,
      isOffbeatAnticipation: changeMap.get(startTick)?.isOffbeat ?? false,
      isBreak: false,
      safeMinMidi,
      kbPitches,
      kbAvgPitch,
      kbTargetCenter,
      vocalImportantPitches,
      vocalAvgPitch,
      vocalMinPitch,
      vocalMaxPitch,
      vocalActiveRatio,
      vocalPlacementMode,
    });
  }

  return { windows, sectionEndTick };
}

// ===========================================================================
// Stage 2: Legal Pitch Classes, Open Voicing Candidates & Viterbi DP
// ===========================================================================
export function getLegalPadPitchClasses(
  key: KeyName,
  scale: ScaleType,
  parsed: ParsedChord,
  dna?: PadGenreDnaProfile
): {
  allowedPcs: Set<number>;
  chordTonePcs: Set<number>;
  guideTonePcs: Set<number>;
  pedalPcs: number[];
} {
  const keyPc = noteNameToSemitone(key);
  const scalePcs = getScalePitchClasses(key, scale);
  const chordTonePcs = new Set<number>(
    parsed.intervals.map((iv) => (parsed.rootPitchClass + iv) % 12)
  );
  if (parsed.bassPitchClass !== undefined) {
    chordTonePcs.add(parsed.bassPitchClass);
  }

  const guideTonePcs = new Set<number>();
  for (const iv of [3, 4, 9, 10, 11]) {
    if (parsed.intervals.includes(iv)) {
      guideTonePcs.add((parsed.rootPitchClass + iv) % 12);
    }
  }

  const allowedPcs = new Set<number>(chordTonePcs);
  const isSus4 =
    parsed.intervals.includes(5) &&
    !parsed.intervals.includes(3) &&
    !parsed.intervals.includes(4);
  const isDim7 =
    parsed.quality === 'dim' &&
    parsed.intervals.includes(6) &&
    parsed.intervals.includes(9);
  const isLydianIV =
    ((parsed.rootPitchClass - keyPc + 12) % 12 === (scale === 'Major' ? 5 : 8)) &&
    parsed.intervals.includes(4);

  const tensionCandidates: number[] = [];
  // 9th / add9 (+2)
  if (!parsed.intervals.includes(1) && (dna ? dna.tensionWeights.add9 >= 0.2 : true)) {
    tensionCandidates.push((parsed.rootPitchClass + 2) % 12);
  }
  // 13th / 6th (+9)
  if (!parsed.intervals.includes(8) && (dna ? dna.tensionWeights.thirteenth >= 0.2 || dna.tensionWeights.sixth >= 0.2 : true)) {
    tensionCandidates.push((parsed.rootPitchClass + 9) % 12);
  }
  // 11th (+5) on minor/sus4
  if (
    (parsed.quality === 'minor' || isSus4) &&
    (dna ? dna.tensionWeights.eleventh >= 0.2 || dna.tensionWeights.sus4 >= 0.2 : true)
  ) {
    tensionCandidates.push((parsed.rootPitchClass + 5) % 12);
  }
  // #11 (+6) on IVmaj7 Lydian
  if (isLydianIV && (dna ? dna.tensionWeights.sharp11 >= 0.2 : true)) {
    tensionCandidates.push((parsed.rootPitchClass + 6) % 12);
  }
  // dim7: diatonic notes a whole step (+2) above any chord tone
  if (isDim7) {
    for (const ct of chordTonePcs) {
      const wholeAbove = (ct + 2) % 12;
      if (scalePcs.includes(wholeAbove)) {
        tensionCandidates.push(wholeAbove);
      }
    }
  }

  // Filter avoid notes (1 semitone above any chord tone unless explicitly in chordTonePcs or Lydian #11)
  for (const tc of tensionCandidates) {
    if (chordTonePcs.has(tc)) {
      allowedPcs.add(tc);
      continue;
    }
    let isAvoid = false;
    for (const ct of chordTonePcs) {
      if ((ct + 1) % 12 === tc) {
        isAvoid = true;
        break;
      }
    }
    if (!isAvoid) {
      allowedPcs.add(tc);
    }
  }

  // Valid tonic (1) and dominant (5) pedal pitch classes (non-avoid)
  const pedalPcs: number[] = [];
  for (const pPc of [keyPc, (keyPc + 7) % 12]) {
    let isAvoid = false;
    for (const ct of chordTonePcs) {
      if ((ct + 1) % 12 === pPc) {
        isAvoid = true;
        break;
      }
    }
    if (!isAvoid && (allowedPcs.has(pPc) || scalePcs.includes(pPc))) {
      pedalPcs.push(pPc);
    }
  }

  return { allowedPcs, chordTonePcs, guideTonePcs, pedalPcs };
}

function isLeadingTonePc(pc: number, key: KeyName): boolean {
  const keyPc = noteNameToSemitone(key);
  return pc === (keyPc + 11) % 12;
}

function isValidPadCandidate(
  voicing: number[],
  minMidi: number,
  maxMidi: number,
  key: KeyName
): boolean {
  if (voicing.length < 2) return false;
  let leadingCount = 0;
  for (let i = 0; i < voicing.length; i++) {
    const p = voicing[i];
    if (p < Math.max(55, minMidi) || p > Math.min(81, maxMidi)) return false;
    if (isLeadingTonePc(p % 12, key)) leadingCount++;
    if (i > 0) {
      const diff = p - voicing[i - 1];
      if (diff <= 0) return false; // Strict ascending, no crossing/duplicates
      if (diff > 14) return false;
      if (i >= 2 && diff > 12) return false;
    }
  }
  if (leadingCount > 1) return false; // Never double leading tone
  return true;
}

function generatePadCandidatesForWindow(
  win: ChordEventWindow,
  dna: PadGenreDnaProfile,
  energy: PadEnergyLevel,
  key: KeyName,
  scale: ScaleType
): number[][] {
  const targetK = clamp(dna.voiceCountByEnergy[energy], 2, 4);
  const { allowedPcs, chordTonePcs, pedalPcs } = getLegalPadPitchClasses(
    key,
    scale,
    win.parsed,
    dna
  );

  const rootPc = win.parsed.rootPitchClass;
  const thirdIv = win.parsed.intervals.includes(3)
    ? 3
    : win.parsed.intervals.includes(4)
      ? 4
      : null;
  const fifthIv = win.parsed.intervals.includes(6)
    ? 6
    : win.parsed.intervals.includes(8)
      ? 8
      : win.parsed.intervals.includes(7)
        ? 7
        : null;
  const seventhIv = win.parsed.intervals.includes(11)
    ? 11
    : win.parsed.intervals.includes(10)
      ? 10
      : win.parsed.intervals.includes(9)
        ? 9
        : null;

  const corePcs: number[] = [rootPc];
  if (thirdIv !== null && dna.omitThirdBias < 0.6) {
    corePcs.push((rootPc + thirdIv) % 12);
  }
  if (seventhIv !== null) {
    corePcs.push((rootPc + seventhIv) % 12);
  }
  if (fifthIv !== null && (dna.omitFifthBias < 0.6 || fifthIv !== 7)) {
    corePcs.push((rootPc + fifthIv) % 12);
  }
  for (const pc of allowedPcs) {
    if (!corePcs.includes(pc)) corePcs.push(pc);
  }
  for (const pc of chordTonePcs) {
    if (!corePcs.includes(pc)) corePcs.push(pc);
  }

  const minM = Math.max(55, win.safeMinMidi);
  const maxM = Math.min(81, dna.range.maxMidi);
  const raw: number[][] = [];

  // Enumerate open-spaced combinations in [minM, maxM]
  const allAllowedNotes: number[] = [];
  for (let p = minM; p <= maxM; p++) {
    if (allowedPcs.has(p % 12)) {
      allAllowedNotes.push(p);
    }
  }

  const buildOpenFromBase = (baseP: number, pcs: number[], k: number) => {
    const out: number[] = [baseP];
    let cur = baseP;
    for (let i = 1; i < k; i++) {
      const targetPc = pcs[i % pcs.length];
      let cand = cur + 5; // Prefer >= 5 semitones open spacing
      while (cand % 12 !== targetPc) cand++;
      if (cand - cur > 12 && cand - 12 > cur + 2) cand -= 12;
      if (cand <= maxM) {
        out.push(cand);
        cur = cand;
      }
    }
    if (out.length === k && isValidPadCandidate(out, minM, maxM, key)) {
      raw.push(out);
    }
  };

  for (const baseP of allAllowedNotes) {
    if (baseP > minM + 14) break;
    for (let rot = 0; rot < Math.min(4, corePcs.length); rot++) {
      const rotated = [...corePcs.slice(rot), ...corePcs.slice(0, rot)];
      buildOpenFromBase(baseP, rotated, targetK);
    }
  }

  // Drop-2 / Drop-3 / Open 5th+9th templates
  for (let oct = 48; oct <= 60; oct += 12) {
    const r = oct + rootPc;
    if (r >= minM && r + 14 <= maxM) {
      const open59 = [r, r + 7, r + 14];
      if (targetK === 4 && r + 19 <= maxM) open59.push(r + 19);
      if (isValidPadCandidate(open59.slice(0, targetK), minM, maxM, key)) {
        raw.push(open59.slice(0, targetK));
      }
    }
  }

  // Pedal-anchored candidates
  for (const pedPc of pedalPcs) {
    const topPed = fitPitchClassToRange(pedPc, Math.max(minM + 10, maxM - 11), maxM);
    const midPed = fitPitchClassToRange(pedPc, minM + 4, Math.min(minM + 15, maxM - 4));
    if (dna.pedalStrategy === 'inverted') {
      const lower = allAllowedNotes.filter((p) => p <= topPed - 5 && p >= minM);
      if (lower.length >= targetK - 1) {
        const picked: number[] = [];
        let prev = -1;
        for (const lp of lower) {
          if (prev === -1 || (lp - prev >= 5 && lp - prev <= 12)) {
            picked.push(lp);
            prev = lp;
            if (picked.length === targetK - 1) break;
          }
        }
        if (picked.length === targetK - 1) {
          const cand = [...picked, topPed];
          if (isValidPadCandidate(cand, minM, maxM, key)) raw.push(cand);
        }
      }
    } else if (dna.pedalStrategy === 'internal' || dna.pedalStrategy === 'double_1_5') {
      const below = allAllowedNotes.find((p) => p <= midPed - 4 && p >= minM);
      const above = allAllowedNotes.find((p) => p >= midPed + 5 && p <= maxM);
      if (below !== undefined && above !== undefined) {
        const cand = targetK === 2 ? [below, above] : [below, midPed, above];
        if (targetK === 4) {
          const extra = allAllowedNotes.find((p) => p >= above + 5 && p <= maxM);
          if (extra !== undefined) cand.push(extra);
        }
        if (isValidPadCandidate(cand, minM, maxM, key)) raw.push(cand);
      }
    }
  }

  // Deduplicate
  const uniq = new Map<string, number[]>();
  for (const c of raw) {
    const k = c.join(',');
    if (!uniq.has(k)) uniq.set(k, c);
  }
  let list = Array.from(uniq.values());

  // Fallback safe open 5th / triad spread if empty
  if (list.length === 0) {
    const base = fitPitchClassToRange(rootPc, minM, Math.min(minM + 11, maxM));
    const fb = [base];
    const p5 = base + (fifthIv ?? 7);
    if (p5 <= maxM) fb.push(p5);
    if (targetK >= 3 && base + 12 <= maxM) fb.push(base + 12);
    if (targetK >= 4 && base + 14 <= maxM) fb.push(base + 14);
    list = [fb.length >= 2 ? fb : [minM, Math.min(maxM, minM + 7)]];
  }

  // Prune deterministically to top 48 by static emission cost
  list.sort(
    (a, b) =>
      computeStaticEmissionCost(a, win, dna, key, scale) -
        computeStaticEmissionCost(b, win, dna, key, scale) ||
      a[0] - b[0] ||
      a[a.length - 1] - b[b.length - 1]
  );
  return list.slice(0, 48);
}

function computeStaticEmissionCost(
  voicing: number[],
  win: ChordEventWindow,
  dna: PadGenreDnaProfile,
  key: KeyName,
  scale: ScaleType
): number {
  let cost = 0;
  // 1. Open interval cost
  for (let i = 1; i < voicing.length; i++) {
    const d = voicing[i] - voicing[i - 1];
    if (d <= 2) cost += 32.0;
    else if (d <= 4) cost += 4.0;
    else if (d <= 9) cost += 0.0;
    else if (d <= 12) cost += 2.5;
    else cost += 14.0;
  }
  if (voicing[0] < 60 && voicing.length >= 2 && voicing[1] - voicing[0] < 5) {
    cost += 18.0; // LIL violation
  }

  // 2. Keyboard collision cost
  const avg = voicing.reduce((s, p) => s + p, 0) / voicing.length;
  for (const p of voicing) {
    for (const k of win.kbPitches) {
      const diff = Math.abs(p - k);
      if (diff === 1) cost += p < 72 ? 36.0 : 28.0;
      else if (diff === 2) cost += p < 72 ? 22.0 : 16.0;
      else if (diff === 0) cost += 4.0;
    }
  }
  cost += Math.abs(avg - win.kbTargetCenter) * 0.8;

  // 3. Vocal collision & placement mode cost
  for (const p of voicing) {
    for (const v of win.vocalImportantPitches) {
      const diff = Math.abs(p - v);
      if (diff === 1) cost += 42.0;
      else if (diff === 0) cost += 26.0;
      else if (diff === 2) cost += 12.0;
    }
  }
  if (win.vocalPlacementMode === 'above_vocal' && win.vocalMaxPitch !== null) {
    const targetTop = clamp(win.vocalMaxPitch + 4, 67, dna.range.maxMidi);
    cost += Math.abs(voicing[voicing.length - 1] - targetTop) * 1.4;
  } else if (win.vocalPlacementMode === 'below_vocal' && win.vocalMinPitch !== null) {
    const targetTop = win.vocalMinPitch - 3;
    const top = voicing[voicing.length - 1];
    if (top > targetTop) cost += (top - targetTop) * 3.5;
  }

  // 4. Harmonic representation & slash bass
  const { guideTonePcs, pedalPcs } = getLegalPadPitchClasses(key, scale, win.parsed, dna);
  const hasGuide = voicing.some((p) => guideTonePcs.has(p % 12));
  if (!hasGuide && dna.omitThirdBias < 0.5) {
    cost += 8.0;
  }
  if (win.slashBassPc !== null && voicing[0] % 12 === win.slashBassPc) {
    cost += 5.0;
  }

  // 5. Pedal bonus
  if (pedalPcs.length > 0) {
    if (
      dna.pedalStrategy === 'inverted' &&
      pedalPcs.includes(voicing[voicing.length - 1] % 12)
    ) {
      cost -= 10.0 * dna.pedalWeight;
    } else if (
      (dna.pedalStrategy === 'internal' || dna.pedalStrategy === 'double_1_5') &&
      voicing.slice(1, -1).some((p) => pedalPcs.includes(p % 12))
    ) {
      cost -= 10.0 * dna.pedalWeight;
    }
  }

  return cost;
}

function computeTransitionCost(
  prev: number[],
  curr: number[],
  prevWin: ChordEventWindow,
  currWin: ChordEventWindow,
  dna: PadGenreDnaProfile,
  key: KeyName,
  scale: ScaleType
): number {
  let l1 = 0;
  let bigLeapPen = 0;
  const len = Math.min(prev.length, curr.length);
  for (let i = 0; i < len; i++) {
    const d = Math.abs(curr[i] - prev[i]);
    l1 += d;
    if (d >= 5) {
      bigLeapPen += Math.pow(d - 4, 2) * 2.2;
    }
  }
  const prevSet = new Set(prev);
  let commonCount = 0;
  for (const p of curr) {
    if (prevSet.has(p)) commonCount++;
  }

  let crossingPen = 0;
  for (let i = 1; i < len; i++) {
    if (curr[i] <= prev[i - 1]) crossingPen += 35.0;
  }

  let guideBonus = 0;
  const prevIsDomOrDim =
    prevWin.parsed.quality === 'dim' ||
    (prevWin.parsed.intervals.includes(4) && prevWin.parsed.intervals.includes(10));
  if (prevIsDomOrDim) {
    const { guideTonePcs } = getLegalPadPitchClasses(key, scale, prevWin.parsed, dna);
    const { chordTonePcs } = getLegalPadPitchClasses(key, scale, currWin.parsed, dna);
    for (const p of prev) {
      if (!guideTonePcs.has(p % 12)) continue;
      for (const c of curr) {
        if (!chordTonePcs.has(c % 12)) continue;
        const diff = Math.abs(c - p);
        if (diff === 1) {
          guideBonus -= 14.0 * dna.guideToneWeight;
          break;
        } else if (diff === 2) {
          guideBonus -= 6.0 * dna.guideToneWeight;
          break;
        }
      }
    }
  }

  return (
    l1 * 1.8 +
    bigLeapPen -
    commonCount * 7.5 * (1 + 0.5 * dna.pedalWeight) +
    crossingPen +
    guideBonus
  );
}

export function solvePadVoicingsViterbi(
  windows: ChordEventWindow[],
  dna: PadGenreDnaProfile,
  energy: PadEnergyLevel,
  key: KeyName,
  scale: ScaleType
): number[][] {
  if (windows.length === 0) return [];
  const candidatesPerWin = windows.map((w) =>
    generatePadCandidatesForWindow(w, dna, energy, key, scale)
  );

  const dpCost: number[][] = candidatesPerWin.map((cands) =>
    new Array(cands.length).fill(Infinity)
  );
  const backPtr: number[][] = candidatesPerWin.map((cands) =>
    new Array(cands.length).fill(0)
  );

  for (let c = 0; c < candidatesPerWin[0].length; c++) {
    dpCost[0][c] = computeStaticEmissionCost(
      candidatesPerWin[0][c],
      windows[0],
      dna,
      key,
      scale
    );
  }

  for (let t = 1; t < windows.length; t++) {
    for (let c = 0; c < candidatesPerWin[t].length; c++) {
      const emit = computeStaticEmissionCost(
        candidatesPerWin[t][c],
        windows[t],
        dna,
        key,
        scale
      );
      let bestTotal = Infinity;
      let bestPrev = 0;
      for (let p = 0; p < candidatesPerWin[t - 1].length; p++) {
        const trans = computeTransitionCost(
          candidatesPerWin[t - 1][p],
          candidatesPerWin[t][c],
          windows[t - 1],
          windows[t],
          dna,
          key,
          scale
        );
        const total = dpCost[t - 1][p] + trans + emit;
        if (total < bestTotal) {
          bestTotal = total;
          bestPrev = p;
        }
      }
      dpCost[t][c] = bestTotal;
      backPtr[t][c] = bestPrev;
    }
  }

  const chosen: number[][] = new Array(windows.length);
  let bestLast = 0;
  let bestLastCost = Infinity;
  const lastT = windows.length - 1;
  for (let c = 0; c < dpCost[lastT].length; c++) {
    if (dpCost[lastT][c] < bestLastCost) {
      bestLastCost = dpCost[lastT][c];
      bestLast = c;
    }
  }
  let currIdx = bestLast;
  for (let t = lastT; t >= 0; t--) {
    chosen[t] = candidatesPerWin[t][currIdx];
    currIdx = backPtr[t][currIdx];
  }

  return chosen;
}

// ===========================================================================
// Stage 3: Spatial Tension & Genre-Specific Sustain Expansion
// ===========================================================================
export function expandPadSustainAndTensions(
  windows: ChordEventWindow[],
  voicings: number[][],
  dna: PadGenreDnaProfile,
  energy: PadEnergyLevel
): InternalPadNote[] {
  const baseVel =
    energy === 'low'
      ? dna.velocityRange.min + 2
      : energy === 'high'
        ? dna.velocityRange.max - 2
        : Math.round((dna.velocityRange.min + dna.velocityRange.max) / 2);

  const notes: InternalPadNote[] = [];

  for (let w = 0; w < windows.length; w++) {
    const win = windows[w];
    const v = voicings[w] ?? [60, 67, 72];
    const nextWin = w + 1 < windows.length ? windows[w + 1] : null;
    const isFineChange = nextWin ? nextWin.startTick - win.startTick <= BEAT_TICKS : false;
    const rawEnd = nextWin ? nextWin.startTick - (isFineChange ? 8 : 0) : win.endTick;
    const dur = Math.max(15, rawEnd - win.startTick);

    for (let i = 0; i < v.length; i++) {
      const pitch = v[i];
      const role: InternalPadNote['voiceRole'] =
        i === 0
          ? 'bass'
          : i === v.length - 1
            ? 'top'
            : win.parsed.intervals.includes(pitch % 12)
              ? 'inner'
              : 'tension';

      // Common tone glue when tieCommonTones === true and not a break
      if (dna.tieCommonTones && !win.isBreak && w > 0) {
        const existing = notes.find(
          (prev) =>
            prev.pitch === pitch &&
            prev.startTick + prev.durationTicks >= win.startTick - 12 &&
            prev.startTick + prev.durationTicks <= win.startTick + 4
        );
        if (existing) {
          existing.durationTicks = Math.max(existing.durationTicks, rawEnd - existing.startTick);
          continue;
        }
      }

      notes.push({
        pitch,
        velocity: baseVel,
        startTick: win.startTick,
        durationTicks: dur,
        windowIndex: w,
        isNewAttack: true,
        voiceRole: role,
      });
    }
  }

  return notes;
}

// ===========================================================================
// Stage 4: Dynamic Collision Guard & Active Chord Snap
// ===========================================================================
export function guardCollisionsAndSnap(
  notes: InternalPadNote[],
  windows: ChordEventWindow[],
  dna: PadGenreDnaProfile,
  key: KeyName,
  scale: ScaleType
): InternalPadNote[] {
  const out = notes.map((n) => ({ ...n }));

  for (const n of out) {
    const win = windows[n.windowIndex] ?? windows[0];
    if (!win) continue;
    const { allowedPcs, chordTonePcs, pedalPcs } = getLegalPadPitchClasses(
      key,
      scale,
      win.parsed,
      dna
    );
    const allSafePcs = new Set<number>([...allowedPcs, ...chordTonePcs, ...pedalPcs]);

    // 1. Vocal direct collision guard (|p - v| <= 1)
    const hasVocalClash = win.vocalImportantPitches.some(
      (v) => Math.abs(n.pitch - v) <= 1
    );
    if (hasVocalClash) {
      let shifted: number | null = null;
      if (
        n.pitch + 12 <= dna.range.maxMidi &&
        !win.vocalImportantPitches.some((v) => Math.abs(n.pitch + 12 - v) <= 1)
      ) {
        shifted = n.pitch + 12;
      } else if (
        n.pitch - 12 >= win.safeMinMidi &&
        !win.vocalImportantPitches.some((v) => Math.abs(n.pitch - 12 - v) <= 1)
      ) {
        shifted = n.pitch - 12;
      } else {
        // Search nearest legal pitch in range without vocal semitone clash
        for (let d = 2; d <= 12; d++) {
          for (const cand of [n.pitch - d, n.pitch + d]) {
            if (
              cand >= win.safeMinMidi &&
              cand <= dna.range.maxMidi &&
              allSafePcs.has(cand % 12) &&
              !win.vocalImportantPitches.some((v) => Math.abs(cand - v) <= 1)
            ) {
              shifted = cand;
              break;
            }
          }
          if (shifted !== null) break;
        }
      }
      if (shifted !== null) {
        n.pitch = shifted;
      } else {
        n.velocity = Math.max(45, n.velocity - 8);
      }
    }

    // 2. Keyboard low-mid cluster guard (p < 72 and |p - k| === 1)
    if (
      n.pitch < 72 &&
      win.kbPitches.some((k) => Math.abs(n.pitch - k) === 1)
    ) {
      if (
        n.pitch + 12 <= dna.range.maxMidi &&
        !win.vocalImportantPitches.some((v) => Math.abs(n.pitch + 12 - v) <= 1)
      ) {
        n.pitch += 12;
      } else {
        for (let d = 2; d <= 7; d++) {
          for (const cand of [n.pitch + d, n.pitch - d]) {
            if (
              cand >= win.safeMinMidi &&
              cand <= dna.range.maxMidi &&
              allSafePcs.has(cand % 12) &&
              !win.kbPitches.some((k) => Math.abs(cand - k) === 1) &&
              !win.vocalImportantPitches.some((v) => Math.abs(cand - v) <= 1)
            ) {
              n.pitch = cand;
              break;
            }
          }
        }
      }
    }

    // 3. Active chord legal pitch snap
    if (!allSafePcs.has(n.pitch % 12)) {
      let bestP = n.pitch;
      let bestDist = 99;
      for (let p = win.safeMinMidi; p <= dna.range.maxMidi; p++) {
        if (allSafePcs.has(p % 12) && Math.abs(p - n.pitch) < bestDist) {
          bestDist = Math.abs(p - n.pitch);
          bestP = p;
        }
      }
      n.pitch = bestP;
    }
  }

  return out;
}

// ===========================================================================
// Stage 5: Gentle Velocity Tiers, Simultaneous Attack, Gap & Bounds Sanitizer
// ===========================================================================
export function finalizePadMidiNotes(
  notes: InternalPadNote[],
  dna: PadGenreDnaProfile,
  energy: PadEnergyLevel,
  sectionType: string,
  sectionEndTick: number,
  rng: () => number,
  enforcePadClamp = true
): MidiNote[] {
  if (sectionEndTick <= 0) return [];

  const minHard = Math.max(45, dna.velocityRange.min - 4);
  const maxHard = Math.min(85, dna.velocityRange.max + 4);
  const lateThreshold = Math.floor(sectionEndTick * 0.65);

  const styled = notes.map((n) => {
    let vel = n.velocity;
    if (enforcePadClamp) {
      if (n.startTick >= lateThreshold) {
        const denom = Math.max(1, sectionEndTick - BAR_TICKS - lateThreshold);
        const progress = Math.min(1, (n.startTick - lateThreshold) / denom);
        const mult = sectionType === 'pre_chorus' ? 1.2 : 1.0;
        vel += Math.round(progress * dna.phraseCrescendoGain * mult);
      }
      const roleOffset =
        n.voiceRole === 'bass'
          ? -3
          : n.voiceRole === 'tension'
            ? -4
            : n.voiceRole === 'top'
              ? energy === 'high' && sectionType === 'chorus'
                ? 1
                : -2
              : 0;
      const micro = Math.floor(rng() * 3) - 1; // -1..+1
      vel = clamp(vel + roleOffset + micro, minHard, maxHard);
    } else {
      vel = clampVelocity(vel);
    }

    const startTick = Math.max(0, Math.round(n.startTick));
    const maxDur = sectionEndTick - startTick;
    const durationTicks = Math.min(Math.round(n.durationTicks), maxDur);
    return {
      pitch: n.pitch,
      velocity: vel,
      startTick,
      durationTicks,
    };
  }).filter((n) => n.startTick >= 0 && n.startTick < sectionEndTick && n.durationTicks > 0);

  // Enforce MIN_SAME_PITCH_GAP = 12 and zero same-pitch overlap
  styled.sort((a, b) => a.pitch - b.pitch || a.startTick - b.startTick || b.durationTicks - a.durationTicks);
  const deduped: Array<{ pitch: number; velocity: number; startTick: number; durationTicks: number }> = [];

  for (const curr of styled) {
    if (deduped.length > 0) {
      const prev = deduped[deduped.length - 1];
      if (prev.pitch === curr.pitch) {
        if (prev.startTick === curr.startTick) {
          // Keep longer duration (already sorted descending)
          continue;
        }
        const delta = curr.startTick - prev.startTick;
        if (delta <= MIN_SAME_PITCH_GAP) {
          // Cannot fit release gap -> glue into prev
          prev.durationTicks = Math.max(
            prev.durationTicks,
            curr.startTick + curr.durationTicks - prev.startTick
          );
          continue;
        }
        if (prev.startTick + prev.durationTicks > curr.startTick - MIN_SAME_PITCH_GAP) {
          prev.durationTicks = Math.max(1, curr.startTick - MIN_SAME_PITCH_GAP - prev.startTick);
        }
      }
    }
    deduped.push({ ...curr });
  }

  return deduped
    .filter((n) => n.startTick >= 0 && n.startTick < sectionEndTick && n.durationTicks > 0)
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)
    .map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: n.durationTicks,
      channel: 2,
    }));
}

// ===========================================================================
// Legacy Compatibility Generator (preserves exact behavior for legacy presets)
// ===========================================================================
const LEGACY_EXACT_PRESETS = new Set<string>([
  'swell_half',
  'high_shimmer',
  'fifth_drone',
  'sidechain_pulse',
  'strings_ensemble',
  'choir_open_voicing',
  'shimmer_arp_pad',
  'analog_warm_drift',
  'jrock_anticipation',
  'dark_cinematic',
  'floating_9th',
  'octave_layer',
  'warm_whole',
]);

function generateLegacyCompatiblePadNotes(
  input: EngineInput,
  rng: () => number
): InternalPadNote[] {
  const { song, section, style, params } = input;
  const sectionEnd = section.bars * BAR_TICKS;
  const playStyle = song.members.pad.padStyle ?? 'Power';
  const padPreset =
    section.patternPresets?.pad ??
    section.partPresets?.pad ??
    song.members.pad.patternPreset ??
    'auto';
  const baseVel = section.energy === 'High' ? 84 : section.energy === 'Low' ? 58 : 72;

  const notes: InternalPadNote[] = [];
  const timelineChanges = getTimelineBoundaryChanges(
    section.chords,
    section.bars,
    song.key,
    song.scale
  );

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * BAR_TICKS;
    if (barStart >= sectionEnd) break;

    const chord = getActiveChordAtTick(
      section.chords,
      barStart,
      song.key,
      song.scale,
      section.bars
    ).parsed;

    const minP =
      padPreset === 'high_shimmer'
        ? 64
        : padPreset === 'dark_cinematic' || padPreset === 'analog_warm_drift'
          ? 43
          : params.voicingMin;
    const maxP =
      padPreset === 'high_shimmer'
        ? 88
        : padPreset === 'dark_cinematic'
          ? 64
          : padPreset === 'analog_warm_drift'
            ? 67
            : padPreset === 'octave_layer' ||
                padPreset === 'strings_ensemble' ||
                padPreset === 'choir_open_voicing' ||
                padPreset === 'shimmer_arp_pad'
              ? 84
              : playStyle === 'Dark Ambient' && padPreset === 'auto'
                ? Math.min(67, params.voicingMax)
                : params.voicingMax;
    const rootMidi = fitPitchClassToRange(
      chord.rootSemitone,
      minP,
      Math.min(minP + 11, maxP)
    );

    const intervalSet = new Set<number>();
    const fifthIv = chord.intervals.includes(6)
      ? 6
      : chord.intervals.includes(8)
        ? 8
        : 7;
    const isPlainTriad =
      chord.intervals.length === 3 &&
      chord.intervals[0] === 0 &&
      (chord.intervals[1] === 3 || chord.intervals[1] === 4) &&
      chord.intervals[2] === 7;

    if (padPreset !== 'auto') {
      if (
        padPreset === 'warm_whole' ||
        padPreset === 'swell_half' ||
        padPreset === 'sidechain_pulse'
      ) {
        for (const iv of chord.intervals) intervalSet.add(iv);
        if (chord.quality !== 'power') intervalSet.add(12);
      } else if (padPreset === 'analog_warm_drift') {
        for (const iv of chord.intervals) intervalSet.add(iv);
        if (!intervalSet.has(9) && !intervalSet.has(11)) intervalSet.add(10);
      } else if (padPreset === 'strings_ensemble') {
        for (const iv of chord.intervals) {
          intervalSet.add(iv);
          intervalSet.add(iv + 12);
        }
        intervalSet.add(fifthIv);
        intervalSet.add(fifthIv + 12);
        intervalSet.add(24);
      } else if (padPreset === 'choir_open_voicing') {
        const third = chord.intervals.includes(3)
          ? 3
          : chord.intervals.includes(4)
            ? 4
            : 2;
        intervalSet.add(0);
        intervalSet.add(fifthIv + 12);
        intervalSet.add(third + 24);
      } else if (padPreset === 'shimmer_arp_pad') {
        for (const iv of chord.intervals) intervalSet.add(iv);
        intervalSet.add(12);
      } else if (padPreset === 'high_shimmer') {
        for (const iv of chord.intervals) intervalSet.add(iv);
        intervalSet.add(12);
        intervalSet.add(14);
      } else if (padPreset === 'dark_cinematic') {
        intervalSet.add(0);
        intervalSet.add(fifthIv);
        if (chord.intervals.includes(3)) intervalSet.add(3);
        intervalSet.add(12);
      } else if (padPreset === 'floating_9th') {
        for (const iv of chord.intervals) intervalSet.add(iv);
        if (!intervalSet.has(6)) intervalSet.add(2);
        if (!intervalSet.has(9) && !intervalSet.has(10) && !intervalSet.has(11)) {
          intervalSet.add(11);
        }
        intervalSet.add(14);
        intervalSet.add(12);
      } else if (padPreset === 'fifth_drone') {
        intervalSet.add(0);
        intervalSet.add(fifthIv);
        intervalSet.add(12);
      } else if (padPreset === 'octave_layer') {
        for (const iv of chord.intervals) {
          intervalSet.add(iv);
          intervalSet.add(iv + 12);
        }
        intervalSet.add(fifthIv + 12);
      }
    } else if (playStyle === 'Dark Ambient') {
      for (const iv of chord.intervals) intervalSet.add(iv);
      intervalSet.add(12);
    } else if (playStyle === 'Floating Tension') {
      for (const iv of chord.intervals) intervalSet.add(iv);
      if (!isPlainTriad) {
        if (!intervalSet.has(9) && !intervalSet.has(10) && !intervalSet.has(11)) {
          intervalSet.add(intervalSet.has(6) ? 9 : 11);
        }
        if (!intervalSet.has(6)) intervalSet.add(14);
      }
    } else {
      intervalSet.add(0);
      intervalSet.add(fifthIv);
      if (style === 'C' || params.add7 || section.type === 'Chorus') intervalSet.add(12);
      if (style === 'B' && chord.intervals.length >= 2) {
        intervalSet.add(chord.intervals[1] + 12);
      }
    }

    if (padPreset === 'auto') {
      if (params.sus2 && !intervalSet.has(2)) intervalSet.add(2);
      if (params.add7 && !intervalSet.has(9) && !intervalSet.has(10) && !intervalSet.has(11)) {
        intervalSet.add(intervalSet.has(6) ? 9 : 11);
      }
      if (params.add9 && !intervalSet.has(6)) intervalSet.add(14);
    }

    const uniquePitches = Array.from(
      new Set(
        Array.from(intervalSet)
          .map((iv) => rootMidi + iv)
          .filter((p) => p >= minP && p <= maxP)
      )
    ).sort((a, b) => a - b);

    if (padPreset === 'jrock_anticipation') {
      const buildPadPitchesForChord = (targetChord: ParsedChord): number[] => {
        const targetRoot = fitPitchClassToRange(
          targetChord.rootSemitone,
          minP,
          Math.min(minP + 11, maxP)
        );
        const set = new Set<number>(targetChord.intervals);
        if (targetChord.quality !== 'power') set.add(12);
        return Array.from(
          new Set(
            Array.from(set)
              .map((iv) => targetRoot + iv)
              .filter((p) => p >= minP && p <= maxP)
          )
        ).sort((a, b) => a - b);
      };

      if (bar === 0) {
        const bar0Pitches = buildPadPitchesForChord(chord);
        const bar0Dur = Math.max(1, Math.min(1660, sectionEnd));
        for (const p of bar0Pitches) {
          notes.push({
            pitch: p,
            velocity: clampVelocity(Math.min(params.velocityCap, baseVel + params.velocityBoost)),
            startTick: 0,
            durationTicks: bar0Dur,
            windowIndex: 0,
            isNewAttack: true,
            voiceRole: 'inner',
          });
        }
      }

      const antTick = barStart + 1680;
      if (antTick < sectionEnd) {
        const nextChord = resolveChordForBar(section.chords, bar + 1, song.key, song.scale);
        const nextPitches = buildPadPitchesForChord(nextChord);
        const antDur = Math.max(1, Math.min(1900, sectionEnd - antTick));
        for (const p of nextPitches) {
          notes.push({
            pitch: p,
            velocity: clampVelocity(
              Math.min(params.velocityCap, baseVel + 4 + params.velocityBoost)
            ),
            startTick: antTick,
            durationTicks: antDur,
            windowIndex: bar + 1,
            isNewAttack: true,
            voiceRole: 'inner',
          });
        }
      }
      continue;
    }

    const hitOffsets =
      padPreset === 'swell_half'
        ? [0, 960]
        : padPreset === 'sidechain_pulse'
          ? [120, 600, 1080, 1560]
          : [0];
    const hitSpan =
      padPreset === 'swell_half'
        ? 940
        : padPreset === 'sidechain_pulse'
          ? 340
          : TICKS_PER_BAR - 20;

    for (const off of hitOffsets) {
      const startTick = barStart + off;
      if (startTick >= sectionEnd) continue;
      const dur = Math.max(1, Math.min(hitSpan, sectionEnd - startTick));
      for (const p of uniquePitches) {
        const jitter = Math.min(6, params.velocityJitter);
        const velDelta = jitter > 0 ? Math.floor(rng() * (jitter * 2 + 1)) - jitter : 0;
        const vel = clampVelocity(
          Math.min(params.velocityCap, baseVel + params.velocityBoost + velDelta)
        );
        notes.push({
          pitch: p,
          velocity: vel,
          startTick,
          durationTicks: dur,
          windowIndex: bar,
          isNewAttack: true,
          voiceRole: 'inner',
        });
      }
    }

    if (padPreset === 'shimmer_arp_pad') {
      const highShimmerPool = [
        rootMidi + 24,
        rootMidi + fifthIv + 12,
        rootMidi + (chord.intervals.includes(3) ? 27 : 28),
        rootMidi + 26,
      ].filter((p) => p >= 64 && p <= 88);
      if (highShimmerPool.length > 0) {
        for (let step = 0; step < 4; step++) {
          const startTick = barStart + step * 480 + 240;
          if (startTick >= sectionEnd) continue;
          const p = highShimmerPool[step % highShimmerPool.length];
          notes.push({
            pitch: p,
            velocity: clampVelocity(baseVel - 16),
            startTick,
            durationTicks: Math.max(1, Math.min(440, sectionEnd - startTick)),
            windowIndex: bar,
            isNewAttack: true,
            voiceRole: 'top',
          });
        }
      }
    }
  }

  if (timelineChanges.length > 0 && padPreset !== 'jrock_anticipation') {
    for (const change of timelineChanges) {
      const changeTick = change.changeTick;
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        if (n.startTick < changeTick && n.startTick + n.durationTicks > changeTick - 5) {
          const clipped = changeTick - 5 - n.startTick;
          if (clipped < 20) notes.splice(i, 1);
          else n.durationTicks = clipped;
        }
      }
      if (change.isOffbeat) {
        for (let i = notes.length - 1; i >= 0; i--) {
          const n = notes[i];
          if (n.startTick >= changeTick && n.startTick <= changeTick + 240) {
            notes.splice(i, 1);
          }
        }
      }
    }
  }

  return notes;
}

export interface PadTrackResult {
  notes: MidiNote[];
  controlChanges: MidiControlChangeEvent[];
  skeleton?: PadSkeletonId;
  take?: AccompanimentTake;
  plan?: EnsembleSyncPlan;
}

/**
 * Common-Tone Glue & Crossfade Overlap:
 * - Identical MIDI pitches across consecutive chord windows merge into one continuous note.
 * - Changing pitches extend by +overlapTicks (default 30) to crossfade smoothly without gaps.
 */
export function glueAndOverlapVoicings(
  windows: ReadonlyArray<{ startTick: number; endTick: number; pitches: readonly number[] }>,
  sectionEndTick: number,
  velocity: number,
  channel: number,
  overlapTicks = 30
): MidiNote[] {
  const active = new Map<number, { startTick: number; endTick: number }>();
  const finished: MidiNote[] = [];

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const nextSet = new Set(w.pitches);

    // Close pitches not present in this window (with crossfade overlap)
    for (const [pitch, span] of Array.from(active.entries())) {
      if (!nextSet.has(pitch)) {
        const end = Math.min(sectionEndTick, span.endTick + overlapTicks);
        finished.push({
          pitch,
          velocity,
          startTick: span.startTick,
          durationTicks: Math.max(1, end - span.startTick),
          channel,
        });
        active.delete(pitch);
      }
    }

    // Extend common tones or open new tones
    for (const pitch of w.pitches) {
      const existing = active.get(pitch);
      if (existing) {
        existing.endTick = w.endTick;
      } else {
        active.set(pitch, { startTick: w.startTick, endTick: w.endTick });
      }
    }
  }

  for (const [pitch, span] of active.entries()) {
    const end = Math.min(sectionEndTick, span.endTick);
    finished.push({
      pitch,
      velocity,
      startTick: span.startTick,
      durationTicks: Math.max(1, end - span.startTick),
      channel,
    });
  }

  return sanitizeTrackNotes(finished, 5, sectionEndTick);
}

export function generatePadSkeletonTrack(input: EngineInput): PadTrackResult {
  const { song, section } = input;
  const ch = TRACK_CHANNELS.pad;
  if (!song.members.pad.enabled || section.enabledParts?.pad === false) {
    return { notes: [], controlChanges: [] };
  }

  const totalBars = Math.max(1, section.bars);
  const sectionEnd = totalBars * TICKS_PER_BAR;
  const bpm = input.bpm ?? song.bpm;
  const plan = resolveEnsembleSyncPlan({
    drumPatternId: input.drumPatternId ?? section.drumPatternId,
    masterGenreId: input.masterGenreId ?? song.members.pad.patternPreset,
    sectionType: section.type,
    bpm,
    padSkeleton: input.padSkeleton ?? section.padSkeleton,
    padTake: input.padTake ?? section.padTake ?? input.style,
  });

  const skeleton = plan.padSkeleton;
  const take = plan.padTake;
  const chordWindows = buildChordWindows(section, song.key, song.scale);

  // Determine drone pitches for PEDAL_DRONE: tonic + perfect 5th in C4(60)..G5(79)
  const tonicPc = noteNameToSemitone(song.key);
  const fifthPc = (tonicPc + 7) % 12;
  const droneTonic = clampCore(60 + tonicPc, 60, 74);
  const droneFifth = clampCore(
    droneTonic + ((fifthPc - tonicPc + 12) % 12),
    64,
    79
  );
  const dronePitchSet =
    skeleton === 'PEDAL_DRONE'
      ? new Set<number>([droneTonic, droneFifth])
      : new Set<number>();

  // Resolve chord voicings per window
  const gluedInput: Array<{ startTick: number; endTick: number; pitches: number[] }> = [];
  let prevVoicing: number[] | null = null;
  for (const w of chordWindows) {
    const pcs = getParsedChordPitchClasses(w.parsed);
    const rootPc = w.parsed.rootPitchClass;
    if (take === 'B') {
      // add9 / sus2 transparent 4-voice
      const add9Pc = (rootPc + 2) % 12;
      if (!pcs.includes(add9Pc)) pcs.push(add9Pc);
    }

    const baseVoicing = resolveSmoothVoicing({
      pitchClasses: pcs.slice(0, take === 'A' ? 3 : 4),
      prevVoicing,
      minMidi: plan.padRange.min,
      maxMidi: plan.padRange.max,
      preferDrop2: true,
    });
    prevVoicing = baseVoicing;

    let finalPitches = [...baseVoicing];
    if (take === 'C') {
      // Cinematic thick layer: low root pedal + high octave doubling
      const lowRoot = clampCore(48 + rootPc, 48, 59);
      const topDoubled = clampCore(baseVoicing[baseVoicing.length - 1] + 12, 60, 84);
      finalPitches = Array.from(new Set([lowRoot, ...finalPitches, topDoubled])).sort(
        (a, b) => a - b
      );
    }

    if (skeleton === 'PEDAL_DRONE') {
      finalPitches = finalPitches.filter((p) => !dronePitchSet.has(p));
    }

    gluedInput.push({
      startTick: w.startTick,
      endTick: w.endTick,
      pitches: finalPitches,
    });
  }

  const baseVel = clampCore(
    Math.round((take === 'C' ? 74 : take === 'B' ? 68 : 64) * plan.padVelocityScale),
    48,
    84
  );

  const chordNotes = glueAndOverlapVoicings(
    gluedInput,
    sectionEnd,
    baseVel,
    ch,
    30
  );

  const allNotes: MidiNote[] = [...chordNotes];
  if (skeleton === 'PEDAL_DRONE') {
    for (const dp of [droneTonic, droneFifth]) {
      allNotes.push({
        pitch: dp,
        velocity: clampCore(baseVel - 4, 46, 80),
        startTick: 0,
        durationTicks: sectionEnd,
        channel: ch,
      });
    }
  }

  const notes = sanitizeTrackNotes(allNotes, 5, sectionEnd);
  const controlChanges: MidiControlChangeEvent[] = [];

  if (skeleton === 'PEDAL_DRONE') {
    // 4-bar gentle sine wave CC#74 (56..88)
    const periodTicks = TICKS_PER_BAR * 4;
    for (let t = 0; t <= sectionEnd; t += 240) {
      const phase = (2 * Math.PI * (t % periodTicks)) / periodTicks;
      const val = clampCore(Math.round(72 + 16 * Math.sin(phase)), 56, 88);
      controlChanges.push({ tick: t, controller: 74, value: val, channel: ch });
    }
  } else if (skeleton === 'SIDECHAIN_PULSE') {
    // Sync CC#11 ducking to kickTicks (or 4-on-floor fallback)
    let kicks: number[] = [];
    if (input.kickTicks && input.kickTicks.length > 0) {
      kicks = Array.from(
        new Set(
          input.kickTicks
            .map((k) => Math.round(k))
            .filter((k) => k >= 0 && k < sectionEnd)
        )
      ).sort((a, b) => a - b);
    } else if (input.drumNotes && input.drumNotes.length > 0) {
      kicks = Array.from(
        new Set(
          input.drumNotes
            .filter((n) => (n.pitch === 35 || n.pitch === 36) && n.startTick >= 0 && n.startTick < sectionEnd)
            .map((n) => Math.round(n.startTick))
        )
      ).sort((a, b) => a - b);
    }
    if (kicks.length === 0) {
      for (let t = 0; t < sectionEnd; t += 480) kicks.push(t);
    }

    const ccMap = new Map<number, number>();
    for (let i = 0; i < kicks.length; i++) {
      const kTick = kicks[i];
      const nextKick = i + 1 < kicks.length ? kicks[i + 1] : sectionEnd;
      const recoveryLen = Math.min(360, Math.max(60, nextKick - kTick));
      for (let dt = 0; dt <= recoveryLen; dt += 60) {
        const tick = kTick + dt;
        if (tick > sectionEnd || tick >= nextKick) break;
        const ratio = recoveryLen > 0 ? dt / 360 : 1;
        const clampedRatio = Math.min(1, Math.max(0, ratio));
        const val = clampCore(
          Math.round(32 + (112 - 32) * (1 - Math.pow(1 - clampedRatio, 2.2))),
          0,
          127
        );
        ccMap.set(tick, val);
      }
    }
    for (const [tick, value] of Array.from(ccMap.entries()).sort((a, b) => a[0] - b[0])) {
      controlChanges.push({ tick, controller: 11, value, channel: ch });
    }
  } else if (skeleton === 'BUILDUP_SWELL') {
    // Power curve progress^1.6: CC#11 (44 -> 122) & CC#74 (36 -> 116)
    for (let t = 0; t <= sectionEnd; t += 240) {
      const progress = sectionEnd > 0 ? Math.min(1, t / sectionEnd) : 1;
      const curve = Math.pow(progress, 1.6);
      const expr = clampCore(Math.round(44 + (122 - 44) * curve), 0, 127);
      const cutoff = clampCore(Math.round(36 + (116 - 36) * curve), 0, 127);
      controlChanges.push({ tick: t, controller: 11, value: expr, channel: ch });
      controlChanges.push({ tick: t, controller: 74, value: cutoff, channel: ch });
    }
  }

  return { notes, controlChanges, skeleton, take, plan };
}

export function generatePadResult(
  input: EngineInput,
  context?: PadGenerationContext
): PadTrackResult {
  const { section, song } = input;
  const explicitSkeleton = input.padSkeleton ?? section.padSkeleton;
  const explicitDrum = input.drumPatternId ?? section.drumPatternId;
  const padPreset =
    section.patternPresets?.pad ??
    section.partPresets?.pad ??
    song.members.pad.patternPreset ??
    'auto';

  const shouldUseSkeletonEngine =
    !context &&
    ((explicitSkeleton && explicitSkeleton !== 'auto') ||
      (explicitDrum && explicitDrum !== 'auto' && padPreset === 'auto'));

  if (shouldUseSkeletonEngine) {
    return generatePadSkeletonTrack(input);
  }
  return {
    notes: generateLegacyPadNotes(input, context),
    controlChanges: [],
  };
}

export function generatePadNotes(
  input: EngineInput,
  context?: PadGenerationContext
): MidiNote[] {
  return generatePadResult(input, context).notes;
}

function generateLegacyPadNotes(
  input: EngineInput,
  context?: PadGenerationContext
): MidiNote[] {
  const { song, section } = input;
  if (!song.members.pad.enabled || section.enabledParts?.pad === false) {
    return [];
  }

  const padPreset =
    section.patternPresets?.pad ??
    section.partPresets?.pad ??
    song.members.pad.patternPreset ??
    'auto';

  const hasContextRefs = Boolean(
    context?.genreDna ||
      context?.vocalNotes ||
      context?.keyboardNotes ||
      context?.bassNotes ||
      context?.energy ||
      context?.sectionType ||
      input.vocalNotes ||
      input.keyboardNotes ||
      input.bassNotes
  );

  const isDirectDnaPreset = padPreset in PAD_GENRE_DNA_PROFILES;
  const useLegacyCompat =
    padPreset === 'jrock_anticipation' ||
    (!isDirectDnaPreset &&
      !hasContextRefs &&
      (LEGACY_EXACT_PRESETS.has(padPreset) || padPreset === 'auto'));

  const effectiveSeed = context?.seed ?? input.seed;
  const rng = mulberry32(effectiveSeed);
  const dna = resolvePadGenreDna(padPreset, context?.genreDna);
  const energy = normalizeEnergy(input, context);
  const sectionType = normalizeSectionType(input, context);
  const sectionEndTick = Math.max(1, section.bars) * BAR_TICKS;

  if (useLegacyCompat) {
    const legacyNotes = generateLegacyCompatiblePadNotes(input, rng);
    return finalizePadMidiNotes(
      legacyNotes,
      dna,
      energy,
      sectionType,
      sectionEndTick,
      rng,
      false
    );
  }

  // 5-Stage Next-Gen PAD Pipeline
  // Stage 1: Multi-Part Register & Timeline Analysis
  const { windows } = analyzePadContext(input, dna, context);

  // Stage 2: Open Voicing Candidates & Viterbi DP
  const voicings = solvePadVoicingsViterbi(windows, dna, energy, song.key, song.scale);

  // Stage 3: Spatial Tension & Sustain Expansion
  const expanded = expandPadSustainAndTensions(windows, voicings, dna, energy);

  // Stage 4: Dynamic Collision Guard & Active Chord Snap
  const guarded = guardCollisionsAndSnap(expanded, windows, dna, song.key, song.scale);

  // Stage 5: Gentle Velocity Tiers, Simultaneous Attack, Gap & Bounds Sanitizer
  return finalizePadMidiNotes(
    guarded,
    dna,
    energy,
    sectionType,
    sectionEndTick,
    rng,
    true
  );
}
