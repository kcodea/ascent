/**
 * THE GAUNTLET FOE — what a Gauntlet run floats on the right side of the shop where a lobby run shows its 8-seat
 * table (`LobbyPanel`). Owner ask 2026-09-29: "we dont need the lobby rail. we can just have the opponent's portait
 * and name hovering on the right side during shop phase".
 *
 * Owner ask 2026-09-30: "can we have the demon lord portrait during the shopping phase mimic that of the portrait shown
 * during the combat phase? and just move it to the right side instead of the top corner?" So this now wears the combat
 * opponent's EXACT face: the shared `FoePortraitDisc` (same `.combatopp-portrait` disc, card-art crop / tribe emblem,
 * `usePortraitFrame('opp')` ring) and the same `.combatopp-name` plate, inside a wrapper scaled by the same
 * `--hd-opp-s` as the combat group — so the two can never drift, and the ⚔️ Hero Duel tuner's portrait size and name
 * dials drive both. Its PLACE is its own: vertically centred on the right edge (⚔️ Hero Duel → "Gauntlet shop foe").
 *
 * Shop-only differences, by design: no runes (spec: the foe's runes show in combat only), no health pill (the stage
 * opponent takes no damage, R-GAUNTLET-02), no hero power, no Buffs panel, no lunge target (`.combatopp-body` is the
 * strike's query hook, so it is deliberately NOT used here). In the health pill's slot sits one small line: the round
 * out of ten and this round's loss cap (the Gauntlet's own table, via `roundLossCap`). Nothing to scout — the
 * opponent's next board is not for reading ahead (spec §1). It slides away for combat as the lobby rail does.
 *
 * Reads the store through PRIMITIVE selectors and takes no props, so Recruit's (hot) renders never re-render it.
 */
import { memo } from 'react';
import { roundLossCap } from '@game/sim';
import { GAUNTLET_ROUNDS } from '@game/content';
import { useGame } from '../store';
import { usePortraitFrame } from '../portraitFrame/PortraitFrame';
import { FoePortraitDisc } from '../FoePortraitDisc';
import { foePortrait } from './foePortrait';
import { Icon } from '../Icon';

export const GauntletFoe = memo(function GauntletFoe(): JSX.Element | null {
  const name = useGame((s) => s.run.lobby?.seats[1]?.label ?? '');
  const stage = useGame((s) => s.run.gauntletStage);
  // The lobby's round runs one past the last once the stage is over; the readout holds at the final round.
  const round = useGame((s) => Math.min(s.run.lobby?.round ?? 1, GAUNTLET_ROUNDS));
  const cap = useGame((s) => roundLossCap(s.run.lobby?.rules, Math.min(s.run.lobby?.round ?? 1, GAUNTLET_ROUNDS)));
  // The SAME ring the combat opponent wears (null = the baked gold CSS border).
  const frame = usePortraitFrame('opp');
  const { art, tribe } = foePortrait(stage);
  return (
    <div className="gauntletfoe" aria-label={`Your opponent: ${name}`}>
      <div className="gauntletfoe-group">
        <div className="combatopp-name">{name}</div>
        <div className="gauntletfoe-face" aria-hidden="true">
          <FoePortraitDisc art={art} gauntlet tribe={tribe} frame={frame} />
        </div>
        <div className="gauntletfoe-meta">Round {round} / {GAUNTLET_ROUNDS}</div>
        {/* The round's loss cap in its own pill below (owner ask 2026-09-30): the number + heart in red. */}
        <div className="gauntletfoe-cap">
          {Number.isFinite(cap)
            ? <>Max loss <span className="gauntletfoe-capnum"><Icon name="heart" />{cap}</span></>
            : 'No cap'}
        </div>
      </div>
    </div>
  );
});
