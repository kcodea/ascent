# 2026-09-23 — Announcer: the Runeforge lines never played; the combat and return lines wait a second longer

Owner report (verbatim, the same day the announcer shipped in #1653): *"i dont think the runeforge voicelines are
playing? and can you slightly delay the combat and return to shop ones? they play too quickly and should be offset
by about 1s."*

## The forge lines: root cause

The Runeforge / EpicRuneforge detector keyed on `runeforgeOffer` APPEARING between two store updates, but only in
the "within a shop turn" branch of `syncAnnouncer`. The scheduled forges (turn 6 Basic and turn 9 Epic for every
hero, a Runesmith's turn 5, a Guardian's turn 8, a booked Clock forge) open INSIDE the reducer step that returns
the run to the shop: `resolveCombat` → `advanceCombat` → the turn-start sequence → `openNextStartOfTurnModal` sets
`runeforgeOffer` (`packages/sim/src/reducer.ts`, the `advanceCombat` turn-start block and the `resolveCombat`
case). So the store publishes ONE update carrying both the phase flip (combat → recruit) and the offer, and the
return branch of `syncAnnouncer` `return`ed before the forge check ever ran. The line was never detected, let alone
dropped.

Reproduced in the live game before the fix (a Practice run driven through the store on a worktree vite, times
relative to the run start, `window.__announcer.log`): the return to wave 6 (`resolveCombat` at +36549 ms) already
carried `runeforgeOffer`, and the announcer log had NO `runeforge` entry at all (not a `queue`, not a `drop`), so it
was not the cooldown: the detector never saw it. The cooldown was the second-order suspect (a BackToShop playing
at the return, ~30 ms after `resolveCombat`, then the forge opening seconds later inside its 12 s), but with the
forge opening in the same update there were never "seconds later".

## The fix

- **`detectForge(slice, prev, run, notBefore)`** is one helper called from BOTH branches: the return branch (with
  the return delay, so the forge line, BackToShop and TopFour / TopTwo of that return are weighed together by
  priority; the forge outranks BackToShop, which is dropped as outranked and stays unfired for a later return)
  and the within-turn branch (a forge that opens behind a quest offer or a Discover arrives on its own update, as
  before).
- **The forge lines bypass the cooldown** (`bypassCooldown`, the flag SurviveUnder10hp already used), never a
  playing line: they wait for it to end, then speak. Why: the forge is a scheduled, once-per-run moment that takes
  the whole screen, and a Face Omen or verdict line followed by a short fight (or an early End Combat) lands the
  opening inside the previous line's 12 s; the browser run showed exactly that (a turn-8 EnteringCombatAfterLoss
  ending ~1 s before the turn-9 return dropped the Epic line "cooldown", once per run, gone). The pump now picks
  the highest-priority BYPASSING line when inside the cooldown instead of dropping every ready line; the other
  ready capped lines are still dropped, a terminal line still waits.

## The delays

| Constant | Was | Now | Applies to |
|---|---|---|---|
| `ANNOUNCER_FACE_OMEN_DELAY_MS` | 600 | **1600** | EnteringCombat, EnteringCombatAfterLoss, StartCombatUnder10hp (after the Face Omen flip) |
| `ANNOUNCER_BACK_TO_SHOP_DELAY_MS` | (none, ~30 ms) | **1000** (new) | BackToShop, TopFour / TopTwo, and a forge opening WITH the return (after `resolveCombat`) |
| `ANNOUNCER_COMBAT_SILENCE_MS` | 3000 | 3000 | unchanged: the lines detected DURING the fight (the verdict lines, the combat board stat) |

How the Face Omen delay and the 3 s combat silence interact: the silence floor applies to what is detected during
the resolution, never to the Face Omen lines, which are the entry itself and now play at +1.6 s, inside that
window on purpose (the judgement call from the original entry stands). A Face Omen line that plays ends around
+3 s, so a verdict landing at the 3 s floor is inside its 12 s cooldown anyway; nothing about that changed.

## Verification

- `packages/ui/src/announcer.test.ts` (51, was 46): the three return-timing tests now wait
  `ANNOUNCER_BACK_TO_SHOP_DELAY_MS`; the cooldown test is pinned on Equipment (which recurs) instead of the forge;
  new: BackToShop at exactly +1000 ms and not before; the turn-6 Basic forge opening WITH the return plays,
  outranks that return's BackToShop (dropped, unfired, heard on a later return); the turn-9 Epic variant with the
  return; a forge that opened with the return is not detected twice while it stays open and TopFour still
  outranks it; the forge lines bypass the cooldown but wait for a playing line.
- Browser (worktree vite on 5259, own tab, Practice runs driven through the store, `window.__announcer.log`, ms
  from the run start): before the fix, the wave-6 return at +36549 with `runeforgeOffer` set and no `runeforge`
  entry in the log. After: Face Omen at +25073 → EnteringCombat played **+26674 (+1601 ms)**; `resolveCombat`
  at +49520 → BackToShop played **+50520 (+1000 ms)**; the wave-6 return at +89290 with the forge open →
  `runeforge` queued in that same update, played **+90301 (+1011 ms)**, `runeforge-1`; on a second run the
  wave-9 return at +23092 → `epicRuneforge` played **+24092 (+1000 ms)**, `epic-runeforge-1`; `announced.fired`
  recorded `runeforge: [6]` / `epicRuneforge: [9]`.
- Oracle: `R-PRESENT-07` amended (statement + currentBehaviour, the owner quote as evidence). Patch note
  (Systems, 2026-09-23).
