/**
 * GAUNTLET ACCOUNT PROGRESS: the network seam (2026-09-29). Mirrors `progression/progressionRemote.ts`.
 *
 *  - `submitGauntletClear`: the `gauntlet-clear` Edge Function. The server records the clear and, on the FIRST
 *    clear of a stage only, grants one sealed crate. Definite refusals (400 bad stage, 403 `sign_in_required` for a
 *    guest, 409 / 422) are `rejected`; everything transport-shaped (offline, timeout, 401, 404 before the function
 *    is deployed, 429, 5xx) is `retryable`, so the clear queue keeps the request.
 *  - `fetchGauntletProgress`: the account's cleared stages (`gauntlet_progress`, owner-read). A missing table (the
 *    migration not run yet) is a definite `'off'`, like the progression capability probes.
 *
 * Never throws; every call is time-boxed.
 */
import { parseGauntletClearResult, type GauntletClearResult } from '@game/progression';
import { currentUserId } from '../identity';
import { supabaseClient } from '../remoteBoards';
import { fetchAllRows } from '../supabaseRows';

const SUBMIT_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 4_000;

export type GauntletSubmitOutcome =
  | { status: 'confirmed'; result: GauntletClearResult }
  | { status: 'retryable'; reason: string }
  | { status: 'rejected'; reason: string };

const timeout = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

/** Tell the server `stage` was cleared. The client never names a crate; the server decides. */
export async function submitGauntletClear(stage: number): Promise<GauntletSubmitOutcome> {
  const c = supabaseClient();
  if (!c) return { status: 'retryable', reason: 'no_backend' };
  if (!currentUserId()) return { status: 'retryable', reason: 'no_session' };
  try {
    const call = c.functions.invoke('gauntlet-clear', { body: { stage } }) as Promise<{ data: unknown; error: unknown }>;
    const raced = await Promise.race([call, timeout(SUBMIT_TIMEOUT_MS, { timedOut: true } as const)]);
    if ('timedOut' in raced) return { status: 'retryable', reason: 'timeout' };
    if (raced.error) return classifyFunctionError(raced.error);
    const result = parseGauntletClearResult(raced.data);
    return result ? { status: 'confirmed', result } : { status: 'rejected', reason: 'server_outdated' };
  } catch (e) {
    return { status: 'retryable', reason: `network:${(e as Error)?.message ?? 'unknown'}` };
  }
}

/** As `progressionRemote`'s classifier, plus 403: the only 403 is `sign_in_required` (a guest), which no retry fixes. */
async function classifyFunctionError(err: unknown): Promise<GauntletSubmitOutcome> {
  const e = err as { name?: string; message?: string; context?: { status?: number; json?: () => Promise<unknown> } };
  const status = e.context?.status;
  let code = '';
  try {
    const parsed = e.context?.json ? await e.context.json() : null;
    code = typeof (parsed as { error?: unknown } | null)?.error === 'string' ? (parsed as { error: string }).error : '';
  } catch { /* no readable body */ }
  if (status === 400 || status === 403 || status === 409 || status === 422) return { status: 'rejected', reason: code || `http_${status}` };
  return { status: 'retryable', reason: code || (status ? `http_${status}` : e.message || e.name || 'function_error') };
}

/**
 * The account's cleared stages, sorted and unique. `'off'` = asked, and the table is not there (migration not run);
 * `undefined` = could not ask (no backend, offline, timeout).
 */
export async function fetchGauntletProgress(userId: string): Promise<number[] | 'off' | undefined> {
  const c = supabaseClient();
  if (!c || !userId) return undefined;
  try {
    const res = await Promise.race([
      fetchAllRows((from, to) => c.from('gauntlet_progress').select('stage').eq('user_id', userId).order('stage', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res) return undefined;
    if (res.error) {
      const code = String((res.error as { code?: string }).code ?? '');
      return code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703' ? 'off' : undefined;
    }
    const stages = ((res.data as Array<{ stage?: unknown }> | null) ?? [])
      .map((r) => r.stage)
      .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0);
    return [...new Set(stages)].sort((a, b) => a - b);
  } catch {
    return undefined;
  }
}
