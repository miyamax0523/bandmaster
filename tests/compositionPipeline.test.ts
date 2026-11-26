import { describe, expect, it, vi } from 'vitest';
import {
  analyzeParsedChordToEvent,
  generateGenreHarmonySection,
} from '../src/engines/harmonyEngine';
import { generateKeyboardSkeletonTrack } from '../src/engines/keyboardEngine';
import {
  buildCustomVocalVoiceProfile,
  computeBassIntegratedLilPenalty,
  midiToSpnLabel,
  parseCustomChordProgression,
  suggestChords,
  VOCAL_VOICE_PROFILES,
} from '../src/engines/musicCore';
import { generatePadSkeletonTrack } from '../src/engines/padEngine';
import {
  resolveEffectiveChord,
  validateVoisonaVocalNotes,
} from '../src/engines/vocalEngine';
import {
  generateAllSections,
  inferCustomChordsFromOverrideBass,
  lockCurrentChordsToCustom,
  setSectionAccompanimentSkeleton,
  setSectionBassMidiOverride,
  setSectionChordLock,
  setSongVocalVoiceProfile,
} from '../src/lib/bandState';
import {
  inferPowerChordProgressionFromBassNotes,
  normalizeOverrideBassNotes,
} from '../src/lib/riffProcessor';
import { createUniformChordTimeline } from '../src/lib/chordTimeline';
import { parseChord } from '../src/lib/chordUtils';
import { resolveInstrumentParams } from '../src/lib/keywordParser';
import type { MasterGenreId } from '../src/lib/masterGenres';
import { parseMidiFile } from '../src/lib/midiParser';
import { exportMultiTrackMidi } from '../src/lib/multiTrackMidiExport';
import { TICKS_PER_BAR, type MidiNote } from '../src/types/song';
import { buildSongFromQuickSetup } from '../src/utils/quickSongBuilder';

const FIVE_GENRES: readonly MasterGenreId[] = [
  'royal_jpop',
  'emo_jrock',
  'chill_ballad',
  'alt_shoegaze',
  'numetal_mixture',
];

describe('BANDMASTER 4-Stage Composition Pipeline (Harmony -> Vocal -> Voicing -> VoiSona/Cubase SMF)', () => {
  it('1. Determinism & Sub-Seed Isolation: identical seed matches 100%, keyboard edits preserve Stage 1 & 2, voice profile edits preserve Stage 1 harmony', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    try {
      const song1 = buildSongFromQuickSetup(
        {
          keyRoot: 'C',
          scaleType: 'Major',
          bpm: 132,
          genre: 'royal_jpop',
          songLength: 'short_loop',
          structureTemplate: 'short_ab',
          chordPreset: 'auto_by_genre',
        },
        2026
      );
      const song2 = buildSongFromQuickSetup(
        {
          keyRoot: 'C',
          scaleType: 'Major',
          bpm: 132,
          genre: 'royal_jpop',
          songLength: 'short_loop',
          structureTemplate: 'short_ab',
          chordPreset: 'auto_by_genre',
        },
        2026
      );

      expect(song1.vocalVoiceProfileId).toBe('chisa_jp');
      expect(song1.sections.map((s) => s.chords)).toEqual(
        song2.sections.map((s) => s.chords)
      );

      const state1 = generateAllSections(song1, undefined, 4242, true);
      const state2 = generateAllSections(song2, undefined, 4242, true);
      expect(state1).toEqual(state2);

      // Changing Keyboard skeleton in Chorus NEVER alters Stage 1 chords or Stage 2 vocal
      const chorusId = song1.sections[1].id;
      const afterKbEdit = setSectionAccompanimentSkeleton(
        song1,
        state1,
        chorusId,
        'keyboard',
        'ARPEGGIO_8TH_16TH'
      );
      expect(afterKbEdit.song.sections[1].chords).toEqual(song1.sections[1].chords);
      expect(afterKbEdit.bandState.cellsBySection[chorusId].vocal).toEqual(
        state1.cellsBySection[chorusId].vocal
      );

      // Switching VocalVoiceProfile (chisa_jp -> male_rock) preserves Stage 1 chords & drums/bass untouched
      const afterVoiceEdit = setSongVocalVoiceProfile(song1, state1, {
        vocalVoiceProfileId: 'male_rock',
      });
      expect(afterVoiceEdit.song.vocalVoiceProfileId).toBe('male_rock');
      expect(afterVoiceEdit.song.sections.map((s) => s.chords)).toEqual(
        song1.sections.map((s) => s.chords)
      );
      expect(afterVoiceEdit.bandState.cellsBySection[chorusId].drums).toEqual(
        state1.cellsBySection[chorusId].drums
      );
      expect(afterVoiceEdit.bandState.cellsBySection[chorusId].bass).toEqual(
        state1.cellsBySection[chorusId].bass
      );
      // Vocal register shifts lower for male_rock (49..73) vs chisa_jp (55..74)
      const chisaVocal = state1.cellsBySection[chorusId].vocal.takes.A;
      const maleVocal = afterVoiceEdit.bandState.cellsBySection[chorusId].vocal.takes.A;
      const avgPitch = (arr: MidiNote[]) =>
        arr.reduce((s, n) => s + n.pitch, 0) / Math.max(1, arr.length);
      expect(avgPitch(maleVocal)).toBeLessThan(avgPitch(chisaVocal));

      expect(randomSpy).not.toHaveBeenCalled();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('2. Strict Voice Profile Range Conformance: chisa_jp (55-74), female_high (56-77), male_rock (49-73), custom (>=12st guard), SPN C4=60, and <=240t chord anticipation', () => {
    expect(midiToSpnLabel(60)).toBe('C4');
    expect(midiToSpnLabel(55)).toBe('G3');
    expect(midiToSpnLabel(74)).toBe('D5');

    // Custom < 12 semitone span guard
    const guardedCustom = buildCustomVocalVoiceProfile(62, 66);
    expect(guardedCustom.minMidi).toBe(62);
    expect(guardedCustom.maxMidi).toBe(74); // Expanded to >= +12st
    expect(guardedCustom.optimalTessituraCenter).toBe(68);

    const profilesToTest = [
      { id: 'chisa_jp' as const, min: 55, max: 74 },
      { id: 'female_high' as const, min: 56, max: 77 },
      { id: 'male_rock' as const, min: 49, max: 73 },
      { id: 'custom' as const, min: 52, max: 67 },
    ];

    for (const prof of profilesToTest) {
      for (const genre of FIVE_GENRES) {
        const song = buildSongFromQuickSetup(
          {
            keyRoot: genre === 'alt_shoegaze' ? 'E' : 'C',
            scaleType: genre === 'alt_shoegaze' || genre === 'numetal_mixture' ? 'Minor' : 'Major',
            bpm: genre === 'chill_ballad' ? 84 : 138,
            genre,
            songLength: 'short_loop',
            structureTemplate: 'short_ab',
            chordPreset: 'auto_by_genre',
            vocalVoiceProfileId: prof.id,
            vocalCustomMinMidi: prof.min,
            vocalCustomMaxMidi: prof.max,
          },
          3100 + FIVE_GENRES.indexOf(genre) * 17
        );

        const state = generateAllSections(song, undefined, 7070, true);
        for (const sec of song.sections) {
          const takes = state.cellsBySection[sec.id].vocal.takes;
          for (const style of ['A', 'B', 'C'] as const) {
            const notes = takes[style];
            expect(notes.length).toBeGreaterThan(0);
            for (const n of notes) {
              expect(
                n.pitch,
                `${genre} ${prof.id} take ${style} pitch ${n.pitch}`
              ).toBeGreaterThanOrEqual(prof.min);
              expect(
                n.pitch,
                `${genre} ${prof.id} take ${style} pitch ${n.pitch}`
              ).toBeLessThanOrEqual(prof.max);
            }
          }
        }
      }
    }

    // Verify <= 240-tick syncopated anticipation lookahead in resolveEffectiveChord
    const harmony = generateGenreHarmonySection({
      genreId: 'royal_jpop',
      sectionType: 'Chorus',
      key: 'C',
      scale: 'Major',
      bars: 4,
      bpm: 128,
      masterSeed: 99,
      sectionIndex: 0,
    });
    expect(harmony.chordEvents.length).toBeGreaterThanOrEqual(2);
    // Chorus of Mode A avoids starting on tonic I
    expect(harmony.chordEvents[0].romanSymbol).not.toBe('I');
    const secondEv = harmony.chordEvents[1];
    const anticipated = resolveEffectiveChord(
      secondEv.startTick - 240,
      480,
      harmony.chordEvents
    );
    expect(anticipated).toBe(secondEv);
  });

  it('3. VoiSona Clean SMF Specification: 60-tick quantization, zero overlap, zero PB/CC, and FF 59 02 sf mi Key Signature meta event', () => {
    const keyCases = [
      { keyRoot: 'F#', scaleType: 'Major', expectedSf: 6, expectedMi: 0 },
      { keyRoot: 'Eb', scaleType: 'Major', expectedSf: -3, expectedMi: 0 },
      { keyRoot: 'E', scaleType: 'Minor', expectedSf: 1, expectedMi: 1 },
      { keyRoot: 'C', scaleType: 'Minor', expectedSf: -3, expectedMi: 1 },
    ];

    for (const kc of keyCases) {
      const song = buildSongFromQuickSetup(
        {
          keyRoot: kc.keyRoot,
          scaleType: kc.scaleType,
          bpm: 126,
          genre: 'royal_jpop',
          songLength: 'short_loop',
          structureTemplate: 'short_chorus_loop',
          chordPreset: 'auto_by_genre',
          vocalVoiceProfileId: 'chisa_jp',
        },
        1234
      );
      const state = generateAllSections(song, undefined, 5678, true);
      const exported = exportMultiTrackMidi(song, state, {
        exportTarget: 'voisona_clean_smf',
      });
      const parsed = parseMidiFile(exported.bytes);
      expect(parsed.srcPPQ).toBe(480);

      // Conductor and Vocal track both carry FF 59 02 sf mi at tick 0
      const conductor = parsed.tracks.find((t) => t.name === 'Conductor')!;
      const vocalTrack = parsed.tracks.find((t) => t.name === 'Vocal')!;
      expect(conductor.keySignatures).toEqual([
        { tick: 0, sf: kc.expectedSf, mi: kc.expectedMi },
      ]);
      expect(vocalTrack.keySignatures).toEqual([
        { tick: 0, sf: kc.expectedSf, mi: kc.expectedMi },
      ]);

      // Zero PitchBend & zero CC on VoiSona Vocal track
      expect(vocalTrack.pitchBends).toEqual([]);
      expect(vocalTrack.controlChanges).toEqual([]);

      // Strict 60-tick quantize & zero overlap validation
      const validation = validateVoisonaVocalNotes(vocalTrack.notes);
      expect(validation.errors).toEqual([]);
      expect(validation.valid).toBe(true);
    }

    expect(VOCAL_VOICE_PROFILES.chisa_jp.minQuantizeTicks).toBe(60);
  });

  it('4. Berklee ChordEvent dictionary, Bass-integrated LIL, Low-Vocal (F4=65) tension-thinning clamp, and Chorus Guitar Headroom (48-60 <= 2 notes)', () => {
    // 4A. Berklee avoid & hook exceptions
    const dm7InC = analyzeParsedChordToEvent({
      parsed: parseChord('Dm7'),
      startTick: 0,
      durationTicks: 1920,
      key: 'C',
      scale: 'Major',
    });
    expect(dm7InC.chordScale).toBe('dorian');
    // Major IIm7 Dorian treats 13th (B = 11) as avoid
    expect(dm7InC.avoidPcs).toContain(11);

    const fMaj7InC = analyzeParsedChordToEvent({
      parsed: parseChord('Fmaj7'),
      startTick: 0,
      durationTicks: 1920,
      key: 'C',
      scale: 'Major',
    });
    expect(fMaj7InC.chordScale).toBe('lydian');
    expect(fMaj7InC.avoidPcs).toEqual([]);

    const fm7InC = analyzeParsedChordToEvent({
      parsed: parseChord('Fm7'),
      startTick: 0,
      durationTicks: 1920,
      key: 'C',
      scale: 'Major',
    });
    expect(fm7InC.isNonDiatonic).toBe(true);
    expect(fm7InC.hookPcs).toContain(8); // Ab (pitch class 8)

    // 4B. Low-vocal (F4 = 65) ceiling clamp (<= 63) + zero minor-2nd muddiness
    const song = buildSongFromQuickSetup(
      {
        keyRoot: 'C',
        scaleType: 'Major',
        bpm: 92,
        genre: 'chill_ballad',
        songLength: 'short_loop',
        structureTemplate: 'short_chorus_loop',
        chordPreset: 'custom',
        customChordsText: 'Cmaj9 | Dm9 | G13 | Cmaj9',
      },
      808
    );
    const section = {
      ...song.sections[0],
      bars: 4,
      chords: createUniformChordTimeline(['Cmaj9', 'Dm9', 'G13', 'Cmaj9'], 4),
    };
    const lowVocalNotes: MidiNote[] = [0, 1, 2, 3].map((b) => ({
      pitch: 65, // F4
      velocity: 96,
      startTick: b * TICKS_PER_BAR,
      durationTicks: 1440,
      channel: 4,
    }));
    const bassNotes: MidiNote[] = [
      { pitch: 36, velocity: 92, startTick: 0, durationTicks: 1900, channel: 0 },
      { pitch: 38, velocity: 92, startTick: 1920, durationTicks: 1900, channel: 0 },
      { pitch: 43, velocity: 92, startTick: 3840, durationTicks: 1900, channel: 0 },
      { pitch: 36, velocity: 92, startTick: 5760, durationTicks: 1900, channel: 0 },
    ];

    const kbLowRes = generateKeyboardSkeletonTrack({
      song,
      section,
      sectionIndex: 0,
      style: 'C',
      seed: 909,
      params: resolveInstrumentParams(song, section, 'keyboard', 'C'),
      masterGenreId: 'chill_ballad',
      keyboardSkeleton: 'SUSTAIN_CHORD',
      keyboardTake: 'C',
      bassNotes,
      vocalNotes: lowVocalNotes,
      vocalMinMidiByBar: [65, 65, 65, 65],
    });

    // Exclude rest-only obligato notes and verify chord voicings stay strictly <= 63 with 0 minor-2nds
    const sustainChordNotes = kbLowRes.notes.filter((n) => n.startTick % TICKS_PER_BAR === 0);
    expect(sustainChordNotes.length).toBeGreaterThan(0);
    for (let b = 0; b < 4; b++) {
      const t = b * TICKS_PER_BAR;
      const barVoicing = sustainChordNotes
        .filter((n) => n.startTick === t)
        .map((n) => n.pitch)
        .sort((x, y) => x - y);
      expect(barVoicing.length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...barVoicing)).toBeLessThanOrEqual(63); // <= 65 - 2
      const lil = computeBassIntegratedLilPenalty(barVoicing, bassNotes[b].pitch);
      expect(lil.hasMinorSecond).toBe(false);
    }

    // 4C. Chorus Guitar Headroom Reservation (MIDI 48..60 max 2 simultaneous notes)
    for (const guitarGenre of [
      'alt_shoegaze',
      'emo_jrock',
      'numetal_mixture',
    ] as const) {
      const gSong = buildSongFromQuickSetup(
        {
          keyRoot: 'E',
          scaleType: 'Minor',
          bpm: 148,
          genre: guitarGenre,
          songLength: 'short_loop',
          structureTemplate: 'short_chorus_loop',
          chordPreset: 'auto_by_genre',
        },
        404
      );
      const chorusSec = gSong.sections[0];
      const kbChorus = generateKeyboardSkeletonTrack({
        song: gSong,
        section: chorusSec,
        sectionIndex: 0,
        style: 'C',
        seed: 515,
        params: resolveInstrumentParams(gSong, chorusSec, 'keyboard', 'C'),
        masterGenreId: guitarGenre,
        keyboardSkeleton: 'SUSTAIN_CHORD',
        keyboardTake: 'C',
      });
      const padChorus = generatePadSkeletonTrack({
        song: gSong,
        section: chorusSec,
        sectionIndex: 0,
        style: 'C',
        seed: 515,
        params: resolveInstrumentParams(gSong, chorusSec, 'pad', 'C'),
        masterGenreId: guitarGenre,
        padSkeleton: 'WARM_SUSTAIN',
        padTake: 'C',
      });

      const sectionEnd = chorusSec.bars * TICKS_PER_BAR;
      for (let tick = 0; tick < sectionEnd; tick += 240) {
        const activeKbInBand = kbChorus.notes.filter(
          (n) =>
            n.startTick <= tick &&
            n.startTick + n.durationTicks > tick &&
            n.pitch >= 48 &&
            n.pitch <= 60
        );
        const activePadInBand = padChorus.notes.filter(
          (n) =>
            n.startTick <= tick &&
            n.startTick + n.durationTicks > tick &&
            n.pitch >= 48 &&
            n.pitch <= 60
        );
        expect(activeKbInBand.length).toBeLessThanOrEqual(2);
        expect(activePadInBand.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('5. Diatonic Chord Suggester: suggests Am7/Am first for "A" in C Major, followed by A5 and A7, plus quick diatonic+borrowed on empty input', () => {
    const suggestions = suggestChords('A', 0 /* C */, 'major', 'emo_jrock');
    expect(suggestions.length).toBeGreaterThanOrEqual(5);
    const chords = suggestions.map((s) => s.chord);

    // Diatonic highest priority
    expect(chords[0]).toBe('Am7');
    expect(chords[1]).toBe('Am');
    expect(suggestions[0].category).toBe('diatonic');
    expect(suggestions[0].roleLabel).toContain('VIm7');

    // Rock power chord & secondary dominant follow in priority order
    const idxA5 = chords.indexOf('A5');
    const idxA7 = chords.indexOf('A7');
    expect(idxA5).toBeGreaterThan(1);
    expect(idxA7).toBeGreaterThan(idxA5);
    expect(suggestions[idxA7].roleLabel).toContain('V7/ii');

    // Empty input -> diatonic 7ths + classic borrowed (Fm, Abmaj7, Bb7, E7, F#dim7)
    const emptyQuick = suggestChords('', 0, 'major', 'royal_jpop');
    const quickChords = emptyQuick.map((s) => s.chord);
    expect(quickChords).toContain('Cmaj7');
    expect(quickChords).toContain('Am7');
    expect(quickChords).toContain('Fm');
    expect(quickChords).toContain('F#dim7');
  });

  it('6. Custom Chord Lock & Power-Chord Parser: parses "E5 | F5 | G5 F5 | E5" with 2-beat split & 8-bar loop, preserves chords across seed changes, and respects power5 / Chisa / VoiSona / LIL', () => {
    const parsed = parseCustomChordProgression(
      'E5 | F5 | G5 F5 | E5',
      8,
      4 /* E */,
      'minor',
      'numetal_mixture'
    );
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toEqual([]);
    // 4 bars have 5 chord events (1 + 1 + 2 + 1) -> 8 bars looped = 10 events
    expect(parsed.chordEvents.length).toBe(10);
    expect(parsed.chordEvents[0]).toMatchObject({
      chordSymbol: 'E5',
      startTick: 0,
      durationTicks: 1920,
      quality: '5',
      chordTonePcs: [4, 11],
    });
    expect(parsed.chordEvents[1]).toMatchObject({
      chordSymbol: 'F5',
      startTick: 1920,
      durationTicks: 1920,
      quality: '5',
      chordTonePcs: [5, 0],
      isNonDiatonic: true,
    });
    expect(parsed.chordEvents[1].hookPcs).toContain(5); // F (b2 in E minor)
    // Bar 3: 2-beat split G5 (3840..4800) + F5 (4800..5760)
    expect(parsed.chordEvents[2].startTick).toBe(3840);
    expect(parsed.chordEvents[2].durationTicks).toBe(960);
    expect(parsed.chordEvents[3].startTick).toBe(4800);
    expect(parsed.chordEvents[3].durationTicks).toBe(960);
    // Bar 5 loops back to E5
    expect(parsed.chordEvents[5].chordSymbol).toBe('E5');
    expect(parsed.chordEvents[5].startTick).toBe(7680);

    // Invalid token returns error without throwing
    const bad = parseCustomChordProgression('E5 | XYZ?? | G5', 4, 4, 'minor', 'emo_jrock');
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);

    // End-to-end section custom chord lock + seed invariance
    const baseSong = buildSongFromQuickSetup(
      {
        keyRoot: 'E',
        scaleType: 'Minor',
        bpm: 144,
        genre: 'numetal_mixture',
        songLength: 'short_loop',
        structureTemplate: 'short_chorus_loop',
        chordPreset: 'auto_by_genre',
        vocalVoiceProfileId: 'chisa_jp',
      },
      777
    );
    const baseState = generateAllSections(baseSong, undefined, 1001, true);
    const secId = baseSong.sections[0].id;

    const locked = setSectionChordLock(baseSong, baseState, secId, {
      chordLockMode: 'custom',
      customChordsText: 'E5 | F5 | G5 F5 | E5',
    });
    expect(locked.parseErrors).toEqual([]);
    expect(locked.song.sections[0].chordLockMode).toBe('custom');

    // Regenerating with different seeds keeps custom chords 100% locked while regenerating vocal/drums/bass
    const reroll1 = generateAllSections(locked.song, locked.bandState, 2002, true);
    const reroll2 = generateAllSections(locked.song, locked.bandState, 9009, true);
    expect(locked.song.sections[0].customChordsText).toBe('E5 | F5 | G5 F5 | E5');
    expect(reroll1.cellsBySection[secId].vocal.takes.A).not.toEqual(
      reroll2.cellsBySection[secId].vocal.takes.A
    );

    // Vocal strictly inside Chisa range (55..74) and valid VoiSona 60-tick SMF
    const vocalNotes = reroll1.cellsBySection[secId].vocal.takes.A;
    expect(vocalNotes.length).toBeGreaterThan(0);
    expect(vocalNotes.every((n) => n.pitch >= 55 && n.pitch <= 74)).toBe(true);
    const voisonaExport = exportMultiTrackMidi(locked.song, reroll1, {
      exportTarget: 'voisona_clean_smf',
    });
    const parsedSmf = parseMidiFile(voisonaExport.bytes);
    const smfVocal = parsedSmf.tracks.find((t) => t.name === 'Vocal')!;
    expect(validateVoisonaVocalNotes(smfVocal.notes).valid).toBe(true);

    // Stage 3 Keyboard on power chords NEVER stacks unwanted 3rds (only root + 5th)
    const kbPower = generateKeyboardSkeletonTrack({
      song: locked.song,
      section: locked.song.sections[0],
      sectionIndex: 0,
      style: 'A',
      seed: 303,
      params: resolveInstrumentParams(locked.song, locked.song.sections[0], 'keyboard', 'A'),
      chordEvents: parsed.chordEvents,
      masterGenreId: 'numetal_mixture',
      keyboardSkeleton: 'SUSTAIN_CHORD',
      keyboardTake: 'A',
    });
    const bar0KbPcs = new Set(
      kbPower.notes.filter((n) => n.startTick === 0).map((n) => n.pitch % 12)
    );
    // E5 -> only E (4) and B (11), never G (7) or G# (8)
    for (const pc of bar0KbPcs) {
      expect([4, 11]).toContain(pc);
    }

    // lockCurrentChordsToCustom copies current progression into customChordsText cleanly
    const quickLocked = lockCurrentChordsToCustom(baseSong, baseState, secId);
    expect(quickLocked.song.sections[0].chordLockMode).toBe('custom');
    expect((quickLocked.song.sections[0].customChordsText ?? '').length).toBeGreaterThan(0);
  });

  it('7. Basic Pitch Bass MIDI Override Lock: preserves locked bass across seed changes, feeds Stage 3 LIL, and infers power chords from bass MIDI', () => {
    // Raw guitar-register Basic Pitch notes (E2=40, F2=41, G2=43, E2=40) + a 20-tick ghost noise
    const rawGuitarRiff: MidiNote[] = [
      { pitch: 40, velocity: 100, startTick: 0, durationTicks: 1800, channel: 0 },
      { pitch: 47, velocity: 40, startTick: 200, durationTicks: 20, channel: 0 }, // <60t ghost noise -> filtered
      { pitch: 41, velocity: 100, startTick: 1920, durationTicks: 1800, channel: 0 },
      { pitch: 43, velocity: 100, startTick: 3840, durationTicks: 1800, channel: 0 },
      { pitch: 40, velocity: 100, startTick: 5760, durationTicks: 1800, channel: 0 },
    ];

    const normalized = normalizeOverrideBassNotes(rawGuitarRiff, 4, {
      shiftOctaveDown: true,
      minDurationTicks: 60,
    });
    expect(normalized.length).toBe(4);
    expect(normalized.map((n) => n.pitch)).toEqual([28, 29, 31, 28]); // E1, F1, G1, E1

    // Infer power-chord progression from normalized bass MIDI
    expect(inferPowerChordProgressionFromBassNotes(normalized, 4)).toBe(
      'E5 | F5 | G5 | E5'
    );

    const song = buildSongFromQuickSetup(
      {
        keyRoot: 'E',
        scaleType: 'Minor',
        bpm: 136,
        genre: 'emo_jrock',
        songLength: 'short_loop',
        structureTemplate: 'short_chorus_loop',
        chordPreset: 'auto_by_genre',
      },
      555
    );
    song.sections[0].bars = 4;
    const initState = generateAllSections(song, undefined, 1111, true);
    const secId = song.sections[0].id;

    const overridden = setSectionBassMidiOverride(song, initState, secId, {
      bassLockMode: 'midi_override',
      rawNotes: rawGuitarRiff,
      sourceLabel: 'guitar_riff_bp.wav',
      shiftOctaveDown: true,
    });
    expect(overridden.song.sections[0].bassLockMode).toBe('midi_override');

    // Reroll with completely different seed -> locked bass MIDI stays 100% identical!
    const rerolled = generateAllSections(overridden.song, overridden.bandState, 8888, true);
    const bassTakeA = rerolled.cellsBySection[secId].bass.takes.A;
    expect(bassTakeA.map((n) => n.pitch)).toEqual([28, 29, 31, 28]);
    // MODO BASS 2 CC#9=0 reset maintained
    const bassCCs = rerolled.cellsBySection[secId].bass.controlChangesByTake?.A ?? [];
    expect(bassCCs.some((c) => c.controller === 9 && c.value === 0)).toBe(true);

    // Stage 3 Keyboard LIL references the overridden bass notes (zero minor-2nd clash with bass)
    const kbNotes = rerolled.cellsBySection[secId].keyboard.takes.A;
    const bar0Kb = kbNotes
      .filter((n) => n.startTick === 0)
      .map((n) => n.pitch)
      .sort((a, b) => a - b);
    if (bar0Kb.length >= 2) {
      expect(computeBassIntegratedLilPenalty(bar0Kb, 28).hasMinorSecond).toBe(false);
    }

    // One-click inferCustomChordsFromOverrideBass sets customChordsText="E5 | F5 | G5 | E5" & locks mode
    const inferred = inferCustomChordsFromOverrideBass(
      overridden.song,
      rerolled,
      secId
    );
    expect(inferred.inferredText).toBe('E5 | F5 | G5 | E5');
    expect(inferred.song.sections[0].chordLockMode).toBe('custom');
    expect(inferred.song.sections[0].customChordsText).toBe('E5 | F5 | G5 | E5');
  });
});
