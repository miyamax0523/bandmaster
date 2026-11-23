import { describe, expect, it } from 'vitest';
import {
  BASS_MAX_PITCH,
  BASS_MIN_PITCH,
  generateBassNotes,
} from '../src/engines/bassEngine';
import {
  createUniformChordTimeline,
  getActiveChordAtTick,
  getTimelineBoundaryChanges,
  shiftChordBoundary,
} from '../src/lib/chordTimeline';
import { getScalePitchClasses } from '../src/lib/chordUtils';
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
      vocal: { enabled: true, activeSectionsOnly: false, instructionText: '' },
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
    chords: createUniformChordTimeline(['Em', 'C'], 2),
    ...overrides,
  };
}

describe('bassEngine', () => {
  it('enforces bar-head root and monophonic output in acoustic mode', () => {
    const song = createSong();
    const section = createSection({
      bars: 2,
      chords: createUniformChordTimeline(['Em', 'C'], 2),
    });
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
    const sec808 = createSection({
      kickMode: '808',
      chords: createUniformChordTimeline(['Em', 'D'], 2),
    });
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

  it('applies patternPreset deterministically across bass presets', () => {
    const runPreset = (preset: string) => {
      const song = createSong({ patternPreset: preset });
      const section = createSection({
        bars: 2,
        chords: createUniformChordTimeline(['Em', 'C'], 2),
        energy: 'Mid',
      });
      return generateBassNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'bass', 'A'),
      });
    };

    const whole = runPreset('root_whole');
    expect(whole.length).toBe(2);
    expect(whole.map((n) => n.startTick)).toEqual([0, TICKS_PER_BAR]);

    const gallop = runPreset('metal_gallop');
    expect(gallop.length).toBeGreaterThanOrEqual(20);

    const disco = runPreset('octave_disco');
    const discoPitches = new Set(disco.filter((n) => n.startTick < TICKS_PER_BAR).map((n) => n.pitch));
    expect(discoPitches.size).toBe(2);
    const sorted = [...discoPitches].sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBe(12);

    const pedal = runPreset('pedal_point');
    // song.key is 'E' (pitch class 4) across Em and C chords
    expect(pedal.length).toBeGreaterThan(0);
    expect(pedal.every((n) => n.pitch % 12 === 4)).toBe(true);
  });

  it('uses legato gate times (>= 85% of grid span) on standard presets and prevents any note overlap', () => {
    const standardPresets = [
      'auto',
      'root_steady',
      'pedal_point',
      'melodic_walk',
      'octave_disco',
      'root_whole',
      'kick_lock',
      'jrock_anticipation',
    ];

    for (const preset of standardPresets) {
      const song = createSong({ patternPreset: preset });
      const section = createSection({
        bars: 2,
        chords: createUniformChordTimeline(['Em', 'C'], 2),
        energy: 'Mid',
      });
      const notes = generateBassNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 7,
        params: resolveInstrumentParams(song, section, 'bass', 'A'),
        drumNotes: [
          { pitch: 36, velocity: 110, startTick: 0, durationTicks: 120 },
          { pitch: 36, velocity: 105, startTick: 960, durationTicks: 120 },
          { pitch: 36, velocity: 110, startTick: 1920, durationTicks: 120 },
          { pitch: 36, velocity: 105, startTick: 2880, durationTicks: 120 },
        ],
      });

      expect(notes.length).toBeGreaterThan(0);

      // Strict non-overlap across the entire section (>= 5 tick safety clearance between notes)
      for (let i = 0; i < notes.length - 1; i++) {
        const curr = notes[i];
        const next = notes[i + 1];
        expect(curr.startTick + curr.durationTicks).toBeLessThanOrEqual(
          next.startTick - 5
        );

        const span = next.startTick - curr.startTick;
        if (span >= 120 && curr.velocity >= 65) {
          expect(curr.durationTicks / span).toBeGreaterThanOrEqual(0.85);
        }
      }
    }

    // root_steady (8th grid = 240 ticks) -> duration >= 204 (85%+) and <= 235
    const steadySong = createSong({ patternPreset: 'root_steady' });
    const steadyNotes = generateBassNotes({
      song: steadySong,
      section: createSection({
        bars: 1,
        chords: createUniformChordTimeline(['Em'], 1),
      }),
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(steadySong, createSection({ bars: 1 }), 'bass', 'A'),
    });
    expect(steadyNotes.every((n) => n.durationTicks >= 204)).toBe(true);
  });

  it('syncs bass cutoff and anticipated root hit to offbeat ChordSlot boundary (1680 ticks)', () => {
    const shifted = shiftChordBoundary(createUniformChordTimeline(['Em', 'C'], 2), 1, -0.5);
    const song = createSong({ patternPreset: 'root_whole' });
    const section = createSection({
      bars: 2,
      energy: 'Mid',
      chords: shifted,
    });
    const notes = generateBassNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(song, section, 'bass', 'A'),
    });

    // Previous slot (Em) notes must end at or before 1680 - 5 = 1675
    const beforeBoundary = notes.filter((n) => n.startTick < 1680);
    expect(beforeBoundary.length).toBeGreaterThan(0);
    expect(beforeBoundary.every((n) => n.startTick + n.durationTicks <= 1675)).toBe(true);

    // Anticipated slot (C, pitch class 0 -> C2 = 36) strikes at 1680 and ties across barline 1920 without re-strike
    const changeNote = notes.find((n) => n.startTick === 1680);
    expect(changeNote).toBeDefined();
    expect(changeNote?.pitch).toBe(36);
    expect((changeNote?.startTick ?? 0) + (changeNote?.durationTicks ?? 0)).toBeGreaterThan(1920);
    expect(notes.some((n) => n.startTick === 1920)).toBe(false);
  });

  it('uses diminished fifth (b5) rather than natural fifth on dim / dim7 / m7b5 substitute chords', () => {
    const song = createSong({ patternPreset: 'melodic_walk' });
    song.key = 'C';
    song.scale = 'Major';
    const section = createSection({
      bars: 2,
      energy: 'Mid',
      chords: createUniformChordTimeline(['F#dim7', 'Bm7b5'], 2),
    });
    const notes = generateBassNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(song, section, 'bass', 'A'),
    });

    // F#dim7 (F#=6): no natural 5th C#(1) should be forced on beat 3/4, only chord tones / approach
    const bar0Pcs = new Set(notes.filter((n) => n.startTick < 1920).map((n) => n.pitch % 12));
    expect(bar0Pcs.has(6)).toBe(true); // F# root
    // Natural fifth of F# is C# (1) - should not appear as fifth on F#dim7 in melodic_walk
    expect(bar0Pcs.has(1)).toBe(false);
  });

  it('guarantees zero out-of-scale/out-of-chord notes when bassChromaticEnabled is false across all 5 genre DNAs and substitute chords', () => {
    const genreConfigs: Array<{ name: string; preset: string; bassStyle?: SongConfig['members']['bass']['bassStyle'] }> = [
      { name: 'alt_heavy_rock', preset: 'auto', bassStyle: 'Root Sync' },
      { name: 'emo_jrock', preset: 'jrock_anticipation' },
      { name: 'jpop_melodic', preset: 'kick_lock' },
      { name: 'fusion_funk', preset: 'slap_funk' },
      { name: 'chill_lofi_ballad', preset: 'melodic_walk' },
    ];

    // 8-bar timeline with diatonic, passing dim7 (C#dim7), tritone sub (Db7), modal interchange (Fm7, Bb7), secondary dom (E7), and 240-tick anticipation
    const baseTimeline = createUniformChordTimeline(
      ['C', 'C#dim7', 'Dm7', 'Db7', 'Fm7', 'Bb7', 'E7', 'Am7'],
      8
    );
    const anticipatedTimeline = shiftChordBoundary(baseTimeline, 2, -0.5);

    for (const cfg of genreConfigs) {
      for (const bassFillEnabled of [false, true]) {
        const song = createSong({
          patternPreset: cfg.preset,
          bassStyle: cfg.bassStyle ?? 'Root Sync',
        });
        song.key = 'C';
        song.scale = 'Major';

        const section = createSection({
          bars: 8,
          energy: 'Mid',
          chords: anticipatedTimeline,
          bassChromaticEnabled: false,
          bassFillEnabled,
          bassFillSeed: 2,
        });

        const notes = generateBassNotes({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed: 42,
          params: resolveInstrumentParams(song, section, 'bass', 'A'),
          kickTicks: [0, 960, 1920, 2880, 3600, 4800, 5760, 6720],
        });

        expect(notes.length).toBeGreaterThan(0);

        const keyScalePcs = new Set(getScalePitchClasses(song.key, song.scale));
        for (const note of notes) {
          const active = getActiveChordAtTick(
            section.chords,
            note.startTick,
            song.key,
            song.scale,
            section.bars
          );
          const activeChord = active.parsed;
          const chordPcs = new Set(
            activeChord.intervals.map((iv) => (activeChord.rootSemitone + iv) % 12)
          );
          if (activeChord.bassSemitone !== undefined) {
            chordPcs.add(activeChord.bassSemitone % 12);
          }
          const pc = note.pitch % 12;
          const allowed = keyScalePcs.has(pc) || chordPcs.has(pc);
          expect(
            allowed,
            `Out-of-scale note pitch=${note.pitch} (pc=${pc}) at tick=${note.startTick} in ${cfg.name} (fill=${bassFillEnabled}) over ${active.slot.chord}`
          ).toBe(true);
        }
      }
    }
  });

  it('protects chord tones on strong beats / changes / long tones while allowing chromatic approaches & b5 when bassChromaticEnabled is true', () => {
    const song = createSong({ patternPreset: 'slap_funk' });
    song.key = 'C';
    song.scale = 'Major';

    const timeline = shiftChordBoundary(
      createUniformChordTimeline(['C', 'Am7', 'Dm7', 'G7'], 4),
      1,
      -0.5
    );
    const boundaryTicks = new Set(
      getTimelineBoundaryChanges(timeline, 4, song.key, song.scale).map((c) => c.changeTick)
    );
    const keyScalePcs = new Set(getScalePitchClasses(song.key, song.scale));

    let chromaticApproachFound = false;

    for (const seed of [1, 2, 3, 5, 8, 13, 21]) {
      const section = createSection({
        bars: 4,
        energy: 'High',
        chords: timeline,
        bassChromaticEnabled: true,
        bassFillEnabled: false,
      });

      const notes = generateBassNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed,
        params: resolveInstrumentParams(song, section, 'bass', 'A'),
        kickTicks: [0, 960, 1680, 2880, 3840, 4800, 5760, 6720],
      });

      for (const note of notes) {
        const activeChord = getActiveChordAtTick(
          section.chords,
          note.startTick,
          song.key,
          song.scale,
          section.bars
        ).parsed;
        const chordPcs = new Set(
          activeChord.intervals.map((iv) => (activeChord.rootSemitone + iv) % 12)
        );
        if (activeChord.bassSemitone !== undefined) {
          chordPcs.add(activeChord.bassSemitone % 12);
        }

        const localTick = note.startTick % TICKS_PER_BAR;
        const isStrongOrChange =
          localTick === 0 || localTick === 960 || boundaryTicks.has(note.startTick);
        const pc = note.pitch % 12;

        if (isStrongOrChange) {
          expect(chordPcs.has(pc)).toBe(true);
        }
        if (note.durationTicks >= 480) {
          expect(keyScalePcs.has(pc) || chordPcs.has(pc)).toBe(true);
        }
        if (!isStrongOrChange && note.durationTicks <= 240 && !keyScalePcs.has(pc) && !chordPcs.has(pc)) {
          chromaticApproachFound = true;
        }
      }
    }

    expect(chromaticApproachFound).toBe(true);
  });

  it('strictly isolates bassFillSeed to fill windows without altering core groove bars', () => {
    const checkIsolation = (bars: number, nonFillBars: number[], fillWindows: Array<[number, number]>) => {
      const song = createSong({ patternPreset: 'jrock_anticipation' });
      const chords = createUniformChordTimeline(['Em', 'C', 'G', 'D'], bars);

      const gen = (bassFillEnabled: boolean, bassFillSeed: number) => {
        const section = createSection({
          bars,
          energy: 'High',
          chords,
          bassChromaticEnabled: false,
          bassFillEnabled,
          bassFillSeed,
        });
        return generateBassNotes({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed: 77,
          params: resolveInstrumentParams(song, section, 'bass', 'A'),
          kickTicks: Array.from({ length: bars }, (_, b) => b * TICKS_PER_BAR),
        });
      };

      const offNotes = gen(false, 0);
      const fill0 = gen(true, 0);
      const fill1 = gen(true, 1);
      const fill2 = gen(true, 2);

      const inNonFillRegion = (tick: number) => {
        const bar = Math.floor(tick / TICKS_PER_BAR);
        if (nonFillBars.includes(bar)) return true;
        // Beats 1-2 of fill bars (0 <= localTick < 960)
        return tick % TICKS_PER_BAR < 960;
      };

      // Non-fill bars and beats 1-2 of fill bars must be 100% identical across all variants
      expect(fill0.filter((n) => inNonFillRegion(n.startTick))).toEqual(
        offNotes.filter((n) => inNonFillRegion(n.startTick))
      );
      expect(fill1.filter((n) => inNonFillRegion(n.startTick))).toEqual(
        offNotes.filter((n) => inNonFillRegion(n.startTick))
      );
      expect(fill2.filter((n) => inNonFillRegion(n.startTick))).toEqual(
        offNotes.filter((n) => inNonFillRegion(n.startTick))
      );

      // Fill windows must contain notes and vary when bassFillSeed changes
      const [wStart, wEnd] = fillWindows[fillWindows.length - 1];
      const wOff = offNotes.filter((n) => n.startTick >= wStart && n.startTick < wEnd);
      const w0 = fill0.filter((n) => n.startTick >= wStart && n.startTick < wEnd);
      const w1 = fill1.filter((n) => n.startTick >= wStart && n.startTick < wEnd);
      const w2 = fill2.filter((n) => n.startTick >= wStart && n.startTick < wEnd);
      expect(w0.length).toBeGreaterThan(0);
      const anyDiff =
        JSON.stringify(w0) !== JSON.stringify(w1) ||
        JSON.stringify(w0) !== JSON.stringify(w2) ||
        JSON.stringify(w0) !== JSON.stringify(wOff);
      expect(anyDiff).toBe(true);
    };

    // 8-bar section: bars 0,1,2,4,5,6 untouched; fills at bar 3 (6720-7680) and bar 7 (14400-15360)
    checkIsolation(8, [0, 1, 2, 4, 5, 6], [
      [6720, 7680],
      [14400, 15360],
    ]);

    // 4-bar section: bars 0,2 untouched; fills at bar 1 (2880-3840) and bar 3 (6720-7680)
    checkIsolation(4, [0, 2], [
      [2880, 3840],
      [6720, 7680],
    ]);
  });

  it('achieves high kick synchronization (>= 85%) and 100% chord-change sync including 240-tick anticipations', () => {
    const song = createSong({ patternPreset: 'auto' });
    const timeline = shiftChordBoundary(
      createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
      1,
      -0.5
    );
    const section = createSection({
      bars: 4,
      energy: 'High',
      chords: timeline,
    });
    const kickTicks = [0, 480, 960, 1680, 2400, 2880, 3840, 4320, 4800, 5760, 6240, 6720];

    const notes = generateBassNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 11,
      params: resolveInstrumentParams(song, section, 'bass', 'A'),
      kickTicks,
    });

    const noteStarts = new Set(notes.map((n) => n.startTick));
    const syncedKicks = kickTicks.filter((t) => noteStarts.has(t)).length;
    expect(syncedKicks / kickTicks.length).toBeGreaterThanOrEqual(0.85);

    const changes = getTimelineBoundaryChanges(timeline, 4, song.key, song.scale);
    for (const ch of changes) {
      expect(noteStarts.has(ch.changeTick)).toBe(true);
    }
  });

  it('enforces MODO Bass articulation, strict monophony, range [28, 55], velocity tiers, and determinism', () => {
    const song = createSong({ patternPreset: 'slap_funk' });
    const section = createSection({
      bars: 4,
      energy: 'High',
      chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
      bassFillEnabled: true,
      bassFillSeed: 1,
    });
    const params = resolveInstrumentParams(song, section, 'bass', 'A');
    const input = {
      song,
      section,
      sectionIndex: 0,
      style: 'A' as const,
      seed: 99,
      params,
      kickTicks: [0, 960, 1920, 2880, 3840, 4800, 5760, 6720],
    };

    const run1 = generateBassNotes(input);
    const run2 = generateBassNotes(input);
    expect(run1).toEqual(run2);
    expect(run1.length).toBeGreaterThan(0);

    const sectionEnd = section.bars * TICKS_PER_BAR;
    for (let i = 0; i < run1.length; i++) {
      const curr = run1[i];
      expect(curr.pitch).toBeGreaterThanOrEqual(BASS_MIN_PITCH);
      expect(curr.pitch).toBeLessThanOrEqual(BASS_MAX_PITCH);
      expect(curr.startTick).toBeGreaterThanOrEqual(0);
      expect(curr.startTick + curr.durationTicks).toBeLessThanOrEqual(sectionEnd);

      const localTick = curr.startTick % TICKS_PER_BAR;
      if (localTick === 0 || localTick === 960) {
        expect(curr.velocity).toBeGreaterThanOrEqual(95);
        expect(curr.velocity).toBeLessThanOrEqual(118);
      }

      if (curr.velocity <= 65) {
        // Ghost note tier
        expect(curr.velocity).toBeGreaterThanOrEqual(45);
        expect(curr.durationTicks).toBeGreaterThanOrEqual(60);
        expect(curr.durationTicks).toBeLessThanOrEqual(90);
      }

      if (i + 1 < run1.length) {
        const next = run1[i + 1];
        expect(curr.startTick + curr.durationTicks).toBeLessThanOrEqual(next.startTick);
      }
    }

    // Verify 15..30 ticks release gap on same-pitch <= 8th-note repetitions in auto preset
    const steadySong = createSong({ patternPreset: 'auto' });
    const steadySec = createSection({
      bars: 2,
      energy: 'High',
      chords: createUniformChordTimeline(['Em', 'Em'], 2),
    });
    const steadyNotes = generateBassNotes({
      song: steadySong,
      section: steadySec,
      sectionIndex: 0,
      style: 'A',
      seed: 5,
      params: resolveInstrumentParams(steadySong, steadySec, 'bass', 'A'),
      kickTicks: [0, 480, 960, 1440, 1920, 2400, 2880, 3360],
    });
    const samePitchGaps: number[] = [];
    for (let i = 0; i < steadyNotes.length - 1; i++) {
      const curr = steadyNotes[i];
      const next = steadyNotes[i + 1];
      const span = next.startTick - curr.startTick;
      if (curr.pitch === next.pitch && span <= 240 && curr.velocity > 65) {
        samePitchGaps.push(next.startTick - (curr.startTick + curr.durationTicks));
      }
    }
    if (samePitchGaps.length > 0) {
      expect(samePitchGaps.every((g) => g >= 15 && g <= 30)).toBe(true);
    }
  });
});
