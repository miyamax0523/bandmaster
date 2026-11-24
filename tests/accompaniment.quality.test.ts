import { describe, expect, it } from 'vitest';
import {
  ALL_BEAT_PATTERN_IDS,
  generateDrumResult,
} from '../src/engines/drumEngine';
import { generateBassSkeletonTrack } from '../src/engines/bassEngine';
import { generateKeyboardSkeletonTrack } from '../src/engines/keyboardEngine';
import { generatePadSkeletonTrack } from '../src/engines/padEngine';
import {
  BAR_TICKS,
  BASS_MAX_MIDI,
  BASS_MIN_MIDI,
  flattenToOrderedSmfEvents,
} from '../src/engines/musicCore';
import {
  DRUM_SYNC_TABLE,
  resolveEnsembleSyncPlan,
} from '../src/engines/ensembleSync';
import { createUniformChordTimeline } from '../src/lib/chordTimeline';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import type { MasterGenreId } from '../src/lib/masterGenres';
import type {
  BeatPatternId,
  MidiNote,
  Section,
  SectionType,
  SongConfig,
} from '../src/types/song';

const ALL_GENRES: readonly MasterGenreId[] = [
  'alt_shoegaze',
  'emo_jrock',
  'numetal_mixture',
  'royal_jpop',
  'chill_ballad',
];

const ALL_SECTION_TYPES: readonly SectionType[] = [
  'Intro',
  'Verse',
  'Pre-Chorus',
  'Chorus',
  'Bridge',
  'Outro',
];

function createFixture(options?: {
  bpm?: number;
  bars?: number;
  sectionType?: SectionType;
  drumPatternId?: BeatPatternId;
  genreId?: MasterGenreId;
  chords?: string[];
  sectionOverrides?: Partial<Section>;
}): { song: SongConfig; section: Section } {
  const bpm = options?.bpm ?? 136;
  const bars = options?.bars ?? 8;
  const genreId = options?.genreId ?? 'royal_jpop';
  const chords = options?.chords ?? ['Em', 'C', 'G', 'D'];
  const section: Section = {
    id: 'sec-acc-1',
    type: options?.sectionType ?? 'Chorus',
    name: 'Test Section',
    bars,
    energy: 'High',
    kickMode: 'acoustic',
    drumPatternId: options?.drumPatternId ?? 'EIGHT_BEAT',
    drumKickTake: 'A',
    drumFillEnabled: false,
    drumBreakEnabled: false,
    chords: createUniformChordTimeline(chords, bars),
    ...options?.sectionOverrides,
  };
  const song: SongConfig = {
    title: 'Accompaniment Quality Suite',
    bpm,
    key: 'G',
    scale: 'Major',
    timeSignature: '4/4',
    beatFeel: 'Straight',
    swing: 0,
    swingTarget: '16th',
    exportOnlyActiveTracks: false,
    split808KickTrack: false,
    members: {
      drums: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: genreId,
        instructionText: '',
      },
      bass: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: genreId,
        instructionText: '',
      },
      keyboard: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: genreId,
        instructionText: '',
      },
      pad: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: genreId,
        instructionText: '',
      },
      vocal: {
        enabled: true,
        activeSectionsOnly: false,
        patternPreset: genreId,
        instructionText: '',
      },
    },
    sections: [section],
  };
  return { song, section };
}

describe('Accompaniment 3-Engine Quality & Drum-Sync Suite', () => {
  it('1. Bass quality: KICK_LOCK >= 0.95 sync, EIGHTH_ROOT 1.00 non-turnaround 8-hit, beat-4 turnaround <= 2st landing, range 28..55, strict monophony & MODO CC#9 reset', () => {
    // 1A. KICK_LOCK sync rate >= 0.95
    const { song: sLock, section: secLock } = createFixture({
      drumPatternId: 'ATAMA_UCHI',
      bars: 8,
    });
    const drumRes = generateDrumResult({
      song: sLock,
      section: secLock,
      sectionIndex: 0,
      style: 'A',
      seed: 101,
      params: resolveInstrumentParams(sLock, secLock, 'drums', 'A'),
    });
    const bassLock = generateBassSkeletonTrack({
      song: sLock,
      section: secLock,
      sectionIndex: 0,
      style: 'A',
      seed: 101,
      params: resolveInstrumentParams(sLock, secLock, 'bass', 'A'),
      drumNotes: drumRes.notes,
      kickTicks: drumRes.kickTicks,
      drumPatternId: 'ATAMA_UCHI',
      bassSkeleton: 'KICK_LOCK',
      bassTake: 'A',
    });

    // Exclude beat-4 turnaround windows on bar 3 (bar index 3, tick 7200..7679)
    const nonTurnKicks = drumRes.kickTicks.filter(
      (kt) => !(Math.floor(kt / BAR_TICKS) === 3 && kt % BAR_TICKS >= 1440)
    );
    const bassStartSet = new Set(bassLock.notes.map((n) => n.startTick));
    let matchedKicks = 0;
    for (const kt of nonTurnKicks) {
      const hit = Array.from(bassStartSet).some((bt) => Math.abs(bt - kt) <= 15);
      if (hit) matchedKicks++;
    }
    expect(matchedKicks / nonTurnKicks.length).toBeGreaterThanOrEqual(0.95);

    // 1B. EIGHTH_ROOT non-turnaround bars have exact 8 hits (1.00 rate) & bar-4 turnaround lands <= 2 semitones
    const { song: s8, section: sec8 } = createFixture({
      drumPatternId: 'EIGHT_BEAT',
      bars: 8,
    });
    for (const take of ['A', 'B', 'C'] as const) {
      const res8 = generateBassSkeletonTrack({
        song: s8,
        section: sec8,
        sectionIndex: 0,
        style: take,
        seed: 2026,
        params: resolveInstrumentParams(s8, sec8, 'bass', take),
        drumPatternId: 'EIGHT_BEAT',
        bassSkeleton: 'EIGHTH_ROOT',
        bassTake: take,
      });

      // Playable range 28..55 & strict monophony (min gap >= 5)
      for (let i = 0; i < res8.notes.length; i++) {
        const n = res8.notes[i];
        expect(n.pitch).toBeGreaterThanOrEqual(BASS_MIN_MIDI);
        expect(n.pitch).toBeLessThanOrEqual(BASS_MAX_MIDI);
        if (i + 1 < res8.notes.length) {
          const next = res8.notes[i + 1];
          expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(
            next.startTick - 5
          );
        }
      }

      // Non-turnaround bars (0, 1, 2, 4, 5, 6, 7) have exact 8 hits
      for (const bar of [0, 1, 2, 4, 5, 6, 7]) {
        const barStart = bar * BAR_TICKS;
        const barNotes = res8.notes.filter(
          (n) => n.startTick >= barStart && n.startTick < barStart + BAR_TICKS
        );
        expect(barNotes.length).toBe(8);
      }

      // Turnaround bar 3 (4th bar): last note before bar 4 lands within <= 2 semitones of bar 4 beat 1 root
      const bar3Notes = res8.notes.filter(
        (n) => n.startTick >= 3 * BAR_TICKS && n.startTick < 4 * BAR_TICKS
      );
      const bar4First = res8.notes.find((n) => n.startTick >= 4 * BAR_TICKS);
      expect(bar3Notes.length).toBeGreaterThan(0);
      expect(bar4First).toBeDefined();
      const lastTurnNote = bar3Notes[bar3Notes.length - 1];
      expect(Math.abs(bar4First!.pitch - lastTurnNote.pitch)).toBeLessThanOrEqual(2);
    }

    // 1C. RIFF_CHUG with emitModoBassCC emits CC#9=76 and resets CC#9=0 at track end
    const chugRes = generateBassSkeletonTrack({
      song: s8,
      section: sec8,
      sectionIndex: 0,
      style: 'A',
      seed: 99,
      params: resolveInstrumentParams(s8, sec8, 'bass', 'A'),
      bassSkeleton: 'RIFF_CHUG',
      bassTake: 'A',
      emitModoBassCC: true,
    });
    expect(
      chugRes.controlChanges.some((c) => c.controller === 9 && c.value === 76 && c.tick === 0)
    ).toBe(true);
    expect(
      chugRes.controlChanges.some(
        (c) => c.controller === 9 && c.value === 0 && c.tick === 8 * BAR_TICKS
      )
    ).toBe(true);
  });

  it('2. Keyboard quality: avg voice-leading <= 2.5st, vocal non-interference (< vMin), Take C obligato rest-only, UPBEAT & PPPH exact sync, CC#64 reset', () => {
    // 2A. Voice-leading distance <= 2.5 semitones & vocal ceiling < vMin (72)
    const vocalNotes: MidiNote[] = [
      { pitch: 72, velocity: 100, startTick: 0, durationTicks: 960, channel: 4 },
      // Pure rest gap: 960 .. 1920 (960 ticks >= 480)
      { pitch: 74, velocity: 100, startTick: 1920, durationTicks: 960, channel: 4 },
      // Pure rest gap: 2880 .. 3840 (960 ticks >= 480)
      { pitch: 76, velocity: 100, startTick: 3840, durationTicks: 960, channel: 4 },
    ];
    const { song, section } = createFixture({
      bars: 4,
      drumPatternId: 'EIGHT_BEAT',
    });

    const kbSustain = generateKeyboardSkeletonTrack({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 500,
      params: resolveInstrumentParams(song, section, 'keyboard', 'A'),
      vocalNotes,
      keyboardSkeleton: 'SUSTAIN_CHORD',
      keyboardTake: 'A',
    });

    // Check top note < vMin (72)
    for (const n of kbSustain.notes) {
      expect(n.pitch).toBeLessThan(72);
    }

    // Group by chord startTick and measure adjacent voicing average voice-leading motion
    const byStart = new Map<number, number[]>();
    for (const n of kbSustain.notes) {
      const arr = byStart.get(n.startTick) ?? [];
      arr.push(n.pitch);
      byStart.set(n.startTick, arr);
    }
    const voicings = Array.from(byStart.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, p]) => p.sort((x, y) => x - y));
    expect(voicings.length).toBeGreaterThanOrEqual(4);
    let totalMotion = 0;
    let pairs = 0;
    for (let i = 0; i + 1 < voicings.length; i++) {
      const a = voicings[i];
      const b = voicings[i + 1];
      const len = Math.min(a.length, b.length);
      let d = 0;
      for (let k = 0; k < len; k++) d += Math.abs(a[k] - b[k]);
      totalMotion += d / len;
      pairs++;
    }
    expect(totalMotion / pairs).toBeLessThanOrEqual(2.5);

    // CC#64 damper pedal ends with 0 reset
    const cc64 = kbSustain.controlChanges.filter((c) => c.controller === 64);
    expect(cc64.length).toBeGreaterThan(0);
    expect(cc64[cc64.length - 1].value).toBe(0);

    // 2B. Take C obligato notes (vel 66..70) never collide with vocal active intervals
    const kbTakeC = generateKeyboardSkeletonTrack({
      song,
      section,
      sectionIndex: 0,
      style: 'C',
      seed: 500,
      params: resolveInstrumentParams(song, section, 'keyboard', 'C'),
      vocalNotes,
      keyboardSkeleton: 'SUSTAIN_CHORD',
      keyboardTake: 'C',
    });
    const obligatoNotes = kbTakeC.notes.filter(
      (n) => n.startTick % BAR_TICKS !== 0 && n.velocity >= 66 && n.velocity <= 70
    );
    expect(obligatoNotes.length).toBeGreaterThan(0);
    for (const ob of obligatoNotes) {
      const obEnd = ob.startTick + ob.durationTicks;
      for (const vn of vocalNotes) {
        const vnEnd = vn.startTick + vn.durationTicks;
        const overlaps = ob.startTick < vnEnd && obEnd > vn.startTick;
        expect(overlaps).toBe(false);
      }
    }

    // 2C. UPBEAT offbeat stabs (240, 720, 1200, 1680) & PPPH kime (0, 720, 960)
    const kbUpbeat = generateKeyboardSkeletonTrack({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 77,
      params: resolveInstrumentParams(song, section, 'keyboard', 'A'),
      drumPatternId: 'UPBEAT',
    });
    const upbeatBar0Starts = Array.from(
      new Set(
        kbUpbeat.notes
          .filter((n) => n.startTick < BAR_TICKS)
          .map((n) => n.startTick)
      )
    ).sort((a, b) => a - b);
    expect(upbeatBar0Starts).toEqual([240, 720, 1200, 1680]);

    const kbPpph = generateKeyboardSkeletonTrack({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 77,
      params: resolveInstrumentParams(song, section, 'keyboard', 'A'),
      drumPatternId: 'PPPH',
      bpm: 132,
    });
    const ppphBar0Starts = Array.from(
      new Set(
        kbPpph.notes
          .filter((n) => n.startTick < BAR_TICKS)
          .map((n) => n.startTick)
      )
    ).sort((a, b) => a - b);
    expect(ppphBar0Starts).toEqual([0, 720, 960]);
  });

  it('3. PAD quality: 0-tick silence gap, 100% PEDAL_DRONE sustain, 0 same-pitch overlap, and safe CC#11/CC#74 [0..127]', () => {
    const { song, section } = createFixture({ bars: 4 });
    const sectionEnd = 4 * BAR_TICKS;

    for (const skel of [
      'WARM_SUSTAIN',
      'PEDAL_DRONE',
      'SIDECHAIN_PULSE',
      'BUILDUP_SWELL',
    ] as const) {
      const res = generatePadSkeletonTrack({
        song,
        section,
        sectionIndex: 0,
        style: 'B',
        seed: 88,
        params: resolveInstrumentParams(song, section, 'pad', 'B'),
        padSkeleton: skel,
        padTake: 'B',
        kickTicks: [0, 480, 960, 1440, 1920, 2400, 2880, 3360],
      });

      // Zero same-pitch overlap
      const byPitch = new Map<number, MidiNote[]>();
      for (const n of res.notes) {
        const list = byPitch.get(n.pitch) ?? [];
        list.push(n);
        byPitch.set(n.pitch, list);
      }
      for (const list of byPitch.values()) {
        list.sort((a, b) => a.startTick - b.startTick);
        for (let i = 0; i + 1 < list.length; i++) {
          expect(list[i].startTick + list[i].durationTicks).toBeLessThanOrEqual(
            list[i + 1].startTick
          );
        }
      }

      // Zero silence gap: sample every 120 ticks across [0, sectionEnd)
      for (let t = 0; t < sectionEnd; t += 120) {
        const covered = res.notes.some(
          (n) => n.startTick <= t && n.startTick + n.durationTicks > t
        );
        expect(covered, `PAD silence gap on ${skel} at tick ${t}`).toBe(true);
      }

      // All CC values strictly in 0..127
      for (const cc of res.controlChanges) {
        expect(cc.value).toBeGreaterThanOrEqual(0);
        expect(cc.value).toBeLessThanOrEqual(127);
      }

      if (skel === 'PEDAL_DRONE') {
        const fullSectionDrones = res.notes.filter(
          (n) => n.startTick === 0 && n.durationTicks === sectionEnd
        );
        expect(fullSectionDrones.length).toBeGreaterThanOrEqual(2);
      }
      if (skel === 'SIDECHAIN_PULSE' || skel === 'BUILDUP_SWELL') {
        const cc11 = res.controlChanges.filter((c) => c.controller === 11);
        expect(cc11.length).toBeGreaterThan(0);
      }
    }
  });

  it('4. Cross-part 20-drum-skeleton sync, SHUFFLE/BOUNCE/PPPH/ATAMA_UCHI alignment, determinism & SMF NoteOff <= CC <= NoteOn order', () => {
    // All 20 drum skeletons present in DRUM_SYNC_TABLE & resolve across all 5 genres x 6 section types
    expect(ALL_BEAT_PATTERN_IDS.length).toBe(20);
    for (const drumId of ALL_BEAT_PATTERN_IDS) {
      expect(DRUM_SYNC_TABLE[drumId]).toBeDefined();
      for (const genreId of ALL_GENRES) {
        for (const sectionType of ALL_SECTION_TYPES) {
          const plan = resolveEnsembleSyncPlan({
            drumPatternId: drumId,
            masterGenreId: genreId,
            sectionType,
            bpm: 140,
          });
          expect(plan.bassSkeleton).toBeTruthy();
          expect(plan.keyboardSkeleton).toBeTruthy();
          expect(plan.padSkeleton).toBeTruthy();
        }
      }
    }

    // SHUFFLE: bass & keyboard on 160t triplet multiples
    const shuf = createFixture({ drumPatternId: 'SHUFFLE', bars: 4, bpm: 120 });
    const shufBass = generateBassSkeletonTrack({
      song: shuf.song,
      section: shuf.section,
      sectionIndex: 0,
      style: 'A',
      seed: 12,
      params: resolveInstrumentParams(shuf.song, shuf.section, 'bass', 'A'),
      drumPatternId: 'SHUFFLE',
    });
    const shufKb = generateKeyboardSkeletonTrack({
      song: shuf.song,
      section: shuf.section,
      sectionIndex: 0,
      style: 'A',
      seed: 12,
      params: resolveInstrumentParams(shuf.song, shuf.section, 'keyboard', 'A'),
      drumPatternId: 'SHUFFLE',
    });
    for (const n of shufBass.notes) {
      expect(n.startTick % 160).toBe(0);
    }
    for (const n of shufKb.notes) {
      expect(n.startTick % 160).toBe(0);
    }

    // BOUNCE: 16th offbeats map to 140t / 380t within beat
    const bnc = createFixture({ drumPatternId: 'BOUNCE', bars: 4, bpm: 112 });
    const bncKb = generateKeyboardSkeletonTrack({
      song: bnc.song,
      section: bnc.section,
      sectionIndex: 0,
      style: 'B',
      seed: 15,
      params: resolveInstrumentParams(bnc.song, bnc.section, 'keyboard', 'B'),
      drumPatternId: 'BOUNCE',
      keyboardSkeleton: 'ARPEGGIO_8TH_16TH',
      keyboardTake: 'B',
    });
    const inBeatTicks = new Set(bncKb.notes.map((n) => n.startTick % 480));
    expect(inBeatTicks.has(140)).toBe(true);
    expect(inBeatTicks.has(380)).toBe(true);

    // High-BPM PPPH (>= 155): 2-bar double-time Bar 1 [0, 1440] -> Bar 2 [0]
    const ppphFast = createFixture({ drumPatternId: 'PPPH', bars: 4, bpm: 170 });
    const ppphBass = generateBassSkeletonTrack({
      song: ppphFast.song,
      section: ppphFast.section,
      sectionIndex: 0,
      style: 'A',
      seed: 21,
      params: resolveInstrumentParams(ppphFast.song, ppphFast.section, 'bass', 'A'),
      drumPatternId: 'PPPH',
      bpm: 170,
    });
    const bar0Bass = ppphBass.notes
      .filter((n) => n.startTick < BAR_TICKS)
      .map((n) => n.startTick);
    const bar1Bass = ppphBass.notes
      .filter((n) => n.startTick >= BAR_TICKS && n.startTick < 2 * BAR_TICKS)
      .map((n) => n.startTick - BAR_TICKS);
    expect(bar0Bass).toEqual([0, 1440]);
    expect(bar1Bass).toEqual([0]);

    // Determinism & SMF same-tick event ordering (NoteOff <= CC <= NoteOn)
    const pad1 = generatePadSkeletonTrack({
      song: ppphFast.song,
      section: ppphFast.section,
      sectionIndex: 0,
      style: 'A',
      seed: 777,
      params: resolveInstrumentParams(ppphFast.song, ppphFast.section, 'pad', 'A'),
      drumPatternId: 'ATAMA_UCHI',
    });
    const pad2 = generatePadSkeletonTrack({
      song: ppphFast.song,
      section: ppphFast.section,
      sectionIndex: 0,
      style: 'A',
      seed: 777,
      params: resolveInstrumentParams(ppphFast.song, ppphFast.section, 'pad', 'A'),
      drumPatternId: 'ATAMA_UCHI',
    });
    expect(pad1.notes).toEqual(pad2.notes);
    expect(pad1.controlChanges).toEqual(pad2.controlChanges);

    const ordered = flattenToOrderedSmfEvents(pad1.notes, pad1.controlChanges, 2);
    for (let i = 0; i + 1 < ordered.length; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (a.tick === b.tick) {
        expect(a.priority).toBeLessThanOrEqual(b.priority);
      } else {
        expect(a.tick).toBeLessThan(b.tick);
      }
    }
  });
});
