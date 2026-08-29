# 2026-08-29 — Opponent portrait: anchor it to the foe hero power (scale-pinned)

Follow-on to the foe-hero-power scale-pin. Owner ask: pin the combat opponent portrait the same way, **using the
hero power as the anchor**.

The portrait (`.combatopp`) anchored its base to the Refresh button (scale-correct) but applied its `oppX/oppY`
fine-tune as **raw px** — the same skew bug the power had, so it drifted off the board on a non-fullscreen stage.

**Fix.** Re-anchor `.combatopp` off the **same top-right stage corner the foe hero power uses** (`--hd-power-x/y`)
instead of the Refresh button, and apply `oppX/oppY` as reference px `× --scale`. Now the portrait and the power
ride the same anchor — both stay locked to the board at any stage size, and moving the power moves the portrait.
`left`-anchor → `right`-anchor with `translate(50%, -50%)` centring; the wrapper transform still carries only the
placement (the lunge rides `.combatopp-body`, untouched).

Owner-dialed on the fixed build: **oppX 208 → 144, oppY -10 → 41** (reference px; oppScale 2.4 unchanged). Baked
into `heroDuelConfig.ts` DEFAULTS + the styles.css `--hd-opp-*` fallbacks. Verified: typecheck ✅, build:web ✅.
