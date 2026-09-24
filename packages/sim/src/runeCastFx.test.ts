/**
 * A RUNE'S CAST IS A CARD'S CAST (owner ruling 2026-09-24, verbatim): *"spells cast from runes and cards should use
 * the spell effects, like gilded ledger should show the animations we build for the spells when it is cast. they
 * can stem from the rune if there needs to be a source position."*
 *
 * #1672 tagged a MINION's cast on its buff records (`spellId`) so a spell with its own cast effect replaces the
 * tendril; a rune's cast was left untagged and, having no body, its buffs were routed sourceless and drew nothing.
 * The sim's half of the ruling is the TAG: every buff a rune's cast produced carries the spell AND the rune
 * (`BuffFxEvent.sourceRuneId`, `statsChanged.castByRune` on the authoritative End-of-Turn beats), so the UI can
 * play the spell's effect in place of the trail and stem everything else from the rune's node on the rail. The
 * presentation half is packages/ui/src/fx/runeCastFx.test.ts; combat is packages/core/src/combat/runeCastSc.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { makeCollector } from '@game/core';
import { createRun, reduce, withActiveCollector, type BoardCard, type RunState } from './index';
import { advanceRuneThresholds, applyEndOfTurn, projectEndOfTurnSteps } from './recruit';

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 2, health: 2, keywords: [], golden: false, ...over });
const run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1), phase: 'recruit', ...over } as RunState);

/** Walk seeds until Rune of the Gilded Ledger's 7-Gold meter rolls `spellId` (deterministic: the first such seed). */
function ledgerRolling(spellId: string): RunState {
  const reward = RUNE_INDEX['rune_gilded_ledger']!.reward as { kind: 'runeThreshold'; meter: 'gold'; per: number; castStatSpell: number };
  for (let seed = 1; seed <= 600; seed++) {
    const s = run({ tier: 6, rngCursor: seed, board: [card('a', 'stray'), card('b', 'stray')], runeThresholds: [{ ...reward, sourceId: 'rune_gilded_ledger', tick: 0 }] as never });
    advanceRuneThresholds(s, 'gold', reward.per);
    if ((s.castFx ?? []).some((c) => c.spellId === spellId)) return s;
  }
  throw new Error(`no seed rolled ${spellId} from the Ledger`);
}

describe("a rune's Shop cast tags its buffs with the spell and the rune", () => {
  it('Rune of the Gilded Ledger casting Growth: the cast is recorded against the rune, and every buff carries growth + the rune', () => {
    const s = ledgerRolling('growth');
    expect(s.castFx).toEqual([{ source: { kind: 'rune', id: 'rune_gilded_ledger' }, spellId: 'growth', phase: 'recruit' }]);
    expect(s.recruitBuffFx.length, 'Growth buffed the board').toBeGreaterThan(0);
    for (const e of s.recruitBuffFx) {
      expect(e.spellId).toBe('growth');
      expect(e.sourceRuneId).toBe('rune_gilded_ledger');
      expect(e.kind, 'a rune has no body: the capture stays spell-kind').toBe('spell');
    }
  });

  it('an UNBOUND spell the Ledger rolls (a targeted stat spell) is tagged the same way, so its trail can stem from the rune', () => {
    const pool = ['spiritfire', 'beefy', 'lanternlight'].filter((id) => CARD_INDEX[id]);
    let s: RunState | undefined;
    for (const id of pool) { try { s = ledgerRolling(id); break; } catch { /* try the next */ } }
    expect(s, 'the Ledger rolled one of the unbound targeted stat spells').toBeDefined();
    const spell = s!.castFx![0]!.spellId;
    expect(s!.recruitBuffFx.length).toBeGreaterThan(0);
    expect(s!.recruitBuffFx.every((e) => e.spellId === spell && e.sourceRuneId === 'rune_gilded_ledger')).toBe(true);
  });

  it('the PLAYER casting Growth from hand is untouched: no spell tag, no rune (its own release-point effect plays)', () => {
    const next = reduce(run({ board: [card('a', 'stray')], hand: [card('g', 'growth')] }), { type: 'play', uid: 'g' });
    expect(next.recruitBuffFx.length).toBeGreaterThan(0);
    expect(next.recruitBuffFx.every((e) => e.spellId === undefined && e.sourceRuneId === undefined)).toBe(true);
  });

  it('Rune of Might answering the player\'s cast: ITS Might of Aeon buffs carry the rune, the player\'s own cast does not', () => {
    const s = run({ board: [card('a', 'stray')], hand: [card('g', 'growth')], runeMight: true, ownedRunes: ['rune_might'] } as Partial<RunState>);
    const next = reduce(s, { type: 'play', uid: 'g' });
    const might = next.recruitBuffFx.filter((e) => e.sourceRuneId === 'rune_might');
    expect((next.castFx ?? []).some((c) => c.source.kind === 'rune' && c.source.id === 'rune_might' && c.spellId === 'mightofaeon')).toBe(true);
    expect(might.length, 'Might of Aeon buffed the stray, tagged to the rune').toBeGreaterThan(0);
    expect(might.every((e) => e.spellId === 'mightofaeon')).toBe(true);
    expect(next.recruitBuffFx.filter((e) => e.sourceRuneId === undefined).every((e) => e.spellId === undefined)).toBe(true);
  });
});

describe("a rune's End-of-Turn cast (Rune of Recurrence) carries the spell and the rune on both End-of-Turn paths", () => {
  const over = { board: [card('a', 'stray')], questRecurringEndOfTurn: ['recastFirstSpell'], firstSpellThisTurnId: 'growth' } as Partial<RunState>;

  it('AUTHORITATIVE: each re-cast\'s stat gain (under the spell\'s own child beat) is stamped growth + castByRune', () => {
    const collector = makeCollector('t', 'endOfTurn');
    withActiveCollector(collector, () => applyEndOfTurn(run(over)));
    const events = collector.finish()?.events ?? [];
    const gains = events.filter((e) => e.type === 'statsChanged' && (e as { target: { uid?: string } }).target.uid === 'a') as { spellId?: string; castByRune?: string }[];
    expect(gains, 'Recurrence casts it twice: two gains').toHaveLength(2);
    expect(gains.every((g) => g.spellId === 'growth' && g.castByRune === 'rune_recurrence')).toBe(true);
    // The casts announce themselves on the RUNE's beat, so the spell's effect stems from the rune (spellResolved).
    expect(events.filter((e) => e.type === 'spellResolved')).toHaveLength(2);
  });

  it('LEGACY: the projected beats\' buff records carry growth + the rune', () => {
    const { fx } = projectEndOfTurnSteps(run(over));
    const onA = fx.flatMap((f) => f.buffFx).filter((e) => e.targetUid === 'a');
    expect(onA.length).toBeGreaterThan(0);
    expect(onA.every((e) => e.spellId === 'growth' && e.sourceRuneId === 'rune_recurrence')).toBe(true);
  });

  it('a MINION-cast spell scope at End of Turn is tagged too, but never with a rune', () => {
    const s = run({ board: [card('m', 'b2_moira', { attack: 3, health: 3 }), card('p', 'b2_magepup', { attack: 1, health: 1, taughtSpellId: 'growth' }), card('a', 'stray')] });
    const collector = makeCollector('t', 'endOfTurn');
    withActiveCollector(collector, () => applyEndOfTurn(s));
    const gains = (collector.finish()?.events ?? []).filter((e) => e.type === 'statsChanged' && (e as { spellId?: string }).spellId === 'growth') as { castByRune?: string }[];
    expect(gains.length).toBeGreaterThan(0);
    expect(gains.every((g) => g.castByRune === undefined)).toBe(true);
  });
});
