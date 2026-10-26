/**
 * R-DUOS-FLOW-01 (owner 2026-10-26: "there's a ton of hang time when time hits 0 / when both players ready up, id like to
 * make that more seamless"). The per-round timeline that measures the hang, and the flow's structural promises in the
 * session store: the client that closed a round asks the resolver at once (the others only as a backstop), the match row
 * and the committed round are read together, the close runs on its own timer, and the realtime coalesce is short.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markFlow, resetFlowTimings, versusFlowTimings } from './flowTiming';

afterEach(() => resetFlowTimings());

describe('the flow timeline', () => {
  it('keeps the first mark per (match, round) and reports offsets from the earliest', () => {
    markFlow('m', 3, 'ready:sent', 1000);
    markFlow('m', 3, 'closed:seen', 1180);
    markFlow('m', 3, 'closed:seen', 1500); // a later sighting changes nothing
    markFlow('m', 3, 'finalize:start', 1181);
    markFlow('m', 3, 'finalize:done', 1700);
    markFlow('m', 3, 'combat:seen', 1820);
    markFlow('m', 3, 'fight:on', 2400);
    const [row] = versusFlowTimings();
    expect(row!.key).toBe('m|3');
    expect(row!.offsets).toEqual({ 'ready:sent': 0, 'closed:seen': 180, 'finalize:start': 181, 'finalize:done': 700, 'combat:seen': 820, 'fight:on': 1400 });
  });
  it('ignores a missing match or round 0, and keeps a bounded history', () => {
    markFlow(null, 2, 'ready:sent');
    markFlow('m', 0, 'ready:sent');
    expect(versusFlowTimings()).toEqual([]);
    for (let r = 1; r <= 40; r++) markFlow('m', r, 'ready:sent', r);
    const rows = versusFlowTimings();
    expect(rows.length).toBe(24);
    expect(rows[0]!.key).toBe('m|17');
  });
});

describe('the store keeps the flow tight (structure)', () => {
  const store = readFileSync(join(__dirname, 'versusStore.ts'), 'utf8');
  const remote = readFileSync(join(__dirname, 'versusRemote.ts'), 'utf8');
  it('the closer asks the resolver at once; the tick only backstops after FINALIZE_BACKSTOP_MS', () => {
    expect(store).toMatch(/async function onOwnAnswer\(m: VersusMatch\)[\s\S]{0,120}if \(m\.phase === 'resolving'\) kickFinalize\(m\);/);
    expect(store).toMatch(/const FINALIZE_BACKSTOP_MS = 1500;/);
    expect(store).toMatch(/await onOwnAnswer\(await inOrder\(\(\) => mx\.submit\(match\.id, match\.round, seq, ready\.side, true/);
  });
  it('after the resolver answers, the row and the round are read in parallel', () => {
    expect(store).toMatch(/markFlow\(match\.id, match\.round, 'finalize:done'\); return refreshMatch\(match\.id, true\);/);
    expect(store).toMatch(/Promise\.all\(\[mx\.match\(matchId\), withRounds \? prefetchRounds\(matchId\) : Promise\.resolve\(\)\]\)/);
    // The group reads go out together (no second round trip for the seats or the fights).
    expect((remote.match(/await Promise\.all\(\[/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it('the close is on its own timer, and the realtime coalesce is short', () => {
    expect(store).toMatch(/function armCloseTimer\(match: VersusMatch\)/);
    expect(store).toMatch(/const WAKE_COALESCE_MS = 50;/);
  });
});
