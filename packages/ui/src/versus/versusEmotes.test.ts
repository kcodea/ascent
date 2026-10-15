import { afterEach, describe, expect, it } from 'vitest';
import type { EmoteMessage } from '@game/sim';
import { sendEmote, subscribeEmotes } from '../emotes/emoteTransport';
import { installVersusEmotes, parseVersusEmote, receiveVersusEmote, uninstallVersusEmotes, VERSUS_EMOTE_EVENT, VERSUS_OPPONENT_SEAT } from './versusEmotes';

afterEach(() => uninstallVersusEmotes());

describe('Versus emotes through the emote transport seam', () => {
  it('your emote shows locally AND goes out on the match channel as the agreed wire message', () => {
    const sent: [string, unknown][] = [];
    const shown: EmoteMessage[] = [];
    const off = subscribeEmotes((m) => shown.push(m));
    installVersusEmotes('p2', (e, p) => sent.push([e, p]));
    sendEmote({ emoteId: 'wave', seat: 's0', phase: 'shop', offsetMs: 1200, round: 3 });
    expect(shown).toHaveLength(1);
    expect(sent).toEqual([[VERSUS_EMOTE_EVENT, { emoteId: 'wave', seat: 'p2', phase: 'shop', offsetMs: 1200, round: 3 }]]);
    off();
  });

  it("the opponent's emote is shown under the Versus opponent seat; our own echo and junk are ignored", () => {
    const shown: EmoteMessage[] = [];
    const off = subscribeEmotes((m) => shown.push(m));
    installVersusEmotes('p1', () => undefined);
    expect(receiveVersusEmote({ emoteId: 'gg', seat: 'p2', phase: 'combat', offsetMs: 5, round: 4 })).toBe(true);
    expect(receiveVersusEmote({ emoteId: 'gg', seat: 'p1', phase: 'combat', offsetMs: 5, round: 4 })).toBe(false);
    expect(receiveVersusEmote({ emoteId: 7, seat: 'p2' })).toBe(false);
    expect(parseVersusEmote({ emoteId: 'x', seat: 'p3', phase: 'shop', offsetMs: 0, round: 1 })).toBeNull();
    expect(shown).toEqual([{ emoteId: 'gg', seat: VERSUS_OPPONENT_SEAT, phase: 'combat', offsetMs: 5, round: 4 }]);
    off();
  });

  it('uninstalling restores the local loopback (nothing goes to the channel)', () => {
    const sent: unknown[] = [];
    installVersusEmotes('p1', (_e, p) => sent.push(p));
    uninstallVersusEmotes();
    sendEmote({ emoteId: 'wave', seat: 's0', phase: 'shop', offsetMs: 0, round: 1 });
    expect(sent).toEqual([]);
    expect(receiveVersusEmote({ emoteId: 'gg', seat: 'p2', phase: 'shop', offsetMs: 0, round: 1 })).toBe(false);
  });
});
