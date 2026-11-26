import {
  TICKS_PER_BAR,
  type AccompanimentTake,
  type ChordEvent,
  type KeyName,
  type MidiNote,
  type ScaleType,
  type Section,
  type SectionType,
} from '../types/song';
import { normalizeMasterGenreId, type MasterGenreId } from '../lib/masterGenres';
import { analyzeParsedChordToEvent } from './harmonyEngine';
import {
  buildChordWindows,
  clamp,
  computeVocalMinMidiByBar,
  resolveBassRootMidi,
  type ChordWindow,
} from './musicCore';

export type VoicingArchetype =
  | 'close'
  | 'drop2'
  | 'open_spread'
  | 'rootless_a'
  | 'rootless_b'
  | 'quartal'
  | 'power5'
  | 'shell_thinned';

export interface VoicingCandidate {
  readonly pitches: readonly number[];
  readonly archetype: VoicingArchetype;
  readonly unaryCost: number;
  readonly lilPenalty: number;
}

export const GUITAR_CHORUS_GENRES: ReadonlySet<MasterGenreId> = new Set([
  'alt_shoegaze',
  'emo_jrock',
  'numetal_mixture',
]);

export const GUITAR_HEADROOM_MIN_MIDI = 48; // C3
export const GUITAR_HEADROOM_MAX_MIDI = 60; // C4

/**
 * Evaluates absolute MIDI Low Interval Limits (SPN: C4 = 60, C3 = 48, E3 = 52, G2 = 43)
 * across (voicing ∪ { activeBassMidi }), plus minor-2nd muddiness and internal minor-9th (13st) clashes.
 */
export function computeBassIntegratedLilPenalty(
  voicing: readonly number[],
  activeBassMidi: number | null,
  chordEvent?: ChordEvent
): { totalPenalty: number; hasMinorSecond: boolean; hasMinorNinth: boolean } {
  const combined =
    activeBassMidi !== null && Number.isFinite(activeBassMidi)
      ? Array.from(new Set([Math.round(activeBassMidi), ...voicing])).sort(
          (a, b) => a - b
        )
      : [...voicing].sort((a, b) => a - b);

  let penalty = 0;
  let hasMinorSecond = false;
  let hasMinorNinth = false;

  const allowsFlatNine = Boolean(
    chordEvent &&
      chordEvent.availableTensionPcs.includes((chordEvent.rootPc + 1) % 12) &&
      (chordEvent.chordScale === 'altered' ||
        chordEvent.chordScale === 'half_whole_dim' ||
        chordEvent.chordScale === 'phrygian_dominant')
  );

  // Adjacent interval LIL checks on combined (bass + upper voices)
  for (let i = 0; i + 1 < combined.length; i++) {
    const low = combined[i];
    const high = combined[i + 1];
    const diff = high - low;

    if (diff === 1) {
      hasMinorSecond = true;
      penalty += i === 0 || low < 64 ? 85 : 48;
    } else if (diff === 2) {
      if (low < 53) {
        // Muddy major 2nd below F3 (53)
        penalty += 34;
      } else if (i === 0 && activeBassMidi === null && low < 56) {
        penalty += 14;
      }
    } else if (diff === 3 && low < 48) {
      // Minor 3rd below C3 (48)
      penalty += 28;
    } else if (diff === 4 && low < 46) {
      // Major 3rd below Bb2 (46)
      penalty += 26;
    } else if (diff === 5 && low < 43) {
      // Perfect 4th below G2 (43)
      penalty += 20;
    } else if (diff === 6 && low < 50) {
      // Tritone below D3 (50)
      penalty += 24;
    }
  }

  // Pairwise minor-2nd inside voicing & internal minor-9th (13 semitones) check
  for (let i = 0; i < voicing.length; i++) {
    for (let j = i + 1; j < voicing.length; j++) {
      const low = Math.min(voicing[i], voicing[j]);
      const high = Math.max(voicing[i], voicing[j]);
      const diff = high - low;
      if (diff === 1) {
        hasMinorSecond = true;
        penalty += 60;
      } else if (diff === 13 && !allowsFlatNine) {
        hasMinorNinth = true;
        penalty += 55;
      }
    }
  }

  // Also check minor 9th against bass if bass is in upper bass register (>= 40)
  if (activeBassMidi !== null && !allowsFlatNine) {
    for (const v of voicing) {
      if (v - activeBassMidi === 13) {
        hasMinorNinth = true;
        penalty += 45;
      }
    }
  }

  return { totalPenalty: penalty, hasMinorSecond, hasMinorNinth };
}

function buildCloseAscending(pcs: readonly number[], baseMidi: number): number[] {
  if (pcs.length === 0) return [];
  const out: number[] = [];
  let cursor = Math.floor(baseMidi / 12) * 12 + pcs[0];
  if (cursor < baseMidi) cursor += 12;
  out.push(cursor);
  for (let i = 1; i < pcs.length; i++) {
    let next = Math.floor(cursor / 12) * 12 + pcs[i];
    while (next <= cursor) next += 12;
    out.push(next);
    cursor = next;
  }
  return out;
}

function toDrop2(closeVoicing: readonly number[]): number[] {
  if (closeVoicing.length < 4) return [...closeVoicing];
  const sorted = [...closeVoicing].sort((a, b) => a - b);
  const idx = sorted.length - 2;
  const dropped = sorted[idx] - 12;
  const rest = sorted.filter((_, i) => i !== idx);
  rest.push(dropped);
  return rest.sort((a, b) => a - b);
}

function toOpenSpread(closeVoicing: readonly number[]): number[] {
  if (closeVoicing.length < 3) return [...closeVoicing];
  const sorted = [...closeVoicing].sort((a, b) => a - b);
  // Raise middle voice by an octave (1-5-3 / spread triad)
  const mid = sorted[1] + 12;
  const out = [sorted[0], ...sorted.slice(2), mid];
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function filterSlashBassDoubling(
  pcs: readonly number[],
  chordEvent: ChordEvent
): number[] {
  const isSlash = chordEvent.bassPc !== chordEvent.rootPc;
  if (!isSlash) return [...pcs];

  const leadingPc = (chordEvent.localKeyRootPc + 11) % 12;
  const bassIsSensitive =
    chordEvent.guideTonePcs.includes(chordEvent.bassPc) ||
    chordEvent.bassPc === leadingPc;

  if (!bassIsSensitive) return [...pcs];
  const filtered = pcs.filter((pc) => pc !== chordEvent.bassPc);
  return filtered.length >= 2 ? filtered : [...pcs];
}

function buildArchetypeCandidatesInBounds(options: {
  pcs: readonly number[];
  chordEvent: ChordEvent;
  genreId: MasterGenreId;
  part: 'keyboard' | 'pad';
  take: AccompanimentTake;
  minMidi: number;
  ceilingMidi: number;
  activeBassMidi: number | null;
  targetCenter: number;
  isThinnedShell: boolean;
}): VoicingCandidate[] {
  const {
    pcs,
    chordEvent,
    genreId,
    part,
    take,
    minMidi,
    ceilingMidi,
    activeBassMidi,
    targetCenter,
    isThinnedShell,
  } = options;

  const cleanPcs = filterSlashBassDoubling(
    Array.from(new Set(pcs.map((p) => ((p % 12) + 12) % 12))),
    chordEvent
  );
  if (cleanPcs.length === 0) return [];

  const rootPc = chordEvent.rootPc;
  const thirdPc = chordEvent.guideTonePcs[0] ?? (rootPc + 4) % 12;
  const seventhPc = chordEvent.guideTonePcs[1];
  const fifthPc =
    chordEvent.chordTonePcs.find(
      (pc) =>
        pc === (rootPc + 7) % 12 ||
        pc === (rootPc + 6) % 12 ||
        pc === (rootPc + 8) % 12
    ) ?? (rootPc + 7) % 12;
  const ninthPc = chordEvent.availableTensionPcs.find(
    (pc) => pc === (rootPc + 2) % 12
  );
  const thirteenthPc = chordEvent.availableTensionPcs.find(
    (pc) => pc === (rootPc + 9) % 12
  );

  const rawList: Array<{ pitches: number[]; archetype: VoicingArchetype }> = [];
  const lowSearch = Math.max(40, minMidi - 6);
  const highSearch = ceilingMidi;

  // 0. Strict Power Chord ("5" / "power") guard:
  // NEVER stack unwanted 3rds or jazz tensions on explicit power chords; emit clean power5 / open 5th-octave voicings.
  const isPowerChord =
    chordEvent.quality === '5' || chordEvent.quality === 'power';
  if (isPowerChord) {
    for (let oct = 3; oct <= 5; oct++) {
      const r = oct * 12 + rootPc;
      const f = r + ((fifthPc - rootPc + 12) % 12);
      if (r >= lowSearch && f <= highSearch) {
        rawList.push({ pitches: [r, f], archetype: 'power5' });
        if (r + 12 <= highSearch) {
          rawList.push({ pitches: [r, f, r + 12], archetype: 'power5' });
        }
        if (r + 12 <= highSearch) {
          rawList.push({ pitches: [r, r + 12], archetype: 'power5' });
        }
      }
      if (f >= lowSearch && r + 12 <= highSearch) {
        rawList.push({ pitches: [f, r + 12], archetype: 'power5' });
      }
    }
  } else {
    // 1. Inversions of Close, Drop-2, and Open/Spread
    for (let octBase = Math.floor(lowSearch / 12) * 12; octBase <= highSearch; octBase += 12) {
      for (let inv = 0; inv < cleanPcs.length; inv++) {
        const rot = [...cleanPcs.slice(inv), ...cleanPcs.slice(0, inv)];
        const close = buildCloseAscending(rot, octBase);
        if (close.length >= 2) {
          rawList.push({
            pitches: close,
            archetype: isThinnedShell ? 'shell_thinned' : 'close',
          });
          if (close.length >= 4) {
            rawList.push({ pitches: toDrop2(close), archetype: 'drop2' });
          }
          if (close.length >= 3) {
            rawList.push({ pitches: toOpenSpread(close), archetype: 'open_spread' });
          }
        }
      }
    }

    // 2. Rootless Type A (3-5-7-9) & Type B (7-9-3-13) — signature for chill_ballad / Take C
    if (!isThinnedShell && (genreId === 'chill_ballad' || take === 'C' || seventhPc !== undefined)) {
      const effSeventh =
        seventhPc ??
        (chordEvent.quality === 'minor' ? (rootPc + 10) % 12 : (rootPc + 11) % 12);
      const effNinth = ninthPc ?? (rootPc + 2) % 12;
      const effThirteenth = thirteenthPc ?? fifthPc;
      const typeAPcs = filterSlashBassDoubling(
        [thirdPc, fifthPc, effSeventh, effNinth].slice(0, part === 'pad' ? 3 : 4),
        chordEvent
      );
      const typeBPcs = filterSlashBassDoubling(
        [effSeventh, effNinth, thirdPc, effThirteenth].slice(0, part === 'pad' ? 3 : 4),
        chordEvent
      );
      for (let base = lowSearch; base <= highSearch - 7; base += 6) {
        const vA = buildCloseAscending(typeAPcs, base);
        const vB = buildCloseAscending(typeBPcs, base);
        if (vA.length >= 2) rawList.push({ pitches: vA, archetype: 'rootless_a' });
        if (vB.length >= 2) rawList.push({ pitches: vB, archetype: 'rootless_b' });
      }
    }

    // 3. Quartal Voicing (stacked 4ths / 5ths) — signature for alt_shoegaze
    if (!isThinnedShell && (genreId === 'alt_shoegaze' || part === 'pad')) {
      const scaleSet = new Set(chordEvent.scalePcs);
      for (let base = Math.max(48, lowSearch); base <= highSearch - 10; base++) {
        if (!cleanPcs.includes(base % 12)) continue;
        const p2 = base + 5;
        const p3 = base + 10;
        const p3Alt = base + 12;
        if (
          p3 <= highSearch &&
          scaleSet.has(p2 % 12) &&
          scaleSet.has(p3 % 12) &&
          !chordEvent.avoidPcs.includes(p2 % 12) &&
          !chordEvent.avoidPcs.includes(p3 % 12)
        ) {
          rawList.push({ pitches: [base, p2, p3], archetype: 'quartal' });
        }
        if (p3Alt <= highSearch && scaleSet.has((base + 7) % 12)) {
          rawList.push({ pitches: [base, base + 7, p3Alt], archetype: 'quartal' });
        }
      }
    }

    // 4. Power5 Voicing (root-5th / root-5th-octave) — signature for numetal_mixture
    if (!isThinnedShell && genreId === 'numetal_mixture') {
      for (let oct = 3; oct <= 5; oct++) {
        const r = oct * 12 + rootPc;
        const f = r + ((fifthPc - rootPc + 12) % 12);
        if (r >= lowSearch && f <= highSearch) {
          rawList.push({ pitches: [r, f], archetype: 'power5' });
          if (r + 12 <= highSearch) {
            rawList.push({ pitches: [r, f, r + 12], archetype: 'power5' });
          }
        }
      }
    }
  }

  // Filter strictly inside [lowSearch, ceilingMidi] and score unary cost
  const seen = new Set<string>();
  const valid: VoicingCandidate[] = [];
  const isSlash = chordEvent.bassPc !== chordEvent.rootPc;

  for (const item of rawList) {
    const sorted = Array.from(new Set(item.pitches)).sort((a, b) => a - b);
    if (sorted.length < 2) continue;
    if (sorted[0] < lowSearch || sorted[sorted.length - 1] > ceilingMidi) continue;
    // Thinned shells must NEVER contain any 1-semitone or 2-semitone cluster
    if (isThinnedShell) {
      let tightCluster = false;
      for (let i = 0; i + 1 < sorted.length; i++) {
        if (sorted[i + 1] - sorted[i] <= 2) {
          tightCluster = true;
          break;
        }
      }
      if (tightCluster) continue;
    }

    const key = sorted.join(',');
    if (seen.has(key)) continue;
    seen.add(key);

    const lil = computeBassIntegratedLilPenalty(sorted, activeBassMidi, chordEvent);
    if (lil.hasMinorSecond) continue; // Zero minor-2nd tolerance in accompaniment voicings

    let unary = lil.totalPenalty;

    // Range floor softness penalty if below minMidi
    for (const p of sorted) {
      if (p < minMidi) unary += (minMidi - p) * 3.5;
    }

    // Slash chord redundant bass-note penalty
    if (isSlash && sorted.some((p) => p % 12 === chordEvent.bassPc)) {
      unary += 18;
    }

    // Register drift gravity: lambda * (meanPitch - targetCenter)^2
    const meanPitch = sorted.reduce((s, p) => s + p, 0) / sorted.length;
    const diffCenter = meanPitch - targetCenter;
    unary += 0.12 * diffCenter * diffCenter;

    // Genre archetype preference
    if (
      genreId === 'chill_ballad' &&
      (item.archetype === 'rootless_a' || item.archetype === 'rootless_b')
    ) {
      unary -= 4.0;
    } else if (genreId === 'alt_shoegaze' && item.archetype === 'quartal') {
      unary -= 3.5;
    } else if (genreId === 'numetal_mixture' && item.archetype === 'power5') {
      unary -= 3.5;
    } else if (part === 'pad' && (item.archetype === 'drop2' || item.archetype === 'open_spread' || item.archetype === 'quartal')) {
      unary -= 2.5;
    }

    // Guide-tone coverage bonus
    const hasGuide = sorted.some((p) => chordEvent.guideTonePcs.includes(p % 12));
    if (hasGuide && genreId !== 'numetal_mixture') {
      unary -= 2.0;
    }

    valid.push({
      pitches: sorted,
      archetype: item.archetype,
      unaryCost: unary,
      lilPenalty: lil.totalPenalty,
    });
  }

  valid.sort(
    (a, b) =>
      a.unaryCost - b.unaryCost ||
      a.pitches[0] - b.pitches[0] ||
      a.pitches[a.pitches.length - 1] - b.pitches[b.pitches.length - 1]
  );

  return valid.slice(0, 32);
}

/**
 * Generates candidate voicings for a ChordEvent, applying automatic tension thinning
 * in strict order (5th -> 13th -> 9th) when a low vocal ceiling compresses the range.
 */
export function generateChordEventVoicingCandidates(options: {
  chordEvent: ChordEvent;
  genreId: MasterGenreId;
  part: 'keyboard' | 'pad';
  take: AccompanimentTake;
  minMidi: number;
  ceilingMidi: number;
  activeBassMidi: number | null;
}): VoicingCandidate[] {
  const {
    chordEvent,
    genreId,
    part,
    take,
    minMidi,
    ceilingMidi,
    activeBassMidi,
  } = options;

  const effectiveMin = Math.min(minMidi, ceilingMidi - 9);
  const targetCenter = clamp(
    (effectiveMin + ceilingMidi) / 2,
    effectiveMin + 3,
    ceilingMidi - 2
  );

  // Build initial pitch-class set according to genre & take
  const basePcs: number[] = [...chordEvent.chordTonePcs];
  if (take === 'C' || genreId === 'chill_ballad' || (part === 'pad' && take === 'B')) {
    for (const tPc of chordEvent.availableTensionPcs) {
      if (basePcs.length >= 5) break;
      if (!basePcs.includes(tPc)) basePcs.push(tPc);
    }
  }
  const desiredVoices =
    part === 'pad'
      ? take === 'A'
        ? 3
        : 4
      : take === 'C' || genreId === 'chill_ballad'
        ? 4
        : 3;

  const initialCands = buildArchetypeCandidatesInBounds({
    pcs: basePcs.slice(0, desiredVoices),
    chordEvent,
    genreId,
    part,
    take,
    minMidi: effectiveMin,
    ceilingMidi,
    activeBassMidi,
    targetCenter,
    isThinnedShell: false,
  });

  // Check if best candidate is mud-free (lilPenalty < 20)
  const bestLil =
    initialCands.length > 0
      ? Math.min(...initialCands.map((c) => c.lilPenalty))
      : Infinity;

  if (initialCands.length > 0 && bestLil < 20) {
    return initialCands;
  }

  // Automatic Tension-Thinning Fallback in strict order: 5th -> 13th -> 9th
  const rootPc = chordEvent.rootPc;
  const fifthPc = (rootPc + 7) % 12;
  const thirteenthPcs = new Set([(rootPc + 9) % 12, (rootPc + 8) % 12]);
  const ninthPcs = new Set([(rootPc + 2) % 12, (rootPc + 1) % 12, (rootPc + 3) % 12]);

  const thinningStages: Array<number[]> = [];
  // Stage 1: omit perfect 5th
  const no5th = basePcs.filter((pc) => pc !== fifthPc);
  if (no5th.length >= 2) thinningStages.push(no5th);
  // Stage 2: omit 5th + 13th
  const no13th = no5th.filter((pc) => !thirteenthPcs.has(pc));
  if (no13th.length >= 2) thinningStages.push(no13th);
  // Stage 3: omit 5th + 13th + 9th -> pure 2-3 note guide-tone / root-3rd shell
  const pureShell = no13th.filter((pc) => !ninthPcs.has(pc));
  const shellFallback =
    pureShell.length >= 2
      ? pureShell.slice(0, 3)
      : [
          chordEvent.guideTonePcs[0] ?? (rootPc + 4) % 12,
          chordEvent.guideTonePcs[1] ?? rootPc,
        ];
  thinningStages.push(shellFallback);

  for (const stagePcs of thinningStages) {
    const stageCands = buildArchetypeCandidatesInBounds({
      pcs: stagePcs.slice(0, 3),
      chordEvent,
      genreId,
      part,
      take,
      minMidi: Math.max(45, effectiveMin - 3),
      ceilingMidi,
      activeBassMidi,
      targetCenter,
      isThinnedShell: true,
    });
    if (stageCands.length > 0 && stageCands[0].lilPenalty < 20) {
      return stageCands;
    }
    if (stageCands.length > 0 && initialCands.length === 0) {
      return stageCands;
    }
  }

  if (initialCands.length > 0) return initialCands;

  // Ultimate clean 2-voice open shell <= ceilingMidi with >= 4st spacing (zero minor-2nd)
  const thirdPc = chordEvent.guideTonePcs[0] ?? (rootPc + 4) % 12;
  let top = Math.floor(ceilingMidi / 12) * 12 + thirdPc;
  while (top > ceilingMidi) top -= 12;
  let bottom = Math.floor((top - 4) / 12) * 12 + rootPc;
  while (top - bottom < 3) bottom -= 12;
  const safePair = [Math.max(36, bottom), Math.max(40, top)].sort((a, b) => a - b);
  return [
    {
      pitches: safePair,
      archetype: 'shell_thinned',
      unaryCost: 10,
      lilPenalty: 0,
    },
  ];
}

function computeVoiceLeadingTransitionCost(
  prev: readonly number[],
  curr: readonly number[],
  prevEvent: ChordEvent,
  currEvent: ChordEvent
): number {
  if (prev.length === 0 || curr.length === 0) return 0;

  // Variable-cardinality minimal voice-pair L1 distance
  let sumForward = 0;
  for (const c of curr) {
    let best = Infinity;
    for (const p of prev) {
      const d = Math.abs(c - p);
      if (d < best) best = d;
    }
    sumForward += best;
  }
  let sumBackward = 0;
  for (const p of prev) {
    let best = Infinity;
    for (const c of curr) {
      const d = Math.abs(c - p);
      if (d < best) best = d;
    }
    sumBackward += best;
  }
  const avgPairL1 = 0.5 * (sumForward / curr.length + sumBackward / prev.length);

  // Common-tone retention bonus
  const prevSet = new Set(prev);
  let commonCount = 0;
  for (const c of curr) {
    if (prevSet.has(c)) commonCount++;
  }

  // Top-voice smoothness
  const topJump = Math.abs(curr[curr.length - 1] - prev[prev.length - 1]);

  // Guide-tone (3rd / 7th) resolution smoothness
  const currTargetPcs = new Set([
    ...currEvent.chordTonePcs,
    ...currEvent.guideTonePcs,
  ]);
  let guideCost = 0;
  for (const gPc of prevEvent.guideTonePcs) {
    const prevGuideNote = prev.find((p) => p % 12 === gPc);
    if (prevGuideNote === undefined) continue;
    let bestStep = 12;
    for (const c of curr) {
      if (currTargetPcs.has(c % 12)) {
        bestStep = Math.min(bestStep, Math.abs(c - prevGuideNote));
      }
    }
    if (bestStep <= 2) {
      guideCost -= 1.6;
    } else {
      guideCost += (bestStep - 2) * 2.2;
    }
  }

  return avgPairL1 * 3.4 + topJump * 0.9 - commonCount * 2.2 + guideCost;
}

export interface SolveSectionVoicingsOptions {
  readonly section: Section;
  readonly key: KeyName;
  readonly scale: ScaleType;
  readonly chordWindows?: readonly ChordWindow[];
  readonly chordEvents?: readonly ChordEvent[];
  readonly bassNotes?: readonly MidiNote[];
  readonly vocalNotes?: readonly MidiNote[];
  readonly vocalMinMidiByBar?: ReadonlyArray<number | null>;
  readonly genreId: MasterGenreId | string;
  readonly part: 'keyboard' | 'pad';
  readonly take: AccompanimentTake;
  readonly minMidi: number;
  readonly maxMidi: number;
}

/**
 * Optimizes voicings across all chord windows in a section via exact Viterbi DP.
 */
export function solveSectionVoicingsViterbi(
  options: SolveSectionVoicingsOptions
): number[][] {
  const {
    section,
    key,
    scale,
    bassNotes,
    vocalNotes,
    genreId: rawGenre,
    part,
    take,
    minMidi,
    maxMidi,
  } = options;

  const genreId = normalizeMasterGenreId(rawGenre);
  const windows =
    options.chordWindows ?? buildChordWindows(section, key, scale);
  if (windows.length === 0) return [];

  // Align or build ChordEvent per window
  const events: ChordEvent[] = windows.map((w) => {
    const matched = options.chordEvents?.find(
      (ev) => Math.abs(ev.startTick - w.startTick) <= 30
    );
    if (matched) return matched;
    return analyzeParsedChordToEvent({
      parsed: w.parsed,
      startTick: w.startTick,
      durationTicks: Math.max(120, w.endTick - w.startTick),
      key,
      scale,
    });
  });

  const vocalMinByBar =
    options.vocalMinMidiByBar ??
    computeVocalMinMidiByBar(vocalNotes, section.bars);

  const nonNullVocalMins = vocalMinByBar.filter(
    (v): v is number => v !== null && Number.isFinite(v)
  );
  const sectionVocalMin =
    nonNullVocalMins.length > 0 ? Math.min(...nonNullVocalMins) : null;

  // Build candidate sets per window
  const candidateLayers: VoicingCandidate[][] = windows.map((w, idx) => {
    const ev = events[idx];

    // Active bass pitch during this window (from bassNotes or canonical bass root)
    let activeBassMidi: number | null = null;
    if (bassNotes && bassNotes.length > 0) {
      const overlappingBass = bassNotes.filter(
        (bn) => bn.startTick < w.endTick && bn.startTick + bn.durationTicks > w.startTick
      );
      if (overlappingBass.length > 0) {
        activeBassMidi = Math.min(...overlappingBass.map((b) => b.pitch));
      }
    }
    if (activeBassMidi === null) {
      activeBassMidi = resolveBassRootMidi(ev.bassPc);
    }

    // Per-bar vocal ceiling clamp: min(maxMidi, vocalMinMidi[bar] - 2)
    let ceilingMidi = maxMidi;
    if (part === 'keyboard') {
      const startBar = Math.max(0, Math.floor(w.startTick / TICKS_PER_BAR));
      const endBar = Math.min(
        Math.max(0, section.bars - 1),
        Math.floor(Math.max(w.startTick, w.endTick - 1) / TICKS_PER_BAR)
      );
      let winVocalMin: number | null = null;
      for (let b = startBar; b <= endBar; b++) {
        const vm = vocalMinByBar[b] ?? null;
        if (vm !== null) {
          winVocalMin = winVocalMin === null ? vm : Math.min(winVocalMin, vm);
        }
      }
      if (winVocalMin !== null) {
        ceilingMidi = Math.min(ceilingMidi, Math.floor(winVocalMin) - 2);
      } else if (sectionVocalMin !== null && sectionVocalMin >= 68) {
        // Keep rest bars gently below high vocal floor so keyboard doesn't jump above vocal
        ceilingMidi = Math.min(ceilingMidi, Math.floor(sectionVocalMin) - 1);
      }
      ceilingMidi = Math.max(46, ceilingMidi);
    }

    // In guitar-driven Chorus, cap PAD voices to 2..3 for mix clarity
    const effectiveTake: AccompanimentTake =
      part === 'pad' &&
      section.type === 'Chorus' &&
      GUITAR_CHORUS_GENRES.has(genreId) &&
      take === 'C'
        ? 'A'
        : take;

    return generateChordEventVoicingCandidates({
      chordEvent: ev,
      genreId,
      part,
      take: effectiveTake,
      minMidi,
      ceilingMidi,
      activeBassMidi,
    });
  });

  // Viterbi DP forward pass
  const T = candidateLayers.length;
  const dpCost: number[][] = candidateLayers.map((layer) =>
    new Array<number>(layer.length).fill(Infinity)
  );
  const dpBack: number[][] = candidateLayers.map((layer) =>
    new Array<number>(layer.length).fill(0)
  );

  for (let j = 0; j < candidateLayers[0].length; j++) {
    dpCost[0][j] = candidateLayers[0][j].unaryCost;
  }

  for (let t = 1; t < T; t++) {
    const prevLayer = candidateLayers[t - 1];
    const currLayer = candidateLayers[t];
    for (let j = 0; j < currLayer.length; j++) {
      let bestPrevCost = Infinity;
      let bestPrevIdx = 0;
      for (let i = 0; i < prevLayer.length; i++) {
        const trans = computeVoiceLeadingTransitionCost(
          prevLayer[i].pitches,
          currLayer[j].pitches,
          events[t - 1],
          events[t]
        );
        const candCost = dpCost[t - 1][i] + trans + currLayer[j].unaryCost;
        if (candCost < bestPrevCost) {
          bestPrevCost = candCost;
          bestPrevIdx = i;
        }
      }
      dpCost[t][j] = bestPrevCost;
      dpBack[t][j] = bestPrevIdx;
    }
  }

  // Backtrack minimum-cost path
  let bestLastIdx = 0;
  let bestLastCost = Infinity;
  const lastCosts = dpCost[T - 1];
  for (let j = 0; j < lastCosts.length; j++) {
    if (lastCosts[j] < bestLastCost) {
      bestLastCost = lastCosts[j];
      bestLastIdx = j;
    }
  }

  const chosenIndices = new Array<number>(T);
  chosenIndices[T - 1] = bestLastIdx;
  for (let t = T - 1; t >= 1; t--) {
    chosenIndices[t - 1] = dpBack[t][chosenIndices[t]];
  }

  return chosenIndices.map((cIdx, t) => [...candidateLayers[t][cIdx].pitches]);
}

/**
 * Guitar Live-Recording Headroom Reservation (MIDI 48..60 / C3..C4):
 * In Chorus sections of guitar-driven genres (alt_shoegaze, emo_jrock, numetal_mixture),
 * limits simultaneous Keyboard or PAD notes inside 48..60 to at most 2 notes and
 * gently attenuates velocity in that band so live guitars sit cleanly in the mix.
 */
export function applyChorusGuitarHeadroom(
  notes: readonly MidiNote[],
  sectionType: SectionType,
  rawGenreId: MasterGenreId | string | undefined
): MidiNote[] {
  const genreId = normalizeMasterGenreId(rawGenreId);
  if (sectionType !== 'Chorus' || !GUITAR_CHORUS_GENRES.has(genreId)) {
    return [...notes];
  }
  if (notes.length === 0) return [];

  // Group notes by approximate onset bucket (20-tick window)
  const sorted = [...notes].sort(
    (a, b) => a.startTick - b.startTick || a.pitch - b.pitch
  );
  const clusters: MidiNote[][] = [];
  for (const n of sorted) {
    const lastCluster = clusters[clusters.length - 1];
    if (
      lastCluster &&
      Math.abs(n.startTick - lastCluster[0].startTick) <= 20
    ) {
      lastCluster.push({ ...n });
    } else {
      clusters.push([{ ...n }]);
    }
  }

  const out: MidiNote[] = [];
  for (const cluster of clusters) {
    const inGuitarBand = cluster.filter(
      (n) =>
        n.pitch >= GUITAR_HEADROOM_MIN_MIDI &&
        n.pitch <= GUITAR_HEADROOM_MAX_MIDI
    );
    const outsideBand = cluster.filter(
      (n) =>
        n.pitch < GUITAR_HEADROOM_MIN_MIDI ||
        n.pitch > GUITAR_HEADROOM_MAX_MIDI
    );

    let keptInBand = inGuitarBand;
    if (inGuitarBand.length > 2) {
      // Keep lowest & highest in band (max 2 notes), dropping dense middle voices
      keptInBand = [
        inGuitarBand[0],
        inGuitarBand[inGuitarBand.length - 1],
      ];
    }

    for (const n of keptInBand) {
      out.push({
        ...n,
        velocity: clamp(n.velocity - 10, 42, 127),
      });
    }
    for (const n of outsideBand) {
      out.push(n);
    }
  }

  return out.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
}
