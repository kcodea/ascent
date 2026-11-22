import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deployPlan } from '../scripts/deployPlan.mjs';
import { fixtureBreakdown, fixtureOverview } from './fixture';
import { SERIES, esc, minusDays, niceScale, seriesValues, titleCase, topHalfLabel } from './format';
import type { GameMode } from './types';

describe('deployPlan (dashboard)', () => {
  it('defaults to a preview deploy of ascent-dash', () => {
    expect(deployPlan([])).toEqual({ branch: 'preview', args: ['pages', 'deploy', 'dist', '--project-name', 'ascent-dash', '--branch', 'preview'] });
  });
  it('refuses production without --owner-approved', () => {
    expect(deployPlan(['--production'])).toHaveProperty('error');
  });
  it('deploys main only with both flags', () => {
    expect(deployPlan(['--production', '--owner-approved'])).toMatchObject({ branch: 'main' });
    expect(deployPlan(['--owner-approved'])).toMatchObject({ branch: 'preview' });
  });
});

describe('format', () => {
  it('every game mode lands in exactly one chart series', () => {
    const modes: GameMode[] = ['ranked', 'unrated_lobby', 'practice', 'versus_duel', 'versus_group', 'versus_duos', 'ranked_duos', 'tutorial', 'other'];
    for (const m of modes) expect(SERIES.filter((s) => s.modes.includes(m)).length, m).toBe(1);
    expect(new Set(SERIES.map((s) => s.slot)).size).toBe(SERIES.length);
  });
  it('series values sum to the day total', () => {
    for (const d of fixtureOverview(new Date('2026-11-22T12:00:00Z')).daily) {
      expect(seriesValues(d).reduce((a, b) => a + b, 0)).toBe(d.games);
    }
  });
  it('escapes, labels and steps', () => {
    expect(esc('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    expect(titleCase('disco_dan')).toBe('Disco Dan');
    expect(topHalfLabel(8)).toBe('Top 4');
    expect(topHalfLabel(2)).toBe('Win');
    expect(minusDays('2026-03-01', 1)).toBe('2026-02-28');
    expect(niceScale(37)).toEqual({ max: 40, step: 10 });
    expect(niceScale(0)).toEqual({ max: 4, step: 1 });
  });
});

describe('the page', () => {
  const root = join(__dirname, '..');
  it('has no inline style attributes or inline scripts (the CSP in public/_headers forbids them)', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    for (const f of ['main.ts', 'charts.ts']) expect(readFileSync(join(root, 'src', f), 'utf8')).not.toMatch(/style="/);
    expect(readFileSync(join(root, 'public/_headers'), 'utf8')).toMatch(/frame-ancestors 'none'/);
  });
  it('never puts a secret in client code', () => {
    for (const f of ['main.ts', 'charts.ts', 'format.ts', 'fixture.ts']) {
      expect(readFileSync(join(root, 'src', f), 'utf8')).not.toMatch(/SERVICE_ROLE|service_role|supabase\.co/i);
    }
  });
  it('the fixture matches the contract shapes', () => {
    const b = fixtureBreakdown({ from: '2026-11-16', to: '2026-11-22' });
    expect(b.from).toBe('2026-11-16');
    expect(b.heroes.some((h) => h.band !== 'all')).toBe(true);
    expect(b.modes.length).toBeGreaterThan(0);
  });
  it('the fixture draws its heroes and tribes from the ids it is given (the synced live set)', () => {
    const b = fixtureBreakdown({}, { heroes: ['warden', 'indy'], tribes: ['kobold', 'dwarf'] });
    expect(new Set(b.heroes.map((h) => h.heroId))).toEqual(new Set(['warden', 'indy']));
    expect(new Set(b.tribesInRun.map((t) => t.tribe))).toEqual(new Set(['kobold', 'dwarf']));
  });
  it('art comes from the same origin, and the only outside host is the game\'s own Google Fonts', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)) expect(m[1]).toMatch(/^https:\/\/fonts\.(googleapis|gstatic)\.com/);
    expect(readFileSync(join(root, 'public/_headers'), 'utf8')).toMatch(/img-src 'self' data:;/);
  });
});
