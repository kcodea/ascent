/**
 * @game/rules/contracts — the ContentContract v1 registry (Doc Bot 2.0 WP B).
 *
 * Deliberately a SEPARATE entrypoint from '@game/rules': the extracted registry is large (one draft per
 * active content object) and must not ride the rulebook import into the web bundle. UI code never imports
 * this path; sim/tools do.
 *
 * Two tiers, one API (§4.6 — generated ≠ curated):
 *  · CURATED_CONTRACTS   — hand-maintained (contracts/curated/), never regenerated.
 *  · EXTRACTED_CONTRACTS — rewritten by `npm run contracts:extract`; every entry visibly
 *                          `reviewStatus: 'extracted'` (or 'needs-review') with extraction provenance.
 *
 * `allContracts()` merges with CURATED WINNING: a generated row can never shadow or overwrite a curated
 * contract, even if the extractor misbehaves — the merge is the last line of defence behind the
 * extractor's own exclusion and the integrity test.
 */
import type { ContentContract } from './schema';
import { CURATED_CONTRACTS, CURATED_CONTRACT_IDS } from './curated';
import { EXTRACTED_CONTRACTS } from './extracted.generated';

export * from './schema';
export { CURATED_CONTRACTS, CURATED_CONTRACT_IDS } from './curated';
export { EXTRACTED_CONTRACTS } from './extracted.generated';

/** The merge law, pure and sabotage-testable: curated wins on id collision, ALWAYS — a rogue generated row
 *  can never shadow a hand-authored contract. Deterministic order: curated first (hand order), then
 *  extracted (already sorted by contentId by the generator). */
export function mergeContracts(
  curated: readonly ContentContract[],
  extracted: readonly ContentContract[],
): ContentContract[] {
  const curatedIds = new Set(curated.map((c) => c.contentId));
  return [...curated, ...extracted.filter((c) => !curatedIds.has(c.contentId))];
}

/** Every contract, curated winning on id collision. */
export function allContracts(): ContentContract[] {
  return mergeContracts(CURATED_CONTRACTS, EXTRACTED_CONTRACTS);
}

export function contractIndex(): Readonly<Record<string, ContentContract>> {
  return Object.fromEntries(allContracts().map((c) => [c.contentId, c]));
}
