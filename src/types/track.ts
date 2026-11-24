import type {
  InstrumentType,
  LogicalTrackType,
  MidiControlChangeEvent,
  MidiNote,
  TakeStyle,
} from './song';

export interface ResolvedNote extends MidiNote {
  channel: number;
  midiDurationTicks?: number;
}

export interface SectionInstrumentCell {
  engineVersion: string;
  seeds: Record<TakeStyle, number>;
  takes: Record<TakeStyle, MidiNote[]>;
  controlChangesByTake?: Record<TakeStyle, MidiControlChangeEvent[]>;
  selectedTake: TakeStyle | 'OFF';
  locked: boolean;
}

export type SectionBandCells = Record<InstrumentType, SectionInstrumentCell>;

export interface BandState {
  cellsBySection: Record<string, SectionBandCells>;
}

export type LogicalTracks = Record<LogicalTrackType, ResolvedNote[]> & {
  controlChanges?: Partial<Record<LogicalTrackType, MidiControlChangeEvent[]>>;
};
