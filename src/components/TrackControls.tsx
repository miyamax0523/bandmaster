import type { LogicalTrackType } from '../types/song';
import type { MixerState } from '../lib/audioPreview';

interface TrackControlsProps {
  mixer: MixerState;
  onToggleMute: (track: LogicalTrackType, muted: boolean) => void;
  onToggleSolo: (track: LogicalTrackType, solo: boolean) => void;
  onVolumeChange: (track: LogicalTrackType, volume: number) => void;
}

const TRACK_LABELS: Array<{ key: LogicalTrackType; label: string; icon: string }> = [
  { key: 'drums', label: 'Drums', icon: '🥁' },
  { key: 'kick808', label: '808 Kick', icon: '🔊' },
  { key: 'bass', label: 'Bass', icon: '🎸' },
  { key: 'keyboard', label: 'Keyboard', icon: '🎹' },
  { key: 'pad', label: 'PAD', icon: '🌊' },
  { key: 'vocal', label: 'Vocal', icon: '🎤' },
  { key: 'vocalHarmony', label: 'Vocal Harm', icon: '🎶' },
];

export function TrackControls({
  mixer,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
}: TrackControlsProps) {
  return (
    <section className="panel mixer-panel">
      <h3 className="panel-title">プレビューミキサー（Mute / Solo / Volume）</h3>
      <div className="mixer-list">
        {TRACK_LABELS.map(({ key, label, icon }) => {
          const strip = mixer[key];
          return (
            <div key={key} className="mixer-strip">
              <div className="mixer-label">
                <span>{icon}</span>
                <span>{label}</span>
              </div>
              <div className="mixer-actions">
                <button
                  type="button"
                  className={`mini-toggle ${strip.muted ? 'muted-on' : ''}`}
                  onClick={() => onToggleMute(key, !strip.muted)}
                  aria-pressed={strip.muted}
                >
                  M
                </button>
                <button
                  type="button"
                  className={`mini-toggle ${strip.solo ? 'solo-on' : ''}`}
                  onClick={() => onToggleSolo(key, !strip.solo)}
                  aria-pressed={strip.solo}
                >
                  S
                </button>
                <input
                  type="range"
                  className="volume-slider"
                  min={0}
                  max={1.2}
                  step={0.05}
                  value={strip.volume}
                  aria-label={`${label} Volume`}
                  onChange={(e) =>
                    onVolumeChange(key, parseFloat(e.target.value))
                  }
                />
                <span className="vol-readout">
                  {Math.round(strip.volume * 100)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
