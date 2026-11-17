import { describe, expect, it } from 'vitest';
import {
  createDefaultSongConfig,
  duplicateSectionInSong,
  generateAllSections,
  isDrumLockedUnsynced,
  pushUndoSnapshot,
  selectInstrumentTake,
  setSectionUnisonRiff,
  toggleCellLock,
  toggleSectionRiffOctaveUpOn808,
  updateSectionBars,
  updateSectionKickMode,
} from '../src/lib/bandState';
import type { UnisonRiffData } from '../src/types/song';

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
});
