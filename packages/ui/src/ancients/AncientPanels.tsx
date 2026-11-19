import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { ANCIENT_IDS, ANCIENTS, type AncientId } from '@game/sim';
import { wipeFx } from '../wipeFx';
import { canPlayDefs, playDef } from '../fx/playDef';
import { ancientTrailPalette } from './ancientsSmoke';
import { ancientPanelLayers } from '../art';
import { rectToStage, stageViewport, toScreen } from '../stage';
import { AncientFace } from './AncientFace';
import { ancientColor, getAncientsConfig, type AncientsFullConfig } from './ancientsConfig';
import { playCue } from './ancientsSound';
import { PANEL_LAND, PANEL_PULSE, PANEL_SLIDE_EASE, PANEL_MASK_Y, panelBackWidth, panelFigureMaskY, panelFigureFit, panelFigureRest, panelFromTop, panelGeometry, panelRank, panelTimeline, seamX, spreadX, slideLeadY, stripPolygon } from './panelClock';

/**
 * THE SIX PANELS (owner 2026-11-18; the clock and geometry are in `panelClock.ts`). Mounted by `AncientGate` for
 * its eruption, title and reveal beats when the gate style is `panels`:
 *   1. OUTSIDE TO INSIDE (the two outer panels, then the next two, then the middle two), each panel's BACKGROUND
 *      slides in from off screen (top, bottom, top, ...);
 *   2. its ANCIENT follows at once from the same side, gathering speed, and slams to a stop: a shake, a spray of
 *      sparks off the far edge of the screen, and sparks grinding along its panel's seams on the way;
 *   3. the three on offer rattle and their edges light and pulse; then all six backgrounds fade and fall away (with
 *      the three Ancients not on offer) and the three on offer slide along the bottom to even spacing;
 *   4. on the gate's `reveal` beat each of the three pinches to a point of light and flies to its card as a shooting
 *      star (the pick's own trail, in its colour), landing as the card bursts out of its spark.
 * FIGURES IN FRONT (owner 2026-11-19: "i want the 'back' files to fall in the same slice format you currently have,
 * but i want the 'figures' not to be cut from those edges ... have them in front of those edges"): each panel is two
 * boxes over the same place. `.anc-pn` holds what the slanted strip clips (the background, the lit wash, the seam);
 * `.anc-pn-over`, in a second layer above ALL six strips, holds the uncut figure, the foreground magic (uncut
 * too), the edge glow and the name. Whatever moves a whole panel (rattle, fall, the settle onto the card)
 * moves both. The overs stack middle pair on top (they land last); the offered three come to the front when picked.
 * LAYERED PORTRAITS (owner 2026-11-19): an Ancient with `art/ancients/panels/<id>_{back,figure,front}` is drawn from
 * three sheets instead of the flat painting: the place rides the background, the cut-out Ancient is the figure, loose
 * magic comes in last and overshoots; a slow push-in then moves the three by different amounts (`panelDepth`).
 * No title here: "An Ancient Awakens" pops in with the select screen (`AncientOffer`'s banner).
 * Everything is a one-shot WAAPI transform / opacity (plus the three's one-shot clip onto their cards); the sparks are
 * Pixi on the wipe's canvas. Only this layer's own host ever shakes (never the game tree, `gateLayout.test.ts`).
 * Layout is read once, on the reveal beat. Reduced motion never mounts this (the gate goes straight to the reveal).
 */
const hexNum = (hex: string): number => parseInt(hex.replace('#', '').slice(0, 6), 16) || 0xffffff;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a); // presentation-only jitter
/** An Ancient's figure size: the shared dial times its own (`<id>PanelSize`). */
const figSize = (c: AncientsFullConfig, id: AncientId): number => c.panelFigureScale * ((c as unknown as Record<string, number>)[`${id}PanelSize`] ?? 1);
/** The triple trail's own flight as authored (`gild-trail`'s landing layers), before any speed-up. */
const TRAIL_MS = 420;
const SLIDE_CSS = `cubic-bezier(${PANEL_SLIDE_EASE.join(', ')})`;
const SPARK_HOT = [0xffe7a8, 0xffffff, 0xffd98a] as const;

export const AncientPanels = memo(function AncientPanels({ offered, phase }: { offered: readonly AncientId[]; phase: 'eruption' | 'title' | 'reveal' }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  /** Where each chosen panel's figure stands after its slide along the bottom (its box's x offset, stage px). */
  const spreadDx = useRef<Record<number, number>>({});
  // The geometry and the clock are fixed for this awakening (a tuner change applies to the next one).
  const { geo, tl, cfg } = useMemo(() => {
    const c = getAncientsConfig(), v = stageViewport();
    return { geo: panelGeometry(v.w, v.h, c.panelSlant), tl: panelTimeline(c), cfg: c };
  }, []);
  const ids = ANCIENT_IDS;
  const backW = panelBackWidth(geo);

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
    const overs = Array.from(host.querySelectorAll<HTMLElement>('.anc-pn-over'));
    const sparks = cfg.panelSparks;

    panels.forEach((p, i) => {
      const o = overs[i];
      const q = (sel: string): Element | null => p.querySelector(sel) ?? o?.querySelector(sel) ?? null;
      const id = ids[i]!, fromTop = panelFromTop(i), dir = fromTop ? -1 : 1, col = hexNum(ancientColor(id));
      const rank = panelRank(i, geo.n);
      // The backgrounds alternate top and bottom; the Ancients all rise from the bottom (owner 2026-11-19: "have the
      // ancient figures all come up from the bottom"), with their foreground magic and their sparks.
      const fDir = 1, fFromTop = false;
      // 1. The background slides in from off screen, inside its strip (the panel itself shows from that moment).
      anim(p, [{ opacity: 0 }, { opacity: 1 }], { duration: 1, delay: tl.bg[i]!, fill: 'both' });
      anim(q('.anc-pn-fill'), [{ transform: `translateY(${(dir * geo.vh * 1.02).toFixed(1)}px)` }, { transform: 'translateY(0)' }],
        { duration: cfg.panelBgMs, delay: tl.bg[i]!, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'both' });
      anim(q('.anc-pn-seam'), [{ opacity: 0 }, { opacity: 1 }], { duration: cfg.panelBgMs, delay: tl.bg[i]!, easing: 'ease-in', fill: 'both' });
      playCue('panelBg', tl.bg[i]!, { rateMul: 1 + rank * 0.1 });
      // 2. The Ancient follows from the same side, from fully off screen, and slams. A layered figure stands smaller
      // than the flat painting's square (the whole cut-out fits the strip's height), so its slide carries that scale.
      const rest = p.dataset.layered ? panelFigureRest(geo, panelFigureFit(id), figSize(cfg, id)) : { tx: 0, ty: 0, s: 1 };
      const at0 = (y: number): string => `translate(${rest.tx.toFixed(1)}px, ${(rest.ty + y).toFixed(1)}px) scale(${rest.s.toFixed(4)})`;
      anim(q('.anc-pn-fig'), [
        { transform: at0(fDir * geo.travel), easing: SLIDE_CSS },
        { transform: at0(0), offset: PANEL_LAND, easing: 'ease-out' },
        { transform: at0(-fDir * geo.vh * 0.009), offset: 0.92, easing: 'ease-in' },
        { transform: at0(0) },
      ], { duration: cfg.panelSlideMs, delay: tl.slide[i]!, fill: 'both' });
      anim(q('.anc-pn-name'), [{ opacity: 0, transform: 'translateX(-50%) translateY(18px)' }, { opacity: 1, transform: 'translateX(-50%)' }],
        { duration: 260, delay: tl.slide[i]! + cfg.panelSlideMs, easing: 'ease-out', fill: 'both' });
      // Its own stone slide for the length of the slide, then the slam.
      playCue('panelSlide', tl.slide[i]!, { variant: i });
      playCue('panelSlam', tl.land[i]!, { rateMul: 1 - rank * 0.08 });
      // LAYERED: the foreground magic arrives last and overshoots, then all three sheets push in by different amounts
      // (the place least, the magic most): one long one-shot each, from the background's first frame to past the reveal.
      const depth = Math.max(0, cfg.panelDepth);
      if (p.dataset.layered) {
        anim(q('.anc-pn-front'), [
          { transform: `translateY(${(fDir * geo.vh * 1.15).toFixed(1)}px)`, easing: SLIDE_CSS },
          { transform: `translateY(${(-fDir * geo.vh * 0.022 * depth).toFixed(1)}px)`, offset: 0.78, easing: 'ease-in-out' },
          { transform: 'translateY(0)' },
        ], { duration: cfg.panelSlideMs * 1.25, delay: tl.slide[i]! + 70, fill: 'both' });
        const drift: KeyframeAnimationOptions = { duration: tl.revealAt - tl.bg[i]! + 900, delay: tl.bg[i]!, easing: 'cubic-bezier(0.2, 0.5, 0.4, 1)', fill: 'both' };
        anim(q('.anc-pn-back'), [{ transform: `translateY(${(dir * 2.5 * depth).toFixed(2)}%) scale(${(1.04 + 0.07 * depth).toFixed(3)})` }, { transform: 'translateY(0%) scale(1.04)' }], drift);
        for (const sel of ['.anc-pn-cut', '.anc-pn-rim']) anim(q(sel), [{ transform: `scale(${(1 - 0.03 * depth).toFixed(3)})` }, { transform: `scale(${(1 + 0.025 * depth).toFixed(3)})` }], drift);
        anim(q('.anc-pn-front-img'), [{ transform: 'translateY(0%) scale(1)' }, { transform: `translateY(${(2.5 * depth).toFixed(2)}%) scale(${(1 + 0.12 * depth).toFixed(3)})` }], drift);
      }
      // Grinding: sparks along both of its panel's seams, at the Ancient's leading edge, until it lands. The position
      // comes from the slide's own easing (no layout read per frame).
      const landMs = cfg.panelSlideMs * PANEL_LAND;
      if (sparks > 0) {
        at(tl.slide[i]!, () => {
          for (const b of [i, i + 1]) {
            if (b <= 0 || b >= geo.n) continue;
            wipeFx.grind((age) => {
              const y = slideLeadY(geo, fFromTop, age / landMs);
              return { x: toScreen(seamX(geo, b, y)), y: toScreen(y) };
            }, landMs, 110 * sparks, -fDir, SPARK_HOT);
          }
        });
      }
      // The thud: the layer shakes, and sparks are thrown back off the far edge of the screen where it hit.
      at(tl.land[i]!, () => {
        shake(cfg.panelShakePx);
        if (sparks <= 0) return;
        const y = fFromTop ? geo.vh : 0;
        const cx = (i + 0.5) * geo.stripW + (fFromTop ? -geo.slant : geo.slant);
        wipeFx.spray(toScreen(cx), toScreen(y), toScreen(geo.stripW * 0.5), fFromTop ? -Math.PI / 2 : Math.PI / 2, Math.PI * 0.42, Math.round(34 * sparks), [col, ...SPARK_HOT]);
      });

      // 3. Three rattle and glow. Then ALL SIX backgrounds fade and fall away (owner 2026-11-19: "have all 6 backgrounds
      // fall away and fade"), with the three Ancients not on offer; the three on offer slide along the bottom to even
      // spacing, ready to move into their cards.
      const tip = (i % 2 ? 1 : -1) * rnd(3, 7);
      const fall: Keyframe[] = [
        { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
        { transform: `translateY(${(geo.vh * 0.08).toFixed(1)}px) rotate(${(tip * 0.25).toFixed(2)}deg)`, opacity: 0.75, offset: 0.3 },
        { transform: `translateY(${(geo.vh * 1.15).toFixed(1)}px) rotate(${tip.toFixed(2)}deg)`, opacity: 0 },
      ];
      const fallOpts: KeyframeAnimationOptions = { duration: cfg.panelFallMs, delay: tl.fallAt + rnd(0, 120), easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)', fill: 'forwards' };
      anim(p, fall, fallOpts);
      anim(q('.anc-pn-name'), [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: tl.pickAt + cfg.panelRattleMs - 100, fill: 'forwards' });
      if (offered.includes(id)) {
        const k = cfg.panelShakePx * 0.8, f: Keyframe[] = [];
        for (let s = 0; s <= 12; s++) { const d = s === 0 || s === 12 ? 0 : 0.35 + 0.65 * (s / 12); f.push({ transform: `translate(${(rnd(-k, k) * d).toFixed(2)}px, ${(rnd(-k, k) * 0.7 * d).toFixed(2)}px)` }); }
        for (const el of [p, o]) anim(el, f, { duration: cfg.panelRattleMs, delay: tl.pickAt, easing: 'linear', fill: 'forwards' });
        // The chosen three step in front of the others.
        at(tl.pickAt, () => { if (o) o.style.zIndex = String(10 + rank); });
        // Its edges light and PULSE (the strokes, and a wash of its colour inside the edges), before the others go.
        const pulse = PANEL_PULSE.map(([offset, opacity]) => ({ offset, opacity, easing: 'ease-in-out' }));
        anim(q('.anc-pn-glow'), pulse, { duration: cfg.panelRattleMs, delay: tl.pickAt, fill: 'forwards' });
        anim(q('.anc-pn-lit'), pulse, { duration: cfg.panelRattleMs, delay: tl.pickAt, fill: 'forwards' });
        // ...and so does the Ancient's own outline (owner 2026-11-19: "can you have their edges flash with a glow as well?").
        anim(q('.anc-pn-rim'), pulse, { duration: cfg.panelRattleMs, delay: tl.pickAt, fill: 'forwards' });
        if (sparks > 0) {
          at(tl.pickAt + cfg.panelRattleMs * 0.5, () => { // a few sparks shaken loose from its lit edges
            for (const b of [i, i + 1]) {
              if (b <= 0 || b >= geo.n) continue;
              for (let s = 0; s < 3; s++) { const y = rnd(0.1, 0.9) * geo.vh; wipeFx.spray(toScreen(seamX(geo, b, y)), toScreen(y), 2, -Math.PI / 2, Math.PI, Math.round(4 * sparks), [col, 0xffffff]); }
            }
          });
        }
        // The strip is going: its edge glow goes with it. The foreground magic fades too (it would trail behind the
        // figure's slide along the bottom). The outline glow stays on the figure.
        for (const sel of ['.anc-pn-glow', '.anc-pn-front']) anim(q(sel), [{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay: tl.fallAt, easing: 'ease-out', fill: 'forwards' });
        // The slide along the bottom, to its third of the screen (in the order of the cards).
        const dxs = spreadX(geo, offered.indexOf(id), offered.length) - (geo.left[i]! + geo.boxW / 2);
        spreadDx.current[i] = dxs;
        anim(o, [{ transform: 'translate(0px, 0px)' }, { transform: `translate(${dxs.toFixed(1)}px, 0px)` }], { duration: Math.max(1, cfg.panelSpreadMs), delay: tl.spreadAt, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' });
      } else {
        anim(o, fall, fallOpts);
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
        const i = ids.indexOf(id), p = host.querySelectorAll<HTMLElement>('.anc-pn')[i], o = host.querySelectorAll<HTMLElement>('.anc-pn-over')[i], r = frames[slot];
        if (!p) return;
        const q = (sel: string): Element | null => p.querySelector(sel) ?? o?.querySelector(sel) ?? null;
        const burst = slot === mid ? midBurst : sideT0 + side++ * Math.max(0, c.sideStaggerMs) + c.sparkMs;
        // THE SHOOTING STAR (owner 2026-11-19: "have the figures turn into little shooting stars when they transform into
        // the ancient select panels"): the figure pinches to a bright point at its mask, and the triple's trail (the
        // pick's own `gild-trail`, in the Ancient's colour) carries that point to its card, landing as the card bursts
        // out of its spark.
        const pinch = Math.min(220, Math.max(90, burst * 0.45));
        const collapse: Keyframe[] = [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.82)', opacity: 1, offset: 0.35 }, { transform: 'scale(0.03)', opacity: 0 }];
        for (const sel of ['.anc-pn-cut', '.anc-pn-rim']) q(sel)?.animate(collapse, { duration: pinch, easing: 'cubic-bezier(0.6, 0, 0.9, 0.4)', fill: 'forwards' });
        if (r && r.width > 0 && p.dataset.layered && canPlayDefs()) {
          const launch = pinch * 0.7, flight = Math.max(120, burst - launch);
          const from = { x: toScreen(geo.left[i]! + geo.boxW / 2 + (spreadDx.current[i] ?? 0)), y: toScreen(panelFigureMaskY(geo, panelFigureFit(id), figSize(c, id))) };
          const to = { x: toScreen(r.left + r.width / 2), y: toScreen(r.top + r.height / 2) };
          timers.current.push(window.setTimeout(() => {
            playDef('gild-trail', { source: from, target: to, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } }, {
              index: 0, time: Math.max(0.05, flight / TRAIL_MS), intensity: Math.max(0, c.trailIntensity), recolor: ancientTrailPalette(ancientColor(id)), recolorGlow: true, muteSound: true,
            });
          }, launch));
        }
        o?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, delay: pinch, fill: 'forwards', composite: 'replace' });
      });
    });
    return () => window.cancelAnimationFrame(raf);
    // Fires once, when the gate reaches its reveal.
  }, [phase]);

  // A strip's two slanted edges. The first strip has no left edge and the last no right edge: those would be lines
  // across the screen's top-left and bottom-right corners, where the outer backgrounds simply fill to the corner
  // (owner 2026-11-19: "can we remove those and have death and bonds just fill those corners?").
  const edge = (i: number): JSX.Element => (<>
    {i > 0 && <line x1={2 * geo.slant} y1={0} x2={0} y2={geo.vh} />}
    {i < geo.n - 1 && <line x1={geo.boxW} y1={0} x2={geo.boxW - 2 * geo.slant} y2={geo.vh} />}
  </>);
  return (
    <div ref={hostRef} className="anc-pn-host">
      {/* THE STRIPS: what the slanted clip cuts (the background, the lit wash) and the thin dark seam. */}
      {ids.map((id, i) => { const layers = ancientPanelLayers(id); return (
        <div key={id} className="anc-pn" data-layered={layers ? '1' : undefined} style={{ left: geo.left[i], width: geo.boxW, '--anc-c': ancientColor(id) } as CSSProperties}>
          <div className="anc-pn-clip" style={{ clipPath: stripPolygon(geo, i) }}>
            <div className="anc-pn-fill">
              {layers && <img decoding="sync" className="anc-pn-back" src={layers.back} alt="" draggable={false} style={{ width: backW, height: backW * 1.5, marginLeft: -backW / 2, top: (geo.vh - backW * 1.5) / 2 }} />}
            </div>
            {/* No layers: the flat painting, soft-masked, inside the strip. */}
            {!layers && (
              <div className="anc-pn-fig" style={{ width: geo.figS, height: geo.figS, marginLeft: -geo.figS / 2, marginTop: -geo.figS / 2 }}>
                <AncientFace id={id} className="anc-pn-face" />
              </div>
            )}
            <div className="anc-pn-lit" />
          </div>
          <svg className="anc-pn-edges" viewBox={`0 0 ${geo.boxW} ${geo.vh}`} preserveAspectRatio="none">
            <g className="anc-pn-seam">{edge(i)}</g>
          </svg>
        </div>
      ); })}
      {/* IN FRONT OF EVERY STRIP: the edge glow (the three that stay), the uncut figure, the foreground magic (cut to
          its strip) and the name. */}
      {ids.map((id, i) => { const layers = ancientPanelLayers(id), fit = panelFigureFit(id); return (
        <div key={`over-${id}`} className="anc-pn-over" style={{ left: geo.left[i], width: geo.boxW, zIndex: panelRank(i, geo.n), '--anc-c': ancientColor(id) } as CSSProperties}>
          <svg className="anc-pn-edges" viewBox={`0 0 ${geo.boxW} ${geo.vh}`} preserveAspectRatio="none">
            <g className="anc-pn-glow">
              {(['w', 'm', 'c'] as const).map((k) => <g key={k} className={`anc-pn-glow-${k}`}>{edge(i)}</g>)}
            </g>
          </svg>
          {layers && (
            <div className="anc-pn-fig anc-pn-fig-cut" style={{ width: geo.figS, height: geo.figS, marginLeft: -geo.figS / 2, marginTop: -geo.figS / 2 }}>
              {/* The chosen three's OUTLINE glow: the same cut-out behind the figure, with a static glow in its colour, so
                  only the halo round its silhouette shows. Only its opacity animates (the pulse). */}
              {offered.includes(id) && <img decoding="sync" className="anc-pn-rim" src={layers.figure} alt="" draggable={false} style={{ left: `${fit.left}%`, top: `${fit.top}%`, width: `${fit.width}%`, transformOrigin: `${(fit.mx * 100).toFixed(1)}% ${PANEL_MASK_Y * 100}%` }} />}
              <img decoding="sync" className="anc-pn-cut" src={layers.figure} alt="" draggable={false} style={{ left: `${fit.left}%`, top: `${fit.top}%`, width: `${fit.width}%`, transformOrigin: `${(fit.mx * 100).toFixed(1)}% ${PANEL_MASK_Y * 100}%` }} />
            </div>
          )}
          {/* The foreground magic: cropped tight to its art (each file has its own shape), uncut, wrapped round the
              figure's lower half. */}
          {layers?.front && (
            <div className="anc-pn-front">
              <img decoding="sync" className="anc-pn-front-img" src={layers.front} alt="" draggable={false} />
            </div>
          )}
          <div className="anc-pn-name">{ANCIENTS[id].name.replace(/^Ancient of /, '')}</div>
        </div>
      ); })}
    </div>
  );
});
