import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import { EQUIPMENT_INDEX } from '@game/content';
import type { RunState } from '@game/sim';
import { LASSO_STAGGER_MS } from './lassoHolds';
import { DEFAULT_ROLL_MS, holdStat } from './fx/statHold';
import { canPlayDefs, playDef } from './fx/playDef';

/**
 * THE EQUIPMENT BEAM CASCADE (owner ruling 2026-09-22: *"spiritbinder one beam per fire"*).
 *
 * An Equipment flagged `useFxTargetsBuffed` (Spiritbinder) throws its authored def from the slot at the board
 * body its own effect picked. The sim stamps ONE `use` cue PER FIRE of such an Equipment — an Amplified press,
 * an extra trigger, a Calibration charge each add a fire — and this module plays those cues as N beams, one
 * per fire, `EQUIP_BEAM_STAGGER_MS` apart, each landing on ITS recipient with that recipient's badge held to
 * its own contact. Before the ruling the sim folded every fire into one cue aimed at the LAST pick, so an
 * earlier recipient fell through to the generic self-buff burst and two fires read as one beam plus one
 * unrelated flash.
 *
 * Presentation only: the reducer resolved every buff before a frame of the first beam drew. A hold DELAYS the
 * number the player sees; it never changes what resolved (R-PRESENT-01).
 *
 * The cascade's shape is the lasso's (`lassoHolds.ts`, PR #1629), with the differences that matter:
 *   · the hold is the stat-hold store (`fx/statHold.ts`), placed PRE-PAINT in a layout effect — in a passive
 *     effect the new number paints for a frame and then jumps backwards before rolling, which is worse than no
 *     hold at all — rather than React state for a shop row;
 *   · the store keeps ONE hold per uid, so two fires on the SAME body are aggregated into one hold that opens
 *     at the FIRST beam's contact and rolls until the LAST beam's contact plus the default roll (see
 *     `equipBeamHoldPlan`);
 *   · a later action must NEVER cut a use def or a pending beam (owner 2026-09-09: "it should just play out
 *     over top of whatever happens in that slot"), so unlike the lasso the previous cascade's clock is NOT
 *     dropped when the next action arrives. Every launch timer and every playing def's retire fn lives in one
 *     list, outside any per-action effect, disposed only when the shop leaves and on unmount.
 *
 * ORDERING LAW (R-PRESENT-01): the seq guard advances FIRST, exactly once per action; the effect registers NO
 * cleanup; the phase watcher and the unmount hatch are the only disposers; no hold is ever released from an
 * effect cleanup.
 */

export type EquipCue = NonNullable<RunState['equipFx']>[number];

/** One beam: the cue that earned it, the def it plays, the body it lands on and what that body gained. */
export interface EquipBeam {
  readonly cue: EquipCue;
  readonly fxId: string;
  readonly targetUid: string;
  readonly attack: number;
  readonly health: number;
}

/** One beam to the next. The lasso's gap, for the lasso's reason — "overlap slightly, about 300 ms apart"
 *  (owner 2026-09-22): beam N+1 launches during beam N's dwell, so several fires read as a rapid sequence
 *  rather than one at a time. Named separately so retuning one cascade never silently retunes the other. */
export const EQUIP_BEAM_STAGGER_MS = LASSO_STAGGER_MS;

/** How long the body an Equipment's own effect buffed holds its pre-buff badge, measured from the moment its
 *  beam launches. Set to CONTACT — the `travelMs` of the owner's `spiritbinder` beam, the point at which the
 *  strand has finished growing from the slot to the card — so the roll opens as the beam arrives rather than
 *  while it is still crossing. The shockwave layer's earlier `at` (90ms) is a flare on the destination, not the
 *  arrival; opening the roll there put the badge 110ms ahead of the strand and read as the numbers moving on
 *  their own (review 2026-09-22). `spiritbinderBeamGuard.test.ts` pins this to the def's own `travelMs`. */
export const EQUIP_BUFF_LAND_MS = 200;

/**
 * The cues of one action that are BEAMS: `use` cues of an Equipment flagged `useFxTargetsBuffed` that carry a
 * `targetUid`, in stamp order — which is fire order. A cue without a target is the "picked nobody" signal and
 * plays nothing at all (`Recruit`'s `aimlessBeam` guard); a Choose One Equipment announced itself when its
 * prompt opened. This is also the predicate `Recruit`'s `beamedNow` filter applies to keep the generic
 * self-buff burst off every beamed body.
 */
export function equipBeamsOf(cues: readonly EquipCue[] | undefined): EquipBeam[] {
  const out: EquipBeam[] = [];
  for (const cue of cues ?? []) {
    if (cue.kind !== 'use' || !cue.targetUid) continue;
    const eq = cue.equipmentId ? EQUIPMENT_INDEX[cue.equipmentId] : undefined;
    if (!eq?.useFxId || eq.useFxTargetsBuffed !== true || eq.chooseOne?.length) continue;
    out.push({ cue, fxId: eq.useFxId, targetUid: cue.targetUid, attack: cue.buffAttack ?? 0, health: cue.buffHealth ?? 0 });
  }
  return out;
}

export interface EquipBeamSlot {
  /** ms after the action commits at which this beam leaves the slot. */
  launchAt: number;
  /** ms after the action commits at which it reaches its body — when that body's numbers may start moving. */
  contactAt: number;
}

/** When each beam in a cascade launches and lands. `baseDelayMs` is the tuner's `useDelayMs`, added on top of
 *  every beam exactly as it was added to the single beam before. Presentation clock only. */
export function equipBeamSchedule(count: number, baseDelayMs = 0): EquipBeamSlot[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({
    launchAt: baseDelayMs + i * EQUIP_BEAM_STAGGER_MS,
    contactAt: baseDelayMs + i * EQUIP_BEAM_STAGGER_MS + EQUIP_BUFF_LAND_MS,
  }));
}

export interface EquipBeamHold {
  uid: string;
  attack: number;
  health: number;
  startAt: number;
  rollMs: number;
}

/**
 * The holds a cascade places, ONE PER RECIPIENT. `fx/statHold.ts` keeps one hold per uid, and an equal-rank
 * re-hold carries into a single hold with the LAST call's `startAt` — two naive calls for two beams on one body
 * would therefore collapse into the sum scheduled at the SECOND contact, and the first beam would land on
 * unmoved numbers. So the gains of every beam aimed at a body are summed into one hold that opens at that
 * body's FIRST contact and keeps rolling until its LAST contact plus the default roll: two beams, one continuous
 * roll spanning both landings. A body beamed once gets exactly the hold it always got.
 *
 * Two visibly SEPARATE rolls on one body would need a multi-segment hold in the shared store (combat uses it
 * too) — surfaced as a design fork for the owner rather than bolted on here.
 *
 * The same one-hold-per-uid fact reaches ACROSS presses: a second press whose beam lands on a body still waiting
 * for a beam from the first press re-holds it at equal rank, which carries the unrevealed remainder but takes
 * the SECOND press's `startAt` / `rollMs` (`holdStat`). Nothing is lost and the badge still settles on the truth;
 * only that body's roll-to-landing pairing for the earlier beam slips. The multi-segment hold would fix this case
 * too (review 2026-09-22).
 */
export function equipBeamHoldPlan(beams: readonly EquipBeam[], baseDelayMs = 0): EquipBeamHold[] {
  const schedule = equipBeamSchedule(beams.length, baseDelayMs);
  const byUid = new Map<string, EquipBeamHold>();
  beams.forEach((b, i) => {
    const { contactAt } = schedule[i]!;
    const h = byUid.get(b.targetUid);
    if (!h) byUid.set(b.targetUid, { uid: b.targetUid, attack: b.attack, health: b.health, startAt: contactAt, rollMs: DEFAULT_ROLL_MS });
    else {
      h.attack += b.attack;
      h.health += b.health;
      h.rollMs = contactAt - h.startAt + DEFAULT_ROLL_MS;
    }
  });
  return [...byUid.values()].filter((h) => h.attack !== 0 || h.health !== 0);
}

export interface Point { x: number; y: number }

/** What the screen supplies. Held in a ref assigned during render, so the beam code reads this render's. */
export interface EquipBeamAnchors {
  /** The Equipment slot's centre — every beam leaves the slot (owner 2026-09-12: "equipment can always be a
   *  starting point of an effect"). Null when the slot is not on screen. */
  slot: () => Point | null;
  /** A board body's RESTING centre (transform-immune), measured at launch inside the beam's own beat, so a later
   *  beam lands where the card IS after any FLIP. Null when the body has left the board: that beam is skipped,
   *  never redirected to the slot (a slot-to-slot beam reads as a misfire). */
  body: (uid: string) => Point | null;
  /** Fired as each beam launches — the Equipment's clip rides here, one per beat. */
  onLaunch?: (beam: EquipBeam, index: number) => void;
}

export interface EquipBeamCascadeOpts {
  /** `run.equipFxSeq` — the sim's per-stamp bump; N cues in one action move it by N. */
  seq: number | undefined;
  /** `run.equipFx` — this action's cues (every kind; the beams are filtered out here). */
  cues: readonly EquipCue[] | undefined;
  phase: RunState['phase'];
  /** Read at fire time (a tuner edit applies to the next press): the `useDelayMs` before the first beam. */
  baseDelayMs: () => number;
  anchors: MutableRefObject<EquipBeamAnchors>;
}

export interface EquipBeamCascade {
  /** Every pending launch timer's clear and every playing def's retire fn — the ONE list `Recruit` also puts its
   *  other use defs in (Bloodpot, the Deathfibrillator bolt), so all of them share the same disposers. */
  stops: MutableRefObject<Array<() => void>>;
  /** Dispose everything in `stops`. Called by the phase watcher and the unmount hatch — never per action. */
  retire: () => void;
}

export function useEquipBeamCascade(opts: EquipBeamCascadeOpts): EquipBeamCascade {
  const { seq, phase } = opts;
  const latest = useRef(opts);
  latest.current = opts;

  const stopsRef = useRef<Array<() => void>>([]);
  const retire = useCallback((): void => {
    for (const f of stopsRef.current.splice(0)) f();
  }, []);

  const prevSeq = useRef(seq);
  useLayoutEffect(() => {
    if (seq === undefined || seq === prevSeq.current) return;
    prevSeq.current = seq; // advance FIRST — exactly once per action, however many cues bumped it
    const o = latest.current;
    if (o.phase !== 'recruit') return;
    const beams = equipBeamsOf(o.cues);
    if (beams.length === 0 || !canPlayDefs()) return;
    const base = o.baseDelayMs();
    const schedule = equipBeamSchedule(beams.length, base);
    beams.forEach((beam, i) => {
      const fire = (): void => {
        const a = latest.current.anchors.current;
        const from = a.slot();
        const to = a.body(beam.targetUid);
        if (!from || !to) return; // the body is gone (sold, consumed): no beam, and never one to the slot
        a.onLaunch?.(beam, i);
        // The Equipment is ALWAYS the `source`; the uids travel too, so a `react` layer added to the def later
        // animates the card it landed on. The slot is HUD chrome and has no uid of its own.
        const stop = playDef(beam.fxId, { source: from, target: to, cursor: to }, { uids: { source: null, target: beam.targetUid } });
        if (stop) stopsRef.current.push(stop);
      };
      const { launchAt } = schedule[i]!;
      // The launch timer lives with the def, never in a per-action list (owner 2026-09-09).
      if (launchAt > 0) {
        const t = window.setTimeout(fire, launchAt);
        stopsRef.current.push(() => window.clearTimeout(t));
      } else fire();
    });
    // THE BEAM CAUSES THE NUMBERS (owner ask 2026-09-22). The reducer already committed every buff, so without a
    // hold each recipient's badge jumps the instant the press registers and the beams arrive at bodies that
    // visibly changed before they were hit. A `cue` hold withholds exactly what the cues carried — never
    // re-derived from the run-total buff ledger — until each body's own contact, and outranks the intrinsic roll
    // `Card` would otherwise place on the same change. Placed here, in the layout effect, pre-paint.
    for (const h of equipBeamHoldPlan(beams, base)) {
      holdStat(h.uid, { attack: h.attack, health: h.health }, { origin: 'cue', startAt: h.startAt, rollMs: h.rollMs });
    }
    // NO cleanup — see the ordering law above. Keyed on the seq only; the cues are read through `latest`.
  }, [seq]);

  // Leaving the shop (End Turn, a combat, a restore) retires every pending launch and every playing def; the
  // holds themselves are dropped by the store's `dropBoardFx` on the same flip.
  useEffect(() => { if (phase !== 'recruit') retire(); }, [phase, retire]);
  useEffect(() => () => retire(), [retire]);

  return { stops: stopsRef, retire };
}
