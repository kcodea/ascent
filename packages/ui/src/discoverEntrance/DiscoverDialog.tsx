import { useRef, type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { Card, type CardView } from '../Card';
import { useOfferEntrance, type OfferEntrance } from './useOfferEntrance';
import './discoverEntrance.css';

/**
 * THE DISCOVER DIALOG: the Discover overlay's markup (scrim, burst layer, banner, the option cards) plus its
 * ENTRANCE (owner ask 2026-09-25: the cards float in with a little dust and shimmer).
 *
 * Lifted out of `Recruit.tsx`'s `DiscoverOverlay` so the live Discover and the tuner's sandbox render the SAME
 * markup: a preview that drifted from the real row would be tuning something the player never sees.
 */
export interface DiscoverDialogProps {
  /** The option cards, already built with their live text. */
  cards: readonly CardView[];
  /** The options' ids, for React keys (a Discover can offer the same card twice). */
  ids: readonly string[];
  onPick: (index: number) => void;
  /** Which Discover this is (see `useOfferEntrance`). Null = play on every mount (the sandbox). */
  occasion: string | null;
  /** Replay speed: the entrance compresses by it. */
  speed?: number;
  /** The Discover burst layer's mount point (the live overlay's golden bloom behind the cards). */
  burstRef?: RefObject<HTMLDivElement>;
  className?: string;
}

export function DiscoverDialog({ cards, ids, onPick, occasion, speed, burstRef, className }: DiscoverDialogProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const entrance = useOfferEntrance(rootRef, occasion, { openCue: true, speed });
  return (
    <div
      ref={rootRef}
      className={`discover-ov dce${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label="Discover a card"
      // ANY press while the entrance plays settles it. A press on a card still in flight lands here (flying cards
      // are pointer-events: none), so it skips without picking; an arrived card still takes its click.
      onPointerDownCapture={(e) => { entrance.onPressCapture(e); }}
    >
      {/* WebGL burst layer: behind the cards (z0) but above the overlay's dark backdrop, so the golden magic reads
          white-hot without covering the UI. Driven by discoverFx (see Recruit's effect). */}
      <div className="disc-burst" ref={burstRef} aria-hidden="true" />
      <div className="disc-panel">
        <span className="disc-gem disc-gem-top" aria-hidden="true" />
        <div className="disc-banner"><span className="disp">Discover</span></div>
        <div className="disc-cards">
          {cards.map((card, i) => (
            <div className="disc-slot" data-pick-sfx key={`${ids[i] ?? card.cardId}-${i}`} style={{ '--c': `var(--t-${card.tribe})` } as CSSProperties}>
              {/* The entrance owns the arrival, so the card's own mount-pop is off (it would compound the flight). */}
              <Card card={card} suppressPop onClick={() => { if (entrance.canPick(i)) onPick(i); }} />
              <OfferSheen />
            </div>
          ))}
        </div>
        <span className="disc-gem disc-gem-bot" aria-hidden="true" />
      </div>
    </div>
  );
}

/** The shimmer band over an offer card, played once as it arrives. Inert (and invisible) otherwise. */
export function OfferSheen(): JSX.Element {
  return <span className="dce-sheen" aria-hidden="true"><span className="dce-sheen-band" /></span>;
}

/**
 * A bare offer overlay root that runs the entrance (the Choose One's): renders the `.discover-ov` div, wires the
 * press-to-skip, and hands the children the entrance so their picks can check `canPick`. A press that only settled
 * the entrance never reaches the caller's own `onPointerDown` (the Choose One's click-away cancel).
 */
export function EntranceOverlay({ occasion, openCue = false, speed, className, onPointerDown, children, ...rest }: {
  occasion: string | null;
  openCue?: boolean;
  speed?: number;
  className?: string;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  children: (entrance: OfferEntrance) => ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onPointerDown' | 'onPointerDownCapture' | 'className'>): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const entrance = useOfferEntrance(rootRef, occasion, { openCue, speed });
  const swallow = useRef(false);
  return (
    <div
      {...rest}
      ref={rootRef}
      className={`discover-ov dce${className ? ` ${className}` : ''}`}
      onPointerDownCapture={(e) => { swallow.current = entrance.onPressCapture(e); }}
      onPointerDown={(e) => {
        if (swallow.current) { swallow.current = false; return; }
        onPointerDown?.(e);
      }}
    >
      {children(entrance)}
    </div>
  );
}
