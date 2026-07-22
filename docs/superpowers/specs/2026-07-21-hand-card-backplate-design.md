# Hand-card backplate — design

**Date:** 2026-07-21
**Status:** approved, pending implementation plan
**Owner call:** Mike (presentation seam — `packages/ui/**`)

## Summary

Cards in hand gain a **backplate**: an ornate stone/gold card body framing the existing oval
portrait frame and glass info panel, turning a hand card into a proper full card. The plate
travels with the card while it is dragged from hand. When the card is played to the board, the
plate **dissolves**, leaving the bare oval token that the board already uses.

This is a *presentation* change only. No engine, content, or run-state code is touched.

## Decisions

Six forks were resolved with the owner before writing this:

1. **Backplate, not a face-down back.** Hand cards stay fully readable; the plate is the card's
   rectangular body, not a mystery back. (The art has an empty centre and the layer zip names it
   `01_backplate.png` — both confirm the reading.)
2. **The plate wraps both** the oval portrait frame and the glass info panel. It does not replace
   the panel and does not sit behind the portrait only.
3. **Spells get the plate too**, and on cast the plate *and* the card dissolve together at the cast
   point — there is no token left behind for a spell.
4. **The dissolve starts on release** and runs on its own tunable clock that *overlaps* the FLIP
   flight rather than being bounded by it. (The flight is ~200ms; a dissolve hard-clamped to it
   risks reading as a blink. Starting on release with an independent duration lets the timing be
   stretched past the landing if needed.)
5. **The plate is static — always the same size.** No nine-slice, no stretching.
6. **Long text auto-shrinks** to fit the fixed panel, via character-count buckets (see below).

### Why static won over nine-slice

A stretched plate was prototyped against the real art (`plate-check.html`, sliced
`300 175 320 175 fill stretch`). Measured stretch range across the card corpus was 214px → 299px,
about 40% vertical growth. Plain stone and the vertical gold rails stretch invisibly, but the
**greek-key tabs sit at ~51% height — dead centre of the stretch band**, so no choice of slice
inset protects them. Static sidesteps this entirely and keeps the art pixel-exact.

## Art

**Ships as** `apps/web/public/frames/cardplate.webp` — **800 × 1244**, aspect **0.6431**, **199 KB**.

**Source** is `C:\Users\micha\Desktop\Reference Art\card plate v3.png` (1890 × 2938 RGBA, 6.63 MB),
left untouched on disk. Converted with `sharp` — `.resize({width: 800}).webp({quality: 85,
alphaQuality: 100})`.

> **Why converted, not shipped as-is.** The source PNG is 6.63 MB against a total
> `apps/web/public/` of 8.0 MB — one card frame would nearly double the game's asset payload, where
> the largest thing currently shipping is `spell-frame.png` at 1.11 MB. It is also ~8–10× oversampled
> (1890px wide, rendering at ~200px). At 800px it is still 4× the display size, so it stays crisp on
> any DPR, and WebP matches how the newer button art already ships. Quality 85 was chosen over 78
> (154 KB) for headroom — large flat stone gradients are the one thing WebP bands on, and 45 KB is
> a trivial price. Owner approved the target 2026-07-21. This is a "performance is the north star"
> call: a 6.6 MB frame is a defect, not a polish item.

Loaded via the established pattern at `packages/ui/src/Card.tsx:21-38`: a module-const
`` `${import.meta.env.BASE_URL}frames/cardplate.webp` `` plus a module-level `available` flag flipped
on the first 404, so a missing asset degrades to today's look instead of breaking. The `BASE_URL`
prefix is load-bearing — root-absolute paths 404 on itch's CDN sub-path.

Plate geometry is locked to the shipped aspect: **`height = width × 1.5550`**.

## Layout

**The existing layout does not move.** This is the main consequence of choosing a static plate.

`.drawer` keeps `position: absolute` at `top: calc(var(--ccw) * 1.15)` and keeps the anchored-top,
grows-downward behaviour shipped in #570. `.cardplate` is an absolutely-positioned element of
known, fixed size at `z-index: 0`, painting behind everything else in the card.

> An earlier iteration of this design flipped `.drawer` back to `position: static` so the card's
> height would grow to contain it — necessary only when a *stretching* plate had to track dynamic
> content height. A fixed plate removes that requirement, and with it the riskiest part of the
> design: no DOM restructure, so the FLIP and rect-measurement code in `Recruit.tsx` is untouched.

`.card.plated` gets `isolation: isolate` so the plate can sit at `z-index: 0` without escaping into
sibling cards. This is safe specifically because hand cards are never in combat, so there is no
per-swing GSAP lunge to fight.

### Scope

| Surface | Plated? |
|---|---|
| Hand row (`run.hand.map`, `Recruit.tsx:3503`) | **yes** |
| `.dragcard` when `drag.source === 'hand'` (`Recruit.tsx:3642`) | **yes** |
| Shop row, board/warband, combat | no |
| Discover overlay, `.cardref` hover popup | no |

The `drag.source === 'hand'` condition already exists at the `.dragcard` render site, so the
"keeps its plate while dragged" requirement needs no new state. Note `.dragcard` renders a *fresh*
`<Card>` — it is not a clone or portal of the source card — so the plate prop must be passed at
both call sites.

`Card` gains one new optional prop (`plated?: boolean`). There is no existing `zone`/location prop;
zone is otherwise derived from the DOM via `el.closest('[data-zone]')` at `Recruit.tsx:1657`.

## Text auto-shrink

Card rules text measured across the content corpus (273 strings):

| | chars |
|---|---|
| median | 59 |
| p90 | 96 |
| max | 187 |

The max is `set1/spells.ts` — *"Choose a friendly minion. It attacks immediately at the start of
next combat…"*. These are **static** lengths; the live-card-text rule folds current values in
(`+6/+6`, countdowns, `2 more`), so the real worst case on screen is longer — budget ~230.

The plate is sized for roughly p90 at comfortable type. Longer cards step their font size down
through **~4 discrete buckets** (`.txt-s` / `.txt-m` / `.txt-l` / `.txt-xl`), selected by a pure
function of the **live** text string's length.

**Buckets, not measurement.** The obvious implementation — render, read `scrollHeight`, step down
until it fits — is a layout read per card per render on the hand, which re-renders constantly.
That is the `getBoundingClientRect`-per-frame anti-pattern named in `docs/performance.md`. A pure
character-count function has zero DOM reads, is memoizable, and is deterministic.

*Known tradeoff:* character count is a proxy for wrapped height. A 96-char string of long words
wraps taller than one of short words, so the buckets are slightly conservative. Thresholds are
exposed in the tuner; a card that lands wrong is a threshold tweak, not a rewrite.

## The dissolve — phased

**Phase 1 ships a placeholder.** The plate must not simply pop out of existence, but nothing in
phase 1 constrains the final look. Placeholder = a one-shot CSS keyframe on `.cardplate`
(`transform`/`opacity` only — scale ~1.06, fade) plus the existing `pixiFx.dust()` at the card rect.

**Phase 2 authors the real effect** in its own preview rig, tuned by eye, then swapped in. The
swap surface is one CSS class and one call site.

### Mechanism

`.dragcard` unmounts the instant `setDrag(null)` runs (`Recruit.tsx:1958`), so the dissolving plate
cannot live there. It rides the **destination board card** instead: a `platePuffUid` ref plus
timeout mirroring how `puffOnBoard` already tracks a uid (`Recruit.tsx:3064`), rendering
`.cardplate.dissolving` for one beat and then dropping it.

`puffOnBoard` is also the stylistic precedent — it waits 200ms for the Flip to settle, measures the
landed rect by uid, temporarily raises the card above the `.pixifx` canvas so dust renders behind
it, and calls `pixiFx.dust()`. The plate dissolve sits alongside it, not inside it, because it
starts earlier (on release, per decision 4).

Spells use the same path at the cast point, dissolving plate and card together.

## Tuner and guards

A new dev-only **🂠 Card Plate** tuner (its own DevMenu entry, not folded into 🖼️ Card Frames —
the knobs are unrelated to frame overlay/blend and Card Frames is already dense) exposing: plate
padding, corner radius, text bucket thresholds, puff duration, puff scale, dust density.

Two established guards apply:

- **`import.meta.env.DEV`-gated**, per the #615 prod-leak fix — a tuner's localStorage must never
  beat shipped defaults in production.
- **Double-sourced values** — every tunable exists both as a TS default and as a
  `var(--x, <fallback>)` in `styles.css`. Production renders from the CSS fallback, so a bake must
  update both. Three silent drifts have been caused by missing this.

## Performance

- Plate is a static background image. No looping animation, and nothing animating a paint property
  in a loop.
- The dissolve is a **one-shot** on `transform`/`opacity` only (compositor-only).
- Text bucketing does zero layout reads.
- Hand is ≤10 cards.

Nothing here is expected to register, but phase 1 should be confirmed against a **prod build**, not
`npm run dev`, per the standing rule.

## Follow-ups / accepted consequences

- **The hand row needs re-tuning.** A p90-sized plate is roughly `1.5 × card width` tall, where
  today's hand card is `--ccw` plus a content-sized drawer. `handY`, `handGap` and probably
  `handPop` will need dialling in Layout Lab / Drag Feel. Phase 1 ships sensible starting values;
  the owner tunes by eye and they get baked.
- **Discover overlay** is deliberately out of scope. Those are large hero-moment renders and may
  want plates later; revisit after phase 1 is live.
- Three variants of this art exist in `Reference Art`. The owner first pasted a four-corner-diamond
  version; `cardplate.png` (1023×1537) has one bottom gem plus greek-key tabs; **`card plate v3.png`
  (1890×2938) is the chosen source** — same design language as v2 at higher resolution, with a
  slightly taller aspect (0.6433 vs 0.6656). The earlier files are superseded, not deleted.
- `ascent_card_layers_transparent_pngs.zip` in the owner's Downloads decomposes a card into
  `01_backplate` / `02_portrait_frame_and_tier` / `03_stat_medallions` /
  `04_rules_panel_and_bottom_ornament`. Not used here; noted in case a later pass wants the layers.
