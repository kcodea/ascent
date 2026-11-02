import type { CardDef, EffectDef, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { chooseOneBranchText, effectiveTargetTribe, playedThisTurnFor, taughtAimSpell, type RunState } from '@game/sim';

/**
 * THE TARGETING PROMPT (owner ask 2026-11-01): the pill over the board while you aim a Shout, a Choose One branch or
 * a two-step spell says WHAT the pick will do, with the number it will actually land right now:
 * "Select a Dwarf to grant +18 Health", "Select a minion to grant +5 Health". It replaced
 * "Choose a minion for <Card>'s Shout", which named the card but never the effect.
 *
 * Built from the effect DATA, never per card: the target noun comes from the card's target filter (target / tribe /
 * Roomworks' End of Turn rule) and the verb phrase from a table keyed by effect factory id (`TARGET_VERBS`). A
 * factory the table does not cover, or one whose live value it cannot state, falls back to
 * "Select a <noun> for <Card>'s Shout" (or "for <Card>" on a spell) — the honest old form.
 *
 * LIVE NUMBERS (CLAUDE.md hard rule): a minion Shout's grant is computed the way its factory pays it (golden x2,
 * Humphry's per-Dragon steps, Baby Gastrid's Gold spent, Rune of Full Measure). A SPELL's grant (a Choose One spell
 * branch, a Mage-Pup's taught spell) reads the live value the card is already printing — the `{{…}}` token the
 * `spellDisplayText` / `chooseOneBranchText` chains inject, which folds spell power and every spell scaler — and
 * falls back to its params when nothing is boosted. One source of truth with the card text, so the pill and the card
 * can never print two different numbers.
 */

export type PromptTone = 'atk' | 'hp' | 'kw' | 'num';
export interface PromptSeg { t: string; tone?: PromptTone }

/** The prompt as one plain string (tests, aria-label). */
export const promptPlain = (segs: readonly PromptSeg[]): string => segs.map((s) => s.t).join('');

const TRIBE_NAME: Record<string, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', kobold: 'Kobold', dwarf: 'Dwarf',
  celestial: 'Celestial', spirit: 'Spirit', neutral: 'Neutral',
};
/** Player-facing keyword names (the renamed terms, as the cards print them). */
const KEYWORD_NAME: Record<string, string> = {
  T: 'Taunt', DS: 'Ward', RW: 'Resilient Ward', V: 'Execute', W: 'Flurry', R: 'Rise', RB: 'Rebirth', C: 'Cleave',
  ST: 'Stealth', IMM: 'Immune', CR: 'Critical Strike', RL: 'Rally', SL: 'Slaughter',
};
const tribeName = (t: string): string => TRIBE_NAME[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
const article = (noun: string): string => (/^[aeiou]/i.test(noun) ? 'an' : 'a');

/** Everything a verb needs to state its live value. */
export interface VerbCtx {
  /** The effect's params. */
  p: Record<string, unknown>;
  /** The resolving body is golden (minion Shouts double). Spells are never golden. */
  golden: boolean;
  /** The source is a spell cast (a Choose One spell branch, Common Ground, a Mage-Pup's taught spell). */
  spell: boolean;
  /** The live text the card / branch is printing right now (spell power and scalers already folded in). */
  shown: string;
  goldSpent: number;
  runeFullMeasure: boolean;
  /** Cards of a tribe played this turn (Humphry's steps). */
  played: (tribe: Tribe) => number;
  shopTier: number;
}

/** One verb clause: "grant" + "+4 Health". Consecutive clauses with the same verb merge ("grant Rise and +1/+1"). */
interface Clause { verb: string; obj: PromptSeg[] }
type Verb = (c: VerbCtx) => Clause | null;

const n = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The stat object of a grant: "+3/+2" (Attack / Health coloured), "+4 Attack", "+4 Health". Empty for +0/+0. */
export function statSegs(a: number, h: number): PromptSeg[] {
  if (a > 0 && h > 0) return [{ t: `+${a}`, tone: 'atk' }, { t: '/' }, { t: `+${h}`, tone: 'hp' }];
  if (a > 0) return [{ t: `+${a} Attack`, tone: 'atk' }];
  if (h > 0) return [{ t: `+${h} Health`, tone: 'hp' }];
  return [];
}

/** A stat token inside one `{{…}}` live marker: "+5/+6", "(+6/+6)", "+18 Health", "+5 Attack". */
function parseStat(s: string): { a: number; h: number } | null {
  let m = /\+(\d+)\s*\/\s*\+(\d+)/.exec(s);
  if (m) return { a: Number(m[1]), h: Number(m[2]) };
  m = /\+(\d+)\s+Attack/.exec(s);
  if (m) return { a: Number(m[1]), h: 0 };
  m = /\+(\d+)\s+Health/.exec(s);
  if (m) return { a: 0, h: Number(m[1]) };
  return null;
}

/** The LAST live stat token the card is printing (`{{…}}` — a computed, final value), or null when nothing is boosted. */
export function liveStatToken(shown: string): { a: number; h: number } | null {
  let found: { a: number; h: number } | null = null;
  for (const m of shown.matchAll(/\{\{(.*?)\}\}/g)) {
    const s = parseStat(m[1] ?? '');
    if (s) found = s;
  }
  return found;
}

/** A spell grant's live magnitude: the printed live token when the card shows one, else its params. */
function spellStat(c: VerbCtx, a0: number, h0: number): { a: number; h: number } {
  return liveStatToken(c.shown) ?? { a: a0, h: h0 };
}

const grantStat = (a: number, h: number): Clause | null => {
  const obj = statSegs(a, h);
  return obj.length ? { verb: 'grant', obj } : null;
};
const kwSeg = (k: string): PromptSeg => ({ t: KEYWORD_NAME[k] ?? k, tone: 'kw' });
const kwList = (ks: string[]): PromptSeg[] => ks.flatMap((k, i) => (i === 0 ? [kwSeg(k)] : [{ t: ' and ' }, kwSeg(k)]));
const words = (verb: string, ...obj: PromptSeg[]): Clause => ({ verb, obj });
const twice = (c: VerbCtx): PromptSeg[] => (c.golden ? [{ t: ' twice' }] : []);

/** A spell stat grant (spell power and scalers ride the live token), with an optional keyword (Bulwark's Taunt). */
const spellGrant: Verb = (c) => {
  const s = spellStat(c, n(c.p.attack), n(c.p.health));
  const cl = grantStat(s.a, s.h);
  const kw = typeof c.p.keyword === 'string' ? c.p.keyword : undefined;
  if (cl && kw) cl.obj.push({ t: ' and ' }, kwSeg(kw));
  return cl ?? (kw ? words('grant', kwSeg(kw)) : null);
};

/** A spell grant whose magnitude exists ONLY as live text (no flat params): stated when the card prints it. */
const liveOnlySpellGrant: Verb = (c) => {
  const s = liveStatToken(c.shown);
  return s ? grantStat(s.a, s.h) : null;
};

/**
 * Verb phrases by effect factory id. A missing id (or a verb returning null) is the fallback form. Keep each phrase
 * short and plain (owner writing style: no em dashes, short sentences): it is the tail of "Select a <noun> to …".
 */
export const TARGET_VERBS: Partial<Record<string, Verb>> = {
  // ── Minion Shouts (golden doubles; computed exactly as the factory pays) ─────────────────────────────────────
  battlecryBuffTarget: (c) => {
    const g = c.golden ? 2 : 1;
    // Humphry (R-HUMPHRY-01): the baseline plus one step per OTHER Dragon played. The aimed play has already
    // recorded itself in the tally, so it is not an "other" (the arena factory's `- 1` for a real target).
    const tribe = typeof c.p.perPlayedTribe === 'string' ? (c.p.perPlayedTribe as Tribe) : undefined;
    const per = tribe ? 1 + Math.max(0, c.played(tribe) - 1) : 1;
    return grantStat(n(c.p.attack) * g * per, n(c.p.health) * g * per);
  },
  battlecryBuffTargetPerGoldSpent: (c) => {
    const h = n(c.p.health, 1) * (c.golden ? 2 : 1) * Math.max(0, c.goldSpent);
    const a = c.runeFullMeasure ? h : 0; // Rune of Full Measure pays the same number as Attack too
    return grantStat(a, h) ?? words('grant', { t: '+0 Health', tone: 'hp' });
  },
  battlecryGrantKeyword: (c) => {
    const ks = Array.isArray(c.p.keywords) ? (c.p.keywords as string[]) : typeof c.p.keyword === 'string' ? [c.p.keyword] : [];
    return ks.length ? words('grant', ...kwList(ks)) : null;
  },
  battlecryGildTarget: () => words('make', { t: 'Golden', tone: 'kw' }),
  battlecryDestroyForSpell: (c) => words('destroy', { t: c.golden ? ' for 2 spells' : ' for a spell' }),
  battlecryDestroyForDiscover: (c) => words('destroy', { t: ' and Discover' }, ...(c.golden ? [{ t: ' twice' }] : [])),
  battlecryCopyEcho: () => words('copy', { t: 'its ' }, { t: 'Echo', tone: 'kw' }),
  battlecryReplayTargetEndOfTurn: (c) => words('trigger', { t: 'it' }, ...twice(c)), // the noun already says "with End of Turn"
  battlecryTargetConsumesShop: (c) => {
    const k = n(c.p.count, 1) * (c.golden ? 2 : 1);
    return words('Consume', { t: ' ' }, { t: String(k), tone: 'num' }, { t: k === 1 ? ' Shop minion' : ' Shop minions' });
  },

  // ── Spells (spell power + scalers read off the card's live text) ─────────────────────────────────────────────
  spellBuffTarget: spellGrant,
  whisperBuffTarget: spellGrant,
  spellBuffPerDragonPlayed: spellGrant,
  spellBuffTargetPerSpellsCast: spellGrant,
  spellBuffTargetPerGold: liveOnlySpellGrant,
  spellBuffTargetEscalating: liveOnlySpellGrant,
  spellBuffByTier: liveOnlySpellGrant,
  clueBuffTarget: liveOnlySpellGrant,
  spellBuffTargetAndNeighbours: (c) => {
    const cl = spellGrant(c);
    if (cl) cl.obj.push({ t: ' to it and its neighbors' });
    return cl;
  },
  spellBuffTargetAndRandomFriendly: (c) => {
    const cl = spellGrant(c);
    if (cl) cl.obj.push({ t: ' to it and a random friend' });
    return cl;
  },
  spellGrantKeywordNextCombat: (c) => typeof c.p.keyword === 'string' ? words('grant', kwSeg(c.p.keyword), { t: ' for next combat' }) : null,
  whisperGrantKeyword: (c) => typeof c.p.keyword === 'string' ? words('grant', kwSeg(c.p.keyword)) : null,
  spellGildTarget: () => words('make', { t: 'Golden', tone: 'kw' }),
  spellCopyTargetExact: () => words('copy', { t: 'it' }),
  spellDestroyTargetGetSpell: (c) => {
    const k = n(c.p.count, 1);
    return words('destroy', { t: k === 1 ? ' for a spell' : ` for ${k} spells` });
  },
  spellSwapStats: () => words('swap', { t: 'its ' }, { t: 'Attack', tone: 'atk' }, { t: ' and ' }, { t: 'Health', tone: 'hp' }),
  spellSetStats: (c) => {
    const top = c.shopTier >= n(c.p.atTier, 99);
    const a = top ? n(c.p.tierAttack) : n(c.p.attack);
    const h = top ? n(c.p.tierHealth) : n(c.p.health);
    return words('set', { t: 'its stats to ' }, { t: String(a), tone: 'atk' }, { t: '/' }, { t: String(h), tone: 'hp' });
  },
  spellReturnToHand: () => words('return', { t: 'to your hand' }),
  spellReplayBattlecry: () => words('trigger', { t: 'its ' }, { t: 'Shout', tone: 'kw' }),
  whisperReplayShout: () => words('trigger', { t: 'its ' }, { t: 'Shout', tone: 'kw' }),
  spellTriggerEcho: () => words('trigger', { t: 'its ' }, { t: 'Echo', tone: 'kw' }),
  spellTransformTierUp: () => words('transform', { t: 'one tier up' }),
  spellTargetConsumesShop: (c) => {
    const k = n(c.p.times, 1);
    return words('Consume', { t: ' ' }, { t: String(k), tone: 'num' }, { t: k === 1 ? ' Shop minion' : ' Shop minions' });
  },
  spellAverageStats: () => words('average', { t: 'stats with the first' }),
};

/** Join clauses: same verb merges ("grant Rise and +1/+1"), a new verb starts its own ("destroy and …"). */
function joinClauses(cls: Clause[]): PromptSeg[] {
  const out: PromptSeg[] = [];
  let last: string | undefined;
  for (const cl of cls) {
    if (cl.verb === last) out.push({ t: ' and ' });
    else {
      if (out.length) out.push({ t: ' and ' });
      out.push({ t: cl.verb });
      // A verb whose object does not begin with its own spacing (" for a spell", " 2 Shop minions") gets one.
      if (!cl.obj[0]?.t.startsWith(' ')) out.push({ t: ' ' });
    }
    out.push(...cl.obj);
    last = cl.verb;
  }
  return out;
}

/** What the target filter allows, as a noun: "Dwarf", "friendly minion", "minion", "minion with End of Turn". */
export function targetNoun(opts: { target?: 'friendly' | 'any'; tribe?: Tribe; endOfTurn?: boolean; noGolden?: boolean; second?: boolean }): string {
  const base = opts.tribe ? tribeName(opts.tribe) : opts.target === 'any' ? 'minion' : 'friendly minion';
  const lead = opts.second ? `second ${base}` : opts.noGolden ? `non-Golden ${base}` : base;
  return opts.endOfTurn ? `${lead} with End of Turn` : lead;
}

export interface PromptSource {
  /** The card whose name the fallback names (the played minion / the spell). */
  name: string;
  /** The effects the pick resolves (a Choose One branch, the Shout's onPlay effects, a spell's cast effects). */
  effects: readonly EffectDef[];
  noun: string;
  /** Fallback wording: "'s Shout" for a minion, "" for a spell. */
  fallbackSuffix: string;
}

/** The pure phrase builder: "Select a <noun> to <verb phrase>", or the fallback when any effect can't be phrased. */
export function buildTargetPrompt(src: PromptSource, ctx: Omit<VerbCtx, 'p'>): PromptSeg[] {
  const clauses: Clause[] = [];
  let ok = src.effects.length > 0;
  for (const e of src.effects) {
    const verb = TARGET_VERBS[e.do];
    const cl = verb?.({ ...ctx, p: (e.params ?? {}) as Record<string, unknown> });
    if (!cl) { ok = false; break; }
    clauses.push(cl);
  }
  const lead = `Select ${article(src.noun)} ${src.noun}`;
  if (!ok) return [{ t: `${lead} for ${src.name}${src.fallbackSuffix}` }];
  return [{ t: `${lead} to ` }, ...joinClauses(clauses)];
}

/** The fallback's possessive, typographic apostrophe as the old prompt printed it (`&rsquo;`). */
export const SHOUT_SUFFIX = '’s Shout';

/** The effects a pick resolves: a minion's Shout (`onPlay`) or a spell's `cast` effects. */
const aimedEffects = (def: CardDef): EffectDef[] => def.effects.filter((e) => e.on === (def.spell ? 'cast' : 'onPlay'));

/**
 * The prompt for the run's pending aim (`run.pendingTarget`): a played Shout minion on the board, a Choose One branch
 * still in hand (deferred play), Common Ground's second pick, or a Mage-Pup's taught spell. `shownText` is the pending
 * card's live text as its view prints it (board / hand view), so spell power and scalers match the card exactly.
 * `spellBonus` / `spellBonusH` are the live spell power the Choose One window reads.
 */
export function targetPromptFor(
  run: RunState,
  shownText: string | undefined,
  spellBonus: number,
  spellBonusH: number,
): PromptSeg[] | null {
  const pt = run.pendingTarget;
  if (!pt) return null;
  const def = CARD_INDEX[pt.cardId];
  if (!def) return null;
  const body = run.board.find((c) => c.uid === pt.uid) ?? run.hand.find((c) => c.uid === pt.uid);
  const golden = !!body?.golden;
  const base = {
    goldSpent: run.goldSpentThisTurn ?? 0,
    runeFullMeasure: !!run.runeFullMeasure,
    played: (t: Tribe) => playedThisTurnFor(run, t),
    shopTier: run.tier,
  };
  const option = pt.optionIndex !== undefined ? def.chooseOne?.[pt.optionIndex] : undefined;
  if (option) {
    // A Choose One branch: phrase the CHOSEN option, its live text from the same helper the Choose One window paints.
    const shown = chooseOneBranchText(def.id, pt.optionIndex!, golden, spellBonus, spellBonusH);
    const target = option.target ?? def.target;
    const noun = targetNoun({ target, tribe: effectiveTargetTribe(run, def) });
    return buildTargetPrompt(
      { name: def.name, effects: option.effects, noun, fallbackSuffix: def.spell ? '' : SHOUT_SUFFIX },
      { ...base, golden: def.spell ? false : golden, spell: !!def.spell, shown },
    );
  }
  // A Mage-Pup taught an aimed spell: the TAUGHT spell resolves, so phrase its cast effects.
  const taught = body && !def.spell ? taughtAimSpell(body) : undefined;
  const src = taught ?? def;
  const second = !!pt.spell && !!pt.spellFirstUid; // Common Ground's second pick
  const noun = targetNoun({
    target: taught ? 'friendly' : src.target, // a taught spell aims at your board only (`taughtAimSpell`)
    tribe: effectiveTargetTribe(run, src) ?? destroyTribe(src),
    endOfTurn: !!src.targetHasEndOfTurn,
    second,
  });
  return buildTargetPrompt(
    { name: def.name, effects: aimedEffects(src), noun, fallbackSuffix: def.spell ? '' : SHOUT_SUFFIX },
    { ...base, golden: def.spell ? false : golden, spell: !!src.spell, shown: shownText ?? '' },
  );
}

/** Cage Breaker names its tribe on the effect, not the card's `targetTribe`: the pick must be that tribe to resolve. */
function destroyTribe(def: CardDef): Tribe | undefined {
  const e = def.effects.find((x) => x.do === 'battlecryDestroyForDiscover');
  const t = (e?.params as { tribe?: unknown } | undefined)?.tribe;
  return typeof t === 'string' ? (t as Tribe) : undefined;
}
