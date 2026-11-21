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

  // Truncate overlapping durations leaving a >=5 tick safety margin before the next note
  for (let i = 0; i < deduped.length; i++) {
    const curr = deduped[i];
    if (i + 1 < deduped.length) {
      const gap = deduped[i + 1].startTick - curr.startTick;
      const safeCap = gap > 5 ? gap - 5 : gap;
      const maxAllowed = Math.min(sectionEnd - curr.startTick, safeCap);
      curr.durationTicks = Math.max(1, Math.min(curr.durationTicks, maxAllowed));
    } else {
      curr.durationTicks = Math.max(
        1,
        Math.min(curr.durationTicks, sectionEnd - curr.startTick)
      );
    }
  }

  return deduped;
}

/**
 * Applies natural legato gate times (88%..95% of inter-onset span) to main bass notes
 * while leaving ghost/muted notes short and never overlapping nextNote.startTick - 5.
 */
function applyLegatoGateToList(
  notes: MidiNote[],
  sectionEnd: number,
  gateRatio = 0.92,
  maxLegatoSpan = TICKS_PER_BAR
): void {
  if (notes.length === 0) return;
  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  for (let i = 0; i < notes.length; i++) {
    const curr = notes[i];
    if (curr.velocity < 65) continue; // preserve ghost/muted staccato notes
    const nextStart = i + 1 < notes.length ? notes[i + 1].startTick : sectionEnd;
    const span = Math.max(1, nextStart - curr.startTick);
    if (span > maxLegatoSpan) continue;
    const legatoDur = Math.max(curr.durationTicks, Math.round(span * gateRatio));
    const maxSafe = i + 1 < notes.length ? Math.max(1, span - 5) : sectionEnd - curr.startTick;
    curr.durationTicks = Math.max(1, Math.min(legatoDur, maxSafe));
  }
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

    // Connect adjacent unison riff notes with natural 92% legato while keeping Take C deco pop crisp
    applyLegatoGateToList(expanded, sectionEnd, 0.92, 960);

    if (style === 'B') {
      // Take B: 100% exact copy (after partial +12 if 808 octaveUpOn808 & natural legato)
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
        pushBassNote(0, barHeadPitch, Math.round(TICKS_PER_BAR * 0.94), 8);
      } else if (bassPreset === 'root_steady' || bassPreset === 'pedal_point') {
        const steadyDur = Math.round(240 * 0.92);
        for (let off = 0; off < TICKS_PER_BAR; off += 240) {
          pushBassNote(off, barHeadPitch, steadyDur, off === 0 ? 8 : -2);
        }
      } else if (bassPreset === 'kick_lock') {
        const lockOffsets = Array.from(
          new Set([0, ...barKicks.map((kt) => kt - barStart)])
        )
          .filter((off) => off >= 0 && off < TICKS_PER_BAR)
          .sort((a, b) => a - b);
        for (let i = 0; i < lockOffsets.length; i++) {
          const off = lockOffsets[i];
          const nextOff = i + 1 < lockOffsets.length ? lockOffsets[i + 1] : TICKS_PER_BAR;
          const span = Math.max(120, nextOff - off);
          const dur = Math.min(Math.max(1, span - 5), Math.round(span * 0.92));
          pushBassNote(off, barHeadPitch, dur, off === 0 ? 8 : 0);
        }
      } else if (bassPreset === 'octave_disco') {
        const discoDur = Math.round(240 * 0.9);
        for (let s = 0; s < 8; s++) {
          const off = s * 240;
          const p = s % 2 === 0 ? barHeadPitch : octPitch;
          pushBassNote(off, p, discoDur, s % 2 === 0 ? 6 : 0);
        }
      } else if (bassPreset === 'melodic_walk') {
        const walkDur = Math.round(480 * 0.92);
        pushBassNote(0, barHeadPitch, walkDur, 8);
        pushBassNote(480, thirdPitch, walkDur, 0);
        pushBassNote(960, fifthPitch, walkDur, 2);
        pushBassNote(1440, approachPitch, walkDur, -2);
      } else if (bassPreset === 'syncopated_groove') {
        const steps: Array<[number, number, number]> = [
          [0, barHeadPitch, Math.round(360 * 0.92)],
          [360, barHeadPitch, Math.round(360 * 0.92)],
          [720, fifthPitch, 110], // crisp 16th syncopated ghost jump into octave
          [840, octPitch, Math.round(360 * 0.92)],
          [1200, barHeadPitch, Math.round(360 * 0.92)],
          [1560, approachPitch, Math.round(360 * 0.92)],
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
          const span = Math.max(240, nextOff - off);
          pushBassNote(off, barHeadPitch, Math.min(span - 5, Math.round(span * 0.94)), 10);
        }
      } else if (bassPreset === 'jrock_anticipation') {
        // Driving 8th root/octave groove that anticipates nextChord root on beat 4-and (1680)
        // and ties across the barline (omitting re-attack at beat 1 of bars > 0)
        const bodySteps =
          bar === 0
            ? [0, 240, 480, 720, 960, 1200, 1440]
            : [240, 480, 720, 960, 1200, 1440];
        const antLegatoDur = Math.round(240 * 0.92);
        for (let i = 0; i < bodySteps.length; i++) {
          const off = bodySteps[i];
          const p =
            style !== 'B' && off % 480 === 240 && off !== 1440
              ? octPitch
              : barHeadPitch;
          pushBassNote(off, p, antLegatoDur, off % 480 === 0 ? 8 : 0);
        }
        // Anticipate next bar's root at 1680 and tie across barEnd (duration 460 -> 2140)
        pushBassNote(1680, nextRoot, 460, 10);
      } else if (bassPreset === 'disco_boogie_bounce') {
        // Got To Be Real style boogie octave riff:
        // Low root -> +12 octave leaps, short staccato (45-60% gate), 16th syncopations,
        // leaving beats 2 & 4 pocket open for Keyboard response, + b7 -> root bar-end turnaround
        const b7Pitch =
          barHeadPitch - 2 >= params.rangeMin
            ? barHeadPitch - 2
            : barHeadPitch + 10 <= params.rangeMax
              ? barHeadPitch + 10
              : fitPitchClassToRange(
                  (chord.rootSemitone + 10) % 12,
                  params.rangeMin,
                  params.rangeMax
                );
        const boogieRiff: Array<[number, number, number, number]> =
          style === 'B'
            ? [
                [0, barHeadPitch, 120, 10],
                [240, octPitch, 110, 4],
                [720, octPitch, 110, 4],
                [960, barHeadPitch, 120, 8],
                [1200, octPitch, 110, 4],
                [1560, b7Pitch, 110, 0],
                [1680, barHeadPitch, 110, 4],
              ]
            : [
                [0, barHeadPitch, 120, 10],
                [240, octPitch, 110, 4],
                [600, octPitch, 105, 2], // 16th bounce anticipation leaving beat 2 chop open
                [840, barHeadPitch, 70, -2], // crisp 16th ghost pickup
                [960, barHeadPitch, 120, 8],
                [1200, octPitch, 110, 4],
                [1560, b7Pitch, 105, 0], // b7 -> root approach
                [1680, octPitch, 105, 4],
                [1800, fifthPitch, 68, -2], // 16th turnaround into next bar root
              ];
        for (const [off, p, dur, velOff] of boogieRiff) {
          pushBassNote(off, p, dur, velOff);
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

  // Apply natural legato gate time (92% of grid span) for auto-mode notes across the section
  if (bassPreset === 'auto') {
    applyLegatoGateToList(notes, sectionEnd, 0.92, TICKS_PER_BAR);
  }

  return enforceMonophonicAndClip(notes, sectionEnd);
}
