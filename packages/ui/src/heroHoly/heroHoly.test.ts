// @vitest-environment jsdom
/**
 * THE HOLY HERO ATTACK, Consecration (owner 2026-09-28: "branch off and create a holy weapon + consecration attack";
 * reworked 2026-09-29: "i want this to be flat and not faux-3d. also, let's take this animation to the extreme - have 6
 * swords fly in from different directions starting with 1, then they ramp up in speed and the center implodes into that
 * blest towards the enemy"): the tier mapping SHARED with every attack; the ladder (one smite / a double smite / a spear
 * rain then the smite / the six-sword barrage and the blast); the tuner defaults + clamping; the pure plan (the tick
 * contract, the barrage RAMP, the IV beats in order, reduced motion, determinism); the pure geometry (the spears, the
 * swords from round the compass converging on the centre, the path, the runes, the cracks); the camera; the runner on
 * the shared clock (the consequence lands exactly ONCE; both directions; slow motion; replay; finish / cancel; cleanup;
 * the safety timer); the headless scene (pooled, bounded, drains, destroy leaves nothing; FLAT: no skew, no squash);
 * and the cosmetic resolution.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_ARCANA_DEFAULTS, arcanaPlan } from '../heroArcana/heroArcanaConfig';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_HOLY_DEFAULTS, HERO_HOLY_RANGES, HOLY_CAPS, clampHeroHolyValue, footOf, heroHolyConfigJson, holyCameraAt, holyCameraFocus, holyCues,
  holyGeo, holyPlan, holySpreadMs, sanitizeHeroHolyConfig, swordHeadings, type HeroHolyConfig, type HeroHolyNumKey,
} from './heroHolyConfig';
import { HeroHolyScene, MAX_HOLY_SPRITES, flatTransform, type HeroHolyTextures } from './heroHolyScene';
import { holySeed, playHeroHoly, type HeroHolyOptions } from './heroHoly';
import { SPEC } from '../HeroHolyTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroHolyTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  swordGlow: W, swordBody: W, swordHot: W, hsigil: W, rays: W, pillar: W, flame: W, spear: W, crack: W, puff: W, chip: W,
  glyphs: [W, W, W], waveBody: W, waveEdge: W,
};
const C = HERO_HOLY_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => holyPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xfffaf0, gold: 0xf0c55a, deep: 0xd4a53a, sky: 0xe4efff, side: 0xf0c55a, dust: 0xece2cc };
const LOOK = {
  haloSize: 1, sunburst: 1, prayBeam: 1, sigilSize: 1, sigilSpin: 1, pillarGlow: 1, pillarHeight: 1, raysSize: 1, spearSize: 1,
  seedGlow: 1, swordGlow: 1, pathWidth: 1, flameHeight: 1,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the damage tiers (shared with every attack)', () => {
  it('Holy steps up on exactly the blows every other attack does: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(arcanaPlan({ total: d, distance: 1600 }, HERO_ARCANA_DEFAULTS).tier);
    }
  });

  it('the ladder: I ONE smite, II a DOUBLE smite, III a RAIN of six spears then the smite, IV SIX SWORDS and the flat blast', () => {
    expect([P1, P2, P3, P4].map((p) => p.smites.length)).toEqual([1, 2, 1, 0]);
    expect([P1, P2, P3, P4].map((p) => p.spears.length)).toEqual([0, 0, 6, 0]);
    expect([P1, P2, P3, P4].map((p) => p.sword)).toEqual([false, false, false, true]);
    expect([P1, P2, P3, P4].map((p) => p.swords.length)).toEqual([0, 0, 0, 6]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.sword ? 'sword' : `${p.smites.length}/${p.spears.length}`; }))
      .toEqual(['1/0', '1/0', '2/0', '2/0', '1/6', '1/6', 'sword', 'sword']);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb; the palette is gold and white (owner: "less yellow and more gold + white")', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_HOLY_RANGES)) {
      const v = C[k as HeroHolyNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorGold', 'colorDeep', 'colorSky', 'colorPlayer', 'colorFoe', 'colorDust'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
    expect([C.colorGold, C.colorDeep, C.colorCore]).toEqual(['#f0c55a', '#d4a53a', '#fffaf0']);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroHolyValue('t3Spears', 99)).toBe(10);
    expect(clampHeroHolyValue('t1Smites', -2)).toBe(0);
    expect(clampHeroHolyValue('swordFlightMs', 99999)).toBe(1200);
    expect(clampHeroHolyValue('swordCount', 99)).toBe(8);
    expect(clampHeroHolyValue('swordSize', Number.NaN)).toBe(C.swordSize);
    expect(clampHeroHolyValue('spreadMs', 'abc')).toBe(C.spreadMs);
    expect(clampHeroHolyValue('spreadMs', '400')).toBe(400);
    expect(clampHeroHolyValue('colorGold', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroHolyValue('colorGold', 'gold')).toBe(C.colorGold);
    expect(clampHeroHolyValue('sfxSlamClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroHolyValue('nope' as keyof HeroHolyConfig, 1)).toBeUndefined();
    expect(clampHeroHolyValue('toString' as keyof HeroHolyConfig, 1)).toBeUndefined();
    const s = sanitizeHeroHolyConfig({ t4Motes: 400, colorCore: 'x', bogus: 3 });
    expect(s.t4Motes).toBe(90);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroHolyConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Consecration', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroHolyConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Sword).toBe(1);
    expect(json.t3Spears).toBe(6);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('holy');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('holy');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe huge (40)']) {
      expect(labels).toContain(l);
    }
  });
});

describe('the plan', () => {
  it('THE TICK CONTRACT: II\'s first smite is a tick, the second the impact; III\'s six spears are ticks in rhythm, the smite after them the impact', () => {
    expect(P2.hits).toEqual([P2.smites[0]!.hitAt]);
    expect(P2.impactAt).toBe(P2.smites[1]!.hitAt);
    expect(P2.smites[1]!.size).toBeGreaterThan(P2.smites[0]!.size);
    const arr = P3.spears.map((s) => s.hitAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]! - arr[i - 1]!, `spear ${i}`).toBe(C.t3SpearGapMs);
    expect(P3.hits).toEqual(arr);
    expect(P3.impactAt).toBe(P3.smites[0]!.hitAt);
    expect(P3.impactAt).toBeGreaterThan(arr[arr.length - 1]!);
    for (const p of [P1, P2, P3]) {
      const kinds = holyCues(p).map((q) => q.kind);
      expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'drop')).toHaveLength(p.smites.length);
      expect(kinds.filter((k) => k === 'smite')).toHaveLength(p.smites.length - 1);
      expect(kinds.filter((k) => k === 'spearHit')).toHaveLength(p.spears.length);
      expect(kinds.indexOf('sigil')).toBeLessThan(kinds.indexOf('drop'));
      expect(kinds).not.toContain('sword');
    }
    expect(P1.hits).toEqual([]);
  });

  it('Tier IV (owner 2026-09-29: "have 6 swords fly in ... starting with 1, then they ramp up in speed and the center implodes into that blest towards the enemy"): six swords, each FASTER and SOONER than the last; then implode, release, strike', () => {
    const kinds = holyCues(P4).map((q) => q.kind);
    for (const k of ['smite', 'spearHit', 'sigil', 'drop']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'sword')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'swordHit')).toHaveLength(6);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(at('pray')).toBeLessThan(at('sword'));
    expect(kinds.lastIndexOf('swordHit')).toBeLessThan(at('implode'));
    expect(at('implode')).toBeLessThan(at('spread'));
    expect(at('spread')).toBeLessThan(at('arrive'));
    expect(at('arrive')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('fade'));
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    // THE RAMP: every flight is shorter than the one before, and every gap between bites shorter than the one before.
    const w = P4.swords;
    for (let i = 1; i < w.length; i++) {
      expect(w[i]!.arriveAt - w[i]!.launchAt, `flight ${i}`).toBeLessThan(w[i - 1]!.arriveAt - w[i - 1]!.launchAt);
      expect(w[i]!.arriveAt, `order ${i}`).toBeGreaterThan(w[i - 1]!.arriveAt);
      if (i > 1) expect(w[i]!.arriveAt - w[i - 1]!.arriveAt, `gap ${i}`).toBeLessThan(w[i - 1]!.arriveAt - w[i - 2]!.arriveAt);
    }
    // the last is the biggest; they grow through the barrage
    for (let i = 1; i < w.length; i++) expect(w[i]!.size).toBeGreaterThanOrEqual(w[i - 1]!.size);
    expect(w[w.length - 1]!.size).toBe(C.swordLastSize);
    // every bite is a tick; the blow lands only on the strike
    expect(P4.hits).toEqual(w.map((x) => x.arriveAt));
    expect(P4.implodeAt).toBe(w[w.length - 1]!.arriveAt + C.swordHoldMs);
    expect(P4.spreadAt).toBe(P4.implodeAt + C.implodeMs);
    expect(P4.impactAt - P4.arriveAt).toBe(C.gatherMs);
    // the count is tunable (and capped)
    expect(holyPlan({ total: 40, distance: 1600 }, { ...C, swordCount: 3 }).swords).toHaveLength(3);
    expect(holyPlan({ total: 40, distance: 1600 }, { ...C, swordCount: 99 as never }).swords.length).toBeLessThanOrEqual(HOLY_CAPS.swords);
  });

  it('every tier escalates: more shake, zoom, motes, burst and dim', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) {
      for (const k of ['shakePx', 'zoom', 'motes', 'burst', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    }
    expect(P1.dim).toBe(0);
  });

  it('the shipped per-tier timeline (1600 px apart), ms from the invoke: the prayer, the impact and the end; IV about 3-4 s with the formation', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.prayAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P3), t(P4)]).toEqual([
      [300, 750, 1390], [340, 1110, 1810], [380, 1517, 2257], [380, 2778, 3798],
    ]);
    expect(P4.swords.map((w) => Math.round(w.arriveAt - P4.chargeAt))).toEqual([880, 1340, 1653, 1866, 2010, 2108]);
    for (const p of [P1, P2, P3]) expect(t(p)[2]).toBeLessThanOrEqual(2400);
    expect(t(P4)[2]).toBeLessThanOrEqual(4000);
  });

  it('the caps always hold, whatever the sliders say; the blast\'s flight scales gently with distance', () => {
    const wild: HeroHolyConfig = { ...C, t3Spears: 10, t4Motes: 90, t4Shake: 40, t4Zoom: 0.14, t2Smites: 4 };
    expect(holyPlan({ total: 15, distance: 800 }, wild).spears.length).toBeLessThanOrEqual(HOLY_CAPS.spears);
    expect(holyPlan({ total: 8, distance: 800 }, wild).smites.length).toBeLessThanOrEqual(HOLY_CAPS.smites);
    expect(holyPlan({ total: 99, distance: 800 }, wild).motes).toBeLessThanOrEqual(HOLY_CAPS.motes);
    expect(holySpreadMs(800, 250)).toBe(250);
    expect(holySpreadMs(50, 250)).toBe(150);
    expect(holySpreadMs(99999, 250)).toBe(300);
  });

  it('reduced motion: no smites, spears, sword, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.smites.length, p.spears.length, p.sword]).toEqual([0, 0, 0, 0, 0, false]);
    const kinds = holyCues(p).map((q) => q.kind);
    for (const k of ['charge', 'pray', 'sigil', 'drop', 'sword', 'slam', 'spread']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(holyCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('is deterministic: the same fight plans the same beats and places the same spears, sword, runes and cracks', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(holyCues(plan([4, 2, 3], 9, 720))).toEqual(holyCues(plan([4, 2, 3], 9, 720)));
    expect(holyGeo(P4, A, D, 80, C, 1)).toEqual(holyGeo(P4, A, D, 80, C, 1));
    expect(holyGeo(P3, A, D, 80, C, 1)).toEqual(holyGeo(P3, A, D, 80, C, 1));
    expect(holySeed(14, 1500.2, 'player')).toBe(holySeed(14, 1500.4, 'player'));
    expect(holySeed(14, 1500, 'player')).not.toBe(holySeed(14, 1500, 'opp'));
  });
});

describe('the geometry', () => {
  it('the spears fall from high above, slanted in from the striker\'s side, and land round the target on the side facing the striker', () => {
    const g = holyGeo(P3, A, D, 80, C, 1);
    expect(g.spears).toHaveLength(6);
    for (const sp of g.spears) {
      expect(sp.from.y).toBeLessThan(sp.to.y - 200);
      expect(Math.sign(sp.from.x - sp.to.x)).toBe(-1); // the striker is on the left
      const r = Math.hypot(sp.to.x - D.x, (sp.to.y - D.y) / 0.8);
      expect(r).toBeGreaterThan(80 * C.spearRing * 0.9);
      // toward the striker: the landing point is on the striker's side of the target
      expect((sp.to.x - D.x) * (A.x - D.x) + (sp.to.y - D.y) * (A.y - D.y)).toBeGreaterThan(-1);
    }
  });

  it('IV: the swords come from DIFFERENT directions round the compass (each from roughly opposite the last), from off screen, and plant their points round the centre', () => {
    const g = holyGeo(P4, A, D, 80, C, 1);
    expect(g.centre).toEqual({ x: (A.x + D.x) / 2, y: (A.y + D.y) / 2 });
    expect(g.swords).toHaveLength(6);
    const heads = g.swords.map((w) => Math.atan2(w.from.y - g.centre.y, w.from.x - g.centre.x));
    // six distinct headings, spread round the whole compass (no two within 40 degrees)
    for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) {
      let d = Math.abs(heads[i]! - heads[j]!); if (d > Math.PI) d = 2 * Math.PI - d;
      expect(d, `${i} vs ${j}`).toBeGreaterThan((40 * Math.PI) / 180);
    }
    // each comes from roughly OPPOSITE the one before
    for (let i = 1; i < heads.length; i += 2) {
      let d = Math.abs(heads[i]! - heads[i - 1]!); if (d > Math.PI) d = 2 * Math.PI - d;
      expect(d).toBeGreaterThan((150 * Math.PI) / 180);
    }
    for (const w of g.swords) {
      expect(Math.hypot(w.from.x - g.centre.x, w.from.y - g.centre.y)).toBeGreaterThan(1200); // off screen
      expect(Math.hypot(w.tip.x - g.centre.x, w.tip.y - g.centre.y)).toBeCloseTo(80 * C.swordPlant, 6); // planted round it
    }
    expect(g.swords[5]!.len).toBeGreaterThan(g.swords[0]!.len); // the last is the biggest
    expect(swordHeadings(6, 0, 0).map((a) => Math.round((a * 180) / Math.PI))).toEqual([0, 180, 60, 240, 120, 300]);
  });

  it('IV: the blast runs from the centre to the struck portrait (flat: its centre); runes lie along it; the main crack starts at the centre and ends at the target', () => {
    const g = holyGeo(P4, A, D, 80, C, 1);
    expect(g.foot).toEqual(D);
    expect(footOf(D, 80)).toEqual(D);
    expect(g.path.a).toEqual(g.centre);
    expect(g.path.b).toEqual(g.foot);
    expect(g.runes.length).toBeGreaterThan(3);
    expect(g.runes.length).toBeLessThanOrEqual(HOLY_CAPS.runes);
    for (let i = 1; i < g.runes.length; i++) expect(g.runes[i]!.u).toBeGreaterThan(g.runes[i - 1]!.u);
    expect(g.cracks).toHaveLength(3);
    const main = g.cracks[0]!;
    expect(main[0]).toEqual(g.centre);
    expect(main[main.length - 1]!.x).toBeCloseTo(g.foot.x, 6);
    expect(main[main.length - 1]!.y).toBeCloseTo(g.foot.y, 6);
  });
});

describe('the camera', () => {
  it('I-III: pushes in on the hero through the invoke, punches on the smite and shakes DOWN with it; rests by the end', () => {
    const hit = holyCameraAt(P3, C, P3.impactAt);
    expect(hit.zoom).toBeGreaterThan(1 + P3.punch);
    expect(hit.y).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = holyCameraAt(P3, C, P3.endAt);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.6);
    expect(holyCameraFocus(P3, P3.chargeAt + 10, A, D)).toEqual(A);
    expect(holyCameraFocus(P3, P3.impactAt, A, D)).toEqual(D);
  });

  it('IV: every bite punches in, harder as they ramp; the implosion sucks the view in; the focus rides from the centre to the target with the blast; the strike punches hardest; it rests by the end', () => {
    const centre = { x: 850, y: 515 };
    const z = (i: number): number => holyCameraAt(P4, C, P4.swords[i]!.arriveAt + 1).zoom;
    expect(z(5)).toBeGreaterThan(z(0));
    expect(holyCameraAt(P4, C, P4.spreadAt - 5).zoom).toBeGreaterThan(holyCameraAt(P4, C, P4.implodeAt + 5).zoom);
    expect(holyCameraFocus(P4, P4.swords[0]!.arriveAt, A, D, centre)).toEqual(centre);
    expect(holyCameraFocus(P4, P4.implodeAt, A, D, centre)).toEqual(centre);
    expect(holyCameraFocus(P4, P4.arriveAt, A, D, centre)).toEqual(D);
    const strike = holyCameraAt(P4, C, P4.impactAt + 1);
    expect(strike.zoom).toBeGreaterThan(holyCameraAt(P3, C, P3.impactAt + 1).zoom);
    expect(holyCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroHolyOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroHolyOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroHoly({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: 80,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('III: the blow lands EXACTLY ONCE, on the smite after the spear rain: never on a spear; the clock never pauses; everything is put back', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.spears).toHaveLength(6);
    expect(host.querySelector('.hblast.hholy')).not.toBeNull();
    f.tick(h.plan.spears[2]!.launchAt + 40, 4);
    expect(h.scene!.liveSpears).toBeGreaterThan(0);
    f.tick(h.plan.hits[h.plan.hits.length - 1]! + 8 - h.elapsed(), 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.seeds).toBeGreaterThan(0); // the spears planted their seeds
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt);
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
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

  it('IV: the swords fly in one by one and stay planted, the centre implodes (they are sucked in), the flat blast flies; the blow lands ONCE, on the strike (never on a sword, the implosion or the flight)', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.sword).toBe(true);
    f.tick(h.plan.swords[0]!.launchAt + 40, 4);
    expect(h.scene!.liveSwords).toBe(1);
    f.tick(h.plan.swords[2]!.arriveAt - h.elapsed() + 8, 4);
    expect(h.scene!.plantedSwords).toBe(3);
    f.tick(h.plan.implodeAt - h.elapsed() - 8, 4);
    expect(h.scene!.plantedSwords).toBe(6); // a star of blades round the centre
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.spreadAt - h.elapsed() + 20, 4);
    expect(h.scene!.liveSwords).toBe(0); // all sucked into the centre
    expect(h.scene!.blast!.flying).toBe(true);
    expect(h.scene!.spreading).toBe(true);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() - 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(16, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_HOLY_SPRITES);
    f.tick(h.plan.endAt + 3000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck; everything stays in the caps)', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 14, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_HOLY_SPRITES);
        expect(h.geo.foot).toEqual(footOf(d, 80));
        if (h.plan.sword) expect(h.geo.path.b).toEqual(footOf(d, 80));
        h.cancel();
      }
    }
  });

  it('slow motion stretches real time but the impact is still the same sequence beat', () => {
    const { h, f, onImpact } = run({ speed: 0.25 });
    f.tick(h.plan.impactAt * 4 - 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(60, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('a replay plays the same: the same fight plans the same beats and places the same things', () => {
    for (const total of [9, 40]) {
      const a = run({ total, formation: formationOf([total], total) });
      const b = run({ total, formation: formationOf([total], total) });
      expect(a.h.plan).toEqual(b.h.plan);
      expect(a.h.geo).toEqual(b.h.geo);
      a.h.cancel(); b.h.cancel();
    }
  });

  it('finish() before impact still lands the blow once and ends; cancel() never lands it and leaves nothing behind', () => {
    const a = run();
    a.f.tick(600);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.swords[3]!.arriveAt + 20);
    b.h.cancel();
    b.f.tick(5000);
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.onDone).not.toHaveBeenCalled();
    expect(b.host.querySelector('.hblast')).toBeNull();
    expect(b.camera.style.transform).toBe('');
    expect(b.attackerEl.style.transform).toBe('');
    expect(b.defenderEl.style.transform).toBe('');
    expect(b.root.children).toHaveLength(0);
  });

  it('reduced motion: no Pixi layer, no camera or portrait move, just fades; the blow lands once', () => {
    const { h, f, root, onImpact, camera, host, defenderEl, attackerEl } = run({ reduced: true, total: 40, formation: formationOf([40], 40) });
    expect(root.children).toHaveLength(0);
    expect(h.scene).toBeNull();
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('40');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const h = playHeroHoly({
        formation: formationOf([25], 25), total: 25, attacker: { x: 0, y: 0 }, defender: { x: 800, y: 0 },
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false,
        mount: () => () => {}, host: null, camera: null,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  it('a whole Tier IV (invoke, six swords, the implosion, the release, the flight, the eruption) stays in the cap, drains, and destroy leaves nothing', () => {
    const s = new HeroHolyScene(TEX, COLORS, LOOK, 1, 42);
    const g = holyGeo(P4, A, D, 80, C, 1);
    let peak = 0;
    const step = (n: number): void => { for (let i = 0; i < n; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); } };
    s.startInvoke(A.x, A.y, 70, 380, 1);
    step(24);
    s.pray(A.x, A.y, 70, 1);
    g.swords.forEach((w, i) => {
      s.launchSword(w.from, w.tip, g.centre, w.len, 200);
      step(13);
      s.swordHit(w.tip, g.centre, 80, i, 6, { dust: C.slamDust, debris: C.slamDebris, shock: 1, flashAlpha: 1 });
    });
    expect(s.plantedSwords).toBe(6);
    s.implode(g.centre, 80, 200);
    step(14);
    expect(s.liveSwords).toBe(0);
    s.release(g.centre, 80, g.foot, { size: 1, shards: C.shards, cracks: C.cracks, flashAlpha: 1 });
    s.spread(g.path.a, g.path.b, g.cracks, g.runes, 250, 50);
    step(16);
    s.gather(g.foot, 80, 40);
    step(3);
    s.eruptFoe(g.foot, D, 80, { flames: C.flamePillars, flameHeight: 1, burst: 1.8, motes: 56, flashAlpha: 1 });
    step(10);
    s.fadeGround(C.lingerMs);
    expect(peak).toBeLessThanOrEqual(MAX_HOLY_SPRITES);
    let alive = true;
    for (let i = 0; i < 800 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.hasSword).toBe(false);
    expect(s.blast).toBeNull();
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('I-III: sigils, pillars, spears and seeds all drain; clear() drops everything at once and the pool is reused, not regrown', () => {
    const s = new HeroHolyScene(TEX, COLORS, LOOK, 1, 9);
    const g = holyGeo(P3, A, D, 80, C, 1);
    s.startSigil(D.x, D.y, 80, 320, 3);
    g.spears.forEach((sp, i) => s.spear(sp.from, sp.to, 190, P3.spears[i]!.size));
    for (let i = 0; i < 14; i++) s.update(16);
    g.spears.forEach((sp, i) => s.spearHit(sp.to, 80, i));
    expect(s.seeds).toBeGreaterThan(0);
    s.dropPillar(D.x, D.y, 80, 160, 1.3, 1, 20);
    for (let i = 0; i < 12; i++) s.update(16);
    s.smite(D.x, D.y, 80, { tier: 3, k: 2 / 3, burst: 1.35, motes: 32, flashAlpha: 0.9 });
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.update(16)).toBe(false);
    s.startSigil(D.x, D.y, 80, 320, 3);
    s.smite(D.x, D.y, 80, { tier: 3, k: 2 / 3, burst: 1.35, motes: 32, flashAlpha: 0.9 });
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    s.destroy();
  });

  it('FLAT (owner 2026-09-29: "flat and not faux-3d"): the transform only turns and scales, never skews or squashes; no sprite of a whole Tier IV is ever skewed', () => {
    const sp = new Sprite(Texture.WHITE);
    for (const th of [0, 0.4, 1.2, 2.5]) {
      flatTransform(sp, th, 2, 2);
      expect(sp.skew.x).toBe(0);
      expect(sp.skew.y).toBe(0);
      expect(sp.scale.x).toBe(sp.scale.y);
      expect(sp.rotation).toBe(th);
    }
    sp.destroy();
    const s = new HeroHolyScene(TEX, COLORS, LOOK, 1, 7);
    const g = holyGeo(P4, A, D, 80, C, 1);
    const skewed = (): number => s.root.children.flatMap((l) => (l as Container).children).filter((ch) => ch.visible && (Math.abs(ch.skew.x) > 1e-9 || Math.abs(ch.skew.y) > 1e-9)).length;
    g.swords.forEach((w, i) => { s.launchSword(w.from, w.tip, g.centre, w.len, 100); for (let k = 0; k < 8; k++) s.update(16); s.swordHit(w.tip, g.centre, 80, i, 6, { dust: 8, debris: 12, shock: 1, flashAlpha: 1 }); });
    s.release(g.centre, 80, g.foot, { size: 1, shards: 20, cracks: 8, flashAlpha: 1 });
    s.spread(g.path.a, g.path.b, g.cracks, g.runes, 250, 50);
    for (let k = 0; k < 10; k++) { s.update(16); expect(skewed()).toBe(0); }
    s.eruptFoe(g.foot, D, 80, { flames: 9, flameHeight: 1, burst: 1.8, motes: 40, flashAlpha: 1 });
    s.update(16);
    expect(skewed()).toBe(0);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Consecration (attack_holy) is a Legendary crate hero attack that plays Holy; the dev override can force it; the others are unchanged; unknown ids play Classic', () => {
    expect(COSMETIC_INDEX.attack_holy).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Consecration', assets: { style: 'holy' }, active: true });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'undead', 'beast', 'banana', 'bleed', 'cards', 'storm', 'coin', 'boomerang', 'bubble', 'backstab', 'basketball', 'fel']); // Inferno (fire) then Grave Call (undead) joined 2026-09-29; Stampede (beast) joined 2026-09-29; Banana Cannon (banana) joined 2026-09-29; Hemorrhage (bleed) joined 2026-09-29
    expect(styleOfCosmetic('attack_holy')).toBe('holy');
    for (const [id, style] of [['attack_blast', 'blast'], ['attack_quake', 'quake'], ['attack_arcana', 'arcana'], ['attack_blades', 'blades'], ['attack_enraged', 'enraged']] as const) {
      expect(styleOfCosmetic(id)).toBe(style);
    }
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_holy' })).toBe('holy');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'holy' })).toBe('holy');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_holy' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_holy_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
