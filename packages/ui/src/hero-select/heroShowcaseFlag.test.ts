// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('../touchUi'); vi.resetModules(); localStorage.clear(); });

it('is on by default, and a DEV client can turn it off (remembered)', async () => {
  vi.resetModules();
  const { heroShowcaseOn, setHeroShowcase } = await import('./heroShowcaseFlag');
  expect(heroShowcaseOn()).toBe(true);
  setHeroShowcase(false);
  expect(heroShowcaseOn()).toBe(false);
  expect(localStorage.getItem('ascent.heroShowcase')).toBe('0');
  setHeroShowcase(true);
  expect(heroShowcaseOn()).toBe(true);
});

it('a production build is always on it, whatever this machine remembered', async () => {
  vi.resetModules();
  vi.stubEnv('DEV', false);
  localStorage.setItem('ascent.heroShowcase', '0');
  const { heroShowcaseOn } = await import('./heroShowcaseFlag');
  expect(heroShowcaseOn()).toBe(true);
});

it('the touch UI (phones, small tablets) keeps the older layout, in production too', async () => {
  vi.resetModules();
  vi.stubEnv('DEV', false);
  vi.doMock('../touchUi', () => ({ touchUi: () => ({ on: true }), onTouchUiChange: () => () => undefined }));
  const { heroShowcaseOn } = await import('./heroShowcaseFlag');
  expect(heroShowcaseOn()).toBe(false);
});
