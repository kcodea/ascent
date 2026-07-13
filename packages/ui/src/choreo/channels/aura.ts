import { pixiFx } from '../../pixiFx';
import { sfx } from '../../sfx';

/**
 * Aura channel (choreographer phase 3c) — the single owner of every combat aura burst/break/re-form FX+sfx
 * dispatch, relocated verbatim out of `Recruit.tsx`'s `syncShields` and `useCombatReplay`'s reborn block. The
 * DECISION of when to fire lives in the Score/engine; WHICH auras a unit carries comes from pixiFx's live
 * bubble registry (`hasAura`), so a burst fires exactly once — the bubble is destroyed on burst — retiring
 * the old `deathBurstRef` once-only guard and the `.dying`/`data-rising` DOM sniffing.
 */

/** A unit DIES while still carrying auras → each explodes in place (ward shatter / spirit release). Reborn keeps
 *  its persistent Pixi bubble, so it bursts via the registry. The WARD is CSS now (no Pixi bubble), so its shatter
 *  fires at the passed `rect` if the dying unit still wears the `.dscard` marker. */
export function burstDeathAuras(uid: string, rect: { cx: number; cy: number; w: number; h: number } | null = null): void {
  if (rect && typeof document !== 'undefined' && document.querySelector(`.unit[data-uid="${uid}"] .card.dscard`)) { pixiFx.shatterAt(rect.cx, rect.cy, rect.w, rect.h, 'shield'); sfx.shieldBreak(); }
  if (pixiFx.hasAura(uid, 'reborn')) { pixiFx.breakShield(uid, 'reborn'); sfx.rebornShatter(); }
}

/** A Ward was consumed → shatter it now (gold shards, NO shield-disc flash) + sound, at the unit's `rect` — the
 *  persistent bubble is CSS now, so there's no Pixi bubble to read coords from. The anchor is the caller's (the
 *  lunge's `contact` for an attack; the auraBreak cue offset for a non-attack break). */
export function breakShieldAura(rect: { cx: number; cy: number; w: number; h: number } | null): void {
  if (rect) pixiFx.shatterAt(rect.cx, rect.cy, rect.w, rect.h, 'shield');
  sfx.shieldBreak();
}

/** A unit reborn → the re-form glow + sound now. The DELAY is the auraReform cue's offset (scaled:false),
 *  scheduled by the runner (was the internal REBORN_SUMMON_DELAY setTimeout). */
export function reformReborn(rect: { cx: number; cy: number; w: number; h: number } | null): void {
  if (rect) pixiFx.rebornSummon(rect.cx, rect.cy, rect.w, rect.h);
  sfx.rebornSummon();
}
