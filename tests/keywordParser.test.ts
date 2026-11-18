import { describe, expect, it } from 'vitest';
import {
  extractMatchedKeywords,
  resolveInstrumentParams,
} from '../src/lib/keywordParser';
import type { Section, SongConfig } from '../src/types/song';

function makeSong(overrides: Partial<SongConfig> = {}): SongConfig {
  return {
    title: 'Test Song',
    bpm: 135,
    key: 'E',
    scale: 'Minor',
    timeSignature: '4/4',
    beatFeel: 'Straight',
    swing: 0,
    swingTarget: '8th',
    exportOnlyActiveTracks: true,
    split808KickTrack: true,
    members: {
      drums: {
        enabled: true,
        activeSectionsOnly: false,
        drumStyle: 'Standard',
        instructionText: '',
      },
      bass: {
        enabled: true,
        activeSectionsOnly: false,
        bassStyle: 'Root Sync',
        bass808Behavior: 'octaveUp',
        instructionText: '',
      },
      keyboard: {
        enabled: true,
        activeSectionsOnly: false,
        keyboardStyle: 'Rhythm Backing',
        instructionText: '',
      },
      pad: {
        enabled: true,
        activeSectionsOnly: false,
        padStyle: 'Power',
        instructionText: '',
      },
      vocal: {
        enabled: true,
        activeSectionsOnly: false,
        instructionText: '',
      },
    },
    sections: [],
    ...overrides,
  };
}

function makeSection(overrides: Partial<Section> = {}): Section {
  return {
    id: 'sec-1',
    type: 'Verse',
    name: 'Aメロ',
    bars: 4,
    energy: 'Mid',
    kickMode: 'acoustic',
    chords: ['Em', 'C', 'G', 'D'],
    ...overrides,
  };
}

describe('keywordParser', () => {
  it('enforces priority: keyword > PlayStyle > BeatFeel > Section.energy', () => {
    const song = makeSong({
      beatFeel: 'Half-Time', // sets snareHalfTime = true
      members: {
        ...makeSong().members,
        drums: {
          enabled: true,
          activeSectionsOnly: false,
          drumStyle: 'Four-on-the-Floor', // overrides Half-Time -> snareHalfTime = false
          instructionText: '重く ヘヴィに', // keyword overrides PlayStyle -> snareHalfTime = true
        },
      },
    });
    const sec = makeSection({ energy: 'Low' });
    const params = resolveInstrumentParams(song, sec, 'drums', 'A');
    expect(params.kickPattern).toBe('fourOnFloor');
    expect(params.snareHalfTime).toBe(true);
    expect(params.matchedKeywords).toContain('重く');
  });

  it('parses double kick, trap, tight, floating, and unison keywords', () => {
    const song = makeSong();
    song.members.drums.instructionText = 'ツーバス トラップ タイト';
    const dParams = resolveInstrumentParams(song, makeSection(), 'drums', 'C');
    expect(dParams.doubleKickProb).toBeGreaterThanOrEqual(0.5);
    expect(dParams.velocityBoost).toBe(12);
    expect(dParams.hatSubdivision).toBe(4);
    expect(dParams.flamEnabled).toBe(true);
    expect(dParams.velocityCap).toBe(95);
    expect(dParams.fillNoteRange).toEqual({ min: 8, max: 8 });

    song.members.pad.instructionText = 'シューゲイザー deftones 浮遊';
    const pParams = resolveInstrumentParams(song, makeSection(), 'pad', 'A');
    expect(pParams.add9).toBe(true);
    expect(pParams.add7).toBe(true);
    expect(pParams.sus2).toBe(true);

    song.members.bass.instructionText = 'ユニゾン リフ重視';
    const bParams = resolveInstrumentParams(song, makeSection(), 'bass', 'A');
    expect(bParams.kickSyncRate).toBe(1.0);
    expect(bParams.passingProb).toBe(0);
    expect(bParams.forceRiffStrictUnison).toBe(true);
  });

  it('prioritizes 808 octaveUp range (barHeadRootMax=51, rangeMax=55) over Half/Heavy 43 cap', () => {
    const song = makeSong({
      beatFeel: 'Half-Time',
      members: {
        ...makeSong().members,
        bass: {
          enabled: true,
          activeSectionsOnly: false,
          bassStyle: 'Root Sync',
          bass808Behavior: 'octaveUp',
          instructionText: 'ハーフ 重く ヘヴィ',
        },
      },
    });

    const sec808 = makeSection({ kickMode: '808' });
    const params808 = resolveInstrumentParams(song, sec808, 'bass', 'A');
    expect(params808.rangeMin).toBe(40);
    expect(params808.rangeMax).toBe(55);
    expect(params808.barHeadRootMin).toBe(40);
    expect(params808.barHeadRootMax).toBe(51);

    const secAcoustic = makeSection({ kickMode: 'acoustic' });
    const paramsAcoustic = resolveInstrumentParams(song, secAcoustic, 'bass', 'A');
    expect(paramsAcoustic.rangeMax).toBe(43);
  });

  it('extracts matched keyword tokens for UI chips', () => {
    const chips = extractMatchedKeywords('Radiohead風の浮遊感でタイトに');
    expect(chips).toContain('浮遊');
    expect(chips).toContain('radiohead');
    expect(chips).toContain('タイト');
  });
});
