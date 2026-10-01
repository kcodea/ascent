import type { ReactNode } from 'react';
import type { Tribe } from '@game/core';
import { Icon } from './Icon';
import { PortraitFrame, pfClass } from './portraitFrame/PortraitFrame';
import type { ResolvedFrame } from './portraitFrame/portraitFrameConfig';
import { TRIBE_ICON } from './gauntlet/tribeIcon';

/**
 * THE FOE PORTRAIT DISC — the opponent's round face, shared by the combat opponent (`CombatOpponent`) and the
 * Gauntlet's shop-phase foe (`GauntletFoe`) so the two can never drift apart (owner ask 2026-09-30: the shop
 * portrait should "mimic that of the portrait shown during the combat phase"). One markup, one set of classes
 * (`.combatopp-portrait` / `.combatopp-img` / `.combatopp-cardart` / `.combatopp-emblem`), one frame ring
 * (`usePortraitFrame('opp')`, resolved by the caller so a memoised parent keeps a stable reference).
 *
 * The face: the hero (or Gauntlet portrait-card) art when there is one; a Gauntlet foe with no art wears its
 * stage's TRIBE EMBLEM; anything else falls back to the neutral anvil. `children` render between the art and the
 * ring (the combat portrait's Buffs-panel hover prompt lives there).
 */
export function FoePortraitDisc({
  art, gauntlet, tribe, frame, extraClass = '', onClick, role, children,
}: {
  art?: string;
  gauntlet: boolean;
  tribe?: Exclude<Tribe, 'neutral'>;
  frame: ResolvedFrame | null;
  /** Extra classes WITH their leading space (e.g. ' hasbuffs'). */
  extraClass?: string;
  onClick?: () => void;
  role?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div
      className={`combatopp-portrait${extraClass}${pfClass(frame)}`}
      style={frame?.hostStyle}
      onClick={onClick}
      role={role}
    >
      {art
        ? <img decoding="sync" className={`combatopp-img${gauntlet ? ' combatopp-cardart' : ''}`} src={art} alt="" draggable={false} />
        : gauntlet
        ? <span className="combatopp-emblem"><Icon name={tribe ? TRIBE_ICON[tribe] : 'anvil'} /></span>
        : <Icon name="anvil" />}
      {children}
      <PortraitFrame frame={frame} />
    </div>
  );
}
