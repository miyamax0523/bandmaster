import { describe, expect, it, vi } from 'vitest';
import {
  adaptNotesForExportTarget,
  BAR_TICKS,
  buildPitchTrajectoryPlan,
  computeWeightedTessitura,
  generateRhythmFirstVocal,
  PHRASE_2BAR_TICKS,
  RHYTHM_FIRST_GENRE_PROFILES,
  scheduleWebAudioFall,
  type GeneratedVocalNote,
} from '../src/engines/vocalEngine';
import { createDefaultSongConfig, generateAllSections } from '../src/lib/bandState';
import { createUniformChordTimeline } from '../src/lib/chordTimeline';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import { type MasterGenreId } from '../src/lib/masterGenres';
import { buildVocalSmfTrack, exportMultiTrackMidi } from '../src/lib/midiExport';
import { parseMidiFile } from '../src/lib/midiParser';
import { type Section } from '../src/types/song';

const FIVE_MASTER_GENRES: readonly MasterGenreId[] = [
  'alt_shoegaze',
  'emo_jrock',
  'numetal_mixture',
  'royal_jpop',
  'chill_ballad',
];

describe('vocalEngine Rhythm-First Quantitative Quality Suite (5 Genres x 50 Seeds = 250 Sections)', () => {
  it('passes 100% of all 10 quantitative quality metrics across 5 genres x 50 seeds (250 8-bar sections) with zero Math.random()', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const sectionTypes: ReadonlyArray<Section['type']> = [
      'Verse',
      'Pre-Chorus',
      'Chorus',
      'Bridge',
    ];

    try {
      let totalEvaluatedSections = 0;

      for (const genreId of FIVE_MASTER_GENRES) {
        const profile = RHYTHM_FIRST_GENRE_PROFILES[genreId];
        let genreFallNotes = 0;

        for (let seedIdx = 1; seedIdx <= 50; seedIdx++) {
          const seed = seedIdx * 7919 + FIVE_MASTER_GENRES.indexOf(genreId) * 101;
          const sType = sectionTypes[(seedIdx - 1) % sectionTypes.length];
          const song = createDefaultSongConfig(genreId);
          const bars = 8;
          const totalSectionTicks = bars * BAR_TICKS;

          const section: Section = {
            id: `qual-${genreId}-${seedIdx}`,
            type: sType,
            name:
              sType === 'Verse'
                ? 'Aメロ'
                : sType === 'Pre-Chorus'
                  ? 'Bメロ'
                  : sType === 'Chorus'
                    ? 'サビ'
                    : 'Cメロ',
            bars,
            energy: sType === 'Chorus' ? 'High' : sType === 'Verse' ? 'Low' : 'Mid',
            kickMode: genreId === 'numetal_mixture' ? '808' : 'acoustic',
            vocalDensity: 3.0,
            patternPresets: {
              ...song.members,
              drums: song.members.drums.patternPreset ?? 'auto',
              bass: song.members.bass.patternPreset ?? 'auto',
              keyboard: song.members.keyboard.patternPreset ?? 'auto',
              pad: song.members.pad.patternPreset ?? 'auto',
              vocal: genreId,
            },
            chords: createUniformChordTimeline(['C', 'G', 'Am', 'F'], bars),
          };

          const params = resolveInstrumentParams(song, section, 'vocal', 'A');
          randomSpy.mockClear();
          const res = generateRhythmFirstVocal({
            song,
            section,
            sectionIndex: 0,
            style: 'A',
            seed,
            params,
            masterGenreId: genreId,
          });
          expect(randomSpy).not.toHaveBeenCalled();

          // Determinism check
          if (seedIdx <= 3) {
            const replay = generateRhythmFirstVocal({
              song,
              section,
              sectionIndex: 0,
              style: 'A',
              seed,
              params,
              masterGenreId: genreId,
            });
            expect(replay.notes).toEqual(res.notes);
          }

          const { notes, trajectory } = res;
          expect(notes.length).toBeGreaterThan(0);
          expect(trajectory.phrases.length).toBe(4);
          expect(trajectory.phrases.map((p) => p.anchorOffsetSemitones)).toEqual([
            0, 2, 3, 1,
          ]);

          // Group notes by 2-bar phrase (3840 ticks)
          const phraseBuckets: GeneratedVocalNote[][] = [[], [], [], []];
          for (const n of notes) {
            const pIdx = Math.floor(n.startTick / PHRASE_2BAR_TICKS);
            expect(pIdx).toBeGreaterThanOrEqual(0);
            expect(pIdx).toBeLessThan(4);
            phraseBuckets[pIdx].push(n);
            if (n.hasFall) genreFallNotes++;
          }

          // Verify A -> A' identical RhythmGateCell timing & gridDuration on Phrase 0 vs Phrase 1
          expect(
            phraseBuckets[1].map((n) => ({
              rel: n.startTick - PHRASE_2BAR_TICKS,
              grid: n.gridDuration,
              gate: n.gateDuration,
            }))
          ).toEqual(
            phraseBuckets[0].map((n) => ({
              rel: n.startTick,
              grid: n.gridDuration,
              gate: n.gateDuration,
            }))
          );

          const phraseTessituras: number[] = [];
          const phraseTopNotes: number[] = [];

          for (let p = 0; p < 4; p++) {
            const pNotes = phraseBuckets[p];
            const pPlan = trajectory.phrases[p];
            expect(pNotes.length).toBeGreaterThanOrEqual(2);

            const pitches = pNotes.map((n) => n.midiPitch);
            const onsetPitch = pitches[0];
            const minPitch = Math.min(...pitches);
            const maxPitch = Math.max(...pitches);

            // Metric 1: Phrase-end upward leap constraint
            const endDelta = pitches[pitches.length - 1] - pitches[pitches.length - 2];
            if (!pPlan.isRunway) {
              expect(endDelta).toBeLessThanOrEqual(0);
              expect(endDelta).toBeGreaterThanOrEqual(-4);
            } else {
              expect(endDelta).toBeLessThanOrEqual(profile.maxPhraseEndUpwardLeap);
              expect(endDelta).toBeGreaterThanOrEqual(-4);
            }

            // Metric 2: Max rise from phrase onset
            for (const pitch of pitches) {
              expect(pitch - onsetPitch).toBeLessThanOrEqual(profile.maxRiseFromOnset);
            }

            // Metric 3: Total phrase ambitus
            expect(maxPitch - minPitch).toBeLessThanOrEqual(profile.maxPhraseAmbitus);

            // Metric 4: Unique pitches per phrase
            expect(new Set(pitches).size).toBeLessThanOrEqual(
              profile.maxUniquePitchesPerPhrase
            );

            phraseTessituras.push(computeWeightedTessitura(pNotes));
            phraseTopNotes.push(maxPitch);
          }

          // Metric 5 & Metric 6: Adjacent phrase tessitura & top-note continuity
          for (let p = 1; p < 4; p++) {
            expect(
              Math.abs(phraseTessituras[p] - phraseTessituras[p - 1])
            ).toBeLessThanOrEqual(profile.maxAdjacentTessituraJump);
            expect(
              Math.abs(phraseTopNotes[p] - phraseTopNotes[p - 1])
            ).toBeLessThanOrEqual(profile.maxAdjacentTopNoteJump);
          }

          // Metric 7: Continuous bar-to-bar average pitch continuity
          const barAvgs: number[] = [];
          for (let b = 0; b < bars; b++) {
            const barStart = b * BAR_TICKS;
            const barEnd = barStart + BAR_TICKS;
            const bNotes = notes.filter(
              (n) => n.startTick >= barStart && n.startTick < barEnd
            );
            if (bNotes.length > 0) {
              const avg =
                bNotes.reduce((s, n) => s + n.midiPitch, 0) / bNotes.length;
              barAvgs.push(avg);
            }
          }
          for (let b = 1; b < barAvgs.length; b++) {
            expect(Math.abs(barAvgs[b] - barAvgs[b - 1])).toBeLessThanOrEqual(
              profile.maxAdjacentTessituraJump + 1.0
            );
          }

          // Metric 8: Duration contrast ratio (>= minDurationContrast)
          const gridDurs = notes.map((n) => n.gridDuration);
          const gateDurs = notes.map((n) => n.gateDuration);
          const gridContrast = Math.max(...gridDurs) / Math.min(...gridDurs);
          const gateContrast = Math.max(...gateDurs) / Math.min(...gateDurs);
          expect(gridContrast).toBeGreaterThanOrEqual(profile.minDurationContrast);
          expect(gateContrast).toBeGreaterThanOrEqual(profile.minDurationContrast);

          // Metric 9: Effective silence (breath + gate-off) ratio (>= minRestAndGateOffRatio)
          const totalGateSounded = notes.reduce((s, n) => s + n.gateDuration, 0);
          const effectiveSilenceRatio = 1 - totalGateSounded / totalSectionTicks;
          expect(effectiveSilenceRatio).toBeGreaterThanOrEqual(
            profile.minRestAndGateOffRatio
          );

          // Metric 10: Dual Export Target Safety (Cubase Expressive PB & VoiSona Clean)
          const cubaseAdapted = adaptNotesForExportTarget(
            notes,
            'cubase_smf_expressive'
          );
          if (cubaseAdapted.pitchBends.length > 0) {
            expect(
              cubaseAdapted.pitchBends[cubaseAdapted.pitchBends.length - 1]
                .value14Bit
            ).toBe(8192);
            for (let i = 1; i < cubaseAdapted.pitchBends.length; i++) {
              expect(cubaseAdapted.pitchBends[i].tick).toBeGreaterThanOrEqual(
                cubaseAdapted.pitchBends[i - 1].tick
              );
            }
            for (const pb of cubaseAdapted.pitchBends) {
              expect(pb.value14Bit).toBeGreaterThanOrEqual(0);
              expect(pb.value14Bit).toBeLessThanOrEqual(16383);
            }
          }

          const voisonaAdapted = adaptNotesForExportTarget(
            notes,
            'voisona_clean_smf'
          );
          expect(voisonaAdapted.pitchBends.length).toBe(0);
          for (let i = 0; i < voisonaAdapted.notes.length; i++) {
            const vn = voisonaAdapted.notes[i];
            expect(vn.hasFall).toBe(false);
            expect(vn.gateDuration).toBeGreaterThanOrEqual(120);
            if (i + 1 < voisonaAdapted.notes.length) {
              const gap =
                voisonaAdapted.notes[i + 1].startTick -
                (vn.startTick + vn.gateDuration);
              expect(gap >= 0 && (gap === 0 || gap >= 180)).toBe(true);
            }
          }

          totalEvaluatedSections++;
        }

        // Across 50 seeds, every genre emits top-note fall expressions
        expect(genreFallNotes).toBeGreaterThan(0);
      }

      expect(totalEvaluatedSections).toBe(250);
      expect(randomSpy).not.toHaveBeenCalled();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('verifies 16-bar macro trajectory [0,+1,+2,+2,+3,+4,+3,+1], section shifts, RPN 0,0 SMF bytes, and Web Audio detune curve', () => {
    // 1. 16-bar trajectory & section shifts per genre
    const expectedShifts: Record<MasterGenreId, [number, number, number, number]> = {
      alt_shoegaze: [0, 2, 4, 3],
      emo_jrock: [0, 3, 6, 4],
      numetal_mixture: [0, 2, 5, 3],
      royal_jpop: [0, 3, 7, 5],
      chill_ballad: [0, 2, 5, 3],
    };

    for (const genreId of FIVE_MASTER_GENRES) {
      const roles = ['verse', 'pre_chorus', 'chorus', 'bridge'] as const;
      const actualShifts = roles.map(
        (r) => buildPitchTrajectoryPlan(genreId, r, 16, 58).sectionShiftSemitones
      );
      expect(actualShifts).toEqual(expectedShifts[genreId]);

      const plan16 = buildPitchTrajectoryPlan(genreId, 'chorus', 16, 58);
      expect(plan16.phrases.map((p) => p.anchorOffsetSemitones)).toEqual([
        0, 1, 2, 2, 3, 4, 3, 1,
      ]);
      expect(plan16.phrases.map((p) => p.isRunway)).toEqual([
        true,
        true,
        false,
        true,
        true,
        false,
        false,
        false,
      ]);
    }

    // 2. Round-trip SMF binary verification for Cubase Expressive vs VoiSona Clean
    const song = createDefaultSongConfig('alt_shoegaze');
    song.sections = [
      {
        id: 'sec-fall-check',
        type: 'Chorus',
        name: 'Chorus',
        bars: 8,
        energy: 'High',
        kickMode: 'acoustic',
        chords: createUniformChordTimeline(['Em', 'C', 'G', 'D'], 8),
        patternPresets: {
          drums: 'halftime_heavy',
          bass: 'auto',
          keyboard: 'floating_tension',
          pad: 'floating_9th',
          vocal: 'alt_shoegaze',
        },
      },
    ];
    const bandState = generateAllSections(song, undefined, 2026, true);

    const cubaseSmf = exportMultiTrackMidi(song, bandState, {
      exportTarget: 'cubase_smf_expressive',
    });
    const parsedCubase = parseMidiFile(cubaseSmf.bytes);
    const cubaseVocalTrack = parsedCubase.tracks.find((t) => t.name === 'Vocal')!;
    expect(cubaseVocalTrack).toBeDefined();

    // Verify RPN 0,0 Pitch Bend Sensitivity at tick 0: 101=0, 100=0, 6=4, 38=0, 101=127, 100=127
    expect(cubaseVocalTrack.controlChanges.slice(0, 6)).toEqual([
      { tick: 0, controller: 101, value: 0, channel: 4 },
      { tick: 0, controller: 100, value: 0, channel: 4 },
      { tick: 0, controller: 6, value: 4, channel: 4 },
      { tick: 0, controller: 38, value: 0, channel: 4 },
      { tick: 0, controller: 101, value: 127, channel: 4 },
      { tick: 0, controller: 100, value: 127, channel: 4 },
    ]);
    if (cubaseVocalTrack.pitchBends.length > 0) {
      expect(
        cubaseVocalTrack.pitchBends[cubaseVocalTrack.pitchBends.length - 1]
          .value14Bit
      ).toBe(8192);
    }

    const voisonaSmf = exportMultiTrackMidi(song, bandState, {
      exportTarget: 'voisona_clean_smf',
    });
    const parsedVoisona = parseMidiFile(voisonaSmf.bytes);
    const voisonaVocalTrack = parsedVoisona.tracks.find((t) => t.name === 'Vocal')!;
    expect(voisonaVocalTrack.pitchBends).toEqual([]);
    expect(voisonaVocalTrack.controlChanges).toEqual([]);
    for (let i = 0; i + 1 < voisonaVocalTrack.notes.length; i++) {
      const curr = voisonaVocalTrack.notes[i];
      const next = voisonaVocalTrack.notes[i + 1];
      expect(curr.durationTicks).toBeGreaterThanOrEqual(120);
      const gap = next.startTick - (curr.startTick + curr.durationTicks);
      expect(gap === 0 || gap >= 180).toBe(true);
    }

    // Standalone buildVocalSmfTrack fallback test
    const fallbackRes = buildVocalSmfTrack(
      [
        {
          startTick: 0,
          gridDuration: 720,
          gateDuration: 660,
          midiPitch: 64,
          velocity: 100,
          role: 'top_fall',
          hasFall: true,
          fallConfig: RHYTHM_FIRST_GENRE_PROFILES.alt_shoegaze.fallConfig,
        },
      ],
      'non_pb_synth_fallback'
    );
    expect(fallbackRes.pitchBends).toEqual([]);
    expect(fallbackRes.adaptedNotes.length).toBe(2);
    expect(fallbackRes.adaptedNotes[1].midiPitch).toBe(62);

    // 3. Web Audio cubic ease-in fall scheduling & +0.005s reset
    const setValueAtTime = vi.fn();
    const setValueCurveAtTime = vi.fn();
    const mockOsc = {
      detune: {
        setValueAtTime,
        setValueCurveAtTime,
      },
    } as unknown as OscillatorNode;

    scheduleWebAudioFall(
      mockOsc,
      1.0,
      0.8,
      RHYTHM_FIRST_GENRE_PROFILES.alt_shoegaze.fallConfig
    );
    expect(setValueAtTime).toHaveBeenNthCalledWith(1, 0, 1.0);
    expect(setValueCurveAtTime).toHaveBeenCalledTimes(1);
    const [curve, fallStartSec, fallDurSec] = setValueCurveAtTime.mock.calls[0] as [
      Float32Array,
      number,
      number,
    ];
    expect(curve.length).toBe(32);
    expect(curve[0]).toBeCloseTo(0, 5);
    expect(curve[31]).toBeCloseTo(-350, 3); // -3.5st * 100 cents
    expect(fallDurSec).toBeCloseTo(0.8 * 0.38, 5);
    expect(fallStartSec).toBeCloseTo(1.0 + 0.8 - 0.8 * 0.38, 5);
    expect(setValueAtTime).toHaveBeenNthCalledWith(2, 0, expect.closeTo(1.805, 5));
  });
});
