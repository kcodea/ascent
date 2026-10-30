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

import { LobbyChat, type LobbyChatSender } from '@game/versus-cf/lobbyChat';
import { LobbyChatPanel } from './LobbyChatPanel';
import {
  LOBBY_CHAT_ERROR_TEXT, LOBBY_CHAT_GUEST_TEXT, receiveLobbyChatEvent, retryLobbyChat, sendLobbyChat, setLobbyChatClockForTests, setLobbyChatCompany,
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
