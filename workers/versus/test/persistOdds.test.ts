/**
 * R-ODDS-ALL-MODES-01: each seat's fight result carries its display-only `oddsInput` (both whole sides) to the client,
 * but the Supabase archive never stores it (nor counts it against the Ranked Duos finish budget).
 */
import { describe, expect, it } from 'vitest';
import { wireRow } from '../src/persist';
import { withoutOddsInputs } from '../src/core/rankedMatch';

const res = (tag: string): Record<string, unknown> => ({ result: 'win', playerDamage: 3, events: [tag], oddsInput: { player: [], enemy: [] } });

describe('withoutOddsInputs', () => {
  it('drops oddsInput from a 1v1 round, a group round and a ranked finish, leaving the rest', () => {
    const round = { match_id: 'm', round: 2, p1_result: res('a'), p2_result: res('b'), digest: 'd' };
    const w = wireRow({ kind: 'round', row: round as never }) as Record<string, Record<string, unknown>>;
    expect(w.p1_result).toEqual({ result: 'win', playerDamage: 3, events: ['a'] });
    expect(w.p2_result).toEqual({ result: 'win', playerDamage: 3, events: ['b'] });
    expect(round.p1_result.oddsInput, 'never mutates the room copy').toBeTruthy();

    const group = { round: 1, fights: [{ fight: 0, a_result: res('x'), b_result: res('y') }] };
    const g = wireRow({ kind: 'group_round', row: group }) as { fights: Record<string, Record<string, unknown>>[] };
    expect('oddsInput' in g.fights[0]!.a_result!).toBe(false);
    expect('oddsInput' in g.fights[0]!.b_result!).toBe(false);

    const finish = { seats: [], rounds: [{ round: 1, fights: [{ live_result: res('l') }, { live_result: null }] }] };
    const f = withoutOddsInputs(finish) as unknown as { rounds: { fights: { live_result: Record<string, unknown> | null }[] }[] };
    expect(f.rounds[0]!.fights[0]!.live_result).toEqual({ result: 'win', playerDamage: 3, events: ['l'] });
    expect(f.rounds[0]!.fights[1]!.live_result).toBeNull();
  });
});
