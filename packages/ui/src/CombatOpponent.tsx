import { createPortal } from 'react-dom';
import { useGame } from './store';
import { playerOpponent } from '@game/sim';
import { RUNE_INDEX } from '@game/content';
import { heroArt, runeArt } from './art';
import { mdBold } from './Card';
import { Icon } from './Icon';

/**
 * THE COMBAT OPPONENT — the foe's hero portrait, dropped in over the Refresh button for the fight (owner ask
 * 2026-08-25).
 *
 * In a LOBBY run the foe only ever appeared as a row in the right-hand rail, and the rail slides away when
 * combat starts — so the fight had no face on the other side of it. This is that face: the same circular
 * portrait + name plate + health pill the player's own hero wears at the bottom-left, mirrored into the
 * board's top-right so the two heroes read as opponents across the board.
 *
 * It is also the LUNGE TARGET for the post-combat hero strike (`heroStrike.ts`), which is why it is a real
 * positioned element rather than a decoration painted into the rail.
 *
 * Mounted only while `.app.combat` is on; the drop-in itself is CSS (transform/opacity only — compositor-only,
 * per docs/performance.md).
 */
export function CombatOpponent(): JSX.Element | null {
  const lobby = useGame((s) => s.run.lobby);
  const inCombat = useGame((s) => s.run.phase === 'combat');
  const pill = useGame((s) => s.heroAtkPill);
  const dmg = useGame((s) => s.heroDmgTaken);
  const preview = useGame((s) => s.duelPreview);
  if (!lobby || (!inCombat && !preview)) return null;   // `preview` = the dev tuner's Test button
  const next = playerOpponent(lobby);
  const seat = next?.seat;
  if (!seat) return null;
  const art = heroArt(seat.heroId);
  // The foe's owned RUNES — from the served board's captured snapshot (bots/authored seats have none). Rendered
  // with the SAME `.questbadge.runebadge` markup the player uses, so art, hover tip and pulse animation match.
  const runes = (next?.board.snapshot?.runes ?? []).filter((id) => RUNE_INDEX[id]);
  // PORTAL to <body>: `.combatopp` must be able to paint ABOVE the player's statusbar (z40) when the foe
  // strikes. It used to live inside `.app` (a z-index:1 stacking context), which capped it under the
  // statusbar — the earlier fix raised the whole `.app`, which dragged the board layer over the player and
  // made the player portrait vanish (owner report 2026-08-25). As a root-level sibling of `.app` and
  // `.statusbar` it carries its own z-index (see styles.css) and lifts on its own. `position: fixed` keeps
  // its on-screen spot regardless of DOM parent.
  return createPortal(
    // Three nested roles, mirroring the player's housing (owner ask 2026-08-25):
    //   .combatopp       — fixed position + the ⚔️ tuner's centring scale/offset (GSAP never touches it).
    //   .combatopp-drop  — the whole group's drop-in; NAME and HEALTH live here so they stay ANCHORED.
    //   .combatopp-body  — the LUNGE target: the portrait (and its attack pill) ONLY, so the strike carries
    //                      just the face — the name and health do not fly with it, exactly as the player's
    //                      health stays put while the portrait lunges.
    <div className="combatopp" aria-hidden="true">
      <div className="combatopp-drop">
        <div className="combatopp-name">{seat.label}</div>
        <div className="combatopp-body">
          <div className="combatopp-portrait">
            {/* The foe's ATTACK PILL — same badge the player wears; inside the body so it rides the lunge. */}
            {pill?.side === 'opp' && <span key={`atk${pill.amount}${pill.buffed ? 'b' : ''}`} className={`hero-atk hero-atk-opp${pill.buffed ? ' buffed' : ''}`}>{pill.amount}</span>}
            {art ? <img className="combatopp-img" src={art} alt="" draggable={false} /> : <Icon name="anvil" />}
          </div>
          {/* The RED damage-taken number — centred on the portrait, OUTSIDE the clipped circle so it can overrun. */}
          {dmg?.side === 'opp' && <span key={`dmg${dmg.seq}`} className="hero-dmgtaken">−{dmg.amount}</span>}
        </div>
        <div className="combatopp-hp">
          <Icon name="heart" />{seat.resolve}
          {seat.armor > 0 && <span className="combatopp-armor">+{seat.armor}</span>}
        </div>
      </div>
      {/* The foe's RUNES — a column beside the portrait (positions/scale from the ⚔️ Hero Duel tuner). Same
          badge component as the player's, so hover + the trigger bounce animate identically. `pointer-events`
          is re-enabled here alone (the rest of the group is inert) so the tooltips can be hovered. */}
      {runes.length > 0 && (
        <div className="combatopp-runes">
          {runes.map((id, i) => {
            const rune = RUNE_INDEX[id]!;
            const rart = runeArt(rune.id);
            return (
              <div className="questbadge runebadge combatopp-rune" key={`${id}#${i}`} data-source-id={id}>
                <div className="questbadge-inner">
                  {rart
                    ? <img className="questbadge-art" src={rart} alt="" aria-hidden />
                    : <span className="questbadge-emblem" aria-hidden><Icon name="sc" /></span>}
                </div>
                <div className="questbadge-tip" role="tooltip">
                  <b>{rune.name}</b>
                  <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
                  <span className="questbadge-tip-state">Rune · active</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>,
    document.body,
  );
}
