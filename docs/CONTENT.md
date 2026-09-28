# ASCENT — Content Reports (generated, never hand-maintained)

**There are no counts in this file, on purpose.** Every previous version of it was a point-in-time table that
went stale within days — the last one claimed **30 basic / 31 epic runes** while the arrays held **141 / 138**,
and its file paths still described a flat `cards/` layout that has been set-scoped (`cards/set1/`,
`cards/set2/`, `cards/set3/`) for a long time. A number in a document is a number nobody re-verifies.

Generate what you need instead. These read the live arrays, so they cannot drift:

| Want | Run |
| --- | --- |
| A full card reference (ids, tiers, stats, text) | `npm run dump-cards` |
| Content sanity audit (bad refs, orphans, schema) | `npm run audit` |
| Live-text audit (scaling cards printing stale values) | `npm run text:audit` |
| Beat/event coverage | `npm run beats:audit` |
| Balance export from real runs | `npm run report:export` |

For a one-off count, query the exports directly rather than trusting any doc:

```bash
npx tsx -e "import {RUNES,EPIC_RUNES,ARCHIVED_RUNES,CARD_INDEX,poolFor} from '@game/content';
console.log('runes basic/epic/archived:', RUNES.length, EPIC_RUNES.length, ARCHIVED_RUNES.length);
console.log('cards in index:', Object.keys(CARD_INDEX).length);
console.log('set2 buyable:', poolFor('set2').buyable.length);"
```

## Where content actually lives

- **Cards** — `packages/content/src/cards/<set>/` (`set1`, `set2`, `set3`), split by tribe plus `spells.ts`,
  `tokens.ts`, `neutral.ts`. Shared: `cards/archive.ts` (retired), `cards/henchmen.ts`.
- **Set manifests** — `packages/content/src/sets.ts`. A set declares its `tribes` and which card arrays it
  `own`s. `activeSet()` is first-enabled-wins; a run **pins** its set at creation.
- **Runes** — `packages/content/src/runes.ts` (`RUNES`, `EPIC_RUNES`, `ARCHIVED_RUNES`). Pool membership is
  **array membership**, not the `epic` flag — that flag is only the card's kicker. A `sets: [...]` field gates
  a rune to particular sets; omit it for "every set".
- **Quests** — `packages/content/src/quests.ts` (`QUEST_DEFS`), same `sets` gating. ⚠️ **The quest SYSTEM is
  ARCHIVED** (owner 2026-08-28, `QUESTS_ARCHIVED`): the defs are all still here, still validated and still
  resolvable by id, but no quest can be offered in play. Counted in this file's totals as content, and
  labelled `archived` in the Doc Bot report. See `docs/GAME-RULES.md`.
- **Henchmen** — `packages/content/src/cards/henchmen.ts` (`HENCHMEN`). ⚠️ **Also ARCHIVED** (owner
  2026-08-28, `HENCHMEN_ARCHIVED`) — resolvable, never offered.
- **Heroes** — `packages/sim/src/heroes.ts` (`HEROES`).
- **Cosmetics (titles, hero skins, minion skins)** — `packages/progression/src/cosmetics.ts` (`COSMETICS`). This file
  OWNS the database catalog: the `progression-inventory` Edge Function syncs it on deploy (no SQL). A skin targets a
  hero or card by stable id; its art is `packages/ui/src/art/skins/<cosmeticId>.webp`. A live skin without its art
  fails CI (`packages/ui/src/skins/skins.test.tsx`). Count them with
  `npx tsx -e "import {COSMETICS} from '@game/progression'; console.log(COSMETICS.length)"`.

### How to add a cosmetic (no SQL)

1. Put the master in `C:/Game Assets/Ascent Art/Skins/<Hero Skins|Minion Skins>/`.
2. Add the entry to `COSMETICS` in `packages/progression/src/cosmetics.ts` (a new permanent id, name, rarity, target
   hero / card id, `assets.master` = the master's filename). A new category also needs `enabled: true` there.
3. `npm run art:wire -- --only=skins --apply`, then `npm run optimize-art`.
4. `npm run progression:shared` (regenerates the Edge Functions' copy; CI fails if you forget).
5. Merge, then deploy the one function:
   `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`.
6. Verify with a read-only anon probe (its first request after the deploy runs the sync):
   `curl "https://zcwhbejpqcdcfdpfxeza.supabase.co/rest/v1/cosmetic_catalog?select=cosmetic_id,active,admin_off&cosmetic_id=eq.<id>" -H "apikey: <anon-key>"`
   answers `[{"cosmetic_id":"<id>","active":true,"admin_off":false}]`. (If it is empty, the function has not had a
   request yet: POST anything to it once, then read again.)

Retiring one for good is `active: false` in the same file, then steps 4 and 5. For an EMERGENCY retire (no deploy),
use the one-liner `update public.cosmetic_catalog set admin_off = true where cosmetic_id = '<id>';` (restore with
`false`); the deploy sync never touches it.
- **Global id→def resolution** — `CARD_INDEX` is global by design, so an out-of-set card granted by a rune
  still resolves. Draw pools come from the run's pinned set via `poolOf(state)` / `poolFor(setId)`.

`token: true` marks a card that resolves but is never drawable — reward-only and generated cards. Those are
excluded from the buyable pools.

## If you keep a snapshot anyway

Generate it, and stamp it with the command and the commit SHA that produced it. An unstamped table is
indistinguishable from a stale one.
