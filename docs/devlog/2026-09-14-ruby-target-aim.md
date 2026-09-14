# Ruby casts get their own aim effect (`ruby-target`)

The live targeting line played one def (`spell-target`) for every targeted cast. Owner wanted Rubies — and
ruby-themed targetable spells — to aim with a distinct effect (`ruby-target`).

## Wiring

`pixiFx.setAimLine` gained an optional `defId` (default `AIM_DEF_ID = 'spell-target'`), recorded on the aim
state; `updateAim` spawns `getDef(defId)` and **respawns** if a gesture's `defId` changes, falling back to
`spell-target` then the primitive default if the requested def isn't authored. `RUBY_AIM_DEF_ID = 'ruby-target'`
is exported for the caller.

`Recruit.tsx` decides the def at the two hand-cast `setAimLine` sites via `playsRubyAim(def)`:
- `def.ruby === true` (the Ruby tokens), OR
- `def.id` ∈ an explicit `RUBY_AIM_SPELL_IDS` set — currently just `rubytransfer`.

It's an explicit id set, not an effect scan, on purpose: the owner wanted `rubytransfer` in and the other
ruby-themed targetable spell (`veinstorm`) OUT (2026-09-14), so membership is a deliberate call — opt a new
ruby spell in by hand. **Targetability is implicit** — only a targetable cast draws an aim line at all, so
untargeted ruby spells (Ruby Shipment, Facetwright…) and ruby minions never reach this path. Hero powers,
equipment, and the two-target picker are unchanged (default `spell-target`).

Ships `ruby-target.json` (targeting + emitter + custom-orb, reusing the committed `test-orb` image).

Files: `packages/ui/src/pixiFx.ts`, `packages/ui/src/Recruit.tsx`,
`packages/ui/src/fx/defs/ruby-target.json`, `packages/ui/src/patchNotes.ts`.
