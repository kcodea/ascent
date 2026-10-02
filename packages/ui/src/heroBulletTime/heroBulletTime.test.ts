// @vitest-environment jsdom
/**
 * THE BULLET TIME HERO ATTACK (the Ancient of Time, ANCIENT; owner 2026-10-02 picked "BULLET TIME"): the shared four
 * tiers; the tuner values; the pure plan (I one dart; II three round the target; III a spiral volley and a run; IV the
 * dome, the 3-2-1 and the collapse); every shape CENTRED ON THE TARGET; the blades brake into SLOW MOTION and keep
 * crawling (never stop); the runner on the shared clock (the blow lands exactly ONCE; the FX slow down then snap back;
 * nothing is greyed; both directions; replay; finish / cancel; cleanup; the camera applied once); the headless scene;
 * the cosmetic. No Ancient art is used.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_BULLET_DEFAULTS, HERO_BULLET_RANGES, bulletCues, bulletPlan, bulletSlowExtraMs, bulletTimeScale, clampHeroBulletTimeValue, dartAt,
  dartGeos, heroBulletTimeConfigJson, stopTicks, inSlowMo, hangPoints, type HeroBulletNumKey,
} from './heroBulletTimeConfig';
import { HeroBulletTimeScene, MAX_BULLET_SPRITES, type HeroBulletTimeTextures } from './heroBulletTimeScene';
import { playHeroBulletTime, type HeroBulletTimeOptions } from './heroBulletTime';
import { SPEC } from '../HeroBulletTimeTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroBulletTimeTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  dart: W, glint: W, mote: W, clockFace: W, clockHand: W, wash: W, digit3: W, digit2: W, digit1: W,
};
const C = HERO_BULLET_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean; extraRings?: number } = {}) => bulletPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 200, y: 850 }, D = { x: 1500, y: 300 };
const R = 80;

describe('the tiers', () => {
  it('uses the shared thresholds; a knockout plays IV (the dome)', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).tier, `dmg ${d}`).toBe(tierOf(d));
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'dome' });
    expect([plan(3).kind, plan(8).kind, plan(14).kind, plan(40).kind]).toEqual(['dart', 'ring', 'spiral', 'dome']);
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; all four tier buttons on top', () => {
    for (const [k, [min, max]] of Object.entries(HERO_BULLET_RANGES)) {
      const v = C[k as HeroBulletNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroBulletTimeValue('t3Darts', 999)).toBe(48);
    expect(clampHeroBulletTimeValue('colorViolet', 'violet')).toBe(C.colorViolet);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroBulletTimeConfigJson(C)).previewParts).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions!.map((a) => a.label);
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)']) expect(labels).toContain(l);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('bullettime');
  });

  it('never uses the overused rune explosion or turn explosion sounds', () => {
    for (const [k, v] of Object.entries(C)) if (k.endsWith('Clip')) expect(String(v), k).not.toMatch(/turnexplosion|rune/i);
  });
});

describe('the plan: stopped time', () => {
  it('I: one dart stops (time stops), hangs, resumes and hits: the blow', () => {
    const p = plan(3);
    expect(p.darts).toHaveLength(1);
    const d = p.darts[0]!;
    expect(p.stopAt).toBe(d.hangAt);
    expect(d.resumeAt - d.hangAt).toBe(C.t1HangMs);
    expect(p.impactAt).toBe(d.hitAt);
    expect(p.hits).toEqual([]);
  });

  it('II: three blades come in evenly round the target (CENTRED on it), then all hit together (one blow)', () => {
    const p = plan(8);
    expect(p.darts).toHaveLength(3);
    expect(new Set(p.darts.map((d) => d.hitAt)).size).toBe(1);
    expect(p.hits).toEqual([]);
    const screen = { x: 0, y: 0, w: 1920, h: 1080 };
    const T = { x: 960, y: 500 };
    const g = dartGeos(p, A, T, R, R, C, screen);
    const ang = g.map((x) => Math.atan2(x.hang.y - T.y, x.hang.x - T.x));
    const sep = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    expect(sep(ang[0]!, ang[1]!)).toBeCloseTo((Math.PI * 2) / 3, 5);
    const cx = g.reduce((a, x) => a + x.hang.x, 0) / 3, cy = g.reduce((a, x) => a + x.hang.y, 0) / 3;
    expect(Math.hypot(cx - T.x, cy - T.y)).toBeLessThan(1); // the centre is the target
    for (const x of g) expect(x.aim).toBeCloseTo(Math.atan2(T.y - x.hang.y, T.x - x.hang.x), 6);
  });

  it('III: the volley brakes into slow motion at ONE instant, in a spiral round the target; after the snap it lands in a run (ticks, then the blow)', () => {
    const p = plan(14);
    expect(p.darts.length).toBe(C.t3Darts);
    expect(new Set(p.darts.map((d) => d.hangAt))).toEqual(new Set([p.stopAt]));
    expect(p.hits).toHaveLength(p.darts.length - 1);
    expect(p.impactAt).toBe(p.darts[p.darts.length - 1]!.hitAt);
    const g = dartGeos(p, A, D, R, R, C);
    const r = g.map((x) => Math.hypot(x.hang.x - D.x, x.hang.y - D.y));
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeGreaterThan(r[i - 1]!); // a spiral: each one further out
  });

  it('IV: slow motion from the moment the blades leave; dozens crawl in a dome CENTRED on the target; 3-2-1; the dome collapses at once', () => {
    const p = plan(40);
    expect(p.darts.length).toBe(C.domeRings * C.domeBlades);
    expect(p.darts.length).toBeGreaterThanOrEqual(24);
    expect(p.stopAt).toBe(p.fireAt);
    expect(p.counts).toHaveLength(3);
    expect(p.counts[2]! + C.countMs).toBe(p.resumeAt);
    for (const d of p.darts) { expect(d.hangAt).toBeLessThanOrEqual(p.resumeAt); expect(d.hitAt).toBe(p.impactAt); }
    expect(p.hits).toEqual([]);
    expect(bulletCues(p).filter((q) => q.kind === 'impact')).toHaveLength(1);
    // Centred: in the middle of the screen the dome's centre IS the target; tucked in a corner it shrinks to fit and
    // is clamped on screen, still wrapped round the target (never shifted off it toward the board).
    const screen = { x: 0, y: 0, w: 1920, h: 1080 };
    const mid = hangPoints(p, A, { x: 960, y: 540 }, R, C, screen);
    const cx = mid.reduce((a, q) => a + q.x, 0) / mid.length, cy = mid.reduce((a, q) => a + q.y, 0) / mid.length;
    expect(Math.hypot(cx - 960, cy - 540)).toBeLessThan(R * 0.05);
    const corner = { x: 1750, y: 140 };
    const pts = hangPoints(p, A, corner, R, C, screen);
    for (const q of pts) { expect(q.x).toBeLessThanOrEqual(1920); expect(q.y).toBeGreaterThanOrEqual(0); }
    const above = pts.filter((q) => q.y < corner.y).length, below = pts.filter((q) => q.y > corner.y).length;
    const left = pts.filter((q) => q.x < corner.x).length, right = pts.filter((q) => q.x > corner.x).length;
    expect(Math.min(above, below, left, right)).toBeGreaterThan(0); // it still surrounds the target on every side
  });

  it('the Knockout bolt-on point: an extra ring of blades on the dome, still one impact', () => {
    const ko = plan(40, { extraRings: 1 });
    expect(ko.darts.length).toBe((C.domeRings + 1) * C.domeBlades);
    expect(bulletCues(ko).filter((q) => q.kind === 'impact')).toHaveLength(1);
  });

  it('the slow motion: the clock ticks all through it, faster toward the snap', () => {
    for (const d of [3, 8, 14, 40]) {
      const p = plan(d);
      const ticks = stopTicks(p);
      expect(ticks.length, `dmg ${d}`).toBeGreaterThanOrEqual(2);
      for (const t of ticks) expect(inSlowMo(p, t)).toBe(true);
      for (let i = 2; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBeLessThanOrEqual(ticks[i - 1]! - ticks[i - 2]! + 1e-9);
      const gaps = [ticks[0]! - p.stopAt, ...ticks.slice(1).map((t, i) => t - ticks[i]!), p.resumeAt - ticks[ticks.length - 1]!];
      expect(Math.max(...gaps), `dmg ${d}`).toBeLessThanOrEqual(260);
    }
  });

  it('a blade BRAKES into slow motion and keeps crawling (never stops), aimed at the target, then strikes it', () => {
    const p = plan(3);
    const [g] = dartGeos(p, A, D, R, R, C);
    const d = p.darts[0]!;
    const speed = (t: number): number => { const a = dartAt(d, g!, t).p, b = dartAt(d, g!, t + 8).p; return Math.hypot(b.x - a.x, b.y - a.y) / 8; };
    const fast = speed(d.hangAt - 10), slow = speed((d.hangAt + d.resumeAt) / 2);
    expect(slow).toBeGreaterThan(0); // never stopped
    expect(slow).toBeLessThan(fast * 0.15); // dramatically slowed
    expect(dartAt(d, g!, (d.hangAt + d.resumeAt) / 2).phase).toBe('crawl');
    expect(Math.hypot(g!.crawl.x - D.x, g!.crawl.y - D.y)).toBeLessThan(Math.hypot(g!.hang.x - D.x, g!.hang.y - D.y)); // creeping in
    expect(g!.aim).toBeCloseTo(Math.atan2(D.y - g!.hang.y, D.x - g!.hang.x), 6);
    expect(Math.hypot(dartAt(d, g!, d.hitAt).p.x - D.x, dartAt(d, g!, d.hitAt).p.y - D.y)).toBeLessThan(R * 0.5);
  });

  it('pace: I and II under Bleed and Banana (1470 / 1740 ms after the formation); IV about 3 s', () => {
    const len = (d: number): number => { const p = plan(d); return p.endAt - p.chargeAt + bulletSlowExtraMs(p, C); };
    expect(len(3)).toBeLessThan(1470);
    expect(len(8)).toBeLessThan(1740);
    expect(len(14)).toBeLessThan(2100);
    expect(len(40)).toBeLessThanOrEqual(3200);
  });

  it('IV\'s collapse gets a slow-mo DIP that never freezes (R-PROG-ATTACK-10); no other tier dips', () => {
    const p = plan(40);
    for (let t = p.impactAt - 50; t < p.impactAt + C.slowMoMs + 50; t += 5) expect(bulletTimeScale(p, C, t)).toBeGreaterThan(0.09);
    for (const d of [3, 8, 14]) { const q = plan(d); expect(bulletTimeScale(q, C, q.impactAt + 10)).toBe(1); }
  });

  it('reduced motion: no flight; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.impactAt).toBe(leadInOf([40], true));
    expect(p.darts).toEqual([]);
  });
});

function manualFrames(): { frames: HeroBulletTimeOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBulletTimeOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroBulletTime({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 250 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('II: the blades crawl in slow motion (the FX slowed, nothing greyed), then hit once; everything is put back', () => {
    const board = document.createElement('div'); board.setAttribute('data-zone', 'warband');
    board.style.filter = 'blur(0px)';
    document.body.appendChild(board);
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 8, formation: formationOf([8], 8) });
    expect(host.querySelector('.hblast.hbullet')).not.toBeNull();
    f.tick((h.plan.stopAt + h.plan.resumeAt) / 2, 4);
    expect(h.scene!.crawlingDarts).toBe(3);
    expect(h.scene!.clockVisible).toBe(true);
    expect(h.scene!.timeScale).toBeCloseTo(C.slowFx, 5);
    expect(board.style.filter).toBe('blur(0px)'); // never greyed
    expect(defenderEl.style.filter).toBe('');
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.resumeAt - h.elapsed() + 8, 4);
    expect(h.scene!.timeScale).toBe(1); // a hard snap back to full speed
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
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

  it('IV: dozens of blades crawl in the dome through the 3-2-1, then the collapse is the one blow', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.counts[2]! + 20, 4);
    expect(h.scene!.crawlingDarts).toBe(h.plan.darts.length);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('both directions at every tier, within the cap; the camera applied once when the canvas rides it', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 250 };
        const d = side === 'player' ? { x: 1400, y: 250 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.endAt + 600; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_BULLET_SPRITES);
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
    expect(x.h.geos).toEqual(y.h.geos);
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap through the dome and its collapse, drains, and destroy leaves nothing', () => {
    const scene = new HeroBulletTimeScene(TEX, { gold: 0xd4a537, light: 0xffe9b0, violet: 0x8b5cf6, side: 0xffe9b0 },
      { dartPx: 170, trailMs: 24, trailWidth: 30, riftWidth: 9, impactSize: 1 }, 1, 3);
    const p = plan(40);
    const g = dartGeos(p, A, D, R, R, C);
    const samplers = p.darts.map((d, i) => (ms: number) => dartAt(d, g[i]!, ms).p);
    scene.stop(D, R, { x: 1000, y: 0, w: 900, h: 700 }, 18, true);
    for (let t = p.fireAt; t < p.resumeAt; t += 16) {
      p.darts.forEach((d, i) => { const s = dartAt(d, g[i]!, t); scene.setDart(i, samplers[i]!, t, s.phase, s.angle, 1, 0xd4a537); if (s.phase === 'crawl' && i % 3 === 0) scene.ghost(i); });
      if (t === p.fireAt) p.darts.forEach((d, i) => scene.cut(g[i]!.hand, g[i]!.hang, 400, 0.7));
      scene.setTimeScale(0.25);
      scene.setClock(D, R * 2.7, t * 0.01, 1);
      scene.update(16);
    }
    expect(scene.crawlingDarts).toBe(p.darts.length);
    scene.setTimeScale(1);
    scene.count(D, 1, R, 300);
    scene.snap(D, R, { x: 0, y: 0, w: 1920, h: 1080 }, 1.6);
    p.darts.forEach((d, i) => scene.setDart(i, samplers[i]!, d.hitAt + 1, 'done', 0, 1, 0xd4a537));
    scene.impact(D, { x: 1, y: 0 }, R, 4, { x: 0, y: 0, w: 1920, h: 1080 });
    scene.setClock(D, 0, 0, 0);
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_BULLET_SPRITES);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});

describe('the cosmetic', () => {
  it('Bullet Time (attack_bullet_time) is an ANCIENT crate hero attack that plays the bullettime style', () => {
    expect(COSMETIC_INDEX.attack_bullet_time).toMatchObject({ category: 'hero_attack', rarity: 'ancient', name: 'Bullet Time', assets: { style: 'bullettime' }, active: true });
    expect(HERO_ATTACK_STYLES).toContain('bullettime');
    expect(styleOfCosmetic('attack_bullet_time')).toBe('bullettime');
  });
});
