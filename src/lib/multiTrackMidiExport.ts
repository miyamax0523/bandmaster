import {
  PPQ,
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type ExportTarget,
  type MidiControlChangeEvent,
  type SongConfig,
} from '../types/song';
import type { BandState, ResolvedNote } from '../types/track';
import { sanitizeTrackNotes } from '../engines/musicCore';
import {
  adaptNotesForExportTarget,
  toGeneratedVocalNotes,
  type GeneratedVocalNote,
  type PitchBendEvent,
} from '../engines/vocalEngine';
import {
  buildMidiFile,
  buildMTrk,
  createControlChangeEvent,
  createKeySignatureEvent,
  createMarkerEvent,
  createNoteOffEvent,
  createNoteOnEvent,
  createPitchBendEvent,
  createPitchBendSensitivityRpnEvents,
  createProgramChangeEvent,
  createTempoEvent,
  createTimeSignatureEvent,
  createTrackNameEvent,
  isAsciiString,
  keyToSharpsFlats,
  type MidiTrackEvent,
} from './midiWriter';
import { countTotalActiveNotes, selectSongTracks } from './noteSelector';

export interface MidiExportTrackSpec {
  name: string;
  channel: number;
  program?: number;
  keySignature?: { sf: number; mi: 0 | 1 };
  rpnBendRangeSemitones?: 2 | 4;
  pitchBends?: PitchBendEvent[];
  controlChanges?: MidiControlChangeEvent[];
  sanitizeOverlap?: boolean;
  notes: Array<{
    pitch: number;
    velocity: number;
    startTick: number;
    durationTicks: number;
  }>;
}

export interface MultiTrackMidiExportOptions {
  exportTarget?: ExportTarget;
}

export interface MultiTrackMidiExportResult {
  bytes: Uint8Array;
  ntrks: number;
  trackNames: string[];
  totalNotes: number;
  exportTarget: ExportTarget;
  vocalPitchBends: PitchBendEvent[];
}

function buildConductorTrack(song: SongConfig): Uint8Array {
  const { sf, mi } = keyToSharpsFlats(song.key, song.scale);
  const events: MidiTrackEvent[] = [
    createTrackNameEvent(0, 'Conductor'),
    createTempoEvent(0, song.bpm),
    createTimeSignatureEvent(0, 4, 2, 24, 8),
    createKeySignatureEvent(0, sf, mi),
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
  if (spec.keySignature !== undefined) {
    events.push(
      createKeySignatureEvent(0, spec.keySignature.sf, spec.keySignature.mi)
    );
  }
  if (spec.program !== undefined) {
    events.push(createProgramChangeEvent(0, spec.channel, spec.program));
  }
  if (spec.rpnBendRangeSemitones !== undefined) {
    events.push(
      ...createPitchBendSensitivityRpnEvents(
        0,
        spec.channel,
        spec.rpnBendRangeSemitones,
        0
      )
    );
  }
  if (spec.pitchBends && spec.pitchBends.length > 0) {
    for (const pb of spec.pitchBends) {
      events.push(createPitchBendEvent(pb.tick, spec.channel, pb.value14Bit, 5));
    }
  }
  if (spec.controlChanges && spec.controlChanges.length > 0) {
    for (const cc of spec.controlChanges) {
      events.push(
        createControlChangeEvent(cc.tick, spec.channel, cc.controller, cc.value, 5)
      );
    }
  }

  const notesToWrite = spec.sanitizeOverlap
    ? sanitizeTrackNotes(
        spec.notes.map((n) => ({ ...n, channel: spec.channel })),
        5
      )
    : spec.notes;

  for (const n of notesToWrite) {
    const start = Math.max(0, Math.round(n.startTick));
    const end = start + Math.max(1, Math.round(n.durationTicks));
    events.push(createNoteOnEvent(start, spec.channel, n.pitch, n.velocity));
    events.push(createNoteOffEvent(end, spec.channel, n.pitch));
  }

  return buildMTrk(events);
}

export function buildVocalSmfTrack(
  rawVocalNotes: readonly GeneratedVocalNote[],
  target: ExportTarget,
  channel: number = TRACK_CHANNELS.vocal,
  program = 53
): {
  chunk: Uint8Array;
  adaptedNotes: GeneratedVocalNote[];
  pitchBends: PitchBendEvent[];
  bendRangeSemitones?: 2 | 4;
} {
  let normalizedInput = rawVocalNotes;
  let bendRangeSemitones: 2 | 4 | undefined;

  if (target === 'cubase_smf_expressive') {
    const has4 = rawVocalNotes.some(
      (n) => n.hasFall && n.fallConfig?.bendRangeSemitones === 4
    );
    const hasAnyFall = rawVocalNotes.some((n) => n.hasFall && n.fallConfig);
    bendRangeSemitones = has4
      ? 4
      : hasAnyFall
        ? (rawVocalNotes.find((n) => n.fallConfig)?.fallConfig?.bendRangeSemitones ?? 2)
        : 2;

    normalizedInput = rawVocalNotes.map((n) =>
      n.hasFall && n.fallConfig && n.fallConfig.bendRangeSemitones !== bendRangeSemitones
        ? {
            ...n,
            fallConfig: {
              ...n.fallConfig,
              bendRangeSemitones: bendRangeSemitones!,
            },
          }
        : n
    );
  }

  const { notes: adaptedNotes, pitchBends } = adaptNotesForExportTarget(
    normalizedInput,
    target
  );

  const spec: MidiExportTrackSpec = {
    name: 'Vocal',
    channel,
    program,
    keySignature: target === 'voisona_clean_smf' ? { sf: 0, mi: 0 } : undefined,
    rpnBendRangeSemitones:
      target === 'cubase_smf_expressive' ? bendRangeSemitones : undefined,
    pitchBends: target === 'cubase_smf_expressive' ? pitchBends : undefined,
    notes: adaptedNotes.map((n) => ({
      pitch: n.midiPitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: n.gateDuration,
    })),
  };

  return {
    chunk: buildPerformanceTrack(spec),
    adaptedNotes,
    pitchBends,
    bendRangeSemitones,
  };
}

export function canExportMidi(song: SongConfig, bandState: BandState): boolean {
  const tracks = selectSongTracks(song, bandState);
  return countTotalActiveNotes(tracks) > 0;
}

export function exportMultiTrackMidi(
  song: SongConfig,
  bandState: BandState,
  options?: MultiTrackMidiExportOptions
): MultiTrackMidiExportResult {
  const exportTarget: ExportTarget =
    options?.exportTarget ?? 'cubase_smf_expressive';
  const tracks = selectSongTracks(song, bandState);

  // Adapt Vocal track according to exportTarget (Cubase Expressive PB vs VoiSona Clean Legato)
  const rawGenVocal = toGeneratedVocalNotes(tracks.vocal);
  let vocalBendRange: 2 | 4 | undefined;
  let normalizedGenVocal = rawGenVocal;
  if (exportTarget === 'cubase_smf_expressive') {
    const has4 = rawGenVocal.some(
      (n) => n.hasFall && n.fallConfig?.bendRangeSemitones === 4
    );
    const vocalGenreHint = `${song.sections[0]?.patternPresets?.vocal ?? ''} ${song.members.vocal?.patternPreset ?? ''} ${song.title ?? ''}`.toLowerCase();
    const genreDefaultBendRange: 2 | 4 =
      vocalGenreHint.includes('shoegaze') ||
      vocalGenreHint.includes('deftones') ||
      vocalGenreHint.includes('mixture') ||
      vocalGenreHint.includes('linkin')
        ? 4
        : 2;
    vocalBendRange = has4
      ? 4
      : (rawGenVocal.find((n) => n.fallConfig)?.fallConfig?.bendRangeSemitones ??
        genreDefaultBendRange);
    normalizedGenVocal = rawGenVocal.map((n) =>
      n.hasFall && n.fallConfig && n.fallConfig.bendRangeSemitones !== vocalBendRange
        ? {
            ...n,
            fallConfig: { ...n.fallConfig, bendRangeSemitones: vocalBendRange! },
          }
        : n
    );
  }

  const { notes: adaptedVocal, pitchBends: vocalPitchBends } =
    adaptNotesForExportTarget(normalizedGenVocal, exportTarget);

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
    controlChanges: tracks.controlChanges?.bass,
    sanitizeOverlap: true,
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
    controlChanges: tracks.controlChanges?.keyboard,
    sanitizeOverlap: true,
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
    controlChanges: tracks.controlChanges?.pad,
    sanitizeOverlap: true,
    notes: tracks.pad.map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: n.durationTicks,
    })),
  });

  const songKeySig = keyToSharpsFlats(song.key, song.scale);

  specs.push({
    name: 'Vocal',
    channel: TRACK_CHANNELS.vocal,
    program: 53, // Voice Oohs
    keySignature: exportTarget === 'voisona_clean_smf' ? songKeySig : undefined,
    rpnBendRangeSemitones:
      exportTarget === 'cubase_smf_expressive' && adaptedVocal.length > 0
        ? vocalBendRange
        : undefined,
    pitchBends:
      exportTarget === 'cubase_smf_expressive' ? vocalPitchBends : undefined,
    notes: adaptedVocal.map((n) => ({
      pitch: n.midiPitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: n.gateDuration,
    })),
  });

  if (tracks.vocalHarmony.length > 0) {
    // When exporting for VoiSona clean score, align Vocal Harmony durations cleanly as well
    const adaptedHarmony =
      exportTarget === 'voisona_clean_smf'
        ? adaptNotesForExportTarget(
            toGeneratedVocalNotes(tracks.vocalHarmony),
            'voisona_clean_smf'
          ).notes.map((n) => ({
            pitch: n.midiPitch,
            velocity: n.velocity,
            startTick: n.startTick,
            durationTicks: n.gateDuration,
          }))
        : tracks.vocalHarmony.map((n) => ({
            pitch: n.pitch,
            velocity: n.velocity,
            startTick: n.startTick,
            durationTicks: n.durationTicks,
          }));

    specs.push({
      name: 'Vocal Harmony',
      channel: TRACK_CHANNELS.vocalHarmony,
      program: 53, // Voice Oohs
      keySignature: exportTarget === 'voisona_clean_smf' ? songKeySig : undefined,
      notes: adaptedHarmony,
    });
  }

  const totalNotes = specs.reduce((sum, s) => sum + s.notes.length, 0);

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
    exportTarget,
    vocalPitchBends: exportTarget === 'cubase_smf_expressive' ? vocalPitchBends : [],
  };
}
