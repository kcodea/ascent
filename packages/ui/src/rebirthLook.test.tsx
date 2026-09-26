// @vitest-environment jsdom
/**
 * REBIRTH look v2 (owner 2026-09-26: "improve rebirth effect? its not noticeable and ugly").
 *  · IDLE: every card with Rebirth (`RB`) carries `.rebirthcard` and the flame crown (`.rebirth-crown`, the
 *    pre-rendered frames of `rebirthCrown.ts`); nothing else does.
 *  · TRIGGER: a `reborn { rebirth: true }` event tags the unit `rebirthing` (the re-form out of the fire), and
 *    `reformRebirth` binds the `rebirth-flame` def ONCE per call, recoloured to the tuner's colours, sized off the
 *    card HEIGHT (the slot's width is still ~0 at beat start), and raises the pillar of fire on the unit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./fx/playDef', () => ({ playDef: vi.fn(() => null) }));
import type { CombatEvent } from '@game/core';
import { playDef } from './fx/playDef';
import { Card, type CardView } from './Card';
import { mount } from './renderedText.mount';
import { CROWN_FRAMES, crownSvg, crownTongues, pillarSvg } from './rebirthCrown';
import { REBIRTH_DEFAULTS, getRebirthConfig, hexToNum, rebirthPalette } from './rebirthConfig';
import { reformRebirth } from './choreo/channels/aura';
import { animFor, deathConsequenceLead, rebirthSettleLead, REBIRTH_FORM_MS } from './useCombatReplay';
import { holdMs } from './choreo/clock';
import { compileMoments, type Moment } from './choreo/compile';
import { replayBeats, replayOrder } from './choreo/replayOrder';

const playDefMock = vi.mocked(playDef);
afterEach(() => { playDefMock.mockClear(); document.body.innerHTML = ''; });

const view = (keywords: CardView['keywords']): CardView => ({
  name: 'Exgalloper', cardId: 'dw_exgalloper', tribe: 'beast', attack: 6, health: 6, keywords, text: '**Rebirth.**', tier: 5,
});

describe('Rebirth idle look', () => {
  it('a Rebirth card wears .rebirthcard and the flame crown (glow + every flame frame + embers)', () => {
    const m = mount(<Card card={view(['RB'])} uid="u1" />);
    const card = m.container.querySelector('.card')!;
    expect(card.classList.contains('rebirthcard')).toBe(true);
    const crown = card.querySelector('.archbox > .rebirth-crown');
    expect(crown, 'the crown lives in the archbox (the overlay layer, like Ward), not inside the clipped art').not.toBeNull();
    expect(crown!.classList.contains('shield')).toBe(false);
    expect(crown!.querySelector('.rbc-glow')).not.toBeNull();
    expect(crown!.querySelectorAll('.rbc-frame')).toHaveLength(CROWN_FRAMES);
    expect(crown!.querySelectorAll('.rbc-ember')).toHaveLength(getRebirthConfig().emberCount);
    m.unmount();
  });

  it('a Taunt Rebirth card gets the SHIELD crown, following the heater frame', () => {
    const m = mount(<Card card={view(['RB', 'T'])} uid="u3" />);
    const crown = m.container.querySelector('.rebirth-crown')!;
    expect(crown.classList.contains('shield')).toBe(true);
    expect((crown.querySelector('.rbc-frame') as HTMLElement).style.backgroundImage).toContain('--rb-crown-s-0');
    m.unmount();
  });

  it('no Rebirth, no crown: Rise keeps its own dome and never borrows the flame', () => {
    const m = mount(<Card card={view(['R'])} uid="u2" />);
    expect(m.container.querySelector('.rebirth-crown')).toBeNull();
    expect(m.container.querySelector('.card')!.classList.contains('rebirthcard')).toBe(false);
    expect(m.container.querySelector('.reborn-dome')).not.toBeNull();
    m.unmount();
  });

  it('the crown frames are distinct pre-rendered SVGs carrying the tuner colours', () => {
    const c = { deep: '#112233', hot: '#445566', core: '#778899' };
    const frames = Array.from({ length: CROWN_FRAMES }, (_, k) => crownSvg(k, c));
    expect(new Set(frames).size).toBe(CROWN_FRAMES); // each frame flickers to a new shape
    for (const f of frames) {
      expect(f.startsWith('<svg')).toBe(true);
      expect(f).toContain('#112233');
      expect(f).toContain('#445566');
      expect(f).toContain('#778899');
    }
    expect(crownSvg(0, c)).toBe(crownSvg(0, c)); // seeded: identical every load
    // Flame height scales every tongue.
    const a = crownTongues(1, 1), b = crownTongues(1, 1.4);
    expect(b[0]!.l / a[0]!.l).toBeCloseTo(1.4, 5);
    expect(pillarSvg(c)).toContain('#778899');
    // The shield variant is its own silhouette; every frame pre-blurs its edges (no live CSS blur).
    expect(crownSvg(0, c, 1, 'shield')).not.toBe(crownSvg(0, c, 1, 'oval'));
    for (const f of frames) expect(f).toContain('feGaussianBlur');
  });
});

describe('Rebirth trigger', () => {
  it('a rebirth tags the unit `rebirthing` on top of the shared re-entry; a Rise does not', () => {
    const rb = { type: 'reborn', target: 'a', hp: 5, attack: 5, keywords: [], rebirth: true } as CombatEvent;
    const rise = { type: 'reborn', target: 'b', hp: 1, attack: 1, keywords: [] } as CombatEvent;
    expect(animFor(rb)).toEqual({ a: 'reborn rebirthing' });
    expect(animFor(rise)).toEqual({ b: 'reborn' });
  });

  it('reformRebirth binds rebirth-flame ONCE, recoloured, sized off the card height, and raises the pillar on the unit', () => {
    document.body.innerHTML = '<div class="unit" id="host"><div class="card" data-uid="r9"></div></div>';
    reformRebirth({ cx: 100, cy: 200, w: 0, h: 240 }, 'r9');
    expect(playDefMock).toHaveBeenCalledTimes(1);
    const [id, anchors, opts] = playDefMock.mock.calls[0]!;
    expect(id).toBe('rebirth-flame');
    expect(anchors).toEqual({ target: { x: 100, y: 200 } });
    expect(opts?.uids).toEqual({ source: null, target: 'r9' });
    // w is 0 (the slot is still expanding) → the size comes from the height: 240 × 0.75 / 180 = 1.
    expect(opts?.scale).toBeCloseTo(REBIRTH_DEFAULTS.burstScale * 1, 5);
    expect(opts?.recolor).toEqual(rebirthPalette());
    const host = document.getElementById('host')!;
    expect(host.querySelectorAll('.rbpillar.back')).toHaveLength(1);
    expect(host.querySelectorAll('.rbflash')).toHaveLength(1);
    expect(host.firstElementChild!.classList.contains('back'), 'the back column sits behind the card').toBe(true);
  });

  it('the palette is deep → mid → hot → core, from the tuner colours', () => {
    const p = rebirthPalette(REBIRTH_DEFAULTS)!;
    expect(p).toHaveLength(4);
    expect(p[0]).toBe(hexToNum(REBIRTH_DEFAULTS.colorB));
    expect(p[2]).toBe(hexToNum(REBIRTH_DEFAULTS.colorA));
    expect(p[3]).toBe(hexToNum(REBIRTH_DEFAULTS.colorCore));
    expect(rebirthPalette({ ...REBIRTH_DEFAULTS, colorA: 'nope' })).toBeUndefined();
  });
});

describe('Rebirth combat beat (Rise beat style: the body is back before the next beat)', () => {
  // A real Rise-style fight fragment: attack → the Rebirth body dies (rise-flagged) → it returns → the next swing.
  const events = [
    { type: 'attack', attacker: 'e1', defender: 'p1', step: 1 },
    { type: 'dmg', target: 'p1', amount: 9, hp: 0, step: 1 },
    { type: 'death', target: 'p1', side: 'player', rise: true, step: 2 },
    { type: 'reborn', target: 'p1', hp: 5, attack: 5, keywords: [], rebirth: true, step: 3 },
    { type: 'attack', attacker: 'p1', defender: 'e1', step: 4 },
  ] as unknown as CombatEvent[];
  const moments = compileMoments(events);
  const rebornIdx = moments.findIndex((m) => m.primary.type === 'reborn');
  const reborn = moments[rebornIdx]!;
  const next = moments[rebornIdx + 1]!;

  it('the rebirth is its own beat, and the next beat is a separate one after it', () => {
    expect(reborn.kind).toBe('reborn');
    expect(next.primary.type).toBe('attack');
    expect(moments.indexOf(reborn)).toBeGreaterThan(moments.findIndex((m) => events.slice(m.start, m.end).some((e) => e.type === 'death')));
  });

  it.each([1, 2])('at %sx speed the rebirth beat holds past the full re-form before the next beat starts', (spd) => {
    const hold = holdMs(next, reborn, spd) + rebirthSettleLead(reborn, events) / spd;
    expect(hold).toBeGreaterThan(REBIRTH_FORM_MS / spd);
  });

  it('a Rise return adds no Rebirth hold (Rise keeps its own pacing)', () => {
    const rise = events.map((e) => (e.type === 'reborn' ? { ...e, rebirth: undefined } : e)) as CombatEvent[];
    const m = compileMoments(rise).find((x) => x.primary.type === 'reborn') as Moment;
    expect(rebirthSettleLead(m, rise)).toBe(0);
  });
});

describe('Rebirth 1v1 regression (owner 2026-09-26: "the attack truncated and happened instantly")', () => {
  // The REAL shape of the reported fight: the killer is a Target Dummy, so its onDamaged `buff` beat sits BETWEEN the
  // Rebirth body's death and its return. The return used to look only at the beat right before it, found no death,
  // skipped its read-lead, and the body popped back and swung almost at once.
  const build = (extra: number): CombatEvent[] => ([
    { type: 'attack', attacker: 'e1', defender: 'p1', step: 1 },
    { type: 'dmg', target: 'p1', amount: 5, hp: 0, step: 1 },
    { type: 'dmg', target: 'e1', amount: 2, hp: 58, step: 1 },
    { type: 'buff', target: 'e1', attack: 1, health: 0, step: 1 },
    { type: 'death', target: 'p1', side: 'player', rise: true, step: 2 },
    { type: 'reborn', target: 'p1', hp: 3, attack: 2, keywords: [], rebirth: true, step: 4 },
    { type: 'attack', attacker: 'p1', defender: extra ? 'e2' : 'e1', step: 6 },
  ] as unknown as CombatEvent[]);

  it.each([[0, '1v1'], [3, 'a larger board']])('%s extra units (%s): the return waits its full read-lead, then the attack gets its normal hold', (extra) => {
    // The replay's REAL pipeline (`replayBeats` = compileMoments(replayOrder(...))), not a bare compile.
    const events = replayOrder(build(extra));
    const beats = replayBeats(build(extra));
    const ri = beats.findIndex((m) => m.primary.type === 'reborn');
    const reborn = beats[ri]!;
    const shown = beats[ri - 1]!;
    expect(shown.kind, 'a beat sits between the death and the return').not.toBe('riseDeath');
    const recent = beats.slice(Math.max(0, ri - 3), ri - 1);
    const lead = deathConsequenceLead(shown, reborn, events, new Map(), null, recent);
    expect(lead, 'the return still holds for the death to read').toBeGreaterThanOrEqual(800);
    // Without the look-back (the old behaviour) there was no lead at all.
    expect(deathConsequenceLead(shown, reborn, events, new Map(), null, [])).toBe(0);
    // The next ATTACK: the rebirth beat holds past the full re-form, and never shorter than an ordinary pre-attack hold.
    const attack = beats[ri + 1]!;
    expect(attack.kind).toBe('attackExchange');
    const hold = holdMs(attack, reborn, 1) + rebirthSettleLead(reborn, events);
    expect(hold).toBeGreaterThan(REBIRTH_FORM_MS);
    expect(hold).toBeGreaterThanOrEqual(holdMs(attack, shown, 1));
  });
});
