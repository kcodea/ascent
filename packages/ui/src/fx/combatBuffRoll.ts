import type { CombatEvent } from '@game/core';

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
 * This is `preBuffHolds`'s summing loop, factored out so it's headlessly testable and so the module-store
 * install (`useCombatReplay`'s layout effect) can place a DELTA directly — `fx/statHold` holds deltas, not
 * absolutes, so this is the shape the store wants. `preBuffHolds` still wants the pre-buff ABSOLUTE (for the
 * old per-beat Map), so it derives that from this instead of re-summing; see its own comment.
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
