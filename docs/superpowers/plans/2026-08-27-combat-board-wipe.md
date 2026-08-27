# Combat Board + Wipe Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the matched Aug-25 board art pair (shop + combat variant) and a glowing left→right wipe that reveals the combat board on combat entry and reverses on exit, with a Pixi FX cue the owner can decorate from the workbench.

**Architecture:** A one-time registered transform (scale 0.469, dx 0, dy +260 on a 3840×2143 canvas) maps both 8192×3542 masters onto the live board's exact framing — zero CSS geometry changes. A second `.boardbg` layer paints the combat art and is revealed/hidden by a one-shot `clip-path: inset()` transition; a compositor-only glow element sweeps in sync. A `playDef('board-wipe', …)` direct call fires a starter Pixi def the owner restyles later.

**Tech Stack:** sharp (already a root dep) for the art export; CSS transitions + React state in `packages/ui`; the existing fx def system (`playDef` + `DIRECT_CALL_SITES`).

**Working directory: `C:\Users\micha\Desktop\ascent\.claude\worktrees\combat-board-wipe`** (branch `feat/combat-board-wipe`, deps installed). Every command below runs from there.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-27-combat-board-wipe-design.md` (approved by owner).
- **Never push to `main`** — this branch merges by PR after the `verify` check is green (CLAUDE.md).
- Perf rules (CLAUDE.md): no looping paint-property animations. The wipe's `clip-path` transition is **one-shot** (sanctioned category); the glow front animates `transform`/`opacity` only.
- No bare `cursor: pointer` on anything interactive (no new interactive elements are added, but keep it in mind).
- Wipe duration default **550 ms**, easing `cubic-bezier(.4, 0, .2, 1)` (owner previewed and approved this look).
- Source masters (do not move/rename): `C:\Users\micha\Desktop\Reference Art\augustboard psd.png` (shop) and `C:\Users\micha\Desktop\Reference Art\augustboardcombat.png` (combat). Both 8192×3542.
- Before claiming done: `npm run typecheck && npm run lint && npm test && npm run build:web` all green, and the wipe verified in the browser.

---

### Task 1: Art export script + the two shipped webps

**Files:**
- Create: `packages/tools/src/board-export.ts`
- Modify: `package.json` (add the `board:export` script beside `pool`/`fx:publish`, ~line 30)
- Replace: `apps/web/public/augustfullboard.webp` (binary, regenerated)
- Create: `apps/web/public/augustboardcombat.webp` (binary)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `/augustboardcombat.webp` at the site root — the URL Tasks 2 and 3 reference. Both webps are exactly **3840×2143**, WebP quality 82.

- [ ] **Step 1: Write the export script**

`packages/tools/src/board-export.ts`:

```ts
/**
 * Board art export — maps the 8192×3542 Aug-25 board masters onto the SHIPPED board's framing.
 *
 * The game's UI (buttons, zones, charge glyph) is tuned against the frame position of the original
 * `augustfullboard.webp` (3840×2143, exported 2026-08-17 from the older 5504×3072 master). The Aug-25
 * masters are the same design rendered at a tighter crop, so a fixed transform — found by image
 * registration (mean-abs-diff grid search of uniform scale + offset against the shipped webp, verified
 * by a 50/50 pixel blend showing a single crisp frame) — places their painted frame on exactly the
 * same canvas pixels. The masters carry less purple surround vertically; the shortfall is filled by
 * edge-row replication (`extendWith: 'copy'`), which the board's 1.25× overscan keeps almost entirely
 * off-screen.
 *
 * Run: `npm run board:export` (masters live in the owner's `Desktop/Reference Art`; pass
 * `--src <dir>` if they move). Re-run only when a master is re-exported; commit the webps it writes.
 */
import path from 'node:path';
import sharp from 'sharp';

const CANVAS_W = 3840;
const CANVAS_H = 2143;
// Registered transform (2026-08-27): uniform scale, no horizontal shift, +260 px vertical placement.
const SCALE = 0.469;
const LEFT_CROP = 0;
const TOP_PAD = 260;
const QUALITY = 82;

const srcFlag = process.argv.indexOf('--src');
const SRC_DIR = srcFlag >= 0 ? process.argv[srcFlag + 1] : 'C:/Users/micha/Desktop/Reference Art';
const OUT_DIR = path.resolve('apps/web/public');

const JOBS: ReadonlyArray<{ master: string; out: string }> = [
  { master: 'augustboard psd.png', out: 'augustfullboard.webp' },
  { master: 'augustboardcombat.png', out: 'augustboardcombat.webp' },
];

async function exportBoard(master: string, out: string): Promise<void> {
  const src = path.join(SRC_DIR, master);
  const meta = await sharp(src).metadata();
  if (meta.width !== 8192 || meta.height !== 3542) {
    throw new Error(`${master}: expected 8192x3542, got ${meta.width}x${meta.height} — re-derive the transform before exporting.`);
  }
  const w = Math.round(8192 * SCALE); // 3842
  const h = Math.round(3542 * SCALE); // 1661
  const dest = path.join(OUT_DIR, out);
  await sharp(src)
    .resize(w, h)
    .extract({ left: LEFT_CROP, top: 0, width: CANVAS_W, height: h })
    .extend({ top: TOP_PAD, bottom: CANVAS_H - TOP_PAD - h, extendWith: 'copy' })
    .webp({ quality: QUALITY })
    .toFile(dest);
  const outMeta = await sharp(dest).metadata();
  console.log(`${out}: ${outMeta.width}x${outMeta.height}`);
  if (outMeta.width !== CANVAS_W || outMeta.height !== CANVAS_H) throw new Error(`${out}: wrong output size`);
}

for (const j of JOBS) await exportBoard(j.master, j.out);
```

- [ ] **Step 2: Add the npm script**

In root `package.json`, next to `"pool"` (~line 30), add:

```json
    "board:export": "tsx packages/tools/src/board-export.ts",
```

- [ ] **Step 3: Run it and verify**

```bash
npm run board:export
```

Expected output: two lines, both `…: 3840x2143`. Then eyeball the alignment: view both `apps/web/public/augustfullboard.webp` and `apps/web/public/augustboardcombat.webp` (Read tool) — the gold frame must sit in the same place in both, the combat one missing the top-right tray.

- [ ] **Step 4: Typecheck the new tools file**

Run: `npm run typecheck` — expected green (the script is plain node + sharp; sharp ships its own types).

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/board-export.ts package.json apps/web/public/augustfullboard.webp apps/web/public/augustboardcombat.webp
git commit -m "feat(art): Aug-25 board pair exported onto the live board's framing"
```

---

### Task 2: Combat board layer + wipe (CSS + Recruit wiring + preload)

**Files:**
- Modify: `packages/ui/src/styles.css` — `:root` board block (~line 43–49), the stale board-name comment (~line 126), new rules after the `.boardbg` rule (ends ~line 226)
- Modify: `packages/ui/src/Recruit.tsx` — wipe state near `combatStage` (~line 1555), markup after `<div className="boardbg" …/>` (~line 5226)
- Modify: `packages/ui/src/art.ts` — `PUBLIC_ART_URLS` (~line 152)

**Interfaces:**
- Consumes: `/augustboardcombat.webp` from Task 1.
- Produces: local state `wipe: 'idle' | 'in' | 'combat' | 'out'` and the entry/exit `useEffect` in `Recruit.tsx` — Task 3 adds its `playDef` call inside that same effect.

- [ ] **Step 1: CSS — the combat layer var + rules**

In `styles.css` `:root`, after the `--board:` line (~49), add:

```css
  /* The COMBAT board — the same Aug-25 master with the top-right tray removed, exported by
     `npm run board:export` onto the identical canvas/framing as --board. Painted by a second
     `.boardbg` layer (`.boardbg--combat`) that a one-shot clip-path wipe reveals on combat entry. */
  --board-combat: url('/augustboardcombat.webp');
```

Update the stale comment at ~line 126 (`/* One board art (ascentboardnostuff) serves every resolution…`) to name the current art:

```css
/* One board art (augustfullboard, with augustboardcombat as the combat-phase variant) serves every
   resolution — drawn on `.boardbg`, cropped to 16:9 at standard aspect and extending into the margins
   on wider windows. No per-aspect --board swap. */
```

Immediately after the `.boardbg { … }` rule (after ~line 226), add:

```css
/* COMBAT BOARD LAYER — a second .boardbg painting the combat art. The modifier only swaps which art the
   shared background stack reads (`--board` is re-pointed at `--board-combat`), so the two layers can never
   drift in size or position. Revealed left→right by a one-shot clip-path transition when combat begins
   (`.wiped` added) and hidden right→left when it ends (`.wiped` removed). clip-path is a paint property,
   but this is a sanctioned ONE-SHOT transition (see CLAUDE.md perf rules). A mid-combat resume mounts the
   layer with `.wiped` already present, so it shows instantly with no transition. */
.boardbg--combat { --board: var(--board-combat); clip-path: inset(0 100% 0 0);
  transition: clip-path var(--wipe-dur, 550ms) cubic-bezier(.4, 0, .2, 1); }
.boardbg--combat.wiped { clip-path: inset(0 0 0 0); }
/* The glowing wipe FRONT — a soft blue-white energy edge riding the clip seam. Same duration + easing as
   the clip transition so the two can never desync; compositor-only transform + a short opacity gate
   (`.sweeping` while a wipe is in flight). Static blur/gradient — nothing paint-animated in a loop. */
.wipefront { position: fixed; top: 0; bottom: 0; left: -15vw; width: 30vw; z-index: 0;
  pointer-events: none; opacity: 0; mix-blend-mode: screen;
  background:
    radial-gradient(60% 50% at 50% 50%, rgba(255, 255, 255, .55), rgba(160, 200, 255, .28) 40%, rgba(90, 130, 255, 0) 70%),
    linear-gradient(to right, rgba(120, 160, 255, 0), rgba(190, 215, 255, .5) 46%, rgba(255, 255, 255, .85) 50%, rgba(190, 215, 255, .5) 54%, rgba(120, 160, 255, 0));
  filter: blur(2px); transform: translateX(0);
  transition: transform var(--wipe-dur, 550ms) cubic-bezier(.4, 0, .2, 1), opacity 120ms linear; }
.wipefront.wiped { transform: translateX(100vw); }
.wipefront.sweeping { opacity: 1; }
```

- [ ] **Step 2: Recruit.tsx — wipe state machine**

Next to the `combatStage` state (~line 1555), add:

```tsx
  // BOARD WIPE — the combat backdrop's reveal. 'in' (sweep L→R, combat art appears) → 'combat' (holding)
  // → 'out' (sweep R→L, shop art returns) → 'idle'. Advanced by the clip-path transition's transitionend;
  // a run RESUMED mid-combat initialises straight to 'combat' so the layer shows with no transition.
  const [wipe, setWipe] = useState<'idle' | 'in' | 'combat' | 'out'>(() => (run.phase === 'combat' ? 'combat' : 'idle'));
  useEffect(() => {
    if (inCombat) setWipe((w) => (w === 'combat' || w === 'in' ? w : 'in'));
    else setWipe((w) => (w === 'combat' || w === 'in' ? 'out' : w));
  }, [inCombat]);
  const onWipeEnd = useCallback((): void => {
    setWipe((w) => (w === 'in' ? 'combat' : w === 'out' ? 'idle' : w));
  }, []);
```

- [ ] **Step 3: Recruit.tsx — the two elements**

Directly after `<div className="boardbg" aria-hidden="true" />` (~line 5226), add:

```tsx
      {/* COMBAT board layer + the glowing wipe front (see `.boardbg--combat` / `.wipefront` in styles.css).
          Tree position is load-bearing: after `.boardbg` (paints above it), before the charge glyph and
          every zone (paints below them) — the same sandwich the FX canvases use. */}
      <div className={`boardbg boardbg--combat${wipe === 'in' || wipe === 'combat' ? ' wiped' : ''}`} aria-hidden="true" onTransitionEnd={onWipeEnd} />
      <div className={`wipefront${wipe === 'in' || wipe === 'combat' ? ' wiped' : ''}${wipe === 'in' || wipe === 'out' ? ' sweeping' : ''}`} aria-hidden="true" />
```

- [ ] **Step 4: art.ts — preload the boards actually shipped**

Replace the stale entry at ~line 152 (`ascentboardnostuff.webp` — no longer the board `styles.css` paints):

```ts
  `${import.meta.env.BASE_URL}augustfullboard.webp`, // the board (all resolutions; see styles.css --board)
  `${import.meta.env.BASE_URL}augustboardcombat.webp`, // the combat variant the wipe reveals — preloaded so the first wipe never uncovers a half-loaded image
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint` — expected green.

- [ ] **Step 6: Verify in the browser**

Start the dev server from THIS worktree (`npm run dev`), open it in the Browser pane, start a Practice run, pick any hero, then End Turn. Expected: the combat board sweeps in left→right under a glowing front (~0.55 s); after the fight, End Combat sweeps it back right→left; the shop board is back. Screenshot mid-wipe as proof. Also reload mid-combat (F5 during a fight): the combat board must be there instantly, no sweep.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/styles.css packages/ui/src/Recruit.tsx packages/ui/src/art.ts
git commit -m "feat(ui): combat board variant revealed by a glowing clip-path wipe"
```

---

### Task 3: `board-wipe` FX cue (starter def + direct call + registry)

**Files:**
- Create: `packages/ui/src/fx/defs/board-wipe.json`
- Modify: `packages/ui/src/Recruit.tsx` (inside Task 2's wipe `useEffect`)
- Modify: `packages/ui/src/fx/directCalls.ts` (`DIRECT_CALL_SITES`, ~line 30)
- Modify: `packages/ui/src/fx/directCalls.test.ts` (the hardcoded expected id array, ~line 135)

**Interfaces:**
- Consumes: the wipe `useEffect` from Task 2 (the call lands inside it); `playDef(id, anchors, opts)` from `./fx/playDef`.
- Produces: the committed def id `board-wipe` — the id the owner opens in the FX workbench to restyle.

- [ ] **Step 1: Commit a starter def**

`packages/ui/src/fx/defs/board-wipe.json` — a thin blue-white streak racing the front, cloned from `burst-thin-trail`'s ribbon vocabulary (straight line: `bow: 0`), 550 ms to match the wipe:

```json
{
  "version": 1,
  "id": "board-wipe",
  "duration": 550,
  "layers": [
    {
      "primitive": "ribbon",
      "anchor": "travel",
      "at": 0,
      "life": 550,
      "bow": 0,
      "params": {
        "bands": 4,
        "plateau": 0.36,
        "palette": [741288, 3115519, 11066111, 16777215],
        "blendMode": "add",
        "glow": 0.7,
        "noiseAlong": 2.4,
        "noiseAcross": 5,
        "warp": 0.3,
        "scroll": 0.9,
        "erode": 1.09,
        "gain": 1.6,
        "head": 0.05,
        "tail": 1.4,
        "soft": 2.2,
        "length": 900,
        "width": 16,
        "alpha": 0.85,
        "headPinch": 0.05,
        "tailFeather": 1.65,
        "widthCurve": [[0, 1], [0.5, 0.85], [1, 0.4]],
        "waveAmp": 0,
        "waveFreq": 3.3,
        "waveSpeed": 12,
        "drain": 900,
        "segments": 64
      }
    }
  ]
}
```

- [ ] **Step 2: Fire it from the wipe effect**

In `Recruit.tsx`, import `playDef` (top of file, beside the `pixiFx` import: `import { playDef } from './fx/playDef';` — check first: if the file already imports `playDef`, reuse it). Extend Task 2's wipe `useEffect`:

```tsx
  useEffect(() => {
    if (inCombat) setWipe((w) => (w === 'combat' || w === 'in' ? w : 'in'));
    else setWipe((w) => (w === 'combat' || w === 'in' ? 'out' : w));
    // The wipe's Pixi garnish — a def the owner authors/tunes in the FX workbench, fired along the front's
    // path (left→right entering combat, right→left leaving). `playDef` declines harmlessly (null) when the
    // renderer isn't up yet. Deliberately NOT keyed on `wipe`: this effect runs exactly once per phase flip.
    const entering = inCombat;
    const alreadyThere = entering ? wipeRef.current === 'combat' || wipeRef.current === 'in' : wipeRef.current === 'idle' || wipeRef.current === 'out';
    if (!alreadyThere) {
      const y = window.innerHeight / 2;
      const w = window.innerWidth;
      playDef('board-wipe', entering ? { source: { x: 0, y }, target: { x: w, y } } : { source: { x: w, y }, target: { x: 0, y } });
    }
  }, [inCombat]);
```

Add the ref this reads (beside the `wipe` state): `const wipeRef = useRef(wipe); wipeRef.current = wipe;` — the effect must not depend on `wipe` (it would re-run mid-sweep), so it reads the ref to skip firing when the phase flip is a no-op (e.g. mounting a resumed combat).

- [ ] **Step 3: Run the enforcing test — expect RED**

Run: `npx vitest run packages/ui/src/fx/directCalls.test.ts`
Expected: FAIL — the scan finds the `playDef('board-wipe', …)` literal in `Recruit.tsx` and prints the expected `DIRECT_CALL_SITES` object.

- [ ] **Step 4: Update the registry + test to match**

In `directCalls.ts`, add to `DIRECT_CALL_SITES` (alphabetical, after `'ale-bubbles'`):

```ts
  'board-wipe': ['Recruit.tsx'],   // the combat-entry/exit board wipe's Pixi garnish
```

In `directCalls.test.ts`, add `'board-wipe'` to the expected array (~line 136), between `'ale-bubbles'` and `'cia-hp'`.

- [ ] **Step 5: Run the fx tests — expect GREEN**

Run: `npx vitest run packages/ui/src/fx`
Expected: PASS — the scan matches, and `board-wipe` exists as a committed def (the "names every def it lists as one that actually exists" test).

- [ ] **Step 6: Verify in the browser**

Dev server still up from Task 2 Step 6: enter combat again. Expected: a thin blue streak races the glow front. (If the streak is invisible, check the console for `[fx]` warnings; the def id must match exactly.)

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/fx/defs/board-wipe.json packages/ui/src/fx/directCalls.ts packages/ui/src/fx/directCalls.test.ts packages/ui/src/Recruit.tsx
git commit -m "feat(fx): board-wipe cue — starter def fired along the wipe front"
```

---

### Task 4: Docs, patch notes, gates, PR

**Files:**
- Modify: `packages/ui/src/patchNotes.ts` (PREPEND to `PATCH_NOTES`, ~line 56)
- Create: `docs/devlog/2026-08-27-combat-board-wipe.md`
- Modify: `docs/superpowers/specs/2026-08-27-combat-board-wipe-design.md` (one stale line)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–3.
- Produces: the PR.

- [ ] **Step 1: Patch notes entry**

Prepend to `PATCH_NOTES`:

```ts
  {
    date: '2026-08-27',
    label: 'Combat Arena',
    changes: [
      {
        category: 'UI / Info',
        text: 'Combat now has its own board — a wipe of light sweeps across the table as the fight begins, and sweeps back when you return to the shop.',
        details: [
          'The shop board was also re-exported from the newest master, so the two boards match exactly.',
          'Returning to the shop plays the wipe in reverse.',
        ],
      },
    ],
  },
```

- [ ] **Step 2: Devlog entry**

`docs/devlog/2026-08-27-combat-board-wipe.md`:

```markdown
### feat(ui): combat board variant + wipe transition (the Aug-25 board pair)

Combat now plays on its own backdrop: `augustboardcombat.webp`, the owner's Aug-25 board master with
the top-right tray removed. Its shop twin (`augustboard psd.png`) replaced `augustfullboard.webp` in
the same PR, so the two phases use pixel-matched art.

**The non-obvious part — framing.** The Aug-25 masters (8192×3542) are the same design as the live
board but rendered at a tighter crop, and the entire UI (buttons, zones, charge glyph) is tuned
against the live board's frame position. `packages/tools/src/board-export.ts` (`npm run board:export`)
maps both masters onto that framing with a fixed registered transform — uniform scale 0.469, no
horizontal shift, +260 px vertical placement on the 3840×2143 canvas, found by mean-abs-diff grid
search against the shipped webp and verified with a 50/50 pixel blend (single crisp frame, no double
edges). The masters' missing vertical surround is filled by edge-row replication, which the board's
1.25× overscan keeps essentially off-screen. Re-running the export needs no re-derivation unless a
master is re-exported at a different crop (the script hard-fails on unexpected master dimensions).

**The wipe.** A second `.boardbg` layer (`.boardbg--combat`) re-points `--board` at the combat art, so
the two layers share one background stack and can't drift. Combat entry adds `.wiped` — a one-shot
`clip-path: inset()` transition (550 ms) reveals the layer left→right under a compositor-only glow
front (`.wipefront`); exit removes the class and the same transition plays right→left. A run resumed
mid-combat initialises the wipe state to 'combat', so the layer mounts already-wiped with no
transition. Skip-combat stays in the combat phase, so no wipe plays until the real exit.

**FX hook.** The wipe fires `playDef('board-wipe', …)` along the front's path (direction follows the
sweep). The committed def is a deliberate STARTER (a thin blue streak) — the owner restyles it in the
FX workbench; the direct-call registry + its enforcing test carry the new id.

Preload housekeeping: `art.ts`'s `PUBLIC_ART_URLS` still listed `ascentboardnostuff.webp` as "the
primary board" (stale since the August board shipped); it now preloads `augustfullboard.webp` +
`augustboardcombat.webp` instead.
```

- [ ] **Step 3: Fix the spec's skip-combat line**

In the spec's Edge cases section, replace the sandbox/skip wording with the observed behaviour: Skip-combat stays in the combat phase (it jumps the replay to the resolved board), so **no wipe plays on Skip** — the reverse wipe rides the eventual End Combat exit.

- [ ] **Step 4: Full gates**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green. Report the result verbatim.

- [ ] **Step 5: Commit + push + PR**

```bash
git add packages/ui/src/patchNotes.ts docs/devlog/2026-08-27-combat-board-wipe.md docs/superpowers/specs/2026-08-27-combat-board-wipe-design.md
git commit -m "docs: patch notes + devlog for the combat board wipe"
git push -u origin feat/combat-board-wipe
```

Then create the PR with the gh CLI (full path — gh is not on PATH: `& "C:\Program Files\GitHub CLI\gh.exe" pr create …`), title `feat(ui): combat board + wipe transition`, body summarising the four tasks + the owner-approved design, ending with the standard Claude Code attribution line. Watch `gh pr checks <n> --watch` until `verify` is green. **Ask the owner before merging.**

---

## Self-review notes

- Spec coverage: art pipeline → Task 1; wipe + state machine + resume/skip edges → Task 2; `boardWipe` cue → Task 3 (as a direct call — the repo's established pattern for non-per-card moments — with the starter def the def-existence test forces); preload → Task 2 Step 4; patch notes + devlog → Task 4. The spec's "cue kind + binding point" is realised as the direct-call registry entry, which is how buttons (Freeze/EndTurn/TavernUp) already expose their defs to the workbench.
- The `wipeRef` guard exists because the fx fire lives in an effect keyed only on `inCombat`; without it, mounting a resumed combat would fire a spurious streak.
- `transitionend` on `.boardbg--combat` fires once per clip-path transition; the handler is a no-op in 'combat'/'idle', so bubbling `transitionend` from children can't corrupt the state machine (the layer has no children).
