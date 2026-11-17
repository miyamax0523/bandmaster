import {
  PPQ,
  TICKS_PER_BAR,
  type MidiNote,
  type QuantizeGrid,
} from '../types/song';

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
