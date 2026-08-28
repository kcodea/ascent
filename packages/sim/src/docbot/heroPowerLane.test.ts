/**
 * DOC BOT LANE `heroPowerLane` — every hero's power DOES something when fired (roadmap L5). The scan itself lives in
 * `heroScan.ts`, shared with the rulebook seeder so the lane and the triage backlog can never disagree.
 */
import { describe, expect, it } from 'vitest';
import { heroScan } from './heroScan';
import { SILENT_QUEUE_VERDICTS } from './heroPowerFamilies';

describe('Doc Bot — hero power lane', () => {
  const results = heroScan();

  it('a majority of hero powers verify ACTIVE through the real action (floor 30)', () => {
    expect(results.filter((r) => r.active).length).toBeGreaterThanOrEqual(30);
  });

  it('the silent-power queue is pinned, each entry named by its power kind', () => {
    const silent = results.filter((r) => !r.active).map((r) => `${r.heroId} [${r.kind}]`);
    // PR 4 (2026-08-27): the queue is no longer a generic passive excuse — every silent entry is verified
    // through its activation-family stager (heroPowerStagers.test.ts) or carries a typed needs-stager reason
    // in SILENT_QUEUE_VERDICTS; the exact-match test below keeps the two in lockstep. This pin only says the
    // heroScan FIXTURE still can't see these kinds act (their activation lives outside a bare heroPower click).
    const PIN = 24; // Myra + Djinn drained by the Shout/EoT fixture bodies; Hunch armed via a staged prior spell cast (owner triage 2026-08-26)
    expect(silent.length, `${silent.length} hero power(s) changed nothing under the fixture (pin ${PIN}): ${silent.join(', ')} — above the pin: a new hero's power never acted; give it a stager + verdict (heroPowerStagers.test.ts), an ACTIVE kind here is the §13.5 silent-routing class.`).toBeLessThanOrEqual(PIN);
    expect(silent.length, `only ${silent.length} silent now (pin ${PIN}) — you staged some; lower the pin.`).toBeGreaterThanOrEqual(PIN);
  });

  it('the silent set and the stager verdicts match exactly — no unverified stragglers, no stale entries', () => {
    const silent = results.filter((r) => !r.active).map((r) => r.heroId).sort();
    expect(silent).toEqual(Object.keys(SILENT_QUEUE_VERDICTS).sort());
  });
});
