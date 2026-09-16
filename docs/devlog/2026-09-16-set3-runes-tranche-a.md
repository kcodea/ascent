# 2026-09-16 — Set 3 rune batch 2, tranche A: the Spirit / Celestial / Undead runes

**What shipped.** 24 Set 3-only runes from the owner's 2026-09-16 sheet (11 Basic in `RUNES`, 13 Epic in
`EPIC_RUNES`, each under a `// ── Set 3 batch 2 (2026-09-16) — tranche A ──` header so the sibling tranches
merge cleanly) plus the rune-exclusive **Handy Flame** token (`sp3_handyflame`, Spirit T5 2/13, `token: true`,
no art yet). Set 3's static rune pool moves from 115 / 98 to **126 Basic / 111 Epic**.

**Owner rulings applied.**
- Every rune is `sets: ['set3']`; tribe-gated with `tribes` where the text names a tribe (the Festival Circuit
  and the Spirit Crown carry `['spirit', 'celestial']` — an ANY-OF gate, like every `tribes` list).
- Tribe drips reuse `runeTribeDrip` and the Dwarf/Kobold verbiage (`Get a **Spirit**. Repeat every **Start of
  Turn**.`). The tier cap was verified in `payTribeDrip` (`c.tier <= s.tier`) — no fix needed; a test pins it.
- The sheet's second "Rune of the Crown" collided with the existing Epic (after 6 Shop spells, +4/+4). It ships as
  **Rune of the Spirit Crown** (`rune_spirit_crown`).
- **Deferred, not built:** Rune of the Open Hand (a combat hand-summon hook) and Rune of the Waking Reserve (a
  Start-of-Combat summon). Both live in `packages/core/src/combat/simulate.ts`, reserved for a sibling tranche;
  a half-built shop-only version would have printed a promise the fight never keeps.

**Engine.** Most runes reuse existing kinds: the tribe drips, `recurringGrant` (Falling Embers' Star Crash),
`grant` (the Handy Flame), and the `runeThreshold` engine on a NEW `playSpirit` meter (ticked in `playCard`
beside `playDragon`) with a new `hand` buff target — that is the whole of the Full Hand and the Spirit Crown.
New reward kinds (schema + `QuestReward` + reducer cases): `runeChosenVessel`, `runeDeepCurrents`,
`runeRevelerDrip`, `runeRevelerExtra`, `runeGrowingChorus`, `runeChartedSkies`, `runeStarCrashBonus`,
`runeFestivalWages`, `runeMeteorShower`, `runeAstralRefrain`, `runeAstralDraft`, `runeDreamMirror`,
`runeWakingDreams`, `runeSharedRevelry`, `runeProcessionPlay`, `runeFestivalCircuit`. Dispatch sites, each
at the single chokepoint the rule names:
- `fireSpiritPlayRunes` (recruit.ts, from `playCard`) — Chosen Vessel, Deep Currents, Growing Chorus, the
  Grand Procession rune.
- `fireOnSell` (Shared Revelry: one extra full fire per copy, per Reveler type per turn) and
  `fireOnMinionSold` (Festival Wages arms `nextCardFree`; the Festival Circuit's Celestial grants).
- `noteSpellCast` — a new `shopSpellIdsThisTurn` list (Gifts excluded: a spell cast, never a Shop spell) drives
  Charted Skies, the Astral Refrain and their `x/3` tallies; the Meteor Shower keys on `starcrash`.
- **"A minion in your hand gains stats"** is a generic hook: `fireStatGainReactors` runs on the reducer's
  per-action stat diff (the same boundary as the `onGainAttack` board diff), dispatching the new
  `onGainStats` trigger (Handy Flame, `onGainStatsBuffRandomHand`) and then the Dream Mirror / Waking Dreams
  over the hand gainers. Bounded by construction: reactors resolve once per action and board gains are not
  re-diffed. **Combat does not emit `onGainStats`** — the Flame has no combat half yet.
- `offerBuyPrice` + both spell-buy paths honour `nextCardFree` (a minion OR a spell, either row); `spendFreeCard`
  spends one charge per free buy.
- `spellCasts(state, def, card?)` adds a per-instance `BoardCard.extraCasts` (the Astral Draft stamps its
  Discover pick via `DiscoverSpec.extraCasts` → `discoverExtraCasts` → the pick). The hand ×N badge passes the
  instance, so it previews the extra cast. `extraCasts` is classified `capture: shop-only` in the snapshot
  registry.
- Star Crash's factory folds `starCrashBonus` (Falling Embers) into both landings; `spellDisplayText` prints the
  live total in place (`{{+7/+9}}`), threaded through the shop / spell-slot / hand / preview chains as
  `starCrashBonus`. Shop casts only — a combat Star Crash does not read it.

**Live text / tallies.** `runeTally` branches for the Growing Chorus, Charted Skies, the Astral Refrain, the
Grand Procession, the Festival Circuit (`x/N`), the Traveling Festival (what a sale pays now), Falling Embers
(the current extra) and Festival Wages (`next card free`); the threshold runes read the generic meter.
`questText` learned the `playSpirit` meter and the `hand` target for the badge's reward line.

**Interpretations worth a second look.**
- Traveling Festival's "an additional +2/+2": on the stat(s) the Reveler pays (Flame +2 Attack, Tide +2 Health,
  Grove +2/+2), not +2/+2 from a Flame.
- Growing Chorus's "improve your Reveler values by +2/+2": the shared Reveler value rises by 2 (it is one number
  that pays both stats). Multiplied by Improve reps under Rune of Mastery.
- Deep Currents' "2 random Spirits": friendly Spirits on the BOARD, the played body eligible (Aspect's reading).
- Festival Wages' "your next card": the next Shop buy, minion or spell; the charge carries until spent.
- The Astral Draft pays a Discover immediately on purchase (the "Get X. Repeat every Start of Turn" rule).
- The Grand Procession rune returns a PLAIN copy (base stats, never golden), like the card.

**Verification.** `set3RunesTrancheA.test.ts` (56 tests: roster/scope/gates, one behavioural test per rune,
the tier cap, live text, tallies, the Handy Flame chain); the roster counts in `runes.test.ts` /
`set3RuneRoster.test.ts` moved deliberately; the wiring audit, tally coverage, policy tripwire, rune preview and
snapshot fidelity suites all green; `npm run typecheck && npm run lint && npm test && npm run audit && npm run
text:audit && npm run build:web`.
