import { ALE_IDS, SPECIAL_RUBY_IDS, type CombatResult, type Tribe } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNE_INDEX } from '@game/content';
import type { RunMetric } from '@game/progression';
import type { Action, BoardCard, RunState } from './state';
import { defIsTribe, isTribe, offerBuyStats } from './recruit';

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
          if (def?.effects.some((x) => x.on === 'onDeath')) { echoes++; if (isBeast(def.id)) beastEchoes++; }
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
  for (const k of Object.keys(out) as RunMetric[]) if (!(out[k]! > 0)) delete out[k];
  return out;
}
