# 2026-10-01 — Portrait frames: 13 crate rings that replace the default portrait ring

Owner ask: "we're adding portrait skins: C:\Game Assets\Ascent Art\Skins\Portraits. we want this to replace the default
portrait png when a skin is applied." Owner decision: all 13 frames drop from crates at their folder's rarity, the
rank-named ones included.

## What shipped

- **Catalog** (`packages/progression/src/cosmetics.ts`): a new `portrait_frame` category ("Portrait Frames", weight 10,
  enabled, target `global`) and 13 crate items. Rarities come from the folders:

  | id | name | rarity | master |
  |---|---|---|---|
  | frame_bronze | Burnished Frame | Rare | Rare/BronzeFrame.png |
  | frame_silver | Sterling Frame | Rare | Rare/SilverFrame.png |
  | frame_gold | Gilded Frame | Rare | Rare/GoldFrame.png |
  | frame_platinum | Seaglass Frame | Rare | Rare/PlatinumFrame.png |
  | frame_ascendant | Amethyst Frame | Epic | Epic/Ascendant.png |
  | frame_dark_diamond | Shard Frame | Epic | Epic/DarkDiamond.png |
  | frame_diamond | Prism Frame | Epic | Epic/DiamondFrame.png |
  | frame_ice | Frost Frame | Epic | Epic/Ice.png |
  | frame_pearlescent | Pearlescent Frame | Epic | Epic/Pearlescent.png |
  | frame_rank1 | Crimson Frame | Epic | Epic/Rank1Frame.png |
  | frame_fire | Fire Frame | Legendary | Legendary/Fire.png |
  | frame_reaper | Reaper Frame | Legendary | Legendary/Reaper.png |
  | frame_water | Water Frame | Legendary | Legendary/Water.png |

  **Naming call (flagged for the owner):** the player-text rule bans the ranked medal words (Bronze, Silver, Gold,
  Platinum, Diamond, Ascendant) in EVERY cosmetic name. That rule is meant to keep crate rewards from reading as
  Ranked rewards, and a crate frame called "Gold Frame" or "Rank 1 Frame" would read exactly like one. So I kept the
  rule and renamed by look ("Gilded", "Crimson", ...). The ids keep the master names (permanent, never shown).
  Renaming a frame is a one-line `name` change.
- **Crate odds** after this: Common 17, Rare 44, Epic 32, Legendary 23 items. Each Rare is now 0.682%, each Epic
  0.469% and each Legendary 0.217% (fixed 50/30/15/5 rarity odds, equal chance within a rarity). Frames are about 6.2%
  of a first crate.
- **Art**: `npm run art:frames` (`packages/tools/src/wire-portrait-frames.ts`) reads the catalog's `assets.master`,
  writes `packages/ui/src/art/frames/skins/<id>.webp` (fit inside 768 px, the tuner frames' size) and MEASURES each
  ring's hole off the alpha channel into `packages/ui/src/portraitFrame/frameSkins.data.json`. It casts 720 rays from
  the centre to the first opaque pixel, re-centres on the boundary centroid 4 times, and uses the 75th-percentile ray
  as the radius. On the 2026-09-29 tuner frames this reproduces the hand-measured values (bronze 0.840 vs 0.840, gold
  0.8385 vs 0.839).
- **Equip**: `equip_cosmetic` accepts the account-wide `portrait_frame` slot (target `''`, null = the default ring),
  with the same checks as the hero attack. `GLOBAL_EQUIP_SLOTS` in TS and the SQL's `p_slot in (...)` lists are pinned
  equal by `sqlParity.test.ts`.
- **Rendering**: `usePortraitFrame(side, frameId)`. With `undefined` and `self` it uses your live loadout's frame; a
  string means that frame; `null` means no cosmetic frame. A frame cosmetic wins over the dev tuner's choice. In-run
  surfaces pass the frame recorded on the run (`run.cosmetics.portraitFrame`, like a hero skin). Opponent surfaces
  pass `frameIdOf(opponentSkins(show, snapshot))`, so "Show opponent cosmetics" off gives the default ring. The run
  snapshot carries the frame on every captured board (`scopeCosmetics`), every pool run (`runCosmetics` union) and
  every lobby seat.
- **In-game socket** (owner reports on the first builds: "it overlaps and doesnt seem to replace the existing?", then
  "why did the art get biffed here"). The in-game portrait's copper rim and dish are baked into the board art
  (`augustfullboard.webp` and the combat variant), not CSS. Two looks were tried:
  - A flat play-mat-coloured disc covering the socket. Reverted: it showed as a purple halo that never matched the
    board's lighting.
  - The frame SEATED INSIDE the socket, over its inner rim, with the dish framing it like a bezel. Shipped as the
    cleaner one.
  The hero art's crop and scale were never changed. Truly removing the socket needs a board image without it, which is
  owner art. Every other surface drops its CSS ring under `.pf-on`.
- **Collection**: a Portrait Frames tab. Ring tiles are blurred and locked until owned. An owned frame previews
  around your avatar; an unowned one shows only the blurred ring ("do not allow preview if you do not own the art").
  Equip and "Use default frame" are there, the latter previewing the default ring at once.
- **DEV test path** (owner: "put a test frame in the collections, and set it to the gold one"). In the Crate opening
  tuner, "Dev: grant Gilded frame" / "Dev: clear frame grants" grant the frame on this client only
  (`ascent.dev.portraitFrames` in localStorage, laid over the mirror in memory). `equipCosmetic` equips a dev-granted
  frame locally and never calls the server. Gated on `import.meta.env.DEV`.
- Oracle R-PROG-FRAME-01..03; GAME-RULES "Portrait frames"; a patch note.

## OWNER RUNBOOK (in this order)

1. **SQL**: paste `supabase/migrations/2026-10-01-portrait-frames.sql` into the Supabase SQL Editor and Run. It is
   idempotent and only replaces `equip_cosmetic`, writing no rows. (It supersedes the equip function in the hero attack
   file; if that file or the skins file is ever re-run, run this one again after it.)
2. **Deploy** the `progression-inventory` Edge Function (`supabase functions deploy progression-inventory`). Its first
   request syncs the catalog, which adds the `portrait_frame` category and the 13 frames, and they join the crate pool.
3. **Verify** (anon REST):
   - `GET /rest/v1/cosmetic_categories?category=eq.portrait_frame&select=enabled,target` returns
     `[{"enabled":true,"target":"global"}]`.
   - `GET /rest/v1/cosmetic_catalog?category=eq.portrait_frame&select=cosmetic_id,rarity` returns 13 rows.
   - In game, open a crate or use an owned frame: Collection > Portrait Frames > Equip, then check your Title portrait.

Before step 1 the client already works. The tab shows, and Equip on a real (non-dev) frame fails with "Could not
change your portrait frame" without changing anything. Frames drop only after step 2.

## Verification

Typecheck, lint, test and build:web are green. In a browser on :5207 (a clean profile, the dev grant): Collection
equip, the Title ring, the in-game StatusBar portrait (frame seated in the board socket, at 1920x1080), and the lobby rail opponent
seats wearing their recorded Fire / Water frames.
