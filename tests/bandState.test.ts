import { describe, expect, it } from 'vitest';
import {
  applyArrangementPresetToSong,
  createDefaultSongConfig,
  duplicateSectionInSong,
  generateAllSections,
  getSongDurationSummary,
  isDrumLockedUnsynced,
  pushUndoSnapshot,
  reorderSectionsInSong,
  selectInstrumentTake,
  setSectionUnisonRiff,
  toggleCellLock,
  toggleSectionPartEnabled,
  toggleSectionRiffOctaveUpOn808,
  updateSectionBars,
  updateSectionDrumDensity,
  updateSectionKickMode,
} from '../src/lib/bandState';
import { detectHorizontalSwipe } from '../src/lib/touchSwipe';
import { selectSongTracks } from '../src/lib/noteSelector';
import { TICKS_PER_BAR, type UnisonRiffData } from '../src/types/song';

describe('bandState', () => {
  it('generates drums -> bass -> keyboard -> pad in order so bass follows drum kicks', () => {
    const song = createDefaultSongConfig('rockBand');
    song.sections = [
      {
        id: 's1',
        type: 'Verse',
        name: 'Aメロ',
        bars: 2,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: ['Em', 'C'],
      },
    ];
    const state = generateAllSections(song);
    const drumsB = state.cellsBySection.s1.drums.takes.B;
    const bassB = state.cellsBySection.s1.bass.takes.B;
    expect(drumsB.length).toBeGreaterThan(0);
    expect(bassB.length).toBeGreaterThan(0);

    // Switching drums to OFF should auto-sync unlocked bass (losing non-head kick syncs)
    const stateOff = selectInstrumentTake(song, state, 's1', 'drums', 'OFF');
    expect(stateOff.cellsBySection.s1.drums.selectedTake).toBe('OFF');
    // Bass regenerated deterministically without kick notes
    expect(stateOff.cellsBySection.s1.bass.takes.B.length).toBeLessThanOrEqual(
      bassB.length
    );
  });

  it('auto-syncs drums & bass on unisonRiff set/clear and bass-only on octaveUpOn808 toggle while respecting lock protection', () => {
    const song = createDefaultSongConfig('rockBand');
    song.sections = [
      {
        id: 's1',
        type: 'Verse',
        name: 'Riff',
        bars: 1,
        energy: 'Mid',
        kickMode: '808',
        chords: ['Em'],
      },
    ];
    let state = generateAllSections(song);

    const riff: UnisonRiffData = {
      sourceName: 'riff.wav',
      analysisMethod: 'manual',
      bars: 1,
      grid: 'straight16',
      offsetMs: 0,
      octaveUpOn808: false,
      cleanedBassNotes: [
        { pitch: 40, velocity: 100, startTick: 0, durationTicks: 240 },
        { pitch: 43, velocity: 95, startTick: 360, durationTicks: 240 },
      ],
      accentTicks: [0, 360],
    };

    // Set unisonRiff -> drums and bass auto-update
    const resSet = setSectionUnisonRiff(song, state, 's1', riff);
    const drumKicks = resSet.bandState.cellsBySection.s1.drums.takes.A.filter(
      (n) => n.pitch === 36
    );
    expect(drumKicks.some((k) => k.startTick === 360 && k.velocity === 110)).toBe(true);
    expect(resSet.bandState.cellsBySection.s1.bass.takes.B[0].pitch).toBe(40);

    // Toggle octaveUpOn808 -> bass updates (+12 -> 52), drums stay untouched
    const drumsBeforeToggle = JSON.stringify(resSet.bandState.cellsBySection.s1.drums);
    const resToggle = toggleSectionRiffOctaveUpOn808(
      resSet.song,
      resSet.bandState,
      's1',
      true
    );
    expect(JSON.stringify(resToggle.bandState.cellsBySection.s1.drums)).toBe(
      drumsBeforeToggle
    );
    expect(resToggle.bandState.cellsBySection.s1.bass.takes.B[0].pitch).toBe(52);

    // Clear unisonRiff when drums is locked -> drums stays locked & shows unsynced, bass reverts to normal
    state = toggleCellLock(resToggle.bandState, 's1', 'drums');
    expect(
      isDrumLockedUnsynced(resToggle.song.sections[0], state.cellsBySection.s1)
    ).toBe(true);
    const lockedDrumsJson = JSON.stringify(state.cellsBySection.s1.drums);
    const resClear = setSectionUnisonRiff(resToggle.song, state, 's1', undefined);
    expect(JSON.stringify(resClear.bandState.cellsBySection.s1.drums)).toBe(
      lockedDrumsJson
    );
  });

  it('regenerates unlocked cells and preserves locked cell notes on bar count change', () => {
    const song = createDefaultSongConfig('rockBand');
    song.sections = [
      {
        id: 's1',
        type: 'Verse',
        name: 'Aメロ',
        bars: 4,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: ['Em', 'C', 'G', 'D'],
      },
    ];
    let state = generateAllSections(song);
    state = toggleCellLock(state, 's1', 'drums');
    const lockedDrumsBefore = JSON.stringify(state.cellsBySection.s1.drums.takes.A);

    const shrunk = updateSectionBars(song, state, 's1', 2);
    expect(shrunk.song.sections[0].bars).toBe(2);
    // Locked drums array is NOT mutated in state
    expect(JSON.stringify(shrunk.bandState.cellsBySection.s1.drums.takes.A)).toBe(
      lockedDrumsBefore
    );
    // Unlocked bass regenerated to 2 bars
    expect(
      shrunk.bandState.cellsBySection.s1.bass.takes.A.every(
        (n) => n.startTick < 2 * 1920
      )
    ).toBe(true);
  });

  it('updates bass on kickMode toggle, deep-copies on section duplicate, and caps Undo history at 10', () => {
    const song = createDefaultSongConfig('rockBand');
    let state = generateAllSections(song);

    const toggled = updateSectionKickMode(song, state, 'sec-verse', '808');
    expect(toggled.song.sections[1].kickMode).toBe('808');
    // OctaveUp 808 raises bar head E1(28) to E2(40)
    expect(toggled.bandState.cellsBySection['sec-verse'].bass.takes.A[0].pitch).toBeGreaterThanOrEqual(40);

    const dup = duplicateSectionInSong(toggled.song, toggled.bandState, 'sec-verse', 'sec-dup');
    expect(dup.song.sections.length).toBe(song.sections.length + 1);
    expect(dup.bandState.cellsBySection['sec-dup']).toBeDefined();

    let history = [] as ReturnType<typeof pushUndoSnapshot>;
    for (let i = 0; i < 15; i++) {
      history = pushUndoSnapshot(history, { song, bandState: state });
    }
    expect(history.length).toBe(10);
  });

  it('computes total bars and formatted duration (MM:SS) and applies arrangement presets', () => {
    const song = createDefaultSongConfig('rockBand');
    // Default rockBand: 4 + 8 + 4 + 8 = 24 bars at 135 BPM -> round((24 * 4 * 60) / 135) = 43s -> 0:43
    expect(getSongDurationSummary(song)).toEqual({
      totalBars: 24,
      totalSeconds: 43,
      formattedDuration: '0:43',
    });

    // At 120 BPM with 14 bars -> 28s -> 0:28
    song.bpm = 120;
    const twoPart = applyArrangementPresetToSong(song, 'twoPart');
    expect(twoPart.song.sections.length).toBe(2);
    expect(getSongDurationSummary(twoPart.song).totalBars).toBe(16);

    const fourPart = applyArrangementPresetToSong(song, 'fourPart');
    expect(fourPart.song.sections.length).toBe(4);
    expect(getSongDurationSummary(fourPart.song).totalBars).toBe(24);

    const full = applyArrangementPresetToSong(song, 'full');
    expect(full.song.sections.length).toBe(6);
    expect(getSongDurationSummary(full.song).totalBars).toBe(32);
    expect(full.bandState.cellsBySection[full.song.sections[0].id]).toBeDefined();
  });

  it('reorders sections cleanly and detects horizontal swipes without vertical scroll false positives', () => {
    const song = createDefaultSongConfig('rockBand');
    const origIds = song.sections.map((s) => s.id);
    const reordered = reorderSectionsInSong(song, 0, 2);
    expect(reordered.sections.map((s) => s.id)).toEqual([
      origIds[1],
      origIds[2],
      origIds[0],
      origIds[3],
    ]);
    // Out-of-bounds or no-op returns original reference
    expect(reorderSectionsInSong(song, 1, 1)).toBe(song);
    expect(reorderSectionsInSong(song, -1, 2)).toBe(song);

    // Swipe detection: >= 50px and >= 1.5x vertical delta
    expect(detectHorizontalSwipe(-60, 10)).toBe('next');
    expect(detectHorizontalSwipe(75, -20)).toBe('prev');
    expect(detectHorizontalSwipe(-40, 5)).toBeNull(); // too short
    expect(detectHorizontalSwipe(-60, 50)).toBeNull(); // diagonal / vertical scroll
  });

  it('updates hatDensity/kickDensity, regenerates unlocked drums & bass, and respects locks', () => {
    const song = createDefaultSongConfig('rockBand');
    const state = generateAllSections(song);
    const secId = song.sections[1].id;

    const dense = updateSectionDrumDensity(song, state, secId, {
      hatDensity: 5,
      kickDensity: 5,
    });
    expect(dense.song.sections[1].hatDensity).toBe(5);
    expect(dense.song.sections[1].kickDensity).toBe(5);
    expect(dense.bandState.cellsBySection[secId].drums.takes.A.length).toBeGreaterThan(
      state.cellsBySection[secId].drums.takes.A.length
    );

    // Locked drums stays untouched when density changes
    const lockedState = toggleCellLock(dense.bandState, secId, 'drums');
    const lockedDrumsBefore = JSON.stringify(lockedState.cellsBySection[secId].drums.takes.A);
    const afterLocked = updateSectionDrumDensity(dense.song, lockedState, secId, {
      hatDensity: 1,
    });
    expect(JSON.stringify(afterLocked.bandState.cellsBySection[secId].drums.takes.A)).toBe(
      lockedDrumsBefore
    );
  });

  it('fills bars 5..8 for all parts (including locked parts via periodic loop) when expanding a 4-bar section to 8 bars', () => {
    const song = createDefaultSongConfig('rockBand');
    song.members.keyboard.activeSectionsOnly = false;
    song.members.pad.activeSectionsOnly = false;
    song.sections = [
      {
        id: 's1',
        type: 'Verse',
        name: 'Aメロ',
        bars: 4,
        energy: 'Mid',
        kickMode: 'acoustic',
        hatDensity: 3,
        kickDensity: 3,
        chords: ['Em', 'C', 'G', 'D'],
      },
    ];
    let state = generateAllSections(song);
    // Lock drums and bass before expanding 4 -> 8 bars
    state = toggleCellLock(state, 's1', 'drums');
    state = toggleCellLock(state, 's1', 'bass');

    const expanded = updateSectionBars(song, state, 's1', 8);
    expect(expanded.song.sections[0].bars).toBe(8);

    const fourBarEnd = 4 * TICKS_PER_BAR;
    const eightBarEnd = 8 * TICKS_PER_BAR;

    for (const inst of ['drums', 'bass', 'keyboard', 'pad'] as const) {
      const notes = expanded.bandState.cellsBySection.s1[inst].takes.A;
      const extendedNotes = notes.filter(
        (n) => n.startTick >= fourBarEnd && n.startTick < eightBarEnd
      );
      expect(extendedNotes.length).toBeGreaterThan(0);
    }

    // Verify noteSelector outputs bars 5..8 and clips cleanly if shrunk back 8 -> 4
    const tracks8 = selectSongTracks(expanded.song, expanded.bandState);
    expect(tracks8.drums.some((n) => n.startTick >= fourBarEnd)).toBe(true);
    expect(tracks8.bass.some((n) => n.startTick >= fourBarEnd)).toBe(true);
    expect(tracks8.keyboard.some((n) => n.startTick >= fourBarEnd)).toBe(true);
    expect(tracks8.pad.some((n) => n.startTick >= fourBarEnd)).toBe(true);

    const shrunkBack = updateSectionBars(expanded.song, expanded.bandState, 's1', 4);
    const tracks4 = selectSongTracks(shrunkBack.song, shrunkBack.bandState);
    expect(tracks4.drums.every((n) => n.startTick < fourBarEnd)).toBe(true);
    expect(tracks4.bass.every((n) => n.startTick < fourBarEnd)).toBe(true);
  });

  it('mutes and restores individual parts per section via enabledParts even when locked', () => {
    const song = createDefaultSongConfig('rockBand');
    song.members.keyboard.activeSectionsOnly = false;
    song.sections = [
      {
        id: 's1',
        type: 'Verse',
        name: 'Aメロ',
        bars: 1,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: ['Em'],
      },
      {
        id: 's2',
        type: 'Chorus',
        name: 'サビ',
        bars: 1,
        energy: 'High',
        kickMode: 'acoustic',
        chords: ['C'],
      },
    ];
    let state = generateAllSections(song);
    // Lock vocal in s1 and put distinct locked marker note
    state = toggleCellLock(state, 's1', 'vocal');
    state.cellsBySection.s1.vocal.takes.A = [
      { pitch: 64, velocity: 111, startTick: 0, durationTicks: 480 },
    ];

    // Before mute: vocal notes exist in both s1 [0..1920) and s2 [1920..3840)
    const tracksBefore = selectSongTracks(song, state);
    expect(tracksBefore.vocal.some((n) => n.startTick < TICKS_PER_BAR && n.pitch === 64)).toBe(
      true
    );
    expect(tracksBefore.vocal.some((n) => n.startTick >= TICKS_PER_BAR)).toBe(true);

    // Disable vocal in s1 only
    const muted = toggleSectionPartEnabled(song, state, 's1', 'vocal', false);
    const tracksMuted = selectSongTracks(muted.song, muted.bandState);
    expect(tracksMuted.vocal.filter((n) => n.startTick < TICKS_PER_BAR)).toEqual([]);
    // s2 vocal remains unaffected
    expect(tracksMuted.vocal.some((n) => n.startTick >= TICKS_PER_BAR)).toBe(true);

    // Re-enable vocal in s1 -> locked marker note restores intact
    const restored = toggleSectionPartEnabled(
      muted.song,
      muted.bandState,
      's1',
      'vocal',
      true
    );
    const tracksRestored = selectSongTracks(restored.song, restored.bandState);
    expect(
      tracksRestored.vocal.some(
        (n) => n.startTick === 0 && n.pitch === 64 && n.velocity === 111
      )
    ).toBe(true);
  });
});
