import { getHero } from '@game/sim';

/**
 * Shorter hero names for the lobby rail only (owner 2026-11-02: "Keshi the Protector can be shortened to Keshi in the
 * lobby rail" ... "lets just adjust lord of risen to risen"). Hero select, tooltips, the scout card and everywhere else
 * keep the full name. A hero not listed here shows its full name on the rail too.
 */
export const RAIL_HERO_NAMES: Readonly<Record<string, string>> = Object.freeze({
  keshi: 'Keshi',
  risen: 'Risen',
});

/** The name the lobby rail prints for a hero: its short rail name if it has one, else its full name. */
export function railHeroName(heroId: string | undefined): string {
  const hero = getHero(heroId); // resolves renamed ids, like every other hero lookup
  return RAIL_HERO_NAMES[hero.id] ?? hero.name;
}
