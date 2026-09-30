/**
 * THE GAUNTLET FOE — what a Gauntlet run floats on the right side of the shop where a lobby run shows its 8-seat
 * table (`LobbyPanel`). Owner ask 2026-09-29: "we dont need the lobby rail. we can just have the opponent's portait
 * and name hovering on the right side during shop phase".
 *
 * A Gauntlet is you against ONE authored opponent for ten rounds, so there is no table to rank: just the stage's
 * opponent — its tribe emblem in a portrait disc (the opponent has no hero), its name, and one small line with the
 * round out of ten and this round's loss cap (the Gauntlet's own table, via `roundLossCap`). No box, no frame
 * chrome, no seat list and no scouting — the opponent's next board is not for reading ahead (spec §1). Your own
 * health is not repeated here (the HUD carries it). It slides away for combat exactly as the lobby rail does.
 *
 * Reads the store through PRIMITIVE selectors and takes no props, so Recruit's (hot) renders never re-render it.
 */
import { memo } from 'react';
import { roundLossCap } from '@game/sim';
import { GAUNTLET_ROUNDS } from '@game/content';
import { Icon } from '../Icon';
import { useGame } from '../store';
import { TRIBE_ICON } from './tribeIcon';
import { foePortrait } from './foePortrait';

export const GauntletFoe = memo(function GauntletFoe(): JSX.Element | null {
  const name = useGame((s) => s.run.lobby?.seats[1]?.label ?? '');
  const stage = useGame((s) => s.run.gauntletStage);
  // The lobby's round runs one past the last once the stage is over; the readout holds at the final round.
  const round = useGame((s) => Math.min(s.run.lobby?.round ?? 1, GAUNTLET_ROUNDS));
  const cap = useGame((s) => roundLossCap(s.run.lobby?.rules, Math.min(s.run.lobby?.round ?? 1, GAUNTLET_ROUNDS)));
  const { art, tribe } = foePortrait(stage);
  return (
    <div className="gauntletfoe" aria-label={`Your opponent: ${name}`}>
      <div className="gauntletfoe-portrait" aria-hidden="true">
        {art
          ? <img decoding="sync" className="gauntletfoe-img" src={art} alt="" draggable={false} />
          : <span className="gauntletfoe-emblem"><Icon name={tribe ? TRIBE_ICON[tribe] : 'anvil'} /></span>}
      </div>
      <div className="gauntletfoe-name">{name}</div>
      <div className="gauntletfoe-meta">
        Round {round} / {GAUNTLET_ROUNDS} · {Number.isFinite(cap) ? `Max loss ${cap}` : 'No cap'}
      </div>
    </div>
  );
});
