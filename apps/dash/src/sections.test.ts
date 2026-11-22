import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heatmap, trendSpark } from './charts';
import { fixtureHealth, fixturePlayers, fixtureProgression, fixtureSocial } from './fixture2';
import { SECTIONS, rate, renderHealth, renderPlayers, renderProgression, renderSocial, sectionOfHash, withSection, type Ctx } from './sections';

const ctx: Ctx = {
  game: null,
  names: { runes: { r1: { name: 'Rune One', art: '/art/runes/r1.webp' } }, ancients: { death: { name: 'Ancient of Death', art: null } }, achievements: { a1: 'First Steps' }, cosmetics: { c1: { name: 'Gold Frame', category: 'portrait_frame' } }, titles: { t1: 'Alpha Tester' } },
  heroCell: (id) => `<hero ${id}>`,
  tribeCell: (id) => `<tribe ${id}>`,
  img: (src) => `<img src="${src}">`,
  chartWidth: 900,
};
const NOW = new Date('2026-11-22T15:00:00Z');
const R = { from: '2026-10-24', to: '2026-11-22' };

describe('the parts of Analytics', () => {
  it('ride the URL hash next to the range and the view', () => {
    expect(sectionOfHash('#range=7d&sec=players')).toBe('players');
    expect(sectionOfHash('#range=7d')).toBe('overview');
    expect(sectionOfHash('#sec=nope')).toBe('overview');
    expect(withSection('#range=7d', 'health')).toBe('#range=7d&sec=health');
    expect(withSection('#range=7d&sec=health', 'overview')).toBe('#range=7d');
    expect(SECTIONS).toEqual(['overview', 'players', 'social', 'progression', 'health', 'balance']);
  });
  it('rates only with a denominator', () => {
    expect(rate(1, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
  });
  it('Health and Balance are separate parts; the old combined key still opens Health', () => {
    expect(sectionOfHash('#sec=balance')).toBe('balance');
    expect(sectionOfHash('#sec=health')).toBe('health');
    expect(sectionOfHash('#sec=healthbalance')).toBe('health');
  });
});

describe('the round-two renderers', () => {
  const pages = {
    players: renderPlayers(fixturePlayers(R, NOW), ctx),
    social: renderSocial(fixtureSocial(R, NOW), ctx),
    progression: renderProgression(fixtureProgression(R, NOW, { heroes: [], tribes: [], runes: [], ancients: [], achievements: ['a1', 'zz'], cosmetics: ['c1'], titles: ['t1'] }), ctx),
    health: renderHealth(fixtureHealth(R, NOW), ctx),
  };
  it('render every part without inline style attributes (the CSP forbids them)', () => {
    for (const [k, html] of Object.entries(pages)) {
      expect(html, k).not.toMatch(/\sstyle=/);
      expect(html.length, k).toBeGreaterThan(500);
    }
  });
  it('print the game names from the synced data, falling back to the id', () => {
    expect(pages.progression).toContain('First Steps');
    expect(pages.progression).toContain('Gold Frame');
    expect(pages.progression).toContain('Alpha Tester');
    expect(pages.progression).toContain('zz');
  });
  it('say what "now" means, that DMs are counted only, and when retention is too early to tell', () => {
    expect(pages.social).toContain('last 5 minutes');
    expect(pages.social).toContain('never read');
    const early = renderPlayers({ ...fixturePlayers(R, NOW), retention: { cohort: 2, d1: { eligible: 0, returned: 0 }, d7: { eligible: 0, returned: 0 }, d30: { eligible: 0, returned: 0 } } }, ctx);
    expect(early).toContain('Too early to tell');
  });
  it('the heatmap has 7 x 24 cells with plain-text tips; the trend line scales to its own spread', () => {
    const svg = heatmap([{ dow: 1, hour: 20, games: 5 }], 900);
    expect(svg.match(/class="hm"/g)).toHaveLength(168);
    expect(svg).toContain('data-tip="Mon 20:00, 5 games"');
    const flat = trendSpark([{ games: 1, avgPlacement: 4 }, { games: 1, avgPlacement: 4 }]);
    const moving = trendSpark([{ games: 1, avgPlacement: 3 }, { games: 1, avgPlacement: 6 }]);
    expect(flat).toContain('<path');
    expect(moving).not.toEqual(flat);
  });
  it('the page source keeps secrets out and inline styles out', () => {
    for (const f of ['sections.ts', 'fixture2.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src, f).not.toMatch(/style="/);
      expect(src, f).not.toMatch(/SERVICE_ROLE|supabase\.co/i);
    }
  });
});
