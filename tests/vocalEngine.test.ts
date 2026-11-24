import { describe, expect, it, vi } from 'vitest';
import {
  adaptNotesForExportTarget,
  buildChapterPlans,
  generateRhythmFirstVocal,
  generateVocalHarmonyNotes,
  generateVocalNotes,
  MELODY_STYLE_PROFILES,
  mulberry32,
  normalizeSectionRole,
  PHRASE_2BAR_TICKS,
  RHYTHM_FIRST_GENRE_PROFILES,
  resolveMasterGenreForVocal,
  resolveSectionDynamicsModifier,
  VOCAL_MAX_PITCH,
  VOCAL_MIN_PITCH,
} from '../src/engines/vocalEngine';
import { createDefaultSongConfig, generateAllSections } from '../src/lib/bandState';
import { createUniformChordTimeline, shiftChordBoundary } from '../src/lib/chordTimeline';
import { getScalePitchClasses, snapPitchToScale } from '../src/lib/chordUtils';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import { PATTERN_PRESET_GROUPS } from '../src/lib/patternPresets';
import { processVocalMelody } from '../src/lib/riffProcessor';
import { TICKS_PER_BAR, type Section } from '../src/types/song';

function createSection(overrides: Partial<Section> = {}): Section {
  return {
    id: 'sec-v1',
    type: 'Verse',
    name: 'Aメロ',
    bars: 2,
    energy: 'Mid',
    kickMode: 'acoustic',
    chords: createUniformChordTimeline(['Em', 'C'], 2),
    ...overrides,
  };
}

describe('vocalEngine', () => {
  it('guarantees strict monophonic non-overlapping notes within vocal range across all presets', () => {
    const allPresetIds = PATTERN_PRESET_GROUPS.vocal.flatMap((g) =>
      g.options.map((o) => o.value)
    );
    const section = createSection({ bars: 2 });
    const sectionEnd = section.bars * TICKS_PER_BAR;

    for (const preset of allPresetIds) {
      const song = createDefaultSongConfig('rockBand');
      song.members.vocal.patternPreset = preset;

      for (const style of ['A', 'B', 'C'] as const) {
        const notes = generateVocalNotes({
          song,
          section,
          sectionIndex: 0,
          style,
          seed: 123,
          params: resolveInstrumentParams(song, section, 'vocal', style),
        });

        expect(notes.length).toBeGreaterThan(0);
        for (let i = 0; i < notes.length; i++) {
          const curr = notes[i];
          expect(curr.pitch).toBeGreaterThanOrEqual(VOCAL_MIN_PITCH);
          expect(curr.pitch).toBeLessThanOrEqual(VOCAL_MAX_PITCH);
          expect(curr.startTick).toBeGreaterThanOrEqual(0);
          expect(curr.startTick).toBeLessThan(sectionEnd);
          expect(curr.startTick + curr.durationTicks).toBeLessThanOrEqual(sectionEnd);
          if (i + 1 < notes.length) {
            expect(curr.startTick).toBeLessThan(notes[i + 1].startTick);
            expect(curr.startTick + curr.durationTicks).toBeLessThanOrEqual(
              notes[i + 1].startTick
            );
          }
        }
      }
    }
  });

  it('produces tight narrow-interval rhythmic pushes for rap presets and varies with seeds/takes', () => {
    const runRap = (preset: string, style: 'A' | 'B' | 'C', seed: number) => {
      const song = createDefaultSongConfig('rockBand');
      song.members.vocal.patternPreset = preset;
      const section = createSection({ bars: 2 });
      return generateVocalNotes({
        song,
        section,
        sectionIndex: 0,
        style,
        seed,
        params: resolveInstrumentParams(song, section, 'vocal', style),
      });
    };

    const rap16A = runRap('rap_16th_push', 'A', 11);
    const rap16C = runRap('rap_16th_push', 'C', 99);
    expect(rap16A.every((n) => n.startTick % 120 === 0)).toBe(true);
    expect(rap16A.length).toBeGreaterThanOrEqual(12);
    const pitches16 = rap16A.map((n) => n.pitch);
    expect(Math.max(...pitches16) - Math.min(...pitches16)).toBeLessThanOrEqual(9);
    expect(rap16A).not.toEqual(rap16C);

    const rapTriplet = runRap('rap_triplet_trap', 'A', 22);
    expect(rapTriplet.every((n) => n.startTick % 160 === 0)).toBe(true);

    const rapNuMetal = runRap('rap_nu_metal', 'A', 33);
    expect(
      rapNuMetal.some((n) => n.startTick % 1920 === 360 || n.startTick % 1920 === 840)
    ).toBe(true);

    const rapMonotone = runRap('rap_monotone_chant', 'A', 44);
    const uniquePitches = new Set(rapMonotone.map((n) => n.pitch));
    expect(uniquePitches.size).toBeLessThanOrEqual(2);
  });

  it('prioritizes custom section.vocalMelody and expands it across section bars', () => {
    const song = createDefaultSongConfig('rockBand');
    song.members.vocal.patternPreset = 'rap_monotone_chant';
    const section = createSection({
      bars: 2,
      vocalMelody: {
        sourceLabel: 'Hum Take 1',
        bars: 1,
        notes: [
          { pitch: 60, velocity: 100, startTick: 0, durationTicks: 480 },
          { pitch: 64, velocity: 105, startTick: 960, durationTicks: 480 },
        ],
      },
    });

    const notes = generateVocalNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 7,
      params: resolveInstrumentParams(song, section, 'vocal', 'A'),
    });

    expect(notes.length).toBe(4);
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 60, 64]);
    expect(notes.map((n) => n.startTick)).toEqual([0, 960, 1920, 2880]);
  });

  it('returns empty array when global vocal disabled or section enabledParts.vocal is false', () => {
    const song = createDefaultSongConfig('rockBand');
    const secDisabled = createSection({
      enabledParts: {
        drums: true,
        bass: true,
        keyboard: true,
        pad: true,
        vocal: false,
      },
    });
    expect(
      generateVocalNotes({
        song,
        section: secDisabled,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, secDisabled, 'vocal', 'A'),
      })
    ).toEqual([]);

    song.members.vocal.enabled = false;
    const secEnabled = createSection();
    expect(
      generateVocalNotes({
        song,
        section: secEnabled,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, secEnabled, 'vocal', 'A'),
      })
    ).toEqual([]);
  });

  it('snaps hummed notes into MIDI 48..76 and active Key/Scale via processVocalMelody', () => {
    const scalePcs = new Set(getScalePitchClasses('E', 'Minor'));
    const snapped = snapPitchToScale(65, 'E', 'Minor', 48, 76);
    expect(scalePcs.has(snapped % 12)).toBe(true);

    const processed = processVocalMelody(
      [
        { pitch: 65, startTick: 0, durationTicks: 240, velocity: 100 },
        { pitch: 61, startTick: 480, durationTicks: 240, velocity: 100 },
      ],
      {
        bpm: 120,
        bars: 1,
        key: 'E',
        scale: 'Minor',
        grid: 'straight16',
        snapToScale: true,
      }
    );

    expect(processed.cleanedVocalNotes.length).toBe(2);
    expect(
      processed.cleanedVocalNotes.every(
        (n) => n.pitch >= 48 && n.pitch <= 76 && scalePcs.has(n.pitch % 12)
      )
    ).toBe(true);
  });

  it('keeps 100% of generated notes strictly inside Key/Scale across all presets and scales', () => {
    const allPresetIds = PATTERN_PRESET_GROUPS.vocal.flatMap((g) =>
      g.options.map((o) => o.value)
    );
    const keyScales: Array<{ key: 'C' | 'E' | 'F#'; scale: 'Major' | 'Minor' }> = [
      { key: 'C', scale: 'Major' },
      { key: 'E', scale: 'Minor' },
      { key: 'F#', scale: 'Minor' },
    ];

    for (const { key, scale } of keyScales) {
      const allowedPcs = new Set(getScalePitchClasses(key, scale));
      const song = createDefaultSongConfig('rockBand');
      song.key = key;
      song.scale = scale;
      const section = createSection({ bars: 4, chords: [] });

      for (const preset of allPresetIds) {
        song.members.vocal.patternPreset = preset;
        const notes = generateVocalNotes({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed: 314,
          params: resolveInstrumentParams(song, section, 'vocal', 'A'),
        });
        expect(notes.length).toBeGreaterThan(0);
        for (const n of notes) {
          expect(allowedPcs.has(n.pitch % 12)).toBe(true);
        }
      }
    }
  });

  it('prevents octave-leap jumps when transitioning from low/rap section to High Energy melody', () => {
    const song = createDefaultSongConfig('rockBand');
    song.members.vocal.patternPreset = 'rap_16th_push';
    song.sections = [
      createSection({ id: 'sec-rap', type: 'Verse', bars: 2, energy: 'Mid' }),
      createSection({ id: 'sec-chorus', type: 'Chorus', bars: 2, energy: 'High' }),
    ];

    const rapState = generateAllSections(song, undefined, 777, false);
    const rapNotes = rapState.cellsBySection['sec-rap'].vocal.takes.A;
    const rapAvg =
      rapNotes.reduce((sum, n) => sum + n.pitch, 0) / Math.max(1, rapNotes.length);

    song.members.vocal.patternPreset = 'melody_soar_long';
    const chorusSection = song.sections[1];
    const chorusNotes = generateVocalNotes({
      song,
      section: chorusSection,
      sectionIndex: 1,
      style: 'A',
      seed: 888,
      prevVocalAvgPitch: rapAvg,
      params: resolveInstrumentParams(song, chorusSection, 'vocal', 'A'),
    });
    const chorusAvg =
      chorusNotes.reduce((sum, n) => sum + n.pitch, 0) /
      Math.max(1, chorusNotes.length);

    expect(chorusAvg - rapAvg).toBeLessThanOrEqual(7.5);
    expect(chorusAvg).toBeGreaterThanOrEqual(rapAvg - 2);
  });

  it('scales note count and sustain length clearly between vocalDensity 1 and 5', () => {
    const song = createDefaultSongConfig('rockBand');
    song.members.vocal.patternPreset = 'melody_pop';

    const secLow = createSection({ bars: 4, vocalDensity: 1 });
    const secHigh = createSection({ bars: 4, vocalDensity: 5 });

    const lowNotes = generateVocalNotes({
      song,
      section: secLow,
      sectionIndex: 0,
      style: 'A',
      seed: 55,
      params: resolveInstrumentParams(song, secLow, 'vocal', 'A'),
    });
    const highNotes = generateVocalNotes({
      song,
      section: secHigh,
      sectionIndex: 0,
      style: 'A',
      seed: 55,
      params: resolveInstrumentParams(song, secHigh, 'vocal', 'A'),
    });

    const avgDur = (arr: typeof lowNotes) =>
      arr.reduce((s, n) => s + n.durationTicks, 0) / Math.max(1, arr.length);

    expect(highNotes.length).toBeGreaterThan(lowNotes.length * 2);
    expect(avgDur(lowNotes)).toBeGreaterThan(avgDur(highNotes) * 2);
  });

  it('generates diatonic upper_3rd, lower_3rd, upper_5th, octave_up, and octave_down harmony with ~82% velocity', () => {
    const melody = [
      { pitch: 64, velocity: 100, startTick: 0, durationTicks: 480 },
      { pitch: 67, velocity: 110, startTick: 480, durationTicks: 240 },
      { pitch: 76, velocity: 90, startTick: 960, durationTicks: 480 },
    ];
    const cMajorPcs = new Set(getScalePitchClasses('C', 'Major'));

    expect(generateVocalHarmonyNotes(melody, 'C', 'Major', 'off')).toEqual([]);

    const up3 = generateVocalHarmonyNotes(melody, 'C', 'Major', 'upper_3rd');
    expect(up3.map((n) => n.pitch)).toEqual([67, 71, 79]);
    expect(up3.map((n) => n.startTick)).toEqual([0, 480, 960]);
    expect(up3.map((n) => n.durationTicks)).toEqual([480, 240, 480]);
    expect(up3.map((n) => n.velocity)).toEqual([82, 90, 74]);
    expect(up3.every((n) => cMajorPcs.has(n.pitch % 12))).toBe(true);

    const low3 = generateVocalHarmonyNotes(melody, 'C', 'Major', 'lower_3rd');
    expect(low3.map((n) => n.pitch)).toEqual([60, 64, 72]);
    expect(low3.every((n) => cMajorPcs.has(n.pitch % 12))).toBe(true);

    const up5 = generateVocalHarmonyNotes(melody, 'C', 'Major', 'upper_5th');
    expect(up5.map((n) => n.pitch)).toEqual([71, 74, 83]);
    expect(up5.every((n) => cMajorPcs.has(n.pitch % 12))).toBe(true);

    const octUp = generateVocalHarmonyNotes(melody, 'C', 'Major', 'octave_up');
    expect(octUp.map((n) => n.pitch)).toEqual([76, 79, 88]);

    const octDown = generateVocalHarmonyNotes(melody, 'C', 'Major', 'octave_down');
    expect(octDown.map((n) => n.pitch)).toEqual([52, 55, 64]);
  });

  it('keeps all preset labels concise (<= 20 chars) and assigned a group across all instruments', () => {
    for (const groups of Object.values(PATTERN_PRESET_GROUPS)) {
      for (const grp of groups) {
        for (const opt of grp.options) {
          expect(opt.group).toBe(grp.category);
          expect(opt.label.length).toBeLessThanOrEqual(20);
        }
      }
    }
    const vocalGroups = PATTERN_PRESET_GROUPS.vocal;
    expect(vocalGroups.length).toBeGreaterThanOrEqual(3);
    for (const grp of vocalGroups) {
      for (const opt of grp.options) {
        if (opt.value !== 'auto') {
          expect(opt.label.length).toBeLessThanOrEqual(15);
        }
      }
    }
  });

  it('maps legacy presets & MasterGenreIds cleanly onto the 5 Rhythm-First profiles and enforces A->A\' hook repetition', () => {
    expect(Object.keys(RHYTHM_FIRST_GENRE_PROFILES).sort()).toEqual([
      'alt_shoegaze',
      'chill_ballad',
      'emo_jrock',
      'numetal_mixture',
      'royal_jpop',
    ]);
    expect(Object.keys(MELODY_STYLE_PROFILES).sort()).toEqual([
      'alt_hypnotic',
      'deftones_float',
      'jpop_anthem',
      'jrock_drive',
      'linkin_hybrid',
      'posthc_leap',
      'rap_mixture_flow',
    ]);

    expect(resolveMasterGenreForVocal('melody_deftones_float')).toBe('alt_shoegaze');
    expect(resolveMasterGenreForVocal('melody_jrock_drive')).toBe('emo_jrock');
    expect(resolveMasterGenreForVocal('rap_linkin_hybrid')).toBe('numetal_mixture');
    expect(resolveMasterGenreForVocal('melody_jpop_anthem')).toBe('royal_jpop');
    expect(resolveMasterGenreForVocal('melody_ballad')).toBe('chill_ballad');

    const role = normalizeSectionRole('Chorus', 'High');
    const mod = resolveSectionDynamicsModifier(role, 'High', 'サビ', mulberry32(1));
    const plans = buildChapterPlans(8, 'dip_arch', mod);
    expect(plans.length).toBe(4);
    expect(plans[1].sourceChapterIndex).toBe(0);

    const song = createDefaultSongConfig('royal_jpop');
    const sec = createSection({
      bars: 8,
      type: 'Chorus',
      energy: 'High',
      vocalDensity: 3,
      chords: shiftChordBoundary(
        createUniformChordTimeline(['C', 'F#dim7', 'Fm7', 'Bb7'], 8),
        1,
        -0.5
      ),
    });
    const res = generateRhythmFirstVocal({
      song,
      section: sec,
      sectionIndex: 0,
      style: 'A',
      seed: 2026,
      params: resolveInstrumentParams(song, sec, 'vocal', 'A'),
    });

    const p0 = res.notes
      .filter((n) => n.startTick < PHRASE_2BAR_TICKS)
      .map((n) => n.startTick);
    const p1 = res.notes
      .filter(
        (n) =>
          n.startTick >= PHRASE_2BAR_TICKS && n.startTick < 2 * PHRASE_2BAR_TICKS
      )
      .map((n) => n.startTick - PHRASE_2BAR_TICKS);
    expect(p1).toEqual(p0);

    // VoiSona clean adapter eliminates micro-gaps < 180 ticks and strips falls
    const clean = adaptNotesForExportTarget(res.notes, 'voisona_clean_smf');
    expect(clean.pitchBends).toEqual([]);
    expect(clean.notes.every((n) => !n.hasFall && n.gateDuration >= 120)).toBe(true);
  });

  it('implements tempo-dependent pitch strategy for rap_mixture_flow and zero Math.random() across all styles', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      const fastSong = createDefaultSongConfig('rockBand');
      fastSong.bpm = 136;
      fastSong.key = 'E';
      fastSong.scale = 'Minor';
      fastSong.members.vocal.patternPreset = 'rap_mixture_flow';

      const slowSong = createDefaultSongConfig('rockBand');
      slowSong.bpm = 92;
      slowSong.key = 'E';
      slowSong.scale = 'Minor';
      slowSong.members.vocal.patternPreset = 'rap_mixture_flow';

      const sec = createSection({
        bars: 4,
        type: 'Verse',
        energy: 'Mid',
        vocalDensity: 3.5,
        chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
      });

      const fastNotes = generateVocalNotes({
        song: fastSong,
        section: sec,
        sectionIndex: 0,
        style: 'A',
        seed: 10,
        params: resolveInstrumentParams(fastSong, sec, 'vocal', 'A'),
      });
      const slowNotes = generateVocalNotes({
        song: slowSong,
        section: sec,
        sectionIndex: 0,
        style: 'A',
        seed: 10,
        params: resolveInstrumentParams(slowSong, sec, 'vocal', 'A'),
      });

      expect(new Set(fastNotes.map((n) => n.pitch)).size).toBeLessThanOrEqual(3);
      expect(new Set(slowNotes.map((n) => n.pitch)).size).toBeGreaterThanOrEqual(2);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
