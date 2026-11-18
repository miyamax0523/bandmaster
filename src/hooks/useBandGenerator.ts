import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyArrangementPresetToSong,
  cloneBandState,
  cloneSongConfig,
  createDefaultSongConfig,
  duplicateSectionInSong,
  generateAllSections,
  generateSectionCells,
  pushUndoSnapshot,
  regenerateInstrumentCell,
  reorderSectionsInSong,
  selectInstrumentTake,
  setSectionUnisonRiff,
  toggleCellLock,
  toggleSectionRiffOctaveUpOn808,
  updateSectionBars,
  updateSectionDrumDensity,
  updateSectionDrumLoop,
  updateSectionKickMode,
  type ArrangementPresetId,
  type BandSnapshot,
  type QuickTemplateId,
} from '../lib/bandState';
import { transposeChords } from '../lib/chordUtils';
import {
  createDebouncedProjectSaver,
  loadProject,
} from '../lib/storage';
import type {
  DensityLevel,
  DrumLoopData,
  InstrumentType,
  KickMode,
  MemberConfig,
  Section,
  SongConfig,
  TakeStyle,
  UnisonRiffData,
} from '../types/song';
import type { BandState } from '../types/track';

export function useBandGenerator() {
  const [song, setSong] = useState<SongConfig>(() =>
    createDefaultSongConfig('rockBand')
  );
  const [bandState, setBandState] = useState<BandState>(() =>
    generateAllSections(createDefaultSongConfig('rockBand'))
  );
  const [undoStack, setUndoStack] = useState<BandSnapshot[]>([]);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const saverRef = useRef<ReturnType<typeof createDebouncedProjectSaver> | null>(
    null
  );

  useEffect(() => {
    saverRef.current = createDebouncedProjectSaver(500, undefined, (res) => {
      if (!res.ok && res.errorMessage) {
        setStorageWarning(res.errorMessage);
      } else if (res.ok) {
        setStorageWarning(null);
      }
    });

    let cancelled = false;
    void loadProject().then((loaded) => {
      if (cancelled) return;
      if (loaded) {
        setSong(loaded.song);
        setBandState(loaded.bandState);
      }
      setIsLoaded(true);
    });

    return () => {
      cancelled = true;
      saverRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    saverRef.current?.scheduleSave(song, bandState);
  }, [song, bandState, isLoaded]);

  const commitChange = useCallback(
    (nextSong: SongConfig, nextState: BandState, recordUndo = true) => {
      if (recordUndo) {
        setUndoStack((prev) =>
          pushUndoSnapshot(prev, { song, bandState })
        );
      }
      setSong(nextSong);
      setBandState(nextState);
    },
    [song, bandState]
  );

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setSong(cloneSongConfig(last.song));
      setBandState(cloneBandState(last.bandState));
      return prev.slice(0, -1);
    });
  }, []);

  const updateSongField = useCallback(
    (updater: (draft: SongConfig) => void, regenAll = false) => {
      const nextSong = cloneSongConfig(song);
      updater(nextSong);
      const nextState = regenAll
        ? generateAllSections(nextSong, bandState, Date.now() & 0xffff, false)
        : bandState;
      commitChange(nextSong, nextState, true);
    },
    [song, bandState, commitChange]
  );

  const applyTemplate = useCallback(
    (templateId: QuickTemplateId) => {
      const nextSong = createDefaultSongConfig(templateId);
      const nextState = generateAllSections(nextSong, undefined, Date.now() & 0xffff, true);
      commitChange(nextSong, nextState, true);
    },
    [commitChange]
  );

  const updateMember = useCallback(
    (instrument: InstrumentType, patch: Partial<MemberConfig>) => {
      const nextSong = cloneSongConfig(song);
      nextSong.members[instrument] = {
        ...nextSong.members[instrument],
        ...patch,
      };
      const nextState = generateAllSections(
        nextSong,
        bandState,
        Date.now() & 0xffff,
        false
      );
      commitChange(nextSong, nextState, true);
    },
    [song, bandState, commitChange]
  );

  const regenerateAll = useCallback(() => {
    const nextState = generateAllSections(
      song,
      bandState,
      (Date.now() & 0x7fffff) + 1,
      true
    );
    commitChange(song, nextState, true);
  }, [song, bandState, commitChange]);

  const regenerateCell = useCallback(
    (sectionId: string, instrument: InstrumentType) => {
      const nextState = regenerateInstrumentCell(
        song,
        bandState,
        sectionId,
        instrument,
        (Date.now() & 0x7fffff) + 7
      );
      commitChange(song, nextState, true);
    },
    [song, bandState, commitChange]
  );

  const selectTake = useCallback(
    (sectionId: string, instrument: InstrumentType, take: TakeStyle | 'OFF') => {
      const nextState = selectInstrumentTake(
        song,
        bandState,
        sectionId,
        instrument,
        take
      );
      commitChange(song, nextState, true);
    },
    [song, bandState, commitChange]
  );

  const toggleLock = useCallback(
    (sectionId: string, instrument: InstrumentType) => {
      const nextState = toggleCellLock(bandState, sectionId, instrument);
      commitChange(song, nextState, false);
    },
    [song, bandState, commitChange]
  );

  const addSection = useCallback(() => {
    const nextSong = cloneSongConfig(song);
    const id = `sec-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newSec: Section = {
      id,
      type: 'Verse',
      name: `セクション ${nextSong.sections.length + 1}`,
      bars: 4,
      energy: 'Mid',
      kickMode: 'acoustic',
      hatDensity: 3,
      kickDensity: 3,
      chords: ['Em', 'C', 'G', 'D'],
    };
    nextSong.sections.push(newSec);
    const nextState = cloneBandState(bandState);
    nextState.cellsBySection[id] = generateSectionCells(
      nextSong,
      newSec,
      nextSong.sections.length - 1,
      undefined,
      Date.now() & 0xffff,
      { newSeeds: true }
    );
    commitChange(nextSong, nextState, true);
    return id;
  }, [song, bandState, commitChange]);

  const removeSection = useCallback(
    (sectionId: string) => {
      if (song.sections.length <= 1) return;
      const nextSong = cloneSongConfig(song);
      nextSong.sections = nextSong.sections.filter((s) => s.id !== sectionId);
      const nextState = cloneBandState(bandState);
      delete nextState.cellsBySection[sectionId];
      commitChange(nextSong, nextState, true);
    },
    [song, bandState, commitChange]
  );

  const duplicateSection = useCallback(
    (sectionId: string) => {
      const newId = `sec-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const res = duplicateSectionInSong(song, bandState, sectionId, newId);
      commitChange(res.song, res.bandState, true);
      return newId;
    },
    [song, bandState, commitChange]
  );

  const moveSection = useCallback(
    (sectionId: string, direction: -1 | 1) => {
      const idx = song.sections.findIndex((s) => s.id === sectionId);
      const targetIdx = idx + direction;
      if (idx === -1 || targetIdx < 0 || targetIdx >= song.sections.length) {
        return;
      }
      const nextSong = reorderSectionsInSong(song, idx, targetIdx);
      commitChange(nextSong, bandState, true);
    },
    [song, bandState, commitChange]
  );

  const reorderSection = useCallback(
    (fromIndex: number, toIndex: number) => {
      const nextSong = reorderSectionsInSong(song, fromIndex, toIndex);
      if (nextSong === song) return;
      commitChange(nextSong, bandState, true);
    },
    [song, bandState, commitChange]
  );

  const updateSectionProps = useCallback(
    (sectionId: string, patch: Partial<Section>, regenSection = false) => {
      const nextSong = cloneSongConfig(song);
      const idx = nextSong.sections.findIndex((s) => s.id === sectionId);
      if (idx === -1) return;
      nextSong.sections[idx] = { ...nextSong.sections[idx], ...patch };
      const nextState = cloneBandState(bandState);
      if (regenSection) {
        nextState.cellsBySection[sectionId] = generateSectionCells(
          nextSong,
          nextSong.sections[idx],
          idx,
          nextState.cellsBySection[sectionId],
          Date.now() & 0xffff,
          { newSeeds: false }
        );
      }
      commitChange(nextSong, nextState, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionBars = useCallback(
    (sectionId: string, bars: number) => {
      const res = updateSectionBars(song, bandState, sectionId, bars);
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionKickMode = useCallback(
    (sectionId: string, kickMode: KickMode) => {
      const res = updateSectionKickMode(song, bandState, sectionId, kickMode);
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionDrumDensity = useCallback(
    (
      sectionId: string,
      patch: { hatDensity?: DensityLevel; kickDensity?: DensityLevel }
    ) => {
      const res = updateSectionDrumDensity(song, bandState, sectionId, patch);
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionDrumLoop = useCallback(
    (sectionId: string, loop?: DrumLoopData) => {
      const res = updateSectionDrumLoop(
        song,
        bandState,
        sectionId,
        loop,
        Date.now() & 0xffff
      );
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const changeSongDrumLoop = useCallback(
    (loop?: DrumLoopData) => {
      updateSongField((draft) => {
        draft.uploadedDrumLoop = loop;
      }, true);
    },
    [updateSongField]
  );

  const changeSectionRiff = useCallback(
    (sectionId: string, riff?: UnisonRiffData) => {
      const res = setSectionUnisonRiff(
        song,
        bandState,
        sectionId,
        riff,
        Date.now() & 0xffff
      );
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const toggleSectionRiff808Octave = useCallback(
    (sectionId: string, val?: boolean) => {
      const res = toggleSectionRiffOctaveUpOn808(song, bandState, sectionId, val);
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const transposeSectionChords = useCallback(
    (sectionId: string, semitones: number) => {
      const sec = song.sections.find((s) => s.id === sectionId);
      if (!sec) return;
      updateSectionProps(
        sectionId,
        { chords: transposeChords(sec.chords, semitones) },
        true
      );
    },
    [song, updateSectionProps]
  );

  const applyArrangementPreset = useCallback(
    (presetId: ArrangementPresetId) => {
      const res = applyArrangementPresetToSong(
        song,
        presetId,
        (Date.now() & 0x7fffff) + 11
      );
      commitChange(res.song, res.bandState, true);
      return res.song.sections[0]?.id ?? '';
    },
    [song, commitChange]
  );

  return {
    song,
    bandState,
    canUndo: undoStack.length > 0,
    storageWarning,
    dismissStorageWarning: () => setStorageWarning(null),
    undo,
    updateSongField,
    applyTemplate,
    applyArrangementPreset,
    updateMember,
    regenerateAll,
    regenerateCell,
    selectTake,
    toggleLock,
    addSection,
    removeSection,
    duplicateSection,
    moveSection,
    reorderSection,
    updateSectionProps,
    changeSectionBars,
    changeSectionKickMode,
    changeSectionDrumDensity,
    changeSectionDrumLoop,
    changeSongDrumLoop,
    changeSectionRiff,
    toggleSectionRiff808Octave,
    transposeSectionChords,
  };
}
