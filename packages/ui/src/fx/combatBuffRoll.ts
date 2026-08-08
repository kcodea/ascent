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
 * The mirror of `combatBuffDeltas` for a hit: how much HP each SURVIVING target lost this beat, so the badge
 * can count DOWN the same way a buff counts it up (owner ask 2026-08-07). Sums every `dmg` amount per target.
 *
 * Two targets are deliberately excluded so the roll never fights a snap that must stay a snap:
 *  - one that DIES this beat (a `death` event) — the death collapse and the death float own that moment, and
 *    a badge counting toward 0 underneath a dissolving card reads as two clocks on one number;
 *  - one gone from the live `frame` or already at 0 there — there is nothing survivable left to roll.
 *
 * The caller applies the OTHER guard (a target with a buff/roll already in flight snaps instead), because
 * that one needs the live hold store, which this pure function deliberately does not touch.
 */
export function combatDamageDeltas(
  beat: { start: number; end: number },
  events: CombatEvent[],
  frame: { player: FrameUnit[]; enemy: FrameUnit[] },
): { uid: string; health: number }[] {
  const totals = new Map<string, number>();
  const dying = new Set<string>();
  for (let i = beat.start; i < beat.end; i++) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'dmg') totals.set(e.target, (totals.get(e.target) ?? 0) + e.amount);
    else if (e.type === 'death') dying.add(e.target);
  }
  const out: { uid: string; health: number }[] = [];
  for (const [uid, health] of totals) {
    if (health <= 0) continue;      // a heal or a no-op — nothing to roll down
    if (dying.has(uid)) continue;   // killed this beat → the death path snaps it
    const u = frame.player.find((x) => x.uid === uid) ?? frame.enemy.find((x) => x.uid === uid);
    if (!u || u.health <= 0) continue; // off the board this frame, or dead on it → not a survivable hit
    out.push({ uid, health });
  }
  return out;
}

/**
 * One frame's worth of reveal progress: `prevProgress` plus this frame's `dtMs` scaled by the CURRENT
 * `speed` and divided by `rollMs`, clamped to `[0,1]`. Pulled out of `driveRoll` so the accumulation
 * arithmetic is headlessly testable — `driveRoll` itself only adds a live `requestAnimationFrame` loop
 * around this, which needs a browser frame clock to prove anything beyond what this function already
 * covers (see Task 4, the per-frame browser gate).
 *
 * INCREMENTAL by design, not `elapsed / duration` against a duration fixed at call time: a combat-speed
 * change mid-roll has to re-scale only the time REMAINING, and the only way to do that without snapshotting
 * "how much was already shown" separately is to add each frame's own progress as it happens. `driveRoll`
 * re-reads speed every frame via its getter; this function is what that live read actually buys.
 *
 * `rollMs <= 0` reveals instantly rather than dividing by zero — a zero-length roll is a valid "just show
 * it" request (mirrors `stepHolds`'s own `rollMs <= 0 ? 1` case in `fx/statHold.ts`). A non-positive `dtMs`
 * (the first frame after a pause, or a clock hiccup) contributes nothing rather than going backwards —
 * still clamped, so a caller can't hand back a `prevProgress` outside `[0,1]` either.
 */
export function advanceRollProgress(prevProgress: number, dtMs: number, rollMs: number, speed: number): number {
  if (rollMs <= 0) return 1;
  const clampedPrev = Math.max(0, Math.min(1, prevProgress));
  if (dtMs <= 0) return clampedPrev;
  const s = speed > 0 ? speed : 1;
  return Math.max(0, Math.min(1, clampedPrev + (dtMs * s) / rollMs));
}

/**
 * The strike-time release for a combat buff (Task 3 of the combat/shop stat-hold unification): instead of
 * snapping a Map delete, walk the store's held delta from 0 to 1 over `rollMs / speed`, so the badge counts
 * up on the strike the same way a shop gem or Ruby counts up on its cue — and the badge pop fires off the
 * value actually moving (`useBadgePop`), with nothing combat-specific to author.
 *
 * `speedGetter` is read EVERY frame, not captured once at call time (Task 6) — a mid-roll combat-speed
 * change (the in-combat slider) has to re-scale the roll that's already in flight, and a value captured at
 * the top of this function would freeze the roll at whatever speed was live the instant the strike landed.
 * Dividing by it keeps the roll in lockstep with a sped-up or slowed-down replay, matching every other
 * combat timer in `useCombatReplay`. Guarded here (not by the caller) so a caller can pass the raw speed ref
 * straight through.
 *
 * Returns a cancel function, but fire-and-forget is safe even without calling it: `revealStat` against a
 * uid with no live hold — already delivered, expired, or superseded by a fresh `holdStat` — is a no-op (see
 * `fx/statHold.ts`), so an abandoned roll can advance a counter that no longer exists and nothing prints.
 * That's the FAIL OPEN this system leans on: a lost release resolves to the true number on its own via the
 * store's TTL, never a stale or invented one. (`useCombatReplay`'s combat-lifetime roll registry calls the
 * returned cancel AND releases the hold outright on teardown/re-seek, so that fail-open path is a backstop,
 * not the only guarantee — see the registry's own comment.)
 *
 * `onComplete`, if given, fires once — the moment `progress` naturally reaches 1, before the last frame's
 * `revealStat`. Optional and additive (fix round 1, Finding 4): `useCombatReplay`'s registry uses it to prune
 * its own entry for a roll that finished on its own, so completed rolls don't sit in that map for the rest of
 * the fight. Nothing else needs it — callers that don't pass it see identical behavior to before.
 */
export function driveRoll(uid: string, rollMs: number, speedGetter: () => number, onComplete?: () => void): () => void {
  let progress = 0;
  let last = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let raf = 0;
  const tick = (): void => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    progress = advanceRollProgress(progress, now - last, rollMs, speedGetter());
    last = now;
    revealStat(uid, progress);
    if (progress < 1) raf = requestAnimationFrame(tick);
    else onComplete?.();
  };
  raf = requestAnimationFrame(tick);
  return () => { if (raf !== 0) cancelAnimationFrame(raf); };
}
