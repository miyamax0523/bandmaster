import {
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type KeyName,
  type MidiNote,
  type ScaleType,
  type VocalHarmonyMode,
} from '../types/song';
import {
  fitPitchClassToRange,
  getScalePitchClasses,
  noteNameToSemitone,
  resolveChordForBar,
  type ParsedChord,
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

function buildScaleGrid(
  scalePcs: ReadonlySet<number>,
  minP = 52,
  maxP = 72
): number[] {
  const out: number[] = [];
  for (let p = minP; p <= maxP; p++) {
    if (scalePcs.has(p % 12)) {
      out.push(p);
    }
  }
  return out;
}

function nearestScalePitch(
  target: number,
  scalePcs: ReadonlySet<number>,
  minP = 52,
  maxP = 72
): number {
  const clamped = Math.min(maxP, Math.max(minP, Math.round(target)));
  if (scalePcs.has(clamped % 12)) {
    return clamped;
  }
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

function getScaleChordTones(
  chord: ParsedChord,
  scalePcs: ReadonlySet<number>,
  minP: number,
  maxP: number
): number[] {
  const candidatePcs: number[] = [];
  for (const iv of chord.intervals) {
    const pc = (chord.rootSemitone + iv) % 12;
    if (scalePcs.has(pc) && !candidatePcs.includes(pc)) {
      candidatePcs.push(pc);
    }
  }
  // Include 7th and 9th diatonic color tones if in scale
  for (const ext of [10, 11, 14]) {
    const pc = (chord.rootSemitone + ext) % 12;
    if (scalePcs.has(pc) && !candidatePcs.includes(pc)) {
      candidatePcs.push(pc);
    }
  }

  const pitches: number[] = [];
  for (let p = minP; p <= maxP; p++) {
    if (candidatePcs.includes(p % 12)) {
      pitches.push(p);
    }
  }
  if (pitches.length > 0) return pitches;

  const fallback = buildScaleGrid(scalePcs, minP, maxP);
  return fallback.length > 0 ? fallback : [nearestScalePitch(60, scalePcs, 48, 76)];
}

function pickClosestFromList(target: number, candidates: readonly number[]): number {
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - target);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function computeContinuityRange(
  energy: 'Low' | 'Mid' | 'High',
  prevVocalAvgPitch?: number
): { minP: number; maxP: number } {
  if (prevVocalAvgPitch === undefined || Number.isNaN(prevVocalAvgPitch)) {
    if (energy === 'Low') return { minP: 54, maxP: 66 };
    if (energy === 'High') return { minP: 57, maxP: 72 };
    return { minP: 55, maxP: 69 };
  }

  // Smooth transition from previous section (e.g., Rap -> Chorus Melody):
  // center lifts at most +4..+5 semitones and ceiling stays <= prevCenter + 7 (clamped to 52..72)
  const prevCenter = Math.min(70, Math.max(54, Math.round(prevVocalAvgPitch)));
  const maxLift = energy === 'High' ? 4 : energy === 'Low' ? -2 : 2;
  const targetCenter = Math.min(68, Math.max(54, prevCenter + maxLift));
  const minP = Math.max(52, Math.min(prevCenter - 2, targetCenter - 5));
  const maxP = Math.min(72, Math.max(minP + 7, prevCenter + 7));
  return { minP, maxP };
}

export function generateVocalNotes(input: EngineInput): MidiNote[] {
  const { song, section, style, seed, params, prevVocalAvgPitch } = input;
  const member = song.members.vocal;
  if (!member?.enabled || section.enabledParts?.vocal === false) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;
  const vocalDensity = section.vocalDensity ?? 3;

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
  const { minP: bandMin, maxP: bandMax } = computeContinuityRange(
    section.energy,
    prevVocalAvgPitch
  );
  const scaleNotes = buildScaleGrid(scalePcs, 52, 72);

  // Rap anchor strictly within song Key/Scale around E3..F4
  const rawAnchor = fitPitchClassToRange(
    keySemitone,
    Math.max(54, bandMin),
    Math.min(64, bandMax)
  );
  const rapAnchor = nearestScalePitch(rawAnchor, scalePcs, 52, 68);
  const anchorIdx = Math.max(
    0,
    scaleNotes.indexOf(rapAnchor)
  );
  const scaleStep = (delta: number): number => {
    const idx = Math.min(
      scaleNotes.length - 1,
      Math.max(0, anchorIdx + delta)
    );
    return scaleNotes[idx] ?? rapAnchor;
  };
  const rapBelow = scaleStep(-1);
  const rapTwoBelow = scaleStep(-2);
  const rapSecond = scaleStep(1);
  const rapThird = scaleStep(2);
  const rapFifth = scaleStep(4);

  const baseVel =
    section.energy === 'High' ? 104 : section.energy === 'Low' ? 78 : 92;
  const notes: MidiNote[] = [];

  const isRapPreset = preset.startsWith('rap_');
  if (isRapPreset) {
    // Prepare deterministic 2-bar motif for rap_hook_chant
    const hookVariant = rng.nextInt(0, 2);
    const hookMotifBar0 =
      hookVariant === 0
        ? [0, 360, 480, 960, 1200, 1440]
        : hookVariant === 1
          ? [0, 240, 480, 840, 960, 1440]
          : [0, 480, 720, 960, 1320, 1440];
    const hookMotifBar1 =
      style === 'C'
        ? [0, 240, 480, 720, 960, 1200]
        : [0, 360, 480, 960, 1200];

    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * TICKS_PER_BAR;
      const isPhraseEndBar = bar % 2 === 1 || bar === section.bars - 1;

      if (preset === 'rap_16th_push' || preset === 'rap_double_time') {
        const isDouble = preset === 'rap_double_time';
        const restStartStep =
          vocalDensity <= 1
            ? 8
            : vocalDensity === 2
              ? 10
              : isDouble
                ? rng.nextInt(10, 12)
                : style === 'B'
                  ? 14
                  : style === 'C'
                    ? rng.nextInt(10, 13)
                    : rng.nextInt(12, 14);
        const burstGapStep = style === 'A' ? 7 : rng.nextInt(5, 8);
        const stepStride =
          vocalDensity === 1 ? 4 : vocalDensity === 2 ? 2 : 1;

        for (let s = 0; s < 16; s += stepStride) {
          if (s >= restStartStep) continue;
          if (
            vocalDensity === 3 &&
            s === burstGapStep &&
            rng.chance(isDouble ? 0.25 : 0.6)
          ) {
            continue;
          }
          if (
            vocalDensity <= 3 &&
            style === 'A' &&
            !isDouble &&
            s % 4 === 3 &&
            rng.chance(0.45)
          ) {
            continue;
          }
          if (vocalDensity === 5 && s >= restStartStep && isDouble) continue;

          let pitch = rapAnchor;
          if (s === restStartStep - stepStride && isPhraseEndBar) {
            pitch = rng.chance(0.5) ? rapTwoBelow : rapBelow;
          } else if (s % 4 === 2 && rng.chance(style === 'C' ? 0.55 : 0.3)) {
            pitch = rapThird;
          } else if (s === 0 && bar > 0 && rng.chance(0.25)) {
            pitch = isDouble ? rapSecond : rapFifth;
          } else if (s % 8 === 7 && rng.chance(0.4)) {
            pitch = rapBelow;
          }

          const accent = s % 4 === 0 ? 8 : s % 2 === 0 ? 0 : -10;
          const dur =
            vocalDensity === 1
              ? 360
              : vocalDensity === 2
                ? 190
                : 100;
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel + accent + rng.nextInt(-4, 4)),
            startTick: barStart + s * 120,
            durationTicks: dur,
            channel: TRACK_CHANNELS.vocal,
          });
        }
        // High vocalDensity extra pickup on bar rest pocket
        if (vocalDensity >= 4 && !isPhraseEndBar) {
          for (const extra of vocalDensity === 5 ? [1440, 1560, 1680, 1800] : [1440, 1680]) {
            if (extra >= restStartStep * 120) {
              notes.push({
                pitch: extra === 1800 ? rapBelow : rapAnchor,
                velocity: clampVelocity(baseVel - 6 + rng.nextInt(-3, 4)),
                startTick: barStart + extra,
                durationTicks: 100,
                channel: TRACK_CHANNELS.vocal,
              });
            }
          }
        }
      } else if (preset === 'rap_triplet_trap') {
        const dropBeat =
          style === 'B' ? 3 : style === 'C' ? rng.nextInt(1, 2) : 2;
        for (let beat = 0; beat < 4; beat++) {
          if (vocalDensity === 1 && (beat === 1 || beat === 3)) continue;
          if (beat === 3 && isPhraseEndBar && vocalDensity <= 3 && rng.chance(0.65)) {
            continue;
          }
          if (
            vocalDensity <= 3 &&
            beat === dropBeat &&
            rng.chance(style === 'B' ? 0.25 : 0.55)
          ) {
            continue;
          }
          const tupleCount =
            vocalDensity === 1
              ? 1
              : vocalDensity === 2
                ? 2
                : vocalDensity >= 4
                  ? 3
                  : style === 'C' && beat === 2
                    ? 3
                    : rng.chance(0.6)
                      ? 3
                      : 2;
          for (let sub = 0; sub < tupleCount; sub++) {
            const tick = barStart + beat * 480 + sub * 160;
            let pitch = rapAnchor;
            if (beat === 3 && sub === tupleCount - 1) {
              pitch = rapTwoBelow;
            } else if (sub === 1 && rng.chance(0.35)) {
              pitch = rapThird;
            } else if (beat === 1 && sub === 0 && rng.chance(0.25)) {
              pitch = rapBelow;
            }
            notes.push({
              pitch,
              velocity: clampVelocity(
                baseVel + (sub === 0 ? 6 : -8) + rng.nextInt(-4, 4)
              ),
              startTick: tick,
              durationTicks: vocalDensity <= 2 ? 260 : 135,
              channel: TRACK_CHANNELS.vocal,
            });
          }
        }
      } else if (preset === 'rap_laidback_groove') {
        // Offbeat-heavy laid-back pocket sitting low around root/below
        const laidBackSteps =
          vocalDensity <= 1
            ? [240, 1200]
            : vocalDensity === 2
              ? [240, 720, 1200, 1680]
              : vocalDensity >= 4
                ? [0, 240, 360, 600, 840, 960, 1080, 1320, 1560, 1680]
                : style === 'C'
                  ? [240, 360, 600, 840, 1080, 1320, 1680]
                  : [240, 600, 840, 1200, 1560];
        for (let i = 0; i < laidBackSteps.length; i++) {
          const off = laidBackSteps[i];
          if (vocalDensity === 3 && i > 1 && rng.chance(0.15)) continue;
          const pitch =
            isPhraseEndBar && i === laidBackSteps.length - 1
              ? rapTwoBelow
              : i % 3 === 1
                ? rapBelow
                : i % 4 === 2
                  ? rapSecond
                  : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel - 4 + (off % 480 === 240 ? 6 : -2) + rng.nextInt(-4, 4)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 280 : 160,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_hook_chant') {
        // Repeating 2-bar anthem hook motif
        const motif = bar % 2 === 0 ? hookMotifBar0 : hookMotifBar1;
        const activeSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? motif.filter((_, idx) => idx % 2 === 0)
              : vocalDensity >= 4
                ? Array.from(new Set([...motif, 240, 720, 1560])).sort((a, b) => a - b)
                : motif;
        for (let i = 0; i < activeSteps.length; i++) {
          const off = activeSteps[i];
          const pitch =
            bar % 2 === 1 && i === activeSteps.length - 1
              ? rapThird
              : off === 480 || off === 1440
                ? rapAnchor
                : off === 1200
                  ? rapSecond
                  : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (off % 480 === 0 ? 10 : -2) + rng.nextInt(-3, 3)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 320 : 180,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_nu_metal') {
        const basePattern =
          vocalDensity <= 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960, 1440]
              : vocalDensity >= 4
                ? [0, 120, 240, 360, 480, 720, 840, 960, 1200, 1320, 1440, 1560, 1680]
                : style === 'B'
                  ? [0, 360, 480, 720, 960, 1200, 1440, 1680]
                  : style === 'C'
                    ? [0, 120, 360, 480, 840, 960, 1200, 1440, 1560, 1680]
                    : [0, 360, 480, 840, 960, 1320, 1440, 1680];
        for (let i = 0; i < basePattern.length; i++) {
          const off = basePattern[i];
          if (vocalDensity <= 3 && isPhraseEndBar && off > 1560) continue;
          if (vocalDensity === 3 && i > 0 && i < basePattern.length - 2 && rng.chance(0.18)) {
            continue;
          }
          let pitch = rapAnchor;
          if (off === 360 || off === 840) {
            pitch = rapThird;
          } else if (off === 1440 && bar % 2 === 1) {
            pitch = rapFifth;
          } else if (off === 1680) {
            pitch = rapTwoBelow;
          }
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (off === 480 || off === 1440 ? 10 : 0) + rng.nextInt(-3, 5)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 260 : 110,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_jhiphop_bounce') {
        const bounceSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960, 1440]
              : vocalDensity === 3
                ? [0, 240, 480, 720, 960, 1200, 1440]
                : vocalDensity === 4
                  ? [0, 240, 360, 480, 720, 960, 1080, 1200, 1440, 1680]
                  : [0, 120, 240, 360, 480, 720, 840, 960, 1080, 1200, 1440, 1560, 1680];
        for (let i = 0; i < bounceSteps.length; i++) {
          const off = bounceSteps[i];
          const isTail = i === bounceSteps.length - 1;
          const pitch = isTail
            ? isPhraseEndBar
              ? rapThird
              : rapBelow
            : off % 480 === 240
              ? rapSecond
              : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (isTail ? 10 : off % 480 === 240 ? 4 : 0) + rng.nextInt(-3, 3)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 240 : isTail ? 260 : 150,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_mixture_melodic') {
        const mixSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 360, 960, 1440]
              : vocalDensity === 3
                ? [0, 360, 480, 840, 960, 1200, 1440]
                : vocalDensity === 4
                  ? [0, 120, 360, 480, 720, 840, 960, 1200, 1440, 1680]
                  : [0, 120, 240, 360, 480, 600, 840, 960, 1080, 1200, 1320, 1440, 1680];
        const riseBar = bar === section.bars - 1 || isPhraseEndBar;
        for (let i = 0; i < mixSteps.length; i++) {
          const off = mixSteps[i];
          let pitch = rapAnchor;
          if (riseBar && i >= Math.max(1, mixSteps.length - 3)) {
            const stepPos = i - Math.max(1, mixSteps.length - 3);
            pitch = stepPos === 0 ? rapSecond : stepPos === 1 ? rapThird : rapFifth;
          } else if (off === 360 || off === 840) {
            pitch = rapThird;
          } else if (off % 480 === 0 && rng.chance(0.25)) {
            pitch = rapBelow;
          }
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (riseBar && i === mixSteps.length - 1 ? 12 : 4) + rng.nextInt(-3, 3)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 250 : riseBar && i === mixSteps.length - 1 ? 300 : 140,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_hybrid_soar') {
        const frontSteps =
          vocalDensity === 1
            ? [0]
            : vocalDensity === 2
              ? [0, 240, 480]
              : vocalDensity === 3
                ? [0, 120, 240, 360, 480, 720]
                : [0, 120, 240, 360, 480, 600, 720, 840];
        for (let i = 0; i < frontSteps.length; i++) {
          const off = frontSteps[i];
          notes.push({
            pitch: i % 3 === 2 ? rapSecond : rapAnchor,
            velocity: clampVelocity(baseVel + (off === 0 ? 6 : 0) + rng.nextInt(-3, 3)),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 200 : 100,
            channel: TRACK_CHANNELS.vocal,
          });
        }
        // Sustained melodic sing tail starting at beat 3 with arch expression & breath space
        const singPitch = bar % 2 === 1 ? rapFifth : rapThird;
        const singVel = clampVelocity(
          bar % 2 === 1 ? Math.min(110, baseVel + 8) : Math.max(76, baseVel - 4)
        );
        notes.push({
          pitch: singPitch,
          velocity: singVel,
          startTick: barStart + 960,
          durationTicks: isPhraseEndBar ? 720 : 840,
          channel: TRACK_CHANNELS.vocal,
        });
      } else if (preset === 'rap_cinematic_burst') {
        // Dramatic beat 1-3 burst followed by beat 4 dramatic silence
        const burstSteps =
          vocalDensity === 1
            ? [0, 480]
            : vocalDensity === 2
              ? [0, 240, 480, 960]
              : vocalDensity === 3
                ? [0, 120, 240, 480, 600, 720, 960, 1200]
                : [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200, 1320];
        for (let i = 0; i < burstSteps.length; i++) {
          const off = burstSteps[i];
          const pitch =
            i === burstSteps.length - 1
              ? rapFifth
              : off >= 960
                ? rapThird
                : i % 4 === 2
                  ? rapSecond
                  : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (off >= 960 ? 10 : off % 480 === 0 ? 6 : -2)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 220 : 105,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_emo_sparse') {
        const emoSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960]
              : vocalDensity === 3
                ? [0, 360, 960, 1320]
                : vocalDensity === 4
                  ? [0, 240, 360, 720, 960, 1200, 1560]
                  : [0, 120, 360, 480, 720, 960, 1200, 1320, 1560];
        for (let i = 0; i < emoSteps.length; i++) {
          const off = emoSteps[i];
          const pitch =
            i === 0 ? rapBelow : i % 2 === 1 ? rapTwoBelow : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel - 12 + (off % 960 === 0 ? 6 : 0)),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 360 : 210,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else {
        // rap_monotone_chant
        const chantSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960]
              : vocalDensity >= 4
                ? [0, 120, 240, 480, 720, 960, 1200, 1320, 1440, 1680]
                : style === 'C'
                  ? [0, 240, 480, 840, 960, 1200, 1440]
                  : style === 'B'
                    ? [0, 480, 960, 1200, 1440]
                    : [0, 240, 480, 960, 1200];
        for (let i = 0; i < chantSteps.length; i++) {
          const off = chantSteps[i];
          if (vocalDensity <= 3 && isPhraseEndBar && i === chantSteps.length - 1 && rng.chance(0.45)) {
            continue;
          }
          const isTail = isPhraseEndBar && i === chantSteps.length - 1;
          const pitch = isTail ? rapBelow : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(
              baseVel + (off % 960 === 0 ? 6 : -4) + rng.nextInt(-3, 3)
            ),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 360 : 180,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      }
    }

    return enforceMonophonicAndClip(notes, sectionEnd);
  }

  // Melody presets (Melodic Soul: A->A' 2-bar motif, stepwise arch + 1 climax leap, breath rests, velocity curve)
  const pentOffsets =
    song.scale === 'Major' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
  const pentPcs = new Set(pentOffsets.map((o) => (keySemitone + o) % 12));
  const pentGrid = buildScaleGrid(pentPcs, bandMin, bandMax);
  const fullSoulGrid = buildScaleGrid(scalePcs, bandMin, bandMax);
  const soulGridBase =
    preset === 'melody_alt_minor' || preset === 'melody_britpop_catchy'
      ? pentGrid.length >= 4
        ? pentGrid
        : fullSoulGrid
      : fullSoulGrid.length > 0
        ? fullSoulGrid
        : scaleNotes;
  const soulGrid =
    soulGridBase.length > 0
      ? soulGridBase
      : [nearestScalePitch(60, scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH)];

  const findGridIdx = (targetPitch: number): number => {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < soulGrid.length; i++) {
      const d = Math.abs(soulGrid[i] - targetPitch);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  const velocityArc = (
    gridIdx: number,
    isPeak: boolean,
    isBreathTail: boolean
  ): number => {
    const ratio =
      soulGrid.length <= 1 ? 0.5 : gridIdx / Math.max(1, soulGrid.length - 1);
    if (isBreathTail) {
      return clampVelocity(Math.round(74 + ratio * 10)); // 74..84 gentle release before breath
    }
    if (isPeak) {
      return clampVelocity(Math.round(94 + ratio * 18)); // 94..112 emotional peak
    }
    return clampVelocity(Math.round(86 + ratio * 20)); // 86..106 expressive arch body
  };

  const initialAnchor = fitPitchClassToRange(
    keySemitone,
    bandMin,
    Math.min(bandMin + 8, bandMax)
  );
  let prevPitch = nearestScalePitch(initialAnchor, scalePcs, bandMin, bandMax);

  // Special mode: jrock_anticipation retains explicit barline-tie syncopation across all 5 parts
  if (preset === 'jrock_anticipation') {
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * TICKS_PER_BAR;
      const chord = resolveChordForBar(section.chords, bar, song.key, song.scale);
      const chordTones = getScaleChordTones(chord, scalePcs, bandMin, bandMax);
      const bodyOffsets =
        bar === 0
          ? vocalDensity <= 2
            ? [0, 960]
            : vocalDensity >= 4
              ? [0, 240, 480, 720, 960, 1200]
              : [0, 480, 960]
          : vocalDensity <= 2
            ? [720, 1200]
            : vocalDensity >= 4
              ? [480, 720, 960, 1200, 1440]
              : [480, 960, 1200];

      let currIdx = findGridIdx(prevPitch);
      for (let i = 0; i < bodyOffsets.length; i++) {
        const off = bodyOffsets[i];
        const step = i === 0 ? 0 : rng.pick([0, 1, 1, -1]);
        currIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + step));
        const pitch =
          off === 0
            ? pickClosestFromList(soulGrid[currIdx], chordTones)
            : soulGrid[currIdx];
        currIdx = findGridIdx(pitch);
        prevPitch = pitch;
        notes.push({
          pitch,
          velocity: velocityArc(currIdx, false, false),
          startTick: barStart + off,
          durationTicks: vocalDensity >= 4 ? 200 : 380,
          channel: TRACK_CHANNELS.vocal,
        });
      }

      const antTick = barStart + 1680;
      if (antTick < sectionEnd) {
        const nextChord = resolveChordForBar(
          section.chords,
          bar + 1,
          song.key,
          song.scale
        );
        const nextChordTones = getScaleChordTones(
          nextChord,
          scalePcs,
          bandMin,
          bandMax
        );
        const antPitch = pickClosestFromList(prevPitch + 2, nextChordTones);
        const antIdx = findGridIdx(antPitch);
        prevPitch = antPitch;
        notes.push({
          pitch: antPitch,
          velocity: velocityArc(antIdx, true, false),
          startTick: antTick,
          durationTicks: 700,
          channel: TRACK_CHANNELS.vocal,
        });
      }
    }
    return enforceMonophonicAndClip(notes, sectionEnd);
  }

  // Melodic Soul 2-bar (A -> A') motif state
  let motifAOnsets: number[] | null = null;
  let motifAStepDeltas: number[] | null = null;
  let currIdx = findGridIdx(prevPitch);

  const selectFrontOnsets = (): number[] => {
    if (vocalDensity === 1) return [0, 960];
    if (vocalDensity === 2) return [0, 480, 960, 1440];
    if (vocalDensity === 4) {
      if (preset === 'melody_syncopated_hook') {
        return [0, 120, 360, 600, 840, 960, 1200, 1560];
      }
      return [0, 240, 360, 480, 720, 960, 1200, 1440];
    }
    if (vocalDensity === 5) {
      return [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200, 1320, 1440, 1560];
    }
    // vocalDensity === 3
    if (preset === 'melody_ballad' || (preset === 'auto' && section.energy === 'Low')) {
      return [0, 480, 960];
    }
    if (preset === 'melody_emo_screamo') {
      return [0, 480, 960];
    }
    if (preset === 'melody_syncopated_hook') {
      return [0, 360, 720, 1200, 1560];
    }
    if (preset === 'melody_grunge_drag') {
      return [0, 270, 510, 990, 1470];
    }
    if (preset === 'melody_staccato_rock') {
      return [0, 240, 480, 960, 1200, 1440];
    }
    if (style === 'B') {
      return [0, 480, 720, 960, 1200];
    }
    return [0, 240, 480, 720, 960, 1200];
  };

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * TICKS_PER_BAR;
    const chord = resolveChordForBar(section.chords, bar, song.key, song.scale);
    const chordTones = getScaleChordTones(chord, scalePcs, bandMin, bandMax);
    const barRoot = nearestScalePitch(
      fitPitchClassToRange(chord.rootSemitone, bandMin, Math.min(bandMin + 9, bandMax)),
      scalePcs,
      bandMin,
      bandMax
    );
    const barRootIdx = findGridIdx(barRoot);

    // Preserve 4-bar call & response breathing structure
    if (preset === 'melody_call_response') {
      const cyclePos = bar % 4;
      if (cyclePos === 3) {
        continue;
      }
      if (cyclePos === 2) {
        if (vocalDensity >= 3) {
          const echoPitch = pickClosestFromList(soulGrid[currIdx], chordTones);
          currIdx = findGridIdx(echoPitch);
          notes.push({
            pitch: echoPitch,
            velocity: velocityArc(currIdx, false, true),
            startTick: barStart,
            durationTicks: 480,
            channel: TRACK_CHANNELS.vocal,
          });
        }
        continue;
      }
    }

    const phraseIndex = Math.floor(bar / 2);
    const isPhraseAPrime = phraseIndex % 2 === 1;
    const isPhraseFrontBar = bar % 2 === 0 && section.bars > 1;

    if (isPhraseFrontBar) {
      // Bar 0 (Motif A) or Bar 2 (Motif A' inheriting A's rhythm skeleton)
      const onsets: number[] =
        isPhraseAPrime && motifAOnsets ? [...motifAOnsets] : selectFrontOnsets();
      const deltas: number[] = [];

      // Start smoothly on chord tone within <= 2 scale steps of current position
      const startChordPitch = pickClosestFromList(barRoot, chordTones);
      const startChordIdx = findGridIdx(startChordPitch);
      if (bar === 0) {
        currIdx =
          preset === 'melody_grunge_drag'
            ? Math.min(soulGrid.length - 1, startChordIdx + 2)
            : startChordIdx;
      } else {
        const diff = startChordIdx - currIdx;
        const clampedStep = Math.max(-2, Math.min(2, diff));
        currIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + clampedStep));
      }

      for (let i = 0; i < onsets.length; i++) {
        const off = onsets[i];
        let delta: number;
        if (i === 0) {
          delta = 0;
        } else if (isPhraseAPrime && motifAStepDeltas && i < motifAStepDeltas.length) {
          // Inherit motif A's stepwise contour with mild upper lift in A'
          delta = motifAStepDeltas[i];
          if (i === onsets.length - 1 && delta <= 0) {
            delta = 1;
          }
        } else if (preset === 'melody_grunge_drag') {
          delta = i % 3 === 0 ? 1 : -1;
        } else if (preset === 'melody_emo_screamo') {
          delta = i % 2 === 1 ? 1 : 0; // Calm subdued opening bar
        } else if (preset === 'melody_britpop_catchy') {
          delta = i % 3 === 0 ? -1 : 1;
        } else {
          // Arch rise: predominantly 0 or +1/+2 stepwise, gentle step-down only when near ceiling
          const nearTop = currIdx >= soulGrid.length - 2;
          delta = nearTop ? -1 : rng.pick([1, 1, 0, 2, -1]);
        }

        // Strict anti-zigzag guard: never exceed ±2 steps in phrase front
        delta = Math.max(-2, Math.min(2, delta));
        deltas.push(delta);

        currIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + delta));
        const pitch = soulGrid[currIdx];
        const nextOff = i + 1 < onsets.length ? onsets[i + 1] : TICKS_PER_BAR;
        const rawGap = Math.max(100, nextOff - off);

        let dur: number;
        if (preset === 'melody_staccato_rock') {
          dur = Math.max(55, Math.min(220, Math.round(rawGap * 0.46)));
        } else if (vocalDensity === 1) {
          dur = Math.min(900, rawGap - 40);
        } else if (vocalDensity === 2) {
          dur = Math.min(440, rawGap - 30);
        } else if (vocalDensity >= 5) {
          dur = Math.min(110, rawGap - 10);
        } else {
          dur = Math.max(100, Math.min(rawGap - 20, i === onsets.length - 1 ? 420 : rawGap - 20));
        }

        const isLastSingleBar = section.bars === 1 && i === onsets.length - 1;
        notes.push({
          pitch,
          velocity: velocityArc(
            currIdx,
            preset !== 'melody_emo_screamo' && i === onsets.length - 1 && vocalDensity >= 3,
            preset === 'melody_emo_screamo' || isLastSingleBar
          ),
          startTick: barStart + off,
          durationTicks: dur,
          channel: TRACK_CHANNELS.vocal,
        });
      }

      if (!isPhraseAPrime) {
        motifAOnsets = onsets;
        motifAStepDeltas = deltas;
      }
      prevPitch = soulGrid[currIdx];
      continue;
    }

    // Phrase Tail / Climax Bar (bar 1, bar 3, ... OR single-bar fallback)
    // 1. Staccato Rock: crisp articulation + 1 climax leap + 480-tick breath rest at beat 4
    if (preset === 'melody_staccato_rock') {
      const tailSteps =
        vocalDensity === 1
          ? [0, 960]
          : vocalDensity === 2
            ? [0, 480, 960]
            : vocalDensity >= 4
              ? [0, 120, 240, 480, 720, 960, 1200]
              : [0, 240, 480, 960, 1200];
      const leapStep = isPhraseAPrime ? 4 : 3;
      for (let i = 0; i < tailSteps.length; i++) {
        const off = tailSteps[i];
        if (i === 0) {
          currIdx = Math.min(soulGrid.length - 1, currIdx + leapStep); // Single expressive leap up
        } else {
          currIdx = Math.max(0, currIdx - 1); // Stepwise arch descent
        }
        const nextOff = i + 1 < tailSteps.length ? tailSteps[i + 1] : 1440;
        const span = Math.min(480, Math.max(120, nextOff - off));
        const staccatoDur = Math.max(55, Math.min(220, Math.round(span * 0.46)));
        const isLast = i === tailSteps.length - 1;
        notes.push({
          pitch: soulGrid[currIdx],
          velocity: velocityArc(currIdx, i === 0, isLast),
          startTick: barStart + off,
          durationTicks: staccatoDur,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      prevPitch = soulGrid[currIdx];
      continue;
    }

    // 2. Single soaring long tone (melody_soar_long) -> >= 1400 ticks AND 480 ticks breath rest
    if (preset === 'melody_soar_long') {
      const leapSize = isPhraseAPrime ? 4 : 3;
      const climaxGoalIdx = Math.min(soulGrid.length - 1, currIdx + leapSize);
      const climaxPitch = pickClosestFromList(soulGrid[climaxGoalIdx], chordTones);
      currIdx = findGridIdx(climaxPitch);
      prevPitch = climaxPitch;
      notes.push({
        pitch: climaxPitch,
        velocity: velocityArc(currIdx, true, false),
        startTick: barStart,
        durationTicks: 1440, // >= 1400 ticks long tone + 480 ticks breath rest before next bar
        channel: TRACK_CHANNELS.vocal,
      });
      continue;
    }

    // 3. Standard Melodic Soul Tail: climax upward leap (+3..+5 steps), stepwise settle, >= 960 sustain, 360..480 breath rest
    const leapSteps =
      preset === 'melody_alt_soar' || preset === 'melody_metalcore_chorus' || preset === 'melody_emo_screamo'
        ? isPhraseAPrime
          ? 5
          : 4
        : isPhraseAPrime
          ? 4
          : 3;

    // Climax peak index (one expressive leap upward from current contour)
    const peakIdx = Math.min(soulGrid.length - 1, Math.max(currIdx + 2, barRootIdx + leapSteps));

    if (vocalDensity === 1) {
      // Sustained single long tone with 480-tick breath rest
      currIdx = isPhraseAPrime
        ? peakIdx
        : findGridIdx(pickClosestFromList(soulGrid[Math.min(soulGrid.length - 1, barRootIdx + 2)], chordTones));
      prevPitch = soulGrid[currIdx];
      notes.push({
        pitch: prevPitch,
        velocity: velocityArc(currIdx, isPhraseAPrime, !isPhraseAPrime),
        startTick: barStart,
        durationTicks: 1440, // 1440 >= 960, leaves 480 tick breath rest
        channel: TRACK_CHANNELS.vocal,
      });
      continue;
    }

    const pickupOffsets =
      vocalDensity === 2
        ? [0]
        : vocalDensity === 3
          ? preset === 'melody_syncopated_hook'
            ? [0, 360]
            : [0, 240]
          : [0, 120, 240, 360];

    for (let i = 0; i < pickupOffsets.length; i++) {
      const off = pickupOffsets[i];
      if (i === 0) {
        // The emotional climax leap
        currIdx = peakIdx;
      } else {
        // Gentle stepwise descent after the peak
        currIdx = Math.max(0, currIdx - 1);
      }
      const nextOff = i + 1 < pickupOffsets.length ? pickupOffsets[i + 1] : 480;
      const dur = vocalDensity >= 4 ? Math.min(110, nextOff - off - 10) : Math.max(100, nextOff - off - 20);
      notes.push({
        pitch: soulGrid[currIdx],
        velocity: velocityArc(currIdx, i === 0, false),
        startTick: barStart + off,
        durationTicks: dur,
        channel: TRACK_CHANNELS.vocal,
      });
    }

    // Long sustained landing note (beat 2 -> 1560, durationTicks = 1080 >= 960, leaving 360-tick breath rest 1560..1920)
    // In Phrase A, resolve stepwise down toward chord root/3rd; in Phrase A', lift higher onto 3rd/5th climax resolution!
    const landingCandidates = chordTones.filter((p) => {
      const gIdx = findGridIdx(p);
      return isPhraseAPrime ? gIdx >= barRootIdx + 2 : gIdx <= currIdx;
    });
    const resolvedTarget =
      landingCandidates.length > 0
        ? pickClosestFromList(
            soulGrid[Math.max(0, Math.min(soulGrid.length - 1, currIdx - (isPhraseAPrime ? 0 : 1)))],
            landingCandidates
          )
        : soulGrid[Math.max(0, currIdx - 1)];
    // Keep transition from peak to landing smooth (step down by 1..2 scale steps if needed)
    const desiredIdx = findGridIdx(resolvedTarget);
    if (Math.abs(desiredIdx - currIdx) > 2) {
      currIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + (desiredIdx > currIdx ? 1 : -1)));
    } else {
      currIdx = desiredIdx;
    }
    prevPitch = soulGrid[currIdx];

    notes.push({
      pitch: prevPitch,
      velocity: velocityArc(currIdx, false, true), // Breath-tail softening (74..84)
      startTick: barStart + 480,
      durationTicks: 1080, // >= 960 ticks long tone; leaves 360 ticks breath rest [1560..1920]
      channel: TRACK_CHANNELS.vocal,
    });
  }

  return enforceMonophonicAndClip(notes, sectionEnd);
}

/**
 * Generates diatonic or octave harmony notes from the resolved main Vocal melody.
 */
export function generateVocalHarmonyNotes(
  melodyNotes: readonly MidiNote[],
  key: KeyName,
  scale: ScaleType,
  mode: VocalHarmonyMode
): MidiNote[] {
  if (mode === 'off' || melodyNotes.length === 0) {
    return [];
  }

  const scalePcs = new Set(getScalePitchClasses(key, scale));
  const scaleGrid = buildScaleGrid(scalePcs, 24, 96);

  return melodyNotes.map((n) => {
    let pitch = n.pitch;
    if (mode === 'octave_up') {
      pitch = Math.min(88, n.pitch + 12);
    } else {
      const snapped = nearestScalePitch(n.pitch, scalePcs, 24, 96);
      const idx = scaleGrid.indexOf(snapped);
      if (idx >= 0) {
        const delta = mode === 'upper_3rd' ? 2 : -2;
        const targetIdx = Math.max(0, Math.min(scaleGrid.length - 1, idx + delta));
        pitch = scaleGrid[targetIdx];
      } else {
        pitch = mode === 'upper_3rd' ? n.pitch + 4 : n.pitch - 4;
      }
    }

    return {
      pitch: Math.max(0, Math.min(127, Math.round(pitch))),
      velocity: Math.max(45, Math.min(127, Math.round(n.velocity * 0.82))),
      startTick: n.startTick,
      durationTicks: n.durationTicks,
      channel: TRACK_CHANNELS.vocalHarmony,
    };
  });
}
