import { useEffect, useState } from 'react';
import { ArrangementEditor } from './components/ArrangementEditor';
import { BandmasterConsole } from './components/BandmasterConsole';
import { MemberSettings } from './components/MemberSettings';
import { PlaybackControls } from './components/PlaybackControls';
import { ProjectSnapshotsModal } from './components/ProjectSnapshotsModal';
import { QuickGenerateModal } from './components/QuickGenerateModal';
import { RiffRecorderModal } from './components/RiffRecorderModal';
import { SongSettings } from './components/SongSettings';
import { TrackControls } from './components/TrackControls';
import { useAudioPreview } from './hooks/useAudioPreview';
import { useBandGenerator } from './hooks/useBandGenerator';
import { getSongDurationSummary } from './lib/bandState';
import { findSectionSpanAtTick } from './lib/noteSelector';
import { CURRENT_ENGINE_VERSION, type CopiedPartPhrase } from './types/song';

type ActiveTab = 'song' | 'arrangement' | 'members' | 'console';

export function App() {
  const {
    song,
    bandState,
    canUndo,
    storageWarning,
    dismissStorageWarning,
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
    copyTimelineToAllSections,
    pastePartPhrase,
    loadSnapshotData,
    applyQuickSong,
    resetProjectToDefault,
  } = useBandGenerator();

  // Tab 4: BANDMASTER CONSOLE is initial default tab
  const [activeTab, setActiveTab] = useState<ActiveTab>('console');
  const [selectedSectionId, setSelectedSectionId] = useState<string>(
    () => song.sections[0]?.id ?? ''
  );
  const [riffModalSectionId, setRiffModalSectionId] = useState<string | null>(
    null
  );
  const [vocalModalSectionId, setVocalModalSectionId] = useState<string | null>(
    null
  );
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [quickGenModalOpen, setQuickGenModalOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [copiedPhrase, setCopiedPhrase] = useState<CopiedPartPhrase | null>(null);

  const audio = useAudioPreview(song, bandState, selectedSectionId);

  useEffect(() => {
    if (!song.sections.some((s) => s.id === selectedSectionId)) {
      setSelectedSectionId(song.sections[0]?.id ?? '');
    }
  }, [song.sections, selectedSectionId]);

  const riffModalSection = riffModalSectionId
    ? song.sections.find((s) => s.id === riffModalSectionId) ?? null
    : null;
  const vocalModalSection = vocalModalSectionId
    ? song.sections.find((s) => s.id === vocalModalSectionId) ?? null
    : null;

  const durationSummary = getSongDurationSummary(song);
  const isPreviewingSection =
    audio.previewState.status === 'playing' &&
    audio.playbackMode === 'section' &&
    audio.previewState.sectionLoop?.sectionId === selectedSectionId;
  const isPlaybackRunning = audio.previewState.status === 'playing';
  const playingSectionId =
    audio.previewState.status !== 'stopped'
      ? (findSectionSpanAtTick(
          audio.sectionSpans,
          audio.previewState.currentTick
        )?.sectionId ?? null)
      : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-row">
          <div className="brand-left">
            <h1 className="app-title">BANDMASTER</h1>
            <span className="version-pill">v{CURRENT_ENGINE_VERSION}</span>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="btn btn-primary header-quick-btn"
              onClick={() => setQuickGenModalOpen(true)}
            >
              ✨ 一発生成
            </button>
            <button
              type="button"
              className="btn btn-danger-muted header-reset-btn"
              onClick={() => setResetConfirmOpen(true)}
            >
              🗑️ 全消し
            </button>
            <button
              type="button"
              className="btn btn-secondary header-snapshot-btn"
              onClick={() => setSnapshotModalOpen(true)}
            >
              💾 保存 / 履歴
            </button>
          </div>
        </div>
        <div className="song-summary">
          {song.title} · {song.bpm} BPM · {song.key} {song.scale} ·{' '}
          {song.beatFeel} · {durationSummary.totalBars}小節 (
          {durationSummary.formattedDuration})
        </div>
      </header>

      {storageWarning && (
        <div className="alert-banner" role="alert">
          <span>{storageWarning}</span>
          <button
            type="button"
            className="btn-icon"
            onClick={dismissStorageWarning}
          >
            ✕
          </button>
        </div>
      )}

      <div className="top-sticky-dock">
        <nav className="tab-nav" aria-label="Main Navigation">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'song' ? 'active' : ''}`}
            onClick={() => setActiveTab('song')}
          >
            ⚙ SONG
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'arrangement' ? 'active' : ''}`}
            onClick={() => setActiveTab('arrangement')}
          >
            🎼 ARRANGE
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            🎸 MEMBERS
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'console' ? 'active' : ''}`}
            onClick={() => setActiveTab('console')}
          >
            🎛 CONSOLE
          </button>
        </nav>

        <PlaybackControls
          previewState={audio.previewState}
          playbackMode={audio.playbackMode}
          activeSectionId={selectedSectionId}
          sectionSpans={audio.sectionSpans}
          sections={song.sections}
          onSelectSection={setSelectedSectionId}
          onPlay={audio.play}
          onPause={audio.pause}
          onStop={audio.stop}
          onSeek={audio.seek}
          onChangePlaybackMode={audio.setPlaybackMode}
        />
      </div>

      <main className="main-layout">
        <div className="primary-col">
          {activeTab === 'song' && (
            <SongSettings
              song={song}
              onUpdateSong={updateSongField}
              onApplyTemplate={applyTemplate}
              onChangeSongDrumLoop={changeSongDrumLoop}
            />
          )}

          {activeTab === 'arrangement' && (
            <ArrangementEditor
              song={song}
              selectedSectionId={selectedSectionId}
              isPreviewingSection={isPreviewingSection}
              canUndo={canUndo}
              onSelectSection={setSelectedSectionId}
              onPreviewSection={audio.previewSection}
              onUndo={undo}
              onApplyArrangementPreset={(presetId) => {
                const firstId = applyArrangementPreset(presetId);
                if (firstId) setSelectedSectionId(firstId);
              }}
              onAddSection={addSection}
              onRemoveSection={removeSection}
              onDuplicateSection={duplicateSection}
              onMoveSection={moveSection}
              onReorderSection={reorderSection}
              onUpdateSectionProps={updateSectionProps}
              onChangeSectionBars={changeSectionBars}
              onChangeSectionKickMode={changeSectionKickMode}
              onChangeSectionDrumLoop={changeSectionDrumLoop}
              onToggleSectionPart={toggleSectionPart}
              onToggleRiff808Octave={toggleSectionRiff808Octave}
              onClearRiff={(id) => changeSectionRiff(id, undefined)}
              onOpenRiffModal={(id) => setRiffModalSectionId(id)}
              onOpenVocalModal={(id) => setVocalModalSectionId(id)}
              onClearVocalMelody={(id) => changeSectionVocalMelody(id, undefined)}
            />
          )}

          {activeTab === 'members' && (
            <MemberSettings song={song} onUpdateMember={updateMember} />
          )}

          {activeTab === 'console' && (
            <BandmasterConsole
              song={song}
              bandState={bandState}
              selectedSectionId={selectedSectionId}
              playingSectionId={playingSectionId}
              isPlaybackRunning={isPlaybackRunning}
              isPreviewingSection={isPreviewingSection}
              canUndo={canUndo}
              onSelectSection={setSelectedSectionId}
              onPreviewSection={audio.previewSection}
              onChangeSectionDrumLoop={changeSectionDrumLoop}
              onClearSectionDrumLoop={(id) => changeSectionDrumLoop(id, undefined)}
              onChangeSectionDrumDensity={changeSectionDrumDensity}
              onChangeSectionKeyboardDensity={changeSectionKeyboardDensity}
              onChangeSectionVocalDensity={changeSectionVocalDensity}
              onChangeSectionVocalHarmony={changeSectionVocalHarmony}
              onChangeSectionVocalDialecticalScheme={changeSectionVocalDialecticalScheme}
              onChangeSectionVocalChapterForm={changeSectionVocalChapterForm}
              copiedPhrase={copiedPhrase}
              onCopyPartPhrase={(phrase) => setCopiedPhrase(phrase)}
              onPastePartPhrase={pastePartPhrase}
              onChangeSectionPatternPreset={changeSectionPartPreset}
              onChangeSectionChordTimeline={changeSectionChordTimeline}
              onChangeSectionDrumAnticipationMode={changeSectionDrumAnticipationMode}
              onChangeSectionBassChromatic={changeSectionBassChromatic}
              onChangeSectionBassFillEnabled={changeSectionBassFillEnabled}
              onRerollSectionBassFill={rerollBassFill}
              onSetSectionDrumHat16thEnabled={setSectionDrumHat16thEnabled}
              onSetSectionDrumFillEnabled={setSectionDrumFillEnabled}
              onSetSectionDrumBreakEnabled={setSectionDrumBreakEnabled}
              onSetSectionDrumPatternId={setSectionDrumPatternId}
              onSetSectionDrumKickTake={setSectionDrumKickTake}
              onSetSectionAccompanimentSkeleton={setSectionAccompanimentSkeleton}
              onSetSectionAccompanimentTake={setSectionAccompanimentTake}
              onCopyTimelineToAllSections={copyTimelineToAllSections}
              onToggleSectionPart={toggleSectionPart}
              onOpenVocalModal={(id) => setVocalModalSectionId(id)}
              onClearSectionVocalMelody={(id) =>
                changeSectionVocalMelody(id, undefined)
              }
              onRegenerateAll={regenerateAll}
              onUndo={undo}
              onRegenerateCell={regenerateCell}
              onSelectTake={selectTake}
              onToggleLock={toggleLock}
            />
          )}
        </div>

        <aside className="side-col">
          <TrackControls
            mixer={audio.previewState.mixer}
            onToggleMute={audio.setTrackMute}
            onToggleSolo={audio.setTrackSolo}
            onVolumeChange={audio.setTrackVolume}
          />
        </aside>
      </main>

      {riffModalSection && (
        <RiffRecorderModal
          mode="riff"
          section={riffModalSection}
          bpm={song.bpm}
          songKey={song.key}
          scale={song.scale}
          onStopPreviewPlayback={audio.stop}
          onSave={(riff) => {
            changeSectionRiff(riffModalSection.id, riff);
            setRiffModalSectionId(null);
          }}
          onClose={() => setRiffModalSectionId(null)}
        />
      )}

      {vocalModalSection && (
        <RiffRecorderModal
          mode="vocal"
          section={vocalModalSection}
          bpm={song.bpm}
          songKey={song.key}
          scale={song.scale}
          onStopPreviewPlayback={audio.stop}
          onSaveVocal={(melody) => {
            changeSectionVocalMelody(vocalModalSection.id, melody);
            setVocalModalSectionId(null);
          }}
          onClose={() => setVocalModalSectionId(null)}
        />
      )}

      {snapshotModalOpen && (
        <ProjectSnapshotsModal
          song={song}
          bandState={bandState}
          onLoadSnapshot={(loadedSong, loadedState) => {
            audio.stop();
            loadSnapshotData(loadedSong, loadedState);
            setSelectedSectionId(loadedSong.sections[0]?.id ?? '');
          }}
          onClose={() => setSnapshotModalOpen(false)}
        />
      )}

      {quickGenModalOpen && (
        <QuickGenerateModal
          initialSong={song}
          onGenerate={(builtSong, seed) => {
            audio.stop();
            applyQuickSong(builtSong, seed);
            setSelectedSectionId(builtSong.sections[0]?.id ?? '');
          }}
          onClose={() => setQuickGenModalOpen(false)}
        />
      )}

      {resetConfirmOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="全消し確認"
        >
          <div className="modal-panel reset-confirm-modal">
            <div className="modal-header">
              <h3 className="panel-title">🗑️ 全消し（リセット）</h3>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setResetConfirmOpen(false)}
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>
            <p className="reset-confirm-message">
              現在の曲データと全セクションを削除して初期状態に戻しますか？（この操作は取り消せません）
            </p>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setResetConfirmOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  audio.stop();
                  resetProjectToDefault();
                  setResetConfirmOpen(false);
                }}
              >
                全消ししてリセット
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
