import { generateBassResult } from '../engines/bassEngine';
import { generateDrumNotes } from '../engines/drumEngine';
import { generateKeyboardResult } from '../engines/keyboardEngine';
import {
  buildSectionChordEvents,
  computeVocalMinMidiByBar,
  deriveSubSeed,
  parseCustomChordProgression,
  resolveVocalVoiceProfile,
  serializeChordSlotsToText,
} from '../engines/musicCore';
import { generatePadResult } from '../engines/padEngine';
import { generateVocalNotes } from '../engines/vocalEngine';
import {
  createDefaultEnabledParts,
  createDefaultPartPresets,
  CURRENT_ENGINE_VERSION,
  getDefaultDrumFillEnabled,
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type AccompanimentTake,
  type BassLockMode,
  type BassSkeletonId,
  type BeatPatternId,
  type ChapterInternalForm,
  type ChordEvent,
  type ChordLockMode,
  type ChordSlot,
  type CopiedPartPhrase,
  type DensityLevel,
  type DrumAnticipationMode,
  type DrumLoopData,
  type EightBarScheme,
  type InstrumentType,
  type KeyboardDensityLevel,
  type KeyboardSkeletonId,
  type KickMode,
  type KickTake,
  type MidiControlChangeEvent,
  type MidiNote,
  type PadSkeletonId,
  type Section,
  type SongConfig,
  type TakeStyle,
  type UnisonRiffData,
  type VocalHarmonyMode,
  type VocalMelodyData,
  type VocalVoicePresetId,
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
import {
  getDefaultProgression,
  getDiatonicChords,
  noteNameToSemitone,
} from './chordUtils';
import {
  inferPowerChordProgressionFromBassNotes,
  normalizeOverrideBassNotes,
} from './riffProcessor';
import { resolveInstrumentParams } from './keywordParser';
import {
  MASTER_GENRES,
  type MasterGenreId,
} from './masterGenres';
import { createSeededRng } from './random';

export const GENERATION_ORDER: readonly InstrumentType[] = [
  'drums',
  'bass',
  'keyboard',
  'pad',
  'vocal',
];

/** Strict 1-way pipeline order: Stage 2 (vocal) runs BEFORE Stage 3 (keyboard, pad). */
export const PIPELINE_EXECUTION_ORDER: readonly InstrumentType[] = [
  'drums',
  'bass',
  'vocal',
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
    drumPatternId: sec.drumPatternId ?? 'auto',
    drumKickTake: sec.drumKickTake ?? 'auto',
    drumHat16thEnabled: sec.drumHat16thEnabled ?? false,
    drumFillEnabled:
      sec.drumFillEnabled ?? getDefaultDrumFillEnabled(sec.type, sec.bars),
    drumBreakEnabled: sec.drumBreakEnabled ?? false,
    vocalHarmony: sec.vocalHarmony ?? 'off',
    vocalDialecticalScheme: sec.vocalDialecticalScheme ?? 'auto',
    vocalChapterForm: sec.vocalChapterForm ?? 'auto',
    bassChromaticEnabled: sec.bassChromaticEnabled ?? false,
    bassFillEnabled: sec.bassFillEnabled ?? false,
    bassFillSeed: sec.bassFillSeed ?? 0,
    bassSkeleton: sec.bassSkeleton ?? 'auto',
    bassTake: sec.bassTake ?? 'auto',
    keyboardSkeleton: sec.keyboardSkeleton ?? 'auto',
    keyboardTake: sec.keyboardTake ?? 'auto',
    padSkeleton: sec.padSkeleton ?? 'auto',
    padTake: sec.padTake ?? 'auto',
    chordLockMode: sec.chordLockMode ?? 'auto',
    customChordsText: sec.customChordsText ?? '',
    bassLockMode: sec.bassLockMode ?? 'auto',
    overrideBassNotes: sec.overrideBassNotes
      ? sec.overrideBassNotes.map((n) => ({ ...n }))
      : null,
    overrideBassSourceLabel: sec.overrideBassSourceLabel,
    overrideBassShiftOctave: sec.overrideBassShiftOctave ?? true,
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
    vocalVoiceProfileId: song.vocalVoiceProfileId ?? 'chisa_jp',
    vocalCustomMinMidi: song.vocalCustomMinMidi ?? 55,
    vocalCustomMaxMidi: song.vocalCustomMaxMidi ?? 74,
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

export function resolveSectionChordEvents(
  song: SongConfig,
  section: Section
): ChordEvent[] {
  if (
    section.chordLockMode === 'custom' &&
    section.customChordsText &&
    section.customChordsText.trim().length > 0
  ) {
    const genreHint =
      section.patternPresets?.keyboard ??
      section.patternPresets?.vocal ??
      song.members.keyboard.patternPreset ??
      song.members.vocal?.patternPreset;
    const parsed = parseCustomChordProgression(
      section.customChordsText,
      section.bars,
      noteNameToSemitone(song.key),
      song.scale,
      genreHint
    );
    if (parsed.valid && parsed.chordEvents.length > 0) {
      return parsed.chordEvents;
    }
  }
  return buildSectionChordEvents(section, song.key, song.scale);
}

export function generateCellTakesWithCC(
  song: SongConfig,
  section: Section,
  sectionIndex: number,
  instrument: InstrumentType,
  seeds: Record<TakeStyle, number>,
  drumNotesForBass: MidiNote[] = [],
  prevVocalAvgPitch?: number,
  contextNotes?: {
    drumNotes?: MidiNote[];
    bassNotes?: MidiNote[];
    keyboardNotes?: MidiNote[];
    vocalNotes?: MidiNote[];
    chordEvents?: readonly ChordEvent[];
    vocalMinMidiByBar?: readonly (number | null)[];
  }
): {
  takes: Record<TakeStyle, MidiNote[]>;
  controlChangesByTake?: Record<TakeStyle, MidiControlChangeEvent[]>;
} {
  const takes = {} as Record<TakeStyle, MidiNote[]>;
  const controlChangesByTake = {} as Record<TakeStyle, MidiControlChangeEvent[]>;
  let hasAnyCC = false;

  const chordEvents =
    contextNotes?.chordEvents ?? resolveSectionChordEvents(song, section);
  const vocalVoiceProfile = resolveVocalVoiceProfile(song);
  const vocalMinMidiByBar =
    contextNotes?.vocalMinMidiByBar ??
    computeVocalMinMidiByBar(contextNotes?.vocalNotes, section.bars);
  const lastChorusIdx = song.sections.reduce(
    (last, s, idx) => (s.type === 'Chorus' ? idx : last),
    -1
  );
  const isFinalChorusSection =
    section.type === 'Chorus' &&
    (sectionIndex === lastChorusIdx || lastChorusIdx === -1);

  const drumSource =
    instrument === 'bass'
      ? drumNotesForBass
      : (contextNotes?.drumNotes ?? drumNotesForBass);
  const kickTicks = drumSource
    .filter((n) => n.pitch === 35 || n.pitch === 36)
    .map((n) => n.startTick);

  for (const style of TAKES) {
    const params = resolveInstrumentParams(song, section, instrument, style);
    const nextSection = song.sections[sectionIndex + 1];
    const nextSectionFirstChord = nextSection?.chords?.[0]?.chord;
    const input = {
      song,
      section,
      sectionIndex,
      style,
      seed: seeds[style],
      params,
      chordEvents,
      vocalVoiceProfile,
      vocalMinMidiByBar:
        instrument === 'keyboard' || instrument === 'pad'
          ? vocalMinMidiByBar
          : undefined,
      isFinalChorusSection:
        instrument === 'vocal' ? isFinalChorusSection : undefined,
      drumNotes:
        instrument === 'bass' || instrument === 'keyboard' || instrument === 'pad'
          ? drumSource
          : undefined,
      kickTicks:
        instrument === 'bass' || instrument === 'pad' ? kickTicks : undefined,
      bassNotes:
        instrument === 'keyboard' || instrument === 'pad'
          ? contextNotes?.bassNotes
          : undefined,
      keyboardNotes:
        instrument === 'pad' ? contextNotes?.keyboardNotes : undefined,
      vocalNotes:
        instrument === 'keyboard' || instrument === 'pad'
          ? contextNotes?.vocalNotes
          : undefined,
      bpm: song.bpm,
      keyboardDensity:
        instrument === 'keyboard' ? (section.keyboardDensity ?? 4) : undefined,
      drumPatternId: section.drumPatternId ?? 'auto',
      drumKickTake:
        instrument === 'drums' ? (section.drumKickTake ?? 'auto') : undefined,
      drumHat16thEnabled:
        instrument === 'drums'
          ? (section.drumHat16thEnabled ?? false)
          : undefined,
      drumFillEnabled:
        instrument === 'drums'
          ? (section.drumFillEnabled ??
            getDefaultDrumFillEnabled(section.type, section.bars))
          : undefined,
      drumBreakEnabled:
        instrument === 'drums'
          ? (section.drumBreakEnabled ?? false)
          : undefined,
      prevVocalAvgPitch:
        instrument === 'vocal' ||
        instrument === 'keyboard' ||
        instrument === 'pad'
          ? prevVocalAvgPitch
          : undefined,
      nextSectionFirstChord:
        instrument === 'vocal' ? nextSectionFirstChord : undefined,
      nextSectionType:
        instrument === 'vocal' ? nextSection?.type : undefined,
      nextSectionEnergy:
        instrument === 'vocal' ? nextSection?.energy : undefined,
      vocalDialecticalScheme:
        instrument === 'vocal'
          ? (section.vocalDialecticalScheme ?? 'auto')
          : undefined,
      vocalChapterForm:
        instrument === 'vocal'
          ? (section.vocalChapterForm ?? 'auto')
          : undefined,
      bassSkeleton:
        instrument === 'bass' ? (section.bassSkeleton ?? 'auto') : undefined,
      bassTake:
        instrument === 'bass' ? (section.bassTake ?? 'auto') : undefined,
      keyboardSkeleton:
        instrument === 'keyboard'
          ? (section.keyboardSkeleton ?? 'auto')
          : undefined,
      keyboardTake:
        instrument === 'keyboard'
          ? (section.keyboardTake ?? 'auto')
          : undefined,
      padSkeleton:
        instrument === 'pad' ? (section.padSkeleton ?? 'auto') : undefined,
      padTake:
        instrument === 'pad' ? (section.padTake ?? 'auto') : undefined,
    };
    if (instrument === 'drums') {
      takes[style] = generateDrumNotes(input);
    } else if (instrument === 'bass') {
      if (
        section.bassLockMode === 'midi_override' &&
        section.overrideBassNotes &&
        section.overrideBassNotes.length > 0
      ) {
        // Bypass bassEngine: adopt normalized Basic Pitch / imported MIDI bass notes verbatim
        const sectionEnd = Math.max(1, section.bars) * TICKS_PER_BAR;
        const lockedNotes = section.overrideBassNotes
          .filter((n) => n.startTick >= 0 && n.startTick < sectionEnd)
          .map((n) => ({
            ...n,
            durationTicks: Math.max(1, Math.min(n.durationTicks, sectionEnd - n.startTick)),
            channel: TRACK_CHANNELS.bass,
          }));
        takes[style] = lockedNotes;
        // Maintain MODO BASS 2 CC#9 = 0 safety reset
        controlChangesByTake[style] = [
          { tick: 0, controller: 9, value: 0, channel: TRACK_CHANNELS.bass },
          { tick: sectionEnd, controller: 9, value: 0, channel: TRACK_CHANNELS.bass },
        ];
        hasAnyCC = true;
      } else {
        const res = generateBassResult(input);
        takes[style] = res.notes;
        controlChangesByTake[style] = res.controlChanges;
        if (res.controlChanges.length > 0) hasAnyCC = true;
      }
    } else if (instrument === 'keyboard') {
      const res = generateKeyboardResult(input);
      takes[style] = res.notes;
      controlChangesByTake[style] = res.controlChanges;
      if (res.controlChanges.length > 0) hasAnyCC = true;
    } else if (instrument === 'pad') {
      const res = generatePadResult(input);
      takes[style] = res.notes;
      controlChangesByTake[style] = res.controlChanges;
      if (res.controlChanges.length > 0) hasAnyCC = true;
    } else {
      takes[style] = generateVocalNotes(input);
    }
  }
  return hasAnyCC ? { takes, controlChangesByTake } : { takes };
}

export function generateCellTakes(
  song: SongConfig,
  section: Section,
  sectionIndex: number,
  instrument: InstrumentType,
  seeds: Record<TakeStyle, number>,
  drumNotesForBass: MidiNote[] = [],
  prevVocalAvgPitch?: number,
  contextNotes?: {
    drumNotes?: MidiNote[];
    bassNotes?: MidiNote[];
    keyboardNotes?: MidiNote[];
    vocalNotes?: MidiNote[];
  }
): Record<TakeStyle, MidiNote[]> {
  return generateCellTakesWithCC(
    song,
    section,
    sectionIndex,
    instrument,
    seeds,
    drumNotesForBass,
    prevVocalAvgPitch,
    contextNotes
  ).takes;
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
          : createSeedTriple(
              deriveSubSeed(baseSeed, `stage:${inst}:${sectionIndex}`)
            );
      result[inst] = {
        engineVersion: CURRENT_ENGINE_VERSION,
        seeds,
        takes: { A: [], B: [], C: [] },
        selectedTake: prev?.selectedTake ?? 'A',
        locked: false,
      };
    }
  }
  void rng;

  // Stage 1: Resolve dynamic Berklee ChordEvent[] once per section (respecting custom chord lock)
  const chordEvents = resolveSectionChordEvents(song, section);

  // Strictly execute in 1-way pipeline order: drums -> bass -> vocal (Stage 2) -> keyboard -> pad (Stage 3)
  for (const inst of PIPELINE_EXECUTION_ORDER) {
    const prev = existing?.[inst];
    if (prev?.locked) continue;
    if (!targets.has(inst)) continue;

    const drumNotes =
      (inst === 'bass' || inst === 'keyboard' || inst === 'pad') &&
      section.enabledParts?.drums !== false
        ? getSelectedDrumNotes(result)
        : [];
    const bassCell = result.bass;
    const bassNotesForContext =
      (inst === 'keyboard' || inst === 'pad') &&
      bassCell &&
      bassCell.selectedTake !== 'OFF' &&
      section.enabledParts?.bass !== false
        ? bassCell.takes[bassCell.selectedTake] ?? []
        : [];
    const kbCell = result.keyboard;
    const kbNotesForPad =
      inst === 'pad' &&
      kbCell &&
      kbCell.selectedTake !== 'OFF' &&
      section.enabledParts?.keyboard !== false
        ? kbCell.takes[kbCell.selectedTake] ?? []
        : [];
    const resolvedVocalCell = result.vocal ?? existing?.vocal;
    const vocalNotesForContext =
      inst === 'keyboard' || inst === 'pad'
        ? section.vocalMelody?.notes ??
          (resolvedVocalCell &&
          resolvedVocalCell.selectedTake !== 'OFF' &&
          section.enabledParts?.vocal !== false &&
          song.members.vocal?.enabled !== false
            ? resolvedVocalCell.takes[resolvedVocalCell.selectedTake]
            : undefined)
        : undefined;
    const vocalMinMidiByBar =
      inst === 'keyboard' || inst === 'pad'
        ? computeVocalMinMidiByBar(vocalNotesForContext, section.bars)
        : undefined;

    const generated = generateCellTakesWithCC(
      song,
      section,
      sectionIndex,
      inst,
      result[inst].seeds,
      drumNotes,
      inst === 'vocal' || inst === 'keyboard' || inst === 'pad'
        ? options?.prevVocalAvgPitch
        : undefined,
      {
        drumNotes,
        bassNotes: bassNotesForContext,
        keyboardNotes: kbNotesForPad,
        vocalNotes: vocalNotesForContext,
        chordEvents,
        vocalMinMidiByBar,
      }
    );
    result[inst].takes = generated.takes;
    result[inst].controlChangesByTake = generated.controlChangesByTake;
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
  vocalDensity: number
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  sec.vocalDensity = Math.max(1, Math.min(5, Math.round(vocalDensity * 10) / 10));

  const nextState = cloneBandState(bandState);
  const existingSec = nextState.cellsBySection[sectionId];

  if (existingSec) {
    const prevVocalAvgPitch =
      secIdx > 0
        ? getAverageVocalPitch(
            nextState.cellsBySection[nextSong.sections[secIdx - 1].id]
          )
        : undefined;
    const regenTargets: InstrumentType[] = [];
    if (!existingSec.vocal?.locked) regenTargets.push('vocal');
    if (!existingSec.keyboard?.locked) regenTargets.push('keyboard');
    if (!existingSec.pad?.locked) regenTargets.push('pad');

    if (regenTargets.length > 0) {
      nextState.cellsBySection[sectionId] = generateSectionCells(
        nextSong,
        sec,
        secIdx,
        existingSec,
        6500 + secIdx,
        { newSeeds: false, instruments: regenTargets, prevVocalAvgPitch }
      );
    }
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

export function updateSectionVocalDialecticalScheme(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  scheme: EightBarScheme | 'auto'
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  sec.vocalDialecticalScheme = scheme;

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
      6610 + secIdx,
      { newSeeds: false, instruments: ['vocal'], prevVocalAvgPitch }
    );
  }
  return { song: nextSong, bandState: nextState };
}

export function updateSectionVocalChapterForm(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  form: ChapterInternalForm | 'auto'
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  sec.vocalChapterForm = form;

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
      6620 + secIdx,
      { newSeeds: false, instruments: ['vocal'], prevVocalAvgPitch }
    );
  }
  return { song: nextSong, bandState: nextState };
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
  | MasterGenreId
  | 'rockBand'
  | 'metal3Piece'
  | 'shoegaze'
  | 'trapHybrid';

function buildStandard84BarSections(
  verseChords: string[],
  preChords: string[],
  chorusChords: string[],
  bridgeChords: string[],
  mkId?: (slug: string) => string
): Section[] {
  const idFor = (slug: string, fixedId: string) => (mkId ? mkId(slug) : fixedId);
  return [
    {
      id: idFor('intro', 'sec-intro'),
      type: 'Intro',
      name: 'イントロ',
      bars: 8,
      energy: 'Mid',
      kickMode: 'acoustic',
      drumHat16thEnabled: false,
      drumFillEnabled: true,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      patternPresets: createDefaultPartPresets(),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(verseChords, 8),
    },
    {
      id: idFor('verse1', 'sec-verse'),
      type: 'Verse',
      name: '1Aメロ',
      bars: 8,
      energy: 'Mid',
      kickMode: 'acoustic',
      drumHat16thEnabled: false,
      drumFillEnabled: true,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      patternPresets: createDefaultPartPresets(),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(verseChords, 8),
    },
    {
      id: idFor('pre1', 'sec-pre'),
      type: 'Pre-Chorus',
      name: '1Bメロ',
      bars: 8,
      energy: 'Mid',
      kickMode: 'acoustic',
      drumHat16thEnabled: false,
      drumFillEnabled: true,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      patternPresets: createDefaultPartPresets(),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(preChords, 8),
    },
    {
      id: idFor('chorus1', 'sec-chorus'),
      type: 'Chorus',
      name: '1サビ',
      bars: 8,
      energy: 'High',
      kickMode: 'acoustic',
      drumHat16thEnabled: false,
      drumFillEnabled: true,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      patternPresets: createDefaultPartPresets(),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(chorusChords, 8),
    },
    {
      id: idFor('interlude', 'sec-interlude'),
      type: 'Bridge',
      name: '間奏',
      bars: 4,
      energy: 'Mid',
      kickMode: 'acoustic',
      drumHat16thEnabled: false,
      drumFillEnabled: true,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      patternPresets: createDefaultPartPresets(),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(verseChords, 4),
    },
    {
      id: idFor('verse2', 'sec-verse-2'),
      type: 'Verse',
      name: '2Aメロ',
      bars: 8,
      energy: 'Mid',
      kickMode: 'acoustic',
      drumHat16thEnabled: false,
      drumFillEnabled: true,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      patternPresets: createDefaultPartPresets(),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(verseChords, 8),
    },
    {
      id: idFor('chorus2', 'sec-chorus-2'),
      type: 'Chorus',
      name: '2サビ',
      bars: 8,
      energy: 'High',
      kickMode: 'acoustic',
      drumHat16thEnabled: false,
      drumFillEnabled: true,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      patternPresets: createDefaultPartPresets(),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(chorusChords, 8),
    },
    {
      id: idFor('bridge', 'sec-bridge'),
      type: 'Bridge',
      name: 'Cメロ（落ちサビ）',
      bars: 8,
      energy: 'Low',
      kickMode: 'acoustic',
      drumHat16thEnabled: false,
      drumFillEnabled: true,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      patternPresets: createDefaultPartPresets(),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(bridgeChords, 8),
    },
    {
      id: idFor('last-chorus', 'sec-last-chorus'),
      type: 'Chorus',
      name: 'ラスサビ',
      bars: 16,
      energy: 'High',
      kickMode: 'acoustic',
      drumHat16thEnabled: false,
      drumFillEnabled: true,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      patternPresets: createDefaultPartPresets(),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(chorusChords, 16),
    },
    {
      id: idFor('outro', 'sec-outro'),
      type: 'Outro',
      name: 'アウトロ',
      bars: 8,
      energy: 'Low',
      kickMode: 'acoustic',
      drumHat16thEnabled: false,
      drumFillEnabled: false,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      patternPresets: createDefaultPartPresets(),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(verseChords, 8),
    },
  ];
}

function buildBallad60BarSections(
  verseChords: string[],
  preChords: string[],
  chorusChords: string[],
  bridgeChords: string[],
  mkId?: (slug: string) => string
): Section[] {
  const idFor = (slug: string, fixedId: string) => (mkId ? mkId(slug) : fixedId);
  return [
    {
      id: idFor('intro', 'sec-intro'),
      type: 'Intro',
      name: 'イントロ',
      bars: 4,
      energy: 'Low',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(verseChords, 4),
    },
    {
      id: idFor('verse1', 'sec-verse'),
      type: 'Verse',
      name: '1Aメロ',
      bars: 8,
      energy: 'Low',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(verseChords, 8),
    },
    {
      id: idFor('pre1', 'sec-pre'),
      type: 'Pre-Chorus',
      name: '1Bメロ',
      bars: 4,
      energy: 'Mid',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(preChords, 4),
    },
    {
      id: idFor('chorus1', 'sec-chorus'),
      type: 'Chorus',
      name: '1サビ',
      bars: 8,
      energy: 'High',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(chorusChords, 8),
    },
    {
      id: idFor('verse2', 'sec-verse-2'),
      type: 'Verse',
      name: '2Aメロ',
      bars: 8,
      energy: 'Mid',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(verseChords, 8),
    },
    {
      id: idFor('chorus2', 'sec-chorus-2'),
      type: 'Chorus',
      name: '2サビ',
      bars: 8,
      energy: 'High',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(chorusChords, 8),
    },
    {
      id: idFor('bridge', 'sec-bridge'),
      type: 'Bridge',
      name: '落ちサビ',
      bars: 8,
      energy: 'Low',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(bridgeChords, 8),
    },
    {
      id: idFor('last-chorus', 'sec-last-chorus'),
      type: 'Chorus',
      name: 'ラスサビ',
      bars: 8,
      energy: 'High',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(chorusChords, 8),
    },
    {
      id: idFor('outro', 'sec-outro'),
      type: 'Outro',
      name: 'アウトロ',
      bars: 4,
      energy: 'Low',
      kickMode: 'acoustic',
      chords: createUniformChordTimeline(verseChords, 4),
    },
  ];
}

export function createDefaultSongConfig(
  template: QuickTemplateId = 'royal_jpop'
): SongConfig {
  const defaultChords = getDefaultProgression('E', 'Minor');

  const base: SongConfig = {
    title: 'New Band Song',
    bpm: 142,
    key: 'E',
    scale: 'Minor',
    timeSignature: '4/4',
    beatFeel: 'Straight',
    swing: 0,
    swingTarget: '8th',
    exportOnlyActiveTracks: true,
    split808KickTrack: true,
    vocalVoiceProfileId: 'chisa_jp',
    vocalCustomMinMidi: 55,
    vocalCustomMaxMidi: 74,
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
    sections: buildStandard84BarSections(
      defaultChords,
      ['Am', 'G', 'C', 'D'],
      ['C', 'D', 'Em', 'G'],
      ['Am', 'B7', 'C', 'D']
    ),
  };

  if (template === 'alt_shoegaze' || template === 'shoegaze') {
    const meta = MASTER_GENRES.alt_shoegaze;
    base.title = meta.label;
    base.bpm = meta.recommendedBpm;
    base.beatFeel = meta.beatFeel;
    base.members.drums.drumStyle = 'Heavy / Half-Time';
    base.members.drums.patternPreset = meta.defaultPresets.drums;
    base.members.bass.patternPreset = meta.defaultPresets.bass;
    base.members.keyboard.activeSectionsOnly = false;
    base.members.keyboard.keyboardStyle = 'Long Sustain';
    base.members.keyboard.patternPreset = meta.defaultPresets.keyboard;
    base.members.keyboard.instructionText = '浮遊 シューゲイザー';
    base.members.pad.activeSectionsOnly = false;
    base.members.pad.padStyle = 'Floating Tension';
    base.members.pad.patternPreset = meta.defaultPresets.pad;
    base.members.pad.instructionText = 'deftones 空間';
    base.members.vocal.patternPreset = meta.defaultPresets.vocal;
    base.sections = base.sections.map((s) => ({
      ...s,
      patternPresets: { ...meta.defaultPresets },
    }));
  } else if (template === 'emo_jrock') {
    const meta = MASTER_GENRES.emo_jrock;
    base.title = meta.label;
    base.bpm = meta.recommendedBpm;
    base.scale = meta.defaultScale;
    base.beatFeel = meta.beatFeel;
    base.members.drums.patternPreset = meta.defaultPresets.drums;
    base.members.bass.bassStyle = 'Driving 8th';
    base.members.bass.patternPreset = meta.defaultPresets.bass;
    base.members.keyboard.patternPreset = meta.defaultPresets.keyboard;
    base.members.pad.patternPreset = meta.defaultPresets.pad;
    base.members.vocal.patternPreset = meta.defaultPresets.vocal;
    base.sections = base.sections.map((s) => ({
      ...s,
      patternPresets: { ...meta.defaultPresets },
    }));
  } else if (template === 'numetal_mixture' || template === 'trapHybrid') {
    const meta = MASTER_GENRES.numetal_mixture;
    base.title = meta.label;
    base.bpm = meta.recommendedBpm;
    base.beatFeel = meta.beatFeel;
    base.members.drums.drumStyle = 'Sub-Step / Trap';
    base.members.drums.patternPreset = meta.defaultPresets.drums;
    base.members.bass.bass808Behavior = 'octaveUp';
    base.members.bass.patternPreset = meta.defaultPresets.bass;
    base.members.keyboard.patternPreset = meta.defaultPresets.keyboard;
    base.members.pad.patternPreset = meta.defaultPresets.pad;
    base.members.vocal.patternPreset = meta.defaultPresets.vocal;
    base.sections = base.sections.map((s) => ({
      ...s,
      kickMode: s.type === 'Verse' || s.type === 'Intro' ? '808' : 'acoustic',
      patternPresets: {
        ...meta.defaultPresets,
        vocal: s.type === 'Verse' ? 'rap_mixture_flow' : meta.defaultPresets.vocal,
      },
    }));
  } else if (template === 'chill_ballad') {
    const meta = MASTER_GENRES.chill_ballad;
    base.title = meta.label;
    base.bpm = meta.recommendedBpm;
    base.scale = meta.defaultScale;
    base.beatFeel = meta.beatFeel;
    base.swing = 14;
    base.members.drums.patternPreset = meta.defaultPresets.drums;
    base.members.bass.patternPreset = meta.defaultPresets.bass;
    base.members.keyboard.activeSectionsOnly = false;
    base.members.keyboard.patternPreset = meta.defaultPresets.keyboard;
    base.members.pad.activeSectionsOnly = false;
    base.members.pad.patternPreset = meta.defaultPresets.pad;
    base.members.vocal.patternPreset = meta.defaultPresets.vocal;
    const prog = getDefaultProgression(base.key, base.scale);
    const dia = getDiatonicChords(base.key, base.scale);
    base.sections = buildBallad60BarSections(
      prog,
      [dia[3], dia[2], dia[5], dia[6]],
      [dia[5], dia[6], dia[0], dia[2]],
      [dia[3], dia[4], dia[5], dia[6]]
    ).map((s) => ({
      ...s,
      drumHat16thEnabled: false,
      drumFillEnabled: getDefaultDrumFillEnabled(s.type, s.bars),
      drumBreakEnabled: false,
      hatDensity: 2,
      kickDensity: 2,
      keyboardDensity: 4,
      vocalDensity: 2.6,
      vocalHarmony: 'off',
      patternPresets: { ...meta.defaultPresets },
      enabledParts: createDefaultEnabledParts(),
    }));
  } else if (template === 'metal3Piece') {
    base.title = 'Metal 3-Piece Riff';
    base.bpm = 160;
    base.beatFeel = 'Driving';
    base.members.drums.drumStyle = 'Double Kick';
    base.members.drums.instructionText = 'ツーバス 激しい';
    base.members.bass.bassStyle = 'Driving 8th';
    base.members.keyboard.enabled = false;
    base.members.pad.enabled = false;
  }

  return base;
}

export type ArrangementPresetId =
  | 'full_2min30'
  | 'chorus_start'
  | 'full_two_chorus'
  | 'one_half'
  | 'ballad_60'
  | 'twoPart'
  | 'fourPart'
  | 'full';

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

  if (presetId === 'full_2min30') {
    nextSong.sections =
      nextSong.bpm <= 95
        ? buildBallad60BarSections(prog, preChords, chorusChords, bridgeChords, mkId)
        : buildStandard84BarSections(prog, preChords, chorusChords, bridgeChords, mkId);
  } else if (presetId === 'chorus_start') {
    // サビ頭(8) -> イントロ(8) -> 1A(8) -> 1B(8) -> 1サビ(8) -> 2A(8) -> 2B(4) -> 2サビ(8) -> 落ちサビ(8) -> ラスサビ(16) -> アウトロ(4) = 88 bars
    nextSong.sections = [
      { id: mkId('chorus-head'), type: 'Chorus', name: 'サビ頭', bars: 8, energy: 'High', kickMode: 'acoustic', chords: createUniformChordTimeline(chorusChords, 8) },
      { id: mkId('intro'), type: 'Intro', name: 'イントロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 8) },
      { id: mkId('verse1'), type: 'Verse', name: '1Aメロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 8) },
      { id: mkId('pre1'), type: 'Pre-Chorus', name: '1Bメロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(preChords, 8) },
      { id: mkId('chorus1'), type: 'Chorus', name: '1サビ', bars: 8, energy: 'High', kickMode: 'acoustic', chords: createUniformChordTimeline(chorusChords, 8) },
      { id: mkId('verse2'), type: 'Verse', name: '2Aメロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 8) },
      { id: mkId('pre2'), type: 'Pre-Chorus', name: '2Bメロ', bars: 4, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(preChords, 4) },
      { id: mkId('chorus2'), type: 'Chorus', name: '2サビ', bars: 8, energy: 'High', kickMode: 'acoustic', chords: createUniformChordTimeline(chorusChords, 8) },
      { id: mkId('bridge'), type: 'Bridge', name: '落ちサビ', bars: 8, energy: 'Low', kickMode: 'acoustic', chords: createUniformChordTimeline(bridgeChords, 8) },
      { id: mkId('last-chorus'), type: 'Chorus', name: 'ラスサビ', bars: 16, energy: 'High', kickMode: 'acoustic', chords: createUniformChordTimeline(chorusChords, 16) },
      { id: mkId('outro'), type: 'Outro', name: 'アウトロ', bars: 4, energy: 'Low', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 4) },
    ];
  } else if (presetId === 'full_two_chorus') {
    // イントロ(8) -> 1A(8) -> 1B(8) -> 1サビ(8) -> 間奏(4) -> 2A(8) -> 2B(8) -> 2サビ(8) -> Cメロ(8) -> ラスサビ(16) -> アウトロ(8) = 92 bars
    nextSong.sections = [
      { id: mkId('intro'), type: 'Intro', name: 'イントロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 8) },
      { id: mkId('verse1'), type: 'Verse', name: '1Aメロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 8) },
      { id: mkId('pre1'), type: 'Pre-Chorus', name: '1Bメロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(preChords, 8) },
      { id: mkId('chorus1'), type: 'Chorus', name: '1サビ', bars: 8, energy: 'High', kickMode: 'acoustic', chords: createUniformChordTimeline(chorusChords, 8) },
      { id: mkId('interlude'), type: 'Bridge', name: '間奏', bars: 4, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 4) },
      { id: mkId('verse2'), type: 'Verse', name: '2Aメロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 8) },
      { id: mkId('pre2'), type: 'Pre-Chorus', name: '2Bメロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(preChords, 8) },
      { id: mkId('chorus2'), type: 'Chorus', name: '2サビ', bars: 8, energy: 'High', kickMode: 'acoustic', chords: createUniformChordTimeline(chorusChords, 8) },
      { id: mkId('bridge'), type: 'Bridge', name: 'Cメロ', bars: 8, energy: 'Low', kickMode: 'acoustic', chords: createUniformChordTimeline(bridgeChords, 8) },
      { id: mkId('last-chorus'), type: 'Chorus', name: 'ラスサビ', bars: 16, energy: 'High', kickMode: 'acoustic', chords: createUniformChordTimeline(chorusChords, 16) },
      { id: mkId('outro'), type: 'Outro', name: 'アウトロ', bars: 8, energy: 'Low', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 8) },
    ];
  } else if (presetId === 'one_half') {
    // イントロ(4) -> Aメロ(8) -> Bメロ(8) -> サビ(8) -> Cメロ(8) -> ラスサビ(16) -> アウトロ(4) = 56 bars
    nextSong.sections = [
      { id: mkId('intro'), type: 'Intro', name: 'イントロ', bars: 4, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 4) },
      { id: mkId('verse1'), type: 'Verse', name: 'Aメロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 8) },
      { id: mkId('pre1'), type: 'Pre-Chorus', name: 'Bメロ', bars: 8, energy: 'Mid', kickMode: 'acoustic', chords: createUniformChordTimeline(preChords, 8) },
      { id: mkId('chorus1'), type: 'Chorus', name: 'サビ', bars: 8, energy: 'High', kickMode: 'acoustic', chords: createUniformChordTimeline(chorusChords, 8) },
      { id: mkId('bridge'), type: 'Bridge', name: 'Cメロ', bars: 8, energy: 'Low', kickMode: 'acoustic', chords: createUniformChordTimeline(bridgeChords, 8) },
      { id: mkId('last-chorus'), type: 'Chorus', name: 'ラスサビ', bars: 16, energy: 'High', kickMode: 'acoustic', chords: createUniformChordTimeline(chorusChords, 16) },
      { id: mkId('outro'), type: 'Outro', name: 'アウトロ', bars: 4, energy: 'Low', kickMode: 'acoustic', chords: createUniformChordTimeline(prog, 4) },
    ];
  } else if (presetId === 'ballad_60') {
    nextSong.sections = buildBallad60BarSections(prog, preChords, chorusChords, bridgeChords, mkId);
  } else if (presetId === 'twoPart') {
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
    drumHat16thEnabled: s.drumHat16thEnabled ?? false,
    drumFillEnabled:
      s.drumFillEnabled ?? getDefaultDrumFillEnabled(s.type, s.bars),
    drumBreakEnabled: s.drumBreakEnabled ?? false,
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

function regenerateSectionDrumsAndSyncBass(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  seedBase: number
): BandState {
  const secIdx = song.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return bandState;
  const sec = song.sections[secIdx];
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
      song,
      sec,
      secIdx,
      existingSec,
      seedBase + secIdx,
      { newSeeds: false, instruments: targets }
    );
  }

  return nextState;
}

export function setSectionDrumHat16thEnabled(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  enabled: boolean
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  nextSong.sections[secIdx].drumHat16thEnabled = enabled;
  return {
    song: nextSong,
    bandState: regenerateSectionDrumsAndSyncBass(
      nextSong,
      bandState,
      sectionId,
      6310
    ),
  };
}

export function setSectionDrumFillEnabled(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  enabled: boolean
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  nextSong.sections[secIdx].drumFillEnabled = enabled;
  return {
    song: nextSong,
    bandState: regenerateSectionDrumsAndSyncBass(
      nextSong,
      bandState,
      sectionId,
      6320
    ),
  };
}

export function setSectionDrumBreakEnabled(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  enabled: boolean
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  nextSong.sections[secIdx].drumBreakEnabled = enabled;
  return {
    song: nextSong,
    bandState: regenerateSectionDrumsAndSyncBass(
      nextSong,
      bandState,
      sectionId,
      6330
    ),
  };
}

export function setSectionDrumPatternId(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  patternId: BeatPatternId | 'auto'
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  nextSong.sections[secIdx].drumPatternId = patternId;
  return {
    song: nextSong,
    bandState: regenerateSectionDrumsAndSyncBass(
      nextSong,
      bandState,
      sectionId,
      6340
    ),
  };
}

export function setSectionDrumKickTake(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  kickTake: KickTake | 'auto'
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  nextSong.sections[secIdx].drumKickTake = kickTake;
  return {
    song: nextSong,
    bandState: regenerateSectionDrumsAndSyncBass(
      nextSong,
      bandState,
      sectionId,
      6350
    ),
  };
}

export function setSectionAccompanimentSkeleton(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  instrument: 'bass' | 'keyboard' | 'pad',
  skeleton: BassSkeletonId | KeyboardSkeletonId | PadSkeletonId | 'auto'
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  if (instrument === 'bass') {
    nextSong.sections[secIdx].bassSkeleton = skeleton as BassSkeletonId | 'auto';
  } else if (instrument === 'keyboard') {
    nextSong.sections[secIdx].keyboardSkeleton = skeleton as KeyboardSkeletonId | 'auto';
  } else {
    nextSong.sections[secIdx].padSkeleton = skeleton as PadSkeletonId | 'auto';
  }
  const existingCells = bandState.cellsBySection[sectionId];
  const updatedCells = generateSectionCells(
    nextSong,
    nextSong.sections[secIdx],
    secIdx,
    existingCells,
    6410 + secIdx * 31,
    { newSeeds: false, instruments: [instrument] }
  );
  return {
    song: nextSong,
    bandState: {
      cellsBySection: {
        ...bandState.cellsBySection,
        [sectionId]: updatedCells,
      },
    },
  };
}

export function setSectionAccompanimentTake(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  instrument: 'bass' | 'keyboard' | 'pad',
  take: AccompanimentTake | 'auto'
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };
  if (instrument === 'bass') {
    nextSong.sections[secIdx].bassTake = take;
  } else if (instrument === 'keyboard') {
    nextSong.sections[secIdx].keyboardTake = take;
  } else {
    nextSong.sections[secIdx].padTake = take;
  }
  const existingCells = bandState.cellsBySection[sectionId];
  const updatedCells = generateSectionCells(
    nextSong,
    nextSong.sections[secIdx],
    secIdx,
    existingCells,
    6460 + secIdx * 31,
    { newSeeds: false, instruments: [instrument] }
  );
  return {
    song: nextSong,
    bandState: {
      cellsBySection: {
        ...bandState.cellsBySection,
        [sectionId]: updatedCells,
      },
    },
  };
}

/**
 * Updates Song-level VocalVoiceProfile (default: chisa_jp).
 * Sub-seed isolation preserves Stage 1 harmony (chords) and drums/bass untouched,
 * recalculating ONLY Stage 2 (vocal) and Stage 3 (keyboard, pad clamping).
 */
export function setSongVocalVoiceProfile(
  song: SongConfig,
  bandState: BandState,
  patch: {
    vocalVoiceProfileId?: VocalVoicePresetId;
    vocalCustomMinMidi?: number;
    vocalCustomMaxMidi?: number;
  }
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  if (patch.vocalVoiceProfileId !== undefined) {
    nextSong.vocalVoiceProfileId = patch.vocalVoiceProfileId;
  }
  const rawMin = Math.max(
    36,
    Math.min(76, Math.round(patch.vocalCustomMinMidi ?? nextSong.vocalCustomMinMidi ?? 55))
  );
  const rawMax = Math.max(
    rawMin + 12,
    Math.min(88, Math.round(patch.vocalCustomMaxMidi ?? nextSong.vocalCustomMaxMidi ?? 74))
  );
  nextSong.vocalCustomMinMidi = rawMin;
  nextSong.vocalCustomMaxMidi = rawMax;

  const cellsBySection: Record<string, SectionBandCells> = {};
  for (let i = 0; i < nextSong.sections.length; i++) {
    const sec = nextSong.sections[i];
    const prevVocalAvgPitch =
      i > 0
        ? getAverageVocalPitch(cellsBySection[nextSong.sections[i - 1].id])
        : undefined;
    cellsBySection[sec.id] = generateSectionCells(
      nextSong,
      sec,
      i,
      bandState.cellsBySection[sec.id],
      6510 + i * 37,
      {
        newSeeds: false,
        instruments: ['vocal', 'keyboard', 'pad'],
        prevVocalAvgPitch,
      }
    );
  }

  return { song: nextSong, bandState: { cellsBySection } };
}

/**
 * Copies the section's current chord progression into customChordsText and locks chordLockMode='custom'.
 */
export function lockCurrentChordsToCustom(
  song: SongConfig,
  bandState: BandState,
  sectionId: string
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  const serialized =
    sec.customChordsText && sec.customChordsText.trim().length > 0
      ? sec.customChordsText.trim()
      : serializeChordSlotsToText(sec.chords, sec.bars);

  sec.chordLockMode = 'custom';
  sec.customChordsText = serialized;
  return { song: nextSong, bandState };
}

/**
 * Updates section chordLockMode ("auto" | "custom") and optional customChordsText.
 * When mode === 'custom' and text parses cleanly, updates section.chords and recalculates
 * downstream parts (bass/vocal/keyboard/pad) while preserving locked cells.
 * If text has parse errors, stores text for UI error feedback and safely keeps previous valid chords.
 */
export function setSectionChordLock(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  patch: {
    chordLockMode?: ChordLockMode;
    customChordsText?: string;
  }
): { song: SongConfig; bandState: BandState; parseErrors: readonly string[] } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState, parseErrors: [] };

  const sec = nextSong.sections[secIdx];
  if (patch.chordLockMode !== undefined) {
    sec.chordLockMode = patch.chordLockMode;
  }
  if (patch.customChordsText !== undefined) {
    sec.customChordsText = patch.customChordsText;
  } else if (
    sec.chordLockMode === 'custom' &&
    (!sec.customChordsText || sec.customChordsText.trim().length === 0)
  ) {
    sec.customChordsText = serializeChordSlotsToText(sec.chords, sec.bars);
  }

  let parseErrors: readonly string[] = [];
  if (sec.chordLockMode === 'custom') {
    const genreHint =
      sec.patternPresets?.keyboard ??
      sec.patternPresets?.vocal ??
      nextSong.members.keyboard.patternPreset ??
      nextSong.members.vocal?.patternPreset;
    const parsed = parseCustomChordProgression(
      sec.customChordsText ?? '',
      sec.bars,
      noteNameToSemitone(nextSong.key),
      nextSong.scale,
      genreHint
    );
    if (!parsed.valid) {
      return {
        song: nextSong,
        bandState,
        parseErrors: parsed.errors,
      };
    }
    sec.chords = parsed.slots;
  }

  const nextState = cloneBandState(bandState);
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
    nextState.cellsBySection[sectionId],
    6710 + secIdx * 29,
    {
      newSeeds: false,
      instruments: ['bass', 'vocal', 'keyboard', 'pad'],
      prevVocalAvgPitch,
    }
  );

  return { song: nextSong, bandState: nextState, parseErrors };
}

/**
 * Sets or clears Basic Pitch / imported MIDI Bass Override lock for a section.
 * Recalculates bass + Stage 3 (keyboard, pad) so LIL checks reference the locked bass pitches.
 */
export function setSectionBassMidiOverride(
  song: SongConfig,
  bandState: BandState,
  sectionId: string,
  options: {
    bassLockMode: BassLockMode;
    rawNotes?: readonly MidiNote[] | null;
    sourceLabel?: string;
    shiftOctaveDown?: boolean;
  }
): { song: SongConfig; bandState: BandState } {
  const nextSong = cloneSongConfig(song);
  const secIdx = nextSong.sections.findIndex((s) => s.id === sectionId);
  if (secIdx === -1) return { song, bandState };

  const sec = nextSong.sections[secIdx];
  sec.bassLockMode = options.bassLockMode;
  if (options.shiftOctaveDown !== undefined) {
    sec.overrideBassShiftOctave = options.shiftOctaveDown;
  }
  if (options.sourceLabel !== undefined) {
    sec.overrideBassSourceLabel = options.sourceLabel;
  }

  const shiftOctave = sec.overrideBassShiftOctave ?? true;
  if (options.bassLockMode === 'midi_override') {
    const sourceNotes =
      options.rawNotes !== undefined
        ? options.rawNotes
        : sec.overrideBassNotes ?? sec.unisonRiff?.cleanedBassNotes ?? null;
    if (sourceNotes && sourceNotes.length > 0) {
      sec.overrideBassNotes = normalizeOverrideBassNotes(sourceNotes, sec.bars, {
        shiftOctaveDown: shiftOctave,
        minDurationTicks: 60,
      });
    } else {
      sec.bassLockMode = 'auto';
      sec.overrideBassNotes = null;
    }
  } else if (options.rawNotes === null) {
    sec.overrideBassNotes = null;
  }

  const nextState = cloneBandState(bandState);
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
    nextState.cellsBySection[sectionId],
    6810 + secIdx * 31,
    {
      newSeeds: false,
      instruments: ['bass', 'keyboard', 'pad'],
      prevVocalAvgPitch,
    }
  );

  return { song: nextSong, bandState: nextState };
}

/**
 * Infers a provisional power-chord progression (e.g. "E5 | F5 | G5 | E5") from
 * the section's overrideBassNotes (or unisonRiff bass notes) and locks it into customChordsText.
 */
export function inferCustomChordsFromOverrideBass(
  song: SongConfig,
  bandState: BandState,
  sectionId: string
): { song: SongConfig; bandState: BandState; inferredText: string } {
  const sec = song.sections.find((s) => s.id === sectionId);
  if (!sec) return { song, bandState, inferredText: '' };

  const sourceNotes =
    sec.overrideBassNotes && sec.overrideBassNotes.length > 0
      ? sec.overrideBassNotes
      : sec.unisonRiff?.cleanedBassNotes ?? [];
  if (sourceNotes.length === 0) {
    return { song, bandState, inferredText: '' };
  }

  const inferredText = inferPowerChordProgressionFromBassNotes(
    sourceNotes,
    sec.bars
  );
  if (!inferredText) {
    return { song, bandState, inferredText: '' };
  }

  const res = setSectionChordLock(song, bandState, sectionId, {
    chordLockMode: 'custom',
    customChordsText: inferredText,
  });
  return {
    song: res.song,
    bandState: res.bandState,
    inferredText,
  };
}
