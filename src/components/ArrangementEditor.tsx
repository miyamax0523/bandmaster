import { useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import {
  getSongDurationSummary,
  type ArrangementPresetId,
} from '../lib/bandState';
import {
  describeChordRhythm,
  resolveEffectiveTimeline,
} from '../lib/chordTimeline';
import { extractDrumLoopFromMidi } from '../lib/midiParser';
import { isSectionPartEnabled } from '../lib/noteSelector';
import { useHorizontalSwipe } from '../lib/touchSwipe';
import type {
  DrumLoopData,
  EnergyLevel,
  InstrumentType,
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
  onToggleSectionPart: (id: string, inst: InstrumentType) => void;
  onToggleRiff808Octave: (id: string, val?: boolean) => void;
  onClearRiff: (id: string) => void;
  onOpenRiffModal: (sectionId: string) => void;
  onOpenVocalModal: (sectionId: string) => void;
  onClearVocalMelody: (id: string) => void;
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
  { id: 'full_2min30', label: '標準フル（約2分半・2B省略・84小節）' },
  { id: 'chorus_start', label: 'サビ始まり疾走（約2分半・88小節）' },
  { id: 'full_two_chorus', label: '王道2コーラス完備（約2分45秒・92小節）' },
  { id: 'one_half', label: 'ワンハーフ凝縮（約1分30秒・56小節）' },
  { id: 'ballad_60', label: 'バラード専用フル（約2分半・60小節）' },
];

const SECTION_PART_CHIPS: Array<{
  key: InstrumentType;
  label: string;
  icon: string;
}> = [
  { key: 'drums', label: 'Drums', icon: '🥁' },
  { key: 'bass', label: 'Bass', icon: '🎸' },
  { key: 'keyboard', label: 'Key', icon: '🎹' },
  { key: 'pad', label: 'Pad', icon: '🌊' },
  { key: 'vocal', label: 'Vocal', icon: '🎤' },
];

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
  onToggleSectionPart,
  onToggleRiff808Octave,
  onClearRiff,
  onOpenRiffModal,
  onOpenVocalModal,
  onClearVocalMelody,
}: ArrangementEditorProps) {
  const [midiError, setMidiError] = useState<string | null>(null);
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

      <div className="section-chords-overview" aria-label="セクション別コード概要（表示のみ・編集はCONSOLEタブ）">
        {song.sections.map((sec, idx) => {
          const slots = resolveEffectiveTimeline(
            sec.chords,
            sec.bars,
            song.key,
            song.scale
          );
          const totalBeats = Math.max(4, sec.bars * 4);
          const rhythm = describeChordRhythm(slots, sec.bars);
          return (
            <div
              key={sec.id}
              className={`section-overview-row ${sec.id === current.id ? 'active' : ''}`}
            >
              <div className="overview-top-line">
                <span className="overview-name">
                  {idx + 1}. {sec.name} ({sec.bars}小節)
                </span>
                <span className={`overview-rhythm-tag mode-${rhythm.modeId}`}>
                  {rhythm.badgeIcon} {rhythm.label}
                </span>
              </div>
              <div className="overview-badges" aria-label={`${sec.name}のコード進行バッジ`}>
                {slots.map((slot) => {
                  const isAnt = Boolean(slot.anticipated || slot.startBeat % 1 !== 0);
                  return (
                    <span
                      key={slot.id}
                      className={`chord-slot-badge ${isAnt ? 'is-anticipated' : ''}`}
                    >
                      {isAnt ? '⚡' : ''}
                      {slot.chord}
                    </span>
                  );
                })}
              </div>
              <div
                className="overview-mini-bar"
                aria-label={`${sec.name}の譜割りタイムライン`}
                style={{
                  backgroundSize: `${100 / Math.max(1, sec.bars)}% 100%`,
                }}
              >
                {slots.map((slot) => {
                  const isAnt = Boolean(slot.anticipated || slot.startBeat % 1 !== 0);
                  const pct = (slot.durationBeats / totalBeats) * 100;
                  return (
                    <span
                      key={`bar-${slot.id}`}
                      className={`mini-rhythm-seg ${isAnt ? 'is-anticipated' : ''}`}
                      style={{ width: `${pct}%` }}
                      title={`${slot.chord} (${slot.durationBeats}拍)`}
                    >
                      {isAnt ? '⚡' : ''}
                      {slot.chord}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
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

            <div className="field">
              <span>参加パート（セクション別 ON/OFF）</span>
              <div
                className="section-part-chips"
                role="group"
                aria-label="セクション別パートON/OFF"
              >
                {SECTION_PART_CHIPS.map(({ key, label, icon }) => {
                  const globalOn = song.members[key]?.enabled ?? true;
                  const partOn = isSectionPartEnabled(current, key);
                  const effectiveOn = globalOn && partOn;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`section-part-chip ${
                        effectiveOn ? 'active' : 'muted'
                      }`}
                      aria-pressed={partOn}
                      disabled={!globalOn}
                      onClick={() => onToggleSectionPart(current.id, key)}
                      title={
                        !globalOn
                          ? 'MEMBERSタブで不参加(OFF)設定中'
                          : `${label} をこのセクションで${partOn ? 'ミュート' : '鳴らす'}`
                      }
                    >
                      {icon} {label}
                    </button>
                  );
                })}
              </div>
            </div>
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

          <div className="riff-box">
            <div className="toolbar-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onOpenVocalModal(current.id)}
              >
                🎤 Vocal 鼻歌録音 / 編集
              </button>
              {current.vocalMelody && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => onClearVocalMelody(current.id)}
                >
                  Vocal 解除
                </button>
              )}
            </div>

            {current.vocalMelody && (
              <p className="info-box">
                設定済み Vocal: <strong>{current.vocalMelody.sourceLabel}</strong> (
                {current.vocalMelody.bars ?? 2}小節 / {current.vocalMelody.notes.length}音)
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
