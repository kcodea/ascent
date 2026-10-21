# 2026-10-21: the mode screen shifts its content, not the whole screen

**Owner ask (2026-10-21):** "clicking into gauntlet, learn, and versus all have a glitchy flash of the 'play modes'
before entering their view. practice does a quick fade out/in of the full ui. I don't want the full fade out/in, but i
want the janky flash of the old ui gone, too. it should be a clean, seamless menu shift going into the different views."

Rule: `R-MENU-VIEW-SWAP-01` (packages/rules/src/registry/approved/foundation.ts). Branch `fix/menu-mode-transitions`.

## The causes (main at 646a9b6af)

- **Gauntlet, Learn, Versus.** Each view was its own full-screen `SidebarHost` (Title.tsx:506, :476, :518) mounted
  OVER the mode home. Two things happened in the same commit:
  1. the home's content box was keyed `titleView === 'modes' ? navHopAt : 'sub'` (Title.tsx:443), so the key flipped
     to `'sub'`, the home content remounted and replayed its `menu-rise` tile stagger underneath;
  2. the new host was not a sidebar hop, so it wore `.modepick { animation: fadein 0.3s }` (styles.css:8713): the
     whole host, sidebar and backdrop included, faded in from opacity 0 over the home.
  The tiles (rising again) showed through the fading host for ~0.3 s: the flash.
- **Practice.** `startPractice` sets `showTitle: false` (store.ts:2746), so `Title` returned null (Title.tsx:169) and
  the whole title and mode home unmounted; `PracticeOptions` (mounted in Game.tsx:610) brought its own host that faded
  in over 0.3 s. Its crumb wrote `cancelPracticeSetup()` then `setTitleView('modes')` (PracticeOptions.tsx:129), which
  remounted the title (`.titlescreen { animation: fadein 0.3s }`): the full fade out and in.
- No lazy chunks or Suspense are involved: every view is in the main bundle.

## The fix

- **One host** (`.modepick.sb-host.mp-shell` in Title.tsx) for the home and all its views, Practice included. The
  sidebar, the backdrop and the scroller never remount.
- **`MenuViewSwap`** (new, packages/ui/src/MenuViewSwap.tsx) renders the content beside the sidebar as `.mpview`
  layers in one grid cell. On a view change the outgoing layer stays mounted as the same DOM node (nothing in it
  replays) until its exit animation ENDS (`animationend`, so a slow frame never cuts it off half faded; a 160 ms timer
  only when no exit animation runs), wearing `.mpv-out`: its content box fades and lifts 6 px over 0.14 s, inert. The incoming layer wears
  `.mpv-in`: its box rises 8 px and fades in over 0.2 s after a 30 ms beat (fill `backwards`, so it lets go of its
  layer when done). Opacity and transform only, one-shot. A same-view re-key (the rail's Play on the home) just
  remounts the home, which replays its own entrance as before.
- The host's per-view padding moved onto the layers (`.mpview`, `.mpview.mp-home`, `.mpview.mp-practice`; the touch
  overrides in touchUi.css follow), so a leaving view never moves when the next one arrives.
- **Practice** is a view: `Title` stays mounted while `practiceSetupOpen` (store unchanged), `PracticeOptions` is now
  just the content box (no host, no gate), and its crumb is ONE write, `goTo('modes')`.
- **Reduced motion:** an instant switch, no outgoing layer (the old 0.12 s home fade under reduced motion is gone).
- The phone memory rule that hid the home under another mode host now hides the shell under the tutorial nudge (the
  only `.modepick` that still stacks on it).

## Measured (prod build, headless Chrome 1920x1080, rAF uncapped, three takes per transition)

Frames over 6.25 ms in the ~0.9 s after the click (before / after):

| Transition | Before | After |
|---|---|---|
| Modes to Gauntlet | 1 to 2 | 1 to 2 |
| Gauntlet back | 1 | 1 |
| Modes to Learn | 1 | 1 |
| Learn back | 0 to 3 | 1 |
| Modes to Versus | 2 | 1 to 2 |
| Versus back | 1 to 2 | 1 |
| Modes to Practice | **27 to 28** (max 33 ms) | 1 (max 22 ms) |
| Practice back | 0 | 1 |

The one remaining frame per transition is the React commit that mounts the incoming view (7 to 20 ms); it was there
before too. p95 stays under 1 ms. Frame captures (animations slowed 40x, opacity of each layer read per frame) showed
before: the Gauntlet / Learn / Versus host fading 0.04 to 1.0 over the fully opaque home; after: the home's box fading
0.97 to 0.16 while the view's box fades 0 to 0.82, never both opaque. Reduced motion: one layer, opacity 1, at once.
