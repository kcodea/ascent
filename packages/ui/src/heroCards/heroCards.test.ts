// @vitest-environment jsdom
/**
 * CARD SHARK, an EPIC hero attack (owner 2026-09-29: "build 5 animations that range from rare -> epic ... rare and epics
 * should only have 2 or 3 tiers to them and generally be less exciting, but still extremely clean and fun"): the shared
 * four damage tiers map to THREE looks (I small, II and III medium, IV big; a knockout plays big); the looks (one Ace /
 * three Aces thunk thunk thunk / the royal flush dealt, flipped, gilded and fired together into confetti); the tuner;
 * the pure plan, paths, hand fan and camera; the runner on the shared clock (the blow lands exactly ONCE, never on a
 * tick; both directions; slow motion; replay; finish / cancel; cleanup; the camera is applied ONCE); the headless scene
 * (pooled, bounded, drains, destroy leaves nothing); and the cosmetic (Epic, style `cards`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  CARDS_CAPS, HERO_CARDS_DEFAULTS, HERO_CARDS_RANGES, cardEase, cardMotions, cardPos, cardsCameraAt, cardsCameraFocus, cardsCues,
  cardsFlightMs, cardsLevel, cardsPlan, clampHeroCardsValue, facesFor, fanPoses, heldPoses, heroCardsConfigJson, sanitizeHeroCardsConfig,
  type HeroCardsConfig, type HeroCardsNumKey,
} from './heroCardsConfig';
import { HeroCardsScene, MAX_CARDS_SPRITES, type HeroCardsTextures } from './heroCardsScene';
import { cardsSeed, playHeroCards, type HeroCardsOptions } from './heroCards';
import { fxCanvasRidesCamera } from '../heroAttack/stageCamera';
import { SPEC } from '../HeroCardsTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroCardsTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  cardBack: W, cardFaces: { AS: W, AH: W, AD: W, TS: W, JS: W, QS: W, KS: W }, cardGlow: W, cardFlash: W, chip: W, pips: [W, W, W, W],
};
const C = HERO_CARDS_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false, knockout = false) => cardsPlan({ total, distance, reduced, knockout, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { ivory: 0xfff6e3, red: 0xc8203a, gold: 0xffc83a, ink: 0x1b1620, side: 0xffd76a };
const LOOK = { length: 104, glow: 0.55, ghosts: 0.26, quiver: 0.14, confetti: 14, gravity: 700 };
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the three looks (an Epic maps the shared four tiers onto three)', () => {
  it('reads the SHARED tier (thresholds 6 / 12 / 20) and maps I small, II and III medium, IV big', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    expect([1, 2, 3, 4].map((t) => cardsLevel(t as 1 | 2 | 3 | 4))).toEqual([1, 2, 2, 3]);
    for (let d = 0; d <= 60; d++) {
      const p = plan([d], d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.level).toBe(cardsLevel(tierOf(d)));
    }
    expect([P1, P2, P3, P4].map((p) => p.level)).toEqual([1, 2, 2, 3]);
  });

  it('a knockout always plays Big (the royal flush), whatever the number', () => {
    const ko = plan([2, 1], 3, 1600, false, true);
    expect(ko.tier).toBe(4);
    expect(ko.level).toBe(3);
    expect(ko.flush).toBe(true);
  });

  it('the ladder is a poker hand: high card (the Ace of spades), three of a kind (three Aces), a royal flush', () => {
    expect(P1.cards.map((c) => c.face)).toEqual(['AS']);
    expect(P2.cards.map((c) => c.face)).toEqual(['AH', 'AD', 'AS']);
    expect(P3.cards.map((c) => c.face)).toEqual(['AH', 'AD', 'AS']);
    expect(P4.cards.map((c) => c.face)).toEqual(['TS', 'JS', 'QS', 'KS', 'AS']);
    expect([P1, P2, P4].map((p) => p.flush)).toEqual([false, false, true]);
    expect(facesFor(2, 2)).toEqual(['AD', 'AS']);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_CARDS_RANGES)) {
      const v = C[k as HeroCardsNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorIvory', 'colorRed', 'colorGold', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroCardsValue('v2Cards', 99)).toBe(7);
    expect(clampHeroCardsValue('v1Cards', 0)).toBe(1);
    expect(clampHeroCardsValue('cardLength', -3)).toBe(40);
    expect(clampHeroCardsValue('goldMs', Number.NaN)).toBe(C.goldMs);
    expect(clampHeroCardsValue('goldMs', 'abc')).toBe(C.goldMs);
    expect(clampHeroCardsValue('goldMs', '300')).toBe(300);
    expect(clampHeroCardsValue('colorGold', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroCardsValue('colorPlayer', 'gold')).toBe(C.colorPlayer);
    expect(clampHeroCardsValue('sfxFlipClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroCardsValue('nope' as keyof HeroCardsConfig, 1)).toBeUndefined();
    const s = sanitizeHeroCardsConfig({ v3Sparks: 400, colorIvory: 'x', bogus: 3 });
    expect(s.v3Sparks).toBe(60);
    expect(s.colorIvory).toBe(C.colorIvory);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroCardsConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Card Shark; buttons on top', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroCardsConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.v3Cards).toBe(5);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('cards');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('cards');
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Medium (8)', '▶ Big (40)', '▶ Foe small (3)', '▶ Foe big (40)']) expect(labels).toContain(l);
    expect(labels.filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
  });
});

describe('the plan', () => {
  it('SMALL: one card, straight to the impact (no ticks)', () => {
    expect(P1.cards).toHaveLength(1);
    expect(P1.hits).toEqual([]);
    expect(P1.impactAt).toBe(P1.cards[0]!.arriveAt);
    const kinds = cardsCues(P1).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds).not.toContain('deal');
  });

  it('MEDIUM: thunk thunk thunk; the first two are ticks, the THIRD is the impact (only one impact beat)', () => {
    const arr = P2.cards.map((d) => d.arriveAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]!).toBeGreaterThan(arr[i - 1]!);
    expect(P2.impactAt).toBe(arr[2]);
    expect(P2.hits).toEqual(arr.slice(0, 2));
    const kinds = cardsCues(P2).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'throw')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
    expect(kinds.indexOf('impact')).toBeLessThan(kinds.indexOf('dissolve'));
  });

  it('BIG: dealt one by one, flipped one by one, gilded, held, then all five fire TOGETHER and land together (the burst is the impact)', () => {
    expect(P4.deals).toHaveLength(5);
    expect(P4.flips).toHaveLength(5);
    for (let i = 1; i < 5; i++) { expect(P4.deals[i]!).toBeGreaterThan(P4.deals[i - 1]!); expect(P4.flips[i]!).toBeGreaterThan(P4.flips[i - 1]!); }
    expect(P4.flips[0]!).toBeGreaterThan(P4.deals[4]! + C.dealMs);
    expect(P4.goldAt).toBeGreaterThan(P4.flips[4]! + C.flipMs);
    expect(P4.throwAt).toBe(P4.goldAt + C.goldMs + C.holdMs);
    expect(new Set(P4.cards.map((c) => c.throwAt)).size).toBe(1);
    expect(new Set(P4.cards.map((c) => c.arriveAt)).size).toBe(1);
    expect(P4.hits).toEqual([]);
    const kinds = cardsCues(P4).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds).not.toContain('hit');
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(kinds.lastIndexOf('deal')).toBeLessThan(at('flip'));
    expect(kinds.lastIndexOf('flip')).toBeLessThan(at('gold'));
    expect(at('gold')).toBeLessThan(at('throw'));
    expect(kinds.lastIndexOf('throw')).toBeLessThan(at('impact'));
  });

  it('short to medium, as an Epic should be: about 1.2 s small, 1.6 s medium, 2.5 s big (from the ready, 1600 px apart)', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.throwAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P4)]).toEqual([[320, 580, 1260], [360, 890, 1610], [1518, 1778, 2518]]);
    expect(t(P1)[2]).toBeGreaterThanOrEqual(1000);
    expect(t(P4)[2]).toBeLessThanOrEqual(2800);
  });

  it('every look escalates: more shake, zoom, sparks, burst and dim', () => {
    const ps = [P1, P2, P4];
    for (let i = 1; i < 3; i++) for (const k of ['shakePx', 'zoom', 'sparks', 'burst', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    expect(P1.dim).toBe(0);
  });

  it('the caps always hold; flight scales gently with distance', () => {
    const wild: HeroCardsConfig = { ...C, v2Cards: 7, v3Sparks: 60, v3Shake: 40, v3Zoom: 0.12 };
    expect(cardsPlan({ total: 8, distance: 800 }, wild).cards.length).toBeLessThanOrEqual(CARDS_CAPS.cards);
    expect(cardsPlan({ total: 99, distance: 800 }, wild).sparks).toBeLessThanOrEqual(CARDS_CAPS.sparks);
    expect(cardsFlightMs(1600, 300)).toBe(300);
    expect(cardsFlightMs(100, 300)).toBe(186);
  });

  it('reduced motion: no cards, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.cards.length]).toEqual([0, 0, 0, 0]);
    const kinds = cardsCues(p).map((q) => q.kind);
    for (const k of ['charge', 'deal', 'flip', 'gold', 'throw', 'hit']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(cardsCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(cardMotions(p, A, D, R, R, 100, C)).toEqual([]);
  });

  it('is deterministic (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(cardsCues(plan([4, 2, 3], 9, 720))).toEqual(cardsCues(plan([4, 2, 3], 9, 720)));
    const fan = fanPoses(5, A, D, R, 130, C, { w: 1600, h: 900 });
    expect(cardMotions(P4, A, D, R, R, 130, C, 36, null, fan)).toEqual(cardMotions(P4, A, D, R, R, 130, C, 36, null, fan));
    expect(cardsSeed(14, 1500.2, 'player')).toBe(cardsSeed(14, 1500.4, 'player'));
    expect(cardsSeed(14, 1500, 'player')).not.toBe(cardsSeed(14, 1500, 'opp'));
  });
});

describe('the card paths and the hand', () => {
  it('a card leaves the hand, spins, and sticks EDGE FIRST in the struck portrait (its leading short edge past the contact point)', () => {
    const hand = heldPoses(P1, A, D, R);
    const [m] = cardMotions(P1, A, D, R, R, 110, C, 36, null, hand);
    expect(Math.hypot(m!.a.x - A.x, m!.a.y - A.y)).toBeLessThanOrEqual(R); // from the thrower's rim
    expect(cardPos(m!, 0).rot).toBeCloseTo(hand[0]!.rot, 6); // no pop as it leaves the hand
    const end = cardPos(m!, m!.flightMs);
    expect(Math.hypot(m!.aim.x - D.x, m!.aim.y - D.y)).toBeLessThanOrEqual(R * 0.7); // the contact point is on the face
    expect(end.rot).toBeCloseTo(m!.h + Math.PI / 2, 6); // upright card turned so its top edge leads along the heading
    // The leading edge (centre + half a card along the heading) is buried past the contact point by `embed`.
    const lead = { x: end.x + Math.cos(m!.h) * 55, y: end.y + Math.sin(m!.h) * 55 };
    expect(Math.hypot(lead.x - m!.aim.x, lead.y - m!.aim.y)).toBeCloseTo(110 * C.embed, 4);
    expect(cardPos(m!, m!.flightMs + 500)).toEqual(end); // it stays stuck
    // it SPINS: the rotation sweeps through whole turns in flight
    let swept = 0, prev = cardPos(m!, 0).rot;
    for (let t = 8; t <= m!.flightMs; t += 8) { const r = cardPos(m!, t).rot; swept += Math.abs(r - prev); prev = r; }
    expect(swept).toBeGreaterThan(Math.PI * 2 * (P1.cards[0]!.spins - 0.6));
    expect(cardEase(0)).toBe(0);
    expect(cardEase(1)).toBe(1);
  });

  it('Medium sticks three cards at VARIED angles and spread positions round the face', () => {
    const ms = cardMotions(P2, A, D, R, R, 104, C, 36, null, heldPoses(P2, A, D, R));
    const hs = ms.map((m) => m.h);
    expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(0.2);
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      expect(Math.hypot(ms[i]!.aim.x - ms[j]!.aim.x, ms[i]!.aim.y - ms[j]!.aim.y)).toBeGreaterThan(R * 0.15);
    }
  });

  it('the Big hand fans out UPRIGHT in front of the hero, toward the target, and stays on screen from a corner', () => {
    const fan = fanPoses(5, A, D, R, 130, C, { w: 1600, h: 900 });
    expect(fan).toHaveLength(5);
    const cx = fan.reduce((s, p) => s + p.x, 0) / 5, cy = fan.reduce((s, p) => s + p.y, 0) / 5;
    // toward the target
    expect((cx - A.x) * (D.x - A.x) + (cy - A.y) * (D.y - A.y)).toBeGreaterThan(0);
    // fanned: left to right, rotating from left-leaning to right-leaning, the middle card upright
    for (let i = 1; i < 5; i++) { expect(fan[i]!.x).toBeGreaterThan(fan[i - 1]!.x); expect(fan[i]!.rot).toBeGreaterThan(fan[i - 1]!.rot); }
    expect(fan[2]!.rot).toBeCloseTo(0, 6);
    // a hero in the very corner still shows every card
    const edge = fanPoses(5, { x: 10, y: 890 }, { x: 60, y: 40 }, R, 130, C, { w: 1600, h: 900 });
    for (const p of edge) { expect(p.x).toBeGreaterThanOrEqual(130 * 0.62 - 1e-6); expect(p.y).toBeLessThanOrEqual(900 - 130 * 0.62 + 1e-6); }
    // the flush converges on the middle of the face
    const ms = cardMotions(P4, A, D, R, R, 130, C, 36, null, fan);
    for (const m of ms) expect(Math.hypot(m.aim.x - D.x, m.aim.y - D.y)).toBeLessThanOrEqual(R * 0.3);
    for (let i = 0; i < 5; i++) expect(cardPos(ms[i]!, 0).rot).toBeCloseTo(fan[i]!.rot, 6);
  });

  it('works both ways: a foe card from the top down to you, and the arc ceiling keeps it in frame', () => {
    const [m] = cardMotions(P1, D, A, R, R, 104, C, 36, null, heldPoses(P1, D, A, R));
    expect(Math.hypot(m!.aim.x - A.x, m!.aim.y - A.y)).toBeLessThanOrEqual(R * 0.7);
    const [c] = cardMotions(P1, { x: 200, y: 100 }, { x: 1500, y: 60 }, R, R, 104, C, 40);
    expect(c!.c.y).toBeGreaterThanOrEqual(40);
  });
});

describe('the camera', () => {
  it('pushes in through the ready, punches in on the impact and shakes ALONG the card; rests by the end', () => {
    const dir = { x: 0.8, y: -0.6 };
    const hit = cardsCameraAt(P2, C, P2.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P2.zoom);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P2.shakePx * 0.5);
    const rest = cardsCameraAt(P2, C, P2.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.8);
  });

  it('Big: the focus moves from the hero to the hand for the reveal, then to the target; the zoom stays gentle', () => {
    const hand = { x: 500, y: 700 };
    expect(cardsCameraFocus(P4, P4.chargeAt, A, D, hand)).toEqual(A);
    expect(cardsCameraFocus(P4, P4.goldAt, A, D, hand)).toEqual(hand);
    expect(cardsCameraFocus(P4, P4.impactAt, A, D, hand)).toEqual(D);
    let peak = 1;
    for (let t = P4.chargeAt; t < P4.endAt; t += 8) peak = Math.max(peak, cardsCameraAt(P4, C, t).zoom);
    expect(peak).toBeLessThan(1.2);
    expect(cardsCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
  });
});

function manualFrames(): { frames: HeroCardsOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroCardsOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroCards({
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

  it('MEDIUM lands the blow EXACTLY ONCE, on the THIRD card: never on a tick; the cards stick; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 8, formation: formationOf([8], 8) });
    expect(h.plan.cards).toHaveLength(3);
    expect(host.querySelector('.hblast.hcards')).not.toBeNull();
    f.tick(h.plan.hits[1]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.stuckCards).toBe(2);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-8');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(3000, 16);
    expect(h.scene!.liveCards).toBe(0); // fallen away
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('BIG: the hand is dealt, flipped face up, turned GOLD, fired together, and bursts ONCE into confetti', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.flush).toBe(true);
    f.tick(h.plan.flips[0]! - 8, 4);
    expect(h.scene!.handCards).toBe(5);
    expect(h.scene!.faceUpCards).toBe(0); // dealt face down
    f.tick(h.plan.goldAt - h.elapsed() - 4, 4);
    expect(h.scene!.faceUpCards).toBe(5);
    f.tick(h.plan.throwAt - h.elapsed() - 4, 4);
    expect(h.scene!.goldCards).toBe(5);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(40, 4);
    expect(h.scene!.flyingCards).toBe(5);
    f.tick(h.plan.impactAt - h.elapsed() + 12, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveCards).toBe(0); // burst into confetti
    expect(h.scene!.liveSprites).toBeGreaterThan(5 * LOOK.confetti);
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_CARDS_SPRITES);
    f.tick(h.plan.endAt + 3000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('a knockout blow of 3 plays the royal flush', () => {
    const { h } = run({ total: 3, knockout: true, formation: formationOf([3], 3) });
    expect(h.plan.level).toBe(3);
    expect(h.hand).toHaveLength(5);
    h.cancel();
  });

  it('works in both directions at every look (the blow lands on whichever hero is struck), inside the sprite cap', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_CARDS_SPRITES);
        for (const m of h.motions) expect(Math.hypot(m.aim.x - d.x, m.aim.y - d.y)).toBeLessThanOrEqual(R * 0.7);
        h.cancel();
      }
    }
  });

  it('THE CAMERA IS APPLIED ONCE: with the FX canvas inside the camera element the Pixi root never mirrors it; outside, it does', () => {
    // Inside: a sandbox whose canvas lives in the camera element (as the game's overlay lives in #stage).
    const inCam = document.createElement('div');
    inCam.appendChild(document.createElement('canvas'));
    expect(fxCanvasRidesCamera(inCam, inCam.querySelector('canvas'))).toBe(true);
    const a = run({ total: 8, formation: formationOf([8], 8), camera: inCam });
    a.f.tick(a.h.plan.impactAt + 20, 4);
    expect(inCam.style.transform).toContain('scale(');
    expect(a.h.scene!.root.scale.x).toBe(1);
    expect(a.h.scene!.root.position.x).toBe(0);
    a.h.cancel();
    // Outside: the canvas is elsewhere, so the root mirrors the zoom.
    const b = run({ total: 8, formation: formationOf([8], 8) });
    expect(fxCanvasRidesCamera(b.camera, b.camera.querySelector('canvas'))).toBe(false);
    b.f.tick(b.h.plan.impactAt + 20, 4);
    expect(b.h.scene!.root.scale.x).toBeGreaterThan(1);
    b.h.cancel();
    expect(fxCanvasRidesCamera(null, null)).toBe(false);
  });

  it('stuck cards RIDE the struck portrait\'s knockback', () => {
    const { h, f, root } = run({ total: 3, formation: formationOf([3], 3) });
    f.tick(h.plan.impactAt + 40, 4);
    const body = ((root.children[0] as Container).children.find((c) => c.label === 'cards-body') as Container).children.find((c) => c.visible)!;
    const m = h.motions[0]!;
    const off = Math.hypot(body.x - m.b.x, body.y - m.b.y);
    expect(off).toBeGreaterThan(1);
    f.tick(h.plan.dissolveAt - h.elapsed() - 20, 4);
    expect(Math.hypot(body.x - m.b.x, body.y - m.b.y)).toBeLessThan(off);
    h.cancel();
  });

  it('slow motion stretches real time but the impact is still the same sequence beat', () => {
    const { h, f, onImpact } = run({ speed: 0.25 });
    f.tick(h.plan.impactAt * 4 - 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(60, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('a replay plays the same', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.motions).toEqual(b.h.motions);
    a.f.tick(a.h.plan.impactAt + 60, 8); b.f.tick(b.h.plan.impactAt + 60, 8);
    expect(a.h.scene!.liveSprites).toBe(b.h.scene!.liveSprites);
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
    const b = run({ total: 40 });
    b.f.tick(b.h.plan.goldAt + 50);
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
    const { h, f, root, onImpact, camera, defenderEl, attackerEl } = run({ reduced: true, total: 40, formation: formationOf([40], 40) });
    expect(root.children).toHaveLength(0);
    expect(h.scene).toBeNull();
    expect(h.motions).toEqual([]);
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const h = playHeroCards({
        formation: formationOf([25], 25), total: 25, attacker: { x: 0, y: 0 }, defender: { x: 800, y: 0 },
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false, mount: () => () => {}, host: null, camera: null,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  it('a whole Big stays in the cap and drains; every drawn number is finite; destroy leaves nothing', () => {
    const s = new HeroCardsScene(TEX, COLORS, LOOK, 1, 42);
    const fan = fanPoses(5, A, D, R, 135, C, { w: 1600, h: 900 });
    const ms = cardMotions(P4, A, D, R, R, 135, C, 36, null, fan);
    s.startCharge(A, 300);
    ms.forEach((_, i) => s.deal(i, P4.cards[i]!.face, A, fan[i]!, 1.3, 180));
    let peak = 0;
    const step = (n: number): void => {
      for (let i = 0; i < n; i++) {
        s.update(16); peak = Math.max(peak, s.liveSprites);
        for (const l of s.root.children as Container[]) for (const ch of l.children) {
          if (ch.visible) expect(Number.isFinite(ch.x) && Number.isFinite(ch.y) && Number.isFinite(ch.rotation) && Number.isFinite(ch.scale.x)).toBe(true);
        }
      }
    };
    step(14);
    expect(s.handCards).toBe(5);
    ms.forEach((_, i) => s.flip(i, 150));
    step(12);
    expect(s.faceUpCards).toBe(5);
    s.gild(260);
    step(20);
    expect(s.goldCards).toBe(5);
    ms.forEach((m, i) => s.throw(i, P4.cards[i]!.face, m, 1.3, 0));
    step(20);
    s.burst(D.x, D.y, R, { burst: 1.7, sparks: 26, flashAlpha: 0.85 });
    peak = Math.max(peak, s.liveSprites);
    expect(peak).toBeLessThanOrEqual(MAX_CARDS_SPRITES);
    expect(s.liveCards).toBe(0);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('clear() drops everything at once; the pool is reused, not regrown', () => {
    const s = new HeroCardsScene(TEX, COLORS, LOOK, 1, 9);
    const hand = heldPoses(P2, A, D, R);
    const ms = cardMotions(P2, A, D, R, R, 104, C, 36, null, hand);
    ms.forEach((m, i) => { s.hold(i, P2.cards[i]!.face, hand[i]!, 1); s.throw(i, P2.cards[i]!.face, m, 1, 0); });
    s.update(16);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.update(16)).toBe(false);
    ms.forEach((m, i) => s.throw(i, P2.cards[i]!.face, m, 1, 0));
    s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 4);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Card Shark (attack_cards) is an EPIC crate hero attack that plays `cards`; the dev override can force it; unknown ids play Classic', () => {
    expect(COSMETIC_INDEX.attack_cards).toMatchObject({ category: 'hero_attack', rarity: 'epic', name: 'Card Shark', assets: { style: 'cards' }, active: true });
    expect(HERO_ATTACK_STYLES).toContain('cards');
    expect(styleOfCosmetic('attack_cards')).toBe('cards');
    expect(styleOfCosmetic('attack_poison')).toBe('poison');
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_cards' })).toBe('cards');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'cards' })).toBe('cards');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_cards' })).toBe('classic');
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_cards_2' })).toBe('classic');
  });
});
