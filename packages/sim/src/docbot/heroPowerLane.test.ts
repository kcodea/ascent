/**
 * DOC BOT TRIPWIRE 15 — every hero's power DOES something when fired (roadmap L5).
 *
 * The blueprint's §13 in differential form: 59 heroes through the real `{type:'heroPower'}` action under a
 * rich fixture. A power that changes nothing beyond the receipt (charge spent, Gold paid) is either
 * PASSIVE/SCHEDULED (fine — named in the queue by its `kind`, staged separately as the lane grows) or the
 * adopted-power-routing class of silent no-op (§13.5) — the queue makes the difference visible instead of
 * assumed. Untargeted first; a refusal retries targeted at a board minion, then at a shop offer.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { HEROES, createRun, reduce, type BoardCard, type RunState } from '../index';

const RECEIPT = new Set(['heroPowerSpent', 'heroUsesThisTurn', 'embers', 'goldSpent', 'goldSpentThisTurn', 'rngCursor', 'uidCounter', 'log', 'fx', 'beats', 'presentation']);

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
};

const strip = (s: RunState): string => {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!RECEIPT.has(k) && v !== undefined) o[k] = v;
  return stable(o);
};

describe('Doc Bot — hero power lane', () => {
  const body = (uid: string, cardId: string): BoardCard => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false } as BoardCard;
  };

  const results = HEROES.map((hero) => {
    const s0: RunState = {
      ...createRun(0x4e60, hero.id),
      wave: 6, tier: 3, embers: 40,
      // A Shout body and an End-of-Turn body on the board, so replay-powers (Myra, Djinn) have something
      // to replay; pup stays as a plain target.
      board: [body('b0', 'pup'), body('b1', 'emissary'), body('b2', Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.effects.some((e) => e.on === 'endOfTurn'))!.id)],
      hand: [],
      shop: [{ uid: 'off0', cardId: 'pup' }],
    } as RunState;
    const attempts: Parameters<typeof reduce>[1][] = [
      { type: 'heroPower' },
      { type: 'heroPower', uid: 'b1' },
      { type: 'heroPower', uid: 'b0' },
      { type: 'heroPower', uid: 'off0' },
    ];
    for (const a of attempts) {
      const s1 = reduce(s0, a);
      if (s1 !== s0 && strip(s1) !== strip(s0)) return { hero, active: true };
    }
    return { hero, active: false };
  });

  it('a majority of hero powers verify ACTIVE through the real action (floor 30)', () => {
    expect(results.filter((r) => r.active).length).toBeGreaterThanOrEqual(30);
  });

  it('the silent-power queue is pinned, each entry named by its power kind', () => {
    const silent = results.filter((r) => !r.active).map((r) => `${r.hero.id} [${r.hero.power.kind}]`);
    // 2026-08-26 baseline: the passive / scheduled / condition-gated kinds the generic fixture cannot fire.
    // A NEW hero landing here must be verified passive (kind named in review) or is a silent no-op power.
    const PIN = 25; // Myra + Djinn drained by the Shout/EoT fixture bodies
    expect(silent.length, `${silent.length} hero power(s) changed nothing under the fixture (pin ${PIN}):\n  ${silent.join('\n  ')}\nAbove the pin: a new hero's power never acted — passive/scheduled kinds get staged or noted in review; an ACTIVE kind here is the §13.5 silent-routing class.`).toBeLessThanOrEqual(PIN);
    expect(silent.length, `only ${silent.length} silent now (pin ${PIN}) — you staged some; lower the pin.`).toBeGreaterThanOrEqual(PIN);
  });
});
