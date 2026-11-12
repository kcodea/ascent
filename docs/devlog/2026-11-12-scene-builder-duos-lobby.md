# Scene Builder Duos is a real Duos fight (2026-11-12)

Owner: "scene builder duos mode needs to actually turn it into a 'duos' lobby so i can test various combat
interactions and stuff".

**Before.** The rig's Duos toggle gave a placeholder teammate (portrait, passing, team effects, Duos cards) but the
teammate's run never fought: End Turn was an ordinary one-board fight, so no hand-off, no reserve, no fly-in.

**Now.** With Duos on, End Turn is the real tag-team fight, built the way `resolveVersusDuosRound` builds it:

- The teammate's turn ends with yours (their own `faceOmen { deferFight }`: End of Turn, banks, a prepared side).
- One `simulate()` with a reserve on each side. My team: my board and theirs. The other team: my Enemy board, then the
  Enemy board set on the teammate's screen (their run's foe for the wave).
- My run keeps its own board's view (`duosMemberView`); the same fight lands on the teammate's run at once
  (`resolveCombat { fight }`), so they are back in their shop one wave on, with their carry-backs.
- The Teammate panel has "You first / Them first". An empty first board hands straight over, as in a match.

**Where.** `SandboxDuosFight` on the `faceOmen` action (`state.ts`), honoured only on a `sandbox` Duos run
(`reducer.ts`); the rig's half is `endTurn` / `afterCommit` on the local-mate seam (`sbDuos.ts`, `versus/localMate.ts`,
two call sites in `store.ts`). DEV only, like the rest of the Scene Builder.

**Known gaps.**
- The hero portraits do not swap to the board that is fighting (that reads the Versus match, which the rig has none of).
- If the teammate has a choice open (a turn-1 Discover on their hero), they cannot end their turn: you fight alone and
  the panel says so. View their board and answer it.
- The sandbox is invulnerable, so team Health is not charged.

Tests: `packages/ui/src/sbDuosLobby.test.ts`.
