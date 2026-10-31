/**
 * THE POOL MIRROR — the draw (R-POOL-MIRROR-01). A line-for-line port of `pool_runs__pick`
 * (supabase/migrations/2026-11-08-pool-runs-delta.sql, itself the picking block of `pool_runs_sample` verbatim), so the
 * hub answers `pool_runs_sample_keys` from its mirror exactly as the database would. Pure; parity-tested against the SQL
 * in PGlite (`workers/versus/test/poolMirror.db.test.ts`): a SEEDED draw picks the same runs in the same order, across
 * bands, caps, early weights, limits and both picking branches. An unseeded draw (what the client sends) is uniform
 * over the same matching runs, as `random()` is.
 *
 * Numbers: the strength columns are Postgres `numeric`, compared exactly here (`Dec`, scaled BigInt), never as floats, so
 * a score sitting exactly on a band edge is in or out exactly as in SQL. The draw itself (`u * span`) is a double in SQL
 * too and is computed the same way.
 */

/** One eligible run as the mirror keeps it (the `pool_mirror_index` row). Numerics as their exact text. */
export interface MirrorRun {
  run_id: number;
  run_key: string;
  author: string;
  user_id: string | null;
  wave_count: number;
  set_id: string;
  patch_prefix: string;
  pool_id: string;
  strength: string | null;
  strength_early: string | null;
  strength_late: string | null;
  rev: string;
}

/** The `pool_runs_sample_keys` arguments (PostgREST's named parameters; absent = null). */
export interface PickArgs {
  p_limit?: number | null;
  p_set?: string | null;
  p_patch_prefix?: string | null;
  p_exclude_user?: string | null;
  p_seed?: string | null;
  p_strength_min?: number | string | null;
  p_strength_max?: number | string | null;
  p_pool?: string | null;
  p_early_weight?: number | string | null;
  p_strength_cap?: number | string | null;
}

// ── Exact decimals ───────────────────────────────────────────────────────────────────────────────────────────────

/** A decimal as an integer and a power-of-ten scale: `v / 10^s`. */
export interface Dec { v: bigint; s: number }

export function dec(x: number | string | null | undefined): Dec | null {
  if (x == null) return null;
  const t = typeof x === 'number' ? (Number.isFinite(x) ? numText(x) : '') : String(x).trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] ?? '';
  let v = BigInt(`${m[2] || '0'}${frac}`);
  let s = frac.length - Number(m[4] ?? 0);
  if (s < 0) { v *= 10n ** BigInt(-s); s = 0; }
  return { v: m[1] === '-' ? -v : v, s };
}
/** A JS number's shortest decimal text (what PostgREST hands Postgres for a JSON number). */
const numText = (x: number): string => {
  const t = String(x);
  if (!/e/i.test(t)) return t;
  return x.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
};
const align = (a: Dec, b: Dec): [bigint, bigint, number] => {
  const s = Math.max(a.s, b.s);
  return [a.v * 10n ** BigInt(s - a.s), b.v * 10n ** BigInt(s - b.s), s];
};
export const cmp = (a: Dec, b: Dec): number => { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0; };
const add = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return { v: x + y, s }; };
const sub = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return { v: x - y, s }; };
const mul = (a: Dec, b: Dec): Dec => ({ v: a.v * b.v, s: a.s + b.s });
const ZERO: Dec = { v: 0n, s: 0 };
const ONE: Dec = { v: 1n, s: 0 };
const clamp01 = (w: Dec): Dec => (cmp(w, ZERO) < 0 ? ZERO : cmp(w, ONE) > 0 ? ONE : w);

/** `pool_match_score(strength, early, late, weight)`, exactly. */
export function matchScore(strength: Dec | null, early: Dec | null, late: Dec | null, weight: Dec | null): Dec | null {
  if (weight == null) return strength;
  if (early != null && late != null) { const w = clamp01(weight); return add(mul(w, early), mul(sub(ONE, w), late)); }
  if (early != null) return early;
  if (late != null) return late;
  return strength;
}

// ── md5 + pool_hash01 ────────────────────────────────────────────────────────────────────────────────────────────

const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const R = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

/** md5 of a string's UTF-8 bytes, as lowercase hex (Postgres `md5(text)`). */
export function md5Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const n = (((bytes.length + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(n);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const bits = bytes.length * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(n - 8, bits >>> 0, true);
  dv.setUint32(n - 4, Math.floor(bits / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < n; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const t = d;
      d = c;
      c = b;
      const x = (a + f + K[i]! + dv.getUint32(off + g * 4, true)) >>> 0;
      b = (b + ((x << R[i]!) | (x >>> (32 - R[i]!)))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const hex = (w: number): string => [0, 8, 16, 24].map((s) => ((w >>> s) & 0xff).toString(16).padStart(2, '0')).join('');
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

/** `pool_hash01(p)`: the first 52 bits of md5(p) as a fraction of 2^52. */
export const poolHash01 = (p: string): number => parseInt(md5Hex(p).slice(0, 13), 16) / 4503599627370496;

// ── The draw ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The runs `pool_runs__pick` would pick, in its order (ids). `random`: the unseeded draw's source (`random()`). */
export function pickRuns(runs: readonly MirrorRun[], args: PickArgs, random: () => number): number[] {
  const limit = Math.min(Math.max(args.p_limit == null ? 150 : Math.floor(Number(args.p_limit)), 0), 300);
  const set = args.p_set ?? null;
  const patch = args.p_patch_prefix ?? null;
  const seed = args.p_seed ?? null;
  const base = runs.filter((r) => (set == null || r.set_id === set) && (patch == null || r.patch_prefix === patch));
  if (!base.length || limit === 0) return [];
  let lo = base[0]!.run_id;
  let hi = lo;
  for (const r of base) { if (r.run_id < lo) lo = r.run_id; if (r.run_id > hi) hi = r.run_id; }
  const span = hi - lo + 1;
  const min = dec(args.p_strength_min);
  const max = dec(args.p_strength_max);
  const cap = dec(args.p_strength_cap);
  const weight = dec(args.p_early_weight);
  const matches = (r: MirrorRun): boolean => {
    if (args.p_exclude_user != null && r.user_id === args.p_exclude_user) return false;
    if (args.p_pool != null && r.pool_id !== args.p_pool) return false;
    const strength = dec(r.strength);
    if (cap != null && strength != null && cmp(strength, cap) > 0) return false;
    const ms = matchScore(strength, dec(r.strength_early), dec(r.strength_late), weight);
    if (ms == null) return true;
    return (min == null || cmp(ms, min) >= 0) && (max == null || cmp(ms, max) <= 0);
  };
  if (span <= 4 * limit) {
    // A small pool: every matching run, shuffled whole.
    return base.filter(matches)
      .map((r) => ({ id: r.run_id, k: seed == null ? random() : poolHash01(`${seed}:${r.run_id}`) }))
      .sort((a, b) => a.k - b.k)
      .slice(0, limit)
      .map((x) => x.id);
  }
  // Rejection sampling over the dense id range: uniform over the matching runs.
  const byId = new Map(base.map((r) => [r.run_id, r]));
  const picked: number[] = [];
  const have = new Set<number>();
  let tries = 0;
  while (picked.length < limit && tries < limit * 64) {
    tries += 1;
    const u = seed == null ? random() : poolHash01(`${seed}:${tries}`);
    const cand = lo + Math.min(Math.floor(u * span), span - 1);
    if (have.has(cand)) continue;
    const r = byId.get(cand);
    if (r && matches(r)) { picked.push(cand); have.add(cand); }
  }
  return picked;
}

/** A numeric column as PostgREST prints it in JSON (its exact text as a JSON number), or null. */
const jsonNum = (t: string | null): string => (t == null ? 'null' : /^-?\d+(\.\d+)?$/.test(t) ? t : JSON.stringify(Number(t)));

/** One `pool_runs_sample_keys` row as PostgREST serializes it (the function's column order). `rev` is the rev of the
 *  boards the mirror holds for the run, so a client asking for them gets exactly that rev. */
export function keyRowJson(r: MirrorRun, rev: string): string {
  return `{"run_id":${r.run_id},"run_key":${JSON.stringify(r.run_key)},"author":${JSON.stringify(r.author)},"user_id":${r.user_id == null ? 'null' : JSON.stringify(r.user_id)},`
    + `"wave_count":${r.wave_count},"strength":${jsonNum(r.strength)},"strength_early":${jsonNum(r.strength_early)},"strength_late":${jsonNum(r.strength_late)},"rev":${JSON.stringify(rev)}}`;
}

/** One `pool_runs_boards` row as PostgREST serializes it: the boards are the database's own jsonb text, untouched. */
export function boardsRowJson(runId: number, runKey: string, rev: string, boardsText: string): string {
  return `{"run_id":${runId},"run_key":${JSON.stringify(runKey)},"rev":${JSON.stringify(rev)},"boards":${boardsText}}`;
}
