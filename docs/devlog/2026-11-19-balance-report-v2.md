# 2026-11-19 — Balance Report: back in the dev client, Ancient capture, at-a-glance views

Owner ask: "balance report seems to have been lost in the ui change - put it above the scene builder button on the dev
client, and add ancient data capture. also, create much cleaner interface and data interpretation for all of the
captured data."

**Entry point.** The party-home shell (production UI since 2026-11-05) had no way into `BalancePanel`. A DEV-only
`Balance` button now sits at the top of the dock's Dev Tools column, above `Scene` (the column was already stacked:
Balance, Scene, tuner). The panel paints over the shell (`.balpage` raised to z 495 over the nav host's 490, opaque
navy) and Back closes it onto the page you were on.

**Ancient capture (R-TELEMETRY-ANCIENT-01).** Telemetry already carried Ancients on/off and the pick (id, pairing hero,
turn) inside `derived` since 2026-11-16, but the flat fetch never read it and the three offered Ancients were not
recorded at all. Now: the live log records the offer and its turn (`TelemetryLog.ancientOffer`), `ancientTelemetryOf`
stamps `ancientOffer` / `ancientOfferWave` into `derived`, and the flat fetch reads `ancients`, `ancient`, the offer,
its turn and the run seed as JSON paths. The offer is seeded (`ancientOfferFor(seed, wave)`, extracted from `awaken`),
so every pre-capture row with a pick is rebuilt exactly and labelled "rebuilt". A run with Ancients on and no offer
never filled the meter. No SQL, no new column: a few dozen bytes per row.

**The report.** Three new tabs lead (`packages/ui/src/balance/BalanceOverview.tsx`, math in
`packages/sim/src/reportOutliers.ts`); the old tables stay under "Detailed tables".
- *Outliers*: per category (minions, spells, heroes, Ancients, hero x Ancient, runes, quests) the over- and
  under-performers by places better than the comparable runs that passed: cards on the adjusted association (exposed
  diagnostic fallback), heroes chosen vs offered-not-chosen, runes and quests taken vs offered-and-skipped, Ancients and
  pairings picked vs offered-and-picked-another within the offer's round band. Ranked only at Candidate+ (or Supported
  only); thin rows sit apart, never ranked; nothing centred. Each row: art, a -2..+2 dot plot with the 95% whisker,
  take rate, sample, evidence; click for the plain-words read.
- *Never picked*: offered 3+ runs and never taken, offered 10+ and taken 8% or less, and set content never offered at
  all (`reportUniverse`: a pool-bug tripwire).
- *Ancients*: the reach funnel (on, reached the pick, picked, never filled the meter, offer turn spread), the six
  Ancients, and a hero x Ancient pick-rate matrix (colour only where evidence allows, a red cross on never-picked).

Verified on a synthetic 720-run fixture (local only, never committed) through headless Playwright on 5331: opens in
about 0.4 s, scroll p95 17.5 ms, Back closes cleanly. Real-data caveat: pairings are ~200+ cells, so most will read
thin for a long time; the Ancient-level rows fill much faster.
