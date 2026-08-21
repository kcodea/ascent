# 2026-08-21 — Cut Cia's enchant FX the instant combat begins

Owner report: the seamless `cia-hp` enchant loops kept **emitting during the fight** — enchant particles bled
onto the board through the shop→combat transition instead of stopping when End Turn was pressed.

**Cause (not a fade).** `cia-hp` renders on the *shared* `over` overlay canvas (there is no per-effect layer;
just `over` and `under`). The loops are driven by `enchantedUids = run.shop.filter(o => o.enchanted)` in
`Recruit.tsx`, and `Recruit` stays mounted through combat with the enchanted offers still in `run.shop` — so
the caller-owned loops never disposed and kept emitting while the canvas faded.

**Fix (UI, one line of logic).** Gate `enchantedUids` on phase: return `[]` when `run.phase === 'combat'`. The
`useCiaEnchantedFx` controller already tears down any loop whose uid leaves the set, and that teardown is a
hard destroy (container gone, no fade) — so the enchant emitters are cut **at once** the moment combat starts.
They repopulate when the shop returns (phase leaves `'combat'`). Surgical: only the enchant loops stop; every
other effect on the shared overlay (combat FX included) is untouched.

Verified: typecheck ✅, lint 0 errors ✅, build:web ✅. Visual confirmation is the owner's at 1×.
