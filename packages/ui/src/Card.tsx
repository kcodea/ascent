import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Keyword, Tribe } from '@game/core';
import type { StepProgress } from './cardText';
import { artFor } from './art';
import { renameTerms } from './terms';
import { Icon } from './Icon';
import { Sprite } from './Sprite';
import { spriteForTribe } from './sprites';
import { useGame } from './store';

// TAUNT frame — pipeline layer 2 (the authored shield). Prefer an authored raster PNG (painterly, drops into
// `apps/web/public/frames/`); until it exists the SVG placeholder renders instead. `tauntFrameAvailable` flips
// false after the first 404 this session so we don't re-request a missing asset on every Taunt card.
// NB: BASE_URL-relative, NOT root-absolute — itch serves the game from a CDN sub-path, where '/frames/…' 404s
// and the graceful fallback silently rendered the OLD pre-frame look (owner's mobile itch test). Vite rewrites
// CSS url(/…) to relative at build, but it can't rewrite JS string literals — these must carry the base
// themselves (BASE_URL is '/' in dev, './' in the build).
const TAUNT_FRAME_SRC = `${import.meta.env.BASE_URL}frames/taunt-shield.png`;
let tauntFrameAvailable = true;
// STANDARD frame (every non-Taunt MINION) — the authored gold OVAL, and SPELL frame — the authored purple SQUARE.
// Same pipeline as Taunt (portrait clipped to the frame's window → PNG over it → per-tribe tint → DOM data). Each
// class is applied ONLY when its PNG loads; on a 404 the availability flag flips false (so we stop re-requesting)
// and the card falls back to the original arched / spell look. See styles.css "AUTHORED FRAMES" for the geometry.
const STD_FRAME_SRC = `${import.meta.env.BASE_URL}frames/standard-oval.png`;
let stdFrameAvailable = true;
const SPELL_FRAME_SRC = `${import.meta.env.BASE_URL}frames/spell-frame.png`;
let spellFrameAvailable = true;

const KW_LABEL: Record<Keyword, string> = {
  T: 'Taunt', DS: 'Ward', V: 'Toxin', W: 'Flurry', R: 'Rise', C: 'Cleave', M: 'Attachment', SC: 'Start', CN: 'Consume',
  FD: 'Fodder', IMM: 'Immune', ST: 'Stealth', RL: 'Rally', SL: 'Slaughter', CR: 'Critical Strike', EG: 'Engraved',
};
const KW_ICON: Record<Keyword, string> = {
  T: 'taunt', DS: 'shield', V: 'poison', W: 'windfury', R: 'rise', C: 'cleave', M: 'magnetic', SC: 'fist',
  CN: 'consume', FD: 'fodder', IMM: 'immune', ST: 'eye', RL: 'sword', SL: 'slaughter', CR: 'target', EG: 'anvil',
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
  /** "X/N toward next step" pill for step-based scalers (Guel, Monk, Spirit Pup, …). Absent = no counter. */
  stepProgress?: StepProgress;
  cost?: number;
  /** The cost was changed off the flat minion price (Moe's discounted Attachment) — renders the coin green. */
  costChanged?: boolean;
  /** Spell cast multiplier (Nimbus's doubling / Yazzus) — shows a "×N" badge top-right when > 1. */
  castMult?: number;
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
  /** Transient per-stat flash (a buff just landed on this unit this frame). Set by the combat replay. */
  flashAtk?: boolean;
  flashHp?: boolean;
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
    ? { label: 'Shout', icon: 'battlecry' }
    : /^\W*deathrattle/i.test(text)
      ? { label: 'Echo', icon: 'echo' }
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
  buffFloat,
  battlecry,
  arrived,
  electrify,
  karwind,
  pulse,
  pulseRally,
  glow,
  popDelay,
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
  slideDir,
  handSlidePx,
  fanRot,
  locked,
  lockLabel,
  comboReady,
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
  /** A recruit-phase stat buff just landed — float its `+atk/+hp` above the card (like combat). `key`
   *  changes per buff so the float remounts and re-runs its rise animation. */
  buffFloat?: { attack: number; health: number; key: number } | null;
  /** One-shot flourish beneath a just-played minion whose Battlecry fired. */
  battlecry?: boolean;
  /** One-shot pop-in when a card is added to the hand mid-flow (combat Deathrattle grant). */
  arrived?: boolean;
  /** Electric flash — a Mech being magnetized onto by Combinator's End-of-Turn. */
  electrify?: boolean;
  /** Battlecry-trigger proc flash: `'flame'` = a Dragon just buffed by Karwind (orange); `'haze'` = Bane
   *  just enchanted Fodder (purple). On top of the normal buff flash. */
  karwind?: 'flame' | 'haze' | false;
  /** Pulse the trigger medallion — a brief glow + a slow ring of energy when this unit's effect
   *  *officially* fires (a Deathrattle, a Battlecry, a cadence card paying off, …). */
  pulse?: boolean;
  /** Pulse the trigger medallion YELLOW — a Rally fired as this unit attacks. Same ring as `pulse`, forced
   *  yellow; takes precedence over `pulse`. A per-fire NONCE (truthy = pulsing): it's used as the medallion's
   *  `key` so the element remounts each Rally and the CSS pulse restarts, even when `.pulsing` is already on
   *  from the unit's own trigger glow (a plain class re-add wouldn't replay the animation). */
  pulseRally?: number;
  /** Glow the trigger medallion only (no ring) — a multi-turn mechanic made *progress* this turn but
   *  hasn't officially fired yet (e.g. Frontdrake ticking toward its every-3-turns grant). */
  glow?: boolean;
  /** Hold this card's mount pop for ~0.2s before it appears — a battlecry-summoned token waits a beat
   *  after the trigger pulse fires, so you see the pulse THEN the token (e.g. Alleycat → Stray). */
  popDelay?: boolean;
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
  /** Pre-emptive reorder slide: -1 shifts the card half a slot LEFT, +1 half a slot RIGHT, 0/undefined none.
   *  A CSS `transition: transform` (active while dragging) glides it as the drop gap moves — the neighbour
   *  "make room" animation. Half-slot each side keeps the row centred and matches the final drop position. */
  slideDir?: number;
  /** Hand reorder slide, in PIXELS (the hand's cards overlap, so the slot width is measured, not derived).
   *  Composes with the hand's translateY tuck so the fan keeps its tuck while parting to make room. */
  handSlidePx?: number;
  /** Hand-fan tilt in DEGREES for this card's position (negative = left of centre, positive = right). Fed to
   *  the `--fan-rot` CSS var; the `.row.hand .card` rule rotates the card by it (flattened while dragging). */
  fanRot?: number;
  /** Disco Dan's Setlist: this hand card is locked (unplayable) until you reach its shop tier — greyed with
   *  a lock badge; the parent also refuses to start a play-drag on it. */
  locked?: boolean;
  /** Short lock caption for the badge (e.g. "Tier 4"). */
  lockLabel?: string;
  /** Combo is armed (a Primer was just played) AND this hand card has a Combo — glow it orange to flag that
   *  playing it NOW triggers the combo. */
  comboReady?: boolean;
}) {
  const inspectCard = useGame((s) => s.inspectCard);
  // The arched frame is universal now. `showText` = also render the drop-down text drawer (the "full"
  // card): on a force-full card (hover reveal / hand / right-click inspect) or when the player turns the
  // compact tiles off. At rest (compact tiles on, not force-full) it's a pure arched art tile.
  const showText = forceFull || !useGame((s) => s.compactCards);
  // Decide the mount-pop exactly once, at mount, so a later prop change never restarts the animation.
  const [popin, setPopin] = useState(() => !suppressPop);
  // Drop the `popin` class once the mount-pop has played. It must not linger: `.card.popin` carries the
  // `cardpop` animation, and when a board REORDER physically moves a card's DOM node the browser RE-TRIGGERS
  // that animation — so an untouched neighbour "popped" as if it were just played (most obvious on a Battlecry
  // card like Alleycat). 500ms covers the pop (0.15s) plus the summon-delay variant (0.2s delay) with margin.
  useEffect(() => {
    if (!popin) return;
    const t = window.setTimeout(() => setPopin(false), 500);
    return () => window.clearTimeout(t);
  }, [popin]);
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
      // The popup is `zoom`ed by --inspect-zoom (1.3 on mobile) for readability, so its rendered footprint is that
      // much bigger than a natural card — fold the same factor into the width/height estimates so it stays on-screen.
      const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inspect-zoom')) || 1;
      const cardW = r.width * zoom;
      const tipW = cardW * n + (n - 1) * gap; // full-size cards, laid left→right
      const flip = r.right + gap + tipW > window.innerWidth - 6; // off the right edge → show on the left
      const left = flip ? Math.max(6, r.left - gap - tipW) : r.right + gap;
      const estH = cardW * 1.34; // a full card is ~1.34× its width tall — clamp so it stays on-screen
      const top = Math.max(6, Math.min(r.top, window.innerHeight - estH - 6));
      setRefPos({ left, top, origin: flip ? 'right' : 'left' });
    }, showText ? 250 : 100);
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
  // TAUNT frame: render the raster shield if the asset loads; on 404 fall back to the SVG placeholder.
  const [frameOk, setFrameOk] = useState(tauntFrameAvailable);
  // STANDARD / SPELL frames: same load-or-fallback guard. A card wears exactly one authored frame — Taunt wins
  // for a Taunt minion; regular spells (but NOT the golden Triple-Reward token) get the purple square; every other
  // minion gets the oval. On 404 the flag flips and the card renders its original arch/spell look.
  const [sframeOk, setSframeOk] = useState(stdFrameAvailable);
  const [pframeOk, setPframeOk] = useState(spellFrameAvailable);
  const isTaunt = card.keywords.includes('T');
  const useSpellFrame = !!card.spell && card.cardId !== 'discoverspell' && pframeOk;
  const useStdFrame = !card.spell && !isTaunt && sframeOk;
  return (
    <div
      className={`card compact${showText ? ' showtext' : ''}${popin ? ' popin' : ''}${popDelay ? ' popdelay' : ''}${highlight ? ' armed' : ''}${targeted ? ' targeted' : ''}${card.golden ? ' golden' : ''}${dimmed ? ' dragsrc' : ''}${buffed ? ' cardbuff' : ''}${battlecry ? ' bcasting' : ''}${arrived ? ' arrived' : ''}${card.keywords.includes('T') ? ' taunt' : ''}${card.keywords.includes('ST') ? ' stealth' : ''}${card.keywords.includes('DS') ? ' dscard' : ''}${card.keywords.includes('R') ? ' reborncard' : ''}${card.keywords.includes('V') ? ' venomcard' : ''}${card.spell ? ' spellcard' : ''}${card.cardId === 'discoverspell' ? ' triplecard' : ''}${useStdFrame ? ' stdframe' : ''}${useSpellFrame ? ' spellframe' : ''}${electrify ? ' electrify' : ''}${tripleReady ? ' tripready' : ''}${card.tribe2 ? ' dual' : ''}${locked ? ' locked' : ''}${comboReady ? ' comboready' : ''}`}
      data-uid={uid}
      style={{ '--c': `var(--t-${card.tribe})`, '--c2': `var(--t-${card.tribe2 ?? card.tribe})`,
        '--fan-rot': `${fanRot ?? 0}deg`,
        transform: handSlidePx
          ? `translateX(${handSlidePx}px) translateY(var(--hand-tuck, 0px)) rotate(var(--fan-rot, 0deg))` /* hand reorder: keep the tuck + fan tilt while parting */
          : slideDir ? `translateX(calc((var(--ccw) + 22px) * ${slideDir}))` : undefined } as CSSProperties}
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
      {/* Recruit-phase buff: float the +atk/+hp above the card, exactly like a combat buff (`.float.buff`).
          Keyed so a fresh buff remounts it and replays the rise. */}
      {buffFloat && (
        <span key={buffFloat.key} className="float buff cardfloat">+{buffFloat.attack}/+{buffFloat.health}</span>
      )}
      {/* Step-progress counter — "X/N to next step" below step-based scalers (Guel 1/4, Monk 2/5, …). Keyed on
          `current` so each tick replays the compositor-only bump. Board minions only (populated by the caller). */}
      {card.stepProgress && (
        <span
          key={card.stepProgress.current}
          className="stepcounter"
          aria-label={`Step progress ${card.stepProgress.current} of ${card.stepProgress.total}`}
        >
          {card.stepProgress.current}/{card.stepProgress.total}
        </span>
      )}
      {card.tier !== undefined && <span className="tierbadge" data-tier={card.tier}>Tier {card.tier}</span>}
      {/* Disco Dan's Setlist lock — a padlock ribbon across a greyed card, captioned with the tier it unlocks at. */}
      {locked && (
        <span className="cardlock" aria-label={`Locked${lockLabel ? ` until ${lockLabel}` : ''}`}>
          <span className="cardlock-ico" aria-hidden="true">🔒</span>{lockLabel ? <b>{lockLabel}</b> : null}
        </span>
      )}
      {/* cost badge — a gold coin overhanging the corner (the cost in Gold). Minions are a flat 3, so their
          cost is hidden (only shown if something has changed it off 3); spells always show their cost. */}
      {card.cost !== undefined && (card.spell || card.cost !== 3) && (
        <span className={`cost${card.costChanged ? ' discount' : ''}`}>
          <span className="costn">{card.cost}</span>
        </span>
      )}
      {/* Spell cast multiplier (Nimbus doubling / Yazzus) — a "×N" badge top-right telling you how many
          times this spell will cast right now. */}
      {card.castMult !== undefined && card.castMult > 1 && (
        <span className="castmult" aria-hidden="true">×{card.castMult}</span>
      )}
      {/* Divine Shield signifies via the CSS `.ward` dome stack inside `.art` (below); Reborn via its Pixi AURA
          (driven from `.card.reborncard` in Recruit); Taunt via the static grey `.card.taunt` border — no badge here. */}
      {card.keywords.includes('V') && (
        <span className="kwward venom" aria-hidden="true"><Icon name="poison" /></span>
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
            /* decoding="sync": paint the art WITH the frame in the same frame. `async` let the browser
               commit the card before the (already-preloaded, cached) image finished decoding — the residual
               per-mount pop-in the boot preloader couldn't fix. Decode cost is small (≤512px webp). */
            <img className="artimg" src={artUrl} alt="" draggable={false} decoding="sync" />
          ) : (
            <Sprite name={spriteForTribe(card.tribe)} scale={5} />
          )}
          {/* Ward (Divine Shield): the layered glassy gold dome — a CSS stack glued to the card (styles.css
              `.card.compact.dscard .ward-*`). Living inside `.art` means it rides drag + the combat lunge for
              free and vanishes exactly when the sim clears the `DS` keyword. Clipped to the arched art. */}
          {card.keywords.includes('DS') && (
            <div className="ward" aria-hidden="true">
              <div className="ward-body" />
              <div className="ward-hex" />
              <div className="ward-shadow" />
              <div className="ward-spot" />
              <div className="ward-gloss" />
            </div>
          )}
          {/* Reborn — a faint ethereal aqua-green dome + rising randomized wisps (CSS, replacing the old Pixi
              wisp), clipped to the oval window. Each wisp carries its own random position/size/rise/drift. */}
          {card.keywords.includes('R') && (
            <div className="reborn" aria-hidden="true">
              <div className="reborn-dome" />
              <div className="reborn-wisps">
                {REBORN_WISPS.map((w, i) => (
                  <div
                    key={i}
                    className="wisp"
                    style={{ left: w.left, bottom: w.bottom, animationDelay: w.delay, '--wisp-size': w.size, '--wisp-rise': w.rise, '--wx': w.wx } as CSSProperties}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        {/* TAUNT frame layer (pipeline prototype) — an authored shield laid OVER the portrait, tracing the exact
            `--heater` silhouette so it aligns with the art's clip. Prefers the raster PNG (painterly); falls back
            to the SVG placeholder until that asset exists. The real frame drops into this same layer unchanged. */}
        {card.keywords.includes('T') && frameOk && (
          <>
            {/* grounding shadow (see styles.css "GROUNDING SHADOW"): a black, blurred copy of the frame seated
                behind the art, so the shield reads as sitting on the board rather than floating. */}
            <img className="tframe tframe-img cshadow" src={TAUNT_FRAME_SRC} alt="" aria-hidden="true" />
            <img
              className="tframe tframe-img"
              src={TAUNT_FRAME_SRC}
              alt=""
              aria-hidden="true"
              onError={() => {
                tauntFrameAvailable = false;
                setFrameOk(false);
              }}
            />
          </>
        )}
        {card.keywords.includes('T') && !frameOk && (
          <svg className="tframe" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="tf-gold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f9e19a" />
                <stop offset="0.5" stopColor="#c89a3c" />
                <stop offset="1" stopColor="#7d5a1e" />
              </linearGradient>
              <linearGradient id="tf-gem" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ff7b7b" />
                <stop offset="1" stopColor="#93101a" />
              </linearGradient>
            </defs>
            {/* gold frame ring — a thick stroke on the heater outline (half over the portrait edge, half proud) */}
            <path className="tf-ring" fill="none" stroke="url(#tf-gold)" strokeWidth="11" strokeLinejoin="round"
              d="M8 0 L92 0 L97 5 L100 15 L100 40 L96 60 L86 78 L66 92 L50 100 L34 92 L14 78 L4 60 L0 40 L0 15 L3 5 Z" />
            {/* tribe-tinted inner band (thin stroke inside the gold — the tint layer, driven by var(--c)) */}
            <path className="tf-band" fill="none" strokeWidth="4" strokeLinejoin="round"
              d="M8 0 L92 0 L97 5 L100 15 L100 40 L96 60 L86 78 L66 92 L50 100 L34 92 L14 78 L4 60 L0 40 L0 15 L3 5 Z" />
            {/* top + bottom gems (static setting) */}
            <path className="tf-gem" fill="url(#tf-gem)" stroke="#7d5a1e" strokeWidth="1.4" d="M50 -6 L61 5 L50 16 L39 5 Z" />
            <path className="tf-gem" fill="url(#tf-gem)" stroke="#7d5a1e" strokeWidth="1.4" d="M50 94 L57 101 L50 109 L43 101 Z" />
          </svg>
        )}
        {/* STANDARD OVAL frame (every non-Taunt minion) — the authored gold oval laid OVER the portrait, which is
            clipped to the frame's elliptical window. Neutral gold on every tribe. See styles.css "AUTHORED FRAMES". */}
        {useStdFrame && (
          <>
            {/* grounding shadow (see styles.css "GROUNDING SHADOW") — a black, blurred copy of the oval seated
                behind the art so the card sits on the board. */}
            <img className="cframe cframe-img cshadow" src={STD_FRAME_SRC} alt="" aria-hidden="true" />
            <img
              className="cframe cframe-img"
              src={STD_FRAME_SRC}
              alt=""
              aria-hidden="true"
              onError={() => {
                stdFrameAvailable = false;
                setSframeOk(false);
              }}
            />
          </>
        )}
        {/* SPELL SQUARE frame (regular spells) — the authored purple square. No tint layer: spells have no tribe,
            and the frame carries its own purple accent. */}
        {useSpellFrame && (
          <>
            {/* grounding shadow (see styles.css "GROUNDING SHADOW") — a black, blurred copy of the square seated
                behind the art so the spell sits on the board. */}
            <img className="cframe cframe-img cshadow" src={SPELL_FRAME_SRC} alt="" aria-hidden="true" />
            <img
              className="cframe cframe-img"
              src={SPELL_FRAME_SRC}
              alt=""
              aria-hidden="true"
              onError={() => {
                spellFrameAvailable = false;
                setPframeOk(false);
              }}
            />
          </>
        )}
        {/* Golden (tripled) marker — a gold crown emblem; pairs with the gold arch frame so a tripled
            minion is instantly findable in a row. */}
        {card.golden && <span className="goldcrown" aria-hidden="true"><Icon name="crown" /></span>}
        {card.spell ? (
          <span className="ctype spell">✦ Spell</span>
        ) : (
          <>
            <span className={`atk${statCls(card.attack, card.baseAttack, card.floorAttack)}${card.flashAtk ? ' statflash' : ''}`}>{card.attack}</span>
            <span className={`hp${statCls(card.health, card.baseHealth, card.floorHealth)}${card.flashHp ? ' statflash' : ''}`}>{card.health}</span>
            {/* mechanic medallion — the card's primary mechanic glyph, eclipsing the arch's base centre */}
            <span key={`cgem-${pulseRally ?? 0}`} className={`cgem${pulseRally ? ' pulsing rally' : pulse ? ' pulsing' : glow ? ' glowing' : ''}`} aria-hidden="true"><Icon name={mechIcon} /></span>
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
            <span dangerouslySetInnerHTML={{ __html: descUp(mdBold(renameTerms(shownText))) }} />
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
      {karwind === 'flame' && (
        <span className="karwindflame" aria-hidden="true">
          <span className="kf-glow" />
          <span className="kf-tongue" style={{ '--kx': '14%', '--kd': '0.02s' } as CSSProperties} />
          <span className="kf-tongue" style={{ '--kx': '32%', '--kd': '0.05s' } as CSSProperties} />
          <span className="kf-tongue" style={{ '--kx': '50%', '--kd': '0s' } as CSSProperties} />
          <span className="kf-tongue" style={{ '--kx': '68%', '--kd': '0.04s' } as CSSProperties} />
          <span className="kf-tongue" style={{ '--kx': '86%', '--kd': '0.02s' } as CSSProperties} />
        </span>
      )}
      {/* Bane — a battlecry just enchanted the Fodder card type run-wide: a soft purple haze swells from
          under the card (Bane itself + any Fodder on the board it buffed), matching the other Fodder FX. */}
      {karwind === 'haze' && (
        <span className="fodderhaze" aria-hidden="true"><span className="fh-glow" /></span>
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

/** Reborn wisps — a fixed randomized set (generated once at module load) of rising ethereal spirit wisps. Each
 *  carries its own position / size / rise / sideways-drift so they read as an organic cloud, not a line. Count +
 *  ranges mirror the tuner (fx/reborn-css-preview.html): count 27, spread 38%, size 27%±35%, rise 320%±, wx ±22px.
 *  Math.random is presentation-only jitter (the ban is scoped to core/content/sim). */
const REBORN_WISPS = Array.from({ length: 27 }, () => ({
  left: (50 + (Math.random() - 0.5) * 38).toFixed(1) + '%',
  bottom: (Math.random() * 16).toFixed(1) + '%',
  delay: (-Math.random() * 10.3).toFixed(2) + 's',
  size: (27 * (0.65 + Math.random() * 0.7)).toFixed(1) + '%',
  rise: (320 * (0.8 + Math.random() * 0.45)).toFixed(0) + '%',
  wx: ((Math.random() - 0.5) * 44).toFixed(0) + 'px',
}));

/** Venom glob source points (along the lower art) + staggered delays for a constant drip. */
const VENOM_DRIPS = [
  { x: '24%', y: '52%', d: '0s' },
  { x: '54%', y: '60%', d: '0.7s' },
  { x: '74%', y: '50%', d: '1.5s' },
  { x: '40%', y: '46%', d: '2.2s' },
];
