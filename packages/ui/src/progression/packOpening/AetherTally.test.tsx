// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../../renderedText.mount';
import { AetherTally, odometerRoll } from './AetherTally';

/** The Aether tally as the shop's wallet counter: no "+", and a starting value shown at once. */
let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; });

describe('the Aether tally as the wallet counter', () => {
  it('a falling value still turns the hundreds only on the carry', () => {
    expect(odometerRoll(199.5, 2)).toBeCloseTo(1.5);
  });

  it('an empty prefix draws no prefix element, and the default still draws the plus', () => {
    m = mount(<AetherTally total={1240} shown prefix="" />);
    expect(m.container.querySelector('.pkop-aether-plus')).toBeNull();
    m.render(<AetherTally total={1240} shown />);
    expect(m.container.querySelector('.pkop-aether-plus')?.textContent).toBe('+');
  });

  it('`initial` shows the starting value at once, with no roll up from 0', () => {
    m = mount(<AetherTally total={1240} shown prefix="" initial={1240} />);
    const strips = Array.from(m.container.querySelectorAll<HTMLElement>('.pkop-odo-strip'));
    expect(strips).toHaveLength(4);
    const row = (el: HTMLElement): number => Math.abs(Math.round(parseFloat(/translateY\((-?[\d.]+)em\)/.exec(el.style.transform)![1]!) / 1.8));
    // the columns are drawn thousands first: 1, 2, 4, 0
    expect(strips.map(row).map((d) => d % 10)).toEqual([1, 2, 4, 0]);
  });
});
