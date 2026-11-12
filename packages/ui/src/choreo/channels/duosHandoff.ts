/**
 * THE DUOS HAND-OFF (R-DUOS-TAGTEAM-01; 2026-11-10, owner: "make the beats much stronger for duos").
 *
 * Three engine events make the tag-team moment, each already its own beat with its own hold (`choreoConfig.ts`):
 *  - `boardFallen`: a side's first board is gone (a breath before the reserve);
 *  - `tagIn`: the teammate's board flies in and takes the row;
 *  - `flyIn`: the fight is won and the teammate's unfought board joins the survivors.
 * Until now all three played nothing but the units' own CSS entrance. This channel gives each a SOUND
 * (`channels/sfx.ts`, read from here) and a one-shot ACCENT on the board it happens to, built only from effects the
 * game already had:
 *  - a fallen board: one soft shadow falling over its row (a static gradient, opacity and scale only), in the pause
 *    that already sat between the fallen board and the reserve. Nothing is lengthened (`clock.ts`). (The lobby's
 *    knockout veil was tried here first: it is sized for a rail row and read as three small puffs on a board.)
 *  - a tag-in: each body lands in the summon's own `landing-dust`, and the board shake a death already uses plays as
 *    the LAST one touches down. (Until 2026-11-12 the last landing also drew a team-coloured `ground-slam` ring.)
 *  - a fly-in: the landing dust only (nothing is at stake any more).
 *
 * It never computes an outcome: who fell and who arrives is read off the events. Everything is timed by the fight's
 * LIVE speed, so 2x and a Skip play the same beat faster and land on the same row.
 *
 * NOT here, on purpose (owner 2026-10-26, undecided): no ownership marker on a minion, no "steps in" plate, no name
 * on the portrait.
 */
import { canPlayDefs, playDef } from '../../fx/playDef';
import { cardFxScale } from '../../fx/cardScale';
import { tagLandMs, tagLastLandMs, tagOrder, type Handoff } from './duosHandoffTiming';

export * from './duosHandoffTiming';

const reducedMotion = (): boolean => {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export interface HandoffFxContext {
  /** The fight's live speed (the cue's own divide). */
  speed: number;
  /** A body's SLOT (its `.unit`, never its flying card), screen px. */
  slotRectOf: (uid: string) => { cx: number; cy: number; w: number; h: number } | null;
  /** Run `fn` after `ms`, on the moment's own timer list (cleared when the fight leaves). */
  later: (fn: () => void, ms: number) => void;
  /** The board shake (the one a death plays). */
  shake: () => void;
}

/** Play the moment's hand-off accents. Returns how many it started (0 when the moment has none, or nothing can draw). */
export function playHandoffFx(handoffs: readonly Handoff[], ctx: HandoffFxContext): number {
  if (!handoffs.length || typeof document === 'undefined') return 0;
  const speed = ctx.speed > 0 ? ctx.speed : 1;
  const calm = reducedMotion();
  const defs = canPlayDefs();
  let n = 0;
  for (const h of handoffs) {
    // A FALLEN BOARD draws nothing (owner 2026-11-12: "the shadow looks off"). It used to dim its row with a dark
    // gradient; the beat is now its sound and the short pause before the reserve drops.
    if (h.kind === 'boardFallen') continue;
    // tagIn / flyIn: dust under each body as it lands, read once, now (the slots are laid out; the cards are flying).
    const rects = h.uids.map((uid) => ctx.slotRectOf(uid));
    const count = h.uids.length;
    if (defs && !calm) {
      h.uids.forEach((uid, i) => {
        const b = rects[i];
        if (!b || b.w < 1 || b.h < 1) return;
        const at = { x: b.cx, y: b.cy };
        ctx.later(() => { playDef('landing-dust', { source: at, target: at }, { scale: cardFxScale(b.w), uids: { source: uid, target: uid } }); },
          tagLandMs(tagOrder(h.side, i, count), speed));
      });
    }
    // THE RING IS GONE (owner 2026-11-12: "the ring is bad"). A tag-in used to end on the Versus room's `ground-slam`
    // stretched under the whole board in the team's colour. The landing is now each body's own dust and one short
    // board shake as the last one touches down.
    if (h.kind === 'tagIn' && !calm) ctx.later(() => { ctx.shake(); }, tagLastLandMs(count, speed));
    n += 1;
  }
  return n;
}
