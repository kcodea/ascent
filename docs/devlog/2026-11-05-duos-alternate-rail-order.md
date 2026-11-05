# Duos: teammates alternate, and the rail is the order

Owner 2026-11-05, from a Discord thread with Lemon: make who fights first alternate instead of a 50/50, and let
"whoever is on top in the rail" be the one who fights first. R-DUOS-ORDER-01 now says that; the 2026-10-25 per-round
coin is gone, and so is the "<Name> fights first" plate.

- `duosFirstMember` (sim/versus/duos.ts) is the one source: a seeded coin for round 1, then parity. Versus Duos
  (`duosAlternatingFirst`) and the Ranked Duos live pair (`rankedDuosFirstOf`) both read it.
- A recorded Ranked Duos team keeps the order it recorded, so a served team may not strictly alternate. That is the
  snapshot-fidelity bar, not a bug.
- The rail reads `lobby.duosFirstIds`, built from the round the client is on (`run.wave`), so the rows do not swap
  during a replayed fight. The swap glides through the rail's existing FLIP.
- An empty top board still hands over at resolve, so the top row can be the one that does not fight. Same as the plate.

**Shipping trap:** `contentRevision()` hashes cards, runes and quests only. A rule-only change does NOT get a new
Worker name, so a pack with no content change would redeploy over live rooms and flip their order mid-match. This one
is safe because main's content is already ahead of the last pack.
