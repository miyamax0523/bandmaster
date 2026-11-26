import {
  PPQ,
  TICKS_PER_BAR,
  type KeyName,
  type MidiNote,
  type QuantizeGrid,
  type ScaleType,
} from '../types/song';
import { semitoneToKeyName, snapPitchToScale } from './chordUtils';

export interface RawRiffNote {
  pitch: number;
  startTick: number;
  durationTicks: number;
  velocity?: number;
  amplitude?: number;
}

export interface ProcessRiffOptions {
  bpm: number;
  bars: number; // 1..4
  offsetMs?: number; // -200..+200
  grid?: QuantizeGrid | 'auto';
}

export interface ProcessRiffResult {
  cleanedBassNotes: MidiNote[];
  accentTicks: number[];
  resolvedGrid: QuantizeGrid;
}

export function detectQuantizeGrid(
  notes: readonly { startTick: number }[]
): QuantizeGrid {
  if (notes.length <= 1) {
    return 'straight16';
  }
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick);
  let err16 = 0;
  let errTriplet = 0;
  let ioiCount = 0;

  for (let i = 1; i < sorted.length; i++) {
    const ioi = sorted[i].startTick - sorted[i - 1].startTick;
    if (ioi <= 0) continue;
    ioiCount++;
    const rem16 = ioi % 120;
    err16 += Math.min(rem16, 120 - rem16);
    const remTrip = ioi % 160;
    errTriplet += Math.min(remTrip, 160 - remTrip);
  }

  if (ioiCount === 0) {
    return 'straight16';
  }
  return errTriplet < err16 ? 'triplet8' : 'straight16';
}

export function extractAccentTicks(
  cleanedBassNotes: readonly MidiNote[],
  bars: number
): number[] {
  const riffEnd = Math.max(1, bars) * TICKS_PER_BAR;
  const set = new Set<number>();
  for (const n of cleanedBassNotes) {
    if (n.startTick >= 0 && n.startTick < riffEnd) {
      set.add(n.startTick);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Riff processing pipeline — strictly ordered Steps 0..6:
 * 0. amplitude->velocity, noise gate, guitar range filter (MIDI 36..88)
 * 1. Onset head trim (once in note domain)
 * 2. offsetMs tick conversion & shift
 * 3. Single grid quantization (straight16=120 / triplet8=160; <=1 note defaults to straight16)
 * 4. Bottom-note monophonization
 * 5. -12 semitone shift & range fold (repeat -12 while > 55; target MIDI 24..55)
 * 6. Remove startTick >= riffEnd & clip durationTicks
 */
export function processGuitarRiff(
  rawNotes: readonly RawRiffNote[],
  options: ProcessRiffOptions
): ProcessRiffResult {
  const bars = Math.min(4, Math.max(1, Math.round(options.bars)));
  const riffEnd = bars * TICKS_PER_BAR;
  const offsetMs = Math.min(200, Math.max(-200, options.offsetMs ?? 0));

  if (rawNotes.length === 0) {
    return {
      cleanedBassNotes: [],
      accentTicks: [],
      resolvedGrid: options.grid === 'triplet8' ? 'triplet8' : 'straight16',
    };
  }

  // Step 0: amplitude -> velocity, noise gate, guitar range filter (36..88)
  const converted = rawNotes.map((n) => {
    const vel =
      n.amplitude !== undefined
        ? Math.min(127, Math.max(1, Math.round(n.amplitude * 127)))
        : Math.min(127, Math.max(1, Math.round(n.velocity ?? 100)));
    return {
      pitch: Math.round(n.pitch),
      startTick: Math.round(n.startTick),
      durationTicks: Math.round(n.durationTicks),
      velocity: vel,
    };
  });

  const maxVel = converted.reduce((m, n) => Math.max(m, n.velocity), 0);
  const velThreshold = Math.max(20, Math.round(maxVel * 0.15));

  const step0 = converted.filter(
    (n) =>
      n.velocity >= velThreshold &&
      n.durationTicks >= 30 &&
      n.pitch >= 36 &&
      n.pitch <= 88
  );

  if (step0.length === 0) {
    return {
      cleanedBassNotes: [],
      accentTicks: [],
      resolvedGrid: options.grid === 'triplet8' ? 'triplet8' : 'straight16',
    };
  }

  // Step 1: Onset head trim (once in note domain)
  const minStart = step0.reduce((m, n) => Math.min(m, n.startTick), Infinity);
  const step1 = step0.map((n) => ({
    ...n,
    startTick: Math.max(0, n.startTick - minStart),
  }));

  // Step 2: offsetMs shift
  const safeBpm = Math.max(1, options.bpm);
  const offsetTicks = Math.round((offsetMs / 1000) * (safeBpm / 60) * PPQ);
  const step2 = step1.map((n) => ({
    ...n,
    startTick: Math.max(0, n.startTick + offsetTicks),
  }));

  // Step 3: Single grid quantization
  const resolvedGrid: QuantizeGrid =
    options.grid === undefined || options.grid === 'auto'
      ? detectQuantizeGrid(step2)
      : options.grid;
  const gridTicks = resolvedGrid === 'triplet8' ? 160 : 120;

  const step3 = step2.map((n) => ({
    ...n,
    startTick: Math.round(n.startTick / gridTicks) * gridTicks,
    durationTicks: Math.max(
      gridTicks,
      Math.round(n.durationTicks / gridTicks) * gridTicks
    ),
  }));

  // Step 4: Bottom-note monophonization
  const lowestAtTick = new Map<number, (typeof step3)[number]>();
  for (const n of step3) {
    const existing = lowestAtTick.get(n.startTick);
    if (!existing || n.pitch < existing.pitch) {
      lowestAtTick.set(n.startTick, { ...n });
    }
  }

  const step4 = Array.from(lowestAtTick.values()).sort(
    (a, b) => a.startTick - b.startTick
  );
  for (let i = 0; i < step4.length - 1; i++) {
    const gap = step4[i + 1].startTick - step4[i].startTick;
    step4[i].durationTicks = Math.max(1, Math.min(step4[i].durationTicks, gap));
  }

  // Step 5: -12 semitone shift & range fold (repeat -12 while > 55; target 24..55)
  const step5 = step4.map((n) => {
    let p = n.pitch - 12;
    while (p > 55) {
      p -= 12;
    }
    while (p < 24) {
      p += 12;
    }
    return {
      ...n,
      pitch: p,
    };
  });

  // Step 6: Remove startTick >= riffEnd & clip durationTicks
  const step6: MidiNote[] = step5
    .filter((n) => n.startTick >= 0 && n.startTick < riffEnd)
    .map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: Math.max(
        1,
        Math.min(n.durationTicks, riffEnd - n.startTick)
      ),
      channel: 0,
    }));

  return {
    cleanedBassNotes: step6,
    accentTicks: extractAccentTicks(step6, bars),
    resolvedGrid,
  };
}

export interface ProcessVocalOptions {
  bpm: number;
  bars: number; // 1..4
  offsetMs?: number; // -200..+200
  grid?: QuantizeGrid | 'auto';
  key: KeyName;
  scale: ScaleType;
  snapToScale?: boolean;
  minPitch?: number;
  maxPitch?: number;
}

export interface ProcessVocalResult {
  cleanedVocalNotes: MidiNote[];
  resolvedGrid: QuantizeGrid;
}

/**
 * Vocal melody processing pipeline for recorded/uploaded audio or imported MIDI:
 * Filters vocal pitch range, trims head onset, applies offsetMs & grid quantize,
 * enforces top-note monophony, folds into MIDI 48..76 (C3..E5), and optionally snaps to Key/Scale.
 */
export function processVocalMelody(
  rawNotes: readonly RawRiffNote[],
  options: ProcessVocalOptions
): ProcessVocalResult {
  const bars = Math.min(4, Math.max(1, Math.round(options.bars)));
  const maxEnd = bars * TICKS_PER_BAR;
  const offsetMs = Math.min(200, Math.max(-200, options.offsetMs ?? 0));
  const minPitch = options.minPitch ?? 48;
  const maxPitch = options.maxPitch ?? 76;

  if (rawNotes.length === 0) {
    return {
      cleanedVocalNotes: [],
      resolvedGrid: options.grid === 'triplet8' ? 'triplet8' : 'straight16',
    };
  }

  const converted = rawNotes.map((n) => {
    const vel =
      n.amplitude !== undefined
        ? Math.min(127, Math.max(1, Math.round(n.amplitude * 127)))
        : Math.min(127, Math.max(1, Math.round(n.velocity ?? 100)));
    return {
      pitch: Math.round(n.pitch),
      startTick: Math.round(n.startTick),
      durationTicks: Math.round(n.durationTicks),
      velocity: vel,
    };
  });

  const maxVel = converted.reduce((m, n) => Math.max(m, n.velocity), 0);
  const velThreshold = Math.max(18, Math.round(maxVel * 0.15));

  const gated = converted.filter(
    (n) =>
      n.velocity >= velThreshold &&
      n.durationTicks >= 30 &&
      n.pitch >= 36 &&
      n.pitch <= 96
  );

  if (gated.length === 0) {
    return {
      cleanedVocalNotes: [],
      resolvedGrid: options.grid === 'triplet8' ? 'triplet8' : 'straight16',
    };
  }

  const minStart = gated.reduce((m, n) => Math.min(m, n.startTick), Infinity);
  const trimmed = gated.map((n) => ({
    ...n,
    startTick: Math.max(0, n.startTick - minStart),
  }));

  const safeBpm = Math.max(1, options.bpm);
  const offsetTicks = Math.round((offsetMs / 1000) * (safeBpm / 60) * PPQ);
  const shifted = trimmed.map((n) => ({
    ...n,
    startTick: Math.max(0, n.startTick + offsetTicks),
  }));

  const resolvedGrid: QuantizeGrid =
    options.grid === undefined || options.grid === 'auto'
      ? detectQuantizeGrid(shifted)
      : options.grid;
  const gridTicks = resolvedGrid === 'triplet8' ? 160 : 120;

  const quantized = shifted.map((n) => ({
    ...n,
    startTick: Math.round(n.startTick / gridTicks) * gridTicks,
    durationTicks: Math.max(
      gridTicks,
      Math.round(n.durationTicks / gridTicks) * gridTicks
    ),
  }));

  // Top-note monophonization for lead melody
  const highestAtTick = new Map<number, (typeof quantized)[number]>();
  for (const n of quantized) {
    const existing = highestAtTick.get(n.startTick);
    if (!existing || n.pitch > existing.pitch) {
      highestAtTick.set(n.startTick, { ...n });
    }
  }

  const mono = Array.from(highestAtTick.values()).sort(
    (a, b) => a.startTick - b.startTick
  );
  for (let i = 0; i < mono.length - 1; i++) {
    const gap = mono[i + 1].startTick - mono[i].startTick;
    mono[i].durationTicks = Math.max(1, Math.min(mono[i].durationTicks, gap));
  }

  const folded = mono.map((n) => {
    let p = n.pitch;
    while (p > maxPitch) p -= 12;
    while (p < minPitch) p += 12;
    p = Math.min(maxPitch, Math.max(minPitch, p));
    if (options.snapToScale) {
      p = snapPitchToScale(p, options.key, options.scale, minPitch, maxPitch);
    }
    return {
      ...n,
      pitch: p,
    };
  });

  const cleanedVocalNotes: MidiNote[] = folded
    .filter((n) => n.startTick >= 0 && n.startTick < maxEnd)
    .map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: Math.max(1, Math.min(n.durationTicks, maxEnd - n.startTick)),
      channel: 4,
    }));

  return {
    cleanedVocalNotes,
    resolvedGrid,
  };
}

export interface NormalizeOverrideBassOptions {
  shiftOctaveDown?: boolean; // default true: guitar E2(40).. -> bass E1(28)..G3(55)
  minDurationTicks?: number; // default 60: filter out ultra-short ghost noise
}

/**
 * Normalizes Basic Pitch / imported MIDI notes for Bass MIDI Override mode:
 * - Removes ghost noise shorter than minDurationTicks (default 60t)
 * - Optionally shifts guitar register down by 1 octave (-12) and folds into E1(28)..G3(55)
 * - Enforces strict bottom-note monophony (>= 5t clearance)
 * - Loops to cover sectionBars if shorter, clips to sectionEnd
 */
export function normalizeOverrideBassNotes(
  rawNotes: readonly RawRiffNote[] | readonly MidiNote[],
  sectionBars: number,
  options?: NormalizeOverrideBassOptions
): MidiNote[] {
  const totalBars = Math.max(1, Math.round(sectionBars));
  const sectionEnd = totalBars * TICKS_PER_BAR;
  const shiftOctaveDown = options?.shiftOctaveDown ?? true;
  const minDur = options?.minDurationTicks ?? 60;

  if (!rawNotes || rawNotes.length === 0) return [];

  const filtered = rawNotes
    .map((n) => {
      const vel =
        'amplitude' in n && n.amplitude !== undefined
          ? Math.min(127, Math.max(1, Math.round(n.amplitude * 127)))
          : Math.min(127, Math.max(1, Math.round(n.velocity ?? 100)));
      return {
        pitch: Math.round(n.pitch),
        startTick: Math.max(0, Math.round(n.startTick)),
        durationTicks: Math.round(n.durationTicks),
        velocity: vel,
      };
    })
    .filter((n) => n.durationTicks >= minDur && n.startTick < sectionEnd);

  if (filtered.length === 0) return [];

  // Determine source clip span in whole bars (for clean looping when clip < sectionBars)
  const maxEnd = filtered.reduce(
    (m, n) => Math.max(m, n.startTick + n.durationTicks),
    0
  );
  const clipBars = Math.max(1, Math.min(totalBars, Math.ceil(maxEnd / TICKS_PER_BAR)));
  const clipLen = clipBars * TICKS_PER_BAR;

  // Bottom-note monophonization within source clip
  const lowestAtTick = new Map<number, (typeof filtered)[number]>();
  for (const n of filtered) {
    const existing = lowestAtTick.get(n.startTick);
    if (!existing || n.pitch < existing.pitch) {
      lowestAtTick.set(n.startTick, { ...n });
    }
  }
  const monoClip = Array.from(lowestAtTick.values()).sort(
    (a, b) => a.startTick - b.startTick
  );

  // Pitch normalization to E1(28)..G3(55)
  const pitchedClip = monoClip.map((n) => {
    let p = n.pitch;
    if (shiftOctaveDown && p >= 40) {
      p -= 12;
    }
    while (p > 55) p -= 12;
    while (p < 28) p += 12;
    return {
      ...n,
      pitch: Math.min(55, Math.max(28, p)),
    };
  });

  // Expand/loop across sectionEnd
  const expanded: MidiNote[] = [];
  for (let base = 0; base < sectionEnd; base += clipLen) {
    for (const n of pitchedClip) {
      const st = base + n.startTick;
      if (st >= sectionEnd) continue;
      const dur = Math.max(1, Math.min(n.durationTicks, sectionEnd - st));
      expanded.push({
        pitch: n.pitch,
        velocity: n.velocity,
        startTick: st,
        durationTicks: dur,
        channel: 0,
      });
    }
  }

  expanded.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  // Final strict monophony pass with >= 5-tick clearance
  const out: MidiNote[] = [];
  for (const note of expanded) {
    const prev = out[out.length - 1];
    if (prev) {
      if (prev.startTick === note.startTick) {
        if (note.pitch < prev.pitch) {
          out[out.length - 1] = { ...note };
        }
        continue;
      }
      const maxEndPrev = note.startTick - 5;
      if (prev.startTick + prev.durationTicks > maxEndPrev) {
        prev.durationTicks = Math.max(1, maxEndPrev - prev.startTick);
      }
    }
    out.push({ ...note });
  }
  return out;
}

/**
 * Infers a provisional bar-by-bar power-chord progression (e.g. "E5 | F5 | G5 | E5")
 * from the dominant root notes (weighted by duration & strong beat) of overrideBassNotes.
 */
export function inferPowerChordProgressionFromBassNotes(
  notes: readonly MidiNote[],
  sectionBars: number
): string {
  const totalBars = Math.max(1, Math.round(sectionBars));
  if (!notes || notes.length === 0) return '';

  const barChords: string[] = [];
  let lastChord: string | null = null;

  for (let b = 0; b < totalBars; b++) {
    const barStart = b * TICKS_PER_BAR;
    const barEnd = barStart + TICKS_PER_BAR;
    const scores = new Map<number, number>();

    for (const n of notes) {
      const ovStart = Math.max(barStart, n.startTick);
      const ovEnd = Math.min(barEnd, n.startTick + n.durationTicks);
      if (ovEnd <= ovStart) continue;
      const ovDur = ovEnd - ovStart;
      const rel = n.startTick - barStart;
      const beatWeight =
        rel >= 0 && rel < 120
          ? 1.9
          : rel >= 960 && rel < 1080
            ? 1.35
            : rel >= 0 && rel % 480 < 60
              ? 1.15
              : 1.0;
      const pc = ((n.pitch % 12) + 12) % 12;
      scores.set(pc, (scores.get(pc) ?? 0) + ovDur * beatWeight);
    }

    if (scores.size === 0) {
      barChords.push(lastChord ? '%' : 'E5');
      continue;
    }

    let bestPc = 0;
    let bestScore = -1;
    for (const [pc, sc] of scores.entries()) {
      if (sc > bestScore) {
        bestScore = sc;
        bestPc = pc;
      }
    }
    const chord = `${semitoneToKeyName(bestPc)}5`;
    barChords.push(chord);
    lastChord = chord;
  }

  return barChords.join(' | ');
}
