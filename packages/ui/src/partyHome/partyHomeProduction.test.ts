// @vitest-environment jsdom
/** R-PH-PRODUCTION-01: the party home is the production UI. No shell piece may sit behind a DEV-only gate again. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const src = (f: string): string => readFileSync(join(__dirname, '..', f), 'utf8');
const HOSTS = ['Career.tsx', 'EscMenu.tsx', 'Game.tsx', 'HeroSelect.tsx', 'live/LiveGames.tsx', 'MenuSidebar.tsx', 'MinionBook.tsx', 'PatchNotesPage.tsx',
  'progression/CollectionScreen.tsx', 'progression/CrateShop.tsx', 'Rankings.tsx', 'RecentGames.tsx', 'Title.tsx', 'partyHome/shell/phWarm.ts', 'preloadPlan.ts'];

describe('the party home ships (R-PH-PRODUCTION-01)', () => {
  it('no host leaves a shell piece out of a production build', () => {
    for (const f of HOSTS) expect(src(f), f).not.toMatch(/import\.meta\.env\.DEV\s*\?\s*(lazy\(loadPh|lazy\(\(\) => import\('[^']*(partyHome|\/ph\/)|Ph|import\.meta\.glob)/);
    expect(src('partyHome/shell/phWarm.ts')).toContain('import.meta.glob');
  });

  it('the dev tools stay out of a production build', () => {
    for (const name of ['DevMenu', 'EditorOverlay', 'BugScenarioPanel', 'BalancePanel']) {
      const host = HOSTS.map(src).find((t) => new RegExp(`^const ${name} = `, 'm').test(t));
      expect(host, name).toBeTruthy();
      expect(host, name).toMatch(new RegExp(`^const ${name} = import\\.meta\\.env\\.DEV \\? lazy\\(`, 'm'));
    }
  });

  it('a production build is always on it, whatever this machine remembered', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    localStorage.setItem('ascent.partyHome', '0');
    try {
      const { partyHomeOn } = await import('./partyHomeFlag');
      expect(partyHomeOn()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      localStorage.removeItem('ascent.partyHome');
    }
  });
});
