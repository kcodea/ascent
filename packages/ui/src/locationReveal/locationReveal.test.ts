/**
 * THE LOCATION REVEAL (owner 2026-11-24; rules R-LOCATION-01..03): which place a game shows, its parchments, the clock the
 * picture, the words and the sound all read, and the fit on a wide window.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETS } from '@game/content';
import { DEFAULT_PRACTICE_CONFIG, runTribesForSeed, VERSUS_HERO_SELECT_SECONDS, VERSUS_REVEAL_SECONDS, type PracticeConfig } from '@game/sim';
import { versusHeroSelectMs } from '@game/sim/versus/server';
import { LOCATIONS, locationName, locationOfSet, POSTER_NAME, postersFor } from './locations';
import { pendingLocation, pendingReveal, practiceLocation } from './pendingLocation';
import { versusHeroClock, versusLocation, versusReveal } from './versusReveal';
import { showOf, slideFor, stageHeight } from './revealGl';
import { revealCues } from './revealSound';
import { A, fitOf, HOLD, L, NAME, outroAt, POST, posterName, posterPose, posterRest, postDone, realOf, revealSeconds, simEnd, simOf, START, T0, washAt, washR, washReach } from './revealTimeline';

const PUBLIC = join(__dirname, '../../../../apps/web/public/locations');
const cfg = (over: Partial<PracticeConfig> = {}): PracticeConfig => ({ ...DEFAULT_PRACTICE_CONFIG, ...over });

describe('the locations', () => {
  it('Set 2 is the Outskirts and Set 3 the Underbelly; Sets 1 and 4 have none', () => {
    expect(locationName(LOCATIONS.outskirts)).toBe('The Outskirts');
    expect(locationName(LOCATIONS.underbelly)).toBe('The Underbelly');
    expect(locationOfSet('set2')?.id).toBe('outskirts');
    expect(locationOfSet('set3')?.id).toBe('underbelly');
    for (const id of ['set1', 'set4'] as const) { expect(locationOfSet(id)).toBeNull(); expect(SETS[id].location).toBeUndefined(); }
  });

  it('each hangs exactly its own tribes, and ships every picture and sound it names', () => {
    for (const l of Object.values(LOCATIONS)) {
      expect([...l.posters].sort()).toEqual([...SETS[l.setId].tribes].sort());
      for (const f of ['flat', 'blur', 'data', 'layer0', 'layer1', 'layer2', 'layer3', ...l.posters.map((t) => `poster-${t}`)]) {
        expect(existsSync(join(PUBLIC, l.id, `${f}.webp`)), `${l.id}/${f}`).toBe(true);
      }
      for (const t of l.posters) expect(POSTER_NAME[t]).toBeTruthy();
      for (const c of revealCues(l.id, 5)) expect(existsSync(join(PUBLIC, 'sfx', `${c.clip}.mp3`)), c.clip).toBe(true);
    }
  });

  it('Ranked is always the Outskirts, Practice is its own pick, God Mode the live one, every other mode none', () => {
    const at = (mode: string, d: Partial<PracticeConfig> = {}) => pendingLocation({ pendingMode: mode, pendingSeed: 1, practiceDraft: cfg(d) })?.id ?? null;
    expect(at('lobby', { setId: 'set3' })).toBe('outskirts');
    expect(at('practice')).toBe('outskirts');
    expect(at('practice', { setId: 'set3' })).toBe('underbelly');
    expect(at('practice', { setId: 'set4' })).toBe('outskirts');
    expect(practiceLocation(cfg({ setId: 'set3', godMode: true }))?.id).toBe('outskirts');
    for (const m of ['gauntlet', 'versus', 'rift', 'tutorial']) expect(at(m)).toBeNull();
  });

  it('the parchments are the tribes in that game, in the location\'s order', () => {
    expect(postersFor(LOCATIONS.outskirts, ['demon', 'beast'])).toEqual(['beast', 'demon']);
    const r = pendingReveal({ pendingMode: 'practice', pendingSeed: 7, practiceDraft: cfg({ setId: 'set3', tribes: ['spirit', 'undead'] }) });
    expect(r?.location.id).toBe('underbelly');
    expect(r?.tribes).toEqual(['undead', 'spirit']);
    expect(pendingReveal({ pendingMode: 'practice', pendingSeed: undefined, practiceDraft: cfg() })).toBeNull();
  });
});

describe('the live modes (owner 2026-11-24, R-LOCATION-03)', () => {
  const full = versusHeroSelectMs('set2');
  const at = (over: Partial<Parameters<typeof versusReveal>[0]> = {}) => versusReveal({ setId: 'set2', runSeed: 5, phase: 'hero_select', paused: false, remainingMs: full, ...over });

  it('the match is played at the location of its set, with the tribes of that player', () => {
    expect(versusLocation('set2')?.id).toBe('outskirts');
    expect(versusLocation('set3')?.id).toBe('underbelly');
    for (const s of ['set1', 'nonsense', null, undefined]) expect(versusLocation(s)).toBeNull();
    expect(at()?.location.id).toBe('outskirts');
    expect(at()?.tribes).toEqual(postersFor(LOCATIONS.outskirts, runTribesForSeed(5, 'set2')));
  });

  it('the server\'s own seconds for it cover the longest reveal and what it may wait for, so the pick keeps its 20', () => {
    for (const l of Object.values(LOCATIONS)) {
      expect(revealSeconds(l.posters.length) + 0.9).toBeLessThanOrEqual(VERSUS_REVEAL_SECONDS);
      expect(versusHeroSelectMs(l.setId)).toBe((VERSUS_HERO_SELECT_SECONDS + VERSUS_REVEAL_SECONDS) * 1000);
    }
    expect(versusHeroSelectMs('set1')).toBe(VERSUS_HERO_SELECT_SECONDS * 1000);
  });

  it('it never eats the pick clock: a server without the extra seconds, a late arrival, a pause or a later phase skip it', () => {
    expect(at({ remainingMs: VERSUS_HERO_SELECT_SECONDS * 1000 })).toBeNull();
    expect(at({ remainingMs: full - 6000 })).toBeNull();
    expect(at({ remainingMs: full - 1500 })).not.toBeNull();
    for (const o of [{ remainingMs: null }, { paused: true }, { phase: 'shop' }, { setId: 'set1' }]) expect(at(o)).toBeNull();
  });

  it('the clock face waits at 20 through it', () => {
    expect(versusHeroClock(full)).toEqual({ shownMs: 20_000, holdMs: full - 20_000 });
    expect(versusHeroClock(20_000)).toEqual({ shownMs: 20_000, holdMs: 0 });
    expect(versusHeroClock(7000)).toEqual({ shownMs: 7000, holdMs: 0 });
  });
});

describe('the clock', () => {
  it('runs the break, the landing, the art alone, the name, the parchments, the hold, the exit, in that order', () => {
    for (const n of [1, 3, 5]) {
      const order = [START, T0, L, NAME, POST, postDone(n), outroAt(n), washAt(n), simEnd(n)];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(outroAt(n) - postDone(n), 'every parchment stays open to be read').toBeCloseTo(HOLD);
    }
    expect(NAME - L, 'the painting has the stage to itself first').toBeGreaterThan(1);
    expect(revealSeconds(5)).toBeLessThan(12);
  });

  it('never stops: wall time and reveal time map one to one, and it never runs slower than half speed', () => {
    for (let s = 0; s < 12; s += 0.037) expect(simOf(realOf(s))).toBeCloseTo(s, 2);
    for (let s = 0.02; s < 12; s += 0.02) expect((realOf(s) - realOf(s - 0.02)) / 0.02).toBeLessThan(2);
  });

  it('the parchments drop left to right, open fully, sway, then roll back up; their NAMES never move (owner 2026-11-24)', () => {
    const n = 5;
    const at = [0, 1, 2, 3, 4].map((i) => posterRest(i, n).at);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    for (let i = 0; i < n; i++) {
      expect(posterPose(i, n, at[i]! - 0.3).enter).toBe(0);
      expect(posterPose(i, n, outroAt(n)).open).toBeCloseTo(1);
      expect(posterPose(i, n, washAt(n) + 0.3).open).toBeCloseTo(0);
      expect(posterPose(i, n, simEnd(n)).out).toBeCloseTo(1);
      expect(posterName(i, n, outroAt(n) - 0.1)).toBeCloseTo(1);
      expect(posterName(i, n, washAt(n) + 0.2)).toBeCloseTo(0);
    }
    const sways = [0, 0.5, 1, 1.5].map((d) => posterPose(0, n, at[0]! + 1 + d).sway);
    expect(new Set(sways).size).toBeGreaterThan(1);
    // The names are placed once, from where a parchment RESTS, and the writer only ever sets their opacity.
    const src = readFileSync(join(__dirname, 'revealPlayer.ts'), 'utf8');
    expect(src).toMatch(/names\.forEach\(\(e, i\) => \{ e\.style\.opacity = posterName\(i, n, s\)/);
    expect(src.slice(src.indexOf('function makeWordsWriter'), src.indexOf('function watchSize'))).not.toMatch(/names[^;]*transform/);
  });

  it('never follows the mouse (owner 2026-11-24)', () => {
    for (const f of ['revealPlayer.ts', 'revealGl.ts']) expect(readFileSync(join(__dirname, f), 'utf8')).not.toMatch(/pointermove|mousemove|clientX/);
  });

  it('the leaving wave spreads without ever going back and is past every corner when it is over', () => {
    const far = 1.1;
    let prev = -1;
    for (let s = washAt(5) + 0.001; s < simEnd(5); s += 0.01) { const r = washR(s, 5, far); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
    expect(prev).toBeGreaterThan(far);
    expect(washReach(0.2, 5, far)).toBeLessThan(washReach(0.8, 5, far));
  });
});

describe('the sound', () => {
  it('lands the hit on the landing, the line on the name, and keeps every cue inside the reveal', () => {
    for (const id of ['outskirts', 'underbelly'] as const) {
      const cues = revealCues(id, 5);
      const of = (clip: string) => cues.find((c) => c.clip === clip)!;
      const t = (s: number) => realOf(s) - realOf(START);
      expect(of('impact').at).toBeCloseTo(t(L), 1);
      expect(of(`vo-${id}`).at).toBeGreaterThan(t(NAME));
      expect(of(`vo-${id}`).voice, 'the announcer\'s own channel').toBe(true);
      expect(cues.filter((c) => c.voice)).toHaveLength(1);
      for (const c of cues) expect(c.at).toBeLessThan(revealSeconds(5));
    }
  });
});

describe('the fit (owner 2026-11-24: "make sure we build this so it fits 21:9 too")', () => {
  it('a 21:9 window shows the whole painting, a 16:9 one its full height around its focus, never past its edges', () => {
    expect((stageHeight(3440, 1440) * A) / 3440).toBeLessThan(1.02);
    expect(stageHeight(3440, 1440) / 1440).toBeLessThan(1.02);
    expect(stageHeight(1600, 900)).toBe(900);
    for (const l of Object.values(LOCATIONS)) {
      for (const [w, h] of [[3440, 1440], [1600, 900], [1280, 1024], [3840, 1080]] as const) {
        const [x, y] = slideFor(l, w, h);
        const [sx, sy] = showOf(w, h);
        expect(Math.abs(x)).toBeLessThanOrEqual((1 - sx) / 2 + 1e-9);
        expect(Math.abs(y)).toBeLessThanOrEqual((1 - sy) / 2 + 1e-9);
      }
    }
  });

  it('every parchment and name fits a wide window and a narrow one', () => {
    for (const [w, h] of [[1600, 900], [3440, 1440], [2560, 1080], [1280, 1024], [1024, 768]] as const) {
      const H = stageHeight(w, h);
      const f = fitOf(w / H, h / H);
      const p = posterRest(0, 5);
      expect((Math.abs(p.x) + 0.164) * f * H, `${w}x${h} sides`).toBeLessThanOrEqual(w / 2 + 8);
      expect((p.y + 0.2225 + 0.06) * f * H, `${w}x${h} foot`).toBeLessThan(h / 2);
    }
  });
});
