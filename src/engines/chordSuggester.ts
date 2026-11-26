import type { ScaleType } from '../types/song';
import { noteNameToSemitone, semitoneToKeyName } from '../lib/chordUtils';
import { normalizeMasterGenreId, type MasterGenreId } from '../lib/masterGenres';

export type ChordSuggestionCategory =
  | 'diatonic'
  | 'rock_riff'
  | 'borrowed_secondary';

export interface ChordSuggestion {
  readonly chord: string;
  readonly roleLabel: string;
  readonly category: ChordSuggestionCategory;
  readonly priority: number; // lower = higher priority
}

const FLAT_PREFERRED_KEY_PCS = new Set([5, 10, 3, 8, 1]); // F, Bb, Eb, Ab, Db
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

function formatRootForKey(pc: number, keyRootPc: number, isMinor: boolean): string {
  const norm = ((pc % 12) + 12) % 12;
  if (FLAT_PREFERRED_KEY_PCS.has(((keyRootPc % 12) + 12) % 12) || (isMinor && (norm === 3 || norm === 8 || norm === 10))) {
    return FLAT_NAMES[norm];
  }
  return semitoneToKeyName(norm);
}

interface DiatonicDegreeSpec {
  offset: number;
  roman: string;
  triadSuffix: string;
  seventhSuffix: string;
  ninthSuffix?: string;
}

const MAJOR_DEGREES: readonly DiatonicDegreeSpec[] = [
  { offset: 0, roman: 'I', triadSuffix: '', seventhSuffix: 'maj7', ninthSuffix: 'add9' },
  { offset: 2, roman: 'II', triadSuffix: 'm', seventhSuffix: 'm7', ninthSuffix: 'm9' },
  { offset: 4, roman: 'III', triadSuffix: 'm', seventhSuffix: 'm7' },
  { offset: 5, roman: 'IV', triadSuffix: '', seventhSuffix: 'maj7', ninthSuffix: 'add9' },
  { offset: 7, roman: 'V', triadSuffix: '', seventhSuffix: '7', ninthSuffix: '9' },
  { offset: 9, roman: 'VI', triadSuffix: 'm', seventhSuffix: 'm7', ninthSuffix: 'm9' },
  { offset: 11, roman: 'VII', triadSuffix: 'dim', seventhSuffix: 'm7b5' },
];

const MINOR_DEGREES: readonly DiatonicDegreeSpec[] = [
  { offset: 0, roman: 'I', triadSuffix: 'm', seventhSuffix: 'm7', ninthSuffix: 'm9' },
  { offset: 2, roman: 'II', triadSuffix: 'dim', seventhSuffix: 'm7b5' },
  { offset: 3, roman: 'bIII', triadSuffix: '', seventhSuffix: 'maj7', ninthSuffix: 'add9' },
  { offset: 5, roman: 'IV', triadSuffix: 'm', seventhSuffix: 'm7', ninthSuffix: 'm9' },
  { offset: 7, roman: 'V', triadSuffix: 'm', seventhSuffix: 'm7' },
  { offset: 8, roman: 'bVI', triadSuffix: '', seventhSuffix: 'maj7', ninthSuffix: 'add9' },
  { offset: 10, roman: 'bVII', triadSuffix: '', seventhSuffix: '7', ninthSuffix: '9' },
];

function normalizeMode(keyMode: ScaleType | 'major' | 'minor' | string): boolean {
  return String(keyMode).toLowerCase() === 'minor';
}

/**
 * Returns prioritized chord suggestions for the active key, mode, genre, and cursor token.
 * Priority order when root matches:
 *   1. Diatonic (with Roman numeral role label, e.g. Am7 (VIm7), Am (VIm), Am9)
 *   2. Rock / Riff universal (A5 (Power), Asus2, Asus4)
 *   3. Secondary dominants / common borrowed chords (A7 (V7/ii), Amaj7 (借用), etc.)
 */
export function suggestChords(
  inputToken: string,
  keyRootPc: number,
  keyMode: ScaleType | 'major' | 'minor',
  genreId?: MasterGenreId | string
): ChordSuggestion[] {
  const isMinor = normalizeMode(keyMode);
  const normKeyPc = ((keyRootPc % 12) + 12) % 12;
  const normGenre = normalizeMasterGenreId(genreId);
  const degrees = isMinor ? MINOR_DEGREES : MAJOR_DEGREES;
  const trimmed = inputToken.trim();

  // Empty input -> return key diatonic 7ths + classic borrowed chords
  if (!trimmed) {
    const quick: ChordSuggestion[] = [];
    let prio = 1;
    for (const deg of degrees) {
      const root = formatRootForKey(normKeyPc + deg.offset, normKeyPc, isMinor);
      const chord = `${root}${deg.seventhSuffix}`;
      quick.push({
        chord,
        roleLabel: `${deg.roman}${deg.seventhSuffix}`,
        category: 'diatonic',
        priority: prio++,
      });
    }

    // Power chord tonic for rock/metal genres
    if (
      normGenre === 'numetal_mixture' ||
      normGenre === 'emo_jrock' ||
      normGenre === 'alt_shoegaze'
    ) {
      const tonicRoot = formatRootForKey(normKeyPc, normKeyPc, isMinor);
      const b2Root = formatRootForKey(normKeyPc + 1, normKeyPc, true);
      quick.push({
        chord: `${tonicRoot}5`,
        roleLabel: 'I5 (Power)',
        category: 'rock_riff',
        priority: prio++,
      });
      if (normGenre === 'numetal_mixture') {
        quick.push({
          chord: `${b2Root}5`,
          roleLabel: 'bII5 (Phrygian)',
          category: 'rock_riff',
          priority: prio++,
        });
      }
    }

    // Classic borrowed & secondary dominant chords
    const ivRoot = formatRootForKey(normKeyPc + 5, normKeyPc, isMinor);
    const bViRoot = formatRootForKey(normKeyPc + 8, normKeyPc, true);
    const bViiRoot = formatRootForKey(normKeyPc + 10, normKeyPc, true);
    const iiiRoot = formatRootForKey(normKeyPc + 4, normKeyPc, isMinor);
    const sharpIvRoot = formatRootForKey(normKeyPc + 6, normKeyPc, false);
    const vRoot = formatRootForKey(normKeyPc + 7, normKeyPc, isMinor);

    if (!isMinor) {
      quick.push(
        { chord: `${ivRoot}m`, roleLabel: 'IVm (借用)', category: 'borrowed_secondary', priority: prio++ },
        { chord: `${bViRoot}maj7`, roleLabel: 'bVI (借用)', category: 'borrowed_secondary', priority: prio++ },
        { chord: `${bViiRoot}7`, roleLabel: 'bVII (借用)', category: 'borrowed_secondary', priority: prio++ },
        { chord: `${iiiRoot}7`, roleLabel: 'V7/vi', category: 'borrowed_secondary', priority: prio++ },
        { chord: `${sharpIvRoot}dim7`, roleLabel: '#IVdim7', category: 'borrowed_secondary', priority: prio++ }
      );
    } else {
      quick.push(
        { chord: `${vRoot}7`, roleLabel: 'V7 (和声短)', category: 'borrowed_secondary', priority: prio++ },
        { chord: `${formatRootForKey(normKeyPc + 1, normKeyPc, true)}maj7`, roleLabel: 'bII (ナポリ)', category: 'borrowed_secondary', priority: prio++ },
        { chord: `${ivRoot}maj7`, roleLabel: 'IV (Dorian)', category: 'borrowed_secondary', priority: prio++ },
        { chord: `${sharpIvRoot}dim7`, roleLabel: '#IVdim7', category: 'borrowed_secondary', priority: prio++ }
      );
    }

    return quick;
  }

  // Parse root letter + optional accidental from user token (case-insensitive first letter)
  const rootMatch = trimmed.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!rootMatch) {
    return [];
  }

  const rootLetter = rootMatch[1].toUpperCase();
  const accidental = rootMatch[2] ?? '';
  const suffixQuery = (rootMatch[3] ?? '').toLowerCase();
  const displayRoot = `${rootLetter}${accidental}`;

  let targetPc: number;
  try {
    targetPc = noteNameToSemitone(displayRoot);
  } catch {
    return [];
  }

  const relDegree = ((targetPc - normKeyPc) % 12 + 12) % 12;
  const diatonicSpec = degrees.find((d) => d.offset === relDegree);
  const candidates: ChordSuggestion[] = [];
  const seen = new Set<string>();

  const pushUnique = (
    chord: string,
    roleLabel: string,
    category: ChordSuggestionCategory,
    priority: number
  ) => {
    if (seen.has(chord)) return;
    seen.add(chord);
    candidates.push({ chord, roleLabel, category, priority });
  };

  // 1. Diatonic highest priority
  if (diatonicSpec) {
    pushUnique(
      `${displayRoot}${diatonicSpec.seventhSuffix}`,
      `${diatonicSpec.roman}${diatonicSpec.seventhSuffix}`,
      'diatonic',
      10
    );
    pushUnique(
      `${displayRoot}${diatonicSpec.triadSuffix}`,
      `${diatonicSpec.roman}${diatonicSpec.triadSuffix}`,
      'diatonic',
      11
    );
    if (diatonicSpec.ninthSuffix) {
      pushUnique(
        `${displayRoot}${diatonicSpec.ninthSuffix}`,
        `${diatonicSpec.roman}${diatonicSpec.ninthSuffix}`,
        'diatonic',
        12
      );
    }
  }

  // 2. Rock / Riff universal (Power chord, sus2, sus4)
  pushUnique(`${displayRoot}5`, 'Power', 'rock_riff', 20);
  pushUnique(`${displayRoot}sus2`, 'sus2', 'rock_riff', 21);
  pushUnique(`${displayRoot}sus4`, 'sus4', 'rock_riff', 22);

  // 3. Secondary dominants & common borrowed chords
  const secondaryLabelMapMajor: Partial<Record<number, string>> = {
    0: 'V7/IV',
    2: 'V7/V',
    4: 'V7/vi',
    9: 'V7/ii',
    11: 'V7/iii',
    1: 'SubV7/I',
    10: 'bVII7 (借用)',
  };
  const secondaryLabelMapMinor: Partial<Record<number, string>> = {
    7: 'V7 (和声短)',
    2: 'V7/v',
    0: 'V7/iv',
    5: 'V7/bVII',
    1: 'SubV7/i',
  };
  const secLabel = (isMinor ? secondaryLabelMapMinor : secondaryLabelMapMajor)[relDegree];

  pushUnique(
    `${displayRoot}7`,
    secLabel ?? 'Dom7 (借用)',
    'borrowed_secondary',
    30
  );
  pushUnique(
    `${displayRoot}maj7`,
    relDegree === 8 || relDegree === 10 || relDegree === 1
      ? '借用 (Modal)'
      : '借用',
    'borrowed_secondary',
    31
  );
  pushUnique(
    `${displayRoot}m7`,
    relDegree === 5 && !isMinor ? 'IVm7 (借用)' : '借用',
    'borrowed_secondary',
    32
  );
  pushUnique(
    `${displayRoot}m`,
    relDegree === 5 && !isMinor ? 'IVm (借用)' : '借用',
    'borrowed_secondary',
    33
  );
  pushUnique(`${displayRoot}`, 'Major', 'borrowed_secondary', 34);
  pushUnique(
    `${displayRoot}dim7`,
    relDegree === 6 ? '#IVdim7 (経過)' : 'dim7 (経過)',
    'borrowed_secondary',
    35
  );
  pushUnique(`${displayRoot}m7b5`, 'm7b5', 'borrowed_secondary', 36);

  // Filter by typed suffix prefix if user typed more than just the root
  const filtered = suffixQuery
    ? candidates.filter((c) => {
        const candSuffix = c.chord.slice(displayRoot.length).toLowerCase();
        return (
          candSuffix.startsWith(suffixQuery) ||
          c.chord.toLowerCase().startsWith(trimmed.toLowerCase())
        );
      })
    : candidates;

  const finalList = filtered.length > 0 ? filtered : candidates;
  return finalList.sort((a, b) => a.priority - b.priority).slice(0, 10);
}
