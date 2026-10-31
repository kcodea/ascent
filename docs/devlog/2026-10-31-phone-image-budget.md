# 2026-10-31 — phone image budget back under 140 MB (R-PHONE-RAIL-THUMB-01)

CI's `phone-budgets` (iPhone walk, `scripts/phone-run-memory.mjs --max-img 140`) had been red on every PR: peak decoded
images 141.8-148 MB. Bisected by building each commit and running the walk:

| commit | peak imgMB |
|---|---|
| #2491 (before #2492) | 133.5 |
| #2492 sharper phone hero art | 132.8 |
| #2497 | 133.4 |
| #2489 Docked rail | 137.1 (+3.7: the Docked slices used `heroPortrait`, not the classic rail's `heroThumb`: eight 384 px copies) |
| #2500 shaped hit areas | 143.0 (+6: `hitShapes.css` names the End Turn, Tier-up, Refresh art in COMMENTS; the phone-art plugin skips any public file a stylesheet mentions, so those three lost their 512 px copies: 1001 px End Turn base alone is 4.2 MB) |
| #2501 / #2503 | 146-148 (mostly run variance: random heroes and shop; the reveal adds eight more 384 px faces at its line-up) |

Fixes (no art made smaller than its drawn size):
- `apps/web/phoneArtPlugin.ts`: CSS comments are stripped before the "does a stylesheet name it" check. Restores the
  End Turn / Tier-up / Refresh copies and gives Freeze its copy for the first time (a styles.css comment had always
  blocked it); also the gilded / whisper card plates and the plate wireframe now get their 512 px phone copies.
- The Docked slice (Full art look, ~198 x 59 stage px = ~230 device px on an iPhone) is past a 160 px thumbnail, so the
  hero thumbnail is now 256 px in a new `t2/` folder (`PHONE_THUMB_VERSION`; the hashed name is the original's, so a cap
  change must change the folder). The Docked slice and the 7+ player reveal line-up (~210 device px) both load it: one
  decode per hero for the whole run. Taller-than-wide slices, small line-ups and the duel keep the 384 copy.
  (`packages/ui/src/railFaceArt.ts`.)

Measured on the same walk: peak imgMB 141.8 -> 132.6 MB (shop 141.8 -> 132.6, reveal 141.8 -> 132.4, combat 125 -> 123).
The rest of the peak is unchanged and known: ~47 MB is the lite art keep (48 MB LRU, mostly title/menu art held into the
run), ~45 MB the two boards + their shadows + the gate's two pictures. Those are the next levers if the budget tightens.
