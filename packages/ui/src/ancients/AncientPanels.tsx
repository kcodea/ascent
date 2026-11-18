import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { ANCIENT_IDS, ANCIENTS, type AncientId } from '@game/sim';
import { wipeFx } from '../wipeFx';
import { rectToStage, stageViewport, toScreen } from '../stage';
import { AncientFace } from './AncientFace';
import { ancientColor, getAncientsConfig } from './ancientsConfig';
import { playCue } from './ancientsSound';
import { PANEL_LAND, PANEL_PULSE, PANEL_SLIDE_EASE, cardPolygon, panelFromTop, panelGeometry, panelRank, panelTimeline, seamX, slideLeadY, stripPolygon } from './panelClock';

/**
 * THE SIX PANELS (owner 2026-11-18; the clock and geometry are in `panelClock.ts`). Mounted by `AncientGate` for
 * its eruption, title and reveal beats when the gate style is `panels`:
 *   1. OUTSIDE TO INSIDE (the two outer panels, then the next two, then the middle two), each panel's BACKGROUND
 *      slides in from off screen (top, bottom, top, ...);
 *   2. its ANCIENT follows at once from the same side, gathering speed, and slams to a stop: a shake, a spray of
 *      sparks off the far edge of the screen, and sparks grinding along its panel's seams on the way;
 *   3. the three on offer rattle and their edges light; the other three fade and fall away;
 *   4. on the gate's `reveal` beat the three settle onto their cards' art on the select screen and give way to them.
 * No title here: "An Ancient Awakens" pops in with the select screen (`AncientOffer`'s banner).
 * Everything is a one-shot WAAPI transform / opacity (plus the three's one-shot clip onto their cards); the sparks are
 * Pixi on the wipe's canvas. Only this layer's own host ever shakes (never the game tree, `gateLayout.test.ts`).
 * Layout is read once, on the reveal beat. Reduced motion never mounts this (the gate goes straight to the reveal).
 */
const hexNum = (hex: string): number => parseInt(hex.replace('#', '').slice(0, 6), 16) || 0xffffff;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a); // presentation-only jitter
const SLIDE_CSS = `cubic-bezier(${PANEL_SLIDE_EASE.join(', ')})`;
const SPARK_HOT = [0xffe7a8, 0xffffff, 0xffd98a] as const;

export const AncientPanels = memo(function AncientPanels({ offered, phase }: { offered: readonly AncientId[]; phase: 'eruption' | 'title' | 'reveal' }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  // The geometry and the clock are fixed for this awakening (a tuner change applies to the next one).
  const { geo, tl, cfg } = useMemo(() => {
    const c = getAncientsConfig(), v = stageViewport();
    return { geo: panelGeometry(v.w, v.h, c.panelSlant), tl: panelTimeline(c), cfg: c };
  }, []);
  const ids = ANCIENT_IDS;

  useEffect(() => () => { for (const t of timers.current) window.clearTimeout(t); timers.current = []; }, []);

  // BEATS 1-3, scheduled up front from the eruption's first frame.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const at = (ms: number, fn: () => void): void => { timers.current.push(window.setTimeout(fn, ms)); };
    const anim = (el: Element | null | undefined, k: Keyframe[], o: KeyframeAnimationOptions): void => {
      if (el && typeof (el as HTMLElement).animate === 'function') (el as HTMLElement).animate(k, o);
    };
    const shake = (px: number, ms = 220): void => {
      if (px <= 0) return;
      const f: Keyframe[] = [];
      for (let s = 0; s <= 6; s++) { const d = 1 - s / 6; f.push({ transform: s === 6 ? 'none' : `translate(${(rnd(-px, px) * d).toFixed(2)}px, ${(rnd(-px, px) * d).toFixed(2)}px)` }); }
      anim(host, f, { duration: ms, easing: 'linear' });
    };
    const panels = Array.from(host.querySelectorAll<HTMLElement>('.anc-pn'));
    const sparks = cfg.panelSparks;

    panels.forEach((p, i) => {
      const id = ids[i]!, fromTop = panelFromTop(i), dir = fromTop ? -1 : 1, col = hexNum(ancientColor(id));
      const rank = panelRank(i, geo.n);
      // 1. The background slides in from off screen, inside its strip (the panel itself shows from that moment).
      anim(p, [{ opacity: 0 }, { opacity: 1 }], { duration: 1, delay: tl.bg[i]!, fill: 'both' });
      anim(p.querySelector('.anc-pn-fill'), [{ transform: `translateY(${(dir * geo.vh * 1.02).toFixed(1)}px)` }, { transform: 'translateY(0)' }],
        { duration: cfg.panelBgMs, delay: tl.bg[i]!, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'both' });
      anim(p.querySelector('.anc-pn-seam'), [{ opacity: 0 }, { opacity: 1 }], { duration: cfg.panelBgMs, delay: tl.bg[i]!, easing: 'ease-in', fill: 'both' });
      playCue('panelBg', tl.bg[i]!, { rateMul: 1 + rank * 0.1 });
      // 2. The Ancient follows from the same side, from fully off screen, and slams.
      anim(p.querySelector('.anc-pn-fig'), [
        { transform: `translateY(${(dir * geo.travel).toFixed(1)}px)`, easing: SLIDE_CSS },
        { transform: 'translateY(0)', offset: PANEL_LAND, easing: 'ease-out' },
        { transform: `translateY(${(-dir * geo.vh * 0.009).toFixed(1)}px)`, offset: 0.92, easing: 'ease-in' },
        { transform: 'translateY(0)' },
      ], { duration: cfg.panelSlideMs, delay: tl.slide[i]!, fill: 'both' });
      anim(p.querySelector('.anc-pn-name'), [{ opacity: 0, transform: 'translateX(-50%) translateY(18px)' }, { opacity: 1, transform: 'translateX(-50%)' }],
        { duration: 260, delay: tl.slide[i]! + cfg.panelSlideMs, easing: 'ease-out', fill: 'both' });
      playCue('panelSlam', tl.land[i]!, { rateMul: 1 - rank * 0.08 });
      // Grinding: sparks along both of its panel's seams, at the Ancient's leading edge, until it lands. The position
      // comes from the slide's own easing (no layout read per frame).
      const landMs = cfg.panelSlideMs * PANEL_LAND;
      if (sparks > 0) {
        at(tl.slide[i]!, () => {
          for (const b of [i, i + 1]) {
            if (b <= 0 || b >= geo.n) continue;
            wipeFx.grind((age) => {
              const y = slideLeadY(geo, fromTop, age / landMs);
              return { x: toScreen(seamX(geo, b, y)), y: toScreen(y) };
            }, landMs, 110 * sparks, -dir, SPARK_HOT);
          }
        });
      }
      // The thud: the layer shakes, and sparks are thrown back off the far edge of the screen where it hit.
      at(tl.land[i]!, () => {
        shake(cfg.panelShakePx);
        if (sparks <= 0) return;
        const y = fromTop ? geo.vh : 0;
        const cx = (i + 0.5) * geo.stripW + (fromTop ? -geo.slant : geo.slant);
        wipeFx.spray(toScreen(cx), toScreen(y), toScreen(geo.stripW * 0.5), fromTop ? -Math.PI / 2 : Math.PI / 2, Math.PI * 0.42, Math.round(34 * sparks), [col, ...SPARK_HOT]);
      });

      // 3. Three rattle and glow; three fade and fall away.
      anim(p.querySelector('.anc-pn-name'), [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: tl.pickAt + cfg.panelRattleMs - 100, fill: 'forwards' });
      if (offered.includes(id)) {
        const k = cfg.panelShakePx * 0.8, f: Keyframe[] = [];
        for (let s = 0; s <= 12; s++) { const d = s === 0 || s === 12 ? 0 : 0.35 + 0.65 * (s / 12); f.push({ transform: `translate(${(rnd(-k, k) * d).toFixed(2)}px, ${(rnd(-k, k) * 0.7 * d).toFixed(2)}px)` }); }
        anim(p, f, { duration: cfg.panelRattleMs, delay: tl.pickAt, easing: 'linear', fill: 'forwards' });
        // Its edges light and PULSE (the strokes, and a wash of its colour inside the edges), before the others go.
        const pulse = PANEL_PULSE.map(([offset, opacity]) => ({ offset, opacity, easing: 'ease-in-out' }));
        anim(p.querySelector('.anc-pn-glow'), pulse, { duration: cfg.panelRattleMs, delay: tl.pickAt, fill: 'forwards' });
        anim(p.querySelector('.anc-pn-lit'), pulse, { duration: cfg.panelRattleMs, delay: tl.pickAt, fill: 'forwards' });
        if (sparks > 0) {
          at(tl.pickAt + cfg.panelRattleMs * 0.5, () => { // a few sparks shaken loose from its lit edges
            for (const b of [i, i + 1]) {
              if (b <= 0 || b >= geo.n) continue;
              for (let s = 0; s < 3; s++) { const y = rnd(0.1, 0.9) * geo.vh; wipeFx.spray(toScreen(seamX(geo, b, y)), toScreen(y), 2, -Math.PI / 2, Math.PI, Math.round(4 * sparks), [col, 0xffffff]); }
            }
          });
        }
      } else {
        const tip = (i % 2 ? 1 : -1) * rnd(3, 7);
        anim(p, [
          { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
          { transform: `translateY(${(geo.vh * 0.08).toFixed(1)}px) rotate(${(tip * 0.25).toFixed(2)}deg)`, opacity: 0.75, offset: 0.3 },
          { transform: `translateY(${(geo.vh * 1.15).toFixed(1)}px) rotate(${tip.toFixed(2)}deg)`, opacity: 0 },
        ], { duration: cfg.panelFallMs, delay: tl.fallAt + rnd(0, 120), easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)', fill: 'forwards' });
      }
    });
    // Once per awakening: the component is mounted for exactly one.
  }, []);

  // BEAT 4 (the gate's `reveal`): the three settle onto their cards' art and give way to the real cards.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (phase !== 'reveal' || !host) return;
    const c = cfg;
    // The offer mounts on this same beat: read its cards once it has laid out (one read, next frame).
    const raf = window.requestAnimationFrame(() => {
      // Each card is still collapsed to its spark (a scale the reveal animates), so its own rect is a point. The SLOT is
      // never transformed: take its rect, and the art frame's LAYOUT box inside it (offsets ignore transforms and are
      // already stage px).
      const frames = Array.from(document.querySelectorAll<HTMLElement>('.anc-offer .anc-slot')).map((sl) => {
        const s = rectToStage(sl.getBoundingClientRect());
        const fr = sl.querySelector<HTMLElement>('.anc-art-frame');
        if (!fr) return s;
        let x = 0, y = 0;
        for (let el: HTMLElement | null = fr; el && el !== sl; el = el.offsetParent as HTMLElement | null) { x += el.offsetLeft; y += el.offsetTop; }
        return { left: s.left + x, top: s.top + y, width: fr.offsetWidth, height: fr.offsetHeight, right: s.left + x + fr.offsetWidth, bottom: s.top + y + fr.offsetHeight };
      });
      // When each card bursts out of its spark (`AncientOffer`: the middle first, then the sides left to right).
      const mid = Math.floor((offered.length - 1) / 2);
      const midBurst = Math.max(0, c.revealDelayMs) + c.sparkMs;
      const sideT0 = midBurst + Math.max(0, c.sideDelayMs);
      let side = 0;
      offered.forEach((id, slot) => {
        const i = ids.indexOf(id), p = host.querySelectorAll<HTMLElement>('.anc-pn')[i], r = frames[slot];
        if (!p) return;
        const burst = slot === mid ? midBurst : sideT0 + side++ * Math.max(0, c.sideStaggerMs) + c.sparkMs;
        const ease = 'cubic-bezier(0.5, 0, 0.15, 1)';
        if (r && r.width > 0) {
          const dx = r.left + r.width / 2 - (geo.left[i]! + geo.boxW / 2);
          const dur = Math.min(c.panelToCardMs, Math.max(120, burst));
          p.animate([{ transform: 'translate(0px, 0px)' }, { transform: `translate(${dx.toFixed(1)}px, 0px)` }], { duration: dur, easing: ease, fill: 'forwards' });
          p.querySelector('.anc-pn-clip')?.animate([{ clipPath: stripPolygon(geo, i) }, { clipPath: cardPolygon(geo, r.width, r.top, r.bottom) }], { duration: dur, easing: ease, fill: 'forwards' });
          // The Ancient's square ends exactly on the card's art square, so the real card appears over the same picture.
          const dy = r.top + r.height / 2 - geo.vh / 2;
          p.querySelector('.anc-pn-fig')?.animate([{ transform: 'translateY(0) scale(1)' }, { transform: `translateY(${dy.toFixed(1)}px) scale(${(r.width / geo.figS).toFixed(4)})` }], { duration: dur, easing: ease, fill: 'forwards' });
          p.querySelector('.anc-pn-glow')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, fill: 'forwards' });
          p.querySelector('.anc-pn-lit')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, fill: 'forwards' });
          p.querySelector('.anc-pn-seam')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
        }
        p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, delay: burst, easing: 'ease-out', fill: 'forwards', composite: 'replace' });
      });
    });
    return () => window.cancelAnimationFrame(raf);
    // Fires once, when the gate reaches its reveal.
  }, [phase]);

  return (
    <div ref={hostRef} className="anc-pn-host">
      {ids.map((id, i) => (
        <div key={id} className="anc-pn" style={{ left: geo.left[i], width: geo.boxW, '--anc-c': ancientColor(id) } as CSSProperties}>
          <div className="anc-pn-clip" style={{ clipPath: stripPolygon(geo, i) }}>
            <div className="anc-pn-fill" />
            <div className="anc-pn-fig" style={{ width: geo.figS, height: geo.figS, marginLeft: -geo.figS / 2, marginTop: -geo.figS / 2 }}>
              <AncientFace id={id} className="anc-pn-face" />
            </div>
            <div className="anc-pn-lit" />
          </div>
          {/* The strip's two slanted edges: a thin dark seam always, a glow in its colour for the three that stay. */}
          <svg className="anc-pn-edges" viewBox={`0 0 ${geo.boxW} ${geo.vh}`} preserveAspectRatio="none">
            <g className="anc-pn-seam">
              <line x1={2 * geo.slant} y1={0} x2={0} y2={geo.vh} /><line x1={geo.boxW} y1={0} x2={geo.boxW - 2 * geo.slant} y2={geo.vh} />
            </g>
            <g className="anc-pn-glow">
              {(['w', 'm', 'c'] as const).map((k) => (
                <g key={k} className={`anc-pn-glow-${k}`}>
                  <line x1={2 * geo.slant} y1={0} x2={0} y2={geo.vh} /><line x1={geo.boxW} y1={0} x2={geo.boxW - 2 * geo.slant} y2={geo.vh} />
                </g>
              ))}
            </g>
          </svg>
          <div className="anc-pn-name">{ANCIENTS[id].name.replace(/^Ancient of /, '')}</div>
        </div>
      ))}
    </div>
  );
});
