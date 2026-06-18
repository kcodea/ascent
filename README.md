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
```

## Recent changes

_(Most recent first — the full history is in [docs/devlog.md](docs/devlog.md).)_

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

- **M2 (now):** counter-matrix tuning — Mech is too strong, Beast too weak, Dragon/Undead flat.
- **M3 (meta):** unlocks, ascension modifiers, daily seeds, save/replay.
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
