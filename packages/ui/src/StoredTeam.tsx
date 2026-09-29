import { useMemo } from 'react';
import type { BoardMinion } from '@game/core';
import type { RunCosmeticSnapshot } from '@game/progression';
import { Card } from './Card';
import { storedCardView } from './storedBoardView';
import { MinionSkins } from './skins/skins';

const BOARD_SLOTS = 7;

/**
 * A STORED board as 7 fixed slots holding the real `Card` (the Career match banner's final team, and the Match
 * details scoreboard's board: one renderer for every stored board). `skins` is whatever the CALLER decided this
 * board may wear (the owner's own recorded skins, or an opponent's through the "Show opponent skins" toggle);
 * null = default art. Needs a `container-type: inline-size` ancestor: the tile width is measured against it.
 *
 * `compact` pins the cards to the compact arched tile whatever the global card-text setting says (Match details,
 * 2026-09-28: a full-text card's drawer hangs below its tile, and inside a scrolling panel that unreserved overflow
 * is what made the panel scroll and jitter). The views are memoised per board, so a parent re-render never hands
 * the memoised `Card` a fresh object.
 */
export function StoredTeam({ minions, skins, label = 'Final team', compact }: {
  minions: readonly BoardMinion[]; skins: RunCosmeticSnapshot | null; label?: string; compact?: boolean;
}) {
  const views = useMemo(() => minions.slice(0, BOARD_SLOTS).map(storedCardView), [minions]);
  return (
    <MinionSkins snapshot={skins}>
      <div className="cv2-team" aria-label={label}>
        {Array.from({ length: BOARD_SLOTS }, (_, i) => {
          const v = views[i];
          return v
            ? <div className="cv2-tile" key={i}><Card card={v} suppressPop forceCompact={compact} /></div>
            : <div className="cv2-tile empty" key={i} aria-hidden="true" />;
        })}
      </div>
    </MinionSkins>
  );
}
