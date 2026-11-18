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
  params: ResolvedInstrumentParams,
  options?: { minPitch?: number; maxPitch?: number; forceFloating?: boolean }
): number[] {
  const minP = options?.minPitch ?? Math.max(60, params.voicingMin);
  const maxP = options?.maxPitch ?? Math.min(84, params.voicingMax);
  const rootMidi = fitPitchClassToRange(rootSemitone, minP, Math.min(minP + 12, maxP));

  const pitchSet = new Set<number>();
  const intervalSet = new Set<number>(intervals);

  if (params.sus2 && !intervalSet.has(2)) {
    if (intervalSet.has(3)) intervalSet.delete(3);
    if (intervalSet.has(4)) intervalSet.delete(4);
    intervalSet.add(2);
  }
  if ((params.add7 || options?.forceFloating) && !intervalSet.has(10) && !intervalSet.has(11)) {
    intervalSet.add(11);
  }
  if (params.add9 || options?.forceFloating) {
    intervalSet.add(14);
  }
  if (options?.forceFloating && !intervalSet.has(2)) {
    intervalSet.add(2);
  }

  for (const iv of intervalSet) {
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
  const kbPreset = song.members.keyboard.patternPreset ?? 'auto';
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
      params,
      kbPreset === 'dark_low_riff'
        ? { minPitch: 48, maxPitch: 67 }
        : kbPreset === 'floating_tension'
          ? { forceFloating: true }
          : undefined
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

    const pushSingleNote = (
      startTick: number,
      pitch: number,
      durationTicks: number,
      velOffset = 0
    ) => {
      if (startTick >= sectionEnd) return;
      notes.push({
        pitch,
        velocity: clampVelocity(
          Math.min(
            params.velocityCap,
            baseVel +
              velOffset +
              params.velocityBoost +
              rng.nextInt(-params.velocityJitter, params.velocityJitter)
          )
        ),
        startTick,
        durationTicks: Math.max(1, Math.min(durationTicks, sectionEnd - startTick)),
        channel: 1,
      });
    };

    if (kbPreset !== 'auto' && voicing.length > 0) {
      if (kbPreset === 'chord_quarter') {
        for (const h of [0, 480, 960, 1440]) {
          pushChordHit(barStart + h, 220, h === 0 ? 4 : -4);
        }
      } else if (kbPreset === 'chord_eighth') {
        for (let h = 0; h < TICKS_PER_BAR; h += 240) {
          pushChordHit(barStart + h, 140, h % 480 === 0 ? 2 : -6);
        }
      } else if (kbPreset === 'syncopated_comp') {
        for (const h of [0, 360, 720, 1200, 1560]) {
          pushChordHit(barStart + h, 200, h === 0 ? 4 : -2);
        }
      } else if (kbPreset === 'offbeat_ska') {
        for (const h of [240, 720, 1200, 1680]) {
          pushChordHit(barStart + h, 110, 4);
        }
      } else if (kbPreset === 'arp_up') {
        for (let s = 0; s < 8; s++) {
          pushSingleNote(barStart + s * 240, voicing[s % voicing.length], 220, s % 2 === 0 ? 0 : -6);
        }
      } else if (kbPreset === 'arp_down_up') {
        const pingPong =
          voicing.length > 1
            ? [...voicing, ...voicing.slice(1, -1).reverse()]
            : voicing;
        for (let s = 0; s < 8; s++) {
          pushSingleNote(barStart + s * 240, pingPong[s % pingPong.length], 220, s % 2 === 0 ? 0 : -6);
        }
      } else if (kbPreset === 'arp_16th') {
        for (let s = 0; s < 16; s++) {
          pushSingleNote(barStart + s * 120, voicing[s % voicing.length], 100, s % 4 === 0 ? 4 : -6);
        }
      } else if (kbPreset === 'broken_chord') {
        const seq = [
          0,
          Math.min(voicing.length - 1, 2),
          Math.min(voicing.length - 1, 1),
          voicing.length - 1,
          Math.min(voicing.length - 1, 1),
          Math.min(voicing.length - 1, 2),
          0,
          Math.min(voicing.length - 1, 1),
        ];
        for (let s = 0; s < 8; s++) {
          pushSingleNote(barStart + s * 240, voicing[seq[s]], 220, -4);
        }
      } else if (kbPreset === 'whole_sustain') {
        pushChordHit(barStart, TICKS_PER_BAR - 20, -4);
      } else if (kbPreset === 'floating_tension') {
        pushChordHit(barStart, 940, -6);
        pushChordHit(barStart + 960, 940, -10);
      } else if (kbPreset === 'dark_low_riff') {
        const riffSteps = [0, 360, 720, 1200, 1440];
        for (let i = 0; i < riffSteps.length; i++) {
          pushSingleNote(barStart + riffSteps[i], voicing[i % voicing.length], 240, 2);
        }
      }
      continue;
    }

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
