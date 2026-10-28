// @vitest-environment jsdom
/**
 * SUPABASE CLEANUP P1.4 (owner ruling 2026-10-28: "archive and stop reading it"). `board_results` is the retired
 * course mode's per-board fight ledger: written by nothing since 2026-10-14 (R-LEDGER-01), it was still read at every
 * boot and every run end (up to 8,000 rows, ~250 KB on a cold cache). Now:
 *  - no shipped client source names the table (only this archive note and the export script do);
 *  - the startup pool fetch and the between-runs refresh send no `board_results` request, and delete the IndexedDB
 *    window the old read kept.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const tables: string[] = [];
const rpcs: string[] = [];
vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const chain: Record<string, unknown> = {};
    const done = Promise.resolve({ data: [], error: null });
    for (const k of ['select', 'eq', 'in', 'gt', 'gte', 'lte', 'order', 'neq', 'not', 'is', 'or']) chain[k] = () => chain;
    chain.range = () => done;
    chain.limit = () => done;
    chain.abortSignal = () => done;
    chain.then = (f: (v: unknown) => unknown) => done.then(f);
    return {
      from: (t: string) => { tables.push(t); return chain; },
      rpc: (fn: string) => { rpcs.push(fn); return chain; },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    };
  },
}));
const kvDeleted: string[] = [];
vi.mock('./net/idbKv', async (orig) => ({
  ...(await orig<typeof import('./net/idbKv')>()),
  kvGet: async () => null,
  kvSet: async () => {},
  kvDel: async (k: string) => { kvDeleted.push(k); },
}));
vi.setConfig({ testTimeout: 30000 });

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('board_results is archived: never read', () => {
  it('no client source queries the table', () => {
    const hits = sources(__dirname).filter((f) => /from\(['"]board_results['"]\)/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the startup pool fetch and the between-runs refresh send no board_results request, and drop the old IndexedDB window', async () => {
    const mod = await import('./remoteBoards');
    void mod.fetchAndRegisterPool('test+'); // its pool RPC answers through the fake; only the requests matter here
    mod.refreshOpponentPoolAndRecords('test+');
    await new Promise((r) => setTimeout(r, 50));
    expect(tables).not.toContain('board_results');
    expect(kvDeleted).toEqual(['boardResults']); // once per session, however many refreshes
  });
});
