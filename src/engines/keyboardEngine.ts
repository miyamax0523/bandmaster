import { TICKS_PER_BAR, type MidiNote } from '../types/song';
import {
  getActiveChordAtTick,
  getTimelineBoundaryChanges,
} from '../lib/chordTimeline';
import {
  fitPitchClassToRange,
  getScalePitchClasses,
  resolveChordForBar,
} from '../lib/chordUtils';
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
  if (
    (params.add7 || options?.forceFloating) &&
    !intervalSet.has(9) &&
    !intervalSet.has(10) &&
    !intervalSet.has(11)
  ) {
    intervalSet.add(intervalSet.has(6) ? 9 : 11);
  }
  if (params.add9 || (options?.forceFloating && !intervalSet.has(6))) {
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
  if (
    !song.members.keyboard.enabled ||
    section.enabledParts?.keyboard === false
  ) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;
  const playStyle = song.members.keyboard.keyboardStyle ?? 'Rhythm Backing';
  const kbPreset =
    section.patternPresets?.keyboard ??
    section.partPresets?.keyboard ??
    song.members.keyboard.patternPreset ??
    'auto';
  const keyboardDensity = input.keyboardDensity ?? section.keyboardDensity ?? 4;
  const baseVel = section.energy === 'High' ? 92 : section.energy === 'Low' ? 68 : 82;

  const notes: MidiNote[] = [];

  // Special cross-bar polyrhythm preset: continuous dotted-8th (360-tick) cycle across entire section
  if (kbPreset === 'electronica_polyrhythm') {
    const stepTicks =
      keyboardDensity <= 1 ? 1440 : keyboardDensity === 2 ? 720 : 360;
    const motif = [0, 7, 14, 12]; // Root, 5th, 9th, Octave
    let stepIdx = 0;
    for (let t = 0; t < sectionEnd; t += stepTicks) {
      const chord = getActiveChordAtTick(
        section.chords,
        t,
        song.key,
        song.scale,
        section.bars
      ).parsed;
      const rootMidi = fitPitchClassToRange(chord.rootSemitone, 60, 71);
      const pitch = Math.min(88, rootMidi + motif[stepIdx % motif.length]);
      const dur = Math.max(1, Math.min(stepTicks >= 720 ? 320 : 180, sectionEnd - t));
      notes.push({
        pitch,
        velocity: clampVelocity(
          baseVel + (stepIdx % 3 === 0 ? 8 : -6) + rng.nextInt(-4, 4)
        ),
        startTick: t,
        durationTicks: dur,
        channel: 1,
      });
      if (keyboardDensity >= 6 && stepIdx % 2 === 1 && t + 180 < sectionEnd) {
        notes.push({
          pitch: Math.min(92, pitch + 12),
          velocity: clampVelocity(baseVel - 10),
          startTick: t + 180,
          durationTicks: Math.max(1, Math.min(120, sectionEnd - (t + 180))),
          channel: 1,
        });
      }
      if (keyboardDensity === 7 && stepIdx % 2 === 0 && t + 120 < sectionEnd) {
        notes.push({
          pitch: Math.min(96, pitch + 7),
          velocity: clampVelocity(baseVel - 14),
          startTick: t + 120,
          durationTicks: Math.max(1, Math.min(90, sectionEnd - (t + 120))),
          channel: 1,
        });
      }
      stepIdx++;
    }
    notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    return notes;
  }

  const timelineChanges = getTimelineBoundaryChanges(
    section.chords,
    section.bars,
    song.key,
    song.scale
  );

  const voicingOptions =
    kbPreset === 'dark_low_riff'
      ? { minPitch: 48, maxPitch: 67 }
      : kbPreset === 'rock_power_riff'
        ? { minPitch: 48, maxPitch: 67 }
        : kbPreset === 'floating_tension' ||
            kbPreset === 'emo_arp_cascade' ||
            kbPreset === 'gospel_rich_comp'
          ? { forceFloating: true }
          : kbPreset === 'counter_melody'
            ? { minPitch: 67, maxPitch: 86 }
            : undefined;

  const getVoicingAtTick = (absTick: number): number[] => {
    const { parsed } = getActiveChordAtTick(
      section.chords,
      absTick,
      song.key,
      song.scale,
      section.bars
    );
    return buildKeyboardVoicing(
      parsed.rootSemitone,
      parsed.intervals,
      params,
      voicingOptions
    );
  };

  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = bar * TICKS_PER_BAR;
    const chord = getActiveChordAtTick(
      section.chords,
      barStart,
      song.key,
      song.scale,
      section.bars
    ).parsed;
    const voicing = buildKeyboardVoicing(
      chord.rootSemitone,
      chord.intervals,
      params,
      voicingOptions
    );

    const pushChordHit = (
      startTick: number,
      durationTicks: number,
      velOffset = 0
    ) => {
      const activeVoicing =
        startTick > barStart &&
        timelineChanges.some((c) => c.changeTick > barStart && c.changeTick <= startTick)
          ? getVoicingAtTick(startTick)
          : voicing;
      for (const p of activeVoicing) {
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
      const isArpPreset =
        kbPreset === 'arp_up' ||
        kbPreset === 'arp_down_up' ||
        kbPreset === 'arp_16th' ||
        kbPreset === 'broken_chord' ||
        kbPreset === 'emo_arp_cascade' ||
        kbPreset === 'synth_pluck_arp' ||
        kbPreset === 'fusion_fast_arp';

      if (isArpPreset) {
        let arpOrder: number[] = voicing;
        if (kbPreset === 'arp_down_up' && voicing.length > 1) {
          arpOrder = [...voicing, ...voicing.slice(1, -1).reverse()];
        } else if (kbPreset === 'broken_chord') {
          arpOrder = [
            voicing[0],
            voicing[Math.min(voicing.length - 1, 2)],
            voicing[Math.min(voicing.length - 1, 1)],
            voicing[voicing.length - 1],
          ];
        } else if (kbPreset === 'emo_arp_cascade' && voicing.length > 2) {
          arpOrder = [...voicing, ...voicing.slice(0, -1).reverse()];
        } else if (kbPreset === 'synth_pluck_arp') {
          arpOrder = voicing.map((_, i) => voicing[(i * 2) % voicing.length]);
        } else if (kbPreset === 'fusion_fast_arp') {
          const fusionPool = buildKeyboardVoicing(
            chord.rootSemitone,
            [...chord.intervals, 11, 14, 21],
            params,
            { minPitch: 60, maxPitch: 88, forceFloating: true }
          );
          const upOct = fusionPool.map((p) => p + 12).filter((p) => p <= 91);
          const twoOctave = Array.from(new Set([...fusionPool, ...upOct])).sort(
            (a, b) => a - b
          );
          arpOrder =
            twoOctave.length > 2
              ? [...twoOctave, ...twoOctave.slice(1, -1).reverse()]
              : twoOctave;
        }

        // Level 6 & 7 expand arpeggio pattern up an octave for brighter spread
        if (keyboardDensity >= 6 && kbPreset !== 'fusion_fast_arp') {
          const upper = voicing
            .map((p) => p + 12)
            .filter((p) => p <= 96);
          if (upper.length > 0) {
            arpOrder = [...arpOrder, ...upper.slice(0, 2)];
          }
        }

        const isPluck = kbPreset === 'synth_pluck_arp';
        // 7-stage density steps per bar:
        // 1: 1 note (whole sustain), 2: 2 notes (half), 3: 5 notes (quarter + offbeat),
        // 4: 8 notes (8th standard), 5: 11 notes (8th+16th sync), 6: 14 notes (16th + octave),
        // 7: 16 full 16ths + 2 high octave sparkle notes (18 notes/bar)
        const stepOffsets =
          keyboardDensity === 1
            ? [0]
            : keyboardDensity === 2
              ? [0, 960]
              : keyboardDensity === 3
                ? [0, 480, 720, 960, 1440]
                : keyboardDensity === 4
                  ? [0, 240, 480, 720, 960, 1200, 1440, 1680]
                  : keyboardDensity === 5
                    ? [0, 240, 360, 480, 720, 840, 960, 1200, 1320, 1440, 1680]
                    : keyboardDensity === 6
                      ? [0, 120, 240, 360, 480, 720, 840, 960, 1080, 1200, 1320, 1440, 1680, 1800]
                      : Array.from({ length: 16 }, (_, s) => s * 120);

        const arpDur =
          keyboardDensity === 1
            ? 1820
            : keyboardDensity === 2
              ? isPluck
                ? 220
                : 900
              : keyboardDensity === 3
                ? isPluck
                  ? 110
                  : 360
                : keyboardDensity === 4
                  ? isPluck
                    ? 65
                    : 220
                  : keyboardDensity === 5
                    ? isPluck
                      ? 65
                      : 160
                    : keyboardDensity === 6
                      ? isPluck
                        ? 65
                        : 115
                      : isPluck
                        ? 65
                        : 100;

        for (let i = 0; i < stepOffsets.length; i++) {
          const off = stepOffsets[i];
          const pitch = arpOrder[i % arpOrder.length];
          pushSingleNote(
            barStart + off,
            pitch,
            arpDur,
            off % 480 === 0 ? 4 : -6
          );
        }

        // Level 7 sparkle: high octave jumps on beats 1 & 3 (18 notes/bar)
        if (keyboardDensity === 7) {
          for (const sparkleOff of [0, 960]) {
            const top = Math.min(96, arpOrder[arpOrder.length - 1] + 12);
            pushSingleNote(barStart + sparkleOff, top, 140, 6);
          }
        }
        continue;
      }

      if (kbPreset === 'chord_quarter') {
        const hits =
          keyboardDensity === 1
            ? [0]
            : keyboardDensity === 2
              ? [0, 960]
              : keyboardDensity === 3
                ? [0, 480, 1440]
                : keyboardDensity <= 5
                  ? [0, 480, 960, 1440]
                  : [0, 240, 480, 720, 960, 1200, 1440, 1680];
        for (const h of hits) {
          pushChordHit(
            barStart + h,
            keyboardDensity === 1 ? 1860 : keyboardDensity === 2 ? 900 : 220,
            h === 0 ? 4 : -4
          );
        }
      } else if (kbPreset === 'chord_eighth') {
        const hits =
          keyboardDensity === 1
            ? [0]
            : keyboardDensity === 2
              ? [0, 960]
              : keyboardDensity === 3
                ? [0, 480, 960, 1440]
                : keyboardDensity === 4
                  ? [0, 240, 480, 720, 960, 1200, 1440, 1680]
                  : [0, 120, 240, 480, 720, 840, 960, 1200, 1320, 1440, 1680, 1800];
        for (const h of hits) {
          pushChordHit(
            barStart + h,
            keyboardDensity === 1 ? 1860 : keyboardDensity === 2 ? 880 : keyboardDensity === 3 ? 400 : keyboardDensity >= 6 ? 95 : 140,
            h % 480 === 0 ? 2 : -6
          );
        }
      } else if (kbPreset === 'syncopated_comp') {
        const hits =
          keyboardDensity <= 2
            ? [0, 960]
            : keyboardDensity === 3
              ? [0, 720, 1440]
              : keyboardDensity <= 5
                ? [0, 360, 720, 1200, 1560]
                : [0, 240, 360, 720, 840, 1200, 1440, 1560];
        for (const h of hits) {
          pushChordHit(barStart + h, keyboardDensity <= 2 ? 440 : 200, h === 0 ? 4 : -2);
        }
      } else if (kbPreset === 'offbeat_ska') {
        const hits =
          keyboardDensity <= 2
            ? [480, 1440]
            : keyboardDensity <= 5
              ? [240, 720, 1200, 1680]
              : [240, 360, 720, 1200, 1320, 1680];
        for (const h of hits) {
          pushChordHit(barStart + h, 110, 4);
        }
      } else if (kbPreset === 'whole_sustain') {
        pushChordHit(barStart, TICKS_PER_BAR - 20, -4);
      } else if (kbPreset === 'floating_tension') {
        pushChordHit(barStart, 940, -6);
        pushChordHit(barStart + 960, 940, -10);
      } else if (kbPreset === 'dark_low_riff') {
        const riffSteps =
          keyboardDensity <= 2
            ? [0, 960]
            : keyboardDensity === 3
              ? [0, 480, 960, 1440]
              : keyboardDensity <= 5
                ? [0, 360, 720, 1200, 1440]
                : [0, 240, 360, 720, 960, 1200, 1440, 1680];
        for (let i = 0; i < riffSteps.length; i++) {
          pushSingleNote(barStart + riffSteps[i], voicing[i % voicing.length], 240, 2);
        }
      } else if (kbPreset === 'rock_power_riff') {
        const rootLow = fitPitchClassToRange(chord.rootSemitone, 48, 59);
        const fifthIv = chord.intervals.includes(6)
          ? 6
          : chord.intervals.includes(8)
            ? 8
            : 7;
        const powerPair =
          keyboardDensity >= 6
            ? [rootLow, rootLow + fifthIv, rootLow + 12]
            : [rootLow, rootLow + fifthIv];
        const riffSteps =
          keyboardDensity === 1
            ? [0]
            : keyboardDensity === 2
              ? [0, 960]
              : keyboardDensity === 3
                ? [0, 480, 960, 1440]
                : keyboardDensity === 4
                  ? [0, 240, 480, 840, 960, 1200, 1440, 1680]
                  : keyboardDensity === 5
                    ? [0, 240, 360, 480, 720, 960, 1200, 1440, 1560, 1680]
                    : [0, 120, 240, 360, 480, 720, 840, 960, 1200, 1320, 1440, 1680];
        for (let i = 0; i < riffSteps.length; i++) {
          const t = barStart + riffSteps[i];
          const dur =
            keyboardDensity === 1
              ? 1820
              : keyboardDensity <= 3
                ? 400
                : riffSteps[i] === 480 || riffSteps[i] === 1440
                  ? 200
                  : 120;
          for (const p of powerPair) {
            pushSingleNote(t, p, dur, riffSteps[i] % 480 === 0 ? 6 : -4);
          }
        }
      } else if (kbPreset === 'funk_16th_clav') {
        const clavSteps =
          keyboardDensity <= 2
            ? [0, 960]
            : keyboardDensity === 3
              ? [0, 480, 960, 1440]
              : keyboardDensity <= 5
                ? [0, 120, 360, 480, 720, 840, 1080, 1200, 1440, 1680]
                : [0, 120, 240, 360, 480, 600, 720, 840, 1080, 1200, 1320, 1440, 1680, 1800];
        for (let i = 0; i < clavSteps.length; i++) {
          pushChordHit(
            barStart + clavSteps[i],
            keyboardDensity <= 3 ? 160 : 75,
            clavSteps[i] % 480 === 0 ? 6 : -6
          );
        }
      } else if (kbPreset === 'counter_melody') {
        const scalePcs = new Set(getScalePitchClasses(song.key, song.scale));
        const highChordTones = voicing.filter((p) => p >= 67 && p <= 86);
        const melodicSteps =
          keyboardDensity <= 2
            ? [0, 960]
            : keyboardDensity === 3
              ? [0, 480, 960, 1440]
              : keyboardDensity <= 5
                ? [0, 480, 720, 960, 1440]
                : [0, 240, 480, 720, 960, 1200, 1440, 1680];
        for (let i = 0; i < melodicSteps.length; i++) {
          const base =
            highChordTones[i % Math.max(1, highChordTones.length)] ?? 72;
          let target = base + (i % 2 === 1 ? 2 : 0);
          while (!scalePcs.has(target % 12) && target > 67) target--;
          pushSingleNote(
            barStart + melodicSteps[i],
            Math.min(86, Math.max(67, target)),
            i === melodicSteps.length - 1 ? 380 : 210,
            4
          );
        }
      } else if (kbPreset === 'gospel_rich_comp') {
        const hits =
          keyboardDensity <= 2
            ? [0, 960]
            : keyboardDensity <= 5
              ? [0, 360, 960, 1320]
              : [0, 240, 360, 720, 960, 1320, 1560];
        for (const h of hits) {
          pushChordHit(barStart + h, keyboardDensity <= 2 ? 440 : 240, h === 0 ? 4 : -2);
        }
        // Passing chord chromatic/diatonic anticipation on beat 4
        const nextChord = resolveChordForBar(
          section.chords,
          bar + 1,
          song.key,
          song.scale
        );
        const approachVoicing = buildKeyboardVoicing(
          nextChord.rootSemitone + 11,
          [0, 3, 7, 10],
          params,
          { forceFloating: true }
        );
        for (const p of approachVoicing) {
          pushSingleNote(barStart + 1680, p, 200, -4);
        }
      } else if (kbPreset === 'fusion_ep_comp') {
        // Rich 9th/11th/13th electric piano comping hitting 16th syncopations
        const epVoicing = buildKeyboardVoicing(
          chord.rootSemitone,
          [...chord.intervals, 10, 14, 17, 21],
          params,
          { minPitch: 58, maxPitch: 84, forceFloating: true }
        );
        const epSteps =
          keyboardDensity <= 2
            ? [0, 960]
            : keyboardDensity === 3
              ? [0, 360, 960, 1320]
              : keyboardDensity <= 5
                ? [0, 360, 600, 840, 1200, 1320, 1560]
                : [0, 120, 360, 600, 840, 960, 1200, 1320, 1560, 1800];
        for (const off of epSteps) {
          const velOff = off === 360 || off === 840 || off === 1320 ? 6 : -4;
          for (const p of epVoicing) {
            pushSingleNote(barStart + off, p, keyboardDensity <= 2 ? 420 : 145, velOff);
          }
        }
      } else if (kbPreset === 'fusion_brass_stab') {
        // Sharp horn-section stabs: short 35-45% beat gate (95..140 ticks) + punchy rests
        const stabSteps =
          keyboardDensity <= 2
            ? [0, 960]
            : keyboardDensity === 3
              ? [0, 480, 960, 1440]
              : keyboardDensity <= 5
                ? [0, 360, 720, 1200]
                : [0, 240, 360, 720, 1080, 1200, 1560];
        const stabDur = keyboardDensity <= 2 ? 180 : 105; // ~44% of 240 ticks
        for (const off of stabSteps) {
          pushChordHit(barStart + off, stabDur, 10);
        }
      } else if (kbPreset === 'electronica_glitch_arp') {
        // C5..C6 (72..84) crystal arpeggio with seeded irregular dropouts and 16th double triggers
        const crystal = buildKeyboardVoicing(
          chord.rootSemitone,
          [...chord.intervals, 12, 14],
          params,
          { minPitch: 72, maxPitch: 84, forceFloating: true }
        );
        const pool = crystal.length > 0 ? crystal : [72, 76, 79, 84];
        const gridTicks =
          keyboardDensity <= 2 ? [0, 960] : keyboardDensity === 3 ? [0, 480, 960, 1440] : Array.from({ length: 8 }, (_, s) => s * 240);
        for (let i = 0; i < gridTicks.length; i++) {
          const off = gridTicks[i];
          if (keyboardDensity >= 3 && i > 0 && rng.chance(0.25)) continue; // Glitch rest dropout
          const p = pool[(i + rng.nextInt(0, pool.length - 1)) % pool.length];
          pushSingleNote(barStart + off, p, 110, 2);
          // Irregular 16th double-trigger burst
          if (keyboardDensity >= 4 && rng.chance(keyboardDensity >= 6 ? 0.65 : 0.4)) {
            const subOff = off + 120;
            if (subOff < TICKS_PER_BAR) {
              pushSingleNote(barStart + subOff, pool[(i + 1) % pool.length], 85, -6);
            }
          }
        }
      } else if (kbPreset === 'electronica_minimal_ostinato') {
        // Tight 3-4 pitch minimal motif repeating relentlessly
        const ostPool = buildKeyboardVoicing(
          chord.rootSemitone,
          [0, chord.intervals[1] ?? 3, 7],
          params,
          { minPitch: 60, maxPitch: 79 }
        ).slice(0, 4);
        const motif = ostPool.length > 0 ? ostPool : [60, 63, 67];
        const stepCount =
          keyboardDensity === 1
            ? 2
            : keyboardDensity === 2
              ? 4
              : keyboardDensity === 3
                ? 6
                : keyboardDensity <= 5
                  ? 8
                  : 16;
        const stepSize = Math.floor(TICKS_PER_BAR / stepCount);
        for (let i = 0; i < stepCount; i++) {
          pushSingleNote(
            barStart + i * stepSize,
            motif[i % motif.length],
            Math.max(70, stepSize - 35),
            i % motif.length === 0 ? 6 : -4
          );
        }
      } else if (kbPreset === 'disco_boogie_bounce') {
        // Call-and-response funky chord chops ("Chaka-Cha!") in C4..E5 (60..76)
        // with 7th/9th/13th voicing, leaving beats 1 (0) & 3 (960) clear for Bass low root!
        const funkyVoicing = buildKeyboardVoicing(
          chord.rootSemitone,
          [...chord.intervals, 10, 14, 21],
          params,
          { minPitch: 60, maxPitch: 76, forceFloating: true }
        );
        const chopPool = funkyVoicing.length > 0 ? funkyVoicing : voicing;
        // Beats 2 & 4 pocket response chops (never on 0 or 960), scaled by keyboardDensity 1..7
        const chopSteps =
          keyboardDensity <= 2
            ? [480, 1440]
            : keyboardDensity === 3
              ? [480, 600, 1440, 1560]
              : keyboardDensity === 4
                ? [480, 600, 720, 1320, 1440]
                : keyboardDensity === 5
                  ? [360, 480, 600, 840, 1320, 1440, 1680]
                  : [240, 360, 480, 600, 840, 1200, 1320, 1440, 1560, 1680];
        const chopGate = 50; // ~42% of 120-tick 16th step (short crisp staccato cutting)
        for (const off of chopSteps) {
          const velOff = off === 480 || off === 1440 ? 8 : -2;
          for (const p of chopPool) {
            pushSingleNote(barStart + off, p, chopGate, velOff);
          }
        }
      } else if (kbPreset === 'jrock_anticipation') {
        // Current bar chord hits (omitting beat 1 on bar > 0 to let the 1680 anticipation ring across)
        const bodyHits =
          bar === 0
            ? keyboardDensity <= 2
              ? [0, 960]
              : keyboardDensity >= 4
                ? [0, 240, 480, 720, 960, 1200, 1440]
                : [0, 480, 960, 1440]
            : keyboardDensity <= 2
              ? [960]
              : keyboardDensity >= 4
                ? [240, 480, 720, 960, 1200, 1440]
                : [480, 960, 1440];
        const bodyDur = keyboardDensity <= 2 ? 620 : keyboardDensity >= 4 ? 200 : 380;
        for (const h of bodyHits) {
          pushChordHit(barStart + h, bodyDur, h === 0 ? 4 : 0);
        }

        // Beat 4-and (1680): strike next bar's chord voicing without jitter and sustain past barline
        const nextChord = resolveChordForBar(
          section.chords,
          bar + 1,
          song.key,
          song.scale
        );
        const nextVoicing = buildKeyboardVoicing(
          nextChord.rootSemitone,
          nextChord.intervals,
          params
        );
        const antTick = barStart + 1680;
        if (antTick < sectionEnd) {
          const antDur = Math.max(1, Math.min(680, sectionEnd - antTick));
          for (const p of nextVoicing) {
            pushSingleNote(antTick, p, antDur, 8);
          }
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

  // Timeline chord boundary & offbeat anticipation sync
  if (timelineChanges.length > 0 && kbPreset !== 'jrock_anticipation') {
    for (const change of timelineChanges) {
      const changeTick = change.changeTick;
      // 1. Cut pre-existing chord notes cleanly before changeTick - 5 to avoid chord clash
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

      if (change.isOffbeat) {
        // Clear notes in [changeTick, changeTick + 240] so the anticipated voicing rings cleanly across barline
        for (let i = notes.length - 1; i >= 0; i--) {
          const n = notes[i];
          if (n.startTick >= changeTick && n.startTick <= changeTick + 240) {
            notes.splice(i, 1);
          }
        }

        const nextVoicing = buildKeyboardVoicing(
          change.parsed.rootSemitone,
          change.parsed.intervals,
          params,
          voicingOptions
        );
        const antDur = Math.max(
          120,
          Math.min(680, change.endTick - changeTick - 5, sectionEnd - changeTick)
        );
        for (const p of nextVoicing) {
          notes.push({
            pitch: p,
            velocity: clampVelocity(
              Math.min(params.velocityCap, baseVel + 8 + params.velocityBoost)
            ),
            startTick: changeTick,
            durationTicks: antDur,
            channel: 1,
          });
        }
      } else if (changeTick % TICKS_PER_BAR !== 0) {
        // Regular mid-bar ChordSlot split (e.g. beat 3 split): ensure new voicing triggers only if remainder of bar has no notes (e.g. whole_sustain)
        const nextBarTick = (Math.floor(changeTick / TICKS_PER_BAR) + 1) * TICKS_PER_BAR;
        const slotWindowEnd = Math.min(change.endTick, nextBarTick);
        const hasHitInSlotWindow = notes.some(
          (n) => n.startTick >= changeTick && n.startTick < slotWindowEnd
        );
        if (!hasHitInSlotWindow) {
          const splitVoicing = buildKeyboardVoicing(
            change.parsed.rootSemitone,
            change.parsed.intervals,
            params,
            voicingOptions
          );
          const splitDur = Math.max(
            120,
            Math.min(change.endTick - changeTick - 10, sectionEnd - changeTick)
          );
          for (const p of splitVoicing) {
            notes.push({
              pitch: p,
              velocity: clampVelocity(
                Math.min(params.velocityCap, baseVel + params.velocityBoost)
              ),
              startTick: changeTick,
              durationTicks: splitDur,
              channel: 1,
            });
          }
        }
      }
    }
  }

  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  return notes;
}
