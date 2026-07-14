# Card frames (pipeline layer 2 — authored shields)

Drop authored frame art here. The UI prefers a raster frame when the file exists and falls back to the
built-in SVG placeholder when it doesn't (see `Card.tsx` → `TAUNT_FRAME_SRC` / `.tframe-img`).

## `taunt-shield.png` — the Taunt heater shield

**What it is:** the ornate gold heater-shield **frame only** — border, gems, and a top banner plaque —
with a **transparent center window** where the unit's portrait shows through. The portrait, the live
stats, the tier, and the tribe medallion are **other layers composited on top**, so the frame art must
NOT contain a character, numbers, or a filled center.

### Hard requirements (so it drops in without re-work)
- **Format:** PNG (or WebP) with a real **alpha channel**. Everything outside the shield = fully transparent.
- **Transparent window:** the center is a **heater silhouette** (wide rounded top → point at the bottom),
  transparent, matching this outline (fractions of the window box, y-down):
  `8,0 · 92,0 · 97,5 · 100,15 · 100,40 · 96,60 · 86,78 · 66,92 · 50,100 · 34,92 · 14,78 · 4,60 · 0,40 · 0,15 · 3,5`
  The portrait is clipped to this exact shape behind the frame — the gold border should overlap the window
  edge by a few percent so there's no seam.
- **Canvas / overhang:** author on a canvas where the **window fills the middle**, the **top gem + banner**
  live in a band above it, and the **bottom point** extends below. As a starting target the CSS reserves
  roughly: **+8% above, +16% below, +4% each side** beyond the portrait square. Keep the shield centered
  horizontally. (We'll fine-tune `.tframe-img` inset to your art — get it close, not exact.)
- **Resolution:** ~2× — aim for **≥ 700 px** on the long edge so it's crisp on big combat cards.
- **No baked slots for dynamic data:** do **not** paint attack/health numbers, a tier number, or a tribe
  glyph. Those are DOM overlays. You *may* bake **empty** decorative gold sockets, but the safest first pass
  is **no stat sockets** — our existing gold badges already sit on top at:
  - attack: lower-left of the shield body
  - health: lower-right of the shield body
  - tribe medallion: bottom-center, above the point
  - tier: a small plaque at the top-center (you *can* bake the empty banner ribbon there)
- **Neutral gold:** author the metal in **neutral gold/steel**. The tribe color is applied as a separate tint
  layer, so a single frame recolors for every tribe — don't bake a tribe color into the whole frame (a red
  inner accent band like the reference is fine and stays).

### Generation brief (paste into your image tool)
> Ornate golden heater shield **frame only**, front-facing, symmetrical. Thick beveled polished-gold border
> with a deep-red inner accent band, a faceted red gemstone set at the top center and a small red gem at the
> bottom point, an empty engraved banner ribbon across the top. The **center is empty / transparent** — a
> shield-shaped window, no character, no text, no numbers. Clean rim lighting, subtle engraving, game-UI asset,
> high detail, centered, on a fully transparent background. PNG with alpha.

Save the result here as **`taunt-shield.png`** and reload — every Taunt card switches from the SVG
placeholder to your art automatically.

## `standard-oval.png` — the standard minion frame · `spell-frame.png` — the spell frame

Same pipeline as the Taunt shield, applied as the **base frame** for two whole card categories:

- **`standard-oval.png`** — the ornate gold **oval** on every non-Taunt minion. Neutral gold; a per-tribe
  **tint layer** (`.cframe-tint`, masked to the frame's alpha, `mix-blend-mode: color`) recolours it toward
  the tribe hue (dual-tribe splits the gradient). Window = an **ellipse**.
- **`spell-frame.png`** — the purple **square** on regular spells (NOT the golden Triple-Reward token). No
  tint (spells have no tribe; the frame carries its own purple accent). Window = a **rounded rectangle**.

Requirements are identical to the Taunt shield: **frame only**, real **alpha**, transparent window, neutral
metal, a bakeable empty top **banner** (the tier plaque seats on it), **no** baked stats/tier/tribe glyphs.
The geometry is MEASURED from each PNG's alpha and encoded in `styles.css` under **"AUTHORED FRAMES"**
(the `--sh` size knob + per-window multipliers) — **if you replace the art, re-measure the window/banner and
retune those constants.** Precedence per card: spell → square · else Taunt → heater · else → oval. On a 404
the class is dropped and the card falls back to the original arch / spell look.
