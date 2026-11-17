import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyV2Sql, backfillRowsOfRun, backfillV2Sql, type BackfillRow } from './backfillV2.lib';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('backfillRowsOfRun', () => {
  // A run recorded on rounds 1-7 (round 4 empty), two rows on round 7 (a duplicate upload).
  const boards = [
    ...[1, 2, 3, 4, 5, 6, 7].map((wave) => ({ rowId: id(wave), wave, minions: wave === 4 ? 0 : 3 })),
    { rowId: id(70), wave: 7, minions: 3 },
  ];
  const rows = backfillRowsOfRun(boards, 15, 'set2-v2', (boardWave, atRound) => ({ raw: (boardWave * 100 + atRound) / 10000, refWave: atRound }));
  const by = new Map(rows.map((r) => [r.rowId, r]));

  it('scores every board with minions at its own round, and leaves an empty board unscored', () => {
    expect(by.get(id(3))).toMatchObject({ raw: 0.0303, refWave: 3, carried: null });
    expect(by.get(id(4))).toMatchObject({ raw: null, refWave: null, carried: null });
  });
  it('puts the carried scores of rounds 8-15 on every row of the final round, and nowhere else', () => {
    const want = { ref: 'set2-v2', rounds: Object.fromEntries([8, 9, 10, 11, 12, 13, 14, 15].map((r) => [String(r), (700 + r) / 10000])) };
    expect(by.get(id(7))!.carried).toEqual(want);
    expect(by.get(id(70))!.carried).toEqual(want);
    expect(rows.filter((r) => r.carried !== null).map((r) => r.rowId).sort()).toEqual([id(7), id(70)].sort());
  });
  it('an empty final board carries zeros without a fight', () => {
    let fights = 0;
    const r = backfillRowsOfRun([{ rowId: id(1), wave: 7, minions: 0 }], 9, 'set2-v2', () => { fights++; return { raw: 0.5, refWave: 1 }; });
    expect(fights).toBe(0);
    expect(r[0]!.carried).toEqual({ ref: 'set2-v2', rounds: { '8': 0, '9': 0 } });
  });
  it('a run that reached the last reference round carries an empty map (it is complete)', () => {
    const r = backfillRowsOfRun([{ rowId: id(1), wave: 16, minions: 2 }], 15, 'set2-v2', () => ({ raw: 0.5, refWave: 15 }));
    expect(r[0]!.carried).toEqual({ ref: 'set2-v2', rounds: {} });
  });
});

describe('backfillV2Sql', () => {
  const rows: BackfillRow[] = [
    { rowId: id(1), raw: 0.25, refWave: 6, carried: null },
    { rowId: id(2), raw: null, refWave: null, carried: { ref: 'set2-v2', rounds: { '8': 0 } } },
  ];
  const sql = backfillV2Sql('set2-v2', rows);

  it('is one transaction that only updates public.boards', () => {
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    const statements = sql.split('\n').filter((l) => /^(update|insert|delete|select|alter|drop|create|truncate)\b/i.test(l));
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^update public\.boards b set /);
  });
  it('writes the score, the version, the reference round and the carried map', () => {
    expect(sql).toContain(`('${id(1)}'::uuid, 0.25, 6, null)`);
    expect(sql).toContain(`('${id(2)}'::uuid, null, null, '{"ref":"set2-v2","rounds":{"8":0}}')`);
    expect(sql).toContain("strength_ref = case when v.raw is null then null else 'set2-v2' end");
  });
  it('refuses a row id that is not a uuid, and an unexpected version string', () => {
    expect(() => backfillV2Sql('set2-v2', [{ rowId: "x'; drop table boards; --", raw: 0.1, refWave: 1, carried: null }])).toThrow(/uuid/);
    expect(() => backfillV2Sql("v'2", rows)).toThrow(/version/);
  });
});

describe('applyV2Sql: the one file an owner applies', () => {
  const migration = readFileSync(join(__dirname, '../../../../supabase/migrations/2026-11-23-strength-v2.sql'), 'utf8');
  const rows: BackfillRow[] = [{ rowId: id(1), raw: 0.25, refWave: 6, carried: { ref: 'set2-v2', rounds: { '7': 0.1 } } }];
  const sql = applyV2Sql(migration, 'set2-v2', rows);

  it('is the real migration with the backfill inside its one transaction, before the pool is re-rated', () => {
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    const begin = sql.search(/^begin;$/m);
    const update = sql.indexOf('update public.boards b set strength_raw');
    const rerate = sql.lastIndexOf('select public.pool_strength_refresh(null, null, null);'); // the statement, not the header's mention
    const commit = sql.search(/^commit;$/m);
    expect(begin).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(sql.indexOf('add column if not exists strength_carried')); // the column exists first
    expect(update).toBeGreaterThan(begin);
    expect(rerate).toBeGreaterThan(update);
    expect(commit).toBeGreaterThan(rerate);
    // Nothing of the migration is lost: take the inserted block out and the file is the migration again.
    const from = sql.indexOf('-- ── 7b. BACKFILL');
    const to = sql.indexOf('where b.id = v.id;', from) + 'where b.id = v.id;'.length + 2;
    expect(sql.slice(0, from) + sql.slice(to)).toBe(migration);
  });

  it('refuses a migration it cannot place the backfill in', () => {
    expect(() => applyV2Sql('begin;\nselect 1;\ncommit;\n', 'set2-v2', rows)).toThrow(/8\. Start/);
  });
});

