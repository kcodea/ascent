import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Keyword, Tribe } from '@game/core';
import { artFor } from './art';
import { Icon } from './Icon';
import { Sprite } from './Sprite';
import { spriteForTribe } from './sprites';
import { useGame } from './store';

const KW_LABEL: Record<Keyword, string> = {
  T: 'Taunt', DS: 'Shield', P: 'Poison', W: 'Windfury', R: 'Reborn', C: 'Cleave', M: 'Magnetic', SC: 'Start', CN: 'Consume',
  FD: 'Fodder', IMM: 'Immune', ST: 'Stealth', RL: 'Rally',
};
const KW_ICON: Partial<Record<Keyword, string>> = {
  T: 'taunt', DS: 'shield', P: 'poison', C: 'cleave', SC: 'sc', IMM: 'shield', ST: 'eye', RL: 'sword',
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
  FD: 'Fodder — A cheap minion your Demon cards can consume for its stats.',
  IMM: 'Immune — Takes no damage.',
  ST: 'Stealth — Can’t be attacked until it attacks.',
  RL: 'Rally — Triggers each time this attacks.',
};
const TRIBE_LABEL: Record<Tribe, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', neutral: 'Neutral',
};
/** Each tribe's own footer glyph (handoff: the symbol matches the type — paw = Beast, etc.). */
const TRIBE_ICON: Record<Tribe, string> = {
  beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star',
};

export const mdBold = (s: string): string => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
/** A {{…}} marker → a green "modified" span (e.g. Kennelmaster's Avenge-boosted buff). */
const descUp = (s: string): string => s.replace(/\{\{(.+?)\}\}/g, '<span class="descup">$1</span>');
/**
 * Golden (tripled) cards show their numbers doubled to match the doubled effect:
 * "+1/+1" → "+2/+2", "deal 3" / "deal **3**" → "deal 6", "3 to every" → "6 to
 * every", "3 more" → "6 more". A consume multiplier "Nx" instead grows by one
 * (Voracious Imp "2x" → "3x"), matching the golden fodder rule. (Bare "N/N" token
 * stats are left alone.) Text inside a {{…}} marker is left untouched — it's already a
 * final, computed value (e.g. Kennelmaster's combined summon buff). */
const doubleNumsRaw = (s: string): string =>
  s
    .replace(/(\*{0,2})(\d+)x\b/g, (_m, b: string, n: string) => b + String(Number(n) + 1) + 'x')
    .replace(/\+(\d+)/g, (_m, n: string) => '+' + String(Number(n) * 2))
    .replace(/(\bdeal\s+\*{0,2})(\d+)/gi, (_m, p: string, n: string) => p + String(Number(n) * 2))
    .replace(/(\*{0,2})(\d+)(\s+to\s+every)/gi, (_m, b: string, n: string, t: string) => b + String(Number(n) * 2) + t)
    .replace(/(\d+)(\s+more\b)/gi, (_m, n: string, t: string) => String(Number(n) * 2) + t);
const doubleNums = (s: string): string =>
  s.split(/(\{\{.*?\}\})/).map((seg) => (seg.startsWith('{{') ? seg : doubleNumsRaw(seg))).join('');

export interface CardView {
  name: string;
  /** Card id — used to look up illustrated art (falls back to the tribe sprite). */
  cardId?: string;
  tribe: Tribe;
  /** Second tribe for dual-type minions — splits the card into both hues. */
  tribe2?: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  text: string;
  cost?: number;
  golden?: boolean;
  tier?: number;
  /** A non-minion spell card (e.g. the triple Discover) — hides the stat footer. */
  spell?: boolean;
  /** Requires a friendly target when cast (drives the cast-by-drag targeting). */
  target?: 'friendly';
  /** Base (printed) stats — stats above base render green, below base render red. */
  baseAttack?: number;
  baseHealth?: number;
}

/** Green when a stat is above its base, red when below — for at-a-glance buffs/damage. */
const statCls = (cur: number, base?: number): string =>
  base === undefined || cur === base ? '' : cur > base ? ' up' : ' down';

/**
 * Trigger abilities (Battlecry / Deathrattle / Avenge / End of Turn) aren't keywords
 * in the data model — they read from the text prefix and get their own pill (matching
 * Start / Consume), so every card's keyword row lands in the same place and the
 * description starts on a fixed line. Tolerates leading markdown/space ("**Battlecry:**").
 */
const triggerPill = (text: string): { label: string; icon: string } | null =>
  /^\W*battlecry/i.test(text)
    ? { label: 'Battlecry', icon: 'battlecry' }
    : /^\W*deathrattle/i.test(text)
      ? { label: 'Deathrattle', icon: 'skull' }
      : /^\W*avenge/i.test(text)
        ? { label: 'Avenge', icon: 'skull' }
        : /^\W*end of turn/i.test(text)
          ? { label: 'End of Turn', icon: 'sc' }
          : null;

/** The one standardized card — identical size/shape in shop, warband, and hand. */
export function Card({
  card,
  uid,
  onClick,
  highlight,
  targeted,
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
  /** The current aim target of a hero power / single-target ability — strong highlight. */
  targeted?: boolean;
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
  const inspectCard = useGame((s) => s.inspectCard);
  // Pills row: the trigger (Battlecry / Deathrattle, derived from the text) then any
  // keyword pills. Always rendered (reserves a row) so the description starts on a
  // fixed line whether or not the card has pills.
  const trigger = triggerPill(card.text);
  const pills: { label: string; icon?: string }[] = [
    ...(trigger ? [trigger] : []),
    ...card.keywords.map((k) => ({ label: KW_LABEL[k], icon: KW_ICON[k] })),
  ];
  return (
    <div
      className={`card${highlight ? ' armed' : ''}${targeted ? ' targeted' : ''}${card.golden ? ' golden' : ''}${dimmed ? ' dragsrc' : ''}${buffed ? ' cardbuff' : ''}${card.keywords.includes('T') ? ' taunt' : ''}${card.keywords.includes('ST') ? ' stealth' : ''}${card.keywords.includes('DS') ? ' dscard' : ''}${card.spell ? ' spellcard' : ''}${card.tribe2 ? ' dual' : ''}`}
      data-uid={uid}
      style={{ '--c': `var(--t-${card.tribe})`, '--c2': `var(--t-${card.tribe2 ?? card.tribe})` } as CSSProperties}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        inspectCard(card);
      }}
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
      {card.tier !== undefined && <span className="tierbadge" data-tier={card.tier}>Tier {card.tier}</span>}
      {/* cost badge — a teal Mana circle overhanging the corner */}
      {card.cost !== undefined && (
        <span className="cost">
          <span className="costn">{card.cost}</span>
        </span>
      )}
      {card.keywords.includes('T') && (
        <span className="tauntward" aria-hidden="true"><Icon name="taunt" /></span>
      )}
      <div className="art">
        {artFor(card.cardId) ? (
          <img className="artimg" src={artFor(card.cardId)} alt="" draggable={false} />
        ) : (
          <Sprite name={spriteForTribe(card.tribe)} scale={5} />
        )}
      </div>
      <div className="cbody">
        <div className="cn">{card.name}</div>
        <div className="kws">
          {pills.map((p, i) => (
            <span className="kw" key={`${p.label}-${i}`}>
              {p.icon && <Icon name={p.icon} />}
              {p.label}
            </span>
          ))}
        </div>
        {card.text && (
          <div
            className="desc"
            dangerouslySetInnerHTML={{ __html: descUp(mdBold(card.golden ? doubleNums(card.text) : card.text)) }}
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
      {/* One-shot buff proc: an expanding ring + sparks burst over the card when a
          recruit-phase buff lands (hero power, spell, summon buff). Painted on top. */}
      {buffed && (
        <span className="buffburst" aria-hidden="true">
          <span className="bb-ring" />
          <span className="bb-spark" style={{ '--a': '20deg' } as CSSProperties} />
          <span className="bb-spark" style={{ '--a': '100deg' } as CSSProperties} />
          <span className="bb-spark" style={{ '--a': '170deg' } as CSSProperties} />
          <span className="bb-spark" style={{ '--a': '250deg' } as CSSProperties} />
          <span className="bb-spark" style={{ '--a': '320deg' } as CSSProperties} />
        </span>
      )}
    </div>
  );
}
