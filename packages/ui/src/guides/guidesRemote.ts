/**
 * GUIDES: the network seam (2026-10-12). Every Supabase call the guides feature makes lives here, so the store and
 * the screens stay testable with a fake client. Mirrors `gauntlet/gauntletRemote.ts`.
 *
 *  - `fetchOfficialGuides`: the Team Ascent guides, read directly under row level security. It doubles as the
 *    CAPABILITY PROBE: a missing table (the migration not run yet) is a definite `off`.
 *
 * Writes (the `guide-write` Edge Function) arrive with the editor.
 *
 * Never throws; every read is time-boxed.
 */
import { parseGuideRecord, type GuideRecord } from '@game/guides';
import { supabaseClient } from '../remoteBoards';
import { fetchAllRows } from '../supabaseRows';

const READ_TIMEOUT_MS = 4_000;

export const GUIDE_COLUMNS = 'id, slug, author_id, byline, official, published, hidden, sets, tribes, pairs_with, icon_card, title, tagline, body, core, enablers, mentions, aliases, forked_from, forked_title, forked_byline, bookmark_count, sort_order, revision, created_at, updated_at';

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
