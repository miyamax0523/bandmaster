import {
  TICKS_PER_BAR,
  TRACK_CHANNELS,
  type KeyName,
  type MidiNote,
  type ScaleType,
  type VocalHarmonyMode,
} from '../types/song';
import { getActiveChordAtTick } from '../lib/chordTimeline';
import {
  fitPitchClassToRange,
  getScalePitchClasses,
  noteNameToSemitone,
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

/**
 * Stage 2 helper: separates diatonic stable chord tones (Root/3rd/5th)
 * from open "question" guide tones (3rd/5th/7th/9th) strictly inside Key/Scale.
 */
function getDiatonicGuideToneBuckets(
  chord: ParsedChord,
  scalePcs: ReadonlySet<number>,
  minP: number,
  maxP: number
): { stableTones: number[]; questionTones: number[] } {
  const stablePcs = new Set<number>();
  const questionPcs = new Set<number>();

  // Root, 3rd, 5th inside chord intervals & scale
  for (let i = 0; i < chord.intervals.length; i++) {
    const iv = chord.intervals[i];
    const pc = (chord.rootSemitone + iv) % 12;
    if (!scalePcs.has(pc)) continue;
    stablePcs.add(pc);
    if (iv !== 0) {
      questionPcs.add(pc);
    }
  }
  // Diatonic 7th & 9th guide/color extensions
  for (const ext of [10, 11, 14]) {
    const pc = (chord.rootSemitone + ext) % 12;
    if (scalePcs.has(pc)) {
      questionPcs.add(pc);
    }
  }

  const stableTones: number[] = [];
  const questionTones: number[] = [];
  for (let p = minP; p <= maxP; p++) {
    const pc = p % 12;
    if (stablePcs.has(pc)) stableTones.push(p);
    if (questionPcs.has(pc)) questionTones.push(p);
  }

  const fallback = buildScaleGrid(scalePcs, minP, maxP);
  const safeFallback =
    fallback.length > 0 ? fallback : [nearestScalePitch(60, scalePcs, 48, 76)];
  return {
    stableTones: stableTones.length > 0 ? stableTones : safeFallback,
    questionTones: questionTones.length > 0 ? questionTones : stableTones.length > 0 ? stableTones : safeFallback,
  };
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
  const preset =
    section.patternPresets?.vocal ??
    section.partPresets?.vocal ??
    member.patternPreset ??
    'auto';
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

  // Draw 5 Performance Variants from seeded RNG so every 🎲 re-roll creates fresh phrasing
  type ArticulationStyle =
    | 'staccato_chop'
    | 'dramatic_hold'
    | 'contrast_stop'
    | 'flowing_legato';
  type ContourShape =
    | 'arch'
    | 'ascending_launch'
    | 'descending_cascade'
    | 'wave_pendulum';
  type EntryTiming = 'on_beat' | 'auftakt_pickup' | 'syncopated_after';
  type HookDevice = 'octave_leap' | 'machinegun_repeat' | 'call_response_drop';
  type RapFlowVariant =
    | 'rapid_then_freeze'
    | 'laidback_triplet'
    | 'melodic_hook_tail'
    | 'sparse_punchline';

  const articulationStyle: ArticulationStyle =
    preset === 'melody_staccato_chop' || preset === 'melody_staccato_rock'
      ? 'staccato_chop'
      : preset === 'melody_shoegaze_float' ||
          preset === 'melody_soar_long' ||
          preset === 'melody_ballad_breath' ||
          preset === 'melody_ballad'
        ? 'dramatic_hold'
        : rng.pick([
            'dramatic_hold',
            'contrast_stop',
            'flowing_legato',
            'staccato_chop',
          ]);

  const contourShape: ContourShape =
    preset === 'melody_anthem_climb'
      ? 'ascending_launch'
      : preset === 'melody_grunge_drag'
        ? 'descending_cascade'
        : rng.pick([
            'arch',
            'ascending_launch',
            'descending_cascade',
            'wave_pendulum',
          ]);

  const entryTiming: EntryTiming =
    preset === 'melody_staccato_chop' || preset === 'melody_syncopated_hook'
      ? 'syncopated_after'
      : preset === 'melody_ballad' || preset === 'melody_soar_long'
        ? 'on_beat'
        : rng.pick(['on_beat', 'auftakt_pickup', 'syncopated_after']);

  const hookDevice: HookDevice = rng.pick([
    'octave_leap',
    'machinegun_repeat',
    'call_response_drop',
  ]);

  const rapFlowVariant: RapFlowVariant =
    preset === 'rap_stop_and_go'
      ? 'rapid_then_freeze'
      : preset === 'rap_triplet_bounce'
        ? 'laidback_triplet'
        : preset === 'rap_spoken_tension'
          ? 'melodic_hook_tail'
          : rng.pick([
              'rapid_then_freeze',
              'laidback_triplet',
              'melodic_hook_tail',
              'sparse_punchline',
            ]);

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
        // Sustained melodic sing tail starting at beat 3 using diatonic guide tones
        const barChord = getActiveChordAtTick(
          section.chords,
          barStart + 960,
          song.key,
          song.scale,
          section.bars
        ).parsed;
        const { stableTones, questionTones } = getDiatonicGuideToneBuckets(
          barChord,
          scalePcs,
          bandMin,
          bandMax
        );
        const singCandidates = isPhraseEndBar ? stableTones : questionTones;
        const singPitch = pickClosestFromList(
          bar % 2 === 1 ? rapFifth : rapThird,
          singCandidates
        );
        const singVel = clampVelocity(
          bar % 2 === 1 ? Math.min(110, baseVel + 8) : Math.max(78, baseVel - 4)
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
      } else if (preset === 'rap_stop_and_go') {
        // 16th machine-gun bursts followed by complete silent freeze break
        const burstSteps =
          vocalDensity === 1
            ? [0, 240]
            : vocalDensity === 2
              ? [0, 120, 240, 480]
              : vocalDensity === 3
                ? [0, 120, 240, 360, 480, 600, 720, 840]
                : [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080];
        for (let i = 0; i < burstSteps.length; i++) {
          const off = burstSteps[i];
          notes.push({
            pitch: i === burstSteps.length - 1 ? rapThird : i % 3 === 1 ? rapSecond : rapAnchor,
            velocity: clampVelocity(baseVel + (i === burstSteps.length - 1 ? 10 : 4)),
            startTick: barStart + off,
            durationTicks: 85,
            channel: TRACK_CHANNELS.vocal,
          });
        }
        // Leaves 960..1920 (or 1200..1920 at dense) as sudden freeze silence!
      } else if (preset === 'rap_triplet_bounce') {
        const tripSteps =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 320, 960, 1280]
              : vocalDensity === 3
                ? [0, 160, 320, 480, 800, 960, 1120, 1440]
                : [0, 160, 320, 480, 640, 800, 960, 1120, 1280, 1440, 1600, 1760];
        for (let i = 0; i < tripSteps.length; i++) {
          const off = tripSteps[i];
          const pitch =
            off === 800 || off === 1600
              ? rapThird
              : i % 3 === 1
                ? rapSecond
                : rapAnchor;
          notes.push({
            pitch,
            velocity: clampVelocity(baseVel + (off % 480 === 0 ? 8 : -2) + rng.nextInt(-3, 3)),
            startTick: barStart + off,
            durationTicks: vocalDensity <= 2 ? 220 : 125,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else if (preset === 'rap_spoken_tension') {
        const spokenSteps =
          vocalDensity === 1
            ? [0, 1440]
            : vocalDensity === 2
              ? [0, 480, 1440]
              : vocalDensity === 3
                ? [0, 240, 480, 720, 960, 1440]
                : [0, 120, 240, 480, 600, 720, 960, 1080, 1440, 1680];
        for (let i = 0; i < spokenSteps.length; i++) {
          const off = spokenSteps[i];
          const isBarEndLift = off >= 1440;
          const pitch = isBarEndLift ? rapFifth : i % 2 === 1 ? rapBelow : rapTwoBelow;
          notes.push({
            pitch,
            velocity: clampVelocity(isBarEndLift ? baseVel + 12 : baseVel - 10),
            startTick: barStart + off,
            durationTicks: isBarEndLift ? 360 : 170,
            channel: TRACK_CHANNELS.vocal,
          });
        }
      } else {
        // rap_monotone_chant & flow variant influence
        const baseChant =
          vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960]
              : vocalDensity >= 4
                ? [0, 120, 240, 480, 720, 960, 1200, 1320, 1440, 1680]
                : rapFlowVariant === 'sparse_punchline'
                  ? [480, 960, 1200, 1440]
                  : style === 'C'
                    ? [0, 240, 480, 840, 960, 1200, 1440]
                    : style === 'B'
                      ? [0, 480, 960, 1200, 1440]
                      : [0, 240, 480, 960, 1200];
        for (let i = 0; i < baseChant.length; i++) {
          const off = baseChant[i];
          if (vocalDensity <= 3 && isPhraseEndBar && i === baseChant.length - 1 && rng.chance(0.45)) {
            continue;
          }
          const isTail = isPhraseEndBar && i === baseChant.length - 1;
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

  // =========================================================================
  // 3-Stage Melodic Soul Pipeline (100% Key/Scale + Monophonic + Motif A->A')
  // =========================================================================
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
      return clampVelocity(Math.round(73 + ratio * 11)); // 73..84 soft tail release before breath
    }
    if (isPeak) {
      return clampVelocity(Math.round(96 + ratio * 16)); // 96..112 emotional climax peak
    }
    return clampVelocity(Math.round(86 + ratio * 20)); // 86..106 expressive stepwise phrase
  };

  const initialAnchor = fitPitchClassToRange(
    keySemitone,
    bandMin,
    Math.min(bandMin + 7, bandMax)
  );
  let prevPitch = nearestScalePitch(initialAnchor, scalePcs, bandMin, bandMax);

  // Special mode: jrock_anticipation keeps beat 4-and (1680) barline anticipation across all 5 parts
  if (preset === 'jrock_anticipation') {
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * TICKS_PER_BAR;
      const chord = getActiveChordAtTick(
        section.chords,
        barStart,
        song.key,
        song.scale,
        section.bars
      ).parsed;
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
        const nextChord = getActiveChordAtTick(
          section.chords,
          Math.min(sectionEnd - 1, barStart + TICKS_PER_BAR),
          song.key,
          song.scale,
          section.bars
        ).parsed;
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

  // Stage 1 Types: 2-Bar Rhythm Motif Skeleton
  type RhythmRole = 'word' | 'peak' | 'tail';
  interface RhythmSlot {
    localTick: number; // 0 .. (blockBars * TICKS_PER_BAR - 1)
    durationTicks: number;
    role: RhythmRole;
  }

  const usesAuftakt =
    preset === 'melody_syncopated_hook' ||
    preset === 'melody_britpop_catchy' ||
    preset === 'melody_alt_soar' ||
    entryTiming === 'auftakt_pickup' ||
    entryTiming === 'syncopated_after';

  const isStaccatoPreset =
    preset === 'melody_staccato_rock' || preset === 'melody_staccato_chop';
  const isLongHoldPreset =
    preset === 'melody_shoegaze_float' ||
    preset === 'melody_soar_long' ||
    preset === 'melody_ballad_breath' ||
    preset === 'melody_anthem_climb';

  const buildPhraseRhythmSkeleton = (
    blockBars: number,
    isAPrime: boolean,
    motifASkeleton: RhythmSlot[] | null
  ): RhythmSlot[] => {
    // 1-bar single-section fallback
    if (blockBars === 1) {
      if (preset === 'melody_soar_long' || preset === 'melody_shoegaze_float') {
        return [{ localTick: 0, durationTicks: 1440, role: 'tail' }];
      }
      if (isStaccatoPreset) {
        const offs = vocalDensity === 1 ? [0, 960] : [0, 240, 480, 960];
        return offs.map((t, idx) => ({
          localTick: t,
          durationTicks: idx === offs.length - 1 ? 180 : 110,
          role: idx === 1 ? 'peak' : idx === offs.length - 1 ? 'tail' : 'word',
        }));
      }
      if (vocalDensity === 1) {
        return [{ localTick: 0, durationTicks: 1440, role: 'tail' }];
      }
      if (vocalDensity === 2) {
        return [
          { localTick: 0, durationTicks: 420, role: 'word' },
          { localTick: 480, durationTicks: 1080, role: 'tail' },
        ];
      }
      return [
        { localTick: usesAuftakt ? 240 : 0, durationTicks: 210, role: 'word' },
        { localTick: 480, durationTicks: 210, role: 'peak' },
        { localTick: 720, durationTicks: 960, role: 'tail' },
      ];
    }

    // Standard 2-bar (Phrase A or Phrase A') rhythm skeleton (0..3840 ticks)
    // Always preserve >= 240..480 ticks of human breath rest at phrase end (ending by tick 3360..3480)
    if (isAPrime && motifASkeleton && motifASkeleton.length > 0) {
      // Inherit 75..85%+ of Phrase A's front & peak rhythm verbatim, slightly adapting tail if density allows
      const inherited: RhythmSlot[] = motifASkeleton.map((s) => ({ ...s }));
      if (
        preset !== 'melody_soar_long' &&
        !isStaccatoPreset &&
        vocalDensity >= 3 &&
        inherited.length >= 4
      ) {
        const lastIdx = inherited.length - 1;
        if (inherited[lastIdx].role === 'tail' && inherited[lastIdx].localTick === TICKS_PER_BAR + 480) {
          inherited[lastIdx] = {
            localTick: TICKS_PER_BAR + 480,
            durationTicks: preset === 'melody_shoegaze_float' ? 1200 : 1080,
            role: 'tail',
          };
        }
      }
      return inherited;
    }

    // Phrase A ("Question") Construction
    const slots: RhythmSlot[] = [];

    if (isStaccatoPreset) {
      const bar0 =
        vocalDensity === 1
          ? [0, 960]
          : vocalDensity === 2
            ? [0, 480, 960]
            : preset === 'melody_staccato_chop'
              ? vocalDensity >= 4
                ? [240, 360, 720, 840, 1200, 1440, 1680]
                : [240, 720, 960, 1200, 1680]
              : vocalDensity >= 4
                ? [0, 240, 480, 600, 720, 960, 1200, 1440]
                : [0, 240, 480, 960, 1200, 1440];
      const bar1 =
        vocalDensity === 1
          ? [0, 960]
          : vocalDensity === 2
            ? [0, 480, 960]
            : preset === 'melody_staccato_chop'
              ? [0, 240, 720, 1200]
              : [0, 240, 480, 960, 1200];
      for (let i = 0; i < bar0.length; i++) {
        const nextT = i + 1 < bar0.length ? bar0[i + 1] : TICKS_PER_BAR;
        slots.push({
          localTick: bar0[i],
          durationTicks: Math.max(55, Math.min(200, Math.round((nextT - bar0[i]) * 0.45))),
          role: 'word',
        });
      }
      for (let i = 0; i < bar1.length; i++) {
        const nextT = i + 1 < bar1.length ? bar1[i + 1] : 1440;
        slots.push({
          localTick: TICKS_PER_BAR + bar1[i],
          durationTicks: Math.max(55, Math.min(200, Math.round((nextT - bar1[i]) * 0.45))),
          role: i === 0 ? 'peak' : i === bar1.length - 1 ? 'tail' : 'word',
        });
      }
      return slots;
    }

    if (preset === 'melody_soar_long' || preset === 'melody_shoegaze_float') {
      const frontOffs =
        preset === 'melody_shoegaze_float'
          ? vocalDensity <= 2
            ? [0]
            : [0, 960]
          : vocalDensity === 1
            ? [0, 960]
            : vocalDensity === 2
              ? [0, 480, 960, 1440]
              : vocalDensity === 3
                ? [0, 240, 480, 960, 1200, 1680]
                : vocalDensity === 4
                  ? [0, 240, 360, 480, 720, 960, 1200, 1440, 1680]
                  : [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200, 1440, 1680];
      for (let i = 0; i < frontOffs.length; i++) {
        const t = frontOffs[i];
        const nextT = i + 1 < frontOffs.length ? frontOffs[i + 1] : TICKS_PER_BAR;
        const durCap =
          preset === 'melody_shoegaze_float'
            ? 1400
            : vocalDensity === 1
              ? 880
              : vocalDensity >= 4
                ? 190
                : 380;
        slots.push({
          localTick: t,
          durationTicks: Math.min(durCap, Math.max(100, nextT - t - 20)),
          role: 'word',
        });
      }
      // Bar 1 sustained >= 1440 long tone + 480-tick breath rest
      slots.push({
        localTick: TICKS_PER_BAR,
        durationTicks: 1440,
        role: 'peak',
      });
      return slots;
    }

    // Standard 2-bar Melodic Soul skeleton driven by Performance Variants + Vocal Density
    if (vocalDensity === 1 || preset === 'melody_ballad_breath') {
      return [
        { localTick: 0, durationTicks: 960, role: 'word' },
        { localTick: TICKS_PER_BAR, durationTicks: 1440, role: 'peak' }, // sustained 1440 + 480 breath rest
      ];
    }

    if (vocalDensity === 2) {
      return [
        { localTick: 0, durationTicks: 420, role: 'word' },
        { localTick: 480, durationTicks: 420, role: 'word' },
        { localTick: 960, durationTicks: 420, role: 'word' },
        { localTick: 1440, durationTicks: 400, role: 'word' },
        { localTick: TICKS_PER_BAR, durationTicks: 440, role: 'peak' },
        { localTick: TICKS_PER_BAR + 480, durationTicks: 1080, role: 'tail' }, // 360 breath rest
      ];
    }

    // vocalDensity 3..5: Shaped cleanly by entryTiming & articulationStyle
    let frontBar0: number[];
    if (vocalDensity >= 5) {
      frontBar0 = [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200, 1320, 1440, 1680];
    } else if (vocalDensity === 4) {
      frontBar0 =
        preset === 'melody_syncopated_hook'
          ? [0, 120, 360, 600, 840, 960, 1200, 1560]
          : entryTiming === 'syncopated_after'
            ? [240, 360, 720, 840, 1200, 1440, 1680]
            : [240, 360, 480, 720, 960, 1200, 1440, 1680];
    } else {
      // vocalDensity === 3
      if (preset === 'melody_syncopated_hook') {
        frontBar0 = [0, 360, 720, 1200, 1560];
      } else if (preset === 'melody_grunge_drag') {
        frontBar0 = [0, 270, 510, 990, 1470];
      } else if (preset === 'melody_ballad' || preset === 'melody_emo_screamo') {
        frontBar0 = [0, 480, 960, 1440];
      } else if (articulationStyle === 'contrast_stop') {
        // Pack 4 fast 16th/8th syllables in beat 1..2, then stop suddenly for 480-tick break!
        frontBar0 = [0, 120, 240, 480, 1200, 1440, 1680];
      } else if (entryTiming === 'syncopated_after') {
        frontBar0 = [240, 480, 720, 1200, 1560];
      } else if (usesAuftakt) {
        frontBar0 = [240, 480, 720, 1200, 1440, 1680];
      } else {
        frontBar0 = [0, 240, 480, 960, 1200, 1680];
      }
    }

    for (let i = 0; i < frontBar0.length; i++) {
      const t = frontBar0[i];
      const nextT = i + 1 < frontBar0.length ? frontBar0[i + 1] : TICKS_PER_BAR;
      const gap = nextT - t;
      let dur: number;
      if (articulationStyle === 'staccato_chop' && vocalDensity <= 4) {
        dur = Math.max(70, Math.min(180, Math.round(gap * 0.52)));
      } else if (articulationStyle === 'flowing_legato' && vocalDensity <= 4) {
        dur = Math.max(100, Math.min(440, gap - 8));
      } else {
        const maxDur = vocalDensity >= 5 ? 110 : vocalDensity === 4 ? 190 : 380;
        dur = Math.max(90, Math.min(maxDur, gap - 15));
      }
      slots.push({
        localTick: t,
        durationTicks: dur,
        role: 'word',
      });
    }

    // Bar 1: climax leap pickup (peak -> gap-fill descent) + >= 960 sustained landing + 360 breath rest
    const bar1Pickups =
      vocalDensity >= 4
        ? [0, 120, 240, 360]
        : preset === 'melody_syncopated_hook'
          ? [0, 360]
          : isLongHoldPreset
            ? [0]
            : [0, 240];
    for (let i = 0; i < bar1Pickups.length; i++) {
      const t = bar1Pickups[i];
      const nextT = i + 1 < bar1Pickups.length ? bar1Pickups[i + 1] : 480;
      const dur =
        vocalDensity >= 4
          ? Math.min(110, nextT - t - 10)
          : articulationStyle === 'staccato_chop'
            ? Math.max(90, Math.round((nextT - t) * 0.6))
            : Math.max(100, nextT - t - 20);
      slots.push({
        localTick: TICKS_PER_BAR + t,
        durationTicks: dur,
        role: i === 0 ? 'peak' : 'word',
      });
    }

    slots.push({
      localTick: TICKS_PER_BAR + 480,
      durationTicks: 1080, // >= 960 sustained long tone; ends at 3480, leaving 360-tick breath rest
      role: 'tail',
    });

    return slots;
  };

  // Stage 2 & Stage 3 Execution Loop (2-bar blocks across section)
  let motifASkeleton: RhythmSlot[] | null = null;
  let motifARelativeContour: number[] | null = null;
  let currIdx = findGridIdx(prevPitch);
  let lastWasBigUpLeap = false;

  for (let blockStartBar = 0; blockStartBar < section.bars; blockStartBar += 2) {
    const phraseIndex = Math.floor(blockStartBar / 2);
    const blockBars = Math.min(2, section.bars - blockStartBar);
    const isAPrime = phraseIndex % 2 === 1;

    // Preserve Call & Response 4-bar resting structure (bars 2 & 3 respond gently / rest)
    if (preset === 'melody_call_response' && isAPrime) {
      if (vocalDensity >= 3) {
        const echoChord = getActiveChordAtTick(
          section.chords,
          blockStartBar * TICKS_PER_BAR,
          song.key,
          song.scale,
          section.bars
        ).parsed;
        const { stableTones } = getDiatonicGuideToneBuckets(
          echoChord,
          scalePcs,
          bandMin,
          bandMax
        );
        const echoPitch = pickClosestFromList(soulGrid[currIdx], stableTones);
        currIdx = findGridIdx(echoPitch);
        lastWasBigUpLeap = false;
        notes.push({
          pitch: echoPitch,
          velocity: velocityArc(currIdx, false, true),
          startTick: blockStartBar * TICKS_PER_BAR,
          durationTicks: 480,
          channel: TRACK_CHANNELS.vocal,
        });
      }
      continue;
    }

    // STAGE 1: Generate/inherit rhythm skeleton
    const skeleton = buildPhraseRhythmSkeleton(blockBars, isAPrime, motifASkeleton);

    // STAGE 2: Guide-tone anchor selection per timeline chord in this block
    const frontChord = getActiveChordAtTick(
      section.chords,
      blockStartBar * TICKS_PER_BAR,
      song.key,
      song.scale,
      section.bars
    ).parsed;
    const tailChord = getActiveChordAtTick(
      section.chords,
      Math.min(sectionEnd - 1, (blockStartBar + blockBars - 1) * TICKS_PER_BAR + 960),
      song.key,
      song.scale,
      section.bars
    ).parsed;
    const frontBuckets = getDiatonicGuideToneBuckets(frontChord, scalePcs, bandMin, bandMax);
    const tailBuckets = getDiatonicGuideToneBuckets(tailChord, scalePcs, bandMin, bandMax);

    // Phrase start anchor: voice-lead to front chord's guide tones within smooth step reach
    const startTargetPitch = pickClosestFromList(
      blockStartBar === 0 ? initialAnchor : soulGrid[currIdx],
      frontBuckets.questionTones.length > 0 ? frontBuckets.questionTones : frontBuckets.stableTones
    );
    const rawStartIdx = findGridIdx(startTargetPitch);
    const shoegazeMinIdx = Math.max(0, soulGrid.length - 3);
    if (preset === 'melody_shoegaze_float') {
      currIdx = Math.max(shoegazeMinIdx, Math.min(soulGrid.length - 1, Math.max(rawStartIdx, shoegazeMinIdx)));
    } else if (blockStartBar === 0) {
      currIdx =
        preset === 'melody_grunge_drag' || contourShape === 'descending_cascade'
          ? Math.min(Math.max(0, soulGrid.length - 4), rawStartIdx + 2)
          : contourShape === 'ascending_launch'
            ? Math.max(0, Math.min(soulGrid.length - 5, rawStartIdx - 1))
            : Math.min(Math.max(0, soulGrid.length - 4), rawStartIdx);
    } else if (lastWasBigUpLeap) {
      // Gap-fill continuation across bar boundary
      currIdx = Math.max(0, currIdx - 1);
      lastWasBigUpLeap = false;
    } else if (hookDevice === 'call_response_drop' && isAPrime) {
      // Smooth 2-step drop into lower responsive register for Phrase A'
      currIdx = Math.max(0, currIdx - 2);
    } else {
      const startDiff = Math.max(-2, Math.min(2, rawStartIdx - currIdx));
      currIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + startDiff));
    }

    // Phrase landing anchor: Phrase A -> Question (3rd/5th/7th/9th), Phrase A' -> Stable Answer (Root/3rd/5th)
    const endPool = isAPrime ? tailBuckets.stableTones : tailBuckets.questionTones;
    const endAnchorPitch = pickClosestFromList(
      soulGrid[Math.min(soulGrid.length - 1, currIdx + (isAPrime ? 0 : 1))],
      endPool
    );
    const endAnchorIdx = findGridIdx(endAnchorPitch);

    // STAGE 3: Stepwise + Lyric Repetition + 1-Point Climax Leap + Gap-Fill
    const leapMagnitude =
      hookDevice === 'octave_leap'
        ? Math.min(6, Math.max(4, soulGrid.length - 2))
        : preset === 'melody_alt_soar' ||
            preset === 'melody_metalcore_chorus' ||
            preset === 'melody_emo_screamo' ||
            preset === 'melody_anthem_climb'
          ? isAPrime
            ? 5
            : 4
          : isAPrime
            ? 4
            : 3;

    const blockBaseTick = blockStartBar * TICKS_PER_BAR;
    const wordContourForMotif: number[] = [];

    for (let i = 0; i < skeleton.length; i++) {
      const slot = skeleton[i];
      let nextIdx = currIdx;

      if (preset === 'melody_shoegaze_float') {
        const floatStep = slot.role === 'peak' ? 1 : i % 2 === 0 ? 1 : -1;
        nextIdx = Math.max(shoegazeMinIdx, Math.min(soulGrid.length - 1, currIdx + floatStep));
        lastWasBigUpLeap = false;
      } else if (i === 0 && slot.role !== 'peak') {
        nextIdx = currIdx;
        lastWasBigUpLeap = false;
      } else if (slot.role === 'peak') {
        const roomCeiling = soulGrid.length - 1;
        const maxPrePeak = Math.max(0, roomCeiling - 3);
        const baseForLeap = Math.min(currIdx, maxPrePeak);
        const minValidLeap = Math.min(roomCeiling - baseForLeap, 3);
        const chosenLeap = Math.max(minValidLeap, Math.min(leapMagnitude, roomCeiling - baseForLeap));
        nextIdx = Math.min(roomCeiling, baseForLeap + chosenLeap);
        lastWasBigUpLeap = nextIdx - currIdx >= 3;
      } else if (lastWasBigUpLeap) {
        // Strict Gap-Fill principle: immediately after an upward leap, step DOWN (-1..-2 scale steps)
        const desiredStepDown =
          slot.role === 'tail' && Math.abs(endAnchorIdx - currIdx) <= 2 && endAnchorIdx < currIdx
            ? endAnchorIdx - currIdx
            : -1;
        nextIdx = Math.max(0, currIdx + Math.min(-1, desiredStepDown));
        lastWasBigUpLeap = false;
      } else if (slot.role === 'tail') {
        const toEnd = endAnchorIdx - currIdx;
        const clampedToEnd = Math.max(-2, Math.min(2, toEnd));
        nextIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + clampedToEnd));
      } else {
        const prePeakIdx = skeleton.findIndex((s) => s.role === 'peak');
        const beforePeak = prePeakIdx === -1 || i < prePeakIdx;
        const prePeakCap = Math.max(1, soulGrid.length - 4);

        let delta: number;
        if (
          isAPrime &&
          motifARelativeContour &&
          i < motifARelativeContour.length
        ) {
          delta = motifARelativeContour[i];
        } else if (hookDevice === 'machinegun_repeat' && i <= 3) {
          delta = 0; // Rapid syllable lyric repeat before moving
        } else if (contourShape === 'descending_cascade' || preset === 'melody_grunge_drag') {
          delta = i % 3 === 0 ? 0 : -1;
        } else if (contourShape === 'ascending_launch') {
          delta = i % 2 === 0 ? 1 : 0;
        } else if (contourShape === 'wave_pendulum') {
          delta = i % 2 === 1 ? 1 : -1;
        } else if (preset === 'melody_emo_screamo') {
          delta = i % 2 === 0 ? 0 : 1;
        } else if (i % 4 === 1) {
          delta = 0;
        } else if (beforePeak && currIdx >= prePeakCap) {
          delta = -1;
        } else {
          delta = rng.pick([1, 0, 1, -1, 2]);
        }

        delta = Math.max(-2, Math.min(2, delta));
        if (beforePeak && currIdx + delta > prePeakCap && delta > 0) {
          delta = 0;
        }
        nextIdx = Math.max(0, Math.min(soulGrid.length - 1, currIdx + delta));
        wordContourForMotif.push(nextIdx - currIdx);
      }

      currIdx = nextIdx;
      const pitch = soulGrid[currIdx];
      prevPitch = pitch;

      const isBreathTail =
        slot.role === 'tail' ||
        i === skeleton.length - 1 ||
        (preset === 'melody_emo_screamo' && slot.localTick < TICKS_PER_BAR);

      notes.push({
        pitch,
        velocity: velocityArc(
          currIdx,
          slot.role === 'peak',
          isBreathTail && slot.role !== 'peak'
        ),
        startTick: blockBaseTick + slot.localTick,
        durationTicks: slot.durationTicks,
        channel: TRACK_CHANNELS.vocal,
      });
    }

    if (!isAPrime) {
      motifASkeleton = skeleton;
      motifARelativeContour = wordContourForMotif;
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
      pitch = n.pitch + 12;
      while (pitch > 88) pitch -= 12;
    } else if (mode === 'octave_down') {
      pitch = n.pitch - 12;
      while (pitch < 40) pitch += 12;
    } else {
      const snapped = nearestScalePitch(n.pitch, scalePcs, 24, 96);
      const idx = scaleGrid.indexOf(snapped);
      const stepDelta =
        mode === 'upper_3rd' ? 2 : mode === 'lower_3rd' ? -2 : 4; // upper_5th = +4 scale steps
      if (idx >= 0) {
        const targetIdx = Math.max(
          0,
          Math.min(scaleGrid.length - 1, idx + stepDelta)
        );
        pitch = scaleGrid[targetIdx];
      } else {
        pitch =
          mode === 'upper_3rd'
            ? n.pitch + 4
            : mode === 'lower_3rd'
              ? n.pitch - 4
              : n.pitch + 7;
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
