import { describe, it, expect } from 'vitest';
import { FuseSim, type FuseGeom, type FuseParticle } from './fuseSim';
import { FUSE_DEFAULTS, type FuseCfg } from './fuseTune';

const g: FuseGeom = { fuseX0: 0, fuseX1: 1000, fuseY: 0, fuseThick: 16, gemX: 1100, gemY: 0 };
const DT = 1 / 60;
const snap = (s: FuseSim): FuseParticle[] => s.particles.map((p) => ({ ...p }));
const dist = (p: FuseParticle): number => Math.hypot(p.x - g.gemX, p.y - g.gemY);

/** Steps `n` frames with charge rising linearly from `c0` to `c1`. */
function ramp(s: FuseSim, n: number, c0: number, c1: number): void {
  for (let i = 1; i <= n; i++) s.step(DT, c0 + ((c1 - c0) * i) / n, g);
}
function fresh(cfg: Partial<FuseCfg> = {}, seed = 7): FuseSim {
  const s = new FuseSim({ ...FUSE_DEFAULTS, ...cfg }, seed);
  s.step(DT, 0, g); // baseline: the first step only records the charge
  return s;
}

describe('FuseSim', () => {
  it('same seed, same inputs → identical particles', () => {
    const a = fresh(); const b = fresh();
    ramp(a, 120, 0, 0.5); ramp(b, 120, 0, 0.5);
    expect(a.particles.length).toBeGreaterThan(0);
    expect(snap(a)).toEqual(snap(b));
  });

  it('different seeds diverge', () => {
    const a = fresh({}, 1); const b = fresh({}, 2);
    ramp(a, 60, 0, 0.3); ramp(b, 60, 0, 0.3);
    expect(snap(a)).not.toEqual(snap(b));
  });

  it('step(0) is an exact no-op', () => {
    const s = fresh();
    ramp(s, 60, 0, 0.3);
    const before = snap(s); const pulse = s.absorbPulse;
    s.step(0, 0.3, g);
    expect(snap(s)).toEqual(before);
    expect(s.absorbPulse).toBe(pulse);
  });

  it('spawn tracks charge, not dt', () => {
    const one = fresh(); one.step(0.2, 0.1, g);
    const ten = fresh(); ramp(ten, 10, 0, 0.1);
    const expected = FUSE_DEFAULTS.spawnPerFuse * 0.1;
    expect(Math.abs(one.particles.length - ten.particles.length)).toBeLessThanOrEqual(1);
    expect(Math.abs(one.particles.length - expected)).toBeLessThanOrEqual(1);
  });

  it('a hitch spreads its spawns along the burnt stretch (no clump at the front)', () => {
    const s = fresh({ spawnSpeed: 0, turbulence: 0, pull: 0, vortex: 0 });
    s.step(0, 0, g);
    s.step(1e-6, 0.2, g);
    const xs = s.particles.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(60);
    expect(Math.max(...xs)).toBeGreaterThan(140);
  });

  it('pull draws a still particle toward the gem', () => {
    const s = fresh({ turbulence: 0, vortex: 0 });
    const p = s.addParticle({ x: 600, y: 40 });
    const d0 = dist(p);
    for (let i = 0; i < 30; i++) s.step(DT, 0.5, g);
    expect(dist(p)).toBeLessThan(d0);
  });

  it('vortex gives tangential motion (clockwise on screen: up at the gem\'s left)', () => {
    const s = fresh({ turbulence: 0, pull: 0 });
    const p = s.addParticle({ x: g.gemX - 60, y: g.gemY });
    s.step(DT, 0.5, g);
    expect(p.vy).toBeLessThan(0);
  });

  it('heavier shards turn slower', () => {
    const s = fresh({ turbulence: 0 });
    const shard = s.addParticle({ kind: 'shard', x: 700, y: 30 });
    const mote = s.addParticle({ kind: 'mote', x: 700, y: 30 });
    s.step(DT, 0.5, g);
    expect(Math.hypot(mote.vx, mote.vy)).toBeGreaterThan(Math.hypot(shard.vx, shard.vy));
  });

  it('absorbs inside absorbR and pulses the gem', () => {
    const s = fresh();
    s.addParticle({ x: g.gemX + 1, y: g.gemY });
    const n = s.particles.length;
    s.step(DT, 0, g); // charge did not move, so nothing new spawns
    expect(s.particles.length).toBe(n - 1);
    expect(s.absorbPulse).toBeGreaterThan(0);
  });

  it('maxLive is never exceeded', () => {
    const s = fresh({ spawnPerFuse: FUSE_DEFAULTS.maxLive * 10 });
    s.step(DT, 1, g);
    expect(s.particles.length).toBeLessThanOrEqual(FUSE_DEFAULTS.maxLive);
    ramp(s, 30, 1, 1);
    expect(s.particles.length).toBeLessThanOrEqual(FUSE_DEFAULTS.maxLive);
  });

  it('collapse empties to idle, then the wait stays bounded', () => {
    const s = fresh();
    ramp(s, 600, 0, 1);
    expect(s.particles.length).toBeGreaterThan(FUSE_DEFAULTS.idleOrbiters);
    s.collapse();
    expect(s.mode).toBe('collapsing');
    for (let i = 0; i < 240; i++) s.step(DT, 1, g);
    expect(s.collapseDone).toBe(true);
    expect(s.mode).toBe('idle');
    const n = s.particles.length;
    expect(n).toBeLessThanOrEqual(FUSE_DEFAULTS.idleOrbiters);
    // idle wait stays bounded: 600 s of frames, no growth, everyone stays near the gem
    for (let i = 0; i < 600 * 60; i++) {
      s.step(DT, 1, g);
      if (i % 600 === 0) {
        expect(s.particles.length).toBeLessThanOrEqual(n);
        for (const p of s.particles) expect(dist(p)).toBeLessThan(FUSE_DEFAULTS.vortexR * 3);
      }
    }
    expect(s.particles.length).toBe(n);
    for (const p of s.particles) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('a collapse with nothing in flight goes straight to a few orbiters', () => {
    const s = new FuseSim(FUSE_DEFAULTS, 3);
    s.collapse();
    s.step(DT, 1, g);
    expect(s.mode).toBe('idle');
    expect(s.particles.length).toBe(FUSE_DEFAULTS.idleOrbiters);
  });

  it('prewarm fills in debris within its step budget', () => {
    const s = new FuseSim(FUSE_DEFAULTS, 5);
    s.prewarm(0.6, g);
    expect(s.particles.length).toBeGreaterThan(0);
    expect(s.lastPrewarmSteps).toBeGreaterThan(0);
    expect(s.lastPrewarmSteps).toBeLessThanOrEqual(90);
    s.prewarm(0.6, g, 20);
    expect(s.lastPrewarmSteps).toBeLessThanOrEqual(20);
  });

  it('reset clears everything', () => {
    const s = fresh();
    ramp(s, 60, 0, 0.4);
    s.collapse();
    s.reset(9);
    expect(s.particles.length).toBe(0);
    expect(s.mode).toBe('charging');
    expect(s.collapseDone).toBe(false);
  });
});
