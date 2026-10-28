// @vitest-environment jsdom
/**
 * LIVE READY (R-VERSUS-READY-02, owner 2026-10-27: "when a player hits their end turn gem, they should be able to un-ready
 * it. maybe we modify the end turn gem for 'live' games where it is a 'ready' status that the player can toggle on/off").
 * In a live game the gem reads as a Ready toggle: "Ready up" before, a lit gem under the green ready glow while ready
 * (pressed for the click path, so a second press takes it back), and the spent crack only once the round closes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./fx/playDef', () => ({ playDef: () => undefined }));
vi.mock('./pixiFx', () => ({ pixiFx: { impactPulse: () => undefined } }));

import { EndTurnButton } from './EndTurnButton';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const btn = (): HTMLButtonElement => ui!.container.querySelector('button.etbwrap')!;

describe('R-VERSUS-READY-02: the End Turn gem as a Ready toggle', () => {
  it('not ready: the live label, no ready class', () => {
    ui = mount(<EndTurnButton onEndTurn={() => undefined} pressed={false} disabled={false} urgent={false} label="Ready up" />);
    expect(btn().classList.contains('readyon')).toBe(false);
    expect(btn().getAttribute('aria-label')).toBe('Ready up');
    expect(btn().querySelector('.etb-tip')!.textContent).toBe('Ready up');
  });

  it('ready: lit + glow class, aria-pressed, and a second press calls End Turn again (the un-ready)', () => {
    const onEndTurn = vi.fn();
    ui = mount(<EndTurnButton onEndTurn={onEndTurn} pressed readyOn disabled={false} urgent={false} label="Press again to cancel" note="Ready 1/2. Press again to cancel" />);
    expect(btn().classList.contains('readyon')).toBe(true);
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    expect(btn().querySelector('.etb-readyglow')).not.toBeNull();
    expect(btn().querySelector('.etb-tip')!.textContent).toBe('Ready 1/2. Press again to cancel');
    act(() => { btn().click(); });
    expect(onEndTurn).toHaveBeenCalledTimes(1);
  });

  it('the solo game keeps its own label (no live props)', () => {
    ui = mount(<EndTurnButton onEndTurn={() => undefined} pressed={false} disabled={false} urgent={false} />);
    expect(btn().getAttribute('aria-label')).toBe('End your turn and start combat');
  });

  it('the ready glow loops on opacity only, over a static filter (performance rule)', () => {
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    const kf = css.slice(css.indexOf('@keyframes etbreadybreathe'), css.indexOf('}', css.indexOf('@keyframes etbreadybreathe') + 40) + 1);
    expect(kf).toMatch(/opacity/);
    expect(kf).not.toMatch(/filter|box-shadow|background/);
    expect(css).toMatch(/\.etbwrap\.pressed\.readyon \.etb-gem\.lit \{ display: block; \}/);
  });
});
