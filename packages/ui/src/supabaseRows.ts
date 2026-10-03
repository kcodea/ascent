/**
 * EVERY ROW, NEVER A SILENT CUT (owner 2026-10-03: "make it so we never run into similar situations like this and
 * the client always downloads full game snapshots etc."). Rule R-NET-01.
 *
 * PostgREST answers at most `max-rows` rows per request (1,000 on our Supabase project) and says nothing when it
 * stops there: the response looks complete. That cut the board-strength histogram at 1,000 of its 1,070 rows
 * (2026-10-03), so every client scored its round-14 board against a table missing the strongest boards and dropped
 * round 15+ from its Game strength. The same cap had cut the per-wave pool pull on 2026-09-29.
 *
 * So a Supabase LIST read takes one of two shapes, and the guard test (`supabaseRows.guard.test.ts`) fails on any
 * other:
 *  - `fetchAllRows(page)`: pages with `.range()` until a short page, so the result is the whole table whatever its
 *    size (or an explicit `maxRows` the caller chose on purpose, reported as `truncated`).
 *  - an explicit, deliberate bound at or below `MAX_ROWS_PER_REQUEST`: `.limit(n)`, `.range(a, b)`, `.single()`,
 *    `.maybeSingle()`, or a `// rows: <why>` note on the call for a read that is bounded by construction (one row per
 *    key, a server RPC that caps itself).
 *
 * A page query must have a STABLE ORDER (an `.order()` on a unique key, or an RPC that orders its rows), or two
 * pages can overlap or skip rows.
 */

/** PostgREST's `max-rows` on our Supabase project (the hosted default). A request never returns more than this. */
export const MAX_ROWS_PER_REQUEST = 1000;
/** A runaway guard only (a million rows at 1,000 per page): no real read gets near it. */
const MAX_PAGES = 1000;

export interface RowsError { message: string; code?: string }
export interface AllRows<T> {
  /** Every row, in page order; null when any page failed (never a partial table presented as whole). */
  data: T[] | null;
  error: RowsError | null;
  /** True when the caller's own `maxRows` stopped the read (there may be more rows on the server). */
  truncated: boolean;
}

export interface FetchAllRowsOptions {
  /** Rows per request; at most `MAX_ROWS_PER_REQUEST` (a larger page would be cut by the server and read as the end). */
  pageSize?: number;
  /** A deliberate ceiling on the whole read (default: none). Hitting it is reported as `truncated`. */
  maxRows?: number;
}

/** A page of a Supabase query: anything awaitable that answers `{ data, error }` (a PostgREST builder is one). */
export type PageQuery = (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

/**
 * Read EVERY row of a query by paging it with `.range(from, to)` until a page comes back short. `page(from, to)` must
 * build the same ordered query each time and apply `.range(from, to)` (inclusive bounds, as PostgREST takes them).
 *
 *   const res = await fetchAllRows((from, to) => c.rpc('board_strength_histogram', args).range(from, to));
 */
export async function fetchAllRows<T>(page: PageQuery, opts: FetchAllRowsOptions = {}): Promise<AllRows<T>> {
  const pageSize = Math.max(1, Math.min(MAX_ROWS_PER_REQUEST, Math.floor(opts.pageSize ?? MAX_ROWS_PER_REQUEST)));
  const maxRows = opts.maxRows ?? Infinity;
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const from = out.length;
    if (from >= maxRows) return { data: out, error: null, truncated: true };
    const want = Math.min(pageSize, maxRows - from);
    const res = await page(from, from + want - 1);
    if (res.error) return { data: null, error: { message: res.error.message, ...(res.error.code ? { code: res.error.code } : {}) }, truncated: false };
    const rows = Array.isArray(res.data) ? (res.data as T[]) : [];
    out.push(...rows);
    if (rows.length < want) return { data: out, error: null, truncated: false };
  }
  return { data: null, error: { message: `fetchAllRows: more than ${MAX_PAGES} pages` }, truncated: false };
}
