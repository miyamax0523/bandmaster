import { TICKS_PER_BAR, type MidiNote } from '../types/song';
import { createSeededRng } from '../lib/random';
import type { EngineInput } from './types';

export const GM_DRUM = {
  KICK: 36,
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
  noVelCapOrBoost?: boolean;
  minTickBound?: number;
}

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

export function generateDrumNotes(input: EngineInput): MidiNote[] {
  const { song, section, style, seed, params } = input;
  if (!song.members.drums.enabled) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;
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
        notes.push({
          pitch: srcNote.pitch,
          velocity: clampVelocity(srcNote.velocity),
          startTick: absTick,
          durationTicks: Math.max(1, srcNote.durationTicks),
          channel: 9,
          noTimingJitter: true,
        });
      }
    }
  } else {
    // Built-in pattern generator
    const isHighEnergy = section.energy === 'High' || section.type === 'Chorus';
    const hatPitch =
      section.type === 'Chorus' && style !== 'B' && !params.offbeatOpenHat
        ? GM_DRUM.RIDE
        : GM_DRUM.CLOSED_HH;

    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * TICKS_PER_BAR;

      // Kick pattern
      const kickOffsets: number[] = [];
      if (params.kickPattern === 'fourOnFloor') {
        kickOffsets.push(0, 480, 960, 1440);
      } else if (params.kickPattern === 'syncopated') {
        kickOffsets.push(0, 360, 720, 1200);
        if (style !== 'B' && rng.chance(0.5)) {
          kickOffsets.push(1560);
        }
      } else {
        kickOffsets.push(0, 720);
        if (isHighEnergy || style === 'C') {
          kickOffsets.push(1200);
        }
        if (style === 'C' && rng.chance(0.45)) {
          kickOffsets.push(240);
        }
      }

      // Double Kick additions
      if (params.doubleKickProb > 0) {
        const doubleCandidates = [120, 600, 840, 1080, 1320, 1560];
        for (const dc of doubleCandidates) {
          if (rng.chance(params.doubleKickProb * 0.65)) {
            kickOffsets.push(dc);
          }
        }
      }

      const uniqueKickOffsets = Array.from(new Set(kickOffsets)).sort(
        (a, b) => a - b
      );
      for (const off of uniqueKickOffsets) {
        const vel = off === 0 ? 112 : rng.nextInt(96, 110);
        notes.push({
          pitch: GM_DRUM.KICK,
          velocity: vel,
          startTick: barStart + off,
          durationTicks: 120,
          channel: 9,
          noTimingJitter: off === 0 || Boolean(section.unisonRiff),
        });
      }

      // Snare pattern
      const snareOffsets = params.snareHalfTime ? [960] : [480, 1440];
      for (const off of snareOffsets) {
        if (params.flamEnabled && off > 30) {
          notes.push({
            pitch: GM_DRUM.SNARE,
            velocity: rng.nextInt(55, 65),
            startTick: barStart + off - 30,
            durationTicks: 30,
            channel: 9,
            noTimingJitter: true,
          });
        }
        notes.push({
          pitch: GM_DRUM.SNARE,
          velocity: rng.nextInt(100, 115),
          startTick: barStart + off,
          durationTicks: 120,
          channel: 9,
          noTimingJitter: Boolean(section.unisonRiff),
        });
      }

      // Ghost snare for Take A / C
      if (style !== 'B' && !params.snareHalfTime) {
        if (rng.chance(style === 'C' ? 0.6 : 0.3)) {
          notes.push({
            pitch: GM_DRUM.SNARE,
            velocity: rng.nextInt(42, 60),
            startTick: barStart + 840,
            durationTicks: 60,
            channel: 9,
          });
        }
      }

      // Hi-hat / Ride pattern
      if (params.offbeatOpenHat) {
        for (const off of [240, 720, 1200, 1680]) {
          notes.push({
            pitch: GM_DRUM.OPEN_HH,
            velocity: rng.nextInt(88, 102),
            startTick: barStart + off,
            durationTicks: 180,
            channel: 9,
          });
        }
        // Subtle closed HH on downbeats
        for (const off of [0, 480, 960, 1440]) {
          notes.push({
            pitch: GM_DRUM.CLOSED_HH,
            velocity: rng.nextInt(75, 88),
            startTick: barStart + off,
            durationTicks: 90,
            channel: 9,
          });
        }
      } else {
        const stepSize = 240; // 8th note grid
        const numSteps = TICKS_PER_BAR / stepSize;
        for (let s = 0; s < numSteps; s++) {
          const stepStart = barStart + s * stepSize;
          if (params.hatSubdivision > 1) {
            // Mix 1..hatSubdivision across steps so 2, 3, and 4 rolls appear
            let sub: number;
            if (s % 4 === 1) {
              sub = Math.min(params.hatSubdivision, 2);
            } else if (s % 4 === 2) {
              sub = Math.min(params.hatSubdivision, 3);
            } else if (s % 4 === 3) {
              sub = params.hatSubdivision;
            } else {
              sub = rng.nextInt(1, params.hatSubdivision);
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
          } else {
            const vel = s % 2 === 0 ? rng.nextInt(84, 96) : rng.nextInt(68, 82);
            notes.push({
              pitch: hatPitch,
              velocity: vel,
              startTick: stepStart,
              durationTicks: 100,
              channel: 9,
            });
          }
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
    fillCount: number
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
    for (let i = 0; i < fillCount; i++) {
      const tickOffset = Math.floor((i * span) / fillCount);
      const pitch =
        fillPitches[Math.min(fillPitches.length - 1, Math.floor((i * fillPitches.length) / fillCount))];
      const dur = Math.max(30, Math.floor(span / fillCount) - 5);
      notes.push({
        pitch,
        velocity: clampVelocity(96 + Math.round((i / Math.max(1, fillCount - 1)) * 18)),
        startTick: rangeStart + tickOffset,
        durationTicks: dur,
        channel: 9,
        minTickBound: rangeStart,
      });
    }
  };

  // Take C intermediate 4-note fill at barIndex = 3, tick 1440..1920 when bars >= 8
  if (style === 'C' && section.bars >= 8) {
    const bar3Start = 3 * TICKS_PER_BAR;
    applyFillInRange(bar3Start + 1440, bar3Start + 1920, 4);
  }

  // Final bar fill when section.type !== 'Outro' && section.bars >= 2
  if (section.type !== 'Outro' && section.bars >= 2) {
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

      if (params.velocityJitter > 0) {
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
