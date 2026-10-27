// @vitest-environment jsdom
/**
 * The crystal fuse's charge is released by the End Turn gem's strike, so EVERY End Turn path strikes exactly once
 * (owner 2026-10-26): a click strikes, a later press cue for the same press (Versus's auto End Turn after a ready
 * click, a spectator replay) does not strike again, and an End Turn with no click (Versus's server release) strikes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from './renderedText.mount';

const dust = vi.fn();
vi.mock('./fx/playDef', () => ({ playDef: (id: string) => { if (id === 'impact-dust') dust(); } }));
vi.mock('./pixiFx', () => ({ pixiFx: { impactPulse: () => undefined } }));

import { EndTurnButton } from './EndTurnButton';
import { emitPressCue } from './pressCue';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let ui: Mounted | null = null;
beforeEach(() => dust.mockClear());
afterEach(() => { ui?.unmount(); ui = null; });
const btn = (): HTMLButtonElement => ui!.container.querySelector('button.etbwrap')!;
const el = (pressed: boolean): JSX.Element => <EndTurnButton onEndTurn={() => undefined} pressed={pressed} disabled={false} urgent={false} />;

describe('the End Turn strike plays once per End Turn', () => {
  it('a click, then the press cue for the same press: one strike', () => {
    ui = mount(el(false));
    act(() => { btn().click(); });
    ui.render(el(true));
    act(() => { emitPressCue('endTurn'); });
    expect(dust).toHaveBeenCalledTimes(1);
  });

  it('an End Turn with no click (Versus release): the cue strikes once', () => {
    ui = mount(el(false));
    act(() => { emitPressCue('endTurn'); });
    ui.render(el(true));
    act(() => { emitPressCue('endTurn'); });
    expect(dust).toHaveBeenCalledTimes(1);
  });

  it('the next turn (pressed back to false) strikes again', () => {
    ui = mount(el(false));
    act(() => { btn().click(); });
    ui.render(el(true));
    ui.render(el(false));
    act(() => { btn().click(); });
    expect(dust).toHaveBeenCalledTimes(2);
  });

  it('Versus plays the strike cue right before its automatic End Turn', () => {
    const src = readFileSync(join(__dirname, 'versus', 'VersusHud.tsx'), 'utf8');
    expect(src).toMatch(/emitPressCue\('endTurn'\);\s*endTurn\(\);/);
  });
});
