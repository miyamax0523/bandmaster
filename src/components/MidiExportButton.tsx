import { useMemo } from 'react';
import type { SongConfig } from '../types/song';
import type { BandState } from '../types/track';
import {
  canExportMidi,
  exportMultiTrackMidi,
} from '../lib/multiTrackMidiExport';

interface MidiExportButtonProps {
  song: SongConfig;
  bandState: BandState;
}

export function MidiExportButton({ song, bandState }: MidiExportButtonProps) {
  const exportable = useMemo(
    () => canExportMidi(song, bandState),
    [song, bandState]
  );

  const handleDownload = () => {
    if (!exportable) return;
    const { bytes } = exportMultiTrackMidi(song, bandState);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const safeTitle =
      song.title.trim().replace(/[\\/:*?"<>|]/g, '_') || 'bandmaster_song';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <button
      type="button"
      className="btn btn-export"
      disabled={!exportable}
      onClick={handleDownload}
      title={
        exportable
          ? 'Format 1 マルチトラックMIDIを書き出し'
          : '有効な演奏ノートが0個のため書き出せません'
      }
    >
      ⬇ MIDI書き出し (.mid)
    </button>
  );
}
