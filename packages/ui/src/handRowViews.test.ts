import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EVERY CARD THE HAND ROW RENDERS HAS A VIEW (live crash, 2026-09-01):
 *
 *     TypeError: Cannot read properties of undefined (reading 'attack')  — at Card
 *
 * The row looks its view up with a NON-NULL assertion (`handViews.get(m.uid)!`), so the two lists are a
 * contract: whatever the row iterates, the view map must contain. The Choose One preview broke it from the
 * other side — it removed the previewed card from `handViews` while the row was still walking `run.hand`, so
 * the lookup handed `undefined` straight to `Card`.
 *
 * The fix is a rule worth pinning rather than a one-line patch: **filter at the RENDER site, never out of the
 * view map.** A card hidden from the row costs nothing; a card missing a view crashes the screen.
 */
const RECRUIT = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');

describe('hand row ↔ hand views', () => {
  it('the view map is built from the WHOLE hand', () => {
    const i = RECRUIT.indexOf('const handViews = useMemo');
    expect(i, 'the hand view map still exists').toBeGreaterThan(-1);
    const body = RECRUIT.slice(i, RECRUIT.indexOf('handViewCache.current = stabilizeViewMap', i));
    expect(body.includes('run.hand.map('),
      'handViews must map the whole hand — filtering here is what crashed the render').toBe(true);
    expect(/run\.hand\.filter\(/.test(body),
      'no filtering inside the view map; hide cards at the render site instead').toBe(false);
  });

  it('the row renders a FILTERED list, and every filter narrows the same source', () => {
    // `gambleHand` is the row's source. Both hiders (the Gamble hold, the Choose One preview) narrow it, so
    // the row can only ever iterate cards the view map was built from.
    const i = RECRUIT.indexOf('const gambleHand =');
    expect(i).toBeGreaterThan(-1);
    const line = RECRUIT.slice(i, RECRUIT.indexOf('\n', i));
    expect(line.includes('handShown'), 'the row source is the already-narrowed list').toBe(true);
  });

  it('the row still asserts a view exists — which is exactly why the above matters', () => {
    expect(RECRUIT.includes('card={handViews.get(m.uid)!}'),
      'if this assertion is ever removed, revisit this lane').toBe(true);
  });
});
