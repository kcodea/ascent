// packages/ui/src/choreo/buffSource.ts

/** Where a buff-other's ribbon leaves FROM, resolved the same way in both phases. */
export interface ResolvedBuffSource {
  /** The point the tendril streams from — the live body, else the slot the body last stood in. */
  center?: { x: number; y: number };
  /** No slot at all (a hero-power / rune LABEL, or a body that was never on screen): draw nothing. */
  sourceless: boolean;
  /** Which of the two the centre came from — for tests and for callers that time a fallen source differently. */
  from: 'live' | 'lastSlot' | 'none';
}

/**
 * A FALLEN SOURCE STILL HAS A SLOT (owner report 2026-09-16: "Dawn Sentinel isn't triggering the tendril").
 *
 * An Echo buffer is dead by the time its buff plays — in combat the body left the DOM after its death beat, in
 * the shop a destroyed / sold / borrowed card is gone by the time its capture replays — so a live measurement
 * finds nothing. Until this, every such buff was routed SOURCELESS, whose rain-down was stripped on 2026-09-02
 * with nothing authored in its place: Dawn Sentinel, Noggin, Sergey, Grim, Armadiyo, Imp King, Trickster, a
 * Reveler's sell … all landed their gifts with NO cue. Both phases keep a last-known slot per body (combat:
 * `lastRectRef`, refreshed each beat while the body is still up; shop: the departure cache built from the
 * previous render's centres), so the ribbon streams from where the card fell.
 *
 *   · `label`  — the source names no body at all (`'United Front'`, `'Rune of …'`): sourceless, as before.
 *   · live     — the body is on screen: its centre (callers pass a RESTING centre in the shop).
 *   · lastSlot — the body is gone but its slot is known: that slot.
 *   · none     — never rendered (a summon that died in its own beat): sourceless.
 */
export function resolveBuffSource(o: {
  label: boolean;
  live: () => { x: number; y: number } | null | undefined;
  lastSlot: () => { x: number; y: number } | null | undefined;
}): ResolvedBuffSource {
  if (o.label) return { sourceless: true, from: 'none' };
  const live = o.live();
  if (live) return { center: live, sourceless: false, from: 'live' };
  const last = o.lastSlot();
  if (last) return { center: last, sourceless: false, from: 'lastSlot' };
  return { sourceless: true, from: 'none' };
}
