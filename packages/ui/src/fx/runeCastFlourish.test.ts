// @vitest-environment jsdom
/**
 * THE RUNE CAST FLOURISH (owner 2026-09-24, verbatim): *"yeah the runes that repeat casts should use the rune-cast
 * visual. can we do anything to add a bit of flair to this? like some sort of short flash/pixi effect/make it
 * smoother and cleaner with a bit of a 'magic' element to it? nothing crazy."*
 *
 * Pinned here: the flourish fires ONCE per rune cast, with the rune's node as its source, in every phase's entry
 * point (Shop records, End-of-Turn records, combat `sc`), for bound and unbound spells alike; the spell's own single
 * effect waits for the mote; the knobs reach the play; off means #1676's behaviour exactly. `playDef` is mocked at
 * the contract; the rune rail is a real DOM node.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playDef } from './playDef';
import { playCombatSpellCastFx, playRecordedCastFx, playRuneCastBuffFx, playRuneSpellCastFx, resetSpellCastSoundGate } from './spellCastFx';
import { playRuneCastFlourish, pulseRuneBadge, RUNE_CAST_MOTE_AUTHORED_MS } from './runeCastFlourish';
import { resetCastPreviewConfig, runeCastFlourishLook, setCastPreviewValue } from '../castPreviewConfig';
import { resetBuffFxConfig } from '../buffFxConfig';

vi.mock('./playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('./combatAnchors', () => ({ anchorsForUnits: vi.fn(() => ({ source: { x: 500, y: 500 }, target: { x: 500, y: 500 } })) }));
vi.mock('../buffFxRender', () => ({ fireBuffFx: vi.fn() }));
const mockPlayDef = vi.mocked(playDef);
const plays = (def: string) => mockPlayDef.mock.calls.filter((c) => c[0] === def);
type Anchors = { source: { x: number; y: number }; target: { x: number; y: number } };
const anchorsOf = (call: unknown[]) => call[1] as Anchors;
const optsOf = (call: unknown[]) => call[2] as { scale?: number; speed?: number };

const NODE = { x: 60, y: 30 }; // a 40x40 badge at 40,10
let animate: ReturnType<typeof vi.fn>;
function mountRune(id: string): HTMLElement {
  const rail = document.createElement('div');
  rail.className = 'questbadges';
  const node = document.createElement('div');
  node.className = 'runebadge';
  node.dataset.sourceId = id;
  node.getBoundingClientRect = () => ({ left: 40, top: 10, width: 40, height: 40, right: 80, bottom: 50, x: 40, y: 10, toJSON: () => ({}) });
  node.animate = animate as unknown as HTMLElement['animate'];
  rail.appendChild(node);
  document.body.appendChild(rail);
  return node;
}

beforeEach(() => {
  vi.useFakeTimers();
  mockPlayDef.mockClear();
  resetSpellCastSoundGate();
  resetBuffFxConfig();
  resetCastPreviewConfig();
  animate = vi.fn();
  document.body.innerHTML = '';
});
afterEach(() => { vi.useRealTimers(); resetCastPreviewConfig(); });

describe('the flourish itself', () => {
  it('pulses the badge (transform only), flashes on the node, and sends a mote to the aim', () => {
    mountRune('rune_gilded_ledger');
    const aim = { x: 640, y: 400 };
    const f = playRuneCastFlourish('rune_gilded_ledger', aim);
    expect(f).toEqual({ node: NODE, leadMs: runeCastFlourishLook().moteMs, mote: true });
    expect(animate).toHaveBeenCalledTimes(1);
    const frames = animate.mock.calls[0]![0] as Keyframe[];
    for (const k of frames) expect(Object.keys(k).filter((p) => !['offset', 'easing'].includes(p))).toEqual(['transform']);
    expect(plays('rune-cast-flourish')).toHaveLength(1);
    expect(anchorsOf(plays('rune-cast-flourish')[0]!).source).toEqual(NODE);
    expect(plays('rune-cast-mote')).toHaveLength(1);
    expect(anchorsOf(plays('rune-cast-mote')[0]!)).toMatchObject({ source: NODE, target: aim });
  });

  it('no aim (a spell whose visuals already travel from the node): flash only, trails leave after the lead', () => {
    mountRune('rune_gilded_ledger');
    const f = playRuneCastFlourish('rune_gilded_ledger', null);
    expect(f).toEqual({ node: NODE, leadMs: runeCastFlourishLook().leadMs, mote: false });
    expect(plays('rune-cast-flourish')).toHaveLength(1);
    expect(plays('rune-cast-mote')).toHaveLength(0);
  });

  it('the knobs reach the play: flash size, mote size, mote travel (as a clock rate), pulse size + length', () => {
    mountRune('rune_x');
    setCastPreviewValue('runeFlourishFlashSize', 1.5);
    setCastPreviewValue('runeFlourishMoteSize', 0.6);
    setCastPreviewValue('runeFlourishMoteMs', 560);
    setCastPreviewValue('runeFlourishPulse', 0.25);
    setCastPreviewValue('runeFlourishPulseMs', 500);
    const f = playRuneCastFlourish('rune_x', { x: 600, y: 600 });
    expect(f.leadMs).toBe(560);
    expect(optsOf(plays('rune-cast-flourish')[0]!).scale).toBe(1.5);
    expect(optsOf(plays('rune-cast-mote')[0]!)).toEqual({ scale: 0.6, speed: RUNE_CAST_MOTE_AUTHORED_MS / 560 });
    const [frames, timing] = animate.mock.calls[0]! as [Keyframe[], KeyframeAnimationOptions];
    expect(frames.some((k) => k.transform === 'scale(1.25)')).toBe(true);
    expect(timing.duration).toBe(500);
  });

  it('OFF: nothing plays, no pulse, lead 0 (rune casts look exactly as before)', () => {
    mountRune('rune_x');
    setCastPreviewValue('runeFlourishOn', 0);
    expect(playRuneCastFlourish('rune_x', { x: 600, y: 600 })).toEqual({ node: NODE, leadMs: 0, mote: false });
    expect(mockPlayDef).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
  });

  it('a rune that is not on screen plays nothing (nothing to stem from)', () => {
    expect(playRuneCastFlourish('rune_gone', { x: 1, y: 1 })).toEqual({ node: null, leadMs: 0, mote: false });
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  it('pulseRuneBadge is a no-op without Web Animations (jsdom / an old runtime) and with a zero pulse', () => {
    const el = document.createElement('div');
    expect(pulseRuneBadge(el, { ...runeCastFlourishLook(), pulse: 0.2 })).toBe(typeof el.animate === 'function');
    el.animate = animate as unknown as HTMLElement['animate'];
    expect(pulseRuneBadge(el, { ...runeCastFlourishLook(), pulse: 0 })).toBe(false);
  });
});

describe('ONCE per rune cast, with the rune as source, in every phase', () => {
  it('SHOP / END OF TURN records: one flourish per rune record, none for a minion record', () => {
    mountRune('rune_distillation');
    playRecordedCastFx([
      { source: { kind: 'rune', id: 'rune_distillation' }, spellId: 'spiritfire', phase: 'recruit' },
      { source: { kind: 'minion', uid: 'm1', cardId: 'magepup' } as never, spellId: 'spiritfire', phase: 'recruit' },
    ], 'recruit');
    vi.runAllTimers();
    expect(plays('rune-cast-flourish')).toHaveLength(1);
    expect(anchorsOf(plays('rune-cast-flourish')[0]!).source).toEqual(NODE);
  });

  it('a rune casting TWICE in one moment (Recurrence) flourishes twice, the second a repeat-gap later', () => {
    mountRune('rune_recurrence');
    const rec = { source: { kind: 'rune', id: 'rune_recurrence' }, spellId: 'spiritfire', phase: 'endOfTurn' as const };
    playRecordedCastFx([rec, rec]);
    expect(plays('rune-cast-flourish')).toHaveLength(1);
    vi.advanceTimersByTime(runeCastFlourishLook().repeatMs);
    expect(plays('rune-cast-flourish')).toHaveLength(2);
  });

  it('a BOUND single-play spell (Growth): the mote flies node -> where Growth lands, and Growth waits for it', () => {
    mountRune('rune_gilded_ledger');
    expect(playRuneSpellCastFx('growth', 'rune_gilded_ledger')).toBe(true);
    expect(plays('rune-cast-mote')).toHaveLength(1);
    expect(plays('growth-effect')).toHaveLength(0); // still in flight
    vi.advanceTimersByTime(runeCastFlourishLook().moteMs);
    expect(plays('growth-effect')).toHaveLength(1);
    expect(anchorsOf(plays('growth-effect')[0]!).source).toEqual(NODE);
  });

  it('COMBAT: a PLAYER rune\'s `sc` flourishes (bound or not); an ENEMY rune\'s does not', () => {
    mountRune('rune_spellhide');
    playCombatSpellCastFx([
      { spellId: 'spiritfire', source: 'u1', side: 'player', rune: 'rune_spellhide' },
      { spellId: 'growth', source: 'e1', side: 'enemy', rune: 'rune_spellhide' },
    ] as never);
    vi.runAllTimers();
    expect(plays('rune-cast-flourish')).toHaveLength(1);
    expect(plays('growth-effect')).toHaveLength(1); // the enemy's Growth still plays, on its body, un-flourished
  });

  it('a rune\'s per-buff trail leaves the node a short lead AFTER the flash', () => {
    mountRune('rune_gilded_ledger');
    const lead = runeCastFlourishLook().leadMs;
    const target = { x: 300, y: 300 };
    expect(playRuneCastBuffFx({ runeId: 'rune_gilded_ledger', spellId: 'wo_attack', target, targetUid: 'a' })).toBe(true);
    vi.advanceTimersByTime(lead - 1);
    expect(plays('bloody-ale')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(plays('bloody-ale')).toHaveLength(1);
    expect(anchorsOf(plays('bloody-ale')[0]!)).toMatchObject({ source: NODE, target });
  });

  it('the End-of-Turn authoritative presenter routes a rune source through the flourish', () => {
    const recruit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../Recruit.tsx'), 'utf8');
    expect(recruit).toContain("if (source.kind === 'rune') playRuneSpellCastFx(cardId, source.id);");
  });
});
