import { useState, type ChangeEvent } from 'react';
import { getDiatonicChords } from '../lib/chordUtils';
import { extractDrumLoopFromMidi } from '../lib/midiParser';
import type {
  DrumLoopData,
  EnergyLevel,
  KickMode,
  Section,
  SectionType,
  SongConfig,
} from '../types/song';

interface ArrangementEditorProps {
  song: SongConfig;
  selectedSectionId: string;
  canUndo: boolean;
  onSelectSection: (id: string) => void;
  onUndo: () => void;
  onAddSection: () => string;
  onRemoveSection: (id: string) => void;
  onDuplicateSection: (id: string) => string;
  onMoveSection: (id: string, dir: -1 | 1) => void;
  onUpdateSectionProps: (
    id: string,
    patch: Partial<Section>,
    regen?: boolean
  ) => void;
  onChangeSectionBars: (id: string, bars: number) => void;
  onChangeSectionKickMode: (id: string, mode: KickMode) => void;
  onChangeSectionDrumLoop: (id: string, loop?: DrumLoopData) => void;
  onTransposeSectionChords: (id: string, semitones: number) => void;
  onToggleRiff808Octave: (id: string, val?: boolean) => void;
  onClearRiff: (id: string) => void;
  onOpenRiffModal: (sectionId: string) => void;
}

const SECTION_TYPES: SectionType[] = [
  'Intro',
  'Verse',
  'Pre-Chorus',
  'Chorus',
  'Bridge',
  'Outro',
];

export function ArrangementEditor({
  song,
  selectedSectionId,
  canUndo,
  onSelectSection,
  onUndo,
  onAddSection,
  onRemoveSection,
  onDuplicateSection,
  onMoveSection,
  onUpdateSectionProps,
  onChangeSectionBars,
  onChangeSectionKickMode,
  onChangeSectionDrumLoop,
  onTransposeSectionChords,
  onToggleRiff808Octave,
  onClearRiff,
  onOpenRiffModal,
}: ArrangementEditorProps) {
  const [midiError, setMidiError] = useState<string | null>(null);
  const current =
    song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0];

  if (!current) return null;

  const diatonic = getDiatonicChords(song.key, song.scale);
  const currentIdx = song.sections.findIndex((s) => s.id === current.id);

  const handleSectionDrumUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setMidiError(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { drumLoop } = extractDrumLoopFromMidi(bytes, file.name);
      onChangeSectionDrumLoop(current.id, drumLoop);
    } catch (err) {
      setMidiError(err instanceof Error ? err.message : 'MIDI読込失敗');
    }
  };

  return (
    <div className="tab-content">
      <div className="toolbar-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onSelectSection(onAddSection())}
        >
          ＋ セクション追加
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!canUndo}
          onClick={onUndo}
        >
          ↩ 元に戻す (Undo)
        </button>
      </div>

      <div className="section-pills">
        {song.sections.map((sec, idx) => (
          <button
            key={sec.id}
            type="button"
            className={`pill ${sec.id === current.id ? 'active' : ''}`}
            onClick={() => onSelectSection(sec.id)}
          >
            {idx + 1}. {sec.name} ({sec.bars}小節)
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="panel-header-row">
          <h2 className="panel-title">セクション設定: {current.name}</h2>
          <div className="btn-group">
            <button
              type="button"
              className="btn-icon"
              disabled={currentIdx <= 0}
              onClick={() => onMoveSection(current.id, -1)}
              title="上へ移動"
            >
              ↑
            </button>
            <button
              type="button"
              className="btn-icon"
              disabled={currentIdx >= song.sections.length - 1}
              onClick={() => onMoveSection(current.id, 1)}
              title="下へ移動"
            >
              ↓
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => onSelectSection(onDuplicateSection(current.id))}
              title="複製"
            >
              ⧉
            </button>
            <button
              type="button"
              className="btn-icon danger"
              disabled={song.sections.length <= 1}
              onClick={() => onRemoveSection(current.id)}
              title="削除"
            >
              🗑
            </button>
          </div>
        </div>

        <div className="form-grid">
          <div className="field-row">
            <label className="field">
              <span>タイプ</span>
              <select
                value={current.type}
                onChange={(e) =>
                  onUpdateSectionProps(
                    current.id,
                    { type: e.target.value as SectionType },
                    true
                  )
                }
              >
                {SECTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>表示名（自由入力）</span>
              <input
                type="text"
                value={current.name}
                onChange={(e) =>
                  onUpdateSectionProps(current.id, { name: e.target.value })
                }
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>小節数 ({current.bars})</span>
              <input
                type="number"
                min={1}
                max={32}
                value={current.bars}
                onChange={(e) =>
                  onChangeSectionBars(
                    current.id,
                    Number(e.target.value) || 1
                  )
                }
              />
            </label>

            <label className="field">
              <span>Energy</span>
              <select
                value={current.energy}
                onChange={(e) =>
                  onUpdateSectionProps(
                    current.id,
                    { energy: e.target.value as EnergyLevel },
                    true
                  )
                }
              >
                <option value="Low">Low</option>
                <option value="Mid">Mid</option>
                <option value="High">High</option>
              </select>
            </label>
          </div>

          <div className="field">
            <span>Kick 音色モード</span>
            <div className="segmented">
              <button
                type="button"
                className={`seg-btn ${current.kickMode === 'acoustic' ? 'active' : ''}`}
                onClick={() => onChangeSectionKickMode(current.id, 'acoustic')}
              >
                🥁 生バスドラ (Acoustic)
              </button>
              <button
                type="button"
                className={`seg-btn ${current.kickMode === '808' ? 'active' : ''}`}
                onClick={() => onChangeSectionKickMode(current.id, '808')}
              >
                🔊 808 Kick
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header-row">
          <h3 className="panel-title">コード進行</h3>
          <div className="btn-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onTransposeSectionChords(current.id, -1)}
            >
              -1 半音
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onTransposeSectionChords(current.id, 1)}
            >
              +1 半音
            </button>
          </div>
        </div>

        <label className="field">
          <span>小節ごとのコード（カンマ区切り・循環）</span>
          <input
            type="text"
            value={current.chords.join(', ')}
            onChange={(e) => {
              const list = e.target.value
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean);
              onUpdateSectionProps(current.id, { chords: list }, true);
            }}
          />
        </label>

        <div className="palette-label">ワンタップコードパレット（末尾に追加）:</div>
        <div className="chip-list">
          {diatonic.map((ch) => (
            <button
              key={ch}
              type="button"
              className="chip-btn"
              onClick={() =>
                onUpdateSectionProps(
                  current.id,
                  { chords: [...current.chords, ch] },
                  true
                )
              }
            >
              +{ch}
            </button>
          ))}
          <button
            type="button"
            className="chip-btn chip-clear"
            onClick={() =>
              onUpdateSectionProps(current.id, { chords: [] }, true)
            }
          >
            クリア(自動ダイアトニック)
          </button>
        </div>
      </section>

      <section className="panel">
        <h3 className="panel-title">セクション別 ドラムMIDI / ギターユニゾンリフ</h3>
        <div className="toolbar-row">
          <label className="btn btn-secondary file-btn">
            🥁 セクションドラムMIDI読込
            <input
              type="file"
              accept=".mid,.midi,audio/midi"
              hidden
              onChange={handleSectionDrumUpload}
            />
          </label>
          {current.uploadedDrumLoop && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => onChangeSectionDrumLoop(current.id, undefined)}
            >
              ドラムMIDI解除
            </button>
          )}
        </div>
        {current.uploadedDrumLoop && (
          <p className="info-box">
            セクション専用ループ: <strong>{current.uploadedDrumLoop.fileName}</strong> (
            {current.uploadedDrumLoop.bars}小節)
          </p>
        )}
        {midiError && <p className="error-text">{midiError}</p>}

        <div className="riff-box">
          <div className="toolbar-row">
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => onOpenRiffModal(current.id)}
            >
              🎸 ギターユニゾンリフを設定・編集
            </button>
            {current.unisonRiff && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => onClearRiff(current.id)}
              >
                リフ解除
              </button>
            )}
          </div>

          {current.unisonRiff && (
            <div className="info-box">
              <div>
                設定済みリフ: <strong>{current.unisonRiff.sourceName}</strong> (
                {current.unisonRiff.bars}小節 / {current.unisonRiff.cleanedBassNotes.length}音 /{' '}
                {current.unisonRiff.analysisMethod})
              </div>
              {current.kickMode === '808' && (
                <div className="warning-stack">
                  <span className="badge badge-warn">
                    ⚠ 808 Kick 低音被り注意
                  </span>
                  <label className="switch-row compact">
                    <span>リフを+12（1オクターブ上）する</span>
                    <input
                      type="checkbox"
                      checked={Boolean(current.unisonRiff.octaveUpOn808)}
                      onChange={(e) =>
                        onToggleRiff808Octave(current.id, e.target.checked)
                      }
                    />
                  </label>
                  <span className="badge badge-info">
                    上限(G3=55)を超えるノートは+12されません
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
