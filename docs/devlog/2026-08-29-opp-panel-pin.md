# 2026-08-29 — Pin the whole opponent combat panel (runes, name, health, pills)

Owner report (via a friend on a different-size screen): the opponent's **runes read "off"** in combat.

**Cause.** After pinning the foe hero power (#1300) and the portrait position (#1301), everything positioned
*inside* the portrait was still skewing: the portrait renders at a fixed `scale(2.4)` (no `--scale`) while its
content is sized in `--u` (which scales with the board), but the offset knobs — `nameX/Y`, `hpX/Y`, `runeX/Y`,
`runeGap`, `rune1–3 X/Y`, and the attack `pillX/Y` / `pillPlayerX/Y` — were **raw px**. So the art scaled with
the window while those offsets stayed a constant pixel count → they slid out of place at any screen size other
than the one they were tuned at. The runes have the biggest offsets, so they drifted the most.

**Fix.** Multiply every one of those offsets by `var(--scale)` in styles.css (matching the power/portrait), so
they track the board. Since that changes the values' meaning from raw px to reference px, the owner's dialed
positions were converted by the tuned stage scale (`0.5109375`) so the on-screen look is preserved and now holds
at every size/aspect: nameY 23→45, hpY −23→−45, runeX −148→−290, runeY −19→−37, runeGap 20→39, rune1 158/25→309/49,
rune2 87/−28→170/−55, rune3 25/−62→49/−121, pill(opp) −60/−16→−117/−31, pill(player) 37/−6→72/−12. Baked into
`heroDuelConfig.ts` DEFAULTS + the styles.css `--hd-*` fallbacks. The damage number (0/0, centred on the pinned
portrait) and all the `*Scale` knobs (ratios) were already pinned.

Verified: typecheck ✅, build:web ✅.
