/** The 68 Set 2 runes the owner's Set 3 rune review board (2026-11-23, R-SET3-RUNE-REVIEW-01) added to Set 3. Older
 *  roster tests pin a rune's `sets` exactly; they read `withSet3` so the review's +set3 is the only thing allowed to move. */
export const SET3_REVIEW_JOINED: readonly string[] = [
  'rune_facetwright', 'rune_mountain_trade', 'rune_ruby_dust', 'rune_rough_cut', 'rune_spellstone', 'rune_vein_finder', 'rune_gemspam',
  'rune_deepening_vein', 'rune_gem_rain', 'rune_conduit', 'rune_basic_dragon', 'rune_runic_hoard', 'rune_draconic_curiosity',
  'rune_epic_dragon', 'rune_sequencing', 'rune_dragons_egg', 'rune_dragonscale', 'rune_shared_pour', 'rune_deep_pockets',
  'rune_bottomless_cask', 'rune_big_spender', 'rune_royal_treasury', 'rune_baal', 'rune_brisbane', 'rune_soul_taxes', 'rune_pillaging',
  'rune_small_fortune', 'rune_vault', 'rune_treasure_map', 'rune_piggy_bank', 'rune_loyal_customer', 'rune_end_of_quarter',
  'rune_window_shopping', 'rune_hazard_pay', 'rune_late_bloomer', 'rune_blood_and_coin', 'rune_second_opinion', 'rune_hatchery',
  'rune_rebirth', 'rune_aftershocks', 'rune_warm_up', 'rune_underdog', 'rune_trophy', 'rune_pair', 'rune_top_hat', 'rune_summit',
  'rune_pendant', 'rune_evolution', 'rune_altar', 'rune_shield_wall', 'rune_living_magic', 'rune_wholesale', 'rune_top_shelf',
  'rune_grudge', 'rune_reliquary', 'rune_tempered_time', 'rune_inheritance', 'rune_mirror_march', 'rune_vanguard', 'rune_undertow',
  'rune_wildfire', 'rune_recurrence', 'rune_crown', 'rune_appraisal', 'rune_banquet_hall', 'rune_sylus', 'rune_bastion', 'rune_double_bill',
];
const JOINED = new Set(SET3_REVIEW_JOINED);
/** `sets` as the older pin expected it, plus 'set3' when the review board added it. */
export const withSet3 = (id: string, sets: readonly string[] | undefined): string[] | undefined =>
  sets && JOINED.has(id) && !sets.includes('set3') ? [...sets, 'set3'] : sets ? [...sets] : sets;
