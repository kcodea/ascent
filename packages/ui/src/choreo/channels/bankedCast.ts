/**
 * THE START OF COMBAT CAST BEAT (owner ask 2026-10-07):
 *
 *   *"we need to show these spells being cast in a start of combat beat. can you use the spell preview that we use
 *   for runes except that can also be for start of combat spell casts? for opponents, they should cast on the right
 *   side of the screen opposite where the player's side is."*
 *
 * A next-combat spell (Weaken, Rallying Offensive, Fleeting Vigor, Open the Gates, …) is cast in the Shop and
 * resolves as the NEXT fight opens. The simulator marks that moment with a `bankedCast` event (core
 * `bankedOpeners.ts`; Weaken's is inline before its Health drop) and the effect follows as ordinary events. This
 * channel reads the markers; the replay floats each spell's card through the SAME cast preview a rune's cast uses
 * (`castPreview.ts`), anchored on the caster's side of the screen (`bankedCastAnchor`).
 */
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

export interface BankedCast {
  side: 'player' | 'enemy';
  spellId: string;
  /** Casts folded into this marker (Weaken cast twice, two banked keywords): the preview's ×N chip. */
  count: number;
}

/** Every `bankedCast` in the moment window, in event order. */
export function bankedCastsIn(moment: Pick<Moment, 'start' | 'end'>, events: readonly CombatEvent[]): BankedCast[] {
  const out: BankedCast[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type === 'bankedCast') out.push({ side: e.side, spellId: e.spellId, count: Math.max(1, e.count ?? 1) });
  }
  return out;
}

/** A rect, viewport px. */
export interface AnchorRect { left: number; top: number; width: number; height: number }

/**
 * WHERE a banked cast shows. The PLAYER's sits where a rune's cast preview shows today — on the player's own
 * anchor (the rune rail / hero slot, measured by the caller). An OPPONENT's is that same anchor MIRRORED across
 * the screen's vertical centre line, so it reads as "their side", opposite the player's. Pure.
 */
export function bankedCastAnchor(side: 'player' | 'enemy', playerAnchor: AnchorRect, viewportW: number): AnchorRect {
  if (side === 'player') return playerAnchor;
  return { ...playerAnchor, left: viewportW - playerAnchor.left - playerAnchor.width };
}
