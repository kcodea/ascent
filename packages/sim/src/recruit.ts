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
    const others = ctx.state.board.filter((c) => c !== self);
    const target = (others.length > 0 ? others : [self]).reduce((a, b) => (b.attack > a.attack ? b : a));
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

  /** Voracious Imp: when a Fodder token is summoned to your board, eat it. */
  consumeFodderOnSummon: (ctx, self, _params, { minion }) => {
    if (minion === self) return;
    if (!CARD_INDEX[minion.cardId]?.token) return;
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
};

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
  for (const effect of def.effects) {
    if (effect.on !== 'onPlay') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) fn(ctx, played, effect.params ?? {}, { minion: played });
  }
}
