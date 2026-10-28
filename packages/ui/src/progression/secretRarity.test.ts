import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUSHIE_PLATE_ID } from '@game/progression';
import { albumOf, collectibleItems, countOf, rarityCounts } from './collectionModel';

/**
 * THE SECRET RARITY IN THE COLLECTION (owner 2026-10-27: "wont it have its own category as \"Secret\"? we can make it Red,
 * over Ancient. Should ONLY show up once you unlock it"). An unowned Secret item is invisible: not in its album, not in a
 * count, not in the "N / M collected" total. Once owned it leads the album (rarest first) under its own red Secret chip.
 */
describe('a Secret item in the Collection', () => {
  it('is invisible until owned: not in the album, the tab count or the collected total', () => {
    const none = new Set<string>();
    expect(albumOf('card_plate', undefined, none).map((c) => c.id)).not.toContain(PLUSHIE_PLATE_ID);
    expect(albumOf('card_plate').map((c) => c.id)).not.toContain(PLUSHIE_PLATE_ID); // no ownership known: hidden
    expect(collectibleItems(undefined, none).map((c) => c.id)).not.toContain(PLUSHIE_PLATE_ID);
    expect(rarityCounts(albumOf('card_plate', undefined, none), none).secret).toEqual({ owned: 0, total: 0 });
  });

  it('once owned it leads the album, counts as owned, and has its own Secret rarity row', () => {
    const owned = new Set([PLUSHIE_PLATE_ID]);
    const album = albumOf('card_plate', undefined, owned);
    expect(album[0]!.id).toBe(PLUSHIE_PLATE_ID);
    const hidden = albumOf('card_plate', undefined, new Set());
    expect(album).toHaveLength(hidden.length + 1);
    expect(countOf(album, owned)).toEqual({ owned: 1, total: hidden.length + 1 });
    expect(rarityCounts(album, owned).secret).toEqual({ owned: 1, total: 1 });
  });

  it('is red (the shared rarity tokens), with a static breathing glow in the Collection', () => {
    const styles = readFileSync(join(__dirname, '../styles.css'), 'utf8');
    expect(styles).toMatch(/\.r-secret \{ --rc: #ff4a4a;/);
    const coll = readFileSync(join(__dirname, 'collection.css'), 'utf8');
    expect(coll).toContain('.colls-tile.owned.r-secret::before');
    expect(coll).toContain('.r-secret .colls-gem, .colls-gem.r-secret');
  });
});
