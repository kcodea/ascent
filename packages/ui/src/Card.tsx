import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Keyword, Tribe } from '@game/core';
import { Icon } from './Icon';
import { Sprite } from './Sprite';
import { spriteForTribe } from './sprites';

const KW_LABEL: Record<Keyword, string> = {
  T: 'Taunt', DS: 'Shield', P: 'Poison', W: 'Windfury', R: 'Reborn', C: 'Cleave', M: 'Magnetic', SC: 'Start', CN: 'Consume',
};
const KW_ICON: Partial<Record<Keyword, string>> = {
  T: 'taunt', DS: 'shield', P: 'poison', C: 'cleave', SC: 'sc',
};
/** Plain-language keyword meanings, revealed in the hover tooltip (handoff A.4). */
const KW_DESC: Record<Keyword, string> = {
  T: 'Taunt — Enemies must attack this minion first.',
  DS: 'Divine Shield — Blocks the first hit it takes.',
  P: 'Poison — Destroys any minion it damages.',
  W: 'Windfury — Attacks twice each combat turn.',
  R: 'Reborn — The first time it dies, it returns with 1 Health.',
  C: 'Cleave — Also hits the minions beside its target.',
  M: 'Magnetic — Drag onto a friendly Mech to merge its stats in.',
  SC: 'Start of Combat — Triggers once, right before the fight begins.',
  CN: 'Consume — Eats one of your minions to add its stats.',
};
const TRIBE_LABEL: Record<Tribe, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', neutral: 'Neutral',
};
/** Each tribe's own footer glyph (handoff: the symbol matches the type — paw = Beast, etc.). */
const TRIBE_ICON: Record<Tribe, string> = {
  beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star',
};

const mdBold = (s: string): string => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
/**
 * Golden (tripled) cards show their numbers doubled to match the doubled effect:
 * "+1/+1" → "+2/+2", "deal 3" / "deal **3**" → "deal 6", "3 to every" → "6 to
 * every", "3 more" → "6 more". (Bare "N/N" token stats are left alone.)
 */
const doubleNums = (s: string): string =>
  s
    .replace(/\+(\d+)/g, (_m, n: string) => '+' + String(Number(n) * 2))
    .replace(/(\bdeal\s+\*{0,2})(\d+)/gi, (_m, p: string, n: string) => p + String(Number(n) * 2))
    .replace(/(\*{0,2})(\d+)(\s+to\s+every)/gi, (_m, b: string, n: string, t: string) => b + String(Number(n) * 2) + t)
    .replace(/(\d+)(\s+more\b)/gi, (_m, n: string, t: string) => String(Number(n) * 2) + t);

export interface CardView {
  name: string;
  tribe: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  text: string;
  cost?: number;
  golden?: boolean;
  tier?: number;
  /** A non-minion spell card (e.g. the triple Discover) — hides the stat footer. */
  spell?: boolean;
  /** Base (printed) stats — stats above base render green, below base render red. */
  baseAttack?: number;
  baseHealth?: number;
}

/** Green when a stat is above its base, red when below — for at-a-glance buffs/damage. */
const statCls = (cur: number, base?: number): string =>
  base === undefined || cur === base ? '' : cur > base ? ' up' : ' down';

/** The one standardized card — identical size/shape in shop, warband, and hand. */
export function Card({
  card,
  uid,
  onClick,
  highlight,
  dimmed,
  buffed,
  onPointerDown,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  card: CardView;
  /** Instance id, exposed as data-uid so layout (FLIP) animations can track the card. */
  uid?: string;
  onClick?: () => void;
  highlight?: boolean;
  /** Dim this card while a copy of it is being dragged. */
  dimmed?: boolean;
  /** Play a one-shot green buff flash (a recruit-phase stat buff just landed). */
  buffed?: boolean;
  onPointerDown?: (e: ReactPointerEvent) => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
}) {
  return (
    <div
      className={`card${highlight ? ' armed' : ''}${card.golden ? ' golden' : ''}${dimmed ? ' dragsrc' : ''}${buffed ? ' cardbuff' : ''}${card.keywords.includes('T') ? ' taunt' : ''}${card.spell ? ' spellcard' : ''}`}
      data-uid={uid}
      style={{ '--c': `var(--t-${card.tribe})` } as CSSProperties}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${card.name}, ${card.attack}/${card.health}` : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      onPointerDown={onPointerDown}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {card.tier !== undefined && <span className="tierbadge">Tier {card.tier}</span>}
      {card.keywords.includes('T') && (
        <span className="tauntward" aria-hidden="true"><Icon name="taunt" /></span>
      )}
      <div className="art">
        {card.cost !== undefined && <span className="cost">{card.cost}</span>}
        <Sprite name={spriteForTribe(card.tribe)} scale={5} />
      </div>
      <div className="cbody">
        <div className="cn">{card.name}</div>
        {card.keywords.length > 0 && (
          <div className="kws">
            {card.keywords.map((k) => (
              <span className="kw" key={k}>
                {KW_ICON[k] && <Icon name={KW_ICON[k]!} />}
                {KW_LABEL[k]}
              </span>
            ))}
          </div>
        )}
        {card.text && (
          <div
            className="desc"
            dangerouslySetInnerHTML={{ __html: mdBold(card.golden ? doubleNums(card.text) : card.text) }}
          />
        )}
      </div>
      <div className="cfoot">
        {card.spell ? (
          <span className="ctype spell">✦ Spell</span>
        ) : (
          <>
            <span className={`atk${statCls(card.attack, card.baseAttack)}`}>{card.attack}</span>
            <span className="ctype">
              <Icon name={TRIBE_ICON[card.tribe]} />
              {TRIBE_LABEL[card.tribe]}
            </span>
            <span className={`hp${statCls(card.health, card.baseHealth)}`}>{card.health}</span>
          </>
        )}
      </div>
      {card.keywords.length > 0 && (
        <div className="tip" role="tooltip">
          {card.keywords.map((k) => (
            <div className="tiprow" key={k}>
              {KW_DESC[k]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
