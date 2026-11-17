# 2026-11-16 — Discover options show their pick-time grants (Keshi × War fix)

Owner report (tooltip screenshot, Keshi × Ancient of War): the text should read "minions discovered from Keshi's
Crown's rewards have a random keyword", and the keyword "should also SHOW in the discover. if there are other effects
like this that trigger for a discover etc, it should SHOW on the discovered cards".

What "didn't work perfectly" turned out to be:
- **Scope too wide.** The keyword fired for EVERY Triple Reward (`tag === 'triple' || 'crown'`), a triple's included.
  Now only the Crown's own rewards (`crownReward`, tag `crown`).
- **Rolled at the pick, invisible on the offer.** The keyword was rolled in `ancientOnDiscoverTaken`, after the click,
  so the Discover showed plain cards. Now `rollCrownPickKeywords` rolls one per option as the offer opens (seeded, after
  Genesis' Tier 7 swap) and the pick reads that roll by index (guarded by the offer's ids).
- **Two of the eight keywords had no mark anywhere.** A granted Critical Strike or Engraved has no body visual (Rise has
  its veil, Taunt its frame, Execute its aura, …), so even in hand it was invisible. `withGrantedKeywords` ends the
  text with "**Critical Strike.**" / "**Engraved.**" like the granted Rise rule (both chains, via `liveCardText`).

The general fix (one mechanism): `packages/sim/src/discoverPick.ts`. `buildDiscoverPick` is THE pick body (creation
stats, locks, borrowed, set stats, Gilded, granted keywords, extra casts, `ancientShapeDiscoverPick`), run by
`takeDiscoverPick` and by `discoverOfferCard`, the preview the Discover overlay draws each option from (stats,
keywords, golden, golden text). A new pick-time grant goes there, never into the UI.

Covered and tested (`discoverPreview.test.ts`): Keshi × War, Gilded Discover (golden Salvatore), Rising Echoes / Grave
Invitation / quest keyword grants, Second Path stats, Quillen × Death (Echo picks Gilded), Disco Dan × Death (Rise),
Albus × Death (Empowerment Rise, also on the Shop-offer path). Underdweller Soulkeeper (Death Rise / War grave stats)
rides the same body. Not card changes, so not drawn: hand locks, Funeral on Loan's borrowed mark, Astral Draft's extra
cast, Albus × Fortune's 0 Gold (on the Shop offer it becomes). Keshi × Genesis already shows (it swaps the option ids).

Replay note: Keshi × War Crown picks now draw their keyword roll at offer open instead of at the pick, so the RNG
stream for that one Ancient pairing moved. Every other run is byte-identical.
