/**
 * THE AETHER TALLY (owner 2026-11-25): the end screen's duplicate refund. The Aether medallion and, beside it, a
 * counter whose digits roll upward as the dissolved duplicates' light flows in, landing on the refunded total. The
 * medallion glows and springs up in size each time it swallows a gulp of light.
 *
 * Driven imperatively (`setTarget`, `gulp`) so nothing re-renders per frame: the digits are columns moved by transform,
 * written from one rAF loop that runs only while the shown value is still catching up.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { AetherIcon } from '../AetherIcon';

export interface AetherTallyHandle {
  /** The value the counter rolls toward. */
  setTarget(value: number): void;
  /** The medallion swallows a gulp of light: it springs and flashes (throttled). `big` for the last one. */
  gulp(big?: boolean): void;
}

export interface AetherTallyProps {
  /** The refund's final total (sets how many digit columns there are). */
  total: number;
  /** Show the total at once, with no roll (reduced motion, or no scene to feed it). */
  still?: boolean;
  /** Fade in (the first duplicate has begun to dissolve). */
  shown: boolean;
  /** The Pack Lab's slow-mo factor. */
  slow?: number;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
/** How quickly the shown value closes on its target (ms time constant). */
const CATCH_UP_MS = 130;
const GULP_GAP_MS = 110;
/** One digit's row in the strip (em): taller than the digit, so its glow has room inside the column. */
const ROW_EM = 1.8;

/** Where the column for 10^place sits (in digits scrolled) at value `v`: the ones roll freely, the rest turn on a carry. */
export function odometerRoll(v: number, place: number): number {
  const p = Math.pow(10, place);
  const d = Math.floor(v / p) % 10;
  if (place === 0) return v % 10;
  const lower = v % p;
  return d + Math.max(0, lower - (p - 1));
}

export const AetherTally = forwardRef<AetherTallyHandle, AetherTallyProps>(function AetherTally({ total, still = false, shown, slow = 1 }, ref) {
  const cols = Math.max(1, String(Math.max(0, Math.round(total))).length);
  const root = useRef<HTMLDivElement | null>(null);
  const orb = useRef<HTMLSpanElement | null>(null);
  const halo = useRef<HTMLSpanElement | null>(null);
  const ring = useRef<HTMLSpanElement | null>(null);
  const streak = useRef<HTMLSpanElement | null>(null);
  const ring2 = useRef<HTMLSpanElement | null>(null);
  const strips = useRef<(HTMLSpanElement | null)[]>([]);
  const st = useRef({ shown: 0, target: 0, raf: 0, last: 0, gulpAt: 0 });

  const paint = (v: number): void => {
    for (let place = 0; place < cols; place++) {
      const el = strips.current[place];
      if (!el) continue;
      el.style.transform = `translateY(${(-odometerRoll(v, place) * ROW_EM).toFixed(3)}em)`;
      // a leading zero stays dark until the value reaches its column
      el.parentElement!.classList.toggle('pkop-odo-off', place > 0 && v < Math.pow(10, place) - 0.5);
    }
  };

  useImperativeHandle(ref, () => ({
    setTarget(value: number) {
      const s = st.current;
      s.target = Math.max(0, value);
      if (still || typeof requestAnimationFrame !== 'function') { s.shown = s.target; paint(s.shown); return; }
      if (s.raf) return;
      s.last = 0;
      const frame = (now: number): void => {
        const dt = s.last ? Math.min(60, now - s.last) : 16;
        s.last = now;
        const k = 1 - Math.exp(-dt / (CATCH_UP_MS * (slow > 0 ? slow : 1)));
        s.shown += (s.target - s.shown) * k;
        // close enough: land exactly on the number
        if (Math.abs(s.target - s.shown) < 0.04) s.shown = s.target;
        paint(s.shown);
        s.raf = s.shown === s.target ? 0 : requestAnimationFrame(frame);
      };
      s.raf = requestAnimationFrame(frame);
    },
    gulp(big = false) {
      const s = st.current, now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (still || (!big && now - s.gulpAt < GULP_GAP_MS)) return;
      s.gulpAt = now;
      const o = orb.current, h = halo.current;
      if (!o || typeof o.animate !== 'function') return;
      const peak = big ? 1.5 : 1.22 + Math.random() * 0.08, ms = (big ? 620 : 300) * (slow > 0 ? slow : 1);
      // a spring: up fast, a dip under, home
      o.animate([{ transform: 'scale(1)' }, { transform: `scale(${peak})`, offset: 0.28 }, { transform: 'scale(0.95)', offset: 0.62 }, { transform: 'scale(1)' }],
        { duration: ms, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });
      h?.animate([{ opacity: big ? 1 : 0.85 }, { opacity: 0.28 }], { duration: ms * 1.4, easing: 'ease-out' });
      // a ring leaves the medallion with each gulp; the last one also throws a streak of light across it
      ring.current?.animate([{ opacity: big ? 0.9 : 0.5, transform: 'scale(0.7)' }, { opacity: 0, transform: `scale(${big ? 2.6 : 1.7})` }], { duration: ms * (big ? 1.2 : 1.5), easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)' });
      if (big) ring2.current?.animate([{ opacity: 0, transform: 'scale(0.7)' }, { opacity: 0.8, transform: 'scale(1.2)', offset: 0.25 }, { opacity: 0, transform: 'scale(3.6)' }], { duration: ms * 1.7, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)' });
      if (big) streak.current?.animate([{ opacity: 0, transform: 'scaleX(0.3)' }, { opacity: 1, transform: 'scaleX(1)', offset: 0.2 }, { opacity: 0, transform: 'scaleX(1.15)' }], { duration: ms * 1.3, easing: 'ease-out' });
    },
  }), [cols, still, slow]);

  useEffect(() => {
    const s = st.current;
    if (still) { s.shown = s.target = total; }
    paint(s.shown);
    return () => { if (s.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(s.raf); s.raf = 0; };
  }, [still, total, cols]);

  const places = Array.from({ length: cols }, (_, i) => cols - 1 - i);
  return (
    <div className={`pkop-aether${shown ? ' pkop-aether-on' : ''}`} ref={root} aria-hidden data-testid="pack-aether-tally">
      <span className="pkop-aether-orb" ref={orb}>
        <span className="pkop-aether-halo" ref={halo} />
        <span className="pkop-aether-ring" ref={ring} />
        <span className="pkop-aether-ring2" ref={ring2} />
        <span className="pkop-aether-streak" ref={streak} />
        <AetherIcon className="pkop-aether-gem" />
      </span>
      <span className="pkop-aether-num">
        <span className="pkop-aether-plus">+</span>
        <span className="pkop-odo">{places.map((place) => (
          <span className="pkop-odo-col" key={place}>
            <span className="pkop-odo-strip" ref={(el) => { strips.current[place] = el; }}>
              {DIGITS.map((d, i) => <span key={i}>{d}</span>)}
            </span>
          </span>
        ))}</span>
      </span>
    </div>
  );
});
