// @vitest-environment jsdom
/**
 * THE VERSUS CHAOS MATRIX (owner bar: Versus must be "spotless"; real play showed End of Turn freezes and broken
 * reconnects). Every scenario plays a Versus match through the REAL client store (one isolated module graph per
 * player), the REAL SQL (PGlite, every Versus migration) and the REAL resolver handlers, on a fake clock, with chaos
 * injected, and asserts the invariants in `chaosMatch.ts` (close on time, resolve in 5 s, one resolver call, nobody
 * stuck, honest pauses that lift on return, every client agreeing with the server on fights, Health and Armor).
 *
 * RUNNING IT
 *   - `npm test` runs the SMOKE subset (CI).
 *   - `CHAOS_FULL=1 npx vitest run versusChaos` runs the whole matrix (scenario x mode); `CHAOS_LOG=<file>` streams each
 *     match's narrative while it plays.
 *
 * KNOWN FAILURES ON MAIN live in `chaosKnown.ts` as (cells, invariant, cause) entries. A cell passes when its violations
 * are EXACTLY its known ones: a new violation fails it (a regression), and a known one that no longer happens fails
 * it too, with "fixed: delete the KNOWN entry". That is the hand-off to the fix branches
 * (fix/versus-server-reliability, fix/versus-client-reliability): delete the entry in the same PR as the fix.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChaosServer } from './chaosServer';
import { CHAOS_MODES, runChaos, type ChaosMode, type ChaosScenario, type InvariantId } from './chaosMatch';
import { SCENARIOS, SMOKE } from './chaosScenarios';
import { knownFor } from './chaosKnown';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const FULL = !!process.env.CHAOS_FULL;
const ONLY = process.env.CHAOS_ONLY ? new RegExp(process.env.CHAOS_ONLY) : null;

let server: ChaosServer;
let played = 0;
/** PGlite degrades after many matches on one instance (a "stack depth limit exceeded" after ~90): a fresh one every 12. */
const REBOOT_EVERY = 12;
beforeAll(async () => {
  server = new ChaosServer(() => Date.now());
  await server.boot();
}, 180_000);
afterAll(async () => { await server?.close(); });

async function play(sc: ChaosScenario, known: Partial<Record<InvariantId, { cause: string; sometimes: boolean }>>): Promise<void> {
  if (played > 0 && played % REBOOT_EVERY === 0) {
    await server.close();
    server = new ChaosServer(() => Date.now());
    await server.boot();
  }
  played++;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: Date.parse('2026-10-27T12:00:00Z') });
  // The client jitters some waits (the finalize backstop) with Math.random: seeded per scenario, every run replays.
  let m = (sc.seed ^ 0x9e3779b9) >>> 0;
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    m = (m + 0x6d2b79f5) >>> 0;
    let t = m;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
  try {
    const r = await runChaos(server, sc);
    const seen = new Set(r.violations.map((v) => v.id));
    const unexpected = r.violations.filter((v) => !known[v.id]).map((v) => `${v.id} r${v.round ?? '-'} @${(v.at / 1000).toFixed(1)}s: ${v.detail}`);
    const fixed = (Object.keys(known) as InvariantId[]).filter((id) => !seen.has(id) && !known[id]!.sometimes).map((id) => `fixed: ${id} (${known[id]!.cause}) no longer happens; delete its KNOWN entry`);
    expect([...unexpected, ...fixed], `${sc.name}/${sc.mode}: ${r.roundsCommitted} rounds, ${r.resolverCalls} resolver calls`).toEqual([]);
  } finally {
    random.mockRestore();
    vi.useRealTimers();
  }
}

const matrix: { name: string; mode: ChaosMode }[] = [];
for (const s of SCENARIOS) for (const mode of CHAOS_MODES) if (s.modes.includes(mode)) matrix.push({ name: s.name, mode });

describe('Versus chaos matrix', () => {
  for (const { name, mode } of matrix) {
    const key = `${name}/${mode}`;
    const inSmoke = SMOKE.includes(key);
    if (ONLY ? !ONLY.test(key) : !(FULL || inSmoke)) continue;
    const def = SCENARIOS.find((s) => s.name === name)!;
    const known = knownFor(key);
    const ids = Object.keys(known);
    it(ids.length ? `${key} (known on main: ${ids.join(', ')})` : key, () => play(def.build(mode), known), 900_000);
  }
});
