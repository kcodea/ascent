import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE CHOOSE ONE PREVIEW (owner ask 2026-08-31: *"when a choose one minion is played on board, they should
 * remain on board as the choose one options are presented"*).
 *
 * ── The property worth guarding ───────────────────────────────────────────────────────────────────────────
 *
 * It is PRESENTATION ONLY. The reducer's 2026-08-28 deferral — a Choose One play commits nothing until the
 * branch is picked — is what makes a cancel a true no-op, what keeps every consequence firing exactly once on
 * the replayed play, and what keeps old REPLAYS valid (they record `play` → `chooseOne` action sequences, so
 * a minion that really landed mid-prompt would replay against different intermediate state).
 *
 * So the test that matters is not "does it look right" — it is that nobody later "finishes the job" by making
 * the play commit. This lane reads the reducer and holds that line.
 */
const REDUCER = readFileSync(join(__dirname, '../../sim/src/reducer.ts'), 'utf8');
const RECRUIT = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');

describe('Choose One preview — shown on board, not put there', () => {
  it('the reducer still COMMITS NOTHING while the prompt is open', () => {
    // The deferral branch returns as soon as it has opened the prompt: no splice, no counters, no RNG.
    const i = REDUCER.indexOf('s.chooseOne = { uid: card.uid, cardId: def.id, spell: !!def.spell, toIndex: action.toIndex };');
    expect(i, 'the deferral still opens the prompt here').toBeGreaterThan(-1);
    const after = REDUCER.slice(i, i + 200);
    expect(after.includes('return s;'), 'and returns immediately — nothing else happens on this action').toBe(true);
  });

  it('cancelling is still a pure no-op in the reducer', () => {
    const i = REDUCER.indexOf("case 'cancelChoice'");
    expect(i).toBeGreaterThan(-1);
    const body = REDUCER.slice(i, REDUCER.indexOf('case ', i + 10));
    expect(body.includes('s.chooseOne = undefined'), 'it clears the prompt').toBe(true);
    // Nothing may be un-done, because nothing was done: no board splice, no hand insert.
    expect(/s\.board\.(splice|push)/.test(body), 'a cancel must not touch the board').toBe(false);
    expect(/s\.hand\.(splice|push)/.test(body), 'nor the hand').toBe(false);
  });

  it('only a MINION is previewed — a spell takes no slot, an Equipment has no card', () => {
    // The gate lives on `chooseOnePreviewUid`, which BOTH the board splice and the hand row read, so the two
    // can never disagree about which card is being previewed. (Anchored on the exact declaration: the memo
    // below shares its prefix, and an earlier cut of this test matched the wrong one.)
    const i = RECRUIT.indexOf('const chooseOnePreviewUid =');
    expect(i, 'the gate exists').toBeGreaterThan(-1);
    const decl = RECRUIT.slice(i, RECRUIT.indexOf(';', RECRUIT.indexOf('undefined', i)));
    expect(decl.includes('!run.chooseOne.spell'), 'a spell Choose One is not previewed on the board').toBe(true);
    expect(decl.includes('!run.chooseOne.equipmentId'), "and neither is an Equipment's prompt").toBe(true);
  });

  it('the previewed body is the HAND card itself — because the play committed nothing', () => {
    const i = RECRUIT.indexOf('const chooseOnePreview = useMemo');
    expect(i, 'the projection exists').toBeGreaterThan(-1);
    const body = RECRUIT.slice(i, RECRUIT.indexOf('}, [', i));
    expect(body.includes('run.hand.find'), 'it reads the card out of hand, where it still is').toBe(true);
  });

  it('the coalesce captures BEFORE the state changes', () => {
    // GSAP Flip needs the pre-change geometry. A layout effect runs after the DOM has already moved, so the
    // capture belongs in the cancel handler — get this backwards and the card teleports.
    expect(RECRUIT.includes('captureCoalesce(); dispatch({ type: \'cancelChoice\' })'),
      'both cancel paths capture first, then dispatch').toBe(true);
  });
});
