import { pixiFx } from '../../pixiFx';
import { playDef } from '../../fx/playDef';
import { sfx } from '../../sfx';
import { getRebirthConfig, rebirthPalette } from '../../rebirthConfig';
import { pillarHostFor, spawnRebirthBurn, spawnRebirthPillar } from '../../fx/rebirthPillar';

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
  // A REBIRTH body burns away in blue flame, embers hovering in its slot until it returns (owner 2026-09-26).
  if (card.classList.contains('rebirthcard')) spawnRebirthBurn(rect);
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

/** A unit REBIRTHS (the `RB` keyword's full-body return, `reborn { rebirth: true }`) → its phoenix moment in blue
 *  and white fire (owner 2026-09-25; made loud 2026-09-26, "its not noticeable"): the one-shot `rebirth-flame`
 *  column erupts from the slot, recoloured to the 🔥 tuner's flame colours, sized by `burstScale` and stretched by
 *  `burstTime`; the flame whoosh follows `soundOffset` ms later (gap-gated, so a mass rebirth rings once). The unit's
 *  own re-form out of the fire is CSS (`.unit.rebirthing`), started by the same beat, and the pillar of fire it
 *  rises from is `fx/rebirthPillar.ts` (hosted on the unit, or `host` when a caller passes one). Fired at the beat START by the
 *  `rebirthFx` cue. `uid` is the returning unit.
 *
 *  SIZE: the rect is measured at beat start, while the re-entering slot is still expanding from zero WIDTH
 *  (`summonexpand`) — sizing off `w` made the first burst near-invisible. The height is stable, so the burst sizes
 *  off it (a card is ~0.75 as wide as it is tall). */
export function reformRebirth(rect: { cx: number; cy: number; w: number; h: number } | null, uid: string | null, host: HTMLElement | null = null): void {
  const c = getRebirthConfig();
  spawnRebirthPillar(host ?? pillarHostFor(uid), rect);
  if (rect) {
    const cardW = Math.max(rect.w, rect.h * 0.75);
    playDef('rebirth-flame', { target: { x: rect.cx, y: rect.cy } }, {
      uids: { source: null, target: uid },
      scale: c.burstScale * (cardW / 180),
      time: c.burstTime,
      recolor: rebirthPalette(c),
    });
  }
  if (c.soundGain > 0 && rebirthSoundAllowed()) sfx.rebirthFlame(c.soundGain, c.soundOffset);
}
let lastRebirthSoundAt = 0;
function rebirthSoundAllowed(): boolean {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (now - lastRebirthSoundAt < 120) return false;
  lastRebirthSoundAt = now;
  return true;
}
