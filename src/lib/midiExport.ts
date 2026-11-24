export {
  adaptNotesForExportTarget,
  buildFallPitchBendEvents,
  toGeneratedVocalNotes,
  toMidiNotesFromGenerated,
  type ExportTarget,
  type FallExpressionConfig,
  type GeneratedVocalNote,
  type PitchBendEvent,
} from '../engines/vocalEngine';

export {
  buildVocalSmfTrack,
  canExportMidi,
  exportMultiTrackMidi,
  type MidiExportTrackSpec,
  type MultiTrackMidiExportOptions,
  type MultiTrackMidiExportResult,
} from './multiTrackMidiExport';
