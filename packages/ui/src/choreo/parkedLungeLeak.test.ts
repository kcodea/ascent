import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import gsap from 'gsap';
import { killLiveLunges, liveLungeCount, playLunge } from './channels/lunge';
import { EventRing } from '../perfEventRing';

/**
 * R-PERF-LUNGE-LEAK-01 (owner 2026-10-27: "sometimes interactions just start to feel choppy ... like memory or cpu
 * issues?"). A parked swing (a held-windup lunge, `holdAfterWindup` in lunge.ts) is a PAUSED gsap timeline. A paused
 * timeline stays in gsap's global timeline until it is resumed or killed, and through its callbacks it holds the
 * screen it was made on. The replay's per-fight reset killed it, but leaving the game unmounted the replay with no
 * next fight, so every game's whole shop screen stayed in memory for the rest of the session (a 5-game soak:
 * +~1,160 DOM nodes and +~455 listeners a game, and per-frame work in the shop climbing game over game).
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'useCombatReplay.ts'), 'utf8');

describe('a parked swing never outlives the combat replay (R-PERF-LUNGE-LEAK-01)', () => {
  it('a paused gsap timeline stays in the global timeline until it is killed (the mechanism)', () => {
    const target = { x: 0 };
    const tl = gsap.timeline();
    tl.to(target, { x: 1, duration: 1 });
    tl.addPause(0.5);
    tl.pause(0.5); // parked at the top of the wind-up
    expect(gsap.globalTimeline.getChildren(false, false, true)).toContain(tl);
    tl.kill();
    expect(gsap.globalTimeline.getChildren(false, false, true)).not.toContain(tl);
  });

  it("useCombatReplay kills the held lunge and every live lunge when it unmounts, not only on the next fight's reset", () => {
    // The unmount cleanup: an effect with no deps whose teardown kills `heldLungeRef`'s timeline and every live lunge.
    const unmount = /useEffect\(\(\) => \(\) => \{[\s\S]{0,200}heldLungeRef\.current\?\.tl\.kill\(\);\s*killLiveLunges\(\);[\s\S]{0,300}\}, \[\]\);/;
    expect(src).toMatch(unmount);
  });

  it('every lunge registers until it completes or is killed, and a stranded parked one is killed by killLiveLunges', () => {
    const fakeEl = (): Element => ({
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 100 }),
      classList: { contains: () => false },
      querySelector: () => null,
    }) as unknown as Element;
    const base = { attacker: fakeEl(), dx: 0, dy: -300, speed: 1, strike: { x: 0, y: -206 }, strikeDur: 0.16, leadTilt: 7, attackerRebound: 5, onContact: () => {} };
    killLiveLunges();
    const done = playLunge({ ...base });
    const killed = playLunge({ ...base, attacker: fakeEl() });
    const parked = playLunge({ ...base, attacker: fakeEl(), holdAfterWindup: true });
    expect(liveLungeCount()).toBe(3);
    done.progress(1); // ran to the end
    killed.kill(); // a reset / a death in the wind-up
    expect(liveLungeCount()).toBe(1);
    parked.progress(0.4); // sits at its wind-up pause, the release never comes (the fight ended, the screen left)
    expect(gsap.globalTimeline.getChildren(false, false, true)).toContain(parked);
    killLiveLunges(); // the combat replay's unmount
    expect(liveLungeCount()).toBe(0);
    expect(gsap.globalTimeline.getChildren(false, false, true)).not.toContain(parked);
  });

  it("the perf monitor's input-event ring holds its DOM targets weakly", () => {
    const ring = new EventRing(4);
    const el = { tagName: 'DIV' };
    ring.push('pointerdown', el, 10);
    expect(ring.lastBefore(20)?.target).toBe(el); // still readable while the target lives
    const held = (ring as unknown as { targets: unknown[] }).targets[0];
    expect(held).toBeInstanceOf(WeakRef); // never a strong reference that keeps a left screen alive
    ring.push('keydown', 'not-an-object', 30);
    expect(ring.lastBefore(40)?.target).toBe('not-an-object');
  });
});
