// @vitest-environment jsdom
/**
 * VERSUS: WHAT EACH SCREEN SHOWS, AND THE RESULT REACHES SUPABASE (fix/versus-cf-duos-parity, owner reports 2026-10-28 from
 * live Duos on the Cloudflare host: "the duo game starts with the 1v1 ui on the right", "when the game ends it just breaks
 * the lobby"). A scripted match per mode is played through the REAL client (the chaos harness: `chaosClient.ts`) on the
 * Cloudflare room (the one host since 2026-10-29, R-VERSUS-CF-ONLY-01), and what each client SHOWS is recorded at every
 * step and pinned:
 *
 *   layout   the rail area: the 1v1 opponent block only in a 1v1, the rail in every group mode (R-VERSUS-RAIL-LAYOUT-01);
 *   rail     how many seats the rail holds once the first shop is on screen (Ranked Duos: all four teams);
 *   pills    which turn states the End Turn / End Combat gem went through (ready / fightReady / leave ...);
 *   end      how each player's screen leaves the match (the fight, the knockout / stats, back to the room);
 *   result   the room's result reaches Supabase: every persistence job the room queued is run through the REAL writer
 *            (`versus_cf_persist`, every Versus migration on PGlite) and the finished match row lands
 *            (R-VERSUS-CF-PERSIST-01: a Ranked Duos result once never landed at all).
 *
 * The shapes are pinned from the 2026-10-29 run (until then this file also required the Supabase host to show the same
 * shapes for the same match, cell by cell). Hero power STATE is recorded for the report only (the hero power button is
 * being reworked separately).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fitFinishRow, rankedFinishWire, RANKED_FINISH_BUDGET, type PersistJob } from '@game/versus-cf/core';
import { CfChaosServer } from './cfChaosServer';
import { bootVersusRecordsDb } from './writerDb';
import { runChaos, type ChaosHarness, type ChaosMode } from './chaosMatch';
import type { ChaosBackend } from './chaosBackend';
import { versusDuelLayout } from '../../LobbyPanel';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const MODES: readonly ChaosMode[] = ['duel', 'group3', 'duos', 'ranked_duos'];

/** What one client's screen showed over a match, reduced to its shape. */
interface Shape {
  layouts: Set<string>;
  railSeats: Set<number>;
  pills: Set<string>;
  /** The distinct end-of-match states in order (after the server completed the match). */
  end: string[];
  heroPower: Set<string>;
}

const newShape = (): Shape => ({ layouts: new Set(), railSeats: new Set(), pills: new Set(), end: [], heroPower: new Set() });

function record(h: ChaosHarness, s: { phase: string; round: number }, shapes: Shape[]): void {
  for (const [i, c] of h.clients.entries()) {
    const sh = shapes[i]!;
    const v = c.store.useVersus.getState();
    const run = c.game.useGame.getState().run;
    const view = c.view();
    if (run.mode === 'versus' && run.lobby && !view.spectating && (view.runPhase === 'recruit' || view.runPhase === 'combat')) {
      sh.layouts.add(versusDuelLayout(true, run.lobby.seats.length, !!v.match?.group) ? 'duel' : 'rail');
      if (s.phase === 'shop' && view.wave === s.round) sh.railSeats.add(run.lobby.seats.length);
      sh.heroPower.add(`${run.heroId ? 'hero' : 'no-hero'}`);
    }
    if (view.turn !== 'none') sh.pills.add(view.turn);
    if (s.phase === 'complete') {
      const st = `${view.runMode === 'versus' ? `run:${view.runPhase}` : 'off-run'}|${v.screen}|stats:${v.statsOpen ? 1 : 0}|ko:${v.knockout ? 1 : 0}|duosResult:${v.duosResult ? (v.duosResult.pending ? 'pending' : 'shown') : '-'}`;
      if (sh.end.at(-1) !== st) sh.end.push(st);
    }
  }
}

async function play(server: ChaosBackend, mode: ChaosMode): Promise<{ shapes: Shape[]; complete: boolean; violations: string[] }> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: Date.parse('2026-10-27T12:00:00Z') });
  let m = 0x2545f491;
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    m = (m + 0x6d2b79f5) >>> 0;
    let t = m;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
  const shapes: Shape[] = [];
  try {
    const r = await runChaos(server, {
      name: 'parity', mode, seed: 4242,
      // Staggered End Combat presses, so the first one back waits on the others (the ready pills are exercised).
      players: [{ watchMs: 2000 }, { watchMs: 5000 }, { watchMs: 3000 }, { watchMs: 6000 }].slice(0, mode === 'duel' || mode === 'ranked_duos' ? 2 : mode === 'group3' ? 3 : 4),
      onStep: (h, s) => {
        while (shapes.length < h.clients.length) shapes.push(newShape());
        record(h, s, shapes);
      },
    });
    return { shapes, complete: r.complete, violations: r.violations.map((x) => `${x.id}: ${x.detail}`) };
  } finally {
    random.mockRestore();
    vi.useRealTimers();
  }
}

/** The shapes merged over the clients. */
const merged = (shapes: Shape[]) => ({
  layouts: [...new Set(shapes.flatMap((x) => [...x.layouts]))].sort(),
  // The full table (a Ranked Duos table holds only the live pair for a moment, until its recorded teams are seated).
  railSeats: Math.max(0, ...shapes.flatMap((x) => [...x.railSeats])),
  pills: [...new Set(shapes.flatMap((x) => [...x.pills]))].sort(),
  // Each player's final screen, as a multiset (WHO is knocked out first depends on the boards dealt).
  end: shapes.map((x) => x.end.at(-1) ?? null).sort(),
  heroPower: [...new Set(shapes.flatMap((x) => [...x.heroPower]))].sort(),
});

const root = join(__dirname, '../../../../..');
const cf = new CfChaosServer();
const results: Record<string, { cf?: ReturnType<typeof merged>; jobs?: PersistJob[] }> = {};

const PILLS = ['fight', 'fightReady', 'foeReady', 'intro', 'leave', 'locked', 'ready', 'shop', 'waiting'];
/** What every mode's screens show (pinned 2026-10-29, when the Supabase host was retired). */
const EXPECTED: Partial<Record<ChaosMode, Omit<ReturnType<typeof merged>, 'heroPower'>>> = {
  duel: { layouts: ['duel'], railSeats: 2, pills: PILLS, end: ['off-run|room|stats:1|ko:0|duosResult:-', 'off-run|room|stats:1|ko:0|duosResult:-'] },
  group3: { layouts: ['rail'], railSeats: 4, pills: PILLS, end: ['off-run|room|stats:0|ko:1|duosResult:-', 'off-run|room|stats:1|ko:0|duosResult:-', 'off-run|room|stats:1|ko:0|duosResult:-'] },
  duos: { layouts: ['rail'], railSeats: 4, pills: PILLS, end: ['off-run|room|stats:1|ko:0|duosResult:-', 'off-run|room|stats:1|ko:0|duosResult:-', 'off-run|room|stats:1|ko:0|duosResult:-', 'off-run|room|stats:1|ko:0|duosResult:-'] },
  ranked_duos: { layouts: ['rail'], railSeats: 8, pills: PILLS, end: ['off-run|room|stats:1|ko:0|duosResult:-', 'off-run|room|stats:1|ko:0|duosResult:-'] },
};

describe('Versus: each mode shows its own screens, start to end', () => {
  for (const mode of MODES) {
    it(`${mode}`, async () => {
      cf.install();
      try {
        const r = await play(cf, mode);
        expect(r.complete, r.violations.join('\n')).toBe(true);
        const mine = (results[mode] ??= {});
        mine.cf = merged(r.shapes);
        mine.jobs = [...cf.rooms.values()].flatMap((x) => (x as unknown as { persisted: PersistJob[] }).persisted);
      } finally {
        cf.uninstall();
      }
      const b = results[mode]!.cf!;
      if (process.env.PARITY_LOG) console.log(mode, JSON.stringify(b));
      // The rail area: the 1v1 block only in a 1v1, the rail in every group mode.
      expect(b.layouts).toEqual([mode === 'duel' ? 'duel' : 'rail']);
      const want = EXPECTED[mode]!;
      expect(b.layouts).toEqual(want.layouts);
      expect(b.railSeats).toEqual(want.railSeats);
      expect(b.pills).toEqual(want.pills);
      // Every player's screen leaves the match the way it always did.
      expect(b.end).toEqual(want.end);
    }, 900_000);
  }
});

// ── the Cloudflare room's result reaches Supabase (the real writer, on PGlite with every Versus migration) ──────────────
const WRITER = ['2026-11-04-versus-cf-writer.sql', '2026-11-05-versus-cf-writer-group.sql', '2026-11-06-versus-cf-writer-duos.sql', '2026-11-07-versus-cf-ranked.sql', '2026-11-13-duos-match-history.sql'];
const SECRET = 'parity-writer-secret-not-real';

describe('Cloudflare: every finished match persists through versus_cf_persist (R-VERSUS-CF-PERSIST-01)', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await bootVersusRecordsDb();
    // The writer hashes its key with pgcrypto's digest(); PGlite has no pgcrypto, and sha256() is the same.
    await db.exec(`create schema if not exists extensions;
      create or replace function extensions.digest(t text, alg text) returns bytea language sql immutable as $$ select sha256(convert_to(t, 'UTF8')) $$;
      grant usage on schema extensions to anon, authenticated, service_role;`);
    for (const f of WRITER) await db.exec(readFileSync(join(root, 'supabase/migrations', f), 'utf8').replace(/create extension if not exists pgcrypto[^;]*;/i, ''));
    await db.query('insert into public.versus_cf_writer_keys (key_hash, note) values ($1, $2) on conflict do nothing', [createHash('sha256').update(SECRET).digest('hex'), 'parity']);
  }, 180_000);
  afterAll(async () => { await db?.close(); });

  for (const mode of MODES) {
    it(`${mode}: the room's jobs land, and the match is stored complete`, async () => {
      const jobs = results[mode]?.jobs;
      expect(jobs?.length, 'the Cloudflare match of this mode did not run').toBeGreaterThan(0);
      const ids = [...new Set(jobs!.map((j) => String((j.row as { id?: unknown; match_id?: unknown; match?: { id?: unknown } }).id ?? (j.row as { match_id?: unknown }).match_id ?? (j.row as { match?: { id?: unknown } }).match?.id)))];
      await db.query('delete from public.versus_group_matches where id = any($1::uuid[])', [ids]);
      await db.query('delete from public.versus_matches where id = any($1::uuid[])', [ids]);
      // The harness's match ids repeat across modes (a seeded uuid per room), and a history row has no foreign key.
      await db.query('delete from public.duos_match_history where match_id = any($1::uuid[])', [ids]);
      await db.exec('set role anon');
      try {
        for (const j of jobs!) await db.query('select public.versus_cf_persist($1, $2, $3::jsonb)', [SECRET, j.kind, JSON.stringify(j.row)]);
      } finally {
        await db.exec('reset role');
      }
      const table = mode === 'duel' ? 'versus_matches' : 'versus_group_matches';
      const rows = (await db.query<{ phase: string; backend: string }>(`select phase, backend from public.${table} where id = any($1::uuid[])`, [ids])).rows;
      expect(rows).toEqual([{ phase: 'complete', backend: 'cloudflare' }]);
      // DUOS MATCH HISTORY (R-DUOS-HISTORY-01): a Duos game lands ONE history row for its players; 1v1 and Group none.
      const hist = (await db.query<{ mode: string; players: string[]; record: { teams: { members: { board: unknown }[] }[] } }>(
        'select mode, players, record from public.duos_match_history where match_id = any($1::uuid[])', [ids])).rows;
      if (mode === 'duos' || mode === 'ranked_duos') {
        expect(hist.map((h) => [h.mode, h.players.length])).toEqual([[mode === 'duos' ? 'versus_duos' : 'ranked_duos', mode === 'duos' ? 4 : 2]]);
        expect(hist[0]!.record.teams.length).toBe(mode === 'duos' ? 2 : 4);
        expect(hist[0]!.record.teams.some((t) => t.members.some((m) => m.board != null))).toBe(true);
      } else expect(hist).toEqual([]);
    }, 120_000);
  }

  it('a ranked_finish queued by an older build (epoch-ms seat times, a team-only out reason) is made writable at send time', async () => {
    const jobs = results.ranked_duos?.jobs ?? [];
    const fin = jobs.find((j) => j.kind === 'ranked_finish');
    expect(fin).toBeDefined();
    const row = fin!.row as { match: { id: string }; seats: Record<string, unknown>[] };
    const legacy = { ...row, seats: row.seats.map((x) => ({ ...x, locked_at: 1_793_102_497_320, auto_since: 1_793_102_497_320, out_reason: x.out_reason == null ? null : 'abandoned' })) };
    await db.query('delete from public.versus_group_matches where id = $1', [row.match.id]);
    await db.exec('set role anon');
    try {
      await expect(db.query('select public.versus_cf_persist($1, $2, $3::jsonb)', [SECRET, 'ranked_finish', JSON.stringify(legacy)])).rejects.toThrow(/out of range|out_reason/);
      await db.query('select public.versus_cf_persist($1, $2, $3::jsonb)', [SECRET, 'ranked_finish', JSON.stringify(rankedFinishWire(legacy))]);
    } finally {
      await db.exec('reset role');
    }
    expect((await db.query('select phase from public.versus_group_matches where id = $1', [row.match.id])).rows).toEqual([{ phase: 'complete' }]);
  }, 60_000);

  it('a Ranked Duos result too big for the writer is trimmed of archive-only data, never refused', () => {
    const big = 'x'.repeat(400_000);
    const row = {
      match: { id: 'm' }, seats: [], teams: [], placement: 2, submissions: [{ round: 1, prepared_side: { board: [] } }],
      served: [0, 1, 2].map((i) => ({ team: 'b', member: i, recording: { kind: 'duo', blob: big } })),
      rounds: [1, 2, 3].map((r) => ({ round: r, vitals: { a: { health: 30, armor: 5 } }, fights: [{ fight: 0, outcome: 'a', damage: 3, live_result: { blob: big } }] })),
    };
    const fit = fitFinishRow(row);
    expect(JSON.stringify(fit).length).toBeLessThanOrEqual(RANKED_FINISH_BUDGET);
    // What the rating and the duo run need is untouched.
    expect(fit.placement).toBe(2);
    expect(fit.submissions).toEqual(row.submissions);
    expect((fit.rounds as typeof row.rounds).map((r) => [r.round, r.fights[0]!.outcome, r.fights[0]!.damage])).toEqual([[1, 'a', 3], [2, 'a', 3], [3, 'a', 3]]);
    // A row that fits is sent as it is.
    const small = { ...row, served: [], rounds: [] };
    expect(fitFinishRow(small)).toBe(small);
  });
});
