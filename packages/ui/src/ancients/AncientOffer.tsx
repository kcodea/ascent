import { memo, useEffect, useState, type CSSProperties } from 'react';
import { ANCIENTS, ancientOfferText, type Action, type AncientId, type RunState } from '@game/sim';
import { EntranceOverlay, OfferSheen } from '../discoverEntrance/DiscoverDialog';
import { OfferBanner } from '../discoverEntrance/OfferBanner';
import { mdBold } from '../Card';
import { AncientFace } from './AncientFace';
import { notePickSource, useRingSettledSeq } from './ancientsFx';
import { getAncientsConfig } from './ancientsConfig';
import './ancients.css';

/**
 * THE AWAKENING DISCOVER (owner ruling 3 + the polish brief 2026-09-25): at 0 the Shop pauses and 3 of the 5
 * Ancients rise in with the Discover's own entrance (`EntranceOverlay`, PR #1712) under the ornate gold banner
 * (`OfferBanner`, PR #1714), titled "An Ancient Awakens". Each option shows the face, name, thesis and the text
 * for the CURRENT hero ("Not written yet." when the pairing is missing).
 *
 * It waits for (a) the curtain and every other decision overlay (`held`, from Recruit) and (b) the meter's ring
 * to finish draining + flash (`ringSettled`, with a safety timeout for a meter that is not on screen), so the
 * beat reads ring → dim → rise, never all at once.
 */
export const AncientOfferOverlay = memo(function AncientOfferOverlay({ held, run, dispatch }: {
  held: boolean; run: RunState; dispatch: (a: Action) => void;
}) {
  const offer = run.ancients?.offer;
  const offerSeq = run.ancients?.offerSeq ?? 0;
  const settled = useRingSettledSeq();
  // Safety net: a meter that never reports (not mounted, reduced motion skipped its flash) releases the offer.
  const [timedOut, setTimedOut] = useState(0);
  useEffect(() => {
    if (!offer?.length) return;
    const id = window.setTimeout(() => setTimedOut(offerSeq), 4000 + getAncientsConfig().flashMs);
    return () => window.clearTimeout(id);
  }, [offer, offerSeq]);
  if (!offer?.length || held || run.phase !== 'recruit') return null;
  if (settled < offerSeq && timedOut < offerSeq) return null;
  const pick = (id: AncientId, el: Element | null): void => {
    notePickSource(el);
    dispatch({ type: 'pickAncient', id });
  };
  return (
    <EntranceOverlay occasion={`ancient:${run.seed}:${offerSeq}`} openCue className="disc-look anc-offer" role="dialog" aria-label="An Ancient Awakens"
      style={{ '--dcl-tint': String(getAncientsConfig().dim) } as CSSProperties}>
      {(entrance) => (
        <div className="disc-panel">
          <span className="disc-gem disc-gem-top" aria-hidden="true" />
          <OfferBanner title="An Ancient Awakens" />
          <div className="disc-cards anc-cards">
            {offer.map((id, i) => {
              const a = ANCIENTS[id];
              return (
                <div className="disc-slot" data-pick-sfx key={id} style={{ '--anc-c': a.color, '--anc-c2': a.color2 } as CSSProperties}>
                  <button type="button" className="anc-card" aria-label={`${a.name}: ${ancientOfferText(run.heroId, id).replace(/\*\*/g, '')}`}
                    onClick={(e) => { if (entrance.canPick(i)) pick(id, e.currentTarget.querySelector('.anc-card-face')); }}>
                    <span className="anc-card-face"><AncientFace id={id} /></span>
                    <span className="anc-card-name">{a.name}</span>
                    <span className="anc-card-thesis">{a.thesis}</span>
                    <span className="anc-card-rule" dangerouslySetInnerHTML={{ __html: mdBold(ancientOfferText(run.heroId, id)) }} />
                    <span className="anc-card-ph">placeholder art</span>
                  </button>
                  <OfferSheen />
                </div>
              );
            })}
          </div>
          <span className="disc-gem disc-gem-bot" aria-hidden="true" />
        </div>
      )}
    </EntranceOverlay>
  );
});
