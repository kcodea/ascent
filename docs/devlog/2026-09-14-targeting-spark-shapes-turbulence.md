# Targeting lasso sparks — shapes, size variance, and turbulence

The `targeting` primitive's sparks were plain additive circles tied to a couple of knobs. Owner wanted the
emitter's richness on the lasso ("more sparkles, change their shape, size", and swirl "like sparks from a
fire"). Rather than duplicate the emitter, the sparks now reuse the shared building blocks:

- **Shape** (`sparkleShape`) — the built-in shape set (`SHAPE_NAMES`: circle / square / triangle / diamond /
  star / shard). Non-round shapes orient along their travel direction. Drawn as cheap `Graphics.poly()` fills
  (a tiny `sparkPoly` helper), no textures — so a lasso still costs one Graphics.
- **Size variance** (`sparkleSizeVar`) — exposes the per-spark size spread that was hardcoded.
- **Turbulence** (`sparkleTurbulence` + `sparkleTurbScale`) — a swirling curl on each spark's velocity via the
  shared `motion.ts` `turbulenceX/turbulenceY` field (the same one the emitter uses), so sparks eddy like
  embers instead of flying straight.

All knob-driven and per-lasso, so drift/embers/fire-swirl are authorable variations. Colour was already a
two-stop palette; opacity already decoupled from the line.

Deliberately NOT full emitter parity (no emit-shapes / SVG / cel material) — those live on the emitter/custom
primitives; a Stream layer anchored to the cursor covers point-source needs. Along-the-ribbon distribution is
the lasso-specific value this adds.
