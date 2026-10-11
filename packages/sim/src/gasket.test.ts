import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { fireRallies } from './recruit';
import type { BoardCard, RunState } from './index';

/**
 * GASKET (Set 2 Demon, owner add 2026-10-10): T4 7/3, "Rally: deal 2 damage to all minions except friendly Demons."
 * Gilded: "deals 2 damage twice", two separate passes. The spray is Fel Spikes' (`sprayDamageExceptFriendlyTribe`),
 * fired from the Rally trigger instead of the Echo one.
 *
 * Every fixture body is INERT: 0 Attack (never retaliates, never kills), and the neutral is a Training Dummy with its
 * Taunt + Ward stripped, the Demon a Cinder Clerk (a recruit-only Shout). Player uids run m0, m1, … in board order,
 * the enemy continues the counter. The player fields more bodies, so it swings first and Gasket (left-most) leads.
 */
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });
const gasket = (golden = false): BoardMinion => bm('dm_gasket', 7, 3, { keywords: ['RL'], golden });
const demon = (hp = 40): BoardMinion => bm('dm_clerk', 0, hp);
const neutral = (hp = 40, extra: Partial<BoardMinion> = {}): BoardMinion => bm('trainingdummy', 0, hp, extra);

const fight = (player: BoardMinion[], enemy: BoardMinion[], seed = 7) =>
  simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));

/** The events of Gasket's FIRST swing's wind-up: from its `attack` to the clash (the first non-wave dmg). */
function firstWindup(events: CombatEvent[], uid = 'm0'): CombatEvent[] {
  const at = events.findIndex((e) => e.type === 'attack' && e.attacker === uid);
  expect(at, 'Gasket swung').toBeGreaterThanOrEqual(0);
  const out: CombatEvent[] = [];
  for (let i = at + 1; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'attack') break;
    if (e.type === 'dmg' && e.wave === undefined) break; // the clash itself
    out.push(e);
  }
  return out;
}
const sprayHits = (evs: CombatEvent[], uid = 'm0') =>
  evs.filter((e): e is Extract<CombatEvent, { type: 'dmg' }> => e.type === 'dmg' && e.source === uid && e.wave !== undefined);
const waves = (evs: CombatEvent[]) => [...new Set(sprayHits(evs).map((e) => e.wave))];

describe('Gasket: Rally, deal 2 damage to all minions except friendly Demons', () => {
  it('the card: T4 7/3 Demon with Rally, appended at the very end of set 2', async () => {
    const d = CARD_INDEX['dm_gasket']!;
    expect(d).toMatchObject({ tier: 4, attack: 7, health: 3, tribe: 'demon' });
    expect(d.keywords).toContain('RL');
    const { SETS } = await import('@game/content');
    const own = SETS.set2.own.map((c) => c.id);
    expect(own.indexOf('dm_gasket')).toBe(own.indexOf('dm_ruinouslord') + 1); // after every earlier add, Ruinous Lord last
  });

  it('hits every enemy (enemy Demons too) and friendly non-Demons; spares friendly Demons and itself', () => {
    // player: m0 Gasket, m1 friendly Demon, m2 friendly neutral · enemy: m3 enemy Demon, m4 enemy neutral
    const r = fight([gasket(), demon(), neutral()], [demon(), neutral()]);
    const hits = sprayHits(firstWindup(r.events));
    expect(hits.map((h) => h.target).sort()).toEqual(['m2', 'm3', 'm4']);
    expect(hits.every((h) => h.amount === 2), 'each hit is 2').toBe(true);
    expect(waves(firstWindup(r.events)), 'one pass = one wave').toHaveLength(1);
  });

  it('Gilded deals 2 damage TWICE: two separate passes, each its own wave over the same victims', () => {
    const r = fight([gasket(true), demon(), neutral()], [demon(), neutral()]);
    const w = firstWindup(r.events);
    const ws = waves(w);
    expect(ws, 'two passes').toHaveLength(2);
    for (const id of ws) {
      expect(sprayHits(w).filter((h) => h.wave === id).map((h) => h.target).sort()).toEqual(['m2', 'm3', 'm4']);
    }
    expect(sprayHits(w).every((h) => h.amount === 2), 'twice 2, not once 4').toBe(true);
  });

  it('deaths resolve after the spray: a 3-Health body takes both Gilded passes and dies once, after the last', () => {
    // player m0..m3 (four bodies, so the player swings first) · enemy m4 Demon, m5 3-Health, m6 2-Health
    const r = fight([gasket(true), demon(), neutral(), demon()], [demon(), neutral(3), neutral(2)]);
    const w = firstWindup(r.events);
    const [w1, w2] = waves(w);
    const toM5 = sprayHits(w).filter((h) => h.target === 'm5'); // the 3-Health enemy
    expect(toM5.map((h) => h.wave), 'hit on both passes').toEqual([w1, w2]);
    // The 2-Health body drops to 0 on pass 1 and stops taking hits (no overkill), then dies with the rest.
    expect(sprayHits(w).filter((h) => h.target === 'm6').map((h) => h.wave), 'stops at 0').toEqual([w1]);
    const lastHit = w.lastIndexOf(sprayHits(w).at(-1)!);
    const deaths = w.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'death');
    expect(deaths.map(({ e }) => (e as { target: string }).target).sort()).toEqual(['m5', 'm6']);
    expect(w.filter((e) => e.type === 'death' && e.target === 'm5'), 'dies once').toHaveLength(1);
    expect(deaths.every(({ i }) => i > lastHit), 'every death after the final pass').toBe(true);
    expect(deaths.every(({ e }) => e.wave === w2), 'deaths ride the final wave').toBe(true);
  });

  it('a target killed by the spray is not swung at: no clash, no retaliation', () => {
    // A lone 0/2 enemy (plus a 40-Health spare so the fight does not end on the spray).
    const r = fight([gasket(), demon(), neutral()], [neutral(2), neutral()], 3);
    const at = r.events.findIndex((e) => e.type === 'attack' && e.attacker === 'm0');
    const atk = r.events[at] as Extract<CombatEvent, { type: 'attack' }>;
    const w = firstWindup(r.events);
    if (sprayHits(w).some((h) => h.target === atk.defender)) {
      const died = w.some((e) => e.type === 'death' && e.target === atk.defender);
      const next = r.events[at + 1 + w.length];
      if (died) expect(next?.type === 'dmg' && next.wave === undefined && next.source === 'm0', 'no swing into a corpse').toBe(false);
    }
  });

  it('a Ward absorbs the first pass and pops; the second Gilded pass lands', () => {
    const r = fight([gasket(true), demon(), neutral()], [neutral(40, { keywords: ['DS'] }), neutral()]);
    const w = firstWindup(r.events);
    expect(w.some((e) => e.type === 'shield' && e.target === 'm3'), 'the Ward pops').toBe(true);
    expect(sprayHits(w).filter((h) => h.target === 'm3'), 'one landed hit, the second pass').toHaveLength(1);
  });

  it('every landed hit is a friendly Demon dealing damage: Leech gains +1 Attack per hit', () => {
    // Leech is a Demon (spared). Three victims × one pass = three landed hits = three procs in the wind-up.
    const r = fight([gasket(), bm('dm_leech', 0, 40), neutral()], [demon(), neutral()]);
    const procs = firstWindup(r.events).filter((e) => e.type === 'buff' && e.target === 'm1');
    expect(procs).toHaveLength(3);
  });

  it('is deterministic: the same seed reproduces the same log', () => {
    const a = fight([gasket(true), demon(), neutral(), demon()], [demon(), neutral(3), neutral(2)], 11);
    const b = fight([gasket(true), demon(), neutral(), demon()], [demon(), neutral(3), neutral(2)], 11);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.result).toEqual(b.result);
  });
});

describe('Gasket in the Shop: a forced Rally hits YOUR non-Demons only (no enemy there)', () => {
  const body = (cardId: string, uid: string, extra: Partial<BoardCard> = {}): BoardCard => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
  };
  const shop = (board: BoardCard[]): RunState => ({ board, hand: [], shop: [], tribes: ['demon'] } as unknown as RunState);

  it('your non-Demons take 2, your Demons and Gasket take nothing', () => {
    const s = shop([body('dm_gasket', 'g'), body('trainingdummy', 'n', { health: 5, keywords: [] }), body('dm_knocked', 'k')]);
    fireRallies(s);
    expect(s.board.find((c) => c.uid === 'g')!.health).toBe(3);
    expect(s.board.find((c) => c.uid === 'n')!.health).toBe(3);
    expect(s.board.find((c) => c.uid === 'k')!.health).toBe(2);
  });

  it('Gilded: two passes of 2, so a 4-Health non-Demon dies', () => {
    const s = shop([body('dm_gasket', 'g', { golden: true, attack: 14, health: 6 }), body('trainingdummy', 'n', { health: 4, keywords: [] })]);
    fireRallies(s);
    expect(s.board.map((c) => c.uid)).toEqual(['g']);
  });
});
