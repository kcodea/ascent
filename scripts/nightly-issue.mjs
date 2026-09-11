#!/usr/bin/env node
/**
 * nightly-issue.mjs — make a red Doc Bot nightly UNIGNORABLE (2026-09-11).
 *
 * Runs as the last step of `.github/workflows/nightly.yml` (`if: always()`, `issues: write`). It reads the
 * run's `nightly-status.json` (written by `npm run docbot:nightly`) and keeps ONE pinned tracking issue titled
 * "Doc Bot nightly status" in sync:
 *
 *   · RED   → create the issue (and pin it) if none is open; otherwise rewrite its body. Either way, comment
 *             the two-line-per-finding summary + repro commands + the artifact link, so the red is a
 *             notification, not just an edit.
 *   · GREEN → if an issue is open: comment "green" with the run link and CLOSE it. If none is open: nothing.
 *   · no status file (the lane crashed before writing one) → treated as RED with a one-line explanation.
 *
 * Idempotent: the open issue is found by EXACT title, never by number. No dependencies — plain node + `gh`.
 * The rendering/planning functions are pure and exported so `packages/tools/src/nightlyIssue.test.ts` can
 * pin them; only `main()` touches `gh`.
 *
 *   node scripts/nightly-issue.mjs --status artifacts/docbot-nightly/nightly-status.json [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ISSUE_TITLE = 'Doc Bot nightly status';
export const ISSUE_LABEL = 'docbot-nightly';

/** The workflow-run context the body links to; every field optional so the script also runs locally. */
export function runContext(env = process.env) {
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  const repo = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  return {
    runId,
    runUrl: repo && runId ? `${server}/${repo}/actions/runs/${runId}` : undefined,
    artifactName: runId ? `docbot-nightly-${runId}` : undefined,
  };
}

/** Load the status file, or synthesize a "crashed" status when the lane never wrote one. */
export function loadStatus(path) {
  if (!existsSync(path)) {
    return {
      schemaVersion: 1, verdict: 'red', at: new Date().toISOString(), crashed: true,
      config: { runs: 0, seedBase: 0, lobbies: 0 }, elapsedSeconds: 0,
      reproCommand: 'npm run docbot:nightly',
      red: [], known: [],
      notes: [`no ${path} was written — the lane crashed before reaching its verdict; read the job log`],
    };
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

const findingLines = (f, fallbackRepro) => [
  `- **${f.title}** — ${f.summary}`,
  `  repro: \`${f.reproduction ?? fallbackRepro}\`${f.ack ? ` · known (acknowledged ${f.ack.date}: ${f.ack.reason})` : ''}`,
];

/** The two-line-per-finding summary + repro commands + artifact link. Markdown. */
export function renderSummary(status, ctx) {
  const lines = [];
  const stamp = status.verdict === 'red' ? '🔴 RED' : '🟢 GREEN';
  lines.push(`**${stamp}** — ${status.at}${ctx.runUrl ? ` · [workflow run](${ctx.runUrl})` : ''}`);
  if (status.crashed) lines.push('', '⚠ The lane crashed before writing its verdict — see the job log.');
  if (status.red.length) {
    lines.push('', `### Unacknowledged findings (${status.red.length}) — these keep the nightly red`);
    for (const f of status.red) lines.push(...findingLines(f, status.reproCommand));
  }
  if (status.known.length) {
    lines.push('', `### Acknowledged findings (${status.known.length}) — reported, not failing`);
    for (const f of status.known) lines.push(...findingLines(f, status.reproCommand));
  }
  if (status.notes.length) {
    lines.push('', '### Notes');
    for (const n of status.notes) lines.push(`- ${n}`);
  }
  lines.push('', '### Reproduce locally');
  lines.push('```', status.reproCommand, '```');
  lines.push(`Every seed is fixed (\`60000 + k·977\`), so the same command reproduces the same findings byte-for-byte.`);
  if (ctx.runUrl) lines.push('', `Artifact: \`${ctx.artifactName}\` on the [workflow run](${ctx.runUrl}) (report, findings.json, minimized scenarios, traces).`);
  return lines.join('\n');
}

/** The full issue body: the standing explanation + the current summary. */
export function renderBody(status, ctx) {
  return [
    `Tracking issue for the Doc Bot nightly (\`.github/workflows/nightly.yml\`). Maintained by \`scripts/nightly-issue.mjs\` — do not edit by hand; it is rewritten on every run and closed when the nightly is green.`,
    '',
    'A red nightly is either **fixed** or **acknowledged** (`packages/sim/src/docbot/nightlyAck.ts`: fingerprint + date + reason) — never tolerated silently. See `docs/docbot.md`.',
    '',
    '---',
    '',
    renderSummary(status, ctx),
  ].join('\n');
}

/**
 * Decide what to do, given the status and the open issue (if any). Pure — the test pins every branch.
 * Returns an ordered list of gh operations.
 */
export function planActions(status, existing, ctx) {
  const body = renderBody(status, ctx);
  const summary = renderSummary(status, ctx);
  if (status.verdict === 'red') {
    if (!existing) {
      return [
        { op: 'create', title: ISSUE_TITLE, body, label: ISSUE_LABEL },
        { op: 'pin' },
      ];
    }
    return [
      { op: 'edit', number: existing.number, body },
      { op: 'comment', number: existing.number, body: summary },
    ];
  }
  // green
  if (!existing) return [];
  return [
    { op: 'comment', number: existing.number, body: `🟢 **green** — ${status.at}${ctx.runUrl ? ` · [workflow run](${ctx.runUrl})` : ''}. Closing; the next red reopens a fresh issue.` },
    { op: 'close', number: existing.number },
  ];
}

// ── gh plumbing (main only) ───────────────────────────────────────────────────────────────────────────────

const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim();

export function findOpenIssue() {
  const out = gh(['issue', 'list', '--state', 'open', '--search', `"${ISSUE_TITLE}" in:title`, '--json', 'number,title', '--limit', '20']);
  const rows = JSON.parse(out || '[]');
  return rows.find((r) => r.title === ISSUE_TITLE) ?? null;
}

function ensureLabel() {
  try { gh(['label', 'create', ISSUE_LABEL, '--description', 'Doc Bot nightly tracking', '--color', 'B60205', '--force']); } catch { /* label ops are best-effort */ }
}

export function execute(actions, { dryRun = false } = {}) {
  let created = null;
  for (const a of actions) {
    console.log(`[nightly-issue] ${a.op}${a.number ? ` #${a.number}` : ''}`);
    if (dryRun) continue;
    switch (a.op) {
      case 'create': {
        ensureLabel();
        const url = gh(['issue', 'create', '--title', a.title, '--body', a.body, '--label', a.label]);
        created = url;
        console.log(`[nightly-issue] created ${url}`);
        break;
      }
      case 'pin': {
        // Pins are capped at three per repo — a failed pin must not fail a red run's reporting.
        try { gh(['issue', 'pin', created ?? ISSUE_TITLE]); } catch (e) { console.log(`[nightly-issue] pin skipped: ${e.message ?? e}`); }
        break;
      }
      case 'edit': gh(['issue', 'edit', String(a.number), '--body', a.body]); break;
      case 'comment': gh(['issue', 'comment', String(a.number), '--body', a.body]); break;
      case 'close': gh(['issue', 'close', String(a.number), '--reason', 'completed']); break;
      default: throw new Error(`unknown op ${a.op}`);
    }
  }
}

export function main(argv = process.argv.slice(2)) {
  const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
  const statusPath = flag('status') ?? 'artifacts/docbot-nightly/nightly-status.json';
  const dryRun = argv.includes('--dry-run');
  const status = loadStatus(statusPath);
  const ctx = runContext();
  const existing = dryRun ? null : findOpenIssue();
  const actions = planActions(status, existing, ctx);
  console.log(`[nightly-issue] verdict ${status.verdict}${status.crashed ? ' (crashed)' : ''} · existing issue ${existing ? `#${existing.number}` : 'none'} · ${actions.length} action(s)`);
  execute(actions, { dryRun });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
