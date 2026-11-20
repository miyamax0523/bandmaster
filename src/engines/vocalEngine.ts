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
        // Sustained melodic sing tail starting at beat 3
        notes.push({
          pitch: bar % 2 === 1 ? rapFifth : rapThird,
          velocity: clampVelocity(baseVel + 8),
          startTick: barStart + 960,
          durationTicks: isPhraseEndBar ? 840 : 760,
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

  // Melody presets (strict scale conformance + chord tone landing + smooth continuity)
  const pentOffsets =
    song.scale === 'Major' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
  const pentPcs = new Set(pentOffsets.map((o) => (keySemitone + o) % 12));
  const pentGrid = buildScaleGrid(pentPcs, bandMin, bandMax);

  const initialAnchor = fitPitchClassToRange(
    keySemitone,
    bandMin,
    Math.min(bandMin + 8, bandMax)
  );
  let prevPitch = nearestScalePitch(initialAnchor, scalePcs, bandMin, bandMax);

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * TICKS_PER_BAR;
    const chord = resolveChordForBar(
      section.chords,
      bar,
      song.key,
      song.scale
    );
    const chordTones = getScaleChordTones(chord, scalePcs, bandMin, bandMax);
    const barRoot = nearestScalePitch(
      fitPitchClassToRange(chord.rootSemitone, bandMin, Math.min(bandMin + 9, bandMax)),
      scalePcs,
      bandMin,
      bandMax
    );
    const isPhraseEnd = bar % 2 === 1 || bar === section.bars - 1;

    const chooseMelodyPitch = (isStrongBeat: boolean, isEndNote: boolean): number => {
      if (isEndNote) {
        return pickClosestFromList(prevPitch, chordTones);
      }
      if (isStrongBeat || rng.chance(0.65)) {
        // Land smoothly on chord tone within <= 5 semitones if possible
        const closeChordTones = chordTones.filter(
          (p) => Math.abs(p - prevPitch) <= 5
        );
        if (closeChordTones.length > 0) {
          return rng.pick(closeChordTones);
        }
        return pickClosestFromList(prevPitch, chordTones);
      }
      const step = rng.pick([-2, -1, 1, 2]);
      return nearestScalePitch(prevPitch + step, scalePcs, bandMin, bandMax);
    };

    // 0. jrock_anticipation: beat 4-and (1680) anticipation into next chord & tie across barline
    if (preset === 'jrock_anticipation') {
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

      for (let i = 0; i < bodyOffsets.length; i++) {
        const off = bodyOffsets[i];
        const pitch = chooseMelodyPitch(off % 480 === 0, false);
        prevPitch = pitch;
        notes.push({
          pitch,
          velocity: clampVelocity(baseVel + (off === 0 ? 6 : 0) + rng.nextInt(-3, 3)),
          startTick: barStart + off,
          durationTicks: vocalDensity >= 4 ? 200 : 380,
          channel: TRACK_CHANNELS.vocal,
        });
      }

      // Anticipate next chord's chord tone (strictly inside Key/Scale) at barStart + 1680 and tie across barline
      const antTick = barStart + 1680;
      if (antTick < sectionEnd) {
        const nextChord = resolveChordForBar(
          section.chords,
          bar + 1,
          song.key,
          song.scale
        );
        const nextChordTones = getScaleChordTones(nextChord, scalePcs, bandMin, bandMax);
        const antPitch = pickClosestFromList(prevPitch + 2, nextChordTones);
        prevPitch = antPitch;
        notes.push({
          pitch: antPitch,
          velocity: clampVelocity(baseVel + 8),
          startTick: antTick,
          durationTicks: 700,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    // 1. melody_call_response: 4-bar cycle -> bars 0..1 sing, bars 2..3 sparse/rest
    if (preset === 'melody_call_response') {
      const cyclePos = bar % 4;
      if (cyclePos === 3) {
        // Last bar of response stays completely open rest (instrument space)
        continue;
      }
      if (cyclePos === 2) {
        // Bar 3: subtle 1-note resolving echo only at beat 1 (if density >= 3)
        if (vocalDensity >= 3) {
          const pitch = pickClosestFromList(prevPitch, chordTones);
          prevPitch = pitch;
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel - 12),
            startTick: barStart,
            durationTicks: 480,
            channel: TRACK_CHANNELS.vocal,
          });
        }
        continue;
      }
    }

    // 2. melody_soar_long: Sustained whole/dotted-half long tones on bars 2 & 4 (gate >= 95%)
    if (preset === 'melody_soar_long') {
      if (isPhraseEnd || section.bars === 1) {
        const pitch = pickClosestFromList(prevPitch + 2, chordTones);
        prevPitch = pitch;
        if (vocalDensity >= 4 && section.bars > 1) {
          const leadPitch = nearestScalePitch(pitch - 2, scalePcs, bandMin, bandMax);
          notes.push({
            pitch: leadPitch,
            velocity: clampVelocity(baseVel - 4),
            startTick: barStart,
            durationTicks: 440,
            channel: TRACK_CHANNELS.vocal,
          });
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel + 6),
            startTick: barStart + 480,
            durationTicks: 1400, // ~97% of remaining 1440 ticks
            channel: TRACK_CHANNELS.vocal,
          });
        } else {
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel + 6),
            startTick: barStart,
            durationTicks: 1860, // ~97% of 1920 ticks
            channel: TRACK_CHANNELS.vocal,
          });
        }
        continue;
      }
    }

    // 3. melody_staccato_rock: Short crisp rock articulation (40-55% gate) + rests
    if (preset === 'melody_staccato_rock') {
      const steps =
        vocalDensity === 1
          ? [0, 960]
          : vocalDensity === 2
            ? [0, 480, 960]
            : vocalDensity >= 4
              ? [0, 240, 480, 600, 720, 960, 1200, 1440, 1560]
              : [0, 240, 480, 960, 1200, 1440];
      for (let i = 0; i < steps.length; i++) {
        const off = steps[i];
        if (vocalDensity <= 3 && isPhraseEnd && off >= 1440) continue;
        const pitch = chooseMelodyPitch(off % 480 === 0, i === steps.length - 1);
        prevPitch = pitch;
        // Calculate grid step toward next hit (240 or 480) and apply ~45% gate time (40..55%)
        const nextOff = i + 1 < steps.length ? steps[i + 1] : TICKS_PER_BAR;
        const stepSpan = Math.min(480, Math.max(120, nextOff - off));
        const staccatoDur = Math.max(55, Math.round(stepSpan * 0.46));
        notes.push({
          pitch,
          velocity: clampVelocity(baseVel + (off % 480 === 0 ? 8 : 0) + rng.nextInt(-3, 4)),
          startTick: barStart + off,
          durationTicks: staccatoDur,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    if (preset === 'melody_alt_soar') {
      const highOctRoot = nearestScalePitch(
        barRoot + 12,
        scalePcs,
        bandMin,
        Math.min(VOCAL_MAX_PITCH, Math.max(bandMax, bandMin + 12))
      );
      const soarSteps =
        vocalDensity === 1
          ? [
              { off: 0, dur: 900, high: false },
              { off: 960, dur: 880, high: true },
            ]
          : vocalDensity === 2
            ? [
                { off: 0, dur: 440, high: false },
                { off: 480, dur: 440, high: false },
                { off: 960, dur: 880, high: true },
              ]
            : vocalDensity === 3
              ? [
                  { off: 0, dur: 420, high: false },
                  { off: 480, dur: 220, high: false },
                  { off: 720, dur: 220, high: true },
                  { off: 960, dur: 840, high: true },
                ]
              : [
                  { off: 0, dur: 220, high: false },
                  { off: 240, dur: 220, high: false },
                  { off: 480, dur: 220, high: true },
                  { off: 720, dur: 220, high: true },
                  { off: 960, dur: 420, high: true },
                  { off: 1440, dur: 400, high: true },
                ];
      for (const slot of soarSteps) {
        const pitch = slot.high
          ? pickClosestFromList(highOctRoot, chordTones.length > 0 ? [...chordTones, highOctRoot] : [highOctRoot])
          : barRoot;
        const safePitch = nearestScalePitch(pitch, scalePcs, VOCAL_MIN_PITCH, VOCAL_MAX_PITCH);
        prevPitch = nearestScalePitch(safePitch, scalePcs, bandMin, bandMax);
        notes.push({
          pitch: safePitch,
          velocity: clampVelocity(baseVel + (slot.high ? 10 : -2) + rng.nextInt(-3, 3)),
          startTick: barStart + slot.off,
          durationTicks: slot.dur,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    if (preset === 'melody_grunge_drag') {
      const dragOffsets =
        vocalDensity === 1
          ? [0, 990]
          : vocalDensity === 2
            ? [0, 510, 990]
            : vocalDensity === 3
              ? [0, 270, 510, 990, 1470]
              : [0, 270, 510, 750, 990, 1230, 1470];
      let walkPitch = nearestScalePitch(
        barRoot + 5,
        scalePcs,
        bandMin,
        bandMax
      );
      for (let i = 0; i < dragOffsets.length; i++) {
        const off = dragOffsets[i];
        const idx = scaleNotes.indexOf(nearestScalePitch(walkPitch, scalePcs, 52, 72));
        const descIdx = Math.max(0, (idx >= 0 ? idx : 4) - (i === 0 ? 0 : 1));
        walkPitch = nearestScalePitch(scaleNotes[descIdx] ?? barRoot, scalePcs, bandMin, bandMax);
        prevPitch = walkPitch;
        const nextOff = i + 1 < dragOffsets.length ? dragOffsets[i + 1] : TICKS_PER_BAR;
        const dur = Math.max(120, Math.min(460, nextOff - off - 20));
        notes.push({
          pitch: walkPitch,
          velocity: clampVelocity(baseVel - 4 + (off === 0 ? 6 : 0) + rng.nextInt(-4, 3)),
          startTick: barStart + off,
          durationTicks: dur,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    if (preset === 'melody_britpop_catchy') {
      const grid = pentGrid.length > 0 ? pentGrid : scaleNotes;
      const hookOffsets =
        vocalDensity === 1
          ? [0, 960]
          : vocalDensity === 2
            ? [0, 480, 960, 1440]
            : vocalDensity === 3
              ? [0, 240, 480, 720, 960, 1200, 1440]
              : vocalDensity === 4
                ? [0, 240, 480, 720, 960, 1080, 1200, 1440, 1680]
                : [0, 120, 240, 480, 600, 720, 960, 1080, 1200, 1440, 1680];
      const baseIdx = Math.max(
        0,
        grid.reduce(
          (bestIdx, p, idx) =>
            Math.abs(p - barRoot) < Math.abs(grid[bestIdx] - barRoot) ? idx : bestIdx,
          0
        )
      );
      const contour = [0, 2, 1, 3, 2, 1, 0, 2, 4, 2, 0];
      for (let i = 0; i < hookOffsets.length; i++) {
        const off = hookOffsets[i];
        const stepOffset = contour[i % contour.length];
        const targetIdx = Math.min(grid.length - 1, baseIdx + stepOffset);
        const pitch = grid[targetIdx] ?? barRoot;
        prevPitch = pitch;
        notes.push({
          pitch,
          velocity: clampVelocity(baseVel + (off % 480 === 0 ? 6 : 0) + rng.nextInt(-3, 3)),
          startTick: barStart + off,
          durationTicks: vocalDensity <= 2 ? 380 : 200,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    if (preset === 'melody_metalcore_chorus') {
      const chorusSlots =
        vocalDensity === 1
          ? [
              { off: 0, dur: 900, high: false },
              { off: 960, dur: 880, high: true },
            ]
          : vocalDensity === 2
            ? [
                { off: 0, dur: 680, high: false },
                { off: 720, dur: 220, high: true },
                { off: 960, dur: 880, high: true },
              ]
            : vocalDensity === 3
              ? [
                  { off: 0, dur: 660, high: false },
                  { off: 720, dur: 220, high: false },
                  { off: 960, dur: 660, high: true },
                  { off: 1680, dur: 220, high: true },
                ]
              : [
                  { off: 0, dur: 420, high: false },
                  { off: 480, dur: 220, high: false },
                  { off: 720, dur: 220, high: true },
                  { off: 960, dur: 420, high: true },
                  { off: 1440, dur: 220, high: true },
                  { off: 1680, dur: 220, high: true },
                ];
      const peakFloor = Math.min(bandMax, Math.max(bandMin + 4, bandMax - 3));
      const highChordTones = chordTones.filter((p) => p >= peakFloor);
      const topTone =
        highChordTones[highChordTones.length - 1] ??
        nearestScalePitch(bandMax, scalePcs, bandMin, bandMax);
      for (let i = 0; i < chorusSlots.length; i++) {
        const slot = chorusSlots[i];
        const pitch = slot.high ? topTone : barRoot;
        prevPitch = pitch;
        notes.push({
          pitch,
          velocity: clampVelocity(baseVel + (slot.high ? 12 : 4)),
          startTick: barStart + slot.off,
          durationTicks: slot.dur,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    if (preset === 'melody_emo_screamo') {
      const isShoutBar = bar % 2 === 1;
      if (!isShoutBar) {
        const quietOffs =
          vocalDensity <= 2 ? [0, 960] : [0, 480, 960, 1440];
        for (const off of quietOffs) {
          const pitch = nearestScalePitch(
            Math.min(bandMin + 4, barRoot),
            scalePcs,
            bandMin,
            bandMax
          );
          prevPitch = pitch;
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel - 18 + rng.nextInt(-3, 3)),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 760 : 380,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else {
        const shoutOffs =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960, 1440]
              : vocalDensity === 3
                ? [0, 240, 480, 720, 960, 1200, 1440]
                : [0, 120, 240, 360, 480, 720, 840, 960, 1200, 1440, 1680];
        const highCeil = Math.min(VOCAL_MAX_PITCH, bandMax + 2);
        const shoutPitchA = nearestScalePitch(highCeil - 2, scalePcs, bandMin, highCeil);
        const shoutPitchB = nearestScalePitch(highCeil, scalePcs, bandMin, highCeil);
        for (let i = 0; i < shoutOffs.length; i++) {
          const off = shoutOffs[i];
          const pitch = i % 3 === 1 ? shoutPitchB : shoutPitchA;
          prevPitch = nearestScalePitch(pitch, scalePcs, bandMin, bandMax);
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel + 16 + rng.nextInt(-2, 4)),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 380 : 170,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      }
      continue;
    }

    // 4. melody_ballad OR low density (1..2) auto/long sustained phrasing
    if (
      preset === 'melody_ballad' ||
      (preset === 'auto' && section.energy === 'Low') ||
      vocalDensity <= 2
    ) {
      const slots =
        vocalDensity === 1
          ? [{ off: 0, dur: isPhraseEnd ? 1820 : 1400 }]
          : vocalDensity === 2
            ? [
                { off: 0, dur: 900 },
                { off: 960, dur: isPhraseEnd ? 840 : 900 },
              ]
            : style === 'C'
              ? [
                  { off: 0, dur: 900 },
                  { off: 960, dur: 440 },
                  { off: 1440, dur: 420 },
                ]
              : [
                  { off: 0, dur: 920 },
                  { off: 960, dur: isPhraseEnd ? 760 : 880 },
                ];
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const pitch =
          i === 0
            ? barRoot
            : pickClosestFromList(prevPitch, chordTones);
        prevPitch = nearestScalePitch(pitch, scalePcs, bandMin, bandMax);
        notes.push({
          pitch: prevPitch,
          velocity: clampVelocity(baseVel - 4 + rng.nextInt(-4, 4)),
          startTick: barStart + slot.off,
          durationTicks: slot.dur,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    // 5. melody_alt_minor: Low-centered minor pentatonic strictly inside Key/Scale
    if (preset === 'melody_alt_minor') {
      const grid = pentGrid.length > 0 ? pentGrid : scaleNotes;
      const offs =
        vocalDensity >= 4
          ? [0, 120, 240, 480, 720, 840, 960, 1200, 1440, 1560]
          : style === 'B'
            ? [0, 480, 720, 960, 1440]
            : style === 'C'
              ? [0, 240, 480, 720, 960, 1200, 1440]
              : [0, 240, 720, 960, 1440];
      for (let i = 0; i < offs.length; i++) {
        const off = offs[i];
        if (vocalDensity <= 3 && isPhraseEnd && off >= 1440) continue;
        const nearestIdx = grid.reduce(
          (bestIdx, p, idx) =>
            Math.abs(p - prevPitch) < Math.abs(grid[bestIdx] - prevPitch)
              ? idx
              : bestIdx,
          0
        );
        const delta =
          i === 0
            ? rng.pick([0, 1])
            : isPhraseEnd && i === offs.length - 2
              ? -1
              : rng.pick([-1, 0, 1, 2]);
        const nextIdx = Math.min(
          grid.length - 1,
          Math.max(0, nearestIdx + delta)
        );
        const pitch = nearestScalePitch(
          grid[nextIdx] ?? prevPitch,
          scalePcs,
          bandMin,
          bandMax
        );
        prevPitch = pitch;
        notes.push({
          pitch,
          velocity: clampVelocity(
            baseVel + (off % 960 === 0 ? 5 : -4) + rng.nextInt(-4, 4)
          ),
          startTick: barStart + off,
          durationTicks:
            vocalDensity >= 4
              ? 110
              : isPhraseEnd && i === offs.length - 2
                ? 420
                : 220,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    // 6. melody_syncopated_hook: Anticipating beats with syncopated 8th/16th hooks
    if (preset === 'melody_syncopated_hook') {
      const syncSteps =
        vocalDensity >= 4
          ? [0, 120, 360, 600, 840, 960, 1200, 1320, 1560, 1800]
          : style === 'B'
            ? [0, 360, 840, 1320, 1560]
            : style === 'C'
              ? [0, 240, 360, 720, 840, 1200, 1560, 1800]
              : [0, 360, 720, 1200, 1560];
      for (let i = 0; i < syncSteps.length; i++) {
        const off = syncSteps[i];
        if (vocalDensity <= 3 && isPhraseEnd && off >= 1680) continue;
        const pitch = chooseMelodyPitch(
          off === 0 || off === 360 || off === 840,
          i === syncSteps.length - 1
        );
        prevPitch = pitch;
        notes.push({
          pitch,
          velocity: clampVelocity(
            baseVel + (off % 480 === 360 ? 7 : 0) + rng.nextInt(-3, 4)
          ),
          startTick: barStart + off,
          durationTicks: vocalDensity >= 4 ? 110 : 210,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    // 7. Default melody_pop / auto / melody_soar_long bars 0 & 2 / melody_call_response call bars
    const baseSteps =
      vocalDensity === 4
        ? [0, 240, 360, 480, 720, 960, 1080, 1200, 1440, 1680]
        : vocalDensity === 5
          ? [0, 120, 240, 360, 480, 600, 720, 840, 960, 1200, 1320, 1440, 1680]
          : style === 'B'
            ? [0, 480, 720, 960, 1200, 1440]
            : style === 'C'
              ? [0, 240, 480, 720, 960, 1200, 1440, 1680]
              : [0, 240, 480, 960, 1200, 1440];

    for (let i = 0; i < baseSteps.length; i++) {
      const off = baseSteps[i];
      if (vocalDensity <= 3 && isPhraseEnd && off >= 1440) continue;
      if (vocalDensity <= 3 && i > 0 && rng.chance(0.14)) continue;

      const pitch = chooseMelodyPitch(
        off === 0 || off === 960,
        i === baseSteps.length - 1 || (isPhraseEnd && off >= 1200)
      );
      prevPitch = pitch;

      const dur =
        vocalDensity >= 4
          ? 110
          : i === baseSteps.length - 1 || (isPhraseEnd && off >= 1200)
            ? 420
            : 215;
      notes.push({
        pitch,
        velocity: clampVelocity(
          baseVel + (off % 960 === 0 ? 6 : -2) + rng.nextInt(-4, 4)
        ),
        startTick: barStart + off,
        durationTicks: dur,
        channel: TRACK_CHANNELS.vocal,
      });
    }
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
