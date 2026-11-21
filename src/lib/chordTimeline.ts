import {
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  type ChordSlot,
  type KeyName,
  type ScaleType,
} from '../types/song';
import {
  getDefaultProgression,
  parseChord,
  transposeChord,
  type ParsedChord,
} from './chordUtils';

let slotIdCounter = 0;

export function createChordSlotId(prefix = 'cs'): string {
  slotIdCounter += 1;
  return `${prefix}-${slotIdCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function cloneChordSlots(slots: readonly ChordSlot[]): ChordSlot[] {
  return slots.map((s) => ({
    ...s,
    anticipated: s.anticipated ?? s.startBeat % 1 !== 0,
  }));
}

function snapHalfBeat(beats: number): number {
  return Math.round(beats * 2) / 2;
}

/**
 * Converts a plain chord string array into a uniform timeline spanning `bars * 4` beats.
 * Uses 4 beats (1 bar) as the base unit per chord by looping progressions whose length
 * is shorter than `bars`, instead of stretching chords across 8+ beats by default.
 * Returns [] if `chordNames` is explicitly empty (signaling diatonic auto fallback).
 */
export function createUniformChordTimeline(
  chordNames: readonly string[],
  bars: number
): ChordSlot[] {
  const safeBars = Math.max(1, Math.round(bars));
  const totalBeats = safeBars * 4;
  if (chordNames.length === 0) {
    return [];
  }

  const expandedNames =
    chordNames.length < safeBars
      ? Array.from({ length: safeBars }, (_, i) => chordNames[i % chordNames.length])
      : chordNames;

  const count = Math.min(expandedNames.length, Math.max(1, totalBeats * 2));
  const slots: ChordSlot[] = [];
  let cursor = 0;

  for (let i = 0; i < count; i++) {
    const remainingSlots = count - i;
    const minNeededAfter = (remainingSlots - 1) * 0.5;
    let endBeat: number;
    if (i === count - 1) {
      endBeat = totalBeats;
    } else {
      const idealEnd = snapHalfBeat(((i + 1) * totalBeats) / count);
      endBeat = Math.max(
        cursor + 0.5,
        Math.min(totalBeats - minNeededAfter, idealEnd)
      );
    }
    const dur = Math.max(0.5, snapHalfBeat(endBeat - cursor));
    slots.push({
      id: createChordSlotId('slot'),
      chord: expandedNames[i],
      startBeat: cursor,
      durationBeats: dur,
      anticipated: cursor % 1 !== 0,
    });
    cursor = snapHalfBeat(cursor + dur);
  }

  return slots;
}

/**
 * Normalizes legacy string[] / chordProgression / ChordSlot[] into independent ChordSlot[].
 */
export function normalizeSectionChords(
  rawChords: unknown,
  bars: number,
  legacyChordProgression?: string | string[]
): ChordSlot[] {
  if (Array.isArray(rawChords)) {
    if (rawChords.length === 0) {
      return [];
    }
    if (typeof rawChords[0] === 'string') {
      const names = (rawChords as string[]).map((c) => c.trim()).filter(Boolean);
      return createUniformChordTimeline(names, bars);
    }
    if (typeof rawChords[0] === 'object' && rawChords[0] !== null) {
      const safeBars = Math.max(1, Math.round(bars));
      const totalBeats = safeBars * 4;
      const cloned: ChordSlot[] = [];
      let expectedBeat = 0;
      for (const item of rawChords as Partial<ChordSlot>[]) {
        const startBeat = snapHalfBeat(
          typeof item.startBeat === 'number' && !Number.isNaN(item.startBeat)
            ? Math.max(0, item.startBeat)
            : expectedBeat
        );
        const durationBeats = Math.max(
          0.5,
          snapHalfBeat(
            typeof item.durationBeats === 'number' && !Number.isNaN(item.durationBeats)
              ? item.durationBeats
              : 4
          )
        );
        cloned.push({
          id: typeof item.id === 'string' && item.id ? item.id : createChordSlotId('slot'),
          chord: typeof item.chord === 'string' && item.chord.trim() ? item.chord.trim() : 'Em',
          startBeat,
          durationBeats,
          anticipated: item.anticipated ?? startBeat % 1 !== 0,
        });
        expectedBeat = Math.min(totalBeats, snapHalfBeat(startBeat + durationBeats));
      }
      return cloned;
    }
  }

  if (Array.isArray(legacyChordProgression)) {
    const names = legacyChordProgression.map((c) => String(c).trim()).filter(Boolean);
    return createUniformChordTimeline(names, bars);
  }
  if (typeof legacyChordProgression === 'string') {
    const names = legacyChordProgression
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    return createUniformChordTimeline(names, bars);
  }

  return [];
}

/**
 * Resolves a section's effective ChordSlot timeline (expanding empty arrays via diatonic default).
 */
export function resolveEffectiveTimeline(
  chords: readonly ChordSlot[] | readonly string[] | undefined,
  bars: number,
  key: KeyName,
  scale: ScaleType
): ChordSlot[] {
  const normalized = normalizeSectionChords(chords, bars);
  if (normalized.length > 0) {
    return normalized;
  }
  return createUniformChordTimeline(getDefaultProgression(key, scale), bars);
}

export interface ActiveChordAtTick {
  slot: ChordSlot;
  slotIndex: number;
  parsed: ParsedChord;
  changeTick: number;
  endTick: number;
}

/**
 * Returns the active ChordSlot and parsed chord for any tick position in a section.
 * Accepts ChordSlot[] (primary) or legacy string[] gracefully.
 */
export function getActiveChordAtTick(
  chords: readonly ChordSlot[] | readonly string[] | undefined,
  tick: number,
  key: KeyName,
  scale: ScaleType,
  bars = 4
): ActiveChordAtTick {
  const effective = resolveEffectiveTimeline(chords, bars, key, scale);
  const lastSlot = effective[effective.length - 1];
  const timelineTotalTicks = Math.max(
    TICKS_PER_BEAT,
    Math.round((lastSlot.startBeat + lastSlot.durationBeats) * TICKS_PER_BEAT)
  );
  const sectionTotalTicks = Math.max(TICKS_PER_BAR, Math.round(bars) * TICKS_PER_BAR);
  const periodTicks = Math.max(timelineTotalTicks, 1);
  const clampedTick = Math.max(0, Math.round(tick));
  const localTick =
    clampedTick >= timelineTotalTicks && timelineTotalTicks < sectionTotalTicks
      ? clampedTick % periodTicks
      : Math.min(clampedTick, periodTicks - 1);

  for (let i = 0; i < effective.length; i++) {
    const slot = effective[i];
    const changeTick = Math.round(slot.startBeat * TICKS_PER_BEAT);
    const endTick = Math.round((slot.startBeat + slot.durationBeats) * TICKS_PER_BEAT);
    if (localTick >= changeTick && localTick < endTick) {
      let parsed: ParsedChord;
      try {
        parsed = parseChord(slot.chord);
      } catch {
        parsed = parseChord(getDefaultProgression(key, scale)[0]);
      }
      return {
        slot,
        slotIndex: i,
        parsed,
        changeTick,
        endTick,
      };
    }
  }

  let parsedFallback: ParsedChord;
  try {
    parsedFallback = parseChord(lastSlot.chord);
  } catch {
    parsedFallback = parseChord(getDefaultProgression(key, scale)[0]);
  }
  return {
    slot: lastSlot,
    slotIndex: effective.length - 1,
    parsed: parsedFallback,
    changeTick: Math.round(lastSlot.startBeat * TICKS_PER_BEAT),
    endTick: timelineTotalTicks,
  };
}

export interface TimelineBoundaryChange {
  slotIndex: number;
  slot: ChordSlot;
  changeTick: number;
  endTick: number;
  parsed: ParsedChord;
  isOffbeat: boolean;
}

/**
 * Returns every internal chord change boundary (slotIndex >= 1) in a section,
 * flagging offbeat anticipations (`slot.anticipated || startBeat % 1 !== 0`).
 */
export function getTimelineBoundaryChanges(
  chords: readonly ChordSlot[] | readonly string[] | undefined,
  bars: number,
  key: KeyName,
  scale: ScaleType
): TimelineBoundaryChange[] {
  const effective = resolveEffectiveTimeline(chords, bars, key, scale);
  const sectionEnd = Math.max(1, Math.round(bars)) * TICKS_PER_BAR;
  const changes: TimelineBoundaryChange[] = [];

  for (let i = 1; i < effective.length; i++) {
    const slot = effective[i];
    const changeTick = Math.round(slot.startBeat * TICKS_PER_BEAT);
    if (changeTick <= 0 || changeTick >= sectionEnd) continue;
    const endTick = Math.min(
      sectionEnd,
      Math.round((slot.startBeat + slot.durationBeats) * TICKS_PER_BEAT)
    );
    let parsed: ParsedChord;
    try {
      parsed = parseChord(slot.chord);
    } catch {
      parsed = parseChord(getDefaultProgression(key, scale)[0]);
    }
    changes.push({
      slotIndex: i,
      slot,
      changeTick,
      endTick,
      parsed,
      isOffbeat: Boolean(slot.anticipated || slot.startBeat % 1 !== 0),
    });
  }

  return changes;
}

/**
 * Shifts the starting boundary of `slots[targetIndex]` (`targetIndex >= 1`) by `deltaBeats`
 * (e.g. -0.5 or +0.5), clamping both adjacent slots to >= 0.5 beats and updating `anticipated`.
 */
export function shiftChordBoundary(
  slots: readonly ChordSlot[],
  targetIndex: number,
  deltaBeats: number
): ChordSlot[] {
  const next = cloneChordSlots(slots);
  if (targetIndex < 1 || targetIndex >= next.length) {
    return next;
  }

  const prev = next[targetIndex - 1];
  const target = next[targetIndex];
  const quantizedDelta = snapHalfBeat(deltaBeats);
  if (quantizedDelta === 0) return next;

  const minDelta = -(prev.durationBeats - 0.5);
  const maxDelta = target.durationBeats - 0.5;
  const clampedDelta = Math.max(minDelta, Math.min(maxDelta, quantizedDelta));
  if (clampedDelta === 0) return next;

  prev.durationBeats = snapHalfBeat(prev.durationBeats + clampedDelta);
  target.startBeat = snapHalfBeat(target.startBeat + clampedDelta);
  target.durationBeats = snapHalfBeat(target.durationBeats - clampedDelta);
  target.anticipated = target.startBeat % 1 !== 0;

  return next;
}

/**
 * Splits `slots[targetIndex]` (`durationBeats >= 1.0`) into two 0.5-beat aligned blocks.
 * E.g. 4 -> 2 + 2, 3 -> 2 + 1, 1.5 -> 1.0 + 0.5, 1.0 -> 0.5 + 0.5.
 */
export function splitChordSlot(
  slots: readonly ChordSlot[],
  targetIndex: number
): ChordSlot[] {
  const next = cloneChordSlots(slots);
  if (targetIndex < 0 || targetIndex >= next.length) {
    return next;
  }
  const slot = next[targetIndex];
  if (slot.durationBeats < 1.0) {
    return next;
  }

  const firstDur =
    slot.durationBeats >= 2
      ? Math.ceil(slot.durationBeats / 2)
      : Math.max(0.5, snapHalfBeat(slot.durationBeats - 0.5));
  const secondDur = snapHalfBeat(slot.durationBeats - firstDur);
  if (firstDur < 0.5 || secondDur < 0.5) {
    return next;
  }

  const secondStart = snapHalfBeat(slot.startBeat + firstDur);
  const firstSlot: ChordSlot = {
    ...slot,
    durationBeats: firstDur,
  };
  const secondSlot: ChordSlot = {
    id: createChordSlotId('slot'),
    chord: slot.chord,
    startBeat: secondStart,
    durationBeats: secondDur,
    anticipated: secondStart % 1 !== 0,
  };

  next.splice(targetIndex, 1, firstSlot, secondSlot);
  return next;
}

/**
 * Merges `slots[targetIndex]` (`targetIndex >= 1`) into `slots[targetIndex - 1]`.
 */
export function mergeChordWithPrev(
  slots: readonly ChordSlot[],
  targetIndex: number
): ChordSlot[] {
  const next = cloneChordSlots(slots);
  if (targetIndex < 1 || targetIndex >= next.length) {
    return next;
  }

  const prev = next[targetIndex - 1];
  const target = next[targetIndex];
  prev.durationBeats = snapHalfBeat(prev.durationBeats + target.durationBeats);
  next.splice(targetIndex, 1);
  return next;
}

/**
 * Updates only the chord symbol at `targetIndex` while keeping timing intact.
 */
export function updateChordName(
  slots: readonly ChordSlot[],
  targetIndex: number,
  newChord: string
): ChordSlot[] {
  const next = cloneChordSlots(slots);
  if (targetIndex < 0 || targetIndex >= next.length) {
    return next;
  }
  const trimmed = newChord.trim();
  if (!trimmed) return next;
  next[targetIndex] = {
    ...next[targetIndex],
    chord: trimmed,
  };
  return next;
}

function recalculateTimelinePositions(slots: ChordSlot[]): ChordSlot[] {
  let cursor = 0;
  return slots.map((slot) => {
    const startBeat = snapHalfBeat(cursor);
    const durationBeats = Math.max(0.5, snapHalfBeat(slot.durationBeats));
    cursor = snapHalfBeat(startBeat + durationBeats);
    return {
      ...slot,
      startBeat,
      durationBeats,
      anticipated: startBeat % 1 !== 0,
    };
  });
}

/**
 * Sets `slots[targetIndex]`'s start beat (`targetIndex >= 1`) directly to a 0.5-beat aligned position,
 * clamping adjacent slots to >= 0.5 beats and updating `anticipated`.
 */
export function setChordBoundaryBeat(
  slots: readonly ChordSlot[],
  targetIndex: number,
  newStartBeat: number
): ChordSlot[] {
  if (targetIndex < 1 || targetIndex >= slots.length) {
    return cloneChordSlots(slots);
  }
  const snapped = snapHalfBeat(newStartBeat);
  const deltaBeats = snapHalfBeat(snapped - slots[targetIndex].startBeat);
  return shiftChordBoundary(slots, targetIndex, deltaBeats);
}

/**
 * Inserts a new chord block immediately after `slots[targetIndex]` without changing total beats.
 * Splits 2.0 beats off when `durationBeats >= 3.0`, or flexibly borrows 0.5..1.0 beats from neighbors.
 */
export function insertChordAfter(
  slots: readonly ChordSlot[],
  targetIndex: number,
  defaultChord?: string
): ChordSlot[] {
  const next = cloneChordSlots(slots);
  if (next.length === 0) return next;
  const safeIdx = Math.max(0, Math.min(next.length - 1, targetIndex));
  const target = next[safeIdx];
  const chordName = (defaultChord ?? target.chord).trim() || target.chord;

  let newDuration = 0;
  if (target.durationBeats >= 3.0) {
    target.durationBeats = snapHalfBeat(target.durationBeats - 2.0);
    newDuration = 2.0;
  } else {
    const desired = 1.0;
    if (target.durationBeats >= 1.5) {
      target.durationBeats = snapHalfBeat(target.durationBeats - 1.0);
      newDuration = 1.0;
    } else if (target.durationBeats >= 1.0) {
      target.durationBeats = snapHalfBeat(target.durationBeats - 0.5);
      newDuration += 0.5;
    }

    // Borrow remaining beats (up to 1.0 total) from adjacent slots, then wider donors
    const candidateIndices: number[] = [];
    if (safeIdx + 1 < next.length) candidateIndices.push(safeIdx + 1);
    if (safeIdx - 1 >= 0) candidateIndices.push(safeIdx - 1);
    for (let i = 0; i < next.length; i++) {
      if (i !== safeIdx && !candidateIndices.includes(i)) {
        candidateIndices.push(i);
      }
    }

    for (const donorIdx of candidateIndices) {
      if (newDuration >= desired) break;
      const donor = next[donorIdx];
      const available = snapHalfBeat(donor.durationBeats - 0.5);
      if (available >= 0.5) {
        const take = Math.min(available, snapHalfBeat(desired - newDuration));
        donor.durationBeats = snapHalfBeat(donor.durationBeats - take);
        newDuration = snapHalfBeat(newDuration + take);
      }
    }
  }

  if (newDuration < 0.5) {
    return cloneChordSlots(slots);
  }

  const insertedSlot: ChordSlot = {
    id: createChordSlotId('slot'),
    chord: chordName,
    startBeat: 0,
    durationBeats: newDuration,
    anticipated: false,
  };
  next.splice(safeIdx + 1, 0, insertedSlot);
  return recalculateTimelinePositions(next);
}

/**
 * Removes `slots[targetIndex]` and merges its duration into the preceding slot
 * (or following slot if `targetIndex === 0`). Disabled when only 1 slot remains.
 */
export function removeChordSlot(
  slots: readonly ChordSlot[],
  targetIndex: number
): ChordSlot[] {
  if (slots.length <= 1 || targetIndex < 0 || targetIndex >= slots.length) {
    return cloneChordSlots(slots);
  }
  const next = cloneChordSlots(slots);
  const [removed] = next.splice(targetIndex, 1);
  const absorbIdx = targetIndex > 0 ? targetIndex - 1 : 0;
  next[absorbIdx].durationBeats = snapHalfBeat(
    next[absorbIdx].durationBeats + removed.durationBeats
  );
  return recalculateTimelinePositions(next);
}

/**
 * Swaps the chord name at `targetIndex` with its neighbor (`-1` or `1`).
 */
export function swapChordOrder(
  slots: readonly ChordSlot[],
  targetIndex: number,
  direction: -1 | 1
): ChordSlot[] {
  const next = cloneChordSlots(slots);
  const neighborIdx = targetIndex + direction;
  if (
    targetIndex < 0 ||
    targetIndex >= next.length ||
    neighborIdx < 0 ||
    neighborIdx >= next.length
  ) {
    return next;
  }
  const tempChord = next[targetIndex].chord;
  next[targetIndex] = { ...next[targetIndex], chord: next[neighborIdx].chord };
  next[neighborIdx] = { ...next[neighborIdx], chord: tempChord };
  return next;
}

/**
 * Proportionally or end-adjusted resizes timeline slots so their total equals `newBars * 4` beats,
 * keeping every kept slot >= 0.5 beats cleanly aligned to 0.5-beat grid.
 */
export function resizeTimelineToBars(
  slots: readonly ChordSlot[],
  newBars: number
): ChordSlot[] {
  if (slots.length === 0) return [];
  const targetTotalBeats = Math.max(1, Math.round(newBars)) * 4;
  const oldTotalBeats = slots.reduce((sum, s) => sum + s.durationBeats, 0);
  if (oldTotalBeats <= 0) {
    return createUniformChordTimeline(
      slots.map((s) => s.chord),
      newBars
    );
  }
  if (Math.abs(oldTotalBeats - targetTotalBeats) < 0.001) {
    return cloneChordSlots(slots);
  }

  const maxSlots = Math.floor(targetTotalBeats / 0.5);
  const working = cloneChordSlots(slots).slice(0, maxSlots);
  const scaleRatio = targetTotalBeats / oldTotalBeats;

  const resized: ChordSlot[] = [];
  let cursor = 0;

  for (let i = 0; i < working.length; i++) {
    const remainingAfter = (working.length - 1 - i) * 0.5;
    let dur: number;
    if (i === working.length - 1) {
      dur = Math.max(0.5, snapHalfBeat(targetTotalBeats - cursor));
    } else {
      const scaled = snapHalfBeat(working[i].durationBeats * scaleRatio);
      dur = Math.max(0.5, Math.min(targetTotalBeats - cursor - remainingAfter, scaled));
    }
    resized.push({
      ...working[i],
      startBeat: cursor,
      durationBeats: dur,
      anticipated: cursor % 1 !== 0,
    });
    cursor = snapHalfBeat(cursor + dur);
  }

  return resized;
}

export function transposeChordTimeline(
  slots: readonly ChordSlot[],
  semitones: number
): ChordSlot[] {
  return slots.map((slot) => ({
    ...slot,
    chord: transposeChord(slot.chord, semitones),
  }));
}

export function formatSlotPositionLabel(slot: ChordSlot): string {
  const barNum = Math.floor(slot.startBeat / 4) + 1;
  const beatInBar = slot.startBeat % 4;
  const beatNum = Math.floor(beatInBar) + 1;
  const isHalf = beatInBar % 1 !== 0;
  return `${barNum}小節目 ${beatNum}拍目${isHalf ? '裏' : '表'}〜 / ${slot.durationBeats.toFixed(1)}拍`;
}

export function formatSlotShortPosition(slot: ChordSlot): string {
  const barNum = Math.floor(slot.startBeat / 4) + 1;
  const beatInBar = slot.startBeat % 4;
  const beatNum = Math.floor(beatInBar) + 1;
  const isHalf = beatInBar % 1 !== 0;
  return `${barNum}小節 ${beatNum}拍目${isHalf ? '裏' : ''}〜`;
}

export type ChordRhythmModeId =
  | 'even'
  | 'anticipate_4th'
  | 'half_bar_drive'
  | 'stretch_and_push'
  | 'custom';

export type ChordRhythmGrooveMode =
  | 'even'
  | 'anticipate_4th'
  | 'half_bar_drive'
  | 'stretch_and_push'
  | 'syncopated_mix'
  | 'random';

export interface ChordRhythmDescription {
  modeId: ChordRhythmModeId;
  label: string;
  badgeIcon: string;
  slotPositionLabels: string[];
}

export function describeChordRhythm(
  slots: readonly ChordSlot[],
  totalBars: number
): ChordRhythmDescription {
  const slotPositionLabels = slots.map(formatSlotShortPosition);
  if (slots.length <= 1) {
    return {
      modeId: 'even',
      label: '均等割り',
      badgeIcon: '📏',
      slotPositionLabels,
    };
  }

  const safeBars = Math.max(1, Math.round(totalBars));
  const totalBeats = safeBars * 4;
  const avgDur = totalBeats / slots.length;
  const hasOffbeat = slots.some(
    (s, idx) => idx > 0 && (Boolean(s.anticipated) || s.startBeat % 1 !== 0)
  );
  const minDur = Math.min(...slots.map((s) => s.durationBeats));
  const maxDur = Math.max(...slots.map((s) => s.durationBeats));

  // All 2-beat slots or front-loaded 2-beat driving on integer beats -> half_bar_drive
  const allOnBeat = !hasOffbeat && slots.every((s) => s.startBeat % 1 === 0);
  const twoBeatSlots = slots.filter((s) => s.durationBeats <= 2.0).length;
  if (allOnBeat) {
    const isUniform = maxDur - minDur <= 1.0 && Math.abs(slots[0].durationBeats - avgDur) <= 1.0;
    if (
      (slots.every((s) => Math.abs(s.durationBeats - 2) < 0.01) && slots.length >= safeBars * 2) ||
      (!isUniform && twoBeatSlots >= Math.ceil(slots.length / 2))
    ) {
      return {
        modeId: 'half_bar_drive',
        label: '2拍ずつ疾走',
        badgeIcon: '🚀',
        slotPositionLabels,
      };
    }
    if (isUniform) {
      return {
        modeId: 'even',
        label: '均等割り',
        badgeIcon: '📏',
        slotPositionLabels,
      };
    }
    return {
      modeId: 'custom',
      label: 'カスタム譜割り',
      badgeIcon: '🎛',
      slotPositionLabels,
    };
  }

  // Long stretch (>= avgDur + 1) followed by offbeat push -> stretch_and_push
  if (hasOffbeat && slots[0].durationBeats > avgDur && maxDur - minDur >= 1.5) {
    return {
      modeId: 'stretch_and_push',
      label: '溜め＆裏食い',
      badgeIcon: '🌊',
      slotPositionLabels,
    };
  }

  // All interior boundaries sit cleanly on 4th beat half-beat anticipation (.5 before barlines)
  const offbeatSlots = slots.filter((_, idx) => idx > 0 && slots[idx].startBeat % 1 !== 0);
  const allFourthOffbeat =
    offbeatSlots.length > 0 &&
    offbeatSlots.length === slots.length - 1 &&
    offbeatSlots.every((s) => s.startBeat % 4 === 3.5);
  if (allFourthOffbeat || (offbeatSlots.length > 0 && maxDur - minDur <= 1.0 && offbeatSlots.every((s) => s.startBeat % 4 === 3.5))) {
    return {
      modeId: 'anticipate_4th',
      label: '4拍目裏食い',
      badgeIcon: '⚡',
      slotPositionLabels,
    };
  }

  return {
    modeId: 'custom',
    label: 'カスタム譜割り',
    badgeIcon: '🎛',
    slotPositionLabels,
  };
}

function finalizeSlotsFromDurations(
  chordNames: readonly string[],
  rawDurations: readonly number[],
  totalBeats: number
): ChordSlot[] {
  const count = chordNames.length;
  if (count === 0) return [];
  if (count === 1) {
    return [
      {
        id: createChordSlotId('slot'),
        chord: chordNames[0],
        startBeat: 0,
        durationBeats: totalBeats,
        anticipated: false,
      },
    ];
  }

  const durations = rawDurations.map((d) => Math.max(0.5, snapHalfBeat(d)));
  let diff = snapHalfBeat(totalBeats - durations.reduce((a, b) => a + b, 0));

  // Distribute residual delta safely onto the longest adjustable slot(s) keeping >= 0.5
  let guard = 0;
  while (Math.abs(diff) >= 0.5 && guard < 128) {
    guard++;
    if (diff > 0) {
      let maxIdx = durations.length - 1;
      for (let i = 0; i < durations.length; i++) {
        if (durations[i] > durations[maxIdx]) maxIdx = i;
      }
      durations[maxIdx] = snapHalfBeat(durations[maxIdx] + 0.5);
      diff = snapHalfBeat(diff - 0.5);
    } else {
      let trimIdx = -1;
      for (let i = durations.length - 1; i >= 0; i--) {
        if (durations[i] - 0.5 >= 0.5 && (trimIdx === -1 || durations[i] > durations[trimIdx])) {
          trimIdx = i;
        }
      }
      if (trimIdx === -1) break;
      durations[trimIdx] = snapHalfBeat(durations[trimIdx] - 0.5);
      diff = snapHalfBeat(diff + 0.5);
    }
  }

  const result: ChordSlot[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const dur =
      i === count - 1
        ? Math.max(0.5, snapHalfBeat(totalBeats - cursor))
        : Math.max(0.5, durations[i]);
    result.push({
      id: createChordSlotId('slot'),
      chord: chordNames[i],
      startBeat: cursor,
      durationBeats: dur,
      anticipated: cursor % 1 !== 0,
    });
    cursor = snapHalfBeat(cursor + dur);
  }
  return result;
}

export function applyChordRhythmGroove(
  slots: readonly ChordSlot[],
  totalBars: number,
  grooveMode: ChordRhythmGrooveMode,
  seed?: number
): ChordSlot[] {
  if (slots.length === 0) return [];
  const safeBars = Math.max(1, Math.round(totalBars));
  const totalBeats = safeBars * 4;
  const chordNames = slots.map((s) => s.chord);
  const count = chordNames.length;

  if (count === 1) {
    return finalizeSlotsFromDurations(chordNames, [totalBeats], totalBeats);
  }

  const buildForMode = (mode: Exclude<ChordRhythmGrooveMode, 'random'>): ChordSlot[] => {
    if (mode === 'even') {
      return createUniformChordTimeline(chordNames, safeBars);
    }

    if (mode === 'anticipate_4th') {
      const uniform = createUniformChordTimeline(chordNames, safeBars);
      const shifted = uniform.map((s) => ({ ...s }));
      for (let i = 1; i < shifted.length; i++) {
        if (shifted[i - 1].durationBeats >= 1.0 && shifted[i].startBeat % 1 === 0) {
          shifted[i - 1].durationBeats = snapHalfBeat(shifted[i - 1].durationBeats - 0.5);
          shifted[i].startBeat = snapHalfBeat(shifted[i].startBeat - 0.5);
          shifted[i].durationBeats = snapHalfBeat(shifted[i].durationBeats + 0.5);
          shifted[i].anticipated = shifted[i].startBeat % 1 !== 0;
        }
      }
      return shifted;
    }

    if (mode === 'half_bar_drive') {
      const durations: number[] = [];
      if (count * 2 <= totalBeats) {
        let remaining = totalBeats;
        for (let i = 0; i < count; i++) {
          const slotsLeft = count - i;
          if (i % 2 === 0 && remaining - (slotsLeft - 1) * 0.5 >= 2.0) {
            durations.push(2.0);
            remaining = snapHalfBeat(remaining - 2.0);
          } else {
            const pairTarget =
              slotsLeft === 1
                ? remaining
                : Math.max(2.0, Math.floor((remaining / slotsLeft) * 1.3));
            const clamped = Math.min(remaining - (slotsLeft - 1) * 0.5, pairTarget);
            const intDur = Math.max(1.0, Math.floor(clamped));
            durations.push(intDur);
            remaining = snapHalfBeat(remaining - intDur);
          }
        }
        return finalizeSlotsFromDurations(chordNames, durations, totalBeats);
      }
      return createUniformChordTimeline(chordNames, safeBars);
    }

    if (mode === 'stretch_and_push') {
      const durations: number[] = [];
      const pairCount = Math.ceil(count / 2);
      const basePairSpan = totalBeats / pairCount;
      let cursor = 0;
      for (let i = 0; i < count; i++) {
        if (i === count - 1) {
          durations.push(snapHalfBeat(totalBeats - cursor));
          break;
        }
        const slotsLeft = count - i;
        const maxSafe = snapHalfBeat(totalBeats - cursor - (slotsLeft - 1) * 0.5);
        if (i % 2 === 0 && maxSafe >= 3.0) {
          const span = Math.min(maxSafe, snapHalfBeat(basePairSpan));
          let longDur = snapHalfBeat(Math.max(1.5, span * 0.68));
          if (longDur % 1 === 0 && longDur + 0.5 <= maxSafe) {
            longDur = snapHalfBeat(longDur + 0.5);
          } else if (longDur % 1 === 0 && longDur - 0.5 >= 1.5) {
            longDur = snapHalfBeat(longDur - 0.5);
          }
          longDur = Math.min(maxSafe, longDur);
          durations.push(longDur);
          cursor = snapHalfBeat(cursor + longDur);
        } else {
          const shortDur = Math.min(maxSafe, Math.max(0.5, snapHalfBeat(basePairSpan * 0.32)));
          durations.push(shortDur);
          cursor = snapHalfBeat(cursor + shortDur);
        }
      }
      return finalizeSlotsFromDurations(chordNames, durations, totalBeats);
    }

    // syncopated_mix: short punchy opener + varied syncopated anticipations
    const syncDurs: number[] = [];
    let syncCursor = 0;
    const avg = totalBeats / count;
    for (let i = 0; i < count; i++) {
      if (i === count - 1) {
        syncDurs.push(snapHalfBeat(totalBeats - syncCursor));
        break;
      }
      const left = count - i;
      const maxAllowed = snapHalfBeat(totalBeats - syncCursor - (left - 1) * 0.5);
      const raw =
        i === 0
          ? Math.max(1.5, Math.floor(avg) - 1.5)
          : i % 2 === 1
            ? Math.max(1.5, snapHalfBeat(avg * 0.85))
            : Math.max(2.0, snapHalfBeat(avg));
      const d = Math.min(maxAllowed, Math.max(0.5, raw));
      syncDurs.push(d);
      syncCursor = snapHalfBeat(syncCursor + d);
    }
    return finalizeSlotsFromDurations(chordNames, syncDurs, totalBeats);
  };

  if (grooveMode !== 'random') {
    return buildForMode(grooveMode);
  }

  const currentDiag = describeChordRhythm(slots, safeBars).modeId;
  const currentSig = slots.map((s) => `${s.startBeat}:${s.durationBeats}`).join('|');
  const candidates: Array<Exclude<ChordRhythmGrooveMode, 'random'>> = [
    'anticipate_4th',
    'half_bar_drive',
    'stretch_and_push',
    'syncopated_mix',
    'even',
  ];
  const validBuilt = candidates
    .filter((m) => m !== currentDiag)
    .map((m) => buildForMode(m))
    .filter((built) => built.map((s) => `${s.startBeat}:${s.durationBeats}`).join('|') !== currentSig);

  const pool = validBuilt.length > 0 ? validBuilt : [buildForMode('anticipate_4th')];
  const pickIdx =
    seed !== undefined
      ? Math.abs(Math.floor(seed)) % pool.length
      : Math.floor(Math.random() * pool.length);
  return pool[pickIdx];
}
