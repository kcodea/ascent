/**
 * AVENGE COUNTS FROM ARRIVAL (owner report 2026-08-24).
 *
 * A minion SUMMONED mid-combat must not inherit the side's running friendly-death tally. Before the fix an
 * Avenge body summoned onto a board that had already lost minions read the full count and fired on arrival —
 * Bullseye/Mammoth rolling a 7/7 Solaris that instantly Warded + struck, or a summoned Dunkey immediately
 * summoning an Armadiyo. It is the same rule a Rise already used (`avengeBaseline`): everything before the
 * body existed is not its progress. `placeSummon` now stamps the baseline, so a summon counts from 0.
 *
 * Scenario, fully deterministic on seed 1: four 1/1 fodder around a fragile Bullseye die to a single tanky
 * enemy; Bullseye's Echo summons ONE 7/7 Solaris (Avenge 4) from a pool forced to just `b2_solaris`. The
 * Solaris arrives at the 3rd friendly death and the fight ends at the 6th — so with a fresh baseline it never
 * reaches four deaths of its own and never Wards. With the old count-from-zero it saw the 4th side-death land
 * one after it arrived and Warded on the spot.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, simulate, makeRng, setAvengeWindowObserver, type AvengeWindowObservation, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];

function summonedSolarisWards(seed: number): { summoned: number; wards: number; summonAtDeath: number } {
  const player: BoardMinion[] = [
    { cardId: 'b2_packstrider', attack: 1, health: 1 },
    { cardId: 'b2_packstrider', attack: 1, health: 1 },
    { cardId: 'b2_bullseye', attack: 1, health: 2 }, // Echo: summon a random Beast at 7/7 → forced to Solaris
    { cardId: 'b2_packstrider', attack: 1, health: 1 },
    { cardId: 'b2_packstrider', attack: 1, health: 1 },
  ];
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 2, health: 400 }];
  const r = simulate(player, enemy, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL_TRIBES, poolIds: ['b2_solaris'] }), combatSide({ tier: 1 }));
  const solaris = new Set<string>();
  let deaths = 0, wards = 0, summonAtDeath = -1;
  for (const e of r.events) {
    if (e.type === 'death' && e.side === 'player') deaths++; // every death counts, a Rise death too (owner 2026-07-27)
    if (e.type === 'summon' && (e as { minion?: { cardId?: string; uid: string } }).minion?.cardId === 'b2_solaris') {
      const m = (e as { minion: { uid: string } }).minion; solaris.add(m.uid); if (summonAtDeath < 0) summonAtDeath = deaths;
    }
    if (e.type === 'shieldUp' && solaris.has((e as { target?: string }).target ?? '')) wards++;
  }
  return { summoned: solaris.size, wards, summonAtDeath };
}

describe('a summoned Avenge minion counts deaths from its own arrival', () => {
  it('a 7/7 Solaris summoned mid-fight does not Ward on arrival', () => {
    const { summoned, wards, summonAtDeath } = summonedSolarisWards(1);
    // Guard the scenario itself, so a content/targeting change that stops summoning Solaris fails LOUDLY here
    // rather than turning the real assertion into a vacuous pass.
    expect(summoned, 'the scenario must actually summon a Solaris').toBe(1);
    expect(summonAtDeath, 'it must arrive after deaths have already accrued — that is the whole bug window').toBeGreaterThan(0);
    expect(wards, 'the summoned Solaris must NOT inherit the death tally and Ward immediately').toBe(0);
  });
});

/**
 * The Dunkey shape of the same rule (owner report 2026-09-21, bug 8e0b4757: "a fresh body on board" must start
 * at 0/4). Bullseye is the 2nd friendly death on seed 1 and its Echo summons a 7/7 Dunkey (Avenge 4: summon an
 * Armadiyo). The Armadiyo must land at the side's 6th friendly death, the 4th Dunkey itself witnessed, never at
 * the side's 4th. The sim's own window for the body is read through the `avengeCountFor` observer: baseline 2,
 * seen 0 on arrival. (The readout half of the report, the combat card printing 0/4, is guarded in
 * packages/ui/src/avengeSummonReadout.test.ts.)
 */
describe('a Dunkey summoned after 2 friendly deaths pays only after 4 MORE', () => {
  const fodder: BoardMinion = { cardId: 'b2_elderhorn', attack: 1, health: 1 }; // a vanilla body, dies to the 1-Attack wall
  const player: BoardMinion[] = [fodder, { cardId: 'b2_bullseye', attack: 1, health: 1 }, fodder, fodder, fodder, fodder, fodder];
  const enemy: BoardMinion[] = [{ cardId: 'b2_elderhorn', attack: 1, health: 400 }];

  function run(): { deathsAtDunkey: number; deathsAtArmadiyo: number; obs: AvengeWindowObservation[] } {
    const obs: AvengeWindowObservation[] = [];
    setAvengeWindowObserver((o) => obs.push({ ...o }));
    let r: ReturnType<typeof simulate>;
    try {
      r = simulate(player, enemy, makeRng(1), CARD_INDEX,
        combatSide({ tier: 6, tribes: ALL_TRIBES, poolIds: ['b2_dunkey'] }), combatSide({ tier: 1 }));
    } finally {
      setAvengeWindowObserver(); // never leak the observer into another test's sim
    }
    let deaths = 0, deathsAtDunkey = -1, deathsAtArmadiyo = -1;
    for (const e of r.events) {
      if (e.type === 'death' && e.side === 'player') deaths++; // every death counts, a Rise death too (owner 2026-07-27)
      if (e.type === 'summon' && e.minion.cardId === 'b2_dunkey' && deathsAtDunkey < 0) deathsAtDunkey = deaths;
      if (e.type === 'summon' && e.minion.cardId === 'b2_armadiyo' && deathsAtArmadiyo < 0) deathsAtArmadiyo = deaths;
    }
    return { deathsAtDunkey, deathsAtArmadiyo, obs: obs.filter((o) => o.sourceCard === 'b2_dunkey') };
  }

  it('the scenario summons Dunkey at the 2nd friendly death (the bug window from the report)', () => {
    expect(run().deathsAtDunkey).toBe(2);
  });

  it('the Armadiyo lands at the 6th friendly death, not the 4th', () => {
    const { deathsAtArmadiyo } = run();
    expect(deathsAtArmadiyo, 'the fight must reach the payout, or the assertion is vacuous').toBeGreaterThan(0);
    expect(deathsAtArmadiyo).toBe(6);
  });

  it('the sim reads the body at 0 on arrival: baseline 2, seen = count - 2 on every later death', () => {
    const { obs } = run();
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) {
      expect(o.baseline).toBe(2);
      expect(o.seen).toBe(o.count - 2);
    }
    expect(obs[0]!.seen).toBe(0); // the death that summoned it is outside its window (R-AVWIN-02)
  });
});

/**
 * The RECLAIMED shape of the same rule. Soren's Reclaim destroys a marked minion at Start of Combat and brings an
 * exact copy back through `flushResummons`, which inserts the body directly rather than through `placeSummon`,
 * so the copy never got the baseline stamp: a Reclaimed Kennelmaster counted its OWN destruction and paid its
 * Avenge (4) at the side's 4th death. A reclaimed body is a body placed mid-combat, so it counts from its return
 * (rule R-AVWIN-01): the improve lands at the side's 5th death, the observer reads baseline 1, seen = count - 1.
 */
describe('a Reclaimed (Soren) Avenge minion counts deaths from its return, not its own destruction', () => {
  const fodder: BoardMinion = { cardId: 'b2_elderhorn', attack: 1, health: 1 };
  const player: BoardMinion[] = [{ cardId: 'kennel', attack: 1, health: 20, resummon: true }, fodder, fodder, fodder, fodder, fodder]; // tough enough to outlive the 5 fodder
  const enemy: BoardMinion[] = [{ cardId: 'b2_elderhorn', attack: 1, health: 400 }];

  function run(): { copyUid: string | undefined; deathsAtReturn: number; deathsAtImprove: number; obs: AvengeWindowObservation[] } {
    const obs: AvengeWindowObservation[] = [];
    setAvengeWindowObserver((o) => obs.push({ ...o }));
    let r: ReturnType<typeof simulate>;
    try {
      r = simulate(player, enemy, makeRng(1), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES }), combatSide({ tier: 1 }));
    } finally {
      setAvengeWindowObserver();
    }
    let deaths = 0, deathsAtReturn = -1, deathsAtImprove = -1;
    let copyUid: string | undefined;
    for (const e of r.events) {
      if (e.type === 'death' && e.side === 'player') deaths++;
      if (e.type === 'summon' && e.minion.cardId === 'kennel' && copyUid === undefined) { copyUid = e.minion.uid; deathsAtReturn = deaths; }
      if (e.type === 'improve' && e.avenge && e.target === copyUid && deathsAtImprove < 0) deathsAtImprove = deaths;
    }
    return { copyUid, deathsAtReturn, deathsAtImprove, obs: obs.filter((o) => o.sourceUid === copyUid) };
  }

  it('the scenario reclaims the Kennelmaster after its own Start-of-Combat destruction (the 1st friendly death)', () => {
    const { copyUid, deathsAtReturn } = run();
    expect(copyUid, 'the copy must actually return').toBeDefined();
    expect(deathsAtReturn).toBe(1);
  });

  it("its Avenge (4) pays at the side's 5th death (the 4th after its return), not the 4th", () => {
    const { deathsAtImprove } = run();
    expect(deathsAtImprove, 'the fight must reach the payout, or the assertion is vacuous').toBeGreaterThan(0);
    expect(deathsAtImprove).toBe(5);
  });

  it('the sim reads the copy at 0 on return: baseline 1, seen = count - 1 on every later death', () => {
    const { obs } = run();
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) {
      expect(o.baseline).toBe(1);
      expect(o.seen).toBe(o.count - 1);
    }
  });
});
