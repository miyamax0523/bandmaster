import type { KeyName, ScaleType } from '../types/song';

export const KEY_NAMES: readonly KeyName[] = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

const FLAT_TO_SHARP: Record<string, KeyName> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
  Cb: 'B',
  Fb: 'E',
};

export type ChordQuality =
  | 'major'
  | 'minor'
  | 'dim'
  | 'aug'
  | 'sus2'
  | 'sus4'
  | 'power';

export interface ParsedChord {
  raw: string;
  root: KeyName;
  rootSemitone: number; // 0..11 (C=0)
  quality: ChordQuality;
  tensions: string[];
  bass?: KeyName;
  bassSemitone?: number;
  intervals: number[]; // semitones from root
}

export function noteNameToSemitone(name: string): number {
  const normalized = FLAT_TO_SHARP[name] ?? name;
  const idx = KEY_NAMES.indexOf(normalized as KeyName);
  if (idx === -1) {
    throw new Error(`Invalid note name: "${name}"`);
  }
  return idx;
}

export function semitoneToKeyName(semitone: number): KeyName {
  const mod = ((semitone % 12) + 12) % 12;
  return KEY_NAMES[mod];
}

export function parseChord(chordName: string): ParsedChord {
  const trimmed = chordName.trim();
  if (!trimmed) {
    throw new Error('Empty chord name');
  }

  const [mainPart, slashPart] = trimmed.split('/');
  const rootMatch = mainPart.match(/^([A-G])([#b]?)(.*)$/);
  if (!rootMatch) {
    throw new Error(`Invalid chord name: "${chordName}"`);
  }

  const rawRoot = rootMatch[1] + rootMatch[2];
  const rootSemitone = noteNameToSemitone(rawRoot);
  const root = semitoneToKeyName(rootSemitone);
  const suffix = rootMatch[3];

  let bass: KeyName | undefined;
  let bassSemitone: number | undefined;
  if (slashPart) {
    const bassMatch = slashPart.match(/^([A-G][#b]?)$/);
    if (!bassMatch) {
      throw new Error(`Invalid slash bass in chord: "${chordName}"`);
    }
    bassSemitone = noteNameToSemitone(bassMatch[1]);
    bass = semitoneToKeyName(bassSemitone);
  }

  let quality: ChordQuality = 'major';
  let intervals: number[] = [0, 4, 7];
  const tensions: string[] = [];

  if (suffix === '5') {
    quality = 'power';
    intervals = [0, 7];
  } else if (suffix.startsWith('m7b5') || suffix.startsWith('ø')) {
    quality = 'dim';
    intervals = [0, 3, 6, 10];
    tensions.push('b5', '7');
  } else if (suffix.startsWith('dim')) {
    quality = 'dim';
    intervals = [0, 3, 6];
    if (suffix.includes('7')) {
      intervals.push(9);
      tensions.push('dim7');
    }
  } else if (suffix.startsWith('aug') || suffix.startsWith('+')) {
    quality = 'aug';
    intervals = [0, 4, 8];
  } else if (suffix.startsWith('sus2')) {
    quality = 'sus2';
    intervals = [0, 2, 7];
  } else if (suffix.startsWith('sus4') || suffix === 'sus') {
    quality = 'sus4';
    intervals = [0, 5, 7];
  } else if (
    suffix.startsWith('m') &&
    !suffix.startsWith('maj')
  ) {
    quality = 'minor';
    intervals = [0, 3, 7];
  }

  // Tensions
  if (suffix.includes('maj7') || suffix.includes('M7')) {
    if (!intervals.includes(11)) intervals.push(11);
    tensions.push('maj7');
  } else if (suffix.includes('7') && quality !== 'dim') {
    if (!intervals.includes(10)) intervals.push(10);
    tensions.push('7');
  }

  if (suffix.includes('add9')) {
    if (!intervals.includes(14)) intervals.push(14);
    tensions.push('add9');
  } else if (suffix.includes('9') && !suffix.includes('b9')) {
    if (!intervals.includes(10) && !intervals.includes(11)) {
      intervals.push(10);
    }
    if (!intervals.includes(14)) intervals.push(14);
    tensions.push('9');
  }

  if (suffix.includes('6') && !suffix.includes('b6')) {
    if (!intervals.includes(9)) intervals.push(9);
    tensions.push('6');
  }

  return {
    raw: trimmed,
    root,
    rootSemitone,
    quality,
    tensions,
    bass,
    bassSemitone,
    intervals,
  };
}

export function getDiatonicChords(key: KeyName, scale: ScaleType): string[] {
  const rootIdx = noteNameToSemitone(key);
  if (scale === 'Major') {
    // I, ii, iii, IV, V, vi, vii°
    const offsets = [0, 2, 4, 5, 7, 9, 11];
    const suffixes = ['', 'm', 'm', '', '', 'm', 'm7b5'];
    return offsets.map((off, i) => `${semitoneToKeyName(rootIdx + off)}${suffixes[i]}`);
  } else {
    // Natural Minor: i, ii°, III, iv, v, VI, VII
    const offsets = [0, 2, 3, 5, 7, 8, 10];
    const suffixes = ['m', 'm7b5', '', 'm', 'm', '', ''];
    return offsets.map((off, i) => `${semitoneToKeyName(rootIdx + off)}${suffixes[i]}`);
  }
}

export function getDefaultProgression(key: KeyName, scale: ScaleType): string[] {
  const diatonic = getDiatonicChords(key, scale);
  if (scale === 'Minor') {
    // i - VI - III - VII (classic rock/metal/emo minor progression)
    return [diatonic[0], diatonic[5], diatonic[2], diatonic[6]];
  }
  // I - V - vi - IV
  return [diatonic[0], diatonic[4], diatonic[5], diatonic[3]];
}

export function resolveChordForBar(
  chords: readonly string[],
  barIndex: number,
  key: KeyName,
  scale: ScaleType
): ParsedChord {
  const effectiveChords =
    chords.length > 0 ? chords : getDefaultProgression(key, scale);
  const raw = effectiveChords[barIndex % effectiveChords.length];
  try {
    return parseChord(raw);
  } catch {
    return parseChord(getDefaultProgression(key, scale)[0]);
  }
}

export function transposeChord(chordName: string, semitones: number): string {
  const trimmed = chordName.trim();
  const [mainPart, slashPart] = trimmed.split('/');
  const rootMatch = mainPart.match(/^([A-G][#b]?)(.*)$/);
  if (!rootMatch) return chordName;

  const newRoot = semitoneToKeyName(
    noteNameToSemitone(rootMatch[1]) + semitones
  );
  let result = `${newRoot}${rootMatch[2]}`;
  if (slashPart) {
    const bassMatch = slashPart.match(/^([A-G][#b]?)$/);
    if (bassMatch) {
      const newBass = semitoneToKeyName(
        noteNameToSemitone(bassMatch[1]) + semitones
      );
      result += `/${newBass}`;
    }
  }
  return result;
}

export function transposeChords(
  chords: readonly string[],
  semitones: number
): string[] {
  return chords.map((c) => transposeChord(c, semitones));
}

/**
 * Finds the MIDI pitch for a pitch-class (0..11) closest to/within [minMidi, maxMidi].
 */
export function fitPitchClassToRange(
  semitone: number,
  minMidi: number,
  maxMidi: number
): number {
  const pc = ((semitone % 12) + 12) % 12;
  for (let p = minMidi; p <= maxMidi; p++) {
    if (p % 12 === pc) {
      return p;
    }
  }
  // Fallback: nearest octave around midpoint
  const mid = Math.round((minMidi + maxMidi) / 2);
  let best = Math.floor(mid / 12) * 12 + pc;
  while (best < minMidi) best += 12;
  while (best > maxMidi && best - 12 >= 0) best -= 12;
  return Math.min(127, Math.max(0, best));
}
