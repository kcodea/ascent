# Triage sitting 2 — the nine trigger-family rulings

The owner cleared the nine convention cards #1282 minted when it split the `economy` family by trigger.
Five approvals, four revises. This entry records what each revise cost and the defect the sitting exposed.

## The defect: the deck was showing archived cards

Two of the four revises were written against content no player can reach. `q-conv-trigger-consume` printed
**Avarice Incarnate** as its exemplar — archived 2026-08-18. `q-conv-trigger-ruby` printed **Candle Conduit**,
also archived, and three of its six members were archived. Five archived members sat across three of the nine
cards.

`ARCHIVED_CARDS` resolve by id forever (saved runs and replays need them) but belong to no set pool, so a
convention about one rules nothing. The member filter already stripped *parked* (owner-WIP) content; it now
strips archived content the same way. Owner attention is the scarcest thing the deck spends, and it spent two
rulings on dead cards.

## The four revises

**`q-conv-trigger-buy`** — "Baseline: yes. some are different, though. Moonhowl for example adds an instance
of the effect, and does not double the amount granted." Moonhowl Mentor's golden text already reads *"Twice
per turn"*, so the engine was right; the *contract* was over-claiming. Recorded as an `extra-proc` gilding
ruling in `GILD_SHAPE_RULINGS`, alongside Gemstorm from sitting 1. Extra-proc is deliberately underivable —
an extra resolution and a doubled number print identically — so it only ever enters by owner ruling.

**`q-conv-trigger-consume`** — "Avarice gilded would gain double the stats and grant double the gold." The
family's only live member is **Enigma**, which already doubles cleanly (+2/+1 → +4/+2). Avarice is archived.
No code change; the archived-member fix is the whole remedy, and the card now reads honestly at one member.

**`q-conv-trigger-residual`** — "these families will be expanded on eventually so they shouldnt be fully
isolated cards." The four groupings the owner named map exactly onto triggers the registry already had, so
they became four real `TRIGGER_GROUPS`: `gainCard` (Gangplank, Kegheart Dwarf), `startOfTurn` (Fel Conjurer),
`spellTargeted` (Reflector, Mirrorwing), `shopRefresh` (Hellrider). The residual bucket is now empty and the
card cannot regenerate — tombstoned in `retired.ts`. The next card authored on any of those triggers joins a
standing convention instead of re-opening a settled question.

Three of the four hold a single card today, which made a latent wording bug visible: *"All 1 of these fire
… · 1 cards"*. Every count-bearing string now reads naturally at n = 1.

**`q-conv-trigger-ruby`** — "we should probably standardize our ruby terminology to 'cast.' the term 'Played'
should be a global modifier for when a card is played from hand specifically."

Owner scope decision (asked, 2026-08-28): **writing rule, not a printed keyword**. "Cast" replaces "play" in
all Ruby text; "Played" stays plain English, reserved by convention for a card leaving your hand. No new
keyword and no tooltip — that would be a vocabulary pass across every set, and the owner parked it.

29 player-facing strings changed across 11 Kobold/Dwarf minions, 2 spells, 6 runes and one quest line. The
swap refuses to cross another `play`, so Rune of the Lapidary still reads *"After you play **6 cards**, cast
a **Ruby** …"* — the first `play` is a card play and the owner's rule protects it. Factory and event ids
(`onRubyPlayed`, `rubyCast`) keep their names: they are internal, and renaming them would churn run state for
a display-only change.

## Board

113 → 116 rules; pending 9 → 4 (the four new trigger families, all fresh). Patch note added under
"Ruby Wording".
