/**
 * THE MODE SCREEN'S VIEW SWAP (owner 2026-10-21, R-MENU-VIEW-SWAP-01): "clicking into gauntlet, learn, and versus all
 * have a glitchy flash of the 'play modes' before entering their view. practice does a quick fade out/in of the full
 * ui. ... it should be a clean, seamless menu shift going into the different views."
 *
 * The mode home and its views (Practice, Gauntlet, Learn, Versus) share ONE host (`.modepick.sb-host.mp-shell` in
 * Title.tsx): the sidebar, the painted backdrop and the scroller stay put, and only the content beside the sidebar
 * changes. This component is that content. Each view is a `.mpview` layer; when the view changes, the outgoing layer
 * stays mounted until its exit animation ends, wearing `.mpv-out` (fades and lifts a few px, inert) while the incoming one wears
 * `.mpv-in` (rises and fades in, a beat later), both in the same grid cell, so there is never an empty frame, never a
 * frame of the old view at full opacity over the new one, and never a full-screen fade. Motion is opacity + transform
 * on the content box only (styles.css "THE MODE SCREEN'S VIEW SWAP").
 *
 * The outgoing layer is the SAME DOM node it was a moment ago (same React key), so nothing inside it remounts or
 * replays an entrance. A same-view re-key (`nonce`, the sidebar's Play while already on the home) just remounts the
 * view, which replays its own entrance, as before.
 *
 * Reduced motion (or no media queries at all, e.g. jsdom): an instant switch, no outgoing layer.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** The outgoing view leaves when its `.mpv-out` animation (0.14 s) ENDS, so a slow frame can never cut it off half
 *  faded. This is the backstop for when no exit animation runs (an empty view, no CSS, a test environment). */
export const VIEW_EXIT_MS = 160;

const animated = (): boolean => typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Shown<V extends string> { view: V; key: string; entering: boolean }

export function MenuViewSwap<V extends string>({ view, nonce, render, viewClass }: {
  view: V;
  /** Re-keys the view without counting as a change of view (it remounts, no outgoing layer). */
  nonce?: string | number;
  render: (view: V) => ReactNode;
  viewClass: (view: V) => string;
}) {
  const key = `${view}:${nonce ?? ''}`;
  const [shown, setShown] = useState<Shown<V>>({ view, key, entering: false });
  const [leaving, setLeaving] = useState<{ view: V; key: string } | null>(null);
  // Derived during render (React's "adjust state when a prop changes" pattern): React re-runs this render with the
  // new state before anything commits, so the old view never paints alone after the change.
  if (shown.key !== key) {
    const swap = shown.view !== view && animated();
    setLeaving(swap ? { view: shown.view, key: shown.key } : null);
    setShown({ view, key, entering: swap });
  }
  // The backstop timer arms only when the outgoing box has no running exit animation to wait for (its `animationend`
  // removes it otherwise), so a long frame or a slowed animation never cuts the fade short.
  const leavingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!leaving) return undefined;
    const box = leavingRef.current?.firstElementChild as HTMLElement | null | undefined;
    const exiting = typeof box?.getAnimations === 'function'
      && box.getAnimations().some((a) => (a as CSSAnimation).animationName === 'mpv-out' && a.playState !== 'finished');
    if (exiting) return undefined;
    const t = window.setTimeout(() => setLeaving(null), VIEW_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);
  // Every view starts at the top of the shared scroller (each used to be its own scroller). Only on a change, and the
  // read is skipped when nothing scrolled, so a swap costs no layout read on the usual unscrolled stage.
  const ref = useRef<HTMLDivElement>(null);
  const firstKey = useRef(key);
  useLayoutEffect(() => {
    if (firstKey.current === shown.key) return;
    firstKey.current = shown.key;
    const host = ref.current?.parentElement;
    if (host && host.scrollTop !== 0) host.scrollTop = 0;
  }, [shown.key]);

  return (
    <>
      {leaving && leaving.key !== shown.key && (
        <div key={leaving.key} ref={leavingRef} className={`mpview ${viewClass(leaving.view)} mpv-out`} aria-hidden="true" data-view={leaving.view}
          onAnimationEnd={(e) => { if (e.animationName === 'mpv-out') setLeaving((l) => (l && l.key === leaving.key ? null : l)); }}>
          {render(leaving.view)}
        </div>
      )}
      <div key={shown.key} ref={ref} className={`mpview ${viewClass(shown.view)}${shown.entering ? ' mpv-in' : ''}`} data-view={shown.view}>
        {render(shown.view)}
      </div>
    </>
  );
}
