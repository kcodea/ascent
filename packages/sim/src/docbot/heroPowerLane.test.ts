/**
 * DOC BOT TRIPWIRE 15 — every hero's power DOES something when fired (roadmap L5). The scan itself lives in
 * `heroScan.ts`, shared with the rulebook seeder so the lane and the triage backlog can never disagree.
 */
import { describe, expect, it } from 'vitest';
import { heroScan } from './heroScan';

describe('Doc Bot — hero power lane', () => {
  const results = heroScan();

  it('a majority of hero powers verify ACTIVE through the real action (floor 30)', () => {
    expect(results.filter((r) => r.active).length).toBeGreaterThanOrEqual(30);
  });

  it('the silent-power queue is pinned, each entry named by its power kind', () => {
    const silent = results.filter((r) => !r.active).map((r) => `${r.heroId} [${r.kind}]`);
    const PIN = 24; // Myra + Djinn drained by the Shout/EoT fixture bodies; Hunch armed via a staged prior spell cast (owner triage 2026-08-26)
    expect(silent.length, `${silent.length} hero power(s) changed nothing under the fixture (pin ${PIN}): ${silent.join(', ')} — above the pin: a new hero's power never acted; passive/scheduled kinds get staged or noted in review, an ACTIVE kind here is the §13.5 silent-routing class.`).toBeLessThanOrEqual(PIN);
    expect(silent.length, `only ${silent.length} silent now (pin ${PIN}) — you staged some; lower the pin.`).toBeGreaterThanOrEqual(PIN);
  });
});
