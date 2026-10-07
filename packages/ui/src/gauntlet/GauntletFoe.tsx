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
import { runeAccentTribe } from '../RuneCard';
import { memo } from 'react';
import { roundLossCap } from '@game/sim';
import { GAUNTLET_ROUNDS, RUNE_INDEX, gauntletStage } from '@game/content';
import { useGame } from '../store';
import { usePortraitFrame } from '../portraitFrame/PortraitFrame';
import { FoePortraitDisc } from '../FoePortraitDisc';
import { foePortrait } from './foePortrait';
import { Icon } from '../Icon';
import { runeArt } from '../art';
import { mdBold } from '../Card';

export const GauntletFoe = memo(function GauntletFoe(): JSX.Element | null {
  const name = useGame((s) => s.run.lobby?.seats[1]?.label ?? '');
  const stage = useGame((s) => s.run.gauntletStage);
  // The lobby's round runs one past the last once the stage is over; the readout holds at the final round.
  const round = useGame((s) => Math.min(s.run.lobby?.round ?? 1, GAUNTLET_ROUNDS));
  const cap = useGame((s) => roundLossCap(s.run.lobby?.rules, Math.min(s.run.lobby?.round ?? 1, GAUNTLET_ROUNDS)));
  // The SAME ring the combat opponent wears (null = the baked gold CSS border).
  const frame = usePortraitFrame('opp');
  const { art, tribe } = foePortrait(stage);
  // The opponent's two rune sockets (owner ask 2026-09-30): dotted until the rune's round, then its art + tip.
  const stageRunes = stage !== undefined ? gauntletStage(stage)?.runes : undefined;
  const sockets: { from: number; id?: string }[] = [
    { from: 6, id: stageRunes?.round6 }, { from: 9, id: stageRunes?.round9 },
  ];
  return (
    <div className="gauntletfoe" aria-label={`Your opponent: ${name}`}>
      <div className="gauntletfoe-group">
        <div className="combatopp-name hudpill-name">{name}</div>
        <div className="gauntletfoe-face" aria-hidden="true">
          <FoePortraitDisc art={art} gauntlet tribe={tribe} frame={frame} />
        </div>
        <div className="gauntletfoe-meta hudpill-hp">Round {round} / {GAUNTLET_ROUNDS}</div>
        {/* The round's loss cap in its own pill below (owner ask 2026-09-30): the number + heart in red. */}
        <div className="gauntletfoe-cap hudpill-hp">
          {Number.isFinite(cap)
            ? <>Max loss <span className="gauntletfoe-capnum"><Icon name="heartPill" />{cap}</span></>
            : 'No cap'}
        </div>
        <div className="gauntletfoe-runes">
          <div className="gauntletfoe-runerow">
            {sockets.map(({ from, id }) => {
              const rune = id && round >= from ? RUNE_INDEX[id] : undefined;
              if (!rune) {
                return (
                  <div className="gauntletfoe-runeslot" key={from} aria-label={`Rune socket, round ${from}`}>
                    <div className="questbadge-tip" role="tooltip">
                      <b>Opponent rune</b>
                      <span className="questbadge-tip-state">{id ? `Arrives on round ${from}` : 'None this stage'}</span>
                    </div>
                  </div>
                );
              }
              const rart = runeArt(rune.id);
              return (
                <div className={`questbadge runebadge gauntletfoe-rune${rune.epic ? ' runebadge-epic' : ''}`} data-tribe={runeAccentTribe(rune)} style={{ '--rt': `var(--t-${runeAccentTribe(rune)})` } as React.CSSProperties} key={from} data-source-id={rune.id}>
                  <div className="questbadge-inner">
                    {rart
                      ? <img decoding="sync" className="questbadge-art" src={rart} alt="" aria-hidden />
                      : <span className="questbadge-emblem" aria-hidden><Icon name="engrave" /></span>}
                  </div>
                  <div className="questbadge-tip" role="tooltip">
                    <b>{rune.name}</b>
                    <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
