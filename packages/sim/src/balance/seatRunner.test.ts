/**
 * B1 — the authoritative seat runner (docs/balance-bot-roadmap.md, "First implementation slice"):
 * "The first deliverable is a proof that the next recruit phase contains the exact resources and effects earned
 *  in the preceding fight."
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { lossDamageCap, reduce } from '../reducer';
import { createRun, type Action, type BoardCard, type RunState } from '../state';
import { GREEDY_PILOT } from './pilots';
import { mirrorForEnemySeat, playRecruitTurn, prepareAndFight } from './seatRunner';
import { NOOP_RECORDER, type AcceptedActionEvent, type BalanceRecorder, type SeatContext, type SeatPilot } from './types';

const SET = 'set2' as const;
const ctx = (seatId: string, round: number): SeatContext => ({ seatId, round, scoutedOpponent: null });
const opts = { maxActionsPerTurn: 50, lobbyId: 'test' };

/** A body on a run board, straight from its def (stats overridable). */
function place(run: RunState, cardId: string, stats?: { attack: number; health: number }): BoardCard {
  const def = CARD_INDEX[cardId]!;
  const card: BoardCard = {
    uid: `t${run.uidSeq++}`, cardId, tribe: def.tribe,
    attack: stats?.attack ?? def.attack, health: stats?.health ?? def.health,
    keywords: [...def.keywords], golden: false,
  };
  run.board.push(card);
  return card;
}

/** A pilot that ends the turn at once — the fixture board is the whole turn. */
const PASS: SeatPilot = { id: 'pass', decide: () => null };

function fixture(): { a: RunState; b: RunState } {
  // A: Right Hand Hank (Echo: +3/+2 to the right-most Shop minion, PERMANENT) + Wardstone Jeweler (End of Turn:
  // get a Warding Ruby) — one carry-back that lands at settle and one generated card that must survive into the
  // next shop. (Re-pin 2026-10-10: Gemling now CASTS Veinstorm at End of Turn instead of handing one over, so
  // the generated-card half moved to the archived Jeweler, which still resolves by id.) B: two fat vanilla Spellswords, so A loses and Hank dies.
  const a = createRun(11, 'warden', 'lobby', undefined, SET);
  const b = createRun(12, 'warden', 'lobby', undefined, SET);
  place(a, 'dm_hank');
  place(a, 'k_wardstone');
  place(b, 'n2_spellsword', { attack: 12, health: 12 });
  place(b, 'n2_spellsword', { attack: 12, health: 12 });
  return { a, b };
}

describe('B1 — one authoritative fight, settled on both seats', () => {
  it('the next recruit phase holds exactly what the fight earned: damage armor-first, the Echo carry-back, the generated spell', () => {
    const { a, b } = fixture();
    const ta = playRecruitTurn(a, PASS, ctx('s0', 1), NOOP_RECORDER, opts);
    const tb = playRecruitTurn(b, PASS, ctx('s1', 1), NOOP_RECORDER, opts);
    expect(ta.failure).toBeUndefined();
    expect(tb.failure).toBeUndefined();
    // End of Turn fired exactly once on the way out: ONE Warding Ruby from the Jeweler.
    expect(ta.run.hand.filter((c) => c.cardId === 'warding-ruby')).toHaveLength(1);
    expect(ta.run.phase).toBe('combat');
    expect(ta.run.pendingCombatSide).toBeDefined();
    expect(ta.run.lastCombat).toBeUndefined(); // nothing resolved yet — the fight belongs to the lobby
    // A repeated End Turn is refused outright (same reference): no second preparation, no replayed triggers.
    expect(reduce(ta.run, { type: 'faceOmen', deferFight: true })).toBe(ta.run);
    expect(reduce(ta.run, { type: 'settleCombat' })).toBe(ta.run);
    expect(reduce(ta.run, { type: 'resolveCombat' })).toBe(ta.run); // a bare resolve cannot settle a fight that never happened

    const f = prepareAndFight(ta.run, tb.run, 7, { round: 1 });
    expect(f.result.result).toBe('lose');
    // Damage: the round cap applies, armor absorbs first, Resolve takes the overflow.
    const cap = lossDamageCap(1);
    expect(f.damageToA).toBe(Math.min(cap, f.result.playerDamage));
    expect(f.damageToB).toBe(0);
    const absorbed = Math.min(a.armor, f.damageToA);
    expect(f.aAfter.armor).toBe(a.armor - absorbed);
    expect(f.aAfter.resolve).toBe(a.resolve - (f.damageToA - absorbed));
    expect(f.bAfter.armor).toBe(b.armor);
    expect(f.bAfter.resolve).toBe(b.resolve);
    // Both runs are back in the shop for wave 2 with the ONE fight in their history — from their own side.
    expect(f.aAfter.phase).toBe('recruit');
    expect(f.bAfter.phase).toBe('recruit');
    expect(f.aAfter.wave).toBe(2);
    expect(f.bAfter.wave).toBe(2);
    expect(f.aAfter.history).toEqual(['lose']);
    expect(f.bAfter.history).toEqual(['win']);
    expect(f.aAfter.pendingCombatSide).toBeUndefined();
    expect(f.bAfter.pendingCombatSide).toBeUndefined();
    // ONE result object, landed by reference on the player side; the enemy seat sees the same fight mirrored.
    expect(f.aAfter.lastCombat).toBe(f.result);
    expect(f.bAfter.lastCombat!.events).toHaveLength(f.result.events.length);
    expect(f.bAfter.lastCombat!.initial.player.map((m) => m.cardId)).toEqual(['n2_spellsword', 'n2_spellsword']);
    // What the fight EARNED is in the next recruit phase: Hank's Echo fired (the run-wide tally) and its
    // permanent right-most-slot buff is banked on the run …
    expect(f.aAfter.deathrattlesTriggered).toBe(1);
    expect(f.aAfter.rightmostSlotBuff).toEqual({ attack: 4, health: 3 }); // Right Hand Hank +4/+3 since the owner balance 2026-10-10
    // … and the Warding Ruby the Jeweler generated at End of Turn is still in hand — exactly one, not re-generated.
    expect(f.aAfter.hand.filter((c) => c.cardId === 'warding-ruby')).toHaveLength(1);
    // The fight is spent: nothing is pending, so a second settlement is impossible.
    expect(() => prepareAndFight(f.aAfter, f.bAfter, 7, { round: 2 })).toThrow(/no deferred fight pending/);

    // ROUND 2 — the greedy pilot shops on top of what round 1 left, both seats fight once more.
    const ta2 = playRecruitTurn(f.aAfter, GREEDY_PILOT, ctx('s0', 2), NOOP_RECORDER, opts);
    const tb2 = playRecruitTurn(f.bAfter, GREEDY_PILOT, ctx('s1', 2), NOOP_RECORDER, opts);
    expect(ta2.failure).toBeUndefined();
    expect(tb2.failure).toBeUndefined();
    // Greedy cast the held Warding Ruby during the shop, and the Jeweler's second End of Turn made exactly one
    // more — the generated card was real, spendable, and regenerated once.
    const heldUid = f.aAfter.hand.find((c) => c.cardId === 'warding-ruby')!.uid;
    expect(ta2.run.hand.some((c) => c.uid === heldUid), 'the held Ruby was spent').toBe(false);
    expect(ta2.run.hand.filter((c) => c.cardId === 'warding-ruby')).toHaveLength(1);
    const f2 = prepareAndFight(ta2.run, tb2.run, 7, { round: 2 });
    expect(f2.aAfter.wave).toBe(3);
    expect(f2.aAfter.history).toHaveLength(2);
    expect(f2.bAfter.history).toHaveLength(2);
    expect(f2.aAfter.armor + f2.aAfter.resolve).toBe(f.aAfter.armor + f.aAfter.resolve - f2.damageToA);
    expect(f2.bAfter.armor + f2.bAfter.resolve).toBe(f.bAfter.armor + f.bAfter.resolve - f2.damageToB);
  });

  it('the recorder sees accepted transitions only, with the gold + hash reconciliation fields', () => {
    const { a } = fixture();
    const seen: AcceptedActionEvent[] = [];
    const recorder: BalanceRecorder = { ...NOOP_RECORDER, onAction: (ev) => seen.push(ev) };
    // Greedy buys the cheapest minion (3 Gold at wave 1), plays it, then ends the turn.
    const t = playRecruitTurn(a, GREEDY_PILOT, ctx('s0', 1), recorder, opts);
    expect(t.failure).toBeUndefined();
    expect(seen.length).toBe(t.accepted);
    expect(seen[seen.length - 1]!.action).toEqual({ type: 'faceOmen', deferFight: true });
    for (const [i, ev] of seen.entries()) {
      expect(ev.index).toBe(i);
      expect(ev.preHash).not.toBe(ev.postHash); // an accepted action changed the reconciled projection
      if (i > 0) expect(ev.preHash).toBe(seen[i - 1]!.postHash); // …and the chain is contiguous
    }
    const buy = seen.find((ev) => ev.action.type === 'buy');
    expect(buy).toBeDefined();
    expect(buy!.goldBefore - buy!.goldAfter).toBeGreaterThan(0);
    expect(buy!.offers.length).toBeGreaterThan(0);
  });

  it('a stuck pilot FAILS the seat — never a silently ended turn', () => {
    const { a } = fixture();
    // Tier-up costs more than the 3 Gold a wave-1 run holds: rejected every time.
    const stuck: SeatPilot = { id: 'stuck', decide: () => ({ type: 'upgrade' }) };
    const t = playRecruitTurn(a, stuck, ctx('s0', 1), NOOP_RECORDER, opts);
    expect(t.failure).toMatch(/consecutive rejected actions/);
    expect(t.run).toBe(a); // nothing was applied
    expect(t.run.phase).toBe('recruit'); // and the turn was NOT ended for it
  });

  it('a pilot that ends the turn with a modal open FAILS the seat', () => {
    const { a } = fixture();
    a.discover = ['dw_soldier', 'n2_spellsword'];
    const t = playRecruitTurn(a, PASS, ctx('s0', 1), NOOP_RECORDER, opts);
    expect(t.failure).toMatch(/modal open \(discover\)/);
    expect(t.run.phase).toBe('recruit');
  });

  it('the action budget is a hard stop', () => {
    const { a } = fixture();
    // Reordering the board is always legal and never ends: a pilot that only does that would run forever.
    const fidget: SeatPilot = { id: 'fidget', decide: (run): Action => ({ type: 'reposition', uid: run.board[0]!.uid, toIndex: run.board.length - 1 }) };
    const t = playRecruitTurn(a, fidget, ctx('s0', 1), NOOP_RECORDER, { ...opts, maxActionsPerTurn: 5 });
    expect(t.failure).toMatch(/5 accepted actions without ending the turn/);
  });

  it('mirrorForEnemySeat inverts the fight and lifts ONLY the enemy seat’s own ledger — the other seat’s player-side fields never leak', () => {
    const { a, b } = fixture();
    const ta = playRecruitTurn(a, PASS, ctx('s0', 1), NOOP_RECORDER, opts);
    const tb = playRecruitTurn(b, PASS, ctx('s1', 1), NOOP_RECORDER, opts);
    const f = prepareAndFight(ta.run, tb.run, 7, { round: 1 });
    const m = mirrorForEnemySeat(f.result);
    expect(m.result).toBe('win');
    expect(m.playerDamage).toBe(f.result.enemyDamage ?? 0);
    expect(m.enemyDamage).toBe(f.result.playerDamage);
    expect(m.playerDeaths).toBe(f.result.enemyDeaths);
    expect(m.enemyDeaths).toBe(f.result.playerDeaths ?? 0);
    expect(m.playerSurvivorCardIds).toEqual(['n2_spellsword', 'n2_spellsword']);
    expect(m.initial.player.map((x) => x.cardId)).toEqual(f.result.initial.enemy.map((x) => x.cardId));
    // A's carry-backs (Hank's Echo) belong to A: none may leak across the table.
    expect(f.result.playerRightmostSlotBuff).toEqual({ attack: 4, health: 3 }); // Right Hand Hank +4/+3 since the owner balance 2026-10-10
    expect(m.playerRightmostSlotBuff).toBeUndefined();
    expect(m.enemyCarry).toBeUndefined(); // consumed, not re-mirrored
    // THE CONTRACT: every `player*` field on the mirrored view is exactly what `enemyCarry` says — no more, no less.
    const c = f.result.enemyCarry!;
    const fromCarry: Record<string, unknown> = {
      playerDeathrattles: c.deathrattles, playerDeaths: c.deaths, playerSurvivorCardIds: c.survivorCardIds,
      playerFirstKill: c.firstKill, playerLastKill: c.lastKill, playerQuestTally: c.questTally, playerQuestEvents: c.questEvents,
      playerSummonBonus: c.summonBonus, playerPermaBuffs: c.permaBuffs, playerHandGrants: c.handGrants,
    };
    for (const [key, value] of Object.entries(m)) {
      if (!key.startsWith('player') || key === 'playerDamage') continue;
      if (!(key in fromCarry)) throw new Error(`player-side field on the enemy seat's view with no enemyCarry source: ${key}`);
      expect(value, key).toEqual(fromCarry[key]);
    }
    expect(m.playerDeathrattles).toBe(0); // the Spellswords have no Echo — a real count, not a placeholder
    // The mirror never touches the original.
    expect(f.result.result).toBe('lose');
  });

  it('the ENEMY seat settles with what it earned: an Engraved gain, a hand grant and a quest tally land in its next recruit phase', () => {
    // B (the `enemy` side of the pair) fields three Sporelings (Echo: +1/+1 to your minions), a fat Engraved Tara
    // and a fat Totality (Avenge (3): a Star Crash to hand). A is a single fat Taunt: every swing has one target.
    const a = createRun(21, 'warden', 'lobby', undefined, SET);
    const b = createRun(22, 'warden', 'lobby', undefined, SET);
    place(a, 'sandbag', { attack: 9, health: 60 }).keywords.push('T');
    place(b, 'spore'); place(b, 'spore'); place(b, 'spore');
    const tara = place(b, 'tara', { attack: 4, health: 40 });
    place(b, 'ce3_eclipsewarden', { attack: 3, health: 60 });
    const ta = playRecruitTurn(a, PASS, ctx('s0', 1), NOOP_RECORDER, opts);
    const tb = playRecruitTurn(b, PASS, ctx('s1', 1), NOOP_RECORDER, opts);
    expect(ta.failure).toBeUndefined();
    expect(tb.failure).toBeUndefined();
    const f = prepareAndFight(ta.run, tb.run, 7, { round: 1 });
    const c = f.result.enemyCarry!;
    expect(c.deathrattles).toBe(3);
    expect(c.handGrants).toEqual(['starcrash']);
    expect(c.permaBuffs?.find((p) => p.sourceUid === tara.uid)).toMatchObject({ attack: 3, health: 3, engraved: true });
    expect(c.questTally?.attack).toBeGreaterThan(0);
    // …and B's NEXT RECRUIT PHASE holds all of it, settled through the real `resolveCombat` path.
    expect(f.bAfter.phase).toBe('recruit');
    expect(f.bAfter.deathrattlesTriggered).toBe(b.deathrattlesTriggered + 3);
    expect(f.bAfter.hand.filter((h) => h.cardId === 'starcrash')).toHaveLength(1);
    const taraAfter = f.bAfter.board.find((x) => x.uid === tara.uid)!;
    expect(taraAfter.attack).toBe(4 + 3);
    expect(taraAfter.health).toBe(40 + 3);
    expect(taraAfter.ascendProgress ?? 0).toBe(3);
    // A, the `player` side, earned nothing of B's: no Star Crash, no Echo count.
    expect(f.aAfter.hand.some((h) => h.cardId === 'starcrash')).toBe(false);
    expect(f.aAfter.deathrattlesTriggered).toBe(a.deathrattlesTriggered);
  });

  it('the enemy seat’s banked Start-of-Combat keyword lands under BOTH rule sets (2026-10-07: snapshots carry the banks)', () => {
    // B banked a Divine Shield for its first Spellsword (Field Maneuvers-style `pendingCombatKeywords`). Until
    // 2026-10-07 the shipped served-board path never saw the bank (it was spent before the snapshot was taken) —
    // the discrepancy `FightRules` documented. The bank now rides `questMods.bankedKeywords`, stays armed until the
    // fight settles, and `simulate` stamps it for whichever side holds it, so `shipped` matches `corrected` here.
    const build = (rules: 'corrected' | 'shipped') => {
      const { a, b } = fixture();
      b.pendingCombatKeywords = [{ uid: b.board[0]!.uid, keyword: 'DS' }];
      const ta = playRecruitTurn(a, PASS, ctx('s0', 1), NOOP_RECORDER, opts);
      const tb = playRecruitTurn(b, PASS, ctx('s1', 1), NOOP_RECORDER, opts);
      expect(tb.run.pendingCombatKeywords?.length).toBe(1); // still armed while the deferred fight is pending
      return prepareAndFight(ta.run, tb.run, 7, { round: 1, rules });
    };
    const corrected = build('corrected');
    const shipped = build('shipped');
    for (const f of [corrected, shipped]) {
      // The keyword is rewound out of `initial` and lands as a Start of Combat beat behind the cast marker.
      const target = f.result.initial.enemy[0]!.uid;
      expect(f.result.events.some((e) => e.type === 'bankedCast' && e.side === 'enemy' && e.spellId === 'fieldmaneuvers')).toBe(true);
      expect(f.result.events.some((e) => e.type === 'keyword' && e.target === target && e.keyword === 'DS')).toBe(true);
      // Both rule sets settle both runs through the same path, and the bank is spent by the settle.
      expect(f.result.result).toBe('lose');
      expect(f.aAfter.wave).toBe(2);
      expect(f.bAfter.wave).toBe(2);
      expect(f.bAfter.pendingCombatKeywords ?? []).toEqual([]);
      expect(f.aAfter.rightmostSlotBuff).toEqual({ attack: 4, health: 3 }); // Right Hand Hank +4/+3 since the owner balance 2026-10-10
    }
  });
});
