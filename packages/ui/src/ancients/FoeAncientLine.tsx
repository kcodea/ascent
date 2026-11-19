import type { CSSProperties } from 'react';
import { ANCIENTS, ancientOfferText, type BoardSnapshot } from '@game/sim';
import { mdBold } from '../Card';
import { ancientColor } from './ancientsConfig';
import './ancients.css';

/**
 * A FOE'S ANCIENT under its hero power (R-ANCIENTS-RELEASE-03, audit F4): the Ancient's name in its colour and the
 * pairing text for the hero whose power it modifies (`BoardSnapshot.ancient`, captured with the board). Shown in the
 * combat foe's power tip and on the rail's scout card. Static text, as the foe's base power is: we never simulate
 * another player's run, so there is no live number to fold in. Renders nothing for a board with no Ancient (no pick yet,
 * or a capture from before the field existed).
 */
export function FoeAncientLine({ ancient, className }: { ancient: BoardSnapshot['ancient'] | undefined; className?: string }) {
  const def = ancient ? ANCIENTS[ancient.id] : undefined;
  if (!ancient || !def) return null;
  return (
    <span className={`foe-ancient${className ? ` ${className}` : ''}`} style={{ '--anc-c': ancientColor(ancient.id) } as CSSProperties}>
      <b className="foe-ancient-name" style={{ color: ancientColor(ancient.id) }}>{def.name}</b>
      <span className="foe-ancient-rule" dangerouslySetInnerHTML={{ __html: mdBold(ancientOfferText(ancient.heroId, ancient.id)) }} />
    </span>
  );
}
