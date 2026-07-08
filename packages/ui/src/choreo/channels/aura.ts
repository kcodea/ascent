import { pixiFx, tauntFx } from '../../pixiFx';
import { sfx } from '../../sfx';
import { getChoreoConfig } from '../choreoConfig';

/**
 * Aura channel (choreographer phase 3c) — the single owner of every combat aura burst/break/re-form FX+sfx
 * dispatch, relocated verbatim out of `Recruit.tsx`'s `syncShields` and `useCombatReplay`'s reborn block. The
 * DECISION of when to fire lives in the Score/engine; WHICH auras a unit carries comes from pixiFx's live
 * bubble registry (`hasAura`), so a burst fires exactly once — the bubble is destroyed on burst — retiring
 * the old `deathBurstRef` once-only guard and the `.dying`/`data-rising` DOM sniffing.
 */

/** A unit DIES while still carrying auras → each explodes in place (ward shatter / spirit release / bulwark
 *  burst). Reads pixiFx's registry for which kinds are live; a taunt burst draws on the FRONT layer at the
 *  bubble's tracked spot (its persistent mesh lives on the back `tauntFx` canvas, cleared first). */
export function burstDeathAuras(uid: string): void {
  if (pixiFx.hasAura(uid, 'shield')) { pixiFx.breakShield(uid, 'shield'); sfx.shieldBreak(); }
  if (pixiFx.hasAura(uid, 'reborn')) { pixiFx.breakShield(uid, 'reborn'); sfx.rebornShatter(); }
  if (tauntFx.hasAura(uid, 'taunt')) {
    const r = tauntFx.auraRect(uid, 'taunt');
    tauntFx.clearShield(uid, 'taunt'); // drop the back-canvas bulwark…
    if (r) pixiFx.tauntBurst(r.cx, r.cy, r.w, r.h); // …burst in FRONT at its tracked spot
    sfx.shieldBreak();
  }
}

/** A Divine Shield is CONSUMED (a `shield` event): hold the bubble briefly so the read is hit → settle →
 *  break, then shatter it (gold shards) + sound. The bubble keeps position-tracking meanwhile (syncShields
 *  still runs). Returns a cancel to clear the pending timer. Encapsulates the former SHIELD_BREAK_DELAY weld. */
export function breakShieldAura(uid: string, combatSpeed: number): () => void {
  const d = getChoreoConfig().shieldBreakDelay / (combatSpeed > 0 ? combatSpeed : 1);
  const id = setTimeout(() => { pixiFx.breakShield(uid, 'shield'); sfx.shieldBreak(); }, d);
  return () => clearTimeout(id);
}

/** A unit REBORN (a `reborn` event): schedule the wispy re-form glow + sound at rebornReformDelay, timed to
 *  the `risepop` CSS re-form phase. `rect` is the unit's measured center+footprint (null → sound only).
 *  Encapsulates the former REBORN_SUMMON_DELAY weld. Returns a cancel for the pending timer. */
export function reformReborn(rect: { cx: number; cy: number; w: number; h: number } | null, combatSpeed: number): () => void {
  const d = getChoreoConfig().rebornReformDelay / (combatSpeed > 0 ? combatSpeed : 1);
  const id = setTimeout(() => {
    if (rect) pixiFx.rebornSummon(rect.cx, rect.cy, rect.w, rect.h);
    sfx.rebornSummon();
  }, d);
  return () => clearTimeout(id);
}
