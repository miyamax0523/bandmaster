import { useState, type ChangeEvent } from 'react';
import { isCellOutdated, isDrumLockedUnsynced } from '../lib/bandState';
import { extractDrumLoopFromMidi } from '../lib/midiParser';
import { isAutoTacet, isSectionPartEnabled } from '../lib/noteSelector';
import { PATTERN_PRESET_GROUPS } from '../lib/patternPresets';
import { useHorizontalSwipe } from '../lib/touchSwipe';
import {
  getDefaultDrumFillEnabled,
  type BeatPatternId,
  type ChapterInternalForm,
  type ChordSlot,
  type CopiedPartPhrase,
  type DensityLevel,
  type DrumAnticipationMode,
  type DrumLoopData,
  type EightBarScheme,
  type InstrumentType,
  type KeyboardDensityLevel,
  type KickTake,
  type SongConfig,
  type TakeStyle,
  type VocalHarmonyMode,
} from '../types/song';
import type { BandState } from '../types/track';
import { ChordTimelineEditor } from './ChordTimelineEditor';
import { MidiExportButton } from './MidiExportButton';
import { TakeSelector } from './TakeSelector';

interface BandmasterConsoleProps {
  song: SongConfig;
  bandState: BandState;
  selectedSectionId: string;
  playingSectionId?: string | null;
  isPlaybackRunning?: boolean;
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
    vocalDensity: number
  ) => void;
  onChangeSectionVocalHarmony: (
    sectionId: string,
    mode: VocalHarmonyMode
  ) => void;
  onChangeSectionVocalDialecticalScheme: (
    sectionId: string,
    scheme: EightBarScheme | 'auto'
  ) => void;
  onChangeSectionVocalChapterForm: (
    sectionId: string,
    form: ChapterInternalForm | 'auto'
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
  onChangeSectionDrumAnticipationMode: (
    sectionId: string,
    mode: DrumAnticipationMode
  ) => void;
  onChangeSectionBassChromatic: (sectionId: string, enabled: boolean) => void;
  onChangeSectionBassFillEnabled: (sectionId: string, enabled: boolean) => void;
  onRerollSectionBassFill: (sectionId: string) => void;
  onSetSectionDrumHat16thEnabled: (sectionId: string, enabled: boolean) => void;
  onSetSectionDrumFillEnabled: (sectionId: string, enabled: boolean) => void;
  onSetSectionDrumBreakEnabled: (sectionId: string, enabled: boolean) => void;
  onSetSectionDrumPatternId: (
    sectionId: string,
    patternId: BeatPatternId | 'auto'
  ) => void;
  onSetSectionDrumKickTake: (
    sectionId: string,
    kickTake: KickTake | 'auto'
  ) => void;
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
const BEAT_PATTERN_GROUPS: Array<{
  id: 'BASIC_ROCK' | 'DANCE_MODERN' | 'SHUFFLE_ORGANIC' | 'JAZZ_LATIN';
  label: string;
  options: Array<{ value: BeatPatternId; label: string }>;
}> = [
  {
    id: 'BASIC_ROCK',
    label: 'Basic & Rock（基本7種）',
    options: [
      { value: 'EIGHT_BEAT', label: '王道8ビート' },
      { value: 'SIXTEEN_BEAT', label: '16ビート' },
      { value: 'ATAMA_UCHI', label: '頭打ち（邦ロック式）' },
      { value: 'TWO_BEAT', label: 'ツービート' },
      { value: 'HALF_TIME', label: 'ハーフタイム' },
      { value: 'BOUNCE', label: 'バウンス（跳ね系）' },
      { value: 'DOUBLE_BASS', label: 'ツーバス・ドコドコ' },
    ],
  },
  {
    id: 'DANCE_MODERN',
    label: 'Dance & Modern（ダンス・モダン5種）',
    options: [
      { value: 'FOUR_ON_FLOOR', label: '四つ打ち（ダンス系）' },
      { value: 'UPBEAT', label: '裏打ち・アップビート' },
      { value: 'SOCA', label: 'ソカ（3-3-2疾走）' },
      { value: 'SLIP_BEAT', label: 'スリップビート（Shake系）' },
      { value: 'PPPH', label: 'PPPH（Bメロ定番）' },
    ],
  },
  {
    id: 'SHUFFLE_ORGANIC',
    label: 'Shuffle & Organic（跳ね・ノンシンバル5種）',
    options: [
      { value: 'SHUFFLE', label: 'シャッフル（3連）' },
      { value: 'HALF_TIME_SHUFFLE', label: 'ハーフタイムシャッフル' },
      { value: 'JUNGLE', label: 'ジャングルビート（タム主体）' },
      { value: 'TRAIN', label: 'トレインビート（16分スネア）' },
      { value: 'MARCH', label: 'マーチ（行進ルーディメンツ）' },
    ],
  },
  {
    id: 'JAZZ_LATIN',
    label: 'Specialty / Jazz & Latin（拡張3種）',
    options: [
      { value: 'FOUR_BEAT', label: '4ビート（ジャズ・スウィング）' },
      { value: 'SAMBA', label: 'サンバ／ボサノヴァ' },
      { value: 'SONGO', label: 'ソンゴ（キューバン・リニア）' },
    ],
  },
];

function getKickTakeOptions(
  patternId: BeatPatternId | 'auto'
): Array<{ value: KickTake | 'auto'; label: string }> {
  if (patternId === 'ATAMA_UCHI') {
    return [
      { value: 'auto', label: '自動' },
      { value: 'A', label: 'A: タン・ド・タン・ド' },
      { value: 'B', label: 'B: タン・タン・タド・タド' },
      { value: 'C', label: 'C: 頭ドン＋裏キック' },
    ];
  }
  if (patternId === 'EIGHT_BEAT') {
    return [
      { value: 'auto', label: '自動' },
      { value: 'A', label: 'A: ドッタン・ドドタン' },
      { value: 'B', label: 'B: ドッタン・ン・ドタン' },
      { value: 'C', label: 'C: ドドタン・ドドタン' },
    ];
  }
  if (patternId === 'DOUBLE_BASS') {
    return [
      { value: 'auto', label: '自動' },
      { value: 'A', label: 'A: 連続16分ドコドコ' },
      { value: 'B', label: 'B: ギャロップ' },
      { value: 'C', label: 'C: ハーフ×ツーバス' },
    ];
  }
  if (patternId === 'FOUR_ON_FLOOR') {
    return [
      { value: 'auto', label: '自動' },
      { value: 'A', label: 'A: 基本4つ打ち' },
      { value: 'B', label: 'B: タドタド煽り' },
      { value: 'C', label: 'C: 末尾ピックアップ' },
    ];
  }
  if (patternId === 'UPBEAT') {
    return [
      { value: 'auto', label: '自動' },
      { value: 'A', label: 'A: 四つ打ち系' },
      { value: 'B', label: 'B: 軽快8ビート系' },
      { value: 'C', label: 'C: シンコペ推進' },
    ];
  }
  if (patternId === 'HALF_TIME_SHUFFLE') {
    return [
      { value: 'auto', label: '自動' },
      { value: 'A', label: 'A: Purdie（王道）' },
      { value: 'B', label: 'B: Bonham（重量型）' },
      { value: 'C', label: 'C: Rosanna（クラーベ）' },
    ];
  }
  if (patternId === 'PPPH') {
    return [
      { value: 'auto', label: '自動' },
      { value: 'A', label: 'A: 王道キメ＋抜け拍' },
      { value: 'B', label: 'B: 裏打ちHH完走' },
      { value: 'C', label: 'C: サビ前タム積層煽り' },
    ];
  }
  if (patternId === 'SOCA') {
    return [
      { value: 'auto', label: '自動' },
      { value: 'A', label: 'A: 邦ロック疾走' },
      { value: 'B', label: 'B: カリビアン・リム' },
      { value: 'C', label: 'C: ゴースト＆推進' },
    ];
  }
  if (patternId === 'SAMBA') {
    return [
      { value: 'auto', label: '自動' },
      { value: 'A', label: 'A: 王道サンバ' },
      { value: 'B', label: 'B: ボサノヴァ風' },
      { value: 'C', label: 'C: ベル＆スネア強調' },
    ];
  }
  return [
    { value: 'auto', label: '自動' },
    { value: 'A', label: 'Take A（標準）' },
    { value: 'B', label: 'Take B（タメ・裏）' },
    { value: 'C', label: 'Take C（推進力）' },
  ];
}

const VOCAL_HARMONY_OPTIONS: Array<{ value: VocalHarmonyMode; label: string }> = [
  { value: 'off', label: 'OFF' },
  { value: 'upper_3rd', label: '3度上' },
  { value: 'lower_3rd', label: '3度下' },
  { value: 'upper_5th', label: '5度上' },
  { value: 'octave_up', label: 'Oct上' },
  { value: 'octave_down', label: 'Oct下' },
];

const VOCAL_DIALECTICAL_SCHEME_OPTIONS: Array<{
  value: EightBarScheme | 'auto';
  label: string;
}> = [
  { value: 'auto', label: '自動' },
  { value: 'T-A-T-A', label: 'T-A-T-A（反復・安定）' },
  { value: 'T-A-T-S', label: 'T-A-T-S（反動クライマックス）' },
];

const VOCAL_CHAPTER_FORM_OPTIONS: Array<{
  value: ChapterInternalForm | 'auto';
  label: string;
}> = [
  { value: 'auto', label: '自動' },
  { value: 'two_bar_continuous', label: '2小節貫通型' },
  { value: 'one_bar_repeat_with_passing', label: '1小節反復＋経過ライン' },
];

export function BandmasterConsole({
  song,
  bandState,
  selectedSectionId,
  playingSectionId,
  isPlaybackRunning = false,
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
  onChangeSectionVocalDialecticalScheme,
  onChangeSectionVocalChapterForm,
  copiedPhrase,
  onCopyPartPhrase,
  onPastePartPhrase,
  onChangeSectionPatternPreset,
  onChangeSectionChordTimeline,
  onChangeSectionDrumAnticipationMode,
  onChangeSectionBassChromatic,
  onChangeSectionBassFillEnabled,
  onRerollSectionBassFill,
  onSetSectionDrumHat16thEnabled,
  onSetSectionDrumFillEnabled,
  onSetSectionDrumBreakEnabled,
  onSetSectionDrumPatternId,
  onSetSectionDrumKickTake,
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
        {song.sections.map((sec, idx) => {
          const isPlayingHere = Boolean(
            playingSectionId && sec.id === playingSectionId
          );
          return (
            <button
              key={sec.id}
              type="button"
              className={`pill ${sec.id === section.id ? 'active' : ''} ${
                isPlayingHere ? 'playing' : ''
              } ${isPlayingHere && isPlaybackRunning ? 'is-running' : ''}`}
              aria-current={isPlayingHere ? 'location' : undefined}
              onClick={() => onSelectSection(sec.id)}
            >
              {isPlayingHere && (
                <span
                  className={`playing-dot ${isPlaybackRunning ? '' : 'is-paused'}`}
                  aria-hidden="true"
                />
              )}
              <span>
                {idx + 1}. {sec.name}
              </span>
            </button>
          );
        })}
      </div>

      <ChordTimelineEditor
        key={`tl-${section.id}`}
        song={song}
        section={section}
        onChangeSlots={onChangeSectionChordTimeline}
        onChangeDrumAnticipationMode={onChangeSectionDrumAnticipationMode}
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
          {(() => {
            if (!playingSectionId) return null;
            if (playingSectionId === section.id) {
              return (
                <span className="badge badge-playing">
                  {isPlaybackRunning ? '▶ 再生中' : '⏸ 一時停止中'}
                </span>
              );
            }
            const playingIdx = song.sections.findIndex(
              (s) => s.id === playingSectionId
            );
            const playingSec = playingIdx >= 0 ? song.sections[playingIdx] : null;
            if (!playingSec) return null;
            return (
              <button
                type="button"
                className="badge badge-playing-jump"
                onClick={() => onSelectSection(playingSec.id)}
                title="再生中のセクションへ表示を切り替え"
              >
                {isPlaybackRunning ? '▶ 再生中' : '⏸ 一時停止'}: {playingIdx + 1}.{' '}
                {playingSec.name} へ移動
              </button>
            );
          })()}
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
                  {(() => {
                    const currentPatternId = section.drumPatternId ?? 'auto';
                    const currentKickTake = section.drumKickTake ?? 'auto';
                    const kickTakeOpts = getKickTakeOptions(currentPatternId);
                    return (
                      <>
                        <div className="density-row">
                          <span className="density-label">ビート骨格</span>
                          <select
                            className="console-preset-select"
                            aria-label="ビート骨格"
                            value={currentPatternId}
                            disabled={cell.locked || !effectivelyEnabled}
                            onChange={(e) =>
                              onSetSectionDrumPatternId(
                                section.id,
                                e.target.value as BeatPatternId | 'auto'
                              )
                            }
                          >
                            <option value="auto">自動（ジャンル展開）</option>
                            {BEAT_PATTERN_GROUPS.map((group) => (
                              <optgroup key={group.id} label={group.label}>
                                {group.options.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>

                        <div className="density-row">
                          <span className="density-label">キック Take</span>
                          <select
                            className="console-preset-select"
                            aria-label="キック Take"
                            value={currentKickTake}
                            disabled={cell.locked || !effectivelyEnabled}
                            onChange={(e) =>
                              onSetSectionDrumKickTake(
                                section.id,
                                e.target.value as KickTake | 'auto'
                              )
                            }
                          >
                            {kickTakeOpts.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    );
                  })()}

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

                  {(() => {
                    const hat16thOn = section.drumHat16thEnabled ?? false;
                    const fillOn =
                      section.drumFillEnabled ??
                      getDefaultDrumFillEnabled(section.type, section.bars);
                    const breakOn = section.drumBreakEnabled ?? false;
                    return (
                      <div
                        className="drum-pro-controls"
                        role="group"
                        aria-label="Drums 表現設定"
                      >
                        <button
                          type="button"
                          className={`chip-btn drum-pro-btn ${hat16thOn ? 'chip-active' : ''}`}
                          aria-pressed={hat16thOn}
                          disabled={cell.locked || !effectivelyEnabled}
                          onClick={() =>
                            onSetSectionDrumHat16thEnabled(section.id, !hat16thOn)
                          }
                          title="8分刻み時の16分ハット／ライド装飾を切り替え"
                        >
                          🎩 16分装飾: {hat16thOn ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          className={`chip-btn drum-pro-btn ${fillOn ? 'chip-active' : ''}`}
                          aria-pressed={fillOn}
                          disabled={cell.locked || !effectivelyEnabled}
                          onClick={() =>
                            onSetSectionDrumFillEnabled(section.id, !fillOn)
                          }
                          title="セクション末尾や節目でのタム回しフィルを切り替え"
                        >
                          🥁 タム回し: {fillOn ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          className={`chip-btn drum-pro-btn ${breakOn ? 'chip-active' : ''}`}
                          aria-pressed={breakOn}
                          disabled={cell.locked || !effectivelyEnabled}
                          onClick={() =>
                            onSetSectionDrumBreakEnabled(section.id, !breakOn)
                          }
                          title="セクション最終小節後半の無音ブレイクを切り替え"
                        >
                          ⏸️ ブレイク: {breakOn ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}

              {key === 'bass' && (
                <div className="bass-pro-controls" role="group" aria-label="Bass 表現設定">
                  <button
                    type="button"
                    className={`chip-btn bass-pro-btn ${
                      section.bassFillEnabled ? 'chip-active' : ''
                    }`}
                    aria-pressed={Boolean(section.bassFillEnabled)}
                    disabled={cell.locked || !effectivelyEnabled}
                    onClick={() =>
                      onChangeSectionBassFillEnabled(
                        section.id,
                        !section.bassFillEnabled
                      )
                    }
                    title="4/8小節目末尾のベースおかず（フィルイン）を切り替え"
                  >
                    🎸 おかず: {section.bassFillEnabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary bass-pro-btn"
                    disabled={
                      !section.bassFillEnabled || cell.locked || !effectivelyEnabled
                    }
                    onClick={() => onRerollSectionBassFill(section.id)}
                    title="基本グルーヴを保ったままおかずフレーズだけ入替"
                  >
                    🎲 おかず入替
                  </button>
                  <button
                    type="button"
                    className={`chip-btn bass-pro-btn ${
                      section.bassChromaticEnabled ? 'chip-active' : ''
                    }`}
                    aria-pressed={Boolean(section.bassChromaticEnabled)}
                    disabled={cell.locked || !effectivelyEnabled}
                    onClick={() =>
                      onChangeSectionBassChromatic(
                        section.id,
                        !section.bassChromaticEnabled
                      )
                    }
                    title="弱拍・経過音への半音アプローチ／♭5経過音を許可"
                  >
                    ♯ 半音経過: {section.bassChromaticEnabled ? 'ON' : 'OFF'}
                  </button>
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
                    <span className="density-label">
                      手数: {(section.vocalDensity ?? 3).toFixed(1)} (
                      {(section.vocalDensity ?? 3) <= 1.8
                        ? '余白多め'
                        : (section.vocalDensity ?? 3) <= 2.6
                          ? '控えめ'
                          : (section.vocalDensity ?? 3) <= 3.5
                            ? '標準'
                            : (section.vocalDensity ?? 3) <= 4.3
                              ? '密集'
                              : '連射'}
                      )
                    </span>
                    <input
                      type="range"
                      className="bpm-range"
                      min={1.0}
                      max={5.0}
                      step={0.1}
                      value={section.vocalDensity ?? 3}
                      aria-label="Vocal 手数スライダー"
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onChangeSectionVocalDensity(
                          section.id,
                          parseFloat(e.target.value)
                        )
                      }
                    />
                  </div>
                  <div className="density-row">
                    <span className="density-label">構成スキーム</span>
                    <select
                      className="console-preset-select"
                      aria-label="Vocal 構成スキーム"
                      value={section.vocalDialecticalScheme ?? 'auto'}
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onChangeSectionVocalDialecticalScheme(
                          section.id,
                          e.target.value as EightBarScheme | 'auto'
                        )
                      }
                    >
                      {VOCAL_DIALECTICAL_SCHEME_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="density-row">
                    <span className="density-label">章内構造</span>
                    <select
                      className="console-preset-select"
                      aria-label="Vocal 章内構造"
                      value={section.vocalChapterForm ?? 'auto'}
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onChangeSectionVocalChapterForm(
                          section.id,
                          e.target.value as ChapterInternalForm | 'auto'
                        )
                      }
                    >
                      {VOCAL_CHAPTER_FORM_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
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
