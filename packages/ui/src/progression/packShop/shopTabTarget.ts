/**
 * WHERE THE NAV'S SHOP TAB GOES (the pack economy, 2026-12-01, spec section 11): the Pack Shop once the server's
 * `progression_config.packs_enabled` is on, in every build; with it off, the Chest Shop in a production build and the
 * Pack Shop lab behind the shop's door in a DEV build (for tuning). The server's switch alone decides, never the
 * client's version (spec section 12). Its own file so the nav reads it without loading the shop's chunk.
 */
export type ShopTabTarget = 'packs' | 'pack_lab' | 'chests';

export function shopTabTarget(packsOn: boolean, dev: boolean): ShopTabTarget {
  if (packsOn) return 'packs';
  return dev ? 'pack_lab' : 'chests';
}
