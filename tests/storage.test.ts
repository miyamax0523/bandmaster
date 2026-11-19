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
    }
  });
});
