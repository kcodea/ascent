import { describe, expect, it } from 'vitest';
import {
  EXECUTE_COLOR_GROUPS, EXECUTE_COLOR_KEYS, EXECUTE_GROUPS, EXECUTE_KEYS, EXECUTE_RANGES,
  buildExecuteLayers, getExecuteConfig,
} from './executeConfig';

describe('executeConfig', () => {
  it('every key has a slider range (the tuner renders one row per key)', () => {
    for (const k of EXECUTE_KEYS) expect(EXECUTE_RANGES[k], k).toHaveLength(3);
  });

  // The tuner renders from EXECUTE_GROUPS, so a key missing from every group would be a dial that exists but
  // can't be reached — same guard as the Ward tuner.
  it('every key appears in exactly one tuner group', () => {
    const grouped = EXECUTE_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...EXECUTE_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("each default sits inside its own slider's range", () => {
    const cfg = getExecuteConfig();
    for (const k of EXECUTE_KEYS) {
      const [min, max] = EXECUTE_RANGES[k];
      expect(cfg[k], k).toBeGreaterThanOrEqual(min);
      expect(cfg[k], k).toBeLessThanOrEqual(max);
    }
  });
});

describe('execute colours', () => {
  it('every colour key appears in exactly one colour group', () => {
    const grouped = EXECUTE_COLOR_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...EXECUTE_COLOR_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
  it('colour keys are excluded from the numeric keys (they have no slider range)', () => {
    for (const k of EXECUTE_COLOR_KEYS) expect(EXECUTE_KEYS, k).not.toContain(k);
    expect(Object.keys(EXECUTE_RANGES).sort()).toEqual([...EXECUTE_KEYS].sort());
  });
  it('every colour default is a #rrggbb string', () => {
    const cfg = getExecuteConfig() as unknown as Record<string, string>;
    for (const k of EXECUTE_COLOR_KEYS) expect(cfg[k], k).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('buildExecuteLayers', () => {
  const cfg = getExecuteConfig();

  it('builds one element per configured count', () => {
    const l = buildExecuteLayers(cfg);
    // smoke splits across TWO counter-spinning rings, so each holds half the blobs
    expect(l.smoke).toHaveLength(2);
    for (const ring of l.smoke) expect(ring.blobs).toHaveLength(Math.round(cfg.smokeCount / 2));
    expect(l.arcs).toHaveLength(cfg.arcCount);
    expect(l.glints).toHaveLength(cfg.glintCount);
    expect(l.shards).toHaveLength(cfg.shardCount);
  });

  it('emits no smoke rings at all when the count is zero', () => {
    expect(buildExecuteLayers({ ...cfg, smokeCount: 0 }).smoke).toHaveLength(0);
  });

  // A shard's tail is optional; at 0 it must be absent, not a zero-height element still costing a node.
  it('drops the shard tail element when tail length is 0', () => {
    expect(buildExecuteLayers({ ...cfg, shardTail: 0 }).shards.every((s) => s.tail === null)).toBe(true);
    expect(buildExecuteLayers({ ...cfg, shardTail: 20 }).shards.every((s) => s.tail !== null)).toBe(true);
  });

  // The whole point of the wrapper: the squash must live there, NOT on the spinning ring (which would shear
  // each comet as it rotates instead of sweeping a clean ellipse).
  it('puts the arc squash on the wrapper, not the rings', () => {
    const l = buildExecuteLayers({ ...cfg, arcSx: 1.5, arcSy: 0.5 });
    expect(l.arcWrap.transform).toBe('scale(1.5, 0.5)');
    for (const a of l.arcs) expect(a.transform).toBeUndefined();
  });

  // Static paint only — animating a gradient or blur per frame is the repo's cardinal perf sin.
  it('precomputes gradients + masks as static paint', () => {
    const l = buildExecuteLayers(cfg);
    for (const a of l.arcs) {
      expect(String(a.background)).toContain('conic-gradient');
      expect(String(a.maskImage)).toContain('radial-gradient');
    }
  });

  // Deterministic scatter: rebuilding the same config must produce identical styles, or the aura would visibly
  // reshuffle every time the tuner is nudged (and differ between two cards of the same unit).
  it('is deterministic for a given config', () => {
    expect(buildExecuteLayers(cfg)).toEqual(buildExecuteLayers(cfg));
  });
});
