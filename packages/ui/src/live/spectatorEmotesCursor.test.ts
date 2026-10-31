// @vitest-environment jsdom
/**
 * SPECTATORS SEE THE PLAYER'S EMOTES AND THEIR HAND IN COMBAT (owner 2026-10-22: "spectators arent seeing when a player
 * emotes, i think only the player sees the emotes" / "i dont think spectators can see player mouse behavior in combat
 * (or emotes) which would be nice to see"). Pinned against a fake network:
 *  - R-SPECTATE-EMOTE-02: a live ranked game's publisher forwards the player's own emote on the game's channel while
 *    watched (never when nobody watches; pinned against the in-memory live game object); a watcher shows it on the watched player's portrait (`s0`); a Versus spectator
 *    shows both players' (the watched seat on the portrait, the other on the foe); a player never takes this path, and
 *    the speaker's own bubble is delivered exactly once (no echo, no double).
 *  - R-REPLAY-EMOTE-01: the stream records every emote shown on the player's screen (never a spectator chip) and a
 *    replay delivers it when its clock reaches it (one the clock skipped past is not played late); a stream recorded
 *    before the change (no `em`) still plays.
 *  - R-SPECTATE-COMBATCURSOR-01: the hand is recorded in the fight and a replay feeds it during a fight frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLobbyRun, decodeStreamEmotes, decodeStreamSegment, encodeStreamEmote, encodeStreamMessage, isStreamSegment, newStreamEncoder,
  sealStreamSegment, type EmoteMessage, type RunState,
} from '@game/sim';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { fakeLiveObject } from './liveFakeObject';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const identity = await import('../identity');
const pubMod = await import('./livePublisher');
const watchMod = await import('./liveWatch');
const cfMod = await import('./liveCf');
const { useSpectate } = await import('../versus/spectate');
const transport = await import('../emotes/emoteTransport');
const vEmotes = await import('../versus/versusEmotes');
const recorder = await import('../replay/streamRecorder');
const rs = await import('../replay/replayStreamPlayer');
const sp = await import('../versus/spectate');
const { SpectatorCursor } = await import('../versus/SpectatorCursor');
const hover = await import('../versus/spectatorHover');

/** A watcher on the object that records what reaches the stands. */
function standsOn(obj: ReturnType<typeof fakeLiveObject>) {
  const sent: { event: string; payload: any }[] = [];
  const sock = obj.raw('watch', { name: 'Claudebot2' }, (m) => { if (m.t === 'bc') sent.push({ event: m.event, payload: m.payload }); });
  return { sock, sent };
}
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const rankedRun = (): RunState => {
  const run = createLobbyRun(1234, 'warden');
  return { ...run, lobby: { ...run.lobby!, unrated: undefined, seats: run.lobby!.seats.map((s, i) => (i === 1 ? { ...s, kind: 'snapshot' } : s)) } } as RunState;
};
const own = (emoteId = 'wave'): EmoteMessage => ({ emoteId, seat: 's0', phase: 'shop', offsetMs: 1200, round: 3 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  identity.setIdentity({ userId: 'u-player', isAnonymous: true } as never);
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vEmotes.resetWatchedEmotes();
  transport.setEmoteTransport(null);
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); identity.setIdentity(null); useSpectate.setState({ active: false, seat: 'p1' });
  cfMod.setCfLiveSocketForTests(null); pubMod.setLivePublishUrlForTests(null); watchMod.setLiveWatchUrlForTests(null);
});

describe('R-SPECTATE-EMOTE-02: the live game forwards the player\'s emotes to the stands', () => {
  it('only while watched; once per emote; the speaker sees their own bubble exactly once', async () => {
    const obj = fakeLiveObject('g');
    cfMod.setCfLiveSocketForTests(obj.make);
    pubMod.setLivePublishUrlForTests(() => 'http://worker');
    const net = standsOn(obj);
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false });
    await flush();
    const heard: EmoteMessage[] = [];
    const unhear = transport.subscribeEmotes((m) => heard.push(m));
    // nobody watching: nothing goes out
    transport.sendEmote(own());
    expect(net.sent.filter((s) => s.event === vEmotes.VERSUS_EMOTE_EVENT)).toEqual([]);
    expect(heard).toHaveLength(1);
    // a watcher: the next emote goes out once, as the Versus wire message for seat p1
    await net.sock.connect();
    await flush();
    expect(pubMod.liveState()?.publishing).toBe(true);
    transport.sendEmote(own('cheer'));
    const out = net.sent.filter((s) => s.event === vEmotes.VERSUS_EMOTE_EVENT);
    expect(out).toEqual([{ event: 'emote', payload: { emoteId: 'cheer', seat: 'p1', phase: 'shop', offsetMs: 1200, round: 3 } }]);
    expect(heard.map((m) => m.emoteId), 'the speaker: one bubble per emote, never an echo').toEqual(['wave', 'cheer']);
    // a served seat's recorded emote (delivered, not said) is never forwarded
    transport.deliverEmote({ ...own('wave'), seat: 's3' });
    expect(net.sent.filter((s) => s.event === vEmotes.VERSUS_EMOTE_EVENT)).toHaveLength(1);
    // the stands empty: forwarding stops
    net.sock.close();
    await flush();
    transport.sendEmote(own('cheer'));
    expect(net.sent.filter((s) => s.event === vEmotes.VERSUS_EMOTE_EVENT)).toHaveLength(1);
    unhear();
    off();
  });
});

describe('R-SPECTATE-EMOTE-02: a spectator shows the watched player\'s emotes', () => {
  it('live watching: the player\'s emote rises from the watched portrait (s0), throttled per seat', async () => {
    const obj = fakeLiveObject('game-e');
    const pub = obj.raw('publish');
    await pub.connect();
    await pub.request('listing', { name: 'Claudebot1', hero: 'warden', round: 3, phase: 'shop' });
    cfMod.setCfLiveSocketForTests(obj.make);
    watchMod.setLiveWatchUrlForTests(() => 'http://worker');
    const net = { push: (e: string, p: unknown) => pub.broadcast(e, p) };
    identity.setIdentity({ userId: 'u-watcher', isAnonymous: true } as never);
    useGame.setState({ replaying: false, showTitle: true });
    expect(await watchMod.watchLiveGame('game-e', { live_host: 'cf:rev' })).toBe(true);
    useSpectate.setState({ active: true, seat: 'p1' });
    const heard: EmoteMessage[] = [];
    const unhear = transport.subscribeEmotes((m) => heard.push(m));
    net.push('emote', { emoteId: 'wave', seat: 'p1', phase: 'combat', offsetMs: 300, round: 4 });
    expect(heard).toEqual([{ emoteId: 'wave', seat: 's0', phase: 'combat', offsetMs: 300, round: 4 }]);
    // a second one inside the cooldown is a flood (the channel is a public broadcast): dropped
    net.push('emote', { emoteId: 'wave', seat: 'p1', phase: 'combat', offsetMs: 400, round: 4 });
    expect(heard).toHaveLength(1);
    vi.advanceTimersByTime(vEmotes.WATCHED_EMOTE_GAP_MS + 1);
    net.push('emote', { emoteId: 'cheer', seat: 'p1', phase: 'shop', offsetMs: 0, round: 5 });
    expect(heard.map((m) => m.emoteId)).toEqual(['wave', 'cheer']);
    // malformed: ignored
    net.push('emote', { emoteId: 5, seat: 'p1' });
    expect(heard).toHaveLength(2);
    unhear();
    watchMod.leaveLiveGame(false);
  });

  it('Versus: a spectator shows both players (watched seat on the portrait, the other on the foe); a player never takes this path', () => {
    const heard: EmoteMessage[] = [];
    const unhear = transport.subscribeEmotes((m) => heard.push(m));
    expect(vEmotes.receiveWatchedEmote({ emoteId: 'wave', seat: 'p2', phase: 'shop', offsetMs: 0, round: 1 }, 'p2', 1000)).toBe(true);
    expect(vEmotes.receiveWatchedEmote({ emoteId: 'cheer', seat: 'p1', phase: 'shop', offsetMs: 0, round: 1 }, 'p2', 1000)).toBe(true);
    expect(heard.map((m) => [m.emoteId, m.seat])).toEqual([['wave', 's0'], ['cheer', vEmotes.VERSUS_OPPONENT_SEAT]]);
    // no watched seat: nothing
    expect(vEmotes.receiveWatchedEmote({ emoteId: 'wave', seat: 'p1', phase: 'shop', offsetMs: 0, round: 1 }, null, 90_000)).toBe(false);
    // a seated player: its own path only (the opponent on the foe; its own echo ignored), never the spectator mapping
    const send = vi.fn();
    vEmotes.installVersusEmotes('p1', send);
    expect(vEmotes.receiveWatchedEmote({ emoteId: 'wave', seat: 'p2', phase: 'shop', offsetMs: 0, round: 2 }, 'p1', 90_000)).toBe(false);
    expect(vEmotes.receiveVersusEmote({ emoteId: 'wave', seat: 'p1', phase: 'shop', offsetMs: 0, round: 2 })).toBe(false);
    heard.length = 0;
    transport.sendEmote(own());
    expect(heard, 'the speaker sees their own bubble once').toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    vEmotes.uninstallVersusEmotes();
    unhear();
  });
});

describe('R-REPLAY-EMOTE-01: the stream records emotes and a replay plays them', () => {
  it('format: an emote round-trips; a segment without emotes (an old replay) is still valid and has none', () => {
    const enc = newStreamEncoder(3, 1000);
    encodeStreamMessage(enc, { x: 0.5, y: 0.5, gx: 0.5, gy: 0.5, ts: 1000 }, 1000);
    encodeStreamEmote(enc, 1800, 's0', 'wave');
    encodeStreamEmote(enc, 2400, 's4', 'cheer');
    const seg = sealStreamSegment(enc);
    expect(isStreamSegment(seg)).toBe(true);
    expect(decodeStreamEmotes(seg)).toEqual([{ t: 1800, seat: 's0', id: 'wave' }, { t: 2400, seat: 's4', id: 'cheer' }]);
    expect(seg.t1).toBe(2400);
    const old = { ...seg };
    delete old.em;
    expect(isStreamSegment(old)).toBe(true);
    expect(decodeStreamEmotes(old)).toEqual([]);
    expect(decodeStreamSegment(old)).toHaveLength(1);
  });

  it('the recorder keeps every seat emote shown (own + served seats), never a spectator chip, in the shop and the fight', () => {
    let round = { wave: 2, shop: true };
    recorder.installStreamRecorder({ clockAt: (t) => t, recording: () => round });
    recorder.resetStream();
    const stop = recorder.startStreamCapture();
    vi.advanceTimersByTime(100);
    transport.sendEmote(own('wave'));
    transport.deliverEmote({ ...own('cheer'), seat: 's5' });
    transport.deliverEmote({ ...own('cheer'), seat: 'w:someone' });
    round = { wave: 2, shop: false }; // the fight
    vi.advanceTimersByTime(500);
    transport.deliverEmote({ ...own('wow'), seat: 's5', phase: 'combat' });
    const segs = recorder.takeStreamSegments();
    expect(segs.flatMap(decodeStreamEmotes).map((e) => [e.seat, e.id])).toEqual([['s0', 'wave'], ['s5', 'cheer'], ['s5', 'wow']]);
    stop();
    recorder.installStreamRecorder(null);
  });

  it('a replay delivers each emote as its clock reaches it, a skipped-past one never late; the hand feeds through a fight', () => {
    let clock = 1000;
    const enc = newStreamEncoder(3, 1000);
    // the hand in the FIGHT (a combat-frame stretch): recorded since 2026-10-22, fed regardless of the frame kind
    encodeStreamMessage(enc, { x: 0.4, y: 0.4, gx: 0.4, gy: 0.4, an: { k: 'u:unit-7', fx: 0.5, fy: 0.5 }, ts: 1010 }, 1010);
    encodeStreamMessage(enc, { x: 0.5, y: 0.5, gx: 0.5, gy: 0.5, ts: 1060 }, 1060);
    encodeStreamEmote(enc, 1500, 's0', 'wave');
    encodeStreamEmote(enc, 4000, 's2', 'cheer');
    const heard: EmoteMessage[] = [];
    const unhear = transport.subscribeEmotes((m) => heard.push(m));
    expect(rs.startStreamPlayback({ v: 1, segs: [sealStreamSegment(enc)] }, () => clock, () => 1)).toBe(true);
    vi.advanceTimersByTime(rs.FEED_MS);
    expect(sp.cursorFeed.pts.length, 'the fight\'s hand is fed').toBeGreaterThan(0);
    expect(heard).toEqual([]);
    clock = 1520;
    vi.advanceTimersByTime(rs.FEED_MS);
    expect(heard.map((m) => [m.seat, m.emoteId])).toEqual([['s0', 'wave']]);
    // a jump far past the second one (a seek forward while playing): not popped late
    clock = 4000 + rs.EMOTE_LATE_MS + 500;
    vi.advanceTimersByTime(rs.FEED_MS);
    expect(heard).toHaveLength(1);
    // a seek back before it: it plays again when reached
    rs.seekStream(3900);
    clock = 4010;
    vi.advanceTimersByTime(rs.FEED_MS);
    expect(heard.map((m) => m.emoteId)).toEqual(['wave', 'cheer']);
    rs.stopStreamPlayback();
    unhear();
  });
});

describe('R-SPECTATE-COMBATCURSOR-01: the stands draw the hand in a fight', () => {
  it('the overlay renders over a combat screen, and the hand over a unit opens the hover of that unit', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('requestAnimationFrame', () => 1); // the overlay's loop is not run here (its sync step is)
    const before = useGame.getState().run;
    useGame.setState({ run: { ...rankedRun(), phase: 'combat' } as RunState });
    // A combat unit wraps its card, and both carry the uid: the hover must reach the INNER card (its own handler opens
    // the preview), the element the sender's closest() anchored to.
    const unit = document.createElement('div');
    unit.className = 'unit';
    unit.setAttribute('data-uid', 'u7');
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-uid', 'u7');
    unit.appendChild(card);
    const box = () => ({ left: 100, top: 100, width: 80, height: 100, right: 180, bottom: 200, x: 100, y: 100, toJSON: () => null }) as DOMRect;
    unit.getBoundingClientRect = box;
    card.getBoundingClientRect = box;
    let cardOver = 0;
    card.addEventListener('mouseover', (e) => { if (e.target === card) cardOver += 1; });
    document.body.appendChild(unit);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(createElement(SpectatorCursor)); });
    expect(host.querySelector('.vsspec-cursor'), 'drawn in combat (it used to render nothing)').not.toBeNull();
    // an older-wire sample (applied on arrival) over the unit
    act(() => { sp.ingestCursor({ gx: 0.1, gy: 0.1, an: { k: 'u:u7', fx: 0.5, fy: 0.5 } }, performance.now()); });
    expect(hover.spectatorHoverKey()).toBe('u:u7');
    expect(cardOver, 'the inner card is hovered, not its wrapper').toBe(1);
    const mover = host.querySelectorAll<HTMLElement>('.ghostmover')[1]!;
    expect(mover.style.opacity).toBe('1');
    act(() => { root.unmount(); });
    sp.resetCursorFeed();
    useGame.setState({ run: before });
    document.body.innerHTML = '';
  });
});
