import { generateBassNotes } from '../engines/bassEngine';
import { generateDrumNotes } from '../engines/drumEngine';
import { generateKeyboardNotes } from '../engines/keyboardEngine';
import { generatePadNotes } from '../engines/padEngine';
import { generateVocalNotes } from '../engines/vocalEngine';
import {
  createDefaultEnabledParts,
  createDefaultPartPresets,
  CURRENT_ENGINE_VERSION,
  TICKS_PER_BAR,
  type ChordSlot,
  type CopiedPartPhrase,
  type DensityLevel,
  type DrumAnticipationMode,
  type DrumLoopData,
  type InstrumentType,
  type KeyboardDensityLevel,
  type KickMode,
  type MidiNote,
  type Section,
  type SongConfig,
  type TakeStyle,
  type UnisonRiffData,
  type VocalHarmonyMode,
  type VocalMelodyData,
} from '../types/song';
import type {
  BandState,
  SectionBandCells,
  SectionInstrumentCell,
} from '../types/track';
import {
  cloneChordSlots,
  createUniformChordTimeline,
  normalizeSectionChords,
  resizeTimelineToBars,
} from './chordTimeline';
import { getDefaultProgression, getDiatonicChords } from './chordUtils';
import { resolveInstrumentParams } from './keywordParser';
import { createSeededRng } from './random';

export const GENERATION_ORDER: readonly InstrumentType[] = [
  'drums',
  'bass',
  'keyboard',
  'pad',
  'vocal',
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

export function cloneVocalMelody(
  melody?: VocalMelodyData
): VocalMelodyData | undefined {
  if (!melody) return undefined;
  return {
    ...melody,
    notes: melody.notes.map((n) => ({ ...n })),
  };
}

export function cloneSection(sec: Section): Section {
  const clonedPresets = sec.patternPresets ?? sec.partPresets;
  return {
    ...sec,
    drumAnticipationMode: sec.drumAnticipationMode ?? 'sync',
    vocalHarmony: sec.vocalHarmony ?? 'off',
    bassChromaticEnabled: sec.bassChromaticEnabled ?? false,
    bassFillEnabled: sec.bassFillEnabled ?? false,
    bassFillSeed: sec.bassFillSeed ?? 0,
    chords: normalizeSectionChords(sec.chords, sec.bars),
    patternPresets: clonedPresets
      ? { ...clonedPresets }
      : createDefaultPartPresets(),
    enabledParts: sec.enabledParts
      ? { ...createDefaultEnabledParts(), ...sec.enabledParts }
      : createDefaultEnabledParts(),
    uploadedDrumLoop: cloneDrumLoop(sec.uploadedDrumLoop),
    unisonRiff: cloneUnisonRiff(sec.unisonRiff),
    vocalMelody: cloneVocalMelody(sec.vocalMelody),
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
      vocal: song.members.vocal
        ? { ...song.members.vocal }
        : {
            enabled: true,
            activeSectionsOnly: false,
            patternPreset: 'auto',
            instructionText: '',
          },
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
      if (!c) continue;
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
  drumNotesForBass: MidiNote[] = [],
  prevVocalAvgPitch?: number
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
      kickTicks:
        instrument === 'bass'
          ? drumNotesForBass
              .filter((n) => n.pitch === 35 || n.pitch === 36)
              .map((n) => n.startTick)
          : undefined,
      keyboardDensity:
        instrument === 'keyboard' ? (section.keyboardDensity ?? 4) : undefined,
      prevVocalAvgPitch: instrument === 'vocal' ? prevVocalAvgPitch : undefined,
    };
    if (instrument === 'drums') {
      takes[style] = generateDrumNotes(input);
    } else if (instrument === 'bass') {
      takes[style] = generateBassNotes(input);
    } else if (instrument === 'keyboard') {
      takes[style] = generateKeyboardNotes(input);
    } else if (instrument === 'pad') {
      takes[style] = generatePadNotes(input);
    } else {
      takes[style] = generateVocalNotes(input);
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

export function getAverageVocalPitch(cells?: SectionBandCells): number | undefined {
  const vocalCell = cells?.vocal;
  if (!vocalCell) return undefined;
  const take = vocalCell.selectedTake === 'OFF' ? 'A' : vocalCell.selectedTake;
  const notes = vocalCell.takes[take];
  if (!notes || notes.length === 0) return undefined;
  const sum = notes.reduce((acc, n) => acc + n.pitch, 0);
  return sum / notes.length;
}

/**
 * Generates or regenerates a single section's cells in strict order:
 * drums -> bass -> keyboard -> pad -> vocal
 */
export function generateSectionCells(
  song: SongConfig,
  section: Section,
  sectionIndex: number,
  existing?: SectionBandCells,
  baseSeed = 1000 + sectionIndex * 97,
  options?: {
    newSeeds?: boolean;
    instruments?: InstrumentType[];
    prevVocalAvgPitch?: number;
  }
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

  // Strictly execute generation in order: drums -> bass -> keyboard -> pad -> vocal
  for (const inst of GENERATION_ORDER) {
    const prev = existing?.[inst];
    if (prev?.locked) continue;
    if (!targets.has(inst)) continue;

    const drumNotes =
      inst === 'bass' && section.enabledParts?.drums !== false
        ? getSelectedDrumNotes(result)
        : [];
    result[inst].takes = generateCellTakes(
      song,
      section,
      sectionIndex,
      inst,
      result[inst].seeds,
      drumNotes,
      inst === 'vocal' ? options?.prevVocalAvgPitch : undefined
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
    const prevVocalAvgPitch =
      i > 0
        ? getAverageVocalPitch(cellsBySection[song.sections[i - 1].id])
        : undefined;
    cellsBySection[sec.id] = generateSectionCells(
      song,
      sec,
      i,
      existingState?.cellsBySection[sec.id],
      baseSeed + i * 131,
      { newSeeds, prevVocalAvgPitch }
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

  const prevVocalAvgPitch =
    secIdx > 0
      ? getAverageVocalPitch(nextState.cellsBySection[song.sections[secIdx - 1].id])
      : undefined;

  nextState.cellsBySection[sectionId] = generateSectionCells(
    song,
    section,
    secIdx,
    existingSec,
    seed,
    { newSeeds: true, instruments: targets, prevVocalAvgPitch }
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

export function toggleSectionPartEnabled(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  instrument: InstrumentType,
  enabled?: boolean
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  const currEnabled = sec.enabledParts?.[instrument] ?? true;
  const nextVal = enabled ?? !currEnabled;
  sec.enabledParts = {
    ...createDefaultEnabledParts(),
    ...sec.enabledParts,
    [instrument]: nextVal,
  };

  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];
  if (existingSec) {
    const targets: InstrumentType[] = [];
    if (!existingSec[instrument]?.locked) {
      targets.push(instrument);
    }
    if (
      instrument === 'drums' &&
      !sec.unisonRiff &&
      !existingSec.bass?.locked
    ) {
      targets.push('bass');
    }
    if (targets.length > 0) {
      nextState.cellsBySection[sectionId] = generateSectionCells(
        nextSong,
        sec,
        secIdx,
        existingSec,
        11000 + secIdx,
        { newSeeds: false, instruments: targets }
      );
    }
  }

  return { song: nextSong, bandState: nextState };
}

export function setSectionVocalMelody(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  vocalMelody?: VocalMelodyData,
  seed = 8500
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  nextSong.sections[secIdx].vocalMelody = cloneVocalMelody(vocalMelody);
  const section = nextSong.sections[secIdx];
  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  if (existingSec && !existingSec.vocal?.locked) {
    nextState.cellsBySection[sectionId] = generateSectionCells(
      nextSong,
      section,
      secIdx,
      existingSec,
      seed,
      { newSeeds: false, instruments: ['vocal'] }
    );
  }

  return { song: nextSong, bandState: nextState };
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

export function updateSectionDrumDensity(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  patch: { hatDensity?: DensityLevel; kickDensity?: DensityLevel }
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  if (patch.hatDensity !== undefined) {
    sec.hatDensity = patch.hatDensity;
  }
  if (patch.kickDensity !== undefined) {
    sec.kickDensity = patch.kickDensity;
  }

  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  const targets: InstrumentType[] = [];
  if (!existingSec?.drums?.locked) {
    targets.push('drums');
  }
  if (!sec.unisonRiff && !existingSec?.bass?.locked) {
    targets.push('bass');
  }

  if (targets.length > 0) {
    nextState.cellsBySection[sectionId] = generateSectionCells(
      nextSong,
      sec,
      secIdx,
      existingSec,
      6000 + secIdx,
      { newSeeds: false, instruments: targets }
    );
  }

  return { song: nextSong, bandState: nextState };
}

export function updateSectionVocalDensity(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  vocalDensity: DensityLevel
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  sec.vocalDensity = vocalDensity;

  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  if (existingSec && !existingSec.vocal?.locked) {
    const prevVocalAvgPitch =
      secIdx > 0
        ? getAverageVocalPitch(
            nextState.cellsBySection[nextSong.sections[secIdx - 1].id]
          )
        : undefined;
    nextState.cellsBySection[sectionId] = generateSectionCells(
      nextSong,
      sec,
      secIdx,
      existingSec,
      6500 + secIdx,
      { newSeeds: false, instruments: ['vocal'], prevVocalAvgPitch }
    );
  }

  return { song: nextSong, bandState: nextState };
}

function adaptPhraseNotesToBars(
  notes: readonly MidiNote[],
  sourceBars: number,
  targetBars: number
): MidiNote[] {
  const safeSourceBars = Math.max(1, Math.round(sourceBars));
  const safeTargetBars = Math.max(1, Math.round(targetBars));
  const periodTicks = safeSourceBars * TICKS_PER_BAR;
  const targetEndTicks = safeTargetBars * TICKS_PER_BAR;
  if (notes.length === 0) return [];

  const inPeriod = notes.filter(
    (n) => n.startTick >= 0 && n.startTick < periodTicks
  );
  const cycleNotes = inPeriod.length > 0 ? inPeriod : notes;

  const adapted: MidiNote[] = [];
  for (let base = 0; base < targetEndTicks; base += periodTicks) {
    for (const n of cycleNotes) {
      const absStart = base + n.startTick;
      if (absStart < 0 || absStart >= targetEndTicks) continue;
      const maxDurInCycle = periodTicks - n.startTick;
      const maxDurInSection = targetEndTicks - absStart;
      adapted.push({
        ...n,
        startTick: absStart,
        durationTicks: Math.max(
          1,
          Math.min(n.durationTicks, maxDurInCycle, maxDurInSection)
        ),
      });
    }
  }

  adapted.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  return adapted;
}

export function pastePartPhraseToSection(
  song: SongConfig,
  bandState: BandState,
  targetSectionId: string,
  copiedPhrase: CopiedPartPhrase
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === targetSectionId);
  if (secIdx === -1) return { song, bandState };

  const targetSec = nextSong.sections[secIdx];
  const part = copiedPhrase.part;

  targetSec.patternPresets = {
    ...createDefaultPartPresets(nextSong.members),
    ...(targetSec.patternPresets ?? targetSec.partPresets ?? {}),
    [part]: copiedPhrase.patternPreset,
  };
  if (part === 'bass' && copiedPhrase.unisonRiff !== undefined) {
    targetSec.unisonRiff = cloneUnisonRiff(copiedPhrase.unisonRiff);
  }
  if (part === 'vocal' && copiedPhrase.vocalMelody !== undefined) {
    targetSec.vocalMelody = cloneVocalMelody(copiedPhrase.vocalMelody);
  }
  targetSec.enabledParts = {
    ...createDefaultEnabledParts(),
    ...targetSec.enabledParts,
    [part]: true,
  };

  const adaptedNotes = adaptPhraseNotesToBars(
    copiedPhrase.notes,
    copiedPhrase.sourceBars,
    targetSec.bars
  );

  const nextState = cloneBandState(bandState);
  const existingCells =
    nextState.cellsBySection[targetSectionId] ??
    generateSectionCells(nextSong, targetSec, secIdx, undefined, 5000 + secIdx);

  const prevCell = existingCells[part];
  const targetTake: TakeStyle =
    prevCell && prevCell.selectedTake !== 'OFF' ? prevCell.selectedTake : 'A';

  const nextCell: SectionInstrumentCell = {
    selectedTake: targetTake,
    locked: true,
    engineVersion: prevCell?.engineVersion ?? CURRENT_ENGINE_VERSION,
    seeds: prevCell?.seeds ? { ...prevCell.seeds } : createSeedTriple(5100 + secIdx),
    takes: {
      A: prevCell?.takes.A.map((n) => ({ ...n })) ?? [],
      B: prevCell?.takes.B.map((n) => ({ ...n })) ?? [],
      C: prevCell?.takes.C.map((n) => ({ ...n })) ?? [],
      [targetTake]: adaptedNotes,
    },
  };

  nextState.cellsBySection[targetSectionId] = {
    ...existingCells,
    [part]: nextCell,
  };

  return { song: nextSong, bandState: nextState };
}

export function updateSectionPartPreset(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  instrument: InstrumentType,
  preset: string
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  sec.patternPresets = {
    ...createDefaultPartPresets(nextSong.members),
    ...(sec.patternPresets ?? sec.partPresets ?? {}),
    [instrument]: preset,
  };

  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];
  const targets: InstrumentType[] = [instrument];
  if (instrument === 'drums' && !sec.unisonRiff && !existingSec?.bass?.locked) {
    targets.push('bass');
  }
  const prevVocalAvgPitch =
    secIdx > 0
      ? getAverageVocalPitch(nextState.cellsBySection[nextSong.sections[secIdx - 1].id])
      : undefined;

  if (existingSec) {
    nextState.cellsBySection[sectionId] = generateSectionCells(
      nextSong,
      sec,
      secIdx,
      existingSec,
      5500 + secIdx,
      { newSeeds: false, instruments: targets, prevVocalAvgPitch }
    );
  }

  return { song: nextSong, bandState: nextState };
}

export function updateSectionVocalHarmony(
  song: SongConfig,
  sectionId: string,
  vocalHarmony: VocalHarmonyMode
): SongConfig;
export function updateSectionVocalHarmony(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  vocalHarmony: VocalHarmonyMode
): { song: SongConfig; bandState: BandState };
export function updateSectionVocalHarmony(
  song: SongConfig,
  bandStateOrSectionId: BandState | string,
  sectionIdOrMode: string | VocalHarmonyMode,
  maybeMode?: VocalHarmonyMode
): SongConfig | { song: SongConfig; bandState: BandState } {
  if (typeof bandStateOrSectionId === 'string') {
    const sectionId = bandStateOrSectionId;
    const vocalHarmony = sectionIdOrMode as VocalHarmonyMode;
    const nextSong = cloneSongConfig(song);
    const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
    if (secIdx === -1) return song;
    nextSong.sections[secIdx].vocalHarmony = vocalHarmony;
    return nextSong;
  }

  const bandState = bandStateOrSectionId;
  const sectionId = sectionIdOrMode;
  const vocalHarmony = maybeMode ?? 'off';
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  nextSong.sections[secIdx].vocalHarmony = vocalHarmony;
  return { song: nextSong, bandState };
}

export function updateSectionChordTimeline(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  slots: readonly ChordSlot[]
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  sec.chords = cloneChordSlots(slots);

  const nextState = cloneBandState(bandState);
  const prevVocalAvgPitch =
    secIdx > 0
      ? getAverageVocalPitch(nextState.cellsBySection[nextSong.sections[secIdx - 1].id])
      : undefined;

  nextState.cellsBySection[sectionId] = generateSectionCells(
    nextSong,
    sec,
    secIdx,
    nextState.cellsBySection[sectionId],
    5800 + secIdx,
    { newSeeds: false, prevVocalAvgPitch }
  );

  return { song: nextSong, bandState: nextState };
}

export function updateSectionDrumAnticipationMode(
  song: SongConfig,
  sectionId: string,
  mode: DrumAnticipationMode
): SongConfig;
export function updateSectionDrumAnticipationMode(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  mode: DrumAnticipationMode
): { song: SongConfig; bandState: BandState };
export function updateSectionDrumAnticipationMode(
  song: SongConfig,
  bandStateOrSectionId: BandState | string,
  sectionIdOrMode: string | DrumAnticipationMode,
  maybeMode?: DrumAnticipationMode
): SongConfig | { song: SongConfig; bandState: BandState } {
  if (typeof bandStateOrSectionId === 'string') {
    const sectionId = bandStateOrSectionId;
    const mode = sectionIdOrMode as DrumAnticipationMode;
    const nextSong = cloneSongConfig(song);
    const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
    if (secIdx === -1) return song;
    nextSong.sections[secIdx].drumAnticipationMode = mode;
    return nextSong;
  }

  const bandState = bandStateOrSectionId;
  const sectionId = sectionIdOrMode as string;
  const mode = maybeMode ?? 'sync';
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  sec.drumAnticipationMode = mode;

  const nextState = cloneBandState(bandState);
  nextState.cellsBySection[sectionId] = generateSectionCells(
    nextSong,
    sec,
    secIdx,
    nextState.cellsBySection[sectionId],
    6100 + secIdx,
    { newSeeds: false, instruments: ['drums', 'bass'] }
  );

  return { song: nextSong, bandState: nextState };
}

export function applyTimelineToAllSections(
  song: SongConfig,
  sourceSlots: readonly ChordSlot[]
): SongConfig;
export function applyTimelineToAllSections(
  song: SongConfig,
  bandState: BandState,
  sourceSlots: readonly ChordSlot[]
): { song: SongConfig; bandState: BandState };
export function applyTimelineToAllSections(
  song: SongConfig,
  bandStateOrSlots: BandState | readonly ChordSlot[],
  maybeSlots?: readonly ChordSlot[]
): SongConfig | { song: SongConfig; bandState: BandState } {
  const isSongOnly = Array.isArray(bandStateOrSlots);
  const sourceSlots = (isSongOnly ? bandStateOrSlots : maybeSlots) as readonly ChordSlot[];
  const nextSong = cloneSongConfig(song);

  for (const sec of nextSong.sections) {
    sec.chords = resizeTimelineToBars(cloneChordSlots(sourceSlots, true), sec.bars);
  }

  if (isSongOnly) {
    return nextSong;
  }

  const nextState = generateAllSections(
    nextSong,
    bandStateOrSlots as BandState,
    5900,
    false
  );
  return { song: nextSong, bandState: nextState };
}

export function updateSectionKeyboardDensity(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  keyboardDensity: KeyboardDensityLevel
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  sec.keyboardDensity = keyboardDensity;

  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  if (existingSec && !existingSec.keyboard?.locked) {
    nextState.cellsBySection[sectionId] = generateSectionCells(
      nextSong,
      sec,
      secIdx,
      existingSec,
      6300 + secIdx,
      { newSeeds: false, instruments: ['keyboard'] }
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

export function expandLockedNotesToBars(
  notes: readonly MidiNote[],
  oldBars: number,
  newBars: number
): MidiNote[] {
  if (newBars <= oldBars || notes.length === 0) {
    return notes.map((n) => ({ ...n }));
  }
  const periodTicks = Math.max(1, oldBars) * TICKS_PER_BAR;
  const newEnd = newBars * TICKS_PER_BAR;
  const cycleNotes = notes.filter(
    (n) => n.startTick >= 0 && n.startTick < periodTicks
  );
  if (cycleNotes.length === 0) {
    return notes.map((n) => ({ ...n }));
  }

  const expanded: MidiNote[] = [];
  for (let base = 0; base < newEnd; base += periodTicks) {
    for (const n of cycleNotes) {
      const absTick = base + n.startTick;
      if (absTick >= newEnd) continue;
      const maxDurInCycle = periodTicks - n.startTick;
      const maxDurInSection = newEnd - absTick;
      expanded.push({
        ...n,
        startTick: absTick,
        durationTicks: Math.max(
          1,
          Math.min(n.durationTicks, maxDurInCycle, maxDurInSection)
        ),
      });
    }
  }
  expanded.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  return expanded;
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

  const oldBars = nextSong.sections[secIdx].bars;
  nextSong.sections[secIdx].bars = clampedBars;
  nextSong.sections[secIdx].chords = resizeTimelineToBars(
    nextSong.sections[secIdx].chords,
    clampedBars
  );
  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  // If bars increased, periodically loop-fill locked cells so extended bars are never silent
  if (existingSec && clampedBars > oldBars) {
    for (const inst of GENERATION_ORDER) {
      const cell = existingSec[inst];
      if (cell?.locked) {
        cell.takes = {
          A: expandLockedNotesToBars(cell.takes.A, oldBars, clampedBars),
          B: expandLockedNotesToBars(cell.takes.B, oldBars, clampedBars),
          C: expandLockedNotesToBars(cell.takes.C, oldBars, clampedBars),
        };
      }
    }
  }

  // Unlocked cells regenerate in drums -> bass -> keyboard -> pad order; locked cells remain protected
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
  copy.chords = cloneChordSlots(copy.chords, true);
  nextSong.sections.splice(secIdx + 1, 0, copy);

  const nextState = cloneBandState(bandState);
  const srcCells = nextState.cellsBySection[sectionId];
  if (srcCells) {
    const clonedCells = {} as SectionBandCells;
    for (const inst of GENERATION_ORDER) {
      const c = srcCells[inst];
      if (!c) continue;
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

export function reorderSectionsInSong(
  song: SongConfig,
  fromIndex: number,
  toIndex: number
): SongConfig {
  const len = song.sections.length;
  if (
    len <= 1 ||
    fromIndex < 0 ||
    fromIndex >= len ||
    toIndex < 0 ||
    toIndex >= len ||
    fromIndex === toIndex
  ) {
    return song;
  }
  const nextSong = cloneSongConfig(song);
  const [moved] = nextSong.sections.splice(fromIndex, 1);
  nextSong.sections.splice(toIndex, 0, moved);
  return nextSong;
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
        patternPreset: 'auto',
        drumStyle: 'Standard',
        instructionText: '',
      },
      bass: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: 'auto',
        bassStyle: 'Root Sync',
        bass808Behavior: 'octaveUp',
        instructionText: '',
      },
      keyboard: {
        enabled: true,
        activeSectionsOnly: true,
        patternPreset: 'auto',
        keyboardStyle: 'Rhythm Backing',
        instructionText: '',
      },
      pad: {
        enabled: true,
        activeSectionsOnly: true,
        patternPreset: 'auto',
        padStyle: 'Power',
        instructionText: '',
      },
      vocal: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: 'auto',
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
        hatDensity: 3,
        kickDensity: 3,
        keyboardDensity: 4,
        vocalDensity: 3,
        vocalHarmony: 'off',
        patternPresets: createDefaultPartPresets(),
        enabledParts: createDefaultEnabledParts(),
        chords: createUniformChordTimeline(defaultChords, 4),
      },
      {
        id: 'sec-verse',
        type: 'Verse',
        name: 'Aメロ',
        bars: 8,
        energy: 'Mid',
        kickMode: 'acoustic',
        hatDensity: 3,
        kickDensity: 3,
        keyboardDensity: 4,
        vocalDensity: 3,
        vocalHarmony: 'off',
        patternPresets: createDefaultPartPresets(),
        enabledParts: createDefaultEnabledParts(),
        chords: createUniformChordTimeline(defaultChords, 8),
      },
      {
        id: 'sec-pre',
        type: 'Pre-Chorus',
        name: 'Bメロ',
        bars: 4,
        energy: 'Mid',
        kickMode: 'acoustic',
        hatDensity: 3,
        kickDensity: 3,
        keyboardDensity: 4,
        vocalDensity: 3,
        vocalHarmony: 'off',
        patternPresets: createDefaultPartPresets(),
        enabledParts: createDefaultEnabledParts(),
        chords: createUniformChordTimeline(['Am', 'G', 'C', 'D'], 4),
      },
      {
        id: 'sec-chorus',
        type: 'Chorus',
        name: 'サビ',
        bars: 8,
        energy: 'High',
        kickMode: 'acoustic',
        hatDensity: 3,
        kickDensity: 3,
        keyboardDensity: 4,
        vocalDensity: 3,
        vocalHarmony: 'off',
        patternPresets: createDefaultPartPresets(),
        enabledParts: createDefaultEnabledParts(),
        chords: createUniformChordTimeline(['C', 'D', 'Em', 'G'], 8),
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

export type ArrangementPresetId = 'twoPart' | 'fourPart' | 'full';

export function getSongDurationSummary(song: SongConfig): {
  totalBars: number;
  totalSeconds: number;
  formattedDuration: string;
} {
  const totalBars = song.sections.reduce((sum, s) => sum + s.bars, 0);
  const safeBpm = Math.max(1, song.bpm);
  const totalSeconds = Math.round((totalBars * 4 * 60) / safeBpm);
  const mins = Math.floor(totalSeconds / 60);
  const secs = String(totalSeconds % 60).padStart(2, '0');
  return {
    totalBars,
    totalSeconds,
    formattedDuration: `${mins}:${secs}`,
  };
}

export function applyArrangementPresetToSong(
  song: SongConfig,
  presetId: ArrangementPresetId,
  baseSeed = 4242
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const prog = getDefaultProgression(nextSong.key, nextSong.scale);
  const dia = getDiatonicChords(nextSong.key, nextSong.scale);
  const preChords = [dia[3], dia[2], dia[5], dia[6]];
  const chorusChords = [dia[5], dia[6], dia[0], dia[2]];
  const bridgeChords = [dia[3], dia[4], dia[5], dia[6]];

  const mkId = (slug: string) =>
    `sec-${slug}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  if (presetId === 'twoPart') {
    nextSong.sections = [
      {
        id: mkId('verse'),
        type: 'Verse',
        name: 'Verse',
        bars: 8,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(prog, 8),
      },
      {
        id: mkId('chorus'),
        type: 'Chorus',
        name: 'Chorus',
        bars: 8,
        energy: 'High',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(chorusChords, 8),
      },
    ];
  } else if (presetId === 'fourPart') {
    nextSong.sections = [
      {
        id: mkId('intro'),
        type: 'Intro',
        name: 'Intro',
        bars: 4,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(prog, 4),
      },
      {
        id: mkId('verse'),
        type: 'Verse',
        name: 'Aメロ',
        bars: 8,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(prog, 8),
      },
      {
        id: mkId('pre'),
        type: 'Pre-Chorus',
        name: 'Bメロ',
        bars: 4,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(preChords, 4),
      },
      {
        id: mkId('chorus'),
        type: 'Chorus',
        name: 'サビ',
        bars: 8,
        energy: 'High',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(chorusChords, 8),
      },
    ];
  } else {
    nextSong.sections = [
      {
        id: mkId('intro'),
        type: 'Intro',
        name: 'Intro',
        bars: 4,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(prog, 4),
      },
      {
        id: mkId('verse'),
        type: 'Verse',
        name: 'Aメロ',
        bars: 8,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(prog, 8),
      },
      {
        id: mkId('pre'),
        type: 'Pre-Chorus',
        name: 'Bメロ',
        bars: 4,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(preChords, 4),
      },
      {
        id: mkId('chorus'),
        type: 'Chorus',
        name: 'サビ',
        bars: 8,
        energy: 'High',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(chorusChords, 8),
      },
      {
        id: mkId('bridge'),
        type: 'Bridge',
        name: 'Cメロ',
        bars: 4,
        energy: 'Mid',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(bridgeChords, 4),
      },
      {
        id: mkId('outro'),
        type: 'Outro',
        name: 'Outro',
        bars: 4,
        energy: 'Low',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(prog, 4),
      },
    ];
  }

  nextSong.sections = nextSong.sections.map((s) => ({
    ...s,
    hatDensity: s.hatDensity ?? 3,
    kickDensity: s.kickDensity ?? 3,
    keyboardDensity: s.keyboardDensity ?? 4,
    vocalDensity: s.vocalDensity ?? 3,
    vocalHarmony: s.vocalHarmony ?? 'off',
    bassChromaticEnabled: s.bassChromaticEnabled ?? false,
    bassFillEnabled: s.bassFillEnabled ?? false,
    bassFillSeed: s.bassFillSeed ?? 0,
    patternPresets: createDefaultPartPresets(nextSong.members),
    enabledParts: s.enabledParts ? { ...s.enabledParts } : createDefaultEnabledParts(),
  }));

  const nextState = generateAllSections(nextSong, undefined, baseSeed, true);
  return { song: nextSong, bandState: nextState };
}

function regenerateSectionBassOnly(
  song: SongConfig,
  bandState: BandState,
  sectionId: string
): BandState {
  const secIdx = song.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return bandState;
  const sec = song.sections[secIdx];
  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];
  if (!existingSec) {
    return generateAllSections(song, nextState, 6200 + secIdx, false);
  }
  if (existingSec.bass.locked) {
    return nextState;
  }
  const drumNotes = getSelectedDrumNotes(existingSec);
  const takes = generateCellTakes(
    song,
    sec,
    secIdx,
    'bass',
    { ...existingSec.bass.seeds },
    drumNotes,
    undefined
  );
  existingSec.bass = {
    ...existingSec.bass,
    engineVersion: CURRENT_ENGINE_VERSION,
    takes,
  };
  return nextState;
}

export function setSectionBassChromatic(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  enabled: boolean
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  nextSong.sections[secIdx].bassChromaticEnabled = enabled;
  return {
    song: nextSong,
    bandState: regenerateSectionBassOnly(nextSong, bandState, sectionId),
  };
}

export function setSectionBassFillEnabled(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  enabled: boolean
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  nextSong.sections[secIdx].bassFillEnabled = enabled;
  return {
    song: nextSong,
    bandState: regenerateSectionBassOnly(nextSong, bandState, sectionId),
  };
}

export function rerollSectionBassFill(
  song: SongConfig,
  bandState: BandState,
  sectionId: string
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  nextSong.sections[secIdx].bassFillSeed =
    (nextSong.sections[secIdx].bassFillSeed ?? 0) + 1;
  return {
    song: nextSong,
    bandState: regenerateSectionBassOnly(nextSong, bandState, sectionId),
  };
}
