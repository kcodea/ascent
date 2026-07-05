import { makeRng, simulate, type BoardMinion, type CardDef, type CombatResult, type Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { CONFIG } from './config';
import { accumulateContribution, tallyCombat } from './contribution';
import { rollShop, topUpTavern, returnToPool, takeFromPool } from './shop';
import { getHero } from './heroes';
import { buildEnemyBoard, selectThreat } from './threats';
import { pickOpponent, opponentBoard } from './opponents';
import type { BoardSnapshot } from './snapshot';
import { addBuff, applyBattlecryTarget, applyChooseOne, applyEndOfTurn, applyOnBuy, applyGoldSpent, boardManaBonus, buffCardTypeRunWide, buffFodderRunWide, cardBuff, castSpell, castSpellOnOffer, consumeTavernFodder, dominantBoardTribe, fireOnGainAttack, fireSummonBuffs, grantTopTypeMinion, hasBattlecry, isTribe, openDiscover, playCard, queueDiscover, replayBattlecry, replayEconomyBattlecry, replayEndOfTurn, sellValueOf, spellAttackBonus, spellCasts, spellHealthBonus, swapWithTavern, undeadBuyBonus, weldMagnetic } from './recruit';
import { mixSeed, TAG, type Action, type BoardCard, type CardBuff, type RunState } from './state';

/** Spend `amount` Gold and fire any `goldSpent` payoffs (Acid, Banksly) — the single Gold-spend chokepoint
 *  for buys, rerolls, tier-ups and hero powers. */
function spendGold(s: RunState, amount: number): void {
  s.embers -= amount;
  s.goldSpent = (s.goldSpent ?? 0) + amount; // career/post-run stat
  applyGoldSpent(s, amount);
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

/**
 * The board the *next* combat will serve: a wave-matched real opponent from the pool (same development stage),
 * or null when the pool is empty (→ the procedural threat). Pure + deterministic — the opponent frame previews
 * it during recruit, and `faceOmen` resolves exactly this.
 */
export function nextOpponent(s: RunState): BoardSnapshot | null {
  // Match on WAVE (same development stage — see pickOpponent). Power (captured at TURN START, so the
  // telegraphed foe stays fixed as you shop) is the fairness tiebreak among same-wave boards.
  return pickOpponent(s.wave, s.turnStartPower, makeRng(mixSeed(s.seed, s.wave, TAG.ENEMY)));
}

/** Loss-damage cap by round (early-game protection): 5 through wave 3, 10 through wave 6, 15 from wave 7. */
export function lossDamageCap(wave: number): number {
  return wave <= 3 ? 5 : wave <= 6 ? 10 : 15;
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
export function magnetizesTo(magneticCardId: string, targetCardId: string): boolean {
  const m = CARD_INDEX[magneticCardId];
  const t = CARD_INDEX[targetCardId];
  if (!m || !t) return false;
  // universalTribe Magnetic cards (Chaos Attachment) can weld onto any non-neutral target (or another all-type).
  if (m.universalTribe) return t.tribe !== 'neutral' || !!t.universalTribe;
  // A universalTribe HOST counts as every tribe (incl. Mech), so it accepts any Magnetic — e.g. a normal Mech
  // magnetic welding onto a Chaos Attachment (whose printed tribe is 'neutral', so the tribe match below misses).
  if (t.universalTribe) return true;
  const mag: Tribe[] = [m.tribe, m.tribe2].filter((x): x is Tribe => !!x);
  const tgt: Tribe[] = [t.tribe, t.tribe2].filter((x): x is Tribe => !!x);
  return mag.some((x) => tgt.includes(x));
}

/**
 * The run-loop state machine as a pure reducer: `(state, action) => state`
 * (handoff C.6). Never mutates its input — returns the same reference for a
 * no-op (invalid action) and a fresh state for a real transition. Recruit-phase
 * card effects live in `recruit.ts` (RECRUIT_FACTORIES); combat-time effects in
 * `@game/core`.
 */
export function reduce(state: RunState, action: Action): RunState {
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
    for (const c of next.board) {
      const prev = before.get(c.uid);
      if (prev !== undefined && c.attack > prev) fireOnGainAttack(next, c);
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
  if ((state.discover || state.chooseOne || state.pendingTarget) && action.type !== 'discover' && action.type !== 'chooseOne' && action.type !== 'battlecryTarget') {
    return state;
  }

  // PERF: `lastCombat` is a large read-only result (the whole prior fight's event log + initial board
  // snapshots) that the reducer never mutates in place — it only ever REPLACES the reference (faceOmen).
  // So deep-clone everything ELSE and share lastCombat by reference, dropping ~80–90% of the per-dispatch
  // clone cost (otherwise every recruit click re-cloned the entire event graph for nothing).
  const { lastCombat, ...rest } = state;
  const s = structuredClone(rest) as RunState;
  s.lastCombat = lastCombat;

  switch (action.type) {
    case 'buy': {
      // The right-hand spell slot: pays its own (modifiable) cost, into the hand.
      // No triple / buy-trigger — a spell isn't a minion.
      if (s.spell && s.spell.uid === action.uid) {
        const spellDef = CARD_INDEX[s.spell.cardId];
        if (!spellDef) return state;
        const cost = Math.max(0, (spellDef.cost ?? 0) - s.spellCostMod);
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
        const sCost = Math.max(0, (card.cost ?? 0) - s.spellCostMod);
        if (s.embers < sCost || s.hand.length >= CONFIG.handMax) return state;
        spendGold(s, sCost);
        s.shop.splice(i, 1);
        s.hand.push({ uid: `b${s.uidSeq++}`, cardId: card.id, tribe: card.tribe, attack: card.attack, health: card.health, keywords: [...card.keywords], golden: false });
        return s;
      }
      // Displacement: a minion stashed in the tavern (held) is restored INTACT on buy — all buffs/progression
      // (deliberately NO applyOnBuy: it's a restoration, not a fresh purchase, so Broker & co. don't re-bake).
      if (offer.held) {
        if (s.embers < CONFIG.minionCost || s.hand.length >= CONFIG.handMax) return state;
        spendGold(s, CONFIG.minionCost);
        s.shop.splice(i, 1);
        s.hand.push({ ...offer.held, uid: `b${s.uidSeq++}` });
        drakkoQuestBuy(s, card); // a paid buy still progresses Drakko's quest (it used to be skipped)
        checkTriples(s); // a restored copy can still complete a triple
        return s;
      }
      if (s.embers < CONFIG.minionCost || s.hand.length >= CONFIG.handMax) return state;
      s.shop.splice(i, 1);
      spendGold(s, CONFIG.minionCost);
      const cb = cardBuff(s, card.id); // persistent run buff (Ritualist's Fodder enchantment)
      const isUndead = card.tribe === 'undead' || card.tribe2 === 'undead' || !!card.universalTribe;
      const uBuyAtk = isUndead ? (s.undeadBuyAtk ?? 0) : 0;
      const bought: BoardCard = {
        uid: `b${s.uidSeq++}`,
        cardId: card.id,
        tribe: card.tribe,
        // base + persistent run buff + Deathswarmer/Forsaken Weaver undead attack bonus (baked at buy)
        attack: card.attack + cb.attack + uBuyAtk,
        health: card.health + cb.health,
        keywords: [...card.keywords, ...(offer.keywords ?? []).filter((k) => !card.keywords.includes(k))],
        golden: offer.golden ?? false, // Golden Touch: a gilded tavern offer buys in as a Golden
        boughtWave: s.wave, // Hoarder's sell value climbs from the wave it was bought
      };
      // a tavern buff (the hero power Fortify applied to this offer) rides in as a tracked buff
      addBuff(bought, 'Fortify', offer.atk ?? 0, offer.hp ?? 0);
      if (uBuyAtk > 0) addBuff(bought, 'Undead Bond', uBuyAtk, 0);
      // Staff of Guel — the run-wide "every minion you buy" buff bakes in too (tavern purchases only).
      // Fodder is excluded: it already carries the Staff buff via its run-wide enchant (cardBuff above),
      // so applying it again here would double it on the rare directly-bought Fodder.
      if ((s.tavernBuyBonus.atk || s.tavernBuyBonus.hp) && !card.keywords.includes('FD')) {
        addBuff(bought, 'Staff of Guel', s.tavernBuyBonus.atk, s.tavernBuyBonus.hp);
      }
      // Golden Touch: a gilded offer buys in Golden — double the FINAL stats (exactly like the Gild power),
      // recorded as a buff so the inspect breakdown still itemizes it. The golden flag (set above) doubles
      // its effects (Deathrattles twice, ×N multipliers) and shows the golden frame.
      if (offer.golden) addBuff(bought, 'Golden Touch', bought.attack, bought.health);
      s.hand.push(bought); // buy → hand (Battlegrounds flow)
      applyOnBuy(s, bought); // buy-triggers (Broker) bake in now (handoff C.5)
      drakkoQuestBuy(s, card); // Drakko's quest counts every paid Battlecry buy
      checkTriples(s); // a 3rd copy combines into a golden + grants a Discover
      return s;
    }

    case 'play': {
      // hand → board (Battlegrounds: play to trigger summon-buffs + Battlecry)
      const i = s.hand.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const card = s.hand[i]!;

      const def = CARD_INDEX[card.cardId];

      // Discover-on-play (data-driven): playing this card isn't a minion — it opens a Discover (a peek) and
      // is consumed (no board slot). The offer is resolved from the card's `discoverOnPlay` spec against the
      // live run. These are untargeted, so Yazzus does NOT multiply them (we return before `spellCasts`) —
      // exactly one Discover. Covers Sprout / Help Wanted / Tribe Portal / Corpse Board and the golden
      // Triple Reward token; new Discover spells need only the data field, no reducer change.
      if (def?.discoverOnPlay) {
        const dop = def.discoverOnPlay;
        s.hand.splice(i, 1);
        const tier = dop.exactTier ?? s.tier + (dop.tierOffset ?? 0);
        const tribe = dop.tribe === 'dominant' ? (dominantBoardTribe(s) ?? undefined) : dop.tribe;
        queueDiscover(s, {
          kind: 'minion',
          tier,
          ...(dop.exactTier !== undefined ? { exactTier: dop.exactTier } : {}),
          ...(dop.filter ? { filter: dop.filter } : {}),
          ...(tribe ? { tribe } : {}),
          ...(dop.topTierFirst ? { topTierFirst: true } : {}),
        });
        return s;
      }

      // Other spells: cast on the chosen target, then consume — no board slot.
      if (def?.spell) {
        // Spell Choose One (Apples): a SPELL choice — its own thing, NOT a Battlecry. Pause for the pick,
        // keeping the spell in hand; the chosen effect is cast (and the spell consumed) in `chooseOne`.
        if (def.chooseOne?.length) {
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
        s.hand.splice(i, 1);
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
        if (target && magnetizesTo(card.cardId, target.cardId)) {
          s.hand.splice(i, 1);
          // Playing a Magnetic minion IS a summon — fire summon-buffs on it BEFORE welding, so the absorbed
          // body carries any tribe summon-buff into the host (Chaos Attachment counts as a Beast → Mama
          // Bear's +X/+X lands on it, then welds onto the host). Mutates card.attack/health, read below.
          fireSummonBuffs(s, card);
          // Money Bot magnetized in: its mana-per-turn rides along on the host Mech (and survives the
          // host's triple); selling the host removes it.
          const mDef = CARD_INDEX[card.cardId];
          const mana = (mDef?.manaPerTurn ?? 0) * (card.golden ? 2 : 1) + (card.manaBonus ?? 0);
          // Weld the magnetic onto the host — stats, keywords, mana — and let any Beatboxer mimic it.
          weldMagnetic(s, target, {
            source: mDef?.name ?? card.cardId,
            attack: card.attack,
            health: card.health,
            keywords: card.keywords,
            mana,
            // Better Bot: weld its Rally (+5 Attack to other Mechs on attack, golden ×2) onto the host — stacks.
            rallyMechAtk: (mDef?.rallyMechAtk ?? 0) * (card.golden ? 2 : 1) || undefined,
            // Harry Botter: weld its spell-power aura (+1/+1 to spells, golden ×2) onto the host — stacks.
            spellAura: (mDef?.spellAura ?? 0) * (card.golden ? 2 : 1) + (card.spellAuraBonus ?? 0) || undefined,
            // Heckbinder: weld its Fodder aura (+1/+2 to new Fodder, golden ×2) onto the host — stacks, and
            // carries any aura already welded onto the magnetic itself (a hosted Heckbinder re-welded).
            fodderAura: mDef?.fodderAura || card.fodderAuraBonus
              ? {
                  attack: (mDef?.fodderAura?.attack ?? 0) * (card.golden ? 2 : 1) + (card.fodderAuraBonus?.attack ?? 0),
                  health: (mDef?.fodderAura?.health ?? 0) * (card.golden ? 2 : 1) + (card.fodderAuraBonus?.health ?? 0),
                }
              : undefined,
          }, card.cardId === 'cling' ? 1 : 0); // a magnetized Cling stacks the improvement (via weldMagnetic)
          // A golden Magnetic still "plays" the triple when welded in — grant its Discover.
          if (card.golden) grantGoldenDiscover(s);
          return s;
        }
      }

      if (s.board.length >= CONFIG.boardMax) return state;
      s.hand.splice(i, 1);
      const to =
        action.toIndex === undefined
          ? s.board.length
          : Math.max(0, Math.min(s.board.length, action.toIndex));
      s.board.splice(to, 0, card);
      playCard(s, card);
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
        const casts = spellCasts(s, def);
        for (let n = 0; n < casts; n++) castSpell(s, { ...def, effects: option.effects }, undefined);
        s.hand.splice(hi, 1);
        s.chooseOne = undefined;
        checkTriples(s);
        return s;
      }
      const card = s.board.find((c) => c.uid === co.uid);
      if (!card) return state;
      applyChooseOne(s, card, option.effects); // the chosen Battlecry resolves now
      s.chooseOne = undefined;
      checkTriples(s);
      if (card.golden) grantGoldenDiscover(s);
      return s;
    }

    case 'battlecryTarget': {
      if (!s.pendingTarget) return state;
      const card = s.board.find((c) => c.uid === s.pendingTarget!.uid);
      const target = s.board.find((c) => c.uid === action.targetUid);
      if (!card || !target) return state; // a friendly target is required
      applyBattlecryTarget(s, card, target); // the deferred Battlecry resolves on the chosen minion
      s.pendingTarget = undefined;
      checkTriples(s);
      if (card.golden) grantGoldenDiscover(s);
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
      // Hoarder sells for a flat 2 Gold (golden 4); everything else for the base sell value (shared helper).
      if (sold) s.embers += sellValueOf(sold);
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
        if (s.embers < CONFIG.refreshCost) return state;
        spendGold(s, CONFIG.refreshCost); // gold spent → Acid / Banksly meter
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
      if (s.tier >= CONFIG.maxTier || s.embers < s.upgradeCost) return state;
      spendGold(s, s.upgradeCost);
      s.tier += 1;
      s.upgradeCost = s.tier >= CONFIG.maxTier ? 0 : (CONFIG.upgradeCost[s.tier + 1] ?? 0);
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
      // Once-per-game powers (Gild) gate on heroPowerSpent; the rest recharge each wave.
      const available = power.oncePerGame ? !s.heroPowerSpent : s.heroReady;
      if (!available) return state;
      // Powers with a Mana cost (Nadja's Mana Font) also need the Mana on hand.
      if (power.cost && s.embers < power.cost) return state;
      const card = s.board.find((c) => c.uid === action.uid);

      if (power.kind === 'gild') {
        // Oner: make a friendly board minion Golden — doubles its stats (recorded as a
        // "Gild" buff so the inspect breakdown still sums) AND flips the golden flag, which
        // doubles its effects (Deathrattles fire twice, ×N multipliers, etc.). Board only;
        // a no-op (and no charge spent) on a missing target or an already-golden minion.
        if (!card || card.golden) return state;
        addBuff(card, 'Gild', card.attack, card.health);
        card.golden = true;
      } else if (power.kind === 'replayBattlecry') {
        // Myra: re-trigger a friendly board minion's Battlecry. Board only; a no-op (no charge
        // spent) on a missing target or a minion with no Battlecry to replay.
        if (!card || !replayBattlecry(s, card)) return state;
      } else if (power.kind === 'replayEndOfTurn') {
        // Dusk: proc a friendly board minion's End of Turn now. No-op on a missing target or a
        // minion with no End-of-Turn effect.
        if (!card || !replayEndOfTurn(s, card)) return state;
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
      } else if (power.kind === 'spellAmplify' || power.kind === 'quest' || power.kind === 'collision' || power.kind === 'sellGold') {
        // Passive powers (Rohan's amplify, Drakko's quest, Cassen's Collision, Robin's Spoils) have no
        // activation — the work happens elsewhere (spell math / the buy / sell case / settleCombat). Nothing here.
        return state;
      } else if (power.kind === 'gainMaxMana') {
        // Nadja: +1 max Mana permanently, UNCAPPED (may exceed the normal cap). Untargeted — ignores
        // action.uid. Doesn't return, so the shared spend logic below charges the once-per-turn charge.
        s.maxEmbers += 1;
      } else {
        // Warden's Fortify: +Tier/+Tier (scales with Tavern Tier). Targets "a minion" — a
        // warband minion directly, or a tavern offer (the buff bakes in when it's bought).
        const amt = s.tier;
        if (card) addBuff(card, 'Fortify', amt, amt); // raises Attack → the reduce() boundary fires Hunter's onGainAttack
        else {
          const offer = s.shop.find((c) => c.uid === action.uid);
          if (!offer) return state;
          offer.atk = (offer.atk ?? 0) + amt;
          offer.hp = (offer.hp ?? 0) + amt;
        }
      }

      if (power.oncePerGame) s.heroPowerSpent = true;
      else s.heroReady = false;
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
      s.hand.push({
        uid: `b${s.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        // A discovered Undead carries the run-wide Undead Attack bonus too (undeadBuyAtk), like a buy.
        attack: def.attack + dcb.attack + undeadBuyBonus(s, def),
        health: def.health + dcb.health,
        keywords: [...def.keywords],
        golden: false,
      });
      takeFromPool(s, def.id); // a discovered copy leaves the shared pool (so selling it returns)
      // Open the next queued Discover (golden / Drakko-doubled Brian, Yazzus-multiplied Help Wanted /
      // Sprout); only clear the offer once the queue is empty. A spec whose pool is empty opens nothing
      // (offerDiscover/offerSpellDiscover leave `discover` unset) — keep draining the rest so the queue
      // never strands behind a closed Discover.
      s.discover = undefined;
      while (!s.discover && s.discoverQueue && s.discoverQueue.length > 0) {
        openDiscover(s, s.discoverQueue.shift()!);
      }
      checkTriples(s); // the discovered copy might itself complete a triple
      return s;
    }

    case 'faceOmen': {
      // An unresolved targeted Battlecry (the player ended the turn mid-pick) auto-resolves on the
      // carry — never strand a played Toxin Tender without its grant.
      if (s.pendingTarget) {
        const src = s.board.find((c) => c.uid === s.pendingTarget!.uid);
        const def = src ? CARD_INDEX[src.cardId] : undefined;
        // A tribe-restricted pick (Toxin Tender → another friendly Undead, never self) must respect it;
        // otherwise any friend works. No eligible target → the play resolves with no effect.
        const pool = def?.targetTribe ? s.board.filter((c) => c !== src && isTribe(c, def.targetTribe!)) : s.board;
        const carry = pool.length ? pool.reduce((a, b) => (b.attack > a.attack ? b : a)) : undefined;
        if (src && carry) applyBattlecryTarget(s, src, carry);
        s.pendingTarget = undefined;
      }
      // End-of-turn triggers fire first and bake into the board's stats (handoff C.5).
      applyEndOfTurn(s);
      // Resolve combat now (deterministic) but don't apply the outcome yet —
      // the UI replays the event log, then dispatches `resolveCombat`.
      // Serve a strength-matched real board from the opponent pool when one exists (getting off the
      // procedural omen blobs); otherwise fall back to the procedural threat. `nextOpponent` (which the
      // recruit-phase opponent frame previewed) makes the pick; the fallback gets its own fresh rng, so an
      // empty / no-match pool stays byte-identical to before the pool seam existed.
      const served = nextOpponent(s);
      const player: BoardMinion[] = s.board.map((b) => ({
        cardId: b.cardId,
        attack: b.attack,
        health: b.health,
        keywords: [...b.keywords],
        golden: b.golden,
        summonBonus: b.summonBonus ?? 0,
        overflowBonus: b.overflowBonus, // Flowing Monk: flat grant bonus from the triple combine
        hpGrantBonus: b.hpGrantBonus ?? 0, // Sergeant: seed the Deathrattle HP-grant accrual into combat
        ascendProgress: b.ascendProgress ?? 0, // Tara: seed the prior ascend tally so the live tracker shows the total
        sourceUid: b.uid, // so combat can carry Avenge improvements back to this card
        rallyMechAtk: b.rallyMechAtk, // Better Bot's accrued Rally (own base added at instantiate)
        resummon: b.resummon, // The Reclaimer's start-of-combat destroy + resummon mark
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
      const resolveCombatVs = (enemy: BoardMinion[], enemyTier: number): CombatResult => {
        const combat = simulate(player, enemy, makeRng(mixSeed(s.seed, s.wave, TAG.COMBAT)), CARD_INDEX, s.spellsThisTurn, s.deathrattlesTriggered, enemyTier, s.undeadAttackBonus, s.undeadHealthBonus, s.spellsCast, s.undeadBuyAtk ?? 0, s.fodderConsumedThisTurn?.attack ?? 0, s.fodderConsumedThisTurn?.health ?? 0, s.impBuff?.attack ?? 0, s.impBuff?.health ?? 0, spellAttackBonus(s), spellHealthBonus(s), s.tier, s.tribes, s.cardBuffs ?? {});
        combat.playerDamage = Math.min(combat.playerDamage, lossDamageCap(s.wave)); // round cap
        let win = 0, draw = 0, lose = 0, lossDamageTotal = 0;
        const cap = lossDamageCap(s.wave);
        const ODDS_SIMS = 1000;
        for (let i = 0; i < ODDS_SIMS; i++) {
          const r = simulate(player, enemy, makeRng(mixSeed(s.seed, s.wave, TAG.ODDS, i)), CARD_INDEX, s.spellsThisTurn, s.deathrattlesTriggered, enemyTier, s.undeadAttackBonus, s.undeadHealthBonus, s.spellsCast, s.undeadBuyAtk ?? 0, s.fodderConsumedThisTurn?.attack ?? 0, s.fodderConsumedThisTurn?.health ?? 0, s.impBuff?.attack ?? 0, s.impBuff?.health ?? 0, spellAttackBonus(s), spellHealthBonus(s), s.tier, s.tribes, s.cardBuffs ?? {});
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
      try {
        const e = served ? { enemy: opponentBoard(served), tier: served.tier ?? s.tier } : proceduralEnemy();
        s.lastCombat = resolveCombatVs(e.enemy, e.tier);
      } catch {
        const e = proceduralEnemy();
        s.lastCombat = resolveCombatVs(e.enemy, e.tier);
      }
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
  s.hand.push({
    uid: `b${s.uidSeq++}`,
    cardId: 'discoverspell',
    tribe: 'neutral',
    attack: 0,
    health: 1,
    keywords: [],
    golden: false,
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
      // Spells are never minions — they don't triple (they're cast for their effect).
      if (!c.golden && !CARD_INDEX[c.cardId]?.spell) counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
    }
    let tripleId: string | undefined;
    for (const [id, n] of counts) {
      if (n >= 3) {
        tripleId = id;
        break;
      }
    }
    if (!tripleId) return;

    // Collect the three copies being combined, with their *current* stats/keywords.
    const combined: BoardCard[] = [];
    const pull = (arr: RunState['hand']): void => {
      for (let i = arr.length - 1; i >= 0 && combined.length < 3; i--) {
        if (arr[i]!.cardId === tripleId && !arr[i]!.golden) {
          combined.push(arr[i]!);
          arr.splice(i, 1);
        }
      }
    };
    pull(s.hand); // consume from the hand first, then the board
    pull(s.board);

    // Golden = the two best copies (by total stats) stacked: their stats summed, their per-source
    // buff breakdowns merged (so the golden's inspect panel still itemizes its buffs), and the union
    // of all three's keywords. For uniform buffs / fresh triples this equals the old "top-two atk +
    // top-two hp" result; it only differs for oddly asymmetric per-copy buffs (rare), and in exchange
    // the breakdown stays consistent with the stats.
    const kept = [...combined].sort((a, b) => (b.attack + b.health) - (a.attack + a.health)).slice(0, 2);
    const goldenBuffs = mergeBuffs(kept.flatMap((c) => c.buffs ?? []));
    const keywords = [...new Set(combined.flatMap((c) => c.keywords))];
    const def = CARD_INDEX[tripleId]!;
    // A summon-buff card (Kennelmaster / Bristleback Matron) carries its accrued buff
    // through the triple: the golden's summonBonus = its base buff + the two highest
    // bonuses combined, so the granted magnitude (base + summonBonus) is the SUM of the
    // top-two copies' magnitudes — two boosted Kennelmasters at +6/+4 combine to +10, and
    // a fresh triple just doubles the base (the golden doubling falls out of the combine).
    const summonEffect = def.effects.find((e) => e.do === 'buffOnSummon');
    const improveEffect = def.effects.find((e) => e.do === 'summonBuffTribeImprove');
    let summonBonus: number | undefined;
    if (summonEffect) {
      const base = Number((summonEffect.params as { attack?: number })?.attack ?? 0);
      const sbs = combined.map((c) => c.summonBonus ?? 0).sort((a, b) => b - a);
      summonBonus = base + (sbs[0] ?? 0) + (sbs[1] ?? 0);
    } else if (improveEffect) {
      // Mama Bear: the golden picks up the accrual at its CURRENT value (the highest of the three copies) —
      // not reset, not summed/doubled. The bigger per-summon step (+6/+6) comes from gold(self) in the
      // factory, so all the triple must do is preserve where the accrual already is.
      const maxBonus = Math.max(...combined.map((c) => c.summonBonus ?? 0));
      summonBonus = maxBonus > 0 ? maxBonus : undefined;
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
    // Sergeant: the golden keeps the HIGHEST accrued Deathrattle HP-grant bonus of the three copies (not
    // summed/reset) — the bigger per-Attack step (+4) comes from gold(self) in the factory, so the triple
    // only preserves where the accrual already is.
    const hpGrantEffect = def.effects.find((e) => e.do === 'onGainAttackImproveHpGrant');
    let hpGrantBonus: number | undefined;
    if (hpGrantEffect) {
      const maxBonus = Math.max(...combined.map((c) => c.hpGrantBonus ?? 0));
      hpGrantBonus = maxBonus > 0 ? maxBonus : undefined;
    }
    // Frontdrake: keep the copy furthest into its cadence (closest to the next Dragon) — tripling a Frontdrake
    // that's about to proc keeps the "procs this turn" timing. Only the cycle position (mod every) matters,
    // so the golden inherits the max position; a fresh/just-procced set (all 0) starts a clean cycle.
    const cadenceEffect = def.effects.find((e) => e.on === 'endOfTurn' && e.do === 'endOfTurnGrantTribe');
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
    const absorbedSpellAura = combined.reduce((sum, c) => sum + (c.spellAuraBonus ?? 0), 0);
    const absorbedFodderAura = combined.reduce(
      (sum, c) => ({ attack: sum.attack + (c.fodderAuraBonus?.attack ?? 0), health: sum.health + (c.fodderAuraBonus?.health ?? 0) }),
      { attack: 0, health: 0 },
    );
    // Spirit Pup: the golden keeps the *highest* spell progress of the three (= the lowest spells-left),
    // so a 2-left + 8-left + 5-left triple needs only 2 more spells to evolve.
    const goldenProgress = Math.max(...combined.map((c) => c.spellProgress ?? 0));
    // Tara: the golden keeps the *highest* ascend progress of the three (= the lowest "to go"), so tripling a
    // Tara that's close to ascending doesn't reset it back to 20-to-go.
    const goldenAscend = def.ascendAt ? Math.max(...combined.map((c) => c.ascendProgress ?? 0)) : 0;
    // Hoarder: the golden keeps the EARLIEST (minimum) boughtWave of the three, so a golden Hoarder
    // inherits the oldest copy's age → its highest sell value as the starting point (sell =
    // (wave - boughtWave + 1) × 2 golden). Generic — harmless on cards that don't read it — but Hoarder
    // is the one that matters. Copies with no boughtWave (not from a buy) are ignored; undefined if none had one.
    const boughtWaves = combined.map((c) => c.boughtWave).filter((w): w is number => w !== undefined);
    const goldenBoughtWave = boughtWaves.length > 0 ? Math.min(...boughtWaves) : undefined;
    s.hand.push({
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
      spellAuraBonus: absorbedSpellAura > 0 ? absorbedSpellAura : undefined,
      fodderAuraBonus: absorbedFodderAura.attack > 0 || absorbedFodderAura.health > 0 ? absorbedFodderAura : undefined,
      buffs: goldenBuffs.length > 0 ? goldenBuffs : undefined,
      spellProgress: goldenProgress > 0 ? goldenProgress : undefined,
      ascendProgress: goldenAscend > 0 ? goldenAscend : undefined,
      boughtWave: goldenBoughtWave,
      eotTick: goldenEotTick,
    });
    s.triplesMade++; // run-wide tally — surfaced as opponent intel in board snapshots
    // The Discover isn't granted now — it comes from a spell when the golden is played.
  }
}

/** Apply a resolved combat's outcome and advance to the next wave — or end the run. */
function settleCombat(s: RunState, result: CombatResult): void {
  // Record this wave's result for the end-screen W-L-W summary (every combat, win or lose).
  s.history.push(result.result);
  // Attribute this combat's player damage + mechanic procs into the run-wide tallies (→ MVP + most-triggered).
  accumulateContribution((s.runDamage ??= {}), (s.runProcs ??= {}), tallyCombat(result));
  // Accumulate this combat's player Deathrattles into the run-wide "this game" count (Grim scales off it).
  s.deathrattlesTriggered += result.playerDeathrattles;
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
      if (card) addBuff(card, engraved ? 'Engraved' : 'Flowing Monk', attack, health);
    }
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
        attack: def.attack + cb.attack + undeadBuyBonus(s, def),
        health: def.health + cb.health,
        keywords: [...def.keywords],
        golden: false,
      });
      takeFromPool(s, cardId);
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
  // Gryphon: free shop rerolls banked from taking damage in combat.
  if (result.playerFreeRolls) {
    s.freeRolls += result.playerFreeRolls;
  }
  // Taragosa: spells cast IN combat permanently bump the run's spellsCast — so they count toward
  // spell-count payoffs (Archmagus Guel's improvement) just like tavern spells.
  if (result.playerSpellsCast) {
    s.spellsCast += result.playerSpellsCast;
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
  // next fight (consuming again re-arms it).
  for (const c of s.board) {
    if (c.tempShield) {
      c.keywords = c.keywords.filter((k) => k !== 'DS');
      c.tempShield = false;
    }
  }
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
  s.embers = s.maxEmbers + boardManaBonus(s) + (s.bonusEmbersNextTurn ?? 0);
  s.bonusEmbersNextTurn = 0;
  s.heroReady = true;
  // Pin the opponent match to the board you START the turn with, so it won't shift as you shop today.
  s.turnStartPower = s.board.reduce((sum, b) => sum + b.attack + b.health, 0);
  s.spellsThisTurn = 0; // Spirit Worgen's per-turn spell scaling resets each wave
  s.extraEotThisTurn = false; // Chrono Staff's one-shot End-of-Turn extra is per-turn
  s.fodderConsumedThisTurn = { attack: 0, health: 0 }; // Abhorrent Horror's SoC window resets each wave
  for (const c of s.board) {
    c.resummon = false; // The Reclaimer's mark is a per-turn choice
  }
  if (s.tier < CONFIG.maxTier) {
    s.upgradeCost = Math.max(CONFIG.upgradeCostFloor, s.upgradeCost - CONFIG.upgradeDiscountPerWave);
  }
  const previous = s.threat;
  s.threat = selectThreat(s.wave, makeRng(mixSeed(s.seed, s.wave, TAG.THREAT)), previous);

  // A frozen tavern carries over, but still tops up any empty minion slots / missing spell
  // (freezing a partial shop shouldn't leave you with fewer options); otherwise full reroll.
  // Either way, queued Fodder (Soulfeeder) still gets injected — freezing must not strand the
  // promised Fodder in `pendingTavern` forever.
  if (s.frozen) {
    topUpTavern(s);
    injectPendingTavern(s);
    s.frozen = false;
  } else refreshTavern(s);
  s.phase = 'recruit';
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
        attack: def.attack + cb.attack + undeadBuyBonus(s, def),
        health: def.health + cb.health,
        keywords: [...def.keywords],
        golden: false,
      });
      // Signal the UI to fly the new token in from the hero portrait (one-shot, like fodderEatenSeq).
      s.chaosGrantSeq = (s.chaosGrantSeq ?? 0) + 1;
      s.chaosGrantUid = grantUid;
    }
  }
  // Triples can be completed by a combat carry-back that lands a 3rd copy in the hand (e.g. a
  // Deathrattle-granted minion) AFTER the last recruit action that would have checked. Every other
  // path checks on the mutation; this is the one entry the player never triggers, so check once here
  // as the shop opens. Idempotent + loop-guarded, and the only settle/advance-path call (no double-Discover).
  // No hand overflow here: a shop-start triple always includes ≥1 hand-granted copy (3 board copies would
  // have tripled back in recruit), and checkTriples pulls from the hand first — removing it offsets the
  // golden it pushes back, so the hand never grows past the cap.
  checkTriples(s);
}

/**
 * Refresh the tavern: roll new offers, inject any Fodder queued for the next tavern
 * (Soulfeeder), then let your Demons devour Fodder that just entered. Both the manual
 * Refresh and the post-combat refresh route through here, so anything that interacts
 * with "tavern refresh" hooks in one place.
 */
function refreshTavern(s: RunState): void {
  rollShop(s);
  // Apples (Choose One → "the next shop"): fold the banked buff onto the freshly-rolled offers, then clear it.
  const nb = s.nextShopBuff;
  if (nb && (nb.attack || nb.health)) {
    for (const offer of s.shop) {
      offer.atk = (offer.atk ?? 0) + nb.attack;
      offer.hp = (offer.hp ?? 0) + nb.health;
    }
    s.nextShopBuff = undefined;
  }
  injectPendingTavern(s);
}

/**
 * Inject any Fodder queued for this tavern (Soulfeeder) into the shop, then let Demons devour what
 * just arrived. Runs for both a fresh reroll and a frozen carry-over, so a queued Fred always
 * arrives (and is consumed) exactly once rather than being stranded in `pendingTavern`.
 */
function injectPendingTavern(s: RunState): void {
  const pending = s.pendingTavern ?? [];
  s.pendingTavern = []; // always cleared — Fodder is never stored; with no Demon to eat it, it's wasted
  if (pending.length === 0) return;
  // Only bring queued Fodder out if a Demon is on the board to consume it — otherwise it would just
  // clutter the tavern with un-buyable garbage, so it goes to waste instead (handoff: no Fodder storage).
  if (!s.board.some((c) => isTribe(c, 'demon'))) return; // dual-types (Bane = Dragon/Demon) count as Demons
  for (const id of pending) {
    if (CARD_INDEX[id]) s.shop.push({ uid: `s${s.uidSeq++}`, cardId: id });
  }
  consumeTavernFodder(s); // the Demons eat the Fodder that just arrived
}
