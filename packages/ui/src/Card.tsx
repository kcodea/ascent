import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { FLURRY_RINGS, flurryBoxStyle, flurryWrapStyle, flurryRingStyle } from './flurryConfig';
import { pixiFx } from './pixiFx';
import { getStepProcFxConfig, isStepProcTick } from './stepProcFxConfig';
import { getExecuteSnapshot, subscribeExecute } from './executeConfig';
import { getCardPlateConfig, plateTextBucket } from './cardPlateConfig';

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
// New silver-oval art (owner-supplied, session 42). Swapped by filename so reverting is a one-line change back
// to `standard-oval.png` (the original PNG stays on disk, untouched). Same 1059×1427 dims + window as the
// original, so the "AUTHORED FRAMES" geometry drops in unchanged; rendered SILVER via `--frame-tone:
// grayscale(...)` on `.stdframe` (Gilded minions still show it gold).
const STD_FRAME_SRC = `${import.meta.env.BASE_URL}frames/standard-oval-v2.png`;
let stdFrameAvailable = true;
// New spell frame art (owner-supplied, session 42). Filename-swapped for one-line revert (original untouched).
// Same 1122×1346 dims + window as the original → geometry unchanged. NOTE: spells carry NO `--frame-tone`
// (it's a no-op `brightness(1)`), so this renders as-authored — the new art is GOLD w/ purple gems. Add the
// grayscale tone to `.spellframe` if a silver spell frame is wanted (to match the minion oval).
const SPELL_FRAME_SRC = `${import.meta.env.BASE_URL}frames/spell-frame-v2.png`;
let spellFrameAvailable = true;
// HAND CARD BACKPLATE — the ornate stone/gold card body behind a card in hand (and on the dragged copy).
// Same load pattern as the frames above: BASE_URL-relative (root-absolute 404s on itch's CDN sub-path) with a
// module-level availability flag flipped on the first 404, so a missing asset degrades to today's look.
const CARD_PLATE_SRC = `${import.meta.env.BASE_URL}frames/cardplate.webp`;
let cardPlateAvailable = true;

// (KW_LABEL — the keyword→display-name map — was removed with the pill row it fed, owner 2026-07-21.
//  KW_ICON survives: it still drives the medallion glyph. Player-facing keyword NAMES are not this file's
//  job — `terms.ts` owns the renames, with per-surface copies in MinionBook / questText / float / the
//  combat log. #625's Toxin→Execute rename touched all of those; this map was a ninth copy with no reader.)
const KW_ICON: Record<Keyword, string> = {
  T: 'taunt', DS: 'shield', V: 'execute', W: 'windfury', R: 'rise', C: 'cleave', M: 'magnetic', SC: 'fist',
  CN: 'consume', FD: 'fodder', IMM: 'immune', ST: 'eye', RL: 'sword', SL: 'slaughter', CR: 'target', EG: 'anvil',
};
const TRIBE_LABEL: Record<Tribe, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', neutral: 'Neutral', kobold: 'Kobold',
};
/** Each tribe's own footer glyph (handoff: the symbol matches the type — paw = Beast, etc.). */
const TRIBE_ICON: Record<Tribe, string> = {
  beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star', kobold: 'crown',
};

/** Render rules text to HTML: fold the player-facing keyword rename (Battlecry→Shout, …) in FIRST, then bold
 *  `**…**`. Every rich rules-text surface (card body, rune text, Choose One options) goes through this, so the
 *  vocabulary is consistent everywhere — not just on card bodies (`renameTerms` is idempotent, so a caller that
 *  already renamed is harmless). */
export const mdBold = (s: string): string => renameTerms(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
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
  /** "All" types — Lab Experiment (printed `universalTribe`) or an Anomaly-Reactor'd instance (`allTribes`).
   *  The footer prints ALL instead of the primary tribe, since every tribal effect counts it. */
  universalTribe?: boolean;
  attack: number;
  health: number;
  keywords: Keyword[];
  text: string;
  /** Explicit golden text (overrides the numeric doubler when shown golden). */
  goldenText?: string;
  /** "X/N toward next step" pill for step-based scalers (Guel, Monk, Spirit Pup, …). Absent = no counter. */
  stepProgress?: StepProgress;
  /** Combat only: fade the counter in on each tick, hold ~3s, then fade out (`.ephemeral`). Shop/recruit
   *  leaves it undefined so the counter stays persistently visible for planning. */
  stepEphemeral?: boolean;
  cost?: number;
  /** The cost was changed off the flat minion price (Moe's discounted Attachment) — renders the coin green. */
  costChanged?: boolean;
  /** Spell cast multiplier (Nimbus's doubling / Yazzus) — shows a "×N" badge top-right when > 1. */
  castMult?: number;
  golden?: boolean;
  tier?: number;
  /** A non-minion spell card (e.g. the triple Discover) — hides the stat footer. */
  spell?: boolean;
  /** A **Ruby** (set 2): a spell-LIKE token — plays from hand by dragging onto a minion (same targeted-aim as
   *  a spell) to buff it, but it is NOT a Shop Spell. Renders with a stat footer (it carries Attack/Health). */
  ruby?: boolean;
  /** Requires a target when cast (drives the cast-by-drag targeting) — `'friendly'` = a board minion only,
   *  `'any'` = a board OR shop minion. Mirrors `CardDef.target`. */
  target?: 'friendly' | 'any';
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
  plated,
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
  /** Render the ornate card BACKPLATE behind this card — the full card body used in hand and on the card
   *  dragged out of hand. Board / shop / combat cards are never plated. */
  plated?: boolean;
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
  // STEP PROC FX (owner ask 2026-07-21) — this unit's step counter just FILLED, so its effect fired: burst the
  // spell-power flourish (arrows + mote blast) FROM the counter pill itself. One hook covers every step-based
  // card, because `cardText.stepProgress()` gives them all the same counter — Avenge, Guel, Flowing Monk, Crypt
  // Drake, Bloodbinder, the gold/buy meters, cadence cards, Spirit Pup's transform, Tara's ascend — and the
  // counter renders in BOTH phases, so this fires in the shop and in combat off the one signal.
  //
  // WHEN: the counters are cyclic (1/4 → 4/4 → 1/4) or count up to a threshold, and the effect fires as the
  // counter REACHES `total`. Two ways to see that, because a tally can advance by MORE THAN ONE in a single
  // beat and skip the full reading entirely:
  //   1. it LANDS on `total` (3/4 → 4/4) — the ordinary tick, and
  //   2. it WRAPPED (current < prev) without having been full last time — e.g. AVENGE, whose tally ticks per
  //      FRIENDLY DEATH: an AoE / cleave / death cascade kills two at once, so a 4-threshold goes 3/4 → 1/4 and
  //      never shows 4/4, yet the Avenge really did fire (owner report 2026-07-21). Guel-style spell counters
  //      tick one at a time so they rarely skip; Avenge skips constantly.
  // The `prev !== total` guard on (2) is what stops a double-fire: the ordinary 4/4 → 1/4 reset AFTER a proc is
  // a wrap too, but that proc already fired on the landing. Count-up counters (Spirit Pup, Tara) clamp at
  // `total` and never wrap, and the cadence counter counts DOWN and resets UP to `total` on its firing turn —
  // both land on `total`, so rule (1) covers them.
  //
  // Transition-only (never on mount) so a card entering play already full doesn't burst.
  //
  // Its own config (`stepProcFxConfig`), NOT the spell-power one — same primitive, independently tunable.
  const stepCounterRef = useRef<HTMLSpanElement>(null);
  const prevStepRef = useRef<number | null>(null);
  const stepCur = card.stepProgress?.current;
  const stepTotal = card.stepProgress?.total;
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = stepCur ?? null;
    if (stepCur === undefined || stepTotal === undefined) return;
    if (!isStepProcTick(prev, stepCur, stepTotal)) return;      // see the rule (+ its tests) in stepProcFxConfig
    const el = stepCounterRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;             // not laid out (hidden/unmounted) — nothing to fire from
    pixiFx.spellPower(r.left + r.width / 2, r.top + r.height / 2, getStepProcFxConfig());
  }, [stepCur, stepTotal]);
  // The card's trigger (Battlecry / Deathrattle, derived from the text). The keyword PILL ROW that used to
  // sit under the name was removed (owner 2026-07-21) — keywords already read from the art-layer cues (Ward
  // dome, Toxin drip, Flurry rings, the Taunt frame) and from the bolded rules text, so the row was a third
  // restatement costing a line of panel height. `trigger` survives because the medallion glyph derives from it.
  const trigger = triggerPill(card.text);
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
      // Popup cards are PLATED, so the plate — not the tile — is the real footprint: `plate.scale` times the
      // card width, and `× 1.5550` tall (the art's locked aspect). Estimating off the bare tile put wide
      // popups off the right edge and let tall ones run off the bottom.
      const plateScale = getCardPlateConfig().scale;
      const cardW = r.width * zoom * plateScale;
      const tipW = cardW * n + (n - 1) * gap; // full-size cards, laid left→right
      const flip = r.right + gap + tipW > window.innerWidth - 6; // off the right edge → show on the left
      const left = flip ? Math.max(6, r.left - gap - tipW) : r.right + gap;
      const estH = cardW * 1.5550; // plate aspect (800×1244) — clamp so it stays on-screen
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
  const [plateOk, setPlateOk] = useState(cardPlateAvailable);
  const usePlate = !!plated && plateOk;
  // Size the rules text from the LIVE text string (values already folded in), never by measuring the DOM.
  const txtBucket = plateTextBucket(shownText);
  const isTaunt = card.keywords.includes('T');
  // A Ruby (set 2) is a spell-LIKE card: it wears the SPELL treatment (purple square frame, spell pill, no
  // stat footer / tribe line) even though it's its own class mechanically. `spellLike` gates the visual only.
  const spellLike = !!card.spell || !!card.ruby;
  const useSpellFrame = spellLike && card.cardId !== 'discoverspell' && pframeOk;
  const useStdFrame = !spellLike && !isTaunt && sframeOk;
  return (
    <div
      className={`card compact${showText ? ' showtext' : ''}${popin ? ' popin' : ''}${popDelay ? ' popdelay' : ''}${highlight ? ' armed' : ''}${targeted ? ' targeted' : ''}${card.golden ? ' golden' : ''}${dimmed ? ' dragsrc' : ''}${buffed ? ' cardbuff' : ''}${battlecry ? ' bcasting' : ''}${card.keywords.includes('T') ? ' taunt' : ''}${card.keywords.includes('ST') ? ' stealth' : ''}${card.keywords.includes('DS') ? ' dscard' : ''}${card.keywords.includes('R') ? ' reborncard' : ''}${card.keywords.includes('V') ? ' venomcard' : ''}${card.keywords.includes('W') ? ' flurrycard' : ''}${spellLike ? ' spellcard' : ''}${card.ruby ? ' rubycard' : ''}${card.cardId === 'discoverspell' ? ' triplecard' : ''}${useStdFrame ? ' stdframe' : ''}${useSpellFrame ? ' spellframe' : ''}${electrify ? ' electrify' : ''}${tripleReady ? ' tripready' : ''}${card.tribe2 ? ' dual' : ''}${locked ? ' locked' : ''}${usePlate ? ` plated plate-txt-${txtBucket}` : ''}`}
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
      {/* Backplate — the ornate card body behind everything, on hand + dragged-from-hand cards only. FIRST
          child so tree order paints it behind every sibling; `.card.plated` isolates so its z-index can't
          escape into neighbouring cards. `<img>` rather than a CSS background so a 404 is detectable. */}
      {usePlate && (
        <>
          {/* Hover glow, plate edition — a COPY of the plate art seated behind the real one, carrying a
              static drop-shadow halo. Only its OPACITY animates (compositor-only), exactly how `.cglow`
              handles the frame; the real plate is opaque, so only the outward halo is ever visible. Same
              src, so the browser serves it from cache — no second decode. */}
          <img className="plateglow" src={CARD_PLATE_SRC} alt="" aria-hidden="true" draggable={false} />
          <img
            className="cardplate"
            src={CARD_PLATE_SRC}
            alt=""
            aria-hidden="true"
            draggable={false}
            onError={() => { cardPlateAvailable = false; setPlateOk(false); }}
          />
        </>
      )}
      {/* Recruit-phase buff: float the +atk/+hp above the card, exactly like a combat buff (`.float.buff`).
          Keyed so a fresh buff remounts it and replays the rise. */}
      {buffFloat && (
        <span key={buffFloat.key} className="float buff cardfloat">+{buffFloat.attack}/+{buffFloat.health}</span>
      )}
      {/* Step-progress counter below step-based scalers — either "X/N to next step" (Guel 1/4, Monk 2/5, …) or a
          `label` override for cadence cards ("2 Turns" until Money Maker fires). Keyed on the shown value so each
          tick replays the compositor-only bump. Board minions only (populated by the caller). */}
      {card.stepProgress && (
        <span
          key={card.stepProgress.label ?? card.stepProgress.current}
          ref={stepCounterRef}
          className={`stepcounter${card.stepProgress.label ? ' turns' : ''}${card.stepEphemeral ? ' ephemeral' : ''}`}
          aria-label={card.stepProgress.label ?? `Step progress ${card.stepProgress.current} of ${card.stepProgress.total}`}
        >
          {card.stepProgress.label ?? `${card.stepProgress.current}/${card.stepProgress.total}`}
        </span>
      )}
      {/* Hover hit-pad — sits ahead of every real element so they all paint over it. (The decorative
          backplate is the only thing before it; that's inert — same z-index 0, but `pointer-events: none`,
          so it neither paints over this pad nor competes for the hover.) Styled only inside `.row.hand`,
          where it extends the hover area downward once the card pops up (see `.handpad` in styles.css).
          A plain element rather than a pseudo-element: `::before` is already the keyword-glow layer on
          Venomous / Reborn / triple-ready cards, and `::after` is the drawer bridge. */}
      <span className="handpad" aria-hidden="true" />
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
      {/* No keyword BADGES on the card — every keyword signifies through its own card-level treatment instead:
          Divine Shield via the CSS `.wardglass` energy shell OVER the frame (below), Reborn via its Pixi AURA
          (driven from `.card.reborncard` in Recruit), Taunt via the static grey `.card.taunt` border, and
          EXECUTE via the swirling rage aura. Execute's red medallion was the last one standing and came off
          2026-07-22 (owner) — with the aura shipped it was a second, louder signifier for the same keyword.
          The `execute` glyph is still used by the Compendium's keyword list. */}
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
        {/* WARD GLASS (Divine Shield) — the "engulf the frame" layer (owner-chosen approach B, 2026-07-21).
            The `.ward` dome above is trimmed to the ART window by design, so it can never reach the gold.
            This is a SECOND dome painted OVER the frame (z4 vs the frame's z3) and clipped to the frame's own
            silhouette, so the whole card — gold included — reads as sealed inside the glass. Its FACETS live
            here rather than in the inner dome: one sphere at the frame's size means the hex must map to THAT
            sphere, not a smaller one inside the art (owner note).
            Geometry is pure CSS per frame type (oval / spell square / taunt heater), mirroring `.cframe-tint`
            so it tracks the frame at any card scale with no measuring — see styles.css "WARD GLASS". */}
        {card.keywords.includes('DS') && (
          <div className="wardglass" aria-hidden="true">
            <div className="wg-fill" />
            <div className="wg-hex" />
            <div className="wg-sheen" />
            <div className="wg-rim" />
          </div>
        )}
        {/* Flurry (W) — wind blades swirling the card: a CSS ring stack (styles.css `.flurrycard .flurry`).
            Lives in the archbox (NOT `.art`, which clips) at z2 — above the art, below the frame — so the
            swirl orbits AROUND the card like the preview. Static gradient/mask paint from flurryConfig; only
            transform (spin + wrapper squash) and opacity (breathe) animate. Rides drag + the lunge for free. */}
        {card.keywords.includes('W') && (
          <div className="flurry" aria-hidden="true" style={flurryBoxStyle()}>
            <div className="fl-breathe">
              {FLURRY_RINGS.map((r, i) => (
                <div key={i} className="fl-ring-wrap" style={flurryWrapStyle(r)}>
                  <div className="fl-ring" style={flurryRingStyle(r)} />
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Execute (V) — a swirling ring of rage: smoke, comet arcs, glints and drifting shards. Sits at z4,
            over the art AND the frame but under the badges, exactly like the Ward shell (owner ruling) — not
            Flurry's z2. Every gradient/mask/blur is static paint precomputed in executeConfig; only transform
            and opacity animate. Replaced the old lime venom rim + drip globs (2026-07-21). */}
        {card.keywords.includes('V') && <ExecuteAura />}
        {/* TAUNT frame layer (pipeline prototype) — an authored shield laid OVER the portrait, tracing the exact
            `--heater` silhouette so it aligns with the art's clip. Prefers the raster PNG (painterly); falls back
            to the SVG placeholder until that asset exists. The real frame drops into this same layer unchanged. */}
        {card.keywords.includes('T') && frameOk && (
          <>
            {/* grounding shadow (see styles.css "GROUNDING SHADOW"): a black, blurred copy of the frame seated
                behind the art, so the shield reads as sitting on the board rather than floating. */}
            <img className="tframe tframe-img cshadow" src={TAUNT_FRAME_SRC} alt="" aria-hidden="true" />
            {/* hover glow (see styles.css ".cglow"): a pure-teal SILHOUETTE of the frame seated behind the art
                (z0) — a masked child (the bright rim) inside a parent that casts the soft bloom. Not a frame-PNG
                copy, so it's always teal and W/H-scalable with no gold/silver frame ever showing. */}
            <div className="cglow" aria-hidden="true"><span className="cglow-rim" /></div>
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
            {/* hover glow (see styles.css ".cglow"): a pure-teal SILHOUETTE of the frame seated behind the art
                (z0) — a masked child (the bright rim) inside a parent that casts the soft bloom. Not a frame-PNG
                copy, so it's always teal and W/H-scalable with no gold/silver frame ever showing. */}
            <div className="cglow" aria-hidden="true"><span className="cglow-rim" /></div>
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
            {/* colour-overlay layer (🖼️ Card Frames tuner) — a tint masked to the frame silhouette, painted OVER
                the frame img (later sibling, same z); opacity-0 no-op until --fovl-a is set/baked. */}
            <span className="cframe-tint" aria-hidden="true" />
          </>
        )}
        {/* SPELL SQUARE frame (regular spells) — the authored purple square. No tint layer: spells have no tribe,
            and the frame carries its own purple accent. */}
        {useSpellFrame && (
          <>
            {/* grounding shadow (see styles.css "GROUNDING SHADOW") — a black, blurred copy of the square seated
                behind the art so the spell sits on the board. */}
            <img className="cframe cframe-img cshadow" src={SPELL_FRAME_SRC} alt="" aria-hidden="true" />
            {/* hover glow (see styles.css ".cglow"): a pure-teal SILHOUETTE of the frame seated behind the art
                (z0) — a masked child (the bright rim) inside a parent that casts the soft bloom. Not a frame-PNG
                copy, so it's always teal and W/H-scalable with no gold/silver frame ever showing. */}
            <div className="cglow" aria-hidden="true"><span className="cglow-rim" /></div>
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
            {/* colour-overlay layer (🖼️ Card Frames tuner) — a tint masked to the frame silhouette, painted OVER
                the frame img (later sibling, same z); opacity-0 no-op until --fovl-a is set/baked. */}
            <span className="cframe-tint" aria-hidden="true" />
          </>
        )}
        {/* Golden (tripled) marker — a gold crown emblem; pairs with the gold arch frame so a tripled
            minion is instantly findable in a row. */}
        {card.golden && <span className="goldcrown" aria-hidden="true"><Icon name="crown" /></span>}
        {spellLike ? (
          <span className="ctype spell">{card.ruby ? '◆ Ruby' : '✦ Spell'}</span>
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
          click inspect, or the always-on-text setting): name, rules text, tribe. Hidden
          (display:none) on a resting compact tile. */}
      <div className="drawer">
        <div className="cn">{card.name}</div>
        {card.text && (
          <div className="desc">
            <span dangerouslySetInnerHTML={{ __html: descUp(mdBold(shownText)) }} />
          </div>
        )}
        {!spellLike && (
          <div className="dtribe">
            {/* An "All" type prints ALL rather than its printed tribe — Lab Experiment reads `neutral` in data
                but counts as every tribe, and showing NEUTRAL made it look like it took no tribal buffs. */}
            {card.universalTribe ? (
              <><Icon name="star" /> All</>
            ) : (
              <>
                <Icon name={TRIBE_ICON[card.tribe]} /> {TRIBE_LABEL[card.tribe]}
                {card.tribe2 && (
                  <> <span className="ctype-sep">/</span> <Icon name={TRIBE_ICON[card.tribe2]} /> {TRIBE_LABEL[card.tribe2]}</>
                )}
              </>
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
      {/* Hover reveal — portalled to <body> so it floats above neighbouring cards. The full card first
          (in compact mode), then any referenced cards trailing to its right. All forced full-size, and
          PLATED (owner 2026-07-21): this popup is the "read the whole card" surface for shop and warband
          tiles, so it wears the same body as a hand card rather than floating as bare text over the board.
          Safe for `.card.plated`'s `isolation: isolate` — the popup is portalled to <body>, so it's never
          the element a combat lunge is transforming. */}
      {refPos && hasPopup && createPortal(
        <div className="cardref" style={{ left: refPos.left, top: refPos.top } as CSSProperties}>
          <div className="cardref-inner" style={{ transformOrigin: `${refPos.origin} center` } as CSSProperties}>
            {popupCards.map((rc, i) => (
              <Card key={`${rc.cardId ?? i}-${i}`} card={rc} forceFull plated />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});

/**
 * EXECUTE (V) aura — the swirling ring of rage. Layers are GENERATED (the counts are dials), so unlike Ward
 * this can't ride on CSS vars alone: a tuner change has to rebuild the DOM. `useSyncExternalStore` subscribes
 * to executeConfig's snapshot, which is a stable frozen reference that only changes when the DEV tuner writes.
 * In production nothing ever notifies, so every card renders the module-load snapshot once and never again.
 */
const ExecuteAura = memo(function ExecuteAura() {
  const { layers, box } = useSyncExternalStore(subscribeExecute, getExecuteSnapshot, getExecuteSnapshot);
  return (
    <div className="execute" aria-hidden="true" style={box}>
      <div className="ex-breathe">
        {layers.smoke.map((ring, i) => (
          <div key={`s${i}`} className="ex-smoke" style={ring.ring}>
            {ring.blobs.map((b, j) => (
              <div key={j} className="ex-blob" style={b} />
            ))}
          </div>
        ))}
        {layers.arcs.length > 0 && (
          <div className="ex-arcwrap" style={layers.arcWrap}>
            {layers.arcs.map((a, i) => (
              <div key={i} className="ex-arc" style={a} />
            ))}
          </div>
        )}
        {layers.glints.map((g, i) => (
          <div key={`g${i}`} className="ex-glint" style={g} />
        ))}
        {layers.shards.map((s, i) => (
          <div key={`d${i}`} className="ex-shard" style={s.outer}>
            {/* tail first so the diamond paints on top of its own streak */}
            {s.tail && <div className="ex-shardtail" style={s.tail} />}
            <div className="ex-shardbody" style={s.body} />
          </div>
        ))}
      </div>
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

