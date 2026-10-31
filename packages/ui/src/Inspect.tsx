import { useEffect, useMemo, useRef } from 'react';
import { bareRuneLabel } from '@game/content';
import { MORE_BUFFS_SOURCE } from '@game/sim';
import { Card } from './Card';
import { KeywordDefs } from './KeywordDefs';
import { resolveMech } from './mechIcon';
import { useGame } from './store';
import { upgradeImages } from './fullResArt';
import { clickAsPick, inspectActionFor, lastPointerWasTouch, lastTouchTarget } from './touchInput';
import { useSpectate } from './versus/spectate';
import './discoverEntrance/discoverEntrance.css'; // the gold action pill the touch Buy / Pick button reuses

/** A ledger amount with its sign: a gain reads +N, a loss (Shop damage, a Titan Hammer set DOWN) reads -N, never "+-N". */
const signed = (n: number): string => (n < 0 ? `-${-n}` : `+${n}`);

/**
 * Right-click "inspect": the card floats to the centre of the screen, enlarged, over
 * a dimmed backdrop so the player can read it closely. Click the backdrop (or press
 * Escape) to dismiss.
 */
export function Inspect() {
  const inspect = useGame((s) => s.inspect);
  const clearInspect = useGame((s) => s.clearInspect);

  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') clearInspect();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspect, clearInspect]);

  // TOUCH ACTION (owner 2026-10-18, R-TOUCH-INSPECTACT-01): opened by a finger on a shop offer or a Discover / Choose
  // One option, the enlarged view carries the action a tap or drag would take, so you can act from it. Read once
  // per open: the card a finger opened it from is the last element a finger landed on.
  const action = useMemo(() => {
    if (!inspect || !lastPointerWasTouch()) return null;
    const g = useGame.getState();
    if (g.replaying || useSpectate.getState().active) return null; // a viewer reads, never acts
    return inspectActionFor(lastTouchTarget());
  }, [inspect]);

  // CRISP ON A PHONE (R-PHONE-CRISP-01): the enlarged card loads its full-resolution art, frame and plate (a phone
  // otherwise holds the small copies). A no-op on desktop. Re-run per inspected card; the originals go with the view.
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => (inspect ? upgradeImages(cardRef.current) : undefined), [inspect]);

  if (!inspect) return null;
  const act = (): void => {
    if (!action) return;
    clearInspect();
    if (action.kind === 'buy') useGame.getState().dispatch({ type: 'buy', uid: action.uid });
    else if (action.el.isConnected) clickAsPick(action.el); // the commit itself, not another tap-to-inspect
  };
  return (
    <div
      className="inspect-ov"
      onClick={clearInspect}
      onContextMenu={(e) => {
        e.preventDefault();
        clearInspect();
      }}
      role="dialog"
      aria-label={`${inspect.name}. Close to dismiss.`}
    >
      <div className="inspect-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        {inspect.buffs && inspect.buffs.length > 0 && (
          <div className="inspect-buffs">
            <div className="ib-title">Buffs</div>
            {inspect.buffs.map((b, i) => (
              <div className="ib-row" key={`${b.source}-${i}`}>
                {/* A stored board (Match History) folds its smallest buffs into one "N more" row (R-MATCH-BUFFS-01). */}
                {b.source === MORE_BUFFS_SOURCE
                  ? <span className="ib-src">{b.count} more</span>
                  : <span className="ib-src">{bareRuneLabel(b.source)} <em>×{b.count}</em></span>}
                {/* A stat-less row is a granted ability (Seed's Drake Pup Echo, Set 3), not a +0/+0 buff. */}
                <span className="ib-amt">{b.attack === 0 && b.health === 0 && b.source !== MORE_BUFFS_SOURCE ? 'Echo' : `${signed(b.attack)}/${signed(b.health)}`}</span>
              </div>
            ))}
          </div>
        )}
        {/* Plated, like a hand card — the inspect overlay is the one other place you read a card as a whole
            object rather than a board token, so it wears the same body (owner 2026-07-21). Safe for the
            `isolation: isolate` on `.card.plated`: this overlay never renders during combat.
            Drop `stepProgress`: the step counter is anchored to the board-token layout, so in this centred
            overlay it lands mid-card (owner 2026-08-15). The counter isn't part of reading the card whole. */}
        {/* The (Both) marker rides the inspect view too (owner ask 2026-08-31): the card draws its own
            silhouette glow off `chooseBothKey`. Prefixed so the overlay's `data-choose-both` never collides
            with the board token's behind it. */}
        <Card
          card={{
            ...inspect,
            stepProgress: undefined,
            chooseBothKey: inspect.chooseBothKey ? `inspect:${inspect.chooseBothKey}` : undefined,
          }}
          forceFull
          plated
        />
        <KeywordDefs card={inspect} mech={resolveMech(inspect)} />
      </div>
      {action && (
        <button
          type="button"
          className="disc-toggle disc-peek inspect-act"
          onClick={(e) => { e.stopPropagation(); act(); }}
          aria-label={action.kind === 'buy' ? `Buy ${inspect.name}` : `Pick ${inspect.name}`}
        >
          <span className="disc-peek-glow" aria-hidden="true" />
          <span className="disc-peek-label">{action.kind === 'buy' ? 'Buy' : 'Pick'}</span>
        </button>
      )}
    </div>
  );
}
