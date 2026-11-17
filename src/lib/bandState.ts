import { generateBassNotes } from '../engines/bassEngine';
import { generateDrumNotes } from '../engines/drumEngine';
import { generateKeyboardNotes } from '../engines/keyboardEngine';
import { generatePadNotes } from '../engines/padEngine';
import {
  CURRENT_ENGINE_VERSION,
  type DrumLoopData,
  type InstrumentType,
  type KickMode,
  type MidiNote,
  type Section,
  type SongConfig,
  type TakeStyle,
  type UnisonRiffData,
} from '../types/song';
import type {
  BandState,
  SectionBandCells,
  SectionInstrumentCell,
} from '../types/track';
import { getDefaultProgression } from './chordUtils';
import { resolveInstrumentParams } from './keywordParser';
import { createSeededRng } from './random';

export const GENERATION_ORDER: readonly InstrumentType[] = [
  'drums',
  'bass',
  'keyboard',
  'pad',
];

const TAKES: readonly TakeStyle[] = ['A', 'B', 'C'];

export interface BandSnapshot {
  song: SongConfig;
  bandState: BandState;
}

export const MAX_UNDO_HISTORY = 10;

export function cloneDrumLoop(
  loop?: DrumLoopData
): DrumLoopData | undefined {
  if (!loop) return undefined;
  return {
    ...loop,
    notes: loop.notes.map((n) => ({ ...n })),
  };
}

export function cloneUnisonRiff(
  riff?: UnisonRiffData
): UnisonRiffData | undefined {
  if (!riff) return undefined;
  return {
    ...riff,
    cleanedBassNotes: riff.cleanedBassNotes.map((n) => ({ ...n })),
    accentTicks: [...riff.accentTicks],
  };
}

export function cloneSection(sec: Section): Section {
  return {
    ...sec,
    chords: [...sec.chords],
    uploadedDrumLoop: cloneDrumLoop(sec.uploadedDrumLoop),
    unisonRiff: cloneUnisonRiff(sec.unisonRiff),
  };
}

export function cloneSongConfig(song: SongConfig): SongConfig {
  return {
    ...song,
    uploadedDrumLoop: cloneDrumLoop(song.uploadedDrumLoop),
    members: {
      drums: { ...song.members.drums },
      bass: { ...song.members.bass },
      keyboard: { ...song.members.keyboard },
      pad: { ...song.members.pad },
    },
    sections: song.sections.map(cloneSection),
  };
}

export function cloneBandState(state: BandState): BandState {
  const cellsBySection: Record<string, SectionBandCells> = {};
  for (const [secId, cells] of Object.entries(state.cellsBySection)) {
    const clonedCells = {} as SectionBandCells;
    for (const inst of GENERATION_ORDER) {
      const c = cells[inst];
      clonedCells[inst] = {
        engineVersion: c.engineVersion,
        seeds: { ...c.seeds },
        takes: {
          A: c.takes.A.map((n) => ({ ...n })),
          B: c.takes.B.map((n) => ({ ...n })),
          C: c.takes.C.map((n) => ({ ...n })),
        },
        selectedTake: c.selectedTake,
        locked: c.locked,
      };
    }
    cellsBySection[secId] = clonedCells;
  }
  return { cellsBySection };
}

export function createSeedTriple(baseSeed: number): Record<TakeStyle, number> {
  const rng = createSeededRng(baseSeed);
  return {
    A: rng.nextInt(1, 0x7ffffff0),
    B: rng.nextInt(1, 0x7ffffff0),
    C: rng.nextInt(1, 0x7ffffff0),
  };
}

export function generateCellTakes(
  song: SongConfig,
  section: Section,
  sectionIndex: number,
  instrument: InstrumentType,
  seeds: Record<TakeStyle, number>,
  drumNotesForBass: MidiNote[] = []
): Record<TakeStyle, MidiNote[]> {
  const takes = {} as Record<TakeStyle, MidiNote[]>;
  for (const style of TAKES) {
    const params = resolveInstrumentParams(song, section, instrument, style);
    const input = {
      song,
      section,
      sectionIndex,
      style,
      seed: seeds[style],
      params,
      drumNotes: instrument === 'bass' ? drumNotesForBass : undefined,
    };
    if (instrument === 'drums') {
      takes[style] = generateDrumNotes(input);
    } else if (instrument === 'bass') {
      takes[style] = generateBassNotes(input);
    } else if (instrument === 'keyboard') {
      takes[style] = generateKeyboardNotes(input);
    } else {
      takes[style] = generatePadNotes(input);
    }
  }
  return takes;
}

export function getSelectedDrumNotes(
  cells?: SectionBandCells
): MidiNote[] {
  if (!cells) return [];
  const drumCell = cells.drums;
  if (!drumCell || drumCell.selectedTake === 'OFF') return [];
  return drumCell.takes[drumCell.selectedTake] ?? [];
}

/**
 * Generates or regenerates a single section's cells in strict order:
 * drums -> bass -> keyboard -> pad
 */
export function generateSectionCells(
  song: SongConfig,
  section: Section,
  sectionIndex: number,
  existing?: SectionBandCells,
  baseSeed = 1000 + sectionIndex * 97,
  options?: { newSeeds?: boolean; instruments?: InstrumentType[] }
): SectionBandCells {
  const targets = new Set(options?.instruments ?? GENERATION_ORDER);
  const newSeeds = options?.newSeeds ?? false;
  const rng = createSeededRng(baseSeed);

  const result = {} as SectionBandCells;

  // Initialize from existing or create fresh shells first
  for (const inst of GENERATION_ORDER) {
    const prev = existing?.[inst];
    if (prev && prev.locked) {
      result[inst] = {
        ...prev,
        seeds: { ...prev.seeds },
        takes: {
          A: prev.takes.A.map((n) => ({ ...n })),
          B: prev.takes.B.map((n) => ({ ...n })),
          C: prev.takes.C.map((n) => ({ ...n })),
        },
      };
    } else if (prev && !targets.has(inst)) {
      result[inst] = {
        ...prev,
        seeds: { ...prev.seeds },
        takes: {
          A: prev.takes.A.map((n) => ({ ...n })),
          B: prev.takes.B.map((n) => ({ ...n })),
          C: prev.takes.C.map((n) => ({ ...n })),
        },
      };
    } else {
      const seeds =
        prev && !newSeeds
          ? { ...prev.seeds }
          : createSeedTriple(rng.nextInt(1, 0x7ffffff0));
      result[inst] = {
        engineVersion: CURRENT_ENGINE_VERSION,
        seeds,
        takes: { A: [], B: [], C: [] },
        selectedTake: prev?.selectedTake ?? 'A',
        locked: false,
      };
    }
  }

  // Strictly execute generation in order: drums -> bass -> keyboard -> pad
  for (const inst of GENERATION_ORDER) {
    const prev = existing?.[inst];
    if (prev?.locked) continue;
    if (!targets.has(inst)) continue;

    const drumNotes = inst === 'bass' ? getSelectedDrumNotes(result) : [];
    result[inst].takes = generateCellTakes(
      song,
      section,
      sectionIndex,
      inst,
      result[inst].seeds,
      drumNotes
    );
    result[inst].engineVersion = CURRENT_ENGINE_VERSION;
  }

  return result;
}

export function generateAllSections(
  song: SongConfig,
  existingState?: BandState,
  baseSeed = 4242,
  newSeeds = false
): BandState {
  const cellsBySection: Record<string, SectionBandCells> = {};
  for (let i = 0; i < song.sections.length; i++) {
    const sec = song.sections[i];
    cellsBySection[sec.id] = generateSectionCells(
      song,
      sec,
      i,
      existingState?.cellsBySection[sec.id],
      baseSeed + i * 131,
      { newSeeds }
    );
  }
  return { cellsBySection };
}

export function regenerateInstrumentCell(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  instrument: InstrumentType,
  seed: number
): BandState {
  const secIdx = song.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return bandState;
  const section = song.sections[secIdx];
  const existingSec = bandState.cellsBySection[sectionId];
  if (existingSec?.[instrument]?.locked) {
    return bandState;
  }

  const nextState = cloneBandState(bandState);
  const targets: InstrumentType[] = [instrument];

  // If drums changed & bass is unlocked & !unisonRiff -> auto-sync bass
  if (
    instrument === 'drums' &&
    !section.unisonRiff &&
    !existingSec?.bass?.locked
  ) {
    targets.push('bass');
  }

  nextState.cellsBySection[sectionId] = generateSectionCells(
    song,
    section,
    secIdx,
    existingSec,
    seed,
    { newSeeds: true, instruments: targets }
  );
  return nextState;
}

export function selectInstrumentTake(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  instrument: InstrumentType,
  take: TakeStyle | 'OFF'
): BandState {
  const secIdx = song.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return bandState;
  const section = song.sections[secIdx];
  const existingSec = bandState.cellsBySection[sectionId];
  if (!existingSec || existingSec[instrument].locked) {
    return bandState;
  }

  const nextState = cloneBandState(bandState);
  nextState.cellsBySection[sectionId][instrument].selectedTake = take;

  // Drum Take A/B/C/OFF change -> auto-sync unlocked bass when !unisonRiff
  if (
    instrument === 'drums' &&
    !section.unisonRiff &&
    !nextState.cellsBySection[sectionId].bass.locked
  ) {
    nextState.cellsBySection[sectionId] = generateSectionCells(
      song,
      section,
      secIdx,
      nextState.cellsBySection[sectionId],
      Date.now(),
      { newSeeds: false, instruments: ['bass'] }
    );
  }

  return nextState;
}

export function toggleCellLock(
  bandState: BandState,
  sectionId: string,
  instrument: InstrumentType
): BandState {
  const existing = bandState.cellsBySection[sectionId];
  if (!existing) return bandState;
  const next = cloneBandState(bandState);
  next.cellsBySection[sectionId][instrument].locked =
    !next.cellsBySection[sectionId][instrument].locked;
  return next;
}

export function updateSectionKickMode(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  kickMode: KickMode
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  nextSong.sections[secIdx].kickMode = kickMode;
  const section = nextSong.sections[secIdx];
  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  if (existingSec && !section.unisonRiff && !existingSec.bass.locked) {
    nextState.cellsBySection[sectionId] = generateSectionCells(
      nextSong,
      section,
      secIdx,
      existingSec,
      5000 + secIdx,
      { newSeeds: false, instruments: ['bass'] }
    );
  }

  return { song: nextSong, bandState: nextState };
}

export function updateSectionDrumLoop(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  drumLoop?: DrumLoopData,
  seed = 7000
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  nextSong.sections[secIdx].uploadedDrumLoop = cloneDrumLoop(drumLoop);
  const section = nextSong.sections[secIdx];
  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  const targets: InstrumentType[] = ['drums'];
  if (!section.unisonRiff && !existingSec?.bass?.locked) {
    targets.push('bass');
  }

  nextState.cellsBySection[sectionId] = generateSectionCells(
    nextSong,
    section,
    secIdx,
    existingSec,
    seed,
    { newSeeds: false, instruments: targets }
  );

  return { song: nextSong, bandState: nextState };
}

export function setSectionUnisonRiff(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  unisonRiff?: UnisonRiffData,
  seed = 8000
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  nextSong.sections[secIdx].unisonRiff = cloneUnisonRiff(unisonRiff);
  const section = nextSong.sections[secIdx];
  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  // Auto-regen drums -> bass in order for unlocked cells
  nextState.cellsBySection[sectionId] = generateSectionCells(
    nextSong,
    section,
    secIdx,
    existingSec,
    seed,
    { newSeeds: false, instruments: ['drums', 'bass'] }
  );

  return { song: nextSong, bandState: nextState };
}

export function toggleSectionRiffOctaveUpOn808(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  octaveUpOn808?: boolean
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  const section = nextSong.sections[secIdx];
  if (!section.unisonRiff) return { song, bandState };

  section.unisonRiff.octaveUpOn808 =
    octaveUpOn808 ?? !section.unisonRiff.octaveUpOn808;

  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  // Only recalculate unlocked bass; drums accentTicks are unchanged
  if (existingSec && !existingSec.bass.locked) {
    nextState.cellsBySection[sectionId] = generateSectionCells(
      nextSong,
      section,
      secIdx,
      existingSec,
      9000 + secIdx,
      { newSeeds: false, instruments: ['bass'] }
    );
  }

  return { song: nextSong, bandState: nextState };
}

export function updateSectionBars(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  bars: number
): { song: SongConfig; bandState: BandState } {
  const clampedBars = Math.min(32, Math.max(1, Math.round(bars)));
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  nextSong.sections[secIdx].bars = clampedBars;
  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  // Unlocked cells regenerate in drums -> bass -> keyboard -> pad order; locked cells untouched
  nextState.cellsBySection[sectionId] = generateSectionCells(
    nextSong,
    nextSong.sections[secIdx],
    secIdx,
    existingSec,
    10000 + secIdx,
    { newSeeds: false }
  );

  return { song: nextSong, bandState: nextState };
}

export function duplicateSectionInSong(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  newId: string
): { song: SongConfig; bandState: BandState } {
  const secIdx = song.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const nextSong = cloneSongConfig(song);
  const copy = cloneSection(nextSong.sections[secIdx]);
  copy.id = newId;
  copy.name = `${copy.name} (Copy)`;
  nextSong.sections.splice(secIdx + 1, 0, copy);

  const nextState = cloneBandState(bandState);
  const srcCells = nextState.cellsBySection[sectionId];
  if (srcCells) {
    const clonedCells = {} as SectionBandCells;
    for (const inst of GENERATION_ORDER) {
      const c = srcCells[inst];
      clonedCells[inst] = {
        engineVersion: c.engineVersion,
        seeds: { ...c.seeds },
        takes: {
          A: c.takes.A.map((n) => ({ ...n })),
          B: c.takes.B.map((n) => ({ ...n })),
          C: c.takes.C.map((n) => ({ ...n })),
        },
        selectedTake: c.selectedTake,
        locked: false,
      };
    }
    nextState.cellsBySection[newId] = clonedCells;
  } else {
    nextState.cellsBySection[newId] = generateSectionCells(
      nextSong,
      copy,
      secIdx + 1
    );
  }

  return { song: nextSong, bandState: nextState };
}

export function isDrumLockedUnsynced(
  section: Section,
  cells?: SectionBandCells
): boolean {
  return Boolean(section.unisonRiff && cells?.drums?.locked);
}

export function isCellOutdated(cell?: SectionInstrumentCell): boolean {
  return Boolean(cell && cell.engineVersion !== CURRENT_ENGINE_VERSION);
}

export function pushUndoSnapshot(
  history: readonly BandSnapshot[],
  snapshot: BandSnapshot
): BandSnapshot[] {
  const cloned: BandSnapshot = {
    song: cloneSongConfig(snapshot.song),
    bandState: cloneBandState(snapshot.bandState),
  };
  const next = [...history, cloned];
  if (next.length > MAX_UNDO_HISTORY) {
    return next.slice(next.length - MAX_UNDO_HISTORY);
  }
  return next;
}

export type QuickTemplateId =
  | 'rockBand'
  | 'metal3Piece'
  | 'shoegaze'
  | 'trapHybrid';

export function createDefaultSongConfig(
  template: QuickTemplateId = 'rockBand'
): SongConfig {
  const defaultChords = getDefaultProgression('E', 'Minor');

  const base: SongConfig = {
    title: 'New Band Song',
    bpm: 135,
    key: 'E',
    scale: 'Minor',
    timeSignature: '4/4',
    beatFeel: 'Straight',
    swing: 0,
    swingTarget: '8th',
    exportOnlyActiveTracks: true,
    split808KickTrack: true,
    members: {
      drums: {
        enabled: true,
        activeSectionsOnly: false,
        drumStyle: 'Standard',
        instructionText: '',
      },
      bass: {
        enabled: true,
        activeSectionsOnly: false,
        bassStyle: 'Root Sync',
        bass808Behavior: 'octaveUp',
        instructionText: '',
      },
      keyboard: {
        enabled: true,
        activeSectionsOnly: true,
        keyboardStyle: 'Rhythm Backing',
        instructionText: '',
      },
      pad: {
        enabled: true,
        activeSectionsOnly: true,
        padStyle: 'Power',
        instructionText: '',
      },
    },
    sections: [
      {
        id: 'sec-intro',
        type: 'Intro',
        name: 'イントロ',
        bars: 4,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: [...defaultChords],
      },
      {
        id: 'sec-verse',
        type: 'Verse',
        name: 'Aメロ',
        bars: 8,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: [...defaultChords],
      },
      {
        id: 'sec-pre',
        type: 'Pre-Chorus',
        name: 'Bメロ',
        bars: 4,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: ['Am', 'G', 'C', 'D'],
      },
      {
        id: 'sec-chorus',
        type: 'Chorus',
        name: 'サビ',
        bars: 8,
        energy: 'High',
        kickMode: 'acoustic',
        chords: ['C', 'D', 'Em', 'G'],
      },
    ],
  };

  if (template === 'metal3Piece') {
    base.title = 'Metal 3-Piece Riff';
    base.bpm = 160;
    base.beatFeel = 'Driving';
    base.members.drums.drumStyle = 'Double Kick';
    base.members.drums.instructionText = 'ツーバス 激しい';
    base.members.bass.bassStyle = 'Driving 8th';
    base.members.keyboard.enabled = false;
    base.members.pad.enabled = false;
  } else if (template === 'shoegaze') {
    base.title = 'Shoegaze Float';
    base.bpm = 112;
    base.beatFeel = 'Half-Time';
    base.members.drums.drumStyle = 'Heavy / Half-Time';
    base.members.keyboard.activeSectionsOnly = false;
    base.members.keyboard.keyboardStyle = 'Long Sustain';
    base.members.keyboard.instructionText = '浮遊 シューゲイザー';
    base.members.pad.activeSectionsOnly = false;
    base.members.pad.padStyle = 'Floating Tension';
    base.members.pad.instructionText = 'deftones 空間';
  } else if (template === 'trapHybrid') {
    base.title = '808 Hybrid Bounce';
    base.bpm = 142;
    base.beatFeel = 'Bounce';
    base.swing = 15;
    base.swingTarget = '16th';
    base.members.drums.drumStyle = 'Sub-Step / Trap';
    base.members.drums.instructionText = 'トラップ ロール';
    base.members.bass.bass808Behavior = 'octaveUp';
    base.sections = base.sections.map((s) => ({
      ...s,
      kickMode: s.type === 'Verse' || s.type === 'Intro' ? '808' : 'acoustic',
    }));
  }

  return base;
}
