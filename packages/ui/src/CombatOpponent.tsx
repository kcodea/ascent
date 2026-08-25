import { useGame } from './store';
import { playerOpponent } from '@game/sim';
import { heroArt } from './art';
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
  const preview = useGame((s) => s.duelPreview);
  if (!lobby || (!inCombat && !preview)) return null;   // `preview` = the dev tuner's Test button
  const next = playerOpponent(lobby);
  const seat = next?.seat;
  if (!seat) return null;
  const art = heroArt(seat.heroId);
  return (
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
            {pill?.side === 'opp' && <span key={`atk${pill.amount}`} className="hero-atk hero-atk-opp">{pill.amount}</span>}
            {art ? <img className="combatopp-img" src={art} alt="" draggable={false} /> : <Icon name="anvil" />}
          </div>
        </div>
        <div className="combatopp-hp">
          <Icon name="heart" />{seat.resolve}
          {seat.armor > 0 && <span className="combatopp-armor">+{seat.armor}</span>}
        </div>
      </div>
    </div>
  );
}
