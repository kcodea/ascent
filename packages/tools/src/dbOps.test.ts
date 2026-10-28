/**
 * The Supabase ops scripts (cleanup Phase 0, docs/design/2026-10-28-supabase-cleanup.md): the drift check's parser +
 * classifier, its normalization parity with the SQL it runs against production, and the ledger migration executed in
 * PGlite. Nothing here talks to the live project.
 */
import { PGlite } from '@electric-sql/pglite';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classify, normalizeBody, repoDefinitions, repoIndex } from '../../../scripts/supabase/drift.mjs';

const root = join(__dirname, '../../..');
const LEDGER = readFileSync(join(root, 'supabase/migrations/2026-11-07-ops-schema-ledger.sql'), 'utf8');
/** The exact expression drift.mjs / ledger.mjs run against pg_proc. */
const LIVE_MD5 = `md5(regexp_replace(regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'), '[[:space:]]+', '', 'g'))`;

describe('drift: reading the repo', () => {
  it('finds create / drop in text order, skips prose in comments and creates without an argument list', () => {
    const sql = [
      '-- we create function fake_one( in this comment, and drop function fake_two here',
      'create or replace function public.alpha(p int) returns int language sql as $$ select 1 $$;',
      'create function beta() returns int language plpgsql as $fn$ begin return 2; end $fn$;',
      'drop function if exists public.alpha(int);',
    ].join('\n');
    const d = repoDefinitions(sql);
    expect(d.map((x) => `${x.kind}:${x.name}`)).toEqual(['create:alpha', 'create:beta', 'drop:alpha']);
  });

  it('a body differing only in comments and whitespace has the same hash', () => {
    const a = repoDefinitions('create function f() returns int language sql as $$\n  select 1; -- one\n$$;')[0]!;
    const b = repoDefinitions('create function f() returns int language sql as $$ select   1; $$;')[0]!;
    expect(a.md5).toBe(b.md5);
    expect(normalizeBody(' a  b\n\t-- c\nd ')).toBe('abd');
  });

  it('classifies OK / OLDER / NOMATCH / NOREPO / NOTLIVE, and a later drop retires a name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drift-'));
    const f1 = join(dir, '1.sql');
    const f2 = join(dir, '2.sql');
    writeFileSync(f1, 'create function a() returns int language sql as $$ select 1 $$;\ncreate function gone() returns int language sql as $$ select 0 $$;\ncreate function z() returns int language sql as $$ select 9 $$;');
    writeFileSync(f2, 'create or replace function a() returns int language sql as $$ select 2 $$;\ncreate function b() returns int language sql as $$ select 3 $$;\ndrop function gone();');
    const idx = repoIndex([f1, f2]);
    const md5Of = (body: string) => repoDefinitions(`create function x() returns int language sql as $$${body}$$;`)[0]!.md5!;
    const { ok, findings } = classify([
      { proname: 'a', args: '', md5: md5Of(' select 1 ') }, // an older body
      { proname: 'b', args: '', md5: md5Of(' select 3 ') }, // the last body
      { proname: 'c', args: '', md5: md5Of('x') },          // not in the repo
      { proname: 'z', args: '', md5: md5Of('hand edit') },  // edited in production
    ], idx);
    expect(ok).toBe(1);
    expect(findings.map((f) => `${f.verdict} ${f.name}`).sort()).toEqual(['NOMATCH z', 'NOREPO c', 'OLDER a']);
    // `gone` is dropped by the later file, so its absence is not NOTLIVE; a missing non-dropped name is.
    const missing = classify([{ proname: 'a', args: '', md5: md5Of(' select 2 ') }], idx).findings.map((f) => `${f.verdict} ${f.name}`).sort();
    expect(missing).toEqual(['NOTLIVE b', 'NOTLIVE z']);
  });
});

describe('the ops ledger migration, executed', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec('create role anon; create role authenticated;');
  }, 60_000);
  afterAll(async () => { await db?.close(); });

  it('JS normalization equals the SQL normalization drift runs against pg_proc (parity)', async () => {
    const src = `create or replace function public.parity(p int) returns int language plpgsql as $$
      -- a comment that production strips
      begin
        return p   +  1; -- trailing
      end $$;`;
    await db.exec(src);
    const live = (await db.query<{ md5: string }>(`select ${LIVE_MD5} as md5 from pg_proc p where p.proname = 'parity'`)).rows[0]!.md5;
    expect(live).toBe(repoDefinitions(src)[0]!.md5);
  });

  it('creates ops.schema_ledger, seeds the pre-ledger files once, and re-runs as a no-op', async () => {
    await db.exec(LEDGER);
    const n1 = Number((await db.query<{ n: number }>('select count(*) n from ops.schema_ledger')).rows[0]!.n);
    await db.exec(LEDGER);
    const n2 = Number((await db.query<{ n: number }>('select count(*) n from ops.schema_ledger')).rows[0]!.n);
    expect(n1).toBeGreaterThan(80);
    expect(n2).toBe(n1);
    const rows = (await db.query<{ file: string; applied_by: string; sha256: string }>('select file, applied_by, sha256 from ops.schema_ledger')).rows;
    for (const r of rows) {
      expect(existsSync(join(root, r.file)), r.file).toBe(true);
      expect(r.applied_by).toBe('pre-ledger');
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // The never-applied God Mode RPC is not claimed as applied.
    expect(rows.some((r) => r.file.endsWith('2026-10-08-god-board-sample.sql'))).toBe(false);
  });

  it('client roles cannot reach the ops schema', async () => {
    const can = (await db.query<{ a: boolean; b: boolean }>(
      "select has_schema_privilege('anon', 'ops', 'usage') a, has_schema_privilege('authenticated', 'ops', 'usage') b")).rows[0]!;
    expect(can).toEqual({ a: false, b: false });
  });
});
