import { pixiFx } from '../../pixiFx';
import { playDef } from '../../fx/playDef';
import { sfx } from '../../sfx';

/**
 * Aura channel (choreographer phase 3c) — the single owner of every combat aura burst/break/re-form FX+sfx
 * dispatch, relocated out of `Recruit.tsx`'s old `syncShields` and `useCombatReplay`'s reborn block. The
 * DECISION of when to fire lives in the Score/engine; WHICH auras a unit carries is read off the card's CSS
 * markers (`.dscard` / `.reborncard`) at fire time — both auras are CSS stacks on the card now, with no
 * persistent Pixi bubble, so the DOM marker is the source of truth.
 */

/** A unit DIES while still carrying auras → each explodes in place at the passed `rect`: the Ward bursts
 *  (owner-authored `ward-lost-blast`) and Reborn releases its spirit (wispy shatter). Both are read off the
 *  dying unit's card markers (`.dscard` / `.reborncard`); a unit can carry both. The Ward SOUND
 *  (`sfx.shieldBreak`) is unchanged — only its visual moved from the `shatterAt` shard-burst to the def. */
export function burstDeathAuras(uid: string, rect: { cx: number; cy: number; w: number; h: number } | null = null): void {
  if (!rect || typeof document === 'undefined') return;
  const card = document.querySelector(`.unit[data-uid="${uid}"] .card`);
  if (!card) return;
  if (card.classList.contains('dscard')) { playDef('ward-lost-blast', { target: { x: rect.cx, y: rect.cy } }, { uids: { source: null, target: uid } }); sfx.shieldBreak(); }
  if (card.classList.contains('reborncard')) { pixiFx.shatterAt(rect.cx, rect.cy, rect.w, rect.h, 'reborn'); sfx.rebornShatter(); }
}

/** A Ward was consumed → play `ward-lost-blast` now + the unchanged `sfx.shieldBreak` sound, at the unit's
 *  `rect` — the persistent bubble is CSS now, so there's no Pixi bubble to read coords from. The anchor is the
 *  caller's (the lunge's `contact` for an attack; the auraBreak cue offset for a non-attack break). `uid` is
 *  the unit that lost the Ward — handed to `playDef` so a `react` layer (if the def ever grows one) knows which
 *  card this is about (see `playDefUids.test.ts`). Owner ask 2026-09-09: the def replaced the old `shatterAt`
 *  gold-shard burst; the sound stays. */
export function breakShieldAura(rect: { cx: number; cy: number; w: number; h: number } | null, uid: string | null = null): void {
  if (rect) playDef('ward-lost-blast', { target: { x: rect.cx, y: rect.cy } }, { uids: { source: null, target: uid } });
  sfx.shieldBreak();
}

/** A unit reborn → the re-form glow + sound now. The DELAY is the auraReform cue's offset (scaled:false),
 *  scheduled by the runner (was the internal REBORN_SUMMON_DELAY setTimeout). */
export function reformReborn(rect: { cx: number; cy: number; w: number; h: number } | null): void {
  if (rect) pixiFx.rebornSummon(rect.cx, rect.cy, rect.w, rect.h);
  sfx.rebornSummon();
}
