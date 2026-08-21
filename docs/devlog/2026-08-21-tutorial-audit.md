# 2026-08-21 — the tutorial audit: two reported locks, nine more found

Owner report: *"step 12 spotlight is still off Packstrider"*, *"step 19 is hardlocked with the hero power
use"*, and "audit it as best as you possibly can — our friends are about to play it". Both reported bugs are
fixed, and a full 12-round automated playthrough now completes all 70 steps end to end.

## The two reported bugs

**Step 12 (`r1-power`) — the spotlight sat off the card.** The step activates in the same commit as the play
that satisfied the previous one, so the anchor was measured while Packstrider was still growing into its board
slot (measured 6px small and 11px high in the live repro) — and nothing ever corrected it. A fix for exactly
this shipped on 2026-08-20… into `useAnchorRects`, **a hook nothing imports**. Its re-measure logic had never
run once. Replaced with `useAnchorMeasureTick`, which the controller's view memo actually consumes: a bounded
settle sweep on step change (0/120/300/620ms) plus resize/scroll/transition/animation events, all rAF-collapsed.
Verified live: **0px error on all three axes**, where the old path was reproducibly off.

The sweep also covers movement that emits no DOM event at all — a WAAPI or GSAP tween fires neither
`transitionend` nor `animationend`, so events alone can never be trusted to mean "it landed".

**Step 19 (`r2-power`) — hard-locked.** Three independent defects, each sufficient on its own:

1. `allowedKindsFor` switched on the TOP-LEVEL completion predicate. Every per-round hero-power reminder is an
   `any[heroPowerUsed, not heroPowerReady]`, which fell to `default: []` — and `[]` means *block every player
   verb*. The coach asked for the power while the gate silently dropped every press.
2. `heroReady` re-arms on every wave advance, but Preparation's real gate is `preparationLockUntil`. So the
   reminder's "…or the power isn't available" escape hatch could never fire: on a locked turn the flag still
   said ready. The unit test that "proved" it safe asserted a state the runtime never produces.
3. The hero-power BUTTON had the same blind spot (it checks Gambler's `diceLock` but never Preparation's), so
   a locked power looked armed and clicking it no-opped in the reducer.

Fixed with one shared `heroPowerLockTurns(run, powerKind)` in `@game/sim` — the button, the coach and the
reducer now read the same truth — plus predicate recursion through composites.

## Found while auditing (two parallel read-only auditors + a live playthrough)

- **The coach panel ate card drops.** `.tut-coach-panel` is `pointer-events: auto` at z 601, and on every
  "drag it onto your board" step it is placed above the spotlighted hand card — i.e. over the warband row.
  `Recruit`'s drop resolution hit-tests with `elementFromPoint(...).closest('[data-zone]')`, so releasing over
  the panel found no zone and **silently rejected the play**, with no nudge. One CSS line, the same idiom the
  board chrome already uses six times: `body.dragging .tut-coach-panel { pointer-events: none; }`. This is the
  highest-frequency instruction in the course.
- **Quit-to-Title mid-combat could strand the course permanently.** `combatEnded` is only ever emitted by a
  `settleCombat` action, which fires once; the resume path then *cleared* the combat log. Quitting after a
  fight resolved but before pressing "End combat" left a step waiting on an event that could never be produced
  again, with every verb gated. The resume now seeds the log from restored state, and `resolveCombat` emits
  `combatEnded` when it settles the fight itself.
- **The tutorial advanced on *attempted* actions.** `dispatch` notifies the bus whether or not the reducer
  accepted the action, and `mapAction` read only `prev` — so a refused play, an unaffordable buy or a locked
  power ticked the lesson off while nothing happened on screen. Every mapping now confirms the transition.
- **The course was never marked `completed`** — the final debrief's `resolveCombat` also ends the lobby, and
  the terminal phase turns `isTutorial` false in that same commit, so the completion effect early-returned
  forever. Every finisher was left `in_progress`.
- **`castSpell` was unsatisfiable** — declared in the contract, never emitted. Now derived from the play.
- **Unknown predicate kinds fell CLOSED.** `default: []` blocks everything, so any predicate added without a
  branch hard-locks its step — the third time that pattern has bitten. The default now falls **open**: a
  too-loose gate is a smudge, a too-tight one ends the run.
- **A full-viewport anchor is no longer a cutout.** `.discover-ov` is `inset: 0`, so spotlighting it punched a
  hole through the whole screen and clamped the coach panel across the Discover picker it was covering.
- **Never dim with nothing lit.** A step that asked for a spotlight but resolved none used to dim the entire
  board at 0.7 with no highlight — indistinguishable from a broken overlay, and the state a stranded step
  terminates in. It now drops the scrim instead.
- **A perf regression I introduced, caught before shipping**: the new measure tick listens for
  transition/animation end in capture phase, and combat fires those continuously — a per-frame layout read,
  the exact thing the module's own contract forbids. Suspended while a fight animates (nothing is spotlighted
  then anyway).

## Content and copy fixes

Round 6 claimed Tier 3 unlocks Echohorn (it is **Tier 4**); round 5 said "the minion you froze" when the
tutorial rollover discards the freeze; `r1-power` promised "free value every turn" one turn before the power
locks; "Tavern" survived in four places where the game says Shop; "line" (retired → Oath) in round 10; the
only over-length body (37 words against the ≤28 contract) was split; two debriefs titled "Well Played" on
rounds a player usually loses. Turn 3's forced attacker went 3 → 4 Attack so the scripted Echo lesson still
fires when Preparation buffs T-Rex to 3/4. Turns 10–12 gained extra shop rolls — the roll cursor CLAMPS, so
every refresh past the first re-served identical cards, in exactly the rounds that teach self-driving.

Four `TutorialStep` fields (`gate`, `safeHold`, `resultAnchors`, `analyticsTag`) are authored throughout but
read by nothing; documented as such in `types.ts` rather than left as silent traps. Notably `gate` means every
step is hard-gated regardless of its authored `soft`/`observe` — safer for a first-timer, but not what the
course claims.

## Verification

- **Automated 12-round playthrough** driving the real store: all 70 steps, ending `gameover` at wave 12 with
  the profile finally reading `status: 'completed'`.
- `tutorialGate.test.ts` (71 cases) sweeps **every authored step** and asserts the gate admits the verb that
  step's own predicate needs — verified to fail (11 cases) without the recursion fix.
- `heroPowerLock.test.ts` pins the shared lock helper against the reducer's own gate.
- Gates: typecheck ✅ · lint 0 errors ✅ · 6465 tests / 394 files ✅ · build:web ✅

## Left for the owner (design calls, not bugs)

- **Round 7's positioning lesson proves nothing.** It asks the player to drag T-Rex to the left-most slot so
  Echohorn re-fires its Echo — but T-Rex is *already* the left-most Echo (the two Packstriders are Rally, not
  Echo), so the drag changes no outcome. The course's thesis round needs a board where the move actually
  matters; that is an authoring decision.
- Three `TutorialPresentedKind`s (`echoSummon`, `elimination`, `combatDone`) are declared but never published,
  so a step keyed to one would hang. Latent — no step uses them today.
- The free rounds still offer Consume and Ruby cards whose mechanics the course never teaches.
