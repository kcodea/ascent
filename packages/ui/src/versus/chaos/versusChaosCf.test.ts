// @vitest-environment jsdom
/**
 * THE VERSUS CHAOS MATRIX (owner bar: Versus must be "spotless"). Versus runs on Cloudflare only (R-VERSUS-CF-ONLY-01;
 * the Supabase matrix was retired with the Supabase host 2026-10-29). The scenarios (`chaosScenarios.ts`) and invariants
 * (`chaosMatch.ts`) run on the REAL room rules (`workers/versus` RoomCore) in a mirror of the Durable Object shell on the
 * fake clock (`cfChaosServer.ts`, which says why not Miniflare), every client on the REAL Cloudflare transport
 * (`chaosClient.ts`).
 *
 * RUNNING IT
 *   - `npm test` runs the SMOKE subset below (CI).
 *   - `CHAOS_FULL=1 npx vitest run versusChaosCf` runs the whole matrix; `CHAOS_ONLY=<regex>` picks cells ; `CHAOS_LOG=<file>`
 *     streams each match's narrative; `CHAOS_TABLE=<file>` appends one `cell<TAB>result` line per cell.
 *
 * KNOWN FAILURES live in `chaosKnownCf.ts`.
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
 * CLOUDFLARE-ONLY SCENARIOS (beside the shared matrix). On Cloudflare presence is the socket, and the shared drops are
 * SILENT (the object hears nothing and finds the socket when its keep-alive goes stale, 15 s after the last ping), so a
 * 20 s drop barely pauses there. `dropLong` (shared, judged by `latePause`) covers the silent case; this one is a drop the
 * object hears at once (a closed socket): paused within the 3 s grace, lifted on return.
 */
export const CF_EXTRA: ScenarioDef[] = [
  {
    // R-SPECTATE-HARNESS-01 (owner 2026-10-29: "make sure spectating is also extremely clean"): a whole match watched
    // from the stands, the watched player switched in a shop and again mid-fight; the match runs to its end.
    name: 'spectate', about: 'a spectator watches the whole match, switching players in a shop and mid-fight, and ends back in the room', modes: CF_MODES,
    build: (mode) => ({
      name: 'spectate', mode, seed: seedOf('spectate', mode),
      spectators: [{ switches: [{ round: 2, phase: 'shop', afterMs: 1500, seat: 'p2' }, { round: 3, phase: 'combat', afterMs: 1000, seat: 'p1' }] }],
    }),
  },
  {
    // R-RANKED-DUOS-END-01 (live report 2026-11-02, "the last fight mike got frozen and combat didnt start"): one teammate
    // ends the turn early and waits on the other's screen (the teammate view) every round, the deciding one included.
    name: 'mateWatch', about: "a teammate ends the turn early and watches the other teammate's shop every round; the match runs to its end and both teammates end in the room", modes: ['duos', 'ranked_duos'],
    build: (mode) => ({
      name: 'mateWatch', mode, seed: seedOf('mateWatch', mode),
      players: Array.from({ length: mode === 'duos' ? 4 : 2 }, (_, i) => (i === 1 ? { policy: 'buyer', thinkMs: 1000, watchMate: true } : { policy: i % 2 ? 'empty' : 'buyer', thinkMs: 6000 })),
    }),
  },
  {
    // The same, the TEAM KNOCKED OUT (the live report's end: the pair placed 3rd while two recorded teams played on).
    name: 'mateWatchOut', about: 'Ranked Duos: a teammate watches the other while the deciding round knocks the pair out (recorded teams play on); both end in the room', modes: ['ranked_duos'],
    build: (mode) => ({
      name: 'mateWatchOut', mode, seed: seedOf('mateWatchOut', mode),
      players: [{ policy: 'buyer', thinkMs: 6000 }, { policy: 'buyer', thinkMs: 1000, watchMate: true }],
      events: [{ round: 1, phase: 'shop', act: (h) => { (h.server as CfChaosServer).rankedKnockOutAt = 4; } }],
    }),
  },
  {
    name: 'knockOut', about: 'Ranked Duos: the deciding round knocks the pair out (recorded teams play on); both teammates end in the room', modes: ['ranked_duos'],
    build: (mode) => ({
      name: 'knockOut', mode, seed: seedOf('knockOut', mode),
      players: [{ policy: 'buyer', thinkMs: 3000 }, { policy: 'buyer', thinkMs: 1500 }],
      events: [{ round: 1, phase: 'shop', act: (h) => { (h.server as CfChaosServer).rankedKnockOutAt = 3; } }],
    }),
  },
  // ── 2026-11-08 (fix/versus-reliability-nov): the paths no client drove before: a concede (shop and mid-fight), a player
  // gone for good (the others unpause, the seat plays on auto until it is out), and a player who comes back while on
  // auto (resumes where the match is: no new pause, nobody waits). The chaos clients never pressed Unpause or Concede.
  {
    name: 'concede', about: 'a player concedes in round 2\'s shop (the Esc menu); the match ends or goes on without them, and everyone still in ends in the room', modes: CF_MODES,
    build: (mode) => ({
      name: 'concede', mode, seed: seedOf('concede', mode),
      events: [{ round: 2, phase: 'shop', afterMs: 800, act: (h) => { void h.clients[1]!.store.forfeitMatch(); } }],
    }),
  },
  {
    name: 'concedeInFight', about: 'a player concedes while round 2\'s fight plays', modes: CF_MODES,
    build: (mode) => ({
      name: 'concedeInFight', mode, seed: seedOf('concedeInFight', mode),
      events: [{ round: 2, phase: 'combat', afterMs: 1000, act: (h) => { void h.clients[1]!.store.forfeitMatch(); } }],
    }),
  },
  {
    name: 'goneForGood', about: 'a player loses the network for the rest of the match in round 2; after the grace the host unpauses and the seat plays on auto until it is out', modes: ['duel', 'group3', 'group4', 'duos'],
    build: (mode) => ({
      name: 'goneForGood', mode, seed: seedOf('goneForGood', mode),
      events: [
        { round: 2, phase: 'shop', afterMs: 500, act: (h) => { (h.server as CfChaosServer).finOnDrop = true; h.drop(1, 40 * 60_000); } },
        { round: 2, phase: 'shop', afterMs: 40_000, act: (h) => { void h.clients[0]!.store.unpauseMatch(); } },
      ],
    }),
  },
  {
    name: 'autoReturn', about: 'a player gone 70 s is unpaused onto auto, then comes back mid-round: auto ends, the match goes on with no new pause and nobody waits', modes: ['duel', 'group3', 'group4', 'duos'],
    build: (mode) => ({
      name: 'autoReturn', mode, seed: seedOf('autoReturn', mode), rounds: 4,
      events: [
        { round: 2, phase: 'shop', afterMs: 500, act: (h) => { (h.server as CfChaosServer).finOnDrop = true; h.drop(1, 70_000); } },
        { round: 2, phase: 'shop', afterMs: 40_000, act: (h) => { void h.clients[0]!.store.unpauseMatch(); } },
      ],
    }),
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
  'spectate/duel', 'spectate/duos', 'spectate/ranked_duos',
  'emptyAll/duel', 'dropRestore/duel', 'realtimeDown/duel', 'resolverFail3/group3', 'mendArmor/duos', 'dropFin/group4', 'dropLong/group4',
];

let server: CfChaosServer;
beforeAll(() => {
  server = new CfChaosServer();
  server.install();
});
afterAll(() => { server?.uninstall(); });

async function play(sc: ChaosScenario, known: Partial<Record<InvariantId, { cause: string; sometimes: boolean }>>): Promise<void> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'], now: Date.parse('2026-10-27T12:00:00Z') });
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
