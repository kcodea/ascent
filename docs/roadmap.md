# ASCENT — roadmap / queue

The forward queue. **Shipped detail lives in [devlog.md](devlog.md)** (newest first); high-level
milestones in [../CLAUDE.md](../CLAUDE.md). When something ships, delete it here — this doc is a queue,
not a history. Keep it honest.

**North Star:** a course-based async autobattler where every run has a record, a memory, and an identity —
*"this was **my** build that run,"* not "I forced a known comp and won." The run/career spine (record, par
line, save/continue, post-combat + post-run summaries, build tags, career page, rating) is shipped; the work
now is making runs feel *fair and fun to play against humans*, deepening build authorship, and getting the
game ready for a public audience.

The five buckets below are ordered by when we intend to act, not by size:
- **Now** — the active near-term focus.
- **Next** — queued right behind Now; ready to start when a Now item frees up.
- **Later** — real work, unscheduled; pulled forward when it becomes the highest-leverage move.
- **Parked** — deferred, dormant, or blocked on an external step (a decision, a schema run, a rework).
- **Public Release** — the hardening gate before ASCENT goes to a public audience.

---

## Now

- **Warm the FX shaders before the first play (perf — measured 2026-09-01).** The first minion played onto
  the board in a run freezes the page for 0.6–0.8 s in the PROD build (8 headed-Chrome runs, main and
  `perf/recruit-click-path` alike). A CPU profile attributes ~525 ms to `getProgramParameter` under Pixi's
  `WebGLRenderer.start` — a synchronous first-use shader compile/link for the landing FX. Pre-compile the
  primitives' programs (and the common shape textures) during the title / hero-select / ceremony screens, or
  go async via `KHR_parallel_shader_compile` and poll `COMPLETION_STATUS_KHR`. Later plays still spike
  70–160 ms intermittently on both builds (unattributed — likely more first-use variants / texture uploads);
  re-measure those once the warm-up lands. Caveat: every measured run was cold-cache (fresh Chrome profile);
  Chrome/Electron keep a shader cache on disk, so returning players may already see less — measure a
  warm-cache run first to size the real-player win. Details + the table in
  `docs/devlog/2026-09-01-perf-recruit-click-path.md`.

- **Re-check the Aug-20 batch in play after the correction pass** (Night Market's per-turn shop buff, Skybound's real-time transform, the new sell-a-Demon Arcane Behemoth, the ten tribe runes paying on purchase — all shipped, see the devlog). What is left is the owner's eyes on whether the four now FEEL right, and whether the Behemoth's new payoff needs a cost/stat adjustment now that it scales off your own sales.

- **The 16 rune-only minions now have their Runeforge entries — ART is what is left** (rune batch built
  2026-08-20, see the devlog). The 30 runes that hand them out shipped, so every one of those bodies is
  reachable in play. Remaining: (1) art for all 16 — they are the current contents of `ART_PENDING` in
  `packages/ui/src/allTypesPill.test.ts`, and each id comes OUT of that list as its art lands; (2) an owner
  balance pass on the 30 rune costs and on the minion stat lines (Ancient Wanderer's 3-Gold step in
  particular), now that both halves are reachable together.

- **Combat speed auto-ramp — SHIPPED 2026-08-18.** Each combat replay now holds at the Speed-slider value for
  an opening grace, eases up to a ceiling mid-fight, then eases back down for the finish (default ON, toggle
  under the Speed slider; presentation-only, engine/determinism untouched — details in the devlog). Follow-up:
  the live feel pass (settle grace / ceiling / ease-down tail) is owner-driven via the dev **Speed Ramp** tuner.

- **Quest/rune-granting heroes should wear the GRANTED art** on their power button: Fi, Coran, Runesmith,
  Guardian (the `cia-<suit>` / `cassen-<kind>` variant-art pattern already does exactly this).

- **Delete the now-dead `ciaEnchantedFx.ts` and the unused `.enchantwisp` CSS**, both superseded by the
  `cia-hp` def (follow-up from the 2026-08-20 card-following enchant treatment).

- **PERF FIRST: `pixiFx.buffGust` redraws a `Graphics` EVERY FRAME** and is ~half of all jank — 16 of 599
  buckets carry 492 of 989 jank frames, and fps inside them collapses from ~230 to ~87. Build the geometry
  once (or pre-render to a texture) and animate transform/alpha instead. Far narrower than the items below.
- **PERF: shop-phase plan is scoped — [`docs/perf-shop-phase-plan.md`](perf-shop-phase-plan.md).** Two traces
  agree that `render:recruit` + `layout:flip` are ~94% of measured time while the sim and reducers are ~0.
  Order: **A** isolate drag/purchase rendering (staged, one PR per stage), **B** card-view signature cache,
  **C** the small remainder of the purchase transition. NOTE the audit's "dedicated purchase transition" is
  largely already built — `buyDrop` already takes the manual-FLIP path — so only a forced reflow is left
  there. Take a PROD trace first: the dev numbers are inflated by StrictMode's double-invoke.

- **Cia enchanted foil — Phases 3-5** (`cia-enchanted-foil-fx-handoff.md`): purchase capture + streak to the
  hero power, the third-card payout burst, the `data-fx-anchor="hero-power"` anchor contract, and the tuner
  preview actions. One-shot event ids to expose: `cia-enchanted-purchase`, `cia-enchanted-payout`. Their
  timings must stay authored, not duplicated in React timeouts.
- **Look at the Cia foil in-game and tune it.** Phases 1-2 are wired and mount cleanly, but the visual was
  never eyeballed — 13 dials are in the Hero Card FX tuner under "Cia: Enchanted foil".

- **MATCHMAKING self-avoidance** — deliberately NOT implemented (owner 2026-08-16: no playtesters yet, so
  excluding your own boards would empty the pool). The local-board tier is gone, so you now face Supabase
  snapshots then bots; revisit once there are real players to match against.

- **`Auctioneer.png` / `Myra.png` collide** on the `myra` slug — delete or rename the stale `Myra.png`.

- **Missing hero POWER art:** Odelle and Sable (`OdelleHP.png` / `SableHP.png`). Portraits for all five are wired, as are Cia's and Harlan's power art. Drop the files in and re-run `npm run art:wire -- --apply`.
- **No hero amplifies spells any more** — Yirin's rework retired the last `spellAmplify` holder. Spell power now comes only from Rune of the Crown and `spellAura` cards. Decide whether a hero should carry it again.
- **Classify the 2026-08-16b hero-power beats.** `investment` / `luckySeat` / `exhibition` / `buyout` / `soulbind` / `allIn` are registered `flagged: true` on a heuristic and need the owner's real ownBeat/foldedCue call.

- **Keshi the Protector — SHIPPED 2026-08-16.** New hero: Keshi's Crown banks the tavern tier of every card
  bought and grants a Triple Reward every 25 (details in the devlog). Follow-ups: no henchman yet (tracked
  generally under Henchmen below); the power-button art keeps its forest backdrop rather than a transparent
  cutout; the 25 threshold is a single-number retune if playtest says it lands wrong.
- **Classify the 2026-08-16 hero-power beats.** `hero:emeraldwarden:vanguard` / `hero:underdweller:soulkeeper` / `hero:albus:empowerment` are registered `flagged: true` on a heuristic — they need the owner's real ownBeat/foldedCue call.

- **BEAT SYSTEM — the finish line is now [`docs/beat-system-status.md`](beat-system-status.md)** (owner ruling
  2026-08-13): adopted Codex's 12-item Definition of Done as the spec. That doc tracks every item as
  done-merged / built-unmerged / TODO. The authoring surface is built (much of it unmerged, `#1000–#1004`); the
  real remaining work is the **live cutover** (retire `projectEndOfTurnSteps`), **heroes** (0 registry entries),
  **comprehensive emission** (combat/start-of-turn/hero), **folded-cue combat attribution**, **multi-phase
  sources**, **emission-coverage CI**, and **FX-isolation tests**. Merge `#1000–#1004` first.
- **DEFERRED (owner, 2026-08-12) — roll the End-of-Turn shop buff instead of jumping.** The EoT shop-buff
  real-time fix (#996) makes a buffed Shop minion's stat land on the beat, but it JUMPS (via `releaseStat`)
  rather than rolling up smoothly the way a board minion's End-of-Turn gain does. Owner wants it to roll too.
  The board rolls because its buff-FX descend drains the stat hold over `rollMs`; the shop offer has no such
  descend, so its hold is released instantly. To roll: drive the shop offer's hold delivery with a roll
  (e.g. a `holdStat`/`claimStat` schedule on the offer, or a shop-side descend cue) instead of `releaseStat`.
  Low priority, revisit later.
- **BEAT SYSTEM + BEAT LAB — CORE COMPLETE (2026-08-14).** Universal source-attributed trigger beats (recruit
  + combat) + a dev-only Beat Lab tuner. The full 13-PR arc shipped (registry → collector → recruit pipeline →
  read-only viewer → editor → one-engine preview → LIVE playback → combat consumption → minion identity →
  finish pass). As of 2026-08-14 the top-bar **LIVE** toggle is the single switch for BOTH End of Turn and
  combat — flip it and Lab edits (holds + `ownBeat`/`foldedCue` policy) pace real fights; off is byte-identical;
  shop actions stay instant by design. Optional/deferred (owner's call): review the ~29 remaining `flag`ged
  classifications; retire the legacy End-of-Turn path; promote committed combat values on without the toggle.

- **Board buttons re-art + hero-power circle + FX + editor fixes — SHIPPED 2026-08-14.** Freeze/End Turn base+gem
  layers with cracked-on-press; Hero Power → circle; "Freeze" label pill; gem/pill tuner sliders + baked defaults;
  FX bindings (freeze-blast, hero-power-spark, hero-power-target, coin-on-sell, click-puff fix); green buff-burst
  removed; timer label removed; in-run UI editor fixes (drag scale, undo/deselect/exit, unique selector, image
  panel). Details in the devlog.
- **Beast batch (owner) — SHIPPED 2026-08-12.** Kennelmaster Avenge 3→4; King Oona doubles Attack only; 4 new
  Beasts (Wolvie, Armadiyo, Dunkey, Voidmother) and 4 new runes (Burrow, Voidmother, Jungle, Beastial Swarm),
  with three new combat mechanics (next-summon queue, resummon-without-Echo, per-death buff + run-persisted
  Avenge level). Grim pulled into Set 2 + retext'd to a flat +8/+8 Echo. Details in the devlog.
- **Content batch (owner) — SHIPPED 2026-08-12.** 4 minion reworks (Market Tormentor +7/+7; Menagerie Mammoth →
  Echo summon 3 random other Beasts; Feastmaster Vhal → spend-10-Gold shop buff; Endless Overseer → Avenge(4)
  summon an Imp with Taunt+Ward), 3 new minions (Right Hand Hank, Bullseye, Beardsley — incl. a new combat→shop
  carry-back), and 9 archives (5 minions + 4 runes). Details in the devlog.
- **Recent Games → player Career — SHIPPED 2026-08-12.** Each Recent Games row is now clickable, opening that
  player's Career expanded + scrolled to the specific run (board/runes/details), matched by nearest timestamp.
  Reuses the Leaderboard's view-another-player path; needs the `run_history` cross-user read policy (else the
  career opens empty). Details in the devlog.
- **In-run UI editor (dev-only) — SHIPPED 2026-08-13.** Direct-manipulation editor for in-run DOM UI — move/resize/restyle, image swap, Approach-A override stylesheet, copyable summary. Details in the devlog.
- **Rune batch (6 reworks + 27 new runes) + Might of Aeon — SHIPPED 2026-08-19.** Tribe faucets (basic + epic),
  Wishbone doubling every hero power on the roster, and a bot softlock fix (the scout overlay blocked `faceOmen`).
  Details in the devlog.
- **20 new runes + 2 new minions — SHIPPED 2026-08-12.** Herzog + Kobebes; six grant-a-minion+flag runes;
  twelve shop/economy runes (Window Shopping, Bargain Bin, Restocking, Trade-In, Collector, Shopkeep, Seller's
  Market, Open Enrollment, Strange Caravan, Fresh Pages, Lassoing, Old Pack). Art wired. Herzog was renamed to
  **Vaultkeeper** (Rune of the Vaultkeeper grants it + shares its grant to an adjacent minion). Details in the devlog.
- **Live Imp-stat text + two End-of-Turn fixes — SHIPPED 2026-08-11.** "Summon a X/Y Imp" live text on every
  imp summoner (cards + runes); EoT-triggered Discovers auto-grant (no window); EoT shop buffs animate on the
  beat. Follow-up: tick the growing shop offer's printed number up live during the beat (it currently gets a
  burst + float; the offer is replaced next turn where the buff shows fully). Details in the devlog.
- **Balance batch (minions + runes) + two combat-timing fixes — SHIPPED 2026-08-11.** ~12 minion reworks, ~40
  rune cost/effect changes (incl. Mountain Trade's new `cardsPlayed` threshold meter and a permanent Showcase),
  and two engine bugs: summon-on-space now fires at Start of Combat, and a Rally summon onto a full board is
  rejected at queue time rather than landing after the attacker's death frees a slot. Details in the devlog.
- **Lobby HUD cleanup + Recent Games — SHIPPED 2026-08-11.** Hid the redundant top-left plaque in a lobby
  (rail now carries round + seats-left + max-loss), moved the combat-pacing slider into the Esc menu and Skip
  above End-Turn, dropped the unused clear-boards/reset-career actions, and added a Recent Games feed (last 20
  finished games across all players). Details in the devlog.
- **Owner rune/minion batch 4 — SHIPPED in full 2026-08-07** (17 Basic runes, 8 Epic runes, 3 T6 minions across
  four tranches; details in the devlog). One piece of follow-up work remains:
- **Owner rune/minion batch 4 — tranches 2-4 remain.** Tranche 1 (the nine pattern-reuse Basics: Empty Plate,
  Gem Dividend, Carrion Coin, Five Banners, Centerline, Second Litter, Shared Pour, Aftermarket, Hoardcalling)
  and tranche 2 (the three T6 bodies + their Epic grant runes) both shipped 2026-08-07. Still queued, in order:
  - **Art for tranche 2** — the three new bodies (Ashen Heir, Runesnout Archivist, Mossmemory Colossus) and
    their three runes ship without art; nothing matching those names exists in the art folder yet.
  - **Tranche 3** — 8 contained-machinery Basics: Spellhide, Spellmarket, Last Word, Runic Hoard, Backbeat,
    Spare Chair, Ashen Payroll, Emberline.
  - **Tranche 4** — 5 hard Epics: Ancestral Roar, Ruby Shrapnel, Shared Scripture, Banquet Hall, Crucible Choir.

- **Stat readout choreography — hardening follow-ups (both halves SHIPPED).** The shop half
  (2026-08-05, [`plans/2026-08-04-scheduled-stat-delivery.md`](superpowers/plans/2026-08-04-scheduled-stat-delivery.md))
  and the combat half (2026-08-06,
  [`plans/2026-08-05-combat-stat-unification.md`](superpowers/plans/2026-08-05-combat-stat-unification.md))
  both landed: one `fx/statHold.ts` store serves shop and combat, buffs roll and pop the same way in both, and
  combat's bespoke `statHold`/`statFlash` system is deleted. Details in the devlog. What's left is small,
  none blocking:
  - The two browser harnesses (`cascade-verify.mjs`, `combat-invariant.mjs`) are manual pre-merge gates, not
    CI — so the next change to `stepHolds`, the rank table, or combat's beat cleanup gets none of their
    protection. Wiring them into CI is the highest-leverage of these.
  - Combat's damage-interrupt (a hit releases an in-flight buff roll) is proven correct-when-it-fires but only
    exercised by a synthetic roll-inflation control — the test card's roll finishes ~300ms before damage
    lands, so no naturally-reachable overlap exists for it today. A slower-windup card would reach it; worth a
    harness scenario on such a card if one exists.
  - Combat's hold TTL is computed at placement speed while the roll tracks live speed, so a mid-roll SLOWDOWN
    force-delivers early (fails open — true value, lost animation frames, never a wrong number). Closing it
    needs a `statHold.ts` export that re-arms `until` without resetting the reveal.
  - A carrying `react` layer can only `claimStat` from the moment it SPAWNS, so one armed with an `at` past
    the cue's roll completion can't (fail-open); and `revealStat`'s rejected-call reel ordering is correct but
    pinned by no test.
  - An EARLIER-beat HEALTH buff still mid-roll when a LATER beat's hit lands still SNAPS (the down-roll's
    below-floor guard). Same-beat buff + damage now nets into one roll from the pre-beat HP to `frame`'s true
    HP (2026-08-07); the cross-beat case has different baselines, so netting it cleanly is the remaining,
    rarer case.

- **Bind an `under`-slot effect to a real moment.** The canvas slot shipped 2026-07-30 with one worked
  example (`ground-slam`, unbound). The obvious candidates are the landing dust, the melee impact dust and
  anything that should read as happening *on* the board rather than in front of it — each is a one-field
  change on an existing def plus an eyeball pass. Worth measuring the third canvas's cost in a real combat
  before migrating more than one.

- **Re-measure the known hitches against the 240 Hz budget (4.17 ms).** The budget and the derived HUD
  thresholds shipped 2026-07-30 ([`performance.md`](performance.md) §0), which means the numbers will look
  worse without anything having regressed — the instrument was under-reporting, not the game improving.
  First known item: the **gild's worst frame is still ~16.7 ms** (4× budget) even after the canvas fix that
  cut its mean by 24%. Then a full-run capture with `?perf=1` on the real display, read on `worst` and the
  `long`/`jank` counts rather than the mean, to find what else the 60 Hz calibration was hiding — phase
  transitions and the shop open are the standing suspects.

- **Eyeball the new float overlay on a real fight.** Combat damage numbers now render in a `<body>`-portalled
  overlay above the FX canvas (shipped 2026-07-30). The layering is browser-proven and the spawn path is
  unit-tested, but the live replay itself could not be driven end-to-end in this session (no foregrounded
  browser available — a hidden tab never ticks rAF, so the GSAP beat clock never advances). Watch one fight
  and confirm the numbers land where they used to, including a killing blow and a keyword glyph.
- **The shop's gold/sell pill is still under the coin sprinkle.** Same class of stacking issue as the combat
  floats, deliberately left alone because the sprinkle reading *around* the pill is arguably correct. Decide
  whether it should be portalled too, or leave it.

- **Re-watch Echohorn's Rally on a gilded proc, and decide what `rally-link` is for.** Two rounds of owner
  notes shipped 2026-08-05 — the retune (pulse-then-link, beat 50→120, longer ring hold) and `summonHold`
  (the sparkle now delivers the cubs instead of trailing them) — and NEITHER has been watched together in a
  live fight. Best single test: a gilded Echohorn into a Manasaber, which exercises the double proc, the
  120ms beat and one litter per sparkle at once. `speed`/`fade` on the shockwave layer are the dials if it
  still isn't holding long enough. Separately: `rally-link` is now an authored def with nothing bound to it
  — either author it onto specific ralliers (Deathsayer and Broodlord are the obvious candidates) or delete
  it, but don't leave it looking wired.

- **`summonHold` is wired to Rally only.** Any other effect that delivers a summon has the same early-cub
  problem — the frame commits the unit when its moment becomes current, whatever procced it. The module is
  generic (hold a uid, release a uid); what is Rally-specific is `boundRalliesIn`, which decides WHICH units
  to withhold. A second adopter wants its own resolver alongside it, not a change to the module.

- **Set 2 art — 7 minions still have none.** Storm Chaser, Mineral Master, Runekeg, Moira, Oathbound Avenger,
  Bellringer Voss, Lastlight Marshal. Everything else (149 files) is wired — the Demons folder was fully
  re-wired 2026-08-13 (23 masters). The old `BigHuggies.png` / "**Bug** Huggies" naming question is CLOSED: the
  card is `dm_velvet`, named "Big Huggies", and the master matches it exactly.
- **Two Demon art files are unwired — the owner needs to name their card.** `Blu.png` matches no card in the
  repo, and `content1544.png` is un-attributed; both sit in `Ascent Art\Set 2 Minions\Demons` and were skipped
  on the 2026-08-13 re-wire rather than guessed at. Name the card for either and it's a one-file drop.
- **Set 2 balance is unplayed.** 26 quests and 96 runes are implemented and tested, but almost none have been
  played. Objective counts (Endless Inventory's 180 shop stats, Heart of the Mountain's 150) and rune magnitudes
  are starting dials, not tuned numbers. Needs live play before it is trustworthy.

- **Close the human-board gap (bots).** Expert covers 4.70 wins vs real player boards (par 9), 0 course
  survivals, and per-round win rate collapses after round 6. Evidence so far says the gap is CAPABILITY,
  not evaluation: every structural fix (replacement macros, spell casting) paid; every learned/statistical
  model was neutral or harmful. **Next: build the dev-only oracle** (future shops + full opponent boards +
  big budget) — if it also can't survive, the bot can't express winning play and we keep hole-hunting; if
  it wins, evaluation is the gap. State: [`docs/bot-handoff.md`](bot-handoff.md).
- **A human baseline (owner).** Play 3–5 runs against the same board pool. Par 9 is the Oath, not a measured
  human score against boards from other players' finished runs — we're optimizing an unanchored target.
- **Lobby snapshots — SHIPPED.** Real player runs now hold up to 3 seats and place 3.63 vs bots' 6.58.
  Follow-ups: lobby-native snapshots (these are Ascent-mode boards), and whether placement feeds Renown.
- **Lobby per-round bot cost.** Deferred by owner call after the creation + death hitches were fixed
  (2026-07-30). A live `hard` seat's `prepare()` costs 200–900 ms and grows with board size, and six advance
  per round — currently masked because recordings cover rounds ~1–13, so it only bites in long lobbies, which
  a lobby (no round cap) will routinely become. Difficulty is NOT the dial: all four tiers share one search
  config. Options: advance seats in shop-phase idle time (`warmLobbySeat` already exists and is called that
  way at run start / resume), a Web Worker, or a reduced search budget for lobby seats. Re-measure in play
  before choosing.
- **Bot personas — HOLD** until the tiers separate. No point diversifying four bots that measure as one.
  Plan: seeded evaluator weight multipliers + tribe affinity, with a board-divergence metric in
  `lobby:ladder` so it's measured rather than asserted.
- **Cap bot strength — HOLD.** Nothing needs capping yet.
- **A human baseline.** Every bot number is bots-vs-bots or bots-vs-recorded-boards. Playing a few lobbies
  at Expert is the cheapest way to learn whether 3.38 mean placement is a threat or a speed bump.
- **Ticket 3 (card profiles / package graph) — owner call.** Fight-grounding answers the question the
  314-entry registry was built to guess at, so it may not be needed. Worth deciding before building it.

### Paragon's tier + stats need an owner call (2026-07-28)
Paragon shipped at **Tier 6, 4/5** — my choice, not a spec. The owner gave the effect only ("New All type minion
- Paragon - Whenever you trigger Rally, give a minion of every type +3/+3 permanently"). The body is deliberately
small so the permanent Rally scaling is the reason to play it, but the tier and the numbers want a real balance
pass alongside the other Rally payoffs.

### Tier-7 access has no source yet (2026-07-28)
`hasTier7Access` is live and Beyond the Summit is gated on it, but nothing sets `tier7Access` — only the Summit
rift reaches Tier 7 today. The owner described the other route as "a different hero power or something"; the flag
is ready for whichever hero or quest ends up carrying it.

### FX authoring loop (owner test run — 2026-07-26)
The FX workbench is built; the next step is authoring a real effect through it end to end.
[`docs/fx-requests.md`](fx-requests.md) holds the brief template and the queue. Division of labour: owner
briefs → Claude builds a first-pass `defs/<id>.json` → owner tunes in the workbench and Saves → Claude binds
it to a moment kind in `score.ts`. Blocking-ish for a serious run: `fxScale` isn't threaded into the
primitives (a def is the same pixel size on every screen), `playDef` takes no per-call params, and anchors
are points rather than rectangles.

- **The shop-wide buff aura is bound** (shipped 2026-08-18): `shopBuffAll` is a new recruit moment kind fed by
  the `tavernBuyBonus` diff, bound to the owner-authored `shop-buff-aura`. Fires on both the action boundary
  and the End-of-Turn beat. Any future card or quest that raises the run-wide shop channel animates with no
  extra wiring.

- **Rune-trigger FX — DONE** (2026-08-19). Every rune with any notion of triggering now bursts on its badge in
  both phases, including the eleven continuous modifiers (owner ruling: burst on each occurrence). The only
  runes still silent are the one-shot purchase rewards (Scout, Small Fortune, the Pair, Spare Parts,
  Gemcutting, Top Hat, Menagerie, Altar, Evolution), which fire once at buy and have no repeat moment — the
  only hook there would be the purchase itself, if it is ever wanted.

- **Ring layers can now be placed** (shipped 2026-08-17, while authoring `shop-buff-aura`): `shockwave` gained
  the `offsetX`/`offsetY` pair the particle primitives already had, so a ring is no longer pinned to its
  resolved anchor. `ribbon` is the remaining primitive with no placement dials — add the same pair there if a
  def ever needs an off-anchor trail.

- **Source-attributed buff FX now exist** (shipped 2026-08-10, first used by Karwind → `flame-ring`): a combat
  `buffed` fan-out plays a def on every unit the source empowered, and shop buff moments are split per source so a
  binding keys to the *buffer*. Reusable for other source-driven buffers (Bathing Matriarch, Den Mother auras, …)
  — brief + author a def, then bind `cards.<id>.buffWave` (fanOut `buffed`) and `cards.<id>.minionBuffed`.

### Two aura FX don't fire — rebuild them in the workbench (owner ruling 2026-07-31)
Found while verifying the Pixi aura-bubble removal in game. **The Ward-break shatter and the Rise re-form on
respawn never play.** Not caused by that removal: calling the survivors directly spawns particles normally
(`shatterAt('shield')` 38, `rebornSummon` 17, `shatterAt('reborn')` 31), so the renderer and both entry points
are healthy. The failures are the *cue-scheduled, rect-fed* dispatches — `onShieldBreak` / `onReborn` in
`useCombatReplay.ts` via the `auraBreak` / `auraReform` cues in `score.ts` — which no-op silently when the rect
is null. The path that still works (`burstDeathAuras`) fires directly on death instead. Corroborating symptom:
no shield-break sound either, and `breakShieldAura` plays its sfx *unconditionally*, so it is very likely never
called at all rather than called with a bad rect.

**Owner ruling: don't repair the cue path — author both as defs in the FX workbench** and bind them from there.
That retires the dead cues rather than resurrecting them. Brief them via
[`docs/fx-requests.md`](fx-requests.md).

### Drag feel is not scale-invariant (owner report 2026-07-22 — decision needed)
The drag maths works on raw pixel deltas (`tiltPerPx * hLean * gx`) without dividing by `--scale`, so the same
hand movement produces the same tilt in degrees over a card that may be 50% larger. A fullscreen exe (`--scale`
1.0) therefore feels different from a windowed browser (0.67–0.92) — confirmed: F11 in the browser matches the
exe. The dialled values are *not* drifting; only the stage scale differs. Fix would be to divide the drag pixel
deltas by `--scale`, but that changes the feel at the size it was tuned at, so it needs an owner call.

### Balance patch 2026-07-21 (owner spec — landing in chunks on `balance/patch-2026-07-21`)
Large hand-authored balance pass, sliced so each chunk lands green + tested on its own:
- **✅ Chunk 1 — Demon minions** (shipped to branch): Soulfeeder, Sword & Bored, Burial Imp, Godfodder, Pit
  Supplier, Ritualist, Chef Raag. Data-only.
- **✅ Chunk 2a — Rune costs** (shipped to branch): 23 cost tweaks + Spare Parts → 5 Attachments. Data-only.
- **✅ Chunk 2b — Rune effect reworks** (shipped to branch): all 8 — Aftershocks, Consumption, Packcraft,
  Rebirth, Refrain, Slaying, Trophy, Broodpit.
- **✅ Chunk 3 — Quest objectives** (shipped to branch): 40 quests retuned (objective count/event/tribe + 3
  reward tweaks). Data-only.
- **✅ Add-on (owner 2026-07-21, shipped to branch):** Spell Appraiser Avenge (3), Nimbus/Displacement → T5,
  Hoardbreaker Drake → Rally-only, and **Runescale Drake** reworked to per-spell-this-turn scaling (new
  `scTribeBuffPerSpellImproving` factory).
- **✅ Chunk 4 — Quest removals + flag reworks** (shipped to branch): removed Last Rites / The Author's Hand /
  The Hoard Wakes; reworked Empty Graves, Deep Hunger, Pit Without End, The Old Hunt, Blueprint Cache; applied
  the deferred Parliament of Flame + Track and Fodder with new vehicles for the orphaned regressions.

**The 2026-07-21 balance patch is now COMPLETE** — every spec item is on `balance/patch-2026-07-21`, awaiting
review + merge. Follow-up worth tracking: the `authorsHand` objective event and `slaughterRepeat` reward kind
now have no content using them (kept deliberately for a future quest — remove them if none materialises).
- **✅ Chunk 5 — New-mechanic minions** (shipped to branch): Hoard Cleric (exclude self), Attachment Mechanic
  → T4 3/5, Kennelmaster Avenge (4), Thundeer text, Hunter (improve every 3 — new `every` param), and
  Korok/Banksly on a new **`cardsBought`** trigger + `buyTick` meter (the buy-count sibling of `goldSpent`).

### Nine-card balance pass 2026-07-21 (owner spec — `balance/nine-card-pass`)
Shipped to branch, awaiting review + merge. Kennelmaster (board-wide +2 Attack, Avenge 3), Hunter (improve
every 5), Growth (T2, +1/+1), Spirit Fire (+2/+3), Patch Job (+1/+1 base + +2/+2 per 6 Gold), Badgington and
Solaris Fang (Rally halves cut), Money Maker (Gold Pouch only), and the **Graverobber self-target fix** (new
`targetNotSelf` CardDef flag). Detail in the devlog.
- **Follow-up:** `rallyGrantRandomSpell` + `rallyTribeAura` are now unused by any card. Kept as primitives for
  set 2 — remove in their own PR if nothing picks them up.

### Execute (`V`) — finish the retheme
The rename (#625), the CSS rage aura (#627) and the Pixi strike have all shipped. Remaining:
- **Owner-dial the strike.** The Execution Strike's shipped values are a considered first pass, not owner-tuned
  — dial them via the 🩸 Execute Strike tuner's Test button and bake the JSON.
- **Render-profile the aura (much less urgent).** The owner's 2026-07-22 tuning cut it from ~101 nodes / ~98
  animations per card to **42 / 40** (smoke off, shards 26 → 12), with 3 `mix-blend-mode: screen` arcs instead
  of 6. All static paint. Still worth a DevTools pass on a full board at some point, but no longer a concern.
- **"Toxin Tender"** (content, Kevin's side) now has a name that doesn't match the keyword it grants.

### Taste the Cleave beat (`feat/cleave-slash`)
Hit-stop → claw rake across the target → blood drips → attacker returns. The rake and drips were reviewed via
the static frame ladder (`apps/web/public/fx/cleave-slash-preview.html`); the two TIMING dials — `HIT-STOP ms`
and `RETURN delay ms` — live in the lunge timeline and can only be judged in a live fight. Dial in
🪓 Cleave Slash FX, then "Copy values" back into `DEFAULTS` in `cleaveFxConfig.ts`.
- **NB:** the preview rig is a hand-kept mirror of `drawSlash`. Change one, change the other.

### Human-playtest balance
The counter matrix is balance *truth*; stat numbers are dials. With all six tribes + the quest content in,
the game wants a real tuning pass driven by human play (not just the bot).
- **Real-player telemetry is the primary balance lens** (owner call 2026-07-16). The greedy bot buys
  `shop[0]` / picks index 0 — making it "understand the game" is a real project, not a quick fix — so treat
  bot sims as RELATIVE A/B deltas only, never absolute truth. The wave-tagged buy analytics + Balance Report
  CSV export (shipped 2026-07-17) is the data source; a parallel mass-sim runner is a cheap add if relative
  deltas are wanted at scale.
- **Smooth the curve.** Difficulty is mid-heavy then a victory lap — enemy power steps 45→75→91 across waves
  5–7 (bot win% troughs ~9%), then waves 13–17 read 54–75%. Soften the wave-5–7 wall + steepen the late
  curve. Per-turn scalers also run away (a greedy bot's Target Dummy hits 76/50 by wave 12 with no synergy).
- **Reshape the power outliers, don't nuke them** — make them ask for commitment: **Front to Back** (improve
  only on board minions; it already scales with spell power, so re-tune deliberately), **Crypt Drake** (scale
  from Dragon/Undead attacks only), **Gnasher** (cap spell-power gain per combat), **Wildwood Shaper** (more
  explicitly Beast-committed).
- **Content depth targets:** ~13–15 minions per tribe (variety comes from the meta layer, not raw count);
  ~40 spells (34 today).

### Quest refinement
Engine + UI + all six tribes' quest content shipped. What's left is polish + coverage.
- **Wire the remaining quest / reward-card art** — Undead, Mech, Demon, and Rulebreaker reward cards + quest
  cards still fall back to the glyph.
- **Balance the quest offers** as part of the human-playtest pass — objective difficulty, reward power, and
  which tribe slots get guaranteed on the two quest turns (waves 5 & 11).

### Rating & matchmaking quality
Per-wave ratings are now trustworthy (synthetic all-wave pool); the run's par Line is rating-driven.
- **Win-rate weighted matchmaking v1 SHIPPED 2026-07-18** (ledger-weighted bands + loss-streak softener +
  pinning + between-runs refresh; all dials + master switch in `matchmaking.ts` — expect iteration).
  Watch for: Renown/Oath calibration drift as average opponent strength shifts; self-play bias while the
  ledger is small; consider a back-to-back guard (never two 75%+ boards consecutively). The old
  rating-aware path (wave + rating band + record-similarity) remains the LATER evolution.
  Invariant kept: *any legal board may be served at combat time* (boss floor 0.09, no quarantine).
- **New-Line grace** — soften the first misses after a promotion (`lineGrace` field reserved).
- **Seed veterans' rating from history** — optional backfill for players with pre-rating runs. (Surfacing the
  per-run Renown Δ on Career match cards shipped 2026-07-17 in the Standout Stats panel.)

### Run identity
The career surface exists; deepen what a finished run *remembers*.
- **Replay v2 — SHIPPED 2026-08-19** (same PR as the spec): state-replay capture + pure-renderer playback +
  round rail + metrics drawer + Watch on the leaderboard/Recent Games. Phase E polish deferred: shop timer
  ticks visually during playback; seek-into-combat renders the resolved world (final fight plays through).
- **Round-by-round + replay view — was TABLED, now REBUILT as state-replay above (see [replay-v2-handoff.md](replay-v2-handoff.md)).**
  *(Spec extended 2026-08-19: a left-hand ROUND RAIL — click round 8, seek to its shop opening — plus a
  METRICS DRAWER that slides out of the rail: gold spent / actions this turn / shop tier at start, per round.
  Board power was considered and CUT. All of it is a fold over the recorded frames — no new capture beyond a
  per-frame `spent`/`earned`; see §7.)*
  A full action-replay spectator was built (watch any player's run through the live UI, from the leaderboard /
  a recent-matches feed) on branch `feat/replay-driver` and **killed 2026-08-11**: action-replay re-derives the
  run from `{seed,actions}`, and a mid-run combat RNG/uid drift makes real runs diverge completely (a recorded
  1st-place win replayed as a 4th-place death). The fix is **state replay** — record the actual per-turn board +
  each combat's event log and play those back, so "what you watch is what happened" and old replays survive
  content changes. Full design + salvage list in the handoff. Pick this up when the game is more complete.
- Deferred summary sections that need per-minion data not yet on `CombatResult`: biggest permanent-scaling
  source, quest-choice recap, Ancient recap.

---

- **Guard the Layout Lab double-source.** Layout values live both as `def:` in `layoutConfig.ts` and as a
  `var(--z-…, <fallback>)` in `styles.css`; a bake that updates only the def ships the OLD number to
  production while looking right in dev. Three had silently drifted (`shopUiY`, `shopY`, `wbY`) before an
  audit caught them on 2026-07-21. A test that parses both and asserts they match would make it impossible.

### Tactile pass — buttons done, cards and chips next (2026-07-30)
`.pressable` carries the title menu's grammar across every UI screen; see DESIGN.md → Pressable. Still open:

- **DONE (2026-07-31).** Selection cards and chips: cards press past their rest position and shrink, chips take
  a 2px edge that sinks, rows take an inset. Cards deliberately do NOT use `.pressable` — they share its press
  vector, not its plaque. See DESIGN.md, "Cards, chips and rows commit differently".
- **In-board shop controls are excluded on purpose** — Refresh, Freeze, End Turn, Tavern Up and Hero Power have
  hand-tuned pressed ART and their own tuner panels, which a CSS press would fight. Unify only if the art is
  retired.
- **`.menubtn` still holds its own copy of the grammar.** It composes a horizontal hover slide the primitive
  does not model, and regressing the one screen the owner already likes for a refactor was not worth it.
  Fold it in when the primitive grows a slide axis.

### Test board on trial — owner decision (2026-08-11)
A **Board** picker in Settings swaps the arena backdrop between the shipped board and the new `NewBoardAugust`
(display-only, persisted). Open questions before it's the default: (1) does the owner want it as the shipped
board, and (2) if adopted, the UI element offsets (end/refresh/hero-power buttons, hero portrait) and the
`--board-*` frame-fit constants are tuned against the CURRENT board's frame — the August board's frame/sockets
sit slightly differently, so they'd want a re-tune pass (`--board-fill` / `--board-zoom` + the four button
offsets in `styles.css`).

## Next

- **Decide: should ALL-TYPES cards appear in every tribe-grant pool?** (raised 2026-08-20) Quillen's Archive
  now counts `universalTribe` cards via the new `defIsTribe`, which is what makes an off-set archive (Undead /
  Mech) pay out at all. But ~10 OTHER def-level pool filters still use the blind `c.tribe === t || c.tribe2
  === t` pair — "get a random Beast", the tribe-faucet runes, Discover-by-tribe, etc. Routing them through
  `defIsTribe` too would be consistent, but it also means Paragon / Standard Bearer become possible results of
  every tribal grant in the game, diluting each tribe's pool. Bug fix vs balance change — owner's call.

- **The itch WEB zip now exceeds itch.io's 1000-file cap — DEPRIORITISED by the owner 2026-08-20** ("not an
  important factor as we will likely use the exe repack from now on"). Recorded so nobody re-discovers it as a
  mystery; revisit only if the browser build becomes a distribution target again.
  A real `build:web` dist ships **1168 files** and `package-itch.ps1` zips the whole thing. The last packaged
  `ascent-itch.zip` held **929** entries (built before the recent art waves); the next package would hold
  ~1168. Art is 992 of those, but frames (86) + fx (23) + cursors/js/css/manifest make up the rest, so
  trimming art alone will not fix it for long. Options, cheapest first: **(a)** pack card art into sprite
  ATLASES (one file per tribe/set instead of one per card — also fewer HTTP requests); **(b)** host art
  off-zip on a CDN and load by URL (itch allows external fetches, but it breaks offline/desktop parity);
  **(c)** ship art only for the active set and lazy-load the rest. The desktop/Electron package is unaffected
  (no file cap). `artNoRedundantMasters.test.ts` now documents the true arithmetic and is a trend tripwire
  only — it does NOT prove a package will upload.

- **Minion mechanic-icon (medallion `mechIcon` glyph) fixes — PR-1 SHIPPED 2026-08-19.** The resolver is
  rewritten: a shared `packages/ui/src/mechanics.ts` registry (structured detection over effect data +
  keywords + `chooseOne`, one entry per mechanic) drives both the medallion (`resolveMechIcon`, first-mentioned
  own mechanic wins) and the Compendium glossary, so they can't drift. **No tribe fallback, ever** — an
  unrecognised mechanic renders a blank badge instead of the old 64%-of-minions tribe-symbol bug. New: a
  **Watcher** mechanic (eye) for reactive/on-attack/on-summon effects, **Stealth**'s own glyph (off the eye),
  **Engraved**'s own runic glyph (off the anvil), and **Choose One** now shows on the medallion. Verified by a
  no-tribe-glyph invariant sweep + a glossary↔registry drift test; full suite 5894 pass. Details in the devlog.
  Deferred, queued here:
  - Glyphs for **Orbit / Start of Turn / Improve / Rush / Ascend / spend-Gold** — none exist yet.
  - **Re-tag Engraved cards missing the `EG` keyword** (Tara/Taragosa) so the `engraved` predicate catches them.
  - **Owner live-pass**: tune the placeholder `engrave`/`stealth` glyph art against the real board, and rule on
    whether trigger-multiplier auras (Sylus, Uron) and a few borderline reactive triggers deserve the eye.

### Effect Arena — every trigger fires in shop AND combat (IN PROGRESS — duals + Echo + Shout + RALLY DONE)
Full plan in [`effect-arena-spec.md`](effect-arena-spec.md).

**Progress 2026-08-20 — the RALLY family + its Step-4 dispatcher shipped, resumed on demand exactly as the
park below says.** Its consumer is **Rune of Lasting Cadence**, which the owner wants to read "End of Turn:
trigger all your Rally effects" and could not, because Rally is an `onAttack` COMBAT trigger with no recruit
dispatch. 40 `onAttack` bodies migrated (ratchet floor 60 → 100, every combat duplicate deleted);
`fireShopRally` / `fireRallies` are the shop dispatcher; each rally emits its own source-attributed beat so
the choreographer allots it real animation time. Enemy-facing rallies no-op by MEMBERSHIP (`enemies()` is
empty in the shop), not by a phase check. Details in the devlog.

**Progress 2026-08-20 (later) — the START-OF-COMBAT family + its Step-4 dispatcher shipped**, on demand for
**Rune of Combat Prowess** (Epic 5g: "Your Start of Combat effects also trigger at End of Turn"). 21
`startOfCombat` bodies migrated (ratchet floor 100 → 121, every combat duplicate deleted);
`fireShopStartOfCombat` / `fireStartOfCombats` dispatch per (body × effect) — SC has no watchers, so no
broadcast — one source-attributed beat per effect, nested `factory:<do>:startOfCombat` identities for the
authored FX, summon indices stamped. Enemy-facing bodies no-op by membership; combat-only channels (Bleed,
extra combat casts, Engrave) no-op on the adapter verb. Details in the devlog.

**Still unmigrated: End of Turn** (spec Step 3 item 4's last family) — same park
rule: migrate when a card or rune actually needs the cross-phase dispatch, using the Rally family's motion.

**Progress 2026-08-04 (PRs #865–#867, #871):**
steps 1–2 shipped; the dual family, the Echo family, and the SHOUT family are fully migrated — 60 shared
arena bodies, `replayCombatBattlecry`'s legacy switch is DELETED (FACTORIES-first dispatch only), and
`COMBAT_REPLAYABLE_BATTLECRIES` is derived from FACTORIES so it can never drift. Every economy Shout with a
carry-back channel resolves live (two new channels added: `mintRubies`, `gainBeastExtra`); the remaining
defer class is pure tavern work (consume/gild/shop-enchant/run-charge arms — no combat meaning).

**PARKED by owner ruling 2026-08-04** (*"we don't need to design any cards yet, I just wanted this
future-proofed… and to make sure our shout/echo combat/shop triggering is clean, cause that happens a lot"*):
the goal is met — Shout/Echo cross-phase triggering is clean and the arena pattern exists for anything new.
The Rally / End of Turn / Start of Combat body migrations + step 4 dispatchers resume ON DEMAND, i.e. when a
card/mechanic actually triggers one of those families cross-phase; migrate that family (or just the bodies
involved) using the established motion at that moment, not speculatively. The owner's
goal verbatim: *"all keywords to function in combat and shop… I do not want to have to hand select these
methods and then wire the methods to every shout."* The load-bearing case is the DISRUPTOR class — Funeral on
Loan / Dawnclaw today, Rally/EoT/SoC disruptors and brand-new mechanics next — which must reach every effect
without per-card wiring.

Simplified 2026-08-04 after owner pushback: **no declaration registry, no allowlist.** One `EffectArena`
interface each effect is written against ONCE; `CombatArena`/`ShopArena` adapters; runtime probes make the
exceptions self-handling (needs-shop-in-combat defers to settle automatically, needs-combat-in-shop no-ops).
A ratchet test (unmigrated count may only fall) replaces all labelling.

**Steps:** 1 RNG spike (1d, GATES everything) → 2 arena + adapters (2d) → 3 migrate by TRIGGER FAMILY
(the 42 duals first, then Echo → Shout → Rally/EoT/SoC; ~2–3 weeks PR-batched, each family becomes fully
disruptable as it lands) → 4 per-family cross-phase dispatchers, each shipped with one real consumer card.

Watch for: the `core`-cannot-import-`RunState` boundary (the ~160 shop factories migrate out of `recruit.ts`,
a declared collision chokepoint — serialise with Mike), and permanence becoming an explicit per-effect
argument during migration.

### Henchmen — the roster + real presentation (system shipped 2026-08-03)
The mechanic is wired end-to-end (hero link, win/loss cost decay, once-per-run recruit, placeholder chip in
the status bar, playable via the Warden in the Scene Builder). What remains is CONTENT + DESIGN: author the
per-hero roster (a henchman per hero, each with its own effects), replace the placeholder Test Squire, design
the real recruit surface (Mike's seam), teach the bots to consider `buyHenchman`, and decide the set-3 /
cross-set hero interactions.

### The gild's remaining setup tail (opened 2026-07-30)
The gild's own opening cost is down 24% (see the devlog), but the **worst single frame** in the first 120ms of
a triple is unchanged at ~16.7ms. What is left is not the effect: it is the triple's React commit plus the
first paint of three cloned, 1.5×-scaled card subtrees landing on the same frames. Worth a pass only if the
owner still feels it — the options are fewer or cheaper clones, or letting the commit land a frame before the
effect opens. Measure with the setup/body `rAF`-interval harness described in the devlog entry, against a
buy-that-does-not-triple control.


### Dev tuner migration — done bar two panels (updated 2026-07-30)
The schema (`tunerSchema.ts`) and the shared `TunerPanel` now carry **46 of 48** panels, spanning 2 to 48
controls. What is left, and what the migration left owing:

- **`SfxMixer`** — parked by owner request, to be thought about separately. It is a mixer, not a tuner: rows
  are per-sound with a play button, and it may justifiably stay bespoke.
- **`ShieldTuner`** — deliberately unmigrated because it is DEAD: nothing reads the value it tunes (no
  `apply*Vars()`, `syncShields` is gone, its storage key has no listener). Handled as its own task.
- **✅ Owner accuracy pass on the hints — DONE (2026-07-30).** All 1,020 labels and hints were reviewed against
  a generated sheet (46 panels, every label / unit / range / hint / caveat / preview switch / action button).
  Owner verdict: **no edits needed**. The vocabulary drafted from config source was right; nothing to change.
- **Panel ids must match the DevMenu key.** `useDraggablePanel(key)` injects the ✕ and closes by that key.
  Three panels had drifted and their close button silently did nothing; fixed 2026-07-30. Any new panel or
  rename must keep the two in step — nothing enforces it, and the failure is invisible until someone tries to
  close the panel. A dev-time assert would fix that permanently.
- **`.github/skills/` is untracked but not ignored.** It contains a vendored minified bundle that produces 434
  `no-unused-expressions` errors; committing it would break CI lint. Either ignore it or leave it untracked.

**Phase 2 — ✅ the two the owner picked shipped 2026-07-30.** Foldable sections that remember what you closed,
a find box inside each panel, and a hold-or-tap A/B against the shipped values. All three landed in ONE
component, which was the point of the schema.

A **Reset all tuners** action (♻️ in the dev menu) followed on the same day: per-panel Reset only ever cleared
one panel's key, so nothing put the whole toolset back to shipped. It calls each panel's own `reset()` via the
`tunerAll.ts` registry rather than sweeping storage keys — run and save state share the `ascent.` prefix.

**The visual pass shipped 2026-07-30** — the panels are dark machined instruments over the board (the
"workshop slate"), with a four-role type scale replacing eight ad-hoc sizes, and the main menu's sheen on
button hover and press. DESIGN.md now documents that surface, so future tuner work has a system to follow
instead of drifting. The owner's remaining note on the toolset was the visuals; that is now addressed.

Still on the table from Phase 2, deliberately not built:
- ~~**A Test button on every FX panel.**~~ **DROPPED (owner call, 2026-07-30)** — Pixi animation is consolidating
  into the FX workbench, so per-panel fire buttons would have had a short shelf life. The inventory that killed
  it is worth keeping, because the headline number was wrong: of the 26 panels with no Test button, **~19 need
  none** — they tune things that render continuously (Layout Lab, Card Pills, Card Plate, Card Text, Hero Panel,
  Lobby Rail, Buffs Drawer, Compendium, Card Frames, Step Counter, Smoke & Dust), already carry a preview toggle
  (Drag Feel, End Turn, Hover Glow, Hero Power, Refresh, Tavern Up), or have a better harness of their own
  (Charge Glyph's scrub). Only **5** genuinely fire and vanish — Lunge Impact, Motion Trail, Damage Float,
  Reposition Slide, Lunge — and of those, Reposition Slide and Lunge need staged cards on the board, which is
  why Lunge got its measuring readout instead. Ward Dome and Execute Aura are persistent-while-a-condition-holds
  and want a preview toggle, not a button. Revisit inside the workbench, not per panel.
- **A visual easing picker.** Easing is an ordered slider that now at least shows curve NAMES rather than an
  index. A picker drawing each curve would be better, but it affects 3 controls on 1 panel.
- **Phase 3 (workflow)** — still unscoped.

### A CSS specificity trap has bitten three times (2026-07-29)
Three separate defects this week were the same shape: two rules tie on specificity, so whichever sits later in
`styles.css` wins silently. `.menubtn:active` lost to `.menubtn:hover` (you are always hovering when you
click, so the press state rendered never); `.menubtn.active` then overrode the press again for the primary
button; and the unscoped `.tuner-row` grid lost to `.sfxmix-row`'s flex, collapsing a slider to 0px. Each fix
raised specificity deliberately and left a comment saying why the extra selector is not redundant. Worth
considering a lint rule or a convention — `styles.css` is ~6000 lines and this will recur.

- **Title screen: two phantom focus stops (found 2026-07-29).** `.gearbtn` and `.devmenu-btn` sit at
  `z-index: 85`, painted behind the opaque `.titlescreen` (`z-index: 450`), but stay `visibility: visible` —
  so they are invisible *and* focusable, and Tab lands on them twice before it reaches the menu column. Every
  `.app` control is correctly neutralised by the `body:has(.titlescreen)` rules; these two aren't covered by
  them. The fix is one rule, but it touches in-game HUD visibility and the dev menu may be wanted on the title
  deliberately, so it needs an owner call on whether the dev button stays reachable there. Feeds the
  Public-Release **Accessibility** line.
- **Confirm the title menu's press cue level (2026-07-29).** The new down-stroke on `.menubtn` reuses
  `clickthock`, a sample authored for clicks on the empty board. It has not been judged by ear against the
  existing `uihover` tick on the same control. If it reads heavy for menu navigation, `cardTouch` is the
  softer swap — a one-line change in `Title.tsx`.

- **FX Workbench — P2 (composition + richer params).** P1 shipped 2026-07-24 (see devlog): effects are data
  played by a runtime player, primitives declare their params once, and a dev-only shell generates its
  inspector from that; burst/shockwave/emitter primitives, an editable palette, a decoupled Fire trigger, and
  **value-over-life curves** (the `curve` param kind, first wired as particle size-over-life) have since
  landed. Remaining richer-param work: a `gradient` (colour-over-life) kind reusing the curve editor with
  a **smoke** primitive; optional alpha-over-life curves. (Motion physics — turbulence, emission shapes,
  velocity inheritance — colour-over-life via a bias curve, and **multi-layer composition** all shipped
  2026-07-24; colour-over-life was delivered as a rim↔core bias curve reusing the `curve` kind, not a
  standalone RGB ramp, to stay inside the posterized-palette model.) Composition landed as a functional
  **Layers panel** (add/remove/reorder/select-to-edit + per-layer `at`/`life`); still to do on top of it: a
  draggable timeline-*track* visualization; per-layer anchors staged from real combat moments (not just the
  shared scenario head); and save-to-file for defs via a dev-only Vite middleware (Copy-def clipboard is the
  stand-in). A **smoke** primitive (posterized/cel, the emitter's rising billowing cousin) shipped 2026-07-24.
  Shipped 2026-07-25: **custom PNG/SVG art import** (a runtime shape library with luminance auto-tracing), the
  **ribbon's cel look on every primitive** (particles and shockwaves now posterize a real gradient + plateau
  instead of a flat alpha — the fix for the repeated "same cartoon posterized look" ask), a `tintMode` toggle
  (palette vs the art's own colours, both posterized), ribbon **width-over-length / wave / segments**, particle
  **orient-to-velocity + alpha-over-life**, and the `curve` **`vMax`** (curves can now exceed 1×). Also
  shipped 2026-07-25: **durable defs** — Save writes a committed `fx/defs/<id>.json` via a dev-only Vite
  plugin, with a library / Duplicate / Paste / autosave, and imported art promoted to committed `art:` files
  so a shared def renders what its author saw.

- **FX — the bridge SHIPPED 2026-07-25** (`playDef` + `combatAnchors` + an `fxDef` Score channel, proven in a
  live browser with the committed `ward-gained` def bound to the new `shieldGain` moment). What's left on it:
  - **The prod decision — MADE, and SHIPPED 2026-07-29.** Defs now play for players. Three gates came out
    (the `fxDefs.ts` glob, `playDef.ts`'s dynamic import, and the `ensureDefsReady()` call in `Game.tsx` —
    the third is the one that makes the other two do anything), at a measured **+151,602 B raw / +34,206 B
    gzipped** of total JS — +17,829 B / +4,868 B gzipped in the main chunk (the defs) and 133,773 B
    (29,338 B gzipped) in a new lazily-fetched primitives chunk. An earlier estimate quoted only the
    main-chunk figure and so understated this ~9×. Authoring stayed fenced: saving, art, `window.__fx`, `DevMenu`.
    `fx/prodPlayback.test.ts` fails if the split drifts either way. **This turned on 15 already-live
    bindings no player had seen** — so the next FX task is the owner watching a real fight at 1× and
    reporting which of the 15 read wrong at card scale.
  - **The per-fire shader recompile — FIXED 2026-07-30.** Un-gating defs shipped a ~160 ms freeze on every
    combat collision: each layer built and then `destroy(true)`-ed its own `Shader`, which evicted Pixi's
    program cache and forced a full GLSL compile+link (a blocking 68 ms) per fire, plus an unbounded GL
    program leak. Now pooled (`particleLayerPool.ts` / `shaderPool.ts`) and pre-warmed at load; worst
    collision frame 160 ms → under 2 ms. Write-up: `docs/performance.md` §3b. The legacy `pixiFx` shield
    shader was checked and is clean (it uses the no-arg `destroy()`), so it never hit this; it does still
    build a `Shader` per bubble, which is cheap now but would be the next thing to pool if shields ever
    show up in a profile.
  - **`clearParticles()` doesn't reach def-driven FX.** `pixiFx.clearParticles()` (the Skip fade, and the
    recruit-phase transitions in `Recruit.tsx`) sweeps every hand-written transient — `live`, `skullPops`,
    `tendrils`, `critFxs`, `descends` — but knows nothing about `playDef`'s effects, which own their own
    containers and updaters. A def firing across a skip therefore keeps playing under the fade instead of
    being cleared with everything else. Pre-existing (it predates pooling and is not a pool defect), and the
    fix is a design question rather than a patch: either `playDef` registers each live play in a cancellable
    set that `clearParticles` drains, or transitions fade the whole FX canvas and leave the plays alone
    (which is what `setVisible` already does for the skip fade). Surfaced by the pooling review 2026-07-30.
  - **`shieldUp` is a result-type event** and collapses into contiguous result runs, so the demo cue doesn't
    fire on every combat (`[dmg, shieldUp]` compiles to a `damage` moment). A per-event fan-out in
    `compile.ts` is the fix if that moment needs to be reliable.
  - **The content backlog: 12 of ~15 landed 2026-07-25** (stealth-break, keyword gain/lost, venom-spent,
    rally-link, spell-cast, to-hand, hp-grant, spell-progress, quest-trigger, quest-complete, death-dissolve).
    Still open: **enemy-side tribe auras** (needs a side-aware wash target + a (side,tribe) dedupe key —
    un-filtering naively would wash the PLAYER'''s board and suppress their own aura); **quest-trigger /
    quest-complete are wired but dormant** (those events name no unit, so anchors resolve to null — they need
    a badge/HUD anchor); and **hpGrant holds ~0ms**, so its def fires into an immediately-advancing beat.
  - **Anchors are a fire-time snapshot**, so an effect doesn't follow a moving unit. Deliberate (per-frame
    layout reads are banned here); revisit if a follow-the-unit effect is ever wanted.

- **Edit a def's `label`/`tags` from the workbench panel.** A Save no longer *deletes* them (fixed
  2026-08-01 — it used to, silently, and it cost `strike-impact` its filing), so a hand-written label is now
  durable. But the only way to *write or change* one is still hand-editing the JSON, which means most defs
  stay unlabelled and the library browser's search and grouping run on data almost nobody supplies. Two text
  fields beside the def name, feeding the same `prior`-carrying save path. Deliberately not folded into the
  preservation fix: it is a feature, not the bug, and with no jsdom / `@testing-library/react` in this repo a
  UI addition is unverifiable by test, so it deserves its own browser-verified PR. Decide at the same time
  what a **fork** should offer — today it correctly starts unlabelled, but with an editor present the useful
  behaviour may be to pre-fill the source's label for the author to edit rather than leave it blank.

- **FX workbench — remaining authoring gaps.** (The three trust defects — Fire ignoring `at`/`life`, timing
  edits respawning mid-drag, no seed lock — were fixed 2026-07-25, along with duplicate-layer and per-layer
  mute. The three *headroom* defects the owner hit authoring a real effect — imported art not surviving a
  reload, the physics sliders capping short of dramatic, and burst's unreachable built-in fade — were fixed
  2026-07-30.) Still missing: **undo/redo** (no history stack at all; switching a layer's primitive irreversibly
  resets its params); **A/B compare** of two tunings (now genuinely meaningful, since a locked seed makes the
  randomness controlled); a **perf readout** beyond fps (the primitives already track live particle counts
  internally); layer **naming** and solo; and a **timeline-track** visualization over the layers panel. P3 = A/B compare,
  perf HUD. (The **preset library** half of that P3 line shipped 2026-07-29 as the ＋ New effect gallery; undo/redo
  shipped, and the **stage** — the workbench's own 3v3 board, so watchers/rallies/area buffs/cross-side hits have
  something to play across — shipped 2026-08-08, then DELETED 2026-08-09: it was scenery, nothing on it could
  fight, so an effect could only ever be previewed in isolation. Superseded by the **sandbox board editor**
  (see the devlog 2026-08-09 entry) — editing the REAL game's board and firing REAL combat moments off it,
  rather than building a fake rig that fires synthetic ones. Follow-up worth recording: scenario save/load
  (persisting a staged board + opponent across sessions) was deliberately scoped out and is not built.
  P4 = opportunistically migrate the 34 existing `*Tuner.tsx` panels onto the schema (an adapter
  regenerates each panel while leaving its effect code + `DEFAULTS` untouched, so no shipped value moves).
  A separate, small follow-up: wire `typecheck:web` into CI — without it the workbench's type-level tests
  aren't enforced there and the ~50 pre-existing `packages/ui` type errors stay invisible. Swapping the
  shipped `pixiFx.trail` wisps for the new ribbon is its own later PR once the owner has tuned the look.

- **Live FX authoring — all three phases SHIPPED.** ① bindings as data (2026-07-27), ② the proc harness /
  "Watch in combat" rail mode (2026-07-28), ③ commit animation — pick a card and a moment, tune live, commit
  card-only (forking the def) or everywhere (2026-07-28). Follow-ups from ③: `Workbench.tsx` is now ~2000
  lines and carries a fourth concern — the clean seam is a `useFxDraft` / `useCommit` pair of hooks in
  `fx/harness/`; the `.fxrail` / `.fxharness` chrome is declared in two places; `commitPlan`'s memo reads the
  session patch without depending on it, so the blast-radius number can be computed from a table predating
  the draft's own write (low impact — the draft row is the excluded target); editing a def's `label`/`tags`
  from the panel is still unbuilt (the unbind affordance shipped 2026-07-30); and phase ②'s auto-pause after
  a seeked moment remains unbuilt. Also open from ②: `SceneBuilder.setEnemies` still duplicates `sandbagBoard`'s
  board-building and the two could drift; rail mode costs 640px of width, tight below ~1400px; and the
  harness stages sandbags only, so a final look-check against a real pooled opponent stays manual.

- **FX preset gallery — eight more archetype bases.** The ＋ New effect gallery shipped 2026-07-29 with two:
  ⚡ Bolt and 💥 Blast, both **unreviewed first passes** awaiting the owner's eye in the workbench. Queued next
  (content, not shell): **wave, chain, cloud, swell, drip, vortex, slam, beam** — landing **one at a time** so
  each is judged side by side at real card scale rather than eight at once. The shell needs no change to take
  them: a new base is a def file plus one entry in `fx/presets/presets.json`. Trap to know while authoring one:
  **`applied` counts params *written*, not *changed*** (a ×1 multiplier still lands there), so `applied.length`
  is NOT a usable "did this variant do anything" signal — `missed` is, and picking a variant that only partly
  landed now warns in the UI.

- **Absorb the ~30 legacy `pixiFx` effects into the workbench.** They predate the def format and aren't
  authorable there, so half the game's FX are still edited by hand in TypeScript while the other half are
  data. Port them to defs, bind them through `bindings.json`, and **strip the defs nobody asked for** while
  doing it — the library is already carrying entries no brief ever requested. ✅ The def strip landed
  2026-07-29 (five workbench drafts deleted: `blue-glow-trail`, `blue-trail-detonate`, `ember-lance`,
  `self-buff-bloom`, `test-red-blast`). **`death-dissolve` stays** — it looks orphaned because no binding
  names it, but `useCombatReplay` plays it directly for every plain death (see `docs/fx-requests.md`).
  ✅ **The library no longer calls a directly-played def inert (2026-07-30)** — every migrated batch used to
  land in the coverage map's "nothing bound" column while playing constantly. Defs now read `bound` /
  `from code` / `unused`, derived by scanning `packages/ui/src` for `playDef('<literal>')` into
  `fx/directCalls.ts` with a test that fails if the snapshot drifts. **Later batches get this for free** —
  add the call, run `npm test`, paste the printed object. Only a call whose id is a *variable* needs
  thought (the test will name it).
  Likewise **`discoverBurst` is NOT dead `pixiFx`** — `Recruit.tsx` fires it on every Discover open, and it's
  the sole reason the second `discoverFx` Pixi app exists; it needs a real port, not a delete.
  ✅ **Batch 1 landed 2026-07-30**: `damageBurst`, `clickPuff` and `coins` are authored defs (`pixiFx.ts`
  3757 → 3648 lines). The pattern later batches copy is written up in the devlog entry of that date — the
  short version: grep call sites by METHOD NAME (both controllers), copy param ranges from `ruby-lance` /
  `ward-gained` rather than inventing them, validate with `fx/defs.test.ts` BEFORE deleting the method
  (`playDef` fails silently by returning `null`), and call `playDef` directly for anything that isn't a
  combat moment kind — `bindings.json` is keyed by moment kind, so shop/UI events never belong there.
  ✅ **Batch 1's one fidelity loss is repaired (2026-07-30)**: `burst` now has an authored launch direction
  (`aimMode` = `travel` | `fixed`, plus `angle` in degrees), and `coins` fires its ±33° upward fan again
  instead of a full-circle pop. `travel` is the default, so no other def moved. This unblocks the
  *directional* half of the remaining effects — but note `impact`/`critImpact` still need the per-call
  parameter below as well, since their `dx/dy` arrives at fire time. (A third `awayFrom` mode was built and
  cut for want of a caller; the reasoning, and what re-adding it would cost, is recorded next to
  `BURST_AIM_MODES` in `burst.ts`.)
  ✅ **The cut mode came back as `sourceToTarget` 2026-07-30**, because `impact` turned up as the caller. It
  aims along the FIRE's own vector — source anchor → target anchor — and cost exactly what #764 said it would:
  an optional `setAim` on `FxInstance` + `FxPlayer`, delivered by `driveLayerHeads` only when both anchors were
  really staged, so `resolveAnchor`'s invented `(0, 0)` can never be mistaken for a real source. It aims
  between the two ANCHORS rather than source → the layer's own head (the cut design), so the vector describes
  the moment and every layer of a composition blows the same way. `travel` and `fixed` are byte-identical.
- **`playDef` per-call `scale` / `intensity` — ✅ SHIPPED 2026-07-30.** Two multipliers on `PlayDefOptions`,
  reaching only the params that opt in by declaring an `axis` in their spec (`scale` = geometry, `intensity` =
  counts). `1` is an exact no-op and `scale` never touches a count, so seeded defs replay byte-for-byte.
  `dust` is migrated as the proof (`fx/defs/landing-dust.json`; the card-drop `dust*` knobs are gone from the
  Smoke tuner with it). What the remaining eight still owe:
  - **Only `scale`/`intensity` short:** `deathrattle` (`size`), `shatterAt` + `rebornSummon` (the card's
    `w/h` — note both want an *aspect*, and one scalar collapses it to the width).
  - **Also need direction:** ✅ `impact` shipped 2026-07-30 as `fx/defs/strike-impact.json` — the proof for
    `burst`'s new `sourceToTarget` aim, with `power` split across both magnitude axes (`scale` = the sizes,
    which the old code multiplied by `power` directly; `intensity` = the counts, on the old spark ramp
    `0.7 + 0.3 × power`). Its `strikeFxConfig.ts` + "Lunge Impact" tuner are deleted, and the six `smoke*`
    knobs went with the smoke layer, leaving `smokeConfig` as the pulse-only "Strike pulse" panel.
    ❌ **`critImpact` still owes three things**, and none is direction: (1) its `defRect` drives a rectangular
    Graphics flash sized to the defender CARD, so it needs an **aspect-ratio** channel — one `scale` scalar
    collapses `w`/`h` to a single number, the same gap `shatterAt`/`rebornSummon` have; (2) the "CRIT!" text
    pop is a `Text`/typography element no primitive draws; (3) its whole look is a live `critFxConfig` object
    with ~20 knobs, which is "author several defs", not one. Direction itself is now free to it.
  - **Need more than magnitude:** `impactPulse` (`radius` → `scale` and `life` → `time` are both covered now;
    what remains is that its `rings` argument REPLACES the ring count where `intensity` MULTIPLIES it — an
    `intensity: rings / 2` at the three call sites closes it) and `refreshBlast` (a whole `cfg` object from
    its tuner, which is really "author several defs, not one").
- **`playDef` per-call `time` — ✅ SHIPPED 2026-07-30.** The third and last axis. `time` rescales the def's
  whole temporal FRAME — every layer's `at`/`life`/`travelMs`, the def's `duration`, and every param declaring
  `axis: 'time'` (a ms duration) or `axis: 'timeInverse'` (a per-second rate whose period is the thing being
  stretched — shockwave `speed`, the only one). Rescaling the frame rather than just the params is the whole
  design: 13 of 22 defs declare layer windows, and a params-only stretch would silently truncate their
  particles. Distinct from `speed` (which rescales the clock and so slows the motion); `time` holds velocities
  so particles travel further. `rate` deliberately stays on `intensity` — reasoning on `FxScaleAxes.time`.
  `impactDust` is migrated as the proof (`fx/defs/impact-dust.json`, fired on all three dials from End Turn,
  Tavern Up, Refresh and the three melee branches; the `impDust*` knobs are gone from both tuners).

- **Shop→hand buy transition.** Buying a card deliberately does NOT get the arcane coalesce (a bought card
  was already visible in the tavern — acquired, not conjured). The owner wants a smooth transition of its own
  for that move, used *instead of* the coalesce, not alongside it. The exclusion is already wired
  (`buyPendingRef` at the `buy` dispatch), so this is purely the new effect.
- **Gild / triple effect.** Also deliberately excluded from the coalesce, and also wants its own treatment.
  Detection is already in place (`run.triplesMade` diff).
- **Dwarf tribe: the card frame art already exists.** When the `dwarf` tribe lands in the `Tribe` union, its
  oval frame + gilded variant are already authored and waiting at
  `Desktop/Reference Art/card frames/dwarf frame.png` + `dwarf gilded frame.png` (1059×1427) AND the Taunt pair
  in `card taunt frames/DWARF TAUNT{,  GILDED}.png` (1086×1448) — all with the same windows as every other tribe
  frame. Wiring is two conversions + two lines: convert to `oval-dwarf{,-gilded}.webp` and
  `taunt-dwarf{,-gilded}.webp` (sharp, q92), then add a `dwarf:` entry to BOTH `TRIBE_OVALS` and `TRIBE_TAUNTS`
  in `Card.tsx`. Don't re-author the art.

- **Re-tune the hand row for the plated card.** The backplate makes hand cards taller than they were, so
  `handY` / `handGap` (📐 Scale & Layout) and probably `handPop` (🎴 Drag Feel) want dialing by eye. Shipped
  with reasonable starting values. When baking the export, update **both** the TS defaults and the CSS
  fallbacks — the double-source rule.

- **Quest-node row can leave the viewport.** The `--qb-*` stage pin uses a large negative Y (−256 ×
  scale); on a tall/zoomed layout the nodes sit above the top edge. 2026-07-21r clamped the TENDRIL so it
  still reads, but the nodes themselves being off-screen is the real bug.

- **Finish the quest/rune objective-wiring audit.** 2026-07-21p fixed the recruit-phase TRIGGER
  tallies (Shout/Echo/EoT) and the `replayBattlecry` callers. Still to sweep: the other ~17 objective events
  (`buy`, `spendGold`, `summonCombat`, `playAttachment`, `consumeFodder`, …) against every quest/rune reward
  that can fire them INDIRECTLY — the failure mode is always "the effect fired, the tally didn't see it".


- **Set 2 content.** Foundation is in (`docs/card-sets.md`): author cards in `packages/content/src/cards/set2/`,
  list them in `SETS.set2.own`, trim the inherited set-1 pool with `excludes`. Before flipping it live, run
  `SET=set2 npm run pool` — an unbaked set has no captured opponents and falls back to procedural boards.
  Shipped so far: the 22-Kobold tribe + Ruby engine, the 21-card Dragon tribe (spell recursion), the 21-card
  Beast tribe (spell/summon synergy, art wired),
  and Set 1's neutral spell toolkit carried over (minus the four tribe-locked ones). Still needed before flipping
  live: more tribes/minions to cover the enemy curve,
  set-scoped quests/runes, and a baked opponent pool.
- **New spell batch (owner spec 2026-07-23, 28 spells) — building in tranches.** ✅ Tranche A shipped (8:
  Crest of the Climb, Turnabout, Insurance Policy, Rift-Sunk Codex, Beyond the Summit, Invitation Above +
  Set-2 Ruby Shipment & Facetwright's Choice). **Tranche B in progress** (~14 medium), building as sub-slices:
  ✅ **B1** (Field Maneuvers, Last Stand, Executioner's Edge) + ✅ **B2** (Quick Sale, Sigil of Kinship,
  Elevation Ritual) + ✅ **B3** (Layaway, Second Draft) + ✅ **B4** (Strange Revision, Marked Target) shipped.
  ✅ **Encore** + ✅ **Open the Gates** + ✅ **Veinstorm** + ✅ **Hoardflame** shipped — **all of Tranches A + B
  done.** **Tranche C:** ✅ Hourglass Reserve, Funeral on Loan, Rival's Reflection (Discover-based) shipped.
  ✅ Common Ground (two-target via the aim picker) + ✅ Farseer's Report (scout row on the OpponentFrame)
  shipped — **the entire 27-spell buildable batch is DONE.** Remaining: the 2 Dwarf spells (Deepdelve Writ,
  Ironclad Requisition) blocked on a Dwarf tribe; the open **Encore-Rally** ruling; and polish — the Farseer
  scout row is inline-styled (could move to styles.css). **The original ~5
  hard/new-UI: Common Ground two-target, Hourglass Reserve + Funeral on Loan discover-locks, Farseer's Report +
  Rival's Reflection opponent-peek). **Blocked:** Deepdelve Writ + Ironclad Requisition (need a Dwarf tribe).
- **Set-scope quests / runes / heroes** if a set needs its own. `SetDef` has room; the wiring doesn't exist.
- **Profile the PHASE TRANSITIONS, not the FX.** The first perf capture (2026-07-19) puts every bad frame at
  a phase boundary: the worst of the run was 175ms with a 181ms single task, **no FX marks**, sprite pool
  539→0 and heap 109→97.6MB — an allocation + GC signature pointing at the shop roll / board re-render on
  entering recruit. The renderer looks healthy (median 195fps, 4 janks in 115s); `fx:weld` fired 49 times
  and never landed in a bad bucket.
- **Confirm the batched-weld perf fixes with the new HUD**, against a prod build: play to a Banksly/Beatbot
  turn with `?perf=1`, then read `worst`/`jank` and the `fx:weld` suspect line. The 2026-07-19 weld fixes
  were never measured end to end (rAF is suspended in the headless preview).

- **Weld FX: pool the ring `Graphics` + give them their own sub-container.** They're allocated and destroyed
  per weld (unpooled, unlike the particle sprites), and they sit mid-layer between sprite batches, which
  breaks batching. Real but smaller than the fixes already landed (2026-07-19 audit); pooling Graphics would
  be a new pattern for `pixiFx.ts`.
### Combat replay pacing (2026-07-18 audit — the "skipped beats" report)
**PINNED by owner 2026-07-18.** Full findings + handoff:
[`docs/superpowers/specs/2026-07-18-combat-pacing-handoff.md`](superpowers/specs/2026-07-18-combat-pacing-handoff.md)
— read that before picking this up (the first attempt, PR #542, was scrapped on feel; the doc explains the
confound and why the ROLLOUT, not the approach, was the mistake — ship dark behind zeroed dials + tune live).
SoC badge beats shipped (#541). Remaining, in impact order:
- **Contact-anchored advance** — an attack's next beat fires at the GSAP `contact` position; everything
  after contact (crit flourish, flurry wind-slash, rebound/settle) is fire-and-forget and never extends
  the schedule → beats resolve "underneath" long FX then visually catch up. Fix: gate `ctx.advance()` on
  (or add a lead for) the flourish duration, like `deathConsequenceLead` already does for DR-summons.
- **Buff-tendril stat snap** — while a tendril flies the target's badges hold pre-buff values; a beat
  teardown drops the holds → stats snap. Extend the beat by the tendril's `strikeMs` or carry holds over.
- **Badge-never-fired inventory** — ~14 combat flags still have `badgeIdForCombatFlag` mappings but no
  `fireTrigger` call (runeFury, runeForthcoming, runePackcraft, runeSalvage, runeRebirth, runeAftershocks,
  runeTrophy, runeInheritance, runeUndertow, runeSlaying, bloodTrail/deepHunger marks, lawOfTeeth, oldHunt,
  feedingLine, crateringMissive) — mid-combat/reactive flags; decide per flag whether a pulse is wanted.
- **Step-collapse classes** — one Deathrattle's summons+buffs share one step (echo doublers re-fire in the
  SAME step); Avenge payoffs share the death step (only the `avenge` tag separates them); a spellCast
  broadcast (Taragosa Growth + Guel + Weaver reactions) rides the swing's step; Echo Warden copies share
  the original summon's step. Add `nextStep()` seams if these should read as separate beats.
- **Clock config gaps** — `hpGrant` hold is 0ms; `holdMs` keys on raw event type so the `KIND_TO_KEY`
  mapping (e.g. ascend→improve 520ms) is dead code; `questTrigger` holds a content-less 450ms beat while
  the badge pulses in parallel (fixed 1150ms, speed-independent).
- **Step-0 fold** — run-wide auras (Undead/Imp/Beast/Magnetic/card enchants) bake silently into the
  initial board; Fleeting Vigor is baked pre-sim with one un-stepped `sc` narration. Fine if intended —
  listed for completeness.

### Remaining recruit-FX gaps (from the 2026-07-17 buff-animation audit)
The Aura Wash + EoT beat replay closed the big ones — plus the triggered rune buffs (Rune of Kindling /
Scales / Scale) now descend onto their targets. Still open:
- **Buff-on-summon rewards** — Den Marker (quest) buffs a Beast *as it enters play*; the buff-diff can't
  see a card that's new to the board this action, so it's silent. Needs a dedicated descend signal keyed to
  the freshly-summoned uid (not a `captureBuffFx` wrap).
- **One-time `buffBoard` quest reward** — the whole-board buff on quest completion fires at a start-of-turn
  modal moment with no FX; wants timing care before wiring a board-wide descend/wash.
- **Gold-spend feedback** — the Gold counter changes with no flash/shake on buy/reroll/upgrade (only sells
  produce gold visuals; the coin-spray primitive already exists).
- **Recruit-time quest progress** — the badge `questpulse`/`questbounce` fire only off combat deltas;
  shop-phase objective progress updates silently.
- **Quest/rune-node anchored tendrils** — quest and rune EoT rewards replay as sourceless descends; anchor
  them to the quest badge / rune chrome (needs a synthetic source kind in `BuffFxEvent` + a node rect).
- **Rune acquisition burst** — no FX when a rune is bought at the Runeforge.
- **Reroll** — sound + generic card pops only; no shuffle/sweep animation.
- **Descend looks are one-amber** — `descendPresets` has empty byCard/byTribe; give spells tribe/identity
  variants like the tendrils have.

### Build-authorship depth (meta systems)
The depth layer that answers *"what kind of run did I author?"* — comes after the balance/identity work above.
- **Mastery Minions** — normal shop minions that improve through repeated actions (not scheduled, not
  quests): find, nurture, build around. Reference: Archmagus Guel (scales per spell cast). Patterns: improve
  on spells cast / echoes / beast summons / attachments / fodder consumed / damage absorbed. Mostly content +
  a couple primitives; the scaling + live-text infra exists.
- **Ancients** — one-per-run thesis pieces; once chosen, no other Ancient appears that run. Strong,
  run-warping, with a downside. Sketches: Echoes (first Echo each combat doubles; Shouts rarer), Hunger
  (Fodder/Imps scale harder; non-Demons cost more), Steel (first Attachment/turn free; spells +1), Embers
  (every 3rd spell casts Growth; shop minions −1/−1). Pairs well with the quest offer UI.
- **Alignment** — a run-shaping identity/allegiance system (owner's next meta thread). Scope + primitives to
  be specced with the owner before build.

### Rune build-out
Basic + Epic Runeforges ship with 30 basic + 31 Epic runes wired (batches 7a + 7b landed 2026-07-17/18).
Remaining:
- **Spirit Worgen formula divergence** (spotted during Mastery threading): its combat half grants
  `base + spellsThisTurn` while the recruit half grants `base × (1 + spells)` — reconcile with the owner
  which is intended, then align the other half + its combat text.
- **Art:** Epic runes + the batch 7 runes fall back to the sigil glyph — author art.

### New mechanics (depth, later within Next)
Each its own spec when reached: **Balance** (average two units' stats — a shop puzzle), **Mark / Bind /
Curse** (apply Echo-style effects to allies), **Rewind** (start narrow: "repeat the last friendly keyword
trigger"; avoid true undo until the rules are sturdier).

### Open rules question
- **Slaughter doublers on a mutual kill.** The base Slaughter now fires when the killer dies in the same
  clash (2026-07-17), but the re-trigger BONUSES (Law of Teeth, Author's Hand's "first Slaughter each
  combat", Feeding Line) stay gated on `killerAlive` — a dead killer gets its base Slaughter but not the
  extra procs. Decide whether the doublers should also fire on a mutual kill (owner call).

---

## Later

### Tooling
- **`npm run art:wire` churns files it shouldn't** (found 2026-08-14 while wiring three new minions). Wiring ONE
  new card re-encoded 23 unrelated `.webp`s (the encoder isn't byte-stable, so every touched master rewrites)
  and left 622 untracked `.png` intermediates in `packages/ui/src/art/**` — only `.webp` is tracked. Both had to
  be reverted by hand to keep the diff honest. Fix: skip re-encoding when the master's mtime/hash is unchanged,
  and either write the `.png` to a temp dir or gitignore it.

### Combat feel & FX
- **Combat Choreographer — Phase 4 (Authoring).** The channel set (sfx / float / lunge / impact / aura) and
  the 🎬 Choreography panel are shipped. Remaining: per-target staggers / AOE death ripple; `splitPerTarget` /
  `chain` grouping rules (GroupingRules widens past type-set membership); a separate resolution-order tool;
  the impact cue's true-negative offset (fire FX before contact — needs `playLunge` to expose the contact
  position); and the first real re-choreographs as proof.
- **Per-mechanic combat FX.** Deathrattle skull-shatter, Ward dome + shatter, Reborn re-form, buff pulse /
  tendril / descend all shipped. Candidates next: Pixi SoC/Blaster projectiles (replace the SVG bolts),
  poison/toxin kill, big-buff, summon-arrival tuning. Per-tribe looks for pulse/tendril/descend are default-
  only — tune on the preview rigs and bake into the `*_PRESETS` + `*_ASSIGN.byTribe` maps.
- **Keyword-grant bubble pop-in** (4b) — Ward dome / Taunt frame / Rise bubble should POP at grant time
  (granter medallion pulse already ships). Build on a preview rig first, then wire.
- **Buff / FX live eyeballs** — several session-39 cues (summon-arrival poof, `ascend` flash) were reasoned
  from keyframes, not yet watched live on the cream board; drive a focused Chrome tab and tune.
- **Recruit-phase hero/spell buffs** get only a sound + CSS glow today — wire them to `pixiFx.pulse`.
- **`art:` texture prewarm** — an `art:<slug>` texture's FIRST cast after load renders nothing until the texture
  decodes/caches; a prewarm (decode on def-load, not first fire) would close it. Minor residual of the
  committed-art-ships work (shipped 2026-08-17 — the `fx/defs/art/*.png` glob is un-gated, so the coin FX
  (`art:group-14035`), the ruby/shop-buff FX (`art:gemshard`), and `ale-bubbles` (`art:bubble`) now reach
  players).

### Audio
- Record the actual SFX clips into `packages/ui/src/audio/{cards,heroes}/` per the manifest
  (`npm run sfx:manifest`); the drop-folder importer (`npm run sfx:import`) and mixing desk are up. **Hero
  select voiceovers are underway** — `heroes/risen.mp3` (Lord of the Risen) shipped 2026-08-20 as the first,
  proving the whole path end-to-end; the rest of the roster follows as clips are recorded. Reconcile
  the spell default bed with `castspell.mp3`. Deferred desk slots: per-bus compressors, sidechain ducking,
  ingest LUFS-normalization.
- Priority synth-placeholder gaps (per `docs/sfx-events.md`): Ward break, Start-of-Combat cast, poison kill,
  reborn, Fodder eat, magnetic weld; non-attack damage (Blaster AOE, poison) is silent. Master-volume slider
  in Settings.

### UI performance sweep (violates our own banned pattern)
- ~~The turn-charge glyph repaints a large area every frame.~~ **MEASURED 2026-07-19 — NOT a problem. Do not
  "optimize" it.** The suspicion (per-frame `--charge` → `mask-image` recompute = a paint, plus the two
  40px/80px `drop-shadow`s the CSS comment already fingered as "the heaviest bit") was tested with an isolated
  A/B/C harness reproducing the real construction: the actual `turn-glyph.svg`, real 1144×449 geometry,
  SVG∩gradient `mask-composite: intersect`, and the real drop-shadows. Four variants, interleaved, twice each,
  on a 360Hz display:

  | variant | median frame | frames >4.16ms |
  |---|---|---|
  | idle (control, nothing animating) | 2.8ms | 0 |
  | **shipped** (SVG∩gradient + both drop-shadows) | **2.8ms** | 0 |
  | noGlow (same, drop-shadows removed) | 2.8ms | 0 |
  | transform (static mask, transform-only — the proposed "fix") | 2.8ms | 4 |

  Every variant pins to the refresh interval (2.8ms ≈ 1000/360). The glyph sustains ~360fps with **zero**
  frames over the 240Hz budget, and removing the drop-shadows changes nothing — so the CSS comment's
  hypothesis is also disproven. The proposed transform rewrite was, if anything, the *worst* variant on
  outliers. **Caveat:** the harness is refresh-capped, so it proves "none of these threaten the budget," not
  "they cost the same" — it cannot resolve sub-2.8ms differences. It also isolates the glyph from the card
  tree. But the isolated cost is so far under budget that it is not a plausible dominant term.
  Harness: `fx/` — rebuild from the devlog entry if needed.
- `ChargeMotes` runs a second continuous per-frame canvas loop for the whole charge session. Untested; but
  given the glyph result, measure before assuming it costs anything.
- ~~Drag re-renders all of `Recruit` once per rAF via `setDrag`/`setOverZone`.~~ Shipped (2026-07-23, audit
  fix #2): the re-render is now gated on DECISION change (the drop-gap / magnetize / cast / zone signals) via
  the pure `deriveDragDecision`, not on the old 8px position quantum — so a drag re-renders only when something
  visible actually changes (~10–20× fewer than the quantum). `Card` still uses default shallow memo, but fix
  #1's value-stable views keep its props referentially stable across dispatches, so it bails; add a value
  comparator only if a profile ever shows cards reconciling mid-drag.
- ~~Autosave is O(n²) (serializes the whole action log every dispatch) — debounce.~~ Shipped: it now writes
  at turn boundaries only, with a `flushSave` on quit-to-title + tab hide/close. NOT debounced — a timer
  would only have guessed at the commitment point the phase flip already marks exactly.
- Combat replay: 55–86ms synchronous-React-render freezes on some summon/death beats (FX/Pixi/GPU/layout/GC
  all ruled ~0 — it's per-beat render/reconciliation). Profile the flame chart, memoize `computeFrame` + the
  growing per-beat event-log scans. Cheap adjacent win: `syncShields` calls `getBoundingClientRect` per aura
  bubble every frame (~100k calls/combat) — cache the rects, re-measure only on layout change.

### Combat timing clashes (per `combat-timing-audit.md`)
> Full current numbers — every event's hold, every keyword's cost, 36 interactions end to end — are in
> [`combat-timing-reference.md`](combat-timing-reference.md). Read it before tuning any of these.

Remaining: (1) standalone buff waves from a **living** source — the tendril path (`travelMs` 350–780 **plus** a
360ms badge flash) still rides a 210ms hold, so the +N can land ~500–930ms outside its beat; fold the strike
time into the hold. (The *Deathrattle* buff case — which takes the sourceless **descend** path, 340ms + 360ms
flash — was fixed 2026-07-19 by `DR_BUFF_LEAD` 500 ⇒ a 710ms beat.)
(2) CSS combat animations are fixed seconds and ignore `combatSpeed` while holds ÷ and Pixi/GSAP × it. The
`--combat-speed` var now exists and covers the DEATH animations + the floats (2026-07-19) — i.e. every case
that could actually be CUT, since a dying unit unmounts when its beat advances (it was blinking above ~1.31×).
Remaining unscaled CSS (summon/reborn pops, badge/trigger pulses) only OVERLAPS the next beat rather than
being cut, because those units persist — scale them off the same var if the overlap ever reads badly.
(3) overlap tails (`risepop 700`, re-form glow @+460) bleed past their 240ms ride. (4) poison mist
clipped 50ms. (5) the death→consequence 240ms `overlapMs` ride unmounts the dying card partway into its
collapse when a Deathrattle summon/reborn follows (measured live during the blink root-cause hunt — reads
OK in play; tune overlap vs collapse if it ever reads abrupt). (6) config gaps: `hpGrant` holds **0ms**, and
seven event types (`keyword`, `keywordLost`, `ascend`, `reveal`, `spellProgress`, `questTrigger`,
`questComplete`) have no configured hold and silently take the 300→450ms fallback; `ascend`'s `KIND_TO_KEY →
improve` mapping is dead code because `holdMs` keys on the raw event type. (7) crit text runs 1520ms and
outlives its beat by ~650ms.
Also: a dying unit should begin leaving the board in tandem with the other units' Echo/Reborn
effects (the `.dr` collapse hold can trail them) — tune live against the skull-in-own-slot hold.

### Dev tooling
- **Layout Lab extensions:** a shop-row position offset (the tavern zone is `position: static` and hosts
  combat units — needs a combat-safe hook) + per-element movers (individual buttons/badges/panels).
- **Dev stats tracker (tabled):** replay-driven analytics — a headless `npm run track` aggregator over
  persisted replays → per-minion offer/buy/play/sell + win-rate-when-present, per-hero/tribe rollups. Pairs
  with the run-history store.
- **Font Lab** ships always-on — gate behind `import.meta.env.DEV` before a public build.

### Engine / content polish
- **Welded-host live text** — accrued magnitude a host carries from welded magnetics (Better Bot, Harry
  Botter, Heckbinder) is invisible on the host's card; needs host-side weld-text infra to satisfy the
  "card text always states current values" rule.
- Reintroduce a lighter **threat telegraph** (`Omen.tsx` retained, unrendered); **pool "copies remaining"**
  cue + copy-count draw weighting; a subtler Ward indicator; more Fodder-keyword users; decouple the last
  hardcoded card-ids (Hoarder sell, Cling stacking, Yazzus multiplier; Echo Warden / Sylus / Beatboxer);
  unify aggregate auras into the `cardBuffs` map + an "Aura" inspect line; Reborn carries the prior-fight
  Eternal-Knight enchant; Cassen grant fly-to-hand; vendor Build Handoff v2 into `docs/handoff.md`.

### Infra
- **The node-side build config still isn't typechecked.** `typecheck:web` is now gated in CI and the
  `packages/ui` backlog + `CombatReplay.questDelta` are cleared — but `apps/web/tsconfig.json` covers only
  `apps/web/src` + `packages/ui/src`, so the Vite/node files (`vite.config.ts`, `fxDefsPlugin.ts`) are still in
  no TS program. Wire a node-side tsconfig into the gated `typecheck` script to close the last gap.

### Tech-debt watch (fold into whichever PR touches it)
Split `Recruit.tsx` (~2.5k — proposed seams: `recruitViews` / `useCardDrag` / `useLossSequence` / overlays)
and `run.test.ts` (~3.9k → per-area suites); extract `RECRUIT_FACTORIES` from
`recruit.ts` (2k); consider sub-reducers in `reducer.ts` as actions grow.

**Dead-code purge** (audited 2026-07-29 — the old estimates were wrong in four places; see
[`docs/dead-effect-ids.md`](dead-effect-ids.md) for the method and the evidence):
- ✅ **Dead CSS — done.** The OMEN block, `.chip`, `.toast`, `.legend`, `.tavernbox`, `.zt`/`.zh`/`.hint` and
  the `.emberproj` popup (reachable only via `.chip.g:hover`, so dead with it) are gone. **`.disc-gem` and
  `.ob` were NOT dead** and stay: `.disc-gem` is rendered by `Recruit.tsx` and its rule is a deliberate
  `display: none` (deleting it makes the gems reappear), and `.ob`'s base rule still feeds the odds bar's
  `.oddsbar .ob.win/.draw/.lose` segments.
- ✅ **The orphaned Pixi aura-bubble system — DONE.** The whole persistent-bubble subsystem is gone:
  `setShield`/`clearShield`/`setShieldsVisible`/`hasAura`/`auraRect`/`breakShield`/`shieldPop`, the `shields`
  map, `ShieldBubble`, `shieldLayer`/`shieldGeo`, ~210 lines of GLSL, and the **third** full-viewport WebGL
  `Application` (`shieldApp`, after the main canvas and `discoverFx`) with its `underParent` mount contract —
  which a previous pass had only ticker-stopped as "dormant". `shatterAt`/`rebornSummon` are kept, still fired
  by the death-burst/reborn path via `choreo/channels/aura.ts`. Total emitted JS −13,452 bytes, measured.
- ⬜ **69 dead effect-factory ids** (not ~17): the verified inventory is in
  [`docs/dead-effect-ids.md`](dead-effect-ids.md), each with the files to sweep. Engine-owned; re-run the
  sweep first, since an id goes live the moment one card adopts it.
- ⬜ **`reAttackOnKill`/`REATTACK_GUARD`/`reAttackCache`.** No card uses the id, but the machinery in
  `minion.ts` + `simulate.ts` is live code — deleting it removes a working mechanic, so it's an owner call
  rather than a pure cleanup.
- ❌ **`battlecryGrantKeyword` is NOT dead** — `cards/set1/beasts.ts` uses it twice. Struck from the purge.
- ❌ **The Reborn-tears DOM is already gone** — nothing left to remove.

---

## Parked

- **Withheld heroes** — Warden, Myra, Chaos are `wip: true` (in the registry, hidden from the picker) pending
  a rework; Herald was removed outright. Re-enable by clearing `wip` when ready.
- **Enemy Start-of-Combat effects** never fire (`simulate` runs the SC loop over the player board only, per
  A.3 step 1). Owner to rule whether pool-captured enemy boards with SC minions should stay inert.
- **Player Leaderboard migration** — the `profiles` table (top players by rating) needs `schema.sql` re-run
  (idempotent; dormant until then, shows the empty state). Trust model: anon may upsert any row by name.
- **Board fight-tracking** — leaderboard records + Career board log are built but dormant until the
  `board_results` table lands via a `schema.sql` re-run.
- **Leaderboard W/L spread for old rows** — the Hall of Champions round-spread only populates for victory runs
  logged after the `runs.history` column shipped; older rows have no per-round order. Optional backfill via
  replay re-simulation.
- **Autosave size lever** (only if it ever needs trimming): store a pool `id` reference for always-resolvable
  committed/synthetic pinned opponents instead of the full snapshot; keep full snapshots only for remote/self
  boards that can vanish.
- **Heroes backlog** — 9 exist (named + art). More are a `HeroDef` + only-if-novel a new power `kind` (cheap
  kinds left: one-shot gold/mana, reroll discount, token summon). Unwired: TitanHP power-master matches no
  hero; Nadja has no power-master art.

---

## Public Release

The hardening gate before ASCENT faces a public (non-friend-scale) audience.

- **Decide whether `main` should actually be protected.** It is not, and apparently never has been: no
  classic branch protection (the API 404s) and no rulesets — verified 2026-08-05, when a
  `gh pr merge --squash` went straight through with no review, against a CLAUDE.md line asserting that was
  impossible. The repo is already public, so a stray force-push or a merge of a red PR is a real exposure
  rather than a hypothetical. A ruleset on `main` requiring a PR plus the `verify` check would close it in
  about a minute. **Deliberately not configured unilaterally — repo settings are the owner's call**, and the
  docs now describe the actual state either way (see CLAUDE.md, "`main` is always playable").

- **Authentication + accounts.** **C1 SHIPPED 2026-08-03** — identity is now a server-issued `user_id`
  (anonymous sign-in, no login screen), every content row carries its owner, and RLS accepts a write only when
  `auth.uid() = user_id`. The rating column is locked against self-edits. **The `schema.sql` C1 block was run
  against the live project** (owner, 2026-08-09) — so the `to authenticated` policies are real, not just
  committed. Remaining:
  - **C2a — real accounts (email code / magic link) SHIPPED 2026-08-09.** Sign-in/account UI + email:
    `updateUser({email})` converts the anonymous session in place (same `user_id`, history intact),
    `signInWithOtp` signs a returning player into their existing account on a fresh device. Completion works by
    a typed 6-digit CODE (`verifyEmailCode`, the desktop/exe path — no web origin needed) OR a clicked link on
    the web. Identity is now portable across devices and survives a site-data wipe. Purely client-side (email
    lives in `auth.users`), so no schema change. **Needs the Supabase email templates to include `{{ .Token }}`**
    (Magic Link + Change Email Address) so the code is delivered.
    **Mail provider is a two-stage plan (2026-08-17).** Owner testing found sign-in email reaching only the
    owner's inbox — Resend's unverified-domain gate permits sending solely from `onboarding@resend.dev` and
    solely *to* the Resend account owner's address. **Fixed for now by moving Supabase's custom SMTP to a
    dedicated Gmail account over `smtp.gmail.com` + App Password**, which has no recipient allow-list and needs
    no domain, so friends/testers can link accounts today. It is a BRIDGE: ~500/day, From forced to the Gmail
    address, outside Google's terms for bulk sending. **At full release, move to Resend on the verified release
    domain** (`noreply@<domain>`) and revoke the App Password. Both runbooks in
    [`supabase/README.md`](../supabase/README.md). Rejected: Supabase's built-in mailer — 2/hour, and the Free
    plan's lowest grantable role is Developer (content access to the live project), so it would trade database
    access for a test email.
  - **C2b — handles + offline queue SHIPPED 2026-08-09.** The `Kevin#4821` discriminator (`profiles` gains
    `discriminator` + a unique `(lower(author), discriminator)` index, assigned client-side with
    retry-on-conflict) + denormalised `profiles.email`; the offline upload queue (queues every write path to
    localStorage when no session is live, flushes when one lands) + the `unrated` tag (a run finished offline
    doesn't submit ladder rating and its rows carry `unrated = true` for the C3 audit). **Needs the C2b block
    in `schema.sql` run** — the new columns + index; column writes degrade gracefully until then.
  - **C3 — server-authoritative rating SHIPPED 2026-08-09.** The `submit-rating` Edge Function
    (`supabase/functions/submit-rating`) is the ONLY writer of `profiles.rating`: a client sends
    `{runId, placement}`, the function derives the rating server-side from the stored value + the shared
    placement table (parity-tested), dedupes via `rated_runs`, and rate-limits. Client falls back to the legacy
    RPC only until deploy. **Needs the owner to deploy the function + run the C3 SQL block** (see
    `supabase/README.md`) — until then it isn't enforcing and the client uses the fallback.
  - **C4 — deferred replay audit** (~2 d): out-of-band re-simulation of the top of the ladder + a random
    sample, patch-pinned, flagging for review. Catches the false-placement claim C3 leaves open.
  - **C5 — Steam provider**: slots into the existing `AuthProvider` seam without touching C1–C4.
- **Server-side replay validation.** A Worker re-derives boards (and rating) from the `{seed,heroId,actions}`
  replay before trusting the client → fabricated boards / inflated ratings aren't reproducible. DB-independent;
  opponent pinning (`servedBoards`) already makes a run's opponents reproducible regardless of pool drift.
- **CDN-front the read path** — serve the opponent pool from a static/edge blob, never hit the DB on boot.
- **Leaderboard hardening** — server-side rating re-derivation before trusting a submission; split games-played
  into wins/losses or add a min-games gate so one lucky run can't top the board.
- **Onboarding / FTUE** — scoped in full by [`ftue-master-blueprint.md`](ftue-master-blueprint.md) (owner's
  blueprint, adopted as the FTUE source of truth 2026-08-17; it replaces the one-line "shop → hand → board →
  Shout → threat → combat" sketch that used to sit here, and supersedes the FTUE sections of
  `tutorial-curriculum-map.md` + `tutorial-and-trials-spec.md`). Three layers: a **12-round universal "Learn
  Ascent" lobby** (10 guided + 2 autonomous, tutorial-only hero *Aster*, every enemy an effectless `omen`),
  five optional **6-round tribe primers**, and one-time first-real-lobby hints. Hard rules: use the real
  reducer/simulator (never fake outcomes), never touch rating/history/telemetry, never write Beat Lab timing.
  - **Phase 0 — lock the contract. DONE 2026-08-17.** Blueprint in-repo, old docs marked superseded, this
    entry rewritten, presentation spike run.
  - **Presentation-contract spike DONE** — [`ftue-spike-presentation-contract.md`](ftue-spike-presentation-contract.md).
    Verdict: the semantic signals the blueprint needs largely EXIST (`livePlayer`'s beat activate/complete,
    719 `PRESENTATION_POLICIES` keys, `key`/`srcCard` event stamping, compiled `completionOffsetMs`). The gap
    is coverage: choreographed combat pacing is off by default and keyed-triggers-only. Risk HIGH → MEDIUM.
  - **Phase 1 vertical slice — LARGELY DONE 2026-08-17 (Round 1 live-verified end-to-end).** Shipped: the
    `tutorial` RunMode (a distinct mode, excluded from rating/telemetry/damage-double-charge), the authored
    omen lobby (`authored` seat kind + `createTutorialRun`), the scripted Shop seam in `rollShop`, Aster the
    Guide (tutorial-only hero, active +1/+1 every-other-turn), the pure course/step/predicate type contract +
    predicate evaluator, `learnAscent.ts` (4 real rounds, Round 1 fully coached), the DOM anchor registry +
    focus mask + coach panel, the localStorage tutorial profile (New/Introduced/Demonstrated), the
    `TutorialController` runtime driven by an action bus + a read-only combat-presentation bus, and a **Learn**
    button on the Title. Verified live: launch → foundation panels → lobby intro → buy/play/Preparation/End
    Turn/Rally/win → Round 2.
  - **Phase 1 — COMPLETE (12 rounds authored, playable end to end).** DONE: all coaching + gating (per-card
    for buy/play/sell), first-launch welcome, save/resume, R1 keystone through R12 graduation. R8 gilding +
    Discover (Triple Reward), R9 spells, R10–12 supervised independence, and a `TutorialGraduationScreen`
    hand-off into the real game. Combat tuning: fixed run seed, R1 forced first-strike, R3 forced enemy target
    (T-Rex dies for the Echo payoff), R7 board-space lesson.
  - **Phase 1 follow-ups (polish, not blockers):** the interactive order-demo silhouette drag (a
    read-and-continue panel stands in today); a dedicated **Runeforge round** (deferred — needs the three Basic
    Rune IDs approved, see "Blocked design work" below); and true free-pool shops for the independence rounds
    (they use curated scripted offers today).
  - Phases 2–4 author Turns 1–5, 6–10, and autonomy/graduation (~6–8 wk). **Tribe primers (Phases 5–6) and
    Tactical Trials are DEFERRED** — ship Learn Ascent to private testing first.
  - **Blocked design work:** §6.8's three Basic Rune branches need real Rune IDs approved against current
    content (affordable, each visibly changing a combat, all converging to Turn 7). Gates Phase 3.
  - **Accepted coupling:** pinning to a `contentRevision` with CI drift-failure freezes the twelve minions the
    course uses — retuning any of them becomes a tutorial re-authoring task.
- **Accessibility** — keyboard nav, screen-reader labels, reduced-motion, colorblind-safe threat/tribe cues.
- **Touch** support + the COMPACT-fan hand redo.
- **Distribution** — WebP art is done (4.3 MB); decide web (CDN / versioned deploy) vs a desktop **exe**
  beyond the itch zip. An **Electron shell now exists** (`apps/desktop`, `npm run package:desktop`) and the
  build runs unmodified in it — but it is a TEST HARNESS, not a release: no installer, no code signing, no
  icon, no auto-update, and no CSP. Electron was chosen over Tauri for a pinned Chromium (Tauri's WebView2
  version varies per machine, which is poor for a frame-time-sensitive game). Note electron-builder cannot
  run here — Defender quarantines its `app-builder.exe`; `scripts/package-desktop.mjs` packages by hand. Seed the hero-choice roll (still uses `Math.random` in the UI) for
  daily seeds.
