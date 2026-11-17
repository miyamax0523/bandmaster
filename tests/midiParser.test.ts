import { describe, expect, it } from 'vitest';
import {
  decodeVLQ,
  extractDrumLoopFromMidi,
  parseMidiFile,
} from '../src/lib/midiParser';
import {
  buildMidiFile,
  buildMTrk,
  concatBytes,
  createNoteOffEvent,
  createNoteOnEvent,
  encodeAscii,
  writeUint16BE,
  writeUint32BE,
} from '../src/lib/midiWriter';

describe('midiParser', () => {
  it('throws explicitly on SMPTE timecode division', () => {
    const smpteHeader = concatBytes([
      encodeAscii('MThd'),
      writeUint32BE(6),
      writeUint16BE(1),
      writeUint16BE(1),
      writeUint16BE(0xe728), // SMPTE -25 fps, 40 ticks/frame (bit 15 = 1)
    ]);
    expect(() => parseMidiFile(smpteHeader)).toThrow(/SMPTE/i);
  });

  it('parses Running Status, vel=0 NoteOff, SysEx skip, and overlapping same-pitch notes', () => {
    // Track body with PPQ=240 so we also test PPQ normalization (x2 -> 480)
    // tick 0: 90 3C 64 (Note On C4 vel 100)
    // tick 120: running status 3C 00 (Note Off C4 via vel=0)
    // tick 120: SysEx F0 03 7E 7F F7
    // tick 120: 90 40 50 (Note On E4 #1)
    // tick 240: running status 40 60 (Overlapping Note On E4 #2)
    // tick 360: running status 40 00 (Closes E4 #1)
    // tick 480: running status 40 00 (Closes E4 #2)
    // tick 480: FF 2F 00 (EOT)
    const body = new Uint8Array([
      0x00, 0x90, 0x3c, 0x64,
      0x78, 0x3c, 0x00,
      0x00, 0xf0, 0x03, 0x7e, 0x7f, 0xf7,
      0x00, 0x90, 0x40, 0x50,
      0x78, 0x40, 0x60,
      0x78, 0x40, 0x00,
      0x78, 0x40, 0x00,
      0x00, 0xff, 0x2f, 0x00,
    ]);
    const track = concatBytes([
      encodeAscii('MTrk'),
      writeUint32BE(body.length),
      body,
    ]);
    const file = buildMidiFile(0, [track], 240);
    const parsed = parseMidiFile(file);

    expect(parsed.srcPPQ).toBe(240);
    expect(parsed.tracks[0].notes).toEqual([
      { pitch: 60, velocity: 100, startTick: 0, durationTicks: 240, channel: 0 },
      { pitch: 64, velocity: 80, startTick: 240, durationTicks: 480, channel: 0 },
      { pitch: 64, velocity: 96, startTick: 480, durationTicks: 480, channel: 0 },
    ]);
  });

  it('prefers Channel 9 track when extracting drum loop', () => {
    const bassTrack = buildMTrk([
      createNoteOnEvent(0, 0, 40, 100),
      createNoteOffEvent(480, 0, 40),
    ]);
    const drumTrack = buildMTrk([
      createNoteOnEvent(0, 9, 36, 110),
      createNoteOffEvent(120, 9, 36),
      createNoteOnEvent(960, 9, 38, 105),
      createNoteOffEvent(1080, 9, 38),
    ]);
    const file = buildMidiFile(1, [bassTrack, drumTrack], 480);
    const { drumLoop } = extractDrumLoopFromMidi(file, 'groove.mid');
    expect(drumLoop.sourceTrackIndex).toBe(1);
    expect(drumLoop.bars).toBe(1);
    expect(drumLoop.notes.length).toBe(2);
    expect(drumLoop.notes[0].pitch).toBe(36);
    expect(drumLoop.notes[1].pitch).toBe(38);
  });

  it('rejects malformed VLQ sequences', () => {
    const badVlq = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00]);
    expect(() => decodeVLQ(badVlq, 0, badVlq.length)).toThrow();
  });
});
