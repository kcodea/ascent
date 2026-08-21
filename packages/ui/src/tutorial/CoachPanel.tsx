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

/** Compute a fixed {top,left} for the panel from a cached anchor rect. Below if it fits, else above, then
 *  clamp into the viewport. Returned centered when there is no anchor. */
function placePanel(rect: DOMRect | null): { top: number; left: number; centered: boolean } {
  if (typeof window === 'undefined' || !rect) {
    return { top: 0, left: 0, centered: true };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal: centre the panel on the anchor, then clamp.
  let left = rect.left + rect.width / 2 - PANEL_W / 2;
  left = Math.max(MARGIN, Math.min(left, vw - PANEL_W - MARGIN));

  // Vertical: prefer below the anchor; flip above if it would overflow the bottom.
  const belowTop = rect.bottom + GAP;
  const aboveTop = rect.top - GAP - PANEL_H;
  let top: number;
  if (belowTop + PANEL_H + MARGIN <= vh) top = belowTop;
  else if (aboveTop >= MARGIN) top = aboveTop;
  else top = Math.max(MARGIN, Math.min(belowTop, vh - PANEL_H - MARGIN));

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
}): JSX.Element {
  const { anchorRect, title, body, why, focusMode, keyword, onNext, nextLabel, step, total } = props;
  const [whyOpen, setWhyOpen] = useState(false);

  const place = placePanel(anchorRect);
  const style: React.CSSProperties = place.centered
    ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
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
