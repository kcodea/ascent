/**
 * BEAT SYSTEM PR 7 — the beat LIBRARY: browse every registered automatic effect without playing a card.
 *
 * Pure helpers behind the Beat Lab's Library mode: parse the 654 policy-registry entries into rows, derive
 * the draft-override key an entry's edits write to, and build a small SYNTHETIC batch so any entry can be
 * previewed through the real scheduler/player (clearly labeled synthetic — blueprint §16.9).
 */
import { PRESENTATION_POLICIES, type PresentationBatch, type PresentationPolicyEntry } from '@game/core';

export interface LibraryRow {
  key: string;                       // the registry key ('factory:do:trigger' | 'rune:id:phase' | …)
  kindPrefix: string;                // 'factory' | 'rune' | 'quest' | …
  id: string;                        // the middle segment (factory id / rune id / quest id)
  trigger: string;                   // the final segment
  entry: PresentationPolicyEntry;
  /** The sparse-override key this entry's timing edits write to. Rune/quest entries bind their EXACT source
   *  (batches carry the rune/quest id as source.id); factory entries bind their FAMILY (batches carry the
   *  CARD id as the source for minion effects, so a factory can't be source-addressed — its family can). */
  editKey: string;
  /** True when editKey is a family key — the inspector labels the edit's blast radius. */
  editsWholeFamily: boolean;
}

export function libraryRows(): LibraryRow[] {
  const rows: LibraryRow[] = [];
  for (const [key, entry] of Object.entries(PRESENTATION_POLICIES)) {
    const [kindPrefix = '', id = '', trigger = ''] = key.split(':');
    const factory = kindPrefix === 'factory';
    rows.push({
      key, kindPrefix, id, trigger, entry,
      editKey: factory ? `family:${entry.family}` : `source:${kindPrefix}:${id}:${trigger}`,
      editsWholeFamily: factory,
    });
  }
  return rows.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Filter rows by a free-text query (matches key, family, policy) and an optional policy. */
export function filterRows(rows: readonly LibraryRow[], query: string, policy: string | null): LibraryRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (policy && r.entry.policy !== policy) return false;
    if (!q) return true;
    return r.key.toLowerCase().includes(q) || r.entry.family.toLowerCase().includes(q) || r.entry.policy.toLowerCase().includes(q);
  });
}

/**
 * A synthetic preview batch for one library row: the trigger firing twice (so repeat pacing reads) with a
 * stat consequence each — enough to watch the beat's windup/hold/recovery play at real pace on the timeline.
 * SYNTHETIC: fixture uids, not game state; the preview banner says so.
 */
export function fixtureBatch(row: LibraryRow): PresentationBatch {
  const kind = (row.kindPrefix === 'factory' ? 'minion' : row.kindPrefix) as 'minion' | 'rune' | 'quest' | 'spell' | 'hero' | 'system';
  const phase = row.trigger === 'endOfTurn' ? 'endOfTurn' as const : 'recruit' as const;
  const src = { kind, id: row.id, label: `${row.id} (synthetic)` };
  return {
    id: `batch:fixture:${row.key}`,
    actionId: `fixture:${row.key}`,
    phase,
    events: [
      { type: 'sourceTrigger', id: 'fx:t1', sequence: 0, step: 1, phase, source: src, trigger: row.trigger, policy: row.entry.policy, repeatIndex: 0, repeatCount: 2 },
      { type: 'statsChanged', id: 'fx:c1', sequence: 1, step: 1, parentId: 'fx:t1', target: { zone: 'board', uid: 'fixture-a' }, attack: 2, health: 2, permanent: true },
      { type: 'sourceTrigger', id: 'fx:t2', sequence: 2, step: 2, phase, source: src, trigger: row.trigger, policy: row.entry.policy, repeatIndex: 1, repeatCount: 2 },
      { type: 'statsChanged', id: 'fx:c2', sequence: 3, step: 2, parentId: 'fx:t2', target: { zone: 'board', uid: 'fixture-b' }, attack: 2, health: 2, permanent: true },
    ],
  };
}
