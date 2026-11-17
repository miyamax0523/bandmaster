import { useEffect, useRef, useState } from 'react';
import type { LogicalTrackType, SongConfig } from '../types/song';
import type { BandState } from '../types/track';
import {
  AudioPreviewEngine,
  type AudioPreviewState,
} from '../lib/audioPreview';
import {
  getSectionSpans,
  getTotalSongTicks,
  selectSongTracks,
  type SectionSpan,
} from '../lib/noteSelector';

export function useAudioPreview(song: SongConfig, bandState: BandState) {
  const engineRef = useRef<AudioPreviewEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new AudioPreviewEngine();
  }

  const [previewState, setPreviewState] = useState<AudioPreviewState>(() =>
    engineRef.current!.getState()
  );

  useEffect(() => {
    const engine = engineRef.current!;
    const unsub = engine.subscribe(setPreviewState);

    const onVisibility = () => {
      engine.handleVisibilityChange(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVisibility);
      engine.dispose();
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current!;
    const tracks = selectSongTracks(song, bandState);
    const totalTicks = getTotalSongTicks(song);
    engine.loadSongData(tracks, song.bpm, totalTicks);
  }, [song, bandState]);

  const spans = getSectionSpans(song);

  return {
    previewState,
    sectionSpans: spans,
    play: () => engineRef.current!.play(),
    pause: () => engineRef.current!.pause(),
    stop: () => engineRef.current!.stop(),
    seek: (tick: number) => engineRef.current!.seek(tick),
    setSectionLoop: (span: SectionSpan | null) =>
      engineRef.current!.setSectionLoop(span),
    setTrackMute: (track: LogicalTrackType, muted: boolean) =>
      engineRef.current!.setTrackMute(track, muted),
    setTrackSolo: (track: LogicalTrackType, solo: boolean) =>
      engineRef.current!.setTrackSolo(track, solo),
    setTrackVolume: (track: LogicalTrackType, vol: number) =>
      engineRef.current!.setTrackVolume(track, vol),
  };
}
