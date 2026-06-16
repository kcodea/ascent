import type { CSSProperties, DragEvent } from 'react';
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

const mdBold = (s: string): string => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

export interface CardView {
  name: string;
  tribe: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  text: string;
  cost?: number;
}

/** The one standardized card — identical size/shape in shop, warband, and hand. */
export function Card({
  card,
  onClick,
  highlight,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  card: CardView;
  onClick?: () => void;
  highlight?: boolean;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
}) {
  return (
    <div
      className={`card${highlight ? ' armed' : ''}`}
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
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >

      <div className="art">
        {card.cost !== undefined && <span className="cost">{card.cost}</span>}
        <Sprite name={spriteForTribe(card.tribe)} scale={4} />
        <span className="atk">{card.attack}</span>
        <span className="hp">{card.health}</span>
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
        <div className="desc" dangerouslySetInnerHTML={{ __html: mdBold(card.text) }} />
      </div>
    </div>
  );
}
