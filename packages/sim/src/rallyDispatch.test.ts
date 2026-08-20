import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, projectEndOfTurnSteps, questEndOfTurnBeats, reduce, type RunState } from './index';
import { applyEndOfTurn, canRallyInShop, fireRallies, ralliersOf } from './recruit';

/**
 * THE SHOP-SIDE RALLY DISPATCHER (Effect Arena Step 4) + RUNE OF LASTING CADENCE.
 *
 * Rally was an `onAttack` COMBAT trigger with no recruit-phase dispatch, which is the only reason the rune
 * shipped as Start of Combat. With the Rally family migrated onto `ARENA_EFFECTS` (one body per effect,
 * dispatched by both adapters), `fireShopRally` can fire them at End of Turn — and this file pins the four
 * properties that make that honest:
 *
 *   1. an armed rune actually fires a board Rally at End of Turn (it is not inert);
 *   2. without the rune, nothing fires;
 *   3. an ENEMY-FACING Rally no-ops safely rather than crashing or half-applying (there are no enemies here);
 *   4. a card without a genuine Rally is not triggered at all;
 *   5. N rallies produce N BEATS, so the choreographer reserves an animation window for each.
 */

const bc = (uid: string, cardId: string, over: Partial<RunState['board'][number]> = {}): RunState['board'][number] => {
  const def = CARD_INDEX[cardId]!;
  return {
    uid, cardId, tribe: def.tribe, attack: def.attack, health: def.health,
    keywords: [...def.keywords], golden: false, ...over,
  } as RunState['board'][number];
};

const run = (board: RunState['board'], over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(3, 'warden'), phase: 'recruit', board, ...over } as RunState);

const statsOf = (s: RunState, uid: string): string => {
  const c = s.board.find((b) => b.uid === uid)!;
  return `${c.attack}/${c.health}`;
};

describe('the Rally gate — what counts as "a Rally to trigger"', () => {
  it('the RL keyword AND a real onAttack effect', () => {
    expect(canRallyInShop(bc('a', 'd2_cinderchef')), 'Cinderchef: RL + rallyBuffSelf').toBe(true);
  });

  it('a plain minion is not a rallier, even on a board full of them', () => {
    // `stray` has neither the badge nor an onAttack effect.
    expect(canRallyInShop(bc('b', 'stray'))).toBe(false);
    const s = run([bc('a', 'd2_cinderchef'), bc('b', 'stray')]);
    expect(ralliersOf(s).map((c) => c.uid)).toEqual(['a']);
  });

  it('the badge alone is not enough — RL with nothing behind it is not a Rally', () => {
    expect(canRallyInShop(bc('c', 'stray', { keywords: ['RL'] }))).toBe(false);
  });

  it('a WELDED rally counts, exactly as combat’s canRally has it', () => {
    expect(canRallyInShop(bc('d', 'stray', { rallyMechAtk: 5 }))).toBe(true);
    expect(canRallyInShop(bc('e', 'stray', { rallySpellWeld: 1 }))).toBe(true);
  });
});

describe('Rune of Lasting Cadence — End of Turn fires every Rally', () => {
  const board = () => [bc('a', 'd2_cinderchef'), bc('b', 'stray')];

  it('ARMED: the board Rally fires (Cinderchef gains its +1/+1)', () => {
    const s = run(board(), { runeLastingCadence: true });
    const before = statsOf(s, 'a');
    applyEndOfTurn(s);
    expect(before).toBe('1/3');
    expect(statsOf(s, 'a'), 'Rally: gain +1/+1').toBe('2/4');
  });

  it('UNARMED: nothing fires', () => {
    const s = run(board());
    applyEndOfTurn(s);
    expect(statsOf(s, 'a'), 'no rune, no rally').toBe('1/3');
  });

  it('a NON-Rally card is not triggered', () => {
    const s = run(board(), { runeLastingCadence: true });
    const before = statsOf(s, 'b');
    applyEndOfTurn(s);
    expect(statsOf(s, 'b'), 'the plain body is untouched').toBe(before);
  });

  it('the ally-attack watchers answer a shop Rally, exactly as they answer a swing', () => {
    // Paragon: "whenever you trigger a Rally, give a minion of every type +4/+4 permanently." Its gate is the
    // ATTACKER's RL keyword — so it must see Cinderchef's shop rally.
    const s = run([bc('a', 'd2_cinderchef'), bc('p', 'n2_paragon')], { runeLastingCadence: true });
    applyEndOfTurn(s);
    const paragon = s.board.find((c) => c.uid === 'p')!;
    expect(paragon.attack, 'Paragon is all-type, so it always pays itself').toBeGreaterThan(CARD_INDEX['n2_paragon']!.attack);
  });

  it('an ally-attack watcher stays silent when the attacker has no Rally', () => {
    // No RL body on the board at all → no rally is dispatched, so Paragon has nothing to answer.
    const s = run([bc('x', 'stray'), bc('p', 'n2_paragon')], { runeLastingCadence: true });
    applyEndOfTurn(s);
    expect(s.board.find((c) => c.uid === 'p')!.attack).toBe(CARD_INDEX['n2_paragon']!.attack);
  });
});

describe('enemy-facing Rallies no-op GRACEFULLY in the shop', () => {
  it('Philippe (deal its Attack to a random enemy) resolves to nothing — there are no enemies', () => {
    const s = run([bc('ph', 'philippe'), bc('b', 'stray')], { runeLastingCadence: true });
    const cursorBefore = s.rngCursor;
    const boardBefore = s.board.map((c) => `${c.uid}:${c.attack}/${c.health}`);
    expect(() => applyEndOfTurn(s)).not.toThrow();
    expect(s.board.map((c) => `${c.uid}:${c.attack}/${c.health}`), 'nobody was hit').toEqual(boardBefore);
    // It returns on the empty `enemies()` BEFORE it draws, so it cannot drift the run's shared RNG cursor.
    expect(s.rngCursor, 'no random draw was spent on a target that does not exist').toBe(cursorBefore);
  });

  it('Tauntbreaker (strip Taunt/Rise off the target) resolves to nothing — nobody is being struck', () => {
    const s = run([bc('tb', 'tauntbreaker'), bc('t', 'stray', { keywords: ['T', 'R'] })], { runeLastingCadence: true });
    expect(() => applyEndOfTurn(s)).not.toThrow();
    const friend = s.board.find((c) => c.uid === 't')!;
    expect(friend.keywords, 'a friendly must never be disarmed by a shop rally').toEqual(['T', 'R']);
  });

  it('both are still WIRED — the dispatcher does not hand-select which effects it will call', () => {
    // The point of the arena is that no one maintains an allowlist. Both ids resolve through the shared
    // dispatch and go inert on their own guard; `ralliersOf` still counts them as ralliers.
    const s = run([bc('ph', 'philippe'), bc('tb', 'tauntbreaker')], { runeLastingCadence: true });
    expect(ralliersOf(s).map((c) => c.uid)).toEqual(['ph', 'tb']);
  });
});

describe('BEATS — every rally gets its own animation window', () => {
  const wide = () => [bc('a', 'd2_cinderchef'), bc('b', 'd2_cinderchef'), bc('c', 'd2_cinderchef'), bc('z', 'stray')];

  it('N rallies → N beats in the UI beat list, each sourced on the minion that rallies', () => {
    const s = run(wide(), { runeLastingCadence: true });
    const beats = questEndOfTurnBeats(s).filter((b) => b.effect === 'runeLastingCadence');
    expect(beats).toHaveLength(3);
    expect(beats.map((b) => b.uid), 'source attribution: the triggering minion pulses').toEqual(['a', 'b', 'c']);
    expect(new Set(beats.map((b) => b.label))).toEqual(new Set(['Rune of Lasting Cadence']));
  });

  it('N rallies → N steps in the PROJECTION, so the animation actually reserves the time', () => {
    const armed = projectEndOfTurnSteps(run(wide(), { runeLastingCadence: true }));
    const bare = projectEndOfTurnSteps(run(wide()));
    expect(armed.steps.length - bare.steps.length, 'one projected step per rally').toBe(3);
    expect(armed.fx.length).toBe(armed.steps.length); // fx stays 1:1 with steps
  });

  it('the projection’s last step matches what the real commit lands', () => {
    const projected = projectEndOfTurnSteps(run(wide(), { runeLastingCadence: true }));
    const real = run(wide(), { runeLastingCadence: true });
    applyEndOfTurn(real);
    const last = projected.steps[projected.steps.length - 1]!;
    for (const c of real.board) {
      expect(last[c.uid], `projection vs commit for ${c.uid}`).toEqual({ attack: c.attack, health: c.health });
    }
  });

  it('no rune → no extra beats at all', () => {
    expect(questEndOfTurnBeats(run(wide())).filter((b) => b.effect === 'runeLastingCadence')).toHaveLength(0);
  });
});

describe('per-pass counters are scoped to the pass', () => {
  it('Evolving Abomination’s doubling cap resets each End of Turn, not once per run', () => {
    const s = run([bc('ab', 'n2_abomination')], { runeLastingCadence: true });
    applyEndOfTurn(s);
    const afterOne = statsOf(s, 'ab');
    expect(s.board[0]!.bredCount, 'the per-pass counter is cleared after the pass').toBeUndefined();
    applyEndOfTurn(s);
    expect(statsOf(s, 'ab'), 'it doubles again next turn').not.toBe(afterOne);
  });

  it('fireRallies clears the per-pass counters it used', () => {
    const s = run([bc('a', 'd2_cinderchef')]);
    fireRallies(s);
    expect(s.board.every((c) => c.attackSeen === undefined && c.bredCount === undefined)).toBe(true);
  });
});

describe('the AUTHORITATIVE batch — the path the shipped game actually paces on', () => {
  it('each rally emits its OWN source-attributed ownBeat trigger', async () => {
    const { reduceWithPresentation } = await import('./index');
    type Trig = { type: string; source: { kind: string; id: string; uid?: string }; policy: string; policyKey?: string };
    const s = run(
      [bc('a', 'd2_cinderchef'), bc('b', 'd2_cinderchef'), bc('z', 'stray')],
      { runeLastingCadence: true },
    );
    const { batch } = reduceWithPresentation(s, { type: 'faceOmen' }, true);
    const rallies = (batch!.events as unknown[])
      .filter((e): e is Trig => (e as Trig).type === 'sourceTrigger')
      .filter((t) => t.policyKey === 'rune:rune_lasting_cadence:endOfTurn');
    expect(rallies, 'one beat per rally — the choreographer allots each its own window').toHaveLength(2);
    // Source attribution: the beat belongs to the minion whose Rally fires, so IT pulses and its FX play.
    expect(rallies.map((t) => t.source.uid)).toEqual(['a', 'b']);
    expect(new Set(rallies.map((t) => t.source.kind))).toEqual(new Set(['minion']));
    expect(new Set(rallies.map((t) => t.policy)), 'ownBeat, never folded into a cue').toEqual(new Set(['ownBeat']));
  });

  it('capture on or off, the committed state is identical', async () => {
    const { reduce, reduceWithPresentation } = await import('./index');
    const s = run([bc('a', 'd2_cinderchef'), bc('p', 'n2_paragon')], { runeLastingCadence: true });
    const plain = reduce(s, { type: 'faceOmen' });
    expect(JSON.stringify(reduceWithPresentation(s, { type: 'faceOmen' }, true).state)).toBe(JSON.stringify(plain));
  });
});

describe('the broadcast does not over-fire an own-trigger effect', () => {
  it('Blade Thrower pours ONE Ale for its own rally, not one per rally on the board', () => {
    // `combatGrantAle` is shared by Slaughter / Rally / Echo and distinguishes them by a `guard` param. Under
    // the shop broadcast every board body is offered every rally, so the guard is what stops a second rallier's
    // swing from pouring the Thrower another round.
    const s = run(
      [bc('bt', 'dw_bladethrower'), bc('a', 'd2_cinderchef'), bc('b', 'd2_cinderchef')],
      { runeLastingCadence: true },
    );
    const alesBefore = s.hand.length;
    applyEndOfTurn(s);
    expect(s.hand.length - alesBefore, 'three rallies fired, but only its own pours an Ale').toBe(1);
  });
});

describe('a SHOP Rally is a Rally TRIGGER for the quest tallies (owner ruling 2026-08-20)', () => {
  // Overclocked Core is the live `rally`-objective quest ("Trigger 9 Rallies"). Drive the REAL faceOmen
  // action so the whole chain is exercised: applyEndOfTurn → fireShopRally → lastRallyFires → the reducer's
  // per-action quest tick — not a hand-called helper that could pass while the wiring is broken.
  const rally = (uid: string) => bc(uid, 'd2_cinderchef', { keywords: ['RL'] });
  const armed = (over: Partial<RunState> = {}): RunState => run(
    [rally('r1'), rally('r2'), rally('r3')],
    {
      runeLastingCadence: true,
      activeQuests: [{ questId: 'q_overclocked_core', progress: 0, completed: false }],
      ...over,
    } as Partial<RunState>,
  );

  it('End of Turn under Lasting Cadence advances the rally objective by one per fired Rally', () => {
    const next = reduce(armed(), { type: 'faceOmen' });
    const q = next.activeQuests!.find((a) => a.questId === 'q_overclocked_core')!;
    expect(q.progress, 'three shop rallies = three Rally triggers').toBe(3);
  });

  it('without the rune, ending the turn advances nothing', () => {
    const next = reduce(armed({ runeLastingCadence: undefined }), { type: 'faceOmen' });
    expect(next.activeQuests!.find((a) => a.questId === 'q_overclocked_core')!.progress).toBe(0);
  });

  it('Rune of the Herding Horn pays its refresh on a SHOP rally too — one definition of "a Rally"', () => {
    // Its combat half hooks bumpRally so it "counts exactly what the rally quest objective counts"; the shop
    // chokepoint honours the same sentence.
    const next = reduce(armed({ questFlags: { runeHerdingHorn: true }, freeRolls: 0 } as never), { type: 'faceOmen' });
    expect(next.freeRolls, 'three rallies bank three refreshes for next turn').toBe(3);
  });
});
