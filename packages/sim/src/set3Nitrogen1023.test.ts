import { describe, expect, it } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '@game/core';

/**
 * NITROGEN (owner 2026-10-23, verbatim): "Nitrogen T5 6/6 When a Dragon attacks, Cast Growth. * gilded casts twice."
 *
 * Warflame's trigger (`onTribeAttackCastNamedSpell`) aimed at Growth: every FRIENDLY Dragon swing (Nitrogen's own
 * included) casts the real Shop spell Growth through `castNamedSpellInCombat`, a genuine spell cast announced from
 * Nitrogen. Non-Dragon swings do nothing. Gilded: two casts per Dragon swing. Both combat sides behave the same.
 */
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra } as unknown as BoardMinion);

const wall = (): BoardMinion[] => [bm('sandbag', 'W', 0, 900000)];

function run(player: BoardMinion[], enemy: BoardMinion[], seed = 7): CombatResult {
  return simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
}

/** uid of the minion stamped `sourceUid` on the given side (from the result's initial snapshot). */
function uidOf(r: CombatResult, side: 'player' | 'enemy', sourceUid: string, board: BoardMinion[]): string {
  const i = board.findIndex((m) => (m as { sourceUid?: string }).sourceUid === sourceUid);
  return r.initial[side][i]!.uid;
}

const growthCastsBy = (events: CombatEvent[], uid: string) =>
  events.filter((e) => e.type === 'sc' && e.source === uid && e.spellId === 'growth').length;
const attacksBy = (events: CombatEvent[], uids: string[]) =>
  events.filter((e) => e.type === 'attack' && uids.includes(e.attacker)).length;

describe('Nitrogen (d3_nitrogen): when a Dragon attacks, cast Growth', () => {
  it('is a Set 3 T5 6/6 Dragon in the buyable pool, with owner text', () => {
    const d = CARD_INDEX['d3_nitrogen']!;
    expect(d).toMatchObject({ name: 'Nitrogen', tribe: 'dragon', tier: 5, attack: 6, health: 6 });
    expect(d.text).toBe('When a **Dragon** attacks, cast **Growth**.');
    expect(d.goldenText).toBe('When a **Dragon** attacks, cast **Growth** twice.');
    expect(poolFor('set3').buyable.some((c) => c.id === 'd3_nitrogen')).toBe(true);
  });

  for (const side of ['player', 'enemy'] as const) {
    for (const golden of [false, true]) {
      it(`${side} side, golden=${golden}: one Growth per friendly Dragon swing (x2 gilded), none for non-Dragons`, () => {
        // A Dragon attacker, a non-Dragon attacker, and Nitrogen itself (a Dragon: its own swings count).
        const board = [bm('d3_drakepup', 'DR', 3, 90000), bm('sandbag', 'ND', 3, 90000), bm('d3_nitrogen', 'NI', 1, 90000, { golden })];
        const r = side === 'player' ? run(board, wall()) : run(wall(), board);
        const ni = uidOf(r, side, 'NI', board);
        const dr = uidOf(r, side, 'DR', board);
        const nd = uidOf(r, side, 'ND', board);
        const dragonSwings = attacksBy(r.events, [dr, ni]);
        expect(dragonSwings).toBeGreaterThan(0);
        expect(attacksBy(r.events, [nd]), 'the non-Dragon attacked too').toBeGreaterThan(0);
        expect(growthCastsBy(r.events, ni)).toBe(dragonSwings * (golden ? 2 : 1));
        // The casts are genuine spell casts (the player's tally rides home through settle).
        if (side === 'player') expect(r.playerSpellsCast ?? 0).toBe(dragonSwings * (golden ? 2 : 1));
      });
    }
  }

  it('no Dragon swings, no Growth: an all-non-Dragon attacker board with a 0-Attack Nitrogen never casts', () => {
    const board = [bm('sandbag', 'ND', 3, 90000), bm('d3_nitrogen', 'NI', 0, 90000)];
    const r = run(board, [bm('sandbag', 'W', 0, 900000, { keywords: ['T'] } as Partial<BoardMinion>)]);
    const ni = uidOf(r, 'player', 'NI', board);
    expect(attacksBy(r.events, [ni])).toBe(0);
    expect(growthCastsBy(r.events, ni)).toBe(0);
  });

  it('Growth buffs every friendly minion in combat (combat-only stats; the enemy is untouched)', () => {
    const board = [bm('d3_drakepup', 'DR', 3, 90000), bm('sandbag', 'ND', 0, 90000), bm('d3_nitrogen', 'NI', 0, 90000)];
    const r = run(board, wall());
    const nd = uidOf(r, 'player', 'ND', board);
    const growthBuff = (e: CombatEvent, t: string) => e.type === 'buff' && e.target === t && e.spellId === 'growth';
    const buffs = r.events.filter((e) => growthBuff(e, nd));
    expect(buffs.length).toBeGreaterThan(0);
    const w = r.initial.enemy[0]!.uid;
    expect(r.events.filter((e) => growthBuff(e, w))).toEqual([]);
  });

  it('is deterministic', () => {
    const board = [bm('d3_drakepup', 'DR', 3, 30), bm('d3_nitrogen', 'NI', 6, 6, { golden: true })];
    const foe = [bm('d3_nitrogen', 'EN', 6, 6), bm('d3_drakepup', 'ED', 3, 3)];
    expect(JSON.stringify(run(board, foe, 42).events)).toBe(JSON.stringify(run(board, foe, 42).events));
  });
});
