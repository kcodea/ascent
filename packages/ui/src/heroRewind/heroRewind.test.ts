// @vitest-environment jsdom
/**
 * THE REWIND HERO ATTACK (the Ancient of Time, ANCIENT; owner 2026-10-02, REWIND & REPLAY): the shared four tiers; the
 * tuner values; the pure plan (I one strike; II one rewind; III two with an afterimage at every landing; IV five loops,
 * each faster, an echo frozen per rewind, every echo landing with the last replay); story time running BACKWARD through
 * a rewind (the bolt retraces its EXACT path, never a second throw); the runner on the shared clock (the blow lands
 * exactly ONCE; both directions; replay; finish / cancel; cleanup; the camera applied once); the headless scene; the
 * cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_REWIND_DEFAULTS, HERO_REWIND_RANGES, clampHeroRewindValue, echoFinalePos, flyEase, flyEaseInv, haloRateAt, heroRewindConfigJson,
  pathAt, rewindCues, rewindPath, rewindPlan, rewindSlowExtraMs, rewindStateAt, rewindTimeScale, strikePos, type HeroRewindNumKey,
} from './heroRewindConfig';
import { HeroRewindScene, MAX_REWIND_SPRITES, type HeroRewindTextures } from './heroRewindScene';
import { playHeroRewind, type HeroRewindOptions } from './heroRewind';
import { SPEC } from '../HeroRewindTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroRewindTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  grain: W, halo: W, orbit: W, clockHand: W, hourglass: W, shard: W, clockFace: W, bigShard: W, wash: W,
};
const C = HERO_REWIND_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => rewindPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;

describe('the tiers', () => {
  it('uses the shared thresholds; a knockout plays IV', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).tier, `dmg ${d}`).toBe(tierOf(d));
    expect(plan(2, { knockout: true }).tier).toBe(4);
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top with all four tiers', () => {
    for (const [k, [min, max]] of Object.entries(HERO_REWIND_RANGES)) {
      const v = C[k as HeroRewindNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroRewindValue('t4Rewinds', 99)).toBe(6);
    expect(clampHeroRewindValue('colorViolet', 'violet')).toBe(C.colorViolet);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroRewindConfigJson(C)).previewParts).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions!.map((a) => a.label);
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)']) expect(labels).toContain(l);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('rewind');
  });

  it('never uses the overused rune explosion or turn explosion sounds', () => {
    for (const [k, v] of Object.entries(C)) {
      if (!k.endsWith('Clip')) continue;
      expect(String(v), k).not.toMatch(/turnexplosion|rune/i);
    }
  });
});

describe('the plan', () => {
  it('I: one strike, no rewind; the landing IS the impact', () => {
    const p = plan(3);
    expect(p.strikes).toHaveLength(1);
    expect(p.hits).toEqual([]);
    expect(p.rewinds).toEqual([]);
    expect(p.impactAt).toBe(p.strikes[0]!.landAt);
    expect(p.afterimages).toEqual([]);
    expect(p.echoes).toEqual([]);
  });

  it('II: it lands (a tick), rewinds back to the hand, and the SAME strike lands again (THE impact)', () => {
    const p = plan(8);
    expect(p.strikes).toHaveLength(2);
    const [a, b] = p.strikes;
    expect(p.hits).toEqual([a!.landAt]);
    expect(a!.rewindAt).toBe(a!.landAt + a!.holdMs);
    expect(b!.flyAt).toBeGreaterThanOrEqual(a!.backAt);
    expect(p.impactAt).toBe(b!.landAt);
    const kinds = rewindCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.indexOf('hit')).toBeLessThan(kinds.indexOf('rewind'));
    expect(kinds.indexOf('rewind')).toBeLessThan(kinds.indexOf('back'));
    expect(kinds.indexOf('back')).toBeLessThan(kinds.indexOf('impact'));
  });

  it('III: two rewinds; an afterimage at each loop\'s landing; on the last replay they land a beat ahead of the bolt (a stutter); each loop faster', () => {
    const p = plan(14);
    expect(p.strikes).toHaveLength(3);
    expect(p.afterimages).toEqual(p.strikes.slice(0, 2).map((s) => s.landAt));
    expect(p.stutters).toHaveLength(2);
    // bam, bam, BAM: the two afterimages land in order, a beat apart, inside the last flight, then the impact
    expect(p.stutters[0]!).toBeLessThan(p.stutters[1]!);
    expect(p.stutters[1]!).toBeLessThan(p.impactAt);
    expect(p.stutters[0]!).toBeGreaterThan(p.strikes[2]!.flyAt);
    expect(p.impactAt - p.stutters[1]!).toBeCloseTo(C.stutterMs, 6);
    expect(p.hits).toHaveLength(4); // two loop landings + two stutter landings, all ticks
    expect(p.strikes[1]!.flyMs).toBeLessThan(p.strikes[0]!.flyMs);
    expect(p.strikes[1]!.rewindMs).toBeLessThan(p.strikes[0]!.rewindMs);
    expect(rewindCues(p).filter((q) => q.kind === 'stutter')).toHaveLength(2);
    expect(rewindCues(p).filter((q) => q.kind === 'impact')).toHaveLength(1);
  });

  it('the rewinds are fast scrubs (about 120-200 ms) and every replay snaps back faster than the last', () => {
    for (const d of [8, 14, 40]) {
      const p = plan(d);
      expect(p.strikes[0]!.rewindMs, `dmg ${d}`).toBeGreaterThanOrEqual(110);
      expect(p.strikes[0]!.rewindMs, `dmg ${d}`).toBeLessThanOrEqual(200);
      for (let i = 1; i < p.strikes.length - (p.tier === 4 ? 1 : 0); i++) expect(p.strikes[i]!.flyMs, `dmg ${d} strike ${i}`).toBeLessThan(p.strikes[i - 1]!.flyMs);
      // no dead air: each replay leaves the instant the scrub reaches the hand
      for (let i = 1; i < p.strikes.length; i++) expect(p.strikes[i]!.flyAt).toBe(p.strikes[i - 1]!.backAt);
    }
  });

  it('IV (and every knockout): five rewinds, each loop faster; an echo frozen per rewind; every echo lands with the last', () => {
    for (const p of [plan(40), plan(2, { knockout: true })]) {
      expect(p.strikes).toHaveLength(6);
      expect(p.hits).toHaveLength(5);
      expect(p.rewinds).toHaveLength(5);
      const loops = p.strikes.slice(0, -1).map((s) => s.backAt - s.flyAt);
      for (let i = 1; i < loops.length; i++) expect(loops[i]!).toBeLessThan(loops[i - 1]!);
      expect(p.echoes).toHaveLength(5);
      p.echoes.forEach((e, i) => {
        const st = p.strikes[i]!;
        expect(e.at).toBeGreaterThan(st.rewindAt);
        expect(e.at).toBeLessThan(st.backAt);
        // shed exactly where the rewinding bolt is at that moment
        const state = rewindStateAt(p, e.at)!;
        expect(state.rewinding).toBe(true);
        expect(flyEase(state.s / st.flyMs)).toBeCloseTo(e.pathS, 6);
      });
      expect(p.finaleAt).toBe(p.strikes[5]!.flyAt);
      expect(p.hourglassAt).toBeGreaterThan(p.throwAt);
      expect(p.hourglassAt).toBeLessThan(p.impactAt);
      expect(rewindCues(p).filter((q) => q.kind === 'impact')).toHaveLength(1);
    }
  });

  it('pace: I and II at or under Bleed / Banana / Basketball (1470 / 1740 ms after the formation); III and IV snappy', () => {
    const len = (d: number): number => { const p = plan(d); return p.endAt - p.chargeAt + rewindSlowExtraMs(p, C); };
    expect(len(3)).toBeLessThanOrEqual(1200);
    expect(len(8)).toBeLessThanOrEqual(1500);
    expect(len(14)).toBeLessThanOrEqual(2000);
    expect(len(40)).toBeLessThanOrEqual(3200);
  });

  it('IV\'s shatter gets a slow-mo DIP that never freezes (R-PROG-ATTACK-10); no other tier dips', () => {
    const p = plan(40);
    let lo = 1;
    for (let t = p.impactAt - 50; t < p.impactAt + C.slowMoMs + 50; t += 5) {
      const k = rewindTimeScale(p, C, t);
      expect(k).toBeGreaterThan(0.09);
      lo = Math.min(lo, k);
    }
    expect(lo).toBeCloseTo(C.slowMo, 2);
    expect(rewindTimeScale(p, C, p.impactAt - 1)).toBe(1);
    for (const d of [3, 8, 14]) { const q = plan(d); expect(rewindTimeScale(q, C, q.impactAt + 10)).toBe(1); }
  });

  it('the Knockout bolt-on point: one extra replay on Huge adds a loop and an echo, still one impact', () => {
    const base = plan(40);
    const ko = rewindPlan({ total: 40, distance: 1600, leadIn: leadInOf([40]), extraRewinds: 1 }, C);
    expect(ko.strikes).toHaveLength(base.strikes.length + 1);
    expect(ko.echoes).toHaveLength(base.echoes.length + 1);
    expect(rewindCues(ko).filter((q) => q.kind === 'impact')).toHaveLength(1);
    expect(ko.impactAt - base.impactAt).toBeLessThan(150); // the extra loop is the fastest one
  });

  it('reduced motion: no flight; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.impactAt).toBe(leadInOf([40], true));
    expect(p.strikes).toEqual([]);
    expect(rewindStateAt(p, p.impactAt)).toBeNull();
  });
});

describe('story time: a rewind is the forward strike run BACKWARD', () => {
  it('flyEaseInv inverts flyEase', () => {
    for (let s = 0; s <= 1; s += 0.05) expect(flyEase(flyEaseInv(s))).toBeCloseTo(s, 9);
  });

  it('through a rewind the bolt retraces the EXACT forward path, from the hit back to the hand', () => {
    const p = plan(8);
    const path = rewindPath(A, D, R, R, C.arc);
    const st = p.strikes[0]!;
    const fwd: { x: number; y: number }[] = [];
    for (let t = st.flyAt; t < st.landAt; t += 5) fwd.push(strikePos(path, st.flyMs, rewindStateAt(p, t)!.s));
    let prevS = Infinity;
    for (let t = st.rewindAt + 1; t < st.backAt; t += 5) {
      const s = rewindStateAt(p, t)!;
      expect(s.rewinding).toBe(true);
      expect(s.s).toBeLessThan(prevS); // story time only runs back
      prevS = s.s;
      if (s.s >= st.flyMs) continue; // the splash running back in: the bolt is still inside the hit
      const at = strikePos(path, st.flyMs, s.s);
      // every rewind point lies ON the forward path (within a sampling step)
      const near = Math.min(...fwd.map((f) => Math.hypot(f.x - at.x, f.y - at.y)));
      expect(near).toBeLessThan(25);
    }
    // it starts at the hit and ends in the hand
    expect(strikePos(path, st.flyMs, st.flyMs)).toEqual(path.hit);
    expect(strikePos(path, st.flyMs, 0)).toEqual(path.hand);
    expect(rewindStateAt(p, st.backAt + 1)).toMatchObject({ i: 1, rewinding: false }); // back in the hand: the replay leaves at once
  });

  it('the path leaves the striker\'s hand and lands on the struck portrait', () => {
    const path = rewindPath(A, D, R, R, C.arc);
    expect(Math.hypot(path.hand.x - A.x, path.hand.y - A.y)).toBeLessThanOrEqual(R);
    expect(Math.hypot(path.hit.x - D.x, path.hit.y - D.y)).toBeLessThanOrEqual(R * 0.5);
    expect(pathAt(path, 0)).toEqual(path.hand);
    expect(pathAt(path, 1)).toEqual(path.hit);
  });

  it('IV\'s finale: every echo starts where it froze and arrives at the hit together', () => {
    const p = plan(40);
    const path = rewindPath(A, D, R, R, C.arc);
    for (const e of p.echoes) {
      const a = echoFinalePos(path, e, 0), b = echoFinalePos(path, e, 1);
      const at = pathAt(path, e.pathS);
      expect(Math.hypot(a.x - at.x, a.y - at.y)).toBeLessThan(1e-6);
      expect(Math.hypot(b.x - path.hit.x, b.y - path.hit.y)).toBeLessThan(1e-6);
    }
  });

  it('the halo spins BACKWARD while time rewinds; IV spins backward the whole loop, harder each loop', () => {
    const p2 = plan(8);
    const st = p2.strikes[0]!;
    expect(haloRateAt(p2, C, (st.flyAt + st.landAt) / 2)).toBeGreaterThan(0);
    expect(haloRateAt(p2, C, (st.rewindAt + st.backAt) / 2)).toBeLessThan(0);
    const p4 = plan(40);
    const r = p4.strikes.slice(0, -1).map((s) => haloRateAt(p4, C, (s.rewindAt + s.backAt) / 2));
    for (const v of r) expect(v).toBeLessThan(0);
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeLessThan(r[i - 1]!);
    expect(haloRateAt(p4, C, (p4.strikes[0]!.flyAt + p4.strikes[0]!.landAt) / 2)).toBeLessThan(0);
  });
});

function manualFrames(): { frames: HeroRewindOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroRewindOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroRewind({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('II: the blow lands ONCE on the replay, never the first landing; the struck portrait re-jolts in the rewind; everything is put back', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 8, formation: formationOf([8], 8) });
    expect(host.querySelector('.hblast.hrewind')).not.toBeNull();
    const st = h.plan.strikes[0]!;
    f.tick(st.landAt - 30, 4);
    expect(h.scene!.boltVisible).toBe(true);
    expect(h.scene!.haloVisible).toBe(true);
    f.tick(st.landAt - h.elapsed() + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(defenderEl.style.transform).toContain('translate(');
    // mid-rewind: the bolt is back out of the face, flying home
    f.tick((st.rewindAt + st.backAt) / 2 - h.elapsed(), 4);
    expect(h.scene!.boltVisible).toBe(true);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-8');
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(3000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('IV: echoes freeze one per rewind, the hourglass forms, and all of it lands once in the shatter', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.finaleAt - 4, 4);
    expect(h.scene!.frozenEchoes).toBe(5);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.hourglassAt - h.elapsed() + 20, 4);
    expect(h.scene!.hourglassVisible).toBe(true);
    expect(h.scene!.dialVisible).toBe(true);
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.frozenEchoes).toBe(0);
    expect(h.scene!.hourglassVisible).toBe(false);
    f.tick(600, 4); // the clock face snaps away with the shatter (time snapping back; the clock is in its slow-mo dip)
    expect(h.scene!.dialVisible).toBe(false);
    h.cancel();
  });

  it('THE GOD manifests over the board (its art), pours from its hand, and leaves; every board row twitches back on a rewind and is restored', () => {
    const rowA = document.createElement('div'); rowA.setAttribute('data-zone', 'warband');
    const r1 = document.createElement('div'); r1.className = 'row'; rowA.appendChild(r1);
    const rowB = document.createElement('div'); rowB.setAttribute('data-zone', 'tavern');
    const r2 = document.createElement('div'); r2.className = 'row'; rowB.appendChild(r2);
    document.body.append(rowA, rowB);
    const { h, f, onDone } = run({ total: 8, formation: formationOf([8], 8) });
    h.scene!.setGodTexture(Texture.WHITE);
    // the torrent pours from the god's hand, not the striker
    expect(Math.hypot(h.path.hand.x - 100, h.path.hand.y - 800)).toBeGreaterThan(R * 2);
    f.tick(h.plan.throwAt + 10, 4);
    expect(h.scene!.godVisible).toBe(true);
    expect(h.scene!.haloVisible).toBe(true);
    f.tick(h.plan.rewinds[0]! - h.elapsed() + 30, 2);
    expect(r1.style.transform).toContain('translate(');
    expect(r2.style.transform).toContain('translate(');
    f.tick(h.plan.endAt - h.elapsed() + 40, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(r1.style.transform).toBe('');
    expect(r2.style.transform).toBe('');
    expect(h.scene?.godVisible ?? false).toBe(false);
  });

  it('III: two afterimages wait at the contact, then land in a stutter ahead of the bolt (ticks); the blow lands once', () => {
    const { h, f, onImpact } = run({ total: 14, formation: formationOf([14], 14) });
    f.tick(h.plan.strikes[2]!.flyAt - 4, 4);
    expect(h.scene!.liveEchoes).toBe(2);
    f.tick(h.plan.stutters[1]! - h.elapsed() + 6, 2);
    expect(h.scene!.liveEchoes).toBe(0); // both landed (spent)
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() + 6, 2);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('a rewind looks like time breaking: the RGB split shows only while it scrubs back, and the sand vortex runs', () => {
    const { h, f } = run({ total: 8, formation: formationOf([8], 8) });
    const st = h.plan.strikes[0]!;
    f.tick((st.flyAt + st.landAt) / 2, 4);
    expect(h.scene!.splitVisible).toBe(false);
    f.tick(st.rewindAt - h.elapsed() + 4, 2);
    expect(h.scene!.vortexGrains).toBeGreaterThan(0);
    f.tick((st.rewindAt + st.backAt) / 2 - h.elapsed(), 2);
    expect(h.scene!.splitVisible).toBe(true);
    h.cancel();
  });

  it('both directions at every tier, within the cap; the camera applied once when the canvas rides it', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.endAt; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_REWIND_SPRITES);
        h.cancel();
      }
    }
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const { h, f, root } = run({ camera, total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.impactAt + 20, 4);
    expect(h.mirrorsCamera).toBe(false);
    expect((root.children[0] as Container).scale.x).toBe(1);
    h.cancel();
  });

  it('finish() lands once; cancel() never lands; a replay plays the same; reduced motion lands once', () => {
    const a = run();
    a.f.tick(200, 16);
    a.h.finish();
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    const b = run();
    b.f.tick(200, 16);
    b.h.cancel();
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.f.hooked()).toBe(0);
    const x = run({ total: 40, formation: formationOf([40], 40) });
    const y = run({ total: 40, formation: formationOf([40], 40) });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.path).toEqual(y.h.path);
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap through IV\'s shatter, drains, and destroy leaves nothing', () => {
    const scene = new HeroRewindScene(TEX, { sand: 0xf5d78a, sandLight: 0xffe9b0, gold: 0xd4a537, violet: 0x8b5cf6, splitA: 0xff3d7f, splitB: 0x3de8ff, side: 0xffe9b0 },
      { boltPx: 50, trailWidth: 26, splitPx: 7, grainRate: 110, echoMs: 700, echoTremble: 2.5, hourglassSize: 2.1, shatterSize: 1.15 }, 1, 3);
    const path = rewindPath(A, D, R, R, C.arc);
    scene.setPath((s) => pathAt(path, s));
    scene.startCharge(path.hand, 50, 300);
    for (let t = 0; t < 300; t += 16) scene.update(16);
    const sample = (ms: number) => strikePos(path, 340, ms);
    scene.launch(path.hand, 0);
    for (let s = 0; s < 340; s += 16) { scene.setBolt({ sample, s, flyMs: 340, span: 170, rate: 1, size: 1.2, drain: 150 }); scene.update(16); }
    for (let i = 0; i < 5; i++) {
      scene.hit(path.hit, path.arrive, 1, 16);
      scene.unsplash(path.hit, R, 100, 16, 1);
      for (let s = 340; s > 0; s -= 24) { scene.setBolt({ sample, s, flyMs: 340, span: 170, rate: -1.4, size: 1.2, drain: 30 }); scene.update(16); }
      scene.scrub({ x: 0, y: 0, w: 1600, h: 900 }, 150, 10);
      scene.freezeEcho(i, 0.8 - 0.1 * i, 1);
      scene.back(path.hand, 50, 10);
    }
    scene.setHalo(A, 100, 1, -1, 2, 1, true);
    scene.hourglass(D, R, 400);
    for (let t = 0; t < 400; t += 16) scene.update(16);
    scene.setDial(D, R * 1.35, 1, 1);
    scene.impact(path.hit, path.arrive, R, { tier: 4, grains: 28, area: { x: 1000, y: 0, w: 800, h: 500 }, rain: 120 });
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_REWIND_SPRITES);
    scene.setBolt(null);
    scene.setHalo(A, 0, 0, 0, 0, 0, false);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});

describe('the cosmetic', () => {
  it('Rewind (attack_rewind) is an ANCIENT crate hero attack that plays the rewind', () => {
    expect(COSMETIC_INDEX.attack_rewind).toMatchObject({ category: 'hero_attack', rarity: 'ancient', name: 'Rewind', assets: { style: 'rewind' }, active: true });
    expect(HERO_ATTACK_STYLES).toContain('rewind');
    expect(styleOfCosmetic('attack_rewind')).toBe('rewind');
  });
});
