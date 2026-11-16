# 2026-11-16 — Ancient review pass (59 pairings)

Owner and Mike voted on all 252 Ancient pairings on the Ancient Pairings board, then the owner answered 81 open
calls on the "Ancient Calls" decision page (https://claude.ai/artifact/PRTPu9SSCx5yspdPMomFVr). 59 changes were
built in three PRs, split by hero so they could run in parallel:

- #2727 (pass 1): Auctioneer to Emissary, 20 pairings. Oracle R-ANCPASS1-*.
- #2729 (pass 2): Flash to Nadja, 22 pairings. Oracle R-ANCPASS2-*.
- #2726 (pass 3): Pete to Xerox, 17 pairings. Oracle R-ANCPASS3-*.

Owner rulings from the page that are not obvious from the code:
- The 8 "maybe too strong" flags (Flash Bonds, Gildmaster Bonds, Kindness Bonds, Magician War, Gorun Time,
  Priestess Genesis, Soren Fortune, Xerox Death) ship unchanged and are judged in playtests.
- Mike's 29 blank votes do not block: the owner's vote stands.
- Rules answers: Auctioneer War's Rally is permanent and does not stack; Indy Genesis copies are plain; Drakko
  Death makes Drakkos all types.

Merge note: pass 1 and pass 2 both extended `ancientPummelCharge` (Darah `perCombat`, Frank `repeat`); the merged
`simulate.ts` checks `repeat` first, then the `perCombat` cap.

Known gaps (real-time rule): Drakko Bonds' X, Emerald Warden Death's "Used this turn" and Gorun Death's "left this
turn" only refresh after the fight, not live mid-combat. Fixing them needs `store.ts` / replay changes.
