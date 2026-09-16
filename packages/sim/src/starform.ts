/**
 * THE STARFORM — set 3 Celestials' shop token (owner design 2026-09-12; rules v2 2026-09-13; every rule below is
 * a ruling and each is pinned in `starform.test.ts`).
 *
 * A 1/1 Celestial TOKEN (`ce3_starform`) that lives IN THE SHOP as an ordinary shop offer — not on the board,
 * not in hand. Cards create it (Star Seed & co.), grow it, and finally cash it in:
 *
 *   1. CREATED into the right-most Shop slot. A full row: it CONSUMES the right-most Shop minion (the offer is
 *      removed, the Starform gains that offer's buy stats — a real Shop consume, with every watcher and tally
 *      a Demon's consume touches) and takes its slot. Spell / Ruby offers are skipped leftward; a full row with
 *      no minion at all still gets the token (appended — the one case the row overflows by one, until the
 *      next roll re-fits it).
 *   2. ONLY ONE at a time — `createStarform` is a no-op while one exists (`hasStarform` / `starformOf` let a
 *      card do "give it +2/+2 instead").
 *   3. PERSISTS through refreshes IN ITS OWN SLOT (`withStarformPinned` re-inserts it at its previous index,
 *      clamped, after every row rebuild — the kept-offers-to-the-left rule never moves it), across turns and
 *      combat, and under Freeze, until consumed / collapsed / destroyed.
 *   4. Refresh-time slot buffs (Market Tormentor's right-most enchant, Rune of the Embers, the Display Case,
 *      Veinstorm's stamp) land on it ONCE — the first refresh it sits in the slot — never again
 *      (`starformRefreshLand`, latched per source on the offer). Play-time right-most buffs are unaffected.
 *   5. IT HAS A PRICE (rule A, 2026-09-13). It spawns at 6 Gold (`STARFORM_START_PRICE`, on `ShopCard.cost`);
 *      every refresh — paid or free, any `roll` — knocks 1 off (floor 0, `starformRefreshTick`); the reduction
 *      SURVIVES the turn boundary (a 3-Gold Starform is 3 Gold next turn); a NEW token (Zenith's rebirth
 *      included) starts at 6 again. `offerBuyPrice` reads it like any set price, so every regular discount
 *      (Thymepiece, Trade-In, Cadence, the Friends-and-Family Gift, the free first buy) applies.
 *      BUYING IT = YOUR LEFT-MOST CELESTIAL CONSUMES IT (rule B): the Gold is spent, the token leaves through
 *      the consume path (`buyStarform` → `starformRemoved('consume')`, so Zenith re-creates and Twin Star hears
 *      the receiver's gain exactly as for Corona Devotee) and the left-most board Celestial (index 0 first)
 *      gains its FULL stats. With NO Celestial on board the buy still takes the Gold and the token is simply
 *      lost — treated as consumed with the stats going nowhere (reason `consume`, so Zenith still re-creates).
 *      The buy COUNTS as a minion bought (onBuy watchers, cardsBought, quest / rune / hero tallies) but puts
 *      nothing in hand and returns nothing to the pool. Never gilded, never tripled, never held / laid away,
 *      never Discovered-into, never displaced, never stolen to hand. For everything ELSE it is a regular Shop
 *      minion: random-shop picks, Demon consumes, "this shop" buffs, hero powers aimed at a shop minion, spells
 *      cast on offers.
 *   6. PRINTED STATS ARE THE COUNTER — no rules text. Its whole total is BAKED onto the offer (`atk` / `hp` +
 *      the `buffs` ledger): direct buffs, the permanent shop channel (`applyRunShopBuff`), the this-turn shop
 *      channel (`addTurnShopBuff`) and consumes all fold in as they happen, so the refresh that clears the
 *      per-turn layer for every other offer leaves the Starform's total intact. `offerBuyStats` reads
 *      base + atk/hp for it and NEVER the live channels (they would pay twice).
 *   7. CONSUME (the buy) = 100% of its stats to one Celestial; COLLAPSE (Corona Devotee — rule D) = HALF its
 *      stats, rounded up, base included, to 2 UNIQUE random friendly Celestials PLUS
 *      `collapseExtraTargetsOf(state)` extra hits drawn WITH replacement (an extra may land on a Celestial that
 *      already took a hit). 1 Celestial: 1 original + every extra on it. 0: the token still collapses, the stats
 *      go nowhere. With no Starform both do nothing. `consumeStarform` / `collapseStarform` remove the token and
 *      RETURN its stats — the card factories distribute them.
 *   8. Two board-wide watcher triggers: `starformGained` (Twin Star — payload carries the delta; fired from
 *      `buffStarform`, from the Starform's own consume, and from the action-boundary diff in `reduce` for every
 *      other growth path) and `starformRemoved` (reason `consume` | `collapse` + full stats).
 *   9. STAR DESTROYER (rule C): while a Starform exists the player holds the `star_destroyer` Equipment — a
 *      standard Equipment whose SOURCE is the token's offer (`syncStarDestroyer`). Activating it is THE SILENT
 *      EXIT (`destroyStarform`): the offer leaves the Shop and nothing else fires — no consume, no collapse, no
 *      `starformRemoved` (Zenith does not re-create), no `starformGained`, not a buy, no pull FX.
 *
 * `run.shop` already persists, so the token saves / restores with the row (price included); nothing else to carry.
 */
import { makeRng, type CardDef } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { BoardCard, RunState, ShopCard } from './state';
import { addBuff, addOfferBuff, consumeShopOffer, fireStarformGained, fireStarformRemoved, isTribe, offerBuyStats, rightmostShopMinion } from './recruit';
import { syncStarDestroyer } from './equipment';
import { tierSlots } from './shop';

export const STARFORM_ID = 'ce3_starform';
/** Rule 5: the price a fresh token spawns at. */
export const STARFORM_START_PRICE = 6;

export type StarformRemovedReason = 'consume' | 'collapse';

/** The Starform's LIVE PRICE (rule 5): `cost` on the offer, 6 for a token from before the field existed. */
export function starformPrice(state: RunState): number | null {
  const sf = starformOf(state);
  return sf ? (sf.cost ?? STARFORM_START_PRICE) : null;
}

/** Rule 5: a refresh (any `roll`, paid or free) knocks 1 Gold off the token's price, floor 0. Called by the
 *  reducer's `roll` case AFTER the row rebuilt (the token survived it, rule 3). No-op without a Starform. */
export function starformRefreshTick(state: RunState): void {
  const sf = starformOf(state);
  if (!sf) return;
  sf.cost = Math.max(0, (sf.cost ?? STARFORM_START_PRICE) - 1);
}

/** Is this offer the run's Starform? (The flag is the identity — the cardId alone is not: a plain `ce3_starform`
 *  offer could in principle be scripted into a tutorial row, and it would then be an ordinary minion.) */
export function isStarformOffer(offer: ShopCard | undefined): boolean {
  return !!offer?.starform;
}

export function hasStarform(state: RunState): boolean {
  return state.shop.some((o) => o.starform);
}

export function starformOf(state: RunState): ShopCard | undefined {
  return state.shop.find((o) => o.starform);
}

export function starformIndex(state: RunState): number {
  return state.shop.findIndex((o) => o.starform);
}

/** The Starform's LIVE full stats — base 1/1 + everything baked onto the offer. Null with no Starform. */
export function starformStats(state: RunState): { attack: number; health: number } | null {
  const sf = starformOf(state);
  return sf ? offerBuyStats(state, sf) : null;
}

/**
 * Give the Starform +attack/+health under `source` (the ledger line the inspect panel prints) and tell the
 * board (`starformGained`). Records the fired delta on the per-action ledger so the action-boundary diff in
 * `reduce` does not dispatch the same gain twice. A no-op with no Starform or a non-positive delta.
 */
export function buffStarform(state: RunState, attack: number, health: number, source: string): boolean {
  const sf = starformOf(state);
  if (!sf) return false;
  const a = Math.max(0, attack), h = Math.max(0, health);
  if (a === 0 && h === 0) return false;
  addOfferBuff(sf, source, a, h);
  noteStarformGain(state, a, h);
  fireStarformGained(state, a, h);
  return true;
}

/** Book a gain as ALREADY dispatched this action (see `RunState.starformGainFired`). */
function noteStarformGain(state: RunState, attack: number, health: number): void {
  const cur = state.starformGainFired ?? { attack: 0, health: 0 };
  state.starformGainFired = { attack: cur.attack + attack, health: cur.health + health };
}

/**
 * Called by every writer of the two run-wide shop channels (`applyRunShopBuff`, the arena's `gainShopBuff`,
 * the combat carry-back, `addTurnShopBuff`): the Starform banks the buff onto its own offer (rule 6).
 */
export function starformFollowShopBuff(state: RunState, attack: number, health: number, source: string): void {
  if (!hasStarform(state)) return;
  buffStarform(state, attack, health, source);
}

/**
 * Rule 4's gate. `true` = the refresh-time buff `key` may land on `offer` now. Always true for an ordinary
 * offer; for a Starform, true exactly once per key (latched on the offer), false on every later refresh.
 */
export function starformRefreshLand(offer: ShopCard, key: 'tormentor' | 'embers' | 'displayCase' | 'veinstorm'): boolean {
  if (!offer.starform) return true;
  const landed = offer.refreshLanded ?? [];
  if (landed.includes(key)) return false;
  offer.refreshLanded = [...landed, key];
  return true;
}

/**
 * Rule 3's mechanism. Lift the Starform out of the row, let `rebuild` rewrite `state.shop` however it likes
 * (a roll, a Muster, a spell shop, a Membrance restock), then put the token back at the RIGHT-MOST slot
 * (owner 2026-09-14: "players may drag it in shop, but upon a refresh it should be the right-most minion" —
 * until then it kept whatever index it had been dragged to). `slots` tells the rebuild how many offers it may
 * draw: one fewer than the tier allows while a Starform holds a slot (it takes a slot, rule 1). Its latches
 * ride along untouched, which is what makes rule 4's "once" survive a roll.
 */
export function withStarformPinned(state: RunState, rebuild: (slots: number) => void): void {
  const idx = starformIndex(state);
  const full = tierSlots(state.tier);
  if (idx < 0) { rebuild(full); return; }
  const [sf] = state.shop.splice(idx, 1);
  rebuild(Math.max(0, full - 1));
  state.shop.push(sf!);
}

/** The BoardCard-shaped stand-in a Starform presents to watcher payloads (`onConsume`'s eater, `onBuy`'s bought
 *  body). Same uid as the offer, so a record keyed by it (`shopEaten.eaterUid`) points back at the token. */
export function starformStandIn(state: RunState, sf: ShopCard): BoardCard {
  const st = offerBuyStats(state, sf);
  return { uid: sf.uid, cardId: STARFORM_ID, tribe: 'celestial', attack: st.attack, health: st.health, keywords: [], golden: false };
}

/**
 * Record one Starform pull on the per-action `starformFx` channel for the UI's authored `starform-pull` def
 * (owner 2026-09-12). `fromUid` is the thing being consumed, `toUids` the thing(s) gaining. Presentation only —
 * nothing reads it back in the sim; `reduce` clears it per action. `?? 0` on the seq: a save from before the
 * field existed restores without it, and `undefined + 1` would poison the UI's seq compare with NaN.
 */
function recordStarformFx(state: RunState, kind: 'consumeShop' | 'consumed' | 'collapse' | 'created', fromUid: string, toUids: string[]): void {
  state.starformFx = [...(state.starformFx ?? []), { kind, fromUid, toUids }];
  state.starformFxSeq = (state.starformFxSeq ?? 0) + 1;
}

/**
 * Rule 1. Create the Starform into the right-most Shop slot. Returns the offer, or the EXISTING one when a
 * Starform is already out (rule 2 — a no-op; the caller decides what "instead" means). `source` names the card
 * that made it, for the ledger of any stats the creation itself banks.
 *
 * The token arrives carrying the standing shop channels (the permanent `tavernBuyBonus` and this turn's
 * `tavernBuyBonusTurn`) — every other offer in the row shows them, so a fresh Starform does too — baked under
 * their names (rule 6). When the row is full it eats the right-most minion first, via the shared consume body,
 * so `shopMinionsEaten`, `fodderEaten`-style records, Open Market, the Banquet and every `onConsume` watcher
 * see exactly a Demon's Shop consume.
 */
export function createStarform(state: RunState, source: { cardId: string; name: string }): ShopCard {
  const existing = starformOf(state);
  if (existing) return existing;
  const sf: ShopCard = { uid: `s${state.uidSeq++}`, cardId: STARFORM_ID, starform: true, cost: STARFORM_START_PRICE };
  const full = state.shop.length >= tierSlots(state.tier);
  const victim = full ? rightmostShopMinion(state) : -1;
  if (victim >= 0) {
    // The eaten offer's stats are read BEFORE it leaves (the consume body does that) and land on the token
    // through `gain` once the Starform is in the row — so `starformGained` fires against a real offer.
    const banked = { attack: 0, health: 0 }; // accumulated: a Bottomless Banquet second bite adds to it
    const eaterStandIn: BoardCard = { uid: sf.uid, cardId: STARFORM_ID, tribe: 'celestial', attack: 1, health: 1, keywords: [], golden: false };
    // Insert first, then eat: the consume splices by index, and the token must take the VICTIM'S slot.
    state.shop.splice(victim + 1, 0, sf);
    consumeShopOffer(state, eaterStandIn, victim, 1, (a, h) => { banked.attack += a; banked.health += h; }, sf.uid);
    // The creation's meal is SILENT on screen (owner 2026-09-14): the victim simply leaves and the token takes its
    // slot in place — no ghost, no pull, no held slot, no row shift. The owner-authored `starform-create` cue
    // (below) is the whole moment. Mechanically it is still a real Shop consume (Open Market, the meter, the
    // watchers all heard it); only its animation is replaced.
    const meal = state.shopEaten?.[state.shopEaten.length - 1];
    if (meal && meal.uid !== sf.uid) meal.silent = true;
    buffStarform(state, banked.attack, banked.health, 'Consume');
  } else {
    state.shop.push(sf); // an open slot — or a full row of nothing but spells (rule 1: it still appears)
  }
  // The CREATE cue (owner-authored `starform-create`, 2026-09-14) plays on the token's slot whenever a Starform
  // is formed — into an open slot or over a meal alike (every creator: Star Seed, the Peddler, Roundabout, the
  // Lens, a Zenith rebirth). `fromUid` = `toUids` = the token: the def anchors both layers on the target.
  recordStarformFx(state, 'created', sf.uid, [sf.uid]);
  // The standing shop channels every other offer already wears (rule 6: banked, never read live).
  const perm = state.tavernBuyBonus;
  if (perm && (perm.atk > 0 || perm.hp > 0)) {
    // One ledger line per named contributor (the same names the buy path bakes), the remainder as "Shop Stats".
    let restA = perm.atk, restH = perm.hp;
    for (const [name, v] of Object.entries(state.tavernBuyBonusSources ?? {})) {
      if (v.atk === 0 && v.hp === 0) continue;
      buffStarform(state, v.atk, v.hp, name);
      restA -= v.atk; restH -= v.hp;
    }
    if (restA > 0 || restH > 0) buffStarform(state, restA, restH, 'Shop Stats');
  }
  const turn = state.tavernBuyBonusTurn;
  if (turn && (turn.atk > 0 || turn.hp > 0)) buffStarform(state, turn.atk, turn.hp, 'Shop Enchant');
  syncStarDestroyer(state); // rule 9: the token brings its Equipment
  void source; // the creator is presentation metadata today (the content PR names it on the create cue)
  return sf;
}

/**
 * Accretion: the Starform EATS the Shop minion at `offerIndex` — a real Shop consume (rule 1's bookkeeping,
 * `onConsume` with the token's stand-in as the eater) whose gain lands on the token and fires `starformGained`
 * (a consume is a gain, rule 8). False when there is no Starform, the index is not a minion, or it is the
 * Starform itself (it never eats itself).
 */
export function starformConsumeShopMinion(state: RunState, offerIndex: number, times = 1): boolean {
  const sf = starformOf(state);
  if (!sf) return false;
  const target = state.shop[offerIndex];
  if (!target || target.starform) return false;
  const standIn = starformStandIn(state, sf);
  const ate = consumeShopOffer(state, standIn, offerIndex, times, (a, h) => { buffStarform(state, a, h, 'Consume'); }, sf.uid);
  if (ate) recordStarformFx(state, 'consumeShop', target.uid, [sf.uid]);
  return ate;
}

/** Remove the token and tell the board why. Returns its full stats (base included) for the caller to spend. */
function removeStarform(state: RunState, reason: StarformRemovedReason): { attack: number; health: number } | null {
  const idx = starformIndex(state);
  if (idx < 0) return null;
  const stats = offerBuyStats(state, state.shop[idx]!);
  state.shop.splice(idx, 1);
  syncStarDestroyer(state); // rule 9: the Equipment leaves with the token (a Zenith rebirth re-grants it)
  fireStarformRemoved(state, reason, stats);
  return stats;
}

/** Rule 9 — STAR DESTROYER's silent exit: the offer leaves the Shop and NOTHING else fires. Not a consume, not
 *  a collapse, no `starformRemoved` (Zenith stays quiet), no `starformGained`, no pull record. The Equipment
 *  itself is dropped by `syncStarDestroyer`. False with no Starform. */
export function destroyStarform(state: RunState): boolean {
  const idx = starformIndex(state);
  if (idx < 0) return false;
  state.shop.splice(idx, 1);
  syncStarDestroyer(state);
  return true;
}

/** Rule 5 — the BUY: your LEFT-MOST board Celestial consumes the token (its FULL stats, base included, under the
 *  `Starform` ledger line); with none the token is consumed into nothing. Either way the token leaves via the
 *  consume path (`starformRemoved('consume')` — Zenith re-creates, Twin Star hears the buy like a Devotee's). The
 *  reducer's `buy` case owns the Gold + the "counts as a minion bought" half. Returns the receiver (null = none)
 *  and the stats that moved; null with no Starform. */
export function buyStarform(state: RunState): { receiver: BoardCard | null; stats: { attack: number; health: number } } | null {
  if (!hasStarform(state)) return null;
  const receiver = state.board.find((c) => isTribe(c, 'celestial')) ?? null;
  const stats = receiver ? consumeStarform(state, receiver) : removeStarform(state, 'consume');
  if (!stats) return null;
  if (receiver) addBuff(receiver, 'Starform', stats.attack, stats.health);
  return { receiver, stats };
}

/** Rule 7 — the EXTRA Collapse hits beyond the 2 unique originals: the run-wide counter (`collapseExtraTargets`,
 *  no writer yet) plus every Nova Herald standing on the board (its `passive` `collapseExtraTargets` marker:
 *  +2 each, +4 gilded — read off the card, never dispatched). */
export function collapseExtraTargetsOf(state: RunState): number {
  let n = state.collapseExtraTargets ?? 0;
  for (const c of state.board) {
    const def = CARD_INDEX[c.cardId];
    const eff = def?.effects.find((e) => e.on === 'passive' && e.do === 'collapseExtraTargets');
    if (eff) n += Number(eff.params?.extra ?? 2) * (c.golden ? 2 : 1);
  }
  return n;
}

/** Rule 7 — draw the Collapse's HITS from the friendly Celestials: `originals` UNIQUE picks first (fewer when the
 *  pool is smaller), then `extras` picks WITH replacement — an extra may repeat an original or another extra.
 *  Empty with no Celestial. One rng cursor advance, in this order, so a seeded replay reproduces it. */
export function collapseHits(state: RunState, originals = 2, extras = collapseExtraTargetsOf(state)): BoardCard[] {
  const pool = state.board.filter((c) => isTribe(c, 'celestial'));
  if (pool.length === 0) return [];
  const rng = makeRng(state.rngCursor);
  const avail = [...pool];
  const hits: BoardCard[] = [];
  for (let i = 0; i < originals && avail.length > 0; i++) hits.push(avail.splice(rng.int(avail.length), 1)[0]!);
  for (let i = 0; i < extras; i++) hits.push(pool[rng.int(pool.length)]!);
  state.rngCursor = rng.state();
  return hits;
}

/**
 * Rule 7 — CONSUME (the buy into your left-most Celestial): the Starform leaves and its FULL stats (base 1/1 included) are returned
 * for `target` — the caller (the card factory) grants them, so the buff wears the card's name. Null with no
 * Starform (nothing happens). `target` is accepted for the contract's shape and for the removal record.
 */
export function consumeStarform(state: RunState, target: BoardCard): { attack: number; health: number } | null {
  const fromUid = starformOf(state)?.uid;
  const st = removeStarform(state, 'consume');
  if (st && fromUid) recordStarformFx(state, 'consumed', fromUid, [target.uid]);
  return st;
}

/**
 * Rule 7 — COLLAPSE (Corona Devotee): the Starform leaves and HALF its stats, ROUNDED UP (base included), are
 * returned — the caller hands that half to EACH hit. Null with no Starform. `receivers` draws the hits AFTER
 * the token has left (`collapseHits`: 2 unique + the extras, with replacement) so the pull can be recorded
 * against every one of them — one `starform-pull` per HIT, duplicates included (a Celestial hit three times
 * gets three pulls), all fired together (owner 2026-09-12 / 2026-09-13).
 */
export function collapseStarform(state: RunState, receivers: () => BoardCard[] = () => []): { attack: number; health: number } | null {
  const fromUid = starformOf(state)?.uid;
  const full = removeStarform(state, 'collapse');
  if (!full) return null;
  const to = receivers();
  if (fromUid) recordStarformFx(state, 'collapse', fromUid, to.map((c) => c.uid));
  return { attack: Math.ceil(full.attack / 2), health: Math.ceil(full.health / 2) };
}

/** May this spell be AIMED at the Starform offer? A `friendly` spell whose printed aim is a CELESTIAL (Star Crash:
 *  `targetTribe: 'celestial'`) — the token is a friendly Celestial by design (owner 2026-09-12: "Star Crash must be
 *  castable on the Starform"). A plain `friendly` spell keeps its board-only aim (rule 5: never gilded, never
 *  transformed — those are `friendly` spells too); an `any` spell already reaches every offer. Read by the
 *  reducer's cast path AND the UI's aim, so the reticle and the rule cannot disagree. */
export function starformSpellAimsToken(def: Pick<CardDef, 'spell' | 'target' | 'targetTribe'>): boolean {
  return !!def.spell && def.target === 'friendly' && def.targetTribe === 'celestial';
}

/**
 * The action-boundary half of rule 8: `reduce` calls this with the Starform's stats BEFORE the action; any
 * growth the action produced that was NOT already dispatched (`starformGainFired`) fires `starformGained`
 * now — a Fortify aimed at it, Apples' next-shop buff, a Veinstorm stamp, a slot enchant landing on a roll.
 */
export function fireStarformGainRemainder(state: RunState, before: { uid: string; attack: number; health: number } | null): void {
  if (!before) return;
  const sf = starformOf(state);
  if (!sf || sf.uid !== before.uid) return; // gone (consumed / collapsed / destroyed) — no gain to report
  const now = offerBuyStats(state, sf);
  const fired = state.starformGainFired ?? { attack: 0, health: 0 };
  const a = Math.max(0, now.attack - before.attack - fired.attack);
  const h = Math.max(0, now.health - before.health - fired.health);
  if (a > 0 || h > 0) fireStarformGained(state, a, h);
}

/** The Starform's (uid, stats) snapshot `reduce` takes before an action, for `fireStarformGainRemainder`. */
export function starformSnapshot(state: RunState): { uid: string; attack: number; health: number } | null {
  const sf = starformOf(state);
  if (!sf) return null;
  const st = offerBuyStats(state, sf);
  return { uid: sf.uid, attack: st.attack, health: st.health };
}
