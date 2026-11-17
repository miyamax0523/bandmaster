import {
  CURRENT_ENGINE_VERSION,
  type InstrumentType,
  type MidiNote,
  type SongConfig,
  type TakeStyle,
} from '../types/song';
import type { BandState, SectionBandCells, SectionInstrumentCell } from '../types/track';
import {
  GENERATION_ORDER,
  generateCellTakes,
  getSelectedDrumNotes,
} from './bandState';

export const STORAGE_SCHEMA_VERSION = 1;
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
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'));
      });
    },
    async delete(key: string): Promise<void> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () =>
          reject(req.error ?? new Error('IndexedDB delete failed'));
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
  const { song } = stored;
  const cellsBySection: Record<string, SectionBandCells> = {};

  for (let secIdx = 0; secIdx < song.sections.length; secIdx++) {
    const section = song.sections[secIdx];
    const storedSec = stored.cellsBySection[section.id];
    if (!storedSec) continue;

    const restored = {} as SectionBandCells;

    // Step 1: Restore locked or outdated-version cells verbatim first
    for (const inst of GENERATION_ORDER) {
      const sCell = storedSec[inst];
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

    // Step 2: Deterministically regenerate unlocked current-version cells in drums -> bass -> keyboard -> pad order
    for (const inst of GENERATION_ORDER) {
      if (restored[inst]) continue;
      const sCell = storedSec[inst];
      const drumNotes = inst === 'bass' ? getSelectedDrumNotes(restored) : [];
      const takes = generateCellTakes(
        song,
        section,
        secIdx,
        inst,
        sCell.seeds,
        drumNotes
      );
      const cell: SectionInstrumentCell = {
        engineVersion: sCell.engineVersion,
        seeds: { ...sCell.seeds },
        selectedTake: sCell.selectedTake,
        locked: false,
        takes,
      };
      restored[inst] = cell;
    }

    cellsBySection[section.id] = restored;
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

export async function saveProject(
  song: SongConfig,
  bandState: BandState,
  backend: StorageBackend = getDefaultStorageBackend(),
  key = DEFAULT_RECORD_KEY
): Promise<SaveResult> {
  try {
    const payload = serializeProject(song, bandState);
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
  const raw = await backend.get(key);
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Partial<StoredBandProject>;
  if (candidate.schemaVersion !== STORAGE_SCHEMA_VERSION || !candidate.song || !candidate.cellsBySection) {
    // Safe initialization on schemaVersion mismatch
    await backend.delete(key);
    return null;
  }
  return hydrateProject(candidate as StoredBandProject);
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

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return { scheduleSave, cancel };
}
