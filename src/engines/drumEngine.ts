import { type MidiNote, type SectionType } from '../types/song';
import { getTimelineBoundaryChanges } from '../lib/chordTimeline';
import type { EngineInput } from './types';

export const TPQN = 480;
export const BEAT_TICKS = 480;
export const BAR_TICKS = 1920;
export const EIGHTH_TICKS = 240;
export const SIXTEENTH_TICKS = 120;
export const THIRTY_SECOND_TICKS = 60;

export const GM_DRUM = {
  KICK: 36,
  RIMSHOT: 37,
  SIDE_STICK: 37,
  SNARE: 38,
  LOW_FLOOR_TOM: 41,
  CLOSED_HH: 42,
  FLOOR_TOM: 43,
  HIGH_FLOOR_TOM: 43,
  PEDAL_HH: 44,
  MID_TOM: 45,
  LOW_TOM: 45,
  OPEN_HH: 46,
  LOW_MID_TOM: 47,
  HIGH_TOM: 48,
  HI_MID_TOM: 48,
  CRASH: 49,
  CRASH_1: 49,
  HIGH_TOM_50: 50,
  RIDE: 51,
  CHINA: 52,
  RIDE_BELL: 53,
  SPLASH: 55,
  CRASH_2: 57,
} as const;

export type Limb = 'RH' | 'LH' | 'RF' | 'LF';

export type DrumGenreDNAId =
  | 'alt_heavy_shoegaze'
  | 'emo_jrock_fast'
  | 'jpop_melodic'
  | 'numetal_mixture'
  | 'fusion_funk'
  | 'chill_lofi_ballad';

export type SectionEnergy = 'low' | 'mid' | 'high';

export type CymbalMode =
  | 'closed_hh'
  | 'half_open_hh'
  | 'ride_bow'
  | 'ride_bell'
  | 'crash_ride';

export type DrumEventRole =
  | 'kick'
  | 'kick_ghost'
  | 'kick_linear'
  | 'snare_backbeat'
  | 'snare_rim'
  | 'snare_ghost'
  | 'side_stick'
  | 'flam_grace'
  | 'hh_closed'
  | 'hh_open'
  | 'hh_pedal'
  | 'ride'
  | 'ride_bell'
  | 'crash'
  | 'tom_fill';

export interface InternalDrumEvent {
  note: number;
  tick: number; // absolute tick in song/section timeline
  duration: number; // ticks (>= 15)
  velocity: number; // 1..127
  limb: Limb;
  role: DrumEventRole;
  isAnchor?: boolean;
  fixedTiming?: boolean;
  fixedVelocity?: boolean;
  minTickBound?: number;
}

export interface DrumDNAProfile {
  id: DrumGenreDNAId;
  singleHand16thLimitBpm: number;
  defaultHhSubdivision: 8 | 16;
  snareMicrotimingBaseTicks: number;
  snareMaxMsOffset: number;
  ghostNoteProbability: number;
  doubleKickProbability: number;
  allowTwinPedal: boolean;
  linearFillWeight: number;
  halfTimeCapable: boolean;
  backbeatVelRange: [number, number];
  climaxSnareVelRange: [number, number];
  ghostVelRange: [number, number];
  kickVelRange: [number, number];
  ghostKickVelRange: [number, number];
  useSideStickOnLowEnergy: boolean;
  accentCymbalNote: number;
}

export const DRUM_DNA_PROFILES: Record<DrumGenreDNAId, DrumDNAProfile> = {
  alt_heavy_shoegaze: {
    id: 'alt_heavy_shoegaze',
    singleHand16thLimitBpm: 95,
    defaultHhSubdivision: 8,
    snareMicrotimingBaseTicks: 10,
    snareMaxMsOffset: 18,
    ghostNoteProbability: 0.45,
    doubleKickProbability: 0.35,
    allowTwinPedal: false,
    linearFillWeight: 0.25,
    halfTimeCapable: true,
    backbeatVelRange: [112, 125],
    climaxSnareVelRange: [118, 127],
    ghostVelRange: [34, 52],
    kickVelRange: [108, 124],
    ghostKickVelRange: [74, 88],
    useSideStickOnLowEnergy: false,
    accentCymbalNote: GM_DRUM.CHINA,
  },
  emo_jrock_fast: {
    id: 'emo_jrock_fast',
    singleHand16thLimitBpm: 100,
    defaultHhSubdivision: 8,
    snareMicrotimingBaseTicks: -6,
    snareMaxMsOffset: 10,
    ghostNoteProbability: 0.18,
    doubleKickProbability: 0.55,
    allowTwinPedal: true,
    linearFillWeight: 0.4,
    halfTimeCapable: false,
    backbeatVelRange: [110, 124],
    climaxSnareVelRange: [116, 127],
    ghostVelRange: [28, 45],
    kickVelRange: [108, 124],
    ghostKickVelRange: [76, 88],
    useSideStickOnLowEnergy: false,
    accentCymbalNote: GM_DRUM.CRASH_1,
  },
  jpop_melodic: {
    id: 'jpop_melodic',
    singleHand16thLimitBpm: 100,
    defaultHhSubdivision: 8,
    snareMicrotimingBaseTicks: 2,
    snareMaxMsOffset: 5,
    ghostNoteProbability: 0.28,
    doubleKickProbability: 0.2,
    allowTwinPedal: false,
    linearFillWeight: 0.3,
    halfTimeCapable: false,
    backbeatVelRange: [106, 120],
    climaxSnareVelRange: [115, 125],
    ghostVelRange: [26, 44],
    kickVelRange: [105, 120],
    ghostKickVelRange: [72, 86],
    useSideStickOnLowEnergy: true,
    accentCymbalNote: GM_DRUM.CRASH_1,
  },
  numetal_mixture: {
    id: 'numetal_mixture',
    singleHand16thLimitBpm: 95,
    defaultHhSubdivision: 8,
    snareMicrotimingBaseTicks: 1,
    snareMaxMsOffset: 4,
    ghostNoteProbability: 0.3,
    doubleKickProbability: 0.5,
    allowTwinPedal: true,
    linearFillWeight: 0.35,
    halfTimeCapable: true,
    backbeatVelRange: [114, 127],
    climaxSnareVelRange: [118, 127],
    ghostVelRange: [30, 48],
    kickVelRange: [110, 124],
    ghostKickVelRange: [75, 88],
    useSideStickOnLowEnergy: false,
    accentCymbalNote: GM_DRUM.CHINA,
  },
  fusion_funk: {
    id: 'fusion_funk',
    singleHand16thLimitBpm: 95,
    defaultHhSubdivision: 16,
    snareMicrotimingBaseTicks: 6,
    snareMaxMsOffset: 12,
    ghostNoteProbability: 0.65,
    doubleKickProbability: 0.45,
    allowTwinPedal: false,
    linearFillWeight: 0.8,
    halfTimeCapable: false,
    backbeatVelRange: [105, 120],
    climaxSnareVelRange: [114, 125],
    ghostVelRange: [25, 48],
    kickVelRange: [105, 122],
    ghostKickVelRange: [72, 86],
    useSideStickOnLowEnergy: false,
    accentCymbalNote: GM_DRUM.CRASH_2,
  },
  chill_lofi_ballad: {
    id: 'chill_lofi_ballad',
    singleHand16thLimitBpm: 90,
    defaultHhSubdivision: 8,
    snareMicrotimingBaseTicks: 12,
    snareMaxMsOffset: 20,
    ghostNoteProbability: 0.25,
    doubleKickProbability: 0.1,
    allowTwinPedal: false,
    linearFillWeight: 0.2,
    halfTimeCapable: false,
    backbeatVelRange: [96, 112],
    climaxSnareVelRange: [105, 118],
    ghostVelRange: [25, 40],
    kickVelRange: [95, 114],
    ghostKickVelRange: [70, 82],
    useSideStickOnLowEnergy: true,
    accentCymbalNote: GM_DRUM.CRASH_1,
  },
};

export interface BarAnalysisMeta {
  barIndex: number;
  barStart: number;
  barEnd: number;
  energy: SectionEnergy;
  cymbalMode: CymbalMode;
  barEndAnticipationTick: number | null;
  midBarSyncopationTick: number | null;
  precededByAnticipation: boolean;
  isSectionEnd: boolean;
  isEightBarEnd: boolean;
  isFourBarEnd: boolean;
  isTwoBarTurnaround: boolean;
}

export interface DrumGenerationResult {
  notes: MidiNote[];
  events: InternalDrumEvent[];
  kickTicks: number[];
  profile: DrumDNAProfile;
}

/** Pure deterministic Mulberry32 PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngInt(rng: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

function clampRange(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Maps legacy preset IDs and explicit DNA IDs to one of the 6 DrumDNAProfiles. */
export function resolveDrumDNAProfile(
  presetId: string | undefined,
  bpm: number,
  sectionType?: SectionType | string
): DrumDNAProfile {
  const id = (presetId ?? 'auto').trim();
  if (id in DRUM_DNA_PROFILES) {
    return DRUM_DNA_PROFILES[id as DrumGenreDNAId];
  }

  switch (id) {
    case 'halftime_heavy':
    case 'breakdown_heavy':
      return DRUM_DNA_PROFILES.alt_heavy_shoegaze;
    case 'rock_drive':
    case 'metal_double':
    case 'jrock_anticipation':
      return DRUM_DNA_PROFILES.emo_jrock_fast;
    case 'trap_sparse':
    case 'trap_active':
      return DRUM_DNA_PROFILES.numetal_mixture;
    case 'straight_16':
    case 'four_on_floor':
    case 'bounce_shuffle':
    case 'disco_boogie_bounce':
      return DRUM_DNA_PROFILES.fusion_funk;
    case 'rim_chill':
      return DRUM_DNA_PROFILES.chill_lofi_ballad;
    case 'auto':
    case 'straight_8':
    case 'simple_minimal':
    case 'build_up':
    default: {
      if (bpm <= 88 && (sectionType === 'Intro' || sectionType === 'Bridge')) {
        return DRUM_DNA_PROFILES.chill_lofi_ballad;
      }
      return DRUM_DNA_PROFILES.jpop_melodic;
    }
  }
}

function resolveSectionEnergy(
  input: EngineInput
): SectionEnergy {
  const raw = input.section.energy;
  if (raw === 'Low') return 'low';
  if (raw === 'High') return 'high';
  return 'mid';
}

const UPPER_LIMB_NOTES = new Set<number>([
  GM_DRUM.SIDE_STICK,
  GM_DRUM.SNARE,
  GM_DRUM.LOW_FLOOR_TOM,
  GM_DRUM.CLOSED_HH,
  GM_DRUM.HIGH_FLOOR_TOM,
  GM_DRUM.LOW_TOM,
  GM_DRUM.OPEN_HH,
  GM_DRUM.LOW_MID_TOM,
  GM_DRUM.HI_MID_TOM,
  GM_DRUM.CRASH_1,
  GM_DRUM.HIGH_TOM_50,
  GM_DRUM.RIDE,
  GM_DRUM.CHINA,
  GM_DRUM.RIDE_BELL,
  GM_DRUM.SPLASH,
  GM_DRUM.CRASH_2,
]);

const UPPER_PRIORITY: Record<DrumEventRole, number> = {
  crash: 100,
  snare_backbeat: 90,
  snare_rim: 88,
  tom_fill: 82,
  side_stick: 78,
  hh_open: 70,
  ride_bell: 65,
  ride: 60,
  hh_closed: 55,
  snare_ghost: 40,
  flam_grace: 35,
  kick: 10,
  kick_ghost: 5,
  kick_linear: 5,
  hh_pedal: 5,
};

function isHiHatClosedOrPedal(note: number): boolean {
  return note === GM_DRUM.CLOSED_HH || note === GM_DRUM.PEDAL_HH;
}

function isKickRole(role: DrumEventRole): boolean {
  return role === 'kick' || role === 'kick_ghost' || role === 'kick_linear';
}

function inferRoleFromMidiPitch(pitch: number, velocity: number): DrumEventRole {
  if (pitch === GM_DRUM.KICK) return velocity <= 88 ? 'kick_ghost' : 'kick';
  if (pitch === GM_DRUM.SNARE) return velocity <= 60 ? 'snare_ghost' : 'snare_backbeat';
  if (pitch === GM_DRUM.SIDE_STICK) return 'side_stick';
  if (pitch === GM_DRUM.CLOSED_HH) return 'hh_closed';
  if (pitch === GM_DRUM.OPEN_HH) return 'hh_open';
  if (pitch === GM_DRUM.PEDAL_HH) return 'hh_pedal';
  if (pitch === GM_DRUM.RIDE) return 'ride';
  if (pitch === GM_DRUM.RIDE_BELL) return 'ride_bell';
  if (pitch === GM_DRUM.CRASH_1 || pitch === GM_DRUM.CRASH_2 || pitch === GM_DRUM.CHINA || pitch === GM_DRUM.SPLASH) {
    return 'crash';
  }
  return 'tom_fill';
}

function inferLimbFromMidiPitch(pitch: number): Limb {
  if (pitch === GM_DRUM.KICK) return 'RF';
  if (pitch === GM_DRUM.PEDAL_HH) return 'LF';
  if (pitch === GM_DRUM.SNARE || pitch === GM_DRUM.SIDE_STICK) return 'LH';
  return 'RH';
}

// ===========================================================================
// Stage 1: Timeline "Kime" & Section Structure Analysis
// ===========================================================================
export function analyzeTimelineAndSections(
  input: EngineInput,
  dna: DrumDNAProfile
): BarAnalysisMeta[] {
  const { song, section } = input;
  const totalBars = Math.max(1, section.bars);
  const sectionEnd = totalBars * BAR_TICKS;
  const energy = resolveSectionEnergy(input);
  const drumAnticipationMode = section.drumAnticipationMode ?? 'sync';
  const drumPreset =
    section.patternPresets?.drums ??
    section.partPresets?.drums ??
    song.members.drums.patternPreset ??
    'auto';

  const barEndAntByBar = new Map<number, number>();
  const midBarSyncByBar = new Map<number, number>();

  if (drumAnticipationMode !== 'keep') {
    const timelineChanges = getTimelineBoundaryChanges(
      section.chords,
      totalBars,
      song.key,
      song.scale
    );
    for (const ch of timelineChanges) {
      const b = Math.floor(ch.changeTick / BAR_TICKS);
      if (b < 0 || b >= totalBars) continue;
      const barStart = b * BAR_TICKS;
      const localTick = ch.changeTick - barStart;
      if (ch.isOffbeat && Math.abs(localTick - 1680) <= 30) {
        barEndAntByBar.set(b, barStart + 1680);
      } else if (ch.isOffbeat && Math.abs(localTick - 720) <= 30) {
        midBarSyncByBar.set(b, barStart + 720);
      }
    }

    // Legacy preset jrock_anticipation guarantees bar-end anticipation at 1680 if not already set
    if (drumPreset === 'jrock_anticipation') {
      for (let b = 0; b < totalBars - 1; b++) {
        if (!barEndAntByBar.has(b)) {
          barEndAntByBar.set(b, b * BAR_TICKS + 1680);
        }
      }
    }
  }

  const metas: BarAnalysisMeta[] = [];
  for (let b = 0; b < totalBars; b++) {
    const barStart = b * BAR_TICKS;
    const barEnd = Math.min(sectionEnd, barStart + BAR_TICKS);
    const barEndAnticipationTick = barEndAntByBar.get(b) ?? null;
    const midBarSyncopationTick = midBarSyncByBar.get(b) ?? null;
    const precededByAnticipation = b > 0 && barEndAntByBar.has(b - 1);

    let cymbalMode: CymbalMode = 'closed_hh';
    if (energy === 'low') {
      cymbalMode = dna.id === 'chill_lofi_ballad' && b % 2 === 1 ? 'ride_bow' : 'closed_hh';
    } else if (energy === 'mid') {
      if (dna.id === 'fusion_funk') {
        cymbalMode = b % 2 === 1 ? 'ride_bow' : 'closed_hh';
      } else if (
        (section.type === 'Pre-Chorus' && b >= Math.floor(totalBars / 2)) ||
        (b % 2 === 1 && dna.id === 'alt_heavy_shoegaze')
      ) {
        cymbalMode = 'half_open_hh';
      } else {
        cymbalMode = 'closed_hh';
      }
    } else {
      // High energy
      if (dna.id === 'fusion_funk') {
        cymbalMode = 'ride_bell';
      } else if (dna.id === 'chill_lofi_ballad') {
        cymbalMode = 'ride_bow';
      } else if (section.type === 'Chorus' || drumPreset === 'rock_drive') {
        cymbalMode = b % 2 === 0 ? 'crash_ride' : 'half_open_hh';
      } else {
        cymbalMode = 'half_open_hh';
      }
    }

    const isSectionEnd = b === totalBars - 1;
    const isEightBarEnd = (b + 1) % 8 === 0;
    const isFourBarEnd = (b + 1) % 4 === 0;
    const isTwoBarTurnaround =
      (b + 1) % 2 === 0 && !isFourBarEnd && !isEightBarEnd;

    metas.push({
      barIndex: b,
      barStart,
      barEnd,
      energy,
      cymbalMode,
      barEndAnticipationTick,
      midBarSyncopationTick,
      precededByAnticipation,
      isSectionEnd,
      isEightBarEnd,
      isFourBarEnd,
      isTwoBarTurnaround,
    });
  }

  return metas;
}

// ===========================================================================
// Stage 2: Groove Skeleton Generation
// ===========================================================================
function generateExternalLoopEvents(
  input: EngineInput,
  rng: () => number
): InternalDrumEvent[] {
  const { song, section, style, params } = input;
  const loopSource = section.uploadedDrumLoop ?? song.uploadedDrumLoop;
  if (!loopSource) return [];

  const sectionEnd = section.bars * BAR_TICKS;
  const hatDensity = section.hatDensity ?? 3;
  const kickDensity = section.kickDensity ?? 3;
  const loopLen = Math.max(1, loopSource.bars) * BAR_TICKS;
  const events: InternalDrumEvent[] = [];

  for (let base = 0; base < sectionEnd; base += loopLen) {
    for (const srcNote of loopSource.notes) {
      const absTick = base + srcNote.startTick;
      if (absTick < 0 || absTick >= sectionEnd) continue;
      if (kickDensity === 1 && srcNote.pitch === GM_DRUM.KICK && srcNote.startTick % 960 !== 0) {
        continue;
      }
      if (
        hatDensity === 1 &&
        (srcNote.pitch === GM_DRUM.CLOSED_HH || srcNote.pitch === GM_DRUM.OPEN_HH) &&
        srcNote.startTick % 480 !== 0
      ) {
        continue;
      }
      const velDelta = style === 'B' ? rngInt(rng, -10, 10) : 0;
      const vel = clampVelocity(srcNote.velocity + velDelta);
      events.push({
        note: srcNote.pitch,
        tick: absTick,
        duration: Math.max(15, srcNote.durationTicks),
        velocity: vel,
        limb: inferLimbFromMidiPitch(srcNote.pitch),
        role: inferRoleFromMidiPitch(srcNote.pitch, vel),
        fixedTiming: true,
        fixedVelocity: style === 'A' || style === 'B',
      });
    }
  }

  if (kickDensity >= 4) {
    const kickExtras = kickDensity === 5 ? [360, 840, 1320, 1680] : [360, 1320];
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * BAR_TICKS;
      for (const off of kickExtras) {
        const t = barStart + off;
        if (t >= sectionEnd) continue;
        if (!events.some((e) => e.note === GM_DRUM.KICK && Math.abs(e.tick - t) < 60)) {
          events.push({
            note: GM_DRUM.KICK,
            tick: t,
            duration: 120,
            velocity: rngInt(rng, 105, 118),
            limb: 'RF',
            role: 'kick',
            fixedTiming: true,
          });
        }
      }
    }
  }

  if (hatDensity >= 4) {
    const hatStep = hatDensity === 5 ? 120 : 240;
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * BAR_TICKS;
      for (let off = 0; off < BAR_TICKS; off += hatStep) {
        const t = barStart + off;
        if (t >= sectionEnd) continue;
        const hasHat = events.some(
          (e) =>
            e.tick === t &&
            (e.note === GM_DRUM.CLOSED_HH ||
              e.note === GM_DRUM.OPEN_HH ||
              e.note === GM_DRUM.RIDE)
        );
        if (!hasHat && (hatDensity === 5 || rng() < 0.55)) {
          events.push({
            note: GM_DRUM.CLOSED_HH,
            tick: t,
            duration: 80,
            velocity: rngInt(rng, 68, 86),
            limb: 'RH',
            role: 'hh_closed',
            fixedTiming: true,
          });
        }
      }
    }
  }

  if (style === 'B') {
    const sixteenthOffbeats = [120, 360, 600, 840, 1080, 1320, 1560, 1800];
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * BAR_TICKS;
      for (const off of sixteenthOffbeats) {
        const t = barStart + off;
        if (t >= sectionEnd) continue;
        if (events.some((e) => Math.abs(e.tick - t) < 60)) continue;
        if (rng() < 0.35) {
          const isSnareGhost = rng() < 0.6;
          events.push({
            note: isSnareGhost ? GM_DRUM.SNARE : GM_DRUM.CLOSED_HH,
            tick: t,
            duration: 70,
            velocity: rngInt(rng, 32, 50),
            limb: isSnareGhost ? 'LH' : 'RH',
            role: isSnareGhost ? 'snare_ghost' : 'hh_closed',
          });
        }
      }
    }
  }

  if (style === 'C') {
    const lastBarStart = (section.bars - 1) * BAR_TICKS;
    const fillStart = lastBarStart + 960;
    // Remove non-kick events in final bar beats 3-4 for seed-dependent Take C fill
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].tick >= fillStart && events[i].note !== GM_DRUM.KICK) {
        events.splice(i, 1);
      }
    }
    const fillPool = [
      GM_DRUM.SNARE,
      GM_DRUM.HIGH_TOM_50,
      GM_DRUM.HI_MID_TOM,
      GM_DRUM.LOW_TOM,
      GM_DRUM.HIGH_FLOOR_TOM,
    ];
    for (let off = 0; off < 960; off += SIXTEENTH_TICKS) {
      const t = fillStart + off;
      if (t >= sectionEnd) break;
      const pitch = fillPool[rngInt(rng, 0, fillPool.length - 1)];
      events.push({
        note: pitch,
        tick: t,
        duration: 100,
        velocity: clampVelocity(82 + Math.round((off / 960) * 32)),
        limb: (off / SIXTEENTH_TICKS) % 2 === 0 ? 'RH' : 'LH',
        role: 'tom_fill',
        fixedTiming: true,
      });
    }

    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = bar * BAR_TICKS;
      if (bar === 0 && !events.some((e) => e.note === GM_DRUM.CRASH && e.tick === barStart)) {
        events.push({
          note: GM_DRUM.CRASH,
          tick: barStart,
          duration: 480,
          velocity: 112,
          limb: 'RH',
          role: 'crash',
          isAnchor: true,
          fixedTiming: true,
        });
      }
      if (bar === 0) {
        const openTick = barStart + 720;
        if (openTick < sectionEnd) {
          events.push({
            note: GM_DRUM.OPEN_HH,
            tick: openTick,
            duration: 220,
            velocity: 92,
            limb: 'RH',
            role: 'hh_open',
            fixedTiming: true,
          });
        }
      }
    }
  }

  // Respect velocityCap if not anchor
  void params;
  return events;
}

export function generateGrooveSkeleton(
  input: EngineInput,
  dna: DrumDNAProfile,
  barMetas: BarAnalysisMeta[],
  rng: () => number
): InternalDrumEvent[] {
  const { song, section, style, params } = input;
  const sectionEnd = section.bars * BAR_TICKS;
  const drumPreset =
    section.patternPresets?.drums ??
    section.partPresets?.drums ??
    song.members.drums.patternPreset ??
    'auto';

  if (section.uploadedDrumLoop ?? song.uploadedDrumLoop) {
    return generateExternalLoopEvents(input, rng);
  }

  const events: InternalDrumEvent[] = [];
  const hatDensity = section.hatDensity;
  const kickDensity = section.kickDensity;
  const isTrapMode =
    drumPreset === 'trap_sparse' ||
    drumPreset === 'trap_active' ||
    params.hatSubdivision === 4;
  const isDiscoBoogie = drumPreset === 'disco_boogie_bounce';
  const isFourOnFloor =
    drumPreset === 'four_on_floor' ||
    (drumPreset === 'auto' && params.kickPattern === 'fourOnFloor');
  const isRimChill = drumPreset === 'rim_chill';
  const isBuildUp = drumPreset === 'build_up';
  const isMinimal = drumPreset === 'simple_minimal';
  const isMetalDouble = drumPreset === 'metal_double';

  const pushEv = (ev: InternalDrumEvent) => {
    if (ev.tick < 0 || ev.tick >= sectionEnd) return;
    events.push(ev);
  };

  for (const meta of barMetas) {
    const { barIndex: b, barStart, energy, cymbalMode } = meta;
    const isSilentDownbeatWindow = meta.precededByAnticipation;

    // -----------------------------------------------------------------------
    // 1. Cymbal Work (RH)
    // -----------------------------------------------------------------------
    if (isDiscoBoogie) {
      // Exact disco_boogie_bounce hi-hat groove: 8th offbeats OpenHH + bounced 16th ClosedHH
      const offbeats = [240, 720, 1200, 1680];
      const closedStarts = [0, 136, 376, 480, 616, 856, 960, 1096, 1336, 1440, 1576, 1816];
      for (const off of offbeats) {
        if (isSilentDownbeatWindow && off < 240) continue;
        pushEv({
          note: GM_DRUM.OPEN_HH,
          tick: barStart + off,
          duration: 180,
          velocity: 92,
          limb: 'RH',
          role: 'hh_open',
          fixedTiming: true,
          fixedVelocity: true,
        });
      }
      for (const off of closedStarts) {
        if (isSilentDownbeatWindow && off < 240) continue;
        pushEv({
          note: GM_DRUM.CLOSED_HH,
          tick: barStart + off,
          duration: 95,
          velocity: off % 480 === 0 ? 94 : 74,
          limb: 'RH',
          role: 'hh_closed',
          fixedTiming: true,
          fixedVelocity: true,
        });
      }
    } else if (isTrapMode) {
      const trapActive = drumPreset === 'trap_active' || (hatDensity !== undefined && hatDensity >= 4);
      const hatStep = hatDensity === 1 ? 480 : hatDensity === 2 ? 240 : trapActive ? 120 : 240;
      for (let off = 0; off < BAR_TICKS; off += hatStep) {
        if (isSilentDownbeatWindow && off < 240) continue;
        if (hatStep === 120 && song.bpm >= dna.singleHand16thLimitBpm && (off === 480 || off === 1440)) {
          continue;
        }
        pushEv({
          note: GM_DRUM.CLOSED_HH,
          tick: barStart + off,
          duration: 75,
          velocity: off % 480 === 0 ? 92 : 66,
          limb: 'RH',
          role: 'hh_closed',
          fixedTiming: true,
        });
      }
      // Mixed 2/3/4 sub-step rolls on hatSubdivision === 4 or trap_active when hatDensity >= 3
      if ((params.hatSubdivision === 4 || trapActive) && (hatDensity === undefined || hatDensity >= 3)) {
        const rollSpots = [
          { start: 360, div: 2 }, // 60 ticks
          { start: 840, div: 3 }, // 40 ticks
          { start: 1560, div: 4 }, // 30 ticks
        ];
        for (const spot of rollSpots) {
          const step = Math.round(120 / spot.div);
          for (let r = 1; r < spot.div; r++) {
            pushEv({
              note: GM_DRUM.CLOSED_HH,
              tick: barStart + spot.start + r * step,
              duration: Math.max(15, step - 5),
              velocity: clampVelocity(58 + r * 6),
              limb: 'RH',
              role: 'hh_closed',
              fixedTiming: true,
            });
          }
        }
      }
    } else {
      // Standard & DNA-driven cymbal work
      let step = EIGHTH_TICKS;
      if (hatDensity !== undefined) {
        if (hatDensity === 1) step = 480;
        else if (hatDensity === 2 || hatDensity === 3) step = 240;
        else if (hatDensity >= 4) step = 120;
      } else if (
        drumPreset === 'straight_16' ||
        dna.defaultHhSubdivision === 16 ||
        (dna.id === 'jpop_melodic' && energy === 'high' && song.bpm <= 125)
      ) {
        step = SIXTEENTH_TICKS;
      }

      const twoHand16thMode =
        hatDensity === undefined &&
        step === SIXTEENTH_TICKS &&
        song.bpm >= dna.singleHand16thLimitBpm;

      for (let off = 0; off < BAR_TICKS; off += step) {
        if (isSilentDownbeatWindow && off < 240) continue;
        // Physical RLRL alternation on fast 16th hi-hats skips beat 2 (480) and beat 4 (1440)
        if (twoHand16thMode && (off === 480 || off === 1440)) {
          continue;
        }
        // Skip beat 1 hat if section downbeat crash is placed there
        if (off === 0 && b === 0 && !isSilentDownbeatWindow && section.type === 'Chorus') {
          continue;
        }

        let note: number = GM_DRUM.CLOSED_HH;
        let role: DrumEventRole = 'hh_closed';
        let dur = step === 480 ? 220 : step === 240 ? 150 : 90;

        if (cymbalMode === 'ride_bow') {
          note = GM_DRUM.RIDE;
          role = 'ride';
          dur = 200;
        } else if (cymbalMode === 'ride_bell') {
          note = off % 480 === 0 ? GM_DRUM.RIDE_BELL : GM_DRUM.RIDE;
          role = off % 480 === 0 ? 'ride_bell' : 'ride';
          dur = 200;
        } else if (cymbalMode === 'crash_ride') {
          if (off % 480 === 0 || step === 240) {
            note = b % 2 === 0 ? GM_DRUM.CRASH_1 : GM_DRUM.CRASH_2;
            role = 'crash';
            dur = 320;
          } else {
            continue;
          }
        } else if (cymbalMode === 'half_open_hh') {
          if (isFourOnFloor) {
            note = off % 480 === 240 ? GM_DRUM.OPEN_HH : GM_DRUM.CLOSED_HH;
            role = off % 480 === 240 ? 'hh_open' : 'hh_closed';
            dur = role === 'hh_open' ? 200 : 120;
          } else {
            note = GM_DRUM.OPEN_HH;
            role = 'hh_open';
            dur = 200;
          }
        } else if (isFourOnFloor && off % 480 === 240) {
          note = GM_DRUM.OPEN_HH;
          role = 'hh_open';
          dur = 180;
        }

        const limb: Limb =
          twoHand16thMode && off % 240 === 120 ? 'LH' : 'RH';

        pushEv({
          note,
          tick: barStart + off,
          duration: dur,
          velocity: 85,
          limb,
          role,
          fixedTiming: true,
        });

        // 4-limb coordination: LF Pedal HH on beats 2 & 4 when riding
        if (
          (cymbalMode === 'ride_bow' || cymbalMode === 'ride_bell') &&
          (off === 480 || off === 1440) &&
          !dna.allowTwinPedal
        ) {
          pushEv({
            note: GM_DRUM.PEDAL_HH,
            tick: barStart + off,
            duration: 90,
            velocity: 62,
            limb: 'LF',
            role: 'hh_pedal',
            fixedTiming: true,
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // 2. Backbeat Snare / Side Stick / Half-Time / Two-Beat (LH)
    // -----------------------------------------------------------------------
    const useHalfTime =
      drumPreset === 'halftime_heavy' ||
      (dna.halfTimeCapable && params.snareHalfTime);
    const useTwoBeat =
      dna.id === 'emo_jrock_fast' &&
      energy === 'high' &&
      song.bpm >= 150 &&
      !useHalfTime &&
      drumPreset !== 'straight_8';

    if (useHalfTime) {
      pushEv({
        note: GM_DRUM.SNARE,
        tick: barStart + 960,
        duration: 180,
        velocity: dna.backbeatVelRange[1],
        limb: 'LH',
        role: 'snare_backbeat',
      });
    } else if (useTwoBeat) {
      for (const off of [240, 720, 1200, 1680]) {
        pushEv({
          note: GM_DRUM.SNARE,
          tick: barStart + off,
          duration: 140,
          velocity: dna.backbeatVelRange[0] + 6,
          limb: 'LH',
          role: 'snare_backbeat',
        });
      }
    } else if (isBuildUp) {
      const step = b >= Math.max(1, Math.floor(section.bars / 2)) ? 120 : 240;
      for (let off = 0; off < BAR_TICKS; off += step) {
        if (isSilentDownbeatWindow && off < 240) continue;
        pushEv({
          note: GM_DRUM.SNARE,
          tick: barStart + off,
          duration: 100,
          velocity: clampVelocity(82 + Math.round((off / BAR_TICKS) * 35)),
          limb: off % 240 === 0 ? 'LH' : 'RH',
          role: 'snare_backbeat',
        });
      }
    } else {
      const backbeatNote =
        isRimChill || (energy === 'low' && dna.useSideStickOnLowEnergy && b === 0)
          ? GM_DRUM.SIDE_STICK
          : GM_DRUM.SNARE;
      const backbeatRole: DrumEventRole =
        backbeatNote === GM_DRUM.SIDE_STICK ? 'side_stick' : 'snare_backbeat';

      for (const off of [480, 1440]) {
        pushEv({
          note: backbeatNote,
          tick: barStart + off,
          duration: 160,
          velocity: dna.backbeatVelRange[0] + 6,
          limb: 'LH',
          role: backbeatRole,
        });
      }
    }

    // -----------------------------------------------------------------------
    // 3. Kick Skeleton (RF / LF)
    // -----------------------------------------------------------------------
    const kickOffsets = new Set<number>();
    if (!isSilentDownbeatWindow) {
      kickOffsets.add(0);
    }
    if (isDiscoBoogie || isFourOnFloor) {
      if (!isSilentDownbeatWindow) kickOffsets.add(0);
      kickOffsets.add(480);
      kickOffsets.add(960);
      kickOffsets.add(1440);
    } else if (useTwoBeat) {
      kickOffsets.add(0);
      kickOffsets.add(480);
      kickOffsets.add(960);
      kickOffsets.add(1440);
    } else if (isMetalDouble) {
      for (let off = 0; off < BAR_TICKS; off += 120) {
        if (isSilentDownbeatWindow && off < 240) continue;
        kickOffsets.add(off);
      }
    } else if (kickDensity === 1 || isMinimal) {
      if (!isSilentDownbeatWindow) kickOffsets.add(0);
      kickOffsets.add(960);
    } else {
      if (!useHalfTime) {
        kickOffsets.add(960);
      } else {
        kickOffsets.add(720);
      }

      // DNA-specific syncopations
      const syncPool =
        dna.id === 'fusion_funk'
          ? [360, 720, 1080, 1320]
          : dna.id === 'emo_jrock_fast'
            ? [360, 840, 1320]
            : dna.id === 'numetal_mixture'
              ? [360, 600, 1200]
              : dna.id === 'alt_heavy_shoegaze'
                ? [720, 1200]
                : [720, 1320];

      const targetExtraCount =
        kickDensity !== undefined && kickDensity >= 4
          ? kickDensity === 5
            ? 4
            : 2
          : energy === 'high'
            ? 2
            : energy === 'mid'
              ? 1
              : 0;

      for (let idx = 0; idx < syncPool.length && idx < targetExtraCount; idx++) {
        const off = syncPool[idx];
        if (isSilentDownbeatWindow && off < 240) continue;
        kickOffsets.add(off);
      }
    }

    for (const off of kickOffsets) {
      const isGhost =
        !isMetalDouble &&
        !isDiscoBoogie &&
        !isFourOnFloor &&
        off !== 0 &&
        off !== 960 &&
        off % 240 === 120 &&
        rng() < 0.45;

      pushEv({
        note: GM_DRUM.KICK,
        tick: barStart + off,
        duration: 120,
        velocity: isGhost ? dna.ghostKickVelRange[1] : dna.kickVelRange[1],
        limb: 'RF',
        role: isGhost ? 'kick_ghost' : 'kick',
        isAnchor: isFourOnFloor || isDiscoBoogie,
        fixedTiming: !isGhost,
      });

      // Preceding 16th double-kick (e.g., 840 before 960)
      if (
        !isGhost &&
        !isDiscoBoogie &&
        !isFourOnFloor &&
        !isMetalDouble &&
        off === 960 &&
        rng() < dna.doubleKickProbability &&
        (!isSilentDownbeatWindow || off - 120 >= 240)
      ) {
        pushEv({
          note: GM_DRUM.KICK,
          tick: barStart + off - 120,
          duration: 120,
          velocity: dna.ghostKickVelRange[0] + 4,
          limb: dna.allowTwinPedal ? 'LF' : 'RF',
          role: 'kick_ghost',
          fixedTiming: true,
        });
      }
    }

    // -----------------------------------------------------------------------
    // 4. Section Head Crash (protected anchor when not preceded by anticipation)
    // -----------------------------------------------------------------------
    if (b === 0 && !isSilentDownbeatWindow && !isRimChill && !isMinimal) {
      const isChorusAnchor = section.type === 'Chorus';
      pushEv({
        note: GM_DRUM.CRASH_1,
        tick: barStart,
        duration: 480,
        velocity: isChorusAnchor ? 116 : 108,
        limb: 'RH',
        role: 'crash',
        isAnchor: isChorusAnchor,
        fixedTiming: true,
      });
    }

    // -----------------------------------------------------------------------
    // 5. Offbeat Anticipation ("Kime" at 1680 / Mid-bar 720)
    // -----------------------------------------------------------------------
    if (meta.midBarSyncopationTick !== null) {
      const mt = meta.midBarSyncopationTick;
      pushEv({
        note: GM_DRUM.KICK,
        tick: mt,
        duration: 120,
        velocity: 114,
        limb: 'RF',
        role: 'kick',
        isAnchor: true,
        fixedTiming: true,
      });
      pushEv({
        note: dna.id === 'numetal_mixture' ? GM_DRUM.SPLASH : GM_DRUM.OPEN_HH,
        tick: mt,
        duration: 200,
        velocity: 104,
        limb: 'RH',
        role: dna.id === 'numetal_mixture' ? 'crash' : 'hh_open',
        isAnchor: true,
        fixedTiming: true,
      });
    }

    if (meta.barEndAnticipationTick !== null) {
      const at = meta.barEndAnticipationTick;
      // Clear any conflicting kick immediately after anticipation inside (at, barEnd]
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].tick > at && events[i].tick <= meta.barEnd && isKickRole(events[i].role)) {
          events.splice(i, 1);
        }
      }
      // Flam grace before snare backbeat at 1440 for tight anticipation setup
      if (!isRimChill && !isDiscoBoogie) {
        pushEv({
          note: GM_DRUM.SNARE,
          tick: barStart + 1415,
          duration: 60,
          velocity: 72,
          limb: 'RH',
          role: 'flam_grace',
        });
      }
      pushEv({
        note: GM_DRUM.KICK,
        tick: at,
        duration: 120,
        velocity: 116,
        limb: 'RF',
        role: 'kick',
        isAnchor: true,
        fixedTiming: true,
      });
      pushEv({
        note: isFourOnFloor ? GM_DRUM.CRASH_1 : dna.accentCymbalNote,
        tick: at,
        duration: 480,
        velocity: 114,
        limb: 'RH',
        role: 'crash',
        isAnchor: true,
        fixedTiming: true,
      });
    }

    // -----------------------------------------------------------------------
    // 6. Snare Ghost Notes on empty 16th offbeats
    // -----------------------------------------------------------------------
    if (!isRimChill && !isDiscoBoogie && !isMinimal && !isBuildUp) {
      const ghostSlots = [120, 360, 600, 840, 1080, 1320, 1560, 1800];
      for (const off of ghostSlots) {
        if (isSilentDownbeatWindow && off < 240) continue;
        const t = barStart + off;
        if (meta.barEndAnticipationTick !== null && t >= meta.barEndAnticipationTick - 60) {
          continue;
        }
        if (events.some((e) => Math.abs(e.tick - t) < 40 && (isKickRole(e.role) || e.role === 'tom_fill'))) {
          continue;
        }
        if (rng() < dna.ghostNoteProbability * 0.55) {
          pushEv({
            note: GM_DRUM.SNARE,
            tick: t,
            duration: 70,
            velocity: rngInt(rng, dna.ghostVelRange[0], dna.ghostVelRange[1]),
            limb: 'LH',
            role: 'snare_ghost',
          });
        }
      }
    }
  }

  // Unison Riff Anchor Kicks (velocity === 110 exact)
  if (section.unisonRiff && section.unisonRiff.accentTicks.length > 0) {
    const riffLen = Math.max(1, section.unisonRiff.bars) * BAR_TICKS;
    for (let base = 0; base < sectionEnd; base += riffLen) {
      for (const rel of section.unisonRiff.accentTicks) {
        const t = base + rel;
        if (t < 0 || t >= sectionEnd) continue;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].tick === t && events[i].note === GM_DRUM.KICK) {
            events.splice(i, 1);
          }
        }
        events.push({
          note: GM_DRUM.KICK,
          tick: t,
          duration: 120,
          velocity: 110,
          limb: 'RF',
          role: 'kick',
          isAnchor: true,
          fixedTiming: true,
          fixedVelocity: true,
        });
      }
    }
  }

  void style;
  return events;
}

// ===========================================================================
// Stage 3: 4-bar / 8-bar Tom Runs & Linear Fills
// ===========================================================================
export function injectMusicalFills(
  input: EngineInput,
  dna: DrumDNAProfile,
  barMetas: BarAnalysisMeta[],
  skeletonEvents: InternalDrumEvent[],
  rng: () => number
): InternalDrumEvent[] {
  const { song, section, style } = input;
  const sectionEnd = section.bars * BAR_TICKS;
  const drumPreset =
    section.patternPresets?.drums ??
    section.partPresets?.drums ??
    song.members.drums.patternPreset ??
    'auto';

  // Skip structural fill injection on external loop, minimal density=1, explicit Outro density test, four_on_floor 1-bar, or minimal preset Take B
  if (
    Boolean(section.uploadedDrumLoop ?? song.uploadedDrumLoop) ||
    (section.hatDensity === 1 && section.kickDensity === 1) ||
    (section.type === 'Outro' && section.hatDensity !== undefined) ||
    (drumPreset === 'four_on_floor' && section.bars <= 1) ||
    (drumPreset === 'simple_minimal' && style === 'B')
  ) {
    return skeletonEvents;
  }

  const events = skeletonEvents.slice();

  for (const meta of barMetas) {
    const { barIndex: b, barStart, barEnd, energy } = meta;

    let fillLengthTicks = 0;
    if (meta.isSectionEnd || meta.isEightBarEnd) {
      if (style === 'C') fillLengthTicks = 1440; // beat 2..4 (12 steps)
      else if (style === 'B') fillLengthTicks = 480; // beat 4 (2-3 notes)
      else fillLengthTicks = 960; // beat 3..4 (4-7 notes)
    } else if (meta.isFourBarEnd) {
      fillLengthTicks = style === 'B' ? 480 : 960;
    } else if (meta.isTwoBarTurnaround) {
      const prob = energy === 'low' ? 0.2 : energy === 'mid' ? 0.45 : 0.65;
      if (rng() < prob) {
        fillLengthTicks = rng() < 0.6 ? 480 : 240;
      }
    }

    if (fillLengthTicks <= 0) continue;

    // Preserve barEndAnticipationTick (1680) as landing point by clamping fillEnd
    const rawFillEnd =
      meta.barEndAnticipationTick !== null
        ? Math.min(barEnd, meta.barEndAnticipationTick)
        : barEnd;
    const fillStart = Math.max(barStart, rawFillEnd - fillLengthTicks);
    const fillEnd = rawFillEnd;
    if (fillEnd - fillStart < 240) continue;

    // Block normal groove events inside [fillStart, fillEnd) except protected anchors
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.tick >= fillStart && ev.tick < fillEnd && !ev.isAnchor) {
        events.splice(i, 1);
      }
    }

    const useLinear = rng() < dna.linearFillWeight;
    const stepsCount = Math.max(2, Math.floor((fillEnd - fillStart) / SIXTEENTH_TICKS));

    const fillNotes: Array<{ note: number; role: DrumEventRole; stepOffset: number }> = [];

    if (useLinear) {
      // Linear fill templates: zero simultaneous limbs, kick_linear as connective glue
      const linear16: Array<{ note: number; role: DrumEventRole }> = [
        { note: GM_DRUM.SNARE, role: 'tom_fill' },
        { note: GM_DRUM.HIGH_TOM_50, role: 'tom_fill' },
        { note: GM_DRUM.KICK, role: 'kick_linear' },
        { note: GM_DRUM.HI_MID_TOM, role: 'tom_fill' },
        { note: GM_DRUM.LOW_MID_TOM, role: 'tom_fill' },
        { note: GM_DRUM.KICK, role: 'kick_linear' },
        { note: GM_DRUM.HIGH_FLOOR_TOM, role: 'tom_fill' },
        { note: GM_DRUM.LOW_FLOOR_TOM, role: 'tom_fill' },
        { note: GM_DRUM.KICK, role: 'kick_linear' },
        { note: GM_DRUM.SNARE, role: 'tom_fill' },
        { note: GM_DRUM.HIGH_TOM_50, role: 'tom_fill' },
        { note: GM_DRUM.KICK, role: 'kick_linear' },
        { note: GM_DRUM.LOW_TOM, role: 'tom_fill' },
        { note: GM_DRUM.HIGH_FLOOR_TOM, role: 'tom_fill' },
        { note: GM_DRUM.KICK, role: 'kick_linear' },
        { note: GM_DRUM.LOW_FLOOR_TOM, role: 'tom_fill' },
      ];
      const linear8: Array<{ note: number; role: DrumEventRole }> = [
        { note: GM_DRUM.SNARE, role: 'tom_fill' },
        { note: GM_DRUM.HIGH_TOM_50, role: 'tom_fill' },
        { note: GM_DRUM.KICK, role: 'kick_linear' },
        { note: GM_DRUM.HI_MID_TOM, role: 'tom_fill' },
        { note: GM_DRUM.LOW_MID_TOM, role: 'tom_fill' },
        { note: GM_DRUM.KICK, role: 'kick_linear' },
        { note: GM_DRUM.HIGH_FLOOR_TOM, role: 'tom_fill' },
        { note: GM_DRUM.LOW_FLOOR_TOM, role: 'tom_fill' },
      ];
      const linear4: Array<{ note: number; role: DrumEventRole }> = [
        { note: GM_DRUM.SNARE, role: 'tom_fill' },
        { note: GM_DRUM.HIGH_TOM_50, role: 'tom_fill' },
        { note: GM_DRUM.KICK, role: 'kick_linear' },
        { note: GM_DRUM.LOW_FLOOR_TOM, role: 'tom_fill' },
      ];
      const template =
        stepsCount >= 12 ? linear16 : stepsCount >= 8 ? linear8 : linear4;
      const limit = Math.min(stepsCount, template.length);
      for (let s = 0; s < limit; s++) {
        fillNotes.push({
          note: template[s].note,
          role: template[s].role,
          stepOffset: s * SIXTEENTH_TICKS,
        });
      }
    } else {
      // Descending tom run: Snare(38) -> HighTom(50) -> HiMid(48) -> LowMid(47) -> Low(45) -> HighFloor(43) -> LowFloor(41)
      const tomDescent = [
        GM_DRUM.HIGH_TOM_50,
        GM_DRUM.HI_MID_TOM,
        GM_DRUM.LOW_MID_TOM,
        GM_DRUM.LOW_TOM,
        GM_DRUM.HIGH_FLOOR_TOM,
        GM_DRUM.LOW_FLOOR_TOM,
      ];
      if (style === 'B') {
        // Compact 2-3 hits
        const compactHits = [
          { note: GM_DRUM.SNARE, stepOffset: 0 },
          { note: GM_DRUM.HIGH_TOM_50, stepOffset: 240 },
          { note: GM_DRUM.HIGH_FLOOR_TOM, stepOffset: 360 },
        ];
        for (const h of compactHits) {
          if (fillStart + h.stepOffset < fillEnd) {
            fillNotes.push({ note: h.note, role: 'tom_fill', stepOffset: h.stepOffset });
          }
        }
      } else {
        const hitStep = style === 'C' ? SIXTEENTH_TICKS : EIGHTH_TICKS;
        const count = Math.max(2, Math.floor((fillEnd - fillStart) / hitStep));
        const snareHead = Math.max(1, Math.floor(count * 0.35));
        for (let s = 0; s < count; s++) {
          let note: number;
          if (s < snareHead) {
            note = GM_DRUM.SNARE;
          } else {
            const tomProgress = (s - snareHead) / Math.max(1, count - snareHead - 1);
            const tomIdx = Math.min(
              tomDescent.length - 1,
              Math.floor(tomProgress * (tomDescent.length - 1))
            );
            note = tomDescent[tomIdx];
          }
          fillNotes.push({
            note,
            role: 'tom_fill',
            stepOffset: s * hitStep,
          });
        }
      }
    }

    const totalFillSteps = Math.max(1, fillNotes.length);
    for (let idx = 0; idx < fillNotes.length; idx++) {
      const fn = fillNotes[idx];
      const t = fillStart + fn.stepOffset;
      if (t >= fillEnd || t >= sectionEnd) continue;
      const progress = idx / Math.max(1, totalFillSteps);
      const crescVel = clampRange(
        Math.round(122 * (0.74 + 0.26 * Math.pow(progress, 1.2))),
        45,
        126
      );
      events.push({
        note: fn.note,
        tick: t,
        duration: fn.role === 'kick_linear' ? 120 : 140,
        velocity: fn.role === 'kick_linear' ? 84 : crescVel,
        limb: fn.role === 'kick_linear' ? 'RF' : idx % 2 === 0 ? 'RH' : 'LH',
        role: fn.role,
        fixedTiming: true,
      });
    }

    // Guarantee Crash + Kick landing on next bar downbeat if fill ended at barEnd (1920)
    // and next bar is NOT precededByAnticipation
    const nextMeta = barMetas[b + 1];
    if (
      fillEnd === barEnd &&
      nextMeta &&
      !nextMeta.precededByAnticipation &&
      nextMeta.barStart < sectionEnd
    ) {
      const downbeat = nextMeta.barStart;
      if (!events.some((e) => e.tick === downbeat && e.role === 'crash')) {
        events.push({
          note: GM_DRUM.CRASH_1,
          tick: downbeat,
          duration: 480,
          velocity: 116,
          limb: 'RH',
          role: 'crash',
          isAnchor: true,
          fixedTiming: true,
        });
      }
      if (!events.some((e) => e.tick === downbeat && e.note === GM_DRUM.KICK)) {
        events.push({
          note: GM_DRUM.KICK,
          tick: downbeat,
          duration: 120,
          velocity: 116,
          limb: 'RF',
          role: 'kick',
          isAnchor: true,
          fixedTiming: true,
        });
      }
    }
  }

  return events;
}

// ===========================================================================
// Stage 4: 4-Limb Independence (Limb Solver) & Hi-Hat Choke
// ===========================================================================
export function solveLimbsAndHiHatChoke(
  rawEvents: InternalDrumEvent[],
  dna: DrumDNAProfile
): InternalDrumEvent[] {
  const sorted = rawEvents
    .slice()
    .sort((a, b) => a.tick - b.tick || UPPER_PRIORITY[b.role] - UPPER_PRIORITY[a.role]);

  // 1. Hi-Hat same-tick mutual exclusion (OpenHH vs ClosedHH/PedalHH)
  const byTick = new Map<number, InternalDrumEvent[]>();
  for (const ev of sorted) {
    const arr = byTick.get(ev.tick) ?? [];
    arr.push(ev);
    byTick.set(ev.tick, arr);
  }

  const afterHatClean: InternalDrumEvent[] = [];
  for (const [, group] of Array.from(byTick.entries()).sort((a, b) => a[0] - b[0])) {
    const hasOpen = group.some((e) => e.note === GM_DRUM.OPEN_HH);
    const filtered = hasOpen
      ? group.filter((e) => !isHiHatClosedOrPedal(e.note))
      : group;

    // 2. Foot independence (RF / LF)
    const kicks = filtered.filter((e) => isKickRole(e.role));
    const keptKicks: InternalDrumEvent[] = [];
    if (kicks.length > 0) {
      kicks.sort((a, b) => b.velocity - a.velocity);
      keptKicks.push(kicks[0]);
    }

    // 3. Upper-limb (RH / LH) max-2 enforcement & same-limb conflict resolution
    const uppers = filtered.filter((e) => UPPER_LIMB_NOTES.has(e.note));
    const keptUppers: InternalDrumEvent[] = [];
    uppers.sort((a, b) => {
      if (a.isAnchor && !b.isAnchor) return -1;
      if (!a.isAnchor && b.isAnchor) return 1;
      return UPPER_PRIORITY[b.role] - UPPER_PRIORITY[a.role];
    });

    const usedLimbs = new Set<Limb>();
    for (const u of uppers) {
      if (keptUppers.length >= 2) break;
      let targetLimb = u.limb;
      if (usedLimbs.has(targetLimb)) {
        // Reassign to the other hand if physically reasonable (e.g., toms/snare/16th HH)
        const altLimb: Limb = targetLimb === 'RH' ? 'LH' : 'RH';
        if (
          !usedLimbs.has(altLimb) &&
          (u.role === 'tom_fill' ||
            u.role === 'snare_backbeat' ||
            u.role === 'snare_ghost' ||
            u.role === 'flam_grace' ||
            u.role === 'hh_closed')
        ) {
          targetLimb = altLimb;
        } else {
          continue;
        }
      }
      usedLimbs.add(targetLimb);
      keptUppers.push({ ...u, limb: targetLimb });
    }

    const others = filtered.filter(
      (e) => !isKickRole(e.role) && !UPPER_LIMB_NOTES.has(e.note)
    );
    afterHatClean.push(...keptKicks, ...keptUppers, ...others);
  }

  // 4. Sequential foot & upper-limb micro-window checks
  afterHatClean.sort((a, b) => a.tick - b.tick || a.note - b.note);

  let lastKick: InternalDrumEvent | null = null;
  const finalSolved: InternalDrumEvent[] = [];

  for (const ev of afterHatClean) {
    if (isKickRole(ev.role)) {
      if (lastKick && ev.tick - lastKick.tick < SIXTEENTH_TICKS) {
        if (!dna.allowTwinPedal && ev.tick - lastKick.tick < 60 && !ev.isAnchor) {
          continue;
        }
        ev.limb = dna.allowTwinPedal ? 'LF' : 'RF';
      }
      lastKick = ev;
      finalSolved.push(ev);
      continue;
    }

    if (ev.note === GM_DRUM.PEDAL_HH && lastKick && Math.abs(ev.tick - lastKick.tick) < 30 && lastKick.limb === 'LF') {
      continue;
    }

    finalSolved.push(ev);
  }

  // Enforce <= 2 upper limbs within +-15 ticks window (allowing flam_grace + snare_backbeat pair)
  const limbWindowChecked: InternalDrumEvent[] = [];
  for (const ev of finalSolved) {
    if (!UPPER_LIMB_NOTES.has(ev.note)) {
      limbWindowChecked.push(ev);
      continue;
    }
    const nearbyUppers = limbWindowChecked.filter(
      (prev) => UPPER_LIMB_NOTES.has(prev.note) && Math.abs(ev.tick - prev.tick) <= 15
    );
    if (nearbyUppers.length < 2) {
      limbWindowChecked.push(ev);
    } else {
      // Replace lowest-priority nearby upper if current is higher priority
      let lowestIdx = -1;
      let lowestPrio = UPPER_PRIORITY[ev.role];
      for (let i = 0; i < limbWindowChecked.length; i++) {
        const prev = limbWindowChecked[i];
        if (
          UPPER_LIMB_NOTES.has(prev.note) &&
          Math.abs(ev.tick - prev.tick) <= 15 &&
          !prev.isAnchor &&
          UPPER_PRIORITY[prev.role] < lowestPrio
        ) {
          lowestPrio = UPPER_PRIORITY[prev.role];
          lowestIdx = i;
        }
      }
      if (lowestIdx !== -1) {
        limbWindowChecked.splice(lowestIdx, 1, ev);
      }
    }
  }

  // 5. Open Hi-Hat Choke Mute Duration Trimming
  for (let i = 0; i < limbWindowChecked.length; i++) {
    const ev = limbWindowChecked[i];
    if (ev.note !== GM_DRUM.OPEN_HH) continue;
    for (let j = i + 1; j < limbWindowChecked.length; j++) {
      const next = limbWindowChecked[j];
      if (next.tick > ev.tick && isHiHatClosedOrPedal(next.note)) {
        ev.duration = Math.max(15, Math.min(ev.duration, next.tick - ev.tick));
        break;
      }
    }
  }

  return limbWindowChecked;
}

// ===========================================================================
// Stage 5: SSD 5.5 Velocity Tiers, BPM-Clamped Microtiming & Final Invariants
// ===========================================================================
function applyHumanizationAndSSD5Velocity(
  solvedEvents: InternalDrumEvent[],
  dna: DrumDNAProfile,
  bpm: number,
  rng: () => number
): InternalDrumEvent[] {
  const out = solvedEvents.map((e) => ({ ...e }));

  // Compute snare microtiming offsets first so flam_grace can inherit parent offset
  const parentSnareOffsets = new Map<number, number>();

  for (const ev of out) {
    if (
      ev.role === 'snare_backbeat' ||
      ev.role === 'snare_rim' ||
      ev.role === 'side_stick'
    ) {
      let offset = 0;
      if (!ev.fixedTiming) {
        if (dna.snareMicrotimingBaseTicks >= 5) {
          const maxCap = Math.min(
            18,
            Math.max(1, Math.round((dna.snareMaxMsOffset * bpm) / 125))
          );
          const minFloor = Math.min(5, maxCap);
          const target = clampRange(dna.snareMicrotimingBaseTicks, minFloor, maxCap);
          offset = clampRange(target + rngInt(rng, -2, 2), minFloor, maxCap);
        } else if (dna.snareMicrotimingBaseTicks <= -4) {
          const maxEarlyCap = Math.min(
            10,
            Math.max(1, Math.round((dna.snareMaxMsOffset * bpm) / 125))
          );
          const minEarlyFloor = Math.min(4, maxEarlyCap);
          const mag = clampRange(
            Math.abs(dna.snareMicrotimingBaseTicks) + rngInt(rng, -1, 1),
            minEarlyFloor,
            maxEarlyCap
          );
          offset = -mag;
        } else {
          offset = rngInt(rng, 0, Math.min(4, Math.max(1, dna.snareMicrotimingBaseTicks + 2)));
        }
      }
      parentSnareOffsets.set(ev.tick, offset);
      ev.tick += offset;
    }
  }

  for (const ev of out) {
    const jitter = rngInt(rng, -2, 2);

    if (ev.role === 'flam_grace') {
      // Inherit paired parent snare offset (+25 ticks ahead)
      const parentTick = ev.tick + 25;
      const parentOffset = parentSnareOffsets.get(parentTick) ?? 0;
      ev.tick += parentOffset;
      ev.velocity = clampRange(70 + jitter, 62, 82);
      continue;
    }

    if (ev.role === 'snare_ghost') {
      if (!ev.fixedTiming) {
        ev.tick += rngInt(rng, -3, 3);
      }
      if (!ev.fixedVelocity) {
        const [minG, maxG] = dna.ghostVelRange;
        ev.velocity = clampRange(Math.round((minG + maxG) / 2) + jitter, minG, maxG);
      }
      continue;
    }

    if (ev.fixedVelocity) continue;

    switch (ev.role) {
      case 'snare_backbeat': {
        const [minS, maxS] = dna.backbeatVelRange;
        ev.velocity = clampRange(Math.round((minS + maxS) / 2) + jitter, minS, maxS);
        break;
      }
      case 'snare_rim': {
        const [minR, maxR] = dna.climaxSnareVelRange;
        ev.velocity = clampRange(Math.round((minR + maxR) / 2) + jitter, minR, maxR);
        break;
      }
      case 'side_stick': {
        ev.velocity = clampRange(76 + jitter, 65, 88);
        break;
      }
      case 'kick': {
        if (!ev.isAnchor) {
          const [minK, maxK] = dna.kickVelRange;
          ev.velocity = clampRange(Math.round((minK + maxK) / 2) + jitter, minK, maxK);
        }
        break;
      }
      case 'kick_ghost': {
        const [minGK, maxGK] = dna.ghostKickVelRange;
        ev.velocity = clampRange(Math.round((minGK + maxGK) / 2) + jitter, minGK, maxGK);
        break;
      }
      case 'kick_linear': {
        ev.velocity = clampRange(84 + jitter, 78, 92);
        break;
      }
      case 'hh_closed':
      case 'hh_open':
      case 'ride':
      case 'ride_bell': {
        // Moeller cyclical accent model
        const beatOffset = ev.tick % BEAT_TICKS;
        const phase = Math.round(beatOffset / SIXTEENTH_TICKS) % 4;
        if (beatOffset % BEAT_TICKS < 30) {
          ev.velocity = clampRange(94 + jitter, 85, 105);
        } else if (Math.abs(beatOffset - EIGHTH_TICKS) <= 30) {
          ev.velocity = clampRange(62 + jitter, 50, 72);
        } else if (phase === 1 || phase === 3) {
          ev.velocity = clampRange(56 + jitter, 48, 66);
        } else {
          ev.velocity = clampRange(74 + jitter, 68, 82);
        }
        break;
      }
      case 'tom_fill': {
        ev.velocity = clampRange(ev.velocity + jitter, 45, 126);
        break;
      }
      case 'crash': {
        if (!ev.isAnchor) {
          ev.velocity = clampRange(112 + jitter, 102, 124);
        }
        break;
      }
      default:
        break;
    }
  }

  return out;
}

export function enforceFinalInvariants(
  events: InternalDrumEvent[],
  sectionStartTick: number,
  sectionEndTick: number
): InternalDrumEvent[] {
  if (sectionEndTick <= sectionStartTick) return [];
  const maxStart = Math.max(sectionStartTick, sectionEndTick - 15);

  const clamped: InternalDrumEvent[] = [];
  for (const ev of events) {
    const tick = Math.min(maxStart, Math.max(sectionStartTick, Math.round(ev.tick)));
    const maxDur = Math.max(15, sectionEndTick - tick);
    const duration = Math.max(15, Math.min(Math.round(ev.duration), maxDur));
    if (tick < sectionStartTick || tick >= sectionEndTick) continue;
    clamped.push({
      ...ev,
      tick,
      duration,
      velocity: clampVelocity(ev.velocity),
    });
  }

  // Deduplicate identical (note, tick), keeping highest velocity
  const dedupMap = new Map<string, InternalDrumEvent>();
  for (const ev of clamped) {
    const key = `${ev.note}:${ev.tick}`;
    const existing = dedupMap.get(key);
    if (!existing || ev.velocity > existing.velocity) {
      dedupMap.set(key, ev);
    }
  }

  const finalList = Array.from(dedupMap.values()).sort(
    (a, b) => a.tick - b.tick || a.note - b.note
  );

  // Re-clamp OpenHH choke duration after microtiming
  for (let i = 0; i < finalList.length; i++) {
    const ev = finalList[i];
    if (ev.note !== GM_DRUM.OPEN_HH) continue;
    for (let j = i + 1; j < finalList.length; j++) {
      const next = finalList[j];
      if (next.tick > ev.tick && isHiHatClosedOrPedal(next.note)) {
        ev.duration = Math.max(15, Math.min(ev.duration, next.tick - ev.tick));
        break;
      }
    }
  }

  return finalList;
}

export function generateDrumResult(input: EngineInput): DrumGenerationResult {
  const { song, section, seed } = input;
  const drumPreset =
    section.patternPresets?.drums ??
    section.partPresets?.drums ??
    song.members.drums.patternPreset ??
    'auto';
  const profile = resolveDrumDNAProfile(drumPreset, song.bpm, section.type);

  if (!song.members.drums.enabled || section.enabledParts?.drums === false) {
    return {
      notes: [],
      events: [],
      kickTicks: [],
      profile,
    };
  }

  const sectionStartTick = 0;
  const sectionEndTick = Math.max(1, section.bars) * BAR_TICKS;
  const rng = mulberry32(seed);

  // Stage 1: Timeline & Section Analysis
  const barMetas = analyzeTimelineAndSections(input, profile);

  // Stage 2: Groove Skeleton
  const skeleton = generateGrooveSkeleton(input, profile, barMetas, rng);

  // Stage 3: Musical Fills
  const withFills = injectMusicalFills(input, profile, barMetas, skeleton, rng);

  // Stage 4: 4-Limb Solver & Hi-Hat Choke
  const solved = solveLimbsAndHiHatChoke(withFills, profile);

  // Stage 5: SSD 5.5 Velocity, BPM-Clamped Microtiming & Final Invariants
  const humanized = applyHumanizationAndSSD5Velocity(solved, profile, song.bpm, rng);
  const finalEvents = enforceFinalInvariants(humanized, sectionStartTick, sectionEndTick);

  const notes: MidiNote[] = finalEvents.map((ev) => ({
    pitch: ev.note,
    velocity: ev.velocity,
    startTick: ev.tick,
    durationTicks: ev.duration,
    channel: 9,
  }));

  const kickTicks = finalEvents
    .filter((ev) => ev.note === GM_DRUM.KICK)
    .map((ev) => ev.tick);

  return {
    notes,
    events: finalEvents,
    kickTicks,
    profile,
  };
}

export function generateDrumNotes(input: EngineInput): MidiNote[] {
  return generateDrumResult(input).notes;
}
