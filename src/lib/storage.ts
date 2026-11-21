import {
  createDefaultEnabledParts,
  createDefaultPartPresets,
  CURRENT_ENGINE_VERSION,
  type InstrumentType,
  type MidiNote,
  type Section,
  type SongConfig,
  type TakeStyle,
} from '../types/song';
import type { BandState, SectionBandCells, SectionInstrumentCell } from '../types/track';
import {
  createSeedTriple,
  cloneSongConfig,
  GENERATION_ORDER,
  generateAllSections,
  generateCellTakes,
  getAverageVocalPitch,
  getSelectedDrumNotes,
} from './bandState';

export const STORAGE_SCHEMA_VERSION = 1;
export const CURRENT_PROJECT_LOCAL_KEY = 'bandmaster_current_project_v1';
export const PROJECT_SNAPSHOTS_KEY = 'bandmaster_project_snapshots_v1';
export const MAX_PROJECT_SNAPSHOTS = 15;
const DB_NAME = 'bandmaster_db';
const STORE_NAME = 'projects';
const DEFAULT_RECORD_KEY = 'current_project';

export interface StoredInstrumentCell {
  engineVersion: string;
  seeds: Record<TakeStyle, number>;
  selectedTake: TakeStyle | 'OFF';
  locked: boolean;
  takes?: Record<TakeStyle, MidiNote[]>;
}

export interface StoredBandProject {
  schemaVersion: number;
  updatedAt: number;
  song: SongConfig;
  cellsBySection: Record<string, Record<InstrumentType, StoredInstrumentCell>>;
}

export interface StorageBackend {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

export interface SaveResult {
  ok: boolean;
  quotaExceeded?: boolean;
  errorMessage?: string;
}

class MemoryStorageBackend implements StorageBackend {
  private map = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

function createIndexedDbBackend(): StorageBackend {
  const openDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });

  return {
    async get(key: string): Promise<unknown> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
      });
    },
    async set(key: string, value: unknown): Promise<void> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
        store.put(value, key);
      });
    },
    async delete(key: string): Promise<void> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'));
        tx.onerror = () =>
          reject(tx.error ?? new Error('IndexedDB delete failed'));
        store.delete(key);
      });
    },
  };
}

let defaultBackend: StorageBackend | null = null;

export function getDefaultStorageBackend(): StorageBackend {
  if (!defaultBackend) {
    if (typeof indexedDB !== 'undefined') {
      defaultBackend = createIndexedDbBackend();
    } else {
      defaultBackend = new MemoryStorageBackend();
    }
  }
  return defaultBackend;
}

export function createMemoryStorageBackend(): StorageBackend {
  return new MemoryStorageBackend();
}

export function serializeProject(
  song: SongConfig,
  bandState: BandState
): StoredBandProject {
  const cellsBySection: Record<
    string,
    Record<InstrumentType, StoredInstrumentCell>
  > = {};

  for (const sec of song.sections) {
    const secCells = bandState.cellsBySection[sec.id];
    if (!secCells) continue;

    const storedSec = {} as Record<InstrumentType, StoredInstrumentCell>;
    for (const inst of GENERATION_ORDER) {
      const cell = secCells[inst];
      if (!cell) continue;
      const keepFullNotes =
        cell.locked || cell.engineVersion !== CURRENT_ENGINE_VERSION;

      storedSec[inst] = keepFullNotes
        ? {
            engineVersion: cell.engineVersion,
            seeds: { ...cell.seeds },
            selectedTake: cell.selectedTake,
            locked: cell.locked,
            takes: {
              A: cell.takes.A.map((n) => ({ ...n })),
              B: cell.takes.B.map((n) => ({ ...n })),
              C: cell.takes.C.map((n) => ({ ...n })),
            },
          }
        : {
            engineVersion: cell.engineVersion,
            seeds: { ...cell.seeds },
            selectedTake: cell.selectedTake,
            locked: false,
          };
    }
    cellsBySection[sec.id] = storedSec;
  }

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    updatedAt: Date.now(),
    song,
    cellsBySection,
  };
}

export function hydrateProject(stored: StoredBandProject): {
  song: SongConfig;
  bandState: BandState;
} {
  const song = deepCopyJson(stored.song);
  if (!song.members.vocal) {
    song.members.vocal = {
      enabled: true,
      activeSectionsOnly: false,
      patternPreset: 'auto',
      instructionText: '',
    };
  }
  for (const inst of GENERATION_ORDER) {
    if (song.members[inst]) {
      song.members[inst] = {
        ...song.members[inst],
        patternPreset: song.members[inst].patternPreset ?? 'auto',
      };
    }
  }
  // Drop legacy keyboardGlobalSequence from old saved data cleanly
  delete (song as unknown as Record<string, unknown>).keyboardGlobalSequence;

  const cellsBySection: Record<string, SectionBandCells> = {};
  const storedCells = stored.cellsBySection ?? {};

  for (let secIdx = 0; secIdx < song.sections.length; secIdx++) {
    const rawSec = song.sections[secIdx] as Section & {
      chordProgression?: string | string[];
    };
    let restoredChords: string[];
    if (Array.isArray(rawSec.chords)) {
      restoredChords = [...rawSec.chords];
    } else if (Array.isArray(rawSec.chordProgression)) {
      restoredChords = [...rawSec.chordProgression];
    } else if (typeof rawSec.chordProgression === 'string') {
      restoredChords = rawSec.chordProgression
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
    } else {
      restoredChords = [];
    }

    const section: Section = {
      ...rawSec,
      chords: restoredChords,
      hatDensity: rawSec.hatDensity ?? 3,
      kickDensity: rawSec.kickDensity ?? 3,
      keyboardDensity: rawSec.keyboardDensity ?? 4,
      vocalDensity: rawSec.vocalDensity ?? 3,
      vocalHarmony: rawSec.vocalHarmony ?? 'off',
      patternPresets: {
        ...createDefaultPartPresets(song.members),
        ...(rawSec.patternPresets ?? rawSec.partPresets ?? {}),
      },
      enabledParts: {
        ...createDefaultEnabledParts(),
        ...rawSec.enabledParts,
      },
    };
    song.sections[secIdx] = section;
    const storedSec = storedCells[section.id];
    if (!storedSec) continue;

    const restored = {} as SectionBandCells;

    // Step 1: Restore locked or outdated-version cells verbatim first
    for (const inst of GENERATION_ORDER) {
      const sCell = storedSec[inst];
      if (!sCell) continue;
      if (
        (sCell.locked || sCell.engineVersion !== CURRENT_ENGINE_VERSION) &&
        sCell.takes
      ) {
        restored[inst] = {
          engineVersion: sCell.engineVersion,
          seeds: { ...sCell.seeds },
          selectedTake: sCell.selectedTake,
          locked: sCell.locked,
          takes: {
            A: sCell.takes.A.map((n) => ({ ...n })),
            B: sCell.takes.B.map((n) => ({ ...n })),
            C: sCell.takes.C.map((n) => ({ ...n })),
          },
        };
      }
    }

    // Step 2: Deterministically regenerate unlocked current-version or newly added part cells
    for (const inst of GENERATION_ORDER) {
      if (restored[inst]) continue;
      const sCell = storedSec[inst];
      const seeds = sCell?.seeds
        ? { ...sCell.seeds }
        : createSeedTriple(7100 + secIdx * 37 + inst.length);
      const drumNotes =
        inst === 'bass' && section.enabledParts?.drums !== false
          ? getSelectedDrumNotes(restored)
          : [];
      const prevVocalAvgPitch =
        inst === 'vocal' && secIdx > 0
          ? getAverageVocalPitch(cellsBySection[song.sections[secIdx - 1].id])
          : undefined;
      const takes = generateCellTakes(
        song,
        section,
        secIdx,
        inst,
        seeds,
        drumNotes,
        prevVocalAvgPitch
      );
      const cell: SectionInstrumentCell = {
        engineVersion: sCell?.engineVersion ?? CURRENT_ENGINE_VERSION,
        seeds,
        selectedTake: sCell?.selectedTake ?? 'A',
        locked: false,
        takes,
      };
      restored[inst] = cell;
    }

    cellsBySection[section.id] = restored;
  }

  for (let secIdx = 0; secIdx < song.sections.length; secIdx++) {
    const section = song.sections[secIdx];
    if (cellsBySection[section.id]) continue;
    const emptyRestored = {} as SectionBandCells;
    for (const inst of GENERATION_ORDER) {
      const seeds = createSeedTriple(7100 + secIdx * 37 + inst.length);
      const drumNotes =
        inst === 'bass' && section.enabledParts?.drums !== false
          ? getSelectedDrumNotes(emptyRestored)
          : [];
      const prevVocalAvgPitch =
        inst === 'vocal' && secIdx > 0
          ? getAverageVocalPitch(cellsBySection[song.sections[secIdx - 1].id])
          : undefined;
      emptyRestored[inst] = {
        engineVersion: CURRENT_ENGINE_VERSION,
        seeds,
        selectedTake: 'A',
        locked: false,
        takes: generateCellTakes(
          song,
          section,
          secIdx,
          inst,
          seeds,
          drumNotes,
          prevVocalAvgPitch
        ),
      };
    }
    cellsBySection[section.id] = emptyRestored;
  }

  return {
    song,
    bandState: { cellsBySection },
  };
}

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  const code = (err as { code?: number }).code;
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

export function saveCurrentProjectSync(
  song: SongConfig,
  bandState: BandState
): SaveResult {
  try {
    const payload = serializeProject(song, bandState);
    const json = JSON.stringify(payload);
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(CURRENT_PROJECT_LOCAL_KEY, json);
    } else {
      memorySnapshotFallback.set(CURRENT_PROJECT_LOCAL_KEY, json);
    }
    return { ok: true };
  } catch (err) {
    if (isQuotaExceededError(err)) {
      return {
        ok: false,
        quotaExceeded: true,
        errorMessage:
          'ストレージ容量上限（QuotaExceededError）に達したため保存できませんでした。既存データは保護されています。',
      };
    }
    return {
      ok: false,
      errorMessage:
        err instanceof Error ? err.message : '保存に失敗しました',
    };
  }
}

export function loadCurrentProjectSync(): {
  song: SongConfig;
  bandState: BandState;
} | null {
  let raw: string | null = null;
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      raw = globalThis.localStorage.getItem(CURRENT_PROJECT_LOCAL_KEY);
    } catch {
      raw = memorySnapshotFallback.get(CURRENT_PROJECT_LOCAL_KEY) ?? null;
    }
  } else {
    raw = memorySnapshotFallback.get(CURRENT_PROJECT_LOCAL_KEY) ?? null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredBandProject>;
    if (!parsed || typeof parsed !== 'object' || !parsed.song) {
      return null;
    }
    if (
      parsed.schemaVersion !== undefined &&
      parsed.schemaVersion !== STORAGE_SCHEMA_VERSION
    ) {
      return null;
    }
    return hydrateProject({
      schemaVersion: STORAGE_SCHEMA_VERSION,
      updatedAt: parsed.updatedAt ?? Date.now(),
      song: parsed.song,
      cellsBySection: parsed.cellsBySection ?? {},
    });
  } catch {
    return null;
  }
}

export function loadCurrentProject(): {
  song: SongConfig;
  bandState: BandState;
} | null {
  return loadCurrentProjectSync();
}

export async function saveProject(
  song: SongConfig,
  bandState: BandState,
  backend: StorageBackend = getDefaultStorageBackend(),
  key = DEFAULT_RECORD_KEY
): Promise<SaveResult> {
  try {
    const payload = serializeProject(song, bandState);
    if (backend === getDefaultStorageBackend() && key === DEFAULT_RECORD_KEY) {
      saveCurrentProjectSync(song, bandState);
    }
    await backend.set(key, payload);
    return { ok: true };
  } catch (err) {
    if (isQuotaExceededError(err)) {
      return {
        ok: false,
        quotaExceeded: true,
        errorMessage:
          'ストレージ容量上限（QuotaExceededError）に達したため保存できませんでした。既存データは保護されています。',
      };
    }
    return {
      ok: false,
      errorMessage:
        err instanceof Error ? err.message : '保存に失敗しました',
    };
  }
}

export async function loadProject(
  backend: StorageBackend = getDefaultStorageBackend(),
  key = DEFAULT_RECORD_KEY
): Promise<{ song: SongConfig; bandState: BandState } | null> {
  if (backend === getDefaultStorageBackend() && key === DEFAULT_RECORD_KEY) {
    const syncLoaded = loadCurrentProjectSync();
    if (syncLoaded) {
      return syncLoaded;
    }
  }
  const raw = await backend.get(key);
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Partial<StoredBandProject>;
  if (
    (candidate.schemaVersion !== undefined &&
      candidate.schemaVersion !== STORAGE_SCHEMA_VERSION) ||
    !candidate.song
  ) {
    // Safe initialization on schemaVersion mismatch
    await backend.delete(key);
    return null;
  }
  const hydrated = hydrateProject({
    schemaVersion: STORAGE_SCHEMA_VERSION,
    updatedAt: candidate.updatedAt ?? Date.now(),
    song: candidate.song,
    cellsBySection: candidate.cellsBySection ?? {},
  });
  if (backend === getDefaultStorageBackend() && key === DEFAULT_RECORD_KEY) {
    saveCurrentProjectSync(hydrated.song, hydrated.bandState);
  }
  return hydrated;
}

export function createDebouncedProjectSaver(
  delayMs = 500,
  backend: StorageBackend = getDefaultStorageBackend(),
  onResult?: (res: SaveResult) => void
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleSave = (song: SongConfig, bandState: BandState) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(async () => {
      timer = null;
      const res = await saveProject(song, bandState, backend);
      onResult?.(res);
    }, delayMs);
  };

  const flushNow = async (song: SongConfig, bandState: BandState) => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (backend === getDefaultStorageBackend()) {
      saveCurrentProjectSync(song, bandState);
    }
    const res = await saveProject(song, bandState, backend);
    onResult?.(res);
  };

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return { scheduleSave, flushNow, cancel };
}

export interface SavedProjectSnapshot {
  id: string;
  name: string;
  savedAt: string;
  song: SongConfig;
  cellsBySection?: Record<string, Record<InstrumentType, StoredInstrumentCell>>;
}

const memorySnapshotFallback = new Map<string, string>();

function readSnapshotsRaw(): string | null {
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      return globalThis.localStorage.getItem(PROJECT_SNAPSHOTS_KEY);
    } catch {
      return memorySnapshotFallback.get(PROJECT_SNAPSHOTS_KEY) ?? null;
    }
  }
  return memorySnapshotFallback.get(PROJECT_SNAPSHOTS_KEY) ?? null;
}

function writeSnapshotsRaw(value: string): void {
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      globalThis.localStorage.setItem(PROJECT_SNAPSHOTS_KEY, value);
      return;
    } catch {
      // Fallback to in-memory map
    }
  }
  memorySnapshotFallback.set(PROJECT_SNAPSHOTS_KEY, value);
}

function deepCopyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function serializeCellsForSnapshot(
  bandState?: BandState
): Record<string, Record<InstrumentType, StoredInstrumentCell>> | undefined {
  if (!bandState) return undefined;
  const result: Record<string, Record<InstrumentType, StoredInstrumentCell>> = {};
  for (const [secId, cells] of Object.entries(bandState.cellsBySection)) {
    const secRecord = {} as Record<InstrumentType, StoredInstrumentCell>;
    for (const inst of GENERATION_ORDER) {
      const cell = cells[inst];
      if (!cell) continue;
      const keepNotes =
        cell.locked || cell.engineVersion !== CURRENT_ENGINE_VERSION;
      secRecord[inst] = {
        selectedTake: cell.selectedTake,
        locked: cell.locked,
        engineVersion: cell.engineVersion,
        seeds: { ...cell.seeds },
        takes: keepNotes
          ? {
              A: cell.takes.A.map((n) => ({ ...n })),
              B: cell.takes.B.map((n) => ({ ...n })),
              C: cell.takes.C.map((n) => ({ ...n })),
            }
          : undefined,
      };
    }
    result[secId] = secRecord;
  }
  return deepCopyJson(result);
}

function persistSnapshots(snapshots: SavedProjectSnapshot[]): void {
  const trimmed = snapshots.slice(0, MAX_PROJECT_SNAPSHOTS);
  writeSnapshotsRaw(JSON.stringify(trimmed));
}

export function listProjectSnapshots(): SavedProjectSnapshot[] {
  const raw = readSnapshotsRaw();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return deepCopyJson(
      parsed.filter(
        (item): item is SavedProjectSnapshot =>
          Boolean(
            item &&
              typeof item === 'object' &&
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              typeof item.savedAt === 'string' &&
              item.song &&
              typeof item.song === 'object'
          )
      )
    );
  } catch {
    return [];
  }
}

export function saveProjectSnapshot(
  song: SongConfig,
  customName?: string,
  bandState?: BandState
): SavedProjectSnapshot {
  const trimmedCustom = customName?.trim();
  const resolvedName =
    trimmedCustom && trimmedCustom.length > 0
      ? trimmedCustom
      : (song.title?.trim() || '無題のプロジェクト');

  const songCopy = deepCopyJson(cloneSongConfig(song));
  if (trimmedCustom) {
    songCopy.title = resolvedName;
  }

  const snapshot: SavedProjectSnapshot = {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: resolvedName,
    savedAt: new Date().toISOString(),
    song: songCopy,
    cellsBySection: serializeCellsForSnapshot(bandState),
  };

  const existing = listProjectSnapshots();
  const nextList = [snapshot, ...existing].slice(0, MAX_PROJECT_SNAPSHOTS);
  persistSnapshots(nextList);
  return deepCopyJson(snapshot);
}

export function overwriteProjectSnapshot(
  snapshotId: string,
  song: SongConfig,
  bandState?: BandState
): SavedProjectSnapshot | null {
  const list = listProjectSnapshots();
  const idx = list.findIndex((s) => s.id === snapshotId);
  if (idx === -1) return null;

  const target = list[idx];
  const songCopy = deepCopyJson(cloneSongConfig(song));
  songCopy.title = target.name;

  const updated: SavedProjectSnapshot = {
    ...target,
    savedAt: new Date().toISOString(),
    song: songCopy,
    cellsBySection: serializeCellsForSnapshot(bandState),
  };

  const nextList = [updated, ...list.filter((s) => s.id !== snapshotId)].slice(
    0,
    MAX_PROJECT_SNAPSHOTS
  );
  persistSnapshots(nextList);
  return deepCopyJson(updated);
}

export function loadProjectSnapshotWithState(
  snapshotId: string
): { song: SongConfig; bandState: BandState } | null {
  const list = listProjectSnapshots();
  const target = list.find((s) => s.id === snapshotId);
  if (!target) return null;

  const songCopy = deepCopyJson(target.song);
  const parsedUpdatedAt = Date.parse(target.savedAt);
  const updatedAt = Number.isNaN(parsedUpdatedAt) ? Date.now() : parsedUpdatedAt;
  if (target.cellsBySection) {
    return hydrateProject({
      schemaVersion: STORAGE_SCHEMA_VERSION,
      updatedAt,
      song: songCopy,
      cellsBySection: deepCopyJson(target.cellsBySection),
    });
  }

  const hydrated = hydrateProject({
    schemaVersion: STORAGE_SCHEMA_VERSION,
    updatedAt,
    song: songCopy,
    cellsBySection: {},
  });
  return {
    song: hydrated.song,
    bandState: generateAllSections(hydrated.song),
  };
}

export function loadProjectSnapshot(snapshotId: string): SongConfig | null {
  const loaded = loadProjectSnapshotWithState(snapshotId);
  return loaded ? loaded.song : null;
}

export function renameProjectSnapshot(snapshotId: string, newName: string): void {
  const trimmed = newName.trim();
  if (!trimmed) return;
  const list = listProjectSnapshots();
  const idx = list.findIndex((s) => s.id === snapshotId);
  if (idx === -1) return;

  list[idx] = {
    ...list[idx],
    name: trimmed,
    song: {
      ...deepCopyJson(list[idx].song),
      title: trimmed,
    },
  };
  persistSnapshots(list);
}

export function deleteProjectSnapshot(snapshotId: string): void {
  const list = listProjectSnapshots();
  const nextList = list.filter((s) => s.id !== snapshotId);
  persistSnapshots(nextList);
}
