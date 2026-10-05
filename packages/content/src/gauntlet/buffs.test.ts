import { describe, expect, it } from 'vitest';
import {
  GAUNTLET_BUFF_FIELDS, GAUNTLET_BUFF_GROUPS, buffOverridesEqual, buffSourceRound, effectiveBuffs, emptyBuffs, nonZeroBuffs,
  validateStage, withBuffOverride, type GauntletStage,
} from './index';
import { cardRevision } from '../revisions';
import { CARD_INDEX } from '../index';

const someCard = Object.values(CARD_INDEX).find((c) => !c.spell && c.tier === 1)!;
const stage = (): GauntletStage => ({
  number: 1, name: 'Test', opponentName: 'Tester', status: 'ready', runes: {},
  rounds: Array.from({ length: 10 }, () => ({ board: [{ cardId: someCard.id, attack: 2, health: 3, cardVersion: cardRevision(someCard) }] })),
});

describe('gauntlet run buffs: the catalogue', () => {
  it('lists every buff once, each in a known group, pairs and numbers matching emptyBuffs', () => {
    const keys = GAUNTLET_BUFF_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    const empty = emptyBuffs() as unknown as Record<string, unknown>;
    expect(Object.keys(empty).sort()).toEqual([...keys].sort());
    for (const f of GAUNTLET_BUFF_FIELDS) {
      expect(GAUNTLET_BUFF_GROUPS).toContain(f.group);
      expect(empty[f.key]).toEqual(f.kind === 'pair' ? { attack: 0, health: 0 } : 0);
    }
  });

  it('excludes the complex (non-number) snapshot channels', () => {
    const keys = new Set<string>(GAUNTLET_BUFF_FIELDS.map((f) => f.key));
    for (const k of ['cardBuffs', 'handSpellIds', 'lastSpellCastId', 'rememberedSpellIds', 'lastSpellThisTurnId', 'tribesPlayed', 'handMinions', 'questMods']) {
      expect(keys.has(k), k).toBe(false);
    }
  });
});

describe('gauntlet run buffs: carry-forward', () => {
  it('a value set on round 4 holds from round 4 on until a later round changes it', () => {
    const s = stage();
    s.rounds[3]!.buffs = { rubyBonus: { attack: 2, health: 2 }, spellsCast: 3 };
    s.rounds[6]!.buffs = { rubyBonus: { attack: 5, health: 4 } };
    expect(effectiveBuffs(s, 3).rubyBonus).toEqual({ attack: 0, health: 0 });
    expect(effectiveBuffs(s, 4).rubyBonus).toEqual({ attack: 2, health: 2 });
    expect(effectiveBuffs(s, 6).rubyBonus).toEqual({ attack: 2, health: 2 });
    expect(effectiveBuffs(s, 7).rubyBonus).toEqual({ attack: 5, health: 4 });
    expect(effectiveBuffs(s, 10)).toMatchObject({ rubyBonus: { attack: 5, health: 4 }, spellsCast: 3 });
    expect(buffSourceRound(s, 6, 'rubyBonus')).toBe(4);
    expect(buffSourceRound(s, 7, 'rubyBonus')).toBe(7);
    expect(buffSourceRound(s, 3, 'rubyBonus')).toBeNull();
  });

  it('an explicit 0 override resets an inherited value', () => {
    const s = stage();
    s.rounds[1]!.buffs = { deathrattles: 4 };
    s.rounds[4]!.buffs = { deathrattles: 0 };
    expect(effectiveBuffs(s, 4).deathrattles).toBe(4);
    expect(effectiveBuffs(s, 5).deathrattles).toBe(0);
  });

  it('the fold never aliases the stage data', () => {
    const s = stage();
    s.rounds[0]!.buffs = { impAura: { attack: 1, health: 1 } };
    effectiveBuffs(s, 3).impAura.attack = 99;
    expect(s.rounds[0]!.buffs.impAura).toEqual({ attack: 1, health: 1 });
  });

  it('nonZeroBuffs keeps only what is in force', () => {
    const s = stage();
    s.rounds[0]!.buffs = { rubyBonus: { attack: 0, health: 1 }, spellsCast: 0, conductorBuff: 2 };
    expect(nonZeroBuffs(effectiveBuffs(s, 1))).toEqual({ rubyBonus: { attack: 0, health: 1 }, conductorBuff: 2 });
  });

  it('withBuffOverride sets and clears, dropping an emptied buffs key', () => {
    const r = stage().rounds[0]!;
    const set = withBuffOverride(r, 'rubyBonus', { attack: 3, health: 3 });
    expect(set.buffs).toEqual({ rubyBonus: { attack: 3, health: 3 } });
    expect(r.buffs).toBeUndefined(); // pure
    const cleared = withBuffOverride(set, 'rubyBonus', undefined);
    expect('buffs' in cleared).toBe(false);
    expect(buffOverridesEqual(set.buffs, { rubyBonus: { attack: 3, health: 3 } })).toBe(true);
    expect(buffOverridesEqual(set.buffs, { rubyBonus: { attack: 3, health: 2 } })).toBe(false);
    expect(buffOverridesEqual(undefined, {})).toBe(true);
  });
});

describe('gauntlet run buffs: validation', () => {
  it('accepts known buffs as whole numbers ≥ 0', () => {
    const s = stage();
    s.rounds[3]!.buffs = { rubyBonus: { attack: 2, health: 2 }, spellsCast: 0, conductorBuff: 7 };
    expect(validateStage(s)).toEqual([]);
  });

  it('rejects an unknown key, a negative, a fraction and a malformed pair, naming the round', () => {
    const cases: unknown[] = [
      { notABuff: 1 },
      { spellsCast: -1 },
      { deathrattles: 1.5 },
      { rubyBonus: { attack: 2 } },
      { rubyBonus: 3 },
      { spellsCast: { attack: 1, health: 1 } },
    ];
    for (const buffs of cases) {
      const s = stage();
      (s.rounds[3] as { buffs?: unknown }).buffs = buffs;
      const issues = validateStage(s);
      expect(issues.length, JSON.stringify(buffs)).toBeGreaterThan(0);
      expect(issues.join(), JSON.stringify(buffs)).toMatch(/rounds\.3\.buffs/);
    }
  });
});
