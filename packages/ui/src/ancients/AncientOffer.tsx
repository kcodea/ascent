import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ANCIENTS, ancientOfferText, type Action, type AncientId, type RunState } from '@game/sim';
import { OfferSheen } from '../discoverEntrance/DiscoverDialog';
import { OfferBanner } from '../discoverEntrance/OfferBanner';
import { AncientCard } from './AncientCard';
import { notePickSource, prefersReducedMotion, setAwakenStage, useAwakenStage } from './ancientsFx';
import { ancientColor, getAncientsConfig } from './ancientsConfig';
import { playCue } from './ancientsSound';
import '../discoverEntrance/discoverEntrance.css';
import './ancients.css';

/**
 * THE ANCIENTS' REVEAL — its own emergence, not the standard Discover entrance (owner 2026-09-25: "make the discover
 * animation unique to the ancients in timing, sound and appearance"). Mounted by the awakening (`AncientGate`) on its
 * `reveal` beat, over the Discover view's backdrop:
 *   · the gold banner fades in;
 *   · ONE Ancient at a time materialises out of a flash of its own colour and a ring of light shards — rising, heavy,
 *     unhurried (`cardStaggerMs`, `cardRevealMs`) — each with its own `cardReveal` cue (pitched a step lower per
 *     card), and a shimmer across its frame as it lands;
 *   · once all have landed it reports `settled`, and slow motes drift behind the cards.
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

  const settle = (): void => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    for (const a of anims.current) a.finish();
    setLanded(offer.map(() => true));
    setSettled(true);
    setAwakenStage('settled', seq);
  };

  // Once per reveal (the component is keyed by the awakening's seq).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const c = getAncientsConfig();
    const reduced = prefersReducedMotion();
    const push = (a: Animation | undefined): void => { if (a) anims.current.push(a); };
    const banner = root.querySelector<HTMLElement>('.disc-ornate');
    if (banner && typeof banner.animate === 'function') {
      push(banner.animate([{ opacity: 0, transform: 'translateX(-50%) translateY(10px)' }, { opacity: 1, transform: 'translateX(-50%)' }], { duration: 500, delay: 180, easing: 'ease-out', fill: 'backwards' })); // after the curtain's title has gone
    }
    const slots = Array.from(root.querySelectorAll<HTMLElement>('.anc-slot'));
    slots.forEach((slot, i) => {
      const card = slot.querySelector<HTMLElement>('.anc-card');
      const flash = slot.querySelector<HTMLElement>('.anc-emerge-flash');
      const shards = slot.querySelector<HTMLElement>('.anc-emerge-shards');
      const band = slot.querySelector<HTMLElement>('.dce-sheen-band');
      const delay = c.revealDelayMs + i * c.cardStaggerMs;
      const dur = c.cardRevealMs;
      if (!card || typeof card.animate !== 'function') return;
      if (reduced) {
        push(card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: i * 120, fill: 'backwards' }));
      } else {
        push(card.animate([
          { opacity: 0, transform: 'translateY(46px) scale(0.86)' },
          { opacity: 0.9, transform: 'translateY(-6px) scale(1.015)', offset: 0.7 },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ], { duration: dur, delay, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)', fill: 'backwards' }));
        push(flash?.animate([
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.3)' },
          { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.3 },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(1.5)' },
        ], { duration: dur * 1.1, delay: Math.max(0, delay - 60), easing: 'ease-out', fill: 'both' }));
        push(shards?.animate([
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.5) rotate(0deg)' },
          { opacity: 1, transform: 'translate(-50%, -50%) scale(1) rotate(12deg)', offset: 0.35 },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(1.35) rotate(24deg)' },
        ], { duration: dur * 1.2, delay: Math.max(0, delay - 30), easing: 'ease-out', fill: 'both' }));
        push(band?.animate([
          { transform: 'translate3d(-160%, 0, 0) skewX(-16deg)', opacity: 0.8 },
          { transform: 'translate3d(300%, 0, 0) skewX(-16deg)', opacity: 0.8 },
        ], { duration: 700, delay: delay + dur * 0.8, easing: 'cubic-bezier(0.37, 0, 0.63, 1)', fill: 'backwards' }));
      }
      // Each Ancient's own cue, a step lower each time: a descending, weightier sequence.
      playCue('cardReveal', reduced ? i * 120 : delay, { rateMul: 1 - i * 0.07 });
      timers.current.push(window.setTimeout(() => setLanded((l) => l.map((v, k) => (k === i ? true : v))), reduced ? i * 120 + 260 : delay + dur));
    });
    const total = reduced ? offer.length * 120 + 260 : c.revealDelayMs + (offer.length - 1) * c.cardStaggerMs + c.cardRevealMs;
    timers.current.push(window.setTimeout(() => { setSettled(true); setAwakenStage('settled', seq); }, total));
    return () => { for (const t of timers.current) window.clearTimeout(t); for (const a of anims.current) a.cancel(); anims.current = []; };
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
              <span className="anc-emerge-flash" aria-hidden="true" />
              <span className="anc-emerge-shards" aria-hidden="true" />
              <button type="button" className="anc-card" disabled={!landed[i]}
                aria-label={`${ANCIENTS[id].name}: ${ancientOfferText(heroId, id).replace(/\*\*/g, '')}`}
                onClick={(e) => { if (landed[i]) onPick(id, e.currentTarget); }}>
                <AncientCard id={id} heroId={heroId} />
                <OfferSheen />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
