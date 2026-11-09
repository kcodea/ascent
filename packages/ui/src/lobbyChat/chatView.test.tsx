// @vitest-environment jsdom
/**
 * THE CHAT VIEW (owner 2026-11-09; R-LOBBY-CHAT-VIEW-01): in a game with a lobby chat, Enter (or Y) opens a view with
 * the game dimmed and blurred behind, the history over the board and the chat bar under it, the cursor in the bar.
 * Enter with something typed sends and leaves; Enter with nothing typed leaves; Escape leaves (and never also
 * reaches the game's own Escape); a press on the dimmed game leaves; the game ending leaves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

import { LobbyChat } from '@game/versus-cf/lobbyChat';
import { useGame } from '../store';
import { useChatSpeech } from './chatSpeech';
import { CHAT_SPEAKER_COLOURS, chatSpeakerColour, LobbyChatPanel } from './LobbyChatPanel';
import {
  receiveLobbyChatEvent, setLobbyChatEnabled, setLobbyChatFocus, setLobbyChatHushed, setLobbyChatSession, useLobbyChat,
} from './lobbyChatStore';

const ME = '00000000-0000-4000-8000-000000000001';

let sent: { event: string; payload: unknown }[];
let m: Mounted | null = null;
const view = (): HTMLElement | null => document.querySelector('.cview');
const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.cview-input')!;
const key = (target: EventTarget, k: string): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(e); });
  return e;
};
/** Types into the bar the way React sees a real keystroke. */
const type = (value: string): void => {
  const el = input();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  sent = [];
  useGame.setState({ showTitle: false });
  setLobbyChatEnabled(true);
  setLobbyChatSession('test', { send: (event, payload) => sent.push({ event, payload }), gameKey: `g:${Math.random()}`, me: ME });
  const server = new LobbyChat();
  act(() => { receiveLobbyChatEvent('lobby_chat_sync', JSON.parse(JSON.stringify(server.sync({ role: 'player', guest: false })))); });
  m = mount(<LobbyChatPanel />);
});
afterEach(() => {
  act(() => setLobbyChatFocus(false));
  act(() => setLobbyChatHushed(false));
  m?.unmount();
  m = null;
  setLobbyChatSession('test', null);
});

describe('the chat view (R-LOBBY-CHAT-VIEW-01)', () => {
  it('Enter opens it over the game, the cursor in the bar, in place of the side panel', () => {
    expect(view()).toBeNull();
    const e = key(document.body, 'Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(view()).not.toBeNull();
    expect(document.querySelector('.cview-veil')).not.toBeNull();
    expect(m!.container.querySelector('.lchat')).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it('the Lobby chat button opens the chat view, not a side window', () => {
    const pill = m!.container.querySelector<HTMLButtonElement>('.lchat-pill')!;
    act(() => { pill.click(); });
    expect(view()).not.toBeNull();
    expect(m!.container.querySelector('.lchat-pill')).toBeNull(); // hidden while the view is up
    expect(document.querySelector('.lchat, .lchat-at')).toBeNull();
  });

  it('Y opens it too, and the Y is not typed into the bar', () => {
    const e = key(document.body, 'y');
    expect(e.defaultPrevented).toBe(true);
    expect(view()).not.toBeNull();
    expect(input().value).toBe('');
  });

  it('Enter with something typed sends and leaves the view', () => {
    key(document.body, 'Enter');
    type('gl hf');
    act(() => { input().form!.requestSubmit(); });
    expect(sent.at(-1)).toMatchObject({ event: 'lobby_chat', payload: { body: 'gl hf' } });
    expect(view()).toBeNull();
    expect(useLobbyChat.getState().focus).toBe(false);
  });

  it('Enter with nothing typed leaves the view', () => {
    key(document.body, 'Enter');
    type('   ');
    key(input(), 'Enter');
    expect(view()).toBeNull();
    expect(useLobbyChat.getState().focus).toBe(false);
    expect(sent.some((s) => s.event === 'lobby_chat')).toBe(false);
  });

  it('Escape leaves the view and never reaches the game\'s own Escape', () => {
    key(document.body, 'Enter');
    const game = vi.fn();
    window.addEventListener('keydown', game);
    key(input(), 'Escape');
    window.removeEventListener('keydown', game);
    expect(view()).toBeNull();
    expect(game).not.toHaveBeenCalled();
  });

  it('a press on the dimmed game leaves the view', () => {
    key(document.body, 'Enter');
    act(() => { document.querySelector('.cview-veil')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(view()).toBeNull();
  });

  it('the game ending leaves the view', () => {
    key(document.body, 'Enter');
    act(() => { useGame.setState({ showTitle: true }); });
    expect(view()).toBeNull();
    expect(useLobbyChat.getState().focus).toBe(false);
  });
  it('right-click the button: a red cross, no bubbles, no typing dots, no count; again to undo; the chat still opens', () => {
    const ANN = '00000000-0000-4000-8000-000000000002';
    const server = new LobbyChat();
    const say = (body: string): void => {
      const r = server.post({ userId: ANN, role: 'player', name: 'Ann', guest: false }, { body }, Date.now());
      if (!r.ok) throw new Error('refused');
      act(() => { receiveLobbyChatEvent('lobby_chat', JSON.parse(JSON.stringify(r.msg))); });
    };
    const pill = (): HTMLButtonElement => m!.container.querySelector<HTMLButtonElement>('.lchat-pill')!;
    const right = (): MouseEvent => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); act(() => { pill().dispatchEvent(e); }); return e; };
    say('first');
    expect(Object.keys(useChatSpeech.getState().by)).not.toHaveLength(0);
    expect(pill().querySelector('.dm-unread')).not.toBeNull();
    expect(right().defaultPrevented).toBe(true); // no browser menu
    expect(useLobbyChat.getState().hushed).toBe(true);
    expect(pill().classList.contains('hushed')).toBe(true);
    expect(pill().querySelector('.lchat-hush')).not.toBeNull();
    expect(pill().querySelector('.dm-unread')).toBeNull();
    expect(useChatSpeech.getState().by).toEqual({}); // what was up goes at once
    say('second');
    act(() => { receiveLobbyChatEvent('lobby_chat_typing', { from: ANN, role: 'player', on: true }); });
    expect(useChatSpeech.getState().by).toEqual({});
    expect(localStorage.getItem('ascent.lobbyChat.hushed')).toBe('true');
    act(() => { pill().click(); });
    expect(view()).not.toBeNull(); // still readable
    expect(document.body.textContent).toContain('second');
    act(() => setLobbyChatFocus(false));
    right();
    expect(useLobbyChat.getState().hushed).toBe(false);
    expect(pill().querySelector('.lchat-hush')).toBeNull();
    say('third');
    expect(Object.keys(useChatSpeech.getState().by)).not.toHaveLength(0);
  });

  it('the view has the same mute switch, top right: on, off, and the chat button shows it', () => {
    key(document.body, 'Enter');
    const sw = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.cview-head .cview-hush')!;
    expect(sw().getAttribute('aria-pressed')).toBe('false');
    act(() => { sw().click(); });
    expect(useLobbyChat.getState().hushed).toBe(true);
    expect(sw().getAttribute('aria-pressed')).toBe('true');
    expect(sw().querySelector('.lchat-hush')).not.toBeNull();
    expect(view()).not.toBeNull(); // the view stays up
    key(input(), 'Escape');
    expect(m!.container.querySelector('.lchat-pill.hushed .lchat-hush')).not.toBeNull();
    key(document.body, 'Enter');
    act(() => { sw().click(); });
    expect(useLobbyChat.getState().hushed).toBe(false);
  });

  it('who said what: each speaker their own colour for the game, their name inline at the start of the message', () => {
    expect(chatSpeakerColour('g1', 'Ann')).toBe(CHAT_SPEAKER_COLOURS[0]);
    expect(chatSpeakerColour('g1', 'bob')).toBe(CHAT_SPEAKER_COLOURS[1]);
    expect(chatSpeakerColour('g1', 'ANN')).toBe(CHAT_SPEAKER_COLOURS[0]); // kept, whatever the case
    expect(chatSpeakerColour('g2', 'bob')).toBe(CHAT_SPEAKER_COLOURS[0]); // a new game hands them out afresh
    key(document.body, 'Enter');
    type('gl hf');
    act(() => { input().form!.requestSubmit(); });
    key(document.body, 'Enter'); // the send closed the view: open it again to read the history
    const row = document.querySelector<HTMLElement>('.cview .dm-msg')!;
    expect(row.querySelector('.dm-bubble .cview-who')?.textContent).toBe('You:');
    expect(row.style.getPropertyValue('--who')).toMatch(/^#/);
  });

  it("a reply's quote wears the colour of who said the original, not the replier's", () => {
    const ANN = '00000000-0000-4000-8000-000000000002';
    const BOB = '00000000-0000-4000-8000-000000000003';
    const server = new LobbyChat();
    const say = (userId: string, name: string, body: string, replyTo?: string): string => {
      const r = server.post({ userId, role: 'spectator', name, guest: false }, { body, ...(replyTo ? { replyTo } : {}) }, Date.now());
      if (!r.ok) throw new Error('refused');
      act(() => { receiveLobbyChatEvent('lobby_chat', JSON.parse(JSON.stringify(r.msg))); });
      return r.msg.id;
    };
    const orig = say(ANN, 'Ann', 'the rune pick was clean');
    say(BOB, 'Bob', 'why did you sell that', orig);
    key(document.body, 'Enter');
    const rows = [...document.querySelectorAll<HTMLElement>('.cview .dm-msg')];
    const ann = rows[0]!.style.getPropertyValue('--who');
    const reply = rows[1]!;
    expect(reply.querySelector('.dm-quote-name')?.textContent).toBe('Ann');
    expect(reply.style.getPropertyValue('--quote-who')).toBe(ann);
    expect(reply.style.getPropertyValue('--who')).not.toBe(ann);
  });
});
