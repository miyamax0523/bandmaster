import { describe, expect, it, vi } from 'vitest';
import {
  analyzeKeyboardContext,
  generateKeyboardNotes,
  KEYBOARD_GENRE_DNA,
  mulberry32,
  solveOptimalVoiceLeading,
  type KeyboardGenreProfileId,
} from '../src/engines/keyboardEngine';
import {
  getDiatonicPaletteChords,
  getSubstituteChordPalette,
} from '../src/lib/chordPalette';
import {
  createUniformChordTimeline,
  getActiveChordAtTick,
  shiftChordBoundary,
} from '../src/lib/chordTimeline';
import { getScalePitchClasses } from '../src/lib/chordUtils';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import { PATTERN_PRESET_GROUPS } from '../src/lib/patternPresets';
import { TICKS_PER_BAR, type MidiNote, type Section, type SongConfig } from '../src/types/song';

function createSong(): SongConfig {
  return {
    title: 'Key Test',
    bpm: 120,
    key: 'C',
    scale: 'Major',
    timeSignature: '4/4',
    beatFeel: 'Straight',
    swing: 0,
    swingTarget: '8th',
    exportOnlyActiveTracks: true,
    split808KickTrack: true,
    members: {
      drums: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      bass: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      keyboard: {
        enabled: true,
        activeSectionsOnly: false,
        keyboardStyle: 'Rhythm Backing',
        instructionText: '',
      },
      pad: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      vocal: { enabled: true, activeSectionsOnly: false, instructionText: '' },
    },
    sections: [],
  };
}

const section: Section = {
  id: 's1',
  type: 'Verse',
  name: 'Verse',
  bars: 2,
  energy: 'Mid',
  kickMode: 'acoustic',
  chords: createUniformChordTimeline(['C', 'Am'], 2),
};

describe('keyboardEngine', () => {
  it('avoids guitar mid-range (48..59) and stays in 60..84', () => {
    const song = createSong();
    const styles = ['Rhythm Backing', 'Arpeggio', 'Minimal Riff', 'Long Sustain'] as const;
    for (const ks of styles) {
      song.members.keyboard.keyboardStyle = ks;
      const notes = generateKeyboardNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 77,
        params: resolveInstrumentParams(song, section, 'keyboard', 'A'),
      });
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((n) => n.pitch >= 60 && n.pitch <= 84)).toBe(true);
      expect(notes.every((n) => n.channel === 1)).toBe(true);
    }
  });

  it('returns empty array when keyboard member is disabled and is deterministic', () => {
    const song = createSong();
    const params = resolveInstrumentParams(song, section, 'keyboard', 'C');
    const run1 = generateKeyboardNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'C',
      seed: 999,
      params,
    });
    const run2 = generateKeyboardNotes({
      song,
      section,
      sectionIndex: 0,
      style: 'C',
      seed: 999,
      params,
    });
    expect(run1).toEqual(run2);

    song.members.keyboard.enabled = false;
    expect(
      generateKeyboardNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'C',
        seed: 999,
        params,
      })
    ).toEqual([]);
  });

  it('applies patternPreset deterministically across keyboard presets', () => {
    const runPreset = (
      preset: string,
      density?: 1 | 2 | 3 | 4 | 5 | 6 | 7,
      seed = 1
    ) => {
      const song = createSong();
      song.members.keyboard.patternPreset = preset;
      const targetSec = density ? { ...section, keyboardDensity: density } : section;
      return generateKeyboardNotes({
        song,
        section: targetSec,
        sectionIndex: 0,
        style: 'A',
        seed,
        keyboardDensity: density,
        params: resolveInstrumentParams(song, targetSec, 'keyboard', 'A'),
      });
    };

    const sustain = runPreset('whole_sustain');
    const sustainStarts = new Set(sustain.map((n) => n.startTick));
    expect([...sustainStarts].sort((a, b) => a - b)).toEqual([0, 1920]);

    const arp16 = runPreset('arp_16th', 7);
    expect(arp16.length).toBeGreaterThanOrEqual(32);

    const ska = runPreset('offbeat_ska');
    const skaOffbeats = [240, 720, 1200, 1680];
    expect(ska.length).toBeGreaterThan(0);
    expect(
      ska.every((n) => {
        const local = n.startTick % 1920;
        return skaOffbeats.some((off) => Math.abs(local - off) <= 15);
      })
    ).toBe(true);
    skaOffbeats.forEach((off) => {
      expect(ska.some((n) => Math.abs((n.startTick % 1920) - off) <= 15)).toBe(true);
    });

    const darkLow = runPreset('dark_low_riff');
    expect(darkLow.length).toBeGreaterThan(0);
    expect(darkLow.every((n) => n.pitch >= 48 && n.pitch <= 67)).toBe(true);

    const rockRiff = runPreset('rock_power_riff');
    expect(rockRiff.length).toBeGreaterThan(0);
    expect(rockRiff.every((n) => n.pitch >= 48 && n.pitch <= 67)).toBe(true);

    const emoArp = runPreset('emo_arp_cascade');
    expect(emoArp.length).toBe(16); // Standard density 4 -> 8 notes/bar * 2 bars

    const funkClav = runPreset('funk_16th_clav');
    expect(funkClav.length).toBeGreaterThan(0);
    expect(funkClav.every((n) => n.durationTicks <= 85)).toBe(true);

    const counterMel = runPreset('counter_melody');
    expect(counterMel.length).toBe(10);
    expect(counterMel.every((n) => n.pitch >= 67 && n.pitch <= 86)).toBe(true);

    const synthPluck = runPreset('synth_pluck_arp', 6);
    expect(synthPluck.length).toBe(28);
    expect(synthPluck.every((n) => n.durationTicks <= 70)).toBe(true);

    const gospelComp = runPreset('gospel_rich_comp');
    expect(gospelComp.some((n) => n.startTick % 1920 === 1680)).toBe(true);

    // Fusion presets
    const fusionEp = runPreset('fusion_ep_comp');
    expect(fusionEp.some((n) => n.startTick % 1920 === 360 || n.startTick % 1920 === 840)).toBe(
      true
    );
    expect(new Set(fusionEp.filter((n) => n.startTick === 0).map((n) => n.pitch)).size).toBeGreaterThanOrEqual(
      4
    );

    const fusionBrass = runPreset('fusion_brass_stab');
    expect(fusionBrass.length).toBeGreaterThan(0);
    expect(fusionBrass.every((n) => n.durationTicks <= 120)).toBe(true);

    const fusionArp = runPreset('fusion_fast_arp', 6);
    expect(fusionArp.length).toBe(28);
    expect(Math.max(...fusionArp.map((n) => n.pitch)) - Math.min(...fusionArp.map((n) => n.pitch))).toBeGreaterThanOrEqual(
      14
    );

    // Electronica presets
    const poly = runPreset('electronica_polyrhythm');
    const polyTicks = poly.map((n) => n.startTick);
    expect(polyTicks.slice(0, 5)).toEqual([0, 360, 720, 1080, 1440]);
    expect(polyTicks).toContain(1800);
    expect(polyTicks).toContain(2160); // Wraps cleanly across 1920 barline

    const glitch1 = runPreset('electronica_glitch_arp', 5, 11);
    const glitch2 = runPreset('electronica_glitch_arp', 5, 99);
    expect(glitch1.length).toBeGreaterThan(0);
    expect(glitch1.every((n) => n.pitch >= 72 && n.pitch <= 84)).toBe(true);
    expect(glitch1).not.toEqual(glitch2);

    const minimalOst = runPreset('electronica_minimal_ostinato');
    const bar0OstPitches = new Set(
      minimalOst.filter((n) => n.startTick < 1920).map((n) => n.pitch)
    );
    expect(bar0OstPitches.size).toBeLessThanOrEqual(4);
    expect(bar0OstPitches.size).toBeGreaterThanOrEqual(2);
  });

  it('scales arpeggio note count strictly monotonically across keyboardDensity 1..7', () => {
    const runArp = (preset: string, density: 1 | 2 | 3 | 4 | 5 | 6 | 7) => {
      const song = createSong();
      song.members.keyboard.patternPreset = preset;
      const targetSec = { ...section, keyboardDensity: density };
      return generateKeyboardNotes({
        song,
        section: targetSec,
        sectionIndex: 0,
        style: 'A',
        seed: 7,
        keyboardDensity: density,
        params: resolveInstrumentParams(song, targetSec, 'keyboard', 'A'),
      });
    };

    const counts = ([1, 2, 3, 4, 5, 6, 7] as const).map(
      (d) => runArp('arp_up', d).length
    );
    // Expected for 2 bars: [2, 4, 10, 16, 22, 28, 36]
    expect(counts).toEqual([2, 4, 10, 16, 22, 28, 36]);
    for (let i = 0; i + 1 < counts.length; i++) {
      expect(counts[i + 1]).toBeGreaterThan(counts[i]);
    }

    const riffLow = runArp('rock_power_riff', 1);
    const riffHigh = runArp('rock_power_riff', 7);
    expect(riffHigh.length).toBeGreaterThan(riffLow.length * 4);
  });

  it('releases prior chord <= 1675 ticks and sustains new voicing from 1680 across barline 1920 on offbeat ChordSlot', () => {
    const song = createSong();
    song.members.keyboard.patternPreset = 'whole_sustain';
    const shifted = shiftChordBoundary(createUniformChordTimeline(['C', 'Am'], 2), 1, -0.5);
    const targetSec: Section = { ...section, chords: shifted };
    const notes = generateKeyboardNotes({
      song,
      section: targetSec,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(song, targetSec, 'keyboard', 'A'),
    });

    const priorNotes = notes.filter((n) => n.startTick < 1680);
    expect(priorNotes.length).toBeGreaterThan(0);
    expect(priorNotes.every((n) => n.startTick + n.durationTicks <= 1675)).toBe(true);

    const antNotes = notes.filter((n) => n.startTick === 1680);
    expect(antNotes.length).toBeGreaterThan(0);
    expect(antNotes.every((n) => n.startTick + n.durationTicks > 1920)).toBe(true);
    expect(notes.some((n) => n.startTick === 1920)).toBe(false);
  });

  it('generates accurate voicings for dim modifier palette and substitute chords (passing dim, tritone sub, borrowed IVm)', () => {
    const dimPalette = getDiatonicPaletteChords('A', 'Major', 'dim');
    expect(dimPalette.every((c) => c.endsWith('dim7'))).toBe(true);
    expect(dimPalette).toContain('C#dim7');

    const subs = getSubstituteChordPalette('C', 'Major');
    const subNames = subs.map((s) => s.chord);
    expect(subNames).toContain('C#dim7'); // #Idim7
    expect(subNames).toContain('F#dim7'); // #IVdim7
    expect(subNames).toContain('Db7'); // bII7 tritone substitute
    expect(subNames).toContain('Fm7'); // IVm7 borrowed chord
    expect(subNames).toContain('Bb7'); // bVII7 borrowed chord

    const song = createSong();
    song.key = 'C';
    song.scale = 'Major';
    song.members.keyboard.patternPreset = 'whole_sustain';
    const targetSec: Section = {
      ...section,
      bars: 4,
      chords: createUniformChordTimeline(['F#dim7', 'Db7', 'Fm7', 'Bb7'], 4),
    };
    const notes = generateKeyboardNotes({
      song,
      section: targetSec,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(song, targetSec, 'keyboard', 'A'),
    });

    // Bar 0: F#dim7 -> F#(6), A(9), C(0), D#(3)
    const bar0Pcs = new Set(notes.filter((n) => n.startTick === 0).map((n) => n.pitch % 12));
    expect([...bar0Pcs].sort((a, b) => a - b)).toEqual([0, 3, 6, 9]);

    // Bar 1: Db7 -> Db(1), F(5), Ab(8), B(11)
    const bar1Pcs = new Set(notes.filter((n) => n.startTick === 1920).map((n) => n.pitch % 12));
    expect([...bar1Pcs].sort((a, b) => a - b)).toEqual([1, 5, 8, 11]);

    // Bar 2: Fm7 -> F(5), Ab(8), C(0), Eb(3)
    const bar2Pcs = new Set(notes.filter((n) => n.startTick === 3840).map((n) => n.pitch % 12));
    expect([...bar2Pcs].sort((a, b) => a - b)).toEqual([0, 3, 5, 8]);
  });

  it('minimizes voice-leading distance (<= 2.5 semitones/voice) and resolves guide tones on tritone sub & dim7', () => {
    const song = createSong();
    song.members.keyboard.patternPreset = 'royal_jpop';
    const targetSec: Section = {
      ...section,
      bars: 6,
      chords: createUniformChordTimeline(
        ['Cmaj7', 'C#dim7', 'Dm7', 'Db7', 'Cmaj7', 'G7'],
        6
      ),
    };
    const params = resolveInstrumentParams(song, targetSec, 'keyboard', 'A');
    const ctx = analyzeKeyboardContext(
      { song, section: targetSec, sectionIndex: 0, style: 'A', seed: 10, params, bpm: 120 },
      KEYBOARD_GENRE_DNA.royal_jpop
    );
    const voicings = solveOptimalVoiceLeading(
      ctx,
      KEYBOARD_GENRE_DNA.royal_jpop,
      params,
      'royal_jpop',
      50,
      72,
      mulberry32(10)
    );

    expect(voicings.length).toBe(6);
    let totalMove = 0;
    let totalVoices = 0;
    for (let i = 1; i < voicings.length; i++) {
      const prev = voicings[i - 1];
      const curr = voicings[i];
      const len = Math.min(prev.length, curr.length);
      for (let k = 0; k < len; k++) {
        totalMove += Math.abs(curr[k] - prev[k]);
        totalVoices++;
      }
    }
    const avgMovePerVoice = totalMove / totalVoices;
    expect(avgMovePerVoice).toBeLessThanOrEqual(2.5);

    // Check guide-tone smooth resolution (<= 2 semitones) on C#dim7 -> Dm7 and Db7 -> Cmaj7
    for (const transIdx of [2, 4]) {
      const prev = voicings[transIdx - 1];
      const curr = voicings[transIdx];
      let minStep = 12;
      for (const p of prev) {
        for (const c of curr) {
          minStep = Math.min(minStep, Math.abs(c - p));
        }
      }
      expect(minStep).toBeLessThanOrEqual(2);
    }
  });

  it('avoids vocal range during singing, supports above-vocal fallback on low vocals, and injects rest obligato', () => {
    const song = createSong();
    song.members.keyboard.patternPreset = 'royal_jpop';
    const targetSec: Section = {
      ...section,
      bars: 4,
      chords: createUniformChordTimeline(['C', 'Am', 'F', 'G'], 4),
    };

    const vocalNotes: MidiNote[] = [
      { pitch: 60, velocity: 100, startTick: 0, durationTicks: 960, channel: 4 },
      { pitch: 64, velocity: 100, startTick: 960, durationTicks: 960, channel: 4 },
      // [1920, 5760) = 3840 ticks vocal rest!
      { pitch: 60, velocity: 100, startTick: 5760, durationTicks: 1920, channel: 4 },
    ];

    const notes = generateKeyboardNotes({
      song,
      section: targetSec,
      sectionIndex: 0,
      style: 'A',
      seed: 42,
      bpm: 120,
      vocalNotes,
      params: resolveInstrumentParams(song, targetSec, 'keyboard', 'A'),
    });

    // During vocal active windows [0, 1920) and [5760, 7680), keyboard top pitch <= vocalMinPitch - 3 (57)
    const activeWindowNotes = notes.filter(
      (n) => n.startTick < 1920 || n.startTick >= 5760
    );
    expect(activeWindowNotes.length).toBeGreaterThan(0);
    expect(activeWindowNotes.every((n) => n.pitch <= 57)).toBe(true);

    // During vocal rest [1920, 5760), obligato notes appear and finish >= 120 ticks before vocal re-entry (<= 5640)
    const restObligatoNotes = notes.filter(
      (n) => n.startTick >= 1920 && n.startTick < 5760 && n.pitch > 57
    );
    expect(restObligatoNotes.length).toBeGreaterThan(0);
    expect(
      restObligatoNotes.every((n) => n.startTick + n.durationTicks <= 5640)
    ).toBe(true);

    // Low vocal fallback test (vocal at MIDI 48..52 -> above-vocal sparse voicing >= 59)
    const lowVocalNotes: MidiNote[] = [
      { pitch: 48, velocity: 100, startTick: 0, durationTicks: 1920, channel: 4 },
      { pitch: 52, velocity: 100, startTick: 1920, durationTicks: 1920, channel: 4 },
    ];
    const lowSec: Section = {
      ...section,
      bars: 2,
      chords: createUniformChordTimeline(['C', 'G'], 2),
    };
    const aboveNotes = generateKeyboardNotes({
      song,
      section: lowSec,
      sectionIndex: 0,
      style: 'A',
      seed: 42,
      bpm: 120,
      vocalNotes: lowVocalNotes,
      params: resolveInstrumentParams(song, lowSec, 'keyboard', 'A'),
    });
    expect(aboveNotes.some((n) => n.pitch >= 59)).toBe(true);
  });

  it('matches active chord/scale 100% and anticipates 240-tick offbeat chord changes', () => {
    const song = createSong();
    song.members.keyboard.patternPreset = 'royal_jpop';
    const shifted = shiftChordBoundary(createUniformChordTimeline(['C', 'Am'], 2), 1, -0.5);
    const targetSec: Section = { ...section, bars: 2, chords: shifted };

    const notes = generateKeyboardNotes({
      song,
      section: targetSec,
      sectionIndex: 0,
      style: 'A',
      seed: 15,
      bpm: 120,
      params: resolveInstrumentParams(song, targetSec, 'keyboard', 'A'),
    });

    const scalePcs = new Set(getScalePitchClasses(song.key, song.scale));
    for (const n of notes) {
      const parsed = getActiveChordAtTick(
        targetSec.chords,
        n.startTick,
        song.key,
        song.scale,
        targetSec.bars
      ).parsed;
      const chordPcs = new Set(parsed.intervals.map((iv) => (parsed.rootPitchClass + iv) % 12));
      const pc = n.pitch % 12;
      expect(chordPcs.has(pc) || scalePcs.has(pc)).toBe(true);
    }

    // Anticipated chord (Am) is struck at 1680 ticks
    const antNotes = notes.filter((n) => Math.abs(n.startTick - 1680) <= 25);
    expect(antNotes.length).toBeGreaterThan(0);
  });

  it('enforces pianist top-note velocity emphasis, zero same-pitch overlap, BPM-scaled strum, and 5-genre + legacy compatibility', () => {
    const song = createSong();
    song.members.keyboard.patternPreset = 'chill_lofi_ballad';
    const targetSec: Section = {
      ...section,
      bars: 2,
      chords: createUniformChordTimeline(['Cmaj7', 'Dm9'], 2),
    };
    const params = resolveInstrumentParams(song, targetSec, 'keyboard', 'A');

    const notes70 = generateKeyboardNotes({
      song,
      section: targetSec,
      sectionIndex: 0,
      style: 'A',
      seed: 88,
      bpm: 70,
      params,
    });
    const notes175 = generateKeyboardNotes({
      song,
      section: targetSec,
      sectionIndex: 0,
      style: 'A',
      seed: 88,
      bpm: 175,
      params,
    });

    // Zero same-pitch overlap & releaseGapTicks >= 12
    const checkSamePitchGaps = (notes: MidiNote[]) => {
      const byPitch = new Map<number, MidiNote[]>();
      for (const n of notes) {
        const arr = byPitch.get(n.pitch) ?? [];
        arr.push(n);
        byPitch.set(n.pitch, arr);
      }
      for (const arr of byPitch.values()) {
        arr.sort((a, b) => a.startTick - b.startTick);
        for (let i = 0; i + 1 < arr.length; i++) {
          expect(arr[i + 1].startTick - (arr[i].startTick + arr[i].durationTicks)).toBeGreaterThanOrEqual(
            12
          );
        }
      }
    };
    checkSamePitchGaps(notes70);
    checkSamePitchGaps(notes175);

    // Top-note velocity emphasis >= +8 over inner voices within chord cluster
    const cluster175 = notes175.filter((n) => n.startTick < 120).sort((a, b) => a.pitch - b.pitch);
    if (cluster175.length >= 3) {
      const topVel = cluster175[cluster175.length - 1].velocity;
      const innerVels = cluster175.slice(1, -1).map((n) => n.velocity);
      const innerAvg = innerVels.reduce((s, v) => s + v, 0) / innerVels.length;
      expect(topVel - innerAvg).toBeGreaterThanOrEqual(8);
    }

    // BPM 175 strum spread in ticks > BPM 70 strum spread in ticks
    const spreadSpan = (notes: MidiNote[]) => {
      const cluster = notes.filter((n) => n.startTick < 200);
      const starts = cluster.map((n) => n.startTick);
      return Math.max(...starts) - Math.min(...starts);
    };
    expect(spreadSpan(notes175)).toBeGreaterThan(spreadSpan(notes70));

    // All 5 genres & all legacy presets generate notes cleanly
    const genreIds = Object.keys(KEYBOARD_GENRE_DNA) as KeyboardGenreProfileId[];
    const legacyIds = PATTERN_PRESET_GROUPS.keyboard.flatMap((g) => g.options.map((o) => o.value));
    for (const id of [...genreIds, ...legacyIds]) {
      const s = createSong();
      s.members.keyboard.patternPreset = id;
      const n = generateKeyboardNotes({
        song: s,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 5,
        bpm: 120,
        params: resolveInstrumentParams(s, section, 'keyboard', 'A'),
      });
      expect(n.length).toBeGreaterThan(0);
    }
  });

  it('is 100% deterministic with zero Math.random() calls and strict section boundary clamping', () => {
    const song = createSong();
    song.members.keyboard.patternPreset = 'chill_lofi_ballad';
    const targetSec: Section = {
      ...section,
      bars: 2,
      chords: createUniformChordTimeline(['Cmaj7', 'G7'], 2),
    };
    const params = resolveInstrumentParams(song, targetSec, 'keyboard', 'A');

    const spy = vi.spyOn(Math, 'random');
    try {
      const r1 = generateKeyboardNotes({
        song,
        section: targetSec,
        sectionIndex: 0,
        style: 'A',
        seed: 123,
        bpm: 120,
        params,
      });
      const r2 = generateKeyboardNotes({
        song,
        section: targetSec,
        sectionIndex: 0,
        style: 'A',
        seed: 123,
        bpm: 120,
        params,
      });
      const rDiff = generateKeyboardNotes({
        song,
        section: targetSec,
        sectionIndex: 0,
        style: 'A',
        seed: 456,
        bpm: 120,
        params,
      });

      expect(spy).not.toHaveBeenCalled();
      expect(r1).toEqual(r2);
      expect(r1).not.toEqual(rDiff);

      const totalTicks = targetSec.bars * TICKS_PER_BAR;
      for (const n of r1) {
        expect(n.startTick).toBeGreaterThanOrEqual(0);
        expect(n.durationTicks).toBeGreaterThan(0);
        expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(totalTicks);
      }
    } finally {
      spy.mockRestore();
    }
  });
});
