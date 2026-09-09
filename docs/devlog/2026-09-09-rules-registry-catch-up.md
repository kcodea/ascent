# Rules registry catch-up — every late-2026-08 / early-2026-09 logic fix and ruling is now an approved rule

Owner ask (2026-09-09): "update our oracle with all fixes as of late and make sure it is fully up to date with
everything logic wise." The registry (`packages/rules/src/registry/approved.ts`) had last moved on 2026-08-28;
eleven logic-bearing PRs had landed since, several carrying owner rulings that lived only in PR bodies and
Bug Board notes.

## Ten new approved rules, each pinned by the scenario lane that shipped with its fix

| Rule | What it fixes in the registry | Pinned by |
|---|---|---|
| R-TIER-01 | Skybound Ascendant reaches Tier 7 on every run (owner overruled the by-design close, cb45dc41) | runeMinionsAug20 + instView |
| R-GIFT-01 | Targeted Gifts pay out on the chosen minion (#1374, 9852e16f) | gifts.test |
| R-RALLY-01 | A free Rally is a triggered Rally — Hawkus & co. fire on it (#1374, 7e04222d) | freeRallyWatchers |
| R-RALLY-02 | "Rally:" is the card's own swing; "whenever you trigger a Rally" is a watcher (#1361) | rallyGuard + rallyDispatch |
| R-SHOP-01 | The Shop never overflows its capacity (#1325, 5c5b50a0 — owner ruling) | shopCapacity |
| R-REFLECT-01 | Reflector: Spells and Rubies share one once-per-turn re-cast (#1326 text, #1374 lane) | reflectorSharedAllowance |
| R-RUNE-SUM-01 | Rune of Summoning pays its printed +2/+2 — the text is the contract (#1285) | runes.test |
| R-HAND-01 | Hand-gain watchers fire in combat when the card arrives (#1297) | handGainInCombat |
| R-RISE-02 | Rise works outside combat; Shop destroys follow combat's death sequence (#1289/#1290) | shopDestroy |
| R-ENGRAVE-01 | Every combat stat gain goes through the one buff chokepoint so Engrave sees it (#1377, 7130a89b) | runeWardingEngrave + simulate.test |

## Stale `currentBehaviour` corrected

The eight R-RUNEDUP rules and R-SHOUT-01 still said their implementation "rides feat/rune-duplicate-stacking"
/ "feat/this-turn-rule". Both shipped the same day they were ruled (#1264, #1262); the entries now say so and
name what conforms.

## One new pending card

`q-gangplank-self-buff` (pendingManual.ts): Bug Board 38d186a6 — may a lone Gangplank buff itself? Closed by
design on the board pending this ruling; recommendation is to keep the printed reading. It reaches the DEV
MENU → Rulebook board like every other card.

Not touched: decisions.json (owner clicks only), the generated queues, KNOWN_VIOLATIONS (R-AVWIN-02/10 still
reproduce — nothing since 2026-08-27 changed the clash death order or the summoning-death baseline).
