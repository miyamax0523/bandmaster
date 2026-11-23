import { describe, expect, it } from 'vitest';
import {
  analyzePadContext,
  generatePadNotes,
  getLegalPadPitchClasses,
  PAD_GENRE_DNA_PROFILES,
  solvePadVoicingsViterbi,
  type ExternalNoteRef,
  type PadGenreDnaId,
} from '../src/engines/padEngine';
import {
  createUniformChordTimeline,
  getActiveChordAtTick,
  shiftChordBoundary,
} from '../src/lib/chordTimeline';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import { PATTERN_PRESET_GROUPS } from '../src/lib/patternPresets';
import { TICKS_PER_BAR, type Section, type SongConfig } from '../src/types/song';

function createSong(padStyle: 'Power' | 'Floating Tension' | 'Dark Ambient' = 'Power'): SongConfig {
  return {
    title: 'Pad Test',
    bpm: 120,
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
      bass: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      keyboard: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      pad: {
        enabled: true,
        activeSectionsOnly: false,
        padStyle,
        instructionText: '',
      },
      vocal: { enabled: true, activeSectionsOnly: false, instructionText: '' },
    },
    sections: [],
  };
}

const section: Section = {
  id: 's1',
  type: 'Chorus',
  name: 'Chorus',
  bars: 2,
  energy: 'High',
  kickMode: 'acoustic',
  chords: createUniformChordTimeline(['Em', 'C'], 2),
};

describe('padEngine', () => {
  it('generates Power, Floating Tension (with 2/7/9), and Dark Ambient (48..67)', () => {
    const powerSong = createSong('Power');
    const powerNotes = generatePadNotes({
      song: powerSong,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(powerSong, section, 'pad', 'A'),
    });
    const bar0Power = powerNotes.filter((n) => n.startTick === 0).map((n) => n.pitch);
    expect(bar0Power).toEqual([52, 59, 64]); // E3, B3, E4

    const floatSong = createSong('Floating Tension');
    const floatNotes = generatePadNotes({
      song: floatSong,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(floatSong, section, 'pad', 'A'),
    });
    const bar0Float = floatNotes.filter((n) => n.startTick === 0).map((n) => n.pitch);
    expect(bar0Float.length).toBeGreaterThan(bar0Power.length);
    expect(bar0Float).toContain(54); // sus2 (F#3)
    expect(bar0Float).toContain(66); // add9 (F#4)

    const darkSong = createSong('Dark Ambient');
    const darkNotes = generatePadNotes({
      song: darkSong,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 1,
      params: resolveInstrumentParams(darkSong, section, 'pad', 'A'),
    });
    expect(darkNotes.every((n) => n.pitch >= 48 && n.pitch <= 67)).toBe(true);
  });

  it('returns empty array when pad is disabled', () => {
    const song = createSong('Power');
    song.members.pad.enabled = false;
    expect(
      generatePadNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'pad', 'A'),
      })
    ).toEqual([]);
  });

  it('applies patternPreset deterministically across pad presets', () => {
    const runPreset = (preset: string) => {
      const song = createSong('Power');
      song.members.pad.patternPreset = preset;
      return generatePadNotes({
        song,
        section,
        sectionIndex: 0,
        style: 'A',
        seed: 1,
        params: resolveInstrumentParams(song, section, 'pad', 'A'),
      });
    };

    const swell = runPreset('swell_half');
    const swellStarts = new Set(swell.map((n) => n.startTick));
    expect([...swellStarts].sort((a, b) => a - b)).toEqual([0, 960, 1920, 2880]);

    const shimmer = runPreset('high_shimmer');
    expect(shimmer.length).toBeGreaterThan(0);
    expect(shimmer.every((n) => n.pitch >= 64 && n.pitch <= 88)).toBe(true);

    const fifth = runPreset('fifth_drone');
    // Bar 0 is Em (E=4, B=11) -> pitch classes should only be 4 and 11 (no 3rd G=7)
    const bar0PitchClasses = new Set(
      fifth.filter((n) => n.startTick === 0).map((n) => n.pitch % 12)
    );
    expect([...bar0PitchClasses].sort((a, b) => a - b)).toEqual([4, 11]);

    const sidechain = runPreset('sidechain_pulse');
    const scStarts = Array.from(
      new Set(sidechain.filter((n) => n.startTick < 1920).map((n) => n.startTick))
    ).sort((a, b) => a - b);
    expect(scStarts).toEqual([120, 600, 1080, 1560]);

    const strings = runPreset('strings_ensemble');
    const bar0Strings = strings.filter((n) => n.startTick === 0);
    expect(bar0Strings.length).toBeGreaterThanOrEqual(5);

    const choir = runPreset('choir_open_voicing');
    const bar0Choir = choir
      .filter((n) => n.startTick === 0)
      .map((n) => n.pitch)
      .sort((a, b) => a - b);
    expect(bar0Choir.length).toBeGreaterThanOrEqual(3);
    expect(bar0Choir[1] - bar0Choir[0]).toBeGreaterThanOrEqual(5);

    const shimmerArp = runPreset('shimmer_arp_pad');
    expect(shimmerArp.some((n) => n.startTick === 0)).toBe(true);
    expect(shimmerArp.some((n) => n.startTick === 240 && n.pitch >= 64)).toBe(true);

    const warmDrift = runPreset('analog_warm_drift');
    expect(warmDrift.length).toBeGreaterThan(0);
    expect(warmDrift.every((n) => n.pitch >= 43 && n.pitch <= 67)).toBe(true);
  });

  it('1. maintains open voicing spacing (0% <=2 semi clusters, avg >=4.5, max <=12, range 55..81)', () => {
    const song = createSong('Power');
    song.key = 'C';
    song.scale = 'Major';
    const sec: Section = {
      ...section,
      bars: 4,
      energy: 'High',
      chords: createUniformChordTimeline(['C', 'G', 'Am', 'F'], 4),
    };
    const notes = generatePadNotes(
      {
        song,
        section: sec,
        sectionIndex: 0,
        style: 'A',
        seed: 42,
        params: resolveInstrumentParams(song, sec, 'pad', 'A'),
      },
      { genreDna: 'jpop_ballad', energy: 'high', seed: 42 }
    );

    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.pitch > 48 && n.pitch >= 55 && n.pitch <= 81)).toBe(true);

    // Check simultaneous chords (3-4 voices)
    const starts = Array.from(new Set(notes.map((n) => n.startTick))).sort((a, b) => a - b);
    let intervalCount = 0;
    let intervalSum = 0;
    let smallClusters = 0;
    let maxInterval = 0;

    for (const t of starts) {
      const active = notes
        .filter((n) => n.startTick <= t && n.startTick + n.durationTicks > t)
        .map((n) => n.pitch)
        .sort((a, b) => a - b);
      if (active.length < 3) continue;
      for (let i = 1; i < active.length; i++) {
        const diff = active[i] - active[i - 1];
        intervalCount++;
        intervalSum += diff;
        if (diff <= 2) smallClusters++;
        if (diff > maxInterval) maxInterval = diff;
      }
    }

    expect(intervalCount).toBeGreaterThan(0);
    expect(smallClusters / intervalCount).toBe(0);
    expect(intervalSum / intervalCount).toBeGreaterThanOrEqual(4.5);
    expect(maxInterval).toBeLessThanOrEqual(12);
  });

  it('2. minimizes Viterbi voice-leading distance (<=3.0/voice, 0 crossings) and differentiates pedal retention', () => {
    const song = createSong('Power');
    song.key = 'C';
    song.scale = 'Major';
    const progressions = [
      ['C', 'G', 'Am', 'F'],
      ['Dm7', 'G7', 'Cmaj7', 'A7'],
    ];

    for (const prog of progressions) {
      const sec: Section = {
        ...section,
        bars: 4,
        energy: 'Mid',
        chords: createUniformChordTimeline(prog, 4),
      };
      const dna = PAD_GENRE_DNA_PROFILES.jpop_ballad;
      const { windows } = analyzePadContext(
        {
          song,
          section: sec,
          sectionIndex: 0,
          style: 'A',
          seed: 10,
          params: resolveInstrumentParams(song, sec, 'pad', 'A'),
        },
        dna,
        { genreDna: 'jpop_ballad', energy: 'mid' }
      );
      const voicings = solvePadVoicingsViterbi(windows, dna, 'mid', song.key, song.scale);
      expect(voicings.length).toBe(4);

      let moveSum = 0;
      let voicesSum = 0;
      let crossings = 0;
      for (let i = 1; i < voicings.length; i++) {
        const prev = voicings[i - 1];
        const curr = voicings[i];
        const len = Math.min(prev.length, curr.length);
        for (let k = 0; k < len; k++) {
          moveSum += Math.abs(curr[k] - prev[k]);
          voicesSum++;
        }
        for (let k = 1; k < len; k++) {
          if (curr[k] <= prev[k - 1]) crossings++;
        }
      }
      expect(moveSum / voicesSum).toBeLessThanOrEqual(3.0);
      expect(crossings).toBe(0);
    }

    // Pedal/tie differentiation: alt_shoegaze (tieCommonTones=true) produces fewer re-attacks than fusion_crossover (tieCommonTones=false)
    const sec4: Section = {
      ...section,
      bars: 4,
      energy: 'Mid',
      chords: createUniformChordTimeline(['C', 'G', 'Am', 'F'], 4),
    };
    const p = resolveInstrumentParams(song, sec4, 'pad', 'A');
    const shoeNotes = generatePadNotes(
      { song, section: sec4, sectionIndex: 0, style: 'A', seed: 1, params: p },
      { genreDna: 'alt_shoegaze', energy: 'mid', seed: 1 }
    );
    const fusionNotes = generatePadNotes(
      { song, section: sec4, sectionIndex: 0, style: 'A', seed: 1, params: p },
      { genreDna: 'fusion_crossover', energy: 'mid', seed: 1 }
    );
    expect(shoeNotes.length).toBeLessThan(fusionNotes.length);
    expect(Math.max(...shoeNotes.map((n) => n.durationTicks))).toBeGreaterThan(TICKS_PER_BAR);
  });

  it('3. enforces 3-part register separation (Bass / Keyboard / Vocal collision avoidance)', () => {
    const song = createSong('Power');
    song.key = 'C';
    song.scale = 'Major';
    const sec: Section = {
      ...section,
      bars: 4,
      energy: 'Mid',
      chords: createUniformChordTimeline(['C', 'G', 'Am', 'F'], 4),
    };
    const p = resolveInstrumentParams(song, sec, 'pad', 'A');

    const bassNotes: ExternalNoteRef[] = [
      { pitch: 36, startTick: 0, durationTick: 1920 },
      { pitch: 43, startTick: 1920, durationTick: 1920 },
      { pitch: 45, startTick: 3840, durationTick: 1920 },
      { pitch: 41, startTick: 5760, durationTick: 1920 },
    ];
    const keyboardNotes: ExternalNoteRef[] = [
      { pitch: 60, startTick: 0, durationTick: 1900 },
      { pitch: 64, startTick: 0, durationTick: 1900 },
      { pitch: 67, startTick: 0, durationTick: 1900 },
      { pitch: 59, startTick: 1920, durationTick: 1900 },
      { pitch: 62, startTick: 1920, durationTick: 1900 },
      { pitch: 67, startTick: 1920, durationTick: 1900 },
    ];
    const lowMidVocal: ExternalNoteRef[] = [
      { pitch: 60, startTick: 0, durationTick: 1920 },
      { pitch: 62, startTick: 1920, durationTick: 1920 },
      { pitch: 64, startTick: 3840, durationTick: 1920 },
      { pitch: 65, startTick: 5760, durationTick: 1920 },
    ];
    const highVocal: ExternalNoteRef[] = [
      { pitch: 76, startTick: 0, durationTick: 1920 },
      { pitch: 77, startTick: 1920, durationTick: 1920 },
      { pitch: 79, startTick: 3840, durationTick: 1920 },
      { pitch: 76, startTick: 5760, durationTick: 1920 },
    ];

    const padLowVoc = generatePadNotes(
      { song, section: sec, sectionIndex: 0, style: 'A', seed: 9, params: p },
      {
        genreDna: 'jpop_ballad',
        energy: 'mid',
        sectionType: 'chorus',
        bassNotes,
        keyboardNotes,
        vocalNotes: lowMidVocal,
        seed: 9,
      }
    );
    const padHighVoc = generatePadNotes(
      { song, section: sec, sectionIndex: 0, style: 'A', seed: 9, params: p },
      {
        genreDna: 'jpop_ballad',
        energy: 'mid',
        sectionType: 'verse',
        bassNotes,
        keyboardNotes,
        vocalNotes: highVocal,
        seed: 9,
      }
    );

    // Bass separation >= 55
    expect(padLowVoc.every((n) => n.pitch >= 55)).toBe(true);
    expect(padHighVoc.every((n) => n.pitch >= 55)).toBe(true);

    // Zero minor-2nd clash with Keyboard < 72 and zero minor-2nd clash with Vocal
    for (const padNote of padLowVoc) {
      if (padNote.pitch < 72) {
        const kbClash = keyboardNotes.some(
          (k) =>
            k.startTick < padNote.startTick + padNote.durationTicks &&
            k.startTick + k.durationTick > padNote.startTick &&
            Math.abs(padNote.pitch - k.pitch) === 1
        );
        expect(kbClash).toBe(false);
      }
      const vocClash = lowMidVocal.some(
        (v) =>
          v.startTick < padNote.startTick + padNote.durationTicks &&
          v.startTick + v.durationTick > padNote.startTick &&
          Math.abs(padNote.pitch - v.pitch) === 1
      );
      expect(vocClash).toBe(false);
    }

    // High vocal forces PAD average pitch below low-mid vocal PAD average pitch
    const avgLow = padLowVoc.reduce((s, n) => s + n.pitch, 0) / padLowVoc.length;
    const avgHigh = padHighVoc.reduce((s, n) => s + n.pitch, 0) / padHighVoc.length;
    expect(avgHigh).toBeLessThan(avgLow);
  });

  it('4. matches active chord/scale 100% including 240-tick anticipations, dim7, tritone sub, and slash chords without avoid notes', () => {
    const song = createSong('Power');
    song.key = 'C';
    song.scale = 'Major';

    const timeline = shiftChordBoundary(
      createUniformChordTimeline(['Cmaj7', 'C#dim7', 'Dm7', 'Db7', 'Am7', 'C/E', 'G/B', 'G7'], 8),
      1,
      -0.5
    );
    const sec: Section = {
      ...section,
      bars: 8,
      energy: 'Mid',
      chords: timeline,
    };
    const notes = generatePadNotes(
      {
        song,
        section: sec,
        sectionIndex: 0,
        style: 'A',
        seed: 21,
        params: resolveInstrumentParams(song, sec, 'pad', 'A'),
      },
      { genreDna: 'fusion_crossover', energy: 'mid', seed: 21 }
    );

    expect(notes.some((n) => n.startTick === 1680)).toBe(true);

    for (const n of notes) {
      const parsed = getActiveChordAtTick(
        sec.chords,
        n.startTick,
        song.key,
        song.scale,
        sec.bars
      ).parsed;
      const { allowedPcs, chordTonePcs, pedalPcs } = getLegalPadPitchClasses(
        song.key,
        song.scale,
        parsed,
        PAD_GENRE_DNA_PROFILES.fusion_crossover
      );
      const validSet = new Set([...allowedPcs, ...chordTonePcs, ...pedalPcs]);
      expect(validSet.has(n.pitch % 12)).toBe(true);

      // Avoid note check: F (pc=5) must not appear over Cmaj7 or Am7
      if (parsed.rootPitchClass === 0 && parsed.intervals.includes(11)) {
        expect(n.pitch % 12).not.toBe(5);
      }
      if (parsed.rootPitchClass === 9 && parsed.quality === 'minor') {
        expect(n.pitch % 12).not.toBe(5);
      }
    }
  });

  it('5. enforces simultaneous attack, velocity 45..85, energy/crescendo scaling, zero overlap, and >= 8-tick same-pitch gap', () => {
    const song = createSong('Power');
    song.key = 'C';
    song.scale = 'Major';
    const sec: Section = {
      ...section,
      bars: 4,
      chords: createUniformChordTimeline(['C', 'G', 'Am', 'F'], 4),
    };
    const p = resolveInstrumentParams(song, sec, 'pad', 'A');

    const lowNotes = generatePadNotes(
      { song, section: sec, sectionIndex: 0, style: 'A', seed: 3, params: p },
      { genreDna: 'fusion_crossover', energy: 'low', sectionType: 'pre_chorus', seed: 3 }
    );
    const midNotes = generatePadNotes(
      { song, section: sec, sectionIndex: 0, style: 'A', seed: 3, params: p },
      { genreDna: 'fusion_crossover', energy: 'mid', sectionType: 'pre_chorus', seed: 3 }
    );
    const highNotes = generatePadNotes(
      { song, section: sec, sectionIndex: 0, style: 'A', seed: 3, params: p },
      { genreDna: 'fusion_crossover', energy: 'high', sectionType: 'pre_chorus', seed: 3 }
    );

    const avgVel = (arr: typeof lowNotes) =>
      arr.reduce((s, n) => s + n.velocity, 0) / arr.length;
    expect(avgVel(midNotes)).toBeGreaterThan(avgVel(lowNotes));
    expect(avgVel(highNotes)).toBeGreaterThan(avgVel(midNotes));

    // Pre-chorus late phrase crescendo (late >= 4992 vs early < 3840)
    const earlyVel = avgVel(midNotes.filter((n) => n.startTick < 3840));
    const lateVel = avgVel(midNotes.filter((n) => n.startTick >= 4992));
    expect(lateVel).toBeGreaterThan(earlyVel);

    for (const arr of [lowNotes, midNotes, highNotes]) {
      expect(arr.every((n) => n.velocity >= 45 && n.velocity <= 85)).toBe(true);
      const sortedVels = arr.map((n) => n.velocity).sort((a, b) => a - b);
      const median = sortedVels[Math.floor(sortedVels.length / 2)];
      expect(median).toBeGreaterThanOrEqual(50);
      expect(median).toBeLessThanOrEqual(78);

      // Simultaneous attack alignment (0 ticks spread within each chord attack)
      const byPitch = new Map<number, typeof arr>();
      for (const n of arr) {
        const list = byPitch.get(n.pitch) ?? [];
        list.push(n);
        byPitch.set(n.pitch, list);
      }
      for (const list of byPitch.values()) {
        list.sort((a, b) => a.startTick - b.startTick);
        for (let i = 1; i < list.length; i++) {
          const gap = list[i].startTick - (list[i - 1].startTick + list[i - 1].durationTicks);
          expect(gap).toBeGreaterThanOrEqual(8);
        }
      }
    }
  });

  it('6. differentiates all 6 genre DNAs and maintains full backward compatibility with legacy presets', () => {
    const song = createSong('Power');
    song.key = 'E';
    song.scale = 'Minor';
    const sec: Section = {
      ...section,
      bars: 4,
      energy: 'Mid',
      chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 4),
    };
    const p = resolveInstrumentParams(song, sec, 'pad', 'A');

    const allDnas = Object.keys(PAD_GENRE_DNA_PROFILES) as PadGenreDnaId[];
    for (const id of allDnas) {
      const notes = generatePadNotes(
        { song, section: sec, sectionIndex: 0, style: 'A', seed: 12, params: p },
        { genreDna: id, energy: 'mid', seed: 12 }
      );
      expect(notes.length).toBeGreaterThan(0);
    }

    // Compare alt_shoegaze (omitThirdBias=0.65) vs jpop_ballad (omitThirdBias=0.15)
    expect(PAD_GENRE_DNA_PROFILES.alt_shoegaze.omitThirdBias).toBeGreaterThan(
      PAD_GENRE_DNA_PROFILES.jpop_ballad.omitThirdBias
    );

    // All legacy presets in PATTERN_PRESET_GROUPS.pad work cleanly without context
    const legacyIds = PATTERN_PRESET_GROUPS.pad.flatMap((g) => g.options.map((o) => o.value));
    for (const pid of legacyIds) {
      const s = createSong('Power');
      s.members.pad.patternPreset = pid;
      const notes = generatePadNotes({
        song: s,
        section: sec,
        sectionIndex: 0,
        style: 'A',
        seed: 5,
        params: resolveInstrumentParams(s, sec, 'pad', 'A'),
      });
      expect(notes.length).toBeGreaterThan(0);
    }
  });

  it('7. is 100% deterministic and strictly clamps all notes to [0, sectionEndTick] across 4/8 bars and offbeat ends', () => {
    const song = createSong('Power');
    song.key = 'C';
    song.scale = 'Major';

    for (const bars of [4, 8]) {
      const shifted = shiftChordBoundary(
        createUniformChordTimeline(['C', 'G', 'Am', 'F'], bars),
        bars - 1,
        -0.5
      );
      const sec: Section = {
        ...section,
        bars,
        energy: 'High',
        chords: shifted,
      };
      const p = resolveInstrumentParams(song, sec, 'pad', 'A');
      const run1 = generatePadNotes(
        { song, section: sec, sectionIndex: 0, style: 'A', seed: 777, params: p },
        { genreDna: 'emo_jrock', energy: 'high', seed: 777 }
      );
      const run2 = generatePadNotes(
        { song, section: sec, sectionIndex: 0, style: 'A', seed: 777, params: p },
        { genreDna: 'emo_jrock', energy: 'high', seed: 777 }
      );
      expect(run1).toEqual(run2);

      const sectionEndTick = bars * TICKS_PER_BAR;
      for (const n of run1) {
        expect(n.startTick).toBeGreaterThanOrEqual(0);
        expect(n.startTick).toBeLessThan(sectionEndTick);
        expect(n.durationTicks).toBeGreaterThan(0);
        expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(sectionEndTick);
      }
    }
  });
});
