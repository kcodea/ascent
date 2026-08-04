import { describe, it, expect } from 'vitest';
import { ALL_CARDS, CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';

/**
 * A spell that cannot do anything must FIZZLE — stay in hand, spend no Gold (owner audit 2026-08-03,
 * "Deep Delve Writ with no dwarves in shop").
 *
 * The sweep at the bottom is the audit itself, kept as a REGRESSION GUARD: it re-derives the finding rather
 * than trusting a list, so a newly-added spell that can whiff fails here instead of shipping.
 */

const spell = (id: string): BoardCard =>
  ({ uid: 'sp', cardId: id, tribe: CARD_INDEX[id]?.tribe ?? 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const body = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 3, health: 3, keywords: [], golden: false });

const kept = (s: RunState): boolean => s.hand.some((c) => c.uid === 'sp');

describe('the named cases from the audit', () => {
  it('Deep Delve Writ fizzles with no Dwarf in the shop, and casts when there is one', () => {
    const barren: RunState = { ...createRun(5), board: [], shop: [], embers: 30, hand: [spell('deepdelvewrit')] };
    const after = reduce(barren, { type: 'play', uid: 'sp' });
    expect(after, 'no Dwarf → refused outright').toBe(barren);
    expect(kept(after)).toBe(true);

    // …and it still WORKS when the tribe is present — a guard that never lets the spell cast is worse than none.
    const dwarf = ALL_CARDS.find((c) => !c.spell && !c.token && (c.tribe === 'dwarf' || c.tribe2 === 'dwarf'))!;
    const ok: RunState = {
      ...createRun(5), board: [], embers: 30, hand: [spell('deepdelvewrit')],
      shop: [{ uid: 'o1', cardId: dwarf.id, cost: 3 } as never],
    };
    const cast = reduce(ok, { type: 'play', uid: 'sp' });
    expect(kept(cast), 'a Dwarf IS present — this must cast').toBe(false);
  });

  it('Growth fizzles on an empty board but casts with a minion', () => {
    const empty: RunState = { ...createRun(5), board: [], shop: [], embers: 30, hand: [spell('growth')] };
    expect(kept(reduce(empty, { type: 'play', uid: 'sp' }))).toBe(true);
    const full: RunState = { ...empty, board: [body('m', 'sandbag')] };
    expect(kept(reduce(full, { type: 'play', uid: 'sp' }))).toBe(false);
  });

  it('Mend fizzles at full Resolve and casts when hurt', () => {
    const s: RunState = { ...createRun(5), board: [], shop: [], embers: 30, hand: [spell('mend')] };
    expect(kept(reduce(s, { type: 'play', uid: 'sp' })), 'no overhealing').toBe(true);
    const hurt: RunState = { ...s, resolve: s.maxResolve - 5 };
    expect(kept(reduce(hurt, { type: 'play', uid: 'sp' }))).toBe(false);
  });

  it('Insurance Policy fizzles unless you actually lost the last combat', () => {
    const s: RunState = { ...createRun(5), board: [], shop: [], embers: 30, hand: [spell('insurancepolicy')] };
    expect(kept(reduce(s, { type: 'play', uid: 'sp' })), 'no prior loss → refused').toBe(true);
    const lost: RunState = { ...s, lastCombat: { result: 'lose', events: [], playerDamage: 0, initial: { player: [], enemy: [] } } as never };
    expect(kept(reduce(lost, { type: 'play', uid: 'sp' }))).toBe(false);
  });

  it('Ossuary Rite fizzles on a body with no Echo', () => {
    const noEcho: RunState = {
      ...createRun(5), shop: [], embers: 30, hand: [spell('ossuaryrite')], board: [body('tg', 'sandbag')],
    };
    expect(kept(reduce(noEcho, { type: 'play', uid: 'sp', targetUid: 'tg' }))).toBe(true);
    const echoCard = ALL_CARDS.find((c) => !c.spell && !c.token && c.effects.some((e) => e.on === 'onDeath'))!;
    const withEcho: RunState = { ...noEcho, board: [body('tg', echoCard.id)] };
    expect(kept(reduce(withEcho, { type: 'play', uid: 'sp', targetUid: 'tg' }))).toBe(false);
  });

  it('Tribes Choice fizzles on a NEUTRAL body (no type to fetch)', () => {
    const s: RunState = {
      ...createRun(5), shop: [], embers: 30, hand: [spell('tribeschoice')], board: [body('tg', 'sandbag')],
    };
    expect(kept(reduce(s, { type: 'play', uid: 'sp', targetUid: 'tg' }))).toBe(true);
  });
});

describe('the audit sweep, kept as a regression guard', () => {
  /** Bookkeeping that moves on EVERY cast — not evidence the spell's own effect did anything. */
  const NOISE = new Set([
    'hand', 'playedThisTurn', 'spellsThisTurn', 'spellsCast', 'rngCursor', 'uidSeq',
    'lastSpellThisTurnId', 'firstSpellThisTurnId', 'lastSpellCastId', 'cardsPlayedTotal', 'cardsPlayedThisTurn',
    'recruitBuffFx', 'auraFx', 'auraFxSeq', 'weldFxBaseSeq', 'weldFxSeq', 'buffFx', 'buffFxSeq',
    'lastShoutFires', 'lastEchoFires', 'lastEotFires', 'questTendrilFx', 'fodderEaten', 'shopEaten',
    'spellCastFx', 'spellCastFxSeq',
  ]);
  // `hand` is only PARTLY noise: the cast card leaving is expected, but cards ARRIVING is the whole effect of
  // half the economy spells (Ruby Shipment, On the House), so compare the hand MINUS the played card.
  const sig = (s: RunState): string => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) if (!NOISE.has(k) && v !== undefined) o[k] = v;
    o.handRest = s.hand.filter((c) => c.uid !== 'sp').map((c) => c.cardId).sort();
    return JSON.stringify(o);
  };

  it('NO untargeted spell is consumed while accomplishing nothing', () => {
    const offenders: string[] = [];
    for (const def of ALL_CARDS.filter((c) => c.spell && !c.ruby && !c.target && !c.chooseOne)) {
      const base: RunState = { ...createRun(99), board: [], shop: [], embers: 30, hand: [spell(def.id)] };
      const before = sig(base);
      let after: RunState;
      try { after = reduce(base, { type: 'play', uid: 'sp' }); } catch { continue; }
      if (!kept(after) && sig(after) === before) offenders.push(def.id);
    }
    expect(offenders, 'these are consumed for nothing — add a rule to spellFizzle.ts').toEqual([]);
  });

  it('NO targeted spell is consumed while accomplishing nothing on a plain body', () => {
    const offenders: string[] = [];
    for (const def of ALL_CARDS.filter((c) => c.spell && !c.ruby && c.target && !c.chooseOne)) {
      const base: RunState = {
        ...createRun(99), shop: [], embers: 30, hand: [spell(def.id)], board: [body('tg', 'sandbag')],
      };
      const before = sig(base);
      let after: RunState;
      try { after = reduce(base, { type: 'play', uid: 'sp', targetUid: 'tg' }); } catch { continue; }
      if (!kept(after) && sig(after) === before) offenders.push(def.id);
    }
    expect(offenders, 'these are consumed for nothing — add a rule to spellFizzle.ts').toEqual([]);
  });
});
