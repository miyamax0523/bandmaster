import { useState, type ChangeEvent } from 'react';
import { isCellOutdated, isDrumLockedUnsynced } from '../lib/bandState';
import { extractDrumLoopFromMidi } from '../lib/midiParser';
import { isAutoTacet } from '../lib/noteSelector';
import { useHorizontalSwipe } from '../lib/touchSwipe';
import type {
  DensityLevel,
  DrumLoopData,
  InstrumentType,
  SongConfig,
  TakeStyle,
} from '../types/song';
import type { BandState } from '../types/track';
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
];

const DENSITY_LEVELS: readonly DensityLevel[] = [1, 2, 3, 4, 5];

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

      <div className="console-cards" {...swipeHandlers}>
        {INSTRUMENTS.map(({ key, label, icon }) => {
          const member = song.members[key];
          const cell = cells?.[key];
          if (!cell) return null;

          const autoTacet = isAutoTacet(song, section, key);
          const outdated = !cell.locked && isCellOutdated(cell);
          const unsyncedDrum =
            key === 'drums' && isDrumLockedUnsynced(section, cells);
          const activeCount =
            cell.selectedTake === 'OFF' || !member.enabled || autoTacet
              ? 0
              : cell.takes[cell.selectedTake].length;

          return (
            <article
              key={key}
              className={`instrument-card ${!member.enabled ? 'is-disabled' : ''}`}
            >
              <div className="card-header">
                <div className="card-title-group">
                  <span className="card-icon">{icon}</span>
                  <div>
                    <h3>{label}</h3>
                    <span className="card-sub">
                      {!member.enabled
                        ? 'パート不参加 (OFF)'
                        : `${activeCount} notes`}
                    </span>
                  </div>
                </div>

                <div className="card-actions">
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
                    disabled={cell.locked || !member.enabled}
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

              <TakeSelector
                selectedTake={cell.selectedTake}
                locked={cell.locked}
                autoTacet={autoTacet}
                disabled={!member.enabled}
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
                            disabled={cell.locked || !member.enabled}
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
                            disabled={cell.locked || !member.enabled}
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
            </article>
          );
        })}
      </div>
    </div>
  );
}
