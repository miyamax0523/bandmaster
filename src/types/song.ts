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
export type KeyboardDensityLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type VocalHarmonyMode =
  | 'off'
  | 'upper_3rd'
  | 'lower_3rd'
  | 'upper_5th'
  | 'octave_up'
  | 'octave_down';
export type KickMode = 'acoustic' | '808';
export type DrumAnticipationMode = 'sync' | 'keep';
export type BeatPatternId =
  | 'EIGHT_BEAT'
  | 'SIXTEEN_BEAT'
  | 'ATAMA_UCHI'
  | 'FOUR_ON_FLOOR'
  | 'UPBEAT'
  | 'TWO_BEAT'
  | 'BOUNCE'
  | 'HALF_TIME'
  | 'DOUBLE_BASS'
  | 'SOCA'
  | 'SLIP_BEAT'
  | 'SHUFFLE'
  | 'HALF_TIME_SHUFFLE'
  | 'JUNGLE'
  | 'TRAIN'
  | 'MARCH'
  | 'PPPH'
  | 'FOUR_BEAT'
  | 'SAMBA'
  | 'SONGO';
export type KickTake = 'A' | 'B' | 'C';
export type Bass808Behavior = 'octaveUp' | 'tacet' | 'normal';
export type TakeStyle = 'A' | 'B' | 'C';
export type InstrumentType = 'drums' | 'bass' | 'keyboard' | 'pad' | 'vocal';
export type PartId = InstrumentType;
export type LogicalTrackType =
  | 'drums'
  | 'kick808'
  | 'bass'
  | 'keyboard'
  | 'pad'
  | 'vocal'
  | 'vocalHarmony';
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
  vocal: 4,
  vocalHarmony: 5,
};

export type ExportTarget =
  | 'cubase_smf_expressive'
  | 'voisona_clean_smf'
  | 'non_pb_synth_fallback';

export type NoteRole =
  | 'pickup'
  | 'anchor'
  | 'hook_stab'
  | 'rush'
  | 'sync_tie'
  | 'step'
  | 'hard_cut'
  | 'top_fall'
  | 'phrase_land';

export interface FallExpressionConfig {
  readonly probability: number;
  readonly minGridDurationTicks: number;
  readonly minTrailingRestTicks: number;
  readonly bendRangeSemitones: 2 | 4;
  readonly dropSemitones: number;
  readonly fallDurationRatio: number;
  readonly curveSteps: number;
  readonly resetMarginTicks: number;
}

export type ChapterRole = 'thesis' | 'antithesis' | 'synthesis';
export type ChapterInternalForm =
  | 'two_bar_continuous'
  | 'one_bar_repeat_with_passing';
export type EightBarScheme = 'T-A-T-A' | 'T-A-T-S';
export type NoteFunctionTag = 'core' | 'passing' | 'runway' | 'cadence' | 'arc';

export interface MidiNote {
  pitch: number; // 0..127
  velocity: number; // 1..127
  startTick: number; // >= 0 integer
  durationTicks: number; // >= 1 integer
  channel?: number;
  gridDurationTicks?: number;
  role?: NoteRole;
  tag?: NoteFunctionTag;
  hasFall?: boolean;
  fallConfig?: FallExpressionConfig;
}

export type MidiNoteEvent = MidiNote;

export interface ChordSlot {
  id: string;
  chord: string;
  startBeat: number; // 0-based; 0.5 increments allowed
  durationBeats: number; // >= 0.5
  anticipated?: boolean;
}

export function createDefaultEnabledParts(): Record<InstrumentType, boolean> {
  return {
    drums: true,
    bass: true,
    keyboard: true,
    pad: true,
    vocal: true,
  };
}

export function createDefaultPartPresets(
  members?: Partial<Record<InstrumentType, MemberConfig>>
): Record<InstrumentType, string> {
  return {
    drums: members?.drums?.patternPreset ?? 'auto',
    bass: members?.bass?.patternPreset ?? 'auto',
    keyboard: members?.keyboard?.patternPreset ?? 'auto',
    pad: members?.pad?.patternPreset ?? 'auto',
    vocal: members?.vocal?.patternPreset ?? 'auto',
  };
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
  patternPreset?: string; // 'auto' | preset ID
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

export interface VocalMelodyData {
  notes: MidiNote[]; // MIDI 48..76 (C3..E5)
  sourceLabel: string;
  bars?: number; // 1..4
  grid?: QuantizeGrid;
  offsetMs?: number; // -200..+200
  analysisMethod?: AnalysisMethod;
  snappedToScale?: boolean;
}

export interface CopiedPartPhrase {
  part: PartId;
  sourceSectionId: string;
  sourceSectionName: string;
  notes: MidiNoteEvent[];
  sourceBars: number;
  patternPreset: string;
  unisonRiff?: UnisonRiffData;
  vocalMelody?: VocalMelodyData;
}

export function getDefaultDrumFillEnabled(
  sectionType?: SectionType | string,
  bars?: number
): boolean {
  if (sectionType === 'Pre-Chorus' || sectionType === 'Bridge') return true;
  if (bars !== undefined && bars >= 8) return true;
  return false;
}

export interface Section {
  id: string;
  type: SectionType;
  name: string;
  bars: number; // 1..32
  energy: EnergyLevel;
  kickMode: KickMode;
  drumAnticipationMode?: DrumAnticipationMode; // default 'sync'
  drumPatternId?: BeatPatternId | 'auto'; // default 'auto'
  drumKickTake?: KickTake | 'auto'; // default 'auto'
  drumHat16thEnabled?: boolean; // default false
  drumFillEnabled?: boolean; // default via getDefaultDrumFillEnabled
  drumBreakEnabled?: boolean; // default false
  hatDensity?: DensityLevel; // 1..5 (default 3)
  kickDensity?: DensityLevel; // 1..5 (default 3)
  keyboardDensity?: KeyboardDensityLevel; // 1..7 (default 4)
  vocalDensity?: number; // 1.0..5.0 (default 3)
  vocalHarmony?: VocalHarmonyMode; // default 'off'
  vocalDialecticalScheme?: EightBarScheme | 'auto'; // default 'auto'
  vocalChapterForm?: ChapterInternalForm | 'auto'; // default 'auto'
  bassChromaticEnabled?: boolean; // default false
  bassFillEnabled?: boolean; // default false
  bassFillSeed?: number; // default 0
  partPresets?: Partial<Record<InstrumentType, string>>;
  patternPresets?: Partial<Record<InstrumentType, string>>;
  chords: ChordSlot[];
  enabledParts?: Record<InstrumentType, boolean>;
  uploadedDrumLoop?: DrumLoopData;
  unisonRiff?: UnisonRiffData;
  vocalMelody?: VocalMelodyData;
}

export type SectionConfig = Section;

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
