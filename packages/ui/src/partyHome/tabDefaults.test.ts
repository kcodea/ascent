/**
 * R-PH-TAB-DEFAULT-01 (owner 2026-11-08): arriving at a page opens its leftmost tab, never the last one picked. Play
 * opens on Ranked, the Leaderboard on Solo (the host stays mounted, so it resets when it closes). Settings, Patch Notes,
 * the Compendium and Career are pinned by their own render tests (phInfoPages.test.tsx, Career.test.tsx).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('pages open on their leftmost tab', () => {
  it('Play starts on Ranked, not the remembered mode', () => {
    const ph = src('./PartyHome.tsx');
    expect(ph).toContain("useState<PartyModeId>('ranked')");
    expect(ph).not.toMatch(/readPartyMode\(\)/);
  });
  it('the Leaderboard resets to Solo whenever it closes', () => {
    expect(src('../Rankings.tsx')).toMatch(/useEffect\(\(\) => \{ if \(!show\) setBoard\('solo'\); \}, \[show\]\)/);
  });
  it('Recent Games resets to Ranked whenever it closes', () => {
    expect(src('../RecentGames.tsx')).toMatch(/if \(!show\) \{ setTab\('ranked'\)/);
  });
  it('the Compendium no longer reads a remembered view', () => {
    expect(src('../MinionBook.tsx')).not.toContain('ascent.compendium.view');
  });
});
