/**
 * DOC BOT — ORDER GOLDENS (blind-spot class 4: determinism tests pin ONE order; nothing says it's the RULED
 * order).
 *
 * Every fixture here is a board deliberately built so that a WRONG resolution order produces a DIFFERENT
 * outcome — not just a reshuffled log. Each golden then pins the CURRENT outcome and states, in its comment,
 * the order rule it encodes. If an engine change flips one of these, that is not "update the snapshot":
 * it is a RULE change, and it needs either an owner ruling or a revert.
 *
 * Orderings that looked genuinely AMBIGUOUS while building these (where the pinned behaviour might not be
 * what the owner intends) are written up as proposed triage questions in
 * `docs/rulebook/order-ambiguities.md` — this file pins what IS, that file asks whether it SHOULD be.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { reduce } from '../reducer';
import { createRun, type RunState } from '../state';

const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });
const sim = (player: BoardMinion[], enemy: BoardMinion[], tribes: NonNullable<Parameters<typeof combatSide>[0]>['tribes'] = ['beast', 'demon']) =>
  simulate(player, enemy, makeRng(3), CARD_INDEX, combatSide({ tier: 6, tribes }), combatSide({ tier: 6, tribes }));
type Sim = ReturnType<typeof simulate>;
const buffs = (r: Sim, key: string) =>
  (r.events.filter((e) => e.type === 'buff' && (e as { key?: string }).key?.includes(key)) as
    { target: string; source: string; attack: number; health: number }[]);
const summons = (r: Sim) =>
  (r.events.filter((e) => e.type === 'summon') as unknown as
    { type: 'summon'; minion: { uid: string; cardId: string }; side: string; source: string; step: number }[]);
const deaths = (r: Sim) =>
  (r.events.filter((e) => e.type === 'death') as unknown as { type: 'death'; target: string; side: string }[]);

describe('Doc Bot — order goldens (each pins a resolution-order rule via an order-sensitive outcome)', () => {
  it('G1 — Start of Combat resolves LEFT-TO-RIGHT within a side', () => {
    // Two Speed Demons (SoC: give your OTHER minions 50% of this minion's stats). Order is outcome-bearing:
    // the left one fires first off base stats (+2/+15 from 4/30), which buffs the right one to 6/45 — so the
    // right one then grants the LARGER +3/+22. A right-to-left engine would grant +3/+22 from the left demon
    // instead: same board, different final stats. RULE PINNED: board index order, leftmost first.
    const r = sim(
      [bm('runmaw', 'A', 4, 30), bm('runmaw', 'B', 4, 30), bm('stray', 'D', 1, 30)],
      [bm('sandbag', 'W', 0, 40000)]);
    const [a, b] = [r.initial.player[0]!.uid, r.initial.player[1]!.uid];
    const grants = buffs(r, 'scBuffAlliesPctSelf').map((e) => [e.source, e.target, e.attack, e.health]);
    expect(grants).toEqual([
      [a, b, 2, 15],                       // left demon first, off its base 4/30 …
      [a, r.initial.player[2]!.uid, 2, 15],
      [b, a, 3, 22],                       // … so the right demon grants off its ALREADY-BUFFED 6/45.
      [b, r.initial.player[2]!.uid, 3, 22],
    ]);
  });

  it("G2 — Start of Combat: the PLAYER side's effects all resolve before the enemy side's, even when the enemy has the first attack", () => {
    // Player and enemy each field a Speed Demon; the enemy's larger board takes the first ATTACK, but the
    // player's SoC still resolves first. Outcome-bearing: a cross-side SoC interaction (e.g. SoC damage into
    // a minion a SoC buff would save) resolves differently under initiative-side-first.
    // RULE PINNED: SoC is player-side-first, NOT initiative-side-first.
    const r = sim(
      [bm('runmaw', 'PA', 4, 50), bm('stray', 'PD', 0, 50)],
      [bm('runmaw', 'EA', 4, 50), bm('stray', 'ED', 0, 50), bm('stray', 'ED2', 0, 50)]);
    const playerDemon = r.initial.player[0]!.uid;
    const enemyDemon = r.initial.enemy[0]!.uid;
    const socSources = buffs(r, 'scBuffAlliesPctSelf').map((e) => e.source);
    expect(socSources[0], "the player's SoC fired first").toBe(playerDemon);
    expect(socSources).toContain(enemyDemon); // the enemy's did fire — just after
    const firstAttack = r.events.find((e) => e.type === 'attack') as unknown as { attacker: string };
    expect(firstAttack.attacker, 'yet the ENEMY held the first attack (bigger board)').toBe(enemyDemon);
  });

  it("G3 — mutual clash: the DEFENDER's Echo resolves before the attacker's (both directions)", () => {
    // Two Mama Pups (Echo: summon Pups) trade and both die in one clash. Outcome-bearing: whichever side's
    // Pups land first also ATTACKS first in the follow-up trades. RULE PINNED: defender-side death/Echo
    // first — checked in both directions to prove it keys on the defender, not on the player side.
    const runs: [string, Sim][] = [
      // enemy attacks (equal boards, seed 3 gives the enemy the swing) → the PLAYER is the defender
      ['enemy attacks', sim([bm('pack', 'P', 3, 2)], [bm('pack', 'E', 3, 2)], ['beast'])],
      // player attacks (bigger board) → the ENEMY is the defender
      ['player attacks', sim([bm('pack', 'P', 3, 2), bm('stray', 'S', 0, 30)], [bm('pack', 'E', 3, 2)], ['beast'])],
    ];
    for (const [name, r] of runs) {
      const first = r.events.find((e) => e.type === 'attack') as unknown as { attacker: string; defender: string };
      const defenderSide = r.initial.player.some((m) => m.uid === first.defender) ? 'player' : 'enemy';
      const [d0, d1] = deaths(r);
      expect(d0!.side, `${name}: the DEFENDER's death resolves first`).toBe(defenderSide);
      expect(d1!.side, `${name}: then the attacker's`).not.toBe(defenderSide);
      // and the defender's Echo summons land before the attacker's death is even logged
      const firstSummonIdx = r.events.findIndex((e) => e.type === 'summon');
      const secondDeathIdx = r.events.findIndex((e) => e.type === 'death' && (e as unknown as { target: string }).target === d1!.target);
      expect(firstSummonIdx, `${name}: defender's Echo fires before the attacker's death resolves`).toBeLessThan(secondDeathIdx);
      expect(summons(r)[0]!.side, `${name}: first summon belongs to the defender`).toBe(defenderSide);
    }
  });

  it('G4 — trigger insertion is DEPTH-FIRST: a watcher fired by a mid-resolution summon runs before the next queued death', () => {
    // A Cleave kills two 1-hp Mama Pups simultaneously while Beardsley (on-summon: +3/+3 to summoned Beasts,
    // improving +3 every 3) watches. Outcome-bearing twice over: (a) each Pup's Beardsley buff is INSERTED
    // right after its own summon — a breadth-first engine would resolve both deaths, then both Echoes, then
    // all buffs; (b) Beardsley's improve step advances MID-resolution, so the 4th Pup of the same simultaneous
    // wave gets +6/+6 while the first three get +3/+3. RULE PINNED: depth-first insertion, live improve steps.
    const r = sim(
      [bm('b2_beardsley', 'BD', 0, 9999), bm('pack', 'P1', 0, 1), bm('pack', 'P2', 0, 1)],
      [bm('babycub', 'CUB', 30, 9999, { keywords: ['C'] })], ['beast']);
    const [p1, p2] = [r.initial.player[1]!.uid, r.initial.player[2]!.uid];
    const pupBuffs = buffs(r, 'onSummonTribeBuffFlat').map((e) => e.attack);
    expect(pupBuffs, 'the improve step advanced on the 4th summon of the SAME wave').toEqual([3, 3, 3, 6]);
    // each summon is immediately followed by its own Beardsley buff (depth-first insertion)
    for (const s of summons(r)) {
      const at = r.events.indexOf(s as never);
      const nxt = r.events[at + 1] as unknown as { type: string; target?: string };
      expect(nxt.type, 'the on-summon watcher fires right behind its summon').toBe('buff');
      expect(nxt.target).toBe(s.minion.uid);
    }
    // and the LEFT Mama Pup's whole death resolution (Echo + buffs) completes before the right one's death
    const p2DeathIdx = r.events.findIndex((e) => e.type === 'death' && (e as unknown as { target: string }).target === p2);
    const p1Summons = summons(r).filter((s) => s.source === p1);
    expect(p1Summons.length).toBe(2);
    for (const s of p1Summons) expect(r.events.indexOf(s as never), "P1's Echo fully resolves before P2's death").toBeLessThan(p2DeathIdx);
  });

  it('G5 — simultaneous Avenge counters fire LEFT-TO-RIGHT', () => {
    // Two Endless Overseers (Avenge 4: summon an Imp) complete their counters on the same friendly death.
    // Outcome-bearing: with one board slot left, only the first-resolved Overseer's Imp exists at all.
    // RULE PINNED: same-trigger watchers resolve in board order, leftmost first.
    const r = sim(
      [bm('dm_overseer', 'O1', 0, 9999), bm('dm_overseer', 'O2', 0, 9999),
       bm('stray', 'S1', 1, 1), bm('stray', 'S2', 1, 1), bm('stray', 'S3', 1, 1), bm('stray', 'S4', 1, 1)],
      [bm('sandbag', 'W', 60, 40000)], ['demon']);
    const [o1, o2] = [r.initial.player[0]!.uid, r.initial.player[1]!.uid];
    const imps = summons(r).filter((s) => s.minion.cardId === 'impscrap');
    expect(imps.length, 'both Overseers completed Avenge(4)').toBe(2);
    expect(imps[0]!.source, 'the LEFT Overseer summons first').toBe(o1);
    expect(imps[1]!.source).toBe(o2);
    expect(imps[0]!.step, 'both counters completed on the SAME death (one step)').toBe(imps[1]!.step);
  });

  it("G6 — shop: on-summon auras apply BEFORE the played minion's own Battlecry resolves", () => {
    // Den Mother (on a Beast play: give it +2/+2, then improve by +2/+2) + Pennycat (Shout: summon a Stray).
    // Outcome-bearing: because the aura hits the PLAYED minion first and its grant improves per use, the
    // Battlecry-summoned Stray receives the IMPROVED +4/+4 while Pennycat itself got the base +2/+2. A
    // battlecry-first engine gives the Stray +2/+2 and Pennycat +4/+4 — same cards, different boards.
    // RULE PINNED: summon-buffs (fire 'onSummon') resolve before the Shout, and improve steps are live.
    let s: RunState = {
      ...createRun(1),
      setId: 'set1',
      tier: 6,
      embers: 30,
      shop: [],
      board: [{ uid: 'dm', cardId: 'mamabear', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false }],
      hand: [{ uid: 'pc', cardId: 'alley', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'pc' });
    const pennycat = s.board.find((c) => c.uid === 'pc')!;
    const strayToken = s.board.find((c) => c.cardId === 'stray')!;
    expect(pennycat.buffs, 'the played Beast took the BASE grant, before its own Shout ran').toEqual(
      [{ source: 'Den Mother', attack: 2, health: 2, count: 1 }]);
    expect(strayToken.buffs, 'the Shout-summoned token then took the IMPROVED grant').toEqual(
      [{ source: 'Den Mother', attack: 4, health: 4, count: 1 }]);
  });
});
