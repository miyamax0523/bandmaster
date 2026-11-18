import { describe, expect, it } from 'vitest';
import { createDefaultSongConfig, generateAllSections, toggleCellLock } from '../src/lib/bandState';
import {
  createMemoryStorageBackend,
  loadProject,
  saveProject,
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
        chords: ['Em', 'C'],
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
});
