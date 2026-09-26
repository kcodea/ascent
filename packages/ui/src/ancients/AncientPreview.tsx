import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type WheelEvent as ReactWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { ANCIENT_IDS, ANCIENTS, type AncientId } from '@game/sim';
import { AncientCard } from './AncientCard';
import { ancientColor } from './ancientsConfig';
import { prefersReducedMotion } from './ancientsFx';

/**
 * THE ANCIENTS PREVIEW CARD (owner ruling 6 + the polish brief): hovering the meter opens a card beside the hero
 * power showing ONE Ancient at a time (an `AncientCard`: full art, name, and its text for the CURRENT hero) with
 * page dots. The mouse wheel cycles all five (a smooth slide + cross-fade), the arrow buttons do the same for a
 * pointer without a wheel, and ←/→ do it while the card (or the meter) has focus.
 *
 * Motion: WAAPI on transform + opacity only, one-shot per step; the outgoing page is kept for one transition and
 * then dropped. Layout is read ONCE per open (the anchor rect), never per frame. Reduced motion: a plain fade.
 */
export interface PreviewAnchor { left: number; top: number; right: number; bottom: number }

const SLIDE_MS = 240;
const WHEEL_COOLDOWN_MS = 140;

export function useAncientCycler(start: AncientId): {
  index: number; dir: 1 | -1; step: (d: 1 | -1) => void; go: (i: number) => void; onWheel: (e: ReactWheelEvent) => void;
} {
  const [state, setState] = useState<{ index: number; dir: 1 | -1 }>({ index: Math.max(0, ANCIENT_IDS.indexOf(start)), dir: 1 });
  const lastWheel = useRef(0);
  const step = useCallback((d: 1 | -1) => setState((s) => ({ index: (s.index + d + ANCIENT_IDS.length) % ANCIENT_IDS.length, dir: d })), []);
  const go = useCallback((i: number) => setState((s) => (i === s.index ? s : { index: i, dir: i > s.index ? 1 : -1 })), []);
  const onWheel = useCallback((e: ReactWheelEvent) => {
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 1) return;
    const now = performance.now();
    if (now - lastWheel.current < WHEEL_COOLDOWN_MS) return;
    lastWheel.current = now;
    step(d > 0 ? 1 : -1);
  }, [step]);
  return { index: state.index, dir: state.dir, step, go, onWheel };
}

export function AncientPreview({ heroId, anchor, leaving = false, inMs = 180, outMs = 110, index, dir, step, go, onWheel, pickedId, onPointerEnter, onPointerLeave }: {
  heroId: string;
  anchor: PreviewAnchor;
  /** Sliding + fading out (the pointer left); the parent unmounts it after `outMs`. */
  leaving?: boolean;
  inMs?: number;
  outMs?: number;
  index: number;
  dir: 1 | -1;
  step: (d: 1 | -1) => void;
  go: (i: number) => void;
  onWheel: (e: ReactWheelEvent) => void;
  /** The Ancient locked in for this run, marked on its page. */
  pickedId?: AncientId;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}): JSX.Element {
  const id = ANCIENT_IDS[index]!;
  const pageRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const [ghost, setGhost] = useState<AncientId | null>(null);
  const prevIndex = useRef(index);

  // Each step: the new page slides in from the side it came from while the old one slides out and fades.
  useLayoutEffect(() => {
    if (prevIndex.current === index) return;
    const was = ANCIENT_IDS[prevIndex.current]!;
    prevIndex.current = index;
    setGhost(was);
  }, [index]);
  useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    const page = pageRef.current;
    if (page && typeof page.animate === 'function' && ghost) {
      page.animate(reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: `translateX(${dir * 28}px)` }, { opacity: 1, transform: 'translateX(0)' }],
      { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.25, 1)' });
    }
    const g = ghostRef.current;
    if (!ghost || !g || typeof g.animate !== 'function') return;
    const a = g.animate(reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-dir * 28}px)` }],
    { duration: SLIDE_MS * 0.8, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' });
    a.onfinish = () => setGhost(null);
    return () => { a.onfinish = null; };
  }, [ghost, dir]);

  // Keyboard: ←/→ while the card has focus.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  };

  // Placement: to the right of the hero power, vertically centred on it, clamped to the viewport.
  const W = Math.min(300, window.innerWidth - 32);
  const H = 505;
  const flip = anchor.right + 18 + W > window.innerWidth - 12;
  const left = flip ? Math.max(12, anchor.left - 18 - W) : anchor.right + 18;
  const top = Math.max(12, Math.min((anchor.top + anchor.bottom) / 2 - H / 2, window.innerHeight - H - 12));
  const [shown, setShown] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);

  return createPortal(
    <div className={`anc-pv${shown && !leaving ? ' shown' : ''}${leaving ? ' leaving' : ''}${flip ? ' flip' : ''}`}
      style={{ left, top, width: W, '--anc-pv-in': `${inMs}ms`, '--anc-pv-out': `${outMs}ms` } as CSSProperties}
      role="dialog" aria-label="The Ancients" tabIndex={-1}
      onWheel={onWheel} onKeyDown={onKeyDown} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <div className="anc-pv-head">
        <span className="anc-pv-kicker">The Ancients</span>
        <span className="anc-pv-hint">scroll to browse</span>
      </div>
      <div className="anc-pv-stage">
        {ghost && <div ref={ghostRef} className="anc-pv-page ghost" aria-hidden="true"><Page id={ghost} heroId={heroId} picked={ghost === pickedId} /></div>}
        <div ref={pageRef} key={id} className="anc-pv-page" aria-live="polite"><Page id={id} heroId={heroId} picked={id === pickedId} /></div>
      </div>
      <div className="anc-pv-nav">
        <button type="button" className="anc-pv-arrow" aria-label="Previous Ancient" onClick={() => step(-1)}>‹</button>
        <div className="anc-pv-dots" role="tablist" aria-label="Choose an Ancient">
          {ANCIENT_IDS.map((a, i) => (
            <button key={a} type="button" role="tab" aria-selected={i === index} aria-label={ANCIENTS[a].name}
              className={`anc-pv-dot${i === index ? ' on' : ''}`} style={{ '--anc-c': ancientColor(a) } as CSSProperties} onClick={() => go(i)} />
          ))}
        </div>
        <button type="button" className="anc-pv-arrow" aria-label="Next Ancient" onClick={() => step(1)}>›</button>
      </div>
    </div>,
    document.body,
  );
}

function Page({ id, heroId, picked }: { id: AncientId; heroId: string; picked: boolean }): JSX.Element {
  return <AncientCard id={id} heroId={heroId} tag={picked ? 'yours' : undefined} />;
}
