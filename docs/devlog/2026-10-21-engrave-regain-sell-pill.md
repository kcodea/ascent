# 2026-10-21 · Engraved regains a lost one-fight keyword

Follow-up to #2206 (R-ENGRAVE-03). Owner: "yea if it re-gained in a 'legit' way it should carry back".

## The gap

#2206 measured combat keyword gains against the start-of-fight keyword list. A body that opened the fight with a
TEMPORARY keyword (Maw of the Pit's one-fight Ward, Lord of the Risen's one-fight Rise, a banked next-combat keyword
such as Field Maneuvers, a Whisper keyword), lost it, and then regained it from a combat effect kept nothing, because
the keyword was on its starting list.

## Mechanism

- `BoardMinion.tempKeywords` (core types): the entries of `keywords` that are one-fight only on the run card. Built by
  `tempKeywordsOf` in `playerBoardMinions` (sim reducer) from `tempShield` (DS), `tempReborn` (R) and
  `whisperKeywords`. No combat effect reads it. Served lobby snapshots do not carry it: they never settle.
- `simulate`: next to the existing baseline, `engraveKwPerm` = the INPUT board's keywords (before the banked
  openers stamp anything) minus `tempKeywords`. Every other baseline keyword is temporary. `scanEngravedKeywords`
  marks a temporary baseline keyword the body is seen without as lost (`engraveKwLost`); holding it again later while
  Engraved is recorded like any other gain. Permanent keywords never count. Rise copies are still skipped
  (`riseCarry`), so a risen copy regaining its Ward carries nothing.
- `settleCombat`: a carried keyword the card holds temporarily drops its mark (`tempShield` / `tempReborn` /
  `whisperKeywords`), so the post-fight strip or the next Start of Turn leaves it in place.

## Decisions

- Permanent keyword lost and regained: nothing reported (the card already keeps it), so the recap shows no "+Ward".
- Foamguard: a Foamguard whose Ward was temporary now keeps the Ward it regains; one with its printed Ward reports
  nothing.
- Rebirth gains carry (Rebirth is the same body, R-RISE-06), unchanged; cited in R-ENGRAVE-03.
- A keyword stamped on at combat start by a run-wide aura is treated as temporary too (it is not on the run card).
