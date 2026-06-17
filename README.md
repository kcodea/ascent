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
