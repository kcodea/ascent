/**
 * DOC BOT — QaScenarioV1 parity (handoff §14 PR 1: "convert two existing fixtures to prove parity").
 *
 * The two checked-in scenarios are conversions of the two classic Docbot harness shapes:
 *
 *   · recruit-cleric-buff  ← the playScan differential's shape: play an effectful card into a staged board
 *     and prove the effect ACTED with its printed magnitude.
 *   · combat-generic-wave1 ← the combatScan shape: a seeded fight, resolved deterministically.
 *
 * Parity is proven by running the SAME serialized state down the original direct harness path (deserialize →
 * `reduce`, exactly as playScan/the reducer tests drive the engine) and asserting the scenario runner
 * observed the identical outcome — same buffed stats, same combat result, same event sequence, and a
 * byte-identical normalized after-state. One engine, two doors, one answer (§3.1/§3.3).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deserialize } from '../state';
import { reduce } from '../reducer';
import { normalizeRunState, parseQaScenario, runQaScenario, type QaScenarioV1 } from '../qaScenario';
import type { BoardSnapshot } from '../snapshot';

const load = (id: string): QaScenarioV1 => {
  const text = readFileSync(new URL(`./scenarios/${id}.json`, import.meta.url), 'utf8');
  const { scenario, errors } = parseQaScenario(text);
  expect(errors).toEqual([]);
  return scenario!;
};

describe('QaScenarioV1 parity with the original Docbot harness paths', () => {
  it('recruit-cleric-buff: the runner and the direct playScan-style path agree exactly', () => {
    const scenario = load('recruit-cleric-buff');
    const result = runQaScenario(scenario);
    expect(result.ok, result.summary).toBe(true);

    // The original fixture's assertion, driven directly: deserialize the same state, dispatch the same play
    // through the raw reducer (with the runner's hermetic opponent pin mirrored), read the buffed Dragon.
    const direct = deserialize(scenario.state);
    direct.servedBoards = { ...(direct.servedBoards ?? {}), [direct.wave]: null };
    const before = direct.board.find((c) => c.uid === 'tgt0')!;
    const beforeStats = { attack: before.attack, health: before.health };
    const after = reduce(direct, scenario.action!);
    const target = after.board.find((c) => c.uid === 'tgt0')!;

    // Hoard Cleric's printed "+3/+3 to your other Dragons" — the effect acted, at its printed magnitude.
    expect(target.attack - beforeStats.attack).toBe(3);
    expect(target.health - beforeStats.health).toBe(3);
    // And the played Cleric itself is untouched ("other").
    const cleric = after.board.find((c) => c.uid === 'playMe')!;
    expect(cleric.attack).toBe(2);
    expect(cleric.health).toBe(2);

    // Full-state parity: the runner's normalized after-state IS the direct path's, byte for byte.
    expect(result.after).toBe(normalizeRunState(after));
  });

  it('combat-generic-wave1: the runner and the direct faceOmen path agree on result and event sequence', () => {
    const scenario = load('combat-generic-wave1');
    const result = runQaScenario(scenario);
    expect(result.ok, result.summary).toBe(true);

    // The original combat-harness shape, driven directly: pin the exact opponent, hand off through the real
    // faceOmen, read the authoritative combat log.
    const direct = deserialize(scenario.state);
    direct.servedBoards = {
      ...(direct.servedBoards ?? {}),
      [direct.wave]: scenario.combat!.opponent as BoardSnapshot,
    };
    const after = reduce(direct, { type: 'faceOmen' });
    const combat = after.lastCombat!;

    expect(result.combatOutcome).toBe(combat.result);
    expect(result.combatLog!.map((e) => e.type)).toEqual(combat.events.map((e) => e.type));
    expect(result.combatLog!.length).toBe(combat.events.length);
    expect(result.after).toBe(normalizeRunState(after));
  });
});
