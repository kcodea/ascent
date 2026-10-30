// @vitest-environment jsdom
/**
 * THE COMBAT HARD STOP (R-COMBAT-HARDSTOP-01, owner 2026-10-30: "there are certain sounds and whatnot that still occur
 * once the end combat / return to shop gem is hit ... how can we ensure that absolutely everything stops the moment
 * that gem is clicked?").
 *
 * The repro: a WIN's gem is ready the moment the replay ends, while the winner's hero strike is still playing, and the
 * strike was only cancelled once the return wipe had fully covered the screen, so its sounds played on behind the
 * wipe. These tests pin the central stop the gem now calls:
 * - every voice already playing or scheduled on the audio clock is faded out at the click (the epoch cut);
 * - while the hold is on, new combat-bus sounds and every authored FX play are dropped, the `ui` bus (the wipe,
 *   the gem's pulse) still plays, and the release brings combat sounds back for the next fight;
 * - one-shot FX plays are retired, caller-owned loops are left alone;
 * - the owners' hooks (the hero strike's cancel) run at the stop.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/* ── A minimal fake Web Audio graph: enough for the synth voices and the bus graph `sfx.ts` builds. ── */
interface FakeParam { value: number; ramps: Array<[number, number]>; [k: string]: unknown }
interface FakeNode { kind: string; out: FakeNode[]; [k: string]: unknown }
const allNodes: FakeNode[] = [];
function param(v = 1): FakeParam {
  const p: FakeParam = {
    value: v,
    ramps: [],
    setValueAtTime(x: number) { p.value = x; return p; },
    linearRampToValueAtTime(x: number, t: number) { p.ramps.push([x, t]); return p; },
    exponentialRampToValueAtTime(x: number, t: number) { p.ramps.push([x, t]); return p; },
    setTargetAtTime() { return p; },
    cancelScheduledValues() { return p; },
    setValueCurveAtTime() { return p; },
  };
  return p;
}
function node(kind: string): FakeNode {
  const store: Record<string, unknown> = {};
  const n = new Proxy({ kind, out: [] as FakeNode[] } as FakeNode, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k in store) return store[k];
      if (k === 'connect') return (dest: FakeNode) => { t.out.push(dest); return dest; };
      if (k === 'disconnect') return () => { t.out.length = 0; };
      if (k === 'start' || k === 'stop') return () => undefined;
      if (k === 'getFloatTimeDomainData' || k === 'getByteTimeDomainData') return () => undefined;
      if (k === 'then') return undefined;
      store[k] = param(k === 'gain' ? 1 : 0);
      return store[k];
    },
    set(_t, k: string, v) { store[k] = v; return true; },
  });
  allNodes.push(n);
  return n;
}
class FakeAudioContext {
  state = 'running';
  currentTime = 1;
  sampleRate = 48000;
  destination = node('destination');
  resume() { return Promise.resolve(); }
  createGain() { return node('gain'); }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createBufferSource() { return node('source'); }
  createOscillator() { return node('osc'); }
  createBiquadFilter() { return node('filter'); }
  createConvolver() { return node('convolver'); }
  createWaveShaper() { return node('shaper'); }
  createStereoPanner() { return node('panner'); }
  createBuffer(_ch: number, len: number) { return { duration: len / 48000, length: len, numberOfChannels: 1, getChannelData: () => new Float32Array(len) }; }
}

type Sfx = typeof import('./sfx');
type Stop = typeof import('./combatHardStop');
type Hold = typeof import('./combatHold');
let sfx: Sfx;
let stop: Stop;
let hold: Hold;
const noDeps = { sfx: () => sfx.hardStopSfx(), retireFx: () => 0, clearParticles: () => undefined };

beforeAll(async () => {
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  vi.stubGlobal('fetch', () => new Promise(() => { /* never: the sample bank is not under test */ }));
  sfx = await import('./sfx');
  stop = await import('./combatHardStop');
  hold = await import('./combatHold');
});
afterEach(() => { stop.releaseCombatHold(); });

const rumble = (category: string): unknown =>
  sfx.playRumble(category, { gain: 0.5, buildMs: 100, holdMs: 100, tailMs: 100, lowHz: 60, highHz: 200 });
/** The epoch gain a voice's output chain ends on: the gain whose output is a bus input. */
const epochGains = (): FakeNode[] => allNodes.filter((n) => n.kind === 'gain' && n.out.length > 0 && (n.gain as FakeParam).ramps.some(([v]) => v === 0));

describe('combat hard stop (R-COMBAT-HARDSTOP-01)', () => {
  it('cuts every voice the fight started, at the click, and later sounds play on a fresh epoch', () => {
    expect(rumble('attack')).not.toBeNull(); // a hero-attack voice, still playing
    const before = sfx.epochGainCount();
    expect(before).toBeGreaterThan(0);
    const gainsBefore = allNodes.filter((n) => n.kind === 'gain').length;
    stop.hardStopCombat(noDeps);
    // The epoch that carried the attack voice is ramped to silence within the hard-stop fade.
    const cut = epochGains();
    expect(cut.length).toBeGreaterThan(0);
    for (const g of cut) {
      const last = (g.gain as FakeParam).ramps.at(-1)!;
      expect(last[0]).toBe(0);
      expect(last[1]).toBeLessThanOrEqual(1 + sfx.HARD_STOP_FADE_S + 1e-9);
    }
    expect(sfx.epochGainCount()).toBe(0); // a fresh epoch, nothing on it yet
    // The return wipe's own sound (ui bus) plays during the hold, on a NEW epoch gain (not the cut one).
    expect(rumble('wipedrop')).not.toBeNull();
    expect(sfx.epochGainCount()).toBe(1);
    expect(allNodes.filter((n) => n.kind === 'gain').length).toBeGreaterThan(gainsBefore);
  });

  it('holds new combat sounds until released, while the ui bus stays open', () => {
    stop.hardStopCombat(noDeps);
    expect(hold.combatHeld()).toBe(true);
    expect(rumble('attack')).toBeNull(); // a late hero-attack cue
    expect(rumble('smack')).toBeNull(); // a late combat beat
    expect(rumble('cardVoice')).toBeNull(); // a voice line
    expect(sfx.playFxSound('anything', { bus: 'combat' })).toBeNull(); // an FX layer's sound
    expect(rumble('wipecrank')).not.toBeNull(); // the wipe
    stop.releaseCombatHold();
    expect(hold.combatHeld()).toBe(false);
    expect(rumble('attack')).not.toBeNull(); // the next fight sounds as normal
  });

  it('runs the owners\' hooks (the hero strike cancel) and the FX retire at the stop', () => {
    const strikeCancel = vi.fn();
    const off = stop.onCombatHardStop(strikeCancel);
    const retireFx = vi.fn(() => 2);
    const clearParticles = vi.fn();
    stop.hardStopCombat({ sfx: () => sfx.hardStopSfx(), retireFx, clearParticles });
    expect(strikeCancel).toHaveBeenCalledTimes(1);
    expect(retireFx).toHaveBeenCalledTimes(1);
    expect(clearParticles).toHaveBeenCalledTimes(1);
    off();
  });

  it('declines every authored FX play while held', async () => {
    const { playDef } = await import('./fx/playDef');
    stop.hardStopCombat(noDeps);
    expect(playDef('impact-dust', { source: { x: 1, y: 1 }, target: { x: 1, y: 1 } })).toBeNull();
  });

  it('is wired into the gem: End Combat stops the fight first, and the hold lifts before the shop is committed', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${__dirname}/Recruit.tsx`, 'utf8');
    const press = src.slice(src.indexOf('const endCombat = useCallback'), src.indexOf("setWipe('primeOut');"));
    // The only thing before the stop is the double-click guard: no exit path (Versus, the end gate, the wipe) skips it.
    const beforeStop = press.slice(0, press.indexOf('stopFightNow();'));
    expect(press).toContain('stopFightNow();');
    expect(beforeStop.match(/return;/g)?.length ?? 0).toBe(1);
    // The stop cancels the hero strike (the sound that played behind the wipe) and calls the central stop.
    const fn = src.slice(src.indexOf('const stopFightNow = useCallback'), src.indexOf('const endCombat = useCallback'));
    expect(fn).toContain('strike.cancel()');
    expect(fn).toContain('hardStopCombat()');
    // At full cover the hold is lifted BEFORE the shop is resolved, so the shop's own mount sounds and FX play.
    const cover = src.slice(src.indexOf("if (wipe !== 'coveredOut' || !wipeExitRef.current) return;"));
    expect(cover.indexOf('releaseCombatHold();')).toBeGreaterThan(0);
    expect(cover.indexOf('releaseCombatHold();')).toBeLessThan(cover.indexOf("dispatch({ type: 'resolveCombat' })"));
    // The replay's beat clock freezes at the press.
    expect(src).toMatch(/paused: overlayOpen \|\| versusPaused \|\| combatHalted/);
  });

  it('retires one-shot FX plays and leaves caller-owned loops alone', async () => {
    const budget = await import('./fx/fxBudget');
    budget.resetFxBudget();
    const oneShot = vi.fn(), loop = vi.fn();
    budget.registerLivePlay({ id: 'burst', load: { particles: 10, filters: 0 }, retire: oneShot, protected: false });
    budget.registerLivePlay({ id: 'aura', load: { particles: 5, filters: 0 }, retire: loop, protected: true, persistent: true });
    expect(budget.retireTransientPlays()).toBe(1);
    expect(oneShot).toHaveBeenCalledTimes(1);
    expect(loop).not.toHaveBeenCalled();
    expect(budget.livePlayCount()).toBe(1);
    budget.resetFxBudget();
  });
});
