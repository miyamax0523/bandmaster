import { describe, expect, it } from 'vitest';
import { generatePadNotes } from '../src/engines/padEngine';
import { createUniformChordTimeline } from '../src/lib/chordTimeline';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import type { Section, SongConfig } from '../src/types/song';

function createSong(padStyle: 'Power' | 'Floating Tension' | 'Dark Ambient' = 'Power'): SongConfig {
  return {
    title: 'Pad Test',
    bpm: 120,
    key: 'E',
    scale: 'Minor',
    timeSignature: '4/4',
    beatFeel: 'Straight',
    swing: 0,
    swingTarget: '8th',
    exportOnlyActiveTracks: true,
    split808KickTrack: true,
    members: {
      drums: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      bass: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      keyboard: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      pad: {
        enabled: true,
        activeSectionsOnly: false,
        padStyle,
        instructionText: '',
      },
      vocal: { enabled: true, activeSectionsOnly: false, instructionText: '' },
    },
    sections: [],
  };
}

const section: Section = {
  id: 's1',
  type: 'Chorus',
  name: 'Chorus',
  bars: 2,
  energy: 'High',
  kickMode: 'acoustic',
  chords: createUniformChordTimeline(['Em', 'C'], 2),
};

describe('padEngine', () => {
  it('generates Power, Floating Tension (with 2/7/9), and Dark Ambient (48..67)', () => {
    const powerSong = createSong('Power');
    const powerNotes = generatePadNotes({
      song: powerSong,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(powerSong, section, 'pad', 'A'),
    });
    const bar0Power = powerNotes.filter((n) => n.startTick === 0).map((n) => n.pitch);
    expect(bar0Power).toEqual([52, 59, 64]); // E3, B3, E4

    const floatSong = createSong('Floating Tension');
    const floatNotes = generatePadNotes({
      song: floatSong,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(floatSong, section, 'pad', 'A'),
    });
    const bar0Float = floatNotes.filter((n) => n.startTick === 0).map((n) => n.pitch);
    expect(bar0Float.length).toBeGreaterThan(bar0Power.length);
    expect(bar0Float).toContain(54); // sus2 (F#3)
    expect(bar0Float).toContain(66); // add9 (F#4)

    const darkSong = createSong('Dark Ambient');
    const darkNotes = generatePadNotes({
      song: darkSong,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(darkSong, section, 'pad', 'A'),
    });
    expect(darkNotes.every((n) => n.pitch >= 48 && n.pitch <= 67)).toBe(true);
  });

  it('returns empty array when pad is disabled', () => {
    const song = createSong('Power');
    song.members.pad.enabled = false;
    expect(
      generatePadNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'pad', 'A'),
      })
    ).toEqual([]);
  });

  it('applies patternPreset deterministically across pad presets', () => {
    const runPreset = (preset: string) => {
      const song = createSong('Power');
      song.members.pad.patternPreset = preset;
      return generatePadNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'pad', 'A'),
      });
    };

    const swell = runPreset('swell_half');
    const swellStarts = new Set(swell.map((n) => n.startTick));
    expect([...swellStarts].sort((a, b) => a - b)).toEqual([0, 960, 1920, 2880]);

    const shimmer = runPreset('high_shimmer');
    expect(shimmer.length).toBeGreaterThan(0);
    expect(shimmer.every((n) => n.pitch >= 64 && n.pitch <= 88)).toBe(true);

    const fifth = runPreset('fifth_drone');
    // Bar 0 is Em (E=4, B=11) -> pitch classes should only be 4 and 11 (no 3rd G=7)
    const bar0PitchClasses = new Set(
      fifth.filter((n) => n.startTick === 0).map((n) => n.pitch % 12)
    );
    expect([...bar0PitchClasses].sort((a, b) => a - b)).toEqual([4, 11]);

    const sidechain = runPreset('sidechain_pulse');
    const scStarts = Array.from(
      new Set(sidechain.filter((n) => n.startTick < 1920).map((n) => n.startTick))
    ).sort((a, b) => a - b);
    expect(scStarts).toEqual([120, 600, 1080, 1560]);

    const strings = runPreset('strings_ensemble');
    const bar0Strings = strings.filter((n) => n.startTick === 0);
    expect(bar0Strings.length).toBeGreaterThanOrEqual(5);

    const choir = runPreset('choir_open_voicing');
    const bar0Choir = choir
      .filter((n) => n.startTick === 0)
      .map((n) => n.pitch)
      .sort((a, b) => a - b);
    expect(bar0Choir.length).toBeGreaterThanOrEqual(3);
    expect(bar0Choir[1] - bar0Choir[0]).toBeGreaterThanOrEqual(5);

    const shimmerArp = runPreset('shimmer_arp_pad');
    expect(shimmerArp.some((n) => n.startTick === 0)).toBe(true);
    expect(shimmerArp.some((n) => n.startTick === 240 && n.pitch >= 64)).toBe(true);

    const warmDrift = runPreset('analog_warm_drift');
    expect(warmDrift.length).toBeGreaterThan(0);
    expect(warmDrift.every((n) => n.pitch >= 43 && n.pitch <= 67)).toBe(true);
  });
});
