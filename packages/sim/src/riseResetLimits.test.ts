/**
 * R-RETURN-RESET-01 (owner 2026-10-21, "yes"): a body that comes back through Rise or Rebirth starts EVERY per-body
 * once-per-combat / N-per-combat limit fresh, then spends it until the next removal and return. Extends Foamguard's
 * R-DWARF-1021-02 to every per-body cap through ONE reset (`resetPerCombatLimits`, packages/core/src/combat/minion.ts),
 * called from both return paths in `killOrReborn`.
 *
 * Per family: the first life SPENDS the cap, the returned life fires again (Rise, Rebirth, two removals), and no life
 * ever fires past its own cap (the bound that keeps the reset from looping: a reset needs a spent Rise / Rebirth).
 * Each "returned life fires again" check FAILS on the pre-ruling engine, where the cap stayed spent after a return.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';

const bm = (uid: string, cardId: string, over: Omit<Partial<BoardMinion>, 'keywords'> & { keywords?: string[]; damageDealt?: number } = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { uid, sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as unknown as BoardMinion;
};
const wall = (attack: number, uid = 'w'): BoardMinion => bm(uid, 'sandbag', { attack, health: 5000, keywords: [] });
const fight = (p: BoardMinion[], e: BoardMinion[], seed: number) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
type Fight = ReturnType<typeof fight>;
const uidOf = (r: Fight, cardId: string): string => r.initial.player.find((m) => m.cardId === cardId)!.uid;

/** How many qualifying events landed in each LIFE of `uid` (life 0, then one more per `reborn`). */
function perLife(ev: readonly CombatEvent[], uid: string, pred: (e: CombatEvent) => boolean): number[] {
  const lives = [0];
  for (const e of ev) {
    if (e.type === 'reborn' && e.target === uid) lives.push(0);
    else if (pred(e)) lives[lives.length - 1]! += 1;
  }
  return lives;
}

interface Family {
  name: string;
  cap: number;
  build: (keywords: string[], seed: number) => number[];
}

const FAMILIES: Family[] = [
  {
    name: 'Pummel (Goldvein, once per combat)',
    cap: 1,
    // Tally seeded at 5 with a 6-Attack body: its first hit crosses 6, and each later life's hit crosses the next multiple.
    build: (k, seed) => {
      const r = fight([bm('g', 'k3_goldvein', { attack: 6, damageDealt: 5, keywords: k })], [wall(100)], seed);
      const u = uidOf(r, 'k3_goldvein');
      return perLife(r.events, u, (e) => e.type === 'pummelTrigger' && e.source === u);
    },
  },
  {
    name: 'Evolving Abomination (Rally double, twice per combat)',
    cap: 2,
    build: (k, seed) => {
      // A 0-Attack Taunt friend soaks the wall's swings, so the Abomination only dies on its own attacks and a risen
      // 6/1 body gets a swing of its own (otherwise the wall always kills it before it can Rally).
      const tank = bm('t', 'sandbag', { attack: 0, health: 50000, keywords: ['T'] });
      const r = fight([bm('a', 'n2_abomination', { health: 150, keywords: ['RL', ...k] }), tank], [wall(100)], seed);
      const u = uidOf(r, 'n2_abomination');
      return perLife(r.events, u, (e) => e.type === 'buff' && e.target === u && e.source === u);
    },
  },
  {
    name: 'Brood Matron (Imp cap of 3)',
    cap: 3,
    build: (k, seed) => {
      const friends = [1, 2, 3, 4, 5].map((i) => bm(`f${i}`, 'sandbag', { attack: 1, health: 1, keywords: ['R'] }));
      const r = fight([...friends, bm('b', 'brood', { health: 150, keywords: k })], [wall(100)], seed);
      const u = uidOf(r, 'brood');
      return perLife(r.events, u, (e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'impscrap');
    },
  },
  {
    name: 'Whaloo (3 Runebind casts per combat)',
    cap: 3,
    build: (k, seed) => {
      const r = fight([bm('wh', 'd3_whaloo', { health: 500, keywords: k })], [wall(100)], seed);
      const u = uidOf(r, 'd3_whaloo');
      return perLife(r.events, u, (e) => e.type === 'sc' && e.source === u && e.spellId === 'w4_runebind');
    },
  },
  {
    name: 'Immune Iggy (immune on its first 2 swings)',
    cap: 2,
    build: (k, seed) => {
      const r = fight([bm('i', 'd3_iggy', { health: 500, keywords: k })], [wall(100)], seed);
      const u = uidOf(r, 'd3_iggy');
      return perLife(r.events, u, (e) => e.type === 'attack' && e.attacker === u && e.immune === true);
    },
  },
  {
    name: 'Bounty Bot (immune on its first 2 swings)',
    cap: 2,
    build: (k, seed) => {
      const r = fight([bm('bb', 'bountybot', { health: 500, keywords: k })], [wall(100)], seed);
      const u = uidOf(r, 'bountybot');
      return perLife(r.events, u, (e) => e.type === 'attack' && e.attacker === u && e.immune === true);
    },
  },
  {
    name: 'Yeti (once-per-combat reflection)',
    cap: 1,
    build: (k, seed) => {
      const r = fight([bm('y', 'n3_yeti', { keywords: k })], [wall(4), wall(4, 'w2')], seed);
      const u = uidOf(r, 'n3_yeti');
      return perLife(r.events, u, (e) => e.type === 'sc' && e.source === u);
    },
  },
];

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

describe('R-RETURN-RESET-01: a returned body starts its per-combat limits fresh', () => {
  for (const f of FAMILIES) {
    describe(f.name, () => {
      it('control: with no return the cap is spent and never exceeded', () => {
        let spent = 0;
        for (const s of SEEDS) {
          const lives = f.build([], s);
          expect(lives.length).toBe(1);
          expect(lives[0]!, `seed ${s}`).toBeLessThanOrEqual(f.cap);
          if (lives[0] === f.cap) spent++;
        }
        expect(spent, 'the fixture spends the cap').toBeGreaterThan(0);
      });
      for (const [label, kws] of [['Rise', ['R']], ['Rebirth', ['RB']]] as const) {
        it(`${label}: after spending the cap, the returned body fires again (never past its own cap)`, () => {
          let refired = 0;
          for (const s of SEEDS) {
            const lives = f.build([...kws], s);
            for (const n of lives) expect(n, `seed ${s}: ${lives.join('/')}`).toBeLessThanOrEqual(f.cap);
            if (lives.length === 2 && lives[0] === f.cap && lives[1]! > 0) refired++;
          }
          expect(refired, 'some seed spends the cap, returns, and fires again').toBeGreaterThan(0);
        });
      }
      it('two removals (Rebirth then Rise): each return resets, a third life fires again', () => {
        let refired = 0;
        for (const s of SEEDS) {
          const lives = f.build(['R', 'RB'], s);
          expect(lives.length).toBeLessThanOrEqual(3);
          for (const n of lives) expect(n, `seed ${s}: ${lives.join('/')}`).toBeLessThanOrEqual(f.cap);
          if (lives.length === 3 && lives[0] === f.cap && lives[1]! > 0 && lives[2]! > 0) refired++;
        }
        expect(refired).toBeGreaterThan(0);
      });
    });
  }
});

describe('R-RETURN-RESET-01: every Pummel cap resets on a Rebirth (one hit crosses ten multiples, so each life pays its cap)', () => {
  for (const [id, cap] of [['tauntbreaker', 1], ['dm_todd', 1], ['k_kobe', 2], ['dw3_hangover', 5], ['k3_goldvein', 1], ['ce3_starcharter', 1]] as const) {
    it(`${id}: ${cap} per life, ${cap * 2} across a Rebirth`, () => {
      const def = CARD_INDEX[id]!;
      const every = Number(def.effects.find((e) => e.on === 'passive')!.params!.every);
      const kws = def.keywords.filter((k) => k !== 'DS');
      const run = (extra: string[]) => {
        const r = fight([bm('p', id, { attack: every * 10, keywords: [...kws, ...extra] })], [wall(100)], 5);
        const u = uidOf(r, id);
        return perLife(r.events, u, (e) => e.type === 'pummelTrigger' && e.source === u);
      };
      expect(run([])).toEqual([cap]);
      expect(run(['RB'])).toEqual([cap, cap]);
    });
  }
});

describe('R-RETURN-RESET-01: Gryphon (up to 4 free refreshes a combat)', () => {
  it('a returned Gryphon banks past the first life\'s 4 (never more than 4 per life)', () => {
    let past = 0;
    for (const s of SEEDS) {
      for (const kws of [['R'], ['RB'], ['R', 'RB']]) {
        const r = fight([bm('gr', 'gryphon', { health: 20, keywords: ['T', ...kws] })], [wall(5)], s);
        const lives = 1 + r.events.filter((e) => e.type === 'reborn').length;
        const rolls = r.playerFreeRolls ?? 0;
        expect(rolls).toBeLessThanOrEqual(4 * lives);
        if (rolls > 4) past++;
      }
      const ctl = fight([bm('gr', 'gryphon', { health: 20, keywords: ['T'] })], [wall(5)], s);
      expect(ctl.playerFreeRolls ?? 0).toBeLessThanOrEqual(4);
    }
    expect(past).toBeGreaterThan(0);
  });
});

describe('R-RETURN-RESET-01: the immune-shield FX follows the reset', () => {
  it('the returned Iggy\'s fresh immune swings carry `attack.immune` (the flag the shield reads); a spent swing does not', () => {
    let seen = false;
    for (const s of SEEDS) {
      for (const kws of [['R'], ['RB']]) {
        const r = fight([bm('i', 'd3_iggy', { health: 500, keywords: kws })], [wall(100)], s);
        const u = uidOf(r, 'd3_iggy');
        const iBack = r.events.findIndex((e) => e.type === 'reborn' && e.target === u);
        if (iBack < 0) continue;
        const swings = (from: number, to: number) =>
          r.events.slice(from, to).filter((e): e is Extract<CombatEvent, { type: 'attack' }> => e.type === 'attack' && e.attacker === u);
        const before = swings(0, iBack);
        const after = swings(iBack, r.events.length);
        if (before.length > 2 && after.length > 0) {
          expect(before.slice(2).every((e) => !e.immune), 'spent swings: no shield').toBe(true);
          expect(after[0]!.immune, 'first swing after the return: shield again').toBe(true);
          seen = true;
        }
      }
    }
    expect(seen).toBe(true);
  });
});

describe('R-RETURN-RESET-01: loop guard', () => {
  it('capped bodies with Rise + Rebirth on both sides always end, at most two returns per body', () => {
    const kws = ['R', 'RB'];
    const side = (p: string) => [
      bm(`${p}1`, 'n2_abomination', { keywords: ['RL', ...kws] }),
      bm(`${p}2`, 'brood', { keywords: [...kws] }),
      bm(`${p}3`, 'd3_iggy', { keywords: [...kws] }),
      bm(`${p}4`, 'n3_yeti', { keywords: [...kws] }),
      bm(`${p}5`, 'k3_goldvein', { keywords: [...kws] }),
      bm(`${p}6`, 'gryphon', { keywords: ['T', ...kws] }),
      bm(`${p}7`, 'd3_whaloo', { keywords: [...kws] }),
    ];
    for (const s of SEEDS) {
      const r = fight(side('a'), side('b'), s);
      expect(r.result, `seed ${s}`).toBeDefined();
      for (const m of [...r.initial.player, ...r.initial.enemy]) {
        expect(r.events.filter((e) => e.type === 'reborn' && e.target === m.uid).length, 'at most two returns per body').toBeLessThanOrEqual(2);
      }
    }
  });
});
