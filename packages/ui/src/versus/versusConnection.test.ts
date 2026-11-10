// @vitest-environment jsdom
/**
 * R-VERSUS-LINK-STATUS-01: what the connection status shows for the transport's real state, and
 * R-DUOS-CURSOR-GATE-01: the cursor stream is its own switch on the spectator tap.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LINK_LOST_AFTER_MS, LINK_SHOW_AFTER_MS, noteVersusLink, reclaimVersusLink, setVersusLinkActions, useVersusLink, versusLinkView, type VersusLinkView } from './versusConnection';
import { setSpectatorCursor, setSpectatorTap, spectatorCursorOn } from './spectateTap';

const view = (o: Partial<Parameters<typeof versusLinkView>[0]> & { status?: 'idle' | 'open' | 'down' | 'dead'; reason?: string | null }): VersusLinkView =>
  versusLinkView({ link: { status: o.status ?? 'down', reason: o.reason ?? null }, downFor: 0, inRoom: true, seated: true, inMatch: true, mode: 'ranked_duos', ...o });

afterEach(() => { setVersusLinkActions(null); useVersusLink.setState({ status: 'idle', since: 0, reason: null, reclaiming: false }); setSpectatorTap(false, null, null); setSpectatorCursor(true); });

describe('versusLinkView (R-VERSUS-LINK-STATUS-01)', () => {
  it('connected, or not in a room: nothing', () => {
    expect(view({ status: 'open' }).kind).toBe('none');
    expect(view({ status: 'idle' }).kind).toBe('none');
    expect(view({ status: 'down', downFor: 60_000, inRoom: false }).kind).toBe('none');
  });

  it('THE BUG: my socket down showed nothing for 20 s. Now: nothing for a blip, then Reconnecting, then Connection lost', () => {
    expect(view({ downFor: LINK_SHOW_AFTER_MS - 1 }).kind).toBe('none');
    expect(view({ downFor: LINK_SHOW_AFTER_MS })).toMatchObject({ kind: 'reconnecting', title: 'Reconnecting', body: null, actions: false });
    expect(view({ downFor: LINK_LOST_AFTER_MS - 1 }).kind).toBe('reconnecting');
    expect(view({ downFor: LINK_LOST_AFTER_MS })).toMatchObject({ kind: 'lost', title: 'Connection lost', actions: false });
  });

  it('"what happens next" is true for the mode: Ranked Duos fights on at once, the other modes wait 30 s first', () => {
    expect(view({ downFor: 20_000, mode: 'ranked_duos' }).body).toBe('Still trying. Your board fights on its own until you are back.');
    for (const mode of ['duos', 'group', 'duel'] as const) {
      expect(view({ downFor: 20_000, mode }).body).toBe('Still trying. The match waits 30 seconds for you. After that your board fights on its own.');
    }
    expect(view({ downFor: 20_000, inMatch: false }).body).toBe('Still trying to reconnect.');
  });

  it('a spectator sees no strip for a drop (nothing of theirs is at stake)', () => {
    expect(view({ downFor: 20_000, seated: false }).kind).toBe('none');
  });

  it('THE BUG: a second tab froze the first with no message. Now: "open somewhere else", with the two ways on', () => {
    expect(view({ status: 'dead', reason: 'replaced' })).toMatchObject({ kind: 'elsewhere', actions: true });
    expect(view({ status: 'dead', reason: 'replaced', seated: false }).kind).toBe('elsewhere'); // a watcher too
    expect(view({ status: 'dead', reason: 'version_mismatch' })).toMatchObject({ kind: 'closed', body: 'The game was updated. Reload the page to keep playing.' });
    expect(view({ status: 'dead', reason: 'something_new' })).toMatchObject({ kind: 'closed', actions: true });
    // A closed room has its own screen: the status stays out of it.
    expect(view({ status: 'dead', reason: 'room_closed' }).kind).toBe('none');
  });

  it('the copy holds the writing rules: short plain sentences, no dash, never the retired words', () => {
    const all = [
      view({ downFor: 2_000 }), view({ downFor: 20_000, mode: 'ranked_duos' }), view({ downFor: 20_000, mode: 'duos' }), view({ downFor: 20_000, inMatch: false }),
      view({ status: 'dead', reason: 'replaced' }), view({ status: 'dead', reason: 'version_mismatch' }), view({ status: 'dead', reason: 'unauthorized' }),
      view({ status: 'dead', reason: 'refused' }), view({ status: 'dead', reason: 'x' }),
    ].flatMap((v) => [v.title, v.body ?? '']);
    for (const text of all) {
      expect(text).not.toMatch(/—|–|--/);
      expect(text).not.toMatch(/oath|climb/i);
    }
  });
});

describe('the link store', () => {
  it('a repeat of the same state keeps when it began; a new state restarts it', () => {
    noteVersusLink('down', null, 1_000);
    noteVersusLink('down', null, 5_000);
    expect(useVersusLink.getState()).toMatchObject({ status: 'down', since: 1_000 });
    noteVersusLink('open', null, 6_000);
    expect(useVersusLink.getState()).toMatchObject({ status: 'open', since: 6_000 });
  });

  it('"Play here" asks the transport once, and is busy while it does', async () => {
    let calls = 0;
    let done: () => void = () => undefined;
    setVersusLinkActions({ reclaim: () => { calls++; return new Promise<void>((r) => { done = r; }); }, drop: () => undefined });
    noteVersusLink('dead', 'replaced');
    const p = reclaimVersusLink();
    void reclaimVersusLink(); // a second press while the first is out
    expect(useVersusLink.getState().reclaiming).toBe(true);
    done();
    await p;
    expect(calls).toBe(1);
    expect(useVersusLink.getState().reclaiming).toBe(false);
  });
});

describe('the cursor stream is its own switch (R-DUOS-CURSOR-GATE-01)', () => {
  it('THE BUG: in Duos the cursor streamed all game. Now only while someone can see it; the frames tap stays on', () => {
    const sent: string[] = [];
    setSpectatorTap(true, 'p1', (e) => sent.push(e));
    expect(spectatorCursorOn()).toBe(true); // default: as before (a live lobby game never sets the switch)
    setSpectatorCursor(false); // my teammate is not viewing me and the stands are empty
    expect(spectatorCursorOn()).toBe(false);
    setSpectatorCursor(true); // they opened my screen
    expect(spectatorCursorOn()).toBe(true);
    setSpectatorTap(false, null, null); // nobody at all
    expect(spectatorCursorOn()).toBe(false);
    setSpectatorCursor(false);
    setSpectatorTap(true, 'p1', (e) => sent.push(e));
    expect(spectatorCursorOn()).toBe(false); // the tap coming back does not bring the cursor with it
  });
});
