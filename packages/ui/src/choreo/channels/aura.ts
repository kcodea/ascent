import { pixiFx, tauntFx } from '../../pixiFx';
import { sfx } from '../../sfx';

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

/** A Divine Shield was consumed → shatter it now (gold shards) + sound. The DELAY is now the auraBreak cue's
 *  offset, scheduled by the runner (was this function's internal SHIELD_BREAK_DELAY setTimeout). */
export function breakShieldAura(uid: string): void {
  pixiFx.breakShield(uid, 'shield');
  sfx.shieldBreak();
}

/** A unit reborn → the re-form glow + sound now. The DELAY is the auraReform cue's offset (scaled:false),
 *  scheduled by the runner (was the internal REBORN_SUMMON_DELAY setTimeout). */
export function reformReborn(rect: { cx: number; cy: number; w: number; h: number } | null): void {
  if (rect) pixiFx.rebornSummon(rect.cx, rect.cy, rect.w, rect.h);
  sfx.rebornSummon();
}
