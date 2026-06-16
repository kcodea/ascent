# ASCENT — development log

Newest first. Each entry records **what changed and why**, plus how it was verified. The forward
queue lives in [roadmap.md](roadmap.md); high-level milestones in [../CLAUDE.md](../CLAUDE.md).

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
