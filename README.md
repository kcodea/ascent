# ASCENT

A single-player roguelike auto-battler. Build a board in a Battlegrounds-style shop, then fight a
**17-round course** of enemy boards. The goal is to **cover the rating-driven Line**; clearing the whole
course is a bonus achievement on top.

> **Rules & systems:** [`docs/GAME-RULES.md`](docs/GAME-RULES.md). **Content counts:**
> [`docs/CONTENT.md`](docs/CONTENT.md). **Architecture & conventions:** [`CLAUDE.md`](CLAUDE.md).
> **Full history:** [`docs/devlog.md`](docs/devlog.md). **Forward queue:** [`docs/roadmap.md`](docs/roadmap.md).

## Quick start

```bash
npm install
npm run dev          # play it (Vite dev server)
npm test             # vitest: determinism, effects, run loop, content
npm run balance      # headless: probe the tribe counter matrix with mono-tribe boards
npm run bot          # headless: a greedy bot plays full runs
npm run harness      # headless: narrated combat event log + determinism proof
npm run typecheck && npm run lint   # typecheck = engine (typecheck:pkgs) + UI (typecheck:web); both gated in CI
npm run build:web    # production build (the CI gate + what players run)
npm run package:itch # build + zip ascent-itch.zip for itch.io (HTML, "play in browser")
npm run desktop      # build + run the game in an Electron window (fast desktop iteration)
npm run package:desktop # build + produce apps/desktop/release/ASCENT-win32-x64/ASCENT.exe
npm run desktop:icon # regenerate apps/desktop/icon.ico from icon.png (only when the logo changes)
npm run package:itch:win # build + zip ascent-itch-win64.zip for itch.io (Windows download)
```

New contributor? See **[ONBOARDING.md](ONBOARDING.md)** (clone → install → verify → the collaboration rules).

## The game in one screen

- **17 rounds:** 2 calibration (economy runs, don't count) + 15 scored. Alternate a **shop phase** (recruit
  minions, play them onto a 7-wide board, sell, upgrade the tavern, cast spells) with an **auto-resolved
  combat** against a served enemy board.
- **The Line** is your rating-driven target; covering it is the run's success contract. Surviving all 17 is a
  separate achievement.
- **6 tribes** (Beasts, Dragons, Undead, Mechs, Demons, + neutral glue) with triples → Gilded, Discover,
  quests (waves 5 & 11), and runes (Basic + Epic Runeforge). See [`docs/GAME-RULES.md`](docs/GAME-RULES.md).
- **Deterministic engine:** combat is a pure function returning an event log the UI replays; one seeded RNG
  threads everything (replays, shareable seeds, cheap balance sims).

## Recent changes

_The latest highlights only. Full history, newest first, lives in [`docs/devlog.md`](docs/devlog.md)._

- **Play-mode screen repositioned** — the Play / Learn / Practice mode cards and the MODE title sit at the owner's tuned positions (cards re-seated vertically, title larger and lifted).

- **Keyword definitions beside a card** — hovering or inspecting a card now shows a box for each keyword it uses (Ward, Echo, Slaughter, Choose One…), word on top and a one-line definition below.

- **Minion medallion icons no longer fall back to the tribe symbol.** The glyph on a minion's card now comes
  from a shared registry that reads the card's real mechanics (was: a brittle text check that showed a generic
  tribe icon on 64% of minions). New eye glyph for reactive **Watcher** effects, and Stealth/Engraved/Choose
  One get their own icons; the Compendium glossary reads the same registry so the two can't drift apart.

- **FX workbench: "Field variation" knob** — a new Physics slider (burst / emitter / smoke) that gives each cast its own seeded turbulence-field phase, so many copies of an effect firing at once no longer swirl in lockstep. Defaults to 0 (a no-op that leaves every saved effect unchanged).

- **Choose One / offer polish** — Choose One options now wear the carved card plate; the outdated squared glow behind offer cards (Choose One / Discover / Scouted) is gone; hovering an option ticks once, not twice; committing any offer pick (Discover / rune / Choose One) plays a new "discover select" cue; and playing or being granted **Ward** in the shop now plays the combat shield sound.

- **Set 2 launch banner removed** — the "Welcome to Set 2's Launch!" card is gone from the title screen.
- **Fixed: two stat spells did nothing when cast in combat** — **Beefy** and **Lantern Light** had no case in the combat spell resolver, so any mid-fight re-fire (Sporebat, Steward, Recaller, Ryme) fizzled silently. Audited all eleven stat-granting spells; the rest already fold spell power correctly on every path.

- **Replay system (v2, state replay).** Watch any player's full game back — exact by construction (playback renders recorded frames, never re-simulates). Round rail on the left (click a round, jump to its shop opening), a slide-out drawer with per-round Gold spent / Actions / Shop tier, play/pause/speed/scrub, ▶ Watch buttons on the leaderboard + Recent Games, and Rewatch Last Game on the end screen.
- **Rune of Refreshments** — every Demon you play buys another look at the Shop.
- **Arnold** (T6 Dwarf who Beefies himself every turn), **Rune of the Embers** (each refresh doubles the right-most Shop minion's Health), and Gemline Martyr back to an End-of-Turn Veinstorm.
- **Rune art wired (24 pieces)** plus the Baller's live "next payout" pill, reworks to the Wild Hunt, the Burrow and the Tip Jar, and a new **Summoning Bulwark** spell.
- **Big rune batch — 6 reworks + 27 new runes.** Basic and Epic faucets for every tribe, plus Refraction, Ruby Resonance, Hoardflame, Glider, Drake Skull, Catacomb, Pendant, Ornate Clock, Herding Horn, Bubble Crown, War Drum, Baller, Wishbone (your Hero Power triggers twice — now doubling all 20 heroes on the roster, including Flash's mark paying out 2 copies), Deathtouched Apple, Held Strength, Chipper Sticker, Rising Echoes and Might. Reworks: Blart, Kindling, Infernal Ink, Merchant's Chorus, Reliquary. Also adds the **Might of Aeon** Shop Spell.

- **End Turn gem glow matches the Freeze gem** — the End Turn diamond's hover glow now sits behind the gem and above the bronze base (a drop-shadow on the gem itself), copied from the Freeze gem, instead of floating over the housing on a separate layer.

- **The locked third rune slot wears chains** — most runs only get 2 runes (forge turns 6 & 9), so the third slot shows chains from the start as "not possible yet." When a hero/rune unlocks a 3rd (Runesmith, Guardian, Rune of the Epic Forge, Rune of Duplication), the chains **shatter** 1000ms later with a burst-and-shockwave FX. Position/size tunable in the 💠 Rune Sheen tuner.

- **Set 2 Dragon batch.** Eight new Dragons (a Shout-retrigger line — Embercrest, Broodfire, Roarcollector — and a spell-cast line — Flamebeat, Warflame — plus Cinderchef, River Drake, Flutterdrake) and two new spells (**Dragonflame**, **Flutter**), alongside eight archives and a round of rebalances (Karwind, Fel Spikes, Earthbreaker, Transcendant→Ward+Engrave, and more). Fixed a bug so **Fel Spikes**' echo correctly counts as its Demon dealing damage (proccing the demon-damage payoffs on every landed hit).
- **Shop-buff-on-attack fires in the lunge** — a minion that buffs the Shop when it attacks (Demon Horse) now pops its `+X/+Y` number during the attack lunge, with the trigger pulse, instead of as a detached beat after the swing.

- **The consuming minion swells + recoils** — the eater now grows as it draws the ghost in, then snaps back to true size with a little recoil bounce. Tunable (grow amount / length / recoil) in the 🍖 Consume tuner.

- **Consume "gulp" sound** — consuming a shop minion now plays a sound. Several consumes on one beat play a single gulp, not a stack.
- **Fixed the misplaced dark panel in the Compendium** — each card's dark description panel was floating ~184px above the card (its absolute anchor broke under the grid's in-flow text drawer). The drawer is now a proper positioning context, so the panel seats back onto the card as it does in the hand. Scoped to the Compendium; the live game is untouched. (Also reverts the earlier wrong attempt that hid the grounding shadow.)

- **Shop consume FX + slot hold** — eating a shop minion no longer plays the old ghost-Fred swirl. The eaten minion's ghost now launches from its **own shop slot**, **shakes**, **taffy-stretches** toward the eater, and is **pulled in** as it collapses, synced to a Pixi `consume-pull` source→target def (smoke at the eater + three point-gravity burst rings sucked into it). One GSAP timeline conducts it (the config `durationMs` is the clock), with a `🍖 Consume FX` dev tuner (shake / stretch / pull / duration + a show-stats toggle). And the surviving shop offers now **hold their positions until the ghost is gone**, then slide to close the gap — not the instant the consume commits. It covers **every** shop eater for free — Bob Blart, Cinder Clerk, Godfodder, the Consume spell, the tavern auto-eat — because `playFodderEat` is the single choke point. (Combat consumption is out of scope; the real energy-bands look is an owner workshop follow-up.)

- **Combat replay auto-ramps its speed** — long fights no longer drag: each combat holds at your Speed-slider setting for the opening, eases up to a ceiling through the middle, then eases back down so the finishing blows still read at normal speed. On by default, with a toggle under the Speed slider (and a dev Speed Ramp tuner). Presentation only — the engine and replays are unchanged.

- **Ultrawide side margins blend into the board** — on a monitor wider than 16:9 the board's side margins fade to `#312361` (blending into the art edge) instead of showing the flat tan backdrop. A 🌫️ Board Edge dev tuner picks the colour and blend width live. Self-gating: no effect at 16:9 or narrower.

- **Learn Ascent — the full 12-round tutorial.** A coached first game from the ground up: shop → build → position → win, then Echo / Freeze / Shout / Start-of-Combat / position-and-board-space synergy, then the two build-defining systems (**gilding/triples** + the **Triple Reward Discover**, and **spells**), then three rounds of supervised independence, ending on a **GRADUATED** hand-off into the real game. Tutorial-only levers keep real runs untouched. (A dedicated Runeforge round is deferred pending rune-design sign-off.)
- **The shop-wide buff aura** — when a spell or unit buffs the stats of *every* shop minion (Staff of Guel, Contract Butcher, Soul Defiler), a new full-screen aura sweeps the tavern. Ruby/gem effects keep their own separate gem volley.

- **Runes burst when they trigger, and spells have a real cast effect** — a rune's own flourish now fires on its badge whenever its effect goes off, in the shop as well as in combat, and every tavern spell without a bespoke effect gets `spell-sparks` at the cursor.

- **Ring FX can be nudged off their anchor** — the workbench's ring (shockwave) layers get **Offset X / Offset Y** sliders, matching the pair burst effects already had. Placement only: it moves where a ring sits without touching its size, shape or expansion.

- **The board keeps its furniture during combat** — the Freeze gem, Reroll crystal and Gold pill no longer vanish when the fight starts. They stay up as passive readouts (inert, but at full strength) alongside the Tavern Up stone, which already worked this way.

- **Ale bubbles + committed FX art now ships** — a new bubble burst plays whenever a Dwarf generates a Dwarven Ale (Brunni, Tapkeeper, Doubletap Brewer, Blade Thrower), in both the shop and combat. Under the hood, committed FX art (`fx/defs/art/*.png`) now reaches players instead of falling back to a procedural shape — which also fixes the coin FX's missing coin art in the shipped game.

- **The board keeps its furniture during combat** — the Freeze gem, Reroll crystal and Gold pill no longer vanish when the fight starts. They stay up as passive readouts (inert, but at full strength) alongside the Tavern Up stone, which already worked this way. The Reroll crystal drops its cost coin there, since there is no roll to price.

- **New default arena board** — the full-board art ships as the board, and the whole UI re-seats around it: the global layout (card size, board zoom, shop row, warband, hand, quest nodes, gold pill, charge glyph, drag zones) plus every piece of board furniture (hero panel, End Turn and hero-power diamonds, Tavern Up, Freeze, Reroll, the lobby rail). The two previous 21:9 boards stay selectable in the Esc menu. The new art is 16:9, so on an ultrawide monitor the side margins show the flat backdrop rather than floor art.

- **Resolve is now Health** — the hero's life total is called **Health** everywhere it's shown, and **Oath is off the Career profile card** (the course modes it belonged to are no longer reachable). Display only; saves and replays are unaffected.

- **The mode picker gets art, and Lobby is now "Play"** — illustrated tiles for Play and Practice (the frames were a flat gradient before), pared back to just the name and a one-line blurb. Display only: the mode is still `lobby` everywhere under the hood.

- **End Turn hover tip is tunable** — the label pill by the diamond gets eight dials (width, offset, drop, text size, line spacing, padding, radius) in the End Turn tuner, and wraps to balanced lines when narrowed. Shipped seated to the right of the gem.

- **Keshi the Protector** — new hero. Keshi's Crown banks the tavern tier of every card you buy and hands you a Triple Reward every 25.

- **Croupier Cia deals four suits** — her reward now cycles at random (never twice running) between **Hearts** (Discover at your tier), **Spades** (2 Shop spells), **Diamonds** (a minion from the tier above) and **Clubs** (3 Gold), with her power button showing the suit that's queued up. Enchanted cards are now red-and-gold. **Underdweller**'s Soulkeeper costs 2.

- **Yirin reworked + the Reflector** — Yirin now starts the run holding a **Reflector** (T1 1/1: spells cast on it also cast on a random friendly, once per turn) at 8 armor. **Croupier Cia**'s prize is now a Discover of a minion or spell at your tier, and the Enchanted card treatment is far more vivid. Fixed **Sable**'s Soulbind, which silently did nothing.

- **Five more heroes** — **Bram** (bank a Gold a turn; the 5th pays a Gilded minion), **Croupier Cia** (Shops seat Enchanted cards; buy 3 for a prize), **Odelle** (play a minion between two others of three different types: all three grow), **Harlan** (buy the entire Shop, then reroll it) and **Sable, the Linksmith** (bind your outermost minions — stats gained by one are gained by the other, combat included). **Rascal** reworked: All In now pays 1 Gold +2 a turn, twice a game, at 6 armor.

- **Three new heroes** — **Emerald Warden** (*Vanguard*: every tavern-up also hands you a random minion of the new tier), **Underdweller** (*Soulkeeper*, 3 Gold: Discover a minion that died last combat, from **either** side), and **Albus** (*Empowerment*, 1 Gold: pick a Shop minion and Discover what it turns into from the tier above). The **Gambler**'s rolled number now stays on the panel for the rest of the turn instead of vanishing a second after it lands.
- **FX workshop: custom SVG emit shapes** — an emitter can now spawn its particles along (or, with SVG fill, across) an uploaded SVG silhouette instead of the four built-in emit shapes. Upload an SVG in the Inspector, toggle outline vs fill, dial density; the shape is baked once into a normalized point cloud that persists in the def (no runtime SVG decode, fully prod-portable). The source SVG lives only in the browser for re-baking during authoring.
- **Rune node sheen + owner quest-node layout** — the owned-rune badges wear a glossy three-disc overlay (own dev tuner with per-disc position/size/opacity and a blend-mode select, shipped at hard-light). It's engineered to `mix-blend-mode` against the badges while staying immune to the layout scale sliders — the sheen size never changes when you tune the Quest-nodes or UI scale, and it stays glued to the nodes. The owner's tuned quest-node layout (scale, separation, per-node offsets) is baked in, and the hard border ring on rune badges is removed.

- **Hero panel + Buffs Panel rework, gem glows, new Tavern Up art** — the hero portrait is now a circle; the player name rides the bottom pill and the hero name is gone from the face; hovering the portrait darkens it with *"Click hero portrait to open / close the Buffs Panel."* The run-buffs pop-out grows up out of the portrait, with white text, an underlined title, and a subtle brown-gold leader line per row; its dev tuner was trimmed to the knobs that still do something (and its Row-text slider actually resizes now). Freeze / End Turn gems gain a hover glow + brightness. The Tavern Up stone wears new base + orb art with native-aspect tier pips (per-tier alignment dials), a gem-silhouette glow behind the gem, dim-at-max, and no more stray old-orb press flash. Right-click inspect no longer mislays the step counter.

- **Balance: Drunken Oaf, Kringle, Vaultkeeper** — Drunken Oaf now gives **+3/+3** per Ale (was +2/+2) and Kringle **+1/+2** per card played (was +1/+1). **Vaultkeeper** counts *spells* rather than *Shop Spells*, so your **Rubies advance it too**.

- **Every new hero now has art** — portraits and power art wired for Merrin, Gambler, Xerox, Frantic Frank, Pete, Emissary Vale, Quillen and Hunch (plus Tiff's return). Hunch previews the spell you'd get on hover, the Gambler's die rolls big and centred on the power, and Pete's smuggled tier-above minion flashes as the Shop lands.

- **Hunch joins the roster + hero polish** — **Hunch** (Rounded Spellbook: a copy of your last-cast spell, 3 Gold falling 1 per turn) is new. **Xerox** now summons the copy onto the board, **Pete** upgrades the right-most Shop minion instead of adding an eighth, **Quillen** can archive a friendly *or* Shop minion, **Frank/Flint**'s 2-Gold prices now show on the cost pill, and **Gambler**'s die visibly tumbles before settling, with a turn countdown until it unlocks.

- **Heroes batch — Tiff returns + 8 new heroes** — Tiff is back in the pool, joined by **Merrin** (get a random spell), **Gambler** (roll for Gold, then lock the power), **Xerox** (copy a minion, once/game), **Frantic Frank** (refresh; minions cost 2 this turn), **Pete** (every 3rd refresh smuggles in a tier-above minion), **Foreman Flint** (Dwarves cost 2), **Emissary Vale** (Start of Combat: +Tier/+Tier to one of each tribe; a Fatecarver at T6), and **Quillen** (archive Shop minions, then Discover from their types).

- **Funeral on Loan borrowed Echoes actually fire** — several Deathrattle minions (Menagerie Mammoth, Bullseye, Kobebes, Right Hand Hank, Wolvie) had no shop-side Echo body, so discovering them via Funeral on Loan (or Ossuary Rite / Gravetwin / Reliquary / Deathsayer) silently did nothing. Their Echoes now resolve in the shop — summon, Ruby, shop-slot buff, and next-summon buff all included.

- **Rune of the Trophy's copy flies to hand during the fight** — the plain copy of the first enemy you slaughter now animates into your hand on the kill beat, instead of appearing only when the combat resolves. (An audit found this was the last combat card grant that snapped in at settle rather than in real time.)

- **End-of-Turn summons & keyword grants show on their beat** — a minion summoned by an End-of-Turn trigger (Moira re-firing a summoner) now appears on the board *during* the End-of-Turn playback, and a keyword granted mid-turn shows its pip on the beat, instead of both snapping in when the turn commits.

- **End-of-Turn Discover grants arrive in real time** — a card discovered by an End-of-Turn trigger (Black Belt Brian re-fired by Moira) now materialises into your hand *during* the End-of-Turn playback, like a shop conjure, instead of snapping in at the combat hand-off.

- **Paragon fires per Rally, doublers included** — Paragon (buff one minion of every tribe on any friendly Rally) now triggers the extra times when your Rallies are doubled (Law of Teeth, Rallying Offensive, Uron, …), instead of only once.

- **Beat Lab (dev): the LIVE toggle now drives combat too** — flipping a combat trigger (e.g. Oona's on-summon reaction) to `ownBeat` and turning on **LIVE** re-paces real fights immediately, no console flag. One switch for End of Turn *and* combat; off is byte-identical to today; shop actions stay instant by design.

- **End of Turn now shows ruby buffs and shop consumes on their beat** — a "your Rubies gain +X" proc (Deepvein Tender, re-fired by Moira) used to animate nothing; it now plays a ruby flourish on its beat. And **Bob Blart**'s Consume now makes the eaten Shop minion visibly leave the row as he procs — with the consume crumble — instead of snapping out only when the turn commits.

- **Board buttons re-art + hero-power circle + FX** — Freeze / End Turn now layer a base + a separate gem (with a cracked gem on press); the Hero Power is a clean circle (frame removed) with a reconnected glow; a new "Freeze" label pill; authored FX bound to Freeze/hero-power press, hero-power target, and selling (at the gold pill); the "click on board" puff fixed; the turn timer is now just clock + digits. Plus in-run UI editor fixes (scale-correct drag, undo, deselect, exit, single-element selector, current-image panel).
- **Restored the owner's shop/warband layout** — a later bake (#1035) had overwritten the shop-area positions with different values; the owner's intended shop row, shop-controls tray, and warband positions/scale are restored, while keeping #1035's hand/inspect/sell tuning.

- **Rubies inherit spell buffs with Rune of the Spellstone** — the rune said Rubies "count as Shop spells" but only made them tick the spell-cast watchers; they now pick up your spell power too, and everything downstream follows (combat Rubies, Veinstorm, Motherlode, Mountainbond). **Mountainbond** reworked to a Gold meter: every 8 Gold, 2 Rubies plus one played on each Kobold. Fixed: hovering a card in hand made the hero portrait and hero power vanish behind the board art.

- **Balance batch + 3 new minions** — five Set-2 Demons retuned, with **Bob Blart** (now T4 6/5) and **Hellrider** trading jobs: Blart *Consumes* the right-most Shop minion, Hellrider *copies* its stats and leaves it buyable. Right Hand Hank (+3/+2), Market Tormentor (+7/+6) and Chipper (T5 8/7) rebalanced. New: **Grobbus** (Avenge 3: get a random Demon), **Transcendant** (adjacent Dragons are Engraved while it lives; SoC buffs the flight), **Drunken Oaf** (a Dwarf buff repeated per Ale cast). Fixed: Rubies granted by **Candlelight Toll** arrived as flat 1/1s instead of the run's real Ruby strength.

- **In-run UI editor (dev-only)** — a direct-manipulation editor for the in-run DOM UI (cards, HUD, shop, panels, text) with live override stylesheet, move/resize, restyle knobs, image swap, and a copyable summary for chat-driven fixes.
- **New Demon art + an illustrated Runeforge** — every Set-2 Demon (plus the Imp token and Imp Overseer) wears new illustrated art, and the Runeforge menus now open on a painted forge backdrop instead of a flat slate scrim. A new 🪨 Runeforge Backdrop dev tuner places that art (fit, zoom, position, scrim) against the real panel.

- **Spells cast with less drag** — a spell dragged from the hand now arms on its own, lower line (near the hand) instead of the minion play line up by the warband, so targeted and untargeted spells both activate sooner. Tunable via a new Drag-Feel → Spell cast slider; minion play is unchanged.
- **Owner-tuned layout defaults** — the shop row, shop-controls tray, and warband are baked to the owner's tuned positions/scale (updated in both the Layout Lab defaults and the production CSS fallbacks).
- **Owner-tuned layout defaults** — the shop row, shop-controls tray, warband, and hand row are baked to the owner's tuned positions/scale (updated in both the Layout Lab defaults and the production CSS fallbacks).

- **Beast batch** — four new Beasts (**Wolvie**, **Armadiyo**, **Dunkey**, **Voidmother**) and four new runes (the Burrow, the Voidmother, the Jungle, Beastial Swarm), plus Kennelmaster (Avenge 4) and King Oona (doubles Attack only) tweaks. **Grim** joins Set 2 with a new flat "+8/+8 to your Beasts" Echo.

- **Content batch** — four Set-2 minion reworks (Market Tormentor now +7/+7; Menagerie Mammoth summons 3 random other Beasts on death; Feastmaster Vhal buffs a Shop minion every 10 Gold spent; Endless Overseer summons Taunt+Ward Imps on Avenge), three new minions (**Right Hand Hank**, **Bullseye**, **Beardsley**), and nine cards archived out of the pools (5 minions + 4 runes).

- **Card drag tilt reworked** — a dragged card now dives toward the board in the direction it's travelling (leading edge pinches), uniformly on every axis and settling flat when you stop. Rebuilt on a smoothed-travel signal with one uniform dive gain, and split the floating card into position + tilt layers so the 3D pitch is clean instead of sliding. Drag-feel tuner now exposes `Dive gain` / `Dive smoothing`.
- **Recent Games are clickable** — a game in the Recent Games feed now opens that player's Career, auto-expanded and scrolled to the run you clicked, so its board, runes, quests and standout stats are one tap away. Matched to the run by nearest end-time (the feed and the career are separate records).

- **20 new runes + 2 new minions** — Herzog (a Dragon whose per-play buff scales retroactively with your Shop-Spell count) and Kobebes (Echo: 3 Rubies on each Kobold); six "grant a minion + upgrade it" runes (Display Case, Wrangler, Living Geode, Dawnclaw, Blart, Sylus) and a dozen new shop/economy runes (Window Shopping, Bargain Bin, Restocking, Trade-In, Collector, Shopkeep, Seller's Market, Open Enrollment, Strange Caravan, Fresh Pages, Lassoing, Old Pack), all with art.

- **Live "Summon a X/Y Imp" text + two end-of-turn fixes** — any card/rune that summons an Imp now prints the Imp's current stats (base 1/1 + your Imp Aura) as a live green "(X/Y)", everywhere; End-of-Turn Discovers (Moira → Black Belt Brian) auto-grant instead of popping the picker at the combat hand-off; and an End-of-Turn shop buff (Moira beside Market Tormentor) now animates on the beat instead of landing silently.

- **Balance batch + two combat-timing fixes** — a wide owner pass: ~12 minion reworks (Spell Warden/Bob Blart retiers, Errand Fiend loses Flurry, Dawnclaw's Echo hits one adjacent/both-when-gilded, Candle Conduit reacts to gaining Rubies, Avarice/Malphas Demon-consume reworks, Rope Wrangler grows itself, and more), ~40 rune cost/effect changes, and two engine bugs squashed — "summon when you have space" now fires at Start of Combat (not a beat late), and a Rally that summons onto a **full** board is rejected immediately instead of sneaking in after the attacker dies.

- **Lobby HUD cleanup + Recent Games** — the redundant top-left round plaque is hidden in a lobby (the rail now carries the round, seats-left, and the max-loss chip, with a bolder header); the Esc menu drops the unused clear-boards/reset-career actions and gains the combat-pacing slider (moved out of the combat overlay, where Skip now sits above End Turn); and a new **Recent Games** page (title screen, under Hall of Champions) shows the last 20 finished games across all players — player, hero, and outcome.

- **Dwarven Ales get shop-cast FX** — each of the five Ales now plays its own authored effect when cast, fired
  from the point you release the card. The three buff Ales shoot a trail from the cursor to each buffed minion
  at once (with the generic buff-pop suppressed for them), and if **Edward Keg-hands** is on your board the
  volley echoes a beat later from his card (twice when he's gilded). Built on a new `spellCast` recruit-moment
  kind, so any shop spell's cast look is now bindable from the workbench.

- **Refresh button restyled + relocated** — the Refresh button now uses a new wide orange "Refresh" pill and sits at the **top-right** of the board (moved from top-centre). Same reducer wiring; the 🔄 dev tuner still fine-tunes its position.

- **Test board option** — Settings now has a **Board** picker to swap the arena backdrop between the shipped board and a new "test board" on trial. Display-only + persisted; the hero-select screen previews the pick too.

- **Sandbox board editor** — click any minion on your board (or the pinned next opponent, via a new
  Shop ⇄ Next-enemy toggle) to edit its base stats, keywords, or swap the card outright, then "run it again"
  to replay the fight. Replaces the FX workbench's synthetic 3v3 stage, which shipped and was deleted 11 days
  later: it was scenery that nothing could fight. The authored board is now the FOUGHT board, read verbatim
  through the same `servedBoards` channel a real run uses.
- **Card-drag feel, retuned** — the owner's latest Drag-tuner values are now the shipped defaults (near-instant catch-up, a stronger tilt, a flatter resting angle, an instant recentre). New with it: a **hand grab point** — a card lifted from the hand now hangs from below mid-art (near its stat badges) instead of from its centre, with a "Hand grab point" slider to place it exactly. Shop and board drags still ride centred.
- **A card's buff can carry its own authored effect** — Karwind now blooms a fire ring (`flame-ring`) on every Dragon it pumps, in the shop and in combat. Getting there added source-attributed buff effects: a new `buffed` fan-out for combat and per-source shop buff moments, so an effect can be keyed to the *buffer* rather than to each buffed card.

- **Card-drag feel, retuned** — the owner's latest Drag-tuner values are now the shipped defaults (near-instant catch-up, a stronger tilt, a flatter resting angle, an instant recentre). New with it: a **hand grab point** — a card lifted from the hand now hangs from its bottom edge instead of from its centre, with a "Hand grab point" slider to place it exactly. Shop and board drags still ride centred.
- **Any effect can play as a gather** — a per-layer Reverse toggle turns a detonation into a gather, a plume into an inhale, a shockwave into an implosion. Particles start where they would have finished and fly inward, so every authored effect is now two.

- **Rings expand on an authored curve** — shockwave's Ease dial could only ever decelerate or only accelerate. Expansion / life draws the whole shape, so a ring can hang and then snap inward. Every existing effect is untouched: the un-drawn default is the identity ramp and takes the original code path.

- **Particles can be given a speed curve** — a Speed / life dial on burst, emitter and smoke, alongside the size, alpha and bias curves already there. Shards can hang and then bolt, smoke can rise and settle, a spray can stall in mid-air and pick up again. Drag could only ever slow things down along one exponential shape; this authors the whole envelope.

- **Shop-phase effects can be authored now** — the effects system only ever reached combat, so every shop visual was hand-written code with its effect baked in. Shop moments can now be bound in the workbench like combat ones. That matters because the most common mechanic in Set 2 — Shout, on 31 cards — happens in the shop, along with roughly 60% of the set's triggers.

- **Effects can be reshaped and repositioned in the workbench** — independent Squash X / Squash Y dials (unequal values reshape, equal ones resize) plus Offset X / Offset Y to nudge an effect off its anchor. Squash scales the spray as well as the spawn area, so a shape holds at any speed rather than washing out on a fast burst.

- **Accounts C2 + C3** — a magic-link sign-in turns the anonymous device session into a permanent, portable account (same boards/runs/rating, no password); players carry a `Kevin#4821` handle; offline runs queue and upload on reconnect (tagged unrated); and **rating is now server-authoritative** — a Supabase Edge Function is the only writer of `profiles.rating`, deriving it from the run's placement so a client can't inflate it.

- **The FX workbench has its own board** — three units a side instead of whatever screen the game was left on, so watchers, rallies, area buffs and cross-side hits finally have something to play across. Plus a language pass over all 173 effect parameters: truncated labels spelled out, and every help string that only restated its own label rewritten.
- **The itch package fits again** — 166 unused PNG art masters were shipping alongside their WebP builds (1094 files / 159 MB, over itch's 1000-file cap). Now 929 files / 58 MB, with a test and a packaging guard so it can't recur.

- **Glass hover tooltips** for quests/runes, a **UI Theme tuner** with 10 stock colour schemes driving them, and a **Title Text dev tuner** that rewords the whole front page live — plus a new `text` control kind for the tuner framework.

- **`npm run report:export`** dumps the balance report in full (JSON + per-table CSV) — and exporting it exposed that the report never counted the tavern's spell slot, so its spells table went from 1 row to 74.

- **Rope Wrangler keeps the card it summons**, and the Career panel now reports lobby stats (1st Place / Top 4 / Avg. Placement) instead of course stats that are structurally 0 in a lobby.
- **Rise no longer eats a Deathrattle's killer, and a triple no longer makes a temporary keyword permanent** — Jensen & Fi destroys its killer on a rise-death, and tripling a one-combat Rise/Ward no longer grants it forever.
- **Rune of the Guiding Candle works at last** — its tier-6 lock was filtered through the tavern-tier ceiling, so below tier 6 it served an ordinary shop; plus the Undertow is capped at 4 Wards and Chimerus grants its max Health rather than its chipped current Health.

- **The defeat counter now shows the damage that actually lands** — it was recomputed from different inputs than the hit; plus Gemgorge Fiend gains a per-instance cast counter, and Scavvers (with Rune of the Second Life) is archived.

- **Rise now resets a body properly** — granted rallies and Avenge progress no longer ride through a Rise; plus combat-cast Discover spells grant a random pick instead of opening the UI, Reinforcing Ale works mid-fight, and Veinstorm's hover preview reads its live Ruby value.

- **Card-keyed runes complete** — all 12 shipped (6 more: Moonhowl, Flooded Vault, Shared Reflection, Unbroken Vein, Battle Refraction, Living Growth), plus Matriarch's retexture, per-instance Moonhowl Mentors, and Indy's Gild recharge at 75 Gold.

- **Four owner fixes** — the Recaller/Second Draft pickup loop is closed, Mend now sets Armor to 5, Voicekeeper counts from its own placement, and gilding a minion in place no longer retroactively doubles its accrued buff (a +100/+100 Sovereign stays +100/+100 and grows golden from there).

- **Ashen Heir fixed** — it paid only on a newly summoned Imp, so the ordinary case (Imps alive, one dies) did nothing; a dying Imp now hands its stats to a living Imp, banking only when none is left.

- **Batch 4 complete — the five hard Epics** (Ancestral Roar, Ruby Shrapnel, Shared Scripture, Banquet Hall, Crucible Choir), closing out a batch of 17 Basic runes, 8 Epics and 3 T6 minions.

- **Batch 4, tranche 3 — eight more Basic runes** (Emberline, Ashen Payroll, Backbeat, Spare Chair, Spellhide, Spellmarket, Last Word, Runic Hoard); Backbeat had been hooked into the forced-Echo path, which an ordinary Deathrattle never passes through.

- **Batch 4, tranche 2 — three T6 bodies** (Ashen Heir, Runesnout Archivist, Mossmemory Colossus) and the Epic runes that grant them; the Colossus needed two loop guards, since a resurrected Beast that dies is fuel for the next resurrection.
- **Batch 4, tranche 3 — eight more Basic runes** (Emberline, Ashen Payroll, Backbeat, Spare Chair, Spellhide, Spellmarket, Last Word, Runic Hoard); Backbeat had been hooked into the forced-Echo path, which an ordinary Deathrattle never passes through.

- **Batch 4, tranche 2 — three T6 bodies** (Ashen Heir, Runesnout Archivist, Mossmemory Colossus) and the Epic runes that grant them; the Colossus needed two loop guards, since a resurrected Beast that dies is fuel for the next resurrection.
- **Batch 4, tranche 2 — three T6 bodies** (Ashen Heir, Runesnout Archivist, Mossmemory Colossus) and the Epic runes that grant them; the Colossus needed two loop guards, since a resurrected Beast that dies is fuel for the next resurrection.
- **Badge value rolls ease out** — stat counters (shop + combat) now decelerate onto their final number instead of ticking linearly, tuned for a slow, visible settle. And **combat damage now counts the HP badge down** on a hit (the mirror of a buff rolling up), contact-timed; a unit buffed *and* hit in the same beat nets both into one roll to its true HP. A killing blow still snaps.
- **Effect spawn areas can be ovals** — the workbench's emit shapes were locked to circles and squares; a new Emit squash slider flattens or stretches them vertically, so a ring can now spawn particles around an oval. Existing effects are untouched.

- **Batch 4, tranche 1 — nine new Basic runes** (Empty Plate, Gem Dividend, Carrion Coin, Five Banners, Centerline, Second Litter, Shared Pour, Aftermarket, Hoardcalling), plus a real combat-phase softlock: a Discover raised mid-fight left no legal action, since the phase guard and the modal guard each refused what the other allowed.

- **Rune of Savagery doubles last** — it ran before summon triggers, so a Groveweaver's buff landed outside the doubling (pup 1→2→5 instead of 1→4→8); plus all 163 rune arts re-wired.

- **The rune wiring audit** — 309 checks across all 163 runes prove each one arms, travels and is consumed through the real reducer path; rune buffs are also attributed by name instead of showing as anonymous "Combat".

- **Rune meters are readable at last** — the tally span had never had a CSS rule, so every rune counter rendered as unstyled text against its badge; it's now a pill above the rune, visible whenever the value is non-zero.

- **Bucky + the Chef no longer pay a turn late** — the tally was banked after combat rather than read live at combat build; both now land in the fight right after the shop that earned them. Bucky's art is wired and his rune counts the Ales you're banking.

- **Rune of the Chef fixed + tracked, and 34 runes get art** — its banked total never reached the combat body (the reducer's own mapper dropped it); its badge now shows the exact buff it will pay, and every rune but the Coffers has illustration.

- **Bucky + Rune of Bucky** — a T6 Dwarf whose Start of Combat pays +5/+5 per Dwarven Ale you cast last turn; the Groveweaver rune now grows its owner in combat as well as the shop.

- **Rune of the Chef** — a Chef Gary Toast banks the combined stats it hands out each shop turn, then spends that total as a combat Rally onto a random Dwarf.

- **Three more runes** — the Badger (a Badgington with Flurry and Ward), the Groveweaver (its summon grant also buffs itself), and the Conduit (every Ruby bounces one extra time).

- **14 new Epic runes** — the Enchantment batch: spell payoffs (Enchantment, the Crown), Ruby engines (the Lapidary, the Gem Golem), combat swings (Dragonscale, Tempered Time, Savagery, the Crucible, the Herald), and shop shapers (the Deep, the Guiding Candle, the Muster, the Foundry, the Corrupted Tome).

- **16 new Basic runes** — the Tip Jar batch: Gold engines (Coffers, Vault, Treasure Map, Golden Splinter), spell payoffs (Lorekeeping, Thrift, Flagship), a board-seller (the Altar), a board-transformer (Evolution), buy-dupes (Transcription), and two combat flags (Engraving, the Underdog).

- **Yirin ticks live + a live-tracking tripwire** — the Attunement counter moves as combat casts happen, and a new audit test fails CI when any combat carry-back ships without a real-time signal or an explicit exemption.

- **Big trigger chains resolve much faster** — a card that re-fires your Shouts announced every single one with a full pause, so a Dawnclaw chain could spend 8+ seconds saying the same line eight times. The first one still reads at full weight; the rest now cascade, cutting that to under three seconds without dropping a single trigger.

- **A gilded Rally pulses its token once per trigger** — Echohorn firing twice used to show one pulse and then two effects back to back; each trigger now gets its own pulse followed by its own burst, and the wind-up stretches to fit however many there are.

- **Live-play fixes** — enemy Earthbreaker no longer buffs off your casts; Front to Back's held-card value moves the moment a minion casts it; Sporebat names its stored spell; Menagerie Mammoth is a T5 hand-caster (Avenge 3) and its rune retires.

- **Combat casts beyond the stat family** — Discovers, refreshes, spell power, Gold and card grants all resolve mid-fight now (only pure tavern work fizzles); Mage-Pup's taught spell fires on a combat Shout re-trigger, and Sporebat/Badgington/Scavvers/Candle Conduit/Ruby Transfer are reworked onto the new reach.

- **Thunderous Sovereign improves twice as fast** — +2/+2 per Shop spell cast (gilded +4/+4), and the card now prints the step instead of just saying "improves".

- **New: Quil + Rune of the Wildscript** — a T6 Beast that re-casts your left-most held spell on its neighbours every fight; a combat cast's stats are temporary, but the spell keeps what it learns.

- **One combat spell-cast path** — eight factories each hand-rolled their own cast, so "your Shop Spells cast an extra time" had nowhere to hook; `castInCombat` now owns it, and Runebloom Matriarch multiplies every combat cast at once.

- **Karwind reworked** — flat +3/+3 to every Dragon on a Shout trigger, with a 20% chance to land +6/+6 instead, announced by a crit-style "2x" that floats above him. Seeded on both sides, so replays crit identically.

- **Owner balance batch** — 12 card/rune tier, stat and cost changes; Bathing Matriarch drops its alternating Attack/Health mode for a flat +1/+1; Rune of the Remains retires to the rune archive.

- **Balance Report names stop truncating** — the solo table's Name column had a ~112px track, ellipsising nearly every rune to `Rune of the Ci…`; the floor is wider now and anything still too long wraps rather than hiding.

- **Leaderboard + post-game MMR readability** — a button reset was erasing each leaderboard row's plate and pulling dark page ink over its text; the big MMR number had no colour declared at all.

- **Echo multipliers fixed** — Echohorn's Rally proc ignored Sylus entirely (halving the Echohorn→Dawnclaw→Drakko→Sylus chain) and Deathsayer's hardcoded scan dropped Zyff/Funeral Engine/Elderhorn/Grave Contract; both now share one canonical read.

- **Shop perf slice 2** — a real 240 Hz capture showed the drag FLIP was 90% of all frame work (~9.2 ms/call vs a 4.17 ms budget); it now captures only the row that can move, on GSAP's fast path.

- **New spell: Ruby Transfer** (T5, 1 Gold, Set 2) — target a minion and it steals all Ruby buffs from its neighbours, on the board *or* in the shop row.

- **Rune of Duplication actually duplicates** — it was a silent no-op on 41 of 72 Epic runes; amounts now accumulate, boolean runes fire per copy, White Wolf grants a second pup, and non-stacking runes say so on a forge pill.

- **Veinstorm grants Rubies** — its permanent shop grant now bakes into bought minions as *Rubies*, not a generic tavern buff, so a Gemheart Carver out of a +10/+10 Veinstorm shop summons an 11/11 Golem.

- **Spells wear a new bronze arch frame** — the art is clipped to the arch, the old purple tint is gone,
  and ~1.9MB of retired frame art left the bundle.

- **Balance Report derived views** — Card Demand (Wilson intervals, revision-pooled), Gold Economy and Upgrade Timing now render in-app from the banked replay derivations.

- **Rune batch** — Duplication + Summit fixed, all rune Avenge effects get live combat tallies on their badges, 5 missing forge previews, 2 text corrections, Epic Forge un-no-op'd for Runeguard.

- **Live-text batch** — combat-granted card previews now show real-time values (spell power, Ruby strength), Orbit (N) cards get their counters, and Discover/end-screen/shop-slot surface gaps are closed.

- **Rune of Resonance fixed + reworked** — the per-turn gate never reset (a bug class also hitting Gemscript); now first 2 Rubies double, 2 Rubies per turn, paid immediately on buy.

- **Shop-phase perf slice 1** — seven per-action/per-frame costs cut (card-HTML memo, servedBoards clone carve-out, Set-indexed telemetry, idling End Turn loop); behaviour-identical, from the five-agent audit.

- **MMR leaderboard unfrozen** — ratings now move through a narrow `submit_own_rating` RPC; since the accounts migration no write path had existed at all (requires running the new schema.sql section).

- **Snapshot fidelity** — served boards now carry their owner's full combat context (Ruby strength, Wild Hunt growth, hand, card-type buffs, Elderhorn modes, tribes); a fidelity test diffs the round trip against the reducer's own builder so new scalers can't silently drop.

- **Rune of Gemstorm fixed** — its Rubies now go through the real Ruby-play path, so Deepdelve Paragon doubles them (and Resonance Idol / Spellstone / Gemheart Carver see them too).

- **Celestials tranche 2** — Astral Relay, Celestial Crucible, Constellation Broker and Orrery take Set 3 to 16 cards; Orbits can now be TRIGGERED with nothing arriving.

- **Chicken Brawl's Charging Soldier charges again** — a duplicate `dw_soldier` CardDef was shadowing the one with the charge flag; one token now, plus a guard against shadowed duplicate ids.

- **Hero armor rebalance** — 19 heroes get individually-dialled starting Armor (spread now 2-20; Robin drops to 2, Brackus to 11).

- **Echohorn's Rally now detonates on the minion it procs, and hands over what it summoned.** Echohorn's
  token pulses, then a shard burst over a triple shockwave fires at the ally whose Echo it triggers — and the
  minions that Echo summons now appear *with* the burst instead of ahead of it. Once per proc, so a gilded
  Echohorn shows two bursts and delivers one litter each. Fixing this uncovered that Rally effects had never
  been able to play at all: a Rally is absorbed into its attacker's swing, so the binding that was supposed
  to drive it could never be reached.
- **A 16-item balance batch + fresh Set 2 art.** Tier/stat/cost tuning across five cards and five runes,
  Water Dragon back to its spell-copy shape, Errand Fiend to a Rally Imp engine, Rope Wrangler's Echo now
  summons (and spends) a random minion from your hand, Strange Revision works on Shop minions, Rubies count
  for Rune of Distillation, reward cards (Goldcrafter, Triple Reward…) no longer count as spells or get
  copied by spell-copy effects, and a new Dwarf — Chicken Brawl, whose Echo sends out a Charging Soldier
  that attacks immediately. Plus ~150 re-wired Set 2 minion illustrations.
- **The Effect Arena's Shout family is done** — every Shout now fires in combat when a disruptor (Ryme,
  Dawnclaw, Funeral on Loan) re-triggers it: the legacy combat switch is deleted, 60 effects run one shared
  body in both phases, and economy Shouts (card grants, Rubies, Gold, run enchants) resolve live and carry
  back to the run at settle. Only pure tavern work (consume/gild/shop enchants) still waits for the shop.
- **A Card Art tuner** — double-click any card in dev to grab its illustration and drag it into place,
  wheel to zoom, ✗/✓ to discard or save. Plus hue/saturation/contrast, saved per card to a real file.
- **Effects can now move the cards themselves.** A new `react` layer in the effects workshop animates the
  real card — the whole card, a stat badge, just the badge circle, or just the number — instead of drawing
  something on top of it. It can spread to neighbours or the whole board (rippling outward, sweeping across
  the row, or all at once), weakening with distance, with squash-and-stretch and shake channels.
- **Stat badges are now three pieces.** The attack/health badge used to be one element carrying both the
  circle and the number, so an effect couldn't touch one without dragging the other. It's now a wrapper, a
  `plate` (the circle) and a `value` (the number) — groundwork for badge-level effects like "pop the circle
  while the number counts up." Pixel-identical to before, verified across 12 card states.
- **Henchmen wired** — every hero can carry a hero-bound minion, never shop-offered, recruitable once per run
  at a Gold cost that falls every round (win −3, loss −2). System + placeholder shipped; the per-hero roster
  and real presentation come next. **Set 3 scaffolded** — registered and selectable in the Scene Builder,
  empty until its cards land.
- **Rubies now detonate on the minion they land on.** A gemshard burst over a twin shockwave, authored in the
  effects workbench, plays on the target every time a Ruby is played on it — your own drag from hand, a card
  that plays Rubies across the whole board, or one landing mid-fight. Board-wide plays sweep down the line
  60 ms apart rather than all flashing at once, which reads better and keeps the frame budget. Separate from
  the existing "your Rubies got stronger" cue, so a card that does both shows both.
- **Saving an effect no longer wipes its name and tags.** Effects carry a display name and a few tags used to
  search and group them in the effects library, and every Save was silently deleting them — the melee hit
  effect lost its own name that way, and it was only spotted by eye. Saving over an effect now keeps them.
  Saving under a *new* name still starts clean, because that's a copy, not the same effect.
- **Deleted the orphaned Pixi aura-bubble system (−1 WebGL context).** Ward and Reborn became CSS domes a while
  back, but the Pixi machinery that used to draw them stayed — including a whole third full-viewport WebGL
  context that a previous pass had merely ticker-stopped as "dormant" instead of removing. Gone with it: ~210
  lines of unused GLSL and the `.pixifx-under` layer. The break burst (`shatterAt` / `rebornSummon`) is
  untouched. Total emitted JS 2,631,425 → 2,617,973 bytes.

- **Dwarves and Kobolds are fully dressed** - both now have their own cardplate, Dwarf gets its oval and
  Taunt frames, and both tribes finally have a colour so their emblem fills in.

- **The effects tool can now take an effect back off a card.** It could attach an effect to a moment but
  never remove one — that meant editing a data file by hand. There are two ways to remove one and they do
  opposite things (go back to the default effect for that moment, or play nothing at all), so both are
  offered, each spelling out what the card will do afterwards before you press it.

- **Effects can now play *behind* the cards.** Every visual effect used to draw in front of everything, so a
  ground slam sat on top of the minions it was supposed to be shaking. An effect can now choose its layer —
  over the cards, as before, or under them on the board itself — with a toggle in the authoring tool. (It's
  beneath *every* card, not just its own; that's a limit of how cards and effects are drawn.)
- **Damage numbers are readable again.** Combat effects were painting over the damage numbers — the
  death-dissolve in particular buried them completely. The numbers now draw on top of every effect, in
  every situation, so a hit always reads. (They also cost the game slightly less to draw than before.)
- **The effects library stopped calling live effects dead.** Seven visual effects — the coin shower, the
  click puff, the melee smack and others — had been moved out of hand-written code into the authoring tool's
  own format, and the tool's coverage map, which only knew about one way of wiring an effect up, listed every
  one of them as playing nothing at all. It now tells the three cases apart: wired to a game moment, played
  directly by the code, or genuinely unused. The "played by code" list is worked out from the source itself
  and re-checked by a test on every build, so the next batch of migrated effects can't quietly go missing
  from it again.

- **Removed the dead "Shield Place" tuner.** The DEV panel had outlived its consumer: `syncShields` is gone and
  Ward/Reborn are CSS dome stacks, so dragging its slider only wrote a localStorage value nothing read. Its one
  knob — the dome's vertical offset — is already live in the 🔵 Ward Dome tuner as `domeY`. Also ESLint-ignores
  `.claude/**`, so locally-installed agent plugins stop making `npm run lint` red on a clean tree (78 → 0).
- **Audited the dead-code purge, and cleared the CSS half.** The roadmap's list was wrong in four places — two
  of them traps (`.disc-gem` and `.ob` are live; deleting them would have caused visible regressions) — and the
  dead effect-id count was 69, not "~17". Verified inventory now in `docs/dead-effect-ids.md`.

- **Fixed hand cards growing and overlapping** - the hand "make room" glide was baking the hover
  zoom into card width; it is reverted until it can be done transform-safely.

- **The hand glides open and closed** when you buy or play a card, instead of cards blinking to new
  spots. (The first version of this was inflating cards; it is rebuilt on a measurement no transform
  can pollute.)
- **The game now has a real speed limit — and the speed-o-meter was reading the wrong dial.** The target is
  **240 frames a second** (with 360 as the stretch), which leaves about **4 milliseconds** to draw each
  frame. The in-game performance readout had been judging frames against a 60-per-second monitor, so on the
  display we actually play on it only complained after *eight* frames had already been dropped — it reported
  a clean session while the game stuttered. It now measures the display it is running on and sets its own
  thresholds from that, resists being fooled by a busy first second or a throttled tab, and records which
  display a log came from so old logs stay readable. The budget itself is written down, along with the rule
  that the **worst** frame is what counts, not the average.
- **The gild opens without the hitch.** Combining three copies into a gilded card had a small stutter right as
  the animation started. It was not the gold glow or the flourish drawing — it was that the effect built two
  full-screen drawing surfaces the instant it began and wiped them clean every frame, though nothing is
  painted on either of them until a third of a second later. They are now created at the moment they are first
  drawn on, the three flying card copies are measured once instead of three times and go in together, and the
  card-art glow is only rewritten when it actually changes. Measured over the first eighth of a second of a
  real triple: the gild's cost per frame is down **24%**, with the effect looking identical.
- **The combat collision stutter is gone.** Every time two cards clashed, the game froze for about a sixth of
  a second — long enough to feel, short enough to be hard to catch. The cause turned out to have nothing to do
  with how many particles were on screen: each effect was throwing away its compiled graphics program when it
  finished and rebuilding it from scratch the next time, and rebuilding one blocks everything else for ~68 ms.
  Effects now reuse their programs (and the buffers behind them) from a pool, and the one unavoidable build
  happens quietly at load instead of mid-fight. Measured worst frame during a collision: **160 ms → under
  2 ms**, with proof that a reused effect looks byte-for-byte identical to a fresh one.
- **The effect workbench stops fighting the person using it.** Three ceilings came down at once. Art you
  import as a particle shape now survives a page reload instead of quietly reverting to a plain circle — the
  file was written to disk correctly, but the app couldn't see a file that appeared after it started, so a
  tuned effect appeared to vanish. The physics sliders got roughly four times the range, because "as dramatic
  as it goes" was landing short of what effects actually wanted (one had to trade launch speed for arc height
  to fake a lob the ceiling wouldn't allow). And the fade every particle rides — previously baked in, so
  particles faded whatever you drew on the opacity curve — is now a control that can be turned off entirely.
  Nothing already made looks different; every existing effect is pinned to that by test.
- **The melee smack is an authored effect now, and effects can aim along the blow.** An authored effect is a
  fixed recipe, but a strike has to fan its sparks *at the defender* — a direction that only exists at the
  moment of the hit. Rather than let callers bend a recipe with an angle (which would stop it being a recipe),
  a burst can now point itself along the moment itself: from where the effect came from, toward what it hit.
  The combat impact moves across on it and takes its whole dev tuner panel with it, since the workbench is
  where it is tuned from here.
- **Effects can be stretched in time at the moment they fire.** The last of the three per-call dials —
  bigger, more, and now *longer*. Not the same as slowing an effect down: the dust thrown up by a strike
  keeps its speed and simply hangs (and travels) further. The tricky part is that "life" means two different
  things — how long a particle lives and how long its layer exists — so the dial moves an effect's whole
  timeline together; stretching only half of it would have quietly cut particles off mid-flight in most of
  the library. The strike-point dust moves across as the proof, and every button that kicks it up now dials
  its own count, size and lifetime.
- **Effects can be sized at the moment they fire.** An authored effect is a fixed recipe, which is most of
  its value — but a lot of them need to know something only the caller knows: how big this card is, how hard
  this hit landed. Two per-call dials now carry exactly that, and nothing else: bigger, and more. The dust
  kicked up under a landed minion is the first effect to move across on them, and now sizes itself to the
  card it lands under. Existing effects are untouched down to the exact random roll a locked seed replays.
- **Bursts can be aimed.** A `burst`'s cone used to fan along the emitter's direction of travel — which is
  *nothing* for an effect pinned to a fixed point, so a directional pop from a static anchor couldn't be
  authored at all. Two new params fix that — point the cone at any angle you choose — and the gold coin
  sprinkle gets its upward fan back instead of popping in every direction.
  Every existing effect is untouched, down to the exact random roll a locked seed replays.
- **The first hand-written FX become data.** Now that authored effects actually reach players (below), the
  ~28 hand-tuned methods in `pixiFx.ts` can start moving to the workbench. Batch 1: the crimson damage burst,
  the click dust puff and the gold coin sprinkle are authored defs, taking `pixiFx.ts` from 3757 to 3648
  lines. The nine effects that take a per-call size or intensity are blocked until `playDef` can pass one.
- **Authored FX reach players.** The whole def runtime was dev-only by design, so nothing authored in the FX
  workbench had ever been seen outside a dev session. Three `import.meta.env.DEV` gates came out and the
  effects ship: **15 already-live bindings turn on** — attack exchanges, buff waves, keyword gain/loss, quest
  trigger/complete, rally, reveal, spell cast + progress, ward gain, venom spent, HP grants, cards to hand,
  and Bloodbinder's ruby lance. Cost: +34 KB gzipped of JS, 29 KB of it a primitives chunk fetched lazily
  on mount rather than at first paint (the main chunk grows under 5 KB gzipped). The
  *authoring tool* stays dev-only; a test now pins that split in both directions.
- **Cards and chips answer when you choose them.** Hero and mode cards already lifted on hover but did nothing
  on click; they now press into the table, chips sink, and list rows press inward.
- **Every button off the title screen now presses like the title screen** — real thickness, and a face that
  loses exactly the thickness it travels, so it compresses rather than slides. One extracted primitive, applied
  across nine screens.
- **The dev tuners look like instruments now.** Dark machined panels over the board instead of pale dialogs on
  it, with the slider track lit to its value, a flagged edge on anything moved off shipped, and the main menu's
  sheen on button hover and press. Eight ad-hoc text sizes became a four-role scale.
- **One button resets every dev tuner to the shipped values.** Per-panel Reset only ever cleared that panel, so
  nothing put the whole toolset back at once.
- **Tuning got a working surface.** Panel sections fold away and remember it, each panel has a find box, and a
  hold-or-tap button A/Bs your edits against the shipped values — the question "is this actually better than what
  we ship?" used to mean reverting every control by hand. All three landed in one shared component.
- **The dev tuners are one component now — 46 of 48 panels.** Every panel renders from a declarative spec that
  gives it real sections, a declared unit per control, a hover hint saying what you would see change, a number
  box beside each slider, and a one-click revert to the shipped value. The last three had no config module at
  all — they compose CSS — and now share one store that also owns tearing their override back down on close.
  `SfxMixer` is parked by owner request; `ShieldTuner` is handled separately (it is dead code).
- **Three dev tuner panels ignored their own close button** — their internal key disagreed with the menu's, so
  ✕ did nothing and they could only be dismissed from the menu. Fixed.
- **Set 2 content is complete: 26 quests and the full 96-rune roster.** The last stretch leaned on a handful of
  reusable primitives rather than bespoke code per item — a threshold dispatcher ("every N of X, do Y"), a
  gold-gain chokepoint, a shared free-rally helper — so most items became data plus a test. Two engine gaps
  closed along the way: Gold is now credited through one path, and combat can carry an untyped board buff back
  to the run.
- **Lobby mode stopped hitching.** Starting a lobby ran seven full headless runs to build its opponent seats —
  twice, since they were built only to be probed and then evicted. Recordings are now lazy, memoized, and warmed
  in shop-phase idle time: 750 ms → 21 ms to start, 950 ms → 4 ms for round 1. And dying in a lobby replayed the
  *entire* lobby to recapture its boards — ~20 s of frozen end screen; lobby runs now capture their boards as
  they play, so the longest task after death is 83 ms.

- **The dev tuning menu is searchable, and tuners are becoming data.** 53 flat entries became nine categories
  with filter-as-you-type and a description on every one; six of the 47 tuner panels now render from a shared
  schema that declares units, real sections, per-control hints, and a one-click revert to the shipped value.
- **FX library cleanup — and two "dead code" leads that weren't.** Five leftover workbench drafts deleted from
  `fx/defs/`. `death-dissolve` was investigated and **kept**: no binding names it, but `useCombatReplay` plays it
  directly for every plain death. Same for `pixiFx.discoverBurst`, which fires on every Discover open and is the
  only reason the second Pixi context exists. Both are now documented as do-not-delete.
- **FX workbench: stop hiding things.** Four papercuts in the effects authoring tool, one principle — make
  failure visible. "Watch in combat" now carries its own ▶/⏸ · 🔥 Fire · scrubber, so you can retrigger and scrub
  while watching an effect on a real card; the commit confirmation survives the page reload committing itself
  forces, instead of being unreadable by construction; a locked seed warns under Save (naming the seed, with a
  one-click unlock) before it bakes one frozen roll into a shipped def forever; and a preset variant whose
  adjustments reached nothing says so in the UI rather than only in the console.
- **＋ New effect — the FX workbench gets an on-ramp.** A preset gallery of archetypes (⚡ Bolt, 💥 Blast), each
  with variants (thin / heavy / crackling / beam), lands a tuned, working composition in the editor instead of a
  blank page. A variant is a multiplier table applied to slider params only — clamped, snapped, and loud about
  anything it couldn't apply. The two shipped bases are first passes awaiting a tuning pass.
- **Lobby: real players at the table.** An 8-seat lobby now seats up to 3 REAL player runs from the shared
  board pool — their actual boards, in their actual order — alongside bots wearing player handles. Measured over
  9 lobbies, recorded player runs place 3.63 against the bots' 6.58.
- **Bots that actually play.** The production bots score a board by *fighting with it* rather than guessing from
  stat proxies, and the lobby runs them at last (every seat had quietly been the old greedy bot). Against real
  player boards Expert covers 4.63 wins to legacy's 3.33 — par is 9, so the gap is real and measured.
  `npm run bot:ladder` / `lobby:ladder` report it with error bars.
- **The title menu presses back.** Every menu plaque now has a visible edge that collapses under the click, a
  down-stroke "thock", a hover sheen, a staggered entrance, and a keyboard focus ring — the column went from
  hover-only rectangles to controls with weight.
- **The UI is typechecked in CI now.** `packages/ui` was excluded from the root typecheck and `typecheck:web`
  was never gated, so the whole presentation layer had no type gate (the production build transpiles without
  checking). Cleared all 59 errors and turned the gate on. Several were real: the mixer's gain-reduction meter
  read NaN, kobold-tribe quests printed `undefined` in their text, and the two plate tuners' "demo" buttons did
  nothing.
- **Commit animation.** Pick a card and a moment in the workbench, tune the effect while watching it on the
  real card, then commit — writing the effect and its binding together, for that card only (forking it) or
  everywhere.

## Layout

A TypeScript monorepo (npm workspaces). The engine is a pure, deterministic simulation fully decoupled from
the UI — combat is a pure function returning an event log the UI merely replays. See [CLAUDE.md](CLAUDE.md)
for architecture and conventions.

- `packages/core` — `@game/core`: seeded RNG, types, event bus, effect system, `simulate()`
- `packages/content` — `@game/content`: data-driven cards + threats + quests + runes (zod-validated)
- `packages/sim` — `@game/sim`: run loop (economy, shop, tiers, triples, scoring, quests/runes)
- `packages/ui` — `@game/ui`: React + Zustand recruit screen + combat arena
- `packages/tools` — `@game/tools`: headless combat harness, run bot, balance runner
- `apps/web` — Vite app wiring `ui` + `sim`
