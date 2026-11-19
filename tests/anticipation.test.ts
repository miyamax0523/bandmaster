import { describe, expect, it } from 'vitest';
import { generateBassNotes } from '../src/engines/bassEngine';
import { generateDrumNotes, GM_DRUM } from '../src/engines/drumEngine';
import { generateKeyboardNotes } from '../src/engines/keyboardEngine';
import { generatePadNotes } from '../src/engines/padEngine';
import { generateVocalNotes } from '../src/engines/vocalEngine';
import { createDefaultSongConfig, generateAllSections } from '../src/lib/bandState';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import { PATTERN_PRESET_GROUPS } from '../src/lib/patternPresets';
import { TICKS_PER_BAR, type InstrumentType, type Section } from '../src/types/song';

function createAnticipationSetup() {
  const song = createDefaultSongConfig('rockBand');
  song.key = 'E';
  song.scale = 'Minor';
  song.members.keyboard.activeSectionsOnly = false;
  song.members.pad.activeSectionsOnly = false;
  for (const inst of ['drums', 'bass', 'keyboard', 'pad', 'vocal'] as InstrumentType[]) {
    song.members[inst].patternPreset = 'jrock_anticipation';
  }
  const section: Section = {
    id: 'sec-ant',
    type: 'Verse',
    name: 'Aメロ',
    bars: 2,
    energy: 'High',
    kickMode: 'acoustic',
    hatDensity: 3,
    kickDensity: 3,
    keyboardDensity: 3,
    vocalDensity: 3,
    chords: ['Em', 'C'], // Bar 0 = Em, Bar 1 = C (pitch class 0)
  };
  song.sections = [section];
  return { song, section };
}

describe('jrock_anticipation band-unison bar-crossing syncopation', () => {
  it('registers jrock_anticipation preset across all 5 instruments', () => {
    for (const inst of ['drums', 'bass', 'keyboard', 'pad', 'vocal'] as InstrumentType[]) {
      const allValues = PATTERN_PRESET_GROUPS[inst].flatMap((g) =>
        g.options.map((o) => o.value)
      );
      expect(allValues).toContain('jrock_anticipation');
    }
  });

  it('anticipates bar 1 chord (C) on beat 4-and (tick 1680) and ties across tick 1920 across all 5 parts', () => {
    const { song, section } = createAnticipationSetup();
    const state = generateAllSections(song, undefined, 2026, false);
    const cells = state.cellsBySection[section.id];

    // 1. Drums: Kick + Crash/OpenHH at 1680, NO Kick at 1920
    const drums = cells.drums.takes.A;
    expect(
      drums.some((n) => n.startTick === 1680 && n.pitch === GM_DRUM.KICK)
    ).toBe(true);
    expect(
      drums.some(
        (n) =>
          n.startTick === 1680 &&
          (n.pitch === GM_DRUM.CRASH || n.pitch === GM_DRUM.OPEN_HH)
      )
    ).toBe(true);
    expect(
      drums.some((n) => n.startTick === TICKS_PER_BAR && n.pitch === GM_DRUM.KICK)
    ).toBe(false);

    // 2. Bass: C root (pitch class 0) at 1680 tying across 1920, no re-attack at 1920
    const bass = cells.bass.takes.A;
    const bassAnt = bass.find((n) => n.startTick === 1680);
    expect(bassAnt).toBeDefined();
    expect(bassAnt!.pitch % 12).toBe(0); // C
    expect(bassAnt!.startTick + bassAnt!.durationTicks).toBeGreaterThan(TICKS_PER_BAR);
    expect(bass.some((n) => n.startTick === TICKS_PER_BAR)).toBe(false);

    // 3. Keyboard: C chord voicing at 1680 sustaining past 1920, no note starting at 1920
    const keyboard = cells.keyboard.takes.A;
    const kbAnt = keyboard.filter((n) => n.startTick === 1680);
    expect(kbAnt.length).toBeGreaterThan(0);
    expect(kbAnt.some((n) => n.pitch % 12 === 0)).toBe(true); // Contains C
    expect(
      kbAnt.every((n) => n.startTick + n.durationTicks > TICKS_PER_BAR)
    ).toBe(true);
    expect(keyboard.some((n) => n.startTick === TICKS_PER_BAR)).toBe(false);

    // 4. Pad: Bar 0 releases before 1680, anticipates C chord at 1680 & sustains across 1920 without chord clash
    const pad = cells.pad.takes.A;
    const padBar0 = pad.filter((n) => n.startTick === 0);
    expect(padBar0.length).toBeGreaterThan(0);
    expect(padBar0.every((n) => n.startTick + n.durationTicks <= 1680)).toBe(true);

    const padAnt = pad.filter((n) => n.startTick === 1680);
    expect(padAnt.length).toBeGreaterThan(0);
    expect(padAnt.some((n) => n.pitch % 12 === 0)).toBe(true); // C chord voicing
    expect(
      padAnt.every((n) => n.startTick + n.durationTicks > TICKS_PER_BAR)
    ).toBe(true);
    expect(pad.some((n) => n.startTick === TICKS_PER_BAR)).toBe(false);

    // 5. Vocal: anticipates C chord tone at 1680 and ties across 1920 without re-attack at 1920
    const vocal = cells.vocal.takes.A;
    const vocalAnt = vocal.find((n) => n.startTick === 1680);
    expect(vocalAnt).toBeDefined();
    expect(vocalAnt!.startTick + vocalAnt!.durationTicks).toBeGreaterThan(TICKS_PER_BAR);
    expect(vocal.some((n) => n.startTick === TICKS_PER_BAR)).toBe(false);

    // Sanity-check direct engine calls as well
    expect(
      generateDrumNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'drums', 'A'),
      }).some((n) => n.startTick === 1680 && n.pitch === GM_DRUM.KICK)
    ).toBe(true);
    expect(
      generateBassNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'bass', 'A'),
        drumNotes: drums,
      }).some((n) => n.startTick === 1680 && n.pitch % 12 === 0)
    ).toBe(true);
    expect(
      generateKeyboardNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        keyboardDensity: 3,
        params: resolveInstrumentParams(song, section, 'keyboard', 'A'),
      }).some((n) => n.startTick === 1680 && n.startTick + n.durationTicks > TICKS_PER_BAR)
    ).toBe(true);
    expect(
      generatePadNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'pad', 'A'),
      }).some((n) => n.startTick === 1680 && n.startTick + n.durationTicks > TICKS_PER_BAR)
    ).toBe(true);
    expect(
      generateVocalNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'vocal', 'A'),
      }).some((n) => n.startTick === 1680 && n.startTick + n.durationTicks > TICKS_PER_BAR)
    ).toBe(true);
  });
});
