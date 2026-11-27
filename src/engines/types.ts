import type {
  AccompanimentTake,
  BassSkeletonId,
  BeatPatternId,
  ChapterInternalForm,
  ChordEvent,
  EightBarScheme,
  EnergyLevel,
  KeyboardDensityLevel,
  KeyboardSkeletonId,
  KickTake,
  MidiNote,
  PadSkeletonId,
  Section,
  SectionType,
  SongConfig,
  TakeStyle,
  VocalEndingMode,
  VocalStyleId,
  VocalTakeId,
  VocalVoiceProfile,
} from '../types/song';
import type { MasterGenreId } from '../lib/masterGenres';

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
  kickTicks?: number[];
  bassNotes?: MidiNote[];
  keyboardNotes?: MidiNote[];
  vocalNotes?: MidiNote[];
  bpm?: number;
  keyboardDensity?: KeyboardDensityLevel;
  drumPatternId?: BeatPatternId | 'auto';
  drumKickTake?: KickTake | 'auto';
  midiMapMode?: 'GM_STANDARD' | 'SSD5_NATIVE';
  drumHat16thEnabled?: boolean;
  drumFillEnabled?: boolean;
  drumBreakEnabled?: boolean;
  prevVocalAvgPitch?: number;
  nextSectionFirstChord?: string;
  nextSectionType?: SectionType | string;
  nextSectionEnergy?: EnergyLevel | string;
  masterGenreId?: MasterGenreId;
  vocalDialecticalScheme?: EightBarScheme | 'auto';
  vocalChapterForm?: ChapterInternalForm | 'auto';
  bassSkeleton?: BassSkeletonId | 'auto';
  bassTake?: AccompanimentTake | 'auto';
  keyboardSkeleton?: KeyboardSkeletonId | 'auto';
  keyboardTake?: AccompanimentTake | 'auto';
  padSkeleton?: PadSkeletonId | 'auto';
  padTake?: AccompanimentTake | 'auto';
  emitModoBassCC?: boolean;
  chordEvents?: readonly ChordEvent[];
  vocalVoiceProfile?: VocalVoiceProfile;
  vocalMinMidiByBar?: readonly (number | null)[];
  isFinalChorusSection?: boolean;
  vocalStyle?: VocalStyleId;
  vocalTake?: VocalTakeId;
  vocalEnding?: VocalEndingMode;
}
