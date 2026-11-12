# Gem Sage pays in combat, in real time (2026-11-11)

Owner report: "gem sage isnt granting the ruby in real time".

**What was wrong.** Gem Sage ("When you get a Ruby, also get a random Ruby") had a Shop factory only. A Ruby won
mid-fight (Rik's Rally, Kobe's Pummel, Gemline's Avenge) flew to hand live, but the Sage's extra Ruby only appeared
at settle, when the run's `mintRubies` fired `onGetRuby` on the run board. That breaks the real-time-by-default rule.

**What changed.**
- The simulator broadcasts `onGetRuby` once per Ruby from all three combat Ruby channels (`grantRubies`,
  `grantRandomRubies`, `mintRubies`).
- New combat factory `onGetRubyRandomRuby` (core `factories.ts`): each LIVING Sage on that side grants its random
  Ruby through `grantRandomRubies` (a live `toHand` sourced from the Sage), under a module latch so a Sage's Ruby
  never triggers a Sage. Either side, as every combat effect.
- Settle mints the fight's Rubies inside `withGemSagesHeld` (`recruit.ts`), so the run-board Sage does not pay a
  second time. Other get-a-Ruby watchers (Motherlode) still hear the settle mint.

**Behaviour change to know about.** Payment now follows the fight: a Sage that has died pays nothing for Rubies won
after its death. Before, the run-board Sage paid at settle whether or not it survived.

Rule: R-RUBY-03 (updated). Tests: `packages/sim/src/rubyTypes.test.ts`.
