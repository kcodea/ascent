# In-Run UI Editor — Design

**Date:** 2026-08-12
**Status:** Approved design, pre-implementation
**Owner seam:** presentation (`packages/ui/**`, `apps/web/**`)

## Summary

A dev-only, direct-manipulation editor for the DOM UI shown *during a run* — the board,
cards, HUD pills, shop, combat overlays, hero panel, text labels. **Not** settings, home, or
menu screens; **not** Pixi FX (the FX workbench owns those).

You turn on an "UI Edit Mode" toggle, click an in-run element, then move / resize / restyle /
swap-image it live. Nothing ships on its own: the editor is a **live scratchpad** that applies
edits through an injected override stylesheet, and its output is a **copyable text summary** you
paste into chat. The paste is turned into the real source change via a normal PR — the same
handoff rhythm already used for FX defs.

This unifies the family of ~47 one-off `*Tuner` panels into a single on-canvas editing surface
for layout/size/style/image, makes those elements more flexible to reposition and resize, and
adds an accessible way to try uploading and swapping different image assets.

## Goals

- One direct-manipulation surface to reposition, resize, and restyle any in-run DOM UI element.
- Swap an element's image from existing assets, or **upload** a new one that is written to a real
  on-disk folder so it can be wired up for real.
- Emit a compact, paste-ready summary (element identity + final CSS + asset path) that a chat
  session can turn into a proper code change.
- Survive React re-renders and (where possible) GSAP animation without edits snapping back.

## Non-goals

- Editing text **content** (words come from game data; dedicated copy tuners already exist).
  Position/size/style of text *elements* is in scope; the strings themselves are not.
- Editing Pixi FX (the FX workbench owns those).
- Editing settings/home/menu chrome (in-run only).
- Persisting edits into the shipped build automatically. Every edit reaches production only via a
  reviewed PR authored from the pasted summary.
- Server-authoritative anything. This is a dev tool, dev-build only.

## Approach: injected override stylesheet (Approach A)

The in-run screen is React-managed and partly GSAP-animated. Setting **inline styles** on an
element is unreliable: React can overwrite them on its next reconcile of that element's `style`
prop, and GSAP can overwrite them each frame. Instead, the editor owns one injected
`<style id="ui-editor-overrides">` element and writes a CSS **rule per edited selector** into it.
Because those rules live in a separate stylesheet with their own specificity, they are not
clobbered by React reconciliation or by GSAP's inline writes — **except** where GSAP is *actively
animating the same property* (see "Animated-element caveat").

Two rejected alternatives:

- **B — inline styles.** Simpler and immediate, but edits snap back on any element React
  re-renders or GSAP animates; reliable only on fully-static chrome. Rejected for robustness.
- **C — hybrid (inline during drag, commit to a rule on release).** Best UX, most code. Rejected
  as unnecessary: mutating the override rule live during a drag already gives instant feedback, so
  the extra inline layer buys nothing.

## Architecture

### Activation & mode

- A new **"UI Edit Mode"** toggle in `DevMenu.tsx`, backed by its own `localStorage` key via a
  `uiEditor/config.ts` module (same get/set/reset shape as existing tuner configs).
- When ON, an `EditorOverlay` React component mounts at the app root as a portal above everything,
  with `pointer-events` mostly off so the game renders and the sim clock keeps running underneath.
- The overlay installs one **capture-phase** pointer listener. In edit mode a **single click
  selects** the element under the cursor and is prevented from reaching the game (so a click never
  also buys a minion). Combat continues to run; edit mode intercepts pointer interaction only, not
  the simulation.
- A floating toolbar (top-left) shows: current selection identity + generated selector (editable,
  with live match count), the manipulation controls, **Copy Summary**, **Reset element**, and
  **Reset all**.

### Selection & the element resolver — `uiEditor/resolver.ts`

A click yields a raw `Element` that is often a deep inner node. The resolver walks up to the
nearest **meaningful anchor** by a ranked signal list, so you select the pill, not the glyph:

1. **Data attributes** (best): `[data-uid]` (card), `[data-zone]` (warband/tavern/board), and new
   `[data-ui="…"]` hooks added to in-run chrome (HUD pills, gold counter, rating/Line readouts,
   shop header, hero panel). Adding those `data-ui` hooks to the ~dozen chrome elements that lack a
   stable handle is the one source change the editor itself requires.
2. **Known component classes**: `.cgem`, `.badge`, `.card`, `.pill`, `.row`, `.hud-*`.
3. Fallback: the clicked element itself.

**Alt-click** (or a "select parent ▲" toolbar button) walks up one anchor level to grab a container
(e.g. move a whole cluster). The selected element gets a highlighted bounding box drawn by the
overlay.

### Override stylesheet & scratchpad — `uiEditor/overrideSheet.ts`

- Owns the single `<style id="ui-editor-overrides">` element.
- Keeps the scratchpad model: `Map<selector, { props: Record<string,string>; assetPath?: string }>`.
- For each edited selector, ensures a rule exists and **mutates `rule.style.*` directly** on every
  drag frame for instant feedback.
- **Mirrors the scratchpad to `localStorage`** so a reload does not lose in-progress edits (a direct
  lesson from the FX-workbench Save bug).
- Serializes the scratchpad to the copyable summary.

### Selector generation — `uiEditor/selector.ts`

For each selected element, build the most stable, specific-enough selector:

- Prefer a data-attr anchor. Because `data-uid` is per-run, offer a **scope** choice:
  - **"this element"** — exact, uses the per-instance id (default for a specific card).
  - **"all like this"** — strips per-instance ids to a class/zone/`data-ui` selector, e.g.
    `[data-zone="warband"] .card` or `.hud-gold` (default for chrome).
- Compose `tag + stable class chain + nearest data-attr ancestor`.
- Show the generated selector in the toolbar, **editable**, with a **live match count**
  ("matches 7 elements") so the blast radius is visible before committing.

The selector + its rule are exactly what land in the summary: what you see is what gets applied.

### Manipulation controls

All write into the selected element's override rule:

- **Move** — drag the box → `transform: translate(Δx, Δy)` (composited, never touches layout, so it
  never fights `position`/flex).
- **Resize** — 8 handles → `width`/`height`, with a toggle to use `transform: scale()` when the
  element should scale as a unit (better for cards/pills whose internals scale together).
  Shift-drag keeps aspect ratio.
- **Image swap / upload** — when the element has a `background-image` or is an `<img>`, the toolbar
  offers **pick** (a dropdown of existing in-run images) or **upload** (POST to `/__ui/asset`, §
  below). The chosen/uploaded path is written as `background-image: url(<savedPath>)` on the rule.
- **Restyle** — a small curated property panel: `font-size`, `color`, `background`,
  `border-radius`, `padding`, `opacity`. Deliberately not a full CSS editor (YAGNI).

### Asset upload endpoint — `apps/web/uiAssetPlugin.ts`

Reuses the FX workbench pattern (`fxDefsPlugin.ts`'s `/__fx/art`). A new dev-only Vite route
**`/__ui/asset`** accepts an uploaded image, writes it to
**`packages/ui/src/assets/ui-editor/<name>.<ext>`**, and returns the saved path. The summary names
that path so the follow-up PR knows exactly which committed file to wire in. Dev-only; never in the
prod bundle.

### The copyable summary

**Copy Summary** produces a compact, paste-ready block, one entry per edited selector:

```
UI-EDIT
  selector: [data-zone="warband"] .card .cgem   (matches 7)
  scope: all-like-this
  transform: translate(4px, -6px) scale(1.08)
  border-radius: 12px
  background-image: url('assets/ui-editor/medallion-v2.png')   [uploaded]
--
  selector: [data-ui="hud-gold"]   (matches 1)
  scope: this-element
  font-size: 22px
  color: #ffd76b
```

It carries the element identity, the exact final CSS, the scope decision, and any uploaded asset's
on-disk path. Pasted into chat, it becomes a proper source change (component style / `styles.css` /
CSS var / asset wiring) via a normal PR. Nothing the editor writes ships on its own.

## Animated-element caveat

Combat cards are animated by GSAP every frame (position, scale, transforms). An override rule for
`transform` on a card that is *currently mid-lunge* will lose — GSAP wins on the properties it is
actively tweening. The editor therefore:

- **Detects** when the selected element is under active GSAP control and shows a warning badge:
  *"animated — transform edits may not stick during combat; edit at rest."*
- Steers editing of animated elements toward properties GSAP does not touch (`color`, `border`,
  `font-size`, `background-image`, frame art), which hold fine.
- Has no such issue on static chrome (HUD, shop header, pills, panels, hero card at rest).

This is an honest limit of editing a live-animated UI, surfaced rather than hidden.

## File layout

All in `packages/ui/src` (presentation seam) plus one dev endpoint in `apps/web`:

- `uiEditor/EditorOverlay.tsx` — mode UI, selection box, resize handles, toolbar.
- `uiEditor/resolver.ts` — click-target → meaningful element.
- `uiEditor/selector.ts` — selector generation + match count.
- `uiEditor/overrideSheet.ts` — injected `<style>`, rule get/set, scratchpad map,
  `localStorage` mirror, summary serializer.
- `uiEditor/config.ts` — `localStorage`-backed on/off toggle, wired into `DevMenu.tsx`.
- `apps/web/uiAssetPlugin.ts` — the `/__ui/asset` upload route.
- New `data-ui="…"` attributes on the ~dozen in-run chrome elements that lack a stable handle.

No `packages/core` / `packages/content` / `packages/sim` changes. Nothing touches the shared type
vocab or the hot chokepoint files.

## Testing & verification

- **Unit** (`packages/ui`, Vitest with the existing headless DOM shim):
  - `resolver` — a deep click target resolves to the expected anchor for representative in-run
    subtrees (card, pill, HUD element).
  - `selector` — "this element" vs "all like this" produce the expected selectors and match
    counts against a fixture DOM.
  - `overrideSheet` — writing props creates/updates the correct rule text; the summary serializer
    round-trips the scratchpad to the documented format; the `localStorage` mirror restores state.
- **Manual / live DOM** in the dev build: toggle edit mode, select a HUD pill and a card, move +
  resize + restyle, upload an asset, copy the summary, confirm it matches the on-screen result;
  confirm an override on a static element survives a re-render (e.g. gold counter tick) and that the
  animated-element badge appears on a combat card mid-animation.
- **Gates**: `npm run typecheck && npm run lint && npm test && npm run build:web` all green;
  confirm the `/__ui/asset` route and the `uiEditor` module are dev-only and absent from the prod
  bundle.

## Open questions / deferred

- Exact set of chrome elements that need new `data-ui` hooks — enumerated during implementation as
  each is first selected.
- Whether "Reset all" should also clear the `localStorage` mirror (assumed yes).
- A future nicety (not in this scope): re-import a pasted summary back into the editor to keep
  iterating. Deferred until the paste-to-PR loop is proven.
