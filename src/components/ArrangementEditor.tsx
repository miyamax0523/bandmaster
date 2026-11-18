import { useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import {
  getSongDurationSummary,
  type ArrangementPresetId,
} from '../lib/bandState';
import {
  applySuffixToChord,
  getChordPalette,
  type ChordPaletteMode,
} from '../lib/chordUtils';
import { extractDrumLoopFromMidi } from '../lib/midiParser';
import { useHorizontalSwipe } from '../lib/touchSwipe';
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
  isPreviewingSection: boolean;
  canUndo: boolean;
  onSelectSection: (id: string) => void;
  onPreviewSection: (sectionId: string) => void;
  onUndo: () => void;
  onApplyArrangementPreset: (presetId: ArrangementPresetId) => void;
  onAddSection: () => string;
  onRemoveSection: (id: string) => void;
  onDuplicateSection: (id: string) => string;
  onMoveSection: (id: string, dir: -1 | 1) => void;
  onReorderSection: (fromIndex: number, toIndex: number) => void;
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

const ARRANGEMENT_PRESETS: Array<{ id: ArrangementPresetId; label: string }> = [
  { id: 'twoPart', label: '2部構成 (Verse / Chorus)' },
  { id: 'fourPart', label: '王道4部 (Intro / A / B / サビ)' },
  { id: 'full', label: 'フル構成 (Intro / A / B / サビ / C / Outro)' },
];

const PALETTE_MODES: Array<{ id: ChordPaletteMode; label: string }> = [
  { id: 'triad', label: '基本' },
  { id: 'seventh', label: 'M7 / m7' },
  { id: 'ninth', label: 'M9 / m9' },
  { id: 'add9sus', label: 'add9 / sus' },
  { id: 'power', label: '5 (パワー)' },
];

const SUFFIX_CONVERTERS = ['M7', 'M9', 'add9', 'm7', 'm9', 'sus2', 'sus4', '5'] as const;

export function ArrangementEditor({
  song,
  selectedSectionId,
  isPreviewingSection,
  canUndo,
  onSelectSection,
  onPreviewSection,
  onUndo,
  onApplyArrangementPreset,
  onAddSection,
  onRemoveSection,
  onDuplicateSection,
  onMoveSection,
  onReorderSection,
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
  const [paletteMode, setPaletteMode] = useState<ChordPaletteMode>('triad');
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const currentIdx = Math.max(
    0,
    song.sections.findIndex((s) => s.id === selectedSectionId)
  );
  const current = song.sections[currentIdx];

  const swipeHandlers = useHorizontalSwipe(
    () => {
      if (currentIdx < song.sections.length - 1) {
        onSelectSection(song.sections[currentIdx + 1].id);
      }
    },
    () => {
      if (currentIdx > 0) {
        onSelectSection(song.sections[currentIdx - 1].id);
      }
    }
  );

  if (!current) return null;

  const paletteChords = getChordPalette(song.key, song.scale, paletteMode);
  const { totalBars, formattedDuration } = getSongDurationSummary(song);

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

  const handleDragStart = (idx: number, e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragIndexRef.current = idx;
    setDraggingIdx(idx);
  };

  const handleDragMove = (e: PointerEvent<HTMLSpanElement>) => {
    const activeIdx = dragIndexRef.current;
    if (activeIdx === null || !listRef.current) return;

    const items = listRef.current.querySelectorAll<HTMLElement>(
      '[data-section-index]'
    );
    let targetIdx: number | null = null;
    for (const el of items) {
      const rect = el.getBoundingClientRect();
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        const parsed = Number(el.dataset.sectionIndex);
        if (Number.isInteger(parsed)) {
          targetIdx = parsed;
        }
        break;
      }
    }

    if (targetIdx !== null && targetIdx !== activeIdx) {
      onReorderSection(activeIdx, targetIdx);
      dragIndexRef.current = targetIdx;
      setDraggingIdx(targetIdx);
    }
  };

  const handleDragEnd = (e: PointerEvent<HTMLSpanElement>) => {
    if (dragIndexRef.current === null) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragIndexRef.current = null;
    setDraggingIdx(null);
  };

  return (
    <div className="tab-content">
      <div className="arrange-top-bar">
        <span className="badge badge-info duration-badge">
          合計: {totalBars}小節 / 約 {formattedDuration}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!canUndo}
          onClick={onUndo}
        >
          ↩ 元に戻す (Undo)
        </button>
      </div>

      <section className="panel preset-panel">
        <div className="preset-label">構成プリセット（ワンタップ切替）</div>
        <div className="preset-btn-list">
          {ARRANGEMENT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn btn-secondary preset-btn"
              onClick={() => onApplyArrangementPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <div ref={listRef} className="section-pills">
        {song.sections.map((sec, idx) => (
          <div
            key={sec.id}
            data-section-index={idx}
            className={`pill-item ${sec.id === current.id ? 'active' : ''} ${
              draggingIdx === idx ? 'is-dragging' : ''
            }`}
          >
            <span
              className="drag-handle"
              role="button"
              tabIndex={0}
              aria-label={`${sec.name} をドラッグして並び替え`}
              onPointerDown={(e) => handleDragStart(idx, e)}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
            >
              ≡
            </span>
            <button
              type="button"
              className={`pill-select-btn ${sec.id === current.id ? 'active' : ''}`}
              onClick={() => onSelectSection(sec.id)}
            >
              {idx + 1}. {sec.name} ({sec.bars}小節)
            </button>
          </div>
        ))}
      </div>

      <div className="section-action-bar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onSelectSection(onAddSection())}
        >
          ＋ 追加
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onSelectSection(onDuplicateSection(current.id))}
        >
          ⧉ 複製
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={song.sections.length <= 1}
          onClick={() => onRemoveSection(current.id)}
        >
          🗑 削除
        </button>
      </div>

      <div className="section-meta-bar">
        <div className="section-meta-info">
          <span className="badge badge-info page-indicator">
            {currentIdx + 1} / {song.sections.length}
          </span>
          <span>
            <strong>{current.name}</strong> ({current.bars}小節)
          </span>
        </div>
        <button
          type="button"
          className={`btn section-preview-btn ${
            isPreviewingSection ? 'btn-danger is-playing' : 'btn-accent'
          }`}
          onClick={() => onPreviewSection(current.id)}
        >
          {isPreviewingSection ? '⏹ 試聴停止' : '▶ このセクション試聴'}
        </button>
      </div>

      <div className="arrange-cards" {...swipeHandlers}>
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
              <div className="field">
                <span>小節数 ({current.bars})</span>
                <div className="bars-stepper">
                  <button
                    type="button"
                    className="btn btn-secondary bars-step-btn"
                    disabled={current.bars <= 1}
                    aria-label="小節数を1減らす"
                    onClick={() =>
                      onChangeSectionBars(
                        current.id,
                        Math.max(1, current.bars - 1)
                      )
                    }
                  >
                    -1
                  </button>
                  <input
                    type="number"
                    className="bars-step-input"
                    min={1}
                    max={32}
                    value={current.bars}
                    aria-label="小節数"
                    onChange={(e) =>
                      onChangeSectionBars(
                        current.id,
                        Number(e.target.value) || 1
                      )
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-secondary bars-step-btn"
                    disabled={current.bars >= 32}
                    aria-label="小節数を1増やす"
                    onClick={() =>
                      onChangeSectionBars(
                        current.id,
                        Math.min(32, current.bars + 1)
                      )
                    }
                  >
                    +1
                  </button>
                </div>
              </div>

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
          <div className="chip-list palette-mode-tabs" role="group" aria-label="パレット表示モード">
            {PALETTE_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`chip-btn ${paletteMode === m.id ? 'chip-active' : ''}`}
                onClick={() => setPaletteMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="chip-list">
            {paletteChords.map((ch) => (
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

          <div className="palette-label">
            末尾コードのクオリティ変換
            {current.chords.length > 0
              ? `（対象: ${current.chords[current.chords.length - 1]}）:`
              : '（コード未入力）:'}
          </div>
          <div className="chip-list">
            {SUFFIX_CONVERTERS.map((suf) => (
              <button
                key={suf}
                type="button"
                className="chip-btn chip-suffix"
                disabled={current.chords.length === 0}
                onClick={() => {
                  if (current.chords.length === 0) return;
                  const updated = [...current.chords];
                  const lastIdx = updated.length - 1;
                  updated[lastIdx] = applySuffixToChord(updated[lastIdx], suf);
                  onUpdateSectionProps(current.id, { chords: updated }, true);
                }}
              >
                {suf}
              </button>
            ))}
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
    </div>
  );
}
