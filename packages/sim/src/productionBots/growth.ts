import { CARD_INDEX, poolFor } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatResult, type CombatSideState } from '@game/core';
import type { Action } from '../state';
import { probeFuture, type ProbeSession } from './transition';
import type { BotCardView, BotMandatoryDecision, BotVisibleState } from './types';

/**
 * ENGINE GROWTH (balance bot B6, 2026-09-15) — what the board will GENERATE next turn, measured by running it.
 *
 * The diagnosis (docs/balance-bot.md, "The strategist pilot"): the recorded set-2 players' boards grow 21 → 60 →
 * 162 → 456 → 1,442 total stats over waves 4 → 12, and the pilot's 23 → 47 → 86 → 157 → 253. That curve is not
 * bodies; it is ENGINES — a card that pays +X every buy, every spell, every End of Turn, every summon — plus the
 * goldens they turn into. The one-turn evaluator values a body by the fight it wins NOW, so an engine card with a
 * small body loses to a vanilla body of the same tier every time, and the pilot never starts compounding.
 *
 * Rather than a hand-written table of "this factory yields that much" (which rots the day a card changes), the
 * term MEASURES growth empirically: for a candidate state it runs the engine forward on a private clone
 * (`transition.ts::probeFuture` — hidden future replaced by a per-decision panel seed, the lobby stripped, no fight
 * resolved) through ONE cheap scripted turn —
 *
 *   End of Turn fires (`faceOmen { deferFight }`)  →  the next turn starts with a neutral 0-damage draw
 *   (`resolveCombat`: start-of-turn grants, Gold refill, an imagined shop)  →  answer whatever the turn opens
 *   (a Discover, a quest, a forge: first option / skip)  →  field the hand  →  buy up to `MAX_BUYS` bodies of
 *   the board's dominant tribe and field them  →  buy + cast the spell offer if affordable  →  cast the spells
 *   the turn GENERATED (a Dwarf's Ale, a Kobold's Ruby — never a spell the pilot already held)
 *
 * — and reads the total board + hand stats before and after, NET of the printed stats of the bodies it bought.
 * What is left is what the engines produced: shop buffs folded into the offers, on-buy / on-play / on-summon /
 * per-spell / End-of-Turn / start-of-turn buffs, summoned tokens, generated cards, a triple's golden. A vanilla
 * body yields 0; a Demon shop-buff line, a per-spell scaler or an End-of-Turn drummer yields its real number, in
 * the real context (the tribe mix, the auras, the runes, the held pairs), with no per-card knowledge anywhere.
 *
 * The probe is deterministic in (state composition, panel seed) and memoised on exactly that, so the positioning
 * pass and the many nodes that share a composition pay once per turn. Cost is bounded by `MAX_STEPS` reducer
 * dispatches per probe.
 *
 * Boundary: this module reads projections only (`BotVisibleState`) and drives ordinary actions through the
 * session; it never sees a `RunState`, the real next shop, the served opponent or another seat.
 */

/** Bodies the script buys per probed turn. Two is what the pilot's economy affords at waves 5–9 with a refresh. */
export const MAX_BUYS = 3;
/** Spells / Rubies / Ales the probe casts from what the turn GENERATED (never what the pilot already held). */
const MAX_GENERATED_CASTS = 6;
/** Hard cap on reducer dispatches per probe, whatever the script wants. */
export const MAX_STEPS = 24;
/** The wave past which growth stops being credited (the lobby is ending); credit is linear in the turns left, capped at `CREDIT_TURNS`. */
export const GROWTH_HORIZON = 16;
export const CREDIT_TURNS = 6;

/** A wave's board-mass reference — the same linear "healthy board" the prior's mass term uses (`8 + 7·wave`). */
export const growthReference = (wave: number): number => Math.max(20, 8 + 7 * wave);

export interface GrowthProbe {
  /** Stats the engines generated over the probed turn: `after − before − bought`. */
  delta: number;
  /** Total board + hand-minion stats at the probed state. */
  before: number;
  /** The same total at the end of the scripted turn. */
  after: number;
  /** Printed base stats of the bodies the script bought (golden ×2), subtracted so a body is not its own growth. */
  bought: number;
  buys: number;
  casts: number;
  /** Reducer dispatches the probe spent. */
  steps: number;
  /** The Rally trial's permanent gain (`rallyTrial`), measured on the probed state. */
  trial: number;
}

/** The neutral fight the probe lands: a 0-damage draw with no events — the probe never learns how the real fight goes. */
const NEUTRAL_FIGHT: CombatResult = {
  result: 'draw', playerDamage: 0, enemyDamage: 0, playerDeaths: 0, enemyDeaths: 0, playerDeathrattles: 0,
  events: [], initial: { player: [], enemy: [] },
} as unknown as CombatResult;

const isBody = (c: Pick<BotCardView, 'cardId'>): boolean => {
  const def = CARD_INDEX[c.cardId];
  return !!def && !def.spell && !def.ruby;
};

/** Total stats of the board plus the minions in hand (a hand body is fielded by the script, so it counts in full). */
export function massOf(v: BotVisibleState): number {
  let n = 0;
  for (const c of v.board) n += c.attack + c.health;
  for (const c of v.hand) if (isBody(c)) n += c.attack + c.health;
  return n;
}

/** The first answer to a blocked run: first option, skip a forge, close a scout. The probe is not choosing well; it is moving on. */
function firstAnswer(m: BotMandatoryDecision): Action | null {
  switch (m.kind) {
    case 'discover': return m.options.length ? { type: 'discover', index: 0 } : null;
    case 'chooseOne': return m.options.length ? { type: 'chooseOne', index: 0 } : null;
    case 'battlecryTarget': return m.legalTargets.length ? { type: 'battlecryTarget', targetUid: m.legalTargets[0]! } : { type: 'cancelChoice' };
    case 'quest': return m.options.length ? { type: 'buyQuest', index: 0 } : null;
    case 'powerOffer': return m.options.length ? { type: 'pickPower', index: 0 } : null;
    case 'runeforge': return m.canSkip ? { type: 'skipRuneforge' } : m.options.length ? { type: 'buyRune', index: 0 } : null;
    case 'scout': return { type: 'closeScout' };
  }
}

/** The dominant non-neutral tribe of the board (ties by first seen), or null on an empty / neutral board. */
export function dominantTribe(v: BotVisibleState): string | null {
  const counts = new Map<string, number>();
  for (const c of v.board) {
    for (const t of [c.tribe, c.tribe2]) if (t && t !== 'neutral') counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [t, n] of counts) if (n > bestN) { best = t; bestN = n; }
  return best;
}

/** Drive one scripted turn on the session. Returns null when the turn could not even be ended. */
function script(p: ProbeSession, root: BotVisibleState): GrowthProbe | null {
  let steps = 0;
  const step = (a: Action): boolean => {
    if (steps >= MAX_STEPS) return false;
    steps++;
    return p.apply(a);
  };
  let v = root;
  const refresh = (): BotVisibleState => (v = p.visible());
  /** Answer whatever the run is blocked on, a few times over; false when it stays blocked. */
  const unblock = (): boolean => {
    for (let guard = 0; guard < 6; guard++) {
      const m = v.mandatoryDecision;
      if (!m) return true;
      const a = firstAnswer(m);
      if (!a || !step(a)) return false;
      refresh();
    }
    return !v.mandatoryDecision;
  };

  const before = massOf(root);
  const rootHand = new Set(root.hand.map((c) => c.uid));
  let casts = 0;
  let buys = 0;
  let bought = 0;
  if (root.phase !== 'recruit') return null;
  if (!unblock()) return null;
  // END OF TURN — fires the board's End-of-Turn engines and prepares the side; no fight is resolved.
  if (!step({ type: 'faceOmen', deferFight: true })) return null;
  // NEXT TURN — the neutral draw lands, start-of-turn grants fire, Gold refills, an imagined shop is drawn.
  if (!step({ type: 'resolveCombat', fight: { result: NEUTRAL_FIGHT, damageTaken: 0 } })) return null;
  refresh();
  if (!unblock()) return finish();
  if (v.phase !== 'recruit') return finish();

  // FIELD THE HAND — every body while there is room (on-play / on-summon / tribe engines fire here).
  for (const c of [...v.hand]) {
    if (v.board.length >= 7) break;
    if (!isBody(c)) continue;
    if (!step({ type: 'play', uid: c.uid, toIndex: v.board.length })) continue;
    refresh();
    if (!unblock()) return finish();
  }

  // BUY AND FIELD — up to MAX_BUYS bodies, the dominant tribe first, cheapest first (on-buy engines + the shop buff).
  const tribe = dominantTribe(v);
  for (let i = 0; i < MAX_BUYS; i++) {
    refresh();
    if (v.hand.length >= 10) break;
    const offers = v.shop
      .filter((o) => !o.spell && !o.ruby && o.cost <= v.economy.gold && o.uid !== v.starform?.uid)
      .sort((a, b) => {
        const ta = tribe && (a.tribe === tribe || a.tribe2 === tribe) ? 1 : 0;
        const tb = tribe && (b.tribe === tribe || b.tribe2 === tribe) ? 1 : 0;
        return tb - ta || a.cost - b.cost || b.tier - a.tier;
      });
    const o = offers[0];
    if (!o) break;
    const beforeHand = new Set(v.hand.map((c) => c.uid));
    if (!step({ type: 'buy', uid: o.uid })) break;
    buys++;
    const def = CARD_INDEX[o.cardId];
    bought += def ? (def.attack + def.health) * (o.golden ? 2 : 1) : o.attack + o.health;
    refresh();
    if (!unblock()) return finish();
    if (v.board.length >= 7) continue;
    const inHand = v.hand.find((c) => !beforeHand.has(c.uid) && isBody(c));
    if (!inHand) continue; // a triple combined it away, or it was not a body
    if (step({ type: 'play', uid: inHand.uid, toIndex: v.board.length })) { refresh(); if (!unblock()) return finish(); }
  }

  // THE SPELL OFFER — bought and cast once, if affordable (spell engines with nothing in hand still get one cast).
  refresh();
  const spell = v.spellOffer;
  if (spell && spell.cost <= v.economy.gold && v.hand.length < 10) {
    const beforeHand = new Set(v.hand.map((c) => c.uid));
    if (step({ type: 'buy', uid: spell.uid })) {
      refresh();
      const held = v.hand.find((c) => !beforeHand.has(c.uid));
      if (held && castSpell(held.uid)) { casts++; refresh(); unblock(); }
    }
  }

  // CAST WHAT THE TURN GENERATED — spells / Rubies / Ales that arrived DURING the probe (a Kobold's Ruby, a Dwarf's
  // Ale, a triple's reward) are the engine's output and are cast at their value. Spells the pilot ALREADY held are
  // never cast here: crediting a held spell's future cast would reward hoarding it over casting it now (measured
  // 2026-09-15: the pilot sat on six Rubies while the probe cashed them every turn).
  refresh();
  for (const c of [...v.hand]) {
    if (casts >= MAX_GENERATED_CASTS) break;
    if (rootHand.has(c.uid) || isBody(c)) continue;
    if (castSpell(c.uid)) { casts++; refresh(); if (!unblock()) return finish(); }
  }
  return finish();

  function castSpell(uid: string): boolean {
    if (step({ type: 'play', uid })) return true;
    for (const t of v.board) if (step({ type: 'play', uid, targetUid: t.uid })) return true;
    return false;
  }
  function finish(): GrowthProbe {
    const after = massOf(p.visible());
    return { delta: after - before - bought, before, after, bought, buys, casts, steps, trial: rallyTrial(root) };
  }
}

/**
 * The composition the probe depends on — everything that changes what the engines do next turn, and nothing
 * that does not (Gold this turn, positions, the current shop unless frozen). Two states with the same key share
 * one probe.
 */
export function growthKey(v: BotVisibleState): string {
  const card = (c: BotCardView): unknown[] => [c.cardId, c.golden ? 1 : 0, c.attack, c.health, c.summonBonus ?? 0, c.spellProgress ?? 0, c.hpGrantBonus ?? 0, c.soldProgress ?? 0, c.attachments ?? 0];
  return JSON.stringify([
    v.wave, v.economy.tier, v.economy.maxGold, v.hero.heroId, v.hero.powerReady,
    v.board.map(card), v.hand.map(card), v.runes, v.auras, v.runCounters,
    v.quests, v.equipment.map((e) => e.equipmentId), v.frozen ? v.shop.map((o) => o.cardId) : 0,
  ]);
}

/** Probes memoised on (composition, panel seed). Bounded: cleared when it outgrows `CACHE_LIMIT`. */
const CACHE = new Map<string, GrowthProbe | null>();
const CACHE_LIMIT = 20_000;
let PROBES = 0;
let HITS = 0;

/** Counters for the performance gate (probes actually run vs. cache hits). */
export const growthStats = (): { probes: number; hits: number; cached: number } => ({ probes: PROBES, hits: HITS, cached: CACHE.size });
export function resetGrowthCache(): void { CACHE.clear(); PROBES = 0; HITS = 0; }

/**
 * Measure `v`'s growth over one probed turn under `panelSeed`. Null when the state cannot be probed (no state
 * behind the projection, or the turn could not be ended — an open prompt the script cannot answer).
 */
export function probeGrowth(v: BotVisibleState, panelSeed: number): GrowthProbe | null {
  const key = `${panelSeed}|${growthKey(v)}`;
  const hit = CACHE.get(key);
  if (hit !== undefined) { HITS++; return hit; }
  if (CACHE.size >= CACHE_LIMIT) CACHE.clear();
  PROBES++;
  const probe = probeFuture(v, panelSeed, (p) => script(p, v));
  CACHE.set(key, probe);
  return probe;
}

/**
 * COMBAT CARRY-BACK — the stats a fight leaves on the run PERMANENTLY, read off the engine's own result (the
 * fields `settleCombat` applies): Engraved / Flowing Monk gains kept on the board, hand buffs, run-wide card-type
 * buffs, plus the run-wide CHANNELS a fight raises (the Shop buff, Spell Power, the Ruby bonus, the tribe buy
 * auras, the next-shop buff), each valued at `CHANNEL_USES` future uses, and generated cards (Rubies, hand grants)
 * at a flat body's worth. This is the other half of the recorded players' curve — Rally + Engraved Dragons,
 * Chorus Drake's spell power, Demon Horse's Shop buff — which the probe's neutral draw cannot see but every
 * `fightScore` fight already computes. Zero for a fight that leaves nothing behind.
 */
export const CHANNEL_USES = 4;
const GENERATED_CARD_STATS = 6;
export function carryBackOf(r: CombatResult, v: BotVisibleState): number {
  let n = 0;
  if (r.playerPermaBuffs) for (const b of r.playerPermaBuffs) n += b.attack + b.health;
  if (r.playerHandBuffs) for (const b of r.playerHandBuffs) n += b.attack + b.health;
  if (r.playerCardBuffs) {
    for (const b of r.playerCardBuffs) {
      const copies = v.board.filter((c) => c.cardId === b.cardId).length + v.hand.filter((c) => c.cardId === b.cardId).length;
      n += (b.attack + b.health) * copies;
    }
  }
  const channel = (x: { attack: number; health: number } | undefined): number => (x ? (x.attack + x.health) * CHANNEL_USES : 0);
  n += channel(r.playerTavernBuyGain) + channel(r.playerSpellPower) + channel(r.playerRubyBonusGain) + channel(r.playerNextShopBuff) + channel(r.playerSpellEscalationGain);
  n += ((r.playerBeastBuyAtkGain ?? 0) + (r.playerBeastBuyHpGain ?? 0) + (r.playerUndeadBuyAtkGain ?? 0)) * CHANNEL_USES;
  n += ((r.playerRubyGrants ?? 0) + (r.playerHandGrants?.length ?? 0) + (r.playerSlaughterCopy ? 1 : 0)) * GENERATED_CARD_STATS;
  return n;
}

/**
 * THE RALLY TRIAL — what the board's COMBAT engines leave behind when its minions actually get to attack.
 *
 * The panel fights (`fightScore`) report the carry-back a fight against the wave's real population leaves, and
 * for a board the field outgrows that is 0: its minions die before they swing, so a Rally engine (Standard
 * Bearer, Paragon, Chorus Drake, Hungerling — the cards on every recorded late board) reads as a small body.
 * That is the chicken-and-egg the diagnosis names: the engine only pays once the board survives, and the board
 * only grows through the engine. The trial breaks it by fighting a WALL — seven 0-Attack bodies whose total
 * Health is `WALL_ROUNDS` × the board's total Attack, so every friendly minion swings about `WALL_ROUNDS` times and
 * nothing dies — and reading the permanent gains that fight leaves (`carryBackOf`). Deterministic (fixed seed),
 * one `simulate()` per composition, memoised with the probe. An empty board yields 0.
 */
const WALL_ROUNDS = 2;
const WALL_SEED = 0x7a11;
export function rallyTrial(v: BotVisibleState): number {
  if (v.friendly.bodies.length === 0) return 0;
  const bodies: BoardMinion[] = v.friendly.bodies.map((m) => ({ ...m, keywords: [...(m.keywords ?? [])] }));
  const totalAttack = bodies.reduce((n, m) => n + Math.max(0, m.attack), 0);
  if (totalAttack === 0) return 0;
  const hp = Math.max(1, Math.ceil((WALL_ROUNDS * totalAttack) / 7));
  const wall: BoardMinion[] = Array.from({ length: 7 }, () => ({ cardId: 'stray', attack: 0, health: hp, keywords: [] }));
  const poolIds = poolFor(v.setId).all.map((c) => c.id);
  const mySide: CombatSideState = { ...v.friendly.side, poolIds };
  const r = simulate(bodies, wall, makeRng(WALL_SEED), CARD_INDEX, mySide, combatSide({ tier: v.economy.tier, poolIds }));
  return carryBackOf(r, v);
}

/**
 * The NORMALISED growth term for the evaluator: one turn's engine yield — the probed recruit-phase yield plus
 * `carryBack` (the mean permanent gain the panel fights left, from `fightScore`) — relative to a healthy board at
 * this wave, credited by the turns left to cash it in (full credit with ≥ `CREDIT_TURNS` turns before
 * `GROWTH_HORIZON`). Clamped to [-0.5, 2.5]; the probe half is 0 when nothing can be probed.
 */
export function growthTermOf(v: BotVisibleState, panelSeed: number, carryBack = 0): number {
  const probe = probeGrowth(v, panelSeed);
  // Combat engines: the REALISED carry-back of the panel fights, or the trial's potential when the panel leaves
  // nothing (the field outgrew the board) — never both.
  const combat = Math.max(carryBack, probe?.trial ?? 0);
  const delta = (probe?.delta ?? 0) + combat;
  if (delta === 0) return 0;
  const remaining = Math.max(1, Math.min(CREDIT_TURNS, GROWTH_HORIZON - v.wave));
  const perTurn = Math.max(-0.5, Math.min(2.5, delta / growthReference(v.wave)));
  return perTurn * (remaining / CREDIT_TURNS);
}

// ───────────────────────────────────────────── the scope ─────────────────────────────────────────────

export interface GrowthScope { weight: number; panelSeed: number }
let ACTIVE: GrowthScope | null = null;

/** Run `fn` with the growth term installed at `weight` under `panelSeed` (one seed per decision, so every
 *  candidate is probed against the same imagined future). Scoped like `withEvaluationPrior`. */
export function withGrowth<T>(scope: GrowthScope | null, fn: () => T): T {
  const prev = ACTIVE;
  ACTIVE = scope && scope.weight !== 0 ? scope : null;
  try { return fn(); } finally { ACTIVE = prev; }
}

export const activeGrowth = (): GrowthScope | null => ACTIVE;
