import { describe, expect, it } from 'vitest';
import {
  buildMidiFile,
  buildMThd,
  buildMTrk,
  createMarkerEvent,
  createNoteOffEvent,
  createNoteOnEvent,
  createTempoEvent,
  createTimeSignatureEvent,
  createTrackNameEvent,
  encodeVLQ,
  MAX_VLQ_VALUE,
} from '../src/lib/midiWriter';
import { parseMidiFile } from '../src/lib/midiParser';

describe('midiWriter', () => {
  it('encodes VLQ values accurately across byte boundaries', () => {
    expect(Array.from(encodeVLQ(0))).toEqual([0x00]);
    expect(Array.from(encodeVLQ(0x7f))).toEqual([0x7f]);
    expect(Array.from(encodeVLQ(0x80))).toEqual([0x81, 0x00]);
    expect(Array.from(encodeVLQ(0x3fff))).toEqual([0xff, 0x7f]);
    expect(Array.from(encodeVLQ(0x4000))).toEqual([0x81, 0x80, 0x00]);
    expect(Array.from(encodeVLQ(MAX_VLQ_VALUE))).toEqual([
      0xff, 0xff, 0xff, 0x7f,
    ]);
  });

  it('rejects out-of-range or non-integer VLQ values', () => {
    expect(() => encodeVLQ(-1)).toThrow(RangeError);
    expect(() => encodeVLQ(MAX_VLQ_VALUE + 1)).toThrow(RangeError);
    expect(() => encodeVLQ(1.5)).toThrow(RangeError);
  });

  it('builds a valid MThd header chunk', () => {
    const mthd = buildMThd(1, 3, 480);
    expect(mthd.length).toBe(14);
    expect(String.fromCharCode(...mthd.slice(0, 4))).toBe('MThd');
    expect(mthd[7]).toBe(6); // header len = 6
    expect((mthd[8] << 8) | mthd[9]).toBe(1); // format 1
    expect((mthd[10] << 8) | mthd[11]).toBe(3); // 3 tracks
    expect((mthd[12] << 8) | mthd[13]).toBe(480); // PPQ 480
  });

  it('roundtrips MTrk conductor and note events through midiParser', () => {
    const conductor = buildMTrk([
      createTrackNameEvent(0, 'Conductor'),
      createTempoEvent(0, 120),
      createTimeSignatureEvent(0),
      createMarkerEvent(0, 'Intro'),
    ]);
    const track1 = buildMTrk([
      createTrackNameEvent(0, 'Bass'),
      createNoteOnEvent(0, 0, 40, 100),
      createNoteOffEvent(480, 0, 40),
      createNoteOnEvent(480, 0, 43, 90),
      createNoteOffEvent(960, 0, 43),
    ]);

    const file = buildMidiFile(1, [conductor, track1], 480);
    const parsed = parseMidiFile(file);
    expect(parsed.format).toBe(1);
    expect(parsed.ntrks).toBe(2);
    expect(parsed.srcPPQ).toBe(480);
    expect(parsed.bpm).toBe(120);
    expect(parsed.tracks[0].name).toBe('Conductor');
    expect(parsed.tracks[1].name).toBe('Bass');
    expect(parsed.tracks[1].notes).toEqual([
      { pitch: 40, velocity: 100, startTick: 0, durationTicks: 480, channel: 0 },
      { pitch: 43, velocity: 90, startTick: 480, durationTicks: 480, channel: 0 },
    ]);
  });
});
