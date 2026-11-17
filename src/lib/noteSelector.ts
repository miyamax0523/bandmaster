import {
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type InstrumentType,
  type LogicalTrackType,
  type MidiNote,
  type Section,
  type SongConfig,
} from '../types/song';
import type { BandState, LogicalTracks, ResolvedNote } from '../types/track';

export function isSectionActiveForAutoTacet(section: Section): boolean {
  return (
    section.type === 'Chorus' ||
    section.type === 'Bridge' ||
    section.energy === 'High'
  );
}

export function isAutoTacet(
  song: SongConfig,
  section: Section,
  instrument: InstrumentType
): boolean {
  const member = song.members[instrument];
  return member.enabled && member.activeSectionsOnly && !isSectionActiveForAutoTacet(section);
}

export function applySwingToTick(
  tick: number,
  swing: number,
  swingTarget: '8th' | '16th'
): number {
  if (swing <= 0) return tick;
  if (swingTarget === '8th') {
    if (tick % 480 === 240) {
      return tick + Math.round((swing / 100) * 240);
    }
    return tick;
  }
  // '16th'
  if (tick % 240 === 120) {
    return tick + Math.round((swing / 100) * 120);
  }
  return tick;
}

export interface SectionSpan {
  sectionId: string;
  sectionIndex: number;
  startTick: number;
  endTick: number;
}

export function getSectionSpans(song: SongConfig): SectionSpan[] {
  const spans: SectionSpan[] = [];
  let cursor = 0;
  for (let i = 0; i < song.sections.length; i++) {
    const sec = song.sections[i];
    const len = sec.bars * TICKS_PER_BAR;
    spans.push({
      sectionId: sec.id,
      sectionIndex: i,
      startTick: cursor,
      endTick: cursor + len,
    });
    cursor += len;
  }
  return spans;
}

export function getTotalSongTicks(song: SongConfig): number {
  return song.sections.reduce(
    (sum, sec) => sum + sec.bars * TICKS_PER_BAR,
    0
  );
}

/**
 * Single shared pipeline for both Web Audio Preview and Multi-Track MIDI Export.
 * Strictly follows §6-1 / §12-1 execution order:
 * 1. resolveSongTracks (enabled / OFF / Auto Tacet mask)
 * 2. Swing application (Drums/Bass/Keyboard only; excludes PAD, external loop drums, unison sections)
 * 3. Unconditional logical 808 separation (regardless of split808KickTrack)
 * 4. 808 midiDurationTicks computation
 * 5. Filter out startTick >= sectionEnd & re-clip durations
 * 6. Absolute tick concatenation & channel normalization
 */
export function selectSongTracks(
  song: SongConfig,
  bandState: BandState
): LogicalTracks {
  const output: LogicalTracks = {
    drums: [],
    kick808: [],
    bass: [],
    keyboard: [],
    pad: [],
  };

  let sectionStartTick = 0;

  for (const section of song.sections) {
    const sectionEnd = section.bars * TICKS_PER_BAR;
    const cells = bandState.cellsBySection[section.id];

    // Step 1: resolveSongTracks
    const resolveInstrumentNotes = (inst: InstrumentType): MidiNote[] => {
      if (!cells) return [];
      const member = song.members[inst];
      if (!member.enabled) return [];
      const cell = cells[inst];
      if (!cell || cell.selectedTake === 'OFF') return [];
      if (isAutoTacet(song, section, inst)) return [];
      const raw = cell.takes[cell.selectedTake] ?? [];
      return raw.map((n) => ({ ...n }));
    };

    let drumsNotes = resolveInstrumentNotes('drums');
    let bassNotes = resolveInstrumentNotes('bass');
    let keyboardNotes = resolveInstrumentNotes('keyboard');
    const padNotes = resolveInstrumentNotes('pad');

    // Step 2: Swing application
    const hasUnisonRiff = Boolean(section.unisonRiff);
    const hasExternalDrumLoop = Boolean(
      section.uploadedDrumLoop ?? song.uploadedDrumLoop
    );

    if (song.swing > 0 && !hasUnisonRiff) {
      if (!hasExternalDrumLoop) {
        drumsNotes = drumsNotes.map((n) => ({
          ...n,
          startTick: applySwingToTick(n.startTick, song.swing, song.swingTarget),
        }));
      }
      bassNotes = bassNotes.map((n) => ({
        ...n,
        startTick: applySwingToTick(n.startTick, song.swing, song.swingTarget),
      }));
      keyboardNotes = keyboardNotes.map((n) => ({
        ...n,
        startTick: applySwingToTick(n.startTick, song.swing, song.swingTarget),
      }));
    }

    // Step 3: Unconditional logical 808 Kick separation
    interface TempNote extends MidiNote {
      midiDurationTicks?: number;
    }

    let logicalDrums: TempNote[] = [];
    let logicalKick808: TempNote[] = [];

    if (section.kickMode === '808') {
      for (const n of drumsNotes) {
        if (n.pitch === 36) {
          logicalKick808.push({ ...n });
        } else {
          logicalDrums.push({ ...n });
        }
      }
    } else {
      logicalDrums = drumsNotes.map((n) => ({ ...n }));
    }

    // Step 4: 808 midiDurationTicks calculation
    if (logicalKick808.length > 0) {
      logicalKick808.sort((a, b) => a.startTick - b.startTick);
      for (let i = 0; i < logicalKick808.length; i++) {
        const curr = logicalKick808[i];
        if (i + 1 < logicalKick808.length) {
          const nextStart = logicalKick808[i + 1].startTick;
          curr.midiDurationTicks = Math.max(1, nextStart - curr.startTick - 10);
        } else {
          curr.midiDurationTicks = 960;
        }
      }
    }

    // Step 5 & 6: Section end truncation/re-clip, absolute tick concat, channel normalization
    const finalizeTrack = (
      notes: readonly TempNote[],
      trackType: LogicalTrackType
    ) => {
      const ch = TRACK_CHANNELS[trackType];
      for (const n of notes) {
        const localStart = n.startTick < 0 ? 0 : Math.round(n.startTick);
        if (localStart >= sectionEnd) continue;

        const clippedDur = Math.max(
          1,
          Math.min(Math.round(n.durationTicks), sectionEnd - localStart)
        );
        const resolved: ResolvedNote = {
          pitch: Math.min(127, Math.max(0, Math.round(n.pitch))),
          velocity: Math.min(127, Math.max(1, Math.round(n.velocity))),
          startTick: sectionStartTick + localStart,
          durationTicks: clippedDur,
          channel: ch,
        };
        if (n.midiDurationTicks !== undefined) {
          resolved.midiDurationTicks = Math.max(
            1,
            Math.min(Math.round(n.midiDurationTicks), sectionEnd - localStart)
          );
        }
        output[trackType].push(resolved);
      }
    };

    finalizeTrack(logicalDrums, 'drums');
    finalizeTrack(logicalKick808, 'kick808');
    finalizeTrack(bassNotes, 'bass');
    finalizeTrack(keyboardNotes, 'keyboard');
    finalizeTrack(padNotes, 'pad');

    sectionStartTick += sectionEnd;
  }

  // Sort every logical track deterministically
  for (const key of Object.keys(output) as LogicalTrackType[]) {
    output[key].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  }

  return output;
}

export function countTotalActiveNotes(tracks: LogicalTracks): number {
  return (
    tracks.drums.length +
    tracks.kick808.length +
    tracks.bass.length +
    tracks.keyboard.length +
    tracks.pad.length
  );
}
