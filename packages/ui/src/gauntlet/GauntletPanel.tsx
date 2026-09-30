/**
 * THE GAUNTLET RAIL — what a Gauntlet run shows where a lobby run shows its 8-seat table (`LobbyPanel`).
 *
 * A Gauntlet is you against ONE authored opponent for ten rounds, so the table has nothing to rank: the rail
 * carries the stage's opponent (name + tribe emblem), your own health, the round out of ten and this round's loss
 * cap (the Gauntlet's own table, via `roundLossCap`). It deliberately shows NO seat list and no hover scouting —
 * the opponent's next board is not for reading ahead (spec §1). It wears the lobby rail's classes, so it sits,
 * sizes and slides away for combat exactly as the rail does.
 */
import { memo } from 'react';
import { roundLossCap, type RunLobby } from '@game/sim';
import { GAUNTLET_ROUNDS, gauntletStage } from '@game/content';
import { Icon } from '../Icon';
import { useGame } from '../store';
import { TRIBE_ICON } from './StageSelect';

export const GauntletPanel = memo(function GauntletPanel({ lobby, stage }: { lobby: RunLobby; stage: number | undefined }): JSX.Element {
  // YOUR health reads the run, not the seat — the seat only re-syncs when the round settles (see LobbyPanel).
  const resolve = useGame((st) => st.run.resolve);
  const armor = useGame((st) => st.run.armor);
  // The lobby's round runs one past the last once the stage is over; the readout holds at the final round.
  const round = Math.min(lobby.round, GAUNTLET_ROUNDS);
  const cap = roundLossCap(lobby.rules, round);
  const tribe = stage !== undefined ? gauntletStage(stage)?.tribe : undefined;
  const foe = lobby.seats[1];
  return (
    <div className="lobbyrail gauntletrail">
      <div className="lobbyhead">
        <span className="lobbyround">Round {round} / {GAUNTLET_ROUNDS}</span>
        <span className="lobbymax gtip gtip-down gtip-end" aria-label="Most Health you can lose if you lose this combat" data-tip="Most Health you can lose if you lose this combat">
          <Icon name="heart" />{Number.isFinite(cap) ? `Max loss: ${cap}` : 'No cap'}
        </span>
      </div>
      <div className="gauntletrail-foe">
        {tribe && <span className="gauntletrail-emblem" aria-hidden="true"><Icon name={TRIBE_ICON[tribe]} /></span>}
        <span className="gauntletrail-foetext">
          {stage !== undefined && <span className="gauntletrail-stage">Stage {stage}</span>}
          <span className="gauntletrail-name">{foe?.label ?? ''}</span>
        </span>
      </div>
      <div className="gauntletrail-you">
        <span className="gauntletrail-youlabel">You</span>
        <span className="lobbyhp">
          <Icon name="heart" />{resolve}
          {armor > 0 && <span className="lobbyarmor"><Icon name="shield" />{armor}</span>}
        </span>
      </div>
    </div>
  );
});
