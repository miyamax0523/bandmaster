import { TICKS_PER_BAR, type MidiNote } from '../types/song';
import {
  fitPitchClassToRange,
  noteNameToSemitone,
  resolveChordForBar,
} from '../lib/chordUtils';
import { createSeededRng } from '../lib/random';
import type { EngineInput } from './types';

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

function enforceMonophonicAndClip(
  rawNotes: MidiNote[],
  sectionEnd: number
): MidiNote[] {
  const valid = rawNotes
    .map((n) => ({
      pitch: Math.min(127, Math.max(0, Math.round(n.pitch))),
      velocity: clampVelocity(n.velocity),
      startTick: Math.max(0, Math.round(n.startTick)),
      durationTicks: Math.max(1, Math.round(n.durationTicks)),
      channel: 0,
    }))
    .filter((n) => n.startTick < sectionEnd);

  valid.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  // Deduplicate identical startTick (keep first)
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

  // Truncate overlapping durations
  for (let i = 0; i < deduped.length; i++) {
    const curr = deduped[i];
    const maxAllowed =
      i + 1 < deduped.length
        ? Math.min(sectionEnd - curr.startTick, deduped[i + 1].startTick - curr.startTick)
        : sectionEnd - curr.startTick;
    curr.durationTicks = Math.max(1, Math.min(curr.durationTicks, maxAllowed));
  }

  return deduped;
}

export function generateBassNotes(input: EngineInput): MidiNote[] {
  const { song, section, style, seed, params, drumNotes = [] } = input;
  if (!song.members.bass.enabled || section.enabledParts?.bass === false) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;

  // Mode A: Guitar Unison Riff Mode (highest priority)
  if (section.unisonRiff) {
    const riff = section.unisonRiff;
    const riffLen = Math.max(1, riff.bars) * TICKS_PER_BAR;
    const applyPartialOctaveUp =
      section.kickMode === '808' && riff.octaveUpOn808 === true;

    const expanded: MidiNote[] = [];
    for (let base = 0; base < sectionEnd; base += riffLen) {
      for (const src of riff.cleanedBassNotes) {
        const absTick = base + src.startTick;
        if (absTick < 0 || absTick >= sectionEnd) continue;
        const shiftedPitch =
          applyPartialOctaveUp && src.pitch + 12 <= 55
            ? src.pitch + 12
            : src.pitch;
        expanded.push({
          pitch: shiftedPitch,
          velocity: clampVelocity(src.velocity),
          startTick: absTick,
          durationTicks: Math.max(1, src.durationTicks),
          channel: 0,
        });
      }
    }

    if (style === 'B') {
      // Take B: 100% exact copy (after partial +12 if 808 octaveUpOn808)
      return enforceMonophonicAndClip(expanded, sectionEnd);
    }

    if (style === 'A') {
      // Take A: fixed +-6 velocity jitter regardless of params.velocityJitter
      const varied = expanded.map((n) => ({
        ...n,
        velocity: clampVelocity(
          Math.min(params.velocityCap, n.velocity + rng.nextInt(-6, 6))
        ),
      }));
      return enforceMonophonicAndClip(varied, sectionEnd);
    }

    // Take C: add decorative +12 octave note at bar beat 4 offbeat (tick 1680) if gap exists
    const withDeco = [...expanded];
    if (!params.forceRiffStrictUnison) {
      for (let bar = 0; bar < section.bars; bar++) {
        const barStart = bar * TICKS_PER_BAR;
        const barEnd = barStart + TICKS_PER_BAR;
        const targetTick = barStart + 1680;
        if (targetTick >= sectionEnd) continue;

        const hasOverlap = withDeco.some(
          (n) =>
            n.startTick < barStart + 1800 &&
            n.startTick + n.durationTicks > targetTick
        );
        if (hasOverlap) continue;

        const barNotes = withDeco.filter(
          (n) => n.startTick >= barStart && n.startTick < barEnd
        );
        if (barNotes.length === 0) continue;

        let refNote = barNotes
          .filter((n) => n.startTick < targetTick)
          .sort((a, b) => b.startTick - a.startTick)[0];
        if (!refNote) {
          refNote = [...barNotes].sort((a, b) => a.startTick - b.startTick)[0];
        }

        if (refNote && refNote.pitch + 12 <= 55) {
          withDeco.push({
            pitch: refNote.pitch + 12,
            velocity: clampVelocity(
              Math.min(params.velocityCap, 92 + params.velocityBoost)
            ),
            startTick: targetTick,
            durationTicks: 120,
            channel: 0,
          });
        }
      }
    }

    const variedC = withDeco.map((n) => ({
      ...n,
      velocity: clampVelocity(
        Math.min(
          params.velocityCap,
          n.velocity + rng.nextInt(-params.velocityJitter, params.velocityJitter)
        )
      ),
    }));
    return enforceMonophonicAndClip(variedC, sectionEnd);
  }

  // Mode B: Normal / 808 Chord-based Bass Mode
  const behavior = song.members.bass.bass808Behavior ?? 'octaveUp';
  if (section.kickMode === '808' && behavior === 'tacet') {
    return [];
  }

  const kickTicks = drumNotes
    .filter((n) => n.pitch === 36)
    .map((n) => n.startTick);

  const bassPreset = song.members.bass.patternPreset ?? 'auto';
  const notes: MidiNote[] = [];

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * TICKS_PER_BAR;
    const barEnd = barStart + TICKS_PER_BAR;
    const chord = resolveChordForBar(
      section.chords,
      bar,
      song.key,
      song.scale
    );
    const nextChord = resolveChordForBar(
      section.chords,
      bar + 1,
      song.key,
      song.scale
    );

    const barHeadPitch = fitPitchClassToRange(
      bassPreset === 'pedal_point'
        ? noteNameToSemitone(song.key)
        : (chord.bassPitchClass ?? chord.rootPitchClass),
      params.barHeadRootMin,
      params.barHeadRootMax
    );

    const baseVel = section.energy === 'High' ? 105 : section.energy === 'Low' ? 84 : 96;
    const barKicks = kickTicks.filter((t) => t > barStart && t < barEnd);

    if (bassPreset !== 'auto') {
      const octPitch =
        barHeadPitch + 12 <= params.rangeMax
          ? barHeadPitch + 12
          : barHeadPitch;
      const fifthPitch = fitPitchClassToRange(
        (chord.rootSemitone + 7) % 12,
        params.rangeMin,
        params.rangeMax
      );
      const thirdInterval = chord.intervals.includes(3)
        ? 3
        : chord.intervals.includes(4)
          ? 4
          : 7;
      const thirdPitch = fitPitchClassToRange(
        (chord.rootSemitone + thirdInterval) % 12,
        params.rangeMin,
        params.rangeMax
      );
      const nextRoot = fitPitchClassToRange(
        nextChord.bassPitchClass ?? nextChord.rootPitchClass,
        params.barHeadRootMin,
        params.barHeadRootMax
      );
      const approachPitch =
        nextRoot - 1 >= params.rangeMin
          ? nextRoot - 1
          : Math.min(params.rangeMax, nextRoot + 2);

      const pushBassNote = (
        offset: number,
        pitch: number,
        dur: number,
        velOffset = 0
      ) => {
        notes.push({
          pitch: Math.min(params.rangeMax, Math.max(params.rangeMin, pitch)),
          velocity: clampVelocity(
            Math.min(
              params.velocityCap,
              baseVel +
                velOffset +
                params.velocityBoost +
                rng.nextInt(-Math.min(6, params.velocityJitter), Math.min(6, params.velocityJitter))
            )
          ),
          startTick: barStart + offset,
          durationTicks: dur,
          channel: 0,
        });
      };

      if (bassPreset === 'root_whole') {
        pushBassNote(0, barHeadPitch, TICKS_PER_BAR - 40, 8);
      } else if (bassPreset === 'root_steady' || bassPreset === 'pedal_point') {
        for (let off = 0; off < TICKS_PER_BAR; off += 240) {
          pushBassNote(off, barHeadPitch, 210, off === 0 ? 8 : -2);
        }
      } else if (bassPreset === 'kick_lock') {
        pushBassNote(0, barHeadPitch, 220, 8);
        for (const kt of barKicks) {
          pushBassNote(kt - barStart, barHeadPitch, 200, 0);
        }
      } else if (bassPreset === 'octave_disco') {
        for (let s = 0; s < 8; s++) {
          const off = s * 240;
          const p = s % 2 === 0 ? barHeadPitch : octPitch;
          pushBassNote(off, p, 200, s % 2 === 0 ? 6 : 0);
        }
      } else if (bassPreset === 'melodic_walk') {
        pushBassNote(0, barHeadPitch, 440, 8);
        pushBassNote(480, thirdPitch, 440, 0);
        pushBassNote(960, fifthPitch, 440, 2);
        pushBassNote(1440, approachPitch, 440, -2);
      } else if (bassPreset === 'syncopated_groove') {
        const steps: Array<[number, number, number]> = [
          [0, barHeadPitch, 320],
          [360, barHeadPitch, 280],
          [720, fifthPitch, 110],
          [840, octPitch, 300],
          [1200, barHeadPitch, 300],
          [1560, approachPitch, 280],
        ];
        for (const [off, p, dur] of steps) {
          pushBassNote(off, p, dur, off === 0 ? 8 : 0);
        }
      } else if (bassPreset === 'slap_funk') {
        const slaps: Array<[number, number, number]> = [
          [0, barHeadPitch, 110],
          [120, barHeadPitch, 180],
          [360, octPitch, 110],
          [480, barHeadPitch, 200],
          [720, octPitch, 110],
          [840, barHeadPitch, 200],
          [1080, octPitch, 110],
          [1440, fifthPitch, 200],
          [1680, octPitch, 180],
        ];
        for (const [off, p, dur] of slaps) {
          pushBassNote(off, p, dur, p === octPitch ? 6 : 2);
        }
      } else if (bassPreset === 'metal_gallop') {
        const gallops = [0, 240, 360, 480, 720, 840, 960, 1200, 1320, 1440, 1680, 1800];
        for (const off of gallops) {
          pushBassNote(off, barHeadPitch, 105, off % 480 === 0 ? 8 : -2);
        }
      } else if (bassPreset === 'sub_808_glide') {
        const subHits =
          barKicks.length > 0
            ? [0, ...barKicks.slice(0, 2).map((kt) => kt - barStart)]
            : [0, 960];
        const uniqueSubs = Array.from(new Set(subHits)).sort((a, b) => a - b);
        for (let i = 0; i < uniqueSubs.length; i++) {
          const off = uniqueSubs[i];
          const nextOff = i + 1 < uniqueSubs.length ? uniqueSubs[i + 1] : TICKS_PER_BAR;
          pushBassNote(off, barHeadPitch, Math.max(240, nextOff - off - 20), 10);
        }
      }
      continue;
    }

    // Mandatory bar-head root at tick = barStart (exact 0 jitter)
    notes.push({
      pitch: barHeadPitch,
      velocity: clampVelocity(
        Math.min(
          params.velocityCap,
          baseVel + 8 + params.velocityBoost
        )
      ),
      startTick: barStart,
      durationTicks: 220,
      channel: 0,
    });

    const usedTicks = new Set<number>([barStart]);

    const pickBassPitch = (allowOctave: boolean): number => {
      if (allowOctave && barHeadPitch + 12 <= params.rangeMax && rng.chance(params.octaveProb)) {
        return barHeadPitch + 12;
      }
      // Also allow fifth within range sometimes
      if (rng.chance(0.2)) {
        const fifth = fitPitchClassToRange(
          (chord.rootSemitone + 7) % 12,
          params.rangeMin,
          params.rangeMax
        );
        return fifth;
      }
      return Math.min(params.rangeMax, Math.max(params.rangeMin, barHeadPitch));
    };

    for (const kt of barKicks) {
      if (rng.chance(params.kickSyncRate)) {
        const p = pickBassPitch(true);
        const jitter =
          params.humanizeTicks > 0
            ? rng.nextInt(-params.humanizeTicks, params.humanizeTicks)
            : 0;
        const startTick = Math.max(barStart + 1, kt + jitter);
        usedTicks.add(kt);
        notes.push({
          pitch: p,
          velocity: clampVelocity(
            Math.min(
              params.velocityCap,
              baseVel +
                params.velocityBoost +
                rng.nextInt(-params.velocityJitter, params.velocityJitter)
            )
          ),
          startTick,
          durationTicks: 200,
          channel: 0,
        });
      }
    }

    // Driving 8th / Take A & C non-kick notes
    const nonKickCandidates = [480, 960, 1440, 240, 720, 1200, 1680];
    let addedNonKick = false;

    if (song.members.bass.bassStyle === 'Driving 8th') {
      for (let off = 240; off < TICKS_PER_BAR; off += 240) {
        const absT = barStart + off;
        if (usedTicks.has(absT)) continue;
        usedTicks.add(absT);
        addedNonKick = true;
        notes.push({
          pitch: pickBassPitch(style === 'C'),
          velocity: clampVelocity(
            Math.min(
              params.velocityCap,
              baseVel - 6 + params.velocityBoost + rng.nextInt(-params.velocityJitter, params.velocityJitter)
            )
          ),
          startTick: absT,
          durationTicks: 180,
          channel: 0,
        });
      }
    } else if (style === 'A' || style === 'C') {
      const targetExtras = style === 'C' ? 3 : 2;
      let count = 0;
      for (const off of nonKickCandidates) {
        if (count >= targetExtras) break;
        const absT = barStart + off;
        if (barKicks.some((kt) => Math.abs(kt - absT) < 60)) continue;
        if (usedTicks.has(absT)) continue;
        usedTicks.add(absT);
        count++;
        addedNonKick = true;
        notes.push({
          pitch: pickBassPitch(true),
          velocity: clampVelocity(
            Math.min(
              params.velocityCap,
              baseVel - 4 + params.velocityBoost + rng.nextInt(-params.velocityJitter, params.velocityJitter)
            )
          ),
          startTick: absT,
          durationTicks: 200,
          channel: 0,
        });
      }

      // Guarantee at least 1 non-kick note in Take A/C
      if (!addedNonKick) {
        const fallbackOffset =
          nonKickCandidates.find((off) => !usedTicks.has(barStart + off)) ?? 960;
        const absT = barStart + fallbackOffset;
        usedTicks.add(absT);
        notes.push({
          pitch: pickBassPitch(true),
          velocity: clampVelocity(
            Math.min(params.velocityCap, baseVel + params.velocityBoost)
          ),
          startTick: absT,
          durationTicks: 180,
          channel: 0,
        });
      }
    }

    // Passing fill at bar end
    if (
      params.forcePassingFill ||
      (style !== 'B' && rng.chance(params.passingProb))
    ) {
      const passTick = barStart + 1680;
      const nextRoot = fitPitchClassToRange(
        nextChord.bassPitchClass ?? nextChord.rootPitchClass,
        params.barHeadRootMin,
        params.barHeadRootMax
      );
      const approachPitch =
        nextRoot - 1 >= params.rangeMin
          ? nextRoot - 1
          : Math.min(params.rangeMax, nextRoot + 2);
      if (!usedTicks.has(passTick)) {
        notes.push({
          pitch: Math.min(params.rangeMax, Math.max(params.rangeMin, approachPitch)),
          velocity: clampVelocity(
            Math.min(params.velocityCap, baseVel + params.velocityBoost)
          ),
          startTick: passTick,
          durationTicks: 180,
          channel: 0,
        });
      }
    }
  }

  return enforceMonophonicAndClip(notes, sectionEnd);
}
