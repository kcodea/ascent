import type { CombatEvent } from '@game/core';
import type { Moment } from '../choreo/compile';
import { bindingFor } from '../choreo/bindings';
import { executesGivenIn, type ExecuteGiven } from '../choreo/channels/executeGiven';
import { anchorsForUnits, unitSelector } from './combatAnchors';
import { trackSettledSlot } from './settledSlot';
import { defArrivalMs } from './defArrival';
import { getDef } from './fxDefs';
import { canPlayDefs, playDef } from './playDef';
import { holdExecute } from './executeHold';

/**
 * "ON EXECUTE GIVEN" in combat (R-FX-EXECUTE-GIVEN-01): a minion that gives another minion Execute (Raven's Rally,
 * Tort's Avenge) launches its bound effect from itself to each minion it gave it to, and that minion's Execute aura
 * appears when the effect lands. The twin of "On Ward given" (`wardGivenLaunch.ts`), simpler in one way: the giver is
 * always alive on the board, so there is no dying slot or collapsing row to aim around.
 *
 * WHEN IT LEAVES. A Rally's grant is absorbed into the giver's own wind-up, so the frame commits it the moment the
 * swing starts; `launchDelayMs` (the wind-up's length, from the caller) holds the launch to the Rally medallion pulse.
 * Any other grant (Tort's Avenge) launches as its beat starts.
 *
 * THE SOUNDS (owner 2026-11-12). The slice plays as the effect LEAVES; the blood + ding play as it LANDS and the aura
 * appears. Each rings ONCE per giver per beat, so a Gilded Raven's two beams are one slice and one landing, not two
 * stacked copies (the Ward path's one-sound-per-fire rule).
 */

/** The sound as an effect leaves its giver. */
export const EXECUTE_LAUNCH_SFX = 'sfx-execute-slice';
/** The sounds as it lands and the Execute appears. */
export const EXECUTE_LAND_SFX = 'sfx-execute-applied';

/** Is this grant one its giver travels to (its card has an "On Execute given" effect bound)? */
export function isTravelledExecute(g: ExecuteGiven): boolean {
  return !!bindingFor(g.cardId, 'executeGiven');
}

/** When each grant's effect LEAVES (ms at 1x from the beat's start): the attacker's own leave at its Rally pulse. */
export function executeLaunchDelayMs(g: ExecuteGiven, attackerUid: string | null, windupMs: number): number {
  return attackerUid !== null && g.source === attackerUid ? Math.max(0, windupMs) : 0;
}

/** Once-per-giver sound gates for one beat: a giver's two beams are one slice and one landing. */
export interface ExecuteSoundGate { sliced: Set<string>; landed: Set<string> }
export const executeSoundGate = (): ExecuteSoundGate => ({ sliced: new Set(), landed: new Set() });

/**
 * ONE grant, in either phase: hide the receiver's Execute aura, launch the giver's bound effect after `launchAt` ms
 * (at 1x), and show the aura with the landing sounds when it arrives. `register` receives every timer id.
 */
export function launchExecuteGiven(
  g: ExecuteGiven,
  index: number,
  opts: { speed: number; launchAt: number; gate: ExecuteSoundGate; register: (id: number) => void },
): void {
  const b = bindingFor(g.cardId, 'executeGiven');
  if (!b || !canPlayDefs()) return;
  const s = opts.speed > 0 ? opts.speed : 1;
  const { sliced, landed } = opts.gate;
  const arrive = defArrivalMs(getDef(b.def));
  holdExecute(g.target, (opts.launchAt + arrive) / s + 50); // safety net; `land` releases it on time
  const land = (): void => {
    holdExecute(g.target, 0);
    if (landed.has(g.source)) return;
    landed.add(g.source);
    const at = anchorsForUnits(g.target, g.target);
    if (at) playDef('sfx-execute-applied', at, { uids: { source: g.target, target: g.target } });
  };
  const launch = (): void => {
    const anchors = anchorsForUnits(g.source, g.target);
    if (!anchors) { land(); return; } // a unit already left the screen: just show the aura
    // LAND WHERE THE MINION ENDS UP (owner 2026-11-12): the death that fired an Avenge collapses the row while the
    // effect flies, so aim at the receiver's SETTLED slot and keep following it until the effect retires.
    const settle = trackSettledSlot(() => document.querySelector(unitSelector(g.target)));
    const stop = playDef(b.def, settle ? { ...anchors, target: settle.start } : anchors,
      { uids: { source: g.source, target: g.target }, index, gain: b.gain, target: settle?.get, onDone: settle?.stop });
    if (!stop) settle?.stop(); // nothing played: no retire will ever call onDone
    if (!sliced.has(g.source)) { sliced.add(g.source); playDef('sfx-execute-slice', anchors, { uids: { source: g.source, target: g.target } }); }
    if (arrive <= 0) land(); else opts.register(window.setTimeout(land, arrive / s));
  };
  if (opts.launchAt <= 0) launch(); else opts.register(window.setTimeout(launch, opts.launchAt / s));
}

/**
 * Beat start in COMBAT: hide each given Execute aura, launch its giver's effect, and show the aura when it lands.
 * `register` keeps the timers in the combat-lifetime registry so a seek / reset cancels them (a cancelled hold still
 * expires on its own, see `executeHold.ts`).
 */
export function startExecutesGiven(
  moment: Moment,
  events: CombatEvent[],
  cardIds: ReadonlyMap<string, string>,
  speed: number,
  register: (id: number) => void,
  attackerUid: string | null,
  windupMs: number,
): void {
  if (!canPlayDefs()) return;
  const gate = executeSoundGate();
  executesGivenIn(moment, events, cardIds).filter(isTravelledExecute).forEach((g, k) => {
    launchExecuteGiven(g, k, { speed, launchAt: executeLaunchDelayMs(g, attackerUid, windupMs), gate, register });
  });
}

/**
 * THE SHOP (R-FX-EXECUTE-GIVEN-01, owner 2026-11-12 "Yes, add the Shop"): a Rally forced in the Shop (an End-of-Turn
 * Rally replay, Rune of Rallying) delivers its Execute as a `keywordChanged` on the giver's own beat. The beat has
 * already pulsed the giver, so the effect leaves at once. One sound gate per (beat, giver).
 */
const shopGates = new Map<string, ExecuteSoundGate>();
export function launchShopExecuteGiven(g: ExecuteGiven, beatId: string, index: number): boolean {
  if (!isTravelledExecute(g) || g.source === g.target || !canPlayDefs()) return false;
  const key = `${beatId}|${g.source}`;
  let gate = shopGates.get(key);
  if (!gate) {
    if (shopGates.size > 64) shopGates.clear(); // beats are long past; never grows with a run
    gate = executeSoundGate();
    shopGates.set(key, gate);
  }
  launchExecuteGiven(g, index, { speed: 1, launchAt: 0, gate, register: () => {} });
  return true;
}
