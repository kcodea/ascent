// @vitest-environment jsdom
/**
 * LOBBY CHAT on the client (R-LOBBY-CHAT-01), with the game's socket faked (the server rules are
 * `workers/versus/test/lobbyChat.test.ts`, the fan-out over real sockets `workers/versus/test/it/live.it.ts`):
 *  - the panel appears only once the game's object answers the backlog sync (an older Worker relaying a request, or a
 *    Supabase-hosted game, never shows a dead panel); a lone player with nobody watching sees nothing;
 *  - a send shows Sending and is confirmed by the object's echo (same cid); a refusal shows its reason with Retry;
 *  - collapsed, others' messages count as unread (the badge); mine and a muted sender's never do; Mute hides a sender;
 *  - a guest reads only; the Settings switch hides the whole chat; keys typed in the composer never reach the game.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LobbyChat, type LobbyChatSender } from '@game/versus-cf/lobbyChat';
import { stageViewport } from '../stage';
import { clampGeom } from '../chat/chatGeom';
import { defaultLobbyChatGeom, LOBBY_CHAT_LIMITS, LobbyChatPanel, lobbyChatPrefs } from './LobbyChatPanel';
import {
  LOBBY_CHAT_ERROR_TEXT, LOBBY_CHAT_GUEST_TEXT, receiveLobbyChatEvent, resyncLobbyChat, retryLobbyChat, sendLobbyChat, setLobbyChatClockForTests, setLobbyChatCompany,
  setLobbyChatEnabled, setLobbyChatMuted, setLobbyChatOpen, setLobbyChatSession, useLobbyChat,
} from './lobbyChatStore';

const ME = '00000000-0000-4000-8000-000000000001';
const ANN = '00000000-0000-4000-8000-000000000002';
const T0 = Date.UTC(2026, 9, 30, 12);

/** A fake game object: the real server rules, fanned out to this one client. */
let server: LobbyChat;
let sent: { event: string; payload: unknown }[];
let senders: Record<string, LobbyChatSender>;
const install = (me = ME): void => {
  sent = [];
  setLobbyChatSession('test', { send: (event, payload) => sent.push({ event, payload }), gameKey: `g:${Math.random()}`, me });
};
const answerSync = (who = ME): void => { act(() => { receiveLobbyChatEvent('lobby_chat_sync', JSON.parse(JSON.stringify(server.sync(senders[who]!)))); }); };
const deliver = (from: string, body: string, cid?: string, now = T0): void => {
  const r = server.post(senders[from]!, { body, cid }, now);
  act(() => { receiveLobbyChatEvent(r.ok ? 'lobby_chat' : 'lobby_chat_refused', r.ok ? JSON.parse(JSON.stringify(r.msg)) : { cid: r.cid, reason: r.reason }); });
};

let m: Mounted | null = null;
const text = (): string => m?.container.textContent ?? '';
const q = (sel: string): HTMLElement | null => m?.container.querySelector(sel) ?? null;

beforeEach(() => {
  server = new LobbyChat();
  senders = {
    [ME]: { userId: ME, role: 'spectator', name: 'Claudebot1', guest: false },
    [ANN]: { userId: ANN, role: 'player', name: 'Ann', guest: false },
  };
  setLobbyChatClockForTests(() => T0);
  setLobbyChatEnabled(true);
  setLobbyChatOpen(true);
  install();
  m = mount(<LobbyChatPanel />);
});
afterEach(() => {
  m?.unmount();
  m = null;
  setLobbyChatSession('test', null);
  setLobbyChatClockForTests(null);
});

describe('lobby chat panel (R-LOBBY-CHAT-01)', () => {
  it('appears only once the object answers the sync; an older Worker\'s relayed request is not an answer', () => {
    expect(sent[0]).toEqual({ event: 'lobby_chat_sync', payload: {} });
    act(() => { receiveLobbyChatEvent('lobby_chat_sync', {}); });
    expect(q('.lchat')).toBeNull();
    deliver(ANN, 'early');
    answerSync();
    expect(q('.lchat')).not.toBeNull();
    expect(text()).toContain('Lobby chat');
    expect(text()).toContain('Ann');
    expect(text()).toContain('early');
  });

  it('a lone player with nobody watching sees no panel', () => {
    answerSync();
    act(() => setLobbyChatCompany(false));
    expect(q('.lchat')).toBeNull();
    act(() => setLobbyChatCompany(true));
    expect(q('.lchat')).not.toBeNull();
  });

  it('a send shows Sending, then the echo confirms it; a refusal shows its reason and Retry sends again', () => {
    answerSync();
    act(() => { expect(sendLobbyChat('  gl  hf ')).toBeNull(); });
    const out = sent.at(-1)!;
    expect(out.event).toBe('lobby_chat');
    expect(out.payload).toMatchObject({ body: 'gl hf' });
    expect(text()).toContain('Sending');
    const cid = (out.payload as { cid: string }).cid;
    deliver(ME, 'gl hf', cid);
    expect(text()).not.toContain('Sending');
    expect(useLobbyChat.getState().msgs).toHaveLength(1);
    // A refusal.
    act(() => { sendLobbyChat('again'); });
    const cid2 = (sent.at(-1)!.payload as { cid: string }).cid;
    act(() => { receiveLobbyChatEvent('lobby_chat_refused', { cid: cid2, reason: 'rate' }); });
    expect(text()).toContain(LOBBY_CHAT_ERROR_TEXT.rate);
    act(() => retryLobbyChat(cid2));
    expect(sent.at(-1)!.payload).toMatchObject({ body: 'again' });
  });

  it('the local limit mirrors the server (a burst of 5)', () => {
    answerSync();
    const errs: (string | null)[] = [];
    act(() => { for (let i = 0; i < 6; i++) errs.push(sendLobbyChat(`m${i}`)); });
    expect(errs.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(errs[5]).toBe(LOBBY_CHAT_ERROR_TEXT.rate);
  });

  it('collapsed: others\' messages count (the badge); mine and a muted sender\'s never; opening clears it', () => {
    answerSync();
    act(() => setLobbyChatOpen(false));
    expect(q('.lchat')).toBeNull();
    expect(q('.lchat-pill')).not.toBeNull();
    deliver(ANN, 'one');
    deliver(ANN, 'two');
    deliver(ME, 'mine');
    expect(q('.lchat-pill .dm-unread')?.textContent).toBe('2');
    act(() => setLobbyChatMuted(ANN, true));
    deliver(ANN, 'three', undefined, T0 + 5000);
    expect(useLobbyChat.getState().unread).toBe(2);
    act(() => setLobbyChatOpen(true));
    expect(useLobbyChat.getState().unread).toBe(0);
    expect(text()).not.toContain('three'); // muted: hidden on my screen
    expect(text()).toContain('1 muted');
    act(() => { (q('.lchat-unmute') as HTMLButtonElement).click(); });
    expect(text()).toContain('three');
  });

  it('Mute on a message hides that sender', () => {
    answerSync();
    deliver(ANN, 'hello there');
    const mute = [...m!.container.querySelectorAll('button')].find((b) => b.textContent === 'Mute')!;
    act(() => { mute.click(); });
    expect(text()).not.toContain('hello there');
  });

  it('a guest reads only', () => {
    senders[ME] = { ...senders[ME]!, guest: true };
    deliver(ANN, 'hi all');
    answerSync();
    expect(text()).toContain('hi all');
    const input = q('.lchat-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe(LOBBY_CHAT_GUEST_TEXT);
    expect(sendLobbyChat('x')).toBe(LOBBY_CHAT_GUEST_TEXT);
  });

  it('the Settings switch hides lobby chat entirely', () => {
    answerSync();
    act(() => setLobbyChatEnabled(false));
    expect(q('.lchat')).toBeNull();
    expect(q('.lchat-pill')).toBeNull();
    act(() => setLobbyChatEnabled(true));
    expect(q('.lchat')).not.toBeNull();
  });

  it('keys typed in the composer never reach the game\'s shortcuts', () => {
    answerSync();
    const heard: string[] = [];
    const onKey = (e: KeyboardEvent): void => { heard.push(e.key); };
    window.addEventListener('keydown', onKey);
    const input = q('.lchat-input') as HTMLInputElement;
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true })); });
    window.removeEventListener('keydown', onKey);
    expect(heard).toEqual([]);
  });

  it('a new game starts empty; the same game re-installed keeps its messages and asks the backlog again', () => {
    answerSync();
    deliver(ANN, 'kept');
    const key = useLobbyChat.getState().gameKey!;
    act(() => setLobbyChatSession('test', { send: (event, payload) => sent.push({ event, payload }), gameKey: key, me: ME }));
    expect(useLobbyChat.getState().msgs.map((x) => x.body)).toEqual(['kept']);
    expect(sent.at(-1)!.event).toBe('lobby_chat_sync');
    act(() => install());
    expect(useLobbyChat.getState().msgs).toEqual([]);
    expect(useLobbyChat.getState().available).toBe(false);
  });
});

/**
 * THE SAME QUALITY OF LIFE AS THE DIRECT MESSAGES (owner 2026-10-30, R-LOBBY-CHAT-02: "lobby chat needs the same quality
 * of life that dm's have"), from the shared chat parts (`../chat/`).
 */
describe('lobby chat quality of life (R-LOBBY-CHAT-02)', () => {
  const LKEY = 'ascent.lobbyChatWindow.v1';
  let visible = true;
  let focused = true;
  const setPage = (v: boolean, f: boolean = v): void => { visible = v; focused = f; };
  const type = (input: HTMLInputElement, value: string): void => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };
  const ptr = (el: Element, kind: string, x: number, y: number): void => {
    act(() => { el.dispatchEvent(new MouseEvent(kind, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); });
  };
  const post = (from: string, payload: Record<string, unknown>, now = T0): string => {
    const r = server.post(senders[from]!, payload, now);
    if (!r.ok) throw new Error(r.reason);
    act(() => { receiveLobbyChatEvent('lobby_chat', JSON.parse(JSON.stringify(r.msg))); });
    return r.msg.id;
  };
  beforeEach(() => {
    setPage(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
    vi.spyOn(document, 'hasFocus').mockImplementation(() => visible && focused);
    try { localStorage.removeItem(LKEY); } catch { /* */ }
    lobbyChatPrefs.reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    try { localStorage.removeItem(LKEY); } catch { /* */ }
    lobbyChatPrefs.reset();
    document.documentElement.removeAttribute('data-touch-ui');
    document.documentElement.removeAttribute('data-touch-small');
  });

  it("uses the DMs' own components: one message row, one composer, one window frame (no copies)", () => {
    const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
    const panel = src('LobbyChatPanel.tsx');
    const dm = src('../friends/dm/DmConversation.tsx');
    const win = src('../friends/dm/ChatWindow.tsx');
    for (const s of [panel, dm]) {
      expect(s).toMatch(/<ChatRow /);
      expect(s).toMatch(/<ChatComposer /);
      expect(s).not.toMatch(/function (Composer|EmoteButton)\(/);
      expect(s).not.toMatch(/className="dm-bubble/);
    }
    for (const s of [panel, win]) {
      expect(s).toMatch(/<ChatFrame /);
      expect(s).toMatch(/<ChatPinButton /);
      expect(s).not.toMatch(/setPointerCapture/);
    }
  });

  it('emotes: the picker drops a token where I type; it sends, and shows inline (bigger alone)', () => {
    answerSync();
    const input = q('.lchat-input') as HTMLInputElement;
    type(input, 'gg');
    click(q('.lchat .dm-emotebtn'));
    expect(q('.lchat .dm-emotes[role="menu"]')).not.toBeNull();
    click(q('.lchat .dm-emote-pick[aria-label="Add Hi"]'));
    expect(input.value).toBe('gg :emote_hi: ');
    // Escape closes an open picker, and nothing else (no Esc menu underneath).
    click(q('.lchat .dm-emotebtn'));
    const esc = vi.fn();
    window.addEventListener('keydown', esc);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    window.removeEventListener('keydown', esc);
    expect(esc).not.toHaveBeenCalled();
    expect(q('.lchat .dm-emotes')).toBeNull();
    act(() => { (input.form as HTMLFormElement).requestSubmit(); });
    expect(sent.at(-1)!.payload).toMatchObject({ body: 'gg :emote_hi:' });
    post(ANN, { body: ':emote_good_choice:' });
    const bubbles = [...m!.container.querySelectorAll('.lchat-msg .dm-bubble')];
    expect(bubbles[0]!.querySelector('img.dm-emote')?.getAttribute('alt')).toBe('Hi');
    expect(bubbles[0]!.classList.contains('solo')).toBe(false);
    expect(bubbles[1]!.classList.contains('solo')).toBe(true);
  });

  it("replies: Reply shows the bar; the send names the original; the object's quote shows and jumps to it", () => {
    answerSync();
    const orig = post(ANN, { body: 'who wants to duo next?' });
    click(q('.lchat-msg.theirs .dm-reply'));
    expect(q('.lchat .dm-replybar')?.textContent).toContain('Replying to Ann');
    expect(q('.lchat .dm-replybar')?.textContent).toContain('who wants to duo next?');
    const input = q('.lchat-input') as HTMLInputElement;
    type(input, 'me!');
    act(() => { (input.form as HTMLFormElement).requestSubmit(); });
    const out = sent.at(-1)!.payload as { cid: string; replyTo?: string };
    expect(out).toMatchObject({ body: 'me!', replyTo: orig });
    expect(q('.lchat .dm-replybar')).toBeNull();
    // Shown with its quote while it sends, then the object's echo (with the object's own quote) confirms it.
    expect(q('.lchat-msg.mine .dm-quote')?.textContent).toContain('Ann');
    post(ME, { cid: out.cid, body: 'me!', replyTo: orig });
    const mine = q('.lchat-msg.mine')!;
    expect(mine.classList.contains('sending')).toBe(false);
    expect(mine.querySelector('.dm-quote')?.textContent).toContain('who wants to duo');
    click(mine.querySelector('.dm-quote'));
    expect(q(`.lchat-msg[data-mid="${orig}"]`)?.classList.contains('flash')).toBe(true);
    // A plain message carries no reply field (an older Worker never sees one).
    act(() => { sendLobbyChat('plain'); });
    expect('replyTo' in (sent.at(-1)!.payload as object)).toBe(false);
    // Someone else answering me reads "You" on the quote.
    post(ANN, { body: 'nice', replyTo: useLobbyChat.getState().msgs.find((x) => x.body === 'me!')!.id }, T0 + 2000);
    expect([...m!.container.querySelectorAll('.lchat-msg.theirs .dm-quote-name')].at(-1)?.textContent).toBe('You');
  });

  it('read when seen: open but away counts; coming back, a press in the panel, or typing clears it', () => {
    answerSync();
    setPage(false);
    post(ANN, { body: 'one' });
    post(ANN, { body: 'two' });
    expect(useLobbyChat.getState().unread).toBe(2);
    expect(q('.lchat-unread')?.textContent).toBe('2');
    setPage(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(useLobbyChat.getState().unread).toBe(0);
    expect(q('.lchat-unread')).toBeNull();
    // Open and in front of me: never unread.
    post(ANN, { body: 'three' });
    expect(useLobbyChat.getState().unread).toBe(0);
    // Visible but not focused (another window): counts; a press in the panel reads it.
    setPage(true, false);
    post(ANN, { body: 'four' });
    expect(useLobbyChat.getState().unread).toBe(1);
    setPage(true, true);
    act(() => { q('.lchat-list')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(useLobbyChat.getState().unread).toBe(0);
    setPage(true, false);
    post(ANN, { body: 'five' });
    expect(useLobbyChat.getState().unread).toBe(1);
    setPage(true, true);
    type(q('.lchat-input') as HTMLInputElement, 'h');
    expect(useLobbyChat.getState().unread).toBe(0);
  });

  it('a reconnect catches up: the sync names the newest message held; the answer merges once, in order, and counts', () => {
    answerSync();
    const a = post(ANN, { body: 'before the drop' });
    // The socket drops; two messages go out meanwhile (one of them mine, whose echo I never got).
    act(() => { sendLobbyChat('mine while down'); });
    const cid = (sent.at(-1)!.payload as { cid: string }).cid;
    server.post(senders[ANN]!, { body: 'missed one' }, T0 + 100);
    server.post(senders[ME]!, { cid, body: 'mine while down' }, T0 + 200);
    act(() => setLobbyChatOpen(false));
    act(() => resyncLobbyChat());
    expect(sent.at(-1)).toEqual({ event: 'lobby_chat_sync', payload: { since: a } });
    const answer = server.sync(senders[ME]!, sent.at(-1)!.payload);
    expect(answer.since).toBe(a);
    act(() => { receiveLobbyChatEvent('lobby_chat_sync', JSON.parse(JSON.stringify(answer))); });
    // The whole backlog arriving again too (an older Worker ignores `since`): nothing doubles.
    act(() => { receiveLobbyChatEvent('lobby_chat_sync', JSON.parse(JSON.stringify(server.sync(senders[ME]!)))); });
    const st = useLobbyChat.getState();
    expect(st.msgs.map((x) => x.body)).toEqual(['before the drop', 'missed one', 'mine while down']);
    expect(st.msgs.every((x) => !x.state)).toBe(true);
    expect(st.unread).toBe(1); // Ann's, while collapsed; mine never counts
  });

  it('the panel moves by its header, resizes from its grips and keeps its own place; pinned by default', () => {
    answerSync();
    const view = stageViewport();
    const frame = (): HTMLElement => q('.lchat-at')!;
    const vars = (): { x: number; y: number; w: number; h: number } => {
      const st = frame().style;
      return { x: parseFloat(st.getPropertyValue('--dmx')), y: parseFloat(st.getPropertyValue('--dmy')), w: parseFloat(st.getPropertyValue('--dmw')), h: parseFloat(st.getPropertyValue('--dmh')) };
    };
    expect(vars()).toEqual(clampGeom(defaultLobbyChatGeom(view.w, view.h), view.w, view.h, LOBBY_CHAT_LIMITS));
    expect(vars().x).toBe(12); // today's place: the left edge
    expect(frame().classList.contains('pinned')).toBe(true);
    expect(m!.container.querySelectorAll('.lchat-at > .dmchat-rs')).toHaveLength(8);
    const start = vars();
    const head = q('.lchat-head')!;
    ptr(head, 'pointerdown', 50, 300);
    ptr(head, 'pointermove', 150, 260);
    expect(frame().classList.contains('moving')).toBe(true);
    ptr(head, 'pointerup', 150, 260);
    expect(lobbyChatPrefs.use.getState().geom).toMatchObject({ x: start.x + 100, y: start.y - 40 });
    expect(JSON.parse(localStorage.getItem(LKEY)!)).toMatchObject({ geom: { x: start.x + 100 }, pinned: true });
    // Its own key: the DM window's place is not touched.
    expect(localStorage.getItem('ascent.chatWindow.v1')).toBeNull();
    const grip = q('.lchat-at > .dmchat-rs-se')!;
    ptr(grip, 'pointerdown', 400, 600);
    ptr(grip, 'pointermove', 460, 640);
    ptr(grip, 'pointerup', 460, 640);
    expect(vars()).toMatchObject({ w: start.w + 60, h: start.h + 40 });
    // Typing never starts a drag.
    const input = q('.lchat-input')!;
    ptr(input, 'pointerdown', 100, 100);
    ptr(input, 'pointermove', 300, 300);
    expect(frame().classList.contains('moving')).toBe(false);
    ptr(input, 'pointerup', 300, 300);
  });

  it('unpinned, a press outside folds it to the button (the press still reaches the game); pinned, it stays', () => {
    // The last test's drag release armed swallowNextClick (eats the next click within 700 ms): spend it.
    act(() => { document.body.click(); });
    answerSync();
    const board = document.createElement('button');
    const pressed = vi.fn();
    board.addEventListener('pointerdown', pressed);
    document.body.appendChild(board);
    act(() => { board.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(q('.lchat')).not.toBeNull(); // pinned (the default): stays
    click(q('.lchat-pin'));
    expect(q('.lchat-pin')?.getAttribute('aria-pressed')).toBe('false');
    expect(q('.lchat-pin')?.getAttribute('aria-label')).toBe('Pin the lobby chat open while you play');
    act(() => { q('.lchat-list')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(q('.lchat')).not.toBeNull(); // inside: stays
    act(() => { board.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(q('.lchat')).toBeNull();
    expect(q('.lchat-pill')).not.toBeNull();
    expect(pressed).toHaveBeenCalledTimes(2);
    board.remove();
    expect(JSON.parse(localStorage.getItem(LKEY)!)).toMatchObject({ pinned: false });
  });

  it('a phone keeps the compact panel: no grips, no pin, no move; emotes and replies still work', () => {
    m?.unmount();
    document.documentElement.setAttribute('data-touch-ui', '');
    document.documentElement.setAttribute('data-touch-small', '');
    install();
    m = mount(<LobbyChatPanel />);
    answerSync();
    post(ANN, { body: 'hi phone' });
    expect(q('.lchat-at.phone')).not.toBeNull();
    expect(q('.dmchat-rs')).toBeNull();
    expect(q('.dmchat-ghost')).toBeNull();
    expect(q('.lchat-pin')).toBeNull();
    ptr(q('.lchat-head')!, 'pointerdown', 50, 300);
    ptr(q('.lchat-head')!, 'pointermove', 250, 300);
    expect(q('.lchat-at')!.classList.contains('moving')).toBe(false);
    expect(q('.lchat .dm-emotebtn')).not.toBeNull();
    click(q('.lchat-msg.theirs .dm-reply'));
    expect(q('.lchat .dm-replybar')?.textContent).toContain('Replying to Ann');
    expect(document.body.querySelector('[title]')).toBeNull();
  });

  it('chat emotes are 20% larger (owner 2026-10-30) and a line with one keeps the line height (R-CHAT-EMOTE-SIZE-01)', () => {
    const css = readFileSync(join(__dirname, '..', 'friends', 'dm', 'dm.css'), 'utf8');
    const rule = (sel: string): string => new RegExp(`\\n${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('.dm-emote')).toMatch(/height: 1\.8em/);
    expect(rule('.dm-emote')).toMatch(/margin: -0\.225em 0\.08em;/); // 1.8 - 2 x 0.225 = 1.35, the bubble's line height
    expect(css).toMatch(/\.dm-bubble \{[^}]*line-height: 1\.35/);
    expect(rule('.dm-bubble.solo .dm-emote')).toMatch(/height: 2\.88em/);
    const lc = readFileSync(join(__dirname, 'lobbyChat.css'), 'utf8');
    for (const c of lc.matchAll(/cursor: ([^;]+);/g)) expect(c[1]).toMatch(/^url\('\/cursors\//);
    expect(lc).not.toMatch(/infinite/);
  });
});
