// @vitest-environment jsdom
/**
 * THE FROST HERO ATTACK (owner 2026-09-28: "branch off and create an ice/freeze blast one. icicles and then a frost nova
 * blast that blasts across the screen from the attacker to the target"): the tier mapping SHARED with every style; the
 * tier -> icicles ladder (1 / 2 / 5 / 4 + the nova); the tuner defaults + clamping; the pure plan (the volley rhythm,
 * the impact beat, the nova's order, reduced motion, determinism); the pure icicle paths (they form round the rim, clear
 * of the face, aimed at the target, and land on it) and the nova's run; the camera (both heroes kept in frame); the
 * runner on the shared clock (the consequence lands exactly ONCE, on the last icicle or the encasement shattering, never
 * on a tick; both directions; slow motion; replay; finish / cancel; cleanup; the clock never pauses); the headless
 * scene (pooled, bounded, drains, destroy leaves nothing); and the cosmetic resolution.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_ARCANA_DEFAULTS, arcanaPlan } from '../heroArcana/heroArcanaConfig';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  FROST_CAPS, HERO_FROST_DEFAULTS, HERO_FROST_RANGES, clampHeroFrostValue, frostCameraAt, frostCameraFocus, frostCues, frostPlan,
  frostSlots, frostTravelMs, heroFrostConfigJson, iciclePose, icicleMotions, novaFront, novaMotion, sanitizeHeroFrostConfig, trailPos,
  type HeroFrostConfig, type HeroFrostNumKey,
} from './heroFrostConfig';
import { HeroFrostScene, MAX_FROST_MESHES, MAX_FROST_SPRITES, SHEET_POINTS, type HeroFrostTextures } from './heroFrostScene';
import { frostSeed, playHeroFrost, type HeroFrostOptions } from './heroFrost';
import { SPEC } from '../HeroFrostTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroFrostTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  iceBody: W, iceCore: W, iceRim: W, iceSpec: W, iceGlow: W, shardA: W, shardB: W, shardC: W, flake: W, rune: W, puff: W, fern: W,
  novaBody: W, novaEdge: W, sheet: W, shell: W, cracks: W, rime: W,
};
const C = HERO_FROST_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => frostPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xffffff, ice: 0xc4f1ff, deep: 0x2d6fd8, side: 0x5fd4ff, shade: 0x34277e };
const LOOK = {
  thick: 1, glow: 0.7, core: 0.8, trailMs: 120, trailWidth: 18, dust: 1, shatterSize: 1, snowPuffs: 1, creepMs: 460, creepFerns: 5, creepReach: 0.42,
  snowDensity: 1, groundFerns: 18, groundFadeMs: 900, encaseSize: 1.12,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the damage tiers (shared with every hero attack)', () => {
  it('Frost steps up on exactly the blows the other styles do: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(arcanaPlan({ total: d, distance: 1600 }, HERO_ARCANA_DEFAULTS).tier);
    }
  });

  it('the ladder: I ONE icicle, II TWO, III a volley of FIVE, IV four icicles THEN the frost nova', () => {
    expect([P1, P2, P3, P4].map((p) => p.icicles.length)).toEqual([1, 2, 5, 4]);
    expect([P1, P2, P3, P4].map((p) => p.nova)).toEqual([false, false, false, true]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.nova ? `${p.icicles.length}+nova` : p.icicles.length; }))
      .toEqual([1, 1, 2, 2, 5, 5, '4+nova', '4+nova']);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_FROST_RANGES)) {
      const v = C[k as HeroFrostNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorIce', 'colorDeep', 'colorPlayer', 'colorFoe', 'colorShade'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroFrostValue('t3Icicles', 99)).toBe(8);
    expect(clampHeroFrostValue('t1Icicles', 0)).toBe(1);
    expect(clampHeroFrostValue('novaWidth', -3)).toBe(1);
    expect(clampHeroFrostValue('novaMs', 99999)).toBe(2000);
    expect(clampHeroFrostValue('encaseMs', Number.NaN)).toBe(C.encaseMs);
    expect(clampHeroFrostValue('encaseMs', 'abc')).toBe(C.encaseMs);
    expect(clampHeroFrostValue('encaseMs', '200')).toBe(200);
    expect(clampHeroFrostValue('colorIce', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroFrostValue('colorDeep', 'blue')).toBe(C.colorDeep);
    expect(clampHeroFrostValue('sfxLaunchClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroFrostValue('nope' as keyof HeroFrostConfig, 1)).toBeUndefined();
    expect(clampHeroFrostValue('toString' as keyof HeroFrostConfig, 1)).toBeUndefined();
    const s = sanitizeHeroFrostConfig({ t4Shards: 400, colorCore: 'x', bogus: 3 });
    expect(s.t4Shards).toBe(60);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroFrostConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Frost', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroFrostConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Nova).toBe(1);
    expect(json.t3Icicles).toBe(5);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('frost');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('frost');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ You cast', '▶ Foe casts', '▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe tier II (8)',
      '▶ Foe medium (12)', '▶ Foe huge (40)']) {
      expect(labels).toContain(l);
    }
  });
});

describe('the plan', () => {
  it('THE VOLLEY: five icicles land in rhythm, the first four are ticks, the LAST is the impact (only one impact beat)', () => {
    const arr = P3.icicles.map((r) => r.arriveAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]!, `arrival ${i}`).toBeGreaterThan(arr[i - 1]!);
    const gaps = arr.slice(1).map((a, i) => a - arr[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1); // an even rhythm
    expect(P3.impactAt).toBe(arr[arr.length - 1]);
    expect(P3.hits).toEqual(arr.slice(0, -1));
    const kinds = frostCues(P3).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'grow')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'fire')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
    // the last to land is the centre icicle, and the biggest
    expect(P3.icicles[4]!.slot).toBe(0);
    expect(P3.icicles[4]!.size).toBeGreaterThan(P3.icicles[0]!.size);
  });

  it('every icicle has crystallised before it is drawn back and fired', () => {
    for (const p of [P1, P2, P3, P4]) {
      for (const r of p.icicles) {
        expect(r.formAt).toBeGreaterThanOrEqual(p.chargeAt);
        expect(r.formAt + C.growMs).toBeLessThanOrEqual(r.launchAt - C.pullMs + 1e-6);
      }
    }
  });

  it('Tier II is a pair from either side; Tier I one icicle straight to the impact', () => {
    const [a, b] = P2.icicles;
    expect(Math.sign(a!.slot)).not.toBe(Math.sign(b!.slot));
    expect(P2.hits).toHaveLength(1);
    expect(P1.icicles).toHaveLength(1);
    expect(P1.hits).toEqual([]);
    expect(P1.impactAt).toBe(P1.icicles[0]!.arriveAt);
  });

  it('Tier IV: every icicle is a tick, THEN the nova is gathered, released, reaches the target and encases it; the SHATTER is the impact', () => {
    const kinds = frostCues(P4).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(kinds.lastIndexOf('fire')).toBeLessThan(at('novaCharge'));
    expect(kinds.lastIndexOf('hit')).toBeLessThan(at('nova'));
    expect(at('novaCharge')).toBeLessThan(at('nova'));
    expect(at('nova')).toBeLessThan(at('contact'));
    expect(at('contact')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('boom'));
    expect(P4.contactAt - P4.novaAt).toBe(frostTravelMs(1600, C.novaMs));
    expect(P4.impactAt).toBe(P4.contactAt + C.encaseMs);
    expect(Math.max(...P4.hits)).toBeLessThan(P4.novaAt);
  });

  it('every tier escalates: more shake, zoom, shards, burst and frost; II+ dims', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) {
      for (const k of ['shakePx', 'zoom', 'shards', 'burst', 'creep', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    }
    expect(P1.dim).toBe(0);
  });

  it('the shipped per-tier timeline (1600 px apart): first launch, impact and end, ms after the formation', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.fireAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P3), t(P4)]).toEqual([
      [480, 780, 1328], [540, 990, 1598], [620, 1330, 1998], [560, 2255, 3055],
    ]);
    // Brisk at Tier I, about 3 s at Tier IV (owner: "chunky and satisfying, not rushed").
    expect(t(P1)[2]).toBeLessThanOrEqual(1500);
    expect(t(P4)[2]).toBeLessThanOrEqual(3400);
  });

  it('the fan launches outer icicles first and the centre last', () => {
    expect(frostSlots(1)).toEqual([0]);
    expect(frostSlots(2)).toEqual([-1, 1]);
    expect(frostSlots(5)).toEqual([-2, 2, -1, 1, 0]);
    expect(frostSlots(4)).toEqual([-2, 2, -1, 1]);
  });

  it('the caps always hold, whatever the sliders say; travel scales gently with distance', () => {
    const wild: HeroFrostConfig = { ...C, t3Icicles: 8, t4Shards: 60, t4Shake: 40, t4Zoom: 0.14 };
    expect(frostPlan({ total: 15, distance: 800 }, wild).icicles.length).toBeLessThanOrEqual(FROST_CAPS.icicles);
    expect(frostPlan({ total: 99, distance: 800 }, wild).shards).toBeLessThanOrEqual(FROST_CAPS.shards);
    expect(frostTravelMs(1600, 500)).toBe(500);
    expect(frostTravelMs(100, 500)).toBe(300);
    expect(frostTravelMs(99999, 500)).toBe(575);
  });

  it('reduced motion: no icicles, nova, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.icicles.length, p.nova]).toEqual([0, 0, 0, 0, false]);
    const kinds = frostCues(p).map((q) => q.kind);
    for (const k of ['charge', 'grow', 'fire', 'hit', 'novaCharge', 'nova', 'contact']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(frostCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(icicleMotions(p, A, D, R, R, C)).toEqual([]);
    expect(novaMotion(p, A, D, R, R, C)).toBeNull();
  });

  it('is deterministic: the same fight plans the same beats and the same paths (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(frostCues(plan([4, 2, 3], 9, 720))).toEqual(frostCues(plan([4, 2, 3], 9, 720)));
    expect(icicleMotions(P4, A, D, R, R, C)).toEqual(icicleMotions(P4, A, D, R, R, C));
    expect(novaMotion(P4, A, D, R, R, C)).toEqual(novaMotion(P4, A, D, R, R, C));
    expect(frostSeed(14, 1500.2, 'player')).toBe(frostSeed(14, 1500.4, 'player'));
    expect(frostSeed(14, 1500, 'player')).not.toBe(frostSeed(14, 1500, 'opp'));
  });
});

describe('the icicles and the nova', () => {
  it('icicles form round the striking portrait RIM (clear of the face), facing the target, and grow from nothing', () => {
    for (const p of [P1, P2, P3, P4]) {
      for (const m of icicleMotions(p, A, D, R, R, C)) {
        const d = Math.hypot(m.home.x - A.x, m.home.y - A.y);
        expect(d).toBeGreaterThanOrEqual(R * C.formRadius - 0.5);
        // pointed at its hit point, on the target side of the hero
        expect((m.home.x - A.x) * (D.x - A.x) + (m.home.y - A.y) * (D.y - A.y)).toBeGreaterThan(0);
        expect(iciclePose(m, m.formAt - 1).grow).toBe(0);
        expect(iciclePose(m, m.formAt + m.growMs + 20).grow).toBeCloseTo(1, 1);
      }
    }
  });

  it('an icicle draws back before it fires, flies FAST and lands exactly on its hit point; the last dead on the target', () => {
    const [m] = icicleMotions(P1, A, D, R, R, C);
    const before = iciclePose(m!, m!.pullAt - 1), pulled = iciclePose(m!, m!.launchAt - 0.5);
    const along = (p: { x: number; y: number }): number => p.x * m!.aim.x + p.y * m!.aim.y;
    expect(along(pulled)).toBeLessThan(along(before)); // drawn back along its line
    expect(iciclePose(m!, m!.launchAt + 1).flying).toBe(true);
    const land = iciclePose(m!, m!.arriveAt);
    expect(land.landed).toBe(true);
    expect(land.x).toBeCloseTo(D.x, 6);
    expect(land.y).toBeCloseTo(D.y, 6);
    // the trail never reaches back into the hover
    expect(trailPos(m!, m!.launchAt - 200)).toEqual(trailPos(m!, m!.launchAt));
    const ms = icicleMotions(P3, A, D, R, R, C);
    expect(ms[4]!.to).toEqual(D);
    for (const x of ms) expect(Math.hypot(x.to.x - D.x, x.to.y - D.y)).toBeLessThanOrEqual(R * 0.35);
  });

  it('works both ways: a foe volley forms round the foe and lands on you', () => {
    const ms = icicleMotions(P3, D, A, R, R, C);
    for (const m of ms) {
      expect(Math.hypot(m.home.x - D.x, m.home.y - D.y)).toBeLessThan(R * 2);
      expect(Math.hypot(m.to.x - A.x, m.to.y - A.y)).toBeLessThanOrEqual(R * 0.35);
    }
  });

  it('the nova rolls from the attacker to the target, widening as it goes, and reaches the target on contact', () => {
    const n = novaMotion(P4, A, D, R, R, C)!;
    const f0 = novaFront(n, P4.novaAt), fm = novaFront(n, (P4.novaAt + P4.contactAt) / 2), f1 = novaFront(n, P4.contactAt);
    expect(Math.hypot(f0.x - A.x, f0.y - A.y)).toBeLessThan(R * 1.2);
    expect(f1.x).toBeCloseTo(D.x, 4);
    expect(f1.y).toBeCloseTo(D.y, 4);
    expect(fm.along).toBeGreaterThan(f0.along);
    expect(f1.halfW).toBeGreaterThan(f0.halfW);
    expect(f0.live).toBe(true);
    expect(f1.live).toBe(false);
    const back = novaMotion(P4, D, A, R, R, C)!;
    expect(novaFront(back, P4.contactAt).x).toBeCloseTo(A.x, 4);
  });
});

describe('the camera', () => {
  it('pushes in while the ice forms, punches in on the impact and shakes ALONG the throw; rests by the end', () => {
    const dir = { x: 0.6, y: -0.8 };
    const hit = frostCameraAt(P3, C, P3.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P3.zoom);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = frostCameraAt(P3, C, P3.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.6);
  });

  it('Tier IV keeps both heroes in frame: it follows the volley in, pans home for the gather, rides the nova, and the shatter punches hardest', () => {
    expect(frostCameraFocus(P4, P4.fireAt, A, D)).toEqual(A);
    expect(frostCameraFocus(P4, P4.hits[P4.hits.length - 1]!, A, D)).toEqual(D);
    const home = frostCameraFocus(P4, P4.novaAt, A, D);
    expect(home.x).toBeCloseTo(A.x, 4);
    expect(frostCameraFocus(P4, P4.contactAt, A, D)).toEqual(D);
    // the push eases right off over the long run across the board
    expect(frostCameraAt(P4, C, (P4.novaAt + P4.contactAt) / 2).zoom).toBeLessThan(1 + P4.zoom * 0.5);
    const boom = frostCameraAt(P4, C, P4.impactAt + 1);
    expect(boom.zoom).toBeGreaterThan(frostCameraAt(P3, C, P3.impactAt + 1).zoom);
    expect(frostCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroFrostOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroFrostOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroFrost({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('THE VOLLEY lands the blow EXACTLY ONCE, on the LAST icicle: never on a tick; frost creeps; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.icicles).toHaveLength(5);
    expect(host.querySelector('.hblast.hfrost')).not.toBeNull();
    f.tick(h.plan.fireAt - 20, 4);
    expect(h.scene!.liveIcicles).toBe(5); // every icicle has crystallised before the first one fires
    expect(h.scene!.charging).toBe(true);
    f.tick(h.plan.hits[h.plan.hits.length - 1]! - h.elapsed() + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveFerns).toBeGreaterThan(0); // the frost creeping over the struck portrait
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16); // the shards and the frost drain, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: the icicles tick, the nova rolls and encases, and the blow lands ONCE, on the encasement SHATTERING', () => {
    const { h, f, onImpact, defenderEl } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.nova).toBe(true);
    expect(h.nova).not.toBeNull();
    f.tick(h.plan.novaAt + 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.novaLive).toBe(true);
    expect(h.scene!.liveMeshes).toBeGreaterThanOrEqual(4);
    f.tick(h.plan.contactAt - h.elapsed() + 30, 4);
    expect(h.scene!.encased).toBe(true);
    expect(onImpact).not.toHaveBeenCalled();
    expect(defenderEl.style.transform).toContain('translate('); // straining in the ice (the clock runs on)
    const before = h.elapsed();
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(h.elapsed()).toBeGreaterThan(before);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.encased).toBe(false);
    expect(h.scene!.liveMeshes).toBeLessThanOrEqual(MAX_FROST_MESHES);
    f.tick(h.plan.endAt + 4000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck); the pools stay in their caps', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 14, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peakS = 0, peakM = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peakS = Math.max(peakS, h.scene!.liveSprites); peakM = Math.max(peakM, h.scene!.liveMeshes); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peakS).toBeLessThanOrEqual(MAX_FROST_SPRITES);
        expect(peakM).toBeLessThanOrEqual(MAX_FROST_MESHES);
        const last = h.motions[h.motions.length - 1]!;
        expect(Math.hypot(last.home.x - a.x, last.home.y - a.y)).toBeLessThan(R * 2);
        expect(Math.hypot(last.to.x - d.x, last.to.y - d.y)).toBeLessThanOrEqual(R * 0.35);
        if (h.nova) { expect(h.nova.a).toEqual(a); expect(h.nova.b).toEqual(d); }
        h.cancel();
      }
    }
  });

  it('the clock never pauses: every frame advances it by exactly the time played, through the encasement', () => {
    const { h, f } = run({ total: 40, formation: formationOf([40], 40) });
    let prev = h.elapsed();
    for (let t = 0; t < h.plan.endAt; t += 16) {
      f.tick(16, 16);
      if (h.done) break;
      expect(h.elapsed() - prev).toBeCloseTo(16, 6);
      prev = h.elapsed();
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

  it('a replay plays the same: the same fight flies the same icicles and the same nova', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.motions).toEqual(b.h.motions);
    expect(a.h.nova).toEqual(b.h.nova);
    a.h.cancel(); b.h.cancel();
  });

  it('finish() before impact still lands the blow once and ends; cancel() never lands it', () => {
    const a = run();
    a.f.tick(600);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.contactAt + 50);
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
    expect(h.motions).toEqual([]);
    expect(h.nova).toBeNull();
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
      const h = playHeroFrost({
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
  it('a whole Tier IV stays in the caps, strips stay under the batching limit, everything drains; destroy leaves nothing', () => {
    expect(SHEET_POINTS * 2).toBeLessThanOrEqual(100);
    const s = new HeroFrostScene(TEX, COLORS, LOOK, 1, 42);
    const ms = icicleMotions(P4, A, D, R, R, C);
    const nova = novaMotion(P4, A, D, R, R, C)!;
    let peakS = 0, peakM = 0;
    const cues = frostCues(P4);
    let ci = 0;
    for (let t = 0; t < P4.endAt + 3000; t += 16) {
      while (ci < cues.length && cues[ci]!.at <= s.time) {
        const q = cues[ci++]!;
        const m = ms[q.i];
        if (q.kind === 'charge') s.startCharge(A.x, A.y, R, P4.fireAt - P4.chargeAt, 1, ms.length);
        else if (q.kind === 'grow' && m) s.grow(m);
        else if (q.kind === 'fire' && m) s.fire(m);
        else if (q.kind === 'hit' && m) { s.shatter(m, { x: 1, y: 0 }, { size: 1, shards: 16, big: false, burst: 1, flashAlpha: 0.9, radius: R, tier: 4, spikes: 0 }); s.creep(D.x, D.y, R, 2.5, 0.55, 1200); }
        else if (q.kind === 'novaCharge') s.startNovaCharge(A.x, A.y, R, P4.novaAt - P4.novaChargeAt, nova.dir);
        else if (q.kind === 'nova') s.release(nova);
        else if (q.kind === 'contact') s.contact(D.x, D.y, R, P4.impactAt - P4.contactAt);
        else if (q.kind === 'impact') s.shatterNova(D.x, D.y, R, nova.dir, { burst: 1.9, shards: 34, flashAlpha: 0.9, spikes: 10 });
        else if (q.kind === 'boom') s.boom(D.x + 40, D.y, 1);
      }
      s.update(16);
      peakS = Math.max(peakS, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes);
      const meshes = s.root.children.flatMap((l) => (l as Container).children).filter((ch) => 'vertices' in ch && ch.visible) as unknown as { vertices: Float32Array }[];
      for (const mesh of meshes) for (const v of mesh.vertices) expect(Number.isFinite(v)).toBe(true);
    }
    expect(peakS).toBeGreaterThan(100);
    expect(peakS).toBeLessThanOrEqual(MAX_FROST_SPRITES);
    expect(peakM).toBeLessThanOrEqual(MAX_FROST_MESHES);
    expect(s.update(16)).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect(s.novaLive).toBe(false);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('clear() drops everything in flight at once; the pool is reused, not regrown', () => {
    const s = new HeroFrostScene(TEX, COLORS, LOOK, 1, 9);
    const ms = icicleMotions(P3, A, D, R, R, C);
    for (let t = 0; t < ms[0]!.formAt; t += 16) s.update(16);
    ms.forEach((m) => s.grow(m));
    s.update(16);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect(s.update(16)).toBe(false);
    ms.forEach((m) => s.grow(m));
    s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 10);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Frost Nova (attack_frost) is a Legendary crate hero attack that plays Frost; the dev override can force it; the other attacks unchanged', () => {
    expect(COSMETIC_INDEX.attack_frost).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Frost Nova', assets: { style: 'frost' }, active: true });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'undead', 'beast', 'banana', 'bleed', 'cards', 'storm', 'coin', 'boomerang', 'bubble', 'backstab', 'basketball', 'stitch']); // Consecration (holy) joined 2026-09-28 (Inferno, fire, 2026-09-29); Grave Call (undead) 2026-09-29; Stampede (beast) joined 2026-09-29; Banana Cannon (banana) joined 2026-09-29; Hemorrhage (bleed) joined 2026-09-29
    expect(styleOfCosmetic('attack_frost')).toBe('frost');
    for (const [id, style] of [['attack_blast', 'blast'], ['attack_quake', 'quake'], ['attack_arcana', 'arcana'], ['attack_blades', 'blades'], ['attack_enraged', 'enraged']] as const) {
      expect(styleOfCosmetic(id)).toBe(style);
    }
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_frost' })).toBe('frost');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'frost' })).toBe('frost');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_frost' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_frost_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
