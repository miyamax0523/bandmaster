import { describe, expect, it } from 'vitest';
import {
  ALL_BEAT_PATTERN_IDS,
  BAR_TICKS,
  BEAT_TEMPLATES,
  GENRE_FLAVOR_PROFILES,
  generateDrumResult,
  isTripletSkeleton,
  LEGACY_8_BEAT_PATTERN_IDS,
  MIDI_NOTE_MAP,
  STEP_TICKS,
  type BeatPatternId,
  type InternalDrumEvent,
  type KickTake,
  type StepIndex,
} from '../src/engines/drumEngine';
import { createUniformChordTimeline } from '../src/lib/chordTimeline';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import type { MasterGenreId } from '../src/lib/masterGenres';
import type { Section, SongConfig } from '../src/types/song';

// ===========================================================================
// Quantitative Metric Utilities (M1, M2, M5)
// ===========================================================================
const LHL_WEIGHTS = [0, -4, -3, -4, -2, -4, -3, -4, -1, -4, -3, -4, -2, -4, -3, -4];

export function calcLhlSyncopation(steps: readonly number[]): number {
  const onsetSet = new Set(steps);
  if (onsetSet.size === 0) return 0;
  let total = 0;
  for (let s = 0; s < 16; s++) {
    if (!onsetSet.has(s)) {
      let prev = (s + 15) % 16;
      while (!onsetSet.has(prev) && prev !== s) {
        prev = (prev + 15) % 16;
      }
      if (prev !== s && LHL_WEIGHTS[s] > LHL_WEIGHTS[prev]) {
        total += LHL_WEIGHTS[s] - LHL_WEIGHTS[prev];
      }
    }
  }
  return total;
}

export function calcBarSkeletonSimilarity(
  barA: InternalDrumEvent[],
  barB: InternalDrumEvent[]
): number {
  const extract = (
    events: InternalDrumEvent[],
    pred: (e: InternalDrumEvent) => boolean
  ) => new Set(events.filter(pred).map((e) => e.stepIndex));

  const jaccard = (a: Set<StepIndex>, b: Set<StepIndex>): number => {
    if (a.size === 0 && b.size === 0) return 1;
    let inter = 0;
    for (const v of a) if (b.has(v)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 1 : inter / union;
  };

  const isKick = (e: InternalDrumEvent) =>
    e.voice === 'KICK_MAIN' || e.voice === 'KICK_ALT';
  const isSnareBackbeat = (e: InternalDrumEvent) =>
    e.role === 'SNARE_BACKBEAT';
  const isTimekeep = (e: InternalDrumEvent) =>
    e.role === 'TIMEKEEP' || e.role === 'CRASH_ACCENT';

  return (
    0.45 * jaccard(extract(barA, isKick), extract(barB, isKick)) +
    0.4 * jaccard(extract(barA, isSnareBackbeat), extract(barB, isSnareBackbeat)) +
    0.15 * jaccard(extract(barA, isTimekeep), extract(barB, isTimekeep))
  );
}

export function calcMaxUnintendedGapTicks(
  events: InternalDrumEvent[],
  allowedBreakWindows: ReadonlyArray<{ startTick: number; endTick: number }>
): number {
  const sorted = [...events].sort((a, b) => a.tick - b.tick);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevTick = sorted[i - 1].tick;
    const currTick = sorted[i].tick;
    const insideBreak = allowedBreakWindows.some(
      (w) =>
        prevTick >= w.startTick - STEP_TICKS && currTick <= w.endTick + STEP_TICKS
    );
    if (!insideBreak) {
      maxGap = Math.max(maxGap, currTick - prevTick);
    }
  }
  return maxGap;
}

// ===========================================================================
// Test Helpers
// ===========================================================================
const ALL_GENRES: readonly MasterGenreId[] = [
  'alt_shoegaze',
  'emo_jrock',
  'numetal_mixture',
  'royal_jpop',
  'chill_ballad',
];

const GENRE_BPM: Record<MasterGenreId, number> = {
  alt_shoegaze: 118,
  emo_jrock: 162,
  numetal_mixture: 150,
  royal_jpop: 140,
  chill_ballad: 86,
};

const SEEDS = [101, 2026, 7777] as const;

function makeFixture(
  genreId: MasterGenreId,
  patternId: BeatPatternId,
  kickTake: KickTake,
  overrides: Partial<Section> = {},
  bpmOverride?: number
) {
  const bpm = bpmOverride ?? GENRE_BPM[genreId];
  const song: SongConfig = {
    title: `Continuity ${genreId} ${patternId}`,
    bpm,
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
        patternPreset: genreId,
        drumStyle: 'Standard',
        instructionText: '',
      },
      bass: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      keyboard: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      pad: { enabled: true, activeSectionsOnly: false, instructionText: '' },
      vocal: { enabled: true, activeSectionsOnly: false, instructionText: '' },
    },
    sections: [],
  };

  const bars = overrides.bars ?? 8;
  const section: Section = {
    id: 'sec-cont',
    type: 'Verse',
    name: 'Aメロ',
    bars,
    energy: 'Mid',
    kickMode: 'acoustic',
    drumPatternId: patternId,
    drumKickTake: kickTake,
    drumHat16thEnabled: false,
    drumFillEnabled: false,
    drumBreakEnabled: false,
    chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], bars),
    ...overrides,
  };

  return { song, section };
}

function groupByBar(
  events: InternalDrumEvent[],
  bars: number
): InternalDrumEvent[][] {
  const byBar: InternalDrumEvent[][] = Array.from({ length: bars }, () => []);
  for (const ev of events) {
    if (ev.barIndex >= 0 && ev.barIndex < bars) {
      byBar[ev.barIndex].push(ev);
    }
  }
  return byBar;
}

// ===========================================================================
// M1–M7 Quantitative Regression Test Suite
// ===========================================================================
describe('drumEngine continuity & architecture metrics (M1-M7)', () => {
  it('M1: maintains >= 0.75 skeleton similarity on every consecutive non-fill/non-break bar pair (avg >= 0.85) across 5 genres x 8 patterns x 3 seeds', () => {
    const allScores: number[] = [];

    for (const genreId of ALL_GENRES) {
      for (const patternId of LEGACY_8_BEAT_PATTERN_IDS) {
        for (const seed of SEEDS) {
          const { song, section } = makeFixture(genreId, patternId, 'A', {
            bars: 8,
            drumFillEnabled: false,
            drumBreakEnabled: false,
          });
          const res = generateDrumResult({
            song,
            section,
            sectionIndex: 0,
            style: 'A',
            seed,
            params: resolveInstrumentParams(song, section, 'drums', 'A'),
          });

          const byBar = groupByBar(res.events, 8);
          for (let b = 0; b < 7; b++) {
            const sim = calcBarSkeletonSimilarity(byBar[b], byBar[b + 1]);
            expect(
              sim,
              `M1 failed for ${genreId}/${patternId}/seed=${seed} bar ${b}->${b + 1}: ${sim}`
            ).toBeGreaterThanOrEqual(0.75);
            allScores.push(sim);
          }
        }
      }
    }

    const avg = allScores.reduce((s, v) => s + v, 0) / allScores.length;
    expect(avg).toBeGreaterThanOrEqual(0.85);
  });

  it('M2: keeps maximum unintended silence gap within strict thresholds across all 5 genres x 8 patterns', () => {
    const tightPatterns = new Set<BeatPatternId>([
      'EIGHT_BEAT',
      'SIXTEEN_BEAT',
      'UPBEAT',
      'TWO_BEAT',
      'BOUNCE',
      'DOUBLE_BASS',
    ]);

    for (const genreId of ALL_GENRES) {
      for (const patternId of LEGACY_8_BEAT_PATTERN_IDS) {
        for (const seed of SEEDS) {
          const { song, section } = makeFixture(genreId, patternId, 'A', {
            bars: 8,
            drumFillEnabled: true,
            drumBreakEnabled: false,
          });
          const res = generateDrumResult({
            song,
            section,
            sectionIndex: 0,
            style: 'A',
            seed,
            params: resolveInstrumentParams(song, section, 'drums', 'A'),
          });

          const maxGap = calcMaxUnintendedGapTicks(res.events, []);
          const threshold =
            tightPatterns.has(patternId) &&
            genreId !== 'chill_ballad' &&
            !(patternId === 'DOUBLE_BASS' && song.bpm >= 155)
              ? 360
              : 520;
          expect(
            maxGap,
            `M2 failed for ${genreId}/${patternId}/seed=${seed}: maxGap=${maxGap} > ${threshold}`
          ).toBeLessThanOrEqual(threshold);
        }
      }
    }
  });

  it('M3: guarantees 1.00 backbeat snare rate on non-fill/non-break bars (>= 0.95 overall)', () => {
    for (const genreId of ALL_GENRES) {
      for (const patternId of LEGACY_8_BEAT_PATTERN_IDS) {
        for (const take of ['A', 'B', 'C'] as const) {
          const { song, section } = makeFixture(genreId, patternId, take, {
            bars: 8,
            drumFillEnabled: false,
            drumBreakEnabled: false,
          });
          const res = generateDrumResult({
            song,
            section,
            sectionIndex: 0,
            style: 'A',
            seed: 2026,
            params: resolveInstrumentParams(song, section, 'drums', 'A'),
          });

          const expectedSnareSteps = res.skeleton.snareSteps;
          const byBar = groupByBar(res.events, 8);
          let expectedTotal = 0;
          let actualTotal = 0;

          for (let b = 0; b < 8; b++) {
            const snareStepSet = new Set(
              byBar[b]
                .filter((e) => e.role === 'SNARE_BACKBEAT')
                .map((e) => e.stepIndex)
            );
            for (const s of expectedSnareSteps) {
              expectedTotal++;
              if (snareStepSet.has(s)) actualTotal++;
            }
          }

          expect(
            actualTotal / expectedTotal,
            `M3 failed for ${genreId}/${patternId}/Take ${take}`
          ).toBe(1);
        }
      }
    }
  });

  it('M4: guarantees >= 0.95 timekeeping continuity with zero consecutive 2-step omissions', () => {
    for (const genreId of ALL_GENRES) {
      for (const patternId of LEGACY_8_BEAT_PATTERN_IDS) {
        for (const seed of SEEDS) {
          const { song, section } = makeFixture(genreId, patternId, 'A', {
            bars: 8,
            drumFillEnabled: false,
            drumBreakEnabled: false,
          });
          const res = generateDrumResult({
            song,
            section,
            sectionIndex: 0,
            style: 'A',
            seed,
            params: resolveInstrumentParams(song, section, 'drums', 'A'),
          });

          const expectedSteps = res.skeleton.timekeepSteps;
          const byBar = groupByBar(res.events, 8);
          let expectedCount = 0;
          let presentCount = 0;

          for (let b = 0; b < 8; b++) {
            const tkSet = new Set(
              byBar[b]
                .filter((e) => e.role === 'TIMEKEEP' || e.role === 'CRASH_ACCENT')
                .map((e) => e.stepIndex)
            );

            let consecutiveMissing = 0;
            for (const step of expectedSteps) {
              expectedCount++;
              if (tkSet.has(step)) {
                presentCount++;
                consecutiveMissing = 0;
              } else {
                consecutiveMissing++;
                expect(
                  consecutiveMissing,
                  `M4 consecutive missing for ${genreId}/${patternId}/bar=${b}`
                ).toBeLessThan(2);
              }
            }
          }

          expect(presentCount / expectedCount).toBeGreaterThanOrEqual(0.95);
        }
      }
    }
  });

  it('M5: keeps LHL syncopation scores within pattern-defined upper bounds', () => {
    const maxLhlByPattern: Record<BeatPatternId, number> = {
      EIGHT_BEAT: 4,
      SIXTEEN_BEAT: 6,
      ATAMA_UCHI: 16,
      FOUR_ON_FLOOR: 2,
      UPBEAT: 3,
      TWO_BEAT: 2,
      BOUNCE: 5,
      HALF_TIME: 9,
      DOUBLE_BASS: 1,
      SOCA: 4,
      SLIP_BEAT: 12,
      SHUFFLE: 8,
      HALF_TIME_SHUFFLE: 14,
      JUNGLE: 18,
      TRAIN: 6,
      MARCH: 2,
      PPPH: 8,
      FOUR_BEAT: 8,
      SAMBA: 8,
      SONGO: 14,
    };

    for (const patternId of ALL_BEAT_PATTERN_IDS) {
      const template = BEAT_TEMPLATES[patternId];
      for (const take of ['A', 'B', 'C'] as const) {
        const score = calcLhlSyncopation(template.kickTakes[take]);
        expect(
          score,
          `M5 LHL syncopation exceeded for ${patternId} Take ${take}: ${score}`
        ).toBeLessThanOrEqual(maxLhlByPattern[patternId]);
      }
    }
  });

  it('M6: verifies BOUNCE 16th swing average shift in [+14, +26] ticks and Step 0 anchor drift <= 4 ticks', () => {
    for (const genreId of ALL_GENRES) {
      for (const seed of SEEDS) {
        const { song, section } = makeFixture(genreId, 'BOUNCE', 'A', {
          bars: 4,
          drumFillEnabled: false,
          drumBreakEnabled: false,
        });
        const res = generateDrumResult({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed,
          params: resolveInstrumentParams(song, section, 'drums', 'A'),
        });

        const oddShifts: number[] = [];
        for (const ev of res.events) {
          const gridTick = ev.barIndex * BAR_TICKS + ev.stepIndex * STEP_TICKS;
          const shift = ev.tick - gridTick;
          if (ev.stepIndex % 2 === 1) {
            oddShifts.push(shift);
          }
          if (ev.stepIndex === 0) {
            expect(Math.abs(shift)).toBeLessThanOrEqual(4);
          }
          if (ev.stepIndex === 10) {
            expect(Math.abs(shift)).toBeLessThanOrEqual(4);
          }
        }

        expect(oddShifts.length).toBeGreaterThan(0);
        const avgOddShift =
          oddShifts.reduce((s, v) => s + v, 0) / oddShifts.length;
        expect(avgOddShift).toBeGreaterThanOrEqual(14);
        expect(avgOddShift).toBeLessThanOrEqual(26);
      }
    }
  });

  it('M7: verifies DOUBLE_BASS LF lock (HH_PEDAL=0), RF-LF velocity delta in [4, 15], 1.00 kick hit rate, and snare-coincident kick attenuation >= 10', () => {
    for (const genreId of ALL_GENRES) {
      for (const bpm of [145, 165, 185]) {
        for (const take of ['A', 'B', 'C'] as const) {
          const { song, section } = makeFixture(
            genreId,
            'DOUBLE_BASS',
            take,
            {
              bars: 4,
              energy: 'High',
              drumFillEnabled: false,
              drumBreakEnabled: false,
            },
            bpm
          );
          const res = generateDrumResult({
            song,
            section,
            sectionIndex: 0,
            style: 'A',
            seed: 42,
            params: resolveInstrumentParams(song, section, 'drums', 'A'),
          });

          // 1. LF lock: HH_PEDAL === 0
          expect(res.events.filter((e) => e.voice === 'HH_PEDAL').length).toBe(0);

          // 2. All prescribed kick steps present (1.00 hit rate)
          const expectedSteps = BEAT_TEMPLATES.DOUBLE_BASS.kickTakes[take];
          const byBar = groupByBar(res.events, 4);
          let expectedHits = 0;
          let actualHits = 0;
          for (let b = 0; b < 4; b++) {
            const kickStepSet = new Set(
              byBar[b]
                .filter((e) => e.voice === 'KICK_MAIN' || e.voice === 'KICK_ALT')
                .map((e) => e.stepIndex)
            );
            for (const s of expectedSteps) {
              expectedHits++;
              if (kickStepSet.has(s)) actualHits++;
            }
          }
          expect(actualHits / expectedHits).toBe(1);

          // 3. RF vs LF velocity delta (non-snare-coincident RF vs LF) in [4, 15]
          const snareStepKeys = new Set(
            res.events
              .filter((e) => e.role === 'SNARE_BACKBEAT')
              .map((e) => `${e.barIndex}:${e.stepIndex}`)
          );
          const rfNonSnare = res.events.filter(
            (e) =>
              e.role === 'KICK_DOUBLE_RF' &&
              !snareStepKeys.has(`${e.barIndex}:${e.stepIndex}`)
          );
          const rfCoincident = res.events.filter(
            (e) =>
              e.role === 'KICK_DOUBLE_RF' &&
              snareStepKeys.has(`${e.barIndex}:${e.stepIndex}`)
          );
          const lfAll = res.events.filter((e) => e.role === 'KICK_DOUBLE_LF');

          expect(rfNonSnare.length).toBeGreaterThan(0);
          expect(lfAll.length).toBeGreaterThan(0);
          expect(rfCoincident.length).toBeGreaterThan(0);

          const meanRf =
            rfNonSnare.reduce((s, e) => s + e.velocity, 0) / rfNonSnare.length;
          const meanLf =
            lfAll.reduce((s, e) => s + e.velocity, 0) / lfAll.length;
          const meanCoincident =
            rfCoincident.reduce((s, e) => s + e.velocity, 0) /
            rfCoincident.length;

          expect(meanRf - meanLf).toBeGreaterThanOrEqual(4);
          expect(meanRf - meanLf).toBeLessThanOrEqual(15);
          expect(meanRf - meanCoincident).toBeGreaterThanOrEqual(10);
        }
      }
    }
  });

  it('EIGHT_BEAT Take B: strictly omits beat-3 downbeat kick (Step 8) and places kicks on Step 0 and Step 10 ("ドッ・タン・ン・ド・タン")', () => {
    for (const genreId of ALL_GENRES) {
      for (const seed of SEEDS) {
        const { song, section } = makeFixture(genreId, 'EIGHT_BEAT', 'B', {
          bars: 4,
          drumFillEnabled: false,
          drumBreakEnabled: false,
        });
        const res = generateDrumResult({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed,
          params: resolveInstrumentParams(song, section, 'drums', 'A'),
        });

        const byBar = groupByBar(res.events, 4);
        for (let b = 0; b < 4; b++) {
          const kickSteps = new Set(
            byBar[b]
              .filter((e) => e.voice === 'KICK_MAIN' || e.voice === 'KICK_ALT')
              .map((e) => e.stepIndex)
          );
          expect(kickSteps.has(0)).toBe(true);
          expect(kickSteps.has(8)).toBe(false);
          expect(kickSteps.has(10)).toBe(true);
        }
      }
    }
  });

  it('Layer 2 Section Deployment Map: numetal_mixture Chorus selects DOUBLE_BASS at bpm >= 145 and EIGHT_BEAT(C) at bpm < 145', () => {
    const fastSong = makeFixture('numetal_mixture', 'EIGHT_BEAT', 'A', {
      type: 'Chorus',
      energy: 'High',
      drumPatternId: 'auto',
      drumKickTake: 'auto',
    }, 155);
    const fastRes = generateDrumResult({
      song: fastSong.song,
      section: fastSong.section,
      sectionIndex: 0,
      style: 'A',
      seed: 123,
      params: resolveInstrumentParams(fastSong.song, fastSong.section, 'drums', 'A'),
    });
    expect(fastRes.patternId).toBe('DOUBLE_BASS');

    const slowSong = makeFixture('numetal_mixture', 'EIGHT_BEAT', 'A', {
      type: 'Chorus',
      energy: 'High',
      drumPatternId: 'auto',
      drumKickTake: 'auto',
    }, 130);
    const slowRes = generateDrumResult({
      song: slowSong.song,
      section: slowSong.section,
      sectionIndex: 0,
      style: 'A',
      seed: 123,
      params: resolveInstrumentParams(slowSong.song, slowSong.section, 'drums', 'A'),
    });
    expect(slowRes.patternId).toBe('EIGHT_BEAT');
    expect(slowRes.kickTake).toBe('C');

    // Verify all 5 master genre profiles have snareOffsetMs within [-8, +8] and maxJitterMs <= 2.5
    for (const genreId of ALL_GENRES) {
      const profile = GENRE_FLAVOR_PROFILES[genreId];
      expect(profile.microtiming.snareOffsetMs).toBeGreaterThanOrEqual(-8);
      expect(profile.microtiming.snareOffsetMs).toBeLessThanOrEqual(8);
      expect(profile.microtiming.maxJitterMs).toBeLessThanOrEqual(2.5);
    }
  });
});

// ===========================================================================
// M8–M12 & ATAMA_UCHI Quantitative Regression Test Suite (20 Skeletons + v2)
// ===========================================================================
describe('drumEngine v2 extended metrics (M8-M12 & ATAMA_UCHI)', () => {
  it('M8: guarantees Stage 4 pure integer grid alignment (straight % 60 === 0, triplet % 80 === 0, violations = 0)', () => {
    expect(ALL_BEAT_PATTERN_IDS.length).toBe(20);

    for (const patternId of ALL_BEAT_PATTERN_IDS) {
      const triplet = isTripletSkeleton(patternId);
      for (const take of ['A', 'B', 'C'] as const) {
        const { song, section } = makeFixture('emo_jrock', patternId, take, {
          bars: 8,
          drumFillEnabled: true,
          drumBreakEnabled: false,
        }, 140);
        const res = generateDrumResult({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed: 303,
          params: resolveInstrumentParams(song, section, 'drums', 'A'),
        });

        const stage4 = res.stage4Events ?? [];
        expect(stage4.length).toBeGreaterThan(0);

        for (const ev of stage4) {
          const isValid = triplet
            ? ev.tick % 80 === 0 || ev.tick % 60 === 0
            : ev.tick % 60 === 0 || ev.tick % 80 === 0;
          expect(
            isValid,
            `M8 grid violation on ${patternId} Take ${take}: tick=${ev.tick}`
          ).toBe(true);
          if (ev.role !== 'FILL_EVENT') {
            if (triplet) {
              expect(
                ev.tick % 80,
                `M8 triplet skeleton violation on ${patternId} Take ${take}: tick=${ev.tick}`
              ).toBe(0);
            } else {
              expect(
                ev.tick % 60,
                `M8 straight skeleton violation on ${patternId} Take ${take}: tick=${ev.tick}`
              ).toBe(0);
            }
          }
        }
      }
    }
  });

  it('M9: enforces zero 4-limb & SNARE_FLAM 2-hand conflicts in Stage 4 across all 20 skeletons x 3 takes', () => {
    for (const patternId of ALL_BEAT_PATTERN_IDS) {
      for (const take of ['A', 'B', 'C'] as const) {
        const { song, section } = makeFixture('royal_jpop', patternId, take, {
          bars: 8,
          energy: 'High',
          drumFillEnabled: true,
          drumBreakEnabled: false,
        }, 135);
        const res = generateDrumResult({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed: 555,
          params: resolveInstrumentParams(song, section, 'drums', 'A'),
        });

        const stage4 = res.stage4Events ?? [];
        const byTick = new Map<number, InternalDrumEvent[]>();
        for (const ev of stage4) {
          const list = byTick.get(ev.tick) ?? [];
          list.push(ev);
          byTick.set(ev.tick, list);
        }

        for (const [tick, cluster] of byTick.entries()) {
          let upperSlots = 0;
          let rf = 0;
          let lf = 0;
          for (const ev of cluster) {
            if (ev.limb === 'RF') rf++;
            else if (ev.limb === 'LF') lf++;
            else upperSlots += ev.voice === 'SNARE_FLAM' ? 2 : 1;
          }
          expect(
            upperSlots,
            `M9 upper-limb conflict on ${patternId}/${take} at tick ${tick}`
          ).toBeLessThanOrEqual(2);
          expect(
            rf,
            `M9 RF conflict on ${patternId}/${take} at tick ${tick}`
          ).toBeLessThanOrEqual(1);
          expect(
            lf,
            `M9 LF conflict on ${patternId}/${take} at tick ${tick}`
          ).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('M10: enforces biomechanical IOI guard across BPM [60, 100, 140, 165, 195] (zero 6-tuplet fills > 155 BPM, zero single-pedal 3+ consecutive 16th kicks > 165 BPM)', () => {
    const bpms = [60, 100, 140, 165, 195] as const;
    const patternsToSweep: readonly BeatPatternId[] = [
      'EIGHT_BEAT',
      'ATAMA_UCHI',
      'SOCA',
      'SHUFFLE',
      'HALF_TIME_SHUFFLE',
      'PPPH',
      'FOUR_BEAT',
    ];

    for (const bpm of bpms) {
      for (const patternId of patternsToSweep) {
        for (const seed of [11, 22, 33, 44]) {
          const { song, section } = makeFixture(
            'emo_jrock',
            patternId,
            'C',
            {
              bars: 8,
              energy: 'High',
              drumFillEnabled: true,
              drumBreakEnabled: false,
            },
            bpm
          );
          const res = generateDrumResult({
            song,
            section,
            sectionIndex: 0,
            style: 'A',
            seed,
            params: resolveInstrumentParams(song, section, 'drums', 'A'),
          });

          if (bpm > 155) {
            expect(res.selectedFillIds ?? []).not.toContain('FILL_2B_6TUPLET_SHUFFLE');
          }

          if (bpm > 165) {
            const kicks = (res.stage4Events ?? [])
              .filter((e) => e.voice === 'KICK_MAIN' || e.voice === 'KICK_ALT')
              .sort((a, b) => a.tick - b.tick);
            for (let i = 0; i + 2 < kicks.length; i++) {
              const d1 = kicks[i + 1].tick - kicks[i].tick;
              const d2 = kicks[i + 2].tick - kicks[i + 1].tick;
              const isTriple16th = d1 > 0 && d1 <= 130 && d2 > 0 && d2 <= 130;
              expect(
                isTriple16th,
                `M10 triple 16th kick at bpm=${bpm} on ${patternId} ticks=${kicks[i].tick},${kicks[i + 1].tick},${kicks[i + 2].tick}`
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it('M11: enforces hi-hat state continuity (zero simultaneous HH_OPEN + HH_CLOSED/PEDAL) and PPPH Take A choke at 1440 (<155 BPM) & Bar2 480 (>=155 BPM)', () => {
    for (const patternId of ALL_BEAT_PATTERN_IDS) {
      for (const take of ['A', 'B', 'C'] as const) {
        const { song, section } = makeFixture('royal_jpop', patternId, take, {
          bars: 4,
          drumFillEnabled: true,
          drumBreakEnabled: false,
        }, 140);
        const res = generateDrumResult({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed: 909,
          params: resolveInstrumentParams(song, section, 'drums', 'A'),
        });

        const byTick = new Map<number, InternalDrumEvent[]>();
        for (const ev of res.stage4Events ?? []) {
          const list = byTick.get(ev.tick) ?? [];
          list.push(ev);
          byTick.set(ev.tick, list);
        }
        for (const [tick, cluster] of byTick.entries()) {
          const hasOpen = cluster.some(
            (e) => e.voice === 'HH_OPEN' || e.voice === 'HH_HALF_OPEN'
          );
          const hasClosedOrPedal = cluster.some(
            (e) => e.voice === 'HH_CLOSED' || e.voice === 'HH_PEDAL'
          );
          expect(
            hasOpen && hasClosedOrPedal,
            `M11 simultaneous open+closed HH on ${patternId}/${take} at tick ${tick}`
          ).toBe(false);
        }
      }
    }

    // PPPH Take A (< 155 BPM): HH_PEDAL choke at 1440, silent after 1440
    const slowPpph = makeFixture('royal_jpop', 'PPPH', 'A', {
      bars: 4,
      drumFillEnabled: false,
      drumBreakEnabled: false,
    }, 132);
    const slowRes = generateDrumResult({
      song: slowPpph.song,
      section: slowPpph.section,
      sectionIndex: 0,
      style: 'A',
      seed: 42,
      params: resolveInstrumentParams(slowPpph.song, slowPpph.section, 'drums', 'A'),
    });
    for (let b = 0; b < 4; b++) {
      const barStart = b * BAR_TICKS;
      expect(
        (slowRes.stage4Events ?? []).some(
          (e) => e.tick === barStart + 1440 && e.voice === 'HH_PEDAL'
        )
      ).toBe(true);
      expect(
        (slowRes.stage4Events ?? []).filter(
          (e) => e.tick > barStart + 1440 && e.tick < barStart + BAR_TICKS
        )
      ).toEqual([]);
    }

    // PPPH Take A (>= 155 BPM): 2-bar cycle with HH_PEDAL choke at Bar 2 tick 480 (abs 2400)
    const fastPpph = makeFixture('emo_jrock', 'PPPH', 'A', {
      bars: 4,
      drumFillEnabled: false,
      drumBreakEnabled: false,
    }, 172);
    const fastRes = generateDrumResult({
      song: fastPpph.song,
      section: fastPpph.section,
      sectionIndex: 0,
      style: 'A',
      seed: 42,
      params: resolveInstrumentParams(fastPpph.song, fastPpph.section, 'drums', 'A'),
    });
    for (const bar2Idx of [1, 3]) {
      const bar2Start = bar2Idx * BAR_TICKS;
      expect(
        (fastRes.stage4Events ?? []).some(
          (e) => e.tick === bar2Start + 480 && e.voice === 'HH_PEDAL'
        )
      ).toBe(true);
      expect(
        (fastRes.stage4Events ?? []).filter(
          (e) => e.tick > bar2Start + 480 && e.tick < bar2Start + BAR_TICKS
        )
      ).toEqual([]);
    }
  });

  it('M12: verifies HALF_TIME_SHUFFLE & TRAIN Ghost/Accent velocity ratio in [0.25, 0.45] and SSD5_NATIVE CRASH_L === 55 (never 49)', () => {
    for (const patternId of ['HALF_TIME_SHUFFLE', 'TRAIN'] as const) {
      for (const take of ['A', 'B', 'C'] as const) {
        const { song, section } = makeFixture('royal_jpop', patternId, take, {
          bars: 4,
          drumFillEnabled: false,
          drumBreakEnabled: false,
        }, 124);
        const res = generateDrumResult({
          song,
          section,
          sectionIndex: 0,
          style: 'A',
          seed: 77,
          params: resolveInstrumentParams(song, section, 'drums', 'A'),
        });

        const accents = res.events.filter((e) => e.role === 'SNARE_BACKBEAT');
        const ghosts = res.events.filter(
          (e) => e.role === 'ORNAMENT' && e.voice === 'SNARE_MAIN'
        );
        expect(accents.length).toBeGreaterThan(0);
        expect(ghosts.length).toBeGreaterThan(0);

        const avgAccent =
          accents.reduce((sum, e) => sum + e.velocity, 0) / accents.length;
        const avgGhost =
          ghosts.reduce((sum, e) => sum + e.velocity, 0) / ghosts.length;
        const ratio = avgGhost / avgAccent;

        expect(
          ratio,
          `M12 Ghost/Accent ratio out of range on ${patternId} Take ${take}: ${ratio.toFixed(3)}`
        ).toBeGreaterThanOrEqual(0.25);
        expect(
          ratio,
          `M12 Ghost/Accent ratio out of range on ${patternId} Take ${take}: ${ratio.toFixed(3)}`
        ).toBeLessThanOrEqual(0.45);
      }
    }

    // SSD5_NATIVE CRASH_L must map to 55 and NEVER 49
    expect(MIDI_NOTE_MAP.SSD5_NATIVE.CRASH_L).toBe(55);
    expect(MIDI_NOTE_MAP.SSD5_NATIVE.CRASH_L).not.toBe(49);
    const { song, section } = makeFixture('emo_jrock', 'EIGHT_BEAT', 'A', {
      type: 'Chorus',
      energy: 'High',
      bars: 4,
    }, 150);
    const ssd5Res = generateDrumResult({
      song,
      section,
      sectionIndex: 0,
      style: 'A',
      seed: 101,
      midiMapMode: 'SSD5_NATIVE',
      params: resolveInstrumentParams(song, section, 'drums', 'A'),
    });
    expect(ssd5Res.notes.some((n) => n.pitch === 55)).toBe(true);
    expect(ssd5Res.notes.some((n) => n.pitch === 49)).toBe(false);
  });

  it('ATAMA_UCHI (Japanese band-style): verifies Take A (タン・ド・タン・ド) and Take B (タン・タン・タド・タド) exact placements', () => {
    // Take A: Snare + HH at 0, 480, 960, 1440; Kick at 240, 720, 1200, 1680
    const fixA = makeFixture('emo_jrock', 'ATAMA_UCHI', 'A', {
      bars: 4,
      drumFillEnabled: false,
      drumBreakEnabled: false,
    }, 158);
    const resA = generateDrumResult({
      song: fixA.song,
      section: fixA.section,
      sectionIndex: 0,
      style: 'A',
      seed: 100,
      params: resolveInstrumentParams(fixA.song, fixA.section, 'drums', 'A'),
    });
    const s4A = resA.stage4Events ?? [];
    for (let b = 0; b < 4; b++) {
      const barStart = b * BAR_TICKS;
      const barEvs = s4A.filter((e) => e.barIndex === b);
      const snareLocal = barEvs
        .filter((e) => e.voice === 'SNARE_MAIN')
        .map((e) => e.tick - barStart)
        .sort((x, y) => x - y);
      const hhLocal = barEvs
        .filter((e) => e.voice === 'HH_CLOSED' || e.voice === 'HH_HALF_OPEN')
        .map((e) => e.tick - barStart)
        .sort((x, y) => x - y);
      const kickLocal = barEvs
        .filter((e) => e.voice === 'KICK_MAIN')
        .map((e) => e.tick - barStart)
        .sort((x, y) => x - y);

      expect(snareLocal).toEqual([0, 480, 960, 1440]);
      expect(hhLocal).toEqual([0, 480, 960, 1440]);
      expect(kickLocal).toEqual([240, 720, 1200, 1680]);
    }

    // Take B: Beats 1-2 (0, 480) = Snare + HH ONLY (no kick, no floor tom);
    //         Beats 3-4 (960..1680) = Snare + HH at 960, 1440 alternating with Kick at 1200, 1680
    const fixB = makeFixture('emo_jrock', 'ATAMA_UCHI', 'B', {
      bars: 4,
      drumFillEnabled: false,
      drumBreakEnabled: false,
    }, 158);
    const resB = generateDrumResult({
      song: fixB.song,
      section: fixB.section,
      sectionIndex: 0,
      style: 'A',
      seed: 100,
      params: resolveInstrumentParams(fixB.song, fixB.section, 'drums', 'A'),
    });
    const s4B = resB.stage4Events ?? [];
    for (let b = 0; b < 4; b++) {
      const barStart = b * BAR_TICKS;
      const barEvs = s4B.filter((e) => e.barIndex === b);
      const snareLocal = barEvs
        .filter((e) => e.voice === 'SNARE_MAIN')
        .map((e) => e.tick - barStart)
        .sort((x, y) => x - y);
      const hhLocal = barEvs
        .filter((e) => e.voice === 'HH_CLOSED' || e.voice === 'HH_HALF_OPEN')
        .map((e) => e.tick - barStart)
        .sort((x, y) => x - y);
      const kickLocal = barEvs
        .filter((e) => e.voice === 'KICK_MAIN')
        .map((e) => e.tick - barStart)
        .sort((x, y) => x - y);
      const floorTomLocal = barEvs.filter((e) => e.voice === 'TOM_FLOOR');

      expect(snareLocal).toEqual([0, 480, 960, 1440]);
      expect(hhLocal).toEqual([0, 480, 960, 1440]);
      expect(kickLocal).toEqual([1200, 1680]);
      expect(floorTomLocal).toEqual([]);
    }
  });
});
