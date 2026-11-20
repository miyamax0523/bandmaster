import {
  PPQ,
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type SongConfig,
} from '../types/song';
import type { BandState, ResolvedNote } from '../types/track';
import {
  buildMidiFile,
  buildMTrk,
  createMarkerEvent,
  createNoteOffEvent,
  createNoteOnEvent,
  createProgramChangeEvent,
  createTempoEvent,
  createTimeSignatureEvent,
  createTrackNameEvent,
  isAsciiString,
  type MidiTrackEvent,
} from './midiWriter';
import { countTotalActiveNotes, selectSongTracks } from './noteSelector';

export interface MidiExportTrackSpec {
  name: string;
  channel: number;
  program?: number;
  notes: Array<{
    pitch: number;
    velocity: number;
    startTick: number;
    durationTicks: number;
  }>;
}

export interface MultiTrackMidiExportResult {
  bytes: Uint8Array;
  ntrks: number;
  trackNames: string[];
  totalNotes: number;
}

function buildConductorTrack(song: SongConfig): Uint8Array {
  const events: MidiTrackEvent[] = [
    createTrackNameEvent(0, 'Conductor'),
    createTempoEvent(0, song.bpm),
    createTimeSignatureEvent(0, 4, 2, 24, 8),
  ];

  const typeCounts = new Map<string, number>();
  let cursorTick = 0;

  for (const section of song.sections) {
    const count = (typeCounts.get(section.type) ?? 0) + 1;
    typeCounts.set(section.type, count);

    const trimmed = section.name.trim();
    const markerLabel =
      trimmed.length > 0 && isAsciiString(trimmed)
        ? trimmed
        : `${section.type} ${count}`;

    events.push(createMarkerEvent(cursorTick, markerLabel));
    cursorTick += section.bars * TICKS_PER_BAR;
  }

  return buildMTrk(events);
}

function buildPerformanceTrack(spec: MidiExportTrackSpec): Uint8Array {
  const events: MidiTrackEvent[] = [createTrackNameEvent(0, spec.name)];
  if (spec.program !== undefined) {
    events.push(createProgramChangeEvent(0, spec.channel, spec.program));
  }

  for (const n of spec.notes) {
    const start = Math.max(0, Math.round(n.startTick));
    const end = start + Math.max(1, Math.round(n.durationTicks));
    events.push(createNoteOnEvent(start, spec.channel, n.pitch, n.velocity));
    events.push(createNoteOffEvent(end, spec.channel, n.pitch));
  }

  return buildMTrk(events);
}

export function canExportMidi(song: SongConfig, bandState: BandState): boolean {
  const tracks = selectSongTracks(song, bandState);
  return countTotalActiveNotes(tracks) > 0;
}

export function exportMultiTrackMidi(
  song: SongConfig,
  bandState: BandState
): MultiTrackMidiExportResult {
  const tracks = selectSongTracks(song, bandState);
  const totalNotes = countTotalActiveNotes(tracks);

  const specs: MidiExportTrackSpec[] = [];

  if (song.split808KickTrack) {
    specs.push({
      name: 'Drums',
      channel: TRACK_CHANNELS.drums,
      notes: tracks.drums.map((n) => ({
        pitch: n.pitch,
        velocity: n.velocity,
        startTick: n.startTick,
        durationTicks: n.durationTicks,
      })),
    });
    specs.push({
      name: '808 Kick',
      channel: TRACK_CHANNELS.kick808,
      program: 118, // Synth Drum
      notes: tracks.kick808.map((n) => ({
        pitch: n.pitch,
        velocity: n.velocity,
        startTick: n.startTick,
        durationTicks: n.midiDurationTicks ?? n.durationTicks,
      })),
    });
  } else {
    // Re-merge 808 kick into Drums (ch 9) with original durationTicks (no long-note extension)
    const mergedDrums: ResolvedNote[] = [
      ...tracks.drums,
      ...tracks.kick808.map((n) => ({
        ...n,
        channel: TRACK_CHANNELS.drums,
      })),
    ].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

    specs.push({
      name: 'Drums',
      channel: TRACK_CHANNELS.drums,
      notes: mergedDrums.map((n) => ({
        pitch: n.pitch,
        velocity: n.velocity,
        startTick: n.startTick,
        durationTicks: n.durationTicks,
      })),
    });
  }

  specs.push({
    name: 'Bass',
    channel: TRACK_CHANNELS.bass,
    program: 33, // Electric Bass (finger)
    notes: tracks.bass.map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: n.durationTicks,
    })),
  });

  specs.push({
    name: 'Keyboard',
    channel: TRACK_CHANNELS.keyboard,
    program: 0, // Acoustic Grand Piano
    notes: tracks.keyboard.map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: n.durationTicks,
    })),
  });

  specs.push({
    name: 'PAD',
    channel: TRACK_CHANNELS.pad,
    program: 89, // Pad 2 (warm)
    notes: tracks.pad.map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: n.durationTicks,
    })),
  });

  specs.push({
    name: 'Vocal',
    channel: TRACK_CHANNELS.vocal,
    program: 53, // Voice Oohs
    notes: tracks.vocal.map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: n.durationTicks,
    })),
  });

  if (tracks.vocalHarmony.length > 0) {
    specs.push({
      name: 'Vocal Harmony',
      channel: TRACK_CHANNELS.vocalHarmony,
      program: 53, // Voice Oohs
      notes: tracks.vocalHarmony.map((n) => ({
        pitch: n.pitch,
        velocity: n.velocity,
        startTick: n.startTick,
        durationTicks: n.durationTicks,
      })),
    });
  }

  const activeSpecs = song.exportOnlyActiveTracks
    ? specs.filter((s) => s.notes.length > 0)
    : specs;

  const conductorChunk = buildConductorTrack(song);
  const perfChunks = activeSpecs.map(buildPerformanceTrack);
  const allChunks = [conductorChunk, ...perfChunks];

  return {
    bytes: buildMidiFile(1, allChunks, PPQ),
    ntrks: allChunks.length,
    trackNames: ['Conductor', ...activeSpecs.map((s) => s.name)],
    totalNotes,
  };
}
