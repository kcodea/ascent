import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatConfig, type CombatResult, type CombatSideState, type PendingCombatQuest, type QuestCombatMods, type QuestDef, type QuestObjective, type QuestObjectiveEvent, type Tribe } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, QUEST_INDEX, RUNE_INDEX, RUNES } from '@game/content';
import { poolOf, setIdOf } from './cardPool';
import { CONFIG, maxTierFor } from './config';
import { accumulateContribution, tallyCombat } from './contribution';
import { rollShop, topUpTavern, returnToPool, takeFromPool } from './shop';
import { generateQuestOffer, questOfferPlan } from './quests';
import { getHero } from './heroes';
import { buildEnemyBoard, selectThreat } from './threats';
import { pickOpponent, opponentBoard, oppKey } from './opponents';
import type { BoardSnapshot } from './snapshot';
import { addBuff, addOfferBuff, applyBattlecryTarget, applyCardsBought, applyChooseOne, applyChooseOneTarget, applyEndOfTurn, applyOnBuy, applyGoldSpent, auraFxTargets, boardManaBonus, buffImpsRunWide, buffUndeadAttackEverywhere, buffCardTypeRunWide, buffFodderRunWide, cardBuff, captureBuffFx, conjuredStats, castSpell, castSpellOnOffer, conjureToHand, consumeTavernFodder, dominantBoardTribe, dragonTamerCostOf, fireGravetwinEchoes, fireOnGainAttack, fireOnRubyCast, fireOnRubyPlayed, fireOnSell, fireSummonBuffs, gildMinion, grantMinionToHandOrBoard, grantTopTypeMinion, hasBattlecry, isTribe, mintRubies, modalOpen, openDiscover, playCard, queueDiscover, replayBattlecry, replayEconomyBattlecry, replayEndOfTurn, replayRecurringEndOfTurn, sellValueOf, spellAttackBonus, spellCasts, spellCostReduction, spellHealthBonus, stampImproveReps, swapWithTavern, triggerBorrowedEcho, buyHealthAura, undeadBuyBonus, weldMagnetic } from './recruit';
import { mixSeed, TAG, type Action, type ActiveQuest, type AuraFxTribe, type BoardCard, type CardBuff, type RunState } from './state';
import { MATCHMAKING } from './matchmaking';

/** Spend `amount` Gold and fire any `goldSpent` payoffs (Acid, Banksly) — the single Gold-spend chokepoint
 *  for buys, rerolls, tier-ups and hero powers. */
function spendGold(s: RunState, amount: number): void {
  s.embers -= amount;
  s.goldSpent = (s.goldSpent ?? 0) + amount; // career/post-run stat
  s.goldSpentThisTurn = (s.goldSpentThisTurn ?? 0) + amount; // per-turn (Patch Job); reset each wave
  // Indy: the (spent) Gild charge recharges after every 40 Gold spent — un-spend it the moment the threshold lands.
  if (s.heroId === 'indy' && s.heroPowerSpent && s.indyGildRearmAt != null && s.goldSpent >= s.indyGildRearmAt) {
    s.heroPowerSpent = false;
    s.indyGildRearmAt = undefined;
  }
  applyGoldSpent(s, amount);
  advanceQuestsBy(s, (o) => o.event === 'spendGold', amount); // Coin Hoard: "Spend N Gold"
  // Food for Gold: every `per` Gold spent queues a Fodder into the next shop + bumps the run-wide Fodder aura.
  if (s.foodForGold) {
    s.foodForGoldTick = (s.foodForGoldTick ?? 0) + amount;
    while (s.foodForGoldTick >= s.foodForGold.per) {
      s.foodForGoldTick -= s.foodForGold.per;
      (s.pendingTavern ??= []).push('fred');
      buffFodderRunWide(s, s.foodForGold.attack, s.foodForGold.health, 'Food for Gold');
    }
  }
  // Rune of Spellslinging: every `spellDripPer` Gold spent, conjure a random spell (tavern-tier bound) to hand.
  if (s.spellDripPer) {
    s.spellDripTick = (s.spellDripTick ?? 0) + amount;
    while (s.spellDripTick >= s.spellDripPer) {
      s.spellDripTick -= s.spellDripPer;
      conjureToHand(s, poolOf(s).spells.filter((c) => c.tier <= s.tier), 1);
    }
  }
  // Rune of Scale (Epic): each Gold-spend gives `count` random board minions +atk/+hp. Once per spend transaction
  // (a buy / roll / tier-up / hero power), not per Gold. Seeded off the run's RNG cursor.
  if (s.runeScale && amount > 0 && s.board.length > 0) {
    const { count, attack, health } = s.runeScale;
    const rng = makeRng(s.rngCursor);
    const pool = [...s.board];
    // Wrapped for FX so each picked ally gets a descend (sourceless — the rune has no board anchor) rather than
    // a silent stat jump. RNG is unchanged: the picks still run inside, s.rngCursor advances exactly as before.
    captureBuffFx(s, undefined, 'spell', () => {
      for (let i = 0; i < count && pool.length > 0; i++) {
        const pick = pool.splice(rng.int(pool.length), 1)[0]!;
        addBuff(pick, 'Rune of Scale', attack, health);
      }
    });
    s.rngCursor = rng.state();
  }
}

/** Tiff's Dragon Tamer: every Dragon or SPELL bought banks a 1-Gold discount on the next power use
 *  (`tiffDiscount`, read by `dragonTamerCostOf`; reset when the power fires). Called from every buy path —
 *  the right-hand spell slot, a Spell-Cart shop spell, a held-Displacement restore, and the normal buy. */
function tiffBuyDiscount(s: RunState, card: CardDef): void {
  if (getHero(s.heroId).power.kind !== 'dragonTamer') return;
  if (card.spell || card.tribe === 'dragon' || card.tribe2 === 'dragon' || card.universalTribe) {
    s.tiffDiscount = (s.tiffDiscount ?? 0) + 1;
  }
}

/** Push a PLAIN, base-stat copy of a card to hand (Re-Pete's Second Hand / Gorr's Four Peat) — a CONJURED
 *  card: no per-instance buffs/golden/welds carried, and it does NOT take from the shared pool. Hand-cap-safe. */
function conjurePlainCopy(s: RunState, cardId: string): void {
  const def = CARD_INDEX[cardId];
  if (!def || s.hand.length >= CONFIG.handMax) return;
  s.hand.push({ uid: `b${s.uidSeq++}`, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false });
}

/** Gorr's Four Peat: when you buy your 3rd MINION in a single turn, get a plain copy of one of the three at
 *  random — conjured (no pool take), once per turn (`gorrBuys` resets at turn setup; it keeps counting past 3
 *  but only the exact 3rd buy fires). Called from both paid minion-buy paths (normal + held-Displacement). */
function gorrQuestBuy(s: RunState, card: CardDef): void {
  if (getHero(s.heroId).power.kind !== 'fourPeat' || card.spell) return;
  const buys = [...(s.gorrBuys ?? []), card.id];
  s.gorrBuys = buys;
  if (buys.length !== 3) return; // fires on EXACTLY the 3rd minion buy each turn
  const rng = makeRng(s.rngCursor);
  conjurePlainCopy(s, buys[rng.int(3)]!);
  s.rngCursor = rng.state();
}

/** Drakko's quest: buy 5 Battlecry minions → get Drakko the Drummer (once per game). Progresses on every
 *  PAID Battlecry buy — the normal path AND a held-Displacement restore (which used to skip it); the
 *  reward lands in the hand if there's room. */
function drakkoQuestBuy(s: RunState, card: CardDef): void {
  if (s.heroId !== 'drakko' || s.heroPowerSpent || !hasBattlecry(card)) return;
  s.drakkoBuys += 1;
  if (s.drakkoBuys < 5) return;
  if (s.hand.length < CONFIG.handMax) {
    s.hand.push({
      uid: `b${s.uidSeq++}`,
      cardId: 'drummer',
      tribe: CARD_INDEX.drummer!.tribe,
      attack: CARD_INDEX.drummer!.attack,
      health: CARD_INDEX.drummer!.health,
      keywords: [...CARD_INDEX.drummer!.keywords],
      golden: false,
    });
  }
  s.heroPowerSpent = true; // quest complete — stops counting + arms nothing further
}

/** Chronos hero's Encore quest: buy 4 End-of-Turn minions → get a Chronos (once per game). Mirrors
 *  `drakkoQuestBuy` — progresses on every PAID buy of a minion that carries an End-of-Turn effect. */
function chronosQuestBuy(s: RunState, card: CardDef): void {
  if (s.heroId !== 'chronoshero' || s.heroPowerSpent) return;
  if (!card.effects.some((e) => e.on === 'endOfTurn')) return;
  s.eotMinionBuys = (s.eotMinionBuys ?? 0) + 1;
  if ((s.eotMinionBuys ?? 0) < 4) return;
  if (s.hand.length < CONFIG.handMax) {
    s.hand.push({
      uid: `b${s.uidSeq++}`,
      cardId: 'chronos',
      tribe: CARD_INDEX.chronos!.tribe,
      attack: CARD_INDEX.chronos!.attack,
      health: CARD_INDEX.chronos!.health,
      keywords: [...CARD_INDEX.chronos!.keywords],
      golden: false,
    });
  }
  s.heroPowerSpent = true; // quest complete
}

/** Shop minion cost for the current hero: Hermit Hank's minions cost 2 Gold; everyone else pays the config
 *  default. A Moe set-price (`offer.cost`) or a Merchant's Mark override still take priority over this. */
export function minionCostOf(s: RunState): number {
  return getHero(s.heroId).power.kind === 'cheapMinions' ? 2 : CONFIG.minionCost;
}

/** The Gold a tavern-up costs right now: the running `upgradeCost` plus Hermit Hank's +2 surcharge (his
 *  minions are cheap, but climbing tiers costs more). The single source of truth for the reducer + UI. */
export function upgradeCostOf(s: RunState): number {
  return s.upgradeCost + (getHero(s.heroId).power.kind === 'cheapMinions' ? 2 : 0);
}

/** The Gold a tavern refresh (reroll) costs right now: the config default, but Tradesman (cheapMinions) pays 2
 *  — cheap to shop, dear to churn. The single source of truth for the reducer's roll charge + the UI button. */
export function refreshCostOf(s: RunState): number {
  return getHero(s.heroId).power.kind === 'cheapMinions' ? 2 : CONFIG.refreshCost;
}

/**
 * The board the *next* combat will serve: a wave-matched real opponent from the pool (same development stage),
 * or null when the pool is empty (→ the procedural threat). Pure + deterministic — the opponent frame previews
 * it during recruit, and `faceOmen` resolves exactly this.
 */
/** No-repeat window: the player never faces the same opponent within this many rounds (owner rule 2026-07-15). */
const NO_REPEAT_ROUNDS = 4;

/** The loss-streak softener is armed for the NEXT pick iff the streak is long enough AND it hasn't already
 *  influenced a pick this streak (once per streak — owner call 2026-07-18). Spent at the boundary pin. */
function streakSoftenerLosses(s: RunState): number {
  const losses = s.lossStreak ?? 0;
  return losses >= MATCHMAKING.streak.after && !s.streakSoftened ? losses : 0;
}

export function nextOpponent(s: RunState): BoardSnapshot | null {
  // THE PIN WINS (reload-divergence fix, revived 2026-07-18): once this wave's opponent is stamped into
  // `servedBoards` (on the first recruit action of the turn — see the reduce() boundary — or at faceOmen),
  // every reader serves it verbatim: the recruit preview, the fight, and a reloaded session. Key-presence
  // check, not truthiness — a NULL pin means "this wave fought the procedural threat" and stays procedural.
  if (s.servedBoards && s.wave in s.servedBoards) return s.servedBoards[s.wave] ?? null;
  // Match on WAVE (same development stage — see pickOpponent). Power (captured at TURN START, so the
  // telegraphed foe stays fixed as you shop) is the fairness tiebreak among same-wave boards.
  // No-repeat: exclude the identities of the boards fought in the last NO_REPEAT_ROUNDS waves (recorded in
  // `servedBoards` by the pinning pass). Deterministic — the recruit preview and the actual serve read the same
  // fixed history, so they still agree.
  const exclude = new Set<string>();
  for (let w = s.wave - 1; w >= s.wave - NO_REPEAT_ROUNDS && w >= 1; w--) {
    const b = s.servedBoards?.[w];
    if (b) exclude.add(oppKey(b));
  }
  return pickOpponent(s.wave, s.turnStartPower, makeRng(mixSeed(s.seed, s.wave, TAG.ENEMY)), undefined, exclude, streakSoftenerLosses(s), setIdOf(s));
}

/** Loss-damage cap by round — the most Resolve a single loss can cost, ramping up as the course escalates:
 *  5 (rounds 1–3), 10 (4–7), 15 (8–11), 20 (12–15), then UNCAPPED (full damage) for the finale (16–17). */
export function lossDamageCap(wave: number): number {
  return wave <= 3 ? 5 : wave <= 7 ? 10 : wave <= 11 ? 15 : wave <= 15 ? 20 : Infinity;
}

/** Merge a flat list of buffs by source (summing ±atk/±hp + count) — used to carry the inspect
 *  breakdown through a triple. */
function mergeBuffs(buffs: CardBuff[]): CardBuff[] {
  const out: CardBuff[] = [];
  for (const b of buffs) {
    const e = out.find((x) => x.source === b.source);
    if (e) { e.attack += b.attack; e.health += b.health; e.count += b.count; }
    else out.push({ ...b });
  }
  return out;
}

/** Whether a Magnetic minion can weld onto a target minion: they must share a tribe, counting BOTH
 *  cards' tribes. So Cling Drone (Mech) → any Mech *including* Heckbinder (Demon/Mech); Heckbinder
 *  → a Mech or a Demon; and a Mech-magnetic card can attach onto Heckbinder because it's also a Mech. */
export function magnetizesTo(magneticCardId: string, targetCardId: string, targetAddedTribes?: Tribe[], targetAllTribes?: boolean): boolean {
  const m = CARD_INDEX[magneticCardId];
  const t = CARD_INDEX[targetCardId];
  if (!m || !t) return false;
  // universalTribe Magnetic cards (Chaos Attachment) can weld onto any non-neutral target (or another all-type).
  if (m.universalTribe) return t.tribe !== 'neutral' || !!t.universalTribe || !!targetAllTribes;
  // A universalTribe HOST (CardDef flag) or an Anomaly-Reactor "All" instance counts as every tribe (incl. Mech),
  // so it accepts any Magnetic — e.g. a normal Mech magnetic welding onto it.
  if (t.universalTribe || targetAllTribes) return true;
  const mag: Tribe[] = [m.tribe, m.tribe2].filter((x): x is Tribe => !!x);
  // Anomaly Reactor: a spell-added instance tribe (Mech) makes the host a valid weld target too.
  const tgt: Tribe[] = [t.tribe, t.tribe2, ...(targetAddedTribes ?? [])].filter((x): x is Tribe => !!x);
  return mag.some((x) => tgt.includes(x));
}

/**
 * The run-loop state machine as a pure reducer: `(state, action) => state`
 * (handoff C.6). Never mutates its input — returns the same reference for a
 * no-op (invalid action) and a fresh state for a real transition. Recruit-phase
 * card effects live in `recruit.ts` (RECRUIT_FACTORIES); combat-time effects in
 * `@game/core`.
 */
/** Recruit actions a quest objective can watch → the objective event they count. `buyQuest` is deliberately
 *  absent (buying a quest isn't a "buy" objective). */
const QUEST_TICK_EVENTS: Partial<Record<Action['type'], QuestObjectiveEvent>> = {
  play: 'play', roll: 'roll', // `buy` + `sell` are handled separately (tribe-narrowed: "Buy N Beasts" / "Sell N Mechs")
};

/**
 * How many Monte Carlo runs back the pre-combat odds bar ("73% win · 4% draw · 23% loss").
 *
 * This is the single most expensive thing the reducer does, by a wide margin. `faceOmen` runs `simulate()`
 * once for the REAL fight and then `COMBAT_ODDS_SIMS` more purely to estimate the display — measured on a
 * 7-minion wave-14 board, that split was **0.011ms for the combat and 11.05ms for the odds: 99.9% of the
 * cost**. In the wild it was the largest stall in the game (80-92ms at high waves).
 *
 * 200 rather than the original 1000 (owner call 2026-07-20). It is a sampling problem, and the display
 * rounds to whole percent: the 95% confidence interval on a proportion is ±3.1% at n=1000 and ±3.5% at
 * n=200 — a difference you cannot see in a rounded number — for a 5x cut in cost.
 *
 * Raising this is a direct, linear cost on End Turn. It is safe to change: the odds are computed off their
 * own RNG tag (`TAG.ODDS`), consume no game randomness, and feed nothing but the bar.
 */
const COMBAT_ODDS_SIMS = 200;

export function reduce(state: RunState, action: Action): RunState {
  // Shop-buff FX are per-ACTION: reset the scratch buffer on the INPUT state BEFORE reduceCore's clone, so the
  // clone (`next`) starts empty and, after the action, holds EXACTLY this action's captures (never accumulated
  // across dispatches). For a rejected no-op reduceCore returns `state` itself → `next.recruitBuffFx` stays [].
  state.recruitBuffFx = [];
  state.auraFx = undefined; // same per-action scratch contract as recruitBuffFx (auraFxSeq stays monotonic)
  // Weld FX does NOT use the per-action scratch contract above, and must not: React BATCHES dispatches, so
  // clearing the payload here destroyed welds that had not been rendered yet. A weld followed by any other
  // click in the same frame (in real play, almost always) coalesced into ONE render whose `weldFxUids` the
  // second action had already wiped — the ring never fired. Instead, record where this action starts;
  // `stampWeldFx` replaces on its first stamp of an action and accumulates after, so the payload survives
  // until the UI reads it and still never leaks between actions.
  state.weldFxBaseSeq = state.weldFxSeq ?? 0;
  stampImproveReps(state); // Rune of Mastery: mirror the state's Improve multiplier for the stateless addBuff hook
  // Pin this wave's opponent on the FIRST recruit action of the turn (reload-divergence fix, revived
  // 2026-07-18): the pick is stamped into `servedBoards` as soon as the turn is played, so the telegraphed
  // foe survives a reload instead of being re-picked from a session-variable pool (Supabase drift / fetch
  // timing — and now ledger-weight drift too). faceOmen's own pinning stays as the fallback for a turn with
  // zero prior actions. A null pick (empty pool → procedural fallback) is never pinned — later actions
  // retry as the pool fills. Pinning while the loss-streak softener is armed SPENDS it (once per streak).
  if (state.phase === 'recruit' && !(state.wave in (state.servedBoards ?? {}))) {
    const softening = streakSoftenerLosses(state) > 0;
    const preview = nextOpponent(state);
    if (preview) {
      state.servedBoards = { ...(state.servedBoards ?? {}), [state.wave]: preview };
      if (softening) state.streakSoftened = true;
    }
  }
  const next = reduceCore(state, action);
  // onGainAttack reactors (Hunter — "when this gains Attack, give your minions +Health") fire whenever a
  // recruit action raises a BOARD minion's Attack, from ANY source (Fortify, spells, tribe Battlecries,
  // weld, buy-triggers, end-of-turn). This mirrors combat, where `ctx.buff` emits onGainAttack on a positive
  // delta. We diff the board by uid: a minion present before AND after whose Attack strictly rose reacts.
  // New minions (played / summoned / Discovered) are creation, not a gain — skipped (a tripled reactor is
  // handled in `checkTriples`). Combat settles run in the combat phase, so the recruit-phase guard skips
  // them; the diff is ≤7 entries and `fireOnGainAttack` bails fast for non-reactors, so it's effectively free.
  if (next !== state && state.phase === 'recruit') {
    const before = new Map(state.board.map((c) => [c.uid, c.attack]));
    const handBefore = next.hand.length; // grows if a quest completing this action grants a card → triple-check
    for (const c of next.board) {
      const prev = before.get(c.uid);
      // Wrap the reactor so Hunter's "give your minions +Health" buff-to-others is captured as shop-buff FX,
      // sourced from the reacting minion `c` (a minion tendril), same as any other buff-other.
      if (prev !== undefined && c.attack > prev) captureBuffFx(next, c, 'minion', () => fireOnGainAttack(next, c));
    }
    // "Give Dragons N total stats" (Skybound Pact / Taragosa's Inheritance): sum the +Attack/+Health BUFFS a
    // Dragon present BEFORE and AFTER this action received (base stats of new Dragons are excluded — only gains
    // on existing Dragons, board + hand). Advances the `tribeStats` objective by that total.
    const statBefore = new Map([...state.board, ...state.hand].map((c) => [c.uid, { attack: c.attack, health: c.health }]));
    let dragonStatGain = 0;
    for (const c of [...next.board, ...next.hand]) {
      const prev = statBefore.get(c.uid);
      if (prev === undefined || !isTribe(c, 'dragon')) continue;
      dragonStatGain += Math.max(0, c.attack - prev.attack) + Math.max(0, c.health - prev.health);
    }
    if (dragonStatGain > 0) advanceQuestsBy(next, (o) => o.event === 'tribeStats' && o.tribe === 'dragon', dragonStatGain);
    // Spell Thesis: "Cast N spells" advances by the run-wide spellsCast delta this action.
    const spellCastDelta = (next.spellsCast ?? 0) - (state.spellsCast ?? 0);
    if (spellCastDelta > 0) advanceQuestsBy(next, (o) => o.event === 'castSpell', spellCastDelta);
    // Spell Power FX: one bump per action in which SPELL POWER WENT UP, by any source and any amount — not
    // per spell CAST (owner correction 2026-07-21: Cinderwing Matron's Shout buffs spell power and must fire
    // this, while casting a spell in a run with no spell-power sources must not). Both stats are watched:
    // spell power is a PAIR, and Cinderwing grants Health only, so an Attack-only check missed it entirely.
    // Derived from the before/after delta — NOT a per-action scratch field — so React batching can never
    // swallow it (the weld-FX bug).
    const spDeltaA = spellAttackBonus(next) - spellAttackBonus(state);
    const spDeltaH = spellHealthBonus(next) - spellHealthBonus(state);
    if (spDeltaA > 0 || spDeltaH > 0) {
      next.spellPowerFxSeq = (next.spellPowerFxSeq ?? 0) + 1;
      next.spellPowerFxAtk = Math.max(0, spDeltaA);
      next.spellPowerFxHp = Math.max(0, spDeltaH);
      // The acting card, when there is one — `play`/`buy`/`sell` all carry the uid, so the UI can anchor the
      // flourish to the minion that caused it. Left undefined for sourceless gains (quest/rune ticks).
      next.spellPowerFxUid = 'uid' in action && typeof action.uid === 'string' ? action.uid : undefined;
    }
    // Forsaken Will: each spell cast permanently buffs your Undead's Attack — exactly like the Forsaken Weaver
    // (bakes +N into every current Undead + `undeadBuyAtk` so future buys inherit it), so the quest reward feels
    // identical to the minion instead of a separate Lantern-style aura.
    if (spellCastDelta > 0 && next.forsakenWillAttack) buffUndeadAttackEverywhere(next, next.forsakenWillAttack * spellCastDelta, 'Forsaken Will');
    // Taragosa's Heir: a stat-gain amplifier — every stat gain THIS minion receives from any recruit-phase source
    // is multiplied (×2, golden ×3). We read the Heir's OWN +Attack/+Health this action and top it up by the extra
    // (mult−1)× so the net gain is mult×. The Heir's natural gain already counted toward the Dragon `tribeStats`
    // quest above; the amplified extra deliberately does not (added after that sum). Combat-phase gains aren't
    // amplified (this diff is recruit-only), matching the old reward's scope.
    const heir = next.board.find((c) => c.cardId === 'taragosaheir');
    if (heir) {
      const prev = statBefore.get(heir.uid);
      const dA = prev ? Math.max(0, heir.attack - prev.attack) : 0;
      const dH = prev ? Math.max(0, heir.health - prev.health) : 0;
      if (dA > 0 || dH > 0) {
        const extra = (heir.golden ? 3 : 2) - 1; // ×2 → +1× extra; ×3 → +2× extra
        addBuff(heir, "Taragosa's Inheritance", dA * extra, dH * extra);
      }
    }
    // Quest objectives (a successful recruit action already means `next !== state`):
    //  • buy / play / sell / roll — the tracked action (`buyQuest` itself is excluded from the map).
    //  • shout — the played card was a Battlecry minion (a "shout").
    //  • summon — EVERY minion that just ENTERED the board (the played card AND any tokens it summoned),
    //    narrowed by the objective's optional tribe. Reuses the same before/after board diff as onGainAttack;
    //    a play that immediately completes a triple counts as its NET board delta (the golden), not three.
    const questEvent = QUEST_TICK_EVENTS[action.type];
    if (questEvent) advanceQuests(next, (o) => o.event === questEvent);
    // Sell narrowed by the SOLD minion's tribe (Scrap Contract: "Sell 3 Mechs"); an untribed sell objective
    // (Grave Robber / Feed the Alpha) still ticks on any sell. The card is gone from `next` — read it from `state`.
    if (action.type === 'sell') {
      const soldCard = state.board.find((c) => c.uid === action.uid) ?? state.hand.find((c) => c.uid === action.uid);
      const sdef = soldCard ? CARD_INDEX[soldCard.cardId] : undefined;
      const stribes = sdef ? ([sdef.tribe, sdef.tribe2].filter(Boolean) as Tribe[]) : [];
      advanceQuests(next, (o) => o.event === 'sell' && (!o.tribe || stribes.includes(o.tribe)));
    }
    if (action.type === 'buy') {
      // "Buy N <tribe>" (Forager's Trail) / "Buy N Shout minions" (Warm Embers): narrow the buy tick to the
      // bought minion's tribe (dual-types count) and/or `filter: 'shout'` (has a Battlecry). Resolved from the
      // shop offer the action targeted.
      const offer = state.shop.find((c) => c.uid === action.uid);
      const bdef = offer ? CARD_INDEX[offer.cardId] : undefined;
      const tribes = bdef ? ([bdef.tribe, bdef.tribe2].filter(Boolean) as Tribe[]) : [];
      const isShout = !!bdef && hasBattlecry(bdef);
      advanceQuests(next, (o) => o.event === 'buy' && (!o.tribe || tribes.includes(o.tribe)) && (o.filter !== 'shout' || isShout));
      applyCardsBought(next, 1); // Korok / Banksly: "when you buy N cards" (the buy-count sibling of the Gold meter)
      next.cardsBoughtThisTurn = (next.cardsBoughtThisTurn ?? 0) + 1; // set 2: Frenzied Excavator's SoC scaler
    }
    // A Shout is a TRIGGER: each Battlecry FIRE (Drakko + shout-repeat rewards + charges) counts toward the Shout
    // objective. `lastShoutFires` was recorded during the play / target resolution (0 if no Shout fired).
    for (let i = 0; i < (next.lastShoutFires ?? 0); i++) advanceQuests(next, (o) => o.event === 'shout');
    if ((next.lastShoutFires ?? 0) > 0) bumpAuthorsHand(next, 'shout', next.lastShoutFires!); // Author's Hand Shout half
    // An Echo (Deathrattle) is a TRIGGER too: a recruit-phase Echo (Grave Robber's destroy, Gravetwin/Crypt Broker,
    // Sylus re-fires) counts toward the `deathrattle` objective + Author's Hand's Echo half, just like a combat one.
    // `lastEchoFires` was accumulated by `fireRecruitDeathrattles` (0 if none fired).
    if ((next.lastEchoFires ?? 0) > 0) {
      advanceQuestsBy(next, (o) => o.event === 'deathrattle', next.lastEchoFires!);
      bumpAuthorsHand(next, 'echo', next.lastEchoFires!);
    }
    if (action.type === 'play') {
      const played = state.hand.find((c) => c.uid === action.uid);
      const pdef = played ? CARD_INDEX[played.cardId] : undefined;
      // Play an Attachment (a Magnetic minion — whether it welds onto a Mech or stands alone): "Play N
      // Attachments" (Perfect Machine / Blueprint Cache / Shared Circuit).
      if (pdef?.keywords.includes('M')) {
        advanceQuests(next, (o) => o.event === 'playAttachment');
        // Rune of Structure: each Attachment you play from hand also conjures a random spell.
        if (next.runeStructure) conjureToHand(next, poolOf(next).spells.filter((c) => c.tier <= next.tier), 1);
      }
      // Trail Forager: each Beast you play raises every OTHER Trail Forager's sell value (+1, ×2 golden).
      if (pdef && (pdef.tribe === 'beast' || pdef.tribe2 === 'beast' || pdef.universalTribe)) {
        for (const c of next.board) {
          if (c.cardId === 'trailforager' && c.uid !== action.uid) c.sellBonus = (c.sellBonus ?? 0) + (c.golden ? 2 : 1);
        }
      }
    }
    for (const c of next.board) {
      if (before.has(c.uid)) continue; // only minions NOT present before this action count as summons
      const cdef = CARD_INDEX[c.cardId];
      const tribes = cdef ? ([cdef.tribe, cdef.tribe2].filter(Boolean) as Tribe[]) : [];
      advanceQuests(next, (o) => o.event === 'summon' && (!o.tribe || tribes.includes(o.tribe)));
      if (cdef?.imp) advanceQuests(next, (o) => o.event === 'summonImp'); // Imp Census / Implosion — recruit-summoned Imps
    }
    // A quest that completed this action may have granted a card to hand — if so, check for a triple (a quest
    // reward that's your 3rd copy combines into a golden). Guarded on a hand grant so it never re-triples the
    // action's own board state (the buy/play cases already handle their triples).
    if (next.hand.length > handBefore) checkTriples(next);
  }
  // Demon "Consume N Fodder" / "Consume N total stats" (Track and Fodder): advance by the run-wide Fodder-Consumed
  // delta this action — OUTSIDE the recruit-phase guard so a START-OF-TURN consume (fodder injected + eaten during
  // `advanceCombat`, part of the `resolveCombat` action while still in the combat phase) ALSO ticks the quest,
  // not just consumes from later recruit rolls (owner bug 2026-07-13).
  if (next !== state) {
    const fcBefore = state.runFodderConsumed ?? { count: 0, stats: 0 };
    const fcAfter = next.runFodderConsumed ?? { count: 0, stats: 0 };
    if (fcAfter.count > fcBefore.count) advanceQuestsBy(next, (o) => o.event === 'consumeFodder', fcAfter.count - fcBefore.count);
    if (fcAfter.stats > fcBefore.stats) advanceQuestsBy(next, (o) => o.event === 'consumeStats', fcAfter.stats - fcBefore.stats);
  }
  // Bump the FX sequence once per action that actually buffed OTHERS (including the Hunter reaction wrapped
  // above, which runs before this). The UI fires the shop-buff replay once per bump; a no-op / non-buffing
  // action leaves `recruitBuffFx` empty and the seq unchanged.
  if (next !== state && next.recruitBuffFx.length > 0) next.recruitFxSeq += 1;
  // AURA WASH FX: if a run-wide tribe-aura channel ROSE this action — the Undead aura (Lantern of Souls's
  // display-fold `undeadAttackBonus` AND the per-instance Undead-Attack snowball `undeadBuyAtk`:
  // Deathswarmer, Forsaken Mage's spell-cast buff, Forsaken Will), the Imp aura, the Attachment aura
  // (Scrap Herald), or the Beast buy-aura — stamp the one-shot wash signal with the affected visible cards.
  // Several of these never touch stored stats (the Lantern folds in at display time; buy-auras only size
  // FUTURE copies), so without the stamp the numbers jump with zero feedback. The undeadBuyAtk sources DO
  // also buff current Undead (→ tendrils) — the wash fires ALONGSIDE those (owner call: wash + tendrils).
  // Recruit-visible only: a faceOmen-time rise lands after the phase flips (the shop can't show it), so it
  // isn't stamped. Pure display metadata — never read by the sim.
  if (next !== state && state.phase === 'recruit' && next.phase === 'recruit') {
    const channels = (s: RunState): Record<AuraFxTribe, { a: number; h: number }> => ({
      undead: { a: s.undeadAttackBonus + (s.undeadBuyAtk ?? 0), h: s.undeadHealthBonus },
      demon: { a: s.impBuff?.attack ?? 0, h: s.impBuff?.health ?? 0 },
      mech: { a: s.magneticBuyAtk, h: s.magneticBuyHp },
      beast: { a: s.beastBuyAtk, h: s.beastBuyHp },
    });
    const cb = channels(state);
    const ca = channels(next);
    const risen: NonNullable<RunState['auraFx']> = [];
    for (const tribe of ['beast', 'demon', 'mech', 'undead'] as const) {
      const da = ca[tribe].a - cb[tribe].a;
      const dh = ca[tribe].h - cb[tribe].h;
      if (da > 0 || dh > 0) risen.push({ tribe, attack: Math.max(0, da), health: Math.max(0, dh), targets: auraFxTargets(next, tribe) });
    }
    if (risen.length > 0) {
      next.auraFx = risen;
      next.auraFxSeq = (next.auraFxSeq ?? 0) + 1;
    }
  }
  return next;
}

function reduceCore(state: RunState, action: Action): RunState {
  // Read-only rejections run BEFORE the deep clone — every no-op dispatch (a click while a Discover is
  // open, an out-of-phase action) used to pay the full structuredClone below for nothing.
  // A finished run (loss or victory) takes no more actions — restart goes through the store.
  if (state.phase === 'gameover' || state.phase === 'victory') return state;

  // Recruit actions apply only in the recruit phase; `settleCombat` / `resolveCombat` only in combat.
  if (state.phase !== 'recruit' && action.type !== 'resolveCombat' && action.type !== 'settleCombat') return state;

  // Modal recruit states — a pending Discover / Choose One / targeted Battlecry — block every other board
  // action until they resolve. The player can still inspect (a UI-only concern), so a Discover can be
  // minimized to read the board without any action invalidating the pending pick.
  // (`devGrant` is exempt too: the Scene Builder must stay responsive with an overlay up, and a reward that
  // raises a Discover now queues behind the open modal rather than stacking on it.)
  //
  // End Turn (`faceOmen`) is exempt SPECIFICALLY when a battlecry aim (`pendingTarget`) is the blocker, and
  // this is load-bearing. The round timer pauses for the Discover / quest / Runeforge overlays but NOT for a
  // pendingTarget aim, so the timer can expire mid-aim — and the UI then blocks the target pick too (`timeUp`).
  // With End Turn also rejected here, the player was permanently softlocked, and since `pendingTarget` is
  // saved, a reload landed straight back in it (owner report 2026-07-22). `faceOmen` already auto-resolves a
  // pending target onto the highest-Attack legal carry, so ending the turn is a safe, defined escape.
  // The exemption is deliberately NARROW — only `pendingTarget`, NOT the other modals: `chooseOne`'s options
  // stay clickable under `timeUp` (so it can always be resolved and needs no escape), and letting End Turn fire
  // over an open Discover / Choose One / quest / Runeforge would strand it going into combat.
  const endTurnEscapesAim = action.type === 'faceOmen' && !!state.pendingTarget;
  if (modalOpen(state) && action.type !== 'discover' && action.type !== 'chooseOne' && action.type !== 'battlecryTarget' && action.type !== 'buyQuest' && action.type !== 'buyRune' && action.type !== 'skipRuneforge' && action.type !== 'rerollRuneforge' && action.type !== 'devGrant' && !endTurnEscapesAim) {
    return state;
  }

  // Disco Dan: turn 1 is a pure Setlist — resolve the three locked Discovers, then end the turn straight into
  // combat. Every shop action (buy / sell / roll / freeze / upgrade / play / hero power) is blocked until turn
  // 2; Discover, board reordering, and ending the turn (faceOmen) stay open.
  if (state.heroId === 'discodan' && state.wave === 1
    && (action.type === 'buy' || action.type === 'sell' || action.type === 'roll' || action.type === 'freeze'
      || action.type === 'upgrade' || action.type === 'play' || action.type === 'heroPower')) {
    return state;
  }

  // PERF: `lastCombat` is a large read-only result (the whole prior fight's event log + initial board
  // snapshots) that the reducer never mutates in place — it only ever REPLACES the reference (faceOmen).
  // So deep-clone everything ELSE and share lastCombat by reference, dropping ~80–90% of the per-dispatch
  // clone cost (otherwise every recruit click re-cloned the entire event graph for nothing).
  const { lastCombat, ...rest } = state;
  const s = structuredClone(rest) as RunState;
  s.lastCombat = lastCombat;
  s.lastShoutFires = 0; // transient per-action Shout-fire count (set by a Battlecry play → read by the Shout quest tick)
  s.lastEchoFires = 0; // transient per-action out-of-combat Echo-fire count (set by fireRecruitDeathrattles → read by the deathrattle quest tick)
  s.questTendrilFx = []; // transient per-action list of quest-triggered units (read by the tendril FX)
  s.lastEotFires = 0; // transient per-action End-of-Turn-fire count (set by applyEndOfTurn → read by the EoT quest tick)

  switch (action.type) {
    case 'buy': {
      // The right-hand spell slot: pays its own (modifiable) cost, into the hand.
      // No triple / buy-trigger — a spell isn't a minion.
      if (s.spell && s.spell.uid === action.uid) {
        const spellDef = CARD_INDEX[s.spell.cardId];
        if (!spellDef) return state;
        const cost = Math.max(0, (spellDef.cost ?? 0) - spellCostReduction(s));
        if (s.embers < cost || s.hand.length >= CONFIG.handMax) return state;
        spendGold(s, cost);
        s.hand.push({
          uid: `b${s.uidSeq++}`,
          cardId: spellDef.id,
          tribe: spellDef.tribe,
          attack: spellDef.attack,
          health: spellDef.health,
          keywords: [...spellDef.keywords],
          golden: false,
        });
        s.spell = null; // bought — the slot stays empty until the next roll
        tiffBuyDiscount(s, spellDef); // Tiff: a spell buy banks a Dragon Tamer discount
        return s;
      }
      const i = s.shop.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const offer = s.shop[i]!;
      const card = CARD_INDEX[offer.cardId];
      if (!card) return state;
      // A spell offer sitting in the minion row (Spell Cart's spell shop) buys into the hand at its OWN cost,
      // exactly like the right-hand spell slot — no minion creation / triple.
      if (card.spell) {
        const sCost = Math.max(0, (card.cost ?? 0) - spellCostReduction(s));
        if (s.embers < sCost || s.hand.length >= CONFIG.handMax) return state;
        spendGold(s, sCost);
        s.shop.splice(i, 1);
        s.hand.push({ uid: `b${s.uidSeq++}`, cardId: card.id, tribe: card.tribe, attack: card.attack, health: card.health, keywords: [...card.keywords], golden: false });
        tiffBuyDiscount(s, card); // Tiff: a spell buy banks a Dragon Tamer discount
        return s;
      }
      // Displacement: a minion stashed in the tavern (held) is restored INTACT on buy — all buffs/progression
      // (deliberately NO applyOnBuy: it's a restoration, not a fresh purchase, so Broker & co. don't re-bake).
      if (offer.held) {
        const heldCost = minionCostOf(s);
        if (s.embers < heldCost || s.hand.length >= CONFIG.handMax) return state;
        spendGold(s, heldCost);
        s.shop.splice(i, 1);
        // Clone the mutable arrays so the re-bought minion doesn't SHARE keywords/buffs with its held copy.
        s.hand.push({ ...offer.held, uid: `b${s.uidSeq++}`, keywords: [...offer.held.keywords], buffs: offer.held.buffs ? [...offer.held.buffs] : undefined });
        drakkoQuestBuy(s, card); // a paid buy still progresses Drakko's quest (it used to be skipped)
        chronosQuestBuy(s, card); // …and Chronos's End-of-Turn quest
        tiffBuyDiscount(s, card); // …and a restored Dragon banks Tiff's discount
        gorrQuestBuy(s, card); // …and a restored minion counts toward Gorr's Four Peat
        checkTriples(s); // a restored copy can still complete a triple
        return s;
      }
      // "Freedom" rift: the FIRST minion bought each turn is free (overrides every price source below).
      const freeBuy = s.rift === 'freedom' && !s.freeBuyUsedThisTurn;
      const buyCost = freeBuy ? 0 : (offer.cost ?? s.minionCostOverride ?? minionCostOf(s)); // Moe's set price > Merchant's Mark override > Hank/default
      if (s.embers < buyCost || s.hand.length >= CONFIG.handMax) return state;
      s.shop.splice(i, 1);
      spendGold(s, buyCost);
      if (freeBuy) s.freeBuyUsedThisTurn = true;
      // Fried Circuits: each minion bought buffs every Mech OFFER remaining in the shop, escalating by step per
      // purchase (buy 1 → +step, buy 2 → +2·step, …). The buff bakes into the offer's atk/hp when it's bought.
      if (s.friedCircuitsStepAtk || s.friedCircuitsStepHp) {
        s.friedCircuitsBuys = (s.friedCircuitsBuys ?? 0) + 1;
        const aAtk = (s.friedCircuitsStepAtk ?? 0) * s.friedCircuitsBuys;
        const aHp = (s.friedCircuitsStepHp ?? 0) * s.friedCircuitsBuys;
        for (const o of s.shop) {
          const d = CARD_INDEX[o.cardId];
          if (d && (d.tribe === 'mech' || d.tribe2 === 'mech' || d.universalTribe)) addOfferBuff(o, 'Fried Circuits', aAtk, aHp);
        }
      }
      const cb = cardBuff(s, card.id); // persistent run buff (Ritualist's Fodder enchantment)
      // Run-wide tribe ATTACK aura baked at buy: Undead (Lantern/Toxin Tender) + Beast (Squirl Scout), via the
      // shared helper so every tribe is handled. Applied ONCE, through addBuff below (which also records the
      // inspect breakdown). NB: this used to bake it into `attack` here AND addBuff it again → a double-count
      // bug (a bought Undead got 2× undeadBuyAtk); it's now applied exactly once, and Beasts get it too.
      const buyAura = undeadBuyBonus(s, card);
      const bought: BoardCard = {
        uid: `b${s.uidSeq++}`,
        cardId: card.id,
        tribe: card.tribe,
        attack: card.attack + cb.attack, // base + persistent run buff; the tribe aura is added just below
        health: card.health + cb.health,
        keywords: [...card.keywords, ...(offer.keywords ?? []).filter((k) => !card.keywords.includes(k))],
        golden: offer.golden ?? false, // Golden Touch: a gilded tavern offer buys in as a Golden
        boughtWave: s.wave, // Hoarder's sell value climbs from the wave it was bought
      };
      // Tavern buffs on the offer (Apples / Fortify / Fried Circuits / next-shop) bake in under their REAL
      // source names, not a blanket "Fortify"; fall back to a generic label for any legacy offer with no breakdown.
      if (offer.buffs?.length) for (const b of offer.buffs) addBuff(bought, b.source, b.attack, b.health, b.count);
      else addBuff(bought, 'Tavern buff', offer.atk ?? 0, offer.hp ?? 0);
      const buyAuraHp = buyHealthAura(s, card); // Scrap Herald: Magnetic minions also carry a Health aura
      if (buyAura > 0 || buyAuraHp > 0) addBuff(bought, 'Tribe Bond', buyAura, buyAuraHp);
      // Staff of Guel — the run-wide "every minion you buy" buff bakes in too (tavern purchases only).
      // Fodder is excluded: it already carries the Staff buff via its run-wide enchant (cardBuff above),
      // so applying it again here would double it on the rare directly-bought Fodder.
      if ((s.tavernBuyBonus.atk || s.tavernBuyBonus.hp) && !card.keywords.includes('FD')) {
        addBuff(bought, 'Staff of Guel', s.tavernBuyBonus.atk, s.tavernBuyBonus.hp);
      }
      // Golden Touch: a gilded offer buys in Golden — double the BASE stats only (accrued buffs stay single,
      // like a gild / triple), recorded as a buff so the inspect breakdown still itemizes it. The golden flag
      // (set above) doubles its effects (Deathrattles twice, ×N multipliers) and shows the golden frame.
      if (offer.golden) addBuff(bought, 'Golden Touch', card.attack, card.health);
      s.hand.push(bought); // buy → hand (Battlegrounds flow)
      applyOnBuy(s, bought); // buy-triggers (Broker) bake in now (handoff C.5)
      // Dupes: the FIRST minion you buy each turn is copied into your hand (a fresh base copy, run buffs baked in).
      if (s.dupeFirstBuyEachTurn && !s.dupeUsedThisTurn && s.hand.length < CONFIG.handMax) {
        s.dupeUsedThisTurn = true;
        conjureToHand(s, CARD_INDEX[card.id] ? [CARD_INDEX[card.id]!] : [], 1);
      }
      drakkoQuestBuy(s, card); // Drakko's quest counts every paid Battlecry buy
      chronosQuestBuy(s, card); // Chronos's quest counts every paid End-of-Turn buy
      tiffBuyDiscount(s, card); // Tiff: a Dragon buy banks a Dragon Tamer discount
      gorrQuestBuy(s, card); // Gorr: the 3rd minion bought this turn conjures a random plain copy
      checkTriples(s); // a 3rd copy combines into a golden + grants a Discover
      return s;
    }

    case 'play': {
      // hand → board (Battlegrounds: play to trigger summon-buffs + Battlecry)
      const i = s.hand.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const card = s.hand[i]!;
      // Disco Dan: a Setlist minion is locked until you reach its shop tier — unplayable before then.
      if (card.lockedUntilTier && s.tier < card.lockedUntilTier) return state;
      // Brackus's Summit pick — locked until the run has spent enough Gold.
      if (card.lockedUntilGoldSpent && (s.goldSpent ?? 0) < card.lockedUntilGoldSpent) return state;
      // Hourglass Reserve: locked until next turn — unplayable until the wave advances.
      if (card.lockedUntilWave && s.wave < card.lockedUntilWave) return state;

      const def = CARD_INDEX[card.cardId];

      // Funeral on Loan: a BORROWED minion never enters the board — playing it triggers its Echo (Deathrattle)
      // out of combat, then it's destroyed (consumed from hand). No board slot needed; a non-Echo body just vanishes.
      if (card.borrowed) {
        s.hand.splice(i, 1);
        s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId];
        triggerBorrowedEcho(s, card);
        return s;
      }

      // Discover-on-play (data-driven): playing this card isn't a minion — it opens a Discover (a peek) and
      // is consumed (no board slot). The offer is resolved from the card's `discoverOnPlay` spec against the
      // live run. These are untargeted, so Yazzus does NOT multiply them (we return before `spellCasts`) —
      // exactly one Discover. Covers Sprout / Help Wanted / Tribe Portal / Corpse Board and the golden
      // Triple Reward token; new Discover spells need only the data field, no reducer change.
      if (def?.discoverOnPlay) {
        const dop = def.discoverOnPlay;
        s.hand.splice(i, 1);
        s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId]; // counts as a card played (Rune of Action)
        // Discover a SHOP SPELL (Rift-Sunk Codex) — a spell Discover ignores tier/tribe/filter (it draws the
        // tavern spell pool up to the current tier). Multi-cast by the full spell multiplier, like the minion
        // path below.
        if (dop.spell) {
          const spellCastsN = def.singleCast ? 1 : spellCasts(s, def);
          for (let n = 0; n < spellCastsN; n++) queueDiscover(s, { kind: 'spell' });
          if (!def.singleCast) s.nextSpellMult = undefined;
          if (!def.singleCast && s.spellFirstDoubleEachTurn) s.spellFirstUsedThisTurn = true;
          return s;
        }
        // `exactCurrentTier` (Key Findings) locks the pool to the live tavern tier; `exactTier` is a fixed tier
        // (Sprout); otherwise the offer tier is current + `tierOffset`.
        const exactTier = dop.exactCurrentTier ? s.tier : dop.exactTier;
        // A triple-reward Discover carries the tier it was GRANTED at (`grantedTier`) so its "one tier up" is
        // frozen — taverning up with it in hand no longer bumps the offer. Other Discovers read the live tier.
        const baseTier = card.grantedTier ?? s.tier;
        const tier = exactTier ?? baseTier + (dop.tierOffset ?? 0);
        const tribe = dop.tribe === 'dominant' ? (dominantBoardTribe(s) ?? undefined) : dop.tribe;
        const spec = {
          kind: 'minion' as const,
          tier,
          ...(exactTier !== undefined ? { exactTier } : {}),
          ...(dop.filter ? { filter: dop.filter } : {}),
          ...(tribe ? { tribe } : {}),
          ...(dop.topTierFirst ? { topTierFirst: true } : {}),
          ...(dop.maxTier !== undefined ? { maxTier: dop.maxTier } : {}),
          ...(dop.lockUntilNextTurn ? { lockWave: s.wave + 1 } : {}), // Hourglass Reserve: locked until next turn
          ...(dop.borrowed ? { borrowed: true } : {}), // Funeral on Loan: play → trigger Echo + destroy
        };
        // Multi-cast a Discover-spell by the full spell multiplier — open the Discover once per cast, the extras
        // queued behind the first. `spellCasts` folds in Nimbus (nextSpellMult), Ancient Runes (spellDoubleAlways)
        // and Spell Thesis (first-spell-each-turn); Yazzus is aimed-only so it's auto-excluded (a Discover spell is
        // untargeted). `singleCast` never multiplies. Bug fix (owner 2026-07-09): the old code read only
        // `nextSpellMult`, so Ancient Runes' "spells cast twice" silently did nothing for Discover spells.
        const casts = def.singleCast ? 1 : spellCasts(s, def);
        for (let n = 0; n < casts; n++) queueDiscover(s, { ...spec });
        if (!def.singleCast) s.nextSpellMult = undefined; // Nimbus charge spent (already folded into `casts`)
        if (!def.singleCast && s.spellFirstDoubleEachTurn) s.spellFirstUsedThisTurn = true; // Spell Thesis freebie spent
        return s;
      }

      // Rubies (set 2): a Ruby plays from hand onto a friendly minion — it grants that minion the Ruby's
      // current Attack/Health as a PERMANENT buff (source 'Ruby', itemized in the inspect breakdown so other
      // Kobolds can key off it), then is consumed. The buff is permanent exactly like a spell buff — shop or
      // combat, it never falls off (owner ruling 2026-07-23). A Ruby is NOT a Shop Spell: it
      // never touches `spellsCast` or any Shop-Spell trigger/quest; it advances its OWN `rubyCasts` counter,
      // and umbrella cards ("both spells and Rubies") read `spellsCast + rubyCasts`. No target → fizzle (kept).
      if (def?.ruby) {
        // A Ruby (target 'any') can land on a warband minion OR a tavern offer (buff it pre-buy) — same as an
        // `any` spell. No valid target → fizzle (kept in hand).
        const boardTarget = s.board.find((c) => c.uid === action.targetUid);
        const offer = s.shop.find((o) => o.uid === action.targetUid && !CARD_INDEX[o.cardId]?.spell);
        // Prismcaster: a Ruby played from hand casts `1 + Σ rubyExtraCast` times (× golden per Prismcaster).
        const casts = 1 + s.board.reduce((n, c) => n + (CARD_INDEX[c.cardId]?.rubyExtraCast ?? 0) * (c.golden ? 2 : 1), 0);
        if (boardTarget) {
          for (let n = 0; n < casts; n++) {
            addBuff(boardTarget, 'Ruby', card.attack, card.health);
            // Set 2 — the target's "when a Ruby is played on this" effects (Ruby Broker → Gold, Resonance → bounce).
            fireOnRubyPlayed(s, boardTarget, card.attack, card.health);
          }
          // Warding Ruby: grant its keyword (Ward = DS) to the target — permanent in the shop phase (baked here).
          const kw = def.rubyGrantKeyword;
          if (kw && !boardTarget.keywords.includes(kw)) boardTarget.keywords.push(kw);
        } else if (offer) { for (let n = 0; n < casts; n++) addOfferBuff(offer, 'Ruby', card.attack, card.health); }
        else return state;
        s.hand.splice(i, 1);
        const rubyCastsBefore = s.rubyCasts ?? 0;
        s.rubyCasts = rubyCastsBefore + casts;
        s.rubyCastsThisTurn = (s.rubyCastsThisTurn ?? 0) + casts;
        fireOnRubyCast(s, rubyCastsBefore, s.rubyCasts); // Gemgorge Fiend: every 3 casts → Consume a Shop minion
        return s;
      }

      // Other spells: cast on the chosen target, then consume — no board slot.
      if (def?.spell) {
        // Spell Choose One (Apples): a SPELL choice — its own thing, NOT a Battlecry. Pause for the pick,
        // keeping the spell in hand; the chosen effect is cast (and the spell consumed) in `chooseOne`.
        if (def.chooseOne?.length) {
          // A *targeted* Choose One spell (Anomaly Reactor = friendly; Crest of the Climb = any): the drag already
          // aimed — capture the target uid now so the chosen option lands on it. `any` also accepts a tavern
          // offer (buff it pre-buy). No valid target → fizzle (spell kept in hand).
          if (def.target === 'friendly' || def.target === 'any') {
            const boardTarget = s.board.find((c) => c.uid === action.targetUid);
            const offer = def.target === 'any' ? s.shop.find((o) => o.uid === action.targetUid && !CARD_INDEX[o.cardId]?.spell) : undefined;
            if (!boardTarget && !offer) return state;
            s.chooseOne = { uid: card.uid, cardId: def.id, spell: true, targetUid: action.targetUid };
            return s;
          }
          s.chooseOne = { uid: card.uid, cardId: def.id, spell: true };
          return s;
        }
        // Yazzus: while it's on the board, an *aimed* spell's effect resolves N times (2, or 3 if golden)
        // — the card is still consumed once. Untargeted economy/utility spells and `singleCast` spells
        // (Channeling the Devourer) never multi-fire (see `spellCasts`). The Discover-spells returned early
        // above. A bad target still fizzles before any cast (no partial state change).
        const casts = spellCasts(s, def);
        if (def.target === 'friendly' || def.target === 'any') {
          const boardTarget = s.board.find((c) => c.uid === action.targetUid);
          // Resonance only fires on a Battlecry minion — a non-Battlecry target fizzles (spell kept in hand).
          if (boardTarget && def.effects.some((e) => e.do === 'spellReplayBattlecry') &&
              !CARD_INDEX[boardTarget.cardId]?.effects.some((e) => e.on === 'onPlay')) return state;
          // Displacement (targetNoGolden): can't trade away a golden (triple) — fizzles, spell kept in hand.
          if (boardTarget && def.targetNoGolden && boardTarget.golden) return state;
          // Layaway needs a SHOP offer (keep + cost cut) — aimed at a board minion it fizzles, kept in hand.
          if (boardTarget && def.effects.some((e) => e.do === 'spellLayaway')) return state;
          // Displacement needs a tavern MINION to swap with (spells can't be displaced) — with none in the
          // tavern the swap can't happen, so the spell fizzles and stays in hand.
          if (boardTarget && def.effects.some((e) => e.do === 'spellDisplace') &&
              !s.shop.some((o) => !CARD_INDEX[o.cardId]?.spell)) return state;
          // `any` spells (Shatter, Front to Back) can also land on a tavern offer — buff it pre-buy.
          const offer = def.target === 'any' ? s.shop.find((o) => o.uid === action.targetUid) : undefined;
          if (boardTarget) for (let n = 0; n < casts; n++) castSpell(s, def, boardTarget);
          else if (offer) for (let n = 0; n < casts; n++) castSpellOnOffer(s, def, offer);
          else return state; // a valid target is required (a friendly minion, or a tavern offer for `any`)
        } else {
          for (let n = 0; n < casts; n++) castSpell(s, def, undefined); // untargeted run spell (Growth, Ember Pouch)
        }
        if (!def.singleCast) s.nextSpellMult = undefined; // Nimbus charge spent on this cast (already folded into `casts`)
        if (!def.singleCast && s.spellFirstDoubleEachTurn) s.spellFirstUsedThisTurn = true; // Spell Thesis freebie spent
        s.hand.splice(i, 1);
        s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId]; // one card played, even if it multi-cast (Rune of Action)
        // A spell that conjures minions (Undead Army, Summon Stone) can hand you a 3rd copy — combine it.
        checkTriples(s);
        return s;
      }

      // Magnetic (handoff A.4): a Magnetic minion dropped directly onto a friendly minion sharing
      // one of its tribes merges its stats in instead of taking a board slot — so it works on a full
      // board and fires no summon-buff / Battlecry. (Cling Drone → Mech; Heckbinder, a Demon/Mech,
      // → Mech or Demon.)
      if (card.keywords.includes('M') && action.toIndex !== undefined && action.toIndex < s.board.length) {
        const target = s.board[action.toIndex];
        if (target && magnetizesTo(card.cardId, target.cardId, target.addedTribes, target.allTribes)) {
          s.hand.splice(i, 1);
          s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId]; // a welded Magnetic is still a card played (Rune of Action)
          // Playing a Magnetic minion IS a summon — fire summon-buffs on it BEFORE welding, so the absorbed
          // body carries any tribe summon-buff into the host (Chaos Attachment counts as a Beast → Mama
          // Bear's +X/+X lands on it, then welds onto the host). Mutates card.attack/health, read below.
          fireSummonBuffs(s, card);
          // Money Bot magnetized in: its mana-per-turn rides along on the host Mech (and survives the
          // host's triple); selling the host removes it.
          const mDef = CARD_INDEX[card.cardId];
          const mana = (mDef?.manaPerTurn ?? 0) * (card.golden ? 2 : 1) + (card.manaBonus ?? 0);
          // Weld the magnetic onto the host — stats, keywords, mana — and let any Beatboxer mimic it.
          const weldPayload = {
            source: mDef?.name ?? card.cardId,
            attack: card.attack,
            health: card.health,
            keywords: card.keywords,
            mana,
            // Better Bot: weld its Rally (+5 Attack to other Mechs on attack, golden ×2) onto the host — stacks.
            // `card.rallyMechAtk` is added too: a magnetic can ITSELF be carrying an accrued Better Bot rally (a
            // host welded onto, then bounced to hand by Rune of Refrain), and re-welding it must pass that along —
            // exactly as `spellAura`/`fodderAura` below fold in their `card.*Bonus`. Dropping it silently lost the
            // rally when a carrier magnetic was re-welded (owner report 2026-07-22). A freshly-bought Better Bot
            // has no instance value (its base lives on the def), so def×golden + accrued never double-counts.
            rallyMechAtk: (mDef?.rallyMechAtk ?? 0) * (card.golden ? 2 : 1) + (card.rallyMechAtk ?? 0) || undefined,
            // Perfect Core: weld its "Rally: get a random spell" onto the host (golden grants 2) — stacks.
            rallySpell:
              (mDef?.effects?.some((e) => e.do === 'rallyGrantSpell') ? (card.golden ? 2 : 1) : 0) || undefined,
            // Spell-power aura (def.spellAura — no card carries it in the current set): welds onto the host — stacks.
            spellAura: (mDef?.spellAura ?? 0) * (card.golden ? 2 : 1) + (card.spellAuraBonus ?? 0) || undefined,
            // Heckbinder: weld its Fodder aura (+1/+2 to new Fodder, golden ×2) onto the host — stacks, and
            // carries any aura already welded onto the magnetic itself (a hosted Heckbinder re-welded).
            fodderAura: mDef?.fodderAura || card.fodderAuraBonus
              ? {
                  attack: (mDef?.fodderAura?.attack ?? 0) * (card.golden ? 2 : 1) + (card.fodderAuraBonus?.attack ?? 0),
                  health: (mDef?.fodderAura?.health ?? 0) * (card.golden ? 2 : 1) + (card.fodderAuraBonus?.health ?? 0),
                }
              : undefined,
          };
          weldMagnetic(s, target, weldPayload, card.cardId === 'cling' ? 1 : 0, 'play'); // 'play' = the card slid in from hand
          // The FIRST Attachment played each turn (this weld counts; a standalone Magnetic play counts at its
          // own site below): Rune of Tempering also gives the minion it attached to Ward; Rune of Replication
          // also welds a copy of the same payload onto your leftmost Mech (which may be this same host — the
          // copy stacks, matching the text "attaches a copy").
          s.attachmentsThisTurn = (s.attachmentsThisTurn ?? 0) + 1;
          if (s.attachmentsThisTurn === 1) {
            if (s.runeTempering && !target.keywords.includes('DS')) {
              target.keywords = [...target.keywords, 'DS'];
            }
            if (s.runeReplication) {
              const leftMech = s.board.find((c) => isTribe(c, 'mech'));
              if (leftMech) weldMagnetic(s, leftMech, { ...weldPayload, source: `${weldPayload.source} (Replication)` }, card.cardId === 'cling' ? 1 : 0);
            }
          }
          // A golden Magnetic still "plays" the triple when welded in — grant its Discover.
          if (card.golden) grantGoldenDiscover(s);
          return s;
        }
      }

      if (s.board.length >= CONFIG.boardMax) return state;
      s.hand.splice(i, 1);
      // Track every card played this turn (by cardId). Rune of Action reads its raw length ("each card you
      // played"); Pack Leader / Spirit Worgen filter it by tribe ("Beasts/Dragons you played"). Spells,
      // Discover-on-play cards and welded Magnetics also push into it below (they return before this line),
      // so the count is every hand card that resolved — tribe-filtered readers ignore the non-tribe ones.
      s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId];
      const to =
        action.toIndex === undefined
          ? s.board.length
          : Math.max(0, Math.min(s.board.length, action.toIndex));
      s.board.splice(to, 0, card);
      playCard(s, card);
      // A STANDALONE Magnetic play (no host — it took a board slot) is still "playing an Attachment": the
      // first each turn gets Tempering's Ward on itself, and Replication still copies it onto the leftmost
      // Mech (the standalone body itself qualifies if it's the leftmost Mech-tribe minion... it welds a copy).
      if (card.keywords.includes('M')) {
        s.attachmentsThisTurn = (s.attachmentsThisTurn ?? 0) + 1;
        if (s.attachmentsThisTurn === 1) {
          if (s.runeTempering && !card.keywords.includes('DS')) {
            card.keywords = [...card.keywords, 'DS'];
          }
          if (s.runeReplication) {
            const sDef = CARD_INDEX[card.cardId];
            const leftMech = s.board.find((c) => c.uid !== card.uid && isTribe(c, 'mech'));
            if (sDef && leftMech) {
              weldMagnetic(s, leftMech, {
                source: `${sDef.name} (Replication)`,
                attack: card.attack,
                health: card.health,
                keywords: card.keywords,
                mana: (sDef.manaPerTurn ?? 0) * (card.golden ? 2 : 1),
              }, card.cardId === 'cling' ? 1 : 0);
            }
          }
        }
      }
      // Rune of Refrain (reworked 2026-07-21): each Shout (Battlecry) minion you play has a 20% chance to
      // return to your hand right after — the actual instance, buffs/golden intact, its Shout already fired,
      // so replaying it fires again. (Was: the 3rd Shout each turn returned that turn's first.) The roll is
      // drawn off the run cursor so a reloaded/replayed run resolves it identically. No-op if the hand is full.
      {
        const playedDef = CARD_INDEX[card.cardId];
        if (playedDef && hasBattlecry(playedDef)) {
          s.shoutsThisTurn = (s.shoutsThisTurn ?? 0) + 1;
          if (s.shoutsThisTurn === 1) s.firstShoutUid = card.uid;
          if (s.runeRefrain) {
            const rrng = makeRng(s.rngCursor);
            const returns = rrng.int(100) < 20;
            s.rngCursor = rrng.state();
            if (returns && s.hand.length < CONFIG.handMax) {
              const idx = s.board.findIndex((c) => c.uid === card.uid);
              if (idx >= 0) {
                const [ret] = s.board.splice(idx, 1);
                if (ret) s.hand.push(ret);
              }
            }
          }
        }
      }
      // Choose One: pause for the player's pick before resolving triples / the golden Discover.
      if (CARD_INDEX[card.cardId]?.chooseOne?.length) {
        s.chooseOne = { uid: card.uid, cardId: card.cardId };
        return s;
      }
      // Targeted Battlecry (Toxin Tender → a friendly Undead): pause for the player to pick the target
      // (resolved in `battlecryTarget`) — but only if a *viable* target exists. The tribe-restricted pick
      // needs another matching friend; with none, the Battlecry simply doesn't fire and the minion plays
      // as-is (no prompt).
      const playedDef = CARD_INDEX[card.cardId];
      if (playedDef?.target === 'friendly') {
        const hasTarget = playedDef.targetTribe
          ? s.board.some((c) => c.uid !== card.uid && isTribe(c, playedDef.targetTribe!))
          // `targetNotSelf` (Graverobber): a board holding ONLY this minion has no legal pick, so don't
          // prompt — the Battlecry simply doesn't fire and it plays as a plain body.
          : playedDef.targetNotSelf
            ? s.board.some((c) => c.uid !== card.uid)
            : true;
        if (hasTarget) {
          s.pendingTarget = { uid: card.uid, cardId: card.cardId };
          return s;
        }
      }
      checkTriples(s);
      if (card.golden) grantGoldenDiscover(s);
      return s;
    }

    case 'chooseOne': {
      if (!s.chooseOne) return state;
      const co = s.chooseOne;
      const def = CARD_INDEX[co.cardId];
      const option = def?.chooseOne?.[action.index];
      if (!def || !option) return state;
      // A SPELL choose-one (Apples): the spell is still in hand — cast its chosen effect (a synthetic def with
      // just that option's effects, respecting Yazzus quantity), then consume it. Not a Battlecry.
      if (co.spell) {
        const hi = s.hand.findIndex((c) => c.uid === co.uid);
        if (hi < 0) { s.chooseOne = undefined; return s; }
        // A *targeted* spell Choose One (Anomaly Reactor) casts on the target the drag picked; the target may have
        // been removed (sold) since — fizzle the cast but still consume the spell. Untargeted (Apples) → no target.
        const target = co.targetUid ? s.board.find((c) => c.uid === co.targetUid) : undefined;
        // `any` Choose One (Crest): the aim may have been a tavern offer, not a board minion — buff it pre-buy.
        const offer = co.targetUid && !target ? s.shop.find((o) => o.uid === co.targetUid && !CARD_INDEX[o.cardId]?.spell) : undefined;
        if (co.targetUid && !target && !offer) { s.hand.splice(hi, 1); s.chooseOne = undefined; return s; }
        const casts = spellCasts(s, def);
        const synthetic = { ...def, effects: option.effects };
        for (let n = 0; n < casts; n++) {
          if (offer) castSpellOnOffer(s, synthetic, offer);
          else castSpell(s, synthetic, target);
        }
        if (!def.singleCast) s.nextSpellMult = undefined; // Nimbus charge spent (already folded into `casts`)
        if (!def.singleCast && s.spellFirstDoubleEachTurn) s.spellFirstUsedThisTurn = true; // Spell Thesis freebie spent
        s.hand.splice(hi, 1);
        s.playedThisTurn = [...(s.playedThisTurn ?? []), co.cardId]; // Choose One spell counts as a card played (Rune of Action)
        s.chooseOne = undefined;
        checkTriples(s);
        return s;
      }
      const card = s.board.find((c) => c.uid === co.uid);
      if (!card) return state;
      // A *targeted* Choose One (Runic Beetle): once the buff is chosen, defer to the player picking a
      // friendly target for it (via `battlecryTarget`) — but only when a viable target exists (tribe-
      // restricted, never self). With none, resolve now so the grant auto-picks (falls back to self).
      // Defer to targeting if the CHOSEN option needs a target — per-option `target` (The Godfodder's consume
      // option) takes precedence over the card-level `target` (Runic Beetle, whose options both target).
      const optTarget = option.target ?? def.target;
      if (optTarget === 'friendly') {
        const hasTarget = def.targetTribe
          ? s.board.some((c) => c.uid !== card.uid && isTribe(c, def.targetTribe!))
          : s.board.some((c) => c.uid !== card.uid);
        if (hasTarget) {
          s.chooseOne = undefined;
          s.pendingTarget = { uid: card.uid, cardId: card.cardId, optionIndex: action.index };
          return s;
        }
      }
      applyChooseOne(s, card, option.effects); // the chosen Battlecry resolves now
      s.chooseOne = undefined;
      checkTriples(s);
      if (card.golden) grantGoldenDiscover(s);
      openNextStartOfTurnModal(s); // this modal owned the screen — open whatever queued behind it
      return s;
    }

    case 'battlecryTarget': {
      if (!s.pendingTarget) return state;
      const pt = s.pendingTarget;
      const card = s.board.find((c) => c.uid === pt.uid);
      const target = s.board.find((c) => c.uid === action.targetUid);
      if (!card || !target) return state; // a friendly target is required
      // Self-targeting guard (Graverobber: destroying itself deleted the body that was paying for the spell).
      // Authoritative — the aim UI mirrors it, but the reducer is what actually decides.
      const ptDef = CARD_INDEX[pt.cardId];
      if ((ptDef?.targetNotSelf || ptDef?.targetTribe) && target.uid === card.uid) return state;
      // A deferred targeted Choose One (Runic Beetle) resolves the CHOSEN option's effects on the target; a
      // normal targeted Battlecry (Toxin Tender) re-fires the card's own onPlay effects.
      const opt = pt.optionIndex !== undefined ? CARD_INDEX[pt.cardId]?.chooseOne?.[pt.optionIndex] : undefined;
      if (opt) applyChooseOneTarget(s, card, opt.effects, target);
      else applyBattlecryTarget(s, card, target);
      s.pendingTarget = undefined;
      checkTriples(s);
      if (card.golden) grantGoldenDiscover(s);
      openNextStartOfTurnModal(s); // this modal owned the screen — open whatever queued behind it
      return s;
    }

    case 'sell': {
      // Sell from the board or the hand.
      let sold: BoardCard | undefined;
      const bi = s.board.findIndex((c) => c.uid === action.uid);
      if (bi >= 0) {
        sold = s.board[bi];
        s.board.splice(bi, 1);
      } else {
        const hi = s.hand.findIndex((c) => c.uid === action.uid);
        if (hi < 0) return state;
        // Spells can't be sold — they're only played for their effect.
        if (CARD_INDEX[s.hand[hi]!.cardId]?.spell) return state;
        sold = s.hand[hi];
        s.hand.splice(hi, 1);
      }
      // Hoarder sells for a flat 2 Gold (golden 4); everything else for the base sell value. Rune of
      // Bartering (Shout minions sell for 2) is folded into the shared helper, so the UI coin matches.
      // Quick Sale: the next minion sold this turn gets a one-shot bonus on top, then the bonus is spent.
      if (sold) {
        s.embers += sellValueOf(sold, s) + (s.nextSellBonus ?? 0);
        if (s.nextSellBonus) s.nextSellBonus = 0;
      }
      // On-sell effects (Hoard Whelp → get 6 Gold), fired after the card leaves the board/hand.
      if (sold) fireOnSell(s, sold);
      // Robin's Spoils: each minion you sell banks +1 Gold for the START of next turn — stacks all turn, lands
      // on top of the cap, then is consumed + reset when next turn's Gold is set (Hoarder's bonus channel).
      if (sold && getHero(s.heroId).power.kind === 'sellGold') s.bonusEmbersNextTurn = (s.bonusEmbersNextTurn ?? 0) + 1;
      // Return the copies to the shared pool (a golden ate three). Tokens aren't pooled → ignored.
      if (sold) returnToPool(s, sold.cardId, sold.golden ? 3 : 1);
      return s;
    }

    case 'roll': {
      // Refreshing Texts bank free rerolls — spend one before charging Mana.
      if (s.freeRolls > 0) {
        s.freeRolls -= 1;
      } else {
        const rc = refreshCostOf(s); // Tradesman pays 2
        if (s.embers < rc) return state;
        spendGold(s, rc); // gold spent → Acid / Banksly meter
      }
      s.frozen = false;
      refreshTavern(s);
      return s;
    }

    case 'freeze': {
      s.frozen = !s.frozen;
      return s;
    }

    case 'upgrade': {
      const cost = upgradeCostOf(s); // includes Hermit Hank's +2 surcharge
      const ceiling = maxTierFor(s.rift); // Summit raises it to 7
      if (s.tier >= ceiling || s.embers < cost) return state;
      spendGold(s, cost);
      s.tier += 1;
      s.upgradeCost = s.tier >= ceiling ? 0 : (CONFIG.upgradeCost[s.tier + 1] ?? 0);
      return s;
    }

    case 'buyQuest': {
      // Quest shop (waves 4/8/12): "buy" the offered quest at `index` for 0 Gold → it moves to activeQuests and
      // the offer clears. The tavern was already rolled at quest-open (advanceCombat), so the shop already sits
      // behind the overlay for a shop-informed pick — nothing to roll here.
      const offer = s.questOffer;
      if (!offer) return state; // no quest shop open
      const questId = offer[action.index];
      if (questId == null || !QUEST_INDEX[questId]) return state; // invalid pick
      (s.activeQuests ??= []).push({ questId, progress: 0, completed: false });
      s.questOffer = undefined;
      openNextStartOfTurnModal(s); // a quest turn can line up the Epic Runeforge / Discovers behind it — open next
      return s;
    }

    case 'devGrant': {
      // DEV Scene Builder only — drop a quest or rune into the run without playing to the turn that offers it.
      // Everything routes through the SAME reward engine a real buy/completion uses (`applyQuestReward`), so a
      // reward that conjures cards, opens a Discover or schedules a delayed re-fire behaves exactly as it would
      // in a real run. That is the whole point of the rig: test the interaction, not a mock of it.
      if (action.kind === 'rune') {
        const rune = RUNE_INDEX[action.id];
        if (!rune) return state;
        applyQuestReward(s, { id: rune.id, name: rune.name, reward: rune.reward } as unknown as QuestDef, true);
        (s.ownedRunes ??= []).push(rune.id);
      } else {
        const def = QUEST_INDEX[action.id];
        if (!def) return state;
        // Completed (the default) fills the bar and pays out once, exactly like a real completion. A REPEATABLE
        // quest never sets `completed` — it re-arms — so mirror that here rather than freezing it done.
        const completed = action.completed !== false;
        (s.activeQuests ??= []).push({
          questId: def.id,
          progress: completed ? def.objective.count : 0,
          completed: completed && !def.repeatable,
          completionCount: completed ? 1 : undefined,
        });
        if (completed) applyQuestReward(s, def, true);
      }
      checkTriples(s); // a granted copy can complete a triple (which opens its own Discover)
      openNextStartOfTurnModal(s); // a reward can raise a Discover — open it, or leave it queued behind an open modal
      return s;
    }

    case 'buyRune': {
      // Runeforge (turn 6): buy ONE offered rune for its Gold cost. Its reward applies for the run (via the
      // shared quest-reward engine), it joins `ownedRunes` (shown as a run-buff badge), and the forge closes.
      const offer = s.runeforgeOffer;
      if (!offer) return state;
      const runeId = offer[action.index];
      const rune = runeId != null ? RUNE_INDEX[runeId] : undefined;
      if (!rune) return state; // invalid pick
      if (s.embers < rune.cost) return state; // can't afford — no-op (the UI greys it out)
      spendGold(s, rune.cost);
      // Reuse the quest-reward engine — it reads only `reward` + `name` off the def.
      applyQuestReward(s, { id: rune.id, name: rune.name, reward: rune.reward } as unknown as QuestDef, true);
      (s.ownedRunes ??= []).push(rune.id);
      // The Runesmith's forge is a once-per-game HERO POWER; the quest-opened Epic forge is not — leave the
      // hero-power charge alone for it.
      if (!s.runeforgeEpic && !s.runeforgeNoCharge) s.heroPowerSpent = true;
      closeRuneforge(s);
      checkTriples(s); // a rune-granted copy might complete a triple (opens its own Discover)
      openNextStartOfTurnModal(s); // forge closed — open the next queued start-of-turn modal (unless a Discover just opened)
      return s;
    }

    case 'skipRuneforge': {
      // Leave the Runeforge without buying (e.g. you can't afford any) — closes it for the run.
      if (!s.runeforgeOffer) return state;
      if (!s.runeforgeEpic && !s.runeforgeNoCharge) s.heroPowerSpent = true;
      closeRuneforge(s);
      openNextStartOfTurnModal(s); // forge closed — open the next queued start-of-turn modal
      return s;
    }

    case 'rerollRuneforge': {
      // Re-roll the offered runes ONCE, for 2 Gold — a fresh set drawn (preferring runes NOT currently shown) from
      // whichever runeset this forge is (normal or Epic). Seeded off a salted stream so it's deterministic.
      if (!s.runeforgeOffer || s.runeforgeRerolled || s.embers < 2) return state;
      spendGold(s, 2);
      const rng = makeRng(mixSeed(s.seed, s.wave, TAG.QUEST, 1));
      s.runeforgeOffer = drawRunes(runeforgePool(s), RUNEFORGE_OFFER, rng, new Set(s.runeforgeOffer));
      s.runeforgeRerolled = true;
      return s;
    }

    case 'reposition': {
      const i = s.board.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const to = Math.max(0, Math.min(s.board.length - 1, action.toIndex));
      const [card] = s.board.splice(i, 1);
      if (card) s.board.splice(to, 0, card);
      return s;
    }

    case 'reorderShop': {
      // Purely cosmetic — rearrange the current offers (so dragging an offer lands where
      // you drop it, like the warband, instead of snapping back to its slot).
      const i = s.shop.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const to = Math.max(0, Math.min(s.shop.length - 1, action.toIndex));
      const [card] = s.shop.splice(i, 1);
      if (card) s.shop.splice(to, 0, card);
      return s;
    }

    case 'reorderHand': {
      // Purely cosmetic — rearrange the hand (drag a card sideways to reorder it), the hand's parallel to
      // reorderShop. Hand order has no gameplay effect; this just lets the player organize their cards.
      const i = s.hand.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const to = Math.max(0, Math.min(s.hand.length - 1, action.toIndex));
      const [card] = s.hand.splice(i, 1);
      if (card) s.hand.splice(to, 0, card);
      return s;
    }

    case 'heroPower': {
      const power = getHero(s.heroId).power;
      // Some powers unlock on a later turn (Myra's Encore — turn 3); locked before then.
      if (s.wave < (power.unlockWave ?? 1)) return state;
      // Once-per-game powers (Gild) gate on heroPowerSpent; maxUses powers (Gildmaster: 2 total) gate on the
      // whole-game count AND the once-per-turn charge; the rest just recharge each wave.
      const heroUses = s.heroPowerUses ?? 0;
      const available = power.maxUses
        ? heroUses < power.maxUses && s.heroReady
        : power.oncePerGame
          ? !s.heroPowerSpent
          : s.heroReady;
      if (!available) return state;
      // Powers with a Mana cost (Nadja's Mana Font) also need the Mana on hand.
      if (power.cost && s.embers < power.cost) return state;
      const card = s.board.find((c) => c.uid === action.uid);
      // Rune of Empowerment (Epic): the hero power's effect triggers twice. Threaded into the value/generate
      // powers below (scalingGold / gainMaxMana / fortify / dynamiteDig — the DOUBLEABLE_POWERS the rune is
      // gated to). A targeted single-application power (Gild / Ward) can't meaningfully double, so `reps` is
      // only read by those four branches.
      const reps = s.runeEmpowerment ? 2 : 1;

      if (power.kind === 'gild') {
        // Indy: make a friendly board minion Golden — doubles its BASE stats (recorded as a "Gild" buff so the
        // inspect breakdown still sums; accrued buffs are NOT doubled — see `gildMinion`) AND flips the golden
        // flag, which doubles its effects (Deathrattles fire twice, ×N multipliers, etc.). Board only; a no-op
        // (and no charge spent) on a missing target or an already-golden minion.
        if (!card || card.golden) return state;
        gildMinion(card);
        // Indy: arm the recharge — the charge comes back after 40 more Gold is spent (see `spendGold`).
        s.indyGildRearmAt = (s.goldSpent ?? 0) + 40;
      } else if (power.kind === 'replayBattlecry') {
        // Myra: re-trigger a friendly board minion's Battlecry. Board only; a no-op (no charge
        // spent) on a missing target or a minion with no Battlecry to replay.
        if (!card || !replayBattlecry(s, card)) return state;
      } else if (power.kind === 'replayEndOfTurn') {
        // (legacy) proc a single friendly board minion's End of Turn now. No-op on a missing target or a
        // minion with no End-of-Turn effect.
        if (!card || !replayEndOfTurn(s, card)) return state;
        // Same endOfTurn advance as Djinn below — not on a live hero today, but it carries the identical bug.
        if ((s.lastEotFires ?? 0) > 0) advanceQuestsBy(s, (o) => o.event === 'endOfTurn', s.lastEotFires);
      } else if (power.kind === 'replayAllEndOfTurn') {
        // Djinn's Cadence: trigger EVERY friendly End of Turn now (untargeted) — BOTH halves of the player's
        // End-of-Turn engine, exactly as the natural end of turn (`applyEndOfTurn`) does: every board minion's
        // `endOfTurn` effects, AND the quest/rune-granted recurring rewards (Echoing Roar, The Hoard Wakes,
        // Rune of Spending/Action, …). Covering only the board silently skipped half of what the player built
        // (owner ruling 2026-07-22). Fires on a snapshot of the board so a minion an EoT summons doesn't also
        // proc this activation. No-op (no charge spent) if there was nothing at all to trigger.
        let any = false;
        for (const c of [...s.board]) if (replayEndOfTurn(s, c)) any = true;
        if (replayRecurringEndOfTurn(s)) any = true;
        if (!any) return state;
        // Advance Parliament of Flame here, at the source. `replayEndOfTurn` accumulated its fires into
        // `lastEotFires` (zeroed at action start), and this is the ONLY writer this action — the natural
        // end-of-turn (1268) and Conductor (2100) reads live on different dispatches, so advancing here can't
        // double-count them. Without this a heroPower action reaches neither read (audit 2026-07-21).
        if ((s.lastEotFires ?? 0) > 0) advanceQuestsBy(s, (o) => o.event === 'endOfTurn', s.lastEotFires);
      } else if (power.kind === 'grantWard') {
        // Warden's Aegis: give a friendly board minion a PERMANENT Ward (Divine Shield) for 4 Gold. No-op (no
        // charge/gold spent) on a missing target or one that already has a Ward.
        if (!card || card.keywords.includes('DS')) return state;
        card.keywords.push('DS');
      } else if (power.kind === 'scalingGold') {
        // Bagger Ben's Bag It: gain Gold now, the payout climbing +1 each turn (turn 1 → 2, turn 2 → 3, …).
        // Untargeted; the once-per-turn charge is spent by the shared block below.
        s.embers += (1 + s.wave) * reps;
      } else if (power.kind === 'dynamiteDig') {
        // Jensen: Discover a minion of your CURRENT tier — the FIRST dig is free, then the cost climbs 1
        // each use (0, 1, 2, …). Untargeted; cost + use count handled here (not the shared block).
        const digCost = heroUses;
        if (s.embers < digCost) return state; // can't afford this use → no charge spent
        spendGold(s, digCost);
        s.heroPowerUses = heroUses + 1; // escalate the next use's cost
        // Empowerment: two Discovers. queueDiscover opens the first and queues the rest on its own.
        for (let r = 0; r < reps; r++) queueDiscover(s, { kind: 'minion', tier: s.tier, exactTier: s.tier });
      } else if (power.kind === 'dragonTamer') {
        // Tiff: Discover a Dragon for 5 Gold, reduced 1 per Dragon/spell bought since the last use
        // (`tiffDiscount` via dragonTamerCostOf, floor 0). Untargeted; the shrinking cost is charged here
        // (not the shared block) and the discount bank resets on use.
        const tamerCost = dragonTamerCostOf(s);
        if (s.embers < tamerCost) return state; // can't afford → no charge spent
        spendGold(s, tamerCost);
        s.tiffDiscount = 0;
        // Empowerment: two Discovers. queueDiscover opens the first and queues the rest on its own.
        for (let r = 0; r < reps; r++) queueDiscover(s, { kind: 'minion', tier: s.tier, tribe: 'dragon' });
      } else if (power.kind === 'resummon') {
        // The Reclaimer: mark a friendly board minion to be destroyed + resummoned at start of
        // combat (the combat sim does the work). Mark exactly one (clear any previous mark).
        if (!card) return state;
        for (const c of s.board) c.resummon = false;
        card.resummon = true;
      } else if (power.kind === 'displace') {
        // Darah: swap a friendly board minion with a random tavern minion. No-op (no charge spent) on a
        // missing target, a golden minion (can't trade away a triple — enforced in swapWithTavern), or an
        // empty tavern.
        if (!card || !swapWithTavern(s, card)) return state;
      } else if (power.kind === 'grantReborn') {
        // Lord of the Risen: give a friendly board minion Rise for the NEXT combat only. The 'R' keyword
        // shows immediately (pill + snapshot); `tempReborn` marks it so settleCombat strips it after the
        // fight. No-op (no charge spent) on a missing target or one that already has Rise.
        if (!card || card.keywords.includes('R')) return state;
        card.keywords.push('R');
        card.tempReborn = true;
      } else if (
        power.kind === 'spellAmplify' || power.kind === 'quest' || power.kind === 'collision' || power.kind === 'sellGold'
        || power.kind === 'chaos' || power.kind === 'cheapMinions' || power.kind === 'discoLock'
        || power.kind === 'questChronos' || power.kind === 'lesserQuest' || power.kind === 'runeforge'
        || power.kind === 'pathfinder' || power.kind === 'epicRuneforge' || power.kind === 'recurringGoldcrafter'
      ) {
        // Passive powers have no activation — the work happens elsewhere (spell math, the buy/sell case,
        // settleCombat, the turn-advance quest/discover/Goldcrafter hooks). Nothing to do on a power click.
        return state;
      } else if (power.kind === 'gainMaxMana') {
        // Nadja: +1 max Gold permanently, ABOVE the cap and PERSISTENT. Routes through `maxGoldBonus` (the
        // Shop-License channel that stacks on top of the natural curve) — NOT `s.maxEmbers`. The old
        // `s.maxEmbers += reps` looked uncapped while she powered every turn, but the natural-growth line
        // (`Math.max(maxEmbers, min(cap, maxEmbers+1))`) can never push maxEmbers past the cap — so reaching 10
        // early just pre-spent the natural growth she'd have gotten anyway, and her lead evaporated the moment
        // she stopped (owner report 2026-07-22: powered turns 1–4 → stuck at 10, a normal player catches up).
        // `maxGoldBonus` sits above the base 10 that maxEmbers still climbs to on its own, so powering turns 1–4
        // reads 11/12/13/14 across turns 5–8 — the lead persists. Untargeted; falls through to the shared spend.
        s.maxGoldBonus = (s.maxGoldBonus ?? 0) + reps;
      } else {
        // Warden's Fortify: +Tier/+Tier (scales with Tavern Tier). Targets "a minion" — a
        // warband minion directly, or a tavern offer (the buff bakes in when it's bought).
        const amt = s.tier * reps;
        if (card) addBuff(card, 'Fortify', amt, amt); // raises Attack → the reduce() boundary fires Hunter's onGainAttack
        else {
          const offer = s.shop.find((c) => c.uid === action.uid);
          if (!offer) return state;
          addOfferBuff(offer, 'Fortify', amt, amt);
        }
      }

      if (power.oncePerGame) s.heroPowerSpent = true;
      else s.heroReady = false;
      if (power.maxUses) s.heroPowerUses = heroUses + 1; // whole-game activation budget (Gildmaster: 2)
      if (power.cost) spendGold(s, Math.min(s.embers, power.cost)); // gold spent → Acid / Banksly meter
      // A power that summons or generates a minion (Myra's Battlecry replay → an Alleycat's Stray,
      // Dusk's End-of-Turn replay) can complete a triple — check now, like buy / play / discover do.
      checkTriples(s);
      return s;
    }

    case 'discover': {
      if (!s.discover) return state;
      const id = s.discover[action.index];
      const def = id ? CARD_INDEX[id] : undefined;
      if (!def) return state;
      const dcb = cardBuff(s, def.id); // a discovered Fodder carries Ritualist's run buff
      // The hand is a hard 10-card cap: a Discover into a full hand adds nothing (the pick is forfeit rather
      // than over-capping). Only claim a pool copy when the card is actually taken.
      if (s.hand.length < CONFIG.handMax) {
        const taken: BoardCard = {
          uid: `b${s.uidSeq++}`,
          cardId: def.id,
          tribe: def.tribe,
          // A discovered Undead carries the run-wide Undead Attack bonus too (undeadBuyAtk), like a buy.
          ...conjuredStats(s, def, dcb),
          keywords: [...def.keywords],
          golden: false,
          // Disco Dan's Setlist: this pick is locked in hand until you reach its shop tier (T2/T4/T6).
          ...(s.discoverLockTier ? { lockedUntilTier: s.discoverLockTier } : {}),
          ...(s.discoverLockGold ? { lockedUntilGoldSpent: s.discoverLockGold } : {}),
          ...(s.discoverLockWave ? { lockedUntilWave: s.discoverLockWave } : {}), // Hourglass Reserve
          ...(s.discoverBorrowed ? { borrowed: true } : {}), // Funeral on Loan
        };
        // A GILDED Discover (a golden Salvatore McKlusky) hands the pick over already gilded — the same
        // transform a triple applies, so the stats/keywords stay consistent with every other golden.
        if (s.discoverGolden) gildMinion(taken);
        s.hand.push(taken);
        takeFromPool(s, def.id); // a discovered copy leaves the shared pool (so selling it returns)
      }
      s.discoverLockTier = undefined; // consumed — the next queued Discover sets its own (or none)
      s.discoverLockGold = undefined;
      s.discoverLockWave = undefined;
      s.discoverBorrowed = undefined;
      s.discoverGolden = undefined;
      // Open the next queued Discover (golden / Drakko-doubled Brian, Yazzus-multiplied Help Wanted /
      // Sprout); only clear the offer once the queue is empty. A spec whose pool is empty opens nothing
      // (offerDiscover/offerSpellDiscover leave `discover` unset) — keep draining the rest so the queue
      // never strands behind a closed Discover.
      s.discover = undefined;
      while (!s.discover && s.discoverQueue && s.discoverQueue.length > 0) {
        openDiscover(s, s.discoverQueue.shift()!);
      }
      checkTriples(s); // the discovered copy might itself complete a triple
      openNextStartOfTurnModal(s); // if this Discover was the last thing blocking a queued start-of-turn modal, open it
      return s;
    }

    case 'faceOmen': {
      // An unresolved targeted Battlecry (the player ended the turn mid-pick) auto-resolves on the
      // carry — never strand a played Toxin Tender without its grant.
      if (s.pendingTarget) {
        const pt = s.pendingTarget;
        const src = s.board.find((c) => c.uid === pt.uid);
        const def = src ? CARD_INDEX[src.cardId] : undefined;
        // A tribe-restricted pick (Toxin Tender → another friendly Undead, never self) must respect it;
        // otherwise any friend works. No eligible target → the play resolves with no effect.
        const pool = def?.targetTribe ? s.board.filter((c) => c !== src && isTribe(c, def.targetTribe!)) : s.board;
        const carry = pool.length ? pool.reduce((a, b) => (b.attack > a.attack ? b : a)) : undefined;
        if (src && carry) {
          // A deferred targeted Choose One (Runic Beetle) auto-resolves the chosen option on the carry.
          const opt = pt.optionIndex !== undefined ? def?.chooseOne?.[pt.optionIndex] : undefined;
          if (opt) applyChooseOneTarget(s, src, opt.effects, carry);
          else applyBattlecryTarget(s, src, carry);
        }
        s.pendingTarget = undefined;
      }
      // End-of-turn triggers fire first and bake into the board's stats (handoff C.5).
      applyEndOfTurn(s);
      // Re-Pete's Second Hand: at the END of every 3rd turn (3, 6, 9, …), conjure a PLAIN copy of the
      // left-most card in hand — base stats only (no buffs/golden/welds carried) and NO pool take (a
      // conjured card). Hand-cap-safe; an empty hand grants nothing. (Owner correction 2026-07-16:
      // end-of-turn, not start-of-shop.)
      if (getHero(s.heroId).power.kind === 'secondHand' && s.wave % 3 === 0 && s.hand.length > 0) {
        conjurePlainCopy(s, s.hand[0]!.cardId);
      }
      advanceQuestsBy(s, (o) => o.event === 'endOfTurn', s.lastEotFires ?? 0); // Parliament of Flame: "Trigger N End-of-Turn effects"
      // Resolve combat now (deterministic) but don't apply the outcome yet —
      // the UI replays the event log, then dispatches `resolveCombat`.
      // Serve a strength-matched real board from the opponent pool when one exists (getting off the
      // procedural omen blobs); otherwise fall back to the procedural threat. `nextOpponent` (which the
      // recruit-phase opponent frame previewed) makes the pick; the fallback gets its own fresh rng, so an
      // empty / no-match pool stays byte-identical to before the pool seam existed.
      // OPPONENT PINNING: if this wave's board was already decided (a restored / replayed run carries it in
      // `servedBoards`), serve THAT exact board — so the fight reproduces even if the shared pool has since
      // changed. Otherwise pick fresh (deterministic from seed+wave GIVEN the pool) and record the choice.
      // `null` = the procedural threat was used; key presence marks the wave as decided. No behavior change on a
      // normal forward turn (the key is absent → picks + records exactly as before).
      const pinned = s.servedBoards ? Object.prototype.hasOwnProperty.call(s.servedBoards, s.wave) : false;
      const served = pinned ? (s.servedBoards![s.wave] ?? null) : nextOpponent(s);
      if (!pinned) s.servedBoards = { ...(s.servedBoards ?? {}), [s.wave]: served };
      const player: BoardMinion[] = s.board.map((b) => ({
        cardId: b.cardId,
        attack: b.attack,
        health: b.health,
        keywords: [...b.keywords],
        golden: b.golden,
        ...(b.addedTribes && b.addedTribes.length ? { addedTribes: [...b.addedTribes] } : {}), // Anomaly Reactor: a spell-added tribe (→ combat tribe2) — was dropped, so the tribe stopped counting in the player's own fights
        ...(b.bloodlust ? { bloodlust: true } : {}), // Bloodlust: a Start-of-Combat immune out-of-turn strike — was dropped, so it never fired
        ...(b.bloodlustRally ? { bloodlustRally: true } : {}), // Bloodlust's welded Rally (give a friendly minion this minion's Attack)
        summonBonus: b.summonBonus ?? 0,
        overflowBonus: b.overflowBonus, // Flowing Monk: flat grant bonus from the triple combine
        hpGrantBonus: b.hpGrantBonus ?? 0, // Sergeant: seed the Deathrattle HP-grant accrual into combat
        ascendProgress: b.ascendProgress ?? 0, // Tara: seed the prior ascend tally so the live tracker shows the total
        spellProgress: b.spellProgress, // Guel: seed his on-board spell tally so the live combat text scales (not stuck at base)
        eotBonus: b.eotBonus, // Ritualist: seed the End-of-Turn grant so the live combat text reads its current per-tick value
        sellBonus: b.sellBonus, // Trail Forager: seed the accrued sell value for the live combat text (no combat effect)
        eotTick: b.eotTick, // Frontdrake / Money Maker / Vineweaver: seed the cadence counter for the live combat text
        sourceUid: b.uid, // so combat can carry Avenge improvements back to this card
        rallyMechAtk: b.rallyMechAtk, // Better Bot's accrued Rally (own base added at instantiate)
        rallySpellWeld: b.rallySpellWeld, // Perfect Core's welded Rally (grant a spell on attack) — was dropped
        resummon: b.resummon, // The Reclaimer's start-of-combat destroy + resummon mark
        ...(b.copiedEcho?.length ? { copiedEcho: b.copiedEcho } : {}), // Gravetwin: its copied Echo procs on combat death
        ...(b.bloodbinderMode ? { bloodbinderMode: b.bloodbinderMode } : {}), // Bloodbinder: seed this fight's Rally stat (atk/hp)
        ...(b.allTribes ? { universalTribe: true } : {}), // Anomaly Reactor: "All" types → universal in combat
        buffs: b.buffs, // recruit-phase buff breakdown → carried into combat so the inspect panel itemizes it
      }));
      // Fleeting Vigor — a one-shot Start-of-Combat buff banked last shop: pump the player's COMBAT board
      // (not the run board, so it's gone after this fight), then spend it. Applied before the odds sims so
      // every simulation sees the same buffed board. Captured so we can telegraph it once combat resolves —
      // a pre-baked buff with no event reads as "nothing happened", so we narrate the surge below.
      const fleeting = s.fleetingVigor && (s.fleetingVigor.attack !== 0 || s.fleetingVigor.health !== 0)
        ? { ...s.fleetingVigor } : null;
      if (fleeting) {
        for (const m of player) { m.attack += fleeting.attack; m.health += fleeting.health; }
        s.fleetingVigor = { attack: 0, health: 0 };
      }
      // Next-combat keyword grants (Field Maneuvers / Last Stand / Executioner's Edge): stamp each banked
      // keyword onto its minion's COMBAT instance only (matched by sourceUid), then spend the bank — gone
      // after this fight, exactly like Fleeting Vigor. A grant whose minion was sold/died simply finds no match.
      if (s.pendingCombatKeywords?.length) {
        for (const grant of s.pendingCombatKeywords) {
          const m = player.find((p) => p.sourceUid === grant.uid);
          if (!m) continue;
          m.keywords ??= [];
          if (!m.keywords.includes(grant.keyword)) m.keywords.push(grant.keyword);
          if (grant.keyword === 'CR' && grant.critChance !== undefined) m.critChance = grant.critChance;
        }
        s.pendingCombatKeywords = [];
      }
      // Open the Gates (Set 2): banked Imps enter this fight on the player board, as many as fit the 7-slot cap
      // (the "whenever you have room" clause). Added before the odds sims so every sim sees them, then spent.
      if (s.pendingSCImps) {
        const impDef = CARD_INDEX['impscrap'];
        const room = Math.max(0, CONFIG.boardMax - player.length);
        const n = Math.min(s.pendingSCImps, room);
        for (let k = 0; k < n && impDef; k++) {
          player.push({ cardId: 'impscrap', attack: impDef.attack, health: impDef.health, keywords: [...impDef.keywords], golden: false });
        }
        s.pendingSCImps = 0;
      }
      // The procedural threat board for this wave — the always-fightable fallback (built from current
      // cards, so it can never throw). `enemyTier` (loss-damage scaling) is the served board's tavern tier,
      // or the player's own tier as the foe's stand-in for the procedural board.
      const proceduralEnemy = (): { enemy: BoardMinion[]; tier: number } => ({
        enemy: buildEnemyBoard(s.threat, s.wave, makeRng(mixSeed(s.seed, s.wave, TAG.ENEMY))),
        tier: s.tier,
      });
      // Resolve the real combat + its win/draw/loss odds against one enemy board. Throws only if that board
      // is unfightable (a served board referencing a card this build removed → `instantiate` throws) — caught
      // below. Odds: re-simulate the same two boards on independent seeds (a separate ODDS stream, so they're
      // reproducible and don't disturb the real combat RNG). ~1000 sims keeps the margin to ~±1.5%.
      // Pack Leader: Beasts you PLAYED this turn (frozen for combat), threaded into simulate like spellsThisTurn.
      const beastsPlayed = (s.playedThisTurn ?? []).filter((id) => {
        const d = CARD_INDEX[id];
        return !!d && (d.tribe === 'beast' || d.tribe2 === 'beast');
      }).length;
      // The PLAYER side's run-level combat context — one symmetric `CombatSideState`, built once from the live
      // RunState and shared by the real fight + the 1000-sim odds probe.
      const playerState: CombatSideState = combatSide({
        spellsThisTurn: s.spellsThisTurn,
        spellsCast: s.spellsCast,
        deathrattles: s.deathrattlesTriggered,
        spellPowerAtk: spellAttackBonus(s),
        spellPowerHp: spellHealthBonus(s),
        undeadAtk: s.undeadAttackBonus,
        undeadHp: s.undeadHealthBonus,
        undeadBuyAtk: s.undeadBuyAtk ?? 0,
        impAtk: s.impBuff?.attack ?? 0,
        impHp: s.impBuff?.health ?? 0,
        fodderConsumedAtk: s.fodderConsumedThisTurn?.attack ?? 0,
        fodderConsumedHp: s.fodderConsumedThisTurn?.health ?? 0,
        beastBuyAtk: s.beastBuyAtk ?? 0,
        beastsPlayed,
        cardsBoughtThisTurn: s.cardsBoughtThisTurn ?? 0,
        magneticAtk: s.magneticBuyAtk ?? 0,
        magneticHp: s.magneticBuyHp ?? 0,
        rubyBonus: s.rubyBonus ?? { attack: 0, health: 0 },
        tier: s.tier,
        tribes: s.tribes,
        cardBuffs: s.cardBuffs ?? {},
        questMods: questCombatMods(s),
        pendingQuests: buildPendingCombatQuests(s),
      });
      // Player-only one-fight rune overrides.
      const config: CombatConfig = {
        playerAttacksFirst: (s.attackFirstNext ?? false) || !!s.questFlags?.runeForthcoming,
        playerRallyDouble: s.rallyDoubleNext ?? false,
      };
      const resolveCombatVs = (enemy: BoardMinion[], enemyState: CombatSideState): CombatResult => {
        // Marked Target: the enemy's right-most minion enters with Taunt (applied to the enemy board that's
        // actually fought — served or procedural — before the real fight and the odds sims all read it).
        if (s.markEnemyRightmostTaunt && enemy.length > 0) {
          const last = enemy[enemy.length - 1]!;
          if (!(last.keywords ?? []).includes('T')) last.keywords = [...(last.keywords ?? []), 'T'];
        }
        const combat = simulate(player, enemy, makeRng(mixSeed(s.seed, s.wave, TAG.COMBAT)), CARD_INDEX, playerState, enemyState, config);
        combat.playerDamage = Math.min(combat.playerDamage, lossDamageCap(s.wave)); // round cap
        let win = 0, draw = 0, lose = 0, lossDamageTotal = 0;
        const cap = lossDamageCap(s.wave);
        const ODDS_SIMS = COMBAT_ODDS_SIMS;
        for (let i = 0; i < ODDS_SIMS; i++) {
          const r = simulate(player, enemy, makeRng(mixSeed(s.seed, s.wave, TAG.ODDS, i)), CARD_INDEX, playerState, enemyState, config);
          if (r.result === 'win') win++;
          else if (r.result === 'draw') draw++;
          else { lose++; lossDamageTotal += Math.min(r.playerDamage, cap); } // round-capped, as a real loss would be
        }
        combat.odds = { win: win / ODDS_SIMS, draw: draw / ODDS_SIMS, lose: lose / ODDS_SIMS, avgLossDamage: lose > 0 ? lossDamageTotal / lose : 0 };
        return combat;
      };
      // Belt-and-suspenders: a stale served board is filtered at load (`registerOpponents`), but if one ever
      // slips through, serving it must NEVER hard-lock End Turn (the old "froze on End of Turn" bug — the
      // throw escaped into the UI's end-of-turn timer and the phase never flipped to combat). So fall back to
      // the procedural threat on any serve-time failure: combat ALWAYS resolves.
      // The served board's ENEMY-side context — the SAME `CombatSideState`, reconstituted from its snapshot so its
      // Grim / Taragosa / Pack Leader / Runescale / Watcher fights + reads at the OPPONENT's value, not ours. The
      // procedural threat has none (a synthetic foe with no run economy → the neutral side / printed base is correct).
      const servedState: CombatSideState = served
        ? combatSide({
            tier: served.tier ?? s.tier,
            spellPowerAtk: served.spellPower?.attack ?? 0,
            spellPowerHp: served.spellPower?.health ?? 0,
            spellsThisTurn: served.spellsThisTurn ?? 0,
            beastsPlayed: served.beastsPlayed ?? 0,
            deathrattles: served.deathrattles ?? 0,
            spellsCast: served.spellsCast ?? 0, // enemy Umbral Energy
            beastBuyAtk: served.beastBuyAtk ?? 0, // enemy Beast aura
            impAtk: served.impAura?.attack ?? 0, // enemy Imp Aura → correctly-sized enemy Imp summons
            impHp: served.impAura?.health ?? 0,
            undeadAtk: served.undeadAura?.attack ?? 0, // enemy Undead Lantern aura
            undeadHp: served.undeadAura?.health ?? 0,
            undeadBuyAtk: served.undeadBuyAtk ?? 0, // enemy Undead buy-time Attack
            magneticAtk: served.magneticAura?.attack ?? 0, // enemy Attachment aura
            magneticHp: served.magneticAura?.health ?? 0,
            fodderConsumedAtk: served.fodderConsumed?.attack ?? 0, // enemy Abhorrent Horror
            fodderConsumedHp: served.fodderConsumed?.health ?? 0,
            questMods: served.questMods ?? {}, // enemy runes/quests reproduced in combat
          })
        : combatSide();
      try {
        const e = served ? { enemy: opponentBoard(served), tier: served.tier ?? s.tier } : proceduralEnemy();
        s.lastCombat = resolveCombatVs(e.enemy, served ? servedState : combatSide({ tier: e.tier }));
      } catch {
        const e = proceduralEnemy();
        s.lastCombat = resolveCombatVs(e.enemy, combatSide({ tier: e.tier }));
      }
      s.markEnemyRightmostTaunt = false; // Marked Target is a one-fight debuff — spent by the combat just resolved
      // Telegraph the Fleeting Vigor surge as a Start-of-Combat narration so the pre-baked buff reads as a
      // real effect (a banner + glow on your line as combat opens) instead of silently bigger minions.
      if (fleeting) {
        const firstUid = s.lastCombat.initial.player[0]?.uid;
        if (firstUid) {
          s.lastCombat.events.unshift({
            type: 'sc', source: firstUid,
            text: `Fleeting Vigor — your minions entered at +${fleeting.attack}/+${fleeting.health}`,
          });
        }
      }
      s.combatSettled = false; // a fresh combat — its outcome hasn't been applied yet
      s.phase = 'combat';
      return s;
    }

    case 'settleCombat': {
      // Combat replay finished — apply the outcome (damage + carry-backs) now, in the combat view, so the
      // Resolve hit lands before you return to the shop. Idempotent: only the first call settles.
      if (s.phase !== 'combat' || !s.lastCombat || s.combatSettled) return state;
      settleCombat(s, s.lastCombat);
      // `s.lastCombat` is already the SAME object reference as the input's (shared, not cloned, at the top
      // of reduceCore) — which is what the UI needs: its replay hook + combat-stage effect reset when the
      // reference changes, so a fresh clone here would restart the just-finished combat.
      return s;
    }

    case 'resolveCombat': {
      // Leave combat for the next wave. Settle first if the player skipped the replay (so the damage still
      // applies), then advance past it (terminal check / next wave).
      if (s.phase !== 'combat' || !s.lastCombat) return state;
      if (!s.combatSettled) settleCombat(s, s.lastCombat);
      advanceCombat(s);
      return s;
    }
  }
}

/** Playing a golden minion grants a Discover spell (peek one tier up) into the hand. */
function grantGoldenDiscover(s: RunState): void {
  if (s.hand.length >= CONFIG.handMax) return; // hard 10-card hand cap — no over-cap grant
  s.hand.push({
    uid: `b${s.uidSeq++}`,
    cardId: 'discoverspell',
    tribe: 'neutral',
    attack: 0,
    health: 1,
    keywords: [],
    golden: false,
    grantedTier: s.tier, // freeze "peek one tier up" at the tier it was granted — taverning up later can't inflate it
  });
}

/**
 * Battlegrounds triple: three non-golden copies of a card (across hand + board)
 * combine into one golden copy at 2× base stats, and the triple grants a
 * Discover. Loops so a combine that frees a slot can reveal another triple.
 */
function checkTriples(s: RunState): void {
  for (let guard = 0; guard < 10; guard++) {
    const counts = new Map<string, number>();
    for (const c of [...s.board, ...s.hand]) {
      // Spells + Rubies are never minions — they don't triple (they're cast for their effect; owner: Rubies
      // are spells for this purpose). Both play from hand for an effect, never combine into a golden.
      const cd = CARD_INDEX[c.cardId];
      if (!c.golden && !cd?.spell && !cd?.ruby) counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
    }
    const need = s.runeTwinGilding ? 2 : 3; // Rune of Twin Gilding: Gild at 2 copies
    let tripleId: string | undefined;
    for (const [id, n] of counts) {
      if (n >= need) {
        tripleId = id;
        break;
      }
    }
    if (!tripleId) return;
    combineIntoGolden(s, tripleId, pullCopies(s, tripleId, need));
  }
}

/** Pull up to `count` non-golden copies of `cardId` out of the hand (first) then the board, removing them
 *  and returning them with their current stats/keywords — the copies a combine consumes. */
function pullCopies(s: RunState, cardId: string, count: number): BoardCard[] {
  const combined: BoardCard[] = [];
  const pull = (arr: BoardCard[]): void => {
    for (let i = arr.length - 1; i >= 0 && combined.length < count; i--) {
      if (arr[i]!.cardId === cardId && !arr[i]!.golden) {
        combined.push(arr[i]!);
        arr.splice(i, 1);
      }
    }
  };
  pull(s.hand); // consume from the hand first, then the board
  pull(s.board);
  return combined;
}

/**
 * Combine the pulled `combined` copies of `tripleId` into one golden copy pushed to the hand — the shared
 * core of a natural triple (3 copies) and Gildmaster's Golden Gild (2 copies). Carries every per-instance
 * accrual through the combine. No-op on an empty set. The triple's Discover isn't granted here — it comes
 * from a spell when the golden is played.
 */
function combineIntoGolden(s: RunState, tripleId: string, combined: BoardCard[]): void {
  if (combined.length === 0) return;
  // Golden = the two best copies (by total stats) stacked: their stats summed, their per-source
  // buff breakdowns merged (so the golden's inspect panel still itemizes its buffs), and the union
  // of all copies' keywords. For uniform buffs / fresh triples this equals the old "top-two atk +
  // top-two hp" result; it only differs for oddly asymmetric per-copy buffs (rare), and in exchange
  // the breakdown stays consistent with the stats.
  const kept = [...combined].sort((a, b) => (b.attack + b.health) - (a.attack + a.health)).slice(0, 2);
  const goldenBuffs = mergeBuffs(kept.flatMap((c) => c.buffs ?? []));
  const def = CARD_INDEX[tripleId]!;
  // A host that RECEIVED attachments gains the 'M' keyword (owner ruling — it counts as an Attachment for the
  // aura), but that must NOT carry into its triple: a golden Moe / Beatboxer is a normal minion, not an
  // Attachment, so it should never magnetize when played. Keep 'M' only if the BASE card is genuinely Magnetic
  // (Better Bot / Money Bot / Cling Drone / …).
  const keywords = [...new Set(combined.flatMap((c) => c.keywords))].filter((k) => k !== 'M' || def.keywords.includes('M'));
  // A summon-buff card (Kennelmaster / Bristleback Matron) carries its accrued buff
  // through the triple: the golden's summonBonus = its base buff + the two highest
  // bonuses combined, so the granted magnitude (base + summonBonus) is the SUM of the
  // top-two copies' magnitudes — two boosted Kennelmasters at +6/+4 combine to +10, and
  // a fresh triple just doubles the base (the golden doubling falls out of the combine).
  const summonEffect = def.effects.find((e) => e.do === 'buffOnSummon' || e.do === 'scBeastAura');
  const improveEffect = def.effects.find((e) => e.do === 'summonBuffTribeImprove' || e.do === 'countTribeSummon' || e.do === 'onGainAttackBuffImproving');
  let summonBonus: number | undefined;
  if (summonEffect) {
    const base = Number((summonEffect.params as { attack?: number })?.attack ?? 0);
    const sbs = combined.map((c) => c.summonBonus ?? 0).sort((a, b) => b - a);
    summonBonus = base + (sbs[0] ?? 0) + (sbs[1] ?? 0);
  } else if (improveEffect) {
    // Mama Bear: the golden picks up the accrual at its CURRENT value (the highest of the copies) —
    // not reset, not summed/doubled. The bigger per-summon step (+6/+6) comes from gold(self) in the
    // factory, so all the triple must do is preserve where the accrual already is.
    const maxBonus = Math.max(...combined.map((c) => c.summonBonus ?? 0));
    summonBonus = maxBonus > 0 ? maxBonus : undefined;
  } else if (def.effects.some((e) => e.do === 'onKillBuffUndeadAttack' || e.do === 'onAllyAttackBuffAll')) {
    // Karthus / Crypt Drake (owner ruling 2026-07-16): the golden COMBINES the two highest copies'
    // accrued improvements. The doubled base grant + doubled improve step come from mul(self) in the
    // factory, so the triple only merges where the accruals already are.
    const sbs = combined.map((c) => c.summonBonus ?? 0).sort((a, b) => b - a);
    const sum = (sbs[0] ?? 0) + (sbs[1] ?? 0);
    summonBonus = sum > 0 ? sum : undefined;
  }
  // Flowing Monk (owner ruling 2026-07-03): the golden COMBINES the two highest copies' CURRENT grants —
  // e.g. +10/+10 and +4/+4 copies triple into a golden granting +14/+14. Since the stepped formula can't
  // express an arbitrary start, the surplus over the golden base rides in a flat `overflowBonus`; the
  // overflow countdown starts fresh (summonBonus stays unset → "5 to go").
  const overflowEffect = def.effects.find((e) => e.do === 'overflowBuffRandom');
  let overflowBonus: number | undefined;
  if (overflowEffect) {
    const p = overflowEffect.params as { attack?: number; improveEvery?: number } | undefined;
    const base = Number(p?.attack ?? 2);
    const every = Math.max(1, Number(p?.improveEvery ?? 5));
    const grants = combined
      .map((c) => base * (1 + Math.floor((c.summonBonus ?? 0) / every)) + (c.overflowBonus ?? 0))
      .sort((a, b) => b - a);
    const surplus = (grants[0] ?? base) + (grants[1] ?? base) - base * 2; // over the golden's own base grant
    overflowBonus = surplus > 0 ? surplus : undefined;
  }
  // Sergeant: the golden keeps the HIGHEST accrued Deathrattle HP-grant bonus of the copies (not
  // summed/reset) — the bigger per-Attack step (+4) comes from gold(self) in the factory, so the triple
  // only preserves where the accrual already is.
  const hpGrantEffect = def.effects.find((e) => e.do === 'onGainAttackImproveHpGrant');
  let hpGrantBonus: number | undefined;
  if (hpGrantEffect) {
    const maxBonus = Math.max(...combined.map((c) => c.hpGrantBonus ?? 0));
    hpGrantBonus = maxBonus > 0 ? maxBonus : undefined;
  }
  // Frontdrake / Money Maker: keep the copy furthest into its cadence (closest to the next proc) — tripling
  // one about to proc keeps the "procs this turn" timing. Only the cycle position (mod every) matters, so the
  // golden inherits the max position; a fresh/just-procced set (all 0) starts a clean cycle. Any End-of-Turn
  // effect with an `every` param counts (Frontdrake's conjure, Money Maker's card grant).
  const cadenceEffect = def.effects.find((e) => e.on === 'endOfTurn' && (e.params as { every?: number } | undefined)?.every !== undefined);
  let goldenEotTick: number | undefined;
  if (cadenceEffect) {
    const every = Math.max(1, Number((cadenceEffect.params as { every?: number })?.every ?? 3));
    const pos = Math.max(...combined.map((c) => (c.eotTick ?? 0) % every));
    goldenEotTick = pos > 0 ? pos : undefined;
  }
  // Absorbed mana-per-turn (a Money Bot magnetized into one of the copies) carries through the
  // triple so the income survives (the golden's own def.manaPerTurn handles the un-merged case).
  const absorbedMana = combined.reduce((sum, c) => sum + (c.manaBonus ?? 0), 0);
  // Same for the other welded magnetic fields: Better Bot's Rally (`rallyMechAtk`) and Harry Botter's
  // spell aura (`spellAuraBonus`) — sum them across the copies so a magnetized host keeps its attachments
  // through a triple (the golden's own def handles a standalone Better Bot's Rally at instantiate time).
  const absorbedRally = combined.reduce((sum, c) => sum + (c.rallyMechAtk ?? 0), 0);
  const absorbedRallySpell = combined.reduce((sum, c) => sum + (c.rallySpellWeld ?? 0), 0); // Perfect Core's welded Rally
  const absorbedSpellAura = combined.reduce((sum, c) => sum + (c.spellAuraBonus ?? 0), 0);
  const absorbedFodderAura = combined.reduce(
    (sum, c) => ({ attack: sum.attack + (c.fodderAuraBonus?.attack ?? 0), health: sum.health + (c.fodderAuraBonus?.health ?? 0) }),
    { attack: 0, health: 0 },
  );
  // Spirit Pup / Guel: the golden keeps the *highest* spell progress of the copies (= the lowest spells-left),
  // so a 2-left + 8-left + 5-left triple needs only 2 more spells to evolve. Runescale Drake instead SUMS the
  // copies' progress (owner ruling: "tripling takes the combined values" — a +20 and two fresh +1 → +21), so
  // its accrued Dragon buff isn't thrown away by the merge. Keyed on the `spellCastImproveSelf` effect.
  const sumsProgress = def.effects.some((e) => e.do === 'spellCastImproveSelf');
  const goldenProgress = sumsProgress
    ? combined.reduce((sum, c) => sum + (c.spellProgress ?? 0), 0)
    : Math.max(...combined.map((c) => c.spellProgress ?? 0));
  // Tara: the golden keeps the *highest* ascend progress of the copies (= the lowest "to go"), so tripling a
  // Tara that's close to ascending doesn't reset it back to 20-to-go.
  const goldenAscend = def.ascendAt ? Math.max(...combined.map((c) => c.ascendProgress ?? 0)) : 0;
  // Hoarder: the golden keeps the EARLIEST (minimum) boughtWave of the copies, so a golden Hoarder
  // inherits the oldest copy's age → its highest sell value as the starting point (sell =
  // (wave - boughtWave + 1) × 2 golden). Generic — harmless on cards that don't read it — but Hoarder
  // is the one that matters. Copies with no boughtWave (not from a buy) are ignored; undefined if none had one.
  const boughtWaves = combined.map((c) => c.boughtWave).filter((w): w is number => w !== undefined);
  const goldenBoughtWave = boughtWaves.length > 0 ? Math.min(...boughtWaves) : undefined;
  const goldenCard: BoardCard = {
    uid: `b${s.uidSeq++}`,
    cardId: def.id,
    tribe: def.tribe,
    attack: kept.reduce((sum, c) => sum + c.attack, 0),
    health: kept.reduce((sum, c) => sum + c.health, 0),
    keywords,
    golden: true,
    summonBonus,
    overflowBonus,
    hpGrantBonus,
    manaBonus: absorbedMana > 0 ? absorbedMana : undefined,
    rallyMechAtk: absorbedRally > 0 ? absorbedRally : undefined,
    rallySpellWeld: absorbedRallySpell > 0 ? absorbedRallySpell : undefined,
    spellAuraBonus: absorbedSpellAura > 0 ? absorbedSpellAura : undefined,
    fodderAuraBonus: absorbedFodderAura.attack > 0 || absorbedFodderAura.health > 0 ? absorbedFodderAura : undefined,
    buffs: goldenBuffs.length > 0 ? goldenBuffs : undefined,
    spellProgress: goldenProgress > 0 ? goldenProgress : undefined,
    ascendProgress: goldenAscend > 0 ? goldenAscend : undefined,
    boughtWave: goldenBoughtWave,
    eotTick: goldenEotTick,
  };
  // Respect the hard 10-card hand cap. A triple always frees board slots (it consumes ≥1 board copy), so if
  // the hand is full the golden goes onto the board rather than over-capping the hand — the reward is never lost.
  if (s.hand.length < CONFIG.handMax) s.hand.push(goldenCard);
  else s.board.push(goldenCard);
  s.triplesMade++; // run-wide tally — surfaced as opponent intel in board snapshots
}

/** Apply a resolved combat's outcome and advance to the next wave — or end the run. */
function settleCombat(s: RunState, result: CombatResult): void {
  // Record this wave's result for the end-screen W-L-W summary (every combat, win or lose).
  s.history.push(result.result);
  // Loss-streak tracking (matchmaking softener): a loss extends the streak; a WIN breaks it and re-arms the
  // once-per-streak softener. A draw neither extends nor breaks — it just doesn't stop the bleeding.
  if (result.result === 'lose') s.lossStreak = (s.lossStreak ?? 0) + 1;
  else if (result.result === 'win') { s.lossStreak = 0; s.streakSoftened = undefined; }
  // Dupes: "Win N rounds" advances on a won combat.
  if (result.result === 'win') advanceQuests(s, (o) => o.event === 'winRound');
  // The Author's Hand compound objective: its Echo + Rally halves accrue from this combat's tallies (its Shout
  // half accrues from recruit-phase plays).
  bumpAuthorsHand(s, 'echo', result.playerDeathrattles);
  bumpAuthorsHand(s, 'rally', result.playerRallies ?? 0);
  // Attribute this combat's player damage + mechanic procs into the run-wide tallies (→ MVP + most-triggered).
  accumulateContribution((s.runDamage ??= {}), (s.runProcs ??= {}), tallyCombat(result));
  // Accumulate this combat's player Deathrattles into the run-wide "this game" count (Grim scales off it).
  s.deathrattlesTriggered += result.playerDeathrattles;
  // Record who survived — read at the next shop start to fire a surviving Gravetwin's copied Echo.
  s.lastSurvivorCardIds = result.playerSurvivorCardIds;
  // Persist per-instance combat state (Kennelmaster's Avenge permanently improves its
  // summon buff for the rest of the run), keyed back to the originating board card.
  if (result.playerSummonBonus) {
    for (const { sourceUid, bonus } of result.playerSummonBonus) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (card) card.summonBonus = bonus;
    }
  }
  // Sergeant: persist its Deathrattle HP-grant accrual (seeded value + this combat's Attack-gain
  // improvements) so the bonus is permanent across fights — keyed back to the originating board card.
  if (result.playerHpGrantBonus) {
    for (const { sourceUid, bonus } of result.playerHpGrantBonus) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (card) card.hpGrantBonus = bonus;
    }
  }
  // Archmagus Guel: persist his on-board spell tally (seeded + this combat's casts) so combat casts count
  // permanently toward his per-instance improvement — keyed back to the originating board card.
  if (result.playerSpellProgress) {
    for (const { sourceUid, progress } of result.playerSpellProgress) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (!card) continue;
      card.spellProgress = progress;
      // Spirit Pup: combat spell casts count toward its transform too — swap the form now if the carried-back
      // tally reached `at` (the recruit half only swaps on a SHOP cast, so combat progress would otherwise stall
      // at ≥`at` without transforming). Keeps the instance's stats / golden / buffs — only the identity changes.
      const t = CARD_INDEX[card.cardId]?.effects.find((e) => e.do === 'spellCastTransform')?.params as { at?: number; into?: string } | undefined;
      if (t?.into && CARD_INDEX[t.into] && progress >= (t.at ?? 10)) {
        card.cardId = t.into;
        card.spellProgress = undefined;
      }
    }
  }
  // Tara → Taragosa: accumulate this combat's stat-grants; at the `ascendAt` threshold, ascend the board card
  // to its `ascendInto` form (keeping its stats / golden / buffs — only the identity changes, like Spirit Pup).
  if (result.playerAscendCount) {
    for (const { sourceUid, count } of result.playerAscendCount) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (!card) continue;
      card.ascendProgress = (card.ascendProgress ?? 0) + count;
      const def = CARD_INDEX[card.cardId];
      if (def?.ascendAt && def.ascendInto && card.ascendProgress >= def.ascendAt && card.cardId !== def.ascendInto) {
        card.cardId = def.ascendInto;
        card.tribe = CARD_INDEX[def.ascendInto]?.tribe ?? card.tribe;
      }
    }
  }
  // Permanent mid-combat gains carry back to the run board (recorded as a buff so the inspect view shows
  // the source), win or lose. `engraved` comes from the *combat* minion's live keywords — so a minion
  // Engraved only at Start of Combat (Taurus's neighbor) carries its gains back and is labelled "Engraved",
  // even though its run-board card never had the EG keyword. A non-Engraved carrier got Flowing Monk's gift.
  if (result.playerPermaBuffs) {
    for (const { sourceUid, attack, health, engraved } of result.playerPermaBuffs) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (!card) continue;
      // Taragosa's Heir amplifies stat gains from ALL sources — combat included. It's Engraved, so its combat
      // gains reach here; multiply its carry-back ×2 (golden ×3) so combat matches its recruit-phase amplifier.
      const mult = card.cardId === 'taragosaheir' ? (card.golden ? 3 : 2) : 1;
      addBuff(card, engraved ? 'Engraved' : 'Flowing Monk', attack * mult, health * mult);
    }
  }
  // Set 2 — Rubies gained IN COMBAT (Rikk's Rally, Gemline's Avenge): mint them into hand now, baked with the
  // run's live rubyBonus (identical to a shop-minted Ruby).
  if (result.playerRubyGrants) mintRubies(s, result.playerRubyGrants);
  // Set 2 — Ruby STRENGTH gained in combat (Veinbreaker's Avenge "buff your Rubies"): raise the run's rubyBonus
  // AND grow every held Ruby — the same effect as the recruit-phase `rubyStatGain`.
  if (result.playerRubyBonusGain && (result.playerRubyBonusGain.attack > 0 || result.playerRubyBonusGain.health > 0)) {
    const g = result.playerRubyBonusGain;
    const b = s.rubyBonus ?? { attack: 0, health: 0 };
    s.rubyBonus = { attack: b.attack + g.attack, health: b.health + g.health };
    for (const card of s.hand) if (CARD_INDEX[card.cardId]?.ruby) { card.attack += g.attack; card.health += g.health; }
  }
  // Cards a combat effect added to the hand land in the hand for the next recruit, win or lose — capped by
  // the hand limit. This is the single channel for ALL in-combat card grants: a SPECIFIC card (Arcane Weaver →
  // a Spirit Fire copy) AND a RANDOM card already picked in combat (Sporebat's spell, Ryme re-firing Sea Urchin
  // / Black Belt Brian — the `toHand` event showed the real card flying). Each carries the run's per-card
  // enchant + Undead bond and leaves the shared pool (both no-ops for spells), matching a normal conjure.
  if (result.playerHandGrants) {
    for (const cardId of result.playerHandGrants) {
      const def = CARD_INDEX[cardId];
      if (!def || s.hand.length >= CONFIG.handMax) continue;
      const cb = cardBuff(s, cardId);
      s.hand.push({
        uid: `b${s.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        ...conjuredStats(s, def, cb),
        keywords: [...def.keywords],
        golden: false,
      });
      takeFromPool(s, cardId);
    }
  }
  // Rune of the Trophy: the first friendly minion to Slaughter this combat arrives as a plain base-stat
  // copy in hand for the next shop (the same conjure shape as playerHandGrants above — run enchants +
  // tribe bonds apply; a full hand forfeits it).
  if (result.playerSlaughterCopy) {
    const def = CARD_INDEX[result.playerSlaughterCopy];
    if (def && s.hand.length < CONFIG.handMax) {
      const cb = cardBuff(s, def.id);
      s.hand.push({
        uid: `b${s.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        ...conjuredStats(s, def, cb),
        keywords: [...def.keywords],
        golden: false,
      });
    }
  }
  // Skullblade: permanent run-wide spell power gained from its combat Deathrattle (+Attack to your
  // spells), win or lose. Folds into spellAttackBonus / spellHealthBonus from now on, so every future
  // stat spell + its display picks it up. Stacks across combats.
  if (result.playerSpellPower) {
    s.spellBonus ??= { attack: 0, health: 0 };
    s.spellBonus.attack += result.playerSpellPower.attack;
    s.spellBonus.health += result.playerSpellPower.health;
  }
  // Grave Knit: a combat death permanently buffs the Grave Knit card type run-wide (+3/+2 to every
  // Grave Knit — board, hand, and future copies), win or lose. Mirrors Ritualist's Fodder enchant;
  // multiple deaths stack (each carried entry already sums this combat's firings).
  if (result.playerCardBuffs) {
    for (const { cardId, attack, health } of result.playerCardBuffs) {
      buffCardTypeRunWide(s, cardId, attack, health, CARD_INDEX[cardId]?.name ?? cardId);
    }
  }
  // Burial Imp: Fodder queued by its combat Deathrattle drops into the next tavern (a Demon eats it there).
  if (result.playerFodderGrants) {
    (s.pendingTavern ??= []).push(...Array(result.playerFodderGrants).fill('fred'));
  }
  // Pit Supplier: Fodder scheduled across the next several shops → merge index-for-index into fodderSchedule.
  if (result.playerFodderSchedule) {
    s.fodderSchedule ??= [];
    result.playerFodderSchedule.forEach((n, i) => { if (n > 0) s.fodderSchedule![i] = (s.fodderSchedule![i] ?? 0) + n; });
  }
  // Ryme re-firing an ECONOMY battlecry in combat (Soulfeeder's Fodder, Hoarder's Gold, Demonic Anomaly's shop
  // buff, a gain-a-minion) couldn't run in the pure fight — replay each through its recruit factory now, with
  // full RunState access. Recorded once per re-fire in combat, so Drakko's doubling is already baked in.
  if (result.playerDeferredBattlecries) {
    for (const { cardId, golden } of result.playerDeferredBattlecries) replayEconomyBattlecry(s, cardId, golden);
  }
  // Imp King / Brood Matron Avenge: their in-combat Imp buffs are permanent — accrue them into the run-wide
  // Imp buff so future Imps (next fights) inherit them.
  if (result.playerImpBuffGain) {
    s.impBuff ??= { attack: 0, health: 0 };
    s.impBuff.attack += result.playerImpBuffGain.attack;
    s.impBuff.health += result.playerImpBuffGain.health;
  }
  // Bane (combat, via Ryme's battlecry replays): its run-wide Fodder enchant is permanent — apply it the
  // same way the recruit-phase Bane does, so every Fodder (board, hand, future copies) keeps the gain.
  if (result.playerFodderBuffGain) {
    buffFodderRunWide(s, result.playerFodderBuffGain.attack, result.playerFodderBuffGain.health, 'Bane');
  }
  // Soulsman: permanent max-Gold gained from its Avenge in combat (uncapped, like Nadja's Gold Font).
  // grantMaxGold is Soulsman-only, so playerMaxGoldGain IS Soulsman's contribution — tally it run-wide
  // for the "gained X Gold" metric shown on the card.
  if (result.playerMaxGoldGain) {
    s.maxEmbers += result.playerMaxGoldGain;
    s.soulsmanGold = (s.soulsmanGold ?? 0) + result.playerMaxGoldGain;
  }
  // Bounty Bot: one-time Gold granted into the next shop (added to the next turn's starting Gold).
  if (result.playerBonusGold) {
    s.bonusEmbersNextTurn = (s.bonusEmbersNextTurn ?? 0) + result.playerBonusGold;
  }
  // Gryphon: free shop rerolls banked from taking damage in combat.
  if (result.playerFreeRolls) {
    s.freeRolls += result.playerFreeRolls;
  }
  if (result.playerGuaranteedAttachments) {
    s.guaranteedAttachmentShops = (s.guaranteedAttachmentShops ?? 0) + result.playerGuaranteedAttachments;
  }
  // Taragosa: spells cast IN combat permanently bump the run's spellsCast — so they count toward
  // spell-count payoffs just like tavern spells. Guel's improvement is per-instance now (spells cast
  // while HE is on board), so combat casts also tick the on-board Guels' `spellProgress` — he was on
  // the board for the fight, so they count for him (parity with the old run-wide counter).
  if (result.playerSpellsCast) {
    s.spellsCast += result.playerSpellsCast;
    for (const c of s.board) {
      if (CARD_INDEX[c.cardId]?.effects.some((e) => e.do === 'spellCastBuffOthers' || e.do === 'spellCastImproveSelf')) {
        c.spellProgress = (c.spellProgress ?? 0) + result.playerSpellsCast;
      }
    }
  }
  // Permanent Undead attack AURA gained in combat (Karthus's on-kill, Deathswarmer re-fired by Ryme) —
  // stack into undeadBuyAtk AND apply to all current run-board Undead immediately so they benefit without
  // being re-bought. Labelled 'Undead Bond' to match the buy-time aura (the source varies, the aura is one).
  if (result.playerUndeadBuyAtkGain) {
    const gain = result.playerUndeadBuyAtkGain;
    s.undeadBuyAtk = (s.undeadBuyAtk ?? 0) + gain;
    for (const c of [...s.board, ...s.hand]) {
      if (isTribe(c, 'undead')) addBuff(c, 'Undead Bond', gain, 0);
    }
  }
  // Watcher's Lantern of Souls (combat): raise the run-wide Undead aura (+Attack/+Health everywhere) — the
  // same `undeadAttackBonus`/`undeadHealthBonus` channel a shop-cast Lantern uses, so it shows and behaves
  // identically on the run board.
  if (result.playerUndeadAuraGain) {
    s.undeadAttackBonus += result.playerUndeadAuraGain.attack;
    s.undeadHealthBonus += result.playerUndeadAuraGain.health;
  }
  // ── Quests: combat-phase objectives + combat-armed reward carry-backs ─────────────────────────────────
  // Advance combat objectives (attack / summonCombat / slaughter / deathrattle) from this fight's tally, +N,
  // tribe-narrowed. Completing here applies the reward straight into the post-combat state (grants → hand).
  const handBeforeQuests = s.hand.length;
  advanceCombatQuests(s, result);
  // A combat-completed quest may have granted a card to hand — if so, check for a triple (your 3rd copy → golden).
  if (s.hand.length > handBeforeQuests) checkTriples(s);
  // Rune of Slaying (reworked 2026-07-21): every Slaughter (enemy felled) this combat raises your max Gold by 1.
  // Applied at settle rather than via ctx.grantMaxGold, which is Soulsman-only and would pollute its run tally.
  if (s.questFlags?.runeSlaying && result.playerQuestTally?.slaughter) {
    s.maxEmbers += result.playerQuestTally.slaughter;
  }
  // The Old Hunt: the Beast Attack aura pumped this combat is permanent — fold it into the run + apply to
  // current run-board/hand Beasts (so they keep the gain without re-buying).
  // The Old Hunt (Attack) + Pack Mentality (Attack + Health) both grow the run-wide Beast aura live in combat;
  // fold their carried-back gain into `beastBuyAtk`/`beastBuyHp` + every current run-board Beast.
  if (result.playerBeastBuyAtkGain || result.playerBeastBuyHpGain) {
    grantTribeAura(s, 'beast', result.playerBeastBuyAtkGain ?? 0, result.playerBeastBuyHpGain ?? 0, result.playerBeastBuyHpGain ? 'Pack Mentality' : 'The Old Hunt');
  }
  // Pack Mentality: grow any scaling tribe auras by this combat's tally of their trigger event.
  growScalingAuras(s, result);
  // (Random spell/minion grants — Sporebat, Ryme re-firing Sea Urchin / Black Belt Brian — are now picked in
  //  combat and added above via playerHandGrants, so the real card animates in. No separate settle pick.)
  // Cassen's Collision: bank this combat's enemy kills; every 5 grants a minion of the board's most
  // common tribe (then spends 5). A failed grant (full hand / no tribe) keeps the kills banked for later.
  if (getHero(s.heroId).power.kind === 'collision') {
    s.cassenKills += result.enemyDeaths;
    while (s.cassenKills >= 5) {
      if (!grantTopTypeMinion(s)) break;
      s.cassenKills -= 5;
    }
  }
  if (result.result === 'lose' && s.mode !== 'practice') {
    // Armor absorbs the hit first (extra effective HP), the overflow chips Resolve. Practice: unlimited health.
    const absorbed = Math.min(s.armor, result.playerDamage);
    s.armor -= absorbed;
    s.resolve = Math.max(0, s.resolve - (result.playerDamage - absorbed));
  }
  // Maw of the Pit's one-combat Divine Shield is spent — strip the temp DS so it doesn't carry to the
  // next fight (consuming again re-arms it). Same for Lord of the Risen's one-combat Rise (temp R).
  for (const c of s.board) {
    if (c.tempShield) {
      c.keywords = c.keywords.filter((k) => k !== 'DS');
      c.tempShield = false;
    }
    if (c.tempReborn) {
      c.keywords = c.keywords.filter((k) => k !== 'R');
      c.tempReborn = false;
    }
    // Bloodlust is a one-combat mark — spent by the fight that just resolved (both the immune swing and its
    // welded Rally).
    if (c.bloodlust) c.bloodlust = false;
    if (c.bloodlustRally) c.bloodlustRally = false;
  }
  // Pre-emptive Assault + Rallying Offensive are spent — each override covers exactly one fight.
  s.attackFirstNext = false;
  s.rallyDoubleNext = false;
  s.combatSettled = true;
}

/** Advance past a settled combat: the terminal check (gameover / victory), else roll the next wave. */
function advanceCombat(s: RunState): void {
  // Practice runs the SAME fixed course as Ascent (`courseRounds`), so the HUD reads identically — it just
  // can't be lost (health is unlimited, so the resolve<=0 check never fires) and settles into a practice
  // summary instead of a scored victory. Ends when the course is done, regardless of W/L.
  if (s.mode === 'practice' && s.wave >= CONFIG.courseRounds) {
    s.phase = 'gameover';
    return;
  }
  if (s.resolve <= 0) {
    s.phase = 'gameover';
    return;
  }

  // Course complete (A1): a run plays a fixed course of `courseRounds` rounds; survive them all and the
  // run is done — the record IS the score, whatever it is. The just-fought round's result is already in
  // history. The only early exit is Resolve 0 (handled above); you never "win early" by a win count.
  if (s.mode !== 'practice' && s.wave >= CONFIG.courseRounds) {
    s.phase = 'victory';
    return;
  }

  // Advance to the next wave (handoff A.1 step 5).
  s.wave += 1;
  // Grow toward the cap (10) but never DROP maxEmbers — so Nadja / Mana Font bonuses that pushed it
  // past the cap persist instead of being clamped away each wave.
  s.maxEmbers = Math.max(s.maxEmbers, Math.min(CONFIG.embersCap, s.maxEmbers + CONFIG.embersPerWave));
  // Money Bot & co. raise the effective max above the base curve while on the board — added on
  // top of the cap (a deliberate economy card), recomputed each turn so selling it removes it.
  // Hoarder's Battlecry banks bonus Gold for this turn (consumed now).
  s.embers = s.maxEmbers + (s.maxGoldBonus ?? 0) + boardManaBonus(s) + (s.bonusEmbersNextTurn ?? 0);
  s.bonusEmbersNextTurn = 0;
  s.heroReady = true;
  // Pin the opponent match to the board you START the turn with, so it won't shift as you shop today.
  s.turnStartPower = s.board.reduce((sum, b) => sum + b.attack + b.health, 0);
  s.spellsThisTurn = 0; // Spirit Worgen's per-turn spell scaling resets each wave
  s.playedThisTurn = []; // Pack Leader / Spirit Worgen: minions-played-this-turn resets each turn
  s.goldSpentThisTurn = 0; // Patch Job's per-turn Gold-spent scaling resets each wave
  s.cardsBoughtThisTurn = 0; // Frenzied Excavator's per-turn cards-bought scaling resets each wave
  if (s.nextSellBonus) s.nextSellBonus = 0; // Quick Sale is a THIS-TURN bonus — expires unused at turn end
  if (s.hand.some((c) => c.borrowed)) s.hand = s.hand.filter((c) => !c.borrowed); // Funeral on Loan: unplayed borrowed cards are returned at turn end
  for (const c of s.board) c.rubyRecvTick = 0; // Ruby Broker's per-turn Gold cap resets each wave
  s.attachmentsThisTurn = 0; // Tempering/Replication's "first Attachment each turn" gate resets each wave
  s.shoutsThisTurn = 0; // Rune of Refrain's Shout counter resets each wave
  s.firstShoutUid = undefined;
  s.consumesThisTurn = 0; // Endless Appetite's "first Consume each turn" gate resets each wave
  s.firstSpellThisTurnId = undefined; // Rune of Recurrence's first-spell record resets each wave
  s.extraEotThisTurn = false; // Chrono Staff's one-shot End-of-Turn extra is per-turn
  s.shoutFirstUsedThisTurn = false; // Warm Embers' "first Shout each round triggers twice" freebie resets each turn
  s.dupeUsedThisTurn = false; // Dupes: the first-buy copy is a per-turn freebie
  s.gorrBuys = undefined; // Gorr: the per-turn minion-buy tally resets
  s.freeBuyUsedThisTurn = false; // Freedom rift: the first minion each turn is free again
  s.spellFirstUsedThisTurn = false; // Spell Thesis: "first spell each turn casts twice" resets each turn
  s.fodderConsumedThisTurn = { attack: 0, health: 0 }; // Abhorrent Horror's SoC window resets each wave
  for (const c of s.board) {
    c.resummon = false; // The Reclaimer's mark is a per-turn choice
  }
  if (s.tier < maxTierFor(s.rift)) {
    s.upgradeCost = Math.max(CONFIG.upgradeCostFloor, s.upgradeCost - CONFIG.upgradeDiscountPerWave);
  }
  const previous = s.threat;
  s.threat = selectThreat(s.wave, makeRng(mixSeed(s.seed, s.wave, TAG.THREAT)), previous);

  // A frozen tavern carries over, but still tops up any empty minion slots / missing spell
  // (freezing a partial shop shouldn't leave you with fewer options); otherwise full reroll.
  // Either way, queued Fodder (Soulfeeder) still gets injected — freezing must not strand the
  // promised Fodder in `pendingTavern` forever.
  // Quest-turns (waves 5 & 11 — consolidated from the old 4/8/12): open the quest shop. The tavern still ROLLS
  // this turn — deferred to just after `checkTriples` below (the same rngCursor point the old post-`buyQuest` roll
  // used, so runs stay byte-identical) — so the shop sits behind the quest overlay and the pick is shop-informed.
  // An empty offer (no content, or quests disabled) falls through to a normal turn — a content gap never soft-locks.
  // The "quest phase" is just "questOffer is set" (no new phase enum); the modal guard locks every action but
  // buyQuest until it resolves. Fi's Errand (bonus Lesser offer on turn 3) and Coran's Pathfinder (turn-11 bucket on
  // turn 7, no turn-5 quest) are folded into `questOfferPlan`.
  const questPlan = questOfferPlan(s);
  const questOffer = questPlan ? generateQuestOffer(s, questPlan) : [];
  // Runesmith: the Runeforge opens exactly once, on turn 7 — offer a random 3 of the runes for the player to buy
  // ONE. Like the quest shop, the tavern is rolled behind the overlay so the shop is ready once the forge closes.
  const forge = getHero(s.heroId).power.kind === 'runeforge' && s.wave === 7 && !s.heroPowerSpent;
  if (forge) {
    s.runeforgeEpic = undefined; // basic forge — set before runeforgePool so it reads the normal set
    s.runeforgeRerolled = undefined;
    s.runeforgeOffer = drawRunes(runeforgePool(s), RUNEFORGE_OFFER, makeRng(mixSeed(s.seed, s.wave, TAG.QUEST)));
  } else if ((CONFIG.runeforgeEnabled || s.rift === 'runic') && s.wave === 6) {
    // Universal basic Runeforge on turn 6 — driven by EITHER the runeforge system (CONFIG.runeforgeEnabled) or
    // the "Runic Behavior" rift. Either way it opens exactly ONE free (no hero-power charge) forge, queued so it
    // slots into the normal start-of-turn modal priority (behind any quest offer, via openNextStartOfTurnModal).
    // Turn 6 has no quest, so it opens directly. (Runesmith still gets its own turn-7 forge on top — this is an
    // extra visit, not a replacement.)
    s.pendingBasicForge = { deferred: false };
  }
  if (questOffer.length > 0) {
    s.questOffer = questOffer;
  } else if (s.frozen) {
    topUpTavern(s);
    injectPendingTavern(s, true); // defer the eat — a Runeforge / queued modal may be about to open (see holdFodderConsume)
    s.frozen = false;
  } else refreshTavern(s, true);
  // Start-of-turn modals resolve ONE AT A TIME, in priority order (Quest > Runeforge > Discover/other). A quest
  // offer or the Runesmith forge (set above) shows first; the Epic Runeforge + any queued Discovers wait their
  // turn and open as each higher modal closes (see openNextStartOfTurnModal, called from every modal-close path).
  s.phase = 'recruit';
  // Rune of the Epic Forge: it armed the Epic Runeforge for THIS wave — turn it into a pending open, which the
  // start-of-turn sequencing below presents (behind any quest offer / Runesmith forge).
  if (s.epicForgeWave != null && s.wave >= s.epicForgeWave) { s.pendingEpicRuneforge = true; s.epicForgeWave = undefined; }
  // Runeforge system: EVERY hero visits the Epic Runeforge on turn 9 (free — openEpicRuneforge flags it
  // no-charge). Independent of Runeguard's own epic forge on turn 12, which its power schedules separately.
  if (CONFIG.runeforgeEnabled && s.wave === 9) s.pendingEpicRuneforge = true;
  // Promote any forge armed mid-turn (deferred): now that we're at the START of the next turn, it's openable.
  s.pendingForgeDeferred = false;
  if (s.pendingBasicForge) s.pendingBasicForge.deferred = false;
  // Bloodbinder: its Rally alternates the stat it gives Fodder — flip each board Bloodbinder every turn
  // (undefined/'atk' ↔ 'hp'), so this turn's combat reads the freshly-swapped stat.
  for (const c of s.board) if (c.cardId === 'bloodbinder') c.bloodbinderMode = c.bloodbinderMode === 'hp' ? 'atk' : 'hp';
  openNextStartOfTurnModal(s);
  // Gravetwin: if it survived the last combat, fire its copied Echo now (start of the shop). Then clear the
  // survivor list so it fires exactly once per fight.
  fireGravetwinEchoes(s);
  s.lastSurvivorCardIds = undefined;
  // Chaos hero power: at the START of every 5th turn, add a Chaos Attachment token to the hand
  // (the checkTriples below also combines it if it completes a triple). The hero starts with one token
  // (createRun); this is the recurring grant — turns 5, 10, 15, …
  if (getHero(s.heroId).power.kind === 'chaos' && s.wave % 5 === 0) {
    const def = CARD_INDEX['symbioticattachment'];
    if (def && s.hand.length < CONFIG.handMax) {
      const grantUid = `b${s.uidSeq++}`;
      // Same instantiation as settleCombat's hand grants: the run's per-card enchant + the tribe-gated
      // Undead buy bonus (the old inline version applied undeadBuyAtk raw, tribe-unchecked, and skipped
      // the card enchant).
      const cb = cardBuff(s, 'symbioticattachment');
      s.hand.push({
        uid: grantUid,
        cardId: 'symbioticattachment',
        tribe: def.tribe,
        ...conjuredStats(s, def, cb),
        keywords: [...def.keywords],
        golden: false,
      });
      // Signal the UI to fly the new token in from the hero portrait (one-shot, like fodderEatenSeq).
      s.chaosGrantSeq = (s.chaosGrantSeq ?? 0) + 1;
      s.chaosGrantUid = grantUid;
    }
  }
  // Gildmaster: get a Goldcrafter (a spell that makes a friendly minion golden) at the START of every 4th
  // turn — turns 4, 8, 12, …. Conjured to hand (hand-cap-safe); a granted spell can't complete a triple.
  if (getHero(s.heroId).power.kind === 'recurringGoldcrafter' && s.wave % 4 === 0) {
    conjureToHand(s, CARD_INDEX['goldcrafter'] ? [CARD_INDEX['goldcrafter']!] : [], 1);
  }
  // Quest delayed rewards (Trail Rations' "repeat in 2 turns"): tick each pending grant down a turn and
  // re-apply the ones that come due — WITHOUT re-scheduling (allowRepeat=false) — here with the other
  // shop-open hand grants (Chaos above), so a granted copy can still complete a triple below.
  if (s.pendingQuestRewards?.length) {
    const remaining: { questId: string; turnsLeft: number }[] = [];
    for (const p of s.pendingQuestRewards) {
      if (p.turnsLeft - 1 <= 0) {
        // Resolve the scheduling def — a quest OR a rune (Rune of the Gilded Spark's "get another in 2 turns").
        const d = QUEST_INDEX[p.questId] ?? (RUNE_INDEX[p.questId] as unknown as QuestDef | undefined);
        if (d) applyQuestReward(s, d, false);
      } else {
        remaining.push({ questId: p.questId, turnsLeft: p.turnsLeft - 1 });
      }
    }
    s.pendingQuestRewards = remaining;
  }
  // Feed the Alpha: the recurring end-of-turn grant — conjure each armed card to hand every turn setup for the
  // rest of the run (one Feed the Alpha spell per turn). Hand-cap-safe (conjureToHand no-ops on a full hand).
  if (s.questRecurringGrants?.length) {
    for (const id of s.questRecurringGrants) conjureToHand(s, CARD_INDEX[id] ? [CARD_INDEX[id]!] : [], 1);
  }
  // Rune of Copies (Epic): each turn setup, copy a random board minion to hand (the immediate copy fired on buy).
  if (s.runeCopies) copyRandomBoardMinion(s);
  // Rune of the Conductor (Epic): the shop OPENS by triggering all your End of Turn effects — the warband's
  // EoT minions + quest/rune recurring rewards, exactly like a real End of Turn (Chronos repeats included).
  // Per-turn scalers (Rune of Spending / Rune of Action read Gold-spent / cards-played) see the FRESH turn's
  // zeroed counters at shop open, so those specific rewards contribute nothing here by design. Wrapped
  // sourceless for FX (descends onto every gainer via the recruitFxSeq boundary), and the triggers count
  // toward "Trigger N End of Turn effects" quests like real ones.
  if (s.runeConductor) {
    captureBuffFx(s, undefined, 'spell', () => applyEndOfTurn(s));
    advanceQuestsBy(s, (o) => o.event === 'endOfTurn', s.lastEotFires ?? 0);
  }
  // Rune of the Summit: every 2nd shop opens a Tier 7 Discover. `exactTier: 7` is a FIXED-tier offer, so it
  // resolves with no rift active — which is the entire point (Tier 7 is otherwise unreachable outside one).
  if (s.runeSummit) {
    s.runeSummitTick = (s.runeSummitTick ?? 0) + 1;
    if (s.runeSummitTick % 2 === 0) queueDiscover(s, { kind: 'minion', tier: 7, exactTier: 7 });
  }
  // Triples can be completed by a combat carry-back that lands a 3rd copy in the hand (e.g. a
  // Deathrattle-granted minion) AFTER the last recruit action that would have checked. Every other
  // path checks on the mutation; this is the one entry the player never triggers, so check once here
  // as the shop opens. Idempotent + loop-guarded, and the only settle/advance-path call (no double-Discover).
  // No hand overflow here: a shop-start triple always includes ≥1 hand-granted copy (3 board copies would
  // have tripled back in recruit), and checkTriples pulls from the hand first — removing it offsets the
  // golden it pushes back, so the hand never grows past the cap.
  checkTriples(s);
  // Quest turns roll the tavern HERE (after checkTriples — matching the old deferred `buyQuest` roll's rngCursor
  // position, so the run stays byte-identical) so the shop is populated behind the quest overlay for a
  // shop-informed pick. Honors a carried-over freeze; `buyQuest` now just closes the offer (no re-roll).
  if (s.questOffer) {
    if (s.frozen) {
      topUpTavern(s);
      injectPendingTavern(s, true); // defer the eat until the quest offer closes (openNextStartOfTurnModal)
      s.frozen = false;
    } else {
      refreshTavern(s, true);
    }
  }
}

/** Advance every active, incomplete quest whose objective matches `pred`, by 1; complete + apply the reward at
 *  the threshold. Called once per tracked action (buy/play/sell/roll/shout) and once per newly-summoned minion. */
function advanceQuests(s: RunState, pred: (o: QuestObjective) => boolean): void {
  advanceQuestsBy(s, pred, 1);
}

/** The Author's Hand compound objective: bump one key (Shout / Echo / Rally) toward the shared `count`; complete
 *  when all three reach it. `progress` mirrors the min of the three (for the panel bar). */
function bumpAuthorsHand(s: RunState, key: 'shout' | 'echo' | 'rally', n: number): void {
  if (n <= 0) return;
  for (const aq of s.activeQuests ?? []) {
    if (aq.completed) continue;
    const def = QUEST_INDEX[aq.questId];
    if (!def || def.objective.event !== 'authorsHand') continue;
    const sp = (aq.subProgress ??= { shout: 0, echo: 0, rally: 0 });
    sp[key] = Math.min(def.objective.count, sp[key] + n);
    aq.progress = Math.min(sp.shout, sp.echo, sp.rally);
    if (sp.shout >= def.objective.count && sp.echo >= def.objective.count && sp.rally >= def.objective.count) {
      aq.completed = true;
      applyQuestReward(s, def, true);
    }
  }
}

/** Advance every active, incomplete quest matching `pred` by `amount` (≥1); complete + apply the reward at the
 *  threshold. Used for amount-based objectives (spendGold, tribeStats, End-of-Turn / Shout trigger counts). */
function advanceQuestsBy(s: RunState, pred: (o: QuestObjective) => boolean, amount: number): void {
  if (amount <= 0) return;
  for (const aq of s.activeQuests ?? []) {
    if (aq.completed) continue;
    const def = QUEST_INDEX[aq.questId];
    if (!def) continue;
    if (def.objective.event === 'compound') {
      // Route the tick to whichever compound parts match this predicate (a compound can mix recruit + combat events).
      advanceCompound(s, aq, def, (def.objective.parts ?? []).map((p) => (pred(p as QuestObjective) ? amount : 0)));
      continue;
    }
    if (!pred(def.objective)) continue;
    aq.progress += amount;
    resolveQuestThreshold(s, aq, def);
  }
}

/** Advance a compound quest's parts by the per-part `amounts` (index-aligned with `objective.parts`); complete +
 *  apply the reward once EVERY part has filled. `progress` = Σ part progress (the panel renders per-part lines). */
function advanceCompound(s: RunState, aq: ActiveQuest, def: QuestDef, amounts: number[]): void {
  const parts = def.objective.parts ?? [];
  const pp = (aq.partProgress ??= parts.map(() => 0));
  let changed = false;
  parts.forEach((part, i) => {
    const add = amounts[i] ?? 0;
    if (add > 0 && pp[i]! < part.count) { pp[i] = Math.min(part.count, pp[i]! + add); changed = true; }
  });
  if (!changed) return;
  aq.progress = pp.reduce((a, b) => a + b, 0);
  if (parts.every((part, i) => (pp[i] ?? 0) >= part.count)) {
    aq.completed = true;
    aq.completionCount = (aq.completionCount ?? 0) + 1;
    applyQuestReward(s, def, true);
  }
}

/** Complete a quest at its threshold (apply the reward, mark done) — or, for a REPEATABLE quest (Ossuary Rite),
 *  fire the reward and re-arm (subtract the count, stay active) as many times as the progress covers, so one big
 *  combat can grant it more than once. */
function resolveQuestThreshold(s: RunState, aq: ActiveQuest, def: QuestDef): void {
  if (def.repeatable) {
    while (aq.progress >= def.objective.count) {
      aq.progress -= def.objective.count;
      aq.completionCount = (aq.completionCount ?? 0) + 1; // never sets `completed`; bumps so telemetry still sees it
      applyQuestReward(s, def, true);
    }
  } else if (aq.progress >= def.objective.count) {
    aq.completed = true;
    aq.completionCount = (aq.completionCount ?? 0) + 1;
    applyQuestReward(s, def, true);
  }
}

/** Conjure `reps` random minions of `tribe` (≤ current tier) into the hand — the quest-reward draw (Grave
 *  Toll's "random Undead", Trail Rations' "random Beast"). Shares `conjureToHand`'s seeded pick + hand cap. */
function grantRandomTribeMinion(s: RunState, tribe: Tribe, reps: number, overflow = false): void {
  const pool = poolOf(s).buyable.filter((c) => (c.tribe === tribe || c.tribe2 === tribe) && c.tier <= s.tier);
  conjureToHand(s, pool, reps, overflow);
}

/** Conjure `reps` random buyable minions of EXACTLY `tier` (in your tribes / neutral) — Rune of the Pair's
 *  "2 random Tier 4 minions". */
function grantRandomTierMinion(s: RunState, tier: number, reps: number, overflow = false): void {
  const pool = poolOf(s).buyable.filter((c) => c.tier === tier && (c.tribe === 'neutral' || s.tribes.includes(c.tribe)));
  conjureToHand(s, pool, reps, overflow);
}

/** Whether a card matches a reward's minion "class" filter (a Shout=Battlecry, an End-of-Turn, an Echo=Deathrattle,
 *  a Rally=RL keyword, or an Attachment=Magnetic). Shared by the filtered grant + the recurring-attachment EoT. */
function matchesFilter(c: CardDef, filter: 'shout' | 'endOfTurn' | 'echo' | 'rally' | 'attachment'): boolean {
  switch (filter) {
    case 'shout': return hasBattlecry(c);
    case 'endOfTurn': return c.effects.some((e) => e.on === 'endOfTurn');
    case 'echo': return c.effects.some((e) => e.on === 'onDeath');
    case 'rally': return c.keywords.includes('RL');
    case 'attachment': return c.keywords.includes('M');
  }
}

/** Conjure `reps` random buyable minions matching a class filter into the hand. `exactTier` restricts to the
 *  CURRENT tavern tier (fallback ≤ tier if none there); otherwise ≤ current tier. Powers the "get a random
 *  Shout / End-of-Turn / Echo / Rally / Attachment minion" rewards. */
function grantRandomFilterMinion(s: RunState, filter: 'shout' | 'endOfTurn' | 'echo' | 'rally' | 'attachment', reps: number, exactTier = false, overflow = false): void {
  const base = poolOf(s).buyable.filter((c) => matchesFilter(c, filter));
  let pool = base.filter((c) => (exactTier ? c.tier === s.tier : c.tier <= s.tier));
  if (pool.length === 0) pool = base.filter((c) => c.tier <= s.tier); // exact-tier gap → fall back to ≤ tier
  conjureToHand(s, pool, reps, overflow);
}

/**
 * Apply a completed quest's reward. `allowRepeat` gates the delayed re-grant so the repeat fire itself doesn't
 * schedule another (Trail Rations). Keep in lockstep with the `QuestReward` union in @game/core:
 *  - buffBoard   → a flat +atk/+hp on every board minion (itemized via `addBuff`).
 *  - grant       → conjure the random-tribe minion(s) + each listed card (Gold Pouch) to hand; maybe schedule
 *                  the whole reward to repeat `repeatInTurns` turns later.
 *  - shoutDouble → bank charges so the next N played Shouts each trigger twice (spent in `playedShoutRepeats`).
 */
/** How many runes each Runeforge visit offers (basic + Epic). */
const RUNEFORGE_OFFER = 4;

/** Hero-power kinds that get value from a double trigger — the (dormant) gate for Rune of Empowerment. Keep in
 *  sync with the `reps`-reading branches in the `heroPower` case (scalingGold / gainMaxMana / fortify / dynamiteDig). */
const DOUBLEABLE_POWERS = new Set(['scalingGold', 'gainMaxMana', 'fortify', 'dynamiteDig', 'dragonTamer']);

/** The eligible rune-id pool for whichever forge is open (normal or Epic), filtered by the current hero's power:
 *  a `requiresDoublePower` rune (Empowerment) is dropped for a hero whose power can't double. */
function runeforgePool(s: RunState): string[] {
  const set = s.runeforgeEpic ? EPIC_RUNES : RUNES;
  const canDouble = DOUBLEABLE_POWERS.has(getHero(s.heroId).power.kind);
  return set.filter((rn) => !rn.requiresDoublePower || canDouble).map((rn) => rn.id);
}

/** Draw `n` distinct rune ids from `ids`, preferring ones not in `avoid` (a re-roll's current offer) but falling
 *  back to the avoided set if there aren't enough fresh ones — so a small Epic pool still yields a full offer. */
function drawRunes(ids: string[], n: number, rng: ReturnType<typeof makeRng>, avoid: Set<string> = new Set()): string[] {
  const fresh = ids.filter((id) => !avoid.has(id));
  const rest = ids.filter((id) => avoid.has(id));
  const picks: string[] = [];
  const take = (arr: string[]) => { while (picks.length < n && arr.length > 0) picks.push(arr.splice(rng.int(arr.length), 1)[0]!); };
  take(fresh);
  take(rest);
  return picks;
}

/** Open the EPIC Runeforge (a quest reward): present a random 3 of the eligible Epic runeset. Reuses the same
 *  offer/buy/skip/reroll machinery as the Runesmith's forge, flagged `runeforgeEpic` so the reroll draws from the
 *  Epic pool, the UI labels it "Epic", and closing it doesn't spend a hero-power charge. Salted distinct from the
 *  normal forge's stream. */
export function openEpicRuneforge(s: RunState): void {
  s.runeforgeEpic = true;
  s.runeforgeNoCharge = true; // reached by a quest/rune, not the hero power
  s.runeforgeRerolled = undefined;
  s.runeforgeOffer = drawRunes(runeforgePool(s), RUNEFORGE_OFFER, makeRng(mixSeed(s.seed, s.wave, TAG.QUEST, 2)));
}

/** Open the BASIC Runeforge from a quest/rune (The Runeforge quest), granting `gold` this turn. Uses the normal
 *  runeset but is flagged `runeforgeNoCharge` (it's not the Runesmith hero power, so buying spends no charge). */
function openScheduledBasicRuneforge(s: RunState, gold = 0): void {
  s.runeforgeEpic = undefined;
  s.runeforgeNoCharge = true;
  s.runeforgeRerolled = undefined;
  s.runeforgeOffer = drawRunes(runeforgePool(s), RUNEFORGE_OFFER, makeRng(mixSeed(s.seed, s.wave, TAG.QUEST, 3)));
  if (gold > 0) s.embers += gold;
}

/** The distinct minion ids that GREATER-tier quests grant as rewards (grant/recurringGrant/multi cards) — the pool
 *  Rune of the Second Path Discovers from. Excludes spells. */
function greaterQuestRewardMinions(): string[] {
  const ids = new Set<string>();
  const collect = (r: QuestDef['reward']): void => {
    if (r.kind === 'grant') for (const id of r.cards ?? []) ids.add(id);
    else if (r.kind === 'recurringGrant') for (const id of r.cards) ids.add(id);
    else if (r.kind === 'multi') for (const sub of r.rewards) collect(sub);
  };
  for (const q of Object.values(QUEST_INDEX)) if (q.tier === 'greater') collect(q.reward);
  return [...ids].filter((id) => CARD_INDEX[id] && !CARD_INDEX[id]!.spell);
}

/** Rune of Copies: conjure a fresh copy of a RANDOM board minion into the hand (base card + run auras, like the
 *  Dupes copy). No-op on an empty board or a full hand. */
function copyRandomBoardMinion(s: RunState): void {
  const pool = s.board.map((c) => CARD_INDEX[c.cardId]).filter((d): d is CardDef => !!d);
  conjureToHand(s, pool, 1);
}

/** Close any open forge — clears the offer + its per-visit flags. */
function closeRuneforge(s: RunState): void {
  s.runeforgeOffer = undefined;
  s.runeforgeEpic = undefined;
  s.runeforgeNoCharge = undefined;
  s.runeforgeRerolled = undefined;
}

/** Open the next start-of-turn modal in priority order — **Quest > Runeforge > Discover / other** — but only if
 *  none is currently open. This lets a turn that lines up several start-of-turn events (a quest offer, the Epic
 *  Runeforge, queued Discovers) resolve them SEQUENTIALLY instead of dropping or deferring the lower-priority ones.
 *  Quest offers + the Runesmith forge are opened directly by `advanceCombat` (top priority); this drains what waits
 *  behind them, and is called from every modal-close path (buyQuest / forge close / discover resolve). */
function openNextStartOfTurnModal(s: RunState): void {
  if (s.questOffer || s.runeforgeOffer || s.discover || s.chooseOne || s.pendingTarget) return; // one modal at a time
  // A forge armed MID-TURN is `deferred` — it must wait for the NEXT turn's start (advanceCombat promotes it by
  // clearing the flag) so a mid-turn modal-close drain can't open it on the completing turn (owner bug 2026-07-13).
  if (s.pendingEpicRuneforge && !s.pendingForgeDeferred) { openEpicRuneforge(s); s.pendingEpicRuneforge = false; return; } // Runeforge before Discovers
  if (s.pendingBasicForge && !s.pendingBasicForge.deferred) { const g = s.pendingBasicForge.gold ?? 0; s.pendingBasicForge = undefined; openScheduledBasicRuneforge(s, g); return; }
  if (s.discoverQueue?.length) { openDiscover(s, s.discoverQueue.shift()!); return; } // then any queued start-of-turn Discovers
  // Every start-of-turn modal has cleared — the recruit phase is now interactive, so run any DEFERRED Fodder eat
  // (held at turn setup so the player saw the Fodder in the shop behind the quest/Runeforge overlay first).
  if (s.holdFodderConsume) { s.holdFodderConsume = undefined; consumeTavernFodder(s); }
}

function applyQuestReward(s: RunState, def: QuestDef, allowRepeat: boolean): void {
  const r = def.reward;
  switch (r.kind) {
    case 'buffBoard':
      for (const c of s.board) addBuff(c, `Quest: ${def.name}`, r.attack, r.health);
      break;
    case 'grant':
      // Quest / rune reward cards are guaranteed delivery — they OVERFLOW the hand cap rather than being dropped
      // when hand + board are full (owner ruling: never lose an earned reward). `overflow = true` on every grant.
      if (r.randomTribe && (r.randomCount ?? 0) > 0) grantRandomTribeMinion(s, r.randomTribe, r.randomCount!, true);
      if ((r.randomSpell ?? 0) > 0) conjureToHand(s, poolOf(s).spells.filter((c) => c.tier <= s.tier), r.randomSpell!, true); // Hoard Spark's random spell
      if (r.randomFilter) grantRandomFilterMinion(s, r.randomFilter, r.randomFilterCount ?? 1, r.randomFilterExactTier, true); // "N random Shout/Echo/Rally/Attachment minions"
      if (r.randomTier) grantRandomTierMinion(s, r.randomTier, r.randomCount ?? 1, true); // Rune of the Pair — N random Tier-K minions
      for (const id of r.grantGolden ?? []) { // Leader of the Pack / Stormcalling — a GILDED copy (board-overflow safe)
        if (CARD_INDEX[id]) grantMinionToHandOrBoard(s, CARD_INDEX[id]!, true, true);
      }
      for (const id of r.cards ?? []) {
        if (!CARD_INDEX[id]) continue;
        const card = grantMinionToHandOrBoard(s, CARD_INDEX[id]!, false, true);
        // Apex Hunt: stamp the granted card (a Badgington) with extra keywords (Flurry + Ward) on the way in.
        if (r.grantKeywords) for (const kw of r.grantKeywords) if (!card.keywords.includes(kw)) card.keywords.push(kw);
      }
      if (allowRepeat && (r.repeatInTurns ?? 0) > 0) {
        (s.pendingQuestRewards ??= []).push({ questId: def.id, turnsLeft: r.repeatInTurns! });
      }
      break;
    case 'shoutDouble':
      s.shoutDoubleCharges = (s.shoutDoubleCharges ?? 0) + r.count;
      break;
    case 'tribeAura':
      // Den Marker: "your <tribe> have +A/+H wherever they are" — fold into the tribe's run aura + buff now.
      grantTribeAura(s, r.tribe, r.attack, r.health, `Quest: ${def.name}`);
      break;
    case 'scalingTribeAura':
      // Pack Mentality: apply the base aura now, then register it to GROW as its trigger event accrues.
      grantTribeAura(s, r.tribe, r.attack, r.health, `Quest: ${def.name}`);
      (s.questScalingAuras ??= []).push({ tribe: r.tribe, per: r.per, event: r.event, stepAttack: r.stepAttack, stepHealth: r.stepHealth, progress: 0 });
      break;
    case 'recurringGrant':
      // Feed the Alpha: conjure these cards to hand at the end of every turn for the rest of the run.
      (s.questRecurringGrants ??= []).push(...r.cards);
      break;
    case 'impAura':
      // Imp Census: permanently improve your Imps +A/+H run-wide (bumps `impBuff`; also buffs current board/hand
      // Imps). Repeats via the reward's `repeatInTurns` (folded through `multi`).
      buffImpsRunWide(s, r.attack, r.health, `Quest: ${def.name}`);
      break;
    case 'beastPlayBuff':
      // Den Marker: arm the run-wide Den-Mother aura — every Beast played/summoned gains +A/+H (climbing every
      // `per` Beasts). Applied in the recruit onSummon path (see `applyDenMarker`); stacks with a real Den Mother.
      s.denMarker = { attack: r.attack, health: r.health, step: r.step, per: r.per, count: 0 };
      break;
    case 'combatFlag':
      // Blood Trail / Echoing Coop / Law of Teeth / The Old Hunt / Shared Circuit: arm the run-wide combat mod.
      s.questFlags ??= {};
      if (r.flag === 'oldHunt') s.questFlags.oldHunt = r.amount ?? 0;
      else if (r.flag === 'sharedCircuit') s.sharedCircuitWard = r.amount ?? 0; // amount = Mechs warded at SoC
      else if (r.flag === 'pitWithoutEnd') s.pitWithoutEndImps = r.amount ?? 0; // amount = Imps on board wipe
      else if (r.flag === 'assemblyLine') s.questFlags.assemblyLine = r.amount ?? 4; // Avenge N → a Money Bot to hand
      else s.questFlags[r.flag] = true;
      break;
    case 'shoutRepeat':
      // Hoardwake / The Hoard Wakes (always) → +1 permanent Battlecry trigger (stacks); Warm Embers
      // (firstEachRound) → the first Shout each turn triggers twice.
      if (r.scope === 'always') s.shoutExtraAlways = (s.shoutExtraAlways ?? 0) + 1;
      else s.shoutFirstDoubleEachRound = true;
      break;
    case 'endOfTurnRepeat':
      // Parliament of Flame: your End-of-Turn effects trigger an extra time (stacks, like Chronos).
      s.endOfTurnExtra = (s.endOfTurnExtra ?? 0) + 1;
      break;
    case 'recurringEndOfTurn':
      // Echoing Roar / The Hoard Wakes: a recurring End-of-Turn effect fired every turn for the rest of the run.
      (s.questRecurringEndOfTurn ??= []).push(r.effect);
      break;
    case 'gainGold':
      // `immediate` → spend it THIS shop (Rune of Small Fortune: "Get N Gold immediately"). Otherwise bank it
      // into your NEXT shop (Bone Ledger — the standard "Get N Gold" channel, surviving the per-turn embers
      // reset like Hoarder / Bounty Bot's bonus Gold). A Runeforge opens during a shop turn, so += is immediate.
      if (r.immediate) s.embers += r.amount;
      else s.bonusEmbersNextTurn = (s.bonusEmbersNextTurn ?? 0) + r.amount;
      break;
    case 'echoRepeat':
      // Funeral Engine (always) → +1 permanent Echo trigger (stacks like Sylus); Grave Contract / Last Rites
      // (firstEachCombat) → the first Echo each combat fires one extra time (additive across both).
      if (r.scope === 'always') s.echoExtraAlways = (s.echoExtraAlways ?? 0) + 1;
      else s.echoFirstEachCombat = (s.echoFirstEachCombat ?? 0) + 1;
      break;
    case 'boneThrone':
      // The Bone Throne: every `every` friendly deaths in combat, trigger your leftmost Echo (permanent).
      s.boneThroneStep = r.every;
      break;
    case 'rallyRepeat':
      // Infinite Assembly (always) → +1 permanent Rally trigger; Spark Permit / Overclocked Core
      // (firstEachCombat) → the first Rally each combat fires one extra time (additive across both).
      if (r.scope === 'always') s.rallyExtraAlways = (s.rallyExtraAlways ?? 0) + 1;
      else s.rallyFirstEachCombat = (s.rallyFirstEachCombat ?? 0) + 1;
      break;
    case 'fodderReward':
      // Small Offering: queue Fodder into your next shop + a persistent run-wide Fodder buff.
      for (let i = 0; i < (r.fodder ?? 0); i++) (s.pendingTavern ??= []).push('fred');
      if ((r.attack ?? 0) > 0 || (r.health ?? 0) > 0) buffFodderRunWide(s, r.attack ?? 0, r.health ?? 0, `Quest: ${def.name}`);
      break;
    case 'gainMaxGold':
      s.maxGoldBonus = (s.maxGoldBonus ?? 0) + r.amount; // Shop License: permanent +max Gold, above the cap
      s.embers += r.amount; // reflect the raised max in THIS turn's spendable Gold too
      break;
    case 'discover': {
      // Reward-kind 'discover' — open a minion Discover at your CURRENT tier, or at `r.tier` when the reward
      // PINS one (Rune of the Scout → Tier 5, Rune of the Champion → Tier 6, Rune of the Summit → Tier 7).
      // An AUTHORED tier is honoured as written: it is deliberate content, and clamping it to the run's
      // ceiling would silently downgrade a Tier 7 reward to Tier 6 whenever the Summit rift is off — which
      // is exactly when those rewards are the ONLY way to reach Tier 7. Only a DERIVED tier (falling back to
      // the live shop tier) is clamped, since that one can legitimately overshoot.
      const t = r.tier ?? Math.min(s.tier, maxTierFor(s.rift));
      // queueDiscover, NOT openDiscover: a quest can complete on the same turn the Runeforge opens, and two
      // quests can pay out together — a direct open would draw this offer on top of the other modal.
      queueDiscover(s, { kind: 'minion', tier: t, exactTier: t });
      break;
    }
    case 'discoverGreaterQuest':
      // Rune of the Second Path: Discover one of the minions Greater Quests grant as rewards.
      queueDiscover(s, { kind: 'pool', ids: greaterQuestRewardMinions() });
      break;
    case 'dupeFirstBuy':
      s.dupeFirstBuyEachTurn = true; // Dupes: the first minion bought each turn is copied to hand
      break;
    case 'spellRepeat':
      // Ancient Runes (always) → all spells cast twice; Spell Thesis (firstEachTurn) → first spell each turn twice.
      if (r.scope === 'always') s.spellDoubleAlways = true;
      else s.spellFirstDoubleEachTurn = true;
      break;
    case 'minionCost':
      s.minionCostOverride = r.cost; // Merchant's Mark: shop minions cost this much
      break;
    case 'attachmentDeal':
      // Attachment Issues: every shop is guaranteed a Magnetic offer, and every Attachment costs `cost` Gold.
      s.attachmentCost = r.cost;
      s.alwaysAttachmentShop = true;
      // Apply to the CURRENT shop right away: price every Magnetic offer at the deal (the next roll re-applies +
      // guarantees one). No Magnetic in the current shop → it appears after the next refresh.
      for (const o of s.shop) if (CARD_INDEX[o.cardId]?.keywords.includes('M')) o.cost = r.cost;
      break;
    case 'friedCircuits':
      s.friedCircuitsStepAtk = r.stepAttack; // Fried Circuits: each buy buffs shop Mechs by step × buys (escalating)
      s.friedCircuitsStepHp = r.stepHealth;
      s.friedCircuitsBuys = 0;
      break;
    case 'undeadSpellAura':
      s.forsakenWillAttack = r.attack; // Forsaken Will: each spell cast grants your Undead aura +attack
      break;
    case 'baneDemonAura':
      // Bane's Existence: arm the widen — Banes now also buff all your Demons run-wide on each Battlecry trigger.
      s.baneBuffsDemons = { attack: r.attack, health: r.health };
      break;
    case 'slaughterRepeat':
      s.slaughterFirstEachCombat = (s.slaughterFirstEachCombat ?? 0) + 1; // Author's Hand
      break;
    case 'shoutEdgeBuff':
      // Twin Sun Oath: every Shout you trigger buffs your leftmost + rightmost board minion (stacks if re-armed).
      s.shoutEdgeBuff = {
        attack: (s.shoutEdgeBuff?.attack ?? 0) + r.attack,
        health: (s.shoutEdgeBuff?.health ?? 0) + r.health,
      };
      break;
    case 'goldFodder':
      // Food for Gold: arm the per-`per`-Gold Fodder drip (spendGold ticks it). Fresh remainder on arm.
      s.foodForGold = { per: r.per, attack: r.attack, health: r.health };
      s.foodForGoldTick = 0;
      break;
    // ── Runeforge rune rewards ──
    case 'runeSpellDrip':
      s.spellDripPer = r.per; // Rune of Spellslinging: every `per` Gold spent → a random spell (spendGold ticks it)
      s.spellDripTick = 0;
      break;
    case 'runeStructure':
      s.runeStructure = true; // Rune of Structure: playing an Attachment also gives a random spell
      break;
    case 'runeConsume':
      s.runeConsume = { attack: r.attack, health: r.health }; // Rune of Consumption: each Consume bumps the Fodder aura
      break;
    case 'goldPouchValue':
      s.goldPouchValue = r.value; // Rune of Pillaging: your Gold Pouches are worth this much
      break;
    case 'runeSummoning':
      s.runeSummoning = true; // Rune of Summoning: each spell cast improves your Imps +1/+1
      break;
    case 'runeKindling':
      s.runeKindling = true; // Rune of Kindling: each spell cast gives your leftmost minion +3/+3
      break;
    case 'runeScales':
      s.runeScales = true; // Rune of Scales: each spell cast gives your Dragons +1/+1
      break;
    case 'runeBartering':
      s.runeBartering = true; // Rune of Bartering: Shout minions sell for 2 Gold
      break;
    case 'runeTwinGilding':
      s.runeTwinGilding = true; // Rune of Twin Gilding: Gild at 2 copies instead of 3
      break;
    case 'runeDenMother':
      s.runeDenMother = true; // Rune of the Den Mother: Den Mother buffs herself too
      break;
    case 'runeScale':
      s.runeScale = { count: r.count, attack: r.attack, health: r.health }; // each Gold-spend buffs random allies
      break;
    case 'runeCopies':
      // Rune of Copies: arm the per-turn copy — at the start of each shop, copy a random board minion to hand.
      s.runeCopies = true;
      break;
    case 'runeEmpowerment':
      s.runeEmpowerment = true; // Rune of Empowerment (Epic): your hero power triggers twice
      break;
    case 'runeTempering':
      s.runeTempering = true; // Rune of Tempering: the first Attachment each turn also grants Ward
      break;
    case 'runeReplication':
      s.runeReplication = true; // Rune of Replication: the first Attachment each turn copies onto the leftmost Mech
      break;
    case 'runeRefrain':
      s.runeRefrain = true; // Rune of Refrain: your 3rd Shout each turn returns the turn's first Shout to hand
      break;
    case 'runeTransfusion':
      s.runeTransfusion = true; // Rune of Transfusion: a Demon Consume also feeds your leftmost minion
      break;
    case 'runeEndlessAppetite':
      s.runeEndlessAppetite = true; // Rune of Endless Appetite: the first Consume each turn fans out to all other Demons
      break;
    case 'runeSummit':
      // Rune of the Summit: every 2nd shop from here opens a Tier 7 Discover. Tick starts at 0, so the
      // first payout lands on the SECOND shop after purchase — "in 2 turns", as written.
      s.runeSummit = true;
      s.runeSummitTick = 0;
      break;
    case 'runeConductor':
      s.runeConductor = true; // Rune of the Conductor: start of every shop triggers your End of Turn effects
      break;
    case 'runeMastery':
      s.runeMastery = true; // Rune of Mastery: every Improve step applies twice (shop + combat)
      break;
    case 'openEpicRuneforge':
      // Deferred: arm it now, open at the START of NEXT turn (after this turn's combat). `pendingForgeDeferred`
      // blocks the mid-turn modal-close drains from opening it early (owner bug 2026-07-13: it opened mid-turn
      // and the player had already spent the Gold they needed for the runes). Reached by The Epic Runeforge quest.
      s.pendingEpicRuneforge = true;
      s.pendingForgeDeferred = true;
      break;
    case 'scheduleRuneforge':
      // Arm a Runeforge visit for a future turn's start (opened by advanceCombat's start-of-turn sequencing).
      // `onWave` pins the Epic forge to an absolute wave (Rune of the Epic Forge → 9); otherwise it's next turn —
      // deferred so a mid-turn modal-close can't open it on the turn the quest completed (owner bug 2026-07-13).
      if (r.onWave != null) s.epicForgeWave = r.onWave;
      else if (r.forge === 'epic') { s.pendingEpicRuneforge = true; s.pendingForgeDeferred = true; }
      else s.pendingBasicForge = { gold: r.gold, deferred: true };
      break;
    case 'multi':
      // The Hoard Wakes: several rewards at once — apply each sub-reward through this same path.
      for (const sub of r.rewards) applyQuestReward(s, { ...def, reward: sub }, allowRepeat);
      break;
  }
}

/** Fold a persistent "your <tribe> have +A/+H wherever they are" aura into the run: stack it into the tribe's
 *  buy-time aura channel (so future creations inherit it) AND buff every current board + hand member now. Only
 *  Beast ships a quest aura today (its `beastBuyAtk`/`beastBuyHp` channel); other tribes still get the immediate
 *  board/hand buff and wire their own buy-channel when they get auras. Shared by tribeAura / scalingTribeAura /
 *  The Old Hunt / Pack Mentality growth. */
function grantTribeAura(s: RunState, tribe: Tribe, attack: number, health: number, label: string): void {
  if (tribe === 'beast') {
    s.beastBuyAtk = (s.beastBuyAtk ?? 0) + attack;
    s.beastBuyHp = (s.beastBuyHp ?? 0) + health;
  }
  if (attack !== 0 || health !== 0) {
    for (const c of [...s.board, ...s.hand]) {
      if (isTribe(c, tribe)) addBuff(c, label, attack, health);
    }
  }
}

/** This combat's count of a quest objective's event (combat-phase only): the Echo objective reads the
 *  Deathrattle tally; attack / summonCombat / slaughter read `playerQuestTally`, tribe-narrowed. */
function combatEventCount(result: CombatResult, o: { event: QuestObjectiveEvent; tribe?: Tribe }): number {
  if (o.event === 'deathrattle') return result.playerDeathrattles;
  if (o.event === 'friendlyDeath') return result.playerDeaths ?? 0;
  if (o.event === 'rally') return result.playerRallies ?? 0;
  if (o.event === 'summonImp') return result.playerImpsSummoned ?? 0;
  const t = result.playerQuestTally;
  if (!t) return 0;
  if (o.event === 'attack') return o.tribe ? (t.attackByTribe[o.tribe] ?? 0) : t.attack;
  // A `summon` objective (Forest Grove's "Summon 5 Beasts") counts summons in BOTH phases — recruit summons tick
  // via the reducer's `advanceQuests`, and combat summons add here (they read the same combat summon tally).
  if (o.event === 'summonCombat' || o.event === 'summon') return o.tribe ? (t.summonCombatByTribe[o.tribe] ?? 0) : t.summonCombat;
  if (o.event === 'slaughter') return o.tribe ? (t.slaughterByTribe[o.tribe] ?? 0) : t.slaughter;
  if (o.event === 'slaughterKeyword') return t.slaughterKeyword; // The Red Trail — tribe-agnostic
  // "Give <tribe> N total stats" (Skybound Pact / Taragosa's Inheritance): combat buffs to that tribe, on top of
  // the recruit-phase diff (see the `tribeStats` advance in advanceQuests).
  if (o.event === 'tribeStats') return o.tribe ? (t.statGainByTribe[o.tribe] ?? 0) : 0;
  return 0;
}

/** Advance every active, incomplete COMBAT-phase quest by this fight's tally (+N); complete + apply the reward
 *  at the threshold. Called once per settled combat (the recruit-phase `advanceQuests` handles +1 actions). */
function advanceCombatQuests(s: RunState, result: CombatResult): void {
  for (const aq of s.activeQuests ?? []) {
    if (aq.completed) continue;
    const def = QUEST_INDEX[aq.questId];
    if (!def) continue;
    if (def.objective.event === 'compound') {
      advanceCompound(s, aq, def, (def.objective.parts ?? []).map((p) => combatEventCount(result, p)));
      continue;
    }
    const inc = combatEventCount(result, def.objective);
    if (inc <= 0) continue;
    aq.progress += inc;
    resolveQuestThreshold(s, aq, def);
  }
}

/** Pack Mentality: grow each registered scaling aura by this combat's tally of its trigger event, stepping the
 *  aura up once per `per` accrued (leftover carries in `progress`). */
function growScalingAuras(s: RunState, result: CombatResult): void {
  for (const sa of s.questScalingAuras ?? []) {
    // A Beast + summon-in-combat aura (Pack Mentality) grows LIVE during the fight — its magnitude is already
    // folded in via `playerBeastBuy*Gain` above, so here we only sync the leftover progress the engine reported
    // (re-growing from the tally would double-count).
    if (sa.tribe === 'beast' && sa.event === 'summonCombat') {
      if (result.playerBeastScaleProgress !== undefined) sa.progress = result.playerBeastScaleProgress;
      continue;
    }
    const inc = combatEventCount(result, { event: sa.event, tribe: sa.tribe });
    if (inc <= 0) continue;
    sa.progress += inc;
    while (sa.progress >= sa.per) {
      sa.progress -= sa.per;
      grantTribeAura(s, sa.tribe, sa.stepAttack, sa.stepHealth, 'Pack Mentality');
    }
  }
}

/** The ONGOING combat mods a not-yet-completed quest's reward would arm — so `simulate` can activate them the
 *  instant the quest completes MID-COMBAT (Feeding Line → `{feedingLine:true}`). Only boolean `combatFlag`
 *  rewards whose mod key equals the flag name (the common ongoing effects); the amount-based flags
 *  (oldHunt / assemblyLine / sharedCircuit / pitWithoutEnd) and non-flag rewards get no mid-combat mod — they
 *  still complete + arm at settle for the NEXT fight. Walks `multi` rewards. Returns undefined when none. */
function pendingQuestMods(reward: QuestDef['reward']): QuestCombatMods | undefined {
  const out: Record<string, boolean> = {};
  const walk = (r: QuestDef['reward']): void => {
    if (r.kind === 'combatFlag' && r.flag !== 'oldHunt' && r.flag !== 'assemblyLine' && r.flag !== 'sharedCircuit' && r.flag !== 'pitWithoutEnd') {
      out[r.flag] = true;
    } else if (r.kind === 'multi') for (const sub of r.rewards) walk(sub);
  };
  walk(reward);
  return Object.keys(out).length ? (out as QuestCombatMods) : undefined;
}

/** The first CARD a quest's reward grants (named grant / gilded copy), walking `multi` — flown to hand as the
 *  live "→ hand" visual the moment the quest completes mid-combat. Undefined for non-card rewards. */
function pendingRewardCard(reward: QuestDef['reward']): string | undefined {
  let found: string | undefined;
  const walk = (r: QuestDef['reward']): void => {
    if (found) return;
    if (r.kind === 'grant') found = r.cards?.[0] ?? r.grantGolden?.[0];
    else if (r.kind === 'multi') for (const sub of r.rewards) walk(sub);
  };
  walk(reward);
  return found;
}

/** The player's active, INCOMPLETE quests whose objective counts a COMBAT event — threaded into `simulate` so
 *  they can complete + activate mid-fight (see `CombatSideState.pendingQuests`). Compound / recruit-only
 *  objectives are excluded (they settle post-combat as before). */
const PENDING_COMBAT_EVENTS = new Set<QuestObjectiveEvent>(['attack', 'summonCombat', 'summon', 'slaughter', 'slaughterKeyword', 'deathrattle', 'rally']);
export function buildPendingCombatQuests(s: RunState): PendingCombatQuest[] {
  const out: PendingCombatQuest[] = [];
  for (const aq of s.activeQuests ?? []) {
    if (aq.completed) continue;
    const def = QUEST_INDEX[aq.questId];
    if (!def) continue;
    const o = def.objective;
    if (!PENDING_COMBAT_EVENTS.has(o.event) || typeof o.count !== 'number') continue;
    out.push({ questId: aq.questId, event: o.event, count: o.count, tribe: o.tribe, progress: aq.progress, mods: pendingQuestMods(def.reward), rewardCardId: pendingRewardCard(def.reward) });
  }
  return out;
}

/** Build the run-wide combat modifiers (`QuestCombatMods`) threaded into `simulate()`: the Beast Health aura
 *  plus any armed quest combat flags. */
export function questCombatMods(s: RunState): QuestCombatMods {
  const f = s.questFlags;
  // Pack Mentality's LIVE growth config, if a Beast + summon-in-combat scaling aura is armed — the combat engine
  // grows the aura per `per` Beasts summoned and carries the gain back (so settle skips re-growing it, below).
  const beastScale = (s.questScalingAuras ?? []).find((a) => a.tribe === 'beast' && a.event === 'summonCombat');
  return {
    beastAuraHp: s.beastBuyHp || undefined,
    beastSummonScale: beastScale ? { per: beastScale.per, stepAttack: beastScale.stepAttack, stepHealth: beastScale.stepHealth, progress: beastScale.progress } : undefined,
    bloodTrail: f?.bloodTrail,
    echoingCoop: f?.echoingCoop,
    lawOfTeeth: f?.lawOfTeeth,
    oldHuntStep: f?.oldHunt,
    echoExtraAlways: s.echoExtraAlways || undefined,
    echoFirstEachCombat: s.echoFirstEachCombat || undefined,
    boneThroneStep: s.boneThroneStep || undefined,
    assemblyLineStep: f?.assemblyLine || undefined, // Assembly Line: Avenge N → a Money Bot to hand
    rallyExtraAlways: s.rallyExtraAlways || undefined,
    rallyFirstEachCombat: s.rallyFirstEachCombat || undefined,
    sharedCircuitWard: s.sharedCircuitWard || undefined,
    deepHunger: f?.deepHunger,
    contractRewrite: f?.contractRewrite,
    pitWithoutEndImps: s.pitWithoutEndImps || undefined,
    doubleLeftmostAttack: f?.doubleLeftmostAttack,
    possession: getHero(s.heroId).power.kind === 'possession' || undefined, // Atrius: SoC leftmost/rightmost stat trade
    slaughterFirstEachCombat: s.slaughterFirstEachCombat || undefined,
    feedingLine: f?.feedingLine,
    umbralEnergy: f?.umbralEnergy,
    emptyGraves: f?.emptyGraves,
    crateringMissive: f?.crateringMissive, // Cratering Missive: Hulk overflow buffs ALL tribes, not just Undead
    passingSpears: f?.passingSpears, // Passing Spears: Spear Wardens give their stats to a friendly minion on death

    runeWarding: f?.runeWarding, // Rune of Warding: SoC give leftmost minion Ward
    runeFury: f?.runeFury, // Rune of Fury: Avenges trigger twice
    runeRallying: f?.runeRallying, // Rune of Rallying: SoC trigger your Rally (on-attack) effects
    runeRisingGraves: f?.runeRisingGraves, // Rune of Rising Graves: SoC give 2 Undead Rise
    runeBroodpit: f?.runeBroodpit, // Rune of the Broodpit: Avenge 6 → 2 Taunt Imps
    runeSpearline: f?.runeSpearline, // Rune of the Spearline: Avenge 4 → Spear Warden attacks now
    runeAppraisal: f?.runeAppraisal, // Rune of Appraisal: Avenge 4 → spells +1/+1
    runeSoulTaxes: f?.runeSoulTaxes, // Rune of Soul Taxes: Avenge 4 → +1 max Gold
    runeFirstClaws: f?.runeFirstClaws, // Rune of First Claws: SoC leftmost+rightmost Beasts attack now
    runePackcraft: f?.runePackcraft, // Rune of Packcraft: combat summon → Beasts +1 Atk
    runeInheritance: f?.runeInheritance, // Rune of Inheritance: leftmost dies → rightmost gains its stats
    runeSalvage: f?.runeSalvage, // Rune of Salvage: friendly Mech loses Ward → Attachment to hand
    runeTwilight: f?.runeTwilight, // Rune of Twilight: your Start-of-Combat effects trigger an extra time
    runeWarden: f?.runeWarden, // Rune of the Warden: SoC summon a Spear Warden if there's room
    runeRebirth: f?.runeRebirth, // Rune of Rebirth: your minions Rise with full Health
    runeAftershocks: f?.runeAftershocks, // Rune of Aftershocks: Echo summons gain +4/+4
    runeUndertow: f?.runeUndertow, // Rune of the Undertow: Echo summons attack immediately
    runeMirrorMarch: f?.runeMirrorMarch, // Rune of the Mirror March: SoC summon a copy of your leftmost
    runeTrophy: f?.runeTrophy, // Rune of the Trophy: first Slaughter → a copy of the slaughterer next shop
    runeMastery: s.runeMastery, // Rune of Mastery: your Improve steps apply twice (combat half)
  };
}

/**
 * Refresh the tavern: roll new offers, inject any Fodder queued for the next tavern
 * (Soulfeeder), then let your Demons devour Fodder that just entered. Both the manual
 * Refresh and the post-combat refresh route through here, so anything that interacts
 * with "tavern refresh" hooks in one place.
 */
function refreshTavern(s: RunState, hold = false): void {
  rollShop(s);
  // Apples (Choose One → "the next shop"): fold the banked buff onto the freshly-rolled offers, then clear it.
  const nb = s.nextShopBuff;
  if (nb && (nb.attack || nb.health)) {
    for (const offer of s.shop) addOfferBuff(offer, 'Apples', nb.attack, nb.health);
    s.nextShopBuff = undefined;
  }
  injectPendingTavern(s, hold);
}

/**
 * Inject any Fodder queued for this tavern (Soulfeeder) into the shop, then let Demons devour what
 * just arrived. Runs for both a fresh reroll and a frozen carry-over, so a queued Fred always
 * arrives (and is consumed) exactly once rather than being stranded in `pendingTavern`.
 */
function injectPendingTavern(s: RunState, hold = false): void {
  // Multi-shop schedule (Soulfeeder / Pit Supplier): pop THIS refresh's due Fodder into the pending queue, then
  // shift the schedule down so the rest arrive on later refreshes.
  if (s.fodderSchedule?.length) {
    const due = s.fodderSchedule.shift() ?? 0;
    for (let i = 0; i < due; i++) (s.pendingTavern ??= []).push('fred');
    if (s.fodderSchedule.length === 0) s.fodderSchedule = undefined;
  }
  const pending = s.pendingTavern ?? [];
  s.pendingTavern = []; // always cleared — Fodder is never stored; with no Demon to eat it, it's wasted
  if (pending.length === 0) return;
  // Only bring queued Fodder out if a Demon is on the board to consume it — otherwise it would just
  // clutter the tavern with un-buyable garbage, so it goes to waste instead (handoff: no Fodder storage).
  if (!s.board.some((c) => isTribe(c, 'demon'))) return; // dual-types (Bane = Dragon/Demon) count as Demons
  for (const id of pending) {
    if (CARD_INDEX[id]) s.shop.push({ uid: `s${s.uidSeq++}`, cardId: id });
  }
  // `hold`: a turn-setup roll behind a start-of-turn modal defers the eat — the Fodder sits in the shop (visible
  // to the player) and `openNextStartOfTurnModal` runs the consume once the quest/Runeforge overlay clears.
  if (hold) s.holdFodderConsume = true;
  else consumeTavernFodder(s); // the Demons eat the Fodder that just arrived
}
