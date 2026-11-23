import { describe, expect, it } from 'vitest';
import {
  BEAT_TEMPLATES,
  GENRE_FLAVOR_PROFILES,
  generateDrumNotes,
  generateDrumResult,
  GM_DRUM,
  MIDI_NOTE_MAP,
  type DrumVoice,
} from '../src/engines/drumEngine';
import {
  createUniformChordTimeline,
  shiftChordBoundary,
} from '../src/lib/chordTimeline';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import type { MasterGenreId } from '../src/lib/masterGenres';
import { PATTERN_PRESET_GROUPS } from '../src/lib/patternPresets';
import {
  TICKS_PER_BAR,
  type DrumLoopData,
  type Section,
  type SongConfig,
} from '../src/types/song';

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
  it('protects anchor notes (Chorus Crash 49 & Unison accent Kick 36) from velocityCap and jitter', () => {
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

    const takeA = gen('A', 100);
    expect(takeA.filter((n) => n.pitch === 36).map((n) => n.startTick)).toEqual([
      0, 960, 1920, 2880,
    ]);

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

  it('scales hatDensity (1 vs 3 vs 5) and kickDensity (1 vs 3 vs 5) cleanly', () => {
    const song = createSong();
    song.members.drums.patternPreset = 'straight_8';
    const run = (hatDensity: 1 | 3 | 5, kickDensity: 1 | 3 | 5) => {
      const section = createSection({
        type: 'Outro',
        bars: 2,
        energy: 'Mid',
        hatDensity,
        kickDensity,
        drumFillEnabled: false,
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

    const hatsMin = rockMin.filter(
      (n) => n.pitch === GM_DRUM.CLOSED_HH || n.pitch === GM_DRUM.OPEN_HH
    );
    const hatsStd = rockStd.filter(
      (n) => n.pitch === GM_DRUM.CLOSED_HH || n.pitch === GM_DRUM.OPEN_HH
    );
    const hatsMax = rockMax.filter(
      (n) => n.pitch === GM_DRUM.CLOSED_HH || n.pitch === GM_DRUM.OPEN_HH
    );
    expect(hatsMin.length).toBe(8);
    expect(hatsStd.length).toBe(16);
    expect(hatsMax.length).toBe(32);

    const kicksMin = rockMin.filter((n) => n.pitch === GM_DRUM.KICK);
    const kicksStd = rockStd.filter((n) => n.pitch === GM_DRUM.KICK);
    const kicksMax = rockMax.filter((n) => n.pitch === GM_DRUM.KICK);
    expect(kicksMin.length).toBe(4);
    expect(kicksStd.length).toBeGreaterThanOrEqual(6);
    expect(kicksMax.length).toBeGreaterThan(kicksStd.length);
  });

  it('applies legacy patternPresets deterministically and safely without errors', () => {
    const runPreset = (preset: string, bars = 2) => {
      const song = createSong('');
      song.members.drums.patternPreset = preset;
      const section = createSection({
        bars,
        chords: createUniformChordTimeline(['Em', 'C'], bars),
        energy: 'Mid',
        drumFillEnabled: false,
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
    expect(
      metal.filter((n) => n.pitch === GM_DRUM.KICK || n.pitch === GM_DRUM.KICK_ALT).length
    ).toBeGreaterThan(minimal.filter((n) => n.pitch === GM_DRUM.KICK).length);

    const fourOnFloor = runPreset('four_on_floor', 1);
    const kickTicks = fourOnFloor
      .filter((n) => n.pitch === GM_DRUM.KICK)
      .map((n) => n.startTick);
    expect(kickTicks.length).toBe(4);
    [0, 480, 960, 1440].forEach((beatTick, idx) => {
      expect(Math.abs(kickTicks[idx] - beatTick)).toBeLessThanOrEqual(15);
    });

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
    expect(bar2Snares.length).toBeGreaterThan(bar1Snares.length);

    // All legacy preset IDs compatibility
    const legacyPresets = PATTERN_PRESET_GROUPS.drums.flatMap((g) =>
      g.options.map((o) => o.value)
    );
    for (const presetId of legacyPresets) {
      const notes = runPreset(presetId, 2);
      expect(notes.length).toBeGreaterThan(0);
    }
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

    expect(
      notes.some((n) => n.pitch === GM_DRUM.KICK && Math.abs(n.startTick - 1680) <= 15)
    ).toBe(true);
    expect(
      notes.some((n) => n.pitch === GM_DRUM.CRASH && Math.abs(n.startTick - 1680) <= 15)
    ).toBe(true);
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

    expect(syncNotes.some((n) => n.pitch === GM_DRUM.CRASH && n.startTick === 1680)).toBe(true);
    expect(
      syncNotes.some((n) => n.pitch === GM_DRUM.KICK && n.startTick > 1680 && n.startTick <= 1920)
    ).toBe(false);

    expect(keepNotes.some((n) => n.pitch === GM_DRUM.CRASH && n.startTick === 1680)).toBe(false);
    expect(
      keepNotes.some((n) => n.pitch === GM_DRUM.KICK && Math.abs(n.startTick - 1920) <= 15)
    ).toBe(true);
  });

  it('guarantees bit-exact determinism, boundary safety, zero duplicates, and kickTicks consistency', () => {
    const song = createSong('');
    song.members.drums.patternPreset = 'royal_jpop';
    const section = createSection({
      bars: 8,
      energy: 'High',
      drumPatternId: 'EIGHT_BEAT',
      drumKickTake: 'A',
    });
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
      expect(ev.tick + ev.durationTicks).toBeLessThanOrEqual(sectionEnd);
      const pitch = MIDI_NOTE_MAP.GM_STANDARD[ev.voice];
      const key = `${pitch}:${ev.tick}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    const extractedKicks = res1.events
      .filter((e) => e.voice === 'KICK_MAIN' || e.voice === 'KICK_ALT')
      .map((e) => e.tick);
    expect(res1.kickTicks).toEqual(extractedKicks);
  });

  it('supports switching between GM_STANDARD and SSD5_NATIVE MIDI output maps', () => {
    const song = createSong('');
    song.bpm = 160;
    const section = createSection({
      type: 'Chorus',
      bars: 2,
      energy: 'High',
      drumPatternId: 'DOUBLE_BASS',
      drumKickTake: 'A',
      drumFillEnabled: true,
    });
    const baseInput = {
      song,
      section,
      sectionIndex: 0,
      style: 'A' as const,
      seed: 42,
      params: resolveInstrumentParams(song, section, 'drums', 'A'),
    };

    const gmRes = generateDrumResult({ ...baseInput, midiMapMode: 'GM_STANDARD' });
    const ssdRes = generateDrumResult({ ...baseInput, midiMapMode: 'SSD5_NATIVE' });

    expect(gmRes.midiMapMode).toBe('GM_STANDARD');
    expect(ssdRes.midiMapMode).toBe('SSD5_NATIVE');
    expect(gmRes.events.length).toBe(ssdRes.events.length);

    // Verify SSD5_NATIVE-specific mappings
    expect(MIDI_NOTE_MAP.SSD5_NATIVE.HH_HALF_OPEN).toBe(62);
    expect(MIDI_NOTE_MAP.SSD5_NATIVE.HH_OPEN).toBe(64);
    expect(MIDI_NOTE_MAP.SSD5_NATIVE.CRASH_L).toBe(55);
    expect(MIDI_NOTE_MAP.SSD5_NATIVE.CHINA).toBe(31);
    expect(MIDI_NOTE_MAP.SSD5_NATIVE.TOM_MID).toBe(47);

    // Crash L at bar 0 step 0 should map to 49 in GM and 55 in SSD5
    expect(gmRes.notes.some((n) => n.pitch === 49)).toBe(true);
    expect(ssdRes.notes.some((n) => n.pitch === 55)).toBe(true);
  });

  it('enforces 4-limb independence, hi-hat choke, and two-handed 16th-beat HH skip on steps 4 & 12 at BPM=130', () => {
    const genres = Object.keys(GENRE_FLAVOR_PROFILES) as MasterGenreId[];
    const patterns = Object.keys(BEAT_TEMPLATES) as Array<keyof typeof BEAT_TEMPLATES>;

    for (const genreId of genres) {
      for (const patternId of patterns) {
        const song = createSong('');
        song.bpm = 130;
        song.members.drums.patternPreset = genreId;
        const section = createSection({
          bars: 4,
          energy: 'High',
          drumPatternId: patternId,
          drumKickTake: 'A',
        });
        const res = generateDrumResult({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed: 77,
          params: resolveInstrumentParams(song, section, 'drums', 'A'),
        });

        // No duplicate (barIndex, stepIndex, limb)
        const limbKeys = new Set<string>();
        for (const ev of res.events) {
          const k = `${ev.barIndex}:${ev.stepIndex}:${ev.limb}`;
          expect(limbKeys.has(k)).toBe(false);
          limbKeys.add(k);
        }

        // Hi-hat choke: Open/Half-Open HH never rings past next Closed/Pedal HH
        for (let i = 0; i < res.events.length; i++) {
          const ev = res.events[i];
          if (ev.voice !== 'HH_OPEN' && ev.voice !== 'HH_HALF_OPEN') continue;
          const nextClose = res.events.find(
            (n, idx) =>
              idx > i &&
              n.tick > ev.tick &&
              (n.voice === 'HH_CLOSED' || n.voice === 'HH_PEDAL')
          );
          if (nextClose) {
            expect(ev.tick + ev.durationTicks).toBeLessThanOrEqual(nextClose.tick);
          }
        }
      }
    }

    // Two-handed 16th-beat omits LH hi-hat on snare steps 4 & 12 at BPM=130
    const s16 = createSong('');
    s16.bpm = 130;
    const sec16 = createSection({
      bars: 2,
      energy: 'Mid',
      drumPatternId: 'SIXTEEN_BEAT',
      drumKickTake: 'A',
      drumFillEnabled: false,
    });
    const res16 = generateDrumResult({
      song: s16,
      section: sec16,
      sectionIndex: 0,
      style: 'A',
      seed: 11,
      params: resolveInstrumentParams(s16, sec16, 'drums', 'A'),
    });
    const beat2And4Hats = res16.events.filter(
      (e) =>
        (e.stepIndex === 4 || e.stepIndex === 12) &&
        (e.voice === 'HH_CLOSED' || e.voice === 'HH_OPEN' || e.voice === 'HH_HALF_OPEN')
    );
    expect(beat2And4Hats.length).toBe(0);
  });

  it('safely integrates drumHat16thEnabled, drumFillEnabled, and drumBreakEnabled toggles', () => {
    const tomVoices = new Set<DrumVoice>(['TOM_HI', 'TOM_MID', 'TOM_FLOOR']);
    const cymbalVoices = new Set<DrumVoice>([
      'HH_CLOSED',
      'HH_OPEN',
      'HH_HALF_OPEN',
      'RIDE_BOW',
      'RIDE_BELL',
    ]);

    // 1. drumHat16thEnabled: OFF vs ON on EIGHT_BEAT at BPM=120
    const song = createSong('');
    song.bpm = 120;
    song.members.drums.patternPreset = 'royal_jpop';

    const secOff = createSection({
      type: 'Verse',
      bars: 4,
      energy: 'Mid',
      drumPatternId: 'EIGHT_BEAT',
      drumKickTake: 'A',
      drumHat16thEnabled: false,
      drumFillEnabled: false,
      drumBreakEnabled: false,
    });
    const resOff = generateDrumResult({
      song,
      section: secOff,
      sectionIndex: 0,
      style: 'A',
      seed: 101,
      params: resolveInstrumentParams(song, secOff, 'drums', 'A'),
    });
    expect(
      resOff.events.filter((e) => cymbalVoices.has(e.voice) && e.stepIndex % 2 === 1).length
    ).toBe(0);

    const secOn = createSection({
      ...secOff,
      drumHat16thEnabled: true,
    });
    const resOn = generateDrumResult({
      song,
      section: secOn,
      sectionIndex: 0,
      style: 'A',
      seed: 101,
      params: resolveInstrumentParams(song, secOn, 'drums', 'A'),
    });
    expect(
      resOn.events.filter((e) => cymbalVoices.has(e.voice) && e.stepIndex % 2 === 1).length
    ).toBeGreaterThan(0);

    // 2. Auto-degrade drumHat16thEnabled on UPBEAT / TWO_BEAT / DOUBLE_BASS and bpm > 145
    const fastSong = createSong('');
    fastSong.bpm = 160;
    const secFast = createSection({
      ...secOn,
      drumPatternId: 'EIGHT_BEAT',
    });
    const resFast = generateDrumResult({
      song: fastSong,
      section: secFast,
      sectionIndex: 0,
      style: 'A',
      seed: 101,
      params: resolveInstrumentParams(fastSong, secFast, 'drums', 'A'),
    });
    expect(
      resFast.events.filter((e) => cymbalVoices.has(e.voice) && e.stepIndex % 2 === 1).length
    ).toBe(0);

    // 3. drumFillEnabled=false & drumBreakEnabled=false -> zero toms, seamless groove
    const lastBarStart = 3 * TICKS_PER_BAR;
    const lastBarEnd = 4 * TICKS_PER_BAR;
    const lastBarOff = resOff.events.filter(
      (e) => e.tick >= lastBarStart && e.tick < lastBarEnd
    );
    expect(lastBarOff.filter((e) => tomVoices.has(e.voice)).length).toBe(0);
    expect(
      lastBarOff.filter((e) => e.tick >= lastBarStart + 960 && cymbalVoices.has(e.voice)).length
    ).toBeGreaterThanOrEqual(3);

    // 4. drumFillEnabled=true & drumBreakEnabled=false -> final bar tom fill
    const secFill = createSection({
      type: 'Pre-Chorus',
      bars: 4,
      energy: 'High',
      drumPatternId: 'EIGHT_BEAT',
      drumFillEnabled: true,
      drumBreakEnabled: false,
    });
    const resFill = generateDrumResult({
      song,
      section: secFill,
      sectionIndex: 0,
      style: 'A',
      seed: 10,
      params: resolveInstrumentParams(song, secFill, 'drums', 'A'),
    });
    expect(
      resFill.events.filter(
        (e) => e.tick >= lastBarStart + 960 && e.tick < lastBarEnd && tomVoices.has(e.voice)
      ).length
    ).toBeGreaterThan(0);

    // 5. drumFillEnabled=false & drumBreakEnabled=true -> beat 3 hit + silence [1200..1920)
    const secBreak = createSection({
      type: 'Pre-Chorus',
      bars: 4,
      energy: 'High',
      drumPatternId: 'EIGHT_BEAT',
      drumFillEnabled: false,
      drumBreakEnabled: true,
    });
    const resBreak = generateDrumResult({
      song,
      section: secBreak,
      sectionIndex: 0,
      style: 'A',
      seed: 21,
      params: resolveInstrumentParams(song, secBreak, 'drums', 'A'),
    });
    expect(
      resBreak.events.filter((e) => e.tick >= lastBarStart + 1200 && e.tick < lastBarEnd)
    ).toEqual([]);
    expect(
      resBreak.events.some(
        (e) => e.tick === lastBarStart + 960 && e.voice === 'KICK_MAIN'
      )
    ).toBe(true);

    // 6. drumFillEnabled=true & drumBreakEnabled=true -> fill beats 2-3 + silence beat 4 [1440..1920)
    const secCombo = createSection({
      type: 'Pre-Chorus',
      bars: 4,
      energy: 'High',
      drumPatternId: 'EIGHT_BEAT',
      drumFillEnabled: true,
      drumBreakEnabled: true,
    });
    const resCombo = generateDrumResult({
      song,
      section: secCombo,
      sectionIndex: 0,
      style: 'A',
      seed: 21,
      params: resolveInstrumentParams(song, secCombo, 'drums', 'A'),
    });
    expect(
      resCombo.events.filter((e) => e.tick >= lastBarStart + 1440 && e.tick < lastBarEnd)
    ).toEqual([]);
    expect(
      resCombo.events.filter(
        (e) =>
          e.tick >= lastBarStart + 480 &&
          e.tick < lastBarStart + 1440 &&
          tomVoices.has(e.voice)
      ).length
    ).toBeGreaterThan(0);
  });
});
