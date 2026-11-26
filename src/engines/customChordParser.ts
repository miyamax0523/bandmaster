import {
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  type ChordEvent,
  type ChordScaleName,
  type ChordSlot,
  type HarmonicFunction,
  type KeyName,
  type ScaleType,
} from '../types/song';
import {
  getScalePitchClasses,
  noteNameToSemitone,
  parseChord,
  semitoneToKeyName,
  type ParsedChord,
} from '../lib/chordUtils';
import { normalizeMasterGenreId, type MasterGenreId } from '../lib/masterGenres';
import { analyzeParsedChordToEvent, pitchClassToFifthIndex } from './harmonyEngine';

export interface CustomChordParseResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly chordEvents: ChordEvent[];
  readonly slots: ChordSlot[];
  readonly normalizedText: string;
}

const VALID_CHORD_TOKEN_RE =
  /^([A-G][#b]?)(5|mM7|mMaj7|m\(maj7\)|m△7|m7b5|m7-5|ø7?|dim7|dim|7sus4|sus4|sus2|sus|aug|\+|M9|maj9|△9|M7|maj7|△7|69|6\/9|madd9|m\(add9\)|m9|m7|m6|m|add9|\(add9\)|9|7|6|13|7b9|7#9|7b13|7#11|maj7#11|m11)?(\/([A-G][#b]?))?$/;

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

function normalizeKeyMode(keyMode: ScaleType | 'major' | 'minor' | string): ScaleType {
  return String(keyMode).toLowerCase() === 'minor' ? 'Minor' : 'Major';
}

function getBeatSplitForCount(tokenCount: number): number[] {
  if (tokenCount <= 1) return [4];
  if (tokenCount === 2) return [2, 2];
  if (tokenCount === 3) return [2, 1, 1];
  if (tokenCount === 4) return [1, 1, 1, 1];
  // For 5..8 tokens in a 4/4 bar, divide evenly in 0.5-beat units
  const capped = Math.min(8, tokenCount);
  const base = Math.floor((4 * 2) / capped) / 2;
  const beats = new Array<number>(capped).fill(Math.max(0.5, base));
  const used = beats.reduce((s, v) => s + v, 0);
  const rem = Math.round((4 - used) * 2) / 2;
  if (rem > 0) beats[0] += rem;
  return beats;
}

/**
 * Analyzes a power chord ("5", e.g. E5, F5, G5) without imposing an unwanted 3rd
 * in chordTonePcs, while inferring genre-appropriate scalePcs, tensions, avoids, and hookPcs.
 */
function analyzePowerChordToEvent(options: {
  parsed: ParsedChord;
  startTick: number;
  durationTicks: number;
  key: KeyName;
  scale: ScaleType;
  genreId: MasterGenreId;
}): ChordEvent {
  const { parsed, startTick, durationTicks, key, scale, genreId } = options;
  const localKeyRootPc = noteNameToSemitone(key);
  const parentScalePcs = new Set(getScalePitchClasses(key, scale));
  const rootPc = parsed.rootPitchClass;
  const bassPc = parsed.bassPitchClass ?? rootPc;
  const fifthPc = (rootPc + 7) % 12;
  const relDegree = ((rootPc - localKeyRootPc) % 12 + 12) % 12;

  const chordTonePcs = [rootPc, fifthPc];
  const isNonDiatonic =
    !parentScalePcs.has(rootPc) || !parentScalePcs.has(fifthPc);

  let chordScale: ChordScaleName = scale === 'Minor' ? 'aeolian' : 'ionian';
  let harmonicFunction: HarmonicFunction =
    relDegree === 0 ? 'T' : relDegree === 5 || relDegree === 2 ? 'SD' : 'MODAL';
  let tensionRel: number[] = [2, 5];
  let avoidRel: number[] = [];

  if (genreId === 'numetal_mixture') {
    if (relDegree === 1) {
      // bII5 (Phrygian signature chord: e.g. F5 in E minor)
      chordScale = 'lydian';
      harmonicFunction = 'MODAL';
      tensionRel = [2, 6, 9];
      avoidRel = [];
    } else if (relDegree === 0) {
      chordScale = 'phrygian';
      harmonicFunction = 'T';
      tensionRel = [1, 3, 5];
      avoidRel = [];
    } else if (relDegree === 3 || relDegree === 8 || relDegree === 10) {
      chordScale = 'mixolydian';
      harmonicFunction = 'MODAL';
      tensionRel = [2, 5];
      avoidRel = [];
    } else {
      chordScale = 'aeolian';
      tensionRel = [2, 5];
      avoidRel = [8];
    }
  } else if (genreId === 'alt_shoegaze') {
    if (relDegree === 5 || relDegree === 8 || relDegree === 1) {
      chordScale = 'lydian';
      tensionRel = [2, 6, 9];
      avoidRel = [];
    } else if (relDegree === 10 || relDegree === 7) {
      chordScale = 'mixolydian';
      tensionRel = [2, 9];
      avoidRel = [5];
    } else {
      chordScale = 'aeolian';
      tensionRel = [2, 5];
      avoidRel = [8];
    }
  } else {
    // emo_jrock / royal_jpop / chill_ballad: respect song key diatonic + minor pentatonic feel
    if (relDegree === 1) {
      chordScale = 'lydian';
      tensionRel = [2, 6];
      avoidRel = [];
    } else if (scale === 'Minor') {
      if (relDegree === 3 || relDegree === 8) {
        chordScale = 'lydian';
        tensionRel = [2, 9];
        avoidRel = [];
      } else if (relDegree === 10) {
        chordScale = 'mixolydian';
        tensionRel = [2, 9];
        avoidRel = [5];
      } else {
        chordScale = 'aeolian';
        tensionRel = [2, 5];
        avoidRel = [8];
      }
    } else {
      if (relDegree === 5) {
        chordScale = 'lydian';
        tensionRel = [2, 9];
        avoidRel = [];
      } else if (relDegree === 7) {
        chordScale = 'mixolydian';
        harmonicFunction = 'D';
        tensionRel = [2, 9];
        avoidRel = [5];
      } else if (relDegree === 9 || relDegree === 2 || relDegree === 4) {
        chordScale = 'aeolian';
        tensionRel = [2, 5];
        avoidRel = [8];
      } else {
        chordScale = 'ionian';
        tensionRel = [2, 9];
        avoidRel = [5];
      }
    }
  }

  const scalePcs = SCALE_INTERVALS[chordScale].map((iv) => (rootPc + iv) % 12);
  const availableTensionPcs = tensionRel.map((iv) => (rootPc + iv) % 12);
  const avoidPcs = avoidRel.map((iv) => (rootPc + iv) % 12);

  // Characteristic hook tones for non-diatonic power chords (e.g. bII5 -> b2 rootPc)
  const hookPcs: number[] = [];
  if (isNonDiatonic) {
    if (!parentScalePcs.has(rootPc)) hookPcs.push(rootPc);
    if (!parentScalePcs.has(fifthPc)) hookPcs.push(fifthPc);
  } else if (genreId === 'numetal_mixture' && relDegree === 0) {
    // Phrygian b2 color tone above tonic
    hookPcs.push((localKeyRootPc + 1) % 12);
  }

  const romans = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
  const romanSymbol = `${romans[relDegree]}5`;
  const preferFlats = parsed.raw.includes('b') || key === 'F' || scale === 'Minor';

  return {
    startTick,
    durationTicks,
    localKeyRootPc,
    localKeyMode: scale,
    romanSymbol,
    chordSymbol: parsed.raw,
    rootPc,
    bassPc,
    quality: '5',
    harmonicFunction,
    isNonDiatonic,
    fifthLineIndices: chordTonePcs.map((pc) =>
      pitchClassToFifthIndex(pc, localKeyRootPc, preferFlats)
    ),
    chordTonePcs,
    guideTonePcs: [], // Power chords have no 3rd/7th guide tones
    availableTensionPcs,
    avoidPcs,
    scalePcs,
    hookPcs: Array.from(new Set(hookPcs)),
    chordScale,
  };
}

/**
 * Parses a bar-delimited custom chord progression text (e.g. "E5 | F5 | G5 F5 | E5")
 * into Stage 1 ChordEvent[] (480 TPQN) and ChordSlot[] aligned to sectionBars.
 */
export function parseCustomChordProgression(
  text: string,
  sectionBars: number,
  keyRootPc: number,
  keyMode: ScaleType | 'major' | 'minor',
  genreId?: MasterGenreId | string
): CustomChordParseResult {
  const totalBars = Math.max(1, Math.round(sectionBars));
  const key = semitoneToKeyName(keyRootPc);
  const scale = normalizeKeyMode(keyMode);
  const normGenre = normalizeMasterGenreId(genreId);

  const trimmed = text.trim();
  if (!trimmed) {
    return {
      valid: false,
      errors: ['コード進行が空です（例: E5 | F5 | G5 F5 | E5）'],
      chordEvents: [],
      slots: [],
      normalizedText: '',
    };
  }

  const rawBars = trimmed
    .split('|')
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  if (rawBars.length === 0) {
    return {
      valid: false,
      errors: ['有効な小節が見つかりません'],
      chordEvents: [],
      slots: [],
      normalizedText: '',
    };
  }

  const errors: string[] = [];
  const parsedBars: Array<Array<{ token: string; parsed: ParsedChord }>> = [];

  for (let barIdx = 0; barIdx < rawBars.length; barIdx++) {
    const rawTokens = rawBars[barIdx].split(/\s+/).filter(Boolean);
    if (rawTokens.length === 0) {
      errors.push(`${barIdx + 1}小節目が空です`);
      continue;
    }

    // Handle whole-bar repeat symbol "%"
    if (rawTokens.length === 1 && rawTokens[0] === '%') {
      if (parsedBars.length === 0) {
        errors.push(`1小節目に "%"（前小節リピート）は指定できません`);
      } else {
        parsedBars.push(
          parsedBars[parsedBars.length - 1].map((item) => ({ ...item }))
        );
      }
      continue;
    }

    const barItems: Array<{ token: string; parsed: ParsedChord }> = [];
    for (let tIdx = 0; tIdx < rawTokens.length; tIdx++) {
      const tok = rawTokens[tIdx];
      if (tok === '%') {
        if (barItems.length > 0) {
          barItems.push({ ...barItems[barItems.length - 1] });
          continue;
        }
        if (parsedBars.length > 0) {
          const prevBar = parsedBars[parsedBars.length - 1];
          barItems.push({ ...prevBar[prevBar.length - 1] });
          continue;
        }
        errors.push(`${barIdx + 1}小節目: "%" の参照元がありません`);
        continue;
      }

      if (!VALID_CHORD_TOKEN_RE.test(tok)) {
        errors.push(`${barIdx + 1}小節目: "${tok}" をコードとして解釈できません`);
        continue;
      }
      try {
        const parsed = parseChord(tok);
        barItems.push({ token: tok, parsed });
      } catch {
        errors.push(`${barIdx + 1}小節目: "${tok}" の解析に失敗しました`);
      }
    }

    if (barItems.length > 0) {
      parsedBars.push(barItems);
    }
  }

  if (errors.length > 0 || parsedBars.length === 0) {
    return {
      valid: false,
      errors: errors.length > 0 ? errors : ['有効なコードが見つかりません'],
      chordEvents: [],
      slots: [],
      normalizedText: trimmed,
    };
  }

  // Loop-pad if fewer bars than sectionBars, trim if more
  const chordEvents: ChordEvent[] = [];
  const slots: ChordSlot[] = [];
  let slotSeq = 0;

  for (let b = 0; b < totalBars; b++) {
    const barTokens = parsedBars[b % parsedBars.length];
    const beatsList = getBeatSplitForCount(barTokens.length);
    let beatCursor = b * 4;

    for (let i = 0; i < Math.min(barTokens.length, beatsList.length); i++) {
      const { token, parsed } = barTokens[i];
      const durBeats = beatsList[i];
      const startTick = Math.round(beatCursor * TICKS_PER_BEAT);
      const durationTicks = Math.round(durBeats * TICKS_PER_BEAT);

      const ev =
        parsed.quality === 'power'
          ? analyzePowerChordToEvent({
              parsed,
              startTick,
              durationTicks,
              key,
              scale,
              genreId: normGenre,
            })
          : analyzeParsedChordToEvent({
              parsed,
              startTick,
              durationTicks,
              key,
              scale,
            });

      chordEvents.push(ev);
      slots.push({
        id: `custom-${slotSeq++}`,
        chord: token,
        startBeat: beatCursor,
        durationBeats: durBeats,
      });
      beatCursor += durBeats;
    }
  }

  const normalizedText = parsedBars
    .map((bar) => bar.map((item) => item.token).join(' '))
    .join(' | ');

  return {
    valid: true,
    errors: [],
    chordEvents,
    slots,
    normalizedText,
  };
}

/**
 * Serializes existing section ChordSlot[] into a clean bar-delimited text string
 * (e.g. "C | G | Am F | G") for one-click lock & edit.
 */
export function serializeChordSlotsToText(
  slots: readonly ChordSlot[],
  sectionBars: number
): string {
  const totalBars = Math.max(1, Math.round(sectionBars));
  if (!slots || slots.length === 0) return '';

  const barStrings: string[] = [];
  for (let b = 0; b < totalBars; b++) {
    const barStart = b * 4;
    const barEnd = barStart + 4;
    const inBar = slots
      .filter((s) => s.startBeat >= barStart - 0.5 && s.startBeat < barEnd - 0.01)
      .sort((a, bSlot) => a.startBeat - bSlot.startBeat);

    if (inBar.length > 0) {
      // Avoid duplicating an anticipated chord that belongs to the start of the next bar
      const filtered = inBar.filter(
        (s) => !(s.startBeat >= barEnd - 0.51 && s.anticipated)
      );
      const chosen = filtered.length > 0 ? filtered : inBar;
      barStrings.push(chosen.map((s) => s.chord).join(' '));
    } else {
      // Sustain active chord from previous bar
      const covering = slots.find(
        (s) => s.startBeat <= barStart && s.startBeat + s.durationBeats > barStart
      );
      barStrings.push(covering ? covering.chord : '%');
    }
  }

  // Collapse identical 4-bar / 2-bar repeats cleanly? Keep exact bars so user sees full progression
  // (Or keep compact 4-bar if 8-bar is exact 4-bar x 2 repeat)
  if (barStrings.length === 8) {
    const first4 = barStrings.slice(0, 4).join(' | ');
    const second4 = barStrings.slice(4, 8).join(' | ');
    if (first4 === second4) return first4;
  }

  return barStrings.join(' | ');
}

export { TICKS_PER_BAR };
