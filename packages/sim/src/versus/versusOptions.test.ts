/**
 * VERSUS ROOM OPTIONS (owner 2026-10-24, R-VERSUS-OPTIONS-01): the TS whitelist and the SQL one agree code for code,
 * the defaults are today's Versus, and a modifier pins its rift onto every seat's run at creation (deterministically,
 * like a Rift run), while no options leave the run byte-identical to today's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RIFT_BONUS_ARMOR } from '../config';
import { reduce } from '../reducer';
import { createRun, serialize } from '../state';
import { createVersusRun } from './run';
import { DEFAULT_VERSUS_OPTIONS, isDefaultVersusOptions, normalizeVersusOptions, versusOptionsError, VERSUS_MODIFIERS } from './options';

const SAMPLES: unknown[] = [
  {}, { v: 1 }, { v: 2 }, { mode: 'duel' }, { mode: 'group' }, { mode: 'trio' }, { mode: 3 },
  { modifiers: [] }, { modifiers: ['freedom'] }, { modifiers: ['summit'] }, { modifiers: ['runic'] }, { modifiers: ['freedom', 'summit'] },
  { modifiers: ['freedom', 'freedom'] }, { modifiers: 'freedom' }, { modifiers: [7] }, { hearts: 7 }, { timer: 'standard' },
  { v: 1, mode: 'group', modifiers: ['summit'] }, [], 'duel', null,
];

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  const sql = readFileSync(join(__dirname, '../../../../supabase/migrations/2026-10-24-versus-group.sql'), 'utf8');
  for (const name of ['versus__options_error', 'versus__normalize_options']) {
    await db.exec(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`).exec(sql)![0]);
  }
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('Versus room options (R-VERSUS-OPTIONS-01)', () => {
  it('the SQL whitelist refuses exactly what the TS one refuses, with the same code', async () => {
    for (const raw of SAMPLES) {
      const r = await db.query<{ e: string | null }>('select public.versus__options_error($1::jsonb) e', [JSON.stringify(raw)]);
      expect(r.rows[0]!.e, JSON.stringify(raw)).toBe(versusOptionsError(raw));
    }
  });

  it('the SQL normalizer fills the same defaults as the TS one', async () => {
    for (const raw of SAMPLES.filter((x) => versusOptionsError(x) === null)) {
      const r = await db.query<{ o: unknown }>('select public.versus__normalize_options($1::jsonb) o', [JSON.stringify(raw)]);
      expect(r.rows[0]!.o, JSON.stringify(raw)).toEqual(normalizeVersusOptions(raw));
    }
  });

  it('defaults are today\'s 1v1; a missing options object (every match before 2026-10-24) is the defaults', () => {
    expect(DEFAULT_VERSUS_OPTIONS).toEqual({ v: 1, mode: 'duel', modifiers: [] });
    expect(normalizeVersusOptions(null)).toEqual(DEFAULT_VERSUS_OPTIONS);
    expect(isDefaultVersusOptions(normalizeVersusOptions(undefined))).toBe(true);
    expect(isDefaultVersusOptions(normalizeVersusOptions({ mode: 'group' }))).toBe(false);
  });

  it('no options = today\'s run, byte for byte', () => {
    for (const opts of [undefined, null, DEFAULT_VERSUS_OPTIONS, { v: 1 as const, mode: 'group' as const, modifiers: [] }]) {
      expect(serialize(createVersusRun(123, 'warden', 'set3', opts))).toBe(serialize(createRun(123, 'warden', 'versus', undefined, 'set3')));
    }
  });

  it('a modifier pins its rift (and the rift\'s Armor) onto the run; the run then plays by it', () => {
    for (const id of VERSUS_MODIFIERS) {
      const run = createVersusRun(123, 'warden', 'set3', { v: 1, mode: 'duel', modifiers: [id] });
      const plain = createRun(123, 'warden', 'versus', undefined, 'set3');
      expect(run.rift).toBe(id);
      expect(run.armor - plain.armor).toBe(RIFT_BONUS_ARMOR[id] ?? 0);
      expect(run.shop.map((o) => o.cardId)).toEqual(plain.shop.map((o) => o.cardId)); // same opening shop
      expect(serialize(createVersusRun(123, 'warden', 'set3', { v: 1, mode: 'duel', modifiers: [id] }))).toBe(serialize(run));
    }
    // Freedom: the first minion bought each turn is free.
    const free = createVersusRun(5, 'warden', 'set3', { v: 1, mode: 'duel', modifiers: ['freedom'] });
    const plain = createVersusRun(5, 'warden', 'set3');
    const uid = free.shop[0]!.uid;
    const boughtFree = reduce(free, { type: 'buy', uid });
    const boughtPlain = reduce(plain, { type: 'buy', uid });
    expect(boughtPlain.embers).toBeLessThan(plain.embers); // a real buy happened
    expect(boughtFree.embers).toBe(free.embers);
  });
});
