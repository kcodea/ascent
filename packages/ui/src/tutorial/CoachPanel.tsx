/**
 * TUTORIAL — the coach panel.
 *
 * The small anchored card that carries one coached beat: title + body, an optional "Why" rationale (blueprint
 * keeps the three copy layers separate), an optional keyword chip, and an optional Next button. It floats just
 * above the focus mask (z ~601) and IS interactive (`pointer-events: auto`) so the player can expand "Why" or
 * click Next.
 *
 * PLACEMENT is pure and cheap: from the already-cached `anchorRect` we compute a single `{top,left}` per
 * render — below the anchor if there's room, else above, clamped to the viewport with a ~14px gap. No layout
 * reads here (the rect came from the registry's measure-once cache). A null rect = a centered foundation-style
 * panel.
 *
 * Copy renders as PLAIN TEXT only (`{body}` children) — no HTML injection. Text is free to wrap and grow for
 * localization; nothing is truncated and nothing dismisses on a timer.
 */

import { useState } from 'react';
import type { TutorialFocusMode } from '@game/sim';

/** Estimated panel box used for viewport clamping. The panel itself sizes to content via CSS `max-width`;
 *  these are just the bounds we clamp the computed origin against so it never spills off-screen. */
const PANEL_W = 320;
const PANEL_H = 260; // kept in step with `--tut-scale` in tutorialCoach.css (1.3 × the old 200 reserve)
const GAP = 14;
const MARGIN = 12;

/** The stage scale the rest of the UI multiplies its authored sizes by (`--scale`, set by Game.tsx). A design-px
 *  nudge is multiplied by this so it moves the same visual distance at every resolution. */
function stageScale(): number {
  if (typeof document === 'undefined') return 1;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Compute a fixed {top,left} for the panel from a cached anchor rect. Below if it fits, else above, then
 *  clamp into the viewport. Returned centered when there is no anchor. An optional authored `nudge` (design px)
 *  shifts the placed panel before the final clamp — a last-resort tweak for a panel covering its own target. */
function placePanel(rect: DOMRect | null, nudge?: { dx?: number; dy?: number }): { top: number; left: number; centered: boolean } {
  if (typeof window === 'undefined' || !rect) {
    return { top: 0, left: 0, centered: true };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal: centre the panel on the anchor. But when the anchor HUGS a viewport edge — a full-height side
  // rail like the lobby rail — centring would push the panel off that edge and the clamp would jam it right up
  // against the rail (reading as "under" it, not beside it). In that case sit the panel just to the anchor's
  // inner side instead, on whichever side has the room, so it reads as a card set beside the rail.
  let left = rect.left + rect.width / 2 - PANEL_W / 2;
  const spaceLeft = rect.left;
  const spaceRight = vw - rect.right;
  if (left + PANEL_W + MARGIN > vw && spaceLeft > spaceRight) {
    left = rect.left - GAP - PANEL_W; // anchor on the right edge → panel to its left
  } else if (left < MARGIN && spaceRight > spaceLeft) {
    left = rect.right + GAP; // anchor on the left edge → panel to its right
  }
  left = Math.max(MARGIN, Math.min(left, vw - PANEL_W - MARGIN));

  // Vertical: prefer below the anchor; flip above if it would overflow the bottom.
  const belowTop = rect.bottom + GAP;
  const aboveTop = rect.top - GAP - PANEL_H;
  let top: number;
  if (belowTop + PANEL_H + MARGIN <= vh) top = belowTop;
  else if (aboveTop >= MARGIN) top = aboveTop;
  else top = Math.max(MARGIN, Math.min(belowTop, vh - PANEL_H - MARGIN));

  // Authored nudge (design px → screen px), applied last and re-clamped so it can never push off-screen.
  if (nudge && (nudge.dx || nudge.dy)) {
    const s = stageScale();
    left = Math.max(MARGIN, Math.min(left + (nudge.dx ?? 0) * s, vw - PANEL_W - MARGIN));
    top = Math.max(MARGIN, Math.min(top + (nudge.dy ?? 0) * s, vh - PANEL_H - MARGIN));
  }

  return { top, left, centered: false };
}

export function CoachPanel(props: {
  anchorRect: DOMRect | null;
  title?: string;
  body: string;
  why?: string;
  focusMode?: TutorialFocusMode;
  keyword?: string;
  onNext?: () => void;
  nextLabel?: string;
  step?: number;
  total?: number;
  nudge?: { dx?: number; dy?: number };
}): JSX.Element {
  const { anchorRect, title, body, why, focusMode, keyword, onNext, nextLabel, step, total, nudge } = props;
  const [whyOpen, setWhyOpen] = useState(false);

  const place = placePanel(anchorRect, nudge);
  // A centered panel (no anchor — e.g. the runeforge beat, whose full-screen overlay resolves no rect) gets the
  // nudge folded into its centering transform; an anchored panel already had it applied + clamped in placePanel.
  const s = stageScale();
  const cdx = (nudge?.dx ?? 0) * s;
  const cdy = (nudge?.dy ?? 0) * s;
  const style: React.CSSProperties = place.centered
    ? { top: '50%', left: '50%', transform: `translate(calc(-50% + ${cdx}px), calc(-50% + ${cdy}px))` }
    : { top: place.top, left: place.left };

  const showCounter = step != null && total != null && total > 0;

  return (
    <div
      className={`tut-coach-panel${place.centered ? ' centered' : ''}`}
      style={style}
      role="dialog"
      aria-label={title ?? 'Tutorial'}
      data-focus-mode={focusMode}
    >
      {(title || showCounter) && (
        <div className="tut-coach-head">
          {title && <span className="tut-coach-title">{title}</span>}
          {showCounter && (
            <span className="tut-coach-count" aria-label={`Step ${step} of ${total}`}>
              {step}/{total}
            </span>
          )}
        </div>
      )}

      <p className="tut-coach-body">{body}</p>

      {keyword && <span className="tut-keyword">{keyword}</span>}

      {why && (
        <div className="tut-coach-why">
          <button
            type="button"
            className="tut-coach-why-toggle pressable"
            aria-expanded={whyOpen}
            onClick={() => setWhyOpen((o) => !o)}
          >
            <span className="tut-coach-why-chev" aria-hidden="true">{whyOpen ? '▾' : '▸'}</span>
            Why
          </button>
          {whyOpen && <p className="tut-coach-why-body">{why}</p>}
        </div>
      )}

      {onNext && (
        <div className="tut-coach-actions">
          <button type="button" className="tut-coach-next pressable" onClick={onNext}>
            {nextLabel ?? 'Next'}
          </button>
        </div>
      )}
    </div>
  );
}
