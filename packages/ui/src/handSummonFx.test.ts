// @vitest-environment jsdom
/**
 * SUMMONED FROM HAND (owner ask 2026-10-23, R-HANDSUMMON-FX-01): the hand card lifts out of the hand and the minion forms
 * in its slot, as ONE seamless motion. One animation for every source, combat AND Shop. Pinned here:
 *   1. COMBAT: every player-side body that came out of the hand gets a flight from its hand card: a Spirit's
 *      hand-summon (`fromHandUid`) and Rune of the Waking Reserve (the card unmarked: matched by id + the rune's pick).
 *      Ordinary summons and the enemy's never fly.
 *   2. SHOP: the commit that grows `handCopiedThisTurn` pairs that hand card with the new body (`summonCopyFromHandShop`).
 *   3. The motion is seamless: the copy starts ON the hand card, every curve is continuous with no velocity kick, the
 *      minion forms through one slight overshoot to rest, and the crossfade never shows nothing and never shows both
 *      solid. The landing (dust, ring, sound) rings once, the combat clock waits for it, and it tears down clean.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type Keyword } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';

const fx = vi.hoisted(() => ({ glows: 0, streaks: 0, dissolves: 0, dust: 0, sounds: [] as (string | undefined)[] }));
vi.mock('./pixiFx', () => ({ pixiFx: { flashBloom: () => { fx.glows++; }, buffTendril: () => { fx.streaks++; }, pulse: () => { fx.dissolves++; } } }));
vi.mock('./fx/playDef', () => ({ playDef: () => { fx.dust++; return () => {}; }, canPlayDefs: () => true }));
vi.mock('./sfx', () => ({ sfx: { summon: (id?: string) => { fx.sounds.push(id); } } }));

import {
  HAND_SUMMON_MAX_SPEED, clearHandSummonFx, combatHandSummonOrigins, copyPath, formScale, handSummonDurationMs,
  handSummonLaunchAt, handSummonRemainingMs, isHandSummonInFlight, launchHandSummonFlights, setHandSummonSource,
  shopHandSummonFlights,
} from './handSummonFx';
import { HAND_SUMMON_DEFAULTS, resetHandSummonConfig, setHandSummonValue } from './handSummonConfig';
const HAND_SUMMON_STAGGER_MS = HAND_SUMMON_DEFAULTS.staggerMs;

const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const handMinion = (uid: string, cardId: string, over: Partial<{ attack: number; health: number; keywords: Keyword[]; golden: boolean }> = {}) => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords] as Keyword[], golden: false, ...over };
};
const fight = (mine: BoardMinion[], foes: BoardMinion[], hand: ReturnType<typeof handMinion>[], mods: object = {}, seed = 7) =>
  simulate(mine, foes, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['undead', 'beast', 'spirit', 'celestial'], questMods: mods, handMinions: hand, poolIds: poolFor('set3').all.map((c) => c.id) }),
    combatSide({ tier: 6 }));

describe('combat: which bodies fly from the hand', () => {
  it('a Spirit hand-summon (Dreamtide Caller\'s Echo) flies from the card its `fromHandUid` names', () => {
    const hand = [handMinion('h1', 'sp3_kindled', { attack: 9, health: 9 }), handMinion('h2', 'venom')];
    const r = fight([bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(5, 40)], hand);
    const origins = combatHandSummonOrigins(r.events, hand);
    const fromHand = r.events.filter((e) => e.type === 'summon' && e.fromHandUid);
    expect(fromHand).toHaveLength(1);
    expect(origins.size).toBe(1);
    expect([...origins.values()]).toEqual(['h1']);
  });

  it('Seedling Spirit\'s Rally summon flies too', () => {
    const hand = [handMinion('h1', 'venom'), handMinion('h2', 'sp3_kindled'), handMinion('h3', 'sp3_tidebud')];
    const r = fight([bm('sp3_seedling')], [foe(0, 40)], hand);
    const origins = combatHandSummonOrigins(r.events, hand);
    expect(origins.size).toBeGreaterThan(0);
    for (const h of origins.values()) expect(['h2', 'h3']).toContain(h);
  });

  it('Rune of the Waking Reserve (card unmarked) flies from the highest-stat hand card of that id, gilding matched', () => {
    const hand = [
      handMinion('h1', 'u3_poochy', { attack: 4, health: 4, keywords: [] }),
      handMinion('h2', 'u3_poochy', { attack: 3, health: 6, keywords: ['T'], golden: true }),
      handMinion('h3', 'u3_poochy', { attack: 2, health: 2, keywords: [] }),
    ];
    const r = fight([bm('sandbag')], [foe(0, 500)], hand, { runeWakingReserve: true }, 5);
    const origins = combatHandSummonOrigins(r.events, hand);
    expect([...origins.values()]).toEqual(['h2']);
  });

  it('an ordinary summon never flies, and neither does the enemy\'s', () => {
    const r = fight([bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(5, 40)], []);
    expect(combatHandSummonOrigins(r.events, []).size).toBe(0);
    const enemyOnly = combatHandSummonOrigins([
      { type: 'summon', side: 'enemy', index: 0, minion: { uid: 'e1', cardId: 'venom' } as never, fromHandUid: 'x' },
    ], []);
    expect(enemyOnly.size).toBe(0);
  });
});

describe('shop: the commit that grows handCopiedThisTurn', () => {
  // The commit `summonCopyFromHandShop` makes (its contract is pinned in sim's set3Spirits.test.ts): the hand card
  // stays, its uid joins `handCopiedThisTurn`, and a fresh body of the same id lands on the board.
  const before = { copied: [] as string[], board: [{ uid: 'dc', cardId: 'sp3_dreamtide' }] };
  const hand = [{ uid: 'h', cardId: 'sp3_kindled' }, { uid: 'h2', cardId: 'sp3_kindled' }];
  const after = { copied: ['h'], board: [{ uid: 'dc', cardId: 'sp3_dreamtide' }, { uid: 'b9', cardId: 'sp3_kindled' }] };

  it('pairs the copied hand card with the new body of its id', () => {
    const prevBoard = new Set(before.board.map((c) => c.uid));
    expect(shopHandSummonFlights(before.copied, after.copied, prevBoard, after.board, hand)).toEqual([{ handUid: 'h', boardUid: 'b9', cardId: 'sp3_kindled' }]);
    // A body End-of-Turn playback already drew is on screen: nothing to fly.
    expect(shopHandSummonFlights(before.copied, after.copied, prevBoard, after.board, hand, new Set(['b9']))).toEqual([]);
    // Nothing newly copied (a later unrelated commit): nothing flies.
    expect(shopHandSummonFlights(after.copied, after.copied, new Set(['dc']), after.board, hand)).toEqual([]);
    // A token of the same id summoned by something else (no copy latch moved) never flies.
    expect(shopHandSummonFlights([], [], prevBoard, after.board, hand)).toEqual([]);
  });
});

describe('the motion is seamless (owner 2026-10-23: "way more seamless")', () => {
  const C = HAND_SUMMON_DEFAULTS;
  const maxStep = (xs: number[]): number => Math.max(...xs.slice(1).map((v, i) => Math.abs(v - xs[i]!)));

  it('the copy starts EXACTLY on the hand card, solid, and every curve moves in small continuous steps', () => {
    const p = copyPath({ x: 300, y: 900 }, { x: 700, y: 400 }, 40, C, 0.5, 0.9);
    expect(p[0]).toMatchObject({ x: 300, y: 900, scale: 1, opacity: 1 });
    expect(p[p.length - 1]!.opacity).toBe(0);
    // no jumps: between neighbouring samples nothing moves more than a small share of its total range
    expect(maxStep(p.map((s) => s.x))).toBeLessThan(400 * 0.12);
    expect(maxStep(p.map((s) => s.y))).toBeLessThan(500 * 0.12);
    expect(maxStep(p.map((s) => s.scale))).toBeLessThan(0.06);
    expect(maxStep(p.map((s) => s.opacity))).toBeLessThan(0.2);
    // velocity-continuous: the step size itself changes gradually (no hard stop or kick between phases)
    const steps = p.slice(1).map((s, i) => Math.hypot(s.x - p[i]!.x, s.y - p[i]!.y));
    expect(maxStep(steps)).toBeLessThan(Math.max(...steps) * 0.5);
    // it lifts UP first, before it heads for the slot
    expect(p[2]!.y).toBeLessThan(900);
    expect(Math.abs(p[2]!.x - 300)).toBeLessThan(Math.abs(p[2]!.y - 900));
  });

  it('the minion forms through ONE slight overshoot and eases back to exactly 1', () => {
    const f = formScale(C.formFrom, C.overshoot);
    const xs = Array.from({ length: 101 }, (_, i) => f(i / 100));
    expect(xs[0]).toBeCloseTo(C.formFrom, 5);
    expect(xs[100]).toBeCloseTo(1, 5);
    expect(Math.max(...xs)).toBeCloseTo(C.overshoot, 2);
    let turns = 0;
    for (let i = 2; i < xs.length; i++) if ((xs[i]! - xs[i - 1]!) * (xs[i - 1]! - xs[i - 2]!) < 0) turns++;
    expect(turns, 'one peak, no second bounce').toBe(1);
    expect(Math.abs(xs[100]! - xs[99]!), 'arrives at rest with no velocity').toBeLessThan(0.001);
  });

  it('timing: about 550-650 ms in all at 1x, and the stagger is shorter than the motion so a chain flows', () => {
    expect(handSummonDurationMs(C)).toBeGreaterThanOrEqual(500);
    expect(handSummonDurationMs(C)).toBeLessThanOrEqual(650);
    expect(C.staggerMs).toBeLessThan(C.appearAt);
  });
});

describe('the flight', () => {
  afterEach(() => {
    clearHandSummonFx(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers(); resetHandSummonConfig();
    fx.glows = 0; fx.streaks = 0; fx.dissolves = 0; fx.dust = 0; fx.sounds.length = 0;
  });

  it('staggers several bodies drawn on one frame', () => {
    expect(handSummonLaunchAt(0)).toBe(0);
    expect(handSummonLaunchAt(2)).toBe(2 * HAND_SUMMON_STAGGER_MS);
  });

  /** A hand card + a board body, with stubbed rects and a recording `animate` (jsdom has no Web Animations). */
  function stage(handUid: string, boardUid: string, x: number) {
    const animated: { el: Element; kf: Keyframe[]; opts: KeyframeAnimationOptions }[] = [];
    const rects: string[] = [];
    const stubAnim = (el: Element, kf: Keyframe[], opts: KeyframeAnimationOptions): Animation => {
      animated.push({ el, kf, opts });
      const listeners: Record<string, (() => void)[]> = {};
      return {
        addEventListener: (t: string, fn: () => void) => { (listeners[t] ??= []).push(fn); },
        cancel: () => { for (const fn of listeners.cancel ?? []) fn(); },
      } as unknown as Animation;
    };
    let zone = document.querySelector('[data-zone="hand"]');
    if (!zone) { zone = document.createElement('div'); zone.setAttribute('data-zone', 'hand'); document.body.appendChild(zone); }
    const hand = document.createElement('div');
    hand.className = 'card spent';
    hand.setAttribute('data-uid', handUid);
    zone.appendChild(hand);
    const unit = document.createElement('div');
    unit.className = 'unit summoned';
    unit.setAttribute('data-uid', boardUid);
    const card = document.createElement('div');
    card.className = 'card';
    unit.appendChild(card);
    document.body.appendChild(unit);
    (unit as HTMLElement & { getAnimations: unknown }).getAnimations = () => [];
    for (const [el, r] of [[hand, { left: 300, top: 900, width: 120, height: 160 }], [card, { left: x, top: 400, width: 100, height: 140 }]] as const) {
      el.getBoundingClientRect = () => { rects.push(el === hand ? 'hand' : 'card'); return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON() {} } as DOMRect; };
      (el as HTMLElement & { animate: unknown }).animate = (kf: Keyframe[], opts: KeyframeAnimationOptions) => stubAnim(el, kf, opts);
      (el as HTMLElement & { getAnimations: unknown }).getAnimations = () => [];
    }
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = create(tag);
      (el as HTMLElement & { animate: unknown }).animate = (kf: Keyframe[], opts: KeyframeAnimationOptions) => stubAnim(el, kf, opts);
      return el;
    }) as typeof document.createElement);
    return { animated, rects, card, unit, hand };
  }

  it('hides the minion until it forms, starts the copy on the hand card, crossfades with overlap, lands once, tears down clean', () => {
    vi.useFakeTimers();
    const { animated, rects, card, unit, hand } = stage('h1', 'b1', 600);
    launchHandSummonFlights([{ handUid: 'h1', boardUid: 'b1', cardId: 'sp3_kindled' }], (uid) => (uid === 'b1' ? unit : null));
    expect(rects.sort(), 'each rect read once at launch').toEqual(['card', 'hand']);
    const form = animated.find((a) => a.el === card)!;
    expect(form.kf[0]).toMatchObject({ opacity: 0 });
    expect(form.kf[form.kf.length - 1]).toMatchObject({ opacity: 1, transform: 'scale(1.0000)' });
    expect(form.opts.fill, 'hidden through its delay').toBe('backwards');
    expect(form.opts.delay).toBe(HAND_SUMMON_DEFAULTS.appearAt);
    for (const k of form.kf) for (const key of Object.keys(k)) expect(['offset', 'opacity', 'transform']).toContain(key);
    const ghost = document.querySelector<HTMLElement>('.handsummon-ghost')!;
    const clone = ghost.querySelector('.card')!;
    expect(clone.hasAttribute('data-uid')).toBe(false);
    expect(clone.classList.contains('spent')).toBe(false);
    const fly = animated.find((a) => a.el === ghost)!;
    for (const k of fly.kf) for (const key of Object.keys(k)) expect(['offset', 'opacity', 'transform']).toContain(key);
    expect(fly.kf[0]).toMatchObject({ opacity: 1 });
    expect(fly.kf[fly.kf.length - 1]).toMatchObject({ opacity: 0 });
    // THE CROSSFADE, sampled in real time: never nothing on screen, never both solid.
    const opAt = (kf: Keyframe[], dur: number, delay: number, tMs: number): number => {
      const u = (tMs - delay) / dur;
      if (u <= 0) return Number(kf[0]!.opacity); if (u >= 1) return Number(kf[kf.length - 1]!.opacity);
      for (let i = 1; i < kf.length; i++) {
        const a = kf[i - 1]!, b = kf[i]!;
        if (u <= (b.offset as number)) { const k = (u - (a.offset as number)) / (((b.offset as number) - (a.offset as number)) || 1); return Number(a.opacity) + (Number(b.opacity) - Number(a.opacity)) * k; }
      }
      return Number(kf[kf.length - 1]!.opacity);
    };
    for (let tMs = 0; tMs <= handSummonDurationMs(); tMs += 5) {
      const g = opAt(fly.kf, fly.opts.duration as number, fly.opts.delay as number, tMs);
      const m = opAt(form.kf, form.opts.duration as number, form.opts.delay as number, tMs);
      expect(g + m, `something is visible at ${tMs} ms`).toBeGreaterThan(0.5);
      expect(g > 0.98 && m > 0.98, `never both solid at ${tMs} ms`).toBe(false);
    }
    // the real hand card is hidden under the copy, then comes back
    const handAnim = animated.find((a) => a.el === hand)!;
    expect(handAnim.kf[0]).toMatchObject({ opacity: 0 });
    expect(handAnim.kf[handAnim.kf.length - 1]).toMatchObject({ opacity: 1 });
    expect(isHandSummonInFlight('b1')).toBe(true);
    expect(handSummonRemainingMs()).toBeGreaterThan(0);
    vi.advanceTimersByTime(handSummonDurationMs());
    expect(fx.dust).toBe(1);
    expect(fx.dissolves, 'one landing pulse').toBe(1);
    expect(fx.sounds).toEqual(['sp3_kindled']);
    clearHandSummonFx();
    expect(document.querySelector('.handsummon-ghost')).toBeNull();
    expect(isHandSummonInFlight('b1')).toBe(false);
    expect(handSummonRemainingMs()).toBe(0);
  });

  it('a body whose beat already rang the summon sound lands silently', () => {
    vi.useFakeTimers();
    const { unit } = stage('h1', 'b1', 600);
    launchHandSummonFlights([{ handUid: 'h1', boardUid: 'b1', cardId: 'x' }], () => unit, { ownSound: () => false });
    vi.advanceTimersByTime(1000);
    expect(fx.sounds).toEqual([]);
  });

  it('degrades to the stock summon: no hand card on screen, or a Skip-speed replay, flies nothing', () => {
    const { animated, unit } = stage('h1', 'b1', 600);
    launchHandSummonFlights([{ handUid: 'missing', boardUid: 'b1' }], () => unit);
    launchHandSummonFlights([{ handUid: 'h1', boardUid: 'b1' }], () => unit, { speed: HAND_SUMMON_MAX_SPEED });
    expect(animated).toHaveLength(0);
    expect(document.querySelector('.handsummon-ghost')).toBeNull();
    expect(handSummonRemainingMs()).toBe(0);
  });

  it('two bodies on one frame launch left to right, a stagger apart', () => {
    const a = stage('h1', 'b1', 700);
    const b = stage('h2', 'b2', 300);
    launchHandSummonFlights([{ handUid: 'h1', boardUid: 'b1' }, { handUid: 'h2', boardUid: 'b2' }], (uid) => (uid === 'b1' ? a.unit : b.unit));
    const delayOf = (card: Element) => [...a.animated, ...b.animated].find((x) => x.el === card)!.opts.delay;
    const at = HAND_SUMMON_DEFAULTS.appearAt;
    expect(delayOf(b.card), 'the left-most body goes first').toBe(at);
    expect(delayOf(a.card)).toBe(HAND_SUMMON_STAGGER_MS + at);
  });

  it('the FROM point is a pluggable source per side: an enemy flight flies only once a source is registered', () => {
    const { animated, unit } = stage('h1', 'b1', 600);
    launchHandSummonFlights([{ handUid: 'e9', boardUid: 'b1', side: 'enemy' }], () => unit);
    expect(animated, 'no opponent hand yet: stock summon').toHaveLength(0);
    const anchor = document.createElement('div');
    anchor.className = 'card';
    const prev = setHandSummonSource('enemy', () => ({ el: anchor, cx: 100, cy: 80, w: 90, h: 120, rotateDeg: 0 }));
    try {
      launchHandSummonFlights([{ handUid: 'e9', boardUid: 'b1', side: 'enemy' }], () => unit);
      expect(document.querySelector('.handsummon-ghost')).toBeTruthy();
    } finally { setHandSummonSource('enemy', prev ?? null); }
  });

  it('the tuner applies LIVE: a value changed between two summons shapes the next one', () => {
    const { animated, card, unit } = stage('h1', 'b1', 600);
    setHandSummonValue('formFrom', 0.8);
    setHandSummonValue('appearAt', 50);
    launchHandSummonFlights([{ handUid: 'h1', boardUid: 'b1' }], () => unit);
    const form = animated.find((a) => a.el === card)!;
    expect(String(form.kf[0]!.transform)).toContain('scale(0.8000)');
    expect(form.opts.delay).toBe(50);
  });

  it('dust and sound can be switched off', () => {
    vi.useFakeTimers();
    setHandSummonValue('dust', 0);
    setHandSummonValue('sound', 0);
    const { unit } = stage('h1', 'b1', 600);
    launchHandSummonFlights([{ handUid: 'h1', boardUid: 'b1', cardId: 'x' }], () => unit);
    vi.advanceTimersByTime(1000);
    expect(fx.dust).toBe(0);
    expect(fx.sounds).toEqual([]);
  });
});
