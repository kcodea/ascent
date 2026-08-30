import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RuneDef } from '@game/core';
import { RuneCard } from './RuneCard';
import { RUNE_LOCKIN_DEFAULTS, lockInTotalMs, type RuneLockInTiming } from './runeLockInTiming';

/**
 * RUNE LOCK-IN CEREMONY (owner ask 2026-08-29).
 *
 * *"i want the runes to disappear, and the selected rune to move front and center, and 'lock in' then fade
 * back to the normal game board … no additional clicks needed, just a short ceremony animation."*
 *
 * ── The gameplay has ALREADY happened ─────────────────────────────────────────────────────────────────────
 *
 * The buy dispatches immediately; this plays over the top. That ordering is deliberate and it is the same one
 * the rest of the game uses: presentation never gates a state transition. A ceremony that had to finish
 * before the rune was yours would be a ceremony that could eat the purchase if it were interrupted — a
 * reload, an error, a fast Esc — and "my rune vanished" is a far worse bug than "the animation was cut off".
 *
 * ── Why it renders CLONES ─────────────────────────────────────────────────────────────────────────────────
 *
 * Because the buy resolves first, `run.runeforgeOffer` clears and the real forge overlay unmounts on the same
 * frame. There is nothing left on screen to animate. So the ceremony captures every card's rect at click time
 * and re-renders the cards itself, pinned to those exact positions — the swap is invisible because the clones
 * open exactly where the originals were, and from there the layer owns the whole sequence.
 *
 * The clones are inert: `onBuy` is a no-op and the layer is `pointer-events: none`. Nothing here can be
 * clicked, which is what "no additional clicks needed" has to mean in practice.
 *
 * ── Perf ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Every motion is `transform` + `opacity` (compositor-only), and every one of them is ONE-SHOT — CLAUDE.md's
 * ban is on looping paint animations. Rects are read ONCE, at the click, and never re-read; the layer is
 * portalled to `<body>` so it sits above the FX canvas without fighting `.app`'s stacking context (the trap
 * `docs/performance.md` §4 documents).
 */

/** What the ceremony needs to know about one card on screen when the click happened. */
export interface RuneLockInCard {
  rune: RuneDef;
  cost: number;
  /** Viewport rect at click time. Read once — never re-measured. */
  rect: { x: number; y: number; w: number; h: number };
  chosen: boolean;
}

export interface RuneLockInProps {
  cards: RuneLockInCard[];
  onDone: () => void;
  /** Dev tuner override. Production always plays the defaults. */
  timing?: RuneLockInTiming;
}

/** Phase names exist so the CSS reads as the story rather than as a pile of class toggles. */
type Phase = 'press' | 'focus' | 'locked' | 'leaving';

export function RuneLockIn({ cards, onDone, timing = RUNE_LOCKIN_DEFAULTS }: RuneLockInProps): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('press');
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const t = timing;
    const timers = [
      window.setTimeout(() => { setPhase('focus'); }, t.focusDelayMs),
      window.setTimeout(() => { setPhase('locked'); }, t.lockAtMs),
      window.setTimeout(() => { setPhase('leaving'); }, t.holdMs),
      // The caller unmounts us here. Driven by a timer rather than `animationend` on purpose: the fade is on
      // several elements at once, so "the last one finished" would mean racing a set of events for no gain,
      // and a dropped event would strand the layer on screen forever.
      window.setTimeout(() => { doneRef.current(); }, lockInTotalMs(t)),
    ];
    return () => { timers.forEach(window.clearTimeout); };
  }, [timing]);

  /** Where the chosen card ends up: the middle of the viewport, grown. */
  const centre = useMemo(() => {
    const chosen = cards.find((c) => c.chosen);
    if (!chosen) return null;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const from = chosen.rect;
    return {
      // Translate by the delta between the card's own centre and the screen's — so the card travels from
      // exactly where it sat, with no layout dependency and no second measurement.
      dx: cx - (from.x + from.w / 2),
      dy: cy - (from.y + from.h / 2),
    };
  }, [cards]);

  if (!centre) return null;

  return createPortal(
    <div className={`runelock runelock-${phase}`} aria-hidden="true">
      {/* The veil that pulls the board back so the chosen rune reads as the only thing on screen. */}
      <div className="runelock-veil" />
      {cards.map((c, i) => {
        const style = {
          left: `${c.rect.x}px`,
          top: `${c.rect.y}px`,
          // NO width/height. The wrapper SHRINK-WRAPS its card, so its box is the card's box by construction
          // and the travel delta (computed from the captured rect) lands the card's own centre on the
          // screen's. Forcing the captured size instead made the wrapper the authority on how big a card is —
          // and any disagreement showed up as the card sitting off-centre INSIDE a correctly-centred box,
          // which is exactly what the dev demo surfaced.
          '--rl-w': `${c.rect.w}px`,
          // The unchosen sweep out one after another; the chosen one has no stagger to wait through.
          '--rl-delay': `${c.chosen ? 0 : i * timing.exitStaggerMs}ms`,
          '--rl-exit': `${timing.exitMs}ms`,
          '--rl-focus': `${timing.focusMs}ms`,
          '--rl-settle': `${timing.settleMs}ms`,
          '--rl-fade': `${timing.fadeMs}ms`,
          '--rl-dx': `${centre.dx}px`,
          '--rl-dy': `${centre.dy}px`,
          '--rl-clamp': `${timing.clampMs}ms`,
          '--rl-flash': `${timing.flashMs}ms`,
          // The clamp closes INTO the lock beat rather than starting on it (see `clampMs`), so it is armed on
          // the FOCUS phase and delayed to land exactly as the settle fires. Measured from when `focus`
          // begins, because that is when the class that starts the animation appears.
          '--rl-clamp-delay': `${Math.max(0, timing.lockAtMs - timing.clampMs - timing.focusDelayMs)}ms`,
        } as React.CSSProperties;
        return (
          <div key={`${c.rune.id}-${i}`} className={`runelock-card${c.chosen ? ' chosen' : ' other'}`} style={style}>
            {/* Inert clone — the real card is already gone, and nothing here may be clicked. */}
            <RuneCard rune={c.rune} cost={c.cost} affordable onBuy={() => { /* inert clone */ }} />
            {/* THE CLAMP AND THE FLASH live INSIDE the chosen card's wrapper, so they inherit its travel and
                its scale for free — no second set of coordinates to keep in step with the card's, and no
                chance of the frame arriving anywhere but exactly on the rune. */}
            {c.chosen && (
              <>
                <span className="runelock-clamp" aria-hidden="true" />
                <span className="runelock-flash" aria-hidden="true" />
              </>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
