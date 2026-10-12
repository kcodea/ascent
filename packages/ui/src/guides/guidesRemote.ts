/**
 * GUIDES: the network seam (2026-10-12). Every Supabase call the guides feature makes lives here, so the store and
 * the screens stay testable with a fake client. Mirrors `gauntlet/gauntletRemote.ts`.
 *
 *  - `fetchOfficialGuides`: the Team Ascent guides, read directly under row level security. It doubles as the
 *    CAPABILITY PROBE: a missing table (the migration not run yet) is a definite `off`.
 *
 *  - `saveGuideRemote` / `deleteGuideRemote` / `importBuiltInsRemote`: the writes, through the `guide-write` Edge
 *    Function. They answer with a result carrying the server's own refusal code, never throw. Only a save's answer
 *    carries a guide; it is read with `parseGuideAnswer`, never with the row reader directly.
 *  - `fetchTeamFlag` / `fetchMyGuides` / `fetchGuideById`: the three small reads the editor needs.
 *
 * Never throws; every read is time-boxed.
 */
import { parseGuideRecord, type GuideRecord } from '@game/guides';
import { supabaseClient } from '../remoteBoards';
import { fetchAllRows } from '../supabaseRows';

const READ_TIMEOUT_MS = 4_000;

export const GUIDE_COLUMNS = 'id, slug, author_id, byline, official, published, published_at, hidden, sets, tribes, pairs_with, icon_card, title, tagline, body, core, enablers, mentions, aliases, forked_from, forked_title, forked_byline, bookmark_count, sort_order, revision, created_at, updated_at';

/** `on` = asked, here they are. `off` = asked, and the tables are not there. `offline` = could not ask. */
export type OfficialGuidesAnswer = { state: 'on'; guides: GuideRecord[] } | { state: 'off' | 'offline' | 'no-backend' };

const timeout = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

export async function fetchOfficialGuides(): Promise<OfficialGuidesAnswer> {
  const c = supabaseClient();
  if (!c) return { state: 'no-backend' };
  try {
    const res = await Promise.race([
      fetchAllRows((from, to) => c.from('guides').select(GUIDE_COLUMNS).eq('official', true).order('sort_order', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res) return { state: 'offline' };
    if (res.error) {
      const code = String((res.error as { code?: string }).code ?? '');
      return { state: code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703' ? 'off' : 'offline' };
    }
    const guides = ((res.data as unknown[] | null) ?? []).map(parseGuideRecord).filter((g): g is GuideRecord => g !== null);
    return { state: 'on', guides };
  } catch {
    return { state: 'offline' };
  }
}

// -- Writes (the `guide-write` Edge Function) ---------------------------------------------------------------------

const WRITE_TIMEOUT_MS = 15_000;

/**
 * A write's answer. On a refusal, `code` is the server's own stable code (with the `field` it named, if any), or
 * one of three made here: `offline` (could not reach it), `unavailable` (the function is not deployed yet), `server`
 * (it answered with something this client cannot use). Writes are interactive, never queued: a failure is shown.
 */
export type GuideWriteResult<T> = { ok: true; value: T } | { ok: false; code: string; field?: string };
type GuideWriteFailure = { ok: false; code: string; field?: string };

/** What the client sends for one guide: the camelCase document the server validates (`validateGuideDraft`). */
export interface GuideDraftInput {
  /** The row being updated; absent for a new guide. */
  id?: string;
  /** The revision the editor loaded. Required with `id`. */
  revision?: number;
  /** Built-in import only. */
  slug?: string;
  official: boolean;
  byline: string;
  sets: string[];
  tribes: string[];
  pairsWith: string[];
  iconCard: string;
  title: string;
  tagline: string;
  body: string;
  core: string[];
  enablers: string[];
  mentions: string[];
  aliases: Record<string, string>;
  forkedFrom?: string | null;
}

/** Turn a functions-js error into a failure: the server's code when it sent one, else a transport code. */
async function failureOf(err: unknown): Promise<GuideWriteFailure> {
  const e = err as { context?: { status?: number; json?: () => Promise<unknown> } };
  const status = e.context?.status;
  let code = '';
  let field: string | undefined;
  try {
    const parsed = e.context?.json ? await e.context.json() : null;
    const o = (parsed ?? {}) as { error?: unknown; field?: unknown };
    if (typeof o.error === 'string') code = o.error;
    if (typeof o.field === 'string') field = o.field;
  } catch { /* no readable body */ }
  if (code) return field ? { ok: false, code, field } : { ok: false, code };
  if (status === 404) return { ok: false, code: 'unavailable' };
  return { ok: false, code: status ? 'server' : 'offline' };
}

async function invokeGuideWrite(body: Record<string, unknown>): Promise<GuideWriteResult<Record<string, unknown>>> {
  const c = supabaseClient();
  if (!c) return { ok: false, code: 'offline' };
  try {
    const call = Promise.resolve(c.functions.invoke('guide-write', { body })) as Promise<{ data: unknown; error: unknown }>;
    const raced = await Promise.race([call, timeout(WRITE_TIMEOUT_MS, { timedOut: true } as const)]);
    if ('timedOut' in raced) return { ok: false, code: 'offline' };
    if (raced.error) return await failureOf(raced.error);
    if (!raced.data || typeof raced.data !== 'object') return { ok: false, code: 'server' };
    return { ok: true, value: raced.data as Record<string, unknown> };
  } catch {
    return { ok: false, code: 'offline' };
  }
}

/**
 * Every `GuideRecord` field, and the `guides` row key `parseGuideRecord` reads it from. Typed over the whole record,
 * so a field added to `GuideRecord` does not compile until it is listed here; `guidesRemoteWrite.test.ts` checks the
 * row keys against what `parseGuideRecord` really reads.
 */
export const GUIDE_ANSWER_ROW_KEYS: Readonly<Record<keyof GuideRecord, string>> = Object.freeze({
  id: 'id',
  slug: 'slug',
  authorId: 'author_id',
  byline: 'byline',
  official: 'official',
  published: 'published',
  publishedAt: 'published_at',
  hidden: 'hidden',
  sets: 'sets',
  tribes: 'tribes',
  pairsWith: 'pairs_with',
  iconCard: 'icon_card',
  title: 'title',
  tagline: 'tagline',
  body: 'body',
  core: 'core',
  enablers: 'enablers',
  mentions: 'mentions',
  aliases: 'aliases',
  forkedFrom: 'forked_from',
  forkedTitle: 'forked_title',
  forkedByline: 'forked_byline',
  bookmarkCount: 'bookmark_count',
  sortOrder: 'sort_order',
  revision: 'revision',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

/**
 * Read a guide out of a `guide-write` ANSWER. The function answers a guide it has already read into a `GuideRecord`
 * (camelCase keys: packages/guides/src/server.ts), while `parseGuideRecord` reads a table ROW (snake_case keys). So
 * the answer's keys are put back under the row's names and the result goes through `parseGuideRecord`: the same
 * checks run on both paths. A key that is already a row key is taken as it is, so an answer in either shape reads
 * the same and the client never depends on which version of the function is deployed.
 */
export function parseGuideAnswer(v: unknown): GuideRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const row: Record<string, unknown> = {};
  for (const [key, rowKey] of Object.entries(GUIDE_ANSWER_ROW_KEYS)) row[rowKey] = o[key] !== undefined ? o[key] : o[rowKey];
  return parseGuideRecord(row);
}

/** Create a guide (no `id`) or update one (`id` + the `revision` it was loaded at). */
export async function saveGuideRemote(guide: GuideDraftInput): Promise<GuideWriteResult<GuideRecord>> {
  const res = await invokeGuideWrite({ op: 'save', guide });
  if (!res.ok) return res;
  const rec = parseGuideAnswer(res.value.guide);
  return rec ? { ok: true, value: rec } : { ok: false, code: 'server' };
}

export async function deleteGuideRemote(rowId: string): Promise<GuideWriteResult<true>> {
  const res = await invokeGuideWrite({ op: 'delete', id: rowId });
  return res.ok ? { ok: true, value: true } : res;
}

/** Team only: add the built-in guides as Team Ascent guides. Never overwrites one that is already there. */
export async function importBuiltInsRemote(guides: GuideDraftInput[]): Promise<GuideWriteResult<{ inserted: number; skipped: number }>> {
  const res = await invokeGuideWrite({ op: 'importBuiltIns', guides });
  if (!res.ok) return res;
  return { ok: true, value: { inserted: Number(res.value.inserted ?? 0), skipped: Number(res.value.skipped ?? 0) } };
}

// -- The three small reads ----------------------------------------------------------------------------------------

/** Is this account on the guides team? `undefined` = could not ask (never treat that as "no" for an account that
 *  was already known to be on it). Row level security lets an account read only its own row. */
export async function fetchTeamFlag(userId: string): Promise<boolean | undefined> {
  const c = supabaseClient();
  if (!c || !userId) return undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(c.from('guide_team').select('user_id').eq('user_id', userId).maybeSingle()),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    return res.data !== null;
  } catch {
    return undefined;
  }
}

/** This account's own guides (never Team Ascent ones), oldest first. `undefined` = could not ask. */
export async function fetchMyGuides(userId: string): Promise<GuideRecord[] | undefined> {
  const c = supabaseClient();
  if (!c || !userId) return undefined;
  try {
    const res = await Promise.race([
      fetchAllRows((from, to) => c.from('guides').select(GUIDE_COLUMNS).eq('author_id', userId).eq('official', false).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    return ((res.data as unknown[] | null) ?? []).map(parseGuideRecord).filter((g): g is GuideRecord => g !== null);
  } catch {
    return undefined;
  }
}

/** One guide by row id, as this account may read it. `null` = it is gone (or not readable); `undefined` = could not ask. */
export async function fetchGuideById(rowId: string): Promise<GuideRecord | null | undefined> {
  const c = supabaseClient();
  if (!c || !rowId) return undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(c.from('guides').select(GUIDE_COLUMNS).eq('id', rowId).maybeSingle()),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    return res.data === null ? null : (parseGuideRecord(res.data) ?? undefined);
  } catch {
    return undefined;
  }
}
