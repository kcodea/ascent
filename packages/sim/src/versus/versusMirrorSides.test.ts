/**
 * VERSUS MIRROR = ONE PERSPECTIVE FLIP (live bug 2026-10-14: "cubs and imps were summoning on the wrong side of the
 * board"). The p2 seat watches `mirrorForEnemySeat` of the one fight. The old mirror swapped `initial` but kept the
 * event log's `side` labels, so every summon (Cubs, Imps, Echo / Rally / Start-of-Combat summons, a Rise) landed on
 * the other seat's row. Pinned, over real fights with summons on BOTH sides and both tie-break chairs:
 *  - replaying each seat's own result frame by frame puts every body on the side, and in the slot, it really is on:
 *    p2's player row is p1's enemy row (and vice versa) after EVERY event;
 *  - every side-bearing event is flipped, nothing else changes; uids are untouched;
 *  - an OLD stored mirror (event sides unflipped) is repaired once by `ownSeatPerspective`, and a new one is left alone.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, type BoardMinion, type CombatEvent, type CombatResult, type MinionSnapshot } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { flipEventSides, ownSeatPerspective, resolveVersusFight } from './index';

const minion = (cardId: string): BoardMinion => {
  const d = CARD_INDEX[cardId];
  if (!d) throw new Error(`no card ${cardId}`);
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords] };
};
const side = (ids: string[]) => ({ board: ids.map(minion), state: combatSide(), config: {} });

// Summoners on both sides: Deathrattle Cubs / Imps, Start-of-Combat Imps, a Rally summon, a friend-death summon.
const P1 = ['pack', 'burialimp', 'dm_wrangler', 'n3_recruiter', 'impking', 'twilightwhelp', 'brood'];
const P2 = ['dm_wrangler', 'pack', 'impoverseer', 'wolvesden', 'dm_knocked', 'b2_trex', 'manasaber'];

/** The two rows after each event, folded from a result's OWN perspective (what the replay draws). */
function rowsAfterEach(result: CombatResult): { player: string[]; enemy: string[] }[] {
  const rows = { player: result.initial.player.map((m) => m.uid), enemy: result.initial.enemy.map((m) => m.uid) };
  const out: { player: string[]; enemy: string[] }[] = [];
  for (const e of result.events) {
    if (e.type === 'summon') rows[e.side].splice(Math.min(e.index, rows[e.side].length), 0, e.minion.uid);
    else if (e.type === 'death') { for (const s of ['player', 'enemy'] as const) rows[s] = rows[s].filter((u) => u !== e.target); }
    out.push({ player: [...rows.player], enemy: [...rows.enemy] });
  }
  return out;
}

const summonsOf = (r: CombatResult): Extract<CombatEvent, { type: 'summon' }>[] => r.events.filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon');

describe('the p2 seat sees its own side of the one fight', () => {
  for (const round of [1, 2, 3, 4]) { // both chairs (odd: p1 holds the tie-break, even: p2)
    it(`round ${round}: every body on its real side and slot after every event, for both seats`, () => {
      const f = resolveVersusFight({ matchSeed: 777 + round, round, p1: side(P1), p2: side(P2) });
      // The fight really summoned on both sides.
      const sumP1 = summonsOf(f.p1);
      expect(sumP1.some((e) => e.side === 'player')).toBe(true);
      expect(sumP1.some((e) => e.side === 'enemy')).toBe(true);
      // TOKENS FIRST (owner: "tokens are definitely spawning on the wrong sides"): in BOTH perspectives every summon with a
      // summoner lands on the summoner's own side, at its slot in that side's row.
      for (const persp of [f.p1, f.p2]) {
        const sideOf = new Map<string, 'player' | 'enemy'>();
        for (const m of persp.initial.player) sideOf.set(m.uid, 'player');
        for (const m of persp.initial.enemy) sideOf.set(m.uid, 'enemy');
        let checked = 0;
        for (const e of summonsOf(persp)) {
          const src = e.source ? sideOf.get(e.source) : undefined;
          if (src) { expect(e.side, `${e.minion.cardId} summoned by ${e.source}`).toBe(src); checked++; }
          sideOf.set(e.minion.uid, e.side);
        }
        expect(checked).toBeGreaterThan(0);
      }
      // p2's own board is p2's: the initial rows swap.
      expect(f.p2.initial.player.map((m: MinionSnapshot) => m.uid)).toEqual(f.p1.initial.enemy.map((m) => m.uid));
      expect(f.p2.initial.enemy.map((m: MinionSnapshot) => m.uid)).toEqual(f.p1.initial.player.map((m) => m.uid));
      // Frame by frame: p2's rows are p1's rows swapped.
      const a = rowsAfterEach(f.p1), b = rowsAfterEach(f.p2);
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        expect(b[i]!.player, `event ${i} (${f.p1.events[i]!.type})`).toEqual(a[i]!.enemy);
        expect(b[i]!.enemy, `event ${i} (${f.p1.events[i]!.type})`).toEqual(a[i]!.player);
      }
      // Every side-bearing event is flipped; every other field is identical (uids, targets, slots, amounts).
      expect(f.p2.events.length).toBe(f.p1.events.length);
      f.p1.events.forEach((e, i) => {
        const m = f.p2.events[i]! as Record<string, unknown>;
        const o = e as unknown as Record<string, unknown>;
        if (o.side === 'player' || o.side === 'enemy') expect(m.side).toBe(o.side === 'player' ? 'enemy' : 'player');
        expect({ ...m, side: undefined }).toEqual({ ...o, side: undefined });
      });
      expect(f.p2.sidesMirrored).toBe(true);
      expect(f.p1.sidesMirrored).toBeUndefined();
    });
  }

  it('an old stored mirror (sides unflipped) is repaired once on read; a new one is left alone', () => {
    const f = resolveVersusFight({ matchSeed: 31, round: 1, p1: side(P1), p2: side(P2) });
    const oldStored = { ...f.p2, events: flipEventSides(f.p2.events), sidesMirrored: undefined } as CombatResult; // what the old mirror wrote
    const repaired = ownSeatPerspective(oldStored);
    expect(repaired.events).toEqual(f.p2.events);
    expect(ownSeatPerspective(f.p2)).toBe(f.p2); // already in its own perspective: untouched, never flipped twice
    expect(ownSeatPerspective(ownSeatPerspective(oldStored)).events).toEqual(f.p2.events);
  });
});
