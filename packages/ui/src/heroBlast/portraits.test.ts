// @vitest-environment jsdom
/**
 * THE HERO ATTACK ANCHORS (owner report 2026-09-28: "you can see the foe area isnt centered. can you fix that? may be
 * wrong for blast too"). Both Blast and Quake anchor on the centre of each ROUND PORTRAIT ART, measured AT REST: never
 * the wrapper (the player's also holds the name pill), and never mid-entrance (the foe portrait's drop-in).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { portraitGeometry, restingRect } from './portraits';

const rect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) }) as DOMRect;

function mountPortraits(): { heroImg: HTMLElement; lunge: HTMLElement; body: HTMLElement; img: HTMLElement; opp: HTMLElement } {
  document.body.innerHTML = `
    <div class="statusbar"><div class="hero"><div class="herolunge"><img class="heroimg" /></div></div></div>
    <div class="combatopp"><div class="combatopp-drop"><div class="combatopp-name">Foe</div>
      <div class="combatopp-body"><div class="combatopp-portrait"><img class="combatopp-img" /></div></div></div></div>`;
  const q = (s: string): HTMLElement => document.querySelector<HTMLElement>(s)!;
  return { heroImg: q('.heroimg'), lunge: q('.herolunge'), body: q('.combatopp-body'), img: q('.combatopp-img'), opp: q('.combatopp') };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('portrait anchors', () => {
  it('anchors on the round art, not the wrapper: the player wrapper is taller (the name pill), the foe body is wider', () => {
    const m = mountPortraits();
    m.lunge.getBoundingClientRect = () => rect(53, 593, 222, 240);
    m.heroImg.getBoundingClientRect = () => rect(53, 592, 222, 222);
    m.body.getBoundingClientRect = () => rect(1330, 30, 250, 250);
    m.img.getBoundingClientRect = () => rect(1345, 40, 216, 216);
    const g = portraitGeometry('player')!;
    expect(g.a).toEqual({ x: 164, y: 703 });
    expect(g.d).toEqual({ x: 1453, y: 148 });
    expect(g.radius).toBe(108);
    expect(g.attackerRadius).toBe(111);
    expect(g.attackerEl).toBe(m.lunge);
    expect(g.defenderEl).toBe(m.body);
    const back = portraitGeometry('opp')!;
    expect(back.a).toEqual({ x: 1453, y: 148 });
    expect(back.d).toEqual({ x: 164, y: 703 });
    expect(back.attackerEl).toBe(m.body);
  });

  it('measures a portrait mid-entrance AT REST: the running drop-in is seeked to its end for the measure, then restored', () => {
    const m = mountPortraits();
    let now = 120; // ms into a 600 ms drop-in
    const anim = {
      playState: 'running', get currentTime() { return now; }, set currentTime(v: number) { now = v; },
      effect: { getComputedTiming: () => ({ endTime: 600 }) },
    } as unknown as Animation;
    m.opp.getAnimations = (() => [anim]) as Element['getAnimations'];
    // Mid-flight the art sits 90 px higher and smaller; at the end of the drop it is seated.
    m.img.getBoundingClientRect = () => (now >= 600 ? rect(1345, 40, 216, 216) : rect(1360, -50, 186, 186));
    m.heroImg.getBoundingClientRect = () => rect(53, 592, 222, 222);
    const g = portraitGeometry('player')!;
    expect(g.d).toEqual({ x: 1453, y: 148 });
    expect(g.radius).toBe(108);
    expect(now).toBe(120); // put back exactly where it was
  });

  it('restingRect is a plain measure when nothing animates (and where getAnimations does not exist)', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => rect(10, 20, 30, 40);
    expect(restingRect(el)).toMatchObject({ left: 10, top: 20, width: 30, height: 40 });
  });

  it('no foe portrait (a non-lobby run): null, so the attack falls back to the board edges', () => {
    document.body.innerHTML = '<div class="statusbar"><div class="hero"><div class="herolunge"><img class="heroimg" /></div></div></div>';
    document.querySelector<HTMLElement>('.heroimg')!.getBoundingClientRect = () => rect(0, 0, 100, 100);
    expect(portraitGeometry('player')).toBeNull();
  });
});
