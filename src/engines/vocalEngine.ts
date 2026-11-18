import {
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type MidiNote,
} from '../types/song';
import {
  fitPitchClassToRange,
  getScalePitchClasses,
  noteNameToSemitone,
  resolveChordForBar,
} from '../lib/chordUtils';
import { createSeededRng } from '../lib/random';
import type { EngineInput } from './types';

export const VOCAL_MIN_PITCH = 48; // C3
export const VOCAL_MAX_PITCH = 76; // E5

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

function clampVocalPitch(p: number): number {
  let shifted = Math.round(p);
  while (shifted < VOCAL_MIN_PITCH) shifted += 12;
  while (shifted > VOCAL_MAX_PITCH) shifted -= 12;
  return Math.min(VOCAL_MAX_PITCH, Math.max(VOCAL_MIN_PITCH, shifted));
}

function enforceMonophonicAndClip(
  rawNotes: readonly MidiNote[],
  sectionEnd: number
): MidiNote[] {
  const valid = rawNotes
    .map((n) => ({
      pitch: Math.min(127, Math.max(0, Math.round(n.pitch))),
      velocity: clampVelocity(n.velocity),
      startTick: Math.max(0, Math.round(n.startTick)),
      durationTicks: Math.max(1, Math.round(n.durationTicks)),
      channel: TRACK_CHANNELS.vocal,
    }))
    .filter((n) => n.startTick < sectionEnd);

  valid.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  const deduped: MidiNote[] = [];
  for (const n of valid) {
    if (
      deduped.length > 0 &&
      deduped[deduped.length - 1].startTick === n.startTick
    ) {
      continue;
    }
    deduped.push(n);
  }

  for (let i = 0; i < deduped.length; i++) {
    const curr = deduped[i];
    const maxAllowed =
      i + 1 < deduped.length
        ? Math.min(
            sectionEnd - curr.startTick,
            deduped[i + 1].startTick - curr.startTick
          )
        : sectionEnd - curr.startTick;
    curr.durationTicks = Math.max(1, Math.min(curr.durationTicks, maxAllowed));
  }

  return deduped;
}

function nearestScalePitch(
  target: number,
  scalePcs: ReadonlySet<number>,
  minP = 55,
  maxP = 74
): number {
  const clamped = Math.min(maxP, Math.max(minP, Math.round(target)));
  let best = clamped;
  let bestDist = Infinity;
  for (let p = minP; p <= maxP; p++) {
    if (!scalePcs.has(p % 12)) continue;
    const d = Math.abs(p - clamped);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function buildScaleGrid(
  scalePcs: ReadonlySet<number>,
  minP = 55,
  maxP = 74
): number[] {
  const out: number[] = [];
  for (let p = minP; p <= maxP; p++) {
    if (scalePcs.has(p % 12)) {
      out.push(p);
    }
  }
  return out;
}

export function generateVocalNotes(input: EngineInput): MidiNote[] {
  const { song, section, style, seed, params } = input;
  const member = song.members.vocal;
  if (!member?.enabled || section.enabledParts?.vocal === false) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;

  // Mode A: Custom recorded/edited Vocal Melody priority mode
  const melody = section.vocalMelody;
  if (melody && melody.notes.length > 0) {
    const maxSourceEnd = melody.notes.reduce(
      (max, n) => Math.max(max, n.startTick + n.durationTicks),
      0
    );
    const loopBars = Math.max(
      1,
      Math.min(4, melody.bars ?? Math.ceil(maxSourceEnd / TICKS_PER_BAR))
    );
    const loopLen = loopBars * TICKS_PER_BAR;
    const expanded: MidiNote[] = [];

    for (let base = 0; base < sectionEnd; base += loopLen) {
      for (let i = 0; i < melody.notes.length; i++) {
        const src = melody.notes[i];
        const absTick = base + src.startTick;
        if (absTick < 0 || absTick >= sectionEnd) continue;

        let pitch = clampVocalPitch(src.pitch);
        let velocity = src.velocity;
        let durationTicks = Math.max(1, src.durationTicks);

        if (style === 'A') {
          velocity = clampVelocity(
            Math.min(params.velocityCap, velocity + rng.nextInt(-4, 4))
          );
        } else if (style === 'B') {
          const isDownbeat = src.startTick % 960 === 0;
          velocity = clampVelocity(velocity + (isDownbeat ? 5 : -3));
          durationTicks = Math.max(60, Math.round(durationTicks * 0.9));
        } else {
          // Take C: subtle velocity lift + occasional tail inflection
          velocity = clampVelocity(velocity + rng.nextInt(-6, 8));
          if (
            section.energy !== 'Low' &&
            i === melody.notes.length - 1 &&
            rng.chance(0.45) &&
            pitch + 2 <= VOCAL_MAX_PITCH
          ) {
            pitch = pitch + (rng.chance(0.5) ? 2 : -2);
          }
        }

        expanded.push({
          pitch,
          velocity,
          startTick: absTick,
          durationTicks,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    }

    return enforceMonophonicAndClip(expanded, sectionEnd);
  }

  // Mode B: Preset-based Vocal / Rap Generator
  const preset = member.patternPreset ?? 'auto';
  const keySemitone = noteNameToSemitone(song.key);
  const scalePcs = new Set(getScalePitchClasses(song.key, song.scale));
  const scaleNotes = buildScaleGrid(scalePcs, 55, 74);

  // Rap anchor pitch centered comfortably (G3..F4)
  const rapAnchor = fitPitchClassToRange(keySemitone, 56, 65);
  const m3Pitch = rapAnchor + (song.scale === 'Major' ? 4 : 3);
  const fifthPitch = rapAnchor + 7;
  const semiBelow = rapAnchor - 1;
  const wholeBelow = rapAnchor - 2;

  const baseVel =
    section.energy === 'High' ? 104 : section.energy === 'Low' ? 78 : 92;
  const notes: MidiNote[] = [];

  const isRapPreset = preset.startsWith('rap_');
  if (isRapPreset) {
    // Minimal-leap arpeggiator-style rap delivery
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * TICKS_PER_BAR;
      const isPhraseEndBar = bar % 2 === 1 || bar === section.bars - 1;

      if (preset === 'rap_16th_push') {
        const restStartStep =
          style === 'B'
            ? 14
            : style === 'C'
              ? rng.nextInt(10, 12)
              : rng.nextInt(12, 14);
        const burstGapStep = style === 'A' ? 7 : rng.nextInt(5, 8);
        for (let s = 0; s < 16; s++) {
          if (s >= restStartStep) continue;
          if (s === burstGapStep && rng.chance(style === 'B' ? 0.35 : 0.7)) {
            continue;
          }
          if (style === 'A' && s % 4 === 3 && rng.chance(0.45)) continue;

          let pitch = rapAnchor;
          if (s === restStartStep - 1 && isPhraseEndBar) {
            pitch = rng.chance(0.5) ? wholeBelow : semiBelow;
          } else if (s % 4 === 2 && rng.chance(style === 'C' ? 0.55 : 0.3)) {
            pitch = m3Pitch;
          } else if (s === 0 && bar > 0 && rng.chance(0.25)) {
            pitch = fifthPitch;
          } else if (s % 8 === 7 && rng.chance(0.4)) {
            pitch = semiBelow;
          }

          const accent = s % 4 === 0 ? 8 : s % 2 === 0 ? 0 : -10;
          notes.push({
            pitch: clampVocalPitch(pitch),
            velocity: clampVelocity(baseVel + accent + rng.nextInt(-4, 4)),
            startTick: barStart + s * 120,
            durationTicks: 100,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_triplet_trap') {
        const dropBeat =
          style === 'B' ? 3 : style === 'C' ? rng.nextInt(1, 2) : 2;
        for (let beat = 0; beat < 4; beat++) {
          if (beat === 3 && isPhraseEndBar && rng.chance(0.65)) {
            // Leave breathing pocket before next bar
            continue;
          }
          if (beat === dropBeat && rng.chance(style === 'B' ? 0.25 : 0.6)) {
            continue;
          }
          const tupleCount =
            style === 'C' && beat === 2 ? 3 : rng.chance(0.6) ? 3 : 2;
          for (let sub = 0; sub < tupleCount; sub++) {
            const tick = barStart + beat * 480 + sub * 160;
            let pitch = rapAnchor;
            if (beat === 3 && sub === tupleCount - 1) {
              pitch = wholeBelow;
            } else if (sub === 1 && rng.chance(0.35)) {
              pitch = m3Pitch;
            } else if (beat === 1 && sub === 0 && rng.chance(0.25)) {
              pitch = semiBelow;
            }
            notes.push({
              pitch: clampVocalPitch(pitch),
              velocity: clampVelocity(
                baseVel + (sub === 0 ? 6 : -8) + rng.nextInt(-4, 4)
              ),
              startTick: tick,
              durationTicks: 135,
              channel: TRACK_CHANNELS.vocal,
            });
          }
        }
      } else if (preset === 'rap_nu_metal') {
        const basePattern =
          style === 'B'
            ? [0, 360, 480, 720, 960, 1200, 1440, 1680]
            : style === 'C'
              ? [0, 120, 360, 480, 840, 960, 1200, 1440, 1560, 1680]
              : [0, 360, 480, 840, 960, 1320, 1440, 1680];
        for (let i = 0; i < basePattern.length; i++) {
          const off = basePattern[i];
          if (isPhraseEndBar && off > 1560) continue;
          if (i > 0 && i < basePattern.length - 2 && rng.chance(0.18)) {
            continue;
          }
          let pitch = rapAnchor;
          if (off === 360 || off === 840) {
            pitch = m3Pitch;
          } else if (off === 1440 && bar % 2 === 1) {
            pitch = fifthPitch;
          } else if (off === 1680) {
            pitch = wholeBelow;
          }
          notes.push({
            pitch: clampVocalPitch(pitch),
            velocity: clampVelocity(
              baseVel + (off === 480 || off === 1440 ? 10 : 0) + rng.nextInt(-3, 5)
            ),
            startTick: barStart + off,
            durationTicks: 110,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else {
        // rap_monotone_chant
        const chantSteps =
          style === 'C'
            ? [0, 240, 480, 840, 960, 1200, 1440]
            : style === 'B'
              ? [0, 480, 960, 1200, 1440]
              : [0, 240, 480, 960, 1200];
        for (let i = 0; i < chantSteps.length; i++) {
          const off = chantSteps[i];
          if (isPhraseEndBar && i === chantSteps.length - 1 && rng.chance(0.45)) {
            continue;
          }
          const isTail = isPhraseEndBar && i === chantSteps.length - 1;
          const pitch = isTail ? wholeBelow : rapAnchor;
          notes.push({
            pitch: clampVocalPitch(pitch),
            velocity: clampVelocity(
              baseVel + (off % 960 === 0 ? 6 : -4) + rng.nextInt(-3, 3)
            ),
            startTick: barStart + off,
            durationTicks: 180,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      }
    }

    return enforceMonophonicAndClip(notes, sectionEnd);
  }

  // Melody presets: auto, melody_pop, melody_ballad, melody_alt_minor
  const minMelPitch = section.energy === 'High' ? 60 : 57;
  const maxMelPitch = section.energy === 'High' ? 74 : 71;
  const pentOffsets =
    song.scale === 'Major' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
  const pentPcs = new Set(pentOffsets.map((o) => (keySemitone + o) % 12));
  const pentGrid = buildScaleGrid(pentPcs, 55, 72);

  let prevPitch = fitPitchClassToRange(
    keySemitone,
    minMelPitch,
    Math.min(minMelPitch + 9, maxMelPitch)
  );

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * TICKS_PER_BAR;
    const chord = resolveChordForBar(
      section.chords,
      bar,
      song.key,
      song.scale
    );
    const chordThird = chord.rootSemitone + (chord.intervals[1] ?? 4);
    const chordFifth = chord.rootSemitone + (chord.intervals[2] ?? 7);
    const isPhraseEnd = bar % 2 === 1 || bar === section.bars - 1;

    if (preset === 'melody_ballad' || (preset === 'auto' && section.energy === 'Low')) {
      const slots =
        style === 'C'
          ? [
              { off: 0, dur: 900 },
              { off: 960, dur: 440 },
              { off: 1440, dur: 420 },
            ]
          : [
              { off: 0, dur: 920 },
              { off: 960, dur: isPhraseEnd ? 720 : 880 },
            ];
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const targetPc =
          i === 0 ? chord.rootSemitone : i === 1 ? chordThird : chordFifth;
        const targetPitch = fitPitchClassToRange(targetPc, 57, 69);
        const pitch = nearestScalePitch(
          Math.round((prevPitch + targetPitch) / 2),
          scalePcs,
          57,
          69
        );
        prevPitch = pitch;
        notes.push({
          pitch,
          velocity: clampVelocity(baseVel - 6 + rng.nextInt(-5, 5)),
          startTick: barStart + slot.off,
          durationTicks: slot.dur,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    if (preset === 'melody_alt_minor') {
      const grid = pentGrid.length > 0 ? pentGrid : scaleNotes;
      const offs =
        style === 'B'
          ? [0, 480, 720, 960, 1440]
          : style === 'C'
            ? [0, 240, 480, 720, 960, 1200, 1440]
            : [0, 240, 720, 960, 1440];
      for (let i = 0; i < offs.length; i++) {
        const off = offs[i];
        if (isPhraseEnd && off >= 1440) continue;
        const nearestIdx = grid.reduce(
          (bestIdx, p, idx) =>
            Math.abs(p - prevPitch) < Math.abs(grid[bestIdx] - prevPitch)
              ? idx
              : bestIdx,
          0
        );
        const delta =
          i === 0
            ? rng.pick([0, 1, 2])
            : isPhraseEnd && i === offs.length - 2
              ? -1
              : rng.pick([-1, 0, 1, 2]);
        const nextIdx = Math.min(
          grid.length - 1,
          Math.max(0, nearestIdx + delta)
        );
        const pitch = grid[nextIdx] ?? prevPitch;
        prevPitch = pitch;
        notes.push({
          pitch,
          velocity: clampVelocity(baseVel + (off % 960 === 0 ? 5 : -4) + rng.nextInt(-4, 4)),
          startTick: barStart + off,
          durationTicks: isPhraseEnd && i === offs.length - 2 ? 420 : 220,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    // melody_pop or auto (Mid / High)
    const eighths =
      style === 'B'
        ? [0, 480, 720, 960, 1200, 1440]
        : style === 'C'
          ? [0, 240, 480, 720, 960, 1200, 1440, 1680]
          : [0, 240, 480, 960, 1200, 1440];

    for (let i = 0; i < eighths.length; i++) {
      const off = eighths[i];
      if (isPhraseEnd && off >= 1440) continue;
      if (i > 0 && rng.chance(0.15)) continue;

      let pitch: number;
      if (off === 0) {
        pitch = fitPitchClassToRange(
          rng.chance(0.5) ? chord.rootSemitone : chordFifth,
          minMelPitch,
          maxMelPitch - 2
        );
      } else {
        const step = rng.pick([-2, -1, 1, 2, 3]);
        pitch = nearestScalePitch(
          prevPitch + step,
          scalePcs,
          minMelPitch,
          maxMelPitch
        );
      }
      prevPitch = pitch;

      notes.push({
        pitch,
        velocity: clampVelocity(
          baseVel + (off % 960 === 0 ? 6 : -2) + rng.nextInt(-4, 4)
        ),
        startTick: barStart + off,
        durationTicks:
          i === eighths.length - 1 || (isPhraseEnd && off >= 1200) ? 400 : 210,
        channel: TRACK_CHANNELS.vocal,
      });
    }
  }

  return enforceMonophonicAndClip(notes, sectionEnd);
}
