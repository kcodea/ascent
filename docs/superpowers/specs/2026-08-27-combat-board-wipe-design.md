# Combat board + wipe transition — design

**Owner ask (2026-08-26):** replace the background for the combat phase with
`Reference Art/augustboardcombat.png`, keeping the exact same on-screen dimensions as the current
board, and ease the change in with a wipe transition that sweeps across the board.

**Owner decisions during brainstorm:** horizontal sweep with a glowing front on combat entry;
**reverse wipe** (not the plain crossfade) on combat exit; ship the matched Aug-25 art **pair** —
the shop board also updates to `Reference Art/augustboard psd.png`, the combat art's identical twin
(they differ only by one authored modification: the top-right tray is removed on the combat board).
Owner previewed the wipe live (scratch page, 2026-08-27) and approved the look ("awesome"); default
duration 0.55s, kept tunable.

## 1. Art pipeline (one-time, script committed for reproducibility)

The game ships `apps/web/public/augustfullboard.webp` (3840×2143), exported from the *older* Aug-17
master. The Aug-25 masters (`augustboard psd.png` + `augustboardcombat.png`, both 8192×3542) are the
same design rendered at a different zoom/crop, so both are passed through one registered transform
that lands their painted frame exactly where the live board's frame is:

- **Transform (found by image registration against the shipped webp, mean-abs-diff grid search,
  coarse→fine):** uniform scale **0.469**, horizontal offset **0**, vertical offset **+260 px**
  (image occupies rows 260..1921 of the 2143-row canvas).
- The Aug-25 render carries less purple surround vertically; the canvas shortfall (260 px above,
  222 px below) is filled with `extendWith: 'copy'` (edge-row replication — the surround is a soft
  gradient, and the board's 1.25 zoom overscan hides all but a ~25-px sliver of it at 16:9).
- Output: two WebP q82 files at **3840×2143** — `augustfullboard.webp` (replaced in place, from
  `augustboard psd.png`) and `augustboardcombat.webp` (new, from `augustboardcombat.png`).
- Verified by a 50/50 raw pixel blend against the shipped board: single crisp frame, no double
  edges; the only ghost is the intentionally-removed tray.
- The alignment script goes in `scripts/` (or the repo's existing art-tooling home) so a future
  re-export can be re-run; it is not part of any build.

No CSS geometry changes: `--board-aspect`, `--board-zoom`, `--board-fill`, button offsets, and the
charge-glyph anchoring all stay untouched — the new files are drop-in variants of `--board`.

## 2. The wipe (CSS, dual background layer)

- `styles.css` gains `--board-combat: url('/augustboardcombat.webp')`.
- `Recruit.tsx` renders a second board layer (`.boardbg.boardbg--combat`) immediately after the
  existing `.boardbg` — same background stack but painting `--board-combat`. Both sit at z-index 0
  behind the Pixi FX layer and every zone/card.
- **Entry (recruit → combat):** the combat layer reveals left→right via a one-shot `clip-path:
  inset(0 100% 0 0) → inset(0 0 0 0)` transition (default 0.55 s, standard ease), with a glowing
  blue-white front — its own element, compositor-only `translateX` — sweeping in sync so the seam
  is always under the glow.
- **Exit (combat → recruit):** the same transition reversed (right→left), riding alongside the
  existing `combatout`/`combatin` unit crossfade. Skip-combat exits through the same reverse wipe.
- Perf: both animations are one-shot (allowed under the paint-animation rules); clip-path + transform
  only, no looping paint properties. Profile once in the prod build.
- A small wipe state machine in `Recruit.tsx` (`idle → wipingIn → combat → wipingOut → idle`),
  advanced by `transitionend`/`onAnimationEnd`, driven off the existing `inCombat` phase flag.

## 3. FX workbench hook (garnish, authored later by the owner)

The wipe fires a new FX cue kind — **`boardWipe`** — carrying `{ direction, durationMs }`. The Pixi
FX layer sits above `.boardbg` and below all cards, so a workbench def bound to this cue can ride
the glow front (sparks/embers/crackle) without covering units. The CSS wipe remains the mechanism
that swaps the background; the def is decoration and its absence changes nothing. Binding + def
authoring happen in the owner's workbench flow (`fx:publish`) and are NOT part of this PR beyond
firing the cue and registering the binding point.

## 4. Edge cases

- **Resume mid-combat** (reload / restored run in `phase === 'combat'`): combat layer shown
  instantly, no wipe.
- **First combat of a session:** `augustboardcombat.webp` joins the preload list in
  `packages/ui/src/art.ts` so the wipe never reveals a half-loaded image.
- **Skip-combat:** stays in the combat phase (it jumps the replay to the resolved board), so no wipe
  plays on Skip — the reverse wipe rides the eventual End Combat exit.
- The arena board picker is gone (owner ask 2026-08-22) — no interaction to handle.

## 5. Docs / notes in the same PR

- `packages/ui/src/patchNotes.ts`: player-facing entry (new combat arena backdrop + wipe).
- Devlog entry (`docs/devlog/2026-08-27-combat-board-wipe.md`) covering the registration transform
  and the shipped-pair decision.

## 6. Verification

- `npm run typecheck && npm run lint && npm test && npm run build:web` green.
- Play in the prod build: enter/exit combat, watch for frame drift at the wipe seam, confirm no
  hitching (DevTools performance pass on the transition), confirm resume-mid-combat shows the
  combat board with no wipe.
