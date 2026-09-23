# 2026-09-23 — Epic / Sell / Equip medallions, medallion routing + tuning, layout & step-counter

Follow-on to the medallion rework, all `packages/ui`, owner-driven and tuned live.

## New medallion targets

- **Epic** (`epicMedallion.ts`, `EpicMedallionTuner.tsx`, `epicMedallionConfig.ts`): a SEPARATE badge (not the
  mechanic gem) on "epic" units — those that change how many TIMES something fires. Curated set of 13 card ids
  (the `triggerMultiplier` family + Yazzus + Deepdelve Paragon). Always the same icon (no gild/silver), the
  medallion drop shadow, plus a tunable coloured glow. Its own ✴️ tuner (size / offset / glow), card-relative
  offsets, baked seat (size 1.3, dx 3, dy 106.5, white glow).
- **Sell** and **Equip** (`mechanics.ts` + `keywordGlossary.ts`): new mechanics off the `onSell` / `equip`
  effect triggers, with `sell.webp` / `equip.webp`. Both got glossary entries so the compendium shows the art.
- **Overflow** now renders the **Watcher eye** via a new art-alias map (`MECH_MEDALLION_ART_ALIAS`) in
  `mechMedallion.ts`.

## Medallion routing changes (`mechIcon.ts` / `mechanics.ts` / `mechMedallion.ts`)

- **Flurry** joined `MEDALLION_EXCLUDED` (its attack animation marks it), so a Flurry+X unit shows X (Blazer →
  Rally). Its two-sword art was **renamed `flurry.webp` → `execute.webp`** and Execute added to the PNG set, so
  the two swords now mark **Execute**.
- **Start of Turn** effects (`on: 'startOfTurn'`) now match the `startCombat` mechanic, sharing the lightning
  medallion. Each card still labels itself by its own text in the keyword panel.
- **Execute** gets a red multiply sheen via a per-mechanic tint map (`MECH_MEDALLION_ART_TINT`); `.cgem` is its
  own stacking context so the blend stays contained. It fades with the keyword: the sim strips Venomous on use
  and the combat card reads live keywords, so the medallion clears once Execute fires.
- Per-mechanic art maps grew: **size** (shout 1.15, endTurn 0.90, sell 0.80) and **rotation** (shout 32.4°).

## Flurry aura (`flurryConfig.ts`)

Global `opacityMul: 1.3` (+30% over every ring's alpha, clamped) and `pulse: 0` (steady, no in/out breathe).

## Tuning bakes

- Layout (`layoutConfig.ts` + styles.css fallbacks): Shop row Y 65 → 59, Warband Y −155 → −136.
- Step counter (`stepCounterConfig.ts` + fallback): Y −44 → −53 (and the tuner y-range widened to reach it).

## Not in here

The lingering blue-medallion Pixi effect on board slots (owner report) is under investigation and lands as its
own PR.
