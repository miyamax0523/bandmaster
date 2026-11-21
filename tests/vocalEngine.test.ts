import { describe, expect, it } from 'vitest';
import {
  generateVocalHarmonyNotes,
  generateVocalNotes,
  VOCAL_MAX_PITCH,
  VOCAL_MIN_PITCH,
} from '../src/engines/vocalEngine';
import { createDefaultSongConfig, generateAllSections } from '../src/lib/bandState';
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
    chords: ['Em', 'C'],
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
      const section = createSection({ bars, chords: ['Em', 'C', 'G', 'D'] });
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

  it('generates diatonic upper_3rd, lower_3rd, and octave_up harmony with ~82% velocity', () => {
    // C Major: E4 (64), G4 (67), C5 (72), C6/higher edge test (76)
    const melody = [
      { pitch: 64, velocity: 100, startTick: 0, durationTicks: 480 },
      { pitch: 67, velocity: 110, startTick: 480, durationTicks: 240 },
      { pitch: 76, velocity: 90, startTick: 960, durationTicks: 480 },
    ];

    expect(generateVocalHarmonyNotes(melody, 'C', 'Major', 'off')).toEqual([]);

    const up3 = generateVocalHarmonyNotes(melody, 'C', 'Major', 'upper_3rd');
    expect(up3.map((n) => n.pitch)).toEqual([67, 71, 79]); // E->G, G->B, E5->G5
    expect(up3.map((n) => n.startTick)).toEqual([0, 480, 960]);
    expect(up3.map((n) => n.durationTicks)).toEqual([480, 240, 480]);
    expect(up3.map((n) => n.velocity)).toEqual([82, 90, 74]);

    const low3 = generateVocalHarmonyNotes(melody, 'C', 'Major', 'lower_3rd');
    expect(low3.map((n) => n.pitch)).toEqual([60, 64, 72]); // E->C, G->E, E5->C5

    const oct = generateVocalHarmonyNotes(melody, 'C', 'Major', 'octave_up');
    expect(oct.map((n) => n.pitch)).toEqual([76, 79, 88]); // capped at 88
  });

  it('produces predominantly stepwise arch contours without extreme zigzag jumps across melody presets', () => {
    const scalePcs = new Set(getScalePitchClasses('E', 'Minor'));
    const fullScaleGrid: number[] = [];
    for (let p = VOCAL_MIN_PITCH; p <= VOCAL_MAX_PITCH; p++) {
      if (scalePcs.has(p % 12)) fullScaleGrid.push(p);
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
      const song = createDefaultSongConfig('rockBand');
      song.members.vocal.patternPreset = preset;
      const section = createSection({
        bars: 4,
        vocalDensity: 3,
        chords: ['Em', 'C', 'G', 'D'],
      });
      const notes = generateVocalNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 2026,
        params: resolveInstrumentParams(song, section, 'vocal', 'A'),
      });

      let stepwiseCount = 0;
      let totalTransitions = 0;
      const stepDiffs: number[] = [];
      for (let i = 1; i < notes.length; i++) {
        const prevIdx = fullScaleGrid.indexOf(notes[i - 1].pitch);
        const currIdx = fullScaleGrid.indexOf(notes[i].pitch);
        const diff = currIdx - prevIdx;
        stepDiffs.push(diff);
        totalTransitions++;
        if (Math.abs(diff) <= 2) {
          stepwiseCount++;
        }
      }

      // Majority (> 50%) of intervals must be smooth stepwise (<= 2 scale steps)
      expect(stepwiseCount).toBeGreaterThan(totalTransitions * 0.5);

      // No consecutive extreme reverse zigzag leaps (>= +3 immediately followed by <= -3 or vice versa)
      for (let i = 1; i < stepDiffs.length; i++) {
        const extremeZigzag =
          (stepDiffs[i - 1] >= 3 && stepDiffs[i] <= -3) ||
          (stepDiffs[i - 1] <= -3 && stepDiffs[i] >= 3);
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
        chords: ['Em', 'C', 'G', 'D'],
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
    const popSec = createSection({ bars: 4, vocalDensity: 3, chords: ['Em', 'C', 'G', 'D'] });
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
  });
});
