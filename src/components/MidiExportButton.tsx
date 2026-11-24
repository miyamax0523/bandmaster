import { useMemo, useState } from 'react';
import type { ExportTarget, SongConfig } from '../types/song';
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

export function MidiExportButton({ song, bandState }: MidiExportButtonProps) {
  const [exportTarget, setExportTarget] = useState<ExportTarget>(
    'cubase_smf_expressive'
  );

  const exportable = useMemo(
    () => canExportMidi(song, bandState),
    [song, bandState]
  );

  const handleDownload = () => {
    if (!exportable) return;
    const { bytes } = exportMultiTrackMidi(song, bandState, { exportTarget });
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const safeTitle =
      song.title.trim().replace(/[\\/:*?"<>|]/g, '_') || 'bandmaster_song';
    const suffix = exportTarget === 'voisona_clean_smf' ? '_voisona' : '';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}${suffix}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="midi-export-group">
      <select
        className="midi-export-select"
        aria-label="MIDI書き出しモード"
        value={exportTarget}
        disabled={!exportable}
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
        onClick={handleDownload}
        title={
          exportable
            ? exportTarget === 'voisona_clean_smf'
              ? 'VoiSona向けクリーン楽譜SMF（PBなし・微細隙間レガート結合）を書き出し'
              : 'Cubase / シンセ向け表情付きSMF（RPN＋14-bitフォールPB付き）を書き出し'
            : '有効な演奏ノートが0個のため書き出せません'
        }
      >
        ⬇ MIDI書き出し (.mid)
      </button>
    </div>
  );
}
