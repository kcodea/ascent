import type { CombatEvent } from '@game/core';
import type { CardPlateLook } from './cardPlate/cardPlateLook';

/**
 * THE OPPONENT'S HAND (owner ask 2026-10-23: "add an opponent's hand area to the left of their runes. it should show
 * their card plate they have equipped, but without the minions text or art, so it is 'hidden.'", and "show when
 * opponents get cards added to hand in real time as well"). The PURE half: which face-down cards the foe holds at a
 * point in the fight. `OpponentHand.tsx` draws them.
 *
 * What the screen may know is exactly what the event log already tells the player: how MANY cards the foe holds, when
 * one arrives (`toHand`, side-tagged since R-SYMMETRY-01) and when one is summoned from (`summon.fromHandUid`). Never
 * which card: a hidden card carries only an opaque key, never a card id, name, text or stats.
 */

/** One face-down card. `key` is opaque: a starting minion's hand uid, a starting spell's slot, or a grant's uid. */
export interface OppHandCard {
  key: string;
  /** A copy of it was summoned this fight: greyed for the rest of it, like the player's own hand card. */
  spent: boolean;
  /** It arrived mid-fight (a `toHand`), not in the starting hand. */
  grant: boolean;
}

/** The starting hand, as far as the served board recorded it (older boards: nothing). */
export interface OppStartHand {
  /** Hand uids of the minions (these are what `summon.fromHandUid` names). */
  minionUids: readonly string[];
  /** How many spells. */
  spells: number;
}

export const EMPTY_START_HAND: OppStartHand = Object.freeze({ minionUids: Object.freeze([]) as readonly string[], spells: 0 });

/** The served board's starting hand: minions, then spells (the snapshot records the two lists apart). */
export function oppStartHand(snapshot: { handMinions?: readonly { uid: string }[]; handSpellIds?: readonly string[] } | null | undefined): OppStartHand {
  const minionUids = (snapshot?.handMinions ?? []).map((h) => h.uid);
  const spells = snapshot?.handSpellIds?.length ?? 0;
  return minionUids.length === 0 && spells === 0 ? EMPTY_START_HAND : { minionUids, spells };
}

/** The key a mid-fight grant goes by: the `toHand` event's own `uid` when it carries one (a summonable grant,
 *  2026-10-23 ruling), else its position in the log (stable for the fight). */
export function grantKeyOf(e: CombatEvent, index: number): string {
  const uid = (e as { uid?: unknown }).uid;
  return typeof uid === 'string' && uid ? uid : `g${index}`;
}

/**
 * Does this summon TAKE the hand card (a consuming summon), rather than copy it? No combat event says so today: every
 * `fromHandUid` is a copy (set 3 Spirits), and Rope Wrangler's consuming factory is used by no card and stamps nothing.
 * The flag is read here and only here, so a consuming summon that stamps `fromHandConsumed` removes its card.
 */
export function summonConsumesHandCard(e: CombatEvent): boolean {
  return e.type === 'summon' && (e as { fromHandConsumed?: unknown }).fromHandConsumed === true;
}

/**
 * Pure: the foe's face-down hand as of event index `through` (exclusive; the replay's `processedEnd`, the same cursor
 * the board folds through). Order: the starting minions, the starting spells, then every enemy `toHand` in log order,
 * capped at `handMax` (a full hand takes nothing more, as the settle drops it). A hand card a copy was summoned from
 * greys once that summon is shown (`summoned`, which skips bodies a summon hold is still withholding); a consuming
 * summon removes it.
 */
export function opponentHandCards(
  start: OppStartHand, events: readonly CombatEvent[], through: number,
  summoned: ReadonlySet<string>, handMax = 10,
): OppHandCard[] {
  const out: OppHandCard[] = [];
  for (const uid of start.minionUids) out.push({ key: uid, spent: false, grant: false });
  for (let i = 0; i < start.spells; i++) out.push({ key: `s${i}`, spent: false, grant: false });
  const end = Math.min(through, events.length);
  for (let i = 0; i < end; i++) {
    const e = events[i]!;
    if (e.type === 'toHand' && e.side === 'enemy') {
      if (out.length < handMax) out.push({ key: grantKeyOf(e, i), spent: false, grant: true });
    } else if (e.type === 'summon' && e.side === 'enemy' && e.fromHandUid && summonConsumesHandCard(e)) {
      const at = out.findIndex((c) => c.key === e.fromHandUid);
      if (at >= 0) out.splice(at, 1);
    }
  }
  if (summoned.size) for (const c of out) if (summoned.has(c.key)) c.spent = true;
  return out;
}

/** A stable signature of a hand, so the drawn list only changes identity when the hand does. */
export function oppHandSignature(cards: readonly OppHandCard[]): string {
  let s = '';
  for (const c of cards) s += `${c.key}${c.spent ? '*' : ''}|`;
  return s;
}

/** The face-down card's picture: the foe's equipped plate WHOLE (its Collection composite), else the standard plate. */
export function oppHandBackSrc(look: CardPlateLook | null, standard: string): string {
  return look?.thumb ?? standard;
}

/**
 * Pure: the fan. Card `i` of `n` sits `step` px from its neighbour (the step tightens as the hand grows, so 10 fit in
 * `maxSpan`), tilted a little about the fan's centre and dipped on a gentle arc. Stage px at the reference scale.
 */
export function oppHandFan(i: number, n: number, opts: { cardW: number; maxSpan: number; maxStep: number; tiltDeg: number; arcPx: number }): { x: number; y: number; rot: number } {
  if (n <= 1) return { x: 0, y: 0, rot: 0 };
  const step = Math.min(opts.maxStep, (opts.maxSpan - opts.cardW) / (n - 1));
  const c = i - (n - 1) / 2;
  const t = c / ((n - 1) / 2); // -1 .. 1
  return { x: c * step, y: opts.arcPx * t * t, rot: opts.tiltDeg * t };
}
