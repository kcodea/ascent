// @vitest-environment jsdom
/**
 * THE ANCIENT KNOCKOUT VARIANT ("Tier V", owner ask 2026-10-02: "ancient tier animations should have a separate tier
 * of dmg specific for knockouts. they can just be small changes to the 'huge' tier ... can you do this for all 4
 * ancient tier animations?"). Oracle R-PROG-ATTACK-20 (the Ancient exception).
 *
 *  - an Ancient attack + a knockout plays its Knockout variant;
 *  - an Ancient attack without a knockout plays the normal tiers;
 *  - a non-Ancient attack + a knockout still plays Huge;
 *  - an Ancient attack with no variant falls back to Huge.
 * And each variant is a small remix of its Huge: one extra beat, at most ~500 ms more, inside the particle caps, the
 * consequence landing once, and the clock never stopping (the slow-mo dip is never a freeze, R-PROG-ATTACK-10).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, MeshSimple, Sprite, Texture } from 'pixi.js';
import { COSMETICS } from '@game/progression';
import { formationOf } from './formationFixtures';
import type { HeroAttackHandle, HeroAttackOptions } from './options';
import { KO_DIP, koDipExtraMs, koTimeScale } from './knockout';
import { KNOCKOUT_VARIANT_STYLES, attackRarityOf, knockoutVariantFor, playsKnockoutVariant } from './knockoutVariant';
import { isKnockoutVariant } from './tiers';
import { playHeroArcana } from '../heroArcana/heroArcana';
import { ARCANA_KO_BLUE, ARCANA_KO_PINK, ARCANA_KO_TURN_MS, MAX_ARCANA_MESHES, MAX_ARCANA_SPRITES, type HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { playHeroHoly } from '../heroHoly/heroHoly';
import { HERO_HOLY_DEFAULTS, HOLY_KO, holyCues, koSwordAngle } from '../heroHoly/heroHolyConfig';
import { HOLY_KO_GOLD, HOLY_KO_PINK, MAX_HOLY_SPRITES, type HeroHolyTextures } from '../heroHoly/heroHolyScene';
import { playHeroStitch } from '../heroStitch/heroStitch';
import { KNOT_PULSES, STITCH_KO, HERO_STITCH_DEFAULTS, knotAt, slowMoExtraMs, stitchCues, stitchTimeScale } from '../heroStitch/heroStitchConfig';
import { MAX_STITCH_SPRITES, type HeroStitchTextures } from '../heroStitch/heroStitchScene';
import { playHeroBlast } from '../heroBlast/heroBlast';
import { playHeroBasketball } from '../heroBasketball/heroBasketball';
import { SPEC as ARCANA_TUNER } from '../HeroArcanaTuner';
import { SPEC as HOLY_TUNER } from '../HeroHolyTuner';
import { SPEC as STITCH_TUNER } from '../HeroStitchTuner';
import { SPEC as BLAST_TUNER } from '../HeroBlastTuner';
import { playHeroBulletTime } from '../heroBulletTime/heroBulletTime';
import { MAX_BULLET_SPRITES, type HeroBulletTimeTextures } from '../heroBulletTime/heroBulletTimeScene';
import { SPEC as BULLET_TUNER } from '../HeroBulletTimeTuner';

const W = Texture.WHITE;
const ARCANA_TEX: HeroArcanaTextures = { glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W };
const HOLY_TEX: HeroHolyTextures = {
  ...ARCANA_TEX, swordGlow: W, swordBody: W, swordHot: W, hsigil: W, rays: W, pillar: W, flame: W, spear: W, crack: W, puff: W, chip: W,
  glyphs: [W, W, W], waveBody: W, waveEdge: W,
};
const STITCH_TEX: HeroStitchTextures = { ...ARCANA_TEX, needle: W, thread: W, shard: W };
const BULLET_TEX: HeroBulletTimeTextures = { ...ARCANA_TEX, lance: W, glyph: W, glint: W, mote: W, clockFace: W, wash: W, digit3: W, digit2: W, digit1: W };

const ANCIENT_STYLES = COSMETICS.filter((c) => c.category === 'hero_attack' && c.rarity === 'ancient').map((c) => String(c.assets.style));

describe('the plumbing: driven by the attack\'s rarity', () => {
  it('Arcana, Consecration and Soul Stitch are Ancient, and each has a variant', () => {
    for (const id of ['attack_arcana', 'attack_holy', 'attack_soul_stitch']) {
      const def = COSMETICS.find((c) => c.id === id)!;
      expect(def.rarity, id).toBe('ancient');
      expect(KNOCKOUT_VARIANT_STYLES.has(String(def.assets.style)), id).toBe(true);
    }
    // Every style with a variant is an Ancient attack (never a hard-coded exception for another rarity).
    for (const style of KNOCKOUT_VARIANT_STYLES) expect(attackRarityOf(style), style).toBe('ancient');
  });

  it('an Ancient attack + a knockout plays the Knockout variant (by style, and by the equipped cosmetic)', () => {
    expect(knockoutVariantFor({ style: 'arcana', knockout: true })).toBe(true);
    expect(knockoutVariantFor({ style: 'holy', knockout: true, cosmeticId: 'attack_holy' })).toBe(true);
    expect(knockoutVariantFor({ style: 'stitch', knockout: true, cosmeticId: 'attack_soul_stitch' })).toBe(true);
  });

  it('an Ancient attack without a knockout plays the normal tiers', () => {
    for (const style of ANCIENT_STYLES) expect(knockoutVariantFor({ style, knockout: false }), style).toBe(false);
    expect(isKnockoutVariant({ knockout: false, knockoutVariant: true })).toBe(false);
  });

  it('a non-Ancient attack + a knockout still plays Huge (every other rarity, and Classic)', () => {
    const others = COSMETICS.filter((c) => c.category === 'hero_attack' && c.rarity !== 'ancient');
    expect(others.length).toBeGreaterThan(5);
    for (const c of others) expect(knockoutVariantFor({ style: String(c.assets.style), knockout: true, cosmeticId: c.id }), c.id).toBe(false);
    expect(knockoutVariantFor({ style: 'classic', knockout: true })).toBe(false);
    // Even if a non-Ancient runner were (wrongly) listed as having a variant, the rarity gate keeps it on Huge.
    expect(knockoutVariantFor({ style: 'blast', knockout: true, variants: new Set(['blast']) })).toBe(false);
  });

  it('an Ancient attack with no variant falls back to Huge', () => {
    expect(knockoutVariantFor({ style: 'arcana', knockout: true, variants: new Set() })).toBe(false);
    expect(playsKnockoutVariant({ knockout: true, rarity: 'ancient', hasVariant: false })).toBe(false);
    expect(playsKnockoutVariant({ knockout: true, rarity: 'ancient', hasVariant: true })).toBe(true);
    expect(playsKnockoutVariant({ knockout: true, rarity: 'legendary', hasVariant: true })).toBe(false);
  });
});

/** A manual clock: step the runner frame by frame until it is done, collecting what the perf report needs. */
function run<H extends HeroAttackHandle & { scene: unknown }>(
  play: (o: HeroAttackOptions) => H,
  o: { total: number; knockout: boolean; variant: boolean },
  live: (h: H) => number,
): { h: H; frames: number; peak: number; impacts: number; minStep: number } {
  let step: ((dt: number) => void) | null = null;
  const onImpact = vi.fn();
  const h = play({
    formation: formationOf([5, 5, 5, 5, 5, 5, 10], o.total), total: o.total, knockout: o.knockout, knockoutVariant: o.variant,
    side: 'player', attacker: { x: 200, y: 850 }, defender: { x: 1500, y: 180 }, defenderRadius: 80, reduced: false, onImpact,
    frames: (fn) => { step = fn; return () => { step = null; }; }, sound: false, safety: false, host: null, camera: null, mount: () => () => {},
  });
  let frames = 0, peak = 0, minStep = Infinity, last = h.elapsed();
  while (!h.done && frames < 2000) {
    step!(1000 / 60);
    frames++;
    peak = Math.max(peak, live(h));
    if (!h.done) { minStep = Math.min(minStep, h.elapsed() - last); last = h.elapsed(); }
  }
  return { h, frames, peak, impacts: onImpact.mock.calls.length, minStep };
}

type Liveish = { liveSprites: number; liveMeshes?: number } | null;

/** Every visible sprite / strip mesh tint under a scene root (to read the palette a beat paints in). */
function tintsOf(root: Container): Set<number> {
  const out = new Set<number>();
  const walk = (c: Container): void => {
    for (const ch of c.children) {
      if ((ch instanceof Sprite || ch instanceof MeshSimple) && ch.visible && ch.alpha > 0.01) out.add(ch.tint as number);
      if (ch instanceof Container) walk(ch);
    }
  };
  walk(root);
  return out;
}

/** Start a runner on a manual clock and step it to sequence time `at` (a plain 60 fps step). */
function stepTo<H extends HeroAttackHandle>(play: (o: HeroAttackOptions) => H, variant: boolean, at: (h: H) => number): H {
  let step: ((dt: number) => void) | null = null;
  const h = play({
    formation: formationOf([5, 5, 5, 5, 5, 5, 10], 40), total: 40, knockout: true, knockoutVariant: variant,
    side: 'player', attacker: { x: 200, y: 850 }, defender: { x: 1500, y: 180 }, defenderRadius: 80, reduced: false, onImpact: () => {},
    frames: (fn) => { step = fn; return () => { step = null; }; }, sound: false, safety: false, host: null, camera: null, mount: () => () => {},
  });
  const target = at(h);
  let n = 0;
  while (h.elapsed() < target && !h.done && n++ < 2000) step!(1000 / 60);
  return h;
}
const sprites = (h: { scene: unknown }): number => (h.scene as Liveish)?.liveSprites ?? 0;

describe('each variant is its Huge, remixed', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  type Runner = (o: HeroAttackOptions) => HeroAttackHandle & { scene: unknown; plan: unknown };
  // [name, runner, sprite cap, the most real ms the Knockout may add over Huge, the least]. Soul Stitch's Knockout grew
  // its own final beat (owner tuning 2026-10-02: the latch, a second faster yank and the slam): ~0.5 s more than the rest.
  const cases: [string, Runner, number, number, number][] = [
    ['arcana', (o) => playHeroArcana({ ...o, textures: ARCANA_TEX }), MAX_ARCANA_SPRITES, 520, 150],
    ['holy', (o) => playHeroHoly({ ...o, textures: HOLY_TEX }), MAX_HOLY_SPRITES, 520, 150],
    ['stitch', (o) => playHeroStitch({ ...o, textures: STITCH_TEX }), MAX_STITCH_SPRITES, 1020, 800],
    ['bullettime', (o) => playHeroBulletTime({ ...o, textures: BULLET_TEX }), MAX_BULLET_SPRITES, 520, 150],
  ];

  for (const [name, play, cap, maxExtra, minExtra] of cases) {
    it(`${name}: Knockout plays the variant (tier IV underneath), adds its beats (at most ${maxExtra} ms), stays in the caps, lands once, never stops the clock`, () => {
      const huge = run(play, { total: 40, knockout: true, variant: false }, sprites);
      const ko = run(play, { total: 40, knockout: true, variant: true }, sprites);
      const plain = run(play, { total: 3, knockout: false, variant: true }, sprites);
      const hp = huge.h.plan as unknown as { tier: number; ko: boolean };
      const kp = ko.h.plan as unknown as { tier: number; ko: boolean };
      // The variant: still the shared Tier IV underneath (every per-tier dial reads IV), with the Knockout remix on top.
      expect(kp.tier).toBe(4);
      expect(kp.ko).toBe(true);
      // Huge (a knockout without the variant, i.e. the fallback) is exactly the Huge it always was.
      expect(hp.tier).toBe(4);
      expect(hp.ko).toBe(false);
      // No knockout: the normal tiers (a 3 is Tier I), the variant flag ignored.
      expect((plain.h.plan as unknown as { tier: number; ko: boolean }).tier).toBe(1);
      expect((plain.h.plan as unknown as { ko: boolean }).ko).toBe(false);
      // A remix: more than Huge, but bounded (real time over it).
      const extraMs = (ko.frames - huge.frames) * (1000 / 60);
      expect(extraMs).toBeGreaterThan(minExtra);
      expect(extraMs).toBeLessThanOrEqual(maxExtra);
      // The consequence lands exactly once; the clock advances every frame (a dip, never a freeze); inside the caps.
      expect(ko.impacts).toBe(1);
      expect(ko.minStep).toBeGreaterThan(0);
      expect(ko.peak).toBeLessThanOrEqual(cap);
      expect(ko.peak).toBeGreaterThan(huge.peak * 0.9);
    });
  }

  it('Arcana: one extra vortex pulse before the collapse', () => {
    const huge = run((o) => playHeroArcana({ ...o, textures: null }), { total: 40, knockout: true, variant: false }, () => 0).h.plan;
    const ko = run((o) => playHeroArcana({ ...o, textures: null }), { total: 40, knockout: true, variant: true }, () => 0).h.plan;
    expect(huge.koPulseAt).toBeNull();
    expect(ko.koPulseAt).not.toBeNull();
    expect(ko.koPulseAt!).toBeLessThan(ko.convergeAt);
    expect(ko.convergeAt - huge.convergeAt).toBe(300);
    expect(ko.shakePx).toBeGreaterThan(huge.shakePx);
    expect(ko.dip).toEqual({ at: ko.impactAt, lo: KO_DIP.lo, ms: KO_DIP.ms });
    // The extra prism ribbons stay inside the strip-mesh cap.
    const meshes = run((o) => playHeroArcana({ ...o, textures: ARCANA_TEX }), { total: 40, knockout: true, variant: true }, (h) => (h.scene as { liveMeshes: number } | null)?.liveMeshes ?? 0);
    expect(meshes.peak).toBeGreaterThan(0);
    expect(meshes.peak).toBeLessThanOrEqual(MAX_ARCANA_MESHES);
  });

  it('Arcana (owner tuning 2026-10-02): the swirl TURNS crimson-pink and electric blue; Huge keeps its own colours', () => {
    const at = (h: { plan: { swirlAt: number; koPulseAt: number | null; convergeAt: number } }): number => (h.plan.koPulseAt ?? h.plan.convergeAt) - 20;
    const ko = stepTo<ReturnType<typeof playHeroArcana>>((o) => playHeroArcana({ ...o, textures: ARCANA_TEX }), true, at);
    const huge = stepTo<ReturnType<typeof playHeroArcana>>((o) => playHeroArcana({ ...o, textures: ARCANA_TEX }), false, at);
    expect(ko.plan.swirlAt + ARCANA_KO_TURN_MS).toBeLessThan(ko.elapsed());
    const kt = tintsOf(ko.scene!.root), ht = tintsOf(huge.scene!.root);
    expect(kt.has(ARCANA_KO_PINK)).toBe(true);
    expect(kt.has(ARCANA_KO_BLUE)).toBe(true);
    expect(ht.has(ARCANA_KO_PINK) || ht.has(ARCANA_KO_BLUE)).toBe(false);
    ko.cancel(); huge.cancel();
  });

  it('Arcana: the Knockout explosion bursts OUTWARD harder than Huge (more flung ribbons, and a bigger, faster ring)', () => {
    const after = (h: { plan: { impactAt: number } }): number => h.plan.impactAt + 120;
    const ko = stepTo<ReturnType<typeof playHeroArcana>>((o) => playHeroArcana({ ...o, textures: ARCANA_TEX }), true, after);
    const huge = stepTo<ReturnType<typeof playHeroArcana>>((o) => playHeroArcana({ ...o, textures: ARCANA_TEX }), false, after);
    expect(ko.scene!.liveMeshes).toBeGreaterThan(huge.scene!.liveMeshes);
    // The widest ring on screen 120 ms in: the Knockout's has raced far past the Huge one's.
    const widest = (root: Container): number => {
      let w = 0;
      const walk = (c: Container): void => { for (const ch of c.children) { if (ch instanceof Sprite && ch.visible) w = Math.max(w, ch.scale.x); if (ch instanceof Container) walk(ch); } };
      walk(root);
      return w;
    };
    expect(widest(ko.scene!.root)).toBeGreaterThan(widest(huge.scene!.root) * 1.3);
    ko.cancel(); huge.cancel();
  });

  it('Consecration (owner tuning 2026-10-02): the wave that comes out is PINK + GOLD; Huge stays gold', () => {
    const mid = (h: { plan: { spreadAt: number; arriveAt: number } }): number => (h.plan.spreadAt + h.plan.arriveAt) / 2;
    const ko = stepTo<ReturnType<typeof playHeroHoly>>((o) => playHeroHoly({ ...o, textures: HOLY_TEX }), true, mid);
    const huge = stepTo<ReturnType<typeof playHeroHoly>>((o) => playHeroHoly({ ...o, textures: HOLY_TEX }), false, mid);
    const kt = tintsOf(ko.scene!.root), ht = tintsOf(huge.scene!.root);
    expect(kt.has(HOLY_KO_PINK)).toBe(true);
    expect(kt.has(HOLY_KO_GOLD)).toBe(true);
    expect(ht.has(HOLY_KO_PINK)).toBe(false);
    ko.cancel(); huge.cancel();
  });

  it('Consecration: a seventh, bigger knockout sword driven into the middle after the barrage', () => {
    const huge = run((o) => playHeroHoly({ ...o, textures: null }), { total: 40, knockout: true, variant: false }, () => 0).h;
    const ko = run((o) => playHeroHoly({ ...o, textures: null }), { total: 40, knockout: true, variant: true }, () => 0).h;
    expect(ko.plan.swords.length).toBe(huge.plan.swords.length + 1);
    const last = ko.plan.swords[ko.plan.swords.length - 1]!, prev = ko.plan.swords[ko.plan.swords.length - 2]!;
    expect(last.arriveAt - prev.arriveAt).toBe(HOLY_KO.swordGapMs);
    expect(last.size).toBeGreaterThan(prev.size);
    // The barrage's own swords are unchanged; the knockout sword comes in through a gap and plants in the centre.
    expect(ko.plan.swords.slice(0, -1)).toEqual(huge.plan.swords);
    const g = ko.geo.swords[ko.geo.swords.length - 1]!;
    expect(g.ang).toBeCloseTo(koSwordAngle(huge.plan.swords.length, HERO_HOLY_DEFAULTS));
    for (const b of huge.geo.swords) expect(Math.abs(Math.cos(b.ang - g.ang))).toBeLessThan(0.95);
    expect(g.tip).toEqual(ko.geo.centre);
    expect(holyCues(ko.plan).filter((q) => q.kind === 'swordHit').length).toBe(ko.plan.swords.length);
  });

  it('Soul Stitch (owner tuning 2026-10-02): after the burst, the latch, a second FASTER yank and the slam (the one impact)', () => {
    const huge = run((o) => playHeroStitch({ ...o, textures: null }), { total: 40, knockout: true, variant: false }, () => 0).h.plan;
    const ko = run((o) => playHeroStitch({ ...o, textures: null }), { total: 40, knockout: true, variant: true }, () => 0).h.plan;
    // The burst lands where Huge's impact does (plus the double-cinch); the slam is the impact, after it.
    expect(ko.burstAt - huge.impactAt).toBe(STITCH_KO.cinchMs);
    expect(ko.impactAt - ko.burstAt).toBe(STITCH_KO.latchDelayMs + STITCH_KO.latchFlightMs + STITCH_KO.yankMs);
    expect(ko.koHomeAt! - ko.impactAt).toBe(STITCH_KO.returnMs);
    expect(stitchCues(ko).filter((q) => q.kind === 'impact')).toEqual([{ at: ko.impactAt, kind: 'impact', i: 0 }]);
  });

  it('Soul Stitch: the heart-knot double-cinches before it ties', () => {
    const huge = run((o) => playHeroStitch({ ...o, textures: null }), { total: 40, knockout: true, variant: false }, () => 0).h.plan;
    const ko = run((o) => playHeroStitch({ ...o, textures: null }), { total: 40, knockout: true, variant: true }, () => 0).h.plan;
    expect(huge.koCinchAt).toBeNull();
    expect(ko.koCinchAt).toBe(huge.strikeAt);
    expect(ko.strikeAt! - huge.strikeAt!).toBe(STITCH_KO.cinchMs);
    const cinches = stitchCues(ko).filter((q) => q.kind === 'cinch');
    expect(cinches.length).toBe(KNOT_PULSES + 1);
    expect(cinches[cinches.length - 1]).toEqual({ at: ko.koCinchAt, kind: 'cinch', i: KNOT_PULSES + 1 });
    // The second cinch squeezes past snug for a moment, then settles back to tied.
    expect(knotAt(ko, ko.koCinchAt! + STITCH_KO.squeezeMs / 2)).toBeGreaterThan(1.1);
    expect(knotAt(ko, ko.strikeAt! - 1)).toBeCloseTo(1, 5);
    // A deeper, longer dip than Huge's, still never 0.
    const c = HERO_STITCH_DEFAULTS;
    expect(slowMoExtraMs(ko, c)).toBeGreaterThan(slowMoExtraMs(huge, c));
    for (let t = ko.impactAt; t < ko.impactAt + 600; t += 10) expect(stitchTimeScale(ko, c, t)).toBeGreaterThan(0);
  });

  it('Timebreak: one extra ring of blades in the dome, a deeper and longer dip, a bigger shake', () => {
    const huge = run((o) => playHeroBulletTime({ ...o, textures: null }), { total: 40, knockout: true, variant: false }, () => 0).h.plan;
    const ko = run((o) => playHeroBulletTime({ ...o, textures: null }), { total: 40, knockout: true, variant: true }, () => 0).h.plan;
    const rings = (p: typeof huge): number => new Set(p.darts.map((d) => d.ring)).size;
    expect(rings(ko)).toBe(rings(huge) + 1);
    expect(ko.ko).toBe(true);
    expect(ko.shakePx).toBeGreaterThan(huge.shakePx);
    expect(ko.dip!.lo).toBeLessThan(huge.dip!.lo);
    expect(ko.dip!.ms).toBeGreaterThan(huge.dip!.ms);
    expect(koDipExtraMs(ko.dip)).toBeGreaterThan(koDipExtraMs(huge.dip));
  });

  it('the dip is a ramp that never reaches 0 (R-PROG-ATTACK-10)', () => {
    const d = { at: 1000, lo: KO_DIP.lo, ms: KO_DIP.ms };
    expect(koTimeScale(d, 999)).toBe(1);
    expect(koTimeScale(d, 1000)).toBeCloseTo(KO_DIP.lo);
    for (let t = 1000; t < 1000 + KO_DIP.ms; t += 5) expect(koTimeScale(d, t)).toBeGreaterThan(0.09);
    expect(koTimeScale(d, 1000 + KO_DIP.ms)).toBe(1);
    expect(koDipExtraMs(d)).toBeGreaterThan(100);
    expect(koDipExtraMs(null)).toBe(0);
  });
});

describe('a style with no variant ignores the flag and plays Huge', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  it('Blast and Basketball (Legendaries): a knockout with the flag forced on is still their plain Tier IV', () => {
    const base = { formation: formationOf([1, 2], 3), total: 3, knockout: true, side: 'player' as const, attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 },
      reduced: false, onImpact: vi.fn(), frames: () => () => {}, sound: false, safety: false, host: document.body, camera: null, mount: () => () => {} };
    for (const play of [playHeroBlast, playHeroBasketball]) {
      const a = play({ ...base, textures: null, knockoutVariant: true });
      const b = play({ ...base, textures: null, knockoutVariant: false });
      expect(a.plan.tier).toBe(4);
      expect(a.plan.endAt).toBe(b.plan.endAt);
      a.cancel(); b.cancel();
    }
  });
});

describe('the tuners: a Knockout preview, Play and Foe, on each Ancient attack only', () => {
  const labels = (s: { actions?: { label: string }[] }): string[] => (s.actions ?? []).map((a) => a.label);
  it('Arcana, Consecration and Soul Stitch have "Knockout" and "Foe knockout"; a Legendary does not', () => {
    for (const spec of [ARCANA_TUNER, HOLY_TUNER, STITCH_TUNER, BULLET_TUNER]) {
      expect(labels(spec)).toContain('▶ Knockout (40)');
      expect(labels(spec)).toContain('▶ Foe knockout (40)');
    }
    expect(labels(BLAST_TUNER).some((l) => /knockout/i.test(l))).toBe(false);
  });
});
