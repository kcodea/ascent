import type { CardDef } from '@game/core';
import { CARD_INDEX, poolFor, RUNE_INDEX, SETS, type SetId } from '@game/content';
import { poolOf, type RunState } from '@game/sim';
import { ART_URL_GROUPS, artFor } from './art';
import { ART_ALIAS } from './artAlias';
import { requestArtList } from './artPreload';
import type { Lane } from './assetQueue';

/**
 * THE PRELOAD PLAN — which art goes in which lane of the asset queue, and when (art pop-in fix, 2026-09-29; the
 * boot LOADING GATE, 2026-09-30).
 *
 *   boot  (`preloadBootArt`, from Boot): EVERYTHING a session on the live set can show, in lane order (the card and
 *         screen chrome, the live set's tier 1-2 cards, heroes + powers, then the rest of the set, every token,
 *         runes, quests, skins, equipment, Ancients, FX images). It RETURNS that list: Boot holds the splash
 *         until every one of them is decoded (owner 2026-09-30: "i think id rather load everything. i dont want
 *         blurry images, i wanna stop pop in."). Behind the gate, in `idle`: the cards and runes that belong
 *         ONLY to sets nobody can play right now (the Collection's set picker can still show them).
 *   run   (`preloadRunArt`, from Game, whenever the run's set / tribes / tier change): the run's PINNED pool
 *         (`poolOf(run)` — never the live registry), cards up to one tier above the shop first.
 *   on screen: `useArtReady` raises anything rendered-but-not-ready to `now` (a safety net; after the gate it
 *         should never be needed).
 *
 * Boot has no run yet, so it gates on the set(s) switched ON plus the set of the saved run it will resume (the
 * caller passes it): a hint for the pipe, never run state. A new run is created from exactly the enabled set
 * (`activeSet()` in `createRun`). Nothing here reads or writes the run.
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

/**
 * Split the bundled card art (minion + spell folders) into what a session on `gated` sets can show and what only
 * the OTHER sets can. A file is keyed by card id, or `<id><N>` for a Choose One branch / variant (`shaper2`,
 * `pup2`). It is "other only" when its card sits in some set's pool and in none of the gated ones. Everything else
 * is gated: every token, Ruby, gift and generated card lives in NO pool (shared by all sets), so it is always in;
 * an art key the plan cannot place is in too (never under-load). Art another card borrows through `ART_ALIAS`
 * follows the borrower. Exported for its test.
 */
export function splitCardArt(gated: ReadonlySet<SetId>): { gated: string[]; other: string[] } {
  const owners = new Map<string, SetId[]>();
  for (const id of Object.keys(SETS) as SetId[]) {
    for (const c of poolFor(id).all) {
      const o = owners.get(c.id);
      if (o) { if (!o.includes(id)) o.push(id); } else owners.set(c.id, [id]);
    }
  }
  const inGate = (cardId: string): boolean => {
    const o = owners.get(cardId);
    return !o || o.some((id) => gated.has(id));
  };
  const baseOf = (key: string): string => {
    if (CARD_INDEX[key]) return key;
    const stripped = key.replace(/\d+$/, '');
    return CARD_INDEX[stripped] ? stripped : key;
  };
  const borrowed = new Set<string>();
  for (const [cardId, target] of Object.entries(ART_ALIAS)) if (inGate(cardId)) borrowed.add(target);
  const g: string[] = [];
  const other: string[] = [];
  for (const group of [ART_URL_GROUPS.minion, ART_URL_GROUPS.spell]) {
    for (const [key, url] of Object.entries(group)) (inGate(baseOf(key)) || borrowed.has(key) ? g : other).push(url);
  }
  return { gated: g, other };
}

/** Rune art: a rune whose `sets` names none of the gated sets can only show in the other sets. A file with no rune
 *  of that id (an archived or renamed rune an old board may still carry) is gated. Exported for its test. */
export function splitRuneArt(gated: ReadonlySet<SetId>): { gated: string[]; other: string[] } {
  const g: string[] = [];
  const other: string[] = [];
  for (const [id, url] of Object.entries(ART_URL_GROUPS.rune)) {
    const sets = RUNE_INDEX[id]?.sets;
    (!sets || sets.some((s) => gated.has(s as SetId)) ? g : other).push(url);
  }
  return { gated: g, other };
}

let bootGate: string[] | null = null;
/**
 * Queue everything, once, in lane order, and return the GATE: every URL Boot must see decoded before the menu opens
 * (deduped, in queue order). `extraSets` = the saved run's set when it is not the live one. Cheap: it only fills
 * the queue (~1,400 Map inserts); a second call returns the same list.
 */
export function preloadBootArt(extraSets: readonly SetId[] = []): string[] {
  if (bootGate) return bootGate;
  const live = (Object.keys(SETS) as SetId[]).filter((id) => SETS[id].enabled);
  const gatedSets = new Set<SetId>([...live, ...extraSets.filter((id) => id in SETS)]);
  const pub = splitPublicArt(__PUBLIC_ART__);
  const gate: string[] = [];
  const add = (lane: Lane, urls: readonly string[]): void => { plan(lane, urls); gate.push(...urls); };
  add('chrome', pub.title); // the title screen itself: board-less backdrop, logo, cursors
  add('chrome', UI_CHROME_ART);
  add('chrome', vals(ART_URL_GROUPS.rank)); // the title's rank crest
  add('chrome', vals(ART_URL_GROUPS.mode)); // the mode tiles
  add('chrome', pub.play); // then the shop and a card in hand
  const setRest: string[] = [];
  for (const id of gatedSets) {
    const { early, rest } = poolArtOrder(poolFor(id).all, 2);
    add('early', early);
    setRest.push(...rest);
  }
  add('early', vals(ART_URL_GROUPS.hero));
  add('early', vals(ART_URL_GROUPS.power));
  add('set', setRest);
  const cards = splitCardArt(gatedSets);
  add('set', cards.gated); // tokens, Rubies, gifts, Choose One branches (the pool's own art is already queued)
  add('set', pub.rest);
  add('set', vals(ART_URL_GROUPS.skin));
  add('set', vals(ART_URL_GROUPS.equipment));
  add('set', EXTRA_ART);
  add('set', vals(ART_URL_GROUPS.quest));
  const runes = splitRuneArt(gatedSets);
  add('set', runes.gated);
  add('set', vals(ART_URL_GROUPS.ancient));
  // Behind the gate: cards and runes only a set nobody can play right now can show (the Collection's set picker).
  plan('idle', cards.other);
  plan('idle', runes.other);
  bootGate = [...new Set(gate)];
  return bootGate;
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
  bootGate = null;
  lastRunKey = '';
}
