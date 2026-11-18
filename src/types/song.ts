export const CURRENT_ENGINE_VERSION = '2.5.0';
export const PPQ = 480;
export const TICKS_PER_BEAT = 480;
export const TICKS_PER_BAR = 1920; // 4/4 fixed

export type KeyName =
  | 'C'
  | 'C#'
  | 'D'
  | 'D#'
  | 'E'
  | 'F'
  | 'F#'
  | 'G'
  | 'G#'
  | 'A'
  | 'A#'
  | 'B';

export type ScaleType = 'Minor' | 'Major';
export type BeatFeel = 'Straight' | 'Half-Time' | 'Bounce' | 'Driving';
export type EnergyLevel = 'Low' | 'Mid' | 'High';
export type DensityLevel = 1 | 2 | 3 | 4 | 5;
export type KickMode = 'acoustic' | '808';
export type Bass808Behavior = 'octaveUp' | 'tacet' | 'normal';
export type TakeStyle = 'A' | 'B' | 'C';
export type InstrumentType = 'drums' | 'bass' | 'keyboard' | 'pad';
export type LogicalTrackType = 'drums' | 'kick808' | 'bass' | 'keyboard' | 'pad';
export type SwingTarget = '8th' | '16th';
export type QuantizeGrid = 'straight16' | 'triplet8';
export type AnalysisMethod = 'basic-pitch' | 'simple-fallback' | 'manual';

export type DrumPlayStyle =
  | 'Standard'
  | 'Four-on-the-Floor'
  | 'Heavy / Half-Time'
  | 'Double Kick'
  | 'Sub-Step / Trap';

export type BassPlayStyle =
  | 'Root Sync'
  | 'Driving 8th'
  | 'Octave / Melodic'
  | 'Minimal';

export type KeyboardPlayStyle =
  | 'Rhythm Backing'
  | 'Arpeggio'
  | 'Minimal Riff'
  | 'Long Sustain';

export type PadPlayStyle = 'Power' | 'Floating Tension' | 'Dark Ambient';

export type SectionType =
  | 'Intro'
  | 'Verse'
  | 'Pre-Chorus'
  | 'Chorus'
  | 'Bridge'
  | 'Outro';

export const TRACK_CHANNELS: Record<LogicalTrackType, number> = {
  drums: 9,
  kick808: 3,
  bass: 0,
  keyboard: 1,
  pad: 2,
};

export interface MidiNote {
  pitch: number; // 0..127
  velocity: number; // 1..127
  startTick: number; // >= 0 integer
  durationTicks: number; // >= 1 integer
  channel?: number;
}

export interface DrumLoopData {
  fileName: string;
  bars: number; // 1..4
  sourceTrackIndex: number;
  notes: readonly MidiNote[];
}

export interface MemberConfig {
  enabled: boolean;
  activeSectionsOnly: boolean;
  drumStyle?: DrumPlayStyle;
  bassStyle?: BassPlayStyle;
  bass808Behavior?: Bass808Behavior;
  keyboardStyle?: KeyboardPlayStyle;
  padStyle?: PadPlayStyle;
  instructionText: string;
}

export interface UnisonRiffData {
  sourceName: string;
  analysisMethod: AnalysisMethod;
  bars: number; // 1..4
  grid: QuantizeGrid;
  offsetMs: number; // -200..+200
  octaveUpOn808?: boolean;
  cleanedBassNotes: MidiNote[]; // MIDI 24..55
  accentTicks: number[]; // drum kick sync ticks within 1..4 bars
}

export interface Section {
  id: string;
  type: SectionType;
  name: string;
  bars: number; // 1..32
  energy: EnergyLevel;
  kickMode: KickMode;
  hatDensity?: DensityLevel; // 1..5 (default 3)
  kickDensity?: DensityLevel; // 1..5 (default 3)
  chords: string[];
  uploadedDrumLoop?: DrumLoopData;
  unisonRiff?: UnisonRiffData;
}

export interface SongConfig {
  title: string;
  bpm: number; // 60..200
  key: KeyName;
  scale: ScaleType;
  timeSignature: '4/4';
  beatFeel: BeatFeel;
  swing: number; // 0..50
  swingTarget: SwingTarget;
  exportOnlyActiveTracks: boolean;
  split808KickTrack: boolean;
  uploadedDrumLoop?: DrumLoopData;
  members: Record<InstrumentType, MemberConfig>;
  sections: Section[];
}
