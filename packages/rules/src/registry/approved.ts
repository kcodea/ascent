/**
 * APPROVED RULES — each entered here only on an explicit owner ruling, with the ruling cited.
 *
 * The first five come verbatim from the owner's Complete Rulebook handoff (Codex, 2026-06-29,
 * `ascent-complete-rulebook-handoff.md` § Confirmed Owner Rulings), which states they "have already been
 * explicitly confirmed and should enter the new registry as approved rules."
 */
import type { GameRule } from '../schema';

const HANDOFF = 'C:/Users/kevin/Documents/Codex/2026-06-29/files-mentioned-by-the-user-codex/ascent-complete-rulebook-handoff.md';

export const APPROVED_RULES: GameRule[] = [
  {
    id: 'R-CEL-01',
    title: 'Celestial Alignment locks at combat start',
    statement:
      'Dawn, Dusk and Eclipsed are determined by board position. Alignment locks when combat begins; combat '
      + 'deaths and board contraction do not realign survivors. Eclipsed counts as both Dawn and Dusk. '
      + '(Provisional: Celestials are WIP and this may be revised.)',
    domain: 'combat',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'Alignment locks when combat begins.' }],
  },
  {
    id: 'R-PLAY-01',
    title: 'What counts as a played card',
    statement:
      'Any card intentionally played from hand counts as a played card — minions, spells, Shop spells, '
      + 'Rubies, Dwarven Ales, Gifts, and future subtypes. Buying, generating, drawing or receiving a card '
      + 'does not play it; reordering does not play it; an automatic or triggered cast is not a card played '
      + 'from hand.',
    domain: 'actions',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'Any card intentionally played from hand counts as a played card.' }],
  },
  {
    id: 'R-COPY-01',
    title: 'Plain copies',
    statement:
      'A plain copy is a fresh base copy: no copied buffs or instance modifications; it does not inherit '
      + 'attachments, granted keywords, learned effects, improved values or counters; it is non-Gilded unless '
      + 'the effect says otherwise. Applicable Auras still affect it, because Auras are global and were not '
      + 'copied from the source.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'A plain copy is a fresh base copy of that card.' }],
  },
  {
    id: 'R-COPY-02',
    title: 'Exact copies',
    statement:
      'An exact copy is literally an exact copy of the current card instance: it retains all buffs, effects, '
      + 'attachments, granted keywords, improved values, learned effects, counters and other card-owned state. '
      + 'Engine-owned pending events, callbacks and queue bookkeeping are NOT part of the card instance and '
      + 'must not be duplicated. Any uncertain field boundary is surfaced for an owner ruling.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'An exact copy is literally an exact copy of the current card instance.' }],
  },
  {
    id: 'R-AURA-01',
    title: 'Auras are global modifiers',
    statement:
      'An Aura is a global modifier affecting an eligible type, card or population wherever the Aura defines. '
      + 'Auras can affect existing and future eligible cards. Plain copies remain plain but receive any '
      + 'independently applicable Aura. Every Aura contract must state its zone coverage and lifetime. '
      + '`Aura` becomes explicit keyword terminology once approved wording is wired.',
    domain: 'auras',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'An Aura is a global modifier affecting an eligible type, card, or population wherever the Aura defines.' }],
  },
];
