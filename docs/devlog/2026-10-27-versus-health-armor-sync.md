# 2026-10-27: Versus Health / Armor sync (fix/versus-health-armor-sync)

Owner, after Versus Group / Duos with friends: "i casted mend to get armor but it didn't show to the other players. are
there any other oversights like this? in some instances people seemed to die when they still had hp on my screen";
"on round 1 i think only 1 board fight because an opponent board was empty? make sure empty boards don't halt or break
something". Rules: R-VERSUS-LIVE-ARMOR-01, R-VERSUS-EMPTY-01.

## Audit: what can move a Versus pool outside combat

| Source | Server pool (damage, knockouts) before | after | Other clients' rails before | after |
| --- | --- | --- | --- | --- |
| Hero start Health + Armor | yes (NULL = hero start) | yes | yes | yes |
| Summit +10 Armor per hero | yes | yes | yes | yes |
| Duos pool (30 + both Armors) | yes | yes | yes | yes |
| Mend (`setArmor`, the only shop pool effect in content) | at the round's close only | the moment a board is sent | only after the round, once the viewer left the fight | during the shop |
| Mend, Duos teammate's own Health box / rail row | n/a | n/a | never (until the fight landed) | the same shop |
| `healHero` (no card uses it) | never raises Health | unchanged | n/a | n/a |
| Hero powers, runes, quests, Ancients | none touch Health / Armor | n/a | n/a | n/a |

The source of truth is the server's stored pool (`versus_matches.pN_health/armor`, `versus_group_seats`,
`versus_group_teams`). Before: the resolver applied the Mend report only inside `versusVitalsBefore` at the close, so no
row anyone could read held it until the round's result. Now an AFTER trigger on both submission tables applies the
resolver's own bound to the stored pool as soon as a current-round side reports more Armor
(`2026-11-03-versus-live-armor.sql`), and bumps the match revision only when a pool moved. The resolver is unchanged
(its raise is now a no-op), so no `versus-resolve` redeploy. A pool not stored yet (before round 1 commits) is left to
the resolver, as before.

## "Died with HP on my screen"

Three ways a client could show a knockout without (or before) the Health that caused it:

1. **The group spectator's plates** read the live seat rows, which move the moment the round commits: new Health and
   "out" showed while the fight was still playing, and the switcher even moved off a knocked-out player mid-replay
   (the older note "Group spectator hearts shown before replay ends"). They now read the watched screen's rail and
   Health box (`spectatorPlates.ts`), like the 1v1 plates already did.
2. **The rail's knockout vs. its pools** came from two separate reads (the seat row vs. the round record). A seat is now
   shown out only together with the round record that put it out (or once the match is over).
3. **The rails' timing**: every seat now shows the server's pools going INTO the round while the viewer is at the round
   before (`entering`, kept from the last shop / resolving row), and the round's record once they leave the fight.

## Empty boards

Verified, no change needed: an empty side loses at once to any minion and two empty sides draw (1v1, group, the Copy of
an empty board, Duos). Duos: an empty first board hands over; an empty reserve never steps in, so "only one board fought"
when the other team's first board wins is the rule (GAME-RULES Duos, the design doc), not a stall. The client's zero-beat
replay already reaches `done` (2026-09-24 fix). Pinned in `versusEmptyBoards.test.ts`.

## Owner to-do

Apply `supabase/migrations/2026-11-03-versus-live-armor.sql`. No function redeploy.
