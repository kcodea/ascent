// @vitest-environment jsdom
/**
 * THE SPECTATOR RAIL AND CHAT BUBBLES (owner 2026-11-06, R-SPECTATE-RAIL-01, R-CHAT-BUBBLE-01): who is speaking, for how long,
 * what a reader refuses, and how often "I am typing" goes out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lobbyChatTypingNotice, parseLobbyChatTyping } from '@game/versus-cf/lobbyChat';
import { CHAT_BUBBLE_MAX_MS, CHAT_TYPING_TTL_MS, chatBubbleMs, chatSeatOf, clearChatSpeech, markRailAwake, noteChatSaid, noteChatTyping, RAIL_AWAKE_TAIL_MS, useChatSpeech } from './chatSpeech';
import { LOBBY_CHAT_TYPING_IDLE_MS, LOBBY_CHAT_TYPING_RENEW_MS, noteLobbyChatDraft, receiveLobbyChatEvent, setLobbyChatClockForTests, setLobbyChatMuted, setLobbyChatSession, useLobbyChat } from './lobbyChatStore';

const by = () => useChatSpeech.getState().by;
const awake = () => useChatSpeech.getState().awake;

beforeEach(() => { vi.useFakeTimers(); clearChatSpeech(); });
afterEach(() => { vi.useRealTimers(); });

describe('who is speaking', () => {
  it('an ellipsis, then the line takes its place, then it goes; the row stays open a little longer', () => {
    noteChatTyping('a', 'spectator', true);
    expect(by().a?.kind).toBe('typing');
    expect(awake().a).toBe(true);
    noteChatSaid('a', 'spectator', 'hello');
    expect(by().a).toEqual({ kind: 'text', role: 'spectator', body: 'hello' });
    vi.advanceTimersByTime(chatBubbleMs('hello'));
    expect(by().a).toBeUndefined();
    expect(awake().a).toBe(true);
    vi.advanceTimersByTime(RAIL_AWAKE_TAIL_MS);
    expect(awake().a).toBeUndefined();
  });

  it('a typist who goes silent clears by themselves; "stopped" never removes a said line', () => {
    noteChatTyping('a', 'player', true);
    vi.advanceTimersByTime(CHAT_TYPING_TTL_MS);
    expect(by().a).toBeUndefined();
    noteChatSaid('a', 'player', 'hi');
    noteChatTyping('a', 'player', false);
    noteChatTyping('a', 'player', true);
    expect(by().a?.kind).toBe('text');
  });

  it('a long line stays longer, up to the most; an emote opens a row with no bubble', () => {
    expect(chatBubbleMs('x'.repeat(40))).toBeGreaterThan(chatBubbleMs('x'));
    expect(chatBubbleMs('x'.repeat(2000))).toBe(CHAT_BUBBLE_MAX_MS);
    markRailAwake('e', 1000);
    expect(awake().e).toBe(true);
    expect(by().e).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(awake().e).toBeUndefined();
  });

  it('a live game: the player is the portrait on screen, and a spectator with no row has no face', () => {
    expect(chatSeatOf('p', 'player', null)).toBe('s0');
    expect(chatSeatOf('w', 'spectator', null)).toBeNull();
    expect(chatSeatOf('me', 'player', 'ME')).toBe('s0');
  });
});

describe('the wire (the object stamps who, never the payload)', () => {
  const sender = { userId: 'u1', role: 'spectator' as const, guest: false };
  it('a member passes; a guest or a stranger never does; the payload cannot name someone else', () => {
    expect(lobbyChatTypingNotice(sender, { on: true, from: 'someone-else', role: 'player' })).toEqual({ from: 'u1', role: 'spectator', on: true });
    expect(lobbyChatTypingNotice({ ...sender, guest: true }, { on: true })).toBeNull();
    expect(lobbyChatTypingNotice({ ...sender, role: null }, { on: true })).toBeNull();
    expect(lobbyChatTypingNotice(sender, { on: true, channel: 'team' })?.channel).toBe('team');
  });
  it('a reader refuses a malformed notice', () => {
    expect(parseLobbyChatTyping({ from: 'u1', role: 'nobody', on: true })).toBeNull();
    expect(parseLobbyChatTyping(null)).toBeNull();
    expect(parseLobbyChatTyping({ from: 'u1', role: 'player', on: true })).toEqual({ from: 'u1', role: 'player', on: true });
  });
});

describe('the chat client', () => {
  const sent: { event: string; payload: unknown }[] = [];
  let now = 1000;
  const open = (): void => {
    sent.length = 0;
    setLobbyChatClockForTests(() => now);
    setLobbyChatSession('t', { send: (event, payload) => sent.push({ event, payload }), gameKey: `g${now}`, me: 'me' });
    useLobbyChat.setState({ canSend: true, available: true, enabled: true, muted: {} });
    sent.length = 0;
  };
  const typingSent = (): unknown[] => sent.filter((x) => x.event === 'lobby_chat_typing').map((x) => x.payload);
  afterEach(() => { setLobbyChatSession('t', null); setLobbyChatClockForTests(null); });

  it('sends "typing" once per renew window, and "stopped" when the box empties or the keys stop', () => {
    open();
    noteLobbyChatDraft('h', 'lobby');
    noteLobbyChatDraft('he', 'lobby');
    expect(typingSent()).toEqual([{ on: true }]);
    now += LOBBY_CHAT_TYPING_RENEW_MS;
    noteLobbyChatDraft('hel', 'lobby');
    expect(typingSent()).toHaveLength(2);
    noteLobbyChatDraft('', 'lobby');
    expect(typingSent().at(-1)).toEqual({ on: false });
    noteLobbyChatDraft('x', 'lobby');
    vi.advanceTimersByTime(LOBBY_CHAT_TYPING_IDLE_MS);
    expect(typingSent().at(-1)).toEqual({ on: false });
  });

  it('a muted sender, chat turned off, and my own echo of "typing" show nothing', () => {
    open();
    const notice = { from: 'bob', role: 'spectator', on: true };
    setLobbyChatMuted('bob', true);
    receiveLobbyChatEvent('lobby_chat_typing', notice);
    expect(by().bob).toBeUndefined();
    setLobbyChatMuted('bob', false);
    receiveLobbyChatEvent('lobby_chat_typing', { ...notice, from: 'me' });
    expect(by().me).toBeUndefined();
    useLobbyChat.setState({ enabled: false });
    receiveLobbyChatEvent('lobby_chat_typing', notice);
    expect(by().bob).toBeUndefined();
    useLobbyChat.setState({ enabled: true });
    receiveLobbyChatEvent('lobby_chat_typing', notice);
    expect(by().bob?.kind).toBe('typing');
  });

  it('a message said in the game opens a bubble', () => {
    open();
    receiveLobbyChatEvent('lobby_chat', { id: 'm1', from: 'bob', name: 'Bob', role: 'spectator', body: 'nice board', at: 5 });
    expect(by().bob).toEqual({ kind: 'text', role: 'spectator', body: 'nice board' });
  });
});
