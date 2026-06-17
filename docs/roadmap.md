# ASCENT — roadmap / queue

Forward-looking work, broken down by milestone. When something ships, move it out of here (its detail
goes in [devlog.md](devlog.md)); when new work appears, add it under the right section. Keep honest
and current. High-level milestone summaries live in [../CLAUDE.md](../CLAUDE.md).

## M2 — content + balance (in progress)

- [ ] **Enemy-strength curve tool** (the way we'll actually balance — not the old mono-tribe matrix
      runner, which is deprioritized per the user). Build a way to tune how fast enemy boards scale
      per wave so the climb's difficulty ramp feels right. Design TBD.
- [ ] **More spells + spell-synergy cards.** The spell *system* is in (a spell is always offered on
      the right; Spirit Fire = target a friend, +3/+3, costs 2). Hooks are wired and ready for cards:
  - `spellCast` event + `state.spellsCast` counter → minions that care about spells cast.
  - `castSpell` factory → minions that cast a spell from an event (auto-targets the carry).
  - `state.spellCostMod` → "your spells cost less" effects (subtracted at buy).
  - A second spell, and at least one card using each hook, would exercise the plumbing.
- [ ] **Targeted Battlecries (minions).** The targeting mechanic now exists (`target: 'friendly'` +
      a `targetUid` on `play` + the **hero-power aim-line** gesture, used by Spirit Fire). A *minion*
      whose Battlecry targets needs a `battlecryBuffTarget`-style factory + a place-then-target UI
      gesture (a spell just vanishes; a minion also takes a board slot). Small once a card needs it.
- [ ] **Cards for the keyword triggers.** Avenge (X) and End of Turn are wired (events + factories +
      pills) but no card declares them yet. Immune / Stealth work on any card today.

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
- [ ] **Recruit perf pass (if it persists locally).** Dropped `background-attachment: fixed` (a real
      repaint win). If buy/drag still micro-stutters on a local `npm run dev` build (not just the
      preview window), memoise `Card` (stabilise the per-card view objects + `beginDrag` callbacks) and
      update the floating drag-card transform imperatively (via ref) instead of re-rendering the whole
      recruit tree on every pointermove.
- [ ] **Fodder keyword — more users.** `FD` is now a keyword (Fred carries it; consume keys off it).
      Give other cheap/token minions the keyword and/or add cards that interact with Fodder, now that
      it's a reusable marker rather than one card.
- [ ] **Dual-type minions — activate the data model.** The UI split-hue is wired (`CardView.tribe2`
      → `.card.dual` splits the art + footer into both `--c`/`--c2` hues), but it's dormant: nothing
      sets a second tribe yet. To use it, add `tribe2?: Tribe` to `CardDef` (+ zod schema), decide which
      cards are dual-typed and how dual types interact with the A.6 counter matrix, then surface both
      tribe labels/icons in the footer. (Design + balance call.)
- [ ] **Threat telegraph — reintroduce, lighter.** The red omen bar was removed per the user ("for
      now"); the wave # in the HUD is all that's shown. The build spec still wants a pre-shop threat
      telegraph — bring back a slimmer/optional form later. `Omen.tsx` is retained (unrendered) so the
      enemy-preview derivation can be reused.
- [ ] **Hand-tuck tuning.** The hand now fans up from behind the status bar (pops on hover). The tuck
      depth / hover-lift / fan overlap are first-pass values — revisit once more cards are in play
      (and on shorter viewports) so the resting peek and the pop both feel right.

- [ ] **Scale the chrome too (HUD / buttons / fonts).** Card sizing now scales with the viewport
      (`--ch: clamp(220px, 27vh, 384px)`) so the board fills 16:9 → 21:9 screens. The chrome (top HUD,
      tavern controls, status tray, body text) is still fixed-px, so it looks comparatively small on
      large monitors — scale it with the viewport (or a root rem) for a fully proportional UI. Also
      double-check very short viewports (≤720px) and the combat arena at the new card scale.
- [ ] **Single-target Battlecries** (e.g. "give a friendly minion +X/+X") — the Hero-Power targeting
      line + aim infrastructure is ready to reuse; no current card is player-targeted. (Content; on
      hold until the feel/functionality pass + balance are done.)
- [ ] Confirm/refine the **name-on-art card layout** — implemented from a fuzzy ask (name pill on
      the art's bottom, keyword/text area below); revisit spacing + legibility with the user.
- [ ] **Minion art — remaining illustrations.** The per-card image pipeline shipped (drop
      `<id>.png` into `packages/ui/src/art/minions/` → it replaces that card's pixel sprite
      everywhere; falls back to the sprite when absent). In so far: `whelp`, `imp`, `drone`, `drummer`,
      `spiritfire`, `fred`; the rest of the ~30-card set still uses sprites. Several more illustrations
      are already sitting unused in the source folder (ArcaneWeaver, BrightwingBroker, Karwind,
      Kennelmaster, SpiritOfThePack…) — wire each once its card id is confirmed. Source art lives in
      `C:\Game Assets\Ascent Art\Minions`; see the README in the art dir for the card-id ↔ name table.
- [ ] **Divine Shield art style — bubble vs. crest.** The effect-art overlay pipeline shipped
      (`art/effects/*.png` → `effectArt()`; `.dsfx` screen-blends a glowing aura over any `DS` minion,
      live on Spare Part Drone). The current asset is a shield **crest** shape; if a rounder "bubble/dome"
      shimmer reads better, swap the art or move it to a corner badge — user's call.
- [ ] **Art compression.** The illustrations are ~650 KB PNGs at 512×512; fine for a handful, but
      convert to WebP (or add a build-time compress) before the full set lands so the bundle stays
      lean.
- [ ] Vendor the full Build Handoff v2 into `docs/handoff.md` (currently in-session only).
