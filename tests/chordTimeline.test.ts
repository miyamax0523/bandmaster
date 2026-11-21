import { describe, expect, it } from 'vitest';
import {
  applyChordRhythmGroove,
  createUniformChordTimeline,
  describeChordRhythm,
  getActiveChordAtTick,
  mergeChordWithPrev,
  normalizeSectionChords,
  resizeTimelineToBars,
  shiftChordBoundary,
  splitChordSlot,
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
});
