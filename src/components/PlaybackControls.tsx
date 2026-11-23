import { TICKS_PER_BAR, TICKS_PER_BEAT, type Section } from '../types/song';
import type { AudioPreviewState } from '../lib/audioPreview';
import type { PlaybackMode } from '../hooks/useAudioPreview';
import {
  findSectionSpanAtTick,
  type SectionSpan,
} from '../lib/noteSelector';

interface PlaybackControlsProps {
  previewState: AudioPreviewState;
  playbackMode: PlaybackMode;
  activeSectionId: string;
  sectionSpans: SectionSpan[];
  sections?: readonly Section[];
  onSelectSection?: (sectionId: string) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (tick: number) => void;
  onChangePlaybackMode: (mode: PlaybackMode) => void;
}

function formatPosition(tick: number): string {
  const bar = Math.floor(tick / TICKS_PER_BAR) + 1;
  const beat = Math.floor((tick % TICKS_PER_BAR) / TICKS_PER_BEAT) + 1;
  return `${bar}:${beat}`;
}

export function PlaybackControls({
  previewState,
  playbackMode,
  activeSectionId,
  sectionSpans,
  sections,
  onSelectSection,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onChangePlaybackMode,
}: PlaybackControlsProps) {
  const activeSpan =
    sectionSpans.find((s) => s.sectionId === activeSectionId) ?? null;
  const currentSpan = findSectionSpanAtTick(
    sectionSpans,
    previewState.currentTick
  );
  const currentSection =
    currentSpan && sections
      ? sections.find((s) => s.id === currentSpan.sectionId) ?? null
      : null;
  const isPlaying = previewState.status === 'playing';
  const isPaused = previewState.status === 'paused';

  return (
    <section
      className="transport-bar transport-bar--top"
      aria-label="Playback Controls"
    >
      <div className="transport-top-row">
        <div className="transport-buttons">
          {previewState.status === 'playing' ? (
            <button
              type="button"
              className="btn btn-primary transport-action-btn"
              onClick={onPause}
            >
              ⏸ 一時停止
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary transport-action-btn"
              onClick={onPlay}
              disabled={previewState.totalTicks === 0}
            >
              ▶ 再生
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary transport-action-btn"
            onClick={onStop}
          >
            ⏹ 停止
          </button>
        </div>

        <div className="mode-toggle-row" role="group" aria-label="再生モード">
          <button
            type="button"
            className={`btn mode-btn ${playbackMode === 'song' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onChangePlaybackMode('song')}
          >
            🎵 全曲
          </button>
          <button
            type="button"
            className={`btn mode-btn ${playbackMode === 'section' ? 'btn-accent' : 'btn-secondary'}`}
            disabled={!activeSpan}
            onClick={() => onChangePlaybackMode('section')}
          >
            🔁 セクションループ
          </button>
        </div>
      </div>

      <div className="transport-seek">
        {currentSection && currentSpan && (
          <button
            type="button"
            className={`now-playing-section-badge ${isPlaying ? 'is-playing' : isPaused ? 'is-paused' : ''}`}
            onClick={() => onSelectSection?.(currentSection.id)}
            title="クリックでこのセクションを表示"
            aria-live="polite"
          >
            {isPlaying && <span className="playing-dot" aria-hidden="true" />}
            {isPaused && <span aria-hidden="true">⏸</span>}
            <span>
              {currentSpan.sectionIndex + 1}. {currentSection.name}
            </span>
          </button>
        )}
        <span className="pos-badge">
          {formatPosition(previewState.currentTick)}
        </span>
        <input
          type="range"
          className="seek-slider"
          min={0}
          max={Math.max(1, previewState.totalTicks)}
          step={120}
          value={Math.min(previewState.currentTick, previewState.totalTicks)}
          aria-label="Seek Position"
          onChange={(e) => onSeek(Number(e.target.value))}
        />
        <span className="bpm-badge">{previewState.bpm} BPM</span>
      </div>
    </section>
  );
}
