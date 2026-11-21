import type { KeyName, ScaleType } from '../types/song';
import {
  applySuffixToChord,
  getChordPalette,
  getDiatonicChords,
  noteNameToSemitone,
  semitoneToKeyName,
} from './chordUtils';

export type PaletteModifier = 'triad' | 'seventh' | 'sus4' | 'add9' | 'dim';

export type PaletteTab = 'diatonic' | 'substitute';

export interface SubstituteChordOption {
  chord: string;
  roleTag: string;
  degreeLabel: string;
}

const FLAT_ENHARMONICS: Record<number, string> = {
  1: 'Db',
  3: 'Eb',
  6: 'Gb',
  8: 'Ab',
  10: 'Bb',
};

function semitoneToFlatPreferredName(semitone: number): string {
  const mod = ((semitone % 12) + 12) % 12;
  return FLAT_ENHARMONICS[mod] ?? semitoneToKeyName(mod);
}

export function applyChordModifier(
  chordName: string,
  modifier: PaletteModifier
): string {
  if (modifier === 'dim') {
    return applySuffixToChord(chordName, 'dim7');
  }
  if (modifier === 'sus4' || modifier === 'add9') {
    return applySuffixToChord(chordName, modifier);
  }
  return chordName;
}

export function getDiatonicPaletteChords(
  key: KeyName,
  scale: ScaleType,
  modifier: PaletteModifier
): string[] {
  const baseDiatonic = getDiatonicChords(key, scale);
  if (modifier === 'triad') {
    return baseDiatonic;
  }
  if (modifier === 'seventh') {
    return getChordPalette(key, scale, 'seventh').slice(0, 7);
  }
  return baseDiatonic.map((ch) => applyChordModifier(ch, modifier));
}

/**
 * Computes passing diminished (#Idim7, #IIdim7, #IVdim7, #Vdim7),
 * secondary dominants + tritone substitute (VI7, II7, III7, bII7),
 * and borrowed subdominant minor / modal interchange chords (IVm7, bVImaj7, bVII7).
 */
export function getSubstituteChordPalette(
  key: KeyName,
  _scale: ScaleType
): SubstituteChordOption[] {
  const root = noteNameToSemitone(key);

  return [
    // 1. Passing Diminished
    {
      chord: `${semitoneToKeyName(root + 1)}dim7`,
      roleTag: '経過dim',
      degreeLabel: '#Idim7',
    },
    {
      chord: `${semitoneToKeyName(root + 3)}dim7`,
      roleTag: '経過dim',
      degreeLabel: '#IIdim7',
    },
    {
      chord: `${semitoneToKeyName(root + 6)}dim7`,
      roleTag: '経過dim',
      degreeLabel: '#IVdim7',
    },
    {
      chord: `${semitoneToKeyName(root + 8)}dim7`,
      roleTag: '経過dim',
      degreeLabel: '#Vdim7',
    },
    // 2. Secondary Dominants & Tritone Substitute
    {
      chord: `${semitoneToKeyName(root + 9)}7`,
      roleTag: '副属V',
      degreeLabel: 'VI7',
    },
    {
      chord: `${semitoneToKeyName(root + 2)}7`,
      roleTag: '副属V',
      degreeLabel: 'II7',
    },
    {
      chord: `${semitoneToKeyName(root + 4)}7`,
      roleTag: '副属V',
      degreeLabel: 'III7',
    },
    {
      chord: `${semitoneToFlatPreferredName(root + 1)}7`,
      roleTag: '裏コード',
      degreeLabel: '♭II7',
    },
    // 3. Subdominant Minor / Modal Interchange
    {
      chord: `${semitoneToKeyName(root + 5)}m7`,
      roleTag: '借用IVm',
      degreeLabel: 'IVm7',
    },
    {
      chord: `${semitoneToFlatPreferredName(root + 8)}maj7`,
      roleTag: '借用♭VI',
      degreeLabel: '♭VImaj7',
    },
    {
      chord: `${semitoneToFlatPreferredName(root + 10)}7`,
      roleTag: '借用♭VII',
      degreeLabel: '♭VII7',
    },
  ];
}
