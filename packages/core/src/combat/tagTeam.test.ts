import { describe, it, expect } from 'vitest';
import {
  combatSide, fuzzCombatBoard, fuzzCombatSide, makeRng, simulate,
  type BoardMinion, type CombatCarryBacks, type CombatEvent, type CombatResult, type CombatSideState, type FuzzPool,
} from '../index';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';

/**
 * R-DUOS-TAGTEAM-01: TAG-TEAM COMBAT (Versus Duos, owner 2026-10-25). "one combat per round, team vs team. Your board
 * fights first; when it is wiped, your teammate's board steps in against whatever survived on the other side."
 *
 * `simulate(..., { reserve: { player?, enemy? } })`: each side may carry a SECOND board with its own run context. When a
 * side's board is wiped, its reserve steps in (a `boardFallen` then a `tagIn` beat), runs its own Start of Combat against
 * the survivors, and the fight goes on. Each team member's carry-backs come back separately (`result.tagTeam`).
 *
 * Proven here: an ordinary fight is untouched; the step-in happens and the fight is decided by the last board standing;
 * the tag-team fight is deterministic and 1:1 SYMMETRIC (the R-SYMMETRY-01 mirror, now with two boards a side); each
 * member's carry-backs are its own.
 */

const SET_IDS: SetId[] = ['set1', 'set2', 'set3'];
const fp = (set: SetId): FuzzPool => ({ ...poolFor(set), tribes: SETS[set].tribes });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function swapSides<T>(x: T): T {
  if (x === 'player') return 'enemy' as T;
  if (x === 'enemy') return 'player' as T;
  if (Array.isArray(x)) return x.map(swapSides) as T;
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) out[k] = swapSides(v);
    return out as T;
  }
  return x;
}
const neutralText = (s: string): string => s.replace(/Fleeting Vigor — your minions surge/g, 'Fleeting Vigor: SIDE minions surge')
  .replace(/Fleeting Vigor: their minions surge/g, 'Fleeting Vigor: SIDE minions surge');
const norm = (c: object | undefined): unknown => c && JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined))));
const sandbag = (n: number, attack: number, health: number, tag: string): BoardMinion[] =>
  Array.from({ length: n }, (_, i) => ({ cardId: 'sandbag', attack, health, sourceUid: `${tag}${i}` }));
const ofType = <T extends CombatEvent['type']>(r: CombatResult, t: T): Extract<CombatEvent, { type: T }>[] =>
  r.events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === t);

interface Team { board: BoardMinion[]; state: CombatSideState; reserve: BoardMinion[]; reserveState: CombatSideState }

function fight(A: Team, B: Team, seed: number, swap = false): CombatResult {
  const a = clone(A);
  const b = clone(B);
  return swap
    ? simulate(b.board, a.board, makeRng(seed), CARD_INDEX, b.state, a.state, {
      firstSide: 'enemy',
      reserve: { player: { board: b.reserve, state: b.reserveState }, enemy: { board: a.reserve, state: a.reserveState } },
    })
    : simulate(a.board, b.board, makeRng(seed), CARD_INDEX, a.state, b.state, {
      reserve: { player: { board: a.reserve, state: a.reserveState }, enemy: { board: b.reserve, state: b.reserveState } },
    });
}

function fuzzTeam(r: ReturnType<typeof makeRng>, set: SetId, tag: string): Team {
  const board = fuzzCombatBoard(r, fp(set), `${tag}1`);
  const state = fuzzCombatSide(r, fp(set), `${tag}1`, board);
  const reserve = fuzzCombatBoard(r, fp(set), `${tag}2`);
  const reserveState = fuzzCombatSide(r, fp(set), `${tag}2`, reserve);
  return { board, state, reserve, reserveState };
}

describe('R-DUOS-TAGTEAM-01: tag-team combat', () => {
  it('no reserve (or an empty one) is an ordinary fight, byte for byte', () => {
    const r = makeRng(5);
    const A = fuzzCombatBoard(r, fp('set2'), 'A');
    const B = fuzzCombatBoard(r, fp('set2'), 'B');
    const sA = fuzzCombatSide(r, fp('set2'), 'A', A);
    const sB = fuzzCombatSide(r, fp('set2'), 'B', B);
    const plain = simulate(clone(A), clone(B), makeRng(3), CARD_INDEX, clone(sA), clone(sB));
    const empty = simulate(clone(A), clone(B), makeRng(3), CARD_INDEX, clone(sA), clone(sB), { reserve: {} });
    expect(JSON.stringify(empty)).toBe(JSON.stringify(plain));
    expect(plain.tagTeam).toBeUndefined();
  });

  it('the wiped side\'s reserve steps in against the survivors, and the last board standing decides', () => {
    // A: one big body. B: two small boards. A kills B's first board, then B's second, and wins.
    const A: Team = { board: sandbag(1, 10, 100, 'A'), state: combatSide(), reserve: sandbag(1, 1, 1, 'a'), reserveState: combatSide() };
    const B: Team = { board: sandbag(2, 1, 2, 'B'), state: combatSide(), reserve: sandbag(3, 1, 2, 'b'), reserveState: combatSide() };
    const res = fight(A, B, 11);
    expect(res.result).toBe('win');
    const fallen = ofType(res, 'boardFallen');
    const tagIns = ofType(res, 'tagIn');
    expect(fallen.map((e) => [e.side, e.member])).toEqual([['enemy', 0]]);
    expect(tagIns.map((e) => [e.side, e.member, e.minions.length])).toEqual([['enemy', 1, 3]]);
    // The fallen beat comes first, the step-in right after, and the new bodies then fight.
    const iFall = res.events.indexOf(fallen[0]!);
    const iIn = res.events.indexOf(tagIns[0]!);
    expect(iFall).toBeLessThan(iIn);
    const newUids = new Set(tagIns[0]!.minions.map((m) => m.uid));
    expect(res.events.slice(iIn).some((e) => e.type === 'attack' && newUids.has(e.attacker))).toBe(true);
    expect(res.tagTeam?.tagInAt.enemy).toBe(iIn);
    // A's reserve never stepped in: one member's carry-backs. B's two boards: two, each its own deaths.
    expect(res.tagTeam?.members.player).toHaveLength(1);
    const bMembers = res.tagTeam!.members.enemy!;
    expect(bMembers).toHaveLength(2);
    expect(bMembers[0]!.deaths).toBe(2);
    expect(bMembers[1]!.deaths).toBe(3);
  });

  it('a reserve can win it: the first board falls, the teammate finishes the fight', () => {
    const A: Team = { board: sandbag(1, 1, 1, 'A'), state: combatSide(), reserve: sandbag(2, 20, 50, 'a'), reserveState: combatSide() };
    const B: Team = { board: sandbag(2, 3, 6, 'B'), state: combatSide(), reserve: [], reserveState: combatSide() };
    const res = fight(A, B, 4);
    expect(res.result).toBe('win');
    expect(ofType(res, 'tagIn').map((e) => e.side)).toEqual(['player']);
    const [first, second] = res.tagTeam!.members.player!;
    expect(first!.deaths).toBe(1);
    expect(second!.foeDeaths).toBe(2); // only its own kills
    expect(first!.foeDeaths).toBe(0);
  });

  it('both boards of a team gone = that team loses; both teams gone together = a draw', () => {
    const weak: Team = { board: sandbag(1, 1, 1, 'W'), state: combatSide(), reserve: sandbag(1, 1, 1, 'w'), reserveState: combatSide() };
    const strong: Team = { board: sandbag(1, 5, 50, 'S'), state: combatSide(), reserve: sandbag(1, 5, 50, 's'), reserveState: combatSide() };
    expect(fight(weak, strong, 2).result).toBe('lose');
    // Two 1/1 vs 1/1 boards on each side: every clash is mutual, so both reserves step in and both fall.
    const res = fight(weak, clone(weak), 2);
    expect(res.result).toBe('draw');
    expect(ofType(res, 'tagIn')).toHaveLength(2);
  });

  it('an empty first board hands straight over to the reserve', () => {
    const A: Team = { board: [], state: combatSide(), reserve: sandbag(1, 5, 50, 'a'), reserveState: combatSide() };
    const B: Team = { board: sandbag(1, 1, 3, 'B'), state: combatSide(), reserve: [], reserveState: combatSide() };
    const res = fight(A, B, 8);
    expect(res.result).toBe('win');
    expect(ofType(res, 'tagIn')[0]?.side).toBe('player');
  });

  it('the reserve fights with ITS OWN run context: its Start of Combat fires on step-in, the first board does not repeat its own', () => {
    // Rulebreaker's Crown (`doubleLeftmostAttack`): Start of Combat, the left-most minion doubles its Attack.
    const crown = { ...combatSide(), questMods: { doubleLeftmostAttack: true } };
    const A: Team = { board: sandbag(1, 50, 500, 'A'), state: combatSide(), reserve: [], reserveState: combatSide() };
    const B: Team = { board: sandbag(1, 1, 1, 'B'), state: combatSide(), reserve: sandbag(2, 3, 60, 'b'), reserveState: crown };
    const res = fight(A, B, 1);
    const crowned = (evs: CombatEvent[]): boolean => evs.some((e) => e.type === 'questTrigger' && e.flag === 'doubleLeftmostAttack');
    const tagIn = ofType(res, 'tagIn')[0]!;
    const at = res.events.indexOf(tagIn);
    expect(crowned(res.events.slice(at)), 'the reserve fires its own Crown when it steps in').toBe(true);
    expect(crowned(res.events.slice(0, at)), 'the first board had none').toBe(false);
    // ...and the other way round: a Crown on the FIRST board does not fire again for a reserve without one.
    const B2: Team = { board: sandbag(1, 1, 1, 'B'), state: crown, reserve: sandbag(2, 3, 60, 'b'), reserveState: combatSide() };
    const res2 = fight(A, B2, 1);
    const at2 = res2.events.indexOf(ofType(res2, 'tagIn')[0]!);
    expect(crowned(res2.events.slice(0, at2))).toBe(true);
    expect(crowned(res2.events.slice(at2))).toBe(false);
  });

  it('is deterministic: the same inputs give the same fight', () => {
    const r = makeRng(99);
    const A = fuzzTeam(r, 'set3', 'A');
    const B = fuzzTeam(r, 'set3', 'B');
    expect(JSON.stringify(fight(A, B, 17))).toBe(JSON.stringify(fight(A, B, 17)));
  });

  for (const set of SET_IDS) {
    it(`${set}: 150 random 2v2 fights mirror exactly (R-SYMMETRY-01 with two boards a side)`, () => {
      let tagIns = 0;
      for (let seed = 1; seed <= 150; seed++) {
        const r = makeRng(seed * 104729 + set.charCodeAt(3));
        const A = fuzzTeam(r, set, 'A');
        const B = fuzzTeam(r, set, 'B');
        const r1 = fight(A, B, seed);
        const r2 = swapSides(fight(A, B, seed, true));
        const ctx = `${set} seed ${seed}`;
        expect(r2.result === 'win' ? 'lose' : r2.result === 'lose' ? 'win' : 'draw', `${ctx}: outcome`).toBe(r1.result);
        const e1 = neutralText(JSON.stringify(r1.events));
        const e2 = neutralText(JSON.stringify(r2.events));
        if (e1 !== e2) {
          const i = r1.events.findIndex((e, k) => neutralText(JSON.stringify(e)) !== neutralText(JSON.stringify(r2.events[k])));
          expect.fail(`${ctx}: logs differ at #${i}\n  ${JSON.stringify(r1.events[i])}\n  ${JSON.stringify(r2.events[i])}`);
        }
        // Each team member's ledger is the same whichever side its team fought on.
        const m1 = r1.tagTeam!.members;
        const m2 = r2.tagTeam!.members; // keys are not swapped by `swapSides`: in the swapped fight A is the ENEMY
        expect((m2.enemy ?? []).map((c: CombatCarryBacks) => norm(c)), `${ctx}: A's members`).toEqual((m1.player ?? []).map((c) => norm(c)));
        expect((m2.player ?? []).map((c: CombatCarryBacks) => norm(c)), `${ctx}: B's members`).toEqual((m1.enemy ?? []).map((c) => norm(c)));
        tagIns += ofType(r1, 'tagIn').length;
      }
      expect(tagIns, 'reserves actually stepped in').toBeGreaterThan(50);
    });
  }
});
