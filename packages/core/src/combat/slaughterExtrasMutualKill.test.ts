import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatResult, type CombatSideState, type QuestCombatMods } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * R-SLAUGHTER-MUTUAL-01 (owner ruling 2026-11-17, asked "should Law of Teeth and similar Slaughter effects fire when
 * the killer also dies?": "yes"). A killer that dies in the same clash (a mutual kill) already fired its OWN Slaughter
 * (owner 2026-07-17); every effect that adds to or repeats a Slaughter now fires too. Each row runs a MUTUAL kill and
 * a NORMAL kill, on the player side AND on the enemy side (role-pinned mirror), and expects the same payout from all
 * four. Before the fix the mutual rows paid nothing extra (Law of Teeth, War Council, Author's Hand, Blood Trail,
 * Feeding Line, Bloodscent all gated on the killer being alive). A board "Slaughters trigger an additional time"
 * multiplier (the `triggerMultiplier` slaughter family; no live card carries it today, so a test card stands in)
 * never had the gate and is the control row.
 *
 * The clash: the killer (7 Attack) swings first (its side is wider) into a 6/6 that hits back for 6. Killer Health 6
 * is a mutual kill; Health 30 is a normal kill.
 */

type Role = 'player' | 'enemy';
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'dwarf'];
const ctx = (questMods: QuestCombatMods = {}): CombatSideState => combatSide({ tier: 6, tribes: ALL_TRIBES, questMods });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const CARDS: Record<string, CardDef> = {
  ...CARD_INDEX,
  test_slaughter_mult: { ...CARD_INDEX.sandbag!, id: 'test_slaughter_mult', triggerMultiplier: { families: ['slaughter'], extra: 1, stacks: true } } as CardDef,
};

/** Fight `board` (holding `mods`) against `foe`, as the player or as the enemy, seed for seed. */
function fight(role: Role, board: BoardMinion[], mods: QuestCombatMods, foe: BoardMinion[]): CombatResult {
  return role === 'player'
    ? simulate(clone(board), clone(foe), makeRng(3), CARDS, ctx(mods), ctx())
    : simulate(clone(foe), clone(board), makeRng(3), CARDS, ctx(), ctx(mods), { firstSide: 'enemy' });
}
const own = (r: CombatResult, role: Role) => r.initial[role];
const killerDied = (r: CombatResult, role: Role): boolean => r.events.some((e) => e.type === 'death' && e.target === own(r, role)[0]!.uid);
const spellPower = (r: CombatResult, role: Role) => (role === 'player' ? r.playerSpellPower : r.enemyCarry?.spellPower);

const ROLES: Role[] = ['player', 'enemy'];
const KILLS = [
  { kind: 'mutual', killerHp: 6 },
  { kind: 'normal', killerHp: 30 },
] as const;
const FOE: BoardMinion[] = [{ cardId: 'stray', attack: 6, health: 6, keywords: ['T'], sourceUid: 'F1' }]; // Taunt: always the target

describe('R-SLAUGHTER-MUTUAL-01: Slaughter extras fire when the killer dies in the same clash', () => {
  // Gnasher (a Beast, "Slaughter: your spells get +1/+1") reads every Slaughter fire straight off spell power.
  const gnashRows: { name: string; mods: QuestCombatMods; blocker?: BoardMinion; fires: number }[] = [
    { name: 'Law of Teeth', mods: { lawOfTeeth: true }, fires: 2 },
    { name: 'War Council (tribe twin, Beast here)', mods: { tribeRallySlaughterExtra: 'beast' }, fires: 2 },
    { name: "Author's Hand", mods: { slaughterFirstEachCombat: 1 }, fires: 2 },
    { name: "Law of Teeth + Author's Hand", mods: { lawOfTeeth: true, slaughterFirstEachCombat: 1 }, fires: 3 },
    { name: 'board Slaughter multiplier (control: never gated)', mods: {}, blocker: { cardId: 'test_slaughter_mult', attack: 0, health: 50, sourceUid: 'U' }, fires: 2 },
  ];
  for (const row of gnashRows) {
    for (const { kind, killerHp } of KILLS) {
      for (const role of ROLES) {
        it(`${row.name}: ${kind} kill, ${role} side fires the Slaughter ${row.fires} times`, () => {
          const board: BoardMinion[] = [
            { cardId: 'gnash', attack: 7, health: killerHp, sourceUid: 'G' },
            row.blocker ?? { cardId: 'sandbag', attack: 0, health: 50, sourceUid: 'S' }, // width: this side swings first
          ];
          const r = fight(role, board, row.mods, FOE);
          expect(killerDied(r, role)).toBe(kind === 'mutual');
          expect(spellPower(r, role)).toEqual({ attack: row.fires, health: row.fires });
        });
      }
    }
  }

  for (const { kind, killerHp } of KILLS) {
    for (const role of ROLES) {
      it(`Blood Trail: ${kind} kill, ${role} side conjures a Beast to hand`, () => {
        const board: BoardMinion[] = [
          { cardId: 'alley', attack: 7, health: killerHp, sourceUid: 'B' }, // left-most: the Blood Trail body
          { cardId: 'sandbag', attack: 0, health: 50, sourceUid: 'S' },
        ];
        const r = fight(role, board, { bloodTrail: true }, FOE);
        expect(killerDied(r, role)).toBe(kind === 'mutual');
        expect(r.events.filter((e) => e.type === 'toHand' && e.side === role).length).toBe(1);
      });

      it(`Feeding Line: ${kind} kill, ${role} side gives the next Beast an immediate attack`, () => {
        const board: BoardMinion[] = [
          { cardId: 'alley', attack: 7, health: killerHp, sourceUid: 'B1' },
          { cardId: 'alley', attack: 3, health: 30, sourceUid: 'B2' }, // the NEXT Beast after the killer's slot
          { cardId: 'sandbag', attack: 0, health: 50, sourceUid: 'S' },
        ];
        const foe: BoardMinion[] = [...FOE, { cardId: 'omen', attack: 1, health: 50, sourceUid: 'F2' }];
        const r = fight(role, board, { feedingLine: true }, foe);
        expect(killerDied(r, role)).toBe(kind === 'mutual');
        const other: Role = role === 'player' ? 'enemy' : 'player';
        const nextUid = own(r, role)[1]!.uid;
        const foeUids = new Set(own(r, other).map((m) => m.uid));
        const firstFoeSwing = r.events.findIndex((e) => e.type === 'attack' && foeUids.has(e.attacker));
        const early = r.events.slice(0, firstFoeSwing === -1 ? r.events.length : firstFoeSwing);
        expect(early.some((e) => e.type === 'attack' && e.attacker === nextUid)).toBe(true); // out of turn
      });

      it(`Bloodscent: ${kind} kill, ${role} side, the killing Beast keeps +4/+4 permanently`, () => {
        const board: BoardMinion[] = [
          { cardId: 'alley', attack: 7, health: killerHp, sourceUid: 'B' },
          { cardId: 'sandbag', attack: 0, health: 50, sourceUid: 'S' },
        ];
        const r = fight(role, board, { runeBloodscent: true }, FOE);
        expect(killerDied(r, role)).toBe(kind === 'mutual');
        const perma = role === 'player' ? r.playerPermaBuffs : r.enemyCarry?.permaBuffs;
        const mine = (perma ?? []).filter((p) => p.sourceUid === 'B');
        expect(mine.reduce((a, p) => a + p.attack, 0)).toBe(4);
        expect(mine.reduce((a, p) => a + p.health, 0)).toBe(4);
      });
    }
  }

  for (const role of ROLES) {
    it(`mid-fight (the foe still has a minion): a mutual kill, ${role} side, still pays Law of Teeth + Author's Hand`, () => {
      const board: BoardMinion[] = [
        { cardId: 'gnash', attack: 7, health: 6, sourceUid: 'G' },
        { cardId: 'sandbag', attack: 0, health: 50, sourceUid: 'S' },
        { cardId: 'sandbag', attack: 0, health: 50, sourceUid: 'S2' },
      ];
      const foe: BoardMinion[] = [...FOE, { cardId: 'omen', attack: 0, health: 50, sourceUid: 'F2' }];
      const r = fight(role, board, { lawOfTeeth: true, slaughterFirstEachCombat: 1 }, foe);
      expect(killerDied(r, role)).toBe(true);
      expect(spellPower(r, role)).toEqual({ attack: 3, health: 3 });
    });
  }

  it('a mutual kill resolves identically on either side (mirror), deterministically', () => {
    const board: BoardMinion[] = [
      { cardId: 'gnash', attack: 7, health: 6, sourceUid: 'G' },
      { cardId: 'alley', attack: 3, health: 30, sourceUid: 'B2' },
      { cardId: 'sandbag', attack: 0, health: 50, sourceUid: 'S' },
    ];
    const mods: QuestCombatMods = { lawOfTeeth: true, slaughterFirstEachCombat: 1, bloodTrail: true, feedingLine: true, runeBloodscent: true };
    const foe: BoardMinion[] = [...FOE, { cardId: 'omen', attack: 1, health: 50, sourceUid: 'F2' }];
    const swap = (s: string): string => s.replace(/"player"/g, '"@@"').replace(/"enemy"/g, '"player"').replace(/"@@"/g, '"enemy"');
    const p = fight('player', board, mods, foe);
    const e = fight('enemy', board, mods, foe);
    expect(swap(JSON.stringify(e.events))).toBe(JSON.stringify(p.events));
    expect(JSON.stringify(fight('player', board, mods, foe).events)).toBe(JSON.stringify(p.events));
  });
});
