import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyArrangementPresetToSong,
  applyTimelineToAllSections,
  cloneBandState,
  cloneSongConfig,
  createDefaultSongConfig,
  duplicateSectionInSong,
  generateAllSections,
  generateSectionCells,
  inferCustomChordsFromOverrideBass as applyInferChordsFromBass,
  lockCurrentChordsToCustom as applyLockChordsToCustom,
  pastePartPhraseToSection,
  pushUndoSnapshot,
  regenerateInstrumentCell,
  reorderSectionsInSong,
  rerollSectionBassFill,
  selectInstrumentTake,
  setSectionAccompanimentSkeleton as applySectionAccompanimentSkeleton,
  setSectionAccompanimentTake as applySectionAccompanimentTake,
  setSectionBassMidiOverride as applySectionBassMidiOverride,
  setSectionChordLock as applySectionChordLock,
  setSectionVocalConfig as applySectionVocalConfig,
  setSongVocalVoiceProfile as applySongVocalVoiceProfile,
  setSectionBassChromatic,
  setSectionBassFillEnabled,
  setSectionDrumBreakEnabled as applySectionDrumBreakEnabled,
  setSectionDrumFillEnabled as applySectionDrumFillEnabled,
  setSectionDrumHat16thEnabled as applySectionDrumHat16thEnabled,
  setSectionDrumKickTake as applySectionDrumKickTake,
  setSectionDrumPatternId as applySectionDrumPatternId,
  setSectionUnisonRiff,
  setSectionVocalMelody,
  toggleCellLock,
  toggleSectionPartEnabled,
  toggleSectionRiffOctaveUpOn808,
  updateSectionBars,
  updateSectionChordTimeline,
  updateSectionDrumAnticipationMode,
  updateSectionDrumDensity,
  updateSectionDrumLoop,
  updateSectionKeyboardDensity,
  updateSectionKickMode,
  updateSectionPartPreset,
  updateSectionVocalChapterForm,
  updateSectionVocalDensity,
  updateSectionVocalDialecticalScheme,
  updateSectionVocalHarmony,
  type ArrangementPresetId,
  type BandSnapshot,
  type QuickTemplateId,
} from '../lib/bandState';
import { createUniformChordTimeline } from '../lib/chordTimeline';
import {
  createDebouncedProjectSaver,
  loadCurrentProjectSync,
  loadProject,
  saveCurrentProjectSync,
} from '../lib/storage';
import {
  createDefaultEnabledParts,
  createDefaultPartPresets,
  type AccompanimentTake,
  type BassLockMode,
  type BassSkeletonId,
  type BeatPatternId,
  type ChapterInternalForm,
  type ChordLockMode,
  type ChordSlot,
  type CopiedPartPhrase,
  type DensityLevel,
  type DrumLoopData,
  type EightBarScheme,
  type InstrumentType,
  type KeyboardDensityLevel,
  type KeyboardSkeletonId,
  type KickMode,
  type KickTake,
  type MidiNote,
  type PadSkeletonId,
  type MemberConfig,
  type Section,
  type SongConfig,
  type TakeStyle,
  type UnisonRiffData,
  type VocalEndingMode,
  type VocalHarmonyMode,
  type VocalMelodyData,
  type VocalStyleId,
  type VocalTakeId,
  type VocalVoicePresetId,
} from '../types/song';
import type { BandState } from '../types/track';

export function useBandGenerator() {
  const [initialLoaded] = useState(() => loadCurrentProjectSync());
  const [song, setSong] = useState<SongConfig>(
    () => initialLoaded?.song ?? createDefaultSongConfig('rockBand')
  );
  const [bandState, setBandState] = useState<BandState>(() =>
    initialLoaded?.bandState ??
    generateAllSections(createDefaultSongConfig('rockBand'))
  );
  const [undoStack, setUndoStack] = useState<BandSnapshot[]>([]);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(() => Boolean(initialLoaded));

  const saverRef = useRef<ReturnType<typeof createDebouncedProjectSaver> | null>(
    null
  );
  const latestStateRef = useRef({ song, bandState, isLoaded });
  latestStateRef.current = { song, bandState, isLoaded };

  useEffect(() => {
    saverRef.current = createDebouncedProjectSaver(500, undefined, (res) => {
      if (!res.ok && res.errorMessage) {
        setStorageWarning(res.errorMessage);
      } else if (res.ok) {
        setStorageWarning(null);
      }
    });

    let cancelled = false;
    if (!initialLoaded) {
      void loadProject().then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          setSong(loaded.song);
          setBandState(loaded.bandState);
        }
        setIsLoaded(true);
      });
    } else {
      // Ensure IndexedDB mirror matches synchronous localStorage state cleanly
      void saverRef.current.flushNow(initialLoaded.song, initialLoaded.bandState);
    }

    const flushBeforeHideOrUnload = () => {
      const curr = latestStateRef.current;
      if (!curr.isLoaded) return;
      saveCurrentProjectSync(curr.song, curr.bandState);
      void saverRef.current?.flushNow(curr.song, curr.bandState);
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        flushBeforeHideOrUnload();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flushBeforeHideOrUnload);
      window.addEventListener('beforeunload', flushBeforeHideOrUnload);
    }

    return () => {
      cancelled = true;
      flushBeforeHideOrUnload();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', flushBeforeHideOrUnload);
        window.removeEventListener('beforeunload', flushBeforeHideOrUnload);
      }
      saverRef.current?.cancel();
    };
  }, [initialLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    saverRef.current?.scheduleSave(song, bandState);
  }, [song, bandState, isLoaded]);

  const commitChange = useCallback(
    (
      nextSong: SongConfig,
      nextState: BandState,
      recordUndo = true,
      flushImmediately = false
    ) => {
      if (recordUndo) {
        setUndoStack((prev) =>
          pushUndoSnapshot(prev, { song, bandState })
        );
      }
      latestStateRef.current = { song: nextSong, bandState: nextState, isLoaded: true };
      const syncRes = saveCurrentProjectSync(nextSong, nextState);
      if (!syncRes.ok && syncRes.errorMessage) {
        setStorageWarning(syncRes.errorMessage);
      }
      if (flushImmediately) {
        void saverRef.current?.flushNow(nextSong, nextState);
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
      const nextS = cloneSongConfig(last.song);
      const nextB = cloneBandState(last.bandState);
      saveCurrentProjectSync(nextS, nextB);
      void saverRef.current?.flushNow(nextS, nextB);
      setSong(nextS);
      setBandState(nextB);
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
      commitChange(nextSong, nextState, true, true);
    },
    [song, bandState, commitChange]
  );

  const applyTemplate = useCallback(
    (templateId: QuickTemplateId) => {
      const nextSong = createDefaultSongConfig(templateId);
      const nextState = generateAllSections(nextSong, undefined, Date.now() & 0xffff, true);
      commitChange(nextSong, nextState, true, true);
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

  const applyQuickSong = useCallback(
    (nextSong: SongConfig, baseSeed?: number) => {
      const seed = baseSeed ?? ((Date.now() & 0x7fffff) + 17);
      const nextState = generateAllSections(nextSong, undefined, seed, true);
      commitChange(nextSong, nextState, true, true);
    },
    [commitChange]
  );

  const resetProjectToDefault = useCallback(() => {
    const defaultSong = createDefaultSongConfig('rockBand');
    const defaultState = generateAllSections(defaultSong, undefined, 4242, true);
    setUndoStack([]);
    commitChange(defaultSong, defaultState, false, true);
  }, [commitChange]);

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
      const secIdx = song.sections.findIndex((s) => s.id === sectionId);
      let nextSong = song;
      if (secIdx !== -1) {
        nextSong = cloneSongConfig(song);
        const sec = nextSong.sections[secIdx];
        const resolvedPreset =
          sec.patternPresets?.[instrument] ??
          sec.partPresets?.[instrument] ??
          nextSong.members[instrument]?.patternPreset ??
          'auto';
        sec.patternPresets = {
          ...createDefaultPartPresets(nextSong.members),
          ...(sec.patternPresets ?? sec.partPresets ?? {}),
          [instrument]: resolvedPreset,
        };
        sec.hatDensity = sec.hatDensity ?? 3;
        sec.kickDensity = sec.kickDensity ?? 3;
        sec.keyboardDensity = sec.keyboardDensity ?? 4;
        sec.vocalDensity = sec.vocalDensity ?? 3;
        sec.vocalHarmony = sec.vocalHarmony ?? 'off';
      }
      commitChange(nextSong, nextState, true);
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
      drumHat16thEnabled: false,
      drumFillEnabled: false,
      drumBreakEnabled: false,
      hatDensity: 3,
      kickDensity: 3,
      keyboardDensity: 4,
      vocalDensity: 3,
      vocalHarmony: 'off',
      bassChromaticEnabled: false,
      bassFillEnabled: false,
      bassFillSeed: 0,
      patternPresets: createDefaultPartPresets(nextSong.members),
      enabledParts: createDefaultEnabledParts(),
      chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
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
      commitChange(nextSong, nextState, true, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionBars = useCallback(
    (sectionId: string, bars: number) => {
      const res = updateSectionBars(song, bandState, sectionId, bars);
      commitChange(res.song, res.bandState, true, true);
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

  const toggleSectionPart = useCallback(
    (sectionId: string, instrument: InstrumentType, enabled?: boolean) => {
      const res = toggleSectionPartEnabled(
        song,
        bandState,
        sectionId,
        instrument,
        enabled
      );
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionVocalMelody = useCallback(
    (sectionId: string, melody?: VocalMelodyData) => {
      const res = setSectionVocalMelody(
        song,
        bandState,
        sectionId,
        melody,
        Date.now() & 0xffff
      );
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionVocalDensity = useCallback(
    (sectionId: string, vocalDensity: number) => {
      const res = updateSectionVocalDensity(
        song,
        bandState,
        sectionId,
        vocalDensity
      );
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionKeyboardDensity = useCallback(
    (sectionId: string, keyboardDensity: KeyboardDensityLevel) => {
      const res = updateSectionKeyboardDensity(
        song,
        bandState,
        sectionId,
        keyboardDensity
      );
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionVocalHarmony = useCallback(
    (sectionId: string, vocalHarmony: VocalHarmonyMode) => {
      const res = updateSectionVocalHarmony(
        song,
        bandState,
        sectionId,
        vocalHarmony
      );
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionVocalDialecticalScheme = useCallback(
    (sectionId: string, scheme: EightBarScheme | 'auto') => {
      const res = updateSectionVocalDialecticalScheme(
        song,
        bandState,
        sectionId,
        scheme
      );
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionVocalChapterForm = useCallback(
    (sectionId: string, form: ChapterInternalForm | 'auto') => {
      const res = updateSectionVocalChapterForm(
        song,
        bandState,
        sectionId,
        form
      );
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionPartPreset = useCallback(
    (sectionId: string, instrument: InstrumentType, preset: string) => {
      const res = updateSectionPartPreset(
        song,
        bandState,
        sectionId,
        instrument,
        preset
      );
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const pastePartPhrase = useCallback(
    (targetSectionId: string, copiedPhrase: CopiedPartPhrase) => {
      const res = pastePartPhraseToSection(
        song,
        bandState,
        targetSectionId,
        copiedPhrase
      );
      commitChange(res.song, res.bandState, true);
    },
    [song, bandState, commitChange]
  );

  const loadSnapshotData = useCallback(
    (nextSong: SongConfig, nextState: BandState) => {
      commitChange(cloneSongConfig(nextSong), cloneBandState(nextState), true);
    },
    [commitChange]
  );

  const changeSectionChordTimeline = useCallback(
    (sectionId: string, slots: readonly ChordSlot[]) => {
      const res = updateSectionChordTimeline(song, bandState, sectionId, slots);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionDrumAnticipationMode = useCallback(
    (sectionId: string, mode: 'sync' | 'keep') => {
      const res = updateSectionDrumAnticipationMode(
        song,
        bandState,
        sectionId,
        mode
      );
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionBassChromatic = useCallback(
    (sectionId: string, enabled: boolean) => {
      const res = setSectionBassChromatic(song, bandState, sectionId, enabled);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionBassFillEnabled = useCallback(
    (sectionId: string, enabled: boolean) => {
      const res = setSectionBassFillEnabled(song, bandState, sectionId, enabled);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const rerollBassFill = useCallback(
    (sectionId: string) => {
      const res = rerollSectionBassFill(song, bandState, sectionId);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const setSectionDrumHat16thEnabled = useCallback(
    (sectionId: string, enabled: boolean) => {
      const res = applySectionDrumHat16thEnabled(song, bandState, sectionId, enabled);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const setSectionDrumFillEnabled = useCallback(
    (sectionId: string, enabled: boolean) => {
      const res = applySectionDrumFillEnabled(song, bandState, sectionId, enabled);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const setSectionDrumBreakEnabled = useCallback(
    (sectionId: string, enabled: boolean) => {
      const res = applySectionDrumBreakEnabled(song, bandState, sectionId, enabled);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const setSectionDrumPatternId = useCallback(
    (sectionId: string, patternId: BeatPatternId | 'auto') => {
      const res = applySectionDrumPatternId(song, bandState, sectionId, patternId);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const setSectionDrumKickTake = useCallback(
    (sectionId: string, kickTake: KickTake | 'auto') => {
      const res = applySectionDrumKickTake(song, bandState, sectionId, kickTake);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const setSectionAccompanimentSkeleton = useCallback(
    (
      sectionId: string,
      instrument: 'bass' | 'keyboard' | 'pad',
      skeleton: BassSkeletonId | KeyboardSkeletonId | PadSkeletonId | 'auto'
    ) => {
      const res = applySectionAccompanimentSkeleton(
        song,
        bandState,
        sectionId,
        instrument,
        skeleton
      );
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const setSectionAccompanimentTake = useCallback(
    (
      sectionId: string,
      instrument: 'bass' | 'keyboard' | 'pad',
      take: AccompanimentTake | 'auto'
    ) => {
      const res = applySectionAccompanimentTake(
        song,
        bandState,
        sectionId,
        instrument,
        take
      );
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const changeVocalVoiceProfile = useCallback(
    (patch: {
      vocalVoiceProfileId?: VocalVoicePresetId;
      vocalCustomMinMidi?: number;
      vocalCustomMaxMidi?: number;
    }) => {
      const res = applySongVocalVoiceProfile(song, bandState, patch);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const lockSectionChordsToCustom = useCallback(
    (sectionId: string) => {
      const res = applyLockChordsToCustom(song, bandState, sectionId);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionChordLock = useCallback(
    (
      sectionId: string,
      patch: { chordLockMode?: ChordLockMode; customChordsText?: string }
    ) => {
      const res = applySectionChordLock(song, bandState, sectionId, patch);
      commitChange(res.song, res.bandState, true, true);
      return res.parseErrors;
    },
    [song, bandState, commitChange]
  );

  const changeSectionBassMidiOverride = useCallback(
    (
      sectionId: string,
      options: {
        bassLockMode: BassLockMode;
        rawNotes?: readonly MidiNote[] | null;
        sourceLabel?: string;
        shiftOctaveDown?: boolean;
      }
    ) => {
      const res = applySectionBassMidiOverride(song, bandState, sectionId, options);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const inferSectionChordsFromBass = useCallback(
    (sectionId: string) => {
      const res = applyInferChordsFromBass(song, bandState, sectionId);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const changeSectionVocalConfig = useCallback(
    (
      sectionId: string,
      patch: {
        vocalStyle?: VocalStyleId;
        vocalTake?: VocalTakeId;
        vocalEnding?: VocalEndingMode;
      }
    ) => {
      const res = applySectionVocalConfig(song, bandState, sectionId, patch);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
  );

  const copyTimelineToAllSections = useCallback(
    (sourceSectionId: string) => {
      const src = song.sections.find((s) => s.id === sourceSectionId);
      if (!src) return;
      const res = applyTimelineToAllSections(song, bandState, src.chords);
      commitChange(res.song, res.bandState, true, true);
    },
    [song, bandState, commitChange]
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
    toggleSectionPart,
    changeSectionVocalMelody,
    changeSectionVocalDensity,
    changeSectionVocalHarmony,
    changeSectionVocalDialecticalScheme,
    changeSectionVocalChapterForm,
    changeSectionKeyboardDensity,
    changeSectionPartPreset,
    changeSectionChordTimeline,
    changeSectionDrumAnticipationMode,
    changeSectionBassChromatic,
    changeSectionBassFillEnabled,
    rerollBassFill,
    setSectionDrumHat16thEnabled,
    setSectionDrumFillEnabled,
    setSectionDrumBreakEnabled,
    setSectionDrumPatternId,
    setSectionDrumKickTake,
    setSectionAccompanimentSkeleton,
    setSectionAccompanimentTake,
    changeVocalVoiceProfile,
    lockSectionChordsToCustom,
    changeSectionChordLock,
    changeSectionBassMidiOverride,
    inferSectionChordsFromBass,
    changeSectionVocalConfig,
    copyTimelineToAllSections,
    pastePartPhrase,
    loadSnapshotData,
    applyQuickSong,
    resetProjectToDefault,
  };
}
