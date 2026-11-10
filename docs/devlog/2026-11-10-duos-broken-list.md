# 2026-11-10 — Duos audit: the "broken" list

Fixes from the 2026-11-09 Duos audit (runtime findings F1, F3, F9, F10, F11 and the two copy findings). UI only.

## What changed

- **Phone: "Back to your board" (F1).** The tap's release left the teammate view; the browser's click 40 ms later landed
  on the re-rendered teammate portrait and entered it again. The 700 ms tap guard in `versus/DuosMateDock.tsx` now covers
  both directions (`tapsOwnClick`). R-DUOS-BACK-TAP-01.
- **Phone: empty teammate ring (F9).** Root cause is a CSS tie, worth remembering: `html.lite-art .combatopp-img`
  (the phone's "lay out 4x, scale 0.25" sharpness rule, R-PHONE-HERO-LAYER-01) and `.pf-on img:not(.pframe)` (the frame
  ring's art scale) have the SAME specificity (0,2,1), and the ring rule comes later. Inside any ring the 0.25 was replaced
  by `scale(1)`: the art was 604 px in a 151 px ring, drawn down and right of it. New rule
  `html.lite-art .pf-on .combatopp-img` applies both, centred. It covers every ringed `.combatopp-img`, not only the dock.
  R-PHONE-RING-ART-01.
- **Concede copy.** `leaveText` takes the Versus area (`concedeAreaOf(match)`: no group table = 1v1, else the room
  options' mode). R-CONCEDE-COPY-01.
- **Pass glossary.** Matches `duosPassBlocked` (a Gilded minion passes by hand; pass spells cannot target one).
  R-DUOS-PASS-GLOSSARY-01.
- **Party caption (F3).** The description line was lowered 54 units on desktop (owner 2026-11-05), which is where the team
  plate appears. `.ph-desc.headed` keeps it on its own row while the head slot holds a plate. R-PARTY-CAPTION-01.
- **Tag-in copy (F10).** `.duostagin` offset left by half a disc with no stop: a third of it was past the left edge. The
  offset now stops at the stage edge (`max()` against `--duos-hero-left`), and the copy is smaller (0.82 to 0.6) and
  higher (0.22 to 0.34 of the disc). The size and height are a judgement call, flagged for the owner.
  R-DUOS-TAGIN-ONSCREEN-01.
- **Teammate's Hero Select (F11).** Heading "Your Teammate's Heroes" (`HeroSelectWatch.title`). The 10 px jump was the
  difficulty line: it was dropped whenever an offer's three heroes share one difficulty, so two offers could differ in
  height. The line is now always kept (empty when no word shows). R-DUOS-HEROSELECT-TITLE-01.

- **Phone: portrait inboard of the corner squares (owner follow-up, same day).** A phone's stage (2208 wide) is wider than
  the play box, so `fitFoot`'s slide carried the disc past the Compendium / gear pair into the screen corner. `fitFoot` now
  fences the disc left of that pair; `DOCK_FOOT_MIN` went 0.4 to 0.35 because the phone's room between a full hand and the
  squares is 0.39 of the hero disc (103 stage px, was 157 in the corner). Desktop fit is byte-identical.
  R-DUOS-DOCK-INBOARD-01.

## Not changed, and why

- **F4, chat cut by the door.** The screenshot was taken 1.8 s into Hero Select, while the gate doors (z 700, above
  everything by design) were still sliding open over 1.5 s. Nothing is clipped once they are open.
- **F6, "YOU" badge on the teammate's plate.** The rail marks `s0` of whatever run it is given (`railView.ts`), and the
  teammate view hands it the teammate's run. The fix belongs in `LobbyPanel.tsx` / `teammateView.tsx`, both owned by
  parallel work this day. Left for a follow-up.
- **F7, clock fuse through the stat badges.** The fuse is already drawn behind every card by design, at an owner-tuned
  place (Layout Lab "Crystal Fuse"). Moving it changes authored FX placement. Left alone.

## Verification

Unit tests for each fix. Headless Chrome against a local bench bundle and a local `wrangler dev` Versus worker (two
players, Ranked Duos, desktop 1600x900 and the phone profile with `requestFullscreen` stubbed): party caption, both Hero
Select views (title and cards at identical coordinates), the phone back tap with real touch events, the phone ring art
(151 px in a 151 px ring), and the tag-in copy (forced on through `useDuosCombat`, not a real hand-off). No real phone.
