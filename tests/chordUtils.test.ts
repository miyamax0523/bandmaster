import { describe, expect, it } from 'vitest';
import {
  fitPitchClassToRange,
  getDefaultProgression,
  getDiatonicChords,
  parseChord,
  resolveChordForBar,
  transposeChord,
  transposeChords,
} from '../src/lib/chordUtils';

describe('chordUtils', () => {
  it('parses roots, qualities, tensions, and slash bass accurately', () => {
    const cm = parseChord('Cm7');
    expect(cm.root).toBe('C');
    expect(cm.quality).toBe('minor');
    expect(cm.intervals).toEqual([0, 3, 7, 10]);

    const fSharpDim = parseChord('F#m7b5');
    expect(fSharpDim.root).toBe('F#');
    expect(fSharpDim.rootSemitone).toBe(6);
    expect(fSharpDim.intervals).toEqual([0, 3, 6, 10]);

    const slash = parseChord('Bbadd9/D');
    expect(slash.root).toBe('A#');
    expect(slash.bass).toBe('D');
    expect(slash.intervals).toEqual([0, 4, 7, 14]);
  });

  it('generates diatonic chords and default progressions for Major and Minor keys', () => {
    expect(getDiatonicChords('C', 'Major')).toEqual([
      'C',
      'Dm',
      'Em',
      'F',
      'G',
      'Am',
      'Bm7b5',
    ]);
    expect(getDiatonicChords('E', 'Minor')).toEqual([
      'Em',
      'F#m7b5',
      'G',
      'Am',
      'Bm',
      'C',
      'D',
    ]);
    expect(getDefaultProgression('E', 'Minor')).toEqual(['Em', 'C', 'G', 'D']);
  });

  it('cycles chords across bars and falls back on empty chords', () => {
    const emptyBar2 = resolveChordForBar([], 2, 'E', 'Minor');
    expect(emptyBar2.raw).toBe('G');

    const cycled = resolveChordForBar(['Em', 'C'], 3, 'E', 'Minor');
    expect(cycled.raw).toBe('C');
  });

  it('transposes chords and slash chords by semitones', () => {
    expect(transposeChord('Em7', 2)).toBe('F#m7');
    expect(transposeChords(['Em', 'C', 'G/B', 'D'], -2)).toEqual([
      'Dm',
      'A#',
      'F/A',
      'C',
    ]);
  });

  it('fits pitch classes into specified MIDI ranges', () => {
    expect(fitPitchClassToRange(4, 28, 39)).toBe(28); // E1
    expect(fitPitchClassToRange(4, 40, 51)).toBe(40); // E2
    expect(fitPitchClassToRange(0, 28, 39)).toBe(36); // C2
  });
});
