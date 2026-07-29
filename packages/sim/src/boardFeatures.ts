import { CARD_INDEX } from '@game/content';
import type { BoardMinion, Keyword, Tribe } from '@game/core';

/**
 * BOARD FEATURES — the input to the learned strength model.
 *
 * Measured motivation: raw `power` (Σ attack + health) correlates 0.88–0.94 with true strength on synthetic
 * boards at EVERY wave, but on real player boards it collapses late — 0.75 at waves 7–9, 0.37 at 10–12, 0.44 at
 * 13–15. Stats explain synthetic boards almost completely and human boards barely a third. The difference is
 * synergy, and these features exist to give a model something to find it in.
 *
 * So the features that matter are the ones stats can't express: how CONCENTRATED the board is in one tribe,
 * whether the keywords are stacked on the bodies that want them, how many combat triggers are present, and how
 * lopsided the stat distribution is. None of them are weighted by hand — that's the model's job, and hand
 * weighting is precisely what kept failing.
 */

/** Keywords worth counting individually. The rest fold into `otherKeywords`. */
const TRACKED: Keyword[] = ['T', 'DS', 'V', 'W', 'R', 'C', 'M', 'SC', 'CN', 'FD', 'IMM', 'ST', 'RL', 'SL', 'CR', 'EG'];
const TRIBES: Tribe[] = ['beast', 'undead', 'mech', 'dragon', 'demon', 'kobold'];

/** Combat-relevant trigger families — a proxy for "this board DOES something", which stats cannot see. */
const COMBAT_TRIGGERS = ['startOfCombat', 'onDeath', 'onKill', 'onAttack', 'onDamaged', 'onLoseDivineShield', 'avenge', 'onSummon'];

export const FEATURE_NAMES = [
  'count', 'attack', 'health', 'power', 'maxAttack', 'maxHealth', 'meanAttack', 'meanHealth',
  'attackSpread', 'healthSpread', 'atkHpRatio', 'golden', 'meanTier', 'maxTier',
  ...TRACKED.map((k) => `kw_${k}`),
  'keywordDensity', 'tauntedFrontHalf', 'shieldedTop',
  ...TRIBES.map((t) => `tribe_${t}`),
  'tribeConcentration', 'distinctTribes',
  ...COMBAT_TRIGGERS.map((t) => `trig_${t}`),
  'triggerDensity', 'effectCount', 'wave',
] as const;

export type FeatureVector = number[];

const sd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/** Extract the feature vector for a board. Pure and deterministic — same board, same numbers, always. */
export function boardFeatures(minions: readonly BoardMinion[], wave: number): FeatureVector {
  const n = minions.length;
  if (n === 0) return new Array<number>(FEATURE_NAMES.length).fill(0);

  const atk = minions.map((m) => m.attack);
  const hp = minions.map((m) => m.health);
  const defs = minions.map((m) => CARD_INDEX[m.cardId]);
  const totalAtk = atk.reduce((a, b) => a + b, 0);
  const totalHp = hp.reduce((a, b) => a + b, 0);
  const kwOf = (m: BoardMinion): readonly string[] => m.keywords ?? [];

  const tribeCounts = TRIBES.map((t) => defs.filter((d) => d && (d.tribe === t || d.tribe2 === t || d.universalTribe)).length);
  const maxTribe = Math.max(0, ...tribeCounts);
  const tiers = defs.map((d) => d?.tier ?? 1);
  const effects = defs.map((d) => d?.effects ?? []);
  const totalEffects = effects.reduce((a, e) => a + e.length, 0);
  const totalKeywords = minions.reduce((a, m) => a + kwOf(m).length, 0);

  // POSITIONAL features. Board order is real information the engine acts on — a Taunt at the back and a Taunt
  // at the front are different boards with identical stats, and nothing in `power` can tell them apart.
  const frontHalf = minions.slice(0, Math.max(1, Math.ceil(n / 2)));
  const trig = (name: string): number => effects.reduce((a, es) => a + es.filter((e) => e.on === name).length, 0);

  return [
    n, totalAtk, totalHp, totalAtk + totalHp,
    Math.max(...atk), Math.max(...hp), totalAtk / n, totalHp / n,
    sd(atk), sd(hp), totalAtk / Math.max(1, totalHp),
    minions.filter((m) => m.golden).length,
    tiers.reduce((a, b) => a + b, 0) / n, Math.max(...tiers),
    ...TRACKED.map((k) => minions.filter((m) => kwOf(m).includes(k)).length),
    totalKeywords / n,
    frontHalf.filter((m) => kwOf(m).includes('T')).length,
    minions.slice(0, 2).filter((m) => kwOf(m).includes('DS')).length,
    ...tribeCounts,
    maxTribe / n, tribeCounts.filter((c) => c > 0).length,
    ...COMBAT_TRIGGERS.map(trig),
    totalEffects / n, totalEffects, wave,
  ];
}
