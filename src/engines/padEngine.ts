import { TICKS_PER_BAR, type MidiNote } from '../types/song';
import {
  getActiveChordAtTick,
  getTimelineBoundaryChanges,
} from '../lib/chordTimeline';
import { fitPitchClassToRange, resolveChordForBar } from '../lib/chordUtils';
import { createSeededRng } from '../lib/random';
import type { EngineInput } from './types';

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

export function generatePadNotes(input: EngineInput): MidiNote[] {
  const { song, section, style, seed, params } = input;
  if (!song.members.pad.enabled || section.enabledParts?.pad === false) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;
  const playStyle = song.members.pad.padStyle ?? 'Power';
  const padPreset =
    section.patternPresets?.pad ??
    section.partPresets?.pad ??
    song.members.pad.patternPreset ??
    'auto';
  const baseVel = section.energy === 'High' ? 84 : section.energy === 'Low' ? 58 : 72;

  const notes: MidiNote[] = [];
  const timelineChanges = getTimelineBoundaryChanges(
    section.chords,
    section.bars,
    song.key,
    song.scale
  );

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * TICKS_PER_BAR;
    if (barStart >= sectionEnd) break;

    const chord = getActiveChordAtTick(
      section.chords,
      barStart,
      song.key,
      song.scale,
      section.bars
    ).parsed;

    const minP =
      padPreset === 'high_shimmer'
        ? 64
        : padPreset === 'dark_cinematic' || padPreset === 'analog_warm_drift'
          ? 43
          : params.voicingMin;
    const maxP =
      padPreset === 'high_shimmer'
        ? 88
        : padPreset === 'dark_cinematic'
          ? 64
          : padPreset === 'analog_warm_drift'
            ? 67
            : padPreset === 'octave_layer' ||
                padPreset === 'strings_ensemble' ||
                padPreset === 'choir_open_voicing' ||
                padPreset === 'shimmer_arp_pad'
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
      if (
        padPreset === 'warm_whole' ||
        padPreset === 'swell_half' ||
        padPreset === 'sidechain_pulse'
      ) {
        for (const iv of chord.intervals) intervalSet.add(iv);
        if (chord.quality !== 'power') intervalSet.add(12);
      } else if (padPreset === 'analog_warm_drift') {
        for (const iv of chord.intervals) intervalSet.add(iv);
        intervalSet.add(10);
      } else if (padPreset === 'strings_ensemble') {
        for (const iv of chord.intervals) {
          intervalSet.add(iv);
          intervalSet.add(iv + 12);
        }
        intervalSet.add(7);
        intervalSet.add(19);
        intervalSet.add(24);
      } else if (padPreset === 'choir_open_voicing') {
        // Wide spread open voicing: low root, 5th + 12, 3rd + 24 (transparent wide spacing)
        const third = chord.intervals.includes(3)
          ? 3
          : chord.intervals.includes(4)
            ? 4
            : 2;
        intervalSet.add(0);
        intervalSet.add(19); // 5th an octave+fifth above root
        intervalSet.add(third + 24); // 3rd two octaves above root
      } else if (padPreset === 'shimmer_arp_pad') {
        for (const iv of chord.intervals) intervalSet.add(iv);
        intervalSet.add(12);
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

    if (padPreset === 'jrock_anticipation') {
      const buildPadPitchesForChord = (targetChord: typeof chord): number[] => {
        const targetRoot = fitPitchClassToRange(
          targetChord.rootSemitone,
          minP,
          Math.min(minP + 11, maxP)
        );
        const set = new Set<number>(targetChord.intervals);
        if (targetChord.quality !== 'power') set.add(12);
        return Array.from(
          new Set(
            Array.from(set)
              .map((iv) => targetRoot + iv)
              .filter((p) => p >= minP && p <= maxP)
          )
        ).sort((a, b) => a - b);
      };

      // Bar 0 starts chord[0] cleanly and releases right before beat 4-and (1680) to avoid chord clash
      if (bar === 0) {
        const bar0Pitches = buildPadPitchesForChord(chord);
        const bar0Dur = Math.max(1, Math.min(1660, sectionEnd));
        for (const p of bar0Pitches) {
          notes.push({
            pitch: p,
            velocity: clampVelocity(Math.min(params.velocityCap, baseVel + params.velocityBoost)),
            startTick: 0,
            durationTicks: bar0Dur,
            channel: 2,
          });
        }
      }

      // At tick 1680 of each bar, anticipate next bar's chord and sustain straight across barline (1900 ticks -> ends at +1660 of next bar)
      const antTick = barStart + 1680;
      if (antTick < sectionEnd) {
        const nextChord = resolveChordForBar(
          section.chords,
          bar + 1,
          song.key,
          song.scale
        );
        const nextPitches = buildPadPitchesForChord(nextChord);
        const antDur = Math.max(1, Math.min(1900, sectionEnd - antTick));
        for (const p of nextPitches) {
          notes.push({
            pitch: p,
            velocity: clampVelocity(
              Math.min(params.velocityCap, baseVel + 4 + params.velocityBoost)
            ),
            startTick: antTick,
            durationTicks: antDur,
            channel: 2,
          });
        }
      }
      continue;
    }

    const hitOffsets =
      padPreset === 'swell_half'
        ? [0, 960]
        : padPreset === 'sidechain_pulse'
          ? [120, 600, 1080, 1560]
          : [0];
    const hitSpan =
      padPreset === 'swell_half'
        ? 940
        : padPreset === 'sidechain_pulse'
          ? 340
          : TICKS_PER_BAR - 20;

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

    // Extra sparse high shimmer arpeggio notes layered over sustained pad
    if (padPreset === 'shimmer_arp_pad') {
      const highShimmerPool = [
        rootMidi + 24,
        rootMidi + 19,
        rootMidi + (chord.intervals.includes(3) ? 27 : 28),
        rootMidi + 26,
      ].filter((p) => p >= 64 && p <= 88);
      if (highShimmerPool.length > 0) {
        for (let step = 0; step < 4; step++) {
          const startTick = barStart + step * 480 + 240;
          if (startTick >= sectionEnd) continue;
          const p = highShimmerPool[step % highShimmerPool.length];
          notes.push({
            pitch: p,
            velocity: clampVelocity(baseVel - 16),
            startTick,
            durationTicks: Math.max(1, Math.min(440, sectionEnd - startTick)),
            channel: 2,
          });
        }
      }
    }
  }

  // Timeline chord boundary & offbeat anticipation sync
  if (timelineChanges.length > 0 && padPreset !== 'jrock_anticipation') {
    for (const change of timelineChanges) {
      const changeTick = change.changeTick;
      // Cut previous pad voicing cleanly before changeTick - 5
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        if (n.startTick < changeTick && n.startTick + n.durationTicks > changeTick - 5) {
          const clipped = changeTick - 5 - n.startTick;
          if (clipped < 20) {
            notes.splice(i, 1);
          } else {
            n.durationTicks = clipped;
          }
        }
      }

      // Clear any barline pad attack inside [changeTick, changeTick + 240] when offbeat
      if (change.isOffbeat) {
        for (let i = notes.length - 1; i >= 0; i--) {
          const n = notes[i];
          if (n.startTick >= changeTick && n.startTick <= changeTick + 240) {
            notes.splice(i, 1);
          }
        }
      }

      const hasPadAtChange = notes.some((n) => Math.abs(n.startTick - changeTick) <= 15);
      if (change.isOffbeat || !hasPadAtChange) {
        const cChord = change.parsed;
        const cMinP =
          padPreset === 'high_shimmer'
            ? 64
            : padPreset === 'dark_cinematic' || padPreset === 'analog_warm_drift'
              ? 43
              : params.voicingMin;
        const cMaxP =
          padPreset === 'high_shimmer'
            ? 88
            : padPreset === 'dark_cinematic'
              ? 64
              : padPreset === 'analog_warm_drift'
                ? 67
                : params.voicingMax;
        const cRoot = fitPitchClassToRange(
          cChord.rootSemitone,
          cMinP,
          Math.min(cMinP + 11, cMaxP)
        );
        const cIntervals = new Set<number>(cChord.intervals);
        if (!cChord.intervals.includes(12)) cIntervals.add(12);
        const cPitches = Array.from(
          new Set(
            Array.from(cIntervals)
              .map((iv) => cRoot + iv)
              .filter((p) => p >= 36 && p <= 96)
          )
        ).sort((a, b) => a - b);
        const cDur = Math.max(
          240,
          Math.min(change.endTick - changeTick - 5, sectionEnd - changeTick)
        );
        for (const p of cPitches) {
          notes.push({
            pitch: p,
            velocity: clampVelocity(
              Math.min(params.velocityCap, baseVel + 4 + params.velocityBoost)
            ),
            startTick: changeTick,
            durationTicks: cDur,
            channel: 2,
          });
        }
      }
    }
  }

  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  return notes;
}
