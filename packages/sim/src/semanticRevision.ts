/**
 * SEMANTIC REVISION (§16) — the one-string identity of the environment a QA verdict was produced under
 * (docs/docbot2/canonical-schemas.md §5):
 *
 *     <buildSha>.<contentRev>.<rulesRev>.<schemaRev>
 *
 *   · buildSha    — the build commit (caller-supplied: `__BUILD_SHA__` on the client, `git rev-parse
 *                   --short HEAD` in tools, 'dev' when unknown). A parameter, not an import — this module
 *                   stays pure and environment-free.
 *   · contentRev  — `contentRevision()` from @game/content: the real per-definition FNV-1a hash over every
 *                   card + rune + quest. First QA consumer of revisions.ts (it was previously telemetry-only).
 *   · rulesRev    — `rulesRevision()` from @game/rules: the resolved-rulebook hash (rules + decisions).
 *   · schemaRev   — the QA schema versions, spelled out so a bump is a visible diff:
 *                   qa1 (QaScenarioV1) · b1 (BUG_REPORT_SCHEMA_VERSION) · r2 (ReplayV2) · m32 (mulberry32).
 *                   The contract-registry rev is appended when WP B lands; the language-guide rev with WP E.
 *
 * BUNDLE HYGIENE — deliberately NOT exported from the @game/sim public entrypoint. This module pulls the
 * whole rules registry (pure data) through @game/rules; exporting it from index.ts would ride that data
 * into the web bundle (the exact trap the docbot ratchetScan duplication exists to avoid — current-state
 * map D-2). QA lanes and tools import it by path; the client keeps stamping its own components.
 */
import { contentRevision } from '@game/content';
import { rulesRevision } from '@game/rules';

/** The QA schema-version component. Bump the matching token in the same PR as the schema change. */
export const QA_SCHEMA_REV = 'qa1.b1.r2.m32';

/** Compose the §16 identity. Pure and deterministic for a given build/content/rules state. */
export function semanticRevision(buildSha = 'dev'): string {
  return `${buildSha}.${contentRevision()}.${rulesRevision()}.${QA_SCHEMA_REV}`;
}

/** The identity split into its comparable components — what a drift report diffs component-wise
 *  ("content moved / rules moved / build moved") instead of a bare string mismatch. */
export function semanticRevisionParts(buildSha = 'dev'): {
  buildSha: string; contentRev: string; rulesRev: string; schemaRev: string;
} {
  return { buildSha, contentRev: contentRevision(), rulesRev: rulesRevision(), schemaRev: QA_SCHEMA_REV };
}
