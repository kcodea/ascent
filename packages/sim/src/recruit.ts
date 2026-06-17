import type { CardDef, Keyword } from '@game/core';
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
  /** Demon Consume: destroy `victim`, fold its stats into `consumer`, fire `onConsume`. */
  consume(consumer: BoardCard, victim: BoardCard): void;
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

  /** Kennelmaster / Bristleback Matron: buff each summoned friend of `tribe`. */
  buffOnSummon: (_ctx, self, params, { minion }) => {
    if (minion === self) return;
    const tribe = str(params.tribe);
    if (tribe && tribe !== 'any' && minion.tribe !== tribe) return;
    minion.attack += num(params.attack) * gold(self);
    minion.health += num(params.health) * gold(self);
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

  /** Soulfeeder: Battlecry — destroy your weakest other friend and add its stats. */
  battlecryConsume: (ctx, self) => {
    const others = ctx.state.board.filter((c) => c !== self);
    if (others.length === 0) return;
    const victim = others.reduce((a, b) => (b.attack + b.health < a.attack + a.health ? b : a));
    ctx.consume(self, victim);
  },

  /** Voracious Imp: when a **Fodder**-keyword minion (or any token) is played/summoned
   *  beside it, eat it. Keying off the keyword lets any future card mark itself Fodder. */
  consumeFodderOnSummon: (ctx, self, _params, { minion }) => {
    if (minion === self) return;
    if (!minion.keywords.includes('FD') && !CARD_INDEX[minion.cardId]?.token) return;
    ctx.consume(self, minion);
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

  /** Spirit Fire — cast: buff the chosen target +atk/+hp (`self` is the target). */
  spellBuffTarget: (_ctx, self, params) => {
    self.attack += num(params.attack);
    self.health += num(params.health);
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

/** Run a destroyed minion's own Deathrattle out of combat (it was Consumed/destroyed). */
function fireDeathrattle(ctx: RecruitContext, victim: BoardCard): void {
  const def = CARD_INDEX[victim.cardId];
  if (!def) return;
  for (const effect of def.effects) {
    if (effect.on !== 'onDeath') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) fn(ctx, victim, effect.params ?? {}, { minion: victim });
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
    consume: (consumer, victim) => {
      const i = state.board.indexOf(victim);
      if (i < 0) return;
      state.board.splice(i, 1);
      consumer.attack += victim.attack;
      consumer.health += victim.health;
      // Deathrattle fires out of combat too — the consumed minion was destroyed.
      fireDeathrattle(ctx, victim);
      fire(ctx, 'onConsume', { minion: consumer });
    },
  };
  return ctx;
}

/** Buy-triggers (Brightwing Broker) — fire when a card is purchased into the hand. */
export function applyOnBuy(state: RunState, bought: BoardCard): void {
  const ctx = makeContext(state);
  fire(ctx, 'onBuy', { minion: bought });
}

/**
 * Cast a spell from the hand (handoff: spells). Resolves its `cast` effects on the
 * chosen target, tallies the cast, and notifies spell-tracking minions (`spellCast`).
 */
export function castSpell(state: RunState, spellDef: CardDef, target?: BoardCard): void {
  const ctx = makeContext(state);
  if (target) applyCastEffects(ctx, spellDef, target);
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
