/// <reference types="vite/client" />
import { ART_ALIAS } from './artAlias';

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


/** SPELL + Ruby art — same contract as minions, in its own directory so the two sets stay easy to manage:
 *  drop a PNG named by the CARD ID into `packages/ui/src/art/spells/<id>.png`. Wired 2026-07-24 (owner).
 *  Card ids are globally unique, so `artFor` can simply fall through from minions to here — no caller changes,
 *  and a spell picks up art exactly the way a minion already does. */
const SPELL_ART = indexArt(
  import.meta.glob('./art/spells/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);

/**
 * EQUIPMENT icons (owner handoff 2026-08-28) — its own glob, keyed by EQUIPMENT id. Deliberately separate
 * from the minion and spell indexes: an Equipment is granted by a card but is not one, and sharing a folder
 * would let a Bloodpot icon shadow a card that happened to share its id.
 */
const EQUIPMENT_ART = indexArt(
  import.meta.glob('./art/equipment/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);

/** The icon for an Equipment, or undefined — the button falls back to its glyph, as it did before any art. */
export const equipmentArtFor = (equipmentId?: string): string | undefined =>
  (equipmentId ? EQUIPMENT_ART[equipmentId] : undefined);

/**
 * The illustration for one BRANCH of an Equipment's Choose One — `<equipmentId><N+1>`, so Prismatic Pick's
 * two options are `prismatic_pick1` and `prismatic_pick2`.
 *
 * Deliberately NOT the card convention (`artVariantKey`, where option 0 keeps the BASE file and only option
 * N ≥ 1 gets a numbered one). A card's base art is the card itself, and its first branch is that same
 * picture; an Equipment's base art is its ICON — a tool on a button — which is not what either branch should
 * look like. So every branch is numbered, and the icon is only the fallback for a branch not yet drawn.
 */
export const equipmentBranchArtFor = (equipmentId: string, index: number): string | undefined =>
  EQUIPMENT_ART[`${equipmentId}${index + 1}`] ?? EQUIPMENT_ART[equipmentId];

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

/** SKIN art (skins v1, owner 2026-09-28) — `packages/ui/src/art/skins/<cosmeticId>.webp`, keyed by the catalog item's
 *  `assets.art`. Wired by `npm run art:wire -- --only=skins` from `C:/Game Assets/Ascent Art/Skins/`. Never read
 *  directly by a renderer: `skins/skins.tsx` resolves a skin (live, right target) and falls back to `heroArt` /
 *  `artFor` when the file is missing, so a lost file can never blank a portrait or block a match. */
const SKIN_ART = indexArt(
  import.meta.glob('./art/skins/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
export const skinArt = (key: string | undefined): string | undefined => (key ? SKIN_ART[key] : undefined);
/** Every skin art key in the bundle (the CI check that no live skin ships without its art). */
export const skinArtKeys = (): string[] => Object.keys(SKIN_ART);

/** Hero-POWER button art — drop a PNG into `packages/ui/src/art/powers/<heroId>.png` (e.g. `warden.png`).
 *  The button is a circle (object-fit: cover), so use a square master with the subject centred. Falls back
 *  to the placeholder glyph when absent. */
const POWER_ART = indexArt(
  import.meta.glob('./art/powers/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
export const heroPowerArt = (heroId: string): string | undefined => POWER_ART[heroId];

/** ANCIENTS art (proof of concept, owner 2026-09-25) — `packages/ui/src/art/ancients/<ancientId>.webp` is the full
 *  art (offer + preview cards) and `<ancientId>_power.webp` the hero-power-button art revealed through the crack in
 *  the split power. Masters stay under `C:\Game Assets\Ascent Art\Ancients\` (+ `HeroPower\`). An Ancient with no
 *  file keeps its placeholder emblem. */
const ANCIENT_ART = indexArt(
  import.meta.glob('./art/ancients/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
export const ancientArt = (id: string): string | undefined => ANCIENT_ART[id];
export const ancientPowerArt = (id: string): string | undefined => ANCIENT_ART[`${id}_power`];

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

/** MEDAL CRESTS (2026-09-20) — one square master per medal (`ranks/<medal>.webp`, lower-case: `gold.webp`),
 *  composited inside the circular hero frame by `RankCrest`; the division numeral is a plate on the frame,
 *  not a separate painting. Keyed by the lower-cased medal name. Preloaded with the rest of the art so the
 *  post-game screen never pops its crest in. */
const RANK_ART = indexArt(
  import.meta.glob('./art/ranks/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
export const rankArt = (medal: string): string | undefined => RANK_ART[medal.toLowerCase()];

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

/**
 * Every bundled art index by kind — the preload plan (`preloadPlan.ts`) orders these into lanes. Public-folder
 * images (boards, frames, cursors, medallions) are NOT here: they are listed at build time as `__PUBLIC_ART__`
 * (`apps/web/publicArt.ts`), because `import.meta.glob` cannot see `apps/web/public/`.
 *
 * The old `warmArt` / `preloadAllArt` pair lived here until 2026-09-29: it fired ~650 image requests at once in
 * alphabetical order (plus the whole audio bank on the first click), so on a remote connection the card in the
 * shop waited behind every other file for its bytes, and spells, runes, quests, card frames and mode tiles were
 * never warmed at all. See `artPreload.ts` and docs/devlog/2026-09-29-art-pop-in.md.
 */
export const ART_URL_GROUPS = {
  minion: MINION_ART, spell: SPELL_ART, hero: HERO_ART, power: POWER_ART, skin: SKIN_ART, equipment: EQUIPMENT_ART,
  ancient: ANCIENT_ART, quest: QUEST_ART, rune: RUNE_ART, mode: MODE_ART, rank: RANK_ART,
} as const satisfies Record<string, Record<string, string>>;
