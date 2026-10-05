import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from '@game/sim';

/**
 * R-EOTFX-01 — an End-of-Turn effect's FX plays ONCE, on its beat. The beats present every End-of-Turn
 * consequence while the board is up; the commit (`faceOmen`) then bumps the same per-action FX counters the shop
 * watchers in `Recruit.tsx` listen to — with the board STILL on screen under the combat curtain. Any watcher that
 * reacts to that bump replays the effect a second time (Brunni's ale bubbles, Abyssal Feeder's eat, Kobold
 * Alchemist's Rubies rolling twice).
 *
 * So every counter an End-of-Turn card can bump must be either ADVANCED by the commit block in
 * `playEndOfTurnAuthoritative` (its watcher then sees nothing new) or recorded SAFE here with the reason. A new
 * End-of-Turn card that bumps a channel nobody has decided on fails this test instead of double-playing.
 */

/** Advanced at the End-of-Turn commit: the counter → the line in Recruit.tsx that advances it. */
const ADVANCED: Record<string, string> = {
  rubyLandedFxSeq: 'prevRubyLandedSeq.current = committed.rubyLandedFxSeq',
  recruitFxSeq: 'prevFxSeq.current = committed.recruitFxSeq',
  shopBuffAllFxSeq: 'captureRecruitSeqs(committed, prevRecruitSeqs.current)',
  veinstormFxSeq: 'captureRecruitSeqs(committed, prevRecruitSeqs.current)',
  shopEatenSeq: 'prevShopEatSeq.current = committedShopEatSeq',
  shopFxSeq: 'prevShopFxSeq.current = committed.shopFxSeq',
  fodderEatenSeq: 'prevFodderSeq.current = committed.fodderEatenSeq',
  aleGrantSeq: 'prevAleSeq.current = committed.aleGrantSeq',
};

/** Bumped at End of Turn but cannot replay a beat — and why. */
const SAFE: Record<string, string> = {
  uidSeq: 'the uid allocator, not an FX channel',
  castFxSeq: 'its watcher returns outside the recruit phase (casts ride `spellResolved`)',
  lassoFxSeq: '`useLassoCascade` is recruit-phase gated (steals ride `cardGranted`)',
  spellPowerFxSeq: 'its watcher skips a SOURCELESS stamp outside recruit, which is what the commit leaves',
  fodderSendSeq: 'its watcher returns outside the recruit phase (Maw infuses on its beat)',
  buffGustSeq: 'no watcher plays it (the buff gust was removed 2026-08-17)',
  weldFxSeq: 'its watcher returns outside the recruit phase (welds ring on their beat via `weldPulse`)',
  starformFxSeq: 'no beat plays `starform-create`, so the commit watcher is its ONLY cue (once, not twice)',
};

const mk = (cardId: string, uid: string, golden: boolean): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  const k = golden ? 2 : 1;
  return { uid, cardId, tribe: d.tribe, attack: d.attack * k, health: d.health * k, keywords: [...d.keywords], golden } as BoardCard;
};

/** Every numeric `*Seq` field, one level of nesting deep (`ancients.bookGoldFxSeq`). */
function seqsOf(run: RunState): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(run)) {
    if (/Seq$/.test(k) && typeof v === 'number') out.set(k, v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) if (/Seq$/.test(k2) && typeof v2 === 'number') out.set(`${k}.${k2}`, v2);
    }
  }
  return out;
}

describe('R-EOTFX-01: the End-of-Turn commit never replays a beat', () => {
  it('every FX counter an End-of-Turn card bumps is advanced at the commit or recorded safe', () => {
    const bumped = new Map<string, string>(); // counter → first card seen bumping it
    for (const setId of Object.keys(SETS) as SetId[]) {
      const pool = poolFor(setId);
      const minions = pool.all.filter((c) => !c.spell && !c.token);
      const spells = pool.all.filter((c) => c.spell).slice(0, 2);
      for (const src of pool.all.filter((c) => c.effects?.some((e) => e.on === 'endOfTurn'))) {
        const kin = minions.filter((m) => m.tribe === src.tribe && m.id !== src.id).slice(0, 3);
        for (const golden of [false, true]) {
          const before = {
            ...createRun(7, 'drakko'), setId, phase: 'recruit',
            board: [mk(src.id, 'src', golden), ...kin.map((m, i) => mk(m.id, `k${i}`, false))],
            hand: [...minions.slice(0, 3), ...spells].map((c, i) => mk(c.id, `h${i}`, false)),
          } as RunState;
          const after = reduce(before, { type: 'faceOmen' });
          const s0 = seqsOf(before);
          for (const [k, v] of seqsOf(after)) if (v !== s0.get(k) && !bumped.has(k)) bumped.set(k, `${src.id}${golden ? ' (gilded)' : ''}`);
        }
      }
    }
    expect(bumped.size, 'the sweep reached real End-of-Turn content').toBeGreaterThan(5);
    const undecided = [...bumped].filter(([k]) => !(k in ADVANCED) && !(k in SAFE)).map(([k, card]) => `${k} (bumped by ${card})`);
    expect(undecided, 'advance these in Recruit.tsx\'s End-of-Turn commit block, or record why they cannot replay').toEqual([]);
  });

  it('Recruit.tsx\'s End-of-Turn commit block really advances every ADVANCED counter', () => {
    const src = readFileSync(join(__dirname, '../Recruit.tsx'), 'utf8');
    const start = src.indexOf('commitPresentationAction();');
    expect(start, 'the authoritative commit is still there').toBeGreaterThan(0);
    const block = src.slice(start, src.indexOf('}, EOT_COMBAT_PAD_MS', start));
    for (const [k, line] of Object.entries(ADVANCED)) expect(block, `${k} is advanced at the commit`).toContain(line);
  });
});
