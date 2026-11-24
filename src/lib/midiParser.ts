import { PPQ, TICKS_PER_BAR, type DrumLoopData, type MidiNote } from '../types/song';
import { MAX_VLQ_VALUE } from './midiWriter';

export interface ParsedPitchBend {
  tick: number;
  value14Bit: number;
  channel: number;
}

export interface ParsedControlChange {
  tick: number;
  controller: number;
  value: number;
  channel: number;
}

export interface ParsedMidiTrack {
  index: number;
  name?: string;
  notes: MidiNote[];
  hasChannel9: boolean;
  pitchBends: ParsedPitchBend[];
  controlChanges: ParsedControlChange[];
}

export interface ParsedMidiFile {
  format: number;
  ntrks: number;
  srcPPQ: number;
  bpm?: number;
  tracks: ParsedMidiTrack[];
}

function readUint16BE(data: Uint8Array, offset: number): number {
  if (offset + 2 > data.length) {
    throw new Error('Unexpected end of MIDI data while reading uint16');
  }
  return (data[offset] << 8) | data[offset + 1];
}

function readUint32BE(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) {
    throw new Error('Unexpected end of MIDI data while reading uint32');
  }
  return (
    ((data[offset] << 24) >>> 0) +
    (data[offset + 1] << 16) +
    (data[offset + 2] << 8) +
    data[offset + 3]
  );
}

function readAscii(data: Uint8Array, offset: number, length: number): string {
  if (offset + length > data.length) {
    throw new Error('Unexpected end of MIDI data while reading ASCII string');
  }
  let s = '';
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(data[offset + i]);
  }
  return s;
}

export function decodeVLQ(
  data: Uint8Array,
  startOffset: number,
  endOffset: number
): { value: number; nextOffset: number } {
  let value = 0;
  let offset = startOffset;

  for (let count = 0; count < 4; count++) {
    if (offset >= endOffset) {
      throw new Error('Unexpected end of MIDI track while decoding VLQ');
    }
    const byte = data[offset++];
    value = (value << 7) | (byte & 0x7f);
    if (value > MAX_VLQ_VALUE) {
      throw new Error(`VLQ value exceeds maximum 0x0FFFFFFF`);
    }
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: offset };
    }
  }

  throw new Error('Invalid VLQ sequence (exceeded 4 bytes / 0x0FFFFFFF)');
}

function normalizeTick(tick: number, srcPPQ: number): number {
  return Math.round((tick * PPQ) / srcPPQ);
}

interface ActiveNoteEntry {
  startTick: number;
  velocity: number;
  channel: number;
}

export function parseMidiFile(bytes: Uint8Array): ParsedMidiFile {
  if (bytes.length < 14) {
    throw new Error('Invalid MIDI file: too short');
  }

  const headerId = readAscii(bytes, 0, 4);
  if (headerId !== 'MThd') {
    throw new Error(`Invalid MIDI header: expected MThd, got "${headerId}"`);
  }

  const headerLength = readUint32BE(bytes, 4);
  if (headerLength < 6 || 8 + headerLength > bytes.length) {
    throw new Error(`Invalid MThd chunk length: ${headerLength}`);
  }

  const format = readUint16BE(bytes, 8);
  const ntrks = readUint16BE(bytes, 10);
  const division = readUint16BE(bytes, 12);

  if ((division & 0x8000) !== 0) {
    throw new Error(
      'SMPTE timecode division is not supported; PPQ ticks-per-quarter-note MIDI is required'
    );
  }
  if (division === 0) {
    throw new Error('Invalid MIDI PPQ division: 0');
  }

  const srcPPQ = division;
  let offset = 8 + headerLength;
  const tracks: ParsedMidiTrack[] = [];
  let detectedBpm: number | undefined;

  for (let t = 0; t < ntrks; t++) {
    // Skip any unknown non-MTrk chunks gracefully
    while (offset + 8 <= bytes.length) {
      const chunkId = readAscii(bytes, offset, 4);
      const chunkLen = readUint32BE(bytes, offset + 4);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkLen;
      if (chunkEnd > bytes.length) {
        throw new Error(
          `Chunk "${chunkId}" length (${chunkLen}) exceeds file size`
        );
      }
      offset = chunkEnd;
      if (chunkId === 'MTrk') {
        const parsed = parseTrackChunk(
          bytes,
          chunkStart,
          chunkEnd,
          tracks.length,
          srcPPQ
        );
        if (detectedBpm === undefined && parsed.bpm !== undefined) {
          detectedBpm = parsed.bpm;
        }
        tracks.push(parsed.track);
        break;
      }
    }
  }

  return {
    format,
    ntrks,
    srcPPQ,
    bpm: detectedBpm,
    tracks,
  };
}

function parseTrackChunk(
  bytes: Uint8Array,
  start: number,
  end: number,
  trackIndex: number,
  srcPPQ: number
): { track: ParsedMidiTrack; bpm?: number } {
  let offset = start;
  let absTick = 0;
  let runningStatus = 0;
  let trackName: string | undefined;
  let bpm: number | undefined;
  let hasChannel9 = false;

  const notes: MidiNote[] = [];
  const pitchBends: ParsedPitchBend[] = [];
  const controlChanges: ParsedControlChange[] = [];
  // FIFO stack per channel:pitch to pair overlapping identical pitches cleanly
  const activeNotes = new Map<string, ActiveNoteEntry[]>();

  const closeNote = (ch: number, pitch: number, endTick: number) => {
    const key = `${ch}:${pitch}`;
    const queue = activeNotes.get(key);
    if (!queue || queue.length === 0) return;
    const entry = queue.shift()!;
    const normStart = normalizeTick(entry.startTick, srcPPQ);
    const normEnd = normalizeTick(endTick, srcPPQ);
    const durationTicks = Math.max(1, normEnd - normStart);
    notes.push({
      pitch,
      velocity: entry.velocity,
      startTick: normStart,
      durationTicks,
      channel: entry.channel,
    });
  };

  while (offset < end) {
    const delta = decodeVLQ(bytes, offset, end);
    offset = delta.nextOffset;
    absTick += delta.value;

    if (offset >= end) {
      throw new Error('Unexpected end of track after delta-time');
    }

    let statusByte = bytes[offset];
    if (statusByte < 0x80) {
      if (runningStatus === 0) {
        throw new Error('Data byte encountered with no active running status');
      }
      statusByte = runningStatus;
    } else {
      offset++;
      if (statusByte < 0xf0) {
        runningStatus = statusByte;
      } else {
        // Meta or SysEx clears running status per SMF spec
        runningStatus = 0;
      }
    }

    if (statusByte === 0xff) {
      if (offset >= end) {
        throw new Error('Unexpected end of track in Meta event');
      }
      const metaType = bytes[offset++];
      const lenRes = decodeVLQ(bytes, offset, end);
      offset = lenRes.nextOffset;
      const metaLen = lenRes.value;
      if (offset + metaLen > end) {
        throw new Error('Meta event length exceeds track boundary');
      }

      if (metaType === 0x03 && trackName === undefined) {
        trackName = readAscii(bytes, offset, metaLen);
      } else if (metaType === 0x51 && metaLen === 3 && bpm === undefined) {
        const mpqn =
          (bytes[offset] << 16) |
          (bytes[offset + 1] << 8) |
          bytes[offset + 2];
        if (mpqn > 0) {
          bpm = Math.round(60_000_000 / mpqn);
        }
      } else if (metaType === 0x2f) {
        offset += metaLen;
        break;
      }

      offset += metaLen;
    } else if (statusByte === 0xf0 || statusByte === 0xf7) {
      const lenRes = decodeVLQ(bytes, offset, end);
      offset = lenRes.nextOffset;
      if (offset + lenRes.value > end) {
        throw new Error('SysEx event length exceeds track boundary');
      }
      offset += lenRes.value;
    } else {
      const eventType = statusByte & 0xf0;
      const channel = statusByte & 0x0f;

      const needTwoBytes =
        eventType === 0x80 ||
        eventType === 0x90 ||
        eventType === 0xa0 ||
        eventType === 0xb0 ||
        eventType === 0xe0;

      if (needTwoBytes) {
        if (offset + 2 > end) {
          throw new Error('Channel voice message truncated');
        }
        const d1 = bytes[offset++];
        const d2 = bytes[offset++];

        if (eventType === 0x90) {
          if (channel === 9) hasChannel9 = true;
          if (d2 === 0) {
            closeNote(channel, d1, absTick);
          } else {
            const key = `${channel}:${d1}`;
            const queue = activeNotes.get(key) ?? [];
            queue.push({
              startTick: absTick,
              velocity: Math.min(127, Math.max(1, d2)),
              channel,
            });
            activeNotes.set(key, queue);
          }
        } else if (eventType === 0x80) {
          closeNote(channel, d1, absTick);
        } else if (eventType === 0xb0) {
          controlChanges.push({
            tick: normalizeTick(absTick, srcPPQ),
            controller: d1 & 0x7f,
            value: d2 & 0x7f,
            channel,
          });
        } else if (eventType === 0xe0) {
          pitchBends.push({
            tick: normalizeTick(absTick, srcPPQ),
            value14Bit: ((d2 & 0x7f) << 7) | (d1 & 0x7f),
            channel,
          });
        }
      } else if (eventType === 0xc0 || eventType === 0xd0) {
        if (offset + 1 > end) {
          throw new Error('Channel voice message (1-byte) truncated');
        }
        offset += 1;
      } else {
        throw new Error(`Unsupported MIDI status byte: 0x${statusByte.toString(16)}`);
      }
    }
  }

  // Close any dangling notes at end of track
  for (const [key, queue] of activeNotes.entries()) {
    const [, pitchStr] = key.split(':');
    const pitch = Number(pitchStr);
    for (const entry of queue) {
      const normStart = normalizeTick(entry.startTick, srcPPQ);
      const normEnd = normalizeTick(absTick, srcPPQ);
      notes.push({
        pitch,
        velocity: entry.velocity,
        startTick: normStart,
        durationTicks: Math.max(1, normEnd - normStart),
        channel: entry.channel,
      });
    }
  }

  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  return {
    track: {
      index: trackIndex,
      name: trackName,
      notes,
      hasChannel9,
      pitchBends,
      controlChanges,
    },
    bpm,
  };
}

export function selectDefaultDrumTrackIndex(parsed: ParsedMidiFile): number {
  const ch9Track = parsed.tracks.find(
    (t) => t.hasChannel9 && t.notes.length > 0
  );
  if (ch9Track) return ch9Track.index;

  let bestIndex = 0;
  let bestCount = -1;
  for (const t of parsed.tracks) {
    if (t.notes.length > bestCount) {
      bestCount = t.notes.length;
      bestIndex = t.index;
    }
  }
  return bestIndex;
}

export function extractDrumLoopFromMidi(
  bytes: Uint8Array,
  fileName: string,
  preferredTrackIndex?: number
): { drumLoop: DrumLoopData; parsed: ParsedMidiFile } {
  const parsed = parseMidiFile(bytes);
  if (parsed.tracks.length === 0) {
    throw new Error('MIDI file contains no tracks');
  }

  const trackIdx =
    preferredTrackIndex !== undefined &&
    parsed.tracks.some((t) => t.index === preferredTrackIndex)
      ? preferredTrackIndex
      : selectDefaultDrumTrackIndex(parsed);

  const track = parsed.tracks.find((t) => t.index === trackIdx);
  if (!track || track.notes.length === 0) {
    throw new Error('Selected MIDI track contains no notes');
  }

  const maxEndTick = track.notes.reduce(
    (max, n) => Math.max(max, n.startTick + n.durationTicks),
    0
  );
  const rawBars = Math.max(1, Math.ceil(maxEndTick / TICKS_PER_BAR));
  const bars = Math.min(4, rawBars);
  const loopEnd = bars * TICKS_PER_BAR;

  const clippedNotes: MidiNote[] = track.notes
    .filter((n) => n.startTick >= 0 && n.startTick < loopEnd)
    .map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity,
      startTick: n.startTick,
      durationTicks: Math.max(1, Math.min(n.durationTicks, loopEnd - n.startTick)),
      channel: 9,
    }));

  return {
    drumLoop: {
      fileName,
      bars,
      sourceTrackIndex: trackIdx,
      notes: clippedNotes,
    },
    parsed,
  };
}

export function extractRiffNotesFromMidi(bytes: Uint8Array): {
  notes: MidiNote[];
  bars: number;
} {
  const parsed = parseMidiFile(bytes);
  // Pick track with most non-channel-9 notes, or any track with notes
  let candidate = parsed.tracks.find((t) => !t.hasChannel9 && t.notes.length > 0);
  if (!candidate) {
    candidate = parsed.tracks.reduce<ParsedMidiTrack | undefined>(
      (best, t) => (!best || t.notes.length > best.notes.length ? t : best),
      undefined
    );
  }
  if (!candidate || candidate.notes.length === 0) {
    throw new Error('MIDI file contains no riff notes');
  }
  const maxEnd = candidate.notes.reduce(
    (m, n) => Math.max(m, n.startTick + n.durationTicks),
    0
  );
  const bars = Math.min(4, Math.max(1, Math.ceil(maxEnd / TICKS_PER_BAR)));
  return {
    notes: candidate.notes.map((n) => ({ ...n })),
    bars,
  };
}
