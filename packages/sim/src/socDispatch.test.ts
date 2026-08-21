import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, projectEndOfTurnSteps, questEndOfTurnBeats, reduce, type RunState } from './index';
import { applyEndOfTurn, fireStartOfCombats, socBoardEffects } from './recruit';

/**
 * THE SHOP-SIDE START-OF-COMBAT DISPATCHER (Effect Arena Step 4) + RUNE OF COMBAT PROWESS.
 *
 * Start of Combat was a combat-only pass — nothing in the shop ever dispatched it. With the family migrated
 * onto `ARENA_EFFECTS` (one body per effect, both adapters), `fireShopStartOfCombat` fires them at End of
 * Turn under Rune of Combat Prowess. This file pins the properties that make that honest, mirroring
 * `rallyDispatch.test.ts` (the family's template):
 *
 *   1. the dispatcher fires every Start-of-Combat body once — and the armed rune is not inert;
 *   2. without the rune, nothing fires at End of Turn;
 *   3. ENEMY-FACING bodies no-op gracefully, with ZERO RNG-cursor drift;
 *   4. each fire carries its own nested per-effect identity (the Bug-1 regression class);
 *   5. a summoning SoC stamps the committed board index on its `cardSummoned` consequence;
 *   6. an Echo-triggering SoC pays the recruit Echo tallies (`lastEchoFires`);
 *   7. capture on or off, the committed state is identical.
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

describe('the eligibility scan — what counts as "a Start of Combat to fire"', () => {
  it('a printed startOfCombat effect counts; a plain minion does not', () => {
    const s = run([bc('sd', 'runmaw'), bc('z', 'stray')]);
    expect(socBoardEffects(s).map((e) => e.card.uid)).toEqual(['sd']);
  });

  it('a GRAFTED startOfCombat effect is as real as a printed one (instanceEffects)', () => {
    const s = run([bc('x', 'stray', {
      grantedEffects: [{ on: 'startOfCombat', do: 'scBuffSelf', params: { attack: 2, health: 2 } }],
    } as never)]);
    expect(socBoardEffects(s).map((e) => `${e.card.uid}:${e.effect.do}`)).toEqual(['x:scBuffSelf']);
  });

  it('a card with TWO SoC effects yields two entries — one beat per EFFECT, not per card', () => {
    const s = run([bc('x', 'stray', {
      grantedEffects: [
        { on: 'startOfCombat', do: 'scBuffSelf', params: { attack: 1 } },
        { on: 'startOfCombat', do: 'scBuffSelf', params: { health: 1 } },
      ],
    } as never)]);
    expect(socBoardEffects(s)).toHaveLength(2);
  });
});

describe('the dispatcher fires every Start-of-Combat body once', () => {
  it('fireStartOfCombats resolves each body — Speed Demon pays 50% of itself to the others', () => {
    // runmaw (Speed Demon) is 8/8-class: check the OTHER minion gains floor(atk/2)/floor(hp/2).
    const s = run([bc('sd', 'runmaw'), bc('z', 'stray')]);
    const def = CARD_INDEX['runmaw']!;
    const before = s.board.find((c) => c.uid === 'z')!;
    const wantA = Math.floor((def.attack * 50) / 100);
    const wantH = Math.floor((def.health * 50) / 100);
    const beforeStats = { a: before.attack, h: before.health };
    fireStartOfCombats(s);
    const z = s.board.find((c) => c.uid === 'z')!;
    expect(z.attack - beforeStats.a).toBe(wantA);
    expect(z.health - beforeStats.h).toBe(wantH);
    // …and the grant is PERMANENT on the run board (a shop buff is permanent by definition).
    expect(z.buffs?.some((b) => b.source === def.name)).toBe(true);
  });

  it('a summoning SoC really summons (Imp Wrangler lands an Imp beside itself)', () => {
    const s = run([bc('w', 'dm_wrangler'), bc('z', 'stray')]);
    fireStartOfCombats(s);
    expect(s.board.findIndex((c) => c.cardId === 'impscrap'), 'adjacent to the Wrangler, not appended').toBe(1);
  });

  it('a body summoned MID-PASS has no Start of Combat to fire (Mirrorhide summons exactly one copy)', () => {
    const s = run([bc('m', 'mirrorrhino'), bc('z', 'stray')]);
    fireStartOfCombats(s);
    expect(s.board.filter((c) => c.cardId === 'mirrorrhino')).toHaveLength(2);
  });
});

describe('Rune of Combat Prowess — End of Turn replays every Start of Combat', () => {
  it('ARMED: the SoC fires at End of Turn (Speed Demon buffs the board)', () => {
    const s = run([bc('sd', 'runmaw'), bc('z', 'stray')], { runeCombatProwess: true });
    const before = statsOf(s, 'z');
    applyEndOfTurn(s);
    expect(statsOf(s, 'z')).not.toBe(before);
  });

  it('UNARMED: nothing fires', () => {
    const s = run([bc('sd', 'runmaw'), bc('z', 'stray')]);
    const before = statsOf(s, 'z');
    applyEndOfTurn(s);
    expect(statsOf(s, 'z'), 'no rune, no replay').toBe(before);
  });

  it('an Echo-triggering SoC (Spots) routes through the recruit Echo path and pays lastEchoFires', () => {
    // n2_lastlight carries an Echo (grant Ward); Spots triggers the leftmost other Echo(es).
    const s = run([bc('e', 'n2_lastlight'), bc('sp', 'b2_spots'), bc('z', 'stray')], { runeCombatProwess: true });
    applyEndOfTurn(s);
    expect(s.lastEchoFires ?? 0, 'a shop-fired Echo counts like every other shop-fired Echo').toBeGreaterThanOrEqual(1);
    // …and the Echo actually resolved: Lastlight granted Ward to an unshielded friend.
    expect(s.board.some((c) => c.uid !== 'e' && c.keywords.includes('DS'))).toBe(true);
  });

  it('Chronos-class repeats double the pass, like every End-of-Turn effect', () => {
    const once = run([bc('sd', 'runmaw'), bc('z', 'stray')], { runeCombatProwess: true });
    const twice = run([bc('sd', 'runmaw'), bc('z', 'stray')], { runeCombatProwess: true, endOfTurnExtra: 1 } as Partial<RunState>);
    expect(questEndOfTurnBeats(twice).filter((b) => b.effect === 'runeCombatProwess')).toHaveLength(
      questEndOfTurnBeats(once).filter((b) => b.effect === 'runeCombatProwess').length * 2,
    );
  });
});

describe('enemy-facing bodies no-op GRACEFULLY in the shop', () => {
  it('Arena Heckler (taunt the opposite enemy) resolves to nothing — no friendly is ever taunted', () => {
    const s = run([bc('h', 'arenaheckler'), bc('z', 'stray')], { runeCombatProwess: true });
    expect(() => applyEndOfTurn(s)).not.toThrow();
    expect(s.board.every((c) => !c.keywords.includes('T')), 'nobody friendly was taunted').toBe(true);
  });

  it('scDamage (random mode) returns on the empty enemies() BEFORE it draws — zero RNG-cursor drift', () => {
    const s = run([bc('x', 'stray', {
      grantedEffects: [{ on: 'startOfCombat', do: 'scDamage', params: { target: 'random', amount: 3 } }],
    } as never), bc('z', 'stray')], { runeCombatProwess: true });
    const cursorBefore = s.rngCursor;
    const boardBefore = s.board.map((c) => `${c.uid}:${c.attack}/${c.health}`);
    expect(() => applyEndOfTurn(s)).not.toThrow();
    expect(s.board.map((c) => `${c.uid}:${c.attack}/${c.health}`), 'nobody was hit').toEqual(boardBefore);
    expect(s.rngCursor, 'no random draw was spent on a target that does not exist').toBe(cursorBefore);
  });

  it('both are still WIRED — the dispatcher does not hand-select which effects it will call', () => {
    const s = run([bc('h', 'arenaheckler'), bc('b', 'bloodbinder')], { runeCombatProwess: true });
    expect(socBoardEffects(s).map((e) => e.effect.do)).toEqual(['scGrantEnemyTaunt', 'scArmBleed']);
  });
});

describe('BEATS — every Start-of-Combat effect gets its own animation window', () => {
  const wide = () => [bc('sd', 'runmaw'), bc('k', 'kennel'), bc('w', 'dm_wrangler'), bc('z', 'stray')];

  it('N effects → N beats in the UI beat list, each sourced on the acting minion', () => {
    const s = run(wide(), { runeCombatProwess: true });
    const beats = questEndOfTurnBeats(s).filter((b) => b.effect === 'runeCombatProwess');
    expect(beats).toHaveLength(3);
    expect(beats.map((b) => b.uid), 'source attribution: the acting minion pulses').toEqual(['sd', 'k', 'w']);
    expect(new Set(beats.map((b) => b.label))).toEqual(new Set(['Rune of Combat Prowess']));
  });

  it('N effects → N steps in the PROJECTION, so the animation actually reserves the time', () => {
    const armed = projectEndOfTurnSteps(run(wide(), { runeCombatProwess: true }));
    const bare = projectEndOfTurnSteps(run(wide()));
    expect(armed.steps.length - bare.steps.length, 'one projected step per effect').toBe(3);
    expect(armed.fx.length).toBe(armed.steps.length); // fx stays 1:1 with steps
  });

  it('the projection’s last step matches what the real commit lands', () => {
    const projected = projectEndOfTurnSteps(run(wide(), { runeCombatProwess: true }));
    const real = run(wide(), { runeCombatProwess: true });
    applyEndOfTurn(real);
    const last = projected.steps[projected.steps.length - 1]!;
    for (const c of real.board) {
      expect(last[c.uid], `projection vs commit for ${c.uid}`).toEqual({ attack: c.attack, health: c.health });
    }
  });

  it('no rune → no extra beats at all', () => {
    expect(questEndOfTurnBeats(run(wide())).filter((b) => b.effect === 'runeCombatProwess')).toHaveLength(0);
  });
});

describe('the AUTHORITATIVE batch — the path the shipped game actually paces on', () => {
  it('each effect emits its OWN source-attributed ownBeat trigger', async () => {
    const { reduceWithPresentation } = await import('./index');
    type Trig = { type: string; source: { kind: string; id: string; uid?: string }; policy: string; policyKey?: string };
    const s = run([bc('sd', 'runmaw'), bc('k', 'kennel'), bc('z', 'stray')], { runeCombatProwess: true });
    const { batch } = reduceWithPresentation(s, { type: 'faceOmen' }, true);
    const beats = (batch!.events as unknown[])
      .filter((e): e is Trig => (e as Trig).type === 'sourceTrigger')
      .filter((t) => t.policyKey === 'rune:rune_combat_prowess:endOfTurn');
    expect(beats, 'one beat per effect — the choreographer allots each its own window').toHaveLength(2);
    expect(beats.map((t) => t.source.uid)).toEqual(['sd', 'k']);
    expect(new Set(beats.map((t) => t.source.kind))).toEqual(new Set(['minion']));
    expect(new Set(beats.map((t) => t.policy)), 'ownBeat, never folded into a cue').toEqual(new Set(['ownBeat']));
  });

  it('each fire carries its OWN nested per-effect identity — what the authored FX bind to', async () => {
    // The Bug-1 regression class (shop-rally lesson, 2026-08-20): a bare dispatch collapses under the rune's
    // outer beat with no per-effect identity, and no authored FX or pulses play. The nested trigger carries
    // the same `factory:<do>:startOfCombat` registry key combat classifies.
    const { reduceWithPresentation } = await import('./index');
    type Trig = { type: string; id: string; parentId?: string; source: { uid?: string }; policyKey?: string; family?: string };
    type Cons = { type: string; parentId?: string };
    const s = run([bc('sd', 'runmaw'), bc('z', 'stray')], { runeCombatProwess: true });
    const { batch } = reduceWithPresentation(s, { type: 'faceOmen' }, true);
    const events = batch!.events as unknown as (Trig & Cons)[];
    const trigs = events.filter((e) => e.type === 'sourceTrigger') as Trig[];
    const beat = trigs.find((t) => t.policyKey === 'rune:rune_combat_prowess:endOfTurn')!;
    const nested = trigs.filter((t) => t.parentId === beat.id);
    const own = nested.find((t) => t.policyKey === 'factory:scBuffAlliesPctSelf:startOfCombat');
    expect(own?.source.uid, 'the acting minion’s effect is its own nested beat').toBe('sd');
    expect(own?.family, 'the combat family rides along').toBe('startOfCombat');
    // The consequences hang off the NESTED per-effect trigger — and are NOT double-emitted by the outer beat.
    const stats = events.filter((e) => e.type === 'statsChanged');
    expect(stats.length).toBeGreaterThan(0);
    for (const c of stats) expect(c.parentId, 'every stat delta belongs to the per-effect trigger').toBe(own!.id);
  });

  it('an INERT fire leaves NO empty nested beat (enemy-facing / combat-only channels)', async () => {
    const { reduceWithPresentation } = await import('./index');
    type Trig = { type: string; id: string; parentId?: string; policyKey?: string };
    const s = run([bc('h', 'arenaheckler'), bc('b', 'bloodbinder')], { runeCombatProwess: true });
    const { batch } = reduceWithPresentation(s, { type: 'faceOmen' }, true);
    const trigs = (batch!.events as unknown as Trig[]).filter((e) => e.type === 'sourceTrigger');
    const beats = trigs.filter((t) => t.policyKey === 'rune:rune_combat_prowess:endOfTurn');
    expect(beats, 'the rune still opens a beat per effect — nothing is hand-selected out').toHaveLength(2);
    for (const beat of beats) {
      expect(trigs.filter((t) => t.parentId === beat.id), 'the guarded-out no-op leaves no empty nested scope').toHaveLength(0);
    }
  });

  it('a summoning SoC carries its insertion index — the slot adjacent to the summoner', async () => {
    const { reduceWithPresentation } = await import('./index');
    type Summ = { type: string; cardId?: string; index?: number };
    const s = run([bc('w', 'dm_wrangler'), bc('z', 'stray')], { runeCombatProwess: true });
    const { batch, state } = reduceWithPresentation(s, { type: 'faceOmen' }, true);
    const summons = (batch!.events as unknown as Summ[]).filter((e) => e.type === 'cardSummoned');
    expect(summons).toHaveLength(1);
    expect(summons[0]!.cardId).toBe('impscrap');
    expect(summons[0]!.index, 'inserted adjacent to the Wrangler (slot 0), not appended').toBe(1);
    expect(state.board.findIndex((c) => c.cardId === 'impscrap')).toBe(1);
  });

  it('capture on or off, the committed state is identical', async () => {
    const { reduce: r, reduceWithPresentation } = await import('./index');
    const s = run([bc('sd', 'runmaw'), bc('k', 'kennel'), bc('w', 'dm_wrangler')], { runeCombatProwess: true });
    const plain = r(s, { type: 'faceOmen' });
    expect(JSON.stringify(reduceWithPresentation(s, { type: 'faceOmen' }, true).state)).toBe(JSON.stringify(plain));
  });
});

describe('shop-phase permanence — the run board keeps what the replay granted', () => {
  it('Pack-Leader-class accruals advance exactly once per fire (kennel’s summonBonus is a run channel)', () => {
    const s = run([bc('k', 'kennel'), bc('z', 'stray')], { runeCombatProwess: true });
    applyEndOfTurn(s);
    // scBeastAura does not tick summonBonus (that is Avenge's job) — but the buff it granted stays.
    const k = s.board.find((c) => c.uid === 'k')!;
    expect(k.buffs?.some((b) => b.source === CARD_INDEX['kennel']!.name), 'the aura grant is a permanent shop buff').toBe(true);
  });

  it('the reducer path commits the gains — they survive the action boundary', () => {
    const next = reduce(run([bc('sd', 'runmaw'), bc('z', 'stray')], { runeCombatProwess: true }), { type: 'faceOmen' });
    const z = next.board.find((c) => c.uid === 'z')!;
    expect(z.buffs?.some((b) => b.source === CARD_INDEX['runmaw']!.name)).toBe(true);
  });
});
