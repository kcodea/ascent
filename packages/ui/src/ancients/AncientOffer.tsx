import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ANCIENTS, ancientOfferText, type Action, type AncientId, type RunState } from '@game/sim';
import { OfferBanner } from '../discoverEntrance/OfferBanner';
import { AncientCard } from './AncientCard';
import { playAwakenDemo, prefersReducedMotion, setAwakenStage, useAwakenStage } from './ancientsFx';
import { pickTimeline, playPickSlam } from './ancientPickSlam';
import { ancientColor, getAncientsConfig, revealStyleOf } from './ancientsConfig';
import { playCue } from './ancientsSound';
import { ancientRevealBurst, ancientRevealSpark } from './ancientsSmoke';
import { toStage } from '../stage';
import '../discoverEntrance/discoverEntrance.css';
import './ancients.css';

/**
 * THE ANCIENTS' REVEAL: its own emergence, not the standard Discover entrance (owner 2026-09-25: "make the discover
 * animation unique to the ancients in timing, sound and appearance"). Mounted by the awakening (`AncientGate`) on its
 * `reveal` beat, over the Discover view's backdrop:
 *   · the curtain's title hands off to the banner (one title, rising into place);
 *   · each Ancient REVEALS OUT OF A SPARK (owner 2026-09-27; the rise-and-slam was retired the same day): a point of its
 *     colour gathers, bursts, and the card appears out of the light, overexposed and settling. The middle first, then
 *     the sides left → right. Three styles (`revealStyle`, the ✦ tuner): burst / seam / bloom;
 *   · the name, then the effect, after the card; "Choose one" once all are present; a slow transform-only idle float.
 * A card takes its click only once every Ancient is present. WAAPI transform / opacity (and the seam style's one-shot
 * clip), scheduled up front; Pixi one-shots. Reduced motion: a plain fade, sounds kept.
 */
const DEMO_OFFER: AncientId[] = ['death', 'fortune', 'war'];

/** The idle float + hover dim dials, as the CSS reads them. */
function idleVars(): CSSProperties {
  const c = getAncientsConfig();
  return { '--anc-idle-px': String(c.idleFloat), '--anc-idle-ms': `${c.idleMs}ms`, '--anc-hover-dim': String(c.hoverDim) } as CSSProperties;
}

export const AncientOfferOverlay = memo(function AncientOfferOverlay({ held, run, dispatch }: {
  held: boolean; run: RunState; dispatch: (a: Action) => void;
}) {
  const realOffer = run.ancientsEnabled ? run.ancients?.offer : undefined;
  const offerSeq = run.ancients?.offerSeq ?? 0;
  const stage = useAwakenStage();
  const demo = stage.seq < 0;
  const inReveal = (stage.stage === 'reveal' || stage.stage === 'settled') && (demo || stage.seq === offerSeq);
  // THE PICK (owner 2026-09-27): the reveal stays up while the awakening CLOSES, so the chosen card can fly into the
  // hero power and the rest fade with the backdrop. The run's offer is already gone by then, so the last one shown
  // is kept for its seq.
  const shown = useRef<{ seq: number; offer: AncientId[] } | null>(null);
  const live = demo ? DEMO_OFFER : realOffer;
  if (inReveal && live?.length) shown.current = { seq: stage.seq, offer: live };
  const closing = stage.stage === 'closing' && shown.current?.seq === stage.seq;
  const offer = closing ? shown.current!.offer : live;
  // Safety net: an awakening that never reaches its reveal (the hero power not on screen) still releases the offer.
  const [timedOut, setTimedOut] = useState(0);
  useEffect(() => {
    if (!realOffer?.length) return;
    const c = getAncientsConfig();
    const id = window.setTimeout(() => setTimedOut(offerSeq), 6000 + c.omenMs + c.eruptionMs + c.titleHoldMs);
    return () => window.clearTimeout(id);
  }, [realOffer, offerSeq]);
  if (!offer?.length || held || run.phase !== 'recruit') return null;
  if (!inReveal && !closing && !(timedOut === offerSeq && !demo)) return null;
  return <Reveal key={`${stage.seq}`} gated={inReveal || closing} closing={closing} offer={offer} heroId={run.heroId} seq={demo ? stage.seq : offerSeq}
    onPick={(id, el) => {
      // The slam measures the card where it was clicked, before anything re-renders; the awakening then closes
      // (the backdrop fades) in the same render as the pick lands in the run.
      playPickSlam(el as HTMLElement, id);
      if (inReveal) setAwakenStage('closing', stage.seq);
      if (demo) playAwakenDemo(id, pickTimeline().end + 3000); // a demo's hero power splits too, run untouched
      else dispatch({ type: 'pickAncient', id });
    }} />;
});

function Reveal({ gated, closing, offer, heroId, seq, onPick }: { gated: boolean; closing: boolean; offer: AncientId[]; heroId: string; seq: number; onPick: (id: AncientId, el: Element) => void }): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const anims = useRef<Animation[]>([]);
  const timers = useRef<number[]>([]);
  const [landed, setLanded] = useState<boolean[]>(() => offer.map(() => false));
  const [settled, setSettled] = useState(false);
  const picked = useRef<Element | null>(null);
  const style = revealStyleOf(getAncientsConfig().revealStyle);

  // THE PICK: everything but the chosen card fades off with the backdrop (the card itself is collapsing, see
  // `ancientPickSlam.ts`). One-shot opacity.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!closing || !root) return;
    const { fade } = pickTimeline();
    const going = [root.querySelector('.disc-ornate'), ...Array.from(root.querySelectorAll('.anc-card')).filter((el) => el !== picked.current)];
    for (const el of going) {
      if (el && typeof (el as HTMLElement).animate === 'function') (el as HTMLElement).animate([{ opacity: 1 }, { opacity: 0 }], { duration: fade, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    }
  }, [closing]);

  // Once per reveal (the component is keyed by the awakening's seq).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const c = getAncientsConfig();
    const reduced = prefersReducedMotion();
    const push = (a: Animation | undefined | null): void => { if (a) anims.current.push(a); };
    const anim = (el: Element | null | undefined, k: Keyframe[], o: KeyframeAnimationOptions): void => {
      if (el && typeof (el as HTMLElement).animate === 'function') push((el as HTMLElement).animate(k, o));
    };
    const at = (ms: number, fn: () => void): void => { timers.current.push(window.setTimeout(fn, ms)); };
    const land = (i: number): void => setLanded((l) => l.map((v, k) => (k === i ? true : v)));
    const finish = (total: number): void => { at(total, () => { setSettled(true); setAwakenStage('settled', seq); }); };

    // THE TITLE HANDS OFF: the curtain's centred "An Ancient Awakens" is not faded out while a second copy fades in at
    // the top: the banner is BORN where the curtain's title stands (same centre, same size) and rises into its place as
    // the curtain drops, so the eye rides the title up and lands on the first spark. One layout read of each, now.
    const banner = root.querySelector<HTMLElement>('.disc-ornate');
    if (banner) {
      const from = reduced ? null : document.querySelector('.anc-gate-title .anc-gate-label')?.getBoundingClientRect();
      const bt = banner.querySelector('.disc-ornate-title')?.getBoundingClientRect();
      const br = banner.getBoundingClientRect();
      if (from && bt && from.width > 0 && bt.width > 0 && c.handoffMs > 0) {
        const dx = toStage(from.left + from.width / 2 - (br.left + br.width / 2));
        const dy = toStage(from.top + from.height / 2 - (bt.top + bt.height / 2));
        const sc = Math.max(0.3, Math.min(3, from.width / bt.width));
        anim(banner, [
          { opacity: 0.4, transform: `translateX(-50%) translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sc.toFixed(3)})` },
          { opacity: 1, offset: 0.12 },
          { opacity: 1, transform: 'translateX(-50%)' },
        ], { duration: c.handoffMs, easing: 'cubic-bezier(0.5, 0, 0.15, 1)', fill: 'backwards' });
      } else {
        anim(banner, [{ opacity: 0, transform: 'translateX(-50%) translateY(10px)' }, { opacity: 1, transform: 'translateX(-50%)' }], { duration: 400, easing: 'ease-out', fill: 'backwards' });
      }
    }

    const slots = Array.from(root.querySelectorAll<HTMLElement>('.anc-slot'));
    // ONE layout read, at rest (nothing has moved yet): each Ancient's art centre, where its spark lights.
    const cores = slots.map((sl) => {
      const r = (sl.querySelector('.anc-art-frame') ?? sl).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    });

    if (reduced) {
      slots.forEach((slot, i) => {
        anim(slot.querySelector('.anc-card'), [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: i * 120, fill: 'backwards' });
        playCue('cardReveal', i * 120, { rateMul: 1 - i * 0.07 });
        at(i * 120 + 260, () => land(i));
      });
      finish(slots.length * 120 + 260);
      return () => { for (const t of timers.current) window.clearTimeout(t); for (const a of anims.current) a.cancel(); anims.current = []; };
    }

    // THE NAME, THEN THE EFFECT, rising in once the card has resolved (so the art arrives alone and the words read in
    // order). Scheduled up front; `fill: backwards` holds them hidden.
    const textIn = (i: number, fromMs: number): void => {
      if (c.textInMs <= 0) return;
      const card = slots[i]?.querySelector('.anc-cardx');
      for (const [sel, off] of [['.anc-cardx-name', 0], ['.anc-cardx-rulebar', 60], ['.anc-cardx-rule', 90]] as const) {
        anim(card?.querySelector(sel), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: c.textInMs, delay: Math.max(0, fromMs + off), easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'backwards' });
      }
    };

    /**
     * ONE ANCIENT OUT OF ITS SPARK (owner 2026-09-27: "if they revealed out of the spark or something that may be
     * cool? i think the rise and slam in general is pretty bad"). From `t0`:
     *   SPARK    a crisp star-point of its colour lights where the card will stand; motes are drawn in and a faint ring
     *            contracts onto it (`ancient-reveal-spark`), the point tightening: the anticipation (`sparkMs`).
     *   BURST    it bursts: the pick's own ring (`ancient-pick-impact`) and the reveal's turbulent sparks
     *            (`ancient-slam-sparks`), in its colour, and the card appears OUT of the light, by the style:
     *              burst  the card expands from the spark's centre, a hair past full size, and settles;
     *              seam   the spark draws a vertical slash of light that opens like a seam, the card inside it;
     *              bloom  the spark swells into a disc of light filling the art, which resolves into the card;
     *            its art OVEREXPOSED first (a flood of its colour and white) and settling to normal (`overexposeMs`).
     *   TEXT     the name, then the effect.
     * Returns when the card is fully present (clickable).
     */
    const revealOne = (i: number, t0: number): number => {
      const slot = slots[i]!;
      const card = slot.querySelector<HTMLElement>('.anc-card');
      const spark = slot.querySelector<HTMLElement>('.anc-spark');
      const seam = slot.querySelector<HTMLElement>('.anc-seam');
      const col = ancientColor(offer[i]!);
      const core = cores[i]!;
      const burst = t0 + c.sparkMs;
      const M = Math.max(120, c.materialiseMs);
      const fit = Math.max(0.5, Math.min(2.5, core.w / 290));
      at(t0, () => ancientRevealSpark(col, core, fit, c.sparkMs));
      at(burst, () => ancientRevealBurst(col, core, fit));
      // The point of light: in, tightening, then gone into the burst. ONE animation per element (two stacked one-shots
      // with `fill: backwards` let the later one's first frame show the spark before its time: spark pass 1).
      const grow = style === 'bloom';
      const out = grow ? 260 : 200;
      const S = Math.max(1, c.sparkMs), ST = S + out, so = (ms: number): number => Math.min(1, ms / ST);
      const sc = (k: number, r = 0): string => `translate(-50%, -50%) scale(${k}) rotate(${r}deg)`;
      anim(spark, grow
        ? [
          { offset: 0, opacity: 0, transform: sc(0.2), easing: 'cubic-bezier(0.3, 0, 0.5, 1)' },
          { offset: so(S * 0.3), opacity: 1, transform: sc(1), easing: 'cubic-bezier(0.5, 0, 0.8, 0.6)' },
          { offset: so(S), opacity: 1, transform: sc(4.2), easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)' },
          { offset: 1, opacity: 0, transform: sc(5) },
        ]
        : [
          { offset: 0, opacity: 0, transform: sc(0.2, 0), easing: 'cubic-bezier(0.3, 0, 0.5, 1)' },
          { offset: so(S * 0.4), opacity: 1, transform: sc(1.15, 20), easing: 'cubic-bezier(0.3, 0, 0.5, 1)' },
          { offset: so(S), opacity: 1, transform: sc(0.7, 45), easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)' },
          { offset: 1, opacity: 0, transform: sc(3, 45) },
        ], { duration: ST, delay: t0, fill: 'backwards' });
      // The card, out of the light.
      if (style === 'seam') {
        // The slash draws through the spark, then opens: the card is clipped to a widening vertical opening.
        const inMs = Math.round(S * 0.55), outMs = Math.round(M * 0.6), SE = inMs + outMs;
        anim(seam, [
          { offset: 0, opacity: 0, transform: 'translate(-50%, -50%) scale(1, 0)', easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
          { offset: inMs / SE, opacity: 1, transform: 'translate(-50%, -50%) scale(1, 1)', easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
          { offset: 1, opacity: 0, transform: 'translate(-50%, -50%) scale(14, 1)' },
        ], { duration: SE, delay: burst - inMs, fill: 'backwards' });
        anim(card, [
          { opacity: 1, clipPath: 'inset(0 50% 0 50% round 6%)' },
          { opacity: 1, clipPath: 'inset(0 0 0 0 round 6%)' },
        ], { duration: Math.round(M * 0.75), delay: burst, easing: 'cubic-bezier(0.2, 0.8, 0.25, 1)', fill: 'backwards' });
      } else if (style === 'bloom') {
        anim(card, [
          { opacity: 0, transform: 'scale(0.97)' },
          { opacity: 1, transform: 'scale(1)', offset: 0.45 },
          { opacity: 1, transform: 'scale(1)' },
        ], { duration: M, delay: burst - 40, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'backwards' });
      } else {
        anim(card, [
          { opacity: 0, transform: 'scale(0.06)', easing: 'cubic-bezier(0.12, 0.8, 0.3, 1)' },
          { opacity: 1, offset: 0.12 },
          { opacity: 1, transform: 'scale(1.03)', offset: 0.62, easing: 'cubic-bezier(0.4, 0, 0.3, 1)' },
          { opacity: 1, transform: 'scale(1)' },
        ], { duration: M, delay: burst, fill: 'backwards' });
        // It opens as a DISC of light, not a growing square (the pick's collapse, reversed): a one-shot round clip from
        // the spark's point, gone once it covers the card.
        const cy = `${toStage(core.w / 2).toFixed(1)}px`; // the art's centre in the card (the art is its top square)
        anim(card, [
          { clipPath: `circle(0% at 50% ${cy})`, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
          { clipPath: `circle(48% at 50% ${cy})`, offset: 0.55, easing: 'ease-in' },
          { clipPath: `circle(100% at 50% ${cy})` },
        ], { duration: Math.round(M * 0.8), delay: burst, fill: 'backwards' });
      }
      // OVEREXPOSED, then settling: a flood of its colour and white over the art, held a moment, resolving away.
      if (c.landFlash > 0) {
        anim(slot.querySelector('.anc-land-flash'), [
          { opacity: c.landFlash },
          { opacity: c.landFlash, offset: 0.18 },
          { opacity: 0 },
        ], { duration: c.overexposeMs, delay: burst, easing: 'cubic-bezier(0.3, 0, 0.3, 1)', fill: 'backwards' });
      }
      textIn(i, burst + Math.round(M * 0.55));
      at(burst + M, () => land(i));
      return burst + M;
    };

    // THE ORDER: the middle first (the eye is already at the centre, under the title), then the sides left → right, a
    // short stagger apart, so the eye sweeps outward in reading order.
    const mid = Math.floor((slots.length - 1) / 2);
    const midT0 = Math.max(0, c.revealDelayMs);
    let end = revealOne(mid, midT0);
    const sideT0 = midT0 + c.sparkMs + Math.max(0, c.sideDelayMs);
    let k = 0;
    slots.forEach((_, i) => { if (i !== mid) end = Math.max(end, revealOne(i, sideT0 + k++ * Math.max(0, c.sideStaggerMs))); });
    // THE SOUND OF A MAGIC REVEAL, not a slam (owner 2026-09-27: "the sounds can be replaced with something a bit less
    // BOOMING since it's more of a magic reveal"): a rising glow as each spark gathers (`revealSpark`) and a bright
    // sheen as it blooms (`cardReveal`). The middle has its own pair; the two sides SHARE one of each, pitched up a
    // touch, so three reveals never stack three sounds.
    playCue('revealSpark', midT0);
    playCue('cardReveal', Math.max(0, midT0 + c.sparkMs - 20));
    if (slots.length > 1) {
      playCue('revealSpark', sideT0, { rateMul: 1.08 });
      playCue('cardReveal', Math.max(0, sideT0 + c.sparkMs - 20), { rateMul: 1.12 });
    }
    finish(end);
    return () => { for (const t of timers.current) window.clearTimeout(t); for (const a of anims.current) a.cancel(); anims.current = []; };
  }, []);

  return (
    <div ref={rootRef} className={`discover-ov dce disc-look anc-offer rs-${style}${gated ? ' gated' : ''}${settled ? ' settled' : ''}${closing ? ' closing' : ''}`} role="dialog" aria-label="An Ancient Awakens"
      style={idleVars()}
      onPointerDownCapture={(e) => {
        // No click-to-skip (owner 2026-09-26): a click during the emergence is swallowed and the reveal plays through.
        if (!settled) { e.stopPropagation(); e.preventDefault(); }
      }}>
      <div className="disc-panel">
        <OfferBanner title="An Ancient Awakens" />
        <div className="disc-cards anc-cards">
          {offer.map((id, i) => (
            <div className="disc-slot anc-slot" key={id} style={{ '--anc-c': ancientColor(id) } as CSSProperties}>
              <button type="button" className="anc-card" disabled={!landed[i]}
                aria-label={`${ANCIENTS[id].name}: ${ancientOfferText(heroId, id).replace(/\*\*/g, '')}`}
                onClick={(e) => { if (landed[i] && !closing && !picked.current) { picked.current = e.currentTarget; onPick(id, e.currentTarget); } }}>
                <AncientCard id={id} heroId={heroId} />
                {/* The overexposure: inside the card, so it rides the card's own motion. */}
                <span className="anc-land-flash" aria-hidden="true" />
              </button>
              <span className="anc-spark" aria-hidden="true" />
              {style === 'seam' && <span className="anc-seam" aria-hidden="true" />}
            </div>
          ))}
        </div>
        {/* THE INVITATION: once every Ancient is present, a quiet line says the choice is open. */}
        <div className={`anc-choose${settled && !closing ? ' in' : ''}`} aria-hidden="true">Choose one</div>
      </div>
    </div>
  );
}
