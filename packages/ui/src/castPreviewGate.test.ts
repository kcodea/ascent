// @vitest-environment jsdom
/**
 * THE SOURCE GATE (owner 2026-09-24, on PR #1671): *"use the values below for the rune triggering one, but let's
 * hide/disable the combat/minion side for now, because it isn't what i want right now."*
 *
 * While `CAST_PREVIEW_SOURCES` says runes only, a rune's cast previews and a minion's (shop / End of Turn) or a
 * combat cast does not. The minion + combat paths stay wired, so re-enabling is one line: the second half of each
 * test flips the gate back on and proves the old behaviour returns.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CastPreviewMemory } from './choreo/channels/castPreview';
import { clearCastPreviews, fireCastPreviewAt, getCastPreviews, showCombatCastPreviews } from './castPreview';
import { CAST_PREVIEW_SOURCES, resetCastPreviewConfig } from './castPreviewConfig';

const SAVED = { ...CAST_PREVIEW_SOURCES };
const rect = { left: 100, top: 300, width: 80, height: 80, right: 180, bottom: 380, x: 100, y: 300, toJSON: () => ({}) } as DOMRect;

function mountSources(): void {
  document.body.innerHTML = `
    <div class="questbadges"><div class="runebadge" data-source-id="rune_gilded_ledger"></div></div>
    <div data-zone="warband"><div class="row"><div class="card" data-uid="b7"></div></div></div>`;
  for (const el of document.querySelectorAll('.runebadge, .card')) (el as HTMLElement).getBoundingClientRect = () => rect;
}

beforeEach(() => { clearCastPreviews(); resetCastPreviewConfig(); mountSources(); });
afterEach(() => { Object.assign(CAST_PREVIEW_SOURCES, SAVED); clearCastPreviews(); document.body.innerHTML = ''; });

describe('the shop / End of Turn feeder (fireCastPreviewAt)', () => {
  it('a RUNE cast previews; a MINION cast does not, while the gate is runes-only', () => {
    expect(CAST_PREVIEW_SOURCES).toEqual({ rune: true, minion: false, combat: false });
    fireCastPreviewAt({ kind: 'minion', uid: 'b7' }, 'lasso');
    expect(getCastPreviews()).toEqual([]);
    fireCastPreviewAt({ kind: 'rune', id: 'rune_gilded_ledger' }, 'mightofaeon');
    expect(getCastPreviews().map((e) => [e.sourceKey, e.spellId, e.context])).toEqual([['rune:rune_gilded_ledger', 'mightofaeon', 'shop']]);
  });
  it('flipping `minion` back on restores the minion preview (one line to re-enable)', () => {
    CAST_PREVIEW_SOURCES.minion = true;
    fireCastPreviewAt({ kind: 'minion', uid: 'b7' }, 'lasso');
    expect(getCastPreviews().map((e) => [e.sourceKey, e.spellId])).toEqual([['b7', 'lasso']]);
  });
});

describe('the combat feeder (showCombatCastPreviews)', () => {
  const rectOf = (uid: string) => (uid === 'm1' ? { cx: 500, cy: 400, w: 115, h: 115 } : null);
  const casts = [{ source: 'm1', spellId: 'growth' }, { source: 'm1', spellId: 'growth' }];

  it('shows nothing while combat previews are off, and burns no once-per-fight memory', () => {
    const mem = new CastPreviewMemory();
    expect(showCombatCastPreviews(casts, rectOf, mem)).toBe(0);
    expect(getCastPreviews()).toEqual([]);
    expect(mem.claim('m1', 'growth'), 'the memory was left untouched').toBe(true);
  });
  it('flipping `combat` back on restores it: one preview per (caster, spell) per fight, above the caster', () => {
    CAST_PREVIEW_SOURCES.combat = true;
    const mem = new CastPreviewMemory();
    expect(showCombatCastPreviews(casts, rectOf, mem)).toBe(1);
    expect(showCombatCastPreviews(casts, rectOf, mem)).toBe(0);
    expect(getCastPreviews().map((e) => [e.sourceKey, e.spellId, e.context, e.anchor.left])).toEqual([['m1', 'growth', 'combat', 500 - 115 / 2]]);
  });
});
