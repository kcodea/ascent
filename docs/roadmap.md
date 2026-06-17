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

- [ ] **Responsive layout for short viewports** — fixed 264px cards × 3 rows + chrome only fits tall
      screens right now; needs a scale-to-fit or compact mode for laptops.
- [ ] **Single-target Battlecries** (e.g. "give a friendly minion +X/+X") — the Hero-Power targeting
      line + aim infrastructure is ready to reuse; no current card is player-targeted. (Content; on
      hold until the feel/functionality pass + balance are done.)
- [ ] Confirm/refine the **name-on-art card layout** — implemented from a fuzzy ask (name pill on
      the art's bottom, keyword/text area below); revisit spacing + legibility with the user.
- [ ] **Minion art — remaining illustrations.** The per-card image pipeline shipped (drop
      `<id>.png` into `packages/ui/src/art/minions/` → it replaces that card's pixel sprite
      everywhere; falls back to the sprite when absent). In so far: `whelp`, `imp`, `drone`, `drummer`,
      `spiritfire`, `fodder`; the rest of the ~30-card set still uses sprites. Several more illustrations
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
