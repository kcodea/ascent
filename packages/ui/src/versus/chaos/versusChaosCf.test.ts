// @vitest-environment jsdom
/**
 * THE VERSUS CHAOS MATRIX ON CLOUDFLARE: the cutover's acceptance gate (owner decision 2026-10-28: live Versus moves
 * from Supabase to Durable Objects behind a per-mode switch). The same scenarios (`chaosScenarios.ts`) and the same
 * invariants (`chaosMatch.ts`) as the Supabase matrix (`versusChaos.db.test.ts`), so the two tables compare cell by cell;
 * only the host differs: the REAL room rules (`workers/versus` RoomCore) in a mirror of the Durable Object shell on the
 * fake clock (`cfChaosServer.ts`, which says why not Miniflare), and every client on the REAL cutover router + Cloudflare
 * transport (`chaosClient.ts`'s transport switch).
 *
 * RUNNING IT
 *   - `npm test` runs the SMOKE subset below (CI).
 *   - `CHAOS_FULL=1 npx vitest run versusChaosCf` runs the whole matrix; `CHAOS_ONLY=<regex>` picks cells (it also
 *     matches the Supabase file: add `versusChaosCf` to the vitest filter to run only this one); `CHAOS_LOG=<file>`
 *     streams each match's narrative; `CHAOS_TABLE=<file>` appends one `cell<TAB>result` line per cell.
 *
 * KNOWN FAILURES live in `chaosKnownCf.ts` (its own ledger: a Cloudflare finding is not a Supabase one).
 */
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CfChaosServer } from './cfChaosServer';
import { runChaos, type ChaosMode, type ChaosScenario, type InvariantId } from './chaosMatch';
import { SCENARIOS, type ScenarioDef } from './chaosScenarios';
import { knownForCf } from './chaosKnownCf';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const FULL = !!process.env.CHAOS_FULL;
const ONLY = process.env.CHAOS_ONLY ? new RegExp(process.env.CHAOS_ONLY) : null;

/** Every mode the Cloudflare room plays (Ranked Duos since #2374). */
export const CF_MODES: readonly ChaosMode[] = ['duel', 'group3', 'group4', 'duos', 'ranked_duos'];

const seedOf = (name: string, mode: ChaosMode): number => [...`${name}/${mode}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/**
 * CLOUDFLARE-ONLY SCENARIOS (beside the shared matrix, which stays unchanged so the two tables compare). On Cloudflare
 * presence is the socket, and the shared drops are SILENT (the object hears nothing and finds the socket only when its
 * keep-alive goes stale, 15-30 s later), so a 20 s drop never pauses there and the pause / auto-resume path would go
 * untested. These two drive it: a drop long enough to be found stale, and a drop the object hears at once.
 */
export const CF_EXTRA: ScenarioDef[] = [
  {
    name: 'dropLong', about: 'a silent 45 s network loss in a shop: found stale, the match pauses, and lifts on return', modes: CF_MODES,
    build: (mode) => ({ name: 'dropLong', mode, seed: seedOf('dropLong', mode), rounds: 3, events: [{ round: 2, phase: 'shop', afterMs: 500, act: (h) => h.drop(1, 45_000) }] }),
  },
  {
    name: 'dropFin', about: 'a 20 s loss the object hears (a closed socket): paused within the 3 s grace, lifted on return', modes: CF_MODES,
    build: (mode) => ({
      name: 'dropFin', mode, seed: seedOf('dropFin', mode), rounds: 3,
      events: [{ round: 2, phase: 'shop', afterMs: 500, act: (h) => { (h.server as CfChaosServer).finOnDrop = true; h.drop(1, 20_000); } }],
    }),
  },
];

/** The CI subset: one clean match per mode family, the restart (the Cloudflare-only failure mode), a drop, a resolve
 *  that dies, and Mend's live Armor on a team. */
export const SMOKE_CF: string[] = [
  'baseline/duel', 'baseline/group3', 'baseline/duos', 'baseline/ranked_duos',
  'emptyAll/duel', 'dropRestore/duel', 'realtimeDown/duel', 'resolverFail3/group3', 'mendArmor/duos', 'dropFin/group4',
];

let server: CfChaosServer;
beforeAll(() => {
  server = new CfChaosServer();
  server.install();
});
afterAll(() => { server?.uninstall(); });

async function play(sc: ChaosScenario, known: Partial<Record<InvariantId, { cause: string; sometimes: boolean }>>): Promise<void> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: Date.parse('2026-10-27T12:00:00Z') });
  let m = (sc.seed ^ 0x9e3779b9) >>> 0;
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    m = (m + 0x6d2b79f5) >>> 0;
    let t = m;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
  const key = `${sc.name}/${sc.mode}`;
  try {
    const r = await runChaos(server, sc);
    const seen = new Set(r.violations.map((v) => v.id));
    const unexpected = r.violations.filter((v) => !known[v.id]).map((v) => `${v.id} r${v.round ?? '-'} @${(v.at / 1000).toFixed(1)}s: ${v.detail}`);
    const fixed = (Object.keys(known) as InvariantId[]).filter((id) => !seen.has(id) && !known[id]!.sometimes).map((id) => `fixed: ${id} (${known[id]!.cause}) no longer happens; delete its KNOWN entry`);
    const end = r.matchId ? server.endReason(r.matchId) : null;
    if (process.env.CHAOS_TABLE) {
      const ids = [...seen].sort();
      appendFileSync(process.env.CHAOS_TABLE, `${key}\t${ids.length ? `FAIL: ${ids.join(', ')}` : 'pass'}${end === 'void' ? ' (void)' : ''}\t${r.roundsCommitted} rounds\t${r.resolverCalls} resolves\n`);
    }
    expect([...unexpected, ...fixed], `${key}: ${r.roundsCommitted} rounds, ${r.resolverCalls} resolves${end ? `, ended ${end}` : ''}`).toEqual([]);
  } finally {
    random.mockRestore();
    vi.useRealTimers();
  }
}

describe('Versus chaos matrix on Cloudflare', () => {
  for (const def of [...SCENARIOS, ...CF_EXTRA]) {
    for (const mode of CF_MODES) {
      if (!def.modes.includes(mode)) continue;
      const key = `${def.name}/${mode}`;
      if (ONLY ? !ONLY.test(key) : !(FULL || SMOKE_CF.includes(key))) continue;
      const known = knownForCf(key);
      const ids = Object.keys(known);
      it(ids.length ? `${key} (known: ${ids.join(', ')})` : key, () => play(def.build(mode), known), 900_000);
    }
  }
});
