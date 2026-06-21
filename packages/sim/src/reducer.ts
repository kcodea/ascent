import { makeRng, simulate, type BoardMinion, type CombatResult, type Tribe } from '@game/core';
import { BUYABLE_CARDS, CARD_INDEX } from '@game/content';
import { CONFIG } from './config';
import { rollShop, topUpTavern, returnToPool, takeFromPool } from './shop';
import { getHero } from './heroes';
import { buildEnemyBoard, selectThreat } from './threats';
import { pickOpponent, opponentBoard } from './opponents';
import { addBuff, applyBattlecryTarget, applyChooseOne, applyEndOfTurn, applyOnBuy, boardManaBonus, cardBuff, castSpell, consumeTavernFodder, playCard, replayBattlecry, replayEndOfTurn, syncLifebinders, weldMagnetic } from './recruit';
import { mixSeed, TAG, type Action, type BoardCard, type CardBuff, type RunState } from './state';

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
  const mag: Tribe[] = [m.tribe, m.tribe2].filter((x): x is Tribe => !!x);
  const tgt: Tribe[] = [t.tribe, t.tribe2].filter((x): x is Tribe => !!x);
  return mag.some((x) => tgt.includes(x));
}

/**
 * The run-loop state machine as a pure reducer: `(state, action) => state`
 * (handoff C.6). Never mutates its input — returns the same reference for a
 * no-op (invalid action) and a fresh state for a real transition.
 *
 * Recruit-phase card effects (Battlecries, buff-on-summon-on-buy) are not wired
 * yet — minions enter the board at their base stats. That's the next increment;
 * the combat-time effect system already works (see `@game/core`).
 */
export function reduce(state: RunState, action: Action): RunState {
  const next = reduceCore(state, action);
  // Corrupted Lifebinder mirrors its linked demon's recruit gains — re-sync after any state change
  // (idempotent when nothing moved). Combat-time mirroring happens inside `simulate`.
  if (next !== state) syncLifebinders(next);
  return next;
}

function reduceCore(state: RunState, action: Action): RunState {
  // A finished run (loss or victory) takes no more actions — restart goes through the store.
  if (state.phase === 'gameover' || state.phase === 'victory') return state;
  const s: RunState = structuredClone(state);

  // Recruit actions apply only in the recruit phase; `resolveCombat` only in combat.
  if (s.phase !== 'recruit' && action.type !== 'resolveCombat') return state;

  switch (action.type) {
    case 'buy': {
      // The right-hand spell slot: pays its own (modifiable) cost, into the hand.
      // No triple / buy-trigger — a spell isn't a minion.
      if (s.spell && s.spell.uid === action.uid) {
        const spellDef = CARD_INDEX[s.spell.cardId];
        if (!spellDef) return state;
        const cost = Math.max(0, (spellDef.cost ?? 0) - s.spellCostMod);
        if (s.embers < cost || s.hand.length >= CONFIG.handMax) return state;
        s.embers -= cost;
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
      if (i < 0 || s.embers < CONFIG.minionCost || s.hand.length >= CONFIG.handMax) return state;
      const offer = s.shop[i]!;
      const card = CARD_INDEX[offer.cardId];
      if (!card) return state;
      s.shop.splice(i, 1);
      s.embers -= CONFIG.minionCost;
      const cb = cardBuff(s, card.id); // persistent run buff (Ritualist's Fodder enchantment)
      const bought: BoardCard = {
        uid: `b${s.uidSeq++}`,
        cardId: card.id,
        tribe: card.tribe,
        // base + the persistent run buff (Ritualist's Fodder enchantment, baked at instantiation)
        attack: card.attack + cb.attack,
        health: card.health + cb.health,
        keywords: [...card.keywords, ...(offer.keywords ?? []).filter((k) => !card.keywords.includes(k))],
        golden: false,
      };
      // a tavern buff (the hero power Fortify applied to this offer) rides in as a tracked buff
      addBuff(bought, 'Fortify', offer.atk ?? 0, offer.hp ?? 0);
      s.hand.push(bought); // buy → hand (Battlegrounds flow)
      applyOnBuy(s, bought); // buy-triggers (Broker) bake in now (handoff C.5)
      checkTriples(s); // a 3rd copy combines into a golden + grants a Discover
      return s;
    }

    case 'play': {
      // hand → board (Battlegrounds: play to trigger summon-buffs + Battlecry)
      const i = s.hand.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const card = s.hand[i]!;

      // A Discover spell isn't a minion: playing it opens the Discover (a peek one
      // tier up) and is consumed — no board slot.
      if (card.cardId === 'discoverspell') {
        s.hand.splice(i, 1);
        offerDiscover(s, s.tier);
        return s;
      }

      // Other spells: cast on the chosen target, then consume — no board slot.
      const def = CARD_INDEX[card.cardId];
      if (def?.spell) {
        let target: BoardCard | undefined;
        if (def.target === 'friendly') {
          target = s.board.find((c) => c.uid === action.targetUid);
          if (!target) return state; // a friendly target is required to cast
        }
        castSpell(s, def, target);
        s.hand.splice(i, 1);
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
          });
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
      // Targeted Battlecry (Toxin Tender / Lifebinder): pause for the player to pick the friendly target
      // (resolved in `battlecryTarget`) — but only if a *viable* target exists. A tribe-restricted pick
      // (Lifebinder → a friendly Demon, never self) needs a matching friend; with none, the Battlecry
      // simply doesn't fire and the minion plays as-is (no prompt). An unrestricted pick (Toxin Tender)
      // can always target a friend (itself included), so it always has one.
      const playedDef = CARD_INDEX[card.cardId];
      if (playedDef?.target === 'friendly') {
        const hasTarget = playedDef.targetTribe
          ? s.board.some((c) => c.uid !== card.uid && c.tribe === playedDef.targetTribe)
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
      const card = s.board.find((c) => c.uid === s.chooseOne!.uid);
      const option = CARD_INDEX[s.chooseOne.cardId]?.chooseOne?.[action.index];
      if (!card || !option) return state;
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
      s.embers += CONFIG.sellValue; // embers are uncapped within a turn (no max-embers ceiling)
      // Return the copies to the shared pool (a golden ate three). Tokens aren't pooled → ignored.
      if (sold) returnToPool(s, sold.cardId, sold.golden ? 3 : 1);
      return s;
    }

    case 'roll': {
      if (s.embers < CONFIG.refreshCost) return state;
      s.embers -= CONFIG.refreshCost;
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
      s.embers -= s.upgradeCost;
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

    case 'heroPower': {
      const power = getHero(s.heroId).power;
      // Some powers unlock on a later turn (Myra's Encore — turn 3); locked before then.
      if (s.wave < (power.unlockWave ?? 1)) return state;
      // Once-per-game powers (Gild) gate on heroPowerSpent; the rest recharge each wave.
      const available = power.oncePerGame ? !s.heroPowerSpent : s.heroReady;
      if (!available) return state;
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
      } else if (power.kind === 'spellAmplify') {
        // The Spellbinder's power is passive (no activation) — nothing to do on a heroPower action.
        return state;
      } else {
        // Warden's Fortify: +Tier/+Tier (scales with Tavern Tier). Targets "a minion" — a
        // warband minion directly, or a tavern offer (the buff bakes in when it's bought).
        const amt = s.tier;
        if (card) addBuff(card, 'Fortify', amt, amt);
        else {
          const offer = s.shop.find((c) => c.uid === action.uid);
          if (!offer) return state;
          offer.atk = (offer.atk ?? 0) + amt;
          offer.hp = (offer.hp ?? 0) + amt;
        }
      }

      if (power.oncePerGame) s.heroPowerSpent = true;
      else s.heroReady = false;
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
        attack: def.attack + dcb.attack,
        health: def.health + dcb.health,
        keywords: [...def.keywords],
        golden: false,
      });
      takeFromPool(s, def.id); // a discovered copy leaves the shared pool (so selling it returns)
      s.discover = undefined;
      checkTriples(s); // the discovered copy might itself complete a triple
      return s;
    }

    case 'faceOmen': {
      // An unresolved targeted Battlecry (the player ended the turn mid-pick) auto-resolves on the
      // carry — never strand a played Toxin Tender without its grant.
      if (s.pendingTarget) {
        const src = s.board.find((c) => c.uid === s.pendingTarget!.uid);
        const def = src ? CARD_INDEX[src.cardId] : undefined;
        // A tribe-restricted pick (Lifebinder → a friendly Demon, never self) must respect it; otherwise
        // any friend works (Toxin Tender). No eligible target → the play resolves with no effect.
        const pool = def?.targetTribe ? s.board.filter((c) => c !== src && c.tribe === def.targetTribe) : s.board;
        const carry = pool.length ? pool.reduce((a, b) => (b.attack > a.attack ? b : a)) : undefined;
        if (src && carry) applyBattlecryTarget(s, src, carry);
        s.pendingTarget = undefined;
      }
      // End-of-turn triggers fire first and bake into the board's stats (handoff C.5).
      applyEndOfTurn(s);
      // Mirror any End-of-Turn gains onto Corrupted Lifebinders *now*, before the combat snapshot —
      // otherwise a Lifebinder bound to a minion the EoT just buffed (e.g. Combinator → a Mech) would
      // enter the fight without the gain and only catch up at the next turn's reduce.
      syncLifebinders(s);
      // Resolve combat now (deterministic) but don't apply the outcome yet —
      // the UI replays the event log, then dispatches `resolveCombat`.
      // Serve a strength-matched real board from the opponent pool when one exists (M3 step 4 — getting
      // off the procedural omen blobs); otherwise fall back to the procedural threat. pickOpponent consumes
      // the rng only when it actually serves, so an empty / no-match pool keeps the fallback byte-identical.
      const enemyRng = makeRng(mixSeed(s.seed, s.wave, TAG.ENEMY));
      const playerPower = s.board.reduce((sum, b) => sum + b.attack + b.health, 0);
      const served = pickOpponent(s.wave, playerPower, enemyRng);
      const enemy = served ? opponentBoard(served) : buildEnemyBoard(s.threat, s.wave, enemyRng);
      const player: BoardMinion[] = s.board.map((b) => ({
        cardId: b.cardId,
        attack: b.attack,
        health: b.health,
        keywords: [...b.keywords],
        golden: b.golden,
        summonBonus: b.summonBonus ?? 0,
        sourceUid: b.uid, // so combat can carry Avenge improvements back to this card
        linkUid: b.linkUid, // Corrupted Lifebinder mirrors its linked demon in combat too
        resummon: b.resummon, // The Reclaimer's start-of-combat destroy + resummon mark
      }));
      s.lastCombat = simulate(player, enemy, makeRng(mixSeed(s.seed, s.wave, TAG.COMBAT)), CARD_INDEX, s.spellsThisTurn);
      // Outcome odds: re-simulate the same two boards on independent seeds for a win/draw/loss estimate.
      // Combat is a cheap pure function on ~14 units, so 1000 sims cost ~1ms warm (a few ms for a long
      // grindy fight) and run once per fight. Seeds are derived from the run seed (a separate ODDS
      // stream), so the odds are reproducible and don't disturb the real combat RNG. ~1000 sims keeps
      // the margin of error to ~±1.5%; the actual result above is one such roll.
      let win = 0, draw = 0, lose = 0;
      const ODDS_SIMS = 1000;
      for (let i = 0; i < ODDS_SIMS; i++) {
        const r = simulate(player, enemy, makeRng(mixSeed(s.seed, s.wave, TAG.ODDS, i)), CARD_INDEX, s.spellsThisTurn).result;
        if (r === 'win') win++;
        else if (r === 'draw') draw++;
        else lose++;
      }
      s.lastCombat.odds = { win: win / ODDS_SIMS, draw: draw / ODDS_SIMS, lose: lose / ODDS_SIMS };
      s.phase = 'combat';
      return s;
    }

    case 'resolveCombat': {
      if (s.phase !== 'combat' || !s.lastCombat) return state;
      advanceAfterCombat(s, s.lastCombat);
      // Maw of the Pit's one-combat Divine Shield is spent — strip the temp DS so it doesn't carry to
      // the next fight (consuming again re-arms it).
      for (const c of s.board) {
        if (c.tempShield) {
          c.keywords = c.keywords.filter((k) => k !== 'DS');
          c.tempShield = false;
        }
      }
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
    let summonBonus: number | undefined;
    if (summonEffect) {
      const base = Number((summonEffect.params as { attack?: number })?.attack ?? 0);
      const sbs = combined.map((c) => c.summonBonus ?? 0).sort((a, b) => b - a);
      summonBonus = base + (sbs[0] ?? 0) + (sbs[1] ?? 0);
    }
    // Absorbed mana-per-turn (a Money Bot magnetized into one of the copies) carries through the
    // triple so the income survives (the golden's own def.manaPerTurn handles the un-merged case).
    const absorbedMana = combined.reduce((sum, c) => sum + (c.manaBonus ?? 0), 0);
    s.hand.push({
      uid: `b${s.uidSeq++}`,
      cardId: def.id,
      tribe: def.tribe,
      attack: kept.reduce((sum, c) => sum + c.attack, 0),
      health: kept.reduce((sum, c) => sum + c.health, 0),
      keywords,
      golden: true,
      summonBonus,
      manaBonus: absorbedMana > 0 ? absorbedMana : undefined,
      buffs: goldenBuffs.length > 0 ? goldenBuffs : undefined,
    });
    // The Discover isn't granted now — it comes from a spell when the golden is played.
  }
}

/** A triple grants a Discover: 3 distinct cards from one tier up (capped at maxTier). */
function offerDiscover(s: RunState, tripleTier: number): void {
  const target = Math.min(CONFIG.maxTier, tripleTier + 1);
  let floor = target;
  let pool: typeof BUYABLE_CARDS = [];
  while (pool.length < 3 && floor >= 1) {
    pool = BUYABLE_CARDS.filter(
      (c) =>
        c.tier <= target &&
        c.tier >= floor &&
        (c.tribe === 'neutral' || s.tribes.includes(c.tribe)),
    );
    floor--;
  }
  if (pool.length === 0) return;
  const rng = makeRng(s.rngCursor);
  const avail = [...pool];
  const picks: string[] = [];
  for (let i = 0; i < 3 && avail.length > 0; i++) {
    picks.push(avail.splice(rng.int(avail.length), 1)[0]!.id);
  }
  s.rngCursor = rng.state();
  s.discover = picks;
}

/** Apply a resolved combat's outcome and advance to the next wave — or end the run. */
function advanceAfterCombat(s: RunState, result: CombatResult): void {
  // Record this wave's result for the end-screen W-L-W summary (every combat, win or lose).
  s.history.push(result.result);
  // Persist per-instance combat state (Kennelmaster's Avenge permanently improves its
  // summon buff for the rest of the run), keyed back to the originating board card.
  if (result.playerSummonBonus) {
    for (const { sourceUid, bonus } of result.playerSummonBonus) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (card) card.summonBonus = bonus;
    }
  }
  // Flowing Monk's mid-combat +X/+X gifts are permanent — apply them to the run board (recorded as a
  // buff so the inspect view shows the source), win or lose.
  if (result.playerPermaBuffs) {
    for (const { sourceUid, attack, health } of result.playerPermaBuffs) {
      const card = s.board.find((c) => c.uid === sourceUid);
      // Engraved minions keep their own combat gains; a non-Engraved carrier got a permanent gift (Monk).
      if (card) addBuff(card, card.keywords.includes('EG') ? 'Engraved' : 'Flowing Monk', attack, health);
    }
  }
  // Deathrattle-granted cards (Arcane Weaver → a Spirit Fire copy) land in the hand for
  // the next recruit, win or lose — capped by the hand limit.
  if (result.playerHandGrants) {
    for (const cardId of result.playerHandGrants) {
      const def = CARD_INDEX[cardId];
      if (!def || s.hand.length >= CONFIG.handMax) continue;
      s.hand.push({
        uid: `b${s.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        attack: def.attack,
        health: def.health,
        keywords: [...def.keywords],
        golden: false,
      });
    }
  }
  if (result.result === 'lose') s.resolve = Math.max(0, s.resolve - result.playerDamage);

  if (s.resolve <= 0) {
    s.best = Math.max(s.best, s.wave);
    s.phase = 'gameover';
    return;
  }

  // PvE win condition (current iteration): survive the final wave → the run ends in victory
  // (don't advance past it). `s.wave` is still the wave just fought here.
  if (s.wave >= CONFIG.maxWave) {
    s.best = Math.max(s.best, s.wave);
    s.phase = 'victory';
    return;
  }

  // Advance to the next wave (handoff A.1 step 5).
  s.wave += 1;
  s.best = Math.max(s.best, s.wave);
  s.maxEmbers = Math.min(CONFIG.embersCap, s.maxEmbers + CONFIG.embersPerWave);
  // Money Bot & co. raise the effective max above the base curve while on the board — added on
  // top of the cap (a deliberate economy card), recomputed each turn so selling it removes it.
  s.embers = s.maxEmbers + boardManaBonus(s);
  s.heroReady = true;
  s.spellsThisTurn = 0; // Spirit Worgen's per-turn spell scaling resets each wave
  for (const c of s.board) c.resummon = false; // The Reclaimer's mark is a per-turn choice
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
}

/**
 * Refresh the tavern: roll new offers, inject any Fodder queued for the next tavern
 * (Soulfeeder), then let your Demons devour Fodder that just entered. Both the manual
 * Refresh and the post-combat refresh route through here, so anything that interacts
 * with "tavern refresh" hooks in one place.
 */
function refreshTavern(s: RunState): void {
  rollShop(s);
  injectPendingTavern(s);
}

/**
 * Inject any Fodder queued for this tavern (Soulfeeder) into the shop, then let Demons devour what
 * just arrived. Runs for both a fresh reroll and a frozen carry-over, so a queued Fred always
 * arrives (and is consumed) exactly once rather than being stranded in `pendingTavern`.
 */
function injectPendingTavern(s: RunState): void {
  const pending = s.pendingTavern ?? [];
  if (pending.length === 0) return;
  for (const id of pending) {
    if (CARD_INDEX[id]) s.shop.push({ uid: `s${s.uidSeq++}`, cardId: id });
  }
  s.pendingTavern = [];
  consumeTavernFodder(s); // Demons present? they eat the Fodder that just arrived
}
