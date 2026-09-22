# 2026-09-21 — By-card binder: per-mechanic FX rows (Start of Combat, End of Turn, Avenge, Choose One)

The "By card" lens in Browse All Effects gained four **card-specific mechanic rows**, on top of On Play / On
Death / On Rally / On Watcher. Each appears on a card's row **only if the card actually has the mechanic**, and
each is an independently bindable/importable effect+sound slot:

| Row | Shows when | Fires |
|---|---|---|
| **On Start of Combat** | card has a `startOfCombat` effect | combat, at fight start, on the acting body |
| **On End of Turn** | card has an `endOfTurn` effect | shop, as the card's End-of-Turn beat activates |
| **On Avenge** | card has an `avenge` effect | combat, **only when the Avenge completes** (Avenge 3 → 3rd friendly death) |
| **On Choose One** | card offers a `chooseOne` | shop, as the player picks a branch |

Static detection lives in `fx/ui/cardEventSlots.ts` (`hasEffectOn` / `hasChooseOne` over `CARD_INDEX`), so the
grid auto-renders each slot wherever the mechanic is present and omits it otherwise.

## The firing paths — two of these are "free", two needed a new signal

The insight from the earlier binder work is that the combat **score** already fires `bindingFor(cardId, kind)`
for every moment kind (the `fxDef` channel), and the shop **recruit-moment** runner does the same per shop
event. So a mechanic row is only cheap when the mechanic already surfaces as a keyed moment. These four did not
— each mechanic scatters across whatever its *effect* did — so two new combat scan channels and two new recruit
moments were added, keyed by the simulator's own metadata rather than by moment kind.

### Start of Combat / Avenge — new SCAN channels in `choreo/score.ts`

Neither is a moment kind of its own: a Start-of-Combat effect's events land in `scCast` / `summon` / `buffWave`
by what it did, and an Avenge is a **bus event** (`emitAvenge`) whose payoff lands in its consequence's kind. So
a binding reached through the primary event's kind could never name the mechanic as one slot — the same problem
`rallyFx` / `shoutFx` solve by scanning. Two new channels, `startOfCombatFx` and `avengeFx` (on `BASE`, so on
every kind; `avengeFx` also rides `attackExchange` since a clash-death Avenge can absorb into the exchange),
scan the moment's events for the simulator's per-event stamps:

- **`key: 'factory:<do>:<on>'`** — so `:startOfCombat` names a SoC effect's events.
- **`avenge: true`** — set on every event an Avenge handler emits, and the Avenge factories self-gate on the
  count, so these events exist **only when the Avenge actually completed**. That is what makes "fires only on
  completion" fall out for free — no count tracking in the UI.

`srcCard` on those events is the acting **card** (its id, which is what `bindingFor` needs); the sim stamps no
uid there, so the anchor comes from the event's own `source` uid when it carried one (a cast/buff does), else
the first living body of that card (`firstBodyOfCard` — a summon-only SoC/Avenge). Both channels share one
`playCardMechanic` helper (one `playDef`, so the `directCalls.ts` count moved 7 → 8).

**Known limit:** a card that does two *different* things at Start of Combat / on Avenge (a nuke AND a buff)
lands in two moments, so the cue fires once per consequence moment — a double for those rare cards. Most cards
do one thing → one moment → one fire.

### End of Turn / Choose One — new recruit moments in `choreo/recruitMoments.ts`

Both fire in the shop, so they have no combat event. Added `endOfTurn` and `chooseOne` `RecruitMomentKind`s
with named emitters, wired from `Recruit.tsx`:

- **End of Turn** — in the authoritative End-of-Turn beat player's `onBeatActivate`, gated
  `beat.family === 'endOfTurn' && beat.mode === 'ownBeat'` (so a cadence tick that only glows, or a rune beat
  riding the same player, doesn't trip it). This is the *trigger* flourish ON the card; a buff it hands other
  minions still rides its own `minionBuffed` / `selfBuff` consequence cue.
- **Choose One** — at the branch-pick dispatch in the Choose One prompt (minion branch), keyed by the choosing
  card, on the previewed body. Distinct from On Play (`minionPlayed`), which also fires as the card lands.

## Binding vocabulary

`startOfCombat` / `avenge` join `bindings.ts` as a new `CombatMechanicBindingKind` family (sibling to
`WatcherBindingKind` — a scan-fired kind with no `SCORE_DEFAULTS` row and no recruit emitter); `endOfTurn` /
`chooseOne` are ordinary `RecruitMomentKind`s. The `bindings.test.ts` known-kinds guard and the
`recruitMoments.test.ts` "every declared kind has an emitter" invariant were extended accordingly, and
`score.test.ts` gained coverage for the two scan channels (fire once per acting card, on the acting body;
anchor fallback for summon-only payoffs; dedupe; the `canPlayDefs` / unbound / no-stamp no-ops).
