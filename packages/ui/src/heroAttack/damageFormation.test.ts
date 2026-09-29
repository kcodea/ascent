// @vitest-environment jsdom
/**
 * THE DAMAGE FORMATION (owner ask 2026-09-28): the tuner values; the pure plan (left to right, the stagger compresses,
 * the cap beat only when capped, the stages in order, the shipped timeline, reduced motion); the DOM (every number is
 * the engine's; badges pulse and are put back; cleanup); the engine reader (`heroStrikeNumbers`, incl. old results);
 * Classic's own runner; and every cosmetic style opening with the SAME formation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import {
  FORMATION_DEFAULTS, FORMATION_RANGES, clampFormationValue, formationConfigJson, formationPlan, sanitizeFormationConfig,
  withFormation, type FormationConfig, type FormationNumKey,
} from './formationConfig';
import { DamageFormation, formationCapped, minionCounts, type FormationData } from './damageFormation';
import { classicSwing, playHeroClassic, strikePose } from './heroClassic';
import { getLungeConfig } from '../lungeConfig';
import { CLASSIC_DEFAULTS, CLASSIC_RANGES, classicPlan, clampClassicValue, type ClassicNumKey } from './classicConfig';
import { formationOf, leadInOf } from './formationFixtures';
import { heroStrikeNumbers } from '../heroBlast/heroStrikeDamage';
import { playHeroBlast } from '../heroBlast/heroBlast';
import { playHeroQuake } from '../heroQuake/heroQuake';
import { playHeroArcana } from '../heroArcana/heroArcana';
import { playHeroBlades } from '../heroBlades/heroBlades';
import { playHeroEnraged } from '../heroEnraged/heroEnraged';
import { playHeroPoison } from '../heroPoison/heroPoison';
import { playHeroFrost } from '../heroFrost/heroFrost';
import { playHeroHoly } from '../heroHoly/heroHoly';
import { playHeroFire } from '../heroFire/heroFire';
import { playHeroUndead } from '../heroUndead/heroUndead';
import { playHeroBeast } from '../heroBeast/heroBeast';
import { playHeroBanana } from '../heroBanana/heroBanana';
import { playHeroBleed } from '../heroBleed/heroBleed';
import { playHeroCards } from '../heroCards/heroCards';
import { playHeroStorm } from '../heroStorm/heroStorm';
import { SPEC, boardOf } from '../DamageFormationTuner';
import { Sequence } from './sequence';
import type { HeroAttackHandle, HeroAttackOptions } from './options';

const C = FORMATION_DEFAULTS;
const plan = (minions: number, capped: boolean, reduced = false, c: FormationConfig = C) => formationPlan({ minions, hero: true, capped, reduced }, c);

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range', () => {
    for (const [k, [min, max, step]] of Object.entries(FORMATION_RANGES)) {
      const v = C[k as FormationNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
  });

  it('clamps numbers into range; whole dials stay whole; junk falls back; unknown keys drop', () => {
    expect(clampFormationValue('capMs', 99999)).toBe(1500);
    expect(clampFormationValue('pulseStrength', -1)).toBe(0);
    expect(clampFormationValue('joinDir', 0.7)).toBe(1);
    expect(clampFormationValue('previewMinions', 12)).toBe(7);
    expect(clampFormationValue('capMs', 'abc')).toBe(C.capMs);
    expect(clampFormationValue('capMs', Number.NaN)).toBe(C.capMs);
    expect(clampFormationValue('sfxStampClip', '  fx/x  ')).toBe('fx/x');
    expect(clampFormationValue('nope' as keyof FormationConfig, 1)).toBeUndefined();
    const s = sanitizeFormationConfig({ capMs: -5, bogus: 1, sfxPulseClip: 7 });
    expect(s.capMs).toBe(80);
    expect('bogus' in s).toBe(false);
    expect(s.sfxPulseClip).toBe(C.sfxPulseClip);
    expect(sanitizeFormationConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(formationConfigJson(C)) as Record<string, unknown>;
    for (const k of ['previewMinions', 'previewTierLo', 'previewTierHi', 'previewHeroTier', 'previewCap']) expect(json[k], k).toBeUndefined();
    expect(json.capMs).toBe(C.capMs);
    const labels = (SPEC.actions ?? []).map((a) => a.label);
    for (const l of ['▶ You attack', '▶ Foe attacks', '▶ Other direction', '▶ 4 minions, capped']) expect(labels).toContain(l);
  });

  it('the preview board spreads its tiers left to right, low to high', () => {
    expect(boardOf({ minions: 4, lo: 2, hi: 5, hero: 4, cap: 10 })).toEqual({ minionTiers: [2, 3, 4, 5], heroTier: 4, cap: 10 });
    expect(boardOf({ minions: 1, lo: 3, hi: 6 }).minionTiers).toEqual([3]);
    expect(boardOf({ minions: 0 }).minionTiers).toEqual([]);
  });
});

describe('the plan', () => {
  it('minions pulse LEFT TO RIGHT, and every stage follows in order: pulses, merge, hero, join, full, cap, stamp, then the attack', () => {
    const p = plan(4, true);
    for (let i = 1; i < p.n; i++) expect(p.pulses[i]!, `pulse ${i}`).toBeGreaterThan(p.pulses[i - 1]!);
    for (let i = 1; i < p.n; i++) expect(p.lands[i]!, `land ${i}`).toBeGreaterThanOrEqual(p.lands[i - 1]!);
    expect(p.flights[0]!).toBeGreaterThan(p.pulses[p.n - 1]! + C.popMs);
    expect(p.mergeAt).toBe(p.lands[p.n - 1]);
    expect(p.heroAt).toBeGreaterThan(p.mergeAt);
    expect(p.joinFrom).toBeGreaterThan(p.heroAt);
    expect(p.joinAt).toBe(p.joinFrom + C.joinFlyMs);
    expect(p.capFrom).toBe(p.joinAt + C.cappedHoldMs);
    expect(p.crunchAt).toBe(p.capFrom); // the count-down starts ON the slash: no freeze
    expect(p.capTo).toBe(p.crunchAt + C.capMs);
    expect(p.endAt).toBe(p.capTo + C.capHoldMs);
    const kinds = p.beats.map((b) => b.kind);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(at('pulse')).toBeLessThan(at('flow'));
    expect(at('flow')).toBeLessThan(at('merge'));
    expect(at('merge')).toBeLessThan(at('hero'));
    expect(at('hero')).toBeLessThan(at('join'));
    expect(at('join')).toBeLessThanOrEqual(at('full'));
    expect(at('full')).toBeLessThan(at('cap'));
    expect(at('cap')).toBeLessThan(at('crunch'));
    expect(at('crunch')).toBeLessThan(at('stamp'));
    expect(p.beats.filter((b) => b.kind === 'pulse').map((b) => b.i)).toEqual([0, 1, 2, 3]);
  });

  it('the cap beat plays ONLY when the blow was capped', () => {
    const open = plan(4, false);
    expect(open.beats.some((b) => b.kind === 'cap' || b.kind === 'crunch' || b.kind === 'stamp')).toBe(false);
    expect(open.endAt).toBe(open.joinAt + C.fullHoldMs);
    expect(plan(4, true).beats.filter((b) => b.kind === 'stamp')).toHaveLength(1);
    expect(formationCapped({ full: 18, total: 10, cap: 10 })).toBe(true);
    expect(formationCapped({ full: 8, total: 8, cap: 10 })).toBe(false);
    expect(formationCapped({ full: 18, total: 10, cap: null })).toBe(false); // an older result: no cap beat
  });

  it('a big board never drags: the stagger compresses so the row fits the span', () => {
    const p7 = plan(7, false), p4 = plan(4, false);
    expect(p7.pulses[6]!).toBeLessThanOrEqual(C.pulseSpanMs);
    expect(p7.stagger).toBeLessThan(p4.stagger);
    expect(p7.endAt - p4.endAt).toBeLessThan(150);
  });

  it('no minions skips the pulses and the merge; no hero term skips the hero and the join', () => {
    const none = formationPlan({ minions: 0, hero: true, capped: false }, C);
    expect(none.beats.map((b) => b.kind)).toEqual(['hero', 'full']);
    const noHero = formationPlan({ minions: 3, hero: false, capped: false }, C);
    expect(noHero.beats.some((b) => b.kind === 'hero' || b.kind === 'join')).toBe(false);
    expect(noHero.beats.filter((b) => b.kind === 'pulse')).toHaveLength(3);
    const nothing = formationPlan({ minions: 0, hero: false, capped: false }, C);
    expect(nothing.beats.map((b) => b.kind)).toEqual(['full']);
  });

  it('the shipped timeline (ms): join, attack start, for 1 / 4 / 7 minions, uncapped and capped', () => {
    const t = (n: number, capped: boolean): number[] => { const p = plan(n, capped); return [Math.round(p.joinAt), Math.round(p.endAt)]; };
    expect([t(1, false), t(4, false), t(7, false)]).toEqual([[1640, 2100], [2138, 2598], [2230, 2690]]);
    expect([t(1, true), t(4, true), t(7, true)]).toEqual([[1640, 3300], [2138, 3798], [2230, 3890]]);
  });

  it('reduced motion keeps every stage as fades, with no flight', () => {
    const p = plan(4, true, true);
    expect(p.reduced).toBe(true);
    expect(new Set(p.pulses)).toEqual(new Set([0]));
    expect(p.beats.map((b) => b.kind)).toEqual(['pulse', 'merge', 'hero', 'full', 'cap', 'stamp']);
    expect(p.endAt).toBeGreaterThan(p.capTo);
  });

  it('merges its cues in front of a style\'s, in time order (ties: the formation first)', () => {
    const p = plan(2, false);
    const style = [{ at: 0, kind: 'x', i: 0 }, { at: p.endAt, kind: 'charge', i: 0 }, { at: p.endAt + 500, kind: 'end', i: 0 }];
    const all = withFormation(p, style);
    expect(all).toHaveLength(p.beats.length + 3);
    for (let i = 1; i < all.length; i++) expect(all[i]!.at).toBeGreaterThanOrEqual(all[i - 1]!.at);
    expect(all[0]!.kind).toBe('form');
  });

  it('is deterministic', () => {
    expect(plan(5, true)).toEqual(plan(5, true));
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: NonNullable<HeroAttackOptions['frames']>; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 8) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

const text = (host: HTMLElement, sel: string): string[] => [...host.querySelectorAll(sel)].map((e) => e.textContent ?? '');

describe('the DOM: every number is the engine\'s', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  const mount = (data: FormationData, reduced = false, beatsOver: Partial<{ chargeAt: number; impactAt: number }> = {}) => {
    const host = document.createElement('div');
    document.body.append(host);
    const badges = data.minions.map(() => { const b = document.createElement('img'); b.style.transform = 'translateX(-50%)'; document.body.append(b); return b; });
    const d: FormationData = { ...data, minions: data.minions.map((m, i) => ({ ...m, badges: [badges[i]!] })) };
    const fp = formationPlan({ minions: d.minions.length, hero: d.hero !== null, capped: formationCapped(d), reduced }, C);
    const f = new DamageFormation({
      data: d, plan: fp, beats: { reduced, k: 0.5, chargeAt: beatsOver.chargeAt ?? fp.endAt, absorbEnd: (beatsOver.chargeAt ?? fp.endAt) + 200, impactAt: beatsOver.impactAt ?? fp.endAt + 800, dim: 0 },
      cfg: C, attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, sideHex: '#ffb627', local: false, host, scale: 1, voices: null,
    });
    return { f, fp, host, badges };
  };

  it('the minion numbers, the minion total, the hero number, the full blow, the cap and the hit number all show the engine\'s values', () => {
    const data = formationOf([4, 2, 3, 4, 5], 10); // hero 4 + minions 2/3/4/5 = 18, capped to 10
    const { f, fp, host } = mount(data);
    expect(text(host, '.dform-chip b')).toEqual(['+2', '+3', '+4', '+5']);
    expect(text(host, '.dform-hero b')).toEqual(['+4']);
    expect(minionCounts([2, 3, 4, 5])).toEqual([2, 5, 9, 14]);
    f.paint(fp.lands[1]! + 1);
    expect(host.querySelector('.dform-merge b')!.textContent).toBe('+5');
    f.paint(fp.mergeAt + 1);
    expect(host.querySelector('.dform-merge b')!.textContent).toBe('+14');
    f.paint(fp.joinAt + 10);
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('18');
    expect(host.querySelector<HTMLElement>('.dform-stamp')!.style.opacity).toBe('0');
    f.paint(fp.capFrom - 1);
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('18'); // the full blow, held before the slash
    f.paint(fp.capTo + 5);
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('10');
    f.paint(fp.stampAt + 80);
    expect(host.querySelector('.dform-stamp')!.textContent).toBe('Damage capped');
    expect(Number(host.querySelector<HTMLElement>('.dform-stamp')!.style.opacity)).toBeGreaterThan(0.9);
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-10');
    f.remove();
    expect(host.querySelector('.hblast')).toBeNull();
  });

  it('uncapped: no stamp, no slash, the full number IS the blow', () => {
    const { f, fp, host } = mount(formationOf([3, 2, 4], 9));
    expect(fp.capped).toBe(false);
    expect(host.querySelector('.dform-slash')).toBeNull();
    f.paint(fp.endAt - 1);
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('9');
    expect(host.querySelector<HTMLElement>('.dform-stamp')!.style.opacity).toBe('0');
  });

  it('each tier badge pulses in its own window, left to right, and is put back EXACTLY after (and on remove)', () => {
    const { f, fp, badges } = mount(formationOf([4, 2, 3, 4], 13));
    f.paint(fp.pulses[1]! + 40);
    expect(badges[0]!.style.transform).toContain('scale(');
    expect(badges[1]!.style.transform).toContain('scale(');
    expect(badges[2]!.style.transform).toBe('translateX(-50%)'); // not its turn yet
    f.paint(fp.pulses[2]! + C.pulseMs + 5);
    expect(badges.map((b) => b.style.transform)).toEqual(['translateX(-50%)', 'translateX(-50%)', 'translateX(-50%)']);
    f.paint(fp.pulses[2]! + 20); // mid-pulse
    expect(badges[2]!.style.transform).toContain('scale(');
    f.remove();
    expect(badges[2]!.style.transform).toBe('translateX(-50%)');
  });

  it('only writes transform / opacity (and text) per frame: no layout reads while painting', () => {
    const { f, fp } = mount(formationOf([4, 2, 3, 4, 5, 6, 1, 2], 20));
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    const cs = vi.spyOn(window, 'getComputedStyle');
    for (let t = 0; t < fp.endAt + 500; t += 16) f.paint(t);
    expect(spy).not.toHaveBeenCalled();
    expect(cs).not.toHaveBeenCalled();
    spy.mockRestore(); cs.mockRestore();
    f.remove();
  });

  it('reduced motion: nothing moves off its spot, the stages fade, the same numbers', () => {
    const { f, fp, host, badges } = mount(formationOf([4, 2, 3], 7), true);
    f.paint(fp.pulses[0]! + 100);
    expect(badges[0]!.style.transform).toBe('translateX(-50%)');
    for (const t of [50, fp.mergeAt + 50, fp.joinAt + 50, fp.capTo + 50]) {
      f.paint(t);
      for (const el of host.querySelectorAll<HTMLElement>('.dform-chip, .dform-merge, .dform-hero, .hblast-total')) {
        expect(el.style.transform, `t=${t}`).not.toContain('scale(0');
      }
    }
    f.paint(fp.capTo + 300);
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('7');
    expect(Number(host.querySelector<HTMLElement>('.dform-stamp')!.style.opacity)).toBeGreaterThan(0.5);
    f.remove();
  });
});

const CAP_RUN = (lc: Partial<CombatResult>, wave = 2) => ({ lobby: undefined, mode: 'standard', wave, lastCombat: { playerDamage: 0, ...lc } } as never);

describe('the engine reader (`heroStrikeNumbers`)', () => {
  it('a capped WIN: the breakdown, the uncapped blow and the stamped cap', () => {
    const n = heroStrikeNumbers(CAP_RUN({
      result: 'win', enemyDamage: 18, damageCap: 5,
      enemyDamageBreakdown: { oppTier: 4, survivorTiers: [2, 3, 4, 5], survivorUids: ['m0', 'm1', 'm2', 'm3'] },
    }), true);
    expect(n).toEqual({
      hero: 4, minions: [{ tier: 2, uid: 'm0' }, { tier: 3, uid: 'm1' }, { tier: 4, uid: 'm2' }, { tier: 5, uid: 'm3' }], full: 18, total: 5, cap: 5,
    });
  });

  it('an uncapped LOSS: no cap beat; the full IS the blow', () => {
    const n = heroStrikeNumbers(CAP_RUN({
      result: 'lose', playerDamage: 3, playerDamageUncapped: 3, damageCap: 5, damageBreakdown: { oppTier: 2, survivorTiers: [1], survivorUids: ['e4'] },
    }), false);
    expect(n).toEqual({ hero: 2, minions: [{ tier: 1, uid: 'e4' }], full: 3, total: 3, cap: null });
  });

  it('an OLDER result (no uids, no stamps): what it knows, never a number the screen made up', () => {
    const loss = heroStrikeNumbers(CAP_RUN({ result: 'lose', playerDamage: 5, damageBreakdown: { oppTier: 6, survivorTiers: [6] } }, 1), false);
    expect(loss).toEqual({ hero: 6, minions: [{ tier: 6, uid: null }], full: 5, total: 5, cap: null });
    const win = heroStrikeNumbers(CAP_RUN({ result: 'win', enemyDamage: 12 }, 1), true);
    expect(win).toEqual({ hero: null, minions: [], full: 5, total: 5, cap: null });
  });
});

describe('the runners', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  const TEX = null;
  const base = (f: ReturnType<typeof manualFrames>, over: Partial<HeroAttackOptions> = {}): HeroAttackOptions => ({
    formation: formationOf([4, 2, 3, 4], 10), total: 10, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 },
    reduced: false, onImpact: vi.fn(), onDone: vi.fn(), frames: f.frames, sound: false, safety: false, host: document.body, camera: null,
    mount: () => () => {}, ...over,
  });

  it('EVERY style opens with the same shared formation, and starts its own attack exactly where it ends', () => {
    const styles: [string, (o: HeroAttackOptions) => HeroAttackHandle & { plan: { chargeAt: number; impactAt: number } }][] = [
      ['blast', (o) => playHeroBlast({ ...o, textures: TEX })],
      ['quake', (o) => playHeroQuake({ ...o, textures: TEX })],
      ['arcana', (o) => playHeroArcana({ ...o, textures: TEX })],
      ['blades', (o) => playHeroBlades({ ...o, textures: TEX })],
      ['enraged', (o) => playHeroEnraged({ ...o, textures: TEX, impactFx: false })],
      ['poison', (o) => playHeroPoison({ ...o, textures: null })],
      ['frost', (o) => playHeroFrost({ ...o, textures: TEX })],
      ['holy', (o) => playHeroHoly({ ...o, textures: TEX })],
      ['fire', (o) => playHeroFire({ ...o, textures: TEX })],
      ['undead', (o) => playHeroUndead({ ...o, textures: TEX })],
      ['beast', (o) => playHeroBeast({ ...o, textures: TEX })],
      ['banana', (o) => playHeroBanana({ ...o, textures: TEX })],
      ['bleed', (o) => playHeroBleed({ ...o, textures: TEX })],
      ['cards', (o) => playHeroCards({ ...o, textures: null })],
      ['storm', (o) => playHeroStorm({ ...o, textures: null })],
    ];
    const lead = leadInOf([4, 2, 3, 4], false, true);
    for (const [name, play] of styles) {
      const f = manualFrames();
      const onImpact = vi.fn();
      const h = play(base(f, { onImpact }));
      expect(document.querySelectorAll('.dform'), name).toHaveLength(1);
      expect(document.querySelectorAll('.dform-chip'), name).toHaveLength(3);
      expect(h.plan.chargeAt, name).toBe(lead);
      f.tick(h.plan.impactAt - 16);
      expect(onImpact, name).not.toHaveBeenCalled();
      f.tick(10000);
      expect(onImpact, `${name}: the consequence lands once, on impact`).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.dform'), name).toBeNull();
      expect(f.hooked(), name).toBe(0);
    }
  });

  it('CLASSIC (the free default, owner review 2026-09-28): the same formation, then the hero coils and LUNGES; the blow lands ONCE on contact with the same big -N; everything is put back', () => {
    const f = manualFrames();
    const onImpact = vi.fn();
    const onDone = vi.fn();
    const attackerEl = document.createElement('div');
    const defenderEl = document.createElement('div');
    const camera = document.createElement('div');
    document.body.append(attackerEl, defenderEl, camera);
    const h = playHeroClassic({ ...base(f, { onImpact, onDone, attackerEl, defenderEl, camera }), impactFx: false });
    expect(document.querySelectorAll('.dform.hclassic')).toHaveLength(1);
    expect(h.plan.chargeAt).toBe(leadInOf([4, 2, 3, 4], false, true));
    // no pills: the formation carries the number, the hit number is the shared big -N
    expect(document.querySelector('.hero-atk, .hero-dmgtaken')).toBeNull();
    f.tick(h.plan.strikeAt - 8);
    expect(attackerEl.style.transform).toContain('translate('); // coiled back
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.plan.strikeAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(document.querySelector('.hblast-hit')!.textContent).toBe('-10');
    expect(document.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(camera.style.transform).toContain('scale(');
    f.tick(40);
    expect(defenderEl.style.transform).toContain('scale('); // knocked back and squashed
    f.tick(h.plan.endAt + 200);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.dform')).toBeNull();
    expect([attackerEl.style.transform, defenderEl.style.transform, camera.style.transform]).toEqual(['', '', '']);
    expect(f.hooked()).toBe(0);
    // cancel(): never lands, still cleans up
    const g = manualFrames();
    const hit2 = vi.fn();
    const h2 = playHeroClassic({ ...base(g, { onImpact: hit2 }), impactFx: false });
    g.tick(500);
    h2.cancel();
    g.tick(8000);
    expect(hit2).not.toHaveBeenCalled();
    expect(document.querySelector('.dform')).toBeNull();
  });

  it("Classic's swing is the ORIGINAL one (owner: \"match the same speed as how it was for the wind up and normal hit\"): the lunge tuner's wind-up and strike, at the old tempo", () => {
    const lc = getLungeConfig();
    const sw = classicSwing({ x: 100, y: 800 }, { x: 1400, y: 150 }, { width: 200, height: 200 }, { width: 220, height: 220 });
    const p = classicPlan({ leadIn: 1000, tier: 2, swing: sw.times }, CLASSIC_DEFAULTS);
    const tempo = CLASSIC_DEFAULTS.tempo;
    expect(tempo).toBe(1.15); // the old Hero Duel strikeSpeed
    expect(p.strikeAt - p.windAt).toBeCloseTo((lc.windupDur * 1000) / tempo, 5);
    expect(p.strikeEnd - p.strikeAt).toBeCloseTo((sw.times.strikeS * 1000) / tempo, 5);
    expect(p.impactAt).toBeCloseTo(p.strikeEnd - (lc.smackLead * 1000) / tempo, 5);
    // coils BACK (away from the target), then drives in to the contact pose, then settles home
    const coiled = strikePose(p, sw, p.strikeAt);
    expect(coiled.x).toBeLessThan(0);
    expect(coiled.y).toBeGreaterThan(0);
    expect(coiled.scale).toBeCloseTo(lc.windupScale, 5);
    const hit = strikePose(p, sw, p.strikeEnd - 0.001);
    expect(hit.x).toBeCloseTo(sw.strike.x, 0);
    expect(hit.y).toBeCloseTo(sw.strike.y, 0);
    expect(strikePose(p, sw, p.windAt - 1)).toEqual({ x: 0, y: 0, rot: 0, scale: 1 });
    const home = strikePose(p, sw, p.homeAt);
    expect(Math.abs(home.x) + Math.abs(home.y)).toBeLessThan(0.5);
    // Subtle camera (owner: "dont over do the zoom/shake"): well under the Legendary attacks'
    expect(p.shakePx).toBeLessThan(8);
    expect(p.punch).toBeLessThan(0.02);
    expect(p.dim).toBe(0);
    // intensity scales only the impact, never the swing (the planned "enraged" strike reuses the motion)
    const hard = classicPlan({ leadIn: 1000, tier: 2, swing: sw.times, intensity: 2 }, CLASSIC_DEFAULTS);
    expect(hard.impactAt).toBe(p.impactAt);
    expect(hard.shakePx).toBeCloseTo(p.shakePx * 2, 5);
  });

  it("Classic's dials: defaults in range, clamped on write", () => {
    for (const [k, [min, max]] of Object.entries(CLASSIC_RANGES)) {
      const v = CLASSIC_DEFAULTS[k as ClassicNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampClassicValue('tempo', 9)).toBe(3);
    expect(clampClassicValue('shakePx', 'x')).toBe(CLASSIC_DEFAULTS.shakePx);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(CLASSIC_DEFAULTS)) expect(keys.has(k as never), k).toBe(true);
  });

  it('slow motion stretches real time only: the same beats land at 0.25x', () => {
    const f = manualFrames();
    const onImpact = vi.fn();
    const h = playHeroClassic({ ...base(f, { onImpact, speed: 0.25 }), impactFx: false });
    f.tick(h.plan.impactAt * 4 - 60);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(120);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('reduced motion plays through for Classic and a style alike', () => {
    const f = manualFrames();
    const onDone = vi.fn();
    const hit = vi.fn();
    playHeroClassic({ ...base(f, { onDone, onImpact: hit, reduced: true }), impactFx: false });
    f.tick(8000);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    const g = manualFrames();
    const onImpact = vi.fn();
    const h = playHeroArcana({ ...base(g, { onImpact, reduced: true }), textures: null });
    expect(h.plan.chargeAt).toBe(leadInOf([4, 2, 3, 4], true, true));
    g.tick(8000);
    expect(onImpact).toHaveBeenCalledTimes(1);
  });
});

describe('no attack ever pauses its clock (owner 2026-09-28: "remove the freezeing frame from all of the animations. it looks like lag")', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  const opts = (f: ReturnType<typeof manualFrames>, onImpact: () => void): HeroAttackOptions => ({
    formation: formationOf([4, 2, 3, 4], 10), total: 10, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 },
    reduced: false, onImpact, frames: f.frames, sound: false, safety: false, host: document.body, camera: null, mount: () => () => {},
  });
  const runners: [string, (o: HeroAttackOptions) => HeroAttackHandle & { plan: { impactAt: number; endAt: number } }][] = [
    ['classic', (o) => playHeroClassic({ ...o, impactFx: false })],
    ['blast', (o) => playHeroBlast({ ...o, textures: null })],
    ['quake', (o) => playHeroQuake({ ...o, textures: null })],
    ['arcana', (o) => playHeroArcana({ ...o, textures: null })],
    ['blades', (o) => playHeroBlades({ ...o, textures: null })],
    ['enraged', (o) => playHeroEnraged({ ...o, textures: null, impactFx: false })],
    ['poison', (o) => playHeroPoison({ ...o, textures: null })],
    ['frost', (o) => playHeroFrost({ ...o, textures: null })],
    ['holy', (o) => playHeroHoly({ ...o, textures: null })],
    ['fire', (o) => playHeroFire({ ...o, textures: null })],
    ['undead', (o) => playHeroUndead({ ...o, textures: null })],
    ['beast', (o) => playHeroBeast({ ...o, textures: null })],
    ['banana', (o) => playHeroBanana({ ...o, textures: null })],
    ['bleed', (o) => playHeroBleed({ ...o, textures: null })],
    ['cards', (o) => playHeroCards({ ...o, textures: null })],
    ['storm', (o) => playHeroStorm({ ...o, textures: null })],
  ];

  it('every style (and the formation inside it, through the capped slash) advances the clock by exactly the time played, every frame', () => {
    for (const [name, play] of runners) {
      const f = manualFrames();
      const onImpact = vi.fn();
      const h = play(opts(f, onImpact));
      let played = 0;
      while (!h.done && played < 20000) {
        const before = h.elapsed();
        f.tick(8, 8);
        played += 8;
        if (!h.done) expect(h.elapsed() - before, `${name} at ${played} ms`).toBe(8); // never held, never pinned back
      }
      expect(onImpact, name).toHaveBeenCalledTimes(1);
      expect(played, `${name}: ends on time, no hold added`).toBeLessThanOrEqual(Math.ceil(h.plan.endAt / 8) * 8 + 8);
    }
  });

  it('no hit-stop anywhere: no plan carries one, no tuner offers one, and the shared clock has no way to hold', () => {
    for (const [name, play] of runners) {
      const h = play(opts(manualFrames(), () => {}));
      const keys = Object.keys(h.plan).join(' ');
      expect(keys, name).not.toMatch(/hitStop|slamStop/i);
      h.cancel();
    }
    expect(Object.keys(FORMATION_DEFAULTS).join(' ')).not.toMatch(/capHit|hitStop/i);
    expect(Object.keys(CLASSIC_DEFAULTS).join(' ')).not.toMatch(/hitStop/i);
    expect(SPEC.controls.map((c) => `${c.key} ${c.label}`).join(' ')).not.toMatch(/hit-?stop|freeze/i);
    const seqProto = Object.getOwnPropertyNames(Sequence.prototype);
    expect(seqProto).not.toContain('hitStop');
  });
});
