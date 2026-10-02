# 2026-10-02 — The Ancient rarity: 3% drops, "Prismatic Aurora", "Time stops", six frames, four items moved up

Owner: "i added a new rarity -> Ancient. can you wire that up so we can have skins that are of ancient rarity? these
will be a 3% drop rate". The confirmed odds are Common 35, Rare 31, Epic 22, Legendary 9, Ancient 3 (were 50/30/15/5).
Stacked on `feat/frames-batch-6` (#1901).

## Owner runbook (in this order)

1. **Run `supabase/migrations/2026-10-02-ancient-rarity.sql`** in the Supabase SQL Editor (also appended verbatim to
   `schema.sql`). It is idempotent and writes no rows: it re-creates the `cosmetic_catalog` rarity check with
   `'ancient'`, and replaces `progression_crate_pick` (five rarities, 35/31/22/9/3) and `open_crate` (roll version 4).
   It touches neither `boards` nor `pool_runs`.
2. **Then deploy `progression-inventory`.** Its catalog sync writes the Ancient rows. Deploying first would make the
   sync fail on the old four-rarity check, so the SQL must go first.

Verify with an anon REST probe: `cosmetic_catalog?select=cosmetic_id,rarity&rarity=eq.ancient` should list 10 rows.

## What changed

- **The rarity.** `COSMETIC_RARITIES` is now common, rare, epic, legendary, ancient. Ancient sorts first in the
  Collection (`RARITY_RANK`), gets its own rarity chip, its own label, its own colour tokens, and the odds line reads
  "Common 35%, Rare 31%, Epic 22%, Legendary 9%, Ancient 3%". An empty Ancient falls to Legendary (the nearest-rarity
  fallback; Legendary empty still ties toward Epic). `CRATE_ROLL_VERSION` is 4.
- **The SQL.** The inline rarity check from the crates file had a Postgres-chosen name, so the migration drops every
  check on `cosmetic_catalog` whose definition mentions `rarity`, then adds `cosmetic_catalog_rarity_check` with five
  values. `sqlParity.test.ts` pins the check, the odds, the band walk length and that `schema.sql` ends with the same
  pick and `open_crate`. `crateOdds.db.test.ts` runs the file on PGlite and checks the SQL pick equals the TS pick at
  every draw, including "every Ancient owned" and "only Ancients left". The other PGlite suites that sync the code
  catalog run the file's check section so the Ancient rows are accepted.
- **The look (owner picked concept 3, "Prismatic Aurora").** Cyan `#8af5ff` shading to magenta `#ff7ae0`. `.r-ancient`
  sets `--rc` (cyan), `--rc2` (magenta) and `--rc-grad`. The gem, the selected chip, the title badge text and the
  Ancient tile rim carry the static gradient; the tile rim breathes like Legendary's (opacity of a pseudo-element).
- **The reveal, "Time stops".** A rarity can carry a SIGNATURE (`RARITY_SIGNATURE` in `crateFxConfig.ts`; only Ancient
  has one, `timestop`). After the charge the scene holds at time scale 0 for `ancientFreezeMs` (650): the chest stops
  mid-shake, the camera holds, the hum is cut, and the theatre is in a new `freeze` phase that drains the Pixi layer to
  grey (a one-shot filter transition). At the burst the filter snaps back and a prismatic crack tears across the view
  (one-shot transform + opacity). Ancient's dials are bigger than Legendary's everywhere, with the sting and a double
  burst but no coins. Swapping the reveal is one entry in `RARITY_SIGNATURE` plus a `.sig-<id>` block of CSS. The
  tuner has an Ancient group with a new "Time stop" dial.
- **Six Ancient frames** via `npm run art:frames -- --apply`: Bonds, Death, Fortune, Genesis, Time, War
  (`frame_<name>`, bare names). Measured holes: Bonds 0.594 (centred), Death 0.533 at (0.497, 0.438), Fortune 0.708,
  Genesis 0.701 at x 0.609, Time 0.646, War 0.673. Bonds, Genesis and Death get by-name allowances in
  `portraitFrameCosmetic.test.tsx` (Death hangs drapes and bells under the ring, so its hole is small and high).
- **Four items moved Legendary to Ancient** (owner list): Tee Time Sylus (`skin_sylus_2`), Edward Colada Hands
  (`skin_edward_1`), Consecration (`attack_holy`), Arcana (`attack_arcana`). The two skin masters were MOVED (not
  copied, nothing deleted) from `Skins/Minion Skins/Legendary/` to a new `Skins/Minion Skins/Ancient/`. Skin
  `assets.master` is a bare filename (the folder is found by the disk check), so it did not change.
- **Owners keep what they own.** `player_cosmetics` is keyed by `(user_id, cosmetic_id)` and has no rarity column, and
  the sync never deletes a catalog row. A rarity change only moves the shown rarity and future crate odds.
- **Folder tests.** `skinRarityFolders.test.ts`, `portraitFrameRarityFolders.test.ts` and `wire-art.ts` read an
  `Ancient` folder.

## Counts

- Crate pool: Common 38, Rare 39, Epic 39, Legendary 34, Ancient 10. Per item: Common 0.921%, Rare 0.795%, Epic
  0.564%, Legendary 0.265%, Ancient 0.3%.
- Note: each Ancient item (3 / 10) is slightly MORE likely than each Legendary item (9 / 34) while Ancient holds only
  ten items. The rarity as a whole is rarer; adding Ancient items fixes the per-item order.
- Category shares of a first crate: titles 11.8%, minion skins 38.4%, hero skins 14.8%, hero attacks 8.1%, frames 26.8%.
- 45 frames (10 / 8 / 13 / 8 / 6). Collection total 196. Art budget 1405.
- Oracle: new R-PROG-RARITY-01; R-PROG-CRATE-03, R-PROG-SKINS-11, R-PROG-FRAME-01 and -04 updated.
