/**
 * R-TOUCH-AUDIO-QUALITY-01 (owner 2026-10-23, a real iPhone: "the sound effects were all terrible/not loaded"). A phone
 * decodes at the context's own rate (not 32 kHz), folds to mono without cancelling a wide clip, decodes the clips a game
 * needs ahead of their first play, and sizes its LRU for a game's working set. Desktop is untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rawBindings from '../choreo/bindings.json';
import { DIRECT_CALL_SITES } from '../fx/directCalls';
import { buildClipIndex, clipsOfDef, prewarmList } from './clipIndex';
import { CODE_FX_CLIPS } from './codeClips';
import { createPlayStats, PHONE_AUDIO_LRU_BYTES, PHONE_AUDIO_MAX_RATE, phoneDecodeRate, phoneMono } from './phoneAudio';

const prewarmSpy = vi.hoisted(() => vi.fn(() => 0));
vi.mock('../sfx', () => ({ prewarmSfx: prewarmSpy }));
// Imported after the mock is registered (vi.mock is hoisted).
import { __resetPhonePrewarm, combatCardIds, PREWARM_SETTLE_MS, sceneOf, syncPhoneSfxPrewarm, type PrewarmStoreState } from './phonePrewarm';

const AUDIO = __dirname;
const SRC = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(SRC, f), 'utf8');

/** Every clip in the bank, named as sfx.ts names them. */
function bankNames(): string[] {
  const out: string[] = [];
  for (const dir of ['', 'cards', 'heroes', 'ceremony', 'fx']) {
    for (const f of fs.readdirSync(path.join(AUDIO, dir))) {
      if (/\.(mp3|wav|mp4)$/.test(f)) out.push((dir ? `${dir}/` : '') + f.replace(/\.(mp3|wav|mp4)$/, ''));
    }
  }
  return out;
}
/** The shipped defs, read off disk. */
function shippedDefs(): Record<string, unknown> {
  const dir = path.join(SRC, 'fx', 'defs');
  const out: Record<string, unknown> = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return out;
}
const realIndex = () => buildClipIndex(shippedDefs(), rawBindings, Object.keys(DIRECT_CALL_SITES), bankNames(), CODE_FX_CLIPS);

/** Seconds of audio in an MP3 (frame headers) or a WAV (data chunk). */
function clipSeconds(file: string): number {
  const b = fs.readFileSync(file);
  if (file.endsWith('.wav')) {
    let i = 12; let rate = 0; let align = 0;
    while (i < b.length - 8) {
      const id = b.toString('latin1', i, i + 4); const sz = b.readUInt32LE(i + 4);
      if (id === 'fmt ') { rate = b.readUInt32LE(i + 12); align = b.readUInt16LE(i + 20); }
      if (id === 'data') return Math.min(sz, b.length - i - 8) / (rate * align);
      i += 8 + sz + (sz & 1);
    }
    return 0;
  }
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let i = 0;
  if (b.toString('latin1', 0, 3) === 'ID3') i = 10 + ((b[6]! << 21) | (b[7]! << 14) | (b[8]! << 7) | b[9]!);
  let sec = 0;
  while (i + 4 < b.length) {
    if (b[i] === 0xff && (b[i + 1]! & 0xe0) === 0xe0) {
      const ver = (b[i + 1]! >> 3) & 3; const layer = (b[i + 1]! >> 1) & 3;
      const bri = (b[i + 2]! >> 4) & 15; const sri = (b[i + 2]! >> 2) & 3; const pad = (b[i + 2]! >> 1) & 1;
      if (layer === 1 && bri > 0 && bri < 15 && sri < 3 && ver !== 1) {
        const sr = SR[ver]![sri]!; const br = (ver === 3 ? BR1 : BR2)[bri]! * 1000; const spf = ver === 3 ? 1152 : 576;
        sec += spf / sr; i += Math.floor((spf / 8) * br / sr) + pad; continue;
      }
    }
    i++;
  }
  return sec;
}
const fileOf = (name: string): string => {
  for (const ext of ['mp3', 'wav']) { const p = path.join(AUDIO, `${name}.${ext}`); if (fs.existsSync(p)) return p; }
  return '';
};
/** Decoded bytes of a clip on a phone: 48 kHz mono float32. */
const phoneBytes = (name: string): number => { const f = fileOf(name); return f ? clipSeconds(f) * PHONE_AUDIO_MAX_RATE * 4 : 0; };

describe('phone decode rate', () => {
  it('decodes at the context rate, capped at 48 kHz, never at 32 kHz', () => {
    expect(phoneDecodeRate(48000)).toBe(48000);
    expect(phoneDecodeRate(44100)).toBe(44100);
    expect(phoneDecodeRate(96000)).toBe(48000);
    expect(phoneDecodeRate(0)).toBe(48000);
    expect(phoneDecodeRate(Number.NaN)).toBe(48000);
    expect(read('audio/phoneAudio.ts')).not.toContain('32000');
  });
});

describe('phone mono', () => {
  it('averages correlated channels', () => {
    const l = new Float32Array([1, 0.5, -1, 0]); const r = new Float32Array([0.8, 0.5, -0.6, 0]);
    expect(Array.from(phoneMono([l, r])).map((x) => +x.toFixed(4))).toEqual([0.9, 0.5, -0.8, 0]);
  });
  it('keeps the louder channel when the channels cancel', () => {
    const l = new Float32Array([1, -1, 1, -1]); const r = new Float32Array([-0.9, 0.9, -0.9, 0.9]);
    expect(Array.from(phoneMono([l, r]))).toEqual(Array.from(l));
  });
  it('passes one channel through and an empty list as empty', () => {
    const l = new Float32Array([0.25, -0.5]);
    expect(Array.from(phoneMono([l]))).toEqual([0.25, -0.5]);
    expect(phoneMono([]).length).toBe(0);
  });
});

describe('clip index (the shipped defs + bindings)', () => {
  it('reads a sound layer clip off a def', () => {
    expect(clipsOfDef({ layers: [{ primitive: 'sound', params: { clip: 'fx/a' } }, { params: {} }, { params: { clip: 'fx/a' } }] })).toEqual(['fx/a']);
    expect(clipsOfDef(null)).toEqual([]);
  });

  it('the common set is the generic kinds + code-fired defs, small enough to hold all session', () => {
    const idx = realIndex();
    expect(idx.common.size).toBeGreaterThan(0);
    const bytes = [...idx.common].reduce((s, c) => s + phoneBytes(c), 0);
    expect(bytes).toBeLessThan(12 * 1048576);
  });

  it('a card brings its voice clips and its bound FX clips', () => {
    const idx = realIndex();
    const clips = idx.forCard('b2_packstrider');
    expect(clips).toEqual(expect.arrayContaining(['fx/vo-b2-packstrider']));
    for (const c of clips) expect(bankNames()).toContain(c);
    expect(idx.forCard('no_such_card')).toEqual([]);
    expect(idx.forHero('warden')).toEqual(['heroes/warden']);
  });

  it('the prewarm list: hero first, then the cards in order, the heroes on offer, the code clips; no common, no repeats, nothing held', () => {
    const idx = buildClipIndex(
      { d1: { layers: [{ params: { clip: 'fx/one' } }] }, d2: { layers: [{ params: { clip: 'fx/two' } }] }, g: { layers: [{ params: { clip: 'fx/common' } }] } },
      { kinds: { attack: { def: 'g' } }, cards: { a: { death: { def: 'd1' } }, b: { minionPlayed: { def: 'd2' }, death: { def: 'd1' } } } },
      [],
      ['heroes/h1', 'heroes/h1.power', 'heroes/h2', 'cards/a', 'fx/one', 'fx/two', 'fx/common', 'fx/attack'],
      ['fx/attack', 'fx/missing'],
    );
    expect(idx.common.has('fx/common')).toBe(true);
    expect(idx.code).toEqual(['fx/attack']);
    expect(prewarmList(idx, { heroId: 'h1', cardIds: ['b', 'a', 'b'], heroChoices: ['h2', 'h1'] }))
      .toEqual(['heroes/h1', 'heroes/h1.power', 'fx/two', 'fx/one', 'cards/a', 'heroes/h2', 'fx/attack']);
    expect(prewarmList(idx, { cardIds: ['a'] }, (c) => c === 'fx/one')).toEqual(['cards/a', 'fx/attack']);
    // Hero select alone: just the offered heroes' lines.
    expect(prewarmList(idx, { heroChoices: ['h2'] })).toEqual(['heroes/h2']);
  });

  it('a busy game\'s working set fits the phone LRU with room to spare', () => {
    const idx = realIndex();
    // The worst case: the 31 cards with the most clip audio (7 board + 10 hand + 7 Shop + 7 foes), the biggest hero,
    // the heroes on offer, and every code clip.
    const cards = Object.keys(rawBindings.cards).map((id) => [id, idx.forCard(id).reduce((s, c) => s + phoneBytes(c), 0)] as const)
      .sort((a, b) => b[1] - a[1]).slice(0, 31).reduce((s, x) => s + x[1], 0);
    const heroes = [...new Set(bankNames().filter((n) => n.startsWith('heroes/')).map((n) => n.slice(7).split('.')[0]!))]
      .map((h) => idx.forHero(h).reduce((s, c) => s + phoneBytes(c), 0)).sort((a, b) => b - a).slice(0, 4).reduce((s, x) => s + x, 0);
    const code = idx.code.reduce((s, c) => s + phoneBytes(c), 0);
    const working = cards + heroes + code;
    expect(working).toBeGreaterThan(0);
    expect(working).toBeLessThan(PHONE_AUDIO_LRU_BYTES * 0.9);
    // And the cap stays far under the old whole-bank figure (~400 MB): it is a working set, not the bank.
    expect(PHONE_AUDIO_LRU_BYTES).toBeLessThanOrEqual(48 * 1048576);
  });
});

describe('play stats', () => {
  it('counts a miss once per wait and times it to the decode', () => {
    let t = 0;
    const p = createPlayStats(() => t);
    p.miss('a', true); p.miss('a', true); p.hit();
    t = 250; p.ready('a'); p.ready('b');
    expect(p.stats).toMatchObject({ plays: 1, misses: 1, demandMisses: 1, missed: ['a'], lagMs: [250] });
  });
});

describe('phone prewarm from the store', () => {
  afterEach(() => { __resetPhonePrewarm(); prewarmSpy.mockClear(); vi.useRealTimers(); });
  const card = (cardId: string) => ({ uid: cardId, cardId }) as never;
  const state = (over: Partial<PrewarmStoreState['run']> = {}, heroChoices: string[] | null = null): PrewarmStoreState =>
    ({ heroChoices, run: { heroId: 'warden', board: [card('a')], hand: [card('b')], shop: [card('c')], lastCombat: undefined, ...over } as PrewarmStoreState['run'] });

  it('orders the scene board, hand, Shop, spell, then the fight (both boards and the cards its events name)', () => {
    const lastCombat = { initial: { player: [{ cardId: 'p' }], enemy: [{ cardId: 'e' }] }, events: [{ type: 'summon', cardId: 's' }, { type: 'attack' }] } as never;
    expect(combatCardIds(lastCombat)).toEqual(['p', 'e', 's']);
    expect(sceneOf(state({ spell: { cardId: 'sp' } as never, lastCombat }, ['x']))).toEqual({ heroChoices: ['x'], heroId: 'warden', cardIds: ['a', 'b', 'c', 'sp', 'p', 'e', 's'] });
  });

  it('prewarms once per change of scene, after a quiet spell', () => {
    vi.useFakeTimers();
    const s1 = state();
    syncPhoneSfxPrewarm(s1); syncPhoneSfxPrewarm(s1); syncPhoneSfxPrewarm({ ...s1 });
    expect(prewarmSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PREWARM_SETTLE_MS);
    expect(prewarmSpy).toHaveBeenCalledTimes(1);
    syncPhoneSfxPrewarm({ ...s1 }); // same references: nothing to do
    vi.advanceTimersByTime(PREWARM_SETTLE_MS);
    expect(prewarmSpy).toHaveBeenCalledTimes(1);
    syncPhoneSfxPrewarm({ ...s1, run: { ...s1.run, board: [card('a'), card('z')] } });
    vi.advanceTimersByTime(PREWARM_SETTLE_MS);
    expect(prewarmSpy).toHaveBeenCalledTimes(2);
    expect((prewarmSpy.mock.calls[1] as unknown[])[0]).toMatchObject({ cardIds: ['a', 'z', 'b', 'c'] });
  });
});

describe('desktop is untouched', () => {
  it('every new path is behind the phone flag', () => {
    const s = read('sfx.ts');
    expect(s).toContain("if (!LITE_ART) { for (const name of clipNamesInBank()) loadSample(name, 'audio'); return; }"); // desktop: the whole bank, the audio lane, as before
    expect(s).not.toMatch(/^import (?!type )[^;]*from '\.\/audio\/clipIndex';/m); // desktop never loads the clip index (only a type import)
    expect(s).toMatch(/requestAssetTask\(key, lane, \(\) =>\n {4}fetch\(src\)\n {6}\.then\(\(r\) => r\.arrayBuffer\(\)\)\n {6}\.then\(\(ab\) => a\.decodeAudioData\(ab\)\)\n {6}\.then\(\(buf\) => \{ keepBuffer\(name, buf\);/);
    expect(s).toContain('export function prewarmSfx(scene: PrewarmScene): number {\n  if (!LITE_ART) return 0;');
    expect(s).toContain('function touchBuffer(name: string, buf: AudioBuffer): void {\n  if (!LITE_ART || isPhoneResident(name)) return;');
    expect(s).toContain('if (!LITE_ART || isPhoneResident(name)) return;\n  liteAudioBytes');
    expect(read('Game.tsx')).toContain('const unsubSfxPrewarm = LITE_ART ? useGame.subscribe((st) => syncPhoneSfxPrewarm(st)) : () => {};');
  });
});
