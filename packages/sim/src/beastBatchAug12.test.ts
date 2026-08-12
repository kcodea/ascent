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

  it('a Wolvie that RISES consumes its own queued buff (a Rise is a summon)', () => {
    // Regression (owner report 2026-08-12): Wolvie with Rise dies → its Echo queues +2/+4 → the risen body IS
    // the next Beast summoned, so it must take the buff. The Rise re-slot used to bypass the summon chokepoint.
    const r = sim([bm('b2_wolvie', 'W', 3, 2, { keywords: ['R'] })]);
    expect(buffsOn(r, uidOf(r, 'b2_wolvie'), 'Wolvie').map((b) => [b.attack, b.health]), 'the risen Wolvie got +2/+4')
      .toContainEqual([2, 4]);
  });

  it('multiple Wolvie Echoes STACK onto the next single summon (owner 2026-08-12)', () => {
    // Two Taunt Wolvies die first (each queues +2/+4); then Pack Leader dies and summons a Pup — the Pup takes
    // BOTH at once (+4/+8), and the queue is then spent (still the next summon only, just summed).
    const r = sim([bm('b2_wolvie', 'W1', 3, 1, { keywords: ['T'] }), bm('b2_wolvie', 'W2', 3, 1, { keywords: ['T'] }), bm('pack', 'P', 2, 1)]);
    const pup = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[]).find((e) => e.minion.cardId === 'pup');
    expect(pup, 'a Pup spawned').toBeDefined();
    expect(buffsOn(r, pup!.minion.uid, 'Wolvie').map((b) => [b.attack, b.health]), 'both Echoes on one Pup').toContainEqual([4, 8]);
  });
});

// ── Rune of the Zoo (Beardsley's summon buff scales with the running combat-summon count) ─────────────────
describe('Rune of the Zoo — Beardsley scales with the combat-summon count', () => {
  const beardsleyBuffs = (r: ReturnType<typeof simulate>, bUid: string) =>
    (r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === bUid) as { attack: number }[]).map((b) => b.attack);

  it('the 1st combat summon gets +6, the 2nd +12, … (Pack Leader summons 2 Pups)', () => {
    const r = sim([bm('b2_beardsley', 'B', 5, 9999), bm('pack', 'P', 2, 1)], { runeZoo: true });
    const buffs = beardsleyBuffs(r, uidOf(r, 'b2_beardsley'));
    expect(buffs, 'ordinal 1 → +6').toContain(6);
    expect(buffs, 'ordinal 2 → +12').toContain(12);
  });

  it('without the rune, every summon gets a flat +6 (no scaling)', () => {
    const r = sim([bm('b2_beardsley', 'B', 5, 9999), bm('pack', 'P', 2, 1)]);
    const buffs = beardsleyBuffs(r, uidOf(r, 'b2_beardsley'));
    expect(buffs.every((a) => a === 6), 'all +6, no ordinal scaling').toBe(true);
    expect(buffs).not.toContain(12);
  });

  it('gilded Beardsley composes with the ordinal (×2 × N)', () => {
    const r = sim([bm('b2_beardsley', 'B', 5, 9999, { golden: true }), bm('pack', 'P', 2, 1)], { runeZoo: true });
    const buffs = beardsleyBuffs(r, uidOf(r, 'b2_beardsley'));
    expect(buffs, 'ordinal 1 × gild → +12').toContain(12);
    expect(buffs, 'ordinal 2 × gild → +24').toContain(24);
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

// ── Dunkey avenge audit (owner report 2026-08-12) ─────────────────────────────────────────────────────────
describe('Dunkey — avenge counting includes its own summons', () => {
  it("a summoned Armadiyo's death counts toward the next Avenge(4); every threshold fires with board room", () => {
    // With headroom (5-wide board), every multiple of 4 friendly deaths must produce exactly one Armadiyo —
    // including thresholds reached BY a summoned Armadiyo dying. (On a FULL board the payout is dropped by the
    // board-cap rule — owner ruling 2026-08-12: "this is the correct rule" — but the tally itself never skips.)
    const r = sim([
      bm('b2_dunkey', 'D', 0, 999999),
      ...Array.from({ length: 4 }, (_, i) => bm('pack', `p${i}`, 2, 1)),
    ], {}, 7);
    const deaths = r.events.filter((e) => e.type === 'death' && (e as { side?: string }).side === 'player').length;
    const armadiyos = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'b2_armadiyo').length;
    expect(deaths, 'enough deaths to cross several thresholds').toBeGreaterThanOrEqual(8);
    expect(armadiyos, 'one Armadiyo per 4 deaths — no threshold skipped').toBe(Math.floor(deaths / 4));
  });
});

// ── Summon-entry ORDER (owner ruling 2026-08-12): auras FIRST, then augmenters left→right ─────────────────
describe('summon-entry order — auras land before the augmenting triggers', () => {
  it("the owner's worked example: Grim aura → 8/10 Cub, THEN Oona doubles the post-aura Attack", () => {
    // Grim (1/1) dies first (leftmost, dies to the wall's retaliation) → +8/+8 Beast aura armed. Void Panther
    // dies → 0/2 Void Cub arrives → aura first (8/10) → Oona doubles its POST-aura Attack: +8/+0. Under the
    // old order Oona read the pre-aura 0-Attack body and granted nothing at all.
    const r = sim([
      bm('grim', 'G', 1, 1), bm('manasaber', 'VP', 4, 1), bm('b2_oona', 'O', 0, 999999),
    ], {}, 3);
    const cub = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[])
      .find((e) => e.minion.cardId === 'sabercub');
    expect(cub, 'a Void Cub spawned').toBeDefined();
    const cubBuffs = buffsOn(r, cub!.minion.uid);
    const grimUid = uidOf(r, 'grim');
    const oonaUid = uidOf(r, 'b2_oona');
    expect(cubBuffs.some((b) => b.source === grimUid && b.attack === 8 && b.health === 8), 'Grim aura +8/+8').toBe(true);
    expect(cubBuffs.some((b) => b.source === oonaUid && b.attack === 8 && b.health === 0), 'Oona doubled the POST-aura 8 Attack').toBe(true);
  });

  it('Rune of the Jungle doubles the POST-aura Health too', () => {
    const r = sim([bm('grim', 'G', 1, 1), bm('manasaber', 'VP', 4, 1)], { runeJungle: true }, 3);
    const cub = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[])
      .find((e) => e.minion.cardId === 'sabercub');
    expect(cub).toBeDefined();
    // Cub 0/2 + Grim aura 8/8 → 8/10 → the Jungle doubles the post-aura 10 Health, not the printed 2.
    expect(buffsOn(r, cub!.minion.uid, 'Rune of the Jungle').some((b) => b.health === 10), 'doubled 10, not 2').toBe(true);
  });

  it('onSummon watchers fire in CURRENT board order, left→right (Beardsley vs Oona)', () => {
    // Pack Leader's Echo Pup (1/1). Beardsley LEFT of Oona: +6/+6 first → Oona doubles 7 Attack (+7).
    // Oona LEFT of Beardsley: Oona doubles 1 Attack (+1) → then +6/+6. The Oona buff amount is the tell.
    const oonaGrant = (board: BoardMinion[]): number => {
      const r = sim(board, {}, 2);
      const pup = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[])
        .find((e) => e.minion.cardId === 'pup')!;
      const oonaUid = uidOf(r, 'b2_oona');
      return buffsOn(r, pup.minion.uid).find((b) => b.source === oonaUid)?.attack ?? 0;
    };
    expect(oonaGrant([bm('b2_beardsley', 'B', 0, 999999), bm('b2_oona', 'O', 0, 999999), bm('pack', 'P', 2, 1)]),
      'Beardsley first: Oona doubles the buffed 7').toBe(7);
    expect(oonaGrant([bm('b2_oona', 'O', 0, 999999), bm('b2_beardsley', 'B', 0, 999999), bm('pack', 'P', 2, 1)]),
      'Oona first: it doubles the bare 1').toBe(1);
  });
});

// ── Rise IS a summon, in full (owner ruling 2026-08-12) ───────────────────────────────────────────────────
describe('Rise fires the full summon-entry suite', () => {
  it('a risen Beast triggers onSummon watchers (Beardsley buffs it)', () => {
    // A 0/1 Rise Beast dies to the wall and returns; Beardsley (immortal) must buff the RISEN body +6/+6 —
    // the onSummon bus now fires on Rise (it used to be quest-tally-only).
    const r = sim([bm('b2_beardsley', 'B', 0, 999999), bm('alley', 'A', 0, 1, { keywords: ['R'] })]);
    const beardsleyUid = uidOf(r, 'b2_beardsley');
    const risenUid = uidOf(r, 'alley');
    const got = (r.events.filter((e) => e.type === 'buff') as { target: string; source: string; attack: number; health: number }[])
      .some((b) => b.target === risenUid && b.source === beardsleyUid && b.attack === 6 && b.health === 6);
    expect(got, 'the risen Beast took Beardsley +6/+6').toBe(true);
  });

  it('a Rise advances the Zoo ordinal (the summon AFTER a Rise reads one step higher)', () => {
    // With Rune of the Zoo: the Rise is summon #1 (its own Beardsley buff is +6), and a Pup summoned later is
    // summon #2 → +12. Without the Rise counting, the Pup would read +6.
    const r = sim([
      bm('b2_beardsley', 'B', 0, 999999),
      bm('alley', 'A', 0, 1, { keywords: ['R'] }), // dies + rises first (summon #1), then dies for good
      bm('pack', 'P', 2, 1), // its Echo Pup lands after → summon #2
    ], { runeZoo: true });
    const beardsleyUid = uidOf(r, 'b2_beardsley');
    const buffsBy = (r.events.filter((e) => e.type === 'buff') as { source: string; attack: number }[])
      .filter((b) => b.source === beardsleyUid).map((b) => b.attack);
    expect(buffsBy, 'the Rise took the ordinal-1 grant').toContain(6);
    expect(buffsBy, 'a later summon reads one ordinal higher because the Rise counted').toContain(12);
  });

  it('a risen Beast doubles under Rune of the Jungle (summon-scoped runes reach a Rise)', () => {
    // Rise returns at 1 Health; the Jungle doubles it (+0/+1 buff on the risen body).
    const r = sim([bm('alley', 'A', 3, 1, { keywords: ['R'] })], { runeJungle: true });
    const risen = uidOf(r, 'alley');
    const got = (r.events.filter((e) => e.type === 'buff') as { target: string; source: string; health: number }[])
      .some((b) => b.target === risen && b.source === 'Rune of the Jungle' && b.health === 1);
    expect(got, 'the risen body doubled its 1 Health').toBe(true);
  });
});
