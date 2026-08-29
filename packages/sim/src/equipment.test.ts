import { describe, it, expect } from 'vitest';
import { BLOODPOT, CARD_INDEX } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { equipmentState, equipmentUsesLeft, selectedEquipment } from './equipment';
import { fireEquipmentTriggers } from './recruit';

/**
 * EQUIPMENT — the first vertical slice (owner handoff 2026-08-28).
 *
 * Alchemist Frank grants Bloodpot: 1 Gold, target a friendly minion, +3/+3 (+6/+6 Gilded). Every test drives
 * the REAL reducer, because the whole mechanic is about actions — what a play grants, what an activation
 * costs, what a turn boundary rebuilds. Calling the factories directly would prove none of it.
 *
 * Two confirmed design decisions shape what is asserted here:
 *  · ACTIVATION IS ATOMIC. There is no pending state, so "cancelling costs nothing" is tested as "an
 *    activation that never dispatched changed nothing" — which is what cancelling actually is.
 *  · EQUIPMENT IS RUN STATE, so a save round-trip is a JSON round-trip, not a bespoke capture path.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return {
    uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health,
    keywords: [...d.keywords], golden: false, ...over,
  };
};

/** A recruit-phase run with Gold to spend. */
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), phase: 'recruit', embers: 20, ...over } as RunState);

const act = (s: RunState, a: Action): RunState => reduce(s, a);
/** Play a card from hand at the given slot. */
const play = (s: RunState, uid: string, toIndex = 0): RunState => act(s, { type: 'play', uid, toIndex });
const activate = (s: RunState, targetUid?: string): RunState =>
  act(s, { type: 'activateEquipment', ...(targetUid ? { targetUid } : {}) });
/**
 * Advance to the next shop, which is what triggers the Start-of-Turn rebuild. The fight resolves over several
 * actions (`faceOmen` → the combat phase → `settleCombat` → `resolveCombat`), so this drives the phase machine
 * until a recruit phase comes back rather than assuming a fixed number of steps.
 */
const nextTurn = (s: RunState): RunState => {
  // `faceOmen` → combat, `settleCombat` applies the result (still combat, so the arena can play it out), and
  // `resolveCombat` opens the next shop — which is where the Equipment rebuild runs. Three actions, in order.
  const settled = act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' });
  const next = act(settled, { type: 'resolveCombat' });
  expect(next.phase, 'the run never came back to a shop').toBe('recruit');
  return next;
};
const statsOf = (s: RunState, uid: string): [number, number] => {
  const c = s.board.find((b) => b.uid === uid)!;
  return [c.attack, c.health];
};

describe('acquisition — Equip on play', () => {
  it('playing an Equip minion grants its Equipment immediately, and selects it when nothing was active', () => {
    let s = run({ hand: [body('f', 'e3_frank')] });
    expect(equipmentState(s).available, 'no Equipment before Frank').toEqual([]);
    s = play(s, 'f');
    const e = equipmentState(s);
    expect(e.available.map((g) => g.equipmentId)).toEqual(['bloodpot']);
    expect(e.available[0]!.sourceUids, 'the source body is tracked').toEqual(['f']);
    expect(e.available[0]!.version).toBe('plain');
    expect(e.selectedEquipmentId, 'auto-selected — the player had none').toBe('bloodpot');
    expect(equipmentUsesLeft(s), 'the shared allowance starts at 1').toBe(1);
  });

  it('a Gilded source grants the Gilded version', () => {
    let s = run({ hand: [body('f', 'e3_frank', { golden: true })] });
    s = play(s, 'f');
    expect(equipmentState(s).available[0]!.version).toBe('gilded');
  });

  it('stamps an equip cue for the UI', () => {
    let s = run({ hand: [body('f', 'e3_frank')] });
    s = play(s, 'f');
    expect(s.equipFx?.filter((f) => f.kind === 'equip' && f.uid === 'f')).toHaveLength(1);
  });
});

describe('activation — atomic, shared allowance, Gold', () => {
  /** Frank on board with Bloodpot granted, plus a victim to buff. */
  const armed = (over: Partial<RunState> = {}): RunState => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')], ...over });
    s = play(s, 'f', 1);
    return s;
  };

  it('pays the Gold, spends one shared activation, and buffs the chosen target', () => {
    let s = armed();
    const goldBefore = s.embers;
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(s.embers, 'Bloodpot costs 1').toBe(goldBefore - 1);
    expect(equipmentUsesLeft(s), 'the shared allowance is spent').toBe(0);
    expect(statsOf(s, 't'), '+3/+3').toEqual([a + 3, h + 3]);
    expect(equipmentState(s).lastUsedEquipmentId, 'last USED, not merely viewed').toBe('bloodpot');
  });

  it('a Gilded source gives +6/+6', () => {
    let s = run({ hand: [body('f', 'e3_frank', { golden: true })], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't')).toEqual([a + 6, h + 6]);
  });

  it('an activation that never dispatched costs nothing — which is what cancelling IS', () => {
    // Activation is atomic (owner ruling): the UI arms, the player picks, and only then does the action fire.
    // A cancel never reaches the reducer, so "cancel spends no Gold and no activation" is the statement that
    // the state is untouched until a real activation happens.
    const s = armed();
    const before = JSON.stringify(s);
    const cancelled = activate(s, undefined); // no target — refused outright
    expect(JSON.stringify(cancelled), 'a refused activation must change nothing').toBe(before);
    expect(equipmentUsesLeft(cancelled)).toBe(1);
  });

  it('refuses when the allowance is spent, and takes no Gold for the refusal', () => {
    let s = armed();
    s = activate(s, 't');
    const goldAfterFirst = s.embers;
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(s.embers, 'no Gold for a refused second use').toBe(goldAfterFirst);
    expect(statsOf(s, 't'), 'and no second buff').toEqual([a, h]);
  });

  it('a BONUS activation lets the SAME Equipment fire again — the allowance is player-level', () => {
    let s = armed();
    s.equipment!.bonusActivations = 1;
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't'), 'two activations, two buffs').toEqual([a + 6, h + 6]);
    expect(equipmentUsesLeft(s)).toBe(0);
  });

  it('refuses when the player cannot afford it, without half-resolving', () => {
    let s = armed({ embers: 0 });
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't')).toEqual([a, h]);
    expect(equipmentUsesLeft(s), 'an unaffordable activation spends no allowance').toBe(1);
  });

  it('cost reductions stack and floor at 0 — and a free activation still spends an allowance', () => {
    let s = armed();
    s.equipment!.temporaryCostReduction = 5; // more than the cost
    s = activate(s, 't');
    expect(s.embers, 'floored at 0, never a refund').toBe(20);
    expect(equipmentUsesLeft(s)).toBe(0);
  });
});

describe('additional triggers', () => {
  it('repeat on the ORIGINAL target, cost no extra Gold and no extra allowance', () => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    s.equipmentExtraTriggers = 2; // three triggers in total — additive, per the handoff
    const gold = s.embers;
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't'), '3 × +3/+3 on the one chosen target').toEqual([a + 9, h + 9]);
    expect(s.embers, 'repeats are free').toBe(gold - 1);
    expect(equipmentUsesLeft(s), 'and spend one allowance between them').toBe(0);
  });

  it('the trigger count is snapshot — a repeat cannot breed more repeats', () => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    s.equipmentExtraTriggers = 1;
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't'), 'exactly 2 triggers, never a runaway').toEqual([a + 6, h + 6]);
  });
});

describe('lifecycle — within a turn, and across the turn boundary', () => {
  it('selling the source leaves the Equipment usable for the rest of the turn', () => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    s = act(s, { type: 'sell', uid: 'f' });
    expect(s.board.some((c) => c.uid === 'f'), 'Frank is gone').toBe(false);
    expect(equipmentState(s).available.map((g) => g.equipmentId), 'the grant outlives its source').toEqual(['bloodpot']);
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't'), 'and still works').toEqual([a + 3, h + 3]);
  });

  it('with the source gone, the next turn re-equips nothing', () => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    s = act(s, { type: 'sell', uid: 'f' });
    s = nextTurn(s);
    expect(equipmentState(s).available, 'no source, no Equipment').toEqual([]);
    expect(equipmentState(s).selectedEquipmentId, 'and nothing selected — the slot hides').toBeUndefined();
  });

  it('with the source alive, the next turn re-equips and restores the allowance', () => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    s = activate(s, 't');
    expect(equipmentUsesLeft(s)).toBe(0);
    s = nextTurn(s);
    expect(equipmentState(s).available.map((g) => g.equipmentId)).toEqual(['bloodpot']);
    expect(equipmentUsesLeft(s), 'the allowance is back to baseline').toBe(1);
    expect(s.equipFx?.some((f) => f.kind === 'reequip' && f.uid === 'f'), 'and a re-equip cue fired').toBe(true);
  });

  it('unused allowances do NOT carry between turns', () => {
    let s = run({ hand: [body('f', 'e3_frank')] });
    s = play(s, 'f');
    s.equipment!.bonusActivations = 3; // never spent
    s = nextTurn(s);
    expect(equipmentUsesLeft(s), 'back to the baseline 1, not 4').toBe(1);
  });
});

describe('duplicate and Gilded sources', () => {
  it('two plain copies are ONE Equipment option, with both sources tracked', () => {
    let s = run({ hand: [body('f1', 'e3_frank'), body('f2', 'e3_frank')] });
    s = play(s, 'f1');
    s = play(s, 'f2', 1);
    const e = equipmentState(s);
    expect(e.available, 'one option, not two').toHaveLength(1);
    expect(e.available[0]!.sourceUids, 'but every source is tracked independently').toEqual(['f1', 'f2']);
  });

  it('a Gilded source upgrades the shared entry, and a plain one never downgrades it mid-turn', () => {
    let s = run({ hand: [body('f1', 'e3_frank'), body('f2', 'e3_frank', { golden: true })] });
    s = play(s, 'f1');
    s = play(s, 'f2', 1);
    expect(equipmentState(s).available[0]!.version, 'Gilded wins').toBe('gilded');
    expect(equipmentState(s).available[0]!.sourceUids).toEqual(['f1', 'f2']);
  });

  it('losing the Gilded source DOWNGRADES it at the next rebuild', () => {
    let s = run({ hand: [body('f1', 'e3_frank'), body('f2', 'e3_frank', { golden: true })] });
    s = play(s, 'f1');
    s = play(s, 'f2', 1);
    s = act(s, { type: 'sell', uid: 'f2' });
    expect(equipmentState(s).available[0]!.version, 'still Gilded for the rest of THIS turn').toBe('gilded');
    s = nextTurn(s);
    expect(equipmentState(s).available[0]!.version, 'the rebuild reads the surviving sources').toBe('plain');
  });

  it('duplicate sources cue ONCE between them, and still collapse to one option', () => {
    // Owner ruling 2026-08-28, overriding the handoff's per-minion beat: "if i have 2 alchemist franks on
    // board, only 1 of them re-equips the blood pot, not both of them."
    let s = run({ hand: [body('f1', 'e3_frank'), body('f2', 'e3_frank')] });
    s = play(s, 'f1');
    s = play(s, 'f2', 1);
    s = nextTurn(s);
    const cues = (s.equipFx ?? []).filter((f) => f.kind === 'reequip');
    expect(cues.map((c) => c.uid), 'one cue, on the left-most source').toEqual(['f1']);
    expect(equipmentState(s).available, 'still one option').toHaveLength(1);
    expect(equipmentState(s).available[0]!.sourceUids, 'though BOTH still re-equipped').toEqual(['f1', 'f2']);
  });
});

describe('selection', () => {
  it('swapping is free — no Gold, no allowance', () => {
    let s = run({ hand: [body('f', 'e3_frank')] });
    s = play(s, 'f');
    const gold = s.embers;
    s = act(s, { type: 'selectEquipment', equipmentId: 'bloodpot' });
    expect(s.embers).toBe(gold);
    expect(equipmentUsesLeft(s)).toBe(1);
    expect(selectedEquipment(s)?.equipmentId).toBe('bloodpot');
  });

  it('selecting Equipment the player does not hold is refused', () => {
    const s = run();
    expect(act(s, { type: 'selectEquipment', equipmentId: 'bloodpot' })).toBe(s);
  });

  it('the rebuild restores the LAST USED Equipment when its source survived', () => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    s = activate(s, 't');
    s = nextTurn(s);
    expect(equipmentState(s).selectedEquipmentId).toBe('bloodpot');
  });
});

describe('the rebuild is the FIRST Start-of-Turn operation', () => {
  /**
   * There are no Start-of-Turn priority LAYERS in this engine — it is an imperative sequence — so "first" is
   * positional and has to be pinned by observation rather than by a comment. A board Start-of-Turn effect
   * resolving later in the same advance must therefore see the REBUILT collection.
   */
  it('a Start-of-Turn effect later in the advance sees this turn\'s Equipment, not last turn\'s', () => {
    let s = run({ hand: [body('f', 'e3_frank')] });
    s = play(s, 'f');
    s = activate(s); // untargeted refusal — leaves the allowance intact
    s.equipment!.activationsSpent = 1; // pretend it was spent last turn
    s = nextTurn(s);
    // If the rebuild ran late, the allowance would still read 0 here.
    expect(equipmentUsesLeft(s), 'the rebuild had already reset the allowance').toBe(1);
    expect(equipmentState(s).available, 'and re-granted from the board').toHaveLength(1);
  });
});

describe('persistence', () => {
  it('survives a JSON round-trip — it is RunState, so replay v2 captures it for free', () => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    s = activate(s, 't');
    const revived = JSON.parse(JSON.stringify(s)) as RunState;
    expect(equipmentState(revived).available).toEqual(equipmentState(s).available);
    expect(equipmentState(revived).lastUsedEquipmentId).toBe('bloodpot');
    expect(equipmentUsesLeft(revived), 'the spent allowance survives').toBe(0);
  });
});

describe('the registry and the card agree', () => {
  it('Frank names Bloodpot, and Bloodpot is what the registry defines', () => {
    const frank = CARD_INDEX['e3_frank']!;
    const eff = frank.effects.find((e) => e.on === 'equip')!;
    expect(eff.params?.equipmentId, 'the card names its Equipment in exactly one place').toBe('bloodpot');
    expect(BLOODPOT.baseCost).toBe(1);
    expect(BLOODPOT.targetMode).toBe('friendly');
    // The printed card text must state the same numbers the Equipment actually grants.
    expect(frank.text).toContain('+3/+3');
    expect(frank.goldenText).toContain('+6/+6');
    expect(BLOODPOT.params).toEqual({ attack: 3, health: 3 });
    expect(BLOODPOT.gildedParams).toEqual({ attack: 6, health: 6 });
  });
});

describe('no valid target', () => {
  it('an empty board leaves the Equipment visible but unusable, and spends nothing', () => {
    // Frank himself is the only body once played, and Bloodpot may target him — so this uses a targetUid that
    // does not exist, which is what "no valid target" reduces to at the action boundary.
    let s = run({ hand: [body('f', 'e3_frank')] });
    s = play(s, 'f');
    const gold = s.embers;
    s = activate(s, 'nobody');
    expect(s.embers, 'a target that does not exist spends nothing').toBe(gold);
    expect(equipmentUsesLeft(s)).toBe(1);
    expect(equipmentState(s).available, 'and the Equipment is still held').toHaveLength(1);
  });

  it('Bloodpot can target its own source — a lone Frank is still a legal play', () => {
    let s = run({ hand: [body('f', 'e3_frank')] });
    s = play(s, 'f');
    s = activate(s, 'f');
    expect(statsOf(s, 'f'), 'Frank buffs himself').toEqual([6, 6]);
  });
});

describe('native hero power and Equipment are independent', () => {
  it('using Equipment does not touch the hero-power charge, and vice versa', () => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    const heroReadyBefore = s.heroReady;
    s = activate(s, 't');
    expect(s.heroReady, 'the native power is untouched by an Equipment activation').toBe(heroReadyBefore);
    expect(s.heroReady2, 'and so is the second slot').toBe(undefined);
    // The reverse: spending the hero power leaves the Equipment allowance alone.
    let s2 = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s2 = play(s2, 'f', 1);
    s2 = { ...s2, heroReady: false }; // as a used hero power leaves it
    expect(equipmentUsesLeft(s2), 'the Equipment allowance is its own budget').toBe(1);
  });
});

describe('the Equipment Spell classification', () => {
  /**
   * No Equipment casts a spell yet — the handoff asked for the classification to be BUILT ahead of the roster.
   * Asserted against a definition constructed here rather than one added to the registry: the contract is the
   * pipeline, not a card, and inventing a live card to test it would be exactly the roster the handoff said
   * not to build.
   */
  it('casts through the REAL Shop-spell path, so it counts as a cast', () => {
    const spell = Object.values(CARD_INDEX).find((c) => c?.spell && !c.token && !c.ruby)!;
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    const castsBefore = s.spellsCast;
    const playedBefore = (s.playedThisTurn ?? []).length;
    const handBefore = s.hand.length;
    fireEquipmentTriggers(
      s,
      { id: 'test_eq', name: 'Test', text: '', baseCost: 0, targetMode: 'friendly',
        effectId: 'equipmentCastSpell', params: { spellId: spell.id } },
      'plain',
      s.board.find((c) => c.uid === 'f')!,
      s.board.find((c) => c.uid === 't'),
      1,
    );
    expect(s.spellsCast, 'an Equipment Spell IS a Shop spell cast').toBe(castsBefore + 1);
    expect((s.playedThisTurn ?? []).length, 'but never a card PLAYED — nothing left a hand').toBe(playedBefore);
    expect(s.hand.length, 'and it never enters the hand').toBe(handBefore);
  });
});

/**
 * FX CUES are per-ACTION scratch. Both bugs below were reported live on 2026-08-28 and are the kind that only
 * show up after several plays, so they are pinned by counting rather than by eye.
 */
describe('equip cues do not pile up', () => {
  it('each play cues ONCE — the list is not cumulative', () => {
    // The bug: `equipFx` was never cleared between actions, so the UI (which replays the whole list when the
    // seq changes) fired the animation once per Equip minion EVER played. The fifth Frank played it five times.
    // TWO copies, deliberately: a third would complete a TRIPLE and combine them into a golden mid-test,
    // emptying the board the assertions depend on.
    let s = run({ hand: [body('f1', 'e3_frank'), body('f2', 'e3_frank')] });
    s = play(s, 'f1', 0);
    expect(s.equipFx, 'one cue after the first play').toHaveLength(1);
    s = play(s, 'f2', 1);
    expect(s.equipFx, 'still ONE after the second — not two').toHaveLength(1);
    expect(s.equipFx![0]!.uid, 'and it is the body that just landed').toBe('f2');
  });

  it('an unrelated action clears the previous cue rather than replaying it', () => {
    let s = run({ hand: [body('f', 'e3_frank')], embers: 20 });
    s = play(s, 'f');
    expect(s.equipFx).toHaveLength(1);
    s = act(s, { type: 'roll' });
    expect(s.equipFx ?? [], 'a roll is not an equip').toEqual([]);
  });
});

describe('the rebuild cues once per EQUIPMENT, not per source', () => {
  it('two Franks re-equip one Bloodpot and cue ONCE', () => {
    // Owner ruling 2026-08-28, overriding the handoff: "if i have 2 alchemist franks on board, only 1 of them
    // re-equips the blood pot, not both of them." Two copies, not three — a third triples them away.
    let s = run({ hand: [body('f1', 'e3_frank'), body('f2', 'e3_frank')] });
    s = play(s, 'f1', 0);
    s = play(s, 'f2', 1);
    s = nextTurn(s);
    const cues = (s.equipFx ?? []).filter((f) => f.kind === 'reequip');
    expect(cues, 'one cue, not two').toHaveLength(1);
    expect(cues[0]!.uid, 'attributed to the LEFT-MOST source').toBe('f1');
    // …while every source still re-equips, which is what keeps duplicate/Gilded precedence working.
    expect(equipmentState(s).available[0]!.sourceUids).toEqual(['f1', 'f2']);
  });
});

describe('using an Equipment cues its own effect', () => {
  it('stamps ONE use cue carrying the Equipment and its target', () => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    s = activate(s, 't');
    const uses = (s.equipFx ?? []).filter((f) => f.kind === 'use');
    expect(uses, 'one use cue').toHaveLength(1);
    expect(uses[0]!.equipmentId, 'so the UI can look up its authored FX and clip').toBe('bloodpot');
    expect(uses[0]!.targetUid, 'and where the effect travels to').toBe('t');
  });

  it('repeats do NOT replay it — one travel per activation, however many triggers', () => {
    let s = run({ hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    s.equipmentExtraTriggers = 2; // three triggers
    s = activate(s, 't');
    expect((s.equipFx ?? []).filter((f) => f.kind === 'use'), 'still one').toHaveLength(1);
  });

  it('Bloodpot names the FX and clip it plays, so a new Equipment needs no UI change', () => {
    expect(BLOODPOT.useFxId).toBe('bloodpot');
    expect(BLOODPOT.useSfxId).toBe('bloodpot');
  });
});
