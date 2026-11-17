import { describe, expect, it } from 'vitest';
import { processGuitarRiff } from '../src/lib/riffProcessor';

describe('riffProcessor', () => {
  it('follows Steps 0..6: amplitude->vel, noise gate, Drop D/C pass, high E6=88 fold, single head trim, monophonization', () => {
    const result = processGuitarRiff(
      [
        // Noise (<20 vel / <30 dur)
        { pitch: 52, startTick: 100, durationTicks: 240, amplitude: 0.05 },
        { pitch: 52, startTick: 200, durationTicks: 20, amplitude: 0.8 },
        // Out of guitar range (>88)
        { pitch: 90, startTick: 300, durationTicks: 240, amplitude: 0.8 },
        // Valid Drop C (36) starting at tick 500 -> trimmed to 0 -> shifted -12 -> 24
        { pitch: 36, startTick: 500, durationTicks: 240, amplitude: 0.9 },
        // Chord at same tick 500 (E6=88) -> discarded in Step 4 because 36 is bottom note
        { pitch: 88, startTick: 500, durationTicks: 240, amplitude: 0.85 },
        // High note E6=88 alone at tick 980 (trimmed to 480) -> -12 = 76 -> 64 -> 52
        { pitch: 88, startTick: 980, durationTicks: 240, amplitude: 0.75 },
        // Drop D (38) at tick 1460 (trimmed to 960) -> -12 = 26
        { pitch: 38, startTick: 1460, durationTicks: 240, amplitude: 0.8 },
        // Exceeding 1 bar after trim (tick 2420 -> trimmed to 1920 >= 1920) -> removed in Step 6
        { pitch: 40, startTick: 2420, durationTicks: 240, amplitude: 0.8 },
      ],
      { bpm: 120, bars: 1, offsetMs: 0, grid: 'straight16' }
    );

    expect(result.cleanedBassNotes).toEqual([
      { pitch: 24, velocity: 114, startTick: 0, durationTicks: 240, channel: 0 },
      { pitch: 52, velocity: 95, startTick: 480, durationTicks: 240, channel: 0 },
      { pitch: 26, velocity: 102, startTick: 960, durationTicks: 240, channel: 0 },
    ]);
    expect(result.accentTicks).toEqual([0, 480, 960]);
  });

  it('defaults to straight16 when <= 1 note is present and applies offsetMs without double head-trim', () => {
    // At 120 BPM, +50ms = 48 ticks -> quantized on 120 grid stays 0; +100ms = 96 ticks -> quantized to 120
    const res = processGuitarRiff(
      [{ pitch: 52, startTick: 400, durationTicks: 240, velocity: 100 }],
      { bpm: 120, bars: 1, offsetMs: 100 }
    );
    expect(res.resolvedGrid).toBe('straight16');
    expect(res.cleanedBassNotes[0].startTick).toBe(120);
    expect(res.cleanedBassNotes[0].pitch).toBe(40);
  });

  it('detects triplet8 grid via IOI histogram and clips note durations at riffEnd', () => {
    const res = processGuitarRiff(
      [
        { pitch: 40, startTick: 0, durationTicks: 160, velocity: 100 },
        { pitch: 43, startTick: 160, durationTicks: 160, velocity: 100 },
        { pitch: 45, startTick: 320, durationTicks: 160, velocity: 100 },
        { pitch: 47, startTick: 1760, durationTicks: 480, velocity: 100 },
      ],
      { bpm: 135, bars: 1, grid: 'auto' }
    );
    expect(res.resolvedGrid).toBe('triplet8');
    const last = res.cleanedBassNotes[res.cleanedBassNotes.length - 1];
    expect(last.startTick).toBe(1760);
    expect(last.durationTicks).toBe(160); // 1920 - 1760
  });
});
