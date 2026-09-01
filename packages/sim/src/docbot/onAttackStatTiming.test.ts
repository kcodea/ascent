import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';

/**
 * DOC BOT LANE `onAttackStatTiming` — every stat a SWING grants must be deliverable during that swing.
 *
 * ── Where this comes from (owner asks 2026-09-01, four separate reports) ───────────────────────────────────
 *
 *   *"we need all of the animations and stats to reconcile while the flamebeat is paused in his pre-attack
 *   animation, like echohorn does"* → *"boulderdash/maybe rubies are not updating the values until after the
 *   lunge"* → *"gorun's buff doesn't get added at the right time, it's at resolution"* → *"take a pass and
 *   update the oracle to make sure we find any effects that would trigger on attacks."*
 *
 * Each was a different card and the SAME shape, found one at a time because nothing asked the question of the
 * whole roster. Three things have to be true of an on-attack stat grant, and each has failed independently:
 *
 *  1. Its event must be ABSORBED into the attack's moment, or it plays as a beat after the lunge.
 *     (Broken by `spellcast` and `questTrigger` sitting un-absorbed between the attack and its consequences.)
 *  2. The swing must know it carries a stat change, so it holds its pose.
 *     (Broken for Rubies: the stock buff cues skip them, and the pause was gated on those cues.)
 *  3. Presentation must be able to ATTRIBUTE the buff, or it is dropped along with its badge roll.
 *     (Broken for every grant whose `source` is a LABEL — Gorun's `'Blade Mastery'` and ~20 rune grants.)
 *
 * This lane owns (3) and the source-level half of (1); `choreo/windupConsequences.test.ts` owns the rest,
 * because the grouping and the pause live in `@game/ui`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SIMULATE_SRC = readFileSync(join(HERE, '../../../core/src/combat/simulate.ts'), 'utf8');

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);
const SANDBAG = { cardId: 'sandbag', attack: 0, health: 99999 } as unknown as BoardMinion;

/** A one-sided fight so the player's swings resolve freely. `questMods` carries hero-power/rune combat mods. */
function fight(board: BoardMinion[], questMods: Record<string, unknown> = {}, enemy: BoardMinion[] = [SANDBAG]) {
  return simulate(board, enemy, makeRng(5), CARD_INDEX,
    combatSide({ tier: 6, questMods } as never), combatSide({ tier: 1 }));
}

/**
 * A buff's `source` is EITHER a board uid or a human-readable label. Both are legal in the log; only the first
 * can be measured on screen. `m<N>` is the simulator's uid shape, so anything else is a label.
 */
const isLabelSource = (source: string): boolean => !/^m\d+$/.test(source);

describe('Doc Bot — a swing that grants stats can always deliver them', () => {
  /**
   * Every LABEL a `ctx.buff` call in the simulator passes as its source, swept from the source itself so a new
   * one is covered the day it is written. These are the grants with no body on the board: hero powers, run
   * auras, and the rune family.
   */
  const labels = [...new Set(
    [...SIMULATE_SRC.matchAll(/ctx\.buff\([^;]*?'([A-Z][^']{2,})'\s*\)/g)].map((m) => m[1]!),
  )];

  it('the sweep finds the label-sourced grants (a rewrite that hid them would pass vacuously)', () => {
    expect(labels.length, 'no label-sourced ctx.buff calls found — has the call shape changed?').toBeGreaterThan(10);
    expect(labels, "Gorun's is the one the owner reported").toContain('Blade Mastery');
  });

  /**
   * THE RULE, stated where presentation can be held to it: a label source is not a uid, so the buff channel
   * MUST treat it as sourceless (a descend) rather than looking for a body to draw a tendril from. Dropping it
   * — which is what happened before — takes the badge roll with it, and the number then waits out the hold's
   * expiry, landing after the lunge. That is Gorun's report exactly.
   */
  it('the buff channel treats an unattributable source as SOURCELESS, not as a miss', () => {
    const replay = readFileSync(join(HERE, '../../../ui/src/useCombatReplay.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(replay.includes('!cardIds.has(c.source)'),
      'a grant attributed to a NAME must rain rather than be skipped — skipping it drops its badge roll').toBe(true);
  });

  /**
   * A label the presentation has an AUTHORED effect for must still be spelled exactly as the simulator writes
   * it. There is no type connecting the two — one is a string literal in `simulate.ts`, the other a key in
   * `bindings.ts` — so a rename on either side unbinds the effect silently, and the grant quietly falls back
   * to the generic descend with nobody the wiser.
   */
  it('every authored label effect names a label the simulator actually emits', () => {
    const bindings = readFileSync(join(HERE, '../../../ui/src/choreo/bindings.ts'), 'utf8');
    const start = bindings.indexOf('const LABEL_BUFF_FX');
    expect(start, 'LABEL_BUFF_FX is gone — this lane needs re-anchoring').toBeGreaterThan(-1);
    const block = bindings.slice(start, bindings.indexOf('};', start));
    const keys = [...block.matchAll(/'([^']+)':\s*\{/g)].map((m) => m[1]!);
    expect(keys.length, 'no authored label effects to check').toBeGreaterThan(0);
    for (const key of keys) {
      expect(labels, `'${key}' is bound to an effect but no ctx.buff in simulate.ts passes it`).toContain(key);
    }
  });

  it('Gorun grants on the swing, and his grant is label-sourced (the case that broke)', () => {
    const { events } = fight([bm('d2_ashscribe', 'G', 4, 400)], { bladeMastery: { attacks: 0 } });
    const blade = events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> =>
      e.type === 'buff' && e.source === 'Blade Mastery');
    expect(blade.length, 'Blade Mastery granted nothing — re-check the fixture').toBeGreaterThan(0);
    expect(isLabelSource(blade[0]!.source), 'the whole point: this source names no body').toBe(true);
  });

  /**
   * The GROUPING half, checked here so a sim-side reorder is caught by a sim-side lane: everything a swing
   * causes has to sit between its `attack` and the damage that ends it. An event type that lands in that gap
   * and is not absorbed splits the swing in two — which is how `spellcast` (Dragonflame) and `questTrigger`
   * (Gorun) each broke it, one after the other.
   */
  it('NO on-attack card leaves an unabsorbed event between its swing and its damage', () => {
    // THE SWEEP (owner ask 2026-09-01: *"add this logic to the oracle"*). Every card in the game with an
    // `onAttack` effect swings, and every event it causes before its damage must be absorbed — otherwise the
    // swing splits and everything BEHIND the stray event is stranded after the lunge too. That cascade is why
    // one un-absorbed `toHand` (Flagrunner's Rally conjuring a card) made Gorun's grant look late as well.
    //
    // Reading the absorb set from `compile.ts` rather than restating it, so removing a type fails HERE and
    // names the cards it breaks. This sweep is what found `toHand`, `keyword` and `keywordLost`; the three
    // before them (`spellcast`, `questTrigger`, and the `sc` predicate) each cost a separate owner report.
    const compileSrc = readFileSync(join(HERE, '../../../ui/src/choreo/compile.ts'), 'utf8');
    const absorbBlock = compileSrc.slice(compileSrc.indexOf('absorbIntoWindup: new Set('));
    const ABSORBED = new Set([...absorbBlock.slice(0, absorbBlock.indexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1]!));
    expect(ABSORBED.size, 'absorbIntoWindup is gone or unreadable — this lane needs re-anchoring').toBeGreaterThan(5);

    // Everything with an on-attack effect, partnered with a Rally-capable ally so the on-ALLY-attack cards
    // (Traveling Skald, Fatecarver, Warflame) fire too. Gorun's mods are on so his hero-power grant is in
    // every fixture — it is the one that rides along behind whatever else the swing does.
    const attackers = (Object.values(CARD_INDEX) as { id: string; effects?: { on: string }[] }[])
      .filter((d) => (d.effects ?? []).some((e) => e.on === 'onAttack'));
    expect(attackers.length, 'no on-attack cards found — has the effect shape changed?').toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const def of attackers) {
      let events;
      try {
        ({ events } = fight(
          [bm(def.id, 'A', 4, 4000, ['RL']), bm('d2_ashscribe', 'D', 4, 4000, ['RL'])],
          { bladeMastery: { attacks: 0 } },
        ));
      } catch {
        continue; // a card that cannot legally sit in this fixture is not this lane's business
      }
      for (let i = 0; i < events.length; i++) {
        if (events[i]!.type !== 'attack') continue;
        for (let j = i + 1; j < events.length; j++) {
          const e = events[j]!;
          // The swing ends at its first RESULT: from there on, later beats are correct by design.
          if (e.type === 'dmg' || e.type === 'death' || e.type === 'attack' || e.type === 'shield') break;
          // `sc` is absorbed by PREDICATE (any mid-combat narration), not by type — see `isWindupNarration`.
          if (e.type === 'sc' && !e.cast) continue;
          if (ABSORBED.has(e.type)) continue;
          const line = `${def.id}: '${e.type}'`;
          if (!offenders.includes(line)) offenders.push(line);
        }
      }
    }
    expect(offenders, 'these events sit in a wind-up unabsorbed — each one splits its swing and strands everything behind it').toEqual([]);
  });
});

/**
 * THE WIND-UP RESOLVES BEFORE THE SWING (owner ruling 2026-09-01).
 *
 *   *"echohorn should wind up and trigger rally, which triggers the chicken brawl. chicken brawl's summoned
 *   minion attacks IMMEDIATELY … it is summoned and attacks BEFORE the echohorn's attack resolves. the echo is
 *   always fully resolved before the attack goes off for a minion like echohorn (same logic for deathsayer)."*
 *
 * An attack-on-summon token DEFERS onto the immediate-attack queue and lands at the next flush. Every flush
 * point was AFTER a clash, so a token conjured by an ON-ATTACK trigger landed only once the attacker's own
 * damage had been dealt — its arrival read as an afterthought to the swing that caused it.
 *
 * This is an ENGINE ordering rule, not a presentation one (owner chose it over the presentation-only option),
 * so it is graded on the event log: within one swing, every consequence of the wind-up precedes the attacker's
 * own damage.
 */
describe('Doc Bot — a swing\u2019s wind-up fully resolves before the swing lands', () => {
  it('a Rally-summoned charger attacks BEFORE the attacker\u2019s own damage', () => {
    const { events } = fight([
      bm('b2_echohorn', 'E', 5, 400, ['RL']),
      bm('dw_chickenbrawl', 'C', 3, 3),
    ]);
    const swing = events.findIndex((e) => e.type === 'attack' && e.attacker === 'm0');
    expect(swing, 'Echohorn never swung — re-check the fixture').toBeGreaterThan(-1);
    const ownDamage = events.findIndex((e, i) => i > swing && e.type === 'dmg' && e.source === 'm0');
    const summon = events.findIndex((e, i) => i > swing && e.type === 'summon');
    expect(summon, 'the Rally summoned nothing — re-check the fixture').toBeGreaterThan(-1);
    expect(ownDamage, 'the attacker never dealt its damage').toBeGreaterThan(-1);
    expect(summon, 'the summon landed AFTER the swing it was supposed to precede').toBeLessThan(ownDamage);
    // …and the charger's own swing, which is the half the owner actually watched go late.
    const chargerSwing = events.findIndex((e, i) => i > summon && e.type === 'attack' && e.attacker !== 'm0');
    expect(chargerSwing, 'the summoned body never attacked').toBeGreaterThan(-1);
    expect(chargerSwing, 'the charger swung after the attacker it should have preceded').toBeLessThan(ownDamage);
  });

  it('a target killed IN the wind-up cancels the clash — no damage either way', () => {
    /**
     * *"if echohorn attacks and triggers fel spikes, and that fel spike triggers and kills the initial target,
     * echohorn does not then take dmg from that now DEAD target. the echohorn simply settles."* — owner,
     * 2026-09-01.
     *
     * Once a swing's consequences resolve BEFORE it lands, they can kill the body being swung at. The clash is
     * written for a live exchange and ran anyway, so the attacker dealt damage into a corpse and — the part
     * that actually showed — took RETALIATION from it. A phantom hit from a dead body.
     */
    const { events } = fight([
      bm('b2_echohorn', 'E', 5, 400, ['RL']),
      bm('dm_felspikes', 'F', 3, 3),
    ], {}, [bm('d2_ashscribe', 'x', 1, 2), bm('d2_ashscribe', 'y', 1, 2)]);
    const swing = events.findIndex((e) => e.type === 'attack' && e.attacker === 'm0');
    expect(swing, 'Echohorn never swung — re-check the fixture').toBeGreaterThan(-1);
    const defender = (events[swing] as { defender: string }).defender;
    const deathAt = events.findIndex((e, i) => i > swing && e.type === 'death' && e.target === defender);
    expect(deathAt, 'the spray never killed the target — re-check the fixture').toBeGreaterThan(-1);
    // NOTHING may come back from the corpse: no retaliation onto the attacker, ever again from that body.
    const fromCorpse = events.filter((e, i) => i > deathAt && e.type === 'dmg' && e.source === defender);
    expect(fromCorpse, 'a dead body retaliated').toEqual([]);
  });

  it('a second charger lands when the first dies and frees its slot', () => {
    /**
     * *"if it dies, the next charging soldier now has room and should be summoned and immediately attack …
     * both of those charging soldiers would trigger and attack before the echohorn's actual resolution
     * attack."* — owner ruling 2026-09-01.
     *
     * The cap used to be judged when the tokens were QUEUED — before any of them had lived and died — so on a
     * full board the second was rejected on a fullness that no longer existed by its turn. It is judged as
     * each one LANDS now, which is what "usual board space rules" means when they land one at a time.
     */
    const src = readFileSync(join(HERE, '../../../core/src/combat/simulate.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const queueBlock = src.slice(src.indexOf('if (card.attackOnSummon || attackNow)'));
    const upToPush = queueBlock.slice(0, queueBlock.indexOf('pendingAttackOnSummon.push'));
    expect(/living\(side\)\.length >= 7/.test(upToPush),
      'the cap must not be judged at queue time — the board it reads is not the one the token lands on').toBe(false);
    // …and `placeSummon` must still judge it, or nothing does and the board overflows.
    const place = src.slice(src.indexOf('function placeSummon'));
    expect(/living\(side\)\.length >= 7/.test(place.slice(0, place.indexOf('return minion'))),
      'the cap must still be judged as each token lands').toBe(true);
  });

  it('an immediate strike by a body ALREADY on the board is NOT pulled early', () => {
    // Scoped deliberately: the ruling is about a SUMMONED body. Solaris Fang's Avenge re-grants a Ward before
    // each of its two immediate strikes, so draining those in the wind-up strips the second Ward — a different
    // mechanism with its own ordering, and the reason the flush filters on `summon`.
    const core = readFileSync(join(HERE, '../../../core/src/combat/simulate.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(core.includes('flushImmediateAttacks(true)'),
      'the wind-up flush must drain summons only').toBe(true);
  });
});
