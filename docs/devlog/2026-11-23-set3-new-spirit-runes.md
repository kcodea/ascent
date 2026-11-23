# 2026-11-23: Set 3 new Spirit runes (Last Dance, Welcome Party, Bonfire, Kindred Rally, Deep Slumber)

Five Spirit runes the owner voted Yes on (Set 3 Runes review board, 2026-11-23). Set 3 only, Spirit-gated, no patch note
(Set 3 is not live). Oracle: `R-SET3-NEW-SPIRIT-01..05`.

**Deep Slumber** ("Minions in your hand gain double stats from every source") lives at the two chokepoints a held card
gains stats through: `addBuff` outside combat and `ctx.buffHand` in combat. A first version doubled the per-action hand
diff in `fireStatGainReactors`; that was wrong twice. `faceOmen` resolves the fight inside the same action, so End of Turn
gains were doubled after the fight had read the hand, and a diff that only runs on recruit-phase actions never saw Start of
Turn. If you need "whenever a held card gains stats, change the gain", use `addBuff`, not the diff.

- The extra is its own `Deep Slumber` row in the buff ledger, so readers of a source's row (Ruby tallies, a resized enchant,
  a refund) stay exact. `applyWhisperBuff` records it as its own temporary row.
- `withoutDeepSlumber` marks the writes that are not gains: a Gild, a SET (`writeStatResult`), the settle carry-back of
  combat hand gains (already doubled), a run-wide settle gain landing on a card granted in that same settle.
- The hook matches a hand card by identity, so a fresh Duos draft must be stamped (`stampDeepSlumber`).
- A Linked twin rebases on what really landed, or two Deep Slumber teammates would echo one gain forever.

**Kindred Rally** exposed an engine ordering bug: `summonCopyFromHand` marked the card as summoned only after
`summonMinion` returned, so a Rally fired by the landing could summon the same card again. The mark is now set before and
taken back if nothing landed.

**Known limits.** A run-wide gain made during a fight (Overflow, the Imp aura, Chorus Engine) reaches the hand at settle,
as it always has, so it is doubled there but a hand-summon in that fight does not carry it. `sotBeat.ts` lists board gains
only, so a Start of Turn hand gain has no row in its beat (the rune's pulse does).
