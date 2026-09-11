/**
 * DOC BOT NIGHTLY — the ACKNOWLEDGEMENT REGISTRY + the verdict it gates (2026-09-11).
 *
 * The nightly was red for fifteen consecutive scheduled runs (2026-08-28 → 2026-09-11) with the SAME two
 * findings and nobody looked: a red that nobody owns is a red that stops meaning anything. Two rules follow.
 *
 *   1. A red nightly is UNIGNORABLE — the workflow pins one tracking issue with the findings and their repro
 *      commands (`scripts/nightly-issue.mjs`), and `npm run docbot` prints the last status it can see.
 *   2. A red nightly is either FIXED or ACKNOWLEDGED, never tolerated silently. An owner who decides a finding
 *      is known-and-parked writes its structural fingerprint here with a reason and a date; the nightly then
 *      reports it as `known (acknowledged YYYY-MM-DD: reason)` and stays GREEN for it. Anything not listed
 *      keeps the run RED. The fingerprint (§12.2) never includes prose, so re-wording a message can neither
 *      create nor silence an ack; a real behaviour change produces a new fingerprint and re-reds the run.
 *
 * Nothing here is generated. Every row is a hand-written owner decision, and `nightlyAck.test.ts` is the
 * sabotage proof: an unknown fingerprint fails, an acknowledged one does not, and an ack never covers a
 * finding whose fingerprint it does not match.
 */
import type { DocbotFinding } from './findings';

export interface NightlyAck {
  /** The finding's structural fingerprint (8 hex chars, `DocbotFinding.fingerprint`). */
  fingerprint: string;
  /** ISO date the owner acknowledged it (YYYY-MM-DD). */
  date: string;
  /** Why it is parked rather than fixed — printed verbatim in the nightly report and the tracking issue. */
  reason: string;
}

/** The owner's acknowledged nightly findings. EMPTY as of 2026-09-11: both standing findings were FIXED
 *  (deserialize's Discover-family leak; the shop-summon driver's unanswered Choose One) rather than parked. */
export const NIGHTLY_ACKS: readonly NightlyAck[] = [];

export interface NightlyVerdict {
  /** True iff every gating finding is acknowledged (or there are none). */
  ok: boolean;
  /** Gating findings with NO acknowledgement — these keep the nightly red. */
  red: DocbotFinding[];
  /** Gating findings covered by an ack — reported, never failing. */
  known: { finding: DocbotFinding; ack: NightlyAck }[];
}

/** Split the night's gating findings by the registry. Pure; order-preserving; a duplicate fingerprint in the
 *  registry resolves to its FIRST row. */
export function nightlyVerdict(findings: readonly DocbotFinding[], acks: readonly NightlyAck[] = NIGHTLY_ACKS): NightlyVerdict {
  const byFp = new Map<string, NightlyAck>();
  for (const a of acks) if (!byFp.has(a.fingerprint)) byFp.set(a.fingerprint, a);
  const red: DocbotFinding[] = [];
  const known: NightlyVerdict['known'] = [];
  for (const f of findings) {
    const ack = byFp.get(f.fingerprint);
    if (ack) known.push({ finding: f, ack });
    else red.push(f);
  }
  return { ok: red.length === 0, red, known };
}

/** The one phrase every surface prints for an acknowledged finding. */
export const describeAck = (ack: NightlyAck): string => `known (acknowledged ${ack.date}: ${ack.reason})`;

// ── The status document — what the workflow's tracking issue and `npm run docbot` read ────────────────────

export interface NightlyStatusFinding {
  fingerprint: string;
  id: string;
  lane: string;
  title: string;
  summary: string;
  /** The exact repro line when the finding minimized into a scenario (`npm run docbot:scenario -- <id>`). */
  reproduction?: string;
  /** Present iff the registry acknowledged it. */
  ack?: NightlyAck;
}

export interface NightlyStatus {
  schemaVersion: 1;
  verdict: 'green' | 'red';
  /** ISO timestamp of the run that wrote this (informational — never part of any fingerprint). */
  at: string;
  config: { runs: number; seedBase: number; lobbies: number };
  elapsedSeconds: number;
  /** The exact command that reproduces this whole night locally (fixed seeds — no probability gates). */
  reproCommand: string;
  red: NightlyStatusFinding[];
  known: NightlyStatusFinding[];
  /** Non-gating telemetry a reader still wants on the issue: draft-contract disagreements etc. */
  notes: string[];
}

const statusFinding = (f: DocbotFinding, ack?: NightlyAck): NightlyStatusFinding => ({
  fingerprint: f.fingerprint,
  id: f.id,
  lane: f.lane,
  title: f.title,
  summary: f.summary,
  ...(f.reproduction ? { reproduction: f.reproduction } : {}),
  ...(ack ? { ack } : {}),
});

export function buildNightlyStatus(input: {
  verdict: NightlyVerdict;
  at: string;
  config: { runs: number; seedBase: number; lobbies: number };
  elapsedSeconds: number;
  outDir: string;
  notes?: string[];
}): NightlyStatus {
  const { runs, seedBase, lobbies } = input.config;
  return {
    schemaVersion: 1,
    verdict: input.verdict.ok ? 'green' : 'red',
    at: input.at,
    config: { runs, seedBase, lobbies },
    elapsedSeconds: input.elapsedSeconds,
    reproCommand: `npm run docbot:nightly -- --runs ${runs} --seed-base ${seedBase} --lobbies ${lobbies} --out ${input.outDir}`,
    red: input.verdict.red.map((f) => statusFinding(f)),
    known: input.verdict.known.map((k) => statusFinding(k.finding, k.ack)),
    notes: input.notes ?? [],
  };
}

/** The gitignored local copy `npm run docbot` reads to print the last nightly it can see. */
export const LOCAL_NIGHTLY_STATUS_PATH = '.local/docbot/nightly-status.json';

/** One-screen rendering shared by the CLI report; the workflow script (plain node) renders its own markdown
 *  from the same JSON. */
export function formatNightlyStatus(s: NightlyStatus): string[] {
  const lines = [`nightly: ${s.verdict.toUpperCase()} at ${s.at} (${s.config.runs} runs · seed base ${s.config.seedBase} · ${s.config.lobbies} lobbies · ${s.elapsedSeconds}s)`];
  for (const f of s.red) {
    lines.push(`  ✗ ${f.title} — ${f.summary}`);
    lines.push(`    repro: ${f.reproduction ?? s.reproCommand}`);
  }
  for (const f of s.known) {
    lines.push(`  ~ ${f.title} — ${describeAck(f.ack!)}`);
    lines.push(`    repro: ${f.reproduction ?? s.reproCommand}`);
  }
  for (const n of s.notes) lines.push(`  · ${n}`);
  return lines;
}
