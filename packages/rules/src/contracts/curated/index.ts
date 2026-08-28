/**
 * CURATED CONTENT CONTRACTS — hand-maintained, NEVER regenerated (§4.6: generated ≠ curated).
 *
 * Seeded from the vertical slice's 13 hand-authored v0 contracts
 * (packages/sim/src/docbot/slice/contracts.ts — quarantined prototypes that stay in place until WP D
 * supersedes the slice oracle), migrated to the frozen v1 schema:
 *  · verbatim text is GONE (friction 9) — the displayed-text leg resolves from the indexes at check time;
 *    the slice's text observations became `textContract.claims`;
 *  · target counts use the cardinality vocabulary (friction 6) — no more -1;
 *  · Obsidian Drake's Attack-grant and Demon Agent's bought-stats are `formula` amounts (friction 2);
 *  · Kennelmaster carries the subject-side copy claim (friction 5) the R-AVWIN-03/04 rulings attach to.
 *
 * Every amount was read from the PRINTED TEXT and the owner rulings — never from the factory params an
 * oracle would execute (§4.2). `reviewStatus: 'approved'` appears ONLY where a real owner ruling covers the
 * load-bearing claims (cited in relatedRuleIds); everything else ships visibly 'extracted'.
 *
 * `npm run contracts:extract` must never emit an id this file owns — enforced by the contracts integrity
 * test AND re-checked at merge time by `allContracts()` (curated wins).
 */
import type { ContentContract } from '../schema';

export const CURATED_CONTRACTS: readonly ContentContract[] = [
  {
    contentId: 'wolvesden',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set1'],
    tribes: ['undead', 'beast'],
    tags: ['trigger:echo', 'effect:summon'],
    triggers: [{ event: 'onDeath', phase: 'combat', phaseBasis: 'authored', note: 'Echo (Deathrattle); also shop-firable through forced-Echo effects' }],
    effects: [{ kind: 'summon', summons: { cardId: 'cryptwolf', count: { plain: 3, gilded: 6 } } }],
    gildedDelta: { kind: 'multiply', factor: 2, description: 'gilded summons 6 Crypt Wolves instead of 3' },
    textContract: { source: 'index' },
  },
  {
    contentId: 'sylus',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set1'],
    tags: ['multiplier:echo', 'stacking'],
    multiplier: { families: ['deathrattle'], extra: 1, stacks: true, resolutionOnly: true },
    relatedRuleIds: ['R-MULT-01'],
    textContract: { source: 'index' },
    notes: 'STACKING per R-MULT-01 ("stacking multipliers (Sylus) sum"). The stacks:true half is UNPROBED by the slice oracle (board-cap ceilings make a two-Sylus wolf count ambiguous) — an honest coverage gap.',
  },
  {
    contentId: 'zyff',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set1'],
    tags: ['multiplier:echo', 'multiplier:shout', 'non-stacking'],
    multiplier: { families: ['battlecry', 'deathrattle'], extra: 1, stacks: false, resolutionOnly: true },
    relatedRuleIds: ['R-MULT-01'],
    textContract: {
      source: 'index',
      claims: [{ claim: 'prints "an additional time" for a non-stacking +1 — the owner-flagged non-stacker wording; the language guide (LG-TWICE-01) wants "Twice"', basis: 'vertical-slice wording-recommendation finding' }],
    },
    notes: 'Non-stacking (best-of across the family, R-MULT-01).',
  },
  {
    contentId: 'deathsayer',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set1'],
    tribes: ['undead'],
    keywords: ['RL'],
    tags: ['trigger:rally', 'effect:trigger-other', 'forced-echo'],
    triggers: [{ event: 'onAttack', phase: 'combat', phaseBasis: 'authored', note: 'Rally — before this attacks' }],
    effects: [{ kind: 'trigger-other-echo', targets: { cardinality: 'exactly', count: 1, scope: 'leftmost-friendly-echo' }, note: 'fires the target\'s Echo WITHOUT a death; folds the side\'s Echo multipliers like every forced trigger (owner ruling q-interact-forced-echo, 2026-08-27)' }],
    gildedDelta: { kind: 'multiply', factor: 2, description: 'gilded triggers the leftmost Echo twice per Rally' },
    textContract: { source: 'index' },
  },
  {
    contentId: 'stuntdrake',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set1'],
    tribes: ['dragon'],
    tags: ['trigger:avenge', 'effect:grant-attack'],
    triggers: [{ event: 'avenge', phase: 'combat', phaseBasis: 'authored', threshold: 3 }],
    effects: [{
      kind: 'give-own-attack',
      amount: { kind: 'formula', formula: 'stat-of-source', params: { stat: 'attack' }, description: "grants this minion's CURRENT Attack (not a printed constant)" },
      targets: { cardinality: 'exactly', count: 2, scope: '2-other-friendly' },
    }],
    gildedDelta: { kind: 'multiply', factor: 2, description: 'gilded resolves the grant twice per threshold' },
    persistence: ['combat-only'],
    relatedRuleIds: ['R-AVWIN-01', 'R-AVWIN-06', 'R-AVWIN-07', 'R-AVWIN-10'],
    textContract: { source: 'index' },
    notes: 'The simultaneous-death subject: R-AVWIN-10 (a source dying in a batch observes none of it) is APPROVED and currently VIOLATED by the engine — the slice\'s verified-mechanical-bug finding, pinned in docbot/scenarios/avenge-dying-source-batch-pin.json.',
  },
  {
    contentId: 'kennel',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set1'],
    tribes: ['beast'],
    keywords: ['SC'],
    tags: ['trigger:avenge', 'counter:improving', 'copy-subject'],
    triggers: [{ event: 'avenge', phase: 'combat', phaseBasis: 'authored', threshold: 4 }],
    effects: [{ kind: 'improve-own-aura', note: 'permanent per-instance accrual (summonBonus channel)' }],
    persistence: ['permanent'],
    copySubject: {
      // OWNER RULING 2026-08-28 (decisions.json q-interact2-2ad14500): "simply put a xerox copy should be an
      // exact copy, so identical in every way." The anomaly oracle flagged an exact copy carrying this
      // subject's GILDING as unstated — the ENGINE was right and this contract was incomplete. Under an
      // exact copy EVERY card-owned instance property rides, so the list is stated in full rather than
      // enumerating the one channel the slice happened to probe.
      rides: [
        'gilding (golden)',
        'accrued-improve-counters (summonBonus)',
        'stat buffs, attachments, granted keywords, learned effects — every card-owned instance property (R-COPY-02: an exact copy is identical in every way)',
      ],
      sheds: ['in-flight Avenge progress toward the next threshold', 'engine-owned pending events / queue bookkeeping (never part of the card instance, R-COPY-02)'],
      note: 'the copied-SUBJECT half of the copy rulings (friction item 5): an EXACT copy is identical in every way — gilding, the accrued aura value (R-AVWIN-03) and every other card-owned property ride; a PLAIN copy starts from base (R-COPY-01); neither inherits partial threshold progress (R-AVWIN-04)',
    },
    relatedRuleIds: ['R-AVWIN-01', 'R-AVWIN-03', 'R-AVWIN-04', 'R-AVWIN-05', 'R-COPY-02'],
    textContract: { source: 'index' },
  },
  {
    contentId: 'anubis',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set1'],
    tribes: ['undead'],
    keywords: ['R'],
    tags: ['keyword:rise', 'trigger:echo', 'effect:grant-keyword', 'effect:cast-spell'],
    triggers: [{ event: 'onDeath', phase: 'combat', phaseBasis: 'authored' }],
    effects: [
      { kind: 'grant-rise-all', targets: { cardinality: 'all', scope: 'all-other-friendly-without-rise' } },
      { kind: 'cast-spell', refs: ['lanternsouls'], note: 'casts Lantern of Souls (permanent run-wide Undead Attack)' },
    ],
    persistence: ['permanent'],
    relatedRuleIds: ['R-AVWIN-09', 'R-AVWIN-11'],
    textContract: { source: 'index' },
    notes: 'Rise + Echo on one body. Neither the text nor any rule states whether the Echo fires on BOTH the rise-death and the final death — the slice\'s questionable-interaction finding (unruled).',
  },
  {
    contentId: 'n2_bellringer',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set2'],
    tags: ['effect:copy', 'copy:plain', 'cadence:every-2-turns'],
    triggers: [{ event: 'endOfTurn', phase: 'shop', phaseBasis: 'authored', threshold: 2, note: 'every 2 turns (the threshold is the cadence)' }],
    effects: [{ kind: 'copy-neighbour', targets: { cardinality: 'exactly', count: 1, scope: 'left-neighbour' } }],
    copyPolicy: { mode: 'plain', note: 'fresh base copy: no buffs, counters, gilding (R-COPY-01)' },
    gildedDelta: {
      kind: 'reshape',
      effects: [{ kind: 'copy-neighbour', targets: { cardinality: 'exactly', count: 2, scope: 'both-adjacent' } }],
      description: 'the gild changes the SHAPE, not a magnitude: left neighbour → BOTH adjacent minions (the friction-item-8 exemplar)',
    },
    relatedRuleIds: ['R-COPY-01', 'R-AVWIN-04'],
    textContract: { source: 'index' },
  },
  {
    // Owner rulings 2026-08-14 (board summon) + 2026-08-15 (exact copy) cover the load-bearing claims,
    // and R-AVWIN-03's currentBehaviour records the conforming behaviour — hence 'approved' (a citation
    // of real owner rulings, not an auto-promotion).
    contentId: 'hero:xerox',
    contentType: 'hero-power',
    revision: 2,
    reviewStatus: 'approved',
    tags: ['hero-power:active', 'effect:copy', 'copy:exact', 'once-per-game'],
    triggers: [{ event: 'heroPower', phase: 'shop', phaseBasis: 'authored' }],
    effects: [{ kind: 'summon-copy', targets: { cardinality: 'exactly', count: 1, scope: 'friendly-board-minion' }, note: 'board summon beside the target; needs a free slot; once per game' }],
    copyPolicy: { mode: 'exact', note: 'full instance spread — stats, buffs, granted keywords, GILDING, accrued counters (summonBonus etc.) all ride along (owner ruling 2026-08-15; R-COPY-02)' },
    relatedRuleIds: ['R-COPY-02', 'R-AVWIN-03'],
    textContract: {
      source: 'index',
      claims: [{ claim: 'the displayed text says only "a copy" — under R-COPY-01 an unmarked copy reads plain, but the ruled behaviour is EXACT', basis: 'vertical-slice verified-text-defect finding' }],
    },
  },
  {
    contentId: 'dm_butcher',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set2'],
    tribes: ['demon'],
    tags: ['trigger:shout', 'effect:shop-buff'],
    triggers: [{ event: 'onPlay', phase: 'shop', phaseBasis: 'authored' }],
    effects: [{ kind: 'buff-shop', amount: { kind: 'const', plain: [2, 1], gilded: [4, 2] }, targets: { cardinality: 'all', scope: 'all-shop-minions' } }],
    gildedDelta: { kind: 'multiply', factor: 2, description: 'gilded grants +4/+2 instead of +2/+1' },
    persistence: ['run-wide'],
    textContract: { source: 'index' },
    notes: '"Minions in the Shop" is the ruled run-wide vocabulary (owner ruling 2026-07-25): a lasting buff on everything bought from here on, not one roll.',
  },
  {
    contentId: 'dm_agent',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set2'],
    tribes: ['demon'],
    tags: ['trigger:shout', 'effect:consume-shop', 'targeted'],
    triggers: [{ event: 'onPlay', phase: 'shop', phaseBasis: 'authored' }],
    effects: [{
      kind: 'target-consumes-shop',
      amount: { kind: 'formula', formula: 'offer-buy-stats', params: { consumesPlain: 1, consumesGilded: 2 }, description: 'the TARGET eats the right-most Shop minion (2 when gilded), gaining the eaten offer\'s BOUGHT stats — not a printed constant' },
      targets: { cardinality: 'exactly', count: 1, scope: 'friendly-demon' },
    }],
    gildedDelta: { kind: 'multiply', factor: 2, description: 'gilded: the target Consumes 2 Shop minions' },
    textContract: { source: 'index' },
  },
  {
    contentId: 'd2_recaller',
    contentType: 'minion',
    revision: 2,
    reviewStatus: 'extracted',
    setIds: ['set2'],
    tribes: ['dragon'],
    tags: ['trigger:shout', 'effect:copy-spell'],
    triggers: [{ event: 'onPlay', phase: 'shop', phaseBasis: 'authored' }],
    effects: [{ kind: 'copy-cast-spell', amount: { kind: 'const', plain: 1, gilded: 2 }, note: 'copies the LAST Shop spell cast THIS TURN (turn-scoped, not run-lifetime)' }],
    gildedDelta: { kind: 'multiply', factor: 2, description: 'gilded grants 2 copies' },
    textContract: { source: 'index' },
  },
  {
    contentId: 'rune_fury',
    contentType: 'rune',
    revision: 2,
    reviewStatus: 'extracted',
    tags: ['multiplier:avenge', 'behavior-altering-rune'],
    multiplier: { families: ['avenge'], extra: 1, stacks: true, resolutionOnly: true },
    relatedRuleIds: ['R-AVWIN-07'],
    textContract: { source: 'index' },
    notes: 'resolutionOnly restates R-AVWIN-07: the rune re-resolves at the threshold; each death still counts once toward it. stacks per R-RUNEDUP-05 (flagCopies), unprobed by the slice.',
  },
];

export const CURATED_CONTRACT_IDS: ReadonlySet<string> = new Set(CURATED_CONTRACTS.map((c) => c.contentId));
