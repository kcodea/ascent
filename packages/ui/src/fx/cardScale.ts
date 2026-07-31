/**
 * How wide a card is when the board is at its reference size, in viewport px.
 *
 * Derived from `styles.css`: `--ch-base` 384 × the default `--card-scale` 0.77 × the 0.752 width ratio ≈ 222.
 * It is a REFERENCE, not a constant the layout is held to — the whole board scales with the viewport (`--u`)
 * and with the dev Layout Lab's card-size lever, which is exactly why a def sized for a card needs a per-call
 * multiplier rather than a baked number.
 */
export const FX_REF_CARD_W = 222;

/**
 * The `scale` a card-sized def should play at for a card of measured width `w`.
 *
 * The one place the "how big is this card right now" question is answered, so the several card-anchored
 * effects still to migrate (`shatterAt`, `rebornSummon`, `deathrattle`, …) all agree on the reference rather
 * than each picking a number. A def authored against a reference-size card therefore plays at 1 there, and
 * grows/shrinks with the real board.
 *
 * Returns 1 for a width that isn't a usable measurement — a zero-width or unlaid-out element is a rect the
 * caller shouldn't have fired on at all, and playing at the authored size beats collapsing the effect to
 * nothing or poisoning it with a NaN (`normalizeAxis` would catch that anyway; this makes the intent local).
 *
 * NOTE the clamping caveat that applies to every axis: each scaled param is held to its own slider range, so
 * a very large card does not grow the effect without limit. See `FxParamMeta.axis`.
 */
export function cardFxScale(w: number): number {
  return Number.isFinite(w) && w > 0 ? w / FX_REF_CARD_W : 1;
}
