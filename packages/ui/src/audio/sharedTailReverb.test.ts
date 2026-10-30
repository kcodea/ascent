// @vitest-environment jsdom
/**
 * R-PERF-SHARED-TAIL-REVERB-01 (perf degradation hunt 2026-10-30, owner: "performance degrades over a game, worse on
 * phones"). The soft-tail voice (`playTailedSample`: the falling gate's crank, the Discover entrance cues) built a NEW
 * ConvolverNode for every reverb'd play: four on every fight as the gate lifted, each ~40-60 MB of renderer memory at a
 * 96 kHz context and ~6 ms of main thread. Convolution is linear, so one shared convolver per (bus, tail length) gives
 * exactly the same sound: each play keeps its own send. These pin that the voice never builds one per play.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sharedTailReverb, sharedTailReverbCount } from '../sfx';

function fakeCtx() {
  let convolvers = 0;
  const node = (kind: string) => ({ kind, outs: [] as unknown[], buffer: null as unknown, connect(t: unknown) { this.outs.push(t); return t; }, disconnect() { this.outs = []; } });
  const a = {
    sampleRate: 96000,
    createConvolver: () => { convolvers++; return node('convolver'); },
    createBuffer: (_c: number, length: number) => ({ length, numberOfChannels: 2, getChannelData: () => new Float32Array(length) }),
  };
  return { a: a as unknown as AudioContext, convolvers: () => convolvers, bus: () => node('bus') as unknown as AudioNode };
}

describe('the soft-tail voice shares one reverb per (bus, tail length)', () => {
  it('every play into the same bus with the same tail reuses ONE convolver, wired to that bus once', () => {
    const { a, convolvers, bus } = fakeCtx();
    const combatBus = bus();
    const first = sharedTailReverb(a, combatBus, 1.2);
    for (let fight = 0; fight < 10; fight++) for (let layer = 0; layer < 4; layer++) expect(sharedTailReverb(a, combatBus, 1.2)).toBe(first);
    expect(convolvers()).toBe(1);
    expect(sharedTailReverbCount(combatBus)).toBe(1);
    expect((first as unknown as { outs: unknown[] }).outs).toEqual([combatBus]);
  });

  it('a different bus or a different tail length gets its own', () => {
    const { a, convolvers, bus } = fakeCtx();
    const b1 = bus(); const b2 = bus();
    sharedTailReverb(a, b1, 1.2); sharedTailReverb(a, b2, 1.2); sharedTailReverb(a, b1, 2);
    expect(convolvers()).toBe(3);
  });

  it('a hard stop (a new epoch) re-points the SAME node at the live epoch: one node for the whole session', () => {
    const { a, convolvers, bus } = fakeCtx();
    const stable = bus(); const epoch1 = bus(); const epoch2 = bus();
    const c1 = sharedTailReverb(a, stable, 1.2, epoch1);
    expect((c1 as unknown as { outs: unknown[] }).outs).toEqual([epoch1]);
    const c2 = sharedTailReverb(a, stable, 1.2, epoch2); // the next fight, after R-COMBAT-HARDSTOP-01 opened a new epoch
    expect(c2).toBe(c1);
    expect(convolvers()).toBe(1);
    expect((c2 as unknown as { outs: unknown[] }).outs).toEqual([epoch2]); // no longer ringing into the cut epoch
  });

  it('playTailedSample builds no convolver of its own (it sends into the shared one)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'sfx.ts'), 'utf8');
    const body = src.slice(src.indexOf('function playTailedSample('), src.indexOf('export function playTailedClip('));
    expect(body.length).toBeGreaterThan(200);
    expect(body).not.toContain('createConvolver');
    expect(body).toContain('sharedTailReverb(a, busTarget(a, category), reverbSec, dest)');
  });
});
