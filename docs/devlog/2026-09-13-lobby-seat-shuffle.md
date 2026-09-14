# 2026-09-13 — Lobby seat fill is a seeded shuffle, not a stride

Owner, after a walkthrough of how lobby opponents are picked: *"why is it not completely random? can we change it
to be completely random?"* — yes, no author cap yet ("likely in the future but not as of now").

**Before:** `createRunLobby` walked the sorted eligible-run list as `available[(seed + i * 7) % n]`. The stride was
never a distribution — a cheap "don't seat adjacent entries" — and it had two real effects: it collapsed onto one
run whenever the pool size hit a multiple of 7 (#838 patched that with a stride-1 fallback), and nearby seeds saw
near-identical tables.

**After:** a Fisher–Yates shuffle of the eligible runs on its own RNG stream (`seed ^ 0x2545f491`, distinct from
the pairing and seat-combat mixes), then the first seven that can field a round-1 board. Uniform at every pool
size, still a pure function of the lobby seed (restore and replay identical), and the #838 fallback is gone.

`seatRotation.test.ts` keeps the multiple-of-7 cases as the historical regression and pins the three new
properties: same seed → same table, consecutive seeds differ, every run reachable across seeds.

**Same PR, second ruling — unique heroes per lobby, the player included.** The hybrid loop already skipped a
held hero; the snapshot loop now does too, so two pool runs on one hero can never both sit, and a run on the
player's hero is skipped. Two older fixtures in `snapshotSeats.test.ts` had put the player and a pool run on
the same hero (and one author's two runs on heroes another run also used); their intent survives with the heroes
spread, and `seatRotation.test.ts` pins the lobby-wide uniqueness across seeds.
