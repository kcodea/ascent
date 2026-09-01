import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Keyword, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { StepProgress } from './cardText';
import { formatStat } from './formatStat';
import {
  beginEditCardArt, cardArtVars, cardArtVersion, editingCardArt, isPickingCardArt, subscribeCardArt,
} from './cardArtConfig';
import { CardArtEditor } from './CardArtEditor';
import { getSpellBuffFxConfig, makeSpellBuffSparks, sparkEaseCss, growEaseCss, shrinkEaseCss } from './spellBuffFxConfig';
import { subscribeSpellBuff, getSpellBuffSeq } from './spellBuffFx';
import { heldFor, holdStat, statHoldKey, subscribeStatHolds } from './fx/statHold';
import { resolveMechIcon } from './mechIcon';

/** The badge's scale-pop: how far it swells and over how long. See `useBadgePop`. */
const BADGE_POP_SCALE = 1.35;
const BADGE_POP_MS = 180;

/**
 * A scale-POP on the whole stat badge — plate and number together — every time the printed value changes.
 *
 * This is what gives a **+1 its motion**. The roll is an honest odometer, printing only values between the
 * old number and the new one, so a one-point change has nothing in between and lands in a single step
 * however long the roll runs. Popping the badge solves that without the counter ever inventing a value it
 * never had, which is the trade the reel made and the owner turned down.
 *
 * THE BADGE, not the digit alone. Scaling `.value` on its own was too quiet next to the card's own green
 * burst, so this targets the same element (plate + number together). One pop path covers both surfaces now:
 * combat used to run its own hand-set CSS flash cue for this, driven by a per-badge boolean prop `Unit` set
 * by hand; that cue is retired (Task 3 of the combat/shop stat-hold unification) now that combat's `Card`
 * carries a `uid` and reads the same shared hold store the shop does — its badge's printed value moves for
 * the same reason a shop badge's does, so this ONE hook pops it, with nothing combat-specific to author. The
 * badges are positioned by absolute left/right/bottom with no base transform, so a scale composes cleanly
 * without shifting them.
 *
 * It pops on EVERY change, not just the last one, so there is no special case — and because a restart
 * cancels the one in flight, a fast multi-step roll doesn't read as N separate pops. Each step re-launches
 * a swell that only gets partway before the next digit lands, so the badge rides slightly enlarged for the
 * length of the roll and then completes one full pop as it settles.
 */
function useBadgePop(value: number): RefObject<HTMLSpanElement> {
  const ref = useRef<HTMLSpanElement>(null);
  /** The value as of the last frame that actually reached the screen — see the rAF below. */
  const painted = useRef(value);
  const anim = useRef<Animation | null>(null);
  const raf = useRef(0);
  useLayoutEffect(() => {
    /*
     * Compare at the PAINT boundary, not per commit.
     *
     * Placing a hold re-renders synchronously inside the same frame, so on a +1 the digit's value goes
     * 1 → 2 → 1 before the browser paints anything: the 2 is the raw store value, and the hold takes it
     * straight back. Popping per commit therefore fired on a number nobody ever saw, and a single +1 got
     * TWO bounces ~230ms apart (browser-measured). One rAF collapses every intermediate commit in a frame
     * down to the one value that actually reached the screen, so the digit pops once per visible change.
     */
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (painted.current === value) return;   // the frame settled back to where it started
      painted.current = value;
      const el = ref.current;
      if (el === null) return;
      // Cancel before re-launching. WAAPI animations under `composite: 'add'` ACCUMULATE, and a roll
      // changes the number every few frames — a dozen live pops on one badge would scale it off the card.
      anim.current?.cancel();
      try {
        anim.current = el.animate([
          { transform: 'scale(1)' },
          { transform: `scale(${BADGE_POP_SCALE})`, offset: 0.35 },
          { transform: 'scale(1)' },
        ], { duration: BADGE_POP_MS, easing: 'ease-out', composite: 'add' });
      } catch { /* WAAPI composite unsupported: skip the pop rather than clobber the badge's transform */ }
    });
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return ref;
}
// Side-effect import: `cardPillsConfig` applies the pill layout vars (`--cpl-*-t`) to :root at module
// load. Imported HERE rather than only from the dev tuner because the tuner is stripped from production —
// without this, any non-identity default baked into that file would silently never apply to players.
import './cardPillsConfig';
import { artFor, artVariantKey } from './art';
import { renameTerms } from './terms';
import { KeywordDefs } from './KeywordDefs';
import { refPopupLeft } from './refPreviewPlacement';
import { detectCardKeywords } from './detectCardKeywords';
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
/* PER-TRIBE TAUNT SHIELDS (owner-authored, 2026-07-26) — the heater equivalent of `TRIBE_OVALS` below, so a
   Taunt minion is themed like its non-Taunt kin instead of falling back to the shared gold shield. Same
   1086×1448 dims and window silhouette as `taunt-shield.png`, so the `--heater` clip + geometry are unchanged. */
const TRIBE_TAUNTS: Partial<Record<Tribe, { base: string; gold: string }>> = {
  beast: { base: 'taunt-beast.webp', gold: 'taunt-beast-gilded.webp' },
  dragon: { base: 'taunt-dragon.webp', gold: 'taunt-dragon-gilded.webp' },
  mech: { base: 'taunt-mech.webp', gold: 'taunt-mech-gilded.webp' },
  undead: { base: 'taunt-undead.webp', gold: 'taunt-undead-gilded.webp' },
  demon: { base: 'taunt-demon.webp', gold: 'taunt-demon-gilded.webp' },
  neutral: { base: 'taunt-neutral.webp', gold: 'taunt-neutral-gilded.webp' },
  kobold: { base: 'taunt-kobold.webp', gold: 'taunt-kobold-gilded.webp' },
  dwarf: { base: 'taunt-dwarf.webp', gold: 'taunt-dwarf-gilded.webp' },
};
/** The heater a Taunt card should wear: its tribe's shield (gilded variant when golden), else the shared gold. */
function tauntFrameSrcFor(tribe: Tribe | undefined, golden: boolean): string {
  const t = tribe && TRIBE_TAUNTS[tribe];
  if (!t) return TAUNT_FRAME_SRC;
  return `${import.meta.env.BASE_URL}frames/${golden ? t.gold : t.base}`;
}
const hasTribeTaunt = (tribe: Tribe | undefined): boolean => !!(tribe && TRIBE_TAUNTS[tribe]);
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
/* PER-TRIBE OVAL FRAMES (owner-authored, 2026-07-26). Each tribe has its own coloured oval plus a dedicated
   GILDED variant, all 1059×1427 with the same window as `standard-oval-v2.png`, so the "AUTHORED FRAMES"
   geometry drops in unchanged. A card with a tribe frame also gets the `.tribeframe` class, which neutralises
   BOTH recolour passes the shared silver oval relies on (`--frame-tone: grayscale(0.92)…` and the baked
   `--fovl` brown overlay) — without that the authored colour is desaturated and washed brown. Taunt minions
   keep the shared heater shield and spells the square, per the frame precedence below. */
const TRIBE_OVALS: Partial<Record<Tribe, { base: string; gold: string }>> = {
  beast: { base: 'oval-beast.webp', gold: 'oval-beast-gilded.webp' },
  dragon: { base: 'oval-dragon.webp', gold: 'oval-dragon-gilded.webp' },
  mech: { base: 'oval-mech.webp', gold: 'oval-mech-gilded.webp' },
  undead: { base: 'oval-undead.webp', gold: 'oval-undead-gilded.webp' },
  demon: { base: 'oval-demon.webp', gold: 'oval-demon-gilded.webp' },
  neutral: { base: 'oval-neutral.webp', gold: 'oval-neutral-gilded.webp' },
  kobold: { base: 'oval-kobold.webp', gold: 'oval-kobold-gilded.webp' },
  dwarf: { base: 'oval-dwarf.webp', gold: 'oval-dwarf-gilded.webp' },
};
/** The oval a card should wear: its tribe's frame (gilded variant when golden), else the shared silver oval. */
function stdFrameSrcFor(tribe: Tribe | undefined, golden: boolean): string {
  const t = tribe && TRIBE_OVALS[tribe];
  if (!t) return STD_FRAME_SRC;
  return `${import.meta.env.BASE_URL}frames/${golden ? t.gold : t.base}`;
}
const hasTribeOval = (tribe: Tribe | undefined): boolean => !!(tribe && TRIBE_OVALS[tribe]);
// New spell frame art (owner-supplied, session 42). Filename-swapped for one-line revert (original untouched).
// Same 1122×1346 dims + window as the original → geometry unchanged. NOTE: spells carry NO `--frame-tone`
// (it's a no-op `brightness(1)`), so this renders as-authored — the new art is GOLD w/ purple gems. Add the
// grayscale tone to `.spellframe` if a silver spell frame is wanted (to match the minion oval).
const SPELL_FRAME_SRC = `${import.meta.env.BASE_URL}frames/spell-frame-arch.webp`;
let spellFrameAvailable = true;
// HAND CARD BACKPLATE — the ornate stone/gold card body behind a card in hand (and on the dragged copy).
// Same load pattern as the frames above: BASE_URL-relative (root-absolute 404s on itch's CDN sub-path) with a
// module-level availability flag flipped on the first 404, so a missing asset degrades to today's look.
/* TIER STARS — the tier is shown as N steel stars (owner art, 2026-07-26) instead of a "TIER N" text pill.
   One image per tier, 78px tall and 55px wider per star (81→410), so the badge's WIDTH scales with tier and
   the height is what we pin. Rendered with the `tierbadge` class as well as `tierstars`, so it inherits every
   already-tuned per-frame-type anchor (oval / heater / plain) and only the pill chrome is overridden in CSS.
   Falls back to the text pill if the asset 404s, same degrade-gracefully pattern as the frames. */
const tierStarsSrc = (tier: number): string =>
  `${import.meta.env.BASE_URL}frames/tier-stars-${tier}.webp`;
let tierStarsAvailable = true;
/* TIER PLATE — the steel plaque the stars sit ON. Rendered immediately BEFORE the stars so tree order paints
   it behind them (both are positioned, so tree order is what decides — see the note on `.tierplate`). Gilded
   cards get the gold variant. Shows on every card type: minion oval, spell square and Taunt heater alike. */
const tierPlateSrc = (golden: boolean): string =>
  `${import.meta.env.BASE_URL}frames/tierplate${golden ? '-gilded' : ''}.webp`;
/** The dark shape seated behind the rules-text panel (see `.descbox`). Owner art, a full card-body silhouette. */
const DESC_BOX_SRC = `${import.meta.env.BASE_URL}frames/desc-backbox.webp`;
const CARD_PLATE_SRC = `${import.meta.env.BASE_URL}frames/cardplate.webp`;
// Per-tribe plates — same stone/gold body as the neutral plate, tribe-coloured gem accents, same 800×1244
// dims so the geometry vars are unchanged. Keyed on the PRIMARY tribe only (owner 2026-07-25): a Beast/Dragon
// shows the neutral plate, only a Beast-PRIMARY card gets the beast one. Add a tribe here + drop its webp in
// `frames/` to give it a plate (all eight tribes have one as of 2026-07-31). A tribe-plated card also relocates its tribe
// LABEL to the plate's bottom gem (no icon) — see `TRIBE_PLATE_SET` / `.plate-tribe`.
const TRIBE_PLATES: Partial<Record<Tribe, string>> = {
  beast: `${import.meta.env.BASE_URL}frames/cardplate-beast.webp`,
  dragon: `${import.meta.env.BASE_URL}frames/cardplate-dragon.webp`,
  mech: `${import.meta.env.BASE_URL}frames/cardplate-mech.webp`,
  demon: `${import.meta.env.BASE_URL}frames/cardplate-demon.webp`,
  undead: `${import.meta.env.BASE_URL}frames/cardplate-undead.webp`,
  neutral: `${import.meta.env.BASE_URL}frames/cardplate-neutral.webp`,
  kobold: `${import.meta.env.BASE_URL}frames/cardplate-kobold.webp`,
  dwarf: `${import.meta.env.BASE_URL}frames/cardplate-dwarf.webp`,
};
const plateSrcFor = (tribe: Tribe | undefined): string =>
  (tribe && TRIBE_PLATES[tribe]) || CARD_PLATE_SRC;
const isTribePlated = (tribe: Tribe | undefined): boolean => !!(tribe && TRIBE_PLATES[tribe]);
let cardPlateAvailable = true;

const TRIBE_LABEL: Record<Tribe, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', neutral: 'Neutral', kobold: 'Kobold', dwarf: 'Dwarf',
  celestial: 'Celestial',
};
/** Each tribe's own footer glyph (handoff: the symbol matches the type — paw = Beast, etc.). */
const TRIBE_ICON: Record<Tribe, string> = {
  beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star', kobold: 'crown', dwarf: 'anvil',
  // PLACEHOLDER glyph: `star` already belongs to neutral, so Celestial borrows `clock` — it at least reads as
  // the Dawn/Dusk cycle. A proper emblem (and the cardplate + tribe colour the other tribes got) is
  // presentation work, not content work.
  celestial: 'clock',
};

/** Render rules text to HTML: fold the player-facing keyword rename (Battlecry→Shout, …) in FIRST, then bold
 *  `**…**`. Every rich rules-text surface (card body, rune text, Choose One options) goes through this, so the
 *  vocabulary is consistent everywhere — not just on card bodies (`renameTerms` is idempotent, so a caller that
 *  already renamed is harmless). */
export const mdBold = (s: string): string => renameTerms(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
/** A {{…}} marker → a green "modified" span (e.g. Kennelmaster's Avenge-boosted buff). */
const descUp = (s: string): string => s.replace(/\{\{(.+?)\}\}/g, '<span class="descup">$1</span>');
/** A ((…)) marker → a gold "temporary" span, parentheses kept visible (next-combat spell grants). */
const descTemp = (s: string): string => s.replace(/\(\((.+?)\)\)/g, '<span class="desctemp">($1)</span>');
/** A [[…]] marker → a BLUE "rune-granted" span (Rune of Rebirth's "Rebirth" on every minion, owner ask
 *  2026-08-20). Blue, not green: green means "a modified value of this card's own rule"; blue is a rule a
 *  held rune ADDS to the card. */
const descRune = (s: string): string => s.replace(/\[\[(.+?)\]\]/g, '<span class="descrune">$1</span>');
/** A <<…>> marker — the (Both) label on a Choose One whose branches are all enabled. Coloured by the card's
 *  own TRIBE (owner ask 2026-08-28: "make the (Both) text logic follow the tribe color logic — kobolds should
 *  be that orangey/red color"), which the card root already exposes as `--c`; a Kobold reads #e8763a, a Beast
 *  green, and so on. Its own marker rather than reusing `descup` because that green means "a modified value of
 *  this card's own rule", which (Both) is not. */
const descBoth = (s: string): string => s.replace(/<<(.+?)>>/g, '<span class="descboth">$1</span>');
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
  cardId: string;
  /** Choose One: the branch this instance picked. Drives ART only here — the per-branch TEXT is already
   *  resolved upstream (`instView` / `Unit`). Option N renders `<cardId><N+1>` when that art exists. */
  chosenOption?: number;
  /** An EXPLICIT illustration, overriding the `cardId` lookup. The one caller is the Choose One picker when
   *  the prompt belongs to an EQUIPMENT (Prismatic Pick): there is no card behind that decision, so its two
   *  options are drawn as the Equipment wearing each branch's own art. Everything else leaves it unset and
   *  resolves art the usual way. */
  artUrl?: string;
  /** (BOTH) FX HOOK: a stable key stamped on the card root as `data-choose-both` when this card's Choose One
   *  will resolve as BOTH branches (see `chooseBothActive`). It is the ONLY contract the looping marker FX
   *  binds to (`useChooseBothFx` follows `[data-choose-both="<key>"]`), so the effect can be re-authored,
   *  retargeted or removed without touching card rendering. Absent = the card does not qualify. */
  chooseBothKey?: string;
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
  battlecry,
  electrify,
  karwind,
  pulse,
  pulseCrit,
  pulseRally,
  pulseWatcher,
  pulseFrame,
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
  contraband,
  enchanted,
  soulbound,
  forceFull,
  slideDir,
  handSlidePx,
  fanRot,
  locked,
  lockLabel,
  plated,
  autoRoll = true,
  align,
}: {
  card: CardView;
  /** CELESTIAL alignment — draws the luminous crescent beneath this minion (Dawn / Dusk / Eclipse). A CHILD
   *  of the card on purpose (owner report 2026-08-06: the canvas version "hated being moved"): drags, row
   *  slides and pop-ins are all inherited for free, and only the COLOUR is derived from board position.
   *  Absent on every non-Celestial board, so an ordinary board renders nothing extra at all. */
  align?: 'dawn' | 'dusk' | 'eclipse';
  /** Instance id, exposed as data-uid so layout (FLIP) animations can track the card. */
  uid?: string;
  onClick?: () => void;
  highlight?: boolean;
  /** The current aim target of a hero power / single-target ability — strong highlight. */
  targeted?: boolean;
  /** Dim this card while a copy of it is being dragged. */
  dimmed?: boolean;
  /** Play the one-shot SPELL-buff cue — an in-place grow/shrink plus an outward spark blast. Fired
   *  when a hand spell's (or Ruby's) printed value just went UP, so the player sees which cards were affected. */
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
  /** Pulse the trigger medallion RED — this unit's effect CRIT (Karwind's 20% doubled buff). Same ring as
   *  `pulse`, forced red, and the HIGHEST precedence: a crit is the most significant proc, so it wins over
   *  the plain trigger pulse (and the combat rally/watcher colours it never co-occurs with). A per-fire NONCE
   *  (used as the medallion `key`, like `pulseRally`) so a repeat crit restarts the animation. */
  pulseCrit?: number;
  /** Pulse the trigger medallion YELLOW — a Rally fired as this unit attacks. Same ring as `pulse`, forced
   *  yellow; takes precedence over `pulse`. A per-fire NONCE (truthy = pulsing): it's used as the medallion's
   *  `key` so the element remounts each Rally and the CSS pulse restarts, even when `.pulsing` is already on
   *  from the unit's own trigger glow (a plain class re-add wouldn't replay the animation). */
  pulseRally?: number;
  /** Pulse the trigger medallion LIGHT BLUE — a watcher answered an ally's attack. Same ring as `pulse`,
   *  forced light blue; sits between `pulseRally` (yellow) and `pulse` (white) in precedence. A per-fire NONCE
   *  (used as the medallion `key`, like `pulseRally`) so a repeat watcher pulse restarts the animation. */
  pulseWatcher?: number;
  /** Bloom the CARD FRAME light blue — the watcher's frame surface (CSS fallback when the Pixi `watcher-pulse`
   *  def can't play). A per-fire nonce keyed onto the `.framepulsering` overlay so each fire replays. */
  pulseFrame?: number;
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
  /** Pete (Contrabanana): a smuggled tier-above Shop offer — one-shot flash as the row lands. */
  contraband?: boolean;
  /** Croupier Cia's Lucky Seat: this offer wears the Enchanted treatment — a purple chained wisp. Purely
   *  cosmetic; it changes nothing about the card you buy. */
  enchanted?: boolean;
  /** Sable's Soulbind: this minion is one of the two bound ends this turn — draws the ring above it. */
  soulbound?: boolean;
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
  /** Off switch for the intrinsic roll below (default on, so every existing `<Card>` is unaffected). Combat
   *  passes `false`: a combat badge's changes are either damage (instant by decision) or buffs (driven by the
   *  replay's own `effect` holds), so an intrinsic roll on top would double-drive damage. */
  autoRoll?: boolean;
}) {
  const inspectCard = useGame((s) => s.inspectCard);
  // Spell-buff cue: build this burst's motes (and read its timing/shape dials) at FIRE TIME, so a ✨ Spell Buff
  // tuner edit shows on the NEXT burst without a reload. Re-keyed on `spellBuffed` so each burst gets fresh
  // jitter and the same burst never re-randomises mid-animation.
  // The SPELL-buff burst id comes from a module-level store rather than a prop, so ANY surface or phase can
  // start the cue (end of turn, start of combat, a mid-combat Echo/Avenge) without this card's renderer having
  // to thread state down — see `spellBuffFx.ts`. `undefined` = not bursting; the number INCREASES on every
  // retrigger so a buff landing mid-burst restarts the cue instead of being swallowed (owner 2026-07-24: each
  // trigger must read as its own hit, and cutting the previous one off is fine).
  const spellBuffSeq = useSyncExternalStore(subscribeSpellBuff, () => (uid ? getSpellBuffSeq(uid) : undefined), () => undefined);
  // A stat change can be WITHHELD from the badge until an effect delivers it (see `fx/statHold.ts`): the
  // cue holds the delta, a `react` layer with "carries the number" releases it at its peak, so the digits
  // change on the effect's clock instead of the reducer's. Subscribed per-uid so a card with nothing held
  // reads 0 and never re-renders when some other card is gemmed.
  const statHoldSeq = useSyncExternalStore(subscribeStatHolds, () => (uid ? statHoldKey(uid) : 0), () => 0);
  // `statHoldSeq` IS the dependency here: it encodes the held delta, and re-reading `heldFor` is what turns
  // that primitive back into the pair of numbers. `uid` alone would never invalidate.
  const held = useMemo(() => (uid && statHoldSeq !== 0 ? heldFor(uid) : null), [uid, statHoldSeq]);
  /**
   * ANY stat change rolls the badge — a shop buff, a gem, a Shout, a hero power, up or down, with nothing
   * authored anywhere.
   *
   * Driven by the value CHANGING rather than by an authored effect, and that is the whole point. Routing
   * this through the FX system meant six things had to line up (a def exists, it is bound to that exact
   * moment, it has a react layer, `carries` is on, `roll` is set, the phase actually fires that cue) and
   * every one of them failed silently and identically. "The stat changed" is the only signal that is
   * universal, and the badge is the only place that always sees it.
   *
   * ── the two gates ────────────────────────────────────────────────────────────────────────────────────
   * **1. It needs a `uid`, which is what keeps it out of combat.** Only the recruit surfaces pass one;
   * `Unit` renders its `Card` without a uid (the uid lives on `Unit`'s own wrapper), so a fight's damage
   * ticks and strike beats never reach here. That is deliberate rather than incidental — combat numbers are
   * already choreographed (`score.ts` holds, damage floats, the strike beats), and an unauthored roll on
   * top of that is a second clock on the same digits. Static surfaces (EndScreen, Leaderboard, Career,
   * MinionBook) pass no uid either, so a recap board never animates.
   *
   * **2. It yields to an authored effect**, via the hold's origin (see `fx/statHold.ts`). The gem cue in
   * `Recruit` holds the SAME delta for the same commit, and React flushes layout effects child-first, so
   * this one always lands first — accumulating both would withhold +2/+2 for a +1/+1 gem. `holdStat`
   * replaces this hold with the authored one, and the shared ticker's own origin check stands down for it.
   *
   * A layout effect so the hold lands BEFORE paint: in a passive effect the new number would show for one
   * frame and then jump backwards to roll, which is worse than not rolling at all.
   *
   * `prevStats` resets when the uid changes, because React reuses a Card component across units — without
   * that, a recycled card would roll from the previous minion's numbers to this one's.
   */
  const prevStats = useRef<{ uid?: string; attack: number; health: number }>({ uid, attack: card.attack, health: card.health });
  useLayoutEffect(() => {
    const prev = prevStats.current;
    prevStats.current = { uid, attack: card.attack, health: card.health };
    if (prev.uid !== uid || uid === undefined || !autoRoll) return;   // a recycled component, not a stat change
    const dA = card.attack - prev.attack;
    const dH = card.health - prev.health;
    if (dA === 0 && dH === 0) return;
    holdStat(uid, { attack: dA, health: dH }, { origin: 'intrinsic' });
    // NO local loop and no failsafe timer. `fx/statHold.ts` owns the clock for every hold no effect claimed
    // — one rAF for the whole board instead of one per card, and it survives this card unmounting mid-roll.
    // Its schedule-aware TTL is what force-delivers a hold nobody finished.
  }, [uid, card.attack, card.health, autoRoll]);

  // What the badges actually print. Live value MINUS whatever hasn't been shown yet, so the number stays
  // correct under anything else that touches the unit mid-hold (see statHold.ts on why it is a delta).
  //
  // Floored at 0 as a last line of defence. The intrinsic roll fits its own reel to the room underneath it
  // (see above), but an AUTHORED `react` layer sets `reel` by hand in a def, and nothing stops a dial from
  // being turned past what the minion has room for. A mid-roll frame is allowed to overshoot; it is not
  // allowed to print a negative stat.
  const shownAttack = held ? Math.max(0, card.attack - held.attack) : card.attack;
  const shownHealth = held ? Math.max(0, card.health - held.health) : card.health;
  // Each badge pops independently, so a buff that only moves attack leaves the health badge alone.
  const atkPopRef = useBadgePop(shownAttack);
  const hpPopRef = useBadgePop(shownHealth);
  const spellSparks = useMemo(() => (spellBuffSeq !== undefined ? makeSpellBuffSparks() : []), [spellBuffSeq]);
  const spellBuffed = spellBuffSeq !== undefined;
  const sbCfg = spellBuffed ? getSpellBuffFxConfig() : null;
  // Restart the card's grow/shrink on EVERY new burst id. Re-applying a class that's already on does not replay
  // a CSS animation, so without this a second buff landing mid-cue would show sparks but a motionless card.
  // cancel() + play() rewinds both phases (delay included) — deliberately cutting the previous pop short.
  const sbRootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (spellBuffSeq === undefined) return;
    for (const a of sbRootRef.current?.getAnimations() ?? []) {
      const name = (a as Animation & { animationName?: string }).animationName;
      if (name === 'sbgrow' || name === 'sbshrink') { a.cancel(); a.play(); }
    }
  }, [spellBuffSeq]);
  // The arched frame is universal now. `showText` = also render the drop-down text drawer (the "full"
  // card): on a force-full card (hover reveal / hand / right-click inspect) or when the player turns the
  // compact tiles off. At rest (compact tiles on, not force-full) it's a pure arched art tile.
  // `||` here SHORT-CIRCUITED the `useGame` call whenever `forceFull` was set — a conditionally-called hook.
  // It went unnoticed while every call site passed a constant `forceFull`, but any tree position where a card
  // renders force-full after a non-force-full one shifts the whole hook order and React throws "Should have a
  // queue" (hit 2026-07-24 adding force-full cards to the Choose One prompt). Read the store unconditionally.
  const compactCards = useGame((s) => s.compactCards);
  const showText = forceFull || !compactCards;
  // Decide the mount-pop exactly once, at mount, so a later prop change never restarts the animation.
  const [popin, setPopin] = useState(() => !suppressPop);
  /* Re-render when this card's art framing is dialled in the tuner. `useSyncExternalStore` rather than a
     store subscription: this module must not pull in Zustand, and the counter never moves in production
     (nothing there can write an override), so a shipped card subscribes to something permanently silent. */
  useSyncExternalStore(subscribeCardArt, cardArtVersion, cardArtVersion);
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
  // The counter's last laid-out CENTRE. Kept because one card fires its flourish as the counter DISAPPEARS
  // (see below), by which point the element is unmounted and has no rect of its own to read.
  const lastStepPtRef = useRef<{ x: number; y: number } | null>(null);
  const stepCur = card.stepProgress?.current;
  const stepTotal = card.stepProgress?.total;
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = stepCur ?? null;
    const el = stepCounterRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) lastStepPtRef.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    // Living Grimoire: its meter is hidden while CHARGED, so "recharged" shows up as the counter vanishing
    // rather than as a tick landing on `total` (owner correction 2026-07-24 — a 3/3 read as still-to-fill).
    // Fire the same flourish from where the counter just was, so becoming ready still reads as an event.
    // Guarded on `prev !== null` so a card that mounts already charged doesn't burst.
    if (stepCur === undefined) {
      if (prev !== null && lastStepPtRef.current) {
        const { x, y } = lastStepPtRef.current;
        pixiFx.spellPower(x, y, getStepProcFxConfig());
      }
      return;
    }
    if (stepTotal === undefined) return;
    if (!isStepProcTick(prev, stepCur, stepTotal)) return;      // see the rule (+ its tests) in stepProcFxConfig
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;             // not laid out (hidden/unmounted) — nothing to fire from
    pixiFx.spellPower(r.left + r.width / 2, r.top + r.height / 2, getStepProcFxConfig());
  }, [stepCur, stepTotal]);
  // The golden-aware rules text — doubled numbers (or explicit goldenText) when shown golden.
  const shownText = card.golden ? (card.goldenText ?? doubleNums(card.text)) : card.text;
  // The rules HTML, memoized on the text it renders (perf audit 2026-08-06). Unmemoized, every Card render
  // re-ran the full pipeline — renameTerms' 23 regexes + the bold/marker passes — AND handed React a fresh
  // string, forcing a dangerouslySetInnerHTML re-parse. That cost fired on all ~22 on-screen cards at once
  // whenever a shared prop flipped (drag start/end, hero arm), inside the same frame as the drag's FLIP.
  const rulesHtml = useMemo(() => descBoth(descRune(descTemp(descUp(mdBold(shownText))))), [shownText]);
  // The card's primary mechanic glyph for the medallion — the first mechanic the card itself has (see
  // mechIcon.ts). `null` → a blank badge. Never the tribe.
  const mechIcon = resolveMechIcon(card);
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
      // The popup is `zoom`ed by --inspect-zoom (1.3 on mobile) × the Layout Lab's --z-inspect-s size dial, so its
      // rendered footprint is that much bigger than a natural card — fold the SAME product into the width/height
      // estimates so it stays on-screen.
      const cs = getComputedStyle(document.documentElement);
      const zoom = (parseFloat(cs.getPropertyValue('--inspect-zoom')) || 1) * (parseFloat(cs.getPropertyValue('--z-inspect-s')) || 1);
      // Popup cards are PLATED, so the plate — not the tile — is the real footprint: `plate.scale` times the
      // card width, and `× 1.5550` tall (the art's locked aspect). Estimating off the bare tile put wide
      // popups off the right edge and let tall ones run off the bottom.
      const plateScale = getCardPlateConfig().scale;
      const cardW = r.width * zoom * plateScale;
      // The keyword definition column (KeywordDefs) is part of the cluster too — up to `min(144px, 25vw)` wide,
      // zoomed like the cards. Fold it into the width estimate so the flip/clamp keeps the WHOLE cluster on
      // screen: without it a card + referenced card + defs runs off the right edge and laps the hovered tile
      // and the right-side UI. 0 when the card references no keyword defs.
      const nDefs = detectCardKeywords(card).length;
      const defsW = nDefs > 0 ? gap + Math.min(144, window.innerWidth * 0.25) * zoom : 0;
      const tipW = cardW * n + (n - 1) * gap + defsW; // cards laid left→right, plus the defs column
      // Placement is `refPopupLeft`'s (its own module, and its own tests): right if it fits, else left, else
      // CENTRED — never slammed against the left edge, which is what "shoved off to the left side of the
      // screen" was (owner report 2026-08-31).
      const left = refPopupLeft({ cardLeft: r.left, cardRight: r.right, tipW, viewportW: window.innerWidth, gap });
      const flip = left < r.left;
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
  // An explicit `card.artUrl` wins over the id lookup — see `CardView.artUrl` for the one caller that needs it.
  const artUrl = card.artUrl ?? artFor(card.cardId, uid, card.chosenOption);
  // TAUNT frame: render the raster shield if the asset loads; on 404 fall back to the SVG placeholder.
  const [frameOk, setFrameOk] = useState(tauntFrameAvailable);
  const [starsOk, setStarsOk] = useState(tierStarsAvailable);
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
  // A plated card whose PRIMARY tribe has its own plate: drop the in-drawer tribe icon+label and print the
  // tribe name on the plate's bottom gem instead (owner 2026-07-25). Only on the plate itself (hand / drag),
  // never on an unplated board card, a spell, or the "All"-tribe case.
  // "ALL TYPES" is a property of the CARD DEF, so derive it here rather than trusting each projection to
  // carry it (owner report 2026-08-20: Lab Experiment / Paragon / Standard Bearer read "Neutral"). SIX
  // CardView builders dropped the flag — the Compendium, Career, Leaderboard, quest- and rune-reward
  // previews, and the sandbox editor — and any future one could forget again. Reading the def closes the
  // class instead of patching each site. The view still WINS when it sets the flag, which is what carries
  // the INSTANCE-level case (`allTribes` — an Anomaly-Reactor'd body, which no def knows about).
  const universalTribe = card.universalTribe ?? !!CARD_INDEX[card.cardId]?.universalTribe;
  // An All-type card is PLATED like any other (owner report 2026-08-20: its "ALL" sat in the drawer while
  // every neighbouring card printed its tribe on the plate's bottom gem). The old `&& !universalTribe`
  // exclusion existed only because the gem printed `TRIBE_LABEL[card.tribe]`, which reads NEUTRAL for these
  // cards — the gem now prints ALL instead, so the exclusion is obsolete and the label sits where the eye
  // already looks for it.
  const tribePlated = usePlate && isTribePlated(card.tribe) && !spellLike;
  const useSpellFrame = spellLike && card.cardId !== 'discoverspell' && pframeOk;
  const useStdFrame = !spellLike && !isTaunt && sframeOk;
  return (
    <div
      ref={sbRootRef}
      className={`card compact${showText ? ' showtext' : ''}${popin ? ' popin' : ''}${popDelay ? ' popdelay' : ''}${highlight ? ' armed' : ''}${targeted ? ' targeted' : ''}${card.golden ? ' golden' : ''}${dimmed ? ' dragsrc' : ''}${spellBuffed ? ' spellbuff' : ''}${battlecry ? ' bcasting' : ''}${card.keywords.includes('T') ? ' taunt' : ''}${card.keywords.includes('ST') ? ' stealth' : ''}${card.keywords.includes('DS') ? ' dscard' : ''}${card.keywords.includes('R') ? ' reborncard' : ''}${card.keywords.includes('V') ? ' venomcard' : ''}${card.keywords.includes('W') ? ' flurrycard' : ''}${spellLike ? ' spellcard' : ''}${card.ruby ? ' rubycard' : ''}${card.cardId === 'discoverspell' ? ' triplecard' : ''}${useStdFrame ? ' stdframe' : ''}${(useStdFrame && hasTribeOval(card.tribe)) || (isTaunt && frameOk && hasTribeTaunt(card.tribe)) ? ' tribeframe' : ''}${useSpellFrame ? ' spellframe' : ''}${electrify ? ' electrify' : ''}${tripleReady ? ' tripready' : ''}${contraband ? ' contraband' : ''}${enchanted ? ' enchanted' : ''}${card.tribe2 ? ' dual' : ''}${locked ? ' locked' : ''}${usePlate ? ` plated plate-txt-${txtBucket}` : ''}`}
      data-uid={uid}
      data-choose-both={card.chooseBothKey}
      style={{ '--c': `var(--t-${card.tribe})`, '--c2': `var(--t-${card.tribe2 ?? card.tribe})`,
        '--fan-rot': `${fanRot ?? 0}deg`,
        /* PER-CARD art framing (🖼️ Card Art tuner). Spread inline so it beats the frame family's own
           `--artY`/`--artZoom` on specificity; a card with no override contributes nothing at all here. */
        // Framed under the BRANCH's key when a resolved Choose One is wearing branch art, falling back to
        // the card's own entry — the base and the branch are different pictures (owner ask 2026-08-28).
        ...(cardArtVars(card.cardId ? artVariantKey(card.cardId, card.chosenOption) : undefined, card.cardId) ?? {}),
        // Spell-buff cue dials (✨ Spell Buff tuner) — only while the burst is on, so nothing else pays for them.
        ...(sbCfg ? { '--sb-grow': sbCfg.growScale, '--sb-grow-ms': `${sbCfg.growMs}ms`, '--sb-grow-ease': growEaseCss(sbCfg), '--sb-shrink-ms': `${sbCfg.shrinkMs}ms`, '--sb-shrink-ease': shrinkEaseCss(sbCfg), '--sb-ms': `${sbCfg.sparkMs}ms`, '--sb-alpha': sbCfg.sparkAlpha, '--sb-glow': `${sbCfg.sparkGlow}px`, '--sb-grav': `${sbCfg.sparkGravity}px`, '--sb-oy': `${sbCfg.blastOriginY}%`, '--sb-ease': sparkEaseCss(sbCfg) } : {}),
        transform: handSlidePx
          ? `translateX(${handSlidePx}px) translateY(var(--hand-tuck, 0px)) rotate(var(--fan-rot, 0deg))` /* hand reorder: keep the tuck + fan tilt while parting */
          : slideDir ? `translateX(calc((var(--ccw) + 22px) * ${slideDir}))` : undefined } as CSSProperties}
      onClick={onClick}
      /* Card Art tuner: double-click targets this card. Only while that panel is open (`isPickingCardArt`),
         so normal play never has a hidden double-click meaning. `onDoubleClick` rather than `onClick`
         deliberately - a single click is already play/drag, and stealing it would break the board. */
      onDoubleClick={card.cardId ? (e) => {
        if (!isPickingCardArt()) return;
        e.preventDefault();
        e.stopPropagation();
        // Dial the picture that is actually on screen: tuning a resolved branch writes the BRANCH's entry,
        // not the base card's, so the two can be framed independently.
        beginEditCardArt(artVariantKey(card.cardId!, card.chosenOption));
      } : undefined}
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
      {/* CELESTIAL alignment crescent — FIRST child so it paints behind the card body, whose opaque frame
          conceals the ring's upper half: what remains reads as an arc wrapping beneath the minion. */}
      {align && <div className={`alignarc aa-${align}`} aria-hidden="true" />}
      {/* Backplate — the ornate card body behind everything, on hand + dragged-from-hand cards only. FIRST
          child so tree order paints it behind every sibling; `.card.plated` isolates so its z-index can't
          escape into neighbouring cards. `<img>` rather than a CSS background so a 404 is detectable. */}
      {usePlate && (
        <>
          {/* Hover glow, plate edition — a COPY of the plate art seated behind the real one, carrying a
              static drop-shadow halo. Only its OPACITY animates (compositor-only), exactly how `.cglow`
              handles the frame; the real plate is opaque, so only the outward halo is ever visible. Same
              src, so the browser serves it from cache — no second decode. */}
          <img className="plateglow" src={plateSrcFor(card.tribe)} alt="" aria-hidden="true" draggable={false} />
          <img
            className="cardplate"
            src={plateSrcFor(card.tribe)}
            alt=""
            aria-hidden="true"
            draggable={false}
            onError={() => { cardPlateAvailable = false; setPlateOk(false); }}
          />
          {/* Tribe NAME on the plate's bottom gem — the tribe-plated card's tribe label lives here (no icon)
              instead of in the drawer (owner 2026-07-25). Positioned over the plate's bottom diamond. */}
          {tribePlated && (
            <div className="plate-tribe" aria-hidden="true">
              {/* ALL replaces the printed tribe for an every-type card — NEUTRAL would say the opposite of
                  what it does. Plain text, no icon, exactly like every other tribe on this gem. */}
              {universalTribe ? 'ALL' : (
                <>
                  {TRIBE_LABEL[card.tribe]}
                  {card.tribe2 && <> <span className="ctype-sep">/</span> {TRIBE_LABEL[card.tribe2]}</>}
                </>
              )}
            </div>
          )}
        </>
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
      {card.tier !== undefined && (starsOk && card.tier >= 1 && card.tier <= 7 ? (
        <>
        {/* TIER 7 ONLY — a soft pulsing halo marking the top tier. It carries `tierbadge`, so it inherits the
            very same per-family transform the stars use and tracks them for free. Rendered FIRST and stacked
            lowest, so it sits BEHIND the plaque (owner 2026-07-26) and reads as light radiating out from
            behind it rather than washing over its face. Opacity is the only animated property (`.tierglow`). */}
        {card.tier === 7 && <span className="tierbadge tierglow" aria-hidden="true" />}
        <img
          className="tierbadge tierplate"
          src={tierPlateSrc(!!card.golden)}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <img
          className="tierbadge tierstars"
          data-tier={card.tier}
          src={tierStarsSrc(card.tier)}
          alt=""
          aria-hidden="true"
          draggable={false}
          onError={() => { tierStarsAvailable = false; setStarsOk(false); }}
        />
        </>
      ) : (
        <span className="tierbadge" data-tier={card.tier}>Tier {card.tier}</span>
      ))}
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
        {/* Card Art transform session (dev). Mounted on the CARD ROOT, not inside `.art`: the art window
            clips, so buttons parented there could never sit outside the card. The drag maths still measures
            `.art` (see CardArtEditor) because the stored offset is a % of the ART window, not the card. */}
        {card.cardId && editingCardArt() === card.cardId && <CardArtEditor cardId={card.cardId} />}

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
            <img className="tframe tframe-img cshadow" src={tauntFrameSrcFor(card.tribe, !!card.golden)} alt="" aria-hidden="true" />
            {/* hover glow (see styles.css ".cglow"): a pure-teal SILHOUETTE of the frame seated behind the art
                (z0) — a masked child (the bright rim) inside a parent that casts the soft bloom. Not a frame-PNG
                copy, so it's always teal and W/H-scalable with no gold/silver frame ever showing. */}
            <div className="cglow" aria-hidden="true"><span className="cglow-rim" /></div>
            <img
              className="tframe tframe-img"
              src={tauntFrameSrcFor(card.tribe, !!card.golden)}
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
            <img className="cframe cframe-img cshadow" src={stdFrameSrcFor(card.tribe, !!card.golden)} alt="" aria-hidden="true" />
            {/* hover glow (see styles.css ".cglow"): a pure-teal SILHOUETTE of the frame seated behind the art
                (z0) — a masked child (the bright rim) inside a parent that casts the soft bloom. Not a frame-PNG
                copy, so it's always teal and W/H-scalable with no gold/silver frame ever showing. */}
            <div className="cglow" aria-hidden="true"><span className="cglow-rim" /></div>
            <img
              className="cframe cframe-img"
              src={stdFrameSrcFor(card.tribe, !!card.golden)}
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
            {/* Stat badges — three nodes each so FX can target them separately (docs/fx-vocabulary.md):
                the `.badge` wrapper seats the pair, `.plate` is the shape, `.value` is the digit. Plate and
                value are SIBLINGS, not nested, so the plate can scale without dragging the number. */}
            <span ref={atkPopRef} className={`badge atk${statCls(shownAttack, card.baseAttack, card.floorAttack)}`}>
              <span className="plate" aria-hidden="true" />
              <span className="value">{formatStat(shownAttack)}</span>
            </span>
            <span ref={hpPopRef} className={`badge hp${statCls(shownHealth, card.baseHealth, card.floorHealth)}`}>
              <span className="plate" aria-hidden="true" />
              <span className="value">{formatStat(shownHealth)}</span>
            </span>
            {/* mechanic medallion — the card's primary mechanic glyph, eclipsing the arch's base centre */}
            <span key={`cgem-${pulseCrit ?? 0}-${pulseRally ?? 0}-${pulseWatcher ?? 0}`} className={`cgem${pulseCrit ? ' pulsing crit' : pulseRally ? ' pulsing rally' : pulseWatcher ? ' pulsing watcher' : pulse ? ' pulsing' : glow ? ' glowing' : ''}`} aria-hidden="true">{mechIcon && <Icon name={mechIcon} />}</span>
          </>
        )}
        {/* WATCHER frame bloom — a one-shot light-blue ring on the whole card frame (CSS fallback for the
            Pixi `watcher-pulse` def). A direct child of `.archbox` (sibling to the frame/art layers) so its
            `inset: 0` rings the whole card; keyed on the nonce so React remounts + replays each fire. */}
        {pulseFrame ? <span key={`framepulse-${pulseFrame}`} className="framepulsering" aria-hidden="true" /> : null}
      </div>
      {/* Text drawer — drops down from the arched frame on the "full" card (hover reveal, hand, right-
          click inspect, or the always-on-text setting): name, rules text, tribe. Rendered ONLY when the
          `showtext` class would display it (perf audit 2026-08-06): it used to render unconditionally and
          sit at display:none on every resting compact tile, paying the name/desc/tribe DOM — including the
          rules-HTML parse — for tiles that never showed it. `showText` is the same prop that drives the
          class, so presence and visibility can't drift. */}
      {showText && <div className="drawer">
        {/* BACKBOX — an authored dark shape behind the text panel, darkening the plate under it so the rules
            text reads cleanly. FIRST child so tree order paints it behind every text sibling; `.drawer` keeps
            NO z-index (load-bearing — see styles.css) so this needs none either. Dialed in the 🔤 Card Text
            tuner (backbox · size/x/y/opacity/blend). */}
        <img className="descbox" src={DESC_BOX_SRC} alt="" aria-hidden="true" draggable={false} />
        <div className="cn">{card.name}</div>
        {card.text && (
          <div className="desc">
            <span dangerouslySetInnerHTML={{ __html: rulesHtml }} />
          </div>
        )}
        {!spellLike && !tribePlated && (
          <div className="dtribe">
            {/* An "All" type prints ALL rather than its printed tribe — Lab Experiment reads `neutral` in data
                but counts as every tribe, and showing NEUTRAL made it look like it took no tribal buffs. */}
            {universalTribe ? (
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
      </div>}
      {/* Spell buff — this hand spell / Ruby just got stronger: coloured sparks blast outward off it (the three
          hues are tuner dials). Pairs with the `.spellbuff` grow/shrink on the card itself. */}
      {spellBuffed && (
        /* Keyed on the burst id so a retrigger REMOUNTS the motes: new jitter, and every animation restarts
           from zero rather than continuing the previous burst's flight. */
        <span className="sbsparks" key={spellBuffSeq} aria-hidden="true">
          {spellSparks.map((s, i) => (
            <span
              key={i}
              className="sbspark"
              style={{ animationDelay: s.delay, '--sb-size': s.size, '--sb-ang': s.angle, '--sb-dist': s.dist, '--sb-hue': s.hue, '--sb-tail': s.tail } as CSSProperties}
            />
          ))}
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
      {/* Croupier Cia's Lucky Seat enchant treatment is the authored `cia-hp` FX (fired from
          `useCiaEnchantedFx` when a shop card enchants) — no per-card DOM element here. */}
      {/* Sable's Soulbind — a purple ring hovering ABOVE each bound minion for the turn the bond is live
          (owner ask 2026-08-16), so the pair is readable at a glance. Static shadow, opacity-only breathe. */}
      {soulbound && <span className="soulbindflash" aria-hidden="true" />}
      {soulbound && <span className="soulbindmark" aria-hidden="true" />}
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
            {/* When the reveal opens LEFT (flipped, origin 'right'), the cards sit nearest the hovered tile and
                the defs go on the far (outward) side, so the column never laps back over the source. Opening
                right, it's the reverse: cards first, defs on the far right. */}
            {refPos.origin === 'right' && <KeywordDefs card={card} />}
            {popupCards.map((rc, i) => (
              <Card key={`${rc.cardId ?? i}-${i}`} card={rc} forceFull plated />
            ))}
            {refPos.origin === 'left' && <KeywordDefs card={card} />}
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

