/**
 * DEV CHAT SANDBOX (owner 2026-11-09: "can we add chat functionality to the practice modes just to make it easier?").
 * DEV ONLY: switched from the dev menu (Actions), never in a player's build.
 *
 * In any game on screen (a Practice game included, with nobody watching) the lobby chat comes up as if a room were
 * connected. A pretend server on this machine answers the panel exactly as the Worker would: the backlog on sync, my
 * sends echoed back stamped (replies included), refusals never. Everything on screen runs its real code (the panel,
 * composer, Enter / Y, unread, mute, bubbles); only the socket is faked.
 *
 *  - FAKE CHATTER: three made-up spectators sit in the stands (the top-left watchers and the rail) and chat every few
 *    seconds: "is typing" first, then a line (no emotes for now), sometimes a reply to me.
 *  - TEAM TAB: the sync says I hold a team seat, so the Lobby / Team tabs show (a Duos game's panel).
 *
 * What it cannot test: the network (a dropped socket, the Worker's refusals and rate limit). Do one real two-browser
 * check (play in one, watch from Live Games in the other) before shipping chat changes.
 */
import { LOBBY_CHAT_EVENT, LOBBY_CHAT_SYNC_EVENT, LOBBY_CHAT_TYPING_EVENT, type LobbyChatMsg } from '@game/versus-cf/lobbyChat';
import { currentUserId } from '../identity';
import { useGame } from '../store';
import { setWatchers } from '../versus/watchers';
import { emoteToken } from '../friends/dm/chatEmotes';
import { DEV_CHAT_OWNER, receiveLobbyChatEvent, setLobbyChatDevClaim, setLobbyChatSession } from './lobbyChatStore';

const KEY = 'ascent.devChatSandbox';
const read = (k: string): boolean => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const write = (k: string, on: boolean): void => { try { localStorage.setItem(k, on ? '1' : '0'); } catch { /* this session only */ } };

let on = read(KEY);
let chatter = read(`${KEY}.chatter`);
let team = read(`${KEY}.team`);

export const devChatSandboxOn = (): boolean => on;
export const devChatChatterOn = (): boolean => chatter;
export const devChatTeamOn = (): boolean => team;

const BOTS = [
  { id: 'devbot-vessa', name: 'Vessa' },
  { id: 'devbot-brannoc', name: 'Brannoc' },
  { id: 'devbot-tunk', name: 'Tunk' },
] as const;

const LINES = [
  'gl hf', 'that shop is cursed', 'ooh triple incoming', 'why did you sell that', 'nice roll',
  'tavern up!', 'freeze it freeze it', 'big board already', 'is that a kobold build?', 'this fight is close',
  'how is that minion so big', 'GG', 'the rune pick was clean', 'watching from work lol', 'one more round',
  'that Deathrattle chain though', 'I would have kept the spell', 'lets gooo', 'unlucky', 'you are cooking',
  'A much longer message to check how the panel wraps text when somebody types a whole paragraph about your board choices',
];
const REPLIES = ['agreed', 'lol yes', 'no way', 'fair', 'true', 'haha', 'trust the process'];
const EMOTES = ['emote_zen_brian'];
const EMOTES_ON = false;

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

let seq = 0;
const nextId = (): string => `dev${Date.now().toString(36)}${(seq++).toString(36)}`;
/** Every stamped message, both channels (a reply needs its original). */
const stored: LobbyChatMsg[] = [];
let gameKey = '';
let live = false;
let chatterTimer: number | null = null;

const me = (): string => currentUserId() ?? 'dev-me';
const myName = (): string => (useGame.getState().playerName ?? '').trim() || 'You';

/** What the pretend server says back: always on a later tick, like a real socket. */
const deliver = (event: string, payload: unknown, ms = 60): void => {
  window.setTimeout(() => { if (live) receiveLobbyChatEvent(event, payload); }, ms);
};

function stamp(m: Omit<LobbyChatMsg, 'id' | 'at'>): LobbyChatMsg {
  const out: LobbyChatMsg = { ...m, id: nextId(), at: Date.now() };
  stored.push(out);
  return out;
}

const replyOf = (id: string | undefined): LobbyChatMsg['reply'] | undefined => {
  const o = id ? stored.find((m) => m.id === id) : undefined;
  return o ? { id: o.id, from: o.from, name: o.name, body: [...o.body].slice(0, 80).join('') } : undefined;
};

/** The pretend Worker: answers what the chat store sends up the socket. */
function serverReceive(event: string, payload: unknown): void {
  const p = (payload ?? {}) as { cid?: string; body?: string; replyTo?: string; channel?: string; since?: string };
  const channel = p.channel === 'team' ? 'team' : 'lobby';
  if (event === LOBBY_CHAT_SYNC_EVENT) {
    const msgs = stored.filter((m) => (m.channel === 'team') === (channel === 'team'));
    const at = p.since ? msgs.findIndex((m) => m.id === p.since) : -1;
    deliver(LOBBY_CHAT_SYNC_EVENT, {
      msgs: at >= 0 ? msgs.slice(at + 1) : msgs, canSend: true,
      ...(p.since ? { since: p.since } : {}), ...(channel === 'team' ? { channel: 'team' } : team ? { team: true } : {}),
    });
    return;
  }
  if (event === LOBBY_CHAT_EVENT && typeof p.body === 'string') {
    const m = stamp({ from: me(), name: myName(), role: 'player', body: p.body, ...(p.cid ? { cid: p.cid } : {}), ...(channel === 'team' ? { channel: 'team' as const } : {}) });
    const reply = replyOf(p.replyTo);
    if (reply) m.reply = reply;
    deliver(LOBBY_CHAT_EVENT, m, 120);
    // Somebody answers me now and then.
    if (chatter && channel === 'lobby' && Math.random() < 0.5) botSays(pick(BOTS), pick(REPLIES), m.id, 900 + Math.random() * 1500);
  }
  // Typing notices go nowhere: nobody real is listening.
}

/** A bot types for a moment, then says `body` (optionally answering `replyTo`). */
function botSays(bot: (typeof BOTS)[number], body: string, replyTo?: string, delay = 0): void {
  window.setTimeout(() => {
    if (!live) return;
    deliver(LOBBY_CHAT_TYPING_EVENT, { from: bot.id, role: 'spectator', on: true }, 0);
    window.setTimeout(() => {
      if (!live) return;
      const m = stamp({ from: bot.id, name: bot.name, role: 'spectator', body });
      const reply = replyOf(replyTo);
      if (reply) m.reply = reply;
      deliver(LOBBY_CHAT_EVENT, m, 0);
    }, 900 + Math.min(2500, body.length * 40));
  }, delay);
}

function chatterTick(): void {
  if (!live || !chatter) return;
  const r = Math.random();
  // No emotes while the lobby chat has none (owner 2026-11-09); r < 0.15 / r < 0.25 sent one before.
  const body = EMOTES_ON ? (r < 0.15 ? `${emoteToken(pick(EMOTES))} ${pick(LINES)}` : r < 0.25 ? emoteToken(pick(EMOTES)) : pick(LINES)) : pick(LINES);
  const lastBot = [...stored].reverse().find((m) => m.from.startsWith('devbot-') && !m.channel);
  botSays(pick(BOTS), body, Math.random() < 0.2 ? lastBot?.id : undefined);
  chatterTimer = window.setTimeout(chatterTick, 4000 + Math.random() * 5000);
}

function stopChatter(): void {
  if (chatterTimer != null) window.clearTimeout(chatterTimer);
  chatterTimer = null;
  setWatchers([]);
}

function startChatter(): void {
  stopChatter();
  if (!live || !chatter) return;
  setWatchers(BOTS.map((b) => ({ id: b.id, name: b.name, profile: null })));
  chatterTimer = window.setTimeout(chatterTick, 1500);
}

/** Bring the pretend room up (in a game) or down. */
function sync(): void {
  const want = on && !useGame.getState().showTitle;
  if (want === live) return;
  live = want;
  if (want) {
    stored.length = 0;
    gameKey = `devchat:${nextId()}`;
    setLobbyChatDevClaim(true);
    setLobbyChatSession(DEV_CHAT_OWNER, { send: serverReceive, gameKey, me: me() });
    startChatter();
  } else {
    stopChatter();
    setLobbyChatDevClaim(false);
  }
}

/** Re-open the room so the sync answer (the Team tab) is asked again. */
function restart(): void {
  if (!live) return;
  live = false;
  stopChatter();
  setLobbyChatDevClaim(false);
  sync();
}

/**
 * THE LONG-MESSAGE DEMO (owner 2026-11-09, to see the rail make room): the top spectator sends a three-bubble message, and
 * while it is up the one under them says something short, so the rows sliding down (and that bubble staying level with
 * its own row) are easy to watch. Turns the sandbox on (and its stands) when they are off.
 */
export function devChatLongDemo(): void {
  if (!on) setDevChatSandbox(true);
  if (!live) return;
  if (!chatter) setWatchers(BOTS.map((b) => ({ id: b.id, name: b.name, profile: null })));
  botSays(BOTS[0], 'Okay so hear me out, I think you should have kept the spell from last turn because the Dwarf board really wants the extra Attack before the big fights start, and honestly the shop has been rolling you nothing but Kobolds anyway so you might as well pivot now while it is still cheap to do it');
  botSays(BOTS[1], 'lol he is not wrong', undefined, 2600);
}

export function setDevChatSandbox(v: boolean): void { on = v; write(KEY, v); sync(); }
export function setDevChatChatter(v: boolean): void { chatter = v; write(`${KEY}.chatter`, v); if (live) { if (v) startChatter(); else stopChatter(); } }
export function setDevChatTeam(v: boolean): void { team = v; write(`${KEY}.team`, v); restart(); }

/** Follow the game on and off the screen. Installed once by the dev menu. */
export function installDevChatSandbox(): () => void {
  sync();
  const unsub = useGame.subscribe((s, prev) => { if (s.showTitle !== prev.showTitle) sync(); });
  return () => { unsub(); live = false; stopChatter(); setLobbyChatDevClaim(false); };
}
