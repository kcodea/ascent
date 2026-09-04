# 2026-09-03 — Standard Bearer was a watcher; it should Rally only itself

Owner bug report: *"standard bearer is currently bugged. it is acting as a watcher, when it's really supposed
to be just a rally effect. whenever ANY rally minion attacks, it is buffing other units."*

## Root cause

Standard Bearer (`n2_standardbearer`) shares Paragon's `onRallyBuffOnePerTribe` factory, which is registered in
`RALLY_WATCHER_EFFECTS`. That set is dispatched by both phases against **every** Rally attacker — combat's
`refireRallyWatchers` (and the base `onAttack` bus), and the shop's `fireShopRally`, which broadcasts a rally to
every board body's `onAttack` effects. The factory's only gate was `attacker.keywords.includes('RL')`, so any
minion carrying it fired on every friendly Rally.

That is correct for **Paragon** (`keywords: []`, text "Whenever you trigger a Rally…" — a true board-wide
watcher). It is wrong for **Standard Bearer** (`keywords: ['RL']`, text "**Rally:** …" — its own attack only).
The two shipped identical wiring, so Standard Bearer fired on every ally's Rally in both phases.

## Fix — one gate, both phases

A `selfOnly` param on the shared factory, mirroring the existing `permanent` param (the two cards disagree
about only these two things, so a param beats a second copy of the pick-one-per-tribe rule):

```
if (params.selfOnly === true && attacker.uid !== arena.self.uid) return;
```

Standard Bearer sets `selfOnly: true`; Paragon omits it and is untouched. Because both the combat watcher
dispatch and the shop broadcast thread `attacker` and resolve `arena.self` to the body the effect is on, the
single factory gate fixes both phases at one boundary — the watcher path invokes Standard Bearer and it
no-ops, while its own swing (attacker === self) still fires.

## Tests (both phases, proven to fail without the fix)

- `simulate.test.ts`: with another Rally minion one-shotting the dummy so Standard Bearer never swings, it fires
  0 buffs (was 2); on its own Rally it still fires.
- `rallyDispatch.test.ts`: a non-Standard-Bearer shop Rally leaves it at 3/5 (was buffing itself to 6/8); its
  own shop Rally still buffs. Paragon's existing shop-watcher tests are unchanged.

## Docbot oracle (owner ask: "be sure to add this to the docbot oracle")

Two docbot lanes referenced Standard Bearer and had to move with the fix:

- **`rallyGuard`** — its `BROADCAST_BY_DESIGN` exemption declared Standard Bearer an ally-attack watcher, which
  was the stale (buggy) belief. The exemption reason is corrected (it now speaks only for Paragon's
  side-broadcast wrapper), and a dedicated assertion pins BOTH halves of the self-only guard: the card carries
  `selfOnly: true` AND the arena body honours it (`params.selfOnly === true && attacker.uid !== arena.self.uid`).
  Drop either and the lane goes red — the tripwire this bug earned.
- **`textOracle`** — the printed-buff reconciler had been measuring Standard Bearer's +3/+3 via the fixture's
  `cryptwolf` Rally (the watcher path). With that gone, and the fixture subject carrying no keywords, it read
  `silent`. Armed in `ORACLE_ARM` with `keywords: ['RL']` so the subject fires its OWN Rally on its own swing;
  the +3/+3 (golden +6/+6) then lands on one recipient per tribe.
