import { useEffect, useState } from 'react';
import { ArrangementEditor } from './components/ArrangementEditor';
import { BandmasterConsole } from './components/BandmasterConsole';
import { MemberSettings } from './components/MemberSettings';
import { PlaybackControls } from './components/PlaybackControls';
import { RiffRecorderModal } from './components/RiffRecorderModal';
import { SongSettings } from './components/SongSettings';
import { TrackControls } from './components/TrackControls';
import { useAudioPreview } from './hooks/useAudioPreview';
import { useBandGenerator } from './hooks/useBandGenerator';
import { getSongDurationSummary } from './lib/bandState';
import { CURRENT_ENGINE_VERSION } from './types/song';

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
    updateSectionProps,
    changeSectionBars,
    changeSectionKickMode,
    changeSectionDrumLoop,
    changeSongDrumLoop,
    changeSectionRiff,
    toggleSectionRiff808Octave,
    transposeSectionChords,
  } = useBandGenerator();

  const audio = useAudioPreview(song, bandState);

  // Tab 4: BANDMASTER CONSOLE is initial default tab
  const [activeTab, setActiveTab] = useState<ActiveTab>('console');
  const [selectedSectionId, setSelectedSectionId] = useState<string>(
    () => song.sections[0]?.id ?? ''
  );
  const [riffModalSectionId, setRiffModalSectionId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!song.sections.some((s) => s.id === selectedSectionId)) {
      setSelectedSectionId(song.sections[0]?.id ?? '');
    }
  }, [song.sections, selectedSectionId]);

  const riffModalSection = riffModalSectionId
    ? song.sections.find((s) => s.id === riffModalSectionId) ?? null
    : null;

  const durationSummary = getSongDurationSummary(song);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-row">
          <h1 className="app-title">BANDMASTER</h1>
          <span className="version-pill">v{CURRENT_ENGINE_VERSION}</span>
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
              canUndo={canUndo}
              onSelectSection={setSelectedSectionId}
              onUndo={undo}
              onApplyArrangementPreset={(presetId) => {
                const firstId = applyArrangementPreset(presetId);
                if (firstId) setSelectedSectionId(firstId);
              }}
              onAddSection={addSection}
              onRemoveSection={removeSection}
              onDuplicateSection={duplicateSection}
              onMoveSection={moveSection}
              onUpdateSectionProps={updateSectionProps}
              onChangeSectionBars={changeSectionBars}
              onChangeSectionKickMode={changeSectionKickMode}
              onChangeSectionDrumLoop={changeSectionDrumLoop}
              onTransposeSectionChords={transposeSectionChords}
              onToggleRiff808Octave={toggleSectionRiff808Octave}
              onClearRiff={(id) => changeSectionRiff(id, undefined)}
              onOpenRiffModal={(id) => setRiffModalSectionId(id)}
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
              canUndo={canUndo}
              onSelectSection={setSelectedSectionId}
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
            activeSectionId={selectedSectionId}
            sectionSpans={audio.sectionSpans}
            onPlay={audio.play}
            onPause={audio.pause}
            onStop={audio.stop}
            onSeek={audio.seek}
            onToggleSectionLoop={audio.setSectionLoop}
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
          section={riffModalSection}
          bpm={song.bpm}
          onStopPreviewPlayback={audio.stop}
          onSave={(riff) => {
            changeSectionRiff(riffModalSection.id, riff);
            setRiffModalSectionId(null);
          }}
          onClose={() => setRiffModalSectionId(null)}
        />
      )}
    </div>
  );
}

export default App;
