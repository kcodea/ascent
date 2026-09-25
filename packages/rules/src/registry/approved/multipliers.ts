/**
 * APPROVED RULES — domain `multipliers`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';
import { AVWIN_HANDOFF } from './shared';

export const MULTIPLIERS_RULES: GameRule[] = [
  {
    id: 'R-AVWIN-07',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Avenge multipliers multiply resolution, not progress',
    statement:
      '"Your Avenges trigger twice" causes two resolutions when the threshold is reached. It does not '
      + 'make each death count twice.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Avenge multipliers multiply resolution, not progress.' }],
    currentBehaviour:
      'Conforms: Rune of Fury / The Sealed Vault re-run the avenge factory with the SAME payload count '
      + '(a second resolution); the death tally is untouched.',
  },
  {
    id: 'R-MULT-01',
    title: 'The printed wording decides how a multiplier composes — "twice" multiplies, "additional" adds',
    statement:
      'A card that prints "trigger twice" is a MULTIPLIER: copies of the SAME card do not stack (two Drakkos '
      + 'are still twice), but DIFFERENT multiplier cards multiply with each other. A card that prints '
      + '"trigger N additional time(s)" is ADDITIVE: every copy of every additive card counts. The two combine '
      + 'as (1 + Σ extra) × Π factor. So two Sylus mean an Echo fires 3 times, two Drakko still mean a Shout '
      + 'fires twice, and Drakko + Zyff mean a Shout fires FOUR times. Gilding doubles an additive '
      + "card's extra and buys a multiplier ONE more trigger (golden Drakko is three times, not four).",
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat', ref: 'owner message 2026-08-28 (the terminology pass this rule anticipated)',
        quote: 'if something says "twice" then it is a multiplier and not "additional times" but they do not stack, whereas "additional time" texts do. i.e. 2 Sylus on board means an echo will trigger 3 times. 2 drakko on board means a Shout will trigger 2 times. Zyff + Drakko on board would mean that a shout triggers 4 times.',
      },
      {
        kind: 'owner-chat', ref: 'decisions.json q-interact-nonstack-best-of (triage round 2, 2026-08-27)',
        quote: 'This is correct behavior. We will probably change our text/terminology to better reflect non stackers. i.e. using "Twice" instead of "an additional time."',
      },
    ],
    currentBehaviour:
      'Conforms (rewritten 2026-08-28). SUPERSEDES the 2026-08-27 reading, under which every non-stacker '
      + 'collapsed to best-of across different cards (Drakko + Zyff = +1 total). The terminology pass this rule '
      + 'predicted turned out to change COMPOSITION as well as wording. `extraTriggerFires` is the one '
      + 'implementation; triggerMultiplierModel.test.ts pins every worked example verbatim.',
    enforcement: { kind: 'oracle', refs: ['interactionFamilyMatrix'], lastVerifiedAt: '2026-08-28' },
  },
  {
    id: 'R-MULT-02',
    title: 'Trigger-multiplier composition is family-agnostic — End of Turn and Start of Combat fold like the rest',
    statement:
      'The composition law of R-MULT-01 applies to EVERY trigger family, not only the ones with a named '
      + 'precedent — a family needs no ruling of its own to be composed this way. So Uron (additive) and '
      + 'Chronos ("twice", a multiplier) together make End-of-Turn effects fire (1 + 1) × 2 = FOUR times; Uron '
      + 'alone makes Start-of-Combat effects fire twice; and Rune of Twilight adds its pass on top of the fold '
      + '(owner reversal 2026-08-20). REVISED 2026-08-28 by the wording rule: the earlier reading '
      + 'collapsed Uron + Chronos to 2×, which was right under the all-additive model it was approved against '
      + 'and wrong under the one that replaced it the same day.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat', ref: 'decisions.json q-interact2-32aa654f (Sitting-2 anomaly deck, 2026-08-28)',
        quote: 'APPROVE — Reading A: these families fold like the ruled ones: additive within a family, best-of across non-stacking cards.',
      },
      {
        kind: 'owner-chat', ref: 'decisions.json q-interact2-faeb3c44 (Sitting-2 anomaly deck, 2026-08-28)',
        quote: 'APPROVE — Chronos\'s endOfTurn multiplier composes by the same law.',
      },
    ],
    currentBehaviour:
      'Conforms — `extraTriggerFires` (packages/core/src/types.ts) is written per FAMILY, not per card, and is '
      + 'the single boundary every family consults: `familyRepeats`/`endOfTurnRepeats` in recruit.ts and the '
      + '`scReps` fold in simulate.ts. Pinned by matrix fixtures P12–P13 (interactionFamilyMatrix.test.ts); '
      + 'this ruling also resolves interaction-ambiguities.md Q1 and takes endOfTurn/startOfCombat off the '
      + 'anomaly oracle\'s unruled-composition worklist.',
    enforcement: { kind: 'oracle', refs: ['interactionFamilyMatrix', 'interactionSweep'], lastVerifiedAt: '2026-08-28' },
  },
  {
    id: 'R-MULT-03',
    title: 'The Revelers share ONE value, +1 per Reveler sold; a golden Reveler pays double',
    statement:
      'Flame, Tide and Grove Reveler pay from a single run-wide value X (starting at 1) when sold — Flame gives your '
      + 'Spirits +X Attack, Tide +X Health, Grove gives every minion +X/+X (board only, never the hand) — and EVERY '
      + 'Reveler sold, of any type, raises X by 1. A golden Reveler pays 2X and still raises X by 1. Cards that '
      + 'reference "your Reveler bonus" (Festival Luminary) read X itself. Festival Treasurer\'s per-Reveler-sold '
      + 'discount stacks to −3; Grand Procession returns the first of each Reveler TYPE sold each turn.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (Spirit roster answers 1–2, 7, 9)', quote: 'all three share one X; +1 per Reveler sold; golden 2X; the Reveler bonus IS X; Treasurer stacks to -3' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (correction)', quote: 'the reveler sells are buffing hand minions which is not correct, please fix that' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts revelerValue / revelerSell (board only) / battlecryBuffRandomTribePlusReveler; packages/sim/src/state.ts revelerX; packages/ui/src/cardText.ts spiritText' },
    ],
    contentIds: ['sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler', 'sp3_luminary', 'sp3_treasurer', 'sp3_grandprocession'],
    currentBehaviour:
      'Conforms (built with the ruling, 2026-09-09, PR #1393; the hand-buffing slip fixed in the same PR before merge).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Spirits.test.ts', 'packages/ui/src/spiritText.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-MULT-04',
    title: 'A Start-of-Combat multiplier repeats RUNE Start-of-Combat effects too, not just minion ones',
    statement:
      'A multiplier that repeats a side\'s Start of Combat repeats EVERY Start-of-Combat effect that side has. A '
      + 'rune counts whenever its printed text is a Start of Combat line, exactly as a minion\'s Start of Combat '
      + 'does. The extra pass runs after the whole base pass for that side and in the same order as the base pass, '
      + 'and the base pass is unchanged. A Start-of-Combat buff that is pre-baked into the combat board before the '
      + 'simulator\'s pass folds the same number of copies.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (Twilight x Underdog report)', quote: 'Rune of Twilight just did not work with Rune of the Underdog. Why not?' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (the scope call)', quote: 'Yes, all rune SoC effects' },
      { kind: 'fix-pr', ref: 'PR #1614 — packages/core/src/combat/simulate.ts (the rune Start-of-Combat block runs one extra pass per Twilight fire); packages/sim/src/recruit.ts faceOmen (the pending-SoC bake folds every copy)' },
    ],
    contentIds: ['rune_twilight', 'rune_underdog'],
    currentBehaviour:
      'Conforms — 2026-09-21 (PR #1614). Twilight used to re-fire only the MINION Start-of-Combat pass, so every '
      + 'rune block fired once however many Twilight copies were forged. Underdog now pays four times under two '
      + 'Twilights, and the pre-baked Fleeting Vigor path folds the same count.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/core/src/combat/twilightRuneSoc.test.ts', 'packages/sim/src/twilightPendingSC.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-MULT-05',
    title: 'A multiplier reaches the printed number, not only the outcome',
    statement:
      'When an effect repeats a trigger, everything the repeat PRODUCES must reach the player\'s readouts as well '
      + 'as the board. A Rally that fires twice grants twice, so every number those grants FEED must show the '
      + 'doubled total on every surface, in the shop and during the fight: the value printed on a spell whose '
      + 'magnitude rides the spell power they gave, an escalating spell\'s step, a tally they advance. The way to '
      + 'get this for free is to derive the readout from the events the simulator emits per fire, rather than '
      + 're-deriving the magnitude in the UI from a rate and a count. The rule is about the TOTAL, not the rate: '
      + 'a rune that repeats a trigger leaves the repeating card\'s own per-trigger text alone, because one '
      + 'trigger still grants what it printed and the rune itself tells the player the trigger fires twice. A '
      + 'rune that multiplies a SINGLE fire is the other case, and there the printed step must change.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (live spell text report)', quote: 'rune of adventuring should affect the # shown for spell buffs too, since it re-triggers things like chorus drake etc.' },
      { kind: 'fix-pr', ref: 'Live spell text + Voicekeeper fix — no simulation change was needed; the doubling was already correct and only the readout was stale (packages/ui/src/liveSpellTextInCombat.test.ts pins both halves)' },
    ],
    currentBehaviour:
      'Conforms for the totals — 2026-09-22. Probed through simulate() first: a Chorus Drake under Rune of '
      + 'Adventuring (rallyExtraAlways) already rallied 90 times instead of 45 and banked exactly double the '
      + 'spell power, and emitted one narration per fire. The SIM was right the whole time; only the printed '
      + 'number was stale, and it was stale for the reason in R-TEXT-06. Because the readout is now a fold over '
      + 'those per-fire narrations, the doubling reaches the text with no multiplier arithmetic in the UI at all. '
      + 'Deliberately NOT folded, and not counted as a gap (review 2026-09-22): the repeating card\'s own '
      + 'per-trigger text. Chorus Drake still prints "+1 Health" under the rune, because one Rally really does '
      + 'grant 1 and the rune already states that Rally fires twice. Contrast Rune of Mastery, which multiplies a '
      + 'single improve and therefore IS folded into card text through improveReps. If the owner ever rules that '
      + 'a repeat-the-trigger rune must double the repeating card\'s printed rate as well, that is its own text '
      + 'change and this statement widens with it.',
    cardText: 'Rune of Adventuring: "Your **Rally** effects trigger **twice**."',
    example:
      'Chorus Drake plus Rune of Adventuring: 45 Rallies become 90, spell power gained goes from +0/+45 to +0/+90, '
      + 'and a Front to Back in hand must print the +90 version while the fight is still running. The Drake itself '
      + 'still prints +1 Health per Rally, because that is still what one Rally grants.',
    contentIds: ['rune_adventuring', 'd2_chorus'],
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/liveSpellTextInCombat.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-MULT-06',
    title: 'Cast multipliers apply only to spells cast from hand, and only a hand cast spends them',
    statement:
      'Every effect that makes a spell cast more times (Yazzus, Living Grimoire, Orivax, Spell Thesis, Ancient Runes, '
      + 'Nimbus, Comet, Edward Keg-hands, the Bottomless Cask and Bottomless Cellar, Rune of Shared Pour, Rune of '
      + 'Hoardflame, Rune of Dragon Breath, Constellation Prime) applies ONLY to a spell the player casts from hand. A '
      + 'spell cast by a minion (a Mage-Pup, an End-of-Turn caster), by a rune (Rune of Recurrence, a rune threshold) or '
      + 'by an Equipment (Pourman\'s Keg) resolves exactly once, and it never spends a one-shot multiplier: the Living '
      + 'Grimoire charge, Orivax\'s first-spell window, the Spell Thesis freebie, a Nimbus or Comet charge and the Shared '
      + 'Pour freebie all wait for the next spell cast from hand. A re-cast of the spell being cast from hand, inside '
      + 'that same cast (Mirrorwing, Yirin\'s Reflector, Runefire, Crash Course, Rune of Shared Reflection), is that '
      + 'hand cast happening again and keeps its multiplier; the same re-cast of a minion\'s or rune\'s cast resolves '
      + 'once. A minion\'s or rune\'s cast still counts as a spell cast for every tally and for the first/last-spell '
      + 'memory (R-MINIONCAST-01). Rune of Resonance and the Ruby cast count are unchanged: a Ruby only multiplies when '
      + 'played from hand already.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling 2026-09-24 (after PR #1699 routed minion casts through castSpell)', quote: 'let\'s make the effect of living grimoire and yazzus/orivax etc specify spell cast from hand so that it only doubles from spells cast from hand.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts withHandCast / isHandCast / castsOutsideHand (the one gate), noteSpellCast (Grimoire spend + Orivax window), battlecryCastTaughtSpell, equipmentCastRandomAle, the spellCastOnThis re-casts, spellBuffTargetAndRandomFriendly (Constellation Prime); packages/sim/src/reducer.ts the hand-play paths (the only withHandCast callers)' },
    ],
    contentIds: ['yazzus', 'd2_grimoire', 'd2_orivax', 'nimbus', 'ce3_artificer', 'dw_edward', 'ce3_constellationprime', 'rune_shared_pour', 'rune_hoardflame', 'rune_bottomless_cask', 'rune_dragon_breath', 'q_spell_thesis', 'q_ancient_runes', 'q_bottomless_cellar', 'q_endless_verse'],
    currentBehaviour:
      'Conforms (fix/cast-multipliers-from-hand, 2026-09-24). Before, a minion\'s or rune\'s cast went through '
      + '`castSpell` without being multiplied but still spent the Living Grimoire charge and closed Orivax\'s window, '
      + 'while a Mage-Pup\'s taught spell and a Pourman\'s Keg pour were fully multiplied (and the Pup spent Spell Thesis '
      + 'and the Nimbus charge). Card, rune and quest texts now say "from hand".',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/castMultipliersFromHand.test.ts', 'packages/sim/src/set3Dwarves.test.ts', 'packages/sim/src/docbot/recastMultiplier.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
];
