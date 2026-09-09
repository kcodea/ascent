# 2026-09-09 — Bug Board round 2: ten reports, four fixes, four already fixed, two by design

The second work order from the in-game Bug Board (`.local/bug-reports/work-order.json`, ten reports,
owner-ranked). Each was reproduced from its capsule with `npm run bugs:repro`, diagnosed by a read-only agent
per report (the player's text treated as an untrusted claim; state, actions and event logs as the evidence),
fixed with a lane where a fix was due, and closed with `npm run bugs:close`.

## Fixed in this stack

**Skybound Ascendant reaches Tier 7 always** (`cb45dc41`). First closed as by-design — the transform was
clamped to the run's Tier-7 access gate and the live text rewrote "Tier 7" to "Tier 6" without it. Owner
overruled within the hour: *"it should work up to tier 7 always. it is not bound by t6 rules."* The ceiling is
now 7 on every run, the "Tier 6" rewrite is gone, and the lane that pinned the clamp now pins seven.

**Kindness's targeted Gifts did nothing** (`9852e16f`, filed as "great presets … broken on mirrorwing").
Not Mirrorwing. Unbridled Might, Ironclad Favor, Champion's Regalia and Parting Gifts all read
`payload.target` — the Battlecry-target call shape — and `applyCastEffects` only ever sent `{ minion }`, so
each consumed the card, counted the cast, and changed nothing. The cast path now sends the target too.
`gifts.test.ts` pins all four payouts, and that a Gift on Mirrorwing pays once without feeding its
first-Shop-spell re-cast (a Gift is never a Shop spell).

**Rope Wrangler showed 2× the cards it stole** (`bb5195d5`, `af51e5a3`). A recruit beat scope discovers its
consequences by diffing state around `run()`; a scope opened INSIDE it (`castSpell` opens one per cast)
diffs the same window, and the outer scope's baseline predates the cast — so every stolen card, and every stat
the cast changed (Arnold's Beefy read +16/+16 for +8/+8), was emitted at both levels. `withRecruitTrigger`
now keeps a frame stack: a parent flushes what it did before a child opens and re-bases after it closes, so
each scope emits only what it changed. Un-nested scopes are unchanged; the diff logic itself moved verbatim
into closures. `eotNestedGrantEmission.test.ts`.

**Hawkus ignored the Rune of Rallying's free Rally** (`7e04222d`). On the capsule Hawkus fired on every real
Rally swing (three Wardkeeper Shout fires each, Dragonflame climbing +6 per proc — Shop-spell power, invisible
on the board, which is why it read as "nothing"). The one Rally it missed was the rune's Start-of-Combat free
Rally: `fireFreeRally` ran only the rallier's own effects while already counting the trigger for quests. A free
Rally now reaches the RL-gated watchers (Hawkus, Paragon / Standard Bearer, Mineral Master) without emitting an
attack, so ally-attack watchers stay quiet. `freeRallyWatchers.test.ts`.

**Coppercoat Spellsword's option-2 art could not be framed** (`507425ef`). The tuner opened its session under
the branch key (`n2_spellsword2`) but mounted the editor only when the key equalled the base id. `Card.tsx`
mounts it under the variant key; pinned in `chooseOneArt.test.ts`. The crop itself is the owner's to dial —
double-click the resolved option-2 card in the dev tuner and Save writes a branch entry.

## Already fixed before the report was worked

- `9fceed6b` timer after Save & Quit — #1324 (`turnClockReset`); the reported build predates it.
- `224af0ee` Crest of the Climb on Reflector — the shared once-per-turn allowance; the card text was the
  defect, fixed in #1326. Added the behavioural lane that PR lacked (`reflectorSharedAllowance.test.ts`).
- `5c5b50a0` Rune of Open Enrollment overflow — #1325; re-verified by driving four Refreshes on the capsule.

## By design

(Skybound was here for an hour — see above.)

- `38d186a6` Gangplank buffs itself — "a random friendly Dwarf" includes itself; the repo excludes self only
  where a card says "other". **Owner question:** should it read "another friendly Dwarf"? One line in the
  shared arena body + text + patch note if so.

## Method notes

- Three of ten reports were already fixed on `main`; the board's status never moved because nobody closed
  them. Closing is part of the fix.
- A synthetic Parting Gifts fixture with four Riverdrakes TRIPLED the target's siblings mid-test — use
  distinct cards when a lane needs several bodies.
