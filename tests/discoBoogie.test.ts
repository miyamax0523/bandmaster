import { describe, expect, it } from 'vitest';
import { generateBassNotes } from '../src/engines/bassEngine';
import { generateDrumNotes, GM_DRUM } from '../src/engines/drumEngine';
import { generateKeyboardNotes } from '../src/engines/keyboardEngine';
import { createDefaultSongConfig } from '../src/lib/bandState';
import { createUniformChordTimeline } from '../src/lib/chordTimeline';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import { PATTERN_PRESET_GROUPS } from '../src/lib/patternPresets';
import { TICKS_PER_BAR, type Section } from '../src/types/song';

function createDiscoSetup(bars = 4) {
  const song = createDefaultSongConfig('rockBand');
  song.key = 'E';
  song.scale = 'Minor';
  song.members.drums.patternPreset = 'disco_boogie_bounce';
  song.members.bass.patternPreset = 'disco_boogie_bounce';
  song.members.keyboard.patternPreset = 'disco_boogie_bounce';
  song.members.keyboard.activeSectionsOnly = false;
  const section: Section = {
    id: 'sec-disco',
    type: 'Chorus',
    name: 'サビ',
    bars,
    energy: 'High',
    kickMode: 'acoustic',
    hatDensity: 3,
    kickDensity: 3,
    keyboardDensity: 4,
    chords: createUniformChordTimeline(['Em7', 'Am7', 'Bm7', 'Em7'], bars),
  };
  return { song, section };
}

describe('disco_boogie_bounce groove preset', () => {
  it('registers disco_boogie_bounce for drums, bass, and keyboard', () => {
    for (const inst of ['drums', 'bass', 'keyboard'] as const) {
      const values = PATTERN_PRESET_GROUPS[inst].flatMap((g) =>
        g.options.map((o) => o.value)
      );
      expect(values).toContain('disco_boogie_bounce');
    }
  });

  it('produces 4-on-floor kicks, offbeat open hi-hat (46), bounced 16th hats, and bar-4 fill on drums', () => {
    const { song, section } = createDiscoSetup(4);
    const drums = generateDrumNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'C',
      seed: 10,
      params: resolveInstrumentParams(song, section, 'drums', 'C'),
    });

    // Bar 0 kicks on all 4 quarter beats
    const bar0Kicks = drums
      .filter((n) => n.startTick < TICKS_PER_BAR && n.pitch === GM_DRUM.KICK)
      .map((n) => n.startTick);
    expect(bar0Kicks).toEqual([0, 480, 960, 1440]);

    // Bar 0 Open HH (46) strictly on 8th offbeats [240, 720, 1200, 1680]
    const bar0OpenHats = drums
      .filter((n) => n.startTick < TICKS_PER_BAR && n.pitch === GM_DRUM.OPEN_HH)
      .map((n) => n.startTick);
    expect(bar0OpenHats).toEqual([240, 720, 1200, 1680]);

    // Bounced 16th closed hi-hats (120 + 16 = 136, 360 + 16 = 376, etc.)
    expect(
      drums.some(
        (n) =>
          n.startTick < TICKS_PER_BAR &&
          n.pitch === GM_DRUM.CLOSED_HH &&
          n.startTick % 240 === 136
      )
    ).toBe(true);

    // Final bar (bar 3) includes tight snare/tom fill notes
    const bar3Start = 3 * TICKS_PER_BAR;
    const bar3Fills = drums.filter(
      (n) =>
        n.startTick >= bar3Start + 480 &&
        (n.pitch === GM_DRUM.HIGH_TOM ||
          n.pitch === GM_DRUM.MID_TOM ||
          n.pitch === GM_DRUM.FLOOR_TOM)
    );
    expect(bar3Fills.length).toBeGreaterThan(0);
  });

  it('produces staccato +12 octave leaps and b7 turnaround on bass', () => {
    const { song, section } = createDiscoSetup(2);
    const drums = generateDrumNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 10,
      params: resolveInstrumentParams(song, section, 'drums', 'A'),
    });
    const bass = generateBassNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 10,
      drumNotes: drums,
      params: resolveInstrumentParams(song, section, 'bass', 'A'),
    });

    const bar0Bass = bass.filter((n) => n.startTick < TICKS_PER_BAR);
    expect(bar0Bass.length).toBeGreaterThanOrEqual(7);
    // Short staccato durations (~45-60% gate)
    expect(bar0Bass.every((n) => n.durationTicks <= 125)).toBe(true);

    // Low Em root E1 (28) AND +12 octave E2 (40) present
    const pitches = bar0Bass.map((n) => n.pitch);
    const minP = Math.min(...pitches);
    expect(pitches).toContain(minP + 12);
    // b7 (D = pitch class 2 on Em7 bar 0) present before bar end
    expect(bar0Bass.some((n) => n.startTick === 1560 && n.pitch % 12 === 2)).toBe(
      true
    );
  });

  it('plays funky C4..E5 call-and-response cutting chops around beats 2 & 4 while leaving beats 1 & 3 clear for bass', () => {
    const { song, section } = createDiscoSetup(2);
    const kbStd = generateKeyboardNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 10,
      keyboardDensity: 4,
      params: resolveInstrumentParams(song, section, 'keyboard', 'A'),
    });

    expect(kbStd.length).toBeGreaterThan(0);
    // Strictly inside C4..E5 (60..76) and short crisp cutting gate (<= 60 ticks)
    expect(kbStd.every((n) => n.pitch >= 60 && n.pitch <= 76)).toBe(true);
    expect(kbStd.every((n) => n.durationTicks <= 60)).toBe(true);

    // Never strikes on Beat 1 (0) or Beat 3 (960) where Bass locks low root
    expect(
      kbStd.every((n) => n.startTick % TICKS_PER_BAR !== 0 && n.startTick % TICKS_PER_BAR !== 960)
    ).toBe(true);

    // Responds around beats 2 (480, 600) & 4 (1320, 1440)
    expect(kbStd.some((n) => n.startTick % TICKS_PER_BAR === 480)).toBe(true);
    expect(kbStd.some((n) => n.startTick % TICKS_PER_BAR === 1440)).toBe(true);

    // Scales cleanly with keyboardDensity (1 vs 7)
    const kbSparse = generateKeyboardNotes({
      song,
      section: { ...section, keyboardDensity: 1 },
      sectionIndex: 0,
      style: 'A',
      seed: 10,
      keyboardDensity: 1,
      params: resolveInstrumentParams(song, section, 'keyboard', 'A'),
    });
    const kbDense = generateKeyboardNotes({
      song,
      section: { ...section, keyboardDensity: 7 },
      sectionIndex: 0,
      style: 'A',
      seed: 10,
      keyboardDensity: 7,
      params: resolveInstrumentParams(song, section, 'keyboard', 'A'),
    });
    expect(kbDense.length).toBeGreaterThan(kbStd.length);
    expect(kbStd.length).toBeGreaterThan(kbSparse.length);
  });
});
