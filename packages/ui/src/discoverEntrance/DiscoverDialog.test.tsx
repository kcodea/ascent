// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from '@game/sim';

// Every entrance sound goes through `playTailedClip`: spy on it (the rest of sfx stays real).
const played = vi.hoisted(() => [] as { clip: string; category: string; at: number }[]);
vi.mock('../sfx', async (orig) => {
  const real = await orig<typeof import('../sfx')>();
  return { ...real, playTailedClip: (clip: string, category: string) => { played.push({ clip, category, at: Date.now() }); return null; } };
});

import { mount, type Mounted } from '../renderedText.mount';
import type { CardView } from '../Card';
import { DiscoverDialog, EntranceOverlay, OfferSheen, type DiscoverDialogProps } from './DiscoverDialog';
import { discoverOccasion, resetOfferEntranceMemoForTests } from './useOfferEntrance';
import { DCE_DEFAULTS, entranceTimeline, resetDiscoverEntranceConfig, setDiscoverEntranceValue } from './discoverEntranceConfig';

/**
 * THE DISCOVER ENTRANCE on the real Discover dialog (owner ask 2026-09-25): the options float in left to right; each
 * is un-pickable while in flight and pickable the moment it arrives; a press during the entrance skips it to settled
 * and never picks a card still in flight; every cue plays once; a re-render or a Minimize / Return remount never
 * replays it; each Discover of a Disco Dan chain plays its own.
 */
const ids = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token).slice(0, 3).map((c) => c.id);
const view = (id: string): CardView => {
  const c = CARD_INDEX[id]!;
  return { name: c.name, cardId: c.id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: c.keywords, text: c.text, tier: c.tier };
};
let m: Mounted | null = null;

const slots = (): HTMLElement[] => [...(m?.container.querySelectorAll<HTMLElement>('.disc-slot') ?? [])];
const flying = (): boolean[] => slots().map((s) => s.dataset.dce === 'flying');
const root = (): HTMLElement => m!.container.querySelector('.discover-ov') as HTMLElement;
const dialog = (props: Partial<DiscoverDialogProps> = {}): JSX.Element => (
  <DiscoverDialog ids={ids} cards={ids.map(view)} onPick={() => {}} occasion={null} {...props} />
);
const beats = (): ReturnType<typeof entranceTimeline> => entranceTimeline(DCE_DEFAULTS, 3);
const cues = (clip: string): number => played.filter((p) => p.clip === clip).length;
const press = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); }); };
const cardOf = (i: number): HTMLElement => slots()[i]!.querySelector('.card') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  resetOfferEntranceMemoForTests();
  played.length = 0;
});
afterEach(() => {
  resetDiscoverEntranceConfig();
  m?.unmount();
  m = null;
  vi.useRealTimers();
});

describe('the Discover entrance', () => {
  it('the defaults are brief: three cards are in and settled in about half a second, all done under 0.9 s', () => {
    const t = beats();
    expect(t.cards[2]!.arriveAt).toBeLessThanOrEqual(500);
    expect(t.cards[2]!.settledAt).toBeLessThanOrEqual(700);
    expect(t.endAt).toBeLessThan(900);
    // Left to right.
    expect(t.cards.map((c) => c.startAt)).toEqual([...t.cards.map((c) => c.startAt)].sort((a, b) => a - b));
  });

  it('every card starts in flight and becomes pickable exactly as it arrives, left to right', () => {
    m = mount(dialog());
    expect(flying()).toEqual([true, true, true]);
    const t = beats();
    act(() => { vi.advanceTimersByTime(t.cards[0]!.arriveAt - 1); });
    expect(flying()).toEqual([true, true, true]);
    act(() => { vi.advanceTimersByTime(1); });
    expect(flying()).toEqual([false, true, true]);
    act(() => { vi.advanceTimersByTime(t.cards[2]!.arriveAt - t.cards[0]!.arriveAt); });
    expect(flying()).toEqual([false, false, false]);
    act(() => { vi.advanceTimersByTime(t.endAt); });
    expect(root().dataset.dcePhase).toBe('settled');
  });

  it('a pick never registers on a card still in flight: the attempt settles the entrance instead', () => {
    const onPick = vi.fn();
    m = mount(dialog({ onPick }));
    act(() => { cardOf(2).click(); });
    expect(onPick).not.toHaveBeenCalled();
    // ...and the entrance is settled, so the NEXT click on it is a real pick.
    expect(flying()).toEqual([false, false, false]);
    act(() => { cardOf(2).click(); });
    expect(onPick).toHaveBeenCalledWith(2);
  });

  it('an arrived card takes its click while the others are still arriving', () => {
    const onPick = vi.fn();
    m = mount(dialog({ onPick }));
    act(() => { vi.advanceTimersByTime(beats().cards[0]!.arriveAt); });
    expect(flying()).toEqual([false, true, true]);
    act(() => { cardOf(0).click(); });
    expect(onPick).toHaveBeenCalledWith(0);
  });

  it('a press during the entrance skips it to the settled state (and plays no further cue)', () => {
    m = mount(dialog());
    press(root());
    expect(flying()).toEqual([false, false, false]);
    expect(root().dataset.dcePhase).toBe('settled');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(played).toEqual([]);
  });

  it('each sound cue fires once: open, whoosh and sparkle once per opening, the arrive settle once per card', () => {
    m = mount(dialog());
    const t = beats();
    act(() => { vi.advanceTimersByTime(t.cards[0]!.arriveAt - 1); });
    expect(cues(DCE_DEFAULTS.sfxOpenClip)).toBe(1);
    expect(cues(DCE_DEFAULTS.sfxWhooshClip)).toBe(1);
    expect(cues(DCE_DEFAULTS.sfxArriveClip)).toBe(0); // not early
    act(() => { vi.advanceTimersByTime(1); });
    expect(cues(DCE_DEFAULTS.sfxArriveClip)).toBe(1);
    act(() => { vi.advanceTimersByTime(t.endAt + 5000); });
    expect(cues(DCE_DEFAULTS.sfxOpenClip)).toBe(1);
    expect(cues(DCE_DEFAULTS.sfxWhooshClip)).toBe(1);
    expect(cues(DCE_DEFAULTS.sfxArriveClip)).toBe(3);
    expect(cues(DCE_DEFAULTS.sfxSparkleClip)).toBe(1);
    expect(played).toHaveLength(6);
    // The open cue keeps the existing Discover fader; the new cues ride their own.
    expect(played.find((p) => p.clip === DCE_DEFAULTS.sfxOpenClip)!.category).toBe('discover');
  });

  it('arrive cues closer together than the gap do not stack', () => {
    setDiscoverEntranceValue('sfxArriveGapMs', 500);
    m = mount(dialog());
    act(() => { vi.advanceTimersByTime(beats().endAt + 5000); });
    expect(cues(DCE_DEFAULTS.sfxArriveClip)).toBe(1);
  });

  it('once-per-opening mode plays one arrive cue', () => {
    setDiscoverEntranceValue('sfxArriveEach', 0);
    m = mount(dialog());
    act(() => { vi.advanceTimersByTime(beats().endAt + 5000); });
    expect(cues(DCE_DEFAULTS.sfxArriveClip)).toBe(1);
  });

  it('a re-render (any store update) never replays it or its sounds', () => {
    m = mount(dialog({ occasion: 'seed:3:a' }));
    act(() => { vi.advanceTimersByTime(beats().cards[1]!.arriveAt); });
    m.render(dialog({ occasion: 'seed:3:a', ids: [...ids], cards: ids.map(view) }));
    act(() => { vi.advanceTimersByTime(beats().endAt + 5000); });
    expect(cues(DCE_DEFAULTS.sfxOpenClip)).toBe(1);
    expect(cues(DCE_DEFAULTS.sfxArriveClip)).toBe(3);
    m.render(dialog({ occasion: 'seed:3:a', ids: [...ids], cards: ids.map(view) }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(played).toHaveLength(6);
  });

  it('Minimize then Return (a remount of the same Discover) does not replay it, not even mid-flight', () => {
    m = mount(dialog({ occasion: 'seed:3:b' }));
    act(() => { vi.advanceTimersByTime(beats().cards[0]!.arriveAt); });
    const before = played.length;
    m.unmount(); // Minimize, mid-flight
    vi.advanceTimersByTime(200); // well past a StrictMode re-run
    m = mount(dialog({ occasion: 'seed:3:b' })); // Return to Discover
    expect(flying()).toEqual([false, false, false]);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(played).toHaveLength(before);
  });

  it('a StrictMode-style immediate remount replays the whole opening once', () => {
    m = mount(dialog({ occasion: 'seed:3:c' }));
    m.unmount();
    m = mount(dialog({ occasion: 'seed:3:c' }));
    expect(flying()).toEqual([true, true, true]);
    act(() => { vi.advanceTimersByTime(beats().endAt + 5000); });
    expect(cues(DCE_DEFAULTS.sfxOpenClip)).toBe(1);
  });

  it('reduced motion: every card is pickable from the first frame', () => {
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: q.includes('reduce'), media: q } as MediaQueryList));
    try {
      m = mount(dialog());
      expect(flying()).toEqual([false, false, false]);
      act(() => { vi.advanceTimersByTime(5000); });
      expect(cues(DCE_DEFAULTS.sfxWhooshClip)).toBe(0);
      expect(cues(DCE_DEFAULTS.sfxOpenClip)).toBe(1);
    } finally {
      mm.mockRestore();
    }
  });
});

describe('the Discover entrance through a Disco Dan chain', () => {
  // Disco Dan's turn 1: three Discovers in a row (T6, then T4, then T2), each opening the moment the last is taken.
  const chainStart = (): RunState => {
    const r = createRun(4242, 'discodan');
    expect(r.discover, 'Disco Dan opens his first Discover at once').toBeTruthy();
    return r;
  };
  const live = (r: RunState, onPick: (i: number) => void): JSX.Element => (
    <DiscoverDialog ids={r.discover!} cards={r.discover!.map(view)} onPick={onPick} occasion={discoverOccasion(r)} />
  );

  it('each Discover of the chain plays its own entrance, and its own open cue, once', () => {
    let run = chainStart();
    const opened: string[] = [];
    let steps = 0;
    const pick = (i: number): void => { run = reduce(run, { type: 'discover', index: i }); };
    m = mount(live(run, pick));
    while (run.discover && steps < 5) {
      opened.push(discoverOccasion(run));
      expect(flying(), `Discover ${steps + 1} flies in`).toEqual(run.discover.map(() => true));
      act(() => { vi.advanceTimersByTime(beats().endAt + 50); });
      expect(flying()).toEqual(run.discover.map(() => false));
      act(() => { cardOf(0).click(); });
      steps++;
      if (run.discover) m.render(live(run, pick));
    }
    expect(steps, 'Disco Dan offers three Discovers').toBe(3);
    expect(new Set(opened).size, 'each step is its own occasion').toBe(3);
    expect(cues(DCE_DEFAULTS.sfxOpenClip)).toBe(3);
    expect(cues(DCE_DEFAULTS.sfxWhooshClip)).toBe(3);
  });
});

describe('the Choose One overlay (EntranceOverlay)', () => {
  it('a press during the entrance settles it and is NOT a click-away cancel; afterwards the backdrop cancels', () => {
    const cancel = vi.fn();
    m = mount(
      <EntranceOverlay occasion={null} onPointerDown={cancel}>
        {() => (
          <div className="disc-cards">
            {[0, 1].map((i) => <div className="disc-slot" key={i}><span className="opt" /><OfferSheen /></div>)}
          </div>
        )}
      </EntranceOverlay>,
    );
    expect(flying()).toEqual([true, true]);
    press(root());
    expect(cancel).not.toHaveBeenCalled();
    expect(flying()).toEqual([false, false]);
    press(root());
    expect(cancel).toHaveBeenCalledTimes(1);
    // No open cue on a Choose One.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(cues(DCE_DEFAULTS.sfxOpenClip)).toBe(0);
  });
});
