export const MAX_VLQ_VALUE = 0x0fffffff;

export interface MidiTrackEvent {
  tick: number;
  order?: number; // Lower runs first at identical tick
  data: Uint8Array;
}

/**
 * Encodes a non-negative integer into MIDI Variable Length Quantity (VLQ).
 * Valid range: 0 .. 0x0FFFFFFF.
 */
export function encodeVLQ(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > MAX_VLQ_VALUE) {
    throw new RangeError(
      `VLQ value must be an integer in [0, 0x0FFFFFFF], received: ${value}`
    );
  }
  const bytes: number[] = [];
  let v = value;
  bytes.unshift(v & 0x7f);
  v >>>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return new Uint8Array(bytes);
}

export function writeUint16BE(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

export function writeUint32BE(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

export function encodeAscii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[i] = code <= 0x7f ? code : 0x3f; // '?' fallback for non-ASCII
  }
  return bytes;
}

export function isAsciiString(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) {
      return false;
    }
  }
  return true;
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) {
    total += c.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function buildMThd(
  format: 0 | 1,
  ntrks: number,
  division = 480
): Uint8Array {
  if (!Number.isInteger(ntrks) || ntrks < 0 || ntrks > 0xffff) {
    throw new RangeError(`Invalid track count: ${ntrks}`);
  }
  if (!Number.isInteger(division) || division <= 0 || division > 0x7fff) {
    throw new RangeError(`Invalid PPQ division: ${division}`);
  }
  return concatBytes([
    encodeAscii('MThd'),
    writeUint32BE(6),
    writeUint16BE(format),
    writeUint16BE(ntrks),
    writeUint16BE(division),
  ]);
}

export function createTrackNameEvent(tick: number, name: string): MidiTrackEvent {
  const nameBytes = encodeAscii(name);
  return {
    tick,
    order: 0,
    data: concatBytes([
      new Uint8Array([0xff, 0x03]),
      encodeVLQ(nameBytes.length),
      nameBytes,
    ]),
  };
}

export function createTempoEvent(tick: number, bpm: number): MidiTrackEvent {
  const safeBpm = Math.max(1, bpm);
  const mpqn = Math.round(60_000_000 / safeBpm);
  return {
    tick,
    order: 1,
    data: new Uint8Array([
      0xff,
      0x51,
      0x03,
      (mpqn >>> 16) & 0xff,
      (mpqn >>> 8) & 0xff,
      mpqn & 0xff,
    ]),
  };
}

export function createTimeSignatureEvent(
  tick: number,
  numerator = 4,
  denominatorPower = 2, // 2^2 = 4 -> 4/4
  clocksPerClick = 24,
  thirtySecondsPerQuarter = 8
): MidiTrackEvent {
  return {
    tick,
    order: 2,
    data: new Uint8Array([
      0xff,
      0x58,
      0x04,
      numerator & 0xff,
      denominatorPower & 0xff,
      clocksPerClick & 0xff,
      thirtySecondsPerQuarter & 0xff,
    ]),
  };
}

export function createMarkerEvent(tick: number, text: string): MidiTrackEvent {
  const bytes = encodeAscii(text);
  return {
    tick,
    order: 3,
    data: concatBytes([
      new Uint8Array([0xff, 0x06]),
      encodeVLQ(bytes.length),
      bytes,
    ]),
  };
}

export function createProgramChangeEvent(
  tick: number,
  channel: number,
  program: number
): MidiTrackEvent {
  const ch = channel & 0x0f;
  const prog = program & 0x7f;
  return {
    tick,
    order: 4,
    data: new Uint8Array([0xc0 | ch, prog]),
  };
}

export function createControlChangeEvent(
  tick: number,
  channel: number,
  controller: number,
  value: number,
  order = 5
): MidiTrackEvent {
  const ch = channel & 0x0f;
  const cc = Math.min(127, Math.max(0, Math.round(controller)));
  const val = Math.min(127, Math.max(0, Math.round(value)));
  return {
    tick: Math.max(0, Math.round(tick)),
    order,
    data: new Uint8Array([0xb0 | ch, cc, val]),
  };
}

export function createPitchBendEvent(
  tick: number,
  channel: number,
  value14Bit: number,
  order = 5
): MidiTrackEvent {
  const ch = channel & 0x0f;
  const clamped = Math.min(16383, Math.max(0, Math.round(value14Bit)));
  const lsb = clamped & 0x7f;
  const msb = (clamped >>> 7) & 0x7f;
  return {
    tick: Math.max(0, Math.round(tick)),
    order,
    data: new Uint8Array([0xe0 | ch, lsb, msb]),
  };
}

/**
 * Emits RPN 0,0 Pitch Bend Sensitivity sequence:
 * CC#101=0, CC#100=0, CC#6=bendRange, CC#38=0, CC#101=127, CC#100=127
 */
export function createPitchBendSensitivityRpnEvents(
  tick: number,
  channel: number,
  bendRangeSemitones: number,
  cents = 0
): MidiTrackEvent[] {
  return [
    createControlChangeEvent(tick, channel, 101, 0, 4),
    createControlChangeEvent(tick, channel, 100, 0, 4),
    createControlChangeEvent(tick, channel, 6, bendRangeSemitones, 4),
    createControlChangeEvent(tick, channel, 38, cents, 4),
    createControlChangeEvent(tick, channel, 101, 127, 4),
    createControlChangeEvent(tick, channel, 100, 127, 4),
  ];
}

export function createNoteOnEvent(
  tick: number,
  channel: number,
  pitch: number,
  velocity: number
): MidiTrackEvent {
  const ch = channel & 0x0f;
  const p = Math.min(127, Math.max(0, Math.round(pitch)));
  const v = Math.min(127, Math.max(1, Math.round(velocity)));
  return {
    tick,
    order: 6,
    data: new Uint8Array([0x90 | ch, p, v]),
  };
}

export function createNoteOffEvent(
  tick: number,
  channel: number,
  pitch: number
): MidiTrackEvent {
  const ch = channel & 0x0f;
  const p = Math.min(127, Math.max(0, Math.round(pitch)));
  return {
    tick,
    order: 4.5, // Strictly NoteOff (4.5) -> CC/PB (5) -> NoteOn (6) at identical tick
    data: new Uint8Array([0x80 | ch, p, 0]),
  };
}

/**
 * Sorts absolute-tick events, converts to delta times, appends End of Track (FF 2F 00),
 * and wraps in an MTrk chunk.
 */
export function buildMTrk(events: readonly MidiTrackEvent[]): Uint8Array {
  const indexed = events.map((ev, idx) => ({ ev, idx }));
  indexed.sort((a, b) => {
    if (a.ev.tick !== b.ev.tick) return a.ev.tick - b.ev.tick;
    const ordA = a.ev.order ?? 10;
    const ordB = b.ev.order ?? 10;
    if (ordA !== ordB) return ordA - ordB;
    return a.idx - b.idx;
  });

  const bodyChunks: Uint8Array[] = [];
  let prevTick = 0;

  for (const { ev } of indexed) {
    const tick = Math.max(0, Math.round(ev.tick));
    const delta = tick - prevTick;
    prevTick = tick;
    bodyChunks.push(encodeVLQ(delta), ev.data);
  }

  // End of Track meta event
  bodyChunks.push(encodeVLQ(0), new Uint8Array([0xff, 0x2f, 0x00]));

  const body = concatBytes(bodyChunks);
  return concatBytes([encodeAscii('MTrk'), writeUint32BE(body.length), body]);
}

export function buildMidiFile(
  format: 0 | 1,
  tracks: readonly Uint8Array[],
  division = 480
): Uint8Array {
  const header = buildMThd(format, tracks.length, division);
  return concatBytes([header, ...tracks]);
}
