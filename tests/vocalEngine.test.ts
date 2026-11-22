import { describe, expect, it } from 'vitest';
import {
  generateVocalHarmonyNotes,
  generateVocalNotes,
  MELODY_STYLE_PROFILES,
  VOCAL_MAX_PITCH,
  VOCAL_MIN_PITCH,
} from '../src/engines/vocalEngine';
import { createDefaultSongConfig, generateAllSections } from '../src/lib/bandState';
import {
  createUniformChordTimeline,
  shiftChordBoundary,
} from '../src/lib/chordTimeline';
import {
  getScalePitchClasses,
  parseChord,
  snapPitchToScale,
} from '../src/lib/chordUtils';
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
    expect(rapNuMetal.some((n) => n.startTick % 1920 === 360 || n.startTick % 1920 === 840)).toBe(
      true
    );

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
    const snapped = snapPitchToScale(65, 'E', 'Minor', 48, 76); // F4 -> E4 (64) or F#4 (66)
    expect(scalePcs.has(snapped % 12)).toBe(true);

    const processed = processVocalMelody(
      [
        { pitch: 65, startTick: 0, durationTicks: 240, velocity: 100 }, // F4 (off-scale in E Minor)
        { pitch: 61, startTick: 480, durationTicks: 240, velocity: 100 }, // C#4 (off-scale in E Minor)
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

    // Generate Rap in section 0, then transition into Chorus Melody with prevVocalAvgPitch
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

    // Center pitch moves up smoothly without jumping +12
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

  it('differentiates gate times and phrasing across soar_long, staccato_rock, call_response, and new rap presets', () => {
    const run = (preset: string, bars = 4) => {
      const song = createDefaultSongConfig('rockBand');
      song.members.vocal.patternPreset = preset;
      const section = createSection({
        bars,
        chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], bars),
      });
      return generateVocalNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 42,
        params: resolveInstrumentParams(song, section, 'vocal', 'A'),
      });
    };

    const soar = run('melody_soar_long', 4);
    const staccato = run('melody_staccato_rock', 4);
    // Bar 2 (index 1) of soar has sustained >= 1400 tick note (~95%+ of bar)
    const bar2SoarMax = Math.max(
      ...soar
        .filter((n) => n.startTick >= TICKS_PER_BAR && n.startTick < 2 * TICKS_PER_BAR)
        .map((n) => n.durationTicks)
    );
    expect(bar2SoarMax).toBeGreaterThanOrEqual(1400);

    // Staccato rock stays short (<= 240 ticks, 40..55% gate)
    const staccatoAvg =
      staccato.reduce((s, n) => s + n.durationTicks, 0) / staccato.length;
    expect(staccatoAvg).toBeLessThanOrEqual(230);
    expect(Math.max(...staccato.map((n) => n.durationTicks))).toBeLessThanOrEqual(240);

    // Call & response: bars 0..1 active vs bars 2..3 mostly rest
    const callResp = run('melody_call_response', 4);
    const callCount = callResp.filter((n) => n.startTick < 2 * TICKS_PER_BAR).length;
    const respCount = callResp.filter((n) => n.startTick >= 2 * TICKS_PER_BAR).length;
    expect(callCount).toBeGreaterThan(respCount * 2);

    // Syncopated hook hits offbeat anticipations (e.g., 360 / 1200 / 1560)
    const syncHook = run('melody_syncopated_hook', 2);
    expect(syncHook.some((n) => n.startTick % 480 === 360 || n.startTick % 480 === 120)).toBe(
      true
    );

    // New rap presets produce distinct phrasing (hook_chant repeats 2-bar motif)
    const laidback = run('rap_laidback_groove', 2);
    expect(laidback.some((n) => n.startTick % 480 === 240)).toBe(true);

    const doubleTime = run('rap_double_time', 2);
    expect(doubleTime.filter((n) => n.durationTicks <= 120).length).toBeGreaterThanOrEqual(
      12
    );

    const hookChant = run('rap_hook_chant', 4);
    const cycle1Local = hookChant
      .filter((n) => n.startTick < 2 * TICKS_PER_BAR)
      .map((n) => n.startTick);
    const cycle2Local = hookChant
      .filter((n) => n.startTick >= 2 * TICKS_PER_BAR)
      .map((n) => n.startTick - 2 * TICKS_PER_BAR);
    expect(cycle2Local).toEqual(cycle1Local);
  });

  it('supports all 10 new melody/rap presets with strict monophony, density scaling, and distinct phrasing', () => {
    const newPresets = [
      'melody_alt_soar',
      'melody_grunge_drag',
      'melody_britpop_catchy',
      'melody_metalcore_chorus',
      'melody_emo_screamo',
      'rap_jhiphop_bounce',
      'rap_mixture_melodic',
      'rap_hybrid_soar',
      'rap_cinematic_burst',
      'rap_emo_sparse',
    ] as const;

    for (const preset of newPresets) {
      const song = createDefaultSongConfig('rockBand');
      song.members.vocal.patternPreset = preset;
      const sparse = generateVocalNotes({
        song,
        section: createSection({ bars: 2, vocalDensity: 1 }),
        sectionIndex: 0,
        style: 'A',
        seed: 77,
        params: resolveInstrumentParams(song, createSection({ bars: 2, vocalDensity: 1 }), 'vocal', 'A'),
      });
      const dense = generateVocalNotes({
        song,
        section: createSection({ bars: 2, vocalDensity: 5 }),
        sectionIndex: 0,
        style: 'A',
        seed: 77,
        params: resolveInstrumentParams(song, createSection({ bars: 2, vocalDensity: 5 }), 'vocal', 'A'),
      });
      expect(sparse.length).toBeGreaterThan(0);
      expect(dense.length).toBeGreaterThanOrEqual(sparse.length);

      // Strict monophony (no overlapping start+duration)
      for (let i = 1; i < dense.length; i++) {
        expect(dense[i - 1].startTick + dense[i - 1].durationTicks).toBeLessThanOrEqual(
          dense[i].startTick
        );
      }
    }

    // rap_cinematic_burst keeps beat 4 empty per bar for dramatic tension
    const burstSong = createDefaultSongConfig('rockBand');
    burstSong.members.vocal.patternPreset = 'rap_cinematic_burst';
    const burstNotes = generateVocalNotes({
      song: burstSong,
      section: createSection({ bars: 2, vocalDensity: 3 }),
      sectionIndex: 0,
      style: 'A',
      seed: 12,
      params: resolveInstrumentParams(burstSong, createSection({ bars: 2, vocalDensity: 3 }), 'vocal', 'A'),
    });
    expect(burstNotes.some((n) => n.startTick % TICKS_PER_BAR >= 1440)).toBe(false);

    // rap_hybrid_soar ends each bar with a long sustained singing note at beat 3 (tick 960)
    const hybridSong = createDefaultSongConfig('rockBand');
    hybridSong.members.vocal.patternPreset = 'rap_hybrid_soar';
    const hybridNotes = generateVocalNotes({
      song: hybridSong,
      section: createSection({ bars: 2, vocalDensity: 3 }),
      sectionIndex: 0,
      style: 'A',
      seed: 12,
      params: resolveInstrumentParams(hybridSong, createSection({ bars: 2, vocalDensity: 3 }), 'vocal', 'A'),
    });
    expect(
      hybridNotes.some((n) => n.startTick % TICKS_PER_BAR === 960 && n.durationTicks >= 700)
    ).toBe(true);
  });

  it('generates diatonic upper_3rd, lower_3rd, upper_5th, octave_up, and octave_down harmony with ~82% velocity', () => {
    // C Major: E4 (64), G4 (67), E5 (76)
    const melody = [
      { pitch: 64, velocity: 100, startTick: 0, durationTicks: 480 },
      { pitch: 67, velocity: 110, startTick: 480, durationTicks: 240 },
      { pitch: 76, velocity: 90, startTick: 960, durationTicks: 480 },
    ];
    const cMajorPcs = new Set(getScalePitchClasses('C', 'Major'));

    expect(generateVocalHarmonyNotes(melody, 'C', 'Major', 'off')).toEqual([]);

    const up3 = generateVocalHarmonyNotes(melody, 'C', 'Major', 'upper_3rd');
    expect(up3.map((n) => n.pitch)).toEqual([67, 71, 79]); // E->G, G->B, E5->G5
    expect(up3.map((n) => n.startTick)).toEqual([0, 480, 960]);
    expect(up3.map((n) => n.durationTicks)).toEqual([480, 240, 480]);
    expect(up3.map((n) => n.velocity)).toEqual([82, 90, 74]);
    expect(up3.every((n) => cMajorPcs.has(n.pitch % 12))).toBe(true);

    const low3 = generateVocalHarmonyNotes(melody, 'C', 'Major', 'lower_3rd');
    expect(low3.map((n) => n.pitch)).toEqual([60, 64, 72]); // E->C, G->E, E5->C5
    expect(low3.every((n) => cMajorPcs.has(n.pitch % 12))).toBe(true);

    const up5 = generateVocalHarmonyNotes(melody, 'C', 'Major', 'upper_5th');
    expect(up5.map((n) => n.pitch)).toEqual([71, 74, 83]); // +4 diatonic steps: E->B, G->D, E5->B5
    expect(up5.every((n) => cMajorPcs.has(n.pitch % 12))).toBe(true);
    expect(up5.every((n, i) => n.velocity < melody[i].velocity && n.velocity >= 45)).toBe(true);

    const octUp = generateVocalHarmonyNotes(melody, 'C', 'Major', 'octave_up');
    expect(octUp.map((n) => n.pitch)).toEqual([76, 79, 88]); // +12 capped <= 88

    const octDown = generateVocalHarmonyNotes(melody, 'C', 'Major', 'octave_down');
    expect(octDown.map((n) => n.pitch)).toEqual([52, 55, 64]); // -12 kept >= 40
    expect(octDown.every((n) => n.pitch >= 40)).toBe(true);
  });

  it('produces predominantly stepwise/repeated arch contours with Gap-Fill descent after climax leaps across melody presets', () => {
    const scalePcs = new Set(getScalePitchClasses('E', 'Minor'));
    const fullScaleGrid: number[] = [];
    for (let p = VOCAL_MIN_PITCH; p <= VOCAL_MAX_PITCH; p++) {
      if (scalePcs.has(p % 12)) fullScaleGrid.push(p);
    }
    const eMinorPentPcs = new Set([4, 7, 9, 11, 2]); // E, G, A, B, D
    const pentGrid: number[] = [];
    for (let p = VOCAL_MIN_PITCH; p <= VOCAL_MAX_PITCH; p++) {
      if (eMinorPentPcs.has(p % 12)) pentGrid.push(p);
    }

    const melodyPresets = [
      'melody_pop',
      'melody_soar_long',
      'melody_syncopated_hook',
      'melody_ballad',
      'melody_alt_minor',
      'melody_alt_soar',
      'melody_grunge_drag',
      'melody_britpop_catchy',
      'melody_metalcore_chorus',
      'melody_emo_screamo',
    ];

    for (const preset of melodyPresets) {
      const activeGrid =
        preset === 'melody_alt_minor' || preset === 'melody_britpop_catchy'
          ? pentGrid
          : fullScaleGrid;
      const song = createDefaultSongConfig('rockBand');
      song.members.vocal.patternPreset = preset;
      const section = createSection({
        bars: 4,
        vocalDensity: 3,
        chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
      });
      const notes = generateVocalNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 2026,
        params: resolveInstrumentParams(song, section, 'vocal', 'A'),
      });

      // Strict 100% scale conformance & monophonic non-overlap check
      for (let i = 0; i < notes.length; i++) {
        expect(scalePcs.has(notes[i].pitch % 12)).toBe(true);
        if (i > 0) {
          expect(notes[i - 1].startTick + notes[i - 1].durationTicks).toBeLessThanOrEqual(
            notes[i].startTick
          );
        }
      }

      let stepwiseOrRepeatCount = 0;
      let totalTransitions = 0;
      const stepDiffs: number[] = [];
      for (let i = 1; i < notes.length; i++) {
        const prevIdx = activeGrid.indexOf(notes[i - 1].pitch);
        const currIdx = activeGrid.indexOf(notes[i].pitch);
        const diff = currIdx - prevIdx;
        stepDiffs.push(diff);
        totalTransitions++;
        if (Math.abs(diff) <= 2) {
          stepwiseOrRepeatCount++;
        }
      }

      // >= 65% of intervals must be smooth stepwise (<= 2 scale steps) or same-note lyric repetition
      expect(stepwiseOrRepeatCount).toBeGreaterThanOrEqual(totalTransitions * 0.65);

      // Gap-Fill invariant: after any large upward leap (>= +3), immediately resolve downward (-1..-2 steps)
      for (let i = 0; i + 1 < stepDiffs.length; i++) {
        if (stepDiffs[i] >= 3) {
          expect(stepDiffs[i + 1]).toBeLessThan(0);
          expect(stepDiffs[i + 1]).toBeGreaterThanOrEqual(-2);
        }
        const extremeZigzag =
          (stepDiffs[i] >= 3 && stepDiffs[i + 1] <= -3) ||
          (stepDiffs[i] <= -3 && stepDiffs[i + 1] >= 3);
        expect(extremeZigzag).toBe(false);
      }
    }
  });

  it('includes inter-phrase breath rests and >= 960-tick sustained long tones with A->A\' motif repetition over 4 bars', () => {
    const sustainedMelodyPresets = [
      'melody_pop',
      'melody_soar_long',
      'melody_syncopated_hook',
      'melody_ballad',
      'melody_alt_soar',
      'melody_grunge_drag',
      'melody_britpop_catchy',
      'melody_metalcore_chorus',
      'melody_emo_screamo',
    ];

    for (const preset of sustainedMelodyPresets) {
      const song = createDefaultSongConfig('rockBand');
      song.members.vocal.patternPreset = preset;
      const section = createSection({
        bars: 4,
        vocalDensity: 3,
        chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
      });
      const notes = generateVocalNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 99,
        params: resolveInstrumentParams(song, section, 'vocal', 'A'),
      });

      // Has sustained long tone (>= 960 ticks)
      expect(notes.some((n) => n.durationTicks >= 960)).toBe(true);

      // Has breath rest gap (>= 240 ticks) between notes or before barline phrase break
      let hasBreathRest = false;
      for (let i = 0; i + 1 < notes.length; i++) {
        const gap = notes[i + 1].startTick - (notes[i].startTick + notes[i].durationTicks);
        if (gap >= 240) {
          hasBreathRest = true;
          break;
        }
      }
      expect(hasBreathRest).toBe(true);
    }

    // Check A -> A' rhythm skeleton inheritance between bar 0 and bar 2
    const popSong = createDefaultSongConfig('rockBand');
    popSong.members.vocal.patternPreset = 'melody_pop';
    const popSec = createSection({
      bars: 4,
      vocalDensity: 3,
      chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
    });
    const popNotes = generateVocalNotes({
      song: popSong,
      section: popSec,
      sectionIndex: 0,
      style: 'A',
      seed: 42,
      params: resolveInstrumentParams(popSong, popSec, 'vocal', 'A'),
    });
    const bar0Onsets = popNotes
      .filter((n) => n.startTick < TICKS_PER_BAR)
      .map((n) => n.startTick);
    const bar2Onsets = popNotes
      .filter((n) => n.startTick >= 2 * TICKS_PER_BAR && n.startTick < 3 * TICKS_PER_BAR)
      .map((n) => n.startTick - 2 * TICKS_PER_BAR);
    expect(bar2Onsets).toEqual(bar0Onsets);
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
    // Vocal non-auto presets keep compact <= 15 char mobile-friendly labels across 3 categories
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

  it('varies articulation, contour, entry timing, and rap flow across different regenerate seeds', () => {
    const runSeed = (preset: string, seed: number) => {
      const song = createDefaultSongConfig('rockBand');
      song.members.vocal.patternPreset = preset;
      const section = createSection({
        bars: 4,
        vocalDensity: 3,
        chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
      });
      return generateVocalNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed,
        params: resolveInstrumentParams(song, section, 'vocal', 'A'),
      });
    };

    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const popSignatures = new Set(
      seeds.map((s) =>
        runSeed('melody_pop', s)
          .map((n) => `${n.startTick}:${n.durationTicks}:${n.pitch}`)
          .join('|')
      )
    );
    expect(popSignatures.size).toBeGreaterThanOrEqual(4);

    // Entry timings vary across seeds (on-beat 0, pickup/syncopated, or after-rest)
    const popFirstTicks = new Set(seeds.map((s) => runSeed('melody_pop', s)[0]?.startTick ?? -1));
    expect(popFirstTicks.size).toBeGreaterThanOrEqual(2);

    const rapSignatures = new Set(
      seeds.map((s) =>
        runSeed('rap_16th_push', s)
          .map((n) => `${n.startTick}:${n.durationTicks}:${n.pitch}`)
          .join('|')
      )
    );
    expect(rapSignatures.size).toBeGreaterThanOrEqual(4);
  });

  it('supports the 7 new expressive melody and rap presets with strict Key/Scale and monophony', () => {
    const song = createDefaultSongConfig('rockBand');
    song.key = 'E';
    song.scale = 'Minor';
    const scalePcs = new Set(getScalePitchClasses('E', 'Minor'));

    const newPresets = [
      'melody_shoegaze_float',
      'melody_staccato_chop',
      'melody_anthem_climb',
      'melody_ballad_breath',
      'rap_stop_and_go',
      'rap_triplet_bounce',
      'rap_spoken_tension',
    ];

    const byPreset: Record<string, ReturnType<typeof generateVocalNotes>> = {};
    for (const preset of newPresets) {
      song.members.vocal.patternPreset = preset;
      const section = createSection({
        bars: 4,
        vocalDensity: 3,
        chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
      });
      const notes = generateVocalNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 77,
        params: resolveInstrumentParams(song, section, 'vocal', 'A'),
      });
      byPreset[preset] = notes;
      expect(notes.length).toBeGreaterThan(0);

      for (let i = 0; i < notes.length; i++) {
        expect(scalePcs.has(notes[i].pitch % 12)).toBe(true);
        expect(notes[i].pitch).toBeGreaterThanOrEqual(VOCAL_MIN_PITCH);
        expect(notes[i].pitch).toBeLessThanOrEqual(VOCAL_MAX_PITCH);
        if (i > 0) {
          expect(notes[i - 1].startTick + notes[i - 1].durationTicks).toBeLessThanOrEqual(
            notes[i].startTick
          );
        }
      }
    }

    // shoegaze float: long sustained tones (>= 960) and upper register average pitch
    expect(byPreset.melody_shoegaze_float.some((n) => n.durationTicks >= 960)).toBe(true);
    const avgShoegaze =
      byPreset.melody_shoegaze_float.reduce((sum, n) => sum + n.pitch, 0) /
      byPreset.melody_shoegaze_float.length;
    expect(avgShoegaze).toBeGreaterThanOrEqual(66);

    // staccato chop & rap_stop_and_go: crisp short durations and deliberate silent break gaps
    expect(byPreset.melody_staccato_chop.some((n) => n.durationTicks <= 180)).toBe(true);
    const stopAndGo = byPreset.rap_stop_and_go;
    let maxGap = 0;
    for (let i = 0; i + 1 < stopAndGo.length; i++) {
      maxGap = Math.max(
        maxGap,
        stopAndGo[i + 1].startTick - (stopAndGo[i].startTick + stopAndGo[i].durationTicks)
      );
    }
    expect(maxGap).toBeGreaterThanOrEqual(480);

    // triplet bounce: hits 160-tick triplet subdivisions
    expect(
      byPreset.rap_triplet_bounce.some((n) => n.startTick % 480 === 160 || n.startTick % 480 === 320)
    ).toBe(true);
  });

  it('implements 6 analyzed MelodyStyleProfiles with 8-bar A->A\' motif repetition, final-2-bar climax, and strict scale/monophony', () => {
    expect(Object.keys(MELODY_STYLE_PROFILES).sort()).toEqual([
      'alt_hypnotic',
      'deftones_float',
      'jpop_anthem',
      'jrock_drive',
      'linkin_hybrid',
      'posthc_leap',
    ]);

    const song = createDefaultSongConfig('rockBand');
    song.key = 'E';
    song.scale = 'Minor';
    const scalePcs = new Set(getScalePitchClasses('E', 'Minor'));

    const sixPresets = [
      'melody_alt_hypnotic',
      'melody_deftones_float',
      'melody_posthc_leap',
      'melody_jrock_drive',
      'melody_jpop_anthem',
      'rap_linkin_hybrid',
    ];

    const outputs: Record<string, ReturnType<typeof generateVocalNotes>> = {};
    for (const preset of sixPresets) {
      song.members.vocal.patternPreset = preset;
      const section = createSection({
        bars: 8,
        energy: 'High',
        vocalDensity: 3,
        chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 8),
      });
      const notes = generateVocalNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 2026,
        params: resolveInstrumentParams(song, section, 'vocal', 'A'),
      });
      outputs[preset] = notes;
      expect(notes.length).toBeGreaterThan(0);

      // Strict Key/Scale 100% conformance & monophony across all 8 bars
      for (let i = 0; i < notes.length; i++) {
        expect(scalePcs.has(notes[i].pitch % 12)).toBe(true);
        expect(notes[i].pitch).toBeGreaterThanOrEqual(VOCAL_MIN_PITCH);
        expect(notes[i].pitch).toBeLessThanOrEqual(VOCAL_MAX_PITCH);
        if (i > 0) {
          expect(notes[i - 1].startTick + notes[i - 1].durationTicks).toBeLessThanOrEqual(
            notes[i].startTick
          );
        }
      }
    }

    // 1. 8-bar A -> A' organic motif variation: P2 (bars 5-6) inherits front 65-75% of P0 (bars 1-2) onsets
    for (const melodicPreset of [
      'melody_alt_hypnotic',
      'melody_deftones_float',
      'melody_posthc_leap',
      'melody_jrock_drive',
      'melody_jpop_anthem',
    ]) {
      const notes = outputs[melodicPreset];
      const block0 = notes
        .filter((n) => n.startTick < 2 * TICKS_PER_BAR)
        .map((n) => n.startTick);
      const block2 = notes
        .filter((n) => n.startTick >= 4 * TICKS_PER_BAR && n.startTick < 6 * TICKS_PER_BAR)
        .map((n) => n.startTick - 4 * TICKS_PER_BAR);
      const frontKeep = Math.max(2, Math.floor(block0.length * 0.6));
      expect(block2.slice(0, frontKeep)).toEqual(block0.slice(0, frontKeep));
    }

    // 2. melody_deftones_float: laidback offbeat entry (>= 240) + cross-bar long tone (>= 1200)
    const deftones = outputs.melody_deftones_float;
    expect(deftones[0].startTick).toBeGreaterThanOrEqual(240);
    expect(deftones.some((n) => n.durationTicks >= 1200)).toBe(true);
    const deftonesSpan =
      Math.max(...deftones.map((n) => n.pitch)) - Math.min(...deftones.map((n) => n.pitch));
    expect(deftonesSpan).toBeGreaterThanOrEqual(9);

    // 3. melody_posthc_leap: wide high-tone leap span (>= 10 semitones) + cross-bar sustain (>= 960)
    const posthc = outputs.melody_posthc_leap;
    expect(posthc[0].startTick).toBeGreaterThanOrEqual(240);
    const posthcSpan =
      Math.max(...posthc.map((n) => n.pitch)) - Math.min(...posthc.map((n) => n.pitch));
    expect(posthcSpan).toBeGreaterThanOrEqual(10);
    expect(posthc.some((n) => n.durationTicks >= 960)).toBe(true);

    // 4. melody_jrock_drive: beat 4-and pickup (1680) + stop rest (>= 360)
    const jrock = outputs.melody_jrock_drive;
    expect(jrock.some((n) => n.startTick % TICKS_PER_BAR === 1680)).toBe(true);

    // 5. melody_jpop_anthem: reaches highest climax pitch in bars 7-8 & resolves on final chord (D) Root/3rd with long tone
    const jpop = outputs.melody_jpop_anthem;
    const maxBars1To6 = Math.max(
      ...jpop.filter((n) => n.startTick < 6 * TICKS_PER_BAR).map((n) => n.pitch)
    );
    const maxBars7To8 = Math.max(
      ...jpop.filter((n) => n.startTick >= 6 * TICKS_PER_BAR).map((n) => n.pitch)
    );
    expect(maxBars7To8).toBeGreaterThanOrEqual(maxBars1To6);
    const lastJpop = jpop[jpop.length - 1];
    expect(lastJpop.durationTicks).toBeGreaterThanOrEqual(960);
    const finalD = parseChord('D'); // D(2), F#(6) or Key E Minor Tonic/3rd: E(4), G(7)
    const allowedResolvePcs = new Set([
      ...finalD.intervals
        .filter((iv) => iv === 0 || iv === 3 || iv === 4)
        .map((iv) => (finalD.rootSemitone + iv) % 12),
      4,
      7,
    ]);
    expect(allowedResolvePcs.has(lastJpop.pitch % 12)).toBe(true);

    // 6. rap_linkin_hybrid: crisp percussive burst (<= 240 at bpm=135 Tempo Guard, <= 120 at bpm=115) + dead-stop silent break (>= 720 ticks)
    const linkin = outputs.rap_linkin_hybrid;
    expect(linkin.some((n) => n.durationTicks <= 240)).toBe(true);
    let maxLinkinGap = 0;
    for (let i = 0; i + 1 < linkin.length; i++) {
      maxLinkinGap = Math.max(
        maxLinkinGap,
        linkin[i + 1].startTick - (linkin[i].startTick + linkin[i].durationTicks)
      );
    }
    expect(maxLinkinGap).toBeGreaterThanOrEqual(720);

    // At bpm <= 120, 16th-note (120-tick) burst cells are enabled
    const lpSlowSong = createDefaultSongConfig('rockBand');
    lpSlowSong.bpm = 115;
    lpSlowSong.members.vocal.patternPreset = 'rap_linkin_hybrid';
    const lpSlowSec = createSection({
      bars: 4,
      vocalDensity: 4,
      chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
    });
    const lpSlowNotes = generateVocalNotes({
      song: lpSlowSong,
      section: lpSlowSec,
      sectionIndex: 0,
      style: 'A',
      seed: 2026,
      params: resolveInstrumentParams(lpSlowSong, lpSlowSec, 'vocal', 'A'),
    });
    expect(lpSlowNotes.some((n) => n.durationTicks === 120)).toBe(true);
  });

  it('meets all Next-Gen musical quality metrics across 6 presets, densities (1,3,5), 4/8 bars, 10 seeds, and substitute/offbeat chords', () => {
    const presets = [
      'melody_alt_hypnotic',
      'melody_deftones_float',
      'melody_posthc_leap',
      'melody_jrock_drive',
      'melody_jpop_anthem',
      'rap_linkin_hybrid',
    ] as const;

    const scalePcs = new Set(getScalePitchClasses('C', 'Major'));
    const offbeatSubstituteTimeline4 = shiftChordBoundary(
      createUniformChordTimeline(['C', 'F#dim7', 'Fm7', 'Bb7'], 4),
      1,
      -0.5
    );
    const diatonic8 = createUniformChordTimeline(['C', 'G', 'Am', 'F'], 8);

    interface GenreStats {
      restRatios: number[];
      microGapCount: number;
      stepOrThirdCount: number;
      stepOnlyCount: number;
      totalIntraTransitions: number;
      leapCount: number;
      gapFillCount: number;
      tensionHits: number;
      totalNotes: number;
      unisonCount: number;
      anticipationOnsets: number;
    }

    const statsByPreset: Record<string, GenreStats> = {};
    for (const preset of presets) {
      statsByPreset[preset] = {
        restRatios: [],
        microGapCount: 0,
        stepOrThirdCount: 0,
        stepOnlyCount: 0,
        totalIntraTransitions: 0,
        leapCount: 0,
        gapFillCount: 0,
        tensionHits: 0,
        totalNotes: 0,
        unisonCount: 0,
        anticipationOnsets: 0,
      };
    }

    const densities: Array<1 | 3 | 5> = [1, 3, 5];
    const seeds = [11, 22, 33, 44, 55, 66, 77, 88, 99, 110];

    for (const preset of presets) {
      const st = statsByPreset[preset];
      for (const bars of [4, 8] as const) {
        for (const density of densities) {
          for (const seed of seeds) {
            const song = createDefaultSongConfig('rockBand');
            song.key = 'C';
            song.scale = 'Major';
            song.bpm = 118;
            song.members.vocal.patternPreset = preset;
            const section = createSection({
              bars,
              energy: preset === 'melody_deftones_float' ? 'Mid' : 'High',
              type: preset === 'rap_linkin_hybrid' ? 'Verse' : 'Chorus',
              vocalDensity: density,
              chords: bars === 4 ? offbeatSubstituteTimeline4 : diatonic8,
            });
            const sectionLen = bars * TICKS_PER_BAR;
            const params = resolveInstrumentParams(song, section, 'vocal', 'A');

            const notes = generateVocalNotes({
              song,
              section,
              sectionIndex: 0,
              style: 'A',
              seed,
              params,
              prevVocalAvgPitch: 61,
            });

            // Deterministic reproducibility check on first seed
            if (seed === seeds[0]) {
              const replay = generateVocalNotes({
                song,
                section,
                sectionIndex: 0,
                style: 'A',
                seed,
                params,
                prevVocalAvgPitch: 61,
              });
              expect(replay).toEqual(notes);

              // Harmony compatibility check
              const harm = generateVocalHarmonyNotes(notes, 'C', 'Major', 'upper_3rd');
              expect(harm.length).toBe(notes.length);
              expect(harm.every((h) => scalePcs.has(h.pitch % 12))).toBe(true);
            }

            expect(notes.length).toBeGreaterThan(0);

            // Hard constraints: monophonic, duration >= 120, bounds, Key/Scale 100%, span <= 18
            let sungTicks = 0;
            for (let i = 0; i < notes.length; i++) {
              const n = notes[i];
              expect(n.startTick).toBeGreaterThanOrEqual(0);
              expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(sectionLen);
              expect(n.durationTicks).toBeGreaterThanOrEqual(120);
              expect(scalePcs.has(n.pitch % 12)).toBe(true);
              sungTicks += n.durationTicks;

              const barTick = n.startTick % TICKS_PER_BAR;
              if (barTick === 720 || barTick === 1680) {
                st.anticipationOnsets += 1;
              }
              const pc = n.pitch % 12;
              if (pc === 2 || pc === 5 || pc === 11) {
                st.tensionHits += 1;
              }

              if (i > 0) {
                const prev = notes[i - 1];
                expect(prev.startTick + prev.durationTicks).toBeLessThanOrEqual(n.startTick);
                const gap = n.startTick - (prev.startTick + prev.durationTicks);
                if (gap >= 120 && gap < 240) {
                  st.microGapCount += 1;
                }
                const isSamePhrase = gap < 240;
                if (isSamePhrase) {
                  const delta = n.pitch - prev.pitch;
                  const absD = Math.abs(delta);
                  st.totalIntraTransitions += 1;
                  if (absD === 0) st.unisonCount += 1;
                  if (absD <= 4) st.stepOrThirdCount += 1;
                  if (absD <= 2) st.stepOnlyCount += 1;

                  if (absD >= 7 && i + 1 < notes.length) {
                    const next = notes[i + 1];
                    const nextGap = next.startTick - (n.startTick + n.durationTicks);
                    if (nextGap < 240) {
                      st.leapCount += 1;
                      const nextDelta = next.pitch - n.pitch;
                      const isOpposite =
                        (delta > 0 && nextDelta < 0) || (delta < 0 && nextDelta > 0);
                      if (isOpposite && Math.abs(nextDelta) <= 5) {
                        st.gapFillCount += 1;
                      }
                    }
                  }
                }
              }
            }

            const span =
              Math.max(...notes.map((n) => n.pitch)) - Math.min(...notes.map((n) => n.pitch));
            expect(span).toBeLessThanOrEqual(18);
            const avgPitch = notes.reduce((a, b) => a + b.pitch, 0) / notes.length;
            expect(avgPitch).toBeGreaterThanOrEqual(52);
            expect(avgPitch).toBeLessThanOrEqual(73);

            st.totalNotes += notes.length;
            st.restRatios.push(1 - sungTicks / sectionLen);
          }
        }
      }
    }

    const summary: Record<string, Record<string, string | number>> = {};
    for (const preset of presets) {
      const st = statsByPreset[preset];
      const avgRest =
        st.restRatios.reduce((a, b) => a + b, 0) / Math.max(1, st.restRatios.length);
      const stepOrThirdRate = st.stepOrThirdCount / Math.max(1, st.totalIntraTransitions);
      const stepOnlyRate = st.stepOnlyCount / Math.max(1, st.totalIntraTransitions);
      const gapFillRate = st.leapCount > 0 ? st.gapFillCount / st.leapCount : 1;

      summary[preset] = {
        avgRestPct: Number((avgRest * 100).toFixed(1)),
        microGaps: st.microGapCount,
        stepOrThirdPct: Number((stepOrThirdRate * 100).toFixed(1)),
        stepOnlyPct: Number((stepOnlyRate * 100).toFixed(1)),
        gapFillPct: Number((gapFillRate * 100).toFixed(1)),
        tensionPct: Number(((st.tensionHits / st.totalNotes) * 100).toFixed(1)),
        unisonPct: Number(((st.unisonCount / Math.max(1, st.totalIntraTransitions)) * 100).toFixed(1)),
        anticipationPct: Number(((st.anticipationOnsets / st.totalNotes) * 100).toFixed(1)),
      };

      expect(st.microGapCount).toBe(0);
      expect(avgRest).toBeGreaterThanOrEqual(0.12);
      expect(avgRest).toBeLessThanOrEqual(0.52);
      expect(stepOrThirdRate).toBeGreaterThanOrEqual(0.68);
      expect(stepOnlyRate).toBeGreaterThanOrEqual(0.55);
      if (st.leapCount > 0) {
        expect(gapFillRate).toBeGreaterThanOrEqual(0.7);
      }
    }

    // Genre differentiation assertions
    const avgRestOf = (p: string) =>
      statsByPreset[p].restRatios.reduce((a, b) => a + b, 0) /
      statsByPreset[p].restRatios.length;
    expect(avgRestOf('rap_linkin_hybrid')).toBeGreaterThan(avgRestOf('melody_jrock_drive'));
    expect(avgRestOf('rap_linkin_hybrid')).toBeGreaterThan(avgRestOf('melody_jpop_anthem'));

    const deftonesTensionRate =
      statsByPreset.melody_deftones_float.tensionHits /
      statsByPreset.melody_deftones_float.totalNotes;
    const jpopTensionRate =
      statsByPreset.melody_jpop_anthem.tensionHits /
      statsByPreset.melody_jpop_anthem.totalNotes;
    expect(deftonesTensionRate).toBeGreaterThan(jpopTensionRate);

    const lpUnisonRate =
      statsByPreset.rap_linkin_hybrid.unisonCount /
      Math.max(1, statsByPreset.rap_linkin_hybrid.totalIntraTransitions);
    const jpopUnisonRate =
      statsByPreset.melody_jpop_anthem.unisonCount /
      Math.max(1, statsByPreset.melody_jpop_anthem.totalIntraTransitions);
    expect(lpUnisonRate).toBeGreaterThan(jpopUnisonRate);

    const jrockAntRate =
      statsByPreset.melody_jrock_drive.anticipationOnsets /
      statsByPreset.melody_jrock_drive.totalNotes;
    const deftonesAntRate =
      statsByPreset.melody_deftones_float.anticipationOnsets /
      statsByPreset.melody_deftones_float.totalNotes;
    expect(jrockAntRate).toBeGreaterThan(deftonesAntRate);

    console.info('[Next-Gen Vocal Quality Metrics]', JSON.stringify(summary));
  });
});
