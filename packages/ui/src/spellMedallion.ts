/** SPELL / RUBY MEDALLIONS — the crystal art that marks a Shop Spell (blue star), a Ruby (red gem) or a Gift (purple box) (owner art,
 *  2026-10-09), replacing the purple "✦ Spell" / "◆ Ruby" type pill. Tuned by the 💠 Spell & Ruby Medallions tuner. */
export const SPELL_MEDALLION_SRC = `${import.meta.env.BASE_URL}medallions/spell.webp`;
export const RUBY_MEDALLION_SRC = `${import.meta.env.BASE_URL}medallions/ruby.webp`;
export const GIFT_MEDALLION_SRC = `${import.meta.env.BASE_URL}medallions/gift.webp`;
/** The HERO POWER medallion (owner art 2026-10-12): the emerald crystal helm. Worn by a hero power drawn as a card
 *  (the hero-power Discover), where a spell wears one of the three above. */
export const POWER_MEDALLION_SRC = `${import.meta.env.BASE_URL}medallions/power.webp`;
/** The WHISPER medallion (Set 4, owner art 2026-10-14: "change the whisper spell medallion from the spell shard to
 *  whispermedallion"): three cyan crystal arcs. Trimmed and centred on a square canvas so it sits in the same box as
 *  the spell shard. Lives under `frames/` (not `medallions/`, which the preload plan puts on the chrome lane) so it is
 *  not preloaded while Set 4 is disabled. */
export const WHISPER_MEDALLION_SRC = `${import.meta.env.BASE_URL}frames/whisper-medallion.webp`;
