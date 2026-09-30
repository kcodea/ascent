/**
 * GAUNTLET ACCOUNT PROGRESS: the `gauntlet-clear` Edge Function's logic, as a pure function (2026-09-29).
 *
 * A signed-in player who clears a Gauntlet stage sends `{ stage }`. Running as the service role, this calls
 * `record_gauntlet_clear` (supabase/migrations/2026-09-29-gauntlet-progress.sql): ONE transaction under the same
 * per-user progression lock settlement and opening take, which records the clear and, on the FIRST clear of that
 * stage only, grants one sealed crate (`earned_level` null, `source = 'gauntlet:<n>'`). A replay answers
 * `already_cleared` with no crate.
 *
 * TRUST (owner 2026-09-29): the server does not re-simulate the run; it only checks the stage is an integer 1..10.
 * NOT SIGNED IN = no account progress and no crates: an anonymous (guest) session is refused with 403
 * `sign_in_required` before the database is touched; guests keep their progress on the device only.
 *
 * `npm run progression:shared` generates this file VERBATIM into supabase/functions/_shared/progressionGauntlet.ts;
 * `sharedArtifact.test.ts` fails CI on drift.
 */
import { parseCrate, type CrateRow } from './cosmetics';
import type { HandlerResponse, RpcCall } from './server';

/** Stages in the Gauntlet (the SQL's `check (stage between 1 and 10)`). */
export const GAUNTLET_STAGE_COUNT = 10;

export type GauntletClearStatus = 'first_clear' | 'already_cleared';

export interface GauntletClearResult {
  status: GauntletClearStatus;
  /** The crate a first clear granted; null on a replay. */
  crate: CrateRow | null;
}

export type GauntletClearValidation = { ok: true; stage: number } | { ok: false; status: number; error: string };

export function validateGauntletClearBody(body: unknown): GauntletClearValidation {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'bad_body' };
  const stage = (body as Record<string, unknown>).stage;
  if (typeof stage !== 'number' || !Number.isInteger(stage) || stage < 1 || stage > GAUNTLET_STAGE_COUNT) return { ok: false, status: 400, error: 'bad_stage' };
  return { ok: true, stage };
}

/** `raise exception '<code>'` inside `record_gauntlet_clear` → HTTP status (4xx permanent, 5xx retry). */
export const GAUNTLET_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  unauthenticated: 401,
  bad_stage: 400,
});

/** Parse the SQL answer. Null for anything malformed (a first clear always carries its crate). */
export function parseGauntletClearResult(v: unknown): GauntletClearResult | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.status === 'already_cleared') return { status: 'already_cleared', crate: null };
  if (o.status !== 'first_clear') return null;
  const crate = parseCrate(o.crate);
  return crate ? { status: 'first_clear', crate } : null;
}

/**
 * Record one clear for a verified caller. `userId` null = the JWT did not verify (401); `anonymous` = a guest
 * session (403). Never throws: an unexpected failure is a 500 the client retries.
 */
export async function handleGauntletClear(userId: string | null, anonymous: boolean, body: unknown, rpc: RpcCall, log: (msg: string, detail?: unknown) => void = () => {}): Promise<HandlerResponse> {
  if (!userId) return { status: 401, body: { error: 'unauthenticated' } };
  if (anonymous) return { status: 403, body: { error: 'sign_in_required' } };
  const v = validateGauntletClearBody(body);
  if (!v.ok) return { status: v.status, body: { error: v.error } };
  let res: Awaited<ReturnType<RpcCall>>;
  try {
    res = await rpc('record_gauntlet_clear', { p_user: userId, p_stage: v.stage });
  } catch (e) {
    log('record_gauntlet_clear threw', e);
    return { status: 500, body: { error: 'gauntlet_failed' } };
  }
  if (res.error) {
    const message = String(res.error.message ?? '');
    const code = Object.keys(GAUNTLET_ERROR_STATUS).find((k) => message.includes(k));
    if (code) return { status: GAUNTLET_ERROR_STATUS[code]!, body: { error: code } };
    log('record_gauntlet_clear failed', res.error);
    return { status: 500, body: { error: 'gauntlet_failed' } };
  }
  const out = parseGauntletClearResult(res.data);
  if (!out) {
    log('record_gauntlet_clear malformed', res.data);
    return { status: 500, body: { error: 'gauntlet_malformed' } };
  }
  return { status: 200, body: { status: out.status, crate: out.crate } };
}
