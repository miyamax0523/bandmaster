import { describe, expect, it } from 'vitest';
import { createDefaultSongConfig, generateAllSections } from '../src/lib/bandState';
import { selectSongTracks } from '../src/lib/noteSelector';
import { TICKS_PER_BAR, TRACK_CHANNELS } from '../src/types/song';

describe('noteSelector', () => {
  it('always separates logical kick808 on 808 sections regardless of split808KickTrack and silences kick808 when drums OFF/disabled/Auto Tacet', () => {
    const song = createDefaultSongConfig('rockBand');
    song.sections = [
      {
        id: 's1',
        type: 'Verse',
        name: 'Verse',
        bars: 2,
        energy: 'Mid',
        kickMode: '808',
        chords: ['Em', 'C'],
      },
    ];
    song.split808KickTrack = false; // Even when false, noteSelector must logically split kick808
    const state = generateAllSections(song);

    const tracks = selectSongTracks(song, state);
    expect(tracks.kick808.length).toBeGreaterThan(0);
    expect(tracks.kick808.every((n) => n.pitch === 36 && n.channel === TRACK_CHANNELS.kick808)).toBe(true);
    expect(tracks.drums.every((n) => n.pitch !== 36 && n.channel === TRACK_CHANNELS.drums)).toBe(true);
    // midiDurationTicks computed for 808 kicks
    expect(tracks.kick808[0].midiDurationTicks).toBeGreaterThan(0);

    // Manual OFF on drums -> kick808 is also silent
    const stateOff = generateAllSections(song);
    stateOff.cellsBySection.s1.drums.selectedTake = 'OFF';
    const tracksOff = selectSongTracks(song, stateOff);
    expect(tracksOff.drums).toEqual([]);
    expect(tracksOff.kick808).toEqual([]);

    // Auto Tacet on drums in Verse -> kick808 is also silent
    const songAutoTacet = createDefaultSongConfig('rockBand');
    songAutoTacet.sections = song.sections;
    songAutoTacet.members.drums.activeSectionsOnly = true;
    const tracksTacet = selectSongTracks(songAutoTacet, state);
    expect(tracksTacet.drums).toEqual([]);
    expect(tracksTacet.kick808).toEqual([]);
  });

  it('normalizes channels by ignoring input MidiNote.channel', () => {
    const song = createDefaultSongConfig('rockBand');
    song.sections = [
      {
        id: 's1',
        type: 'Chorus',
        name: 'Chorus',
        bars: 1,
        energy: 'High',
        kickMode: 'acoustic',
        chords: ['Em'],
      },
    ];
    const state = generateAllSections(song);
    // Inject bogus channels into raw notes
    state.cellsBySection.s1.drums.takes.A[0].channel = 15;
    state.cellsBySection.s1.bass.takes.A[0].channel = 7;
    state.cellsBySection.s1.keyboard.takes.A[0].channel = 12;
    state.cellsBySection.s1.pad.takes.A[0].channel = 5;

    const tracks = selectSongTracks(song, state);
    expect(tracks.drums.every((n) => n.channel === 9)).toBe(true);
    expect(tracks.bass.every((n) => n.channel === 0)).toBe(true);
    expect(tracks.keyboard.every((n) => n.channel === 1)).toBe(true);
    expect(tracks.pad.every((n) => n.channel === 2)).toBe(true);
  });

  it('applies Swing to Drums/Bass/Keyboard, excludes PAD, excludes entire Drums on external loop section, and excludes entire Unison section', () => {
    const song = createDefaultSongConfig('rockBand');
    song.swing = 50; // +120 ticks on 8th offbeats (240, 720, ...)
    song.swingTarget = '8th';
    song.members.keyboard.activeSectionsOnly = false;
    song.members.pad.activeSectionsOnly = false;
    song.sections = [
      {
        id: 's-loop',
        type: 'Verse',
        name: 'LoopSec',
        bars: 1,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: ['Em'],
        uploadedDrumLoop: {
          fileName: 'ext.mid',
          bars: 1,
          sourceTrackIndex: 0,
          notes: [{ pitch: 42, velocity: 90, startTick: 240, durationTicks: 120 }],
        },
      },
      {
        id: 's-unison',
        type: 'Chorus',
        name: 'UnisonSec',
        bars: 1,
        energy: 'High',
        kickMode: 'acoustic',
        chords: ['Em'],
        unisonRiff: {
          sourceName: 'riff.mid',
          analysisMethod: 'manual',
          bars: 1,
          grid: 'straight16',
          offsetMs: 0,
          cleanedBassNotes: [
            { pitch: 40, velocity: 100, startTick: 240, durationTicks: 120 },
          ],
          accentTicks: [240],
        },
      },
    ];
    const state = generateAllSections(song);
    // Put an 8th offbeat note on Bass and Keyboard in s-loop, and PAD at 240
    state.cellsBySection['s-loop'].bass.takes.A = [
      { pitch: 28, velocity: 100, startTick: 240, durationTicks: 120 },
    ];
    state.cellsBySection['s-loop'].keyboard.takes.A = [
      { pitch: 64, velocity: 90, startTick: 240, durationTicks: 120 },
    ];
    state.cellsBySection['s-loop'].pad.takes.A = [
      { pitch: 52, velocity: 80, startTick: 240, durationTicks: 120 },
    ];
    // Also put an offbeat note in s-unison keyboard
    state.cellsBySection['s-unison'].keyboard.takes.A = [
      { pitch: 64, velocity: 90, startTick: 240, durationTicks: 120 },
    ];

    const tracks = selectSongTracks(song, state);
    // In s-loop: Drums (external loop) stays at 240 (NOT swung to 360)
    const loopDrum = tracks.drums.find((n) => n.pitch === 42 && n.startTick < TICKS_PER_BAR);
    expect(loopDrum?.startTick).toBe(240);
    // In s-loop: Bass & Keyboard ARE swung to 360
    expect(tracks.bass.find((n) => n.startTick < TICKS_PER_BAR)?.startTick).toBe(360);
    expect(tracks.keyboard.find((n) => n.startTick < TICKS_PER_BAR)?.startTick).toBe(360);
    // In s-loop: PAD stays at 240 (never swung)
    expect(tracks.pad.find((n) => n.startTick < TICKS_PER_BAR)?.startTick).toBe(240);

    // In s-unison (starts at tick 1920): Bass & Keyboard stay at 1920 + 240 = 2160 (NOT swung)
    expect(tracks.bass.find((n) => n.startTick >= TICKS_PER_BAR)?.startTick).toBe(2160);
    expect(tracks.keyboard.find((n) => n.startTick >= TICKS_PER_BAR)?.startTick).toBe(2160);
  });

  it('filters out startTick >= sectionEnd (preventing ghost note bursts) and re-clips durations when locked section shrinks', () => {
    const song = createDefaultSongConfig('rockBand');
    song.sections = [
      {
        id: 's1',
        type: 'Verse',
        name: 'Shrink',
        bars: 2,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: ['Em'],
      },
    ];
    const state = generateAllSections(song);
    state.cellsBySection.s1.bass.locked = true;
    state.cellsBySection.s1.bass.takes.A = [
      { pitch: 28, velocity: 100, startTick: 1680, durationTicks: 480 }, // extends past bar 1
      { pitch: 28, velocity: 100, startTick: 1920, durationTicks: 240 }, // bar 2 -> should be removed when bars=1
      { pitch: 28, velocity: 100, startTick: 2400, durationTicks: 240 }, // bar 2 -> should be removed when bars=1
    ];

    // Shrink bars to 1 without regenerating locked cell
    song.sections[0].bars = 1;
    const tracks = selectSongTracks(song, state);
    expect(tracks.bass.length).toBe(1);
    expect(tracks.bass[0].startTick).toBe(1680);
    expect(tracks.bass[0].durationTicks).toBe(240); // clipped to 1920 - 1680
  });
});
