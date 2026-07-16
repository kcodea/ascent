# Handoff: Tavern Up / Refresh / Freeze button remakes (for Mike + Claude)

> **Who this is for:** Mike's Claude Code session. Kevin's session just shipped the **End Turn diamond**
> (PR #509) and the **Hero Power diamond** (PR #510/#512) using a repeatable pattern: custom art, a
> layered button, a dedicated dev-menu tuner, and baked owner-tuned defaults. This doc is the recipe so
> the **Tavern Up, Refresh, and Freeze** buttons (currently plain plaque buttons in the shop tray,
> `Recruit.tsx` → `.shoprow.actiontray`) can follow the same playbook. Mike has the artwork already.
>
> **Read the reference implementations first — they answer most questions:**
> - `packages/ui/src/EndTurnButton.tsx` + `endTurnConfig.ts` + `EndTurnTuner.tsx` (the richest example:
>   layered arts, glow, sheen, lightning canvas, strike effects)
> - `packages/ui/src/StatusBar.tsx` (the hero-power diamond markup) + `heroPowerBtnConfig.ts` +
>   `HeroPowerTuner.tsx` (glow + art-fit dials + refresh flash)
> - `packages/ui/src/heroPanelConfig.ts` + `HeroPanelTuner.tsx` (composed-transform vars pattern)
> - `packages/ui/src/DevMenu.tsx` (how tuners register)
> - The relevant `styles.css` blocks: search `etbwrap`, `hpb-`, `hpn-`.

## 0. Workflow (non-negotiable)

- Work in **your own worktree/branch off latest `origin/main`** (`docs/concurrency.md`). These buttons
  live in `Recruit.tsx` + `styles.css`, which Kevin's session also touches — **pull main first, keep the
  branch short, and announce before starting** so we don't cross-edit the same lines.
- One PR for the feature. Before claiming done: `npm run typecheck && npm run lint && npm test &&
  npm run build:web` all green, and update `docs/devlog.md` (+ roadmap/README if relevant).
- **Perf rules apply to every effect** (CLAUDE.md): never animate paint properties (`filter`,
  `box-shadow`, `background`) in a **looping** animation — loops are opacity/transform only. One-shot
  filter changes (hover states, press flashes) are fine. `Math.random` is banned outside the UI package's
  render-only code paths; canvas rAF loops must idle cheaply (see the End Turn bolts loop for the
  `dirty`-flag pattern).

## 1. Getting the assets in

Button art goes in **`apps/web/public/frames/`** as webp (NOT `packages/ui/src/art/**` — that tree is for
`import.meta.glob`-loaded card/hero art and has a stale-glob dev-server gotcha; `public/` files are plain
URLs and never go stale). Reference them in CSS/JSX as `/frames/<name>.webp`.

Convert with sharp (already a devDependency) — one node one-liner per asset, run from the repo root:

```js
// node -e "…" — trim transparent padding, cap at 512, quality ~88
const sharp = require('sharp');
sharp('C:/path/to/source.png').trim()
  .resize(512, 512, { fit: 'inside' }).webp({ quality: 88, alphaQuality: 90 })
  .toFile('apps/web/public/frames/tavernup.webp');
```

**Multi-state buttons (normal/pressed/disabled variants) must share ONE canvas box** or the layers won't
align. Recipe from the End Turn diamond: `.trim()` the FIRST art and note its box
(`toBuffer({ resolveWithObject: true })` → `trimOffsetLeft/Top` + width/height), then `.extract()` that
same box from every sibling before resizing. If a sibling has different source dimensions, trim it
separately and pad-center onto the shared box (see the `end_button_pressed3` conversion in the devlog,
2026-07-16).

Watch for: sources on an opaque black background (check `metadata().hasAlpha` — one of Kevin's sources
looked transparent but wasn't, another was), and duplicate/alternate versions of the same art (ask Kevin
which wins; don't guess).

## 2. The component pattern (per button, or one shared component)

Each remade button is a **layered `<button>`**:

```
<button class="tvbwrap" …existing disabled/onClick logic from Recruit.tsx…>
  <img class="tvb-glow"  src=…  />   ← glow layer (see §3), z above the art
  <img class="tvb-art lit" src=… />  ← normal art
  <img class="tvb-art dim" src=… />  ← pressed/disabled variant — BOTH stay mounted, CSS flips
                                        them (no src-swap flash)
  {oneShot && <img class="tvb-flash" …/>}  ← one-shot press flash, mounts → animates → unmounts
  <span class="tvb-tip">…</span>     ← styled hover pill (copy .etb-tip)
</button>
```

Keep the EXISTING reducer wiring (dispatch `{type:'upgrade'|'roll'|'freeze'}`), disabled conditions, and
cost display — this is a re-skin, not a behavior change. The Freeze button's **frozen** state is a
natural "pressed/lit variant" (like the End Turn's pressed gem): `run.frozen` → swap art + pin a cool
glow.

**Positioning:** if the buttons stay in the shop tray, they're normal in-flow buttons — the tuner's
x/y/scale should be `transform` nudges (the Hero Panel tuner's composed-var pattern). If any button moves
onto the BOARD like the diamonds, pin it to the letterboxed stage instead:
`left: calc(var(--bar-x) + <frac> * var(--gw) + var(--xx-x, Npx) * var(--scale))` (+ same for top,
`transform: translate(-50%,-50%) scale(var(--xx-s, N))`). Never put a `transform` on an ancestor of a
`position: fixed` element (it hijacks the fixed positioning — this bit us twice; see the 🧍 tuner notes).

## 3. The tuner (one per button, or one "🍺 Shop Buttons" tuner with grouped rows)

Clone the trio: **config module + tuner component + DevMenu row.**

1. **Config module** (`tavernBtnConfig.ts` or one `shopButtonsConfig.ts`): an interface of numeric/color
   keys, `DEFAULTS`, `RANGES` ([min,max,step] per key), `DESC` (hover tooltips), `NUM_KEYS`/`COLOR_KEYS`
   arrays, and:
   - localStorage persistence **gated on `import.meta.env.DEV`** (prod always renders DEFAULTS),
   - `applyVars()` that reflects values onto `:root` as `--xx-*` CSS custom properties (compose full
     `transform:`/`filter:` strings in JS when CSS can't — e.g. a drop-shadow stacked N times),
   - `set/reset` helpers that re-apply + persist, and an `applyVars()` call at module load.
   - **Every CSS `var(--xx-*, fallback)` fallback must mirror DEFAULTS** — when Kevin sends tuned values
     to bake, update BOTH the DEFAULTS object and the CSS fallbacks.
2. **Tuner component**: copy `HeroPowerTuner.tsx` nearly verbatim (draggable `useDraggablePanel` panel,
   `.sfxmix` row markup, range/color inputs, Copy values → clipboard JSON, Reset). Add checkbox rows for
   preview toggles (e.g. "glow always on" pins a hover-only glow via a `body.` class so sliders can be
   dialed without holding hover — one pointer can't do both).
3. **DevMenu**: import + add one `{ key, label, C }` row to `TUNERS` in `DevMenu.tsx`. Pick an emoji
   (💎=End Turn, 💠=Hero Power, 🧍=Hero Panel are taken).

Recommended dial set per button (match the diamonds so Kevin's muscle memory carries over):
`x, y, scale` · glow: `blur, alpha (opacity), strength (stack count), pulse speed, pulse depth, color` ·
plus per-button effect dials (§4). Position/scale offsets in **design px × `--u`** (resolution-
independent); a fallback of `0`/identity keeps prod pixel-identical until values are baked.

## 4. The effects library (all already in the repo — reuse, don't reinvent)

| Effect | How | Reference |
|---|---|---|
| **Silhouette glow** (halo hugging the art's shape) | Duplicate `<img>` of the art with a STATIC stacked `drop-shadow` filter (the shadow follows the alpha). To glow only a SUB-REGION, cut that region into its own webp (polygon mask via sharp) and use it as the glow source, with a CSS `mask-composite: exclude` cutting the source pixels back out so ONLY the halo paints (offset/fit dials then move the halo alone). Breathing = animate the layer's **opacity** only. | `.etb-glow` / `.hpb-glow` in styles.css; `endTurnConfig.applyEndTurnVars` builds the filter string |
| **Sheen / glare sweep** ("alive" shine) | A gradient bar inside a container clipped to the art's shape via a **static `clip-path` polygon**; the bar animates **transform only** on a slow cycle (sweep ~25% of the cycle, park off-shape the rest). Dials: cycle seconds + strength. | `.etb-sheen` / `.etb-sheen-bar` / `@keyframes etbsheen` |
| **Press flash** (masks an art swap, "clean transition") | Mount a bright copy of the art (`filter: brightness(~2) + drop-shadow`, STATIC) for one eased opacity in-out, then unmount. Duration = a tuner dial (`--xx-flash-ms`). Add ~0.2s `animation-delay … both` if the flash must land after another transition (see the hero-power refresh flash). | `.etb-flash`, `.etb-flash.relight`, `.hpb-flash` |
| **Dirt/smoke puff** on press | `pixiFx.impactDust(x, y, power, { count, size, life })` at the button's live center (`getBoundingClientRect`). The `opts` multipliers are per-call — they don't touch the shared combat tuning. | `EndTurnButton.click()`; `pixiFx.ts` `impactDust` |
| **Pulse ring / shockwave** | `pixiFx.impactPulse(x, y, power, { radius, life, rings })` — 1–2 expanding additive rings. | same call site; `pixiFx.ts` `impactPulse` |
| **Lightning arcs** | Small canvas overlay + rAF reading the config live each frame; arcs die in ~200ms; loop skips clearing when idle and unmounts with the button. Probably overkill for shop buttons — it's the End Turn's signature. | `EndTurnButton.tsx` bolts loop |
| **Disabled/used dim** | Fade the ART layer only (not the housing) to a tunable opacity; `filter: saturate(.75)` is fine as a static state. | `.hpb-art` dim rules + `artDim` dial |

## 5. Suggested per-button recipes (starting points — Kevin will tune)

- **Tavern Up** — the "heavy investment" button: press = `impactDust` (thick, `count ~2`) +
  `impactPulse` (1 ring, `radius ~1.5`) + a warm gold press flash. A subtle sheen sweep at rest
  (cycle ~4s) sells the gold. Glow on hover only, amber. When unaffordable/maxed: art-only dim.
- **Refresh** — the "quick spin" button: press = a short bright flash + ONE small pulse ring
  (`rings 1, radius ~1, life ~0.8`) — snappy, no dust (it's cheap and frequent; don't fatigue it).
  Optional: a fast sheen sweep triggered per press instead of on a cycle (mount a one-shot sweep the
  same way the flash mounts).
- **Freeze** — the "toggle" button: this one is a STATE, not a moment. While frozen: swap to the
  frozen art variant + pin a cool blue glow (the ready-state pin pattern:
  `.tvbwrap.frozen .tvb-glow { opacity: var(…); animation: breathe … }`). On toggle: an icy press flash
  (white-blue) — dust/rings feel wrong for ice; keep it crisp. Unfreeze fades the glow out over ~0.2s
  (the `transition: opacity` on the glow layer handles it for free).

## 6. Verify before shipping (the way we've been doing it)

Drive a **throwaway run** on the dev server (`useGame.getState().newRun(seed, 'warden')` from the
console — never the real save), then per button: hover (glow + tip), press (flash/dust/ring fire once,
reducer action lands), disabled states (dim, no glow), Freeze's frozen pin + unfreeze fade, and a full
turn loop. Check the tuner: every row moves its thing live, Copy/Reset work, and a **clean-localStorage**
reload renders the shipped defaults. Then the full gate (§0) and a devlog entry.

When the look is dialed in: send Kevin the tuner's **Copy values** JSON — baking = pasting it into
`DEFAULTS` + mirroring the CSS fallbacks (see the "baked as the shipped defaults" devlog entries for the
exact shape of that change).
