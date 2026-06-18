# ASCENT — development log

Newest first. Each entry records **what changed and why**, plus how it was verified. The forward
queue lives in [roadmap.md](roadmap.md); high-level milestones in [../CLAUDE.md](../CLAUDE.md).

## 2026-06-18

### Tribe-coloured card edges
- Every minion card now flags its **type by its outer edge**: a tribe-coloured ring (Beast green,
  Dragon orange, Mech teal, Undead slate, Demon purple, Neutral tan) plus a soft same-hue glow.
  **Dual-types split the rim half-and-half** (Heckbinder → Demon purple / Mech teal) via a
  pseudo-element gradient rim (a `box-shadow` can't be two colours). Driven by the existing `--c` /
  `--c2` card vars, so it's data-free.
- The edge previously did double duty for keyword cues; reconciled so **tribe owns the rim**: Divine
  Shield and Reborn keep their pulsing glow but as an **outer halo** layered around the tribe ring
  (DS = tribe ring + gold halo; Reborn = tribe ring + blue halo); Taunt now relies on its shield-ward
  badge and Stealth on its faded look (their edge rings dropped). Golden / spell / Triple Reward keep
  their special gold / purple frames (the tribe edge is suppressed there).
- CSS-only. `typecheck` + `lint` + `test` (**131**) clean; verified live across all six tribes, a dual
  (split rim), a Divine-Shield card (teal ring + gold halo), a Reborn card (slate ring + blue halo),
  and a golden (gold frame preserved) — 0 console errors.
- **Tuned per feedback:** thicker ring (3 → 4px) + a more saturated glow so the type colour reads at
  a glance (the DS / Reborn outer halos and the dual split rim were scaled to match).

### Toxin Tender — player-targeted Battlecry
- Toxin Tender's Battlecry is now **player-targeted** (like the Warden's Hero Power): play it to the
  board, then aim a glowing line at any friendly minion and click to grant **Venomous** to *that*
  minion. Built on the deferred-resolution pattern (mirrors Choose One): `CardDef.target: 'friendly'`
  makes `playCard` fire onSummon but **defer** the Battlecry; the reducer parks a `RunState.pendingTarget`;
  a new `battlecryTarget` action resolves the grant on the chosen minion. `battlecryGrantKeyword` is now
  target-aware — an explicit target wins, else it auto-picks the highest-attack friend lacking the
  keyword (so **Plaguebringer keeps its auto behaviour**). An unresolved target **auto-resolves on the
  carry** if the turn ends first, so the play is never stranded.
- UI: a `pendingTarget` aim-line effect (mirrors the Hero Power's) + an accent prompt — "Choose a minion
  for Toxin Tender's Battlecry"; the board minions arm and the played minion's drag is suppressed so a
  click targets rather than drags.
- +3 sim tests (defer-then-grant on the chosen minion — not the higher-attack carry; end-turn
  auto-resolve on the carry; Plaguebringer still auto-grants) + updated the old auto-grant test.
  `typecheck` + `lint` + `test` (**131**) clean; verified live (play → pendingTarget + prompt;
  `battlecryTarget` grants Venomous to the chosen minion, not the highest-attack one; 0 console errors).

### Finite minion pool (draw-from + return-on-sell)
- Wired the shared, finite minion pool the engine was scaffolded for. Each run stocks
  `POOL_QUANTITIES[tier]` copies of every buyable minion of its active tribes (+ neutral) into a new
  `RunState.pool`. The shop **draws from it** — `rollShop` / `topUpTavern` decrement on draw, a full
  reroll returns the discarded offers first, and a card at **0 copies stops being offered** (the shop
  just offers fewer cards). **Selling returns** copies (a golden returns 3, since it ate three), and
  **conjures** (Discover, Buddy Buddy) take a copy so selling them stays balanced. Tokens / Fodder /
  spells are never pooled. Old saves heal (re-stock) on `deserialize`.
- **Quantities** (per the user): T1 **10**, T2 **9**, T3 **8**, T4 **7**, T5 **6**, T6 **6**.
- **Draw weighting unchanged** — I gate by availability rather than weighting by remaining count, which
  keeps the exact draw sequence from a full pool (so every existing seeded test is undisturbed) while
  delivering depletion + return. Copy-count weighting (a drained card appearing less often, BG-style) is
  a noted refinement; a "copies left" UI cue is queued too (the pool is currently invisible).
- +5 sim tests (stocking, copy conservation across buy/reroll/sell, sell-returns incl. golden ×3, a
  depleted card never offered + an empty pool offering nothing). `typecheck` + `lint` + `test` (**129**)
  clean; verified live (pool stocks the Target Dummy at 10, rolls draw from it, no console errors).

### Buff-panel fit + Combinator welds random Mechs
- **Buff inspect panel fits any number of sources.** Widened the breakdown (max-width 150→252px) and
  added a `max-height` + vertical scroll, so a heavily-buffed minion (e.g. `Karwind ×128 +209/+418`
  alongside a dozen other sources) shows every row. The source name flexes/ellipsizes only if a name is
  unusually long, while the `+atk/+hp` amount is pinned always-visible (`flex: 0 0 auto`). Verified live
  with 12 sources incl. 200+ buffs — all fit, nothing clipped, scroll kicks in past the height cap.
- **Combinator welds onto RANDOM Mechs (per proc).** It used to pick the 2 *highest-Attack* friendly
  Mechs (deterministic). Now it picks 2 at **random**, fresh each proc — so Chronos repeats spread to
  different Mechs. The pick is seeded by (run seed, wave, the Combinator's board slot, proc) through a
  new shared `magnetizeTargets()` helper (exported from `@game/sim`), so it's reproducible **and** the
  recruit UI derives the exact same uids to electrify — the visual stays in sync with the actual welds
  without restructuring the recruit→combat flow. +1 sim test (over 24 seeds the welded pair shifts
  around, where the old highest-Attack logic always picked the same two).
- `typecheck` + `lint` + `test` (**125**) clean; buff panel verified live.
- *(Re: pool quantities — answered the user inline: the shop currently samples with replacement from
  the eligible pool with no finite per-tier counts; `POOL_QUANTITIES` remains an unwired placeholder.)*

### Tavern control bar restyle (toward the Pixel Arena mockup)
- Reworked the shop control bar to match the user's mockup. Cost/tier numbers are now **large, bold,
  colored inline** with **no pill** (the earlier teal-pill cost treatment is dropped). The **Refresh**
  cost is bold teal Mana; the **current-tier** indicator's number is bold tangerine.
- The current-tier indicator (`.tavernbox`) gained a **house icon**, the bigger orange tier number, and
  a solid border (was dashed). The **upgrade button** got the same house icon (new `house` glyph added
  to `Icon`) and keeps **"Tavern Up" + the teal Mana cost** (→ "Tavern MAX" at cap).
- **Design note:** the mockup's leftmost "Tavern · Tier 6" is the *current-tier indicator*, not the
  upgrade button — so the "Tavern · Tier N" wording lives there, and the upgrade button stays "Tavern
  Up" to avoid showing "Tavern · Tier" twice. (Together they satisfy "tier wording + cost": the tier on
  the indicator, the cost on the button.)
- `typecheck` + `lint` clean; verified live — bar reads "🏠 Tavern · Tier 1 · Refresh 1 · Freeze · 🏠
  Tavern Up 5 · End Turn" with bold colored numbers, and a forced re-render + real roll logged zero new
  console errors.

### Gnasher vs Reborn, golden Brood Matron, Imp rename, Spirit of the Pack cut
- **Gnasher re-attacks after killing a Reborn target.** Dropping a Reborn minion to 0 revives it
  (`killOrReborn` returns it at base stats and leaves `dead` false), so the on-kill check
  `target.dead || target.health <= 0` read false and Gnasher's re-attack never fired against a Reborn
  body. Now `performAttack` snapshots the target's Reborn availability before the swing and counts a
  *consumed* Reborn as a kill too — so Gnasher keeps swinging through it. +1 sim test (Gnasher clears a
  lone Reborn Grave Knit in exactly two swings, the enemy never getting to attack — which fails under
  the old check).
- **Golden Brood Matron breeds two Imps per death.** `onFriendDeathSummon` summoned `1 + echoBonus`
  regardless of golden; it now uses `mul(self) + echoBonus`, so a golden Brood Matron makes **2** Imps
  per friend death (Echo Wardens still stack on top). Added explicit `goldenText` + 1 sim test (golden
  → 2, plain → 1).
- **Imp Scrap → Imp.** The Brood Matron token is renamed to **Imp** (id stays `impscrap`, so Brood
  Matron's `tokenId` param and the existing tests are untouched) and now has illustrated art.
- **Art wired:** Brood Matron (`BroodMatron.png` → `brood.png`) and the Imp token (`Imp.png` →
  `impscrap.png`), both 512×512 — verified loading live. Wired-art count is now 32.
- **Spirit of the Pack (`pack6`) removed.** The tier-6 Beast (Deathrattle: all Beasts +4/+4) is cut
  from the set and its art file deleted. The one test that used it as a buff-Deathrattle vehicle now
  uses **Grim** (+6/+6), which remains the board-wide Beast buff; `useCombatReplay` comments updated to
  match.
- **Tavern Up cost emphasised.** The upgrade button's cost is now larger (22px, bold) inside a teal
  Mana pill, scoped to a new `.tavernup` class so the sibling **Refresh** cost keeps its baseline look.
- `typecheck` + `lint` + `test` (**124**) + `build:web` clean; art + button verified live (brood/Imp
  render at 512×512; Tavern Up cost 22px in a pill, Refresh cost unchanged at 17px). Repacked
  `ascent-itch.zip` (41 entries — brood + impscrap in, pack6 out; `index.html` at root, forward-slash
  paths).

### Venomous retaliation + "Tavern Up" button
- **Venomous now procs on the attacker too.** A unit that *attacks* a Venomous minion took the
  defender's retaliation damage, but the venom proc/drop-off was skipped whenever that raw retaliation
  was already lethal (the guard was `if (poison && target.health > 0)`). Now the proc fires whenever
  damage actually lands — i.e. past the Immune/Divine-Shield early-returns — so attacking a Venomous
  unit kills the attacker and consumes the defender's `V`, **unless the attacker is shielded** (a
  Divine-Shield/Immune attacker absorbs the hit and the venom never lands, exactly as before). One-line
  fix in `dealDamage` (`if (poison)`); `performAttack` already forwarded the defender's venom on
  retaliation. Added 2 sim tests — (a) attacking a Venomous target kills the attacker via retaliation
  venom, shielded variant survives; (b) the proc **and drop-off** fire even when the raw retaliation is
  lethal (would fail under the old `target.health > 0` guard). All **122** tests pass.
- **"Tier ^" → "Tavern Up" + mana cost.** The upgrade button now reads **Tavern Up** (and **Tavern
  MAX** at cap) with a teal **mana drop** rendered inline before the cost number. Sized 17px to match
  the cost text (`.btn.big .c` is now an `inline-flex` row with a small gap). Verified live: the button
  shows `Tavern Up 5`, two icons, the cost icon computed at 17px / mana-dk teal; Recruit re-renders and
  a real `roll` dispatch produced **zero** new console errors (the residual `<Recruit>` errors in the
  buffer are the documented stale artifact from forcing `newRun` mid-combat on the long-running server).
- Repacked `ascent-itch.zip` (40 entries, `index.html` at root, all forward-slash paths). `typecheck`
  + `lint` + `test` (122) + `build:web` clean.

### Fix: enemy minions now animate their attacks
- Enemy (tavern-side) attacks showed no lunge. Cause: the `enemyarrive` entrance animation used
  `both` fill, so it **held its final `transform`** on every enemy unit — and a filling CSS animation
  overrides the inline lunge transform (player units have no such animation, so they were fine).
  Dropped the fill (the keyframe ends at the identity transform, so the entrance is unchanged); enemy
  lunges now apply. Verified live — an attacking enemy now lunges (`translate(326px, 218px) scale(1.04)`),
  and a full combat replays with no console errors.

### Correct Echo Warden art + new Ember Whelp art
- Re-wired **Echo Warden** from the now-present `EchoWarden.png` (replacing the earlier wrong guess —
  a spectral figure surrounded by echoed summons, fitting the card), and swapped **Ember Whelp** to
  `EmberWhelp2.png` (a fierier flame-breathing whelp). Both verified loaded in-app.
- **Policy:** only wire card art when a source file's name matches the card — never guess from an
  un-attributed file (a wrong guess is worse than the pixel-sprite fallback).

### Shaper/Echo art, minimal Karwind burn, magnetize pass 2, golden buff breakdown
- **Wired Wildwood Shaper + Echo Warden art** (`shaper.png`, `echo.png`). *Note:* there was no
  `EchoWarden.png` in the source folder — used the only un-attributed export (a leafy winged creature)
  for `echo`; swap the file if that's the wrong asset.
- **Karwind flame, reworked.** The old effect filled the whole card (72%-tall tongues, 0.9s) and read
  inconsistently. Now it's a **quick, minimal burn along the bottom edge** (5 small uniform tongues
  ~17% tall + a bottom glow band, 0.5s) — just a "Karwind is working" indicator, consistent across
  every buffed Dragon. Verified live.
- **Magnetize pass 2.** The drone now fully **vanishes into the Mech** (scale → 0.06, opacity → 0,
  accelerating ease) in **0.28s** (was a lingering 0.16-scale/0.15-opacity remnant over 0.32s), with
  the target Mech's crackle settling faster onto the green buff flash. (Drag gestures can't be driven
  headless, so the feel is best confirmed in-game.)
- **Buffs now carry through triples → goldens itemize in inspect.** The triple now keeps the two best
  copies (by total stats), **sums their stats AND merges their per-source buff breakdowns** onto the
  golden. For uniform buffs / fresh triples this is identical to the old top-two-atk/top-two-hp result;
  it only differs for oddly asymmetric per-copy buffs (rare), and in exchange a golden's inspect panel
  now lists its buffs (e.g. `Spirit Fire ×2 +6/+6`, `Karwind ×2 +2/+4`) consistently with its stats.
  Verified live + unit-tested (golden carries `Spirit Fire ×2 +6/+6`).
- `typecheck` + `lint` + `test` (**120**) + `build:web` clean; art + Karwind + golden breakdown
  verified live, no console errors.

### Cleaner magnetize "absorb"
- The magnetize merge was janky: the dropped card crept to the target over **0.72 s**, shrank to 0.32
  with a box-shadow crackle *on the flying card*, then the stats jumped — slow, and the target Mech
  never reacted. Rebuilt it as a snappy **absorb**: the drone shrinks straight into the Mech in ~0.32 s
  (down to 0.16 scale + fading out), and the electric crackle now plays on the **target Mech** (it
  keeps crackling a beat past the merge), landing on the existing green buff flash. Faster + reads as
  the Mech eating the drone. (`typecheck`/`lint`/`build` clean; merge logic unit-tested already —
  drag gestures can't be driven in the headless preview, so the timing is best felt in-game.)

### Buff-source breakdown, Karwind flames, drag-popup + sell fixes
- **Per-source buff tracking + inspect breakdown.** `BoardCard` now carries a `buffs` list (source,
  ±atk/±hp, count), populated by a new `addBuff()` that every recruit buff routes through (battlecry
  tribe buffs, Karwind, Spirit Fire, Fortify, Broker, Kennelmaster, Combinator, Ritualist, consume,
  magnetize, deathrattles). Right-click → inspect now shows the breakdown to the **left** of the card,
  e.g. `Nadir ×1 +2/+2`, `Karwind ×1 +1/+2`, `Spirit Fire ×2 +6/+6`. (Goldens don't itemize — the
  triple sums stats ambiguously; known limitation.) Verified live + unit-tested.
- **Karwind flame highlight.** When a Battlecry triggers Karwind, the Dragons it buffs now flash with
  flames (a transient `karwindFlash` uid list + seq drives a flame overlay), on top of the normal green
  buff flash — so it's clear the extra buff came from Karwind. Verified live (playing Hoard Cleric
  flame-flagged all 3 dragons) + unit-tested.
- **No referenced-card popup while dragging.** Holding/dragging a card no longer counts as "hovering" a
  minion — a `dragging` prop suppresses the popup and drops any open one.
- **Minions must be on the board to sell.** A hand minion flung up to the tavern now snaps back to the
  hand instead of selling (only board minions sell; the sell-glow matches).
- `typecheck` + `lint` + `test` (**119**) + `build:web` clean.

### Drag insertion sweet spot + tooltip proximity
- **Drag drop now follows the card, not the cursor.** The warband/shop insertion index was computed
  from the raw pointer x — but the floating card is offset by wherever you grabbed it, so grabbing the
  right side dropped the card a slot too far right. It now uses the dragged card's **centre**
  (`pointer − grabOffset + width/2`) at every insertion site (live drop-slot preview, play, reposition,
  shop reorder, magnetize target), with `INSERT_FRAC` 0.35 → **0.5** so a card slots after another only
  once its centre passes that card's midpoint. (Verified by code: the harness can't drive React's
  pointer-capture drag synthetically.)
- **Referenced-card popup hugs the hovered card.** The 0.8 scale was anchored at centre, so the popup
  appeared to drift ~30px off the source. Now the scale is anchored to the source-facing edge
  (transform-origin left/right) and positioned so the *visible* edge sits ~8px from the hovered card
  (flips side near the screen edge). Verified live: popup's visible left edge ≈ the source card's right
  edge (~8px), origin left-center.
- `typecheck` + `lint` + `test` (**116**) + `build:web` + `package:itch` clean.

### Referenced-card popup polish — delay + float + haze
- The referenced-card popup now opens after a **~0.5s hover** (so it doesn't flash while skimming the
  board; position is measured when it opens, so it tracks a popped-up hand card). It **slides in**, then
  gently **bobs + wobbles in place** (a continuous float) so it reads clearly as an info card, not a real
  one, and it's wrapped in a **soft white haze** (layered white drop-shadows). Verified live: hidden at
  150 ms, shown by 650 ms; entrance + float animations active; haze present; no console errors.
- The popup minions also render at **80% size** (scale baked into the float keyframes so it composes with
  the wobble) — verified ~0.82× the source card on screen.

### Referenced-card hover popup
- Hovering a card that references another now shows the referenced card as a **popup to the right**,
  portalled to `<body>` at z-index 150 so it floats **above neighbouring cards / spells**. Covers every
  card that names/creates/affects another: **Alleycat / Wildwood Shaper → Stray**, **Pack Scrounger →
  Pup**, **Brood Matron → Imp Scrap**, **Combinator → Cling Drone**, and the Fodder cards **Soulfeeder /
  Voracious Imp / Ritualist / Pactstone Acolyte / Maw / Ravening Glutton → Fodder**. The Fodder popup
  reflects its **current buffed stats** (folds in Ritualist's persistent enchant), so the player can see
  what their Fodder is at right now. Positions to the right by default, flips to the left near the screen
  edge, and clamps on-screen. Wired via a memoized `refViewsByUid` map (stable across a drag, preserving
  the card memo). Verified live: Combinator→Cling Drone (2/2), Alleycat→Stray (1/1), Ritualist→Fodder
  shown at 4/4 (1/1 base + a 3/3 enchant), Soulfeeder→Fodder; popup on `<body>`, z-150, no errors.
- `typecheck` + `lint` + `test` (**116**) + `build:web` + `package:itch` clean.

### Ornate Discover frame, centered game-over button, sequenced End-of-Turn animations
- **Discover frame redesign.** The Discover overlay is now an ornate, gold-framed parchment panel —
  a layered gold border, a "Discover" banner plaque, blue gems above/below, a ✦-flourished subtitle,
  and each of the three cards in a **tier-coloured pulsing glow** (green/red/purple by tribe). New
  classes (`.disc-panel`/`.disc-banner`/`.disc-gem`/`.disc-sub`/`.disc-slot`) so the Choose-One overlay
  (which shared `.discover-box`) is untouched. Verified live: panel + banner + 2 gems + tribe-tinted
  glows render.
- **Game-over button centered.** `.btn` is `display:flex` (block-level), so the box's `text-align:center`
  never centered it — it sat full-width/left. Made `.over .box` a centered flex column; verified the
  box centers in the window and the button centers in the box (and the real "Begin a New Ascent" path
  resets cleanly, no crash).
- **End-of-Turn plays out one card at a time.** Reworked the End-Turn telegraph: instead of flashing
  all End-of-Turn minions at once, each fires **individually in sequence**, and **repeats
  `chronosRepeats` times** when a Chronos is in play (mirrors `applyEndOfTurn`'s per-card-then-repeat
  order; `chronosRepeats` is now exported from `@game/sim`). Each beat flashes the proc flourish under
  its card plus a tailored effect — **Ritualist** washes the whole shop purple (it buffs the Fodder
  there; new `.shopflash` over the tavern), **Combinator** crackles electricity over the two Mechs it
  magnetizes onto (new `electrify` prop reusing the `crackle` keyframe). Plus a short "proc" shimmer
  per beat. Then it faces the Omen. Verified live (Ritualist×2 + shop flash, then Combinator×2 +
  electrified Drone & Money Bot, → combat).
- Added a **DEV-only `window.useGame` handle** (stripped from production) to stage UI states from the
  console for verification.
- `typecheck` + `lint` + `test` (**116**) + `build:web` + `package:itch` clean.

### Triple Reward glow + itch.io packaging
- **Triple Reward card glow.** The Discover/triple-reward spell now wears the **golden frame + gold
  text box** (like a tripled minion — gold border, gold body tint, gold name pill + footer) and a
  **bright, vibrant orange glow that pulses** (`.card.triplecard`, keyed off the `discoverspell` id,
  overriding the generic purple spell look). Verified live: rules present + `tripleglow` animation active.
- **itch.io packaging.** The production build now uses a **relative base** (`base: './'` on `build` only;
  dev stays absolute) so every asset resolves from itch's CDN sub-path. Confirmed the output is fully
  relative — `index.html` → `./assets/…`, CSS → `../board.jpg` / `../cursors/…`, JS art via
  `import.meta.url`, no leading-slash refs. Added `npm run package:itch` (build + a small PowerShell
  zipper, `scripts/package-itch.ps1`) that emits **`ascent-itch.zip`** with `index.html` at the zip root
  and **forward-slash entries** (PowerShell's `Compress-Archive` writes backslashes, which break on
  itch's Linux unzip — the script writes the zip manually to avoid that). Upload that zip to itch.io as
  an HTML game with "play in browser". (Zip + dist are gitignored.)
- `typecheck` + `lint` + `test` (**116**) + `build:web` clean.

### Golden-magnetize Discover, beefier Reborn tears + Venomous drip, Triple Reward rename/art/dynamic text
- **Golden Magnetic now grants its Discover.** Welding a golden Magnetic minion (e.g. a tripled Cling
  Drone) onto a host returned early in the reducer, skipping the `grantGoldenDiscover` that a normal
  golden play runs — so you lost the triple reward. The magnetize merge path now grants it too. Tested.
- **Reborn tears are punchier** — bigger (11×15), brighter, faster cadence, and **6** particles (was 4)
  so several drift at once instead of one-at-a-time. (Per the user — they like the effect.)
- **New: Venomous drip.** Cards with Venomous now constantly drip green venom globs (form → swell →
  elongate → fall), keyed off the `V` keyword. No rim glow (per the user) — just the drips. Same overlay
  pattern as the Reborn tears; shows in the shop, on granted-Venomous minions, and on combat venom units.
- **Glimpse Beyond → Triple Reward.** Renamed the Discover spell, wired its art from the Spells source
  folder (`art/minions/discoverspell.png`), and made its text **name the exact tier** it Discovers from:
  `Discover a Tier {min(6, currentTier + 1)} minion` — recomputed from the live shop tier (so it reads
  "Tier 2" on tier 1, "Tier 6" on tier 6). Matches the actual `offerDiscover` formula.
- `typecheck` + `lint` + `test` (**116**) + `build:web` clean; rename + art + dynamic-text formula +
  CSS verified live, no console errors.

### Heckbinder dual-tribe fix, mana tooltip, golden-text correctness + full fill, Reborn FX, Esc resolution menu
- **Magnetize onto Heckbinder now works.** `magnetizesTo()` was checking only the *target's* primary
  tribe, so a Mech-magnetic card (Cling Drone) couldn't weld onto Heckbinder (primary tribe Demon).
  It now intersects BOTH cards' tribe sets — Heckbinder counts as a Mech, so anything Mech-magnetic
  attaches to it (and it still attaches to a Mech or Demon).
- **Dual-types count as both tribes for buffs**, not just magnetizing. Added a combat `Minion.tribe2`
  (from the def) and taught the tribe-buff sites (combat: buff-tribe, AoE-per-tribe, shield-tribe;
  recruit: battlecry/deathrattle buff-tribe, Combinator's auto-magnetize) to match either tribe.
  Regression-safe — single-tribe cards have `tribe2 === undefined`. Tested (Cling→Heckbinder merge;
  Heckbinder shielded by Omega Bulwark's Mech grant).
- **Mana projection tooltip** ("coming up") icon was tinted `--acc` (orange), reading as an ember —
  now `--mana` teal, matching the chip.
- **Golden text correctness.** The naive number-doubler mis-rendered cards whose golden form changes a
  *count* or needs plural grammar. Added an explicit `CardDef.goldenText` (+ zod, threaded through the
  card views) used verbatim when golden: **Buddy Buddy** (add *two* minions), **Soulfeeder** (add *2*
  Fodder), **Combinator** (*two* Drones), and grammar fixes for **Drakko/Sylus/Chronos/Echo** ("1 more
  time" → "2 more times"). Summon cards whose counts *don't* change when golden (Alleycat, Pack
  Scrounger, Brood Matron, Wildwood Shaper) are already correct under the doubler, so they're left.
- **Golden box fills the whole card.** Tinted the `.card.golden` background gold (the body shows it
  edge-to-edge) and dropped the inset description panel, so the entire text area reads gold (+ gold
  footer, on top of the existing gold name pill).
- **Reborn FX upgraded.** The blue aura now also washes OVER the art (screen-blend, like Divine Shield)
  and the whole card pulses; added drifting spectral "tear" particles (staggered, ~one at a time) for
  life. All keyed off the `R` keyword, so they vanish the instant a minion Reborns in combat.
- **Esc menu + resolution scaler.** New pause/settings overlay (Esc key or a bottom-right gear) with a
  display-resolution picker: **Fit to Window / 1920×1080 / 2560×1440 / 3440×1440**. The whole game now
  renders into a centred "stage" box driven by `--gw`/`--gh`; the card/chrome scaling keys off the box
  (not the raw viewport), so picking a fixed 16:9 / 21:9 size letterboxes the rest against a dark frame.
  No transform-scale, so drag + pointer math are untouched; window-edge HUD (status tray, hand, timer,
  combat log) is offset into the box by `--bar-x/--bar-y`. Choice persists (localStorage). Verified
  live: fit = full window; on 1080p, 16:9 fills + 21:9 letterboxes to aspect 2.333; menu applies +
  persists; no console errors.
- `typecheck` + `lint` + `test` (**115**) + `build:web` clean.

### Rope width cap, +30% proc flourish, golden/Reborn card cues, Reborn-at-base, dual-type Heckbinder
- **Rope no longer scales with the monitor.** It was `width: 86%` of the viewport, so it stretched
  edge-to-edge on wide screens. Capped to `min(1180px, 92vw)` (the board's content frame) — verified
  live: on a 1907px monitor it renders at exactly 1180px instead of ~1640px.
- **Proc flourish ~30% more noticeable.** The under-card Battlecry / End-of-Turn sigil (`.bcryfx`)
  got bigger + brighter: glow 46→60px (expand 1.55×→2×), motes 9→12px with a larger halo, travel
  40→52px, hotter core mix.
- **Golden (tripled) cards read at a glance:** the name pill is now a filled gold gradient (not just
  gold text) and the description sits in a soft gold panel, with a gold-tinted footer.
- **Reborn cards show a pulsing blue aura** (`.card.reborncard`, keyed off the `R` keyword) — recruit
  + combat. In combat it drops the instant the minion Reborns (it sheds `R`), so the glow marks "one
  revival left."
- **Reborn now returns at BASE stats.** A minion that died Reborn used to come back at its current
  (buffed) attack and 1 health, keeping granted keywords. Now it returns at its *printed* card stats
  and base keywords — shedding all combat buffs and granted effects (Divine Shield, etc.); golden
  returns at doubled base. So a 2/1 buffed to a 10/3 Divine-Shield body comes back a plain 2/1. The
  `reborn` event now carries `attack` + `keywords` so the combat replay applies the reset. (This is
  the "combat stats are temporary" rule; recruit-permanent stats live on the run board, untouched.)
  Tested (base reset, granted-DS shed, golden = 2× base).
- **New: Heckbinder** (T4 Demon/Mech, 3/3, Magnetic) — the first **dual-type** minion. Added
  `CardDef.tribe2` (+ zod schema); a Magnetic minion now welds onto any friendly minion sharing one
  of its tribes (new `magnetizesTo()`), so Heckbinder merges onto a **Mech or a Demon** (Cling Drone
  still Mech-only). Renders the split-hue card + a "Demon / Mech" footer. Art wired. Tested
  (magnetizes to demon + mech, not beast).
- **Mechanics checks (items 5 & 6):** there's currently **no way to destroy a board minion during
  the shop phase** (selling removes it without a Deathrattle; Consume eats tavern Fodder; triple /
  magnetize aren't destroys), so those rules have no trigger yet. The model they describe already
  holds: recruit-phase Deathrattle factories apply *permanent* stat changes, and combat buffs are
  combat-only (now reinforced by Reborn-at-base). The "Reborn lost permanently unless tripled" rule
  would need a per-card flag + restore-on-triple once a shop-destroy mechanic exists — flagged for
  the user.
- `typecheck` + `lint` + `test` (**113**) + `build:web` clean; rope cap + Heckbinder load verified
  live, no console errors.

### Better burning-rope timer — real flame + braided fuse, repositioned to clear the rows
The last-15s turn timer rope was a thin faint line with a small round glow dot crammed against the
tavern row. Rebuilt it:
- **Braided fuse** (rounded, diagonal-strand texture with top highlight) instead of a flat line, and
  a **charred trail** behind the flame (dark, with a glowing ember edge right at the burn point).
- **A real flame** at the burn point: a warm halo, a flame-shaped body, a hot inner core, and three
  rising **ember** sparks — all flickering. Replaces the single radial dot.
- **Repositioned**: more vertical margin so the fuse sits centred in the tavern↔warband gap (was
  cramped against the tavern). Tuned the flame height + margin so the flame licks up to exactly the
  tavern row's bottom with **0px overlap** (measured live: 22px below the tavern, 16px above the
  warband). All sizes scale with the `--u` chrome unit.
- `typecheck` + `lint` + `build:web` clean; verified live (rope + flame parts render, correct burn
  position, no console errors).

### Triage: Soulfeeder "procs every round" — engine is correct; fixed frozen-tavern Fodder stranding
Reported: Soulfeeder seems to proc every round after one play. Triaged with deterministic tests:
- **The engine procs Soulfeeder exactly once.** A multi-round test confirms its attack goes
  `2 → 3 → 3 → 3 → 3` (eats one queued Fred on the first refresh, never again) and `pendingTavern`
  is `['fred']` then `[]` forever. `refreshTavern` clears the queue after injecting, so there is no
  per-round re-proc in the simulation.
- **Real related bug found + fixed: a frozen tavern stranded the queued Fodder.** When you froze,
  `advanceAfterCombat` took the `topUpTavern` path, which never injected/consumed `pendingTavern` —
  so a Soulfeeder-queued Fred was stuck forever (the *opposite* of "every round," but a genuine bug).
  Extracted `injectPendingTavern()` and now run it on **both** the reroll and the frozen carry-over,
  so the promised Fred always arrives (and is eaten) exactly once. Tested (frozen delivery + the
  once-only multi-round case).
- **The "every round" visual could not be reproduced.** The two candidate animations both fire once
  by construction: the Fodder eat-swirl is gated by `fodderEatenSeq` (bumped only on a real consume,
  i.e. once), and the Battlecry flourish is gated by a played-uids set (`prevBoardUidsRef`, which
  retains the card across the combat→recruit round-trip). Instrumented both + attempted a live
  repro; no re-fire observed. Awaiting a repro clip / details from the user to pin any visual.
- `typecheck` + `lint` + `test` (**110**) clean.

### Chronos (End-of-Turn doubler) + a real fix for the return-to-shop minion flicker
- **Return-to-shop flicker — root cause found + fixed.** Frame-by-frame capture of the combat→recruit
  return showed the warband card playing `boardreset` cleanly (opacity 0.45→1)… and then, at ~650ms
  when the `resetting` class was *removed*, its `animation` reverted to the base `cardpop` and
  **re-fired from opacity 0** — a second flash. The toggle itself was the bug: changing a card's
  `animation` property (boardreset ↔ cardpop) restarts it. Fix: **drop the `resetting`/`boardreset`
  toggle entirely** — the warband re-mounts and re-enters via the base `cardpop` once (no class to
  toggle, so it can't re-fire), and the stat snapshot is re-synced on the transition so the green
  buff-flash doesn't spuriously fire on the cards coming back in. Verified by capture: a single
  `cardpop` 0→1 that settles at 1.0 with no second flash (previously opacity dropped back to 0 at
  650ms). No console errors.
- **New: Chronos** (T5 neutral 1/6) — *your End-of-Turn effects trigger 1 more time* (golden: 2 more;
  multiple Chronos do **not** stack — best one counts, mirroring Drakko). `applyEndOfTurn` now repeats
  each end-of-turn effect `chronosRepeats(state)` times, so e.g. Ritualist with a Chronos buffs Fodder
  +2/+2 per turn, Combinator welds two rounds of Cling Drones, etc. Art wired. Tested.
- `typecheck` + `lint` + `test` (**108**) + `build:web` clean.

### Fix: end-of-turn proc flourish now actually shows; smooth board return from combat
Two follow-up fixes to the previous batch.
- **End-of-turn flourish was invisible.** It was triggered on *combat entry*, but the warband flips
  from recruit `Card`s to combat `Unit`s the instant the phase changes — so the cards being flashed
  no longer existed. Now **End Turn** plays the flourish on the still-mounted recruit board first: if
  any minion has an End-of-Turn effect, those minions flash the Battlecry-style `.bcryfx` sigil for a
  ~620ms beat, *then* `faceOmen` fires (effects resolve + combat). Boards with no End-of-Turn card go
  straight to combat as before. (The effects themselves always resolved in `faceOmen` — this is the
  missing visual.)
- **Board "flash/jank/reset" returning from combat.** Every `.card` plays `cardpop` on mount, and the
  warband cards re-mount when returning from combat (they were `Unit`s). The `resetting` class (which
  overrides `cardpop` with `boardreset`) was set in a `useEffect` that runs *after* the cards already
  painted `cardpop`, so the two animations raced. Fixed by setting `resetting` in a **`useLayoutEffect`
  (before paint)** so the board paints `boardreset` directly, and softened `boardreset` to a calm
  rise-in (no scale-overshoot bounce). Verified live: the returning warband card's computed animation
  is `boardreset` (not `cardpop`), with no console errors.
- Confirmed for the user: the **minion caps are all enforced** — board 7 (play, recruit summon, and
  combat summon all gate on it), hand 10, mana/gold cap 10, tier 6.
- `typecheck` + `lint` + `build:web` clean; combat round-trip verified live.

### 5 new cards + Venomous (Poison rework) + end-of-turn proc anim + mid-combat buff display fix
A big content + mechanics batch.
- **Poison → Venomous.** The keyword is renamed everywhere (code `'P'` → `'V'`, schema, all card data,
  threat templates, UI labels/tooltips, CSV, tests) and its mechanic changed: **Venomous drops off
  after its first proc in combat.** When a unit's venom destroys a target (the poison event fires),
  that poisoner loses `V` and emits a new `venomLost` combat event; the UI removes the badge mid-fight.
  So a Venomous body is a one-shot per fight (unless re-granted). Tested (one-proc-then-survives).
- **Buddy Buddy** (T3 neutral 3/4) — Battlecry: add a random Tier 1 minion to your hand (golden: two).
  New recruit factory `battlecryGainRandomMinion` (draws from the run's buyable T1 pool, honors the
  hand cap, uses the shop RNG). Fires through Drakko like any Battlecry.
- **Combinator** (T5 Mech 6/7) — End of Turn: magnetize a Cling Drone (+2/+2) onto 2 *other* friendly
  Mechs (golden: 2 drones each → +4/+4). New `endOfTurnMagnetizeMechs`.
- **Grim** (T6 Beast 7/1) — Deathrattle: give your Beasts +6/+6 for the rest of combat (golden +12/+12).
  Reuses the existing `deathrattleBuffTribe` (data-only).
- **Karwind** (T6 Dragon 2/12) — whenever a Battlecry *triggers*, give your Dragons +1/+2 (golden +2/+4).
  New `battlecryTriggered` recruit event, fired once per Battlecry resolution — **including each Drakko
  repeat**, so a doubled Battlecry procs Karwind twice. New `onBattlecryBuffTribe`. Tested (incl. Drakko).
- **Money Bot** (T3 Mech 3/3, Magnetic) — while on your board, **+1 max mana per turn** (golden +2). A
  board-derived economy: the per-turn embers are recomputed each turn as `maxEmbers + boardManaBonus`
  (a new `CardDef.manaPerTurn` + a `BoardCard.manaBonus` for the absorbed amount). Magnetizing it into a
  Spare Part Drone transfers the income onto the host, which survives the host's triple; selling the host
  removes it. The mana projection tooltip folds it in. Tested (on-board, magnetize-transfer, sell-removal).
- **End-of-turn proc flourish.** Cards whose End-of-Turn effect resolves (Ritualist, Combinator…) now
  flash the same under-card sigil as a Battlecry, on the board through the shop-closing beat.
- **Mid-combat buff display fix.** A multi-proc deathrattle (e.g. Spirit of the Pack re-procced by Sylus
  for +12/+12) showed three separate "+4/+4" floats; the combat replay now **sums buff events per target
  within a beat** and shows one correct "+12/+12" per minion. (Stat badges were already correct.)
- All 5 sprites wired (BuddyBuddy / Combinator / Grim / Karwind / MoneyBot). `typecheck` + `lint` +
  `test` (**107**) + `build:web` clean; live: cards load with the right stats/art, combat replays with no
  console errors, the End-of-Turn banner + flourish fire.

## 2026-06-17

### Bug-fix + juice batch — freeze refill, end-of-turn feel, combat grants, end-game fix, sounds
An eight-item batch of fixes and feel polish.
- **Frozen taverns top up.** Freezing a partial shop (you'd bought some minions, or the spell)
  used to carry it over with the gaps; now after combat a frozen tavern fills its empty minion
  slots back up to the tier count and re-adds a spell if missing, keeping every frozen offer in
  place. New `topUpTavern()` shares the weighted-draw helper with `rollShop` (refactored out a
  `drawOfferId`). Tested.
- **A clear "End of Turn" beat.** Ending the turn already fired end-of-turn effects (`faceOmen` →
  `applyEndOfTurn`); now a brief centred **"End of Turn"** banner plays on the recruit→combat
  transition so it reads. (Verified live.)
- **Fodder eat animation shows what was eaten.** A Demon devouring tavern Fodder showed a 1/1 ghost
  even when Ritualist had buffed it. The consume record (`fodderEaten`) now carries the Fodder's
  *effective* stats, the ghost renders them (green vs. the 1/1 base), the swirl is **slower** (1.35s
  → 2.2s, holding full-size so the stats read), and it's wreathed in **orbiting purple orbs**.
- **Combat hand-grants pop in.** A card a combat Deathrattle adds to your hand (Arcane Weaver →
  Spirit Fire) now flashes an accent glow as it arrives — the hand is snapshotted on entering
  combat, and the new uids afterward are flagged as grants.
- **End-game state fixed.** The game-over overlay (`.over`) had no `z-index`, so the live board's
  positioned chrome (hand z-25, status z-40, timer z-80, …) painted *through* it — the "busted" end
  screen where the board showed on top. It's now `position: fixed; z-index: 300` (above all chrome)
  with a near-opaque scrim, so it cleanly covers + blocks the dead board. (Verified the rule live.)
- **Imp Scrap** is a plain 1/1 with no keyword/Fodder interaction — its misleading "…meant to be
  eaten" body text is now blank.
- **A "wrong" sound on rejected actions.** A buy/play/roll/upgrade you can't afford (or that's
  otherwise a no-op — the reducer returns the same reference) now plays a low descending **deny**
  buzz instead of the success blip.
- **Battlecry flourish.** Playing a minion whose Battlecry fires now swells a tribe-tinted sigil
  from *under* the card with sparks fanning out — detected by diffing the board for a new card whose
  def has an `onPlay` effect (or Choose One). (Verified live on Soulfeeder.)
- `typecheck` + `lint` + `test` (**100**) + `build:web` all clean; no runtime console errors.

### Buttery drag — memoize Card so the board doesn't re-render on every pointermove
Dragging a card fired `setDrag`/`setOverZone` on every pointermove, re-rendering the whole recruit
tree — including all 7–14 `Card`s (each an `<img>` + pills + `dangerouslySetInnerHTML` text). Now:
- **`Card` is wrapped in `React.memo`** and its props are stabilized so the memo actually fires:
  - The per-card **view objects** are hoisted into `useMemo` maps keyed by uid
    (`shopViews` / `boardViews` / `handViews` + a `spellView`), recomputed only when the underlying
    `run.*` slice changes. During a drag nothing dispatches, so those refs are stable → the maps
    return the *same* `CardView` object for each card across pointermove re-renders.
  - The per-card `beginDrag(uid, source, view)` factory (a fresh closure every render) is replaced by
    **one stable `onCardPointerDown`** shared by every card: it reads the grabbed card's uid + zone
    from the DOM and its view from a ref, so its identity never changes mid-drag. (Hand cards now also
    carry `data-uid` so the handler can resolve them.)
- **Result (measured live):** 10 pointermoves during a drag caused **2 total card re-renders** (the
  dragged card's dim-flip + the floating card mounting once) — ~0.2/move, vs. ~one-per-card-per-move
  before. The per-second turn-timer tick also no longer re-renders the cards.
- The drag *mechanics* (`onMove`/`onUp`/`applyDrop`) are untouched, so behavior is unchanged.
  **Verified** end-to-end with synthetic pointer drags: buy (tavern→hand, −3 mana), play
  (hand→warband), and sell (board→tavern, +1 mana) all still work; the floating card appears/clears
  correctly. `typecheck` + `lint` + `test` (99) + `build:web` all clean; no runtime console errors on
  a fresh load. (Note: editing `Card.tsx` now full-reloads in dev rather than hot-swapping — Fast
  Refresh bails on a memo-wrapped export in a file that also exports helpers; harmless, dev-only.)

### Proportional chrome — HUD / controls / status tray / overlays scale with the viewport
The cards already scale with viewport height (`--ch`), but the chrome was fixed-px, so on big
monitors the HUD/buttons/fonts looked comparatively tiny (a flagged backlog item).
- **New scaled unit `--u: clamp(1px, 0.107vh, 1.34px)`** — a "scaled pixel" with a **1px floor**
  (so laptops and short windows read *exactly* as before — zero regression at ≤~935px tall) that
  grows to **+34%** on tall monitors (1440px+). Chrome dimensions are expressed as `calc(N * var(--u))`
  so every piece scales by the same factor and stays proportional to the cards.
- **Converted:** the top HUD (wordmark, wave meter, tribes, mute), the round turn-timer, the bottom
  status tray (Resolve bar + value, the hero/power panel + portrait, the Ember/Mana chips — including
  the larger "hero-sized" overrides), zone headers, the tavern controls (Refresh/Freeze/Tier/End Turn
  + the Tavern-tier label), the result toast, and the two modal overlays (Combat Log + Discover /
  Choose One). The combat arena's intentionally-huge post-fight buttons (`.cbtns .btn.big`, 32px) keep
  their fixed size via the more-specific selector — they're sized for combat readability, not chrome.
- **Verified** objectively via the preview (resize + `getComputedStyle`, no screenshots needed):
  at 800px tall every value equals its original px (wordmark 19, big button 17, status-chip value 34,
  hero name 23, hero portrait 80×80, Resolve value 28); at 1440px tall all scale by ×1.34 in lockstep
  (25.46 / 22.78 / 45.56 / 30.82 / 107×107 / 37.52). Overlay rules parsed correctly; `build:web` +
  `lint` clean; no console errors.
- Also scouted the **minion-art backlog**: every source illustration that maps to an existing card id
  is now wired (21 cards); the leftover source art (`Combinator`, `Grim`, `Karwind`) has no matching
  card, so it needs a card decision, not just wiring. **Art→WebP compression** is blocked on tooling
  (no encoder installed) — noted in the roadmap.

### Arcane Weaver + Ritualist, board dust, drag float, simultaneous deathrattle buffs, 2 sprites
A seven-item content + polish batch.
- **New: Arcane Weaver** (Tier 4 Dragon, 3/4) — **Deathrattle: add a copy of Spirit Fire to your
  hand.** Combat can't touch the recruit hand, so this is a *carry-back*: a new combat factory
  `deathrattleGrantSpell` calls `ctx.grantToHand(cardId, side)`; `simulate()` accumulates player-side
  grants into `CombatResult.playerHandGrants`, and `advanceAfterCombat` pushes each into the hand
  after the replay (win or lose, capped by `handMax`). Golden Weaver grants two; an enemy Weaver
  grants the player none. Art wired.
- **New: Ritualist** (Tier 5 Demon, 2/5) — **End of Turn: all Fodder gets +1/+1, wherever it is.**
  This is a *persistent per-cardId run buff*: a new `RunState.cardBuffs` map (`cardId → {atk,hp}`)
  is folded into **every** instantiation of a card — bought (`buy`), summoned/conjured (recruit
  `summon`), discovered (`discover`), the demon-consume math (`consumeTavernFodder`), and the live
  tavern display (`shopView`) — so a Fodder from *any* source carries the accrued buff. The new
  recruit factory `buffFodderEverywhere` (fires on `endOfTurn`) bumps `cardBuffs` for every
  FD-keyworded card and immediately buffs the Fodder already on the board / in the hand. Golden
  doubles; multiple Ritualists stack. Art wired.
- **Board dust** — a soft, earthy puff of motes kicks up on a primary click of the *empty board*.
  A `puffBoard` handler on the `.app` root ignores any click whose target is a card or control
  (`.card, button, a, input, [role=dialog], .bar, .rtimer, .shopctl`) and is suppressed while
  aiming the Hero Power or dragging — so it reads as touching the table, never a card. Purely
  cosmetic (mirrors the spell-spark pattern; doesn't block other handlers).
- **Drag float** — the dragged card now follows the cursor on a whisper of lag (`.dragcard`
  `transition: transform 0.08s ease-out`) instead of being rigidly pinned; `.snap` / `.magslide`
  still override with their own transitions.
- **Simultaneous multi-target deathrattle buffs** — `buildBeats` now collapses a *run of
  consecutive `buff` events* into one beat, so an effect that buffs many minions at once (Spirit of
  the Pack giving every Beast +4/+4, a Rally aura) flashes them all together rather than one at a
  time. (Previously each buff was its own beat → sequential.)
- **Sprites wired:** Spirit of the Pack (`pack6`) and Cling Drone (`cling`) now have art.
- **Tests (+5, 99):** Arcane Weaver reports a Spirit Fire grant (golden → two; enemy-side → none);
  Ritualist's End of Turn buffs Fodder on board + in hand and sets the run buff; a Fodder bought or
  consumed after a proc carries it. `typecheck` + `test` (**99**) pass; live (fresh dev server):
  both card defs load with the right effects, all four sprites resolve via `artFor`, the drag
  transition + `.boarddust` rule are in the live stylesheet, a background click puffs (6 motes,
  auto-expires) while a card click does not, and a Spirit-of-the-Pack death emits the two
  consecutive `+4/+4` buff events the new beat-grouping collapses.

### Mana Pouch + Drakko + Sylus, spells play "upward", CSV by type with golden column
- **`docs/cards.csv` reorganised** into `# === TRIBE ===` sections, with new **`golden_text`** +
  **`golden_effect`** columns so the *tripled* version of every card is visible for triage (incl.
  the gotchas — e.g. word-count summons like "summon a Stray" don't auto-double their text, and 3
  summoned tokens trigger their own triple).
- **Spells play anywhere from the warband up.** Dragging a spell up to the tavern now casts it
  (you can't sell spells, so the old snap-back was just annoying). A targeted spell hits the minion
  under the cursor, or auto-targets your **carry** (highest-Attack) when flung up with no minion
  under it; untargeted spells just resolve. Spells no longer show the "Sell +1" glow over the tavern.
- **Ember Pouch → Mana Pouch** (id stable), art rewired. ✓ live (name + art).
- **Doublecast Drummer → Drakko the Drummer**, moved to **Tier 5**, art rewired. The golden version
  **triples** Battlecries (fires 3×), and **multiple Drakkos do NOT stack** (only the best one
  counts; golden = +2, else +1). New `drummerRepeats` helper used by both the play + Choose-One paths.
- **New: Sylus the Reaper** (Tier 5 neutral) — "In combat, your Deathrattles proc 1 more time."
  Golden procs **2 more**, and **multiple Sylus stack** (additive). Combat re-runs the dying minion's
  own onDeath effects `bonus` extra times. Art wired.
- **Tests (+4, 94):** golden Drakko triples / multiple Drakkos don't stack; Sylus re-procs a
  Deathrattle (golden +2, and stacks). `typecheck` (+web) + `lint` + `test` (**94**) + `build:web`
  pass; live: Mana Pouch shows its new name + art, no console errors.

### Choose One, bolder DS glow, slower Magnetic/Fodder, cards CSV
- **Choose One** wired. A card can carry `chooseOne: [{ text, effects }, …]`; playing it defers the
  Battlecry, opens a modal of the options, and the picked option's `effects` resolve as the Battlecry
  (honors Doublecast Drummer; a golden Choose-One still grants its Discover after the pick). New
  `CardDef.chooseOne` (+ zod), `RunState.chooseOne` + a `chooseOne` action, `applyChooseOne` in
  recruit, the reducer flow, and a Choose-One overlay (two big option buttons). Sample card added —
  **Wildwood Shaper** (T2 Beast: "give your Beasts +1/+1" or "summon two 1/1 Strays"). 2 tests.
- **Divine Shield — way more recognizable.** Dropped to a glow but made it bold: a bright soft-yellow
  **halo + ring around** the card *and* a glowing screen-blend **wash on top** (concentrated over the
  art so text stays legible), pulsing — reads at a glance across the board.
- **Slower Magnetic + Fodder animations.** The Magnetic slide is 0.36 s → **0.72 s** (and the merge
  fires at 720 ms), and the Fodder swirl 0.8 s → **1.35 s** (ghost held to 1.4 s) — clearer what's
  happening.
- **`docs/cards.csv`** — every card (minions, spells, tokens) as editable rows: id, name, kind,
  tribe, tier, atk/hp, cost, keywords, text, an effect note, and whether art is wired. Add rows at
  the bottom for new cards; I apply edits back into the content `.ts` files.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**90**) + `build:web` pass; live: the DS card
  shows the strong yellow halo + on-top wash, no console errors. (Choose One is covered by unit tests
  — it needs a Tier-2 board to trigger in the live UI.)

### DS = golden glow only, Rally keyword, buff-replay fix, smoother Magnetic
- **Divine Shield** — dropped the overlay art entirely; a shielded card now just gets a **soft golden
  glow** (`.card.dscard`, an outer + inner glow with a gentle `dsglow` pulse, recruit + combat).
- **Rally keyword** wired (`RL`): combat now emits `onAttack` per swing, so an `{ on: 'onAttack' }`
  effect fires when a minion attacks. Added the keyword (core type + zod schema + pill/tooltip "Rally
  — Triggers each time this attacks") and a default `rallyBuff` combat factory (on attack, buff your
  other minions +atk/+hp; golden ×2). Ready for content — no card declares it yet.
- **Buff-replay fix** — grabbing a minion mid-buff-flash and moving it replayed the buff animation
  when the card re-mounted (lift-out → drop). `beginDrag` now clears the dragged uid from
  `buffedUids`, so it doesn't re-trigger.
- **Magnetic slide cleanup** — the merge animation was janky. Now when the slide starts the warband
  **settles** (the shove slot closes) and the held card **shrinks straight into the Mech** (scale →
  0.32, no tilt, 0.36 s) with the electric crackle, then merges. Tighter timing (360 ms).
- **Ember Pouch** text "Gain 1 Ember" → "Gain **1 Mana**" (Mana rename consistency).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**88**) + `build:web` pass; live: a shielded
  card shows the golden `dsglow` (no overlay art), no console errors.

### New DS art + glow, live combat buffs (Kennelmaster), additive Echo Warden, Magnetic slide
- **Divine Shield** — re-wired the new (square 1024²) effect art at `scale(1.06)`, and added a **soft
  yellow glow fill** on any card with Divine Shield (`.card.dscard` — an outer glow + inner art-panel
  glow, shared by recruit + combat; dropped the old combat-only box-shadow).
- **Live combat card state (Kennelmaster).** Combat cards were static — a golden/avenged Kennelmaster
  showed "+1/+1" and no golden frame. Now `MinionSnapshot` carries `golden` + `summonBonus`, the
  replay folds `improve` events into a unit's live `summonBonus`, and `Unit` renders the golden
  treatment + the **current** buff magnitude (via a shared `summonBuffText` helper used by recruit and
  combat). So a Kennelmaster's text now climbs mid-fight as Avenge fires (+6/+6 → +7/+7 …) and reads
  golden. (General groundwork — other live-updating combat cards can reuse it.)
- **Echo Warden is additive, not multiplicative.** It now adds *extra* summoned tokens rather than
  re-running the summon: Pack Scrounger (2 Pups) + one Echo Warden → **3** Pups (not 4). A **golden**
  Echo Warden adds **2** ("1 more" → "2 more"). Replaced `echoReps` (×) with `echoBonus` (+).
- **Magnetic slide.** A Cling Drone dropped on a Mech now **shoves the warband aside** (a slot opens),
  then the held card **slides into the Mech** (left→right) with the electric crackle before the merge
  lands — instead of vanishing instantly. (`onUp` animates the floating card into the target Mech,
  then dispatches the merge.)
- **Tests (+1, 88):** golden Echo Warden adds 2 (the existing Echo test became the additive +1 case).
  `typecheck` (+web) + `lint` + `test` (**88**) + `build:web` pass; live: DS art loads (512²) with the
  yellow glow, combat renders cleanly via the new Unit code, no console errors.

### Tripling a summon-buff card combines its accrued buffs (Kennelmaster)
- **Bug:** tripling a buffed Kennelmaster dropped its Avenge buffs — the golden showed only +2/+2
  (golden ×2 of the base) instead of combining the copies. Two Kennelmasters at +6/+6 and +4/+4
  should triple to **+10/+10**.
- **Fix:** the summon-buff magnitude now **combines like a stat on triple**. `checkTriples` carries
  a new `summonBonus = base + (top-two combined bonuses)` onto the golden, and the separate golden
  ×2 was removed from `buffOnSummon` (both the combat and recruit factories) — the combine *is* the
  doubling. So a fresh triple still doubles the base (1+1 → +2/+2; Bristleback 2+2 → +4/+4), while
  two boosted copies sum (6+4 → +10/+10). `doubleNums` now skips `{{…}}` markers so a golden
  Kennelmaster's already-final magnitude isn't doubled again in the text.
- **Combat log already covers it.** Every combat event prints to the Combat Log (the verbose
  `narrateLog` handles attack/dmg/shield/poison/reborn/death/summon/**buff**/**improve**…), so a
  beast getting buffed and Kennelmaster's Avenge "aura strengthens" both show as lines — useful for
  triage, as requested. (The `improve` line was added in the prior commit.)
- **Tests (+2, 87 total):** tripling two boosted Kennelmasters yields a golden with `summonBonus` 9
  (→ +10/+10); a golden Kennelmaster grants its full +10/+10 (no double-counting). `typecheck`
  (+web) + `lint` + `test` (**87**) + `build:web` pass; the bot plays full runs deterministically;
  app loads clean.

### Kennelmaster Avenge text/anim, DS scale nudge
- **Kennelmaster reflects its Avenge boost.** Its board card now shows the *current* summon-buff
  magnitude (`+1/+1` → **`+2/+2`** at `summonBonus` 1, etc.), rendered **green** as a modified value
  (`instView` rebuilds the text with a `{{…}}` marker → `descUp()` in the Card → `.desc .descup`).
- **A combat pulse when Avenge triggers.** `avengeImproveSummon` now logs a new `improve` combat
  event; the replay pulses the Kennelmaster (✦ green float + a beat) and the log reads "…aura
  strengthens (+1/+1)." (New `CombatEvent` variant wired through the replay + harness narrators.)
- **In-combat escalation confirmed** — `buffOnSummon` reads the live `summonBonus`, which Avenge
  increments mid-fight, so a Beast summoned *after* the trigger gets the higher buff for the rest of
  that combat (and it persists onward).
- **Divine-Shield scale** nudged 1.32 → 1.18 (less overshoot). The real fix is matching-aspect art:
  the art panel is **5:4 (1.25:1)** but the source is 3:2, so `fill` distorts — a 5:4 frame
  (e.g. **1280×1024**, edge-to-edge, transparent centre) would fill it cleanly at scale 1.0.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**85**) + `build:web` pass; app loads clean,
  DS art renders at scale 1.18, no console errors.

### Buff-jank fix (root cause), new DS art, Omen art, 2× combat buttons
- **Buff "reset" jank — actually fixed this time (found the root cause).** The card visibly
  disappeared/reappeared *after* the buff animation. Cause: `.card` always carries
  `animation: cardpop`, but `.card.cardbuff` *replaced* it; when the buff class cleared, the
  `animation` property reverted to `cardpop`, which the browser treats as a newly-added animation and
  **replays** (cardpop fades in from opacity 0). Fix: list `cardpop` first in the `.cardbuff` rule
  (`animation: cardpop 0.26s ease, cardbuff 0.62s both`) so cardpop stays in the list across the
  toggle and never restarts. Verified with `getAnimations()`: after the class clears there are no
  running animations and the card holds `opacity: 1` (no replay). Covers the Fodder-eat path too
  (same `.cardbuff`).
- **New Divine-Shield art** — re-converted the updated `Effects/DivineShield.png` (still stretched to
  fill + scaled 1.32× to wrap the art panel, fully opaque).
- **Omen Minion art** — wired `OmenMinion.png` → `art/minions/omen.png` (id `omen`); the enemy filler
  now renders its illustration instead of the pixel sprite.
- **Combat buttons** — "Climb On" → **"End Combat"** (always); both post-combat buttons (Combat Log +
  End Combat) are ~2× larger (32px, scoped to `.cbtns` so the tavern controls are unchanged) with a
  wider gap so they never overlap.
- **Verified live:** Omen enemy renders `omen.png`; DS art loads at scale 1.32 / opacity 1; the two
  combat buttons are 32px and non-overlapping; buff no longer replays cardpop. `typecheck` (+web) +
  `lint` + `build:web` pass; no console errors.

### Cleanup — removed the dead recruit-consume path + the old arena CSS
Housekeeping from the two preceding reworks (no behaviour change):
- **Dead recruit-consume code gone.** The Fodder rework left the old board-consume path unused —
  removed `RECRUIT_FACTORIES.battlecryConsume` + `consumeFodderOnSummon`, the `consume()` context
  method, `fireDeathrattle`, and the `battlecryConsume`/`consumeFodderOnSummon` `EffectFactoryId`s
  (core type + zod schema). The on-consume *effects* (Pactstone/Maw/Glutton) and the `onConsume`
  event stay — they're fired by `consumeTavernFodder`.
- **Dead arena CSS gone.** Combat renders in-place now, so the old full-screen-arena rules were
  unused — dropped `.arena/.atop/.ascene/.asub/.side/.line/.clash/.skip/.endcombat` (+ `endpop`),
  the `.result/.verdict/.rres/.rwhy/.climb` result panel, `.ares`, and the legacy unit badges
  `.unit .nm/.tok/.ua/.uh/.kb`. Kept everything still live (`.unit.*`, `.float`, `.proj`, `.alog`,
  `boardshake`/`resulttint` keyframes). CSS bundle 42 → 37 KB.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**85**) + `build:web` pass; combat still renders
  (enemy units, banner, narration) with no console errors.

### Detailed combat log, Divine-Shield effect art, visible Fodder consume
- **Detailed combat log.** The post-combat log now spells out **every event with damage and the
  defender's remaining Health** — a new `narrateLog()` returns `{ text, kind }` per event (attacks
  with their swing, each hit "takes N (M HP left)", shields, poison, reborn, deaths, summons, buffs).
  Each line is colour-tagged by kind in the overlay (Start-of-Combat, attack, damage, death, shield,
  buff…). (The terse rolling in-combat line is unchanged.)
- **Divine-Shield effect art.** Wired the updated `art/effects/divineshield.png` as a `.dsfx` overlay
  that **wraps the square art panel** of any shielded card — shown everywhere a DS minion appears
  (shop, warband, combat), with a soft shimmer. Replaced the old combat-only golden box-shadow ring
  (now just a faint glow) since the art carries the read; the shatter-on-break stays.
- **Fodder consume is now visible.** It was resolving instantaneously (the player never saw it). Now
  `consumeTavernFodder` records each consume (`state.fodderEaten` + a `fodderEatenSeq` tick), and the
  UI replays it: a **ghost Fred pops into the tavern, then spins/shrinks/swirls into the Demon that
  ate it** (purple, ~0.8s), measured from the live DOM so it flies to the right minion. The Demon's
  buff proc still fires as it grows.
- **Verified live:** the DS art overlays the art panel exactly (155×124); the combat log shows e.g.
  "Omen Minion takes 1 damage (0 HP left)." / "Omen Minion is destroyed."; and a full
  buy-Soulfeeder → roll cycle shows the ghost **Fred** swirling into Soulfeeder (which grew 2/2 → 3/3),
  no Fred left as a static offer, ghost cleared after the swirl. `typecheck` (+web) + `lint` + `test`
  (**85**) + `build:web` pass; no console errors. (Screenshot tool was unresponsive this session, so
  checks were via the live DOM.)

### Kennelmaster — "Avenge (3): Improve this", permanent across the run
Reworked Kennelmaster to **"Each Beast you summon gains +1/+1. Avenge (3): Improve this."** The
Avenge boost is **permanent for the whole run** (the user's call), which meant threading per-instance
state through the pure combat boundary and carrying it back.
- **New per-instance `summonBonus`.** `BoardCard.summonBonus` (run) ↔ `BoardMinion.summonBonus` +
  `sourceUid` (combat input) ↔ `Minion.summonBonus` (combat-mutable) ↔ `CombatResult.playerSummonBonus`
  (carry-back). `buffOnSummon` (both the combat factory and the recruit one) now adds `summonBonus` to
  its per-stat magnitude, so the bonus raises every Beast the Kennelmaster summons.
- **New `avengeImproveSummon` factory** (combat): on every 3rd friendly death, while alive, it bumps
  its own `summonBonus` by 1 — improving every Beast it summons for the rest of the fight.
- **Carry-back + persistence.** `simulate()` reports each sourced minion's final `summonBonus` in
  `playerSummonBonus`; `advanceAfterCombat` writes it back onto the originating board card (matched by
  `sourceUid`), so the improved buff persists into future fights. `faceOmen` now also threads
  `golden` into combat (it wasn't before — a latent bug where golden minions didn't fire combat
  effects at 2×), so a golden Kennelmaster's summon buff doubles correctly.
- **Tests (85 total, +3):** a combat test (3 Taunt sandbags die first → Avenge fires once → `bonus: 1`
  in `playerSummonBonus`, deterministic because Taunts are targeted first), a run test that the
  recruit summon buff scales with the accrued bonus (Stray gets +3/+3 at `summonBonus: 2`), and a run
  test that `resolveCombat` persists the bonus onto the board card.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**85**) + `build:web` pass; the headless bot
  plays full runs (waves 8–10) deterministically with no crashes; the live app loads clean. Soulfeeder
  + Kennelmaster art were wired in the earlier UI commit.

### Fodder reworked — Soulfeeder seeds the tavern, Demons devour it (+ a real tavern refresh)
Redesigned the Demon Fodder loop per the user's new spec. Fodder no longer sits in your hand to be
played beside a Demon; it **arrives in the tavern** and your Demons **eat it automatically**.
- **Fred is out of the shop pool** (`token: true`) — it can't be rolled. It now only enters play
  from other sources (Soulfeeder), and its text says so.
- **Soulfeeder → Tier 1**, "**Battlecry:** add Fodder to your next tavern" (new
  `battlecryAddTavernFodder` effect → pushes `fred` onto `state.pendingTavern`; golden adds 2). No
  longer consumes a friend.
- **Voracious Imp → Tier 2**, "Gains **2x** stats from Fodder" (golden "**3x**"). Implemented as a
  new `CardDef.fodderMult` (Imp = 2; golden = base+1 = 3). The golden card-text transform learns the
  "Nx → (N+1)x" rule so the doubled text reads "3x".
- **A real "tavern refresh".** New `refreshTavern(state)` is the single tavern-population point —
  both the manual **Refresh** and the **post-combat** refresh route through it. It rolls the shop,
  injects any `pendingTavern` Fodder, then runs the auto-consume. (This is the hook the user wanted
  so future effects can interact with refreshes.)
- **Auto-consume (`consumeTavernFodder`).** When Fodder *enters* the tavern and you have ≥1 Demon on
  board, each Fodder is eaten by **one random Demon** (2 Demons + 1 Fodder → a seeded coin-flip). The
  eater gains the Fodder's stats × its `fodderMult`, and the **normal on-consume pipeline fires**
  (Pactstone Acolyte +1/+1, Maw of the Pit Divine Shield, Ravening Glutton +2/+2). Eaten Fodder
  leaves the tavern; with no Demon present it just sits there, buyable. Per the user's call, only
  Fodder *entering* the tavern triggers this — placing a Demon next to existing Fodder does not.
- **Tests:** replaced the 6 old recruit-consume tests with 7 covering the new flow — Fred not in the
  pool, Soulfeeder queues Fodder, a Demon devours tavern Fodder (Imp 2×, golden 3×), on-consume
  Demons pay off (Pactstone, Maw), and Fodder with no Demon stays. **82 tests pass.**
- **Verified live:** Soulfeeder renders as Tier 1 with the new text; Fred never rolled across several
  refreshes; Voracious Imp is absent at a Tier-1 shop (it moved to T2). `typecheck` (+web) + `lint` +
  `build:web` pass; no console errors. (The synthetic-drag harness was too flaky to build a full
  board live for an end-to-end consume, so that path leans on the unit coverage + the shared
  `refreshTavern`/`consumeTavernFodder` code.)

### Mana economy, teal cost, combat-log + banner polish, buff-proc fixes, board 1
The UI half of a large batch (the Fodder/Demon and Kennelmaster reworks land in following
commits):
- **Board 1** — reverted the play-surface backdrop to `board1.png` (the user preferred its aesthetic).
- **Embers → Mana (display only).** Relabelled the resource to **Mana** and recoloured it **teal**
  (`--mana: #30d2ff`): a new droplet icon in the status chip, teal chip icon, teal button costs. The
  card **cost badge is back to a circle** (dropped the flame), teal. Internal identifiers stay
  `embers` (per the user's call — this is a cosmetic rename, the economy logic is unchanged).
- **Combat presentation.** Removed the `—VS—` divider; the top combat banner now shows just the
  **threat name** (the wave already lives in the HUD) as a raspberry pill pinned out-of-flow on the
  left, so the action buttons stay centred. Added a **Combat Log** button that appears beside **End
  Combat / Climb On** once the replay settles — it opens an overlay listing the whole fight narrated
  line by line (with the verdict). Both post-combat buttons are centred.
- **Buff-proc fixes.** The buff animation no longer "snaps back": the spring easing is now scoped to
  the *rise* only, and the settle eases out (`animation-fill-mode: both`), so the card returns
  smoothly. **Tavern offers buffed by the hero power now play the proc too** — the buff-detection
  effect tracks shop offers' effective stats (base + the stored offer buff), not just board/hand.
- **Card text bigger** — keyword pills 9.5→12px and the description 12→14px for readability.
- **Taunt ward −15%** (78→66px) and **Soulfeeder + Kennelmaster art** wired (`feed.png`, `kennel.png`).
- **Verified live:** board 1 + teal Mana circle + "Mana" label + teal button costs confirmed via
  screenshot; hero-powering a tavern offer now flashes it (`cardbuff` + burst); a full
  recruit→combat→recruit cycle shows the threat-name banner, no VS, the centred Combat Log + End
  Combat, and the log overlay opens with its verdict. Fresh-server console is clean (the hook-order
  warnings seen mid-edit were stale Fast-Refresh transition artifacts). `typecheck` (+web) + `lint` +
  `test` (**81**) + `build:web` all pass.

### In-place combat — the shop closes, the enemies arrive (no more separate arena screen)
Combat now plays out **on the recruit board itself** instead of cutting to a separate full-screen
arena. When you End Turn, the top half "closes up" (the tavern offers, the control bar, the timer,
the rope and the hand animate away) and the enemy team **arrives** where the tavern was — while the
**warband, the Warden hero frame, the HUD (ASCENT / wave / tribes / mute) and the Embers/Resolve
panel never move**. After the fight, your board plays a one-shot **reset** animation as the next
shop opens. (Item 11 of the batch.)
- **`Recruit` is the single, always-mounted board.** `Game.tsx` no longer swaps `Recruit` ↔ `Arena`;
  it renders `Recruit` for every phase, so the persistent chrome literally never unmounts (hence it
  can't move). `Arena.tsx` is **deleted**.
- **Replay engine extracted to a hook.** All of the old Arena's beat/lunge/projectile/float/SFX/
  verdict logic moved verbatim into `useCombatReplay(combat, { active, findEl })` (new
  `useCombatReplay.ts`); the combat `Unit` card moved to `Unit.tsx`. The hook is decoupled from
  layout: `active` gates the clock (so we can hold on the intro), and `findEl(uid)` resolves a unit's
  live DOM node for measuring lunges/bolts in *any* layout (it now looks inside the warband + tavern
  zones). The UI still only **replays** `simulate()` — it never computes combat.
- **Intro staging.** A local `combatStage` sequences `closing` → `fighting`: ~480 ms of "shop
  closing" (offers + control bar fold up and fade; the hand slides off the bottom), then the enemies
  arrive (slide-in) in the tavern's slot and the replay begins. The control bar's slot swaps to a
  compact combat bar (Wave · threat + **Skip**, then **Climb On**/End Combat when the replay settles)
  — same height, so the warband doesn't reflow. The VS divider is positioned out of flow so it can't
  shift the warband either.
- **Post-combat reset.** Returning to recruit tags the warband row `.resetting` for a 0.65 s settle
  animation; the shop reopens around it.
- **Timer-reset fix (caught live).** Because `Recruit` no longer remounts per wave, the round timer
  (which used to re-init on remount) stopped resetting — it carried 0s into the next wave. Added an
  effect keyed on `run.wave` that re-arms `seconds` to that wave's `turnSeconds` at the start of each
  recruit phase. Also gated drag-start and Hero-Power aiming on `!inCombat`.
- **Verified live (full loop):** drove a real run via synthetic pointer drags — bought + played a
  minion, hit End Turn, and confirmed through the DOM + screenshots that the shop closes (`app` →
  `app combat` → `app combat fighting`), the enemy unit arrives in the tavern zone, the warband units
  render in place, the HUD/hero/Embers stay put, the narration line shows, then End Combat returns to
  recruit (`row warband resetting` → settled), the shop reopens (4 offers), Resolve ticks 30→29, and
  the wave advances to 2 with the timer correctly re-armed (35 s). No console errors. `typecheck`
  (+web) + `lint` + `test` (**81**) + `build:web` all pass.

### Card/VFX/timer polish pass — spacing, spell sparks, buff procs, scaling timer
A grab-bag of feel + readability fixes (items 1–10 of an 11-item batch; the in-place combat
transition is the separate item below):
- **More space between cards** — the row `gap` 10→22px so the (2×) Attack/Health badges of
  adjacent cards no longer overlap.
- **Countdown ticks** — a short square-wave `tick` blip plays on each of the last five seconds of a
  turn (5·4·3·2·1), wired into the recruit timer (`sfx.tick()`), so you *hear* the clock running out.
- **Taunt ward 3×** — the Taunt corner emblem is 26→78px (icon 15→45px) so Taunt reads at a glance.
- **Divine-Shield glow +30%** — the combat DS aura's ring/blur/spread are ~30% thicker (`.unit.ds`).
- **Turn timer grows per wave** — base 30s + 5s each wave, capped at 70s (`turnSeconds`); the ring +
  rope fill scale to the new length. (Recruit remounts per wave, so it initialises fresh.)
- **Tier pills bigger + on spells** — the "Tier X" pill/text is +25%, and spells now carry a tier
  pill too (the tavern spell offer passes `tier` through `shopView`).
- **Cost ember outlined** — the flame cost badge gets a soft white outline (double `drop-shadow`) so
  it separates from the art behind it.
- **Spell spark** — casting a spell pops a one-shot accent-coloured burst (a flash + 8 radiating
  rays) at the point it resolved (`fireSpark` on the cast/play branches → `.spellspark`).
- **Buff proc** — when a recruit-phase buff lands (hero power, spell, summon buff) the card now plays
  a punchier green flash *plus* an expanding ring + spark shards (`.buffburst`), so e.g. Warden's
  Fortify reads as a clear proc rather than a faint tint.
- **Board art → board 2** — swapped the play-surface backdrop (`apps/web/public/board.jpg`) to the
  new warm crystal-arena render (1536×1024 → JPEG q82, 135 KB).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**) + `build:web` all pass; live DOM +
  screenshot confirm row gap = 22px, the spell offer shows a "Tier 1" pill, the cost SVG carries the
  white `drop-shadow` outline, the Taunt ward = 78px (only on Taunt cards — confirmed it doesn't
  misfire on Divine-Shield/other cards), and board 2 is rendering. The tick/spark/buff-burst are
  transient VFX/audio verified via code + the green build.

### Bigger stat badges (2x, overhanging) + HUD scale-up
- **Attack / Health badges are 2× and overhang the card's bottom corners** (60px, was 30px), mirroring
  the cost ember at the top. They're absolutely positioned (out of the footer flow); the footer is
  padded so the (larger) tribe label centres cleanly between them and never slips under a badge. The
  horizontal overhang is a slight −8px (the bottom −12px does the "eclipse") so adjacent cards on a
  packed board don't clash much.
- **Cost ember pushed further up-left** (top/left −34/−32 → −44/−42) to eclipse the corner more.
- **Tribe text bigger** (11→14px, icon 14→17px).
- **Hero panel +15%** again (portrait 70→80px, name/power text scaled; panel ≈100px tall).
- **Embers chip is now as tall as the hero** — the top row stretches (`align-items: stretch`) so the
  Embers chip matches the hero's height (both ~100px), and its icon/value are scaled up to fill it.
- **HP bar scaled up** with the rest (bar 15→20px, heart 26→32px, value 22→28px).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**) + `build:web` pass; atk/hp = 60×60,
  Embers chip = hero = 100px tall, HP bar 20px, and the tribe label fits (not clipped) — all confirmed
  via DOM + live screenshots.

### Resolve as an HP bar, hero panel +20%, cost-text nudge, re-wired Broker art
- **Resolve → an HP bar across the bottom of the status tray.** The chunky `[heart | 30 | "Resolve"]`
  chip is gone. The tray is now a column: **Embers + Hero on the top row**, and a full-width **HP bar
  across the bottom** — red heart on the left, the red fill in the middle (`resolve / maxResolve`), and
  the **current health on the right**. No "Resolve" label. Frees the tray's third slot so the hero can
  grow. (The resolve-loss shake + −X float moved onto the bar.)
- **Hero panel +20%** — the Warden portrait is 58→70px with the name/power text scaled to match, so it
  reads as the tray's centrepiece.
- **Cost text nudged up** — the number sits a little higher in the flame's body (`.costn` padding-top
  24→17px) so it reads as more centred.
- **Re-wired the new Brightwing Broker art** — re-exported the updated source to `broker.png` (512²);
  confirmed it re-bundled with a fresh hash.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**) + `build:web` pass; HP bar (full at 30/30,
  value 30, no label), 70px hero portrait, and the cost padding all confirmed via DOM (the preview
  screenshot tool was unresponsive this session, so visual checks were done through the live DOM + the
  build output).

### Combat attack-order fix, Warden + Broker art, spell rules, drag sensitivity
- **Combat bug — attacker order after a death (fixed).** The attack loop picked the next attacker by
  indexing into the **living** list (`live[pointer % live.length]`). When a minion died it dropped out
  of `living()`, which **re-indexes**, so the pointer skipped the minion to the right of the one that
  died — e.g. with `[Sporeling 1/2, Stray, Taunt Sporeling]`, the front Sporeling traded in and died,
  then the **Taunt Sporeling attacked before the Stray**. Now the next attacker is tracked by
  **identity** (resume from the last attacker's position in the full board array), which is stable
  across deaths *and* mid-combat summons. Added a regression test (front 1/1 dies → the 2nd minion,
  not the 3rd, swings next). (Not a Taunt issue — Taunt only affects targeting, never attack order.)
- **Hero (Warden) + Brightwing Broker art wired.** Added an `art/heroes/*.png` glob + `heroArt()`; the
  hero panel now shows the **Warden** portrait (falls back to the anvil icon if absent). Brightwing
  Broker (`broker`, a Tier-2 neutral) gets its illustration via the normal minion glob. Both 512²,
  confirmed bundled.
- **Hero power usable without a friend on board.** `canHero` is now just `heroReady` (was gated on
  having a board/shop minion) — since Fortify can target a tavern offer, it's always usable when ready.
- **Spells: no triple, no sell.** `checkTriples` ignores spell cards (three copies stay separate), and
  the `sell` reducer refuses spells (they're only played for their effect). Drag-to-sell already
  excluded spells in the UI; this enforces it in the engine too. (+2 tests.)
- **Card insertion is more sensitive.** Dragging a card now moves the insertion point past another
  card when the cursor reaches **~35%** into it (was the 50% centre), so cards slide out of the way
  sooner — e.g. dropping next to a lone minion pushes it aside instead of landing on the far side.
  Tunable via `INSERT_FRAC` in Recruit.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**, +3) + `build:web` pass; combat-order
  regression test green, Warden portrait rendering live, hero power armable on an empty board, Broker +
  Warden art bundled.

### Hero power can buff tavern minions, embers-projection popup, spell-sell fix + polish
- **Hero power targets the tavern now.** Fortify reads "give a minion +1/+1" (not "a *friendly*
  minion"), so it can target a **tavern offer**, not just the warband. `ShopCard` gained `atk`/`hp`/
  `keywords` buff fields; the hero-power reducer applies +1/+1 to a targeted offer, `shopView` shows the
  buffed stats (green), and **buy bakes the buff into the minion**. The aim (`minionAt`) now detects
  warband *or* tavern minion cards (never the spell), and `canHero` allows arming with an empty board
  as long as the shop has offers. Sets up the general "target a tavern minion" capability for future
  spells/cards. (Verified live: Fortify a shop Sporeling 1/2 → 2/3, bought as a 2/3; tests cover it.)
- **Spell "+1g" fix.** Dropping a *spell* on the tavern was hitting the minion-sell branch (`+1` Ember),
  so dragging a spell up toward the offers (now at the top) could silently sell it. Spells are now
  excluded from drag-to-sell — a spell dragged to the tavern just cancels (cast/play only). (Targeted
  spells already gave no embers when released without a target; the only intended +1 is Ember Pouch's
  net-neutral cast — buy −1, cast +1.)
- **Embers projection popup.** Hovering the Embers chip pops a small panel showing the **starting Embers
  for the next two waves** (cascading up, e.g. "Wave 2 → 4, Wave 3 → 5"), based on the maxEmbers curve.
  Made the Embers chip hoverable (it was `pointer-events: none` in the corner tray; still passes through
  mid-drag) and gave the chips the game's custom cursor instead of the OS `help` cursor.
- **Fodder tooltip** reworded — "A cheap minion your **Demon cards** can consume for its stats."
- **Cost badge** — the ember (flame) is ~10% larger and the cost number ~10% smaller, pushed further
  up-left to eclipse the corner more (number kept in the flame's body).
- **Hero panel ~15% larger** in the corner tray (portrait + text), so it reads as the tray's centrepiece.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**78**, +1 tavern-targeting) + `build:web` pass;
  embers popup, cost badge, hero panel, Fodder text, spell-no-sell, and hero-power-on-tavern all
  confirmed live.

### Bigger cost badge, reorderable shop, + two new T1 spells (Ember Pouch, Bulwark)
- **Cost badge 2× larger** — the ember/flame cost badge doubled (47→94px, font 17→34px) and its corner
  overhang scaled with it, so the cost reads at a glance.
- **Shop offers are reorderable** (like the warband). Added a `reorderShop` action (mirrors
  `reposition`, purely cosmetic on `s.shop`) + an `overShop`/`shopGapIndex` drop-slot + a `shopIndexAt`
  helper; `applyDrop` now reorders an offer dropped back in the tavern instead of snapping it back to
  its slot (the spell stays pinned at the end). This removes the "teleport back to slot" jank — a
  dragged offer lands where you drop it. Verified live: dragging offer 1 to slot 3 reorders it, the
  drop-slot shows, and the spell stays last.
- **Two new Tier-1 spells** (art wired from the Spells folder → `art/minions/{emberpouch,bulwark}.png`,
  512²; the spell slot now rotates among all three):
  - **Ember Pouch** (1 cost, untargeted) — *Gain 1 Ember.* New untargeted cast path: `gainEmbers` is
    handled in `castSpell` against the run state (embers uncapped within a turn, like selling). **Note:
    net-neutral** as specced (pay 1 on buy, gain 1 on cast) — flagged in case more/over-time gain was
    intended.
  - **Bulwark** (1 cost, target a friend) — *+0/+1 and Taunt.* Extended `spellBuffTarget` to grant an
    optional `keyword` param (so it buffs **and** grants Taunt); reused for any future buff-a-keyword
    spell.
  - Added `gainEmbers` to the `EffectFactoryId` (core type + zod schema); `params` already allowed the
    `keyword`/`amount` keys.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**77**, +2 for the new spells) + `build:web` pass;
  cost-badge size, shop reorder + drop-slot, and both spells (art + cost + text, Ember Pouch net-neutral,
  Bulwark +0/+1 + Taunt) confirmed live. `TURN_SECONDS` test bump reverted to 30.

### Cost-in-an-ember, styled hero tooltip + cursor fix, shop gets the warband lift-out drag
- **Cost sits inside an ember (flame).** The cost badge was a plain orange circle; it's now the ember
  flame `Icon` (orange) with the cost number (white) over its bulb, still overhanging the card's
  top-left corner — visually tying the cost to Embers (the currency).
- **Spent-hero cursor fixed.** `.hero.spent` used `cursor: default` (the OS arrow), so moving onto a
  used hero power visibly switched/flickered away from the game's custom SVG cursors. It now keeps the
  custom `gauntlet_default` cursor — no jarring switch. (The Embers/Resolve chips are `pointer-events:
  none`, so only the hero showed this.)
- **Hero-power tooltip now matches the aesthetic.** Replaced the native `title=""` (ugly OS tooltip)
  with a styled `.herotip` — the same dark rounded pill as the card keyword tooltips, "Fortify" in
  orange, popping above the corner tray on hover. Reads "Used this wave." when the power is spent.
- **Shop drag = warband drag (no more "shadow").** Buying used the dim-shadow (`.dragsrc` opacity) — the
  dragged offer stayed dimmed in place while a copy floated. Now the shop uses the warband's **lift-out
  + FLIP**: the dragged offer leaves the row entirely (the floating copy *is* the card) and the rest
  **slide to close the gap**; on drop it buys. Implemented by adding `displayShop` (filters the dragged
  offer, mirroring `displayBoard`), giving shop cards `data-uid`, folding the spell's shown/hidden state
  into `flipKey`, and extending the FLIP `useLayoutEffect` to track **both** the tavern and warband
  rows. Verified live: dragging an offer lifts it out (no `.dragsrc`), the others slide, release on the
  hand buys it, and the row closes up.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; cost badge, spent-hero
  cursor (`gauntlet_default`), styled tooltip, and shop lift-out/slide/buy all confirmed live.
  `TURN_SECONDS` test bump reverted to 30.

### Scale the board to the viewport (16:9 → 21:9), overhang cost badge, Stray ≠ Fodder
- **Stray is no longer treated as Fodder.** `consumeFodderOnSummon` now matches **strictly the `FD`
  keyword** (dropped the "any token" fallback), so a Voracious Imp won't eat a summoned Beast Stray.
  (Stray never had the keyword — the fallback was making it behave like Fodder.) Test updated to assert
  the Stray *stays* and the Imp is unchanged.
- **Card sizing now scales with the viewport** so the board fills big screens (the game looked tiny on
  a 3440×1440 / 21:9 monitor): `--ch: clamp(220px, 27vh, 384px)`, `--cw = --ch × 0.752`, and the
  bottom padding + warband nudge are now `--ch`-relative. Verified across sizes — at **3440×1440** cards
  are **384px** tall (was a flat 278px) with **no overflow**; fits 16:9 down to ~768px tall too. The
  ultrawide play area stays centred (cards big, side margins are expected on 21:9). *Chrome (HUD/buttons)
  is still fixed-px — flagged for a follow-up if the user wants it scaled too.*
- **Hand hover is gentle now.** The hover-pop was `translateY(-150px)` — it flung the card ~184px up,
  out from under the cursor (causing a hover/un-hover bounce). Now `translateY(-5%)` (≈33px lift) +
  `z-index` — just enough to reveal the card and bring it to the front, staying under the pointer.
- **Cost badge overhangs the corner.** Moved the `.cost` badge out of the `overflow:hidden` `.art` to
  be a direct child of `.card`, then restyled it to hang over the **top-left corner** (eclipsing the
  edge), filled solid **orange** with **white** text, **~50% larger** (26→40px, 14→21px), with a cream
  ring + shadow so it reads as a sticker.
- **Removed the "Altitude" label** from the top wave readout (just the wave number + meter now).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; scaling measured at
  3440×1440 (no overflow), cost badge / Stray / Altitude / hand-hover confirmed live. `TURN_SECONDS`
  test bump reverted to 30.

### Mirror layout: offers vs warband across the centre, HUD to the bottom-left corner
- **Tavern controls decoupled from the offers.** The Refresh/Freeze/Tier/End-Turn `shopctl` bar moved
  out of the tavern `[data-zone]` and now sits as its own control bar under the HUD; the tavern zone
  wraps only the offer cards. The **offers and warband are now flex-grow halves that mirror each other
  across the board's centre** (`flex: 1 1 0; justify-content: center` on each) — shop on top, your
  board below, like two facing lines.
- **Rope back on the centre line.** The burning-rope timer returned to the flow *between* the two
  zones (`position: relative; align-self: center`), so it lands exactly on the offers/warband split at
  any viewport (was a fixed `top: 50%`, which sat on the warband's edge).
- **Warband nudged up** (`padding-bottom: 48px`) to open a clearer gap above the hand (measured ~130px
  warband-bottom → hand-peek at 1300px tall).
- **HUD moved to the bottom-LEFT corner** and shrunk. The Embers · Hero · Resolve tray was the
  bottom-centre centrepiece (hero portrait 108px); it's now a **compact** tray pinned bottom-left
  (hero 50px, smaller chips), so the **hand owns the whole bottom-centre** with room to breathe. The
  compact tray (~440px wide) clears the centred hand — no overlap. (Kept `pointer-events: none` + the
  mid-drag hero pass-through in case a very wide hand fan reaches the corner.)
- **Hand hover snappier** stayed (0.08s); with the bar out of the centre the hand peeks/pops in the
  open instead of from behind the panels.
- **Divine Shield overlay removed** ("too much noise for now"): dropped the `.dsfx` image from `Card`
  + its CSS and the now-unused `effectArt` import. The `effectArt()` helper + `art/effects/divineshield.png`
  are **retained** (unused) so it's a one-line re-add later.
- **Minion-pool quantities — placeholder.** Added `POOL_QUANTITIES` to `@game/sim` config (Tier 1→16,
  2→15, 3→13, 4→11, 5→9, 6→7, **7→5 as a forward placeholder** — no tier-7 cards yet). **Not wired into
  shop rolls yet**; the finite-pool refactor is queued in the roadmap.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; the mirrored layout,
  centred rope, bottom-left tray, removed DS, and Fred's Fodder pill all confirmed live (DOM probes +
  screenshots). `TURN_SECONDS`/`SPEED` test bumps reverted to 30/1.5.

### Fodder → a keyword (card becomes "Fred") + HUD tray, tavern raised, rope centred
- **Fodder is now a keyword (`FD`), not a one-off card.** Added `FD` to the `Keyword` union
  (`@game/core`) + the zod `KeywordSchema` (`@game/content`). The Tier-1 demon card is renamed
  **Fodder → Fred** (`id: 'fred'`, `keywords: ['FD']`, empty body text — the pill carries the meaning,
  so the old "Cheap fuel —" prose is gone). The consume trigger (`consumeFodderOnSummon`) now keys off
  the **keyword** (`minion.keywords.includes('FD')`) instead of the hard-coded `cardId === 'fodder'`,
  with the token fallback kept — so any future card can be marked Fodder and be eaten. Voracious Imp's
  text now reads "When you play a **Fodder** minion…". Card UI gained `FD → 'Fodder'` in the label +
  tooltip maps (label-only pill, like Consume). Art renamed `art/minions/fodder.png → fred.png` to
  track the new id. The `fred`/`FD` consume test was updated. (Verified live: Fred shows the "Fodder"
  pill + `fred.png` art + no description; the Imp eats a played Fred.)
- **Status-bar tray.** Embers · Hero · Resolve now sit in one connecting rounded frame (the
  `.statusbar` got a translucent card background, border, radius + tighter gap) so they read as a
  single unit instead of three floating panels.
- **Hero never fades.** Dropped the `opacity: 0.5` on the spent hero — the portrait/power stays full
  strength even when it can't be used this wave (the ready-pulse is the only "available" cue).
- **Tavern raised, warband lowered, rope centred.** With the freed room, the Tavern now rides high
  near the HUD (was vertically centred), the Warband floats down toward the hand (`margin-top: auto`),
  and the burning rope timer is pinned across the **centre of the board** (`position: fixed; top: 50%`)
  instead of tucked under the tavern.
- **Hand fans up from behind the tray, snappier.** The tucked hand now sits behind the status-bar
  tray (its bg cleanly hides the tucked portion; cards peek above), and the hover-pop transition was
  sped up (0.16s → 0.08s with a snappier curve). The status bar stays fully opaque (never faded).
- **Perf: dropped `background-attachment: fixed`** on the board image. The app never scrolls (100vh,
  overflow hidden), so `fixed` was pure cost — a full-viewport repaint on every paint — for zero
  visual difference. Removing it visibly smoothed repaints (preview screenshots that were *timing out*
  now return instantly). The remaining buy/drag micro-stutter is most likely the preview window's
  remote-control + screenshot overhead; a local `npm run dev` build should feel markedly smoother. A
  deeper pass (memoising cards / imperative drag-follow) is queued if it persists locally.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; all of the above
  confirmed live (DOM probes + screenshots). `TURN_SECONDS`/`SPEED` test bumps reverted to 30/1.5.

### Tribe recolour + HUD/layout pass: hand tucked under the bar, omen + row labels gone
A UI/feel batch (all verified live in the running app):
- **Tribe hues recoloured** to the user's spec (each drives a card's `--c` accent → art panel
  tint, footer, keyword pills, and the HUD tribe dots): **Beast green** `#4ea83b`, **Dragon
  red/orange** `#ff6a3c`, **Mech blue** `#27a9dd`, **Undead dark slate-blue** `#5c6f8c`, **Demon
  purple** `#b15cf0`, **Neutral light greige** `#9a8d79`. Two colours were *overloaded* onto tribe
  hues and had to be decoupled first: the **Embers** chip icon (was `--t-beast`, now `--acc` so it
  stays warm) and the **combat poison** green (floats + omen badge — now a dedicated `--poison`
  `#22be86`, the old Undead hue, so poison reads green regardless of the Undead recolour).
- **Dual-type capability** (forward-looking — "dual-type minions will exist"): `CardView` gained an
  optional `tribe2`; a `.card.dual` splits the art panel + footer down the middle into both hues
  (`--c` / `--c2`). Dormant until the card data model carries a second tribe (see roadmap) — no card
  triggers it yet, so it's a ready visual, not active content.
- **Fodder's name now shows.** Root cause was a flex bug, not data: `.cbody` is a flex column and
  `.cn` (the name pill) had default `flex-shrink: 1`, so Fodder's longer description overflowed and
  squeezed the name to **5px** tall (invisible). Fixed with `.cn { flex: none }` — the name keeps its
  full height on every card; the description clips instead if it's ever too long. (Confirmed live:
  Fodder's `.cn` went 5px → 18px, text "Fodder" visible.)
- **Divine Shield overlay enlarged.** `.dsfx` now spills past the card edges (`112%`×`78%`, offset
  up/left) so the shield reads as an aura *around* the minion, not a contained icon — while the
  screen blend keeps the minion visible through it (confirmed on Spare Part Drone: bigger golden
  shield, drone still clearly readable underneath).
- **Removed the red omen bar.** Per the user, the pre-shop threat telegraph is gone for now — only
  the wave # (already in the top HUD) remains. `<Omen />` is no longer rendered (the component file
  is retained, unrendered, for easy restoration later).
- **Removed the left-row labels** ("The Tavern · Tier", "Your Warband · n/7", "Your Hand") — the
  per-zone `.zh` headers were dropped from all three rows for a cleaner board.
- **Hand reworked into a bottom fan tucked under the status bar.** The hand is now `position: fixed`
  at the bottom centre (`z-index: 25`, below the bar), its lower half behind the Embers/Hero/Resolve
  panels; a hovered card pops fully up (`translateY(-150px)`, `z-index: 45`) to read in full. The old
  dashed empty-hand box is gone (empty hand renders nothing). This frees the hand's old full-height
  row, so the **Tavern + Warband now centre lower** in the freed space (auto margins).
  - *Drop/interaction fixes this required:* the status bar is now `pointer-events: none` (only the
    hero captures, and even the hero goes click-through mid-drag via `body.dragging`) so a card can be
    **bought/played/grabbed** through the bar to the hand tucked behind it; and `onUp` now resolves
    the drop **zone before** clearing `body.dragging`, so the pass-through is still active at the
    moment the drop is read. Verified live: buying by dropping dead-centre (over the hero) lands in
    the hand, and playing a card from the tucked hand up to the warband works.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` all pass; every item
  above confirmed live via DOM probes + screenshots.

### Board art + Warden rename + aim-line spell casting + Divine Shield art + Fodder (demons fixed)
A six-part feel/content pass (all verified live in the running app):
- **Board background art.** The user's `board1` (a purple crystalline arena) is now the play surface:
  exported to `apps/web/public/board.jpg` (1536×1024, JPEG q82 → 201 kB) and painted on `body` under a
  dark scrim gradient (`linear-gradient(rgba(28,22,16,.34), …(.46))` over `url('/board.jpg') cover
  fixed`) so the cards/HUD stay legible. (Kept the taupe `--bg` as the fallback under the image.)
- **Spell casting reworked to match the hero power** (replacing last pass's drag-the-card-onto-a-friend
  gesture, per the user's spec):
  - **Non-targeted spells** ("buff your whole board", "gain Embers") — drag the card up and release
    anywhere in the warband space, like playing a minion; the effect fires. (`applyDrop` spell branch:
    no `target` → dropping on `zone==='warband'` dispatches the cast.)
  - **Targeted spells** (`target:'friendly'`, e.g. Spirit Fire) — the instant the card leaves the hand
    it **turns into the Forgewarden/Warden targeting line**: the floating card is hidden and an SVG
    aim-line (`svg.aimline`) is drawn from the hand to the cursor with a reticle that snaps **on** over
    a valid friendly minion (which gets the strong `targeted` highlight, same as the hero power).
    Release on a minion → spell goes off; **release off any minion → snaps back to hand**; **right-click
    → snaps back to hand** and the line ends. (`castingSpell`/`castTargetUid` derive from the live drag;
    `onUp` clears without dispatch when no target; a window `contextmenu` listener cancels held spells.)
  - Verified live: aim-line + reticle render on drag-out (`dragcard` hidden), release on the Imp cast
    Spirit Fire **+3/+3 (2/2 → 5/5)** and emptied the hand, and **both** cancel paths (empty-release,
    right-click) left the card in hand with the line gone.
- **Rename Forgewarden → Warden, hero power Temper → Fortify.** Pure UI/string change in `StatusBar`
  (title, hero name, "Fortify · +1/+1" subtitle) + the Recruit hint; the `+1/+1` effect is unchanged.
- **Spirit Fire art** wired (`art/minions/spiritfire.png`, 512²) — the spell card now shows its
  illustration via the existing `artFor` glob (card id = filename).
- **Divine Shield effect art.** Added an `art/effects/*.png` glob + `effectArt(name)` in `art.ts`;
  `Card` overlays `effectArt('divineshield')` on any minion with the `DS` keyword. The art is a golden
  shield-crest on transparent — rendered naïvely (`object-fit:cover`) it was opaque and hid the minion,
  so `.dsfx` uses **`mix-blend-mode:screen` + `object-fit:contain` + a slow opacity pulse**, making it a
  glowing aura the minion shows *through*. Verified live on **Spare Part Drone** (the drone reads clearly
  under the shield glow). *Follow-up for the user's call: it's a shield **crest** shape, not a bubble —
  swap art or move to a corner badge if a rounder "bubble" look is wanted.*
- **Fodder — the fix that makes Demons actually work.** The Consume engine (Voracious Imp et al.) had no
  cheap fuel to eat, so Demons were dead on arrival. Added **Fodder** (Tier 1 **1/1** Demon, art wired)
  as a buyable card, and taught the consume trigger to recognize it (`consumeFodderOnSummon` now fires
  for `cardId==='fodder'` as well as tokens). Verified live: bought + played Fodder beside a 5/5
  Voracious Imp → Imp **ate it → 6/6**, Fodder did not linger on the board. (Voracious Imp text updated:
  "When you play **Fodder**, this eats it and gains its stats.")
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**, +1 Fodder-consume test) + `build:web` all
  pass; the six features above confirmed live via DOM checks + screenshots. `TURN_SECONDS`/`SPEED` test
  bumps reverted to 30/1.5.

### Spell system + Spirit Fire + targeted casting
- **A new card kind: spells.** `CardDef` grew `spell` / `cost` / `target`; spells set their own cost
  (minions stay flat `CONFIG.minionCost`), are excluded from the minion pool, and never take a board
  slot. The shop now always offers exactly one spell on the **right** (`state.spell`, re-rolled each
  refresh from `SPELL_CARDS`). Zod schema kept in lockstep.
- **Spirit Fire** (the first spell): cost **2**, *target a friendly minion → +3/+3*. Bought into the
  hand, then **cast by dragging it onto a friend** (the target highlights; release off a minion snaps
  back). Verified live: 2/1 Drone → 5/4, spell consumed, slot re-offers on reroll.
- **Targeting mechanic** (the "target Battlecry" change): `target: 'friendly'` + a `targetUid` on the
  `play` action + `boardUidAt()` + the existing aim-highlight. Spirit Fire is its first user; targeted
  *minion* Battlecries reuse the same path (a small factory + place-then-target gesture away).
- **Plumbing set up now, ready for cards** (per the user — buffable spells, spell-casters,
  spell-trackers):
  - `spellCast` game event + `state.spellsCast` counter — minions that track spells cast.
  - `castSpell` recruit factory — a minion casts a named spell from an event (auto-targets the carry;
    counts the cast without re-firing `spellCast`, so no recursion).
  - `state.spellCostMod` — flat reduction subtracted from spell cost at buy ("your spells cost less").
- **Verified:** `typecheck` (+ web) + `lint` + `test` (**74**, +4 spell tests) + `build:web` pass;
  the shop slot, buy, drag-to-target cast (+3/+3), consume, and reroll re-offer all confirmed live.

### Fix: warband cards flew off-screen when wiggling a held minion
- Dragging a held minion back and forth over another a few times made the other cards "spazz out"
  and vanish. Cause: the FLIP slide measured each card's `getBoundingClientRect()` **including its
  in-flight transform**, then stored that interpolated value as the next "first" position — so rapid
  drags compounded the deltas until `translateX` flung cards far off-screen. Fixed by dropping any
  in-progress transform (`transition:none; transform:''`) on every tracked card *before* measuring,
  so each FLIP works from true layout positions; deltas stay bounded by the row width. Verified live:
  wiggling a held minion back and forth 8× over a 3-card board leaves every other card on-screen in
  place (was: flung away / gone).

### Warband drag — truly lift the held card out (drop-in-place, take 2)
- The previous pass only lifted the dragged board minion out *while the cursor was over the
  warband*; dragging it away (e.g. toward the hand) flipped it back to a solid card in the row, so
  you saw a duplicate — the copy you're holding *and* the original still sitting in the warband.
  Now the dragged minion is lifted out of the row for the **entire** drag (the floating copy is the
  card), the rest physically close up, and an empty drop-slot opens at the live insertion point only
  while hovering the warband — the held copy drops straight into it. Also made the drop-slot more
  visible. Verified live: dragging toward the hand leaves only the other minion in the warband (no
  duplicate); holding over the warband opens the slot with the dragged card lifted out.

### Keyword system (Immune/Stealth/Avenge/End-of-Turn + out-of-combat Deathrattle) + drop-in-place drag + lighter board
- **Lighter board** — the taupe backdrop was a touch dark; nudged `--bg` `#7d756b` → `#8c857a`.
- **Drop-in-place warband drag** — reordering a board minion no longer does a jarring post-drop
  "swap" animation. While you drag, the minion rides along as the held copy and its placeholder
  slides to the live insertion slot (the other cards open a gap via FLIP); on release the card lands
  exactly where it already shows, so there's no second shuffle. A played hand card opens the same
  slot. (Replaced the absolute drop-bar with a real `displayBoard` reorder + a `.dropslot` gap;
  `flipKey` drives the live FLIP. Verified live via a held drag — the order is already final before
  release.)
- **Keywords wired/fixed** across `@game/core` + `@game/sim` + UI, with the zod schema kept in
  lockstep:
  - **Immune (`IMM`)** — takes no damage at all (checked first in `dealDamage`, before Divine Shield;
    blocks Poison and destroy-by-damage too). Combat keyword, works on any card. Tested.
  - **Stealth (`ST`)** — can't be targeted by attacks (`chooseTarget` skips it; if every defender is
    Stealthed the swing is skipped) and is lost the moment it attacks (emits a new `reveal` event so
    the replay drops the keyword; the card wears a shadowy look until then). Tested.
  - **Avenge** — new `avenge` game event: `simulate` keeps a per-side death tally and emits it on
    each death; the `avengeBuff` factory fires every X friendly deaths. Trigger + pill wired (text
    prefix "Avenge (X):"); ready for any card that declares it.
  - **End of Turn** — new `endOfTurn` game event fired by `applyEndOfTurn` at the top of `faceOmen`
    (the turn ending / timer hitting 0), baking into the board before combat; `endOfTurnBuff` recruit
    factory + pill wired.
  - **Deathrattle now fires out of combat** — when a minion is Consumed (destroyed in the recruit
    phase) its Deathrattle resolves via recruit-side factories (summon / buff-tribe / buff-carry /
    grant-shield). Tested (Soulfeeder eating a Sporeling triggers its +1/+1).
  - Verified the rest already behave to spec: Battlecry (onPlay, +Drummer re-trigger), Divine Shield,
    Poison, Reborn, Start of Combat, Consume, Cleave, Windfury (existing tests cover them).
- **Verified:** `typecheck` (+ web) + `lint` + `test` (**70**, +3) + `build:web` all pass; lighter
  board + Target Dummy art + clean render confirmed live.

## 2026-06-16

### Combat out-of-order fix + darker board + tier-1 art + renames
- **Combat replaying out of order — fixed (the important one).** The simulator is deterministic and
  the beat advance is a monotonic `k => k+1`, so the *data* order was never wrong (confirmed by
  tracing). The bug was in the visual layer: the attacker→target **lunge** and the Start-of-Combat
  **projectiles** were measured by reading the DOM *during render* (`querySelector(...)
  .getBoundingClientRect()`), and the lunge was stored by **mutating a ref during render**. Render
  sees the *previously committed* frame, so when a death or summon shifted a minion between beats, an
  attacker lunged toward where its target *used to be* — and StrictMode's intentional double-render
  amplified the inconsistency. Moved both measurements into a `useLayoutEffect` (runs after the beat
  commits, when the DOM is current) and hold them in state, so render is pure and StrictMode-safe.
  Verified live (slow + normal speed): attackers lunge at the correct target, combat plays in order
  and completes, console clean.
- **Darker board.** The backdrop went from bright cream (`#f6f0e5`) to a warm taupe (`#7d756b`) so
  the cards and art pop; the text that sits directly on the board (zone titles, hints, combat log +
  side labels, the game-over wash) was lightened to stay legible.
- **Tier-1 art + renames.** Wired illustrations for **Alleycat, Sporeling, Stray, Target Dummy**
  (downsized to 512²). Renamed **Alleycur → Alleycat** and **Pocket Sandbag → Target Dummy** — display
  names only; the card ids (`alley`, `sandbag`) are unchanged, so art lookup + the run tests are
  unaffected (the sim references were comments).
- Verified: `typecheck` (+ web) + `lint` + `test` (67) + `build:web` (8 art PNGs bundle) all pass;
  dark board + Alleycat/Sporeling art + the rename confirmed live.

### Art fills the panel + standardized text line + Battlecry/Deathrattle pills + right-click inspect
- **Art zoomed to fill** — `object-fit` back to `cover` (from `contain`), so the illustration fills
  the 60 % art panel edge-to-edge (the user preferred full-bleed over the letterboxed full image).
- **Standardized text line** — the keyword-pill row (`.kws`) now always renders and reserves one
  pill-row of height, so a card's description starts on the same line whether or not it has pills.
  Verified Start (Ember Whelp), Battlecry (Alleycur), and Deathrattle (Sporeling) all land their
  description at the same Y (456 px).
- **Battlecry / Deathrattle pills** — these aren't keywords in the data model, so the Card derives
  them from the text prefix (tolerating the `**bold**` markdown — `/^\W*battlecry/i`) and shows a pill
  matching the existing Start / Consume style: Battlecry gets a new horn glyph, Deathrattle the skull.
- **Right-click inspect** — right-clicking any card (shop, hand, warband, or a combat unit) floats a
  centred, enlarged copy over a dimmed + blurred backdrop for a close look; click the backdrop or
  press Escape to dismiss. New `inspect` store state + `inspectCard`/`clearInspect` actions, an
  `<Inspect>` overlay at the Game root, and `onContextMenu` on the Card. Any dispatch also closes it.
- **Verified live**: art fills the panel; Start/Battlecry/Deathrattle descriptions all align at
  456 px; both new pills render with icons; inspect opens centred (centreX = viewport centre) and
  closes on backdrop-click and Escape. `typecheck` (+ web) + `lint` + `test` (67) + `build:web` pass.

### Bigger cards + 60% full-image art + compact Omen + sweet-spot targeting
- **Cards larger** — added `--cw` / `--ch` card-size variables (one standard size used in shop,
  warband, hand, and combat). Width +10 % (190→209 px) and height +14 px (264→278 px).
- **Art area 60 %, full image** — the art panel grew 50 %→60 % of the card and `object-fit` changed
  cover→**contain**, so the *whole* illustration is shown (no cropping); the tribe-tinted panel frames
  it. (The earlier "art too big" was a containment bug, already fixed; this is the size/fit the user
  asked for — 512² art is still the right source.)
- **Compact Omen** — the upcoming-threat banner was tightened (padding 11→7, name 24→19, description
  13→12, sigil 50→44, spacing) from ~123 px to ~100 px, funding the taller cards so the net vertical
  footprint barely changes. Verified live: recruit keeps ~31 px clearance above the StatusBar and the
  combat scene still fits.
- **Sweet-spot targeting** — the Hero-Power aim (and any future single-target ability) now follows the
  cursor exactly: you can aim **anywhere on a minion's card**, no snap to its centre. The minion under
  the cursor lights up with a strong accent ring (`.card.targeted`). Verified the aim circle lands at
  the cursor (901,631) rather than the card centre (954,720), and the hovered card highlights.
- **Verified live**: cards measure 209×278, art panel ~60 % showing the full image, Omen ~100 px,
  recruit clearance ~31 px, combat fits, tier colours intact, sweet-spot aim + highlight confirmed.
  `typecheck` (+ web) + `lint` + `test` (67) + `build:web` all pass.

### Drag precision pass + tier colours + art-covers-text fix
- **Drag precision** (the headline ask — make dragging exact, clean, satisfying). Six fixes to the
  pointer-drag in `Recruit.tsx`:
  1. **Zero-lag tracking** — the floating card had a 50 ms `transition: transform` so it always
     trailed the cursor; now it tracks instantly (the transition is kept only for the snap-back).
  2. **Grab-point lock** — `scale(1.04)`/`rotate` pivoted around the card's corner, sliding the
     grabbed point ~4 px off the cursor; `transform-origin` is now set to the exact grab point so the
     card stays pinned under the pointer (rotate softened to 1.5°).
  3. **Reorder off-by-one fix** — `warbandIndexAt` counted the dragged board card itself (it stays in
     the DOM, dimmed), so a rightward/inward reorder overshot by one ("doesn't go where you think").
     It now excludes the dragged card; verified live that dragging the left minion of three into the
     middle lands it at index 1, not dumped at the end.
  4. **Pointer capture** — `setPointerCapture` on press so move/up keep firing through fast flicks or
     when the pointer leaves the window.
  5. **Live insertion marker** — a glowing accent bar shows the exact slot a played / reordered minion
     will drop into, sliding between cards as you move.
  6. **Drop-zone glow** — the hand lights up when a shop card will buy, the warband when a card will
     play / reorder (the tavern already had its gold sell glow).
- **Tier colours** — the tier badge was dark on every card; tiers 1–6 now ramp cool→warm
  (slate · green · blue · violet · orange · raspberry) via a `data-tier` attribute, so tier reads at
  a glance. Applies in the shop, warband, and combat.
- **Art covers text — fixed.** The illustration was rendering 186 px tall inside a 130 px art panel
  (the grid auto-sized the square PNG to its *width*-driven height) and `​.art` had no `overflow:
  hidden`, so it spilled 56 px down over the keyword chips + description. The image is now
  absolutely positioned to fill its panel exactly and the panel clips — text sits cleanly below.
  This was a CSS bug, **not** the asset size (512² is fine). Card size was left as-is on purpose:
  growing height would break the three-rows-clear-the-StatusBar fit tuned last batch.
- **Verified live** (drove a real run via synthetic pointer-drags): the art now fills its panel
  exactly (measured), tier badges show distinct colours, the insertion marker renders at the correct
  slot, 2- and 3-card reorders land precisely where aimed, no console errors. `typecheck` (+ web) +
  `lint` + `test` (67) + `build:web` all pass.

### Illustrated art pipeline + more combat feel
- **Art pipeline** — a per-card image override. A new `packages/ui/src/art.ts` enumerates
  `art/minions/*.png` at build time via `import.meta.glob` (keyed by filename = card id), and the
  Card renders an `<img class="artimg">` (object-fit cover, top-anchored) when a matching file
  exists, falling back to the generated pixel `Sprite` otherwise — purely additive, a no-op until
  art is added. `cardId` is now threaded through every CardView (shop, warband/inst, Discover, and
  the combat Arena unit), so an illustration shows in all three rows + combat. The first four
  illustrations are wired — `whelp` (Ember Whelp), `imp` (Voracious Imp), `drone` (Spare Part
  Drone), `drummer` (Doublecast Drummer) — copied from `C:\Game Assets\Ascent Art\Minions` and
  downsized from the 1254² ~2.3 MB originals to 512×512 (~650 KB) for the bundle. A README in the
  art dir documents the card-id ↔ name table, the format/size spec, and the one Vite caveat (restart
  `npm run dev` once if you drop the *first* files into the previously-empty folder, since the glob
  compiles to an empty map at startup).
- **More combat feel** — four additions on top of the existing lunge/shatter/poison/SC/summon juice:
  (1) **death dissolve** — a dying minion now flashes, crumples with a slight tumble + desaturate,
  and fades to nothing, instead of shrinking to 0.7 and popping out; (2) a white-hot **impact spark**
  at each struck minion (a `::before` flash on the existing `struck` class); (3) a **win/lose scene
  tint** when the replay settles — a soft green vignette on a win, raspberry on a loss
  (`.arena.done.win|lose .ascene::after`); (4) **snappier lunge easing** (0.16 s with a slight
  overshoot) so a strike reads as a committed blow.
- **Verified live** (drove a real run via synthetic pointer-drags; combat slowed temporarily to film,
  then SPEED restored to 1.5): Ember Whelp / Voracious Imp / Spare Part Drone render their
  illustrations in shop, warband, *and* combat, while art-less cards keep their pixel sprite; combat
  lunges + SC scorch + deaths play; both result tints show (green win, raspberry loss). `npm run
  typecheck` + `typecheck:web` + `lint` + `test` (67) + `build:web` all pass; the four PNGs emit as
  hashed bundle assets.
- **Notes:** balance tuning stays deferred (feel + functionality first). As art scales past a handful
  of cards, the ~650 KB PNGs will want WebP/compression — flagged in the roadmap.

### Feel/functionality pass — hand box, combat juice, spell frame, golden text
- **Hand box** (`fdee24c`): the empty-hand box now spans the bottom frame's width (~760px, ≈ the
  Embers·Hero·Resolve StatusBar) and no longer clips under the hero — trimmed the card-row height to
  264 (= card height), the column gap, zone headers, and the control-bar margin so the three rows +
  chrome fit above the fixed StatusBar (~50px clearance).
- **Combat juice** (`c3f4d9a`): a breaking Divine Shield bursts a golden shard ring; in-combat
  summoned minions pop in; a kill shakes the board (hit-stop feel). Verified the shake live.
- **Spell frame + golden text** (`3462758`): the Discover spell now has a distinct demon-purple
  arcane frame; golden text-doubling broadened to bold "deal **3**" and SC-AoE phrasing ("3 to
  every", "3 more") so a tripled card's printed numbers match its doubled effect.
- Verified live this pass: taunt shield ward (steel emblem on the enemy), dead minions removed (not
  greyed), End-Combat top-centre, persistent StatusBar + hero-ready glow, board shake on a kill.
- **Note:** balance tuning (the counter matrix) is explicitly deferred — feel + functionality first.
  Minion art (the Ember Whelp dragon) is also deferred; art specs + a per-card image-override path
  are noted in the roadmap.


### Triple/Drummer/Echo fixes + combat & recruit polish + SFX
- **Engine fixes** (`7c6945a`): tripling now combines the three copies' *current* stats — the sum of
  the two highest attacks and two highest healths — and unions all their keywords (so a buffed /
  Poison / Divine-Shield copy keeps it), instead of resetting to 2× base. Doublecast Drummer now
  makes Battlecries fire one extra time per Drummer. Echo Warden now works in combat (friendly
  summons fire one extra time per Echo); its text reads "In combat, …".
- **Recruit layout** (`2f57101`): a shaded, non-clickable "Tavern · Tier N" box was added to the
  control row; the warband dropped its fixed "Empty" slots (renders just the played minions with a
  hint when empty); the keyword legend strip was removed.
- **Combat polish** (`5dac9c8`): Taunt minions wear a steel shield ward; damage/buff floats are much
  larger and the struck minion's HP badge flares; combat lines hold a static height; a burning rope
  appears in the last 15 s of a turn above the warband. Plus a Start-of-Combat **projectile** bolt
  (`6e8e285`) that flies from the caster to each target it hits.
- **Targeting** (`fe502a6`): the Hero Power is now drag-to-target — press the Forgewarden, drag the
  aim line onto a friendly minion, release to Temper it (the whole card is the target); release off
  to cancel. A plain click still arms. The same flow is ready for a single-target Battlecry.
- **Shuffle** (`4374ef7`): the warband FLIP-slides cards into place when it reorders (play / summon /
  sell / reposition); magnetic merges don't reorder so they don't shuffle.
- **SFX** (`1f1fe87`): a synthesized Web Audio sound bank (no asset files) for recruit actions,
  combat beats, triples, and win/lose, with a mute toggle (persisted) in the HUD.


### Combat overhaul + flair, stat colours, persistent HUD, even layout
- **Combat read cleanup** (`cacae5e`): attacks now play as a clear wind-up (the attacker lunges in,
  no damage) then an impact beat (it and its target take damage together, dead removed), instead of
  everything resolving at once. The lunge is cached so it stays planted through the impact then
  retracts. Combat is ~25% slower (SPEED 1.2→1.5) and floats linger longer.
- **Combat VFX + stat colours** (`e03c048`): Divine Shield is a pulsing golden aura (flashes on when
  granted, gone when broken); poison drops a green mist; Start of Combat fires a golden cast pulse;
  an in-combat buff gives a green pulse; a Cleave attacker shows a white slash. Stats above their
  base render green, below base render red, on cards everywhere.
- **Engine / balance** (`4c29eb4`): embers uncapped within a turn (sell always pays); keyword grants
  target a friend that *lacks* the keyword; early waves 1–4 softened (bot climbs to ~wave 8–10).
- **Persistent HUD + combat end** (`eb25733`): the StatusBar (Embers · Forgewarden · Resolve) is now
  rooted at the bottom across recruit and combat (moved to the Game root, fixed). Removed the bottom
  result bar; "Climb On" is now "End Combat" at the top-centre. A Resolve loss shakes/flashes the
  chip and floats the −X. The Hero Power pulses when it's available and unused.
- **Layout + flair** (`49f0ad3`): rows are fixed-height so spacing is equal (tavern↔warband ==
  warband↔hand, 54px); a hovered card's tooltip rises above the shop buttons; dragging a Magnetic
  minion over a friendly Mech crackles with electricity; a recruit-phase buff flashes the card green.

### Combat-feel beats, engine/balance fixes, card-UX pass, repo conventions
- **Combat replay → beats** (`195f2ca`): the replay advances in beats — a primary action (attack /
  Start-of-Combat / summon / buff / reborn) and all the result events it caused (both minions'
  damage, shields, poison, deaths) resolve together. So an attacker and its target take damage at
  the same instant and their floats land together. Dead minions are removed from the board (no grey
  fade): a death from a prior beat is filtered out; the minion dying in the current beat shows for
  one beat then is gone; the result screen shows survivors only.
- **Engine / balance** (`4c29eb4`): embers are uncapped within a turn — selling was clamped to
  `maxEmbers` (== current embers right after the per-turn refill) so it paid nothing at turn start;
  now sell just adds. Keyword grants (Toxin/Plaguebringer) target the highest-attack friend that
  *lacks* the keyword, never wasting the grant. Enemy strength softened for turns 1–4 (ramp 0.30→1.0
  over waves 1–7, width tracks the wave); greedy bot climbs to ~wave 8–10.
- **Card UX** (`dedf1b5` + styles in `195f2ca`): the name now sits as a pill on the bottom of the
  art with the keyword/text area below it (more room for legible text). Removed the result toast bar
  above the Omen. The drag-ghost positions via GPU transform (clean 150ms snap-back instead of a
  juddery left/top animation) with a small follow-lag + tilt for felt weight.
- **Repo conventions**: README carries a Recent-changes + Short-term-roadmap summary; CLAUDE.md gains
  a rule to keep README/devlog/roadmap current each commit, and a rule to ask clarifying questions on
  ambiguous asks. (The private GitHub repo `kcodea/ascent` was created earlier in the day.)

### UI fixes: button layering, no text-select/right-click, cursor + timer behavior (`a2c7b19`)
- **Shop controls layering** — the Refresh/Freeze/Tier/End Turn bar now sits above the tavern cards
  (`position:relative; z-index:6` + 16px clearance, tavern row aligned `flex-start`). The tall 264px
  minion cards had been eclipsing the buttons.
- **No text selection / no right-click** — `user-select:none` on `body`; `contextmenu` preventDefault
  registered in `apps/web/src/main.tsx`.
- **Drag cursor fix** — the closed-fist cursor was stranding "on" after the first drag. `body.dragging`
  is now removed on pointer release in `onUp` (immediate revert), with an effect tied to `drag.active`
  as a safety net. Also restored the gauntlet hover cursor over cards/buttons: a later `cursor:pointer`
  in the base `.card`/`.btn`/`.hero` rules had been overriding the custom-cursor rule once cards
  stopped being native-`draggable`.
- **Timer behavior** — the 30s round timer no longer auto-starts combat at 0; it now locks every
  action **except End Turn** (which pulses). `timeUp` gates `beginDrag`, Refresh/Freeze/Tier, and the
  Hero Power click.
- Verified via DOM: z-index + 9px button/card clearance, `user-select:none`, contextmenu prevented,
  `body.dragging` lifecycle (added during drag, cleared on release), gauntlet cursor resolves.

### Card sizing, tier badge, End Turn, round timer, triple rework, golden doubling, combat slide
- **Fixed 1:1 card size everywhere** (`069072b`) — cards are a constant **190×264** in tavern,
  warband, hand, combat, Discover and the drag-ghost. Recruit cards had been stretching to row height
  (so they shrank when the control bar + bigger panels tightened the layout) while combat cards were
  fixed; this unifies them and also resolves the art-at-50% flex-basis ambiguity.
- **Tier badge** on every card (top-centre, overlapping the top edge); **End Turn** (renamed from
  "Face the Omen") moved next to Tier in the tavern control bar at 2× size.
- **30s round timer** top-centre (`8bb900d`); ring depletes, turns red under 5s.
- **Two-step triple Discover + golden doubling** (`f6b8f8f`) — a triple drops a golden 2× minion into
  hand with *no* immediate Discover. Playing the golden grants a "Glimpse Beyond" Discover spell;
  playing that spell opens the Discover (3 minions from one tier up). Golden minions fire effects at
  doubled magnitude (combat + recruit factories ×2 when golden; card text doubles "+N/+N" and
  "deal N"). New `discoverspell` token; combat `Minion` gained a `golden` flag.
- **Combat slide-to-target** (`d56367b`) — the attacking card physically slides ~62% into its target
  (inline transform from the two units' live positions); damage floats at the clash.
- 62/62 tests; typecheck/lint/build clean throughout.

### Big UX pass (commit-per-feature)
- 1:1 combat cards using the real `Card` component (`dc86952`).
- Hero-Power **targeting line** with a snapping target orb (`b68a02b`).
- **Pointer-drag overhaul** — solid card follows the cursor, snap-back on invalid drop, gold "Sell +1"
  glow over the tavern (`abeb2eb`).
- Custom gauntlet/hand **cursors** (`29b23e0`).
- Hero-sized Ember/Resolve panels + a fanned, hover-pop **hand** (`6e82264`).
- 2× tavern controls above the shop + **center-anchored** warband (`1505981`).
- Terse mechanical card text + **keyword tooltips** + card width +15% (`71a31c5`).

### Content + balance
- **5 tribes per run** + active-tribe HUD (`667677b`).
- **Triples & Discover** v1 (`38bfdcd`) — later reworked to the two-step flow above.
- **Early-game balance on-ramp** (`d9fe8bb`) — enemy width capped near the wave number, stats ramp
  55%→100% over waves 1–5, and a gentler loss-damage formula, so waves 1–3 are winnable. Greedy bot
  now climbs to ~wave 7–9 (was 3–4).
- **Headless balance runner** (`216bc26`, `npm run balance`) — mono-tribe boards vs every threat,
  prints a tribe×threat win-rate matrix + counter-matrix adherence. Flags Mech dominant, Beast weak,
  Dragon/Undead flat, Demon holds.
- **Demon tribe** (`1f03feb`) — recruit-time Consume system (`onConsume` event + reactions).
- **Mech tribe** (`ba4e583`) — Divine-Shield walls + shield-break payoff chain + Magnetic merge.
- UI note batch (`cb1d95e`) — 50% card art, tribe-typed footer, big centred hero, buy/sell/summon FX.

## Earlier — M0 / M1
- **M0** — deterministic engine: seeded mulberry32 RNG, event bus, pure `simulate()` → event log;
  Beasts + neutral glue; headless determinism harness (`npm run harness`).
- **M1** — run-loop reducer + economy + 5 threats + deterministic wave/enemy generation + scoring +
  save/load; recruit-phase effect system (Battlecries / buff-on-buy / summon buffs); Dragons tribe;
  Battlegrounds hand (buy→hand→play→board); live recruit screen (`@game/ui` + `apps/web`); combat
  arena replaying the event log; full playable loop (recruit → combat → next wave / game over).
