import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type EffectDef } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { snapshotBoard } from './snapshot';
import { opponentBoard } from './opponents';

/**
 * OWNER RULINGS 2026-08-27 (snapshot-carries triage) — the per-instance marks/banks/grafts that now RIDE
 * across the fidelity boundaries. Traceable to packages/rules/src/registry/decisions.json:
 *   q-snap-one-combat-marks (approve) — partingCry / resummon / closedCasket carry through capture like bloodlust.
 *   q-snap-granted-effects  (approve) — runtime shop grafts fire in combat and on served boards.
 *   q-snap-echostripped     (revise)  — a shop-stripped "without Echo" copy stays silent when it dies in combat.
 *   q-snap-impbank          (approve) — Ashen Heir's shop bank rides into combat and onto snapshots.
 * The snapshot-fidelity ratchet (docbot/snapshotFidelity.test.ts) pins the field-level survival; these pin
 * the BEHAVIOUR each carried field buys.
 */

const mk = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};
const run = (board: BoardCard[], heroId?: string): RunState => ({ ...createRun(7, heroId), board, hand: [] });

const sim = (p: BoardMinion[], e: BoardMinion[], seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));

/** The benign graft every shop graft writer stores: a real onDeath summon (Contract Rewrite's exact shape). */
const impGraft = (): EffectDef[] => [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'impscrap', count: 2, fixed: true, keyword: 'DS' } }];

describe('capture carries the per-instance fields (q-snap-*, owner rulings 2026-08-27)', () => {
  it('cleanBoard keeps marks, grafts, the stripped flag and the Imp bank — cloned, never shared', () => {
    const heir = mk('h', 'ashen_heir', { impBank: { attack: 2, health: 5 } });
    const s = run([
      heir,
      mk('a', 'alley', { partingCry: true, closedCasket: true, resummon: true }),
      mk('g', 'sandbag', { grantedEffects: impGraft(), echoStripped: true }),
    ]);
    const snap = snapshotBoard(s);
    expect(snap.marksCarried, 'new captures are stamped so the Soren heuristic knows to stand down').toBe(true);
    const [m0, m1, m2] = snap.minions;
    expect(m0!.impBank, "the Heir's bank rides the snapshot").toEqual({ attack: 2, health: 5 });
    expect(m0!.impBank, 'cloned — the pool must never alias the run board').not.toBe(heir.impBank);
    expect([m1!.partingCry, m1!.closedCasket, m1!.resummon], 'all three one-combat marks carried like bloodlust').toEqual([true, true, true]);
    expect(m2!.grantedEffects, 'the runtime graft carried').toHaveLength(1);
    expect(m2!.grantedEffects![0]).not.toBe(s.board[2]!.grantedEffects![0]);
    expect(m2!.echoStripped, 'the "without Echo" mark carried').toBe(true);
  });

  it("a legacy snapshot (fields absent) still loads and fights — absent = today's behaviour", () => {
    const snap = snapshotBoard(run([mk('a', 'alley'), mk('b', 'sandbag')]));
    for (const m of snap.minions) {
      delete m.partingCry; delete m.closedCasket; delete m.resummon;
      delete m.grantedEffects; delete m.echoStripped; delete m.impBank;
    }
    delete snap.marksCarried;
    const r = sim([{ cardId: 'sandbag', attack: 30, health: 60 }], opponentBoard(snap));
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events.some((ev) => ev.type === 'sc' && /parting cry/.test(ev.text ?? ''))).toBe(false);
  });
});

describe("a served board's one-combat marks fire (q-snap-one-combat-marks)", () => {
  it("the served copy's Parting Cry fires its Shout when it dies", () => {
    const snap = snapshotBoard(run([mk('a', 'alley', { partingCry: true })]));
    const r = sim([{ cardId: 'sandbag', attack: 30, health: 60 }], opponentBoard(snap));
    expect(r.events.some((ev) => ev.type === 'sc' && /parting cry/.test(ev.text ?? '')), 'the served Parting Cry fired').toBe(true);
  });

  it("the served copy's Closed Casket detonates at Start of Combat", () => {
    const snap = snapshotBoard(run([mk('a', 'sandbag', { closedCasket: true })]));
    const r = sim([{ cardId: 'sandbag', attack: 1, health: 60 }], opponentBoard(snap));
    const firstAttack = r.events.findIndex((ev) => ev.type === 'attack');
    const firstDeath = r.events.findIndex((ev) => ev.type === 'death' && ev.side === 'enemy');
    expect(firstDeath, 'the marked body died').toBeGreaterThanOrEqual(0);
    expect(firstAttack === -1 || firstDeath < firstAttack, 'destroyed at Start of Combat, before any swing').toBe(true);
  });

  it('Soren: the EXACT player-marked instance is served — the heuristic no longer re-picks a stronger body', () => {
    // The player marked the WEAKER Exgalloper. The legacy heuristic would pick the strongest Echo body.
    const s = run([
      mk('big', 'dw_exgalloper', { attack: 10, health: 10 }),
      mk('weak', 'dw_exgalloper', { attack: 2, health: 2, resummon: true }),
    ], 'soren');
    const board = opponentBoard(snapshotBoard(s));
    expect(board[1]!.resummon, 'the marked instance keeps its mark').toBe(true);
    expect(board[0]!.resummon, 'the unmarked (stronger) body is NOT re-marked by the heuristic').toBeUndefined();
  });

  it('Soren legacy fallback: a pre-carry snapshot (no marksCarried) still reconstructs a mark heuristically', () => {
    const s = run([
      mk('big', 'dw_exgalloper', { attack: 10, health: 10 }),
      mk('weak', 'dw_exgalloper', { attack: 2, health: 2 }),
    ], 'soren');
    const snap = snapshotBoard(s);
    delete snap.marksCarried; // simulate a board recorded before this change
    const board = opponentBoard(snap);
    expect(board[0]!.resummon, 'legacy behaviour preserved: best Echo body gets the mark').toBe(true);
  });
});

describe('runtime-grafted Deathrattles fire in combat (q-snap-granted-effects)', () => {
  it('a grafted Echo fires when the body dies in the PLAYER\'s own fight (instantiate folds it in)', () => {
    const p: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 1, grantedEffects: impGraft() }];
    const r = sim(p, [{ cardId: 'sandbag', attack: 30, health: 60 }]);
    expect(r.events.some((ev) => ev.type === 'summon' && ev.minion.cardId === 'impscrap'), 'the grafted summon fired').toBe(true);
  });

  it('…and the graft rides the reducer\'s player combat mapping (full faceOmen path)', () => {
    let s = run([mk('g', 'sandbag', { attack: 0, health: 1, grantedEffects: impGraft() })]);
    s = reduce(s, { type: 'faceOmen' });
    expect(s.lastCombat, 'combat resolved').toBeTruthy();
    expect(s.lastCombat!.events.some((ev) => ev.type === 'summon' && ev.side === 'player' && ev.minion.cardId === 'impscrap'),
      'the grafted Deathrattle fired in the real player fight').toBe(true);
  });

  it('a SERVED board\'s grafted Echo fires too', () => {
    const snap = snapshotBoard(run([mk('g', 'sandbag', { attack: 1, health: 1, grantedEffects: impGraft() })]));
    const r = sim([{ cardId: 'sandbag', attack: 30, health: 60 }], opponentBoard(snap));
    expect(r.events.some((ev) => ev.type === 'summon' && ev.side === 'enemy' && ev.minion.cardId === 'impscrap'),
      'the served graft fired').toBe(true);
  });

  it('control: without the graft, no impscrap is summoned', () => {
    const r = sim([{ cardId: 'sandbag', attack: 1, health: 1 }], [{ cardId: 'sandbag', attack: 30, health: 60 }]);
    expect(r.events.some((ev) => ev.type === 'summon' && ev.minion.cardId === 'impscrap')).toBe(false);
  });
});

describe('the echoStripped mark silences the Echo in combat (q-snap-echostripped)', () => {
  it('a shop-stripped Exgalloper copy does NOT summon another copy when killed in combat', () => {
    const p: BoardMinion[] = [{ cardId: 'dw_exgalloper', attack: 6, health: 1, echoStripped: true }];
    const r = sim(p, [{ cardId: 'sandbag', attack: 30, health: 60 }]);
    expect(r.events.some((ev) => ev.type === 'summon' && ev.minion.cardId === 'dw_exgalloper'),
      'the printed "without Echo" now holds in combat too (owner wording: the cleansed version must NOT summon itself)').toBe(false);
  });

  it('control: an UNstripped Exgalloper summons its copy on death', () => {
    const p: BoardMinion[] = [{ cardId: 'dw_exgalloper', attack: 6, health: 1 }];
    const r = sim(p, [{ cardId: 'sandbag', attack: 30, health: 60 }]);
    expect(r.events.some((ev) => ev.type === 'summon' && ev.minion.cardId === 'dw_exgalloper')).toBe(true);
  });

  it('a served stripped copy stays silent as well (capture carries the mark)', () => {
    const snap = snapshotBoard(run([mk('x', 'dw_exgalloper', { attack: 6, health: 1, echoStripped: true })]));
    const r = sim([{ cardId: 'sandbag', attack: 30, health: 60 }], opponentBoard(snap));
    expect(r.events.some((ev) => ev.type === 'summon' && ev.minion.cardId === 'dw_exgalloper')).toBe(false);
  });
});

describe("Ashen Heir's shop bank pays a combat summon (q-snap-impbank)", () => {
  const bankBoard = (): BoardMinion[] => [
    { cardId: 'ashen_heir', attack: 5, health: 40, impBank: { attack: 2, health: 5 } },
    // A dying body whose grafted Echo summons Imps mid-fight — the arrival the bank has been waiting for.
    { cardId: 'sandbag', attack: 1, health: 1, grantedEffects: impGraft() },
  ];

  it('an Imp summoned mid-fight collects the shop-banked +2/+5', () => {
    const r = sim(bankBoard(), [{ cardId: 'sandbag', attack: 30, health: 60 }]);
    expect(r.events.some((ev) => ev.type === 'summon' && ev.minion.cardId === 'impscrap'), 'an Imp arrived').toBe(true);
    expect(r.events.some((ev) => ev.type === 'buff' && ev.attack === 2 && ev.health === 5), 'the bank paid out to it').toBe(true);
  });

  it('control: without the bank, no +2/+5 payout', () => {
    const p = bankBoard();
    delete p[0]!.impBank;
    const r = sim(p, [{ cardId: 'sandbag', attack: 30, health: 60 }]);
    expect(r.events.some((ev) => ev.type === 'buff' && ev.attack === 2 && ev.health === 5)).toBe(false);
  });

  it('a SERVED Heir fights with the bank it was captured with', () => {
    const snap = snapshotBoard(run([
      mk('h', 'ashen_heir', { attack: 5, health: 40, impBank: { attack: 2, health: 5 } }),
      mk('g', 'sandbag', { attack: 1, health: 1, grantedEffects: impGraft() }),
    ]));
    const r = sim([{ cardId: 'sandbag', attack: 30, health: 60 }], opponentBoard(snap));
    expect(r.events.some((ev) => ev.type === 'buff' && ev.attack === 2 && ev.health === 5), 'the served bank paid out').toBe(true);
  });

  it("combat never consumes the RUN's bank — the fight spends a clone (documented carry-back choice)", () => {
    const p = bankBoard();
    sim(p, [{ cardId: 'sandbag', attack: 30, health: 60 }]);
    expect(p[0]!.impBank, 'the BoardMinion the caller handed in is untouched').toEqual({ attack: 2, health: 5 });
  });
});
