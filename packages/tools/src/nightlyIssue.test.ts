/**
 * The nightly tracking-issue script (`scripts/nightly-issue.mjs`) — pinned here so the workflow's
 * "unignorable red" contract is a test, not a hope (2026-09-11). Only the pure planning/rendering surface is
 * exercised; `gh` never runs under vitest.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ISSUE_TITLE, loadStatus, planActions, renderBody, renderSummary, runContext, type NightlyIssueStatus,
} from '../../../scripts/nightly-issue.mjs';

const red: NightlyIssueStatus = {
  schemaVersion: 1, verdict: 'red', at: '2026-09-11T09:17:00.000Z',
  config: { runs: 6, seedBase: 60000, lobbies: 4 }, elapsedSeconds: 268,
  reproCommand: 'npm run docbot:nightly -- --runs 6 --seed-base 60000 --lobbies 4 --out artifacts/docbot-nightly',
  red: [{ fingerprint: 'deadbeef', id: 'nightly-lifecycle-deadbeef', lane: 'nightly-lifecycle', title: 'nightly roundtrip failure (seed 62931)', summary: 'serialize→deserialize changed the state at step 19', reproduction: 'npm run docbot:scenario -- nightly-s62931-roundtrip' }],
  known: [{ fingerprint: 'cafef00d', id: 'nightly-lobby-cafef00d', lane: 'nightly-lobby', title: 'lobby law violated (seed 60003)', summary: 'no seat placed 1st', ack: { fingerprint: 'cafef00d', date: '2026-09-11', reason: 'parked' } }],
  notes: ['contracts: 1 draft-contract disagreement(s)'],
};
const green: NightlyIssueStatus = { ...red, verdict: 'green', red: [], known: [], notes: [] };
const ctx = runContext({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42' });

describe('nightly tracking issue — planning (pure)', () => {
  it('RED with no open issue → create (exact title) + pin', () => {
    const plan = planActions(red, null, ctx);
    expect(plan.map((a) => a.op)).toEqual(['create', 'pin']);
    expect(plan[0]!.op === 'create' && plan[0]!.title).toBe(ISSUE_TITLE);
  });

  it('RED with an open issue → rewrite the body + comment the summary (a notification, not just an edit)', () => {
    const plan = planActions(red, { number: 7, title: ISSUE_TITLE }, ctx);
    expect(plan.map((a) => a.op)).toEqual(['edit', 'comment']);
    expect(plan.every((a) => 'number' in a && a.number === 7)).toBe(true);
  });

  it('GREEN with an open issue → comment "green" + close; GREEN with none → nothing', () => {
    const plan = planActions(green, { number: 7, title: ISSUE_TITLE }, ctx);
    expect(plan.map((a) => a.op)).toEqual(['comment', 'close']);
    expect(plan[0]!.op === 'comment' && plan[0]!.body).toContain('green');
    expect(planActions(green, null, ctx)).toEqual([]);
  });

  it('the summary carries two lines per finding, the repro commands, the ack phrase and the artifact link', () => {
    const s = renderSummary(red, ctx);
    expect(s).toContain('nightly roundtrip failure (seed 62931)');
    expect(s).toContain('`npm run docbot:scenario -- nightly-s62931-roundtrip`');
    expect(s).toContain('known (acknowledged 2026-09-11: parked)');
    expect(s).toContain(red.reproCommand);
    expect(s).toContain('https://github.com/o/r/actions/runs/42');
    expect(s).toContain('docbot-nightly-42');
    expect(s).toContain('contracts: 1 draft-contract disagreement(s)');
    expect(renderBody(red, ctx)).toContain(s);
  });

  it('a missing status file is a RED "crashed" status, never a silent green', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nightly-issue-'));
    const missing = loadStatus(join(dir, 'nope.json'));
    expect(missing.verdict).toBe('red');
    expect(missing.crashed).toBe(true);
    expect(planActions(missing, null, ctx).map((a) => a.op)).toEqual(['create', 'pin']);
    const p = join(dir, 'nightly-status.json');
    writeFileSync(p, JSON.stringify(green));
    expect(loadStatus(p).verdict).toBe('green');
  });

  it('runs locally without any GitHub env (no run link, no artifact name)', () => {
    const local = runContext({});
    expect(local.runUrl).toBeUndefined();
    expect(renderSummary(green, local)).not.toContain('workflow run');
  });
});
