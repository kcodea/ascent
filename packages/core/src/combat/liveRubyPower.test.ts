import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * Ruby strength is read LIVE mid-combat (owner rule 2026-08-02).
 *
 * The report: Crownvein Vanguard's Rally buffs your Rubies, but Gemstorm Instigator / Mineral Master / Rune of
 * Attacking Gems minted their in-combat Rubies at the PRE-combat snapshot — `gainRubyBonus` only fed a
 * settle-time carry-back, while `rubyBonusFor` read the static side state. Now the gain accumulates per side
 * and `rubyBonusFor` folds it in on every read, so a Rally that buffs Rubies raises the very next in-combat
 * Ruby play. The player half still carries back via `playerRubyBonusGain`.
 *
 * The fixture uses Rune of Attacking Gems (a Ruby on every friendly attack) because it reads `rubyBonusFor`
 * through the same ctx call Gemstorm's Avenge and Mineral Master's Rally use — one mechanism, one test.
 */
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 900 }];
const gemBuffs = (events: readonly CombatEvent[]) =>
  events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Rune of Attacking Gems');

describe('mid-combat Ruby buffs reach later in-combat Ruby plays', () => {
  it("Crownvein's Rally raises the Ruby minted on the SAME swing — and every one after", () => {
    // Crownvein alone, Attacking Gems armed, base Ruby strength 0. Each swing: Rally (+1/+1 Rubies) fires on
    // onAttack BEFORE the rune plays its Ruby — so swing 1 mints at 1+1 = +2/+2, swing 2 at +3/+3, climbing.
    const r = simulate(
      [{ cardId: 'k_crownvein', attack: 5, health: 60, sourceUid: 'CV' }],
      wall, makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['kobold'], questMods: { runeAttackingGems: 1 } }),
      combatSide({ tier: 1 }),
    );
    const gems = gemBuffs(r.events); // only the player side has the rune here — every gem buff is ours
    expect(gems.length, 'the rune never played a Ruby').toBeGreaterThanOrEqual(2);
    expect([gems[0]!.attack, gems[0]!.health], 'swing 1 must mint at the JUST-buffed value').toEqual([2, 2]);
    expect([gems[1]!.attack, gems[1]!.health], 'swing 2 must keep climbing').toEqual([3, 3]);
    // The carry-back still reports the total the run should bank.
    expect(r.playerRubyBonusGain?.attack ?? 0).toBe(gems.length);
  });

  it('the base snapshot still folds in: base 2 + the live gain', () => {
    const r = simulate(
      [{ cardId: 'k_crownvein', attack: 5, health: 60 }],
      wall, makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['kobold'], questMods: { runeAttackingGems: 1 }, rubyBonus: { attack: 2, health: 2 } }),
      combatSide({ tier: 1 }),
    );
    const gems = gemBuffs(r.events);
    expect([gems[0]!.attack, gems[0]!.health], 'base 2 + live 1 + the printed 1').toEqual([4, 4]);
  });

  it("an ENEMY Crownvein grows the enemy's own Rubies too — but never carries back", () => {
    const r = simulate(
      wall.map((m) => ({ ...m, attack: 0, health: 900 })),
      [{ cardId: 'k_crownvein', attack: 5, health: 60 }],
      makeRng(3), CARD_INDEX,
      combatSide({ tier: 1 }),
      combatSide({ tier: 6, tribes: ['kobold'], questMods: { runeAttackingGems: 1 } }),
    );
    const gems = gemBuffs(r.events);
    expect(gems.length, "the enemy's rune never played a Ruby").toBeGreaterThanOrEqual(2);
    expect([gems[0]!.attack, gems[0]!.health], "the enemy's own Rally must feed its own Rubies").toEqual([2, 2]);
    expect(r.playerRubyBonusGain, 'an enemy gain must never reach the PLAYER carry-back').toBeUndefined();
  });
});
