import { SET2_BASIC_NEUTRAL as N, makeRng } from '@game/core';
import { addBuff, captureBuffFx, gainGold } from './recruit';
import { runeStacksOf } from './runeDup';
import { procRuneId, type RunState } from './state';

/**
 * ── SET 2 RUNE BATCH, BASIC NEUTRAL (owner review 2026-11-12) — the Shop halves ─────────────────────────────────────
 *
 * One home for the Shop-side hooks of the nine Basic neutral runes, so each chokepoint in `recruit.ts` / `reducer.ts`
 * is a single call. The combat halves (Shield Wall, Shatterproof, Warm-Up, Golden Handshake) live in `simulate.ts`
 * under "SET 2 BASIC NEUTRAL RUNES". Numbers are `SET2_BASIC_NEUTRAL` (@game/core). Every payout is per copy held
 * (`runeStacksOf`), the boolean-flag family rule (owner 2026-08-27), except Loyal Customer (a sweetener duplicate).
 *
 *  - Piggy Bank: the unspent Gold carries into next turn's opening (`piggyBankCarry`, at the end of the Shop turn, no
 *    cap); its End of Turn half is the recurring effect `runePiggyBank` in `runRecurringEndOfTurn` (the REPEAT form).
 *  - Hazard Pay: after a LOST combat, 3 Gold and a banked free Refresh, paid as the next Shop opens (its own Start of
 *    Turn beat, `recordSotBeat`).
 *  - Second Opinion: every Discover offers one more option (`discoverOptionCount`); its own Discover is the reward.
 *  - Golden Handshake: every Gild (the one chokepoint, `noteGilded`) gives your board +2/+2, permanently in the Shop.
 *  - Late Bloomer: every Shop Tier step gains 2 Gold and gives your board +3/+3.
 *  - Loyal Customer: every 4th minion bought is free (`loyalCustomerArmed` folds into `offerBuyPrice`).
 *  - Shield Wall: its Shop replay (Combat Prowess / Lasting Cadence) is `shieldWallShop`.
 */

/** How many options a Discover offers right now: 3, plus one per Second Opinion held. */
export function discoverOptionCount(state: Pick<RunState, 'runeStacks'>): number {
  return 3 + N.secondOpinionExtra * (state.runeStacks?.['rune_second_opinion'] ?? 0);
}

/** Piggy Bank is held. */
export function piggyBankHeld(state: Pick<RunState, 'questRecurringEndOfTurn'>): boolean {
  return !!state.questRecurringEndOfTurn?.includes('runePiggyBank');
}

/** Piggy Bank, the carry: every Gold left as the Shop turn ends banks into next turn's opening (no cap, owner ruling).
 *  Called once at the end of `endRecruitTurn`, after the End of Turn effects (which read the same Gold). */
export function piggyBankCarry(state: RunState): void {
  if (!piggyBankHeld(state) || state.embers <= 0) return;
  procRuneId(state, 'rune_piggy_bank');
  state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + state.embers;
}

/** Piggy Bank, ONE End of Turn tick: a random friendly minion (seeded, re-rolled per tick) gains +1/+3. */
export function piggyBankTick(state: RunState): void {
  if (state.board.length === 0) return;
  const rng = makeRng(state.rngCursor);
  const pick = state.board[rng.int(state.board.length)]!;
  state.rngCursor = rng.state();
  addBuff(pick, 'Piggy Bank', N.piggyBank.attack, N.piggyBank.health);
}

/** Hazard Pay: the Shop after a LOST combat opens with 3 Gold and a free Refresh more, per copy held. */
export function hazardPayTurnStart(state: RunState, lost: boolean): void {
  if (!lost || !state.questFlags?.runeHazardPay) return;
  const k = runeStacksOf(state, 'rune_hazard_pay');
  procRuneId(state, 'rune_hazard_pay');
  gainGold(state, N.hazardPay.gold * k);
  state.freeRolls += N.hazardPay.refreshes * k;
}

/** Golden Handshake, the Shop half: a minion was just Gilded (`noteGilded`, every Gild). Your board +2/+2, permanent. */
export function goldenHandshakeOnGild(state: RunState | undefined): void {
  if (!state?.questFlags?.runeGoldenHandshake || state.board.length === 0) return;
  const k = runeStacksOf(state, 'rune_golden_handshake');
  procRuneId(state, 'rune_golden_handshake');
  captureBuffFx(state, undefined, 'spell', () => {
    for (const c of state.board) addBuff(c, 'Golden Handshake', N.goldenHandshake.attack * k, N.goldenHandshake.health * k);
  });
}

/** Late Bloomer: the Shop just went up `steps` Tiers (a paid upgrade, or a free one). Each step pays on its own. */
export function lateBloomerOnUpgrade(state: RunState, steps = 1): void {
  if (!state.questFlags?.runeLateBloomer) return;
  const k = runeStacksOf(state, 'rune_late_bloomer');
  for (let i = 0; i < steps; i++) {
    procRuneId(state, 'rune_late_bloomer');
    gainGold(state, N.lateBloomer.gold * k);
    if (state.board.length > 0) {
      captureBuffFx(state, undefined, 'spell', () => {
        for (const c of state.board) addBuff(c, 'Late Bloomer', N.lateBloomer.attack * k, N.lateBloomer.health * k);
      });
    }
  }
}

/** Loyal Customer: is the NEXT minion bought the free one (the 4th, 8th, …)? */
export function loyalCustomerArmed(state: Pick<RunState, 'questFlags' | 'loyalCustomerBuys'>): boolean {
  return !!state.questFlags?.runeLoyalCustomer && (state.loyalCustomerBuys ?? 0) % N.loyalCustomerEvery === N.loyalCustomerEvery - 1;
}

/** Loyal Customer: a minion was bought (`wasFree` = this rune made it free). Advances the count. */
export function noteLoyalCustomerBuy(state: RunState, wasFree: boolean): void {
  if (!state.questFlags?.runeLoyalCustomer) return;
  state.loyalCustomerBuys = ((state.loyalCustomerBuys ?? 0) + 1) % N.loyalCustomerEvery;
  if (wasFree) procRuneId(state, 'rune_loyal_customer');
}

/** Shield Wall's Shop replay (Combat Prowess / Lasting Cadence): your Taunt minions +4/+6 per copy, permanent like every
 *  Shop replay. */
export function shieldWallShop(state: RunState): void {
  const k = runeStacksOf(state, 'rune_shield_wall');
  for (const m of state.board) if (m.keywords.includes('T')) addBuff(m, 'Shield Wall', N.shieldWall.attack * k, N.shieldWall.health * k);
}
