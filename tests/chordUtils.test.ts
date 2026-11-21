import { describe, expect, it } from 'vitest';
import { generateBassNotes } from '../src/engines/bassEngine';
import { generateKeyboardNotes } from '../src/engines/keyboardEngine';
import { createDefaultSongConfig } from '../src/lib/bandState';
import { createUniformChordTimeline } from '../src/lib/chordTimeline';
import {
  applySuffixToChord,
  fitPitchClassToRange,
  getChordPalette,
  getDefaultProgression,
  getDiatonicChords,
  parseChord,
  resolveChordForBar,
  transposeChord,
  transposeChords,
} from '../src/lib/chordUtils';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import type { Section } from '../src/types/song';

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
    expect(slash.bassPitchClass).toBe(2);
    expect(slash.intervals).toEqual([0, 4, 7, 14]);
  });

  it('parses extended chords: M7, maj7, △7, M9, maj9, add9, 6, 69, m9, madd9, mM7, 7sus4, sus2, dim7, aug, 5, and slash C/E', () => {
    expect(parseChord('CM7').intervals).toEqual([0, 4, 7, 11]);
    expect(parseChord('Cmaj7').intervals).toEqual([0, 4, 7, 11]);
    expect(parseChord('C△7').intervals).toEqual([0, 4, 7, 11]);
    expect(parseChord('CM9').intervals).toEqual([0, 4, 7, 11, 14]);
    expect(parseChord('Cmaj9').intervals).toEqual([0, 4, 7, 11, 14]);
    expect(parseChord('Cadd9').intervals).toEqual([0, 4, 7, 14]);
    expect(parseChord('C6').intervals).toEqual([0, 4, 7, 9]);
    expect(parseChord('C69').intervals).toEqual([0, 4, 7, 9, 14]);

    expect(parseChord('Am9').intervals).toEqual([0, 3, 7, 10, 14]);
    expect(parseChord('Amadd9').intervals).toEqual([0, 3, 7, 14]);
    expect(parseChord('Am(add9)').intervals).toEqual([0, 3, 7, 14]);
    expect(parseChord('Am6').intervals).toEqual([0, 3, 7, 9]);
    expect(parseChord('AmM7').intervals).toEqual([0, 3, 7, 11]);
    expect(parseChord('AmMaj7').intervals).toEqual([0, 3, 7, 11]);
    expect(parseChord('Bø').intervals).toEqual([0, 3, 6, 10]);

    expect(parseChord('G7').intervals).toEqual([0, 4, 7, 10]);
    expect(parseChord('G9').intervals).toEqual([0, 4, 7, 10, 14]);
    expect(parseChord('G7sus4').intervals).toEqual([0, 5, 7, 10]);
    expect(parseChord('Gsus4').intervals).toEqual([0, 5, 7]);
    expect(parseChord('Asus2').intervals).toEqual([0, 2, 7]);
    expect(parseChord('Bdim').intervals).toEqual([0, 3, 6]);
    expect(parseChord('Bdim7').intervals).toEqual([0, 3, 6, 9]);
    expect(parseChord('Caug').intervals).toEqual([0, 4, 8]);
    expect(parseChord('E5').intervals).toEqual([0, 7]);

    const cOverE = parseChord('C/E');
    expect(cOverE.rootPitchClass).toBe(0);
    expect(cOverE.bassPitchClass).toBe(4);
    expect(cOverE.intervals).toEqual([0, 4, 7]);
  });

  it('generates diatonic chords, extended palettes, and suffix conversions', () => {
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

    expect(getChordPalette('E', 'Minor', 'seventh')).toContain('Gmaj7');
    expect(getChordPalette('E', 'Minor', 'ninth')).toContain('Em9');
    expect(getChordPalette('E', 'Minor', 'add9sus')).toContain('Em(add9)');
    expect(getChordPalette('E', 'Minor', 'power')).toEqual([
      'E5',
      'F#5',
      'G5',
      'A5',
      'B5',
      'C5',
      'D5',
    ]);

    expect(applySuffixToChord('C', 'M9')).toBe('CM9');
    expect(applySuffixToChord('Em7', 'add9')).toBe('Eadd9');
    expect(applySuffixToChord('D/F#', 'sus4')).toBe('Dsus4/F#');
  });

  it('cycles chords across bars and falls back on empty chords', () => {
    const emptyBar2 = resolveChordForBar([], 2, 'E', 'Minor');
    expect(emptyBar2.raw).toBe('G');

    const cycled = resolveChordForBar(['Em', 'C'], 3, 'E', 'Minor');
    expect(cycled.raw).toBe('C');
  });

  it('transposes extended chords and slash chords by semitones', () => {
    expect(transposeChord('Em7', 2)).toBe('F#m7');
    expect(transposeChord('CM9', 2)).toBe('DM9');
    expect(transposeChord('Am(add9)/G', 3)).toBe('Cm(add9)/A#');
    expect(transposeChords(['Em', 'C', 'G/B', 'D'], -2)).toEqual([
      'Dm',
      'A#',
      'F/A',
      'C',
    ]);
  });

  it('voices CM9, Csus2, E5 accurately in keyboardEngine and prioritizes bassPitchClass in bassEngine', () => {
    const song = createDefaultSongConfig('rockBand');
    song.members.keyboard.activeSectionsOnly = false;
    song.members.keyboard.keyboardStyle = 'Long Sustain';
    song.members.keyboard.instructionText = '浮遊'; // also adds add9/add7/sus2 via Set merge

    const secKb: Section = {
      id: 'sec-kb',
      type: 'Verse',
      name: 'Verse',
      bars: 2,
      energy: 'Mid',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(['CM9', 'E5'], 2),
    };

    const kbNotes = generateKeyboardNotes({
      song,
      section: secKb,
      sectionIndex: 0,
      style: 'B',
      seed: 1,
      params: resolveInstrumentParams(song, secKb, 'keyboard', 'B'),
    });

    // Bar 0 (CM9 + 浮遊 Set merge): C4(60), D4(62), G4(67), B4(71), D5(74) — no duplicate pitches
    const bar0Pitches = kbNotes
      .filter((n) => n.startTick === 0)
      .map((n) => n.pitch);
    expect(new Set(bar0Pitches).size).toBe(bar0Pitches.length);
    expect(bar0Pitches).toContain(60); // C4
    expect(bar0Pitches).toContain(67); // G4
    expect(bar0Pitches).toContain(71); // B4 (maj7, NOT overwritten with 10)
    expect(bar0Pitches).toContain(74); // D5 (9th)

    // Check plain CM9 without 浮遊 keyword retains major 3rd E4(64)
    song.members.keyboard.instructionText = '';
    const kbStrict = generateKeyboardNotes({
      song,
      section: secKb,
      sectionIndex: 0,
      style: 'B',
      seed: 1,
      params: resolveInstrumentParams(song, secKb, 'keyboard', 'B'),
    });
    const strictBar0 = kbStrict
      .filter((n) => n.startTick === 0)
      .map((n) => n.pitch);
    expect(strictBar0).toEqual([60, 64, 67, 71, 74]);

    // Bar 1 (E5 power chord): E4(64), B4(71)
    const strictBar1 = kbStrict
      .filter((n) => n.startTick === 1920)
      .map((n) => n.pitch);
    expect(strictBar1).toEqual([64, 71]);

    // Slash chord C/E in bassEngine -> bar head uses E1(28), NOT C2(36)
    const secSlash: Section = {
      id: 'sec-slash',
      type: 'Verse',
      name: 'Slash',
      bars: 1,
      energy: 'Mid',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(['C/E'], 1),
    };
    const bassNotes = generateBassNotes({
      song,
      section: secSlash,
      sectionIndex: 0,
      style: 'B',
      seed: 1,
      params: resolveInstrumentParams(song, secSlash, 'bass', 'B'),
      drumNotes: [],
    });
    expect(bassNotes[0].pitch).toBe(28);
  });

  it('fits pitch classes into specified MIDI ranges', () => {
    expect(fitPitchClassToRange(4, 28, 39)).toBe(28); // E1
    expect(fitPitchClassToRange(4, 40, 51)).toBe(40); // E2
    expect(fitPitchClassToRange(0, 28, 39)).toBe(36); // C2
  });
});
