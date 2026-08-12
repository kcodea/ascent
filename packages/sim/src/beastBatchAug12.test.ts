import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';
import { CARD_INDEX } from '@game/content';

const bm = (cardId: string, uid: string, attack = 2, health = 20, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });
const wall = { cardId: 'sandbag', attack: 60, health: 40000 };
const sim = (player: BoardMinion[], mods: QuestCombatMods = {}, seed = 3) =>
  simulate(player, [wall], makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'], questMods: mods }), combatSide({ tier: 1 }));
const uidOf = (r: ReturnType<typeof simulate>, cardId: string) => r.initial.player.find((m) => m.cardId === cardId)!.uid;
const buffsOn = (r: ReturnType<typeof simulate>, uid: string, source?: string) =>
  (r.events.filter((e) => e.type === 'buff') as { target: string; attack: number; health: number; source: string }[])
    .filter((b) => b.target === uid && (!source || b.source === source));
const summonsBy = (r: ReturnType<typeof simulate>, uid: string) =>
  (r.events.filter((e) => e.type === 'summon' && (e as { source?: string }).source === uid) as { minion: { cardId: string; golden?: boolean } }[]);

// ── Wolvie (T2 Beast, Echo: the next Beast you summon gets +2/+4) ──────────────────────────────────────────
describe('Wolvie — Echo buffs the next summoned Beast', () => {
  it('the next Beast summoned after Wolvie dies gets +2/+4 (gilded +4/+8)', () => {
    // Wolvie (Taunt, 1 hp) dies first; then a Pack Leader dies and its Echo summons a Pup — the Pup takes the
    // queued buff. Asserted via the 'Wolvie' buff on the summoned Pup.
    const run = (golden: boolean) => sim([bm('b2_wolvie', 'W', 3, 1, golden ? { golden: true } : {}), bm('pack', 'P', 2, 1)]);
    const pupBuff = (r: ReturnType<typeof simulate>) => {
      const pup = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[]).find((e) => e.minion.cardId === 'pup');
      return pup ? buffsOn(r, pup.minion.uid, 'Wolvie').map((b) => [b.attack, b.health]) : [];
    };
    expect(pupBuff(run(false)), 'the next Beast got +2/+4').toContainEqual([2, 4]);
    expect(pupBuff(run(true)), 'gilded Wolvie +4/+8').toContainEqual([4, 8]);
  });
});

// ── Armadiyo (T4 Beast, Echo: give your Beasts +2/+4 wherever they are) ────────────────────────────────────
describe('Armadiyo — Echo buffs your Beasts wherever they are', () => {
  it('buffs living Beasts +2/+4 and later summons too (gilded +4/+8)', () => {
    const run = (golden: boolean) => sim([bm('b2_armadiyo', 'A', 5, 1, golden ? { golden: true } : {}), bm('pack', 'P', 2, 1)]);
    const r = run(false);
    // A Pup summoned by Pack Leader AFTER Armadiyo dies still inherits the aura. `deathrattleBuffTribe` sources
    // the buff by the granter's uid, so match on the amount rather than a source name.
    const pup = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[]).find((e) => e.minion.cardId === 'pup');
    expect(pup, 'a Pup spawned').toBeDefined();
    expect(buffsOn(r, pup!.minion.uid).map((b) => [b.attack, b.health])).toContainEqual([2, 4]);
    const g = run(true);
    const gpup = (g.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[]).find((e) => e.minion.cardId === 'pup');
    expect(buffsOn(g, gpup!.minion.uid).map((b) => [b.attack, b.health])).toContainEqual([4, 8]);
  });
});

// ── Dunkey (T5 Beast, Avenge (4): summon an Armadiyo) ─────────────────────────────────────────────────────
describe('Dunkey — Avenge (4) summons an Armadiyo', () => {
  it('every 4 friendly deaths summons an Armadiyo (gilded → gilded Armadiyo)', () => {
    const run = (golden: boolean) => sim([
      bm('b2_dunkey', 'D', 0, 9999, golden ? { golden: true } : {}),
      bm('sandbag', 'a', 0, 1), bm('sandbag', 'b', 0, 1), bm('sandbag', 'c', 0, 1), bm('sandbag', 'd', 0, 1),
    ]);
    const r = run(false);
    const armas = summonsBy(r, uidOf(r, 'b2_dunkey')).filter((e) => e.minion.cardId === 'b2_armadiyo');
    expect(armas.length, 'one Armadiyo per Avenge(4)').toBe(1);
    expect(armas[0]!.minion.golden ?? false, 'plain Dunkey → plain Armadiyo').toBe(false);
    const g = run(true);
    const garmas = summonsBy(g, uidOf(g, 'b2_dunkey')).filter((e) => e.minion.cardId === 'b2_armadiyo');
    expect(garmas[0]!.minion.golden, 'gilded Dunkey → gilded Armadiyo').toBe(true);
  });
});

// ── Voidmother (rune-only T6 Beast, Echo: summon a Void Panther) ──────────────────────────────────────────
describe('Voidmother — Echo summons a Void Panther', () => {
  it('summons a Void Panther on death (gilded summons 2)', () => {
    const r = sim([bm('b2_voidmother', 'V', 6, 1)]);
    expect(summonsBy(r, uidOf(r, 'b2_voidmother')).filter((e) => e.minion.cardId === 'manasaber').length).toBe(1);
    const g = sim([bm('b2_voidmother', 'V', 6, 1, { golden: true })]);
    expect(summonsBy(g, uidOf(g, 'b2_voidmother')).filter((e) => e.minion.cardId === 'manasaber').length).toBe(2);
  });
});

// ── Rune of the Jungle (a summoned Beast doubles its Health) ──────────────────────────────────────────────
describe('Rune of the Jungle — a summoned Beast doubles its Health', () => {
  it('a 1/1 Pup summoned in combat gains +0/+1 (doubled Health), only with the rune', () => {
    const withRune = sim([bm('pack', 'P', 2, 1)], { runeJungle: true });
    const pup = (withRune.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[]).find((e) => e.minion.cardId === 'pup');
    expect(pup, 'a Pup spawned').toBeDefined();
    expect(buffsOn(withRune, pup!.minion.uid, 'Rune of the Jungle').map((b) => [b.attack, b.health])).toContainEqual([0, 1]);
    const without = sim([bm('pack', 'P', 2, 1)]);
    const pup2 = (without.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[]).find((e) => e.minion.cardId === 'pup');
    expect(buffsOn(without, pup2!.minion.uid, 'Rune of the Jungle')).toHaveLength(0);
  });
});

// ── Rune of the Burrow (first Echo-Beast death is resummoned without its Echo) ────────────────────────────
describe('Rune of the Burrow — first Echo-Beast is resummoned without Echo', () => {
  it('resummons the dying Echo-Beast once, and the copy has no Echo', () => {
    // Void Panther (manasaber) has an Echo (summon 2 cubs). With Burrow it is resummoned when it dies — the
    // resummon is a summon of manasaber sourced from the dying body's uid. Exactly once (once-per-combat).
    const r = sim([bm('manasaber', 'VP', 4, 1)], { runeBurrow: true });
    const resummons = summonsBy(r, uidOf(r, 'manasaber')).filter((e) => e.minion.cardId === 'manasaber');
    expect(resummons.length, 'Burrow resummoned the Void Panther exactly once').toBe(1);
    const without = sim([bm('manasaber', 'VP', 4, 1)]);
    expect(summonsBy(without, uidOf(without, 'manasaber')).filter((e) => e.minion.cardId === 'manasaber').length).toBe(0);
  });
});

// ── Rune of Beastial Swarm (Beasts +N/+N on each friendly Beast death; Avenge(2) raises N, run-persisted) ──
describe('Rune of Beastial Swarm — per-death buff + Avenge(2) improvement', () => {
  it('surviving Beasts gain +2/+2 per Beast death, and Avenge(2) raises the level (carried back)', () => {
    // Two 0/1 Beasts die to the wall; a tanky survivor takes +2/+2 twice (level 2 for both deaths — the
    // improvement lands AFTER the 2nd death's buff). After 2 friendly deaths, the level rises to 4 and rides
    // the `playerBeastialSwarmLevel` carry-back.
    const r = sim([
      bm('alley', 'x', 0, 1), bm('alley', 'y', 0, 1), bm('pack', 'S', 0, 9999999),
    ], { runeBeastialSwarm: true, beastialSwarmLevel: 2 });
    const got = buffsOn(r, uidOf(r, 'pack'), 'Rune of Beastial Swarm');
    const total = got.reduce((n, b) => n + b.attack, 0);
    expect(total, 'the survivor gained +2 per Beast death (two deaths → +4)').toBe(4);
    expect(r.playerBeastialSwarmLevel, 'the Avenge(2) improvement carries back as level 4').toBe(4);
  });

  it('a HIGHER seeded level pays out bigger and keeps climbing', () => {
    const r = sim([
      bm('alley', 'x', 0, 1), bm('alley', 'y', 0, 1), bm('pack', 'S', 0, 9999999),
    ], { runeBeastialSwarm: true, beastialSwarmLevel: 6 });
    const total = buffsOn(r, uidOf(r, 'pack'), 'Rune of Beastial Swarm').reduce((n, b) => n + b.attack, 0);
    expect(total, 'two deaths at level 6').toBe(12);
    expect(r.playerBeastialSwarmLevel, 'level 6 → 8 after the Avenge(2)').toBe(8);
  });
});

// ── Kennelmaster — Avenge changed 3 → 4 ──────────────────────────────────────────────────────────────────
describe('Kennelmaster — Avenge (4)', () => {
  it('the avenge effect fires on the 4th friendly death now', () => {
    const eff = CARD_INDEX['kennel']!.effects.find((e) => e.do === 'avengeImproveSummon');
    expect(eff?.params?.count).toBe(4);
  });
});
