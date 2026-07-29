import { CARD_INDEX, QUEST_INDEX, RUNE_INDEX, poolFor } from '@game/content';
import type { SetId } from '@game/content';
import type { RiftId } from '../config';
import type { RulesIdentity } from './types';

/**
 * WHAT A STORED ARTIFACT WAS PRODUCED UNDER.
 *
 * A replay is `{ seed, heroId, actions }` today, which is sufficient only while content never changes. It does:
 * this month alone cards were renamed, removed, reworked and moved between sets. Re-running an old action log
 * against today's content doesn't fail — it silently produces a different run and reports it as the same one.
 * Every bot fixture, trace, ladder result and lobby save pins this so that can't happen quietly.
 *
 * `rulesHash` deliberately covers CONTENT, not code: the ids and the shape of the active pool. A refactor that
 * changes no card leaves it alone; renaming one card changes it. That is the granularity that decides whether an
 * old artifact still means what it said.
 */

export const BOT_SCHEMA_VERSION = 1;

/** FNV-1a over a canonical string. Small, dependency-free, and stable across runs — which is all this needs. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A digest of the active content. Sorted so it depends on the SET of ids, not on declaration order — moving a
 * card within its file is not a rules change and must not invalidate every stored artifact.
 */
export function rulesHashFor(setId: SetId): string {
  const cards = poolFor(setId).all.map((c) => `${c.id}:${c.tier}:${c.attack}/${c.health}`).sort();
  const runes = Object.keys(RUNE_INDEX).sort();
  const quests = Object.keys(QUEST_INDEX).sort();
  const tokens = Object.values(CARD_INDEX).filter((c) => c.token).map((c) => c.id).sort();
  return hash([cards.join(','), runes.join(','), quests.join(','), tokens.join(',')].join('|'));
}

/** Build stamps, injected by whoever knows them. `sim` deliberately does NOT reach for `import.meta.env` — it
 *  is a Vite global that only exists in the web build, and depending on it here would tie a headless package to
 *  a bundler. The UI passes them down; a test or a CLI gets an honest 'dev'. */
export interface BuildStamps {
  contentVersion?: string;
  buildId?: string;
}

export function currentRulesIdentity(setId: SetId, riftId: RiftId | null = null, stamps: BuildStamps = {}): RulesIdentity {
  return {
    schemaVersion: BOT_SCHEMA_VERSION,
    contentVersion: stamps.contentVersion ?? 'dev',
    buildId: stamps.buildId ?? 'dev',
    setId,
    riftId,
    rulesHash: rulesHashFor(setId),
  };
}

export interface IdentityMismatch {
  field: keyof RulesIdentity;
  stored: string | number | null;
  current: string | number | null;
}

/**
 * Compare a stored identity against now. Returns every mismatch rather than a boolean, so a caller can report
 * WHAT drifted — "this fixture was recorded under a different card pool" is actionable; "incompatible" is not.
 *
 * `buildId` and `contentVersion` are informational and deliberately NOT compared: they change on every build,
 * and failing on them would make every artifact stale within a day. The load-bearing fields are the schema, the
 * set, the rift and the content hash.
 */
export function identityMismatches(stored: RulesIdentity, current: RulesIdentity): IdentityMismatch[] {
  const out: IdentityMismatch[] = [];
  const check = (field: keyof RulesIdentity): void => {
    if (stored[field] !== current[field]) {
      out.push({ field, stored: (stored[field] ?? null) as string | number | null, current: (current[field] ?? null) as string | number | null });
    }
  };
  check('schemaVersion');
  check('setId');
  check('riftId');
  check('rulesHash');
  return out;
}

/** Throw with a diagnostic naming what drifted. Loading an unsupported artifact must fail loudly, never load
 *  under today's rules and pretend it is the same thing. */
export function assertIdentity(stored: RulesIdentity, current: RulesIdentity): void {
  const bad = identityMismatches(stored, current);
  if (bad.length === 0) return;
  const detail = bad.map((m) => `${m.field}: stored ${String(m.stored)} vs current ${String(m.current)}`).join('; ');
  throw new Error(`This artifact was produced under different rules and cannot be replayed as-is — ${detail}`);
}
