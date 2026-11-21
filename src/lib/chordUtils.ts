import type { ChordSlot, KeyName, ScaleType } from '../types/song';

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

export type ChordPaletteMode =
  | 'triad'
  | 'seventh'
  | 'ninth'
  | 'add9sus'
  | 'power';

export interface ParsedChord {
  raw: string;
  root: KeyName;
  rootSemitone: number; // 0..11 (C=0)
  rootPitchClass: number; // 0..11 alias
  quality: ChordQuality;
  tensions: string[];
  bass?: KeyName;
  bassSemitone?: number;
  bassPitchClass?: number;
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

function splitSlashChord(trimmed: string): { mainPart: string; slashPart?: string } {
  const slashIdx = trimmed.lastIndexOf('/');
  if (slashIdx === -1) {
    return { mainPart: trimmed };
  }
  const candidateBass = trimmed.slice(slashIdx + 1).trim();
  // Keep 6/9 style numeric slash if right-hand side is not a note name
  if (/^[A-G][#b]?$/.test(candidateBass)) {
    return {
      mainPart: trimmed.slice(0, slashIdx).trim(),
      slashPart: candidateBass,
    };
  }
  return { mainPart: trimmed };
}

export function parseChord(chordName: string): ParsedChord {
  const trimmed = chordName.trim();
  if (!trimmed) {
    throw new Error('Empty chord name');
  }

  const { mainPart, slashPart } = splitSlashChord(trimmed);
  const rootMatch = mainPart.match(/^([A-G])([#b]?)(.*)$/);
  if (!rootMatch) {
    throw new Error(`Invalid chord name: "${chordName}"`);
  }

  const rawRoot = rootMatch[1] + rootMatch[2];
  const rootSemitone = noteNameToSemitone(rawRoot);
  const root = semitoneToKeyName(rootSemitone);
  const suffix = rootMatch[3].trim();

  let bass: KeyName | undefined;
  let bassSemitone: number | undefined;
  if (slashPart !== undefined) {
    if (!/^([A-G][#b]?)$/.test(slashPart)) {
      throw new Error(`Invalid slash bass in chord: "${chordName}"`);
    }
    bassSemitone = noteNameToSemitone(slashPart);
    bass = semitoneToKeyName(bassSemitone);
  }

  let quality: ChordQuality = 'major';
  let intervals: number[] = [0, 4, 7];
  const tensions: string[] = [];

  if (suffix === '5') {
    quality = 'power';
    intervals = [0, 7];
  } else if (
    suffix === 'mM7' ||
    suffix === 'mMaj7' ||
    suffix === 'm(maj7)' ||
    suffix === 'm△7'
  ) {
    quality = 'minor';
    intervals = [0, 3, 7, 11];
    tensions.push('maj7');
  } else if (suffix === 'm7b5' || suffix === 'm7-5' || suffix === 'ø' || suffix === 'ø7') {
    quality = 'dim';
    intervals = [0, 3, 6, 10];
    tensions.push('b5', '7');
  } else if (suffix === 'dim7') {
    quality = 'dim';
    intervals = [0, 3, 6, 9];
    tensions.push('dim7');
  } else if (suffix === 'dim') {
    quality = 'dim';
    intervals = [0, 3, 6];
  } else if (suffix === '7sus4') {
    quality = 'sus4';
    intervals = [0, 5, 7, 10];
    tensions.push('7');
  } else if (suffix === 'sus4' || suffix === 'sus') {
    quality = 'sus4';
    intervals = [0, 5, 7];
  } else if (suffix === 'sus2') {
    quality = 'sus2';
    intervals = [0, 2, 7];
  } else if (suffix === 'aug' || suffix === '+') {
    quality = 'aug';
    intervals = [0, 4, 8];
  } else if (suffix === 'M9' || suffix === 'maj9' || suffix === '△9') {
    quality = 'major';
    intervals = [0, 4, 7, 11, 14];
    tensions.push('maj7', '9');
  } else if (suffix === 'M7' || suffix === 'maj7' || suffix === '△7') {
    quality = 'major';
    intervals = [0, 4, 7, 11];
    tensions.push('maj7');
  } else if (suffix === '69' || suffix === '6/9') {
    quality = 'major';
    intervals = [0, 4, 7, 9, 14];
    tensions.push('6', '9');
  } else if (suffix === 'madd9' || suffix === 'm(add9)') {
    quality = 'minor';
    intervals = [0, 3, 7, 14];
    tensions.push('add9');
  } else if (suffix === 'm9') {
    quality = 'minor';
    intervals = [0, 3, 7, 10, 14];
    tensions.push('7', '9');
  } else if (suffix === 'm7') {
    quality = 'minor';
    intervals = [0, 3, 7, 10];
    tensions.push('7');
  } else if (suffix === 'm6') {
    quality = 'minor';
    intervals = [0, 3, 7, 9];
    tensions.push('6');
  } else if (suffix === 'm') {
    quality = 'minor';
    intervals = [0, 3, 7];
  } else if (suffix === 'add9' || suffix === '(add9)') {
    quality = 'major';
    intervals = [0, 4, 7, 14];
    tensions.push('add9');
  } else if (suffix === '9') {
    quality = 'major';
    intervals = [0, 4, 7, 10, 14];
    tensions.push('7', '9');
  } else if (suffix === '7') {
    quality = 'major';
    intervals = [0, 4, 7, 10];
    tensions.push('7');
  } else if (suffix === '6') {
    quality = 'major';
    intervals = [0, 4, 7, 9];
    tensions.push('6');
  } else if (suffix === '') {
    quality = 'major';
    intervals = [0, 4, 7];
  } else {
    // General fallback parser for compound suffixes (e.g. aug7, M7add9)
    if (suffix.startsWith('dim')) {
      quality = 'dim';
      intervals = [0, 3, 6];
    } else if (suffix.startsWith('aug') || suffix.startsWith('+')) {
      quality = 'aug';
      intervals = [0, 4, 8];
    } else if (suffix.includes('sus2')) {
      quality = 'sus2';
      intervals = [0, 2, 7];
    } else if (suffix.includes('sus4')) {
      quality = 'sus4';
      intervals = [0, 5, 7];
    } else if (suffix.startsWith('m') && !suffix.startsWith('maj')) {
      quality = 'minor';
      intervals = [0, 3, 7];
    }

    if (
      suffix.includes('maj7') ||
      suffix.includes('Maj7') ||
      suffix.includes('M7') ||
      suffix.includes('△7') ||
      suffix.includes('maj9') ||
      suffix.includes('M9')
    ) {
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
  }

  return {
    raw: trimmed,
    root,
    rootSemitone,
    rootPitchClass: rootSemitone,
    quality,
    tensions,
    bass,
    bassSemitone,
    bassPitchClass: bassSemitone,
    intervals,
  };
}

export function getDiatonicChords(key: KeyName, scale: ScaleType): string[] {
  const rootIdx = noteNameToSemitone(key);
  if (scale === 'Major') {
    const offsets = [0, 2, 4, 5, 7, 9, 11];
    const suffixes = ['', 'm', 'm', '', '', 'm', 'm7b5'];
    return offsets.map(
      (off, i) => `${semitoneToKeyName(rootIdx + off)}${suffixes[i]}`
    );
  }
  const offsets = [0, 2, 3, 5, 7, 8, 10];
  const suffixes = ['m', 'm7b5', '', 'm', 'm', '', ''];
  return offsets.map(
    (off, i) => `${semitoneToKeyName(rootIdx + off)}${suffixes[i]}`
  );
}

export function getChordPalette(
  key: KeyName,
  scale: ScaleType,
  mode: ChordPaletteMode
): string[] {
  const rootIdx = noteNameToSemitone(key);
  const offsets =
    scale === 'Major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const roots = offsets.map((off) => semitoneToKeyName(rootIdx + off));

  if (mode === 'triad') {
    return getDiatonicChords(key, scale);
  }

  if (mode === 'seventh') {
    const suffixes =
      scale === 'Major'
        ? ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5']
        : ['m7', 'm7b5', 'maj7', 'm7', 'm7', 'maj7', '7'];
    return roots.map((r, i) => `${r}${suffixes[i]}`);
  }

  if (mode === 'ninth') {
    const suffixes =
      scale === 'Major'
        ? ['maj9', 'm9', 'm9', 'maj9', '9', 'm9', 'm7b5']
        : ['m9', 'm7b5', 'maj9', 'm9', 'm9', 'maj9', '9'];
    return roots.map((r, i) => `${r}${suffixes[i]}`);
  }

  if (mode === 'add9sus') {
    if (scale === 'Major') {
      return [
        `${roots[0]}add9`,
        `${roots[0]}sus2`,
        `${roots[1]}m(add9)`,
        `${roots[3]}add9`,
        `${roots[4]}sus4`,
        `${roots[5]}m(add9)`,
        `${roots[5]}sus2`,
      ];
    }
    return [
      `${roots[0]}m(add9)`,
      `${roots[0]}sus2`,
      `${roots[2]}add9`,
      `${roots[3]}sus2`,
      `${roots[4]}m7`,
      `${roots[5]}add9`,
      `${roots[6]}sus4`,
    ];
  }

  // 'power'
  return roots.map((r) => `${r}5`);
}

export function applySuffixToChord(
  chordName: string,
  newSuffix: string
): string {
  const trimmed = chordName.trim();
  const { mainPart, slashPart } = splitSlashChord(trimmed);
  const rootMatch = mainPart.match(/^([A-G][#b]?)(.*)$/);
  if (!rootMatch) return chordName;
  const base = `${rootMatch[1]}${newSuffix}`;
  return slashPart ? `${base}/${slashPart}` : base;
}

export function getDefaultProgression(key: KeyName, scale: ScaleType): string[] {
  const diatonic = getDiatonicChords(key, scale);
  if (scale === 'Minor') {
    return [diatonic[0], diatonic[5], diatonic[2], diatonic[6]];
  }
  return [diatonic[0], diatonic[4], diatonic[5], diatonic[3]];
}

export function resolveChordForBar(
  chords: readonly ChordSlot[] | readonly string[],
  barIndex: number,
  key: KeyName,
  scale: ScaleType
): ParsedChord {
  const effectiveStrings: string[] =
    chords.length > 0
      ? typeof chords[0] === 'string'
        ? (chords as readonly string[]).slice()
        : (chords as readonly ChordSlot[]).map((c) => c.chord)
      : getDefaultProgression(key, scale);
  const raw = effectiveStrings[barIndex % effectiveStrings.length];
  try {
    return parseChord(raw);
  } catch {
    return parseChord(getDefaultProgression(key, scale)[0]);
  }
}

export function transposeChord(chordName: string, semitones: number): string {
  const trimmed = chordName.trim();
  const { mainPart, slashPart } = splitSlashChord(trimmed);
  const rootMatch = mainPart.match(/^([A-G][#b]?)(.*)$/);
  if (!rootMatch) return chordName;

  const newRoot = semitoneToKeyName(
    noteNameToSemitone(rootMatch[1]) + semitones
  );
  let result = `${newRoot}${rootMatch[2]}`;
  if (slashPart) {
    const newBass = semitoneToKeyName(
      noteNameToSemitone(slashPart) + semitones
    );
    result += `/${newBass}`;
  }
  return result;
}

export function transposeChords(
  chords: readonly string[],
  semitones: number
): string[] {
  return chords.map((c) => transposeChord(c, semitones));
}

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
  const mid = Math.round((minMidi + maxMidi) / 2);
  let best = Math.floor(mid / 12) * 12 + pc;
  while (best < minMidi) best += 12;
  while (best > maxMidi && best - 12 >= 0) best -= 12;
  return Math.min(127, Math.max(0, best));
}

export function getScaleIntervals(scale: ScaleType): readonly number[] {
  return scale === 'Major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

export function getScalePitchClasses(key: KeyName, scale: ScaleType): number[] {
  const root = noteNameToSemitone(key);
  return getScaleIntervals(scale).map((iv) => (root + iv) % 12);
}

export function snapPitchToScale(
  pitch: number,
  key: KeyName,
  scale: ScaleType,
  minMidi = 48,
  maxMidi = 76
): number {
  const rounded = Math.round(pitch);
  let clamped = rounded;
  while (clamped < minMidi) clamped += 12;
  while (clamped > maxMidi) clamped -= 12;
  clamped = Math.min(maxMidi, Math.max(minMidi, clamped));

  const scalePcs = new Set(getScalePitchClasses(key, scale));
  if (scalePcs.has(((clamped % 12) + 12) % 12)) {
    return clamped;
  }

  let bestPitch = clamped;
  let bestDist = Infinity;
  for (let p = minMidi; p <= maxMidi; p++) {
    if (!scalePcs.has(p % 12)) continue;
    const dist = Math.abs(p - clamped);
    if (dist < bestDist) {
      bestDist = dist;
      bestPitch = p;
    }
  }
  return bestPitch;
}
