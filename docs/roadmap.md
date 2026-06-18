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
      (+0/+1 + Taunt to a friend). Hooks still unused by any *minion* card:
  - `spellCast` event + `state.spellsCast` counter → minions that care about spells cast.
  - `castSpell` factory → minions that cast a spell from an event (auto-targets the carry).
  - `state.spellCostMod` → "your spells cost less" effects (subtracted at buy).
  - A minion using each hook would exercise the plumbing; higher-tier spells would round out the pool.
- [ ] **Targeted Battlecries (minions).** The targeting mechanic now exists (`target: 'friendly'` +
      a `targetUid` on `play` + the **hero-power aim-line** gesture, used by Spirit Fire). A *minion*
      whose Battlecry targets needs a `battlecryBuffTarget`-style factory + a place-then-target UI
      gesture (a spell just vanishes; a minion also takes a board slot). Small once a card needs it.
- [ ] **More cards for the keyword triggers.** End of Turn has cards (Ritualist, Combinator) + a
      multiplier (Chronos); Avenge (X) is used by Kennelmaster; the `battlecryTriggered` event has
      Karwind; Battlecry/Deathrattle/End-of-Turn all have repeat-modifiers now (Drakko/Sylus/Chronos).
      `endOfTurnBuff` (buff self) still has no card. Immune / Stealth work on any card today. Reusable
      primitives available for future cards: `deathrattleGrantSpell` (combat death adds a card to hand),
      `cardBuffs` (persistent per-cardId run enchantment), `battlecryGainRandomMinion` (add a random
      minion of a tier to hand), `battlecryTriggered`/`onBattlecryBuffTribe` (react to any Battlecry),
      and `CardDef.manaPerTurn` / `boardManaBonus` (board-derived max-mana economy — Money Bot).

## M3 — meta

- [ ] Unlocks — cards / heroes gated by progression.
- [ ] Ascension modifiers — escalating run-difficulty tiers.
- [ ] Daily seeds — shareable, deterministic runs (the engine already threads one seed everywhere).
- [ ] Save / replay — `serialize`/`deserialize` exist; add run-resume UI + replay of a combat's
      event log from its seed.

## M4 — juice & onboarding

- [ ] Pacing polish, audio, VFX.
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

- [ ] **Finite minion pool (copy quantities per tier).** Make the shop draw from + return to a shared,
      finite pool so copies are a contested resource (the engine behind triples + "someone else took my
      minion" tension). Per-tier copy counts (placeholder constant `POOL_QUANTITIES` already in
      `@game/sim` config, **not yet wired**):
      Tier 1 → **16**, Tier 2 → **15**, Tier 3 → **13**, Tier 4 → **11**, Tier 5 → **9**, Tier 6 → **7**,
      Tier 7 → **5** (forward placeholder — no tier-7 cards yet, `maxTier` is 6). Wiring it means
      `rollShop` pulls from the pool (weighted by remaining copies, gated to ≤ current tier) and
      sell/reroll return copies.
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

- [ ] **Single-target Battlecries** (e.g. "give a friendly minion +X/+X") — the Hero-Power targeting
      line + aim infrastructure is ready to reuse; no current card is player-targeted. (Content; on
      hold until the feel/functionality pass + balance are done.)
- [ ] Confirm/refine the **name-on-art card layout** — implemented from a fuzzy ask (name pill on
      the art's bottom, keyword/text area below); revisit spacing + legibility with the user.
- [ ] **Minion art — remaining illustrations.** The per-card image pipeline shipped (drop
      `<id>.png` into `packages/ui/src/art/minions/` → it replaces that card's pixel sprite
      everywhere; falls back to the sprite when absent). **Every source illustration that maps to an
      existing card id is now wired** (28: alley, broker, buddy, bulwark, chronos, cling, combinator,
      drone, drummer, emberpouch, feed, fred, grim, heckbinder, imp, karwind, kennel, moneybot, omen,
      pack6, ritualist, sandbag, spiritfire, spore, stray, sylus, weaver, whelp). The rest still use
      pixel sprites and have **no source art yet** — every source illustration now maps to a card.
      Source art lives in `C:\Game Assets\Ascent Art\Minions`. **Hero portraits** use a parallel
      pipeline (`art/heroes/<id>.png` → `heroArt()`); the Warden portrait is wired.
- [ ] **Divine Shield art style — bubble vs. crest.** The effect-art overlay pipeline shipped
      (`art/effects/*.png` → `effectArt()`; `.dsfx` screen-blends a glowing aura over any `DS` minion,
      live on Spare Part Drone). The current asset is a shield **crest** shape; if a rounder "bubble/dome"
      shimmer reads better, swap the art or move it to a corner badge — user's call.
- [ ] **Art compression.** The illustrations are ~650 KB PNGs at 512×512; fine for a handful, but
      convert to WebP (or add a build-time compress) before the full set lands so the bundle stays
      lean. *(Blocked on tooling: no WebP encoder is installed — `cwebp`/ImageMagick/`ffmpeg`/`sharp`
      all absent. Either install one, add `sharp` as a dev dep + a build step, or downscale the
      source PNGs to ~400px via the existing System.Drawing path, since cards display at ~290px.)*
- [ ] Vendor the full Build Handoff v2 into `docs/handoff.md` (currently in-session only).
