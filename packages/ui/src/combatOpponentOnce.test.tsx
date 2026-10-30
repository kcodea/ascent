// @vitest-environment jsdom
/**
 * THE FOE PORTRAIT EXISTS ONCE (owner report 2026-10-29, live site, R-OPP-PORTRAIT-ONCE-01: "the opponent portrait kept
 * showing like it was coming into combat over and over and dropping more shadows, then they persist into shop phase").
 *
 * Recruit renders the foe portrait (CombatOpponent, a portal into the stage) next to the foe's hand (OpponentHand). The
 * Duos no-remount work keyed BOTH on the bare `screenId`. Two siblings with one key send React's reconcile off the
 * rails: it lost the portrait's portal, so each combat render mounted a NEW `.combatopp` into the stage (the entrance
 * replaying) and never removed the old one. About 250 copies after one fight. Their stacked drop shadows made a
 * solid black disc over the standings, and they stayed into the Shop.
 *
 * Pins: (1) Recruit gives the two siblings different keys; (2) with Recruit's keys, any number of combat re-renders
 * leaves exactly ONE portrait in the stage, and none once the fight is over; (3) the old shared key does leak, so (2)
 * really guards the mechanism.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createLobbyRun, type RunState } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { CombatOpponent } from './CombatOpponent';
import { OpponentHand } from './OpponentHand';
import { useGame } from './store';

let ui: Mounted | null = null;
afterEach(() => {
  act(() => { useGame.setState({ combatStaged: false }); });
  ui?.unmount(); ui = null;
  vi.restoreAllMocks();
});

/** Recruit's pairing, with the keys passed in (Recruit's own keys are pinned against its source below). The sibling
 *  before them comes and goes, as Recruit's conditional siblings do (the God Mode panel, the fight's overlays): a
 *  shifted child list is what sends React to its keyed lookup, where a shared key drops the old portrait. */
function Pair({ oppKey, handKey, tick }: { oppKey: string; handKey: string; tick: number }): JSX.Element {
  return (
    <>
      {tick % 2 === 1 && <span className="beat" />}
      <CombatOpponent key={oppKey} />
      <OpponentHand key={handKey} events={[]} through={tick} summoned={NO_SUMMONS} live />
    </>
  );
}

const NO_SUMMONS = new Set<string>();
const portraits = (): number => document.querySelectorAll('.combatopp').length;

function fight(oppKey: string, handKey: string, renders: number): number[] {
  const run: RunState = { ...createLobbyRun(4242, 'warden'), phase: 'combat' };
  act(() => { useGame.setState({ run, combatStaged: true }); });
  ui = mount(<Pair oppKey={oppKey} handKey={handKey} tick={0} />);
  const counts = [portraits()];
  // The fight's beats: the parent re-renders and the store moves (damage dealt to the foe) many times.
  for (let i = 1; i <= renders; i++) {
    act(() => { useGame.setState({ oppDmgDealt: i % 3 }); });
    ui.render(<Pair oppKey={oppKey} handKey={handKey} tick={i} />);
    counts.push(portraits());
  }
  return counts;
}

describe('the foe portrait exists once (R-OPP-PORTRAIT-ONCE-01)', () => {
  it('Recruit keys the portrait and the foe hand apart', () => {
    const src = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
    const opp = /<CombatOpponent key=\{(.+?)\} \/>/.exec(src)?.[1];
    const hand = /<OpponentHand key=\{(.+?)\} events=/.exec(src)?.[1];
    expect(opp).toBeTruthy();
    expect(hand).toBeTruthy();
    expect(opp).not.toBe(hand);
    expect(opp).toBe('`opp:${screenId}`');
    expect(hand).toBe('`opphand:${screenId}`');
  });

  it('one portrait through a whole fight, none back in the Shop', () => {
    const counts = fight('opp:s', 'opphand:s', 30);
    expect(counts.every((n) => n === 1)).toBe(true);
    act(() => { useGame.setState({ combatStaged: false, run: { ...useGame.getState().run, phase: 'recruit' } }); });
    ui!.render(<Pair oppKey="opp:s" handKey="opphand:s" tick={99} />);
    expect(portraits()).toBe(0);
  });

  it('the old shared key is the leak this guards against', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // React's duplicate-key warning
    const counts = fight('s', 's', 10);
    expect(Math.max(...counts)).toBeGreaterThan(1);
  });
});
