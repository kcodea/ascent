/**
 * `balance:corpus` — the recorded player corpus: paged REST fetch (mocked), the eligibility rule at the door, an
 * order-independent digest, the file shape, and registration that refuses a digest mismatch. No network.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '@game/sim';
import { buildCorpus, corpusDigest, corpusPath, eligibleBoard, fetchCorpusBoards, loadCorpus, registerCorpus, writeCorpus } from './corpus';

const snap = (author: string, heroId: string, seed: number, wave: number, extra: Partial<BoardSnapshot> = {}): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: 1 + Math.floor(wave / 3), triples: 0, tribes: ['dragon', 'demon', 'beast', 'dwarf', 'kobold'], threat: 'glass', power: 0,
  minions: [{ cardId: 'n2_spellsword', attack: 3 + wave, health: 4 + wave, keywords: [], golden: false }],
  seed, origin: 'self', author, setId: 'set2', patch: '0.1.0+abcd1234', ...extra,
} as BoardSnapshot);

const ROWS = [
  ...Array.from({ length: 6 }, (_, w) => ({ wave: w + 1, patch: '0.1.0+abcd1234', snapshot: snap('Ada', 'warden', 11, w + 1) })),
  ...Array.from({ length: 5 }, (_, w) => ({ wave: w + 1, patch: '0.1.0+ffff0000', snapshot: snap('Baz', 'soren', 22, w + 1, { patch: undefined }) })), // patch only on the row
  { wave: 3, patch: '0.1.0+abcd1234', snapshot: snap('Bot', 'drakko', 33, 3, { origin: 'synthetic' }) },   // synthetic: out
  { wave: 3, patch: '0.1.0+abcd1234', snapshot: snap('Ada', 'warden', 11, 3, { minions: [] }) },          // empty: out
  { wave: 3, patch: '0.1.0+abcd1234', snapshot: snap('Old', 'warden', 44, 3, { setId: 'set1' }) },        // wrong set: out
  { wave: 2, patch: '0.1.0+abcd1234', snapshot: snap('Ada', 'warden', 11, 2) },                          // duplicate upload: collapses
];

/** A fake Supabase REST endpoint honouring `Range` paging. */
function fakeFetch(rows: typeof ROWS, calls: { url: string; range: string }[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const h = init?.headers as Record<string, string>;
    const [lo, hi] = h.Range.split('-').map(Number);
    calls.push({ url: String(url), range: h.Range });
    expect(h.apikey).toBe('KEY'); expect(h.Authorization).toBe('Bearer KEY');
    const page = rows.slice(lo, hi + 1);
    return new Response(JSON.stringify(page), { status: page.length < rows.length ? 206 : 200 });
  }) as unknown as typeof fetch;
}

const root = mkdtempSync(join(tmpdir(), 'balance-corpus-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('fetchCorpusBoards', () => {
  it('pages with Range headers until a short page, filters on the set server-side and eligibility client-side', async () => {
    const calls: { url: string; range: string }[] = [];
    const { boards, rows } = await fetchCorpusBoards({ url: 'https://x.supabase.co/', key: 'KEY', setId: 'set2', pageSize: 5, fetchImpl: fakeFetch(ROWS, calls) });
    expect(rows).toBe(ROWS.length);
    expect(calls.map((c) => c.range)).toEqual(['0-4', '5-9', '10-14', '15-19']); // a full third page → one more (empty) ask
    expect(calls[0]!.url).toContain('/rest/v1/boards?select=wave,patch,snapshot,created_at&snapshot->>setId=eq.set2');
    // 6 Ada + 5 Baz + the duplicate Ada wave 2 (de-duplicated later, in buildCorpus) — synthetic / empty / set1 out.
    expect(boards).toHaveLength(12);
    expect(boards.every((b) => b.setId === 'set2' && b.origin !== 'synthetic' && b.minions.length > 0)).toBe(true);
    // The row's patch column fills a snapshot that lacks one.
    expect(boards.find((b) => b.author === 'Baz')!.patch).toBe('0.1.0+ffff0000');
  });

  it('honours a patch prefix', async () => {
    const { boards } = await fetchCorpusBoards({ url: 'https://x.supabase.co', key: 'KEY', setId: 'set2', patchPrefix: '0.1.0+ffff', fetchImpl: fakeFetch(ROWS, []) });
    expect(boards.every((b) => b.author === 'Baz')).toBe(true);
  });

  it('eligibleBoard is the one rule', () => {
    expect(eligibleBoard(snap('a', 'warden', 1, 1), 'set2')).toBe(true);
    expect(eligibleBoard(snap('a', 'warden', 1, 1, { origin: 'synthetic' }), 'set2')).toBe(false);
    expect(eligibleBoard(snap('a', 'warden', 1, 1, { setId: undefined }), 'set2')).toBe(false); // legacy = set1
    expect(eligibleBoard(snap('a', 'warden', 1, 1, { setId: undefined }), 'set1')).toBe(true);
    expect(eligibleBoard(null, 'set2')).toBe(false);
  });
});

describe('buildCorpus + the file', () => {
  let boards: BoardSnapshot[]; let file: ReturnType<typeof buildCorpus>;
  beforeAll(async () => {
    boards = (await fetchCorpusBoards({ url: 'https://x.supabase.co', key: 'KEY', setId: 'set2', fetchImpl: fakeFetch(ROWS, []) })).boards;
    file = buildCorpus('test-corpus', 'set2', boards, { fetchedAt: '2026-09-15T00:00:00.000Z' });
  });

  it('has the documented shape, de-duplicated, with runs and authors counted through playerRunsFrom', () => {
    expect(file.schemaVersion).toBe(1);
    expect(file.name).toBe('test-corpus');
    expect(file.setId).toBe('set2');
    expect(file.boards).toHaveLength(11); // the duplicate Ada wave-2 upload collapsed
    expect(file.runs).toBe(2);
    expect(file.authors).toBe(2);
    expect(file.patches).toEqual({ '0.1.0+abcd1234': 6, '0.1.0+ffff0000': 5 });
    expect(file.digest).toBe(corpusDigest(file.boards));
  });

  it('the digest is order-independent and content-sensitive', () => {
    const reversed = buildCorpus('r', 'set2', [...boards].reverse(), { fetchedAt: 'later' });
    expect(reversed.digest).toBe(file.digest);
    const changed = buildCorpus('c', 'set2', boards.map((b, i) => (i === 0 ? { ...b, minions: [{ ...b.minions[0]!, attack: 99 }] } : b)));
    expect(changed.digest).not.toBe(file.digest);
  });

  it('writes, loads, and registers only under the digest the manifest names', () => {
    const path = writeCorpus(file, root);
    expect(path).toBe(corpusPath('test-corpus', root));
    expect(loadCorpus('test-corpus', root).digest).toBe(file.digest);
    expect(() => registerCorpus({ name: 'test-corpus', digest: 'nope' }, root)).toThrow(/digest/);
    expect(() => registerCorpus({ name: 'missing', digest: file.digest }, root)).toThrow(/no corpus/);
    const reg = registerCorpus({ name: 'test-corpus', digest: file.digest }, root);
    expect(reg.registered).toBe(11);
    expect(reg.runs).toBeGreaterThanOrEqual(2);
    expect(reg.authors).toBeGreaterThanOrEqual(2);
    // Idempotent: a second registration adds nothing.
    expect(registerCorpus({ name: 'test-corpus', digest: file.digest }, root).registered).toBe(0);
    // An edited file is refused even when the manifest's digest matches its stamp.
    const edited = { ...file, boards: file.boards.slice(1) };
    writeCorpus({ ...edited, name: 'edited' }, root);
    expect(() => registerCorpus({ name: 'edited', digest: file.digest }, root)).toThrow(/edited/);
  });
});
