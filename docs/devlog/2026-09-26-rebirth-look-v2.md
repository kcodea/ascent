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

## Revision after owner review (same day, PR #1745)

Owner: "rebirths looking slightly better, but still really bad. can you blur it and just overall improve its
readability? and this isnt css right? … it should be on top of the card, not behind it. also, it needs the same
combat beat style as rise, so it rises before the next beat occurs."

- **Soft, on top.**
  - The crown moved to z4, over the art and the gold frame and under the stat badges and gem. This is Ward's
    layer.
  - It is now 7 large calm front tongues plus 6 soft back tongues, and a soft burning line along the frame
    ring. Every edge is PRE-BLURRED with `feGaussianBlur` inside the SVG frames, so the blur is rasterised
    once and is never a live filter.
  - There are 3 frames and a calmer flicker (1.5 s cycle).
  - Two silhouettes: `oval` and `shield`. The shield one follows Taunt's heater (`--rb-crown-s-N`) and is
    picked by the `T` keyword.
  - The glow is now a faint ring of light (transparent over the middle of the portrait).
- **What it is.** Plain CSS: absolutely-positioned divs with static SVG data-URI backgrounds, animated only by
  opacity and transform (compositor). No Pixi and no canvas for the idle look.
- **Measured** (headless Chrome, 8 Rebirth cards idle, 5 s): 10 paints, 5 layouts, exactly the no-Rebirth
  baseline. There were no long frames. No live filter and no paint-property animation runs.
- **Rise's beat style.**
  - A Rebirth death already carries `rise: true` (the engine copies Rise's order), so the return already had
    Rise's `REBORN_LEAD`.
  - Two differences remained, and both are fixed. First, the dying body used the plain collapse, because the
    soft `dying rising` fade keyed off the `R` keyword. It now keys off the death's `rise` flag. Second, the
    next beat could start while the body was still rising.
  - `rebirthSettleLead` adds 700 ms after a rebirth beat. The re-form (0.9 s) and the pillar are now
    combat-speed scaled like the holds.
  - Measured in a real fight: the next attack starts 1042 ms after the rebirth begins.
  - Tests: `rebirthLook.test.tsx` asserts that at 1× and 2× the hold before the next beat exceeds the re-form.
- **Mass rebirth ×7.** The re-form itself is compositor-only (11 paints when isolated). The remaining paints
  in that trial come from the shared `.unit.reborn` `summonexpand` width animation, which a Rise pays too.
