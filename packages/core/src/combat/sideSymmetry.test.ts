import { describe, it, expect } from 'vitest';
import {
  combatSide, fuzzCombatBoard, fuzzCombatSide, makeRng, simulate,
  type BoardMinion, type CombatResult, type CombatSideState, type FuzzPool,
} from '../index';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';

/**
 * R-SYMMETRY-01 — THE MIRROR TEST (owner ruling 2026-10-13: "it's imperative that both sides are equal in what's
 * captured, represented, buffed etc. they should be 1:1 exact").
 *
 * For many seeds and many generated board pairs across sets 1-3, each side carrying a random run context (spell
 * power, tallies, auras, hand, Ruby strength…) and a random handful of quest / rune / hero combat mods drawn from
 * the WHOLE `QuestCombatMods` catalogue:
 *
 *   r1 = simulate(A, B, seed)                              A fights as `player`
 *   r2 = simulate(B, A, seed, { firstSide: 'enemy' })      A fights as `enemy`
 *
 * must be the SAME fight up to the side swap: the outcome mirrors, both damages swap, every event is identical
 * once `player` <-> `enemy` is swapped (stats, deaths, summons, buffs, grants, triggers, step tags), the starting
 * snapshots swap, and each board's carry-backs are identical whichever side it fought on.
 *
 * WHY `firstSide`: a few things happen to both sides "at once" (the Start-of-Combat passes, a board-wide spray,
 * which board mints its combat uids first, which side's random hand grants draw from the fight's main RNG stream,
 * and which side "heads" names on the seeded first-attacker coin). Some order must be picked, and picking it by
 * LABEL would make the RNG draw order differ between the two fights, so exact mirroring would be impossible.
 * `firstSide` names the side that goes first by ROLE; the default (`player`) is the order every recorded fight was
 * resolved in. With the role pinned, the two fights draw the same random numbers in the same order and must agree
 * exactly. That tie-break is the only permitted difference between the sides.
 *
 * NOT compared: `enemyScalers` (a presentation channel that describes the ENEMY board's run scalers to the UI's
 * card-text chain; the player board's text reads the live run instead, so by construction it is one-sided).
 */

const SET_IDS: SetId[] = ['set1', 'set2', 'set3'];
/** The shared fixture generator (`fuzz.ts`) takes the set's pool; core cannot import content itself. */
const fp = (set: SetId): FuzzPool => ({ ...poolFor(set), tribes: SETS[set].tribes });
/** Swap every `player` <-> `enemy` string, deeply. Card ids, texts and uids never equal either word. */
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

/** The viewer-seat narration ("your" / "their") is the one wording that legitimately reads per seat. */
const neutralText = (s: string): string => s.replace(/Fleeting Vigor — your minions surge/g, 'Fleeting Vigor: SIDE minions surge')
  .replace(/Fleeting Vigor: their minions surge/g, 'Fleeting Vigor: SIDE minions surge');
const normEvents = (r: CombatResult): string => neutralText(JSON.stringify(r.events));

/** The player's legacy `player*` fields, re-keyed to the side-agnostic `CombatCarryBacks` shape. */
function playerCarry(r: CombatResult): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rr = r as unknown as Record<string, unknown>;
  for (const k of Object.keys(r.enemyCarry!)) {
    const field = k === 'foeDeaths' ? 'enemyDeaths' : `player${k[0]!.toUpperCase()}${k.slice(1)}`;
    out[k] = k === 'deaths' ? (rr.playerDeaths ?? 0) : rr[field];
  }
  return out;
}
const norm = (c: object): Record<string, unknown> =>
  JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)))) as Record<string, unknown>;

/** First index where the two event logs differ, for a readable failure. */
function firstDiff(a: unknown[], b: unknown[]): string {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = neutralText(JSON.stringify(a[i]));
    const y = neutralText(JSON.stringify(b[i]));
    if (x !== y) return `event #${i}:\n  as player: ${x}\n  as enemy (swapped): ${y}`;
  }
  return 'none';
}

function assertMirror(label: string, A: BoardMinion[], B: BoardMinion[], sA: CombatSideState, sB: CombatSideState, seed: number): CombatResult {
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const r1 = simulate(clone(A), clone(B), makeRng(seed), CARD_INDEX, clone(sA), clone(sB));
  const r2 = simulate(clone(B), clone(A), makeRng(seed), CARD_INDEX, clone(sB), clone(sA), { firstSide: 'enemy' });
  const mirrored = swapSides(r2);
  const ctx = `${label} (seed ${seed})`;
  // Outcome + damage.
  const flip = { win: 'lose', lose: 'win', draw: 'draw' } as const;
  expect(flip[r2.result], `${ctx}: outcome`).toBe(r1.result);
  // r1.enemyDamage = what A (player) dealt B; in r2 A is the enemy, so that is r2.playerDamage — and vice versa.
  expect(r2.playerDamage, `${ctx}: A's damage to B`).toBe(r1.enemyDamage);
  expect(r2.enemyDamage, `${ctx}: B's damage to A`).toBe(r1.playerDamage);
  expect(JSON.stringify(r2.damageBreakdown), `${ctx}: A's damage breakdown`).toBe(JSON.stringify(r1.enemyDamageBreakdown));
  expect(JSON.stringify(r2.enemyDamageBreakdown), `${ctx}: B's damage breakdown`).toBe(JSON.stringify(r1.damageBreakdown));
  // Starting boards (A's bodies mint the same uids in both fights: the first side mints first).
  expect(JSON.stringify(r2.initial.enemy), `${ctx}: A's starting snapshot`).toBe(JSON.stringify(r1.initial.player));
  expect(JSON.stringify(r2.initial.player), `${ctx}: B's starting snapshot`).toBe(JSON.stringify(r1.initial.enemy));
  // Every event, up to the side swap.
  if (normEvents(r1) !== neutralText(JSON.stringify(mirrored.events))) {
    expect.fail(`${ctx}: event logs differ — ${firstDiff(r1.events, mirrored.events)}`);
  }
  // Carry-backs: each board's ledger is the same whichever side it fought on.
  expect(norm(r2.enemyCarry!), `${ctx}: A's carry-backs`).toEqual(norm(playerCarry(r1)));
  expect(norm(playerCarry(r2)), `${ctx}: B's carry-backs`).toEqual(norm(r1.enemyCarry!));
  return r1;
}

describe('R-SYMMETRY-01 — combat is 1:1 symmetric between the two sides', () => {
  for (const set of SET_IDS) {
    it(`${set}: 300 random board pairs, random run contexts + combat mods, mirror exactly`, () => {
      let events = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const r = makeRng(seed * 7919 + set.length * 31 + set.charCodeAt(3));
        const A = fuzzCombatBoard(r, fp(set), 'A');
        const B = fuzzCombatBoard(r, fp(set), 'B');
        const sA = fuzzCombatSide(r, fp(set), 'A', A);
        const sB = fuzzCombatSide(r, fp(set), 'B', B);
        events += assertMirror(set, A, B, sA, sB, seed).events.length;
      }
      expect(events, 'the fights did something').toBeGreaterThan(1000);
    });
  }

  it('an empty context mirrors too (the harness / procedural shape)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = makeRng(seed);
      const set = SET_IDS[seed % 3]!;
      assertMirror('bare', fuzzCombatBoard(r, fp(set), 'A'), fuzzCombatBoard(r, fp(set), 'B'), combatSide(), combatSide(), seed);
    }
  });

  it('Pre-emptive Assault is a per-side option: the enemy can strike first exactly like the player', () => {
    const A: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 10, sourceUid: 'A0' }];
    const B: BoardMinion[] = [
      { cardId: 'sandbag', attack: 3, health: 10, sourceUid: 'B0' },
      { cardId: 'sandbag', attack: 3, health: 10, sourceUid: 'B1' },
    ];
    // B has more minions, so B would normally swing first; Pre-emptive Assault puts A first — on either side.
    const asPlayer = simulate(A, B, makeRng(4), CARD_INDEX, combatSide(), combatSide(), { playerAttacksFirst: true });
    const asEnemy = simulate(B, A, makeRng(4), CARD_INDEX, combatSide(), combatSide(), { enemyAttacksFirst: true, firstSide: 'enemy' });
    const firstAttack = (r: CombatResult): string | undefined => (r.events.find((e) => e.type === 'attack') as { attacker?: string } | undefined)?.attacker;
    expect(firstAttack(asPlayer)).toBe(asPlayer.initial.player[0]!.uid);
    expect(firstAttack(asEnemy)).toBe(asEnemy.initial.enemy[0]!.uid);
    expect(normEvents(asPlayer)).toBe(neutralText(JSON.stringify(swapSides(asEnemy).events)));
    // Both sides holding it cancel out: the normal rule (more minions first) decides.
    const both = simulate(A, B, makeRng(4), CARD_INDEX, combatSide(), combatSide(), { playerAttacksFirst: true, enemyAttacksFirst: true });
    expect(firstAttack(both)).toBe(both.initial.enemy[0]!.uid);
  });

  it('the default tie-break is the historical one: omitting firstSide = firstSide player (byte-identical)', () => {
    const r = makeRng(77);
    const A = fuzzCombatBoard(r, fp('set1'), 'A');
    const B = fuzzCombatBoard(r, fp('set1'), 'B');
    const sA = fuzzCombatSide(r, fp('set1'), 'A', A);
    const sB = fuzzCombatSide(r, fp('set1'), 'B', B);
    const a = simulate(A, B, makeRng(9), CARD_INDEX, sA, sB);
    const b = simulate(A, B, makeRng(9), CARD_INDEX, sA, sB, { firstSide: 'player' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
