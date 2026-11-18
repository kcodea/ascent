import { onShopAction, shopActionEpoch } from './actionPressure';
import { deliverAllStats } from './statHold';

/**
 * THE SHOP'S DEFERRED PRESENTATION, BOUNDED UNDER RAPID INPUT (R-PERF-APM-01).
 *
 * A Shop action's buff waves are paced: a Dragonflame's repeats land 150 ms apart, a Shout chain one link at a time,
 * a second buffer waits for the first. Each of those is a timer that will start an effect later. Played one action at
 * a time that pacing is the point. At four to eight actions a second the timers of six or more actions are pending
 * at once, and each fires its effect over a board the player has already changed twice since (measured,
 * `npm run perf:apm`: 30 pending timers on average, 55 at peak, 17 effects alive, 1.9 s to drain after the last
 * input).
 *
 * So the Shop's paced steps are scheduled through `shopFxLater` instead of a bare `setTimeout`, each stamped with the
 * action it belongs to. While the player's input is RAPID (`fx/actionPressure.ts`: three accepted actions inside a
 * second), a new action drops every paced step of the EARLIER actions that has not started yet, and delivers every
 * number those actions were still rolling in. Effects already playing finish untouched. Nothing queues: at any speed
 * the screen is presenting the newest action, on a board whose numbers are true.
 *
 * At up to two actions a second nothing here changes anything: `shopFxLater` is `setTimeout`.
 *
 * Presentation only. A dropped step is an effect that does not start; the stats it would have decorated were
 * committed by the reducer before any of this ran.
 */

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  epoch: number;
}

const pending = new Map<number, Pending>();
let nextId = 1;
let dropped = 0;

/**
 * `setTimeout` for a paced step of the CURRENT Shop action's presentation (a later buff wave, a chain link, a
 * waiting buffer). Returns an id for `cancelShopFx`. Under rapid input a later action drops it if it has not run.
 */
export function shopFxLater(fn: () => void, ms: number): number {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); fn(); }, ms);
  pending.set(id, { timer, epoch: shopActionEpoch() });
  return id;
}

/** Cancel one paced step (an effect's own cleanup). Safe when it already ran or was dropped. */
export function cancelShopFx(id: number): void {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
}

/** Drop every paced step that belongs to an action before `epoch`. Returns how many it dropped. */
export function dropShopFxBefore(epoch: number): number {
  let n = 0;
  for (const [id, p] of pending) {
    if (p.epoch >= epoch) continue;
    clearTimeout(p.timer);
    pending.delete(id);
    n++;
  }
  dropped += n;
  return n;
}

/** Paced steps still waiting (the regression guard and the perf bench read this). */
export function shopFxPending(): number {
  return pending.size;
}

/** Paced steps dropped under rapid input since the page loaded. */
export function shopFxDropped(): number {
  return dropped;
}

/** Forget every paced step without running it (a test; a scene that is gone). */
export function clearShopFx(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
}

// THE ONE RULE: a new action under rapid input finishes the earlier actions' presentation on the spot.
onShopAction((rapid) => {
  if (!rapid) return;
  dropShopFxBefore(shopActionEpoch());
  deliverAllStats();
});
