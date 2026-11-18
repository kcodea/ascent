# 2026-11-17 — Combat Summary odds in every mode (R-ODDS-ALL-MODES-01)

Owner asks: "are our combat sims accurate still with ancients?" and "can we also add summary chance to win etc for duos
and our lobby modes?"

**Ancients audit.** Every Ancient combat effect reaches `simulate` through `ancientCombatMods` → the side's
`questMods`, which the stashed `oddsInput.playerState` captures (enemy seats likewise through `seatCombatSide` /
`sideFromSnapshot`). Nothing applied outside `simulate` changes the outcome; Ancient Pummel / Ward-break / Rise payouts
are carry-backs paid at settle. `oddsParity.test.ts` re-runs the input on the real combat seed and gets the real fight
event for event (Indy x War / Time, Warden x Bonds / Genesis), and settle never mutates the input. The one drift found:
the Practice-bot damage multiplier was applied after `simulate` but not in the probe, so a bot fight's "typical loss"
read low. It now rides the input as `lossDamageMult`.

**Odds everywhere.** The server resolvers (Versus 1v1, group, Versus Duos, Ranked Duos) stamp each seat's view with the
exact inputs of the one fight (`versusOddsInput`, leads + reserves + tie-break) and the seat's chair
(`perspective: 'enemy'` for simulate's enemy side). The client's existing idle-sliced probe in `Recruit.tsx` picks it
up unchanged, and its spectate tap already forwards the numbers. The Scene Builder tag-team fight now stashes its team
fight too. The worker strips `oddsInput` before any Supabase write (`withoutOddsInputs`), so archives and the Ranked
Duos finish budget are unaffected; it adds roughly 8 KB (1v1) to 17 KB (tag-team) per seat view on the socket and in
DO storage.

**Needs a Versus worker redeploy** before live Versus / Duos / Ranked Duos fights carry the input (the resolver is
bundled into the worker). Until then those modes show no odds, exactly as before.
