# Doc Bot blind spots — the path to true-QA depth

Written 2026-08-26, after the owner's War Drum report exposed blind-spot class 1. This is the **documented
path to resolution** for the eight known blind-spot classes — what Doc Bot cannot catch today, the concrete
instrument or fix for each, and how far each design gets us. Companion to
[`docbot.md`](docbot.md) (what exists) and [`docbot-roadmap.md`](docbot-roadmap.md) (measured capture).

**The framing that sorts everything:** Doc Bot today is an *existence prover* (every effect does something in
every phase it should). The remaining distance to a true QA bot is becoming a *correctness prover* (does the
RIGHT thing) and an *interaction prover* (does the right thing next to other cards). Measured capture on the
historical catalog is 13/14; against the full space including the classes below, the honest estimate is
60–70%.

---

## Class 1 — Run-state carry-over (recruit→combat bridge) · coverage ~0%

**The bug shape.** A per-turn run-state resource (War Drum's charged Shout, Warm Embers'
`shoutDoubleCharges`) is consumed by the recruit-side trigger counter only; an unspent charge silently
evaporates at combat. `combatModScan` sweeps *existing* `QuestCombatMods` keys — a key that SHOULD exist but
doesn't is invisible to a key-enumeration scan.

**Behaviour fix.** Thread unspent charges into the combat snapshot (new `QuestCombatMods` entries, consumed
by the combat Shout counter — every mid-fight Shout path: Parting Cry, War Chorus, Shared Scripture,
Conductor re-triggers, Thunderous Sovereign). Owner ruling already given for War Drum: the charge resets at
start of turn, so an unspent charge powers the first combat Shout.

**Instrument: the carry-over scan.** The derivation anchor is the reducer's turn-rollover reset block — any
field cleared there is by definition a per-turn resource, so the scan's subject list is DERIVED, not
hand-curated (a new per-turn field is auto-swept). For each field: arm it, run a fixture combat containing a
Shout/Rally/Echo trigger, diff `simulate()` output vs unarmed. Identical output + no excuse = alarm.
`CARRY_OVER_EXCUSED` registry for fields that genuinely have no combat meaning (e.g. `goldSpentThisTurn`),
each with a verifiable why; needs-triage ratchet for the undecided. Same two-sided-ratchet discipline as
`phaseRegistry`.

**Effort:** small (days). **Gets us:** ~all of this class — the derived subject list is what makes it stick.

## Class 2 — Magnitude & target errors · coverage ~30% → the BIG project

**The bug shape.** Card says +3/+3, gives +2/+2; buffs the wrong target or side; golden fails to double.
Differential scans assert *state changed*, never *changed by the printed amount at the printed target*.

**Instrument: the text-as-oracle scan.** The leverage we already own: the live-text HARD RULE means printed
numbers are computed by the SAME helpers the sim reads (`cardText.ts`, `spellDisplayText`, `questText`). So
the oracle exists — parse the live text's `+A/+H` (or count N), run the effect differentially, assert the
observed delta EQUALS the printed value (× golden multiplier for the golden lane). A mismatch is either a
magnitude bug or a stale text — both defects by owner ruling, so the alarm is always right.

**Tranches** (each its own ratchet, shippable independently):

1. Stat buffs (largest family; buffs are events carrying amounts — cheapest to reconcile).
2. Summon counts + token identities.
3. Gold/economy amounts (costs, gains, sell values).
4. Combat damage/heal magnitudes.

`ORACLE_EXCUSED` for genuinely non-numeric text. Seeds triage cards where printed text is ambiguous — which
is itself a text-quality audit the owner asked for.

**Effort:** the largest single build (a week+ across tranches). **Gets us:** most of class 2 — this is the
highest-value remaining instrument in the whole program.

## Class 3 — Interaction bugs (2+ cards) · coverage ~20%

**The bug shape.** Multiplier stacking, bounce loops, aura×aura, trigger-through-trigger composition. Every
scan is deliberately subject-vs-vanilla-control (that discipline is what killed the false positives), so
composition is structurally out of frame.

**Two complementary instruments:**

- **Interaction-matrix scan.** Full pairwise is hopeless (~10^5 pairs); trigger FAMILIES are not (~dozens of
  pairs). The `ascent-gameplay` skill's interaction matrix is the enumeration: Shout×replay, Echo×replay,
  Rally×repeat, multiplier×multiplier, bounce×bounce… One fixture per pair asserting the composed fire
  count. Where no owner ruling exists for the composed semantics (does Drakko × War Chorus multiply or
  add?), the scan SEEDS a triage card instead of guessing — the rulebook pipeline already handles the rest.
- **Conservation-law fuzz invariants.** Catch interaction bugs WITHOUT enumerating pairs: (a) the Gold
  ledger balances per action (Δembers = income − spends); (b) every board stat delta has a provenance
  event/fx record; (c) combat event-log reconstruction — replaying the event log over `initial` must
  reproduce the final state. Added to the existing invariant fuzz, they turn "two cards interacted weirdly"
  into a loud ledger break.

**Effort:** matrix = medium; conservation laws = medium. **Gets us:** the ruled hot pairs + a broad net for
the unenumerated rest. This class is never 100% — targeted beats random.

## Class 4 — Ordering/timing · coverage: pins only

**The bug shape.** Left-to-right resolution, trigger order within a tick, insertion order of simultaneous
effects. Determinism tests pin ONE order; nothing knows if it is the RULED order.

**Fix:** (a) golden ORDER fixtures — boards built so a wrong order produces a different outcome, pinned, so
any order change is at least LOUD; (b) the handful of genuinely ambiguous orders become triage cards (owner
rules once, the golden encodes it). **Effort:** small. **Gets us:** loudness + rulings; intent can't be
machine-derived, so this is the ceiling.

## Class 5 — Snapshot/replay fidelity · coverage: manual audits (the PR #453 class)

**The bug shape.** A new per-instance field (`impBank`, `bredThisTurn`, yesterday) silently dropped by
opponent-board capture, serialization, or replay — nothing forces the fidelity check when a field is added.

**Instrument: the snapshot-fidelity ratchet.** Build an exemplar `BoardCard`/`Minion` with EVERY field set
to a sentinel; run it through each boundary (served-board capture, save/restore round-trip, combat `initial`
snapshot); diff. Any field that does not survive must appear in `SNAPSHOT_EXCUSED` with a verifiable why
("turn-scoped, reset at rollover" for `bredThisTurn`). A new field in the type not yet in the exemplar fails
a completeness check ("classify me"). Pure excuse-registry pattern, mechanical.

**Effort:** small. **Gets us:** closes the class permanently — this and class 1 are the two cheap wins.

## Class 6 — Economy & lobby layer · coverage: fuzz only

**The bug shape.** Wrong costs/refunds, triple detection, quest reward magnitudes, placement→Rating math,
pairing rules. No differential scans exist on this layer at all.

**Fix, two halves:**

- **Economy differentials** — buy/sell/reroll/tier-up/triple against expected deltas (mostly oracle-able:
  costs are config- or text-derived, so this rides class 2's tranche 3). A recruit-side quest-reward scan
  mirroring `combatModScan`.
- **Lobby property tests** off `GAME-RULES.md`: Rating monotonicity (better placement never pays less),
  pairing invariants (eliminated seats never paired, bye rules honored), elimination exactly-once,
  end-of-lobby placement is a permutation. Property tests, not fixtures — they hold across seeds.

**Effort:** medium. **Gets us:** most of the layer; the lobby half also becomes the regression net for
future matchmaking changes.

## Class 7 — Guard correctness · coverage: owner-gated by design

**The bug shape.** A refusal guard that is over-eager (refuses a legal cast) vs correct — undecidable
without intent.

**Fix:** the half that IS automatable — the **guard-reachability test**: for every refusal guard, construct
one state where the spell SHOULD cast and assert it does. Over-broad guards get caught mechanically;
over-lenient ones remain on the policy card (`q-policy-refused-spells`, already on the board). **Effort:**
small. **Gets us:** half the class; the other half is one owner skim, which the board already requests.

## Class 8 — Presentation truth · coverage: separate tools

**The bug shape.** The sim computes the right number but the UI shows a stale one; a beat with no identity
so FX can't bind; the two text chains (`liveCardText` vs `Unit.tsx`) drifting.

**Fix:** (a) **rendered-text reconciliation** — headless-mount the card/Unit components for every scaling
card under an exemplar state and assert rendered text == the helper's output, on BOTH chains (this is
exactly where drift happens today); (b) fold `beats:audit` findings into the Doc Bot report so one command
carries both; (c) badge/stat displays, same pattern. Render *performance* stays manual per
[`performance.md`](performance.md) — its own playbook, deliberately not folded in.

**Effort:** medium (needs the jsdom mount harness once, then it's per-surface). **Gets us:** the text/badge
drift class entirely; visual/FX quality remains human.

---

## Sequencing (highest capture per effort first)

| Order | Build | Class | Effort | Why this order |
| --- | --- | --- | --- | --- |
| 1 | Carry-over scan + War Drum/Warm Embers fix | 1 | S | Owner-reported, ruling in hand, derived subject list |
| 2 | Snapshot-fidelity ratchet | 5 | S | Mechanical, permanent, already owed (`impBank`) |
| 3 | Guard-reachability test | 7 | S | Cheap half of an owner-gated class |
| 4 | Text-as-oracle, tranche 1 (stat buffs) | 2 | M | The single biggest capture jump available |
| 5 | Conservation-law fuzz invariants | 3 | M | Broad interaction net, no enumeration needed |
| 6 | Order goldens + ambiguity triage cards | 4 | S | Loudness while rulings accumulate |
| 7 | Oracle tranches 2–4 | 2, 6 | M–L | Extends the oracle to summons, economy, combat |
| 8 | Interaction-matrix scan (ruled pairs) | 3 | M | Needs rulings from the board first |
| 9 | Lobby property tests | 6 | M | Self-contained; regression net for matchmaking |
| 10 | Rendered-text reconciliation | 8 | M | Needs the mount harness; closes UI drift |

After 1–5 land, the honest full-space estimate moves from ~60–70% to ~85%; the remainder is the long tail
(unruled interactions, lobby, presentation) that items 6–10 chip at. 100% does not exist — the asymptote is
"every bug class that has EVER shipped here has a standing instrument," which this list achieves.
