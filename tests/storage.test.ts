import { describe, expect, it } from 'vitest';
import { createDefaultSongConfig, generateAllSections, toggleCellLock } from '../src/lib/bandState';
import {
  createUniformChordTimeline,
  shiftChordBoundary,
  splitChordSlot,
  updateChordName,
} from '../src/lib/chordTimeline';
import {
  createMemoryStorageBackend,
  deleteProjectSnapshot,
  hydrateProject,
  listProjectSnapshots,
  loadCurrentProject,
  loadProject,
  loadProjectSnapshot,
  overwriteProjectSnapshot,
  MAX_PROJECT_SNAPSHOTS,
  renameProjectSnapshot,
  saveCurrentProjectSync,
  saveProject,
  saveProjectSnapshot,
  serializeProject,
  STORAGE_SCHEMA_VERSION,
  type StorageBackend,
} from '../src/lib/storage';
import { CURRENT_ENGINE_VERSION } from '../src/types/song';

describe('storage', () => {
  it('saves only seeds for unlocked current-version cells and full takes for locked or outdated cells', async () => {
    const backend = createMemoryStorageBackend();
    const song = createDefaultSongConfig('rockBand');
    song.sections = [
      {
        id: 's1',
        type: 'Chorus',
        name: 'サビ',
        bars: 2,
        energy: 'High',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(['Em', 'C'], 2),
        unisonRiff: {
          sourceName: 'riff.mid',
          analysisMethod: 'manual',
          bars: 1,
          grid: 'straight16',
          offsetMs: 0,
          cleanedBassNotes: [
            { pitch: 40, velocity: 100, startTick: 0, durationTicks: 240 },
          ],
          accentTicks: [0],
        },
      },
    ];
    let state = generateAllSections(song);
    state = toggleCellLock(state, 's1', 'drums');
    // Put custom marker note inside locked drums and outdated keyboard
    state.cellsBySection.s1.drums.takes.A = [
      { pitch: 36, velocity: 121, startTick: 0, durationTicks: 120 },
    ];
    state.cellsBySection.s1.keyboard.engineVersion = '2.0.0';
    state.cellsBySection.s1.keyboard.takes.A = [
      { pitch: 72, velocity: 77, startTick: 0, durationTicks: 480 },
    ];

    const serialized = serializeProject(song, state);
    expect(serialized.cellsBySection.s1.drums.takes).toBeDefined();
    expect(serialized.cellsBySection.s1.keyboard.takes).toBeDefined();
    expect(serialized.cellsBySection.s1.bass.takes).toBeUndefined();
    expect(serialized.cellsBySection.s1.pad.takes).toBeUndefined();

    const saveRes = await saveProject(song, state, backend);
    expect(saveRes.ok).toBe(true);

    const loaded = await loadProject(backend);
    expect(loaded).not.toBeNull();
    // Locked drums and outdated keyboard restored verbatim
    expect(loaded!.bandState.cellsBySection.s1.drums.takes.A).toEqual([
      { pitch: 36, velocity: 121, startTick: 0, durationTicks: 120 },
    ]);
    expect(loaded!.bandState.cellsBySection.s1.keyboard.engineVersion).toBe('2.0.0');
    expect(loaded!.bandState.cellsBySection.s1.keyboard.takes.A).toEqual([
      { pitch: 72, velocity: 77, startTick: 0, durationTicks: 480 },
    ]);
    // Unlocked current-version bass & pad deterministically regenerated matching original
    expect(loaded!.bandState.cellsBySection.s1.bass.engineVersion).toBe(
      CURRENT_ENGINE_VERSION
    );
    expect(loaded!.bandState.cellsBySection.s1.bass.takes).toEqual(
      state.cellsBySection.s1.bass.takes
    );
    expect(loaded!.song.sections[0].unisonRiff?.cleanedBassNotes.length).toBe(1);
    expect(loaded!.song.sections[0].hatDensity).toBe(3);
    expect(loaded!.song.sections[0].kickDensity).toBe(3);
    expect(loaded!.song.members.drums.patternPreset).toBe('auto');
    expect(loaded!.song.members.bass.patternPreset).toBe('auto');
    expect(loaded!.song.members.keyboard.patternPreset).toBe('auto');
    expect(loaded!.song.members.pad.patternPreset).toBe('auto');
  });

  it('protects existing data on QuotaExceededError and resets safely on schemaVersion mismatch', async () => {
    const quotaError = Object.assign(new Error('Quota exceeded'), {
      name: 'QuotaExceededError',
    });
    const failingBackend: StorageBackend = {
      async get() {
        return {
          schemaVersion: STORAGE_SCHEMA_VERSION + 99,
          updatedAt: 0,
          song: createDefaultSongConfig(),
          cellsBySection: {},
        };
      },
      async set() {
        throw quotaError;
      },
      async delete() {},
    };

    const song = createDefaultSongConfig();
    const state = generateAllSections(song);
    const res = await saveProject(song, state, failingBackend);
    expect(res.ok).toBe(false);
    expect(res.quotaExceeded).toBe(true);

    // schemaVersion mismatch returns null safely
    const loadedMismatch = await loadProject(failingBackend);
    expect(loadedMismatch).toBeNull();
  });

  it('hydrates legacy 4-part saved project by backfilling vocal member/cells and enabledParts', async () => {
    const legacySong = createDefaultSongConfig('rockBand');
    const legacyState = generateAllSections(legacySong);
    // Simulate legacy data missing vocal member, vocal cells, and section.enabledParts
    const legacyRawSong = JSON.parse(JSON.stringify(legacySong));
    delete legacyRawSong.members.vocal;
    for (const sec of legacyRawSong.sections) {
      delete sec.enabledParts;
      delete sec.hatDensity;
      delete sec.kickDensity;
      delete sec.keyboardDensity;
      delete sec.vocalDensity;
    }
    const legacyCells: Record<string, Record<string, unknown>> = {};
    for (const sec of legacySong.sections) {
      const c = legacyState.cellsBySection[sec.id];
      legacyCells[sec.id] = {
        drums: { engineVersion: c.drums.engineVersion, seeds: c.drums.seeds, selectedTake: 'A', locked: false },
        bass: { engineVersion: c.bass.engineVersion, seeds: c.bass.seeds, selectedTake: 'A', locked: false },
        keyboard: { engineVersion: c.keyboard.engineVersion, seeds: c.keyboard.seeds, selectedTake: 'A', locked: false },
        pad: { engineVersion: c.pad.engineVersion, seeds: c.pad.seeds, selectedTake: 'A', locked: false },
      };
    }

    const backend = createMemoryStorageBackend();
    await backend.set('current_project', {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      updatedAt: 12345,
      song: legacyRawSong,
      cellsBySection: legacyCells,
    });

    const loaded = await loadProject(backend);
    expect(loaded).not.toBeNull();
    expect(loaded!.song.members.vocal).toBeDefined();
    expect(loaded!.song.members.vocal.enabled).toBe(true);
    expect(loaded!.song.members.vocal.patternPreset).toBe('auto');

    for (const sec of loaded!.song.sections) {
      expect(sec.enabledParts).toEqual({
        drums: true,
        bass: true,
        keyboard: true,
        pad: true,
        vocal: true,
      });
      const vCell = loaded!.bandState.cellsBySection[sec.id].vocal;
      expect(vCell).toBeDefined();
      expect(vCell.takes.A.length).toBeGreaterThan(0);
      expect(sec.keyboardDensity).toBe(4);
      expect(sec.vocalDensity).toBe(3);
      expect(sec.vocalHarmony).toBe('off');
    }
  });

  it('saves, deep-copies, overwrites, renames, loads, caps at 15, and deletes project snapshots', () => {
    for (const existing of listProjectSnapshots()) {
      deleteProjectSnapshot(existing.id);
    }

    const song = createDefaultSongConfig('rockBand');
    song.title = 'Original Track';
    song.bpm = 140;
    const state = generateAllSections(song);

    const snap1 = saveProjectSnapshot(song, 'A案（ロック）', state);
    expect(snap1.name).toBe('A案（ロック）');
    expect(snap1.song.title).toBe('A案（ロック）');

    // Mutate working song after snapshot save -> snapshot must remain untouched
    song.bpm = 175;
    song.sections[0].name = 'Modified Section';
    const loaded1 = loadProjectSnapshot(snap1.id);
    expect(loaded1).not.toBeNull();
    expect(loaded1!.bpm).toBe(140);
    expect(loaded1!.sections[0].name).toBe('イントロ');
    expect(loaded1!.sections[0].vocalHarmony).toBe('off');

    // Overwrite snapshot updates stored content while preserving snapshot id/name
    const overwritten = overwriteProjectSnapshot(snap1.id, song, state);
    expect(overwritten?.song.bpm).toBe(175);
    expect(loadProjectSnapshot(snap1.id)?.bpm).toBe(175);

    // Rename syncs name & song title
    renameProjectSnapshot(snap1.id, '本番採用版');
    expect(loadProjectSnapshot(snap1.id)?.title).toBe('本番採用版');
    expect(listProjectSnapshots().find((s) => s.id === snap1.id)?.name).toBe('本番採用版');

    // Cap at 15 slots
    for (let i = 0; i < MAX_PROJECT_SNAPSHOTS + 3; i++) {
      saveProjectSnapshot(song, `Slot ${i}`, state);
    }
    expect(listProjectSnapshots().length).toBe(MAX_PROJECT_SNAPSHOTS);

    // Delete removes slot cleanly
    for (const s of listProjectSnapshots()) {
      deleteProjectSnapshot(s.id);
    }
    expect(listProjectSnapshots()).toEqual([]);
  });

  it('persists custom multi-section chord progressions immediately across simulated app restarts (loadCurrentProject & hydrateProject)', () => {
    const song = createDefaultSongConfig('rockBand');
    song.title = 'Restart Chord Check';
    song.key = 'C';
    song.scale = 'Major';
    song.sections[0].bars = 4;
    song.sections[0].chords = shiftChordBoundary(
      createUniformChordTimeline(['Fmaj7', 'G6', 'Em7', 'Am9'], 4),
      1,
      -0.5
    );
    song.sections[1].bars = 8;
    song.sections[1].chords = updateChordName(
      splitChordSlot(createUniformChordTimeline(['Dm7', 'G7', 'Cmaj7', 'A7'], 8), 0),
      1,
      'Em7'
    );
    song.sections[2].bars = 4;
    song.sections[2].chords = createUniformChordTimeline(['F#m7-5', 'Fm6', 'C/G'], 4);
    song.sections[3].chords = []; // explicitly cleared diatonic fallback

    let state = generateAllSections(song, undefined, 919, false);
    state = toggleCellLock(state, song.sections[0].id, 'keyboard');
    const lockedNotesBeforeRestart = state.cellsBySection[song.sections[0].id].keyboard.takes.A.map(
      (n) => ({ ...n })
    );

    // Synchronous autosave (what fires immediately on chord edit / visibilitychange / pagehide)
    const saveRes = saveCurrentProjectSync(song, state);
    expect(saveRes.ok).toBe(true);

    // Simulate closing and restarting the PWA/browser
    const restored = loadCurrentProject();
    expect(restored).not.toBeNull();
    expect(restored!.song.title).toBe('Restart Chord Check');
    expect(restored!.song.key).toBe('C');
    expect(restored!.song.scale).toBe('Major');
    expect(restored!.song.sections[0].chords.map((c) => c.chord)).toEqual([
      'Fmaj7',
      'G6',
      'Em7',
      'Am9',
    ]);
    expect(restored!.song.sections[0].chords[1].startBeat).toBe(3.5);
    expect(restored!.song.sections[0].chords[1].anticipated).toBe(true);
    expect(restored!.song.sections[0].bars).toBe(4);
    expect(restored!.song.sections[1].chords.map((c) => c.chord)).toEqual([
      'Dm7',
      'Em7',
      'G7',
      'Cmaj7',
      'A7',
    ]);
    expect(restored!.song.sections[1].bars).toBe(8);
    expect(restored!.song.sections[2].chords.map((c) => c.chord)).toEqual(['F#m7-5', 'Fm6', 'C/G']);
    expect(restored!.song.sections[3].chords).toEqual([]);
    expect(restored!.bandState.cellsBySection[song.sections[0].id].keyboard.locked).toBe(true);
    expect(restored!.bandState.cellsBySection[song.sections[0].id].keyboard.takes.A).toEqual(
      lockedNotesBeforeRestart
    );

    // Verify legacy chordProgression string field & legacy string[] chords migration in hydrateProject
    const legacySerialized = JSON.parse(JSON.stringify(serializeProject(song, state)));
    delete legacySerialized.song.sections[0].chords;
    legacySerialized.song.sections[0].chordProgression = 'Cmaj9, A7sus4, Dm9, G13';
    legacySerialized.song.sections[1].chords = ['Dm7', 'G7'];
    const migrated = hydrateProject(legacySerialized);
    expect(migrated.song.sections[0].chords.map((c) => c.chord)).toEqual([
      'Cmaj9',
      'A7sus4',
      'Dm9',
      'G13',
    ]);
    expect(migrated.song.sections[0].chords[0].startBeat).toBe(0);
    expect(migrated.song.sections[0].chords[1].startBeat).toBe(4);
    expect(migrated.song.sections[1].chords.map((c) => c.chord)).toEqual(['Dm7', 'G7']);
  });
});
