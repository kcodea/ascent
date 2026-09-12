# 2026-09-12 — Equipment is always the FX source; the Deathfibrillator bolt re-authored as a travel

Owner (2026-09-12): *"I made a deathfibrillator animation that is a target animation so the bolt should be coming
from the equipment to the target … how do we make it so that equipment can always be a starting point/source of an
effect? not sure why it's more manual."*

It was more manual because of one flag. The first Deathfibrillator def (2026-09-09) was authored ON the unit —
every layer anchored `source` — so a per-Equipment override, `useFxAt: 'target'`, pointed `source` at the aimed
body instead of the slot. The owner's re-authored def is a **travel** (a `lightning` layer in travel mode, which
spans `source`→`target`, then a detonation anchored `target`), and under that override `source === target`, so the
bolt had nowhere to travel from.

**The override is gone.** `playDef` for an Equipment use always passes `source: slot, target: body`. A def that
wants to travel starts at the button; a def that wants to play on the body anchors its layers `target`. That is
the whole contract, expressed once in `Recruit.tsx` and documented on `EquipmentDefinition`; no new Equipment
needs a flag. The owner's modified `packages/ui/src/fx/defs/deathfibrillator.json` is committed with it.
