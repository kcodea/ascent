/// <reference types="vite/client" />

/**
 * Per-card illustrated art. Drop a PNG named by the card id into
 * `packages/ui/src/art/minions/<id>.png` (e.g. `whelp.png`) and it's picked up at build time — the
 * Card renders it in place of the pixel sprite. Recommended master: 512×512+, transparent background,
 * subject centred with a little margin. Run `npm run optimize-art` to downscale + convert to WebP
 * (the in-repo build copy becomes `<id>.webp`; the high-res master stays under `C:\Game Assets\Ascent Art\`).
 * The globs below accept both `.png` and `.webp`, preferring WebP — so a freshly-dropped PNG shows up
 * immediately, and the optimizer can convert it later without any rewiring.
 *
 * NB: `import.meta.glob`'s options MUST be an inline object literal — Vite analyses the call statically,
 * so a shared/hoisted options variable fails the build with "Invalid glob import syntax".
 */
type ArtModules = Record<string, string>;

/** Build an id → url map from a glob, preferring the `.webp` build copy when both formats exist. */
function indexArt(modules: ArtModules): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    const id = path.split('/').pop()?.replace(/\.(png|webp)$/, '') ?? '';
    if (id && (!out[id] || path.endsWith('.webp'))) out[id] = url;
  }
  return out;
}

const MINION_ART = indexArt(
  import.meta.glob('./art/minions/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);

/** Small deterministic string hash — picks a stable art variant per minion instance. */
const hashStr = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** Art-file aliases: a card id → a different art filename. Lets us ship updated art under a new name without
 *  renaming the card. Now EMPTY — the full art refresh (2026-06-26) names every master by card id, so the old
 *  aliases (heckbinder2 / combinator2 / guel2 / demonanomaly2 / goldfont / goldpouch — all pre-refresh art)
 *  were retired and their stale files deleted; the mechanism stays for future one-off art swaps. */
const ART_ALIAS: Record<string, string> = {};

/** SPELL + Ruby art — same contract as minions, in its own directory so the two sets stay easy to manage:
 *  drop a PNG named by the CARD ID into `packages/ui/src/art/spells/<id>.png`. Wired 2026-07-24 (owner).
 *  Card ids are globally unique, so `artFor` can simply fall through from minions to here — no caller changes,
 *  and a spell picks up art exactly the way a minion already does. */
const SPELL_ART = indexArt(
  import.meta.glob('./art/spells/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);

/** The illustrated art URL for a card id, or undefined if none has been added. `uid` lets cards
 *  with multiple art variants pick one per instance (stable across re-renders, ~50/50 split). */
/**
 * The key a card's art is FRAMED under — the card id, or `<id><N+1>` when a resolved Choose One is wearing a
 * branch illustration that actually exists.
 *
 * Framing is per IMAGE, not per card: the base art and a branch's art are different pictures and rarely want
 * the same zoom and offset. Keying the override on the card id alone meant Coppercoat Spellsword's second
 * option inherited the base art's crop, with no way to dial it (owner ask 2026-08-28). A branch with no entry
 * of its own still falls back to the card's, so nothing changes for the cards that never needed this.
 */
export const artVariantKey = (cardId: string, chosenOption?: number): string => {
  if (chosenOption === undefined || chosenOption <= 0) return cardId;
  const key = `${cardId}${chosenOption + 1}`;
  return MINION_ART[key] ?? SPELL_ART[key] ? key : cardId;
};

export const artFor = (cardId?: string, uid?: string, chosenOption?: number): string | undefined => {
  if (!cardId) return undefined;
  // CHOOSE ONE: a resolved instance wears the art of the branch it BECAME (owner 2026-07-25). Option 0 keeps
  // the base file and option N looks for `<id><N+1>` — so Wildwood Shaper's Stray branch (option index 1) is
  // `shaper2`, matching the master's `WildwoodShaper2.png`. Numbering the file after the option's POSITION,
  // rather than adding a per-branch id, means new art is a drag-and-drop with no code change.
  //
  // Falls through to the base art when the variant hasn't been drawn yet, so a Choose One card with only one
  // illustration still renders — every existing one does, which is why this is a fallback and not a lookup.
  if (chosenOption !== undefined && chosenOption > 0) {
    const key = `${cardId}${chosenOption + 1}`;
    const variant = MINION_ART[key] ?? SPELL_ART[key];
    if (variant) return variant;
  }
  // Pup ships two variants (pup / pup2) — flip a coin per spawn (by uid) for a little flavor.
  if (cardId === 'pup' && MINION_ART.pup2 && uid) {
    return hashStr(uid) % 2 === 0 ? MINION_ART.pup : MINION_ART.pup2;
  }
  const alias = ART_ALIAS[cardId];
  if (alias && MINION_ART[alias]) return MINION_ART[alias];
  // Minions first, then spells/Rubies. Ids are globally unique, so a card should only ever live in ONE of the
  // two directories and the order shouldn't matter. When it does matter, something is misfiled — a spell's art
  // sitting in `minions/` silently wins and the spells/ copy never renders. That's exactly what happened when
  // spell art was first wired (2026-07-24): 38 spells already had an older master misfiled under minions/, so
  // most of the new art was shadowed. The dev-only warning below turns that from an invisible bug into a
  // console message; the fix is always to delete the misfiled copy, not to reorder these.
  if (import.meta.env.DEV && MINION_ART[cardId] && SPELL_ART[cardId]) {
    console.warn(`[art] "${cardId}" has art in BOTH minions/ and spells/ — the minions/ copy wins and the spells/ one is dead. Delete whichever is misfiled.`);
  }
  return MINION_ART[cardId] ?? SPELL_ART[cardId];
};

/** Hero portraits — drop a PNG into `packages/ui/src/art/heroes/<id>.png` (e.g. `warden.png`). */
const HERO_ART = indexArt(
  import.meta.glob('./art/heroes/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
export const heroArt = (name: string): string | undefined => HERO_ART[name];

/** Hero-POWER button art — drop a PNG into `packages/ui/src/art/powers/<heroId>.png` (e.g. `warden.png`).
 *  The button is a circle (object-fit: cover), so use a square master with the subject centred. Falls back
 *  to the placeholder glyph when absent. */
const POWER_ART = indexArt(
  import.meta.glob('./art/powers/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
export const heroPowerArt = (heroId: string): string | undefined => POWER_ART[heroId];

/** Quest art — drop a PNG into `packages/ui/src/art/quests/<questId>.png` (e.g. `q_grave_toll.png`), keyed by
 *  the quest id like minion art is keyed by cardId. Absent = the quest card falls back to its textless look.
 *  (First file into a previously-empty folder needs one dev-server restart; see the minions README.) */
const QUEST_ART = indexArt(
  import.meta.glob('./art/quests/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
// The two hero-quest variant FAMILIES (Opening Act / Resonant Path) are three quests wearing one name and
// one art. One shared file per family, found by stripping the variant suffix — three byte-identical copies
// would burn zip-file-count budget (the itch 1000-file cap tripwire) for nothing.
const QUEST_ART_ALIAS: Record<string, string> = {
  hq_opening_act_shout: 'hq_opening_act', hq_opening_act_echo: 'hq_opening_act', hq_opening_act_rally: 'hq_opening_act',
  hq_resonant_path_shout: 'hq_resonant_path', hq_resonant_path_echo: 'hq_resonant_path', hq_resonant_path_rally: 'hq_resonant_path',
};
export const questArt = (questId: string): string | undefined =>
  QUEST_ART[questId] ?? QUEST_ART[QUEST_ART_ALIAS[questId] ?? ''];

/** Rune art — drop a PNG/WEBP into `packages/ui/src/art/runes/<runeId>.png` (e.g. `rune_warding.png`), keyed by
 *  the rune id. Shown on the Runeforge rune card + its run-buff badge; absent = the sigil-glyph fallback. */
const RUNE_ART = indexArt(
  import.meta.glob('./art/runes/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
export const runeArt = (runeId: string): string | undefined => RUNE_ART[runeId];

/** MODE-picker tile art — drop a PNG into `packages/ui/src/art/modes/<modeId>.png`, keyed by the run mode
 *  (`lobby.png`, `practice.png`). The tile is a square (object-fit: cover), so use a square master. Absent =
 *  the per-mode gradient + emblem glyph the picker used before any art existed. NOT in `AVATAR_ART`: these are
 *  scene art, not a portrait anyone would pick as an avatar. */
const MODE_ART = indexArt(
  import.meta.glob('./art/modes/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
export const modeArt = (modeId: string): string | undefined => MODE_ART[modeId];

/** Avatar picker: every bundled art the player can choose as their profile avatar, namespaced by pool
 *  (`hero:<id>` / `minion:<cardId>` / `power:<heroId>`) so ids never collide across pools. `key` is the raw
 *  glob key (cardId / heroId), used to resolve a display name from CARD_INDEX / HEROES in the picker. */
export interface AvatarArt { id: string; src: string; kind: 'hero' | 'minion' | 'power'; key: string; }
export const AVATAR_ART: AvatarArt[] = [
  ...Object.entries(HERO_ART).map(([key, src]): AvatarArt => ({ id: `hero:${key}`, src, kind: 'hero', key })),
  ...Object.entries(MINION_ART).map(([key, src]): AvatarArt => ({ id: `minion:${key}`, src, kind: 'minion', key })),
  ...Object.entries(POWER_ART).map(([key, src]): AvatarArt => ({ id: `power:${key}`, src, kind: 'power', key })),
];
const AVATAR_SRC = new Map(AVATAR_ART.map((a) => [a.id, a.src] as const));
/** Resolve a stored avatar id (`kind:key`) to its art URL — undefined if unset or no longer bundled. */
export const avatarSrc = (id?: string | null): string | undefined => (id ? AVATAR_SRC.get(id) : undefined);

/** App-level public assets (served from `apps/web/public/` at the site root) that also pop in when loaded
 *  lazily: the board backdrops + title art (CSS `url()` / title <img>) and the custom drag cursors (a cursor
 *  swap flashes the default arrow until its SVG is fetched). They live outside the ui package's globs, so
 *  they're listed by URL — keep in sync with `styles.css` `url()` refs + `apps/web/public/`. */
// BASE_URL-relative (not root-absolute): itch serves the game from a CDN sub-path, where '/x.webp' 404s and the
// warm-up silently skipped these (BASE_URL is '/' in dev, './' in the build — resolved against index.html).
const PUBLIC_ART_URLS: string[] = [
  `${import.meta.env.BASE_URL}augustfullboard.webp`, // the board (all resolutions; see styles.css --board)
  `${import.meta.env.BASE_URL}augustboardcombat.webp`, // the combat variant the wipe reveals — preloaded so the first wipe never uncovers a half-loaded image
  `${import.meta.env.BASE_URL}homescreen.webp`,
  `${import.meta.env.BASE_URL}runeforgebg2.webp`, // Runeforge overlay backdrop — preloaded so the forge doesn't open on an empty scrim

  `${import.meta.env.BASE_URL}cursors/gauntlet_default.svg`,
  `${import.meta.env.BASE_URL}cursors/gauntlet_open.svg`,
  `${import.meta.env.BASE_URL}cursors/hand_closed.svg`,
  // The end-of-turn charge glyph's SHAPE — used as a CSS mask on `.chargeglyph .masked` (and sampled by
  // chargeMotes). Preloaded because an unfetched mask means the layers paint UNMASKED for the first frame:
  // the fill's blue gradient flashed as a full RECTANGLE as the charge began (owner report). Cached at boot
  // → the mask applies on the glyph's first paint.
  `${import.meta.env.BASE_URL}fx/turn-glyph.svg`,
];

/** Every bundled art URL (minions + heroes + powers) + the public backdrops/cursors, deduped — the warm-up set. */
const ALL_ART_URLS: string[] = [
  ...new Set([...Object.values(MINION_ART), ...Object.values(HERO_ART), ...Object.values(POWER_ART), ...PUBLIC_ART_URLS]),
];

let warmed = false;
/** The preloader's Image objects, held for the session — dropping them lets the browser GC the elements and,
 *  with them, more eagerly evict the decoded bitmaps, re-introducing mid-run decode flashes on weaker devices. */
const KEEP_ALIVE: HTMLImageElement[] = [];
/**
 * Preload (fetch + decode) every bundled art file so cards render with their art already cached — no
 * "pop-in" a beat after the card frame on a cold load (the itch CDN especially: each webp is a separate
 * round-trip the first time its card appears). Idempotent and non-blocking: it kicks off detached `Image`
 * loads on idle (the browser fetches + decodes off the render path), so it never competes with first paint.
 * Call once the title / hero-select screen is up. Platform-independent — fixes the web + itch-embed build,
 * not just a future local/desktop wrap (which only removes the network half).
 */
export function warmArt(): void {
  if (warmed || typeof Image === 'undefined') return;
  warmed = true;
  const run = (): void => {
    for (const url of ALL_ART_URLS) {
      const img = new Image();
      KEEP_ALIVE.push(img); // same session-long hold as the blocking preloader
      img.decoding = 'async';
      img.src = url;
      // decode() pre-decodes off the main thread where supported; best-effort (ignore failures / abort).
      void img.decode?.().catch(() => {});
    }
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (typeof ric === 'function') ric(run);
  else setTimeout(run, 200);
}

/** Total number of bundled art files (minions + heroes + powers) — the denominator for a boot progress bar. */
export const ART_COUNT = ALL_ART_URLS.length;

/**
 * BLOCKING preload: fetch AND decode every bundled art file, resolving only once they're all cached (or have
 * individually failed / timed out). Unlike `warmArt` (fire-and-forget on idle), this is meant to gate a boot
 * loading screen so the game never renders a card before its art is decoded — no pop-in, guaranteed. Each image
 * has its own hard timeout so one stuck request can't hang the whole boot, and `onProgress(loaded, total)` fires
 * as each settles. Marks the warm-up done so a later `warmArt()` no-ops.
 */
export function preloadAllArt(onProgress?: (loaded: number, total: number) => void): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  warmed = true;
  const urls = ALL_ART_URLS;
  const total = urls.length;
  let loaded = 0;
  const one = (url: string): Promise<void> =>
    new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        loaded += 1;
        onProgress?.(loaded, total);
        resolve();
      };
      const img = new Image();
      KEEP_ALIVE.push(img); // hold the element for the session so its decoded bitmap isn't eagerly evicted
      img.decoding = 'async';
      // Resolve as soon as the bytes are cached (`onload`) — the network round-trip is what causes the pop-in.
      // Kick `decode()` in the background too (best-effort) so first paint is instant, but never GATE on it:
      // `decode()` can stall in a backgrounded/throttled tab, and onload is the reliable signal.
      img.onload = (): void => { void img.decode?.().catch(() => {}); done(); };
      img.onerror = done; // a missing/broken file shouldn't block the boot
      img.src = url;
      window.setTimeout(done, 12000); // safety: never hang on a stuck fetch
    });
  return Promise.all(urls.map(one)).then(() => undefined);
}
