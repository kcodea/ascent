/**
 * THE DUOS CUES (audio/duosCues.ts): what each Duos beat plays, read as data. Nobody can hear a headless run, so these
 * pin the things a cue must get right without ears: it is built only from audio the game already had, its hit lands
 * with the last body at any fight speed, and send / receive / mine / theirs are not the same sound.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_FX_CLIPS } from './codeClips';
import {
  DUOS_STINGER_HIT_MS, duosBoardFallenCue, duosFlyInCue, duosLockedInCue, duosMateJoinedCue, duosPassReceiveCue, duosPassSendCue,
  duosPlacementToneAs, duosTagInCue, duosTeamOutCue, duosTeamResultCue, duosViewSwapCue, stingerLanding, type DuosCueLayer,
} from './duosCues';

const ALL: Record<string, DuosCueLayer[]> = {
  tagMine: duosTagInCue('player', 735), tagTheirs: duosTagInCue('enemy', 735), flyIn: duosFlyInCue('player', 500),
  fallenMine: duosBoardFallenCue('player'), fallenTheirs: duosBoardFallenCue('enemy'),
  send: duosPassSendCue(), receive: duosPassReceiveCue(360), swapIn: duosViewSwapCue(true), swapOut: duosViewSwapCue(false),
  joined: duosMateJoinedCue(), locked: duosLockedInCue(), out: duosTeamOutCue(),
  won: duosTeamResultCue(1), second: duosTeamResultCue(2), fourth: duosTeamResultCue(4),
};
const sig = (c: DuosCueLayer[]): string => JSON.stringify(c);

describe('the Duos cues use only audio the game already had', () => {
  it('every fx clip is one code already names (so a phone decodes nothing extra) and exists on disk', () => {
    for (const [name, cue] of Object.entries(ALL)) {
      for (const l of cue) {
        if (l.kind !== 'fx') continue;
        expect(CODE_FX_CLIPS, `${name}: ${l.clip}`).toContain(l.clip);
        const file = join(__dirname, `${l.clip}.mp3`);
        expect(existsSync(file) || existsSync(file.replace(/\.mp3$/, '.wav')), `${name}: ${l.clip}`).toBe(true);
      }
    }
  });

  it('every core clip is a file of the core bank (always decoded)', () => {
    for (const [name, cue] of Object.entries(ALL)) {
      for (const l of cue) {
        if (l.kind !== 'sample') continue;
        expect(l.clip.includes('/'), `${name}: ${l.clip}`).toBe(false);
        expect(existsSync(join(__dirname, `${l.clip}.mp3`)) || existsSync(join(__dirname, `${l.clip}.wav`)), `${name}: ${l.clip}`).toBe(true);
      }
    }
  });

  it('every cue plays something, at sane levels, with no negative delay', () => {
    for (const [name, cue] of Object.entries(ALL)) {
      expect(cue.length, name).toBeGreaterThan(0);
      for (const l of cue) {
        expect(l.delayMs ?? 0, name).toBeGreaterThanOrEqual(0);
        if (l.kind === 'tone') { expect(l.vol, name).toBeGreaterThan(0); expect(l.vol, name).toBeLessThanOrEqual(0.12); expect(l.freq, name).toBeGreaterThan(60); }
        else { expect(l.gain, name).toBeGreaterThan(0); expect(l.gain, name).toBeLessThanOrEqual(1); }
      }
    }
  });
});

describe('the tag-in stinger lands with the last body', () => {
  it('the hit is delayed to the landing when there is room, sped up when there is not', () => {
    expect(stingerLanding(735)).toEqual({ delayMs: 735 - DUOS_STINGER_HIT_MS, rate: 1 });
    const fast = stingerLanding(240); // a 2x fight, a few bodies
    expect(fast.delayMs).toBe(0);
    expect(DUOS_STINGER_HIT_MS / fast.rate).toBeCloseTo(240, 5);
    expect(stingerLanding(20).rate).toBeLessThanOrEqual(2.5); // a Skip: never sped past 2.5x
  });

  it('at 1x, 2x and 5x the hit and the thud land on the given landing time', () => {
    for (const land of [735, 367, 147]) {
      const cue = duosTagInCue('player', land);
      const hit = cue.find((l) => l.kind === 'fx')!;
      const thud = cue.find((l) => l.kind === 'sample')!;
      const hitAt = (hit.delayMs ?? 0) + DUOS_STINGER_HIT_MS / ((hit.kind === 'fx' && hit.rate) || 1);
      if (land >= 192) expect(hitAt).toBeCloseTo(land, 0); // above the 2.5x cap the hit is exact
      else expect(hitAt).toBeLessThanOrEqual(DUOS_STINGER_HIT_MS / 2.5 + 1);
      expect(thud.delayMs).toBe(land);
      // the motif never runs past the landing
      const lastNote = Math.max(...cue.filter((l) => l.kind === 'tone').map((l) => l.delayMs ?? 0));
      expect(lastNote).toBeLessThan(land);
    }
  });
});

describe('the cues are distinct from each other', () => {
  it('send and receive are different sounds, and neither is the sale or the Gild', () => {
    expect(sig(ALL.send!)).not.toBe(sig(ALL.receive!));
    for (const l of [...ALL.send!, ...ALL.receive!]) {
      if (l.kind === 'tone') continue;
      expect(l.clip).not.toMatch(/^sell/);
      expect(l.clip).not.toBe('fx/triple-impact');
      expect(l.clip).not.toBe('fx/metal-woosh');
    }
    // the send rises, the receive falls into the hand
    const notes = (c: DuosCueLayer[]): number[] => c.filter((l) => l.kind === 'tone').map((l) => (l.kind === 'tone' ? l.freq : 0));
    expect(notes(ALL.send!)[1]).toBeGreaterThan(notes(ALL.send!)[0]!);
    expect(notes(ALL.receive!)[2]).toBeLessThan(notes(ALL.receive!)[0]!);
    // the receive's landing follows the stream
    expect(Math.max(...ALL.receive!.map((l) => l.delayMs ?? 0))).toBe(360);
  });

  it('my tag-in rises and theirs falls; my fallen board sinks lower than theirs', () => {
    const notes = (c: DuosCueLayer[]): number[] => c.filter((l) => l.kind === 'tone').map((l) => (l.kind === 'tone' ? l.freq : 0));
    const mine = notes(ALL.tagMine!);
    const theirs = notes(ALL.tagTheirs!);
    expect(mine).toEqual([...mine].sort((a, b) => a - b));
    expect(theirs).toEqual([...theirs].sort((a, b) => b - a));
    expect(sig(ALL.fallenMine!)).not.toBe(sig(ALL.fallenTheirs!));
    const sink = (c: DuosCueLayer[]): number => { const t = c.find((l) => l.kind === 'tone'); return t && t.kind === 'tone' ? t.slideTo ?? 0 : 0; };
    expect(sink(ALL.fallenMine!)).toBeLessThan(sink(ALL.fallenTheirs!));
  });

  it('the view swap goes up onto the teammate and down on the way back', () => {
    const f = (c: DuosCueLayer[]): number[] => c.map((l) => (l.kind === 'tone' ? l.freq : 0));
    expect(f(ALL.swapIn!)[1]).toBeGreaterThan(f(ALL.swapIn!)[0]!);
    expect(f(ALL.swapOut!)[1]).toBeLessThan(f(ALL.swapOut!)[0]!);
  });

  it('a win, a second place and a loss are three different results; the tone follows the half of the table', () => {
    expect(new Set([sig(ALL.won!), sig(ALL.second!), sig(ALL.fourth!)]).size).toBe(3);
    expect(sig(duosTeamResultCue(3))).toBe(sig(ALL.fourth!));
    expect([1, 2, 3, 4].map(duosPlacementToneAs)).toEqual([1, 1, 8, 8]);
  });
});
