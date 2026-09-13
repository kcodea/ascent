# 2026-09-12 — Set 3 Celestials: the Starform roster (16 minions + Accretion + the Stellar Lens)

**What.** The content half of the Starform (the engine landed the same day — `2026-09-12-starform-token.md`):
sixteen Celestial minions, one Celestial spell and one Equipment that create, feed and cash in the token
(owner spec 2026-09-12). Ids `ce3_*`; all art `ART_PENDING`. Every card plain AND gilded goes through the real
`reduce` in `packages/sim/src/set3CelestialRoster.test.ts` (44 tests), plus the pairwise matrix the owner asked
for. The card-level rulings are appended to the Starform section of `docs/GAME-RULES.md`.

| Tier | Card | Effect | Factory |
|---|---|---|---|
| 1 | Star Seed 2/1 | Shout: create a Starform, or +2/+2 to the one you have | `battlecryCreateStarformOrBuff` |
| 1 | Dawn Sentinel 1/3 Taunt | Echo: a random friendly Celestial +2/+1 (both phases) | `deathrattleBuffRandomTribe` (data only) |
| 2 | Stardust Peddler 2/3 | Whenever you buy a minion, your Starform +1/+1 | `onBuyBuffStarform` |
| 2 | Wishing Star 2/3 | Shout AND Echo: this shop +2/+2 | `buffThisShop` on both triggers |
| 3 | Accretion Warden 3/4 | Shout: the Starform eats the highest-Tier Shop minion | `battlecryStarformConsumeShop` |
| 3 | Shooting Star 3/2 Flurry | Shout: this shop +3/+3 per Shop spell cast this turn — live text | `battlecryBuffThisShopPerSpellsThisTurn` |
| 3 | Eclipse Warden 3/6 | Avenge (3): get a Star Crash | `avengeGrantSpell` (data only) |
| 4 | Orbit Keeper 3/6 | EoT: Starform +2/+2; SoT: create one if none | `endOfTurnBuffStarform` + `startOfTurnCreateStarform` |
| 4 | Corona Devotee 4/5 | Shout: consume the Starform, gain all its stats | `battlecryConsumeStarform` |
| 4 | Star Charter 3/4 | Shout: Discover a Celestial | `battlecryDiscoverMinion` (data only) |
| 5 | Lens Grinder 5/6 | Equip Stellar Lens (2): this shop +10/+10 | `grantEquipment` → `equipmentBuffThisShop` |
| 5 | Lodestar 5/9 | Echo: a friendly Celestial gains this minion's MAX stats (both phases) | `deathrattleGiveMaxStatsRandomTribe` (arena) |
| 6 | Twin Star 6/8 | Whenever your Starform gains stats, this gains the same | `onStarformGainedBuffSelf` |
| 6 | Nova Herald 6/9 | Shout: collapse the Starform; 3 random friendly Celestials each gain half | `battlecryCollapseStarform` |
| 7 | Zenith 8/12 | Any spell: Starform +3/+3; rebuilt at half after a consume / collapse | `spellCastBuffStarform` + `onStarformRemovedRecreateHalf` |
| 7 | Constellation Prime 9/9 | Your Star Crashes land the primary an extra time; Shout: 2 Star Crashes | `primeExtraPrimaryLands` (id-read, the Yazzus shape) + `battlecryGrantSpell` |
| spell 3 | Accretion | The Starform eats the highest-Health Shop minion; get a Star Crash | `spellStarformConsumeShop` + `spellGrantSpell` |

**How — the decisions a future session would otherwise re-derive.**

- **"This shop" is the row, not the channel.** The spec named `addTurnShopBuff`, but that channel is inherited
  by every reroll this turn (Night Market Horror's semantics), which contradicts the spec's own test line
  "(the Starform keeps it, the others lose it on refresh)" and the owner's 2026-07-25 vocabulary ruling that
  "this shop" only touches the offers currently in the row (Apples). `buffThisShopOffers` bakes the buff per
  offer under the card's name; the Starform keeps it by rule 6. Twin Star hears it through the action-boundary
  diff in `reduce`. The Stellar Lens has a params-only twin (`equipmentBuffThisShop`): an Equipment activation
  passes the real (possibly gilded) source, and its doubling already rides `gildedParams`, so the golden-aware
  factory would have doubled a gilded Grinder's Lens twice (caught by the test: 41/41 instead of 21/21).
- **Constellation Prime is inside the Star Crash factory, not in `spellCasts`.** "Casts an additional time"
  with the owner's clarification "primary twice, secondary once" cannot be a whole-spell cast multiplier (a
  rep loop re-runs the secondary too). `spellBuffTargetAndRandomFriendly` lands the primary
  `1 + primeExtraPrimaryLands(state)` times per cast and the secondary once. With a Comet the three casts each
  re-land the primary (a lone body takes +45/+63) — every multiplied cast is a Star Crash, and the Adept's
  spreads get it too. **Assumption to confirm with the owner:** "stacks additively with Comet" was read as
  "both apply"; if the owner meant a flat 1 + 2 + 1 = 4 landings per cast, the extra needs to move out of the
  per-cast body.
- **Star Crash on the Starform** goes through the existing `castSpellOnOffer` fold (the token's identity is
  never rewritten; the delta rides `buffStarform`). The reducer only lets a `friendly` spell reach the token
  when `starformSpellAimsToken(def)` (a Celestial-aimed friendly spell — Star Crash) says so, so a plain
  `friendly` gild / destroy / transform keeps its board-only aim and rule 5 stays whole. The UI reads the same
  gate: the per-drag rect cache holds only the `.starform` card for such a spell, `DragGeo.starformUidAt` is
  the hit-test, and the token highlights as a target.
- **Accretion (spell) with no Starform still grants its Star Crash** — the owner did not say; the grant is
  unconditional and only the consume needs the token. `spellGrantSpell` exists because `battlecryGrantSpell`
  reads `self.cardId` (a rune check) and a cast factory's `self` is the target, undefined for an untargeted spell.
- **Zenith's rebirth** subscribes to `starformRemoved` and filters on reason `consume | collapse` (a Demon
  eating the token is a consume). The new token is `createStarform` then `buffStarform`ed to
  `ceil(full/2) − 1` above its base 1/1; gilded carries the full stats. A second Zenith finds a token already
  out and stands down.
- **Nova Herald with a token but no Celestial** — impossible while the Herald is on the board (it is one); a
  token with only non-Celestials beside it buffs the Herald alone; no token → nothing (owner). Gilded = each
  recipient gains the full stats (double the half).
- **Zenith counts Rubies** (`includeRubies`, the Gravestar Seer ruling: "a spell" is any spell). **Shooting Star**
  reads `spellsThisTurn` (the Spirit Worgen read: a multiplied cast counts each time, Gifts included as casts).
- **Doc Bot.** Six new Shout/Echo factories are `PHASE_EXCUSED` `no-surface` in combat (no shop mid-fight);
  five roster cards are `PLAY_EXCUSED` (the clean fixture stages no Starform / no spell this turn / no Celestial
  tribe); Shooting Star classified `conforms` under R-TURN-01; the unresolved-parse pin moved 55 → 61 for six
  Starform-vocabulary shapes; `familyDrivers`' vanilla-body sabotage picker now skips `PLAY_EXCUSED` cards
  (it had started picking Shooting Star, which the fixture cannot make act). `npm run docbot:sync` + the
  report's 26 headline numbers updated; 73 lanes green.

**Tests.** `set3CelestialRoster.test.ts` — every card plain + gilded; Star Seed × existing token; Peddler ×
dismiss-buy / normal buy; Wishing Star Shout/Echo × refresh; Accretion Warden ties; Shooting Star 0/1/3 spells
(+ live text in `cardText.test.ts` / `instView.test.ts`); Eclipse Warden's Avenge window in `simulate()`;
Orbit Keeper EoT/SoT with and without a token (SoT into a full row); Corona Devotee with/without; Star Charter
never offers itself or the token; Stellar Lens plain / gilded / one charge; Lodestar damaged-then-buffed = max
stats in combat + the shop Echo; Twin Star × buff / shop-buff / consume / Star Crash-on-token; Nova Herald
3/2/1/0; Zenith spell growth + rebirth after consume AND collapse (not dismiss; into a full row); Constellation
Prime primary×2 secondary×1, × Comet, gilded; Accretion highest-Health + tie + no token + Comet; Star Crash
aimed at the token (+ an ordinary offer refused, + Prime). `dragDecision.test.ts` pins the UI aim.
