# 2026-09-26 — Rebirth look v2: a flame crown and a phoenix pillar (R-REBIRTH-FX-01)

Owner: "improve rebirth effect? its not noticeable and ugly". The first pass (#1739) was a 3px inset rim and a
few motes inside the art, plus a small `rebirth-flame` Pixi burst.

**Why v1 was invisible.** Two reasons, both worth knowing for any future card treatment:
- The `.stdframe .art` box is OVERFILLED (`--fill` 1.28) and tucked under the gold ring, so an inset rim drawn
  on the art box's edge sits entirely behind the frame. Anything meant to show inside the oval must inset
  ~11% (`(1 - 1/fill) / 2`); anything meant to show around it must live in the archbox, outside `.art`.
- The burst was sized `rect.w / 180`, measured at beat start. A re-entering slot is still expanding from zero
  width (`summonexpand`), so `w` was ~0 and the burst scale was ~0. It now sizes off `max(w, h * 0.75)`.

**Idle: the flame crown.** `RebirthCrown` in `Card.tsx`, in the archbox at z0 (over the grounding shadow, under
the art z1 and the frame z3), so the tongues root behind the gold and only the fire shows beyond it. It is
4 PRE-RENDERED SVG frames (`packages/ui/src/rebirthCrown.ts`, seeded jitter, set as `--rb-crown-N` on :root
by `rebirthConfig.ts`, re-rendered only when a colour or the flame height changes). They flipbook by opacity
(each frame holds while the next fades in, so one is always at full strength; a plain cross-fade looked
washed out), plus a small scale breathe, a static cobalt glow whose `::before` breathes in opacity (the
`kwglow` pattern) and rising embers. Tuner alphas sit on static wrapper opacities, so keyframes are constants.

**Trigger: the phoenix pillar.**
- New `rebirthFx` cue on the `reborn` kind at offset 0 (score.ts). The Rise-only `auraReform` (+460ms) now
  skips rebirth events, so each rebirth fires exactly once, at beat start.
- `fx/rebirthPillar.ts` spawns a flame-sheaf SVG (`--rb-pillar`) as two short-lived nodes: BACK behind the card,
  FRONT (white-hot) over it. They are hosted on the combat `.unit`, not on the `.card`, whose re-form animates
  opacity and scale. They are DOM nodes rather than a class, so the pillar burns its full length even when the
  beat ends early at fast combat speed. `left` is `--cw / 2`, not 50%, because the slot is still expanding.
- `.unit.rebirthing .card` (`animFor` adds `rebirthing` to `reborn` for a rebirth) rises out of the fire.
  Transform and opacity only. A brightness/drop-shadow filter version repainted every card every frame
  (~440 paints / 1.5 s for 7) and was cut. The FRONT pillar gives the white-hot look instead.
- `rebirth-flame.json` was rebuilt: a floor ring (normal blend, because additive washes out on the light
  board), a flash, and sparks and glints rising. It is recoloured per call with the tuner colours (`recolor`)
  and stretched by `burstTime`.
- **Shop:** `rebirthReturn` stamps `rebirth: true` on its `rise` shop cue (`ShopDeathFx.rebirth`), so a shop
  rebirth plays the phoenix too, not Rise's aqua re-form (cross-phase rule).

**Tuner (🔥 Rebirth).** It has knobs for flame intensity, height and flicker, glow and breathe, ember
count/opacity/size, three colour pickers (deep, hot, core), burst size and duration, and whoosh volume and
delay. ▶ Idle card floats a sample Exgalloper beside the panel (`rebirthPreview.tsx`). ▶ Rebirth plays the
full trigger on it. ▶ Burst ×7 is the mass check. The old rim knobs were dropped, and stale saved keys are
filtered.

**Perf (headless Chrome, dev build).** Idle with 8 Rebirth cards measured the same as the baseline over 5 s:
10 paints, 5 layouts, no frames over 50 ms. Mass rebirth ×7 (pillars + def + re-form, warm) had p95 4.3 ms,
max ~21 ms and no frames over 33 ms. The remaining paints in that trial come from the shared `.unit.reborn`
`summonexpand` width animation, which Rise pays too. Particles per burst: 40 sparks + 22 glints (~430 for 7),
well under the 4,000 FX budget.
