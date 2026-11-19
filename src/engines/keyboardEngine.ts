import { TICKS_PER_BAR, type MidiNote } from '../types/song';
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
  if (
    !song.members.keyboard.enabled ||
    section.enabledParts?.keyboard === false
  ) {
    return [];
  }

  const rng = createSeededRng(seed);
  const sectionEnd = section.bars * TICKS_PER_BAR;
  const playStyle = song.members.keyboard.keyboardStyle ?? 'Rhythm Backing';
  const kbPreset = song.members.keyboard.patternPreset ?? 'auto';
  const keyboardDensity = input.keyboardDensity ?? section.keyboardDensity ?? 3;
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
        : kbPreset === 'rock_power_riff'
          ? { minPitch: 48, maxPitch: 67 }
          : kbPreset === 'floating_tension' ||
              kbPreset === 'emo_arp_cascade' ||
              kbPreset === 'gospel_rich_comp'
            ? { forceFloating: true }
            : kbPreset === 'counter_melody'
              ? { minPitch: 67, maxPitch: 86 }
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
      const isArpPreset =
        kbPreset === 'arp_up' ||
        kbPreset === 'arp_down_up' ||
        kbPreset === 'arp_16th' ||
        kbPreset === 'broken_chord' ||
        kbPreset === 'emo_arp_cascade' ||
        kbPreset === 'synth_pluck_arp';

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
        }

        // Level 4 & 5 expand arpeggio pattern up an octave for brighter spread
        if (keyboardDensity >= 4) {
          const upper = voicing
            .map((p) => p + 12)
            .filter((p) => p <= 96);
          if (upper.length > 0) {
            arpOrder = [...arpOrder, ...upper.slice(0, 2)];
          }
        }

        const isPluck = kbPreset === 'synth_pluck_arp';
        const stepOffsets =
          keyboardDensity === 1
            ? [0, 960] // 2 notes/bar (half notes, long sustain)
            : keyboardDensity === 2
              ? [0, 480, 960, 1440] // 4 notes/bar (quarter notes)
              : keyboardDensity === 3
                ? [0, 240, 480, 720, 960, 1200, 1440, 1680] // 8 notes/bar (8th notes)
                : keyboardDensity === 4
                  ? [0, 240, 360, 480, 720, 840, 960, 1200, 1320, 1440, 1680, 1800] // 12 notes/bar (8th + 16th syncopations)
                  : Array.from({ length: 16 }, (_, s) => s * 120); // 16 notes/bar (16th sequence)

        const arpDur =
          keyboardDensity === 1
            ? 900
            : keyboardDensity === 2
              ? isPluck
                ? 180
                : 440
              : keyboardDensity === 3
                ? isPluck
                  ? 65
                  : 220
                : keyboardDensity === 4
                  ? isPluck
                    ? 65
                    : 150
                  : isPluck
                    ? 65
                    : 105;

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
        continue;
      }

      if (kbPreset === 'chord_quarter') {
        const hits =
          keyboardDensity === 1
            ? [0]
            : keyboardDensity === 2
              ? [0, 960]
              : keyboardDensity >= 4
                ? [0, 240, 480, 720, 960, 1200, 1440, 1680]
                : [0, 480, 960, 1440];
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
              ? [0, 480, 960, 1440]
              : keyboardDensity >= 4
                ? [0, 120, 240, 480, 720, 840, 960, 1200, 1320, 1440, 1680, 1800]
                : [0, 240, 480, 720, 960, 1200, 1440, 1680];
        for (const h of hits) {
          pushChordHit(
            barStart + h,
            keyboardDensity === 1 ? 1860 : keyboardDensity === 2 ? 420 : keyboardDensity >= 4 ? 95 : 140,
            h % 480 === 0 ? 2 : -6
          );
        }
      } else if (kbPreset === 'syncopated_comp') {
        const hits =
          keyboardDensity <= 2
            ? [0, 960]
            : keyboardDensity >= 4
              ? [0, 240, 360, 720, 840, 1200, 1440, 1560]
              : [0, 360, 720, 1200, 1560];
        for (const h of hits) {
          pushChordHit(barStart + h, keyboardDensity <= 2 ? 440 : 200, h === 0 ? 4 : -2);
        }
      } else if (kbPreset === 'offbeat_ska') {
        const hits =
          keyboardDensity === 1
            ? [480, 1440]
            : keyboardDensity >= 4
              ? [240, 360, 720, 1200, 1320, 1680]
              : [240, 720, 1200, 1680];
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
            : keyboardDensity >= 4
              ? [0, 240, 360, 720, 960, 1200, 1440, 1680]
              : [0, 360, 720, 1200, 1440];
        for (let i = 0; i < riffSteps.length; i++) {
          pushSingleNote(barStart + riffSteps[i], voicing[i % voicing.length], 240, 2);
        }
      } else if (kbPreset === 'rock_power_riff') {
        const rootLow = fitPitchClassToRange(chord.rootSemitone, 48, 59);
        const powerPair =
          keyboardDensity >= 4
            ? [rootLow, rootLow + 7, rootLow + 12]
            : [rootLow, rootLow + 7];
        const riffSteps =
          keyboardDensity === 1
            ? [0]
            : keyboardDensity === 2
              ? [0, 480, 960, 1440]
              : keyboardDensity >= 4
                ? [0, 120, 240, 360, 480, 720, 840, 960, 1200, 1320, 1440, 1680]
                : [0, 240, 480, 840, 960, 1200, 1440, 1680];
        for (let i = 0; i < riffSteps.length; i++) {
          const t = barStart + riffSteps[i];
          const dur =
            keyboardDensity === 1
              ? 1820
              : keyboardDensity === 2
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
            ? [0, 480, 960, 1440]
            : keyboardDensity >= 4
              ? [0, 120, 240, 360, 480, 600, 720, 840, 1080, 1200, 1320, 1440, 1680, 1800]
              : [0, 120, 360, 480, 720, 840, 1080, 1200, 1440, 1680];
        for (let i = 0; i < clavSteps.length; i++) {
          pushChordHit(
            barStart + clavSteps[i],
            keyboardDensity <= 2 ? 160 : 75,
            clavSteps[i] % 480 === 0 ? 6 : -6
          );
        }
      } else if (kbPreset === 'counter_melody') {
        const scalePcs = new Set(getScalePitchClasses(song.key, song.scale));
        const highChordTones = voicing.filter((p) => p >= 67 && p <= 86);
        const melodicSteps =
          keyboardDensity <= 2
            ? [0, 960]
            : keyboardDensity >= 4
              ? [0, 240, 480, 720, 960, 1200, 1440, 1680]
              : [0, 480, 720, 960, 1440];
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
            : keyboardDensity >= 4
              ? [0, 240, 360, 720, 960, 1320, 1560]
              : [0, 360, 960, 1320];
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
