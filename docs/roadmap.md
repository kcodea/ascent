# ASCENT — roadmap / queue

Forward-looking work, broken down by milestone. When something ships, move it out of here (its detail
goes in [devlog.md](devlog.md)); when new work appears, add it under the right section. Keep honest
and current. High-level milestone summaries live in [../CLAUDE.md](../CLAUDE.md).

## M2 — content + balance (in progress)

- [ ] **Enemy-strength curve tool** (the way we'll actually balance — not the old mono-tribe matrix
      runner, which is deprioritized per the user). Build a way to tune how fast enemy boards scale
      per wave so the climb's difficulty ramp feels right. Design TBD.
- [ ] **More spells + spell-synergy cards.** Three T1 spells now rotate in the slot: Spirit Fire
      (+3/+3 to a friend), Ember Pouch (gain 1 Ember — *net-neutral as specced; revisit*), Bulwark
      (+0/+1 + Taunt to a friend). Hook usage:
  - `spellCast` event + `state.spellsCast` counter → **now used by Archmagus Guel** (buff 2 others).
  - `castSpell` factory → minions that cast a spell from an event (auto-targets the carry) — still unused.
  - `state.spellCostMod` → "your spells cost less" effects (subtracted at buy) — still unused.
  - Higher-tier spells would round out the pool.
- [x] **Targeted Battlecries (minions).** Done — the place-then-target gesture is built: a minion with
      `CardDef.target: 'friendly'` plays to the board, parks a `RunState.pendingTarget`, and the player
      aims the hero-power-style line at a friendly minion (a new `battlecryTarget` action resolves it;
      ends auto-resolve on the carry). **Toxin Tender** is the first user (grants Venomous to the chosen
      minion). To add a *stat* targeted Battlecry (e.g. +X/+X), just add a `battlecryBuffTarget`-style
      factory that reads `payload.target` — the rest is wired. **Corrupted Lifebinder** added
      `CardDef.targetTribe` (restrict the pick to one tribe + exclude self) for tribe-locked targets.
- [ ] **More cards for the keyword triggers.** End of Turn has cards (Ritualist, Combinator) + a
      multiplier (Chronos); Avenge (X) is used by Kennelmaster; the `battlecryTriggered` event has
      Karwind; Battlecry/Deathrattle/End-of-Turn all have repeat-modifiers now (Drakko/Sylus/Chronos).
      `endOfTurnBuff` (buff self) still has no card. Immune / Stealth work on any card today. Reusable
      primitives available for future cards: `deathrattleGrantSpell` (combat death adds a card to hand),
      `cardBuffs` (persistent per-cardId run enchantment), `battlecryGainRandomMinion` (add a random
      minion of a tier to hand), `battlecryTriggered`/`onBattlecryBuffTribe` (react to any Battlecry),
      and `CardDef.manaPerTurn` / `boardManaBonus` (board-derived max-mana economy — Money Bot).

## M3 — meta

- [x] **Shareable web build** — `npm run package:itch` builds with a relative base and zips an
      itch.io-ready `ascent-itch.zip` (`index.html` at root, forward-slash entries). Good enough to hand
      a playtest build to friends; a proper hosted/versioned deploy is still future work.
- [~] **Heroes as data + hero select.** Shipped: `@game/sim/heroes.ts` registry (`HeroDef`, power
      `kind` resolved in the reducer), `RunState.heroId`/`heroPowerSpent`, a pre-run **hero picker**
      (`HeroSelect.tsx`, store flag `heroChoices`, no router). Two heroes: **Warden** (Fortify,
      +Tier/+Tier) and **Oner** (Gild — golden a minion, once per game). Remaining:
  - **More heroes** — each is a `HeroDef` + (only if novel) a new power `kind`. Power-kind ideas that
    reuse existing plumbing: a flat-stat buff, a one-shot gold/mana, a reroll discount.
  - **Hero-select offers a random subset** once >3 heroes exist (today it shows all). Consider always
    including a simple "starter" hero so a new player isn't forced into a niche power.
  - **Oner needs portrait art** (anvil-icon fallback today) — drop `art/heroes/oner.png`.
- [ ] **Menu flow — Title → Play → Mode → Hero → run.** The hero picker is the first slice; extend the
      same store-flag/scene pattern (no router) backward to a Title screen and a Mode select. Reuse the
      overlay/`herocard` components. Keep it lean — a small `scene` enum in the store, not a framework.
- [ ] Unlocks — cards / heroes gated by progression (heroes are now data, ready to gate).
- [ ] Ascension modifiers — escalating run-difficulty tiers.
- [ ] Daily seeds — shareable, deterministic runs (the engine already threads one seed everywhere).
      Note: the hero-*choice* roll currently uses `Math.random` (UI meta) — seed it here for dailies.
- [ ] Save / replay — `serialize`/`deserialize` exist; add run-resume UI + replay of a combat's
      event log from its seed.

## M4 — juice & onboarding

- [ ] Pacing polish, audio, VFX. _(Ongoing — recently: referenced-card hover popups (see the token a
      card creates / your current Fodder), sequenced per-card End-of-Turn telegraph with Chronos repeats
      + per-card FX (Ritualist shop wash, Combinator electrify), ornate Discover frame, Reborn/Venomous
      particle FX, Triple Reward glow, tribe-coloured card frames — body wash + outlined art + white
      text box (dual = split frame/edge).)_
- [ ] Tutorial / first-run onboarding.
- [ ] Full accessibility + touch support.

## Backlog / ideas (unscheduled)

- [ ] **Tavern-targeting for spells (and more cards).** The hero power (Fortify) can now buff a tavern
      offer — `ShopCard` carries `atk`/`hp`/`keywords` and `buy` bakes them in. Extend this to *spells*:
      add a target scope that includes the tavern (vs `target: 'friendly'`), and teach the cast path
      (`spellBuffTarget`, which mutates a `BoardCard`) to also buff a `ShopCard` when the target is an
      offer. Then a spell like a tavern-only buff could target the shop.
- [ ] **Ember-gain modifiers feed the projection.** The Embers-chip popup projects the next two waves'
      starting Embers from the base `maxEmbers` curve. When cards modify Ember gain (per-wave income,
      one-shot ramp, etc.), fold their effect into the projection so it stays accurate.

- [x] **Finite minion pool (copy quantities per tier).** Wired: each run stocks `POOL_QUANTITIES[tier]`
      copies (T1 **10**, T2 **9**, T3 **8**, T4 **7**, T5 **6**, T6 **6**) of every buyable minion of its
      active tribes (+ neutral) into `RunState.pool`. The shop draws from it (a card at 0 copies stops
      being offered), and sell / reroll return copies (a golden returns 3), while conjures (Discover,
      Buddy) take a copy so selling them stays balanced. *Remaining refinement:* the draw is **gated** by
      availability but not yet **weighted** by remaining count — kept the tier-proximity weighting so
      existing seeded tests stay deterministic. Add copy-count weighting (BG-style: more copies → more
      likely) if the contested feel needs sharpening.
- [ ] **Pool UI — show remaining copies.** The pool is wired but invisible; a small "copies left" cue
      (on the shop card, or fading a card type once it's exhausted) would make the contention legible.
- [ ] **Divine Shield indicator (re-add).** The `.dsfx` overlay was removed as too noisy. `effectArt()`
      + `art/effects/divineshield.png` are retained — re-add a *subtler* DS cue (small corner badge or a
      thin rim) when wanted, rather than the full-card aura.
- [ ] **Recruit perf pass — further (if it still micro-stutters locally).** Done so far: `Card` is
      memoized + its props stabilized (per-card view objects via `useMemo` maps, one shared
      pointer-down handler), so during a drag the board's cards no longer re-render (measured: ~0 card
      renders per pointermove vs. one-per-card before). If a local `npm run dev` build *still*
      stutters, the next lever is to take the floating drag-card transform fully imperative (write it
      to the node via a ref on pointermove) so the recruit tree doesn't re-render at all between
      meaningful state changes (zone/insertion-index/magnetize). Also dropped `background-attachment:
      fixed` earlier (a real repaint win).
- [ ] **Fodder keyword — more users.** `FD` is now a keyword (Fred carries it; consume keys off it).
      Give other cheap/token minions the keyword and/or add cards that interact with Fodder, now that
      it's a reusable marker rather than one card.
- [x] **Dual-type minions — fully wired.** `CardDef.tribe2` (+ combat `Minion.tribe2`, + zod) is live;
      the footer shows both labels/icons + split-hue; Magnetic welds via both cards' tribe sets
      (`magnetizesTo()` — you can magnetize onto Heckbinder); and dual types now count as **both** tribes
      for tribe buffs (combat + recruit). First dual card: **Heckbinder** (Demon/Mech). *Open only:* the
      A.6 **counter matrix** still keys off the primary tribe — decide if a dual minion should be
      answered by either tribe's counter (balance call).
- [ ] **Threat telegraph — reintroduce, lighter.** The red omen bar was removed per the user ("for
      now"); the wave # in the HUD is all that's shown. The build spec still wants a pre-shop threat
      telegraph — bring back a slimmer/optional form later. `Omen.tsx` is retained (unrendered) so the
      enemy-preview derivation can be reused.
- [ ] **Hand-tuck tuning.** The hand now fans up from behind the status bar (pops on hover). The tuck
      depth / hover-lift / fan overlap are first-pass values — revisit once more cards are in play
      (and on shorter viewports) so the resting peek and the pop both feel right.

- [ ] **More single-target Battlecries** (e.g. "give a friendly minion +X/+X") — the full place-then-aim
      gesture now ships (Toxin Tender → Venomous). A stat version just needs a `battlecryBuffTarget`
      factory reading `payload.target`; the UI/aim/`pendingTarget` plumbing is reusable as-is.
- [ ] Confirm/refine the **name-on-art card layout** — implemented from a fuzzy ask (name pill on
      the art's bottom, keyword/text area below); revisit spacing + legibility with the user.
- [ ] **Minion art — remaining illustrations.** The per-card image pipeline shipped (drop
      `<id>.png` into `packages/ui/src/art/minions/` → it replaces that card's pixel sprite
      everywhere; falls back to the sprite when absent). **Every source illustration that maps to an
      existing card id is now wired** (32: alley, brood, broker, buddy, bulwark, chronos, cling,
      combinator, discoverspell, drone, drummer, echo, emberpouch, feed, fred, grim, heckbinder, imp,
      impscrap, karwind, kennel, moneybot, omen, ritualist, sandbag, shaper, spiritfire, spore, stray,
      sylus, weaver, whelp). The rest still use
      pixel sprites and have **no source art yet** — every source illustration now maps to a card.
      Source art lives in `C:\Game Assets\Ascent Art\Minions`. **Hero portraits** use a parallel
      pipeline (`art/heroes/<id>.png` → `heroArt()`); the Warden portrait is wired. **Oner has no
      portrait yet** (falls back to the anvil icon on the picker + HUD) — add `art/heroes/oner.png`.
- [ ] **Divine Shield art style — bubble vs. crest.** The effect-art overlay pipeline shipped
      (`art/effects/*.png` → `effectArt()`; `.dsfx` screen-blends a glowing aura over any `DS` minion,
      live on Spare Part Drone). The current asset is a shield **crest** shape; if a rounder "bubble/dome"
      shimmer reads better, swap the art or move it to a corner badge — user's call.
- [~] **Art compression.** *Downscale pass shipped* — `scripts/downscale-art.ps1` caps in-repo art at
      640px (System.Drawing, no deps); the four 1254px illustrations are now 640px (minion art 31.5 →
      26 MB). **Still pending: WebP** for the real win (~26 MB → ~6 MB), blocked on an encoder
      (`cwebp`/`sharp`/ImageMagick/`ffmpeg` all absent — add `sharp` as a dev dep + a build step, or
      install `cwebp`). Lower priority if the game ships as a desktop **exe** (assets load from disk, so
      bundle size becomes a one-time installer cost, not a per-play download) — revisit once the
      web-vs-exe distribution path is decided. Masters live in `C:\Game Assets\Ascent Art\Minions`.
- [ ] Vendor the full Build Handoff v2 into `docs/handoff.md` (currently in-session only).
