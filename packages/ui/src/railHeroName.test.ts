/** Owner 2026-11-02: the lobby rail shortens two hero names; every other surface keeps the full name (R-RAIL-HERO-SHORTNAME-01). */
import { describe, expect, it } from 'vitest';
import { getHero } from '@game/sim';
import { RAIL_HERO_NAMES, railHeroName } from './railHeroName';

describe('railHeroName', () => {
  it('Keshi the Protector reads Keshi and Lord of the Risen reads Risen on the rail', () => {
    expect(railHeroName('keshi')).toBe('Keshi');
    expect(railHeroName('risen')).toBe('Risen');
    expect(getHero('keshi').name).toBe('Keshi the Protector'); // the full name is untouched everywhere else
    expect(getHero('risen').name).toBe('Lord of the Risen');
  });
  it('every other hero shows its full name, Emerald Warden included', () => {
    expect(railHeroName('emeraldwarden')).toBe('Emerald Warden');
    expect(railHeroName('discodan')).toBe('Disco Dan');
    expect(railHeroName('flint')).toBe('Foreman Flint');
  });
  it('every short name belongs to a real hero', () => {
    for (const id of Object.keys(RAIL_HERO_NAMES)) expect(getHero(id).id).toBe(id);
  });
});
