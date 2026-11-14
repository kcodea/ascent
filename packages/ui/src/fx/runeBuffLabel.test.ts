import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EPIC_RUNES, RUNES } from '@game/content';
import { isRuneBuffSource } from '@game/sim';
import { buffTotalsByLabel, runeIdForBuffLabel, runesThatBuffed } from './runeBuffLabel';

describe('runeIdForBuffLabel: a combat rune buff resolves to the rune whose node the trail leaves', () => {
  it('every live rune resolves from its own display name, which the sim also reads as a rune buff', () => {
    for (const r of [...RUNES, ...EPIC_RUNES]) {
      expect(isRuneBuffSource(r.name), r.name).toBe(true);
      expect(runeIdForBuffLabel(r.name), r.name).not.toBeNull();
    }
  });

  it('a pre-2026-10-22 "Rune of ..." label still resolves to the same rune', () => {
    const r = RUNES[0]!;
    expect(runeIdForBuffLabel(`Rune of ${r.name}`)).toBe(runeIdForBuffLabel(r.name));
  });

  it('a generic label that names no rune has no node to leave', () => {
    expect(runeIdForBuffLabel('Rune')).toBeNull();
    expect(runeIdForBuffLabel('Warhorn Captain')).toBeNull();
  });

  it('the combat replay draws the trail from the PLAYER rune node, beside the sparkle', () => {
    const replay = readFileSync(fileURLToPath(new URL('../useCombatReplay.ts', import.meta.url)), 'utf8');
    const at = replay.indexOf("playDef('rune-buff-unit'");
    const block = replay.slice(at, at + 900);
    expect(block).toContain("unitSides.get(e.target) === 'player'");
    expect(block).toContain('runeNodeCentre(runeIdForBuffLabel(e.source))');
    expect(block).toContain('playRuneBuffTrail(node,');
  });
});

describe('runesThatBuffed: a Shop action names the rune whose buff row grew (R-RUNE-TRAIL-01)', () => {
  const row = (source: string, n: number) => ({ source, attack: n, health: n });

  it('Seasoned Ledger buffing a minion that already carries other buffs names only Seasoned Ledger', () => {
    const before = { buffs: [row('Kindling', 3), row('Warhorn Captain', 2)] };
    const after = { buffs: [row('Kindling', 3), row('Warhorn Captain', 2), row('Seasoned Ledger', 1)] };
    expect(runesThatBuffed(buffTotalsByLabel(before), after)).toEqual(['rune_seasoned_ledger']);
  });

  it('a row that grew counts; a row that did not, and a non-rune row that grew, do not', () => {
    const before = { buffs: [row('Kindling', 3), row('Seasoned Ledger', 1), row('Warhorn Captain', 2)] };
    const after = { buffs: [row('Kindling', 6), row('Seasoned Ledger', 1), row('Warhorn Captain', 9)] };
    expect(runesThatBuffed(buffTotalsByLabel(before), after)).toEqual(['rune_kindling']);
  });

  it('a card that was not there before counts every rune row it carries', () => {
    expect(runesThatBuffed(undefined, { buffs: [row('Seasoned Ledger', 1)] })).toEqual(['rune_seasoned_ledger']);
  });

  it('the Shop action effect draws the trail from that rune, reading the ledger from before the action', () => {
    const recruit = readFileSync(fileURLToPath(new URL('../Recruit.tsx', import.meta.url)), 'utf8');
    const at = recruit.indexOf('const uids = run.runeBuffFxUnits;');
    const block = recruit.slice(at, at + 2600);
    expect(block).toContain('runesThatBuffed(runeLedgerRef.current.get(card.uid), card)');
    expect(block).toContain('playRuneBuffTrail(node, at,');
    // The ledger is replaced AFTER the trail effect has read it.
    expect(block.indexOf('runeLedgerRef.current = m')).toBeGreaterThan(block.indexOf('playRuneBuffTrail(node, at,'));
  });
});
