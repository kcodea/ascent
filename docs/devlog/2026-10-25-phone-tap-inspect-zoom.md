# 2026-10-25 — Phones: tap a card to inspect it, a sharper Inspect, a bigger game (R-TOUCH-TAPINSPECT-01, R-PHONE-CRISP-01, R-PHONE-ZOOM-02)

**Owner asks (2026-10-25, after playing main 59507a07b on his real iPhone, no crashes).**
1. "on mobile -> holding on a minion shouldnt do the inspect, only tapping should."
2. "also the inspect looks grainy/not crisp. please fix this to make sure the game looks pristine"
3. "also the mobile version still looks really small. i feel like we can increase the scale of the game / zoom it a bit
   more since everything looks really small"

## 1. Tap inspects, hold does nothing (R-TOUCH-TAPINSPECT-01)

On main a tap on a Shop / board / hand / combat card already opened Inspect, but a ~350 ms hold on ANY card also did
(the long-press fired a synthetic `contextmenu`), and once it fired that finger could not start a drag, so a slow drag
became an Inspect. A tap on a Discover / Choose One option or a Runeforge rune took it at once.

- `touchInput.ts`: `NO_HOLD = '.card, .runecard'`. The long-press never fires there; the release of a hold there
  (`isHeldRelease`, >= `LONG_PRESS_MS`, no movement) is not a tap: no Inspect, no pick, its click eaten. Holding then
  moving is the ordinary drag (the threshold is no longer `Infinity` under a fired hold).
- `tapInspectAllowed` now accepts ANY card (scout boards, the Compendium, end screens), not only the play zones, but
  never a card inside another control, never while aiming / dragging, and never the Inspect view's own Pick
  (`clickAsPick`, a one-click bypass).
- `Card.tsx`: a touch tap inspects BEFORE the card's own `onClick` (Discover / Choose One options included); their
  Inspect already had Pick (`inspectActionFor`), which now clicks through `clickAsPick`.
- Runeforge: a touch tap on a forge rune opens `RuneInspect.tsx` (new; state in `runeInspectStore.ts`, out of the game
  store, never recorded): the tablet enlarged, the cards its reward grants beside it, Pick when affordable. On a touch
  device an unaffordable forge rune is no longer `disabled`, so it can be read (it still cannot be bought).
- Long-press kept for everything that is not a card: the emote menu on your portrait, muting a spectator, pinning a
  lobby seat's scout card, a hero select card's hover face.
- The touch help (Rules: "How do I look at a card up close?", "Can I play on a touchscreen?") says so.

Full tap mapping (touch): Shop card -> Inspect + Buy (or drag down to buy); your board -> Inspect (drag to sell /
reorder); your hand -> Inspect, the press still pops the card (drag up to play); combat, either side -> Inspect;
Discover / Choose One option -> Inspect + Pick; Runeforge rune -> rune view + Pick (when affordable); scout card /
Compendium / end screen boards -> Inspect; quest offers (not cards), hero select, buttons -> unchanged.

## 2. Crisp Inspect (R-PHONE-CRISP-01)

Measured in WebKit (Playwright, iPhone 15 Pro, DPR 3): the Inspect card's art was the 256 px phone copy drawn at ~450
device px, its plate 329 x 512 drawn at ~550 x 850, the frame 380 px at ~530: the phone copies stretched 1.4-1.7x.
`phoneArt.ts fullResUrl` maps a phone copy back to its original; `fullResArt.ts upgradeImages(root)` swaps every copy
under the Inspect card (and the RuneInspect view, and a hand card while a finger pops it, given back on release) only
after the original has decoded, so nothing blinks. Text and badges were already vector (the card is enlarged with a
transform on a non-composited element; headless WebKit and Chromium both draw its text sharp). Edge energy of the same
crop, before -> after: WebKit app 1793 -> 2722, WebKit Safari 2339 -> 3392, Chromium iPhone 2024 -> 2797, Chromium Pixel
2301 -> 3019. Cost: one inspected card decodes ~16 MB of originals (plate 800 x 1244, frame 1059 x 1427, desc box
683 x 1230, art 512), released with the view.

## 3. Bigger game (R-PHONE-ZOOM-02)

The run was bound VERTICALLY: the housed span runs from a breath above the foe's name plaque (box y 18) to your Health
plate's foot (1028), framed above the whole 21 pt gesture strip. The Health plate sits bottom LEFT, the home indicator is
a bar at the bottom centre, so it now frames down to a 4 / 393 foot instead (`PHONE_FOOT_FRAC`). The next binder is
HORIZONTAL: the lobby rail at the right safe edge was 8.6 pt right of Refresh, so `fitStage` now also fits Refresh + the
rail's footprint (`PHONE_RAIL_FOOTPRINT`, `PHONE_REFRESH_RIGHT`, `PHONE_RAIL_GAP` 6 pt) and slides the span left when it
must (never past the left safe edge). Result: iPhone 15 Pro 0.3683 -> 0.3852, Pixel 8 0.3861 -> 0.4038 (+4.6% both, the
same share of the screen), Safari-size iPhone 0.3189 -> 0.3229 (+1.3%, its 734 pt width binds). Every housed piece is at
its desktop seat and on screen; the hand, corner buttons and pop keep the gesture strip.

**Why not +15-25% (proposal, owner call).** At +20% (iPhone s 0.442) the visible safe area is ~1661 x 880 box px; today's
housed span is 1832 x 1010 plus the rail's 278 px. Getting there needs pieces to leave their painted seats:
- vertical, ~130 box px: the top pieces (the turn timer, and in combat the foe's portrait / name plaque) would move down
  onto the board frame's top edge, and/or your hero cluster (ring, Health plate, hero power, rune sockets) up and the
  Health plate tucked onto the ring (each 50 px ~ +5%);
- horizontal, ~230 box px: the rail cannot fit right of Refresh; it would collapse to its tab by default on phones
  (opening over the board on a tap), or sit over the board's right margin.
+15% needs ~90 px vertical and ~155 px horizontal (the rail still has to go).

## Verified

- **Taps, every surface, three engines** (headless Playwright: WebKit iPhone 15 Pro 852 x 393 @3; Chromium iPhone and
  Pixel 8 emulation; prod bench build): tap Shop card -> Inspect + Buy -> bought; hold a Shop card 700 ms -> nothing;
  hold then drag it to the hand -> bought; tap hand / board -> Inspect; tap a combat unit mid-fight -> Inspect; tap a
  Discover option -> Inspect + Pick (still pending) -> Pick takes it; tap a forge rune -> rune view + Pick -> bought.
- **Desktop** (1920 x 1080 and 2560 x 1080, seeded, main vs branch: title, hero select, shop, Discover, Runeforge, late
  shop, combat end): pixel-identical (the only differing pixels are the version label's dirty-build `*` and sub-16-level
  animation noise). Mouse: left-click a Shop card does nothing, right-click inspects, a Discover click picks, a rune
  click buys, as before.
- **`npm run phone:webkit`** (Home Screen and Safari sizes): all checks pass (page scale 0.3852 / 0.3229).
- **Memory** (`perf:phone-run --interact`, 2 runs each): main peak 240 / 242 MB, branch 242 / 242 MB, every step within
  run noise; `perf:phone-menus` identical. The model does not open Inspect: an open Inspect adds ~16 MB of decoded
  originals, released when it closes.
- **Perf** (prod bench build, 4x CPU throttle, frames over 17 ms; 2 runs each, iPhone / Pixel): shop idle 0 / 0 on both;
  combat p95 4.3 ms on both; drags main 7-163 (one noisy run) vs branch 3-25. Tap-to-inspect (6 Inspect opens, 5 runs
  each on iPhone): main 14 / 19 / 19 / 37 / 148, branch 20 / 21 / 24 / 107 / 107; medians 19 vs 24 with the same
  bimodal outliers on both (other sessions held the CPU). About one more dropped frame per Inspect open at 4x CPU, the
  decode of the originals.
