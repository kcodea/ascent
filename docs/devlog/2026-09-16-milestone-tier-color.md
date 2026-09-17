# Milestone celebration recolours to the tier's colour (+ retuned tier schedule)

Follow-up to [`2026-09-14-stat-milestone-frames.md`](2026-09-14-stat-milestone-frames.md). The badge milestone
celebration used to play the stock gold `rune-select-implosion` at every tier; now it fires in the colour of
the tier the stat just crossed into, matching the frame glow underneath it (owner decision 2026-09-15,
Approach A).

## Retuned tier schedule (owner ask 2026-09-16)

The milestone thresholds went from `[50, 100, 500, 1000, 5000]` to `[0, 50, 150, 500, 2000, 5000]`, and a
sixth "final" crystal frame was added:

| Tier | Frame | Range |
|------|-------|-------|
| 1 | plain silver | 0–49 |
| 2 | silver dagger | 50–149 |
| 3 | gold | 150–499 |
| 4 | pink | 500–1999 |
| 5 | blue | 2000–4999 |
| 6 | blue crystal (dual swords / heart) | 5000+ |

Tier 1's threshold is `0`, so the plain-silver frame is now the baseline every minion wears (the flat `.plate`
only shows for a negative stat); a stat "earns" its first *celebrated* frame at 50. Tier 6's art
(`milestone-{atk,hp}-6.webp`, converted from the owner's PNGs to 512² webp via sharp, ~43–53 KB) has a
TRANSPARENT centre — no leather disc — so its number sits on the `.mstint` disc alone. Tier 5 keeps its blue
glow (`glow5` = `#4fd1ff`) and tier 6 glows white (`glow6` = `#ffffff`), so the two top tiers read distinctly.
The other five frame arts, glow colours and config structure
are unchanged; the tuner threshold labels and preview digits were updated to match. The recolor below reads
`glow1..6`, so the celebration colours follow this schedule automatically.

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

## Badge tint + number redesign (owner ask 2026-09-16)

The stat-state signal moved from the tint disc to the number. Previously the `.mstint` disc sat OVER the frame
and recoloured by state (neutral gold / buffed green / reduced red). Now:

- **Tint is behind the frame and fixed per stat**: `.mstint` is the DOM child before `.msframe`, so it paints
  behind the frame art, and its colour is `tintAtk` (yellow) for Attack / `tintHp` (red) for Health regardless
  of buff state. Consequence: it shows through the tier-6 crystal frame's transparent centre but is covered by
  the opaque leather centre of tiers 1–5.
- **The number carries the state**: `numColor` (neutral) / `numColorUp` (buffed) / `numColorDown` (reduced)
  recolour the digit via `.badge.up`/`.badge.down`. Config lost `tintNeutral/Up/Down`, gained
  `tintAtk`/`tintHp` + `numColorUp`/`numColorDown`; the tuner's colour controls moved with it.

## Notes / interactions

- Frame glow halo: only tiers 4–6 (pink / blue / crystal) wear one; tiers 1–3 (plain silver / dagger / gold)
  have their `.msglow` disc hidden in CSS (owner ask 2026-09-16). The `glow1..3` config values still tint each
  tier's celebration burst — this only removes the halo behind the frame.
- Tiers 1 and 2 share the same silver glow *value* (plain silver / dagger), so they celebrate identically;
  tiers 3–6 are gold / pink / blue / white (tier 5 blue, tier 6 white). Tier 1 sits at threshold 0,
  so in practice its celebration never fires (a stat starts there rather than crossing up into it) — it's the
  baseline look. Tier 3's derived gold (from `glow3 #ffd54a`) reads slightly yellower than the def's original
  orange-ember ramp, since it derives from the glow rather than the def's own palette.
- The recolor applies to whatever def is bound, including a future per-card milestone override. If a bespoke
  milestone def ever wants its own fixed colours, give it `tintMode: 'texture'` layers (which `recolorDef`
  skips) or add an opt-out then.

## Tests

`recolorDef.test.ts` (identity/no-op, per-layer clone vs identity, no mutation, richer-def field carry-through)
and `milestonePalette.test.ts` (ramp values + luminance ordering, tier→glowN mapping, out-of-range undefined).
