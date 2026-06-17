import { makeRng, type CardDef, type Keyword } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { CONFIG } from './config';
import type { BoardCard, RunState } from './state';

/**
 * The recruit-phase half of the effect system (handoff C.5), split across the
 * Battlegrounds buy → hand → play flow:
 *   buy  → card enters the hand; buy-triggers fire (Brightwing Broker)  → `applyOnBuy`
 *   play → card enters the board; summon-buffs fire (Kennelmaster /
 *          Bristleback Matron), then the card's own Battlecry             → `playCard`
 * Results bake straight into the board's stats, so by the time the player faces
 * the Omen each minion is a resolved stat block — combat then only deals with the
 * combat keywords (A.3).
 *
 * Same `EffectDef` data, two execution surfaces: `buffOnSummon` lives here (for
 * recruit summons) AND in `@game/core` (for combat summons like Deathrattles).
 */

interface RecruitContext {
  state: RunState;
  summon(card: CardDef, nearUid: string): BoardCard | undefined;
}

type RecruitFn = (
  ctx: RecruitContext,
  self: BoardCard,
  params: Record<string, unknown>,
  payload: { minion: BoardCard },
) => void;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Tripled minions bake their recruit buffs in at doubled magnitude. */
const gold = (c: BoardCard): number => (c.golden ? 2 : 1);

const RECRUIT_FACTORIES: Partial<Record<string, RecruitFn>> = {
  /** Brightwing Broker: every minion you buy gets +atk/+hp (not itself). */
  buffOnBuy: (_ctx, self, params, { minion }) => {
    if (minion === self) return;
    minion.attack += num(params.attack) * gold(self);
    minion.health += num(params.health) * gold(self);
  },

  /** Kennelmaster / Bristleback Matron: buff each summoned friend of `tribe`. Kennelmaster's
   *  Avenge improvements (`self.summonBonus`, persisted on the board card) raise the magnitude. */
  buffOnSummon: (_ctx, self, params, { minion }) => {
    if (minion === self) return;
    const tribe = str(params.tribe);
    if (tribe && tribe !== 'any' && minion.tribe !== tribe) return;
    const bonus = self.summonBonus ?? 0;
    minion.attack += (num(params.attack) + bonus) * gold(self);
    minion.health += (num(params.health) + bonus) * gold(self);
  },

  /** Dragon Battlecries: buff your (optionally other) minions of `tribe`. */
  battlecryBuffTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const attack = num(params.attack) * gold(self);
    const health = num(params.health) * gold(self);
    const includeSelf = params.includeSelf !== false;
    for (const card of ctx.state.board) {
      if (card.tribe !== tribe) continue;
      if (!includeSelf && card === self) continue;
      card.attack += attack;
      card.health += health;
    }
  },

  /** Alleycur: Battlecry summon `count` copies of a token beside self. */
  battlecrySummon: (ctx, self, params) => {
    const token = CARD_INDEX[str(params.tokenId)];
    if (!token) return;
    const count = num(params.count, 1);
    for (let i = 0; i < count; i++) ctx.summon(token, self.uid);
  },

  /** Toxin Tender / Plaguebringer: grant keyword(s) to your highest-attack other minion (the carry). */
  battlecryGrantKeyword: (ctx, self, params) => {
    const kws = Array.isArray(params.keywords) ? (params.keywords as Keyword[]) : [];
    if (kws.length === 0) return;
    // Only consider minions missing at least one granted keyword — never waste
    // the grant on a minion that already has the effect (e.g. don't re-Poison).
    const lacks = (c: BoardCard): boolean => kws.some((k) => !c.keywords.includes(k));
    const others = ctx.state.board.filter((c) => c !== self && lacks(c));
    const pool = others.length > 0 ? others : lacks(self) ? [self] : [];
    if (pool.length === 0) return; // everyone already has it
    const target = pool.reduce((a, b) => (b.attack > a.attack ? b : a));
    for (const k of kws) if (!target.keywords.includes(k)) target.keywords.push(k);
  },

  // --- Demons (Consume, recruit-resolved: bakes into stats before combat) ---

  /** Soulfeeder: Battlecry — queue Fodder (Fred) into the *next* tavern refresh (golden adds 2). */
  battlecryAddTavernFodder: (ctx, self, params) => {
    const count = num(params.count, 1) * gold(self);
    const id = str(params.tokenId) || 'fred';
    (ctx.state.pendingTavern ??= []).push(...Array(count).fill(id));
  },

  /** Pactstone Acolyte / Ravening Glutton: on any friendly consume, grow. */
  onConsumeBuffSelf: (_ctx, self, params) => {
    self.attack += num(params.attack) * gold(self);
    self.health += num(params.health) * gold(self);
  },

  /** Maw of the Pit: on any friendly consume, gain a keyword (a Divine Shield). */
  onConsumeGrantSelfKeyword: (_ctx, self, params) => {
    const kw = str(params.keyword) as Keyword;
    if (kw && !self.keywords.includes(kw)) self.keywords.push(kw);
  },

  /** End of Turn: buff self (+atk/+hp) when the recruit turn ends. */
  endOfTurnBuff: (_ctx, self, params) => {
    self.attack += num(params.attack) * gold(self);
    self.health += num(params.health) * gold(self);
  },

  // --- Deathrattles that can also resolve out of combat (e.g. when Consumed). The
  //     combat versions live in @game/core; these bake into the board's stats. Out
  //     of combat there's no RNG, so "random" picks become the highest-Attack carry. ---

  /** Deathrattle: summon `count` copies of a token. */
  deathrattleSummon: (ctx, self, params) => {
    const token = CARD_INDEX[str(params.tokenId)];
    if (!token) return;
    for (let i = 0; i < num(params.count, 1) * gold(self); i++) ctx.summon(token, self.uid);
  },

  /** Deathrattle: buff all friends of `tribe` (+atk/+hp). */
  deathrattleBuffTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const a = num(params.attack) * gold(self);
    const h = num(params.health) * gold(self);
    for (const c of ctx.state.board) {
      if (c !== self && (tribe === 'any' || c.tribe === tribe)) {
        c.attack += a;
        c.health += h;
      }
    }
  },

  /** Deathrattle: buff the carry (+atk/+hp) — "random" friend out of combat. */
  deathrattleBuffRandom: (ctx, self, params) => {
    const friends = ctx.state.board.filter((c) => c !== self);
    if (friends.length === 0) return;
    const t = friends.reduce((a, b) => (b.attack > a.attack ? b : a));
    t.attack += num(params.attack) * gold(self);
    t.health += num(params.health) * gold(self);
  },

  /** Deathrattle: give the carry a Divine Shield. */
  deathrattleGrantShield: (ctx, self) => {
    const pool = ctx.state.board.filter((c) => c !== self && !c.keywords.includes('DS'));
    if (pool.length === 0) return;
    const t = pool.reduce((a, b) => (b.attack > a.attack ? b : a));
    t.keywords.push('DS');
  },

  // --- Spells ---

  /** Spirit Fire / Bulwark — cast: buff the chosen target +atk/+hp, and grant an optional
   *  keyword (`self` is the target). */
  spellBuffTarget: (_ctx, self, params) => {
    self.attack += num(params.attack);
    self.health += num(params.health);
    const kw = str(params.keyword);
    if (kw && !self.keywords.includes(kw as Keyword)) self.keywords.push(kw as Keyword);
  },

  /** A minion casts a named spell from an event, auto-targeting the carry (the
   *  highest-attack friend). Counts the cast but doesn't re-fire spellCast (no recursion). */
  castSpell: (ctx, self, params) => {
    const spellDef = CARD_INDEX[str(params.spellId)];
    if (!spellDef) return;
    const friends = ctx.state.board.filter((c) => c !== self);
    const target = friends.length ? friends.reduce((a, b) => (b.attack > a.attack ? b : a)) : self;
    applyCastEffects(ctx, spellDef, target);
    ctx.state.spellsCast += 1;
  },
};

/** Apply a spell's `cast` effects to its chosen target. */
function applyCastEffects(ctx: RecruitContext, spellDef: CardDef, target: BoardCard): void {
  for (const effect of spellDef.effects) {
    if (effect.on !== 'cast') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) fn(ctx, target, effect.params ?? {}, { minion: target });
  }
}

/** Fire a board-wide recruit trigger (`onBuy` / `onSummon`). */
function fire(
  ctx: RecruitContext,
  event: 'onBuy' | 'onSummon' | 'onConsume',
  payload: { minion: BoardCard },
): void {
  // Snapshot: a handler may summon, which mutates the board.
  for (const card of [...ctx.state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.on !== event) continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (fn) fn(ctx, card, effect.params ?? {}, payload);
    }
  }
}

function makeContext(state: RunState): RecruitContext {
  const ctx: RecruitContext = {
    state,
    summon: (card, nearUid) => {
      if (state.board.length >= CONFIG.boardMax) return undefined;
      const minion: BoardCard = {
        uid: `b${state.uidSeq++}`,
        cardId: card.id,
        tribe: card.tribe,
        attack: card.attack,
        health: card.health,
        keywords: [...card.keywords],
        golden: false,
      };
      const near = state.board.findIndex((x) => x.uid === nearUid);
      state.board.splice(near >= 0 ? near + 1 : state.board.length, 0, minion);
      fire(ctx, 'onSummon', { minion });
      return minion;
    },
  };
  return ctx;
}

/** Buy-triggers (Brightwing Broker) — fire when a card is purchased into the hand. */
export function applyOnBuy(state: RunState, bought: BoardCard): void {
  const ctx = makeContext(state);
  fire(ctx, 'onBuy', { minion: bought });
}

/** A Demon's stat multiplier when it eats Fodder (Voracious Imp = 2, golden = 3). */
function fodderMultiplier(consumer: BoardCard): number {
  const base = CARD_INDEX[consumer.cardId]?.fodderMult ?? 1;
  if (base <= 1) return 1;
  return consumer.golden ? base + 1 : base;
}

/**
 * Demons devour Fodder sitting in the tavern. Called right after a tavern refresh
 * adds Fodder: if you have any Demon on board, each Fodder is eaten by one *random*
 * Demon (2 Demons + 1 Fodder → a coin-flip who eats it). The eater gains the fodder's
 * stats × its multiplier and fires its on-consume effects (Pactstone / Maw / Glutton) —
 * the normal Consume pipeline. Eaten Fodder leaves the tavern. With no Demon on board
 * the Fodder simply stays (buyable). Per the rule, only Fodder *entering* the tavern is
 * checked — placing a Demon next to existing tavern Fodder does not trigger it.
 */
export function consumeTavernFodder(state: RunState): void {
  state.fodderEaten = [];
  const demons = state.board.filter((c) => c.tribe === 'demon');
  if (demons.length === 0) return;
  const rng = makeRng(state.rngCursor);
  const ctx = makeContext(state);
  const eaten: { eaterUid: string; fodderId: string }[] = [];
  for (let i = state.shop.length - 1; i >= 0; i--) {
    const offer = state.shop[i]!;
    const fodder = CARD_INDEX[offer.cardId];
    if (!fodder || !fodder.keywords.includes('FD')) continue;
    const eater = demons[rng.int(demons.length)]!;
    state.shop.splice(i, 1); // eaten — leaves the tavern
    const mult = fodderMultiplier(eater);
    eater.attack += fodder.attack * mult;
    eater.health += fodder.health * mult;
    fire(ctx, 'onConsume', { minion: eater }); // Pactstone / Maw / Glutton pay off
    eaten.push({ eaterUid: eater.uid, fodderId: fodder.id });
  }
  state.rngCursor = rng.state();
  // Record the consume for the UI to replay (show the Fodder, swirl it into the eater).
  if (eaten.length > 0) {
    state.fodderEaten = eaten;
    state.fodderEatenSeq += 1;
  }
}

/**
 * Cast a spell from the hand (handoff: spells). Resolves its `cast` effects on the
 * chosen target, tallies the cast, and notifies spell-tracking minions (`spellCast`).
 */
export function castSpell(state: RunState, spellDef: CardDef, target?: BoardCard): void {
  const ctx = makeContext(state);
  if (target) applyCastEffects(ctx, spellDef, target);
  // Untargeted "run" cast effects (e.g. Ember Pouch) act on the run, not a minion.
  // Embers are uncapped within a turn (like selling), so no max-embers clamp here.
  for (const effect of spellDef.effects) {
    if (effect.on === 'cast' && effect.do === 'gainEmbers') state.embers += num(effect.params?.amount);
  }
  state.spellsCast += 1;
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.on !== 'spellCast') continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (fn) fn(ctx, card, effect.params ?? {}, { minion: card });
    }
  }
}

/** End-of-Turn triggers — fire when the recruit turn ends (End Turn / timer hits 0),
 *  just before the board faces the Omen. Each minion's effect acts on itself. */
export function applyEndOfTurn(state: RunState): void {
  const ctx = makeContext(state);
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.on !== 'endOfTurn') continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (fn) fn(ctx, card, effect.params ?? {}, { minion: card });
    }
  }
}

/**
 * Resolve a card's play-time effects, mutating the board in place. Call after the
 * card has been moved from the hand onto `state.board`. Summon-buffs fire first
 * (the played card has just entered), then its own Battlecry — whose summoned
 * tokens in turn fire their own summon-buffs.
 */
export function playCard(state: RunState, played: BoardCard): void {
  const ctx = makeContext(state);
  fire(ctx, 'onSummon', { minion: played });
  const def = CARD_INDEX[played.cardId];
  if (!def) return;
  // Doublecast Drummer: each one on the board makes Battlecries fire one extra time.
  const drummers = state.board.filter((c) => c.cardId === 'drummer').length;
  const repeats = 1 + drummers;
  for (const effect of def.effects) {
    if (effect.on !== 'onPlay') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    for (let r = 0; r < repeats; r++) fn(ctx, played, effect.params ?? {}, { minion: played });
  }
}
