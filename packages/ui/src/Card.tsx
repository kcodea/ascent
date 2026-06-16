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

export interface CardView {
  name: string;
  tribe: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  text: string;
  cost?: number;
  golden?: boolean;
}

/** The one standardized card — identical size/shape in shop, warband, and hand. */
export function Card({
  card,
  onClick,
  highlight,
  dimmed,
  onPointerDown,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  card: CardView;
  onClick?: () => void;
  highlight?: boolean;
  /** Dim this card while a copy of it is being dragged. */
  dimmed?: boolean;
  onPointerDown?: (e: ReactPointerEvent) => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
}) {
  return (
    <div
      className={`card${highlight ? ' armed' : ''}${card.golden ? ' golden' : ''}${dimmed ? ' dragsrc' : ''}`}
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
        {card.text && <div className="desc" dangerouslySetInnerHTML={{ __html: mdBold(card.text) }} />}
      </div>
      <div className="cfoot">
        <span className="atk">{card.attack}</span>
        <span className="ctype">
          <Icon name={TRIBE_ICON[card.tribe]} />
          {TRIBE_LABEL[card.tribe]}
        </span>
        <span className="hp">{card.health}</span>
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
