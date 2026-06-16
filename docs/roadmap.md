# ASCENT — roadmap / queue

Forward-looking work, broken down by milestone. When something ships, move it out of here (its detail
goes in [devlog.md](devlog.md)); when new work appears, add it under the right section. Keep honest
and current. High-level milestone summaries live in [../CLAUDE.md](../CLAUDE.md).

## M2 — content + balance (in progress)

- [ ] **Counter-matrix tuning pass** (the remaining M2 deliverable). Turn the starting stat dials
      against `npm run balance` until the A.6 matrix holds — each tribe should beat the threats it
      answers more than the ones it doesn't. Known targets from the runner:
  - Mech mono-board is **dominant everywhere** — the Divine-Shield + shield-break (Capacitor →
    Reactor → Titan) + Omega re-shield chain snowballs; bring it down or give Horde/Undying a real
    answer to shields.
  - Beast is **underpowered** (anemic 1/1 tokens) — buff the curve.
  - Dragon / Undead are **flat** (generically strong, no counter edge) — sharpen so their answers
    (Dragon→Horde/Iron, Undead→Iron/Glass) read higher than the rest.
  - Demon's matrix **holds** — leave as the reference.
- [ ] (stretch) Teach the balance runner to test realistic *mixed* boards, not just mono-tribe, so
      the win-rates reflect actual play.

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
      everywhere; falls back to the sprite when absent). Four are in (`whelp`, `imp`, `drone`,
      `drummer`); the rest of the ~30-card set still uses sprites. Source art lives in
      `C:\Game Assets\Ascent Art\Minions`; see the README in the art dir for the card-id ↔ name table.
- [ ] **Art compression.** The illustrations are ~650 KB PNGs at 512×512; fine for a handful, but
      convert to WebP (or add a build-time compress) before the full set lands so the bundle stays
      lean.
- [ ] Vendor the full Build Handoff v2 into `docs/handoff.md` (currently in-session only).
