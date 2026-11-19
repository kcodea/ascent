import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { AncientId, RunState } from '@game/sim';
import { useGame } from '../store';
import { wipeFx } from '../wipeFx';
import { wipeAspect, wipeCoverEllipse } from '../wipeGeometry';
import { getAncientsConfig, subscribeAncientsConfig } from './ancientsConfig';
import { panelTimeline } from './panelClock';
import { AncientPanels } from './AncientPanels';
import { getAwakenStage, prefersReducedMotion, setAwakenStage, useAwakenStage, useGateDemo, useRingSettledSeq } from './ancientsFx';
import { duckForAwakening, playCue, warmAncientCues } from './ancientsSound';
import { pickTimeline, warmPickBurst } from './ancientPickSlam';
import { ancientEruptionBlast, ancientLandDust } from './ancientsSmoke';
import { heroMotePalette, resolveAncientHeroTheme } from './ancientHeroThemes';
import { stageHost, toStage } from '../stage';

/**
 * THE AWAKENING (owner 2026-09-25: "ominous exciting when the hero power erupts. it should be a moment that the player
 * is so excited for. delay the discover, and make the discover animation unique to the ancients in timing, sound and
 * appearance"). A sealed power breaking open — every length a ✦ Ancients tuner dial, every sound a named cue:
 *
 *   OMEN      the world holds its breath: music + other sounds duck, a low rumble swells, the screen's edges darken,
 *             arcane glyphs flicker around the hero power and embers drift up from it (`omenRumble`).
 *   ERUPTION  a deep boom, a flash in the hero's theme and an explosion from the hero power, one short dust burst in
 *             the theme's light colour, and the Shop darkens (`eruptionBoom`, `eruptionFlash`). Then THE SIX PANELS
 *             (`AncientPanels`, owner 2026-11-18): each Ancient's background slides in as a tall slanted panel, the
 *             Ancient follows and slams, the offered three rattle with lit, pulsing edges and the other three fall
 *             away. The gate's `title` beat is the moment all six are in; it shows no title.
 *   REVEAL    the three settle onto their cards on the select screen, "An Ancient Awakens" pops in (`titleSting`) and
 *             the offer runs its OWN emergence (`AncientOffer`: one Ancient at a time out of a flash of its colour,
 *             `cardReveal` each).
 *   SETTLED   drifting motes behind the cards and a quiet hum under the (still ducked) music (`ambientHum`).
 *   PICK      the backdrop FADES off (owner 2026-09-27) while the chosen card collapses into the triple's trail and
 *             slams into the hero power (`ancientPickSlam.ts`: collapse, recoloured `gild-trail`, hit-stop,
 *             `pickSeal`, ring, shake) and the crack reveal plays from `AncientSplit`. The duck lets go on the impact.
 *
 * The earlier CURTAIN (a bloom of colour out of the hero power with its art as a medallion, a per-hero bloom style and
 * a held title card) was deleted on 2026-11-19 by owner order ("delete the curtain and its dials").
 *
 * The hero-power button and its art NEVER change; every layer here is separate and only emanates from its position.
 * All one-shot WAAPI (transform / opacity). Never under a wipe, in combat or over another decision overlay. Reduced
 * motion: the backdrop and offer fade, the sounds still play.
 */
/** A fallback offer before any sequence has started (a tuner demo brings its own random three, `ancientsFx.ts`). */
const DEMO_OFFER: readonly AncientId[] = ['death', 'fortune', 'war'];
type Phase = 'idle' | 'omen' | 'eruption' | 'title' | 'reveal' | 'settled' | 'closing';
interface Geo { x: number; y: number; r: number; hp: number; pal: readonly number[] }
/** `Geo` is SCREEN px (it feeds `wipeFx`, a Pixi layer); the DOM layer (--gx/--gy, halo, ring, embers) takes this
 *  STAGE-px copy (stage.ts). Identity when the stage is unscaled. */
const stageGeo = (g: Geo): { x: number; y: number; hp: number } => ({ x: toStage(g.x), y: toStage(g.y), hp: toStage(g.hp) });

/** The default motes (violet/gold/teal); a themed hero's awakening uses its own (`heroMotePalette`). */
const PALETTE = [0xb58cff, 0xffd98a, 0x7fe3d0, 0xffffff, 0xe6ccff] as const;
/** Small runic marks (24-unit box) for the omen's glyph ring. */
const GLYPHS = [
  'M8 2 V22 M8 7 L16 2 M8 13 L16 8',
  'M12 2 V22 M5 7 L12 12 L19 7',
  'M6 2 V22 M18 2 V22 M6 12 L18 12',
  'M12 2 L20 12 L12 22 L4 12 Z',
  'M6 22 L12 2 L18 22 M8 15 H16',
  'M12 2 V22 M4 9 L20 15 M20 9 L4 15',
];
const N_GLYPHS = 12;
const N_EMBERS = 18;

/** The hero-power button's centre + width. Read ONCE when the awakening starts, never per frame. */
function hpBox(): { x: number; y: number; w: number } {
  const r = document.querySelector('.statusbar .heropanel .heropowerbtn')?.getBoundingClientRect();
  return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } : { x: window.innerWidth * 0.2, y: window.innerHeight * 0.55, w: 110 };
}
// Presentation-only jitter (Math.random is banned in core/content/sim, not here).
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export const AncientGate = memo(function AncientGate({ run }: { run: RunState }) {
  const anc = run.ancientsEnabled ? run.ancients : undefined;
  const offerSeq = anc?.offerSeq ?? 0;
  const offerOpen = !!anc?.offer?.length;
  const settled = useRingSettledSeq();
  const demo = useGateDemo();
  const stage = useAwakenStage();
  const wipeIdle = useGame((s) => s.wipeIdle);
  const combatStaged = useGame((s) => s.combatStaged);
  const otherModal = !!(run.discover || run.questOffer || run.powerOffer || run.runeforgeOffer || run.pendingTarget || run.chooseOne || run.scoutedNextOpponent?.length);
  const blocked = run.phase !== 'recruit' || !wipeIdle || combatStaged || otherModal;

  // The screen's colours are live tuner values (✦ Ancients › Screen colours), fed to the CSS as custom properties.
  const cfg = useSyncExternalStore(subscribeAncientsConfig, getAncientsConfig, getAncientsConfig);
  // …in the HERO's theme (its own entry, else the default; `start` resolves the same theme for the dust + motes).
  // (A tuner demo may play as another hero: `themeHero` is pinned when the sequence starts.)
  const [themeHero, setThemeHero] = useState<string | undefined>(undefined);
  const theme = useMemo(() => resolveAncientHeroTheme(themeHero ?? run.heroId, cfg as unknown as Record<string, unknown>), [themeHero, run.heroId, cfg]);
  const heroIdRef = useRef(run.heroId);
  heroIdRef.current = run.heroId;
  const [phase, setPhase] = useState<Phase>('idle');
  const [geo, setGeo] = useState<Geo | null>(null);
  // THE PANELS' offered three, pinned when the sequence starts.
  const [panels, setPanels] = useState<readonly AncientId[]>(DEMO_OFFER);
  const offerRef = useRef(anc?.offer);
  offerRef.current = anc?.offer;
  const bgRef = useRef<HTMLDivElement | null>(null);
  const omenRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  const seqRef = useRef(0);
  const closingRef = useRef(false); // the pick's close has begun (see `close`)
  const rumble = useRef<{ stop: (ms?: number) => void } | null>(null);
  const hum = useRef<{ stop: (ms?: number) => void } | null>(null);
  // The hero power's dust burst (retired outright at the reveal).
  const hpFx = useRef<(() => void)[]>([]);
  const retireHpFx = (): void => { for (const r of hpFx.current) r(); hpFx.current = []; };
  const clearTimers = (): void => { for (const t of timers.current) window.clearTimeout(t); timers.current = []; };
  const go = useCallback((p: Phase, seq: number) => { setPhase(p); setAwakenStage(p, seq); }, []);
  useEffect(() => { wipeFx.warm(); warmAncientCues(); }, []);
  useEffect(() => () => { clearTimers(); rumble.current?.stop(200); hum.current?.stop(200); duckForAwakening(false); retireHpFx(); }, []);

  /** REVEAL: the panels give way to the offer's own emergence. */
  const toReveal = useCallback((seq: number) => {
    clearTimers();
    rumble.current?.stop(500); rumble.current = null;
    retireHpFx();
    go('reveal', seq);
  }, [go]);

  /** Start the sequence for offer `seq` (< 0: a tuner demo). `fromReveal` jumps straight to the Ancients. */
  const start = useCallback((seq: number, fromReveal = false, asHero?: string, demoOffer?: readonly AncientId[]) => {
    const c = getAncientsConfig();
    const { x, y, w } = hpBox();
    const vw = window.innerWidth, vh = window.innerHeight;
    const { rx, ry } = wipeCoverEllipse(x, y, vw, vh, wipeAspect(vw, vh, 1));
    const heroId = asHero ?? heroIdRef.current;
    const theme = resolveAncientHeroTheme(heroId, c as unknown as Record<string, unknown>);
    const pal = heroMotePalette(heroId, theme) ?? PALETTE;
    setThemeHero(asHero);
    setGeo({ x, y, r: Math.max(rx, ry), hp: w, pal });
    seqRef.current = seq;
    closingRef.current = false;
    setPanels(seq > 0 && offerRef.current?.length ? [...offerRef.current] : demoOffer?.length ? demoOffer : DEMO_OFFER);
    duckForAwakening(true);
    if (fromReveal || prefersReducedMotion()) {
      if (prefersReducedMotion() && !fromReveal) { playCue('eruptionBoom'); playCue('titleSting', 200); }
      toReveal(seq);
      return;
    }
    // The pick's Pixi (the triple trail + the ring), pre-played invisibly NOW: a cold first play of the trail is a ~70 ms
    // task, and here it lands on the meter flash's peak, before any omen frame has drawn, where a held frame reads as
    // nothing. Warmed at the settled offer it hitched the last slam's dust; not warmed it hitched the pick (measured
    // 2026-09-27, headless Chrome).
    warmPickBurst();
    go('omen', seq);
    rumble.current = playCue('omenRumble', 0, { fadeInMs: Math.min(600, c.omenMs) });
    wipeFx.charge(x, y, c.omenMs, pal);
    timers.current.push(window.setTimeout(() => {
      go('eruption', seq);
      rumble.current?.stop(900); rumble.current = null;
      playCue('eruptionBoom');
      playCue('eruptionFlash');
      ancientEruptionBlast(theme.seamColor, { x, y }, w, pal);
      // ONE crisp, short burst of the Runeforge landing dust from the hero power, in the theme's light colour. Its
      // life is cut by the "Hero-power dust life" dial so it has played out before the panels are in: no fog.
      const burst = ancientLandDust(theme.seamColor, { x, y }, c.hpDustLife);
      if (burst) hpFx.current.push(burst);
    }, c.omenMs));
    // The panels' own clock (`panelTimeline`). They carry no title: "An Ancient Awakens" (and its sting) arrive with
    // the select screen (owner 2026-11-18). The `title` beat is the moment all six are in.
    const tl = panelTimeline(c);
    timers.current.push(window.setTimeout(() => go('title', seq), c.omenMs + tl.allIn));
    timers.current.push(window.setTimeout(() => { playCue('titleSting'); toReveal(seq); }, c.omenMs + tl.revealAt));
  }, [go, toReveal]);

  // While the awakening is up, the page is in its modal layering (`.app`'s stacking context dissolved, as every Discover
  // does, so the offer sorts above this layer) and the Shop row steps back. Also covers a tuner demo (no run offer).
  // While it closes, the Shop row fades back in step with the backdrop (`ancclosing`, `--anc-pick-fade`).
  useEffect(() => {
    document.body.classList.toggle('ancgate', phase !== 'idle');
    document.body.classList.toggle('ancclosing', phase === 'closing');
    if (phase === 'closing') document.body.style.setProperty('--anc-pick-fade', `${pickTimeline().fade}ms`);
    return () => { document.body.classList.remove('ancgate'); document.body.classList.remove('ancclosing'); };
  }, [phase]);

  // No click-to-skip (owner 2026-09-26: "remove the click to skip in the animation, that is not necessary"): the
  // cinematic always plays through. Clicks during it are swallowed so nothing underneath reacts.
  useEffect(() => {
    if (phase !== 'omen' && phase !== 'eruption' && phase !== 'title') return;
    const swallow = (e: PointerEvent): void => { e.stopPropagation(); };
    window.addEventListener('pointerdown', swallow, true);
    return () => window.removeEventListener('pointerdown', swallow, true);
  }, [phase]);

  // OPEN for a fresh offer once the ring has pinged and nothing else holds the screen.
  useEffect(() => {
    if (!offerOpen || blocked || settled < offerSeq || seqRef.current === offerSeq) return;
    start(offerSeq);
  }, [offerOpen, blocked, settled, offerSeq, start]);

  // SETTLED (reported by the offer once its Ancients have landed): the ambient hum comes in under the music.
  useEffect(() => {
    if (stage.stage === 'settled' && stage.seq === seqRef.current && phase !== 'settled' && phase !== 'closing') {
      setPhase('settled');
      hum.current?.stop(100);
      hum.current = playCue('ambientHum', 0, { loop: true, fadeInMs: 900 });
    }
  }, [stage, phase]);

  // THE PICK: the backdrop fades off while the chosen card slams into the hero power (`ancientPickSlam.ts`, started by
  // the offer's click); the music comes back on the impact, and the gate goes idle once the slam has played.
  const close = useCallback(() => {
    if (closingRef.current) return; // the offer clearing and the stage both ask; once is enough
    closingRef.current = true;
    clearTimers();
    retireHpFx();
    rumble.current?.stop(300); rumble.current = null;
    hum.current?.stop(300); hum.current = null;
    setPhase('closing');
    setAwakenStage('closing', seqRef.current);
    const t = pickTimeline();
    timers.current.push(window.setTimeout(() => duckForAwakening(false), t.contact));
    timers.current.push(window.setTimeout(() => {
      closingRef.current = false;
      setPhase('idle'); setGeo(null); setAwakenStage('idle', 0);
    }, t.end));
  }, []);
  // The real offer answered → close. A demo's pick asks for it through the stage.
  useEffect(() => {
    if (seqRef.current > 0 && !offerOpen && phase !== 'idle' && phase !== 'closing') close();
  }, [offerOpen, phase, close]);
  useEffect(() => {
    if (stage.stage === 'closing' && phase !== 'closing' && phase !== 'idle') close();
  }, [stage, phase, close]);
  // Never over a fight or a curtain.
  useEffect(() => {
    if (run.phase !== 'recruit' && phase !== 'idle') {
      clearTimers(); rumble.current?.stop(150); hum.current?.stop(150); duckForAwakening(false); retireHpFx();
      closingRef.current = false;
      setPhase('idle'); setGeo(null); setAwakenStage('idle', 0);
    }
  }, [run.phase, phase]);

  // The tuner's ▶ Play full sequence / ▶ Play from reveal.
  useEffect(() => {
    if (!demo || blocked || offerOpen) return;
    start(-demo.seq, demo.mode === 'reveal', demo.hero, demo.offer);
    // Auto-close a demo that nobody picks from, after a while.
    const t = window.setTimeout(() => { if (getAwakenStage().seq === -demo.seq) setAwakenStage('closing', -demo.seq); }, 14000);
    return () => window.clearTimeout(t);
  }, [demo, blocked, offerOpen, start]);

  // One-shot animations per beat, before paint.
  useLayoutEffect(() => {
    const c = getAncientsConfig();
    const reduced = prefersReducedMotion();
    if (!geo) return;
    const bg = bgRef.current;
    if (phase === 'omen') {
      const om = omenRef.current;
      // The vignette CREEPS IN from the edges toward the hero power (a pre-rendered radial layer, scaled + faded).
      om?.querySelector('.anc-omen-vignette')?.animate([
        { opacity: 0, transform: 'scale(1.6)' }, { opacity: c.omenDark, transform: 'scale(1)' },
      ], { duration: c.omenMs, easing: 'cubic-bezier(0.3, 0, 0.6, 1)', fill: 'forwards' });
      om?.querySelector('.anc-omen-halo')?.animate([
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.5)' }, { opacity: 0.95, transform: 'translate(-50%, -50%) scale(1.25)' },
      ], { duration: c.omenMs, easing: 'ease-in', fill: 'forwards' });
      // The rune ring turns slowly around the hero power while its glyphs flicker alight.
      om?.querySelector('.anc-omen-ring')?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(38deg)' }], { duration: c.omenMs + 520, easing: 'linear', fill: 'forwards' });
      om?.querySelectorAll<SVGElement>('.anc-omen-glyph').forEach((g, i) => {
        const d = (i / N_GLYPHS) * c.omenMs * 0.35;
        g.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.45, offset: 0.35 }, { opacity: 1, offset: 0.5 }, { opacity: 0.6, offset: 0.7 }, { opacity: 1 }],
          { duration: Math.max(200, c.omenMs - d), delay: d, fill: 'both' });
      });
      // (No cracks of light across the board: owner 2026-11-18, "i want to remove these tendrils".)
      // A light tremor on the board ART only: the fixed `.boardbg` layers are leaves, so moving them shifts nothing
      // else. NEVER transform `.app` or any ancestor of fixed UI: that makes a new containing block for every fixed
      // descendant and collapses the stage scaler (the 21:9 layout shrank into a 16:9 box, owner report 2026-09-25).
      if (c.omenTremor > 0) {
        const k = c.omenTremor;
        const frames: Keyframe[] = [];
        for (let f = 0; f <= 14; f++) {
          const amp = k * (f / 14);
          frames.push({ translate: f === 14 ? '0 0' : `${rnd(-amp, amp).toFixed(2)}px ${rnd(-amp, amp).toFixed(2)}px` });
        }
        document.querySelectorAll<HTMLElement>('.boardbg').forEach((el) => { if (typeof el.animate === 'function') el.animate(frames, { duration: c.omenMs, easing: 'linear' }); });
      }
      // Motes pulled INTO the hero power from across the scene.
      wipeFx.inhale(geo.x, geo.y, Math.max(360, geo.r * 0.5), c.omenMs, geo.pal);
      om?.querySelectorAll<HTMLElement>('.anc-omen-ember').forEach((e) => {
        const d = rnd(0, c.omenMs * 0.6);
        e.animate([{ opacity: 0, transform: 'translate(-50%, -50%)' }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: `translate(calc(-50% + ${rnd(-30, 30)}px), calc(-50% - ${rnd(110, 240)}px))` }],
          { duration: rnd(700, 1200), delay: d, easing: 'ease-out', fill: 'both' });
      });
    } else if (phase === 'eruption') {
      // The omen's layer (vignette, glyphs) gives way under the explosion: nothing of it rides over the panels.
      omenRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-out', fill: 'forwards' });
      flashRef.current?.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(0.3)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.18 }, { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)' }],
        { duration: 520, easing: 'ease-out', fill: 'forwards' });
      // The Shop darkens under the explosion (the backdrop fades in whole).
      bg?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 80, easing: 'ease-out', fill: 'both' });
    } else if (phase === 'reveal') {
      if (reduced) { bg?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'forwards' }); }
    } else if (phase === 'closing') {
      // A clean opacity fade back to the Shop (owner 2026-09-27), in step with the offer's own fade.
      bg?.getAnimations().forEach((a) => a.cancel());
      bg?.animate([{ opacity: reduced ? 1 : Number(getComputedStyle(bg).opacity) || 1 }, { opacity: 0 }], { duration: pickTimeline(c, reduced).fade, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    }
  }, [phase, geo]);

  // Ember starts, fixed per awakening (not per render, so nothing jumps between beats).
  const embers = useMemo(() => { const g = geo && stageGeo(geo); return g ? Array.from({ length: N_EMBERS }, () => ({ left: g.x + rnd(-g.hp * 0.45, g.hp * 0.45), top: g.y + rnd(-g.hp * 0.2, g.hp * 0.35) })) : []; }, [geo]);
  if (!geo || phase === 'idle') return null;
  const sg = stageGeo(geo); // DOM writes below are stage px; `geo` stays screen px for wipeFx
  const reduced = prefersReducedMotion();
  const centreOn = !reduced && (phase === 'eruption' || phase === 'title' || phase === 'reveal');
  const ring = sg.hp * 0.95;
  return createPortal(
    <div className="anc-gate" aria-hidden="true" style={{
      '--gx': `${sg.x}px`, '--gy': `${sg.y}px`,
      '--anc-cin': theme.curtainInner, '--anc-cout': theme.curtainOuter, '--anc-seam': theme.seamColor, '--anc-tglow': theme.titleGlow, '--anc-tint': theme.backdropTint,
    } as CSSProperties}>
      {/* The Discover view's backdrop: what the awakening ends on, under the offer. */}
      {phase !== 'omen' && (
        <div ref={bgRef} className="anc-gate-bg" style={reduced ? { opacity: 0 } : undefined} />
      )}
      {/* OMEN: darkening edges, glyphs flickering around the hero power, embers drifting up from it. */}
      {(phase === 'omen' || phase === 'eruption') && !reduced && (
        <div ref={omenRef} className="anc-omen">
          <div className="anc-omen-vignette" style={{ transformOrigin: `${sg.x}px ${sg.y}px` }} />
          <div className="anc-omen-halo" style={{ left: sg.x, top: sg.y, width: sg.hp * 3.4, height: sg.hp * 3.4 }} />
          <div className="anc-omen-ring" style={{ left: sg.x, top: sg.y }}>
            {Array.from({ length: N_GLYPHS }, (_, i) => {
              const a = (i / N_GLYPHS) * Math.PI * 2 - Math.PI / 2;
              return (
                <svg key={`g${i}`} className="anc-omen-glyph" viewBox="0 0 24 24" style={{ left: Math.cos(a) * ring, top: Math.sin(a) * ring }}>
                  <path d={GLYPHS[i % GLYPHS.length]} />
                </svg>
              );
            })}
          </div>
          {embers.map((e, i) => <span key={`e${i}`} className="anc-omen-ember" style={{ left: e.left, top: e.top }} />)}
        </div>
      )}
      {/* ERUPTION: the flash from the hero power. */}
      {phase === 'eruption' && !reduced && (
        <>
          <div ref={flashRef} className="anc-erupt-flash" style={{ left: sg.x, top: sg.y }} />
        </>
      )}
      {centreOn && <AncientPanels offered={panels} phase={phase as 'eruption' | 'title' | 'reveal'} />}
    </div>,
    stageHost(),
  );
});
