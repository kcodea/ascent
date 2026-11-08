/**
 * "UPDATE READY" (desktop auto-update, spec 2026-11-04): a toast shown once the desktop shell has finished downloading an
 * update in the background. Information only: the update installs at the NEXT launch (behind the shell's own "Installing
 * update" screen), never mid-game, so there is no button. It takes no pointer input, fades itself after a while, and does
 * nothing in the browser build.
 *
 * WHERE IT SITS (owner 2026-11-08, R-UPDATE-NOTICE-PLACE-01: "put it below the start button and make it centered with the
 * start and play button center"): on the main screen it sits just under START, centred on START's centre (kept on
 * screen when START is near the bottom). Anywhere without a START button it keeps the top-centre spot.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { onUpdateReady } from './desktop';
import { onStageChange, rectToStage, stageHost, stageViewport } from './stage';
import './updatedPanel.css';

const SHOW_MS = 14000;
/** The on-screen element the notice hangs under. */
export const UPDATE_NOTICE_ANCHOR = '.ph-start';
const GAP = 14;
const EDGE = 12;

/** Where the notice goes, in stage px, given START's rect and the notice's own size (both stage px). Null = no START on
 *  screen, so the CSS default (top centre) applies. Pure, so the placement is testable without layout. */
export function updateNoticePlace(
  anchor: { left: number; width: number; bottom: number } | null,
  box: { height: number },
  viewH: number,
): { left: number; top: number } | null {
  if (!anchor) return null;
  const top = Math.min(anchor.bottom + GAP, viewH - box.height - EDGE);
  return { left: Math.round(anchor.left + anchor.width / 2), top: Math.round(Math.max(EDGE, top)) };
}

export function UpdateReadyNotice() {
  const [version, setVersion] = useState<string | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => onUpdateReady((v) => setVersion(v)), []);
  useEffect(() => {
    if (version === null) return undefined;
    const t = window.setTimeout(() => setVersion(null), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [version]);
  useLayoutEffect(() => {
    if (version === null) return undefined;
    const measure = (): void => {
      const el = ref.current;
      const a = document.querySelector(UPDATE_NOTICE_ANCHOR);
      if (!el || !a) { setPlace(null); return; }
      // Screen-space rects converted to stage px (they become CSS lengths on the notice). START's hover scale is
      // about its own centre, so the centre and the measured bottom stay put closely enough for one read.
      const r = rectToStage(a.getBoundingClientRect());
      setPlace(updateNoticePlace(r, { height: rectToStage(el.getBoundingClientRect()).height }, stageViewport().h));
    };
    measure();
    return onStageChange(measure);
  }, [version]);
  if (version === null) return null;
  const style: CSSProperties | undefined = place ? { left: place.left, top: place.top } : undefined;
  return createPortal(
    <div ref={ref} className={place ? 'updnotice under-start' : 'updnotice'} style={style} role="status">
      Update v{version} downloaded. It installs next time you start Ascent.
    </div>,
    stageHost(),
  );
}
