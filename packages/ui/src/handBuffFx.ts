import { CARD_INDEX } from '@game/content';
import { canPlayDefs, playDef } from './fx/playDef';
import { cascade, scheduleLands } from './fx/land';
import { RUBY_GAP_MS } from './choreo/channels/rubyLanded';

/**
 * The HAND BUFF cue's fire-from-anywhere bus (owner ask 2026-09-15).
 *
 * A card IN HAND just got stronger — a minion gaining stats (Hearth Whisperer, Nurturer, Shared Spirit, Hand
 * Soap, Rising Tide's hand half, …) or a spell / Ruby / Clue / token whose printed value went up (spell power,
 * Ruby strength, "your next Shop spell +2/+2", Front to Back's escalation, …) — and the owner-authored
 * `hand-buff` def plays ON that hand card: two shard bursts off the card plus a `react` layer that pops the
 * card itself (`part: "card"`, `reach: "self"`).
 *
 * It REPLACED the `spellBuffFx` bus + `Card.tsx`'s `.spellbuff` grow/shrink + `.sbsparks` CSS-mote blast (the
 * ✨ Spell Buff tuner's cue, 2026-07-23 → 2026-09-15), which only ever played on spells and Rubies — a MINION
 * buffed in hand played nothing in the shop (the generic green `.cardbuff` flash was retired 2026-08-04 and
 * `captureBuffFx` diffs the board only) and only its badge rolled in combat. One def now covers every hand
 * card, on every surface, through one entry point.
 *
 * The contract is the same as the bus it replaced: **`fireHandBuff([uid])` from literally anywhere** (a React
 * effect, a combat-replay beat, an End-of-Turn presenter) and the mounted hand card with that uid plays the
 * cue. A uid not on screen is a harmless no-op. Several uids fire as a left→right CASCADE spaced by the same
 * gap the shop's other multi-recipient cues use (`RUBY_GAP_MS`), one `hand-buff` play PER CARD — never one
 * batched play — so a Rising Tide over four held minions reads as four hits, not one.
 */

/** The def this bus plays. Kept as a named constant for tests and the direct-call scan's neighbours; the
 *  `playDef` call below spells the id as a LITERAL on purpose, so `fx/directCallScan.ts` can attribute it. */
export const HAND_BUFF_DEF_ID = 'hand-buff';

/** Spacing between successive hand cards buffed by ONE event. The shop's cascade gap, reused not re-tuned. */
export const HAND_BUFF_GAP_MS = RUBY_GAP_MS;

/** Every pending staggered land, so a torn-down board can cancel the ones still queued. */
const pending = new Set<ReturnType<typeof setTimeout>>();

/** The hand card element for a uid, or `null` when it isn't on screen (drawn this frame, played, sold). Scoped to
 *  the HAND zone: a uid is unique across zones, but the hand is the only place this cue belongs. */
export function handCardElement(uid: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`[data-zone="hand"] .card[data-uid="${uid}"]`);
}

/** Play `hand-buff` on ONE hand card, now. Exported for the beat presenters that already own their timing. */
export function playHandBuffOn(uid: string): void {
  const el = handCardElement(uid);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  // Literal id (not HAND_BUFF_DEF_ID) so the directCalls scanner — a text pass over literal `playDef` calls,
  // see fx/directCallScan.ts — can attribute this site.
  playDef('hand-buff', { source: at, target: at }, { uids: { source: uid, target: uid } });
}

/**
 * Play the hand-buff cue on these hand cards — one play per card, cascaded left→right in the order given.
 * Safe to call from any phase, any surface, and as often as you like: a second buff landing mid-cue simply
 * plays a second instance over the first (every trigger reads as its own hit — owner 2026-07-24).
 *
 * Returns a teardown that cancels the lands still queued; fire-and-forget callers may ignore it.
 */
export function fireHandBuff(uids: readonly string[]): () => void {
  if (uids.length === 0 || !canPlayDefs()) return () => {};
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const land of scheduleLands(cascade(uids.map((uid) => ({ uid }))), { gap: HAND_BUFF_GAP_MS })) {
    if (land.at <= 0) { playHandBuffOn(land.uid); continue; }
    const t = setTimeout(() => { pending.delete(t); playHandBuffOn(land.uid); }, land.at);
    pending.add(t);
    timers.push(t);
  }
  return () => { for (const t of timers) { clearTimeout(t); pending.delete(t); } };
}

/** Drop every queued land — used when the board is torn down (run reset / screen change) so a pending timer
 *  can't fire the cue onto a card that has since been replaced at the same uid. */
export function clearAllHandBuffs(): void {
  for (const t of pending) clearTimeout(t);
  pending.clear();
}

/** A hand card, reduced to what these helpers need. */
interface HandLike { uid: string; cardId: string }

/** Pop every SPELL in hand — the cards whose printed value moves when SPELL POWER rises. */
export function fireHandBuffOnHandSpells(hand: readonly HandLike[]): void {
  fireHandBuff(hand.filter((c) => CARD_INDEX[c.cardId]?.spell).map((c) => c.uid));
}

/** Pop every RUBY in hand — the cards whose printed value moves when RUBY STRENGTH rises.
 *  Matched on the card def's `ruby` FLAG, never on a card id: there is more than one Ruby (`ruby`,
 *  `warding-ruby`, and any future one), so an id check silently skips the others. */
export function fireHandBuffOnHandRubies(hand: readonly HandLike[]): void {
  fireHandBuff(hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).map((c) => c.uid));
}

/** What the shop watcher reads off one rendered hand card to decide whether it "got stronger". */
export interface HandBuffView {
  uid: string;
  spell?: boolean;
  ruby?: boolean;
  text: string;
  attack: number;
  health: number;
}

/**
 * PURE: which hand cards got stronger between two renders, and the signatures to remember for the next one.
 *
 * A spell / Ruby's STATS never change (it's a 0/1 card) — its printed VALUE is what moves — so those diff the
 * rendered live text plus stats, which catches every scaling source at once (spell power, Front to Back's
 * escalation, the Ruby stat line, a "next Shop spell +2/+2" grant, …) without enumerating them. A minion (or
 * any other card) diffs its stats and fires only on a GAIN, so a Clue resolving or a quest counter ticking in
 * its text is never mistaken for a buff. Only a card ALREADY tracked can fire, so drawing a card never flashes.
 */
export function diffHandBuffs(
  prev: ReadonlyMap<string, string>,
  views: Iterable<HandBuffView>,
): { next: Map<string, string>; changed: string[] } {
  const next = new Map<string, string>();
  const changed: string[] = [];
  for (const v of views) {
    const valueCard = !!v.spell || !!v.ruby;
    const sig = valueCard ? `${v.text}|${v.attack}/${v.health}` : `${v.attack}/${v.health}`;
    next.set(v.uid, sig);
    const p = prev.get(v.uid);
    if (p === undefined || p === sig) continue;
    if (valueCard) { changed.push(v.uid); continue; }
    const [pa, ph] = p.split('/').map(Number);
    if (v.attack + v.health > (pa ?? 0) + (ph ?? 0)) changed.push(v.uid);
  }
  return { next, changed };
}
