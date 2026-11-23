/**
 * CINDY × ANCIENT OF BONDS: LINKED CARDS (Duos only, owner 2026-11-14, R-ANCCINDY-06).
 *
 *   "The copies of your cards are Linked. When one gains stats, the other does too."
 *
 * The pair is the minion Cindy's teammate bought and the Gilded copy Golden Gratitude sent Cindy. The two cards live on
 * TWO runs (two players), so the link is data on each card (`BoardCard.duosLink`: the link id, the same on both runs,
 * and the stats last mirrored) and a mirrored gain travels between the runs as a team effect on the pass channel.
 *
 * THE RULES AS BUILT
 *  - SHOP (either run): a stat GAIN on a linked card (board, hand, or a card waiting for hand room) is measured at the
 *    reducer's action boundary (`duosLinkSync`, from `settleAction`) against the card's baseline, and sent to the twin's
 *    run as ONE `linkGain` per link per action. The receiver's twin gains it (`receiveLinkGain`), permanently, with its
 *    buff FX, and its baseline moves by the same amount, so a mirrored gain is NEVER sent back (no ping-pong). Only
 *    gains move: a stat that went down is re-based silently.
 *  - GILDING either copy does not break the link and is not a gain: a Gild's doubled base (`gildMinion`, the printed
 *    stats once more) is taken off the measured change when the card turned Gilded since the baseline. A triple that
 *    consumes a linked card hands the link to the Golden it makes (`carryDuosLinkIntoTriple`), re-based on its stats.
 *  - COMBAT, the same permanence as the original (owner ruling): a combat-only gain stays combat-only on the twin; a
 *    gain the body KEEPS (Engraved, or a permanent combat gain) stays permanent on the twin.
 *      · The combat-only half: in a tag-team fight the twin can only be reached while it is the side's waiting
 *        RESERVE (its board has not stepped in yet). The simulator adds the gain to the reserve's per-fight locked
 *        copy (`QuestCombatMods.duosLinks`, Pep Talk's rule), so the twin steps in that much bigger. One hop. When the
 *        twin's board already fought (it went first), or the twin is in a hand, it is not in that fight: a
 *        combat-only gain has nothing to reach and expires with the fight, as every combat-only gain does.
 *      · The permanent half: a kept combat gain lands on the run card at settle, which is an action like any other,
 *        so `duosLinkSync` sends it to the twin's run after the fight (the earliest correct boundary: the other run's
 *        card is not in this run's `simulate` at all, and a reserve body's run settles from its own carry-backs).
 *  - THE LINK ENDS when either twin leaves its run (sold, destroyed, consumed, passed, swapped into the Shop): the run
 *    that lost it sends `linkEnd`, both cards drop the "Linked" line, and the id is remembered as ended so a card that
 *    comes back (a refunded pass) never re-links on its own. A passed card never travels Linked (`duosWireOf`).
 *  - RANKED DUOS: both teammates are live runs, so it works exactly as in Versus Duos. A recorded (snapshot) team that
 *    is served as an opponent fights with the permanent stats its runs had, and its locked sides carry their
 *    `duosLinks`, so its reserve mirror runs inside the fight too (the rule is symmetric); nothing is sent anywhere.
 *
 * Every hook returns at once on a run that holds no linked card, so every other run is byte-identical.
 */
import { CARD_INDEX } from '@game/content';
import type { QuestCombatMods } from '@game/core';
import { addBuff, captureBuffFx } from './recruit';
import { queueTeamEffect } from './duosPass';
import type { BoardCard, RunState } from './state';

/** The buff label a mirrored gain carries (the inspect breakdown). */
export const LINKED_LABEL = 'Linked';

/** A link's baseline: the card's stats and Gilded flag right now. */
export function linkBaseline(id: string, card: Pick<BoardCard, 'attack' | 'health' | 'golden'>): NonNullable<BoardCard['duosLink']> {
  return { id, a: card.attack, h: card.health, ...(card.golden ? { g: true as const } : {}) };
}

/** Every card a link can sit on: the board, the hand, and the effect passes waiting for hand room. */
function linkedHolders(s: RunState): BoardCard[] {
  return [...s.board, ...s.hand, ...(s.duos?.waiting ?? []).map((w) => w.card)];
}

/** Is this card one of a Linked pair (the "Linked" line on its text)? */
export function isLinkedCard(card: Pick<BoardCard, 'duosLink'>): boolean {
  return !!card.duosLink;
}

/**
 * THE ACTION BOUNDARY (`settleAction`, every action the settle included). Measure each linked card's gain since its
 * baseline and send it to the twin's run; notice a twin that left this run and end the link on both. A no-op (nothing
 * read or written) on a run that holds no link.
 */
export function duosLinkSync(s: RunState): void {
  const holders = linkedHolders(s);
  if (!s.duosLinkIds?.length && !holders.some((c) => c.duosLink)) return;
  const ended = new Set(s.duosLinkEnded ?? []);
  const present: string[] = [];
  for (const c of holders) {
    const l = c.duosLink;
    if (!l) continue;
    // Not a team game any more, an ended link, or a second card holding the same id (a copy of a linked card: only
    // the first one found keeps it): no link.
    if (!s.duos || ended.has(l.id) || present.includes(l.id)) { c.duosLink = undefined; continue; }
    present.push(l.id);
    const def = CARD_INDEX[c.cardId];
    const gilded = c.golden && !l.g; // a Gild since the baseline: its doubled base is not a gain
    const da = c.attack - (gilded ? def?.attack ?? 0 : 0) - l.a;
    const dh = c.health - (gilded ? def?.health ?? 0 : 0) - l.h;
    if (da > 0 || dh > 0) queueTeamEffect(s, { kind: 'linkGain', id: l.id, attack: Math.max(0, da), health: Math.max(0, dh) });
    if (l.a !== c.attack || l.h !== c.health || !!l.g !== !!c.golden) c.duosLink = linkBaseline(l.id, c); // re-base (writes only on a change)
  }
  for (const id of s.duosLinkIds ?? []) {
    if (present.includes(id)) continue;
    queueTeamEffect(s, { kind: 'linkEnd', id }); // my twin left my run: the link is over on both
    (s.duosLinkEnded ??= []).push(id);
  }
  const same = (s.duosLinkIds?.length ?? 0) === present.length && present.every((id) => s.duosLinkIds!.includes(id));
  if (!same) s.duosLinkIds = present.length > 0 ? present : undefined;
}

/** The most one mirrored gain may give (the payload comes from another client). */
const LINK_GAIN_CAP = 100_000; // Broshake's clamp: wide, finite, never negative
const clampGain = (v: unknown): number => Math.min(LINK_GAIN_CAP, Math.max(0, Math.floor(typeof v === 'number' && Number.isFinite(v) ? v : 0)));

/** THE TWIN'S RUN: my twin of link `id` gained stats. Mine gains them too (permanently, with its buff FX), and its
 *  baseline moves by exactly that much, so this gain is never sent back. Nothing linked by that id: nothing. */
export function receiveLinkGain(s: RunState, id: string, attack: unknown, health: unknown): void {
  const a = clampGain(attack), h = clampGain(health);
  if (a <= 0 && h <= 0) return;
  const card = linkedHolders(s).find((c) => c.duosLink?.id === id);
  if (!card?.duosLink) return;
  const shown = s.board.includes(card) || s.hand.includes(card); // a card waiting for hand room is not on screen yet
  const before = { a: card.attack, h: card.health };
  if (shown) captureBuffFx(s, undefined, 'spell', () => addBuff(card, LINKED_LABEL, a, h));
  else addBuff(card, LINKED_LABEL, a, h);
  // What really landed (Deep Slumber doubles a held twin's gain), so nothing of it is ever sent back.
  card.duosLink = { ...card.duosLink, a: card.duosLink.a + card.attack - before.a, h: card.duosLink.h + card.health - before.h };
}

/** THE TWIN'S RUN: my twin of link `id` left its run. The link is over: my card drops it, for good. */
export function receiveLinkEnd(s: RunState, id: string): void {
  for (const c of linkedHolders(s)) if (c.duosLink?.id === id) c.duosLink = undefined;
  if (s.duosLinkIds?.includes(id)) {
    const rest = s.duosLinkIds.filter((x) => x !== id);
    s.duosLinkIds = rest.length > 0 ? rest : undefined;
  }
  if (!(s.duosLinkEnded ?? []).includes(id)) (s.duosLinkEnded ??= []).push(id);
}

/** A TRIPLE consumed a linked card: the Golden it made carries the link on (owner: gilding never breaks it), re-based
 *  on its own stats (the combine is not a gain). */
export function carryDuosLinkIntoTriple(consumed: readonly BoardCard[], golden: BoardCard): void {
  const l = consumed.find((c) => c.duosLink)?.duosLink;
  if (l) golden.duosLink = linkBaseline(l.id, golden);
}

/** COMBAT: this run's linked BOARD cards, for the simulator's reserve mirror and the "Linked" line (undefined: none). */
export function duosLinkMods(s: RunState): QuestCombatMods['duosLinks'] {
  // `?? []`: a projected state (a replay frame's odds probe) may carry no board.
  const out = (s.board ?? []).filter((c) => c.duosLink).map((c) => ({ id: c.duosLink!.id, uid: c.uid }));
  return out.length > 0 ? out : undefined;
}
