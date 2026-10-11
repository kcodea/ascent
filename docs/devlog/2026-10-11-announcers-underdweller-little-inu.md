# 2026-10-11 — Two more announcers: Underdweller and Little Inu

Owner: *"i want to create an underdweller announcer"*, *"i want to create an announcer with this voice too after
underdweller ... we will call her Little Inu"*, *"legendary for both"*. Amends `R-PROG-ANNOUNCER-01`. Follows the recipe
in `2026-10-11-announcer-lemon.md` ("Adding the NEXT announcer"): no SQL, the `announcer` slot already exists.

## OWNER RUNBOOK

Deploy `progression-inventory` after this merges, so the catalog sync adds both to the crate pool:
`npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`
(If the Lemon runbook has not been run yet: paste `supabase/migrations/2026-10-11-announcer-slot.sql` first, then this
one deploy covers all three voices.)

## What shipped

- **Catalog:** `announcer_underdweller` ("Underdweller", pack `underdweller`) and `announcer_little_inu` ("Little Inu",
  pack `little-inu`), both Legendary crate items. Legendary is now 40 items, so each is 9 / 40 = 0.225% of a first crate
  (0.237% with Lemon alone, 0.243% before announcers). The Collection total is 229.
- **Voices:** both are ElevenLabs Voice Library voices already in the account (no custom slot):
  Underdweller is `Vs5CmVCVJwW4odQS2pVf` (the voice the hero Underdweller speaks with in Hero Select, so the hero and
  this announcer sound alike on purpose); Little Inu is `EeQEodFZVtBkjtgK3HBc` ("Piku - Expressive Kid Character").
  Default model settings (no tuned speed / stability, unlike the two clones).
- **Words:** the SAME 297 lines as the default announcer, word for word, the swearing and drinking lines included. The
  owner was shown the 20 such lines for Little Inu (a child-character voice) and ruled *"keep them as they are"*.
- **Audio:** 297 clips per pack in `apps/web/public/announcer/<pack>/`, levelled to −20 LUFS (they sit at −21.6 to
  −20.0). 7,172 characters for Underdweller, 7,172 for Little Inu.
- **Licence note:** library voices belong to their creators and can be withdrawn from the library; audio already
  generated stays usable. Worth a look at each voice's page before a wider release.
