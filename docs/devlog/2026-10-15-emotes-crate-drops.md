# Emotes become crate drops; ten new emotes; Angry Mushy retired (2026-10-15)

> **Superseded in part the same day** by [2026-10-15-emotes-zen-starter-empty-slots.md](2026-10-15-emotes-zen-starter-empty-slots.md):
> Zen Brian is the one starter again, the menu always shows four slots, and the grandfather SQL below was WITHDRAWN
> (deleted unapplied; owner: no grandfathering).

Owner: "remove the angry mushy emote", then "remove all emotes as 'given' and put them in various loot tiers between
rare and legendary. wire all the new ones that i added" (plus Baby Rubies, Nervous Voss and Sad Wrangler added the same
afternoon).

## What changed

- **Catalog** (`packages/progression/src/cosmetics.ts`, `_shared` copy regenerated):
  - `emote_angry_mushy` is `active: false` (the first TS-retired cosmetic). The id is KEPT, so old loadout rows,
    recorded boards and replays resolve to "retired": hidden in the Collection, refused by `equip_cosmetic`
    (`not_equippable`), skipped by the menu, and `sayEmote` / `showEmoteBubble` (gated on `emoteOf`) play nothing.
    Its webp is deleted; the master stays in `C:/Game Assets/Ascent Art/Emotes/`.
  - Every live emote is now `acquisition: crate`. No starter emote exists (`STARTER_EMOTE_IDS` is empty; the `starter`
    acquisition stays in the vocabulary and the SQL check).
  - Thirteen crate emotes, **proposed** spread (owner may re-tier, one word per line):
    - Rare (6): Nervous Jensen, Zen Brian, Depressed Hank, Nervous Voss, Sad Wrangler, Tara Sad. One face, one feeling.
    - Epic (4): Flirty Midas, Happy Urchin, Sly Oona, Dead Elder. A bigger gesture or a small scene.
    - Legendary (3): Rich Pimm, Baby Rubies, Mad Tormentor. The busiest, loudest bubbles.
  - Crate maths: Rare 45 -> 51 items, Epic 48 -> 52, Legendary 46 -> 49; emotes are 5.9% of a first crate.
- **Menu rule** (`emoteSlotsOf` / `emoteLoadoutOf(loadout, owned)`): explicit positions first, but only for an emote
  the account OWNS; empty positions fill from the player's owned emotes in catalog order (the old starter fill,
  generalised: same swap behaviour). Owning none = empty. `emotePositionOf` now returns the real position (0..3), which
  fixes the Collection showing "Slot 3" for an emote placed in slot 4 when a slot was empty.
- **UI**: the right-click menu with no emotes shows "No emotes yet. Open crates to find them." (`.emote-menu.empty`,
  same tooltip chrome). The crate reveal shows the won emote's bubble beside the plate (`.crth-skin.emote`, static
  shadow, no new looping animation). Collection and menu both read ownership from the profile mirror (a guest owns
  nothing, so a guest has no emotes).
- **Art**: ten new webps in `packages/ui/src/art/emotes/`, made like the 2026-10-13 ones (flood-fill key from the
  border with a 1 px feather, keep the largest shape, trim, 512 px wide, webp q88). The script reproduced the shipped
  Nervous Jensen / Zen Brian / Flirty Midas sizes to within a pixel. Keyed: **black** backgrounds on BabyRubies,
  DepressedHank, NervousVoss, SadWrangler, TaraSad; a baked **checkerboard** (fake transparency) on MadTormentor. Real
  alpha, untouched: DeadElder, HappyUrchin, RichPimm, SlyOona. EmoteTemplate.png is never wired.
- Tests: `emotes.test.ts`, `emotes.db.test.ts` (crate items need ownership, the pool has all thirteen, the
  grandfather file over the 2026-10-13 catalog then the move), `cosmetics.test.ts` (rarity counts + per-item chances),
  `cardPlates.db.test.ts`, `ui/emotes/emotes.test.tsx` (owned menu + empty menu), `Crates.test.tsx` (emote reveal),
  `CollectionScreen.test.tsx` / `CollectionSkins.test.tsx` (header totals now 2 / 254 and similar),
  `seatEmotes.test.ts` (comments: a retired id still parses).
- Oracle R-PROG-EMOTE-01 rewritten, R-EMOTE-01 example; GAME-RULES "Emotes"; patch note in the 2026-10-15 block.

## Owner flags

- **Mad Tormentor** shows a middle finger and **Sad Wrangler** has a noose behind him. Wired as delivered; say if
  either should change before it ships to players.
- The rarity spread above is a proposal.

## Server (owner)

1. **Decide on the former starters.** Recommended: KEEP them. Run
   `supabase/migrations/2026-10-15-emotes-grandfather.sql` FIRST: every existing account gets Flirty Midas, Nervous
   Jensen and Zen Brian as owned (source `starter_grandfather`, already seen) and its revision bumps. Idempotent.
   The commented `where` line narrows it to accounts that had placed an emote. Skip the file to have everyone start
   from zero (then every current player's menu empties when this client ships).
2. **Deploy `progression-inventory`.** Its catalog sync inserts the ten new emotes, flips the three former starters to
   `crate` with their new rarities, and writes `active = false` for Angry Mushy. No other SQL: the acquisition check
   already allows `crate`, and the sync updates `acquisition_source` and `rarity` on existing rows.
3. Nothing to clean up in `cosmetic_loadouts`: rows naming Angry Mushy (or an emote someone does not own) stay, as with
   every retired cosmetic, and are ignored (`progression_profile_json` drops inactive items; the client drops unowned).
   If wanted anyway: `delete from public.cosmetic_loadouts where slot = 'emote' and cosmetic_id = 'emote_angry_mushy';`
4. Fresh Netlify build after merge. `submit-progression` and `gauntlet-clear` also bundle the catalog copy but never
   read emotes or starters; redeploying them is optional (bundle parity only). `versus-resolve` does not read it.

Order matters for UX: run step 1 before this client reaches players, or they briefly see an empty menu.
