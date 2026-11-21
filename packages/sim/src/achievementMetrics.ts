import { isEchoEffect } from '@game/core'; // what counts as an Echo (R-ECHO-WATCHER-01)
import { ALE_IDS, SPECIAL_RUBY_IDS, type CombatResult, type Tribe } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNE_INDEX } from '@game/content';
import type { RunMetric } from '@game/progression';
import { isShopDamageRow, type Action, type BoardCard, type RunState } from './state';
import { defIsTribe, isTribe, offerBuyStats } from './recruit';
import { offerBuyPrice } from './reducer';
import { CONFIG } from './config';

/**
 * ACHIEVEMENT RUN METRICS (achievements batch 1, 2026-09-28): the counters behind `ProgressionRunFactsV2.metrics`.
 *
 * Counted by the SAME observer the balance derivation uses (`observeAction` in runDerive.ts), at three hooks:
 *   - `observeAchAction`: every dispatched action, from the (before, action, after) pair. Per-turn values are the
 *     RunState's own per-turn tallies (`goldSpentThisTurn`, `rubyCastsThisTurn`, `alesCastThisTurn`,
 *     `spellsThisTurn`, `shoutFiresThisTurn`, …), read as a running MAXIMUM: each resets at the turn flip, so the
 *     largest value ever observed IS the best turn. The few the RunState does not keep (refreshes, plays, buys from
 *     a frozen Shop, consumes) are kept here per turn.
 *   - `observeAchCombat`: once per fought combat, reading `lastCombat.events` (pure log reads, the same rules the
 *     Contribution tally uses: an Echo is the death of a friendly body whose card has an onDeath effect).
 *   - `finalAchMetrics`: the run's final state (the final board, owned runes, rune payouts, lifetime counters).
 *
 * Plain JSON (it rides in the save with the rest of `DeriveState`), and cheap: O(board + shop) per action.
 * Facts, not rewards: the server's catalog decides what any of it is worth.
 */
export interface AchTally {
  /** The running metric values (maxima, flags, sums). */
  m: Partial<Record<RunMetric, number>>;
  /** Per-turn counters the RunState does not keep, reset at the turn flip. */
  rollsThisTurn: number;
  playsThisTurn: number;
  frozenBuysThisTurn: number;
  consumesThisTurn: number;
  /** The Shop as it stood while frozen (uids) and the wave it was frozen on: a buy of one of these on the NEXT wave
   *  is a buy "from a Shop you froze last turn". */
  frozenUids: string[];
  frozenWave: number;
  /** Special Rubies played on a Kobold, and Dwarven Ales played, this game (distinct ids). */
  facets: string[];
  aleKinds: string[];
  /** An Epic Rune was just forged for a tribe with 3+ minions on the board: the next combat decides `epicFitWin`. */
  epicFitPending: boolean;
  /** Achievements 150 (2026-10-03): the current run of combat wins, combats fought, and whether one was lost.
   *  Optional: a tally saved before these existed reads them as 0 / false. */
  winStreak?: number;
  combatsFought?: number;
  lostCombat?: boolean;
  /** SECRET TITLES (2026-11-20). All optional: a tally saved before these existed reads them as empty. */
  /** Shop refreshes this game (any refresh, free ones too). */
  rollsTotal?: number;
  /** The highest Shop Tier reached, and the round Tier 6 was first reached (absent: never). */
  maxTier?: number;
  tierSixWave?: number;
  /** The current run of turns ended on exactly 0 Gold. */
  zeroGoldStreak?: number;
  /** Turns from round 5 on that ended with a full hand, and whether one ended without. */
  fullHandTurns?: number;
  fullHandBroken?: boolean;
  /** Rounds with 7 Spirits on the board at once (distinct). */
  spiritWaves?: number[];
  /** The current run of lobby rounds with a knockout, and the last such round. */
  koStreak?: number;
  koLastRound?: number;
  /** Your LAST fought lobby encounter knocked its opponent out with exactly lethal damage. */
  lastFightExact?: boolean;
  /** Combats won this game. */
  combatsWon?: number;
  /** Rounds with 7 Undead on the board at once (distinct; secret titles v2). */
  undeadWaves?: number[];
}

export const emptyAchTally = (): AchTally => ({
  m: {}, rollsThisTurn: 0, playsThisTurn: 0, frozenBuysThisTurn: 0, consumesThisTurn: 0, frozenUids: [], frozenWave: -1,
  facets: [], aleKinds: [], epicFitPending: false,
});

const bump = (t: AchTally, k: RunMetric, v: number): void => {
  if (Number.isFinite(v) && v > (t.m[k] ?? 0)) t.m[k] = Math.floor(v);
};
const add = (t: AchTally, k: RunMetric, v: number): void => {
  if (Number.isFinite(v) && v > 0) t.m[k] = (t.m[k] ?? 0) + Math.floor(v);
};
const countTribe = (board: readonly BoardCard[], tribe: Tribe): number => board.reduce((n, c) => n + (isTribe(c, tribe) ? 1 : 0), 0);
const EPIC_RUNE_IDS = new Set(EPIC_RUNES.map((r) => r.id));

/** Fold one dispatched action. `boughtThisTurn` is the observer's own per-turn buy count (after this action). */
export function observeAchAction(t: AchTally, before: RunState, action: Action, after: RunState, boughtThisTurn: number): void {
  const sameTurn = after.wave === before.wave;
  if (!sameTurn) {
    t.rollsThisTurn = 0; t.playsThisTurn = 0; t.frozenBuysThisTurn = 0; t.consumesThisTurn = 0;
  }

  // ── Hero power uses (an accepted action: the reducer returns the same state for a refused one).
  if (action.type === 'heroPower' && after !== before) add(t, 'heroPowerUses', 1);
  // ── On the brink: Health at 5 or less while still alive (achievements 150, 2026-10-03).
  if (after.resolve > 0 && after.resolve <= 5) bump(t, 'brink', 1);

  // ── Shop actions the RunState does not tally per turn.
  if (action.type === 'roll' && sameTurn) bump(t, 'refreshesTurnMax', ++t.rollsThisTurn);
  if (action.type === 'buy') {
    bump(t, 'buysTurnMax', boughtThisTurn);
    if (before.wave === t.frozenWave + 1 && t.frozenUids.includes(action.uid)) bump(t, 'frozenBuysTurnMax', ++t.frozenBuysThisTurn);
  }
  const played = playedCard(before, action, after);
  if (played) {
    bump(t, 'playsTurnMax', ++t.playsThisTurn);
    if (ALE_IDS.includes(played.cardId) && (after.alesCastThisTurn ?? 0) > (before.alesCastThisTurn ?? 0) && !t.aleKinds.includes(played.cardId)) {
      t.aleKinds.push(played.cardId);
      bump(t, 'aleKinds', t.aleKinds.length);
    }
    if (SPECIAL_RUBY_IDS.includes(played.cardId) && (after.rubyCastsThisTurn ?? 0) > (before.rubyCastsThisTurn ?? 0)) {
      const target = before.board.find((c) => c.uid === played.targetUid);
      if (target && isTribe(target, 'kobold') && !t.facets.includes(played.cardId)) {
        t.facets.push(played.cardId);
        bump(t, 'rubyFacetsOnKobolds', t.facets.length);
      }
    }
  }
  // The Shop as frozen (kept fresh while it stays frozen this turn; unfreezing clears it).
  if (sameTurn && after.frozen) { t.frozenUids = (after.shop ?? []).map((o) => o.uid); t.frozenWave = after.wave; }
  else if (sameTurn && !after.frozen && action.type === 'freeze') { t.frozenUids = []; t.frozenWave = -1; }

  // ── Per-turn RunState tallies, read as running maxima.
  const gold = after.goldSpentThisTurn ?? 0;
  const rubies = after.rubyCastsThisTurn ?? 0;
  const ales = after.alesCastThisTurn ?? 0;
  const spells = after.spellsThisTurn ?? 0;
  const shouts = after.shoutFiresThisTurn ?? 0;
  bump(t, 'goldSpentTurnMax', gold);
  bump(t, 'sellsTurnMax', after.soldThisTurn?.length ?? 0);
  bump(t, 'rubyPlaysTurnMax', rubies);
  bump(t, 'alesTurnMax', ales);
  bump(t, 'spellsTurnMax', spells);
  bump(t, 'shoutsTurnMax', shouts);
  bump(t, 'arcaneFacetsTurnMax', rubies + spells);
  bump(t, 'eotFiresMax', after.lastEotFires ?? 0);
  if (sameTurn) {
    add(t, 'rubyPlays', rubies - (before.rubyCastsThisTurn ?? 0));
    add(t, 'alesCast', ales - (before.alesCastThisTurn ?? 0));
  }
  const dwarves = countTribe(after.board, 'dwarf');
  const dragons = countTribe(after.board, 'dragon');
  if (dwarves >= 2) bump(t, 'dwarfPayrollTurnMax', gold);
  if (dragons >= 3) bump(t, 'dragonShoutsTurnMax', shouts);
  if (gold >= 20 && rubies >= 8 && dwarves >= 1 && countTribe(after.board, 'kobold') >= 1) bump(t, 'mountainbond', 1);
  if (spells >= 10 && ales >= 4 && dragons >= 1 && dwarves >= 1) bump(t, 'liquidCourage', 1);

  observeSecretAction(t, before, action, after, sameTurn);

  // ── Run-wide strengths.
  if (after.tier >= 6 && after.wave <= 9) bump(t, 'tierSixByRound9', 1);
  bump(t, 'gildsMade', after.triplesMade ?? 0);
  bump(t, 'gildedOnBoardMax', after.board.reduce((n, c) => n + (c.golden ? 1 : 0), 0));
  if (after.rubyBonus) bump(t, 'rubyStrength', Math.min(after.rubyBonus.attack, after.rubyBonus.health));
  if (after.spellBonus) bump(t, 'spellPower', Math.max(after.spellBonus.attack, after.spellBonus.health));
  if (after.impBuff) bump(t, 'impBuff', Math.min(after.impBuff.attack, after.impBuff.health));

  // ── Consumes: the lifetime meter's growth, and (when the vanished offers account for it exactly) their size.
  const eaten = (after.shopMinionsEaten ?? 0) - (before.shopMinionsEaten ?? 0);
  if (eaten > 0 && sameTurn) {
    bump(t, 'consumesTurnMax', (t.consumesThisTurn += eaten));
    if (played?.cardId === 'dark-ruby') add(t, 'darkRubyConsumes', eaten);
    const kept = new Set((after.shop ?? []).map((o) => o.uid));
    const boughtUid = action.type === 'buy' ? action.uid : null;
    const gone = (before.shop ?? []).filter((o) => !kept.has(o.uid) && o.uid !== boughtUid && !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby);
    if (gone.length === eaten) for (const o of gone) { const s = offerBuyStats(before, o); bump(t, 'consumedStatsMax', s.attack + s.health); }
  }

  // ── Runes forged (a new id in `ownedRunes`).
  if (action.type === 'buyRune') {
    const had = new Set(before.ownedRunes ?? []);
    for (const id of after.ownedRunes ?? []) {
      if (had.has(id)) continue;
      if (EPIC_RUNE_IDS.has(id)) {
        add(t, 'epicRunesForged', 1);
        const tribes = RUNE_INDEX[id]?.tribes ?? [];
        if (tribes.some((tr) => countTribe(after.board, tr as Tribe) >= 3)) t.epicFitPending = true;
      } else {
        add(t, 'basicRunesForged', 1);
      }
    }
  }
}

/** The tribe batch (2026-11-20): the tribes with a title theme, and their per-tribe metrics. Mech has no theme. */
const SECRET_TRIBES: readonly Tribe[] = ['dwarf', 'demon', 'spirit', 'dragon', 'beast', 'undead', 'kobold', 'celestial'];
const TRIBE_GILDED_METRIC: Readonly<Record<string, RunMetric>> = {
  dwarf: 'dwarfGildedMax', demon: 'demonGildedMax', spirit: 'spiritGildedMax', dragon: 'dragonGildedMax',
  beast: 'beastGildedMax', undead: 'undeadGildedMax', kobold: 'koboldGildedMax', celestial: 'celestialGildedMax',
};
const TRIBE_ATTACK_METRIC: Readonly<Record<string, RunMetric>> = {
  demon: 'demonAttackMax', spirit: 'spiritAttackMax', dragon: 'dragonAttackMax',
  undead: 'undeadAttackMax', kobold: 'koboldAttackMax', celestial: 'celestialAttackMax',
};
const REVELER_IDS: ReadonlySet<string> = new Set(['sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler']);

/** A Tier 1, non-token minion (Tier One Hero). */
const isTierOneMinion = (cardId: string): boolean => { const d = CARD_INDEX[cardId]; return !!d && d.tier === 1 && !d.token && !d.spell && !d.ruby; };
const isMinionDef = (cardId: string): boolean => { const d = CARD_INDEX[cardId]; return !!d && !d.spell && !d.ruby; };
/** Separate permanent buffs a card carries (its per-source rows, each counted as often as it landed; Shop damage rows excluded). */
const buffCountOf = (c: BoardCard): number => (c.buffs ?? []).reduce((n, b) => n + (isShopDamageRow(b.source) ? 0 : Math.max(0, b.count ?? 1)), 0);
const hpOf = (seat: { resolve: number; armor: number }): number => Math.max(0, seat.resolve) + Math.max(0, seat.armor);

/** SECRET TITLES (2026-11-20): the shop-side and lobby-side counters. */
function observeSecretAction(t: AchTally, before: RunState, action: Action, after: RunState, sameTurn: boolean): void {
  // Tribe plays: every card the RunState recorded as played this action (`playedThisTurn` grows by exactly those),
  // minions only, by printed tribe (All-types cards count for every tribe).
  const prevPlayed = before.playedThisTurn?.length ?? 0;
  const nowPlayed = after.playedThisTurn ?? [];
  if (sameTurn && nowPlayed.length > prevPlayed) {
    for (const id of nowPlayed.slice(prevPlayed)) {
      if (!isMinionDef(id)) continue;
      const d = CARD_INDEX[id];
      if (defIsTribe(d, 'dwarf', after)) add(t, 'dwarfPlays', 1);
      if (defIsTribe(d, 'dragon', after)) add(t, 'dragonPlays', 1);
      if (defIsTribe(d, 'kobold', after)) add(t, 'koboldPlays', 1);
      if (defIsTribe(d, 'spirit', after)) add(t, 'spiritPlays', 1);
      if (defIsTribe(d, 'celestial', after)) add(t, 'celestialPlays', 1);
    }
  }
  if (action.type === 'roll') t.rollsTotal = (t.rollsTotal ?? 0) + 1;
  // A Reveler sold (Set 3 Spirits).
  if (action.type === 'sell') {
    const sold = before.board.find((c) => c.uid === action.uid) ?? before.hand.find((c) => c.uid === action.uid);
    if (sold && REVELER_IDS.has(sold.cardId) && !after.board.some((c) => c.uid === action.uid)) add(t, 'revelerSells', 1);
  }

  // A minion bought for less than the standard price (priced the way the buy path charges it, before the buy).
  if (action.type === 'buy') {
    const offer = (before.shop ?? []).find((o) => o.uid === action.uid);
    if (offer && !offer.held && isMinionDef(offer.cardId) && offerBuyPrice(before, offer).cost < CONFIG.minionCost) add(t, 'discountBuys', 1);
  }

  // Tiers.
  t.maxTier = Math.max(t.maxTier ?? 1, after.tier);
  if (after.tier >= 6 && t.tierSixWave === undefined) t.tierSixWave = after.wave;
  if (after.tier >= 6 && after.wave <= 6) bump(t, 'tierSixByRound6', 1);

  // The Gold a new turn opens with.
  if (after.wave > before.wave && after.phase === 'recruit') bump(t, 'goldTurnStartMax', after.embers);

  // The end of a turn (the Shop hands off to combat): the Gold left, and the hand from round 5 on.
  if (before.phase === 'recruit' && after.phase === 'combat') {
    t.zeroGoldStreak = after.embers === 0 ? (t.zeroGoldStreak ?? 0) + 1 : 0;
    bump(t, 'zeroGoldStreakMax', t.zeroGoldStreak);
    if (before.wave >= 5) {
      if (after.hand.length >= CONFIG.handMax) t.fullHandTurns = (t.fullHandTurns ?? 0) + 1;
      else t.fullHandBroken = true;
    }
  }

  // The board: 7 Spirits at once, the biggest minion, the most buffed one; the Starform in the Shop.
  if (after.board.length >= 7 && countTribe(after.board, 'spirit') >= 7) {
    const waves = (t.spiritWaves ??= []);
    if (!waves.includes(after.wave)) { waves.push(after.wave); bump(t, 'spiritFullRounds', waves.length); }
  }
  if (after.board.length >= 7 && countTribe(after.board, 'undead') >= 7) {
    const waves = (t.undeadWaves ??= []);
    if (!waves.includes(after.wave)) { waves.push(after.wave); bump(t, 'undeadFullRounds', waves.length); }
  }
  // Secret titles v2: Front to Back's escalation (both halves), and every spell stat buff that landed on a board minion
  // this action. The buff-FX records are the Shop's one per-target buff ledger (cleared at the top of every `reduce`, so
  // `after` holds exactly this action's): a `spell` capture, or a minion's capture that cast a spell. An Ancient's
  // hero-power grant rides a `spell` record too but is not a spell, so it is skipped. A combat PREVIEW action spreads the
  // prior state without resetting the scratch (`reduceCombatPreview`), so the SAME array means no new captures.
  bump(t, 'frontToBackMin', Math.min(after.frontToBackBonus ?? 0, after.frontToBackBonusH ?? after.frontToBackBonus ?? 0));
  let spellBuffs = 0;
  if (after.recruitBuffFx !== before.recruitBuffFx) for (const r of after.recruitBuffFx ?? []) if ((r.kind === 'spell' || r.spellId) && !r.fromHeroPower && (r.attack > 0 || r.health > 0)) spellBuffs++;
  add(t, 'spellBuffs', spellBuffs);
  for (const c of after.board) {
    bump(t, 'minionStatsMinMax', Math.min(c.attack, c.health));
    bump(t, 'buffsOnOneMax', buffCountOf(c));
  }
  // The tribe batch (2026-11-20): per tribe, the Gilded count on the board and its strongest Attack; a few named reads.
  for (const tr of SECRET_TRIBES) {
    let gilded = 0; let attack = 0; let n = 0;
    for (const c of after.board) {
      if (!isTribe(c, tr)) continue;
      n++;
      if (c.golden) gilded++;
      if (c.attack > attack) attack = c.attack;
    }
    bump(t, TRIBE_GILDED_METRIC[tr], gilded);
    const am = TRIBE_ATTACK_METRIC[tr];
    if (am) bump(t, am, attack);
    if (tr === 'dwarf' && n >= 5) bump(t, 'dwarfHallSpendTurnMax', after.goldSpentThisTurn ?? 0);
    if (tr === 'celestial' && n >= 3) bump(t, 'celestialSpellsTurnMax', after.spellsThisTurn ?? 0);
  }
  bump(t, 'kobebesMax', after.board.reduce((k, c) => k + (c.cardId === 'k_kobabyboldies' ? 1 : 0), 0));
  for (const c of after.hand) bump(t, 'buffsOnOneMax', buffCountOf(c));
  for (const o of after.shop ?? []) if (o.starform) bump(t, 'starformAttackMax', offerBuyStats(after, o).attack);

  // The lobby round settled on this action (its encounters grew): read the table before and after the round.
  const lb = before.lobby;
  const la = after.lobby;
  if (lb && la && Array.isArray(lb.encounters) && Array.isArray(la.encounters) && la.encounters.length > lb.encounters.length) {
    const meId = la.seats[0]?.id;
    const fresh = la.encounters.slice(lb.encounters.length);
    const mine = fresh.find((e) => e.fought && (e.a === meId || e.b === meId));
    const meAfter = la.seats.find((x) => x.id === meId);
    if (mine && meId) {
      const oppId = mine.a === meId ? mine.b : mine.a;
      const dealt = Math.max(0, mine.a === meId ? mine.damageToB : mine.damageToA);
      const oppBefore = lb.seats.find((x) => x.id === oppId);
      const oppAfter = la.seats.find((x) => x.id === oppId);
      // A knockout: the opponent fell in the round you hit them (a ghost stand-in was already out, so never counts).
      const ko = dealt > 0 && !!oppBefore?.alive && !!oppAfter && !oppAfter.alive && oppAfter.eliminatedRound === mine.round;
      if (ko && oppBefore) {
        const leaderHp = Math.max(...lb.seats.filter((x) => x.alive).map(hpOf));
        if (hpOf(oppBefore) >= leaderHp) bump(t, 'leaderKnockout', 1);
        t.koStreak = (t.koLastRound === mine.round - 1 ? (t.koStreak ?? 0) : 0) + 1;
        t.koLastRound = mine.round;
        bump(t, 'knockoutStreakMax', t.koStreak);
      }
      t.lastFightExact = ko && !!oppBefore && dealt === hpOf(oppBefore);
    }
    if (meAfter?.alive) {
      if (meAfter.resolve === 1 && meAfter.armor <= 0) add(t, 'oneHealthRounds', 1);
      const round = fresh[0]!.round;
      const others = la.seats.filter((x) => x.alive && x.id !== meId);
      if (round === 10 && others.length > 0 && hpOf(meAfter) <= Math.min(...others.map(hpOf))) bump(t, 'lastAtRound10', 1);
    }
  }
}

/** The hand card an action PLAYED (it left the hand), with its aim; null when the action played nothing. */
function playedCard(before: RunState, action: Action, after: RunState): { cardId: string; targetUid?: string } | null {
  let uid: string | undefined;
  let targetUid: string | undefined;
  if (action.type === 'play') { uid = action.uid; targetUid = action.targetUid; }
  else if (action.type === 'battlecryTarget' && before.pendingTarget) { uid = before.pendingTarget.uid; targetUid = action.targetUid; }
  if (!uid || after === before) return null;
  const card = before.hand.find((c) => c.uid === uid);
  if (!card || after.hand.some((c) => c.uid === uid)) return null;
  return { cardId: card.cardId, targetUid };
}

/** Fold one fought combat (`lastCombat`) at round `wave`. */
export function observeAchCombat(t: AchTally, lc: CombatResult, wave: number): void {
  const player = new Set<string>();
  const cardOf = new Map<string, string>();
  for (const m of lc.initial?.player ?? []) { player.add(m.uid); cardOf.set(m.uid, m.cardId); }
  for (const m of lc.initial?.enemy ?? []) cardOf.set(m.uid, m.cardId);
  const oona = (lc.initial?.player ?? []).some((m) => m.cardId === 'b2_oona');
  let summons = 0; let beastSummons = 0; let echoes = 0; let beastEchoes = 0; let wards = 0; let rubies = 0; let friendlyDeaths = 0;
  const poisoned = new Set<string>();
  let executeKills = 0;
  let enemyKills = 0;
  for (const e of lc.events) {
    switch (e.type) {
      case 'summon': {
        cardOf.set(e.minion.uid, e.minion.cardId);
        if (e.side !== 'player') break;
        player.add(e.minion.uid);
        summons++;
        const stats = e.minion.attack + e.minion.health;
        const beast = isBeast(e.minion.cardId);
        if (beast) { beastSummons++; if (oona) bump(t, 'oonaBeastSummonMax', stats); }
        if (e.minion.cardId === 'gemheart-shard') bump(t, 'golemStatsCombatMax', stats);
        break;
      }
      case 'shield': case 'wardDowngrade': if (player.has(e.target)) wards++; break;
      case 'buff':
        if (!player.has(e.target)) break;
        if (e.ruby) rubies++;
        if (e.spellId === 'sp_dragonflame') bump(t, 'dragonflameMax', Math.min(e.attack, e.health));
        break;
      case 'poison': if (!player.has(e.target)) poisoned.add(e.target); break;
      case 'death': {
        if (e.side === 'player' || player.has(e.target)) friendlyDeaths++;
        if (e.rise) break; // a Rise's first death is not a kill and not an Echo (it returns)
        if (e.side !== 'player' && !player.has(e.target)) enemyKills++;
        if (player.has(e.target)) {
          const def = CARD_INDEX[cardOf.get(e.target) ?? ''];
          if (def?.effects.some(isEchoEffect)) { echoes++; if (isBeast(def.id)) beastEchoes++; }
        } else if (poisoned.has(e.target)) { executeKills++; poisoned.delete(e.target); }
        break;
      }
      default: break;
    }
  }
  const imps = (lc.playerQuestEvents ?? []).filter((q) => q.kind === 'summonImp').length;
  bump(t, 'summonsCombatMax', summons);
  bump(t, 'beastSummonsCombatMax', beastSummons);
  bump(t, 'echoesCombatMax', echoes);
  bump(t, 'beastEchoesCombatMax', beastEchoes);
  bump(t, 'wardBlocksCombatMax', wards);
  bump(t, 'rubiesLandedCombatMax', rubies);
  bump(t, 'executeKillsCombatMax', executeKills);
  bump(t, 'impSummonsCombatMax', imps);
  if (beastSummons >= 6 && imps >= 3) bump(t, 'feedingFrenzy', 1);
  t.m.finalCombatEchoes = echoes; // the LAST combat's count, overwritten every fight

  const mine = lc.initial?.player ?? [];
  const theirs = lc.initial?.enemy ?? [];
  const myStats = mine.reduce((n, m) => n + m.attack + m.health, 0);
  const theirStats = theirs.reduce((n, m) => n + m.attack + m.health, 0);
  bump(t, 'boardStatsCombatMax', myStats);
  const won = lc.result === 'win';
  if (won && mine.length >= 5 && printedTribeCounts(mine.map((m) => m.cardId)).every((n) => n <= 2)) bump(t, 'balancedWin', 1);
  if (won && wave >= 10 && friendlyDeaths === 0) bump(t, 'cleanWinLate', 1);
  if (won && wave >= 8 && theirStats > 0 && myStats * 10 <= theirStats * 7) bump(t, 'underdogWinLate', 1);
  if (t.epicFitPending) { if (won) bump(t, 'epicFitWin', 1); t.epicFitPending = false; }

  // ── Achievements 150 (2026-10-03): combat feats.
  bump(t, 'enemyKillsCombatMax', enemyKills);
  add(t, 'enemyKills', enemyKills);
  t.combatsFought = (t.combatsFought ?? 0) + 1;
  if (lc.result === 'lose') t.lostCombat = true;
  t.winStreak = won ? (t.winStreak ?? 0) + 1 : 0;
  bump(t, 'combatWinStreakMax', t.winStreak);
  if (won && friendlyDeaths === 0) add(t, 'flawlessWins', 1);
  // The survivors behind the winning blow (one entry per surviving friendly minion).
  if (won && lc.enemyDamageBreakdown?.survivorTiers.length === 1) add(t, 'lastStandWins', 1);

  observeSecretCombat(t, lc, player, cardOf);
}

/**
 * SECRET TITLES (2026-11-20): the combat-log reads. `player` / `cardOf` are the friendly uids and every uid's card, as
 * `observeAchCombat` built them. Pure log reads; a tag-team (Duos) fight is skipped for the board-count feats, since
 * its bodies fly in and out between members.
 */
function observeSecretCombat(t: AchTally, lc: CombatResult, player: ReadonlySet<string>, cardOf: ReadonlyMap<string, string>): void {
  const won = lc.result === 'win';
  const mine = lc.initial?.player ?? [];
  const theirs = lc.initial?.enemy ?? [];
  if (won) t.combatsWon = (t.combatsWon ?? 0) + 1;
  if (lc.result === 'draw') add(t, 'combatDraws', 1);
  bump(t, 'echoTriggersCombatMax', lc.playerDeathrattles ?? 0);
  bump(t, 'ralliesCombatMax', lc.playerRallies ?? 0);
  add(t, 'impSummons', (lc.playerQuestEvents ?? []).filter((q) => q.kind === 'summonImp').length);
  if (won && mine.length === 0) bump(t, 'emptyBoardWin', 1);
  if (won && mine.length >= 4 && mine.every((m) => m.health === 1)) bump(t, 'glassCannonWin', 1);

  const tagTeam = !!lc.tagTeam || !!lc.duosBoards;
  const hp = new Map<string, number>();
  for (const m of mine) hp.set(m.uid, m.health);
  let hpKnown = true;
  let alivePlayer = mine.length;
  let aliveEnemy = theirs.length;
  let wasDownOneVsSeven = false;
  let friendlyAttacked = false;
  const hitsTaken = new Map<string, number>();
  let pendingHit: string | null = null; // the friendly body the last attack landed on, until it is known to have lived
  // The tribe batch (2026-11-20).
  let bankedGold = 0; let demonDamage = 0; let dwarfDamage = 0; let spellBuffs = 0; let undeadRises = 0; let skeletons = 0; let fromHand = 0;
  const isDemon = (uid: string): boolean => defIsTribe(CARD_INDEX[cardOf.get(uid) ?? ''], 'demon');
  const isDwarf = (uid: string): boolean => defIsTribe(CARD_INDEX[cardOf.get(uid) ?? ''], 'dwarf');
  const settleHit = (): void => {
    if (pendingHit === null) return;
    const n = (hitsTaken.get(pendingHit) ?? 0) + 1;
    hitsTaken.set(pendingHit, n);
    bump(t, 'attacksSurvivedMax', n);
    pendingHit = null;
  };
  for (const e of lc.events) {
    switch (e.type) {
      case 'attack':
        settleHit();
        if (player.has(e.attacker)) friendlyAttacked = true;
        if (player.has(e.defender)) pendingHit = e.defender;
        break;
      case 'dmg':
        if (player.has(e.target)) hp.set(e.target, e.remainingHp);
        else if (e.source && player.has(e.source)) {
          bump(t, 'hitDamageMax', e.amount);
          if (isDemon(e.source)) demonDamage += Math.max(0, e.amount);
          if (isDwarf(e.source)) dwarfDamage += Math.max(0, e.amount);
        }
        break;
      case 'buff':
        if (!player.has(e.target)) break;
        if (e.spellId && (e.attack > 0 || e.health > 0)) spellBuffs++; // a spell's stat buff landing (secret titles v2)
        if (hp.has(e.target)) hp.set(e.target, hp.get(e.target)! + e.health);
        break;
      case 'sc': if (e.setHealth !== undefined && player.has(e.source)) hp.set(e.source, e.setHealth); break;
      case 'tribeAura': if (e.side === 'player' && (e.health ?? 0) !== 0) hpKnown = false; break;
      case 'hpGrant': if (player.has(e.target)) hpKnown = false; break;
      case 'summon':
        if (e.side === 'player') {
          alivePlayer++; hp.set(e.minion.uid, e.minion.health);
          if (e.minion.cardId === 'u3_skeleton') skeletons++;
          if (e.fromHandUid) fromHand++;
        } else aliveEnemy++;
        break;
      case 'bonusGold': if (e.side === 'player') bankedGold += Math.max(0, e.amount); break;
      case 'reborn': {
        const friendly = player.has(e.target);
        if (friendly) { alivePlayer++; hp.set(e.target, e.hp); } else aliveEnemy++;
        if (friendly && !e.rebirth && defIsTribe(CARD_INDEX[cardOf.get(e.target) ?? ''], 'undead')) { add(t, 'undeadRises', 1); undeadRises++; }
        break;
      }
      case 'death':
        if (pendingHit === e.target) pendingHit = null; // that attack killed it
        if (e.side === 'player' || player.has(e.target)) { alivePlayer--; hp.delete(e.target); } else aliveEnemy--;
        break;
      default: break;
    }
    if (alivePlayer === 1 && aliveEnemy === 7) wasDownOneVsSeven = true;
  }
  settleHit();
  bump(t, 'combatGoldMax', bankedGold);
  bump(t, 'demonDamageCombatMax', demonDamage);
  add(t, 'dwarfDamage', dwarfDamage);
  add(t, 'spellBuffs', spellBuffs);
  bump(t, 'undeadRisesCombatMax', undeadRises);
  bump(t, 'skeletonSummonsCombatMax', skeletons);
  bump(t, 'handSummonsCombatMax', fromHand);
  if (!won || tagTeam) return;
  if (wasDownOneVsSeven) bump(t, 'comebackOneVsSeven', 1);
  if (theirs.length > 0 && mine.length > 0 && !friendlyAttacked) bump(t, 'pacifistWin', 1);
  // One survivor on exactly 1 Health: the log's own survivor list agrees there is one, and the tracked Health is 1.
  if (hpKnown && alivePlayer === 1 && hp.size === 1 && lc.enemyDamageBreakdown?.survivorTiers.length === 1 && [...hp.values()][0] === 1) {
    bump(t, 'lastStandOneHp', 1);
  }
}

const isBeast = (cardId: string): boolean => defIsTribe(CARD_INDEX[cardId], 'beast');

/** Minions per PRINTED tribe (primary + secondary; Neutral and All-types cards count toward none). */
function printedTribeCounts(cardIds: readonly string[]): number[] {
  const counts = new Map<string, number>();
  for (const id of cardIds) {
    const d = CARD_INDEX[id];
    if (!d || d.universalTribe) continue;
    for (const tr of new Set([d.tribe, d.tribe2])) if (tr && tr !== 'neutral') counts.set(tr, (counts.get(tr) ?? 0) + 1);
  }
  return [...counts.values()];
}

/** The complete metrics document for a finished run: the running tally plus the final-state reads. */
export function finalAchMetrics(t: AchTally, final: RunState): Partial<Record<RunMetric, number>> {
  const out: Partial<Record<RunMetric, number>> = { ...t.m };
  const set = (k: RunMetric, v: number): void => { if (Number.isFinite(v) && v > 0) out[k] = Math.floor(v); else delete out[k]; };
  const board = final.board;
  set('goldSpent', final.goldSpent ?? 0);
  set('spellsCast', final.spellsCast ?? 0);
  set('consumes', final.shopMinionsEaten ?? 0);
  const finalTribes = printedTribeCounts(board.map((c) => c.cardId)).length;
  set('finalTribes', finalTribes);
  set('finalKobolds', countTribe(board, 'kobold'));
  set('finalDwarves', countTribe(board, 'dwarf'));
  set('finalDragons', countTribe(board, 'dragon'));
  set('finalBeasts', countTribe(board, 'beast'));
  set('finalDemons', countTribe(board, 'demon'));
  set('finalDemonStatsMax', board.filter((c) => isTribe(c, 'demon')).reduce((n, c) => Math.max(n, c.attack + c.health), 0));
  const procs = final.runeProcs ?? {};
  set('runeTriggers', Object.values(procs).reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0));
  set('runesFivePlus', Object.values(procs).filter((v) => v >= 5).length);
  set('overtimeProcs', procs.rune_overtime ?? 0);
  set('blartProcs', procs.rune_blart ?? 0);
  const owned = final.ownedRunes ?? [];
  set('menagerieRuneFinalTribes', owned.some((id) => id.startsWith('rune_menagerie')) ? finalTribes : 0);
  const tribesOf = (id: string): readonly string[] => RUNE_INDEX[id]?.tribes ?? [];
  const basicTribes = new Set(owned.filter((id) => !EPIC_RUNE_IDS.has(id)).flatMap(tribesOf));
  set('tribalRunePair', owned.some((id) => EPIC_RUNE_IDS.has(id) && tribesOf(id).some((tr) => basicTribes.has(tr))) ? 1 : 0);
  // Achievements 150 (2026-10-03): the unbeaten flag, and the lobby reads (knockouts, damage dealt to opponents).
  set('undefeated', (t.combatsFought ?? 0) >= 5 && !t.lostCombat ? 1 : 0);
  const lobby = final.lobby;
  const me = lobby?.seats[0];
  // Defensive (a hand-built or partial lobby must never break a run-end): no encounter list reads as no fights.
  if (lobby && me && Array.isArray(lobby.encounters)) {
    let knockouts = 0; let dealt = 0; let best = 0;
    for (const e of lobby.encounters) {
      if (!e.fought || (e.a !== me.id && e.b !== me.id)) continue;
      const opp = e.a === me.id ? e.b : e.a;
      const dmg = Math.max(0, e.a === me.id ? e.damageToB : e.damageToA);
      dealt += dmg; best = Math.max(best, dmg);
      // A knockout: the opponent fell in the round you hit them (a ghost stand-in was already out, so never counts).
      const seat = lobby.seats.find((x) => x.id === opp);
      if (dmg > 0 && seat && !seat.alive && seat.eliminatedRound === e.round) knockouts++;
    }
    set('knockouts', knockouts);
    set('heroDamageDealt', dealt);
    set('heroDamageCombatMax', best);
  }
  // SECRET TITLES (2026-11-20): the final-board and whole-game reads.
  const fought = t.combatsFought ?? 0;
  set('noRefreshGame', fought >= 5 && (t.rollsTotal ?? 0) === 0 ? 1 : 0);
  set('lowTierGame', fought >= 5 && Math.max(t.maxTier ?? 1, final.tier) <= 3 ? 1 : 0);
  set('lateTierSix', (t.tierSixWave ?? 0) >= 13 ? 1 : 0);
  set('perfectRecord', fought >= 5 && (t.combatsWon ?? 0) === fought ? 1 : 0);
  set('fullHandFrom5', !t.fullHandBroken && (t.fullHandTurns ?? 0) >= 5 ? 1 : 0);
  set('exactLethalFinish', t.lastFightExact ? 1 : 0);
  set('finalBeastPack', board.length > 0 && board.every((c) => isTribe(c, 'beast')) ? new Set(board.map((c) => c.cardId)).size : 0);
  const tribeCounts = printedTribeCounts(board.map((c) => c.cardId));
  set('finalTribesSpread', tribeCounts.every((n) => n <= 2) ? tribeCounts.length : 0);
  const copies = new Map<string, number>();
  for (const c of board) copies.set(c.cardId, (copies.get(c.cardId) ?? 0) + 1);
  set('finalSameCardMax', Math.max(0, ...copies.values()));
  set('finalTierOneOnly', board.length > 0 && board.every((c) => isTierOneMinion(c.cardId)) ? board.length : 0);
  const meSeat = lobby?.seats[0];
  set('fullHealthFinish', lobby && meSeat && fought >= 5 && meSeat.resolve >= lobby.rules.startingResolve ? 1 : 0);
  for (const k of Object.keys(out) as RunMetric[]) if (!(out[k]! > 0)) delete out[k];
  return out;
}
