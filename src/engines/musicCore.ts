import {
  TICKS_PER_BAR,
  type KeyName,
  type MidiControlChangeEvent,
  type MidiNote,
  type ScaleType,
  type Section,
} from '../types/song';
import {
  getActiveChordAtTick,
  getTimelineBoundaryChanges,
} from '../lib/chordTimeline';
import {
  getScalePitchClasses,
  type ParsedChord,
} from '../lib/chordUtils';

export function getParsedChordPitchClasses(parsed: ParsedChord): number[] {
  return Array.from(
    new Set(parsed.intervals.map((iv) => (parsed.rootPitchClass + iv + 12) % 12))
  );
}

export const TPQN = 480;
export const BEAT_TICKS = TPQN;
export const BAR_TICKS = TPQN * 4; // 1920 ticks (4/4)
export const EIGHTH_TICKS = 240;
export const SIXTEENTH_TICKS = 120;
export const BASS_MIN_MIDI = 28; // E1
export const BASS_MAX_MIDI = 55; // G3

export type SubdivisionMode =
  | 'STRAIGHT'
  | 'BOUNCE_16'
  | 'SHUFFLE_8'
  | 'HALF_TIME_SHUFFLE';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveSeed(masterSeed: number, salt: string): number {
  let h = (2166136261 ^ (masterSeed >>> 0)) >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mapTickToSubdivision(
  rawTick: number,
  mode: SubdivisionMode
): number {
  if (mode === 'STRAIGHT') return rawTick;
  const barIdx = Math.floor(rawTick / BAR_TICKS);
  const inBar = rawTick - barIdx * BAR_TICKS;
  const beat = Math.floor(inBar / TPQN);
  let inBeat = inBar - beat * TPQN;

  if (mode === 'BOUNCE_16') {
    if (inBeat === 120) inBeat = 140;
    else if (inBeat === 360) inBeat = 380;
  } else if (mode === 'SHUFFLE_8') {
    if (inBeat === 120) inBeat = 160;
    else if (inBeat === 240 || inBeat === 360) inBeat = 320;
  } else if (mode === 'HALF_TIME_SHUFFLE') {
    if (inBeat === 120) inBeat = 160;
    else if (inBeat === 240) inBeat = 320;
    else if (inBeat === 360) inBeat = 400;
  }
  return barIdx * BAR_TICKS + beat * TPQN + inBeat;
}

// ===========================================================================
// Chord Timeline Windows (with 240-tick Offbeat Anticipation support)
// ===========================================================================
export interface ChordWindow {
  readonly index: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly chordSymbol: string;
  readonly parsed: ParsedChord;
  readonly isAnticipated: boolean;
  readonly anticipationTicks: number;
}

export function buildChordWindows(
  section: Section,
  key: KeyName,
  scale: ScaleType
): ChordWindow[] {
  const totalBars = Math.max(1, section.bars);
  const sectionEnd = totalBars * TICKS_PER_BAR;
  const changes = getTimelineBoundaryChanges(
    section.chords,
    totalBars,
    key,
    scale
  );

  const sorted: Array<{
    changeTick: number;
    parsed: ParsedChord;
    isOffbeat: boolean;
  }> = changes
    .filter((c) => c.changeTick >= 0 && c.changeTick < sectionEnd)
    .map((c) => ({
      changeTick: c.changeTick,
      parsed: c.parsed,
      isOffbeat: c.isOffbeat,
    }))
    .sort((a, b) => a.changeTick - b.changeTick);

  // Always include the initial chord at tick 0
  if (sorted.length === 0 || sorted[0].changeTick > 0) {
    const initial = getActiveChordAtTick(
      section.chords,
      0,
      key,
      scale,
      totalBars
    );
    sorted.unshift({
      changeTick: 0,
      parsed: initial.parsed,
      isOffbeat: false,
    });
  }

  const windows: ChordWindow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    const startTick = Math.max(0, Math.min(sectionEnd - 1, curr.changeTick));
    const nextStart =
      i + 1 < sorted.length
        ? Math.max(startTick + 1, Math.min(sectionEnd, sorted[i + 1].changeTick))
        : sectionEnd;
    windows.push({
      index: i,
      startTick,
      endTick: nextStart,
      chordSymbol: curr.parsed.raw,
      parsed: curr.parsed,
      isAnticipated: curr.isOffbeat,
      anticipationTicks: curr.isOffbeat ? 240 : 0,
    });
  }
  return windows;
}

export function findChordAtTick(
  windows: readonly ChordWindow[],
  tick: number
): ChordWindow {
  for (let i = windows.length - 1; i >= 0; i--) {
    const w = windows[i];
    if (tick >= w.startTick) {
      return w;
    }
  }
  return windows[0];
}

// ===========================================================================
// Smooth Voice-Leading & Vocal Non-Interference Solver
// ===========================================================================
export interface SmoothVoicingOptions {
  readonly pitchClasses: readonly number[];
  readonly prevVoicing: readonly number[] | null;
  readonly minMidi: number;
  readonly maxMidi: number;
  readonly vocalRange?: { min: number; max: number } | null;
  readonly preferDrop2?: boolean;
  readonly voiceCount?: number;
}

function buildCloseVoicingFromBase(
  pcs: readonly number[],
  basePcIdx: number,
  startOctaveBase: number
): number[] {
  const n = pcs.length;
  const notes: number[] = [];
  let cursor = startOctaveBase + pcs[basePcIdx];
  notes.push(cursor);
  for (let offset = 1; offset < n; offset++) {
    const pc = pcs[(basePcIdx + offset) % n];
    let next = Math.floor(cursor / 12) * 12 + pc;
    while (next <= cursor) next += 12;
    notes.push(next);
    cursor = next;
  }
  return notes;
}

function applyDrop2(voicing: readonly number[]): number[] {
  if (voicing.length < 4) return [...voicing];
  const sorted = [...voicing].sort((a, b) => a - b);
  const secondHighestIdx = sorted.length - 2;
  const dropped = sorted[secondHighestIdx] - 12;
  const out = sorted.filter((_, idx) => idx !== secondHighestIdx);
  out.push(dropped);
  return out.sort((a, b) => a - b);
}

function computeLowIntervalPenalty(voicing: readonly number[]): number {
  let penalty = 0;
  for (let i = 0; i + 1 < voicing.length; i++) {
    const low = voicing[i];
    const high = voicing[i + 1];
    const interval = high - low;
    if (low < 52 && interval <= 2) {
      penalty += 18; // muddy minor/major 2nd below E3
    } else if (low < 48 && interval <= 4) {
      penalty += 12; // muddy 3rd below C3
    } else if (low < 43 && interval <= 5) {
      penalty += 10; // muddy 4th below G2
    }
  }
  return penalty;
}

export function resolveSmoothVoicing(options: SmoothVoicingOptions): number[] {
  const {
    pitchClasses,
    prevVoicing,
    minMidi,
    maxMidi,
    vocalRange,
    preferDrop2 = false,
  } = options;

  const uniquePcs = Array.from(
    new Set(pitchClasses.map((pc) => ((pc % 12) + 12) % 12))
  );
  if (uniquePcs.length === 0) return [60, 64, 67];

  const effectiveMax =
    vocalRange && Number.isFinite(vocalRange.min)
      ? Math.max(minMidi + 7, Math.min(maxMidi, Math.floor(vocalRange.min) - 2))
      : maxMidi;

  const candidates: number[][] = [];
  for (let oct = 2; oct <= 6; oct++) {
    const octBase = oct * 12;
    for (let inv = 0; inv < uniquePcs.length; inv++) {
      const close = buildCloseVoicingFromBase(uniquePcs, inv, octBase);
      if (close[0] >= minMidi - 5 && close[close.length - 1] <= effectiveMax + 5) {
        candidates.push(close);
      }
      if (uniquePcs.length >= 4) {
        const d2 = applyDrop2(close);
        if (d2[0] >= minMidi - 5 && d2[d2.length - 1] <= effectiveMax + 5) {
          candidates.push(d2);
        }
      }
    }
  }

  if (candidates.length === 0) {
    // Fallback: pack into [minMidi, effectiveMax]
    const fallback = buildCloseVoicingFromBase(
      uniquePcs,
      0,
      Math.floor(minMidi / 12) * 12
    ).map((p) => {
      let x = p;
      while (x < minMidi) x += 12;
      while (x > effectiveMax) x -= 12;
      return clamp(x, minMidi, effectiveMax);
    });
    return Array.from(new Set(fallback)).sort((a, b) => a - b);
  }

  const targetCenter = (minMidi + effectiveMax) / 2;
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const cand of candidates) {
    let score = 0;

    // Range boundary penalty
    for (const p of cand) {
      if (p < minMidi) score += (minMidi - p) * 6;
      if (p > effectiveMax) score += (p - effectiveMax) * 9;
    }

    // Vocal collision penalty
    if (vocalRange) {
      for (const p of cand) {
        if (p >= vocalRange.min) {
          score += 24 + (p - vocalRange.min) * 6;
        } else if (p >= vocalRange.min - 1) {
          score += 6;
        }
      }
    }

    // Low Interval Limits penalty
    score += computeLowIntervalPenalty(cand);

    // Drop-2 preference for open voicings
    const span = cand[cand.length - 1] - cand[0];
    if (preferDrop2 && uniquePcs.length >= 4 && span >= 13 && span <= 21) {
      score -= 1.5;
    }

    // Voice leading cost against previous voicing
    if (prevVoicing && prevVoicing.length > 0) {
      const prevSet = new Set(prevVoicing);
      let commonTones = 0;
      for (const p of cand) {
        if (prevSet.has(p)) commonTones++;
      }

      let totalMotion = 0;
      let maxJump = 0;
      const len = Math.max(cand.length, prevVoicing.length);
      for (let i = 0; i < len; i++) {
        const a = cand[Math.min(i, cand.length - 1)];
        const b = prevVoicing[Math.min(i, prevVoicing.length - 1)];
        const d = Math.abs(a - b);
        totalMotion += d;
        if (d > maxJump) maxJump = d;
      }
      const avgMotion = totalMotion / len;
      score += avgMotion * 4.5 + Math.max(0, maxJump - 4) * 2.0 - commonTones * 1.8;
    } else {
      const center = (cand[0] + cand[cand.length - 1]) / 2;
      score += Math.abs(center - targetCenter) * 0.4;
    }

    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  // Final hard clamp below vocalRange.min if needed
  if (vocalRange && Number.isFinite(vocalRange.min)) {
    const hardCeil = Math.max(minMidi, Math.floor(vocalRange.min) - 1);
    const clamped = best.map((p) => {
      let x = p;
      while (x > hardCeil && x - 12 >= minMidi - 2) x -= 12;
      return clamp(x, minMidi - 2, hardCeil);
    });
    return Array.from(new Set(clamped)).sort((a, b) => a - b);
  }

  return best;
}

// ===========================================================================
// Bass Range Guard & Beat-4 Turnaround Generator
// ===========================================================================
export function resolveBassRootMidi(
  rootPc: number,
  prevMidi?: number | null
): number {
  const pc = ((rootPc % 12) + 12) % 12;
  // Standard 4-string bass E1(28)..G3(55): C1..Eb1 (24..27) fold up to C2..Eb2 (36..39)
  const candidates: number[] = [];
  for (let m = BASS_MIN_MIDI; m <= 43; m++) {
    if (m % 12 === pc) candidates.push(m);
  }
  if (candidates.length === 0) {
    return clamp(36 + pc, BASS_MIN_MIDI, BASS_MAX_MIDI);
  }
  if (prevMidi === undefined || prevMidi === null) {
    return candidates[0];
  }
  let best = candidates[0];
  let bestDist = Math.abs(best - prevMidi);
  for (const c of candidates) {
    const d = Math.abs(c - prevMidi);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return clamp(best, BASS_MIN_MIDI, BASS_MAX_MIDI);
}

export type BassTurnaroundStyle =
  | 'chromatic'
  | 'diatonic_whole'
  | 'octave_pickup';

export function buildBassTurnaroundBeat4(options: {
  barStartTick: number;
  currentRootMidi: number;
  nextRootMidi: number;
  key: KeyName;
  scale: ScaleType;
  style: BassTurnaroundStyle;
  velocity: number;
  channel: number;
  subdivision: SubdivisionMode;
}): MidiNote[] {
  const {
    barStartTick,
    currentRootMidi,
    nextRootMidi,
    key,
    scale,
    style,
    velocity,
    channel,
    subdivision,
  } = options;

  const scalePcs = new Set(getScalePitchClasses(key, scale));
  const beat4Start = barStartTick + 1440;
  const dir = nextRootMidi >= currentRootMidi ? 1 : -1;

  if (style === 'octave_pickup') {
    // 16th x 4 ascending octave pickup ending within <= 2 semitones of nextRootMidi
    const highApproach = clamp(
      nextRootMidi - dir * 2,
      BASS_MIN_MIDI,
      BASS_MAX_MIDI
    );
    const finalLead = clamp(
      nextRootMidi - dir * 1,
      BASS_MIN_MIDI,
      BASS_MAX_MIDI
    );
    const oct = clamp(
      currentRootMidi + 12 <= BASS_MAX_MIDI ? currentRootMidi + 12 : currentRootMidi + 7,
      BASS_MIN_MIDI,
      BASS_MAX_MIDI
    );
    const pitches = [currentRootMidi, oct, highApproach, finalLead];
    return pitches.map((pitch, idx) => {
      const startTick = mapTickToSubdivision(beat4Start + idx * 120, subdivision);
      const nextTick =
        idx + 1 < 4
          ? mapTickToSubdivision(beat4Start + (idx + 1) * 120, subdivision)
          : barStartTick + BAR_TICKS;
      return {
        pitch,
        velocity: clamp(velocity + (idx === 3 ? 4 : -2 + idx * 2), 1, 127),
        startTick,
        durationTicks: Math.max(40, nextTick - startTick - 10),
        channel,
      };
    });
  }

  if (style === 'chromatic') {
    // 8th x 2 chromatic approach ending 1 semitone away from nextRootMidi
    const step2 = clamp(nextRootMidi - dir, BASS_MIN_MIDI, BASS_MAX_MIDI);
    const step1 = clamp(step2 - dir, BASS_MIN_MIDI, BASS_MAX_MIDI);
    const t0 = mapTickToSubdivision(beat4Start, subdivision);
    const t1 = mapTickToSubdivision(beat4Start + 240, subdivision);
    return [
      {
        pitch: step1,
        velocity: clamp(velocity - 4, 1, 127),
        startTick: t0,
        durationTicks: Math.max(60, t1 - t0 - 10),
        channel,
      },
      {
        pitch: step2,
        velocity: clamp(velocity + 2, 1, 127),
        startTick: t1,
        durationTicks: Math.max(60, barStartTick + BAR_TICKS - t1 - 10),
        channel,
      },
    ];
  }

  // 'diatonic_whole': 8th x 2 diatonic step ending <= 2 semitones from nextRootMidi
  let lead = clamp(nextRootMidi - dir * 2, BASS_MIN_MIDI, BASS_MAX_MIDI);
  if (!scalePcs.has(lead % 12)) {
    const alt = clamp(nextRootMidi - dir, BASS_MIN_MIDI, BASS_MAX_MIDI);
    lead = alt;
  }
  const mid = clamp(
    Math.round((currentRootMidi + lead) / 2),
    BASS_MIN_MIDI,
    BASS_MAX_MIDI
  );
  const t0 = mapTickToSubdivision(beat4Start, subdivision);
  const t1 = mapTickToSubdivision(beat4Start + 240, subdivision);
  return [
    {
      pitch: mid,
      velocity: clamp(velocity - 4, 1, 127),
      startTick: t0,
      durationTicks: Math.max(60, t1 - t0 - 10),
      channel,
    },
    {
      pitch: lead,
      velocity: clamp(velocity + 2, 1, 127),
      startTick: t1,
      durationTicks: Math.max(60, barStartTick + BAR_TICKS - t1 - 10),
      channel,
    },
  ];
}

// ===========================================================================
// Vocal Rest Gap Detector (for Keyboard Take C obligato)
// ===========================================================================
export interface RestGap {
  readonly startTick: number;
  readonly endTick: number;
  readonly durationTicks: number;
}

export function findVocalRestGaps(
  vocalNotes: readonly MidiNote[] | undefined,
  sectionEndTick: number,
  minRestTicks = 480
): RestGap[] {
  if (!vocalNotes || vocalNotes.length === 0) return [];
  const sorted = [...vocalNotes].sort((a, b) => a.startTick - b.startTick);
  const gaps: RestGap[] = [];
  let cursor = 0;

  for (const n of sorted) {
    const s = Math.max(0, Math.round(n.startTick));
    const e = Math.min(sectionEndTick, s + Math.max(1, Math.round(n.durationTicks)));
    if (s - cursor >= minRestTicks) {
      gaps.push({ startTick: cursor, endTick: s, durationTicks: s - cursor });
    }
    if (e > cursor) cursor = e;
  }
  if (sectionEndTick - cursor >= minRestTicks) {
    gaps.push({
      startTick: cursor,
      endTick: sectionEndTick,
      durationTicks: sectionEndTick - cursor,
    });
  }
  return gaps;
}

// ===========================================================================
// SMF Sanitizers & Strict Event Ordering (NoteOff=0 -> CC/PB=1 -> NoteOn=2)
// ===========================================================================
export function sanitizeTrackNotes(
  notes: readonly MidiNote[],
  minGapTicks = 5,
  sectionEndTick?: number
): MidiNote[] {
  const cleaned = notes
    .filter((n) => Number.isFinite(n.pitch) && Number.isFinite(n.startTick))
    .map((n) => {
      const startTick = Math.max(0, Math.round(n.startTick));
      let durationTicks = Math.max(1, Math.round(n.durationTicks));
      if (sectionEndTick !== undefined && startTick + durationTicks > sectionEndTick) {
        durationTicks = Math.max(1, sectionEndTick - startTick);
      }
      return {
        ...n,
        pitch: clamp(Math.round(n.pitch), 0, 127),
        velocity: clamp(Math.round(n.velocity), 1, 127),
        startTick,
        durationTicks,
      };
    })
    .filter((n) => sectionEndTick === undefined || n.startTick < sectionEndTick)
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  // Trim same-(channel, pitch) overlaps with >= minGapTicks clearance
  const lastByKey = new Map<string, MidiNote>();
  const out: MidiNote[] = [];

  for (const note of cleaned) {
    const key = `${note.channel ?? 0}:${note.pitch}`;
    const prev = lastByKey.get(key);
    if (prev) {
      if (note.startTick === prev.startTick) {
        if (note.velocity > prev.velocity) {
          prev.velocity = note.velocity;
          prev.durationTicks = Math.max(prev.durationTicks, note.durationTicks);
        }
        continue;
      }
      const maxPrevEnd = note.startTick - minGapTicks;
      if (prev.startTick + prev.durationTicks > maxPrevEnd) {
        prev.durationTicks = Math.max(1, maxPrevEnd - prev.startTick);
      }
    }
    const copy = { ...note };
    out.push(copy);
    lastByKey.set(key, copy);
  }

  return out;
}

export function enforceMonophonic(
  notes: readonly MidiNote[],
  minGapTicks = 5,
  sectionEndTick?: number
): MidiNote[] {
  const sanitized = sanitizeTrackNotes(notes, minGapTicks, sectionEndTick);
  if (sanitized.length <= 1) return sanitized;

  const mono: MidiNote[] = [];
  for (const note of sanitized) {
    const prev = mono[mono.length - 1];
    if (prev) {
      if (note.startTick === prev.startTick) {
        if (note.velocity > prev.velocity) {
          mono[mono.length - 1] = { ...note };
        }
        continue;
      }
      const maxPrevEnd = note.startTick - minGapTicks;
      if (prev.startTick + prev.durationTicks > maxPrevEnd) {
        prev.durationTicks = Math.max(1, maxPrevEnd - prev.startTick);
      }
    }
    mono.push({ ...note });
  }
  return mono;
}

export interface OrderedSmfEvent {
  readonly tick: number;
  readonly priority: 0 | 1 | 2; // 0 = NoteOff, 1 = CC/PB, 2 = NoteOn
  readonly type: 'noteOff' | 'cc' | 'noteOn';
  readonly channel: number;
  readonly data1: number;
  readonly data2: number;
}

export function flattenToOrderedSmfEvents(
  notes: readonly MidiNote[],
  controlChanges: readonly MidiControlChangeEvent[] = [],
  defaultChannel = 0
): OrderedSmfEvent[] {
  const events: OrderedSmfEvent[] = [];

  for (const n of notes) {
    const ch = n.channel ?? defaultChannel;
    const start = Math.max(0, Math.round(n.startTick));
    const end = start + Math.max(1, Math.round(n.durationTicks));
    const pitch = clamp(Math.round(n.pitch), 0, 127);
    const vel = clamp(Math.round(n.velocity), 1, 127);
    events.push({
      tick: start,
      priority: 2,
      type: 'noteOn',
      channel: ch,
      data1: pitch,
      data2: vel,
    });
    events.push({
      tick: end,
      priority: 0,
      type: 'noteOff',
      channel: ch,
      data1: pitch,
      data2: 0,
    });
  }

  for (const cc of controlChanges) {
    events.push({
      tick: Math.max(0, Math.round(cc.tick)),
      priority: 1,
      type: 'cc',
      channel: cc.channel ?? defaultChannel,
      data1: clamp(Math.round(cc.controller), 0, 127),
      data2: clamp(Math.round(cc.value), 0, 127),
    });
  }

  return events.sort(
    (a, b) =>
      a.tick - b.tick ||
      a.priority - b.priority ||
      a.channel - b.channel ||
      a.data1 - b.data1
  );
}
