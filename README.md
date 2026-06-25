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
- **M4 (juice & onboarding):** audio/VFX, tutorial, full accessibility + touch.

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
