import { describe, expect, it } from 'vitest';
import {
  DRUM_DNA_PROFILES,
  generateDrumNotes,
  generateDrumResult,
  GM_DRUM,
  type DrumGenreDNAId,
} from '../src/engines/drumEngine';
import {
  createUniformChordTimeline,
  shiftChordBoundary,
} from '../src/lib/chordTimeline';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import { PATTERN_PRESET_GROUPS } from '../src/lib/patternPresets';
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
    chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
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
      const section = createSection({
        bars,
        chords: createUniformChordTimeline(['Em', 'C'], bars),
        energy: 'Mid',
      });
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

  it('punches kick + crash accent at offbeat ChordSlot boundary (1680 ticks) and suppresses downbeat kick collision', () => {
    const song = createSong('');
    const shifted = shiftChordBoundary(createUniformChordTimeline(['Em', 'C'], 2), 1, -0.5);
    const section = createSection({
      bars: 2,
      energy: 'High',
      chords: shifted,
    });
    const notes = generateDrumNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(song, section, 'drums', 'A'),
    });

    // Anticipated changeTick = 3.5 * 480 = 1680
    expect(
      notes.some((n) => n.pitch === GM_DRUM.KICK && Math.abs(n.startTick - 1680) <= 15)
    ).toBe(true);
    expect(
      notes.some((n) => n.pitch === GM_DRUM.CRASH && Math.abs(n.startTick - 1680) <= 15)
    ).toBe(true);
    // Colliding downbeat kicks in (1680, 1920] (e.g. bar 1 downbeat at 1920) are cleared
    const collidingKicks = notes.filter(
      (n) => n.pitch === GM_DRUM.KICK && n.startTick > 1680 && n.startTick <= 1920
    );
    expect(collidingKicks).toEqual([]);
  });

  it('keeps original drum beat & downbeat kick (1920 ticks) untouched on offbeat chords when drumAnticipationMode is keep', () => {
    const song = createSong('');
    song.members.drums.patternPreset = 'four_on_floor';
    const shifted = shiftChordBoundary(createUniformChordTimeline(['Em', 'C'], 2), 1, -0.5);

    const syncSec = createSection({
      bars: 2,
      energy: 'High',
      drumAnticipationMode: 'sync',
      chords: shifted,
    });
    const keepSec = createSection({
      bars: 2,
      energy: 'High',
      drumAnticipationMode: 'keep',
      chords: shifted,
    });

    const syncNotes = generateDrumNotes({
      song,
      section: syncSec,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(song, syncSec, 'drums', 'A'),
    });
    const keepNotes = generateDrumNotes({
      song,
      section: keepSec,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(song, keepSec, 'drums', 'A'),
    });

    // sync mode punches crash + kick at 1680 and clears 1920 downbeat kick
    expect(syncNotes.some((n) => n.pitch === GM_DRUM.CRASH && n.startTick === 1680)).toBe(true);
    expect(
      syncNotes.some((n) => n.pitch === GM_DRUM.KICK && n.startTick > 1680 && n.startTick <= 1920)
    ).toBe(false);

    // keep mode preserves four_on_floor downbeat kick at 1920 and avoids forced crash/kick punch at 1680
    expect(keepNotes.some((n) => n.pitch === GM_DRUM.CRASH && n.startTick === 1680)).toBe(false);
    expect(
      keepNotes.some((n) => n.pitch === GM_DRUM.KICK && Math.abs(n.startTick - 1920) <= 15)
    ).toBe(true);
  });

  it('guarantees bit-exact determinism, boundary safety, zero duplicates, and kickTicks consistency', () => {
    const song = createSong('');
    song.members.drums.patternPreset = 'fusion_funk';
    const section = createSection({ bars: 8, energy: 'High' });
    const params = resolveInstrumentParams(song, section, 'drums', 'A');
    const input = { song, section, sectionIndex: 0, style: 'A' as const, seed: 2026, params };

    const res1 = generateDrumResult(input);
    const res2 = generateDrumResult(input);
    expect(res1.events).toEqual(res2.events);
    expect(res1.notes).toEqual(res2.notes);
    expect(res1.kickTicks).toEqual(res2.kickTicks);

    const resOtherSeed = generateDrumResult({ ...input, seed: 9999 });
    expect(resOtherSeed.events).not.toEqual(res1.events);

    const sectionEnd = section.bars * TICKS_PER_BAR;
    const seen = new Set<string>();
    for (const ev of res1.events) {
      expect(ev.tick).toBeGreaterThanOrEqual(0);
      expect(ev.tick).toBeLessThan(sectionEnd);
      expect(ev.tick + ev.duration).toBeLessThanOrEqual(sectionEnd);
      const key = `${ev.note}:${ev.tick}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    const extractedKicks = res1.events
      .filter((e) => e.note === GM_DRUM.KICK)
      .map((e) => e.tick);
    expect(res1.kickTicks).toEqual(extractedKicks);
  });

  it('enforces 4-limb independence (<=4 simultaneous, <=2 upper limbs), hi-hat choke, and 2/4-beat HH skip at BPM=130', () => {
    const upperLimbNotes = new Set<number>([
      37, 38, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53, 55, 57,
    ]);
    const dnaIds = Object.keys(DRUM_DNA_PROFILES) as DrumGenreDNAId[];

    for (const dnaId of dnaIds) {
      const song = createSong('');
      song.bpm = 130;
      song.members.drums.patternPreset = dnaId;
      const section = createSection({ bars: 4, energy: 'High' });
      const res = generateDrumResult({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 77,
        params: resolveInstrumentParams(song, section, 'drums', 'A'),
      });

      const byTick = new Map<number, typeof res.events>();
      for (const ev of res.events) {
        const list = byTick.get(ev.tick) ?? [];
        list.push(ev);
        byTick.set(ev.tick, list);
      }

      for (const [, group] of byTick) {
        expect(group.length).toBeLessThanOrEqual(4);
        const upperCount = group.filter((e) => upperLimbNotes.has(e.note)).length;
        expect(upperCount).toBeLessThanOrEqual(2);

        const hasOpen = group.some((e) => e.note === GM_DRUM.OPEN_HH);
        const hasClosedOrPedal = group.some(
          (e) => e.note === GM_DRUM.CLOSED_HH || e.note === GM_DRUM.PEDAL_HH
        );
        expect(hasOpen && hasClosedOrPedal).toBe(false);
      }

      for (let i = 0; i < res.events.length; i++) {
        const ev = res.events[i];
        if (ev.note !== GM_DRUM.OPEN_HH) continue;
        const nextClose = res.events.find(
          (n, idx) =>
            idx > i &&
            n.tick > ev.tick &&
            (n.note === GM_DRUM.CLOSED_HH || n.note === GM_DRUM.PEDAL_HH)
        );
        if (nextClose) {
          expect(ev.tick + ev.duration).toBeLessThanOrEqual(nextClose.tick);
        }
      }
    }

    // Verify 2nd/4th beat HH skip on BPM=130 16th-note HH mode (fusion_funk Mid energy)
    const funkSong = createSong('');
    funkSong.bpm = 130;
    funkSong.members.drums.patternPreset = 'fusion_funk';
    const funkSec = createSection({ bars: 2, energy: 'Mid' });
    const funkRes = generateDrumResult({
      song: funkSong,
      section: funkSec,
      sectionIndex: 0,
      style: 'A',
      seed: 11,
      params: resolveInstrumentParams(funkSong, funkSec, 'drums', 'A'),
    });
    const bar0Beat2And4Hats = funkRes.events.filter(
      (e) =>
        (e.tick === 480 || e.tick === 1440) &&
        (e.note === GM_DRUM.CLOSED_HH || e.note === GM_DRUM.OPEN_HH)
    );
    expect(bar0Beat2And4Hats.length).toBe(0);
  });

  it('triggers kick + accent cymbal at 1680 offbeat anticipation and suppresses downbeat crash at 1920', () => {
    const song = createSong('');
    song.members.drums.patternPreset = 'emo_jrock_fast';
    const shifted = shiftChordBoundary(createUniformChordTimeline(['Em', 'C'], 2), 1, -0.5);
    const section = createSection({ bars: 2, energy: 'High', chords: shifted });

    const res = generateDrumResult({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 33,
      params: resolveInstrumentParams(song, section, 'drums', 'A'),
    });

    expect(res.events.some((e) => e.tick === 1680 && e.note === GM_DRUM.KICK)).toBe(true);
    expect(
      res.events.some(
        (e) =>
          e.tick === 1680 &&
          (e.note === GM_DRUM.CRASH_1 || e.note === GM_DRUM.CHINA || e.note === GM_DRUM.CRASH_2)
      )
    ).toBe(true);

    const bar1DownbeatCrashes = res.events.filter(
      (e) =>
        e.tick === 1920 &&
        (e.note === GM_DRUM.CRASH_1 || e.note === GM_DRUM.CHINA || e.note === GM_DRUM.CRASH_2)
    );
    expect(bar1DownbeatCrashes.length).toBe(0);
  });

  it('injects 4-bar/8-bar tom/linear fills with groove blocking and post-fill crash+kick landing', () => {
    const tomNotes = new Set<number>([50, 48, 47, 45, 43, 41]);
    const grooveCymbals = new Set<number>([42, 46, 51, 53]);

    // Standard descending tom fill check (jpop_melodic, seed tuned or checked across seeds)
    const song = createSong('');
    song.members.drums.patternPreset = 'jpop_melodic';
    const section = createSection({
      bars: 8,
      energy: 'High',
      chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 8),
    });
    const res = generateDrumResult({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 10,
      params: resolveInstrumentParams(song, section, 'drums', 'A'),
    });

    const bar3Start = 3 * TICKS_PER_BAR;
    const bar7Start = 7 * TICKS_PER_BAR;
    const bar3Toms = res.events.filter(
      (e) => e.tick >= bar3Start + 960 && e.tick < bar3Start + TICKS_PER_BAR && tomNotes.has(e.note)
    );
    const bar7Toms = res.events.filter(
      (e) => e.tick >= bar7Start + 960 && e.tick < bar7Start + TICKS_PER_BAR && tomNotes.has(e.note)
    );
    expect(bar3Toms.length).toBeGreaterThan(0);
    expect(bar7Toms.length).toBeGreaterThan(0);

    // Groove cymbals blocked inside fill window
    const bar3Cymbals = res.events.filter(
      (e) =>
        e.tick >= bar3Start + 960 &&
        e.tick < bar3Start + TICKS_PER_BAR &&
        grooveCymbals.has(e.note)
    );
    expect(bar3Cymbals.length).toBe(0);

    // Post-fill crash + kick landing at bar 4 downbeat
    const bar4Start = 4 * TICKS_PER_BAR;
    expect(res.events.some((e) => e.tick === bar4Start && e.role === 'crash')).toBe(true);
    expect(res.events.some((e) => e.tick === bar4Start && e.note === GM_DRUM.KICK)).toBe(true);

    // Linear fill check on fusion_funk (zero simultaneous hits inside fill window, descending pitch trend)
    const funkSong = createSong('');
    funkSong.members.drums.patternPreset = 'fusion_funk';
    const funkSec = createSection({
      bars: 4,
      energy: 'High',
      chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
    });
    const funkRes = generateDrumResult({
      song: funkSong,
      section: funkSec,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(funkSong, funkSec, 'drums', 'A'),
    });
    const fStart = 3 * TICKS_PER_BAR + 960;
    const fEnd = 4 * TICKS_PER_BAR;
    const fEvents = funkRes.events.filter((e) => e.tick >= fStart && e.tick < fEnd);
    const fTicks = new Set(fEvents.map((e) => e.tick));
    expect(fTicks.size).toBe(fEvents.length);
    const fToms = fEvents.filter((e) => tomNotes.has(e.note));
    if (fToms.length >= 2) {
      expect(fToms[0].note).toBeGreaterThanOrEqual(fToms[fToms.length - 1].note);
    }
  });

  it('enforces SSD 5.5 velocity tiers, Moeller HH accents, BPM-clamped microtiming, and legacy preset compatibility', () => {
    // 1. Laid-back at BPM=115 (alt_heavy_shoegaze)
    const altSong = createSong('');
    altSong.bpm = 115;
    altSong.members.drums.patternPreset = 'alt_heavy_shoegaze';
    const altSec = createSection({ bars: 4, energy: 'Mid' });
    const altRes = generateDrumResult({
      song: altSong,
      section: altSec,
      sectionIndex: 0,
      style: 'A',
      seed: 55,
      params: resolveInstrumentParams(altSong, altSec, 'drums', 'A'),
    });

    const backbeats = altRes.events.filter((e) => e.role === 'snare_backbeat');
    const ghosts = altRes.events.filter((e) => e.role === 'snare_ghost');
    expect(backbeats.length).toBeGreaterThan(0);
    const avgBackbeat =
      backbeats.reduce((sum, e) => sum + e.velocity, 0) / backbeats.length;
    expect(avgBackbeat).toBeGreaterThanOrEqual(100);
    if (ghosts.length > 0) {
      const avgGhost = ghosts.reduce((sum, e) => sum + e.velocity, 0) / ghosts.length;
      expect(avgGhost).toBeLessThan(60);
      expect(avgBackbeat - avgGhost).toBeGreaterThanOrEqual(50);
    }

    for (const bb of backbeats) {
      const local = bb.tick % TICKS_PER_BAR;
      const base = Math.abs(local - 480) < 100 ? 480 : 1440;
      const offset = local - base;
      expect(offset).toBeGreaterThanOrEqual(5);
      expect(offset).toBeLessThanOrEqual(18);
    }

    // Moeller 8th HH accent check
    const hhOn = altRes.events.filter(
      (e) => e.note === GM_DRUM.CLOSED_HH && e.tick % 480 < 30
    );
    const hhOff = altRes.events.filter(
      (e) => e.note === GM_DRUM.CLOSED_HH && Math.abs((e.tick % 480) - 240) < 30
    );
    if (hhOn.length > 0 && hhOff.length > 0) {
      const avgOn = hhOn.reduce((s, e) => s + e.velocity, 0) / hhOn.length;
      const avgOff = hhOff.reduce((s, e) => s + e.velocity, 0) / hhOff.length;
      expect(avgOn - avgOff).toBeGreaterThanOrEqual(15);
    }

    // 2. Push microtiming at BPM=160 (emo_jrock_fast)
    const emoSong = createSong('');
    emoSong.bpm = 160;
    emoSong.members.drums.patternPreset = 'emo_jrock_fast';
    const emoSec = createSection({ bars: 2, energy: 'Mid' });
    const emoRes = generateDrumResult({
      song: emoSong,
      section: emoSec,
      sectionIndex: 0,
      style: 'A',
      seed: 12,
      params: resolveInstrumentParams(emoSong, emoSec, 'drums', 'A'),
    });
    const emoBackbeats = emoRes.events.filter((e) => e.role === 'snare_backbeat');
    expect(emoBackbeats.length).toBeGreaterThan(0);
    for (const bb of emoBackbeats) {
      const local = bb.tick % TICKS_PER_BAR;
      const base = Math.abs(local - 480) < 100 ? 480 : 1440;
      const offset = local - base;
      expect(offset).toBeLessThanOrEqual(-4);
      expect(offset).toBeGreaterThanOrEqual(-10);
    }

    // 3. All legacy preset IDs compatibility
    const legacyPresets = PATTERN_PRESET_GROUPS.drums.flatMap((g) =>
      g.options.map((o) => o.value)
    );
    for (const presetId of legacyPresets) {
      const s = createSong('');
      s.members.drums.patternPreset = presetId;
      const sec = createSection({ bars: 2, energy: 'Mid' });
      const notes = generateDrumNotes({
        song: s,
        section: sec,
        sectionIndex: 0,
        style: 'A',
        seed: 7,
        params: resolveInstrumentParams(s, sec, 'drums', 'A'),
      });
      expect(notes.length).toBeGreaterThan(0);
    }
  });
});
