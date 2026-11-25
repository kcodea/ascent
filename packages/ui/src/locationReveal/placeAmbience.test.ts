// @vitest-environment jsdom
/** THE PLACE GOES ON SOUNDING AT HERO SELECT (R-LOCATION-09). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { endAmbience, holdAmbience, seamless, standAt } from './placeAmbience';
import { revealCues } from './revealSound';

const buffer = (n: number, rate = 100): AudioBuffer => {
  const d = new Float32Array(n).map((_, i) => Math.sin(i / 3));
  return { length: n, sampleRate: rate, numberOfChannels: 1, getChannelData: () => d } as unknown as AudioBuffer;
};
const ctx = { createBuffer: (c: number, n: number, rate: number) => buffer(n, rate) } as unknown as BaseAudioContext;
const voice = (): { src: AudioBufferSourceNode; gain: GainNode; stop: ReturnType<typeof vi.fn> } => {
  const stop = vi.fn();
  return { stop, src: { stop } as unknown as AudioBufferSourceNode, gain: { gain: { cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } } as unknown as GainNode };
};
afterEach(() => { endAmbience(0); });

describe('the ambience', () => {
  it('is the one cue that stays past the end of the reveal, and never fades to nothing in it', () => {
    for (const id of ['outskirts', 'underbelly'] as const) {
      const stays = revealCues(id, 5).filter((c) => c.stays);
      expect(stays.map((c) => c.clip)).toEqual([`ambience-${id}`]);
      expect(stays[0]!.len).toBeUndefined();
      expect(stays[0]!.env!.at(-1)![1]).toBeGreaterThan(0.3);
    }
  });
  it('holds under hero select and ends with the last one', () => {
    const mine = standAt();
    const mates = standAt();
    const v = voice();
    holdAmbience(v.src, v.gain);
    expect(v.stop).not.toHaveBeenCalled();
    mates();
    expect(v.stop).not.toHaveBeenCalled();
    mine();
    expect(v.stop).toHaveBeenCalledTimes(1);
  });
  it('with no hero select to sound at, it goes at once', () => {
    const v = voice();
    holdAmbience(v.src, v.gain);
    expect(v.stop).toHaveBeenCalledTimes(1);
  });
  it('loops with no seam: its last sample runs straight into its first', () => {
    const src = buffer(1000);
    const out = seamless(ctx, src);
    expect(out.length).toBe(910);
    const a = src.getChannelData(0);
    const d = out.getChannelData(0);
    expect(d[0]).toBeCloseTo(a[910]!, 5); // what came after the last sample kept
    expect(Math.abs(d[0]! - d[909]!)).toBeLessThan(0.4);
  });
});
