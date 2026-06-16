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
      line + aim infrastructure is ready to reuse; no current card is player-targeted.
- [ ] Spell-card visual polish — the Discover spell ("Glimpse Beyond") renders as a minion-shaped
      card with the stat footer hidden; could get its own spell frame.
- [ ] Broaden golden text-doubling to Start-of-Combat AoE phrasing (Galewing/Chromatic say "3 to
      every enemy" rather than "deal 3", so the text doesn't double though the effect does).
- [ ] More combat juice — shield-break sparks, in-combat summon pops, hit-stop / shake on big blows.
- [ ] Vendor the full Build Handoff v2 into `docs/handoff.md` (currently in-session only).
