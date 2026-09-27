import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RunState } from '@game/sim';
import { useGame } from '../store';
import { wipeFx } from '../wipeFx';
import { wipeAspect, wipeCoverEllipse, wipeFrontScale } from '../wipeGeometry';
import { getAncientsConfig, subscribeAncientsConfig } from './ancientsConfig';
import { getAwakenStage, prefersReducedMotion, setAwakenStage, useAwakenStage, useGateDemo, useRingSettledSeq } from './ancientsFx';
import { duckForAwakening, playCue, warmAncientCues } from './ancientsSound';
import { pickTimeline, warmPickBurst } from './ancientPickSlam';
import { ancientLandDust } from './ancientsSmoke';
import { heroMotePalette, isBloomStyle, isThemedHero, resolveAncientHeroSignature, resolveAncientHeroTheme, type BloomStyle } from './ancientHeroThemes';
import { playHeroBloom } from './ancientHeroBloom';
import { AncientBloomMedal } from './AncientBloom';
import { heroPowerArt } from '../art';
import { stageHost, toStage } from '../stage';

/**
 * THE AWAKENING (owner 2026-09-25: "ominous exciting when the hero power erupts. it should be a moment that the player
 * is so excited for. delay the discover, and make the discover animation unique to the ancients in timing, sound and
 * appearance"). A sealed power breaking open, in five beats — every length a ✦ Ancients tuner dial, every sound a
 * named cue:
 *
 *   OMEN      the world holds its breath: music + other sounds duck, a low rumble swells, the screen's edges darken,
 *             arcane glyphs flicker around the hero power and embers drift up from it (`omenRumble`).
 *   ERUPTION  a deep boom and a flash in the hero's theme from the hero power, one short dust burst in the theme's
 *             seam colour, and the curtain blooming out in the go-to-combat wipe's language (the wipe's
 *             aspect-stretched ellipse, its seam ring — here carrying runes — and `wipeFx` stardust) (`eruptionBoom`,
 *             `eruptionFlash`).
 *             The curtain wears the HERO'S theme (`ancientHeroThemes.ts`, owner 2026-09-26: Indy gold, everyone else the
 *             baked teal) and carries the hero power's art as a round medallion in its middle (a scale/opacity
 *             entrance, riding inside the curtain's clip like the wipe's "Now Facing" portrait).
 *   TITLE     "An Ancient Awakens" rises under the medallion and HOLDS (`titleSting`).
 *   REVEAL    the curtain fades onto the Discover view's backdrop and the offer runs its OWN emergence
 *             (`AncientOffer`: one Ancient at a time out of a flash of its colour, `cardReveal` each).
 *   SETTLED   drifting motes behind the cards and a quiet hum under the (still ducked) music (`ambientHum`).
 *   PICK      the backdrop FADES off (owner 2026-09-27: no more contracting back into the hero power) while the chosen
 *             card collapses into the triple's trail and slams into the hero power (`ancientPickSlam.ts`: collapse,
 *             recoloured `gild-trail`, hit-stop, `pickSeal`, ring, shake) and the crack reveal plays from `AncientSplit`. The duck lets go on the impact.
 *
 * The hero-power button and its art NEVER change; every layer here is separate and only emanates from its position.
 * All one-shot WAAPI (transform / opacity, plus the curtain's one-shot clip, like the wipe's). A click steps it
 * forward (omen / eruption / title → reveal; the offer takes reveal → settled). Never under a curtain, in combat or
 * over another decision overlay. Reduced motion: the backdrop and offer fade, the sounds still play.
 */
type Phase = 'idle' | 'omen' | 'eruption' | 'title' | 'reveal' | 'settled' | 'closing';
interface Geo { x: number; y: number; rx: number; ry: number; r: number; hp: number; art?: string; pal: readonly number[] }
/** `Geo` is SCREEN px (it feeds `wipeFx`, a Pixi layer); the DOM layer (clip ellipses, --gx/--gy, halo, ring, embers,
 *  the 1000px front's scale) takes this STAGE-px copy (stage.ts). Identity when the stage is unscaled. */
const stageGeo = (g: Geo): { x: number; y: number; rx: number; ry: number; hp: number } =>
  ({ x: toStage(g.x), y: toStage(g.y), rx: toStage(g.rx), ry: toStage(g.ry), hp: toStage(g.hp) });

/** The default motes (violet/gold/teal); a themed hero's awakening uses its own (`heroMotePalette`). */
const PALETTE = [0xb58cff, 0xffd98a, 0x7fe3d0, 0xffffff, 0xe6ccff] as const;
const EASE = [0.4, 0, 0.2, 1] as const;
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

/** The hero-power button's centre + width, and the art it is wearing right now (a grant / suit / commission variant
 *  included). Read ONCE when the awakening starts, never per frame. */
function hpBox(): { x: number; y: number; w: number; art?: string } {
  const el = document.querySelector('.statusbar .heropanel .heropowerbtn');
  const r = el?.getBoundingClientRect();
  const art = el?.querySelector<HTMLImageElement>('.hpb-art')?.getAttribute('src') ?? undefined;
  return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, art } : { x: window.innerWidth * 0.2, y: window.innerHeight * 0.55, w: 110, art };
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
  // …and a tuner demo may preview another bloom style on that hero (✦ Ancients › Style).
  const [themeStyle, setThemeStyle] = useState<BloomStyle | undefined>(undefined);
  const theme = useMemo(() => resolveAncientHeroTheme(themeHero ?? run.heroId, cfg as unknown as Record<string, unknown>), [themeHero, run.heroId, cfg]);
  // …and its SIGNATURE (a themed hero's bloom accent + medallion entrance; `null` = the generic entrance).
  const sig = useMemo(() => resolveAncientHeroSignature(themeHero ?? run.heroId, themeStyle), [themeHero, themeStyle, run.heroId]);
  const sigRef = useRef(sig);
  sigRef.current = sig;
  const heroIdRef = useRef(run.heroId);
  heroIdRef.current = run.heroId;
  const [phase, setPhase] = useState<Phase>('idle');
  const [geo, setGeo] = useState<Geo | null>(null);
  const bgRef = useRef<HTMLDivElement | null>(null);
  const curtainRef = useRef<HTMLDivElement | null>(null);
  const frontRef = useRef<HTMLDivElement | null>(null);
  const runesRef = useRef<HTMLDivElement | null>(null);
  const omenRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  const seqRef = useRef(0);
  const closingRef = useRef(false); // the pick's close has begun (see `close`)
  const rumble = useRef<{ stop: (ms?: number) => void } | null>(null);
  const hum = useRef<{ stop: (ms?: number) => void } | null>(null);
  // The hero power's dust burst (retired outright the moment the curtain covers it).
  const hpFx = useRef<(() => void)[]>([]);
  const retireHpFx = (): void => { for (const r of hpFx.current) r(); hpFx.current = []; };
  const clearTimers = (): void => { for (const t of timers.current) window.clearTimeout(t); timers.current = []; };
  const go = useCallback((p: Phase, seq: number) => { setPhase(p); setAwakenStage(p, seq); }, []);
  useEffect(() => { wipeFx.warm(); warmAncientCues(); }, []);
  useEffect(() => () => { clearTimers(); rumble.current?.stop(200); hum.current?.stop(200); duckForAwakening(false); retireHpFx(); }, []);

  /** REVEAL: the curtain gives way to the offer's own emergence. */
  const toReveal = useCallback((seq: number) => {
    clearTimers();
    rumble.current?.stop(500); rumble.current = null;
    retireHpFx();
    go('reveal', seq);
  }, [go]);

  /** Start the sequence for offer `seq` (< 0: a tuner demo). `fromReveal` jumps straight to the Ancients. */
  const start = useCallback((seq: number, fromReveal = false, asHero?: string, asStyle?: string) => {
    const c = getAncientsConfig();
    const { x, y, w, art } = hpBox();
    const vw = window.innerWidth, vh = window.innerHeight;
    const { rx, ry } = wipeCoverEllipse(x, y, vw, vh, wipeAspect(vw, vh, 1));
    const heroId = asHero ?? heroIdRef.current;
    const theme = resolveAncientHeroTheme(heroId, c as unknown as Record<string, unknown>);
    const pal = heroMotePalette(heroId, theme) ?? PALETTE;
    setThemeHero(asHero);
    const style = isBloomStyle(asStyle) ? asStyle : undefined;
    setThemeStyle(style);
    sigRef.current = resolveAncientHeroSignature(heroId, style);
    setGeo({ x, y, rx, ry, r: Math.max(rx, ry), hp: w, art: (asHero ? heroPowerArt(asHero) : undefined) ?? art ?? heroPowerArt(heroIdRef.current), pal });
    seqRef.current = seq;
    closingRef.current = false;
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
      wipeFx.bloom(x, y, rx, ry, c.eruptionMs, EASE, pal);
      // ONE crisp, short burst of the Runeforge landing dust from the hero power. Its life is
      // cut by the "Hero-power dust life" dial so it has played out by the time the curtain has bloomed: no fog.
      // In the theme's SEAM colour (light): tinted to the curtain centre it read as dark smudges over the bright bloom
      // (whole-sequence pass 2026-09-27).
      const burst = ancientLandDust(theme.seamColor, { x, y }, c.hpDustLife);
      if (burst) hpFx.current.push(burst);
    }, c.omenMs));
    timers.current.push(window.setTimeout(() => { go('title', seq); playCue('titleSting'); }, c.omenMs + c.eruptionMs));
    timers.current.push(window.setTimeout(() => toReveal(seq), c.omenMs + c.eruptionMs + c.titleHoldMs));
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
    start(-demo.seq, demo.mode === 'reveal', demo.hero, demo.style);
    // Auto-close a demo that nobody picks from, after a while.
    const t = window.setTimeout(() => { if (getAwakenStage().seq === -demo.seq) setAwakenStage('closing', -demo.seq); }, 14000);
    return () => window.clearTimeout(t);
  }, [demo, blocked, offerOpen, start]);

  // One-shot animations per beat, before paint.
  useLayoutEffect(() => {
    const c = getAncientsConfig();
    const reduced = prefersReducedMotion();
    if (!geo) return;
    const bg = bgRef.current, curtain = curtainRef.current, front = frontRef.current, runes = runesRef.current;
    const ease = `cubic-bezier(${EASE.join(', ')})`;
    const sg = stageGeo(geo);
    const ell = (k: number): string => `ellipse(${Math.max(0, sg.rx * k)}px ${Math.max(0, sg.ry * k)}px at ${sg.x}px ${sg.y}px)`;
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
      om?.querySelector('.anc-omen-ring')?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(38deg)' }], { duration: c.omenMs + c.eruptionMs, easing: 'linear', fill: 'forwards' });
      om?.querySelectorAll<SVGElement>('.anc-omen-glyph').forEach((g, i) => {
        const d = (i / N_GLYPHS) * c.omenMs * 0.35;
        g.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.45, offset: 0.35 }, { opacity: 1, offset: 0.5 }, { opacity: 0.6, offset: 0.7 }, { opacity: 1 }],
          { duration: Math.max(200, c.omenMs - d), delay: d, fill: 'both' });
      });
      // Cracks of light spreading across the board toward the hero power (a one-shot dash draw on static paths).
      om?.querySelectorAll<SVGPolylineElement>('.anc-omen-crack').forEach((p, i) => {
        p.animate([{ strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 0.35, opacity: 1, offset: 0.6 }, { strokeDashoffset: 0, opacity: 0.85 }],
          { duration: c.omenMs * 0.8, delay: c.omenMs * 0.15 + i * 40, easing: 'ease-in', fill: 'both' });
      });
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
      // The omen's layer (vignette, glyphs, cracks) gives way as the curtain blooms: nothing of it rides over the curtain.
      omenRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-out', fill: 'forwards' });
      flashRef.current?.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(0.3)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.18 }, { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)' }],
        { duration: 520, easing: 'ease-out', fill: 'forwards' });
      curtain?.animate([{ clipPath: ell(0) }, { clipPath: ell(1) }], { duration: c.eruptionMs, easing: ease, fill: 'forwards' });
      // The hero power's art settles into the middle of the bloom as it opens, in the hero's own way, with the hero's
      // signature accent round it (`ancientHeroBloom.ts`; the default keeps the generic scale/fade). Transform/opacity
      // one-shots only, all done inside the title hold.
      playHeroBloom(curtain?.querySelector('.anc-gate-medalwrap'), sigRef.current, c);
      // The backdrop rides the curtain's own ellipse, so nothing leads the seam.
      bg?.animate([{ clipPath: ell(0) }, { clipPath: ell(1) }], { duration: c.eruptionMs, easing: ease, fill: 'forwards' });
      const sx = wipeFrontScale(sg.rx), sy = wipeFrontScale(sg.ry);
      for (const el of [front, runes]) {
        el?.animate([
          { transform: 'scale(0.004) rotate(0deg)', opacity: c.seamGlow },
          { transform: `scale(${sx}, ${sy}) rotate(40deg)`, opacity: c.seamGlow, offset: 0.85 },
          { transform: `scale(${sx}, ${sy}) rotate(46deg)`, opacity: 0 },
        ], { duration: c.eruptionMs, easing: ease, fill: 'forwards' });
      }
    } else if (phase === 'reveal') {
      if (bg) bg.style.clipPath = 'none';
      if (reduced) { bg?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'forwards' }); }
      if (curtain) {
        curtain.getAnimations().forEach((a) => a.finish());
        // Holds, then DROPS (ease-in), so it never lingers half-transparent over the dim backdrop: an ease-out fade
        // spent most of its time as a murky mid-tone (whole-sequence pass 2026-09-27).
        curtain.animate([{ opacity: 1 }, { opacity: 0 }], { duration: c.revealFadeMs, easing: 'cubic-bezier(0.45, 0, 0.9, 0.55)', fill: 'forwards' });
        // The TITLE leaves at once: the offer's banner is born exactly where it stands and carries it up (a FLIP, see
        // `AncientOffer`), so there is only ever one title on screen. The medallion fades with the curtain.
        const handoff = c.handoffMs > 0;
        curtain.querySelector('.anc-gate-title')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: handoff ? 50 : 160, easing: 'ease-out', fill: 'forwards' });
        curtain.querySelector('.anc-gate-medalwrap')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
      }
    } else if (phase === 'closing') {
      // A clean opacity fade back to the Shop (owner 2026-09-27), in step with the offer's own fade.
      bg?.getAnimations().forEach((a) => a.cancel());
      bg?.animate([{ opacity: reduced ? 1 : Number(getComputedStyle(bg).opacity) || 1 }, { opacity: 0 }], { duration: pickTimeline(c, reduced).fade, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    }
  }, [phase, geo]);

  // Cracks of light: jagged paths from points across the board toward the hero power, fixed per awakening.
  const cracks = useMemo(() => {
    if (!geo) return [] as string[];
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      const sx = rnd(window.innerWidth * 0.3, window.innerWidth * 0.85), sy = rnd(window.innerHeight * 0.15, window.innerHeight * 0.85);
      const pts: string[] = [];
      const n = 7;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = sx + (geo.x - sx) * t * 0.8 + (k > 0 && k < n ? rnd(-22, 22) : 0);
        const y = sy + (geo.y - sy) * t * 0.8 + (k > 0 && k < n ? rnd(-22, 22) : 0);
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      out.push(pts.join(' '));
    }
    return out;
  }, [geo]);
  // Ember starts, fixed per awakening (not per render, so nothing jumps between beats).
  const embers = useMemo(() => { const g = geo && stageGeo(geo); return g ? Array.from({ length: N_EMBERS }, () => ({ left: g.x + rnd(-g.hp * 0.45, g.hp * 0.45), top: g.y + rnd(-g.hp * 0.2, g.hp * 0.35) })) : []; }, [geo]);
  if (!geo || phase === 'idle') return null;
  const sg = stageGeo(geo); // DOM writes below are stage px; `geo` stays screen px for wipeFx
  const reduced = prefersReducedMotion();
  const curtainOn = !reduced && (phase === 'eruption' || phase === 'title' || phase === 'reveal');
  const ring = sg.hp * 0.95;
  return createPortal(
    <div className="anc-gate" aria-hidden="true" style={{
      '--gx': `${sg.x}px`, '--gy': `${sg.y}px`,
      '--anc-cin': theme.curtainInner, '--anc-cout': theme.curtainOuter, '--anc-seam': theme.seamColor, '--anc-tglow': theme.titleGlow, '--anc-tint': theme.backdropTint,
      // A themed hero's seam ring wears its own colours; the default keeps the baked violet/teal fringe.
      ...(isThemedHero(themeHero ?? run.heroId) ? {
        '--anc-front-in': `color-mix(in srgb, ${theme.curtainInner} 45%, transparent)`, '--anc-front-out': `color-mix(in srgb, ${theme.titleGlow} 45%, transparent)`,
      } : {}),
    } as CSSProperties}>
      {/* The Discover view's backdrop: what the awakening ends on, under the offer. */}
      {phase !== 'omen' && (
        <div ref={bgRef} className="anc-gate-bg" style={reduced || phase === 'reveal' || phase === 'settled' || phase === 'closing' ? (reduced ? { opacity: 0 } : undefined) : { clipPath: `ellipse(0px 0px at ${sg.x}px ${sg.y}px)` }} />
      )}
      {/* OMEN: darkening edges, glyphs flickering around the hero power, embers drifting up from it. */}
      {(phase === 'omen' || phase === 'eruption') && !reduced && (
        <div ref={omenRef} className="anc-omen">
          <div className="anc-omen-vignette" style={{ transformOrigin: `${sg.x}px ${sg.y}px` }} />
          {/* Screen-px viewBox stretched over the stage-px layer: the crack points (from screen `geo`) map correctly. */}
          <svg className="anc-omen-cracks" viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`} preserveAspectRatio="none">
            {cracks.map((pts, i) => <polyline key={i} className="anc-omen-crack" points={pts} pathLength={1} strokeDasharray="1" />)}
          </svg>
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
      {curtainOn && (
        <div ref={curtainRef} className="anc-gate-curtain" style={phase === 'reveal' ? undefined : { clipPath: `ellipse(0px 0px at ${sg.x}px ${sg.y}px)` }}>
          <div className="anc-gate-center">
            {geo.art && (
              <AncientBloomMedal art={geo.art} sig={sig} hidden={!reduced && phase === 'eruption'} />
            )}
            <div className={`anc-gate-title${phase === 'title' || phase === 'reveal' ? ' in' : ''}`}>
              <span className="anc-gate-label">An Ancient Awakens</span>
            </div>
          </div>
        </div>
      )}
      {phase === 'eruption' && !reduced && (
        <>
          <div ref={frontRef} className="anc-gate-front" />
          <div ref={runesRef} className="anc-gate-runes">
            <svg viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="482" /></svg>
          </div>
        </>
      )}
    </div>,
    stageHost(),
  );
});
