/**
 * DOC BOT — the hero-power scan, extracted from `heroPowerLane.test.ts` so the rulebook seeder and the test
 * share ONE implementation (the derivation-pair doctrine applied to ourselves: a seeder that re-implemented
 * this loop would drift from the lane it feeds).
 */
import { CARD_INDEX } from '@game/content';
import { HEROES } from '../heroes';
import { createRun } from '../state';
import { reduce } from '../reducer';
import type { BoardCard, RunState } from '../state';

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

export interface HeroScanRow { heroId: string; kind: string; active: boolean }

export function heroScan(): HeroScanRow[] {
  const body = (uid: string, cardId: string): BoardCard => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false } as BoardCard;
  };
  const eot = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.effects.some((e) => e.on === 'endOfTurn'))!;
  // A prior spell cast, so Hunch (roundedSpellbook: 'a copy of the LAST spell you cast') reads active
  // instead of no-opping on an empty spellbook (staged per the owner's 2026-08-26 triage session).
  const spell = Object.values(CARD_INDEX).find((c) => c && c.spell && !c.token)!;
  return HEROES.map((hero) => {
    const s0: RunState = {
      ...createRun(0x4e60, hero.id),
      wave: 6, tier: 3, embers: 40,
      // A Shout body and an End-of-Turn body so replay-powers (Myra, Djinn) have something to replay.
      board: [body('b0', 'pup'), body('b1', 'emissary'), body('b2', eot.id)],
      hand: [],
      shop: [{ uid: 'off0', cardId: 'pup' }],
      lastSpellCastId: spell.id, spellsThisTurn: 1,
    } as RunState;
    const attempts: Parameters<typeof reduce>[1][] = [
      { type: 'heroPower' },
      { type: 'heroPower', uid: 'b1' },
      { type: 'heroPower', uid: 'b0' },
      { type: 'heroPower', uid: 'off0' },
    ];
    for (const a of attempts) {
      const s1 = reduce(s0, a);
      if (s1 !== s0 && strip(s1) !== strip(s0)) return { heroId: hero.id, kind: hero.power.kind, active: true };
    }
    return { heroId: hero.id, kind: hero.power.kind, active: false };
  });
}
