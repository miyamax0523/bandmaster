import { describe, expect, it } from 'vitest';
import { generateBassNotes } from '../src/engines/bassEngine';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import { TICKS_PER_BAR, type Section, type SongConfig } from '../src/types/song';

function createSong(bassOverrides: Partial<SongConfig['members']['bass']> = {}): SongConfig {
  return {
    title: 'Bass Test',
    bpm: 135,
    key: 'E',
    scale: 'Minor',
    timeSignature: '4/4',
    beatFeel: 'Straight',
    swing: 0,
    swingTarget: '8th',
    exportOnlyActiveTracks: true,
    split808KickTrack: true,
    members: {
      drums: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      bass: {
        enabled: true,
        activeSectionsOnly: false,
        bassStyle: 'Root Sync',
        bass808Behavior: 'octaveUp',
        instructionText: '',
        ...bassOverrides,
      },
      keyboard: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      pad: { enabled: true, activeSectionsOnly: false, instructionText: '' },
    },
    sections: [],
  };
}

function createSection(overrides: Partial<Section> = {}): Section {
  return {
    id: 'sec-1',
    type: 'Verse',
    name: 'Aメロ',
    bars: 2,
    energy: 'Mid',
    kickMode: 'acoustic',
    chords: ['Em', 'C'],
    ...overrides,
  };
}

describe('bassEngine', () => {
  it('enforces bar-head root and monophonic output in acoustic mode', () => {
    const song = createSong();
    const section = createSection({ bars: 2, chords: ['Em', 'C'] });
    const params = resolveInstrumentParams(song, section, 'bass', 'A');
    const notes = generateBassNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 100,
      params,
      drumNotes: [
        { pitch: 36, velocity: 110, startTick: 0, durationTicks: 120 },
        { pitch: 36, velocity: 100, startTick: 720, durationTicks: 120 },
        { pitch: 36, velocity: 110, startTick: 1920, durationTicks: 120 },
      ],
    });

    // Bar 0 head root = E1 (28), Bar 1 head root = C2 (36)
    const head0 = notes.find((n) => n.startTick === 0);
    const head1 = notes.find((n) => n.startTick === 1920);
    expect(head0?.pitch).toBe(28);
    expect(head1?.pitch).toBe(36);

    // Strictly monophonic
    for (let i = 0; i < notes.length - 1; i++) {
      expect(notes[i].startTick + notes[i].durationTicks).toBeLessThanOrEqual(
        notes[i + 1].startTick
      );
    }
  });

  it('handles 808 bass808Behavior: octaveUp (ignores Half cap), tacet, and normal', () => {
    const songOct = createSong({
      bass808Behavior: 'octaveUp',
      instructionText: 'ハーフ 重く',
    });
    const sec808 = createSection({ kickMode: '808', chords: ['Em', 'D'] });
    const notesOct = generateBassNotes({
      song: songOct,
      section: sec808,
      sectionIndex: 0,
      style: 'B',
      seed: 5,
      params: resolveInstrumentParams(songOct, sec808, 'bass', 'B'),
      drumNotes: [],
    });
    // E2 = 40, D3 = 50 (<= 51)
    expect(notesOct.find((n) => n.startTick === 0)?.pitch).toBe(40);
    expect(notesOct.find((n) => n.startTick === 1920)?.pitch).toBe(50);
    expect(notesOct.every((n) => n.pitch >= 40 && n.pitch <= 55)).toBe(true);

    const songTacet = createSong({ bass808Behavior: 'tacet' });
    expect(
      generateBassNotes({
        song: songTacet,
        section: sec808,
        sectionIndex: 0,
        style: 'A',
        seed: 5,
        params: resolveInstrumentParams(songTacet, sec808, 'bass', 'A'),
        drumNotes: [],
      })
    ).toEqual([]);
  });

  it('supports Unison Riff partial +12 on 808 without clamping >55, exact Take B, fixed +-6 Take A, and Take C deco', () => {
    const song = createSong();
    // Pitch 40 (+12 = 52 <= 55) and Pitch 48 (+12 = 60 > 55 -> stays 48!)
    const riffNotes = [
      { pitch: 40, velocity: 100, startTick: 0, durationTicks: 240, channel: 0 },
      { pitch: 48, velocity: 90, startTick: 480, durationTicks: 240, channel: 0 },
    ];
    const sec = createSection({
      bars: 1,
      kickMode: '808',
      unisonRiff: {
        sourceName: 'riff.mid',
        analysisMethod: 'manual',
        bars: 1,
        grid: 'straight16',
        offsetMs: 0,
        octaveUpOn808: true,
        cleanedBassNotes: riffNotes,
        accentTicks: [0, 480],
      },
    });

    // Take B: exact copy after partial +12
    const takeB = generateBassNotes({
      song,
      section: sec,
      sectionIndex: 0,
      style: 'B',
      seed: 1,
      params: resolveInstrumentParams(song, sec, 'bass', 'B'),
    });
    expect(takeB.map((n) => n.pitch)).toEqual([52, 48]);
    expect(takeB.map((n) => n.velocity)).toEqual([100, 90]);

    // Take A: fixed +-6 vel jitter even when params.velocityJitter is larger
    const paramsA = resolveInstrumentParams(song, sec, 'bass', 'A');
    paramsA.velocityJitter = 30;
    const takeA = generateBassNotes({
      song,
      section: sec,
      sectionIndex: 0,
      style: 'A',
      seed: 12,
      params: paramsA,
    });
    expect(takeA[0].velocity).toBeGreaterThanOrEqual(94);
    expect(takeA[0].velocity).toBeLessThanOrEqual(106);

    // Take C: adds decorative +12 at tick 1680 using pitch 48 -> 48+12=60 > 55 so skipped,
    // whereas if ref note is 40, 40+12=52 <= 55 so added!
    const secLow = createSection({
      bars: 1,
      kickMode: 'acoustic',
      unisonRiff: {
        sourceName: 'riff.mid',
        analysisMethod: 'manual',
        bars: 1,
        grid: 'straight16',
        offsetMs: 0,
        octaveUpOn808: false,
        cleanedBassNotes: [
          { pitch: 40, velocity: 100, startTick: 0, durationTicks: 240 },
        ],
        accentTicks: [0],
      },
    });
    const takeC = generateBassNotes({
      song,
      section: secLow,
      sectionIndex: 0,
      style: 'C',
      seed: 3,
      params: resolveInstrumentParams(song, secLow, 'bass', 'C'),
    });
    const deco = takeC.find((n) => n.startTick === 1680);
    expect(deco).toBeDefined();
    expect(deco!.pitch).toBe(52);
    expect(deco!.durationTicks).toBe(120);

    // Verify skipping when ref + 12 > 55 (e.g. ref pitch 48)
    const secHigh = createSection({
      bars: 1,
      kickMode: 'acoustic',
      unisonRiff: {
        sourceName: 'riff.mid',
        analysisMethod: 'manual',
        bars: 1,
        grid: 'straight16',
        offsetMs: 0,
        octaveUpOn808: false,
        cleanedBassNotes: [
          { pitch: 48, velocity: 100, startTick: 0, durationTicks: 240 },
        ],
        accentTicks: [0],
      },
    });
    const takeCHigh = generateBassNotes({
      song,
      section: secHigh,
      sectionIndex: 0,
      style: 'C',
      seed: 3,
      params: resolveInstrumentParams(song, secHigh, 'bass', 'C'),
    });
    expect(takeCHigh.find((n) => n.startTick === 1680)).toBeUndefined();
    expect(
      takeCHigh.every((n) => n.startTick < TICKS_PER_BAR)
    ).toBe(true);
  });
});
