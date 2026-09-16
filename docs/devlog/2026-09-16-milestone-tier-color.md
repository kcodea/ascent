# Milestone celebration recolours to the tier's colour (+ retuned tier schedule)

Follow-up to [`2026-09-14-stat-milestone-frames.md`](2026-09-14-stat-milestone-frames.md). The badge milestone
celebration used to play the stock gold `rune-select-implosion` at every tier; now it fires in the colour of
the tier the stat just crossed into, matching the frame glow underneath it (owner decision 2026-09-15,
Approach A).

## Retuned tier schedule (owner ask 2026-09-16)

The milestone thresholds went from `[50, 100, 500, 1000, 5000]` to `[0, 50, 150, 500, 2000]`, keeping all five
frames but changing where each lights up:

| Tier | Frame | Range |
|------|-------|-------|
| 1 | plain silver | 0–49 |
| 2 | silver dagger | 50–149 |
| 3 | gold | 150–499 |
| 4 | pink | 500–1999 |
| 5 | blue/black | 2000+ |

Tier 1's threshold is `0`, so the plain-silver frame is now the baseline every minion wears (the flat `.plate`
only shows for a negative stat); a stat "earns" its first *celebrated* frame at 50. Only the numbers moved —
the five frame arts, the glow colours (`glow1/2` silver, `glow3` gold, `glow4` pink, `glow5` blue), and the
config structure are unchanged; the tuner threshold labels and preview digits were updated to match. The
recolor below reads `glow1..5`, so the celebration colours follow this schedule automatically.

## The design question, and why per-call recolor

An FX def gets its colour from each layer's `palette` param (four rim→core stops — see `palettes.ts` /
`particleMaterial.ts`'s `tintMode: 'palette'`). `playDef` had **no per-call colour channel**, and that was
deliberate: `scaleDef`'s header rules out a per-call parameter channel ("anything finer belongs in a separate
def"), and the authoring-time `applyVariant` only transforms *slider* params, not palettes.

The two ways to hit "one celebration, five colours" were (A) a runtime palette recolor sourced from the frame
glow config, or (B) five hand-authored def variants. The owner picked **A** — one binding, and the celebration
colour reads the *same* value as the frame glow, so retuning a glow retunes the celebration automatically (no
second source of truth to drift).

The recolor is scoped so it doesn't reopen the door `scaleDef` closed: it is a **uniform, whole-def palette
swap** (a global colour axis in the family of `scale`/`intensity`), not a reach into an arbitrary param on a
specific layer.

## The pieces

- **`packages/ui/src/fx/recolorDef.ts`** — `recolorDef(def, palette)`: clones the def, writing the given 4-stop
  palette onto every palette-bearing layer, leaving others (and `tintMode: 'texture'` layers, which have no
  `palette`) untouched. Exact no-op by identity when the palette is absent/empty or the def has no palette
  layer, matching `scaleDef`'s contract. Generic over the def type so a `StoredFxDef` keeps
  version/seed/label/tags.
- **`packages/ui/src/fx/milestonePalette.ts`** — `rampFromColor(hex)` derives a rim→core 4-tuple from one
  colour (rim = ×0.18, outer = ×0.5, inner = the colour, core = colour→white 78% — the ramp approved on the
  2026-09-15 preview; those three constants are the tunable knobs). `milestoneTierPalette(tier)` reads the live
  `glow1..5` from `milestoneFrameConfig.ts` and returns that tier's ramp, or `undefined` for an out-of-range
  tier.
- **`playDef`** — a new optional `recolor?: readonly number[]` on `PlayDefOptions`, applied at the existing
  `scaleDef` transform site.
- **`fireStatMilestone`** — passes `milestoneTierPalette(tier)` as `recolor`. One binding
  (`rune-select-implosion`) still serves all five tiers.

Because the burst's `coreBias` biases most particles to the inner stop, the tier colour itself dominates the
cloud with a white-hot centre.

## Notes / interactions

- Tiers 1 and 2 share the same silver glow (plain silver / dagger), so they celebrate identically; tiers 3–5
  are gold / pink / blue. Tier 1 sits at threshold 0, so in practice its celebration never fires (a stat
  starts there rather than crossing up into it) — it's the baseline look. Tier 3's derived gold (from
  `glow3 #ffd54a`) reads slightly yellower than the def's original orange-ember ramp, since it derives from
  the glow rather than the def's own palette.
- The recolor applies to whatever def is bound, including a future per-card milestone override. If a bespoke
  milestone def ever wants its own fixed colours, give it `tintMode: 'texture'` layers (which `recolorDef`
  skips) or add an opt-out then.

## Tests

`recolorDef.test.ts` (identity/no-op, per-layer clone vs identity, no mutation, richer-def field carry-through)
and `milestonePalette.test.ts` (ramp values + luminance ordering, tier→glowN mapping, out-of-range undefined).
