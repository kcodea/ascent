import { useCallback, useEffect, useRef, useState, type CSSProperties, type TransitionEvent as ReactTransitionEvent } from 'react';
import { createPortal } from 'react-dom';
import { getScreenWipeConfig, wipeCssVars, WIPE_PLAY_EVENT } from './screenWipeConfig';
import { wipeOriginFor, type WipeOrigin } from './wipeGeometry';
import { afterBeat, afterSweep, barClassFor, curtainClassFor, frontClassFor, wipeSweeping, type WipeState } from './wipeMachine';
import { wipeFx } from './wipeFx';

/**
 * THE SCREEN WIPE SANDBOX (DEV only): what the Screen wipe tuner's ▶ Play runs. It plays the Returning-to-Shop
 * wipe (tell → bloom → hold → reveal) over whatever screen is up, with the tuner's current values, using the SAME
 * classes, CSS and FX as the live curtain (wipeMachine + screenWipeConfig), so what the owner dials in here is
 * exactly what a real combat plays. Nothing in the run changes; it unmounts itself when the reveal ends. The preview
 * layers wear `.preview` (z 9000) so it also shows over the title and menus; the wipe FX motes stay at their live
 * z 255, so they only show when played over the board.
 */
export function WipePreview(): JSX.Element | null {
  const [wipe, setWipe] = useState<WipeState | null>(null);
  const [origin, setOrigin] = useState<WipeOrigin | null>(null);
  const backstop = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const onPlay = (): void => {
      const c = getScreenWipeConfig();
      const gem = document.querySelector('.etbwrap .etb-gembox') ?? document.querySelector('.etbwrap');
      setOrigin(wipeOriginFor(window.innerWidth, window.innerHeight, gem ? gem.getBoundingClientRect() : null, { ellipse: c.ellipse, ringLine: c.ringLine }));
      setWipe('primeOut');
    };
    window.addEventListener(WIPE_PLAY_EVENT, onPlay);
    return () => window.removeEventListener(WIPE_PLAY_EVENT, onPlay);
  }, []);

  // The same beats as Recruit's machine: timed tell + hold, sweeps advance on transitionend (+ a backstop).
  useEffect(() => {
    if (!wipe) return undefined;
    const c = getScreenWipeConfig();
    if (wipe === 'idle') { setWipe(null); return undefined; }
    if (origin && wipe === 'primeOut') wipeFx.charge(origin.cx, origin.cy, c.chargeMs + 80);
    if (origin && wipe === 'coverOut') {
      const ease: [number, number, number, number] = [c.easeX1, c.easeY1, c.easeX2, c.easeY2];
      wipeFx.bloom(origin.cx, origin.cy, origin.rx, origin.ry, c.coverMs, ease);
      wipeFx.inhale(origin.cx, origin.cy, origin.r, c.coverMs + 200);
    }
    if (wipe === 'primeOut' || wipe === 'coveredOut') {
      const t = window.setTimeout(() => setWipe(afterBeat(wipe)), wipe === 'primeOut' ? c.chargeMs : c.holdOutMs);
      return () => window.clearTimeout(t);
    }
    if (wipeSweeping(wipe)) {
      backstop.current = window.setTimeout(() => setWipe((w) => (w ? afterSweep(w) : w)), (wipe === 'coverOut' ? c.coverMs : c.revealMs) + 400);
      return () => window.clearTimeout(backstop.current);
    }
    return undefined;
  }, [wipe, origin]);

  const onEnd = useCallback((e: ReactTransitionEvent<HTMLDivElement>): void => {
    if (e.propertyName !== 'clip-path') return;
    window.clearTimeout(backstop.current);
    setWipe((w) => (w ? afterSweep(w) : w));
  }, []);

  if (!import.meta.env.DEV || !wipe) return null;
  const vars = wipeCssVars(getScreenWipeConfig(), origin) as CSSProperties;
  return createPortal(<>
    <div className={`${curtainClassFor(wipe)} preview`} aria-hidden="true" onTransitionEnd={onEnd} style={vars}>
      <div className="wipevs">
        <div className="wipevs-label">Returning to Shop</div>
        <img decoding="sync" className="wipevs-face" src={`${import.meta.env.BASE_URL}return-to-shop.webp`} alt="" draggable={false} />
      </div>
    </div>
    <div className={`${frontClassFor(wipe)} preview`} aria-hidden="true" style={vars} />
    <div className={`${barClassFor(wipe)} preview`} aria-hidden="true" style={vars} />
  </>, document.body);
}
