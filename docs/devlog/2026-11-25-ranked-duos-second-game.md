# 2026-11-25: A second Ranked Duos game replayed the first one

Live, minutes after v0.2.17: the owner and Mike played one Ranked Duos game, then every next game of the party broke after the first
fight (boards they had not bought, "like watching a replay", no shop). Rule R-VERSUS-ROUNDS-MATCH-01.

- **Cause:** `versusCfRemote.ts` caches committed rounds by round number. The 1v1 and Group caches were emptied when the room's match changed; the
  Ranked Duos one was not (its rows carry no match id to filter on). Round 1 of the new game overwrote the old one; "round 2" was already there,
  from the old game, so `driveRun` played it, then 3, and so on. The server was right throughout (rounds closed with `auto` boards).
- **Not new in v0.2.17:** the cache is unchanged since 2026-11-10. Nobody had played two Ranked Duos games in one party before.
- **Fix:** one owner for the three caches (`cacheFor` / `holds`). Client only: the Worker is unchanged.
- **Found by** two headless players on a local `wrangler dev` playing game after game. Until then the two-player driver stopped at the first shop,
  so it could never have seen this: keep playing a second game in it.
