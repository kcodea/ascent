/**
 * DOC BOT — the rune-reward differential scan, shared by `runeRewardDifferential.test.ts` (which gates on it)
 * and the `npm run docbot` CLI (which prints the swallow list as the owner's duplicate-policy triage queue).
 * One implementation so the two can never disagree — see the test for the full doctrine (#900 history, the
 * stable-stringify lesson, why second-copy is a ratchet not a gate).
 *
 * Pure logic (no fs), so it may ride the public sim entrypoint safely.
 */
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun } from '../state';
import { reduce } from '../reducer';
import type { RunState } from '../state';
import { RUNE_DIFF_EXCUSED } from './historyRegistry';

/** Fields the purchase itself touches — the receipt, not the reward. Stripped before diffing.
 *  `goldSpent`/`goldSpentThisTurn` are `spendGold` side-effects of paying for the rune.
 *  `embers` left the list on 2026-08-27: the scan now buys every rune COST-NEUTRALLY (a full discount), so
 *  a Gold movement in the diff can only be the REWARD — which is exactly what a re-granted one-shot
 *  (Small Fortune paying again) and the duplicate sweetener (half cost + a free refresh) pay in. */
const BOOKKEEPING = new Set([
  'ownedRunes', 'runeforgeOffer', 'runeforgeEpic', 'runeforgeNoCharge', 'runeforgeDiscounts',
  'heroPowerSpent', 'runeProcs', 'rngCursor', 'uidCounter', 'runeDuplication', 'lastRuneBought',
  'presentation', 'fx', 'beats', 'log', 'goldSpent', 'goldSpentThisTurn',
]);

/** ORDER-INSENSITIVE stringify. Load-bearing: `{ ...s, runeforgeOffer }` re-inserts keys, so plain
 *  JSON.stringify differs between two applications even when every VALUE matches — which made the first cut
 *  of the differential vacuously green (its own sabotage check caught the blindness). */
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
};

const strip = (s: RunState, alsoFlagCopies: boolean): string => {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (BOOKKEEPING.has(k) || v === undefined) continue;
    if (alsoFlagCopies && k === 'flagCopies') continue;
    o[k] = v;
  }
  return stable(o);
};

/** An AMOUNT-carrying combat flag must accumulate its VALUE — `flagCopies` ticking is not enough (it records
 *  every application unconditionally, so it would mask exactly the pre-#900 overwrite bug). Boolean flags
 *  keep `flagCopies` in the diff: the copy count IS their sanctioned accumulation mechanism.
 *
 *  EXCEPTION (owner ruling 2026-08-27, q-runedup-threshold): a flag whose amount is a THRESHOLD, not a
 *  payout. Accumulating it would make the rune WORSE (two Returning Packs ≠ "every 12 Beasts"); the ruled
 *  behaviour is same meter, payout × copies — so for these two, `flagCopies` IS the sanctioned mechanism
 *  (the combat dispatchers pay once per copy) and it stays in the diff. */
const THRESHOLD_FLAGS = new Set(['runeReturningPack', 'runeGraveRefreshment']);
const isAmountFlag = (reward: unknown): boolean => {
  const r = reward as { kind?: string; amount?: unknown; flag?: string } | undefined;
  return r?.kind === 'combatFlag' && typeof r.amount === 'number' && !THRESHOLD_FLAGS.has(r.flag ?? '');
};

/** A board with one of every major tribe + shop offers + hand room + gold, so tribe-/target-scoped rewards
 *  have something real to act on and cannot no-op for lack of a subject. */
export function runeDiffFixture(): RunState {
  const pick = (tribe: string): string =>
    Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && (c.tribe === tribe || c.tribe2 === tribe))!.id;
  const body = (uid: string, id: string): unknown => {
    const d = CARD_INDEX[id]!;
    return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], buffs: [] };
  };
  return {
    ...createRun(0xd0cb07, 'aster'),
    wave: 8,
    tier: 4,
    embers: 999,
    board: ['beast', 'demon', 'dragon', 'dwarf', 'kobold', 'undead'].map((t, i) => body(`b${i}`, pick(t))),
    hand: [],
    shop: [{ uid: 's0', cardId: pick('beast') }, { uid: 's1', cardId: pick('dwarf') }],
  } as unknown as RunState;
}

/** Buy COST-NEUTRALLY (full discount): with the purchase price out of the picture, any `embers` movement in
 *  the diff is the reward itself — a re-granted Gold one-shot, or the duplicate sweetener's payout. */
const buyRune = (s: RunState, runeId: string): RunState => {
  const cost = [...RUNES, ...EPIC_RUNES].find((r) => r.id === runeId)?.cost ?? 0;
  return reduce({ ...s, runeforgeOffer: [runeId], runeforgeDiscounts: [cost] } as RunState, { type: 'buyRune', index: 0 });
};

/** Run both differentials over every rune. `firstNoops` = the hard-gate failures (a reward that does nothing
 *  at all — #900's shape); `secondSwallowed` = the ratcheted duplicate-policy backlog. */
export function runeSwallowScan(): { firstNoops: string[]; secondSwallowed: string[]; refused: string[] } {
  const firstNoops: string[] = [];
  const secondSwallowed: string[] = [];
  const refused: string[] = [];
  for (const rune of [...RUNES, ...EPIC_RUNES]) {
    const excuse = RUNE_DIFF_EXCUSED[rune.id];
    const s0 = runeDiffFixture();
    const once = buyRune(s0, rune.id);
    if (once === s0) { refused.push(rune.id); continue; }
    if (excuse?.which !== 'first' && strip(once, false) === strip(s0, false)) firstNoops.push(rune.id);
    if (excuse) continue;
    const twice = buyRune(once, rune.id);
    const ignoreCopies = isAmountFlag((rune as { reward?: unknown }).reward);
    if (strip(twice, ignoreCopies) === strip(once, ignoreCopies)) secondSwallowed.push(rune.id);
  }
  return { firstNoops, secondSwallowed, refused };
}
