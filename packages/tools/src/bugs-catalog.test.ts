/**
 * bugs:catalog — the pure half, sabotage-proofed without an inbox or a Supabase key.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RETRO_CATALOG_IDS } from '@game/sim';
import {
  CATALOG_APPEND_MARKER, CATALOG_PATH, catalogIdsInSource, insertCatalogStub, planCatalogStub, shortReportId,
  slugFromDescription, titleFromDescription, type CatalogStubInput,
} from './bugs-catalog.lib';

const REPO_ROOT = join(__dirname, '..', '..', '..');

const closed: CatalogStubInput = {
  reportId: '9852e16f-9860-424f-8494-f8d3bb62a0a5',
  createdAt: '2026-09-05T01:15:29.506Z',
  status: 'closed',
  description: 'great presets … broken on mirrorwing\nsecond line ignored',
  fixCommits: ['02378164'],
  today: '2026-09-11',
};

describe('bugs:catalog — planning a stub', () => {
  it('derives id, date, title and fix from a closed report; the title is the player\'s words, quoted', () => {
    const plan = planCatalogStub({ ...closed, slug: 'gifts-no-target' }, []);
    expect(plan.ok, plan.refusals.join('; ')).toBe(true);
    expect(plan.id).toBe('9852e16f-gifts-no-target');
    expect(plan.entry).toContain("reportDate: '2026-09-05'");
    expect(plan.entry).toContain("fixCommits: ['02378164']");
    expect(plan.entry).toContain('title: "great presets … broken on mirrorwing"');
    expect(plan.entry).toContain("verifiedBy: { kind: 'pending' }");
    expect(plan.entry).toContain('patch: []');
    expect(plan.mapRow).toContain("catalogId: '9852e16f-gifts-no-target'");
  });

  it('derives a kebab slug from the description when none is given', () => {
    expect(slugFromDescription('Rope Wrangler shows 2x the cards!')).toBe('rope-wrangler-shows-2x');
    expect(slugFromDescription('')).toBe('report');
    expect(shortReportId('9852e16f-9860-424f-8494-f8d3bb62a0a5')).toBe('9852e16f');
    expect(titleFromDescription('   \n  first real line  \nmore')).toBe('first real line');
    expect(titleFromDescription('x'.repeat(200)).length).toBe(110);
  });

  it('REFUSES an open report — a catalog entry cites a fix', () => {
    const plan = planCatalogStub({ ...closed, status: 'reproduced' }, []);
    expect(plan.ok).toBe(false);
    expect(plan.refusals.some((r) => r.includes('not fixed/closed'))).toBe(true);
  });

  it('REFUSES a duplicate — by exact id and by report id', () => {
    expect(planCatalogStub({ ...closed, slug: 'gifts-no-target' }, ['9852e16f-gifts-no-target']).ok).toBe(false);
    const byReport = planCatalogStub({ ...closed, slug: 'other-slug' }, ['9852e16f-gifts-no-target']);
    expect(byReport.ok).toBe(false);
    expect(byReport.refusals.some((r) => r.includes('already has an entry for report 9852e16f'))).toBe(true);
  });

  it('REFUSES the live catalog\'s existing reports (the four PR #1374 entries are already in)', () => {
    expect(planCatalogStub({ ...closed, slug: 'again' }, RETRO_CATALOG_IDS).ok).toBe(false);
  });
});

describe('bugs:catalog — inserting into the source', () => {
  const sample = `export const RETRO_CATALOG = [\n  {\n    id: 'aa-one',\n  },\n${CATALOG_APPEND_MARKER} ──\n];\n`;

  it('inserts above the marker and the parsed id list sees it', () => {
    const plan = planCatalogStub({ ...closed, slug: 'gifts-no-target' }, catalogIdsInSource(sample));
    const next = insertCatalogStub(sample, plan.entry);
    expect(catalogIdsInSource(next)).toEqual(['aa-one', '9852e16f-gifts-no-target']);
    expect(next.indexOf(plan.entry)).toBeLessThan(next.indexOf(CATALOG_APPEND_MARKER));
  });

  it('throws when the marker is missing (never guesses an insertion point)', () => {
    expect(() => insertCatalogStub('export const X = [];', '  {},')).toThrow(/append marker/);
  });

  it('the live catalog carries the marker and parses to the exported id list', () => {
    const source = readFileSync(join(REPO_ROOT, CATALOG_PATH), 'utf8');
    expect(source).toContain(CATALOG_APPEND_MARKER);
    expect(catalogIdsInSource(source)).toEqual([...RETRO_CATALOG_IDS]);
  });
});
