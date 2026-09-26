import { memo, type CSSProperties } from 'react';
import { ANCIENTS, ancientOfferText, type AncientId } from '@game/sim';
import { mdBold } from '../Card';
import { AncientFace, hasAncientArt } from './AncientFace';
import { ancientColor } from './ancientsConfig';

/**
 * THE ANCIENT CARD (owner 2026-09-25: "the ancient should be a full art frame with the description in a box under
 * it. remove all flavor text"). Shared by the awakening offer and the hover preview so the two never drift: the art
 * fills a framed portrait edge to edge (a placeholder emblem fills the same frame), then the name, then the effect
 * text for the CURRENT hero in its own panel. No thesis / flavour line anywhere.
 */
export const AncientCard = memo(function AncientCard({ id, heroId, tag }: { id: AncientId; heroId: string; tag?: string }) {
  return (
    <div className="anc-cardx" style={{ '--anc-c': ancientColor(id) } as CSSProperties}>
      <div className={`anc-art-frame${hasAncientArt(id) ? '' : ' placeholder'}`}>
        <AncientFace id={id} className="anc-art" />
        {!hasAncientArt(id) && <span className="anc-art-ph">placeholder art</span>}
      </div>
      <div className="anc-cardx-name">{ANCIENTS[id].name}{tag && <span className="anc-cardx-tag">{tag}</span>}</div>
      <div className="anc-cardx-rule" dangerouslySetInnerHTML={{ __html: mdBold(ancientOfferText(heroId, id)) }} />
    </div>
  );
});
