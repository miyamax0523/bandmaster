import { describe, expect, it } from 'vitest';
import { generatePadNotes } from '../src/engines/padEngine';
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
  chords: ['Em', 'C'],
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
});
