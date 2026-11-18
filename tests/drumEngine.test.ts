import { describe, expect, it } from 'vitest';
import { generateDrumNotes, GM_DRUM } from '../src/engines/drumEngine';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import { TICKS_PER_BAR, type DrumLoopData, type Section, type SongConfig } from '../src/types/song';

function createSong(drumText = ''): SongConfig {
  return {
    title: 'Drum Test',
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
      drums: {
        enabled: true,
        activeSectionsOnly: false,
        drumStyle: 'Standard',
        instructionText: drumText,
      },
      bass: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      keyboard: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      pad: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      vocal: { enabled: true, activeSectionsOnly: false, instructionText: '' },
    },
    sections: [],
  };
}

function createSection(overrides: Partial<Section> = {}): Section {
  return {
    id: 'sec-1',
    type: 'Chorus',
    name: 'サビ',
    bars: 4,
    energy: 'High',
    kickMode: 'acoustic',
    chords: ['Em', 'C', 'G', 'D'],
    ...overrides,
  };
}

describe('drumEngine', () => {
  it('protects anchor notes (Chorus Crash 49 & Unison accent Kick 36) from velocityCap=95 and humanizeTicks=8', () => {
    const song = createSong('タイト');
    const accentTicks = [0, 360, 720, 1920, 2280];
    const section = createSection({
      type: 'Chorus',
      bars: 2,
      unisonRiff: {
        sourceName: 'riff.wav',
        analysisMethod: 'manual',
        bars: 2,
        grid: 'straight16',
        offsetMs: 0,
        cleanedBassNotes: [],
        accentTicks,
      },
    });
    const params = resolveInstrumentParams(song, section, 'drums', 'C');
    expect(params.velocityCap).toBe(95);
    expect(params.humanizeTicks).toBe(8);

    const notes = generateDrumNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'C',
      seed: 12345,
      params,
    });

    // Anchor 1: Chorus start Crash 49 at tick 0, velocity >= 110
    const crash = notes.find(
      (n) => n.pitch === GM_DRUM.CRASH && n.startTick === 0
    );
    expect(crash).toBeDefined();
    expect(crash!.velocity).toBeGreaterThanOrEqual(110);

    // Anchor 2: Unison accent Kicks 36 at exact accentTicks with velocity === 110
    for (const t of accentTicks) {
      const kick = notes.find(
        (n) => n.pitch === GM_DRUM.KICK && n.startTick === t
      );
      expect(kick).toBeDefined();
      expect(kick!.velocity).toBe(110);
    }
  });

  it('produces mixed 2/3/4 sub-step rolls when hatSubdivision = 4', () => {
    const song = createSong('トラップ ロール');
    const section = createSection({ type: 'Verse', bars: 2, energy: 'Mid' });
    const params = resolveInstrumentParams(song, section, 'drums', 'A');
    expect(params.hatSubdivision).toBe(4);

    const notes = generateDrumNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 777,
      params,
    });

    const hh = notes
      .filter((n) => n.pitch === GM_DRUM.CLOSED_HH && n.startTick < TICKS_PER_BAR)
      .sort((a, b) => a.startTick - b.startTick);

    const deltas = new Set<number>();
    for (let i = 1; i < hh.length; i++) {
      deltas.add(hh[i].startTick - hh[i - 1].startTick);
    }
    // 60 (2-roll), 40 (3-roll), 30 (4-roll) should all mix
    expect(deltas.has(60)).toBe(true);
    expect(deltas.has(40)).toBe(true);
    expect(deltas.has(30)).toBe(true);
  });

  it('enforces Take C > Take A > Take B fill note counts, preserves Kick, and adds barIndex=3 mini-fill for >=8 bars', () => {
    const song = createSong();
    const section = createSection({ type: 'Verse', bars: 8, energy: 'Mid' });

    const countFinalBarFill = (style: 'A' | 'B' | 'C') => {
      const params = resolveInstrumentParams(song, section, 'drums', style);
      const notes = generateDrumNotes({
        song,
        section,
        sectionIndex: 0,
        style,
        seed: 42,
        params,
      });
      const lastBarStart = 7 * TICKS_PER_BAR;
      const fillStart =
        lastBarStart + (style === 'A' ? 960 : style === 'B' ? 1440 : 480);
      return notes.filter(
        (n) =>
          n.startTick >= fillStart &&
          n.startTick < lastBarStart + TICKS_PER_BAR &&
          n.pitch !== GM_DRUM.KICK
      ).length;
    };

    const countA = countFinalBarFill('A');
    const countB = countFinalBarFill('B');
    const countC = countFinalBarFill('C');

    expect(countB).toBeGreaterThanOrEqual(2);
    expect(countB).toBeLessThanOrEqual(3);
    expect(countA).toBeGreaterThanOrEqual(4);
    expect(countA).toBeLessThanOrEqual(7);
    expect(countC).toBeGreaterThanOrEqual(8);
    expect(countC).toBeLessThanOrEqual(16);
    expect(countC).toBeGreaterThan(countA);
    expect(countA).toBeGreaterThan(countB);

    // Check barIndex=3 mini-fill in Take C
    const paramsC = resolveInstrumentParams(song, section, 'drums', 'C');
    const notesC = generateDrumNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'C',
      seed: 42,
      params: paramsC,
    });
    const bar3FillStart = 3 * TICKS_PER_BAR + 1440;
    const bar3FillEnd = 4 * TICKS_PER_BAR;
    const bar3NonKick = notesC.filter(
      (n) =>
        n.startTick >= bar3FillStart &&
        n.startTick < bar3FillEnd &&
        n.pitch !== GM_DRUM.KICK
    );
    expect(bar3NonKick.length).toBe(4);
  });

  it('expands external drum loop immutably and respects section > song priority', () => {
    const songLoop: DrumLoopData = {
      fileName: 'song.mid',
      bars: 1,
      sourceTrackIndex: 0,
      notes: [{ pitch: 36, velocity: 100, startTick: 0, durationTicks: 120 }],
    };
    const secLoop: DrumLoopData = {
      fileName: 'sec.mid',
      bars: 1,
      sourceTrackIndex: 0,
      notes: [{ pitch: 38, velocity: 90, startTick: 480, durationTicks: 120 }],
    };
    const origCopy = JSON.stringify(secLoop.notes);

    const song = createSong();
    song.uploadedDrumLoop = songLoop;
    const section = createSection({
      type: 'Outro',
      bars: 2,
      uploadedDrumLoop: secLoop,
    });
    const params = resolveInstrumentParams(song, section, 'drums', 'A');
    const notes = generateDrumNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 9,
      params,
    });

    expect(JSON.stringify(secLoop.notes)).toBe(origCopy);
    expect(notes.filter((n) => n.pitch === 38).length).toBe(2);
    expect(notes.filter((n) => n.pitch === 36).length).toBe(0);
  });

  it('handles 1 bar, 32 bars, and disabled drums cleanly', () => {
    const song = createSong();
    const sec1 = createSection({ bars: 1 });
    const n1 = generateDrumNotes({
      song,
      section: sec1,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(song, sec1, 'drums', 'A'),
    });
    expect(n1.every((n) => n.startTick >= 0 && n.startTick < TICKS_PER_BAR)).toBe(true);

    const sec32 = createSection({ bars: 32 });
    const n32 = generateDrumNotes({
      song,
      section: sec32,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(song, sec32, 'drums', 'A'),
    });
    expect(n32.every((n) => n.startTick >= 0 && n.startTick < 32 * TICKS_PER_BAR)).toBe(true);

    song.members.drums.enabled = false;
    expect(
      generateDrumNotes({
        song,
        section: sec1,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, sec1, 'drums', 'A'),
      })
    ).toEqual([]);
  });

  it('produces distinct seed-dependent Take A/B/C variations on uploaded drum MIDI while preserving Kick skeleton', () => {
    const loop: DrumLoopData = {
      fileName: 'custom.mid',
      bars: 1,
      sourceTrackIndex: 0,
      notes: [
        { pitch: 36, velocity: 110, startTick: 0, durationTicks: 120 },
        { pitch: 42, velocity: 90, startTick: 0, durationTicks: 120 },
        { pitch: 38, velocity: 105, startTick: 480, durationTicks: 120 },
        { pitch: 36, velocity: 105, startTick: 960, durationTicks: 120 },
        { pitch: 38, velocity: 105, startTick: 1440, durationTicks: 120 },
      ],
    };

    const song = createSong();
    const section = createSection({
      type: 'Verse',
      bars: 2,
      energy: 'High',
      uploadedDrumLoop: loop,
    });

    const gen = (style: 'A' | 'B' | 'C', seed: number) =>
      generateDrumNotes({
        song,
        section,
        sectionIndex: 0,
        style,
        seed,
        params: resolveInstrumentParams(song, section, 'drums', style),
      });

    // Take A keeps base pattern + light beat-4 nuance only
    const takeA = gen('A', 100);
    expect(takeA.filter((n) => n.pitch === 36).map((n) => n.startTick)).toEqual([
      0, 960, 1920, 2880,
    ]);

    // Take B keeps Kick/Snare skeleton and adds low-velocity ghost notes on 16th offbeats
    const takeB1 = gen('B', 111);
    const takeB2 = gen('B', 999);
    expect(takeB1.filter((n) => n.pitch === 36).map((n) => n.startTick)).toEqual([
      0, 960, 1920, 2880,
    ]);
    const bGhostNotes = takeB1.filter(
      (n) => n.startTick % 240 === 120 && n.velocity <= 60
    );
    expect(bGhostNotes.length).toBeGreaterThan(0);
    expect(JSON.stringify(takeB1)).not.toBe(JSON.stringify(takeB2));

    // Take C adds Open HH (46) / Crash (49) and seed-dependent final-bar fill (beats 3-4) keeping Kick at 2880
    const takeC1 = gen('C', 222);
    const takeC2 = gen('C', 8888);
    expect(takeC1.some((n) => n.pitch === GM_DRUM.OPEN_HH)).toBe(true);
    expect(takeC1.some((n) => n.pitch === GM_DRUM.CRASH)).toBe(true);
    expect(
      takeC1.some((n) => n.pitch === GM_DRUM.KICK && n.startTick === 2880)
    ).toBe(true);
    const c1Fill = takeC1.filter(
      (n) => n.startTick >= 1920 + 960 && n.pitch !== GM_DRUM.KICK
    );
    const c2Fill = takeC2.filter(
      (n) => n.startTick >= 1920 + 960 && n.pitch !== GM_DRUM.KICK
    );
    expect(c1Fill.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(c1Fill)).not.toBe(JSON.stringify(c2Fill));
  });

  it('scales hatDensity (1 vs 3 vs 5) and kickDensity (1 vs 3 vs 5) while respecting genre style', () => {
    const song = createSong();
    const run = (hatDensity: 1 | 3 | 5, kickDensity: 1 | 3 | 5, drumText = '') => {
      song.members.drums.instructionText = drumText;
      const section = createSection({
        type: 'Outro',
        bars: 2,
        energy: 'Mid',
        hatDensity,
        kickDensity,
      });
      return generateDrumNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 55,
        params: resolveInstrumentParams(song, section, 'drums', 'A'),
      });
    };

    const rockMin = run(1, 1);
    const rockStd = run(3, 3);
    const rockMax = run(5, 5);

    const hatsMin = rockMin.filter((n) => n.pitch === GM_DRUM.CLOSED_HH || n.pitch === GM_DRUM.OPEN_HH);
    const hatsStd = rockStd.filter((n) => n.pitch === GM_DRUM.CLOSED_HH || n.pitch === GM_DRUM.OPEN_HH);
    const hatsMax = rockMax.filter((n) => n.pitch === GM_DRUM.CLOSED_HH || n.pitch === GM_DRUM.OPEN_HH);
    // 2 bars: level 1 = 8 quarter notes, level 3 = 16 eighth notes, level 5 = 32 sixteenth notes
    expect(hatsMin.length).toBe(8);
    expect(hatsStd.length).toBe(16);
    expect(hatsMax.length).toBe(32);

    const kicksMin = rockMin.filter((n) => n.pitch === GM_DRUM.KICK);
    const kicksStd = rockStd.filter((n) => n.pitch === GM_DRUM.KICK);
    const kicksMax = rockMax.filter((n) => n.pitch === GM_DRUM.KICK);
    expect(kicksMin.length).toBe(4); // 2 bars * [0, 960]
    expect(kicksStd.length).toBeGreaterThanOrEqual(4);
    expect(kicksMax.length).toBeGreaterThan(kicksStd.length);

    // Trap style with hatDensity 1 vs 5
    const trapMin = run(1, 3, 'トラップ');
    const trapMax = run(5, 3, 'トラップ');
    expect(
      trapMin.filter((n) => n.pitch === GM_DRUM.CLOSED_HH).length
    ).toBe(8);
    expect(
      trapMax.filter((n) => n.pitch === GM_DRUM.CLOSED_HH).length
    ).toBeGreaterThan(32);
  });

  it('applies patternPreset deterministically across drum presets', () => {
    const runPreset = (preset: string, bars = 2) => {
      const song = createSong('');
      song.members.drums.patternPreset = preset;
      const section = createSection({ bars, chords: ['Em', 'C'], energy: 'Mid' });
      return generateDrumNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'drums', 'A'),
      });
    };

    const minimal = runPreset('simple_minimal');
    const metal = runPreset('metal_double');
    expect(metal.filter((n) => n.pitch === GM_DRUM.KICK).length).toBeGreaterThan(
      minimal.filter((n) => n.pitch === GM_DRUM.KICK).length
    );

    const fourOnFloor = runPreset('four_on_floor', 1);
    const kickTicks = fourOnFloor
      .filter((n) => n.pitch === GM_DRUM.KICK)
      .map((n) => n.startTick);
    expect(kickTicks.length).toBe(4);
    [0, 480, 960, 1440].forEach((beatTick, idx) => {
      expect(Math.abs(kickTicks[idx] - beatTick)).toBeLessThanOrEqual(15);
    });
    expect(fourOnFloor.some((n) => n.pitch === GM_DRUM.OPEN_HH)).toBe(true);

    const rimChill = runPreset('rim_chill');
    expect(rimChill.some((n) => n.pitch === GM_DRUM.RIMSHOT)).toBe(true);
    expect(
      rimChill.filter((n) => n.startTick < TICKS_PER_BAR && n.pitch === GM_DRUM.SNARE).length
    ).toBe(0);

    const trapSparse = runPreset('trap_sparse');
    const trapActive = runPreset('trap_active');
    expect(trapActive.filter((n) => n.pitch === GM_DRUM.CLOSED_HH).length).toBeGreaterThan(
      trapSparse.filter((n) => n.pitch === GM_DRUM.CLOSED_HH).length
    );

    const buildUp = runPreset('build_up', 2);
    const bar1Snares = buildUp.filter(
      (n) => n.pitch === GM_DRUM.SNARE && n.startTick < TICKS_PER_BAR
    );
    const bar2Snares = buildUp.filter(
      (n) => n.pitch === GM_DRUM.SNARE && n.startTick >= TICKS_PER_BAR
    );
    expect(bar2Snares.length).toBeGreaterThanOrEqual(bar1Snares.length);
  });
});
