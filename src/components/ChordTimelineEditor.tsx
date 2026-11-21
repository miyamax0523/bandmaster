import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  getDiatonicPaletteChords,
  getSubstituteChordPalette,
  type PaletteModifier,
  type PaletteTab,
} from '../lib/chordPalette';
import {
  applyChordRhythmGroove,
  describeChordRhythm,
  formatSlotPositionLabel,
  insertChordAfter,
  mergeChordWithPrev,
  removeChordSlot,
  resolveEffectiveTimeline,
  setChordBoundaryBeat,
  shiftChordBoundary,
  splitChordSlot,
  swapChordOrder,
  updateChordName,
  type ChordRhythmGrooveMode,
} from '../lib/chordTimeline';
import type {
  ChordSlot,
  DrumAnticipationMode,
  Section,
  SongConfig,
} from '../types/song';

const MODIFIERS: Array<{ id: PaletteModifier; label: string }> = [
  { id: 'triad', label: '基本' },
  { id: 'seventh', label: '7th' },
  { id: 'sus4', label: 'sus4' },
  { id: 'add9', label: 'add9' },
  { id: 'dim', label: 'dim' },
];

const QUICK_GROOVES: Array<{
  id: Exclude<ChordRhythmGrooveMode, 'random'>;
  label: string;
}> = [
  { id: 'even', label: '📏 均等' },
  { id: 'anticipate_4th', label: '⚡ 4拍裏食い' },
  { id: 'half_bar_drive', label: '🚀 2拍疾走' },
  { id: 'stretch_and_push', label: '🌊 溜め&食い' },
  { id: 'syncopated_mix', label: '🎛 シンコペ' },
];

interface DragBoundaryState {
  boundaryIdx: number;
  startClientX: number;
  initialStartBeat: number;
  pxPerBeat: number;
  baseSlots: ChordSlot[];
}

interface ChordTimelineEditorProps {
  song: SongConfig;
  section: Section;
  onChangeSlots: (sectionId: string, slots: ChordSlot[]) => void;
  onChangeDrumAnticipationMode: (
    sectionId: string,
    mode: DrumAnticipationMode
  ) => void;
  onCopyTimelineToAllSections: (sourceSectionId: string) => void;
}

export function ChordTimelineEditor({
  song,
  section,
  onChangeSlots,
  onChangeDrumAnticipationMode,
  onCopyTimelineToAllSections,
}: ChordTimelineEditorProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [modifier, setModifier] = useState<PaletteModifier>('triad');
  const [paletteTab, setPaletteTab] = useState<PaletteTab>('diatonic');
  const [dragPreviewSlots, setDragPreviewSlots] = useState<ChordSlot[] | null>(
    null
  );
  const dragRef = useRef<DragBoundaryState | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const committedSlots = resolveEffectiveTimeline(
    section.chords,
    section.bars,
    song.key,
    song.scale
  );
  const slots = dragPreviewSlots ?? committedSlots;
  const safeIdx = Math.max(0, Math.min(slots.length - 1, selectedIdx));
  const selectedSlot = slots[safeIdx];
  const totalBeats = Math.max(4, section.bars * 4);
  const rhythmDiag = describeChordRhythm(slots, section.bars);
  const drumMode: DrumAnticipationMode = section.drumAnticipationMode ?? 'sync';

  const canShiftBack =
    safeIdx >= 1 && slots[safeIdx - 1].durationBeats - 0.5 >= 0.5;
  const canShiftFwd =
    safeIdx >= 1 && selectedSlot.durationBeats - 0.5 >= 0.5;
  const canSplit = Boolean(selectedSlot && selectedSlot.durationBeats >= 1.0);
  const canMerge = safeIdx >= 1;
  const canRemove = slots.length > 1;
  const canInsert = slots.some((s) => s.durationBeats >= 1.0);
  const canSwapPrev = safeIdx >= 1;
  const canSwapNext = safeIdx < slots.length - 1;

  const paletteOptions = getDiatonicPaletteChords(song.key, song.scale, modifier);
  const substituteOptions = getSubstituteChordPalette(song.key, song.scale);

  const commitSlots = (next: ChordSlot[], nextSelectedIdx = safeIdx) => {
    setDragPreviewSlots(null);
    setSelectedIdx(Math.max(0, Math.min(next.length - 1, nextSelectedIdx)));
    onChangeSlots(section.id, next);
  };

  const handleBoundaryPointerDown = (
    e: ReactPointerEvent<HTMLSpanElement>,
    slotIdx: number
  ) => {
    const boundaryIdx = slotIdx + 1;
    if (boundaryIdx >= committedSlots.length) return;
    e.stopPropagation();
    e.preventDefault();

    const trackWidth = trackRef.current?.getBoundingClientRect().width ?? 320;
    const pxPerBeat = Math.max(8, trackWidth / totalBeats);
    dragRef.current = {
      boundaryIdx,
      startClientX: e.clientX,
      initialStartBeat: committedSlots[boundaryIdx].startBeat,
      pxPerBeat,
      baseSlots: committedSlots,
    };
    setSelectedIdx(boundaryIdx);
    setDragPreviewSlots(committedSlots);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleBoundaryPointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();
    const deltaBeats = (e.clientX - drag.startClientX) / drag.pxPerBeat;
    const targetBeat = Math.round((drag.initialStartBeat + deltaBeats) * 2) / 2;
    const preview = setChordBoundaryBeat(
      drag.baseSlots,
      drag.boundaryIdx,
      targetBeat
    );
    setDragPreviewSlots(preview);
  };

  const finishBoundaryDrag = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();
    const deltaBeats = (e.clientX - drag.startClientX) / drag.pxPerBeat;
    const targetBeat = Math.round((drag.initialStartBeat + deltaBeats) * 2) / 2;
    const finalSlots = setChordBoundaryBeat(
      drag.baseSlots,
      drag.boundaryIdx,
      targetBeat
    );
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const changed =
      finalSlots[drag.boundaryIdx]?.startBeat !== drag.initialStartBeat;
    setDragPreviewSlots(null);
    if (changed) {
      commitSlots(finalSlots, drag.boundaryIdx);
    }
  };

  return (
    <section
      className="panel chord-timeline-panel"
      aria-label="コード進行タイムライン"
    >
      <div className="timeline-header-row">
        <div className="timeline-header-left">
          <div className="timeline-title">
            🎹 タイムライン{' '}
            <span>
              ({section.name} · {section.bars}小節)
            </span>
          </div>
          <span
            className={`timeline-diag-badge mode-${rhythmDiag.modeId}`}
            title="現在のコード譜割り診断"
          >
            {rhythmDiag.badgeIcon} {rhythmDiag.label}
          </span>
        </div>
        <div className="timeline-header-actions">
          <button
            type="button"
            className="btn btn-secondary timeline-groove-random-btn"
            onClick={() =>
              commitSlots(applyChordRhythmGroove(slots, section.bars, 'random'), 0)
            }
            title="コード名はそのまま切り替わりタイミングを自動提案"
          >
            🎲 譜割りお任せ
          </button>
          <button
            type="button"
            className="btn btn-secondary timeline-copy-all-btn"
            onClick={() => onCopyTimelineToAllSections(section.id)}
            title="このタイムラインを全セクションへ複製"
          >
            📋 全コピー
          </button>
        </div>
      </div>

      <div className="timeline-groove-drum-bar">
        <div
          className="timeline-groove-chips"
          role="group"
          aria-label="譜割りクイックパターン"
        >
          {QUICK_GROOVES.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`chip-btn timeline-groove-chip ${
                rhythmDiag.modeId === g.id ? 'chip-active' : ''
              }`}
              onClick={() =>
                commitSlots(applyChordRhythmGroove(slots, section.bars, g.id), 0)
              }
            >
              {g.label}
            </button>
          ))}
        </div>

        <div
          className="timeline-drum-sync-row"
          role="group"
          aria-label="裏拍ドラム挙動"
        >
          <span className="timeline-drum-sync-label">裏拍ドラム:</span>
          <div className="timeline-drum-sync-switch">
            <button
              type="button"
              className={`chip-btn timeline-sync-opt ${
                drumMode === 'sync' ? 'chip-active' : ''
              }`}
              onClick={() => onChangeDrumAnticipationMode(section.id, 'sync')}
              title="裏拍コードチェンジに合わせてキック＋クラッシュでキメ連動"
            >
              ⚡ キメ連動
            </button>
            <button
              type="button"
              className={`chip-btn timeline-sync-opt ${
                drumMode === 'keep' ? 'chip-active' : ''
              }`}
              onClick={() => onChangeDrumAnticipationMode(section.id, 'keep')}
              title="裏拍コードでもドラムは元のビートを維持してわざとズラす"
            >
              🥁 キープ(ズラし)
            </button>
          </div>
        </div>
      </div>

      <div className="timeline-scroll-wrap">
        <div
          className="timeline-canvas"
          style={{ minWidth: `max(100%, ${section.bars * 108}px)` }}
        >
          <div className="timeline-ruler">
            {Array.from({ length: section.bars }, (_, barIdx) => (
              <div key={barIdx} className="timeline-bar-tick">
                <span className="timeline-bar-num">{barIdx + 1}小節</span>
                <div className="timeline-beat-grid" aria-hidden="true">
                  {[1, 2, 3, 4].map((beatNum) => (
                    <div key={beatNum} className="timeline-beat-cell">
                      <span>{beatNum}</span>
                      <div className="timeline-beat-subdots">
                        <span className="hb-dot downbeat" />
                        <span className="hb-dot offbeat" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div
            ref={trackRef}
            className="timeline-blocks-track"
            role="listbox"
            aria-label="コードブロック一覧"
            style={{
              backgroundSize: `${100 / Math.max(1, totalBeats)}% 100%`,
            }}
          >
            {slots.map((slot, idx) => {
              const widthPct = (slot.durationBeats / totalBeats) * 100;
              const isSelected = idx === safeIdx;
              const isAnt = Boolean(slot.anticipated || slot.startBeat % 1 !== 0);
              const hasRightBoundary = idx < slots.length - 1;
              return (
                <div
                  key={slot.id}
                  role="option"
                  tabIndex={0}
                  aria-selected={isSelected}
                  className={`timeline-block ${isSelected ? 'is-selected' : ''} ${
                    isAnt ? 'is-anticipated' : ''
                  }`}
                  style={{ width: `${widthPct}%` }}
                  onClick={() => setSelectedIdx(idx)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      setSelectedIdx(idx);
                    }
                  }}
                >
                  <span className="timeline-block-name">
                    {isAnt ? '⚡' : ''}
                    {slot.chord}
                  </span>
                  <span className="timeline-block-dur">{slot.durationBeats}拍</span>
                  {hasRightBoundary && (
                    <span
                      role="slider"
                      aria-label={`${slot.chord}の右端境界をスライド`}
                      aria-valuemin={0.5}
                      aria-valuemax={totalBeats - 0.5}
                      aria-valuenow={slot.startBeat + slot.durationBeats}
                      className="timeline-boundary-handle"
                      onPointerDown={(ev) => handleBoundaryPointerDown(ev, idx)}
                      onPointerMove={handleBoundaryPointerMove}
                      onPointerUp={finishBoundaryDrag}
                      onPointerCancel={finishBoundaryDrag}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      ⋮
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedSlot && (
        <div className="timeline-selected-status">
          選択中:{' '}
          <strong>
            {selectedSlot.anticipated ? '⚡' : ''}
            {selectedSlot.chord}
          </strong>
          （{formatSlotPositionLabel(selectedSlot)}）
        </div>
      )}

      <div className="timeline-action-grid">
        <button
          type="button"
          className="btn btn-secondary timeline-action-btn"
          disabled={!canShiftBack}
          onClick={() => commitSlots(shiftChordBoundary(slots, safeIdx, -0.5))}
        >
          ◀ 半拍前へ
        </button>
        <button
          type="button"
          className="btn btn-secondary timeline-action-btn"
          disabled={!canShiftFwd}
          onClick={() => commitSlots(shiftChordBoundary(slots, safeIdx, 0.5))}
        >
          半拍後ろへ ▶
        </button>
        <button
          type="button"
          className="btn btn-secondary timeline-action-btn"
          disabled={!canInsert}
          onClick={() =>
            commitSlots(
              insertChordAfter(slots, safeIdx, paletteOptions[0]),
              safeIdx + 1
            )
          }
        >
          ＋ 追加
        </button>
        <button
          type="button"
          className="btn btn-secondary timeline-action-btn"
          disabled={!canRemove}
          onClick={() =>
            commitSlots(
              removeChordSlot(slots, safeIdx),
              Math.max(0, safeIdx - 1)
            )
          }
        >
          🗑 削除
        </button>
        <button
          type="button"
          className="btn btn-secondary timeline-action-btn"
          disabled={!canSplit}
          onClick={() => commitSlots(splitChordSlot(slots, safeIdx), safeIdx)}
        >
          ✂ 分割
        </button>
        <button
          type="button"
          className="btn btn-secondary timeline-action-btn"
          disabled={!canMerge}
          onClick={() => commitSlots(mergeChordWithPrev(slots, safeIdx), safeIdx - 1)}
        >
          🔗 結合
        </button>
        <button
          type="button"
          className="btn btn-secondary timeline-action-btn"
          disabled={!canSwapPrev}
          onClick={() =>
            commitSlots(swapChordOrder(slots, safeIdx, -1), safeIdx - 1)
          }
        >
          ◀ 順入替
        </button>
        <button
          type="button"
          className="btn btn-secondary timeline-action-btn"
          disabled={!canSwapNext}
          onClick={() =>
            commitSlots(swapChordOrder(slots, safeIdx, 1), safeIdx + 1)
          }
        >
          順入替 ▶
        </button>
      </div>

      <div className="timeline-palette-wrap">
        <div className="timeline-palette-header">
          <div className="timeline-palette-tabs" role="tablist" aria-label="コードパレット種別">
            <button
              type="button"
              role="tab"
              aria-selected={paletteTab === 'diatonic'}
              className={`chip-btn timeline-tab-btn ${
                paletteTab === 'diatonic' ? 'chip-active' : ''
              }`}
              onClick={() => setPaletteTab('diatonic')}
            >
              ダイアトニック
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={paletteTab === 'substitute'}
              className={`chip-btn timeline-tab-btn ${
                paletteTab === 'substitute' ? 'chip-active' : ''
              }`}
              onClick={() => setPaletteTab('substitute')}
            >
              代理・dim
            </button>
          </div>

          {paletteTab === 'diatonic' && (
            <div className="timeline-mod-row" role="group" aria-label="コード修飾">
              {MODIFIERS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`chip-btn timeline-mod-btn ${
                    modifier === m.id ? 'chip-active' : ''
                  }`}
                  onClick={() => setModifier(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {paletteTab === 'diatonic' ? (
          <div className="timeline-chord-chips" role="group" aria-label="ダイアトニック・パレット">
            {paletteOptions.map((chordName) => (
              <button
                key={chordName}
                type="button"
                className={`chip-btn timeline-chord-btn ${
                  selectedSlot?.chord === chordName ? 'chip-active' : ''
                }`}
                onClick={() => commitSlots(updateChordName(slots, safeIdx, chordName))}
              >
                {chordName}
              </button>
            ))}
          </div>
        ) : (
          <div className="timeline-chord-chips" role="group" aria-label="代理コード・パッシングdimパレット">
            {substituteOptions.map((item) => (
              <button
                key={`${item.degreeLabel}-${item.chord}`}
                type="button"
                className={`chip-btn timeline-chord-btn timeline-sub-btn ${
                  selectedSlot?.chord === item.chord ? 'chip-active' : ''
                }`}
                onClick={() => commitSlots(updateChordName(slots, safeIdx, item.chord))}
                title={`${item.degreeLabel}: ${item.chord} (${item.roleTag})`}
              >
                <span className="sub-chord-main">{item.chord}</span>
                <span className="sub-chord-role">{item.roleTag}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
