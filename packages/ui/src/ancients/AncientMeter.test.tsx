// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRun, enableAncients, type RunState } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { AncientMeter, sameAncientRun } from './AncientMeter';

/** THE ANCIENTS PILL (owner 2026-09-25): "Ancients x/16", and ONLY it opens the preview (never the ring). */
let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; document.body.querySelectorAll('.anc-pv').forEach((n) => n.remove()); });

const run = (): RunState => {
  const r = enableAncients({ ...createRun(3, 'indy'), phase: 'recruit' } as RunState);
  return { ...r, ancients: { ...r.ancients!, points: 4 } };
};
// React's onPointerEnter derives from `pointerover` (jsdom has no PointerEvent class, so a MouseEvent carries it).
const hover = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); }); };

describe('the Ancients meter pill', () => {
  it('reads "Ancients 4/16"', () => {
    m = mount(<AncientMeter run={run()} />);
    expect(m.container.querySelector('.anc-chip')?.textContent).toBe('Ancients4/16');
    expect(m.container.querySelector('.anc-chip-lbl')?.textContent).toBe('Ancients');
  });

  it('hovering the pill opens the preview', () => {
    m = mount(<AncientMeter run={run()} />);
    hover(m.container.querySelector('.anc-chip')!);
    expect(document.body.querySelector('.anc-pv')).not.toBeNull();
  });

  it('hovering the ring does not', () => {
    m = mount(<AncientMeter run={run()} />);
    for (const el of Array.from(m.container.querySelectorAll('.anc-ring, .anc-ring svg, .anc-ring circle'))) hover(el);
    expect(document.body.querySelector('.anc-pv')).toBeNull();
  });
});

// R-PERF-LOBBY-STABLE-01: the reducer clones the run on every dispatch, so a memo on `{ run }` never held. The
// comparator keys on what the Ancient components read.
describe('sameAncientRun (the memo that holds across shop actions)', () => {
  it('a deep clone of the run is the same Ancient picture', () => {
    const a = run();
    expect(sameAncientRun({ run: a }, { run: structuredClone(a) })).toBe(true);
  });
  it('a point, an offer, a pick, the phase and the hero each re-render', () => {
    const a = run();
    const edits: Array<(r: RunState) => void> = [
      (r) => { r.ancients!.points += 1; },
      (r) => { r.ancients!.picked = 'x' as never; },
      (r) => { (r.ancients as unknown as { offerSeq: number }).offerSeq = 99; },
      (r) => { r.phase = 'combat'; },
      (r) => { r.heroId = 'fi'; },
      (r) => { r.ancientsEnabled = false as never; },
    ];
    for (const edit of edits) {
      const b = structuredClone(a);
      edit(b);
      expect(sameAncientRun({ run: a }, { run: b })).toBe(false);
    }
  });
});
