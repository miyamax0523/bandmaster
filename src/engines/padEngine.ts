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
  const padPreset = song.members.pad.patternPreset ?? 'auto';
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

    const minP =
      padPreset === 'high_shimmer'
        ? 64
        : padPreset === 'dark_cinematic'
          ? 43
          : params.voicingMin;
    const maxP =
      padPreset === 'high_shimmer'
        ? 88
        : padPreset === 'dark_cinematic'
          ? 64
          : padPreset === 'octave_layer'
            ? 84
            : playStyle === 'Dark Ambient' && padPreset === 'auto'
              ? Math.min(67, params.voicingMax)
              : params.voicingMax;
    const rootMidi = fitPitchClassToRange(
      chord.rootSemitone,
      minP,
      Math.min(minP + 11, maxP)
    );

    const intervalSet = new Set<number>();
    const isPlainTriad =
      chord.intervals.length === 3 &&
      chord.intervals[0] === 0 &&
      (chord.intervals[1] === 3 || chord.intervals[1] === 4) &&
      chord.intervals[2] === 7;

    if (padPreset !== 'auto') {
      if (padPreset === 'warm_whole' || padPreset === 'swell_half') {
        for (const iv of chord.intervals) intervalSet.add(iv);
        if (chord.quality !== 'power') intervalSet.add(12);
      } else if (padPreset === 'high_shimmer') {
        for (const iv of chord.intervals) intervalSet.add(iv);
        intervalSet.add(12);
        intervalSet.add(14);
      } else if (padPreset === 'dark_cinematic') {
        intervalSet.add(0);
        intervalSet.add(7);
        if (chord.intervals.includes(3)) intervalSet.add(3);
        intervalSet.add(12);
      } else if (padPreset === 'floating_9th') {
        for (const iv of chord.intervals) intervalSet.add(iv);
        intervalSet.add(2);
        if (!intervalSet.has(10) && !intervalSet.has(11)) intervalSet.add(11);
        intervalSet.add(14);
        intervalSet.add(12);
      } else if (padPreset === 'fifth_drone') {
        intervalSet.add(0);
        intervalSet.add(7);
        intervalSet.add(12);
      } else if (padPreset === 'octave_layer') {
        for (const iv of chord.intervals) {
          intervalSet.add(iv);
          intervalSet.add(iv + 12);
        }
        intervalSet.add(19);
      }
    } else if (playStyle === 'Dark Ambient') {
      for (const iv of chord.intervals) {
        intervalSet.add(iv);
      }
      if (params.add9) intervalSet.add(14);
    } else if (
      playStyle === 'Floating Tension' ||
      params.add9 ||
      params.add7 ||
      params.sus2
    ) {
      for (const iv of chord.intervals) {
        intervalSet.add(iv);
      }
      intervalSet.add(12);
      if (params.sus2 || playStyle === 'Floating Tension') {
        intervalSet.add(2);
      }
      if (
        (params.add7 || playStyle === 'Floating Tension') &&
        !intervalSet.has(10) &&
        !intervalSet.has(11)
      ) {
        intervalSet.add(10);
      }
      if (params.add9 || playStyle === 'Floating Tension') {
        intervalSet.add(14);
      }
    } else if (isPlainTriad) {
      // Power voicing on plain triads: Root, +7, +12
      intervalSet.add(0);
      intervalSet.add(7);
      intervalSet.add(12);
      if (style === 'C') {
        const third = chord.quality === 'minor' ? 3 : 4;
        intervalSet.add(third + 12);
      }
    } else {
      // Non-triad / tension / sus / power chords: honor parsed intervals directly
      for (const iv of chord.intervals) {
        intervalSet.add(iv);
      }
      if (chord.quality !== 'power') {
        intervalSet.add(12);
      }
    }

    const uniquePitches = Array.from(
      new Set(
        Array.from(intervalSet)
          .map((iv) => rootMidi + iv)
          .filter((p) => p >= minP && p <= maxP)
      )
    ).sort((a, b) => a - b);

    const hitOffsets = padPreset === 'swell_half' ? [0, 960] : [0];
    const hitSpan = padPreset === 'swell_half' ? 940 : TICKS_PER_BAR - 20;

    for (const off of hitOffsets) {
      const startTick = barStart + off;
      if (startTick >= sectionEnd) continue;
      const dur = Math.max(1, Math.min(hitSpan, sectionEnd - startTick));
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
          startTick,
          durationTicks: dur,
          channel: 2,
        });
      }
    }
  }

  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  return notes;
}
