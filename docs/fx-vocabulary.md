# FX vocabulary — the shared words for how an effect plays

The canonical terms for describing combat and shop visuals. Owner-approved 2026-08-02.

**Why this exists.** ASCENT runs a lot of interacting math at once, and the next phase of visual work is
aimed at **visual clarity and information-telling animation**: an effect should tell the player enough to
understand what actually happened. That is impossible to specify without shared words — "play it twice" and
"play it on each twice" are different animations carrying different truths, and English alone does not
separate them.

**These words are binding.** Use them in requests, in code, in commit messages, in param names. If a needed
idea has no word here, add one rather than describing it ad hoc — an undefined term is how two people ship
two different animations from one sentence.

---

## The shape: traversal × repetition

The load-bearing insight, and the thing a flat "stagger" cannot express. Two independent levels:

```
cascade( stack(2) )
  └ OUTER: recipient → recipient        └ INNER: N hits on THIS recipient
```

- **Non-gilded Frenzied Excavator** — *a cascade of singles.*
- **Gilded Frenzied Excavator** — *a cascade of 2-stacks.* NOT "two cascades".

Two cascades says *"something happened to everyone, twice"*. A cascade of 2-stacks says *"each unit got
two"* — which is what the card does. Same events, different claim.

---

## Who

| term | meaning |
|---|---|
| **subject** | the unit the moment is *about* — the card that acted (the Excavator) |
| **recipient** | a unit the effect plays on |
| **reach** | which units are recipients, *positionally*: `self` · `neighbours` · `allies` · `board` |
| **fan-out** | which units are recipients, *from the combat data*: `primary` · `damaged` · `selfBuffed` |

A unit can be BOTH. See "the subject is an ordinary recipient" below.

**reach vs fan-out** — two different questions, and they compose. Fan-out asks *"who did this moment
happen to?"* and only the combat log knows: "every unit damaged in this step" can't be answered while
authoring. Reach asks *"how far does the look spread from each of those?"* and only the author knows — it's
a choice about how the effect reads, not about what happened.

So fan-out lives on the **binding** (`FxBinding.fanOut` — a property of the moment) and reach lives in the
**def**, set in the effect editor (a property of the look). The editor is where reach belongs because reach
and timing are coupled: spreading across units needs a `gap` between them or they fire as one blur, so "the
same effect at a wider reach" is really a differently-timed composition, not a setting.

> **Not `scope`.** That word is already taken in this system: the commit panel's `scope` is `card` vs
> `global` — *where a def gets written*. Two meanings of one word in one UI is a trap; reach is the word.

## Order — how recipients are traversed

| term | meaning |
|---|---|
| **cascade** | left → right in quick succession, **overlapping**. The default sweep. |
| **ripple** | outward from the subject in both directions, ordered by distance |
| **volley** | every recipient at once, no offset |
| **chain** | sequential, each hit **completing** before the next — slow and deliberate, for rare or decisive events |

`cascade` and `chain` are both sequential; the difference is overlap. Cascade says "this swept the board";
chain says "watch this happen, one at a time". Reach for chain sparingly — it costs real time.

## Count — how many times on ONE recipient

| term | meaning |
|---|---|
| **stack** | N applications on the same recipient, played as N rapid repeats before the traversal moves on |
| **replay** | the entire traversal run again — almost never what a multiplier means |

## Timing

| term | meaning |
|---|---|
| **land** | the instant one recipient RECEIVES the payload — the atom a traversal walks over |
| **tell** | the subject's own "I am doing this" beat, before the payload leaves it |
| **lead** | delay before the first recipient |
| **gap** | between recipients in a cascade |
| **beat** | between hits within a stack |
| **tail** | after the last hit, before the effect is done |

**Rule: `beat` must be clearly shorter than `gap`.** If they are close, a cascade of 2-stacks reads as one
long cascade of eight unrelated hits and the count is lost. That ratio IS the information — it is what makes
the eye group hits into per-unit bundles.

### What a land commits

A land is not just "the effect plays". It is the instant **everything about that recipient changes at once**:

| | |
|---|---|
| the **particle** layers | fire |
| the **react** layers | fire |
| the sound | fires |
| the **stat badge** | changes value, and flashes (`statflash`) |
| the float (`+2/+2`) | pops |

Stated as a rule because the failure is easy and invisible: *if any of those four is not part of the land, it
desynchronises from the other three.* That is the shape of the open number-timing bug — the stats update in a
**volley** the moment the action resolves, while the effect **cascades** afterwards, so the player is shown
the answer and then watches the explanation.

A traversal is therefore a schedule of lands, and `gap` / `beat` are the spacing between them. Everything the
UI does for a recipient hangs off its land rather than off the action that caused it.

---

## Layer kinds — `particle` and `react`

Owner-approved 2026-08-02. Two kinds of layer, named for **what the player sees** rather than what draws
them, so the words survive a change of technology.

| kind | what it is | examples | renders with |
|---|---|---|---|
| **particle** | matter that did not exist, drawn over or under the board | gem shards, shockwave rings, dust, tendrils | Pixi |
| **react** | the CARD itself responding — it was already there, and now it moves | wiggle, jolt, scale-pop, tilt, fade | CSS / WAAPI |

Reads naturally in a request: *"bigger particle, snappier react"*; *"the gem needs a react — the card should
flinch"*; *"particle only, no react — it shouldn't disturb the board."*

Both kinds live in ONE def on ONE timeline, which is what stops them drifting apart:

```
ruby-gem-apply
  particle  burst      gemshards
  particle  shockwave  ring
  react     card       jolt + scale-pop
```

**A react layer is transform and opacity only** — `translateX/Y`, `rotate`, `scale`, `opacity`. Not a rule to
memorise: it is what a react *is*. It also means the tool cannot author the looping-paint defect CLAUDE.md
warns about, rather than a reviewer having to catch it.

**`slot` (over / under the card) is a PARTICLE-only property.** A react has no such choice — the card is where
the card is.

*Known imprecision, accepted:* `particle` also covers `shockwave`, `ribbon` and `smoke`, which are not
literally particles. Read it as "the particle side" vs "the card side". If it ever grates, this is the term
to revisit — `react` is the one doing the real work.

---

## Information channels

Each kind of information owns ONE channel, used consistently everywhere. This is what makes a visual
language rather than a collection of effects: if magnitude ever leaks into the count channel, or count into
scale, the player can decode neither.

| the player needs to know | channel |
|---|---|
| how many | **stack** count |
| how much | **scale / intensity** |
| where it came from | **travel** — a moving layer from the subject |
| who received it | **anchor** |
| what kind of thing it was | **palette / shape** |
| who caused it | the subject's **tell** |

### The subitizing ceiling

People count about **four** at a glance. Past that, repetitions stop being countable and become texture, so
a stack of 7 communicates "a lot", not "seven". Ruby counts will exceed four.

**Rule: above 4, stop stacking and change channel** — one larger hit, or a printed number. Decided up front
so it is not discovered at seven.

---

## The subject is an ordinary recipient

When the subject also receives the effect (a gilded Excavator plays 2 Rubies on itself), it **stacks like
everyone else, in its own board position.** Owner ruling 2026-08-02.

- **It is true.** The Excavator really does get 2. A single hit there while the rest show 2 makes the board
  lie about the one unit the player is watching.
- **Exceptions kill the language.** "Every recipient shows its true count" survives the next fifty cards.
  "…except the one that caused it" does not.
- **Do not reorder the sweep around it.** If the subject is third from the left, the cascade reaches it
  third. Starting or ending on the subject implies a relationship that is not there.

The subject's two ROLES are separated in time, not by suppressing either: the **tell** fires first, then the
cascade runs, and the subject takes its stack when the sweep arrives.

```
tell        the Excavator reacts               (lead)
cascade     board order, left → right          (gap)
  stack       2 hits on each recipient         (beat)
```

Reads as: *card acts → wave crosses the board → everyone got two.*

---

## Implementation note

The sweep offset is `recipientIndex × gap + repeatIndex × beat`. **Shipped for the Ruby cue** (#816, with
#828 supplying the count the engine had been discarding): gap 100, beat 50, in both the shop cue and the
combat channel.

Still owed: "walk an effect across N things with an offset" has been hand-rolled three times — the shop Ruby
cue, the combat `rubied` fan-out, and stacks — and the CSS card layer would be a fourth. It should be one
parameterised primitive. See [`fx-workbench-friction.md`](fx-workbench-friction.md).
