/**
 * DOC BOT — TEXT-AS-ORACLE tranche 2: SUMMONS (handoff §7.1).
 *
 * Tranche 1 (`textOracle.ts`) reconciles printed stat-buff magnitudes; this lane reconciles printed SUMMON
 * clauses — "summon two 1/1 Gemheart Golems with Taunt" — against what the real engine actually summons:
 *
 *   parse the FIRST imperative summon clause from the card's live text (count, token identity, printed
 *   stats, Gilded/Golden, granted keywords) → execute the effect through its real driver (cast / play /
 *   simulate()) → assert the observed summons match on EVERY parsed axis: count, token cardId,
 *   plain-vs-gilded, fixed-vs-copied stats, and the Taunt/Ward/Rise the text promises on the body.
 *
 * Same doctrine as tranche 1: the subject set derives from the EFFECT side (factories whose bodies reach the
 * summon primitives, via `extractFactoryEntries` + SUMMON_CALL_RE) intersected with drivable triggers and a
 * parseable printed clause; unreconcilable shapes go in SUMMON_EXCUSED with a verifiable typed reason;
 * VERIFY-BEFORE-ALARM — investigate every mismatch before it may stand; a verified real bug ships as
 * 'confirmed-bug-pending-fix' with a repro in its `why`, never as a red suite.
 */
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import { createRun } from './../state';
import { reduce } from './../reducer';
import type { RunState, BoardCard } from './../state';
import { stripMarkers } from './textOracle';

// ────────────────────────────────────────── parsing ──────────────────────────────────────────

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
};

const TRIBE_WORDS = new Set(['beast', 'demon', 'dragon', 'dwarf', 'kobold', 'mech', 'undead', 'celestial', 'minion']);

/** Printed keyword names → the core `Keyword` letters the summoned body must actually carry. */
export const KEYWORD_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bTaunt\b/, 'T'],
  [/\bWard\b/, 'DS'],
  [/\bRise\b/, 'R'],
  [/\bWindfury\b/, 'W'],
  [/\bVenomous\b/, 'V'],
  [/\bCleave\b/, 'C'],
];

export type PrintedToken =
  | { kind: 'named'; name: string; cardId: string }
  | { kind: 'named-unresolved'; name: string }
  | { kind: 'self-copy' }
  | { kind: 'random-tribe'; tribe: string }
  | { kind: 'unparseable'; clause: string };

export interface PrintedSummon {
  count: number;
  token: PrintedToken;
  /** The text promises a Gilded/Golden token. */
  goldenToken: boolean;
  /** A printed "A/H" body ("two 1/1 Pups") — or a "set its stats to A/A" tail. */
  stats?: { attack: number; health: number };
  /** Keyword letters the clause grants ("with Taunt and Ward"). */
  keywords: string[];
}

/** name (lowercased) → card id, over the whole index. Built once, lazily. */
let NAME_TO_ID: Map<string, string> | null = null;
function nameToId(): Map<string, string> {
  if (!NAME_TO_ID) {
    NAME_TO_ID = new Map();
    for (const def of Object.values(CARD_INDEX)) {
      if (def) NAME_TO_ID.set(def.name.toLowerCase(), def.id);
    }
  }
  return NAME_TO_ID;
}

/** Resolve a printed (possibly plural) token name to a card id, or null. */
export function resolveTokenName(raw: string): string | null {
  const map = nameToId();
  const name = raw.trim().toLowerCase();
  const candidates = [
    name,
    name.replace(/s$/, ''), // Pups → Pup
    name.replace(/es$/, ''), // Foxes → Fox
    name.replace(/ies$/, 'y'), // Ponies → Pony
    name.replace(/ves\b/g, 'f'), // Wolves → Wolf (also mid-phrase: Crypt Wolves)
    name.replace(/men\b/g, 'man'), // Footmen → Footman
  ];
  for (const c of candidates) {
    const id = map.get(c);
    if (id) return id;
  }
  return null;
}

/**
 * The FIRST imperative summon clause in a text. "Imperative" filters the watcher shapes — "When you summon a
 * Beast …" is tranche 1's domain (a buff), not a summon promise — by rejecting a match whose preceding word
 * is "you" (and the past participle "summoned" never matches `summons?\b` followed by whitespace + clause).
 * Returns null when the text promises no summon (such cards are not tranche-2 subjects).
 */
export function parsePrintedSummon(text: string): PrintedSummon | null {
  const stripped = stripMarkers(text);
  const re = /\b([Rr]e)?[Ss]ummons?\s+([^.]+)/g;
  let m: RegExpExecArray | null;
  let clause: string | null = null;
  while ((m = re.exec(stripped))) {
    const before = stripped.slice(0, m.index);
    if (/\b(?:you|to)\s*$/i.test(before)) continue; // "when you summon…", "the next Beast you summon…"
    clause = m[2]!;
    break;
  }
  if (!clause) return null;
  let rest = clause.trim();

  const printed: PrintedSummon = { count: 1, token: { kind: 'unparseable', clause }, goldenToken: false, keywords: [] };

  const cm = /^(a|an|one|two|three|four|five|six|seven|\d+)\s+/i.exec(rest);
  if (cm) {
    const w = cm[1]!.toLowerCase();
    printed.count = COUNT_WORDS[w] ?? Number(w);
    rest = rest.slice(cm[0].length);
  }

  let random = false;
  if (/^random\s+/i.test(rest)) { random = true; rest = rest.replace(/^random\s+/i, ''); }
  if (/^(gilded|golden)\s+/i.test(rest)) { printed.goldenToken = true; rest = rest.replace(/^(gilded|golden)\s+/i, ''); }
  if (/^random\s+/i.test(rest)) { random = true; rest = rest.replace(/^random\s+/i, ''); }
  if (/^other\s+/i.test(rest)) rest = rest.replace(/^other\s+/i, '');

  const sm = /^(\d+)\/(\d+)\s+/.exec(rest);
  if (sm) { printed.stats = { attack: Number(sm[1]), health: Number(sm[2]) }; rest = rest.slice(sm[0].length); }

  // The name runs to the first connective; the tail may carry granted keywords or a stats-set.
  const cut = rest.search(/\s+(?:with|that|and|next to|beside|in|per|,|\()/i);
  const name = (cut >= 0 ? rest.slice(0, cut) : rest).trim();
  const tail = cut >= 0 ? rest.slice(cut) : '';

  if (/^(?:an? )?(?:exact )?cop(?:y|ies) of (?:this|it)/i.test(rest)) {
    printed.token = { kind: 'self-copy' };
  } else if (random || TRIBE_WORDS.has(name.toLowerCase().replace(/s$/, ''))) {
    printed.token = { kind: 'random-tribe', tribe: name.toLowerCase().replace(/s$/, '') };
  } else if (name) {
    const id = resolveTokenName(name);
    printed.token = id ? { kind: 'named', name, cardId: id } : { kind: 'named-unresolved', name };
  }

  // "with Taunt and Ward" / "with Taunt" — keyword grants live in the connective tail, never the name.
  for (const [nameRe, letter] of KEYWORD_NAMES) {
    if (nameRe.test(tail)) printed.keywords.push(letter);
  }
  // "and set its stats to 7/7"
  const setStats = /set(?:s)? its stats to (\d+)\/(\d+)/i.exec(tail);
  if (setStats) printed.stats = { attack: Number(setStats[1]), health: Number(setStats[2]) };

  return printed;
}

// ─────────────────────────────── subject selection (from the effect side) ───────────────────────────────

/** A call that reaches the summon primitives — `ctx.summon(...)`, `summonToken(...)`, or a helper/arena entry
 *  whose NAME says it summons (`ARENA_EFFECTS.deathrattleSummon(...)`, `battlecrySummon(...)`). Applied to
 *  comment-stripped bodies (tranche 1's `stripComments`), so prose cannot enroll a factory. */
export const SUMMON_CALL_RE = /(?:ctx\.summon|\b\w*[sS]ummon\w*)\s*\(/;

/**
 * Split a factory-map literal into { id → body source } by its ENTRY-HEAD LINES — every `  key: (` at indent
 * 2 between the anchor and the map's column-0 `};` terminator. Tranche 1's brace scanner
 * (`extractFactoryEntries`) stops early in these two maps (a body construct unbalances its depth count
 * mid-file — it captures only ~95 of ~400 entries, enough for the stat-buff family it was floored against
 * but blind to the later set-2 sections where most summoners live). This extractor keys on the files'
 * MECHANICAL layout instead — entry heads are always `  identifier: (` — so an interior brace can never end
 * the sweep. Over-capture is impossible for the same reason nested keys sit at indent ≥ 4.
 */
export function extractEntriesByLine(source: string, anchor: string): Record<string, string> {
  const at = source.indexOf(anchor);
  if (at < 0) return {};
  const end = source.indexOf('\n};', at);
  const region = source.slice(at, end < 0 ? source.length : end);
  const heads: Array<{ id: string; start: number }> = [];
  const re = /\n {2}([A-Za-z0-9_$]+):\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region))) heads.push({ id: m[1]!, start: m.index });
  const entries: Record<string, string> = {};
  for (let i = 0; i < heads.length; i++) {
    entries[heads[i]!.id] = region.slice(heads[i]!.start, heads[i + 1]?.start ?? region.length);
  }
  return entries;
}

/** Which headless driver can fire each trigger. Triggers absent here (onBuy, spellCast watchers, orbit,
 *  goldSpent, endOfTurn-cast chains, …) are OUT OF LANE for tranche 2. `repeatable` marks triggers a single
 *  fight can legitimately fire several times — the count contract there is "a positive multiple". */
export type SummonLane = 'spell' | 'shout' | 'combat';
export const SUMMON_LANES: Readonly<Record<string, { lane: SummonLane; repeatable?: boolean }>> = {
  cast: { lane: 'spell' },
  onPlay: { lane: 'shout' },
  onDeath: { lane: 'combat' },
  startOfCombat: { lane: 'combat' },
  avenge: { lane: 'combat', repeatable: true },
  onAttack: { lane: 'combat', repeatable: true },
};

export interface SummonSubject {
  cardId: string;
  on: string;
  do: string;
  lane: SummonLane;
  repeatable: boolean;
  printed: PrintedSummon;
  /** goldenText's parsed clause when present (drives the golden run); null → the golden run is skipped and
   *  counted in the test's no-golden-text pin. */
  printedGolden: PrintedSummon | null;
}

/** The subject set: every card whose FIRST in-lane summon-family effect has a parseable printed summon
 *  clause. Cards in the family whose text yields no clause are not subjects (watcher texts, "your summons
 *  trigger twice", …) — the same doctrine as tranche 1's no-printed-magnitude drop. */
export function summonSubjects(summonFamily: ReadonlySet<string>): SummonSubject[] {
  const out: SummonSubject[] = [];
  for (const def of Object.values(CARD_INDEX)) {
    if (!def || def.ruby) continue;
    const eff = def.effects.find((e) => summonFamily.has(e.do) && SUMMON_LANES[e.on] !== undefined
      && (def.spell ? e.on === 'cast' : e.on !== 'cast'));
    if (!eff) continue;
    const printed = parsePrintedSummon(def.text);
    if (!printed) continue;
    const printedGolden = def.goldenText ? parsePrintedSummon(def.goldenText) : null;
    const lane = SUMMON_LANES[eff.on]!;
    out.push({ cardId: def.id, on: eff.on, do: eff.do, lane: lane.lane, repeatable: !!lane.repeatable, printed, printedGolden });
  }
  return out;
}

// ────────────────────────────────────────── reconciliation ──────────────────────────────────────────

export interface ObservedSummon { cardId: string; golden: boolean; attack: number; health: number; keywords: string[] }

/**
 * Every parsed axis, checked: count, token identity, gilding, printed stats, granted keywords. Returns the
 * problem list (empty = reconciled). `self` is the summoner's own body (self-copy identity + stats).
 *
 * Gilding semantics (measured on the first full run, 2026-08-27): a "Gilded/Golden <Token>" clause means the
 * token body is gilded AND its stats are the printed pair DOUBLED ("Gilded 1/1 Trooper" summons a 2/2 —
 * `n2_muster`'s golden text). Conversely a GOLDEN RUN may summon gilded tokens whose goldenText folds the
 * doubling into the printed stats without saying "Gilded" ("summon two 0/4 Void Cubs" — `manasaber`), so a
 * golden run only alarms on the gilding axis when the text PROMISES gilding and the body is plain; the
 * doubled stats axis still binds either way. A copy-of-this clause follows the summoner's own gilding.
 */
export function reconcileSummons(
  printed: PrintedSummon,
  observed: ObservedSummon[],
  self: { cardId: string; attack: number; health: number; golden: boolean },
  repeatable: boolean,
  goldenRun = false,
): string[] {
  const problems: string[] = [];
  if (repeatable) {
    if (observed.length < printed.count || observed.length % printed.count !== 0) {
      problems.push(`count: printed ${printed.count} per proc, observed ${observed.length} total (not a positive multiple)`);
    }
  } else if (observed.length !== printed.count) {
    problems.push(`count: printed ${printed.count}, observed ${observed.length}`);
  }
  const expectGolden = printed.goldenToken || (printed.token.kind === 'self-copy' && self.golden);
  const statMult = printed.goldenToken ? 2 : 1;
  for (const o of observed) {
    const t = printed.token;
    if (t.kind === 'named' && o.cardId !== t.cardId) problems.push(`token: printed ${t.name} (${t.cardId}), observed ${o.cardId}`);
    if (t.kind === 'self-copy' && o.cardId !== self.cardId) problems.push(`token: printed a copy of ${self.cardId}, observed ${o.cardId}`);
    if (t.kind === 'random-tribe' && t.tribe !== 'minion') {
      const d = CARD_INDEX[o.cardId];
      if (!d || (d.tribe !== t.tribe && d.tribe2 !== t.tribe && !d.universalTribe)) {
        problems.push(`token: printed a random ${t.tribe}, observed ${o.cardId} (${d?.tribe ?? '??'})`);
      }
    }
    if (goldenRun ? (expectGolden && !o.golden) : (o.golden !== expectGolden)) {
      problems.push(`gilding: printed ${expectGolden ? 'Gilded' : 'plain'}, observed ${o.golden ? 'gilded' : 'plain'} ${o.cardId}`);
    }
    if (printed.stats && (o.attack !== printed.stats.attack * statMult || o.health !== printed.stats.health * statMult)) {
      problems.push(`stats: printed ${printed.stats.attack}/${printed.stats.health}${statMult === 2 ? ' gilded (×2)' : ''}, observed ${o.attack}/${o.health} on ${o.cardId}`);
    }
    if (t.kind === 'self-copy' && !printed.stats && (o.attack !== self.attack || o.health !== self.health)) {
      problems.push(`stats: a copy of this body (${self.attack}/${self.health}), observed ${o.attack}/${o.health}`);
    }
    for (const k of printed.keywords) {
      if (!o.keywords.includes(k)) problems.push(`keyword: printed ${k} missing on summoned ${o.cardId} [${o.keywords.join(',')}]`);
    }
  }
  return problems;
}

export type SummonLaneOutcome =
  | { outcome: 'reconciled' }
  | { outcome: 'mismatch'; problems: string[]; observed: ObservedSummon[] }
  | { outcome: 'silent' }
  | { outcome: 'refused' };

// ────────────────────────────────────────── execution lanes ──────────────────────────────────────────

function shopBase(board: BoardCard[]): RunState {
  return {
    ...createRun(0x51ab, 'aster'),
    wave: 8,
    tier: 6,
    embers: 60,
    board,
    hand: [],
    shop: [],
  } as RunState;
}

const asObserved = (c: BoardCard): ObservedSummon =>
  ({ cardId: c.cardId, golden: !!c.golden, attack: c.attack, health: c.health, keywords: [...c.keywords] });

/** SPELL lane: cast through the real reducer on an empty board; arrivals (new uids) are the summons. */
export function runSummonSpellLane(def: CardDef, printed: PrintedSummon): SummonLaneOutcome {
  const s0 = shopBase([]);
  const inHand: BoardCard = { uid: 'oracleSpell', cardId: def.id, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false } as BoardCard;
  const s1 = reduce({ ...s0, hand: [inHand] }, { type: 'play', uid: 'oracleSpell' });
  if (s1.hand.some((c) => c.uid === 'oracleSpell')) return { outcome: 'refused' };
  const observed = s1.board.map(asObserved);
  if (observed.length === 0) return { outcome: 'silent' };
  const problems = reconcileSummons(printed, observed, { cardId: def.id, attack: 0, health: 0, golden: false }, false);
  return problems.length ? { outcome: 'mismatch', problems, observed } : { outcome: 'reconciled' };
}

/** SHOUT lane: play the minion itself onto an empty board; arrivals besides the played body are the summons. */
export function runSummonShoutLane(def: CardDef, printed: PrintedSummon, golden: boolean): SummonLaneOutcome {
  const mult = golden ? 2 : 1;
  const s0 = shopBase([]);
  const inHand: BoardCard = {
    uid: 'oraclePlay', cardId: def.id, tribe: def.tribe,
    attack: def.attack * mult, health: def.health * mult,
    keywords: [...def.keywords], golden,
  } as BoardCard;
  let s1 = reduce({ ...s0, hand: [inHand] }, { type: 'play', uid: 'oraclePlay' });
  if (s1.pendingTarget?.uid === 'oraclePlay') s1 = reduce(s1, { type: 'battlecryTarget', targetUid: 'oraclePlay' });
  if (s1.hand.some((c) => c.uid === 'oraclePlay')) return { outcome: 'refused' };
  const observed = s1.board.filter((c) => c.uid !== 'oraclePlay').map(asObserved);
  if (observed.length === 0) return { outcome: 'silent' };
  const self = s1.board.find((c) => c.uid === 'oraclePlay');
  const problems = reconcileSummons(printed, observed,
    { cardId: def.id, attack: self?.attack ?? def.attack * mult, health: self?.health ?? def.health * mult, golden }, false, golden);
  return problems.length ? { outcome: 'mismatch', problems, observed } : { outcome: 'reconciled' };
}

/** Per-card fixture arming for combat subjects the DEFAULT fixture cannot serve: friend-death watchers need
 *  fodder AND a surviving subject even though their trigger is `onDeath`, and per-friend-death summons proc
 *  once per death. `why` must say what the arm stages and why the default fixture fails without it. */
export const SUMMON_ARM: Readonly<Record<string, { fodder?: boolean; survive?: boolean; repeatable?: boolean; why: string }>> = {
  brood: {
    fodder: true, survive: true, repeatable: true,
    why: 'Brood Matron rides onDeath but is a FRIEND-death watcher (onFriendDeathSummon, max 3/combat) — she must OUTLIVE the fodder that feeds her, and summons once per death, so the default die-fast/no-fodder onDeath fixture reads silent',
  },
};

/**
 * COMBAT lane: one real `simulate()`; the 'summon' events whose `source` is the subject are the summons
 * (their `MinionSnapshot` carries cardId/stats/keywords/golden — the beastBatch `summonsBy` shape).
 * Fixture: an onDeath subject fights a 60/40000 wall ALONE at its def stats — the wall kills it on the
 * first clash and the Echo resolves onto an empty 7-slot board (no fodder body may eat summon room: the
 * first full run read "Summon 7 Imps" as 4 because four live fodder held slots — a room artifact, not a
 * count bug). Every other trigger gets a 9999-health subject that outlives the fight: Start of Combat fires
 * immediately, the subject's own attacks feed onAttack, and — for Avenge — four 0/1 fodder Pups die to the
 * wall while the subject stands (the first run's subject died before its fourth feed, reading as silent).
 * `R` is stripped from the subject so a Rise cannot double an Echo measurement.
 */
export function runSummonCombatLane(def: CardDef, printed: PrintedSummon, golden: boolean, on: string, repeatable: boolean): SummonLaneOutcome {
  const mult = golden ? 2 : 1;
  const arm = SUMMON_ARM[def.id];
  const bm = (cardId: string, uid: string, attack: number, health: number, g = false, keywords: string[] = []): BoardMinion =>
    ({ cardId, attack, health, sourceUid: uid, keywords, golden: g } as BoardMinion);
  const survives = (on !== 'onDeath') || !!arm?.survive;
  const fodder = on === 'avenge' || !!arm?.fodder;
  const subj: BoardMinion = bm(
    def.id, 'oracleSubj',
    Math.max(def.attack * mult, 1),
    survives ? 9999 : Math.max(def.health * mult, 1),
    golden,
    def.keywords.filter((k) => k !== 'R'),
  );
  const player: BoardMinion[] = [
    subj,
    ...(fodder ? [bm('pup', 'fd0', 0, 1), bm('pup', 'fd1', 0, 1), bm('pup', 'fd2', 0, 1), bm('pup', 'fd3', 0, 1)] : []),
  ];
  const enemy: BoardMinion[] = [bm('sandbag', 'wall', 60, 40000)];
  const r = simulate(player, enemy, makeRng(23), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
  const subjUid = r.initial.player.find((m) => m.cardId === def.id)?.uid;
  const initSubj = r.initial.player.find((m) => m.cardId === def.id);
  const observed = (r.events.filter((e) => e.type === 'summon' && (e as { source?: string }).source === subjUid) as unknown as
    { minion: { cardId: string; golden?: boolean; attack: number; health: number; keywords: string[] } }[])
    .map((e) => ({ cardId: e.minion.cardId, golden: !!e.minion.golden, attack: e.minion.attack, health: e.minion.health, keywords: [...e.minion.keywords] }));
  if (observed.length === 0) return { outcome: 'silent' };
  const problems = reconcileSummons(printed, observed,
    { cardId: def.id, attack: initSubj?.attack ?? subj.attack, health: initSubj?.health ?? subj.health, golden },
    repeatable || !!arm?.repeatable, golden);
  return problems.length ? { outcome: 'mismatch', problems, observed } : { outcome: 'reconciled' };
}

/** Run a subject through its lane. The golden run parses goldenText (null → the caller skips it). */
export function runSummonSubject(subject: SummonSubject, golden: boolean): SummonLaneOutcome {
  const def = CARD_INDEX[subject.cardId]!;
  const printed = golden ? subject.printedGolden! : subject.printed;
  switch (subject.lane) {
    case 'spell': return runSummonSpellLane(def, printed);
    case 'shout': return runSummonShoutLane(def, printed, golden);
    case 'combat': return runSummonCombatLane(def, printed, golden, subject.on, subject.repeatable);
  }
}

// ────────────────────────────────────────── excuses + ratchet ──────────────────────────────────────────

export interface SummonExcuse {
  /**
   * Why this card's printed summon cannot be reconciled headlessly — every skip is typed (§7.6):
   *  'conditional'       — the summon demands state the clean fixture cannot supply (hand contents, prior
   *                        deaths of a specific tribe, Rubies accrued, room-dependent counts).
   *  'trigger-unarmed'   — the fixture cannot fire the trigger the way the card demands.
   *  'aggregate-count'   — the observed count legitimately differs from the printed per-proc count under
   *                        any single fixture (caps, room-as-available wording, chained self-copies).
   *  'token-name-informal' — the printed token NAME does not match the token card's registered name
   *                        (a text-quality finding per §7.5 — parked for an owner wording ruling, not an
   *                        invented expectation).
   *  'snapshot-buffed'   — a sibling effect of the SAME card buffs the token before/at the summon snapshot,
   *                        so the printed base stats never appear on any observable surface.
   *  'needs-triage'      — found, not yet ruled. Tolerated, reported, pinned.
   *  'confirmed-bug-pending-fix' — a VERIFIED real mismatch, documented with a repro; the fix PR deletes it.
   */
  kind: 'conditional' | 'trigger-unarmed' | 'aggregate-count' | 'token-name-informal' | 'snapshot-buffed' | 'needs-triage' | 'confirmed-bug-pending-fix';
  /** One line a future reader can verify. */
  why: string;
}

/** Seeded from the scan's first full run (2026-08-27) — every entry INVESTIGATED before excusal
 *  (verify-before-alarm): the outcome named in `why` is what the lane actually measured. */
export const SUMMON_EXCUSED: Readonly<Record<string, SummonExcuse>> = {
  dw_exgalloper: {
    kind: 'needs-triage',
    why: 'gilded Ex-Galloper\'s Echo copies carry the EXACT gilded stats (12/12) but a PLAIN golden flag, while Mirrorhide Rhino\'s scSummonCopy copies keep the Gilded badge — the two copy-summon factories disagree on whether "exact copy" includes the badge. Owner question: should echoSummonCopyNoEcho\'s copy of a Gilded body render Gilded? (Behavioural stats are exact either way — presentation/copy-semantics ruling, not a magnitude bug.)',
  },
};
