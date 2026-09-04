/**
 * DOC BOT LANE `textOracle` — the TEXT-AS-ORACLE scan for printed stat buffs (tranche 1).
 *
 * The differential scans (9/10) prove an effect does SOMETHING; the magnitude oracles (13) prove three
 * hand-ruled families grant what their PARAMS say. This lane closes the remaining gap for the biggest
 * effect family of all — stat buffs — by exploiting the owner's standing hard rule (CLAUDE.md, 2026-07-02):
 * **card text always shows the CURRENT value**, computed by the same helpers the sim reads. That makes the
 * printed text itself an executable oracle:
 *
 *   parse the FIRST "+A/+H" (or "+N Attack" / "+N Health") from the card's LIVE text
 *   → execute the effect through its real driver (cast / play / End of Turn / simulate())
 *   → assert some recipient's measured stat delta EQUALS the printed pair (goldenText's pair when gilded).
 *
 * A mismatch is a defect EITHER WAY — a magnitude bug, or a stale printed number — so the alarm is always
 * right. Subject selection starts from the EFFECT side (every factory whose body reaches the buff
 * primitives, derived from source by `extractFactoryEntries` + `BUFF_CALL_RE` so a new buff factory is
 * swept in the day it is written), intersected with the triggers a headless driver can actually fire
 * (`ORACLE_LANES`).
 *
 * Doctrine (same as phaseRegistry): cards whose printed number legitimately cannot be reconciled headlessly
 * go in `ORACLE_EXCUSED` with a verifiable reason; undecided ones carry 'needs-triage', tolerated but
 * pinned; and the two-sided ratchet in `textOracle.test.ts` stops both the subject surface collapsing and
 * the excuse list growing silently. VERIFY-BEFORE-ALARM: a new mismatch must be investigated (wrong
 * fixture? unarmed scaler?) before it may stand — a verified real bug ships as
 * 'confirmed-bug-pending-fix' with a repro in its `why`, never as a red suite.
 */
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import { createRun } from './../state';
import { reduce } from './../reducer';
import { applyEndOfTurn, spellDisplayText } from './../recruit';
import type { RunState, BoardCard } from './../state';

// ────────────────────────────────────────── parsing ──────────────────────────────────────────

export interface PrintedBuff { attack: number; health: number }

/** Strip the render markers the live-text chain uses: **bold** and the {{live-value}} green wrapper. */
export function stripMarkers(text: string): string {
  return text.replace(/\*\*/g, '').replace(/\{\{|\}\}/g, '');
}

/**
 * The FIRST printed stat-buff magnitude in a text: "+A/+H" beats "+N Attack" / "+N Health" only by position
 * — whichever appears first is the card's headline grant, which is the pair tranche 1 reconciles.
 * Returns null when the text prints no stat buff at all (such cards are not subjects).
 */
export function parseFirstStatBuff(text: string): PrintedBuff | null {
  const m = /\+(\d+)\/\+(\d+)|\+(\d+) Attack|\+(\d+) Health/.exec(stripMarkers(text));
  if (!m) return null;
  if (m[1] !== undefined) return { attack: Number(m[1]), health: Number(m[2]) };
  if (m[3] !== undefined) return { attack: Number(m[3]), health: 0 };
  return { attack: 0, health: Number(m[4]) };
}

/** The reconciliation contract: the printed pair landed on AT LEAST ONE recipient EXACTLY. (Target
 *  correctness — did it also hit the RIGHT minions — is a later tranche; magnitude is this one.) */
export function reconcile(printed: PrintedBuff, deltas: ReadonlyArray<readonly [number, number]>): boolean {
  return deltas.some(([a, h]) => a === printed.attack && h === printed.health);
}

// ─────────────────────────────── subject selection (from the effect side) ───────────────────────────────

/** A call that reaches the buff primitives — `ctx.buff` (combat), `addBuff`/`cardBuff` (shop) — or a local
 *  helper whose name says it buffs (the shop factories often route through one). Applied to COMMENT-STRIPPED
 *  factory bodies, so a mention in prose cannot enroll a factory. */
export const BUFF_CALL_RE = /(?:ctx\.buff|addBuff|cardBuff|\b\w*[bB]uff\w*)\s*\(/;

/** Remove // and /* *​/ comments so BUFF_CALL_RE sees only code. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Split a factory-map object literal (`const RECRUIT_FACTORIES = { id: (…) => {…}, … }`) into
 * { id → body source }. A small brace scanner that skips strings and comments — good enough for these two
 * files' shapes; it does not need to be a parser, only to never MISS an entry (over-splitting an entry's
 * body merely shrinks that body, and the regex above still sees its head).
 */
export function extractFactoryEntries(source: string, anchor: string): Record<string, string> {
  const at = source.indexOf(anchor);
  if (at < 0) return {};
  const open = source.indexOf('{', at);
  if (open < 0) return {};
  const entries: Record<string, string> = {};
  let depth = 0;
  let i = open;
  let currentKey: string | null = null;
  let bodyStart = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && next === '*') { i = source.indexOf('*/', i); if (i < 0) break; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < source.length && source[i] !== q) { if (source[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') {
      if (c === '{' && depth === 0 && i === open) { depth = 1; i++; continue; }
      depth++;
      i++;
      continue;
    }
    if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0 && c === '}') { // the map literal closed
        if (currentKey) entries[currentKey] = source.slice(bodyStart, i);
        break;
      }
      i++;
      continue;
    }
    if (depth === 1 && c === ':') {
      // The identifier immediately before a depth-1 ':' names the entry — when it starts a statement.
      const back = /([A-Za-z0-9_$]+)\s*$/.exec(source.slice(Math.max(open + 1, i - 100), i));
      if (back && isEntryKeyPosition(source, i - back[0].length)) {
        if (currentKey) entries[currentKey] = source.slice(bodyStart, i - back[0].length);
        currentKey = back[1]!;
        bodyStart = i + 1;
      }
      i++;
      continue;
    }
    i++;
  }
  return entries;
}

/** An identifier before a depth-1 ':' is an entry key only when it starts a statement — i.e. the previous
 *  non-space char is one of `{`, `,` or a comment/newline boundary (this filters `a ? b : c` ternaries). */
function isEntryKeyPosition(source: string, keyStart: number): boolean {
  let j = keyStart - 1;
  while (j >= 0 && /\s/.test(source[j]!)) j--;
  return j < 0 || source[j] === '{' || source[j] === ',';
}

/** Which headless driver can fire each trigger. Triggers absent here are OUT OF LANE for tranche 1 (onBuy,
 *  onSell, spellCast watchers, onSummon, …) — later tranches add drivers, they are not silently green. */
export type OracleLane = 'spell' | 'shout' | 'eot' | 'combat';
export const ORACLE_LANES: Readonly<Record<string, OracleLane>> = {
  cast: 'spell', // castable shop spells, driven through the real reducer play action
  onPlay: 'shout', // Shouts, incl. the two-step pendingTarget → battlecryTarget aim
  endOfTurn: 'eot', // applyEndOfTurn on a staged board
  onDeath: 'combat', // reconciled against the simulate() 'buff' event log
  startOfCombat: 'combat',
  onAttack: 'combat',
  onKill: 'combat',
  avenge: 'combat',
  onDamaged: 'combat',
};

export interface OracleSubject {
  cardId: string;
  on: string;
  do: string;
  lane: OracleLane;
  printed: PrintedBuff;
  /** goldenText's parsed pair when present (else 2× printed, the default gild semantics). */
  printedGolden: PrintedBuff;
}

/** The subject set: every (card, effect) pair whose factory reaches the buff primitives, whose trigger has
 *  a tranche-1 driver, and whose live text prints a stat-buff magnitude. One subject per card — the FIRST
 *  in-lane buff effect names the lane, the FIRST printed pair is the contract. */
export function oracleSubjects(buffFamily: ReadonlySet<string>): OracleSubject[] {
  const out: OracleSubject[] = [];
  for (const def of Object.values(CARD_INDEX)) {
    if (!def || def.ruby) continue;
    const eff = def.effects.find((e) => buffFamily.has(e.do) && ORACLE_LANES[e.on] !== undefined
      && (def.spell ? e.on === 'cast' : e.on !== 'cast'));
    if (!eff) continue;
    const printed = parseFirstStatBuff(liveShopText(def));
    if (!printed) continue; // no printed magnitude → nothing to reconcile (named-cast exemption & co.)
    const printedGolden = (def.goldenText && parseFirstStatBuff(def.goldenText))
      || { attack: printed.attack * 2, health: printed.health * 2 };
    out.push({ cardId: def.id, on: eff.on, do: eff.do, lane: ORACLE_LANES[eff.on]!, printed, printedGolden });
  }
  return out;
}

/** The LIVE shop-side text, through the same helper the UI reads. Spells route through `spellDisplayText`
 *  (zero bonuses under the base fixture — the spell-power lane re-reads it with bonuses ARMED); minions'
 *  shop text is `def.text` (their scaling variants print through UI-side helpers this lane cannot import —
 *  those parse as their base and either reconcile at base or sit in ORACLE_EXCUSED as scalers). */
export function liveShopText(def: CardDef, bonusA = 0, bonusH = 0): string {
  if (def.spell) return spellDisplayText(def.id, bonusA, 0, bonusH, 0, 0, 0, { tier: 4, playedThisTurn: [] });
  return def.text;
}

// ────────────────────────────────────────── execution lanes ──────────────────────────────────────────

const pupBody = (uid: string, tribe: string, cardId = 'pup'): BoardCard =>
  ({ uid, cardId, tribe, attack: 1, health: 1, keywords: [], golden: false } as BoardCard);

/** Seven retribed 1/1 CLEAN TOKENS — one per tribe — so tribe-scoped grants always have a recipient.
 *  Instance tribes are authoritative in the shop (`isTribe` reads `card.tribe` first), and the bodies are
 *  behaviour-free, so no fixture watcher can mask or fake a delta (the playScan clean-token lesson). The
 *  ids are DISTINCT on purpose: this fixture's first draft used seven Pups and the reducer TRIPLE-COMBINED
 *  three of them mid-measurement, which read as effects "eating" fixture bodies.
 *  (Exported for the target-cardinality oracle, which re-drives the SAME fixtures to normalize recipients.) */
export function tribeRow(): BoardCard[] {
  const row: Array<[string, string]> = [
    ['pup', 'beast'], ['omen', 'demon'], ['cindarawhelp', 'dragon'], ['stray', 'dwarf'],
    ['gemheart-shard', 'kobold'], ['nanobot', 'mech'], ['cryptwolf', 'undead'],
  ];
  return row.map(([id, t], i) => pupBody(`fix${i}`, t, id));
}

export function shopBase(board: BoardCard[]): RunState {
  return {
    ...createRun(0x7e11, 'aster'),
    wave: 8,
    tier: 4,
    embers: 60,
    board,
    hand: [],
    shop: [],
  } as RunState;
}

/** The run-wide aura channels a "your X gain …" grant writes instead of any board stat: Shop-spell power
 *  (`spellBonus`), the Ruby aura (`rubyBonus`) and the Imp aura (`impBuff`). Snapshotted BY VALUE before a
 *  lane runs — some writers mutate the existing object in place (`grantSpellPower` does `.attack += a`), so
 *  holding a pre-run object reference reads the post-run numbers and the movement vanishes (this lane's own
 *  first run lost Aeonguard's End of Turn exactly that way). */
type ChannelSnap = Array<readonly [number, number]>;
const channelSnap = (s: RunState): ChannelSnap =>
  [s.spellBonus, s.rubyBonus, s.impBuff].map((v) => [v?.attack ?? 0, v?.health ?? 0] as const);

/** Per-minion board deltas (by uid, over bodies present on both sides of the run) PLUS the channel deltas —
 *  each channel's movement is one more (ΔA, ΔH) candidate, so Cinderwing's "+1 Health to your Shop spells"
 *  reconciles against the `spellBonus` delta exactly as a board buff would. */
const deltasByUid = (before: RunState, after: RunState, chanBefore: ChannelSnap): Array<readonly [number, number]> => {
  const pre = new Map(before.board.map((c) => [c.uid, c] as const));
  const out: Array<readonly [number, number]> = [];
  for (const c of after.board) {
    const b = pre.get(c.uid);
    if (b) out.push([c.attack - b.attack, c.health - b.health] as const);
  }
  const chanAfter = channelSnap(after);
  for (let i = 0; i < chanAfter.length; i++) {
    out.push([chanAfter[i]![0] - chanBefore[i]![0], chanAfter[i]![1] - chanBefore[i]![1]] as const);
  }
  return out;
};

export type LaneOutcome =
  | { outcome: 'reconciled' }
  | { outcome: 'mismatch'; deltas: Array<readonly [number, number]> }
  | { outcome: 'silent' } // the driver ran but no stat moved / no buff event from the subject
  | { outcome: 'refused' }; // the driver could not even fire the effect (play refused, no cast)

/** SPELL lane: cast through the real reducer, target on `fix0` (retribed to the spell's demanded tribe when
 *  it declares one). `printed` is passed in so the spell-power liveness lane can re-run with an ARMED state
 *  and the re-parsed text. */
export function runSpellLane(def: CardDef, printed: PrintedBuff, arm?: (s: RunState) => void): LaneOutcome {
  const board = tribeRow();
  const tgtTribe = (def as { targetTribe?: string }).targetTribe;
  if (tgtTribe) board[0] = pupBody('fix0', tgtTribe);
  const s0 = shopBase(board);
  arm?.(s0);
  const pre = { ...s0, board: s0.board.map((c) => ({ ...c })) } as RunState; // by-value: reducer paths may mutate bodies/channels in place
  const chanBefore = channelSnap(s0);
  const inHand: BoardCard = { uid: 'oracleSpell', cardId: def.id, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false } as BoardCard;
  const s1 = reduce({ ...s0, hand: [inHand] }, { type: 'play', uid: 'oracleSpell', targetUid: 'fix0' });
  if (s1.hand.some((c) => c.uid === 'oracleSpell')) return { outcome: 'refused' };
  const deltas = deltasByUid(pre, s1, chanBefore).filter(([a, h]) => a !== 0 || h !== 0);
  if (deltas.length === 0) return { outcome: 'silent' };
  return reconcile(printed, deltas) ? { outcome: 'reconciled' } : { outcome: 'mismatch', deltas };
}

/** The six-body SHOP fixture row for minion plays: one clean token each of beast/dragon/dwarf/kobold/undead
 *  plus Fred (the FD Fodder token, demon) and the Attachment token retribed mech — so Fodder-, Attachment-
 *  and most tribe-scoped grants all have a recipient while one slot stays free for the play itself. */
export function shoutRow(): BoardCard[] {
  return [
    pupBody('fix0', 'beast'),
    pupBody('fix1', 'dragon', 'cindarawhelp'),
    pupBody('fix2', 'dwarf', 'stray'),
    pupBody('fix3', 'kobold', 'gemheart-shard'),
    { ...pupBody('fix4', 'demon', 'fred'), keywords: ['FD'] } as BoardCard,
    { ...pupBody('fix5', 'mech', 'symbioticattachment'), keywords: ['M'] } as BoardCard,
  ];
}

/** SHOUT lane: play the minion itself (two-step aim when the battlecry targets), measure every pre-existing
 *  body's delta PLUS the played body's own delta relative to its def stats (self-buffs count). */
export function runShoutLane(def: CardDef, printed: PrintedBuff, golden: boolean): LaneOutcome {
  const mult = golden ? 2 : 1;
  const board = shoutRow();
  const tgtTribe = (def as { targetTribe?: string }).targetTribe;
  if (tgtTribe) board[0] = pupBody('fix0', tgtTribe);
  const s0 = shopBase(board);
  const pre = { ...s0, board: s0.board.map((c) => ({ ...c })) } as RunState; // by-value (see channelSnap)
  const chanBefore = channelSnap(s0);
  const inHand: BoardCard = {
    uid: 'oraclePlay', cardId: def.id, tribe: def.tribe,
    attack: def.attack * mult, health: def.health * mult,
    keywords: [...def.keywords], golden,
  } as BoardCard;
  let s1 = reduce({ ...s0, hand: [inHand] }, { type: 'play', uid: 'oraclePlay' });
  if (s1.pendingTarget?.uid === 'oraclePlay') s1 = reduce(s1, { type: 'battlecryTarget', targetUid: 'fix0' });
  if (s1.hand.some((c) => c.uid === 'oraclePlay')) return { outcome: 'refused' };
  const deltas = deltasByUid(pre, s1, chanBefore).filter(([a, h]) => a !== 0 || h !== 0);
  const self = s1.board.find((c) => c.uid === 'oraclePlay');
  if (self) {
    const sa = self.attack - def.attack * mult;
    const sh = self.health - def.health * mult;
    if (sa !== 0 || sh !== 0) deltas.push([sa, sh] as const);
  }
  if (deltas.length === 0) return { outcome: 'silent' };
  return reconcile(printed, deltas) ? { outcome: 'reconciled' } : { outcome: 'mismatch', deltas };
}

/** EOT lane: the subject sits on a staged board; `applyEndOfTurn` fires the real dispatcher; deltas across
 *  the whole board (the subject's own delta counts — most EoT buffs act on self). */
export function runEotLane(def: CardDef, printed: PrintedBuff, golden: boolean): LaneOutcome {
  const mult = golden ? 2 : 1;
  const subj: BoardCard = {
    uid: 'oracleEot', cardId: def.id, tribe: def.tribe,
    attack: def.attack * mult, health: def.health * mult,
    keywords: [...def.keywords], golden,
  } as BoardCard;
  const s = shopBase([subj, ...shoutRow()]);
  const before = { ...s, board: s.board.map((c) => ({ ...c })) } as RunState;
  const chanBefore = channelSnap(s);
  applyEndOfTurn(s);
  const deltas = deltasByUid(before, s, chanBefore).filter(([a, h]) => a !== 0 || h !== 0);
  if (deltas.length === 0) return { outcome: 'silent' };
  return reconcile(printed, deltas) ? { outcome: 'reconciled' } : { outcome: 'mismatch', deltas };
}

/**
 * COMBAT lane: run one real `simulate()` and reconcile against the 'buff' events the subject emitted (each
 * carries attack/health/source — the beastBatch `buffsOn` shape). The fixture arms as many combat triggers
 * as one fight can: Start of Combat fires immediately; the subject attacks every round (Rally / on-kill vs
 * the 1/1 chaff); the enemy wall damages it (on-damaged); the 1-hp friend dies (Avenge); and the subject
 * itself eventually dies to the wall (Echo). Friends include one real minion per tribe so tribe-scoped
 * grants have recipients (combat derives tribes from defs, so retribed Pups don't work here); their own
 * effects cannot contaminate the measurement because events are filtered by SOURCE.
 */
export function runCombatLane(def: CardDef, printed: PrintedBuff, golden: boolean): LaneOutcome {
  const mult = golden ? 2 : 1;
  const bm = (cardId: string, uid: string, attack: number, health: number, g = false, keywords: string[] = []): BoardMinion =>
    ({ cardId, attack, health, sourceUid: uid, keywords, golden: g } as BoardMinion);
  const friendOf = (tribe: string): BoardMinion | null => {
    const d = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && (c.tribe === tribe || c.tribe2 === tribe));
    return d ? bm(d.id, `fr_${tribe}`, 1, 30) : null;
  };
  const subj: BoardMinion = {
    ...bm(def.id, 'oracleSubj', Math.max(def.attack * mult, 4), Math.max(def.health * mult, 1) + 60, golden),
    align: 'dawn', // Celestial dawn-gated halves fire; a dusk-only subject needs an ORACLE_EXCUSED ruling
    ...(ORACLE_ARM[def.id]?.minion ?? {}),
  };
  const player: BoardMinion[] = [
    subj,
    bm('pup', 'fr_dies', 1, 1), // Avenge fodder
    bm('impscrap', 'fr_imp', 1, 30), // an Imp that attacks (Imp-watcher triggers) and receives Imp buffs
    bm('cryptwolf', 'fr_rally', 1, 30, false, ['RL']), // a Rally-keyword ally (rally-watcher triggers)
    bm('symbioticattachment', 'fr_att', 1, 30, false, ['M']), // an Attachment recipient (M-scoped grants)
    ...(['beast', 'dragon'].map(friendOf).filter((x): x is BoardMinion => !!x)),
  ];
  const enemy: BoardMinion[] = [bm('pup', 'en0', 1, 1), bm('pup', 'en1', 1, 1), bm('sandbag', 'wall', 9, 400)];
  // `alesLastTurn: 1` arms the Dwarven-Ale scalers at exactly one Ale — the rate their base text prints.
  const r = simulate(player, enemy, makeRng(11), CARD_INDEX, combatSide({ tier: 5, alesLastTurn: 1 }), combatSide({ tier: 5 }));
  const subjUid = r.initial.player.find((m) => m.cardId === def.id)?.uid;
  const events = (r.events.filter((e) => (e as { type?: string }).type === 'buff') as unknown as
    { target: string; attack: number; health: number; source: string }[])
    .filter((b) => b.source === subjUid || b.source === def.name);
  if (events.length === 0) return { outcome: 'silent' };
  const deltas = events.map((b) => [b.attack, b.health] as const);
  return reconcile(printed, deltas) ? { outcome: 'reconciled' } : { outcome: 'mismatch', deltas };
}

/** Run a subject through its lane. Golden runs only apply to minion lanes (spells never gild). */
export function runSubject(subject: OracleSubject, golden: boolean): LaneOutcome {
  const def = CARD_INDEX[subject.cardId]!;
  const printed = golden ? subject.printedGolden : subject.printed;
  switch (subject.lane) {
    case 'spell': return golden ? { outcome: 'reconciled' } : runSpellLane(def, printed);
    case 'shout': return runShoutLane(def, printed, golden);
    case 'eot': return runEotLane(def, printed, golden);
    case 'combat': return runCombatLane(def, printed, golden);
  }
}

// ────────────────────────────────────────── excuses + ratchet ──────────────────────────────────────────

export interface OracleExcuse {
  /**
   * Why this card's printed number cannot be reconciled headlessly — or is not yet ruled:
   *  'scaler-unarmed'   — the printed value folds live state the fixture does not stage (per-N tallies,
   *                       accrued escalation, spell-progress) so the base parse ≠ the fixture grant.
   *  'self-referential' — "equal to its Attack"-shaped: the magnitude names a stat, not a constant.
   *  'conditional'      — the grant demands a subject the clean fixture cannot supply (FD/Imp def checks,
   *                       Discover picks, a specific hand/shop shape).
   *  'aggregate-grant'  — the first printed pair is per-recipient but the grant lands split/summed/repeated
   *                       (or on a non-board surface: hand, shop, next-combat bank) so no single board delta
   *                       equals it.
   *  'trigger-unarmed'  — the combat fixture cannot fire the trigger (needs a specific killer/attacker
   *                       pattern the staged fight does not produce).
   *  'needs-triage'     — Doc Bot found it; nobody has ruled. Tolerated, reported, pinned.
   *  'confirmed-bug-pending-fix' — a VERIFIED real mismatch, documented with a repro; ships excused so the
   *                       suite stays green, and the fix PR deletes the entry.
   */
  kind: 'scaler-unarmed' | 'self-referential' | 'conditional' | 'aggregate-grant' | 'trigger-unarmed' | 'needs-triage' | 'confirmed-bug-pending-fix';
  /** One line a future reader can verify. */
  why: string;
}

/** Per-card fixture arming for scalers whose printed value folds an accrual the base fixture leaves at
 *  zero: the arm stages EXACTLY the state under which the base text's printed rate is the true grant, so
 *  the card graduates from excused to covered. `why` must say what state is staged and why that equals the
 *  printed number. */
export const ORACLE_ARM: Readonly<Record<string, { minion?: Partial<BoardMinion>; why: string }>> = {
  packleader: {
    minion: { summonBonus: 3 },
    why: 'scTribeBuffImproving params are attack:0/step:0 — the whole rate is the countTribeSummon accrual (+3 per Beast played); summonBonus=3 stages "one Beast played", which is the printed +3/+3',
  },
  n2_standardbearer: {
    minion: { keywords: ['RL'] },
    why: 'Standard Bearer is a SELF-only Rally as of 2026-09-03 (the `selfOnly` param) — it no longer buffs on the fixture cryptwolf\'s Rally, and the base subject carries no keywords, so it must be armed with its OWN RL to fire its Rally on its own swing. Its +3/+3 (golden +6/+6) then lands on one recipient per tribe',
  },
};

/** Seeded from the scan's own first full run (2026-08-26) — every entry was INVESTIGATED before excusal
 *  (verify-before-alarm): the outcome named in `why` is what the lane actually measured. */
export const ORACLE_EXCUSED: Readonly<Record<string, OracleExcuse>> = {
  sp_blessing: {
    kind: 'aggregate-grant',
    why: 'the cast applies its +3/+4 TWICE to the one target (measured [[+6,+8]]) — per-application is correct, but no single cumulative delta can equal the printed pair',
  },
  dm_hungerling: {
    kind: 'aggregate-grant',
    why: 'its Rally enchants minions in the SHOP (`rallyBuffShopPermanent` writes the tavern carry-back channel) — there is no combat-board recipient, so the buff-event lane has nothing to measure; presence is covered by the combat differential',
  },
};
