# 2026-09-23 — A bounced Ruby is the whole Ruby (Warding Ruby off Resonance Idol)

Owner report (verbatim, the 9/23 balance list under "Bugs"): *"warding ruby cast on a resonance idol that then
hits a kobold should grant it ward."*

## Root cause

The Warding Ruby's Ward was a trailing grant in the reducer's hand-play branch (`packages/sim/src/reducer.ts`,
the `def.rubyGrantKeyword` line after the Redirection block), applied to the direct target only, AFTER
`fireOnRubyPlayed` had already run the target's `onRubyPlayed` watchers. The bounce payload carried
`rubyAttack` / `rubyHealth` and nothing else, so `ARENA_EFFECTS.rubyPlayedBounce` → `gainRubyStats` landed the
stat half and dropped the keyword. The same miss hit every other hop: a Candle Conduit / Rune of the Conduit
extra bounce, and the Rune of Redirection's right-most landing.

## The fix — at the landing primitive, both phases

The keyword rider is now part of the Ruby's payload through the ONE landing primitive:

- `packages/sim/src/recruit.ts` — `fireOnRubyPlayed(state, card, a, h, rubyKeyword?)` grants the rider to THIS
  landing (new `grantRubyKeyword`, Kobold-gated per the 2026-07-31 spec, never twice), carries it on every Conduit
  hop, and puts it on the `onRubyPlayed` payload as `rubyKeyword`. The shop `gainRubyStats` adapter grants it at
  the hop destination.
- `packages/core/src/effects/arena.ts` — `EffectArena.gainRubyStats(t, a, h, grantKeyword?)`; the one
  `rubyPlayedBounce` body reads `params.rubyKeyword` and hands it to every hop (random-N and neighbours alike).
- `packages/core/src/effects/factories.ts` — the combat adapter honours the rider (`grantShield` for Ward, the
  keyword log otherwise) through the adapter's own `isTribe` (the literal is now bound to `arena` so a verb can
  lean on a sibling; no new raw `.tribe ===`, the ratchet stays pinned). No combat Ruby source casts a keyworded
  Ruby today (`playRubyOn` plays the plain Ruby), so this is parity wiring, reachable only via a payload that
  carries one.
- `packages/sim/src/reducer.ts` — the direct landing and the Redirection tail both pass `def.rubyGrantKeyword`
  into `fireOnRubyPlayed`; the trailing grant is gone.

The no-rebounce guard is untouched: a hop is still stats-and-rider only, never a fresh notification.

## What bounces now

Stats (base + every Ruby improvement in force, e.g. Deepvein / Gemcutting / Spellstone-folded spell power, since
the hand Ruby's live stats are what ride the payload) AND the keyword rider. Idol, Conduit and Redirection all
resolve the whole Ruby. A Gilded Idol's double hop stacks the stats and lands Ward once.

## Enforcement

- `packages/sim/src/wardingRubyBounce.test.ts` (6 cases: Kobold gets Ward / neutral gets stats only, plain Ruby
  grants nothing, no-rebounce with two Idols + exactly two hops recorded, a 1/2 improved Ruby bounces 1/2 + Ward,
  Gilded Idol, Redirection tail).
- Oracle: `R-RUBY-01` in `packages/rules/src/registry/approved/triggers.ts`.
- Patch note: "A Warding Ruby bounced by Resonance Idol now grants Ward to the minion it lands on."
