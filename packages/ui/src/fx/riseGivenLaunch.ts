import type { CombatEvent } from '@game/core';
import type { Moment } from '../choreo/compile';
import { bindingFor } from '../choreo/bindings';
import { risesGivenIn, type RiseGiven } from '../choreo/channels/riseGiven';
import { anchorsForUnits, combatAnchorsFromRects, unitSelector } from './combatAnchors';
import { trackSettledSlot } from './settledSlot';
import { defArrivalMs } from './defArrival';
import { getDef } from './fxDefs';
import { canPlayDefs, playDef } from './playDef';
import { holdRise, RISE_HOLD_MAX_MS } from './riseHold';

/**
 * "ON RISE GIVEN" (R-FX-RISE-GIVEN-01, owner 2026-11-12: "wired in all the exact same ways as the ward beam and execute
 * beam"): a minion that gives another minion Rise (Mumi, Wolvie, Anubis, Gravewarden) launches its bound effect from
 * itself to each minion it gave it to, and that minion's Rise dome appears when the effect lands.
 *
 *  - An ECHO's giver has just died: its effect leaves from its SLOT a breath after its skull, called from the replay's
 *    death handling (the Ward path's two call sites), never from a body still mid-lunge.
 *  - A LIVING giver (Gravewarden's Start of Combat, an Echo forced by Spots or Echohorn) launches as the beat starts.
 *  - MORE THAN ONE RISE AT ONCE IS A CASCADE (owner 2026-11-12: "any instance of more than one rise being applied at
 *    the same time should be staggered"): each next effect leaves `RISE_GIVEN_GAP_MS` after the one before, and each
 *    dome appears as its own effect lands.
 *  - The effect follows its receiver to the slot it settles in (`trackSettledSlot`), since the death that fired the
 *    Echo collapses the row while it flies.
 */

/** The sound as an effect leaves its giver (a wisp). */
export const RISE_LAUNCH_SFX = 'sfx-rise-wisp';
/** The sounds as it lands and the Rise appears (a wraith's breath + a low bell + a deep thrum). */
export const RISE_LAND_SFX = 'sfx-rise-applied';

/** Delay (ms at 1x) from the Echo skull to the first launch, matching the Ward path. */
export const RISE_GIVEN_LAUNCH_DELAY_MS = 400;
/** The gap (ms at 1x) between one Rise leaving and the next, when several are given at once. */
export const RISE_GIVEN_GAP_MS = 180;
/** A cascade rings its sounds on its first few effects only; a board-wide grant (Anubis) is not six stacked copies. */
export const RISE_GIVEN_SOUND_MAX = 3;
/** If the replay's death handling never launches an Echo's grants (ms at 1x from the beat start), launch them anyway. */
export const RISE_GIVEN_FALLBACK_MS = 1400;

type Rect = { left: number; top: number; width: number; height: number };
type Slot = { cx: number; cy: number; w: number; h: number };
const slotRect = (s: Slot): Rect => ({ left: s.cx - s.w / 2, top: s.cy - s.h / 2, width: s.w, height: s.h });

/** Is this grant one its giver travels to (its card has an "On Rise given" effect bound)? */
export function isTravelledRise(g: RiseGiven): boolean {
  return !!bindingFor(g.cardId, 'riseGiven');
}

/** When the k-th effect of a cascade LEAVES (ms at 1x): `firstMs` for the first, one gap later for each next. */
export function riseLaunchAtMs(k: number, firstMs = 0): number {
  return Math.max(0, firstMs) + Math.max(0, k) * RISE_GIVEN_GAP_MS;
}

/** Where a giver that has since left the board stood (screen px), for a grant that plays in a LATER beat (Anubis). */
const lastSlot = new Map<string, Rect>();
const rememberSlot = (uid: string, r: Rect): void => {
  if (lastSlot.size > 64) lastSlot.clear(); // long past; never grows with a run
  lastSlot.set(uid, r);
};

/**
 * ONE grant, in either phase: hide the receiver's Rise dome, launch the giver's bound effect after `launchAt` ms (at
 * 1x) from `from` (else the giver's live rect, else where it last stood), and show the dome with the landing sounds
 * when it arrives. `register` receives every timer id.
 */
export function launchRiseGiven(
  g: RiseGiven,
  opts: { speed: number; launchAt: number; sound: boolean; from: Rect | null; register: (id: number) => void },
): void {
  const b = bindingFor(g.cardId, 'riseGiven');
  if (!b || !canPlayDefs()) return;
  const s = opts.speed > 0 ? opts.speed : 1;
  const arrive = defArrivalMs(getDef(b.def));
  holdRise(g.target, (opts.launchAt + arrive) / s + 50); // safety net; `land` releases it on time
  const land = (): void => {
    holdRise(g.target, 0);
    if (!opts.sound) return;
    const at = anchorsForUnits(g.target, g.target);
    if (at) playDef('sfx-rise-applied', at, { uids: { source: g.target, target: g.target } });
  };
  const launch = (): void => {
    // A giver still collapsing out of its row is measured where its skull fired, not at its shrinking box.
    const sEl = document.querySelector(unitSelector(g.source));
    const live = sEl?.getBoundingClientRect() ?? null;
    const gone = !sEl || (sEl.classList.contains('dying') && !sEl.classList.contains('rising'));
    const source: Rect | null = opts.from ?? (gone ? lastSlot.get(g.source) ?? live : live);
    const tEl = document.querySelector(unitSelector(g.target));
    const anchors = source && tEl
      ? combatAnchorsFromRects({ source, target: tEl.getBoundingClientRect(), row: null, viewport: { w: window.innerWidth, h: window.innerHeight } })
      : null;
    if (!anchors) { land(); return; } // a unit already left the screen: just show the dome
    // LAND WHERE THE MINION ENDS UP: aim at the receiver's settled slot and keep following it until the effect retires.
    const settle = trackSettledSlot(() => document.querySelector(unitSelector(g.target)));
    // index 0: this file spaces the cascade itself, so the def's own per-index stagger must not add to it.
    const stop = playDef(b.def, settle ? { ...anchors, target: settle.start } : anchors,
      { uids: { source: g.source, target: g.target }, index: 0, gain: b.gain, target: settle?.get, onDone: settle?.stop });
    if (!stop) settle?.stop(); // nothing played: no retire will ever call onDone
    if (opts.sound) playDef('sfx-rise-wisp', anchors, { uids: { source: g.source, target: g.target } });
    if (arrive <= 0) land(); else opts.register(window.setTimeout(land, arrive / s));
  };
  if (opts.launchAt <= 0) launch(); else opts.register(window.setTimeout(launch, opts.launchAt / s));
}

/** One cascade: every grant in order, a gap apart, the first after `firstMs`. */
function launchCascade(grants: RiseGiven[], firstMs: number, from: Rect | null, speed: number, register: (id: number) => void): void {
  grants.forEach((g, k) => {
    launchRiseGiven(g, { speed, launchAt: riseLaunchAtMs(k, firstMs), sound: k < RISE_GIVEN_SOUND_MAX, from, register });
  });
}

/** Echo grants hidden at beat start and still waiting for their giver's skull: giver uid -> its grants. */
const awaitingSkull = new Map<string, RiseGiven[]>();

/**
 * Beat start in COMBAT: hide every given Rise dome; launch the LIVING givers' effects now as one cascade (an
 * attacker's own grant waits for its Rally pulse, the wind-up's length); leave an Echo's for `launchRisesGiven`.
 */
export function startRisesGiven(
  moment: Moment,
  events: CombatEvent[],
  cardIds: ReadonlyMap<string, string>,
  speed: number,
  register: (id: number) => void,
  attackerUid: string | null,
  windupMs: number,
): void {
  if (!canPlayDefs()) return;
  const s = speed > 0 ? speed : 1;
  const given = risesGivenIn(moment, events, cardIds).filter(isTravelledRise);
  const living = given.filter((g) => !g.died);
  living.forEach((g, k) => {
    const first = attackerUid !== null && g.source === attackerUid ? Math.max(0, windupMs) : 0;
    launchRiseGiven(g, { speed, launchAt: riseLaunchAtMs(k, first), sound: k < RISE_GIVEN_SOUND_MAX, from: null, register });
  });
  const byGiver = new Map<string, RiseGiven[]>();
  for (const g of given) if (g.died) byGiver.set(g.source, [...(byGiver.get(g.source) ?? []), g]);
  for (const [giver, grants] of byGiver) {
    for (const g of grants) holdRise(g.target, RISE_HOLD_MAX_MS);
    awaitingSkull.set(giver, grants);
    // BACKSTOP: a death the replay's skull handling skipped must still deliver its Rise, not sit hidden.
    register(window.setTimeout(() => {
      if (awaitingSkull.get(giver) !== grants) return;
      awaitingSkull.delete(giver);
      launchCascade(grants, 0, null, speed, register);
    }, RISE_GIVEN_FALLBACK_MS / s));
  }
}

/**
 * The giver's skull just fired at `slot` (layout-frame centre + footprint): launch its Echo's grants from there as
 * one cascade, the first a breath after the skull.
 */
export function launchRisesGiven(
  dyingUid: string,
  slot: Slot,
  moment: Moment,
  events: CombatEvent[],
  cardIds: ReadonlyMap<string, string>,
  speed: number,
  register: (id: number) => void,
): void {
  if (!canPlayDefs()) return;
  const from = slotRect(slot);
  rememberSlot(dyingUid, from); // a board-wide grant's later beats (Anubis) launch from here too
  awaitingSkull.delete(dyingUid);
  const given = risesGivenIn(moment, events, cardIds).filter((g) => g.source === dyingUid && g.died && isTravelledRise(g));
  if (given.length) launchCascade(given, RISE_GIVEN_LAUNCH_DELAY_MS, from, speed, register);
}

/**
 * THE SHOP: a Rise given by a minion's own beat (an Echo fired in the Shop, a forced Rally or Start of Combat replay
 * at End of Turn) arrives as a `keywordChanged` on the giver's beat. The beat has already pulsed the giver, so the
 * effect leaves at once; a beat's further grants follow a gap apart. A giver that is not on screen YET (Runic Beetle
 * gives its Rise in the same action that puts it on the board) gets a short wait to mount; one that never appears
 * just shows the Rise with its landing sound. False (the generic flash plays) only when the card has no effect bound.
 */
export const RISE_SHOP_MOUNT_WAIT_MS = 120;
const shopCounts = new Map<string, number>();
export function launchShopRiseGiven(g: Omit<RiseGiven, 'died'>, beatId: string): boolean {
  const grant: RiseGiven = { ...g, died: false };
  if (!isTravelledRise(grant) || g.source === g.target || !canPlayDefs()) return false;
  const wait = anchorsForUnits(g.source, g.target) ? 0 : RISE_SHOP_MOUNT_WAIT_MS;
  const key = `${beatId}|${g.source}`;
  if (shopCounts.size > 64) shopCounts.clear(); // beats are long past; never grows with a run
  const k = shopCounts.get(key) ?? 0;
  shopCounts.set(key, k + 1);
  launchRiseGiven(grant, { speed: 1, launchAt: riseLaunchAtMs(k, wait), sound: k < RISE_GIVEN_SOUND_MAX, from: null, register: () => {} });
  return true;
}
