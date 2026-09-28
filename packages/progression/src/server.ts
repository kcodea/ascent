/**
 * ACCOUNT PROGRESSION: the `submit-progression` Edge Function's logic, as a pure function (2026-09-27).
 *
 * The Deno entry (`supabase/functions/submit-progression/index.ts`) only verifies the caller's JWT, builds a
 * service-role client and hands both here. Everything that decides an answer lives in this file, so it is unit
 * tested in the Node monorepo with a mocked `rpc` (no live database, no Deno). `scripts/gen-progression-shared.mjs`
 * copies it VERBATIM into `supabase/functions/_shared/progressionServer.ts` (its one import rewritten to the
 * Deno path), and `sharedArtifact.test.ts` fails CI when the copy drifts.
 *
 * WHAT A CLIENT SENDS, never an XP number and never a level:
 *   { mode: 'ranked',   runId, rulesVersion, comeback, facts? }   runId = the rank run id (`rank_results.run_id`)
 *   { mode: 'practice', runId, rulesVersion, comeback, sourceId, facts? }   runId = `practice:<sourceId>`
 *   { mode: 'tutorial', runId, rulesVersion, courseId, courseVersion }   runId = `learn-ascent:v1`
 *
 * The SQL writer (`settle_progression`) reads the placement from the SOURCE ROW (the accepted `rank_results`
 * row, the caller's own `practice_games` row, or a unique tutorial claim), computes the XP, crosses levels,
 * grants the title and writes the immutable ledger row, all under one per-user lock. A duplicate returns the
 * ORIGINAL result. `comeback` is a client-derived fact (ordinary-gameplay trust tier, handoff §7.4): the SQL
 * sanity-checks it against the run's recorded win/loss counts where one exists.
 */
import {
  PROGRESSION_MODES, PROGRESSION_RULES_VERSION, TUTORIAL_COURSE_ID, TUTORIAL_COURSE_VERSION, isProgressionFacts, levelOfXp,
  parseProgressionProfile, parseProgressionResult, practiceRunId, sameXpBreakdown, titlesForLevel, titlesUnlockedBetween, tutorialRunId, xpForSettlement,
  type ProgressionMode, type ProgressionRunFactsV1,
} from './rules';

/** A validated request, ready for `settle_progression`. */
export interface SettleRequest {
  mode: ProgressionMode;
  runId: string;
  sourceId: number | null;
  comeback: boolean;
  facts: ProgressionRunFactsV1 | null;
}

export type ValidationResult = { ok: true; request: SettleRequest } | { ok: false; status: number; error: string; expected?: unknown };

/** Strict input validation: a definite refusal is a 4xx the client treats as permanent. */
export function validateSubmitBody(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'bad_json' };
  const b = body as Record<string, unknown>;
  const mode = b.mode;
  if (typeof mode !== 'string' || !(PROGRESSION_MODES as readonly string[]).includes(mode)) return { ok: false, status: 400, error: 'bad_mode' };
  if (b.rulesVersion !== PROGRESSION_RULES_VERSION) return { ok: false, status: 409, error: 'unsupported_rules', expected: PROGRESSION_RULES_VERSION };
  const runId = typeof b.runId === 'string' ? b.runId.trim() : '';
  if (!runId || runId.length > 128) return { ok: false, status: 400, error: 'bad_run_id' };
  const facts = b.facts === undefined || b.facts === null ? null : isProgressionFacts(b.facts) ? b.facts : undefined;
  if (facts === undefined) return { ok: false, status: 400, error: 'bad_facts' };
  if (facts && (facts.runId !== runId || facts.mode !== mode)) return { ok: false, status: 400, error: 'bad_facts' };

  if (mode === 'tutorial') {
    if (b.courseId !== TUTORIAL_COURSE_ID || b.courseVersion !== TUTORIAL_COURSE_VERSION) {
      return { ok: false, status: 409, error: 'unsupported_course', expected: { courseId: TUTORIAL_COURSE_ID, courseVersion: TUTORIAL_COURSE_VERSION } };
    }
    if (runId !== tutorialRunId()) return { ok: false, status: 400, error: 'bad_run_id' };
    return { ok: true, request: { mode, runId, sourceId: null, comeback: false, facts } };
  }
  const comeback = b.comeback === true;
  if (mode === 'practice') {
    const sourceId = b.sourceId;
    if (typeof sourceId !== 'number' || !Number.isSafeInteger(sourceId) || sourceId < 1) return { ok: false, status: 400, error: 'bad_source' };
    if (runId !== practiceRunId(sourceId)) return { ok: false, status: 400, error: 'bad_run_id' };
    return { ok: true, request: { mode, runId, sourceId, comeback, facts } };
  }
  return { ok: true, request: { mode: 'ranked', runId, sourceId: null, comeback, facts } };
}

/** `raise exception '<code>'` inside `settle_progression` → the HTTP status the client maps to retryable/rejected. */
export const SQL_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  bad_mode: 400,
  bad_run_id: 400,
  bad_source: 400,
  unsupported_rules: 409,
  progression_disabled: 409,
  before_epoch: 409,
  source_not_found: 409,
  not_terminal: 409,
  rate_limited: 429,
});

/** The database call, injected (the service-role client in Deno, a mock in tests). */
export type RpcCall = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;

export interface HandlerResponse { status: number; body: Record<string, unknown> }

/**
 * Settle one request for an authenticated caller. `userId` null = the JWT did not verify (401). Never throws:
 * an unexpected failure is a 500 the client retries.
 */
export async function handleSubmitProgression(userId: string | null, body: unknown, rpc: RpcCall, log: (msg: string, detail?: unknown) => void = () => {}): Promise<HandlerResponse> {
  if (!userId) return { status: 401, body: { error: 'unauthenticated' } };
  const v = validateSubmitBody(body);
  if (!v.ok) return { status: v.status, body: v.expected === undefined ? { error: v.error } : { error: v.error, expected: v.expected } };
  const r = v.request;
  let settled: Awaited<ReturnType<RpcCall>>;
  try {
    settled = await rpc('settle_progression', {
      p_user: userId, p_mode: r.mode, p_run_id: r.runId, p_source_id: r.sourceId, p_comeback: r.comeback,
      p_rules_version: PROGRESSION_RULES_VERSION, p_facts: r.facts,
    });
  } catch (e) {
    log('settle_progression threw', e);
    return { status: 500, body: { error: 'settle_failed' } };
  }
  if (settled.error) {
    const message = String(settled.error.message ?? '');
    const code = Object.keys(SQL_ERROR_STATUS).find((k) => message.includes(k));
    if (code) return { status: SQL_ERROR_STATUS[code]!, body: { error: code } };
    log('settle_progression failed', settled.error);
    return { status: 500, body: { error: 'settle_failed' } };
  }
  const out = (settled.data ?? null) as { status?: unknown; result?: unknown; profile?: unknown } | null;
  const result = parseProgressionResult(out?.result);
  const profile = parseProgressionProfile(out?.profile);
  if (!out || !result || !profile) return { status: 500, body: { error: 'settle_malformed' } };

  const parity = settlementParity(result);
  if (!parity) log('progression parity mismatch', { userId, runId: r.runId, sql: out.result });
  return {
    status: 200,
    body: { status: 'confirmed', deduped: out.status === 'deduped', result: out.result, profile: out.profile, parity },
  };
}

/**
 * RUNTIME PARITY: re-derive the committed result from this file's rules. A mismatch never overrules the SQL
 * (the ledger row is what was written); it flags `parity: false` so a rules edit that missed one copy surfaces
 * on the first real settlement.
 */
export function settlementParity(result: NonNullable<ReturnType<typeof parseProgressionResult>>): boolean {
  const expected = xpForSettlement({ mode: result.mode, placement: result.placement, comeback: result.comeback, terminal: true });
  if (!sameXpBreakdown(expected, result.xp)) return false;
  if (result.after.lifetimeXp !== result.before.lifetimeXp + result.xp.total) return false;
  if (levelOfXp(result.before.lifetimeXp) !== result.before.level) return false;
  if (levelOfXp(result.after.lifetimeXp) !== result.after.level) return false;
  // Every title the SQL reports as newly unlocked must be one the rules grant at the level reached, and every
  // title the rules say this settlement CROSSED must be reported (an account that already held it, say from the
  // migration's backfill, legitimately reports nothing new).
  const owned = new Set(titlesForLevel(result.after.level));
  if (!result.unlockedTitles.every((t) => owned.has(t))) return false;
  // Crates: one per level gained, plus the Welcome Crate when this settlement enrolled the account.
  const gained = result.after.level - result.before.level;
  if (result.crateIds.length !== result.cratesAwarded) return false;
  if (result.cratesAwarded < gained || result.cratesAwarded > gained + 1) return false;
  return titlesUnlockedBetween(result.before.level, result.after.level).every((t) => result.unlockedTitles.includes(t));
}
