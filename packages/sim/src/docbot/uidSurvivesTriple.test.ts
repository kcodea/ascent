/**
 * DOC BOT LANE `uidSurvivesTriple` — no run state may point at a body a TRIPLE just destroyed.
 *
 * ── The miss this encodes (owner report 2026-08-29) ────────────────────────────────────────────────────────
 *
 * *"sable's hero power breaks if a minion who is soulbound gets tripled."*
 *
 * Sable's bond is two run-board uids. A triple consumes its three copies and mints a golden with a FRESH uid,
 * so a bonded body that tripled left `sableBond` pointing at a uid nothing could resolve. The mirror needs
 * both ends, so the power went dead for the rest of the turn — in silence, in both phases.
 *
 * ── Why this is a LANE and not just a regression test ─────────────────────────────────────────────────────
 *
 * `combineIntoGolden` carries a dozen per-instance values forward BY HAND — buffs, spell progress, ascend
 * progress, the earliest `boughtWave`, the welded magnetic fields. Every one of them is a line somebody
 * remembered to write. A reference held OUTSIDE the card, in run state, has no such line and nothing to
 * remind the next author that it needs one. Sable's is simply the first that was noticed.
 *
 * ── Why the check is a DEEP WALK and not a field list ─────────────────────────────────────────────────────
 *
 * The tempting version scans `state.ts` for fields whose NAME contains "uid" and checks those. That version
 * would NOT have caught this bug: the bond's fields are `a` and `b`. Nothing about those names says uid, and
 * nothing will for the next one either — which is the whole reason a naming-convention check is the wrong
 * instrument here.
 *
 * So the detector is behavioural. Record the uids a triple destroys, then walk the WHOLE post-triple RunState
 * and flag any string equal to one of them. No naming convention, no registry of fields to keep in step with
 * `state.ts`, and it sees a new field the day it is added.
 *
 * A dangling reference is only ALLOWED where it is deliberate — a presentation cue naming the body that just
 * vanished is meaningful precisely because it vanished. Those paths are listed below with reasons, and an
 * allowance that stops matching anything is itself a failure, so the list cannot rot into scenery.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from '../index';

/**
 * Post-triple references ALLOWED to name a destroyed body, by dotted path prefix.
 *
 * Presentation cues only. Each is a per-action FX record whose whole point is to say "this body is gone" —
 * cleared on the next dispatch, never read as gameplay truth. A GAMEPLAY reference must never be added here:
 * the fix for one is to carry it to the golden or clear it, which is what `carrySableBond` does.
 */
const ALLOWED_DANGLING: readonly { path: string; why: string }[] = [
  { path: 'shopEaten', why: 'per-action FX record of a body consumed in the shop — naming the vanished body IS its payload' },
  { path: 'fodderEaten', why: 'same shape as shopEaten: the eaten body is the subject of the cue' },
  { path: 'shopDeathFx', why: 'per-action death cue; the uid it names is precisely the body that left' },
  { path: 'equipFx', why: 'per-action equip cue, cleared on the next dispatch' },
  { path: 'recruitBuffFx', why: 'per-action buff cue; a body buffed and then tripled still had its buff animate' },
  { path: 'gainCardFiredUids', why: 'per-action dedupe ledger of hand arrivals, cleared each dispatch' },
  // NOT a presentation cue, and the one entry here that is a real finding rather than an exemption.
  //
  // This lane surfaced it on its first run: `firstShoutUid` is WRITTEN (reducer.ts, on the turn's first
  // Shout) and read by NOTHING. Its docstring says "Rune of Refrain", but the live Refrain code returns the
  // JUST-PLAYED body via `card.uid` — the field and its stated consumer drifted apart at some point.
  //
  // So a dangling value is harmless TODAY, and only today: it is exactly the Sable shape lying in wait. The
  // moment someone implements "return the turn's FIRST Shout" by reading this field, a tripled body breaks it
  // the same way the bond broke. Allowed with that written down rather than quietly reclassified as a cue —
  // when the field is either deleted or given a real consumer, this entry must go with it.
  { path: 'firstShoutUid', why: 'DEAD FIELD (2026-08-29): written on the first Shout, read by nothing — Refrain uses the just-played card.uid instead. Latent Sable-shape trap if it ever gains a consumer; delete this allowance when the field is deleted or wired.' },
];

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 3, health: 3,
     keywords: [], golden: false, ...over } as BoardCard);

/** Every string in `v`, with the dotted path it sits at. */
function walkStrings(v: unknown, path: string, out: { path: string; value: string }[], seen = new Set<unknown>()): void {
  if (typeof v === 'string') { out.push({ path, value: v }); return; }
  if (!v || typeof v !== 'object' || seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) { v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, out, seen)); return; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    walkStrings(x, path ? `${path}.${k}` : k, out, seen);
  }
}

/**
 * FROZEN records of fights that already happened. Their uids describe THOSE bodies, not the live board, so a
 * destroyed uid inside them is history rather than a dangling pointer — skipped at the top level.
 */
const HISTORICAL = new Set(['lastCombat', 'servedBoards']);

/** Paths in `s` holding a uid from `destroyed`, minus the allowed presentation cues. */
function danglingRefs(s: RunState, destroyed: Set<string>): { path: string; value: string }[] {
  const found: { path: string; value: string }[] = [];
  for (const [k, v] of Object.entries(s as unknown as Record<string, unknown>)) {
    if (!HISTORICAL.has(k)) walkStrings(v, k, found);
  }
  const allowed = (p: string): boolean =>
    ALLOWED_DANGLING.some((a) => p === a.path || p.startsWith(`${a.path}.`) || p.startsWith(`${a.path}[`));
  return found.filter((f) => destroyed.has(f.value) && !allowed(f.path));
}

/** Uids on the board+hand of `before` that are gone from `after`. */
const destroyedBy = (before: RunState, after: RunState): Set<string> => {
  const live = new Set([...after.board, ...after.hand].map((c) => c.uid));
  return new Set([...before.board, ...before.hand].map((c) => c.uid).filter((u) => !live.has(u)));
};

const report = (refs: { path: string; value: string }[]): string =>
  refs.map((r) => `  ${r.path} = '${r.value}'`).join('\n');

describe('Doc Bot — no run state points at a body a triple destroyed', () => {
  /**
   * Forge the bond for real through the hero power, and only THEN put the third copy in hand.
   *
   * The order is load-bearing: `checkTriples` counts board AND hand, so a fixture holding all three copies
   * from the start triples on the very first dispatch — before any bond exists — and the scenario silently
   * tests nothing. It did exactly that until this fixture was rewritten, which is worth knowing because a
   * green vacuous test is the failure mode this whole lane is meant to prevent.
   */
  function bondedThenThird(third: BoardCard, board: BoardCard[]): { before: RunState; after: RunState } {
    const start = {
      ...createRun(5, 'sable'), tier: 6, embers: 30, phase: 'recruit', board, hand: [],
    } as unknown as RunState;
    const bonded = reduce(start, { type: 'heroPower' } as Action);
    expect(bonded.sableBond, 'fixture guard: the bond was forged').toBeDefined();
    const before = { ...bonded, hand: [third] } as RunState;
    return { before, after: reduce(before, { type: 'play', uid: third.uid } as Action) };
  }

  /** Both bonded ends are copies of the same card, so one triple consumes both. */
  const bothEnds = (): { before: RunState; after: RunState } =>
    bondedThenThird(card('h', 'sandbag'),
      [card('L', 'sandbag'), card('m', 'dw_orin'), card('R', 'sandbag')]);

  it('fixture guard: the scenario really does destroy bodies', () => {
    const { before, after } = bothEnds();
    expect([...after.board, ...after.hand].some((c) => c.golden), 'a triple must have formed').toBe(true);
    expect(destroyedBy(before, after).size, 'and it must have consumed bodies').toBeGreaterThan(0);
  });

  it('a bond whose BOTH ends are tripled leaves nothing dangling (the reported bug)', () => {
    const { before, after } = bothEnds();
    const refs = danglingRefs(after, destroyedBy(before, after));
    expect(refs, `run state still points at a body the triple destroyed:\n${report(refs)}`).toEqual([]);
  });

  it('a bond with only ONE end tripled leaves nothing dangling either', () => {
    const { before, after } = bondedThenThird(card('h', 'dw_orin'),
      [card('L', 'sandbag'), card('o1', 'dw_orin'), card('R', 'dw_orin')]);
    const refs = danglingRefs(after, destroyedBy(before, after));
    expect(refs, `run state still points at a body the triple destroyed:\n${report(refs)}`).toEqual([]);
  });

  it('the walk can actually see a dangling reference (a detector that finds nothing proves nothing)', () => {
    // Forge the failure the fix removes: a bond left pointing at a consumed uid. If this does NOT report,
    // every green above is vacuous — which is the failure mode of a scan nobody has ever seen fail.
    const { before, after } = bothEnds();
    const destroyed = destroyedBy(before, after);
    const sabotaged = { ...after, sableBond: { a: [...destroyed][0]!, b: 'R', wave: after.wave } } as RunState;
    const refs = danglingRefs(sabotaged, destroyed);
    expect(refs.map((r) => r.path), 'the walk must name the exact path').toContain('sableBond.a');
  });

  it('no allowance is scenery — each names a real RunState field', () => {
    // An allowance matching nothing reads as "reviewed and accepted" while protecting nothing, so a rename
    // must delete the excuse rather than silently widen it.
    //
    // Checked against the SOURCE, not a live run: every field here is optional and undefined until something
    // sets it, so `in createRun(...)` would reject all six — a check that fails on correct input teaches the
    // next person to delete the check.
    const src = readFileSync(join(__dirname, '../state.ts'), 'utf8');
    const declared = new Set([...src.matchAll(/^ {2}([a-zA-Z][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]!));
    const unknown = ALLOWED_DANGLING
      .filter((a) => !declared.has(a.path.split(/[.[]/)[0]!))
      .map((a) => a.path);
    expect(unknown, 'allowance(s) naming no RunState field — delete or correct them').toEqual([]);
  });

  it('every allowance carries a reason', () => {
    expect(ALLOWED_DANGLING.filter((a) => a.why.trim().length < 25).map((a) => a.path)).toEqual([]);
  });
});
