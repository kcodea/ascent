# 2026-11-02 — Duos: the teammate triple hint (R-DUOS-MATE-TRIPLE-01)

Owner, from live Duos play with Mike: "this is referring to when a teammate has a pair, and the minion shows up in your
shop. we need something that shows you can give that to your teammate for a triple."

**What.** On your own screen in Versus Duos / Ranked Duos, a non-Golden Shop offer or hand card your teammate is one copy
short of a Gild on (two non-Golden copies across their board + hand; one under their own Gild-at-2 rules) wears the
own-triple hint tinted the Duos pass teal: static ring + opacity-only breathing `::before` on a Shop card, the plate's
hover-glow layer recoloured teal (static drop-shadow, opacity breathes) on a plated hand card, and the rising arrows in
teal. An offer that also completes YOUR triple shows only the gold hint. Never while you watch your teammate's screen.

**How.** `versus/mateTriples.ts` (pure `mateTripleKey` + a tiny store keyed per seat, written only on change) is fed by
`duosMateSignals.noteMateFrame` (every teammate spectator frame a Duos player already receives) and, in the Scene
Builder, by `sbDuos.ts` subscribing to the placeholder teammate's run. `versus/useMateTriples.ts` picks my teammate's
seat (or the local mate) and returns one primitive key; `Recruit.tsx` turns it into a uid set for the Shop and hand rows,
`Card.tsx` adds `.matetrip` + `.triparrows.mate`. Counting mirrors the shop's own `tripleReadyUids` / `checkTriples`
eligibility and reads the TEAMMATE's own `gildCopiesNeeded` (their view is a RunState projection).

**Verified.** `mateTriples.test.tsx` (key rules, live frame updates, opponent seats ignored, reset, watching = none,
no store churn on an unchanged frame, Card class + gold precedence, CSS animates opacity/transform only). Scene Builder
Duos live check in headless Playwright.

**Not built here (reported to the lead).** The owner's other note, the post-combat teammate FLY-IN ("the team flies in
and fills the 7 slots from left to right ... DOES deal more dmg to opponents"), is a missing ENGINE mechanic: core
`simulate` scores only the winning board's tier + survivors, and a reserve that never stepped in contributes nothing.
It needs a core/sim change + CombatEvent + the Versus Worker redeploy, so it was held for the lead's go-ahead.
