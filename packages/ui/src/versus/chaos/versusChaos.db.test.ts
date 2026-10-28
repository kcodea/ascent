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
 * KNOWN FAILURES ON MAIN are listed in `KNOWN` below (scenario/mode -> the cause): they run as `it.fails`, so a fix that
 * makes one pass turns the suite red until its entry is deleted here. That is the hand-off to the fix branches
 * (fix/versus-server-reliability, fix/versus-client-reliability): delete the entry in the same PR as the fix.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChaosServer } from './chaosServer';
import { CHAOS_MODES, runChaos, type ChaosMode, type ChaosScenario } from './chaosMatch';
import { SCENARIOS, SMOKE } from './chaosScenarios';
import { KNOWN } from './chaosKnown';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const FULL = !!process.env.CHAOS_FULL;
const ONLY = process.env.CHAOS_ONLY ? new RegExp(process.env.CHAOS_ONLY) : null;

let server: ChaosServer;
beforeAll(async () => {
  server = new ChaosServer(() => Date.now());
  await server.boot();
}, 180_000);
afterAll(async () => { await server?.close(); });

async function play(sc: ChaosScenario): Promise<void> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: Date.parse('2026-10-27T12:00:00Z') });
  try {
    const r = await runChaos(server, sc);
    const lines = r.violations.map((v) => `${v.id} r${v.round ?? '-'} @${(v.at / 1000).toFixed(1)}s: ${v.detail}`);
    expect(lines, `${sc.name}/${sc.mode}: ${r.roundsCommitted} rounds, ${r.resolverCalls} resolver calls`).toEqual([]);
  } finally {
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
    const cause = KNOWN[key];
    const title = cause ? `${key} (KNOWN on main: ${cause})` : key;
    (cause ? it.fails : it)(title, () => play(def.build(mode)), 900_000);
  }
});
