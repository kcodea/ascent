# 2026-09-24: 19 heroes archived

Owner ask (verbatim): *"Archive these heroes. (remove them from all modes but keep them in the game. they should
only show in scene builder)"*. A second list of eight followed the same day under the same ruling, given as name
plus hero power, so each match below was confirmed on the power too.

## Name to id

| Owner name | Hero id | Power (confirmed) |
| --- | --- | --- |
| aevor | `aevor` | Tempest |
| cindara | `cindara` | Hoard |
| Devourer | `devourer` | Devour |
| Emissary | `vale` | United Front |
| Fibbsy | `fibbsy` | Ruby Wealth |
| Harlan | `harlan` | Buyout |
| Odelle | `odelle` | Exhibition |
| Tiff | `tiff` | Dragon Tamer |
| Underdweller | `underdweller` | Soulkeeper |
| runesmith | `runesmith` | Forgemaster |
| guardian | `runeguard` | Runeguard |
| Foreman Flint | `flint` | Company Rate |
| Gorun | `gorun` | Blade Mastery |
| Jensen | `jenkins` | Dynamite Dig |
| Membrance | `membrance` | Memory |
| Pete | `pete` | Contrabanana (not Re-Pete, `repete`) |
| Rayse | `rayse` | Empowering Vines |
| Sable | `sable` | Soulbind |
| Yirin | `rohan` | Reflector |

Every name matched exactly one hero. None was ambiguous.

## How

No new flag. `HeroDef.wip` already was the archive flag: Fi + Coran (2026-08-28) and Void (2026-09-16) were
archived with it, and every picker already filtered on it. Its doc comment now says so, and a shared predicate
`isArchivedHero` (heroes.ts) replaces the inline `!h.wip` in `playableHeroes`, `practiceHeroes` and
`powerDiscoverPool`. Every hero picker already read one of those three (the Play picker, Practice, lobby rival
seats, Practice bot portraits, the Compendium Heroes tab, Mimic / Void / Power Shifter, the balance tools).

Two gaps closed:

- `synthesizeWaveFromCurve` (the `npm run pool` generator) stamped portraits from the raw `HEROES` list. It now
  skips archived heroes. The committed `opponentPool.data.ts` was **not** regenerated; its boards keep the hero
  they were baked with, and those still resolve.
- The Scene Builder hero picker already listed every hero. It now marks archived ones "(archived)", the way the
  set picker marks "(live)".

Left alone on purpose: `BOOTSTRAP_HEROES` in `snapshot.ts` (it feeds the rating ladders' reference boards, not a
seat; changing it would move every board rating), recorded player snapshot seats (a real player's run keeps the
hero it was played on), and the Avatar picker (cosmetic art, not a hero pick).

## What shifts

- **Mimic and Power Shifter** can no longer offer these 19 powers. This follows the Fi / Coran / Void precedent
  (`wip` has always meant "out of the power Discovers too"). If the owner wants archived powers still adoptable,
  it is a one-line split in `powerDiscoverPool`.
- **New seeds**: lobby rival-seat heroes, Practice bot portraits and Mimic / Power Shifter offers draw from a
  smaller roster, so the same seed now gives different heroes there. Hero select itself is unseeded
  (`Math.random` in the store). No golden or determinism test pinned any of these draws. Stored runs, replays
  and recorded seats are untouched: they store their hero.
- **Tribe gate**: Tiff and Foreman Flint were the only tribe-gated heroes. The gate stays, and `tribeGate.test.ts`
  now exercises it with their flag lifted for the test body.
- Superseded assertions ("Tiff is back in the pool", "Jensen is re-enabled", "Fibbsy is adoptable", Yirin legal
  for Void, the Aug 23 powers "ship enabled") were updated to the new ruling rather than deleted.

## Pins

- `packages/sim/src/heroArchive.test.ts`: all 19 are archived and resolve by id with their names; none appears in
  Play / Practice (any tribes), the power Discovers, generated lobby seats or Practice bot portraits; a run on
  each still starts; Yirin still gets his Reflector.
- `packages/ui/src/sceneBuilderPanel.test.tsx`: the Scene Builder lists every hero, archived ones marked, and
  starts a sandbox on one.
- Oracle: `R-HERO-01` in `packages/rules/src/registry/approved/heroes.ts` (the first rule in that domain).
- Player patch note (Balance, "Heroes Retired") and a new *Heroes: archived* section in `docs/GAME-RULES.md`.
