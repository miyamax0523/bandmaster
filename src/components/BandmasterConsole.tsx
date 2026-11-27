import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  midiToSpnLabel,
  parseCustomChordProgression,
  suggestChords,
  VOCAL_VOICE_PROFILES,
} from '../engines/musicCore';
import { isCellOutdated, isDrumLockedUnsynced } from '../lib/bandState';
import { noteNameToSemitone } from '../lib/chordUtils';
import { extractDrumLoopFromMidi, extractRiffNotesFromMidi } from '../lib/midiParser';
import { isAutoTacet, isSectionPartEnabled } from '../lib/noteSelector';
import { PATTERN_PRESET_GROUPS } from '../lib/patternPresets';
import { useHorizontalSwipe } from '../lib/touchSwipe';
import {
  getDefaultDrumFillEnabled,
  type AccompanimentTake,
  type BassLockMode,
  type BassSkeletonId,
  type BeatPatternId,
  type ChapterInternalForm,
  type ChordLockMode,
  type ChordSlot,
  type CopiedPartPhrase,
  type DensityLevel,
  type DrumAnticipationMode,
  type DrumLoopData,
  type EightBarScheme,
  type InstrumentType,
  type KeyboardDensityLevel,
  type KeyboardSkeletonId,
  type KickTake,
  type MidiNote,
  type PadSkeletonId,
  type SongConfig,
  type TakeStyle,
  type VocalEndingMode,
  type VocalHarmonyMode,
  type VocalStyleId,
  type VocalTakeId,
  type VocalVoicePresetId,
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
  onChangeSectionVocalDensity?: (
    sectionId: string,
    vocalDensity: number
  ) => void;
  onChangeSectionVocalHarmony?: (
    sectionId: string,
    mode: VocalHarmonyMode
  ) => void;
  onChangeSectionVocalDialecticalScheme?: (
    sectionId: string,
    scheme: EightBarScheme | 'auto'
  ) => void;
  onChangeSectionVocalChapterForm?: (
    sectionId: string,
    form: ChapterInternalForm | 'auto'
  ) => void;
  onChangeSectionVocalConfig?: (
    sectionId: string,
    patch: {
      vocalStyle?: VocalStyleId;
      vocalTake?: VocalTakeId;
      vocalEnding?: VocalEndingMode;
    }
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
  onSetSectionAccompanimentSkeleton?: (
    sectionId: string,
    instrument: 'bass' | 'keyboard' | 'pad',
    skeleton: BassSkeletonId | KeyboardSkeletonId | PadSkeletonId | 'auto'
  ) => void;
  onSetSectionAccompanimentTake?: (
    sectionId: string,
    instrument: 'bass' | 'keyboard' | 'pad',
    take: AccompanimentTake | 'auto'
  ) => void;
  onChangeVocalVoiceProfile?: (patch: {
    vocalVoiceProfileId?: VocalVoicePresetId;
    vocalCustomMinMidi?: number;
    vocalCustomMaxMidi?: number;
  }) => void;
  onLockSectionChordsToCustom?: (sectionId: string) => void;
  onChangeSectionChordLock?: (
    sectionId: string,
    patch: { chordLockMode?: ChordLockMode; customChordsText?: string }
  ) => readonly string[] | void;
  onChangeSectionBassMidiOverride?: (
    sectionId: string,
    options: {
      bassLockMode: BassLockMode;
      rawNotes?: readonly MidiNote[] | null;
      sourceLabel?: string;
      shiftOctaveDown?: boolean;
    }
  ) => void;
  onInferSectionChordsFromBass?: (sectionId: string) => void;
  onOpenRiffModal?: (sectionId: string) => void;
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

const BASS_SKELETON_OPTIONS: Array<{ value: BassSkeletonId | 'auto'; label: string }> = [
  { value: 'auto', label: '自動（ドラム連動）' },
  { value: 'KICK_LOCK', label: 'キック同期（Kick Lock）' },
  { value: 'EIGHTH_ROOT', label: '8分ルート推進' },
  { value: 'OCTAVE_GROOVE', label: 'オクターブ・グルーヴ' },
  { value: 'SIXTEENTH_SYNC', label: '16分シンコペ' },
  { value: 'TRIPLET_SHUFFLE', label: '3連シャッフル' },
  { value: 'LONG_SUSTAIN', label: 'ロングサステイン' },
  { value: 'RIFF_CHUG', label: 'リフ・チャグ（刻み）' },
];

const KEYBOARD_SKELETON_OPTIONS: Array<{
  value: KeyboardSkeletonId | 'auto';
  label: string;
}> = [
  { value: 'auto', label: '自動（ドラム連動）' },
  { value: 'SUSTAIN_CHORD', label: '白玉サステイン' },
  { value: 'QUARTER_CHOP', label: '4分刻みチョップ' },
  { value: 'OFFBEAT_STAB', label: '裏打ちスタブ' },
  { value: 'ARPEGGIO_8TH_16TH', label: 'アルペジオ（8分/16分）' },
  { value: 'SYNCOPATED_RIFF', label: 'シンコペ・リフ' },
  { value: 'TRIPLET_COMP', label: '3連シャッフルコンプ' },
];

const PAD_SKELETON_OPTIONS: Array<{ value: PadSkeletonId | 'auto'; label: string }> = [
  { value: 'auto', label: '自動（ドラム連動）' },
  { value: 'WARM_SUSTAIN', label: 'ウォーム持続（共通音連結）' },
  { value: 'PEDAL_DRONE', label: '高域ペダル・ドローン' },
  { value: 'SIDECHAIN_PULSE', label: 'サイドチェイン・パルス' },
  { value: 'BUILDUP_SWELL', label: 'ビルドアップ・スウェル' },
];

const ACCOMPANIMENT_TAKE_OPTIONS: Array<{
  value: AccompanimentTake | 'auto';
  label: string;
}> = [
  { value: 'auto', label: '自動' },
  { value: 'A', label: 'Take A（標準）' },
  { value: 'B', label: 'Take B（動き・裏）' },
  { value: 'C', label: 'Take C（推進・装飾）' },
];

const VOCAL_STYLE_OPTIONS: Array<{ value: VocalStyleId; label: string }> = [
  { value: 'straight', label: '歌・ストレート' },
  { value: 'bounce', label: '歌・ハネ' },
  { value: 'rap', label: 'ラップ' },
];

const VOCAL_TAKE_OPTIONS: Array<{ value: VocalTakeId; label: string }> = [
  { value: 'A', label: 'A: 王道・キャッチー' },
  { value: 'B', label: 'B: 跳躍・ドライブ' },
  { value: 'C', label: 'C: タメ・ロングトーン' },
];

const VOCAL_ENDING_OPTIONS: Array<{ value: VocalEndingMode; label: string }> = [
  { value: 'auto', label: 'おまかせ' },
  { value: 'ascend', label: '駆け上がり' },
  { value: 'tonic', label: 'トニック着地' },
  { value: 'dominant', label: 'ドミナント留保' },
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
  onChangeSectionVocalConfig,
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
  onSetSectionAccompanimentSkeleton,
  onSetSectionAccompanimentTake,
  onChangeVocalVoiceProfile,
  onLockSectionChordsToCustom,
  onChangeSectionChordLock,
  onChangeSectionBassMidiOverride,
  onInferSectionChordsFromBass,
  onOpenRiffModal,
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
  const [bassMidiError, setBassMidiError] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<number>(0);
  const [selectedSuggestIdx, setSelectedSuggestIdx] = useState<number>(0);
  const customInputRef = useRef<HTMLInputElement | null>(null);
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
      <div
        className="toolbar-row"
        role="region"
        aria-label="グローバル楽曲＆ボイス設定"
      >
        <span className="badge">
          🎵 {song.title} · {song.key} {song.scale} · {song.bpm} BPM
        </span>
        <label
          className="density-row"
          style={{ margin: 0, gap: '0.4rem' }}
          title="VoiSona基準 (C4=60) ボイスプリセット（変更時はコード進行を保持して歌メロ＆鍵盤クランプのみ再計算）"
        >
          <span className="density-label">🎤 ボイス音域 (VoiSona C4=60)</span>
          <select
            className="console-preset-select"
            aria-label="ボーカルボイスプリセット"
            value={song.vocalVoiceProfileId ?? 'chisa_jp'}
            onChange={(e) =>
              onChangeVocalVoiceProfile?.({
                vocalVoiceProfileId: e.target.value as VocalVoicePresetId,
              })
            }
          >
            <option value="chisa_jp">{VOCAL_VOICE_PROFILES.chisa_jp.label}</option>
            <option value="female_high">
              {VOCAL_VOICE_PROFILES.female_high.label}
            </option>
            <option value="male_rock">{VOCAL_VOICE_PROFILES.male_rock.label}</option>
            <option value="custom">カスタム</option>
          </select>
        </label>

        {(song.vocalVoiceProfileId ?? 'chisa_jp') === 'custom' && (
          <div
            className="density-row"
            style={{ margin: 0, gap: '0.4rem' }}
            title="VoiSona基準 (C4=60) カスタム音域（最低1オクターブ＝12半音幅を保証）"
          >
            <span className="density-label">Min</span>
            <select
              className="console-preset-select"
              aria-label="カスタムボーカル最低音"
              value={song.vocalCustomMinMidi ?? 55}
              onChange={(e) => {
                const nextMin = Number(e.target.value);
                const currMax = song.vocalCustomMaxMidi ?? 74;
                onChangeVocalVoiceProfile?.({
                  vocalCustomMinMidi: nextMin,
                  vocalCustomMaxMidi: Math.max(nextMin + 12, currMax),
                });
              }}
            >
              {Array.from({ length: 37 }, (_, i) => 40 + i).map((m) => (
                <option key={m} value={m}>
                  {midiToSpnLabel(m)} ({m})
                </option>
              ))}
            </select>
            <span className="density-label">Max</span>
            <select
              className="console-preset-select"
              aria-label="カスタムボーカル最高音"
              value={Math.max(
                (song.vocalCustomMinMidi ?? 55) + 12,
                song.vocalCustomMaxMidi ?? 74
              )}
              onChange={(e) => {
                const currMin = song.vocalCustomMinMidi ?? 55;
                onChangeVocalVoiceProfile?.({
                  vocalCustomMaxMidi: Math.max(
                    currMin + 12,
                    Number(e.target.value)
                  ),
                });
              }}
            >
              {Array.from(
                {
                  length: Math.max(
                    1,
                    88 - ((song.vocalCustomMinMidi ?? 55) + 12) + 1
                  ),
                },
                (_, i) => (song.vocalCustomMinMidi ?? 55) + 12 + i
              ).map((m) => (
                <option key={m} value={m}>
                  {midiToSpnLabel(m)} ({m})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

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

      <div
        className="info-box"
        role="region"
        aria-label="カスタムコード進行・ギターリフ固定モード"
        style={{ marginBottom: '0.75rem' }}
      >
        {(() => {
          const chordLockMode: ChordLockMode = section.chordLockMode ?? 'auto';
          const customText = section.customChordsText ?? '';
          const genreHint =
            section.patternPresets?.keyboard ??
            section.patternPresets?.vocal ??
            song.members.keyboard.patternPreset ??
            'royal_jpop';
          const keyRootPc = noteNameToSemitone(song.key);

          // Extract token around cursor for live chord suggestion
          const safeCursor = Math.min(cursorPos, customText.length);
          let tokenStart = safeCursor;
          while (
            tokenStart > 0 &&
            customText[tokenStart - 1] !== ' ' &&
            customText[tokenStart - 1] !== '|'
          ) {
            tokenStart--;
          }
          let tokenEnd = safeCursor;
          while (
            tokenEnd < customText.length &&
            customText[tokenEnd] !== ' ' &&
            customText[tokenEnd] !== '|'
          ) {
            tokenEnd++;
          }
          const activeToken = customText.slice(tokenStart, tokenEnd).trim();
          const suggestions =
            chordLockMode === 'custom'
              ? suggestChords(activeToken, keyRootPc, song.scale, genreHint)
              : [];
          const activeSuggestIdx =
            suggestions.length > 0
              ? Math.max(0, Math.min(suggestions.length - 1, selectedSuggestIdx))
              : 0;
          const liveParse =
            chordLockMode === 'custom'
              ? parseCustomChordProgression(
                  customText,
                  section.bars,
                  keyRootPc,
                  song.scale,
                  genreHint
                )
              : null;

          const applySuggestion = (chordStr: string) => {
            const before = customText.slice(0, tokenStart);
            const after = customText.slice(tokenEnd);
            const spacer = after.length === 0 || after.startsWith(' ') || after.startsWith('|') ? '' : ' ';
            const nextText = `${before}${chordStr}${spacer}${after}`;
            onChangeSectionChordLock?.(section.id, {
              chordLockMode: 'custom',
              customChordsText: nextText,
            });
            const nextCaret = before.length + chordStr.length;
            setCursorPos(nextCaret);
            setSelectedSuggestIdx(0);
            requestAnimationFrame(() => {
              const el = customInputRef.current;
              if (el) {
                el.focus();
                el.setSelectionRange(nextCaret, nextCaret);
              }
            });
          };

          const handleCustomKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
            if (suggestions.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelectedSuggestIdx((prev) => (prev + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelectedSuggestIdx(
                (prev) => (prev - 1 + suggestions.length) % suggestions.length
              );
            } else if (e.key === 'Tab' || e.key === 'Enter') {
              if (activeToken.length > 0 || e.key === 'Tab') {
                e.preventDefault();
                applySuggestion(suggestions[activeSuggestIdx].chord);
              }
            }
          };

          return (
            <>
              <div
                className="toolbar-row"
                style={{ justifyContent: 'space-between', marginBottom: chordLockMode === 'custom' ? '0.5rem' : 0 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <strong>🎸 コード進行モード:</strong>
                  <button
                    type="button"
                    className={`chip-btn ${chordLockMode === 'auto' ? 'chip-active' : ''}`}
                    aria-pressed={chordLockMode === 'auto'}
                    onClick={() =>
                      onChangeSectionChordLock?.(section.id, { chordLockMode: 'auto' })
                    }
                  >
                    自動生成
                  </button>
                  <button
                    type="button"
                    className={`chip-btn ${chordLockMode === 'custom' ? 'chip-active' : ''}`}
                    aria-pressed={chordLockMode === 'custom'}
                    onClick={() => onLockSectionChordsToCustom?.(section.id)}
                  >
                    🔒 固定 (カスタム)
                  </button>
                </div>
                {chordLockMode === 'auto' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onLockSectionChordsToCustom?.(section.id)}
                    title="現在のコード進行をカスタムテキスト欄へコピーして固定編集を開始"
                  >
                    📋 この進行を編集・固定
                  </button>
                )}
              </div>

              {chordLockMode === 'custom' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <input
                    ref={customInputRef}
                    type="text"
                    className="console-preset-select"
                    style={{ width: '100%', fontFamily: 'monospace' }}
                    aria-label="カスタムコード進行入力"
                    placeholder="例: E5 | F5 | G5 F5 | E5（| で小節区切り、スペースで拍分割、% でリピート）"
                    value={customText}
                    onChange={(e) => {
                      setCursorPos(e.target.selectionStart ?? e.target.value.length);
                      setSelectedSuggestIdx(0);
                      onChangeSectionChordLock?.(section.id, {
                        chordLockMode: 'custom',
                        customChordsText: e.target.value,
                      });
                    }}
                    onClick={(e) =>
                      setCursorPos(
                        (e.target as HTMLInputElement).selectionStart ?? customText.length
                      )
                    }
                    onKeyUp={(e) =>
                      setCursorPos(
                        (e.target as HTMLInputElement).selectionStart ?? customText.length
                      )
                    }
                    onKeyDown={handleCustomKeyDown}
                  />

                  {suggestions.length > 0 && (
                    <div
                      style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}
                      role="listbox"
                      aria-label="ダイアトニック・コード候補サジェスト"
                    >
                      <span className="density-label" style={{ fontSize: '0.75rem' }}>
                        候補 ({song.key} {song.scale} / ↑↓・Tab・Enter):
                      </span>
                      {suggestions.map((sug, idx) => (
                        <button
                          key={`${sug.chord}-${idx}`}
                          type="button"
                          role="option"
                          aria-selected={idx === activeSuggestIdx}
                          className={`chip-btn ${idx === activeSuggestIdx ? 'chip-active' : ''}`}
                          style={{ fontSize: '0.76rem', padding: '0.18rem 0.48rem' }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applySuggestion(sug.chord);
                          }}
                        >
                          <strong>{sug.chord}</strong>{' '}
                          <span style={{ opacity: 0.78 }}>({sug.roleLabel})</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {liveParse && !liveParse.valid && (
                    <p className="error-text" role="alert" style={{ margin: 0 }}>
                      ⚠ {liveParse.errors[0]}（直前の有効な進行を保持中）
                    </p>
                  )}

                  {liveParse && liveParse.valid && (
                    <div
                      style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}
                      aria-label="パース済みコード進行プレビュー"
                    >
                      <span className="density-label" style={{ fontSize: '0.75rem' }}>
                        確定進行 ({section.bars}小節):
                      </span>
                      {liveParse.chordEvents.map((ev, idx) => (
                        <span
                          key={`${ev.startTick}-${idx}`}
                          className="badge badge-info"
                          style={{ fontSize: '0.74rem' }}
                        >
                          {ev.chordSymbol}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}
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

              {key !== 'vocal' && (
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
              )}

              <TakeSelector
                selectedTake={cell.selectedTake}
                locked={cell.locked}
                autoTacet={autoTacet}
                disabled={!effectivelyEnabled}
                onSelect={(take) => {
                  onSelectTake(section.id, key, take);
                  if (key === 'vocal' && take !== 'OFF') {
                    onChangeSectionVocalConfig?.(section.id, { vocalTake: take });
                  }
                }}
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
                <div className="density-controls">
                  <div className="source-line">
                    ソース:{' '}
                    {section.bassLockMode === 'midi_override' &&
                    section.overrideBassNotes &&
                    section.overrideBassNotes.length > 0
                      ? `🔒 固定ベースMIDI (${section.overrideBassSourceLabel ?? 'Basic Pitch / MIDI'} · ${section.overrideBassNotes.length}音)`
                      : section.unisonRiff
                        ? `🎸 ユニゾンリフ (${section.unisonRiff.sourceName})`
                        : '内蔵ベース生成エンジン'}
                  </div>
                  <div className="drum-midi-actions" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
                    {onOpenRiffModal && (
                      <button
                        type="button"
                        className="btn btn-secondary drum-midi-btn"
                        onClick={() => onOpenRiffModal(section.id)}
                      >
                        🎸 Basic Pitch / リフ解析
                      </button>
                    )}
                    <label className="btn btn-secondary drum-midi-btn">
                      🎼 ベースMIDI直読込
                      <input
                        type="file"
                        accept=".mid,.midi,audio/midi"
                        hidden
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          try {
                            setBassMidiError(null);
                            const bytes = new Uint8Array(await file.arrayBuffer());
                            const extracted = extractRiffNotesFromMidi(bytes);
                            onChangeSectionBassMidiOverride?.(section.id, {
                              bassLockMode: 'midi_override',
                              rawNotes: extracted.notes,
                              sourceLabel: file.name,
                              shiftOctaveDown: section.overrideBassShiftOctave ?? true,
                            });
                          } catch (err) {
                            setBassMidiError(
                              err instanceof Error ? err.message : 'ベースMIDI読込失敗'
                            );
                          }
                        }}
                      />
                    </label>
                    {section.bassLockMode === 'midi_override' && (
                      <>
                        <button
                          type="button"
                          className={`chip-btn bass-pro-btn ${
                            (section.overrideBassShiftOctave ?? true) ? 'chip-active' : ''
                          }`}
                          onClick={() =>
                            onChangeSectionBassMidiOverride?.(section.id, {
                              bassLockMode: 'midi_override',
                              shiftOctaveDown: !(section.overrideBassShiftOctave ?? true),
                            })
                          }
                          title="ギター音域(E2〜)をベース音域(E1〜G3)へ1オクターブ下方シフト"
                        >
                          ⬇ -1Oct: {(section.overrideBassShiftOctave ?? true) ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-accent drum-midi-btn"
                          onClick={() => onInferSectionChordsFromBass?.(section.id)}
                          title="固定ベースMIDIの各小節ルート音からパワーコード進行を自動推定してカスタム固定へ反映"
                        >
                          ⚡ ベースからコード推定
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger drum-midi-btn"
                          onClick={() =>
                            onChangeSectionBassMidiOverride?.(section.id, {
                              bassLockMode: 'auto',
                              rawNotes: null,
                            })
                          }
                        >
                          ✕ 固定解除
                        </button>
                      </>
                    )}
                  </div>
                  {bassMidiError && <p className="error-text">{bassMidiError}</p>}
                  <div className="density-row">
                    <span className="density-label">ベース骨格</span>
                    <select
                      className="console-preset-select"
                      aria-label="ベース骨格"
                      value={section.bassSkeleton ?? 'auto'}
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onSetSectionAccompanimentSkeleton?.(
                          section.id,
                          'bass',
                          e.target.value as BassSkeletonId | 'auto'
                        )
                      }
                    >
                      {BASS_SKELETON_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="density-row">
                    <span className="density-label">骨格 Take</span>
                    <select
                      className="console-preset-select"
                      aria-label="ベース骨格 Take"
                      value={section.bassTake ?? 'auto'}
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onSetSectionAccompanimentTake?.(
                          section.id,
                          'bass',
                          e.target.value as AccompanimentTake | 'auto'
                        )
                      }
                    >
                      {ACCOMPANIMENT_TAKE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
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
                </div>
              )}

              {key === 'keyboard' && (
                <div className="density-controls">
                  <div className="density-row">
                    <span className="density-label">鍵盤骨格</span>
                    <select
                      className="console-preset-select"
                      aria-label="鍵盤骨格"
                      value={section.keyboardSkeleton ?? 'auto'}
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onSetSectionAccompanimentSkeleton?.(
                          section.id,
                          'keyboard',
                          e.target.value as KeyboardSkeletonId | 'auto'
                        )
                      }
                    >
                      {KEYBOARD_SKELETON_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="density-row">
                    <span className="density-label">骨格 Take</span>
                    <select
                      className="console-preset-select"
                      aria-label="鍵盤骨格 Take"
                      value={section.keyboardTake ?? 'auto'}
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onSetSectionAccompanimentTake?.(
                          section.id,
                          'keyboard',
                          e.target.value as AccompanimentTake | 'auto'
                        )
                      }
                    >
                      {ACCOMPANIMENT_TAKE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
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

              {key === 'pad' && (
                <div className="density-controls">
                  <div className="density-row">
                    <span className="density-label">PAD 骨格</span>
                    <select
                      className="console-preset-select"
                      aria-label="PAD 骨格"
                      value={section.padSkeleton ?? 'auto'}
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onSetSectionAccompanimentSkeleton?.(
                          section.id,
                          'pad',
                          e.target.value as PadSkeletonId | 'auto'
                        )
                      }
                    >
                      {PAD_SKELETON_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="density-row">
                    <span className="density-label">骨格 Take</span>
                    <select
                      className="console-preset-select"
                      aria-label="PAD 骨格 Take"
                      value={section.padTake ?? 'auto'}
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onSetSectionAccompanimentTake?.(
                          section.id,
                          'pad',
                          e.target.value as AccompanimentTake | 'auto'
                        )
                      }
                    >
                      {ACCOMPANIMENT_TAKE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {key === 'vocal' && (
                <div className="density-controls">
                  <div className="density-row">
                    <span className="density-label">スタイル</span>
                    <select
                      className="console-preset-select"
                      aria-label="Vocal スタイル"
                      value={section.vocalStyle ?? 'straight'}
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onChangeSectionVocalConfig?.(section.id, {
                          vocalStyle: e.target.value as VocalStyleId,
                        })
                      }
                    >
                      {VOCAL_STYLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="density-row">
                    <span className="density-label">Take</span>
                    <select
                      className="console-preset-select"
                      aria-label="Vocal Take"
                      value={
                        cell.selectedTake !== 'OFF'
                          ? cell.selectedTake
                          : (section.vocalTake ?? 'A')
                      }
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onChangeSectionVocalConfig?.(section.id, {
                          vocalTake: e.target.value as VocalTakeId,
                        })
                      }
                    >
                      {VOCAL_TAKE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="density-row">
                    <span className="density-label">締め方</span>
                    <select
                      className="console-preset-select"
                      aria-label="Vocal 締め方"
                      value={section.vocalEnding ?? 'auto'}
                      disabled={cell.locked || !effectivelyEnabled}
                      onChange={(e) =>
                        onChangeSectionVocalConfig?.(section.id, {
                          vocalEnding: e.target.value as VocalEndingMode,
                        })
                      }
                    >
                      {VOCAL_ENDING_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
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
