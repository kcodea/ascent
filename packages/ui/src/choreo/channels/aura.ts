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
 *  burst). Reads pixiFx's registry for which kinds are live. Shield/reborn bursts read their bubble's OWN
 *  stored coords (they render on the same viewport-fixed front layer they're stored on). The taunt burst,
 *  however, draws on the FRONT (viewport) layer while its persistent bulwark lives on the back `tauntFx`
 *  canvas (whose bubble coords are `.app`-relative) — so it needs the dying card's VIEWPORT rect passed in
 *  (`tauntRect`), exactly as the old syncShields fed it a fresh getBoundingClientRect. Null → sfx only. */
export function burstDeathAuras(uid: string, tauntRect: { cx: number; cy: number; w: number; h: number } | null = null): void {
  if (pixiFx.hasAura(uid, 'shield')) { pixiFx.breakShield(uid, 'shield'); sfx.shieldBreak(); }
  if (pixiFx.hasAura(uid, 'reborn')) { pixiFx.breakShield(uid, 'reborn'); sfx.rebornShatter(); }
  if (tauntFx.hasAura(uid, 'taunt')) {
    tauntFx.clearShield(uid, 'taunt'); // drop the back-canvas bulwark…
    if (tauntRect) pixiFx.tauntBurst(tauntRect.cx, tauntRect.cy, tauntRect.w, tauntRect.h); // …burst in FRONT (viewport coords)
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
 *  Encapsulates the former REBORN_SUMMON_DELAY weld. Returns a cancel for the pending timer. NOTE: this delay
 *  is NOT scaled by combatSpeed — it aligns to the fixed-duration `risepop` CSS re-form animation (0.7s wall
 *  clock, not speed-scaled), matching the former fixed REBORN_SUMMON_DELAY. (Contrast breakShieldAura, which
 *  DOES scale, because it aligns to the speed-scaled lunge connection.) */
export function reformReborn(rect: { cx: number; cy: number; w: number; h: number } | null): () => void {
  const id = setTimeout(() => {
    if (rect) pixiFx.rebornSummon(rect.cx, rect.cy, rect.w, rect.h);
    sfx.rebornSummon();
  }, getChoreoConfig().rebornReformDelay);
  return () => clearTimeout(id);
}
