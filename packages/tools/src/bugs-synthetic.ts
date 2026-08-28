/**
 * `npx tsx packages/tools/src/bugs-synthetic.ts` — write ONE SYNTHETIC bug report into the local inbox.
 *
 * DOC BOT 2.0 WP G needs to prove the whole learning loop (capture → repro → ruling → graduation →
 * permanent regression) end to end, and it must NOT prove it on a real player report: the owner's real
 * reports are still open, and graduating one would close it on Doc Bot's say-so rather than the owner's.
 * So this generator fabricates a report with an entirely deterministic, engine-built combat capsule and a
 * FIXED sentinel id (`00000000-…`) that no Supabase row will ever collide with.
 *
 * It is a DEV FIXTURE GENERATOR, not part of any lane:
 *  · it writes only into `.local/bug-reports/` (gitignored),
 *  · nothing imports it,
 *  · the report's description is machine-authored and says so, so it can never be mistaken for player prose.
 *
 * Re-run it any time to redo the walkthrough in docs/docbot2/ci-lanes.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CONFIG, createRun, driveTrajectory, reduce, serialize,
  type Action, type BoardSnapshot, type BugReportRow, type RunState,
} from '@game/sim';

export const SYNTHETIC_REPORT_ID = '00000000-0000-4000-8000-000000000001';

const SEED = 0xc04b;
const HERO = 'aster';
const SET = 'set1';

// 1. Walk a REAL run with the seeded fuzz policy and keep the accepted-action prefix that ends just before
//    a fight the player actually had a board for. Recording actions (rather than hand-building a board) is
//    what lets `bugs:repro`'s `replayToState` — which always restarts from `createRun` — rebuild this exact
//    pre-combat state, which is the whole point of the exercise.
const walk = driveTrajectory({ seed: SEED, heroId: HERO, setId: SET, generate: { steps: 60, rngSeed: 0x5eed } });
let s: RunState = createRun(SEED, HERO, 'ascent', CONFIG.defaultLine, SET);
const accepted: Action[] = [];
let best: { pre: RunState; prefix: number } | null = null;
for (const a of walk.actions) {
  const pre = s;
  const next = reduce(s, a);
  if (next === s) continue; // the reducer rejected it — a rejection is never in an accepted-action log
  if (a.type === 'faceOmen' && pre.board.length >= 2) best = { pre, prefix: accepted.length };
  accepted.push(a);
  s = next;
}
if (!best) {
  console.error('the fuzz walk never fought with a board — the synthetic capsule cannot be built.');
  process.exit(1);
}

// 2. Re-fight that wave against an EXPLICIT pinned opponent. `servedBoards` for an ordinary ascent wave is
//    null (the procedural threat), and `QaScenarioV1`'s combat mode needs a real `BoardSnapshot` to express
//    the enemy — so the synthetic capsule pins one, exactly as a lobby/snapshot wave would have.
const pre = best.pre;
const wave = pre.wave;
const minions = [
  { cardId: 'pup', attack: 1, health: 1, keywords: [], golden: false },
  { cardId: 'nanobot', attack: 4, health: 5, keywords: [], golden: false },
  { cardId: 'cryptwolf', attack: 3, health: 2, keywords: [], golden: false },
];
const opponent: BoardSnapshot = {
  v: 1, wave, heroId: HERO, resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'iron',
  power: minions.reduce((n, m) => n + m.attack + m.health, 0),
  minions: minions as BoardSnapshot['minions'],
  seed: 1, origin: 'house',
};
const pinned: RunState = { ...pre, servedBoards: { ...pre.servedBoards, [String(wave)]: opponent } };
const after = reduce(pinned, { type: 'faceOmen' });
if (after === pinned || !after.lastCombat) {
  console.error('faceOmen did not resolve the pinned fight — the synthetic capsule cannot be built.');
  process.exit(1);
}
const actions: Action[] = [...accepted.slice(0, best.prefix), { type: 'faceOmen' }];
s = pre;

const row: BugReportRow = {
  id: SYNTHETIC_REPORT_ID,
  user_id: null,
  client_report_id: 'synthetic-wp-g',
  created_at: '2026-08-27T00:00:00.000Z',
  player_created_at: '2026-08-27T00:00:00.000Z',
  status: 'triaged',
  severity: 'medium',
  priority: null,
  issue_type: 'mechanics',
  description: 'SYNTHETIC REPORT (machine-authored, not a player) — Doc Bot 2.0 WP G walkthrough fixture. '
    + 'Claim under test: the wave-1 fight against the pinned opponent resolves the same way twice.',
  patch: 'wp-g-walkthrough',
  content_revision: 'synthetic',
  mode: 'ascent',
  set_id: SET,
  hero_id: HERO,
  seed: SEED,
  wave,
  phase: 'combat',
  fingerprint: null,
  duplicate_of: null,
  triage: null,
  resolution: null,
  report: {
    schemaVersion: 1,
    reportId: SYNTHETIC_REPORT_ID,
    createdAt: '2026-08-27T00:00:00.000Z',
    description: 'SYNTHETIC REPORT (machine-authored, not a player) — WP G walkthrough fixture.',
    issueType: 'mechanics',
    client: {
      appVersion: 'wp-g-walkthrough', buildSha: 'synthetic', contentRevision: 'synthetic',
      platform: 'web', userAgent: 'bugs-synthetic', locale: 'en', accountUserId: null,
      playerName: null, sessionId: 'synthetic',
    },
    context: {
      runId: 'synthetic', seed: SEED, heroId: HERO, mode: 'ascent', setId: SET,
      wave, phase: 'combat', shopTier: s.tier ?? 1, timerSecondsRemaining: null,
      serializedRun: serialize(after),
      actions,
      currentWaveFrames: [], previousWaveFrames: [],
      combat: {
        result: after.lastCombat, visibleMomentIndex: null, visibleEventStep: null,
        replayDone: true, playbackSpeed: 1,
      },
      ui: {
        selectedCardUid: null, selectedCardId: null, pendingTargetCardId: null, modalKind: null,
        draggingCardUid: null, viewport: { width: 1920, height: 1080, devicePixelRatio: 1 },
      },
      contextTruncated: [],
    },
  },
};

const dir = join('.local', 'bug-reports', SYNTHETIC_REPORT_ID);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'report.json'), `${JSON.stringify(row, null, 2)}\n`);
console.log(`synthetic report written → ${dir}/report.json`);
console.log(`  id: ${SYNTHETIC_REPORT_ID} (short: ${SYNTHETIC_REPORT_ID.slice(0, 8)})`);
console.log(`  combat: ${row.report!.context.combat!.result.events.length} events, outcome '${row.report!.context.combat!.result.result}'`);
console.log('\nnext:  npm run bugs:repro -- 00000000');
console.log('       npm run bugs:graduate -- 00000000 --rule <approved-rule> --verdict correct --no-close');
