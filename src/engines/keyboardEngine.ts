import {
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type AccompanimentTake,
  type KeyboardSkeletonId,
  type MidiControlChangeEvent,
  type MidiNote,
} from '../types/song';
import {
  getActiveChordAtTick,
  getTimelineBoundaryChanges,
} from '../lib/chordTimeline';
import {
  fitPitchClassToRange,
  getScalePitchClasses,
  type ParsedChord,
} from '../lib/chordUtils';
import {
  buildChordWindows,
  clamp as clampCore,
  deriveSeed,
  findChordAtTick,
  findVocalRestGaps,
  getParsedChordPitchClasses,
  mapTickToSubdivision,
  mulberry32 as mulberry32Core,
  resolveSmoothVoicing,
  sanitizeTrackNotes,
} from './musicCore';
import {
  resolveEnsembleSyncPlan,
  type EnsembleSyncPlan,
} from './ensembleSync';
import type { EngineInput, ResolvedInstrumentParams } from './types';

export const PPQ = 480;
export const BEAT_TICKS = 480;
export const BAR_TICKS = 1920;
export const EIGHTH_TICKS = 240;
export const SIXTEENTH_TICKS = 120;

export type KeyboardGenreProfileId =
  | 'alt_shoegaze'
  | 'emo_jrock'
  | 'royal_jpop'
  | 'fusion_funk'
  | 'chill_lofi_ballad';

export interface KeyboardGenreDNA {
  id: KeyboardGenreProfileId;
  minMidi: number;
  maxMidi: number;
  obligatoMaxMidi: number;
  tensionRate: number;
  closedVoicingRatio: number;
  preferRootless: boolean;
  strumSpreadMs: [number, number];
  melodyLeadBias: boolean;
  rhythmStyle:
    | 'sustained_wall'
    | 'eighth_drive'
    | 'pop_syncopated'
    | 'sixteenth_comp'
    | 'lofi_sparse';
  obligatoMinRestTicks: number;
}

export const KEYBOARD_GENRE_DNA: Record<KeyboardGenreProfileId, KeyboardGenreDNA> = {
  alt_shoegaze: {
    id: 'alt_shoegaze',
    minMidi: 48,
    maxMidi: 72,
    obligatoMaxMidi: 76,
    tensionRate: 0.25,
    closedVoicingRatio: 0.2,
    preferRootless: false,
    strumSpreadMs: [0, 8],
    melodyLeadBias: false,
    rhythmStyle: 'sustained_wall',
    obligatoMinRestTicks: 960,
  },
  emo_jrock: {
    id: 'emo_jrock',
    minMidi: 52,
    maxMidi: 72,
    obligatoMaxMidi: 76,
    tensionRate: 0.45,
    closedVoicingRatio: 0.4,
    preferRootless: true,
    strumSpreadMs: [4, 12],
    melodyLeadBias: true,
    rhythmStyle: 'eighth_drive',
    obligatoMinRestTicks: 960,
  },
  royal_jpop: {
    id: 'royal_jpop',
    minMidi: 50,
    maxMidi: 72,
    obligatoMaxMidi: 79,
    tensionRate: 0.55,
    closedVoicingRatio: 0.65,
    preferRootless: true,
    strumSpreadMs: [10, 22],
    melodyLeadBias: true,
    rhythmStyle: 'pop_syncopated',
    obligatoMinRestTicks: 960,
  },
  fusion_funk: {
    id: 'fusion_funk',
    minMidi: 48,
    maxMidi: 74,
    obligatoMaxMidi: 81,
    tensionRate: 0.85,
    closedVoicingRatio: 0.85,
    preferRootless: true,
    strumSpreadMs: [3, 10],
    melodyLeadBias: false,
    rhythmStyle: 'sixteenth_comp',
    obligatoMinRestTicks: 960,
  },
  chill_lofi_ballad: {
    id: 'chill_lofi_ballad',
    minMidi: 51,
    maxMidi: 75,
    obligatoMaxMidi: 79,
    tensionRate: 0.9,
    closedVoicingRatio: 0.5,
    preferRootless: true,
    strumSpreadMs: [18, 40],
    melodyLeadBias: true,
    rhythmStyle: 'lofi_sparse',
    obligatoMinRestTicks: 720,
  },
};

export interface ChordSegment {
  index: number;
  startTick: number;
  endTick: number;
  parsed: ParsedChord;
  isOffbeatAnticipation: boolean;
  vocalActive: boolean;
  vocalMinPitch: number | null;
  vocalAvgPitch: number | null;
  vocalMaxPitch: number | null;
}

export interface VocalRestGap {
  startTick: number;
  endTick: number;
  nextVocalStartTick: number | null;
}

export interface KeyboardAnalysisContext {
  sectionStartTick: number;
  sectionEndTick: number;
  segments: ChordSegment[];
  vocalRestGaps: VocalRestGap[];
  drumAccentTicks: Set<number>;
  bassAccentTicks: Set<number>;
  hasExplicitVocal: boolean;
}

interface InternalKeyboardNote {
  pitch: number;
  velocity: number;
  startTick: number;
  durationTicks: number;
  groupId?: number;
  voiceRole?: 'top' | 'inner' | 'bass' | 'single' | 'obligato';
  allowStrum?: boolean;
  isBeatHead?: boolean;
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

function rngInt(rng: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

/** Deterministic mapping from all existing preset IDs and genre IDs to 5 KeyboardGenreDNA profiles. */
export function resolveKeyboardGenreDNA(
  presetId: string | undefined,
  keyboardStyle?: string
): KeyboardGenreDNA {
  const id = (presetId ?? 'auto').trim();
  if (id in KEYBOARD_GENRE_DNA) {
    return KEYBOARD_GENRE_DNA[id as KeyboardGenreProfileId];
  }

  switch (id) {
    case 'whole_sustain':
    case 'floating_tension':
    case 'dark_low_riff':
    case 'electronica_polyrhythm':
    case 'electronica_minimal_ostinato':
      return KEYBOARD_GENRE_DNA.alt_shoegaze;
    case 'chord_eighth':
    case 'rock_power_riff':
    case 'emo_arp_cascade':
    case 'jrock_anticipation':
    case 'arp_up':
    case 'arp_down_up':
    case 'arp_16th':
    case 'synth_pluck_arp':
      return KEYBOARD_GENRE_DNA.emo_jrock;
    case 'fusion_ep_comp':
    case 'fusion_brass_stab':
    case 'fusion_fast_arp':
    case 'funk_16th_clav':
    case 'disco_boogie_bounce':
    case 'gospel_rich_comp':
    case 'electronica_glitch_arp':
      return KEYBOARD_GENRE_DNA.fusion_funk;
    case 'chord_quarter':
    case 'syncopated_comp':
    case 'broken_chord':
    case 'counter_melody':
    case 'offbeat_ska':
    case 'auto':
    default: {
      if (keyboardStyle === 'Long Sustain') {
        return KEYBOARD_GENRE_DNA.alt_shoegaze;
      }
      return KEYBOARD_GENRE_DNA.royal_jpop;
    }
  }
}

// ===========================================================================
// Stage 1: Vocal Range & Timeline "Kime" Analysis
// ===========================================================================
export function analyzeKeyboardContext(
  input: EngineInput,
  dna: KeyboardGenreDNA
): KeyboardAnalysisContext {
  const { song, section, vocalNotes, prevVocalAvgPitch, drumNotes, bassNotes } = input;
  const sectionStartTick = 0;
  const sectionEndTick = Math.max(1, section.bars) * BAR_TICKS;

  const boundaryChanges = getTimelineBoundaryChanges(
    section.chords,
    section.bars,
    song.key,
    song.scale
  );

  const changeMap = new Map<number, { isOffbeat: boolean }>();
  changeMap.set(0, { isOffbeat: false });
  for (const ch of boundaryChanges) {
    if (ch.changeTick > 0 && ch.changeTick < sectionEndTick) {
      changeMap.set(ch.changeTick, { isOffbeat: ch.isOffbeat });
    }
  }

  const kbPreset =
    section.patternPresets?.keyboard ??
    section.partPresets?.keyboard ??
    song.members.keyboard.patternPreset ??
    'auto';
  if (kbPreset === 'jrock_anticipation') {
    for (let bar = 0; bar < section.bars - 1; bar++) {
      const antTick = bar * BAR_TICKS + 1680;
      const nextBarTick = (bar + 1) * BAR_TICKS;
      if (antTick < sectionEndTick) {
        changeMap.delete(nextBarTick);
        changeMap.set(antTick, { isOffbeat: true });
      }
    }
  }

  const sortedTicks = Array.from(changeMap.keys()).sort((a, b) => a - b);
  const validVocalNotes = (vocalNotes ?? [])
    .filter((n) => n.startTick < sectionEndTick && n.startTick + n.durationTicks > 0)
    .slice()
    .sort((a, b) => a.startTick - b.startTick);
  const hasExplicitVocal = validVocalNotes.length > 0;

  const segments: ChordSegment[] = [];
  for (let i = 0; i < sortedTicks.length; i++) {
    const startTick = sortedTicks[i];
    const endTick = i + 1 < sortedTicks.length ? sortedTicks[i + 1] : sectionEndTick;
    if (endTick <= startTick) continue;

    const nextTickAt = i + 1 < sortedTicks.length ? sortedTicks[i + 1] : sectionEndTick;
    const queryTick =
      kbPreset === 'jrock_anticipation' && changeMap.get(startTick)?.isOffbeat
        ? Math.min(sectionEndTick - 1, nextTickAt)
        : startTick;
    const parsed = getActiveChordAtTick(
      section.chords,
      queryTick,
      song.key,
      song.scale,
      section.bars
    ).parsed;

    const overlappingVocals = validVocalNotes.filter(
      (vn) => vn.startTick < endTick && vn.startTick + vn.durationTicks > startTick
    );

    let vocalActive = false;
    let vocalMinPitch: number | null = null;
    let vocalAvgPitch: number | null = null;
    let vocalMaxPitch: number | null = null;

    if (overlappingVocals.length > 0) {
      vocalActive = true;
      vocalMinPitch = Math.min(...overlappingVocals.map((v) => v.pitch));
      vocalMaxPitch = Math.max(...overlappingVocals.map((v) => v.pitch));
      vocalAvgPitch =
        overlappingVocals.reduce((sum, v) => sum + v.pitch, 0) / overlappingVocals.length;
    } else if (!hasExplicitVocal && prevVocalAvgPitch !== undefined) {
      vocalActive = true;
      vocalMinPitch = Math.round(prevVocalAvgPitch - 2);
      vocalAvgPitch = prevVocalAvgPitch;
      vocalMaxPitch = Math.round(prevVocalAvgPitch + 4);
    }

    segments.push({
      index: segments.length,
      startTick,
      endTick,
      parsed,
      isOffbeatAnticipation: changeMap.get(startTick)?.isOffbeat ?? false,
      vocalActive,
      vocalMinPitch,
      vocalAvgPitch,
      vocalMaxPitch,
    });
  }

  // Extract VocalRestGap[] when explicit vocalNotes are provided
  const vocalRestGaps: VocalRestGap[] = [];
  if (hasExplicitVocal) {
    let cursor = sectionStartTick;
    for (const vn of validVocalNotes) {
      const vStart = Math.max(sectionStartTick, vn.startTick);
      const vEnd = Math.min(sectionEndTick, vn.startTick + vn.durationTicks);
      if (vStart > cursor) {
        const gapLen = vStart - cursor;
        if (gapLen >= dna.obligatoMinRestTicks) {
          vocalRestGaps.push({
            startTick: cursor,
            endTick: vStart,
            nextVocalStartTick: vStart,
          });
        }
      }
      cursor = Math.max(cursor, vEnd);
    }
    if (sectionEndTick - cursor >= dna.obligatoMinRestTicks) {
      vocalRestGaps.push({
        startTick: cursor,
        endTick: sectionEndTick,
        nextVocalStartTick: null,
      });
    }
  }

  const drumAccentTicks = new Set<number>();
  for (const dn of drumNotes ?? []) {
    if (dn.pitch === 36 || dn.pitch === 38 || dn.pitch === 49 || dn.pitch === 52 || dn.pitch === 57) {
      drumAccentTicks.add(dn.startTick);
    }
  }

  const bassAccentTicks = new Set<number>();
  for (const bn of bassNotes ?? []) {
    bassAccentTicks.add(bn.startTick);
  }

  return {
    sectionStartTick,
    sectionEndTick,
    segments,
    vocalRestGaps,
    drumAccentTicks,
    bassAccentTicks,
    hasExplicitVocal,
  };
}

// ===========================================================================
// Stage 2: Optimal Voice Leading (Viterbi DP + Beam Search)
// ===========================================================================
function getGuideTonePcs(parsed: ParsedChord): number[] {
  const pcs: number[] = [];
  for (const iv of [3, 4, 10, 11, 9, 6]) {
    if (parsed.intervals.includes(iv)) {
      pcs.push((parsed.rootSemitone + iv) % 12);
    }
  }
  return pcs;
}

function buildChordPitchClassPool(
  parsed: ParsedChord,
  dna: KeyboardGenreDNA,
  params: ResolvedInstrumentParams,
  forceFullTriad: boolean,
  rng: () => number
): number[] {
  const rootPc = parsed.rootPitchClass;
  const ivSet = new Set<number>(parsed.intervals);

  if (params.sus2 && !ivSet.has(2)) {
    ivSet.delete(3);
    ivSet.delete(4);
    ivSet.add(2);
  }

  if (
    !forceFullTriad &&
    dna.id === 'alt_shoegaze' &&
    !ivSet.has(6) &&
    rng() < dna.tensionRate
  ) {
    ivSet.add(14);
  } else if (!forceFullTriad && rng() < dna.tensionRate) {
    if (!ivSet.has(6) && !ivSet.has(10) && !ivSet.has(11) && !ivSet.has(9)) {
      ivSet.add(parsed.quality === 'minor' ? 10 : 11);
    }
    if (!ivSet.has(6) && !ivSet.has(14)) {
      ivSet.add(14);
    }
    if ((dna.id === 'fusion_funk' || dna.id === 'chill_lofi_ballad') && !ivSet.has(6)) {
      ivSet.add(9); // 13th
    }
  }

  if (params.add7 && !ivSet.has(9) && !ivSet.has(10) && !ivSet.has(11)) {
    ivSet.add(ivSet.has(6) ? 9 : 11);
  }
  if (params.add9 && !ivSet.has(6)) {
    ivSet.add(14);
  }

  const pcs: number[] = [];
  const hasSlashBass =
    parsed.bassPitchClass !== undefined && parsed.bassPitchClass !== rootPc;

  for (const iv of ivSet) {
    const pc = (rootPc + iv) % 12;
    // Rootless Type A/B drops root when preferRootless=true and not forced/slash-bass
    if (
      !forceFullTriad &&
      dna.preferRootless &&
      !hasSlashBass &&
      iv === 0 &&
      ivSet.size >= 4
    ) {
      continue;
    }
    if (!pcs.includes(pc)) pcs.push(pc);
  }

  if (hasSlashBass && parsed.bassPitchClass !== undefined) {
    if (!pcs.includes(parsed.bassPitchClass)) {
      pcs.unshift(parsed.bassPitchClass);
    }
  }

  if (pcs.length === 0) {
    for (const iv of parsed.intervals) {
      const pc = (rootPc + iv) % 12;
      if (!pcs.includes(pc)) pcs.push(pc);
    }
  }

  return pcs;
}

function passesLowIntervalLimit(voicing: number[]): boolean {
  for (let i = 0; i + 1 < voicing.length; i++) {
    if (voicing[i] < 48 && voicing[i + 1] - voicing[i] < 4) {
      return false;
    }
  }
  return true;
}

function generateCandidateVoicings(
  seg: ChordSegment,
  dna: KeyboardGenreDNA,
  params: ResolvedInstrumentParams,
  kbPreset: string,
  minMidi: number,
  maxMidi: number,
  rng: () => number
): number[][] {
  const forceFullTriad =
    kbPreset === 'whole_sustain' ||
    kbPreset === 'rock_power_riff' ||
    kbPreset === 'dark_low_riff';
  const pcs = buildChordPitchClassPool(seg.parsed, dna, params, forceFullTriad, rng);

  // Determine effective vocal ceiling
  const hasVocalCeiling = seg.vocalActive && seg.vocalMinPitch !== null;
  const hardCeiling = hasVocalCeiling ? (seg.vocalMinPitch as number) - 3 : maxMidi;
  const allowAboveFallback =
    hasVocalCeiling &&
    hardCeiling < minMidi + 5 &&
    seg.vocalMaxPitch !== null;

  const searchMin = Math.min(minMidi, hardCeiling - 12);
  const searchMax = allowAboveFallback
    ? Math.max(maxMidi, (seg.vocalMaxPitch as number) + 14)
    : Math.max(minMidi + 7, Math.min(maxMidi, hardCeiling + 4));

  const rawCandidates: number[][] = [];
  const baseCount = Math.min(4, Math.max(2, pcs.length));

  // Enumerate inversions and octave shifts
  for (let inv = 0; inv < pcs.length; inv++) {
    const rotated = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    const chosenPcs = rotated.slice(0, baseCount);

    for (let baseOct = Math.floor(searchMin / 12) * 12; baseOct <= searchMax; baseOct += 12) {
      const closed: number[] = [];
      let prev = baseOct - 1;
      for (const pc of chosenPcs) {
        let p = baseOct + pc;
        while (p <= prev) p += 12;
        if (p < searchMin) p += 12;
        closed.push(p);
        prev = p;
      }
      if (
        closed.length >= 2 &&
        closed[0] >= Math.max(36, minMidi - 6) &&
        closed[closed.length - 1] <= searchMax
      ) {
        rawCandidates.push(closed);
      }

      // Ceiling-fitted inversion: fold any pitch > hardCeiling down by octaves when vocal ceiling active
      if (hasVocalCeiling && !allowAboveFallback) {
        const folded = closed
          .map((p) => {
            let fp = p;
            while (fp > hardCeiling && fp - 12 >= 36) fp -= 12;
            return fp;
          })
          .filter((v, idx, arr) => arr.indexOf(v) === idx)
          .sort((a, b) => a - b);
        if (folded.length >= 2 && folded[folded.length - 1] <= hardCeiling && folded[0] >= 36) {
          rawCandidates.push(folded);
        }
      }

      // Open / Drop-2 variant when closedVoicingRatio < 0.85
      if (closed.length >= 3 && dna.closedVoicingRatio < 0.85) {
        const drop2 = closed.slice();
        const secondTop = drop2[drop2.length - 2];
        if (secondTop - 12 >= Math.max(36, minMidi - 6)) {
          drop2[drop2.length - 2] = secondTop - 12;
          drop2.sort((a, b) => a - b);
          rawCandidates.push(drop2);
        }
      }
    }
  }

  // Above-vocal sparse 2-3 note fallback when low vocal compresses range
  if (allowAboveFallback && seg.vocalMaxPitch !== null) {
    const aboveMin = seg.vocalMaxPitch + 7;
    const aboveMax = Math.min(92, aboveMin + 14);
    const sparsePcs = pcs.slice(0, Math.min(3, pcs.length));
    const sparse: number[] = [];
    let prev = aboveMin - 1;
    for (const pc of sparsePcs) {
      let p = fitPitchClassToRange(pc, aboveMin, aboveMax);
      while (p <= prev && p + 12 <= aboveMax) p += 12;
      if (p <= aboveMax) {
        sparse.push(p);
        prev = p;
      }
    }
    if (sparse.length >= 2) {
      rawCandidates.push(sparse);
    }
  }

  // Deduplicate and apply LIL filter
  const uniqueMap = new Map<string, number[]>();
  for (const c of rawCandidates) {
    const key = c.join(',');
    if (!uniqueMap.has(key)) uniqueMap.set(key, c);
  }
  const unique = Array.from(uniqueMap.values());
  const ceilingSafe =
    hasVocalCeiling && !allowAboveFallback
      ? unique.filter((c) => c[c.length - 1] <= hardCeiling)
      : [];
  const baseUnique = ceilingSafe.length > 0 ? ceilingSafe : unique;
  const lilFiltered = baseUnique.filter(passesLowIntervalLimit);
  const pool = lilFiltered.length > 0 ? lilFiltered : baseUnique;

  // Deterministic sort by register center & vocal safety & guide tone coverage, capped at 30
  const targetCenter = hasVocalCeiling
    ? Math.max(minMidi + 4, hardCeiling - 6)
    : Math.round((minMidi + maxMidi) / 2);
  const guidePcs = new Set(getGuideTonePcs(seg.parsed));

  pool.sort((a, b) => {
    const topA = a[a.length - 1];
    const topB = b[b.length - 1];
    const overA = hasVocalCeiling && topA > hardCeiling ? (topA - hardCeiling) * 20 : 0;
    const overB = hasVocalCeiling && topB > hardCeiling ? (topB - hardCeiling) * 20 : 0;
    const centerA = (a[0] + topA) / 2;
    const centerB = (b[0] + topB) / 2;
    const guideA = a.filter((p) => guidePcs.has(p % 12)).length;
    const guideB = b.filter((p) => guidePcs.has(p % 12)).length;
    const scoreA = overA + Math.abs(centerA - targetCenter) - guideA * 2;
    const scoreB = overB + Math.abs(centerB - targetCenter) - guideB * 2;
    return scoreA - scoreB || a[0] - b[0] || topA - topB;
  });

  if (pool.length === 0) {
    const fallbackRoot = fitPitchClassToRange(
      seg.parsed.rootPitchClass,
      minMidi,
      Math.min(minMidi + 12, maxMidi)
    );
    return [[fallbackRoot, Math.min(maxMidi, fallbackRoot + 7)]];
  }

  return pool.slice(0, 30);
}

function transitionCost(
  prevVoicing: number[],
  currVoicing: number[],
  prevSeg: ChordSegment,
  currSeg: ChordSegment,
  minMidi: number,
  maxMidi: number
): number {
  const wCommon = 1.5;
  const wMove = 0.6;
  const wTop = 1.1;
  const wReg = 0.4;
  const wVoc = 12.0;
  const wGuide = 1.5;

  const len = Math.min(prevVoicing.length, currVoicing.length);
  let moveSum = 0;
  for (let i = 0; i < len; i++) {
    moveSum += Math.abs(currVoicing[i] - prevVoicing[i]);
  }
  const prevTop = prevVoicing[prevVoicing.length - 1];
  const currTop = currVoicing[currVoicing.length - 1];
  const topMove = Math.abs(currTop - prevTop);

  const prevSet = new Set(prevVoicing);
  let commonCount = 0;
  for (const p of currVoicing) {
    if (prevSet.has(p)) commonCount++;
  }

  const regCenter = (minMidi + maxMidi) / 2;
  const currCenter = (currVoicing[0] + currTop) / 2;
  const regDist = Math.abs(currCenter - regCenter);

  let vocalPenalty = 0;
  if (currSeg.vocalActive && currSeg.vocalMinPitch !== null) {
    const hardCeiling = currSeg.vocalMinPitch - 3;
    const isAboveBypass =
      currSeg.vocalMaxPitch !== null && currVoicing[0] >= currSeg.vocalMaxPitch + 7;
    if (!isAboveBypass && currTop > hardCeiling) {
      vocalPenalty += (currTop - hardCeiling) * 1.5 + 2.0;
    }
    const thirdPc = currSeg.parsed.intervals.includes(3)
      ? (currSeg.parsed.rootPitchClass + 3) % 12
      : currSeg.parsed.intervals.includes(4)
        ? (currSeg.parsed.rootPitchClass + 4) % 12
        : -1;
    if (
      currSeg.vocalAvgPitch !== null &&
      (currTop % 12 === Math.round(currSeg.vocalAvgPitch) % 12 ||
        (thirdPc !== -1 && currTop % 12 === thirdPc && Math.abs(currTop - currSeg.vocalAvgPitch) <= 2))
    ) {
      vocalPenalty += 1.5;
    }
  }

  // Guide tone voice-leading reward/penalty (especially for dim7, tritone sub, dominant)
  const prevGuides = getGuideTonePcs(prevSeg.parsed);
  const currChordPcs = new Set(
    currSeg.parsed.intervals.map((iv) => (currSeg.parsed.rootPitchClass + iv) % 12)
  );
  let guidePenalty = 0;
  for (const gp of prevGuides) {
    const prevNote = prevVoicing.find((p) => p % 12 === gp);
    if (prevNote === undefined) continue;
    let minSemi = 12;
    for (const cn of currVoicing) {
      if (currChordPcs.has(cn % 12)) {
        minSemi = Math.min(minSemi, Math.abs(cn - prevNote));
      }
    }
    if (minSemi <= 1) guidePenalty -= 1.5;
    else if (minSemi <= 2) guidePenalty -= 0.8;
    else guidePenalty += (minSemi - 2) * 0.6;
  }

  const lilPenalty = passesLowIntervalLimit(currVoicing) ? 0 : 30;

  return (
    wMove * moveSum +
    wTop * topMove -
    wCommon * commonCount +
    wReg * regDist +
    wVoc * vocalPenalty +
    wGuide * guidePenalty +
    lilPenalty
  );
}

export function solveOptimalVoiceLeading(
  ctx: KeyboardAnalysisContext,
  dna: KeyboardGenreDNA,
  params: ResolvedInstrumentParams,
  kbPreset: string,
  minMidi: number,
  maxMidi: number,
  rng: () => number
): number[][] {
  const segs = ctx.segments;
  if (segs.length === 0) return [];

  const candidatesPerSeg = segs.map((seg) =>
    generateCandidateVoicings(seg, dna, params, kbPreset, minMidi, maxMidi, rng)
  );

  interface BeamNode {
    candIdx: number;
    cost: number;
    prevBeamIdx: number;
  }

  const BEAM_WIDTH = 20;
  const regCenter = (minMidi + maxMidi) / 2;

  // Step 0
  const beamLayers: BeamNode[][] = [];
  const layer0: BeamNode[] = candidatesPerSeg[0].map((cand, idx) => {
    const top = cand[cand.length - 1];
    const center = (cand[0] + top) / 2;
    let vocPen = 0;
    if (segs[0].vocalActive && segs[0].vocalMinPitch !== null) {
      const ceil = segs[0].vocalMinPitch - 3;
      const isAbove =
        segs[0].vocalMaxPitch !== null && cand[0] >= segs[0].vocalMaxPitch + 7;
      if (!isAbove && top > ceil) {
        vocPen = ((top - ceil) * 1.5 + 2.0) * 12.0;
      }
    }
    return {
      candIdx: idx,
      cost: Math.abs(center - regCenter) * 0.4 + vocPen,
      prevBeamIdx: -1,
    };
  });
  layer0.sort((a, b) => a.cost - b.cost || a.candIdx - b.candIdx);
  beamLayers.push(layer0.slice(0, BEAM_WIDTH));

  // DP Steps 1..N-1
  for (let s = 1; s < segs.length; s++) {
    const prevLayer = beamLayers[s - 1];
    const currCands = candidatesPerSeg[s];
    const nextNodes: BeamNode[] = [];

    for (let cIdx = 0; cIdx < currCands.length; cIdx++) {
      let bestCost = Infinity;
      let bestPrevBeamIdx = 0;
      for (let bIdx = 0; bIdx < prevLayer.length; bIdx++) {
        const prevNode = prevLayer[bIdx];
        const prevCand = candidatesPerSeg[s - 1][prevNode.candIdx];
        const tc = transitionCost(
          prevCand,
          currCands[cIdx],
          segs[s - 1],
          segs[s],
          minMidi,
          maxMidi
        );
        const total = prevNode.cost + tc;
        if (total < bestCost) {
          bestCost = total;
          bestPrevBeamIdx = bIdx;
        }
      }
      nextNodes.push({
        candIdx: cIdx,
        cost: bestCost,
        prevBeamIdx: bestPrevBeamIdx,
      });
    }

    nextNodes.sort((a, b) => a.cost - b.cost || a.candIdx - b.candIdx);
    beamLayers.push(nextNodes.slice(0, BEAM_WIDTH));
  }

  // Backtrace
  const result: number[][] = new Array(segs.length);
  let currBeamIdx = 0;
  for (let s = segs.length - 1; s >= 0; s--) {
    const node = beamLayers[s][currBeamIdx];
    result[s] = candidatesPerSeg[s][node.candIdx];
    currBeamIdx = Math.max(0, node.prevBeamIdx);
  }

  return result;
}

// ===========================================================================
// Stage 3: Genre Backing & Arpeggio Expansion
// ===========================================================================
function getSegmentAtTick(segments: ChordSegment[], tick: number): ChordSegment {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (tick >= segments[i].startTick) return segments[i];
  }
  return segments[0];
}

function getSegmentIndexAtTick(segments: ChordSegment[], tick: number): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (tick >= segments[i].startTick) return i;
  }
  return 0;
}

function buildArpPool(
  voicing: number[],
  kbPreset: string,
  minP: number,
  maxP: number
): number[] {
  if (kbPreset === 'arp_down_up' && voicing.length > 1) {
    return [...voicing, ...voicing.slice(0, -1).reverse()];
  }
  if (kbPreset === 'broken_chord') {
    if (voicing.length >= 4) {
      return [voicing[0], voicing[2], voicing[1], voicing[3]];
    }
    if (voicing.length === 3) {
      return [voicing[0], voicing[2], voicing[1], voicing[2]];
    }
    return voicing;
  }
  if (kbPreset === 'emo_arp_cascade' && voicing.length > 2) {
    return [...voicing.slice().reverse(), ...voicing.slice(1)];
  }
  if (kbPreset === 'synth_pluck_arp') {
    return [...voicing, ...voicing.map((p) => Math.min(maxP, p + 12))];
  }
  if (kbPreset === 'fusion_fast_arp') {
    const ext = voicing.map((p) => Math.min(Math.max(maxP, 88), p + 12));
    return [...voicing, ...ext].filter((v, idx, arr) => arr.indexOf(v) === idx);
  }
  // Ensure at least minP..maxP safety
  void minP;
  return voicing;
}

export function expandBackingAndArpeggio(
  input: EngineInput,
  ctx: KeyboardAnalysisContext,
  dna: KeyboardGenreDNA,
  voicings: number[][],
  kbPreset: string,
  rng: () => number
): InternalKeyboardNote[] {
  const { song, section, style, params } = input;
  const sectionEnd = ctx.sectionEndTick;
  const playStyle = song.members.keyboard.keyboardStyle ?? 'Rhythm Backing';
  const keyboardDensity = input.keyboardDensity ?? section.keyboardDensity ?? 4;
  const baseVel = section.energy === 'High' ? 92 : section.energy === 'Low' ? 68 : 82;
  const notes: InternalKeyboardNote[] = [];
  let nextGroupId = 1;

  const pushChord = (
    tick: number,
    dur: number,
    voicing: number[],
    vel: number,
    allowStrum = true
  ) => {
    if (tick < 0 || tick >= sectionEnd || dur <= 0) return;
    const gid = nextGroupId++;
    const isBeatHead = tick % BEAT_TICKS === 0;
    for (let i = 0; i < voicing.length; i++) {
      const role: InternalKeyboardNote['voiceRole'] =
        voicing.length === 1
          ? 'single'
          : i === voicing.length - 1
            ? 'top'
            : i === 0
              ? 'bass'
              : 'inner';
      notes.push({
        pitch: voicing[i],
        velocity: vel,
        startTick: tick,
        durationTicks: dur,
        groupId: gid,
        voiceRole: role,
        allowStrum: allowStrum && voicing.length >= 2,
        isBeatHead,
      });
    }
  };

  // Special cross-bar polyrhythm preset
  if (kbPreset === 'electronica_polyrhythm') {
    const stepTicks = keyboardDensity <= 1 ? 1440 : keyboardDensity === 2 ? 720 : 360;
    const motif = [0, 7, 14, 12];
    let stepIdx = 0;
    for (let t = 0; t < sectionEnd; t += stepTicks) {
      const chord = getActiveChordAtTick(
        section.chords,
        t,
        song.key,
        song.scale,
        section.bars
      ).parsed;
      const rootMidi = fitPitchClassToRange(chord.rootSemitone, 60, 71);
      const pitch = Math.min(88, rootMidi + motif[stepIdx % motif.length]);
      const dur = Math.max(1, Math.min(stepTicks >= 720 ? 320 : 180, sectionEnd - t));
      notes.push({
        pitch,
        velocity: clampVelocity(baseVel + (stepIdx % 3 === 0 ? 8 : -6) + rngInt(rng, -4, 4)),
        startTick: t,
        durationTicks: dur,
        voiceRole: 'single',
        allowStrum: false,
      });
      if (keyboardDensity >= 6 && stepIdx % 2 === 1 && t + 180 < sectionEnd) {
        notes.push({
          pitch: Math.min(92, pitch + 12),
          velocity: clampVelocity(baseVel - 10),
          startTick: t + 180,
          durationTicks: Math.max(1, Math.min(120, sectionEnd - (t + 180))),
          voiceRole: 'single',
          allowStrum: false,
        });
      }
      if (keyboardDensity === 7 && stepIdx % 2 === 0 && t + 120 < sectionEnd) {
        notes.push({
          pitch: Math.min(96, pitch + 7),
          velocity: clampVelocity(baseVel - 14),
          startTick: t + 120,
          durationTicks: Math.max(1, Math.min(90, sectionEnd - (t + 120))),
          voiceRole: 'single',
          allowStrum: false,
        });
      }
      stepIdx++;
    }
    return notes;
  }

  const allowLegacyAutoStrum = !(
    kbPreset === 'auto' &&
    !input.vocalNotes &&
    input.bpm === undefined
  );

  // Whole sustain / Long Sustain / jrock_anticipation segment-based sustain
  if (
    kbPreset === 'whole_sustain' ||
    kbPreset === 'floating_tension' ||
    kbPreset === 'jrock_anticipation' ||
    (kbPreset === 'auto' && playStyle === 'Long Sustain')
  ) {
    const allowStrumHere =
      kbPreset !== 'whole_sustain' &&
      kbPreset !== 'jrock_anticipation' &&
      allowLegacyAutoStrum;
    for (let s = 0; s < ctx.segments.length; s++) {
      const seg = ctx.segments[s];
      let voicing = voicings[s] ?? [60, 64, 67];
      if (
        kbPreset === 'whole_sustain' ||
        kbPreset === 'jrock_anticipation' ||
        !allowLegacyAutoStrum
      ) {
        // Ensure all chord pitch classes are represented clearly
        const rootMidi = fitPitchClassToRange(seg.parsed.rootSemitone, 60, 71);
        const ivs = new Set<number>(seg.parsed.intervals);
        if (!allowLegacyAutoStrum) {
          if (params.sus2 && !ivs.has(2)) {
            ivs.delete(3);
            ivs.delete(4);
            ivs.add(2);
          }
          if (params.add7 && !ivs.has(9) && !ivs.has(10) && !ivs.has(11)) {
            ivs.add(ivs.has(6) ? 9 : 11);
          }
          if (params.add9 && !ivs.has(6)) {
            ivs.add(14);
          }
        }
        const full = Array.from(ivs)
          .map((iv) => {
            let p = rootMidi + iv;
            while (p > 84) p -= 12;
            return p;
          })
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .sort((a, b) => a - b);
        if (full.length >= 2) voicing = full;
      }
      const isLast = s === ctx.segments.length - 1;
      const nextSeg = !isLast ? ctx.segments[s + 1] : null;
      const gap = nextSeg ? 12 : 20;
      const dur = Math.max(60, seg.endTick - seg.startTick - gap);
      pushChord(seg.startTick, dur, voicing, baseVel - 4, allowStrumHere);
    }
    return notes;
  }

  // Arpeggio family presets (monotonic 1..7 density scaling)
  const isArpPreset =
    kbPreset === 'arp_up' ||
    kbPreset === 'arp_down_up' ||
    kbPreset === 'arp_16th' ||
    kbPreset === 'broken_chord' ||
    kbPreset === 'emo_arp_cascade' ||
    kbPreset === 'synth_pluck_arp' ||
    kbPreset === 'fusion_fast_arp' ||
    (kbPreset === 'auto' && playStyle === 'Arpeggio');

  if (isArpPreset) {
    const arpCounts = [1, 2, 5, 8, 11, 14, 18] as const;
    const notesPerBar = arpCounts[Math.max(0, Math.min(6, keyboardDensity - 1))];
    const isPluck = kbPreset === 'synth_pluck_arp';

    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * BAR_TICKS;
      const barEnd = Math.min(sectionEnd, barStart + BAR_TICKS);

      for (let idx = 0; idx < notesPerBar; idx++) {
        const rawTick = barStart + Math.floor((idx * BAR_TICKS) / notesPerBar);
        const tick = Math.min(barEnd - 60, rawTick);
        if (tick < 0 || tick >= sectionEnd) continue;

        const segIdx = getSegmentIndexAtTick(ctx.segments, tick);
        const seg = ctx.segments[segIdx];
        const voicing = voicings[segIdx] ?? [60, 64, 67];
        const pool = buildArpPool(voicing, kbPreset, 60, 88);
        const pitch = pool[idx % pool.length];
        const nextTick =
          idx + 1 < notesPerBar
            ? barStart + Math.floor(((idx + 1) * BAR_TICKS) / notesPerBar)
            : barEnd;
        const maxDur = Math.max(40, Math.min(nextTick, seg.endTick) - tick - 12);
        const dur = isPluck ? Math.min(65, maxDur) : Math.min(maxDur, notesPerBar <= 2 ? 900 : 220);
        notes.push({
          pitch,
          velocity: clampVelocity(baseVel + (idx % 4 === 0 ? 6 : -4)),
          startTick: tick,
          durationTicks: Math.max(30, dur),
          voiceRole: 'single',
          allowStrum: false,
          isBeatHead: tick % BEAT_TICKS === 0,
        });
      }
    }
    return notes;
  }

  // Per-bar / grid presets and 5-genre rhythmStyle expansions
  const densityScale = Math.max(1, Math.min(7, keyboardDensity));

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * BAR_TICKS;
    const barEnd = Math.min(sectionEnd, barStart + BAR_TICKS);
    const barChanges = ctx.segments.filter(
      (s) => s.startTick > barStart && s.startTick < barEnd && s.isOffbeatAnticipation
    );
    const hasEndAnticipation = barChanges.some((c) => Math.abs(c.startTick - (barStart + 1680)) <= 30);
    const barStartSegIdx = getSegmentIndexAtTick(ctx.segments, barStart);
    const barStartSeg = ctx.segments[barStartSegIdx];
    const skipDownbeat = barStartSeg.isOffbeatAnticipation && barStartSeg.startTick < barStart;

    if (kbPreset === 'offbeat_ska') {
      for (const off of [240, 720, 1200, 1680]) {
        const t = barStart + off;
        if (t >= sectionEnd) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        pushChord(t, 140, voicings[sIdx], baseVel + 4, false);
      }
      continue;
    }

    if (kbPreset === 'dark_low_riff' || kbPreset === 'rock_power_riff') {
      const riffCounts = [2, 4, 6, 8, 12, 16, 16] as const;
      const count = riffCounts[densityScale - 1];
      const step = Math.floor(BAR_TICKS / count);
      for (let i = 0; i < count; i++) {
        const t = barStart + i * step;
        if (t >= sectionEnd || (i === 0 && skipDownbeat)) continue;
        const seg = getSegmentAtTick(ctx.segments, t);
        const r = fitPitchClassToRange(seg.parsed.rootPitchClass, 48, 59);
        const fifth = Math.min(67, r + 7);
        const v = kbPreset === 'dark_low_riff' ? [r, fifth] : [r, fifth, Math.min(67, r + 12)];
        pushChord(t, Math.max(60, step - 20), v, baseVel + (i % 2 === 0 ? 6 : -4), false);
      }
      continue;
    }

    if (kbPreset === 'funk_16th_clav') {
      const hits = [0, 360, 480, 720, 960, 1320, 1440, 1680];
      for (const off of hits) {
        const t = barStart + off;
        if (t >= sectionEnd || (off === 0 && skipDownbeat)) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        pushChord(t, 75, voicings[sIdx], baseVel + (off % 480 === 0 ? 8 : -2), false);
      }
      continue;
    }

    if (kbPreset === 'counter_melody') {
      const scalePcs = getScalePitchClasses(song.key, song.scale);
      const offs = [240, 600, 960, 1320, 1680];
      for (let i = 0; i < offs.length; i++) {
        const t = barStart + offs[i];
        if (t >= sectionEnd) continue;
        const chord = getActiveChordAtTick(section.chords, t, song.key, song.scale, section.bars).parsed;
        const pc = chord.intervals.includes(4)
          ? (chord.rootPitchClass + 4) % 12
          : chord.intervals.includes(3)
            ? (chord.rootPitchClass + 3) % 12
            : scalePcs[(bar + i) % scalePcs.length];
        const p = fitPitchClassToRange(pc, 67, 86);
        notes.push({
          pitch: p,
          velocity: clampVelocity(baseVel + 6),
          startTick: t,
          durationTicks: 180,
          voiceRole: 'single',
          allowStrum: false,
        });
      }
      continue;
    }

    if (kbPreset === 'gospel_rich_comp') {
      const offs = [0, 720, 1200, 1680];
      for (const off of offs) {
        const t = barStart + off;
        if (t >= sectionEnd || (off === 0 && skipDownbeat)) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        pushChord(t, off === 1680 ? 220 : 340, voicings[sIdx], baseVel + 4, true);
      }
      continue;
    }

    if (kbPreset === 'fusion_ep_comp') {
      const offs = [0, 360, 840, 1200, 1680];
      for (const off of offs) {
        const t = barStart + off;
        if (t >= sectionEnd || (off === 0 && skipDownbeat)) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        const v = voicings[sIdx];
        const expanded =
          v.length >= 4
            ? v
            : [...v, Math.min(84, v[0] + 12 + 2)].filter((x, i, arr) => arr.indexOf(x) === i);
        pushChord(t, off === 0 ? 280 : 180, expanded, baseVel + 4, false);
      }
      continue;
    }

    if (kbPreset === 'fusion_brass_stab') {
      const offs = [0, 360, 960, 1560];
      for (const off of offs) {
        const t = barStart + off;
        if (t >= sectionEnd || (off === 0 && skipDownbeat)) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        pushChord(t, 105, voicings[sIdx], baseVel + 10, false);
      }
      continue;
    }

    if (kbPreset === 'electronica_glitch_arp') {
      const step = 240;
      for (let off = 0; off < BAR_TICKS; off += step) {
        const t = barStart + off;
        if (t >= sectionEnd) continue;
        if (rng() < 0.25) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        const v = voicings[sIdx];
        const pc = v[rngInt(rng, 0, v.length - 1)] % 12;
        const p = fitPitchClassToRange(pc, 72, 84);
        notes.push({
          pitch: p,
          velocity: clampVelocity(baseVel + rngInt(rng, -12, 10)),
          startTick: t,
          durationTicks: 110,
          voiceRole: 'single',
          allowStrum: false,
        });
      }
      continue;
    }

    if (kbPreset === 'electronica_minimal_ostinato') {
      const sIdx = getSegmentIndexAtTick(ctx.segments, barStart);
      const v = voicings[sIdx];
      const motif = [v[0], v[Math.min(1, v.length - 1)], v[v.length - 1]];
      for (let off = 0; off < BAR_TICKS; off += 240) {
        const t = barStart + off;
        if (t >= sectionEnd) continue;
        notes.push({
          pitch: motif[(off / 240) % motif.length],
          velocity: clampVelocity(baseVel - 4),
          startTick: t,
          durationTicks: 160,
          voiceRole: 'single',
          allowStrum: false,
        });
      }
      continue;
    }

    if (kbPreset === 'disco_boogie_bounce') {
      const offs =
        keyboardDensity <= 2
          ? [480, 1440]
          : keyboardDensity >= 6
            ? [360, 480, 600, 1200, 1320, 1440, 1560]
            : [480, 600, 1320, 1440];
      for (const off of offs) {
        const t = barStart + off;
        if (t >= sectionEnd) continue;
        const seg = getSegmentAtTick(ctx.segments, t);
        const r = fitPitchClassToRange(seg.parsed.rootSemitone, 60, 71);
        const v = seg.parsed.intervals
          .map((iv) => {
            let p = r + iv;
            while (p > 76) p -= 12;
            while (p < 60) p += 12;
            return p;
          })
          .filter((x, i, a) => a.indexOf(x) === i)
          .sort((a, b) => a - b);
        pushChord(t, 55, v, baseVel + 4, false);
      }
      continue;
    }

    // Default / 5-genre DNA rhythmStyle expansion
    if (kbPreset === 'chord_quarter') {
      for (let q = 0; q < 4; q++) {
        const t = barStart + q * 480;
        if (t >= sectionEnd || (q === 0 && skipDownbeat)) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        pushChord(t, 420, voicings[sIdx], baseVel, true);
      }
    } else if (kbPreset === 'chord_eighth' || dna.rhythmStyle === 'eighth_drive') {
      for (let e = 0; e < 8; e++) {
        const t = barStart + e * 240;
        if (t >= sectionEnd || (e === 0 && skipDownbeat)) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        pushChord(t, 200, voicings[sIdx], baseVel + (e % 2 === 0 ? 4 : -6), true);
      }
    } else if (kbPreset === 'syncopated_comp' || dna.rhythmStyle === 'sixteenth_comp') {
      const pattern =
        dna.rhythmStyle === 'sixteenth_comp'
          ? [
              { off: 0, dur: 160 },
              { off: 360, dur: 120 },
              { off: 840, dur: 140 },
              { off: 1200, dur: 180 },
              { off: 1560, dur: 120 },
            ]
          : [
              { off: 0, dur: 320 },
              { off: 720, dur: 220 },
              { off: 1200, dur: 220 },
              { off: 1680, dur: 200 },
            ];
      for (const hit of pattern) {
        const t = barStart + hit.off;
        if (t >= sectionEnd || (hit.off === 0 && skipDownbeat)) continue;
        if (hasEndAnticipation && hit.off > 1440 && hit.off < 1680) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        const seg = ctx.segments[sIdx];
        const maxDur = Math.max(60, seg.endTick - t - 12);
        pushChord(t, Math.min(hit.dur, maxDur), voicings[sIdx], baseVel, true);
      }
    } else if (dna.rhythmStyle === 'sustained_wall') {
      if (!skipDownbeat) {
        const dur = Math.max(120, barStartSeg.endTick - barStart - 16);
        pushChord(barStart, dur, voicings[barStartSegIdx], baseVel - 4, true);
      }
    } else if (dna.rhythmStyle === 'lofi_sparse') {
      const offs = [
        { off: 0, dur: 720 },
        { off: 960, dur: 460 },
        { off: 1680, dur: 210 },
      ];
      for (const hit of offs) {
        const t = barStart + hit.off;
        if (t >= sectionEnd || (hit.off === 0 && skipDownbeat)) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        const seg = ctx.segments[sIdx];
        const maxDur = Math.max(60, seg.endTick - t - 16);
        pushChord(t, Math.min(hit.dur, maxDur), voicings[sIdx], baseVel - 6, true);
      }
    } else {
      // royal_jpop pop_syncopated
      const pattern =
        playStyle === 'Minimal Riff'
          ? [
              { off: 0, dur: 440 },
              { off: 960, dur: 440 },
            ]
          : [
              { off: 0, dur: 440 },
              { off: 720, dur: 220 },
              { off: 1200, dur: 220 },
              { off: 1440, dur: 420 },
            ];
      for (const hit of pattern) {
        const t = barStart + hit.off;
        if (t >= sectionEnd || (hit.off === 0 && skipDownbeat)) continue;
        const sIdx = getSegmentIndexAtTick(ctx.segments, t);
        const seg = ctx.segments[sIdx];
        let v = voicings[sIdx];
        if (!allowLegacyAutoStrum) {
          const r = fitPitchClassToRange(seg.parsed.rootSemitone, 60, 71);
          const ivs = new Set<number>(seg.parsed.intervals);
          if (params.sus2 && !ivs.has(2)) {
            ivs.delete(3);
            ivs.delete(4);
            ivs.add(2);
          }
          if (params.add7 && !ivs.has(9) && !ivs.has(10) && !ivs.has(11)) {
            ivs.add(ivs.has(6) ? 9 : 11);
          }
          if (params.add9 && !ivs.has(6)) {
            ivs.add(14);
          }
          v = Array.from(ivs)
            .map((iv) => r + iv)
            .filter((p) => p >= 60 && p <= 84)
            .sort((a, b) => a - b);
        }
        const maxDur = Math.max(60, seg.endTick - t - 16);
        pushChord(t, Math.min(hit.dur, maxDur), v, baseVel, allowLegacyAutoStrum);
      }
    }

    // Trigger anticipated chord changes inside the bar (e.g. 1680 ticks) if not already struck
    for (const antSeg of barChanges) {
      if (!notes.some((n) => n.startTick === antSeg.startTick)) {
        const sIdx = ctx.segments.indexOf(antSeg);
        const dur = Math.max(120, antSeg.endTick - antSeg.startTick - 16);
        pushChord(antSeg.startTick, dur, voicings[sIdx], baseVel + 4, true);
      }
    }
  }

  void params;
  void style;
  return notes;
}

// ===========================================================================
// Stage 4: Vocal Rest Obligato Injection
// ===========================================================================
export function injectVocalRestObligato(
  input: EngineInput,
  ctx: KeyboardAnalysisContext,
  dna: KeyboardGenreDNA,
  backingNotes: InternalKeyboardNote[],
  kbPreset: string,
  rng: () => number
): InternalKeyboardNote[] {
  if (!ctx.hasExplicitVocal || ctx.vocalRestGaps.length === 0) {
    return backingNotes;
  }
  // Keep fixed-count or specialized presets untouched
  if (
    kbPreset === 'counter_melody' ||
    kbPreset === 'electronica_polyrhythm' ||
    kbPreset === 'offbeat_ska' ||
    kbPreset === 'whole_sustain'
  ) {
    return backingNotes;
  }

  const { song, section } = input;
  const out = backingNotes.slice();
  const baseVel = section.energy === 'High' ? 96 : section.energy === 'Low' ? 76 : 86;

  for (const gap of ctx.vocalRestGaps) {
    const safeEnd =
      gap.nextVocalStartTick !== null
        ? gap.nextVocalStartTick - 160 // 120..240 ticks breathing margin before vocal re-entry
        : gap.endTick;
    if (safeEnd - gap.startTick < 480) continue;

    const motifCount = Math.min(5, Math.max(2, Math.floor((safeEnd - gap.startTick) / 480)));
    const step = 240;
    const motifStart = gap.startTick + 120;

    for (let i = 0; i < motifCount; i++) {
      const t = motifStart + i * step;
      if (t >= safeEnd - 60) break;

      const parsed = getActiveChordAtTick(
        section.chords,
        t,
        song.key,
        song.scale,
        section.bars
      ).parsed;
      const chordPcs = parsed.intervals.map((iv) => (parsed.rootPitchClass + iv) % 12);
      const ninthPc = (parsed.rootPitchClass + 2) % 12;
      const candidatePcs = parsed.intervals.includes(6)
        ? chordPcs
        : [...chordPcs, ninthPc];

      const pc = candidatePcs[(i + rngInt(rng, 0, candidatePcs.length - 1)) % candidatePcs.length];
      const minOb = Math.max(dna.minMidi + 12, 67);
      const maxOb = dna.obligatoMaxMidi;
      const pitch = fitPitchClassToRange(pc, minOb, maxOb);

      const dur = Math.min(200, Math.max(60, safeEnd - t - 20));
      if (!out.some((n) => n.pitch === pitch && Math.abs(n.startTick - t) < 60)) {
        out.push({
          pitch,
          velocity: clampVelocity(baseVel + (i === motifCount - 1 ? 6 : 0)),
          startTick: t,
          durationTicks: dur,
          voiceRole: 'obligato',
          allowStrum: false,
        });
      }
    }

    // Ensure any rest-window high notes finish at least 120 ticks before vocal re-entry
    if (gap.nextVocalStartTick !== null) {
      const marginEnd = gap.nextVocalStartTick - 120;
      for (let i = out.length - 1; i >= 0; i--) {
        const n = out[i];
        if (n.startTick >= gap.startTick && n.startTick < gap.endTick && n.startTick + n.durationTicks > marginEnd) {
          if (n.startTick >= marginEnd) {
            out.splice(i, 1);
          } else {
            n.durationTicks = marginEnd - n.startTick;
          }
        }
      }
    }
  }

  return out;
}

// ===========================================================================
// Stage 5: Pianist MIDI Articulation Post-Processing & Sanitizer
// ===========================================================================
export function applyPianistArticulationAndSanitize(
  rawNotes: InternalKeyboardNote[],
  dna: KeyboardGenreDNA,
  bpm: number,
  sectionStartTick: number,
  sectionEndTick: number,
  kbPreset: string,
  rng: () => number
): MidiNote[] {
  if (sectionEndTick <= sectionStartTick) return [];

  const grouped = new Map<number, InternalKeyboardNote[]>();
  const ungrouped: InternalKeyboardNote[] = [];

  for (const n of rawNotes) {
    if (n.groupId !== undefined && n.allowStrum) {
      const arr = grouped.get(n.groupId) ?? [];
      arr.push({ ...n });
      grouped.set(n.groupId, arr);
    } else {
      ungrouped.push({ ...n });
    }
  }

  const processed: InternalKeyboardNote[] = [];
  const [minSpreadMs, maxSpreadMs] = dna.strumSpreadMs;
  const effectiveMaxMs = kbPreset === 'offbeat_ska' ? Math.min(maxSpreadMs, 10) : maxSpreadMs;

  for (const group of grouped.values()) {
    group.sort((a, b) => a.pitch - b.pitch);
    const spreadMs =
      effectiveMaxMs <= minSpreadMs
        ? minSpreadMs
        : minSpreadMs + rng() * (effectiveMaxMs - minSpreadMs);
    const totalSpreadTicks = Math.round((spreadMs * (bpm * PPQ)) / 60000);
    const nVoices = group.length;

    for (let i = 0; i < nVoices; i++) {
      const note = group[i];
      const ratio = nVoices > 1 ? i / (nVoices - 1) : 0;
      let strumOffset = Math.round(ratio * totalSpreadTicks);
      if (dna.melodyLeadBias && i === nVoices - 1 && nVoices >= 2) {
        strumOffset = 0; // Top melody voice leads clearly
      }

      // Top-note velocity emphasis (+12..+18), bass (+2..+5), inner (-6..-12)
      let velDelta = 0;
      if (i === nVoices - 1 && nVoices >= 2) {
        velDelta = rngInt(rng, 12, 18);
      } else if (i === 0 && nVoices >= 2) {
        velDelta = rngInt(rng, 2, 5);
      } else {
        velDelta = -rngInt(rng, 6, 12);
      }
      const beatAccent = note.isBeatHead ? 4 : 0;
      const microJitter = rngInt(rng, -2, 2);

      note.startTick += strumOffset;
      note.velocity = clampVelocity(note.velocity + velDelta + beatAccent + microJitter);
      processed.push(note);
    }
  }

  for (const note of ungrouped) {
    const microJitter = rngInt(rng, -2, 2);
    note.velocity = clampVelocity(note.velocity + microJitter);
    processed.push(note);
  }

  // Clamp to section boundaries first
  const bounded = processed
    .map((n) => {
      const startTick = Math.max(sectionStartTick, Math.round(n.startTick));
      const maxDur = sectionEndTick - startTick;
      const durationTicks = Math.min(Math.round(n.durationTicks), maxDur);
      return { ...n, startTick, durationTicks };
    })
    .filter((n) => n.startTick < sectionEndTick && n.durationTicks > 0);

  // Deduplicate & enforce releaseGapTicks = 18 (min 12) for same-pitch consecutive notes
  const releaseGapTicks = 18;
  bounded.sort((a, b) => a.pitch - b.pitch || a.startTick - b.startTick || b.velocity - a.velocity);

  const byPitchDeduped: InternalKeyboardNote[] = [];
  for (const curr of bounded) {
    if (byPitchDeduped.length > 0) {
      const prev = byPitchDeduped[byPitchDeduped.length - 1];
      if (prev.pitch === curr.pitch) {
        if (prev.startTick === curr.startTick) {
          // Exact same (pitch, startTick): keep highest velocity (already sorted first)
          continue;
        }
        const maxAllowedDur = curr.startTick - prev.startTick - releaseGapTicks;
        if (maxAllowedDur < prev.durationTicks) {
          prev.durationTicks = maxAllowedDur;
        }
        if (prev.durationTicks <= 0) {
          byPitchDeduped.pop();
        }
      }
    }
    byPitchDeduped.push(curr);
  }

  const finalNotes: MidiNote[] = byPitchDeduped
    .filter((n) => n.startTick >= sectionStartTick && n.startTick + n.durationTicks <= sectionEndTick && n.durationTicks > 0)
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)
    .map((n) => ({
      pitch: n.pitch,
      velocity: clampVelocity(n.velocity),
      startTick: n.startTick,
      durationTicks: n.durationTicks,
      channel: 1,
    }));

  return finalNotes;
}

export interface KeyboardTrackResult {
  notes: MidiNote[];
  controlChanges: MidiControlChangeEvent[];
  skeleton?: KeyboardSkeletonId;
  take?: AccompanimentTake;
  plan?: EnsembleSyncPlan;
}

export function generateKeyboardSkeletonTrack(
  input: EngineInput
): KeyboardTrackResult {
  const { song, section, sectionIndex, seed, vocalNotes } = input;
  const ch = TRACK_CHANNELS.keyboard;
  if (!song.members.keyboard.enabled || section.enabledParts?.keyboard === false) {
    return { notes: [], controlChanges: [] };
  }

  const totalBars = Math.max(1, section.bars);
  const sectionEnd = totalBars * TICKS_PER_BAR;
  const bpm = input.bpm ?? song.bpm;
  const plan = resolveEnsembleSyncPlan({
    drumPatternId: input.drumPatternId ?? section.drumPatternId,
    masterGenreId: input.masterGenreId ?? song.members.keyboard.patternPreset,
    sectionType: section.type,
    bpm,
    keyboardSkeleton: input.keyboardSkeleton ?? section.keyboardSkeleton,
    keyboardTake: input.keyboardTake ?? section.keyboardTake ?? input.style,
  });

  const skeleton = plan.keyboardSkeleton;
  const take = plan.keyboardTake;
  const rng = mulberry32Core(
    deriveSeed(seed, `keyboard:${sectionIndex}:${skeleton}:${take}`)
  );
  const chordWindows = buildChordWindows(section, song.key, song.scale);

  // Compute vocal register ceiling if vocal notes are present
  let vocalRange: { min: number; max: number } | null = null;
  if (vocalNotes && vocalNotes.length > 0) {
    let vMin = 127;
    let vMax = 0;
    for (const vn of vocalNotes) {
      if (vn.pitch < vMin) vMin = vn.pitch;
      if (vn.pitch > vMax) vMax = vn.pitch;
    }
    if (vMin <= vMax) vocalRange = { min: vMin, max: vMax };
  }

  // Resolve smooth voice-leading per chord window
  const voicingsByWindow: number[][] = [];
  let prevVoicing: number[] | null = null;
  for (const w of chordWindows) {
    const pcs = getParsedChordPitchClasses(w.parsed);
    if (take === 'C') {
      // Extend with tasteful tension (maj7 / m7 / 9th)
      const rootPc = w.parsed.rootPitchClass;
      const isMinor = pcs.includes((rootPc + 3) % 12);
      const tensionPc = isMinor ? (rootPc + 10) % 12 : (rootPc + 11) % 12;
      if (!pcs.includes(tensionPc)) pcs.push(tensionPc);
    }
    const voiced = resolveSmoothVoicing({
      pitchClasses: pcs.slice(0, take === 'C' ? 4 : 3),
      prevVoicing,
      minMidi: plan.keyboardRange.min,
      maxMidi: plan.keyboardRange.max,
      vocalRange,
      preferDrop2: take === 'C',
    });
    voicingsByWindow.push(voiced);
    prevVoicing = voiced;
  }

  const baseVel = clampCore(
    Math.round(86 * plan.keyboardVelocityScale),
    58,
    114
  );
  const rawNotes: MidiNote[] = [];
  const controlChanges: MidiControlChangeEvent[] = [];

  // Emit CC#64 sustain pedal on SUSTAIN_CHORD / ARPEGGIO_8TH_16TH
  if (skeleton === 'SUSTAIN_CHORD' || skeleton === 'ARPEGGIO_8TH_16TH') {
    for (let i = 0; i < chordWindows.length; i++) {
      const w = chordWindows[i];
      if (w.startTick >= 20) {
        controlChanges.push({
          tick: w.startTick - 20,
          controller: 64,
          value: 0,
          channel: ch,
        });
      }
      if (w.startTick + 10 < sectionEnd) {
        controlChanges.push({
          tick: w.startTick + 10,
          controller: 64,
          value: 127,
          channel: ch,
        });
      }
    }
    controlChanges.push({
      tick: sectionEnd,
      controller: 64,
      value: 0,
      channel: ch,
    });
  }

  if (skeleton === 'SUSTAIN_CHORD') {
    for (let i = 0; i < chordWindows.length; i++) {
      const w = chordWindows[i];
      const voiced = voicingsByWindow[i];
      const dur = Math.max(60, w.endTick - w.startTick - 15);
      for (let vIdx = 0; vIdx < voiced.length; vIdx++) {
        const isTop = vIdx === voiced.length - 1;
        rawNotes.push({
          pitch: voiced[vIdx],
          velocity: clampCore(baseVel + (isTop ? 5 : -4), 48, 118),
          startTick: w.startTick,
          durationTicks: dur,
          channel: ch,
        });
      }
    }
  } else {
    for (let bar = 0; bar < totalBars; bar++) {
      const barStart = bar * TICKS_PER_BAR;

      if (skeleton === 'ARPEGGIO_8TH_16TH') {
        const step = take === 'B' ? 120 : 240;
        const count = Math.floor(TICKS_PER_BAR / step);
        for (let i = 0; i < count; i++) {
          const rawTick = barStart + i * step;
          const absTick = mapTickToSubdivision(rawTick, plan.subdivision);
          if (absTick >= sectionEnd) continue;
          const cw = findChordAtTick(chordWindows, absTick);
          const voiced = voicingsByWindow[cw.index];
          const pitch = voiced[i % voiced.length];
          rawNotes.push({
            pitch,
            velocity: clampCore(baseVel - 4 + (i % 4 === 0 ? 6 : 0), 50, 115),
            startTick: absTick,
            durationTicks: Math.max(50, Math.round(step * 0.9)),
            channel: ch,
          });
        }
        continue;
      }

      let offsets: number[] = [];
      let defaultDur = 210;

      if (plan.cue === 'PPPH') {
        offsets = plan.ppphDoubleTime
          ? bar % 2 === 0
            ? [0, 1440]
            : [0]
          : [0, 720, 960];
        defaultDur = 220;
      } else if (skeleton === 'QUARTER_CHOP') {
        offsets =
          take === 'B' ? [0, 480, 960, 1440, 1680] : [0, 480, 960, 1440];
        defaultDur = 220;
      } else if (skeleton === 'OFFBEAT_STAB') {
        offsets = [240, 720, 1200, 1680];
        defaultDur = 160;
      } else if (skeleton === 'TRIPLET_COMP') {
        offsets = [0, 320, 480, 800, 960, 1280, 1440, 1760];
        defaultDur = 140;
      } else {
        // SYNCOPATED_RIFF
        offsets =
          take === 'B'
            ? [0, 360, 720, 1200, 1680, 1800]
            : [0, 360, 720, 1200, 1680];
        defaultDur = 190;
      }

      const mappedOffsets =
        skeleton === 'TRIPLET_COMP' || plan.cue === 'PPPH'
          ? offsets
          : Array.from(
              new Set(
                offsets.map(
                  (off) =>
                    mapTickToSubdivision(barStart + off, plan.subdivision) -
                    barStart
                )
              )
            ).sort((a, b) => a - b);

      for (let idx = 0; idx < mappedOffsets.length; idx++) {
        const off = mappedOffsets[idx];
        const absTick = barStart + off;
        if (absTick >= sectionEnd) continue;
        const cw = findChordAtTick(chordWindows, absTick);
        const voiced = voicingsByWindow[cw.index];
        const nextOff =
          idx + 1 < mappedOffsets.length ? mappedOffsets[idx + 1] : TICKS_PER_BAR;
        const maxDur = Math.max(40, nextOff - off - 15);
        const dur = Math.min(defaultDur, maxDur);
        const accent = off % 480 === 0 ? 4 : -2;

        for (let vIdx = 0; vIdx < voiced.length; vIdx++) {
          const isTop = vIdx === voiced.length - 1;
          rawNotes.push({
            pitch: voiced[vIdx],
            velocity: clampCore(baseVel + accent + (isTop ? 5 : -3), 48, 118),
            startTick: absTick,
            durationTicks: dur,
            channel: ch,
          });
        }
      }
    }
  }

  // Take C: 2-note obligato inside vocal pure rest gaps (>= 480 ticks)
  if (take === 'C' && vocalNotes && vocalNotes.length > 0) {
    const restGaps = findVocalRestGaps(vocalNotes, sectionEnd, 480);
    for (const gap of restGaps) {
      const safeStart = gap.startTick + 60;
      const safeEnd = gap.endTick - 30;
      if (safeEnd - safeStart < 240) continue;

      const cw = findChordAtTick(chordWindows, safeStart);
      const voiced = voicingsByWindow[cw.index];
      const topNote = voiced[voiced.length - 1] ?? 67;
      const ninthPc = (cw.parsed.rootPitchClass + 2) % 12;
      let ninthMidi = Math.floor(topNote / 12) * 12 + ninthPc;
      while (ninthMidi <= topNote) ninthMidi += 12;
      if (vocalRange && ninthMidi >= vocalRange.min) {
        ninthMidi = Math.max(plan.keyboardRange.min, topNote - 2);
      }

      const midTick = Math.min(safeEnd - 90, safeStart + 160);
      const v1 = clampCore(66 + Math.floor(rng() * 5), 66, 70);
      const v2 = clampCore(66 + Math.floor(rng() * 5), 66, 70);
      rawNotes.push({
        pitch: topNote,
        velocity: v1,
        startTick: safeStart,
        durationTicks: Math.max(60, Math.min(150, midTick - safeStart - 10)),
        channel: ch,
      });
      if (midTick < safeEnd - 30) {
        rawNotes.push({
          pitch: clampCore(ninthMidi, 48, 84),
          velocity: v2,
          startTick: midTick,
          durationTicks: Math.max(60, Math.min(180, safeEnd - midTick)),
          channel: ch,
        });
      }
    }
  }

  const notes = sanitizeTrackNotes(rawNotes, 5, sectionEnd);
  return { notes, controlChanges, skeleton, take, plan };
}

export function generateKeyboardResult(
  input: EngineInput
): KeyboardTrackResult {
  const { section, song } = input;
  const explicitSkeleton = input.keyboardSkeleton ?? section.keyboardSkeleton;
  const explicitDrum = input.drumPatternId ?? section.drumPatternId;
  const kbPreset =
    section.patternPresets?.keyboard ??
    section.partPresets?.keyboard ??
    song.members.keyboard.patternPreset ??
    'auto';

  const shouldUseSkeletonEngine =
    (explicitSkeleton && explicitSkeleton !== 'auto') ||
    (explicitDrum && explicitDrum !== 'auto' && kbPreset === 'auto');

  if (shouldUseSkeletonEngine) {
    return generateKeyboardSkeletonTrack(input);
  }
  return {
    notes: generateLegacyKeyboardNotes(input),
    controlChanges: [],
  };
}

export function generateKeyboardNotes(input: EngineInput): MidiNote[] {
  return generateKeyboardResult(input).notes;
}

function generateLegacyKeyboardNotes(input: EngineInput): MidiNote[] {
  const { song, section, seed, params } = input;
  if (!song.members.keyboard.enabled || section.enabledParts?.keyboard === false) {
    return [];
  }

  const kbPreset =
    section.patternPresets?.keyboard ??
    section.partPresets?.keyboard ??
    song.members.keyboard.patternPreset ??
    'auto';
  const playStyle = song.members.keyboard.keyboardStyle ?? 'Rhythm Backing';
  const bpm = input.bpm ?? song.bpm;
  const dna = resolveKeyboardGenreDNA(kbPreset, playStyle);
  const rng = mulberry32(seed);

  // Determine register bounds (preserving legacy 60..84 when auto + no explicit vocal override, 48..67 for low riffs)
  let minMidi = dna.minMidi;
  let maxMidi = dna.maxMidi;
  if (kbPreset === 'dark_low_riff' || kbPreset === 'rock_power_riff') {
    minMidi = 48;
    maxMidi = 67;
  } else if (kbPreset === 'auto' && !input.vocalNotes && input.prevVocalAvgPitch === undefined) {
    minMidi = Math.max(60, params.voicingMin);
    maxMidi = Math.min(84, params.voicingMax);
  }

  // Stage 1: Context & Vocal / Timeline Analysis
  const ctx = analyzeKeyboardContext(input, dna);

  // Stage 2: Viterbi DP + Beam Search Optimal Voice Leading
  const voicings = solveOptimalVoiceLeading(ctx, dna, params, kbPreset, minMidi, maxMidi, rng);

  // Stage 3: Genre Backing & Arpeggio Expansion
  const backingNotes = expandBackingAndArpeggio(input, ctx, dna, voicings, kbPreset, rng);

  // Stage 4: Vocal Rest Obligato Injection
  const withObligato = injectVocalRestObligato(input, ctx, dna, backingNotes, kbPreset, rng);

  // Stage 5: Pianist Articulation & Strict Sanitizer
  return applyPianistArticulationAndSanitize(
    withObligato,
    dna,
    bpm,
    ctx.sectionStartTick,
    ctx.sectionEndTick,
    kbPreset,
    rng
  );
}
