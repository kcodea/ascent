/**
 * DOC BOT LANE `interactionMatrix` — first-order INTERACTIONS: multipliers, additivity, random-target eligibility
 * (roadmap L4 + L6).
 *
 * History: the multiplier family is where the worst shipped bugs lived — #900 (Duplication no-op on 41
 * Epics), #897 "Echoes honour every Echo multiplier (Echohorn dropped Sylus entirely)", #4b2 "Paragon fires
 * per Rally trigger, including doublers", #594 "Uron's extra Rally fires count toward Rally quests". The
 * multiplier roster is enumerated from the `triggerMultiplier` def field — the same field whose existence
 * blinded the play lane's first control pick (Drakko), now serving as the worklist.
 *
 *   · MULTIPLIER × FAMILY: for each multiplier card and each family it claims, stage a representative and
 *     assert the multiplied outcome EXACTLY doubles the base grant (magnitude, not just presence).
 *   · ADDITIVITY (metamorphic, §19.3): two independent casts of a buff spell grant exactly 2× one cast.
 *   · ELIGIBILITY (§19.5): tribe-scoped RANDOM effects, across many seeds, may only ever touch eligible
 *     targets — an ineligible touch on ANY seed fails, deterministically.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from '../index';
import { isTribe } from '../recruit';

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};

const base = (board: BoardCard[]): RunState => ({
  ...createRun(0x14a7, 'aster'), embers: 60, board, hand: [], shop: [],
} as RunState);

describe('Doc Bot — interaction matrix', () => {
  it('BATTLECRY multipliers (Drakko/Zyff): a targeted Shout grants exactly (1+extra)× its params', () => {
    const multipliers = Object.values(CARD_INDEX).filter((c) => (c as { triggerMultiplier?: { families: string[] } })?.triggerMultiplier?.families.includes('battlecry'));
    expect(multipliers.length).toBeGreaterThanOrEqual(2); // Drakko + Zyff
    const rep = Object.values(CARD_INDEX).find((c) => c && !c.spell
      && c.effects.length === 1 && c.effects[0]!.on === 'onPlay' && c.effects[0]!.do === 'battlecryBuffTarget')!;
    const p = rep.effects[0]!.params as { attack?: number; health?: number };
    const tgtTribe = (rep as { targetTribe?: string }).targetTribe ?? 'beast';
    for (const m of multipliers) {
      // Either shape: `factor` for a "twice" multiplier, `1 + extra` for an "additional time" card
      // (owner wording rule 2026-08-28). One multiplier on the board, so its declared factor IS the total.
      const tm = (m as { triggerMultiplier: { extra?: number; factor?: number } }).triggerMultiplier;
      const mult = tm.factor ?? 1 + (tm.extra ?? 0);
      const s0 = base([card('tgt', 'pup', { tribe: tgtTribe as never }), card('mult', m!.id)]);
      let s1 = reduce({ ...s0, hand: [card('rep', rep.id)] }, { type: 'play', uid: 'rep' });
      if (s1.pendingTarget) s1 = reduce(s1, { type: 'battlecryTarget', targetUid: 'tgt' });
      const t = s1.board.find((c) => c.uid === 'tgt')!;
      expect([t.attack - 1, t.health - 1],
        `${m!.id} claims Battlecries fire ${mult}×: ${rep.id}'s +${p.attack}/+${p.health} should land as +${(p.attack ?? 0) * mult}/+${(p.health ?? 0) * mult}, landed +${t.attack - 1}/+${t.health - 1}`)
        .toEqual([(p.attack ?? 0) * mult, (p.health ?? 0) * mult]);
    }
  });

  it('DEATHRATTLE multipliers (Sylus/Zyff): an Echo summon produces exactly (1+extra)× its count in combat', () => {
    const multipliers = Object.values(CARD_INDEX).filter((c) => (c as { triggerMultiplier?: { families: string[] } })?.triggerMultiplier?.families.includes('deathrattle'));
    expect(multipliers.length).toBeGreaterThanOrEqual(2); // Sylus + Zyff
    const rep = Object.values(CARD_INDEX).find((c) => c && !c.spell
      && c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon' && !(e.params as { fixed?: boolean }).fixed))!;
    const eff = rep.effects.find((e) => e.do === 'deathrattleSummon')!;
    const tokenId = (eff.params as { tokenId: string }).tokenId;
    const count = (eff.params as { count?: number }).count ?? 1;
    const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion =>
      ({ cardId, attack, health, sourceUid: uid, keywords: [] } as unknown as BoardMinion);
    for (const m of multipliers) {
      const extra = (m as { triggerMultiplier: { extra: number } }).triggerMultiplier.extra;
      // The multiplier survives on huge health while the rep dies immediately.
      const r = simulate([bm(rep.id, 'pS', 1, 1), bm(m!.id, 'pM', 1, 30)], [bm('cryptwolf', 'e0', 9, 60)],
        makeRng(5), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 5 }));
      const summoned = r.events.filter((e) => (e as { type?: string }).type === 'summon'
        && (e as { minion?: { cardId?: string } }).minion?.cardId === tokenId).length;
      expect(summoned, `${m!.id} claims Echoes fire ${1 + extra}×: ${rep.id}'s ${count} summons should become ${count * (1 + extra)}, combat summoned ${summoned} (the Echohorn-dropped-Sylus class, #897)`)
        .toBe(count * (1 + extra));
    }
  });

  it('ADDITIVITY: casting a buff spell twice grants exactly 2× one cast (metamorphic, §19.3)', () => {
    const spell = Object.values(CARD_INDEX).find((c) => c?.spell && !c.singleCast
      && c.effects.length === 1 && c.effects[0]!.on === 'cast' && c.effects[0]!.do === 'spellBuffTarget')!;
    const castOnce = (s: RunState, uid: string): RunState =>
      reduce({ ...s, hand: [...s.hand, { uid, cardId: spell.id, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false } as BoardCard] },
        { type: 'play', uid, targetUid: 'tgt' });
    const s0 = base([card('tgt', 'pup')]);
    const once = castOnce(s0, 'c1');
    const twice = castOnce(once, 'c2');
    const d1 = [once.board[0]!.attack - 1, once.board[0]!.health - 1];
    const d2 = [twice.board[0]!.attack - 1, twice.board[0]!.health - 1];
    expect(d2, `${spell.id}: two casts granted [${d2}] where one granted [${d1}] — independent sources must sum`).toEqual([d1[0]! * 2, d1[1]! * 2]);
  });

  it('ELIGIBILITY: tribe-scoped RANDOM effects touch only eligible targets, across 10 seeds (§19.5)', () => {
    // The Baby Gastrid / Resonance class: a random pick whose pool filter forgets the tribe (or all-types).
    // Board: one of each tribe; play each random-tribe battlecry across seeds; only tribe members (or self)
    // may change.
    const users = Object.values(CARD_INDEX).filter((c) => c && !c.spell
      && c.effects.some((e) => e.on === 'onPlay' && /Random/i.test(e.do) && typeof (e.params as { tribe?: string }).tribe === 'string'));
    const tribes = ['beast', 'demon', 'dragon', 'dwarf', 'kobold', 'undead'];
    for (const def of users) {
      const tribe = (def!.effects.find((e) => /Random/i.test(e.do))!.params as { tribe: string }).tribe;
      for (let seed = 0; seed < 10; seed++) {
        const board = tribes.map((t, i) => card(`b${i}`, 'pup', { tribe: t as never }));
        const s0 = { ...base(board), rngCursor: seed * 977 } as RunState;
        let s1 = reduce({ ...s0, hand: [card('m', def!.id)] }, { type: 'play', uid: 'm' });
        if (s1.pendingTarget) s1 = reduce(s1, { type: 'battlecryTarget', targetUid: board.find((b) => isTribe(b, tribe as never))?.uid ?? 'b0' });
        for (const b of s1.board) {
          if (b.uid === 'm') continue;
          const before = board.find((x) => x.uid === b.uid);
          if (!before) continue;
          const changed = b.attack !== before.attack || b.health !== before.health;
          if (changed) {
            expect(isTribe(b, tribe as never),
              `${def!.id} (seed ${seed}): random ${tribe}-buff touched ${b.uid} (tribe ${b.tribe}) — an INELIGIBLE target (the Gastrid/Resonance class)`).toBe(true);
          }
        }
      }
    }
    expect(users.length).toBeGreaterThanOrEqual(1); // surface check
  });
});
