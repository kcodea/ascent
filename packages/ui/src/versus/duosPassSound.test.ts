// @vitest-environment jsdom
/**
 * THE PASS HAS ITS OWN SOUND (duos beats 2026-11-10). A pass used to ring the SELL sound and then the Gild trail's two
 * clips (its FX defs began as a copy of `gild-trail`), identical for sending and receiving. Now every send plays the
 * send cue and every arrival the receive cue, each through ONE voice, and the defs' Gild sound layers are muted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ send: 0, receive: [] as number[] }));
vi.mock('../audio/duosCues', async (orig) => {
  const real = await orig<typeof import('../audio/duosCues')>();
  return { ...real, duosPassSendCue: () => { calls.send += 1; return []; }, duosPassReceiveCue: (landMs: number) => { calls.receive.push(landMs); return []; } };
});

const { DUOS_PASS_GAP_MS, resetDuosCueGate, sfx } = await import('../sfx');

const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
let now = 1000;
beforeEach(() => { calls.send = 0; calls.receive.length = 0; now = 1000; resetDuosCueGate(); vi.spyOn(performance, 'now').mockImplementation(() => now); });
afterEach(() => vi.restoreAllMocks());

describe('one voice per pass cue', () => {
  it('a board of gift effects shipping on one beat rings the send once, not once per gift', () => {
    for (let i = 0; i < 6; i++) sfx.duosPassSend();
    expect(calls.send).toBe(1);
    now += DUOS_PASS_GAP_MS + 1;
    sfx.duosPassSend();
    expect(calls.send).toBe(2);
  });

  it('send and receive are separate voices: a pass arriving as one leaves rings both', () => {
    sfx.duosPassSend();
    sfx.duosPassReceive(360);
    sfx.duosPassReceive(360); // a second arrival on the same frame
    expect(calls.send).toBe(1);
    expect(calls.receive).toEqual([360]);
  });
});

describe('the pass plays its own cue everywhere a pass plays', () => {
  const lob = src('passLob.ts');
  it('every send goes through playDrop, which rings the send cue and mutes the def\'s Gild sound layers', () => {
    const drop = lob.slice(lob.indexOf('export function playDrop'), lob.indexOf('export function playSpellPass'));
    expect(drop).toContain('sfx.duosPassSend();');
    expect(drop).toMatch(/playDef\('duos-pass-send',[^\n]*muteSound: true/);
  });
  it('every arrival goes through playEmerge, which rings the receive cue timed to the card forming', () => {
    const emerge = lob.slice(lob.indexOf('export function playEmerge'), lob.indexOf('export function playArrival'));
    expect(emerge).toContain('sfx.duosPassReceive(formAt);');
    expect(emerge).toMatch(/playDef\('duos-pass-arrive',[^\n]*muteSound: true/);
    expect(emerge).toContain('window.setTimeout(form, formAt);');
  });
  it('no pass site rings the sell sound any more (the drag, the stands)', () => {
    const recruit = src('../Recruit.tsx');
    const pass = recruit.slice(recruit.indexOf('playDrop({ from, zoom, plate'), recruit.indexOf("notePassRefused(why ?? 'Passing is closed')"));
    expect(pass.length).toBeGreaterThan(50);
    expect(pass).not.toContain('sfx.sell');
    const stands = src('spectate.ts');
    for (const line of stands.split('\n').filter((l) => l.includes('playWatchedDragPass('))) expect(line).not.toContain('sfx.sell');
  });
  it('the defs keep their (unused) sound layers: nothing of the authored files was deleted', () => {
    for (const id of ['duos-pass-send', 'duos-pass-arrive']) {
      const def = JSON.parse(src(`../fx/defs/${id}.json`)) as { layers: { primitive: string }[] };
      expect(def.layers.filter((l) => l.primitive === 'sound')).toHaveLength(2);
    }
  });
});
