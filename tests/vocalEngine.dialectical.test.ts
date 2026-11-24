import { describe, expect, it, vi } from 'vitest';
import {
  adaptNotesForExportTarget,
  CHAPTER_TICKS,
  computePattern2CoreSimilarity,
  GENRE_DIALECTICAL_PROFILES,
  generateDialecticalVocal,
  VOISONA_MIN_GAP_TICKS,
  type EightBarScheme,
  type MasterGenre,
} from '../src/engines/vocalEngine';
import {
  createDefaultSongConfig,
  generateAllSections,
  updateSectionVocalChapterForm,
  updateSectionVocalDialecticalScheme,
} from '../src/lib/bandState';
import { createUniformChordTimeline } from '../src/lib/chordTimeline';
import { getScalePitchClasses } from '../src/lib/chordUtils';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import { exportMultiTrackMidi } from '../src/lib/midiExport';
import { parseMidiFile } from '../src/lib/midiParser';
import { type Section } from '../src/types/song';

const ALL_GENRES: readonly MasterGenre[] = [
  'alt_shoegaze',
  'emo_jrock',
  'numetal_mixture',
  'royal_jpop',
  'chill_ballad',
];

const SCHEMES: readonly EightBarScheme[] = ['T-A-T-A', 'T-A-T-S'];

function makeChorusSection(
  bars: number,
  genre: MasterGenre,
  scheme: EightBarScheme | 'auto' = 'auto',
  form: 'auto' | 'two_bar_continuous' | 'one_bar_repeat_with_passing' = 'auto'
): Section {
  return {
    id: `sec-dial-${genre}-${bars}`,
    type: 'Chorus',
    name: bars === 16 ? 'ラスサビ' : 'サビ',
    bars,
    energy: 'High',
    kickMode: genre === 'numetal_mixture' ? '808' : 'acoustic',
    vocalDensity: 3.0,
    vocalDialecticalScheme: scheme,
    vocalChapterForm: form,
    patternPresets: {
      drums: 'auto',
      bass: 'auto',
      keyboard: 'auto',
      pad: 'auto',
      vocal: genre,
    },
    chords: createUniformChordTimeline(['C', 'G', 'Am', 'F'], bars),
  };
}

describe('vocalEngine Dialectical 3-Chapter Model x 2 Internal Forms', () => {
  it('1-3 & 6. enforces determinism, antithesis drop (1-4st + meanPitch), synthesis rebound (+2..+5st + ch3 runway), chapter-end guard, note cap, and dual SMF safety across 5 genres x 2 schemes x 20 seeds', () => {
    const randomSpy = vi.spyOn(Math, 'random');

    try {
      for (const genre of ALL_GENRES) {
        const profile = GENRE_DIALECTICAL_PROFILES[genre];
        const song = createDefaultSongConfig(genre);
        const scalePcs = new Set(getScalePitchClasses(song.key, song.scale));

        for (const scheme of SCHEMES) {
          const section = makeChorusSection(8, genre, scheme, 'auto');
          const params = resolveInstrumentParams(song, section, 'vocal', 'A');

          for (let seed = 1; seed <= 20; seed++) {
            const actualSeed = seed * 1009 + ALL_GENRES.indexOf(genre) * 37;
            randomSpy.mockClear();

            const res1 = generateDialecticalVocal({
              song,
              section,
              sectionIndex: 0,
              style: 'A',
              seed: actualSeed,
              params,
              masterGenreId: genre,
              vocalDialecticalScheme: scheme,
            });
            const res2 = generateDialecticalVocal({
              song,
              section,
              sectionIndex: 0,
              style: 'A',
              seed: actualSeed,
              params,
              masterGenreId: genre,
              vocalDialecticalScheme: scheme,
            });

            // 1. Strict determinism & zero Math.random()
            expect(randomSpy).not.toHaveBeenCalled();
            expect(res1.notes).toEqual(res2.notes);
            expect(res1.chapters).toEqual(res2.chapters);
            expect(res1.chapters.length).toBe(4);

            // Structural unity: T1 (ch 0) and T2 (ch 2) share identical internal form
            expect(res1.chapters[0].form).toBe(res1.chapters[2].form);

            // Group notes by chapter
            const byChapter = res1.chapters.map((ch) =>
              res1.notes.filter((n) => n.chapterIndex === ch.chapterIndex)
            );

            // Key/Scale 100% conformance, note cap, chapter-end guard, and internal monophonic minGap >= 20
            for (let c = 0; c < 4; c++) {
              const chNotes = byChapter[c];
              expect(chNotes.length).toBeGreaterThan(0);
              expect(chNotes.length).toBeLessThanOrEqual(profile.maxNotesPerChapter);

              for (const n of chNotes) {
                expect(scalePcs.has(n.midiPitch % 12)).toBe(true);
              }

              if (chNotes.length >= 2) {
                const last = chNotes[chNotes.length - 1];
                const prev = chNotes[chNotes.length - 2];
                expect(last.midiPitch - prev.midiPitch).toBeLessThan(5);
              }
            }

            for (let i = 0; i + 1 < res1.notes.length; i++) {
              const curr = res1.notes[i];
              const next = res1.notes[i + 1];
              expect(next.startTick - (curr.startTick + curr.gateDuration)).toBeGreaterThanOrEqual(
                VOISONA_MIN_GAP_TICKS
              );
            }

            const topOf = (arr: typeof res1.notes) =>
              Math.max(...arr.map((n) => n.midiPitch));
            const meanOf = (arr: typeof res1.notes) =>
              arr.reduce((s, n) => s + n.midiPitch, 0) / arr.length;

            const ch0Top = topOf(byChapter[0]);
            const ch0Mean = meanOf(byChapter[0]);
            const ch1Top = topOf(byChapter[1]);
            const ch1Mean = meanOf(byChapter[1]);

            // 2. Antithesis drop validation (ch 1 vs ch 0)
            expect(ch1Top).toBeLessThan(ch0Top);
            expect(ch0Top - ch1Top).toBeGreaterThanOrEqual(1);
            expect(ch0Top - ch1Top).toBeLessThanOrEqual(4);
            expect(ch1Mean).toBeLessThan(ch0Mean);

            if (scheme === 'T-A-T-A') {
              expect(res1.chapters.map((c) => c.role)).toEqual([
                'thesis',
                'antithesis',
                'thesis',
                'antithesis',
              ]);
              const ch2Top = topOf(byChapter[2]);
              const ch2Mean = meanOf(byChapter[2]);
              const ch3Top = topOf(byChapter[3]);
              const ch3Mean = meanOf(byChapter[3]);
              expect(ch3Top).toBeLessThan(ch2Top);
              expect(ch2Top - ch3Top).toBeGreaterThanOrEqual(1);
              expect(ch2Top - ch3Top).toBeLessThanOrEqual(4);
              expect(ch3Mean).toBeLessThan(ch2Mean);
            } else {
              // 3. T-A-T-S: Synthesis rebound (+2..+5st vs Thesis) & Chapter 3 (index 2) runway notes
              expect(res1.chapters.map((c) => c.role)).toEqual([
                'thesis',
                'antithesis',
                'thesis',
                'synthesis',
              ]);
              const ch2Runway = byChapter[2].filter((n) => n.tag === 'runway');
              expect(ch2Runway.length).toBe(2);
              expect(ch2Runway.map((n) => n.startTick - 2 * CHAPTER_TICKS)).toEqual([
                3360, 3600,
              ]);
              expect(ch2Runway[1].midiPitch).toBeGreaterThan(ch2Runway[0].midiPitch);

              const ch3Top = topOf(byChapter[3]);
              expect(ch3Top).toBeGreaterThanOrEqual(ch0Top + 2);
              expect(ch3Top).toBeLessThanOrEqual(ch0Top + 5);
            }

            // 6. Dual output safety (Cubase Expressive PB & VoiSona Clean)
            const cubase = adaptNotesForExportTarget(
              res1.notes,
              'cubase_smf_expressive'
            );
            if (cubase.pitchBends.length > 0) {
              expect(
                cubase.pitchBends[cubase.pitchBends.length - 1].value14Bit
              ).toBe(8192);
              for (const pb of cubase.pitchBends) {
                expect(pb.value14Bit).toBeGreaterThanOrEqual(0);
                expect(pb.value14Bit).toBeLessThanOrEqual(16383);
              }
            }

            const voisona = adaptNotesForExportTarget(
              res1.notes,
              'voisona_clean_smf'
            );
            expect(voisona.pitchBends).toEqual([]);
            for (let i = 0; i < voisona.notes.length; i++) {
              const vn = voisona.notes[i];
              expect(vn.hasFall).toBe(false);
              expect(vn.gateDuration).toBeGreaterThanOrEqual(120);
              if (i + 1 < voisona.notes.length) {
                const gap =
                  voisona.notes[i + 1].startTick - (vn.startTick + vn.gateDuration);
                expect(gap).toBeGreaterThanOrEqual(0);
                expect(gap === 0 || gap >= 180).toBe(true);
              }
            }
          }
        }
      }
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('4. verifies Pattern 2 (one_bar_repeat_with_passing) MIR core similarity (rhythmIoU >= 0.75, combined >= 0.70) and Zone 2 passing connector (1-3 notes, >= 1 passing) across all 5 genres x 20 seeds', () => {
    for (const genre of ALL_GENRES) {
      const song = createDefaultSongConfig(genre);
      const section = makeChorusSection(
        8,
        genre,
        'T-A-T-S',
        'one_bar_repeat_with_passing'
      );
      const params = resolveInstrumentParams(song, section, 'vocal', 'A');

      for (let seed = 1; seed <= 20; seed++) {
        const res = generateDialecticalVocal({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed: seed * 313 + 7,
          params,
          masterGenreId: genre,
          vocalDialecticalScheme: 'T-A-T-S',
          vocalChapterForm: 'one_bar_repeat_with_passing',
        });

        // Chapters 0, 1, 2 use Pattern 2
        for (const ch of res.chapters) {
          if (ch.form !== 'one_bar_repeat_with_passing') continue;
          const chNotes = res.notes.filter((n) => n.chapterIndex === ch.chapterIndex);
          const sim = computePattern2CoreSimilarity(chNotes, ch.startTick, 60);
          expect(sim.rhythmIoU).toBeGreaterThanOrEqual(0.75);
          expect(sim.combined).toBeGreaterThanOrEqual(0.7);

          const boundaryNotes = chNotes.filter((n) => {
            const rel = n.startTick - ch.startTick;
            return rel >= 1440 && rel <= 2160 && rel !== 1920;
          });
          expect(boundaryNotes.length).toBeGreaterThanOrEqual(1);
          expect(boundaryNotes.length).toBeLessThanOrEqual(3);
          expect(boundaryNotes.some((n) => n.tag === 'passing')).toBe(true);
        }
      }
    }
  });

  it('5. verifies 16-bar last-chorus structure (first 8 bars T-A-T-A + second 8 bars T-A-T-S, shared ch1/ch5 thesis form, single peak in ch8) and UI state update helpers', () => {
    for (const genre of ALL_GENRES) {
      const song = createDefaultSongConfig(genre);
      const sec16 = makeChorusSection(16, genre, 'auto', 'auto');
      const params = resolveInstrumentParams(song, sec16, 'vocal', 'A');

      const res = generateDialecticalVocal({
        song,
        section: sec16,
        sectionIndex: 0,
        style: 'A',
        seed: 2026,
        params,
        masterGenreId: genre,
      });

      expect(res.chapters.length).toBe(8);
      expect(res.chapters.map((c) => c.role)).toEqual([
        'thesis',
        'antithesis',
        'thesis',
        'antithesis',
        'thesis',
        'antithesis',
        'thesis',
        'synthesis',
      ]);

      // Chapter 1 (index 0) and Chapter 5 (index 4) share the same thesis form & rhythm
      expect(res.chapters[0].form).toBe(res.chapters[4].form);
      const ch0Rhythm = res.notes
        .filter((n) => n.chapterIndex === 0)
        .map((n) => n.startTick - res.chapters[0].startTick);
      const ch4Rhythm = res.notes
        .filter((n) => n.chapterIndex === 4)
        .map((n) => n.startTick - res.chapters[4].startTick);
      expect(ch4Rhythm).toEqual(ch0Rhythm);

      // Chapter 7 (index 6) has runway notes; Chapter 8 (index 7, synthesis) reaches highest pitch of entire 16-bar section
      expect(
        res.notes.filter((n) => n.chapterIndex === 6 && n.tag === 'runway').length
      ).toBe(2);
      const ch8Max = Math.max(
        ...res.notes.filter((n) => n.chapterIndex === 7).map((n) => n.midiPitch)
      );
      const ch0to6Max = Math.max(
        ...res.notes.filter((n) => n.chapterIndex < 7).map((n) => n.midiPitch)
      );
      expect(ch8Max).toBeGreaterThan(ch0to6Max);
    }

    // Verify bandState UI updater helpers regenerate vocal immediately & export cleanly to both SMF targets
    const song = createDefaultSongConfig('royal_jpop');
    song.sections = [makeChorusSection(8, 'royal_jpop', 'auto', 'auto')];
    let state = generateAllSections(song, undefined, 4242, true);

    const updScheme = updateSectionVocalDialecticalScheme(
      song,
      state,
      song.sections[0].id,
      'T-A-T-S'
    );
    expect(updScheme.song.sections[0].vocalDialecticalScheme).toBe('T-A-T-S');

    const updForm = updateSectionVocalChapterForm(
      updScheme.song,
      updScheme.bandState,
      song.sections[0].id,
      'one_bar_repeat_with_passing'
    );
    expect(updForm.song.sections[0].vocalChapterForm).toBe(
      'one_bar_repeat_with_passing'
    );
    state = updForm.bandState;

    const voisonaSmf = exportMultiTrackMidi(updForm.song, state, {
      exportTarget: 'voisona_clean_smf',
    });
    const parsedV = parseMidiFile(voisonaSmf.bytes);
    const vocalV = parsedV.tracks.find((t) => t.name === 'Vocal')!;
    expect(vocalV.pitchBends).toEqual([]);
    for (let i = 0; i + 1 < vocalV.notes.length; i++) {
      const gap =
        vocalV.notes[i + 1].startTick -
        (vocalV.notes[i].startTick + vocalV.notes[i].durationTicks);
      expect(gap >= 0 && (gap === 0 || gap >= 180)).toBe(true);
    }
  });
});
