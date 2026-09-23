/**
 * APPROVED RULES — the index. Each rule entered only on an explicit owner ruling, with the ruling cited.
 *
 * The registry is ONE FILE PER DOMAIN (`./<domain>.ts`, split 2026-09-23 from the 2,300-line monolith so
 * two PRs adding a rule stop conflicting on one tail). `APPROVED_RULES` is the concatenation of every domain
 * file in `APPROVED_DOMAIN_ORDER` — a fixed order, so the array is deterministic regardless of when a rule
 * landed. Nothing in the repo may depend on chronological order (the enforcement ratchet sorts; the registry
 * hash sorts by id).
 *
 * TO ADD A RULE: append it to the end of the array in `./<its domain>.ts`. Do not touch this file unless a
 * NEW `RuleDomain` is being introduced — then add it to `RuleDomain` (schema.ts), create `./<domain>.ts`
 * exporting `<DOMAIN>_RULES`, and list it here in BOTH the record and the order. `Record<RuleDomain, …>`
 * makes a missing domain a type error; `approved.test.ts` makes a misfiled rule a test failure.
 *
 * The first five rules (foundation/actions/copying/auras) came verbatim from the owner's Complete Rulebook
 * handoff (Codex, 2026-06-29, `ascent-complete-rulebook-handoff.md` § Confirmed Owner Rulings) — see
 * `./shared.ts` for the locators.
 */
import type { GameRule, RuleDomain } from '../../schema';
import { FOUNDATION_RULES } from './foundation';
import { ACTIONS_RULES } from './actions';
import { ECONOMY_RULES } from './economy';
import { CATEGORIES_RULES } from './categories';
import { TARGETING_RULES } from './targeting';
import { COPYING_RULES } from './copying';
import { GILDING_RULES } from './gilding';
import { TRIGGERS_RULES } from './triggers';
import { MULTIPLIERS_RULES } from './multipliers';
import { ORDERING_RULES } from './ordering';
import { COMBAT_RULES } from './combat';
import { SUMMONING_RULES } from './summoning';
import { KEYWORDS_RULES } from './keywords';
import { AURAS_RULES } from './auras';
import { RANDOMNESS_RULES } from './randomness';
import { PERSISTENCE_RULES } from './persistence';
import { HEROES_RULES } from './heroes';
import { RUNES_RULES } from './runes';
import { GIFTS_RULES } from './gifts';
import { TEXT_RULES } from './text';

/** Every domain's approved rules, keyed by domain. `Record<RuleDomain, …>` = a new domain cannot be forgotten. */
export const APPROVED_BY_DOMAIN: Record<RuleDomain, readonly GameRule[]> = {
  foundation: FOUNDATION_RULES,
  actions: ACTIONS_RULES,
  economy: ECONOMY_RULES,
  categories: CATEGORIES_RULES,
  targeting: TARGETING_RULES,
  copying: COPYING_RULES,
  gilding: GILDING_RULES,
  triggers: TRIGGERS_RULES,
  multipliers: MULTIPLIERS_RULES,
  ordering: ORDERING_RULES,
  combat: COMBAT_RULES,
  summoning: SUMMONING_RULES,
  keywords: KEYWORDS_RULES,
  auras: AURAS_RULES,
  randomness: RANDOMNESS_RULES,
  persistence: PERSISTENCE_RULES,
  heroes: HEROES_RULES,
  runes: RUNES_RULES,
  gifts: GIFTS_RULES,
  text: TEXT_RULES,
};

/** The fixed concatenation order (the `RuleDomain` union's order). `scripts/split-registry.mjs` reads it. */
export const APPROVED_DOMAIN_ORDER: readonly RuleDomain[] = [
  'foundation', 'actions', 'economy', 'categories', 'targeting', 'copying', 'gilding',
  'triggers', 'multipliers', 'ordering', 'combat', 'summoning', 'keywords', 'auras',
  'randomness', 'persistence', 'heroes', 'runes', 'gifts', 'text',
];

export const APPROVED_RULES: GameRule[] = APPROVED_DOMAIN_ORDER.flatMap((d) => [...APPROVED_BY_DOMAIN[d]]);
