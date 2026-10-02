// @vitest-environment jsdom
/**
 * SOUL STITCH (the Ancient of Bonds' hero attack, an ANCIENT; owner 2026-10-02: "this ancient binds things together and
 * using soulbindings", the concept "Soul Stitch": stitching the target to you; III the owner's pick "Pinned", IV
 * "Bound Together"): the shared four tiers (I needle, II cross, III pinned, IV bound; a knockout plays IV); the tuner values; the pure plan (the piercings and punctures are
 * ticks before THE impact, which follows the tug); the pure geometry (the needles fly from the striker's rim, sew ON the
 * struck portrait, never above the ceiling); the thread drawn along the needle's own path and tied to both portraits;
 * the runner on the shared clock (the blow lands exactly ONCE; the pull leans the striker back and yanks the target in;
 * both directions; replay; finish / cancel; cleanup; the camera applied once); the headless scene (pooled, bounded,
 * thread meshes batchable, drains, destroy leaves nothing); the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, MeshSimple, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_STITCH_DEFAULTS, HERO_STITCH_RANGES, clampHeroStitchValue, flightPoint, heroStitchConfigJson, needleAt, sanitizeHeroStitchConfig,
  KNOT_PULSES, dragAt, knotAt, slowMoExtraMs, stitchCameraAt, stitchTimeScale, stretchAt, stitchCues, stitchGeo, stitchKind, stitchPlan, tugAt, type HeroStitchConfig, type HeroStitchNumKey,
} from './heroStitchConfig';
import { HeroStitchScene, KNOT_LOOPS, MAX_STITCH_SPRITES, SNAP_MS, THREAD_PTS, type HeroStitchTextures } from './heroStitchScene';
import { foePull, playHeroStitch, type HeroStitchOptions } from './heroStitch';
import { SPEC } from '../HeroStitchTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroStitchTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W, needle: W, thread: W, shard: W,
};
const C = HERO_STITCH_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => stitchPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const COLORS = { thread: 0xa855f7, lilac: 0xe9d5ff, deep: 0x2e1065, gold: 0xd4a537, bone: 0xefe6d2, side: 0xf0c75e };
const LOOK = {
  needleSize: C.needleSize, needleGlow: C.needleGlow, threadWidth: C.threadWidth, threadGlow: C.threadGlow, sag: C.sag, tautMs: C.tautMs,
  twangPx: C.twangPx, knotSize: C.knotSize, ripRibbons: C.ripRibbons, rainShards: C.rainShards,
};

describe('the tiers', () => {
  it('uses the shared thresholds: I needle, II cross, III pinned, IV bound', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const p = plan(d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.kind, `dmg ${d}`).toBe(stitchKind(tierOf(d)));
    }
    expect([1, 2, 3, 4].map((t) => stitchKind(t as 1 | 2 | 3 | 4))).toEqual(['needle', 'cross', 'pinned', 'bound']);
  });

  it('a knockout always plays IV, bound together (the Huge version), whatever the number', () => {
    const p = plan(3, { knockout: true });
    expect(p.tier).toBe(4);
    expect(p.kind).toBe('bound');
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_STITCH_RANGES)) {
      const v = C[k as HeroStitchNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorThread', 'colorLilac', 'colorDeep', 'colorGold', 'colorBone', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('ships the Ancient of Bonds palette', () => {
    expect(C.colorThread).toBe('#a855f7');
    expect(C.colorLilac).toBe('#e9d5ff');
    expect(C.colorDeep).toBe('#2e1065');
    expect(C.colorGold).toBe('#d4a537');
    expect(C.colorBone).toBe('#efe6d2');
  });

  it('clamps numbers into range; junk falls back; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroStitchValue('t4Needles', 99)).toBe(8);
    expect(clampHeroStitchValue('crush', 0)).toBe(0.3);
    expect(clampHeroStitchValue('threadWidth', -3)).toBe(0.5);
    expect(clampHeroStitchValue('threadWidth', 'abc')).toBe(C.threadWidth);
    expect(clampHeroStitchValue('colorThread', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroStitchValue('colorThread', 'violet')).toBe(C.colorThread);
    expect(clampHeroStitchValue('nope' as keyof HeroStitchConfig, 1)).toBeUndefined();
    const s = sanitizeHeroStitchConfig({ t3Passes: 400, bogus: 1 });
    expect(s.t3Passes).toBe(24); // the range is shared (IV uses Passes)
    expect('bogus' in s).toBe(false);
  });

  it('every config key has a control; Copy JSON drops the preview keys; the four tier buttons sit on top; the style row offers stitch', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroStitchConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.t4Needles).toBe(6);
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = (SPEC.actions ?? []).map((a) => a.label);
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe huge (40)']) expect(labels).toContain(l);
    expect(labels.filter((l) => /speed|reduced/i.test(l))).toEqual([]);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('stitch');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('stitch');
  });
});

describe('the plan', () => {
  it('I NEEDLE: one needle; its piercing is a tick; it hangs, the tug follows, then THE impact', () => {
    const p = plan(3);
    expect(p.kind).toBe('needle');
    expect(p.needles).toHaveLength(1);
    expect(p.hits).toEqual([p.needles[0]!.arriveAt]);
    expect(p.tugAt).toBeGreaterThan(p.needles[0]!.arriveAt);
    expect(p.impactAt).toBeGreaterThan(p.tugAt);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(2000);
    const kinds = stitchCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.indexOf('pierce')).toBeLessThan(kinds.indexOf('tug'));
    expect(kinds.indexOf('tug')).toBeLessThan(kinds.indexOf('impact'));
  });

  it('II CROSS: three needles, two sew the diagonals and the third only pins; every piercing a tick before the yank', () => {
    const p = plan(8);
    expect(p.kind).toBe('cross');
    expect(p.needles).toHaveLength(3);
    expect(p.needles[0]!.sewEnd).toBeGreaterThan(p.needles[0]!.arriveAt);
    expect(p.needles[1]!.sewEnd).toBeGreaterThan(p.needles[1]!.arriveAt);
    expect(p.needles[2]!.sewEnd).toBe(p.needles[2]!.arriveAt);
    expect(p.hits).toHaveLength(3);
    for (const h of p.hits) expect(h).toBeLessThan(p.tugAt);
    expect(p.tugAt).toBeGreaterThanOrEqual(Math.max(...p.needles.map((q) => q.sewEnd)));
  });

  it('III PINNED: five pins (ticks, one after another), the pull (the stretch), THE impact as they rip out', () => {
    const p = plan(14);
    expect(p.kind).toBe('pinned');
    expect(p.needles).toHaveLength(5);
    expect(p.hits).toHaveLength(5);
    for (let i = 1; i < p.hits.length; i++) expect(p.hits[i]!).toBeGreaterThan(p.hits[i - 1]!);
    for (const q of p.needles) expect(q.sewEnd).toBe(q.arriveAt); // pins do not sew
    for (const h of p.hits) expect(h).toBeLessThan(p.tugAt);
    expect(p.impactAt).toBeGreaterThan(p.tugAt);
    const kinds = stitchCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'pierce')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.lastIndexOf('pierce')).toBeLessThan(kinds.indexOf('tug'));
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(3200);
  });

  it('III: the stretch builds through the pull, snaps back through a squash, and is EXACTLY zero at rest', () => {
    const p = plan(14);
    expect(stretchAt(p, C, p.tugAt - 1)).toBe(0);
    const mid = stretchAt(p, C, (p.tugAt + p.impactAt) / 2), full = stretchAt(p, C, p.impactAt - 1);
    expect(mid).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(mid);
    expect(full).toBeLessThanOrEqual(C.stretch + 1e-9);
    let min = 0;
    for (let t = p.impactAt; t < p.endAt; t += 4) min = Math.min(min, stretchAt(p, C, t));
    expect(min).toBeLessThan(0); // the squash on the way back
    expect(stretchAt(p, C, p.endAt)).toBe(0);
    for (const d of [3, 8, 40]) { const q = plan(d); for (let t = q.chargeAt; t < q.endAt; t += 20) expect(stretchAt(q, C, t)).toBe(0); }
  });

  it('IV BOUND: six laces, the yank (the drag), into the knot, tied, the strike, THE burst, flung home; within the Huge budget', () => {
    const p = plan(40);
    expect(p.kind).toBe('bound');
    expect(p.needles).toHaveLength(6);
    expect(p.hits).toHaveLength(6);
    expect(p.tugAt).toBeGreaterThan(Math.max(...p.needles.map((q) => q.sewEnd)));
    expect(p.knotAt!).toBeGreaterThan(p.tugAt);
    expect(p.strikeAt!).toBeGreaterThan(p.knotAt!);
    expect(p.impactAt).toBeGreaterThan(p.strikeAt!);
    expect(p.homeAt!).toBeGreaterThan(p.impactAt);
    expect(p.endAt).toBeGreaterThanOrEqual(p.homeAt!); // home before the attack ends
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(4500);
    const kinds = stitchCues(p).map((q) => q.kind);
    for (const k of ['tug', 'knot', 'tied', 'strike', 'impact', 'home'] as const) expect(kinds.filter((x) => x === k), k).toHaveLength(1);
    expect(kinds.filter((x) => x === 'cinch')).toHaveLength(KNOT_PULSES);
    expect(kinds.indexOf('knot')).toBeLessThan(kinds.indexOf('strike'));
    expect(kinds.indexOf('strike')).toBeLessThan(kinds.indexOf('impact'));
    expect(kinds.lastIndexOf('pierce')).toBeLessThan(kinds.indexOf('tug'));
  });

  it('IV: the drag goes out to the knot, holds through the tie and strike, and is EXACTLY zero from home (and before the yank)', () => {
    const p = plan(40);
    expect(dragAt(p, p.tugAt - 1)).toBe(0);
    expect(dragAt(p, p.knotAt!)).toBe(1);
    expect(dragAt(p, (p.knotAt! + p.impactAt) / 2)).toBe(1);
    expect(dragAt(p, p.impactAt - 1)).toBe(1);
    expect(Math.abs(dragAt(p, p.homeAt! - 1))).toBeLessThan(0.02);
    expect(dragAt(p, p.homeAt!)).toBe(0);
    expect(dragAt(p, p.endAt)).toBe(0);
    // it really goes most of the way, and never far past the knot
    let peak = 0;
    for (let t = p.tugAt; t < p.homeAt!; t += 5) peak = Math.max(peak, dragAt(p, t));
    expect(peak).toBeGreaterThanOrEqual(1);
    expect(peak).toBeLessThan(1.25);
    expect(knotAt(p, p.knotAt! - 1)).toBe(0);
    expect(knotAt(p, p.strikeAt!)).toBe(1);
    expect(knotAt(p, p.impactAt)).toBe(0);
    // every other tier never drags
    for (const d of [3, 8, 14]) { const q = plan(d); for (let t = q.chargeAt; t < q.endAt; t += 20) expect(dragAt(q, t)).toBe(0); }
  });

  it('IV: the burst gets a slow-mo dip, never a freeze (R-PROG-ATTACK-10), and only IV does', () => {
    const p = plan(40);
    expect(stitchTimeScale(p, C, p.impactAt - 1)).toBe(1);
    expect(stitchTimeScale(p, C, p.impactAt)).toBeCloseTo(C.slowMo, 5);
    let min = 1;
    for (let t = p.impactAt - 50; t < p.endAt; t += 2) { const k = stitchTimeScale(p, C, t); expect(k).toBeGreaterThan(0); min = Math.min(min, k); }
    expect(min).toBeLessThan(0.5);
    expect(stitchTimeScale(p, C, p.impactAt + C.slowMoMs)).toBe(1);
    expect(slowMoExtraMs(p, C)).toBeGreaterThan(0);
    for (const d of [3, 8, 14]) { const q = plan(d); expect(slowMoExtraMs(q, C)).toBe(0); expect(stitchTimeScale(q, C, q.impactAt)).toBe(1); }
  });

  it('escalates: each tier lands later than the one below', () => {
    const ats = [3, 8, 14, 40].map((d) => { const p = plan(d); return p.impactAt - p.chargeAt; });
    for (let i = 1; i < ats.length; i++) expect(ats[i]!).toBeGreaterThan(ats[i - 1]!);
  });

  it('reduced motion: no needles; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(p.needles).toEqual([]);
    expect(p.impactAt).toBe(leadInOf([40], true));
    expect(stitchGeo(p, A, D, R, R, C).needles).toEqual([]);
  });

  it('is deterministic', () => {
    expect(plan(40)).toEqual(plan(40));
    expect(stitchGeo(plan(40), A, D, R, R, C)).toEqual(stitchGeo(plan(40), A, D, R, R, C));
  });

  it('the tug envelope rises to the impact and is gone after (I-II); IV holds it through the knot', () => {
    const p = plan(3);
    expect(tugAt(p, p.tugAt - 1)).toBe(0);
    expect(tugAt(p, (p.tugAt + p.impactAt) / 2)).toBeGreaterThan(0.3);
    expect(tugAt(p, p.impactAt - 1)).toBeGreaterThan(0.95);
    expect(tugAt(p, p.impactAt + 1)).toBe(0);
    expect(foePull(p, C, p.impactAt - 1).yank).toBeGreaterThan(C.foeYankPx * 0.9);
    const q = plan(40);
    expect(tugAt(q, q.knotAt! + 10)).toBe(1);
    expect(tugAt(q, q.impactAt + 1)).toBe(0);
    expect(foePull(q, C, q.knotAt!).yank).toBe(0); // IV moves the target by the drag, not the yank
  });
});

describe('the geometry', () => {
  for (const total of [3, 8, 14, 40]) {
    it(`tier ${tierOf(total)}: summoned on the striker's rim, sewn on the struck portrait, flights under the ceiling`, () => {
      const p = plan(total);
      const g = stitchGeo(p, A, D, R, R, C, 20);
      expect(g.needles).toHaveLength(p.needles.length);
      for (const n of g.needles) {
        expect(Math.hypot(n.spot.x - A.x, n.spot.y - A.y)).toBeLessThanOrEqual(R * 1.1);
        // sewn into the target
        const onFoe = n.sew.filter((_, j) => n.sewAt[j] === 1);
        for (const pt of onFoe) expect(Math.hypot(pt.x - D.x, pt.y - D.y)).toBeLessThanOrEqual(R);
        for (let e = 0; e <= 1; e += 0.05) expect(flightPoint(g, g.needles.indexOf(n), e).y).toBeGreaterThanOrEqual(20 - 1);
      }
      // each needle is where its plan says: on its spot through the ready, at its entry when it pierces
      p.needles.forEach((q, i) => {
        const a0 = needleAt(p, g, i, q.launchAt - 1);
        expect(Math.hypot(a0.x - g.needles[i]!.spot.x, a0.y - g.needles[i]!.spot.y)).toBeLessThan(0.5);
        const at = needleAt(p, g, i, q.arriveAt);
        expect(Math.hypot(at.x - g.needles[i]!.entry.x, at.y - g.needles[i]!.entry.y)).toBeLessThan(1);
        expect(needleAt(p, g, i, p.impactAt).visible).toBe(false); // shattered
      });
    });
  }

  it('II: the two stitches cross (an X) and the pin is at the crossing', () => {
    const g = stitchGeo(plan(8), A, D, R, R, C);
    const [s1, s2, pin] = g.needles;
    const v1 = { x: s1!.sew[1]!.x - s1!.sew[0]!.x, y: s1!.sew[1]!.y - s1!.sew[0]!.y };
    const v2 = { x: s2!.sew[1]!.x - s2!.sew[0]!.x, y: s2!.sew[1]!.y - s2!.sew[0]!.y };
    expect(Math.abs(v1.x * v2.x + v1.y * v2.y)).toBeLessThan(1); // perpendicular diagonals
    expect(pin!.entry).toEqual(D);
  });

  it('III: the five pins sit on the rim at the points of a star, stabbed in star order', () => {
    const p = plan(14);
    const g = stitchGeo(p, A, D, R, R, C);
    const angs = g.needles.map((n) => Math.atan2(n.entry.y - D.y, n.entry.x - D.x));
    for (const n of g.needles) expect(Math.hypot(n.entry.x - D.x, n.entry.y - D.y)).toBeCloseTo(R * C.pinRim, 5);
    const step = (2 * Math.PI) / 5;
    const norm = (a: number): number => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    // consecutive pins are two star points apart (as a star is drawn), the first at the top
    expect(angs[0]).toBeCloseTo(-Math.PI / 2, 5);
    for (let i = 1; i < angs.length; i++) expect(norm(angs[i]! - angs[i - 1]!)).toBeCloseTo(2 * step, 5);
  });

  it('IV: every lace runs target -> striker -> target, and the drag is halfway across the gap', () => {
    const p = plan(40);
    const g = stitchGeo(p, A, D, R, R, C);
    for (const n of g.needles) {
      expect(n.sewAt).toEqual([1, 0, 1]);
      expect(Math.hypot(n.sew[0]!.x - D.x, n.sew[0]!.y - D.y)).toBeLessThanOrEqual(R);
      expect(Math.hypot(n.sew[1]!.x - A.x, n.sew[1]!.y - A.y)).toBeLessThanOrEqual(R);
    }
    const gap = Math.hypot(D.x - A.x, D.y - A.y) - 2 * R;
    expect(g.drag).toBeCloseTo(gap * C.dragReach, 5);
    expect(stitchGeo(plan(14), A, D, R, R, C).drag).toBe(0);
  });

  it('the camera pushes in through the ready, jerks on the tug and settles after the impact', () => {
    const p = plan(40);
    expect(stitchCameraAt(p, C, p.chargeAt - 10).zoom).toBe(1);
    expect(stitchCameraAt(p, C, p.launchAt).zoom).toBeGreaterThan(1);
    expect(stitchCameraAt(p, C, p.impactAt - 5).zoom).toBeGreaterThan(stitchCameraAt(p, C, p.tugAt).zoom);
    expect(stitchCameraAt(p, C, p.impactAt + 3000).zoom).toBeCloseTo(1, 3);
  });
});

function manualFrames(): { frames: HeroStitchOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroStitchOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroStitch({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

const translateOf = (el: HTMLElement): { x: number; y: number } => {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
};

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  for (const total of [3, 8, 14, 40]) {
    it(`tier ${tierOf(total)}: the blow lands EXACTLY ONCE, on the impact, never on a piercing; everything is put back`, () => {
      const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total, formation: formationOf([total], total) });
      expect(host.querySelector('.hblast.hstitch')).not.toBeNull();
      const lastTick = Math.max(...h.plan.hits);
      f.tick(lastTick + 8, 4);
      expect(onImpact).not.toHaveBeenCalled();
      f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
      expect(onImpact).not.toHaveBeenCalled();
      f.tick(24, 4);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(camera.style.transform).toContain('scale(');
      expect(host.querySelector('.hblast-hit')!.textContent).toBe(`-${total}`);
      f.tick(h.plan.endAt - h.elapsed() + 32 + slowMoExtraMs(h.plan, C), 8); // IV's slow-mo dip takes extra real time
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(host.querySelector('.hblast')).toBeNull();
      expect(camera.style.transform).toBe('');
      expect(attackerEl.style.transform).toBe('');
      expect(defenderEl.style.transform).toBe('');
      f.tick(4000, 16);
      expect(f.hooked()).toBe(0);
      expect(root.children).toHaveLength(0);
    });
  }

  it('THE PULL: on the tug the striker leans BACK and the target is yanked TOWARD it; the thread stays tied to both', () => {
    const a = { x: 100, y: 800 }, d = { x: 1400, y: 150 };
    const { h, f, attackerEl, defenderEl } = run({ total: 3, formation: formationOf([3], 3), attacker: a, defender: d });
    const u = h.geo.u;
    f.tick(h.plan.impactAt - 8, 4);
    const ht = translateOf(attackerEl), ft = translateOf(defenderEl);
    expect(ht.x * u.x + ht.y * u.y).toBeLessThan(-5); // the striker leaned back, away from the target
    expect(ft.x * u.x + ft.y * u.y).toBeLessThan(-5); // the target came toward the striker
    // the thread runs from the striker's rim (riding its lean) to the needle in the face (riding the yank)
    const ends = h.scene!.threadEnds(0)!;
    const spot = h.geo.needles[0]!.spot, entry = h.geo.needles[0]!.entry;
    expect(Math.hypot(ends.a.x - (spot.x + ht.x), ends.a.y - (spot.y + ht.y))).toBeLessThan(1);
    expect(Math.hypot(ends.b.x - (entry.x + ft.x), ends.b.y - (entry.y + ft.y))).toBeLessThan(1);
    h.cancel();
  });

  it('the thread is drawn along the needle\'s own path while it flies (its end is the needle\'s tip)', () => {
    const { h, f } = run({ total: 3, formation: formationOf([3], 3) });
    const q = h.plan.needles[0]!;
    f.tick((q.launchAt + q.arriveAt) / 2, 4);
    const tip = h.scene!.needleTip(0)!;
    const ends = h.scene!.threadEnds(0)!;
    expect(Math.hypot(ends.b.x - tip.x, ends.b.y - tip.y)).toBeLessThan(2);
    expect(Math.hypot(ends.a.x - h.geo.needles[0]!.spot.x, ends.a.y - h.geo.needles[0]!.spot.y)).toBeLessThan(2);
    // longer than the straight chord: it bows along the arc
    const chord = Math.hypot(tip.x - ends.a.x, tip.y - ends.a.y);
    expect(h.scene!.threadLength(0)).toBeGreaterThan(chord);
    h.cancel();
  });

  it('III: the target STRETCHES toward the striker against the pins (which stay on it), then snaps back and comes home EXACTLY', () => {
    const { h, f, defenderEl } = run({ total: 14, formation: formationOf([14], 14), camera: null });
    f.tick(h.plan.impactAt - 4, 2);
    expect(defenderEl.style.transform).toContain('matrix(');
    const m = /matrix\(([^)]+)\)/.exec(defenderEl.style.transform)![1]!.split(',').map(Number);
    // stretched along the line to the striker: |M u| > 1
    const u = h.geo.u;
    const mu = { x: m[0]! * u.x + m[2]! * u.y, y: m[1]! * u.x + m[3]! * u.y };
    expect(Math.hypot(mu.x, mu.y)).toBeGreaterThan(1 + C.stretch * 0.8);
    // every pin is drawn where the stretched portrait carries it
    for (let i = 0; i < h.plan.needles.length; i++) {
      const tip = h.scene!.needleTip(i)!;
      const want = h.scene!.foePoint(h.geo.needles[i]!.entry.x, h.geo.needles[i]!.entry.y);
      expect(Math.hypot(tip.x - want.x, tip.y - want.y)).toBeLessThan(1);
    }
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(defenderEl.style.transform).toBe('');
  });

  it('III: every exit (cancel, finish, the end) puts the stretched portrait back exactly', () => {
    for (const exit of ['cancel', 'finish', 'end'] as const) {
      const { h, f, defenderEl } = run({ total: 14, formation: formationOf([14], 14), camera: null });
      defenderEl.style.transform = 'translate(3px, 4px)';
      f.tick((h.plan.tugAt + h.plan.impactAt) / 2, 4);
      expect(defenderEl.style.transform).not.toBe('translate(3px, 4px)');
      if (exit === 'cancel') h.cancel();
      else if (exit === 'finish') h.finish();
      else f.tick(h.plan.endAt + 100, 8);
      expect(defenderEl.style.transform, exit).toBe('');
    }
  });

  it('IV: the target is DRAGGED halfway across into the knot (crushed), the laces stay tied to it, and it is flung home EXACTLY', () => {
    const a = { x: 100, y: 800 }, d = { x: 1400, y: 150 };
    const { h, f, defenderEl, attackerEl } = run({ total: 40, formation: formationOf([40], 40), attacker: a, defender: d, camera: null });
    const u = h.geo.u;
    expect(h.geo.drag).toBeGreaterThan(300);
    f.tick(h.plan.strikeAt! - 2, 2);
    const ft = translateOf(defenderEl);
    const along = ft.x * u.x + ft.y * u.y;
    expect(along).toBeLessThan(-h.geo.drag + 12);
    expect(along).toBeGreaterThan(-h.geo.drag - 12);
    expect(defenderEl.style.transform).toContain(`matrix(${C.crush.toFixed(2)}`);
    expect(h.scene!.visibleKnotLoops).toBe(KNOT_LOOPS);
    // the lace's far end rides the dragged (and crushed) portrait
    const ends = h.scene!.threadEnds(0)!;
    const tip = h.geo.needles[0]!.sew[h.geo.needles[0]!.sew.length - 1]!;
    const want = h.scene!.foePoint(tip.x, tip.y);
    expect(Math.hypot(ends.b.x - want.x, ends.b.y - want.y)).toBeLessThan(1.5);
    expect(Math.hypot(want.x - (tip.x + ft.x), want.y - (tip.y + ft.y))).toBeGreaterThan(5); // pulled in by the crush
    f.tick(h.plan.homeAt! - h.elapsed() + 4 + slowMoExtraMs(h.plan, C), 4);
    expect(Math.abs(h.foeDrag(h.elapsed()).x)).toBe(0);
    f.tick(h.plan.endAt - h.elapsed() + 32 + slowMoExtraMs(h.plan, C), 8);
    expect(h.done).toBe(true);
    expect(defenderEl.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
  });

  it('IV: the dragged portrait is raised over the other one while it moves; EVERY exit puts the portrait and the z-order back', () => {
    for (const exit of ['cancel', 'finish', 'end'] as const) {
      for (const side of ['player', 'opp'] as const) {
        const cls = side === 'opp' ? 'duel-attacker-player' : 'duel-attacker-opp';
        const { h, f, defenderEl } = run({ side, total: 40, formation: formationOf([40], 40), camera: null });
        defenderEl.style.transform = 'translate(3px, 4px)'; // a resting transform of its own
        f.tick((h.plan.tugAt + h.plan.knotAt!) / 2, 4);
        expect(document.body.classList.contains(cls), `${exit} ${side}`).toBe(true);
        expect(defenderEl.style.transform).not.toBe('translate(3px, 4px)');
        if (exit === 'cancel') h.cancel();
        else if (exit === 'finish') h.finish();
        else f.tick(h.plan.endAt + 100 + slowMoExtraMs(h.plan, C), 8);
        expect(document.body.classList.contains(cls), `${exit} ${side}`).toBe(false);
        expect(defenderEl.style.transform, `${exit} ${side}`).toBe('');
      }
    }
  });

  it('IV: a z-order class that was already on is left alone', () => {
    document.body.classList.add('duel-attacker-opp');
    const { h, f } = run({ side: 'player', total: 40, formation: formationOf([40], 40), camera: null });
    f.tick(h.plan.knotAt!, 8);
    h.cancel();
    expect(document.body.classList.contains('duel-attacker-opp')).toBe(true);
    document.body.classList.remove('duel-attacker-opp');
  });

  it('the snap: every thread is gone within SNAP_MS of the impact', () => {
    const { h, f } = run({ total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.impactAt - 4, 4);
    expect(h.scene!.visibleStrands).toBeGreaterThanOrEqual(h.plan.needles.length);
    f.tick(SNAP_MS + 40 + slowMoExtraMs(h.plan, C), 4);
    expect(h.scene!.visibleStrands).toBe(0);
    expect(h.scene!.liveRibbons).toBeGreaterThan(0); // IV's rip
    h.cancel();
  });

  it('works in both directions at every tier, within the sprite cap', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 600; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_STITCH_SPRITES);
        for (const n of h.geo.needles) n.sew.forEach((pt, j) => { if (n.sewAt[j] === 1) expect(Math.hypot(pt.x - d.x, pt.y - d.y)).toBeLessThanOrEqual(R); });
        h.cancel();
      }
    }
  });

  it('the camera is applied ONCE: the Pixi root stays at rest when the canvas already rides the camera element', () => {
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const { h, f, root } = run({ camera, total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.impactAt + 20, 4);
    expect(h.mirrorsCamera).toBe(false);
    expect(camera.style.transform).toContain('scale(');
    const layer = root.children[0] as Container;
    expect(layer.scale.x).toBe(1);
    expect(layer.position.x).toBe(0);
    h.cancel();
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.launchAt + 20, 4);
    expect(b.h.mirrorsCamera).toBe(true);
    b.h.cancel();
  });

  it('finish() lands once; cancel() never lands; a replay plays the same', () => {
    const a = run();
    a.f.tick(200, 16);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
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
    expect(x.h.geo).toEqual(y.h.geo);
    x.f.tick(x.h.plan.impactAt + 60, 8); y.f.tick(y.h.plan.impactAt + 60, 8);
    expect(x.h.scene!.liveSprites).toBe(y.h.scene!.liveSprites);
    x.h.cancel(); y.h.cancel();
  });

  it('reduced motion: no scene, no camera; the blow still lands once', () => {
    const { h, f, onImpact, camera } = run({ reduced: true });
    expect(h.scene).toBeNull();
    f.tick(h.plan.endAt + 100, 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
  });
});

describe('the scene (headless Pixi)', () => {
  it('thread meshes stay batchable (under 100 vertices), the pool stays under the cap, drains, and destroy leaves nothing', () => {
    const p = plan(40);
    const g = stitchGeo(p, A, D, R, R, C);
    const scene = new HeroStitchScene(TEX, COLORS, LOOK, p, g, { x: D.x, y: D.y, r: R }, 1, 7);
    expect(THREAD_PTS * 2).toBeLessThanOrEqual(100);
    const meshes: MeshSimple[] = [];
    scene.root.children.forEach((ch) => ch.children.forEach((m) => { if (m instanceof MeshSimple) meshes.push(m); }));
    for (const m of meshes) expect((m.vertices as Float32Array).length / 2).toBeLessThanOrEqual(100);
    expect(scene.threadMeshes).toBe((p.needles.length + KNOT_LOOPS) * 4);
    const frame = { heroX: 0, heroY: 0, foeX: 0, foeY: 0 };
    for (let t = p.chargeAt; t < p.impactAt; t += 16) { scene.draw(t, frame); scene.update(16); }
    scene.impact(D, R, g.u, { shards: 60, burst: 2, t: p.impactAt, foe: { x: 0, y: 0 }, hero: { x: 0, y: 0 } });
    for (let t = p.impactAt; t < p.impactAt + SNAP_MS + 32; t += 16) { scene.draw(t, frame); scene.update(16); }
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_STITCH_SPRITES);
    scene.hideOwn();
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    expect(scene.liveRibbons).toBe(0);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});

describe('the cosmetic', () => {
  it('Soul Stitch (attack_soul_stitch) is an ANCIENT crate hero attack that plays the stitch; the dev override can force it', () => {
    expect(COSMETIC_INDEX.attack_soul_stitch).toMatchObject({ category: 'hero_attack', rarity: 'ancient', name: 'Soul Stitch', assets: { style: 'stitch' }, acquisition: { type: 'crate' }, active: true });
    expect(HERO_ATTACK_STYLES).toContain('stitch');
    expect(styleOfCosmetic('attack_soul_stitch')).toBe('stitch');
    expect(resolveHeroAttackStyle({ attacker: 'player', attackerCosmeticId: 'attack_soul_stitch', devChoice: 'auto' })).toBe('stitch');
    expect(resolveHeroAttackStyle({ attacker: 'opp', attackerCosmeticId: null, devChoice: 'stitch' })).toBe('stitch');
  });
});
