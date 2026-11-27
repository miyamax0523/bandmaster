import { useMemo, useState } from 'react';
import type { ExportTarget, PartId, SongConfig } from '../types/song';
import type { BandState } from '../types/track';
import {
  canExportMidi,
  exportMultiTrackMidi,
} from '../lib/midiExport';

interface MidiExportButtonProps {
  song: SongConfig;
  bandState: BandState;
}

const EXPORT_TARGET_OPTIONS: ReadonlyArray<{
  value: ExportTarget;
  label: string;
}> = [
  {
    value: 'cubase_smf_expressive',
    label: 'Cubase / シンセ用（表情付き）',
  },
  {
    value: 'voisona_clean_smf',
    label: 'VoiSona 用（クリーン楽譜）',
  },
];

const PART_CHECKBOX_ITEMS: ReadonlyArray<{ id: PartId; label: string }> = [
  { id: 'drums', label: 'Drums' },
  { id: 'bass', label: 'Bass' },
  { id: 'vocal', label: 'Vocal' },
  { id: 'keyboard', label: 'Keys' },
  { id: 'pad', label: 'PAD' },
];

const DEFAULT_INCLUDED_PARTS: Record<PartId, boolean> = {
  drums: true,
  bass: true,
  vocal: true,
  keyboard: true,
  pad: true,
};

export function MidiExportButton({ song, bandState }: MidiExportButtonProps) {
  const [exportTarget, setExportTarget] = useState<ExportTarget>(
    'cubase_smf_expressive'
  );
  const [includedParts, setIncludedParts] = useState<Record<PartId, boolean>>(
    DEFAULT_INCLUDED_PARTS
  );

  const selectedCount = useMemo(
    () => PART_CHECKBOX_ITEMS.filter((p) => includedParts[p.id]).length,
    [includedParts]
  );
  const isVoisonaMode = exportTarget === 'voisona_clean_smf';

  const exportable = useMemo(
    () =>
      selectedCount > 0 &&
      canExportMidi(song, bandState, {
        includedParts,
      }),
    [song, bandState, includedParts, selectedCount]
  );

  const triggerDownload = (target: ExportTarget) => {
    if (!exportable) return;
    const { bytes } = exportMultiTrackMidi(song, bandState, {
      exportTarget: target,
      includedParts,
    });
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const safeTitle =
      song.title.trim().replace(/[\\/:*?"<>|]/g, '_') || 'bandmaster_song';
    const suffix = target === 'voisona_clean_smf' ? '_voisona' : '';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}${suffix}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const togglePart = (id: PartId) => {
    setIncludedParts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const applyPreset = (preset: 'all' | 'vocal_only' | 'rhythm' | 'backing') => {
    if (preset === 'all') {
      setIncludedParts({
        drums: true,
        bass: true,
        vocal: true,
        keyboard: true,
        pad: true,
      });
    } else if (preset === 'vocal_only') {
      setIncludedParts({
        drums: false,
        bass: false,
        vocal: true,
        keyboard: false,
        pad: false,
      });
    } else if (preset === 'rhythm') {
      setIncludedParts({
        drums: true,
        bass: true,
        vocal: false,
        keyboard: false,
        pad: false,
      });
    } else {
      setIncludedParts({
        drums: true,
        bass: true,
        vocal: false,
        keyboard: true,
        pad: true,
      });
    }
  };

  return (
    <div
      className="midi-export-group"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}
    >
      {/* Common part selection checkboxes & quick presets shared by DAW & VoiSona export */}
      <div
        role="group"
        aria-label="書き出しパート選択（DAW / VoiSona 共通）"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.45rem',
          flexWrap: 'wrap',
          fontSize: '0.82rem',
        }}
      >
        {PART_CHECKBOX_ITEMS.map((part) => (
          <label
            key={part.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.22rem',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={includedParts[part.id]}
              onChange={() => togglePart(part.id)}
            />
            <span>{part.label}</span>
          </label>
        ))}

        <span style={{ opacity: 0.4 }}>|</span>

        <button
          type="button"
          className="chip-btn"
          style={{ fontSize: '0.74rem', padding: '0.15rem 0.45rem' }}
          onClick={() => applyPreset('all')}
        >
          全選択
        </button>
        <button
          type="button"
          className="chip-btn"
          style={{ fontSize: '0.74rem', padding: '0.15rem 0.45rem' }}
          onClick={() => applyPreset('vocal_only')}
        >
          Vocalのみ（VoiSona基本）
        </button>
        <button
          type="button"
          className="chip-btn"
          style={{ fontSize: '0.74rem', padding: '0.15rem 0.45rem' }}
          onClick={() => applyPreset('rhythm')}
        >
          リズム隊 (Dr+Ba)
        </button>
        <button
          type="button"
          className="chip-btn"
          style={{ fontSize: '0.74rem', padding: '0.15rem 0.45rem' }}
          onClick={() => applyPreset('backing')}
        >
          伴奏のみ (Vocal除外)
        </button>

        {selectedCount === 0 && (
          <span className="error-text" role="alert" style={{ margin: 0 }}>
            書き出すパートを1つ以上選択してください
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
        <select
          className="midi-export-select"
          aria-label="MIDI書き出しモード"
          value={exportTarget}
          onChange={(e) => setExportTarget(e.target.value as ExportTarget)}
        >
          {EXPORT_TARGET_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-export"
          disabled={!exportable}
          onClick={() => triggerDownload(exportTarget)}
          title={
            selectedCount === 0
              ? '書き出すパートを1つ以上選択してください'
              : exportable
                ? isVoisonaMode
                  ? '選択パートをVoiSona向けクリーン楽譜SMF（60 ticks整列・調号付き）で書き出し'
                  : '選択パートをCubase / シンセ向け表情付きSMF（Conductor付き）で書き出し'
                : '選択パートに有効な演奏ノートが0個のため書き出せません'
          }
        >
          ⬇ MIDI書き出し (.mid)
        </button>
      </div>
    </div>
  );
}
