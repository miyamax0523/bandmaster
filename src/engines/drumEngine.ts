import { TICKS_PER_BAR, type MidiNote } from '../types/song';
import { createSeededRng } from '../lib/random';
import type { EngineInput } from './types';

export const GM_DRUM = {
  KICK: 36,
  RIMSHOT: 37,
  SNARE: 38,
  CLOSED_HH: 42,
  FLOOR_TOM: 43,
  MID_TOM: 45,
  OPEN_HH: 46,
  HIGH_TOM: 48,
  CRASH: 49,
  RIDE: 51,
} as const;

const FILL_REPLACEABLE_PITCHES = new Set<number>([
  GM_DRUM.CLOSED_HH,
  GM_DRUM.OPEN_HH,
  GM_DRUM.SNARE,
  GM_DRUM.RIDE,
  GM_DRUM.HIGH_TOM,
  GM_DRUM.MID_TOM,
  GM_DRUM.FLOOR_TOM,
]);

interface InternalDrumNote extends MidiNote {
  isAnchor?: boolean;
  noTimingJitter?: boolean;
  noVelJitter?: boolean;
  noVelCapOrBoost?: boolean;
  minTickBound?: number;
}

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

export function generateDrumNotes(input: EngineInput): MidiNote[] {
  const { song, section, style, seed, params } = input;
  if (!song.members.drums.enabled || section.enabledParts?.drums === false) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;
  const hatDensity = section.hatDensity ?? 3;
  const kickDensity = section.kickDensity ?? 3;
  const drumPreset = song.members.drums.patternPreset ?? 'auto';
  const notes: InternalDrumNote[] = [];

  // 1. Source resolution: Section Loop > Song Loop > Built-in Generator
  const loopSource = section.uploadedDrumLoop ?? song.uploadedDrumLoop;
  const usingExternalLoop = Boolean(loopSource);

  if (loopSource) {
    // Immutable loop expansion
    const loopLen = Math.max(1, loopSource.bars) * TICKS_PER_BAR;
    for (let base = 0; base < sectionEnd; base += loopLen) {
      for (const srcNote of loopSource.notes) {
        const absTick = base + srcNote.startTick;
        if (absTick < 0 || absTick >= sectionEnd) continue;
        // Density thinning for external loops when level 1/2 selected
        if (
          kickDensity === 1 &&
          srcNote.pitch === GM_DRUM.KICK &&
          srcNote.startTick % 960 !== 0
        ) {
          continue;
        }
        if (
          hatDensity === 1 &&
          (srcNote.pitch === GM_DRUM.CLOSED_HH ||
            srcNote.pitch === GM_DRUM.OPEN_HH) &&
          srcNote.startTick % 480 !== 0
        ) {
          continue;
        }
        const velDelta = style === 'B' ? rng.nextInt(-10, 10) : 0;
        notes.push({
          pitch: srcNote.pitch,
          velocity: clampVelocity(srcNote.velocity + velDelta),
          startTick: absTick,
          durationTicks: Math.max(1, srcNote.durationTicks),
          channel: 9,
          noTimingJitter: true,
          noVelJitter: style === 'A' || style === 'B',
        });
      }
    }

    // External loop density boost (levels 4-5)
    if (kickDensity >= 4) {
      const kickExtras = kickDensity === 5 ? [360, 840, 1320, 1680] : [360, 1320];
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = bar * TICKS_PER_BAR;
        for (const off of kickExtras) {
          const t = barStart + off;
          if (t >= sectionEnd) continue;
          if (!notes.some((n) => n.pitch === GM_DRUM.KICK && Math.abs(n.startTick - t) < 60)) {
            notes.push({
              pitch: GM_DRUM.KICK,
              velocity: rng.nextInt(88, 104),
              startTick: t,
              durationTicks: 120,
              channel: 9,
              noTimingJitter: true,
            });
          }
        }
      }
    }
    if (hatDensity >= 4) {
      const hatStep = hatDensity === 5 ? 120 : 240;
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = bar * TICKS_PER_BAR;
        for (let off = 0; off < TICKS_PER_BAR; off += hatStep) {
          const t = barStart + off;
          if (t >= sectionEnd) continue;
          const hasHat = notes.some(
            (n) =>
              n.startTick === t &&
              (n.pitch === GM_DRUM.CLOSED_HH ||
                n.pitch === GM_DRUM.OPEN_HH ||
                n.pitch === GM_DRUM.RIDE)
          );
          if (!hasHat && (hatDensity === 5 || rng.chance(0.55))) {
            notes.push({
              pitch: GM_DRUM.CLOSED_HH,
              velocity: rng.nextInt(64, 84),
              startTick: t,
              durationTicks: 80,
              channel: 9,
              noTimingJitter: true,
            });
          }
        }
      }
    }

    // Take B: add seed-dependent low-velocity ghost notes on empty 16th-note offbeats
    if (style === 'B') {
      const sixteenthOffbeats = [120, 360, 600, 840, 1080, 1320, 1560, 1800];
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = bar * TICKS_PER_BAR;
        const occupied = new Set<number>(
          notes
            .filter(
              (n) => n.startTick >= barStart && n.startTick < barStart + TICKS_PER_BAR
            )
            .map((n) => n.startTick)
        );
        const emptyTicks = sixteenthOffbeats
          .map((off) => barStart + off)
          .filter((t) => t < sectionEnd && !occupied.has(t));

        let addedInBar = 0;
        for (const t of emptyTicks) {
          if (rng.chance(0.42)) {
            const isSnareGhost = rng.chance(0.55);
            notes.push({
              pitch: isSnareGhost ? GM_DRUM.SNARE : GM_DRUM.CLOSED_HH,
              velocity: isSnareGhost ? rng.nextInt(34, 52) : rng.nextInt(40, 58),
              startTick: t,
              durationTicks: 60,
              channel: 9,
              noTimingJitter: true,
              noVelJitter: true,
            });
            addedInBar++;
          }
        }
        if (addedInBar === 0 && emptyTicks.length > 0) {
          const fallbackTick = rng.pick(emptyTicks);
          notes.push({
            pitch: GM_DRUM.SNARE,
            velocity: rng.nextInt(36, 50),
            startTick: fallbackTick,
            durationTicks: 60,
            channel: 9,
            noTimingJitter: true,
            noVelJitter: true,
          });
        }
      }
    }

    // Take C: add Open HH (46) & Crash (49) accents when Energy is Mid/High
    if (
      style === 'C' &&
      (section.energy === 'Mid' || section.energy === 'High')
    ) {
      const openHatOffbeats = [240, 720, 1200, 1680];
      const openProb = section.energy === 'High' ? 0.5 : 0.32;
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = bar * TICKS_PER_BAR;
        if (
          bar < section.bars - 1 &&
          bar % 4 === 0 &&
          (bar === 0 || rng.chance(0.75))
        ) {
          const hasCrash = notes.some(
            (n) => n.pitch === GM_DRUM.CRASH && n.startTick === barStart
          );
          if (!hasCrash && barStart < sectionEnd) {
            notes.push({
              pitch: GM_DRUM.CRASH,
              velocity: rng.nextInt(102, 114),
              startTick: barStart,
              durationTicks: 480,
              channel: 9,
              noTimingJitter: true,
            });
          }
        }

        let barOpenCount = 0;
        for (const off of openHatOffbeats) {
          const t = barStart + off;
          if (t >= sectionEnd) continue;
          if (rng.chance(openProb)) {
            for (let i = notes.length - 1; i >= 0; i--) {
              if (
                notes[i].pitch === GM_DRUM.CLOSED_HH &&
                notes[i].startTick === t
              ) {
                notes.splice(i, 1);
              }
            }
            notes.push({
              pitch: GM_DRUM.OPEN_HH,
              velocity: rng.nextInt(86, 104),
              startTick: t,
              durationTicks: 180,
              channel: 9,
              noTimingJitter: true,
            });
            barOpenCount++;
          }
        }
        if (barOpenCount === 0 && barStart + 1680 < sectionEnd) {
          const fallbackOpen = barStart + rng.pick(openHatOffbeats);
          notes.push({
            pitch: GM_DRUM.OPEN_HH,
            velocity: rng.nextInt(84, 98),
            startTick: fallbackOpen,
            durationTicks: 180,
            channel: 9,
            noTimingJitter: true,
          });
        }
      }
    }
  } else {
    // Built-in pattern generator (respecting patternPreset + hatDensity/kickDensity)
    const isHighEnergy = section.energy === 'High' || section.type === 'Chorus';

    let effKickPattern = params.kickPattern;
    let effDoubleKickProb = params.doubleKickProb;
    let effSnareHalfTime = params.snareHalfTime;
    let effHatSubdivision = params.hatSubdivision;
    let effFlamEnabled = params.flamEnabled;
    let effOffbeatOpenHat = params.offbeatOpenHat;
    let snarePitch: number = GM_DRUM.SNARE;
    let force16thHat = false;
    let forceMinimal = false;
    let driveOpenHat = false;
    let breakdownChug = false;
    let trapSparse = false;
    let trapActive = false;
    let bounceTriplet = false;
    let buildUpMode = false;
    let softChill = false;
    let anticipationMode = false;
    let discoBoogieMode = false;

    switch (drumPreset) {
      case 'straight_8':
        effKickPattern = 'standard';
        effDoubleKickProb = 0;
        effSnareHalfTime = false;
        effHatSubdivision = 1;
        effOffbeatOpenHat = false;
        break;
      case 'straight_16':
        effKickPattern = 'standard';
        effDoubleKickProb = 0;
        effSnareHalfTime = false;
        effHatSubdivision = 1;
        effOffbeatOpenHat = false;
        force16thHat = true;
        break;
      case 'simple_minimal':
        effKickPattern = 'standard';
        effDoubleKickProb = 0;
        effSnareHalfTime = false;
        effHatSubdivision = 1;
        effOffbeatOpenHat = false;
        forceMinimal = true;
        break;
      case 'rock_drive':
        effKickPattern = 'standard';
        effSnareHalfTime = false;
        driveOpenHat = true;
        break;
      case 'metal_double':
        effKickPattern = 'standard';
        effSnareHalfTime = false;
        effDoubleKickProb = Math.max(0.85, params.doubleKickProb);
        break;
      case 'breakdown_heavy':
        effKickPattern = 'syncopated';
        effSnareHalfTime = true;
        breakdownChug = true;
        break;
      case 'halftime_heavy':
        effKickPattern = 'standard';
        effSnareHalfTime = true;
        break;
      case 'trap_sparse':
        effSnareHalfTime = true;
        effHatSubdivision = 2;
        trapSparse = true;
        break;
      case 'trap_active':
        effSnareHalfTime = true;
        effHatSubdivision = 4;
        effFlamEnabled = true;
        trapActive = true;
        break;
      case 'four_on_floor':
        effKickPattern = 'fourOnFloor';
        effSnareHalfTime = false;
        effOffbeatOpenHat = true;
        break;
      case 'bounce_shuffle':
        effKickPattern = 'syncopated';
        effSnareHalfTime = false;
        bounceTriplet = true;
        break;
      case 'build_up':
        buildUpMode = true;
        break;
      case 'rim_chill':
        effKickPattern = 'standard';
        effSnareHalfTime = false;
        snarePitch = GM_DRUM.RIMSHOT;
        softChill = true;
        break;
      case 'jrock_anticipation':
        effKickPattern = 'standard';
        effSnareHalfTime = false;
        anticipationMode = true;
        break;
      case 'disco_boogie_bounce':
        effKickPattern = 'fourOnFloor';
        effSnareHalfTime = false;
        discoBoogieMode = true;
        break;
      case 'auto':
      default:
        break;
    }

    const hatPitch =
      driveOpenHat
        ? GM_DRUM.OPEN_HH
        : section.type === 'Chorus' && style !== 'B' && !effOffbeatOpenHat && !softChill
          ? GM_DRUM.RIDE
          : GM_DRUM.CLOSED_HH;

    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * TICKS_PER_BAR;

      if (anticipationMode) {
        // J-Rock bar-crossing anticipation: push on beat 4-and (1680) with Kick+Crash+OpenHH,
        // and omit the next bar's downbeat Kick (tick 0 on bar > 0) for forward drive.
        const bodyKicks =
          bar === 0
            ? kickDensity <= 2
              ? [0, 720]
              : [0, 720, 1200]
            : kickDensity <= 2
              ? [720]
              : [720, 1200];
        for (const off of bodyKicks) {
          notes.push({
            pitch: GM_DRUM.KICK,
            velocity: off === 0 ? 112 : rng.nextInt(98, 108),
            startTick: barStart + off,
            durationTicks: 120,
            channel: 9,
            noTimingJitter: off === 0,
          });
        }

        // Beat 4-and (1680) band-unison anticipation accent
        notes.push({
          pitch: GM_DRUM.KICK,
          velocity: 114,
          startTick: barStart + 1680,
          durationTicks: 120,
          channel: 9,
          isAnchor: true,
          noTimingJitter: true,
        });
        notes.push({
          pitch: GM_DRUM.CRASH,
          velocity: 108,
          startTick: barStart + 1680,
          durationTicks: 440,
          channel: 9,
          isAnchor: true,
          noTimingJitter: true,
        });
        notes.push({
          pitch: GM_DRUM.OPEN_HH,
          velocity: 96,
          startTick: barStart + 1680,
          durationTicks: 220,
          channel: 9,
          isAnchor: true,
          noTimingJitter: true,
        });

        // Heavy beats 2 & 4 snare
        for (const off of [480, 1440]) {
          notes.push({
            pitch: GM_DRUM.SNARE,
            velocity: rng.nextInt(106, 118),
            startTick: barStart + off,
            durationTicks: 120,
            channel: 9,
          });
        }

        // Tight 8th hi-hats (skipping beat-4-and 1680 crash hit and bar>0 beat-1 tie)
        const hatStep = hatDensity >= 5 ? 120 : 240;
        for (let off = 0; off < TICKS_PER_BAR; off += hatStep) {
          if (off === 1680 || (bar > 0 && off === 0)) continue;
          if (hatDensity === 1 && off % 480 !== 0) continue;
          notes.push({
            pitch: hatPitch,
            velocity: off % 480 === 0 ? rng.nextInt(86, 98) : rng.nextInt(70, 82),
            startTick: barStart + off,
            durationTicks: 90,
            channel: 9,
          });
        }
        continue;
      }

      if (discoBoogieMode) {
        // Cheryl Lynn / Disco-Boogie bounce:
        // Strong 4-on-the-floor kick, tight beats 2/4 snare, offbeat Open HH (46), bouncy 16th Closed HH
        const discoKicks =
          kickDensity >= 4
            ? [0, 480, 960, 1440, 1680]
            : [0, 480, 960, 1440];
        for (const off of discoKicks) {
          notes.push({
            pitch: GM_DRUM.KICK,
            velocity: off % 480 === 0 ? rng.nextInt(108, 116) : rng.nextInt(92, 102),
            startTick: barStart + off,
            durationTicks: 120,
            channel: 9,
            noTimingJitter: off % 480 === 0,
          });
        }

        for (const off of [480, 1440]) {
          notes.push({
            pitch: GM_DRUM.SNARE,
            velocity: rng.nextInt(106, 118),
            startTick: barStart + off,
            durationTicks: 120,
            channel: 9,
            noTimingJitter: true,
          });
        }

        // Open Hi-Hat (46) on every 8th offbeat (240, 720, 1200, 1680)
        for (const off of [240, 720, 1200, 1680]) {
          notes.push({
            pitch: GM_DRUM.OPEN_HH,
            velocity: rng.nextInt(94, 106),
            startTick: barStart + off,
            durationTicks: 150,
            channel: 9,
            isAnchor: bar < section.bars - 1, // protect bounce open hats on body bars
            noTimingJitter: true,
          });
        }

        // Remaining 16th closed hi-hats with subtle +16 tick bounce on 16th upbeats
        if (hatDensity >= 2) {
          const closedSteps =
            hatDensity >= 3
              ? [0, 120, 360, 480, 600, 840, 960, 1080, 1320, 1440, 1560, 1800]
              : [0, 480, 960, 1440];
          for (const off of closedSteps) {
            const is16thOffbeat = off % 240 === 120;
            const bouncedTick = barStart + off + (is16thOffbeat ? 16 : 0);
            notes.push({
              pitch: GM_DRUM.CLOSED_HH,
              velocity: off % 480 === 0 ? rng.nextInt(82, 92) : rng.nextInt(60, 74),
              startTick: bouncedTick,
              durationTicks: 70,
              channel: 9,
              noTimingJitter: true,
            });
          }
        }
        continue;
      }

      if (buildUpMode) {
        // Progressive crescendo buildup across bars
        const progress = (bar + 1) / Math.max(1, section.bars);
        const snareStep =
          kickDensity <= 2
            ? 480
            : progress < 0.4
              ? 480
              : progress < 0.75 && hatDensity < 5
                ? 240
                : 120;
        for (let off = 0; off < TICKS_PER_BAR; off += snareStep) {
          const vel = clampVelocity(52 + progress * 55 + (off / TICKS_PER_BAR) * 14);
          notes.push({
            pitch: GM_DRUM.SNARE,
            velocity: vel,
            startTick: barStart + off,
            durationTicks: Math.max(40, snareStep - 10),
            channel: 9,
          });
        }
        const kickSteps = kickDensity <= 1 ? [0, 960] : [0, 480, 960, 1440];
        for (const off of kickSteps) {
          notes.push({
            pitch: GM_DRUM.KICK,
            velocity: clampVelocity(75 + progress * 42),
            startTick: barStart + off,
            durationTicks: 120,
            channel: 9,
            noTimingJitter: off === 0,
          });
        }
        if (hatDensity >= 2) {
          for (const off of [0, 960]) {
            notes.push({
              pitch: GM_DRUM.CRASH,
              velocity: clampVelocity(68 + progress * 40),
              startTick: barStart + off,
              durationTicks: 240,
              channel: 9,
            });
          }
        }
        continue;
      }

      // Kick pattern (scaled by kickDensity 1..5; 3 = preset/genre standard)
      const kickOffsets: number[] = [];
      if (kickDensity === 1 || forceMinimal) {
        kickOffsets.push(0, 960);
      } else if (kickDensity === 2) {
        if (effKickPattern === 'fourOnFloor') {
          kickOffsets.push(0, 480, 960, 1440);
        } else if (effKickPattern === 'syncopated') {
          kickOffsets.push(0, 720, 1200);
        } else {
          kickOffsets.push(0, 720);
        }
      } else {
        if (breakdownChug) {
          kickOffsets.push(0, 120, 720, 840, 1440);
        } else if (bounceTriplet) {
          kickOffsets.push(0, 320, 640, 960, 1280);
        } else if (softChill) {
          kickOffsets.push(0, 960);
          if (rng.chance(0.45)) kickOffsets.push(720);
        } else if (driveOpenHat) {
          kickOffsets.push(0, 240, 720, 1200);
        } else if (effKickPattern === 'fourOnFloor') {
          kickOffsets.push(0, 480, 960, 1440);
        } else if (effKickPattern === 'syncopated') {
          kickOffsets.push(0, 360, 720, 1200);
          if (style !== 'B' && rng.chance(0.5)) {
            kickOffsets.push(1560);
          }
        } else {
          kickOffsets.push(0, 720);
          if (isHighEnergy || style === 'C' || force16thHat) {
            kickOffsets.push(1200);
          }
          if (style === 'C' && rng.chance(0.45)) {
            kickOffsets.push(240);
          }
        }

        // Double Kick additions
        if (effDoubleKickProb > 0) {
          const doubleCandidates = [120, 240, 600, 840, 1080, 1320, 1560];
          const probScale = kickDensity >= 4 ? 0.85 : 0.65;
          for (const dc of doubleCandidates) {
            if (rng.chance(effDoubleKickProb * probScale)) {
              kickOffsets.push(dc);
            }
          }
        }

        if (kickDensity === 4) {
          for (const extra of [360, 840, 1320, 1680]) {
            if (rng.chance(0.6)) kickOffsets.push(extra);
          }
        } else if (kickDensity === 5) {
          if (effDoubleKickProb > 0) {
            kickOffsets.push(120, 240, 360, 600, 720, 840, 1080, 1200, 1320, 1560, 1680);
          } else {
            kickOffsets.push(360, 600, 840, 1320, 1560, 1680, 1800);
          }
        }
      }

      const uniqueKickOffsets = Array.from(new Set(kickOffsets)).sort(
        (a, b) => a - b
      );
      for (const off of uniqueKickOffsets) {
        const vel = softChill
          ? rng.nextInt(80, 94)
          : off === 0
            ? 112
            : rng.nextInt(96, 110);
        notes.push({
          pitch: GM_DRUM.KICK,
          velocity: vel,
          startTick: barStart + off,
          durationTicks: 120,
          channel: 9,
          noTimingJitter: off === 0 || Boolean(section.unisonRiff),
        });
      }

      // Snare / Rimshot pattern
      const snareOffsets = effSnareHalfTime ? [960] : [480, 1440];
      for (const off of snareOffsets) {
        if (effFlamEnabled && off > 30) {
          notes.push({
            pitch: snarePitch,
            velocity: rng.nextInt(55, 65),
            startTick: barStart + off - 30,
            durationTicks: 30,
            channel: 9,
            noTimingJitter: true,
          });
        }
        notes.push({
          pitch: snarePitch,
          velocity: softChill ? rng.nextInt(72, 84) : rng.nextInt(100, 115),
          startTick: barStart + off,
          durationTicks: 120,
          channel: 9,
          noTimingJitter: Boolean(section.unisonRiff),
        });
      }

      // Ghost snare for Take A / C
      if (style !== 'B' && !effSnareHalfTime && !forceMinimal && !softChill) {
        if (rng.chance(style === 'C' ? 0.6 : 0.3)) {
          notes.push({
            pitch: snarePitch,
            velocity: rng.nextInt(42, 60),
            startTick: barStart + 840,
            durationTicks: 60,
            channel: 9,
          });
        }
      }

      // Hi-hat / Ride pattern (scaled by hatDensity 1..5; 3 = preset/genre standard)
      if (hatDensity === 1 || forceMinimal) {
        for (const off of [0, 480, 960, 1440]) {
          notes.push({
            pitch: effOffbeatOpenHat ? GM_DRUM.CLOSED_HH : hatPitch,
            velocity: softChill ? rng.nextInt(52, 66) : rng.nextInt(80, 94),
            startTick: barStart + off,
            durationTicks: 180,
            channel: 9,
          });
        }
      } else if (breakdownChug) {
        const chugTicks =
          hatDensity >= 4
            ? [0, 240, 480, 720, 960, 1200, 1440, 1680]
            : [0, 480, 960, 1440];
        for (const off of chugTicks) {
          notes.push({
            pitch: off % 960 === 0 ? GM_DRUM.CRASH : GM_DRUM.OPEN_HH,
            velocity: rng.nextInt(96, 112),
            startTick: barStart + off,
            durationTicks: 240,
            channel: 9,
          });
        }
      } else if (bounceTriplet) {
        const tripTicks =
          hatDensity >= 4
            ? [0, 160, 320, 480, 640, 800, 960, 1120, 1280, 1440, 1600, 1760]
            : [0, 320, 480, 800, 960, 1280, 1440, 1760];
        for (const off of tripTicks) {
          notes.push({
            pitch: GM_DRUM.CLOSED_HH,
            velocity: off % 480 === 0 ? rng.nextInt(84, 96) : rng.nextInt(66, 78),
            startTick: barStart + off,
            durationTicks: 100,
            channel: 9,
          });
        }
      } else if (hatDensity === 2) {
        if (effOffbeatOpenHat) {
          for (const off of [0, 480, 960, 1440]) {
            notes.push({
              pitch: GM_DRUM.CLOSED_HH,
              velocity: rng.nextInt(74, 88),
              startTick: barStart + off,
              durationTicks: 100,
              channel: 9,
            });
          }
          for (const off of [720, 1680]) {
            notes.push({
              pitch: GM_DRUM.OPEN_HH,
              velocity: rng.nextInt(84, 96),
              startTick: barStart + off,
              durationTicks: 160,
              channel: 9,
            });
          }
        } else {
          for (const off of [0, 240, 480, 960, 1200, 1440]) {
            notes.push({
              pitch: hatPitch,
              velocity: off % 480 === 0 ? rng.nextInt(82, 94) : rng.nextInt(64, 76),
              startTick: barStart + off,
              durationTicks: 100,
              channel: 9,
            });
          }
        }
      } else if (effOffbeatOpenHat) {
        for (const off of [240, 720, 1200, 1680]) {
          notes.push({
            pitch: GM_DRUM.OPEN_HH,
            velocity: rng.nextInt(88, 102),
            startTick: barStart + off,
            durationTicks: 180,
            channel: 9,
          });
        }
        for (const off of [0, 480, 960, 1440]) {
          notes.push({
            pitch: GM_DRUM.CLOSED_HH,
            velocity: rng.nextInt(75, 88),
            startTick: barStart + off,
            durationTicks: 90,
            channel: 9,
          });
        }
        if (hatDensity >= 4) {
          const extras =
            hatDensity === 5
              ? [120, 360, 600, 840, 1080, 1320, 1560, 1800]
              : [120, 600, 1080, 1560];
          for (const off of extras) {
            notes.push({
              pitch: GM_DRUM.CLOSED_HH,
              velocity: rng.nextInt(62, 78),
              startTick: barStart + off,
              durationTicks: 70,
              channel: 9,
            });
          }
        }
      } else if (
        (hatDensity === 5 || trapActive) &&
        effHatSubdivision > 1
      ) {
        // Maximum Trap density: 16th base + 32nd-note rolls
        const stepSize = 120;
        const numSteps = TICKS_PER_BAR / stepSize;
        for (let s = 0; s < numSteps; s++) {
          const stepStart = barStart + s * stepSize;
          const sub =
            s % 4 === 3
              ? effHatSubdivision
              : s % 4 === 1
                ? 2
                : rng.nextInt(1, Math.min(3, effHatSubdivision));
          const subStep = sub === 1 ? 120 : Math.floor(120 / sub);
          for (let k = 0; k < sub; k++) {
            notes.push({
              pitch: GM_DRUM.CLOSED_HH,
              velocity: clampVelocity(92 - k * 10),
              startTick: stepStart + k * subStep,
              durationTicks: Math.max(20, subStep - 5),
              channel: 9,
              noTimingJitter: sub > 1,
            });
          }
        }
      } else if (hatDensity === 5 || force16thHat) {
        // Tight / Maximum Rock/Metal/Pop 16th grid
        for (let off = 0; off < TICKS_PER_BAR; off += 120) {
          const isOpen = hatDensity === 5 && (off === 720 || off === 1680);
          notes.push({
            pitch: isOpen ? GM_DRUM.OPEN_HH : hatPitch,
            velocity:
              off % 480 === 0
                ? rng.nextInt(88, 100)
                : off % 240 === 0
                  ? rng.nextInt(74, 86)
                  : rng.nextInt(58, 72),
            startTick: barStart + off,
            durationTicks: isOpen ? 160 : 80,
            channel: 9,
          });
        }
      } else {
        const stepSize = 240; // 8th note grid
        const numSteps = TICKS_PER_BAR / stepSize;
        for (let s = 0; s < numSteps; s++) {
          const stepStart = barStart + s * stepSize;
          if (effHatSubdivision > 1) {
            let sub: number;
            if (trapSparse) {
              sub = s === numSteps - 1 ? 2 : 1;
            } else if (s % 4 === 1) {
              sub = Math.min(effHatSubdivision, 2);
            } else if (s % 4 === 2) {
              sub = Math.min(effHatSubdivision, 3);
            } else if (s % 4 === 3) {
              sub = effHatSubdivision;
            } else {
              sub = rng.nextInt(1, effHatSubdivision);
            }
            const subStep = sub === 1 ? 120 : Math.floor(120 / sub);
            for (let k = 0; k < sub; k++) {
              notes.push({
                pitch: GM_DRUM.CLOSED_HH,
                velocity: clampVelocity(92 - k * 12),
                startTick: stepStart + k * subStep,
                durationTicks: Math.max(20, subStep - 5),
                channel: 9,
                noTimingJitter: sub > 1,
              });
            }
            if (hatDensity === 4 && sub === 1) {
              notes.push({
                pitch: GM_DRUM.CLOSED_HH,
                velocity: rng.nextInt(62, 76),
                startTick: stepStart + 120,
                durationTicks: 80,
                channel: 9,
              });
            }
          } else {
            const vel = softChill
              ? rng.nextInt(54, 68)
              : s % 2 === 0
                ? rng.nextInt(84, 96)
                : rng.nextInt(68, 82);
            notes.push({
              pitch: hatPitch,
              velocity: vel,
              startTick: stepStart,
              durationTicks: 100,
              channel: 9,
            });
            if (hatDensity === 4 && rng.chance(0.55)) {
              notes.push({
                pitch: hatPitch,
                velocity: rng.nextInt(58, 72),
                startTick: stepStart + 120,
                durationTicks: 80,
                channel: 9,
              });
            }
          }
        }
        if (hatDensity === 4 && effHatSubdivision <= 1) {
          notes.push({
            pitch: GM_DRUM.OPEN_HH,
            velocity: 88,
            startTick: barStart + 1680,
            durationTicks: 160,
            channel: 9,
          });
        }
      }
    }
  }

  // 2. Chorus start Crash (Anchor Note: pitch 49, startTick 0, velocity >= 110, jitter 0)
  if (section.type === 'Chorus') {
    const existingCrash = notes.find(
      (n) => n.pitch === GM_DRUM.CRASH && n.startTick === 0
    );
    if (existingCrash) {
      existingCrash.velocity = Math.max(110, existingCrash.velocity);
      existingCrash.isAnchor = true;
      existingCrash.noTimingJitter = true;
      existingCrash.noVelCapOrBoost = true;
    } else {
      notes.push({
        pitch: GM_DRUM.CRASH,
        velocity: 115,
        startTick: 0,
        durationTicks: 480,
        channel: 9,
        isAnchor: true,
        noTimingJitter: true,
        noVelCapOrBoost: true,
      });
    }
  }

  // 3. Kick-preserving Fill Replacement
  const applyFillInRange = (
    rangeStart: number,
    rangeEnd: number,
    fillCount: number,
    seedVaried = false
  ) => {
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (
        !n.isAnchor &&
        n.startTick >= rangeStart &&
        n.startTick < rangeEnd &&
        FILL_REPLACEABLE_PITCHES.has(n.pitch)
      ) {
        notes.splice(i, 1);
      }
    }

    const span = rangeEnd - rangeStart;
    const fillPitches = [
      GM_DRUM.SNARE,
      GM_DRUM.HIGH_TOM,
      GM_DRUM.MID_TOM,
      GM_DRUM.FLOOR_TOM,
    ];
    const mode = seedVaried ? rng.nextInt(0, 2) : 0;
    for (let i = 0; i < fillCount; i++) {
      const tickOffset = Math.floor((i * span) / fillCount);
      let pitch: number;
      if (mode === 1) {
        // Snare + tom alternating pattern
        pitch = i % 2 === 0 ? GM_DRUM.SNARE : fillPitches[(i % 3) + 1];
      } else if (mode === 2) {
        // Ascending/descending syncopated tom burst
        pitch = fillPitches[rng.nextInt(0, fillPitches.length - 1)];
      } else {
        pitch =
          fillPitches[
            Math.min(
              fillPitches.length - 1,
              Math.floor((i * fillPitches.length) / fillCount)
            )
          ];
      }
      const dur = Math.max(30, Math.floor(span / fillCount) - 5);
      notes.push({
        pitch,
        velocity: clampVelocity(
          94 +
            Math.round((i / Math.max(1, fillCount - 1)) * 20) +
            (seedVaried ? rng.nextInt(-6, 6) : 0)
        ),
        startTick: rangeStart + tickOffset,
        durationTicks: dur,
        channel: 9,
        minTickBound: rangeStart,
      });
    }
  };

  if (usingExternalLoop) {
    const finalBarStart = (section.bars - 1) * TICKS_PER_BAR;
    if (style === 'A' && section.type !== 'Outro') {
      // Take A: faithful loop + light beat-4 nuance
      const nuances = [
        { pitch: GM_DRUM.OPEN_HH, offset: 1680, vel: 78 },
        { pitch: GM_DRUM.RIDE, offset: 1440, vel: 82 },
        { pitch: GM_DRUM.SNARE, offset: 1680, vel: 64 },
      ];
      const chosen = rng.pick(nuances);
      const t = finalBarStart + chosen.offset;
      if (
        t < sectionEnd &&
        !notes.some((n) => n.startTick === t && n.pitch === chosen.pitch)
      ) {
        notes.push({
          pitch: chosen.pitch,
          velocity: chosen.vel,
          startTick: t,
          durationTicks: 180,
          channel: 9,
          noTimingJitter: true,
          noVelJitter: true,
        });
      }
    } else if (style === 'C') {
      // Take C: replace final bar beats 3-4 (960..1920) with seed-dependent fill preserving Kick
      const fillCount = rng.nextInt(6, 12);
      applyFillInRange(
        finalBarStart + 960,
        finalBarStart + TICKS_PER_BAR,
        fillCount,
        true
      );
    }
  } else {
    // Take C intermediate 4-note fill at barIndex = 3, tick 1440..1920 when bars >= 8
    if (style === 'C' && section.bars >= 8) {
      const bar3Start = 3 * TICKS_PER_BAR;
      applyFillInRange(bar3Start + 1440, bar3Start + 1920, 4);
    }

    // Final bar fill when section.type !== 'Outro' && section.bars >= 2 (skip in anticipation mode to preserve bar-crossing syncopation)
    if (
      section.type !== 'Outro' &&
      section.bars >= 2 &&
      drumPreset !== 'jrock_anticipation'
    ) {
      const finalBarStart = (section.bars - 1) * TICKS_PER_BAR;
      const fillOffset = style === 'A' ? 960 : style === 'B' ? 1440 : 480;
      const fillCount = rng.nextInt(
        params.fillNoteRange.min,
        params.fillNoteRange.max
      );
      applyFillInRange(
        finalBarStart + fillOffset,
        finalBarStart + TICKS_PER_BAR,
        fillCount
      );
    }
  }

  // 4. Unison Riff Accent Sync (Anchor Kick: pitch 36, velocity = 110, jitter 0)
  // Nothing may be removed after this step!
  if (section.unisonRiff && section.unisonRiff.accentTicks.length > 0) {
    const riffLen = Math.max(1, section.unisonRiff.bars) * TICKS_PER_BAR;
    for (let base = 0; base < sectionEnd; base += riffLen) {
      for (const relTick of section.unisonRiff.accentTicks) {
        const absTick = base + relTick;
        if (absTick < 0 || absTick >= sectionEnd) continue;

        // Remove overlapping Kick (36) within +-60 ticks
        for (let i = notes.length - 1; i >= 0; i--) {
          const n = notes[i];
          if (
            n.pitch === GM_DRUM.KICK &&
            Math.abs(n.startTick - absTick) <= 60
          ) {
            notes.splice(i, 1);
          }
        }

        notes.push({
          pitch: GM_DRUM.KICK,
          velocity: 110,
          startTick: absTick,
          durationTicks: 120,
          channel: 9,
          isAnchor: true,
          noTimingJitter: true,
          noVelCapOrBoost: true,
        });
      }
    }
  }

  // 5. Humanize & Velocity adjustments (Anchor notes strictly exempt)
  const result: MidiNote[] = [];
  for (const n of notes) {
    let startTick = n.startTick;
    let velocity = n.velocity;

    if (!n.isAnchor) {
      if (
        !n.noTimingJitter &&
        !usingExternalLoop &&
        !section.unisonRiff &&
        params.humanizeTicks > 0
      ) {
        const jitter = rng.nextInt(-params.humanizeTicks, params.humanizeTicks);
        startTick += jitter;
        if (n.minTickBound !== undefined && startTick < n.minTickBound) {
          startTick = n.minTickBound;
        }
      }

      if (!n.noVelJitter && params.velocityJitter > 0) {
        velocity += rng.nextInt(-params.velocityJitter, params.velocityJitter);
      }

      if (!n.noVelCapOrBoost) {
        velocity += params.velocityBoost;
        velocity = Math.min(params.velocityCap, velocity);
      }
    }

    // 6. Section boundary & clamping rules (§3-1)
    if (startTick < 0) startTick = 0;
    if (startTick >= sectionEnd) continue;

    const durationTicks = Math.max(
      1,
      Math.min(n.durationTicks, sectionEnd - startTick)
    );

    result.push({
      pitch: Math.min(127, Math.max(0, Math.round(n.pitch))),
      velocity: clampVelocity(velocity),
      startTick: Math.round(startTick),
      durationTicks: Math.round(durationTicks),
      channel: 9,
    });
  }

  result.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  return result;
}
