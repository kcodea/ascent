/**
 * R-BROOD-01 (owner 2026-11-22): Brood Matron's "(Max 3 Imps per combat.)" counts down live on the combat card. The
 * text derives the Imps it has used from the replay's Avenge count, so these pin (1) the helper's arithmetic and
 * (2) that the arithmetic agrees with what the engine really summoned, at every point of a fight, plain and gilded,
 * and across a Rebirth return.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { avengeSummonCapText } from './cardText';
import { liveCardText } from './instView';
import { computeFrame } from './useCombatReplay';

const m = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack: 0, health: 1, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], golden: false, ...over } as unknown as BoardMinion);

describe('avengeSummonCapText', () => {
  const text = CARD_INDEX['brood']!.text;
  it('prints the card as written before the first Avenge and outside a fight', () => {
    expect(avengeSummonCapText('brood', false, undefined)).toBeNull();
    expect(avengeSummonCapText('brood', false, 0)).toBeNull();
    expect(avengeSummonCapText('brood', false, 1)).toBeNull();
    expect(text).toContain('(Max 3 Imps per combat.)');
  });
  it('counts down one Imp per Avenge (2), to 0', () => {
    expect(avengeSummonCapText('brood', false, 2)).toContain('{{(2 Imps left this combat)}}');
    expect(avengeSummonCapText('brood', false, 3)).toContain('{{(2 Imps left this combat)}}');
    expect(avengeSummonCapText('brood', false, 4)).toContain('{{(1 Imp left this combat)}}');
    expect(avengeSummonCapText('brood', false, 6)).toContain('{{(0 Imps left this combat)}}');
    expect(avengeSummonCapText('brood', false, 40)).toContain('{{(0 Imps left this combat)}}');
    expect(avengeSummonCapText('brood', false, 4)).not.toContain('Max 3');
  });
  it('gilded: 6 Imps, two per Avenge', () => {
    expect(avengeSummonCapText('brood', true, 2)).toContain('{{(4 Imps left this combat)}}');
    expect(avengeSummonCapText('brood', true, 6)).toContain('{{(0 Imps left this combat)}}');
    expect(avengeSummonCapText('brood', true, 2)).toContain('Summon **2** **Imps**');
  });
  it('is null for any other card', () => {
    expect(avengeSummonCapText('impking', false, 6)).toBeNull();
    expect(avengeSummonCapText('d3_whaloo', false, 6)).toBeNull();
  });
  it('reaches the card through the shared live-text chain, with the Imp stats still annotated', () => {
    const live = liveCardText('brood', { tier: 3, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, avengeSeen: 4, impAura: { attack: 2, health: 2 } } as Parameters<typeof liveCardText>[1]);
    expect(live.text).toContain('{{(1 Imp left this combat)}}');
    expect(live.text).toContain('{{(3/3)}}');
  });
});

describe('the live count agrees with the engine at every event', () => {
  const enemy = (): BoardMinion[] => [m('omen', { attack: 100, health: 10_000_000, keywords: [] })];
  const check = (golden: boolean, keywords: string[], health: number, seed: number): { returned: boolean; spent: boolean } => {
    const side = [m('brood', { health, golden, keywords } as Partial<BoardMinion>), ...Array.from({ length: 6 }, () => m('sandbag'))];
    const r = simulate(side, enemy(), makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const names = new Map([...r.initial.player, ...r.initial.enemy].map((x) => [x.uid, x.name]));
    const uid = r.initial.player[0]!.uid;
    const cap = golden ? 6 : 3;
    let life = 0; // Imps this body has summoned since it last returned
    let returned = false, spent = false;
    r.events.forEach((e, i) => {
      if (e.type === 'reborn' && e.target === uid) { life = 0; returned = true; }
      if (e.type === 'summon' && e.minion.cardId === 'impscrap' && e.source === uid) life += 1;
      expect(life, `event ${i}: never past the cap`).toBeLessThanOrEqual(cap);
      if (life === cap) spent = true;
      const u = computeFrame(r.initial, r.events, i + 1, i + 1, names).player.find((x) => x.uid === uid);
      if (!u || !u.alive) return; // a dead Matron prints nothing live
      // The summon lands a few events after the death that completed the Avenge, so the text may be one Avenge
      // ahead of the board for that instant, never behind and never further ahead.
      const t = avengeSummonCapText('brood', golden, u.avengeSeen);
      const shown = t === null ? cap : Number(/\((\d+) Imps? left this combat\)/.exec(t)![1]);
      const used = cap - shown;
      expect(used, `event ${i} (${e.type}): text never behind the engine`).toBeGreaterThanOrEqual(life);
      expect(used - life, `event ${i} (${e.type}): at most one Avenge ahead`).toBeLessThanOrEqual(golden ? 2 : 1);
    });
    // At rest (the fight's last frame) the two agree exactly.
    const last = computeFrame(r.initial, r.events, r.events.length, r.events.length, names).player.find((x) => x.uid === uid);
    if (last?.alive) {
      const t = avengeSummonCapText('brood', golden, last.avengeSeen);
      expect(cap - (t === null ? cap : Number(/\((\d+) Imps? left/.exec(t)![1]))).toBe(life);
    }
    return { returned, spent };
  };

  it('plain and gilded, a Matron that never dies', () => {
    for (const seed of [1, 2, 3]) {
      expect(check(false, [], 5_000_000, seed).spent, `plain seed ${seed}`).toBe(true);
      expect(check(true, [], 5_000_000, seed).spent, `gilded seed ${seed}`).toBe(true);
    }
  });

  it('a Matron that returns through Rebirth: the count restarts with the body', () => {
    let returned = 0;
    for (let seed = 1; seed <= 30; seed++) if (check(false, ['T', 'RB'], 250, seed).returned) returned += 1;
    expect(returned).toBeGreaterThan(0);
  });
});
