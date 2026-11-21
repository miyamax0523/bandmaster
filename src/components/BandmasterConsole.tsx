import { useState, type ChangeEvent } from 'react';
import { isCellOutdated, isDrumLockedUnsynced } from '../lib/bandState';
import { extractDrumLoopFromMidi } from '../lib/midiParser';
import { isAutoTacet, isSectionPartEnabled } from '../lib/noteSelector';
import { PATTERN_PRESET_GROUPS } from '../lib/patternPresets';
import { useHorizontalSwipe } from '../lib/touchSwipe';
import type {
  ChordSlot,
  CopiedPartPhrase,
  DensityLevel,
  DrumLoopData,
  InstrumentType,
  KeyboardDensityLevel,
  SongConfig,
  TakeStyle,
  VocalHarmonyMode,
} from '../types/song';
import type { BandState } from '../types/track';
import { ChordTimelineEditor } from './ChordTimelineEditor';
import { MidiExportButton } from './MidiExportButton';
import { TakeSelector } from './TakeSelector';

interface BandmasterConsoleProps {
  song: SongConfig;
  bandState: BandState;
  selectedSectionId: string;
  isPreviewingSection: boolean;
  canUndo: boolean;
  onSelectSection: (id: string) => void;
  onPreviewSection: (sectionId: string) => void;
  onChangeSectionDrumLoop: (sectionId: string, loop?: DrumLoopData) => void;
  onClearSectionDrumLoop: (sectionId: string) => void;
  onChangeSectionDrumDensity: (
    sectionId: string,
    patch: { hatDensity?: DensityLevel; kickDensity?: DensityLevel }
  ) => void;
  onChangeSectionKeyboardDensity: (
    sectionId: string,
    keyboardDensity: KeyboardDensityLevel
  ) => void;
  onChangeSectionVocalDensity: (
    sectionId: string,
    vocalDensity: DensityLevel
  ) => void;
  onChangeSectionVocalHarmony: (
    sectionId: string,
    mode: VocalHarmonyMode
  ) => void;
  copiedPhrase: CopiedPartPhrase | null;
  onCopyPartPhrase: (phrase: CopiedPartPhrase) => void;
  onPastePartPhrase: (targetSectionId: string, phrase: CopiedPartPhrase) => void;
  onChangeSectionPatternPreset: (
    sectionId: string,
    inst: InstrumentType,
    preset: string
  ) => void;
  onChangeSectionChordTimeline: (sectionId: string, slots: ChordSlot[]) => void;
  onCopyTimelineToAllSections: (sourceSectionId: string) => void;
  onToggleSectionPart: (sectionId: string, inst: InstrumentType) => void;
  onOpenVocalModal: (sectionId: string) => void;
  onClearSectionVocalMelody: (sectionId: string) => void;
  onRegenerateAll: () => void;
  onUndo: () => void;
  onRegenerateCell: (sectionId: string, inst: InstrumentType) => void;
  onSelectTake: (
    sectionId: string,
    inst: InstrumentType,
    take: TakeStyle | 'OFF'
  ) => void;
  onToggleLock: (sectionId: string, inst: InstrumentType) => void;
}

const INSTRUMENTS: Array<{ key: InstrumentType; label: string; icon: string }> = [
  { key: 'drums', label: 'Drums', icon: '🥁' },
  { key: 'bass', label: 'Bass', icon: '🎸' },
  { key: 'keyboard', label: 'Keyboard', icon: '🎹' },
  { key: 'pad', label: 'PAD', icon: '🌊' },
  { key: 'vocal', label: 'Vocal', icon: '🎤' },
];

const DENSITY_LEVELS: readonly DensityLevel[] = [1, 2, 3, 4, 5];
const KEYBOARD_DENSITY_LEVELS: readonly KeyboardDensityLevel[] = [
  1, 2, 3, 4, 5, 6, 7,
];
const VOCAL_HARMONY_OPTIONS: Array<{ value: VocalHarmonyMode; label: string }> = [
  { value: 'off', label: 'OFF' },
  { value: 'upper_3rd', label: '3度上' },
  { value: 'lower_3rd', label: '3度下' },
  { value: 'upper_5th', label: '5度上' },
  { value: 'octave_up', label: 'Oct上' },
  { value: 'octave_down', label: 'Oct下' },
];

export function BandmasterConsole({
  song,
  bandState,
  selectedSectionId,
  isPreviewingSection,
  canUndo,
  onSelectSection,
  onPreviewSection,
  onChangeSectionDrumLoop,
  onClearSectionDrumLoop,
  onChangeSectionDrumDensity,
  onChangeSectionKeyboardDensity,
  onChangeSectionVocalDensity,
  onChangeSectionVocalHarmony,
  copiedPhrase,
  onCopyPartPhrase,
  onPastePartPhrase,
  onChangeSectionPatternPreset,
  onChangeSectionChordTimeline,
  onCopyTimelineToAllSections,
  onToggleSectionPart,
  onOpenVocalModal,
  onClearSectionVocalMelody,
  onRegenerateAll,
  onUndo,
  onRegenerateCell,
  onSelectTake,
  onToggleLock,
}: BandmasterConsoleProps) {
  const [midiError, setMidiError] = useState<string | null>(null);
  const currentIdx = Math.max(
    0,
    song.sections.findIndex((s) => s.id === selectedSectionId)
  );
  const section = song.sections[currentIdx];

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

  if (!section) return null;

  const handleSectionDrumUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setMidiError(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { drumLoop } = extractDrumLoopFromMidi(bytes, file.name);
      onChangeSectionDrumLoop(section.id, drumLoop);
    } catch (err) {
      setMidiError(err instanceof Error ? err.message : 'MIDI読込失敗');
    }
  };

  const cells = bandState.cellsBySection[section.id];
  const drumSourceLabel = section.uploadedDrumLoop
    ? `セクションMIDI: ${section.uploadedDrumLoop.fileName}`
    : song.uploadedDrumLoop
      ? `全体MIDI: ${song.uploadedDrumLoop.fileName}`
      : '内蔵生成エンジン';

  return (
    <div className="tab-content">
      <div className="toolbar-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onRegenerateAll}
        >
          🎲 全体再生成
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!canUndo}
          onClick={onUndo}
        >
          ↩ 元に戻す
        </button>
        <MidiExportButton song={song} bandState={bandState} />
      </div>

      <div className="section-pills" role="tablist" aria-label="Sections">
        {song.sections.map((sec, idx) => (
          <button
            key={sec.id}
            type="button"
            className={`pill ${sec.id === section.id ? 'active' : ''}`}
            onClick={() => onSelectSection(sec.id)}
          >
            {idx + 1}. {sec.name}{' '}
            <span className="pill-sub">
              {sec.kickMode === '808' ? '808' : '生'}
            </span>
          </button>
        ))}
      </div>

      <ChordTimelineEditor
        key={`tl-${section.id}`}
        song={song}
        section={section}
        onChangeSlots={onChangeSectionChordTimeline}
        onCopyTimelineToAllSections={onCopyTimelineToAllSections}
      />

      <div className="section-meta-bar">
        <div className="section-meta-info">
          <span className="badge badge-info page-indicator">
            {currentIdx + 1} / {song.sections.length}
          </span>
          <span>
            <strong>{section.name}</strong> [{section.type}] · {section.bars}小節 ·
            Energy: {section.energy} · Kick:{' '}
            {section.kickMode === '808' ? '🔊 808' : '🥁 生'}
          </span>
          {section.unisonRiff && (
            <span className="badge badge-accent">🎸 ユニゾンリフ適用中</span>
          )}
        </div>
        <button
          type="button"
          className={`btn section-preview-btn ${
            isPreviewingSection ? 'btn-danger is-playing' : 'btn-accent'
          }`}
          onClick={() => onPreviewSection(section.id)}
        >
          {isPreviewingSection ? '⏹ 試聴停止' : '▶ このセクション試聴'}
        </button>
      </div>

      <div key={section.id} className="console-cards" {...swipeHandlers}>
        {INSTRUMENTS.map(({ key, label, icon }) => {
          const member = song.members[key];
          const cell = cells?.[key];
          if (!member || !cell) return null;

          const sectionPreset =
            section.patternPresets?.[key] ??
            section.partPresets?.[key] ??
            member.patternPreset ??
            'auto';
          const sectionEnabled = isSectionPartEnabled(section, key);
          const effectivelyEnabled = member.enabled && sectionEnabled;
          const autoTacet = isAutoTacet(song, section, key);
          const outdated = !cell.locked && isCellOutdated(cell);
          const unsyncedDrum =
            key === 'drums' && isDrumLockedUnsynced(section, cells);
          const activeCount =
            cell.selectedTake === 'OFF' || !effectivelyEnabled || autoTacet
              ? 0
              : cell.takes[cell.selectedTake].length;

          return (
            <article
              key={key}
              className={`instrument-card ${!effectivelyEnabled ? 'is-disabled' : ''}`}
            >
              <div className="card-header">
                <div className="card-title-group">
                  <span className="card-icon">{icon}</span>
                  <div>
                    <h3>{label}</h3>
                    <span className="card-sub">
                      {!member.enabled
                        ? 'パート不参加 (OFF)'
                        : !sectionEnabled
                          ? 'このセクションOFF'
                          : `${activeCount} notes`}
                    </span>
                  </div>
                </div>

                <div className="card-actions">
                  <button
                    type="button"
                    className={`section-part-toggle ${sectionEnabled ? 'on' : 'off'}`}
                    aria-pressed={sectionEnabled}
                    disabled={!member.enabled}
                    onClick={() => onToggleSectionPart(section.id, key)}
                    title="このセクションで鳴らす ON/OFF"
                  >
                    {sectionEnabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    className={`btn-icon ${cell.locked ? 'locked-on' : ''}`}
                    onClick={() => onToggleLock(section.id, key)}
                    title={cell.locked ? 'ロック解除' : 'フレーズをロック'}
                  >
                    {cell.locked ? '🔒' : '🔓'}
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={cell.locked || !effectivelyEnabled}
                    onClick={() => onRegenerateCell(section.id, key)}
                    title="このセルのみ再生成"
                  >
                    🎲
                  </button>
                </div>
              </div>

              {key === 'drums' && (
                <>
                  <div className="source-line">ソース: {drumSourceLabel}</div>
                  <div className="drum-midi-actions">
                    <label className="btn btn-secondary drum-midi-btn">
                      🥁 ドラムMIDI読込
                      <input
                        type="file"
                        accept=".mid,.midi,audio/midi"
                        hidden
                        onChange={handleSectionDrumUpload}
                      />
                    </label>
                    {section.uploadedDrumLoop && (
                      <button
                        type="button"
                        className="btn btn-danger drum-midi-btn"
                        onClick={() => {
                          setMidiError(null);
                          onClearSectionDrumLoop(section.id);
                        }}
                      >
                        ✕ 解除
                      </button>
                    )}
                  </div>
                  {midiError && <p className="error-text">{midiError}</p>}
                </>
              )}

              {key === 'vocal' && (
                <>
                  <div className="source-line">
                    ソース:{' '}
                    {section.vocalMelody
                      ? `🎤 ${section.vocalMelody.sourceLabel} (${section.vocalMelody.notes.length}音)`
                      : '内蔵Vocal/ラップ生成'}
                  </div>
                  <div className="drum-midi-actions">
                    <button
                      type="button"
                      className="btn btn-secondary drum-midi-btn"
                      onClick={() => onOpenVocalModal(section.id)}
                    >
                      🎤 鼻歌録音 / 編集
                    </button>
                    {section.vocalMelody && (
                      <button
                        type="button"
                        className="btn btn-danger drum-midi-btn"
                        onClick={() => onClearSectionVocalMelody(section.id)}
                      >
                        ✕ 解除
                      </button>
                    )}
                  </div>
                </>
              )}

              <div className="badge-row">
                {outdated && (
                  <span className="badge badge-warn">旧版テイク (要再生成)</span>
                )}
                {unsyncedDrum && (
                  <span className="badge badge-warn">
                    ドラムロック中：キメ未同期
                  </span>
                )}
              </div>

              <div className="console-preset-row">
                <label className="console-preset-label">
                  <span>パターン</span>
                  <select
                    className="console-preset-select"
                    value={sectionPreset}
                    disabled={!effectivelyEnabled || cell.locked}
                    onChange={(e) =>
                      onChangeSectionPatternPreset(section.id, key, e.target.value)
                    }
                  >
                    {PATTERN_PRESET_GROUPS[key].map((grp) => (
                      <optgroup key={grp.category} label={grp.category}>
                        {grp.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              </div>

              <TakeSelector
                selectedTake={cell.selectedTake}
                locked={cell.locked}
                autoTacet={autoTacet}
                disabled={!effectivelyEnabled}
                onSelect={(take) => onSelectTake(section.id, key, take)}
              />

              {key === 'drums' && (
                <div className="density-controls">
                  <div className="density-row">
                    <span className="density-label">Hat 手数</span>
                    <div className="density-segments" role="group" aria-label="Hat 手数">
                      {DENSITY_LEVELS.map((lvl) => {
                        const active = (section.hatDensity ?? 3) === lvl;
                        return (
                          <button
                            key={lvl}
                            type="button"
                            className={`density-btn ${active ? 'active' : ''}`}
                            disabled={cell.locked || !effectivelyEnabled}
                            onClick={() =>
                              onChangeSectionDrumDensity(section.id, {
                                hatDensity: lvl,
                              })
                            }
                          >
                            {lvl}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="density-row">
                    <span className="density-label">Kick 手数</span>
                    <div className="density-segments" role="group" aria-label="Kick 手数">
                      {DENSITY_LEVELS.map((lvl) => {
                        const active = (section.kickDensity ?? 3) === lvl;
                        return (
                          <button
                            key={lvl}
                            type="button"
                            className={`density-btn ${active ? 'active' : ''}`}
                            disabled={cell.locked || !effectivelyEnabled}
                            onClick={() =>
                              onChangeSectionDrumDensity(section.id, {
                                kickDensity: lvl,
                              })
                            }
                          >
                            {lvl}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {key === 'keyboard' && (
                <div className="density-controls">
                  <div className="density-row">
                    <span className="density-label">音数</span>
                    <div
                      className="density-segments density-segments--7"
                      role="group"
                      aria-label="Keyboard 音数"
                    >
                      {KEYBOARD_DENSITY_LEVELS.map((lvl) => {
                        const active = (section.keyboardDensity ?? 4) === lvl;
                        return (
                          <button
                            key={lvl}
                            type="button"
                            className={`density-btn ${active ? 'active' : ''}`}
                            disabled={cell.locked || !effectivelyEnabled}
                            onClick={() =>
                              onChangeSectionKeyboardDensity(section.id, lvl)
                            }
                          >
                            {lvl}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {key === 'vocal' && (
                <div className="density-controls">
                  <div className="density-row">
                    <span className="density-label">音数</span>
                    <div className="density-segments" role="group" aria-label="Vocal 音数">
                      {DENSITY_LEVELS.map((lvl) => {
                        const active = (section.vocalDensity ?? 3) === lvl;
                        return (
                          <button
                            key={lvl}
                            type="button"
                            className={`density-btn ${active ? 'active' : ''}`}
                            disabled={cell.locked || !effectivelyEnabled}
                            onClick={() =>
                              onChangeSectionVocalDensity(section.id, lvl)
                            }
                          >
                            {lvl}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="density-row">
                    <span className="density-label">ハモリ</span>
                    <div
                      className="density-segments density-segments--6"
                      role="group"
                      aria-label="Vocal ハモリ"
                    >
                      {VOCAL_HARMONY_OPTIONS.map((opt) => {
                        const active = (section.vocalHarmony ?? 'off') === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            className={`density-btn harmony-btn ${active ? 'active' : ''}`}
                            disabled={!effectivelyEnabled}
                            onClick={() =>
                              onChangeSectionVocalHarmony(section.id, opt.value)
                            }
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="copy-paste-row">
                <button
                  type="button"
                  className="btn btn-secondary copy-paste-btn"
                  disabled={!member.enabled}
                  onClick={() => {
                    const takeKey =
                      cell.selectedTake === 'OFF' ? 'A' : cell.selectedTake;
                    onCopyPartPhrase({
                      part: key,
                      sourceSectionId: section.id,
                      sourceSectionName: section.name,
                      sourceBars: section.bars,
                      patternPreset: sectionPreset,
                      notes: (cell.takes[takeKey] ?? []).map((n) => ({ ...n })),
                      unisonRiff:
                        key === 'bass' && section.unisonRiff
                          ? {
                              ...section.unisonRiff,
                              cleanedBassNotes: section.unisonRiff.cleanedBassNotes.map(
                                (n) => ({ ...n })
                              ),
                              accentTicks: [...section.unisonRiff.accentTicks],
                            }
                          : undefined,
                      vocalMelody:
                        key === 'vocal' && section.vocalMelody
                          ? {
                              ...section.vocalMelody,
                              notes: section.vocalMelody.notes.map((n) => ({ ...n })),
                            }
                          : undefined,
                    });
                  }}
                >
                  📋 コピー
                </button>
                {copiedPhrase && copiedPhrase.part === key && (
                  <button
                    type="button"
                    className="btn btn-primary copy-paste-btn"
                    disabled={!member.enabled}
                    onClick={() => onPastePartPhrase(section.id, copiedPhrase)}
                  >
                    📥 ペースト（元: {copiedPhrase.sourceSectionName}）
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
