import { TICKS_PER_BAR, type MidiNote } from '../types/song';
import { fitPitchClassToRange, resolveChordForBar } from '../lib/chordUtils';
import { createSeededRng } from '../lib/random';
import type { EngineInput } from './types';

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

export function generatePadNotes(input: EngineInput): MidiNote[] {
  const { song, section, style, seed, params } = input;
  if (!song.members.pad.enabled) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;
  const playStyle = song.members.pad.padStyle ?? 'Power';
  const baseVel = section.energy === 'High' ? 84 : section.energy === 'Low' ? 58 : 72;

  const notes: MidiNote[] = [];

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * TICKS_PER_BAR;
    if (barStart >= sectionEnd) break;

    const chord = resolveChordForBar(
      section.chords,
      bar,
      song.key,
      song.scale
    );

    const minP = params.voicingMin;
    const maxP = playStyle === 'Dark Ambient' ? Math.min(67, params.voicingMax) : params.voicingMax;
    const rootMidi = fitPitchClassToRange(chord.rootSemitone, minP, Math.min(minP + 11, maxP));

    const intervals: number[] = [0];
    if (playStyle === 'Dark Ambient') {
      intervals.push(7);
      if (chord.quality === 'minor') intervals.push(3);
      if (params.add9) intervals.push(14);
    } else if (playStyle === 'Floating Tension' || params.add9 || params.add7 || params.sus2) {
      intervals.push(7, 12);
      if (params.sus2 || playStyle === 'Floating Tension') intervals.push(2);
      if (params.add7 || playStyle === 'Floating Tension') {
        intervals.push(chord.intervals.includes(11) ? 11 : 10);
      }
      if (params.add9 || playStyle === 'Floating Tension') {
        intervals.push(14);
      }
    } else {
      // Power: Root, +7, +12
      intervals.push(7, 12);
      if (style === 'C') {
        const third = chord.quality === 'minor' ? 3 : 4;
        intervals.push(third + 12);
      }
    }

    const uniquePitches = Array.from(
      new Set(
        intervals
          .map((iv) => rootMidi + iv)
          .filter((p) => p >= minP && p <= maxP)
      )
    ).sort((a, b) => a - b);

    const dur = Math.max(1, Math.min(TICKS_PER_BAR - 20, sectionEnd - barStart));
    for (const p of uniquePitches) {
      const vel = clampVelocity(
        Math.min(
          params.velocityCap,
          baseVel +
            params.velocityBoost +
            rng.nextInt(-Math.min(6, params.velocityJitter), Math.min(6, params.velocityJitter))
        )
      );
      notes.push({
        pitch: p,
        velocity: vel,
        startTick: barStart,
        durationTicks: dur,
        channel: 2,
      });
    }
  }

  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  return notes;
}
