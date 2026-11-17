/**
 * Test kit for R-FX-ANCIENT-TENDRIL-01 (owner 2026-11-16: "When ancients buff things like that, they should have a
 * tendril animation. Make sure this is wired."). Drives the REAL reducer / simulator for one hero × Ancient pairing and
 * reports, for every stat grant that pairing made, which presentation the UI will choose for it:
 *
 *  · SHOP (any action): an Ancient grant is the board card's `buffs` ledger growing under an Ancient's name. It plays the
 *    hero-power tendril when this action's `recruitBuffFx` carries a `fromHeroPower` record for that minion (the Shop's
 *    per-action wave, `Recruit.tsx`), or a hero-sourced Start-of-Turn beat lands a gain on it (`sotBeats.ts`).
 *  · END OF TURN: the authoritative batch (`prepareActionWithPresentation`), each `statsChanged` handed to the real
 *    presenter (`presentConsequence`): the tendril is `heroPowerGain`.
 *  · COMBAT: a `buff` event the fight's Ancient made (an Ancient's name, or a label its combat mods carry). It plays the
 *    hero-power tendril when `heroPowerBuffLabelFor` resolves it, the branch `useCombatReplay.fireBuffCasts` takes for a
 *    bodiless source; an authored label def (`labelBuffFxFor`, Gorun's Blade Mastery) outranks it and is kept.
 */
import { vi } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent, ConsequenceEvent } from '@game/core';
import {
  ANCIENT_IDS, ancientBuffLabels, ancientCombatMods, createRun, enableAncients, prepareActionWithPresentation, reduce,
  type Action, type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from '@game/sim';
import { heroPowerBuffLabelFor, labelBuffFxFor } from './choreo/bindings';
import { presentConsequence, type PresenterContext } from './choreographer/consequencePresenters';
import type { CompiledBeat } from './choreographer/timelineTypes';

export const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};

/** A run of `hero` with Ancients on and `id` picked through the real `pickAncient` action. */
export function pickedRun(hero: string, id: AncientId, over: Partial<RunState> = {}, seed = 7): RunState {
  let s = enableAncients({ ...createRun(seed, hero), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  if (s.ancients?.picked !== id) throw new Error(`${hero} × ${id}: the pick did not land`);
  return s;
}

/** Fight one sandbag-ish board (`n` × attack/health) through `faceOmen`, as the per-hero Ancient tests do. */
export function foes(wave: number, attack: number, health: number, n = 1, extra: Partial<BoardSnapshot['minions'][number]> = {}): BoardSnapshot {
  return {
    v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
    minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [], ...extra })), seed: 1, origin: 'self',
  } as BoardSnapshot;
}

const ledger = (c: BoardCard | undefined): { a: number; h: number } => {
  const out = { a: 0, h: 0 };
  for (const b of c?.buffs ?? []) if (ancientBuffLabels().has(b.source)) { out.a += b.attack; out.h += b.health; }
  return out;
};

export interface ShopVerdict { grants: string[]; tendril: string[]; missing: string[] }

/** One Shop action: the Ancient grants it made to board minions and whether each streams from the power button. */
export function shopStep(prev: RunState, action: Action): { next: RunState; verdict: ShopVerdict } {
  const before = new Map([...prev.board, ...prev.hand].map((c) => [c.uid, ledger(c)]));
  const next = reduce(prev, action);
  const verdict: ShopVerdict = { grants: [], tendril: [], missing: [] };
  for (const c of next.board) {
    const was = before.get(c.uid) ?? { a: 0, h: 0 };
    const now = ledger(c);
    if (now.a <= was.a && now.h <= was.h) continue;
    verdict.grants.push(c.uid);
    const hp = next.recruitBuffFx.some((r) => r.fromHeroPower && r.targetUid === c.uid)
      || (next.sotBeatFx ?? []).some((b) => b.source.kind === 'hero' && b.gains.some((g) => g.uid === c.uid));
    (hp ? verdict.tendril : verdict.missing).push(c.uid);
  }
  return { next, verdict };
}

/** Run several Shop actions; the verdicts merged (a uid per grant per action). */
export function shopRun(s: RunState, actions: readonly (Action | ((s: RunState) => Action))[]): { s: RunState; verdict: ShopVerdict } {
  const verdict: ShopVerdict = { grants: [], tendril: [], missing: [] };
  for (const a of actions) {
    const r = shopStep(s, typeof a === 'function' ? a(s) : a);
    s = r.next;
    verdict.grants.push(...r.verdict.grants);
    verdict.tendril.push(...r.verdict.tendril);
    verdict.missing.push(...r.verdict.missing);
  }
  return { s, verdict };
}

const spyCtx = () => ({
  statGain: vi.fn(), heroPowerGain: vi.fn(), selfBuff: vi.fn(), rubyLanded: vi.fn(), spellPower: vi.fn(), impAura: vi.fn(), rubyAura: vi.fn(),
  cardGranted: vi.fn(), cardSummoned: vi.fn(), cardDestroyed: vi.fn(), shopBuffed: vi.fn(),
  resourceChanged: vi.fn(), counterChanged: vi.fn(), cardTransformed: vi.fn(), keywordChanged: vi.fn(),
  questTendril: vi.fn(), tavernGust: vi.fn(), weldPulse: vi.fn(), fodderEaten: vi.fn(), echoFired: vi.fn(), spellCast: vi.fn(),
}) satisfies PresenterContext;

/** END OF TURN through the authoritative batch: every board `statsChanged` under a HERO beat (an Ancient's End-of-Turn
 *  entry) and how the real presenter drew it. `tendril` = `heroPowerGain` calls. */
export function endOfTurnVerdict(state: RunState): { heroGains: number; tendril: number; minionRibbons: number } {
  const prepared = prepareActionWithPresentation(state, { type: 'faceOmen' });
  const events = prepared.batch?.events ?? [];
  const triggers = new Map(events.filter((e) => e.type === 'sourceTrigger').map((t) => [t.id, t]));
  const ctx = spyCtx();
  let heroGains = 0;
  let i = 0;
  for (const e of events) {
    if (e.type !== 'statsChanged' || (e as { target: { zone: string } }).target.zone !== 'board') continue;
    const trig = triggers.get((e as { parentId?: string }).parentId ?? '');
    if (!trig) continue;
    if (trig.source.kind === 'hero') heroGains++;
    const beat = { id: trig.id, source: trig.source, policyKey: (trig as { policyKey?: string }).policyKey } as CompiledBeat;
    presentConsequence({ consequence: e as ConsequenceEvent, beat, ctx, index: i++ });
  }
  return { heroGains, tendril: ctx.heroPowerGain.mock.calls.length, minionRibbons: ctx.statGain.mock.calls.filter((c) => c[4]).length };
}

export interface CombatVerdict { grants: number; tendril: number; authored: string[]; missing: string[]; keywords: string[] }

/** Every string a combat-mods object carries under a `label` key (the Ancient's attribution for its grants). */
function modLabels(v: unknown, key = '', out = new Set<string>()): Set<string> {
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) modLabels(x, k, out);
  else if (typeof v === 'string' && /label/i.test(key)) out.add(v);
  return out;
}

/** COMBAT through the real `faceOmen` (the run's own side state, Ancient mods included). Each friendly `buff` the
 *  Ancient made, routed the way `fireBuffCasts` routes a bodiless source. */
export function combatVerdict(state: RunState, foe: BoardSnapshot = foes(state.wave, 1, 200), extraLabels: readonly string[] = []): { s: RunState; verdict: CombatVerdict } {
  const labels = new Set([...ancientBuffLabels(), ...modLabels(ancientCombatMods(state)), ...extraLabels]);
  const s = reduce({ ...state, servedBoards: { ...state.servedBoards, [state.wave]: foe } }, { type: 'faceOmen' });
  const events = (s.lastCombat?.events ?? []) as CombatEvent[];
  const units = new Set<string>();
  for (const m of [...(s.lastCombat?.initial.player ?? []), ...(s.lastCombat?.initial.enemy ?? [])]) units.add(m.uid);
  for (const e of events) if (e.type === 'summon') units.add((e as { minion?: { uid: string } }).minion?.uid ?? '');
  const verdict: CombatVerdict = { grants: 0, tendril: 0, authored: [], missing: [], keywords: [] };
  for (const e of events) {
    if (e.type === 'keyword' && e.source && labels.has(e.source)) verdict.keywords.push(`${e.keyword}:${e.source}`);
    if (e.type !== 'buff' || units.has(e.source) || !labels.has(e.source)) continue;
    if (e.attack <= 0 && e.health <= 0) continue;
    verdict.grants++;
    if (labelBuffFxFor(e.source)) verdict.authored.push(e.source);
    else if (heroPowerBuffLabelFor(e.source)) verdict.tendril++;
    else verdict.missing.push(e.source);
  }
  return { s, verdict };
}
