/**
 * SCENE BUILDER ↔ QA SCENARIO bridge — the §4.6 acceptance proof (Docbot handoff PR 2).
 *
 * The contract: a board authored in Scene Builder exports to JSON; that JSON executes headlessly with the
 * same combat result and event sequence as the real reducer path; re-importing it recreates the setup
 * (normalized-state equality); and a doctored/stale content id fails import with an actionable message
 * naming the id (the §3.5 sabotage check — a validator that can't fail is not a validator).
 */
import { describe, expect, it } from 'vitest';
import {
  createRun, deserialize, normalizeRunState, parseQaScenario, reduce, runQaScenario, stableStringify,
  type BoardCard, type BoardSnapshot, type RunState,
} from '@game/sim';
import {
  buildQaScenario, defaultScenarioId, exportContentIds, reproCommandFor, scenarioFileName, scenarioFileText,
  QA_SCENARIO_ID_RE,
} from './qaScenarioBridge';

/** A small authored setup, the way the Scene Builder rig produces one: a real `createRun` state with a
 *  hand-staged board — exactly what `mutate` in the panel does. */
function authoredRun(seed = 24680): RunState {
  const run = createRun(seed);
  const board: BoardCard[] = [
    { uid: 'sb0', cardId: 'emissary', tribe: 'dragon', attack: 2, health: 3, keywords: ['T'], golden: false } as BoardCard,
    { uid: 'sb1', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 2, keywords: [], golden: false } as BoardCard,
  ];
  return { ...run, board, sandbox: true };
}

/** The rig's "set enemies" shape (SceneBuilder.tsx `setEnemies`): a pinned dummy board for THIS wave. */
function pinnedOpponent(run: RunState): BoardSnapshot {
  return {
    v: 1, wave: run.wave, heroId: 'warden', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass',
    power: 10,
    minions: [
      { cardId: 'sandbag', attack: 1, health: 5, keywords: [] },
      { cardId: 'sandbag', attack: 0, health: 3, keywords: [] },
    ],
    seed: 1, origin: 'self',
  } as BoardSnapshot;
}

describe('qaScenarioBridge export', () => {
  it('exports a recruit-phase run with no pinned enemy as a valid recruit scenario', () => {
    const run = authoredRun();
    const scenario = buildQaScenario(run, { createdAt: '2026-08-27T00:00:00.000Z' });
    expect(scenario.schemaVersion).toBe(1);
    expect(scenario.source).toBe('scene-builder');
    expect(scenario.mode).toBe('recruit');
    expect(scenario.combat).toBeUndefined();
    expect(scenario.seed).toBe(run.seed);
    expect(scenario.setId).toBe(run.setId);
    expect(scenario.contentIds).toEqual(['emissary', 'frontdrake']);
    // The keystone's own validator blesses the export — and the parse door round-trips it.
    const { scenario: reparsed, errors } = parseQaScenario(scenarioFileText(scenario));
    expect(errors).toEqual([]);
    expect(stableStringify(reparsed)).toBe(stableStringify(scenario));
  });

  it('id/file/repro naming is stable and filename-safe', () => {
    const run = authoredRun();
    const id = defaultScenarioId(run);
    expect(id).toMatch(QA_SCENARIO_ID_RE);
    expect(scenarioFileName(id)).toBe(`${id}.json`);
    expect(reproCommandFor(id)).toBe(`npm run docbot:scenario -- ${id}`);
    expect(exportContentIds(run)).toEqual(['emissary', 'frontdrake']);
  });

  it('ACCEPTANCE round-trip: export → run headless → re-import hydrates normalized-equal state', () => {
    const run = authoredRun();
    const scenario = buildQaScenario(run);

    // Headless execution of the export succeeds through the real engine (no action: state assertions only).
    const result = runQaScenario(scenario);
    expect(result.validationErrors).toEqual([]);
    expect(result.ok, result.summary).toBe(true);

    // Re-import (the store's hydration door is `deserialize` on scenario.state — same call, no store needed
    // for the pure proof): the hydrated state normalizes byte-equal to the exported run. §4.6: re-importing
    // recreates the visible setup.
    const rehydrated = deserialize(scenario.state);
    expect(normalizeRunState(rehydrated)).toBe(normalizeRunState(run));
  });

  it('ACCEPTANCE combat agreement: a pinned opponent exports as a combat scenario whose headless result matches the real faceOmen path', () => {
    const base = authoredRun(13579);
    const run: RunState = { ...base, servedBoards: { ...(base.servedBoards ?? {}), [base.wave]: pinnedOpponent(base) } };
    const scenario = buildQaScenario(run);
    expect(scenario.mode).toBe('combat');
    expect(scenario.combat?.opponent.minions.map((m) => m.cardId)).toEqual(['sandbag', 'sandbag']);

    const result = runQaScenario(scenario);
    expect(result.validationErrors).toEqual([]);
    expect(result.combatOutcome).toBeDefined();

    // The visual path's outcome: hydrate the same state and hand off through the REAL reducer, exactly as
    // the arena would. Same result, same event sequence, byte-identical normalized after-state.
    const direct = deserialize(scenario.state);
    direct.servedBoards = { ...(direct.servedBoards ?? {}), [direct.wave]: scenario.combat!.opponent as BoardSnapshot };
    const after = reduce(direct, { type: 'faceOmen' });
    expect(result.combatOutcome).toBe(after.lastCombat!.result);
    expect(result.combatLog!.map((e) => e.type)).toEqual(after.lastCombat!.events.map((e) => e.type));
    expect(result.after).toBe(normalizeRunState(after));

    // Determinism: the same scenario runs byte-equivalent twice.
    expect(stableStringify(runQaScenario(scenario))).toBe(stableStringify(result));
  });

  it('SABOTAGE: a doctored/stale content id fails import with an actionable message naming the id', () => {
    const run = authoredRun();
    const scenario = buildQaScenario(run);
    // Doctor the serialized state the way a stale fixture goes stale: a board card id that no longer exists.
    const state = JSON.parse(scenario.state) as { board: Array<{ cardId: string }> };
    state.board[0]!.cardId = 'sb-ghost-card-404';
    const doctored = { ...scenario, state: JSON.stringify(state) };
    const { scenario: parsed, errors } = parseQaScenario(JSON.stringify(doctored));
    expect(parsed).toBeUndefined();
    const msg = errors.join('\n');
    expect(msg).toContain('sb-ghost-card-404'); // names the offending id…
    expect(msg).toMatch(/removed or renamed|regenerate/); // …and says what to do about it
  });

  it('SABOTAGE: a doctored opponent card id fails the same way', () => {
    const base = authoredRun(97531);
    const run: RunState = { ...base, servedBoards: { [base.wave]: pinnedOpponent(base) } };
    const scenario = buildQaScenario(run);
    const doctored = JSON.parse(JSON.stringify(scenario)) as typeof scenario;
    (doctored.combat!.opponent.minions[0] as { cardId: string }).cardId = 'sb-ghost-enemy-404';
    const { scenario: parsed, errors } = parseQaScenario(JSON.stringify(doctored));
    expect(parsed).toBeUndefined();
    expect(errors.join('\n')).toContain('sb-ghost-enemy-404');
  });
});
