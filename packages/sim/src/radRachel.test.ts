import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '@game/core';
import { ARCHIVED_CARDS, CARD_INDEX, SETS, poolFor } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { fireRallies } from './recruit';

/**
 * RAD RACHEL (Set 2 Demon, owner add 2026-10-10): T6 8/10, "When a Demon deals damage, give your minions +2/+1."
 * Gilded +4/+2. Impossible Todd's trigger (`friendlyDemonDealtDamage`, a LANDED hit by a friendly Demon), paying every
 * living friendly minion, Rachel included.
 *
 * PERMANENCE, the owner's phase ruling (2026-10-11, R-BUFF-PHASE-01): "it is combat only if triggered in combat, if a
 * minion is engraved, they obviously carry it back, and if the effect is triggered in recruit phase, it would be
 * permanent." The three cases are pinned below on the real simulate / settle / Shop paths.
 *
 * Also here: Cavern Fiend's archive (owner 2026-10-10).
 */
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });
const bc = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, ...(d.tribe2 ? { tribe2: d.tribe2 } : {}), attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra } as BoardCard;
};
const sim = (p: BoardMinion[], e: BoardMinion[], seed = 3) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
/** A 0-Attack wall: it never kills, so the fight runs until the step cap and the buffs are easy to count. */
const wall: BoardMinion[] = [{ cardId: 'trainingdummy', attack: 0, health: 90000, keywords: [] }];
const buffsFrom = (r: CombatResult, src: string) =>
  r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === src);
/** Landed hits by the player's Demons (Rachel's own count too once her buffs give her Attack). */
const demonHits = (r: CombatResult) => {
  const demons = new Set(r.initial.player.filter((p) => CARD_INDEX[p.cardId]?.tribe === 'demon').map((p) => p.uid));
  return r.events.filter((e) => e.type === 'dmg' && typeof e.source === 'string' && demons.has(e.source) && e.amount > 0).length;
};
const settleOnto = (board: BoardCard[], r: CombatResult): RunState =>
  reduce({ ...createRun(1), phase: 'combat', board, lastCombat: r } as RunState, { type: 'resolveCombat' }) as RunState;
const shopRun = (board: BoardCard[]): RunState =>
  ({ ...createRun(5, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 30, board, hand: [] } as RunState);

describe('Rad Rachel: the card', () => {
  it('T6 8/10 Demon, the owner text, appended at the very end of set 2 after Gasket', () => {
    const d = CARD_INDEX['dm_radrachel']!;
    expect(d).toMatchObject({ tier: 6, attack: 8, health: 10, tribe: 'demon' });
    expect(d.text).toBe('When a **Demon** deals damage, give your minions **+2/+1**.');
    expect(d.goldenText).toBe('When a **Demon** deals damage, give your minions **+4/+2**.');
    const own = SETS.set2.own.map((c) => c.id);
    expect(own.indexOf('dm_radrachel')).toBe(own.indexOf('dm_gasket') + 1);
    expect(poolFor('set2').buyable.map((c) => c.id)).toContain('dm_radrachel');
  });
});

describe('Rad Rachel in COMBAT: every landed Demon hit gives every friendly minion +2/+1, for this combat only', () => {
  // m0 Rachel (0 Attack, so only the Demon swings land), m1 a 3-Attack Demon, m2 a neutral.
  const board = (golden = false, eg = false) => [
    bm('dm_radrachel', 'R', 0, 900, { golden }), bm('dm_clerk', 'D', 3, 900), bm('trainingdummy', 'N', 0, 900, eg ? { keywords: ['EG'] } : {}),
  ];

  it('one buff to each living friend per landed hit, Rachel included, +2/+1 (Gilded +4/+2)', () => {
    for (const golden of [false, true]) {
      const r = sim(board(golden), wall);
      const rachel = r.initial.player[0]!.uid;
      const all = buffsFrom(r, rachel);
      const hits = demonHits(r);
      expect(hits, 'the Demons landed hits').toBeGreaterThan(0);
      for (const p of r.initial.player) {
        const mine = all.filter((b) => b.target === p.uid);
        expect(mine.length, `${p.cardId} gets one buff per hit`).toBe(hits);
        expect(mine.every((b) => b.attack === (golden ? 4 : 2) && b.health === (golden ? 2 : 1))).toBe(true);
      }
    }
  });

  it('CASE 1, combat only: nothing carries back to the run board', () => {
    const r = sim(board(), wall);
    expect((r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'N')).toEqual([]);
    const s = settleOnto([bc('R', 'dm_radrachel'), bc('D', 'dm_clerk'), bc('N', 'trainingdummy', { keywords: [] })], r);
    const n = s.board.find((c) => c.uid === 'N')!;
    expect([n.attack, n.health], 'the run-board minion is exactly as it was').toEqual([CARD_INDEX['trainingdummy']!.attack, CARD_INDEX['trainingdummy']!.health]);
  });

  it('CASE 2, Engraved: an Engraved minion carries the fight\'s gains back', () => {
    const r = sim(board(false, true), wall);
    const perma = (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'N');
    const hits = demonHits(r);
    expect(perma.reduce((n, p) => n + p.attack, 0)).toBe(2 * hits);
    const s = settleOnto([bc('R', 'dm_radrachel'), bc('D', 'dm_clerk'), bc('N', 'trainingdummy', { keywords: ['EG'] })], r);
    expect(s.board.find((c) => c.uid === 'N')!.attack).toBe(CARD_INDEX['trainingdummy']!.attack + 2 * hits);
  });

  it('a hit absorbed by a Ward is not damage dealt: no buff', () => {
    const r = sim([bm('dm_radrachel', 'R', 0, 900), bm('dm_clerk', 'D', 3, 900)], [{ cardId: 'trainingdummy', attack: 0, health: 1, keywords: ['DS'] }]);
    const rachel = r.initial.player[0]!.uid;
    const landed = demonHits(r);
    expect(buffsFrom(r, rachel).length).toBe(2 * landed); // two living friends per landed hit, none for the pop
  });

  it('is deterministic', () => {
    expect(JSON.stringify(sim(board(true), wall, 9).events)).toBe(JSON.stringify(sim(board(true), wall, 9).events));
  });
});

describe('Rad Rachel in the SHOP: a Demon dealing damage in the Recruit phase gives a PERMANENT buff (CASE 3)', () => {
  it('a Shop-fired Gasket Rally hitting a non-Demon gives every minion +2/+1 permanently, per landed hit', () => {
    const s = shopRun([bc('g', 'dm_gasket'), bc('r', 'dm_radrachel'), bc('n', 'trainingdummy', { health: 10, keywords: [] })]);
    fireRallies(s);
    const by = (u: string) => s.board.find((c) => c.uid === u)!;
    // One landed hit (the neutral), so one Rachel proc: +2/+1 on all three, the neutral net 10 - 2 + 1.
    expect([by('g').attack, by('g').health]).toEqual([9, 4]);
    expect([by('r').attack, by('r').health]).toEqual([10, 11]);
    expect([by('n').attack, by('n').health]).toEqual([1 + 2, 9]);
    expect(by('r').buffs?.some((b) => b.source === 'Rad Rachel'), 'a permanent Shop buff line').toBe(true);
  });

  it('Gilded Rachel: +4/+2; Gilded Gasket: two passes = two procs', () => {
    const s = shopRun([bc('g', 'dm_gasket', { golden: true, attack: 14, health: 6 }), bc('r', 'dm_radrachel', { golden: true, attack: 16, health: 20 }), bc('n', 'trainingdummy', { health: 10, keywords: [] })]);
    fireRallies(s);
    const r = s.board.find((c) => c.uid === 'r')!;
    expect([r.attack, r.health]).toEqual([16 + 8, 20 + 4]);
  });

  it('no non-Demon to hit = no damage dealt = no proc', () => {
    const s = shopRun([bc('g', 'dm_gasket'), bc('r', 'dm_radrachel')]);
    fireRallies(s);
    expect(s.board.find((c) => c.uid === 'r')!.attack).toBe(8);
  });
});

describe('Cavern Fiend is archived (owner 2026-10-10)', () => {
  it('lives in ARCHIVED_CARDS, in no set, and still resolves by id for old saves and replays', () => {
    expect(ARCHIVED_CARDS.some((c) => c.id === 'k_gemgorge')).toBe(true);
    for (const id of Object.keys(SETS) as (keyof typeof SETS)[]) {
      expect(poolFor(id).all.some((c) => c.id === 'k_gemgorge'), id).toBe(false);
    }
    expect(CARD_INDEX['k_gemgorge']?.name).toBe('Cavern Fiend');
  });
});
