import {
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  type ChordEvent,
  type ChordScaleName,
  type ChordSlot,
  type HarmonicFunction,
  type KeyName,
  type ScaleType,
  type Section,
  type SectionType,
} from '../types/song';
import {
  getScalePitchClasses,
  KEY_NAMES,
  noteNameToSemitone,
  parseChord,
  type ParsedChord,
} from '../lib/chordUtils';
import { normalizeMasterGenreId, type MasterGenreId } from '../lib/masterGenres';
import { buildChordWindows, deriveSubSeed, mulberry32 } from './musicCore';

// ===========================================================================
// 1. Circle of Fifths & Dynamic Berklee Chord-Scale Dictionary (ChordEvent)
// ===========================================================================
const PC_TO_SHARP_FIFTH_INDEX: readonly number[] = [
  0, // C
  7, // C#
  2, // D
  -3, // Eb / D#
  4, // E
  -1, // F
  6, // F#
  1, // G
  -4, // Ab / G#
  3, // A
  -2, // Bb / A#
  5, // B
];

export function pitchClassToFifthIndex(
  pc: number,
  localKeyRootPc = 0,
  preferFlats = false
): number {
  const norm = ((pc % 12) + 12) % 12;
  const keyBase = PC_TO_SHARP_FIFTH_INDEX[((localKeyRootPc % 12) + 12) % 12];
  let idx = PC_TO_SHARP_FIFTH_INDEX[norm];
  if (preferFlats && idx > 5) idx -= 12;
  // Keep spelling close to local key on the line of fifths
  while (idx - keyBase > 6) idx -= 12;
  while (keyBase - idx > 6) idx += 12;
  return idx;
}

const SCALE_INTERVALS: Record<ChordScaleName, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  lydian_dominant: [0, 2, 4, 6, 7, 9, 10],
  altered: [0, 1, 3, 4, 6, 8, 10],
  half_whole_dim: [0, 1, 3, 4, 6, 7, 9, 10],
  phrygian_dominant: [0, 1, 4, 5, 7, 8, 10],
};

function computeRomanSymbol(
  rootPc: number,
  quality: string,
  keyRootPc: number,
  mode: ScaleType
): string {
  const rel = ((rootPc - keyRootPc) % 12 + 12) % 12;
  const romansMajor = [
    'I',
    'bII',
    'II',
    'bIII',
    'III',
    'IV',
    '#IV',
    'V',
    'bVI',
    'VI',
    'bVII',
    'VII',
  ];
  const romansMinor = [
    'I',
    'bII',
    'II',
    'bIII',
    'III',
    'IV',
    '#IV',
    'V',
    'bVI',
    'VI',
    'bVII',
    'VII',
  ];
  const base = mode === 'Minor' ? romansMinor[rel] : romansMajor[rel];
  if (quality === 'minor') return base.toLowerCase();
  if (quality === 'dim') return `${base.toLowerCase()}dim`;
  if (quality === 'aug') return `${base}+`;
  return base;
}

export function analyzeParsedChordToEvent(options: {
  parsed: ParsedChord;
  startTick: number;
  durationTicks: number;
  key: KeyName;
  scale: ScaleType;
}): ChordEvent {
  const { parsed, startTick, durationTicks, key, scale } = options;
  const localKeyRootPc = noteNameToSemitone(key);
  const parentScalePcs = new Set(getScalePitchClasses(key, scale));
  const rootPc = parsed.rootPitchClass;
  const bassPc = parsed.bassPitchClass ?? rootPc;
  const relDegree = ((rootPc - localKeyRootPc) % 12 + 12) % 12;
  const rawSym = parsed.raw;

  const hasFlat9 =
    parsed.tensions.includes('b9') || parsed.intervals.includes(13) || parsed.intervals.includes(1);
  const hasSharp9 =
    parsed.tensions.includes('#9') || parsed.intervals.includes(15);
  const hasSharp11 =
    parsed.tensions.includes('#11') || parsed.intervals.includes(18) || rawSym.includes('#11');
  const hasFlat13 =
    parsed.tensions.includes('b13') || parsed.intervals.includes(20) || rawSym.includes('b13');
  const has13 =
    parsed.tensions.includes('13') || parsed.intervals.includes(21) || rawSym.includes('13');
  const isDom7 =
    parsed.quality === 'major' &&
    parsed.intervals.some((iv) => iv % 12 === 10);
  const isMaj7 =
    parsed.quality === 'major' &&
    parsed.intervals.some((iv) => iv % 12 === 11);
  const isHalfDim =
    parsed.quality === 'dim' &&
    parsed.intervals.some((iv) => iv % 12 === 10);
  const isFullDim7 =
    parsed.quality === 'dim' &&
    parsed.intervals.some((iv) => iv % 12 === 9);

  // Base chord tones (with Berklee V7(b13) 5th-omission & V13 11th-omission rules)
  let chordToneIntervals = parsed.intervals.map((iv) => ((iv % 12) + 12) % 12);
  if (isDom7 && hasFlat13) {
    // Berklee: omit natural 5th when b13 is voiced
    chordToneIntervals = chordToneIntervals.filter((iv) => iv !== 7);
    if (!chordToneIntervals.includes(8)) chordToneIntervals.push(8);
  }
  if (isDom7 && has13) {
    // Berklee: omit 11th when 13th is voiced
    chordToneIntervals = chordToneIntervals.filter((iv) => iv !== 5);
    if (!chordToneIntervals.includes(9)) chordToneIntervals.push(9);
  }
  const chordTonePcs = Array.from(
    new Set(chordToneIntervals.map((iv) => (rootPc + iv) % 12))
  );

  const isNonDiatonic = chordTonePcs.some((pc) => !parentScalePcs.has(pc));

  // Determine ChordScale & HarmonicFunction & Berklee Avoids
  let chordScale: ChordScaleName = 'ionian';
  let harmonicFunction: HarmonicFunction = 'T';
  let avoidRel: number[] = [];
  let tensionRel: number[] = [];

  if (isFullDim7) {
    chordScale = 'half_whole_dim';
    harmonicFunction = 'D';
    tensionRel = [2, 5, 8, 11];
    avoidRel = [];
  } else if (isHalfDim) {
    chordScale = 'locrian';
    harmonicFunction = scale === 'Minor' && relDegree === 2 ? 'SD' : 'D';
    tensionRel = [3, 8];
    avoidRel = [1];
  } else if (isDom7) {
    harmonicFunction = 'D';
    if (hasFlat9 || hasSharp9 || (hasFlat13 && isNonDiatonic && relDegree === 4)) {
      chordScale = relDegree === 7 && scale === 'Minor' ? 'phrygian_dominant' : 'altered';
      tensionRel = [1, 3, 6, 8];
      avoidRel = [];
    } else if (hasSharp11 || (isNonDiatonic && (relDegree === 1 || relDegree === 10 || relDegree === 6))) {
      // SubV7 / bVII7 -> Lydian Dominant (no avoid!)
      chordScale = 'lydian_dominant';
      tensionRel = [2, 6, 9];
      avoidRel = [];
    } else {
      // Standard V7 Mixolydian: 11th (rel 5) is avoid; if 13th used, 11th strictly omitted
      chordScale = 'mixolydian';
      tensionRel = hasFlat13 ? [2, 8] : [2, 9];
      avoidRel = [5];
    }
  } else if (parsed.quality === 'minor') {
    if (scale === 'Major') {
      if (relDegree === 2) {
        // Berklee exception: Major IIm7 (Dorian) -> 13th (rel 9) is avoid (tritone with F)!
        chordScale = 'dorian';
        harmonicFunction = 'SD';
        tensionRel = [2, 5];
        avoidRel = [9];
      } else if (relDegree === 4) {
        // IIIm7 (Phrygian)
        chordScale = 'phrygian';
        harmonicFunction = 'T';
        tensionRel = [5];
        avoidRel = [1, 8];
      } else if (relDegree === 5) {
        // Borrowed IVm (Melodic Minor / Dorian b6)
        chordScale = 'melodic_minor';
        harmonicFunction = 'SD';
        tensionRel = [2, 5, 9];
        avoidRel = [];
      } else {
        // VIm7 (Aeolian)
        chordScale = 'aeolian';
        harmonicFunction = 'T';
        tensionRel = [2, 5];
        avoidRel = [8];
      }
    } else {
      // Minor key
      if (relDegree === 0) {
        chordScale = 'aeolian';
        harmonicFunction = 'T';
        tensionRel = [2, 5];
        avoidRel = [8];
      } else if (relDegree === 5) {
        // ivm7 in minor -> Dorian
        chordScale = 'dorian';
        harmonicFunction = 'SD';
        tensionRel = [2, 5];
        avoidRel = [9];
      } else {
        chordScale = 'phrygian';
        harmonicFunction = 'MODAL';
        tensionRel = [5];
        avoidRel = [1, 8];
      }
    }
  } else {
    // Major / sus / power
    if (
      hasSharp11 ||
      (scale === 'Major' && (relDegree === 5 || relDegree === 8 || relDegree === 1 || relDegree === 10)) ||
      (scale === 'Minor' && (relDegree === 8 || relDegree === 5 || relDegree === 1))
    ) {
      // IVmaj7 / bVImaj7 / bIImaj7 -> Lydian: ZERO avoid notes!
      chordScale = 'lydian';
      harmonicFunction = relDegree === 0 ? 'T' : 'SD';
      tensionRel = [2, 6, 9];
      avoidRel = [];
    } else if (
      (scale === 'Major' && relDegree === 7) ||
      (scale === 'Minor' && relDegree === 10)
    ) {
      chordScale = 'mixolydian';
      harmonicFunction = relDegree === 7 ? 'D' : 'MODAL';
      tensionRel = [2, 9];
      avoidRel = [5];
    } else {
      // Imaj7 / bIIImaj7 -> Ionian: 11th (rel 5) is avoid
      chordScale = 'ionian';
      harmonicFunction = 'T';
      tensionRel = isMaj7 ? [2, 9] : [2, 9];
      avoidRel = [5];
    }
  }

  const scalePcs = SCALE_INTERVALS[chordScale].map((iv) => (rootPc + iv) % 12);
  const availableTensionPcs = tensionRel.map((iv) => (rootPc + iv) % 12);
  const avoidPcs = avoidRel.map((iv) => (rootPc + iv) % 12);

  // Guide tones: 3rd (or sus) and 7th (or 6th)
  const guideTonePcs: number[] = [];
  for (const iv of chordToneIntervals) {
    if (iv === 3 || iv === 4 || iv === 2 || iv === 5) {
      guideTonePcs.push((rootPc + iv) % 12);
    }
    if (iv === 9 || iv === 10 || iv === 11) {
      guideTonePcs.push((rootPc + iv) % 12);
    }
  }

  // Non-diatonic hook pitch classes (color tones outside parent scale)
  const hookPcs = isNonDiatonic
    ? Array.from(
        new Set(
          [...chordTonePcs, ...availableTensionPcs].filter(
            (pc) => !parentScalePcs.has(pc)
          )
        )
      )
    : [];

  const preferFlats =
    rawSym.includes('b') || key === 'F' || scale === 'Minor';
  const fifthLineIndices = chordTonePcs.map((pc) =>
    pitchClassToFifthIndex(pc, localKeyRootPc, preferFlats)
  );

  return {
    startTick,
    durationTicks,
    localKeyRootPc,
    localKeyMode: scale,
    romanSymbol: computeRomanSymbol(rootPc, parsed.quality, localKeyRootPc, scale),
    chordSymbol: rawSym,
    rootPc,
    bassPc,
    quality: parsed.quality,
    harmonicFunction,
    isNonDiatonic,
    fifthLineIndices,
    chordTonePcs,
    guideTonePcs: Array.from(new Set(guideTonePcs)),
    availableTensionPcs,
    avoidPcs,
    scalePcs,
    hookPcs,
    chordScale,
  };
}

export function buildSectionChordEvents(
  section: Section,
  key: KeyName,
  scale: ScaleType
): ChordEvent[] {
  const windows = buildChordWindows(section, key, scale);
  return windows.map((w) =>
    analyzeParsedChordToEvent({
      parsed: w.parsed,
      startTick: w.startTick,
      durationTicks: Math.max(60, w.endTick - w.startTick),
      key,
      scale,
    })
  );
}

// ===========================================================================
// 2. Chew's Spiral Array 3D Model (Cloud Diameter & Tensile Strain)
// ===========================================================================
const SPIRAL_H = Math.sqrt(2 / 15);

function spiralPoint(fifthIndex: number): [number, number, number] {
  const angle = (fifthIndex * Math.PI) / 2;
  return [Math.sin(angle), Math.cos(angle), fifthIndex * SPIRAL_H];
}

function dist3d(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function computeTonicKeyCenter(
  keyRootPc: number,
  scale: ScaleType
): [number, number, number] {
  const k0 = pitchClassToFifthIndex(keyRootPc, keyRootPc, scale === 'Minor');
  // Triad centers: I, IV, V weighted [0.5, 0.25, 0.25]
  const triadCenter = (rootK: number, minor: boolean): [number, number, number] => {
    const pRoot = spiralPoint(rootK);
    const pFifth = spiralPoint(rootK + 1);
    const pThird = spiralPoint(minor ? rootK - 3 : rootK + 4);
    return [
      0.5 * pRoot[0] + 0.3 * pFifth[0] + 0.2 * pThird[0],
      0.5 * pRoot[1] + 0.3 * pFifth[1] + 0.2 * pThird[1],
      0.5 * pRoot[2] + 0.3 * pFifth[2] + 0.2 * pThird[2],
    ];
  };
  const isMin = scale === 'Minor';
  const cT = triadCenter(k0, isMin);
  const cSD = triadCenter(k0 - 1, isMin);
  const cD = triadCenter(k0 + 1, false);
  return [
    0.5 * cT[0] + 0.25 * cSD[0] + 0.25 * cD[0],
    0.5 * cT[1] + 0.25 * cSD[1] + 0.25 * cD[1],
    0.5 * cT[2] + 0.25 * cSD[2] + 0.25 * cD[2],
  ];
}

export function evaluateSpiralArrayMetrics(
  events: readonly ChordEvent[],
  key: KeyName,
  scale: ScaleType
): { avgCloudDiameter: number; avgTensileStrain: number } {
  if (events.length === 0) {
    return { avgCloudDiameter: 0, avgTensileStrain: 0 };
  }
  const keyCenter = computeTonicKeyCenter(noteNameToSemitone(key), scale);
  let totalDur = 0;
  let weightedDiam = 0;
  let weightedStrain = 0;

  for (const ev of events) {
    const dur = Math.max(1, ev.durationTicks);
    const pts = ev.fifthLineIndices.map((idx) => spiralPoint(idx));
    let maxPairDist = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = dist3d(pts[i], pts[j]);
        if (d > maxPairDist) maxPairDist = d;
      }
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    const n = Math.max(1, pts.length);
    const centroid: [number, number, number] = [cx / n, cy / n, cz / n];
    const strain = dist3d(centroid, keyCenter);

    weightedDiam += maxPairDist * dur;
    weightedStrain += strain * dur;
    totalDur += dur;
  }

  return {
    avgCloudDiameter: weightedDiam / totalDur,
    avgTensileStrain: weightedStrain / totalDur,
  };
}

// ===========================================================================
// 3. 5-Genre × 3-Mode Harmony Generator + 16-Candidate Spiral Array Selection
// ===========================================================================
function pcName(pc: number): KeyName {
  return KEY_NAMES[((pc % 12) + 12) % 12];
}

function buildChordSym(rootPc: number, suffix: string, bassPc?: number): string {
  const r = pcName(rootPc);
  if (bassPc !== undefined && ((bassPc - rootPc + 12) % 12) !== 0) {
    return `${r}${suffix}/${pcName(bassPc)}`;
  }
  return `${r}${suffix}`;
}

interface RawSlotDraft {
  chord: string;
  durationBeats: number;
}

function buildModeACandidate(
  genreId: MasterGenreId,
  sectionType: SectionType,
  keyRootPc: number,
  scale: ScaleType,
  bars: number,
  bpm: number,
  rng: () => number
): RawSlotDraft[] {
  const isMinor = scale === 'Minor';
  // Normalize relative major root for functional templates
  const relMajorPc = isMinor ? (keyRootPc + 3) % 12 : keyRootPc;
  const I = relMajorPc;
  const II = (relMajorPc + 2) % 12;
  const III = (relMajorPc + 4) % 12;
  const IV = (relMajorPc + 5) % 12;
  const sIV = (relMajorPc + 6) % 12;
  const V = (relMajorPc + 7) % 12;
  const VI = (relMajorPc + 9) % 12;

  const rich = genreId === 'chill_ballad' || genreId === 'royal_jpop';
  const majSuf = rich ? 'maj7' : '';
  const minSuf = rich ? 'm7' : 'm';
  const domSuf = rich ? '7' : '';

  // Base 4-chord functional cells (J-POP Chorus strictly avoids starting on I!)
  const chorusTemplates: Array<Array<{ root: number; suf: string; bass?: number }>> = [
    // Royal Road (IV -> V -> IIIm -> VIm)
    [
      { root: IV, suf: majSuf },
      { root: V, suf: domSuf },
      { root: III, suf: minSuf },
      { root: VI, suf: minSuf },
    ],
    // Komuro / Emotional Minor (VIm -> IV -> V -> I, starts on VIm not I!)
    [
      { root: VI, suf: minSuf },
      { root: IV, suf: majSuf },
      { root: V, suf: domSuf },
      { root: I, suf: majSuf },
    ],
    // Subdominant climb (IIm7 -> V7 -> IIIm7 -> VIm7)
    [
      { root: II, suf: minSuf },
      { root: V, suf: domSuf },
      { root: III, suf: minSuf },
      { root: VI, suf: minSuf },
    ],
    // Descending slash bass from VIm or IV
    [
      { root: IV, suf: majSuf },
      { root: V, suf: domSuf, bass: IV },
      { root: III, suf: minSuf },
      { root: VI, suf: minSuf },
    ],
  ];

  const verseTemplates: Array<Array<{ root: number; suf: string; bass?: number }>> = isMinor
    ? [
        [
          { root: VI, suf: minSuf },
          { root: IV, suf: majSuf },
          { root: I, suf: majSuf },
          { root: V, suf: domSuf },
        ],
        [
          { root: VI, suf: minSuf },
          { root: II, suf: minSuf },
          { root: V, suf: domSuf },
          { root: I, suf: majSuf },
        ],
      ]
    : [
        // Canon / Slash descending bass: I -> V/VII -> VIm -> V
        [
          { root: I, suf: majSuf },
          { root: V, suf: '', bass: (I + 11) % 12 },
          { root: VI, suf: minSuf },
          { root: IV, suf: majSuf },
        ],
        [
          { root: I, suf: majSuf },
          { root: VI, suf: minSuf },
          { root: II, suf: minSuf },
          { root: V, suf: domSuf },
        ],
      ];

  const bridgeTemplates: Array<Array<{ root: number; suf: string; bass?: number }>> = [
    [
      { root: II, suf: minSuf },
      { root: III, suf: '7' }, // V7/vi secondary dominant
      { root: VI, suf: minSuf },
      { root: (V + 6) % 12, suf: '7' }, // subV7 tritone sub
    ],
    [
      { root: IV, suf: majSuf },
      { root: sIV, suf: 'dim7' }, // #IVdim7
      { root: III, suf: minSuf },
      { root: III, suf: '7' },
    ],
  ];

  const pool =
    sectionType === 'Chorus'
      ? chorusTemplates
      : sectionType === 'Bridge' || sectionType === 'Pre-Chorus'
        ? [...bridgeTemplates, ...chorusTemplates]
        : verseTemplates;

  const picked = pool[Math.floor(rng() * pool.length)];

  // Harmonic rhythm linked to BPM:
  // >= 160 BPM -> 1 bar (4 beats) per chord; <= 90 BPM -> allow 2 beats per chord
  const beatsPerBaseChord = bpm <= 90 && rng() < 0.65 ? 2 : 4;
  const totalBeats = bars * 4;
  const drafts: RawSlotDraft[] = [];
  let beatCursor = 0;
  let stepIdx = 0;

  while (beatCursor < totalBeats) {
    const loopIdx = Math.floor(stepIdx / picked.length);
    const inLoop = stepIdx % picked.length;
    const item = picked[inLoop];
    const remBeats = totalBeats - beatCursor;
    const dur = Math.min(remBeats, beatsPerBaseChord);

    // 2nd-loop turnaround variation or 2nd-half IV -> IVm modal interchange
    if (loopIdx >= 1 && inLoop === picked.length - 1 && rng() < 0.65) {
      if (item.root === VI && rng() < 0.5) {
        // Picardy / secondary dominant lift
        drafts.push({ chord: buildChordSym(IV, 'm'), durationBeats: dur });
      } else {
        // SubV7 or IVm emotional cadence
        const useTritone = genreId === 'chill_ballad' && rng() < 0.5;
        drafts.push({
          chord: useTritone
            ? buildChordSym((I + 1) % 12, '7')
            : buildChordSym(IV, 'm6'),
          durationBeats: dur,
        });
      }
    } else if (
      dur >= 4 &&
      bpm < 160 &&
      item.root === IV &&
      inLoop === 0 &&
      (sectionType === 'Chorus' || sectionType === 'Pre-Chorus') &&
      rng() < 0.38
    ) {
      // Surface reharmonization: passing #IVdim7 2-beat split (IV [2b] -> #IVdim7 [2b])
      drafts.push({
        chord: buildChordSym(item.root, item.suf, item.bass),
        durationBeats: 2,
      });
      drafts.push({
        chord: buildChordSym(sIV, 'dim7'),
        durationBeats: dur - 2,
      });
    } else if (
      dur >= 4 &&
      item.root === IV &&
      beatCursor >= totalBeats / 2 &&
      rng() < 0.45
    ) {
      // Second-half IV -> IVm split
      drafts.push({ chord: buildChordSym(IV, majSuf), durationBeats: 2 });
      drafts.push({ chord: buildChordSym(IV, 'm'), durationBeats: dur - 2 });
    } else {
      drafts.push({
        chord: buildChordSym(item.root, item.suf, item.bass),
        durationBeats: dur,
      });
    }

    beatCursor += dur;
    stepIdx++;
  }

  return drafts;
}

function buildModeBCandidate(
  keyRootPc: number,
  scale: ScaleType,
  bars: number,
  bpm: number,
  rng: () => number
): RawSlotDraft[] {
  // alt_shoegaze: Modal (Lydian / Mixolydian / Aeolian) + Neo-Riemannian PLR & parallel maj7 (strictly avoids V7 -> I!)
  const I = keyRootPc;
  const bII = (I + 1) % 12;
  const bIII = (I + 3) % 12;
  const IV = (I + 5) % 12;
  const bVI = (I + 8) % 12;
  const VI = (I + 9) % 12;
  const bVII = (I + 10) % 12;

  const modalCells: string[][] =
    scale === 'Minor'
      ? [
          [buildChordSym(I, 'm9'), buildChordSym(bVI, 'maj7'), buildChordSym(bIII, 'maj7'), buildChordSym(bVII, 'add9')],
          [buildChordSym(bVI, 'maj7'), buildChordSym(IV, 'm7'), buildChordSym(I, 'm7'), buildChordSym(bVII, '6')],
          // Neo-Riemannian PLR / parallel maj7 planing
          [buildChordSym(bVI, 'maj7'), buildChordSym(bII, 'maj7'), buildChordSym(bIII, 'maj7'), buildChordSym(I, 'm9')],
        ]
      : [
          [buildChordSym(I, 'maj7'), buildChordSym(IV, 'maj7'), buildChordSym(bVII, 'maj7'), buildChordSym(IV, 'add9')],
          [buildChordSym(IV, 'maj7'), buildChordSym(VI, 'm7'), buildChordSym(bIII, 'maj7'), buildChordSym(bVII, 'maj7')],
          [buildChordSym(I, 'add9'), buildChordSym(bVI, 'maj7'), buildChordSym(IV, 'maj7'), buildChordSym(bII, 'maj7')],
        ];

  const cell = modalCells[Math.floor(rng() * modalCells.length)];
  const beatsPerChord = bpm >= 145 ? 8 : 4;
  const totalBeats = bars * 4;
  const drafts: RawSlotDraft[] = [];
  let cursor = 0;
  let idx = 0;
  while (cursor < totalBeats) {
    const dur = Math.min(totalBeats - cursor, beatsPerChord);
    drafts.push({ chord: cell[idx % cell.length], durationBeats: dur });
    cursor += dur;
    idx++;
  }
  return drafts;
}

function buildModeCCandidate(
  keyRootPc: number,
  bars: number,
  bpm: number,
  rng: () => number
): RawSlotDraft[] {
  // numetal_mixture: Phrygian / Aeolian riff skeleton + asymmetric 3+5 or 5+3 beat splits across 2-bar cells
  const i = keyRootPc;
  const bII = (i + 1) % 12;
  const bIII = (i + 3) % 12;
  const bVI = (i + 8) % 12;
  const bVII = (i + 10) % 12;

  const riffPairs: Array<[string, string]> = [
    [buildChordSym(i, 'm'), buildChordSym(bII, 'maj7')],
    [buildChordSym(i, '5'), buildChordSym(bVI, '5')],
    [buildChordSym(i, 'm7'), buildChordSym(bVII, '5')],
    [buildChordSym(i, 'm'), buildChordSym(bIII, '5')],
  ];
  const pair = riffPairs[Math.floor(rng() * riffPairs.length)];

  const totalBeats = bars * 4;
  const drafts: RawSlotDraft[] = [];
  let cursor = 0;
  let cellIdx = 0;

  while (cursor < totalBeats) {
    const rem = totalBeats - cursor;
    if (rem >= 8 && bpm < 165 && rng() < 0.55) {
      // Asymmetric 2-bar cell: 3 + 5 or 5 + 3 beats!
      const splitFirst = rng() < 0.5 ? 3 : 5;
      drafts.push({ chord: pair[0], durationBeats: splitFirst });
      drafts.push({ chord: pair[1], durationBeats: 8 - splitFirst });
      cursor += 8;
    } else {
      const dur = Math.min(rem, 4);
      drafts.push({ chord: pair[cellIdx % 2], durationBeats: dur });
      cursor += dur;
    }
    cellIdx++;
  }
  return drafts;
}

function getTargetSpiralProfile(
  sectionType: SectionType,
  genreId: MasterGenreId
): { targetDiameter: number; targetStrain: number } {
  const baseDiam = genreId === 'chill_ballad' ? 1.55 : genreId === 'numetal_mixture' ? 1.2 : 1.42;
  switch (sectionType) {
    case 'Intro':
    case 'Verse':
      return { targetDiameter: baseDiam - 0.1, targetStrain: 0.48 };
    case 'Pre-Chorus':
      return { targetDiameter: baseDiam + 0.05, targetStrain: 0.78 };
    case 'Chorus':
      return { targetDiameter: baseDiam + 0.12, targetStrain: 0.62 };
    case 'Bridge':
      return { targetDiameter: baseDiam + 0.18, targetStrain: 1.05 };
    case 'Outro':
    default:
      return { targetDiameter: baseDiam - 0.08, targetStrain: 0.45 };
  }
}

export function generateGenreHarmonySection(options: {
  genreId: MasterGenreId | string;
  sectionType: SectionType;
  key: KeyName;
  scale: ScaleType;
  bars: number;
  bpm: number;
  masterSeed: number;
  sectionIndex: number;
}): { slots: ChordSlot[]; chordEvents: ChordEvent[] } {
  const { sectionType, key, scale, bars, bpm, masterSeed, sectionIndex } = options;
  const genreId = normalizeMasterGenreId(options.genreId);
  const keyRootPc = noteNameToSemitone(key);
  const rng = mulberry32(
    deriveSubSeed(masterSeed, `harmony:${sectionIndex}:${sectionType.toLowerCase()}`)
  );

  const { targetDiameter, targetStrain } = getTargetSpiralProfile(sectionType, genreId);

  let bestSlots: ChordSlot[] = [];
  let bestEvents: ChordEvent[] = [];
  let bestCost = Number.POSITIVE_INFINITY;

  // Generate 16 candidates and select closest to Spiral Array 2-axis section target
  for (let candIdx = 0; candIdx < 16; candIdx++) {
    let drafts: RawSlotDraft[];
    if (genreId === 'alt_shoegaze') {
      drafts = buildModeBCandidate(keyRootPc, scale, bars, bpm, rng);
    } else if (genreId === 'numetal_mixture') {
      drafts = buildModeCCandidate(keyRootPc, bars, bpm, rng);
    } else {
      drafts = buildModeACandidate(genreId, sectionType, keyRootPc, scale, bars, bpm, rng);
    }

    let startBeat = 0;
    const slots: ChordSlot[] = drafts.map((d, idx) => {
      const slot: ChordSlot = {
        id: `slot-h-${sectionIndex}-${idx}`,
        chord: d.chord,
        startBeat,
        durationBeats: d.durationBeats,
        anticipated: startBeat % 1 !== 0,
      };
      startBeat += d.durationBeats;
      return slot;
    });

    const events: ChordEvent[] = slots.map((s) =>
      analyzeParsedChordToEvent({
        parsed: parseChord(s.chord),
        startTick: Math.round(s.startBeat * TICKS_PER_BEAT),
        durationTicks: Math.max(60, Math.round(s.durationBeats * TICKS_PER_BEAT)),
        key,
        scale,
      })
    );

    const metrics = evaluateSpiralArrayMetrics(events, key, scale);
    const dErr = Math.abs(metrics.avgCloudDiameter - targetDiameter);
    const sErr = Math.abs(metrics.avgTensileStrain - targetStrain);
    const cost = dErr * 0.8 + sErr * 1.4;

    if (cost < bestCost || bestSlots.length === 0) {
      bestCost = cost;
      bestSlots = slots;
      bestEvents = events;
    }
  }

  // Ensure deterministic slot IDs independent of candidate index
  const finalSlots: ChordSlot[] = bestSlots.map((s, idx) => ({
    ...s,
    id: `slot-h-${sectionIndex}-${idx}`,
    durationBeats: Math.max(0.5, s.durationBeats),
    startBeat: Math.min(bars * 4 - 0.5, Math.max(0, s.startBeat)),
  }));
  // Ensure total coverage equals bars * 4 beats
  if (finalSlots.length > 0) {
    const last = finalSlots[finalSlots.length - 1];
    last.durationBeats = Math.max(0.5, bars * 4 - last.startBeat);
  } else {
    finalSlots.push({
      id: `slot-h-${sectionIndex}-0`,
      chord: key + (scale === 'Minor' ? 'm' : ''),
      startBeat: 0,
      durationBeats: bars * 4,
    });
  }
  void TICKS_PER_BAR;

  return { slots: finalSlots, chordEvents: bestEvents };
}
