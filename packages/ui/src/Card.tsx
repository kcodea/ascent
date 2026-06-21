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
const KW_ICON: Record<Keyword, string> = {
  T: 'taunt', DS: 'shield', V: 'poison', W: 'windfury', R: 'reborn', C: 'cleave', M: 'magnetic', SC: 'sc',
  CN: 'consume', FD: 'fodder', IMM: 'shield', ST: 'eye', RL: 'sword',
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
  /** Combat-only floor: the stats the minion *entered the fight* with. A stat below its floor reads
   *  red (damaged / debuffed) even while still above the printed base; a stat above the printed base
   *  but at/above its floor stays green (a recruit-buffed 5/5 reads green until it's chipped below 5).
   *  Left undefined outside combat — the shop colours against the printed base alone. */
  floorAttack?: number;
  floorHealth?: number;
  /** Per-source recruit buffs (for the inspect-panel breakdown). */
  buffs?: { source: string; attack: number; health: number; count: number }[];
}

/**
 * Stat colour. Shop/recruit (no `floor`): green above the printed base, red below, neutral at base.
 * Combat (`floor` = the value the minion entered the fight with): red once it drops below that floor
 * (damaged HP / debuffed attack); green while buffed above the printed base and still at/above the
 * floor; neutral otherwise — so a recruit-buffed 5/5 reads green until it's chipped below 5, not the
 * instant combat starts.
 */
const statCls = (cur: number, base?: number, floor?: number): string => {
  if (floor !== undefined) return cur < floor ? ' down' : base !== undefined && cur > base ? ' up' : '';
  return base === undefined || cur === base ? '' : cur > base ? ' up' : ' down';
};

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
  suppressPop,
  tripleReady,
  forceFull,
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
  /** Suppress the one-shot mount pop (used when the warband re-mounts on return from combat). Read
   *  once at mount and frozen, so toggling it later can't re-trigger the animation. */
  suppressPop?: boolean;
  /** A tavern offer that would complete a triple if bought (you already hold 2 copies) — gets a
   *  gold glow + floating up-arrows to flag it. */
  tripleReady?: boolean;
  /** Render the full-text card regardless of the global compact setting — used by the hover reveal. */
  forceFull?: boolean;
}) {
  const inspectCard = useGame((s) => s.inspectCard);
  // The arched frame is universal now. `showText` = also render the drop-down text drawer (the "full"
  // card): on a force-full card (hover reveal / hand / right-click inspect) or when the player turns the
  // compact tiles off. At rest (compact tiles on, not force-full) it's a pure arched art tile.
  const showText = forceFull || !useGame((s) => s.compactCards);
  // Decide the mount-pop exactly once, at mount, so a later prop change never restarts the animation.
  const [popin] = useState(() => !suppressPop);
  // Pills row: the trigger (Battlecry / Deathrattle, derived from the text) then any
  // keyword pills. Always rendered (reserves a row) so the description starts on a
  // fixed line whether or not the card has pills.
  const trigger = triggerPill(card.text);
  const pills: { label: string; icon?: string }[] = [
    ...(trigger ? [trigger] : []),
    ...card.keywords.map((k) => ({ label: KW_LABEL[k], icon: KW_ICON[k] })),
  ];
  // The golden-aware rules text — doubled numbers (or explicit goldenText) when shown golden.
  const shownText = card.golden ? (card.goldenText ?? doubleNums(card.text)) : card.text;
  // The card's primary mechanic, shown as a glyph in the compact medallion: its trigger
  // (Battlecry / Deathrattle / …) if any, else its first keyword, else the tribe symbol.
  const mechIcon = trigger?.icon ?? (card.keywords[0] ? KW_ICON[card.keywords[0]] : TRIBE_ICON[card.tribe]);
  // Hover reveal (portalled to <body> so it floats over neighbours). In compact mode, hovering shows
  // the FULL card (art + name + rules text); any referenced cards (the token it summons / Fodder it
  // buffs / its Stray) trail off to the right of it. In full-text mode the card already shows its text,
  // so only the referenced cards appear. Rendered at full size with `forceFull` so it's readable.
  const popupCards: CardView[] = [...(showText ? [] : [card]), ...(refCards ?? [])];
  const hasPopup = popupCards.length > 0;
  const [refPos, setRefPos] = useState<{ left: number; top: number; origin: 'left' | 'right' } | null>(null);
  const refTimer = useRef<number | null>(null);
  // Open after a short hover (so it doesn't flash while skimming the board); position is measured when
  // it opens, so it tracks the card even if it popped up (hand) meanwhile. The full card is taller than
  // a compact tile, so the top is clamped to keep the popup on-screen.
  const showRefTip = (el: HTMLElement): void => {
    if (!hasPopup) return;
    if (refTimer.current) window.clearTimeout(refTimer.current);
    refTimer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      const n = popupCards.length;
      const gap = 10;
      const tipW = r.width * n + (n - 1) * gap; // full-size cards, laid left→right
      const flip = r.right + gap + tipW > window.innerWidth - 6; // off the right edge → show on the left
      const left = flip ? Math.max(6, r.left - gap - tipW) : r.right + gap;
      const estH = r.width * 1.34; // a full card is ~1.34× its width tall — clamp so it stays on-screen
      const top = Math.max(6, Math.min(r.top, window.innerHeight - estH - 6));
      setRefPos({ left, top, origin: flip ? 'right' : 'left' });
    }, showText ? 450 : 220);
  };
  const hideRefTip = (): void => {
    if (refTimer.current) { window.clearTimeout(refTimer.current); refTimer.current = null; }
    setRefPos(null);
  };
  useEffect(() => () => { if (refTimer.current) window.clearTimeout(refTimer.current); }, []);
  // While a card is being held/dragged, you're not "hovering" anything — drop any popup + don't open one.
  useEffect(() => { if (dragging) hideRefTip(); }, [dragging]);
  // Illustrated art (if any). `uid` lets multi-variant cards (Pup) pick a stable per-instance image.
  const artUrl = artFor(card.cardId, uid);
  return (
    <div
      className={`card compact${showText ? ' showtext' : ''}${popin ? ' popin' : ''}${highlight ? ' armed' : ''}${targeted ? ' targeted' : ''}${card.golden ? ' golden' : ''}${dimmed ? ' dragsrc' : ''}${buffed ? ' cardbuff' : ''}${battlecry ? ' bcasting' : ''}${arrived ? ' arrived' : ''}${card.keywords.includes('T') ? ' taunt' : ''}${card.keywords.includes('ST') ? ' stealth' : ''}${card.keywords.includes('DS') ? ' dscard' : ''}${card.keywords.includes('R') ? ' reborncard' : ''}${card.spell ? ' spellcard' : ''}${card.cardId === 'discoverspell' ? ' triplecard' : ''}${electrify ? ' electrify' : ''}${tripleReady ? ' tripready' : ''}${card.tribe2 ? ' dual' : ''}`}
      data-uid={uid}
      style={{ '--c': `var(--t-${card.tribe})`, '--c2': `var(--t-${card.tribe2 ?? card.tribe})` } as CSSProperties}
      onClick={onClick}
      onMouseEnter={hasPopup && !dragging ? (e) => showRefTip(e.currentTarget) : undefined}
      onMouseLeave={hasPopup ? hideRefTip : undefined}
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
      {/* cost badge — a teal Mana circle overhanging the corner. Minions are a flat 3, so their cost is
          hidden (only shown if something has changed it off 3); spells always show their cost. */}
      {card.cost !== undefined && (card.spell || card.cost !== 3) && (
        <span className="cost">
          <span className="costn">{card.cost}</span>
        </span>
      )}
      {card.keywords.includes('T') && (
        <span className="tauntward" aria-hidden="true"><Icon name="taunt" /></span>
      )}
      {/* Triple-ready: this tavern offer completes a triple if bought — gold arrows float up around it. */}
      {tripleReady && (
        <span className="triparrows" aria-hidden="true">
          <span className="ta" /><span className="ta" /><span className="ta" /><span className="ta" />
        </span>
      )}
      {/* The arched frame: the art, the corner attack/health badges, and the mechanic medallion. Fixed
          square so the badges/medallion always ride the arch even when the text drawer drops below. */}
      <div className="archbox">
        <div className="art">
          {artUrl ? (
            <img className="artimg" src={artUrl} alt="" draggable={false} />
          ) : (
            <Sprite name={spriteForTribe(card.tribe)} scale={5} />
          )}
        </div>
        {/* Golden (tripled) marker — a gold crown emblem; pairs with the gold arch frame so a tripled
            minion is instantly findable in a row. */}
        {card.golden && <span className="goldcrown" aria-hidden="true"><Icon name="crown" /></span>}
        {card.spell ? (
          <span className="ctype spell">✦ Spell</span>
        ) : (
          <>
            <span className={`atk${statCls(card.attack, card.baseAttack, card.floorAttack)}`}>{card.attack}</span>
            <span className={`hp${statCls(card.health, card.baseHealth, card.floorHealth)}`}>{card.health}</span>
            {/* mechanic medallion — the card's primary mechanic glyph, eclipsing the arch's base centre */}
            <span className="cgem" aria-hidden="true"><Icon name={mechIcon} /></span>
          </>
        )}
      </div>
      {/* Text drawer — drops down from the arched frame on the "full" card (hover reveal, hand, right-
          click inspect, or the always-on-text setting): name, keyword pills, rules text, tribe. Hidden
          (display:none) on a resting compact tile. */}
      <div className="drawer">
        <div className="cn">{card.name}</div>
        {pills.length > 0 && (
          <div className="kws">
            {pills.map((p, i) => (
              <span className="kw" key={`${p.label}-${i}`}>
                {p.icon && <Icon name={p.icon} />}
                {p.label}
              </span>
            ))}
          </div>
        )}
        {card.text && (
          <div className="desc">
            <span dangerouslySetInnerHTML={{ __html: descUp(mdBold(shownText)) }} />
          </div>
        )}
        {!card.spell && (
          <div className="dtribe">
            <Icon name={TRIBE_ICON[card.tribe]} /> {TRIBE_LABEL[card.tribe]}
            {card.tribe2 && (
              <> <span className="ctype-sep">/</span> <Icon name={TRIBE_ICON[card.tribe2]} /> {TRIBE_LABEL[card.tribe2]}</>
            )}
          </div>
        )}
      </div>
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
      {/* Hover reveal — portalled to <body> so it floats above neighbouring cards. The full card first
          (in compact mode), then any referenced cards trailing to its right. All forced full-size. */}
      {refPos && hasPopup && createPortal(
        <div className="cardref" style={{ left: refPos.left, top: refPos.top } as CSSProperties}>
          <div className="cardref-inner" style={{ transformOrigin: `${refPos.origin} center` } as CSSProperties}>
            {popupCards.map((rc, i) => (
              <Card key={`${rc.cardId ?? i}-${i}`} card={rc} forceFull />
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
