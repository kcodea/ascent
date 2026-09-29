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
 */
export function StoredTeam({ minions, skins, label = 'Final team' }: {
  minions: readonly BoardMinion[]; skins: RunCosmeticSnapshot | null; label?: string;
}) {
  const shown = minions.slice(0, BOARD_SLOTS);
  return (
    <MinionSkins snapshot={skins}>
      <div className="cv2-team" aria-label={label}>
        {Array.from({ length: BOARD_SLOTS }, (_, i) => {
          const m = shown[i];
          return m
            ? <div className="cv2-tile" key={i}><Card card={storedCardView(m)} suppressPop /></div>
            : <div className="cv2-tile empty" key={i} aria-hidden="true" />;
        })}
      </div>
    </MinionSkins>
  );
}
