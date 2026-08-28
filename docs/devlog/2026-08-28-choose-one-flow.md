# Choose One: choose before targeting, click-away cancels, (Both) skips the prompt

**Owner rulings, 2026-08-28.** Three decisions plus a presentation ask, all on the Choose One flow.

## What the owner asked for

1. **Always choose first, then target.** One flow for every targeted Choose One: play → choose → target →
   resolve. *"You should drag the spell up, then choose one, then target a minion to buff."*
2. **Defer the summon for MINION Choose Ones.** The minion is not placed until the choice resolves; it stays
   in hand through choose → (target) → then it is summoned and its Battlecry fires.
3. **Click outside the options = cancel.** The card returns to hand untouched — no effects, no Gold moved, no
   triggers, no RNG. Cancelling during the TARGET step too.
4. **(Both) presentation.** When both branches are already enabled, skip the prompt entirely and change the
   card's printed text on every surface: the "Choose One:" label becomes a coloured **(Both)** with both
   option texts. Plus a looping marker FX (the owner authored `choose-one-both.json`), bound as a MARKER only
   — never on play.

## The shape of the fix: a Choose One play commits nothing, and is REPLAYED once the choice lands

The old flow committed first and asked afterwards — a targeted spell captured its `targetUid` at play time, and
a minion was spliced onto the board before `chooseOne` opened. Both make a clean cancel impossible: by the time
the prompt is up, the cards-played meter has moved, the body is on the board, summon buffs have fired and (with
Rune of Refrain) the RNG cursor has advanced.

So the deferral is at the very TOP of `case 'play'`, before `applyCardsPlayed` and before any branch:

```
if (def.chooseOne && !card.borrowed && !action.targetUid
    && s.chooseOnePick?.uid !== card.uid && chooseOneNeedsChoice(s, card, def)) {
  … s.chooseOne = { uid, cardId, spell, toIndex }; return s;
}
```

Nothing else happens. When the branch (and, if needed, the target) is settled, the pick is stashed in a
transient `s.chooseOnePick` and **the play is re-run from the top** via `reduceCore(s, { type: 'play', … })`.

That choice — replay rather than extract-the-tail-into-a-helper — is what makes the ordering audit trivially
true. Every consequence below the deferral point still runs in exactly the order it always did:

| consequence | before | after |
| --- | --- | --- |
| `applyCardsPlayed` (Mountainbond meter) | at play | at the replay — still once |
| `playedThisTurn` (Rune of Action, Pack Leader, Kringle) | at play | at the replay — still once |
| board splice at `toIndex` + Odelle's Exhibition sandwich | at play | at the replay, same index (captured in `chooseOne.toIndex`) |
| `playCard` → `fireSummonBuffs` / on-summon watchers | at play | at the replay |
| Attachment riders (Tempering, Replication) | at play | at the replay |
| **Rune of Refrain's 25% roll (draws off `rngCursor`)** | at play | at the replay — and still BEFORE the chosen branch resolves, so the cursor order is unchanged |
| the chosen branch (`applyChooseOne` / `applyChooseOneTarget`) | in `chooseOne` | at the same site in the replayed tail |
| `checkTriples`, the golden Discover | in `chooseOne` | at the replayed tail |
| board-cap refusal | at play | checked at BOTH the deferral and the replay, so a full board refuses outright instead of prompting |

The one *deliberate* ordering change is the whole point of the ask: the body appears on the board after the
choice instead of before it. `BoardCard.chosenOption` is therefore stamped at summon time rather than at pick
time (there is no board card to stamp before then) — `chooseOneMemory.test.ts` now pins the new moment.

## Replay compatibility

`replayActions` re-executes old logs, so both shapes must work:

- **Minions** — the action sequence is *unchanged* (`play` → `chooseOne` → maybe `battlecryTarget`), and by the
  table above the state trajectory is unchanged too. Old logs replay through the new path and land identically.
- **Targeted spells** — the old shape carried the aim on the play (`play { targetUid }`). That is now the
  legacy marker: a `play` for a Choose One card that carries a `targetUid` takes the old target-first route,
  and `case 'chooseOne'` resolves it in place (no replay, so the cards-played meter cannot double-count).
  Nothing in the live game emits that shape any more.

Both are pinned in `chooseOneFlow.test.ts`, alongside a determinism test proving open+cancel leaves `rngCursor`
and `uidSeq` byte-identical and converges on the same state as never having opened it.

## The cancel is an ACTION

`{ type: 'cancelChoice' }` — recorded like any other, so a replay lives the abandoned play the way the player
did. Registering it forced entries in the QaScenario `ACTION_TYPES` record and the production-bot
`ACTION_CATALOG` (as `generation: 'never'` — backing out returns to the same state, so it can never improve a
bot's line). It is scoped to the deferred flow: it clears `chooseOne`, or a `pendingTarget` carrying
`deferredPlay`, and refuses everything else — an ordinary battlecry aim (Toxin Tender, body already on the
board) has no clean "untouched" state to return to. `faceOmen` now abandons a deferred aim for the same reason
instead of auto-resolving a summon the player never confirmed.

## ONE predicate for (Both)

`chooseBothActive(state, card, def)` in `recruit.ts`, exported from `@game/sim`. Three sources grant "both",
and they had all drifted apart:

- `chooseBothWhenGolden` on a golden instance (Orivax) — **prompted**, then applied both;
- Rune of Facetwright on `facetwright` — **prompted**, then applied both;
- Rune of the Unbroken Vein on `k_veinbreaker` — already **skipped** the prompt.

(The task brief said two sources; the Unbroken Vein was the third, spelled out separately in the minion path.)
Every consumer now reads the one predicate: the reducer's decision to prompt, both live-text chains, the
Compendium, the drag gesture, and the marker FX. A future run-wide "your next Choose One does both" arm is one
line inside the predicate and lights every Choose One card with no other change.

The printed text is `chooseBothText(cardId, golden)` → `{{(Both)}} <branch A> <branch B>`, golden-aware, wired
into `liveCardText` (hand / board / Discover / end screen / combat via `Unit`), the shop's SPELL branch (which
renders from `spellDisplayText`, not `liveCardText` — it needed its own call), and the Compendium. It is
checked AFTER `chosenOption`, so a body that already resolved one branch keeps printing that branch even if
the rune arrives later. The old `runeModifiedNote` footnote for Facetwright is deleted — the card now READS as
doing both instead of carrying a footnote under a "Choose One:" label that is no longer true.

## The marker FX

`useChooseBothFx` runs the owner's `choose-one-both` def with `{ loop: true, follow }` on qualifying cards in
HAND, SHOP and an open DISCOVER, on the same rails as `useCiaEnchantedFx`. The only contract with card
rendering is `data-choose-both="<key>"` (`CardView.chooseBothKey`), so the effect can be re-authored or
retargeted without touching card code. It is a MARKER only — nothing fires it on play, and a test greps the
whole of `packages/ui/src` to keep it that way.

Perf: a looping player never retires on its own, so every loop is disposed when its key leaves the list, when
the tab is hidden, and on unmount. Concurrency is capped at `CHOOSE_BOTH_FX_CAP = 4` (~215 live particles per
loop at 80/s × 2710 ms life). A board-covering overlay or combat hands the hook `[]`, which is the pause.

## Judgement calls

- **The (Both) text is one flowing line**, not two lines. The card text model has no line-break marker and
  adding one would leak raw HTML into a string that tests, the Compendium and the Doc Bot text parser all read.
- **A targeted Choose One SPELL still fizzles at play time when nothing is aimable** (kept in hand, nothing
  spent) rather than prompting for a choice whose aim cannot be answered. Minions deliberately do NOT: a Runic
  Beetle with no other Beast has always played and auto-granted to itself, and it still does.
- **Crest of the Climb's aim picker now accepts tavern offers**, because its reducer target pool always did —
  the drag could hit an offer, so the picker that replaced the drag has to as well.

## Doc Bot

No movement. `docbot:text` still reports the six Choose One cards as `text-promises-absent-effect`, all already
PINNED as `draft-contract-gap` with the extractor's choose-one blind spot named. That gap lives in the WP-E
text extractor (it parses no `chooseOne[].effects` payloads), not in any surface this change touched, so it was
left typed rather than opportunistically widened here.
