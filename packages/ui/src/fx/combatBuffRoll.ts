import type { CombatEvent } from '@game/core';
import { revealStat } from './statHold';

/**
 * The per-unit shape this needs off the live frame — kept local rather than importing `UnitFrame` from
 * `useCombatReplay`, which is the file that imports THIS module (that import would be circular; a plain
 * structural type isn't).
 */
interface FrameUnit {
  uid: string;
  attack: number;
  health: number;
}

/**
 * One beat's net buff, per target, as a DELTA — how much of the unit's CURRENT stats this beat granted.
 *
 * Sums the WHOLE beat per target (a target can take an incoming tendril and a self-buff in the same beat;
 * counting only one would under-report what the badge is holding back) and drops a target that isn't on the
 * board this frame — buffed and killed in the same beat has nothing to hold, and holding it would invent a
 * value nobody will ever read.
 *
 * Factored out so it's headlessly testable and so the module-store install (`useCombatReplay`'s layout
 * effect) can place a DELTA directly — `fx/statHold` holds deltas, not absolutes, so this is the shape the
 * store wants. (Combat used to also derive the pre-buff ABSOLUTE off this, for a parallel `useState` Map;
 * that system — and the bridge function that derived it — was deleted once the strike-time release started
 * driving the store's own reveal instead. See Task 3 of the combat/shop stat-hold unification.)
 */
export function combatBuffDeltas(
  beat: { start: number; end: number },
  events: CombatEvent[],
  frame: { player: FrameUnit[]; enemy: FrameUnit[] },
): { uid: string; attack: number; health: number }[] {
  const totals = new Map<string, { attack: number; health: number }>();
  for (let i = beat.start; i < beat.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'buff') continue;
    const t = totals.get(e.target) ?? { attack: 0, health: 0 };
    totals.set(e.target, { attack: t.attack + e.attack, health: t.health + e.health });
  }
  const out: { uid: string; attack: number; health: number }[] = [];
  for (const [uid, t] of totals) {
    if (t.attack === 0 && t.health === 0) continue; // nothing to tick, so nothing to hold
    const onFrame = frame.player.some((u) => u.uid === uid) || frame.enemy.some((u) => u.uid === uid);
    if (!onFrame) continue; // not on the board this frame → nothing to hold
    out.push({ uid, attack: t.attack, health: t.health });
  }
  return out;
}

/**
 * Elapsed time → reveal progress, clamped to `[0,1]`. Pulled out of `driveRoll` so the clamp/divide
 * arithmetic is headlessly testable — `driveRoll` itself only adds a live `requestAnimationFrame` loop
 * around this, which needs a browser frame clock to prove anything beyond what this function already
 * covers (see Task 4, the per-frame browser gate).
 *
 * `durationMs <= 0` reveals instantly rather than dividing by zero — a zero-length roll is a valid "just
 * show it" request (mirrors `stepHolds`'s own `rollMs <= 0 ? 1` case in `fx/statHold.ts`).
 */
export function rollElapsedToProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.max(0, Math.min(1, elapsedMs / durationMs));
}

/**
 * The strike-time release for a combat buff (Task 3 of the combat/shop stat-hold unification): instead of
 * snapping a Map delete, walk the store's held delta from 0 to 1 over `rollMs / speed`, so the badge counts
 * up on the strike the same way a shop gem or Ruby counts up on its cue — and the badge pop fires off the
 * value actually moving (`useBadgePop`), with nothing combat-specific to author.
 *
 * `speed` is the live combat-speed multiplier; dividing by it keeps the roll in lockstep with a sped-up or
 * slowed-down replay, matching every other combat timer in `useCombatReplay`. Guarded here (not by the
 * caller) so a caller can pass the raw speed ref straight through.
 *
 * Returns a cancel function, but fire-and-forget is safe even without calling it: `revealStat` against a
 * uid with no live hold — already delivered, expired, or superseded by a fresh `holdStat` — is a no-op (see
 * `fx/statHold.ts`), so an abandoned roll can advance a counter that no longer exists and nothing prints.
 * That's the FAIL OPEN this system leans on: a lost release resolves to the true number on its own via the
 * store's TTL, never a stale or invented one.
 */
export function driveRoll(uid: string, rollMs: number, speed: number): () => void {
  const durationMs = rollMs / (speed > 0 ? speed : 1);
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let raf = 0;
  const tick = (): void => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const p = rollElapsedToProgress(now - start, durationMs);
    revealStat(uid, p);
    if (p < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { if (raf !== 0) cancelAnimationFrame(raf); };
}
