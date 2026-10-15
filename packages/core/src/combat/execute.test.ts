import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type Keyword } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * EXECUTE ALWAYS KILLS (R-EXECUTE-04, owner 2026-10-15): *"my venom hit an axeman and it didnt kill it - can you make
 * sure execute full kills any minion it hits as long as it deals dmg to it"*.
 *
 * Any damage > 0 an Execute (`V`) source lands on a minion destroys it, and nothing that resolves later in the same
 * damage resolution (a heal, a Health gain, Axeman's "+3/+3 when a friendly Demon deals damage", Rad Rachel's wave
 * buffs) can save it. A hit that is fully PREVENTED (Ward / Resilient Ward / Immune / 0 damage) dealt no damage, so
 * it does not execute (owner confirmation item). Death processing is otherwise normal (Echo, Rise, Rebirth).
 *
 * The invariant every test here checks: a `poison` (Execute proc) event on X is followed by X's `death` before the
 * next `attack` begins, i.e. the executed body dies ON that hit.
 */
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
/** A plain body (Rising Pup) with no reactions of its own. */
const body = (attack: number, health: number, keywords: Keyword[] = []): BoardMinion => bm('u3_poochy', { attack, health, keywords });
const fight = (mine: BoardMinion[], foes: BoardMinion[], seed = 1, pmods: object = {}, emods: object = {}) =>
  simulate(mine, foes, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, questMods: pmods }), combatSide({ tier: 6, questMods: emods }));

/** Every executed body must die before the next attack starts. Returns the violations (uids executed but standing). */
function executedSurvivors(evs: CombatEvent[]): string[] {
  const bad: string[] = [];
  evs.forEach((e, i) => {
    if (e.type !== 'poison') return;
    for (let j = i + 1; j < evs.length; j++) {
      const f = evs[j]!;
      if (f.type === 'death' && f.target === e.target) return;
      if (f.type === 'attack') break;
    }
    bad.push(e.target);
  });
  return bad;
}
const deathsOf = (evs: CombatEvent[], uid: string) => evs.filter((e) => e.type === 'death' && e.target === uid).length;

describe('Execute always kills (R-EXECUTE-04)', () => {
  it('the owner repro: Venom vs Axeman — Axeman dies on the Execute hit in BOTH directions', () => {
    let venomFirst = 0;
    let axeFirst = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = fight([bm('venom')], [bm('dm_chosenfiend')], seed);
      const venom = r.initial.player[0]!.uid;
      const axe = r.initial.enemy[0]!.uid;
      const first = r.events.find((e) => e.type === 'attack') as Extract<CombatEvent, { type: 'attack' }>;
      if (first.attacker === venom) venomFirst++; else axeFirst++;
      expect(r.events.some((e) => e.type === 'poison' && e.target === axe)).toBe(true);
      expect(deathsOf(r.events, axe)).toBe(1);
      expect(executedSurvivors(r.events)).toEqual([]);
      expect(r.result).toBe('draw'); // a mutual kill on the first clash, whoever swings
    }
    expect(venomFirst).toBeGreaterThan(0);
    expect(axeFirst).toBeGreaterThan(0);
  });

  it('Gilded Axeman (+6/+6 per hit) still dies to the Execute hit', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = fight([bm('venom')], [bm('dm_chosenfiend', { golden: true, attack: 4, health: 4 })], seed);
      expect(executedSurvivors(r.events)).toEqual([]);
      expect(deathsOf(r.events, r.initial.enemy[0]!.uid)).toBe(1);
    }
  });

  it('mirrored sides: the enemy Venom executes the player Axeman (side-symmetric)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = fight([bm('dm_chosenfiend')], [bm('venom')], seed);
      expect(executedSurvivors(r.events)).toEqual([]);
      expect(deathsOf(r.events, r.initial.player[0]!.uid)).toBe(1);
      expect(r.result).toBe('draw');
    }
  });

  it('a 1-damage Execute fells a huge wall (attacking and defending)', () => {
    const atk = fight([body(1, 5, ['V'])], [body(0, 500)], 2);
    expect(executedSurvivors(atk.events)).toEqual([]);
    expect(atk.result).toBe('win');
    const def = fight([body(1, 50, ['V'])], [body(3, 500)], 2);
    expect(def.events.some((e) => e.type === 'poison' && e.target === def.initial.enemy[0]!.uid)).toBe(true);
    expect(executedSurvivors(def.events)).toEqual([]);
  });

  it('Cleave with Execute fells all three bodies in the clash, Axemen included', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = fight(
        [body(1, 60, ['V', 'C'])],
        [bm('dm_chosenfiend', { attack: 0 }), bm('dm_chosenfiend'), bm('dm_chosenfiend', { attack: 0 })],
        seed,
      );
      expect(executedSurvivors(r.events)).toEqual([]);
    }
  });

  it('a Rise body executed by the hit dies, then Rises per the Rise rules', () => {
    const r = fight([body(1, 50, ['V'])], [body(0, 30, ['R'])], 4);
    const foe = r.initial.enemy[0]!.uid;
    expect(executedSurvivors(r.events)).toEqual([]);
    expect(r.events.some((e) => e.type === 'death' && e.target === foe && e.rise)).toBe(true);
  });

  it('PREVENTED hits do not execute: Ward, Resilient Ward and Immune absorb it, and the Execute is not spent', () => {
    const ward = fight([body(1, 50, ['V'])], [body(0, 20, ['DS'])], 5);
    const wardFoe = ward.initial.enemy[0]!.uid;
    const ev = ward.events.filter((e) => (e.type === 'shield' || e.type === 'poison' || e.type === 'death') && 'target' in e && e.target === wardFoe).map((e) => e.type);
    expect(ev.slice(0, 3)).toEqual(['shield', 'poison', 'death']); // first hit popped the Ward, the second executed
    const imm = fight([body(1, 50, ['V'])], [body(0, 20, ['IMM'])], 5);
    expect(imm.events.some((e) => e.type === 'poison')).toBe(false);
    expect(imm.events.some((e) => e.type === 'venomLost')).toBe(false);
  });
});

describe('Execute from non-attack paths (R-EXECUTE-04)', () => {
  it('BLEED: a Bloodbinder carrying Execute executes the marked enemy with its bleed', () => {
    // Its own swings land on a Resilient Ward (prevented: the Execute is not spent) until the 4th attack bleeds.
    const r = fight(
      [bm('bloodbinder', { keywords: ['V'], health: 400 }), body(0, 400, ['T'])],
      [body(0, 300, ['T', 'DS', 'RW']), body(1, 400)],
      7,
    );
    // The poison must come from the BLEED itself: between the `bleeds` cast and the next swing.
    const at = r.events.findIndex((e) => e.type === 'sc' && /bleeds/.test(e.text ?? ''));
    expect(at).toBeGreaterThan(-1);
    const next = r.events.findIndex((e, i) => i > at && e.type === 'attack');
    const window = r.events.slice(at, next < 0 ? undefined : next);
    expect(window.some((e) => e.type === 'poison')).toBe(true);
    expect(executedSurvivors(r.events)).toEqual([]);
  });

  it('ECHO SPRAY: a Fel Spikes carrying Execute executes an enemy it hits, Axeman included', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = fight([bm('dm_felspikes', { attack: 0, keywords: ['T', 'V'] })], [bm('dm_chosenfiend', { attack: 5, health: 90 }), body(0, 90)], seed);
      expect(r.events.some((e) => e.type === 'poison')).toBe(true);
      expect(executedSurvivors(r.events)).toEqual([]);
    }
  });

  it('GRANTED Execute (Raven Rally) kills like printed Execute', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = fight([bm('b2_raven', { health: 200 }), bm('u3_poochy', { attack: 1, health: 200 })], [bm('dm_chosenfiend', { health: 60 }), bm('dm_chosenfiend', { health: 60 })], seed);
      expect(executedSurvivors(r.events)).toEqual([]);
    }
  });
});

describe('Execute matrix: sources x defenders with post-hit reactions (R-EXECUTE-04)', () => {
  // Defenders whose own reactions might add Health after an Execute hit lands. Each is fought from both sides, with
  // the Execute body attacking and defending, across seeds. Any executed body still standing at the next swing fails.
  const reactive = ['dm_chosenfiend', 'u3_poochy'];
  const extraIds = Object.values(CARD_INDEX)
    .filter((c) => !c.spell && (c.effects ?? []).some((e) => e.on === 'onDamaged' || e.on === 'friendlyDemonDealtDamage'))
    .map((c) => c.id);
  const defenders = [...new Set([...reactive, ...extraIds])];

  it(`no executed body survives its hit (${defenders.length} reactive defenders)`, () => {
    const bad: string[] = [];
    for (const id of defenders) {
      for (const execKw of [['V'], ['V', 'C'], ['V', 'W']] as Keyword[][]) {
        for (let seed = 1; seed <= 4; seed++) {
          const foes = [bm(id), bm(id), bm('dm_chosenfiend')];
          const a = fight([body(1, 80, execKw), body(2, 80, ['V'])], foes, seed);
          const b = fight(foes, [body(1, 80, execKw), body(2, 80, ['V'])], seed);
          for (const r of [a, b]) {
            const s = executedSurvivors(r.events);
            if (s.length) bad.push(`${id}/${execKw.join('')}/seed${seed}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

