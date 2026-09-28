# 2026-09-28: the Collection screen + the crate opening (Pixi) + its tuner

Owner ask 2026-09-28: "make the collection screen separate and build a AAA animation for crate opening, with pixi
and everything. put a tuner in for it to test it". Oracle R-PROG-COLLECTION-01. Builds on the crates slice
(`2026-09-28-progression-crates.md`, PR #1779).

## What was built

- **The Collection is its own screen** (`packages/ui/src/progression/CollectionScreen.tsx` + `collection.css`), a
  ladder page with the menu sidebar. Reached from a new **Collection** plaque on the title (with the sealed count),
  a sidebar plaque, and the Account Level card on your Career (which now opens the screen over the Career, so Back
  returns there). Store: `showCollection` / `openCollection` / `closeCollection`, `MenuDest` `'collection'`, and
  `PAGES_CLOSED` + the replay snapshot know the flag. The plaques show once crates are live, and always in DEV.
  Sections: Crates (a big crate with the count, the next crate's name, Open, Open all), Titles (equip, unchanged
  logic), Coming soon (the categories still switched off, as quiet pills), and the guest save prompt. The old
  modal `CollectionPanel.tsx` is gone.
- **The crate theatre** (`CrateOpener.tsx`, rewritten): a full-stage overlay portalled into `stageHost()`, used by
  the Collection and the post-game "Crate earned" row. Flow: sealed -> anticipation (on the click, while the
  request is in flight; holds for a slow server, "Still opening" after 2.5 s) -> charge -> burst -> reveal ->
  settled. Failure winds down to "Could not open the crate. Try again."; an empty pool says so. A click or any key
  skips to the settled reveal (before the answer, it lands settled the moment the answer arrives). Reduced motion:
  no Pixi, a 240 ms fade. Open all chains the queue with a 700 ms pause and ends on a "You found" summary.
- **The Pixi layer** (`crateFx/`): `crateScene.ts` is the whole scene as a plain Pixi scene graph (headless
  testable): a procedural crate (layered Graphics body + lid, gold bands, a gem that takes the rarity colour),
  motes, pulled charge particles, the lid blowing off, flash, staggered shockwave rings, sparks, debris, a rarity
  aura, god rays, rising motes. `crateFxPixi.ts` owns the Application (full-theatre canvas, resolution x
  `stageScale()`), the ticker (runs only while there is work), the textures (a canvas radial gradient for the glow,
  so the upscaled aura has no banding) and the art loader. **Crate art drops in through one config key,
  `crateArt`** (a URL; empty = the drawn crate).
- **The tuner** (DEV hub, "Crate opening", `CrateFxTuner.tsx` + `crateFxConfig.ts`): every beat per rarity, the
  particle counts, crate + screen shake, flash, rings, rays, colours, six sound cues (clip, gain, offset, window),
  reverb, the art URL. Buttons: Play Common / Rare / Epic / Legendary (practice crates in the real theatre with a
  local fake answer, never the server), Replay, Slow server, Failure, Open all (4), and Speed 1x / 0.5x / 0.25x
  (never saved). Values persist to localStorage in DEV only; production plays `CRATE_FX_DEFAULTS`. Loads and
  writes are clamped (`clampCrateFxValue`).
- **Sound**: existing clips only, six new mixer faders (`crateHum` ... `crateSting`). Hum = `turncharge`, charge =
  `runeselectimplosion`, burst = `rebornshatter` (a crack, not a boom), reveal = the sparkle clip's glitter tail,
  stamp = `equipmentsheen`, Legendary sting = `triplereward`.

## The redo (owner, same day: "crate opening looks like a 2/10, i need it to be at least an 8/10")

Process: every pass was captured frame by frame at 0.25x (a headless-Chrome CDP script driving the tuner's practice
crates) and critiqued before the next change. Before/after sheets: `2026-09-28-crate-fx/` (before_rare, before_legendary,
after_rare, after_legendary).

- **Before, honestly ~2.5/10:** the crate was a small flat clip-art icon; the anticipation was invisible; the only
  rarity tell was a tiny gem; the burst was one grey ring and a flying stick while the body sat there; the reward was
  a plain dark rectangle faded over the crate; no stage, no pedestal, no camera, no blur.
- **After (my score: 8/10):** a painted chest (`crateTextures.ts`: canvas-painted once per theatre: planked wood with
  grain and knots, bronze bands and rivets, a bevelled lock plate with the game's gem art recoloured per rarity, rim
  light, a contact shadow) on a stone pedestal with a glowing rune ring, over a blurred, vignetted page. The chest
  breathes in pulses (a tick per beat), light leaks from the seam, the lid rattles; on the answer the gem ignites in
  the rarity colour, rarity light floods the seam then a web of cracks, energy streaks are pulled in, the camera pushes
  in, and big rarities end in a slow-motion hitch with the hum cut to silence. The burst layers a white flash, a
  rarity punch and bloom, 2-3 shockwave rings, a ray burst, the lid and shards flying, sparks and embers, and a heavy
  decaying camera shake; Legendary bursts twice and throws a coin shower. A light pillar holds the stage while the
  nameplate rises out of it with an overshoot: the gem pops, the name stamps, the rarity ribbon stamps with a small
  shake, a shine sweeps across; slow DOM god rays turn behind it (the Pixi ticker stops once settled).
- Sound is layered existing clips, each pitched by rarity (`<rarity>Pitch`, bigger = lower): hum, per-beat tick
  (`triggerpulse`, rising), charge implosion, burst crack (+ `divineshieldbreak` glass for Epic/Legendary), second-burst
  crack, coin clinks (`buy1`), a whoosh under the rise (`ceremony/woosh1`), the sparkle, the stamp sheen, the
  Legendary sting. `playTailedClip` gained a `rate` option for the pitch.
- New tuner values: per rarity Hitch, Embers, Coins, Camera push, Double burst, Pitch (Rays became a 0..1 strength);
  globals for the heartbeat, hitch speed, plate stagger (gem, name, ribbon, shine), backdrop blur, and five new cue
  slots (pulse, crack, whoosh, coins) with their own mixer faders.

## The shipped timeline (ms from the branch: the answer is in AND the 650 ms anticipation minimum is over)

| Rarity | Hitch at | Burst at | 2nd burst | Plate rises | Settled (buttons) | Click to buttons |
|---|---|---|---|---|---|---|
| Common | (none) | 380 | | 524 | 1624 | ~2.3 s |
| Rare | (none) | 680 | | 854 | 2154 | ~2.8 s |
| Epic | 940 | 1100 | | 1316 | 2816 | ~3.5 s |
| Legendary | 1400 | 1700 | 1985 | 1985 | 3785 | ~4.4 s |

## Perf (prod build, 1920x1080, RTX 4080 / D3D11, headless Chrome over CDP)

Every opening after the first: main-thread cost per animation frame p95 0.1-0.3 ms, max under 2 ms, no long tasks;
frame gaps at the 240 Hz display's 4.2 ms p50/p95. The Pixi canvas and GL context are gone after Done.

**The first opening of a session** has a one-time ~120-140 ms stall at the click: creating the WebGL context
(`getContext` ~110 ms, a third of it the GPU still rasterising the new blurred overlay) plus ~40 ms of Pixi start-up.
An idle pre-warm (a throwaway context of the same attributes and size) was tried and measured: it did NOT reduce it,
so it was removed. Keeping one context alive for the session would, but the brief requires full GL cleanup after each
sequence. Owner call if this is worth revisiting.

## Career (owner, same day)

- Account Level moved from the top of the right column into the left Career Stats panel, under the portrait and
  above the stat tiles; Seasonal Ranked now leads the right column.
- The player's name is the page header, large, with the equipped title beside it in its rarity colour (a small
  "Your Career" / "Career" kicker above); the small name/title under the portrait are gone. The portrait is
  labelled "Favorite hero".

## Non-obvious

- **StrictMode stranded the opening in dev.** The first cut bumped the opening's generation on unmount, and the
  dev double mount runs that cleanup right after `autoOpen` has fired the request, so the answer was dropped and the
  crate sat in "Opening" forever. The in-flight request now checks `live` (which the remount sets back), and a
  remounted theatre brings its fresh Pixi controller up to the opening's current phase. Regression test in
  `Crates.test.tsx`.
- **A box-sized canvas clipped the burst** into a hard rectangle. The canvas covers the whole theatre now, and the
  DOM (name, plate, buttons) is placed around the same centre the scene uses.
- Measuring on the prod build needs the practice crates, which are DEV only: `VITE_CRATE_PREVIEW=1` bakes them into
  a prod bundle for profiling (docs/performance.md).

## Wanted from the owner

- The first-open ~130 ms stall (above): accept, or allow one kept-alive GL context for the session.

- Crate art (drop in via `crateArt`); optionally a dedicated crate hum, burst and Legendary sting.
