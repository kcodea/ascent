/**
 * DOC BOT LANE `entryPaths` — every way a card enters the hand or board is derived from source, and every
 * non-shop card is driven into play through its REAL path and cast under a differential that can see a no-op.
 *
 * Born from Bug Board 9852e16f (PR #1374): four targeted Gifts consumed the card, counted the cast and
 * changed nothing for a month, because nothing staged the only way a Gift ever arrives. Doctrine, the site
 * scan, the worklist derivation and the stagers live in `entryPaths.ts`.
 *
 * Gates:
 *   · SITE COMPLETENESS — every `hand`/`board` entry write in reducer.ts + recruit.ts is classified in
 *     `ENTRY_SITES`; a site nobody classified fails, and so does an entry with no site.
 *   · REACHABILITY — every set-less card is named by SOMETHING (a card, rune, hero, quest, equipment or
 *     engine scope), or carries an `ENTRY_ORPHAN_EXCUSED` reason.
 *   · THE CAST DIFFERENTIAL — every cast-shaped non-shop card that a stager delivers (the Gifts through
 *     Merry Christmas's Discover, Tower Shield through its minting Shout, Clue through the Magnifying Glass,
 *     Rubies and Copycat through their runes) changes something beyond bookkeeping when cast. Zero inert.
 *   · PINNED QUEUES — refusals and unstaged paths are two-sided pins: surfaced, never silently skipped.
 *
 * SABOTAGE PROOFS (recorded 2026-09-11):
 *   · GIT-LEVEL: `applyCastEffects` reverted to sending `{ minion }` alone (the exact 9852e16f bug) → the
 *     lane reports INERT = [gift_ironclad, gift_unbridled, gift_regalia, gift_parting_gifts] — the four
 *     targeted Gifts, by name. With the fix restored: zero inert.
 *   · WHY THE PLAY LANE MISSED IT (an instrument finding, not a registry gap): `playScan`'s spell sub-lane
 *     DID cast every Gift — but it diffs against the PRE-REDUCE fixture, and `reduce` lazily initialises a
 *     dozen fields on every action (`lastRallyFires`, `fodderEaten`, `cardsPlayedTotal`, …), so every cast
 *     read as effectful and that gate was vacuously green. The differential here compares two post-`reduce`
 *     states; the in-file check below proves it can call a cast inert.
 *   · IN-FILE: a synthetic no-op cast (the Gift leaves the hand, the counters tick, nothing else moves)
 *     must project EQUAL to its arrival state, and a one-point stat change must not.
 */
import { describe, expect, it } from 'vitest';
import { GIFT_IDS } from '@game/content';
import type { RunState } from '../state';
import {
  ENTRY_ORPHAN_EXCUSED, ENTRY_SITES, auditEntrySites, castProjection, entryScan, entryWorklist, pathLabel, stageArrival,
} from './entryPaths';

describe('Doc Bot — entry paths: sites', () => {
  const audit = auditEntrySites();

  it('every hand/board entry write in the reducer + recruit engine is classified', () => {
    const list = audit.unclassified.map((s) => `${s.key} @${s.file}:${s.line}`);
    expect(list, `Unclassified entry site(s): ${list.join(' · ')} — add an ENTRY_SITES entry naming the kind of arrival.`).toEqual([]);
  });

  it('no registry entry describes a site that no longer exists', () => {
    expect(audit.stale, `Stale ENTRY_SITES key(s): ${audit.stale.join(', ')}`).toEqual([]);
  });

  it('the scan sees the load-bearing chokepoints', () => {
    for (const key of ['reducer.ts#buy#hand', 'reducer.ts#play#board', 'reducer.ts#takeDiscoverPick#hand', 'recruit.ts#conjureToHand#hand', 'recruit.ts#mintHandSpells#hand']) {
      expect(audit.sites.some((s) => s.key === key), `${key} must be a scanned site`).toBe(true);
      expect(ENTRY_SITES[key]).toBeTruthy();
    }
  });
});

describe('Doc Bot — entry paths: the non-shop worklist', () => {
  const scan = entryScan();

  it('every set-less card is named by something, or carries an orphan reason', () => {
    const unexplained = scan.orphans.filter((id) => !ENTRY_ORPHAN_EXCUSED[id]);
    expect(unexplained, `Orphan card(s) nobody names: ${unexplained.join(', ')} — unreachable content, or reached by a path the derivation cannot see (add the path kind to entryWorklist, or excuse with a reason).`).toEqual([]);
    const stale = Object.keys(ENTRY_ORPHAN_EXCUSED).filter((id) => !scan.orphans.includes(id));
    expect(stale, `Stale orphan excuse(s): ${stale.join(', ')} — the card now has a path.`).toEqual([]);
  });

  it('every Gift is on the worklist as a cast, reachable through the Gift runes', () => {
    for (const id of GIFT_IDS) {
      const item = scan.worklist.find((w) => w.id === id);
      expect(item?.shape, `${id} must be a cast-shaped worklist item`).toBe('cast');
      const labels = item!.paths.map(pathLabel);
      expect(labels.some((l) => l === 'source:runeMerryChristmas' || l === 'source:runeHappyBirthday'), `${id} paths: ${labels.join(', ')}`).toBe(true);
    }
  });

  it('every staged non-shop cast changes something beyond bookkeeping (the Gifts class)', () => {
    expect(scan.inert, `Inert non-shop cast(s) — arrived through a real path, cast, and changed NOTHING beyond hand-consumption / cast counters / cost: ${scan.inert.join(', ')}`).toEqual([]);
  });

  it('the Gifts, Tower Shield, Clue, Rubies and Copycat are VERIFIED through their real arrival paths', () => {
    for (const id of GIFT_IDS) expect(scan.verified[id], `${id} verified via`).toMatch(/^rune:rune_(merry_christmas|happy_birthday)/);
    expect(scan.verified['tower_shield']).toMatch(/^card:/);
    expect(scan.verified['clue']).toMatch(/^equipment:/);
    expect(scan.verified['ruby']).toMatch(/^rune:/);
    expect(scan.verified['copycat']).toMatch(/^rune:/);
  });

  it('refused casts are a pinned queue (0 as of 2026-09-11)', () => {
    expect(scan.refused, `Non-shop cast(s) the reducer refused after a real arrival: ${scan.refused.join(', ')}`).toEqual([]);
  });

  it('unstaged paths are a pinned queue (1 as of 2026-09-11: warding-ruby)', () => {
    // warding-ruby: named only by Facetbound's def (a Choose One branch mints it via a mechanism the play
    // stager's branch sweep does not deliver into the hand under the fixture). A NEW entry here means a new
    // non-shop cast the lane cannot reach — extend stageArrival or the card ships untested by this lane.
    expect(Object.keys(scan.unstaged).sort(), `unstaged: ${JSON.stringify(scan.unstaged)}`).toEqual(['warding-ruby']);
  });

  it('every cast-shaped, named worklist item lands in exactly one bucket (nothing is silently skipped)', () => {
    const casts = scan.worklist.filter((w) => w.shape === 'cast' && w.paths.length > 0).map((w) => w.id);
    const seen = [...Object.keys(scan.verified), ...scan.inert, ...scan.refused, ...Object.keys(scan.unstaged)];
    expect(seen.sort()).toEqual(casts.sort());
  });

  it('SABOTAGE: the projection calls a no-op cast inert, and a one-point change effectful', () => {
    const item = entryWorklist().find((w) => w.id === 'gift_unbridled')!;
    const staged = stageArrival(item);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const arrived = staged.state;
    // A cast that only pays the bookkeeping: the card leaves the hand, the counters tick, nothing else moves.
    const noop: RunState = {
      ...arrived,
      hand: arrived.hand.filter((c) => c.uid !== staged.uid),
      spellsCast: arrived.spellsCast + 1, spellsThisTurn: arrived.spellsThisTurn + 1,
      playedThisTurn: [...(arrived.playedThisTurn ?? []), 'gift_unbridled'],
      cardsPlayedTotal: (arrived.cardsPlayedTotal ?? 0) + 1,
    } as RunState;
    expect(castProjection(noop), 'a bookkeeping-only cast must read INERT — otherwise the gate is vacuous (the play lane\'s baseline trap)').toBe(castProjection(arrived));
    const changed: RunState = { ...noop, board: noop.board.map((c, i) => (i === 0 ? { ...c, attack: c.attack + 1 } : c)) };
    expect(castProjection(changed)).not.toBe(castProjection(arrived));
  });
});
