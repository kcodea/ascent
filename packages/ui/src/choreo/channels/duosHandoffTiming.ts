/**
 * THE DUOS HAND-OFF'S TIMING (R-DUOS-HANDOFF-BEAT-01): the pure numbers and reads shared by the entrance's CSS
 * (styles.css `.unit.tagin`), the beat clock (`clock.ts`: the entrance has landed before anything follows it), the
 * sound (`channels/sfx.ts`) and the accent (`channels/duosHandoff.ts`). No DOM, no FX imports: the clock reads it.
 */
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

export type HandoffSide = 'player' | 'enemy';
export interface Handoff {
  kind: 'boardFallen' | 'tagIn' | 'flyIn';
  side: HandoffSide;
  /** The arriving bodies, in the event's own order (empty for a fallen board). */
  uids: string[];
}

/** The entrance's own numbers. `styles.css` (`.unit.tagin`) carries the same two as literals; the test pins them. */
export const TAG_FLY_MS = 520;
export const TAG_STAGGER_MS = 60;
/** How far into its flight a body reads as LANDED (the curve overshoots and settles after this). */
export const TAG_LAND_FRAC = 0.72;
/** A row holds at most this many bodies, so the stagger classes stop here. */
export const TAG_MAX_ORDER = 6;
/** The fallen board's dim, ms at 1x: it plays between the fallen beat and the tag-in that follows it (`TAG_IN_LEAD` below). */
export const FALLEN_DIM_MS = 420;

/** Every hand-off event in the moment window, in event order. */
export function handoffsIn(moment: Pick<Moment, 'start' | 'end'>, events: readonly CombatEvent[]): Handoff[] {
  const out: Handoff[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'boardFallen') out.push({ kind: 'boardFallen', side: e.side, uids: [] });
    else if (e.type === 'tagIn' || e.type === 'flyIn') out.push({ kind: e.type, side: e.side, uids: e.minions.map((m) => m.uid) });
  }
  return out;
}

/**
 * WHICH TURN each arriving body takes (0 = first off the edge), by its place in the event. My team flies in from the
 * left, so the leftmost leaves first; the other team flies in from the right, so ITS nearest body (the last one)
 * leaves first. Keyed to the arriving bodies, never to the slot: one body joining six survivors leaves at once.
 */
export function tagOrder(side: HandoffSide, index: number, count: number): number {
  const i = side === 'player' ? index : count - 1 - index;
  return Math.max(0, Math.min(TAG_MAX_ORDER, i));
}

/** The CSS classes a body's entrance wears: `tagin` plus its turn (`tagi-N`, the stagger; none for the first). */
export function tagAnimClass(side: HandoffSide, index: number, count: number): string {
  const o = tagOrder(side, index, count);
  return o > 0 ? `tagin tagi-${o}` : 'tagin';
}

/** When the body taking turn `order` lands, ms after the beat starts, at `speed`. */
export function tagLandMs(order: number, speed: number): number {
  return (order * TAG_STAGGER_MS + TAG_FLY_MS * TAG_LAND_FRAC) / (speed > 0 ? speed : 1);
}

/** When the LAST of `count` bodies lands (the hand-off's hit). */
export function tagLastLandMs(count: number, speed: number): number {
  return tagLandMs(Math.max(0, Math.min(TAG_MAX_ORDER, count - 1)), speed);
}

/** The whole entrance of `count` bodies, ms at `speed`: what the beat's hold has to cover. */
export function tagEntranceMs(count: number, speed: number): number {
  return (Math.max(0, Math.min(TAG_MAX_ORDER, count - 1)) * TAG_STAGGER_MS + TAG_FLY_MS) / (speed > 0 ? speed : 1);
}
