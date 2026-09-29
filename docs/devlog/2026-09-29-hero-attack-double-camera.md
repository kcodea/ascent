# 2026-09-29 — Hero attack camera applied to the FX once (every style)

Follow-up to a finding from the Banana Cannon (PR #1839): during the camera push-ins, the Pixi FX of **every** hero
attack drifted off the struck portrait. Owner ask: look into it, "make sure it doesnt break how our animations work".

## Why it was double

`StageCamera` (`packages/ui/src/heroAttack/stageCamera.ts`) writes one `translate(ax, ay) scale(z)` onto the camera
element and ALSO mirrored it onto the style's Pixi root (`scene.setCamera`), on the assumption that the FX canvas does
not move with the DOM. That stopped being true before the first cosmetic style shipped:

- **Live fight, tuner demos, anything on the shared overlay:** since the scaled stage (#1762) `pixiFx.initAbove`
  appends `canvas.pixifx-above` into `stageHost()`, i.e. INSIDE `#stage`, and the camera element is `#stage`. The DOM
  camera already zooms and shakes the canvas. True at every window size: unscaled (`#stage` is `display: contents`,
  and the camera gives it a fixed box for the attack) and scaled (16:9 below 1080p, 21:9, small windows).
- **Collection preview (`HeroAttackPreview.tsx`):** the sandbox's own canvas sits in `.hapv-pixi` inside
  `.hapv-stage`, which is the camera. Also double.
- Nowhere in the app is the FX canvas outside the camera element. Only the unit tests (no DOM camera) relied on the
  mirror.

Applied twice, a point `q` lands at `a + z(a + zq)`: effectively a zoom of z² about the focus plus a (1 + z)x shake.
FX at the focus stay put, so the error hides when the camera is anchored on the struck hero, and shows whenever the
focus is elsewhere (the attacker through the charge, the bolt in flight, Holy's sword centre at its peak).

## The fix (one place)

`StageCamera` decides once per attack, at `start()` (the charge), whether the FX canvas already rides the camera
element (`fxCanvasRidesCamera(camera, canvas)`: the camera contains the canvas; with no canvas found yet, a `#stage`
camera is assumed to carry the shared overlay, since `pixiFx` always mounts it there). If it does, the mirror is
skipped and the Pixi root stays at identity. `heroFxCanvas(o)` finds the canvas: the sandbox's own when the caller
mounts the scene (`o.mount`, in `o.host` / `o.camera`), else `canvas.pixifx-above`; it is also the default, so a
style that forgets to pass it is still right in a live fight. Every style (Blast, Quake, Arcana, Phantom Blades,
Enraged, Poison, Frost, Holy, and Fire, Undead and Beast, which landed during this work) passes `heroFxCanvas(o)`. Classic has no Pixi
FX (mirror null) and is untouched. No DOM camera (tests) = the mirror is still the only camera. Reduced motion has no
camera and no scene, so nothing changes there.

Nothing else moves: the DOM transform written per frame is byte-for-byte the same (below).

## Audit (measured in the real game)

Method: the dev tuner demo path (`playAttackDemo`) on a manual 16 ms clock in a Scene Builder lobby run, the real
`#stage`, real portraits and the real above canvas. Each frame the struck hero's impact anchor is mapped through the
Pixi root (`root.toGlobal`) and the canvas's on-screen rect, and compared with where the DOM camera puts the same
portrait centre (`ax + z·d`). **Peak** = at the frame of maximum zoom; **worst** = the largest offset over every
frame with zoom > 1.02. R = the struck portrait radius (about 130 px at 1920x1080, 108-111 px at 1600x900, 26 px in
the preview). Both directions measured; they match except where noted (you / foe).

| Style | Context | Tier | Peak zoom | Before: peak / worst (px) | After |
|---|---|---|---|---|---|
| Blast | fight 1920x1080 | IV (40) | 1.111 | 18.1 / 116.5 | 0 / 0 |
| Blast | fight 1920x1080 | III (12) | 1.075 | 7.2 / 79.1 | 0 / 0 |
| Blast | fight 1600x900 | IV | 1.103 | 3.7 / 97.1 | 0 / 0 |
| Quake | fight 1920x1080 | IV | 1.106 | 2.6 / 88-90 | 0 / 0 |
| Quake | fight 1920x1080 | III | 1.066 | 1.5 / 57 | 0 / 0 |
| Quake | fight 1600x900 | IV | 1.113 | 12.9 / 74-75 | 0 / 0 |
| Arcana | fight 1920x1080 | IV | 1.175 | 21.9 / 126-127 | 0 / 0 |
| Arcana | fight 1920x1080 | III | 1.079 | 10.0 / 78.9 | 0 / 0 |
| Arcana | fight 1600x900 | IV | 1.163 | 11.7 / 105-106 | 0 / 0 |
| Phantom Blades | fight 1920x1080 | IV | 1.171 | 13.1 (you) 7.0 (foe) / 126.1 | 0 / 0 |
| Phantom Blades | fight 1920x1080 | III | 1.081 | 11.8 / 79.2 | 0 / 0 |
| Phantom Blades | fight 1600x900 | IV | 1.196 | 27.3 (you) 23.0 (foe) / 105.1 | 0 / 0 |
| Enraged | fight 1920x1080 | IV | 1.192 | 34.9 / 146-148 | 0 / 0 |
| Enraged | fight 1920x1080 | III | 1.090 | 12.4 / 79.5 | 0 / 0 |
| Enraged | fight 1600x900 | IV | 1.192 | 29.0 / 121-124 | 0 / 0 |
| Poison | fight 1920x1080 | IV | 1.191 | 20.4 / 116-117 | 0 / 0 |
| Poison | fight 1920x1080 | III | 1.067 | 8.2 / 69.9 | 0 / 0 |
| Poison | fight 1600x900 | IV | 1.200 | 17.1 / 97-98 | 0 / 0 |
| Frost | fight 1920x1080 | IV | 1.194 | 24.8 / 126.0 | 0 / 0 |
| Frost | fight 1920x1080 | III | 1.072 | 3.8 / 79.2 | 0 / 0 |
| Frost | fight 1600x900 | IV / III | 1.207 / 1.078 | 21.5 / 105.0; 8.6 / 66.0 | 0 / 0 |
| Holy | fight 1920x1080 | IV | 1.152 | 142.7 (you) 150.6 (foe), at the peak | 0 / 0 |
| Holy | fight 1920x1080 | III | 1.075 | 7.4 / 79.1 | 0 / 0 |
| Holy | fight 1600x900 | IV / III | 1.152 / 1.075 | 118.8 (you) 125.3 (foe); 6.2 / 65.9 | 0 / 0 |
| Fire | fight 1920x1080 | IV | 1.207 | 28.4 / 126.0 | 0 / 0 |
| Fire | fight 1920x1080 | III | 1.083 | 13.4 / 79.2 | 0 / 0 |
| Undead | fight 1920x1080 | IV | 1.172 | 24.4 / 167 (you) 177 (foe) | 0 / 0 |
| Undead | fight 1920x1080 | III | 1.085 | 13.5 / 79.2 | 0 / 0 |
| Beast | fight 1920x1080 | IV | 1.160 | 23.7 / 126.1 | 0 / 0 |
| Beast | fight 1920x1080 | III | 1.080 | 11.2 (you) 14.2 (foe) / 78.9 | 0 / 0 |
| Blast, Enraged, Holy | fight 2520x1080 (21:9) | IV | as above | (same math as 1920, unscaled) | 0 / 0 |
| Blast | Collection preview | 9 | 1.057 | 8.2 / 8.2 | 0 / 0 |
| Quake | Collection preview | 9 | 1.044 | 2.7 / 5.9 | 0 / 0 |
| Arcana | Collection preview | 9 | 1.057 | 8.1 / 8.1 | 0 / 0 |
| Phantom Blades | Collection preview | 9 | 1.052 | 3.5 / 6.7 | 0 / 0 |
| Enraged | Collection preview | 9 | 1.074 | 11.7 / 11.7 | 0 / 0 |
| Poison | Collection preview | 9 | 1.049 | 5.2 / 6.7 | 0 / 0 |
| Frost | Collection preview | 9 | 1.058 | 8.4 / 8.4 | 0 / 0 |
| Holy | Collection preview | 9 | 1.058 | 8.5 / 8.5 | 0 / 0 |
| Fire | Collection preview | 9 | 1.057 | 8.0 / 8.0 | 0 / 0 |
| Undead | Collection preview | 9 | 1.050 | 1.9 / 6.7 | 0 / 0 |
| Beast | Collection preview | 9 | 1.063 | 7.7 / 7.9 | 0 / 0 |
| Classic | all | all | n/a | no Pixi FX, no mirror: unaffected | unchanged |

Worst-case before was about one portrait radius in a fight (Enraged 148 px, Holy 151 px, Undead 177 px on R 130) and up to 0.45 R
in the preview. After: 0 px everywhere (the mapping is exact; the DOM transform is written to 2 decimals).

**Nothing else moved.** A per-frame hash of the `#stage` transform plus both portraits' transforms was identical with
and without the mirror for all eleven styles, Tier IV, both directions, at 1920x1080 (A/B in one page), and for all eleven
in the Collection preview (the real code before and after). After every attack `#stage` was back to its exact prior
inline transform (`""` unscaled, `scale(0.833333)` at 1600x900), both portraits back to `""`, no attack root left on
the above layer, and the Pixi root at identity.

What does look different: the FX no longer overshoot. When the struck portrait recoils (knockback) the FX now hold
the portrait's rest point under the camera instead of drifting with the doubled zoom, which by coincidence pointed
roughly the same way as the recoil; and the FX shake with the portraits (1x) instead of about twice as hard.

## Perf

No per-frame layout read added: the canvas lookup (`querySelector` + `contains`, no layout) runs once, at `start()`.
The per-frame work only drops (no root transform writes). Frost Tier IV on the real clock (dev server, 240 Hz pane,
3 runs each, before = the old always-mirror forced on the same code): frame p50 4.2 / p95 4.3 / p99 8.4 ms both
ways (the worst frames of both runs were the shared Browser pane being backgrounded, not the attack). Script + render
per frame on the manual clock (3 runs each): before p50 0.2 / p95 0.5 / p99 0.8 / worst 1.7 ms, after 0.1 / 0.5 /
1.1 / 1.7 ms (0.1 ms timer resolution: equal within noise).

## Tests + oracle

`packages/ui/src/heroAttack/stageCamera.test.ts`: the decision (`fxCanvasRidesCamera`, `heroFxCanvas`), `StageCamera`
(inside: DOM moves, root never zooms; outside: same DOM transform and an exact mirror; no DOM camera: mirror moves;
the scaled stage's base transform kept innermost and restored), and a parameterised run over all eleven styles, Tier
IV, both directions, both layouts: the impact point maps onto the struck portrait within 0.2 R at every zoomed frame,
and the camera and the root are at rest after. With the old gating, every "canvas inside" case fails (checked). Oracle
R-PROG-ATTACK-25 (id picked clear of 17-19, which the open attack PRs are claiming).

## Follow-ups

- The unmerged attack branches (Banana #1839, Bleed #1847) construct `StageCamera` with
  two arguments; the default resolver already makes them right in a fight, but each should pass `heroFxCanvas(o)` so
  the Collection preview is right too. Banana has its own mirror wrapper (`mirrorsCamera`), which composes correctly
  with this (it stays at identity either way) and can be dropped for the shared one when it lands.
