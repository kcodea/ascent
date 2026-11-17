// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { heroShowcaseOn, setHeroShowcase } from './heroShowcaseFlag';
afterEach(() => setHeroShowcase(false));
it('is off by default and remembers a set', () => {
  expect(heroShowcaseOn()).toBe(false);
  setHeroShowcase(true);
  expect(heroShowcaseOn()).toBe(true);
  expect(localStorage.getItem('ascent.heroShowcase')).toBe('1');
});
