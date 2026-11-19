/**
 * ONE SHARED CONVOLVER PER (bus, impulse) for the effect layers' reverb (R-PERF-SHARED-FX-REVERB-01, perf pass
 * 2026-11-18). A 500+ Attack hit plays `strike-impact-*`, whose reverb'd layers each held a pooled node for 3 to 5 s;
 * swings land well inside that, so past the pool of two nearly every big hit built a ConvolverNode (~6 ms of main
 * thread at 96 kHz) mid-fight. An eligible one-shot play now sends into one node built once.
 */
import { describe, expect, it } from 'vitest';
import {
  FADING_NODES, buildAudioFilterChain, reverbSpecsOf, sharedFxReverbCount, sharedReverbEligible, type FxFilterCtx, type SharedReverbSend,
} from './audioFilters';
import bindings from '../choreo/bindings.json';
import strikeBlue from './defs/strike-impact-blue.json';
import strikePink from './defs/strike-impact-pink.json';
import strikePurple from './defs/strike-impact-purple.json';
import runeBuffTrail from './defs/rune-buff-trail.json';

type Ramp = [string, number, number];
interface Node { kind: string; buffer: unknown; normalize: boolean; gain: { value: number; ramps: Ramp[]; setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; cancelScheduledValues(t: number): void; setValueCurveAtTime(): void }; outs: Node[]; connect(d: Node): Node; disconnect(d?: Node): void }
function fakeContext() {
  let convolversMade = 0;
  const mk = (kind: string): Node => {
    const ramps: Ramp[] = [];
    const n: Node = {
      kind, normalize: false, buffer: null, outs: [],
      gain: {
        value: 1, ramps,
        setValueAtTime(v, t) { ramps.push(['set', v, t]); },
        exponentialRampToValueAtTime(v, t) { ramps.push(['exp', v, t]); },
        linearRampToValueAtTime(v, t) { ramps.push(['lin', v, t]); },
        cancelScheduledValues() { ramps.length = 0; },
        setValueCurveAtTime() {},
      },
      connect(d) { n.outs.push(d); return d; },
      disconnect(d) { if (d) n.outs = n.outs.filter((x) => x !== d); else n.outs = []; },
    };
    return n;
  };
  const a = {
    sampleRate: 48000,
    currentTime: 0,
    createGain: () => mk('gain'),
    createConvolver: () => { convolversMade++; return mk('convolver'); },
    createStereoPanner: () => ({ ...mk('pan'), pan: { value: 0, setValueAtTime() {}, setValueCurveAtTime() {} } }),
    createBuffer: (_c: number, length: number) => ({ length, numberOfChannels: 2, getChannelData: () => new Float32Array(length) }),
  };
  return { a: a as unknown as BaseAudioContext, mk, made: () => convolversMade };
}

const reverb = { reverbOn: true, reverb_size: 2, reverb_damping: 0.84, reverb_mix: 0.16 };

function play(a: BaseAudioContext, bus: Node, out: Node, over: Partial<SharedReverbSend> = {}, params: Record<string, unknown> = reverb, t0 = 0): Node | null {
  let send: Node | null = null;
  const shared: SharedReverbSend = {
    bus: bus as unknown as AudioNode, out: out as unknown as AudioNode, level: 0.5, fadeInSec: 0, fadeOutSec: 0,
    onSend: (n) => { send = n as unknown as Node; }, ...over,
  };
  const ctx: FxFilterCtx = { t0, durSec: 0.6, oneShot: true, shared };
  buildAudioFilterChain(a, params, ctx);
  return send;
}

describe('the shared effect reverb (R-PERF-SHARED-FX-REVERB-01)', () => {
  it('twenty overlapping big hits build ONE convolver, each with its own send', () => {
    const { a, mk, made } = fakeContext();
    const bus = mk('gain'); const out = mk('gain');
    const sends = new Set<Node>();
    for (let i = 0; i < 20; i++) { const s = play(a, bus, out); expect(s).not.toBeNull(); sends.add(s!); }
    expect(made()).toBe(1);
    expect(sends.size).toBe(20);
    expect(sharedFxReverbCount(bus as unknown as AudioNode)).toBe(1);
    // Every send feeds the same convolver, and that convolver rings into the bus's epoch.
    const conv = [...sends][0]!.outs[0]!;
    expect(conv.kind).toBe('convolver');
    for (const s of sends) expect(s.outs[0]).toBe(conv);
    expect(conv.outs).toEqual([out]);
  });

  it('the send carries the fader level x the mix (the wet no longer passes the fader)', () => {
    const { a, mk } = fakeContext();
    const flat = play(a, mk('gain'), mk('gain'), { level: 0.5 })!;
    expect(flat.gain.ramps).toEqual([['set', 0.5 * 0.16, 0]]);
    expect(flat.outs[0]!.outs[0]!.kind, 'no fades: the node rings straight into the bus, no gate').toBe('gain'); // the bus epoch itself
  });

  it('a FADE-IN stays behind the convolver: the gate rides it when the node has rung out, and stays open over a ringing tail', () => {
    const { a, mk, made } = fakeContext();
    const bus = mk('gain'); const out = mk('gain');
    const send = play(a, bus, out, { level: 0.35, fadeInSec: 0.05 })!;
    expect(send.gain.ramps, 'the send itself is not faded: the attack feeds the tail in full, as it did').toEqual([['set', 0.35 * 0.16, 0]]);
    const gate = send.outs[0]!.outs[0]!;
    expect(gate.outs).toEqual([out]);
    expect(gate.gain.ramps[0]![0]).toBe('set');
    expect(gate.gain.ramps[0]![1]).toBeCloseTo(0.0001 / 0.35, 10); // the fader's 0.0001 floor, as a share of its level
    expect(gate.gain.ramps[1]).toEqual(['exp', 1, 0.05]);
    // A second hit 350 ms later lands on a ringing tail: the gate is left alone (ducking the tail would be audible).
    const n = gate.gain.ramps.length;
    play(a, bus, out, { level: 0.35, fadeInSec: 0.05 }, reverb, 0.35);
    expect(gate.gain.ramps.length).toBe(n);
    // Long after the tail has died, the next hit's fade-in rides the gate again.
    play(a, bus, out, { level: 0.35, fadeInSec: 0.05 }, reverb, 20);
    expect(gate.gain.ramps[gate.gain.ramps.length - 1]).toEqual(['exp', 1, 20.05]);
    // Layers with another fade-in never share that gate.
    expect(made()).toBe(1);
    play(a, bus, out, { level: 0.12, fadeInSec: 0.17 });
    expect(made()).toBe(2);
  });

  it('a play WITH a fade-out goes through a gate that closes over that fade (its tail used to be cut with its dry)', () => {
    const { a, mk, made } = fakeContext();
    const bus = mk('gain'); const out = mk('gain');
    const send = play(a, bus, out, { level: 0.2, fadeOutSec: 0.4 })!;
    const conv = send.outs[0]!;
    const gate = conv.outs[0]!;
    expect(gate.kind).toBe('gain');
    expect(gate.outs).toEqual([out]);
    expect(gate.gain.ramps).toHaveLength(2);
    expect(gate.gain.ramps[0]![0]).toBe('set');
    expect(gate.gain.ramps[0]![2]).toBeCloseTo(0.2, 6);  // where the fader's fade-out began: clip end - fade
    const last = gate.gain.ramps[1]!;
    expect(last[0]).toBe('exp');
    expect(last[1]).toBeCloseTo(0.0001 / 0.2, 8); // send x gate ends where the fader did: 0.0001
    expect(last[2]).toBeCloseTo(0.6, 5);          // at the clip's end
    // The ringing class and the fading class never share a node (a gate would cut the ringing tails).
    play(a, bus, out, { level: 0.2 });
    expect(made()).toBe(2);
    play(a, bus, out, { level: 0.2 });
    expect(made()).toBe(2);
  });

  it('two overlapping fading plays each keep their own gate; a burst past that shares, and never builds a third node', () => {
    const { a, mk, made } = fakeContext();
    const bus = mk('gain'); const out = mk('gain');
    expect(FADING_NODES).toBe(2);
    const first = play(a, bus, out, { level: 0.2, fadeOutSec: 0.4 }, reverb, 0)!.outs[0]!;
    const second = play(a, bus, out, { level: 0.2, fadeOutSec: 0.4 }, reverb, 0.3)!.outs[0]!; // the first is still playing
    expect(second).not.toBe(first);
    expect(made()).toBe(2);
    // A third within both clips shares the node whose fade lands first; nothing new is built, however long the burst.
    const third = play(a, bus, out, { level: 0.2, fadeOutSec: 0.4 }, reverb, 0.4)!.outs[0]!;
    expect(third).toBe(first);
    for (let i = 0; i < 30; i++) play(a, bus, out, { level: 0.2, fadeOutSec: 0.4 }, reverb, 0.5 + i * 0.12);
    expect(made()).toBe(2);
    // Once both have faded, the next play takes the one that has rung longest.
    const later = play(a, bus, out, { level: 0.2, fadeOutSec: 0.4 }, reverb, 30)!.outs[0]!;
    expect([first, second]).toContain(later);
    expect(made()).toBe(2);
  });

  it('a hard stop re-points the node at the new epoch on the next play', () => {
    const { a, mk } = fakeContext();
    const bus = mk('gain'); const out1 = mk('gain'); const out2 = mk('gain');
    const conv = play(a, bus, out1)!.outs[0]!;
    expect(conv.outs).toEqual([out1]);
    play(a, bus, out2);
    expect(conv.outs).toEqual([out2]);
  });

  it('anything that sat after the convolver keeps its own node: a Pan, an automated mix, an automated level, a loop', () => {
    expect(sharedReverbEligible(reverb)).toBe(true);
    expect(sharedReverbEligible({ ...reverb, panOn: true })).toBe(false);
    expect(sharedReverbEligible({ ...reverb, reverb_mixCurve: [[0, 1], [1, 0]] })).toBe(false);
    expect(sharedReverbEligible({ ...reverb, gainCurve: [[0, 0], [1, 1]] })).toBe(false);
    expect(sharedReverbEligible({ ...reverb, reverbOn: false })).toBe(false);
    const { a, mk, made } = fakeContext();
    const bus = mk('gain'); const out = mk('gain');
    expect(play(a, bus, out, {}, { ...reverb, panOn: true, pan_pan: 0.3 })).toBeNull();
    expect(made()).toBe(1); // its own (pooled) node
    expect(sharedFxReverbCount(bus as unknown as AudioNode)).toBe(0);
  });

  it('the big-hit impacts and the grant trail are all eligible, and none of them still asks for a pooled node', () => {
    const hits = bindings as Record<string, unknown>;
    expect(JSON.stringify(hits)).toContain('strike-impact-pink');
    const defs = [strikePink, strikePurple, strikeBlue, runeBuffTrail] as Array<{ layers: Array<{ primitive: string; params: Record<string, unknown> }> }>;
    let reverbd = 0;
    for (const d of defs) {
      for (const l of d.layers) {
        if (l.primitive !== 'sound' || l.params.reverbOn !== true) continue;
        reverbd++;
        expect(sharedReverbEligible(l.params)).toBe(true);
      }
    }
    expect(reverbd).toBeGreaterThanOrEqual(6);
    expect(reverbSpecsOf(defs)).toEqual([]);
  });
});
