# 2026-11-20 Secret titles (48 hidden achievements)

Owner ask: "50 new SECRET titles, each earned by an in-game feat ... they should all be tied to hidden achievements, so
unlocking them grants xp too and it's easier to track in game".

## What shipped

- `SECRET_ACHIEVEMENTS` (packages/progression/src/achievements.ts): 48 `hidden: true` defs in a new **Secrets**
  category, ids `secret.<key>`, 250 to 750 XP (20,550 XP in all), each with `rewards.titleId = title_secret_<key>`.
- `SECRET_TITLE_COSMETICS` (cosmetics.ts): 48 Secret-rarity titles, `acquisition: achievement`, never in a crate,
  hidden in the Collection until owned. Names in `SECRET_TITLE_NAMES`.
- 39 new RUN metrics (achievementMetrics.ts, `observeSecretAction` / `observeSecretCombat` / `finalAchMetrics`), all from
  the run's own state and combat log. New tally fields are optional, so an old save reads them as empty.
- No SQL: `settle_progression` already reads any run-metric key, grants `title_id` in the same transaction, and the
  category column has no check. The parity suite and the PGlite evaluator comparison cover the new defs.

## Themed looks (owner follow-up, same day)

"Make the new titles more exciting/fun looking based on their tribes or whatever unlocks them." Each secret title
carries `CosmeticDef.look` (`SECRET_TITLE_LOOKS` in cosmetics.ts), one of 12 themes: the 8 tribes (Dwarf, Demon, Spirit,
Dragon, Beast, Undead, Kobold, Celestial) plus coin (Gold and the Shop), steel (combat), royal (lobby and placement) and
jester (silly challenges). `TitleBadge` paints `.tb-look-<key>` (styles.css: tokens only, shared shape), with the
tribe's painted medallion for a tribe look and a shared secret seal (crimson inner rim, small crimson diamond). Loops:
one slow transform sweep for all, plus Celestial's opacity star dust. `look` is client-only (the catalog sync payload
names its fields), so no deploy. Surfaces that printed non-master titles as plain text (Career header, Collection,
new-rewards popup) now render the badge for any title with a look (`hasTitlePlate`). The lobby rail stays title-free
(owner ruling 2026-09-28, pinned in titles.test.tsx). Spirit uses its own lantern copper text with a moss green rim
and glow, since the Spirit token is copper, not green.

## Left out (no reliable signal)

- **Avenger** (15 Avenges in one combat): each Avenge factory decides its own threshold; no event or counter records a
  fire. Needs a `playerAvenges` count on `CombatResult` (like `playerRallies`), counted where `avenge` handlers pay.
- **Indecisive** (50 hero / Discover rerolls): no Discover reroll action exists, and hero select allows one reroll that
  is not part of the run. Needs a reroll action logged in the run.

## Changed from the owner's list

- Five names renamed because an achievement already uses the name (names are unique across achievements and the
  catalog, a tested rule): Big Spender -> Money to Burn, Last One Standing -> By a Hair, Untouched -> Never Bested,
  Kingslayer -> Regicide, Executioner -> Headsman. Keys (ids) keep the owner's names.
- Four shortened to the 20-character title rule: Moss's Gardener, Wick's Apprentice, Gramps' Grandkid, Raag's Sous Chef.
- Made distinct from an existing feat: Mixed Company (5 tribes, no tribe more than twice; "5 tribes + 1st" is
  `menagerie.five_tribes_win`), Untouched (every combat won; `combat.undefeated_win` allows draws), Executioner
  (knockouts in 4 rounds in a row; 3 and 5 in a game exist), Sous Chef (50 consumes, any set; Glutton is 25, Set 2),
  Oona's Packmate (7 different Beasts and nothing else; the Set 2 banner is 7 Beasts).
- Reinterpreted: Glass Cannon (4+ minions all starting on 1 Health), Flawless Ascent (1st without losing Health; start is
  30, so "above 40" cannot happen), Photo Finish (exactly lethal last knockout; a lobby hit is never 1 damage).
- Thresholds lowered from first guesses: Dwarves 60 (100), Kobolds 60 (80), Dragons 50 (60).

## To go live

1. Deploy `progression-inventory` and send it one request (the cosmetic catalog sync adds the 48 titles).
2. Then deploy `submit-progression` (the achievement catalog sync adds the 48 defs; its sanitizer learns the metrics).
3. Ship the client. Order matters: a completion that lands before the title row exists records no title.

If step 2 ran first, this one-off grants any missed title (idempotent):

```sql
insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
select ac.user_id, ac.title_id, 'achievement', ac.achievement_id
  from public.achievement_completions ac join public.cosmetic_catalog c on c.cosmetic_id = ac.title_id and c.category = 'title'
  where ac.achievement_id like 'secret.%' and ac.title_id is not null
on conflict (user_id, cosmetic_id) do nothing;
```
