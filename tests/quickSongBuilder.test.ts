import { describe, expect, it, vi } from 'vitest';
import { generateAllSections } from '../src/lib/bandState';
import { getScalePitchClasses, parseChord } from '../src/lib/chordUtils';
import { TICKS_PER_BAR } from '../src/types/song';
import {
  buildSongFromQuickSetup,
  type QuickGenreId,
  type QuickSongLengthId,
  type QuickStructureTemplateId,
} from '../src/utils/quickSongBuilder';

describe('quickSongBuilder', () => {
  it('1. builds valid songs across all 6 genres and all 3 song length templates', () => {
    const genres: QuickGenreId[] = [
      'alt_heavy_shoegaze',
      'emo_jrock',
      'royal_jpop',
      'numetal_mixture',
      'fusion_funk',
      'chill_lofi_ballad',
    ];
    const lengthToTemplates: Array<{
      lengthId: QuickSongLengthId;
      template: QuickStructureTemplateId;
      minBars: number;
    }> = [
      { lengthId: 'short_loop', template: 'short_ab', minBars: 8 },
      { lengthId: 'one_chorus', template: 'one_standard', minBars: 28 },
      { lengthId: 'full_chorus', template: 'full_dramatic', minBars: 60 },
    ];

    for (const genre of genres) {
      for (const lenSpec of lengthToTemplates) {
        const song = buildSongFromQuickSetup(
          {
            keyRoot: 'E',
            scaleType: 'Minor',
            bpm: 130,
            genre,
            songLength: lenSpec.lengthId,
            structureTemplate: lenSpec.template,
            chordPreset: 'auto_by_genre',
          },
          1234
        );

        expect(song.sections.length).toBeGreaterThan(0);
        const totalBars = song.sections.reduce((sum, s) => sum + s.bars, 0);
        expect(totalBars).toBeGreaterThanOrEqual(lenSpec.minBars);

        for (const sec of song.sections) {
          expect(sec.chords.length).toBeGreaterThan(0);
          expect(sec.patternPresets?.drums).toBeTruthy();
          expect(sec.patternPresets?.bass).toBeTruthy();
          expect(sec.patternPresets?.keyboard).toBeTruthy();
          expect(sec.patternPresets?.pad).toBeTruthy();
          expect(sec.patternPresets?.vocal).toBeTruthy();
        }
      }
    }
  });

  it('2. executes full 5-part generation pipeline cleanly across all sections with strict bounds, monophony, and vocal scale conformance', () => {
    const song = buildSongFromQuickSetup(
      {
        keyRoot: 'C',
        scaleType: 'Major',
        bpm: 132,
        genre: 'royal_jpop',
        songLength: 'one_chorus',
        structureTemplate: 'one_standard',
        chordPreset: 'royal_4536',
        includeAnticipation: true,
      },
      2026
    );

    const state = generateAllSections(song, undefined, 2026, true);
    const scalePcs = new Set(getScalePitchClasses('C', 'Major'));

    for (const sec of song.sections) {
      const cells = state.cellsBySection[sec.id];
      expect(cells).toBeDefined();
      const secEnd = sec.bars * TICKS_PER_BAR;

      for (const inst of ['drums', 'bass', 'keyboard', 'pad', 'vocal'] as const) {
        const notes = cells[inst].takes.A;
        if (sec.enabledParts?.[inst] === false) {
          expect(notes).toEqual([]);
          continue;
        }
        expect(notes.length).toBeGreaterThan(0);
        for (const n of notes) {
          expect(n.startTick).toBeGreaterThanOrEqual(0);
          expect(n.durationTicks).toBeGreaterThan(0);
          expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(secEnd);
        }

        if (inst === 'bass' || inst === 'vocal') {
          for (let i = 0; i + 1 < notes.length; i++) {
            expect(notes[i].startTick + notes[i].durationTicks).toBeLessThanOrEqual(
              notes[i + 1].startTick
            );
          }
        }
        if (inst === 'vocal') {
          for (const n of notes) {
            expect(scalePcs.has(n.pitch % 12)).toBe(true);
          }
        }
      }
    }
  });

  it('3. transposes accurately across keys (F# Major, D Minor) and parses custom chords with safe fallback', () => {
    const fSharpSong = buildSongFromQuickSetup(
      {
        keyRoot: 'F#',
        scaleType: 'Major',
        bpm: 128,
        genre: 'royal_jpop',
        songLength: 'short_loop',
        structureTemplate: 'short_ab',
        chordPreset: 'canon_15634145',
      },
      10
    );
    expect(fSharpSong.key).toBe('F#');
    expect(parseChord(fSharpSong.sections[0].chords[0].chord).rootPitchClass).toBe(6); // F#

    const dMinorSong = buildSongFromQuickSetup(
      {
        keyRoot: 'D',
        scaleType: 'Minor',
        bpm: 118,
        genre: 'alt_heavy_shoegaze',
        songLength: 'short_loop',
        structureTemplate: 'short_ab',
        chordPreset: 'alt_floating',
      },
      10
    );
    expect(dMinorSong.key).toBe('D');
    expect(dMinorSong.scale).toBe('Minor');
    expect(parseChord(dMinorSong.sections[0].chords[0].chord).rootPitchClass).toBe(2); // D

    // Custom chords
    const customSong = buildSongFromQuickSetup(
      {
        keyRoot: 'C',
        scaleType: 'Major',
        bpm: 120,
        genre: 'fusion_funk',
        songLength: 'short_loop',
        structureTemplate: 'short_chorus_loop',
        chordPreset: 'custom',
        customChordsText: 'Cmaj7 Am7 Dm7 G7',
      },
      55
    );
    expect(customSong.sections[0].chords.slice(0, 4).map((c) => c.chord)).toEqual([
      'Cmaj7',
      'Am7',
      'Dm7',
      'G7',
    ]);

    // Invalid/empty custom text falls back safely without throwing
    const fallbackSong = buildSongFromQuickSetup(
      {
        keyRoot: 'C',
        scaleType: 'Major',
        bpm: 120,
        genre: 'royal_jpop',
        songLength: 'short_loop',
        structureTemplate: 'short_chorus_loop',
        chordPreset: 'custom',
        customChordsText: '??? invalid !!!',
      },
      55
    );
    expect(fallbackSong.sections[0].chords.length).toBe(8);
  });

  it('4. is 100% deterministic with zero Math.random() calls', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      const params = {
        keyRoot: 'Eb',
        scaleType: 'Major',
        bpm: 140,
        genre: 'emo_jrock' as const,
        songLength: 'one_chorus' as const,
        structureTemplate: 'one_standard' as const,
        chordPreset: 'emo_driving' as const,
        includeAnticipation: true,
      };
      const s1 = buildSongFromQuickSetup(params, 777);
      const s2 = buildSongFromQuickSetup(params, 777);
      expect(s1).toEqual(s2);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
