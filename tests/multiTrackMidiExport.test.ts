import { describe, expect, it } from 'vitest';
import { createDefaultSongConfig, generateAllSections } from '../src/lib/bandState';
import { createUniformChordTimeline } from '../src/lib/chordTimeline';
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
        chords: createUniformChordTimeline(['Em'], 1),
      },
      {
        id: 's2',
        type: 'Verse',
        name: 'Bメロ', // non-ASCII -> Verse 2
        bars: 1,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(['C'], 1),
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
        chords: createUniformChordTimeline(['Em'], 1),
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

  it('adds an independent Vocal Harmony MIDI track only when at least one section enables harmony (e.g. upper_5th)', () => {
    const song = createDefaultSongConfig('rockBand');
    song.exportOnlyActiveTracks = true;
    song.members.drums.enabled = false;
    song.members.bass.enabled = false;
    song.members.keyboard.enabled = false;
    song.members.pad.enabled = false;
    song.sections = [
      {
        id: 's0',
        type: 'Verse',
        name: 'Verse',
        bars: 1,
        energy: 'Mid',
        kickMode: 'acoustic',
        vocalHarmony: 'off',
        chords: createUniformChordTimeline(['C'], 1),
      },
      {
        id: 's1',
        type: 'Chorus',
        name: 'Chorus',
        bars: 1,
        energy: 'High',
        kickMode: 'acoustic',
        vocalHarmony: 'upper_5th',
        chords: createUniformChordTimeline(['C'], 1),
      },
    ];
    const state = generateAllSections(song);
    const res = exportMultiTrackMidi(song, state);
    const parsed = parseMidiFile(res.bytes);

    expect(res.trackNames).toEqual(['Conductor', 'Vocal', 'Vocal Harmony']);
    expect(parsed.ntrks).toBe(3);
    expect(parsed.tracks[2].name).toBe('Vocal Harmony');
    // Only Chorus (s1, >= TICKS_PER_BAR) emits harmony notes
    expect(parsed.tracks[2].notes.every((n) => n.startTick >= 1920)).toBe(true);
    expect(parsed.tracks[2].notes.length).toBeGreaterThan(0);
  });

  it('separates cubase_smf_expressive (RPN 0,0 + 14-bit Pitch Bend) and voisona_clean_smf (zero PB + <180t legato glue)', () => {
    const song = createDefaultSongConfig('numetal_mixture');
    song.exportOnlyActiveTracks = true;
    song.sections = [
      {
        id: 's-dual',
        type: 'Chorus',
        name: 'Chorus',
        bars: 8,
        energy: 'High',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 8),
        patternPresets: {
          drums: 'breakdown_heavy',
          bass: 'metal_gallop',
          keyboard: 'rock_power_riff',
          pad: 'sidechain_pulse',
          vocal: 'numetal_mixture',
        },
      },
    ];
    const state = generateAllSections(song, undefined, 777, true);

    const cubaseRes = exportMultiTrackMidi(song, state, {
      exportTarget: 'cubase_smf_expressive',
    });
    const cubaseParsed = parseMidiFile(cubaseRes.bytes);
    const cubaseVocal = cubaseParsed.tracks.find((t) => t.name === 'Vocal')!;
    expect(cubaseVocal.controlChanges.slice(0, 6).map((c) => c.controller)).toEqual([
      101, 100, 6, 38, 101, 100,
    ]);
    if (cubaseVocal.pitchBends.length > 0) {
      expect(
        cubaseVocal.pitchBends[cubaseVocal.pitchBends.length - 1].value14Bit
      ).toBe(8192);
    }

    const voisonaRes = exportMultiTrackMidi(song, state, {
      exportTarget: 'voisona_clean_smf',
    });
    const voisonaParsed = parseMidiFile(voisonaRes.bytes);
    const voisonaVocal = voisonaParsed.tracks.find((t) => t.name === 'Vocal')!;
    expect(voisonaVocal.pitchBends).toEqual([]);
    expect(voisonaVocal.controlChanges).toEqual([]);
    for (let i = 0; i + 1 < voisonaVocal.notes.length; i++) {
      const gap =
        voisonaVocal.notes[i + 1].startTick -
        (voisonaVocal.notes[i].startTick + voisonaVocal.notes[i].durationTicks);
      expect(gap === 0 || gap >= 180).toBe(true);
    }
  });

  it('filters exported tracks by includedParts while preserving Conductor (Track 0) and exact byte parity when all parts selected', () => {
    const song = createDefaultSongConfig('royal_jpop');
    song.split808KickTrack = false;
    song.exportOnlyActiveTracks = false;
    song.sections = [
      {
        id: 'sec-part-filter',
        type: 'Chorus',
        name: 'Chorus',
        bars: 4,
        energy: 'High',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(['C', 'G', 'Am', 'F'], 4),
      },
    ];
    const state = generateAllSections(song, undefined, 2026, true);

    // 1. Drums + Bass only -> Conductor (Track 0 with KeySig) + Drums + Bass = 3 tracks only
    const rhythmSet = new Set<'drums' | 'bass'>(['drums', 'bass']);
    const rhythmRes = exportMultiTrackMidi(song, state, {
      includedParts: rhythmSet,
    });
    const parsedRhythm = parseMidiFile(rhythmRes.bytes);
    expect(rhythmRes.ntrks).toBe(3);
    expect(parsedRhythm.ntrks).toBe(3);
    expect(rhythmRes.trackNames).toEqual(['Conductor', 'Drums', 'Bass']);
    expect(parsedRhythm.tracks.map((t) => t.name)).toEqual([
      'Conductor',
      'Drums',
      'Bass',
    ]);
    expect(parsedRhythm.tracks[0].keySignatures.length).toBe(1);
    expect(parsedRhythm.tracks[0].keySignatures[0].tick).toBe(0);

    // 2. All parts explicitly selected -> byte-for-byte identical to default export
    const defaultRes = exportMultiTrackMidi(song, state);
    const allSelectedRes = exportMultiTrackMidi(song, state, {
      includedParts: {
        drums: true,
        bass: true,
        vocal: true,
        keyboard: true,
        pad: true,
      },
    });
    expect(allSelectedRes.bytes).toEqual(defaultRes.bytes);
    expect(allSelectedRes.trackNames).toEqual(defaultRes.trackNames);

    // 3. Zero parts selected -> guarded (canExportMidi=false, exportMultiTrackMidi throws)
    const emptyParts = {
      drums: false,
      bass: false,
      vocal: false,
      keyboard: false,
      pad: false,
    };
    expect(canExportMidi(song, state, { includedParts: emptyParts })).toBe(false);
    expect(() =>
      exportMultiTrackMidi(song, state, { includedParts: emptyParts })
    ).toThrow();
  });

  it('filters VoiSona clean SMF by includedParts (Vocal only & Vocal+Keys) with strict 60-tick quantization and Track 0 Conductor', () => {
    const song = createDefaultSongConfig('royal_jpop');
    song.split808KickTrack = false;
    song.exportOnlyActiveTracks = false;
    song.sections = [
      {
        id: 'sec-voisona-filter',
        type: 'Chorus',
        name: 'Chorus',
        bars: 4,
        energy: 'High',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(['C', 'G', 'Am', 'F'], 4),
      },
    ];
    const state = generateAllSections(song, undefined, 3030, true);

    // 1. VoiSona Clean SMF: Vocal only -> Track 0 (Conductor) + Vocal = 2 tracks, all notes % 60 === 0 & monophonic
    const vocalOnlyRes = exportMultiTrackMidi(song, state, {
      exportTarget: 'voisona_clean_smf',
      includedParts: { vocal: true },
    });
    const parsedVocalOnly = parseMidiFile(vocalOnlyRes.bytes);
    expect(vocalOnlyRes.ntrks).toBe(2);
    expect(parsedVocalOnly.ntrks).toBe(2);
    expect(vocalOnlyRes.trackNames).toEqual(['Conductor', 'Vocal']);
    expect(parsedVocalOnly.tracks[0].keySignatures.length).toBe(1);
    const vOnlyNotes = parsedVocalOnly.tracks[1].notes;
    expect(vOnlyNotes.length).toBeGreaterThan(0);
    for (let i = 0; i < vOnlyNotes.length; i++) {
      expect(vOnlyNotes[i].startTick % 60).toBe(0);
      expect(vOnlyNotes[i].durationTicks % 60).toBe(0);
      if (i + 1 < vOnlyNotes.length) {
        expect(vOnlyNotes[i].startTick + vOnlyNotes[i].durationTicks).toBeLessThanOrEqual(
          vOnlyNotes[i + 1].startTick
        );
      }
    }

    // 2. VoiSona Clean SMF: Vocal + Keys -> Track 0 (Conductor) + Keyboard + Vocal = 3 tracks, all notes % 60 === 0
    const vocalKeysRes = exportMultiTrackMidi(song, state, {
      exportTarget: 'voisona_clean_smf',
      includedParts: { vocal: true, keyboard: true },
    });
    const parsedVocalKeys = parseMidiFile(vocalKeysRes.bytes);
    expect(vocalKeysRes.ntrks).toBe(3);
    expect(parsedVocalKeys.ntrks).toBe(3);
    expect(vocalKeysRes.trackNames).toEqual(['Conductor', 'Keyboard', 'Vocal']);
    const kbTrack = parsedVocalKeys.tracks.find((t) => t.name === 'Keyboard')!;
    const vocTrack = parsedVocalKeys.tracks.find((t) => t.name === 'Vocal')!;
    expect(kbTrack.notes.length).toBeGreaterThan(0);
    expect(vocTrack.notes.length).toBeGreaterThan(0);
    for (const n of [...kbTrack.notes, ...vocTrack.notes]) {
      expect(n.startTick % 60).toBe(0);
      expect(n.durationTicks % 60).toBe(0);
    }
  });
});
