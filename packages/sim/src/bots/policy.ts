/**
 * Bot policy framework (owner ask 2026-07-21; docs/bot-sims-handoff.md). A `BotPolicy` is a pure
 * `act(state) => Action` over the reducer's existing action space — the balance harness applies it in a loop
 * until the run terminates. The four shipped bots (greedy / tempo / midrange / meta) share ONE turn engine
 * here and differ only by their `BotWeights` + a few behaviour knobs; the meta bot layers combat rollout on
 * top (see rollout.ts).
 *
 * Everything is deterministic (no RNG of its own) so a report reproduces exactly.
 */
import type { Action } from '../state';
import type { RunState, BoardCard } from '../state';
import { CONFIG } from '../config';
import { reduce } from '../reducer';
import { refreshCostOf, upgradeCostOf } from '../reducer';
import { getHero } from '../heroes';
import { CARD_INDEX, QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { cardScore, type BotWeights } from './scoring';
import type { BotPackage } from './packages';
import { effectsValue } from './effects';
import { bestFinalArrangement } from './rollout';

export interface BotBehaviour {
  /** Buy nothing scoring below this. A low bar = grab everything (greedy); a high bar = hold out (tempo). */
  buyThreshold: number;
  /** The bar a SPELL must clear to be bought (its own lane — see the buy loop). Separate from `buyThreshold`
   *  because spells are scored on a different basis (one-shot effect magnitude vs a permanent body), so one
   *  shared bar can't tune both. Higher = a bot that only takes clearly-strong spells. */
  spellThreshold: number;
  /** Gold to keep in reserve rather than spend (economy discipline). */
  goldReserve: number;
  /** 0..1 eagerness to upgrade the tavern when affordable (past the reserve). */
  upgradeBias: number;
  /** Reroll when no shop offer clears `buyThreshold` and gold allows (past reserve + roll cost). */
  reroll: boolean;
  /** Sell the weakest body to make room for a clearly-better shop card when the board is full. */
  sellForUpgrade: boolean;
  /** Use combat rollout to choose the final board arrangement before ending the turn (meta bot). */
  rollout: boolean;
}

export interface BotPolicy {
  id: string;
  name: string;
  weights: BotWeights;
  behaviour: BotBehaviour;
  act(state: RunState): Action;
}

/** Score a quest offer for the bot: an easier objective (lower count, matching a tribe I'm already on) with a
 *  bigger reward is better. Rough, but far better than always taking index 0 — quests are build-defining, so a
 *  random pick was the worst of the index-0 defaults. */
function questScore(id: string, state: RunState): number {
  const q = QUEST_INDEX[id];
  if (!q) return -Infinity;
  const obj = q.objective as { count?: number; tribe?: string };
  const count = obj.count ?? 6;
  let v = 20 - count; // easier objective = better (a 4-count quest completes; a 12-count often doesn't)
  // Tribe fit: if the objective wants a tribe I already field, it's far more completable.
  if (obj.tribe) {
    const onTribe = state.board.filter((c) => { const d = CARD_INDEX[c.cardId]; return c.tribe === obj.tribe || d?.tribe2 === obj.tribe || d?.universalTribe; }).length;
    v += onTribe * 3;
  }
  // Reward heft — a recurring/scaling reward is worth more than a one-shot grant.
  const r = q.reward as { kind?: string };
  if (r.kind === 'recurringEndOfTurn' || r.kind === 'recurringGrant' || r.kind === 'scalingTribeAura') v += 6;
  else if (r.kind === 'multi') v += 5;
  else if (r.kind === 'grant') v += 3;
  return v;
}

/** Score a rune offer: its reward heft against its Gold cost, only if affordable. */
function runeScore(id: string, state: RunState): number {
  const r = RUNE_INDEX[id];
  if (!r) return -Infinity;
  if ((r.cost ?? 0) > state.embers) return -Infinity; // can't afford
  return 8 - (r.cost ?? 0) * 0.5; // cheaper = better, all roughly good value at their price
}

/** Does applying `action` actually change the state? (guards against returning a no-op that stalls the loop). */
function legal(state: RunState, action: Action): boolean {
  return reduce(state, action) !== state;
}

/** Hero powers whose value is ENABLING THIS TURN's economy — gold, cheap minions, a Discover, tier/quest
 *  access — so they should fire EARLY, before the buy loop, while there's still gold/board to use them on.
 *  Everything else (buffs, keyword grants, resummons, replays) fires LATE, after the board is built, so it
 *  lands on the finished board / a keeper rather than a random early minion. */
const EARLY_POWERS = new Set<string>([
  'scalingGold', 'sellGold', 'recurringGoldcrafter', 'gainMaxMana', 'cheapMinions', 'secondHand',
  'dynamiteDig', 'pathfinder', 'dragonTamer', 'discoLock', 'summitLock', 'chaos', 'spellAmplify',
  'quest', 'lesserQuest', 'questChronos', 'runeforge', 'epicRuneforge',
]);

/** Powers whose target should be your WORST body, not your best — they TRADE the minion away, so aiming them
 *  at your keeper actively destroys value. Just Darah's Swap ("swap a friendly minion with a random minion in
 *  the Shop") today; every other targeted power (Ward, Gild, resummon, replays) wants the BEST body. Checked
 *  against the actual power texts — `sellGold` and `dynamiteDig` read like sacrifices but aren't (they're a
 *  sell-payoff passive and an untargeted Discover). */
const TARGETS_WORST = new Set<string>(['displace']);

/** Build the hero-power action: untargeted powers take no uid; targeted ones aim at the best (or, for the
 *  sacrifice-style powers above, the worst) board minion. Crucially it walks EVERY candidate in preference
 *  order until one is legal — the old version tried only the single top-scoring minion and gave up if that
 *  one happened to be an invalid target for the power (wrong tribe, already golden, already Warded, …),
 *  which silently skipped the power for the whole turn. Returns null only if nothing at all is legal. */
function heroPowerAction(state: RunState, w: BotWeights, pkg?: BotPackage): Action | null {
  const power = getHero(state.heroId).power;
  if (power.untargeted) {
    const a: Action = { type: 'heroPower' };
    return reduce(state, a) !== state ? a : null;
  }
  const worstFirst = TARGETS_WORST.has(power.kind);
  let candidates = state.board;
  // Gild is a PERMANENT, target-locked upgrade on a charge you rarely get back (Indy: once, recharging only
  // every 40 Gold spent). Burning it on a turn-1 T1 body is close to wasting the hero. Hold it until there's
  // something worth doubling; if the board never gets there, the guard lifts late so the charge isn't wasted.
  if (power.kind === 'gild' && state.wave < 8) {
    const worthy = state.board.filter((c) => (CARD_INDEX[c.cardId]?.tier ?? 1) >= 3);
    if (worthy.length === 0) return null; // nothing worth gilding yet — wait
    candidates = worthy;
  }
  const ranked = candidates
    .map((c) => { const d = CARD_INDEX[c.cardId]; return { c, v: d ? cardScore(d, state, w, pkg) : 0 }; })
    .sort((a, z) => (worstFirst ? a.v - z.v : z.v - a.v));
  for (const { c } of ranked) {
    const a: Action = { type: 'heroPower', uid: c.uid };
    if (reduce(state, a) !== state) return a;
  }
  // Some targeted powers also resolve with no uid (the engine picks) — try that before giving up.
  const bare: Action = { type: 'heroPower' };
  return reduce(state, bare) !== state ? bare : null;
}

/** The shared turn engine. Every bot calls this; `w`/`b` are its personality. Returns ONE action — the loop
 *  calls repeatedly, so a turn is a sequence of these until `faceOmen`. */
export function decide(state: RunState, w: BotWeights, b: BotBehaviour, pkg?: BotPackage): Action {
  // ---- Forced / overlay decisions first (they gate progress) ----
  if (state.discover) {
    // Pick the highest-scoring Discover option. `state.discover` is the cardId list directly.
    const opts = state.discover;
    let bestI = 0, bestV = -Infinity;
    opts.forEach((id, i) => { const d = CARD_INDEX[id]; const v = d ? cardScore(d, state, w, pkg) : -Infinity; if (v > bestV) { bestV = v; bestI = i; } });
    return { type: 'discover', index: bestI };
  }
  if (state.chooseOne) {
    const opts = CARD_INDEX[state.chooseOne.cardId]?.chooseOne ?? [];
    let bestI = 0, bestV = -Infinity;
    opts.forEach((o, i) => { const v = effectsValue(o.effects); if (v > bestV) { bestV = v; bestI = i; } });
    return { type: 'chooseOne', index: bestI };
  }
  if (state.pendingTarget) {
    // Target the highest-value friendly (most buff-worthy body); fall back to the pending default.
    let best: BoardCard | undefined; let bestV = -Infinity;
    for (const c of state.board) { const d = CARD_INDEX[c.cardId]; const v = d ? cardScore(d, state, w, pkg) : 0; if (v > bestV) { bestV = v; best = c; } }
    return { type: 'battlecryTarget', targetUid: best?.uid ?? state.pendingTarget.uid };
  }
  if (state.questOffer) {
    let bestI = 0, bestV = -Infinity;
    state.questOffer.forEach((id, i) => { const v = questScore(id, state); if (v > bestV) { bestV = v; bestI = i; } });
    return { type: 'buyQuest', index: bestI };
  }
  if (state.runeforgeOffer) {
    let bestI = -1, bestV = 0;
    state.runeforgeOffer.forEach((id, i) => { const v = runeScore(id, state); if (v > bestV) { bestV = v; bestI = i; } });
    return bestI >= 0 ? { type: 'buyRune', index: bestI } : { type: 'skipRuneforge' };
  }
  if (state.phase === 'combat') return { type: 'resolveCombat' };
  if (state.phase !== 'recruit') return { type: 'faceOmen' };

  // ---- Recruit turn ----
  // 1. Play from hand (free value; holding cards is almost never right for a bot). SPELLS first and WITHOUT a
  //    board-room gate — they're consumed on cast, so a full board must not strand them in hand (it used to:
  //    the whole step sat behind `board.length < boardMax`, which is why a full-board bot stopped casting).
  //    Cast the best-scoring spell rather than the first one in hand.
  const castable = state.hand
    .filter((c) => CARD_INDEX[c.cardId]?.spell && legal(state, { type: 'play', uid: c.uid }))
    .map((c) => ({ c, v: cardScore(CARD_INDEX[c.cardId]!, state, w, pkg) }))
    .sort((a, z) => z.v - a.v)[0];
  if (castable) return { type: 'play', uid: castable.c.uid };
  if (state.board.length < CONFIG.boardMax) {
    const playable = state.hand.find((c) => legal(state, { type: 'play', uid: c.uid }));
    if (playable) return { type: 'play', uid: playable.uid };
  }

  // 2. EARLY hero power — only the economy/enabling kinds, so their gold/cards fuel THIS turn's buys. Buff
  //    powers wait for step 5b (a built board / a keeper to land on).
  if (state.heroReady && EARLY_POWERS.has(getHero(state.heroId).power.kind)) {
    const hp = heroPowerAction(state, w, pkg);
    if (hp) return hp;
  }

  // 3. Buy the best shop offer above threshold, if there's room + gold (past the reserve).
  const spendable = state.embers - b.goldReserve;
  const roomOnBoard = state.board.length + state.hand.length < CONFIG.boardMax;
  const offers = state.shop.map((o) => ({ o, def: CARD_INDEX[o.cardId] })).filter((x) => x.def);
  const scored = offers
    .map((x) => ({ ...x, v: cardScore(x.def!, state, w, pkg) }))
    .sort((a, z) => z.v - a.v);
  // Spells get their OWN lane, for two reasons. FIRST: the tavern's spell offer lives in `state.spell` — a
  // dedicated right-hand slot, NOT in `state.shop` — so a bot reading only `state.shop` never even saw it and
  // bought ~0 spells per run regardless of how well it valued them. SECOND: ranked against bodies head-to-head
  // a spell rarely wins (a body carries stats AND effects AND tribe AND triple progress). A spell also doesn't
  // compete for board space — it's cast and gone — so it's gated on HAND room and judged against its own bar.
  const topMinion = scored.find((x) => !x.def!.spell);
  const slotSpell = state.spell && CARD_INDEX[state.spell.cardId]
    ? { o: state.spell, def: CARD_INDEX[state.spell.cardId]!, v: cardScore(CARD_INDEX[state.spell.cardId]!, state, w, pkg) }
    : undefined;
  const shopSpell = scored.find((x) => x.def!.spell); // Spell Cart can also put spells in the minion row
  const topSpell = slotSpell && (!shopSpell || slotSpell.v >= shopSpell.v) ? slotSpell : shopSpell;
  const handRoom = state.hand.length < CONFIG.boardMax;

  if (topSpell && handRoom && topSpell.v >= b.spellThreshold && spendable >= (topSpell.def!.cost ?? CONFIG.minionCost)) {
    const buy: Action = { type: 'buy', uid: topSpell.o.uid };
    // Only if it beats the body we'd otherwise buy — a strong body still takes priority at equal value.
    if ((!topMinion || topSpell.v > topMinion.v || !roomOnBoard) && legal(state, buy)) return buy;
  }

  const top = topMinion;
  if (top && roomOnBoard && top.v >= b.buyThreshold && spendable >= CONFIG.minionCost) {
    const buy: Action = { type: 'buy', uid: top.o.uid };
    if (legal(state, buy)) return buy;
  }

  // 3b. Board full but a shop card clearly beats our weakest body → sell the weakest, then buy next call.
  if (b.sellForUpgrade && !roomOnBoard && top && spendable >= CONFIG.minionCost) {
    let worst: BoardCard | undefined; let worstV = Infinity;
    for (const c of state.board) { const d = CARD_INDEX[c.cardId]; const v = d ? cardScore(d, state, w, pkg) : 0; if (v < worstV) { worstV = v; worst = c; } }
    if (worst && top.v > worstV + 3 && legal(state, { type: 'sell', uid: worst.uid })) return { type: 'sell', uid: worst.uid };
  }

  // 4. Upgrade the tavern (economy tempo) when affordable past the reserve and the bot leans into it.
  const upCost = upgradeCostOf(state);
  if (b.upgradeBias > 0 && state.tier < CONFIG.maxTier && state.embers - upCost >= b.goldReserve) {
    // Bias gates HOW eagerly: <1 only upgrades when nothing worth buying is on offer.
    const worthBuying = top && top.v >= b.buyThreshold && roomOnBoard;
    if (b.upgradeBias >= 1 || !worthBuying) {
      if (legal(state, { type: 'upgrade' })) return { type: 'upgrade' };
    }
  }

  // 5a. LATE hero power — buff/board kinds fire now, after buying, on the best keeper (targeting fixed).
  if (state.heroReady && !EARLY_POWERS.has(getHero(state.heroId).power.kind)) {
    const hp = heroPowerAction(state, w, pkg);
    if (hp) return hp;
  }

  // 5. Reroll to dig for something better, if the bot rerolls and gold allows past the reserve.
  if (b.reroll && roomOnBoard) {
    const rollCost = refreshCostOf(state);
    const nothingGood = !top || top.v < b.buyThreshold;
    if (nothingGood && state.embers - rollCost >= b.goldReserve && legal(state, { type: 'roll' })) {
      return { type: 'roll' };
    }
  }

  // 6. Meta rollout: choose the final board arrangement by simulating vs the pinned opponent, then end.
  if (b.rollout) {
    const repo = bestFinalArrangement(state, w);
    if (repo) return repo;
  }

  // 7. Nothing left to do — end the turn.
  return { type: 'faceOmen' };
}
