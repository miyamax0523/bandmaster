import { useMemo, useState } from 'react';
import { midiToSpnLabel, VOCAL_VOICE_PROFILES } from '../engines/musicCore';
import { KEY_NAMES } from '../lib/chordUtils';
import type { MasterGenreId } from '../lib/masterGenres';
import type { ScaleType, SongConfig, VocalVoicePresetId } from '../types/song';
import {
  buildSongFromQuickSetup,
  QUICK_CHORD_PRESETS,
  QUICK_GENRE_LIST,
  QUICK_GENRE_META,
  QUICK_STRUCTURE_TEMPLATES,
  resolveEffectiveStructureTemplate,
  type QuickChordPresetId,
  type QuickSongLengthId,
  type QuickStructureTemplateId,
} from '../utils/quickSongBuilder';

interface QuickGenerateModalProps {
  initialSong: SongConfig;
  onGenerate: (song: SongConfig, seed: number) => void;
  onClose: () => void;
}

const LENGTH_TABS: Array<{ id: QuickSongLengthId; label: string }> = [
  { id: 'short_loop', label: 'ショート' },
  { id: 'one_chorus', label: 'ワンハーフ / 1コーラス' },
  { id: 'full_chorus', label: 'フル構成（約2分半）' },
];

const GENRE_LIST = QUICK_GENRE_LIST;
const TEMPLATE_LIST = Object.values(QUICK_STRUCTURE_TEMPLATES);

function formatDurationEstimate(totalBars: number, bpm: number): string {
  const totalSeconds = Math.round((totalBars * 4 * 60) / Math.max(40, bpm));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins === 0) return `約 ${secs}秒`;
  return `約 ${mins}分${String(secs).padStart(2, '0')}秒`;
}

export function QuickGenerateModal({
  initialSong,
  onGenerate,
  onClose,
}: QuickGenerateModalProps) {
  const [genre, setGenre] = useState<MasterGenreId>('royal_jpop');
  const [keyRoot, setKeyRoot] = useState<string>(initialSong.key || 'C');
  const [scaleType, setScaleType] = useState<ScaleType>(initialSong.scale || 'Major');
  const [bpm, setBpm] = useState<number>(initialSong.bpm || 145);
  const [autoSyncBpm, setAutoSyncBpm] = useState<boolean>(true);
  const [songLength, setSongLength] = useState<QuickSongLengthId>('full_chorus');
  const [structureTemplate, setStructureTemplate] =
    useState<QuickStructureTemplateId>('full_standard');
  const [chordPreset, setChordPreset] = useState<QuickChordPresetId>('auto_by_genre');
  const [customChordsText, setCustomChordsText] = useState<string>('Fmaj7 G6 Em7 Am7');
  const [includeAnticipation, setIncludeAnticipation] = useState<boolean>(true);
  const [voiceProfileId, setVoiceProfileId] = useState<VocalVoicePresetId>(
    initialSong.vocalVoiceProfileId ?? 'chisa_jp'
  );
  const [customMinMidi, setCustomMinMidi] = useState<number>(
    initialSong.vocalCustomMinMidi ?? 55
  );
  const [customMaxMidi, setCustomMaxMidi] = useState<number>(
    initialSong.vocalCustomMaxMidi ?? 74
  );

  const templatesForLength = useMemo(
    () => TEMPLATE_LIST.filter((t) => t.lengthId === songLength),
    [songLength]
  );

  const effectiveTemplate = useMemo(
    () => resolveEffectiveStructureTemplate(structureTemplate, genre, bpm),
    [structureTemplate, genre, bpm]
  );
  const isBalladAutoScaled =
    effectiveTemplate.id === 'full_ballad_60' &&
    structureTemplate !== 'full_ballad_60';
  const totalBars = useMemo(
    () => effectiveTemplate.sections.reduce((sum, s) => sum + s.bars, 0),
    [effectiveTemplate]
  );

  const handleSelectGenre = (nextGenre: MasterGenreId) => {
    setGenre(nextGenre);
    const meta = QUICK_GENRE_META[nextGenre];
    if (autoSyncBpm) {
      setBpm(meta.recommendedBpm);
    }
    setScaleType(meta.defaultScale);
  };

  const handleSelectLength = (nextLength: QuickSongLengthId) => {
    setSongLength(nextLength);
    const first = TEMPLATE_LIST.find((t) => t.lengthId === nextLength);
    if (first) {
      setStructureTemplate(first.id);
    }
  };

  const handleExecute = () => {
    const seed = (Date.now() & 0x7fffff) + 31;
    const built = buildSongFromQuickSetup(
      {
        keyRoot,
        scaleType,
        bpm,
        genre,
        songLength,
        structureTemplate,
        chordPreset,
        customChordsText: chordPreset === 'custom' ? customChordsText : undefined,
        includeAnticipation,
        vocalVoiceProfileId: voiceProfileId,
        vocalCustomMinMidi: customMinMidi,
        vocalCustomMaxMidi: Math.max(customMinMidi + 12, customMaxMidi),
      },
      seed
    );
    onGenerate(built, seed);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="クイック一発生成"
    >
      <div className="modal-panel quick-gen-modal-panel">
        <div className="modal-header">
          <div>
            <h3 className="panel-title">✨ クイック一発生成（ポン出し）</h3>
            <p className="piano-roll-caption">
              曲調・Key・BPM・長さを選ぶだけで全5パートを自動構築します
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <div className="quick-gen-body">
          <div className="quick-gen-section">
            <span className="quick-gen-label">1. 曲調（ジャンル）</span>
            <div className="quick-genre-grid">
              {GENRE_LIST.map((g) => {
                const active = genre === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`quick-genre-card ${active ? 'active' : ''}`}
                    onClick={() => handleSelectGenre(g.id)}
                  >
                    <div className="quick-genre-title">
                      <span>{g.icon}</span>
                      <span>{g.label}</span>
                    </div>
                    <div className="quick-genre-desc">{g.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="quick-gen-row-2">
            <label className="field">
              <span>2. Key（ルート音）</span>
              <select
                value={keyRoot}
                onChange={(e) => setKeyRoot(e.target.value)}
                aria-label="Key ルート音"
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
                value={scaleType}
                onChange={(e) => setScaleType(e.target.value as ScaleType)}
                aria-label="Scale"
              >
                <option value="Major">Major</option>
                <option value="Minor">Minor</option>
              </select>
            </label>
          </div>

          <div className="quick-gen-section">
            <div className="quick-bpm-header">
              <span className="quick-gen-label">3. テンポ ({bpm} BPM)</span>
              <label className="switch-inline compact">
                <input
                  type="checkbox"
                  checked={autoSyncBpm}
                  onChange={(e) => setAutoSyncBpm(e.target.checked)}
                />
                <span>ジャンル推奨BPM連動</span>
              </label>
            </div>
            <div className="inline-range">
              <button
                type="button"
                className="btn btn-secondary bpm-step-btn"
                disabled={bpm <= 60}
                aria-label="BPMを1下げる"
                onClick={() => {
                  setAutoSyncBpm(false);
                  setBpm((v) => Math.max(60, v - 1));
                }}
              >
                ◀
              </button>
              <input
                type="range"
                className="bpm-range"
                min={60}
                max={200}
                value={bpm}
                aria-label="クイック生成 BPMスライダー"
                onChange={(e) => {
                  setAutoSyncBpm(false);
                  setBpm(Number(e.target.value));
                }}
              />
              <button
                type="button"
                className="btn btn-secondary bpm-step-btn"
                disabled={bpm >= 200}
                aria-label="BPMを1上げる"
                onClick={() => {
                  setAutoSyncBpm(false);
                  setBpm((v) => Math.min(200, v + 1));
                }}
              >
                ▶
              </button>
            </div>
          </div>

          <div className="quick-gen-section">
            <span className="quick-gen-label">4. 欲しい曲の長さ ＆ 展開構成</span>
            <div className="density-segments" role="group" aria-label="曲の長さ">
              {LENGTH_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`density-btn ${songLength === tab.id ? 'active' : ''}`}
                  onClick={() => handleSelectLength(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <select
              value={structureTemplate}
              onChange={(e) =>
                setStructureTemplate(e.target.value as QuickStructureTemplateId)
              }
              aria-label="展開構成テンプレート"
            >
              {templatesForLength.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <div className="quick-duration-badge">
              合計 {totalBars}小節 / {formatDurationEstimate(totalBars, bpm)} @ {bpm} BPM
              {isBalladAutoScaled && '（バラード用60小節へ自動最適化）'}
            </div>
          </div>

          <div className="quick-gen-section">
            <label className="field">
              <span>5. コード進行</span>
              <select
                value={chordPreset}
                onChange={(e) =>
                  setChordPreset(e.target.value as QuickChordPresetId)
                }
                aria-label="コード進行プリセット"
              >
                {QUICK_CHORD_PRESETS.map((cp) => (
                  <option key={cp.id} value={cp.id}>
                    {cp.label}
                  </option>
                ))}
              </select>
            </label>

            {chordPreset === 'custom' && (
              <label className="field">
                <span>カスタムコード進行（スペース区切り）</span>
                <input
                  type="text"
                  value={customChordsText}
                  onChange={(e) => setCustomChordsText(e.target.value)}
                  placeholder="例: Fmaj7 G6 Em7 Am7"
                />
              </label>
            )}

            <label className="switch-row compact">
              <span>サビ前Bメロ末尾の240 ticks裏拍食い込みを自動付与</span>
              <input
                type="checkbox"
                checked={includeAnticipation}
                onChange={(e) => setIncludeAnticipation(e.target.checked)}
              />
            </label>

            <label
              className="field"
              title="VoiSona基準 (C4=60) によるボーカル音域設定（初期値: 知声 G3–D5）"
            >
              <span>6. ボーカル音域（VoiSona基準 C4=60）</span>
              <select
                value={voiceProfileId}
                onChange={(e) =>
                  setVoiceProfileId(e.target.value as VocalVoicePresetId)
                }
                aria-label="ボーカルボイスプリセット"
              >
                <option value="chisa_jp">{VOCAL_VOICE_PROFILES.chisa_jp.label}</option>
                <option value="female_high">
                  {VOCAL_VOICE_PROFILES.female_high.label}
                </option>
                <option value="male_rock">{VOCAL_VOICE_PROFILES.male_rock.label}</option>
                <option value="custom">カスタム</option>
              </select>
            </label>

            {voiceProfileId === 'custom' && (
              <div className="quick-gen-row-2">
                <label className="field" title="VoiSona基準 (C4=60)">
                  <span>Min ({midiToSpnLabel(customMinMidi)})</span>
                  <select
                    value={customMinMidi}
                    aria-label="カスタムボーカル最低音"
                    onChange={(e) => {
                      const nextMin = Number(e.target.value);
                      setCustomMinMidi(nextMin);
                      if (customMaxMidi < nextMin + 12) {
                        setCustomMaxMidi(Math.min(88, nextMin + 12));
                      }
                    }}
                  >
                    {Array.from({ length: 37 }, (_, i) => 40 + i).map((m) => (
                      <option key={m} value={m}>
                        {midiToSpnLabel(m)} (MIDI {m})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" title="VoiSona基準 (C4=60)">
                  <span>Max ({midiToSpnLabel(Math.max(customMinMidi + 12, customMaxMidi))})</span>
                  <select
                    value={Math.max(customMinMidi + 12, customMaxMidi)}
                    aria-label="カスタムボーカル最高音"
                    onChange={(e) =>
                      setCustomMaxMidi(
                        Math.max(customMinMidi + 12, Number(e.target.value))
                      )
                    }
                  >
                    {Array.from(
                      { length: Math.max(1, 88 - (customMinMidi + 12) + 1) },
                      (_, i) => customMinMidi + 12 + i
                    ).map((m) => (
                      <option key={m} value={m}>
                        {midiToSpnLabel(m)} (MIDI {m})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-primary quick-gen-submit-btn"
            onClick={handleExecute}
          >
            🎵 この内容で一発生成する
          </button>
        </div>
      </div>
    </div>
  );
}
