import { useEffect, useRef } from 'react';
import type { StatKind } from '../choreo/statMilestones';
import { playDef } from './playDef';

/**
 * PERSISTENT badge FX for a stat at the FINAL milestone tier (owner ask 2026-09-19).
 *
 * When a unit's Attack or Health reaches the top tier (≥5000 — `tierOf` === 6), a looping, badge-tracking
 * Pixi effect rides that badge for as long as the unit lives — in the shop, the warband, and combat alike
 * (combat units render through `Card` too, so this one hook covers every surface). Attack badge → the attack
 * def, Health badge → the health def.
 *
 * Two owner rulings shape it:
 *   • FINAL tier only — tier 6, the ≥5000 band (the "blue" milestone).
 *   • LATCHES ON once reached — it stays on for the rest of that unit's life even if the stat later drops
 *     below 5000 (combat damage, a debuff). So we can't derive "show it" from the live tier alone; a
 *     module-level latch keyed by uid remembers a unit that ever hit the tier, and survives the card
 *     unmounting and remounting across the shop↔combat boundary (same uid).
 *
 * Built on `playDef`'s `loop` + `follow` (the same persistent, card-following mechanism as Croupier Ayse's
 * enchant, see `useCiaEnchantedFx`): the loop never retires itself, so the hook OWNS teardown — it stops the
 * play when the unit unmounts. `follow` re-reads the badge's live rect each frame so the effect tracks the
 * badge through a combat lunge, a shop drag, or a warband reorder; a `null` read (badge briefly out of the
 * DOM) hides it for that frame without ending the loop.
 */

/** The top tier — `tierOf` returns 6 at ≥5000 (see `choreo/statMilestones.ts`). */
const FINAL_TIER = 6;

/**
 * Once a unit's Attack/Health hits the final tier it STAYS latched for that uid's life. Module-level so it
 * outlives any one card mount — a unit that hit ≥5000 in combat still wears the effect back in the next shop.
 * Bounded by the count of distinct units that ever reach ≥5000, which is rare; not cleared per run today.
 */
const reached = new Map<string, { attack: boolean; health: boolean }>();

export function markMilestoneReached(uid: string, stat: StatKind): void {
  const r = reached.get(uid);
  if (r) { r[stat] = true; return; }
  reached.set(uid, { attack: stat === 'attack', health: stat === 'health' });
}

export function hasMilestoneReached(uid: string, stat: StatKind): boolean {
  return reached.get(uid)?.[stat] ?? false;
}

/** Drop every latch — for tests, and available if a run-reset ever wants to clear it. */
export function resetMilestoneLatches(): void {
  reached.clear();
}

/** The live centre of a badge element, or null when it has no layout box (out of the DOM this frame). */
function centreOf(el: HTMLElement | null): { x: number; y: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Start the persistent, following loop for one stat. Literal `playDef` id per stat so `directCalls.ts`'s scan
 * attributes each def to this file (a variable id would read as a "dynamic" call and under-report the def in
 * the FX library). Returns the caller-owned teardown, or null if it could not start this frame.
 */
function startBadgeLoop(
  stat: StatKind,
  uid: string,
  at: () => { x: number; y: number } | null,
): (() => void) | null {
  const start = at();
  if (!start) return null;
  const anchors = { source: start, target: start, cursor: start };
  // `uids` hands the def the unit it is about (it anchors to that unit's `badge.attack` / `badge.health` part
  // at fire time); `follow` then re-reads the badge's live point every frame so the effect tracks it. Kept
  // inline (not hoisted to a const) so the literal `uids` is visible to `playDefUids.test.ts`'s call scan.
  return stat === 'attack'
    ? playDef('test-ascent-frame-attack', anchors, { uids: { source: uid }, loop: true, follow: at })
    : playDef('test-ascent-frame-health', anchors, { uids: { source: uid }, loop: true, follow: at });
}

/**
 * Run the persistent milestone effect for one badge. `getBadge` returns the badge's DOM element (a getter,
 * not a ref, so the hook is agnostic to the ref type the caller holds); it is read once for the start point
 * and then every frame by `follow`.
 *
 * No dependency array on the start effect: it re-checks each render (cheap — a Map read and a ref check),
 * which self-heals the two "can't start yet" cases without extra machinery — the def primitives not being
 * registered yet, or the badge not having a layout box on the first tick.
 */
export function useMilestoneBadgeFx(
  uid: string | undefined,
  stat: StatKind,
  tier: number,
  getBadge: () => HTMLElement | null,
): void {
  const disposeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (uid && tier >= FINAL_TIER) markMilestoneReached(uid, stat);
    const active = !!uid && (tier >= FINAL_TIER || hasMilestoneReached(uid, stat));
    if (active && uid && !disposeRef.current) {
      disposeRef.current = startBadgeLoop(stat, uid, () => centreOf(getBadge()));
    } else if (!active && disposeRef.current) {
      disposeRef.current();
      disposeRef.current = null;
    }
  });
  // A looping play never retires on its own — stop it when the card unmounts.
  useEffect(() => () => { disposeRef.current?.(); disposeRef.current = null; }, []);
}
