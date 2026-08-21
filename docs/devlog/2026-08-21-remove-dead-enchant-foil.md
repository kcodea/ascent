# 2026-08-21 — Remove the dead Cia enchant foil (`ciaEnchantedFx.ts` + `.enchantwisp` CSS)

The queued follow-up from the `cia-hp` enchant migration. Cia's Enchanted-offer treatment became the authored
`cia-hp` FX def (played by `useCiaEnchantedFx`) back on 2026-08-20; the old implementations were left in place
to delete later. Nothing referenced them any more:

- **`packages/ui/src/ciaEnchantedFx.ts`** (the persistent Pixi "holographic foil" controller, 526 lines) —
  no `import` of it anywhere; every remaining mention was a comment. Deleted.
- **`.enchantwisp` CSS** in `styles.css` (the two-ring red/gold swirl kept as a no-WebGL fallback) — the JSX
  that rendered `<span className="enchantwisp">` was removed on 2026-08-20, so the rules matched no element.
  Deleted the block + the `ewspin` keyframes, and trimmed the `prefers-reduced-motion` rule down to
  `.soulbindmark` alone (it had shared the selector with `.enchantwisp .ew-ring`).
- Dangling comments updated: the "delete in a follow-up" note in `Card.tsx` and the `heroFxConfig` comment
  that pointed at the deleted controller.

Verified: typecheck ✅, lint 0 errors ✅, build:web ✅. Net −573 lines.

**Left for a follow-up (out of scope — touches the FX tuner):** the enchant foil's config is now orphaned but
still present — the `cia*` fields in `heroFxConfig.ts`, the `--hfx-enc-*` CSS-var setters in `applyHeroFxVars`,
and the enchant tuner knobs. Nothing reads them, but removing them cleanly means touching the tuner panel, so
it belongs in its own change. The `heroFxConfig` comment now marks the block ORPHANED so it isn't mistaken for
live config.
