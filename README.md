# ASCENT

A single-player roguelike auto-battler. Build a board in a Battlegrounds-style shop, then fight an
ever-rising curve of threat-typed enemy boards. Survive as long as you can — score is waves survived.

> **Status:** M2 (content + balance) — fully playable. All 6 tribes, triples + Discover, the run
> loop, and the recruit/combat UI are in. Remaining M2 work is the counter-matrix balance tuning.

## Quick start

```bash
npm install
npm run dev          # play it (Vite dev server)
npm test             # vitest: determinism, effects, run loop, content
npm run balance      # headless: probe the A.6 counter matrix
npm run bot          # headless: a greedy bot plays full runs
npm run harness      # headless: narrated combat event log + determinism proof
npm run typecheck && npm run lint
npm run package:itch # build + zip ascent-itch.zip for itch.io (HTML, "play in browser")
```

New contributor? See **[ONBOARDING.md](ONBOARDING.md)** (clone → install → verify → the collaboration rules).

## Recent changes

_(Most recent first — the full history is in [docs/devlog.md](docs/devlog.md).)_

- **Deathrattle summons read cleaner.** A Deathrattle's tokens now wait for the skull to pop and *burst*
  (and an attacker to settle home) before they appear, instead of popping in over the FX. The taunt death-burst
  effect + sound are removed for now.
- **The Echo skull poofs.** The Deathrattle death FX is no longer a bone skull-and-crossbones shattering into
  fragments — it's a **purple glowing skull-and-crossbones** (a vendored SVG silhouette) that pops up and poofs
  into a smoke plume and glowing embers, matching the purple Rally float so an Echo reads the same everywhere.
  Tuned on a new standalone preview rig (`apps/web/public/fx/purple-skull-preview.html`). Presentation-only.
- **Snappier combat stat gains.** An `onDamaged` buff (Target Dummy taking a hit) no longer splits the clash —
  the whole exchange lands first (both hits, at their real pre-buff values), the units settle, then the `+N`
  floats on a cadence cut to a third. Presentation-only; the numbers still float at the same speed.
- **Lunge Strike Effects tuner + strike-point control.** A new 💥 Dev-menu panel controls the whole combat
  strike-impact package in one place — flash, shockwave, heavy ring, sparks, smoke, dust billow, and energy
  pulse (previously hardcoded), plus a `corner depth` dial for where the attacker's leading corner lands
  (defender surface ↔ true centre). Owner-tuned defaults baked. Presentation-only.
- **Skip combat fades out gracefully.** Skipping the replay no longer hard-cuts: everything freezes and mutes for a
  beat, all units + FX fade out together, then the resolved board fades back in — the same crossfade as End Combat.
- **Hero batch — 4 reworks + 6 new heroes.** Djinn's Cadence now fires *every* friendly End of Turn; Rohan scales
  by spells cast; Nadja has 19 Armor; Warden's Aegis buys a minion a permanent Ward for 4 Gold. New: **Disco Dan**
  (turn-1 Setlist — Discover T6/T4/T2, each locked until that shop tier), **Bagger Ben** (scaling Gold), **Hermit
  Hank** (2-Gold minions, +2 tavern-ups), **Fi** (an early quest on turn 3), **Herald** (neighbours Consume a Fodder),
  **Chronos** (buy 4 End-of-Turn minions → a Chronos).
- **Front to Back scales Attack/Health independently.** A `+0/+2` (asymmetric spell-power) build now escalates
  **+2/+4** per cast instead of symmetrically — the two stats diverge as intended, and every surface prints the
  true split value.
- **New minion — Tauntbreaker** (T4 Neutral 6/4, Ward + Flurry). Its attacks strip **Taunt** and **Rise** off the
  enemy it hits — break past a Taunt wall and deny the Rise on the same lethal swing. Flurry disarms two a turn.
- **Rally attack reads louder.** The wind-up pause when a Rally fires holds longer, and its yellow trigger pulse is
  much brighter (a wide triple-layer gold halo) — the Rally is worth noticing.
- **End-Combat is one synchronized crossfade.** Leaving the arena no longer snaps: the **End Combat** button now
  fades every combat unit + FX out together in one beat, then fades the recruit board + surviving minions back in
  together. Opacity-only, so it stays snappy.
- **Quest UI polish.** The Author's Hand quest now shows its objective as three progress lines (Shouts / Echoes /
  Rallies triggered N/6); long quest text now fits inside the choice-box frame (cards grow + level to equal
  height). (Pack Leader stays a Start-of-Combat buff — the #226 permanent-on-play version was reverted per owner.)
- **Burning-rope turn timer (re-added).** The Hearthstone-style burning rope is back — it lights in the final 20s
  of a recruit turn and burns left→right on the board's centre divider (live flame + char trail). The digital
  `SETUP TIME` plaque stays alongside it.
- **Compendium: Quest Rewards category + exclusive Spells/Quests filtering.** The codex now has a **Quest Rewards**
  section listing all 24 cards a completed quest grants (the reward-only tokens plus Badgington / Money Bot). Spells
  and Quest Rewards are now **exclusive** filters — selecting either shows only that pool, and neither leaks into a
  tribe (minion) search unless the player toggles it on.
- **Rulebreaker neutral quests.** A 13-quest batch of economy / spell / rule-bending neutral quests (+ Chimerus for
  Dragons). Adds the `winRound` / `castSpell` / compound `authorsHand` objectives and rule-bending rewards — Dupes
  (copy your first buy each turn), Merchant's Mark (2g minions), Ancient Runes (spells cast twice), Rulebreaker's
  Crown (double the leftmost minion's Attack) — plus Goldcrafter / Lazarus / Taurus the Truth Bringer / Chimerus.
- **Deathrattle bone-skull shatter FX.** When a unit with a Deathrattle dies, a painted bone skull-and-crossbones
  pops up over it and **explodes** into flying bone fragments, splinters, and smoke, while the card fades in place.
  UI-only (no engine change); art at `apps/web/public/fx/skull-crossbones.png`, effect in `pixiFx.deathrattle`.
- **Corner-clack combat feel + impact FX.** The attack lunge now lands as a physical corner strike: a pure
  `contactGeometry` helper stops the attacker at the defender's surface (no more center-overshoot), tilts it
  to lead with a corner and rebound, the defender counter-spins, and the impact spark fires from the actual
  clack point — which also erupts a card-drop-style dust billow and an expanding energy pulse ring. Strike
  duration scales with travel distance, so near and far attacks feel equally paced. Tuned on an interactive
  strike previewer and baked. Presentation-only — no fight-outcome changes.
- **Demon quests — the fifth and final authored tribe.** The Fodder/Imp/Consume quest set (9 quests + Contract Imp /
  Herald of the Apocalypse / Run Maw / Implosion). Adds `consumeFodder` / `consumeStats` / `summonImp` objectives and
  the Deep Hunger, Contract Rewrite, Pit Without End, and Run Maw combat mechanics. **All five tribes + neutral are
  now fully authored — no `Test ·` placeholder quests remain.**
- **Mech quests + keyword quests go neutral.** The Mech Attachment/Rally quest set (6 Mech + 3 neutral Rally quests
  + Scrap Vendor / Chorus Engine / Perfect Core). Adds a `rally` objective (additive doublers, like
  Shout/Echo), a `playAttachment` objective, a `sell`-by-tribe filter, and "get a random Shout/Echo/Rally/… minion"
  rewards. **Keyword-triggered quests** (Shout/Echo/Rally/End-of-Turn) are now **neutral** — a keyword reward helps
  any build — and several now also grant a matching random minion. Retired the last `Test ·` neutral/Mech quests.
- **Undead quests — the third authored tribe.** 9 quests + 4 reward cards + the **Echo (Deathrattle) engine**. Two
  objective flavors: `deathrattle` counts Echo *triggers* (scales with doublers), the new `friendlyDeath` counts raw
  *deaths* (doesn't). Echo doublers stack **additively** — Sylus + Funeral Engine (permanent) + Grave Contract / Last
  Rites (first Echo each combat). The Bone Throne re-triggers your leftmost Echo every 7 deaths; Ossuary Rite is a
  **repeatable** quest. Reward cards: Bone Taxer, Ossuary Rite (spell), Gravetwin, Crypt Broker (Sell → a random Echo
  minion, triggered).
- **Dragon quests — the second authored tribe.** 9 quests + 3 reward minions + the Shout/End-of-Turn/stat-growth
  reward engine, plus the combat quest panel that live-ticks objectives during the replay.
- **Deathrattles-in-shop + Sylus sweep** — Graverobber now fires ANY Deathrattle out of combat (Grim included),
  and Sylus the Reaper doubles both Graverobber's and Echoing Coop's Echoes. Quest reward cards (Feed the Alpha,
  Trail Forager, Trophy Stalker) never roll in the regular shop. Added the Hoard Spark Dragon quest; retuned the
  Beast quest objective counts.
- **Balance + fixes batch** — Den Mother (+1/+1, recruit-only), Kennelmaster Avenge (3), a Squirl Scout rework
  (spread +3/+3 per Beast owned, snowballing), Pack Leader scaling with Beasts-played, Hoardbreaker 6/4; plus fixes:
  **Slaughter only triggers on an attack-kill** (not retaliation), welded/given attachments now inherit the
  Attachment aura, Nimbus doubles Discover-spells (Tribe Portal), Wayfinder spreads its Discover across all
  uncontrolled tribes, and golden Wildwood Shaper shows its doubled Choose One text.
- **Beast quests — the first fully authored tribe.** All 11 Beast quests (lesser/greater/capstone) + 3 reward
  cards (Trail Forager, Trophy Stalker, Feed the Alpha) + art. Introduces **combat-phase objectives** (attack /
  summon-in-combat / slaughter / Echo, tallied inside `simulate()` and applied after the fight) and a big reward
  palette: persistent + scaling "wherever they are" tribe auras, recurring end-of-turn grants, keyword-stamped
  grants, and run-wide combat flags (Blood Trail, Echoing Coop, Law of Teeth, The Old Hunt).
- **Choreography panel fixes** — the ▶ Preview effects now draw **in front of** the panel (the FX layers are
  lifted above it while it's open) instead of behind it, and timeline lanes whose anchor can't fire before its
  moment (`start` cues) grey out their negative side so the limitation reads at a glance.
- **Combat Choreographer — Phase 4 slice 1 (the 🎬 Choreography panel)** — the combat Score is now a
  live-editable timeline: drag cue chips to retime/reorder, per-cue ms offsets + scales-with-speed/on-off
  toggles, a ▶ mock-stage FX preview that fires a moment's real effects on demand, and Copy/Reset. The
  `aura` channel split into independently-retimeable burst/break/re-form cues and the Pacing tuner is retired
  into the panel. Invisible by default (default timing byte-identical).
- **New minions — content batch (waves 1–4, 25 cards)** — a big content push across all tribes: economy
  Slaughter/Avenge payoffs (Bounty Bot, Moe, Pit Supplier), spell engines (Runescale & Vineweaver Drake, Nimbus,
  Spell Appraiser), tribe splashes (Wayfinder), **combat spell-cast**
  (Hoardbreaker Drake, Spark Capacitor), and a **Beasts-played-this-turn** payoff pair (Pack Leader
  + the Spirit Worgen retext) plus Graverobber — each card is data + art + a new effect factory + a test. Only the
  two baked "+X wherever" auras (Squirl Scout, Scrap Herald) remain.
- **Combat Choreographer — Phase 3c (aura bursts)** — aura burst/break/re-form authority moves out of
  Recruit.tsx's per-frame tracker into the choreographer (a new `aura` channel + the pull-back-driven `landed`
  anchor); the double-burst bug is now structural. syncShields is position-tracking only; all six cross-file
  timing welds retired.
- **First real quests + reward palette (M3)** — the skinny `Test ·` beast/dragon/undead lesser quests become **Trail
  Rations / Warm Embers / Grave Toll**, adding `summon`/`shout` objectives and card-generation, delayed-repeat, and
  Shout-doubling rewards, plus an **art-forward redesign** of the quest cards (crisp art, tribe emblem, framed dark
  panels, gem). Also: Brood Matron / Steadfast Champion / Solaris Fang Avenge retunes, and the redundant 0-Gold coin removed.
- **Combat Choreographer — Phase 3b (the contact cluster)** — the GSAP cue-timeline engine
  (`choreo/engine.ts`) + float/impact/lunge channel adapters land; the attack lunge, contact FX/sfx/recoil,
  and the beat advance now run off one GSAP `contact` position (retiring the clock's smack-lead weld).
  Invisible; sets up phase 3c's aura bursts.
- **Quest system — engine framework (headless; UI is the next PR)** — the skinny first half of quests (M3): on
  waves 4/8/12 a quest shop offers 3 quests (1 neutral + 2 tribes, bought for 0 Gold) into a persistent quest
  list; objectives tick during play and apply a reward on completion. Seeded/deterministic + fully tested.
- **Combat Choreographer — Phase 3a (Score seam + SFX channel)** — the choreographer's Score
  (`SCORE: Record<MomentKind, Cue[]>` + `runMomentCues`) lands with `sfx` as its first channel — a verbatim
  relocation of the combat-sound dispatch out of `useCombatReplay`. Invisible; sets up phase 3b's damage
  floats + FX/impact channels.
- **Quest system (M3 — skinny framework, engine + UI)** — on waves 4/8/12 the tavern becomes a **Quest Shop**:
  pick 1 of 3 quests (1 neutral + 2 tribes, 0 Gold) with the tavern locked + timer paused; it goes to a quest
  panel where its objective ticks during play ("Play 2 minions — 1/2") and applies a reward on completion.
  Seeded/deterministic; the beast/dragon/undead lesser slots are now real (above), the rest still test content.
- **Combat Choreographer — Phase 2 (replay clock)** — the combat-replay beat scheduler is now a pure,
  unit-tested `holdMs` clock; each moment carries a `MomentKind`; pacing config moved into
  `choreo/choreoConfig`. All invisible (timing byte-identical) — the seam phase 3 hangs effect channels on.
- **Combat Choreographer — Phase 1 (engine foundation)** — the combat sim now stamps every event
  with a resolution-step tag (pure metadata, outcome-neutral) and a new Moment Compiler
  (`compileMoments`) reproduces today's combat-beat grouping byte-identically while carrying that
  sim-declared simultaneity forward. No visible change yet — this is the honesty foundation phases
  2–4 build the real choreographer on. See [docs/combat-events.md](docs/combat-events.md) for the
  event vocabulary + trigger-order reference.
- **Layout Lab (dev)** — a new Dev Tuning entry ("📐 Scale & Layout") to live-scale, space, + reposition the
  board: global card + UI-chrome scale, per-row card size + spacing, and X/Y offsets for the warband, hand, and
  HUD. Drives CSS vars, dev-only (production ships the stock layout).
- **Clear Run button** — the title screen now has a **Clear** button beside Continue to discard a saved run
  (two-step confirm) without having to start a new one over it.
- **Compendium hides spells by default** — the Compendium now opens minions-only; the **Spells** rail chip is an
  opt-in toggle that *adds* spells to the view (a "· Spells hidden" cue shows while it's off).
- **End-game scoring + Hall of Champions W/L spread** — winning the closing rounds now pays escalating rating
  (round **15 → +8**, **16 → +12**, **17 → +16**, stacked on the summit + line bonuses), surfaced as an
  **"End-game Push"** chip on the end screen. And the **Hall of Champions** now renders each champion's full
  **17-round W/L spread** — the end-screen round pips, calibration rounds dimmed — for new victory runs.
- **Content batch — Beast auras, a new hero, 3 minions + a spell** — Beasts gain a "wherever they are" theme:
  **Kennelmaster** now gives your Beasts **+1/+1 at Start of Combat** (and buffs beasts *summoned mid-fight*),
  which **Grim** and new **Solaris Fang** (Beast/Mech T5 — Rally: Beasts +5 Attack; Avenge: gain Ward + attack
  now) share. Also new: **Runic Beetle** (T3 — Choose One: give a Beast Rise or Flurry), **Money Maker** (Mech
  T1 — every 2 turns, a Gold Pouch or Safety Deposit Box), and spell **Rallying Offensive** (T3 — your Rally's
  fire **twice** next combat). New hero **Gildmaster** (30/15 — *Golden Gild*: spend 3 Gold to combine a pair
  into a golden in hand, twice a game). Rebalances: Sword and Bored 2/1 (+1/+0 Fodder), Gnasher 7/6, Sporebat
  4/3, Mumi → T2; **Ghostsmith removed**; text cleanups. Fresh art for every new card + the hero.
  **Plus (same drop):** new **Watcher** (Undead T6 — Rally: cast **Lantern of Souls**, +3 Attack to your Undead
  for the run), **Steadfast Champion → T5 4/7**, **Footman Leader → Footman Captain**, and re-arted Footman /
  Solaris / Forest Guardian.
- **Rise reads as die → Deathrattle → rise** — a minion with **Rise** now genuinely leaves its slot when it
  dies (a real removal, not an in-place flicker), its Deathrattle fills the vacated slot, and it returns to the
  **right** of whatever it summoned (a Violet Whelp with Rise now rises to the right of its Whelp, not the left).
  Balance-neutral — combat outcomes are unchanged; a rise-death shows + plays a soft spirit cue but doesn't shake
  the board (so frequent rises stay snappy).
- **Big content batch** — 8 renames (Eternal Knight → **Spear Warden**, Mama Bear → **Forest Guardian**,
  Alleycat → **Pennycat**, Manasaber → **Void Panther** + Void Cub, Frontdrake → **Bard**, Beatboxer →
  **Beatbot**, Forsaken Weaver → **Forsaken Mage**, Koron → **Korok**); **Harry Botter removed**; four new
  minions — **Mysterious Joker** (T6: Discover a Tier-5 minion), **Haven Drake** (T4: get a random Dragon),
  **Aeon Guard** (T5: End of Turn spell-power ramp), **Steadfast Champion** (T6: Avenge 3 — summon a Spear
  Warden that **attacks immediately**); two new spells — **Pre-emptive Assault** (you attack **first** next
  fight) and **Safety Deposit Box** (+2 Gold next turn); and the 13th hero, **Lord of the Risen** (30+8 —
  *Rise Again*: give a friendly minion Rise for the next combat). Fresh art for all of the above.
- **New keyword, 3 units, and a glossary** — **Slaughter** ("when this kills an enemy minion") joins the
  keyword set, wired onto Gnasher. Three new spell-mill / Fodder units: **Professor Greg** (T4 Undead —
  Avenge 3: get a random spell), **Badgington** (T4 Beast — Rally *and* Slaughter: get a random spell), and
  **Sword and Bored** (T1 Demon — Slaughter: buff your Fodder), each with art. The **Compendium** gains a
  **Glossary** toggle — a keyword codex (Triggers / Combat keywords / Build & shop) that fills the page; **click
  any keyword to filter the gallery to the minions that have _or grant_ it** (Rise → Mumi, Ward → Selfless
  Sentinel; clearable chip). Also refreshed the Gnasher and Koron art, and fixed three cards missing their
  keyword pill — **Taurus** (Start of Combat), **Karthus** and **Commander Impala** (Slaughter).
- **Win-weighted rating** — **truly winning** (over your Line *and* winning the final round) now pays a lot: a
  bigger **Summit Bonus (+8)** for reaching round 17 plus a new **Final Win bonus (+16)** for winning it, while
  merely **covering your Line** reads as a modest "top 4" credit. The end screen shows the stacked bonuses (a
  gold *Final Win* pill).
- **Hand + HUD refinements** — a bit more room between the fanned cards; the distracting magnified hover preview
  is gone — **hovering now pops the card itself up** to reveal its full text; **grabbing a card no longer
  jiggles the hand** (the fan measured its own rotated rects instead of flatten-then-re-fanning); and the
  **run-buffs window moved to the top-left**, under the round plaque.
- **Board art, a hand fan, and Practice parity** — a new **16:9 board** (`board2c`); the **hand now fans**
  (each card tilts by its position and pivots near its centre, so it reads as a fan while staying compact, and
  it stays fanned through a drag while the reorder measures the cards' rects directly so hit-testing stays
  exact); and **Practice now mirrors the Ascent course** — same 17-round HUD (round track, Line, record), the
  only differences being invulnerability (the `Max −X` row is hidden) and the ×3 clock. Also fixed a
  **targeted-spell ghost card** that could strand in the top-left corner when you aimed then dragged off.
- **Hand + HUD polish** — hand **spells now show their Tier pill** (matching minions and the shop), and the
  card pills/outlines are no longer clipped. The **hero frame is a compact 2×2 grid** (portrait + name up top,
  power button + Resolve below — 591×119 → 232×166, mirroring the opponent frame), so a full **10-card hand
  clears it** in the corner (helped by a deeper card overlap). The round progress bar becomes a **per-round
  dash track** — green ✓ win, red ✕ loss, muted dash draw, lit-orange current round, faint dash upcoming.
- **Damage numbers on the attacked unit, centred on the card** — in a combat clash the number used to pop as
  a `-N` in the corner over both fighters; now only the unit being **attacked** shows it, centred on the card
  face (reads as the hit landing on the minion) and without the minus sign.
- **Combat-feel DEV tuners** — two new panels in the 🛠️ Dev Tuning Menu: **⏱️ Pacing** (the combat beat
  clock — global tempo + per-beat holds + float lifetimes, previously hardcoded) and **🔢 Damage Float** (the
  `-N` number's size / pop / rise / entry). Both default to the current shipped values, so nothing changes
  until a slider moves; dial by eye, then paste the Copy'd values back as the defaults. Also fixed three
  broken tuner sliders (Lunge, Drag, Shield — blank labels / a type error).
- **HUD restyle to the mockup** — the shop controls regroup into one segmented **stat strip** (Gold · Tier ·
  Setup Time) over a gold-edged **control tray** (Upgrade Tavern · Reroll · Freeze · End Turn) with warmer
  tan-gold buttons; the redundant right-edge End Turn is gone. The controls sit in a fixed-height block that
  matches the combat footprint exactly (rows never shift between shop and combat), and on tall windows the
  **warband sits under the board's centre line** (a layout offset combat animations don't fight).
- **Review-driven correctness batch** — a full code + gameplay review ([docs/code-review-2026-07-03.md](docs/code-review-2026-07-03.md))
  and its correctness fixes: 0-damage hits no longer pop Ward, enemy Start-of-Combat effects fire, on-kill
  procs on every kill in a clash, the Reclaimer's resummon keeps its progression, and **aura battlecries
  re-fired by Ryme (Deathswarmer) now stick permanently**. Saves heal by construction (old saves stop
  crashing); the reducer stops cloning on rejected clicks; the headless `bot` no longer stalls. Plus three
  owner-reported UI bugs: the **warband no longer jumps** between shop and combat, **selling no longer janks**
  the board (symmetric card glide), and the defeat blast aims at the HP box.
- **Combat exchange rules + card batch** — attacks resolve as one simultaneous clash (dealt + taken damage land
  in the same frame; deathrattles only after), a full board now blocks a Rise, and golden Rise bodies return at
  1 HP. New minion **Mumi** (give a friendly Undead Rise — now visibly, via a new keyword event) plus a batch of
  card changes (Sporeling procs on every Battlecry, Heckbinder's live Fodder aura, gilded Manasaber cubs, …).
  **Flowing Monk** reworked (+2/+2 per overflow, improves every 5; a triple combines the two best copies'
  grants) — and scaling cards now ALWAYS print their current value, everywhere (a CLAUDE.md rule).
- **HUD redesign** — the shop controls are a labelled row of gold plaque buttons (Gold · Tavern · Reroll ·
  Freeze) with the turn timer above them; End Turn is a standalone button on the right; the next-opponent frame
  sits in the top-right corner; the player name is a small box above the hero panel; hand cards seat lower and
  pop up on hover. Removed the ASCENT wordmark, the Tribes strip, the mute button (now in Esc), and the burn-rope.
- **Recruit HUD + drag polish** — play a minion by releasing it anywhere in the board area (a play floor lets you
  cancel back to the hand), with a soft gold "will play" glow on the card; Gold moved into its own box at the
  left of the shop controls (opposite End Turn), health is now a compact box by the hero power (bar removed), and
  a lot of drag clutter (labels, drop-boxes, the empty hint) is gone. The 21:9 board is now **board2upscaled2**.
- **Card motion trails + Dev Tuning Menu** — dragging a card or watching an attack lunge now trails a soft
  wind-whoosh wisp (gold for divine-shield); the six separate floating DEV tuner buttons + the Test FX
  button are consolidated into one 🛠️ Dev Tuning Menu.
- **New play backdrops** — the in-game board art is refreshed to a bright castle-in-the-clouds vista, shipped
  as optimized WebP and picked by aspect: **board2b** on 16:9 (the default) and the wider **board2** on 21:9
  (ultrawide resolution or a fit window that's actually ultrawide).
- **Reorder-slide fix** — dragging a card to a new slot (warband **or** shop) no longer replays the swap after
  you drop it; the card settles in place while its neighbours glide, on both slow drags and quick flicks.
- **Rating system** — your **Line** (the scored wins a run must cover) is now set by a persistent **rating**;
  finishing a scored run moves the rating by how you did vs. the Line (+ a summit bonus), shown on the end
  screen and Career. New players start at **1200 / Line 9**. Matchmaking is unaffected (rating is expectation,
  not difficulty). Built local-first, structured for a later move to Supabase-backed accounts.
- **Board art + dimming** — the game uses **board1** as its illustrated backdrop, with a **Board dimming**
  slider in Settings to tune the readability scrim (default 15%, persisted per-browser). (The earlier
  multi-board selector was a testing aid and has been retired now that the art is chosen.)
- **Looping menu video** — the title screen plays a muted, looping ambience video behind the menu (falls
  back to the `homescreen.webp` still when absent or under reduced-motion).
- **Career page redesign** — a stats bar (runs · best run · avg wins · win rate) over three columns: a
  **Profile Card** (avatar · name · "Unranked" placeholder), the **Recent Match History** (click-to-expand
  cards with stats + final warband), and an **Insights** rail (favorite hero / tribe / mechanic · win rate ·
  streak).
- **Combat-contribution tracking** — the post-run summary now names your **MVP minion** (most damage dealt)
  and **most-triggered mechanic**, and the Career screen shows your **favorite mechanic**. Damage is
  attributed from the combat log (retaliation-aware), with no change to the pure `simulate()`.
- **Taragosa → Tier 6**, Thundering Abomination → **Cratering Hulk**, plus new art for Sergeant and Cratering Hulk.
- **More tuning + a new Mech.** Twilight Whelp → **Violet Whelp**; Spirit Pup 6/6, Mama Bear 5/5, Tara 5/6,
  Spirit Worgen +3/+3 per summon; Commander Impala now 6/6 with **Windfury** and a +3/+3 on-kill buff. New
  **Mechanical Jouster** (Mech T4 — Rally: get a random Magnetic Mech). Fresh art for Supporter, Guardian Drake,
  Violet Whelp, Taragosa, Spirit Worgen, and the Jouster.
- **Balance + content batch.** A broad tuning pass (stat tweaks across every tribe), 6 renames (Bronze Warden →
  Guardian Drake, Stuntdrake → Obsidian Drake, Spare Part Drone → Warding Drone, Deathless Hand → Footman Leader,
  Ghastly Bladesmith → Ghostsmith, Taurus the Ancient → Taurus), 3 cuts (Demonic Anomaly, Echo Warden, Cupcakes),
  and reworks: **Acid** (spend 7 Gold → buff Fodder/Imps), **Banksly** (new Mech — spend 10 Gold → magnetize),
  **Commander Impala** (new Demon — on-kill buff Fodder/Imps), **Target Dummy** (gains Attack when hit), **Taurus**
  (engraves both neighbors; golden doubles their combat gains), **Thundering Abomination**, **Lantern Light**
  (now scales with spell power) and **Consume** (creates & eats a Fodder). Compendium now shows evolution units
  (Spirit Worgen, Taragosa) and keeps the themed cursor on the scrollbar + right-click inspect.
- **Sheldon removed.** The tier-3 Divine-Shield Magnetic mech was cut from the card set; the remaining Magnetic
  mechs (Cling, Money Bot, Speedy, Harry Botter, Better Bot) are unchanged.
- **Compendium (Tab / title button).** A blurred-overlay reference of minions + spells — the whole card set
  from the title screen, or scoped to your run once playing. Tier filters across the top, tribe/Spells filters
  down the left (both multi-select), a single scrolling 6-wide gallery. Right-click any card for the full inspect.
- **Auras.** Run-wide buffs (Undead Aura, Fodder Aura, Imp Aura, Eternal Knight Aura) now apply *everywhere* —
  warband, shop, and every combat body including summons, Reborns, and Soren's resummons (which previously shed
  them). New auras are a one-line registry entry.
- **Minion Book (Tab).** A new blurred-overlay bestiary of every minion + spell findable this run — tier
  filters across the top, tribe/Spells filters down the left (both multi-select), a paged card gallery you flip
  through. Right-click any card for the full inspect.
- **Opponent intel + Discover refactor.** The next-opponent badge now shows wins + tavern tier right in the
  thumbnail (alongside name, hero, life), with the gauntlet cursor on hover. Under the hood, Discover spells
  (Sprout, Help Wanted, Tribe Portal, Corpse Board, Triple Reward) are now driven by a data-only
  `discoverOnPlay` card field instead of hardcoded card-ids in the reducer.
- **Leaderboard buff breakdown.** Right-clicking a champion's minion in the Hall of Champions now shows how it
  was buffed (Spirit Fire ×2, Golden Touch, …) in the inspect panel — for boards captured from here on.
- **Opponents: real player boards, random.** You now face real player boards whenever any exist for your wave
  — the live Supabase shared pool first, then your local/friend boards, then the synthetic floor — picked at
  random (no power-matching) within the highest available tier.
- **Taunt bulwark.** Taunt minions now sit behind a silver-metal heater shield (rendered *behind* the card,
  peeking out around the edges) that deploys with a thwap + a light smoke plume and a "thunk" sound. The old
  corner Taunt badge is retired (the aura signifies it now); a DEV tuner lets the shield's shape/tint/size be
  dialed in live.
- **Fix: tavern consumes use the buffed value.** Acid, the Consume / Cupcakes spells, and Demons eating
  Fodder now feed the consumer a tavern minion's CURRENT stats (run buff + per-offer buff + golden + held),
  not its base — a consumed minion is worth exactly what it'd be if bought.
- **Fix: Eternal Knight Reborn keeps its stacks.** A Reborning Eternal Knight no longer sheds its accrued
  run-wide enchant — a 5-stack Knight that dies returns at 6 stacks instead of dropping back to 1.
- **Balance: Displacement / Displace can't target goldens.** The Displacement spell and Darah's Displace power
  no longer accept a golden (triple) minion — you can't trade away a triple for a random tavern minion.
- **Wave stakes in the top bar.** Under the WAVE meter, a small "♥ Max −N" line shows the most Resolve a loss
  this wave can cost (the round damage cap) — so you can read the downside before a fight. Hidden in Practice.
- **Right-click buff tracking in combat.** The inspect panel now itemizes a combat unit's per-source buff
  breakdown — the recruit buffs it carried into the fight (Spirit Fire, triples, Battlecries) plus the buffs
  it gains mid-combat (Crypt Drake, auras, Rally), merged by source — matching the shop's right-click panel.
- **Leaderboard — Hall of Champions.** A title-screen button opens a full, scrollable page of the latest 20
  victory runs, each champion shown with their final winning warband (hover a card for its full text).
- **Live shared opponent pool (Supabase).** Finished runs auto-sync to a hosted database and load back at
  startup, so you + a friend face each other's builds with no manual export/import (the Settings "Shared Boards"
  buttons are gone). Fully optional — the game still runs offline off the committed pool.
- **Opponent boards are now synthesized for all 20 waves.** Retired the house bot (it only reached ~wave 9):
  `npm run pool` now generates 8 boards/wave straight from the card set, banded to the tuned enemy curve, with
  a full weak→strong spread at every wave — so late-game fights no longer fall off. Imported player/friend
  boards still fold in (and win matchmaking slots over synthetic ones).
- **Title screen → modes.** The game boots into a title with **Ascent** (the scored climb) and **Practice**
  (any hero, unlimited health, 3× clock, ends after 15 rounds), plus a Settings button.
- **Displacement preserves your minion.** Swapping a minion to the tavern now keeps all its buffs and
  progression — re-buy it and it returns intact (and swapped-in Battlecries don't fire).
- **Chaos Attachment flies in from the portrait.** When the Chaos hero power grants its token, it now
  animates in from the hero portrait.
- **Spell Cart (T5).** Refresh the tavern full of spells instead of minions (one-shot — the next roll
  restocks minions).
- **Steward of Spells (neutral T5).** End of Turn: get a copy of the most recent spell you cast (golden: 2).
- **New hero Darah + Displacement spell.** Both swap a friendly minion with a random tavern minion — Darah's
  hero power (Displace, once per turn) and a T4 spell.
- **Acid reworked; Voracious Imp removed.** Acid now triggers every 3 refreshes — consuming a tavern minion
  and giving the rest +1/+1 (golden doubles both).
- **Golden Touch + Consume spells; Point Solution renamed to Resonance.** Golden Touch gilds a random tavern
  minion (it buys in Golden, doubled); Consume has a Demon devour a random tavern minion (works with Yazzus).
- **Four new tavern spells.** Lantern Light (+Tier/+Tier), Fodder Treatment (sell a minion into your left-most
  Demon), Point Solution (re-trigger a Battlecry), Chrono Staff (End-of-Turn effects fire one extra time). Tara
  moved to Tier 4.
- **Hero "Symbiote" is now "Chaos."** Renamed the hero and his hero-power token ("Chaos Attachment"), with a
  new portrait. Old saves and baked opponents resolve through a legacy id alias.
- **Scaling cards show their current value in combat.** Mama Bear's per-summon grant ticks up live as Beasts
  are summoned; Grim, Archmagus Guel, and Spirit Worgen now read their live run-scaled magnitude on the combat
  card too (Deathrattle tally / spells cast), instead of the printed rule text.
- **Captured opponents keep their progress.** A board served as an enemy now retains its minions' accrued state
  — Sergeant's improved Deathrattle HP-grant and Tara's ascend progress — so it fights as strong as the board it
  was snapshotted from (it used to drop those). New captures only.
- **No more phantom Start-of-Combat "scorch."** Spell power gained mid-fight (Ryme re-firing Cinderwing,
  Gnasher's kills, Bladesmith deaths) used to fling a projectile bolt + zap at an enemy — the UI replayed the
  "+spell power" telegraph as a Start-of-Combat attack. Now only genuine Start-of-Combat *damage* casts do that.
- **New hero: Robin.** Passive power **Spoils** — when you sell a minion, gain 1 Gold at the start of next
  turn. It stacks (sell 6 → +6 next turn, on top of the cap) but resets each turn. Portrait + power art wired.
- **Ascension begins mid-fight (engine).** Tara now transforms into Taragosa **during** combat the moment her
  stat-grants cross 20 (was only between fights), and Taragosa's Growth fires the rest of that fight. The new
  `ascend` event is wired for an upcoming sound + animation; Spirit Pup → Spirit Worgen is next.
- **In-combat spells feed live.** Spell power gained mid-fight (Gnasher's kills) now boosts **Taragosa's
  Growth** the same fight, and **Forsaken Weaver** procs **permanently** off spells cast in combat (its +Atk to
  Undead now carries back, like its shop version) — both off Taragosa's Growth casts.
- **Reborn cleanup.** A Reborn unit now fires its Deathrattle on **every** death (a Twilight Whelp + Reborn
  leaves a 3/3 Whelp on each death, not just the last), and carries its **Undead** buffs through rebirth — an
  Eternal Knight reborns at base + its own +3/+2 enchant (→ 6/4), and keeps the Undead-everywhere bonus too.
  General / Imp / Fodder buffs still reset to base.
- **Smoother magnetize + roomier hand.** The electric crackle on a magnetizing Mech now rides an opacity-only
  glow layer instead of repainting the card every frame (magnetizing felt choppy). And cards in hand sit **20%
  farther apart**, so the right one is easier to click.
- **Tara no longer fires a phantom Start-of-Combat "scorch."** Buffing Tara mid-combat (e.g. Supporter's
  Rally) used to emit a per-grant narration that the UI replayed as a Start-of-Combat cast — zap sound + a
  bolt to an enemy — reading like the long-gone Ember Whelp. The ascend tally now tracks silently; the live
  "N to ascend" countdown and ascension are unchanged.
- **Board synthesis — "print" strong high-wave opponents.** The bot can't build strong high-wave boards, so
  those waves were thin + all-strong-looking. `npm run pool` now folds **real captured boards into the rating
  ladder** (a real ceiling) and **synthesizes** new boards — recombine/mutate a real board, then keep it only
  if `simulate` says it's competitive — to fill thin waves. The pool's bands went from a `b7` black hole to an
  even spread, every wave 1–20 now spanning weak→strong with a full count. See [docs/board-pool.md](docs/board-pool.md).
- **Symbiote's attachment grants Reborn.** The Symbiotic Attachment (Symbiote's Magnetic token) is now
  **Magnetic + Reborn** — magnetizing it onto a minion gives that minion Reborn (it comes back once on death).
- **Wave-relative board power banding + pool maintenance.** Enemy boards are now rated by how strong they are
  **for their wave** (win-rate vs a per-wave bot-calibrated ladder) instead of one fixed gauntlet that saturated
  by mid-game. Boards carry a **patch** stamp; `npm run pool:prune` clears stale boards by date/patch; the
  re-bake drops trivially-weak boards + reports per-wave band coverage. See [docs/board-pool.md](docs/board-pool.md).
- **Discover no longer favors high tiers.** Card-driven Discovers (Sea Urchin, Help Wanted) now weigh **every
  eligible minion up to your tavern tier evenly** — matching the flattened shop — instead of filling from the
  top tier down. The golden/triple "peek one tier up" reward is unchanged (it's meant to bias high).
- **Loss-damage blast.** Losing a round now shows the math: surviving enemy tiers + the opponent's tier
  fly up into a damage counter (capped), then blast your Resolve bar with a Pixi impact + shake.
- **Summon beat.** A battlecry-summoned token (e.g. Alleycat → Stray) now pops in ~0.2s *after* its
  trigger-medallion pulse, so you read the pulse then the result instead of both at once.
- **Discover burst.** Opening a Discover erupts a burst of golden, white-hot magic + sparkles from center
  that shoots off the page edges — rendered behind the cards, over the dimmed board.
- **Trigger-medallion pulse.** When a unit's effect fires (combat *or* shop — Start-of-Combat, Deathrattle,
  Battlecry, aura, Avenge…), its centre medallion flares then releases a slow ring of energy with a sound,
  so you can see which unit acted. Multi-turn cadence cards (e.g. Frontdrake) just *glow* as they tick and
  *pulse* on the turn they pay off. (Simultaneous pulses share one sound.)
- **Ryme re-fires every Battlecry + magnetize triggers summon-buffs.** **Ryme** now re-fires *economy*
  Battlecries too (Soulfeeder's Fodder, Hoarder's Gold, …) — they replay through their real recruit factory at
  settle, so the synergy actually pays out. And **magnetizing** a minion onto a host now fires summon-buffs on
  it first (a Symbiotic Attachment counts as a Beast → Mama Bear's +X/+X lands, then welds onto the host).
- **Buffs window ticks up live in combat.** Spell power and max Gold now **climb in the Buffs window as the
  fight plays** (folded from the per-beat combat telegraphs, in sync with the replay), instead of only updating
  when the shop reopens. The redundant "Your spells get +X/+Y" hero-tooltip line is gone — the window owns it.
- **Buffs-window fixes + opponent frame stays put in combat.** The Buffs window now lists **Eternal Knight**
  enchants, **totals every Mama Bear** on board (not just the first), and shows the **real Max Gold gained**
  (was off by the natural per-wave curve). The next-enemy frame now stays **pinned top-right during combat**
  (no more jumping to a left-side banner), with a normal cursor.
- **Generated cards show the real card mid-combat.** A card generated in combat (Sporebat, Ryme re-firing Sea
  Urchin / Black Belt Brian) is now **picked during the fight** and flies to your hand as the actual card
  (`toHand`), instead of resolving invisibly at settle — wiring the specific-card-grant tech for future events.
- **Combat feedback telegraphs.** Effects that used to apply silently until the shop now show **during** the
  fight: **spell-power gains** ("+A/+B Spell Power") and **generated cards** ("Generated a spell/minion") emit a
  Start-of-Combat-style narration from the minion that caused them. Taragosa's combat text reflects spell power.
- **Run-buffs window + Symbiote timing.** A collapsible **Buffs** window (top-right, under the next-enemy frame)
  surfaces your active permanent buffs at a glance — spell power, Undead-everywhere, Fodder, Imps, Mama Bear,
  Guel. **Symbiote** now grants its token at the **start of every 5th turn** (was end of every 4).
- **Dust puff on board placement.** Placing or moving a minion on the board kicks up a ring of dry-dirt
  dust that escapes out from under the card on every side — like a flat stone dropped in dust.
- **Gold-coin sprinkle on sell.** Selling a minion now bursts a sprinkle of gold coins out of the Gold
  counter (they pop up and arc back down under gravity) — on the new Pixi FX layer.
- **Golden card tooltips show their LIVE value.** Golden cards were rendering the *static* printed golden text,
  so live numbers were lost — a golden **Sergeant** showed "+4 Health" instead of its real "+10", a golden
  **Taragosa** "+6/+8" instead of its spell-power-scaled value. Fixed generally for every golden live-text card.
- **Taragosa spell-power scaling + combat-log bar.** **Taragosa**'s Growth now scales with your **spell power**
  (text + mechanically, golden too). The combat-log **odds bar** is **4× thicker**, coloured **green/orange/red**,
  and its segments now map to the real win/draw/loss odds.
- **Re-fired Discover battlecries + Cinderwing via Ryme + Tara/Fleeting Vigor fixes.** When **Ryme** re-fires a
  Discover battlecry in combat (**Sea Urchin**, **Black Belt Brian**) it now grants a **random card from that
  pool** (tavern-tier rules) instead of nothing, and re-fires **Cinderwing**'s +spell power. **Tara**: tripling
  keeps the highest ascend progress (no reset), and its in-combat tracker now matches the shop. **Fleeting
  Vigor** is telegraphed with a Start-of-Combat banner (it always worked — it just looked like nothing).
- **Combat speed slider + triple-at-shop-start + Bane Fodder carry-back.** A **0.5×–5× Speed** slider in the
  combat bar (persisted) scales the whole replay. Triples are now also checked **as the shop opens**, so a
  combat-granted 3rd copy combines without waiting for your next buy. And **Bane**'s Fodder buff earned *in
  combat* (via Ryme) now persists **run-wide**, like its Imp buff already did.
- **WebGL effects layer (PixiJS) + combat hit-impact.** Added a transparent **PixiJS v8** overlay over
  the board (pooled-particle system, no DOM/layout changes) and wired it to combat: each hit now bursts a
  white-hot core flash, a saturated-orange shockwave, **jagged shards** (oriented along their travel), and
  rising **smoke puffs**, fired on the lunge's contact frame. It's the additive foundation for an eventual
  Pixi combat arena (effects → sprites → arena, each step shippable).
- **Ryme combo chain + Hunter shop proc + Target Dummy 0/6.** Ryme's Deathrattle now genuinely **triggers**
  each adjacent Battlecry (with a proc narration), and a **Drakko** on board doubles each trigger — which
  **multiplies** with Sylus / Deathsayer and re-procs **Karwind**/**Bane** per trigger (golden Ryme + both
  neighbours + Drakko = **4 triggers**). **Hunter** now fires from **every shop Attack gain** (Fortify,
  Growth, Spirit Fire, Karwind, weld, end-of-turn) — not just combat. Target Dummy is now **0/6**.
- **Ryme (T4 Undead).** **Deathrattle: trigger an adjacent minion's Battlecry** (golden: both). Adds a
  combat Battlecry-replay so summon / tribe-buff / grant-keyword battlecries re-fire mid-fight (economy
  battlecries no-op).
- **Imp archetype + content batch.** Hero select now offers **3** champions. New **Imp** sub-theme: **Fodder
  Feeder** (T1 — sell it for a Fodder + an Imp buff) and **Imp King** (T4 — Deathrattle: 2 Imps + buff your
  Imps); **Brood Matron**, **Ritualist**, and **Bane** now feed/buff Imps too. Tuning: **Karwind** → T5,
  **Mama Bear** → +2/+2 (improving +2/+2), **Hoarder** reworked (Battlecry: +1 Gold next turn; sells for 2),
  **Demonic Anomaly** new art.
- **Live-text audit + Soulsman metric.** Audited every card's tooltip for live/current values. **Soulsman**
  now shows a running **"Gained X Gold this run"** total; **Deathswarmer / Forsaken Weaver / Karthus** show the
  current **+Attack new Undead inherit**; **Eternal Knight** shows its accrued run-wide enchant. Fixed a golden
  **Voracious Imp** mislabeling its multiplier (it eats at **3×**, not 2×).
- **Discover/conjure + Symbiote triple fixes.** The Undead "+Attack wherever they are" (Deathswarmer /
  Forsaken Weaver / Karthus) now reaches **Discovered and conjured** Undead too — not just tavern buys.
  And the **Symbiote** hero power now **triples** its token the moment the 3rd is granted, instead of waiting
  for your next buy.
- **Per-card voicelines/SFX + summon audio.** A card can have its own sound that plays when it's played, layered
  over the general landing sound — drop `packages/ui/src/audio/cards/<cardId>.mp3` (zero code per card). Summons
  now play a cue too (general summon SFX + the summoned token's own clip), in both recruit and combat.
- **Sourced End Turn sound.** Hitting End Turn (Face the Omen) now plays a real audio clip instead of the synth
  down-slide, tunable in the DEV SFX mixer.
- **Sergeant fix.** Sergeant's Deathrattle now improves on **every** Attack-gain — in the shop too (each
  Forsaken Weaver, Deathswarmer, Karthus, Fortify, etc. counts as its own improvement) — and the bonus is
  now **permanent** across fights (carried back from combat). The card shows the live grant in the shop and
  in combat. Two Forsaken Weavers + a spell now improve it twice, as intended.
- **Demonic Anomaly + Abhorrent Horror tweaks.** **Demonic Anomaly** now buffs **all** tavern minions
  **+3/+3 permanently** (current and future offers, like Staff of Guel) instead of only the current set.
  **Abhorrent Horror** now previews its pending Start-of-Combat gain live in the shop — "+X/+Y next combat"
  (green), climbing in real time as you consume Fodder this turn.
- **Symbiote art + universalTribe fix.** Wired Symbiote's hero portrait + hero-power art. Fixed the
  Symbiote token (**Symbiotic Attachment**, "counts as every tribe") being skipped by most recruit-phase
  tribe buffs — playing it now correctly triggers Mama Bear, Kennelmaster, Dragon battlecries, etc. Audited
  every tribe check in the recruit + combat effect systems; several also ignored a card's **second tribe**
  (dual-types), fixed in the same pass. New regression test. Also: the Undead "+Attack wherever they are"
  (Deathswarmer / Forsaken Weaver / Karthus) now shows on **tavern** Undead offers too, so the Attack no
  longer jumps when you buy them.
- **Sourced refresh sound.** The tavern Refresh/Reroll button now plays a real audio clip (the last tavern
  control still on a synth blip), tunable in the DEV SFX mixer.
- **Bug fixes + 3 new Undead + live combat text + 18 art.** Shop weights flattened (equal chance for
  all tiers); Spell Discover now tier-gated; `onKill` bus fires for all kills. New cards: **Karthus**
  (T5 8/8 DS; on-kill +3 Atk to all Undead permanently), **Deathless Hand** (T3; DR: summon a
  **Footman** — 1/1 Reborn token). Renames: Skullblade → **Ghastly Bladesmith**, Grave Knit →
  **Eternal Knight**. **Tara** ascend procs now appear in the combat log. Combat live card text for
  Tara (countdown), Sergeant (improving HP grant), and Thundering Abomination (EG gains). 18 art files.
- **Symbiote hero + 9 new minions.** New hero: **Symbiote** — starts with a 1/1 Magnetic token (**Symbiotic
  Attachment**) in hand and gets another every 4 turns. The token has `universalTribe` — it counts as every
  tribe and magnetizes onto any non-neutral minion. 4 new Demons: **Acid** (every 4 refreshes, eat a tavern
  minion for its stats), **Trickster** (DR: give a random friend its max-Health), **Demonic Anomaly** (BC: 2
  free rolls + buff tavern +3/+3), **Abhorrent Horror** (SoC: gain all fodder consumed this turn as stats). 5
  new Undead: **Deathswarmer** (BC: +1 Atk to your Undead everywhere + stacks the buy-time bonus),
  **Pillager** (DR: get a Gold Pouch), **Thundering Abomination** (gains +3/+3 per summon; overflow summons
  buff Undead +2/+2), **Sergeant** (DR: +2 HP to all friends, improves each time it gains Atk), **Forsaken
  Weaver** (each spell you cast gives your Undead +2 Atk). New engine primitives: `universalTribe`,
  `undeadBuyAtk` (permanent undead buy-time bonus), `onRoll` event, `fodderConsumedThisTurn`.
- **Dragon bug-fix pass.** Crypt Drake's text now updates live in combat (current grant highlighted + countdown
  to next step-up). Twilight Whelp's whelps now spawn **sequentially** — each attacks before the next can enter,
  so a full board doesn't block the second if the first one dies. Broodmother's whelps show the **Taunt emblem**
  from their first frame (keyword is now baked into the summon snapshot). Golden Stuntdrake now **procs twice**,
  picking 2 targets independently each time.
- **Spells cast in combat now trigger Guel.** Taragosa's Growth is a real spell cast — it fires **Archmagus
  Guel** mid-fight (a temporary buff) and **permanently** counts toward his improvement (combat casts bump the
  run's spell tally). Combat gained a real `castSpell` path for this.
- **Nanon (T6 Mech).** Deathrattle floods 6 Nanobots; every one that can't fit a full board instead pumps your
  Mechs **+2/+2** (golden +4/+4) — a packed board turns the overflow into a board-wide buff. Nanobot is a 1/1 token.
- **Batch fixes + hero-power art.** Wired **8 hero-power button arts** + rewired Cling/Stuntdrake/Sea Urchin.
  **Hoarder** → T2 2/2; **Sea Urchin** can’t Discover itself; **Gryphon**’s free refresh is now per-hit (cap 4);
  **Frontdrake** plays nice with Djinn (no cadence skip, but works on the proc turn), shows a live
  “End of this turn.” countdown, and keeps its timing through a triple; **Mama Bear** triple no longer
  resets/doubles its accrual. Card-text pass so the live values read true.
- **Tara → Taragosa** — a quest dragon (Engraved) that **ascends to Taragosa** after being granted stats 20
  times in combat; **Taragosa** casts **Growth** (+3/+4 to your board) on every attack. Completes the batch.
- **Cupcakes** — a spell that points a friendly **Demon** at the tavern: it consumes 3 random minions there
  (real Consume — stats × the Demon's multiplier + its on-consume effects).
- **Twilight Whelp line + an attack-on-summon mechanic.** **Twilight Whelp** (Deathrattle: a 3/3 Whelp that
  attacks immediately, out of turn order) replaces Ember Whelp; **Twilight Broodmother** (Deathrattle: 2 Taunt
  Twilight Whelps that chain into Whelps). New `attackOnSummon` combat primitive.
- **Content batch — +5 minions, +1 token, +5 spells.** Beasts: Manasaber, Raptor, Sea Urchin (+ a Saber Cub
  token). Spells: Tribe Portal, Corpse Board, Perfect Vision, Fleeting Vigor, Apples. Reactive Dragons: Hunter
  + Crypt Drake (a new `onGainAttack` trigger — they combo, one pumps Attack, the other answers with Health).
  Beast pool 7→10, Dragon 10→12, spells 19→24.
- **Lunge feel retune.** New shipped attack-lunge defaults — a longer, heavier wind-up driving a deeper lunge,
  a springier settle, and a shorter breather between swings. The damage number/recoil is kept landing on the
  lunge's contact frame (the result-beat schedule was moved to match the slower swing).
- **+4 Dragons (pool 6 → 10).** **Frontdrake** (every 3 turns, get a random Dragon — with a live "next in N
  turns" countdown on the card), **Supporter** (Rally: pump 2 friendly Dragons), **Bronze Warden** (a
  Divine-Shield wall), and **Stuntdrake** (Avenge 3: hand its Attack to 2 friends). New effect primitives for
  the cadence grant, tribe-filtered Rally, and the Avenge attack-gift; all four have art.
- **Feel + HUD pass.** The Hero-Power targeting line now draws from the power button; Bane's Fodder enchant
  shows a purple haze under the card; the attack lunge got a tuning pass (smack a touch earlier, snappier
  strike, a bit further) — with a **DEV lunge tuner** to dial it by feel. The player name moved to its own
  pill below the Ascent/Wave boxes, and the dev SFX mixer joined a bottom-right tool cluster by the gear.
- **Art preloads (no more pop-in) + three proc fixes.** All card/hero art now warms on idle at the title
  screen, so cards render with art already cached (no cold-load "pop-in", incl. the itch CDN — 157 webps
  preloaded). **Soulsman**'s Avenge → max-Gold now shows in combat (gold pulse + float + sound + Procs line);
  **Bane** flashes when it enchants Fodder; the **Fodder consume swirl** retries until the tavern is on screen
  so it never silently drops.
- **More sourced audio + safer board sharing.** The Tavern Up button now plays a real `tavernupgrade` clip
  (14 logical sourced sounds / 17 mp3s wired). **Export my boards** is hardened for itch's sandboxed iframe
  (reliable download + a fullscreen hint when downloads are blocked); a friend imports the file from any
  context. The full audio map (current + still-needed sounds) lives in [docs/sfx-events.md](docs/sfx-events.md).
- **Real opponent boards ship with the game.** `npm run pool` bakes a curated, committed pool of real
  buildable boards (house bot boards + any board exports you/friends drop in `docs/board-exports/`), loaded at
  startup — instead of procedural blobs. Boards now carry **attribution** (`origin` + author name + date): set
  your name in Settings → Player, and boards you build get captured "by you"; the opponent frame shows who made
  the board you're about to fight. Foundation for the you → friends → computer-built (power-banded) opponent pool.
- **Performance pass (the north star).** Fixed the frame drops on magnetic-heavy boards — the keyword glows
  (Divine Shield / Reborn / Venom / triple) were animating `box-shadow`, repainting every card every frame;
  they now pulse an opacity-only layer (compositor-only). The **round timer no longer re-renders the whole
  board every second** (it lived in component state; moved to an external clock so only the timer ring/rope
  update) — measured: a full late-game board went from periodic ~12ms spikes to a flat 4ms/frame. Plus a
  memoized combat unit, no more deep-cloning the combat log each click, and a drag-reflow fix. New
  **`npm run perf`** harness + [docs/performance.md](docs/performance.md) to catch regressions. Performance is
  now a stated project north star.
- **Win the run by winning 15 combats** (not by reaching wave 15) — a loss costs Resolve but the climb
  continues, so a non-perfect run keeps going until it banks 15 wins or runs out of Resolve.
- **Front to Back** now shows its per-cast improvement scaling with spell power too (e.g. "+3/+3. Improve this
  by +3/+3" at +1 spell power).
- **Smack on contact + a volume slider.** The combat impact now sounds off **exactly when the attacker
  connects** — it's fired from the attack lunge's animation timeline (frame-accurate) instead of the beat
  clock, which had it trailing the visual. The lunge also overdrives further into the target. Settings → Audio
  now has a **master-volume slider** + mute (persisted, scales every sound); the combat smack and sell clips
  were dialed down.
- **First sourced sound effects.** Real audio clips now play for **selling a minion** (one of four at random)
  and the **combat impact** (a "smack"), via a Web-Audio sample player (synth blips remain the fallback).
- **Combat feel + hero-power UI.** Attacks are punchier (longer wind-up, faster strike); the hero-power button
  is bigger and the hero frame's golden outline is gone (the button is the highlight now), with a hero-power
  art pipeline ready (`art/powers/`). Hovering the hero shows your current spell buff. Fixed a cosmetic Cassen
  counter double-count on the End-Combat screen. Plus a full SFX/animation inventory in
  [docs/sfx-events.md](docs/sfx-events.md) for sourcing audio.
- **Bug fixes + a codebase audit.** Rally now fires **per hit** (a Windfury body rallies twice); Cling Drones show
  their accumulated bonus on the card; and a Demon eating Fodder now floats its **+X/+X** like other buffs. Plus a
  6-agent audit drove a cleanup pass: deleted dead files/assets (**−87 KB** off the web build), trimmed dead events
  + data, and cut ~600k throwaway allocations per End-Turn from the combat hot path (non-allocating loop counts,
  memoized derivations) — combat stays byte-identical (determinism tests green).
- **Live tooltips + readable buffs.** Scaling minions now show live progress on the card — **Archmagus Guel**
  reads his current grant and the countdown to his next step. Recruit-phase buffs **float the +X/+X** above the
  minion just like combat, and a **Combinator** weld is credited to the magnetic it attached ("Harry Botter ×2"),
  not to Combinator. Small fix: the hero-power button keeps the game cursor when it's on cooldown.
- **Magnetic mechs, scaling Guel, a win counter + tweaks.** Sheldon, Speedy, and Harry Botter are now
  **Magnetic** (they weld their Divine Shield / Windfury / spell aura onto a host Mech), and welded
  attachments — Better Bot's Rally, Money Bot's income, Harry Botter's aura — now **survive a triple**.
  **Archmagus Guel** scales: his buff grows **+1/+1 per 4 spells cast** (golden +2/+2). The HUD now shows a
  **win counter**, the **hero power fires only from its button** (not the whole frame), and Spirit Worgen +
  Archmagus Guel got new art.
- **Fixed the End-Turn freeze + a content batch.** The real cause of the late-game "froze on End of Turn":
  a board captured by an older build (with the since-removed **Corrupted Lifebinder**) loaded out of
  localStorage into the opponent pool and crashed combat when served — the throw stranded the turn in recruit.
  The pool now drops boards referencing removed cards on load, and `faceOmen` falls back to the procedural
  enemy on any serve failure, so End Turn can never hard-lock on a bad opponent. Also: **6 new minions**
  (Better Bot, Sheldon, Speedy, Harry Botter, Burial Imp, Soulsman), Gnasher reworked (attacks again on kill
  + permanently buffs your spells), Maw of the Pit → Tier 3, and **Combinator** now magnetizes a *random*
  Magnetic Mech each turn. **Mana is now Gold** everywhere (names, text, a gold coin icon). The hero power is
  now a button on the right of the hero frame.
- **Balance patch v1.** Yazzus now only doubles **targeted** spells (not economy/Discover); **Corrupted
  Lifebinder** removed along with its linked-mirror system; the run is now a **15-round** win (a perfect run
  wins all 15). Deeper work — keeping T1–4 cards relevant + more build diversity — is queued.
- **Fixed a late-game End-Turn hard lock.** The combat replay could read a stale beat index when a long fight
  was followed by a shorter one, throwing during render and (with no error boundary) freezing the whole app.
  Guarded the lookup, and added an error boundary so any render crash now shows a recoverable screen.
- **Tavern buffs feed Fodder + conjure spells triple.** Staff of Guel now also enchants your Fodder run-wide
  (so Demons eat bigger Fodder), matching Ritualist. And a spell that hands you minions (Undead Army, Summon
  Stone) now checks for a triple — a conjured 3rd copy combines into a golden like a buy/play does.
- **Drag feel — the "size pop" fixed.** Picking a card up shoved its neighbours because the live drop-slot
  was sized to the *base* card width (`--cw`), 17.6% wider than the actual compact cards (`--ccw`); the slot is
  now the card's exact box, so nothing shifts. The dragged hand card is fully lifted out (no faint "ghost"
  copy), the invalid-drop snap-back is quicker, and the "End of Turn" banner sits above the warband.
- **Card art → WebP (−94%).** The illustrated art was 78 PNGs at ~71 MB; converted to WebP (≤512px, q85)
  via the new `npm run optimize-art` → **4.3 MB**. Far less for the browser to hold in memory, and a much
  smaller itch build. Drop a PNG, run the script, it becomes an optimized `.webp`.
- **Drag perf — the FLIP storm, fixed.** Dragging a card over the board was re-measuring *every* card and
  restarting a slide animation each frame (the "card dancing" + stutter); the drop slot is now instant and
  the FLIP only animates real plays. Spell targeting no longer hit-tests via `elementFromPoint` per frame.
- **Choose One is its own keyword** — no longer doubled by Drakko or counted by Karwind/Bane.
- **Minion batch.** Reworked **Hoard Cleric** (T3 3/4, +2/+3 Dragons), **Cinderwing Matron** (T4 5/5, +1 spell
  Health), **Toxin Tender** (T5 3/1, friendly-Undead Venomous), **Grave Knit** (T2 3/2 + a global death-buff);
  added **Skullblade** (spell-power Deathrattle); cut Rot Weaver + Webspinner Matron; **Bane** is now a true
  Dragon/Demon (eats Fodder, Corrupted-Lifebinder-targetable). New run-wide spell-power system.
- **Two T6 minions — Taurus & Bane.** **Taurus the Ancient** (Neutral 6/8) Engraves the minion to its left
  at Start of Combat (golden: both neighbours), so that minion keeps the stats it gains in the fight.
  **Bane** (Dragon/Demon 12/12) gives **Fodder +1/+1** for every Battlecry you trigger (golden +2/+2).
- **Cassen counter fix + drag perf.** Cassen's in-combat Collision tracker now counts enemy kills exactly
  (death events are side-tagged) and shows a clean climb to 5/5 instead of a mid-combat rollover. Dragging is
  rAF-throttled (one update per frame, so high-Hz pointers don't over-render); feel-test the production build
  (`npm run build:web` → `npm run preview`), which strips the dev-mode double-render.
- **Three new minions + a Junkyard Titan rework.** **Hoarder** (T1 — sells for +1 Mana per turn you hold it),
  **Black Belt Brian** (T5 — Battlecry: Discover a spell), **Yazzus** (T6 — your spells cast twice; three times
  when golden, spark and all), and **Junkyard Titan** now reads "**Deathrattle:** add a random Magnetic minion
  to your hand."
- **Stability + content fixes.** Reverted the hand-fan rework (it had pushed the hand into the play area on
  short/wide screens, blocking card placement — the hand sits at the bottom again). Removed **Arclight
  Reactor**; refreshed art for **Eyes of Aresmar**, **Growth**, **Staff of Guel**. Earlier this session: the
  next opponent is pinned at turn start (Hero Power no longer re-rolls it), **Mana Font** + Nadja's power scale
  max Mana past the cap, and **Cassen**'s Collision counter ticks live in combat.
- **UI/content polish.** **Nadja's Mana Font** is now an active power — click to fire (no target), costs **3 Mana**. **Gnasher** reads
  "gains +5/+5 **Engraved**" (the keyword tooltip explains it). **Sporeling** now gives *all* friends +1 Attack
  or +1 Health (randomly decided). You can no longer act while the **end-of-turn effects animate**. The **hero
  picker** sits on the dimmed board art for some texture.
- **9 heroes + 3 spells.** Two new heroes — **Nadja** (press for +1 max Mana) and **Cassen** (kill 5 enemy
  minions → get a minion of your most common type) — plus fresh art for the roster and two renames (**Indy**,
  **Soren**). New spells: **Mend** (heal 5), **Undead Army** (2 copies of a random Undead), **Lasso** (steal a
  tavern minion). Tribes Choice can now also be cast on a tavern minion.
- **Async-PvP groundwork + tavern-targeting.** Your finished runs' boards now **persist** (localStorage) and
  load back into the opponent pool at startup, so you face boards you actually built. And **Shatter** / **Front
  to Back** can be dropped onto a **tavern offer** to buff it before you buy it.
- **Spell + VFX polish.** **Lantern of Souls** is now a global Undead aura — active in the shop, warband,
  hand, and combat, scaling with spell power (+1/+1 spells make it +4/+1). **Staff of Guel** permanently
  buffs every minion you *buy* from the tavern (+2/+2, rest of run). Cards show their **live** values (Front
  to Back's escalating grant, Staff's scaled buff). **Divine Shield / Reborn / Venomous** now recolour the
  whole card frame (gold / electric-blue / lime) and add a bold status badge, so those units are unmistakable. **Mana Font** raises max Mana only (no top-up); **Refresh** reads 0 with free
  rerolls; a targeted spell only applies on an **explicit drop** (no stray auto-target); hero-select panels
  + title are ~30% bigger.
- **11 new spells + a new hero (Drakko).** The spell pool more than triples (5 → 16): Shatter, Tribes Choice,
  Refreshing Texts, Eyes of Aresmar (gild a ≤T4 minion), Mana Font (+1 max Mana), Sprout, Staff of Guel,
  Summon Stone, Front to Back (escalating buff), Help Wanted, and Lantern of Souls (your Undead get +3 Attack
  for the rest of the run). **Drakko** is a quest hero — buy 5 Battlecry minions for a free Drakko the Drummer.
  Hero-select flavor text is gone, and **Grim** now shows its live "+N/+N" Deathrattle value.
- **Real boards hit back + combat-flow fixes.** A combat loss now costs **the opponent's tavern tier + the
  tiers of their surviving minions** (capped 5 / 10 / 15 by round), and the Resolve hit lands **at the end of
  combat** (you watch it drop) instead of on the shop return. Fixed: a combat-skip that restarted the replay,
  the enemy death reflow (survivors now slide into the gap), and a Discover hole that let you exceed a card's
  pool stock (the "8 Grim").
- **Real boards fight you now.** Instead of procedural "omen" blobs, each wave serves a **real captured
  board** (a deterministic bootstrap pool of bot-played boards for now; your own + friends' later), and a
  top-right **opponent frame** telegraphs the next foe — hero portrait + HP, with tier / triples / top-tribe
  on hover.
- **Board snapshots now carry opponent intel.** Groundwork for difficulty-from-real-boards: a captured
  board snapshot now records the run's **HP, tavern tier, and total triples**, plus a `dominantTribe`
  readout (the "5 undead" line) — exactly what the upcoming opponent-info frame will show. A run-wide
  triples counter feeds it.
- **Buy like you sell + content/economy fixes.** You can now **buy by dropping a shop card anywhere below
  the warband line** (not just on the hand), with a **"BUY" zone box** that mirrors the "SELL +1" box.
  **Fodder** only enters the tavern if you have a Demon to eat it (otherwise it's wasted, not hoarded),
  **tripling Spirit Pups** keeps the *best* spell counter of the three copies, and **Ravenous Cleaver** was
  removed.
- **Grim reworked + Combinator nerfed.** **Grim** now gives your Beasts **+1/+1 for each Deathrattle
  triggered this game** (whole-run) — a scaling payoff instead of a flat buff. **Combinator** magnetizes a
  Cling onto 1 Mech (golden: 2). **Flowing Monk's** gift now reads as **Engraved** (kept after combat), and
  **Beatboxer's** mimicked Cling copies count toward the Cling improvement.
- **Blaster blast VFX + escalating Cling Drones.** Blaster now has **Taunt** and rains **purple bolts**
  on every minion when its Deathrattle pops. **Cling Drones** improve **+1/+1 each time one is
  magnetized** — a permanent enchantment that scales hard with Combinator. (Enemy boards are back to the
  procedural threat for now; real player boards return soon.)
- **New keyword "Engraved" + 4 new cards.** **Engraved** minions keep the stats they gain in combat
  (carried back to your board) — **Gnasher** is now a T6 Engraved threat that gains a permanent **+5/+5**
  on every kill. New: **Beatboxer** (T6 Mech — copies every magnetization onto itself), **Blaster** (T4 —
  Deathrattle: 3 to all minions), **Jenkins & Fi** (T5 — Deathrattle: destroy its killer), and **Venom**
  (T3 Venomous). Omega Bulwark retired; the spell slot now respects your tavern tier.
- **Two new spells + a spell-power cast system.** **Growth** (T4 — +3/+4 to your whole board) and
  **Channeling the Devourer** (T5 — devour a friendly minion and fling its stats onto a random other
  friend) join the pool, and every stat-granting spell now scales with **spell power**. The Devourer is
  `singleCast`, so spell-quantity multipliers can't double it.
- **Combat juice.** A GSAP **attack lunge** (wind-up → strike → knockback → elastic settle) and a smooth
  **death reflow** — survivors glide into the gap as the fallen minion collapses, one synchronized phase
  instead of a snap a beat later. 0-Attack units skip their swing (Attack can't go negative), and Flowing
  Monk's mid-combat gifts are now permanent.
- **Polish + fixes.** Hero powers now complete **triples** (Myra summoning a 3rd Stray combines it — it
  didn't before); the end-screen cards + button use the game cursor; the round timer is **18s on wave 1,
  +4s/round (cap 80)**; new art for **Gnasher**, **Karwind**, **Maw**, **Mama Pup**, **Omega Bulwark**.

- **New card look — one arched frame, art-forward.** Cards are now a compact **arched tile** at rest
  (sprite + corner attack/health gems + tier pill + a **mechanic medallion**); the full card (hover,
  hand, right-click) drops a **text drawer** down from the frame. Golden/tripled minions get a gold
  frame + crown, dual-types split their frame, combat matches the shop size, the Discover panel is
  transparent, and the end-of-run screen is ~2.5× bigger on one row.
- **Balance tools** — `npm run curve` (enemy difficulty per wave) and `npm run player` (a bot's player
  strength vs that curve). They flag a wave-6 wall and that naive play floors ~wave 9. Next: difficulty
  that **learns from real player boards** (feeding async PvP).
- **Spirit Worgen now procs in combat too.** Its **+X/+X per Beast/Dragon summoned** (X = 1 + spells
  cast this turn) used to fire only in the shop; now a friendly Beast/Dragon summoned **mid-fight**
  (deathrattle tokens, etc.) triggers it as well — those combat gains are temporary, resetting next shop.
  (Spells are now a core pillar with a **~40-spell** pool target.)
- **Spirit Pup → Spirit Worgen** (T5 Beast/Dragon) — the first **transform** card. Cast 10 spells with
  the Pup on board (a live "N to go" countdown) and it becomes the Worgen, which gains **+X/+X each time
  you summon a Beast or Dragon**, where X grows with **spells cast that turn** (cast 4, then an Alleycat
  + its Stray = +10/+10).
- **End-of-run screen.** Win or lose, you get a recap styled like the hero picker: the outcome, a
  round-by-round **W-L-W** strip, your final warband, and Play Again. (Hero picker now offers 2.)
- **Echo Warden now echoes *any* summon.** "In combat, your summon effects summon 1 more copy" — it
  works for every combat summon (not just token effects), and copies each summoned unit (so 2 Pups
  become 4 with one Echo Warden).
- **A win condition.** The PvE climb is now bounded at **20 waves** — survive wave 20 and you reach a
  **Victory** screen (Play Again restarts). "Start Over" is in the Esc menu, and the round clock no
  longer ticks until you've picked your hero.
- **Six heroes (a random 3 offered each run), each with portrait art + an HP stat shown at pick.**
  **Warden** — Fortify (+Tier/+Tier); **Oner** — **Gild** a minion Golden once per game; **Myra** —
  **Encore** a Battlecry (unlocks turn 3); **Sporen** — mark a minion so it dies for its Deathrattle at
  combat start and an exact copy returns; **Rohan** — passive: stat spells give +X/+X more, scaling;
  **Djinn** — re-proc a minion's End of Turn. Heroes are data — adding one is a registry entry, with
  optional per-hero HP, unlock turn, passives, and even combat-time powers.
- **Combat hand updates live.** A card granted *during* a fight (e.g. Arcane Weaver's Deathrattle →
  Spirit Fire) now appears in the in-combat hand as it lands, not just after the fight.
- **Deathsayer** (T4 Undead, Rally) — each time it attacks, it fires your **leftmost Deathrattle
  first** (with a clear proc + pause), so the buffs/summons land *before* the hit does.
- **3 new minions** — **Archmagus Guel** (cast a tavern spell → +1/+1 to 2 other friends), **Flowing
  Monk** (a summon that doesn't fit → +3/+3 to a random friend, in recruit *and* combat), and
  **Corrupted Lifebinder** (bind to a friendly Demon and gain stats whenever it does, recruit + combat).
- **Balance tweaks** — Maw of the Pit's Divine Shield now lasts only the next combat; Toxin Tender moved
  to Tier 5; removed six cards (Abyssal Sovereign, Pactstone Acolyte, Chromatic Caller, Nadir, Galewing
  Apex, Shield Capacitor).
- **End-of-Turn stats tick up live** — during the end-of-turn animation, each buffed minion's numbers
  now climb one proc at a time (instead of all appearing at the end).
- **Triple-ready highlight** — a tavern minion that would **complete a triple** (you already hold 2
  copies) glows gold with arrows floating up around it.
- **Readable damage numbers** — combat damage now pops up **next to each card's HP** (not off the top),
  bigger and longer-lived, with attacker and target taking their hits at the same instant.
- **Dramatic keyword procs** — poison, Divine Shield and Reborn now **bloom big in the card centre a beat
  after** the damage number (so they never overlap it); **Reborn flashes bright blue** with an expanding
  ring when a minion returns from death.
- **In-combat HP/Attack colours** — a recruit-buffed minion stays **green** in combat and only turns
  **red once a stat drops below what it entered the fight with** (a 5/5 hit to 5/3 → red HP, green
  attack); the shop is unchanged (compares to the printed base).
- **Cleaner combat→recruit hand-off** — the warband no longer "jiggles" when you return from a fight,
  and the Hero Power (Fortify) reliably flashes the minion it buffs.
- **Clearer combat** — attacks lean in and recoil instead of covering the target, the struck defender
  stays on top so its HP is visible, hits flash + pause for a beat, and the next swing is telegraphed.
- **Combat odds** — the Combat Log now shows the matchup's estimated win/draw/loss odds (a 3-segment
  bar), computed by re-simulating the fight 1000× on independent seeds.
- **Tribe colour fills the card frame** — each minion's body is washed in its type colour (Beast green,
  Dragon orange, Mech teal, Undead slate, Demon purple) with the art outlined and just the description in
  a white box; dual-types split the frame + edge half-and-half. Hovering / selecting a card now
  brightens its own tribe glow instead of an orange selector line.
- **Toxin Tender targets** — its Battlecry is now player-aimed (like the Hero Power): play it, then
  click a friendly minion to give *that* minion Venomous (ending the turn auto-targets your carry).
- **Finite minion pool** — the shop now draws from a shared, finite pool (T1 10 … T6 6 copies per
  card); a card with no copies left stops appearing, and selling or rerolling returns copies to it.
- **Buff panel + Combinator** — the right-click buff breakdown now fits any number of sources (scrolls
  past a cap, never clips the numbers); Combinator welds its Cling Drones onto **2 random** Mechs each
  proc (seeded) instead of the highest-Attack ones, with the electrify visual kept in sync.
- **Tavern bar restyle** — the shop controls now match the Pixel Arena mockup: bold colored inline
  numbers (no pill), the current-tier indicator and upgrade button both wear a house icon, and the
  Refresh cost + tier number get the same emphasis (teal cost, tangerine tier).
- **Gnasher fix + Brood Matron + Imp** — Gnasher now keeps attacking after killing a **Reborn** target
  (the revive still counts as a kill); a **golden Brood Matron** breeds two Imps per death; the Imp Scrap
  token is renamed **Imp**; Brood Matron + Imp got art; **Spirit of the Pack** was cut; and the **Tavern
  Up** cost is bigger and sits in a teal mana pill.
- **Venomous retaliation + "Tavern Up" button** — attacking a Venomous minion now poisons the
  attacker via retaliation (unless it's shielded), even when the raw hit was already lethal; the
  upgrade button now reads **Tavern Up** with a mana symbol on the cost.
- **Golden buffs + polish** — tripled (golden) minions now itemize their buffs in the inspect panel;
  Wildwood Shaper & Echo Warden got art; Karwind's flame is now a quick minimal bottom-burn; the
  magnetize absorb is cleaner still.
- **Snappier magnetize** — a Magnetic drone now absorbs cleanly into its Mech (~0.3s shrink-in) and
  the Mech crackles + flashes as it lands, instead of a slow creep.
- **Buff breakdown + Karwind flames** — right-click a minion to see its buffs itemized by source
  (`Nadir ×1 +2/+2`, `Spirit Fire ×2 +6/+6`); Dragons buffed by Karwind now flash with flames. Hand
  minions must be played to the board before they can be sold (else they snap back).
- **Drop + popup tuning** — drag insertion now tracks the dragged card's centre (not the cursor), so a
  card drops where it visually sits; the referenced-card popup now hugs the card you're hovering.
- **Referenced-card hover popup** — hovering a card that references another (Combinator → Cling Drone,
  Ritualist/Soulfeeder → your *current* Fodder, Alleycat → Stray, …) shows it as a popup to the right,
  on top of neighbours — opening after a short hover and floating in place with a soft white haze.
- **Discover frame + EoT telegraph** — the Discover screen is now an ornate gold-framed parchment panel
  (banner, gems, tier-coloured card glows). End-of-Turn effects play **one minion at a time** (repeating
  per Chronos): Ritualist washes the shop purple, Combinator electrifies the Mechs it magnetizes. Also
  centered the game-over button.
- **Triple Reward glow + itch build** — the Triple Reward spell now wears a golden frame/text-box with a
  vibrant pulsing orange glow. Added `npm run package:itch`, which builds and zips an itch.io-ready
  **`ascent-itch.zip`** (relative asset paths, `index.html` at the zip root).
- **Triple Reward + drip FX** — renamed the Discover spell to **Triple Reward** (with art); its text now
  names the exact tier it Discovers from. Welding a **golden** Magnetic minion now still grants that
  reward. The **Reborn** tears are bigger and livelier, and **Venomous** minions now constantly drip
  green venom globs.
- **Esc menu + dual-tribe + polish** — a new **Esc / settings menu** with a display-resolution scaler
  (Fit to Window · 1920×1080 · 2560×1440 · 3440×1440), letterboxing the game into a centred 16:9 / 21:9
  box. **Heckbinder** now correctly counts as a Mech *and* Demon (you can magnetize onto it, and Mech /
  Demon buffs hit it). Golden cards fill the whole text box in gold; tripled-card text now reads
  correctly (counts + grammar). The **Reborn** glow now washes over the art with drifting tear
  particles, and the Mana "coming up" tooltip uses the teal Mana icon.
- **Card cues + Heckbinder + Reborn rework** — golden minions now have a gold name pill + text box;
  **Reborn** minions show a blue aura and now return at their *base* stats (shedding combat buffs +
  granted effects like Divine Shield). New **Heckbinder** (T4 Demon/Mech, the first dual-type) that
  magnetizes onto a Mech *or* Demon. Battlecry/End-of-Turn proc effects are punchier, and the
  burning-rope timer no longer stretches with monitor width.
- **Chronos + smoother return** — new **Chronos** (T5; your End-of-Turn effects trigger an extra
  time). Also fixed the minion flicker when the board comes back from combat — it was double-firing
  its entrance animation; now it re-enters once, cleanly.
- **5 new cards + Venomous** — **Buddy Buddy** (add a random T1 minion), **Combinator** (end of turn,
  magnetize Cling Drones onto your Mechs), **Grim** (Deathrattle: +6/+6 to your Beasts), **Karwind**
  (buffs your Dragons every time a Battlecry fires — twice with Drakko), and **Money Bot** (+1 max
  mana per turn while on board; magnetize it into a Mech to keep the income). **Poison is now
  Venomous** and drops off after its first kill each combat. End-of-turn procs flash an animation,
  and multi-proc combat buffs now show the correct total (e.g. +12/+12, not +4/+4).
- **Fixes + juice** — frozen taverns now top up empty slots/spell after combat; a clear "End of
  Turn" banner; the Fodder-eat animation shows the *buffed* stats, slower and wreathed in purple
  swirls; combat-granted cards (Arcane Weaver → Spirit Fire) glow as they land in hand; the
  game-over screen no longer lets the board show through; a "wrong" buzz when you can't afford a
  card; and a flourish under a minion when its Battlecry fires.
- **Buttery drag** — cards are now memoized, so dragging one no longer re-renders the whole board
  every pointermove (measured: ~0 card re-renders per move, down from one-per-card). Only the
  floating card you're holding updates as you move.
- **Proportional chrome** — the HUD, turn timer, status tray, tavern controls, and modal overlays
  now scale with the viewport (via a `--u` scaled unit) just like the cards do, so they no longer
  look tiny on large monitors. Floored at the current sizes (zero change on laptops / short windows),
  growing to ~+34% on tall displays. Combat's big post-fight buttons keep their size.
- **2 new cards + feel polish** — **Arcane Weaver** (T4 Dragon; Deathrattle adds a Spirit Fire to
  your hand after combat) and **Ritualist** (T5 Demon; End of Turn gives all Fodder +1/+1
  *wherever it is* — a persistent run enchantment that follows every copy from any source). A soft
  **dust puff** kicks up when you click the empty board (never on a card); dragged cards now **float**
  after the cursor on a whisper of lag; and a deathrattle that buffs many minions at once (Spirit of
  the Pack) now flashes them all **simultaneously**. Spirit of the Pack + Cling Drone got sprites.
- **New cards + spell QoL** — **Drakko the Drummer** (T5; golden triples Battlecries, doesn't stack)
  and **Sylus the Reaper** (T5; Deathrattles proc an extra time, golden +2, stacks); Ember Pouch is
  now **Mana Pouch**. Spells can be cast by dragging them anywhere from the warband up (incl. the
  tavern). `docs/cards.csv` is grouped by tribe with a tripled-version column for triple triage.
- **Choose One + polish** — cards can offer a **Choose One** Battlecry (pick 1 of 2 effects on play;
  sample: Wildwood Shaper). Divine Shield is now a bold soft-yellow glow (halo + on-top wash) that
  reads across the board; the Magnetic + Fodder animations are slower/clearer; and `docs/cards.csv`
  holds the full card list for balance edits.
- **Combat juice + fixes** — Divine Shield now has new art + a soft yellow glow; combat cards update
  live (a Kennelmaster's buff climbs mid-fight and reads golden); **Echo Warden** is additive (Pack
  Scrounger + 1 Echo = 3 Pups, golden Echo = +2); and **Magnetic** cards shove the board aside and
  slide into the Mech with electricity before merging. Tripling a buffed Kennelmaster now combines
  the buffs (+6 & +4 → +10).
- **Combat log + Fodder/DS visuals** — the post-combat log now spells out every hit with damage and
  remaining Health (colour-tagged); the **Divine-Shield** effect art wraps a shielded card's art
  panel; and **Fodder consume is now visible** — a ghost Fred pops into the tavern and swirls into the
  Demon that eats it (it used to resolve instantly).
- **Kennelmaster** — now "Each Beast you summon gains +1/+1. **Avenge (3): Improve this**" — each 3
  friendly deaths permanently bumps its summon buff for the rest of the run (per-instance state is
  threaded through combat and carried back). Also fixed a latent bug where golden minions didn't fire
  combat effects at 2×.
- **Fodder reworked** — Fodder (Fred) is no longer rollable; **Soulfeeder** (now T1) seeds it into
  your next tavern, and your **Demons eat it automatically** when it arrives (a random Demon per
  Fodder). **Voracious Imp** (now T2) gains **2× stats from Fodder** (golden 3×); the usual on-consume
  payoffs still fire. Both the manual Refresh and the post-combat refresh now flow through one
  **tavern-refresh** path.
- **Mana economy** — Embers are now **Mana**, recoloured teal (`#30d2ff`): a droplet resource icon
  and a teal circular cost badge. A **Combat Log** button (beside End Combat) replays the fight in
  text; the `—VS—` divider is gone and the combat banner now names the threat. Buff procs no longer
  snap back, and tavern offers buffed by the hero power flash too. Bigger card text; **board 1** art.
- **In-place combat** — no more cutting to a separate arena screen. When you End Turn the shop
  "closes" (the offers, controls, timer, rope and hand animate away) and the enemy team **arrives**
  where the tavern was, while your **warband, hero, and the whole HUD stay exactly where they are**.
  After the fight your board plays a reset animation as the next shop opens.
- **Polish pass** — more space between cards (badges no longer overlap), a countdown tick on the last
  five seconds, a 3× Taunt emblem, a +30% Divine-Shield glow, the turn timer grows +5s per wave
  (cap 70s), bigger tier pills (now on spells too), a white-outlined cost ember, a **spell spark**
  when you cast, a punchier **buff proc** burst (e.g. Warden's Fortify), and **board 2** art.
- **Bolder card stats** — Attack/Health are big badges overhanging the card's bottom corners (matching
  the cost ember), with larger tribe text.
- **HP bar HUD** — Resolve is a health bar across the bottom of the corner tray (red heart + fill +
  current health, no label); the Warden hero panel and Embers chip are bigger and matched in height.
- **Combat fix** — attackers no longer swing out of order after a minion dies mid-combat (the next
  attacker is tracked by identity, not by a shifting index).
- **Hero art** — the Warden hero now has a portrait, and Brightwing Broker has its illustration.
- **Spells** — can't be tripled or sold; they're only played for their effect. Hero power is usable
  with no minion on your board (it can buff a shop offer).
- **Snappier reordering** — cards slide out of the way sooner as you drag (insertion triggers earlier).
- **Hero power hits the tavern** — Fortify ("give a minion +1/+1") can now buff a shop offer, not just
  your warband; the buff is baked in when you buy it.
- **Embers forecast** — hover the Embers chip to see how many you'll start the next two waves with.
- **Fix** — dragging a spell up to the offers no longer accidentally sells it for +1.
- **New T1 spells** — **Ember Pouch** (gain an Ember) and **Bulwark** (+0/+1 and Taunt to a friend)
  join Spirit Fire in the rotating spell slot.
- **Reorderable shop** — you can now drag shop offers to rearrange them (like the warband), so a
  dragged card lands where you drop it instead of snapping back; the spell stays pinned on the right.
- **Bigger cost badge** — the ember cost badge is 2× larger.
- **Cleaner buying** — dragging a shop card now lifts it out and the rest slide to close the gap (same
  feel as reordering the warband), instead of leaving a dimmed "shadow" behind.
- **Cost-in-an-ember** — the card cost now sits inside a little ember/flame badge over the corner.
- **Hero polish** — the hero-power tooltip is now a styled pill (matching the card tooltips) and the
  cursor no longer flickers when hovering a used hero power.
- **Scales to your screen** — cards now grow with the viewport height (clamped), so the board fills
  16:9 up to 21:9 / ultrawide instead of sitting tiny in the middle.
- **Cost badge** hangs over the card's top-left corner — solid orange, white text, bigger.
- **Gentler hand hover** — hovering a hand card lifts it just enough to reveal it (no more big pop
  that bounced out from under the cursor).
- **Mirror layout** — the shop offers and your warband now sit on opposite halves of the board (with
  the rope timer on the centre line); the Refresh/Freeze/Tier/End-Turn controls are a separate bar.
- **HUD in the corner** — Embers · Hero · Resolve moved to a compact tray in the bottom-left, giving
  the hand the whole bottom-centre to fan out.
- **Removed the Divine Shield card overlay** for now (too noisy); the art/helper are kept for a subtler
  re-add later.
- **Fodder is a keyword** — the Tier-1 demon card is now **Fred** with a **Fodder** pill (no more
  "cheap fuel" text); Consume minions eat anything with the keyword, so it's reusable across cards.
- **HUD tray** — Embers · Hero · Resolve sit in one connecting frame; the hero never fades (even when
  it can't be used), and the hand fans up from *behind* the tray with a snappier hover-pop.
- **Board layout** — the tavern rides high near the top, the warband sits lower, and the burning-rope
  turn timer is pinned across the centre of the board.
- **Smoother paint** — dropped the fixed-attachment board background (a constant full-screen repaint)
  since the board never scrolls — no visual change, less stutter.
- **Tribe colours** — recoloured to read at a glance: Beast green, Dragon red/orange, Mech blue,
  Undead dark slate-blue, Demon purple, Neutral light greige (dual-type split-hue wired but dormant).
- **Cleaner board** — the red omen bar and the per-row labels are gone (just the wave # up top); the
  hand now fans up from *behind* the Embers/Hero/Resolve bar and pops up when you hover a card, which
  lets the Tavern + Warband settle lower with more room.
- **Fixes** — Fodder's name now shows (a flex-shrink bug squashed the name pill on long-text cards);
  the Divine Shield aura is bigger and spills over the card edges while still showing the minion.
- **Board art** — the play surface is now an illustrated crystal arena (under a dark scrim so cards
  and HUD stay legible).
- **Warden** — the hero is renamed **Warden** and the hero power **Temper → Fortify** (+1/+1).
- **Divine Shield aura** — minions with Divine Shield now wear a glowing golden shield overlay that
  the minion shows *through* (screen-blended + a slow pulse), live on Spare Part Drone.
- **Demons work now (Fodder)** — added **Fodder**, a Tier-1 1/1 Demon, as cheap fuel for the Consume
  minions (Voracious Imp & co. had nothing to eat before); play it beside a Demon and it gets eaten.
- **Spells** — a spell is always offered on the right of the tavern (its own cost, not the flat
  minion cost). First spell: **Spirit Fire** (2 gold), +3/+3 to a friend. Targeted spells cast with
  the **same aim-line as the hero power** — drag the card out of hand, the cursor becomes a targeting
  line, click a friendly minion to fire (release off a minion or right-click to cancel). Non-targeted
  spells just drop into the warband. Hooks are in for spell-cost buffs, spell-casters, and spell-tracking.
- **Keywords** — Immune (takes no damage) and Stealth (untargetable until it attacks) added; Avenge
  and End-of-Turn triggers wired; Deathrattle now also fires out of combat (when a minion is
  Consumed). Divine Shield / Poison / Reborn / Start-of-Combat / Consume / Cleave / Windfury verified.
- **Drop-in-place drag** — reordering a warband minion now slides the others open as you drag and
  drops the card exactly where shown — no jarring post-drop swap.
- **Combat replay fix** — attackers occasionally lunged toward where their target *used to be*
  (positions were measured during render off the previous frame); the measurement now happens after
  each beat commits, so combat reads in order.
- **Darker board** — the backdrop is now a warm taupe so the cards and art pop.
- **Card readability** — Battlecry & Deathrattle now get their own pills (like Start/Consume) and the
  description starts on the same line on every card; right-click any card to **inspect** it (centred,
  enlarged, dimmed backdrop — click out or Escape to close).
- **Bigger cards & art** — cards are 10 % wider and a touch taller, the art panel is now 60 % of the
  card and the illustration fills it edge-to-edge; the upcoming-threat banner was slimmed to make room.
- **Sweet-spot targeting** — the Hero Power aim follows the cursor so you can target anywhere on a
  minion's card (no snap to centre), and the minion under the cursor lights up.
- **Drag feel** — a precision pass: the held card tracks the cursor with zero lag and stays pinned
  to the grab point, a glowing bar marks the exact slot a minion will drop into, valid zones light
  up, pointer-capture survives fast flicks, and reorders land where you aim (fixed an off-by-one that
  overshot rightward drags).
- **Tier colours** — the tier badge now ramps cool→warm across tiers 1–6 (slate→raspberry) so tier
  reads at a glance.
- **Illustrated art** — a per-card image pipeline: drop `<card-id>.png` into
  `packages/ui/src/art/minions/` and it replaces that card's pixel sprite in the shop, warband, and
  combat (falls back to the sprite when absent). First four illustrations are in (Ember Whelp,
  Voracious Imp, Spare Part Drone, Doublecast Drummer); fixed the art overflowing onto the card text.
- **Combat feel** — wind-up → impact attacks with snappier lunge easing, a death dissolve (dying
  minions crumple + fade), a white-hot impact spark on each hit, a win/lose scene tint when the
  replay settles, Divine-Shield gold aura + shatter-on-break, poison mist, Start-of-Combat projectile
  bolts, Taunt shield wards, summon pop-ins, a board shake on kills, damage floats + HP flashes, and
  a synthesized SFX bank + mute.
- **Recruit** — a Tavern-Tier box in the control bar, a slot-free warband that FLIP-shuffles when it
  reorders, a wide hand box matching the bottom frame, a burning rope in the last 15 s, drag-to-target
  Hero Power, green/red stat colours, an arcane frame for the Discover spell.
- **Fixes** — tripling keeps buffs + keywords (sum of the top two stats); Doublecast Drummer & Echo
  Warden now work; embers uncapped within a turn; early waves softened.
- **HUD** — Embers · Warden · Resolve rooted at the bottom across recruit and combat; "End
  Combat" at the top-centre; a Resolve loss flashes the chip; the Hero Power pulses when ready.

## Short-term roadmap

_(Full queue in [docs/roadmap.md](docs/roadmap.md).)_

- **Now — difficulty from real boards:** ✓ snapshots carry HP/tier/triples, ✓ real boards are served as
  enemies (replacing omens), ✓ an opponent-intel frame telegraphs the next foe → next: a damage-dealt system
  (loss scaled by opponent tier + surviving minions), then persist your own boards into the pool. Counter-
  matrix hand-tuning is demoted; captured boards drive difficulty.
- **M3 (meta):** more heroes + the full Title→Mode→Hero menu flow (hero picker shipped), unlocks,
  ascension modifiers, daily seeds, save/replay; async PvP off the shared board pool.
- **M4 (juice & onboarding):** audio/VFX (✓ WebGL FX layer + hit-impact landed — next: death burst,
  Pixi projectiles), tutorial, full accessibility + touch.

## Layout

A TypeScript monorepo (npm workspaces). The engine is a pure, deterministic simulation fully
decoupled from the UI — combat is a pure function returning an event log the UI merely replays.
See [CLAUDE.md](CLAUDE.md) for architecture, conventions, and the milestone plan.

- `packages/core` — `@game/core`: seeded RNG, types, event bus, effect system, `simulate()`
- `packages/content` — `@game/content`: data-driven cards + threats (zod-validated)
- `packages/sim` — `@game/sim`: run loop (economy, shop, tiers, triples, scoring)
- `packages/ui` — `@game/ui`: React + Zustand recruit screen + combat arena
- `packages/tools` — `@game/tools`: headless combat harness, run bot, balance runner
- `apps/web` — Vite app wiring `ui` + `sim`
