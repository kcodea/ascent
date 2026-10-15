/**
 * VERSUS: a room member's face in the game's PORTRAIT RING (the title screen's `.portring` markup): their art (an avatar,
 * or a hero portrait in their skin), their equipped portrait-frame cosmetic over it, the gold ring when they wear
 * none, and their initial when they have no art. Used by the stands' bench and the spectator bar, so a member's face
 * reads the same as everywhere else.
 */
import type { RunCosmeticSnapshot } from '@game/progression';
import { parseCosmeticSnapshot } from '@game/progression';
import { avatarSrc } from '../art';
import { PortraitFrame, frameIdOf, pfClass, usePortraitFrame } from '../portraitFrame/PortraitFrame';
import { heroPortrait, opponentSkins } from '../skins/skins';
import { useGame } from '../store';

export function MemberRing({ name, profile, heroId, className = '' }: {
  name: string;
  /** The member's room profile (`avatar`, `cosmetics`). */
  profile: Record<string, unknown> | null | undefined;
  /** Show this hero (in their skin) instead of their avatar. */
  heroId?: string | null;
  className?: string;
}): JSX.Element {
  const showOpp = useGame((s) => s.showOpponentSkins);
  const cos: RunCosmeticSnapshot | null = opponentSkins(showOpp, parseCosmeticSnapshot(profile?.cosmetics) ?? null);
  const frame = usePortraitFrame('opp', frameIdOf(cos));
  const art = heroId ? heroPortrait(heroId, cos) : avatarSrc(typeof profile?.avatar === 'string' ? profile.avatar : null);
  return (
    <span className={`portring vsring ${className}${pfClass(frame)}`} style={frame?.hostStyle} aria-hidden="true">
      <span className="hero">
        <span className="f">
          {art
            ? <img decoding="sync" className="heroimg" src={art} alt="" draggable={false} />
            : <span className="vsring-initial">{(name.trim()[0] ?? '?').toUpperCase()}</span>}
        </span>
        <PortraitFrame frame={frame} />
      </span>
    </span>
  );
}
