import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Keyword, Tribe } from '@game/core';
import { artFor } from './art';
import { Icon } from './Icon';
import { Sprite } from './Sprite';
import { spriteForTribe } from './sprites';
import { useGame } from './store';

const KW_LABEL: Record<Keyword, string> = {
  T: 'Taunt', DS: 'Shield', V: 'Venomous', W: 'Windfury', R: 'Reborn', C: 'Cleave', M: 'Magnetic', SC: 'Start', CN: 'Consume',
  FD: 'Fodder', IMM: 'Immune', ST: 'Stealth', RL: 'Rally',
};
const KW_ICON: Partial<Record<Keyword, string>> = {
  T: 'taunt', DS: 'shield', V: 'poison', C: 'cleave', SC: 'sc', IMM: 'shield', ST: 'eye', RL: 'sword',
};
/** Plain-language keyword meanings, revealed in the hover tooltip (handoff A.4). */
const KW_DESC: Record<Keyword, string> = {
  T: 'Taunt — Enemies must attack this minion first.',
  DS: 'Divine Shield — Blocks the first hit it takes.',
  V: 'Venomous — Destroys any minion it damages. Drops off after its first proc in combat.',
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
  /** Explicit golden text (overrides the numeric doubler when shown golden). */
  goldenText?: string;
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
  /** Per-source recruit buffs (for the inspect-panel breakdown). */
  buffs?: { source: string; attack: number; health: number; count: number }[];
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

/** The one standardized card — identical size/shape in shop, warband, and hand.
 *  Memoized: during a drag the parent re-renders on every pointermove, but a card whose
 *  props are unchanged skips re-render (the recruit screen stabilises the view objects +
 *  the pointer-down handler so this actually fires). Only the floating drag-card updates. */
export const Card = memo(function Card({
  card,
  uid,
  onClick,
  highlight,
  targeted,
  dimmed,
  buffed,
  battlecry,
  arrived,
  electrify,
  karwind,
  refCards,
  dragging,
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
  /** One-shot flourish beneath a just-played minion whose Battlecry fired. */
  battlecry?: boolean;
  /** One-shot pop-in when a card is added to the hand mid-flow (combat Deathrattle grant). */
  arrived?: boolean;
  /** Electric flash — a Mech being magnetized onto by Combinator's End-of-Turn. */
  electrify?: boolean;
  /** Flame flash — a Dragon just buffed by Karwind (on top of the normal buff flash). */
  karwind?: boolean;
  /** Cards this card references (the token it summons / Fodder it buffs) — shown as a hover popup. */
  refCards?: CardView[];
  /** A drag is in progress somewhere — suppress the referenced-card hover popup (you're holding a card). */
  dragging?: boolean;
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
  // Referenced-card hover popup: a card that names/creates another (Combinator → Cling Drone,
  // Ritualist / Soulfeeder → current Fodder, Alleycat → Stray) shows it to the right on hover. The
  // popup is portalled to <body> so it escapes the card's hover/drag transforms and sits on top.
  const hasRefs = !!refCards?.length;
  const [refPos, setRefPos] = useState<{ left: number; top: number; origin: 'left' | 'right' } | null>(null);
  const refTimer = useRef<number | null>(null);
  // Show after a ~0.5s hover (so it doesn't flash while you skim the board); position is measured
  // when it actually opens, so it tracks the card even if it popped up (hand) in the meantime. The
  // popup renders at 0.8 scale — we anchor the scale to the source-facing edge (transform-origin) and
  // position so that *visible* edge sits a small gap from the hovered card (not the full-size box).
  const showRefTip = (el: HTMLElement): void => {
    if (refTimer.current) window.clearTimeout(refTimer.current);
    refTimer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      const n = refCards?.length ?? 1;
      const gap = 8;
      const tipW = r.width * n + (n - 1) * 8; // layout width (full-size cards)
      const visW = tipW * 0.8; // rendered width after the 0.8 scale
      const flip = r.right + gap + visW > window.innerWidth - 6; // off the right edge → show on the left
      // right: origin left → visible left edge = box.left = r.right + gap.
      // flip:  origin right → visible right edge = box.left + tipW = r.left - gap → box.left = r.left - gap - tipW.
      const left = flip ? Math.max(6, r.left - gap - tipW) : r.right + gap;
      const top = Math.max(6, Math.min(r.top, window.innerHeight - r.height - 6));
      setRefPos({ left, top, origin: flip ? 'right' : 'left' });
    }, 500);
  };
  const hideRefTip = (): void => {
    if (refTimer.current) { window.clearTimeout(refTimer.current); refTimer.current = null; }
    setRefPos(null);
  };
  useEffect(() => () => { if (refTimer.current) window.clearTimeout(refTimer.current); }, []);
  // While a card is being held/dragged, you're not "hovering" anything — drop any popup + don't open one.
  useEffect(() => { if (dragging) hideRefTip(); }, [dragging]);
  return (
    <div
      className={`card${highlight ? ' armed' : ''}${targeted ? ' targeted' : ''}${card.golden ? ' golden' : ''}${dimmed ? ' dragsrc' : ''}${buffed ? ' cardbuff' : ''}${battlecry ? ' bcasting' : ''}${arrived ? ' arrived' : ''}${card.keywords.includes('T') ? ' taunt' : ''}${card.keywords.includes('ST') ? ' stealth' : ''}${card.keywords.includes('DS') ? ' dscard' : ''}${card.keywords.includes('R') ? ' reborncard' : ''}${card.spell ? ' spellcard' : ''}${card.cardId === 'discoverspell' ? ' triplecard' : ''}${electrify ? ' electrify' : ''}${card.tribe2 ? ' dual' : ''}`}
      data-uid={uid}
      style={{ '--c': `var(--t-${card.tribe})`, '--c2': `var(--t-${card.tribe2 ?? card.tribe})` } as CSSProperties}
      onClick={onClick}
      onMouseEnter={hasRefs && !dragging ? (e) => showRefTip(e.currentTarget) : undefined}
      onMouseLeave={hasRefs ? hideRefTip : undefined}
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
            dangerouslySetInnerHTML={{ __html: descUp(mdBold(card.golden ? (card.goldenText ?? doubleNums(card.text)) : card.text)) }}
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
              {card.tribe2 ? (
                <>
                  {TRIBE_LABEL[card.tribe]} <span className="ctype-sep">/</span> <Icon name={TRIBE_ICON[card.tribe2]} />
                  {TRIBE_LABEL[card.tribe2]}
                </>
              ) : (
                TRIBE_LABEL[card.tribe]
              )}
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
      {/* Karwind — a Dragon just got Karwind's battlecry-triggered buff: flames sweep up the card
          (on top of the normal green buff flash), marking it as Karwind's doing. */}
      {karwind && (
        <span className="karwindflame" aria-hidden="true">
          <span className="kf-glow" />
          <span className="kf-tongue" style={{ '--kx': '14%', '--kd': '0.02s' } as CSSProperties} />
          <span className="kf-tongue" style={{ '--kx': '32%', '--kd': '0.05s' } as CSSProperties} />
          <span className="kf-tongue" style={{ '--kx': '50%', '--kd': '0s' } as CSSProperties} />
          <span className="kf-tongue" style={{ '--kx': '68%', '--kd': '0.04s' } as CSSProperties} />
          <span className="kf-tongue" style={{ '--kx': '86%', '--kd': '0.02s' } as CSSProperties} />
        </span>
      )}
      {/* Battlecry flourish — a glowing sigil swells from *under* the card (tribe-tinted),
          with motes rising up its face, when its Battlecry fires on play. */}
      {battlecry && (
        <span className="bcryfx" aria-hidden="true">
          <span className="bc-glow" />
          <span className="bc-mote" style={{ '--a': '-22deg' } as CSSProperties} />
          <span className="bc-mote" style={{ '--a': '0deg' } as CSSProperties} />
          <span className="bc-mote" style={{ '--a': '22deg' } as CSSProperties} />
        </span>
      )}
      {/* Reborn — spectral blue tears drift up across the card for a touch of life. */}
      {card.keywords.includes('R') && (
        <span className="reborntears" aria-hidden="true">
          {REBORN_TEARS.map((t, i) => (
            <span key={i} className="rt" style={{ left: t.x, top: t.y, animationDelay: t.d } as CSSProperties} />
          ))}
        </span>
      )}
      {/* Venomous — green venom globs constantly drip off the card (no rim glow). */}
      {card.keywords.includes('V') && (
        <span className="venomdrip" aria-hidden="true">
          {VENOM_DRIPS.map((t, i) => (
            <span key={i} className="vd" style={{ left: t.x, top: t.y, animationDelay: t.d } as CSSProperties} />
          ))}
        </span>
      )}
      {/* Referenced-card popup — portalled to <body> so it floats above neighbouring cards/spells. */}
      {refPos && hasRefs && createPortal(
        <div className="cardref" style={{ left: refPos.left, top: refPos.top } as CSSProperties}>
          <div className="cardref-inner" style={{ transformOrigin: `${refPos.origin} center` } as CSSProperties}>
            {refCards!.map((rc, i) => (
              <Card key={`${rc.cardId ?? i}`} card={rc} />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});

/** Drifting positions + staggered delays for the Reborn tear particles (several visible at once). */
const REBORN_TEARS = [
  { x: '18%', y: '34%', d: '0s' },
  { x: '68%', y: '24%', d: '0.9s' },
  { x: '42%', y: '54%', d: '1.8s' },
  { x: '82%', y: '46%', d: '2.6s' },
  { x: '30%', y: '20%', d: '3.4s' },
  { x: '58%', y: '60%', d: '4.0s' },
];

/** Venom glob source points (along the lower art) + staggered delays for a constant drip. */
const VENOM_DRIPS = [
  { x: '24%', y: '52%', d: '0s' },
  { x: '54%', y: '60%', d: '0.7s' },
  { x: '74%', y: '50%', d: '1.5s' },
  { x: '40%', y: '46%', d: '2.2s' },
];
