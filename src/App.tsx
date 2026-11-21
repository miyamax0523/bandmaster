import { useEffect, useState } from 'react';
import { ArrangementEditor } from './components/ArrangementEditor';
import { BandmasterConsole } from './components/BandmasterConsole';
import { MemberSettings } from './components/MemberSettings';
import { PlaybackControls } from './components/PlaybackControls';
import { ProjectSnapshotsModal } from './components/ProjectSnapshotsModal';
import { RiffRecorderModal } from './components/RiffRecorderModal';
import { SongSettings } from './components/SongSettings';
import { TrackControls } from './components/TrackControls';
import { useAudioPreview } from './hooks/useAudioPreview';
import { useBandGenerator } from './hooks/useBandGenerator';
import { getSongDurationSummary } from './lib/bandState';
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
    changeSectionKeyboardDensity,
    changeSectionPartPreset,
    changeSectionChordTimeline,
    copyTimelineToAllSections,
    pastePartPhrase,
    loadSnapshotData,
    transposeSectionChords,
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-row">
          <div className="brand-left">
            <h1 className="app-title">BANDMASTER</h1>
            <span className="version-pill">v{CURRENT_ENGINE_VERSION}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary header-snapshot-btn"
            onClick={() => setSnapshotModalOpen(true)}
          >
            💾 保存 / 履歴
          </button>
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
              onTransposeSectionChords={transposeSectionChords}
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
              copiedPhrase={copiedPhrase}
              onCopyPartPhrase={(phrase) => setCopiedPhrase(phrase)}
              onPastePartPhrase={pastePartPhrase}
              onChangeSectionPatternPreset={changeSectionPartPreset}
              onChangeSectionChordTimeline={changeSectionChordTimeline}
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
          <PlaybackControls
            previewState={audio.previewState}
            playbackMode={audio.playbackMode}
            activeSectionId={selectedSectionId}
            sectionSpans={audio.sectionSpans}
            onPlay={audio.play}
            onPause={audio.pause}
            onStop={audio.stop}
            onSeek={audio.seek}
            onChangePlaybackMode={audio.setPlaybackMode}
          />
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
    </div>
  );
}

export default App;
