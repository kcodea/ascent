import type { CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { Moment } from '../choreo/compile';
import { bindingFor } from '../choreo/bindings';
import { wardsGivenIn, type WardGiven } from '../choreo/channels/wardGiven';
import { anchorsForUnits, combatAnchorsFromRects, unitSelector } from './combatAnchors';
import { defArrivalMs } from './defArrival';
import { getDef } from './fxDefs';
import { canPlayDefs, playDef } from './playDef';
import { holdWard, WARD_HOLD_MAX_MS } from './wardHold';
import { toScreen } from '../stage';
import { sfx } from '../sfx';

/**
 * "ON WARD GIVEN" in combat (R-FX-WARD-GIVEN-01): an Echo that gives Ward (Lastlight) launches its bound effect from
 * the GIVER'S SLOT, and each Ward dome appears when that effect lands, together with the Ward-gained effect
 * (Oathshield Orin's `ward-gain-blast`, the `shieldGain` binding) and the Ward sound (R-FX-WARD-GAIN-EVERY-01).
 *
 *  - A DEATH-fired Echo launches from the replay's death handling (both the in-place death and the dying attacker
 *    pulled home) a breath after its skull, never from the beat start: at beat start a dying attacker is still
 *    mid-lunge, which is where the first version fired from (owner report 2026-11-04).
 *  - A FORCED Echo (Spots' Start of Combat, an Echohorn Rally) launches from the LIVING giver as its Wards' beat
 *    starts (`startTravelledWards`).
 *  - Every FIRE is its own volley: a Sylus-multiplied Echo reads beam > Wards, then beam > Wards (owner 2026-11-04),
 *    never every Ward at once. A forced fire is already its own beat (one rally each); a death-fired Echo's procs share
 *    the death's beat, so they are split by the giver's per-fire Ward count.
 */

/** Delay (ms at 1x) from the Echo skull to the launch, matching Fel Spikes' Echo volley. */
export const WARD_GIVEN_LAUNCH_DELAY_MS = 400;
/** Pause (ms at 1x) after one fire's Wards land before the next fire's effect launches. */
export const WARD_GIVEN_FIRE_GAP_MS = 220;

/** A Ward travelled to by its giver: bound, and the giver is a known body (dying, or alive for a forced Echo). */
export function isTravelledWard(w: WardGiven): boolean {
  return w.source !== null && !!bindingFor(w.cardId, 'wardGiven');
}

/** The Ward-gained effect on `target`, as its dome appears. */
export function playWardGained(target: string, srcCard: string | null, index = 0): void {
  const b = bindingFor(srcCard, 'shieldGain');
  const a = b ? anchorsForUnits(null, target) : null;
  if (b && a) playDef(b.def, a, { uids: { source: null, target }, index, gain: b.gain });
}

/**
 * Where `target` will SETTLE once the giver's slot has collapsed (screen px, x only). The dying card's slot shrinks
 * out of its centred row while the effect flies, so the row's survivors glide toward the gap: a target measured at
 * launch is off by whatever is left of that glide (owner report 2026-11-04, "they shift after lastlight dies").
 * In a centred flex row, removing the slot's remaining footprint moves every unit before it right, and every
 * unit after it left, by half of it. No shift when the giver is gone already, alive, or sits in another row.
 */
export function settledShiftX(dyingEl: Element | null, targetEl: Element): number {
  const row = targetEl.parentElement;
  if (!dyingEl || !row || dyingEl.parentElement !== row || dyingEl === targetEl) return 0;
  const el = dyingEl as HTMLElement;
  if (!el.classList.contains('dying')) return 0; // a forced Echo's giver is alive: nothing collapses
  // Slot held (a Rise body, a Fel Spikes spray): it never collapses while this effect flies.
  if (el.classList.contains('rising') || el.classList.contains('holdecho')) return 0;
  const cs = getComputedStyle(el);
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const remaining = el.offsetWidth + gap + (parseFloat(cs.marginRight) || 0);
  if (remaining <= 0) return 0;
  const before = (dyingEl.compareDocumentPosition(targetEl) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
  return toScreen(remaining / 2) * (before ? 1 : -1);
}

/** Split one giver's Wards into its fires: by `fire` (a forced Echo's rally) or, for a death, by its per-fire count. */
export function fireGroups(given: WardGiven[], perFire: number): WardGiven[][] {
  if (!given.length) return [];
  if (given.some((w) => w.fire !== undefined)) {
    const by = new Map<number, WardGiven[]>();
    for (const w of given) { const k = w.fire ?? -1; by.set(k, [...(by.get(k) ?? []), w]); }
    return [...by.values()];
  }
  const n = Math.max(1, perFire);
  const out: WardGiven[][] = [];
  for (let i = 0; i < given.length; i += n) out.push(given.slice(i, i + n));
  return out;
}

/** How many Wards one fire of `cardId`'s Echo gives (its `count` param, doubled when golden). */
export function wardsPerFire(cardId: string, golden: boolean): number {
  const eff = CARD_INDEX[cardId]?.effects?.find((f) => f.on === 'onDeath' && f.do === 'deathrattleGrantWardRandom');
  const count = typeof eff?.params?.count === 'number' ? eff.params.count : 2;
  return count * (golden ? 2 : 1);
}

type Slot = { cx: number; cy: number; w: number; h: number };

/**
 * Play each fire's volley in turn from `sourceUid` (at `slot`, or its live rect when null): fire 0 launches after
 * `firstDelayMs`, each later fire once the previous one's Wards have landed plus a short pause. Every target stays
 * hidden from now until its own fire lands. `register` keeps the timers in the combat-lifetime registry so a seek /
 * reset cancels them (a cancelled hold still expires on its own).
 */
function playFires(sourceUid: string, slot: Slot | null, groups: WardGiven[][], firstDelayMs: number, speed: number, register: (id: number) => void): void {
  const s = speed > 0 ? speed : 1;
  const cardId = groups[0]?.[0]?.cardId ?? null;
  const b = bindingFor(cardId, 'wardGiven');
  const arrive = b ? defArrivalMs(getDef(b.def)) : 0;
  const step = arrive + WARD_GIVEN_FIRE_GAP_MS;
  groups.forEach((group, g) => {
    const launchAt = firstDelayMs + g * step;
    for (const w of group) holdWard(w.target, (launchAt + arrive) / s + 50); // safety net; `land` releases it on time
    register(window.setTimeout(() => {
      let rang = false;
      const source = slot
        ? { left: slot.cx - slot.w / 2, top: slot.cy - slot.h / 2, width: slot.w, height: slot.h }
        : document.querySelector(unitSelector(sourceUid))?.getBoundingClientRect() ?? null;
      const giverEl = document.querySelector(unitSelector(sourceUid));
      group.forEach((w, k) => {
        const land = (): void => {
          holdWard(w.target, 0);
          if (!rang) { rang = true; sfx.shield(); } // one Ward sound per fire
          playWardGained(w.target, w.cardId, k);
        };
        const tEl = document.querySelector(unitSelector(w.target));
        let target: { left: number; top: number; width: number; height: number } | null = null;
        if (tEl) {
          const r = tEl.getBoundingClientRect();
          // Aim where the target ENDS UP, not where it is mid-glide into the giver's gap.
          target = { left: r.left + settledShiftX(giverEl, tEl), top: r.top, width: r.width, height: r.height };
        }
        const anchors = b && source && target
          ? combatAnchorsFromRects({ source, target, row: null, viewport: { w: window.innerWidth, h: window.innerHeight } })
          : null;
        if (!b || !anchors) { land(); return; }
        playDef(b.def, anchors, { uids: { source: sourceUid, target: w.target }, index: k, gain: b.gain });
        if (arrive <= 0) land(); else register(window.setTimeout(land, arrive / s));
      });
    }, launchAt / s));
  });
}

/**
 * Beat start: hide every DEATH-fired travelled Ward until its launch (below) lands it, and launch every FORCED one
 * now, from its living giver, one fire after another.
 */
export function startTravelledWards(
  moment: Moment,
  events: CombatEvent[],
  cardIds: ReadonlyMap<string, string>,
  speed: number,
  register: (id: number) => void,
): void {
  if (!canPlayDefs()) return;
  const forced = new Map<string, WardGiven[]>();
  for (const w of wardsGivenIn(moment, events, cardIds)) {
    if (!isTravelledWard(w)) continue;
    if (w.forced) forced.set(w.source!, [...(forced.get(w.source!) ?? []), w]);
    else holdWard(w.target, WARD_HOLD_MAX_MS);
  }
  for (const [src, given] of forced) playFires(src, null, fireGroups(given, 1), 0, speed, register);
}

/**
 * The giver's skull just fired at `slot` (layout-frame centre + footprint): schedule each fire's Wards, the first a
 * breath after the skull. `golden` reads the giver's gild (it doubles the Wards per fire).
 */
export function launchWardsGiven(
  dyingUid: string,
  slot: Slot,
  moment: Moment,
  events: CombatEvent[],
  cardIds: ReadonlyMap<string, string>,
  speed: number,
  register: (id: number) => void,
  golden = false,
): void {
  if (!canPlayDefs()) return;
  const given = wardsGivenIn(moment, events, cardIds).filter((w) => w.source === dyingUid && !w.forced && isTravelledWard(w));
  if (!given.length) return;
  playFires(dyingUid, slot, fireGroups(given, wardsPerFire(given[0]!.cardId, golden)), WARD_GIVEN_LAUNCH_DELAY_MS, speed, register);
}
