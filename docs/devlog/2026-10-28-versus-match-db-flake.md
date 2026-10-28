# 2026-10-28 · versusMatch.db.test flake: an unpinned random seed, not a race

`packages/sim/src/versus/versusMatch.db.test.ts` ("plays to 0 Health ...") failed in CI about once in thirty runs with
`expected 'shop' to be 'complete'`, then passed on re-run.

Root cause: the test played a DIFFERENT match every run. The migration draws the match seed and both seats' hero and
run seeds from Postgres `random()`, which the test never seeded. Its scripted clients use `GREEDY_PILOT`, which never
tiers up, so both boards sit at Tier 1 and trade 2-3 damage a round with many draws. Match length is then a long-tailed
random variable: 100 local runs gave 9 to 39+ rounds, and 3 of them were still in the shop when the test's 39-round
loop ran out. Nothing timing-related: no clock, no concurrency, no product bug (1v1 Versus has no round cap by design,
and real players tier up).

Fix: `select setseed(0.5)` at the top of the test, the same pinning the chaos harness already does
(`chaosServer.reset`). The match is now identical every run (27 rounds today). If a content or pilot change ever
lengthens it past the loop, it fails deterministically on that PR with a message saying to re-pin.

Verified: 200/200 consecutive passes, five loops in parallel (forks + `--pool threads`).
