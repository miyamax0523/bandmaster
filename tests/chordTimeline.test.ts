import { describe, expect, it } from 'vitest';
import {
  applyChordRhythmGroove,
  createUniformChordTimeline,
  describeChordRhythm,
  getActiveChordAtTick,
  insertChordAfter,
  mergeChordWithPrev,
  normalizeSectionChords,
  removeChordSlot,
  resizeTimelineToBars,
  setChordBoundaryBeat,
  shiftChordBoundary,
  splitChordSlot,
  swapChordOrder,
  updateChordName,
} from '../src/lib/chordTimeline';
import { TICKS_PER_BEAT } from '../src/types/song';

describe('chordTimeline', () => {
  it('shifts chord boundary by -0.5/+0.5 beats, clamps minimum 0.5 beat slots, and sets anticipated flag', () => {
    const slots = createUniformChordTimeline(['DM7', 'C#m7'], 2); // 0..4, 4..8 beats
    expect(slots.map((s) => [s.chord, s.startBeat, s.durationBeats, s.anticipated])).toEqual([
      ['DM7', 0, 4, false],
      ['C#m7', 4, 4, false],
    ]);

    // Shift C#m7 boundary half-beat earlier -> beat 3.5 (4-and anticipation)
    const pushed = shiftChordBoundary(slots, 1, -0.5);
    expect(pushed[0].durationBeats).toBe(3.5);
    expect(pushed[1].startBeat).toBe(3.5);
    expect(pushed[1].durationBeats).toBe(4.5);
    expect(pushed[1].anticipated).toBe(true);

    // Query active chord right before 1680 (1675 -> DM7) and right at 1680 (-> C#m7)
    const before = getActiveChordAtTick(pushed, 3.5 * TICKS_PER_BEAT - 5, 'D', 'Major', 2);
    const after = getActiveChordAtTick(pushed, 3.5 * TICKS_PER_BEAT, 'D', 'Major', 2);
    expect(before.slot.chord).toBe('DM7');
    expect(after.slot.chord).toBe('C#m7');

    // Shift back +0.5 returns anticipated to false cleanly
    const restored = shiftChordBoundary(pushed, 1, 0.5);
    expect(restored[1].startBeat).toBe(4);
    expect(restored[1].anticipated).toBe(false);

    // Clamp so neither slot falls below 0.5 beats
    const extremeBack = shiftChordBoundary(slots, 1, -10);
    expect(extremeBack[0].durationBeats).toBe(0.5);
    expect(extremeBack[1].startBeat).toBe(0.5);
    expect(extremeBack[1].durationBeats).toBe(7.5);
  });

  it('splits, merges, updates chord name, resizes bars, and migrates legacy chord strings', () => {
    const base = createUniformChordTimeline(['Em', 'C'], 2); // 0..4, 4..8

    // Split 4 beats -> 2 + 2
    const split1 = splitChordSlot(base, 0);
    expect(split1.map((s) => [s.startBeat, s.durationBeats])).toEqual([
      [0, 2],
      [2, 2],
      [4, 4],
    ]);

    // Update middle slot chord name without touching timing
    const renamed = updateChordName(split1, 1, 'D');
    expect(renamed[1].chord).toBe('D');
    expect(renamed[1].startBeat).toBe(2);
    expect(renamed[1].durationBeats).toBe(2);

    // Merge index 1 back into index 0 -> 4 beats again
    const merged = mergeChordWithPrev(renamed, 1);
    expect(merged.map((s) => [s.chord, s.startBeat, s.durationBeats])).toEqual([
      ['Em', 0, 4],
      ['C', 4, 4],
    ]);

    // Resize 2 bars (8 beats) -> 4 bars (16 beats) preserves proportion
    const resizedUp = resizeTimelineToBars(split1, 4);
    expect(resizedUp.reduce((s, x) => s + x.durationBeats, 0)).toBe(16);

    // Migrate legacy string[] and comma-separated chordProgression string
    const fromStrings = normalizeSectionChords(['Am', 'F', 'C', 'G'], 4);
    expect(fromStrings.length).toBe(4);
    expect(fromStrings[2].startBeat).toBe(8);

    const fromLegacyString = normalizeSectionChords(undefined, 4, 'Em7, Am7, D7, Gmaj7');
    expect(fromLegacyString.map((s) => s.chord)).toEqual(['Em7', 'Am7', 'D7', 'Gmaj7']);
    expect(fromLegacyString.reduce((s, x) => s + x.durationBeats, 0)).toBe(16);
  });

  it('diagnoses chord rhythm patterns via describeChordRhythm and rearranges timing without changing chords via applyChordRhythmGroove', () => {
    const base = createUniformChordTimeline(['DM7', 'C#m7', 'Bm7', 'A'], 4);
    const diagEven = describeChordRhythm(base, 4);
    expect(diagEven.modeId).toBe('even');
    expect(diagEven.badgeIcon).toBe('📏');
    expect(diagEven.slotPositionLabels[0]).toContain('1小節 1拍目');

    // 4th beat anticipation
    const ant4 = applyChordRhythmGroove(base, 4, 'anticipate_4th');
    expect(ant4.map((s) => s.chord)).toEqual(['DM7', 'C#m7', 'Bm7', 'A']);
    expect(ant4.reduce((sum, s) => sum + s.durationBeats, 0)).toBe(16);
    expect(ant4.slice(1).every((s) => s.anticipated && s.startBeat % 4 === 3.5)).toBe(true);
    const diagAnt = describeChordRhythm(ant4, 4);
    expect(diagAnt.modeId).toBe('anticipate_4th');
    expect(diagAnt.badgeIcon).toBe('⚡');
    expect(diagAnt.slotPositionLabels[1]).toContain('裏');

    // Half-bar drive
    const drive = applyChordRhythmGroove(base, 4, 'half_bar_drive');
    expect(drive.map((s) => s.chord)).toEqual(['DM7', 'C#m7', 'Bm7', 'A']);
    expect(drive.reduce((sum, s) => sum + s.durationBeats, 0)).toBe(16);
    expect(drive.every((s) => s.durationBeats >= 0.5)).toBe(true);
    expect(describeChordRhythm(drive, 4).modeId).toBe('half_bar_drive');

    // Stretch & push
    const stretch = applyChordRhythmGroove(base, 4, 'stretch_and_push');
    expect(stretch.map((s) => s.chord)).toEqual(['DM7', 'C#m7', 'Bm7', 'A']);
    expect(stretch.reduce((sum, s) => sum + s.durationBeats, 0)).toBe(16);
    expect(stretch.some((s) => s.anticipated)).toBe(true);
    expect(describeChordRhythm(stretch, 4).modeId).toBe('stretch_and_push');

    // Syncopated mix & random always preserve chord order and move away from current rhythm
    const randomPick = applyChordRhythmGroove(base, 4, 'random', 2);
    expect(randomPick.map((s) => s.chord)).toEqual(['DM7', 'C#m7', 'Bm7', 'A']);
    expect(randomPick.reduce((sum, s) => sum + s.durationBeats, 0)).toBe(16);
    expect(randomPick.every((s) => s.durationBeats >= 0.5)).toBe(true);
    expect(describeChordRhythm(randomPick, 4).modeId).not.toBe('even');
  });

  it('expands short progressions to 4-beat-per-bar looped slots on 8-bar sections and supports insert/remove/swap/slide boundary moves', () => {
    // 8 bars (32 beats) with 4 chords -> 8 slots x 4 beats each (2 loops), not 4 x 8 beats
    const eightBarSlots = createUniformChordTimeline(['Em', 'C', 'G', 'D'], 8);
    expect(eightBarSlots.length).toBe(8);
    expect(eightBarSlots.map((s) => s.chord)).toEqual([
      'Em',
      'C',
      'G',
      'D',
      'Em',
      'C',
      'G',
      'D',
    ]);
    expect(eightBarSlots.every((s) => s.durationBeats === 4)).toBe(true);

    // insertChordAfter on >= 3.0 beat slot splits off 2.0 beats cleanly
    const twoBar = createUniformChordTimeline(['Am', 'F'], 2); // 0..4, 4..8
    const insertedFrom4 = insertChordAfter(twoBar, 0, 'G');
    expect(insertedFrom4.map((s) => [s.chord, s.startBeat, s.durationBeats])).toEqual([
      ['Am', 0, 2],
      ['G', 2, 2],
      ['F', 4, 4],
    ]);

    // insertChordAfter on <= 2.5 beat slot borrows from neighbor keeping total = 8 & min >= 0.5
    const tight = insertChordAfter(insertedFrom4, 0, 'Dm');
    expect(tight.length).toBe(4);
    expect(tight.reduce((sum, s) => sum + s.durationBeats, 0)).toBe(8);
    expect(tight.every((s) => s.durationBeats >= 0.5)).toBe(true);

    // removeChordSlot merges duration into previous (or next when removing index 0)
    const removedMid = removeChordSlot(insertedFrom4, 1);
    expect(removedMid.map((s) => [s.chord, s.startBeat, s.durationBeats])).toEqual([
      ['Am', 0, 4],
      ['F', 4, 4],
    ]);
    const removedHead = removeChordSlot(insertedFrom4, 0);
    expect(removedHead.map((s) => [s.chord, s.startBeat, s.durationBeats])).toEqual([
      ['G', 0, 4],
      ['F', 4, 4],
    ]);
    // 1-slot timeline cannot be deleted
    const single = createUniformChordTimeline(['C'], 1);
    expect(removeChordSlot(single, 0).length).toBe(1);

    // swapChordOrder swaps chord names with adjacent neighbor
    const swapped = swapChordOrder(insertedFrom4, 0, 1);
    expect(swapped.map((s) => s.chord)).toEqual(['G', 'Am', 'F']);

    // setChordBoundaryBeat sets direct 0.5-beat aligned drag target, clamps >= 0.5 & updates anticipated
    const slid = setChordBoundaryBeat(twoBar, 1, 2.5);
    expect(slid[0].durationBeats).toBe(2.5);
    expect(slid[1].startBeat).toBe(2.5);
    expect(slid[1].durationBeats).toBe(5.5);
    expect(slid[1].anticipated).toBe(true);

    const slidClamp = setChordBoundaryBeat(twoBar, 1, 0);
    expect(slidClamp[0].durationBeats).toBe(0.5);
    expect(slidClamp[1].startBeat).toBe(0.5);
    expect(slidClamp[1].durationBeats).toBe(7.5);
    expect(slidClamp[1].anticipated).toBe(true);
  });

  it('guarantees mutually unique IDs on 8-bar looped timelines and isolates single-slot updates without overwriting sibling slots', () => {
    const eightBar = createUniformChordTimeline(
      ['Dmaj7', 'C#m7', 'F#m7', 'A'],
      8
    );
    expect(eightBar.length).toBe(8);
    expect(new Set(eightBar.map((s) => s.id)).size).toBe(8);

    // Updating slot index 1 (or 4) to Bm7 must preserve all other 7 slots intact
    const afterEditIdx1 = updateChordName(eightBar, 1, 'Bm7');
    expect(afterEditIdx1.map((s) => s.chord)).toEqual([
      'Dmaj7',
      'Bm7',
      'F#m7',
      'A',
      'Dmaj7',
      'C#m7',
      'F#m7',
      'A',
    ]);
    expect(afterEditIdx1.map((s) => s.durationBeats)).toEqual(
      eightBar.map((s) => s.durationBeats)
    );

    const afterEditIdx4 = updateChordName(afterEditIdx1, 4, 'Gmaj7');
    expect(afterEditIdx4.map((s) => s.chord)).toEqual([
      'Dmaj7',
      'Bm7',
      'F#m7',
      'A',
      'Gmaj7',
      'C#m7',
      'F#m7',
      'A',
    ]);

    // After splitChordSlot & insertChordAfter, updating a single slot keeps unique IDs and never spreads to neighbors
    const split = splitChordSlot(eightBar, 0);
    expect(new Set(split.map((s) => s.id)).size).toBe(9);
    const updatedSplit = updateChordName(split, 1, 'E7');
    expect(updatedSplit[0].chord).toBe('Dmaj7');
    expect(updatedSplit[1].chord).toBe('E7');
    expect(updatedSplit[2].chord).toBe('C#m7');

    const inserted = insertChordAfter(updatedSplit, 2, 'G#dim7');
    expect(new Set(inserted.map((s) => s.id)).size).toBe(10);
    const updatedInserted = updateChordName(inserted, 3, 'C#7');
    expect(updatedInserted[2].chord).toBe('C#m7');
    expect(updatedInserted[3].chord).toBe('C#7');
    expect(updatedInserted[4].chord).toBe('F#m7');

    // normalizeSectionChords deduplicates legacy/corrupted duplicate IDs safely
    const duplicatedInput = eightBar.map((s) => ({ ...s, id: 'dup-id' }));
    const deduplicated = normalizeSectionChords(duplicatedInput, 8);
    expect(new Set(deduplicated.map((s) => s.id)).size).toBe(8);
  });
});
