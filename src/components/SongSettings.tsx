import { useState, type ChangeEvent } from 'react';
import { KEY_NAMES } from '../lib/chordUtils';
import {
  extractDrumLoopFromMidi,
  type ParsedMidiFile,
} from '../lib/midiParser';
import type { QuickTemplateId } from '../lib/bandState';
import { MASTER_GENRE_LIST } from '../lib/masterGenres';
import type {
  BeatFeel,
  DrumLoopData,
  KeyName,
  ScaleType,
  SongConfig,
  SwingTarget,
} from '../types/song';

interface SongSettingsProps {
  song: SongConfig;
  onUpdateSong: (updater: (draft: SongConfig) => void, regenAll?: boolean) => void;
  onApplyTemplate: (templateId: QuickTemplateId) => void;
  onChangeSongDrumLoop: (loop?: DrumLoopData) => void;
}

const TEMPLATES: Array<{ id: QuickTemplateId; label: string; desc: string }> =
  MASTER_GENRE_LIST.map((g) => ({
    id: g.id,
    label: `${g.icon} ${g.label}`,
    desc: g.desc,
  }));

export function SongSettings({
  song,
  onUpdateSong,
  onApplyTemplate,
  onChangeSongDrumLoop,
}: SongSettingsProps) {
  const [midiError, setMidiError] = useState<string | null>(null);
  const [parsedMidi, setParsedMidi] = useState<{
    fileName: string;
    bytes: Uint8Array;
    parsed: ParsedMidiFile;
  } | null>(null);

  const handleDrumFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setMidiError(null);
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const { drumLoop, parsed } = extractDrumLoopFromMidi(bytes, file.name);
      setParsedMidi({ fileName: file.name, bytes, parsed });
      onChangeSongDrumLoop(drumLoop);
    } catch (err) {
      setMidiError(
        err instanceof Error ? err.message : 'MIDIファイルの解析に失敗しました'
      );
    }
  };

  const handleSwitchTrack = (trackIndex: number) => {
    if (!parsedMidi) return;
    try {
      setMidiError(null);
      const { drumLoop } = extractDrumLoopFromMidi(
        parsedMidi.bytes,
        parsedMidi.fileName,
        trackIndex
      );
      onChangeSongDrumLoop(drumLoop);
    } catch (err) {
      setMidiError(err instanceof Error ? err.message : 'トラック切替に失敗しました');
    }
  };

  return (
    <div className="tab-content">
      <section className="panel">
        <h2 className="panel-title">曲の基本設定</h2>
        <div className="form-grid">
          <label className="field">
            <span>曲名</span>
            <input
              type="text"
              value={song.title}
              onChange={(e) =>
                onUpdateSong((d) => {
                  d.title = e.target.value;
                })
              }
            />
          </label>

          <div className="field">
            <span>BPM ({song.bpm})</span>
            <div className="inline-range">
              <button
                type="button"
                className="btn btn-secondary bpm-step-btn"
                disabled={song.bpm <= 60}
                aria-label="BPMを1下げる"
                onClick={() =>
                  onUpdateSong((d) => {
                    d.bpm = Math.max(60, d.bpm - 1);
                  })
                }
              >
                ◀
              </button>
              <input
                type="range"
                className="bpm-range"
                min={60}
                max={200}
                value={song.bpm}
                aria-label="BPM スライダー"
                onChange={(e) =>
                  onUpdateSong((d) => {
                    d.bpm = Number(e.target.value);
                  })
                }
              />
              <button
                type="button"
                className="btn btn-secondary bpm-step-btn"
                disabled={song.bpm >= 200}
                aria-label="BPMを1上げる"
                onClick={() =>
                  onUpdateSong((d) => {
                    d.bpm = Math.min(200, d.bpm + 1);
                  })
                }
              >
                ▶
              </button>
              <input
                type="number"
                className="num-input"
                min={60}
                max={200}
                value={song.bpm}
                aria-label="BPM 数値入力"
                onChange={(e) =>
                  onUpdateSong((d) => {
                    d.bpm = Math.min(
                      200,
                      Math.max(60, Number(e.target.value) || 120)
                    );
                  })
                }
              />
            </div>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Key</span>
              <select
                value={song.key}
                onChange={(e) =>
                  onUpdateSong((d) => {
                    d.key = e.target.value as KeyName;
                  }, true)
                }
              >
                {KEY_NAMES.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Scale</span>
              <select
                value={song.scale}
                onChange={(e) =>
                  onUpdateSong((d) => {
                    d.scale = e.target.value as ScaleType;
                  }, true)
                }
              >
                <option value="Minor">Minor</option>
                <option value="Major">Major</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Beat Feel</span>
            <select
              value={song.beatFeel}
              onChange={(e) =>
                onUpdateSong((d) => {
                  d.beatFeel = e.target.value as BeatFeel;
                }, true)
              }
            >
              <option value="Straight">Straight</option>
              <option value="Half-Time">Half-Time</option>
              <option value="Bounce">Bounce</option>
              <option value="Driving">Driving</option>
            </select>
          </label>

          <div className="field">
            <span>Swing: {song.swing}%</span>
            <div className="inline-range">
              <input
                type="range"
                min={0}
                max={50}
                value={song.swing}
                onChange={(e) =>
                  onUpdateSong((d) => {
                    d.swing = Number(e.target.value);
                  })
                }
              />
              <div className="segmented">
                {(['8th', '16th'] as SwingTarget[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`seg-btn ${song.swingTarget === t ? 'active' : ''}`}
                    onClick={() =>
                      onUpdateSong((d) => {
                        d.swingTarget = t;
                      })
                    }
                  >
                    {t === '8th' ? '8分' : '16分'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">MIDI書き出し設定</h2>
        <div className="switch-list">
          <label className="switch-row">
            <div>
              <strong>808 Kick 自動分離出力</strong>
              <p className="hint-text">
                ON: ch3別トラック(ロングノート) / OFF: Drums(ch9)へ統合
              </p>
            </div>
            <input
              type="checkbox"
              checked={song.split808KickTrack}
              onChange={(e) =>
                onUpdateSong((d) => {
                  d.split808KickTrack = e.target.checked;
                })
              }
            />
          </label>

          <label className="switch-row">
            <div>
              <strong>ノート0のトラックを除外</strong>
              <p className="hint-text">
                未使用楽器の空トラックをMIDIファイルに含めません
              </p>
            </div>
            <input
              type="checkbox"
              checked={song.exportOnlyActiveTracks}
              onChange={(e) =>
                onUpdateSong((d) => {
                  d.exportOnlyActiveTracks = e.target.checked;
                })
              }
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">クイック編成テンプレート</h2>
        <div className="template-grid">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="template-card"
              onClick={() => onApplyTemplate(tpl.id)}
            >
              <strong>{tpl.label}</strong>
              <span>{tpl.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">全体ドラムMIDIループ読込</h2>
        <p className="hint-text">
          1〜4小節のドラムMIDIを読み込むと曲全体の基本グルーヴに適用されます（セクション個別ループが優先）。
        </p>
        <div className="file-row">
          <label className="btn btn-secondary file-btn">
            🥁 MIDIファイルを選択
            <input
              type="file"
              accept=".mid,.midi,audio/midi"
              hidden
              onChange={handleDrumFile}
            />
          </label>
          {song.uploadedDrumLoop && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setParsedMidi(null);
                onChangeSongDrumLoop(undefined);
              }}
            >
              ループ解除
            </button>
          )}
        </div>
        {song.uploadedDrumLoop && (
          <div className="info-box">
            読込中: <strong>{song.uploadedDrumLoop.fileName}</strong> (
            {song.uploadedDrumLoop.bars}小節 / {song.uploadedDrumLoop.notes.length}音)
            {parsedMidi && parsedMidi.parsed.tracks.length > 1 && (
              <div className="field" style={{ marginTop: 8 }}>
                <span>参照トラック選択</span>
                <select
                  value={song.uploadedDrumLoop.sourceTrackIndex}
                  onChange={(e) => handleSwitchTrack(Number(e.target.value))}
                >
                  {parsedMidi.parsed.tracks.map((t) => (
                    <option key={t.index} value={t.index}>
                      Track {t.index}: {t.name ?? 'Unnamed'} ({t.notes.length}音
                      {t.hasChannel9 ? ' / ch10' : ''})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
        {midiError && <p className="error-text">{midiError}</p>}
      </section>
    </div>
  );
}
