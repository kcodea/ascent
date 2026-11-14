import { CARD_INDEX } from '@game/content';
import { ALE_IDS, DRAGONFLAME_ID, SET2_TRIBAL_RUNES, makeRng, type CardDef, type EffectDef, type Keyword } from '@game/core';
import { addBuff, applyRunShopBuff, buffThisShopOffers, captureBuffFx, defIsTribe, fireOnRubyPlayed, hasBattlecry, isTribe } from './recruit';
import { runeStacksOf } from './runeDup';
import { procRuneId, recordBounceFx, type BoardCard, type RunState } from './state';

/**
 * ── SET 2 RUNE BATCH, BASIC TRIBAL (owner review 2026-11-12) — the Shop halves ─────────────────────────────────────
 *
 * One home for the Shop-side hooks, so each chokepoint in `recruit.ts` / `reducer.ts` is a single call. The combat
 * halves live in `simulate.ts` under "SET 2 RUNES, BASIC TRIBAL". Every number is per copy held (`runeStacksOf`).
 *
 *  - Deep Pockets / Rowdy Crowd: data only (`runeThreshold` with `resetEachTurn` + `oncePerTurn`).
 *  - Guel's Apprentice: data only (`recurringGrant`).
 *  - Collections: a Demon sold (`settleMinionSale`, every sale path) gives the Shop +2/+2 permanently.
 *  - Flamekeeper: a Dragonflame cast (`castSpell`, every Shop cast path) gives your board Dragons +2/+2 (a Shop buff is
 *    permanent).
 *  - Hatchling Roost: a set price for Shout Dragons in the Shop (`offerBuyPrice`, which the cost coin also reads).
 *  - Dragon Hoard: an End of Turn recurrence reading the turn's Shop spell casts.
 *  - Imp Legion: the Echo graft carried by every friendly Imp (`applyRuneGrafts`).
 *  - Rough Cut: a Ruby CAST on a board Kobold (`fireOnRubyPlayed`) also casts on a random board non-Kobold.
 *  - Bloodscent, Last Howl, Trophy Hunter, Pitchforks, Ruby Dust: combat only in practice (kills, deaths and enemies only
 *    exist in a fight; a Set 2 Shop has no friendly deaths, and an Imp summoned in the Shop has no enemy to hit).
 */

/** COLLECTIONS: a sold body that is a Demon (All-types included) raises the permanent Shop buff, per copy. */
export function collectionsOnSale(state: RunState, sold: BoardCard): void {
  if (!state.questFlags?.runeCollections || !isTribe(sold, 'demon')) return;
  const n = runeStacksOf(state, 'rune_collections');
  procRuneId(state, 'rune_collections');
  applyRunShopBuff(state, SET2_TRIBAL_RUNES.collections.attack * n, SET2_TRIBAL_RUNES.collections.health * n, 'Collections');
}

/** DRUNK SHOPKEEPER (Set 2 Basic Dwarf rune, owner 2026-11-13): When you cast an Ale, give minions in your Shop +1/+1
 *  permanently. */
export const DRUNK_SHOPKEEPER_GRANT = { attack: 1, health: 1 } as const;

/** DRUNK SHOPKEEPER: one Ale cast resolved in the Shop (each repetition of a multiplied cast reaches here, as for every
 *  other Ale trigger). Bakes +1/+1 per copy onto every minion offer standing in the Shop now (the Starform included), so a
 *  frozen card keeps it and later arrivals do not get it. An empty Shop: no fire. */
export function drunkShopkeeperOnCast(state: RunState, spellDef: CardDef): void {
  if (!state.questFlags?.runeDrunkShopkeeper || !ALE_IDS.includes(spellDef.id)) return;
  const any = state.shop.some((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
  if (!any) return;
  const n = runeStacksOf(state, 'rune_drunk_shopkeeper');
  procRuneId(state, 'rune_drunk_shopkeeper');
  buffThisShopOffers(state, 'Drunk Shopkeeper', DRUNK_SHOPKEEPER_GRANT.attack * n, DRUNK_SHOPKEEPER_GRANT.health * n);
}

/** FLAMEKEEPER: one Dragonflame cast resolved in the Shop (each repetition reaches here). */
export function flamekeeperOnCast(state: RunState, spellDef: CardDef): void {
  if (spellDef.id !== DRAGONFLAME_ID || !state.questFlags?.runeFlamekeeper) return;
  const dragons = state.board.filter((c) => isTribe(c, 'dragon'));
  if (dragons.length === 0) return;
  const n = runeStacksOf(state, 'rune_flamekeeper');
  procRuneId(state, 'rune_flamekeeper');
  captureBuffFx(state, undefined, 'spell', () => {
    for (const d of dragons) addBuff(d, 'Flamekeeper', SET2_TRIBAL_RUNES.flamekeeper.attack * n, SET2_TRIBAL_RUNES.flamekeeper.health * n);
  });
}

/** HATCHLING ROOST: the set price of a Shout Dragon offer, or undefined (not a Shout Dragon / no rune). A price CAP: it
 *  never raises a cheaper price, and every discount still applies on top (`offerBuyPrice`). */
export function hatchlingRoostPrice(state: RunState, cardId: string): number | undefined {
  if (!state.questFlags?.runeHatchlingRoost) return undefined;
  const def = CARD_INDEX[cardId];
  if (!def || def.spell || !defIsTribe(def, 'dragon', state) || !hasBattlecry(def)) return undefined;
  return SET2_TRIBAL_RUNES.hatchlingRoostPrice;
}

/** IMP LEGION's graft, one hit per copy held. `fixed`: a Gilded Imp gets the same (a rune-granted Echo is not the card's). */
export function impLegionGraft(copies: number): EffectDef {
  return { on: 'onDeath', do: 'deathrattleDamageLowestEnemy', params: { amount: SET2_TRIBAL_RUNES.impLegionDamage, hits: Math.max(1, copies), fixed: true } };
}

/** ROUGH CUT re-entrancy guard: the extra Ruby lands on a non-Kobold, so it can never re-trigger; the guard only keeps
 *  a watcher that casts ANOTHER Ruby from inside the extra landing from looping back here. */
let roughCutDepth = 0;

/** ROUGH CUT: a Ruby CAST just landed on board body `card` (every landing site goes through `fireOnRubyPlayed`; a bounce
 *  hop never does). On a Kobold, cast one more on a random friendly non-Kobold board minion, per copy: a real Ruby
 *  landing (stats, the keyword rider and the target's own on-Ruby watchers), never on the Kobold itself. No non-Kobold: nothing. */
export function roughCutShop(state: RunState, card: BoardCard, rubyAttack: number, rubyHealth: number, rubyKeyword?: Keyword): void {
  if (!state.questFlags?.runeRoughCut || roughCutDepth > 0) return;
  if (!state.board.includes(card) || !isTribe(card, 'kobold')) return;
  const pool = state.board.filter((c) => c !== card && !isTribe(c, 'kobold'));
  if (pool.length === 0) return;
  const n = runeStacksOf(state, 'rune_rough_cut');
  procRuneId(state, 'rune_rough_cut');
  roughCutDepth += 1;
  try {
    for (let k = 0; k < n; k++) {
      const live = pool.filter((c) => state.board.includes(c));
      if (live.length === 0) break;
      const rng = makeRng(state.rngCursor);
      const pick = live[rng.int(live.length)]!;
      state.rngCursor = rng.state();
      addBuff(pick, 'Ruby', rubyAttack, rubyHealth);
      recordBounceFx(state, 'ruby', card.uid, pick.uid); // the hop: the Kobold → the non-Kobold
      fireOnRubyPlayed(state, pick, rubyAttack, rubyHealth, rubyKeyword);
    }
  } finally {
    roughCutDepth -= 1;
  }
}
