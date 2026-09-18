import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type Keyword } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * REBIRTH — the new keyword (owner ruling 2026-09-16), and the three combat runes of Set 3 batch 2 / tranche C
 * that ride on it or on the same death machinery:
 *
 *   · `RB`: when the minion dies it returns ONCE with its FULL current body (stats, granted buffs, keywords —
 *     a Ward it carried at any point this fight restored — effects). Rise returns the PRINTED body at 1 Health.
 *   · Rune of Rebirth (changed): Start of Combat — one random friendly minion gains Rebirth.
 *   · Rune of the Final Gate: the first board wipe each combat summons three random Undead that died.
 *   · Rune of Dreamed Graves: the first minion summoned from the hand each combat gains Rebirth.
 *
 * The ORDERING RULES pinned here are the ones `killOrReborn` documents: Rebirth before Rise; the Echo fires on
 * the Rebirth death and the body returns to the right of what it summoned; a Rebirth is NOT a Rise (no `onRise`);
 * it IS a summon (the entry suite runs); it is not re-armed.
 */
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const fight = (mine: BoardMinion[], foes: BoardMinion[], mods: object = {}, seed = 3, extra: object = {}) =>
  simulate(mine, foes, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['undead', 'beast', 'spirit', 'celestial'], questMods: mods, ...extra }), combatSide({ tier: 6 }));
type Reborn = Extract<CombatEvent, { type: 'reborn' }>;
const reborns = (evs: CombatEvent[]): Reborn[] => evs.filter((e): e is Reborn => e.type === 'reborn');
const kwGrants = (evs: CombatEvent[], kw: Keyword) => evs.filter((e) => e.type === 'keyword' && e.keyword === kw) as Extract<CombatEvent, { type: 'keyword' }>[];

describe('Rebirth (RB) — the body comes back WHOLE, once', () => {
  it('a Warded 50/50 dies and comes back a Warded 50/50 — full stats, the Ward restored, Rebirth spent', () => {
    // 100-Attack foe: the first hit breaks the Ward, the second kills — the classic "a Warded body has lost
    // its Ward by the time it dies" case the owner's example describes.
    // (Rising Pup, not the sandbag: the sandbag's own on-damaged Attack gain would blur the "same stats" read.)
    const r = fight([bm('u3_poochy', { attack: 50, health: 50, keywords: ['RB', 'DS'] })], [foe(100, 500)]);
    const me = r.initial.player[0]!.uid;
    const rb = reborns(r.events);
    expect(rb, 'exactly one return').toHaveLength(1);
    expect(rb[0]).toMatchObject({ target: me, rebirth: true, hp: 50, attack: 50 });
    expect(rb[0]!.keywords, 'the Ward is back').toContain('DS');
    expect(rb[0]!.keywords, 'Rebirth itself is spent on the return').not.toContain('RB');
    // The death that preceded it is flagged like a Rise death (the UI shows the removal, does not count a kill).
    const deaths = r.events.filter((e) => e.type === 'death' && e.target === me);
    expect(deaths.length).toBe(2); // the Rebirth death, then the real one
    expect((deaths[0] as { rise?: true }).rise).toBe(true);
    expect((deaths[1] as { rise?: true }).rise).toBeUndefined();
  });

  it('granted combat buffs come back with it (Rise would shed them)', () => {
    // Kennelmaster-style board buff before the death: use a foe that must chew through a buffed body. Simplest
    // proof: a body whose CURRENT stats differ from its printed ones returns at the current ones.
    const r = fight([bm('u3_poochy', { attack: 9, health: 9, keywords: ['RB', 'T'] })], [foe(4, 500)]);
    const rb = reborns(r.events);
    expect(rb).toHaveLength(1);
    expect([rb[0]!.attack, rb[0]!.hp], 'the 9/9 it had, not the printed 2/1').toEqual([9, 9]);
    expect(rb[0]!.keywords, 'Taunt retained').toContain('T');
    // Rise on the same printed body would have said 2/1: pin the contrast so the two keywords never blur.
    const rise = fight([bm('u3_poochy', { attack: 9, health: 9, keywords: ['R', 'T'] })], [foe(4, 500)]);
    expect([reborns(rise.events)[0]!.attack, reborns(rise.events)[0]!.hp]).toEqual([2, 1]);
  });

  it('once: the returned body dies for real the next time, and nothing re-arms it', () => {
    const r = fight([bm('sandbag', { attack: 1, health: 3, keywords: ['RB'] })], [foe(10, 500)]);
    expect(reborns(r.events)).toHaveLength(1);
    expect(r.result, 'the side is wiped after the second death').toBe('lose');
  });

  it('ORDERING — Rebirth resolves BEFORE Rise: whole first, the printed body on the next death, then gone', () => {
    const r = fight([bm('u3_poochy', { attack: 7, health: 7, keywords: ['RB', 'R'] })], [foe(3, 500)]);
    const rb = reborns(r.events);
    expect(rb).toHaveLength(2);
    expect(rb[0], 'first: the Rebirth, whole, with Rise still armed').toMatchObject({ rebirth: true, attack: 7, hp: 7 });
    expect(rb[0]!.keywords).toContain('R');
    expect(rb[1]!.rebirth, 'second: a plain Rise').toBeUndefined();
    expect([rb[1]!.attack, rb[1]!.hp], 'the printed body at 1 Health').toEqual([2, 1]);
  });

  it('ORDERING — the Echo fires on the Rebirth death, and the body returns to the RIGHT of what it summoned', () => {
    // Pack's Echo summons two Pups. With Rebirth, the sequence is death → 2 summons → reborn (re-slotted after them).
    const r = fight([bm('pack', { keywords: ['RB'] })], [foe(9, 500)]);
    const me = r.initial.player[0]!.uid;
    const idx = (pred: (e: CombatEvent) => boolean) => r.events.findIndex(pred);
    const death = idx((e) => e.type === 'death' && e.target === me);
    const firstPup = idx((e) => e.type === 'summon' && e.minion.cardId === 'pup');
    const back = idx((e) => e.type === 'reborn' && e.target === me);
    expect(death).toBeGreaterThanOrEqual(0);
    expect(firstPup).toBeGreaterThan(death);
    expect(back).toBeGreaterThan(firstPup);
    expect(reborns(r.events)[0]!.after, 'anchored to the token on its left').toBeDefined();
  });

  it('a Rebirth death is a REAL death (the friendly-death tally) but NOT a Rise (no onRise watcher payout)', () => {
    // Rising Tide: "When a friendly minion Rises, give your minions +3/+4". A Rebirth must leave it quiet.
    const r = fight([bm('u3_risingtide', { attack: 1, health: 30 }), bm('sandbag', { attack: 1, health: 2, keywords: ['RB'] })], [foe(3, 500)]);
    expect(reborns(r.events).some((e) => e.rebirth)).toBe(true);
    const tideBuffs = (evs: CombatEvent[]) => evs.filter((e) => e.type === 'buff' && /onRise/.test((e as { key?: string }).key ?? ''));
    const tide = tideBuffs(r.events);
    expect(tide, 'Rising Tide never heard a Rise').toHaveLength(0);
    // …whereas a Rise on the same body wakes it.
    const rise = fight([bm('u3_risingtide', { attack: 1, health: 30 }), bm('sandbag', { attack: 1, health: 2, keywords: ['R'] })], [foe(3, 500)]);
    expect(tideBuffs(rise.events).length).toBeGreaterThan(0);
  });

  it("ECHO FIRST, THEN THE RETURN (owner 2026-09-18, the Rise rule): with six others standing, the Echo's summon takes the freed slot and the body stays dead", () => {
    // Mama Pup's Echo summons two Pups. Her death frees ONE slot: the first Pup takes it, the second overflows,
    // and the Rebirth return — attempted only after the Echo — finds no room. (Before 2026-09-18 the body held
    // its slot through the Echo, so both Pups overflowed and the body came back.)
    const board = [bm('pack', { attack: 1, health: 2, keywords: ['RB'] }), ...Array.from({ length: 6 }, () => bm('u3_poochy', { attack: 0, health: 200, keywords: [] }))];
    const r = fight(board, [foe(3, 500)]);
    expect(reborns(r.events), 'no return — the Pup had the slot').toHaveLength(0);
    const pups = r.events.filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'pup');
    expect(pups, 'one Pup landed in the freed slot').toHaveLength(1);
    // The side never went past the cap.
    const alive = new Set(r.initial.player.map((m) => m.uid));
    for (const e of r.events) { if (e.type === 'summon' && e.side === 'player') alive.add(e.minion.uid); if (e.type === 'death' && e.side === 'player') alive.delete(e.target); }
    expect(alive.size).toBeLessThanOrEqual(7);
  });

  it('a Rebirth body with a NON-summon Echo still returns on a full board (its own freed slot)', () => {
    // Sergeant's Echo grants Health, no body — the freed slot is still free when the return is attempted.
    const board = [bm('sergeant', { attack: 1, health: 2, keywords: ['RB'] }), ...Array.from({ length: 6 }, () => bm('u3_poochy', { attack: 0, health: 200, keywords: [] }))];
    const r = fight(board, [foe(3, 500)]);
    expect(reborns(r.events).filter((e) => e.rebirth), 'the body returned').toHaveLength(1);
  });

  it('is deterministic: the same seed replays byte-for-byte', () => {
    const a = fight([bm('pack', { keywords: ['RB', 'DS'] }), bm('u3_poochy', { keywords: ['RB', 'R', 'T'] })], [foe(6, 300)], {}, 11);
    const b = fight([bm('pack', { keywords: ['RB', 'DS'] }), bm('u3_poochy', { keywords: ['RB', 'R', 'T'] })], [foe(6, 300)], {}, 11);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.result).toBe(b.result);
  });
});

describe('Rune of Rebirth (changed 2026-09-16): Start of Combat — a random friendly minion gains Rebirth', () => {
  const board = () => [bm('sandbag', { attack: 3, health: 3 }), bm('sandbag', { attack: 3, health: 3 }), bm('sandbag', { attack: 3, health: 3 })];

  it('grants exactly ONE foldable `keyword RB` on a real friendly body, on its own beat', () => {
    const r = fight(board(), [foe(10, 500)], { runeRebirth: true });
    const grants = kwGrants(r.events, 'RB');
    expect(grants).toHaveLength(1);
    expect(r.initial.player.map((m) => m.uid)).toContain(grants[0]!.target);
    expect(r.events.some((e) => e.type === 'questTrigger' && e.flag === 'runeRebirth' && e.side === 'player')).toBe(true);
    // No exact-copy Echo any more — the old rune.
    expect(r.events.some((e) => e.type === 'sc' && /gains an Echo/.test(e.text))).toBe(false);
  });

  it('the granted body actually Rebirths when it dies', () => {
    const r = fight(board(), [foe(10, 500)], { runeRebirth: true });
    const target = kwGrants(r.events, 'RB')[0]!.target;
    expect(reborns(r.events).filter((e) => e.target === target && e.rebirth)).toHaveLength(1);
  });

  it('without the rune nothing is granted', () => {
    expect(kwGrants(fight(board(), [foe(10, 500)]).events, 'RB')).toHaveLength(0);
  });

  it('two copies held = two grants, on two different bodies', () => {
    const r = fight(board(), [foe(10, 500)], { runeRebirth: true, flagCopies: { runeRebirth: 2 } });
    const targets = kwGrants(r.events, 'RB').map((e) => e.target);
    expect(new Set(targets).size).toBe(2);
  });
});

describe('Rune of the Final Gate: the first board wipe summons three random Undead that died this combat', () => {
  // Four Undead (no Rise) that all fall to a big foe; the gate should bring three of them back.
  const undead = () => Array.from({ length: 4 }, () => bm('u3_poochy', { attack: 1, health: 1, keywords: [] }));

  it('fires once, on the wipe, with three printed Undead bodies drawn from the death list', () => {
    const r = fight(undead(), [foe(5, 500)], { runeFinalGate: true });
    const gate = r.events.filter((e) => e.type === 'questTrigger' && e.flag === 'runeFinalGate' && e.side === 'player');
    expect(gate, 'once per fight').toHaveLength(1);
    const summons = r.events.filter((e) => e.type === 'summon' && e.side === 'player');
    expect(summons).toHaveLength(3);
    for (const s of summons) expect((s as { minion: { cardId: string } }).minion.cardId).toBe('u3_poochy');
    // The gate opened only after the LAST of the four fell.
    const gateAt = r.events.indexOf(gate[0]!);
    const deathsBefore = r.events.slice(0, gateAt).filter((e) => e.type === 'death' && e.side === 'player').length;
    expect(deathsBefore).toBe(4);
    // …and when those three fall too, no second gate.
    expect(r.result).toBe('lose');
  });

  it('draws without replacement — fewer than three dead Undead means fewer summons', () => {
    const r = fight([bm('u3_poochy', { attack: 1, health: 1, keywords: [] }), bm('u3_poochy', { attack: 1, health: 1, keywords: [] })], [foe(5, 500)], { runeFinalGate: true });
    expect(r.events.filter((e) => e.type === 'summon' && e.side === 'player')).toHaveLength(2);
  });

  it('only UNDEAD corpses count; a non-Undead wipe with no Undead dead spends the gate silently', () => {
    const r = fight([bm('sandbag', { attack: 1, health: 1 }), bm('sandbag', { attack: 1, health: 1 })], [foe(5, 500)], { runeFinalGate: true });
    expect(r.events.filter((e) => e.type === 'summon' && e.side === 'player')).toHaveLength(0);
    expect(r.events.some((e) => e.type === 'questTrigger' && e.flag === 'runeFinalGate')).toBe(false);
  });

  it('without the rune the wipe is final', () => {
    const r = fight(undead(), [foe(5, 500)]);
    expect(r.events.filter((e) => e.type === 'summon' && e.side === 'player')).toHaveLength(0);
  });
});

describe('Rune of Dreamed Graves: the first minion summoned from your hand each combat gains Rebirth', () => {
  const handMinion = (uid: string, cardId: string, over: Partial<{ attack: number; health: number }> = {}) => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords] as Keyword[], golden: false, ...over };
  };
  // Dreamtide Caller's Echo summons a COPY of the highest-Health hand minion — the hand-summon path.
  const fightH = (mods: object, hand = [handMinion('h1', 'sandbag', { attack: 4, health: 4 }), handMinion('h2', 'sandbag', { attack: 2, health: 2 })]) =>
    fight([bm('sp3_dreamtide', { attack: 1, health: 1 }), bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(3, 500)], mods, 5, { handMinions: hand });

  it('the first hand-summon gains RB (a foldable keyword grant on its own beat) and later Rebirths; the second does not', () => {
    const r = fightH({ runeDreamedGraves: true });
    const fromHand = r.events.filter((e) => e.type === 'summon' && (e as { fromHandUid?: string }).fromHandUid) as { minion: { uid: string } }[];
    expect(fromHand.length).toBeGreaterThanOrEqual(1);
    const grants = kwGrants(r.events, 'RB');
    expect(grants).toHaveLength(1);
    expect(grants[0]!.target).toBe(fromHand[0]!.minion.uid);
    expect(r.events.some((e) => e.type === 'questTrigger' && e.flag === 'runeDreamedGraves')).toBe(true);
    expect(reborns(r.events).filter((e) => e.target === fromHand[0]!.minion.uid && e.rebirth)).toHaveLength(1);
  });

  it('a body NOT from the hand (an Echo token) never takes it', () => {
    const r = fight([bm('pack')], [foe(9, 500)], { runeDreamedGraves: true });
    expect(kwGrants(r.events, 'RB')).toHaveLength(0);
  });

  it('without the rune nothing is granted', () => {
    expect(kwGrants(fightH({}).events, 'RB')).toHaveLength(0);
  });
});

describe('Rebirth acts like Rise (owner 2026-09-16: "it acts like rise, so copy that") — the ordering parity pin', () => {
  // A printed-body probe: def 0/5 Taunt, Avenge (2) → summon a Spear Warden. With NO granted buffs or keywords,
  // Rise and Rebirth return the same body (Rise at 1 Health, Rebirth at its full 5; both die to the 5-Attack
  // foe) — so every OTHER difference between the two branches would show up as a difference in the flow of
  // deaths, summons and returns. Nobody on the player side can attack, so every death is an enemy swing into
  // a random Taunt; seed 8 has the foe kill the probe first, then two fodder before it is hit again.
  CARD_INDEX['dbg_avenge_probe'] = { id: 'dbg_avenge_probe', name: 'Avenge probe', tribe: 'neutral', tier: 1, attack: 0, health: 5, keywords: ['T'],
    effects: [{ on: 'avenge', do: 'avengeSummon', params: { count: 2, cardId: 'knit' } }], text: '' };
  const flow = (kw: Keyword) => {
    const fodder = () => bm('u3_poochy', { attack: 0, health: 1, keywords: ['T'] });
    const r = fight([bm('dbg_avenge_probe', { keywords: ['T', kw] }), fodder(), fodder(), fodder(), fodder()],
      [{ cardId: 'sandbag', attack: 5, health: 500, keywords: [] } as unknown as BoardMinion], {}, 8);
    return r.events
      .filter((e) => e.type === 'death' || e.type === 'summon' || e.type === 'reborn' || e.type === 'questTrigger')
      .map((e) => e.type === 'death' ? `death:${e.target}${(e as { rise?: true }).rise ? ':rise' : ''}` : e.type === 'summon' ? `summon:${e.minion.cardId}` : e.type === 'reborn' ? `reborn:${e.target}` : `trigger:${e.flag}`);
  };

  it('the flow of deaths, returns and Avenge payouts is IDENTICAL under Rise and Rebirth', () => {
    const rise = flow('R'), rebirth = flow('RB');
    expect(rise[0], 'the probe died first').toBe('death:m0:rise');
    expect(rise[1], '…and rose').toBe('reborn:m0');
    expect(rise, 'its Avenge paid out after the return').toContain('summon:knit');
    expect(rebirth).toEqual(rise);
  });

  it('…including that its AVENGE PROGRESS restarts on the return (Rise: "1/3 should reset to 0/3"): the probe\'s own death is not progress', () => {
    // Order (seed 8): the foe kills the probe (death 1) → it returns; a fodder dies (death 2) → progress 1,
    // nothing; another fodder dies (death 3) → progress 2 → the Warden. Without the reset the Warden would
    // follow death 2 (its own death counted as progress).
    const f = flow('RB');
    const knightAt = f.indexOf('summon:knit');
    expect(knightAt).toBeGreaterThan(0);
    expect(f.slice(0, knightAt).filter((x) => x.startsWith('death:')), 'three friendly deaths precede the first Warden').toHaveLength(3);
    expect(f.findIndex((x) => x.startsWith('reborn:')), 'and the return came first').toBeLessThan(knightAt);
  });

  it('a body that dies to retaliation on its OWN swing and returns is next to attack again — under Rebirth as under Rise', () => {
    // A 1/5 probe swings into a 5-Attack Taunt foe, dies, returns; the Rise rewind puts it next in line, so its
    // side's next swing is the probe's again (not the 1/1 fodder's). Rebirth gets the identical rewind.
    CARD_INDEX['dbg_swing_probe'] = { id: 'dbg_swing_probe', name: 'Swing probe', tribe: 'neutral', tier: 1, attack: 1, health: 5, keywords: [], effects: [], text: '' };
    const order = (kw: Keyword) => {
      const taunt = () => bm('u3_poochy', { attack: 1, health: 1, keywords: ['T'] });
      const r = fight([bm('dbg_swing_probe', { keywords: [kw] }), taunt(), taunt(), taunt()],
        [{ cardId: 'sandbag', attack: 5, health: 500, keywords: ['T'] } as unknown as BoardMinion, { cardId: 'sandbag', attack: 1, health: 500, keywords: [] } as unknown as BoardMinion], {}, 3);
      return r.events.filter((e) => e.type === 'attack' && e.attacker.startsWith('m') && ['m0', 'm1', 'm2', 'm3'].includes(e.attacker)).map((e) => (e as { attacker: string }).attacker);
    };
    expect(order('R').slice(0, 2), 'Rise: the probe swings, dies, returns — and swings again').toEqual(['m0', 'm0']);
    expect(order('RB'), 'Rebirth: the same rotation').toEqual(order('R'));
  });
});
