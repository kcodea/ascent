import type { CombatEvent } from '@game/core';
import type { Moment } from '../choreo/compile';
import { bindingFor } from '../choreo/bindings';
import { executesGivenIn, type ExecuteGiven } from '../choreo/channels/executeGiven';
import { anchorsForUnits } from './combatAnchors';
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

/**
 * Beat start: hide each given Execute aura, launch its giver's effect, and show the aura when it lands. `register`
 * keeps the timers in the combat-lifetime registry so a seek / reset cancels them (a cancelled hold still expires on
 * its own, see `executeHold.ts`).
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
  const s = speed > 0 ? speed : 1;
  const sliced = new Set<string>(); // givers whose slice has rung this beat
  const landed = new Set<string>(); // givers whose landing has rung this beat
  executesGivenIn(moment, events, cardIds).filter(isTravelledExecute).forEach((g, k) => {
    const b = bindingFor(g.cardId, 'executeGiven')!;
    const arrive = defArrivalMs(getDef(b.def));
    const launchAt = executeLaunchDelayMs(g, attackerUid, windupMs);
    holdExecute(g.target, (launchAt + arrive) / s + 50); // safety net; `land` releases it on time
    const land = (): void => {
      holdExecute(g.target, 0);
      if (landed.has(g.source)) return;
      landed.add(g.source);
      const at = anchorsForUnits(g.target, g.target);
      if (at) playDef('sfx-execute-applied', at, { uids: { source: g.target, target: g.target } });
    };
    register(window.setTimeout(() => {
      const anchors = anchorsForUnits(g.source, g.target);
      if (!anchors) { land(); return; } // a unit already left the screen: just show the aura
      playDef(b.def, anchors, { uids: { source: g.source, target: g.target }, index: k, gain: b.gain });
      if (!sliced.has(g.source)) { sliced.add(g.source); playDef('sfx-execute-slice', anchors, { uids: { source: g.source, target: g.target } }); }
      if (arrive <= 0) land(); else register(window.setTimeout(land, arrive / s));
    }, launchAt / s));
  });
}
