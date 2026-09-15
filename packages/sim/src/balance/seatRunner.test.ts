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
  // A: Right Hand Hank (Echo: +3/+2 to the right-most Shop minion, PERMANENT) + Gemline (End of Turn: get a
  // Veinstorm spell) — one carry-back that lands at settle and one generated card that must survive into the
  // next shop. B: two fat vanilla Spellswords, so A loses and Hank dies.
  const a = createRun(11, 'warden', 'lobby', undefined, SET);
  const b = createRun(12, 'warden', 'lobby', undefined, SET);
  place(a, 'dm_hank');
  place(a, 'k_gemline');
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
    // End of Turn fired exactly once on the way out: ONE Veinstorm from Gemline.
    expect(ta.run.hand.filter((c) => c.cardId === 'veinstorm')).toHaveLength(1);
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
    expect(f.aAfter.rightmostSlotBuff).toEqual({ attack: 3, health: 2 });
    // … and the Veinstorm Gemline generated at End of Turn is still in hand — exactly one, not re-generated.
    expect(f.aAfter.hand.filter((c) => c.cardId === 'veinstorm')).toHaveLength(1);
    // The fight is spent: nothing is pending, so a second settlement is impossible.
    expect(() => prepareAndFight(f.aAfter, f.bAfter, 7, { round: 2 })).toThrow(/no deferred fight pending/);

    // ROUND 2 — the greedy pilot shops on top of what round 1 left, both seats fight once more.
    const ta2 = playRecruitTurn(f.aAfter, GREEDY_PILOT, ctx('s0', 2), NOOP_RECORDER, opts);
    const tb2 = playRecruitTurn(f.bAfter, GREEDY_PILOT, ctx('s1', 2), NOOP_RECORDER, opts);
    expect(ta2.failure).toBeUndefined();
    expect(tb2.failure).toBeUndefined();
    // Greedy cast the held Veinstorm during the shop (the spell tally moved), and Gemline's second End of Turn
    // made exactly one more — the generated card was real, spendable, and regenerated once.
    expect(ta2.run.spellsCast).toBe((f.aAfter.spellsCast ?? 0) + 1);
    expect(ta2.run.hand.filter((c) => c.cardId === 'veinstorm')).toHaveLength(1);
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

  it('mirrorForEnemySeat inverts the fight and strips every player-side carry-back (the documented gap)', () => {
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
    // The player-side carry-backs belong to the other seat: none may leak across the table.
    expect(m.playerRightmostSlotBuff).toBeUndefined();
    expect(m.playerDeathrattles).toBe(0);
    for (const key of Object.keys(m)) {
      if (key.startsWith('player') && !['playerDamage', 'playerDeathrattles', 'playerDeaths', 'playerSurvivorCardIds'].includes(key)) {
        throw new Error(`player-side field leaked into the enemy seat's view: ${key}`);
      }
    }
    // The mirror never touches the original.
    expect(f.result.result).toBe('lose');
    expect(f.result.playerRightmostSlotBuff).toEqual({ attack: 3, health: 2 });
  });

  it('`corrected` vs `shipped` is a real, labelled difference: the enemy seat’s banked Start-of-Combat keyword lands only under `corrected`', () => {
    // B banked a Divine Shield for its first Spellsword (Field Maneuvers-style `pendingCombatKeywords`). The
    // player builder stamps it onto the combat body; the shipped served-board path never sees the bank (a
    // snapshot carries no pending banks) — exactly the discrepancy `FightRules` documents.
    const build = (rules: 'corrected' | 'shipped') => {
      const { a, b } = fixture();
      b.pendingCombatKeywords = [{ uid: b.board[0]!.uid, keyword: 'DS' }];
      const ta = playRecruitTurn(a, PASS, ctx('s0', 1), NOOP_RECORDER, opts);
      const tb = playRecruitTurn(b, PASS, ctx('s1', 1), NOOP_RECORDER, opts);
      expect(tb.run.pendingCombatKeywords).toEqual([]); // spent by the preparation either way
      return prepareAndFight(ta.run, tb.run, 7, { round: 1, rules });
    };
    const corrected = build('corrected');
    const shipped = build('shipped');
    expect(corrected.result.initial.enemy[0]!.keywords).toContain('DS');
    expect(shipped.result.initial.enemy[0]!.keywords).not.toContain('DS');
    // Both rule sets settle both runs through the same path.
    for (const f of [corrected, shipped]) {
      expect(f.result.result).toBe('lose');
      expect(f.aAfter.wave).toBe(2);
      expect(f.bAfter.wave).toBe(2);
      expect(f.aAfter.rightmostSlotBuff).toEqual({ attack: 3, health: 2 });
    }
  });
});
