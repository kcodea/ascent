import { memo, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ANCIENTS, ANCIENT_IDS, ancientOfferText, ancientPairingFor, type AncientId } from '@game/sim';
import { mdBold } from './Card';
import { AncientFace } from './ancients/AncientFace';
import { ancientVars } from './ancients/ancientsConfig';

/**
 * THE COMPENDIUM'S ANCIENTS ROW (owner ask 2026-11-16: "an ancients display on the heroes tab ... scan through all of
 * the ancient mechanics both on the compendium itself and the inspected view of the hero"). Six medallions, one per
 * Ancient, each the Ancient's own hero-power art in a ring of its colour. Pressing one (or hovering it with a mouse)
 * shows that Ancient's text FOR THIS HERO, straight from the sim's pairing table. A preview for everyone, even though
 * Ancients are still test-mode in play.
 *
 * All six texts are laid out in ONE stacked cell, and only the chosen one is visible: the box is always as tall as
 * the longest text, so switching never moves the tile or its row (no layout shift, no grid reflow). A switch is a
 * class change inside this one component; nothing above it re-renders.
 */

/** The Ancient picked last this session: a newly mounted tile and the large hero view open on it. */
let lastPicked: AncientId = ANCIENT_IDS[0] ?? 'death';
export function lastPickedAncient(): AncientId { return lastPicked; }
export function rememberAncient(id: AncientId): void { lastPicked = id; }

/** The next / previous Ancient in the row's order, wrapping. */
export function stepAncient(id: AncientId, d: number): AncientId {
  const n = ANCIENT_IDS.length;
  const at = ANCIENT_IDS.indexOf(id);
  return ANCIENT_IDS[(((at + d) % n) + n) % n] ?? id;
}

/** Keep a press on a medallion from reaching the hero tile around it (which opens the large view). */
const stop = (e: ReactMouseEvent | ReactKeyboardEvent): void => {
  if ('key' in e && e.key !== 'Enter' && e.key !== ' ') return;
  e.stopPropagation();
};

export const HeroAncients = memo(function HeroAncients({ heroId, picked, onPick, big = false }: {
  heroId: string;
  picked: AncientId;
  onPick: (id: AncientId) => void;
  /** The large hero view's size. */
  big?: boolean;
}) {
  const [hover, setHover] = useState<AncientId | null>(null);
  const shown = hover ?? picked;
  const enter = (id: AncientId) => (e: ReactPointerEvent): void => { if (e.pointerType === 'mouse') setHover(id); };
  return (
    <div className={`hanc${big ? ' is-big' : ''}`}>
      <div className="hanc-row" role="group" aria-label="Ancients" onPointerLeave={() => setHover(null)}>
        {ANCIENT_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`hanc-med${id === shown ? ' is-on' : ''}`}
            style={ancientVars(id) as CSSProperties}
            aria-label={ANCIENTS[id].name}
            aria-pressed={id === picked}
            onClick={(e) => { e.stopPropagation(); rememberAncient(id); onPick(id); }}
            onKeyDown={stop}
            onContextMenu={(e) => e.stopPropagation()}
            onPointerEnter={enter(id)}
          >
            <AncientFace id={id} variant="power" className="hanc-face" />
          </button>
        ))}
      </div>
      <div className="hanc-texts">
        {ANCIENT_IDS.map((id) => {
          const written = !!ancientPairingFor(heroId, id);
          return (
            <div
              key={id}
              className={`hanc-text${id === shown ? ' is-on' : ''}${written ? '' : ' is-unwritten'}`}
              style={ancientVars(id) as CSSProperties}
              aria-hidden={id !== shown}
              data-ancient={id}
            >
              <span className="hanc-name">{ANCIENTS[id].name}</span>
              <p className="hanc-body" dangerouslySetInnerHTML={{ __html: mdBold(ancientOfferText(heroId, id)) }} />
            </div>
          );
        })}
      </div>
    </div>
  );
});
