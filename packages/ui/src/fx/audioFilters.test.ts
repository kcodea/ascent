import { describe, expect, it } from 'vitest';
import { AUDIO_FILTERS, audioFilterSpecs, buildAudioFilterChain } from './audioFilters';
import { defaultsOf, validateSpecs } from './params';

/**
 * The chain builder takes its AudioContext by argument, so this fake — which records every `connect()` as an
 * edge and exposes each node's set params — verifies the wiring (which nodes, in which order, linked how)
 * without real Web Audio. The DSP itself (how it SOUNDS) is a by-ear check in the workshop.
 */
interface FakeNode {
  kind: string;
  type: string;
  oversample: string;
  curve: Float32Array | null;
  frequency: { value: number }; Q: { value: number }; gain: { value: number };
  threshold: { value: number }; knee: { value: number }; ratio: { value: number };
  attack: { value: number }; release: { value: number };
  delayTime: { value: number }; pan: { value: number };
  connect(dest: FakeNode): FakeNode;
}
function fakeContext() {
  const edges: Array<[FakeNode, FakeNode]> = [];
  const mk = (kind: string): FakeNode => {
    const n: FakeNode = {
      kind, type: '', oversample: 'none', curve: null,
      frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 },
      threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
      attack: { value: 0 }, release: { value: 0 }, delayTime: { value: 0 }, pan: { value: 0 },
      connect(dest) { edges.push([n, dest]); return dest; },
    };
    return n;
  };
  const a = {
    createBiquadFilter: () => mk('biquad'),
    createDynamicsCompressor: () => mk('comp'),
    createWaveShaper: () => mk('shaper'),
    createGain: () => mk('gain'),
    createDelay: (_max?: number) => mk('delay'),
    createStereoPanner: () => mk('panner'),
  };
  return { a: a as unknown as BaseAudioContext, edges };
}
const on = (id: string) => `${id}On`;

describe('audioFilterSpecs', () => {
  it('generates a well-formed, self-validating toggle + gated sliders per filter', () => {
    const specs = audioFilterSpecs();
    expect(validateSpecs(specs)).toEqual([]);
    for (const f of AUDIO_FILTERS) {
      const toggle = specs[on(f.id)];
      expect(toggle).toMatchObject({ kind: 'toggle', default: false, group: f.label });
      for (const k of f.knobs) {
        const slider = specs[`${f.id}_${k.name}`];
        expect(slider).toMatchObject({ kind: 'slider', group: f.label, enabledWhen: { param: on(f.id), is: true } });
      }
    }
  });

  it('ships every filter OFF by default (an unused filter allocates nothing)', () => {
    const d = defaultsOf(audioFilterSpecs());
    for (const f of AUDIO_FILTERS) expect(d[on(f.id)]).toBe(false);
  });
});

describe('buildAudioFilterChain', () => {
  it('returns null when no filter is enabled', () => {
    const { a } = fakeContext();
    expect(buildAudioFilterChain(a, {})).toBeNull();
    expect(buildAudioFilterChain(a, undefined)).toBeNull();
  });

  it('builds a single filter as its own input/output and applies its knob', () => {
    const { a } = fakeContext();
    const chain = buildAudioFilterChain(a, { ...defaultsOf(audioFilterSpecs()), panOn: true, pan_pan: -0.5 });
    expect(chain).not.toBeNull();
    const inp = chain!.input as unknown as FakeNode;
    expect(inp.kind).toBe('panner');
    expect(chain!.output).toBe(chain!.input);
    expect(inp.pan.value).toBe(-0.5);
  });

  it('links enabled filters in the fixed registry order, regardless of which was toggled first', () => {
    const { a, edges } = fakeContext();
    // Enable comp + pan; comp precedes pan in the registry, so the signal must go comp → pan.
    const chain = buildAudioFilterChain(a, { compOn: true, panOn: true });
    const inp = chain!.input as unknown as FakeNode;
    const out = chain!.output as unknown as FakeNode;
    expect(inp.kind).toBe('comp');
    expect(out.kind).toBe('panner');
    expect(edges.some(([from, to]) => from.kind === 'comp' && to.kind === 'panner')).toBe(true);
    expect(edges.some(([from, to]) => from.kind === 'panner' && to.kind === 'comp')).toBe(false);
  });

  it('wires the 3-band EQ as lowshelf → peaking → highshelf', () => {
    const { a, edges } = fakeContext();
    const chain = buildAudioFilterChain(a, { eqOn: true, eq_low: 6, eq_high: -3 });
    const inp = chain!.input as unknown as FakeNode;
    const out = chain!.output as unknown as FakeNode;
    expect(inp.type).toBe('lowshelf');
    expect(inp.gain.value).toBe(6);
    expect(out.type).toBe('highshelf');
    expect(out.gain.value).toBe(-3);
    // three biquads chained internally
    const biquads = new Set<FakeNode>();
    for (const [from, to] of edges) { if (from.kind === 'biquad') biquads.add(from); if (to.kind === 'biquad') biquads.add(to); }
    expect(biquads.size).toBe(3);
  });

  it('gives distortion a dry/wet gain graph and a shaped curve', () => {
    const { a, edges } = fakeContext();
    const chain = buildAudioFilterChain(a, { distortOn: true, distort_drive: 0.5, distort_mix: 0.8 });
    expect((chain!.input as unknown as FakeNode).kind).toBe('gain');
    expect((chain!.output as unknown as FakeNode).kind).toBe('gain');
    const shaper = edges.map(([f]) => f).find((n) => n.kind === 'shaper');
    expect(shaper?.curve).toBeInstanceOf(Float32Array);
  });
});
