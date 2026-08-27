/**
 * BUG REPORTER (PR 4) — the scenario contract's pure half: parse validation, the serialize→scenario→
 * deserialize round trip, and the combat event-chain projection (structured fields → named lines).
 */
import { describe, expect, it } from 'vitest';
import type { CombatResult, MinionSnapshot } from '@game/core';
import { createRun, deserialize } from '@game/sim';
import { captureIncidentCapsule, type BugCaptureSource } from './bugReportCapture';
import { BUG_SCENARIO_KIND, combatEventLines, parseBugScenario, type BugScenarioFile } from './bugScenario';

function captureSource(run = createRun(4242)): BugCaptureSource {
  return {
    run,
    replayActions: [],
    replayFrames: [],
    inspect: null,
    showLeaderboard: false,
    showRankings: false,
    showRecentGames: false,
    showCareer: false,
    showBook: false,
    showBalance: false,
    showPatchNotes: false,
    combatSpeed: 1,
  };
}

function makeScenario(run = createRun(4242)): BugScenarioFile {
  return {
    schemaVersion: 1,
    kind: BUG_SCENARIO_KIND,
    reportId: 'r-test-1',
    description: 'My Echo triggered but the summoned Beast did not attack.',
    issueType: 'mechanics',
    capsule: captureIncidentCapsule(captureSource(run)),
  };
}

describe('parseBugScenario', () => {
  it('accepts a well-formed scenario file', () => {
    const parsed = parseBugScenario(JSON.stringify(makeScenario()));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.scenario.reportId).toBe('r-test-1');
      expect(parsed.scenario.capsule.seed).toBe(4242);
    }
  });

  it('rejects non-JSON and non-object payloads without throwing', () => {
    expect(parseBugScenario('not json {')).toEqual({ ok: false, errors: ['Not valid JSON.'] });
    expect(parseBugScenario('[1,2,3]').ok).toBe(false);
    expect(parseBugScenario('"just a string"').ok).toBe(false);
  });

  it('rejects a wrong kind', () => {
    const bad = { ...makeScenario(), kind: 'replay-v2' };
    const parsed = parseBugScenario(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(' ')).toContain('kind');
  });

  it('rejects an unsupported schemaVersion', () => {
    const bad = { ...makeScenario(), schemaVersion: 99 };
    const parsed = parseBugScenario(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(' ')).toContain('schemaVersion');
  });

  it('rejects a missing / structurally broken capsule', () => {
    const { capsule: _capsule, ...noCapsule } = makeScenario();
    expect(parseBugScenario(JSON.stringify(noCapsule)).ok).toBe(false);
    const brokenCapsule = { ...makeScenario(), capsule: { seed: 1 } };
    const parsed = parseBugScenario(JSON.stringify(brokenCapsule));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(' ')).toContain('serializedRun');
  });
});

describe('scenario round trip', () => {
  it('a captured run survives serialize → scenario JSON → parse → deserialize', () => {
    const run = createRun(20260827, 'warden');
    const raw = JSON.stringify(makeScenario(run));
    const parsed = parseBugScenario(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = deserialize(parsed.scenario.capsule.serializedRun);
    expect(restored.seed).toBe(run.seed);
    expect(restored.heroId).toBe(run.heroId);
    expect(restored.wave).toBe(run.wave);
    expect(restored.phase).toBe(run.phase);
    expect(restored.shop.map((c) => c.cardId)).toEqual(run.shop.map((c) => c.cardId));
  });
});

describe('combatEventLines', () => {
  const snap = (uid: string, name: string): MinionSnapshot => ({
    uid, cardId: uid, name, tribe: 'beast', attack: 3, health: 2, keywords: [],
  });

  it('resolves uids to card names from the initial rosters and summon events', () => {
    const result = {
      result: 'win',
      playerDamage: 0,
      playerDeathrattles: 0,
      enemyDeaths: 1,
      initial: { player: [snap('p0', 'Alpha Wolf')], enemy: [snap('e0', 'Sandbag')] },
      events: [
        { type: 'attack', attacker: 'p0', defender: 'e0', swing: 3 },
        { type: 'dmg', target: 'e0', amount: 3, remainingHp: 0, source: 'p0' },
        { type: 'death', target: 'e0', side: 'enemy' },
        { type: 'summon', minion: snap('t1', 'Wolf Pup'), side: 'player', index: 1, source: 'p0' },
        { type: 'buff', target: 't1', attack: 1, health: 1, source: 'p0' },
      ],
    } as unknown as CombatResult;
    const lines = combatEventLines(result);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toEqual({ index: 0, type: 'attack', text: 'Alpha Wolf → Sandbag for 3' });
    expect(lines[1]!.text).toBe('Sandbag takes 3 (0 HP left) from Alpha Wolf');
    expect(lines[2]!.text).toBe('Sandbag dies (enemy)');
    // The summoned minion's name registers as the walk passes its summon event…
    expect(lines[3]!.text).toContain('Wolf Pup');
    // …so later events referencing its uid resolve to the name, not the raw uid.
    expect(lines[4]!.text).toBe('Alpha Wolf → Wolf Pup +1/+1');
  });

  it('falls back to the raw uid (and never throws) for unknown references', () => {
    const result = {
      result: 'lose', playerDamage: 3, playerDeathrattles: 0, enemyDeaths: 0,
      initial: { player: [], enemy: [] },
      events: [{ type: 'attack', attacker: 'ghost1', defender: 'ghost2', swing: 1 }],
    } as unknown as CombatResult;
    expect(combatEventLines(result)[0]!.text).toBe('ghost1 → ghost2 for 1');
  });
});
