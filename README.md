# ASCENT

A deterministic, **asynchronous auto-battler**. Build a 7-slot board in a Battlegrounds-style shop, then
fight auto-resolved combats inside an **eight-seat elimination lobby**. Your opponents are other players'
recorded runs (plus generated seats to fill the table) — so a lobby never needs two people online at once.
Armor absorbs before Health, seats at zero are eliminated, and your **final placement** is what moves your
ladder Rating.

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
npm run release:desktop  # THE way to ship the exe: clean worktree at origin/main → npm ci → build → smoke-test the exe → zip
```

New contributor? See **[ONBOARDING.md](ONBOARDING.md)** (clone → install → verify → the collaboration rules).

## The game in one screen

- **An eight-seat lobby:** alternate a **shop phase** (recruit minions, play them onto a 7-wide board, sell,
  upgrade the tavern, cast spells) with an **auto-resolved combat** against the seat you're paired with.
- **Last seat standing.** Armor absorbs before Health, a seat at zero is eliminated, and your **placement**
  is what moves your Rating. No round target — the 60-round cap is only a stalemate backstop.
- **Set 2's five tribes** (Kobolds, Dragons, Beasts, Demons, Dwarves, + neutral glue) with triples → Gilded,
  Discover, and runes (Basic Runeforge turn 6, Epic turn 9). Universal quests are currently off; quest-native
  heroes keep theirs. See [`docs/GAME-RULES.md`](docs/GAME-RULES.md).
- **Deterministic engine:** combat is a pure function returning an event log the UI replays; one seeded RNG
  threads everything (replays, shareable seeds, cheap balance sims).

## Recent changes

- **New title mark + Title Logo tuner.** The main-menu ASCENT wordmark gets the owner's peak mark, plus a live 🏔️ Title Logo dev tuner — placement, a Google-Fonts typeface picker (curated quick-picks *and* a type-any-font field), independent text/mark glows, and a subtle float that can bob the logo as one or the mark and text separately.

- **First hero-select voiceover.** Lord of the Risen now speaks when you pick him — in both Ascent and Practice. The pipeline was already wired; this is the first real clip to land in `audio/heroes/`. Drop a `"<Hero Name> - Select.mp3"` export in the Hero Select folder and `npm run sfx:import` resolves the name to the hero and files it automatically.
- **Cia's enchant treatment follows the card.** The old persistent "enchanted foil" is replaced by the
  workbench-authored `cia-hp` burst, played as a continuous loop that now *rides the offer* as the shop
  reorders (new `follow` option on `playDef`), instead of sticking to the spot where the card was enchanted.
- **Owner correction pass on the new rune batch.** **Night Market Horror** now buffs the shop **+2/+2 for the turn** — it survives rolling and resets after combat (and the shop row finally *renders* that per-turn buff, which Rune of the Merchant's Chorus never did). **Skybound Ascendant** transforms **in real time**, animating in its own slot on its End-of-Turn beat instead of snapping in at the commit, and its text now prints the tier it can actually reach (6 without Tier-7 access). **Arcane Behemoth** is a new card: *When you sell a Demon, this gains its stats.* And the ten tribe runes **pay the moment you take them**, not only next turn.
- **Combat Prowess + Lasting Cadence hardened from the owner's live pass.** Rune/quest Start-of-Combat effects now replay at End of Turn too (19 replayed, combat-only ones documented); Twilight and the Echo multipliers (Elderhorn, Sylus, Funeral Engine, first-Echo bonuses) follow their triggers into the shop; Grim self-buffs on shop-proc'd Echoes; Rune of Rebirth prints a blue **Rebirth** tag on minions; Sunmane Herald is combat-only (its shop loop is dead).
- **Start of Combat fires in the shop too.** The whole Start-of-Combat family (21 effects) moved onto the shared effect arena — one implementation per effect, either phase can trigger it — and the new **Rune of Combat Prowess** (Epic, 5g) reads *Your Start of Combat effects also trigger at End of Turn.* Each effect gets its own beat on the minion that fires it; effects that need an enemy (Arena Heckler's taunt, Duskwing's strike) or a fight (Bleed marks, Engrave) simply sit the shop one out.

- **Fel Spikes' Echo throws a climbing spike volley.** Its Deathrattle now fires the `fel-spike` effect from the dying body as a real projectile volley — each spike flies out and strikes, the damage number climbs on each hit toward the combined total, and every multi-fire (gilded, Sylus, a golden Echohorn) accumulates so a victim eats the whole spray and dies once, after it. (Combat damage events now record who dealt them, so a source→target FX can launch from an AoE's caster.)

- **FX workbench: "Field variation" knob** — a new Physics slider (burst / emitter / smoke) that gives each cast its own seeded turbulence-field phase, so many copies of an effect firing at once no longer swirl in lockstep. Defaults to 0 (a no-op that leaves every saved effect unchanged).

- **Rallies now fire in the shop too.** The whole Rally family (40 effects across 44 cards) moved onto the shared effect arena, so a Rally is one implementation that either phase can trigger — and **Rune of Lasting Cadence** reads what it always should have: *End of Turn: trigger all your Rally effects.* Each rally gets its own beat, so you watch them go off one at a time on the minions that fire them, instead of the whole board resolving in a single frame. Rallies that need an enemy (Philippe, Tauntbreaker) simply sit the shop one out.

- **30 new runes.** The Runeforge entries for the batch below: 20 Basic + 10 Epic, so every rune-only minion is now reachable in play. Alongside the grants, the batch adds an every-2-turns cadence for recurring rewards, a shared "copy the spell you just cast" budget (Living Magic once a turn, Perfect Recall twice), a play-a-minion buff that improves itself, a Dwarf pay-mirror between the ends of your line, and five new combat effects — a Beast-summon meter, an Echo-to-free-refresh meter, two Ruby-improving Avenges and a board-wide Rally trigger.

- **16 new rune-only minions.** A forge-only batch, spread across all five Set-2 tribes: Deepwater Chef (a T1, T3 and T5 in one Shout), Gem Sage (every Ruby arrives doubled), Ancient Wanderer (+1/+1 for every 3 Gold you have spent this run), Clockwork Assistant, Night Market Horror, Muckslinger, Traveling Salesman, Kegheart Dwarf, Ninefold Broker, Echo Mimic (it inherits the Echo of every friendly that dies), Muster General + its Trooper, Stonehorn Archivist, Skybound Ascendant, Evolving Abomination (Rally: double its stats, twice a fight) and Arcane Behemoth. None can be bought — each waits on the rune that hands it out, and on its art.
- **Fixed: stored boards showed raw card ids** — Career/Leaderboard history is server-fetched, so a board written by one build could be read by another that lacks the card, rendering `d2_transcendence` / NEUTRAL / no art. Snapshots now bake the card's name and tribe alongside its rule text, and an unidentifiable card reads as "Unknown Card" instead of leaking an internal id.

- **Tutorial coaching pass** — every buy/play step now draws the drag it is asking for, steps that mention Health light it up, the Discover overlay is inside its own spotlight, and a hero-power reminder sits before every combat. Fixed: a positioning step that could be completed by clicking, a highlight that measured a card mid-animation, and the next step being readable below the board during combat. **Hero select** gained a difficulty pill under each portrait that crossfades to the hero-power text on hover.

_Older entries moved to the devlog on 2026-08-20. This section is the last few genuine headlines, not a
changelog — the full history is [`docs/devlog.md`](docs/devlog.md) (archive) and
[`docs/devlog/`](docs/devlog/) (current)._

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
