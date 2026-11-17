import { describe, expect, it } from 'vitest';
import { generateKeyboardNotes } from '../src/engines/keyboardEngine';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import type { Section, SongConfig } from '../src/types/song';

function createSong(): SongConfig {
  return {
    title: 'Key Test',
    bpm: 120,
    key: 'C',
    scale: 'Major',
    timeSignature: '4/4',
    beatFeel: 'Straight',
    swing: 0,
    swingTarget: '8th',
    exportOnlyActiveTracks: true,
    split808KickTrack: true,
    members: {
      drums: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      bass: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      keyboard: {
        enabled: true,
        activeSectionsOnly: false,
        keyboardStyle: 'Rhythm Backing',
        instructionText: '',
      },
      pad: { enabled: true, activeSectionsOnly: false, instructionText: '' },
    },
    sections: [],
  };
}

const section: Section = {
  id: 's1',
  type: 'Verse',
  name: 'Verse',
  bars: 2,
  energy: 'Mid',
  kickMode: 'acoustic',
  chords: ['C', 'Am'],
};

describe('keyboardEngine', () => {
  it('avoids guitar mid-range (48..59) and stays in 60..84', () => {
    const song = createSong();
    const styles = ['Rhythm Backing', 'Arpeggio', 'Minimal Riff', 'Long Sustain'] as const;
    for (const ks of styles) {
      song.members.keyboard.keyboardStyle = ks;
      const notes = generateKeyboardNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 77,
        params: resolveInstrumentParams(song, section, 'keyboard', 'A'),
      });
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((n) => n.pitch >= 60 && n.pitch <= 84)).toBe(true);
      expect(notes.every((n) => n.channel === 1)).toBe(true);
    }
  });

  it('returns empty array when keyboard member is disabled and is deterministic', () => {
    const song = createSong();
    const params = resolveInstrumentParams(song, section, 'keyboard', 'C');
    const run1 = generateKeyboardNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'C',
      seed: 999,
      params,
    });
    const run2 = generateKeyboardNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'C',
      seed: 999,
      params,
    });
    expect(run1).toEqual(run2);

    song.members.keyboard.enabled = false;
    expect(
      generateKeyboardNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'C',
        seed: 999,
        params,
      })
    ).toEqual([]);
  });
});
