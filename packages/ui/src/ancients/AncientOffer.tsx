import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ANCIENTS, ancientOfferText, type Action, type AncientId, type RunState } from '@game/sim';
import { OfferBanner } from '../discoverEntrance/OfferBanner';
import { AncientCard } from './AncientCard';
import { playAwakenDemo, prefersReducedMotion, setAwakenStage, useAwakenStage } from './ancientsFx';
import { pickTimeline, playPickSlam } from './ancientPickSlam';
import { ancientColor, getAncientsConfig } from './ancientsConfig';
import { playCue } from './ancientsSound';
import { ancientLandDust, ancientSlam, ancientSlamSparks } from './ancientsSmoke';
import { toStage } from '../stage';
import '../discoverEntrance/discoverEntrance.css';
import './ancients.css';

/**
 * THE ANCIENTS' REVEAL — its own emergence, not the standard Discover entrance (owner 2026-09-25: "make the discover
 * animation unique to the ancients in timing, sound and appearance"). Mounted by the awakening (`AncientGate`) on its
 * `reveal` beat, over the Discover view's backdrop:
 *   · the gold banner fades in;
 *   · TWO BEATS (the default, `revealStyle` 1): the middle Ancient rises up the centre and SLAMS (a weighty settle, a
 *     card shake, the `ancient-slam` shockwave and ONE puff of the Runeforge landing dust in its colour, one
 *     `cardReveal`); after a gap the left and right slide out from BEHIND it and slam together (one shared
 *     `cardReveal`, a shockwave + dust puff at each). SEQUENTIAL (`revealStyle` 0): left → middle → right;
 *   · once all have landed it reports `settled`. No particles on the settled screen (owner 2026-09-25).
 * A card takes its click only once it has landed. A click during the emergence completes it (the cinematic's second
 * skip). WAAPI transform / opacity only, scheduled up front.
 * Reduced motion: a plain fade, sounds kept.
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

  // THE PICK: everything but the chosen card fades off with the backdrop (the card itself is flying, see
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
    const push = (a: Animation | undefined): void => { if (a) anims.current.push(a); };
    const at = (ms: number, fn: () => void): void => { timers.current.push(window.setTimeout(fn, ms)); };
    const land = (i: number): void => setLanded((l) => l.map((v, k) => (k === i ? true : v)));
    // THE TITLE HANDS OFF (reveal pass 2026-09-27): the curtain's centred "An Ancient Awakens" does not fade out while a
    // second copy fades in at the top: the banner is BORN where the curtain's title stands (same centre, same size) and
    // rises into its place as the curtain drops, so the eye rides the title up and lands on the cards. One layout read
    // of each, now; a transform/opacity one-shot.
    const banner = root.querySelector<HTMLElement>('.disc-ornate');
    if (banner && typeof banner.animate === 'function') {
      const from = reduced ? null : document.querySelector('.anc-gate-title .anc-gate-label')?.getBoundingClientRect();
      const bt = banner.querySelector('.disc-ornate-title')?.getBoundingClientRect();
      const br = banner.getBoundingClientRect();
      if (from && bt && from.width > 0 && bt.width > 0 && c.handoffMs > 0) {
        const dx = toStage(from.left + from.width / 2 - (br.left + br.width / 2));
        const dy = toStage(from.top + from.height / 2 - (bt.top + bt.height / 2));
        const sc = Math.max(0.3, Math.min(3, from.width / bt.width));
        push(banner.animate([
          { opacity: 0.4, transform: `translateX(-50%) translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sc.toFixed(3)})` },
          { opacity: 1, offset: 0.12 },
          { opacity: 1, transform: 'translateX(-50%)' },
        ], { duration: c.handoffMs, easing: 'cubic-bezier(0.5, 0, 0.15, 1)', fill: 'backwards' }));
      } else {
        push(banner.animate([{ opacity: 0, transform: 'translateX(-50%) translateY(10px)' }, { opacity: 1, transform: 'translateX(-50%)' }], { duration: 400, easing: 'ease-out', fill: 'backwards' }));
      }
    }
    const slots = Array.from(root.querySelectorAll<HTMLElement>('.anc-slot'));
    // ONE layout read, at rest: each card's centre (smoke / slam anchors) and its offset from the middle.
    const rects = slots.map((sl) => sl.getBoundingClientRect());
    const mid = Math.floor((slots.length - 1) / 2);
    const cx = (i: number): number => rects[i]!.left + rects[i]!.width / 2;
    // The art's lower edge at rest: where the slam's shockwave lands (not over the effect text).
    const base = (i: number): { x: number; y: number } => ({ x: cx(i), y: rects[i]!.top + rects[i]!.width });
    const k = Math.max(0, c.slamStrength);
    // LAND (owner 2026-09-25: "make the animation cleaner"): ONE puff of the Runeforge landing dust in the Ancient's
    // colour, centred on the card's bottom edge (the art frame, measured AT the slam so it tracks the settled card),
    // under the cards; plus a gentle light sweep across the art. One-shots; nothing loops.
    const landFx = (i: number): void => {
      const frame = slots[i]?.querySelector<HTMLElement>('.anc-art-frame');
      const r = frame?.getBoundingClientRect();
      const col = ancientColor(offer[i]!);
      const w = r?.width ?? rects[i]!.width;
      const foot = r ? { x: r.left + r.width / 2, y: r.bottom } : base(i);
      ancientLandDust(col, foot, 1, w, Math.max(0, c.slamDust));
      ancientSlamSparks(col, foot);
      colourFlash(i);
      const g = slots[i]?.querySelector<HTMLElement>('.anc-glint');
      if (g && typeof g.animate === 'function') {
        push(g.animate([
          { opacity: 0, transform: 'translateX(-120%) skewX(-14deg)' },
          { opacity: 1, offset: 0.25 },
          { opacity: 0, transform: 'translateX(260%) skewX(-14deg)' },
        ], { duration: 620, easing: 'cubic-bezier(0.3, 0, 0.4, 1)' }));
      }
    };
    // THE TEXT ARRIVES AFTER THE CARD (reveal pass 2026-09-27): the name, then the effect, each a short rise + fade once
    // its card has landed, so the art lands alone and the words read in order (and three cards' text never overlap
    // while the sides slide out from behind the middle). Scheduled up front; `fill: backwards` holds them hidden.
    const textIn = (i: number, landAt: number): void => {
      if (reduced || c.textInMs <= 0) return;
      const card = slots[i]?.querySelector('.anc-cardx');
      const parts: [string, number][] = [['.anc-cardx-name', 30], ['.anc-cardx-rulebar', 90], ['.anc-cardx-rule', 120]];
      for (const [sel, off] of parts) {
        const el = card?.querySelector<HTMLElement>(sel);
        if (el && typeof el.animate === 'function') {
          push(el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
            { duration: c.textInMs, delay: Math.max(0, landAt + off), easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'backwards' }));
        }
      }
    };
    // EACH CARD'S OWN COLOUR MOMENT on landing: a bloom of its colour over the art (static gradient, screen blend,
    // opacity + scale one-shot).
    const colourFlash = (i: number): void => {
      const f = slots[i]?.querySelector<HTMLElement>('.anc-land-flash');
      if (!f || c.landFlash <= 0 || typeof f.animate !== 'function') return;
      push(f.animate([{ opacity: c.landFlash, transform: 'scale(0.96)' }, { opacity: 0, transform: 'scale(1.06)' }],
        { duration: 440, easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)' }));
    };
    const finish = (total: number): void => {
      at(total, () => { setSettled(true); setAwakenStage('settled', seq); });
    };
    const slamShake = (card: HTMLElement, delay: number): void => {
      if (k <= 0) return;
      const a = 5 * k;
      push(card.animate([
        { translate: '0 0' }, { translate: `${-a}px ${a * 0.6}px` }, { translate: `${a * 0.8}px ${-a * 0.4}px` }, { translate: `${-a * 0.4}px 0` }, { translate: '0 0' },
      ], { duration: 180, delay, easing: 'linear' }));
    };

    if (reduced) {
      slots.forEach((slot, i) => {
        const card = slot.querySelector<HTMLElement>('.anc-card');
        if (card && typeof card.animate === 'function') push(card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: i * 120, fill: 'backwards' }));
        playCue('cardReveal', i * 120, { rateMul: 1 - i * 0.07 });
        at(i * 120 + 260, () => land(i));
      });
      finish(slots.length * 120 + 260);
    } else if (c.revealStyle >= 1 && slots.length === 3) {
      // TWO BEATS. Beat 1: the middle rises up the centre and SLAMS. Beat 2: the left and right slide out from BEHIND
      // it and slam together, one shared sound.
      const b1 = c.revealDelayMs, slam1 = b1 + c.beat1Ms * 0.78;
      const b2 = b1 + c.beat1Ms + c.beatGapMs, slam2 = b2 + c.beat2Ms * 0.8;
      // ANTICIPATION (reveal pass 2026-09-27): a column of the first Ancient's colour gathers where it will stand, a beat
      // before it rises (the rarity flare / charge-up every reveal in the research leads with), and gives way to it.
      const gather = slots[mid]!.querySelector<HTMLElement>('.anc-gather');
      if (gather && c.gatherMs > 0 && typeof gather.animate === 'function') {
        push(gather.animate([
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.5, 0.12)' },
          { opacity: 0.9, transform: 'translate(-50%, -50%) scale(0.85, 1)', offset: 0.55 },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(1.1, 1.25)' },
        ], { duration: c.gatherMs, delay: Math.max(0, b1 - c.gatherMs * 0.35), easing: 'cubic-bezier(0.3, 0, 0.4, 1)', fill: 'backwards' }));
      }
      textIn(mid, slam1);
      const mCard = slots[mid]!.querySelector<HTMLElement>('.anc-card');
      if (mCard && typeof mCard.animate === 'function') {
        // NO WOBBLE (owner 2026-09-26: "make the first one not wobble"): it rises, then slams STRAIGHT down to rest at
        // the slam frame, with no dip below its resting spot and no side-to-side shake. The dust sells the impact.
        push(mCard.animate([
          { opacity: 0, transform: 'translateY(120px) scale(0.82)' },
          { opacity: 1, offset: 0.22 },
          // A higher peak and a harder ease-in drop (reveal pass 2026-09-27: at 34 px the slam was too small to read, so
          // the dust looked late). Still straight down to rest: no dip, no side shake.
          { opacity: 1, transform: `translateY(${-56 * (0.6 + 0.4 * k)}px) scale(1.09)`, offset: 0.6, easing: 'cubic-bezier(0.7, 0, 0.95, 0.35)' },
          { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.78 },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ], { duration: c.beat1Ms, delay: b1, easing: 'cubic-bezier(0.3, 0, 0.6, 1)', fill: 'backwards' }));
      }
      at(slam1, () => {
        ancientSlam(base(mid)); landFx(mid);
        // DUST OFF ITS SIDES too (owner 2026-09-26): the first slam also kicks a smaller puff out of each flank.
        const fr = slots[mid]?.querySelector<HTMLElement>('.anc-art-frame')?.getBoundingClientRect();
        const r0 = fr ?? rects[mid]!;
        const y = fr ? fr.bottom - fr.height * 0.25 : base(mid).y;
        for (const x of [r0.left, r0.right]) ancientLandDust(ancientColor(offer[mid]!), { x, y }, 0.9, r0.width * 0.55, Math.max(0, c.slamDust));
      });
      playCue('cardReveal', slam1 - 40);
      at(b1 + c.beat1Ms, () => land(mid));
      slots.forEach((slot, i) => {
        if (i === mid) return;
        const card = slot.querySelector<HTMLElement>('.anc-card');
        if (!card || typeof card.animate !== 'function') return;
        const dx = toStage(cx(mid) - cx(i)); // start stacked BEHIND the middle; screen -> stage (stage.ts) for the translate
        const over = (i < mid ? -1 : 1) * 16 * k;
        slot.style.zIndex = '0';
        push(card.animate([
          { opacity: 0, transform: `translateX(${dx}px) scale(0.9)` },
          { opacity: 1, transform: `translateX(${dx * 0.7}px) scale(0.93)`, offset: 0.15 },
          { transform: `translateX(${over}px) scale(1.02)`, offset: 0.8, easing: 'ease-out' },
          { opacity: 1, transform: 'translateX(0) scale(1)' },
        ], { duration: c.beat2Ms, delay: b2, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'backwards' }));
        slamShake(card, slam2);
        textIn(i, slam2);
        at(slam2, () => { ancientSlam(base(i)); landFx(i); });
        at(b2 + c.beat2Ms, () => land(i));
      });
      if (slots[mid]) slots[mid]!.style.zIndex = '1';
      playCue('cardReveal', slam2 - 40, { rateMul: 0.86 }); // ONE sound for the pair
      finish(b2 + c.beat2Ms);
    } else {
      // SEQUENTIAL: left → middle → right, each rising out of its own colour.
      slots.forEach((slot, i) => {
        const card = slot.querySelector<HTMLElement>('.anc-card');
        const delay = c.revealDelayMs + i * c.cardStaggerMs;
        if (card && typeof card.animate === 'function') {
          push(card.animate([
            { opacity: 0, transform: 'translateY(46px) scale(0.86)' },
            { opacity: 0.9, transform: 'translateY(-6px) scale(1.015)', offset: 0.7 },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ], { duration: c.cardRevealMs, delay, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)', fill: 'backwards' }));
        }
        at(delay + c.cardRevealMs * 0.7, () => landFx(i));
        textIn(i, delay + c.cardRevealMs * 0.7);
        playCue('cardReveal', delay, { rateMul: 1 - i * 0.07 });
        at(delay + c.cardRevealMs, () => land(i));
      });
      finish(c.revealDelayMs + (slots.length - 1) * c.cardStaggerMs + c.cardRevealMs);
    }
    return () => { for (const t of timers.current) window.clearTimeout(t); for (const a of anims.current) a.cancel(); anims.current = []; };
  }, []);

  return (
    <div ref={rootRef} className={`discover-ov dce disc-look anc-offer${gated ? ' gated' : ''}${settled ? ' settled' : ''}${closing ? ' closing' : ''}`} role="dialog" aria-label="An Ancient Awakens"
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
                {/* Inside the card, so the bloom rides the card's own landing motion (it spilled beside a side card
                    still settling from its overshoot when it sat in the slot, reveal pass 2). */}
                <span className="anc-land-flash" aria-hidden="true" />
              </button>
              {i === Math.floor((offer.length - 1) / 2) && <span className="anc-gather" aria-hidden="true" />}
            </div>
          ))}
        </div>
        {/* THE INVITATION (reveal pass 2026-09-27): once every Ancient has landed, a quiet line says the choice is open. */}
        <div className={`anc-choose${settled && !closing ? ' in' : ''}`} aria-hidden="true">Choose one</div>
      </div>
    </div>
  );
}
