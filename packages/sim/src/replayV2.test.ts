import { describe, it, expect } from 'vitest';
import { reduce } from './reducer';
import { DEFAULT_BOT } from './bots/index';
import type { RunState } from './state';
import { runRecord } from './state';
import { createLobbyRun, playerLobbySeat } from './lobby/runLobby';
import {
  SHOP_VIEW_EXCLUDED_KEYS,
  combatFrameOf,
  deltaShopFrameOf,
  expandFrames,
  projectShopView,
  rollupRounds,
  roundMarks,
  shopFrameOf,
  appendInspectEvent,
  INSPECT_NOISE_MS,
  INSPECT_OPEN_THROTTLE_MS,
  type InspectEvent,
  type ReplayFrame,
  type ReplayV2,
  type ShopView,
} from './replayV2';

/**
 * REPLAY V2 — Phase A (capture) tests, per docs/replay-v2-handoff.md §11.
 *
 * These drive the REAL reducer with the real bot (like runLobby.test.ts) and capture frames through the
 * exact rules the store applies in `commitResolvedAction`: a `turnStart` shop frame at every shop opening,
 * a shop frame per state-changing recruit action, a combat frame per `faceOmen`, and a `resolveLost` patch
 * when the settle action lands. No determinism test — that is the entire point of state replay.
 */

/** Per-wave ground truth observed LIVE off the run (independently of the frames) for the rollup golden. */
interface WaveTruth { actions: number; tierAtStart: number; goldSpent: number }

function captureBotRun(seed: number, heroId: string, maxSteps = 6000): {
  final: RunState;
  frames: ReplayFrame[];
  fullFrames: ReplayFrame[];
  truth: Map<number, WaveTruth>;
  totalHealthLost: number;
} {
  let s = createLobbyRun(seed, heroId);
  const first = shopFrameOf(s, 'turnStart', 0);
  const frames: ReplayFrame[] = [first]; // delta-encoded, exactly as the store captures
  const fullFrames: ReplayFrame[] = [first]; // full keyframes throughout — the expandFrames round-trip oracle
  let lastView: ShopView = first.view;
  const truth = new Map<number, WaveTruth>();
  const waveTruth = (w: number, tier: number): WaveTruth => {
    let t = truth.get(w);
    if (!t) { t = { actions: 0, tierAtStart: tier, goldSpent: 0 }; truth.set(w, t); }
    return t;
  };
  waveTruth(s.wave, s.tier);
  // The run-total `goldSpent` at the current wave's shop opening — the per-wave delta's baseline. The career
  // stat only ever grows inside the reducer's `spendGold` chokepoint, so its delta IS the gross spend.
  let waveStartGoldTotal = s.goldSpent ?? 0;
  let totalHealthLost = 0;
  let t = 0;
  let guard = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < maxSteps) {
    const action = DEFAULT_BOT.act(s);
    const next = reduce(s, action);
    if (next === s) break;
    t += 100; // synthetic clock — tMs monotonicity is what matters here, not real cadence
    // ── mirror the store's capture rules exactly ──
    const healthLost = s.phase === 'combat' ? Math.max(0, (s.resolve + s.armor) - (next.resolve + next.armor)) : 0;
    totalHealthLost += healthLost;
    if (healthLost > 0) {
      for (let i = frames.length - 1; i >= 0; i--) {
        const f = frames[i];
        if (f?.kind === 'combat') { frames[i] = { ...f, resolveLost: f.resolveLost + healthLost }; break; }
      }
    }
    if (action.type === 'faceOmen' && next.lastCombat) {
      const cf = combatFrameOf(s, next, t);
      frames.push(cf);
      fullFrames.push(cf);
      // The wave's shopping is over — `goldSpentThisTurn` now holds the round's gross spend. Read the
      // INDEPENDENT run-total delta instead: `goldSpent` (the career stat) only ever grows inside the
      // reducer's `spendGold` chokepoint, so its per-wave delta IS the gross spend, tallied without
      // touching the field the rollup reads.
      const w = waveTruth(s.wave, s.tier);
      w.goldSpent = (next.goldSpent ?? 0) - waveStartGoldTotal;
    } else if (next.phase === 'recruit' && s.phase !== 'recruit') {
      const kf = shopFrameOf(next, 'turnStart', t); // shop opening = a full KEYFRAME
      frames.push(kf);
      fullFrames.push(kf);
      lastView = kf.view;
      waveTruth(next.wave, next.tier);
      waveStartGoldTotal = next.goldSpent ?? 0;
    } else if (next.phase === 'recruit' && s.phase === 'recruit') {
      const d = deltaShopFrameOf(lastView, next, action.type, t); // per-action DELTA, as the store captures
      frames.push(d.frame);
      lastView = d.view;
      fullFrames.push(shopFrameOf(next, action.type, t));
      waveTruth(s.wave, s.tier).actions += 1;
    }
    s = next;
  }
  return { final: s, frames, fullFrames, truth, totalHealthLost };
}

describe('projectShopView — the inverted projection (Omit, not a whitelist)', () => {
  it('retains every non-excluded RunState key, drops exactly the denylist, and adds nextFoe', () => {
    // Mid-run state with real content on it: quests, runes, a board, a lobby.
    let s = createLobbyRun(11, 'drakko');
    for (let i = 0; i < 250 && s.phase !== 'gameover'; i++) {
      const next = reduce(s, DEFAULT_BOT.act(s));
      if (next === s) break;
      s = next;
    }
    expect(s.wave).toBeGreaterThan(3); // a real mid-run state, not the opening shop
    const view = projectShopView(s) as unknown as Record<string, unknown>;
    const excluded = new Set<string>(SHOP_VIEW_EXCLUDED_KEYS);
    const runKeys = Object.keys(s);
    // Inclusion-by-default: every RunState key not on the denylist survives the projection.
    for (const k of runKeys) {
      if (excluded.has(k)) expect(view, `excluded key '${k}' leaked into the view`).not.toHaveProperty(k);
      else expect(view, `RunState key '${k}' was dropped by the projection`).toHaveProperty(k);
    }
    // The one addition: the pinned next foe (null in lobby mode — the pairing lives in `lobby`).
    expect('nextFoe' in view).toBe(true);
    // And nothing else appears from nowhere.
    const allowed = new Set([...runKeys.filter((k) => !excluded.has(k)), 'nextFoe']);
    for (const k of Object.keys(view)) expect(allowed.has(k), `unexpected key '${k}' in the view`).toBe(true);
  });

  it('the denylist names only real RunState keys (a renamed field must fail here, not silently no-op)', () => {
    // The `satisfies readonly (keyof RunState)[]` in the module proves this at compile time for ALL keys;
    // here we spot-check the always-present engine fields so a rename also shows up at runtime.
    const s = createLobbyRun(3, 'drakko');
    expect(Object.keys(s)).toEqual(expect.arrayContaining(['pool', 'pendingTavern', 'rngCursor', 'runDamage', 'runProcs']));
  });
});

describe('no mutation leak — captured frames are deep-cloned (the v1-class bug)', () => {
  it('a shop frame and a combat frame stay byte-identical while the ORIGINAL run keeps reducing', () => {
    let s = createLobbyRun(7, 'drakko');
    // Play to the first combat so lastCombat exists (the shared-by-reference field the reducer mutates).
    let combatFrame: ReplayFrame | null = null;
    let shopFrame: ReplayFrame | null = null;
    for (let i = 0; i < 400 && (!combatFrame || !shopFrame); i++) {
      const action = DEFAULT_BOT.act(s);
      const next = reduce(s, action);
      if (next === s) break;
      if (!shopFrame && next.phase === 'recruit' && s.phase === 'recruit') shopFrame = shopFrameOf(next, action.type, 0);
      if (!combatFrame && action.type === 'faceOmen' && next.lastCombat) combatFrame = combatFrameOf(s, next, 0);
      s = next;
    }
    expect(shopFrame).not.toBeNull();
    expect(combatFrame).not.toBeNull();
    const shopBefore = JSON.stringify(shopFrame);
    const combatBefore = JSON.stringify(combatFrame);
    // Keep playing the SAME run — settleCombat mutates `lastCombat` in place, buys mutate the board, etc.
    for (let i = 0; i < 300 && s.phase !== 'gameover'; i++) {
      const next = reduce(s, DEFAULT_BOT.act(s));
      if (next === s) break;
      s = next;
    }
    expect(JSON.stringify(shopFrame)).toBe(shopBefore);
    expect(JSON.stringify(combatFrame)).toBe(combatBefore);
  });
});

describe('a full captured bot run — result golden, frame structure, rollups, size', () => {
  const { final, frames, fullFrames, truth, totalHealthLost } = captureBotRun(4, 'drakko');

  it('delta round-trip: expandFrames reconstructs the exact full-view timeline (JSON-identical)', () => {
    const expanded = expandFrames(frames);
    expect(expanded.length).toBe(fullFrames.length);
    for (let i = 0; i < expanded.length; i++) {
      const a = expanded[i]!;
      const b = fullFrames[i]!;
      expect(a.kind).toBe(b.kind);
      // Deep equality rather than a JSON byte-compare: `{...cur, ...changed}` can legitimately reorder keys
      // relative to a fresh projection, and key order is meaningless to the JSON data model.
      if (a.kind === 'shop' && b.kind === 'shop') {
        expect(a, `frame ${i} (${a.cause} @ wave ${a.wave}) diverged`).toEqual(b);
      }
    }
  });

  it('the run actually finished by elimination', () => {
    expect(final.phase).toBe('gameover');
    expect(final.lobby).toBeTruthy();
  });

  it('roundMarks: waves contiguous from 1, each wave has exactly one turnStart and one combat frame', () => {
    const marks = roundMarks(frames);
    expect(marks.length).toBeGreaterThan(1);
    marks.forEach((m, i) => expect(m.wave).toBe(i + 1));
    for (const m of marks) {
      const waveFrames = frames.filter((f) => f.wave === m.wave);
      expect(waveFrames.filter((f) => f.kind === 'shop' && f.cause === 'turnStart')).toHaveLength(1);
      expect(waveFrames.filter((f) => f.kind === 'combat')).toHaveLength(1);
      // The mark's seek target is the wave's shop opening.
      const turnStart = waveFrames.find((f) => f.kind === 'shop' && f.cause === 'turnStart')!;
      expect(m.tMs).toBe(turnStart.tMs);
      expect(['win', 'loss', 'draw']).toContain(m.result);
    }
    // tMs is monotonic over the whole timeline (the scrub bar's ordering contract).
    for (let i = 1; i < frames.length; i++) expect(frames[i]!.tMs).toBeGreaterThanOrEqual(frames[i - 1]!.tMs);
  });

  it('resolveLost: the marks sum to the health the fights actually cost', () => {
    const marks = roundMarks(frames);
    const lost = marks.reduce((sum, m) => sum + (m.resolveLost ?? 0), 0);
    // Ground truth observed live at each settle (armor + Resolve, the same delta the capture reads). A
    // baseline like `maxResolve + startingArmor − end` is NOT equivalent: mid-run armor/resolve grants and
    // the lobby's stall pressure move health outside the per-fight deltas.
    expect(lost).toBe(totalHealthLost);
    expect(lost).toBeGreaterThan(0); // the run ended by elimination, so it demonstrably lost health
  });

  it('the assembled result matches the live run: placement + record', () => {
    const seat = playerLobbySeat(final.lobby!);
    const placement = seat.placement ?? final.lobby!.seats.filter((x) => x.alive).length + 1;
    const replay: ReplayV2 = {
      version: 2,
      seed: final.seed, heroId: final.heroId, mode: final.mode ?? 'lobby',
      author: 'bot', patch: 'test',
      frames,
      result: { placement, record: runRecord(final), finalBoard: null },
    };
    expect(replay.result.placement).toBeGreaterThanOrEqual(1);
    expect(replay.result.placement).toBeLessThanOrEqual(8);
    expect(replay.result.record).toEqual(runRecord(final));
    // The frames' own verdicts agree with the recorded history (calibration rounds included).
    const marks = roundMarks(frames);
    final.history.forEach((r, i) => {
      const expected = r === 'lose' ? 'loss' : r;
      expect(marks[i]?.result, `wave ${i + 1} verdict`).toBe(expected);
    });
  });

  it('rollupRounds: actions / tierAtStart / goldSpent match the independently-observed truth', () => {
    const stats = rollupRounds(frames);
    expect(stats.length).toBe(truth.size);
    for (const stat of stats) {
      const t = truth.get(stat.wave)!;
      expect(t, `wave ${stat.wave} has no observed truth`).toBeTruthy();
      expect(stat.actions, `wave ${stat.wave} actions`).toBe(t.actions);
      expect(stat.tierAtStart, `wave ${stat.wave} tierAtStart`).toBe(t.tierAtStart);
      expect(stat.goldSpent, `wave ${stat.wave} goldSpent`).toBe(t.goldSpent);
    }
  });

  it('SIZE: the full ReplayV2 payload is measured and under the 4 MB ceiling', () => {
    const seat = playerLobbySeat(final.lobby!);
    const replay: ReplayV2 = {
      version: 2,
      seed: final.seed, heroId: final.heroId, mode: final.mode ?? 'lobby',
      author: 'bot', patch: 'test',
      frames,
      result: {
        placement: seat.placement ?? 8,
        record: runRecord(final),
        finalBoard: null,
      },
    };
    const json = JSON.stringify(replay);
    const bytes = new TextEncoder().encode(json).length;
    const size = (fs: readonly ReplayFrame[]): number => new TextEncoder().encode(JSON.stringify(fs)).length;
    const keyframes = frames.filter((f) => f.kind === 'shop');
    const deltas = frames.filter((f) => f.kind === 'shopDelta');
    const combat = frames.filter((f) => f.kind === 'combat');
    const keyframeBytes = size(keyframes);
    const deltaBytes = size(deltas);
    const combatBytes = size(combat);
    const perDelta = Math.round(deltaBytes / Math.max(1, deltas.length));
    // A human run takes ~250 actions (~250 delta frames) where the bot takes far fewer — project that load
    // so the ceiling judgement is made against real play, not bot cadence.
    const projected250 = combatBytes + keyframeBytes + perDelta * 250;
    console.log(
      `[replayV2 size] ${(bytes / 1024).toFixed(1)} KB (${bytes} bytes) — ${frames.length} frames over ${final.wave} waves: ` +
      `${keyframes.length} keyframes = ${(keyframeBytes / 1024).toFixed(1)} KB, ` +
      `${deltas.length} deltas @ ~${(perDelta / 1024).toFixed(2)} KB each = ${(deltaBytes / 1024).toFixed(1)} KB, ` +
      `${combat.length} combat = ${(combatBytes / 1024).toFixed(1)} KB; ` +
      `projected ~250-action human run ≈ ${(projected250 / 1024 / 1024).toFixed(2)} MB ` +
      `(un-delta'd this run would be ${(size(fullFrames) / 1024).toFixed(1)} KB of frames)`,
    );
    expect(bytes).toBeLessThan(4 * 1024 * 1024);
    expect(projected250).toBeLessThan(4 * 1024 * 1024);
  });
});

describe('the inspect trail — appendInspectEvent coalescing (owner ask 2026-08-19: 1:1 includes hovers)', () => {
  const open = (tMs: number, cardId = 'imp'): InspectEvent => ({ tMs, inspect: { cardId } });
  const close = (tMs: number): InspectEvent => ({ tMs, inspect: null });

  it('records a plain open → close round-trip', () => {
    const trail: InspectEvent[] = [];
    appendInspectEvent(trail, open(1000));
    appendInspectEvent(trail, close(2000));
    expect(trail).toEqual([open(1000), close(2000)]);
  });

  it('drops an open+close blip shorter than the noise window (both events vanish)', () => {
    const trail: InspectEvent[] = [];
    appendInspectEvent(trail, open(1000));
    appendInspectEvent(trail, close(1000 + INSPECT_NOISE_MS - 1));
    expect(trail).toEqual([]);
    // …but exactly AT the window the pair is a real read and both stay.
    appendInspectEvent(trail, open(3000));
    appendInspectEvent(trail, close(3000 + INSPECT_NOISE_MS));
    expect(trail).toHaveLength(2);
  });

  it('a quick close after switching cards is still recorded (noise-cancel only restores a CLOSED state)', () => {
    // Inspect A, switch to B, close within the noise window: dropping B's open+close would leave the trail
    // claiming A is still open — the close must land instead.
    const trail: InspectEvent[] = [];
    appendInspectEvent(trail, open(1000, 'a'));
    appendInspectEvent(trail, open(2000, 'b'));
    appendInspectEvent(trail, close(2050));
    expect(trail.map((e) => e.inspect?.cardId ?? null)).toEqual(['a', 'b', null]);
  });

  it('throttles re-opens of the SAME card — the newer open replaces the recorded one', () => {
    const trail: InspectEvent[] = [];
    appendInspectEvent(trail, open(1000));
    appendInspectEvent(trail, open(1000 + INSPECT_OPEN_THROTTLE_MS - 1));
    expect(trail).toEqual([open(1000 + INSPECT_OPEN_THROTTLE_MS - 1)]);
    // A DIFFERENT card inside the window is a real switch, not a re-open — both stay.
    appendInspectEvent(trail, open(1050, 'other'));
    expect(trail).toHaveLength(2);
  });

  it('dedupes closes: never a leading close, never two closes in a row', () => {
    const trail: InspectEvent[] = [];
    appendInspectEvent(trail, close(500));
    expect(trail).toEqual([]);
    appendInspectEvent(trail, open(1000));
    appendInspectEvent(trail, close(2000));
    appendInspectEvent(trail, close(2100)); // e.g. clearInspect after the action already closed it
    expect(trail).toEqual([open(1000), close(2000)]);
  });

  it('caps the trail: opens are dropped at the cap, but a close still lands so it never ends stuck-open', () => {
    const trail: InspectEvent[] = [];
    for (let i = 0; i < 3; i++) {
      appendInspectEvent(trail, open(i * 1000), 4);
      appendInspectEvent(trail, close(i * 1000 + 500), 4);
    }
    expect(trail).toHaveLength(4); // the third open was dropped at the cap; its close deduped away
    expect(trail[3]!.inspect).toBeNull();
    // At the cap with a live open, the close exceeds the cap by one rather than stranding the panel open.
    const trail2: InspectEvent[] = [open(0), close(500), open(1000), open(2000)];
    appendInspectEvent(trail2, close(3000), 4);
    expect(trail2).toHaveLength(5);
    expect(trail2[4]!.inspect).toBeNull();
  });
});
