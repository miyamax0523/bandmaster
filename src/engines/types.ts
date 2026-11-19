import type { MidiNote, Section, SongConfig, TakeStyle } from '../types/song';

export interface ResolvedInstrumentParams {
  // Common
  humanizeTicks: number;
  velocityJitter: number;
  velocityCap: number;
  velocityBoost: number;
  fillNoteRange: { min: number; max: number };
  forceRiffStrictUnison: boolean;

  // Drums
  kickPattern: 'standard' | 'fourOnFloor' | 'syncopated';
  doubleKickProb: number;
  snareHalfTime: boolean;
  hatSubdivision: 1 | 2 | 3 | 4;
  flamEnabled: boolean;
  offbeatOpenHat: boolean;

  // Bass
  rangeMin: number;
  rangeMax: number;
  barHeadRootMin: number;
  barHeadRootMax: number;
  kickSyncRate: number;
  octaveProb: number;
  passingProb: number;
  forcePassingFill: boolean;

  // Keyboard / PAD
  add9: boolean;
  add7: boolean;
  sus2: boolean;
  voicingMin: number;
  voicingMax: number;

  // Metadata
  matchedKeywords: string[];
}

export interface EngineInput {
  song: SongConfig;
  section: Section;
  sectionIndex: number;
  style: TakeStyle;
  seed: number;
  params: ResolvedInstrumentParams;
  drumNotes?: MidiNote[];
  prevVocalAvgPitch?: number;
}
