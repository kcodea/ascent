import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ANCIENTS, ancientOfferText, type Action, type AncientId, type RunState } from '@game/sim';
import { OfferBanner } from '../discoverEntrance/OfferBanner';
import { AncientCard } from './AncientCard';
import { notePickSource, prefersReducedMotion, setAwakenStage, useAwakenStage } from './ancientsFx';
import { ancientColor, getAncientsConfig } from './ancientsConfig';
import { playCue } from './ancientsSound';
import { ancientSlam, ancientSmoke } from './ancientsSmoke';
import '../discoverEntrance/discoverEntrance.css';
import './ancients.css';

/**
 * THE ANCIENTS' REVEAL — its own emergence, not the standard Discover entrance (owner 2026-09-25: "make the discover
 * animation unique to the ancients in timing, sound and appearance"). Mounted by the awakening (`AncientGate`) on its
 * `reveal` beat, over the Discover view's backdrop:
 *   · the gold banner fades in;
 *   · TWO BEATS (the default, `revealStyle` 1): the middle Ancient rises up the centre and SLAMS (a weighty settle, a
 *     card shake, the `ancient-slam` landing and a puff of its coloured smoke, one `cardReveal`); after a gap the left
 *     and right slide out from BEHIND it and slam together (one shared `cardReveal`, a slam + smoke at each).
 *     SEQUENTIAL (`revealStyle` 0): left → middle → right, each rising out of a puff of its coloured smoke;
 *   · once all have landed it reports `settled`: a faint haze of each Ancient's colour lingers behind its card
 *     (looped Pixi smoke, retired on unmount) and slow motes drift.
 * A card takes its click only once it has landed. A click during the emergence completes it (the cinematic's second
 * skip). WAAPI transform / opacity only, scheduled up front; the motes are transform/opacity loops.
 * Reduced motion: a plain fade, sounds kept.
 */
const DEMO_OFFER: AncientId[] = ['death', 'fortune', 'war'];

export const AncientOfferOverlay = memo(function AncientOfferOverlay({ held, run, dispatch }: {
  held: boolean; run: RunState; dispatch: (a: Action) => void;
}) {
  const realOffer = run.ancientsEnabled ? run.ancients?.offer : undefined;
  const offerSeq = run.ancients?.offerSeq ?? 0;
  const stage = useAwakenStage();
  const demo = stage.seq < 0;
  const offer = demo ? DEMO_OFFER : realOffer;
  const inReveal = (stage.stage === 'reveal' || stage.stage === 'settled') && (demo || stage.seq === offerSeq);
  // Safety net: an awakening that never reaches its reveal (the hero power not on screen) still releases the offer.
  const [timedOut, setTimedOut] = useState(0);
  useEffect(() => {
    if (!realOffer?.length) return;
    const c = getAncientsConfig();
    const id = window.setTimeout(() => setTimedOut(offerSeq), 6000 + c.omenMs + c.eruptionMs + c.titleHoldMs);
    return () => window.clearTimeout(id);
  }, [realOffer, offerSeq]);
  if (!offer?.length || held || run.phase !== 'recruit') return null;
  if (!inReveal && !(timedOut === offerSeq && !demo)) return null;
  return <Reveal key={`${stage.seq}`} gated={inReveal} offer={offer} heroId={run.heroId} seq={demo ? stage.seq : offerSeq}
    onPick={(id, el) => {
      notePickSource(el);
      if (demo) setAwakenStage('closing', stage.seq);
      else dispatch({ type: 'pickAncient', id });
    }} />;
});

function Reveal({ gated, offer, heroId, seq, onPick }: { gated: boolean; offer: AncientId[]; heroId: string; seq: number; onPick: (id: AncientId, el: Element) => void }): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const anims = useRef<Animation[]>([]);
  const timers = useRef<number[]>([]);
  const [landed, setLanded] = useState<boolean[]>(() => offer.map(() => false));
  const [settled, setSettled] = useState(false);
  const hazeRef = useRef<(() => void)[]>([]);
  const startHazeRef = useRef<(() => void) | null>(null);

  const settle = (): void => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    for (const a of anims.current) a.finish();
    setLanded(offer.map(() => true));
    setSettled(true);
    setAwakenStage('settled', seq);
    startHazeRef.current?.();
  };

  // Once per reveal (the component is keyed by the awakening's seq).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const c = getAncientsConfig();
    const reduced = prefersReducedMotion();
    const push = (a: Animation | undefined): void => { if (a) anims.current.push(a); };
    const at = (ms: number, fn: () => void): void => { timers.current.push(window.setTimeout(fn, ms)); };
    const land = (i: number): void => setLanded((l) => l.map((v, k) => (k === i ? true : v)));
    const banner = root.querySelector<HTMLElement>('.disc-ornate');
    if (banner && typeof banner.animate === 'function') {
      push(banner.animate([{ opacity: 0, transform: 'translateX(-50%) translateY(10px)' }, { opacity: 1, transform: 'translateX(-50%)' }], { duration: 500, delay: 180, easing: 'ease-out', fill: 'backwards' })); // after the curtain's title has gone
    }
    const slots = Array.from(root.querySelectorAll<HTMLElement>('.anc-slot'));
    // ONE layout read, at rest: each card's centre (smoke / slam anchors) and its offset from the middle.
    const rects = slots.map((sl) => sl.getBoundingClientRect());
    const mid = Math.floor((slots.length - 1) / 2);
    const cx = (i: number): number => rects[i]!.left + rects[i]!.width / 2;
    // The art's lower edge: where the smoke billows up and the slam lands (not over the effect text).
    const base = (i: number): { x: number; y: number } => ({ x: cx(i), y: rects[i]!.top + rects[i]!.width * 0.92 });
    const k = Math.max(0, c.slamStrength);
    const haze: (() => void)[] = [];
    // SETTLED: a faint slow haze of each Ancient's colour behind its card (looped Pixi plays, retired on unmount).
    let hazed = false;
    startHazeRef.current = () => {
      if (hazed) return;
      hazed = true;
      offer.forEach((id, i) => { const r = ancientSmoke('haze', id, { x: cx(i), y: rects[i]!.top + rects[i]!.height * 0.55 }); if (r) haze.push(r); });
    };
    const finish = (total: number): void => {
      at(total, () => { setSettled(true); setAwakenStage('settled', seq); startHazeRef.current?.(); });
    };
    hazeRef.current = haze;
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
      const mCard = slots[mid]!.querySelector<HTMLElement>('.anc-card');
      if (mCard && typeof mCard.animate === 'function') {
        push(mCard.animate([
          { opacity: 0, transform: 'translateY(120px) scale(0.82)' },
          { opacity: 1, transform: `translateY(${-34 * (0.6 + 0.4 * k)}px) scale(1.07)`, offset: 0.6 },
          { transform: `translateY(${8 * k}px) scale(${1 - 0.03 * k})`, offset: 0.78, easing: 'ease-out' },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ], { duration: c.beat1Ms, delay: b1, easing: 'cubic-bezier(0.3, 0, 0.6, 1)', fill: 'backwards' }));
        slamShake(mCard, slam1);
      }
      at(b1, () => ancientSmoke('puff', offer[mid]!, base(mid)));
      at(slam1, () => { ancientSlam(base(mid)); ancientSmoke('puff', offer[mid]!, base(mid)); });
      playCue('cardReveal', slam1 - 40);
      at(b1 + c.beat1Ms, () => land(mid));
      slots.forEach((slot, i) => {
        if (i === mid) return;
        const card = slot.querySelector<HTMLElement>('.anc-card');
        if (!card || typeof card.animate !== 'function') return;
        const dx = cx(mid) - cx(i); // start stacked BEHIND the middle
        const over = (i < mid ? -1 : 1) * 16 * k;
        slot.style.zIndex = '0';
        push(card.animate([
          { opacity: 0, transform: `translateX(${dx}px) scale(0.9)` },
          { opacity: 1, transform: `translateX(${dx * 0.7}px) scale(0.93)`, offset: 0.15 },
          { transform: `translateX(${over}px) scale(1.02)`, offset: 0.8, easing: 'ease-out' },
          { opacity: 1, transform: 'translateX(0) scale(1)' },
        ], { duration: c.beat2Ms, delay: b2, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'backwards' }));
        slamShake(card, slam2);
        at(slam2, () => { ancientSlam(base(i)); ancientSmoke('puff', offer[i]!, base(i)); });
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
        at(delay, () => ancientSmoke('puff', offer[i]!, base(i)));
        playCue('cardReveal', delay, { rateMul: 1 - i * 0.07 });
        at(delay + c.cardRevealMs, () => land(i));
      });
      finish(c.revealDelayMs + (slots.length - 1) * c.cardStaggerMs + c.cardRevealMs);
    }
    return () => { for (const t of timers.current) window.clearTimeout(t); for (const a of anims.current) a.cancel(); anims.current = []; for (const r of hazeRef.current) r(); hazeRef.current = []; };
  }, []);

  return (
    <div ref={rootRef} className={`discover-ov dce disc-look anc-offer${gated ? ' gated' : ''}${settled ? ' settled' : ''}`} role="dialog" aria-label="An Ancient Awakens"
      onPointerDownCapture={(e) => {
        // The second skip: a click during the emergence completes it (and picks nothing).
        if (!settled) { e.stopPropagation(); e.preventDefault(); settle(); }
      }}>
      {/* SETTLED: slow motes drifting behind the cards (transform/opacity loops only). */}
      <div className="anc-motes" aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => (
          <span key={i} className="anc-mote" style={{ left: `${8 + ((i * 57) % 84)}%`, top: `${20 + ((i * 37) % 60)}%`, animationDelay: `${-(i * 0.9)}s`, animationDuration: `${9 + (i % 5) * 1.7}s` }} />
        ))}
      </div>
      <div className="disc-panel">
        <OfferBanner title="An Ancient Awakens" />
        <div className="disc-cards anc-cards">
          {offer.map((id, i) => (
            <div className="disc-slot anc-slot" key={id} style={{ '--anc-c': ancientColor(id) } as CSSProperties}>
              <button type="button" className="anc-card" disabled={!landed[i]}
                aria-label={`${ANCIENTS[id].name}: ${ancientOfferText(heroId, id).replace(/\*\*/g, '')}`}
                onClick={(e) => { if (landed[i]) onPick(id, e.currentTarget); }}>
                <AncientCard id={id} heroId={heroId} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
