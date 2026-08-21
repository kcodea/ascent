# 2026-08-21 — the tutorial goes all-Beast, thins to a duel, and reads 30% bigger

Owner pass on the freshly-audited course: *"make every minion the player finds/discovers a Beast"*, *"make the
enemy players naturally die off so there is only 1 remaining on turn 12 so it really is like a final fight"*,
and *"increase the size of the tutorial tooltips by 30%"*.

## One tribe, end to end

Every minion the course offers, asks for, or Discovers is now a **Beast**, so the synergies it teaches land on
the player's own board instead of scattering across tribes. The two Demons that carried keyword lessons were
swapped for Beasts that teach the same keyword *better*:

| Lesson | Was | Now |
| --- | --- | --- |
| Shout | Contract Butcher (Demon) — buffs shop offers, a payoff that lands where the player is not looking | **Sea Urchin** (Beast) — *"Shout: Discover a Beast"*, so the payoff is a choice in their hands |
| Start of Combat | Imp Wrangler (Demon) — summons an Imp | **Kennelmaster** (Beast) — *"give your Beasts +1 Attack"*, which on an all-Beast board visibly grows the whole warband |

Sea Urchin replaces the shop-buff payoff beat with the Discover pick itself, which needed a new
**`discovered` predicate**: a Discover step used to complete the moment the *token was played*, so the course
walked on while the modal still owned the screen and every later spotlight pointed at chrome the player could
not reach. It now waits for the actual pick. Round 8's Triple Reward gets the same treatment for free.

The remaining neutral fillers (Bank Clerk, Errand Imp, Chipwick, Geode…) became Beasts of matching tier
(Armadiyo, Bullseye, Void Panther, Dawnclaw), and a new **`tutorialDiscoverTribe`** locks every minion Discover
the course opens to Beasts — applied at `openDiscover`, the single point every Discover materializes, so no
source can route around it. The global Triple Reward token is untouched: real games are unaffected.

A test now sweeps every scripted offer and every card a step names and fails if any is not a Beast.

## The table thins into a duel

A tutorial lobby's seven opponents are authored stat-lines that all field the **same** board each round, so
their mutual fights drew, nobody was ever knocked out, and the rail stayed 8-wide through round 12 — the last
round felt like any other. The course now authors `seatsRemaining` (opponents still standing after each round:
`[7,7,6,6,5,5,4,3,3,2,1,1]`), and the lobby retires the weakest through the **real** elimination path — damage,
`alive`, placement, the rail's own knockout treatment. Entering round 12 there is exactly one opponent left.

Verified in a full playthrough: Rook falls r3, Vale r5, Ibis r7, Mira r8, Nox r10, Crown r11 — leaving Flint
for the final, and the player finishing **placement 1**.

This is an authored INPUT to an already-authored lobby (its opponents were never real runs), not a faked
outcome: the player's own combat is still simulated, and their damage still flows normally.

## Tooltips +30%

One `--tut-scale: 1.3` knob on the coach panel that every size multiplies through — box, padding, radius and
all seven text sizes (body 14 → 18.2px, title 15 → 19.5px). Deliberately **not** `zoom`, which re-resolves the
panel's `100vw` clamp in scaled units and can overflow a narrow screen. `CoachPanel`'s `PANEL_H` placement
reserve moved 200 → 260 to stay in step.

## A regression caught by playing it

Round 7's "sell something to make room" step was briefly re-pointed at a Packstrider — which silently broke
round 8, because that round teaches the golden triple by buying the **third** copy the player already holds two
of. No Triple Reward, no Discover lesson. Reverted, and pinned with a test asserting nothing the course sells
before round 8 is the card round 8 needs a third of.

## Verification

Full scripted playthrough on the branch: all 70 steps, all 12 rounds, the seat arc above, `placement: 1`,
course `completed`. Gates: typecheck ✅ · lint 0 errors ✅ · **6469 tests / 394 files** ✅ · build:web ✅ ·
`npm run audit` clean (no card entered or left a real pool).
