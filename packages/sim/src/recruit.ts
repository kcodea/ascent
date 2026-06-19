import { makeRng, type CardDef, type Keyword } from '@game/core';
import { BUYABLE_CARDS, CARD_INDEX } from '@game/content';
import { CONFIG } from './config';
import { mixSeed, TAG, type BoardCard, type RunState } from './state';
import { takeFromPool } from './shop';

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
  /** `proc` is the repeat index of this End-of-Turn trigger (0-based; Chronos drives extras) — used
   *  to vary a per-proc random selection (Combinator) so each weld picks fresh Mechs. `target` is the
   *  player-chosen friendly minion for a targeted Battlecry (Toxin Tender); absent = auto-pick. */
  payload: { minion: BoardCard; proc?: number; target?: BoardCard },
) => void;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Tripled minions bake their recruit buffs in at doubled magnitude. */
const gold = (c: BoardCard): number => (c.golden ? 2 : 1);
/** A card's display name (the buff-source label in the inspect breakdown). */
const nameOf = (card: BoardCard): string => CARD_INDEX[card.cardId]?.name ?? card.cardId;

/**
 * Apply a recruit-phase stat buff to a card AND record its source for the inspect-panel breakdown
 * ("Spirit Fire ×2: +6/+6"). Pass `count` (default 1) for how many times the source applied. Pure
 * keyword grants (0/0) mutate nothing here and aren't listed. Base stats are never recorded.
 */
export function addBuff(card: BoardCard, source: string, attack: number, health: number, count = 1): void {
  card.attack += attack;
  card.health += health;
  if (attack === 0 && health === 0) return;
  card.buffs ??= [];
  const e = card.buffs.find((b) => b.source === source);
  if (e) { e.attack += attack; e.health += health; e.count += count; }
  else card.buffs.push({ source, attack, health, count });
}

/**
 * The persistent per-cardId run buff (Ritualist enchants all Fodder). Applied to *every* new
 * instance of the card — bought, summoned, conjured, discovered — and read live by the tavern
 * display, so a copy from any source carries the accrued buff. Optional-chained for old saves.
 */
export function cardBuff(state: RunState, cardId: string): { attack: number; health: number } {
  return state.cardBuffs?.[cardId] ?? { attack: 0, health: 0 };
}

/**
 * Total bonus max-mana-per-turn the board currently grants (Money Bot, or a Mech it magnetized
 * into). Each card contributes its def's `manaPerTurn` (×2 if golden) plus any absorbed `manaBonus`.
 * Summed fresh from the board each turn, so selling the source removes its income.
 */
export function boardManaBonus(state: RunState): number {
  return state.board.reduce((sum, c) => {
    const per = CARD_INDEX[c.cardId]?.manaPerTurn ?? 0;
    return sum + per * (c.golden ? 2 : 1) + (c.manaBonus ?? 0);
  }, 0);
}

/**
 * Pick up to `count` distinct friendly **Mech** uids for a Combinator weld — chosen at *random*, not
 * by Attack. Seeded by (run seed, wave, the Combinator's board `slot`, `proc`), so the selection is
 * unpredictable yet reproducible: each proc welds onto a fresh random set, and the UI can derive the
 * exact same uids (to electrify them) without the sim having to resolve first. Excludes `selfUid`;
 * dual-type Mechs (Heckbinder) count. Does not mutate `board`.
 */
export function magnetizeTargets(
  board: BoardCard[],
  selfUid: string,
  count: number,
  seed: number,
  wave: number,
  slot: number,
  proc: number,
): string[] {
  const eligible = board.filter(
    (c) => c.uid !== selfUid && (c.tribe === 'mech' || CARD_INDEX[c.cardId]?.tribe2 === 'mech'),
  );
  const rng = makeRng(mixSeed(seed, wave, TAG.MAGNET, slot, proc));
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = rng.int(i + 1); // Fisher-Yates with the seeded RNG
    const tmp = eligible[i]!;
    eligible[i] = eligible[j]!;
    eligible[j] = tmp;
  }
  return eligible.slice(0, count).map((c) => c.uid);
}

const RECRUIT_FACTORIES: Partial<Record<string, RecruitFn>> = {
  /** Brightwing Broker: every minion you buy gets +atk/+hp (not itself). */
  buffOnBuy: (_ctx, self, params, { minion }) => {
    if (minion === self) return;
    addBuff(minion, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
  },

  /** Kennelmaster / Bristleback Matron: buff each summoned friend of `tribe`. The magnitude is
   *  the base buff + `self.summonBonus` (Avenge / triple-combined). No golden doubling — a
   *  golden's bonus already encodes the combined magnitude (see checkTriples). */
  buffOnSummon: (_ctx, self, params, { minion }) => {
    if (minion === self) return;
    const tribe = str(params.tribe);
    if (tribe && tribe !== 'any' && minion.tribe !== tribe) return;
    const bonus = self.summonBonus ?? 0;
    addBuff(minion, nameOf(self), num(params.attack) + bonus, num(params.health) + bonus);
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
      addBuff(card, nameOf(self), attack, health);
    }
  },

  /** Alleycur: Battlecry summon `count` copies of a token beside self. */
  battlecrySummon: (ctx, self, params) => {
    const token = CARD_INDEX[str(params.tokenId)];
    if (!token) return;
    const count = num(params.count, 1);
    for (let i = 0; i < count; i++) ctx.summon(token, self.uid);
  },

  /** Toxin Tender / Plaguebringer: grant keyword(s) to a friendly minion. Toxin Tender is
   *  player-targeted (`payload.target` is the chosen minion); Plaguebringer auto-picks the
   *  highest-attack friend that still lacks a granted keyword (never wasting it). */
  battlecryGrantKeyword: (ctx, self, params, payload) => {
    const kws = Array.isArray(params.keywords) ? (params.keywords as Keyword[]) : [];
    if (kws.length === 0) return;
    let target = payload.target;
    if (!target) {
      // No explicit target → auto-pick: only minions missing a granted keyword, highest attack.
      const lacks = (c: BoardCard): boolean => kws.some((k) => !c.keywords.includes(k));
      const others = ctx.state.board.filter((c) => c !== self && lacks(c));
      const pool = others.length > 0 ? others : lacks(self) ? [self] : [];
      if (pool.length === 0) return; // everyone already has it
      target = pool.reduce((a, b) => (b.attack > a.attack ? b : a));
    }
    for (const k of kws) if (!target.keywords.includes(k)) target.keywords.push(k);
  },

  /** Buddy Buddy: Battlecry — add `count` random minions of `tier` to your hand (golden doubles
   *  the count). Drawn from the run's buyable pool (active tribes + neutral). Honors the hand cap. */
  battlecryGainRandomMinion: (ctx, self, params) => {
    const tier = num(params.tier, 1);
    const reps = num(params.count, 1) * gold(self);
    const pool = BUYABLE_CARDS.filter(
      (c) => c.tier === tier && (c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)),
    );
    if (pool.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    for (let i = 0; i < reps && ctx.state.hand.length < CONFIG.handMax; i++) {
      const def = pool[rng.int(pool.length)]!;
      const cb = cardBuff(ctx.state, def.id);
      ctx.state.hand.push({
        uid: `b${ctx.state.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        attack: def.attack + cb.attack,
        health: def.health + cb.health,
        keywords: [...def.keywords],
        golden: false,
      });
      takeFromPool(ctx.state, def.id); // a conjured copy leaves the shared pool
    }
    ctx.state.rngCursor = rng.state();
  },

  /** Karwind: whenever a Battlecry resolves, buff your minions of `tribe` (+atk/+hp). Golden 2×.
   *  Records the buffed uids so the UI can flame-flash exactly those minions. */
  onBattlecryBuffTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const a = num(params.attack, 1) * gold(self);
    const h = num(params.health, 1) * gold(self);
    const flash = (ctx.state.karwindFlash ??= []);
    for (const c of ctx.state.board) {
      if (tribe && tribe !== 'any' && c.tribe !== tribe && CARD_INDEX[c.cardId]?.tribe2 !== tribe) continue;
      addBuff(c, nameOf(self), a, h);
      if (!flash.includes(c.uid)) flash.push(c.uid);
    }
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
    addBuff(self, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
  },

  /** Maw of the Pit: on any friendly consume, gain a keyword (a Divine Shield). */
  onConsumeGrantSelfKeyword: (_ctx, self, params) => {
    const kw = str(params.keyword) as Keyword;
    if (kw && !self.keywords.includes(kw)) self.keywords.push(kw);
  },

  /** End of Turn: buff self (+atk/+hp) when the recruit turn ends. */
  endOfTurnBuff: (_ctx, self, params) => {
    addBuff(self, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
  },

  /** Combinator — End of Turn: weld a token's (Cling Drone's) stats onto `targets` *random* other
   *  friendly Mechs, `count` drones each (golden doubles the drone count). The targets are picked
   *  fresh each proc (seeded), so the welds spread unpredictably — not always the highest-Attack Mechs. */
  endOfTurnMagnetizeMechs: (ctx, self, params, payload) => {
    const token = CARD_INDEX[str(params.tokenId) || 'cling'];
    if (!token) return;
    const targets = num(params.targets, 2);
    const drones = num(params.count, 1) * gold(self);
    const slot = ctx.state.board.indexOf(self);
    const uids = magnetizeTargets(
      ctx.state.board, self.uid, targets, ctx.state.seed, ctx.state.wave, slot, num(payload.proc, 0),
    );
    for (const uid of uids) {
      const m = ctx.state.board.find((c) => c.uid === uid);
      if (m) addBuff(m, nameOf(self), token.attack * drones, token.health * drones);
    }
  },

  /** Ritualist — End of Turn: every Fodder card type gains a *persistent* +atk/+hp for the rest
   *  of the run (so future copies from the tavern, summons, Discover etc. carry it), and the
   *  Fodder already on the board / in the hand gets it right now. Golden doubles; Ritualists stack. */
  buffFodderEverywhere: (ctx, self, params) => {
    const a = num(params.attack, 1) * gold(self);
    const h = num(params.health, 1) * gold(self);
    const state = ctx.state;
    state.cardBuffs ??= {};
    for (const def of Object.values(CARD_INDEX)) {
      if (!def.keywords.includes('FD')) continue;
      const cur = (state.cardBuffs[def.id] ??= { attack: 0, health: 0 });
      cur.attack += a;
      cur.health += h;
    }
    for (const c of [...state.board, ...state.hand]) {
      if (CARD_INDEX[c.cardId]?.keywords.includes('FD')) addBuff(c, nameOf(self), a, h);
    }
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
      if (c !== self && (tribe === 'any' || c.tribe === tribe || CARD_INDEX[c.cardId]?.tribe2 === tribe)) {
        addBuff(c, nameOf(self), a, h);
      }
    }
  },

  /** Deathrattle: buff the carry (+atk/+hp) — "random" friend out of combat. */
  deathrattleBuffRandom: (ctx, self, params) => {
    const friends = ctx.state.board.filter((c) => c !== self);
    if (friends.length === 0) return;
    const t = friends.reduce((a, b) => (b.attack > a.attack ? b : a));
    addBuff(t, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
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
    addBuff(self, str(params._source) || nameOf(self), num(params.attack), num(params.health));
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

/** Apply a spell's `cast` effects to its chosen target. The spell's name is injected as `_source`
 *  so target buffs (Spirit Fire) record it for the inspect breakdown. */
function applyCastEffects(ctx: RecruitContext, spellDef: CardDef, target: BoardCard): void {
  for (const effect of spellDef.effects) {
    if (effect.on !== 'cast') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) fn(ctx, target, { ...(effect.params ?? {}), _source: spellDef.name }, { minion: target });
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
      const buff = cardBuff(state, card.id); // a conjured Fodder carries Ritualist's run buff
      const minion: BoardCard = {
        uid: `b${state.uidSeq++}`,
        cardId: card.id,
        tribe: card.tribe,
        attack: card.attack + buff.attack,
        health: card.health + buff.health,
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

/** Drakko the Drummer: your Battlecries fire extra times. A golden Drakko adds 2 (triples);
 *  multiple Drakkos do NOT stack — only the best single one counts. Returns the total fire count. */
function drummerRepeats(state: RunState): number {
  const drummers = state.board.filter((c) => c.cardId === 'drummer');
  const bonus = drummers.some((d) => d.golden) ? 2 : drummers.length > 0 ? 1 : 0;
  return 1 + bonus;
}

/** Chronos: your End-of-Turn effects trigger extra times. A golden Chronos adds 2; multiple
 *  Chronos do NOT stack (only the best single one counts) — mirrors Drakko. Returns the count. */
/** How many times End-of-Turn effects fire this turn: 1, +1 per Chronos (best one only — golden
 *  Chronos adds 2, no stacking). Exported so the UI can replay each proc the matching number of times. */
export function chronosRepeats(state: RunState): number {
  const chronos = state.board.filter((c) => c.cardId === 'chronos');
  const bonus = chronos.some((c) => c.golden) ? 2 : chronos.length > 0 ? 1 : 0;
  return 1 + bonus;
}

/** Notify Battlecry-triggered watchers (Karwind) that a Battlecry just resolved. Call once per
 *  Battlecry *fire* — including each Drakko repeat — so a doubled Battlecry procs Karwind twice. */
function fireBattlecryTriggered(state: RunState): void {
  const ctx = makeContext(state);
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.on !== 'battlecryTriggered') continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (fn) fn(ctx, card, effect.params ?? {}, { minion: card });
    }
  }
}

/** Resolve a chosen Choose One option's effects on the played card (its picked Battlecry).
 *  Honors Drakko the Drummer, like a normal Battlecry. */
export function applyChooseOne(state: RunState, card: BoardCard, effects: CardDef['effects']): void {
  state.karwindFlash = [];
  const ctx = makeContext(state);
  const repeats = drummerRepeats(state);
  for (const effect of effects) {
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    for (let r = 0; r < repeats; r++) fn(ctx, card, effect.params ?? {}, { minion: card });
  }
  // a Choose One IS a Battlecry → notify Karwind, once per fire (Drakko repeats included)
  for (let r = 0; r < repeats; r++) fireBattlecryTriggered(state);
  if (state.karwindFlash && state.karwindFlash.length) state.karwindFlashSeq = (state.karwindFlashSeq ?? 0) + 1;
}

/** Resolve a deferred *targeted* Battlecry (Toxin Tender) on the player-chosen friendly `target`.
 *  Fires the played card's onPlay effects with the target injected, honoring Drakko + Karwind. */
export function applyBattlecryTarget(state: RunState, card: BoardCard, target: BoardCard): void {
  state.karwindFlash = [];
  const ctx = makeContext(state);
  const def = CARD_INDEX[card.cardId];
  if (!def) return;
  const repeats = drummerRepeats(state);
  for (const effect of def.effects) {
    if (effect.on !== 'onPlay') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    for (let r = 0; r < repeats; r++) fn(ctx, card, effect.params ?? {}, { minion: card, target });
  }
  for (let r = 0; r < repeats; r++) fireBattlecryTriggered(state); // a Battlecry → procs Karwind
  if (state.karwindFlash && state.karwindFlash.length) state.karwindFlashSeq = (state.karwindFlashSeq ?? 0) + 1;
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
  const eaten: { eaterUid: string; fodderId: string; attack: number; health: number }[] = [];
  for (let i = state.shop.length - 1; i >= 0; i--) {
    const offer = state.shop[i]!;
    const fodder = CARD_INDEX[offer.cardId];
    if (!fodder || !fodder.keywords.includes('FD')) continue;
    const eater = demons[rng.int(demons.length)]!;
    state.shop.splice(i, 1); // eaten — leaves the tavern
    const mult = fodderMultiplier(eater);
    const buff = cardBuff(state, fodder.id); // Ritualist's run buff feeds the eater too
    const fa = fodder.attack + buff.attack;
    const fh = fodder.health + buff.health;
    addBuff(eater, 'Consume', fa * mult, fh * mult);
    fire(ctx, 'onConsume', { minion: eater }); // Pactstone / Maw / Glutton pay off
    // Record the Fodder's *effective* (buffed) stats so the eat animation shows them, not 1/1.
    eaten.push({ eaterUid: eater.uid, fodderId: fodder.id, attack: fa, health: fh });
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
  const repeats = chronosRepeats(state); // Chronos: End-of-Turn effects trigger extra times
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.on !== 'endOfTurn') continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (!fn) continue;
      for (let r = 0; r < repeats; r++) fn(ctx, card, effect.params ?? {}, { minion: card, proc: r });
    }
  }
}

/**
 * Preview the End-of-Turn *stat* buffs without changing anything: run the real `applyEndOfTurn` on a
 * throwaway clone and diff the board + hand stats. Returns the per-uid delta for every minion whose
 * stats would change (self-buffs, Combinator welds, Ritualist's Fodder buff — all of it, since it's
 * the exact same code path). The recruit UI uses this to show those buffs live *during* the turn
 * instead of only when it ends. Display-only: the real buffs still bake in once at end of turn.
 */
export function projectEndOfTurn(state: RunState): Record<string, { attack: number; health: number }> {
  const clone = structuredClone(state);
  applyEndOfTurn(clone);
  const after = new Map<string, BoardCard>();
  for (const c of [...clone.board, ...clone.hand]) after.set(c.uid, c);
  const out: Record<string, { attack: number; health: number }> = {};
  for (const c of [...state.board, ...state.hand]) {
    const a = after.get(c.uid);
    if (a && (a.attack !== c.attack || a.health !== c.health)) {
      out[c.uid] = { attack: a.attack - c.attack, health: a.health - c.health };
    }
  }
  return out;
}

/**
 * Resolve a card's play-time effects, mutating the board in place. Call after the
 * card has been moved from the hand onto `state.board`. Summon-buffs fire first
 * (the played card has just entered), then its own Battlecry — whose summoned
 * tokens in turn fire their own summon-buffs.
 */
export function playCard(state: RunState, played: BoardCard): void {
  state.karwindFlash = []; // Karwind's battlecry-triggered buff repopulates this for the flame flash
  const ctx = makeContext(state);
  fire(ctx, 'onSummon', { minion: played });
  const def = CARD_INDEX[played.cardId];
  if (!def) return;
  // Choose One: the Battlecry is whichever option the player picks — deferred to `applyChooseOne`
  // (the reducer opens the prompt). onSummon buffs above still apply (it was summoned normally).
  if (def.chooseOne && def.chooseOne.length > 0) return;
  // Targeted Battlecry (Toxin Tender): the player picks the friendly target next — deferred to
  // `applyBattlecryTarget` (the reducer sets `pendingTarget`). onSummon already fired above.
  if (def.target === 'friendly') return;
  // Drakko the Drummer makes Battlecries fire extra times (golden triples; no stacking).
  const repeats = drummerRepeats(state);
  const hasBattlecry = def.effects.some((e) => e.on === 'onPlay');
  for (const effect of def.effects) {
    if (effect.on !== 'onPlay') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    for (let r = 0; r < repeats; r++) fn(ctx, played, effect.params ?? {}, { minion: played });
  }
  // each Battlecry fire (incl. Drakko repeats) procs Battlecry-triggered watchers (Karwind)
  if (hasBattlecry) for (let r = 0; r < repeats; r++) fireBattlecryTriggered(state);
  if (state.karwindFlash && state.karwindFlash.length) state.karwindFlashSeq = (state.karwindFlashSeq ?? 0) + 1;
}
