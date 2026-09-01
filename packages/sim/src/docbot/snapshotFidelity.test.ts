/**
 * DOC BOT LANE `snapshotFidelity` — snapshot fidelity: every per-instance field is classified at every boundary.
 *
 * A new field on `BoardCard` / `BoardMinion` used to cross the fidelity boundaries only if its author
 * remembered every by-name copy site — `cleanBoard`, the reducer's player mapping, `instantiate`, the
 * `initial` snapshot. Forget one and the field is dropped SILENTLY: the served board fights differently
 * than the board it was captured from (PR #453 shipped four of exactly these). This suite forces the
 * decision at authoring time:
 *
 *   1. The authoritative field lists are re-derived by PARSING the interface declarations from source
 *      (TS types are erased at runtime; the source is the truth). A fully-populated exemplar — typed
 *      `Required<...>` so typecheck itself demands completeness — must set every parsed field.
 *   2. The exemplar is pushed through each REAL boundary (the actual serialize/deserialize, the actual
 *      snapshotBoard, the actual simulate) and every dropped field must have a SNAPSHOT_EXCUSED entry
 *      with a verifiable why. A new field fails here with "classify me".
 *   3. Two-sided ratchet: an excused field that now SURVIVES is a stale excuse (delete it), and the
 *      'needs-triage' backlog is pinned at its seeded count — it can only shrink.
 *   4. A sabotage check proves the diff itself: delete a surviving field from a capture output and the
 *      diff must name it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoardMinion, EffectDef, Keyword } from '@game/core';
import { makeRng, simulate } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { BoardCard } from '../state';
import { createRun, deserialize, serialize } from '../state';
import { snapshotBoard } from '../snapshot';
import { SNAPSHOT_EXCUSED, SNAPSHOT_TRIAGE_COUNT, droppedFields } from './snapshotRegistry';
import type { SnapshotBoundary } from './snapshotRegistry';

// ── 1. The authoritative field lists, parsed from the interface declarations ─────────────────────────────

/** Extract the top-level field names of `export interface <name> { ... }` from a source file.
 *  Comment-aware and depth-tracked, so docblock braces and nested object types never produce phantom
 *  fields. Throws if the interface is missing — a rename must update this test, not silently pass it. */
function parseInterfaceFields(sourcePath: string, name: string): string[] {
  const src = readFileSync(sourcePath, 'utf8');
  const start = src.indexOf(`export interface ${name}`);
  if (start < 0) throw new Error(`interface ${name} not found in ${sourcePath} — renamed? Update snapshotFidelity.test.ts`);
  let depth = 0;
  let body = ''; // the interface body with comments stripped and nested braces' content elided
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src.startsWith('/*', i)) { i = src.indexOf('*/', i) + 1; continue; }
    if (src.startsWith('//', i)) { i = src.indexOf('\n', i); continue; }
    const c = src[i];
    if (c === '{') { depth++; if (depth === 1) continue; }
    if (c === '}') { depth--; if (depth === 0) break; }
    if (depth >= 1) body += depth === 1 ? c : ' ';
  }
  if (depth !== 0) throw new Error(`unbalanced braces parsing interface ${name} in ${sourcePath}`);
  const fields: string[] = [];
  const re = /(?:^|[;\n])\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??:/g;
  for (let m = re.exec(body); m; m = re.exec(body)) fields.push(m[1]!);
  return fields;
}

const BOARD_CARD_FIELDS = parseInterfaceFields(fileURLToPath(new URL('../state.ts', import.meta.url)), 'BoardCard');
const BOARD_MINION_FIELDS = parseInterfaceFields(fileURLToPath(new URL('../../../core/src/types.ts', import.meta.url)), 'BoardMinion');

// ── 2. The exemplars: every optional field set to a distinctive truthy sentinel of the right type ────────
// Truthy matters: the boundaries deliberately omit zero/absent values (`...(c.x ? {x} : {})`), so a falsy
// sentinel would test the leanness rule, not fidelity.

/** A real, effect-less minion card — the exemplar's identity, so `simulate` runs it without side plots. */
const vanillaId = (): string => {
  const c = Object.values(CARD_INDEX).find((d) => d && !d.spell && !d.ruby && (d.effects?.length ?? 0) === 0 && !d.universalTribe);
  if (!c) throw new Error('no effect-less minion card found for the exemplar');
  return c.id;
};
const spellId = (): string => {
  const c = Object.values(CARD_INDEX).find((d) => d?.spell);
  if (!c) throw new Error('no spell card found for the exemplar');
  return c.id;
};

/** A benign, REAL Deathrattle (mirrors the recruit.ts graft shape) so registered effects never dangle. */
const sentinelEcho = (): EffectDef[] => [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: vanillaId(), count: 1 } }];

/** Every BoardCard field populated. `Required<BoardCard>` makes a NEW field a typecheck failure here —
 *  the runtime parse-check below backs it up in case the type and the source ever drift. */
function boardCardExemplar(): Required<BoardCard> {
  return {
    uid: 'exemplar-uid',
    cardId: vanillaId(),
    tribe: 'beast',
    attack: 7,
    health: 9,
    sellOverride: 4,
    chooseBothLeft: 1, // Dealer's own latch — per instance, so a snapshot has to carry it
    keywords: ['DS'] as Keyword[],
    golden: true,
    addedTribes: ['mech'],
    allTribes: true,
    chosenOption: 1,
    grantedTier: 3,
    buffs: [{ source: 'exemplar-buff', attack: 2, health: 3, count: 1 }],
    chefGranted: 6,
    summonBonus: 2,
    attackSeen: 3,
    bredCount: 2,
    bredThisTurn: 1,
    impBank: { attack: 2, health: 5 },
    rallySpreadAtk: 4,
    overflowBonus: 5,
    hpGrantBonus: 3,
    copiedEcho: sentinelEcho(),
    copiedEchoName: 'Exemplar Echo',
    grantedEffects: sentinelEcho(),
    manaBonus: 2,
    rallyMechAtk: 5,
    rallySpellWeld: 1,
    attachments: 2,
    spellAuraBonus: 1,
    fodderAuraBonus: { attack: 1, health: 2 },
    tempShield: true,
    tempReborn: true,
    bloodlust: true,
    bloodbinderMode: 'hp',
    bloodlustRally: true,
    resummon: true,
    partingCry: true,
    closedCasket: true,
    lockedUntilTier: 4,
    lockedUntilGoldSpent: 70,
    lockedUntilWave: 5,
    borrowed: true,
    eotBonus: 3,
    spellProgress: 4,
    boughtWave: 2,
    sellBonus: 3,
    soldProgress: 2,
    echoStripped: true,
    goldTick: 5,
    buyTick: 2,
    playTick: 3,
    rubyRecvTick: 1,
    eotTick: 2,
    spellsOnThisTurn: 1,
    rubiesOnThisTurn: 1,
    tempGrants: [{ label: 'Rise', keyword: 'R' }],
    boardSpellCount: 2,
    soldSeen: 1,
    teachTick: 1,
    rubyCastTick: 2,
    boardFirstSpellId: spellId(),
    taughtSpellId: spellId(),
    shoutTick: 2,
    orbitTick: 1,
    ascendProgress: 3,
  };
}

/** Every BoardMinion field populated (the combat-boundary exemplar). */
function boardMinionExemplar(): Required<BoardMinion> {
  return {
    cardId: vanillaId(),
    attack: 7,
    health: 9999, // survives the fight — `initial` is captured pre-combat, but a quiet sim keeps the run honest
    align: 'dawn',
    keywords: ['DS'] as Keyword[],
    golden: true,
    critChance: 0.5,
    addedTribes: ['mech'],
    rallyMechAtk: 5,
    rallySpellWeld: 1,
    copiedEcho: sentinelEcho(),
    grantedEffects: sentinelEcho(), // runtime shop grafts — folded into Minion.effects at instantiate (2026-08-27)
    echoStripped: true, // "without Echo" mark — consumed at instantiate (filters the onDeath effects out)
    impBank: { attack: 2, health: 5 }, // Ashen Heir's shop bank — cloned onto Minion.impBank, spent live
    universalTribe: true,
    bloodbinderMode: 'hp',
    bloodlust: true,
    bloodlustRally: true,
    chosenOption: 1,
    taughtSpellId: spellId(),
    chefGrantedLast: 6,
    summonBonus: 2,
    eotBonus: 3,
    sellBonus: 3,
    eotTick: 2,
    overflowBonus: 5,
    hpGrantBonus: 3,
    ascendProgress: 3,
    spellProgress: 4,
    sourceUid: 'exemplar-source-uid',
    resummon: true,
    partingCry: true,
    closedCasket: true,
    buffs: [{ source: 'exemplar-buff', attack: 2, health: 3, count: 1 }],
    text: 'Exemplar live text.',
    goldenText: 'Exemplar golden text.',
    name: 'Exemplar Name',
    tribe: 'beast',
  };
}

// ── The boundary drives (each runs the REAL production path) ─────────────────────────────────────────────

/** 'save': the run through the actual serialize → deserialize (save-and-continue). */
function saveRoundTrip(card: BoardCard): object {
  const run = createRun(1);
  run.board = [card];
  return deserialize(serialize(run)).board[0]!;
}

/** 'capture': the actual snapshotBoard (servedBoards / opponent pipeline / leaderboard). */
function captureBoard(card: BoardCard): object {
  const run = createRun(1);
  run.board = [card];
  return snapshotBoard(run).minions[0]!;
}

/** 'combat': the actual simulate — what survives into `CombatResult.initial`. */
function combatInitial(minion: BoardMinion): object {
  const enemy: BoardMinion = { cardId: vanillaId(), attack: 1, health: 1 };
  return simulate([minion], [enemy], makeRng(7), CARD_INDEX).initial.player[0]!;
}

// ── The suite ────────────────────────────────────────────────────────────────────────────────────────────

describe('Doc Bot — snapshot fidelity (the PR #453 bug class)', () => {
  it('the BoardCard exemplar is complete against the parsed interface (a new field must be classified, not guessed)', () => {
    const ex = boardCardExemplar();
    const missing = BOARD_CARD_FIELDS.filter((f) => !(f in ex));
    expect(missing, `BoardCard field(s) missing from the exemplar: ${missing.join(', ')} — set each in snapshotFidelity.test.ts, then run the boundary tests: they will tell you whether it survives or needs a SNAPSHOT_EXCUSED entry`).toEqual([]);
    expect(BOARD_CARD_FIELDS.length, 'the parser found implausibly few BoardCard fields — check parseInterfaceFields against state.ts').toBeGreaterThan(30);
  });

  it('the BoardMinion exemplar is complete against the parsed interface', () => {
    const ex = boardMinionExemplar();
    const missing = BOARD_MINION_FIELDS.filter((f) => !(f in ex));
    expect(missing, `BoardMinion field(s) missing from the exemplar: ${missing.join(', ')} — set each in snapshotFidelity.test.ts`).toEqual([]);
    expect(BOARD_MINION_FIELDS.length, 'the parser found implausibly few BoardMinion fields — check parseInterfaceFields against types.ts').toBeGreaterThan(20);
  });

  const boundaryCases: { boundary: SnapshotBoundary; fields: string[]; run: () => object }[] = [
    { boundary: 'save', fields: BOARD_CARD_FIELDS, run: () => saveRoundTrip(boardCardExemplar()) },
    { boundary: 'capture', fields: BOARD_CARD_FIELDS, run: () => captureBoard(boardCardExemplar()) },
    { boundary: 'combat', fields: BOARD_MINION_FIELDS, run: () => combatInitial(boardMinionExemplar()) },
  ];

  for (const { boundary, fields, run } of boundaryCases) {
    it(`'${boundary}' boundary: every field survives or carries a registered excuse`, () => {
      const dropped = droppedFields(fields, run(), boundary);
      const unexcused = dropped.filter((f) => SNAPSHOT_EXCUSED[`${boundary}:${f}`] === undefined);
      expect(unexcused, `Field(s) silently dropped at the '${boundary}' boundary with no excuse:\n  ${unexcused.join('\n  ')}\nThread each through the boundary (see the copy sites in snapshotRegistry.ts's header), or register a SNAPSHOT_EXCUSED['${boundary}:<field>'] entry with a verifiable why.`).toEqual([]);
    });
  }

  it("'save' round-trips values exactly, not just key presence (JSON must not distort a field)", () => {
    const ex = boardCardExemplar();
    expect(saveRoundTrip(ex)).toEqual(ex);
  });

  it('excuses are real: each names a live field, for a boundary that still drops it (two-sided ratchet)', () => {
    const survivors: Record<SnapshotBoundary, object> = {
      save: saveRoundTrip(boardCardExemplar()),
      capture: captureBoard(boardCardExemplar()),
      combat: combatInitial(boardMinionExemplar()),
    };
    const sourceFields: Record<SnapshotBoundary, string[]> = {
      save: BOARD_CARD_FIELDS,
      capture: BOARD_CARD_FIELDS,
      combat: BOARD_MINION_FIELDS,
    };
    const stale: string[] = [];
    for (const [key, ex] of Object.entries(SNAPSHOT_EXCUSED)) {
      const [boundary, field] = key.split(':') as [SnapshotBoundary, string];
      if (ex.boundary !== boundary) { stale.push(`${key}: entry's boundary field says '${ex.boundary}' — fix the key or the entry`); continue; }
      if (!sourceFields[boundary].includes(field)) { stale.push(`${key}: '${field}' is no longer a field of the source interface — delete the entry`); continue; }
      if (!droppedFields([field], survivors[boundary], boundary).includes(field)) {
        stale.push(`${key}: excused but the field now SURVIVES the '${boundary}' boundary — delete the entry (the implementation wins)`);
      }
    }
    expect(stale, `Stale excuse(s):\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it(`the needs-triage backlog can only shrink (ratchet: ${SNAPSHOT_TRIAGE_COUNT} as of 2026-08-26)`, () => {
    const triage = Object.entries(SNAPSHOT_EXCUSED).filter(([, e]) => e.kind === 'needs-triage');
    expect(triage.length, `needs-triage entries: ${triage.map(([k]) => k).join(', ')} — resolving one? lower SNAPSHOT_TRIAGE_COUNT. Adding one? that needs an owner ruling, not a bigger number.`).toBeLessThanOrEqual(SNAPSHOT_TRIAGE_COUNT);
    expect(SNAPSHOT_TRIAGE_COUNT, 'SNAPSHOT_TRIAGE_COUNT is higher than the actual backlog — lower it to match').toBeLessThanOrEqual(triage.length);
  });

  it('sabotage: deleting a surviving field from a capture output makes the diff report it', () => {
    const real = captureBoard(boardCardExemplar()) as Record<string, unknown>;
    expect(droppedFields(['hpGrantBonus'], real, 'capture'), 'precondition: hpGrantBonus survives the real capture').toEqual([]);
    const sabotaged = { ...real };
    delete sabotaged['hpGrantBonus'];
    expect(droppedFields(['hpGrantBonus'], sabotaged, 'capture')).toEqual(['hpGrantBonus']);
    // And through a rename: allTribes survives as universalTribe — remove the renamed key, the SOURCE name is reported.
    const sabotaged2 = { ...real };
    delete sabotaged2['universalTribe'];
    expect(droppedFields(['allTribes'], sabotaged2, 'capture')).toEqual(['allTribes']);
  });
});
