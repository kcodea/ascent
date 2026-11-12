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
  duosBoardFallenCue, duosFlyInCue, duosLockedInCue, duosMateJoinedCue, duosPassReceiveCue, duosPassSendCue,
  LAND_RATE_BASE, LAND_RATE_MAX, LAND_RATE_STEP, duosPlacementToneAs, duosTagInCue, duosTeamOutCue, duosTeamResultCue, duosViewSwapCue, type DuosCueLayer,
} from './duosCues';

const ALL: Record<string, DuosCueLayer[]> = {
  tagMine: duosTagInCue('player', [240, 290, 340]), tagTheirs: duosTagInCue('enemy', [240, 290, 340]), flyIn: duosFlyInCue('player', [240, 290]),
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

// Second pass, owner 2026-11-12: "the sound is off". The first cue sped a cinematic whoosh-into-hit up to fit the drop
// (re-pitched per board size) under three synth notes. These pin what replaced it.
// Third pass, owner 2026-11-12: "clean it up and add a tiny bit of whimsy". The cue is the drop's air, one soft thump
// per body (each a touch higher than the last) and a quiet ground hit under the final one.
describe('the tag-in plays what is on screen: a thump per body, one hit under the last', () => {
  const thumps = (cue: DuosCueLayer[]) => cue.filter((l): l is Extract<DuosCueLayer, { kind: 'fx' }> => l.kind === 'fx' && l.clip === 'fx/duos-land');
  /** When a thump's HIT sounds (its file has a 20 ms lead-in, shortened by its rate). */
  const hitAt = (l: Extract<DuosCueLayer, { kind: 'fx' }>): number => (l.delayMs ?? 0) + 20 / (l.rate ?? 1);

  it('one thump on each touchdown, at the times given, and the ground hit on the last', () => {
    for (const lands of [[240], [240, 310, 380], [120, 155, 190, 225, 260, 295, 330]]) {
      const cue = duosTagInCue('player', lands);
      const t = thumps(cue);
      expect(t).toHaveLength(lands.length);
      t.forEach((l, i) => expect(Math.abs(hitAt(l) - lands[i]!), `body ${i}`).toBeLessThanOrEqual(1));
      const hit = cue.filter((l) => l.kind === 'fx' && /ground-impact/.test(l.clip));
      expect(hit).toHaveLength(1);
      expect(hit[0]!.delayMs).toBe(Math.max(...lands));
    }
  });

  it('each thump is a touch higher than the last, by the body\'s turn alone, and never far from true pitch', () => {
    const rates = thumps(duosTagInCue('player', [100, 200, 300, 400, 500, 600, 700])).map((l) => l.rate ?? 1);
    expect(rates[0]).toBe(LAND_RATE_BASE);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeGreaterThanOrEqual(rates[i - 1]!);
    expect(rates[1]! - rates[0]!).toBeCloseTo(LAND_RATE_STEP, 6);
    expect(Math.max(...rates)).toBeLessThanOrEqual(LAND_RATE_MAX);
    // the same turn sounds the same whatever the board size or the fight's speed (the old cue re-pitched by both)
    expect(thumps(duosTagInCue('enemy', [60, 90]))[1]!.rate).toBe(rates[1]);
  });

  it('no synth note plays and the sped-up cinematic stinger is gone', () => {
    for (const cue of [ALL.tagMine!, ALL.tagTheirs!, ALL.flyIn!]) {
      expect(cue.some((l) => l.kind === 'tone')).toBe(false);
      expect(cue.some((l) => l.kind !== 'tone' && /swoosh-impact/.test(l.clip))).toBe(false);
    }
  });

  it('the fly-in is the same thumps with no ground hit', () => {
    const cue = duosFlyInCue('player', [240, 310]);
    expect(thumps(cue)).toHaveLength(2);
    expect(cue.some((l) => l.kind === 'fx' && /ground-impact/.test(l.clip))).toBe(false);
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

  it('my fallen board sinks lower than theirs', () => {
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
