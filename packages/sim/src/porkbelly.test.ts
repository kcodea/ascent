import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';

/**
 * PORKBELLY (set 3, T7) — the vanguard swing, straight from the owner spec (2026-08-31):
 *
 *   "When Porkbelly attacks, if there is space to summon a minion, then he summons a Gemheart Golem that
 *    gains his Ruby bonuses (or double if gilded) and the Gemheart Golem then attacks Porkbelly's target
 *    first. If the target dies, Porkbelly settles and does not attack or take any dmg etc. If the target does
 *    not die, Porkbelly will then complete his attack. If the Gemheart Golem does not die, it will remain on
 *    board (to the right of Porkbelly) and will be the next in line minion to attack."
 *
 * Every clause is a test below. The settle clause is the one worth the most: it is the difference between a
 * 6-Health capstone that survives and one that trades itself away on the first swing.
 */
const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [] });

const fight = (player: BoardMinion[], enemy: BoardMinion[]) => simulate(
  player, enemy, makeRng(11), CARD_INDEX,
  combatSide({ tier: 7, tribes: ['kobold'] }), combatSide({ tier: 1 }),
);

type Ev = { type: string; attacker?: string; defender?: string; target?: string; cardId?: string; amount?: number; step?: number };

describe('Porkbelly', () => {
  it('summons a Gemheart Golem that swings BEFORE him, at his own target', () => {
    const r = fight([bm('k3_porkbelly', 'PB', 13, 6)], [bm('sandbag', 'E', 1, 400)]);
    const evs = r.events as readonly Ev[];
    // The ENEMY may hold the opening turn, so anchor on Porkbelly's own exchange rather than the log head.
    const summon = evs.findIndex((e) => e.type === 'summon');
    const friendlyAttack = evs.findIndex((e) => e.type === 'attack' && e.attacker !== 'm1');
    expect(summon, 'a golem arrived').toBeGreaterThanOrEqual(0);
    expect(summon, 'it arrived before this side swung at all').toBeLessThan(friendlyAttack);
    expect(evs[friendlyAttack]!.attacker, 'the golem takes that swing, not Porkbelly').not.toBe('m0');
  });

  /** Porkbelly carrying 9/9 of Rubies, plus fodder so this side holds the opening turn. */
  const rubyFed = (): BoardMinion[] => [
    { ...bm('k3_porkbelly', 'PB', 13, 6), buffs: [{ source: 'Ruby', attack: 9, health: 9, count: 9 }] },
    bm('sandbag', 'F1', 1, 50), bm('sandbag', 'F2', 1, 50),
  ];
  /** A 10-Health TAUNT (forces the swing onto it) in front of a 20-Attack body that would maul Porkbelly. */
  const tauntWall = (): BoardMinion[] => [
    { ...bm('sandbag', 'TAUNT', 1, 10), keywords: ['T'] }, bm('sandbag', 'BIG', 20, 400),
  ];

  it('the vanguard inherits his Rubies, and lands to his RIGHT', () => {
    const r = fight(rubyFed(), tauntWall());
    const summon = (r.events as readonly Ev[]).find((e) => e.type === 'summon') as
      { minion: { attack: number; health: number; cardId: string }; index: number } | undefined;
    expect(summon, 'a golem arrived').toBeTruthy();
    expect(summon!.minion.cardId).toBe('gemheart-shard');
    expect([summon!.minion.attack, summon!.minion.health], '1/1 plus his 9/9 of Rubies').toEqual([10, 10]);
    expect(summon!.index, 'slot 1 — immediately right of Porkbelly, so it attacks next').toBe(1);
  });

  it('SETTLES when the vanguard fells the target — no swing, no retaliation', () => {
    // The clause needs a fight that CONTINUES after the kill, or "he did not attack" is true for the trivial
    // reason that nothing was left to attack. So the 10/10 vanguard clears a 10-Health taunt while a
    // 20-Attack body waits behind it: without the settle, Porkbelly rolls on and eats 20 to a 6-Health face.
    //
    // Scoped by LOG WINDOW, from the vanguard's swing to the enemy's next one. Porkbelly is free to attack on
    // a later turn — settling ends this exchange, not his combat. (Step ids are not the scope: the vanguard's
    // own exchange advances them.)
    const r = fight(rubyFed(), tauntWall());
    const evs = r.events as readonly Ev[];
    const from = evs.findIndex((e) => e.type === 'attack' && e.attacker === 'm5');
    expect(from, 'the vanguard swung in his place').toBeGreaterThanOrEqual(0);
    const after = evs.findIndex((e, i) => i > from && e.type === 'attack' && (e.attacker === 'm3' || e.attacker === 'm4'));
    const window = evs.slice(from + 1, after < 0 ? evs.length : after);
    expect(window.some((e) => e.type === 'attack' && e.attacker === 'm0'),
      'Porkbelly did not follow up in the exchange the vanguard settled').toBe(false);
    expect(window.some((e) => e.type === 'dmg' && e.target === 'm0'), 'and took no retaliation in it').toBe(false);
  });

  it('completes his own attack when the vanguard fails to kill', () => {
    const r = fight([bm('k3_porkbelly', 'PB', 13, 6)], [bm('sandbag', 'E', 1, 400)]);
    const attacks = (r.events as readonly Ev[]).filter((e) => e.type === 'attack');
    expect(attacks.some((a) => a.attacker === 'm0'), 'Porkbelly followed up').toBe(true);
  });

  it('a FULL board summons nothing and he simply attacks', () => {
    const board: BoardMinion[] = [bm('k3_porkbelly', 'PB', 13, 6)];
    for (let i = 0; i < 6; i++) board.push(bm('sandbag', `S${i}`, 1, 20));
    const r = fight(board, [bm('sandbag', 'E', 1, 400)]);
    // Scoped to the OPENING swing on purpose: later in the fight a friendly body dies, room opens, and the
    // vanguard is then supposed to appear. "No room" is a per-swing condition, not a per-fight one.
    const evs = r.events as readonly Ev[];
    const firstOwn = evs.findIndex((e) => e.type === 'attack' && e.attacker !== 'm7');
    expect(evs.slice(0, firstOwn).some((e) => e.type === 'summon'), 'no room, no vanguard').toBe(false);
    expect(evs[firstOwn]!.attacker, 'so Porkbelly swings himself').toBe('m0');
  });

  it('terminates: the vanguard does not summon a vanguard of its own', () => {
    // The golem takes a REAL attack through `performAttack`, which is where the recursion lives. It is not a
    // Porkbelly, so it never re-enters — and the depth guard is the backstop if a future token ever is.
    const r = fight([bm('k3_porkbelly', 'PB', 13, 6)], [bm('sandbag', 'E', 1, 400)]);
    expect(r.events.length, 'a bounded fight').toBeLessThan(5000);
  });


  it('a RISE does not un-settle him — the vanguard still killed his target', () => {
    // Owner ruling 2026-09-01, correcting my earlier reading of this case: Porkbelly must NOT attack the
    // risen body. The vanguard killed the thing he was going to hit; that the enemy came back is the enemy's
    // business, and the settle is about the kill having happened.
    //
    // A liveness check alone CANNOT see this: the Rise resolves inside the vanguard's own exchange, so by the
    // time the settle is decided the target is alive again at 1 Health. The tell is the spent `rebornAvailable`
    // — a body that had a Rise before the swing and not after died during it.
    const r = fight(
      rubyFed(),
      [{ ...bm('sandbag', 'TAUNT', 1, 10), keywords: ['T', 'R'] }, bm('sandbag', 'BIG', 20, 400)],
    );
    const evs = r.events as readonly Ev[];
    const reborn = evs.findIndex((e) => e.type === 'reborn');
    expect(reborn, 'the taunt rose').toBeGreaterThanOrEqual(0);
    // Porkbelly's own next swing must not be at the risen body in that same exchange. Scoped by log window to
    // the enemy's next attack, exactly as the plain settle case is — he may of course swing on a later turn.
    const after = evs.findIndex((e, i) => i > reborn && e.type === 'attack' && (e.attacker === 'm3' || e.attacker === 'm4'));
    const window = evs.slice(reborn + 1, after < 0 ? evs.length : after);
    expect(window.some((e) => e.type === 'attack' && e.attacker === 'm0'),
      'Porkbelly settled — the vanguard had already killed that target').toBe(false);
  });
});
