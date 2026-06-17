# ASCENT — development log

Newest first. Each entry records **what changed and why**, plus how it was verified. The forward
queue lives in [roadmap.md](roadmap.md); high-level milestones in [../CLAUDE.md](../CLAUDE.md).

## 2026-06-17

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
