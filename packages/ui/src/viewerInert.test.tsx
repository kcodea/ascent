// @vitest-environment jsdom
/**
 * R-SPECTATE-INERT-01 (owner report 2026-11-18: "when spectating, spectators shouldnt be able to hit the end turn gem
 * etc ... the combat ended and the player died and i could hit the gem which took me to their shop with them at 0 hp").
 *
 * A viewer (a live watch screen, a recorded replay, the Duos teammate view) presses nothing on the board: not by a
 * pointer (the shaped hit layers are off on a viewer's screen) and not by any other route to a click (a focused button
 * and Enter / Space, which a browser delivers as a click). The watched player's own presses still play (press cues),
 * and a player's own buttons are untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from './renderedText.mount';
import { EndTurnButton } from './EndTurnButton';
import { FreezeButton } from './FreezeButton';
import { RefreshButton } from './RefreshButton';
import { TavernUpButton } from './TavernUpButton';
import { emitPressCue } from './pressCue';
import { viewerPress } from './viewerGuard';
import { spectatorRunOf } from './versus/spectate';

// jsdom has no 2D canvas; the diamond's lightning canvas just needs a context that does nothing.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const press = (sel: string): void => { act(() => { ui!.container.querySelector<HTMLButtonElement>(sel)!.click(); }); };
/** The board as Recruit draws it: `.app`, with `viewing` on a viewer's screen (a watch screen, a replay). */
const board = (viewing: boolean, kids: ReactNode): JSX.Element => <div className={`app${viewing ? ' viewing spectating' : ''}`}>{kids}</div>;

describe('R-SPECTATE-INERT-01: a viewer presses nothing on the board', () => {
  it('the screen is a viewer\'s on a watch screen and in a replay, never in a game of your own', () => {
    ui = mount(<>{board(true, <button className="a" />)}{board(false, <button className="b" />)}</>);
    expect(viewerPress(ui.container.querySelector('.a'))).toBe(true);
    expect(viewerPress(ui.container.querySelector('.b'))).toBe(false);
    expect(viewerPress(null)).toBe(false);
  });

  it('End Combat after the fight: a spectator\'s press (click or key) does not leave the fight', () => {
    const onEndCombat = vi.fn(), onEndTurn = vi.fn(), onSkip = vi.fn();
    ui = mount(board(true, <EndTurnButton onEndTurn={onEndTurn} onEndCombat={onEndCombat} onSkip={onSkip} combatReady pressed disabled={false} urgent={false} />));
    press('button.etbwrap'); // a key press on the focused gem reaches the button as this same click
    expect(onEndCombat).not.toHaveBeenCalled();
    expect(onEndTurn).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('End Turn in the shop and Skip in the fight are refused the same way', () => {
    const onEndTurn = vi.fn(), onSkip = vi.fn();
    ui = mount(board(true, <EndTurnButton onEndTurn={onEndTurn} onSkip={onSkip} pressed={false} disabled={false} urgent={false} />));
    press('button.etbwrap');
    ui.render(board(true, <EndTurnButton onEndTurn={onEndTurn} onSkip={onSkip} skipReady pressed disabled={false} urgent={false} />));
    press('button.etbwrap');
    expect(onEndTurn).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('Freeze, Refresh and Tier up are refused too', () => {
    const onFreeze = vi.fn(), onRefresh = vi.fn(), onUpgrade = vi.fn();
    ui = mount(board(true, <>
      <FreezeButton frozen={false} disabled={false} onFreeze={onFreeze} />
      <RefreshButton cost={1} disabled={false} onRefresh={onRefresh} />
      <TavernUpButton tier={1} maxTier={6} cost={5} disabled={false} onUpgrade={onUpgrade} />
    </>));
    press('button.frzwrap');
    press('button.rfbwrap');
    press('button.tvbwrap');
    expect(onFreeze).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it('THE WATCHED PLAYER IS ELIMINATED: their end screen is never a screen to act on, and the held last fight takes no press', () => {
    // The player's game is over (0 Health after the last fight): no run is made from that frame, so the watch screen
    // keeps the fight it is showing until the end gate closes over it (R-SPECTATE-END-01).
    const dead = { phase: 'gameover', wave: 9, resolve: 0 } as never;
    expect(spectatorRunOf(dead, 'p1', 'game-1', undefined)).toBeNull();
    const onEndCombat = vi.fn();
    ui = mount(board(true, <EndTurnButton onEndTurn={vi.fn()} onEndCombat={onEndCombat} combatReady pressed disabled={false} urgent={false} />));
    press('button.etbwrap');
    expect(onEndCombat).not.toHaveBeenCalled();
    // The watched player's own End Combat still plays here (the gem's relight): it arrives as a press cue, never as a
    // click, and Recruit's exit curtain listens for that cue itself.
    expect(() => act(() => { emitPressCue('endCombat'); })).not.toThrow();
    expect(onEndCombat).not.toHaveBeenCalled();
  });

  it('a player in their own game is unaffected: every button presses', () => {
    const onEndCombat = vi.fn(), onFreeze = vi.fn(), onRefresh = vi.fn(), onUpgrade = vi.fn();
    ui = mount(board(false, <>
      <EndTurnButton onEndTurn={vi.fn()} onEndCombat={onEndCombat} combatReady pressed disabled={false} urgent={false} />
      <FreezeButton frozen={false} disabled={false} onFreeze={onFreeze} />
      <RefreshButton cost={1} disabled={false} onRefresh={onRefresh} />
      <TavernUpButton tier={1} maxTier={6} cost={5} disabled={false} onUpgrade={onUpgrade} />
    </>));
    press('button.etbwrap');
    press('button.frzwrap');
    press('button.rfbwrap');
    press('button.tvbwrap');
    expect(onEndCombat).toHaveBeenCalledTimes(1);
    expect(onFreeze).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('the shaped hit layers are off on a viewer\'s screen (the rule comes after the one that turns them on)', () => {
    const css = readFileSync(join(__dirname, 'hitShapes.css'), 'utf8');
    const on = css.indexOf(':is(.tvbwrap, .frzwrap, .rfbwrap, .etbwrap)::after { content: \'\'; position: absolute; inset: 0; z-index: 7; pointer-events: auto; }');
    const off = css.indexOf('.app.viewing :is(.tvbwrap, .frzwrap, .rfbwrap, .etbwrap)::after,');
    expect(on).toBeGreaterThan(-1);
    expect(off).toBeGreaterThan(on);
    const rule = css.slice(off, css.indexOf('}', off) + 1);
    expect(rule).toMatch(/pointer-events:\s*none/);
    // The chips and pills drawn as part of each button (their own `pointer-events: auto`) go with it.
    for (const piece of ['.tvb-cost', '.tvb-tierpill', '.frz-pill', '.rfb-cost']) expect(rule).toContain(piece);
  });
});
