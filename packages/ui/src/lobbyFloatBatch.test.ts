// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// R-PERF-LOBBY-FLOAT-01 (desktop jank pass 2026-10-20): the round's damage floats and knockouts measure EVERY rail row
// before they add anything to the page. A read after an append forces a fresh style + layout, and the per-seat loop did
// that once per seat in the first frame of the revealed shop.
const log = vi.hoisted(() => ({ ops: [] as string[] }));
vi.mock('./fx/playDef', () => ({
  canPlayDefs: () => true,
  playDef: (id: string) => { log.ops.push(`play:${id}`); return {}; },
}));
vi.mock('./stage', () => ({ stageHost: () => document.body, toStage: (v: number) => v }));

const { floatLobbyDamageOnSeats } = await import('./lobbyDamageFx');
const { playLobbyKnockoutOnSeats } = await import('./lobbyKnockoutFx');

function rail(ids: string[]): void {
  document.body.innerHTML = `<div class="lobbyrail">${ids.map((id) => `<div data-seat="${id}"></div>`).join('')}</div>`;
  for (const el of document.querySelectorAll<HTMLElement>('[data-seat]')) {
    el.getBoundingClientRect = () => { log.ops.push(`read:${el.dataset.seat}`); return { left: 10, top: 20, width: 100, height: 40, right: 110, bottom: 60, x: 10, y: 20, toJSON: () => ({}) } as DOMRect; };
  }
  const append = document.body.appendChild.bind(document.body);
  document.body.appendChild = <T extends Node>(n: T): T => { log.ops.push(`append:${n.textContent ?? ''}`); return append(n); };
}

describe('lobby rail FX read every row before writing', () => {
  afterEach(() => { log.ops = []; document.body.innerHTML = ''; });

  it('damage floats: all reads, then all appends, one float per hurt seat', () => {
    rail(['s1', 's2', 's3']);
    const n = floatLobbyDamageOnSeats([{ id: 's1', amount: 3 }, { id: 's2', amount: 0 }, { id: 's3', amount: 5 }]);
    expect(n).toBe(2);
    expect(log.ops).toEqual(['read:s1', 'read:s3', 'append:−3', 'append:−5']);
  });

  it('a seat whose row is not on screen floats nothing', () => {
    rail(['s1']);
    expect(floatLobbyDamageOnSeats([{ id: 's9', amount: 4 }])).toBe(0);
    expect(log.ops).toEqual([]);
  });

  it('knockouts: all reads, then all effects', () => {
    rail(['s4', 's5']);
    expect(playLobbyKnockoutOnSeats(['s4', 's5'])).toBe(2);
    expect(log.ops).toEqual(['read:s4', 'read:s5', 'play:lobby-knockout', 'play:lobby-knockout']);
  });
});
