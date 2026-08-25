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
  if (!lobby || !inCombat) return null;
  const next = playerOpponent(lobby);
  const seat = next?.seat;
  if (!seat) return null;
  const art = heroArt(seat.heroId);
  return (
    <div className="combatopp" aria-hidden="true">
      {/* The BODY is the lunge target: the outer `.combatopp` owns a centring CSS transform, and GSAP writes
          `transform` too — animating the outer element would clobber the centring and make it jump half its
          size. So the wrapper positions, the body moves. */}
      <div className="combatopp-body">
      <div className="combatopp-portrait">
        {/* The foe's ATTACK PILL — same badge the player's portrait wears; a child so it rides the lunge. */}
        {pill?.side === 'opp' && <span key={`atk${pill.amount}`} className="hero-atk">{pill.amount}</span>}
        {art ? <img className="combatopp-img" src={art} alt="" draggable={false} /> : <Icon name="anvil" />}
      </div>
      <div className="combatopp-name">{seat.label}</div>
      <div className="combatopp-hp">
        <Icon name="heart" />{seat.resolve}
        {seat.armor > 0 && <span className="combatopp-armor">+{seat.armor}</span>}
      </div>
      </div>
    </div>
  );
}
