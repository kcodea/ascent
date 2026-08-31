import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '@game/content';
import type { CardDef } from '@game/core';

/**
 * DOC BOT LANE `anotherMinionExcludesSelf` — "another" and "other" are a SEPARATION, and the engine must
 * honour it.
 *
 * ── The owner's ruling (2026-08-30) ───────────────────────────────────────────────────────────────────────
 *
 * *"'Another minion' means that that minion doesn't count, as in 2 double troubles don't trigger each other.
 * this logic should be written into the oracle. 'Other minion' or 'another minion' create that separation."*
 *
 * Two consequences, and the second is the one that bites:
 *
 *  1. **The source is excluded from its own effect.** "Give your OTHER Dragons +3/+3" must not buff the
 *     Dragon that said it.
 *  2. **Two copies do not feed each other.** Trouble reacts to a Ruby cast on another minion by
 *     casting one on itself; a second Trouble must not then see that as "a Ruby cast on another
 *     minion". Left alone, that is an infinite loop, and the codebase has already been bitten by exactly this
 *     shape twice — the comment on `applyRubyStats` records that two adjacent Resonance Idols would otherwise
 *     "ping a Ruby between each other forever", and Candle Conduit's bounce carries the same guard.
 *
 * ── Why the FACTORY is the unit, not the card ─────────────────────────────────────────────────────────────
 *
 * A card is text plus a factory reference; the separation lives in the factory. Gating cards would mean
 * re-verifying the same `rallyBuffOtherTribe` every time a card used it, and would say nothing about a NEW
 * card reaching for a factory that never excluded self. So the sweep reads the TEXT (which is where the
 * promise is made) and gates the FACTORIES it resolves to (which is where the promise is kept).
 *
 * ── The gate ──────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Every factory reachable from an "another/other" card must be declared below WITH the mechanism that
 * excludes self. A new card with that wording, or an existing one re-pointed at a different factory, fails
 * here until someone writes down how the separation is achieved — which is the point: the failure is a
 * prompt to check, not a chore to silence.
 *
 * A declaration that no longer matches any card is also a failure, so this list cannot rot into scenery.
 */

/** The wording that creates the separation. Deliberately narrow — "the other side" is not this rule. */
const SEPARATION = /\b(another|other)\b/i;

/** Text fields a promise can be printed in. Choose One branches carry their own. */
function textsOf(def: CardDef): string[] {
  const out: string[] = [];
  if (def.text) out.push(def.text);
  if (def.goldenText) out.push(def.goldenText);
  for (const b of def.chooseOne ?? []) {
    if (b.text) out.push(b.text);
    if (b.goldenText) out.push(b.goldenText);
  }
  return out;
}

/** Every factory a card can fire, across plain effects and Choose One branches. */
function factoriesOf(def: CardDef): string[] {
  const out = def.effects.map((e) => e.do);
  for (const b of def.chooseOne ?? []) for (const e of b.effects ?? []) out.push(e.do);
  return out.filter(Boolean);
}

/**
 * factory → HOW it excludes the source. Every entry is a claim someone checked; the reason is the artefact,
 * because "it's fine" is what this lane exists to stop being an acceptable answer.
 */
/**
 * How a factory keeps the separation. Two shapes:
 *
 *  · a plain string — the factory ALWAYS excludes the source, and the string says how;
 *  · `{ param }` — the factory excludes the source only when the CARD passes that param, so the lane checks
 *    the card actually does. Runekeg is why this shape exists: `onSpellCastBuffRandomTribe` buffs the caster
 *    unless `excludeSelf: true` is set, and the card printing "other Dwarves" has to opt in. A card that
 *    printed "other" and forgot would be a silent bug, which is precisely what this lane is for.
 *
 * Every entry is a claim someone checked in the source. The reason is the artefact: "it's fine" is what this
 * lane exists to stop being an acceptable answer.
 */
type Exclusion = string | { param: string; expect: boolean; why: string };
const SELF_EXCLUDING: Record<string, Exclusion> = {
  // ── Always excludes ────────────────────────────────────────────────────────────────────────────────────
  battlecryBuffTribeOthersAttack: 'arena skips `f.uid === arena.self.uid` before buffing',
  scBuffAlliesPctSelf: 'arena buffs `arena.friends()` filtered to `m.uid !== arena.self.uid`',
  onTribeAttackBuffAttacker: 'returns early on `minion === self` — the attacker must be someone else',
  avengeGiveAttack: 'the recipient walk skips `self`',
  impInheritOnDeath: 'the dying Imp is the payload; the inheritor is chosen from the others',
  impInheritOnSummon: 'the newborn is the payload; the source is not a candidate',
  onFriendDeathGainEcho: 'returns early when the dead `minion === self`',
  deathrattleSummonRandomTribe: 'fires only for its OWN death, and summons fresh bodies — never itself',
  echoResummonDeadBeasts: 'resummons from the dead; a living source cannot be among them',
  orbitDevourArriver: 'guards `minion.uid === self.uid` — "never devour yourself", in the code comment',
  orbitGainArriverBonus: 'the arriver is the payload and is compared against `self.uid`',
  onOrbitBuffShop: 'buffs SHOP OFFERS, which are a different zone from the board the source sits on',
  onOtherDemonConsumeEcho: 'the consuming Demon arrives in the payload; the shop minion consumed is the target',
  spellDevour: 'picks a partner by board index around `indexOf(self)`, so the source is never its own victim',
  rubySelfCastPerOtherRuby: 'the scan in `playRubyOn` skips `m === target`, so a Ruby landing on Double '
    + 'Trouble itself never triggers it — and its own payout goes through `applyRubyStats` (stats only, no '
    + 'watchers), so a SECOND Trouble cannot see it either. Both halves of the owner ruling',

  // ── Excludes only because the CARD asks it to ──────────────────────────────────────────────────────────
  rallyGiveAttackToOthers: 'the arena pool filters `m.uid !== arena.self.uid` — "Others" is the contract',

  // ── Excludes only because the CARD asks it to, and the two do it with OPPOSITE polarity ────────────────
  //
  // Worth stating plainly: the codebase expresses this separation THREE ways — baked into the factory,
  // opted IN with `excludeSelf: true`, and opted OUT of with `includeSelf: false`. That inconsistency is
  // exactly why a card can print "other" and quietly not mean it, and why this lane checks the value rather
  // than merely the presence of a param.
  onSpellCastBuffRandomTribe: {
    param: 'excludeSelf', expect: true,
    why: 'the arena pool drops the source only when `params.excludeSelf` is set — Runekeg prints "2 random '
      + 'other friendly Dwarves" and must pass it, or the keg fuels itself',
  },
  battlecryBuffTribe: {
    param: 'includeSelf', expect: false,
    why: 'the arena buffs the whole tribe INCLUDING the caster unless `includeSelf: false` — Cleric prints '
      + '"your other Dragons" and passes it. Note the inverted polarity against `excludeSelf` above',
  },
};

describe('Doc Bot — "another/other" is a separation the engine keeps', () => {
  /** Cards whose printed promise uses the separating wording. */
  const separating: CardDef[] = ALL_CARDS.filter((c) => textsOf(c).some((t) => SEPARATION.test(t)));

  it('finds the cards that make the promise (a sanity floor — the sweep must not silently match nothing)', () => {
    // If a refactor breaks `textsOf` or the card list, this lane would pass vacuously by matching zero cards.
    expect(separating.length, 'the shipped pool has cards using "another/other"').toBeGreaterThan(5);
  });

  it('every factory reachable from one is DECLARED with how it excludes the source', () => {
    const undeclared: string[] = [];
    for (const def of separating) {
      for (const f of factoriesOf(def)) {
        if (!(f in SELF_EXCLUDING)) undeclared.push(`${def.id} \u2192 ${f}`);
      }
    }
    expect(
      [...new Set(undeclared)],
      'a card printing "another/other" fires a factory whose self-exclusion is undeclared. Drive it, confirm '
      + 'the source is skipped, and add it to SELF_EXCLUDING with the mechanism \u2014 or fix the factory',
    ).toEqual([]);
  });

  it('a card relying on a PARAM to exclude itself actually passes it', () => {
    // The Runekeg class: the factory buffs the caster unless the card opts out. Printing "other" while
    // forgetting the param is silent \u2014 the text promises a separation the engine never makes.
    const missing: string[] = [];
    for (const def of separating) {
      const all = [...def.effects, ...(def.chooseOne ?? []).flatMap((b) => b.effects ?? [])];
      for (const e of all) {
        const rule = SELF_EXCLUDING[e.do];
        if (!rule || typeof rule === 'string') continue;
        if ((e.params ?? {})[rule.param] !== rule.expect) missing.push(`${def.id} \u2192 ${e.do} (needs ${rule.param}: ${rule.expect})`);
      }
    }
    expect(missing, 'these cards print "another/other" but never ask the factory to exclude them').toEqual([]);
  });

  it('no declaration has outlived its cards', () => {
    const live = new Set(separating.flatMap(factoriesOf));
    const stale = Object.keys(SELF_EXCLUDING).filter((f) => !live.has(f));
    expect(stale, 'these declarations match no card any more — delete them so the list stays a real inventory')
      .toEqual([]);
  });
});
