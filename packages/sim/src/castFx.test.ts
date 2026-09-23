/**
 * THE CAST-PREVIEW CHANNEL (owner ask 2026-09-23): `castSpell` records every spell a RUNE or a MINION casts on
 * `RunState.castFx` — attributed to the caster off the recruit cast-actor stack — and nothing for the player's
 * own cast. Presentation only: the sim never reads it back; the UI floats the spell's card above its caster.
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, advanceRuneThresholds, castSpell, projectEndOfTurnSteps, withCastActor } from './recruit';

const minion = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });
const run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1), phase: 'recruit', ...over } as RunState);

describe('castFx — the cast-preview channel', () => {
  it('a MINION casting a spell through its effect (Rope Wrangler → Lasso) is recorded against that minion', () => {
    const s = run({ board: [minion('rw', 'ropewrangler', 3, 3)] });
    applyEndOfTurn(s);
    const casts = (s.castFx ?? []).filter((c) => c.spellId === 'lasso');
    expect(casts).toEqual([{ source: { kind: 'minion', uid: 'rw', cardId: 'ropewrangler' }, spellId: 'lasso', phase: 'endOfTurn' }]);
    expect(s.castFxSeq ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('the End-of-Turn projection slices the same casts per beat (EotStepFx.casts) — the legacy player reads them there', () => {
    const s = run({ board: [minion('rw', 'ropewrangler', 3, 3)] });
    const { fx } = projectEndOfTurnSteps(s);
    const beat = fx.find((f) => (f.casts ?? []).some((c) => c.spellId === 'lasso'));
    expect(beat, 'the Wrangler beat carries its Lasso cast').toBeDefined();
    expect(beat!.casts![0]!.source).toEqual({ kind: 'minion', uid: 'rw', cardId: 'ropewrangler' });
    expect(beat!.casts![0]!.phase).toBe('endOfTurn');
    expect(s.castFx ?? []).toEqual([]); // the projection runs on a clone — the real state is untouched
  });

  it('a RUNE threshold casting a spell (Rune of the Gilded Ledger) is recorded against that rune', () => {
    const reward = RUNE_INDEX['rune_gilded_ledger']!.reward as { kind: 'runeThreshold'; meter: 'gold'; per: number; castStatSpell: number };
    const s = run({ tier: 6, board: [minion('a', 'ropewrangler')], runeThresholds: [{ ...reward, sourceId: 'rune_gilded_ledger', tick: 0 }] as never });
    advanceRuneThresholds(s, 'gold', reward.per);
    expect(s.castFx).toHaveLength(1);
    const [c] = s.castFx!;
    expect(c!.source).toEqual({ kind: 'rune', id: 'rune_gilded_ledger' });
    expect(c!.phase).toBe('recruit');
    expect(CARD_INDEX[c!.spellId]?.spell, 'the record names the spell that was cast').toBe(true);
  });

  it('the PLAYER casting a spell (no actor on the stack) records nothing', () => {
    const s = run({ board: [minion('a', 'ropewrangler')] });
    castSpell(s, CARD_INDEX['staffofguel']!);
    expect(s.castFx ?? []).toEqual([]);
    expect(s.castFxSeq ?? 0).toBe(0);
  });

  it('`withCastActor` attributes a direct cast — the path a new rune reward or a test takes', () => {
    const s = run();
    withCastActor({ kind: 'rune', id: 'rune_spell_market' }, () => castSpell(s, CARD_INDEX['staffofguel']!));
    expect(s.castFx).toEqual([{ source: { kind: 'rune', id: 'rune_spell_market' }, spellId: 'staffofguel', phase: 'recruit' }]);
    // …and the stack unwinds: a cast after the scope is the player's again.
    castSpell(s, CARD_INDEX['staffofguel']!);
    expect(s.castFx).toHaveLength(1);
  });

  it('the reducer clears the channel at the top of every action (per-action contract, like bounceFx)', () => {
    const s = run();
    s.castFx = [{ source: { kind: 'rune', id: 'rune_gilded_ledger' }, spellId: 'staffofguel', phase: 'recruit' }];
    s.castFxSeq = 1;
    const next = reduce(s, { type: 'freeze' });
    expect(next.castFx).toEqual([]);
  });
});
