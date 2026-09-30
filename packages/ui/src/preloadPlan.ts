import type { CardDef } from '@game/core';
import { poolFor, SETS, type SetId } from '@game/content';
import { poolOf, type RunState } from '@game/sim';
import { ART_URL_GROUPS, artFor } from './art';
import { requestArtList } from './artPreload';
import type { Lane } from './assetQueue';

/**
 * THE PRELOAD PLAN — which art goes in which lane of the asset queue, and when (art pop-in fix, 2026-09-29).
 *
 *   boot  (`preloadBootArt`, from Boot): the card CHROME and the screen chrome a first shop shows (frames, plates,
 *         tier stars, shop buttons, board, cursors) and the title's mode tiles; then the enabled set's tier 1-2
 *         cards, the heroes + powers; then the rest of that set; then everything else, fetch-only.
 *   run   (`preloadRunArt`, from Game, whenever the run's set / tribes / tier change): the run's PINNED pool
 *         (`poolOf(run)` — never the live registry), cards up to one tier above the shop first.
 *   on screen: `useArtReady` raises anything rendered-but-not-ready to `now`.
 *
 * Boot has no run yet, so it warms the set(s) currently switched ON — a hint for the pipe, never run state:
 * a new run is created from exactly that set (`activeSet()` in `createRun`), and a resumed run on another set
 * is re-planned by `preloadRunArt` the moment it loads. Nothing here reads or writes the run.
 */

const BASE = import.meta.env.BASE_URL;

/**
 * Public images a title screen and a first shop show — the `chrome` lane, IN THIS ORDER (a remote player sees the
 * title first, then the shop, then a card in hand). Everything else public (gilded / higher milestone frames, cracked
 * gems, FX sprites, the crate) rides the `set` lane.
 */
const PUBLIC_CHROME_ORDER: readonly RegExp[] = [
  // 1. the title + menus
  /^(?:cursors\/|homescreen\.webp|frames\/title-logo|fx\/turn-glyph\.svg)/,
  // 2. the shop: board, card frames, tier stars, keyword medallions, the first stat-milestone disc, the shop
  //    buttons (every state they mount with, e.g. the cracked gem sits hidden in the DOM), the opponent rail
  /^(?:augustfullboard\.webp|opponents-backplate\.webp|opp-rune-slot-|medallions\/|frames\/(?:rune-|milestone-(?:atk|hp)-1\.|oval-(?!.*gilded)|taunt-(?!.*(?:gilded|shield))|spell-|tier-stars-|tierplate\.|desc-backbox|end_button|freeze_|refresh_button|tavernup_|heropowerbutton))/,
  // 3. a card in hand (the plate)
  /^frames\/cardplate/,
];
/** A per-tribe frame / plate file names its tribe: `oval-beast.webp`, `taunt-kobold-gilded.webp`, `cardplate-dwarf.webp`. */
const TRIBE_FILE = /^frames\/(?:oval|taunt|cardplate)-([a-z]+)/;

/**
 * Split the build's public-art list into the chrome lane (ordered title → shop → hand) and the rest. A per-tribe
 * frame for a tribe no live set uses (`tribes`) is not chrome: it can only appear later, if at all.
 * Exported for its test.
 */
export function splitPublicArt(
  list: readonly string[],
  tribes?: ReadonlySet<string>,
): { chrome: string[]; title: string[]; play: string[]; rest: string[] } {
  const groups: string[][] = PUBLIC_CHROME_ORDER.map(() => []);
  const rest: string[] = [];
  for (const p of list) {
    const tribe = TRIBE_FILE.exec(p)?.[1];
    const offTribe = !!(tribes && tribe && tribe !== 'wire' && !tribes.has(tribe));
    const g = offTribe ? -1 : PUBLIC_CHROME_ORDER.findIndex((re) => re.test(p));
    (g >= 0 ? groups[g]! : rest).push(`${BASE}${p}`);
  }
  return { chrome: groups.flat(), title: groups[0]!, play: groups.slice(1).flat(), rest };
}

/**
 * A pool's art in the order a run needs it: tier ascending (the shop only shows tiers up to the tavern's), cards
 * at or below `earlyTier` first. Deduped (tokens and Choose One cards can share art). Exported for its test.
 */
export function poolArtOrder(cards: readonly CardDef[], earlyTier: number): { early: string[]; rest: string[] } {
  const sorted = [...cards].sort((a, b) => a.tier - b.tier);
  const seen = new Set<string>();
  const early: string[] = [];
  const rest: string[] = [];
  for (const c of sorted) {
    const url = artFor(c.id);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    (c.tier <= earlyTier ? early : rest).push(url);
  }
  return { early, rest };
}

/** FX textures and portrait-frame art: bundled, not in `ART_URL_GROUPS`, loaded by their own modules on first use.
 *  Globbed here too (same hashed URLs — Vite dedupes the asset) so the HTTP cache is warm when they ask. Kept
 *  here rather than imported from `fx/imageLibrary.ts`, which would drag Pixi into the entry chunk. */
const EXTRA_ART: string[] = Object.values({
  ...(import.meta.glob('./fx/defs/images/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('./fx/defs/art/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('./art/frames/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
});

/** The handful of UI images imported straight from `src/` (the rules / compendium buttons, the hero-select portrait
 *  frame): on the title and in the shop from the first frame, so they ride the chrome lane. */
const UI_CHROME_ART: string[] = Object.values({
  ...(import.meta.glob('./*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('./hero-select/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
});

const vals = (r: Record<string, string>): string[] => Object.values(r);

let booted = false;
/** Queue everything, once, in lane order. Cheap: it only fills the queue (~1,400 Map inserts). */
export function preloadBootArt(): void {
  if (booted) return;
  booted = true;
  const live = (Object.keys(SETS) as SetId[]).filter((id) => SETS[id].enabled);
  const tribes = new Set<string>(['neutral', ...live.flatMap((id) => SETS[id].tribes)]);
  const pub = splitPublicArt(__PUBLIC_ART__, tribes);
  plan('chrome', pub.title); // the title screen itself: board-less backdrop, logo, cursors
  plan('chrome', UI_CHROME_ART);
  plan('chrome', vals(ART_URL_GROUPS.rank)); // the title's rank crest
  plan('chrome', vals(ART_URL_GROUPS.mode)); // the mode tiles: small, and the very next screen
  plan('chrome', pub.play); // then the shop and a card in hand
  // The live set's tier 1-2 cards BEFORE the heroes: the first shop needs them, while hero select only ever
  // shows three or four heroes, and those are raised to `now` by the screen itself (FadeImg).
  const setRest: string[] = [];
  for (const id of live) {
    const { early, rest } = poolArtOrder(poolFor(id).all, 2);
    plan('early', early);
    setRest.push(...rest);
  }
  plan('early', vals(ART_URL_GROUPS.hero));
  plan('early', vals(ART_URL_GROUPS.power));
  plan('set', setRest);
  plan('set', pub.rest);
  plan('set', vals(ART_URL_GROUPS.skin));
  plan('set', vals(ART_URL_GROUPS.equipment));
  plan('set', EXTRA_ART);
  // The long tail — other sets, runes, quests, Ancients: fetched (HTTP cache) but not decoded or held.
  for (const g of ['minion', 'spell', 'rune', 'quest', 'ancient'] as const) plan('idle', vals(ART_URL_GROUPS[g]));
}

let lastRunKey = '';
/** The run's pinned pool, up to one tier past the tavern first. Re-plans only when set / tribes / tier move. */
export function preloadRunArt(run: Pick<RunState, 'setId' | 'tier'> & Partial<Pick<RunState, 'tribes' | 'practiceConfig'>>): void {
  const earlyTier = Math.max(2, (run.tier ?? 1) + 1);
  const key = `${run.setId ?? 'set1'}|${(run.tribes ?? []).join(',')}|${earlyTier}`;
  if (key === lastRunKey) return;
  lastRunKey = key;
  const { early, rest } = poolArtOrder(poolOf(run).all, earlyTier);
  plan('early', early);
  plan('set', rest);
}

function plan(lane: Lane, urls: readonly string[]): void {
  requestArtList(urls, lane);
}

/** Test hook: forget the once-only guards. */
export function __resetPreloadPlan(): void {
  booted = false;
  lastRunKey = '';
}
