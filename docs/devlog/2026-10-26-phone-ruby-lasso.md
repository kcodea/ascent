# 2026-10-26 — Phones: the Ruby targeting lasso flew off the screen (R-PHONE-LASSO-01)

**Owner (2026-10-26, iPhone, Netlify build 792caa34a):** "The Ruby targeting lasso is bugged on mobile."

## Root cause

Coordinates, touch handling and the Pixi canvas were all fine. The bug was the lasso's spring physics.
`aimLasso.stepLasso` advanced each interior point of the ribbon with ONE semi-implicit Euler step per frame. That
step is only stable while `h * c` and `h * sqrt(k)` stay small, and the cursor end is gripped (`k * 15`,
`c * sqrt(15)`). The `ruby-target` def (2026-09-14) has `springDamping: 60`, so the cursor end damps at 232/s:
`h * c` = 3.9 at 60 Hz and 7.7 at the 30 fps dt clamp. Those are past the limit, and the integration diverges. It was
stable only at roughly 120 fps or more, which the owner's desktop always runs at. A phone runs at 60 Hz (and so would
a 60 Hz monitor). `spell-target` (damping 11) diverged too, but only below about 45 fps.

Reproduced in Playwright WebKit as an iPhone 15 Pro (Home Screen size): a prod bench build, a Ruby injected into the
hand, and a touch drag up to a Shop minion. Mid-drag, the last interior point of the ribbon was at (156691, 645576)
layout px, so the drawn line shot past the target and off the top of the screen. The cast itself always landed on the
right minion, and the line's endpoints (source and finger) were exact in both engines. Chromium headless happened to
stay under the limit in that run.

## Fix

`lassoSubsteps(h, cfg)` splits the frame into enough equal sub-steps that `h * (c + sqrt k) <= 1.5` holds at the
stiffest point (capped at 64). A 240 Hz desktop takes one step per frame for every shipped aim def, so it is
unchanged. 144-165 Hz takes 2 for `ruby-target`, which was stable there already and still reaches the same rest.
`aimLassoStability.test.ts` drives every shipped targeting def through the repro's drag at 240 / 165 / 120 / 60 / 30 /
20 fps and requires the ribbon to stay near its chord. Without the fix, 7 of its cases fail.
