/**
 * R-RUNE-NAME-01 — rune names are bare (owner ruling 2026-10-22: "let's remove 'rune of' for all the runes, so
 * they just show the rune name, like Borrowed Time. etc").
 *
 * Pins three things: no rune's display name starts with "Rune of"; a buff label stored before the rename still
 * counts as a rune buff and displays bare; and a bare rune label counts as a rune buff, so the `rune-buff-unit`
 * FX (which used to key on the prefix) still fires.
 */
import { describe, expect, it } from 'vitest';
import { ARCHIVED_RUNES, EPIC_RUNES, RUNES, RUNE_INDEX, bareRuneLabel } from '@game/content';
import { isRuneBuffSource } from './state';

const ALL = [...RUNES, ...EPIC_RUNES, ...ARCHIVED_RUNES];

describe('R-RUNE-NAME-01: rune names are bare', () => {
  it('no rune display name starts with "Rune of"', () => {
    const prefixed = ALL.filter((r) => /^rune of\b/i.test(r.name.trim())).map((r) => `${r.id}: ${r.name}`);
    expect(prefixed).toEqual([]);
  });

  it('the owner\'s examples read bare', () => {
    expect(RUNE_INDEX.rune_borrowed_flame?.name).toBe('Borrowed Flame');
    expect(RUNE_INDEX.rune_war_council?.name).toBe('War Council');
    expect(RUNE_INDEX.rune_anvil?.name).toBe('Anvil');
    expect(RUNE_INDEX.rune_unity?.name).toBe('Unity');
  });

  it('a pre-rename buff label displays bare and still counts as a rune buff', () => {
    expect(bareRuneLabel('Rune of the Anvil')).toBe('Anvil');
    expect(bareRuneLabel('Rune of Unity')).toBe('Unity');
    expect(bareRuneLabel('Staff of Guel')).toBe('Staff of Guel');
    expect(isRuneBuffSource('Rune of the Anvil')).toBe(true);
  });

  it('every bare rune name counts as a rune buff source', () => {
    const missed = ALL.filter((r) => !isRuneBuffSource(r.name)).map((r) => r.id);
    expect(missed).toEqual([]);
    expect(isRuneBuffSource('Staff of Guel')).toBe(false);
  });
});
