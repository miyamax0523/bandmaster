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
      vocal: { enabled: true, activeSectionsOnly: false, instructionText: '' },
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

  it('applies patternPreset deterministically across keyboard presets', () => {
    const runPreset = (preset: string) => {
      const song = createSong();
      song.members.keyboard.patternPreset = preset;
      return generateKeyboardNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'keyboard', 'A'),
      });
    };

    const sustain = runPreset('whole_sustain');
    const sustainStarts = new Set(sustain.map((n) => n.startTick));
    expect([...sustainStarts].sort((a, b) => a - b)).toEqual([0, 1920]);

    const arp16 = runPreset('arp_16th');
    expect(arp16.length).toBe(32);

    const ska = runPreset('offbeat_ska');
    const skaOffbeats = [240, 720, 1200, 1680];
    expect(ska.length).toBeGreaterThan(0);
    expect(
      ska.every((n) => {
        const local = n.startTick % 1920;
        return skaOffbeats.some((off) => Math.abs(local - off) <= 15);
      })
    ).toBe(true);
    skaOffbeats.forEach((off) => {
      expect(ska.some((n) => Math.abs((n.startTick % 1920) - off) <= 15)).toBe(true);
    });

    const darkLow = runPreset('dark_low_riff');
    expect(darkLow.length).toBeGreaterThan(0);
    expect(darkLow.every((n) => n.pitch >= 48 && n.pitch <= 67)).toBe(true);

    const rockRiff = runPreset('rock_power_riff');
    expect(rockRiff.length).toBeGreaterThan(0);
    expect(rockRiff.every((n) => n.pitch >= 48 && n.pitch <= 67)).toBe(true);

    const emoArp = runPreset('emo_arp_cascade');
    expect(emoArp.length).toBe(16);

    const funkClav = runPreset('funk_16th_clav');
    expect(funkClav.length).toBeGreaterThan(0);
    expect(funkClav.every((n) => n.durationTicks <= 85)).toBe(true);

    const counterMel = runPreset('counter_melody');
    expect(counterMel.length).toBe(10);
    expect(counterMel.every((n) => n.pitch >= 67 && n.pitch <= 86)).toBe(true);

    const synthPluck = runPreset('synth_pluck_arp');
    expect(synthPluck.length).toBe(32);
    expect(synthPluck.every((n) => n.durationTicks <= 70)).toBe(true);

    const gospelComp = runPreset('gospel_rich_comp');
    expect(gospelComp.some((n) => n.startTick % 1920 === 1680)).toBe(true);
  });
});
