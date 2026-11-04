import type { CardDef } from '@game/core';
import { CARD_INDEX, poolFor, RUNE_INDEX, SETS, type SetId } from '@game/content';
import { poolOf, type RunState } from '@game/sim';
import { ART_URL_GROUPS, artFor, heroThumb } from './art';
import { ART_ALIAS } from './artAlias';
import { requestArtList, requestHeldArtList, requestMaskArt } from './artPreload';
import { MECH_MEDALLION_MASK_ARTS } from './mechMedallion';
import { CARD_PLATE_LOOKS, cardPlateLookOf, plateLookUrls } from './cardPlate/cardPlateLook';
import { LITE_ART, phonePublicUrl } from './phoneArt';
import type { Lane } from './assetQueue';
import { crumb } from './crashLog';

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
  // 1. the title + menus (incl. the painted menu medallions, menu/)
  /^(?:cursors\/|homescreen\.webp|backdrops\/|menu\/|frames\/title-logo|fx\/crystal-fuse)/,
  // 2. the shop: board, card frames, tier stars, keyword medallions, the first stat-milestone disc, the shop
  //    buttons (every state they mount with, e.g. the cracked gem sits hidden in the DOM), the opponent rail
  /^(?:playingboard(?:-combat)?\.webp|opponents-backplate\.webp|(?:opp-)?rune-slot-|medallions\/|frames\/(?:rune-|milestone-(?:atk|hp)-1\.|oval-(?!.*gilded)|taunt-(?!.*(?:gilded|shield))|spell-|tier-stars-|tierplate\.|desc-backbox|end_button|freeze_|refresh_button|tavernup_|heropowerbutton))/,
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
    (g >= 0 ? groups[g]! : rest).push(phonePublicUrl(p, BASE));
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

/** FX textures, portrait frames (and their SKINS), emote bubbles, ping icons and the Versus arena: bundled, not in
 *  `ART_URL_GROUPS`, loaded by their own modules on first use. Globbed here too (same hashed URLs: Vite dedupes the
 *  asset) so they are decoded when asked for. Kept here rather than imported from `fx/imageLibrary.ts`, which would drag
 *  Pixi into the entry chunk. The frame skins, emotes, pings and arena were missing until 2026-11-04: a player who OWNS
 *  cosmetics paid a cold load on every one (R-PERF-ART-PLAN-COMPLETE-01). `artPlanCoverage.test.ts` fails on any image
 *  file under `src/` that reaches neither this plan nor its exempt list. */
const EXTRA_ART: string[] = Object.values({
  ...(import.meta.glob('./fx/defs/images/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('./fx/defs/art/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('./art/frames/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('./art/frames/skins/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('./art/emotes/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob(['./art/pings/*.webp', '!./art/pings/inspect.webp'], { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('./art/versus/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  // The party home's painted ornaments (DEV-only prototype: production draws none of it, so it preloads none).
  ...(import.meta.env.DEV ? import.meta.glob('./partyHome/ornaments/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string> : {}),
});

/** Every public image a stylesheet draws as a `mask` (`artPlanCoverage.test.ts` checks the list against styles.css). */
export const PUBLIC_MASK_ART: readonly string[] = [
  'frames/standard-oval-v2.png', 'frames/spell-frame-arch.webp', 'frames/taunt-shield.png', 'frames/spell-art-window-arch.webp',
  'frames/ranked-gate-crystal.webp', 'frames/cardplate-wire.webp', 'fx/ward-hexsphere.svg',
];

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
 *
 * ON A PHONE (`lite`, owner 2026-10-18: the full gate was an 83 s first load and the decoded art crashed the tab) the
 * gate is the TITLE + MENU art only, and everything else streams in behind it, in the order a player meets it: hero
 * select (portraits + powers), then the shop (board, card frames, buttons) with the live set's tier 1-2 cards, then
 * the rest. Cards that only another set can show are not fetched at all on a phone. Desktop is unchanged.
 */
export function preloadBootArt(extraSets: readonly SetId[] = [], lite: boolean = LITE_ART): string[] {
  if (bootGate) return bootGate;
  if (lite) return (bootGate = preloadBootArtLite(extraSets));
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
  // Card plates (a cosmetic, ~250 files, ~1 GB decoded). The source builds their names from a constant, so the public
  // list never saw them and the plate a player WEARS was a cold load on every hand card (R-PERF-ART-PLAN-COMPLETE-01).
  // Behind the gate, not in it: most of them are other people's. The worn one is raised by `preloadRunArt`.
  requestHeldArtList(Object.values(CARD_PLATE_LOOKS).flatMap(plateLookUrls), 'idle');
  // The CORS copies of every mask (requestMaskArt): keys of their own, not in the gate's count, first thing behind it.
  for (const p of [...PUBLIC_MASK_ART, ...MECH_MEDALLION_MASK_ARTS.map((a) => `medallions/${a}.webp`)]) requestMaskArt(`${BASE}${p}`, 'set');
  bootGate = [...new Set(gate)];
  return bootGate;
}

/** The phone plan (see `preloadBootArt`). Returns the gate: the title chrome only. */
function preloadBootArtLite(extraSets: readonly SetId[]): string[] {
  const live = (Object.keys(SETS) as SetId[]).filter((id) => SETS[id].enabled);
  const gatedSets = new Set<SetId>([...live, ...extraSets.filter((id) => id in SETS)]);
  const pub = splitPublicArt(__PUBLIC_ART__);
  const gate: string[] = [];
  const add = (lane: Lane, urls: readonly string[]): void => { plan(lane, urls); gate.push(...urls); };
  add('chrome', pub.title);
  add('chrome', UI_CHROME_ART);
  add('chrome', vals(ART_URL_GROUPS.rank));
  add('chrome', vals(ART_URL_GROUPS.mode));
  // Behind the gate, in the order a player gets to them. Queued only once the gate has opened
  // (`startBackgroundArt`): on a phone's line every byte spent on them would slow the title down.
  liteRest = () => streamLiteRest(gatedSets, pub);
  return [...new Set(gate)];
}

let liteRest: (() => void) | null = null;
/** A phone's background stream, queued once the boot gate has opened (Boot.tsx). A no-op on desktop (its plan queued
 *  everything up front) and on every call after the first. */
export function startBackgroundArt(): void {
  const go = liteRest;
  liteRest = null;
  go?.();
}

function streamLiteRest(gatedSets: ReadonlySet<SetId>, pub: ReturnType<typeof splitPublicArt>): void {
  crumb('art stream start');
  plan('early', vals(ART_URL_GROUPS.hero));
  // The lobby rail's hero thumbnails (R-PHONE-HERO-SHARP-01): ~4 KB each, so the rail's faces are in the cache when
  // the first Shop opens.
  plan('early', vals(ART_URL_GROUPS.hero).flatMap((u) => { const t = heroThumb(u); return t && t !== u ? [t] : []; }));
  plan('early', vals(ART_URL_GROUPS.power));
  plan('early', pub.play);
  const setRest: string[] = [];
  for (const id of gatedSets) {
    const { early, rest } = poolArtOrder(poolFor(id).all, 2);
    plan('early', early);
    setRest.push(...rest);
  }
  plan('set', setRest);
  plan('set', splitCardArt(gatedSets).gated);
  plan('set', pub.rest);
  plan('set', vals(ART_URL_GROUPS.equipment));
  plan('set', vals(ART_URL_GROUPS.quest));
  plan('set', splitRuneArt(gatedSets).gated);
  plan('set', vals(ART_URL_GROUPS.ancient));
  // Skins and FX images: lowest, they show only when owned / played. Other sets' cards: never prefetched on a phone.
  plan('idle', vals(ART_URL_GROUPS.skin));
  plan('idle', EXTRA_ART);
}

let lastRunKey = '';
/** The run's pinned pool, up to one tier past the tavern first. Re-plans only when set / tribes / tier move. */
export function preloadRunArt(run: Pick<RunState, 'setId' | 'tier'> & Partial<Pick<RunState, 'tribes' | 'practiceConfig' | 'cosmetics'>>): void {
  // The plate this run wears, ahead of everything: every card in hand draws it (a phone fetches it here, too).
  const plate = cardPlateLookOf(run.cosmetics);
  if (plate) plan('early', plateLookUrls(plate));
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
  liteRest = null;
  lastRunKey = '';
}
