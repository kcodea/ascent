/**
 * THE 1,000-ROW GUARD (R-NET-01, owner 2026-10-03: "make it so we never run into similar situations like this and the
 * client always downloads full game snapshots etc.").
 *
 * PostgREST cuts every response at `max-rows` (1,000) without saying so. This test reads every Supabase call in the
 * client, the Edge Functions and the tools, and fails on a LIST read that could be cut silently. A read passes when it:
 *  - runs inside `fetchAllRows(...)` (pages to the end), or
 *  - carries an explicit bound: `.limit(n)` / `.range(a, b)` with n at or below 1,000, `.single()`, `.maybeSingle()`,
 *    or a `head: true` count, or
 *  - is annotated `// rows: <why it is bounded>` on the call or just above it (a scalar RPC, one row per key, a
 *    server RPC that caps itself).
 * Writes (`insert` / `update` / `upsert` / `delete`) are not reads and are skipped. A REST URL in the tools must not
 * ask for `limit=` above 1,000 either (the server would cut it).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MAX_ROWS_PER_REQUEST, fetchAllRows } from './supabaseRows';

const root = join(__dirname, '../../..');
const DIRS = ['packages/ui/src', 'apps/web/src', 'supabase/functions', 'packages/tools/src'];

function sources(dir: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (e === 'node_modules' || e === '.cache') continue;
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}

/** A Supabase table read (`.from('x')` / `.from(TABLE)`) or any RPC (`.rpc(`), with its statement text. */
interface Call { file: string; line: number; text: string; before: string; kind: 'from' | 'rpc' }

function callsIn(file: string): Call[] {
  const src = readFileSync(file, 'utf8');
  const out: Call[] = [];
  const re = /\.(from)\(\s*(?:'[a-z_]+'|"[a-z_]+"|TABLE)\s*\)|\.(rpc)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = src.indexOf(';', m.index);
    const text = src.slice(m.index, end < 0 ? m.index + 600 : Math.min(end, m.index + 900));
    const lineStart = src.lastIndexOf('\n', m.index);
    // The call's own line and the three lines above it (for a `// rows:` note) plus the enclosing call head.
    let b = lineStart;
    for (let i = 0; i < 3 && b > 0; i++) b = src.lastIndexOf('\n', b - 1);
    const before = src.slice(Math.max(0, b), m.index) + src.slice(m.index, src.indexOf('\n', m.index) < 0 ? undefined : src.indexOf('\n', m.index));
    const head = src.slice(Math.max(0, m.index - 260), m.index);
    out.push({ file: relative(root, file).replace(/\\/g, '/'), line: src.slice(0, m.index).split('\n').length, text, before: before + '\n' + head, kind: m[1] ? 'from' : 'rpc' });
  }
  return out;
}

function constValue(file: string, ident: string): number | null {
  const src = readFileSync(join(root, file), 'utf8');
  const m = new RegExp(`const ${ident}\\s*=\\s*([\\d_]+)`).exec(src);
  return m ? Number(m[1]!.replace(/_/g, '')) : null;
}

/** Why a call is fine, or null when it could be cut silently. */
function verdict(c: Call): string | null {
  if (/\.(insert|update|upsert|delete)\(/.test(c.text)) return 'write';
  if (/\/\/\s*rows:/.test(c.before)) return 'annotated';
  if (/fetchAllRows\s*(<[^>]*>)?\s*\(/.test(c.before)) return 'paged';
  if (c.kind === 'rpc') return null; // an RPC can return a table: page it or say why it is bounded
  if (!/\.select\(/.test(c.text)) return 'not a read';
  if (/\.(single|maybeSingle)\(\)/.test(c.text) || /head:\s*true/.test(c.text)) return 'single';
  if (/\.range\(/.test(c.text)) return 'range';
  const lim = /\.limit\(\s*([A-Za-z_][\w.]*|\d[\d_]*)(\s*\*\s*\d+)?\s*\)/.exec(c.text);
  if (lim) {
    if (lim[2]) return null; // an arithmetic limit is not checkable here
    const n = /^\d/.test(lim[1]!) ? Number(lim[1]!.replace(/_/g, '')) : constValue(c.file, lim[1]!);
    if (n !== null && n > MAX_ROWS_PER_REQUEST) return null; // the server would cut it at 1,000 regardless
    return 'limit';
  }
  return null;
}

describe('R-NET-01: no Supabase list read can be cut silently at 1,000 rows', () => {
  const calls = DIRS.flatMap((d) => sources(join(root, d))).flatMap(callsIn);

  it('finds the client reads (sanity: the scan is looking at real code)', () => {
    expect(calls.length).toBeGreaterThan(40);
    expect(calls.some((c) => c.file.endsWith('remoteBoards.ts') && /fetchStrengthHistogramRows/.test(c.before + c.text))).toBe(true);
  });

  it('every read is paged, explicitly bounded at or below 1,000 rows, or annotated with why it is bounded', () => {
    const bad = calls.filter((c) => verdict(c) === null).map((c) => `${c.file}:${c.line}  ${c.text.replace(/\s+/g, ' ').slice(0, 140)}`);
    expect(bad, `unbounded Supabase reads (use fetchAllRows, an explicit .limit/.range <= ${MAX_ROWS_PER_REQUEST}, or a "// rows: why" note):\n${bad.join('\n')}`).toEqual([]);
  });

  it('no REST URL in the tools asks for more than 1,000 rows at once', () => {
    const bad: string[] = [];
    for (const f of DIRS.flatMap((d) => sources(join(root, d)))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/[?&]limit=(\d+)/g)) if (Number(m[1]) > MAX_ROWS_PER_REQUEST) bad.push(`${relative(root, f)}: limit=${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('fetchAllRows', () => {
  /** A fake server holding `n` ordered rows that answers at most `cap` per request, like PostgREST's max-rows. */
  const server = (n: number, cap = MAX_ROWS_PER_REQUEST) => {
    const rows = Array.from({ length: n }, (_, i) => ({ i }));
    const asked: [number, number][] = [];
    const page = async (from: number, to: number) => { asked.push([from, to]); return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null }; };
    return { page, asked };
  };

  it('reads a 1,070-row table whole (the board-strength histogram of 2026-10-03), in two pages', async () => {
    const s = server(1070);
    const res = await fetchAllRows<{ i: number }>(s.page);
    expect(res.error).toBeNull();
    expect(res.truncated).toBe(false);
    expect(res.data!.map((r) => r.i)).toEqual(Array.from({ length: 1070 }, (_, i) => i));
    expect(s.asked).toEqual([[0, 999], [1000, 1999]]);
  });

  it('reads exactly 1,000 and 2,500 rows whole; an empty table is one request', async () => {
    for (const n of [0, 1, 999, 1000, 1001, 2500]) {
      const res = await fetchAllRows<{ i: number }>(server(n).page);
      expect(res.data!.length, String(n)).toBe(n);
    }
    const s = server(0);
    await fetchAllRows(s.page);
    expect(s.asked).toHaveLength(1);
  });

  it('a deliberate maxRows stops there and says so', async () => {
    const res = await fetchAllRows<{ i: number }>(server(5000).page, { maxRows: 2500 });
    expect(res.data!.length).toBe(2500);
    expect(res.truncated).toBe(true);
  });

  it('a failed page fails the whole read (never a partial table presented as whole)', async () => {
    let calls = 0;
    const res = await fetchAllRows(async (from, to) => (++calls === 2 ? { data: null, error: { message: 'boom', code: 'X' } } : { data: Array.from({ length: to - from + 1 }, () => ({})), error: null }));
    expect(res).toEqual({ data: null, error: { message: 'boom', code: 'X' }, truncated: false });
  });

  it('never asks for more than 1,000 rows in one request', async () => {
    const s = server(3000);
    await fetchAllRows(s.page, { pageSize: 5000 });
    for (const [a, b] of s.asked) expect(b - a + 1).toBeLessThanOrEqual(MAX_ROWS_PER_REQUEST);
  });
});

describe('the board-strength histogram arrives whole (the 2026-10-03 bug)', () => {
  it('a 1,070-row histogram behind a 1,000-row cap: every wave, including the strongest wave-14 boards and wave 15', async () => {
    const { fetchStrengthHistogramRows, histogramOf } = await import('./remoteBoards');
    // 15 waves, 70 or more distinct raw scores each, ordered (wave, raw) as the RPC orders them.
    const rows: Array<{ wave: number; raw: number; n: number }> = [];
    for (let w = 1; w <= 15; w++) for (let k = 0; k < (w <= 10 ? 72 : 70); k++) rows.push({ wave: w, raw: k / 100, n: 1 });
    expect(rows.length).toBe(1070);
    const asked: Array<[string, number, number]> = [];
    const rpc = (fn: string) => ({
      range: async (from: number, to: number) => { asked.push([fn, from, to]); return { data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS_PER_REQUEST)), error: null }; },
    });
    const got = await fetchStrengthHistogramRows(rpc);
    expect(got).toHaveLength(1070);
    expect(asked).toEqual([['board_strength_histogram', 0, 999], ['board_strength_histogram', 1000, 1999]]);
    const hist = histogramOf(got!)!;
    expect(hist['14']!.length).toBe(70);
    expect(Math.max(...hist['14']!.map((e) => e.raw))).toBe(0.69);
    expect(hist['15']!.length).toBe(70);
  });

  it('a failed page is no histogram at all (the cache keeps the last good one), never a cut one', async () => {
    const { fetchStrengthHistogramRows } = await import('./remoteBoards');
    let n = 0;
    const rpc = () => ({ range: async () => (++n === 1 ? { data: Array.from({ length: 1000 }, () => ({ wave: 1, raw: 0.5, n: 1 })), error: null } : { data: null, error: { message: 'timeout' } }) });
    expect(await fetchStrengthHistogramRows(rpc)).toBeNull();
  });
});
