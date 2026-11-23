import { TICKS_PER_BAR, type MidiNote } from '../types/song';
import {
  getActiveChordAtTick,
  getTimelineBoundaryChanges,
} from '../lib/chordTimeline';
import {
  fitPitchClassToRange,
  getScalePitchClasses,
  noteNameToSemitone,
  type ParsedChord,
} from '../lib/chordUtils';
import { createSeededRng } from '../lib/random';
import type { EngineInput } from './types';

export const TPQN = 480;
export const BEAT_TICKS = 480;
export const BAR_TICKS = 1920;
export const EIGHTH_TICKS = 240;
export const SIXTEENTH_TICKS = 120;
export const THIRTYSECOND_TICKS = 60;

export const BASS_MIN_PITCH = 28; // E1
export const BASS_MAX_PITCH = 55; // G3
const STABLE_MAX_PITCH = 50; // D3
const OPEN_STRING_PITCHES = [28, 33, 38, 43] as const;

export type BassGenreDnaId =
  | 'alt_heavy_rock'
  | 'emo_jrock'
  | 'jpop_melodic'
  | 'fusion_funk'
  | 'chill_lofi_ballad';

export interface BassGenreDna {
  id: BassGenreDnaId;
  kickLockRate: number;
  offbeatFillRate: number;
  ghostFreq: number;
  baseGateRatio: number;
  sustainGateRatio: number;
  chromaticRate: number;
  pitchWeights: {
    root: number;
    fifth: number;
    octave: number;
    color: number; // 3rd / 7th / scale
  };
  fillNoteCountRange: readonly [number, number];
}

export const BASS_GENRE_DNA: Record<BassGenreDnaId, BassGenreDna> = {
  alt_heavy_rock: {
    id: 'alt_heavy_rock',
    kickLockRate: 0.95,
    offbeatFillRate: 0.2,
    ghostFreq: 0.08,
    baseGateRatio: 0.88,
    sustainGateRatio: 0.96,
    chromaticRate: 0.25,
    pitchWeights: { root: 0.72, fifth: 0.16, octave: 0.06, color: 0.06 },
    fillNoteCountRange: [4, 6],
  },
  emo_jrock: {
    id: 'emo_jrock',
    kickLockRate: 0.9,
    offbeatFillRate: 0.55,
    ghostFreq: 0.22,
    baseGateRatio: 0.85,
    sustainGateRatio: 0.92,
    chromaticRate: 0.3,
    pitchWeights: { root: 0.56, octave: 0.22, fifth: 0.12, color: 0.1 },
    fillNoteCountRange: [6, 10],
  },
  jpop_melodic: {
    id: 'jpop_melodic',
    kickLockRate: 0.92,
    offbeatFillRate: 0.4,
    ghostFreq: 0.18,
    baseGateRatio: 0.86,
    sustainGateRatio: 0.94,
    chromaticRate: 0.2,
    pitchWeights: { root: 0.62, octave: 0.14, fifth: 0.12, color: 0.12 },
    fillNoteCountRange: [5, 8],
  },
  fusion_funk: {
    id: 'fusion_funk',
    kickLockRate: 0.88,
    offbeatFillRate: 0.75,
    ghostFreq: 0.65,
    baseGateRatio: 0.62,
    sustainGateRatio: 0.82,
    chromaticRate: 0.55,
    pitchWeights: { root: 0.44, octave: 0.18, color: 0.2, fifth: 0.18 },
    fillNoteCountRange: [8, 12],
  },
  chill_lofi_ballad: {
    id: 'chill_lofi_ballad',
    kickLockRate: 0.95,
    offbeatFillRate: 0.18,
    ghostFreq: 0.05,
    baseGateRatio: 0.95,
    sustainGateRatio: 0.98,
    chromaticRate: 0.15,
    pitchWeights: { root: 0.68, fifth: 0.16, color: 0.1, octave: 0.06 },
    fillNoteCountRange: [3, 5],
  },
};

export function hashSeed(...parts: number[]): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    h ^= (part | 0) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

function clampBassPitch(
  p: number,
  minP = BASS_MIN_PITCH,
  maxP = BASS_MAX_PITCH
): number {
  let shifted = Math.round(p);
  while (shifted < minP) shifted += 12;
  while (shifted > maxP) shifted -= 12;
  return Math.min(maxP, Math.max(minP, shifted));
}

function resolveBassGenreDna(
  bassPreset: string,
  input: EngineInput
): BassGenreDna {
  const { song, section } = input;
  if (
    bassPreset === 'metal_gallop' ||
    bassPreset === 'sub_808_glide' ||
    bassPreset === 'pedal_point' ||
    bassPreset === 'root_whole'
  ) {
    return BASS_GENRE_DNA.alt_heavy_rock;
  }
  if (
    bassPreset === 'jrock_anticipation' ||
    bassPreset === 'root_steady' ||
    bassPreset === 'kick_lock'
  ) {
    return BASS_GENRE_DNA.emo_jrock;
  }
  if (
    bassPreset === 'slap_funk' ||
    bassPreset === 'syncopated_groove' ||
    bassPreset === 'octave_disco' ||
    bassPreset === 'disco_boogie_bounce'
  ) {
    return BASS_GENRE_DNA.fusion_funk;
  }
  if (bassPreset === 'melodic_walk') {
    return BASS_GENRE_DNA.jpop_melodic;
  }

  // 'auto': infer from section energy, beatFeel, and bassStyle
  if (section.energy === 'Low' || song.members.bass.bassStyle === 'Minimal') {
    return BASS_GENRE_DNA.chill_lofi_ballad;
  }
  if (song.beatFeel === 'Half-Time') {
    return BASS_GENRE_DNA.alt_heavy_rock;
  }
  if (song.beatFeel === 'Bounce') {
    return BASS_GENRE_DNA.fusion_funk;
  }
  if (
    section.energy === 'High' ||
    song.beatFeel === 'Driving' ||
    song.members.bass.bassStyle === 'Driving 8th'
  ) {
    return BASS_GENRE_DNA.emo_jrock;
  }
  return BASS_GENRE_DNA.jpop_melodic;
}

/**
 * Computes musically safe pitch classes inside strictAllowed = keyScalePcs U chordPcs.
 * Excludes harsh semitone clashes over non-diatonic substitute/borrowed chords.
 */
export function getMusicalSafePitchClasses(
  keyScalePcs: ReadonlySet<number>,
  chordPcs: ReadonlySet<number>,
  chordRootPc: number,
  isDim7: boolean
): Set<number> {
  if (isDim7) {
    return new Set(chordPcs);
  }

  const safe = new Set<number>(chordPcs);
  const hasFlat9 = chordPcs.has((chordRootPc + 1) % 12);
  const hasMajor3rd = chordPcs.has((chordRootPc + 4) % 12);
  const hasMinorOrSus =
    chordPcs.has((chordRootPc + 3) % 12) ||
    chordPcs.has((chordRootPc + 5) % 12);
  const hasFlat6 = chordPcs.has((chordRootPc + 8) % 12);

  for (const pc of keyScalePcs) {
    const rel = (pc - chordRootPc + 12) % 12;
    if (rel === 2 && !hasFlat9) {
      safe.add(pc);
    } else if (rel === 5 && (hasMinorOrSus || !hasMajor3rd)) {
      safe.add(pc);
    } else if (rel === 9 && !hasFlat6) {
      safe.add(pc);
    }
  }
  return safe;
}

function estimateFretPosition(pitch: number): number {
  let bestFret = 24;
  for (const open of OPEN_STRING_PITCHES) {
    if (pitch >= open) {
      bestFret = Math.min(bestFret, pitch - open);
    }
  }
  return bestFret;
}

function computeFretTravelCost(prevPitch: number, candPitch: number): number {
  const fretDiff = Math.abs(
    estimateFretPosition(candPitch) - estimateFretPosition(prevPitch)
  );
  const semiDiff = Math.abs(candPitch - prevPitch);
  return fretDiff + semiDiff * 0.25;
}

type BassRole =
  | 'root'
  | 'chord_change'
  | 'kick_sync'
  | 'octave_jump'
  | 'chord_tone'
  | 'passing'
  | 'ghost'
  | 'pedal'
  | 'b7'
  | 'fill';

type BassArticulation = 'normal' | 'staccato' | 'legato' | 'sustain';

interface BassSlotEvent {
  startTick: number;
  baseDuration: number;
  role: BassRole;
  articulation: BassArticulation;
  isStrongBeat: boolean;
  isChordChange: boolean;
  explicitPitch?: number;
}

interface ResolvedBassNote extends BassSlotEvent {
  pitch: number;
  velocity: number;
  isChromatic?: boolean;
}

function enforceMonophonicAndClip(
  rawNotes: MidiNote[],
  sectionEnd: number
): MidiNote[] {
  const valid = rawNotes
    .map((n) => ({
      pitch: Math.min(BASS_MAX_PITCH, Math.max(BASS_MIN_PITCH, Math.round(n.pitch))),
      velocity: clampVelocity(n.velocity),
      startTick: Math.max(0, Math.round(n.startTick)),
      durationTicks: Math.max(30, Math.round(n.durationTicks)),
      channel: 0,
    }))
    .filter((n) => n.startTick < sectionEnd);

  valid.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  const deduped: MidiNote[] = [];
  for (const n of valid) {
    if (
      deduped.length > 0 &&
      deduped[deduped.length - 1].startTick === n.startTick
    ) {
      continue;
    }
    deduped.push(n);
  }

  for (let i = 0; i < deduped.length; i++) {
    const curr = deduped[i];
    if (i + 1 < deduped.length) {
      const gap = deduped[i + 1].startTick - curr.startTick;
      const safeCap = gap > 5 ? gap - 5 : gap;
      const maxAllowed = Math.min(sectionEnd - curr.startTick, safeCap);
      curr.durationTicks = Math.max(1, Math.min(curr.durationTicks, maxAllowed));
    } else {
      curr.durationTicks = Math.max(
        1,
        Math.min(curr.durationTicks, sectionEnd - curr.startTick)
      );
    }
  }

  return deduped;
}

function applyLegatoGateToList(
  notes: MidiNote[],
  sectionEnd: number,
  gateRatio = 0.92,
  maxLegatoSpan = TICKS_PER_BAR
): void {
  if (notes.length === 0) return;
  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  for (let i = 0; i < notes.length; i++) {
    const curr = notes[i];
    if (curr.velocity < 65) continue;
    const nextStart = i + 1 < notes.length ? notes[i + 1].startTick : sectionEnd;
    const span = Math.max(1, nextStart - curr.startTick);
    if (span > maxLegatoSpan) continue;
    const legatoDur = Math.max(curr.durationTicks, Math.round(span * gateRatio));
    const maxSafe = i + 1 < notes.length ? Math.max(1, span - 5) : sectionEnd - curr.startTick;
    curr.durationTicks = Math.max(1, Math.min(legatoDur, maxSafe));
  }
}

export function generateBassNotes(input: EngineInput): MidiNote[] {
  const { song, section, sectionIndex, style, seed, params, drumNotes = [] } = input;
  if (!song.members.bass.enabled || section.enabledParts?.bass === false) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;

  // Mode A: Guitar Unison Riff Mode (highest priority, preserved verbatim)
  if (section.unisonRiff) {
    const riff = section.unisonRiff;
    const riffLen = Math.max(1, riff.bars) * TICKS_PER_BAR;
    const applyPartialOctaveUp =
      section.kickMode === '808' && riff.octaveUpOn808 === true;

    const expanded: MidiNote[] = [];
    for (let base = 0; base < sectionEnd; base += riffLen) {
      for (const src of riff.cleanedBassNotes) {
        const absTick = base + src.startTick;
        if (absTick < 0 || absTick >= sectionEnd) continue;
        const shiftedPitch =
          applyPartialOctaveUp && src.pitch + 12 <= BASS_MAX_PITCH
            ? src.pitch + 12
            : src.pitch;
        expanded.push({
          pitch: shiftedPitch,
          velocity: clampVelocity(src.velocity),
          startTick: absTick,
          durationTicks: Math.max(30, src.durationTicks),
          channel: 0,
        });
      }
    }

    applyLegatoGateToList(expanded, sectionEnd, 0.92, 960);

    if (style === 'B') {
      return enforceMonophonicAndClip(expanded, sectionEnd);
    }

    if (style === 'A') {
      const varied = expanded.map((n) => ({
        ...n,
        velocity: clampVelocity(
          Math.min(params.velocityCap, n.velocity + rng.nextInt(-6, 6))
        ),
      }));
      return enforceMonophonicAndClip(varied, sectionEnd);
    }

    const withDeco = [...expanded];
    if (!params.forceRiffStrictUnison) {
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = bar * TICKS_PER_BAR;
        const barEnd = barStart + TICKS_PER_BAR;
        const targetTick = barStart + 1680;
        if (targetTick >= sectionEnd) continue;

        const hasOverlap = withDeco.some(
          (n) =>
            n.startTick < barStart + 1800 &&
            n.startTick + n.durationTicks > targetTick
        );
        if (hasOverlap) continue;

        const barNotes = withDeco.filter(
          (n) => n.startTick >= barStart && n.startTick < barEnd
        );
        if (barNotes.length === 0) continue;

        let refNote = barNotes
          .filter((n) => n.startTick < targetTick)
          .sort((a, b) => b.startTick - a.startTick)[0];
        if (!refNote) {
          refNote = [...barNotes].sort((a, b) => a.startTick - b.startTick)[0];
        }

        if (refNote && refNote.pitch + 12 <= BASS_MAX_PITCH) {
          withDeco.push({
            pitch: refNote.pitch + 12,
            velocity: clampVelocity(
              Math.min(params.velocityCap, 92 + params.velocityBoost)
            ),
            startTick: targetTick,
            durationTicks: 120,
            channel: 0,
          });
        }
      }
    }

    const variedC = withDeco.map((n) => ({
      ...n,
      velocity: clampVelocity(
        Math.min(
          params.velocityCap,
          n.velocity + rng.nextInt(-Math.min(6, params.velocityJitter), Math.min(6, params.velocityJitter))
        )
      ),
    }));
    return enforceMonophonicAndClip(variedC, sectionEnd);
  }

  // Mode B: 808 Tacet Check
  const behavior = song.members.bass.bass808Behavior ?? 'octaveUp';
  if (section.kickMode === '808' && behavior === 'tacet') {
    return [];
  }

  const bassPreset =
    section.patternPresets?.bass ??
    section.partPresets?.bass ??
    song.members.bass.patternPreset ??
    'auto';
  const dna = resolveBassGenreDna(bassPreset, input);
  const keyScalePcs = new Set(getScalePitchClasses(song.key, song.scale));
  const songKeyPc = noteNameToSemitone(song.key);
  const chromaticEnabled = Boolean(section.bassChromaticEnabled);
  const fillEnabled = Boolean(section.bassFillEnabled);
  const fillSeed = section.bassFillSeed ?? 0;

  // =========================================================================
  // Stage 1: Kick Analysis & Timeline Hit/Sync Extraction
  // =========================================================================
  const rawKickTicks =
    input.kickTicks && input.kickTicks.length > 0
      ? input.kickTicks
      : drumNotes
          .filter((n) => n.pitch === 35 || n.pitch === 36)
          .map((n) => n.startTick);

  const fallbackKicks: number[] = [];
  if (rawKickTicks.length === 0) {
    for (let bar = 0; bar < section.bars; bar++) {
      fallbackKicks.push(bar * BAR_TICKS, bar * BAR_TICKS + 960);
    }
  }
  const kickTicks = (rawKickTicks.length > 0 ? rawKickTicks : fallbackKicks)
    .map((t) => Math.round(t / SIXTEENTH_TICKS) * SIXTEENTH_TICKS)
    .filter((t) => t >= 0 && t < sectionEnd);
  const kickSet = new Set<number>(kickTicks);

  const timelineChanges = getTimelineBoundaryChanges(
    section.chords,
    section.bars,
    song.key,
    song.scale
  );
  const changeTickSet = new Set<number>(timelineChanges.map((c) => c.changeTick));
  const offbeatChanges = timelineChanges.filter((c) => c.isOffbeat);

  // Determine fill windows upfront so Stage 2 avoids crossing fill boundaries
  const fillWindows: Array<{ barIndex: number; start: number; end: number }> = [];
  if (fillEnabled && section.bars >= 1) {
    if (section.bars <= 2) {
      const b = section.bars - 1;
      fillWindows.push({
        barIndex: b,
        start: b * BAR_TICKS + 960,
        end: (b + 1) * BAR_TICKS,
      });
    } else if (section.bars <= 4) {
      fillWindows.push({ barIndex: 1, start: 1 * BAR_TICKS + 960, end: 2 * BAR_TICKS });
      const last = section.bars - 1;
      fillWindows.push({
        barIndex: last,
        start: last * BAR_TICKS + 960,
        end: (last + 1) * BAR_TICKS,
      });
    } else {
      for (let b = 3; b < section.bars; b += 4) {
        fillWindows.push({
          barIndex: b,
          start: b * BAR_TICKS + 960,
          end: (b + 1) * BAR_TICKS,
        });
      }
      const last = section.bars - 1;
      if (!fillWindows.some((w) => w.barIndex === last)) {
        fillWindows.push({
          barIndex: last,
          start: last * BAR_TICKS + 960,
          end: (last + 1) * BAR_TICKS,
        });
      }
    }
  }

  // =========================================================================
  // Stage 2: Groove Skeleton Generation (isolated grooveRng per bar)
  // =========================================================================
  const slotEvents: BassSlotEvent[] = [];

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * BAR_TICKS;
    const barEnd = barStart + BAR_TICKS;
    const grooveRng = createSeededRng(
      hashSeed(seed, sectionIndex, bar, 0x1a2b3c4d)
    );

    const pushSlot = (
      localTick: number,
      baseDuration: number,
      role: BassRole,
      articulation: BassArticulation = 'normal',
      explicitPitch?: number
    ) => {
      const absTick = barStart + localTick;
      if (absTick < 0 || absTick >= sectionEnd) return;
      const isStrong = localTick === 0 || localTick === 960;
      const isChange = changeTickSet.has(absTick);
      slotEvents.push({
        startTick: absTick,
        baseDuration: Math.max(60, baseDuration),
        role: isChange && role !== 'pedal' ? 'chord_change' : role,
        articulation,
        isStrongBeat: isStrong,
        isChordChange: isChange,
        explicitPitch,
      });
    };

    if (bassPreset === 'root_whole') {
      pushSlot(0, Math.round(BAR_TICKS * 0.96), 'root', 'sustain');
    } else if (bassPreset === 'root_steady' || bassPreset === 'pedal_point') {
      const steadyDur = Math.round(EIGHTH_TICKS * 0.92);
      for (let off = 0; off < BAR_TICKS; off += EIGHTH_TICKS) {
        pushSlot(
          off,
          steadyDur,
          bassPreset === 'pedal_point' ? 'pedal' : 'root',
          'normal'
        );
      }
    } else if (bassPreset === 'kick_lock') {
      const barKickOffsets = Array.from(
        new Set([
          0,
          ...kickTicks
            .filter((kt) => kt > barStart && kt < barEnd)
            .map((kt) => kt - barStart),
        ])
      ).sort((a, b) => a - b);
      for (let i = 0; i < barKickOffsets.length; i++) {
        const off = barKickOffsets[i];
        const nextOff = i + 1 < barKickOffsets.length ? barKickOffsets[i + 1] : BAR_TICKS;
        const span = Math.max(SIXTEENTH_TICKS, nextOff - off);
        pushSlot(
          off,
          Math.min(span - 5, Math.round(span * 0.92)),
          off === 0 ? 'root' : 'kick_sync',
          'normal'
        );
      }
    } else if (bassPreset === 'octave_disco') {
      const discoDur = Math.round(EIGHTH_TICKS * 0.9);
      for (let s = 0; s < 8; s++) {
        pushSlot(
          s * EIGHTH_TICKS,
          discoDur,
          s % 2 === 0 ? 'root' : 'octave_jump',
          'normal'
        );
      }
    } else if (bassPreset === 'melodic_walk') {
      const walkDur = Math.round(BEAT_TICKS * 0.92);
      pushSlot(0, walkDur, 'root', 'normal');
      pushSlot(480, walkDur, 'chord_tone', 'normal');
      pushSlot(960, walkDur, 'chord_tone', 'normal');
      pushSlot(1440, walkDur, 'passing', 'normal');
    } else if (bassPreset === 'syncopated_groove') {
      pushSlot(0, Math.round(360 * 0.92), 'root', 'normal');
      pushSlot(360, Math.round(360 * 0.92), 'root', 'normal');
      pushSlot(720, 110, 'chord_tone', 'staccato');
      pushSlot(840, Math.round(360 * 0.92), 'octave_jump', 'normal');
      pushSlot(1200, Math.round(360 * 0.92), 'root', 'normal');
      pushSlot(1560, Math.round(360 * 0.92), 'passing', 'normal');
    } else if (bassPreset === 'slap_funk') {
      const slaps: Array<[number, number, BassRole, BassArticulation]> = [
        [0, 110, 'root', 'staccato'],
        [120, 180, 'ghost', 'staccato'],
        [360, 110, 'octave_jump', 'staccato'],
        [480, 200, 'root', 'normal'],
        [720, 110, 'octave_jump', 'staccato'],
        [840, 200, 'root', 'normal'],
        [1080, 110, 'octave_jump', 'staccato'],
        [1440, 200, 'chord_tone', 'normal'],
        [1680, 180, 'passing', 'normal'],
      ];
      for (const [off, dur, role, art] of slaps) {
        pushSlot(off, dur, role, art);
      }
    } else if (bassPreset === 'metal_gallop') {
      const gallops = [0, 240, 360, 480, 720, 840, 960, 1200, 1320, 1440, 1680, 1800];
      for (const off of gallops) {
        pushSlot(off, 105, 'root', 'staccato');
      }
    } else if (bassPreset === 'sub_808_glide') {
      const barKicks = kickTicks
        .filter((kt) => kt > barStart && kt < barEnd)
        .map((kt) => kt - barStart);
      const uniqueSubs = Array.from(new Set([0, ...barKicks.slice(0, 2)])).sort(
        (a, b) => a - b
      );
      for (let i = 0; i < uniqueSubs.length; i++) {
        const off = uniqueSubs[i];
        const nextOff = i + 1 < uniqueSubs.length ? uniqueSubs[i + 1] : BAR_TICKS;
        const span = Math.max(EIGHTH_TICKS, nextOff - off);
        pushSlot(off, Math.min(span - 5, Math.round(span * 0.94)), 'root', 'sustain');
      }
    } else if (bassPreset === 'jrock_anticipation') {
      const bodySteps =
        bar === 0
          ? [0, 240, 480, 720, 960, 1200, 1440]
          : [240, 480, 720, 960, 1200, 1440];
      const antLegatoDur = Math.round(EIGHTH_TICKS * 0.92);
      for (const off of bodySteps) {
        const role: BassRole =
          style !== 'B' && off % 480 === 240 && off !== 1440
            ? 'octave_jump'
            : 'root';
        pushSlot(off, antLegatoDur, role, 'normal');
      }
      // Anticipate next bar's root at 1680 and tie across barline
      const nextTick = Math.min(sectionEnd - 1, barEnd);
      const nextChord = getActiveChordAtTick(
        section.chords,
        nextTick,
        song.key,
        song.scale,
        section.bars
      ).parsed;
      const nextRootPitch = fitPitchClassToRange(
        nextChord.bassPitchClass ?? nextChord.rootPitchClass,
        params.barHeadRootMin,
        params.barHeadRootMax
      );
      pushSlot(1680, 460, 'chord_change', 'sustain', nextRootPitch);
    } else if (bassPreset === 'disco_boogie_bounce') {
      const chord = getActiveChordAtTick(
        section.chords,
        barStart,
        song.key,
        song.scale,
        section.bars
      ).parsed;
      const barHead = fitPitchClassToRange(
        chord.bassPitchClass ?? chord.rootPitchClass,
        params.barHeadRootMin,
        params.barHeadRootMax
      );
      const oct = barHead + 12 <= BASS_MAX_PITCH ? barHead + 12 : barHead;
      const b7Pitch =
        barHead - 2 >= BASS_MIN_PITCH
          ? barHead - 2
          : barHead + 10 <= BASS_MAX_PITCH
            ? barHead + 10
            : fitPitchClassToRange(
                (chord.rootSemitone + 10) % 12,
                BASS_MIN_PITCH,
                BASS_MAX_PITCH
              );
      const boogieRiff: Array<[number, number, number, BassRole]> =
        style === 'B'
          ? [
              [0, barHead, 120, 'root'],
              [240, oct, 110, 'octave_jump'],
              [720, oct, 110, 'octave_jump'],
              [960, barHead, 120, 'root'],
              [1200, oct, 110, 'octave_jump'],
              [1560, b7Pitch, 110, 'b7'],
              [1680, oct, 110, 'octave_jump'],
            ]
          : [
              [0, barHead, 120, 'root'],
              [240, oct, 110, 'octave_jump'],
              [360, barHead, 80, 'ghost'],
              [720, oct, 110, 'octave_jump'],
              [960, barHead, 120, 'root'],
              [1200, oct, 110, 'octave_jump'],
              [1560, b7Pitch, 110, 'b7'],
              [1680, oct, 110, 'octave_jump'],
              [1800, barHead, 80, 'ghost'],
            ];
      for (const [off, p, dur, role] of boogieRiff) {
        pushSlot(off, dur, role, 'staccato', p);
      }
    } else {
      // 'auto': Full DNA-Driven Stage 1 + Stage 2 Groove Skeleton
      const barSteps = new Map<number, BassSlotEvent>();

      // Guarantee bar head & beat 3 (960) anchor cleanly so Stage 4 fill windows never bleed backwards
      const addAutoSlot = (
        localTick: number,
        dur: number,
        role: BassRole,
        art: BassArticulation = 'normal'
      ) => {
        const absTick = barStart + localTick;
        if (absTick >= sectionEnd) return;
        barSteps.set(localTick, {
          startTick: absTick,
          baseDuration: dur,
          role: changeTickSet.has(absTick) ? 'chord_change' : role,
          articulation: art,
          isStrongBeat: localTick === 0 || localTick === 960,
          isChordChange: changeTickSet.has(absTick),
        });
      };

      // 1. Bar head is always locked (1.00)
      addAutoSlot(0, 220, 'root', 'normal');

      // 2. Lock kicks according to dna.kickLockRate (100% on beat 3 = 960 & chord changes)
      for (let local = SIXTEENTH_TICKS; local < BAR_TICKS; local += SIXTEENTH_TICKS) {
        const abs = barStart + local;
        if (changeTickSet.has(abs)) {
          addAutoSlot(local, 220, 'chord_change', 'normal');
          continue;
        }
        if (kickSet.has(abs)) {
          const isStrong = local === 960;
          if (isStrong || grooveRng.chance(dna.kickLockRate)) {
            addAutoSlot(local, 220, isStrong ? 'root' : 'kick_sync', 'normal');
          }
        }
      }

      // Guarantee beat 3 anchor on fill bars so Stage 4 isolates cleanly at 960
      if (!barSteps.has(960)) {
        addAutoSlot(960, 220, 'root', 'normal');
      }

      // 3. Driving 8th or DNA offbeat call-and-response & ghost notes
      if (song.members.bass.bassStyle === 'Driving 8th') {
        for (let off = EIGHTH_TICKS; off < BAR_TICKS; off += EIGHTH_TICKS) {
          if (!barSteps.has(off)) {
            const role: BassRole =
              off === 1680
                ? 'passing'
                : grooveRng.chance(dna.pitchWeights.octave)
                  ? 'octave_jump'
                  : 'root';
            addAutoSlot(off, 210, role, 'normal');
          }
        }
      } else {
        const offbeatCandidates = [480, 720, 1200, 1440, 1680, 240];
        for (const off of offbeatCandidates) {
          if (barSteps.has(off)) continue;
          // Respect Half-Time or Low chill stillness when not Driving
          if (
            dna.id === 'chill_lofi_ballad' &&
            off !== 1440 &&
            grooveRng.chance(0.55)
          ) {
            continue;
          }
          if (grooveRng.chance(dna.offbeatFillRate)) {
            const r = grooveRng.next();
            const role: BassRole =
              off === 1680
                ? 'passing'
                : r < dna.pitchWeights.octave
                  ? 'octave_jump'
                  : r < dna.pitchWeights.octave + dna.pitchWeights.color + dna.pitchWeights.fifth
                    ? 'chord_tone'
                    : 'root';
            addAutoSlot(off, 210, role, 'normal');
          }
        }

        // 16th ghost notes in empty 16th pockets (avoiding 0 and 960)
        if (style !== 'B' && dna.ghostFreq > 0.05) {
          const ghostPockets = [360, 600, 840, 1080, 1320, 1560, 1800];
          let ghostsPlaced = 0;
          for (const gOff of ghostPockets) {
            if (ghostsPlaced >= (dna.id === 'fusion_funk' ? 2 : 1)) break;
            if (barSteps.has(gOff)) continue;
            // Ensure room for 60..90 tick ghost before next 120-tick step
            if (barSteps.has(gOff - 60)) continue;
            if (grooveRng.chance(dna.ghostFreq)) {
              addAutoSlot(gOff, 75, 'ghost', 'staccato');
              ghostsPlaced++;
            }
          }
        }
      }

      // Optional passing turnaround at beat 4-and (1680) if forcePassingFill or passingProb
      if (
        !barSteps.has(1680) &&
        (params.forcePassingFill || (style !== 'B' && grooveRng.chance(params.passingProb)))
      ) {
        addAutoSlot(1680, 210, 'passing', 'normal');
      }

      const sortedBar = Array.from(barSteps.values()).sort(
        (a, b) => a.startTick - b.startTick
      );
      for (let i = 0; i < sortedBar.length; i++) {
        const s = sortedBar[i];
        if (s.role !== 'ghost') {
          const nextT = i + 1 < sortedBar.length ? sortedBar[i + 1].startTick : barEnd;
          const span = Math.max(SIXTEENTH_TICKS, nextT - s.startTick);
          s.baseDuration = Math.min(
            Math.max(90, span - 5),
            Math.round(span * dna.baseGateRatio)
          );
        }
        slotEvents.push(s);
      }
    }
  }

  // Sync offbeat ChordSlot boundaries across non-jrock_anticipation presets:
  // Cut previous note cleanly at changeTick - 5, strike new chord root at changeTick,
  // and clear re-attack in (changeTick, changeTick + 240] unless kick explicitly locks there
  if (offbeatChanges.length > 0 && bassPreset !== 'jrock_anticipation') {
    for (const change of offbeatChanges) {
      const changeTick = change.changeTick;
      for (let i = slotEvents.length - 1; i >= 0; i--) {
        const ev = slotEvents[i];
        if (ev.startTick >= changeTick && ev.startTick <= changeTick + 240) {
          slotEvents.splice(i, 1);
        } else if (
          ev.startTick < changeTick &&
          ev.startTick + ev.baseDuration > changeTick - 5
        ) {
          const clipped = changeTick - 5 - ev.startTick;
          if (clipped < 30) {
            slotEvents.splice(i, 1);
          } else {
            ev.baseDuration = clipped;
          }
        }
      }

      slotEvents.push({
        startTick: changeTick,
        baseDuration: Math.min(680, Math.max(240, change.endTick - changeTick - 5)),
        role: bassPreset === 'pedal_point' ? 'pedal' : 'chord_change',
        articulation: 'sustain',
        isStrongBeat: false,
        isChordChange: true,
      });
    }
  }

  slotEvents.sort((a, b) => a.startTick - b.startTick);

  // =========================================================================
  // Stage 3: Pitch, Safe-Scale & Chromatic Solver
  // =========================================================================
  const buildChordPitchClasses = (chord: ParsedChord): Set<number> => {
    const pcs = new Set<number>();
    for (const iv of chord.intervals) {
      pcs.add((chord.rootSemitone + iv) % 12);
    }
    if (chord.bassPitchClass !== undefined) {
      pcs.add(chord.bassPitchClass);
    }
    return pcs;
  };

  const expandPitchClasses = (
    pcs: ReadonlySet<number>,
    minP: number,
    maxP: number
  ): number[] => {
    const out: number[] = [];
    for (let p = minP; p <= maxP; p++) {
      if (pcs.has(p % 12)) out.push(p);
    }
    return out;
  };

  const resolvedNotes: ResolvedBassNote[] = [];
  let prevPitch = 36;
  let chromaticCountInBar = 0;
  let consecutiveChromatic = 0;
  let currentTrackBar = -1;

  for (let i = 0; i < slotEvents.length; i++) {
    const ev = slotEvents[i];
    const barIdx = Math.floor(ev.startTick / BAR_TICKS);
    if (barIdx !== currentTrackBar) {
      currentTrackBar = barIdx;
      chromaticCountInBar = 0;
      consecutiveChromatic = 0;
    }

    const solveRng = createSeededRng(
      hashSeed(seed, sectionIndex, ev.startTick, 0x51a7b3c9)
    );

    const active = getActiveChordAtTick(
      section.chords,
      ev.startTick,
      song.key,
      song.scale,
      section.bars
    );
    const chord = active.parsed;
    const chordPcs = buildChordPitchClasses(chord);
    const isDim7 =
      chord.quality === 'dim' &&
      chord.intervals.includes(6) &&
      chord.intervals.includes(9);
    const safePcs = getMusicalSafePitchClasses(
      keyScalePcs,
      chordPcs,
      chord.rootPitchClass,
      isDim7
    );

    const rootPc =
      ev.role === 'pedal'
        ? songKeyPc
        : chord.bassPitchClass ?? chord.rootPitchClass;
    const barHeadRoot = fitPitchClassToRange(
      rootPc,
      params.barHeadRootMin,
      params.barHeadRootMax
    );
    const octRoot =
      barHeadRoot + 12 <= BASS_MAX_PITCH ? barHeadRoot + 12 : barHeadRoot;

    // Next target root for chromatic / passing resolution
    const nextEv = i + 1 < slotEvents.length ? slotEvents[i + 1] : null;
    const nextChord = getActiveChordAtTick(
      section.chords,
      nextEv ? nextEv.startTick : Math.min(sectionEnd - 1, ev.startTick + 240),
      song.key,
      song.scale,
      section.bars
    ).parsed;
    const nextTargetRoot = fitPitchClassToRange(
      nextChord.bassPitchClass ?? nextChord.rootPitchClass,
      params.barHeadRootMin,
      params.barHeadRootMax
    );

    let chosenPitch = barHeadRoot;
    let isChromatic = false;

    if (ev.explicitPitch !== undefined) {
      chosenPitch = clampBassPitch(ev.explicitPitch);
      // Guarantee non-chromatic safety when bassChromaticEnabled === false
      if (!chromaticEnabled && !safePcs.has(chosenPitch % 12) && !keyScalePcs.has(chosenPitch % 12) && !chordPcs.has(chosenPitch % 12)) {
        const safeCands = expandPitchClasses(safePcs, BASS_MIN_PITCH, STABLE_MAX_PITCH);
        if (safeCands.length > 0) {
          chosenPitch = safeCands.reduce((best, c) =>
            Math.abs(c - chosenPitch) < Math.abs(best - chosenPitch) ? c : best
          );
        }
      }
    } else if (ev.role === 'pedal') {
      chosenPitch = barHeadRoot;
    } else if (ev.isStrongBeat || ev.isChordChange || ev.role === 'root' || ev.role === 'kick_sync') {
      // Strong beats & chord changes strictly lock Root / specified slash bass (or 3rd/5th occasionally on non-head kick sync)
      if (
        !ev.isStrongBeat &&
        !ev.isChordChange &&
        ev.role === 'kick_sync' &&
        solveRng.chance(0.22)
      ) {
        const fifthIv = chord.intervals.includes(6)
          ? 6
          : chord.intervals.includes(8)
            ? 8
            : 7;
        const fifthP = fitPitchClassToRange(
          (chord.rootSemitone + fifthIv) % 12,
          BASS_MIN_PITCH,
          STABLE_MAX_PITCH
        );
        chosenPitch = safePcs.has(fifthP % 12) ? fifthP : barHeadRoot;
      } else {
        chosenPitch = barHeadRoot;
      }
    } else if (ev.role === 'octave_jump') {
      chosenPitch = octRoot;
    } else if (ev.role === 'ghost') {
      chosenPitch = solveRng.chance(0.65) ? barHeadRoot : octRoot;
    } else {
      // 'chord_tone' or 'passing' slot
      const canTryChromatic =
        chromaticEnabled &&
        !ev.isStrongBeat &&
        !ev.isChordChange &&
        ev.baseDuration <= 240 &&
        consecutiveChromatic < 2 &&
        chromaticCountInBar < 3;

      if (
        canTryChromatic &&
        ev.role === 'passing' &&
        solveRng.chance(dna.chromaticRate)
      ) {
        // Chromatic approach (+-1 to nextTargetRoot) or b5 blue note
        const candList: number[] = [];
        if (nextTargetRoot - 1 >= BASS_MIN_PITCH) candList.push(nextTargetRoot - 1);
        if (nextTargetRoot + 1 <= STABLE_MAX_PITCH) candList.push(nextTargetRoot + 1);
        if (
          dna.id === 'fusion_funk' ||
          dna.id === 'emo_jrock' ||
          dna.id === 'alt_heavy_rock'
        ) {
          const b5 = fitPitchClassToRange(
            (chord.rootSemitone + 6) % 12,
            BASS_MIN_PITCH,
            STABLE_MAX_PITCH
          );
          candList.push(b5);
        }
        const picked =
          candList.length > 0 ? solveRng.pick(candList) : barHeadRoot;
        chosenPitch = picked;
        if (!keyScalePcs.has(picked % 12) && !chordPcs.has(picked % 12)) {
          isChromatic = true;
        }
      } else {
        // Strictly inside safePcs (which is always a subset of keyScalePcs U chordPcs)
        const targetPoolPcs = ev.role === 'chord_tone' ? chordPcs : safePcs;
        const cands = expandPitchClasses(
          targetPoolPcs,
          BASS_MIN_PITCH,
          STABLE_MAX_PITCH
        );
        if (cands.length > 0) {
          let bestPitch = barHeadRoot;
          let bestScore = -Infinity;
          for (const c of cands) {
            let s = 0;
            const pc = c % 12;
            if (pc === rootPc) s += 1.0;
            else if (chordPcs.has(pc)) s += 2.2;
            else s += 1.4;
            const travel = computeFretTravelCost(prevPitch, c);
            s -= travel * 0.45;
            if (Math.abs(c - prevPitch) > 7 && ev.baseDuration <= 140) {
              s -= 6.0;
            }
            // Prefer moving toward nextTargetRoot on 'passing'
            if (ev.role === 'passing') {
              s -= Math.abs(c - nextTargetRoot) * 0.35;
            }
            s += solveRng.nextFloat(-0.35, 0.35);
            if (s > bestScore) {
              bestScore = s;
              bestPitch = c;
            }
          }
          chosenPitch = bestPitch;
        } else {
          chosenPitch = barHeadRoot;
        }
      }
    }

    if (isChromatic) {
      chromaticCountInBar += 1;
      consecutiveChromatic += 1;
    } else {
      consecutiveChromatic = 0;
    }

    prevPitch = chosenPitch;

    // Assign preliminary 3-tier velocity (refined deterministically in Stage 5)
    const micro = solveRng.nextInt(-3, 3);
    const velBase =
      ev.role === 'ghost'
        ? 55 + micro
        : ev.isStrongBeat || ev.isChordChange
          ? 106 + micro
          : 82 + micro;

    resolvedNotes.push({
      ...ev,
      pitch: clampBassPitch(chosenPitch),
      velocity: clampVelocity(
        ev.role === 'ghost'
          ? Math.min(65, Math.max(45, velBase))
          : Math.min(params.velocityCap, velBase + params.velocityBoost)
      ),
      isChromatic,
    });
  }

  // =========================================================================
  // Stage 4: Isolated Section Bass Fill-In Injection (uses fillRng only!)
  // =========================================================================
  let finalStageNotes: ResolvedBassNote[] = resolvedNotes;
  if (fillEnabled && fillWindows.length > 0) {
    const outNotes: ResolvedBassNote[] = [];
    let cursor = 0;

    for (const win of fillWindows) {
      // Preserve every note strictly outside [win.start, win.end) untouched!
      while (cursor < resolvedNotes.length && resolvedNotes[cursor].startTick < win.start) {
        outNotes.push(resolvedNotes[cursor]);
        cursor++;
      }
      // Drop existing notes inside [win.start, win.end)
      while (cursor < resolvedNotes.length && resolvedNotes[cursor].startTick < win.end) {
        cursor++;
      }

      const fillRng = createSeededRng(
        hashSeed(seed, sectionIndex, win.barIndex, fillSeed, 0x9e3779b9)
      );

      const winChord = getActiveChordAtTick(
        section.chords,
        win.start,
        song.key,
        song.scale,
        section.bars
      ).parsed;
      const winChordPcs = buildChordPitchClasses(winChord);
      const isDim7 =
        winChord.quality === 'dim' &&
        winChord.intervals.includes(6) &&
        winChord.intervals.includes(9);
      const winSafePcs = getMusicalSafePitchClasses(
        keyScalePcs,
        winChordPcs,
        winChord.rootPitchClass,
        isDim7
      );

      const nextBarTick = win.end < sectionEnd ? win.end : 0;
      const targetNextChord = getActiveChordAtTick(
        section.chords,
        nextBarTick,
        song.key,
        song.scale,
        section.bars
      ).parsed;
      const targetNextRoot = fitPitchClassToRange(
        targetNextChord.bassPitchClass ?? targetNextChord.rootPitchClass,
        params.barHeadRootMin,
        params.barHeadRootMax
      );

      const winRoot = fitPitchClassToRange(
        winChord.bassPitchClass ?? winChord.rootPitchClass,
        params.barHeadRootMin,
        params.barHeadRootMax
      );
      const winSafeExpanded = expandPitchClasses(
        winSafePcs,
        BASS_MIN_PITCH,
        BASS_MAX_PITCH
      );
      const safePool = winSafeExpanded.length > 0 ? winSafeExpanded : [winRoot];

      type FillVocab =
        | 'octave_climb'
        | 'high_descent'
        | 'hammer_syncopation'
        | 'ghost_octave_burst'
        | 'target_scale_run'
        | 'chromatic_lead_in';
      const vocabPool: FillVocab[] = chromaticEnabled
        ? [
            'octave_climb',
            'high_descent',
            'hammer_syncopation',
            'ghost_octave_burst',
            'target_scale_run',
            'chromatic_lead_in',
          ]
        : [
            'octave_climb',
            'high_descent',
            'hammer_syncopation',
            'ghost_octave_burst',
            'target_scale_run',
          ];
      const chosenVocab = vocabPool[fillRng.nextInt(0, vocabPool.length - 1)];

      const fillEvents: Array<{
        tick: number;
        pitch: number;
        dur: number;
        role: BassRole;
        art: BassArticulation;
        vel: number;
      }> = [];

      const nearestSafe = (target: number): number =>
        safePool.reduce((best, c) =>
          Math.abs(c - target) < Math.abs(best - target) ? c : best
        );

      // Anchor win.start (Beat 3) on winChord tone / root for clean harmonic support
      const fifthIv = winChord.intervals.includes(6)
        ? 6
        : winChord.intervals.includes(8)
          ? 8
          : 7;
      const thirdIv = winChord.intervals.includes(3)
        ? 3
        : winChord.intervals.includes(4)
          ? 4
          : fifthIv;
      const pRoot = winRoot;
      const pThird = nearestSafe(winRoot + thirdIv);
      const pFifth = nearestSafe(winRoot + fifthIv);
      const pSeventh = nearestSafe(winRoot + (winChord.intervals.includes(11) ? 11 : 10));
      const pOct = clampBassPitch(winRoot + 12);

      if (chosenVocab === 'octave_climb') {
        const steps = [
          [0, pRoot, 220, 'root', 'normal', 102],
          [240, pFifth, 220, 'fill', 'normal', 82],
          [480, pSeventh, 220, 'fill', 'normal', 84],
          [720, pOct, 210, 'octave_jump', 'normal', 96],
        ] as const;
        for (const [off, p, d, r, a, v] of steps) {
          fillEvents.push({ tick: win.start + off, pitch: p, dur: d, role: r, art: a, vel: v });
        }
      } else if (chosenVocab === 'high_descent') {
        const startHigh = clampBassPitch(winRoot + 12, 43, BASS_MAX_PITCH);
        const hiPool = safePool.filter((p) => p <= startHigh && p >= winRoot);
        const desc = hiPool.length >= 4
          ? hiPool.slice(-4).reverse()
          : [startHigh, nearestSafe(startHigh - 2), nearestSafe(startHigh - 5), pRoot];
        const offs = [0, 240, 480, 720];
        for (let k = 0; k < 4; k++) {
          fillEvents.push({
            tick: win.start + offs[k],
            pitch: k === 0 ? nearestSafe(pRoot) : desc[k],
            dur: 215,
            role: k === 0 ? 'root' : 'fill',
            art: 'normal',
            vel: k === 0 ? 102 : 82,
          });
        }
      } else if (chosenVocab === 'hammer_syncopation') {
        const stepUp = nearestSafe(pFifth + 2);
        const pairs: Array<[number, number, number, BassRole, BassArticulation, number]> = [
          [0, pRoot, 220, 'root', 'normal', 102],
          [240, pFifth, 115, 'fill', 'legato', 80],
          [360, stepUp, 220, 'fill', 'normal', 85],
          [600, pFifth, 115, 'fill', 'legato', 80],
          [720, pOct, 210, 'octave_jump', 'normal', 96],
        ];
        for (const [off, p, d, r, a, v] of pairs) {
          fillEvents.push({ tick: win.start + off, pitch: p, dur: d, role: r, art: a, vel: v });
        }
      } else if (chosenVocab === 'ghost_octave_burst') {
        const burst: Array<[number, number, number, BassRole, BassArticulation, number]> = [
          [0, pRoot, 210, 'root', 'normal', 104],
          [240, pRoot, 75, 'ghost', 'staccato', 56],
          [360, pOct, 210, 'octave_jump', 'normal', 92],
          [600, pRoot, 75, 'ghost', 'staccato', 54],
          [720, pFifth, 210, 'fill', 'normal', 86],
        ];
        for (const [off, p, d, r, a, v] of burst) {
          fillEvents.push({ tick: win.start + off, pitch: p, dur: d, role: r, art: a, vel: v });
        }
      } else if (chosenVocab === 'chromatic_lead_in' && chromaticEnabled) {
        const appr1 = Math.max(BASS_MIN_PITCH, targetNextRoot - 2);
        const appr2 = Math.max(BASS_MIN_PITCH, targetNextRoot - 1);
        const lead: Array<[number, number, number, BassRole, BassArticulation, number]> = [
          [0, pRoot, 220, 'root', 'normal', 104],
          [240, pFifth, 220, 'fill', 'normal', 82],
          [480, pThird, 220, 'fill', 'normal', 82],
          [720, appr1, 115, 'fill', 'legato', 80],
          [840, appr2, 110, 'fill', 'normal', 84],
        ];
        for (const [off, p, d, r, a, v] of lead) {
          fillEvents.push({ tick: win.start + off, pitch: p, dur: d, role: r, art: a, vel: v });
        }
      } else {
        // target_scale_run
        const runMid = nearestSafe(Math.round((pRoot + targetNextRoot) / 2));
        const runPre = nearestSafe(
          targetNextRoot >= pRoot ? targetNextRoot - 2 : targetNextRoot + 2
        );
        const run: Array<[number, number, number, BassRole, BassArticulation, number]> = [
          [0, pRoot, 220, 'root', 'normal', 102],
          [240, pThird, 220, 'fill', 'normal', 82],
          [480, runMid, 220, 'fill', 'normal', 84],
          [720, runPre, 210, 'fill', 'normal', 86],
        ];
        for (const [off, p, d, r, a, v] of run) {
          fillEvents.push({ tick: win.start + off, pitch: p, dur: d, role: r, art: a, vel: v });
        }
      }

      // Apply fill-count adaptation for chill_lofi_ballad (3..5) vs fusion_funk (up to 8..12 across window)
      const countCap = dna.id === 'chill_lofi_ballad' ? 3 : fillEvents.length;
      const trimmedFill = fillEvents.slice(0, countCap);
      for (const fe of trimmedFill) {
        if (fe.tick >= sectionEnd) continue;
        const isChangeAtTick = changeTickSet.has(fe.tick);
        let finalP = fe.pitch;
        if (isChangeAtTick) {
          const tickChord = getActiveChordAtTick(
            section.chords,
            fe.tick,
            song.key,
            song.scale,
            section.bars
          ).parsed;
          finalP = fitPitchClassToRange(
            tickChord.bassPitchClass ?? tickChord.rootPitchClass,
            params.barHeadRootMin,
            params.barHeadRootMax
          );
        } else if (!chromaticEnabled) {
          const tickChord = getActiveChordAtTick(
            section.chords,
            fe.tick,
            song.key,
            song.scale,
            section.bars
          ).parsed;
          const tickChordPcs = buildChordPitchClasses(tickChord);
          if (!keyScalePcs.has(finalP % 12) && !tickChordPcs.has(finalP % 12)) {
            const tickSafe = getMusicalSafePitchClasses(
              keyScalePcs,
              tickChordPcs,
              tickChord.rootPitchClass,
              tickChord.quality === 'dim' &&
                tickChord.intervals.includes(6) &&
                tickChord.intervals.includes(9)
            );
            const pool = expandPitchClasses(tickSafe, BASS_MIN_PITCH, BASS_MAX_PITCH);
            if (pool.length > 0) {
              finalP = pool.reduce((best, c) =>
                Math.abs(c - finalP) < Math.abs(best - finalP) ? c : best
              );
            } else {
              finalP = nearestSafe(finalP);
            }
          }
        }
        outNotes.push({
          startTick: fe.tick,
          baseDuration: fe.dur,
          role: isChangeAtTick ? 'chord_change' : fe.role,
          articulation: fe.art,
          isStrongBeat: fe.tick % BAR_TICKS === 0 || fe.tick % BAR_TICKS === 960,
          isChordChange: isChangeAtTick,
          pitch: clampBassPitch(finalP),
          velocity: clampVelocity(
            fe.role === 'ghost'
              ? Math.min(65, Math.max(45, fe.vel + fillRng.nextInt(-3, 3)))
              : Math.min(params.velocityCap, fe.vel + fillRng.nextInt(-3, 3))
          ),
        });
      }
    }

    while (cursor < resolvedNotes.length) {
      outNotes.push(resolvedNotes[cursor]);
      cursor++;
    }
    finalStageNotes = outNotes;
  }

  // =========================================================================
  // Stage 5: MODO Bass Articulation & Strict Monophony Sanitizer
  // =========================================================================
  finalStageNotes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  const dedupedStage: ResolvedBassNote[] = [];
  for (const n of finalStageNotes) {
    if (
      dedupedStage.length > 0 &&
      dedupedStage[dedupedStage.length - 1].startTick === n.startTick
    ) {
      continue;
    }
    dedupedStage.push({ ...n });
  }

  for (let i = 0; i < dedupedStage.length; i++) {
    const curr = dedupedStage[i];
    const next = i + 1 < dedupedStage.length ? dedupedStage[i + 1] : null;
    const localTick = curr.startTick % BAR_TICKS;

    // Enforce 3-tier MODO Bass Velocity Dynamics
    if (curr.role === 'ghost') {
      curr.velocity = Math.min(65, Math.max(45, curr.velocity));
      curr.baseDuration = Math.min(90, Math.max(60, curr.baseDuration));
    } else if (localTick === 0 || localTick === 960 || curr.isChordChange) {
      curr.velocity = Math.min(118, Math.max(95, curr.velocity));
    } else if (curr.role !== 'octave_jump' && bassPreset !== 'disco_boogie_bounce') {
      curr.velocity = Math.min(88, Math.max(75, curr.velocity));
    }

    if (!next) {
      curr.baseDuration = Math.max(
        30,
        Math.min(curr.baseDuration, sectionEnd - curr.startTick)
      );
      continue;
    }

    const span = next.startTick - curr.startTick;

    if (curr.role === 'ghost') {
      curr.baseDuration = Math.min(90, Math.max(30, Math.min(curr.baseDuration, span - 5)));
    } else if (
      curr.articulation === 'legato' &&
      curr.pitch !== next.pitch &&
      Math.abs(curr.pitch - next.pitch) <= 2 &&
      span >= 60
    ) {
      // Hammer-on / Slide legato: 2..5 ticks gap before next note
      const legatoGap = 2 + (i % 4);
      curr.baseDuration = Math.max(30, span - legatoGap);
    } else if (
      curr.pitch === next.pitch &&
      span <= EIGHTH_TICKS &&
      curr.articulation !== 'staccato' &&
      bassPreset !== 'metal_gallop' &&
      bassPreset !== 'disco_boogie_bounce'
    ) {
      // Same-pitch repeated articulation: 15..30 ticks release gap
      const releaseGap = 15 + ((curr.startTick + i) % 16);
      curr.baseDuration = Math.max(30, span - releaseGap);
    } else if (bassPreset === 'auto') {
      const gate =
        curr.articulation === 'sustain' ? dna.sustainGateRatio : dna.baseGateRatio;
      const targetDur = Math.round(span * gate);
      curr.baseDuration = Math.max(
        30,
        Math.min(Math.max(30, span - 5), targetDur)
      );
    } else {
      curr.baseDuration = Math.max(
        30,
        Math.min(curr.baseDuration, Math.max(30, span - 5))
      );
    }
  }

  return dedupedStage
    .filter((n) => n.startTick >= 0 && n.startTick < sectionEnd)
    .map((n, idx) => {
      const nextStart =
        idx + 1 < dedupedStage.length ? dedupedStage[idx + 1].startTick : sectionEnd;
      const maxDur = Math.max(30, nextStart - n.startTick);
      return {
        pitch: clampBassPitch(n.pitch),
        velocity: clampVelocity(n.velocity),
        startTick: n.startTick,
        durationTicks: Math.min(sectionEnd - n.startTick, Math.min(n.baseDuration, maxDur)),
        channel: 0,
      };
    });
}
