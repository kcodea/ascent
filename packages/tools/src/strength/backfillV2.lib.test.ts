import { describe, it, expect } from 'vitest';
import { backfillRowsOfRun, backfillV2Sql, type BackfillRow } from './backfillV2.lib';

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
