# 2026-10-26 — One link benchmarks a phone (?phonebench=1), and CI phone budgets (R-PHONE-BENCH-01)

**Owner (2026-10-26, relayed):** no Mac and no device farm, so numbers come only from real devices: "make this game run
flawlessly on mobile devices ... performance is a pillar". Follows `2026-10-26-phone-perf-log.md` (#2332), which made
every phone session record and upload its frames, WebGL state and FX ledger.

## `?phonebench=1` (packages/ui/src/phoneBench.ts, PhoneBenchCard.tsx)

Open any build (Netlify, or the LAN build from `npm run phone:preview`) with `?phonebench=1` and do not touch it. In
about three minutes the page drives itself through a fixed sequence, through the real controls (synthetic touch
pointer events, so the drag, the gate and the ceremony run their real code):

1. title + mode home (menus), 2. a **God Mode** Practice game (store: `startPractice`, `setPracticeDraft({ godMode })`,
`confirmPracticeSetup`). God Mode is never saved, so the player's Continue run is untouched. The Practice config, the
remembered God Mode round and the Practice timer are restored at the end. 3. hero select, the first hero, the ceremony,
4. four rounds of: an idle shop (6 s the first time), tier up (from round 2), refresh, three buy-and-play drags (with a
wander), a reorder drag, End Turn with a late opponent board (God Mode's round prompt: rounds 10, 12, 14, 16), the
falling gate and the fight, and the trip back, 5. Leave God Mode to the title.

The perf log records it as usual and tags the payload `bench` (step, seconds, skipped steps, rounds). At the end one
report is uploaded and a card shows the summary (per-scene p50 / p95 / p99 / worst / frames over budget, WebGL, images,
audio, FX) with **Copy**. A step whose control is missing waits and moves on, and the card lists it under "skipped".
The bench module loads only with the flag (a lazy chunk), and the flag also turns the perf log on for a desktop.

**Offline caveat:** God Mode's fights need a real opponent board from the backend. Offline (the Chromium check here,
with every request off 127.0.0.1 blocked) the round prompt says "No boards found" and the card lists `fight r1..r4`
as skipped. The menus, hero select, shop and drags are still measured. On a phone online the fights run.

## The perf log gained (every phone session)

- **Images per DISTINCT URL** (`imgUniqueMb`, crash-log `iu` / `ium`). The old figure (`im`, the owner's "images 225
  (206.2 MB)") sums every `<img>` ELEMENT, so a frame or a badge shown by 14 cards counts 14 times. The browser decodes a
  URL once, so read `ium` for memory.
- **Decoded audio MB** (`audioMb`, the same probe the crash log uses).

## CI phone budgets (.github/workflows/phone-budgets.yml)

This is a new workflow and NOT a required check. It runs on PRs touching `packages/ui`, `apps/web` or the script: a
production build, then `npm run perf:phone-run -- --interact` (headless Chrome as an iPhone: title, hero select, shop,
a touch buy + play, End Turn, the first fight). It fails over these peak ceilings: iOS estimate 300 MB, live WebGL
contexts 6, decoded audio 80 MB, decoded images 140 MB. The new script flags are `--max-gl`, `--max-audio` and
`--max-img`. Measured locally on 2026-10-26: peak estimate 255 MB, WebGL 5 (8 made), audio 67.7 MB, images 108 MB. The
ceilings are set just above those numbers, so a regression fails. Tighten them as fixes land (the target for WebGL
contexts is fewer).

## Measured (Chromium, iPhone 852x393@3 emulation, prod build, offline, no throttle)

The bench ran end to end in 196-203 s (fights skipped offline, as above). Example card:

```
shop: p50 17 p95 17 p99 17 worst 467 >17 5261 >33 31 (147s)
drag: p50 17 p95 17 p99 17 worst 200 >17 846 >33 11 (24s)
WebGL 1 alive / 7 made, lost 6 ; images 8.7 MB (8.7 distinct), audio 76.4 MB
```

Headless Chromium presents at 60 Hz, so p50 reads 17 and every frame counts as over 16.7. Only the real phone's numbers
mean anything. The WebGL line was read after the trip back to the menus, where a phone tears its FX canvases down.
