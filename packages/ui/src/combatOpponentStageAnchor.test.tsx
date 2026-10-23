// @vitest-environment jsdom
/**
 * The opponent's hero block stays on the STAGE at every window shape (owner report 2026-10-23, R-STAGE-OPP-HUD-01:
 * "everything in the game works/stays in place seemingly except for opponent information").
 *
 * The foe block (`.combatopp`: portrait, name, Health/Armor, Shop Tier pill, rune slots) and the foe's hero power
 * (`.heropowerbtn.opp-power` + its tip) are portalled into the stage host, like every other layer. They were placed
 * from the top of the LAYOUT VIEWPORT (`top: calc(20 * var(--u) + ...)`) instead of the top of the 16:9 game box, so
 * on a window taller than 16:9 (the stage scaled down and letterboxed, `--bar-y` > 0) they sat at the window's top
 * while the board sat in the middle. At 16:9 `--bar-y` is 0, which is why desktop never showed it.
 *
 * Pins: the block mounts inside the stage host; each of its `top` anchors starts from `var(--bar-y)` (the box's top
 * edge, the same anchor the Refresh crystal uses) and uses no raw viewport unit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun, type RunState } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { CombatOpponent } from './CombatOpponent';
import { stageHost } from './stage';
import { useGame } from './store';

let ui: Mounted | null = null;
afterEach(() => {
  act(() => { useGame.setState({ combatStaged: false }); });
  ui?.unmount(); ui = null;
});

describe('the opponent block lives in the stage', () => {
  it('portals the portrait group and the foe hero power into the stage host', () => {
    const run: RunState = { ...createLobbyRun(4242, 'warden'), phase: 'combat' };
    act(() => { useGame.setState({ run, combatStaged: true }); });
    ui = mount(<CombatOpponent />);
    const host = stageHost();
    const block = document.querySelector('.combatopp');
    const power = document.querySelector('.heropowerbtn.opp-power');
    expect(block).not.toBeNull();
    expect(power).not.toBeNull();
    expect(block!.parentElement).toBe(host);
    expect(power!.parentElement).toBe(host);
  });
});

describe('the stylesheet: the opponent block anchors to the 16:9 box, not the window', () => {
  const css = readFileSync(join(__dirname, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** Every rule body for exactly `selector` that declares a `top`. */
  const topsOf = (selector: string): string[] => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const out: string[] = [];
    for (const m of css.matchAll(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))) {
      const top = /(?:^|;|\s)top\s*:\s*([^;]+)/.exec(m[1]!);
      if (top) out.push(top[1]!.trim());
    }
    return out;
  };

  for (const sel of ['.combatopp', '.heropowerbtn.opp-power', '.herotip.opp-power-tip']) {
    it(`${sel}: top starts from the box's top edge (var(--bar-y)) and uses no viewport unit`, () => {
      const tops = topsOf(sel);
      expect(tops.length).toBe(1);
      expect(tops[0]).toMatch(/^calc\(\s*var\(--bar-y\)\s*\+/);
      expect(tops[0]).not.toMatch(/(?<![\w-])-?[\d.]+[dsl]?v[wh]\b/);
    });
  }
});
