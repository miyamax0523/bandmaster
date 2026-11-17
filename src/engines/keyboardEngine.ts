import { TICKS_PER_BAR, type MidiNote } from '../types/song';
import { fitPitchClassToRange, resolveChordForBar } from '../lib/chordUtils';
import { createSeededRng } from '../lib/random';
import type { EngineInput, ResolvedInstrumentParams } from './types';

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

function buildKeyboardVoicing(
  rootSemitone: number,
  intervals: readonly number[],
  params: ResolvedInstrumentParams
): number[] {
  const minP = Math.max(60, params.voicingMin);
  const maxP = Math.min(84, params.voicingMax);
  const rootMidi = fitPitchClassToRange(rootSemitone, minP, Math.min(72, maxP));

  const pitchSet = new Set<number>();
  const effectiveIntervals = [...intervals];

  if (params.sus2 && !effectiveIntervals.includes(2)) {
    // Replace 3rd with 2nd if sus2 tension requested
    const idx3 = effectiveIntervals.indexOf(3);
    const idx4 = effectiveIntervals.indexOf(4);
    if (idx3 !== -1) effectiveIntervals.splice(idx3, 1, 2);
    else if (idx4 !== -1) effectiveIntervals.splice(idx4, 1, 2);
    else effectiveIntervals.push(2);
  }
  if (params.add7 && !effectiveIntervals.includes(10) && !effectiveIntervals.includes(11)) {
    effectiveIntervals.push(10);
  }
  if (params.add9 && !effectiveIntervals.includes(14)) {
    effectiveIntervals.push(14);
  }

  for (const iv of effectiveIntervals) {
    let p = rootMidi + iv;
    while (p < minP) p += 12;
    while (p > maxP && p - 12 >= minP) p -= 12;
    if (p >= minP && p <= maxP) {
      pitchSet.add(p);
    }
  }

  return Array.from(pitchSet).sort((a, b) => a - b);
}

export function generateKeyboardNotes(input: EngineInput): MidiNote[] {
  const { song, section, style, seed, params } = input;
  if (!song.members.keyboard.enabled) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;
  const playStyle = song.members.keyboard.keyboardStyle ?? 'Rhythm Backing';
  const baseVel = section.energy === 'High' ? 92 : section.energy === 'Low' ? 68 : 82;

  const notes: MidiNote[] = [];

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * TICKS_PER_BAR;
    const chord = resolveChordForBar(
      section.chords,
      bar,
      song.key,
      song.scale
    );
    const voicing = buildKeyboardVoicing(
      chord.rootSemitone,
      chord.intervals,
      params
    );

    const pushChordHit = (
      startTick: number,
      durationTicks: number,
      velOffset = 0
    ) => {
      for (const p of voicing) {
        const jitter =
          params.humanizeTicks > 0 && startTick > barStart
            ? rng.nextInt(-params.humanizeTicks, params.humanizeTicks)
            : 0;
        const t = Math.max(0, startTick + jitter);
        if (t >= sectionEnd) continue;
        const vel = clampVelocity(
          Math.min(
            params.velocityCap,
            baseVel +
              velOffset +
              params.velocityBoost +
              rng.nextInt(-params.velocityJitter, params.velocityJitter)
          )
        );
        notes.push({
          pitch: p,
          velocity: vel,
          startTick: t,
          durationTicks: Math.max(1, Math.min(durationTicks, sectionEnd - t)),
          channel: 1,
        });
      }
    };

    if (playStyle === 'Long Sustain') {
      pushChordHit(barStart, TICKS_PER_BAR - 20, -4);
    } else if (playStyle === 'Minimal Riff') {
      const steps = style === 'C' ? [0, 720, 1200] : [0, 960];
      for (let i = 0; i < steps.length; i++) {
        const p = voicing[i % voicing.length];
        const t = barStart + steps[i];
        if (t >= sectionEnd) continue;
        notes.push({
          pitch: p,
          velocity: clampVelocity(
            Math.min(
              params.velocityCap,
              baseVel + params.velocityBoost + rng.nextInt(-params.velocityJitter, params.velocityJitter)
            )
          ),
          startTick: t,
          durationTicks: Math.max(1, Math.min(360, sectionEnd - t)),
          channel: 1,
        });
      }
    } else if (playStyle === 'Arpeggio') {
      const step = style === 'B' ? 480 : 240;
      const count = TICKS_PER_BAR / step;
      for (let s = 0; s < count; s++) {
        const t = barStart + s * step;
        if (t >= sectionEnd) continue;
        const p = voicing[s % voicing.length];
        notes.push({
          pitch: p,
          velocity: clampVelocity(
            Math.min(
              params.velocityCap,
              baseVel - (s % 2 === 0 ? 0 : 8) + params.velocityBoost + rng.nextInt(-params.velocityJitter, params.velocityJitter)
            )
          ),
          startTick: t,
          durationTicks: Math.max(1, Math.min(step - 20, sectionEnd - t)),
          channel: 1,
        });
      }
    } else {
      // Rhythm Backing
      const hits =
        style === 'B'
          ? [0, 960]
          : style === 'A'
            ? [0, 480, 960, 1440]
            : [0, 360, 720, 960, 1320, 1680];
      for (const h of hits) {
        const dur = style === 'B' ? 440 : 200;
        pushChordHit(barStart + h, dur, h === 0 ? 4 : -4);
      }
    }
  }

  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  return notes;
}
