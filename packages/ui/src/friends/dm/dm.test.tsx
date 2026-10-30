// @vitest-environment jsdom
/**
 * DIRECT MESSAGES on the client (R-DM-01..05), with the hub socket and Supabase faked:
 *  - send: shown as Sending, replaced by the stored row; a refusal (not friends, blocked, too fast) shows its reason
 *    with Retry; with no hub in this build the composer says messages are not available;
 *  - the hub reconnecting: a message waits in the outbox and goes the moment the hub is back (never dropped);
 *  - receive: a message for a closed conversation counts as unread (dock badge, row chip) and shows the toast; one for
 *    the open conversation is marked read at once;
 *  - offline delivery: the unread counts are read when the hub connects; opening the conversation reads the last 50
 *    and marks them read; Show older pages back;
 *  - live presence: a friend's hub presence overrides the friends list once it is newer;
 *  - the filter (on by default, a Settings switch) masks swear words as I read them; Report records once;
 *  - the composer: Enter sends, focused on open, and typing never reaches the game's shortcuts;
 *  - on a menu the same dock (button, list, conversation) is there (R-FRIENDS-DOCK-02).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../../remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../remoteBoards')>()), remoteEnabled: () => true }));

import type { DmRow, HubPush } from '@game/versus-cf/hub';
import { VersusCfError } from '@game/versus-cf/client';
import { useGame } from '../../store';
import { setIdentity } from '../../identity';
import { resetFriendsForTests, setFriendsRemoteForTests, useFriends } from '../friendsStore';
import type { Friend, FriendsList, FriendsRemote } from '../friendsRemote';
import { setFilterMessages } from '../friendsPrefs';
import { FriendsDock } from '../dock/FriendsDock';
import { openDm, resetDockForTests, useFriendsDock } from '../dock/dockStore';
import type { DmRemote, DmUnread } from './dmRemote';
import {
  DM_ERROR_TEXT, DM_UNAVAILABLE_TEXT, HUB_RESTART_MS, liveFriend, loadOlder, openConversation, resetDmForTests, retryDm, sendDm, setDmDepsForTests,
  startDirectMessages, useDm, type HubHandlers,
} from './dmStore';
import { DmToast } from './DmToast';
import { isProfane, maskProfanity } from './profanity';

const ME = '00000000-0000-4000-8000-000000000001';
const AMY = '00000000-0000-4000-8000-0000000000a1';
const GUS = '00000000-0000-4000-8000-0000000000a2';
const card = (id: string, author: string) => ({ userId: id, author, discriminator: '1234', avatar: null, favoriteHero: null, frame: null, skin: null });
const friend = (id: string, author: string, extra: Partial<Friend> = {}): Friend => ({ ...card(id, author), status: 'online', lastSeen: null, ...extra });
const theList = (): FriendsList => ({
  friends: [friend(AMY, 'Amy'), friend(GUS, 'Gus', { status: 'offline' })], incoming: [], outgoing: [], blocked: [], invites: [], sent: [],
  serverNow: new Date().toISOString(),
});

// ── the fakes ────────────────────────────────────────────────────────────────────────────────────────────────

let seq = 0;
const row = (from: string, to: string, body: string, extra: Partial<DmRow> = {}): DmRow =>
  ({ id: `m-${++seq}`, cid: null, from, to, body, at: new Date(Date.now() + seq).toISOString(), readAt: null, ...extra });

interface FakeHub {
  h: HubHandlers | null;
  hello: Record<string, unknown> | null;
  sent: Array<{ op: string; args: Record<string, unknown> }>;
  /** What `send` answers (a row, or a thrown code). */
  answer: (args: Record<string, unknown>) => DmRow | string;
  /** Requests waiting (the socket is down). */
  held: Array<() => void>;
  down: boolean;
  push(m: HubPush): void;
  reconnect(): void;
}
let hub: FakeHub;
function makeHub(): FakeHub {
  const f: FakeHub = {
    h: null, hello: null, sent: [], held: [], down: false,
    answer: (args) => row(ME, String(args.to), String(args.body), { cid: String(args.cid) }),
    push: (m) => act(() => f.h!.onPush(m)),
    reconnect: () => {
      f.down = false;
      act(() => { f.h!.onHello({ me: ME, peers: [], now: new Date().toISOString() }); f.h!.onStatus('open'); });
      for (const go of f.held.splice(0)) go();
    },
  };
  return f;
}
const factory = (h: HubHandlers) => {
  hub.h = h;
  return {
    connect: async () => { hub.hello = h.hello(); h.onHello({ me: ME, peers: [], now: new Date().toISOString() }); },
    request: <T,>(op: string, args: Record<string, unknown>): Promise<T> => new Promise<T>((resolve, reject) => {
      const go = (): void => {
        hub.sent.push({ op, args });
        if (op !== 'send') { resolve(null as T); return; }
        const a = hub.answer(args);
        if (typeof a === 'string') reject(new VersusCfError(a)); else resolve(a as T);
      };
      if (hub.down) hub.held.push(go); else go();
    }),
    close: () => undefined,
  };
};

let history: Record<string, DmRow[]> = {};
let unreadAnswer: Record<string, DmUnread> = {};
let marked: string[] = [];
let reported: string[] = [];
const remote: DmRemote = {
  history: async (withId, before) => {
    const all = (history[withId] ?? []).slice().sort((a, b) => b.at.localeCompare(a.at));
    return all.filter((r) => !before || r.at < before).slice(0, 50);
  },
  unread: async () => unreadAnswer,
  markRead: async (withId) => { marked.push(withId); return 1; },
  report: async (id) => { reported.push(id); },
};

let ui: Mounted | null = null;
let stop: (() => void) | null = null;
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
const q = (sel: string): HTMLElement | null => document.body.querySelector(sel);
const qa = (sel: string): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>(sel)];
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };
const inRun = (): void => {
  const run = useGame.getState().run;
  useGame.setState({ showTitle: false, heroChoices: null, practiceSetupOpen: false, replaying: false, run: { ...run, mode: 'practice', phase: 'recruit', runId: 'run-me' } });
};
const convo = (id: string) => useDm.getState().convos[id];

beforeEach(async () => {
  seq = 0; history = {}; unreadAnswer = {}; marked = []; reported = [];
  resetFriendsForTests();
  resetDmForTests();
  resetDockForTests();
  setFilterMessages(true);
  setFriendsRemoteForTests({
    beat: async () => ({ friends: 2, online: 1, incoming: 0, invites: [], serverNow: new Date().toISOString() }),
    leave: () => true, list: async () => theList(), subscribeInvites: () => ({ channel: null, close: () => undefined }),
  } as unknown as FriendsRemote);
  setIdentity({ userId: ME, displayName: 'Me', anonymous: false, email: null });
  useGame.setState({ account: { ...useGame.getState().account, userId: ME, anonymous: false } });
  useFriends.setState({ list: theList() });
  hub = makeHub();
  setDmDepsForTests({ factory, remote });
  stop = startDirectMessages();
  await flush();
});
afterEach(() => {
  ui?.unmount(); ui = null;
  stop?.(); stop = null;
  resetDmForTests();
  resetDockForTests();
});

describe('sending (R-DM-01, R-DM-05)', () => {
  it('connects with my presence, then a message shows Sending and becomes the stored row', async () => {
    expect(useDm.getState().hub).toBe('open');
    expect(hub.hello).toMatchObject({ protocol: 1, presence: { status: expect.any(String) } });
    expect(sendDm(AMY, '  hello   there ')).toBeNull();
    const m = convo(AMY)!.msgs[0]!;
    expect(m.body).toBe('hello there');
    await flush();
    expect(convo(AMY)!.msgs).toHaveLength(1);
    expect(convo(AMY)!.msgs[0]).toMatchObject({ body: 'hello there', state: undefined });
    expect(convo(AMY)!.msgs[0]!.id).toMatch(/^m-/);
  });

  it('a refusal shows its reason with Retry, and Retry sends the same message again', async () => {
    hub.answer = () => 'not_friends';
    sendDm(AMY, 'hi');
    await flush();
    expect(convo(AMY)!.msgs[0]).toMatchObject({ state: 'failed', error: DM_ERROR_TEXT.not_friends });
    const cid = convo(AMY)!.msgs[0]!.cid!;
    hub.answer = (args) => row(ME, AMY, 'hi', { cid: String(args.cid) });
    retryDm(AMY, cid);
    await flush();
    expect(convo(AMY)!.msgs).toHaveLength(1);
    expect(convo(AMY)!.msgs[0]!.state).toBeUndefined();
    expect(hub.sent.filter((s) => s.op === 'send').map((s) => s.args.cid)).toEqual([cid, cid]);
  });

  it('too fast and too long read plainly', async () => {
    hub.answer = () => 'rate_limited';
    sendDm(AMY, 'one');
    await flush();
    expect(convo(AMY)!.msgs[0]!.error).toBe('Not sent. You are sending messages too fast.');
    expect(sendDm(AMY, 'x'.repeat(501))).toBe(DM_ERROR_TEXT.bad_body);
  });

  it('while the hub reconnects a message waits, then goes the moment it is back (never dropped)', async () => {
    act(() => hub.h!.onStatus('down'));
    hub.down = true;
    expect(useDm.getState().hub).toBe('down');
    expect(sendDm(AMY, 'are you there?')).toBeNull();
    await flush();
    expect(convo(AMY)!.msgs[0]!.state).toBe('sending');
    expect(hub.sent).toEqual([]);
    hub.reconnect();
    await flush();
    expect(hub.sent.filter((s) => s.op === 'send')).toHaveLength(1);
    expect(convo(AMY)!.msgs[0]!.state).toBeUndefined();
  });

  it('with no hub in this build, sending is refused as not available', async () => {
    stop?.();
    resetDmForTests();
    setDmDepsForTests({ factory: () => null, remote });
    stop = startDirectMessages();
    expect(useDm.getState().hub).toBe('off');
    expect(sendDm(AMY, 'hi')).toBe(DM_UNAVAILABLE_TEXT);
  });
});

describe('a hub that died comes back (R-DM-HUB-URL-01)', () => {
  it('a socket closed for good is replaced after a short wait, and a waiting message still goes', async () => {
    let opened = 0;
    stop?.();
    resetDmForTests();
    setDmDepsForTests({ factory: (h) => { opened += 1; return factory(h); }, remote });
    stop = startDirectMessages();
    await flush();
    expect(opened).toBe(1);
    vi.useFakeTimers();
    try {
      hub.down = true;
      act(() => hub.h!.onStatus('dead', 'closed'));
      expect(useDm.getState().hub).toBe('off');
      expect(sendDm(AMY, 'still there?')).toBeNull();
      expect(convo(AMY)!.msgs[0]!.state).toBe('sending');
      act(() => { vi.advanceTimersByTime(HUB_RESTART_MS); });
      expect(opened).toBe(2);
    } finally {
      vi.useRealTimers();
    }
    hub.down = false;
    await flush();
    hub.reconnect();
    await flush();
    expect(useDm.getState().hub).toBe('open');
    expect(hub.sent.filter((s) => s.op === 'send').map((s) => s.args.body)).toEqual(['still there?']);
    expect(convo(AMY)!.msgs[0]!.state).toBeUndefined();
  });

  it('an old client the hub no longer speaks to, or a game replaced by a newer one, stays off', async () => {
    for (const why of ['version_mismatch', 'replaced']) {
      let opened = 0;
      stop?.();
      resetDmForTests();
      setDmDepsForTests({ factory: (h) => { opened += 1; return factory(h); }, remote });
      stop = startDirectMessages();
      await flush();
      vi.useFakeTimers();
      try {
        // The refused hello (a plain error) may land before the close that says why: still final.
        act(() => hub.h!.onStatus('dead', 'unavailable'));
        act(() => hub.h!.onStatus('dead', why));
        act(() => { vi.advanceTimersByTime(HUB_RESTART_MS * 4); });
      } finally {
        vi.useRealTimers();
      }
      expect(opened).toBe(1);
      expect(useDm.getState().hub).toBe('off');
    }
  });
});

describe('receiving (R-DM-03)', () => {
  it('a message for a closed conversation counts as unread, badges the dock and its row, and shows the toast', async () => {
    inRun();
    ui = mount(<><FriendsDock /><DmToast /></>);
    hub.push({ t: 'dm', msg: row(AMY, ME, 'gg!') });
    hub.push({ t: 'dm', msg: row(AMY, ME, 'rematch?') });
    await flush();
    expect(useDm.getState().unread[AMY]).toBe(2);
    expect(q('.fdock-btn .dm-unread')?.textContent).toBe('2');
    expect(q('.fdock-btn')?.getAttribute('aria-label')).toContain('2 unread messages');
    expect(q('.dm-toast')?.textContent).toContain('rematch?');
    expect(q('.dm-toast')?.textContent).toContain('Amy#1234 (2)');
    // The toast opens the conversation: read at once, the toast goes.
    history[AMY] = [row(AMY, ME, 'gg!'), row(AMY, ME, 'rematch?')];
    click(q('.dm-toast'));
    await flush();
    expect(useFriendsDock.getState()).toMatchObject({ dmWith: AMY, chatTabs: [AMY] });
    expect(q('.dmchat-pane')?.getAttribute('aria-label')).toBe('Messages with Amy#1234');
    expect(useDm.getState().unread[AMY]).toBeUndefined();
    expect(marked).toEqual([AMY]);
    expect(q('.dm-toast')).toBeNull();
    expect(qa('.dm-msg.theirs .dm-bubble').map((e) => e.textContent)).toEqual(['gg!', 'rematch?']);
  });

  it('a message for the open conversation is shown and read at once (no badge, no toast)', async () => {
    inRun();
    ui = mount(<><FriendsDock /><DmToast /></>);
    act(() => openDm(AMY));
    await flush();
    hub.push({ t: 'dm', msg: row(AMY, ME, 'hey') });
    await flush();
    expect(useDm.getState().unread[AMY]).toBeUndefined();
    expect(q('.dm-toast')).toBeNull();
    expect(marked).toEqual([AMY]);
    expect(q('.dm-msg.theirs')?.textContent).toContain('hey');
  });

  it('an offline friend with unread messages shows the count on their row', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    hub.push({ t: 'dm', msg: row(GUS, ME, 'left you a note') });
    click(q('.fdock-btn'));
    await flush();
    expect(qa('.fdock-rowmain').map((e) => e.getAttribute('aria-label'))).toContain('Message Gus#1234, 1 unread');
  });
});

describe('offline delivery and history (R-DM-03)', () => {
  it('unread counts are read when the hub connects; opening reads the last 50 and Show older pages back', async () => {
    stop?.();
    resetDmForTests();
    hub = makeHub();
    unreadAnswer = { [AMY]: { count: 3, last: row(AMY, ME, 'while you were out') } };
    history[AMY] = Array.from({ length: 60 }, (_, i) => row(i % 2 ? AMY : ME, i % 2 ? ME : AMY, `m${i}`));
    setDmDepsForTests({ factory, remote });
    stop = startDirectMessages();
    await flush();
    expect(useDm.getState().unread[AMY]).toBe(3);
    expect(useDm.getState().toast).toMatchObject({ from: AMY, body: 'while you were out', count: 3 });
    await act(async () => { await openConversation(AMY); });
    expect(convo(AMY)!.msgs).toHaveLength(50);
    expect(convo(AMY)!.msgs[49]!.body).toBe('m59');
    expect(convo(AMY)!.hasOlder).toBe(true);
    expect(marked).toEqual([AMY]);
    await act(async () => { await loadOlder(AMY); });
    expect(convo(AMY)!.msgs).toHaveLength(60);
    expect(convo(AMY)!.msgs[0]!.body).toBe('m0');
    expect(convo(AMY)!.hasOlder).toBe(false);
  });
});

describe('live presence (R-DM-01)', () => {
  it('a friend\'s hub presence overrides the list once it is newer', () => {
    const f = friend(GUS, 'Gus', { status: 'offline' });
    const peers = { [GUS]: { userId: GUS, presence: { status: 'in_game' as const, mode: 'ranked' }, at: 0, seenAt: 2000 } };
    expect(liveFriend(f, peers, 1000)).toMatchObject({ status: 'in_game', mode: 'ranked' });
    expect(liveFriend(f, peers, 3000)).toBe(f); // the list is newer
    const gone = { [AMY]: { userId: AMY, presence: null, at: 0, seenAt: 2000 } };
    expect(liveFriend(friend(AMY, 'Amy'), gone, 1000).status).toBe('offline');
  });

  it('peer pushes land in the store', () => {
    hub.push({ t: 'peer', peer: { userId: GUS, presence: { status: 'online' }, at: 1 } });
    expect(useDm.getState().peers[GUS]?.presence?.status).toBe('online');
  });
});

describe('safety (R-DM-04)', () => {
  it('the filter masks swear words and slurs, not ordinary words', () => {
    expect(maskProfanity('what the fuck')).toBe('what the ****');
    expect(maskProfanity('Sh1t happens')).toBe('**** happens');
    expect(maskProfanity('fuuuuck!')).toBe('********');
    expect(maskProfanity('a classic assassin from Scunthorpe')).toBe('a classic assassin from Scunthorpe');
    expect(isProfane('hello')).toBe(false);
  });

  it('the Settings switch shows the original words; Report records once', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    history[AMY] = [row(AMY, ME, 'you are shit')];
    act(() => openDm(AMY));
    await flush();
    expect(q('.dm-msg.theirs .dm-bubble')?.textContent).toBe('you are ****');
    act(() => setFilterMessages(false));
    expect(q('.dm-msg.theirs .dm-bubble')?.textContent).toBe('you are shit');
    click(q('.dm-report'));
    expect(q('.dm-report')?.textContent).toBe('Report?');
    click(q('.dm-report'));
    await flush();
    expect(reported).toEqual([history[AMY]![0]!.id]);
    expect(q('.dm-reported')?.textContent).toBe('Reported');
  });
});

describe('the composer (R-DM-03)', () => {
  it('is focused on open, Enter sends, and typing never reaches the game', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    act(() => openDm(AMY));
    await flush();
    const input = q('.dm-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    const gameKeys: string[] = [];
    const onKey = (e: KeyboardEvent): void => { gameKeys.push(e.key); };
    window.addEventListener('keydown', onKey);
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
    window.removeEventListener('keydown', onKey);
    expect(gameKeys).toEqual([]);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'see you there');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { (input.form as HTMLFormElement).requestSubmit(); });
    await flush();
    expect(hub.sent.find((s) => s.op === 'send')?.args.body).toBe('see you there');
    expect(input.value).toBe('');
    expect(q('.dm-msg.mine .dm-bubble')?.textContent).toBe('see you there');
  });
});

describe('the dock on a menu (R-DM-03, R-FRIENDS-DOCK-02)', () => {
  it('on the title, the same dock button and list open the conversation; a toast opens it there too', async () => {
    useGame.setState({ showTitle: true });
    ui = mount(<FriendsDock />);
    await flush();
    click(q('.fdock-btn'));
    await flush();
    click(q('.fdock-rowmain[aria-label="Message Amy#1234"]'));
    await flush();
    expect(q('.dmchat-pane')?.getAttribute('aria-label')).toBe('Messages with Amy#1234');
    expect(q('.dmchat-veil.ingame')).toBeNull(); // a menu: the fuller dim
    expect(q('.fdock-btn')).not.toBeNull();
  });
});
