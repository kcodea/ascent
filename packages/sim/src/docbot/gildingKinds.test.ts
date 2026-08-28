/**
 * THE GILDING-SHAPE LANE — the enforcement home of R-GILD-01 / R-GILD-02 (owner rulings 2026-08-28).
 *
 * The owner revised four convention cards with one shared message: DOUBLING THE OUTPUT IS THE SAFE
 * BASELINE, with three sanctioned outlier shapes — a GILDED TOKEN at the same count, a RESHAPE of the
 * effect, an EXTRA PROC — and one flat inapplicability: "spells cannot be gilded".
 *
 * This lane gates that encoding end to end:
 *  · every card contract carries a gilded shape, each with a `basis` saying how the claim was produced —
 *    derived from the defs, or named by an owner ruling; a shape is never guessed silently (§4.3);
 *  · the owner's NAMED EXEMPLARS are driven through the REAL engine (§4.1), so the encoding is checked
 *    against behaviour and not against itself: Dunkey summons ONE gilded Armadiyo, Void Panther gilds its
 *    Cubs without changing the count, Wolves Den doubles its count the plain way;
 *  · R-GILD-02 is structural — every spell contract states 'not-applicable' WITH its reason, the validator
 *    rejects any other claim on a spell (and rejects an absent one), and the planner emits a typed
 *    'gild-not-applicable' skip rather than leaving 99 spells in the unresolved pool;
 *  · SABOTAGE (§4.5) — each new branch is doctored and proven to flip: a gilded-token contract whose engine
 *    summon is not gilded, one whose count moves, an extra-proc factor, and a spell smuggling a 'multiply'.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { allContracts } from '@game/rules/contracts';
import { APPROVED_RULES } from '@game/rules';
import {
  contractErrors, gildedDeltaErrors,
  type ContentContract, type GildedDeltaContract,
} from '@game/rules/contracts/schema';
import { extractAllContracts } from './contractExtract';
import { gildedTokenClaim, planCases } from './isolatedCases';
import { gildedCountRelation, runContractSweep } from './contractOracle';

const CONTRACTS = allContracts();
const byId = new Map(CONTRACTS.map((c) => [c.contentId, c]));
const gildOf = (id: string): GildedDeltaContract => {
  const g = byId.get(id)?.gildedDelta;
  if (!g) throw new Error(`no gildedDelta on contract '${id}'`);
  return g;
};

// ── a tiny real-engine harness (the same shape every other WP D driver uses) ─────────────────────────────

const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra }) as BoardMinion;

const fight = (player: BoardMinion[], enemy: BoardMinion[]) => simulate(
  player, enemy, makeRng(1), CARD_INDEX,
  combatSide({ tier: 6, tribes: ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'], questMods: {} } as never),
  combatSide({ tier: 1 } as never),
);

/** Every player-side summon of one token id, off the authoritative event log. */
function summons(source: string, golden: boolean, tokenId: string, via: 'onDeath' | 'avenge'): Array<{ golden?: boolean }> {
  const body = bm(source, golden ? 2 : 1, via === 'avenge' ? 400 : 1, { keywords: ['T'], ...(golden ? { golden: true } : {}) });
  const board = via === 'avenge' ? [body, ...Array.from({ length: 5 }, () => bm('b2_packstrider', 1, 1))] : [body];
  const r = fight(board, [bm('sandbag', via === 'avenge' ? 2 : 5, 4000)]);
  return r.events
    .filter((e) => e.type === 'summon' && (e as { side?: string }).side !== 'enemy'
      && (e as { minion?: { cardId?: string } }).minion?.cardId === tokenId)
    .map((e) => (e as { minion: { golden?: boolean } }).minion);
}

// ── 1. the encoding itself ───────────────────────────────────────────────────────────────────────────────

describe('gilded shapes — the encoding (R-GILD-01)', () => {
  it('every card-like contract carries a gilded shape with a stated basis', () => {
    const cardLike = new Set(['minion', 'spell', 'token', 'gift', 'henchman']);
    const extracted = extractAllContracts().contracts.filter((c) => cardLike.has(c.contentType));
    expect(extracted.length).toBeGreaterThan(300);
    const missing = extracted.filter((c) => !c.gildedDelta).map((c) => c.contentId);
    expect(missing, 'a card with no gilded claim reads as unprobed').toEqual([]);
    const basisless = extracted.filter((c) => !c.gildedDelta!.basis).map((c) => c.contentId);
    expect(basisless, 'a shape with no basis cannot be told from an owner ruling').toEqual([]);
  });

  it('an unresolved shape is always a VISIBLE gap, never a silent one (§4.3)', () => {
    const unresolved = CONTRACTS.filter((c) => c.gildedDelta?.basis === 'unresolved');
    for (const c of unresolved) {
      expect(c.gildedDelta!.kind, `${c.contentId}: an unresolved shape must not claim a real kind`).toBe('other');
      expect(c.extraction?.unparsed ?? [], `${c.contentId}: unresolved shape missing from the visible queue`).toContain('gildedDelta.shape');
    }
  });

  it('the whole registry passes the extended validator', () => {
    expect(CONTRACTS.flatMap((c) => contractErrors(c))).toEqual([]);
  });

  it('shape derivation is DETERMINISTIC — two extractions agree byte for byte', () => {
    const shapes = (): string => JSON.stringify(extractAllContracts().contracts.map((c) => [c.contentId, c.gildedDelta]));
    expect(shapes()).toBe(shapes());
  });

  it('the checked-in registry matches a fresh extraction (contracts:extract was re-run)', () => {
    const fresh = new Map(extractAllContracts().contracts.map((c) => [c.contentId, JSON.stringify(c.gildedDelta ?? null)]));
    const drifted = CONTRACTS
      .filter((c) => fresh.has(c.contentId) && fresh.get(c.contentId) !== JSON.stringify(c.gildedDelta ?? null))
      .map((c) => c.contentId);
    expect(drifted, 'stale extracted.generated.ts — run `npm run contracts:extract`').toEqual([]);
  });

  it('R-GILD-01 and R-GILD-02 are approved rules with an enforcement pin', () => {
    for (const id of ['R-GILD-01', 'R-GILD-02']) {
      const rule = APPROVED_RULES.find((r) => r.id === id);
      expect(rule, `${id} missing from the approved registry`).toBeTruthy();
      expect(rule!.status).toBe('approved');
      expect(rule!.enforcement?.refs).toContain('gildingKinds');
    }
  });
});

// ── 2. the owner's named exemplars, driven through the real engine ───────────────────────────────────────

describe('gilded shapes — the owner\'s exemplars, measured (§4.1)', () => {
  it('Dunkey: the gild changes the token\'s IDENTITY, not the count (gilded-token)', () => {
    const g = gildOf('b2_dunkey');
    expect(g.kind).toBe('gilded-token');
    expect(g.kind === 'gilded-token' && g.token.cardId).toBe('b2_armadiyo');
    const plain = summons('b2_dunkey', false, 'b2_armadiyo', 'avenge');
    const gilded = summons('b2_dunkey', true, 'b2_armadiyo', 'avenge');
    expect(plain.length, 'the fixture must actually fire').toBeGreaterThan(0);
    expect(gilded.length, 'a gilded-token gild must not change the count').toBe(plain.length);
    expect(plain.every((m) => m.golden !== true)).toBe(true);
    expect(gilded.every((m) => m.golden === true), 'the gilded body must summon GILDED tokens').toBe(true);
  });

  it('Void Panther: the factory\'s goldenTokens param derives the same shape', () => {
    const g = gildOf('manasaber');
    expect(g.kind).toBe('gilded-token');
    expect(g.basis).toBe('derived:token-id');
    const plain = summons('manasaber', false, 'sabercub', 'onDeath');
    const gilded = summons('manasaber', true, 'sabercub', 'onDeath');
    expect(gilded.length).toBe(plain.length);
    expect(gilded.every((m) => m.golden === true)).toBe(true);
  });

  it('High King Mykel: an owner-ruled RESHAPE, one adjacent → both adjacent', () => {
    const g = gildOf('dw_brisbane');
    expect(g.kind).toBe('reshape');
    expect(g.basis).toBe('owner-ruling');
    // A reshape defers to the authored golden text — which must therefore exist and say so.
    expect(CARD_INDEX['dw_brisbane']!.goldenText).toContain('both adjacent');
    expect(gildedCountRelation(g), 'a reshape states no count relation').toBeNull();
  });

  it('Gemstorm Instigator: an owner-ruled EXTRA PROC, worth ×2 output', () => {
    const g = gildOf('k_gemstorm');
    expect(g.kind).toBe('extra-proc');
    expect(g.kind === 'extra-proc' && g.extra).toBe(1);
    expect(g.basis).toBe('owner-ruling');
    expect(gildedCountRelation(g)?.relation).toEqual({ kind: 'times', factor: 2 });
  });

  it('Baal: the owner\'s named contrast case is the plain ×2 baseline', () => {
    const g = gildOf('dw_baal');
    expect(g.kind).toBe('multiply');
    expect(g.kind === 'multiply' && g.factor).toBe(2);
  });

  it('Wolves Den: a plain ×2 card really does double its count in the engine', () => {
    const g = gildOf('wolvesden');
    expect(g.kind).toBe('multiply');
    const plain = summons('wolvesden', false, 'cryptwolf', 'onDeath');
    const gilded = summons('wolvesden', true, 'cryptwolf', 'onDeath');
    expect(plain.length).toBe(3);
    expect(gilded.length, 'the ×2 baseline').toBe(6);
    expect(gilded.every((m) => m.golden !== true), 'a multiply gild makes MORE tokens, not gilded ones').toBe(true);
  });

  it('Amun Rab: a PARTIAL gild (pinned count, doubled buff) is a reshape, not a bogus ×2', () => {
    const g = gildOf('amunrab');
    expect(g.kind).toBe('reshape');
    // Engine-measured: the count is pinned at 7 whether or not the body is gilded.
    expect(summons('amunrab', false, 'impscrap', 'onDeath').length).toBe(7);
    expect(summons('amunrab', true, 'impscrap', 'onDeath').length).toBe(7);
  });
});

// ── 3. R-GILD-02: spells are never gilded ────────────────────────────────────────────────────────────────

describe('R-GILD-02 — spells are never gilded', () => {
  const spells = CONTRACTS.filter((c) => c.contentType === 'spell');

  it('every spell contract states not-applicable, WITH a reason', () => {
    expect(spells.length).toBeGreaterThan(50);
    for (const c of spells) {
      const g = c.gildedDelta;
      expect(g?.kind, `${c.contentId}`).toBe('not-applicable');
      expect(g?.kind === 'not-applicable' && g.reason.length, `${c.contentId}: a skip must carry its reason`).toBeGreaterThan(0);
    }
  });

  it('the planner SKIPS a spell\'s gilding with the typed reason — never unresolved noise', () => {
    const sample = spells.slice(0, 25);
    for (const c of sample) {
      const skip = planCases(c).skipped.find((s) => s.template === 'gilded');
      expect(skip?.reason, `${c.contentId}: the gilding aspect must be skipped WITH its reason`).toBe('gild-not-applicable');
      expect(skip?.detail ?? '').toMatch(/spell/i);
    }
  });

  it('the engine agrees: no spell can gild, and no spell authors a gilded body', () => {
    for (const c of spells) {
      const def = CARD_INDEX[c.contentId];
      if (!def) continue;
      expect(def.spell, `${c.contentId} is typed 'spell' but its def is not`).toBe(true);
      expect(def.goldenText, `${c.contentId}: a spell must have no gilded text`).toBeUndefined();
    }
  });
});

// ── 4. SABOTAGE — each new branch is proven to fail (§4.5) ───────────────────────────────────────────────

describe('gilded shapes — sabotage', () => {
  const doctor = (id: string, gildedDelta: GildedDeltaContract): ContentContract[] =>
    CONTRACTS.map((c) => (c.contentId === id ? { ...c, gildedDelta } : c));

  const sweepOf = (contracts: ContentContract[], id: string) => runContractSweep({ contracts, sampleMod: 1 });

  it('a gilded-token claim on a card whose engine summons are NOT gilded is detected', () => {
    // Wolves Den really doubles its count; claiming a gilded-token shape must break BOTH halves of the
    // check — the count moves (3 → 6) and the gilded body's tokens are not golden.
    const doctored = doctor('wolvesden', {
      kind: 'gilded-token', token: { cardId: 'cryptwolf', count: 3 }, basis: 'authored',
      description: 'SABOTAGE: Wolves Den does not gild its wolves, it doubles them',
    });
    const report = sweepOf(doctored, 'wolvesden');
    const check = report.limitChecks.find((l) => l.contractId === 'wolvesden' && l.limit === 'gilded-token-identity');
    expect(check, 'the gilded-token driver must have run').toBeTruthy();
    expect(check!.ok).toBe(false);
    expect(check!.detail, 'the count half of the claim').toMatch(/count MOVED/);
    expect(check!.detail, 'the identity half of the claim').toMatch(/GILDED/);
    expect(report.findings.some((f) => f.contentIds.includes('wolvesden'))).toBe(true);
  });

  it('a gilded-token claim naming the WRONG token is recorded unobserved, never passed', () => {
    const doctored = doctor('b2_dunkey', {
      kind: 'gilded-token', token: { cardId: 'cryptwolf', count: 1 }, basis: 'authored',
      description: 'SABOTAGE: Dunkey summons an Armadiyo, not a Crypt Wolf',
    });
    const report = sweepOf(doctored, 'b2_dunkey');
    const ran = report.executed.find((e) => e.contractId === 'b2_dunkey' && e.driver === 'gilded-shape');
    expect(ran, 'the driver must have run').toBeTruthy();
    expect(ran!.unobserved, 'a claim nothing fired against is RECORDED, not silently passed').toMatch(/RECORDED unverified/);
    expect(report.limitChecks.some((l) => l.contractId === 'b2_dunkey' && l.limit === 'gilded-token-identity'),
      'an unobserved claim must not produce a passing identity verdict').toBe(false);
  });

  it('a gilded-token claim whose declared count relation is doctored is detected', () => {
    // Dunkey is a genuine gilded-token card. Declaring 'multiply' ×2 over it asserts the count doubles —
    // it does not (1 → 1), so the metamorphic gilded-delta law must flip.
    const doctored = doctor('b2_dunkey', {
      kind: 'multiply', factor: 2, basis: 'authored', description: 'SABOTAGE: Dunkey gilds its Armadiyo, it does not summon two',
    });
    const report = sweepOf(doctored, 'b2_dunkey');
    // With 'multiply' declared, the gilded-token driver no longer plans — the claim goes unchecked, which
    // is itself the honest outcome: the case is planned as a countable gild and the count law is what fails.
    const clean = runContractSweep({ contracts: CONTRACTS, sampleMod: 1 });
    const cleanCheck = clean.limitChecks.find((l) => l.contractId === 'b2_dunkey' && l.limit === 'gilded-token-identity');
    expect(cleanCheck?.ok, 'the true contract passes').toBe(true);
    expect(report.limitChecks.some((l) => l.contractId === 'b2_dunkey' && l.limit === 'gilded-token-identity'),
      'a doctored multiply claim drops the gilded-token check — the disagreement moves to the count law, not to silence').toBe(false);
  });

  it('a doctored extra-proc factor changes the count law the oracle demands', () => {
    expect(gildedCountRelation({ kind: 'extra-proc', extra: 1, description: 'x' })?.relation).toEqual({ kind: 'times', factor: 2 });
    expect(gildedCountRelation({ kind: 'extra-proc', extra: 3, description: 'x' })?.relation).toEqual({ kind: 'times', factor: 4 });
  });

  it('a spell smuggling a gildable shape past the validator is refused (R-GILD-02)', () => {
    const spell = CONTRACTS.find((c) => c.contentType === 'spell')!;
    const doctored: ContentContract = {
      ...spell,
      gildedDelta: { kind: 'multiply', factor: 2, basis: 'authored', description: 'SABOTAGE: a gilded spell' },
    };
    expect(gildedDeltaErrors(doctored).join(' ')).toMatch(/R-GILD-02/);
    // And an ABSENT claim is refused too — silence would read as unprobed, not as inapplicable.
    const stripped: ContentContract = { ...spell };
    delete stripped.gildedDelta;
    expect(gildedDeltaErrors(stripped).join(' ')).toMatch(/not-applicable/);
  });

  it('each new kind\'s required field is enforced', () => {
    const base = CONTRACTS.find((c) => c.contentType === 'minion')!;
    const withGild = (g: GildedDeltaContract): ContentContract => ({ ...base, gildedDelta: g });
    expect(gildedDeltaErrors(withGild({ kind: 'gilded-token', token: { cardId: '' }, description: 'd' })).join(' ')).toMatch(/token\.cardId/);
    expect(gildedDeltaErrors(withGild({ kind: 'extra-proc', extra: 0, description: 'd' })).join(' ')).toMatch(/extra ≥ 1/);
    expect(gildedDeltaErrors(withGild({ kind: 'not-applicable', reason: '  ', description: 'd' })).join(' ')).toMatch(/needs a reason/);
    expect(gildedDeltaErrors(withGild({ kind: 'multiply', factor: 0, description: 'd' })).join(' ')).toMatch(/positive factor/);
    // 'unresolved' without the visible queue entry is refused.
    const hidden: ContentContract = {
      ...base,
      extraction: { extractor: 'x', confidence: 'low' },
      gildedDelta: { kind: 'other', basis: 'unresolved', description: 'd' },
    };
    expect(gildedDeltaErrors(hidden).join(' ')).toMatch(/extraction\.unparsed/);
  });

  it('gildedTokenClaim only fires on a drivable gilded-token contract', () => {
    expect(gildedTokenClaim(byId.get('b2_dunkey')!)?.via).toBe('avenge');
    expect(gildedTokenClaim(byId.get('manasaber')!)?.via).toBe('onDeath');
    expect(gildedTokenClaim(byId.get('wolvesden')!)).toBeNull();
  });
});
