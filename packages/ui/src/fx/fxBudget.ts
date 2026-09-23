import { perfMonitor } from '../perfMonitor';
import type { FxDef } from './def';
import { fxActiveFilters, fxLiveParticles } from './fxRuntime';
import { getFxBudgetConfig, type FxBudgetConfig } from './fxBudgetConfig';
import { getPrimitive } from './registry';

/**
 * The FX BUDGET — the registry of live `playDef` plays and the spawn-time trim that keeps their total under
 * the caps in `fxBudgetConfig.ts`.
 *
 * ── the defect this closes ───────────────────────────────────────────────────────────────────────────
 * Every authored def is fire-and-forget: `playDef` mounts a container, runs a player, and retires when the
 * player says it is done. Nothing ever looked at how many were ALREADY running. At combat speed a clash
 * fires before the previous clash's `strike-impact` shards have died, so the population only ever grew —
 * 5,778 live particles and 80 filters at the recorded peak (see the config header), and `fx:tick` at 20 ms.
 *
 * ── the policy: trim the OLDEST, never the newest ────────────────────────────────────────────────────
 * Enforcement happens ONCE per play, at spawn, before the new play exists. When a cap would be exceeded the
 * oldest trimmable play is retired — same def id first (a pile-up pays for itself: the strike that is
 * mostly faded gives way to the strike that is landing now), then the oldest of any def. The incoming play
 * is never a candidate, so a single burst always looks exactly as authored; only what is stacked BEHIND it
 * can be cut, and what is cut is the play furthest through its life. Retiring is the same idempotent
 * teardown a natural finish runs (`createRetire`), so the container, updater, filters and pooled particle
 * layer all go back the way they always do — there is no second cleanup path to keep correct.
 *
 * A SCENE can lower the particle ceiling without changing the policy: while the Discover overlay is open
 * (`setFxScene('discover')`, driven by `Game.tsx` off `run.discover`) the cap is the lower of `maxParticles`
 * and `maxParticlesDiscover` (`particleCapFor`). See `fxBudgetConfig.ts` for what that number is sized
 * against and why the Discover is the one scene that gets its own.
 *
 * Three plays are PROTECTED from trimming and are never candidates (they still count toward the totals):
 * a looping play (`opts.loop` — caller-owned, a persistent card treatment), a following play
 * (`opts.follow` — the same), and a play with an `onDone` callback (the caller is sequencing on its
 * completion, so cutting it short would move a beat — a gameplay-visible change this is not allowed to make).
 *
 * ── what "expected load" is ──────────────────────────────────────────────────────────────────────────
 * The particle cap compares the pool's REAL live count against the cap, plus what the incoming play will
 * add. That addition is estimated statically from the def (`expectedLoad`): a burst emits its whole `count`
 * at once; an emitter/smoke layer has `rate × life` motes alive at steady state. The def handed in is the
 * post-`scaleDef` one, so a per-call `intensity` is already folded in. Mesh primitives (ribbon, beam,
 * lightning, shockwave) carry no particles. The estimate is also what decides WHICH plays are candidates
 * for a given cap — a play with no filters cannot relieve the filter cap, so it is skipped for that one.
 *
 * Counters: `fx:culled` is a cumulative total (a level, so the HUD strip and the peak sampler show it climb)
 * and is also tallied per bucket through `perfMonitor.count` (a rate), so a capture shows both whether the
 * cap ever bit and in which second.
 */

/** What one play is expected to put on screen — the two quantities the caps are expressed in. */
export interface FxPlayLoad {
  particles: number;
  filters: number;
}

/** A play the budget knows about. Registered by `playDef` after the player is built, removed on retire. */
export interface FxLivePlay {
  readonly id: string;
  readonly load: FxPlayLoad;
  /** The play's own idempotent teardown. */
  readonly retire: () => void;
  /** Never a trim candidate — see the module header. */
  readonly protected: boolean;
}

/** The live totals a cap is checked against. Injectable so the policy is testable without a renderer. */
export interface FxBudgetReaders {
  liveParticles(): number;
  activeFilters(): number;
}

const RUNTIME_READERS: FxBudgetReaders = { liveParticles: fxLiveParticles, activeFilters: fxActiveFilters };

/** Oldest first — `registerLivePlay` appends, so insertion order IS age order. A play is removed by
 *  identity on retire (`unregister`) or when the budget trims it. */
const plays: FxLivePlay[] = [];
let culled = 0;

/**
 * The SCENE a spawn is admitted into. A scene may carry its own, lower particle ceiling
 * (`FxBudgetConfig.maxParticlesDiscover`) — see `particleCapFor`. Only the Discover exists today; `null` is
 * ordinary play. Set from `Game.tsx` off the run state (`run.discover`), so the FX layer never imports the
 * store.
 */
export type FxScene = 'discover';
let scene: FxScene | null = null;

export function setFxScene(next: FxScene | null): void {
  scene = next;
}
export function fxScene(): FxScene | null {
  return scene;
}

/** PURE: the live-particle ceiling in force for `scene` — the global cap, or the lower scene cap inside one. */
export function particleCapFor(cfg: Pick<FxBudgetConfig, 'maxParticles' | 'maxParticlesDiscover'>, activeScene: FxScene | null): number {
  return activeScene === 'discover' ? Math.min(cfg.maxParticles, cfg.maxParticlesDiscover) : cfg.maxParticles;
}

// Registered at load, once: the FX runtime is a module singleton, and the monitor keeps a Map so a second
// registration under the same name would only overwrite. A level, read at 20 Hz — never per frame.
perfMonitor.registerCounter('fx:culled', () => culled);

const numParam = (params: Record<string, unknown>, key: string, fallback: number): number => {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/** A primitive's declared default for a slider param, or `fallback` when the primitive (or the param) is
 *  unknown — the registry is empty headless and before the primitives chunk has loaded. */
function specDefault(primitiveId: string, key: string, fallback: number): number {
  const spec = getPrimitive(primitiveId)?.params[key] as { default?: unknown } | undefined;
  return typeof spec?.default === 'number' ? spec.default : fallback;
}

/**
 * PURE (given the registry): the load one play of `def` is expected to add. See the module header for how
 * each primitive is counted. Muted layers are already gone by the time `playDef` calls this (it hands in
 * `playableDef`'s output), so every layer here renders.
 */
export function expectedLoad(
  def: { layers: readonly Pick<FxDef['layers'][number], 'primitive' | 'params'>[] },
): FxPlayLoad {
  let particles = 0;
  let filters = 0;
  for (const layer of def.layers) {
    const p = layer.params as Record<string, unknown>;
    if (layer.primitive === 'burst') {
      particles += numParam(p, 'count', specDefault('burst', 'count', 0));
    } else if (layer.primitive === 'emitter' || layer.primitive === 'smoke') {
      const rate = numParam(p, 'rate', specDefault(layer.primitive, 'rate', 0));
      const life = numParam(p, 'life', specDefault(layer.primitive, 'life', 0));
      particles += Math.round((rate * life) / 1000);
    }
    // The filter lab's toggles are `<filterId>On`; the always-on core blur counts when its amount is > 0.
    for (const k in p) if (k.endsWith('On') && p[k] === true) filters++;
    if (numParam(p, 'blur', 0) > 0) filters++;
  }
  return { particles, filters };
}

/** Add a play to the registry. Returns its idempotent unregister. */
export function registerLivePlay(play: FxLivePlay): () => void {
  plays.push(play);
  return () => {
    const i = plays.indexOf(play);
    if (i >= 0) plays.splice(i, 1);
  };
}

/** Live plays right now — all of them, or only those of one def id. */
export function livePlayCount(id?: string): number {
  if (id === undefined) return plays.length;
  let n = 0;
  for (const p of plays) if (p.id === id) n++;
  return n;
}

/** Plays trimmed by the budget since load — the `fx:culled` level. */
export function culledTotal(): number {
  return culled;
}

/** The oldest trimmable play that `relieves` the cap in question — same def id first, then any. */
function pickVictim(id: string, relieves: (p: FxLivePlay) => boolean): FxLivePlay | null {
  let any: FxLivePlay | null = null;
  for (const p of plays) {
    if (p.protected || !relieves(p)) continue;
    if (p.id === id) return p;
    any ??= p;
  }
  return any;
}

/** Remove `victim` from the registry FIRST, then retire it — so a retire that somehow fails to reach its
 *  own unregister can never leave the loop in `admitPlay` spinning on the same play. */
function trim(victim: FxLivePlay): void {
  const i = plays.indexOf(victim);
  if (i >= 0) plays.splice(i, 1);
  culled++;
  perfMonitor.count('fx:culled');
  victim.retire();
}

/**
 * Make room for a play of `id` with the given expected `load`, trimming older plays as the caps require.
 * Returns how many were trimmed. Call BEFORE building the play, so the incoming one is never a candidate.
 *
 * Every loop is bounded by the registry: each pass retires one play, and a pass with no candidate stops.
 * A single play larger than a cap on its own therefore still spawns — after everything trimmable is gone.
 */
export function admitPlay(
  id: string,
  load: FxPlayLoad,
  cfg: FxBudgetConfig = getFxBudgetConfig(),
  readers: FxBudgetReaders = RUNTIME_READERS,
  activeScene: FxScene | null = scene,
): number {
  let n = 0;
  const maxParticles = particleCapFor(cfg, activeScene);
  // Per-def concurrency: this def's own oldest goes, and only this def's — another def's play cannot
  // relieve a per-def cap.
  while (livePlayCount(id) >= cfg.maxPerDef) {
    const victim = pickVictim(id, (p) => p.id === id);
    if (!victim) break;
    trim(victim);
    n++;
  }
  // Global particles: the REAL live count (the pool's, which drops synchronously as a trimmed play's
  // particle layers are released) plus what this play will add. Inside the Discover the ceiling is the
  // scene's lower cap (`particleCapFor`) — same trim, same protections, only the number changes.
  if (load.particles > 0) {
    while (readers.liveParticles() + load.particles > maxParticles) {
      const victim = pickVictim(id, (p) => p.load.particles > 0);
      if (!victim) break;
      trim(victim);
      n++;
    }
  }
  // Global filters, the same way. A play's filters are built lazily on its first frame, so the live count
  // can lag the registry by a frame; the estimate on the incoming side covers the moment that matters.
  if (load.filters > 0) {
    while (readers.activeFilters() + load.filters > cfg.maxFilters) {
      const victim = pickVictim(id, (p) => p.load.filters > 0);
      if (!victim) break;
      trim(victim);
      n++;
    }
  }
  return n;
}

/**
 * Retire EVERY registered play — protected ones included — and empty the registry. Returns how many retired.
 *
 * Called by `pixiFx.detach()` (the overlay unmounts at the title screen and for the rank preview) so no play
 * outlives the Pixi context it was built on. Before this, a one-shot still live at detach kept its updater,
 * its registry entry, its pooled particle layer (`fxLiveParticles`) and its filter counters after the stage
 * had destroyed its containers: the next context's first tick hit a null shader resource
 * (`Cannot read properties of null (reading 'fxUniforms')`), the guard evicted the updater, and the ghost
 * sat in the registry counting against `maxParticles` for the rest of the session (found 2026-09-22).
 *
 * NOT a budget trim: `culled` / `fx:culled` are left alone so that counter keeps meaning "the cap bit".
 * Empties the registry FIRST and retires a SNAPSHOT (each `retire()` would otherwise splice `plays` under
 * the loop, skipping every other play) — the same remove-then-retire shape `trim` uses, so a retire that
 * never reaches its own unregister still leaves nothing behind. One throwing retire is logged and skipped
 * rather than allowed to abandon the rest as ghosts. `retire` is idempotent, so a caller-owned loop's later
 * dispose is a harmless no-op.
 */
export function retireLivePlays(): number {
  const snapshot = [...plays];
  plays.length = 0;
  for (const p of snapshot) {
    try {
      p.retire();
    } catch (e) {
      console.error(`[fx] retiring play '${p.id}' at detach threw — skipping it:`, e);
    }
  }
  return snapshot.length;
}

/** A read-only snapshot for the DEV console handle (`window.__fx.budget.live()`). */
export function livePlaysSnapshot(): { id: string; particles: number; filters: number; protected: boolean }[] {
  return plays.map((p) => ({ id: p.id, particles: p.load.particles, filters: p.load.filters, protected: p.protected }));
}

/** Test-only: forget every registered play (without retiring it), zero the cull total, leave any scene. */
export function resetFxBudget(): void {
  plays.length = 0;
  culled = 0;
  scene = null;
}
