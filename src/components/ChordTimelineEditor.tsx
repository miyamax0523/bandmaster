import { useState } from 'react';
import {
  applyChordRhythmGroove,
  describeChordRhythm,
  formatSlotPositionLabel,
  mergeChordWithPrev,
  resolveEffectiveTimeline,
  shiftChordBoundary,
  splitChordSlot,
  updateChordName,
  type ChordRhythmGrooveMode,
} from '../lib/chordTimeline';
import {
  applySuffixToChord,
  getChordPalette,
  getDiatonicChords,
} from '../lib/chordUtils';
import type { ChordSlot, Section, SongConfig } from '../types/song';

type PaletteModifier = 'triad' | 'seventh' | 'sus4' | 'add9';

const MODIFIERS: Array<{ id: PaletteModifier; label: string }> = [
  { id: 'triad', label: '基本' },
  { id: 'seventh', label: '7th' },
  { id: 'sus4', label: 'sus4' },
  { id: 'add9', label: 'add9' },
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

interface ChordTimelineEditorProps {
  song: SongConfig;
  section: Section;
  onChangeSlots: (sectionId: string, slots: ChordSlot[]) => void;
  onCopyTimelineToAllSections: (sourceSectionId: string) => void;
}

export function ChordTimelineEditor({
  song,
  section,
  onChangeSlots,
  onCopyTimelineToAllSections,
}: ChordTimelineEditorProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [modifier, setModifier] = useState<PaletteModifier>('triad');

  const slots = resolveEffectiveTimeline(
    section.chords,
    section.bars,
    song.key,
    song.scale
  );
  const safeIdx = Math.max(0, Math.min(slots.length - 1, selectedIdx));
  const selectedSlot = slots[safeIdx];
  const totalBeats = Math.max(4, section.bars * 4);
  const rhythmDiag = describeChordRhythm(slots, section.bars);

  const canShiftBack =
    safeIdx >= 1 && slots[safeIdx - 1].durationBeats - 0.5 >= 0.5;
  const canShiftFwd =
    safeIdx >= 1 && selectedSlot.durationBeats - 0.5 >= 0.5;
  const canSplit = Boolean(selectedSlot && selectedSlot.durationBeats >= 1.0);
  const canMerge = safeIdx >= 1;

  const baseDiatonic = getDiatonicChords(song.key, song.scale);
  const seventhDiatonic = getChordPalette(song.key, song.scale, 'seventh');
  const paletteOptions =
    modifier === 'triad'
      ? baseDiatonic
      : modifier === 'seventh'
        ? seventhDiatonic.slice(0, 7)
        : baseDiatonic.map((ch) => applySuffixToChord(ch, modifier));

  const commitSlots = (next: ChordSlot[], nextSelectedIdx = safeIdx) => {
    setSelectedIdx(Math.max(0, Math.min(next.length - 1, nextSelectedIdx)));
    onChangeSlots(section.id, next);
  };

  return (
    <section className="panel chord-timeline-panel" aria-label="コード進行タイムライン">
      <div className="timeline-header-row">
        <div className="timeline-header-left">
          <div className="timeline-title">
            🎹 タイムライン <span>({section.name} · {section.bars}小節)</span>
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
            onClick={() => commitSlots(applyChordRhythmGroove(slots, section.bars, 'random'), 0)}
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

      <div className="timeline-groove-chips" role="group" aria-label="譜割りクイックパターン">
        {QUICK_GROOVES.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`chip-btn timeline-groove-chip ${
              rhythmDiag.modeId === g.id ? 'chip-active' : ''
            }`}
            onClick={() => commitSlots(applyChordRhythmGroove(slots, section.bars, g.id), 0)}
          >
            {g.label}
          </button>
        ))}
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
              return (
                <button
                  key={slot.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`timeline-block ${isSelected ? 'is-selected' : ''} ${
                    isAnt ? 'is-anticipated' : ''
                  }`}
                  style={{ width: `${widthPct}%` }}
                  onClick={() => setSelectedIdx(idx)}
                >
                  <span className="timeline-block-name">
                    {isAnt ? '⚡' : ''}
                    {slot.chord}
                  </span>
                  <span className="timeline-block-dur">{slot.durationBeats}拍</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selectedSlot && (
        <div className="timeline-selected-status">
          選択中: <strong>{selectedSlot.anticipated ? '⚡' : ''}{selectedSlot.chord}</strong>（
          {formatSlotPositionLabel(selectedSlot)}）
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
      </div>

      <div className="timeline-palette-wrap">
        <div className="timeline-mod-row" role="group" aria-label="コード修飾">
          {MODIFIERS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip-btn timeline-mod-btn ${modifier === m.id ? 'chip-active' : ''}`}
              onClick={() => setModifier(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
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
      </div>
    </section>
  );
}
