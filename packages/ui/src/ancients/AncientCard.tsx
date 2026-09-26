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
        {hasAncientArt(id)
          ? <AncientFace id={id} className="anc-art" />
          : (
            // PLACEHOLDER (no art yet): the Ancient's colour as a lit gradient filling the frame, with its emblem.
            <span className="anc-art-fill" aria-hidden="true"><span className="anc-art-glyph">{`${ANCIENTS[id].glyph}\uFE0E`}</span></span>
          )}
        {!hasAncientArt(id) && <span className="anc-art-ph">placeholder art</span>}
      </div>
      <div className="anc-cardx-name">{ANCIENTS[id].name}{tag && <span className="anc-cardx-tag">{tag}</span>}</div>
      <span className="anc-cardx-rulebar" aria-hidden="true" />
      <div className="anc-cardx-rule"><span dangerouslySetInnerHTML={{ __html: mdBold(ancientOfferText(heroId, id)) }} /></div>
    </div>
  );
});
