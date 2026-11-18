import { describe, expect, it } from 'vitest';
import {
  generateVocalNotes,
  VOCAL_MAX_PITCH,
  VOCAL_MIN_PITCH,
} from '../src/engines/vocalEngine';
import { createDefaultSongConfig } from '../src/lib/bandState';
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
});
