// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { RUNE_INDEX } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import { RuneforgeDialog } from './RuneforgeDialog';

/**
 * NO GOLD BLOCK ON HOVER (owner report 2026-11-20: hovering the Runeforge's buttons showed "a weird gold pop up
 * block"). The `.gtip` hover bubble draws on `::after`. The forge's pills (Gold, Re-roll, Inspect) already spend
 * `::after` on their right diamond stud (runeforgeLook.css), so a `.gtip` on one of them merged the two: the stud
 * was hidden at rest and, on hover, popped up above the button as a loose gold square with no text.
 */
const here = dirname(fileURLToPath(import.meta.url));
const look = readFileSync(join(here, 'runeforgeLook.css'), 'utf8');

/** Every class that runeforgeLook.css paints an `::after` on. */
function classesWithAfter(css: string): Set<string> {
  const out = new Set<string>();
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const head = rule.split('{')[0] ?? '';
    for (const sel of head.split(',')) {
      if (!sel.includes('::after')) continue;
      const last = sel.split('::after')[0]!.trim().split(/\s+/).pop() ?? '';
      for (const c of last.match(/\.[\w-]+/g) ?? []) out.add(c.slice(1));
    }
  }
  return out;
}

let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; });

describe('the Runeforge hover bubbles', () => {
  it('the forge styles a stud on the Re-roll pill\'s ::after (the slot a bubble would collide with)', () => {
    expect(classesWithAfter(look).has('forge-reroll')).toBe(true);
  });

  it('no forge element that wears an ::after stud also opts into the .gtip bubble', () => {
    const studded = classesWithAfter(look);
    const offer = Object.values(RUNE_INDEX).filter((r) => !r.epic).slice(0, 3).map((r) => r.id);
    m = mount(<RuneforgeDialog offer={offer} epic={false} embers={99} rerollSpent={false} duplicating={false} onBuy={() => {}} onReroll={() => {}} />);
    const clashes = [...m.container.querySelectorAll<HTMLElement>('.gtip, [data-tip]')]
      .filter((el) => [...el.classList].some((c) => studded.has(c)))
      .map((el) => el.className);
    expect(clashes).toEqual([]);
    // The re-roll keeps its explanation for assistive tech.
    expect(m.container.querySelector('.forge-reroll')?.getAttribute('aria-description')).toMatch(/Re-roll the offered Runes/);
  });
});
