import { generateVocalHarmonyNotes } from '../engines/vocalEngine';
import {
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type InstrumentType,
  type LogicalTrackType,
  type MidiControlChangeEvent,
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

export function isSectionPartEnabled(
  section: Section,
  instrument: InstrumentType
): boolean {
  return section.enabledParts?.[instrument] ?? true;
}

export function isAutoTacet(
  song: SongConfig,
  section: Section,
  instrument: InstrumentType
): boolean {
  const member = song.members[instrument];
  return (
    Boolean(member?.enabled) &&
    isSectionPartEnabled(section, instrument) &&
    Boolean(member?.activeSectionsOnly) &&
    !isSectionActiveForAutoTacet(section)
  );
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

export function findSectionSpanAtTick(
  spans: readonly SectionSpan[],
  tick: number
): SectionSpan | null {
  if (spans.length === 0) return null;
  if (tick <= spans[0].startTick) return spans[0];
  for (const span of spans) {
    if (tick >= span.startTick && tick < span.endTick) {
      return span;
    }
  }
  return spans[spans.length - 1];
}

export function getTotalSongTicks(song: SongConfig): number {
  return song.sections.reduce(
    (sum, sec) => sum + sec.bars * TICKS_PER_BAR,
    0
  );
}

/**
 * Resolves a section's optional anacrusis pickup (-240 ticks / anacrusisLeadTicks)
 * non-destructively against the preceding section's final vocal note.
 * NEVER truncates or alters notes in prior sections:
 * - Adopts the pickup only when sectionIndex >= 1 and >= 480 ticks of trailing silence precede sectionStartTick.
 * - Otherwise falls back cleanly to startTick >= 0 while preserving 60-tick quantization and zero overlap.
 */
export function resolveSectionVocalAnacrusis(
  vocalNotes: readonly MidiNote[],
  sectionIndex: number,
  sectionStartTick: number,
  sectionEnd: number,
  prevVocalLastEndTick: number | null
): MidiNote[] {
  if (vocalNotes.length === 0) return [];
  const notes = vocalNotes
    .map((n) => ({ ...n }))
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  const first = notes[0];
  const literalLead = first.startTick < 0 ? Math.max(60, Math.round(-first.startTick)) : 0;
  const metaLead =
    first.startTick === 0 && (first.anacrusisLeadTicks ?? 0) > 0
      ? Math.max(60, Math.round(first.anacrusisLeadTicks!))
      : 0;
  const leadTicks = literalLead > 0 ? literalLead : metaLead;

  if (leadTicks <= 0) {
    return notes;
  }

  delete first.anacrusisLeadTicks;

  const canAdopt =
    sectionIndex >= 1 &&
    sectionStartTick >= leadTicks &&
    (prevVocalLastEndTick === null || sectionStartTick - prevVocalLastEndTick >= 480);

  const nextStart = notes.length > 1 ? notes[1].startTick : sectionEnd;

  if (canAdopt) {
    const newStart = -leadTicks;
    const rawDur =
      literalLead > 0 ? Math.round(first.durationTicks) : Math.round(first.durationTicks) + leadTicks;
    const maxAvail = Math.max(60, Math.min(nextStart - newStart, sectionEnd - newStart));
    first.startTick = newStart;
    first.durationTicks = Math.max(60, Math.min(rawDur, maxAvail));
    if (first.gridDurationTicks !== undefined) {
      const rawGrid =
        literalLead > 0
          ? Math.round(first.gridDurationTicks)
          : Math.round(first.gridDurationTicks) + leadTicks;
      first.gridDurationTicks = Math.max(first.durationTicks, Math.min(rawGrid, maxAvail));
    }
    return notes;
  }

  // Fallback: shift/clamp strictly to section start >= 0 (never touch prior section notes)
  if (literalLead > 0) {
    const maxAvail = Math.max(60, Math.min(nextStart, sectionEnd));
    const shiftedDur = Math.max(
      60,
      Math.floor(Math.max(60, first.durationTicks - leadTicks) / 60) * 60
    );
    first.startTick = 0;
    first.durationTicks = Math.min(shiftedDur, maxAvail);
    if (first.gridDurationTicks !== undefined) {
      const shiftedGrid = Math.max(
        60,
        Math.floor(Math.max(60, first.gridDurationTicks - leadTicks) / 60) * 60
      );
      first.gridDurationTicks = Math.max(
        first.durationTicks,
        Math.min(shiftedGrid, maxAvail)
      );
    }
  }
  return notes;
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
    vocal: [],
    vocalHarmony: [],
    controlChanges: {
      bass: [],
      keyboard: [],
      pad: [],
    },
  };

  let sectionStartTick = 0;

  for (let secIdx = 0; secIdx < song.sections.length; secIdx++) {
    const section = song.sections[secIdx];
    const sectionEnd = section.bars * TICKS_PER_BAR;
    const cells = bandState.cellsBySection[section.id];

    // Step 1: resolveSongTracks (respects global enabled, section enabledParts, OFF, Auto Tacet)
    const resolveInstrumentNotes = (inst: InstrumentType): MidiNote[] => {
      const member = song.members[inst];
      if (!member?.enabled) return [];
      if (!isSectionPartEnabled(section, inst)) return [];
      if (!cells) return [];
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
    let vocalNotes = resolveInstrumentNotes('vocal');

    // Step 2: Swing application
    const hasUnisonRiff = Boolean(section.unisonRiff);
    const hasExternalDrumLoop = Boolean(
      section.uploadedDrumLoop ?? song.uploadedDrumLoop
    );
    const hasCustomVocal = Boolean(
      section.vocalMelody && section.vocalMelody.notes.length > 0
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
      if (!hasCustomVocal) {
        vocalNotes = vocalNotes.map((n) => ({
          ...n,
          startTick: applySwingToTick(n.startTick, song.swing, song.swingTarget),
        }));
        vocalNotes.sort((a, b) => a.startTick - b.startTick);
        for (let i = 0; i + 1 < vocalNotes.length; i++) {
          const span = Math.max(1, vocalNotes[i + 1].startTick - vocalNotes[i].startTick);
          if (vocalNotes[i].durationTicks > span) {
            vocalNotes[i].durationTicks = span;
          }
          if (
            vocalNotes[i].gridDurationTicks !== undefined &&
            vocalNotes[i].gridDurationTicks! > span
          ) {
            vocalNotes[i].gridDurationTicks = span;
          }
        }
      }
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
      const allowSectionPreEntry =
        trackType === 'vocal' || trackType === 'vocalHarmony';
      for (const n of notes) {
        let localStart = Math.round(n.startTick);
        if (localStart < 0) {
          localStart = allowSectionPreEntry
            ? Math.max(-sectionStartTick, localStart)
            : 0;
        }
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
        if (n.gridDurationTicks !== undefined) {
          resolved.gridDurationTicks = Math.max(
            1,
            Math.min(Math.round(n.gridDurationTicks), sectionEnd - localStart)
          );
        }
        if (n.role !== undefined) {
          resolved.role = n.role;
        }
        if (n.tag !== undefined) {
          resolved.tag = n.tag;
        }
        if (n.hasFall !== undefined) {
          resolved.hasFall = n.hasFall;
        }
        if (n.fallConfig !== undefined) {
          resolved.fallConfig = { ...n.fallConfig };
        }
        output[trackType].push(resolved);
      }
    };

    const prevVocalLastEndTick =
      output.vocal.length > 0
        ? output.vocal.reduce(
            (maxEnd, n) => Math.max(maxEnd, n.startTick + n.durationTicks),
            0
          )
        : null;

    if (!hasCustomVocal) {
      vocalNotes = resolveSectionVocalAnacrusis(
        vocalNotes,
        secIdx,
        sectionStartTick,
        sectionEnd,
        prevVocalLastEndTick
      );
    }

    const vocalHarmonyNotes = generateVocalHarmonyNotes(
      vocalNotes,
      song.key,
      song.scale,
      section.vocalHarmony ?? 'off'
    );

    finalizeTrack(logicalDrums, 'drums');
    finalizeTrack(logicalKick808, 'kick808');
    finalizeTrack(bassNotes, 'bass');
    finalizeTrack(keyboardNotes, 'keyboard');
    finalizeTrack(padNotes, 'pad');
    finalizeTrack(vocalNotes, 'vocal');
    finalizeTrack(vocalHarmonyNotes, 'vocalHarmony');

    // Collect CC events for bass / keyboard / pad
    for (const inst of ['bass', 'keyboard', 'pad'] as const) {
      const member = song.members[inst];
      if (!member?.enabled || !isSectionPartEnabled(section, inst) || !cells) continue;
      const cell = cells[inst];
      if (!cell || cell.selectedTake === 'OFF' || isAutoTacet(song, section, inst)) continue;
      const ccList = cell.controlChangesByTake?.[cell.selectedTake];
      if (!ccList || ccList.length === 0) continue;
      const ch = TRACK_CHANNELS[inst];
      const target = output.controlChanges![inst] as MidiControlChangeEvent[];
      for (const cc of ccList) {
        const localTick = Math.max(0, Math.min(sectionEnd, Math.round(cc.tick)));
        target.push({
          tick: sectionStartTick + localTick,
          controller: Math.min(127, Math.max(0, Math.round(cc.controller))),
          value: Math.min(127, Math.max(0, Math.round(cc.value))),
          channel: ch,
        });
      }
    }

    sectionStartTick += sectionEnd;
  }

  // Sort every logical track deterministically
  const trackKeys: readonly LogicalTrackType[] = [
    'drums',
    'kick808',
    'bass',
    'keyboard',
    'pad',
    'vocal',
    'vocalHarmony',
  ];
  for (const key of trackKeys) {
    output[key].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  }
  if (output.controlChanges) {
    for (const key of ['bass', 'keyboard', 'pad'] as const) {
      output.controlChanges[key]?.sort(
        (a, b) => a.tick - b.tick || a.controller - b.controller
      );
    }
  }

  return output;
}

export function countTotalActiveNotes(tracks: LogicalTracks): number {
  return (
    tracks.drums.length +
    tracks.kick808.length +
    tracks.bass.length +
    tracks.keyboard.length +
    tracks.pad.length +
    tracks.vocal.length +
    tracks.vocalHarmony.length
  );
}
