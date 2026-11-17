/**
 * Reference-building helpers shared by the v1 (`cli.ts`) and v2 (`cliV2.ts`) strength commands.
 */
import { makeRng, simulate } from '@game/core';
import { CARD_INDEX, poolFor, type SetId } from '@game/content';
import { opponentBoard, sideFromSnapshot, type BoardSnapshot } from '@game/sim';

export const SET: SetId = 'set2';

/** Combat-only fields: the reference file ships in the web build (lazily), so display fields are dropped. */
const DISPLAY_ONLY = ['id', 'author', 'ownerId', 'remote', 'cosmetics', 'capturedAt', 'patch', 'quests', 'runes', 'rating', 'result', 'origin', 'wins', 'armor', 'runStrength'] as const;
export function trimForReference(s: BoardSnapshot): BoardSnapshot {
  const out = { ...s, resolve: 0, triples: 0, power: 0 } as BoardSnapshot & Record<string, unknown>;
  for (const k of DISPLAY_ONLY) delete out[k];
  return out;
}

/** Round robin inside one wave: every pair fights once (sides alternate by pair), seeded. Returns win rates. */
export function roundRobin(boards: readonly BoardSnapshot[], wave: number): number[] {
  const poolIds = poolFor(SET).all.map((c) => c.id);
  const sides = boards.map((b) => sideFromSnapshot(b, b.tier, poolIds));
  const pts = boards.map(() => 0);
  const games = boards.map(() => 0);
  for (let i = 0; i < boards.length; i++) {
    for (let j = i + 1; j < boards.length; j++) {
      const flip = (i + j) % 2 === 1;
      const [a, b] = flip ? [j, i] : [i, j];
      const r = simulate(opponentBoard(boards[a]!), opponentBoard(boards[b]!), makeRng((wave * 7919) ^ (a * 104729) ^ (b * 1299709)), CARD_INDEX, sides[a]!, sides[b]!);
      const pa = r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0;
      pts[a]! += pa; pts[b]! += 1 - pa; games[a]!++; games[b]!++;
    }
  }
  return pts.map((p, i) => (games[i]! ? p / games[i]! : 0.5));
}
