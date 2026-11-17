import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export type PlaybackMode = 'song' | 'section';

export function useAudioPreview(
  song: SongConfig,
  bandState: BandState,
  activeSectionId: string
) {
  const engineRef = useRef<AudioPreviewEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new AudioPreviewEngine();
  }

  const [previewState, setPreviewState] = useState<AudioPreviewState>(() =>
    engineRef.current!.getState()
  );
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('song');

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

  const spans = useMemo(() => getSectionSpans(song), [song]);

  useEffect(() => {
    const engine = engineRef.current!;
    if (playbackMode === 'section') {
      const target =
        spans.find((s) => s.sectionId === activeSectionId) ?? spans[0] ?? null;
      engine.setSectionLoop(target);
    } else {
      engine.setSectionLoop(null);
    }
  }, [playbackMode, activeSectionId, spans]);

  const previewSection = useCallback(
    (sectionId: string) => {
      const target =
        spans.find((s) => s.sectionId === sectionId) ?? spans[0] ?? null;
      if (!target) return;
      setPlaybackMode('section');
      void engineRef.current!.playSection(target);
    },
    [spans]
  );

  const switchPlaybackMode = useCallback(
    (mode: PlaybackMode) => {
      setPlaybackMode(mode);
      const engine = engineRef.current!;
      if (mode === 'section') {
        const target =
          spans.find((s) => s.sectionId === activeSectionId) ?? spans[0] ?? null;
        engine.setSectionLoop(target);
      } else {
        engine.setSectionLoop(null);
      }
    },
    [spans, activeSectionId]
  );

  return {
    previewState,
    playbackMode,
    sectionSpans: spans,
    setPlaybackMode: switchPlaybackMode,
    previewSection,
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
