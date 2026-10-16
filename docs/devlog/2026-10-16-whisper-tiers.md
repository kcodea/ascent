# 2026-10-16 — Whisper tiers (R-WHISPER-TIER-01)

Owner ruling: "whispers should be the tier of the unit they came from, so you should only be able to get whispers
from your tier etc from sources like jar of secrets or woozy." Corrected the same day: the Whisper minion granting its
OWN Whisper is never gated; every other source (spell, Equipment, Echo, Avenge, Shout, rune, hero) abides by the
player's shop tier.

- **Tier is derived, not typed.** `packages/core/src/whisperTier.ts` maps each Whisper to its owners (cards with a
  `grantWhisper` marker); `packages/content/src/index.ts` stamps `tier` = lowest owner tier (Tier 1 if none) onto a
  fresh copy of each Whisper def at index build (`WHISPER_TIERS`). The `tier: 1` in `cards/set3/whispers.ts` is a
  placeholder.
- **Gate.** `mintWhisper` is gated by default; only the owner paths (`grantWhisperFrom`, the `grantWhisper` Start of
  Turn) pass `owner = true`. Combat gates at the roll (`grantRandomWhispers`).
- **Pool.** `rollableWhisperIds` (one helper, Shop + combat): Whispers of tier <= shop tier whose owner is in the
  run's pinned set (`poolOf(state)` / `poolIds`). Woozy no longer reads the global index (the `WHISPER-POOL-GLOBAL`
  exemption in `setSeparation.test.ts` is gone).
- **Tamby is exempt** (owner on PR #2111: "tamby should always copy a whisper cast on it, even above tier"), Shop and
  combat. Combat's `grantWhisperToHand` is therefore ungated; `grantRandomWhispers` pre-filters its pool.
- **Judgement calls flagged:** Whaloo's direct Runebind cast is not (no
  Whisper is gained). Jar of Secrets / Woozy text unchanged (the random-minion convention never prints the tier cap).
- Versus resolver needs a redeploy after merge (content behaviour changed).
