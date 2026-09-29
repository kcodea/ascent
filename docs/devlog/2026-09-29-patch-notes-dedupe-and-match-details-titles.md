# 2026-09-29 — Patch notes deduplicated; other players' titles in Match details

## Patch notes (R-TEXT-PATCHNOTES-01)

Merge-conflict resolutions on 2026-09-28 left three unlabeled `2026-09-28` blocks in `packages/ui/src/patchNotes.ts`
(plus a fourth holding only Level crates), with 16 changes repeated 2-3 times. Older merges had also left 11 repeated
changes under same-day, same-label blocks (New Game Start Lines, Ruby Types, Milestone glow fix, Gamble joins Set 3, ...).

Merged mechanically with the TypeScript AST (each entry's source text kept verbatim): blocks with the same date AND
label became one, and every change text kept its first copy. Every repeated copy was byte-identical, so nothing was
chosen between versions. 317 blocks / 623 changes (580 distinct) became 281 blocks / 581 changes, each once. The only
wording changes: the setting is now called "Show opponent cosmetics" everywhere (the summary line and one Match
details bullet still said "skins").

Judgement call: labeled blocks are distinct patch headlines (the viewer prints the label), so several LABELED blocks
may still share a date; the rule is one block per date + label, which means one unlabeled block per date.
`patchNotes.test.ts` fails on a repeated block key, a repeated change text, or out-of-order dates.

## Titles in Match details (R-PROG-TITLE-03)

The follow-up named in `2026-09-28-titles-review-surfaces.md`. No new data was needed: `buildMatchDetails` already
stores each seat's recorded cosmetic snapshot (`MatchSeat.cosmetics`, title included) inside the 16 KB cap, and
`parseSeat` reads it back. `MatchScoreboard` (both the end screen dialog and the Career expand) now computes
`seatTitle(seat, own, showOpponents)` once per record and each row renders `TitleBadge` beside the hero name:
your own seat as recorded (falling back to the older `titleId` field), everyone else through "Show opponent
cosmetics". Bot seats never show one; older records have none.
