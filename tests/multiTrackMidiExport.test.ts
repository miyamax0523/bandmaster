import { describe, expect, it } from 'vitest';
import { createDefaultSongConfig, generateAllSections } from '../src/lib/bandState';
import { parseMidiFile } from '../src/lib/midiParser';
import {
  canExportMidi,
  exportMultiTrackMidi,
} from '../src/lib/multiTrackMidiExport';

describe('multiTrackMidiExport', () => {
  it('exports Format 1 with independent Conductor Track, non-ASCII marker fallback, and 808 Kick track when split=true', () => {
    const song = createDefaultSongConfig('rockBand');
    song.split808KickTrack = true;
    song.exportOnlyActiveTracks = true;
    song.members.keyboard.activeSectionsOnly = false;
    song.members.pad.activeSectionsOnly = false;
    song.sections = [
      {
        id: 's1',
        type: 'Verse',
        name: 'Aメロ', // non-ASCII -> Verse 1
        bars: 1,
        energy: 'Mid',
        kickMode: '808',
        chords: ['Em'],
      },
      {
        id: 's2',
        type: 'Verse',
        name: 'Bメロ', // non-ASCII -> Verse 2
        bars: 1,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: ['C'],
      },
    ];
    const state = generateAllSections(song);
    expect(canExportMidi(song, state)).toBe(true);

    const res = exportMultiTrackMidi(song, state);
    const parsed = parseMidiFile(res.bytes);

    expect(parsed.format).toBe(1);
    expect(parsed.ntrks).toBe(res.ntrks);
    expect(res.trackNames).toEqual([
      'Conductor',
      'Drums',
      '808 Kick',
      'Bass',
      'Keyboard',
      'PAD',
      'Vocal',
    ]);
    expect(parsed.ntrks).toBe(7);
    expect(parsed.tracks[0].name).toBe('Conductor');
    expect(parsed.tracks[0].notes.length).toBe(0);

    // 808 Kick track uses long midiDurationTicks (<= 960) on ch 3
    const kick808Notes = parsed.tracks[2].notes;
    expect(kick808Notes.length).toBeGreaterThan(0);
    expect(kick808Notes.every((n) => n.channel === 3 && n.pitch === 36)).toBe(true);
    expect(kick808Notes.some((n) => n.durationTicks > 120)).toBe(true);
  });

  it('re-merges 808 Kick into Drums (ch 9) with original durationTicks when split808KickTrack=false', () => {
    const song = createDefaultSongConfig('rockBand');
    song.split808KickTrack = false;
    song.exportOnlyActiveTracks = true;
    song.members.keyboard.enabled = false;
    song.members.pad.enabled = false;
    song.members.vocal.enabled = false;
    song.sections = [
      {
        id: 's1',
        type: 'Verse',
        name: 'Intro',
        bars: 1,
        energy: 'Mid',
        kickMode: '808',
        chords: ['Em'],
      },
    ];
    const state = generateAllSections(song);
    const res = exportMultiTrackMidi(song, state);
    const parsed = parseMidiFile(res.bytes);

    expect(res.trackNames).toEqual(['Conductor', 'Drums', 'Bass']);
    expect(parsed.ntrks).toBe(3);

    const drumNotes = parsed.tracks[1].notes;
    const kicks = drumNotes.filter((n) => n.pitch === 36);
    expect(kicks.length).toBeGreaterThan(0);
    // Original drum kick durationTicks (120), NOT extended 808 long note
    expect(kicks.every((n) => n.durationTicks === 120 && n.channel === 9)).toBe(true);
  });

  it('respects exportOnlyActiveTracks=false and detects 0 active notes', () => {
    const song = createDefaultSongConfig('rockBand');
    song.split808KickTrack = true;
    song.exportOnlyActiveTracks = false;
    song.members.drums.enabled = false;
    song.members.bass.enabled = false;
    song.members.keyboard.enabled = false;
    song.members.pad.enabled = false;
    song.members.vocal.enabled = false;

    const state = generateAllSections(song);
    expect(canExportMidi(song, state)).toBe(false);

    const res = exportMultiTrackMidi(song, state);
    expect(res.totalNotes).toBe(0);
    expect(res.ntrks).toBe(7); // Conductor + 6 empty tracks (Vocal Harmony omitted when off)
  });

  it('adds an independent Vocal Harmony MIDI track only when at least one section enables harmony', () => {
    const song = createDefaultSongConfig('rockBand');
    song.exportOnlyActiveTracks = true;
    song.members.drums.enabled = false;
    song.members.bass.enabled = false;
    song.members.keyboard.enabled = false;
    song.members.pad.enabled = false;
    song.sections = [
      {
        id: 's1',
        type: 'Chorus',
        name: 'Chorus',
        bars: 1,
        energy: 'High',
        kickMode: 'acoustic',
        vocalHarmony: 'upper_3rd',
        chords: ['C'],
      },
    ];
    const state = generateAllSections(song);
    const res = exportMultiTrackMidi(song, state);
    const parsed = parseMidiFile(res.bytes);

    expect(res.trackNames).toEqual(['Conductor', 'Vocal', 'Vocal Harmony']);
    expect(parsed.ntrks).toBe(3);
    expect(parsed.tracks[2].name).toBe('Vocal Harmony');
    expect(parsed.tracks[2].notes.length).toBe(parsed.tracks[1].notes.length);
  });
});
