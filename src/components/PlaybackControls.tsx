import { TICKS_PER_BAR, TICKS_PER_BEAT } from '../types/song';
import type { AudioPreviewState } from '../lib/audioPreview';
import type { PlaybackMode } from '../hooks/useAudioPreview';
import type { SectionSpan } from '../lib/noteSelector';

interface PlaybackControlsProps {
  previewState: AudioPreviewState;
  playbackMode: PlaybackMode;
  activeSectionId: string;
  sectionSpans: SectionSpan[];
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
  onPlay,
  onPause,
  onStop,
  onSeek,
  onChangePlaybackMode,
}: PlaybackControlsProps) {
  const activeSpan =
    sectionSpans.find((s) => s.sectionId === activeSectionId) ?? null;

  return (
    <section className="transport-bar" aria-label="Playback Controls">
      <div className="mode-toggle-row" role="group" aria-label="再生モード">
        <button
          type="button"
          className={`btn mode-btn ${playbackMode === 'song' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onChangePlaybackMode('song')}
        >
          🎵 通し再生（全曲）
        </button>
        <button
          type="button"
          className={`btn mode-btn ${playbackMode === 'section' ? 'btn-accent' : 'btn-secondary'}`}
          disabled={!activeSpan}
          onClick={() => onChangePlaybackMode('section')}
        >
          🔁 このセクションだけ再生（ループ）
        </button>
      </div>

      <div className="transport-buttons">
        {previewState.status === 'playing' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onPause}
          >
            ⏸ 一時停止
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onPlay}
            disabled={previewState.totalTicks === 0}
          >
            ▶ 再生
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onStop}>
          ⏹ 停止
        </button>
      </div>

      <div className="transport-seek">
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
      <p className="hint-text">
        ※モバイルPWA/バックグラウンド切替時は端末仕様により再生が中断される場合があります（復帰時に自動再同期します）。
      </p>
    </section>
  );
}
