import { makeRng, COMBAT_REPLAYABLE_BATTLECRIES, type CardDef, type Keyword, type Tribe } from '@game/core';
import { BUYABLE_CARDS, CARD_INDEX, SPELL_CARDS } from '@game/content';
import { CONFIG } from './config';
import { getHero, spellAmplifyBonus } from './heroes';
import { mixSeed, TAG, type BoardCard, type DiscoverSpec, type RunState, type ShopCard } from './state';
import { returnToPool, takeFromPool } from './shop';

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
   *  player-chosen friendly minion for a targeted Battlecry (Toxin Tender); absent = auto-pick. `replay`
   *  marks a Djinn-driven extra End-of-Turn (it must not advance a cadence counter — see Frontdrake). */
  payload: { minion: BoardCard; proc?: number; target?: BoardCard; replay?: boolean },
) => void;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Tripled minions bake their recruit buffs in at doubled magnitude. */
const gold = (c: BoardCard): number => (c.golden ? 2 : 1);
/** A card's display name (the buff-source label in the inspect breakdown). */
const nameOf = (card: BoardCard): string => CARD_INDEX[card.cardId]?.name ?? card.cardId;

/** Pick up to `n` distinct items from `arr`, advancing the run's seeded RNG cursor — for recruit-phase
 *  "random target" effects (Guel, Monk). Deterministic given the cursor, so replays/sims stay exact. */
function pickRandom<T>(state: RunState, arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  const rng = makeRng(state.rngCursor);
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) out.push(pool.splice(rng.int(pool.length), 1)[0]!);
  state.rngCursor = rng.state();
  return out;
}

/**
 * Apply a recruit-phase stat buff to a card AND record its source for the inspect-panel breakdown
 * ("Spirit Fire ×2: +6/+6"). Pass `count` (default 1) for how many times the source applied. Pure
 * keyword grants (0/0) mutate nothing here and aren't listed. Base stats are never recorded.
 */
export function addBuff(card: BoardCard, source: string, attack: number, health: number, count = 1): void {
  card.attack = Math.max(0, card.attack + attack); // Attack never drops below 0
  card.health += health;
  // Sergeant: EVERY instance that grants it Attack (this buff is one such instance) permanently improves
  // its Deathrattle HP grant — in the shop here, mirrored in combat by `onGainAttackImproveHpGrant`. One
  // improvement per buff event (not scaled by the Attack amount), so two Forsaken Weavers buffing it on a
  // spell cast improve it twice. Seeds the combat instance + shows live on the card.
  if (attack > 0) {
    const eff = CARD_INDEX[card.cardId]?.effects.find((e) => e.do === 'onGainAttackImproveHpGrant');
    if (eff) card.hpGrantBonus = (card.hpGrantBonus ?? 0) + num(eff.params?.improve, 2) * gold(card);
  }
  if (attack === 0 && health === 0) return;
  card.buffs ??= [];
  const e = card.buffs.find((b) => b.source === source);
  if (e) { e.attack += attack; e.health += health; e.count += count; }
  else card.buffs.push({ source, attack, health, count });
}

/**
 * Whether a board card belongs to `tribe`, counting BOTH its tribes — a dual-type matches on either
 * (Bane is Dragon/Demon → `isTribe(bane, 'demon')` is true). `card.tribe` carries only the primary
 * tribe; the second lives on the CardDef, so this consults `CARD_INDEX`. The DRY form of the
 * `c.tribe === t || CARD_INDEX[c.cardId]?.tribe2 === t` check used across the dual-type systems.
 */
export function isTribe(card: BoardCard, tribe: Tribe): boolean {
  if (tribe !== 'neutral' && CARD_INDEX[card.cardId]?.universalTribe) return true;
  return card.tribe === tribe || CARD_INDEX[card.cardId]?.tribe2 === tribe;
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
 * The baked-on-creation Undead Attack bonus (Deathswarmer / Forsaken Weaver / Karthus — "+Attack to your
 * Undead **wherever they are**") for a freshly-created minion of `def`. Applied at EVERY creation source —
 * tavern buy, Discover, conjure (Summon Stone / Tribes Choice / Undead Army / Buddy Buddy / Cassen), and
 * Lasso steal — so the run-wide bonus follows your Undead everywhere, not only tavern purchases. 0 for
 * non-Undead; `universalTribe` counts (Symbiotic Attachment), matching the buy path's `isUndead`.
 */
export function undeadBuyBonus(state: RunState, def: CardDef): number {
  const undead = def.tribe === 'undead' || def.tribe2 === 'undead' || !!def.universalTribe;
  return undead ? (state.undeadBuyAtk ?? 0) : 0;
}

/** The Gold a minion sells for: Hoarder a flat 2 (golden 4), everything else `CONFIG.sellValue`. Shared by
 *  the reducer's sell case and the UI's sell-amount float so the two never drift. */
export function sellValueOf(card: BoardCard): number {
  return card.cardId === 'hoarder' ? 2 * (card.golden ? 2 : 1) : CONFIG.sellValue;
}

/**
 * Permanently enchant the **Fodder** card type run-wide by +a/+h (Ritualist's End of Turn, Bane's
 * battlecry trigger). Bumps the persistent per-cardId run buff for every Fodder def — so future copies
 * from any source (tavern, summon, Discover, conjure) carry it — and applies it to the Fodder already on
 * the board / in the hand right now. `source` labels the buff in the inspect breakdown.
 */
export function buffFodderRunWide(state: RunState, a: number, h: number, source: string): void {
  state.cardBuffs ??= {};
  for (const def of Object.values(CARD_INDEX)) {
    if (!def.keywords.includes('FD')) continue;
    const cur = (state.cardBuffs[def.id] ??= { attack: 0, health: 0 });
    cur.attack += a;
    cur.health += h;
  }
  for (const c of [...state.board, ...state.hand]) {
    if (CARD_INDEX[c.cardId]?.keywords.includes('FD')) addBuff(c, source, a, h);
  }
}

/**
 * Accrue the run-wide **Imp** buff (Fodder Feeder / Ritualist / Bane). Imps are combat-summoned tokens
 * (Brood Matron / Imp King), so this bumps `state.impBuff` — which `simulate` applies to every friendly Imp
 * at combat start AND on summon, so the bonus follows them. Also buffs any Imp already on the board/hand
 * (rare — imps are normally combat-only). Stacks; `source` labels the inspect breakdown.
 */
export function buffImpsRunWide(state: RunState, a: number, h: number, source: string): void {
  state.impBuff ??= { attack: 0, health: 0 };
  state.impBuff.attack += a;
  state.impBuff.health += h;
  for (const c of [...state.board, ...state.hand]) {
    if (CARD_INDEX[c.cardId]?.imp) addBuff(c, source, a, h);
  }
}

/**
 * Permanently enchant a single card type run-wide by +a/+h (Grave Knit's combat-death payoff). Like
 * `buffFodderRunWide` but keyed to one `cardId` rather than the Fodder keyword: bumps the persistent
 * per-cardId run buff (so future copies from any source carry it) and applies it to that card already
 * on the board / in the hand. `source` labels the buff in the inspect breakdown. Mirrors the Cling Drone
 * enchant (`improveClingDrones`) but with an explicit source + separate atk/hp.
 */
export function buffCardTypeRunWide(state: RunState, cardId: string, a: number, h: number, source: string): void {
  state.cardBuffs ??= {};
  const cur = (state.cardBuffs[cardId] ??= { attack: 0, health: 0 });
  cur.attack += a;
  cur.health += h;
  for (const c of [...state.board, ...state.hand]) {
    if (c.cardId === cardId) addBuff(c, source, a, h);
  }
}

/**
 * How many times a spell's effect resolves when cast, given the board (Yazzus): 3 if any Yazzus on the
 * board is golden, 2 if a non-golden Yazzus is present, else 1. Multiple Yazzus do NOT stack — the best
 * single one wins (mirrors Drakko / Chronos). Read by the reducer's spell-cast path; Discover-spells are
 * exempt (the discover state holds a single pending set), handled at the call site.
 */
export function spellCastMult(state: RunState): number {
  const yazzus = state.board.filter((c) => c.cardId === 'yazzus');
  if (yazzus.some((c) => c.golden)) return 3;
  return yazzus.length > 0 ? 2 : 1;
}

/**
 * How many times a spell's effect resolves on cast. Yazzus (2, or 3 if golden) multiplies ONLY
 * *aimed* spells — those with a `target` (Spirit Fire, Shatter, Front to Back, Aresmar, Tribes
 * Choice…). Untargeted economy/utility/Discover spells (Growth, Mana Pouch, Sprout, Help Wanted…)
 * always resolve once. `singleCast` spells (Channeling the Devourer) never multiply. Read by the
 * reducer's cast path and the UI's cast-spark replay.
 */
export function spellCasts(state: RunState, def: CardDef): number {
  if (def.singleCast || !def.target) return 1;
  return spellCastMult(state);
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
  const eligible = board.filter((c) => c.uid !== selfUid && isTribe(c, 'mech'));
  const rng = makeRng(mixSeed(seed, wave, TAG.MAGNET, slot, proc));
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = rng.int(i + 1); // Fisher-Yates with the seeded RNG
    const tmp = eligible[i]!;
    eligible[i] = eligible[j]!;
    eligible[j] = tmp;
  }
  return eligible.slice(0, count).map((c) => c.uid);
}

/** The contribution a magnetic welds onto a host: its stats, its non-Magnetic keywords, and any mana
 *  income it carries (Money Bot). */
export interface MagnetPayload {
  source: string;
  attack: number;
  health: number;
  keywords: Keyword[];
  mana: number;
  /** Better Bot: Rally-Mech Attack this magnetic carries onto its host (already golden-baked). */
  rallyMechAtk?: number;
  /** Harry Botter: spell-power aura this magnetic carries onto its host (already golden-baked). */
  spellAura?: number;
}

/** Apply a magnetic's contribution to one host (×mult): stats (as a tracked buff), keywords (minus
 *  Magnetic), and mana income. */
function applyWeld(host: BoardCard, mag: MagnetPayload, mult: number): void {
  addBuff(host, mag.source, mag.attack * mult, mag.health * mult);
  for (const k of mag.keywords) {
    if (k !== 'M' && !host.keywords.includes(k)) host.keywords.push(k);
  }
  if (mag.mana > 0) host.manaBonus = (host.manaBonus ?? 0) + mag.mana * mult;
  if (mag.rallyMechAtk) host.rallyMechAtk = (host.rallyMechAtk ?? 0) + mag.rallyMechAtk * mult;
  if (mag.spellAura) host.spellAuraBonus = (host.spellAuraBonus ?? 0) + mag.spellAura * mult;
}

/**
 * Weld a magnetic onto `host`, then let any Beatboxer mimic it. Beatboxer copies every magnetization
 * that lands on *another* unit (a magnetization onto a Beatboxer itself is just the `host` weld below,
 * counted once); a golden Beatboxer mimics each one twice. Both magnetization paths — the player dropping
 * a Magnetic on a Mech, and Combinator's End-of-Turn weld — route through here.
 *
 * `clings` = how many Cling Drones this weld represents (0 if the magnetic isn't a Cling). Each Cling
 * magnetized — onto the host AND each copy Beatboxer mimics onto itself — stacks the Cling improvement.
 */
export function weldMagnetic(state: RunState, host: BoardCard, mag: MagnetPayload, clings = 0): void {
  applyWeld(host, mag, 1);
  let totalClings = clings; // Clings welded onto the host
  for (const bb of state.board) {
    if (bb.cardId === 'beatboxer' && bb.uid !== host.uid) {
      const mult = bb.golden ? 2 : 1;
      applyWeld(bb, mag, mult);
      totalClings += clings * mult; // Beatboxer magnetizes Cling copies onto itself — those stack too
    }
  }
  if (totalClings > 0) improveClingDrones(state, totalClings);
}

/**
 * Cling Drones improve +1/+1 per magnetization. `times` = how many Clings were just magnetized (the
 * player drops one; Combinator welds several). It persists as a `cling` run enchantment (so future
 * Clings — bought or Combinator-welded — are bigger) AND buffs any Clings already on the board / in hand
 * right now, mirroring Ritualist's Fodder enchantment. Scales with Combinator, which welds Clings every turn.
 */
export function improveClingDrones(state: RunState, times: number): void {
  if (times <= 0) return;
  state.cardBuffs ??= {};
  const cur = (state.cardBuffs.cling ??= { attack: 0, health: 0 });
  cur.attack += times;
  cur.health += times;
  for (const c of [...state.board, ...state.hand]) {
    if (c.cardId === 'cling') addBuff(c, 'Magnetized', times, times);
  }
}

/**
 * Conjure up to `reps` random minions from `pool` into the hand (Summon Stone / Tribes Choice),
 * advancing the run's seeded RNG cursor. Each conjured copy carries any persistent run buff
 * (Ritualist), leaves the shared pool (`takeFromPool`), and respects the hand cap. No-op on an
 * empty pool. Mirrors `battlecryGainRandomMinion`'s conjure path.
 */
function conjureToHand(state: RunState, pool: CardDef[], reps: number): void {
  if (pool.length === 0) return;
  const rng = makeRng(state.rngCursor);
  for (let i = 0; i < reps && state.hand.length < CONFIG.handMax; i++) {
    const def = pool[rng.int(pool.length)]!;
    const cb = cardBuff(state, def.id);
    state.hand.push({
      uid: `b${state.uidSeq++}`,
      cardId: def.id,
      tribe: def.tribe,
      attack: def.attack + cb.attack + undeadBuyBonus(state, def),
      health: def.health + cb.health,
      keywords: [...def.keywords],
      golden: false,
    });
    takeFromPool(state, def.id);
  }
  state.rngCursor = rng.state();
}

/**
 * The player board's most common tribe — counting BOTH tribes of each card (dual-types count for both).
 * Ties resolve to the first seen on the board (insertion order + strict `>`). Null for an empty / tribe-less
 * board. The `s.board` analogue of snapshot.ts's `dominantTribe` (which takes a BoardSnapshot).
 */
export function dominantBoardTribe(state: RunState): Tribe | null {
  const counts = new Map<Tribe, number>();
  for (const c of state.board) {
    const def = CARD_INDEX[c.cardId];
    if (!def) continue;
    for (const t of [def.tribe, def.tribe2]) {
      if (t && t !== 'neutral') counts.set(t, (counts.get(t) ?? 0) + 1); // neutral isn't a "type"
    }
  }
  let best: { tribe: Tribe; count: number } | null = null;
  for (const [tribe, count] of counts) {
    if (!best || count > best.count) best = { tribe, count }; // strict `>` → first seen wins ties
  }
  return best?.tribe ?? null;
}

/**
 * Cassen's Collision payoff: conjure ONE random buyable minion of the board's most common tribe (active
 * tribes + the always-buyable neutral glue, copies left) into the hand. Returns whether a minion was
 * added — false on an empty / tribe-less board, no eligible card, or a full hand, so the caller keeps the
 * kills banked for next time. Reuses `conjureToHand` (seeded rng + pool draw), detecting success via the
 * hand length so the banked count only spends on an actual grant.
 */
export function grantTopTypeMinion(state: RunState): boolean {
  const tribe = dominantBoardTribe(state);
  if (!tribe) return false;
  const pool = BUYABLE_CARDS.filter(
    (c) =>
      (c.tribe === tribe || c.tribe2 === tribe) &&
      (c.tribe === 'neutral' || state.tribes.includes(c.tribe)) &&
      c.tier <= state.tier && // bound by your tavern tier — no T6 grant at T2
      (state.pool[c.id] ?? 0) > 0,
  );
  if (pool.length === 0) return false;
  const before = state.hand.length;
  conjureToHand(state, pool, 1);
  return state.hand.length > before; // false if the hand was full (no minion added)
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
    if (tribe && tribe !== 'any' && !isTribe(minion, tribe as Tribe)) return;
    const bonus = self.summonBonus ?? 0;
    addBuff(minion, nameOf(self), num(params.attack) + bonus, num(params.health) + bonus);
  },

  /** Mama Bear (recruit half) — when a beast is summoned (played / token), buff it +M/+M where M = (base +
   *  accrued `summonBonus`) × golden, then summonBonus climbs by `base`. The improve persists across combat
   *  via the summonBonus carry-back (the combat half mirrors this). A triple resets the accrual (the
   *  summonBonus-combine in checkTriples is keyed to buffOnSummon, not this factory). */
  summonBuffTribeImprove: (_ctx, self, params, { minion }) => {
    if (minion === self) return;
    const tribe = str(params.tribe);
    if (tribe && !isTribe(minion, tribe as Tribe)) return;
    const base = num(params.attack, 3);
    const mag = (base + (self.summonBonus ?? 0)) * gold(self);
    addBuff(minion, nameOf(self), mag, mag);
    self.summonBonus = (self.summonBonus ?? 0) + base;
  },

  /** Dragon Battlecries: buff your (optionally other) minions of `tribe`. */
  battlecryBuffTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const attack = num(params.attack) * gold(self);
    const health = num(params.health) * gold(self);
    const includeSelf = params.includeSelf !== false;
    for (const card of ctx.state.board) {
      if (!isTribe(card, tribe as Tribe)) continue;
      if (!includeSelf && card === self) continue;
      addBuff(card, nameOf(self), attack, health);
    }
  },

  /** Alleycur: Battlecry summon `count` copies of a token beside self. */
  battlecrySummon: (ctx, self, params) => {
    const token = CARD_INDEX[str(params.tokenId)];
    if (!token) return;
    const count = num(params.count, 1) * gold(self); // golden doubles the count (Alleycat 1 → 2, Shaper 2 → 4)
    for (let i = 0; i < count; i++) ctx.summon(token, self.uid);
  },

  /** Toxin Tender / Plaguebringer: grant keyword(s) to a friendly minion. Toxin Tender is
   *  player-targeted (`payload.target` is the chosen minion); the auto-pick fallback (Plaguebringer,
   *  or a Myra/face-Omen re-fire with no explicit target) takes the highest-attack friend that still
   *  lacks a granted keyword (never wasting it). A `targetTribe` on the card restricts the auto-pick to
   *  that tribe too (Toxin Tender → friendly Undead only; dual-types count) — so a re-fire can't grant
   *  Venomous off-tribe, and it simply no-ops when no eligible friend exists. */
  battlecryGrantKeyword: (ctx, self, params, payload) => {
    const kws = Array.isArray(params.keywords) ? (params.keywords as Keyword[]) : [];
    if (kws.length === 0) return;
    let target = payload.target;
    if (!target) {
      const restrict = CARD_INDEX[self.cardId]?.targetTribe; // Toxin Tender → 'undead'; undefined = any
      const lacks = (c: BoardCard): boolean => kws.some((k) => !c.keywords.includes(k));
      const ok = (c: BoardCard): boolean => lacks(c) && (!restrict || isTribe(c, restrict));
      const others = ctx.state.board.filter((c) => c !== self && ok(c));
      const pool = others.length > 0 ? others : ok(self) ? [self] : [];
      if (pool.length === 0) return; // no eligible friend (or everyone already has it)
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
        attack: def.attack + cb.attack + undeadBuyBonus(ctx.state, def),
        health: def.health + cb.health,
        keywords: [...def.keywords],
        golden: false,
      });
      takeFromPool(ctx.state, def.id); // a conjured copy leaves the shared pool
    }
    ctx.state.rngCursor = rng.state();
  },

  /** Black Belt Brian: Battlecry — Discover a spell. Queues a spell Discover (3 random spells, drawn from
   *  the tavern spell pool); the player picks one into the hand (resolved by the reducer's `discover` case).
   *  GOLDEN: queues a SECOND spell Discover, opened when the first pick resolves. Routing through
   *  `queueDiscover` is what lets this compose with Drakko the Drummer — `playCard` fires this factory once
   *  per Battlecry repeat, so each fire stacks its Discover(s) onto the queue (Brian + Drakko → 2 spells;
   *  golden Brian + Drakko → 4). */
  battlecryDiscoverSpell: (ctx, self) => {
    queueDiscover(ctx.state, { kind: 'spell' });
    if (self.golden) queueDiscover(ctx.state, { kind: 'spell' });
  },

  /** Sea Urchin — Battlecry: Discover a minion of `tribe` (up to your tavern tier). Golden Discovers
   *  twice. Routes through queueDiscover so it composes with Drakko (each extra Battlecry fire stacks an
   *  offer onto the queue). */
  battlecryDiscoverMinion: (ctx, self, params) => {
    const tribe = (str(params.tribe) || undefined) as Tribe | undefined;
    // Exclude the source itself — Sea Urchin shouldn't be able to Discover another Sea Urchin.
    const spec: DiscoverSpec = { kind: 'minion', tier: ctx.state.tier, tribe, exclude: self.cardId };
    queueDiscover(ctx.state, spec);
    if (self.golden) queueDiscover(ctx.state, spec);
  },

  /** Cinderwing Matron — Battlecry: permanently raise the run-wide SPELL POWER by +atk/+hp (Cinderwing
   *  grants +0/+1 → spells give +1 more Health from now on). Golden doubles. Folds into spellAttackBonus
   *  / spellHealthBonus, so every future stat spell + its display picks it up. */
  battlecryBuffSpellPower: (ctx, self, params) => {
    ctx.state.spellBonus ??= { attack: 0, health: 0 };
    ctx.state.spellBonus.attack += num(params.attack) * gold(self);
    ctx.state.spellBonus.health += num(params.health) * gold(self);
  },

  /** Karwind: whenever a Battlecry resolves, buff your minions of `tribe` (+atk/+hp). Golden 2×.
   *  Records the buffed uids so the UI can flame-flash exactly those minions. */
  onBattlecryBuffTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const a = num(params.attack, 1) * gold(self);
    const h = num(params.health, 1) * gold(self);
    const flash = (ctx.state.karwindFlash ??= []);
    for (const c of ctx.state.board) {
      if (tribe && tribe !== 'any' && !isTribe(c, tribe as Tribe)) continue;
      addBuff(c, nameOf(self), a, h);
      if (!flash.includes(c.uid)) flash.push(c.uid);
    }
  },

  /** Hunter (recruit half) — when this gains Attack in the shop (e.g. a Fortify), give every friendly minion
   *  +Health. Health-only, so it can never re-trigger onGainAttack (no loop). Golden doubles. Dispatched by
   *  `fireOnGainAttack` when a recruit buff raises Hunter's Attack. */
  onGainAttackBuffAll: (ctx, self, params) => {
    const h = num(params.health, 2) * gold(self);
    for (const c of ctx.state.board) addBuff(c, nameOf(self), 0, h);
  },

  // --- Demons (Consume, recruit-resolved: bakes into stats before combat) ---

  /** Queue Fodder (Fred) into the *next* tavern refresh (golden adds 2). Soulfeeder fires it on
   *  Battlecry; Maw of the Pit fires it at End of Turn. */
  addTavernFodder: (ctx, self, params) => {
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

  /** Maw of the Pit: on any friendly consume, gain a Divine Shield for the *next combat only*. The DS
   *  keyword is added (so it shows + enters the snapshot); `tempShield` flags it so `resolveCombat`
   *  strips it after the fight. Consuming again re-arms it. */
  onConsumeShieldNextCombat: (_ctx, self) => {
    self.tempShield = true;
    if (!self.keywords.includes('DS')) self.keywords.push('DS');
  },

  /** Spirit Pup: each spell cast (while on board) ticks a per-instance counter; at `at` it transforms
   *  into `into`, keeping its current stats and applying the new form's *retroactive* spell buff —
   *  +retroPerSpell/+retroPerSpell for EVERY spell cast this game (the global tally), not just the
   *  ones that counted toward the transform. */
  spellCastTransform: (ctx, self, params) => {
    self.spellProgress = (self.spellProgress ?? 0) + 1;
    if (self.spellProgress < num(params.at, 10)) return;
    self.cardId = str(params.into); // swap form (new art + effects), keeping the instance's stats
    self.spellProgress = undefined;
    // Optional retroactive buff (+retroPerSpell per spell cast this game). Spirit Pup omits it → 0.
    const per = num(params.retroPerSpell, 0) * gold(self);
    addBuff(self, nameOf(self), ctx.state.spellsCast * per, ctx.state.spellsCast * per);
  },

  /** Available primitive: +atk/+hp on each spell cast (buff self). No card uses it currently. */
  spellCastBuffSelf: (_ctx, self, params) => {
    addBuff(self, nameOf(self), num(params.attack, 1) * gold(self), num(params.health, 1) * gold(self));
  },

  /** Spirit Worgen: when a friendly minion of one of `tribes` is summoned (played or token-summoned),
   *  gain +X/+X where X = base + spells cast THIS turn — so casting spells this turn improves the
   *  per-summon gain. Self-targeting; ignores its own arrival. */
  summonBuffSelfTribe: (ctx, self, params, { minion }) => {
    if (minion === self) return;
    const tribes = Array.isArray(params.tribes) ? (params.tribes as string[]) : [];
    const def = CARD_INDEX[minion.cardId];
    if (!tribes.includes(minion.tribe) && !(def?.tribe2 && tribes.includes(def.tribe2)) && !def?.universalTribe) return;
    const x = (num(params.attack, 1) + ctx.state.spellsThisTurn) * gold(self);
    const y = (num(params.health, 1) + ctx.state.spellsThisTurn) * gold(self);
    addBuff(self, nameOf(self), x, y);
  },

  /** Archmagus Guel: after a tavern spell is cast, give `count` *other* friendly minions +atk/+hp.
   *  Targets are random (seeded by the run cursor) so the buffs spread rather than snowball one carry. */
  spellCastBuffOthers: (ctx, self, params) => {
    const others = ctx.state.board.filter((c) => c !== self);
    const picks = pickRandom(ctx.state, others, num(params.count, 2));
    // Scales with the run: the granted +atk/+hp grows by +1/+1 (golden +2/+2) per 4 spells cast this run.
    // `spellsCast` already counts the spell that just triggered this, so the 4th cast gives the first step.
    const step = Math.floor(ctx.state.spellsCast / 4);
    const a = (num(params.attack, 1) + step) * gold(self);
    const h = (num(params.health, 1) + step) * gold(self);
    for (const m of picks) addBuff(m, nameOf(self), a, h);
  },

  /** Flowing Monk: when a summon can't fit the full board, give a random friendly minion +atk/+hp. */
  overflowBuffRandom: (ctx, self, params) => {
    const picks = pickRandom(ctx.state, [...ctx.state.board], 1);
    const a = num(params.attack, 3) * gold(self);
    const h = num(params.health, 3) * gold(self);
    for (const m of picks) addBuff(m, nameOf(self), a, h);
  },

  /** End of Turn: buff self (+atk/+hp) when the recruit turn ends. */
  endOfTurnBuff: (_ctx, self, params) => {
    addBuff(self, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
  },

  /** Frontdrake — End of Turn: every `every` turns on the board, conjure `count` random minions of
   *  `tribe` into the hand (tier ≤ tavern tier, active tribes, copies left — "abides by tavern rules").
   *  Golden doubles the count. The per-card `eotTick` advances ONCE per turn (on proc 0), so Chronos
   *  repeats fire extra grants on the cadence turn without speeding the count up. */
  endOfTurnGrantTribe: (ctx, self, params, payload) => {
    const every = Math.max(1, num(params.every, 3));
    // A Djinn replay must NOT advance the count (the user's rule). It still pays off "on the turn it
    // would proc": the natural EOT this turn lands the cadence exactly when (tick + 1) % every === 0,
    // so a replay grants on that condition. The natural EOT counts the turn once (on proc 0) and grants
    // when the just-incremented count hits the cadence; Chronos repeats (proc > 0) ride along the same tick.
    const replay = payload.replay === true;
    if (!replay && num(payload.proc, 0) === 0) self.eotTick = (self.eotTick ?? 0) + 1; // count the turn once
    const tick = self.eotTick ?? 0;
    const due = replay ? (tick + 1) % every === 0 : tick % every === 0;
    if (!due) return;
    const tribe = str(params.tribe) as Tribe;
    const count = num(params.count, 1) * gold(self);
    const pool = BUYABLE_CARDS.filter(
      (c) =>
        (c.tribe === tribe || c.tribe2 === tribe) &&
        (c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)) &&
        c.tier <= ctx.state.tier &&
        (ctx.state.pool[c.id] ?? 0) > 0,
    );
    conjureToHand(ctx.state, pool, count);
  },

  /** Combinator — End of Turn: magnetize a RANDOM Magnetic Mech (Cling Drone / Money Bot / Better Bot…)
   *  onto `targets` *random* other friendly Mechs (golden hits 2). Hosts are picked fresh each proc (seeded),
   *  so the welds spread unpredictably — not always the highest-Attack Mechs. The magnetic mech is rolled on
   *  its own seeded stream, so each turn can fork in a different bot: a Cling stacks the Cling improvement, a
   *  Money Bot welds income onto the host, a Better Bot welds (stacking) Rally. The full contribution rides
   *  in — stats, keywords (minus Magnetic), Money Bot's mana, Better Bot's `rallyMechAtk`. */
  endOfTurnMagnetizeMechs: (ctx, self, params, payload) => {
    const targets = num(params.targets, 1) * gold(self); // golden welds onto 2 Mechs instead of 1
    const slot = ctx.state.board.indexOf(self);
    const proc = num(payload.proc, 0);
    // The build's Magnetic Mechs (Cling, Money Bot, Better Bot…), sorted by id so the pick is deterministic.
    const magnetics = Object.values(CARD_INDEX)
      .filter((c) => (c.tribe === 'mech' || c.tribe2 === 'mech') && c.keywords.includes('M'))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (magnetics.length === 0) return;
    // Roll the magnetic mech on a distinct stream (the trailing tag separates it from the host shuffle).
    const pick = magnetics[makeRng(mixSeed(ctx.state.seed, ctx.state.wave, TAG.MAGNET, slot, proc, 99)).int(magnetics.length)]!;
    const uids = magnetizeTargets(ctx.state.board, self.uid, targets, ctx.state.seed, ctx.state.wave, slot, proc);
    const pickBuff = cardBuff(ctx.state, pick.id); // a Cling pick carries its accrued +N/+N improvement
    const clings = pick.id === 'cling' ? 1 : 0; // a welded Cling stacks the Cling improvement (via weldMagnetic)
    for (const uid of uids) {
      const m = ctx.state.board.find((c) => c.uid === uid);
      if (!m) continue;
      weldMagnetic(ctx.state, m, {
        // Attribute the buff to the welded magnetic (e.g. "Harry Botter ×2" in the inspect breakdown), not
        // to Combinator — so the player sees what's actually attached, matching a manual magnetize.
        source: pick.name,
        attack: pick.attack + pickBuff.attack,
        health: pick.health + pickBuff.health,
        keywords: [...pick.keywords],
        mana: pick.manaPerTurn ?? 0,
        rallyMechAtk: pick.rallyMechAtk,
        spellAura: pick.spellAura,
      }, clings);
    }
  },

  /** Ritualist — End of Turn: every Fodder card type gains a *persistent* +atk/+hp for the rest
   *  of the run (so future copies from the tavern, summons, Discover etc. carry it), and the
   *  Fodder already on the board / in the hand gets it right now. Golden doubles; Ritualists stack. */
  buffFodderEverywhere: (ctx, self, params) => {
    const a = num(params.attack, 1) * gold(self);
    const h = num(params.health, 1) * gold(self);
    buffFodderRunWide(ctx.state, a, h, nameOf(self));
    buffImpsRunWide(ctx.state, a, h, nameOf(self)); // Ritualist now feeds Imps too
  },

  /** Hoarder — Battlecry: bank extra Gold for next turn (consumed when next turn's Gold is set). Golden 2×. */
  battlecryBonusGoldNextTurn: (ctx, self, params) => {
    ctx.state.bonusEmbersNextTurn = (ctx.state.bonusEmbersNextTurn ?? 0) + num(params.gold, 1) * gold(self);
  },

  /** Bane — whenever a Battlecry resolves on your board, give the Fodder card type a *persistent*
   *  +atk/+hp run-wide (same mechanism as Ritualist's End-of-Turn enchant). Golden doubles. Fires once
   *  per Battlecry *fire* (so a Drakko-doubled Battlecry procs it twice — `fireBattlecryTriggered`
   *  notifies per fire). Multiple Banes each react, so they stack additively. */
  onBattlecryBuffFodder: (ctx, self, params) => {
    const a = num(params.attack, 1) * gold(self);
    const h = num(params.health, 1) * gold(self);
    buffFodderRunWide(ctx.state, a, h, nameOf(self));
    buffImpsRunWide(ctx.state, a, h, nameOf(self)); // Bane now buffs Imps too
    // Flash Bane itself + any Fodder on the board it just enchanted, so the proc is visible even when no
    // Fodder is out (its enchant is run-wide, to the card *type*). Reuses the battlecry-trigger flame flash:
    // the seq bump happens in `fireBattlecryTriggered`'s callers once this list is non-empty.
    const flash = (ctx.state.karwindFlash ??= []);
    if (!flash.includes(self.uid)) flash.push(self.uid);
    for (const c of ctx.state.board) {
      if (CARD_INDEX[c.cardId]?.keywords.includes('FD') && !flash.includes(c.uid)) flash.push(c.uid);
    }
  },

  // --- Deathrattles that can also resolve out of combat (e.g. when Consumed). The
  //     combat versions live in @game/core; these bake into the board's stats. Out
  //     of combat there's no RNG, so "random" picks become the highest-Attack carry. ---

  /** Deathrattle: summon `count` copies of a token. */
  deathrattleSummon: (ctx, self, params) => {
    const token = CARD_INDEX[str(params.tokenId)];
    if (!token) return;
    const kw = str(params.keyword) as Keyword | ''; // optional: grant each summoned token a keyword (Broodmother → Taunt)
    for (let i = 0; i < num(params.count, 1) * gold(self); i++) {
      const m = ctx.summon(token, self.uid);
      if (kw && m && !m.keywords.includes(kw)) m.keywords.push(kw);
    }
  },

  /** Deathrattle: buff all friends of `tribe` (+atk/+hp). */
  deathrattleBuffTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const a = num(params.attack) * gold(self);
    const h = num(params.health) * gold(self);
    for (const c of ctx.state.board) {
      if (c !== self && (tribe === 'any' || isTribe(c, tribe as Tribe))) {
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

  /** Spirit Fire / Bulwark / Shatter — cast: buff the chosen target +atk/+hp, and either grant a
   *  keyword (`keyword`) or *toggle* one (`toggleKeyword`: add if absent, remove if present). `self`
   *  is the target. */
  spellBuffTarget: (ctx, self, params) => {
    let attack = num(params.attack);
    let health = num(params.health);
    // Stat-granting spells pick up the run's spell power (Spellbinder hero + cards: Cinderwing on
    // Health, Skullblade on Attack). The UI shows the same effective value via spellDisplayText — one
    // source of truth (spellAttackBonus / spellHealthBonus).
    if (attack > 0 || health > 0) {
      attack += spellAttackBonus(ctx.state);
      health += spellHealthBonus(ctx.state);
    }
    addBuff(self, str(params._source) || nameOf(self), attack, health);
    const kw = str(params.keyword);
    if (kw && !self.keywords.includes(kw as Keyword)) self.keywords.push(kw as Keyword);
    // Shatter: toggle a keyword — strip it if present, grant it otherwise.
    const toggle = str(params.toggleKeyword) as Keyword;
    if (toggle) {
      if (self.keywords.includes(toggle)) self.keywords = self.keywords.filter((k) => k !== toggle);
      else self.keywords.push(toggle);
    }
  },

  /** Front to Back — cast: linear escalation. +(2 + frontToBackBonus + spell power)/(same), then the
   *  run's frontToBackBonus climbs by 2 so the next cast is bigger. `self` is the chosen target. */
  spellBuffTargetEscalating: (ctx, self, params) => {
    const base = num(params.attack, 2) + ctx.state.frontToBackBonus;
    const a = base + spellAttackBonus(ctx.state);
    const h = base + spellHealthBonus(ctx.state);
    addBuff(self, str(params._source) || 'Front to Back', a, h);
    ctx.state.frontToBackBonus += 2;
  },

  /** Eyes of Aresmar — cast: make the targeted minion Golden (like Oner's Gild), but only if its
   *  card tier is ≤ the spell's `targetMaxTier`. Doubles current stats via a tracked 'Gild' buff +
   *  flips golden. The cap is read from the spell def via `_maxTier` (injected by applyCastEffects). */
  spellGildTarget: (ctx, self, params) => {
    if (self.golden) return;
    const limit = num(params._maxTier, CONFIG.maxTier);
    const targetTier = CARD_INDEX[self.cardId]?.tier ?? 1;
    if (targetTier > limit) return;
    addBuff(self, 'Gild', self.attack, self.health);
    self.golden = true;
  },

  /** Tribes Choice — cast: conjure a random buyable minion sharing the *target's* tribe, tier ≤ the
   *  tavern tier, into the hand (drawn from the run's finite pool; honours the hand cap). Neutral is no
   *  longer a "type": targeting a neutral minion yields nothing (the spell fizzles), so type-rolls never
   *  hand out neutral glue (mirrors `dominantBoardTribe`, which already ignores neutral). */
  spellGainOfTargetTribe: (ctx, self) => {
    const tribe = self.tribe;
    if (tribe === 'neutral') return; // neutral isn't a type — no type-roll result
    const pool = BUYABLE_CARDS.filter(
      (c) =>
        c.tier <= ctx.state.tier &&
        (c.tribe === tribe || c.tribe2 === tribe) &&
        (ctx.state.pool[c.id] ?? 0) > 0, // only offer cards with copies left
    );
    conjureToHand(ctx.state, pool, 1);
  },

  /** Summon Stone — cast: conjure a random buyable minion of `tier` (active tribes + neutral, copies
   *  left) into the hand. */
  spellGainRandomMinion: (ctx, _self, params) => {
    const tier = num(params.tier, 1);
    const pool = BUYABLE_CARDS.filter(
      (c) =>
        c.tier === tier &&
        (c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)) &&
        (ctx.state.pool[c.id] ?? 0) > 0,
    );
    conjureToHand(ctx.state, pool, 1);
  },

  /** Undead Army — cast: pick ONE random buyable minion of `tribe` (active tribes, copies left) and
   *  conjure `count` copies of it into the hand. Fizzles gracefully on no option / no hand room. */
  conjureTribeArmy: (ctx, _self, params) => {
    const tribe = str(params.tribe);
    const count = num(params.count, 2);
    const pool = BUYABLE_CARDS.filter(
      (c) =>
        (c.tribe === tribe || c.tribe2 === tribe) &&
        (c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)) &&
        c.tier <= ctx.state.tier && // bound by your tavern tier
        (ctx.state.pool[c.id] ?? 0) > 0,
    );
    if (pool.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    const pick = pool[rng.int(pool.length)]!; // one card, several copies
    ctx.state.rngCursor = rng.state();
    conjureToHand(ctx.state, Array(count).fill(pick), count); // conjureToHand honours the hand cap + pool
  },

  // --- Run-level spell effects (act on the run, no minion target). These run through
  //     `applyCastEffects` with `self` undefined — they ignore it. ---

  /** Refreshing Texts — cast: bank `count` free rerolls. */
  grantFreeRolls: (ctx, _self, params) => {
    ctx.state.freeRolls += num(params.count, 1);
  },

  /** Mana Font — cast: raise MAX Mana by `amount`, UNCAPPED (may push past the normal cap). Current Mana
   *  is NOT topped up — you don't gain the new Mana this turn, just a bigger pool from next turn on. */
  gainMaxMana: (ctx, _self, params) => {
    const amount = num(params.amount, 1);
    ctx.state.maxEmbers += amount;
  },

  /** Mend — cast: heal the hero by `amount`, capped at the hero's max Resolve (no overheal). The hero's
   *  `resolve` field is the max HP. Untargeted (acts on the run). */
  healHero: (ctx, _self, params) => {
    const max = getHero(ctx.state.heroId).resolve;
    ctx.state.resolve = Math.min(max, ctx.state.resolve + num(params.amount, 5));
  },

  /** Lasso — cast: steal a random MINION offer from the tavern into the hand (free). Picks via the
   *  seeded rng, removes it from the shop, and adds it as a BoardCard (base + any offer buff bakes in,
   *  mirroring a buy). Fizzles gracefully on an empty shop or a full hand. */
  stealTavernMinion: (ctx, _self) => {
    const state = ctx.state;
    if (state.shop.length === 0 || state.hand.length >= CONFIG.handMax) return;
    const rng = makeRng(state.rngCursor);
    const idx = rng.int(state.shop.length);
    state.rngCursor = rng.state();
    const offer = state.shop[idx]!;
    const card = CARD_INDEX[offer.cardId];
    if (!card) return;
    state.shop.splice(idx, 1); // stolen — leaves the tavern (the pooled copy travels with it to the hand)
    const cb = cardBuff(state, card.id); // a stolen Fodder carries Ritualist's run buff, like a buy
    state.hand.push({
      uid: `b${state.uidSeq++}`,
      cardId: card.id,
      tribe: card.tribe,
      // Stolen like a buy → also carries the run-wide Undead Attack bonus (undeadBuyAtk).
      attack: card.attack + cb.attack + (offer.atk ?? 0) + undeadBuyBonus(state, card),
      health: card.health + cb.health + (offer.hp ?? 0),
      keywords: [...card.keywords, ...(offer.keywords ?? []).filter((k) => !card.keywords.includes(k))],
      golden: false,
    });
  },

  /** Staff of Guel — cast: a PERMANENT run-wide buff to every minion bought from the tavern from now
   *  on (not Discovered/conjured cards). Stacks if recast and picks up spell power on both stats. The
   *  shop UI folds it onto each offer; the buy bakes it into the minion. */
  spellBuffShop: (ctx, _self, params) => {
    const a = num(params.attack, 2) + spellAttackBonus(ctx.state);
    const h = num(params.health, 2) + spellHealthBonus(ctx.state);
    ctx.state.tavernBuyBonus.atk += a;
    ctx.state.tavernBuyBonus.hp += h;
    // Tavern buffs feed Fodder too — enchant the Fodder type run-wide (like Ritualist), so Demons
    // eating Fodder, and any Fodder you take, carry the Staff's buff. A directly-bought Fodder gets it
    // through this enchant, not the buy-buff (the buy path + shop view skip FD to avoid double-applying).
    buffFodderRunWide(ctx.state, a, h, 'Staff of Guel');
  },

  /** Lantern of Souls — cast: your Undead get +`amount` Attack (plus spell power on Attack AND Health)
   *  for the rest of the run, wherever they are — shown on the board in the shop and re-derived at
   *  combat start + on summon/reborn inside `simulate`. */
  spellGrantTribeAttack: (ctx, _self, params) => {
    // Today only Undead is wired (RunState.undead*Bonus); the param keeps the data honest. The base is
    // an Attack buff; spell power folds in on top of BOTH stats (so +1/+1 spells turn +3 into +4/+1).
    if (str(params.tribe) === 'undead') {
      ctx.state.undeadAttackBonus += num(params.amount, 1) + spellAttackBonus(ctx.state);
      ctx.state.undeadHealthBonus += spellHealthBonus(ctx.state);
    }
  },

  /** Growth — cast: buff EVERY friendly minion on the board. Untargeted (runs without a picked target);
   *  scales with spell power like every stat spell (folded through spellStatBonus). */
  spellBuffAll: (ctx, _self, params) => {
    let attack = num(params.attack);
    let health = num(params.health);
    if (attack > 0 || health > 0) {
      attack += spellAttackBonus(ctx.state);
      health += spellHealthBonus(ctx.state);
    }
    const source = str(params._source) || 'Growth';
    for (const card of ctx.state.board) addBuff(card, source, attack, health);
  },

  /** Cupcakes — cast: the chosen Demon (`self`) consumes `count` random tavern minions. Each feeds the Demon
   *  its stats × the Demon's fodder multiplier (Voracious Imp ×2) and fires its on-consume effects (Maw's
   *  shield, etc.) — the normal Consume pipeline + the UI swirl. No-op if the target isn't a Demon. */
  spellDemonConsumeTavern: (ctx, self, params) => {
    if (!self || !isTribe(self, 'demon')) return;
    const count = num(params.count, 3);
    const rng = makeRng(ctx.state.rngCursor);
    const eaten: { eaterUid: string; fodderId: string; attack: number; health: number; gainA: number; gainH: number }[] = [];
    for (let i = 0; i < count && ctx.state.shop.length > 0; i++) {
      const idx = rng.int(ctx.state.shop.length);
      const offer = ctx.state.shop[idx]!;
      const meal = CARD_INDEX[offer.cardId];
      ctx.state.shop.splice(idx, 1);
      if (!meal) continue;
      const mult = fodderMultiplier(self);
      const cb = cardBuff(ctx.state, meal.id);
      const ma = meal.attack + cb.attack + (offer.atk ?? 0);
      const mh = meal.health + cb.health + (offer.hp ?? 0);
      addBuff(self, 'Consume', ma * mult, mh * mult);
      fire(ctx, 'onConsume', { minion: self });
      eaten.push({ eaterUid: self.uid, fodderId: meal.id, attack: ma, health: mh, gainA: ma * mult, gainH: mh * mult });
    }
    ctx.state.rngCursor = rng.state();
    if (eaten.length > 0) {
      ctx.state.fodderEaten = eaten;
      ctx.state.fodderEatenSeq += 1;
    }
  },

  /** Perfect Vision — cast: SET the target's stats to a/h (absolute, not additive). Records the delta as a
   *  tracked buff so the inspect breakdown shows it and the stats land exactly at a/h. No spell-power scaling
   *  (it's a set, not a grant); a repeat cast (Yazzus) is a harmless no-op once the target is already there. */
  spellSetStats: (_ctx, self, params) => {
    const a = num(params.attack, 20);
    const h = num(params.health, 20);
    addBuff(self, str(params._source) || 'Perfect Vision', a - self.attack, h - self.health);
  },

  /** Apples — cast: buff every minion currently in the tavern by +atk/+hp (rides on each offer's `atk`/`hp`,
   *  so a buy bakes it in). Lost on a refresh (fresh offers), kept on a freeze (same offers). Flat. */
  spellBuffTavern: (ctx, _self, params) => {
    const a = num(params.attack, 2);
    const h = num(params.health, 3);
    for (const offer of ctx.state.shop) {
      offer.atk = (offer.atk ?? 0) + a;
      offer.hp = (offer.hp ?? 0) + h;
    }
  },

  /** Fleeting Vigor — cast: bank a one-shot Start-of-Combat buff for the NEXT combat (your minions enter
   *  that fight at +atk/+hp, then it's spent — applied in `faceOmen`). Stacks if cast twice. Flat. */
  spellPendingSCBuff: (ctx, _self, params) => {
    ctx.state.fleetingVigor ??= { attack: 0, health: 0 };
    ctx.state.fleetingVigor.attack += num(params.attack, 2);
    ctx.state.fleetingVigor.health += num(params.health, 1);
  },

  /** Channeling the Devourer — cast: devour the targeted friendly minion (`self`, removed from the
   *  board) and spit its stats onto a RANDOM other friend. It transfers existing stats, so it does NOT
   *  scale with spell power; the `singleCast` flag on its card keeps spell-quantity multipliers from
   *  devouring twice. Records `devourFx` so the UI can fling the stats over as a projectile. */
  spellDevour: (ctx, self) => {
    const board = ctx.state.board;
    const idx = board.indexOf(self);
    if (idx < 0) return;
    const attack = self.attack;
    const health = self.health;
    board.splice(idx, 1); // devour the chosen minion
    if (board.length === 0) return; // nothing left to feed
    const rng = makeRng(ctx.state.rngCursor);
    const recipient = board[rng.int(board.length)]!;
    ctx.state.rngCursor = rng.state();
    addBuff(recipient, 'Channeling the Devourer', attack, health);
    ctx.state.devourFx = { toUid: recipient.uid, attack, health };
  },

  /** Lantern Light — give the target +Tier/+Tier (your current Tavern Tier). Scales with Tier by design
   *  (the spec is exactly +Tier/+Tier), so no spell-power bonus is folded in. */
  spellBuffByTier: (ctx, self, params) => {
    if (!self) return;
    const t = ctx.state.tier;
    addBuff(self, str(params._source) || nameOf(self), t, t);
  },

  /** Fodder Treatment — SELL the target (gain its base sell value as Gold) and spit its current stats onto
   *  your LEFT-MOST Demon, firing that Demon's on-consume payoffs (Pactstone / Maw / Glutton). No Demon →
   *  the stats are wasted, but the sell + Gold still happen. */
  spellSellToDemon: (ctx, self) => {
    if (!self) return;
    const state = ctx.state;
    const idx = state.board.indexOf(self);
    if (idx < 0) return;
    const sold = state.board.splice(idx, 1)[0]!; // counts as a sell
    state.embers += sellValueOf(sold); // the Gold the player gets from the sell
    returnToPool(state, sold.cardId, sold.golden ? 3 : 1);
    const demon = state.board.find((c) => isTribe(c, 'demon')); // left-most Demon (board order)
    if (demon) {
      addBuff(demon, 'Fodder Treatment', sold.attack, sold.health);
      fire(ctx, 'onConsume', { minion: demon });
    }
  },

  /** Point Solution — re-trigger the target's Battlecry (the reducer guards this to Battlecry minions only).
   *  Reuses the Myra-power path, so Drakko's "Battlecries fire extra times" still amplifies it. */
  spellReplayBattlecry: (ctx, self) => {
    if (!self) return;
    replayBattlecry(ctx.state, self);
  },

  /** Chrono Staff — your End-of-Turn effects fire one additional time this turn (a per-turn flag: stacks with
   *  Chronos, not with itself). Read by `endOfTurnRepeats`; reset at the next turn start. */
  spellExtraEndOfTurn: (ctx) => {
    ctx.state.extraEotThisTurn = true;
  },

  /** A minion casts a named spell from an event, auto-targeting the carry (the
   *  highest-attack friend). Counts the cast but doesn't re-fire spellCast (no recursion). */
  castSpell: (ctx, self, params) => {
    const spellDef = CARD_INDEX[str(params.spellId)];
    if (!spellDef || spellDef.singleCast) return; // singleCast spells (Devourer) never multi-fire
    const friends = ctx.state.board.filter((c) => c !== self);
    const target = friends.length ? friends.reduce((a, b) => (b.attack > a.attack ? b : a)) : self;
    applyCastEffects(ctx, spellDef, target);
    ctx.state.spellsCast += 1;
    ctx.state.spellsThisTurn += 1;
  },

  // ─── New content batch (recruit side) ──────────────────────────────────────

  /** Deathswarmer — Battlecry: give your Undead +N Attack wherever they are (board + hand), and stack the
   *  bonus into undeadBuyAtk so future undead buys carry it too. Golden doubles N. */
  battlecryBuffUndeadAttack: (ctx, self, params) => {
    const amount = num(params.amount, 1) * gold(self);
    for (const card of [...ctx.state.board, ...ctx.state.hand]) {
      if (isTribe(card, 'undead')) addBuff(card, nameOf(self), amount, 0);
    }
    ctx.state.undeadBuyAtk = (ctx.state.undeadBuyAtk ?? 0) + amount;
  },

  /** Demonic Anomaly — Battlecry: gain N free refreshes and PERMANENTLY buff every tavern minion +M/+M for
   *  the rest of the run (current AND future offers, like Staff of Guel — folded onto each offer by the shop
   *  view and baked in on buy). Fodder picks it up via the run-wide enchant (the buy path + shop view skip FD
   *  for the buy-bonus to avoid double-applying). Golden doubles both. */
  battlecryFreeRollsAndBuffShop: (ctx, self, params) => {
    const rolls = num(params.rolls, 2) * gold(self);
    const buffAmt = num(params.buff, 3) * gold(self);
    ctx.state.freeRolls += rolls;
    ctx.state.tavernBuyBonus.atk += buffAmt;
    ctx.state.tavernBuyBonus.hp += buffAmt;
    buffFodderRunWide(ctx.state, buffAmt, buffAmt, nameOf(self));
  },

  /** Acid — every N manual refreshes, consume a random non-Fodder offer from the tavern, gaining its stats.
   *  `rollTick` is per-instance on BoardCard and resets each wave in advanceCombat. Golden doubles the gain. */
  onRollConsumeShop: (ctx, self, params) => {
    const every = num(params.every, 4);
    self.rollTick = (self.rollTick ?? 0) + 1;
    if (self.rollTick % every !== 0) return;
    const choices = ctx.state.shop.filter((s) => {
      const def = CARD_INDEX[s.cardId];
      return def && !def.keywords.includes('FD');
    });
    if (choices.length === 0) return;
    const target = pickRandom(ctx.state, choices, 1)[0];
    if (!target) return;
    ctx.state.shop = ctx.state.shop.filter((s) => s !== target);
    const def = CARD_INDEX[target.cardId];
    if (!def) return;
    const atkGain = (def.attack + (target.atk ?? 0)) * gold(self);
    const hpGain = (def.health + (target.hp ?? 0)) * gold(self);
    addBuff(self, nameOf(self), atkGain, hpGain);
  },

  /** Forsaken Weaver (recruit half) — when a spell is cast, give your Undead +N Attack wherever they are
   *  (board + hand), and stack the bonus into undeadBuyAtk for future undead buys. Golden doubles N. */
  spellCastBuffUndeadAttack: (ctx, self, params) => {
    const amount = num(params.attack, 2) * gold(self);
    for (const card of [...ctx.state.board, ...ctx.state.hand]) {
      if (isTribe(card, 'undead')) addBuff(card, nameOf(self), amount, 0);
    }
    ctx.state.undeadBuyAtk = (ctx.state.undeadBuyAtk ?? 0) + amount;
  },
};

/** Fire `onRoll` effects for every board card that has one (Acid's every-N-refresh consume).
 *  Called by the reducer's `roll` case after the tavern is refreshed. */
export function applyOnRoll(state: RunState): void {
  const ctx = makeContext(state);
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.on !== 'onRoll') continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (fn) fn(ctx, card, effect.params ?? {}, { minion: card });
    }
  }
}

/** Open a Discover of up to 3 distinct random spells (Black Belt Brian). Sets `state.discover`; the
 *  reducer's `discover` case resolves the pick into the hand and opens the next queued spec, if any. */
export function offerSpellDiscover(state: RunState): void {
  const rng = makeRng(state.rngCursor);
  const avail = SPELL_CARDS.filter((c) => c.tier <= state.tier);
  const picks: string[] = [];
  for (let i = 0; i < 3 && avail.length > 0; i++) picks.push(avail.splice(rng.int(avail.length), 1)[0]!.id);
  state.rngCursor = rng.state();
  if (picks.length > 0) state.discover = picks;
}

/** Whether a card has a Battlecry (an onPlay effect). Choose One is its OWN keyword, not a Battlecry —
 *  so it doesn't count for Drakko's quest or Help Wanted's Discover-a-Battlecry filter. */
export function hasBattlecry(c: (typeof BUYABLE_CARDS)[number]): boolean {
  return c.effects.some((e) => e.on === 'onPlay');
}

/** Whether a card has a Deathrattle (an `onDeath` effect whose factory is a `deathrattle*`). Mirrors the
 *  combat-side check — friend-death watchers (Brood Matron) don't count as Deathrattles. */
export function hasDeathrattle(c: (typeof BUYABLE_CARDS)[number]): boolean {
  return c.effects.some((e) => e.on === 'onDeath' && e.do.startsWith('deathrattle'));
}

/** Resolve a `DiscoverSpec`'s string filter id back to a card predicate (closures aren't serializable). */
function discoverFilter(id: 'battlecry' | 'deathrattle'): (c: (typeof BUYABLE_CARDS)[number]) => boolean {
  if (id === 'battlecry') return hasBattlecry;
  if (id === 'deathrattle') return hasDeathrattle;
  return () => true;
}

/**
 * Offer a Discover (3 distinct, pool-filtered cards), weighing every eligible card EVENLY — no high-tier
 * bias, the same rule as the flattened shop + spell Discover. Modes via `opts`:
 *   • default (Sea Urchin, Help Wanted): all cards UP TO `discoverTier`, uniform.
 *   • `tier` fixed (Sprout → 1): exactly that tier, uniform.
 *   • `topTierFirst` — the ONE high-tier exception, set only by the golden/triple reward ("peek one tier
 *     up"): fill from the top tier down, walking the floor down only if the top tier can't supply 3.
 * A card `filter` (Help Wanted → Battlecry minions) and `tribe`/`exclude` (Sea Urchin → Beasts, not itself)
 * apply in every mode.
 */
export function offerDiscover(
  state: RunState,
  discoverTier: number,
  opts?: { tier?: number; filter?: (c: (typeof BUYABLE_CARDS)[number]) => boolean; tribe?: Tribe; exclude?: string; topTierFirst?: boolean },
): void {
  const baseFilter = opts?.filter ?? (() => true);
  const tribe = opts?.tribe;
  const exclude = opts?.exclude;
  // Tribe-filtered Discover (Sea Urchin → Beasts only): AND the tribe check into the card filter so both
  // the fixed-tier and tiered pool branches below pick it up (dual-types count). `exclude` drops the source
  // card (Sea Urchin can't Discover itself).
  const filter = (c: (typeof BUYABLE_CARDS)[number]): boolean =>
    baseFilter(c) && c.id !== exclude && (!tribe || c.tribe === tribe || c.tribe2 === tribe);
  let pool: typeof BUYABLE_CARDS = [];
  if (opts?.tier !== undefined) {
    // Fixed-tier Discover (Sprout): exactly that tier, no floor-walking.
    pool = BUYABLE_CARDS.filter(
      (c) =>
        c.tier === opts.tier &&
        (c.tribe === 'neutral' || state.tribes.includes(c.tribe)) &&
        (state.pool[c.id] ?? 0) > 0 &&
        filter(c),
    );
  } else if (opts?.topTierFirst) {
    // Golden/triple reward only ("peek one tier up"): bias to the highest tier — fill from the top tier
    // down, walking the floor down only if the top tier can't supply 3. The single high-tier exception.
    const target = Math.min(CONFIG.maxTier, discoverTier);
    let floor = target;
    while (pool.length < 3 && floor >= 1) {
      pool = BUYABLE_CARDS.filter(
        (c) =>
          c.tier <= target &&
          c.tier >= floor &&
          (c.tribe === 'neutral' || state.tribes.includes(c.tribe)) &&
          (state.pool[c.id] ?? 0) > 0 &&
          filter(c),
      );
      floor--;
    }
  } else {
    // Card-driven Discover up to the tavern tier (Sea Urchin, Help Wanted): EVERY eligible card at or below
    // the target tier, weighed EVENLY — no high-tier bias (same rule as the shop + spell Discover).
    const target = Math.min(CONFIG.maxTier, discoverTier);
    pool = BUYABLE_CARDS.filter(
      (c) =>
        c.tier <= target &&
        (c.tribe === 'neutral' || state.tribes.includes(c.tribe)) &&
        (state.pool[c.id] ?? 0) > 0 && // only offer cards with copies left — Discover draws from the finite pool
        filter(c),
    );
  }
  if (pool.length === 0) return;
  const rng = makeRng(state.rngCursor);
  const avail = [...pool];
  const picks: string[] = [];
  for (let i = 0; i < 3 && avail.length > 0; i++) {
    picks.push(avail.splice(rng.int(avail.length), 1)[0]!.id);
  }
  state.rngCursor = rng.state();
  state.discover = picks;
}

/** Open one Discover described by `spec` — a spell Discover or a (tiered / fixed-tier / filtered) minion
 *  Discover. The single place a `DiscoverSpec` becomes a live `state.discover` offer. */
export function openDiscover(state: RunState, spec: DiscoverSpec): void {
  if (spec.kind === 'spell') {
    offerSpellDiscover(state);
  } else {
    offerDiscover(state, spec.tier, {
      tier: spec.exactTier,
      tribe: spec.tribe,
      exclude: spec.exclude,
      filter: spec.filter ? discoverFilter(spec.filter) : undefined,
      topTierFirst: spec.topTierFirst,
    });
  }
}

/**
 * Open a Discover for `spec` now, or queue it if one is already open. The backbone for stacking
 * Discovers: a Drakko-doubled Black Belt Brian, a golden Brian, and Yazzus-multiplied Help Wanted /
 * Sprout all route every extra Discover through here. The `discover` case shifts the queue forward
 * as each pick resolves, so the offers appear one at a time in order.
 */
export function queueDiscover(state: RunState, spec: DiscoverSpec): void {
  if (state.discover) {
    (state.discoverQueue ??= []).push(spec);
  } else {
    openDiscover(state, spec);
    // Defensive: if the offer couldn't open (empty pool), don't strand a queue behind a closed Discover.
    if (!state.discover && state.discoverQueue && state.discoverQueue.length > 0) {
      const nextSpec = state.discoverQueue.shift()!;
      queueDiscover(state, nextSpec);
    }
  }
}

/**
 * Total +X/+X bonus applied to stat-granting spells, from every active source (the Spellbinder hero
 * now; spell-buffing cards later just add here). This is the SINGLE source of truth — the reducer
 * applies it (`spellBuffTarget`) and the UI displays it (`spellDisplayText`), so a spell card always
 * shows its real value. New spell-buff effects should fold into this one function.
 */
export function spellStatBonus(state: RunState): number {
  let bonus = 0;
  if (getHero(state.heroId).power.kind === 'spellAmplify') bonus += spellAmplifyBonus(state.wave);
  // Harry Botter (Mech) — a passive aura: your spells get +1/+1 (golden +2/+2) per Harry Botter on the
  // board, PLUS any aura welded onto a host Mech (`spellAuraBonus`, set by `applyWeld`). Generic over
  // `def.spellAura` so future aura cards fold in automatically.
  for (const c of state.board) {
    bonus += (CARD_INDEX[c.cardId]?.spellAura ?? 0) * (c.golden ? 2 : 1) + (c.spellAuraBonus ?? 0);
  }
  return bonus;
}

/**
 * The total +Attack a stat-granting spell gains: the hero's symmetric amplify (`spellStatBonus`) PLUS
 * the run-wide card-driven spell ATTACK bonus (`spellBonus.attack` — Skullblade). The single source of
 * truth for a spell's bonus Attack; the cast factories add this to the spell's Attack, and the display
 * mirrors it. Optional-chained for old saves.
 */
export function spellAttackBonus(state: RunState): number {
  return spellStatBonus(state) + (state.spellBonus?.attack ?? 0);
}

/**
 * The total +Health a stat-granting spell gains: the hero's symmetric amplify PLUS the run-wide
 * card-driven spell HEALTH bonus (`spellBonus.health` — Cinderwing Matron). Sibling of
 * `spellAttackBonus` for the Health stat.
 */
export function spellHealthBonus(state: RunState): number {
  return spellStatBonus(state) + (state.spellBonus?.health ?? 0);
}

/**
 * A spell's display text with its stat value updated to reflect spell power (and highlighted green via
 * `{{…}}`). `bonusA` is the +Attack bonus; `bonusH` the +Health bonus (defaults to `bonusA` so existing
 * symmetric callers — and the hero amplify — read `spellDisplayText(id, bonus)` unchanged). Returns the
 * base text for non-stat spells or a zero bonus. Convention: a stat spell's text shows "+A/+B" matching
 * its `spellBuffTarget` params, so it can be substituted.
 */
export function spellDisplayText(cardId: string, bonusA: number, escalation = 0, bonusH = bonusA): string {
  const def = CARD_INDEX[cardId];
  if (!def) return '';
  // Front to Back (escalating): the printed text carries TWO "+B/+B" groups — the GRANT (slot 0) and the
  // per-cast IMPROVEMENT (slot 1). The grant = base + accumulated escalation + spell power. The improvement
  // is the escalation step (= base) and ALSO picks up spell power, so both numbers scale together and read
  // consistently. Each slot is highlighted (green) only once it's actually above its printed base.
  const esc = def.effects.find((e) => e.do === 'spellBuffTargetEscalating');
  if (esc) {
    let slot = 0;
    return def.text.replace(/\+(\d+)\/\+(\d+)/g, (m, a: string, h: string) => {
      const na = Number(a);
      const nh = Number(h);
      if (slot++ === 0) {
        const va = na + escalation + bonusA;
        const vh = nh + escalation + bonusH;
        return escalation + bonusA > 0 || escalation + bonusH > 0 ? `{{+${va}/+${vh}}}` : m;
      }
      const ia = na + bonusA;
      const ih = nh + bonusH;
      return bonusA > 0 || bonusH > 0 ? `{{+${ia}/+${ih}}}` : m;
    });
  }
  if (bonusA <= 0 && bonusH <= 0) return def.text;
  // Lantern of Souls: base "+N Attack" → "+{N+bonusA}/+{bonusH}" (spell power folds onto both stats).
  const tribeBuff = def.effects.find((e) => e.do === 'spellGrantTribeAttack');
  if (tribeBuff) {
    const amt = Number((tribeBuff.params as { amount?: number } | undefined)?.amount ?? 0);
    return def.text.replace(`+${amt} Attack`, `{{+${amt + bonusA}/+${bonusH}}}`);
  }
  // Staff of Guel: its "+A/+B" tavern-buy buff scales with spell power on both stats too.
  const shopBuff = def.effects.find((e) => e.do === 'spellBuffShop');
  if (shopBuff) {
    const a = Number((shopBuff.params as { attack?: number } | undefined)?.attack ?? 2);
    const h = Number((shopBuff.params as { health?: number } | undefined)?.health ?? 2);
    return def.text.replace(`+${a}/+${h}`, `{{+${a + bonusA}/+${h + bonusH}}}`);
  }
  const eff = def.effects.find((e) => e.do === 'spellBuffTarget' || e.do === 'spellBuffAll');
  if (!eff) return def.text;
  const ba = Number((eff.params as { attack?: number } | undefined)?.attack ?? 0);
  const bh = Number((eff.params as { health?: number } | undefined)?.health ?? 0);
  if (ba <= 0 && bh <= 0) return def.text;
  return def.text.replace(`+${ba}/+${bh}`, `{{+${ba + bonusA}/+${bh + bonusH}}}`);
}

/** Apply a spell's `cast` effects to its chosen target. The spell's name is injected as `_source`
 *  so target buffs (Spirit Fire) record it for the inspect breakdown. */
function applyCastEffects(ctx: RecruitContext, spellDef: CardDef, target?: BoardCard): void {
  for (const effect of spellDef.effects) {
    if (effect.on !== 'cast') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    // Board-wide cast effects (Growth) ignore `self`; targeted ones (Spirit Fire) always get a target.
    // `_source` labels target buffs in the inspect breakdown; `_maxTier` carries the spell's gild cap
    // (Eyes of Aresmar) down to the factory.
    const params = { ...(effect.params ?? {}), _source: spellDef.name, _maxTier: spellDef.targetMaxTier };
    if (fn) fn(ctx, target as BoardCard, params, { minion: target as BoardCard });
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

/**
 * Fire the on-summon buffs (Mama Bear, Kennelmaster, Spirit Worgen, …) for a minion entering play — the same
 * trigger `playCard` fires. Exposed so the magnetize path can run it on a Magnetic minion BEFORE it welds: the
 * absorbed body picks up any tribe summon-buff (Symbiotic Attachment counts as a Beast → Mama Bear) and then
 * carries those stats into the host. The minion need not be on the board — board handlers buff the payload.
 */
export function fireSummonBuffs(state: RunState, minion: BoardCard): void {
  fire(makeContext(state), 'onSummon', { minion });
}

function makeContext(state: RunState): RecruitContext {
  const ctx: RecruitContext = {
    state,
    summon: (card, nearUid) => {
      if (state.board.length >= CONFIG.boardMax) {
        // Overflow — the summon can't fit the full board. Flowing Monk pays off on the wasted body.
        for (const c of [...state.board]) {
          const def = CARD_INDEX[c.cardId];
          if (!def) continue;
          for (const effect of def.effects) {
            if (effect.on !== 'summonOverflow') continue;
            const fn = RECRUIT_FACTORIES[effect.do];
            if (fn) fn(ctx, c, effect.params ?? {}, { minion: c });
          }
        }
        return undefined;
      }
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

/** "Best single copy, no stacking, golden = +2" repeat count, shared by Drakko (Battlecries) and Chronos
 *  (End-of-Turn). Returns 1 + (2 if any golden copy of `cardId`, else 1 if any copy, else 0). */
function bestCopyRepeats(state: RunState, cardId: string): number {
  const copies = state.board.filter((c) => c.cardId === cardId);
  return 1 + (copies.some((c) => c.golden) ? 2 : copies.length > 0 ? 1 : 0);
}

/** Drakko the Drummer: your Battlecries fire extra times (golden Drakko +2; best one only, no stacking). */
function drummerRepeats(state: RunState): number {
  return bestCopyRepeats(state, 'drummer');
}

/** How many times End-of-Turn effects fire this turn: 1, +1 per Chronos (best one only — golden Chronos
 *  adds 2, no stacking). Exported so the UI can replay each proc the matching number of times. */
export function chronosRepeats(state: RunState): number {
  return bestCopyRepeats(state, 'chronos');
}

/** How many times End-of-Turn effects fire this turn: Chronos's repeats PLUS Chrono Staff's one-shot extra
 *  (a per-turn flag — stacks with Chronos, not with itself). The real End of Turn and its UI preview/telegraph
 *  all read this so they agree. (Djinn's manual "proc one now" stays on plain chronosRepeats.) */
export function endOfTurnRepeats(state: RunState): number {
  return chronosRepeats(state) + (state.extraEotThisTurn ? 1 : 0);
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

/** Fire a single card's `onGainAttack` recruit effects (Hunter) — called by the reducer boundary for every
 *  board minion whose Attack rose during a recruit action (any source: Fortify, spells, tribe Battlecries,
 *  weld, triples). Matches combat's `onGainAttack` semantics (only the minion whose Attack rose reacts). The
 *  combat path is separate (the bus emits onGainAttack inside `simulate`'s `ctx.buff`), so this never
 *  double-fires across the two phases. */
export function fireOnGainAttack(state: RunState, card: BoardCard): void {
  const def = CARD_INDEX[card.cardId];
  // Fast path: the reducer calls this for EVERY board minion whose Attack rose, so bail before the
  // (relatively costly) makeContext unless this card actually has a dispatchable onGainAttack reactor.
  if (!def || !def.effects.some((e) => e.on === 'onGainAttack' && RECRUIT_FACTORIES[e.do])) return;
  const ctx = makeContext(state);
  for (const effect of def.effects) {
    if (effect.on !== 'onGainAttack') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) fn(ctx, card, effect.params ?? {}, { minion: card });
  }
}

/** Resolve a chosen Choose One option's effects on the played card. Choose One is its own keyword,
 *  NOT a Battlecry — it does not synergize with Drakko (no doubling) and does not notify
 *  battlecry-triggered watchers (Karwind / Bane). The chosen option's effects resolve exactly once. */
export function applyChooseOne(state: RunState, card: BoardCard, effects: CardDef['effects']): void {
  state.karwindFlash = []; // Choose One never procs Karwind; clear any stale flash from a prior play
  const ctx = makeContext(state);
  for (const effect of effects) {
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) fn(ctx, card, effect.params ?? {}, { minion: card });
  }
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

/**
 * Myra's hero power: re-fire a friendly minion's Battlecry (its `onPlay` effects) right now —
 * honoring Drakko repeats + Karwind, exactly as a fresh play would. Targeted Battlecries re-fire
 * with no explicit target, so their auto-pick fallback chooses (Toxin Tender → the best friend);
 * a targeted Battlecry with no eligible friend simply no-ops, and a
 * Choose One minion has no `onPlay` effects so it isn't a valid target. Returns whether a Battlecry
 * fired — the hero charge is only spent when it did.
 */
export function replayBattlecry(state: RunState, card: BoardCard): boolean {
  const def = CARD_INDEX[card.cardId];
  if (!def) return false;
  const onPlay = def.effects.filter((e) => e.on === 'onPlay');
  if (onPlay.length === 0) return false;
  state.karwindFlash = [];
  const ctx = makeContext(state);
  const repeats = drummerRepeats(state);
  for (const effect of onPlay) {
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    for (let r = 0; r < repeats; r++) fn(ctx, card, effect.params ?? {}, { minion: card });
  }
  for (let r = 0; r < repeats; r++) fireBattlecryTriggered(state); // a Battlecry → procs Karwind
  if (state.karwindFlash && state.karwindFlash.length) state.karwindFlashSeq = (state.karwindFlashSeq ?? 0) + 1;
  return true;
}

/**
 * Replay ONE economy Battlecry that Ryme re-fired in combat, at SETTLE. The combat-meaningful battlecries
 * (summon / buff / discover / grant-keyword / spell-power — `COMBAT_REPLAYABLE_BATTLECRIES`) already resolved
 * IN the fight; this runs the REST (Soulfeeder's Fodder, Hoarder's Gold, Demonic Anomaly's shop buff, a
 * gain-a-minion) through their real recruit factory, which needs the RunState (tavern / Gold / hand) the pure
 * combat sim doesn't have. Called once per recorded re-fire — Drakko's doubling is already baked into the
 * count, so NO extra repeats here. `golden` mirrors the re-fired minion so the factory's golden doubling is
 * correct. Karwind/Bane already procced in combat (the `battlecryTriggered` event), so no re-proc here.
 */
export function replayEconomyBattlecry(state: RunState, cardId: string, golden: boolean): void {
  const def = CARD_INDEX[cardId];
  if (!def) return;
  const economy = def.effects.filter((e) => e.on === 'onPlay' && !COMBAT_REPLAYABLE_BATTLECRIES.has(e.do));
  if (economy.length === 0) return;
  const self: BoardCard = {
    uid: 'ryme-bc', cardId, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden,
  };
  const ctx = makeContext(state);
  for (const effect of economy) {
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) fn(ctx, self, effect.params ?? {}, { minion: self });
  }
}

/**
 * Dusk's hero power: proc a friendly minion's End of Turn effect right now (an extra trigger),
 * honoring Chronos repeats — exactly like the natural end-of-turn, but for one chosen minion.
 * Returns whether anything fired (the charge is only spent when it did).
 */
export function replayEndOfTurn(state: RunState, card: BoardCard): boolean {
  const def = CARD_INDEX[card.cardId];
  if (!def) return false;
  const eot = def.effects.filter((e) => e.on === 'endOfTurn');
  if (eot.length === 0) return false;
  const ctx = makeContext(state);
  const repeats = chronosRepeats(state);
  for (const effect of eot) {
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    for (let r = 0; r < repeats; r++) fn(ctx, card, effect.params ?? {}, { minion: card, proc: r, replay: true });
  }
  return true;
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
  const demons = state.board.filter((c) => isTribe(c, 'demon')); // dual-types (Bane = Dragon/Demon) eat too
  if (demons.length === 0) return;
  const rng = makeRng(state.rngCursor);
  const ctx = makeContext(state);
  const eaten: { eaterUid: string; fodderId: string; attack: number; health: number; gainA: number; gainH: number }[] = [];
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
    // Record the Fodder's *effective* (buffed) stats for the ghost, and the eater's actual gain (× mult)
    // so the UI can float the +X/+X on the eater (the shop-phase buff float).
    eaten.push({ eaterUid: eater.uid, fodderId: fodder.id, attack: fa, health: fh, gainA: fa * mult, gainH: fh * mult });
    // Track raw fodder stats (pre-multiplier) for Abhorrent Horror's SoC window.
    state.fodderConsumedThisTurn ??= { attack: 0, health: 0 };
    state.fodderConsumedThisTurn.attack += fa;
    state.fodderConsumedThisTurn.health += fh;
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
  applyCastEffects(ctx, spellDef, target); // board-wide spells (Growth) run without a target
  // Untargeted "run" cast effects (e.g. Ember Pouch) act on the run, not a minion.
  // Embers are uncapped within a turn (like selling), so no max-embers clamp here.
  for (const effect of spellDef.effects) {
    if (effect.on === 'cast' && effect.do === 'gainEmbers') state.embers += num(effect.params?.amount);
  }
  state.spellsCast += 1;
  state.spellsThisTurn += 1;
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

/** Cast a stat/keyword spell onto a TAVERN OFFER (`target: 'any'` spells like Shatter, Front to Back).
 *  Builds a throwaway BoardCard from the offer's current state, runs the normal cast effects on it, then
 *  folds the net stat + added-keyword changes back onto the ShopCard so they bake in when bought (the way
 *  the Fortify hero power's offer buff already does). The rest of `castSpell` (tally, spell power,
 *  spellCast triggers) still runs on the run. NB: a spell that *removes* a base keyword can't subtract it
 *  from an offer (offers only carry added keywords) — a rare edge that resolves once the minion is bought. */
export function castSpellOnOffer(state: RunState, spellDef: CardDef, offer: ShopCard): void {
  const card = CARD_INDEX[offer.cardId];
  if (!card) return;
  const base = card.keywords;
  const temp: BoardCard = {
    uid: offer.uid,
    cardId: offer.cardId,
    tribe: card.tribe,
    attack: card.attack + (offer.atk ?? 0),
    health: card.health + (offer.hp ?? 0),
    keywords: [...base, ...(offer.keywords ?? []).filter((k) => !base.includes(k))],
    golden: false,
  };
  castSpell(state, spellDef, temp);
  offer.atk = temp.attack - card.attack;
  offer.hp = temp.health - card.health;
  offer.keywords = temp.keywords.filter((k) => !base.includes(k)); // keep only the keywords the spell added
}

/** End-of-Turn triggers — fire when the recruit turn ends (End Turn / timer hits 0),
 *  just before the board faces the Omen. Each minion's effect acts on itself. */
export function applyEndOfTurn(state: RunState): void {
  const ctx = makeContext(state);
  const repeats = endOfTurnRepeats(state); // Chronos + Chrono Staff: End-of-Turn effects trigger extra times
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
 * Per-proc preview of the End-of-Turn effects, for the recruit UI to animate the stats rising one
 * proc at a time. Returns one cumulative snapshot (per-uid current stats) *after* each (card × repeat)
 * step, in the same order the UI plays its beats — so the board can show the gain land on each beat.
 * Runs on a throwaway clone (no side effects); the final entry equals the real end-of-turn result.
 */
export function projectEndOfTurnSteps(state: RunState): Array<Record<string, { attack: number; health: number }>> {
  const clone = structuredClone(state);
  const ctx = makeContext(clone);
  const repeats = endOfTurnRepeats(clone);
  const steps: Array<Record<string, { attack: number; health: number }>> = [];
  const snap = (): Record<string, { attack: number; health: number }> => {
    const m: Record<string, { attack: number; health: number }> = {};
    for (const c of [...clone.board, ...clone.hand]) m[c.uid] = { attack: c.attack, health: c.health };
    return m;
  };
  for (const card of [...clone.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def?.effects.some((e) => e.on === 'endOfTurn')) continue;
    for (let r = 0; r < repeats; r++) {
      for (const effect of def.effects) {
        if (effect.on !== 'endOfTurn') continue;
        const fn = RECRUIT_FACTORIES[effect.do];
        if (fn) fn(ctx, card, effect.params ?? {}, { minion: card, proc: r });
      }
      steps.push(snap());
    }
  }
  return steps;
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
