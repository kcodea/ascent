/**
 * GUIDES: the in-progress guide kept on this device, ONE PER ACCOUNT. A per-viewer convenience only (it lives in this
 * browser's storage, which can be empty or can throw): closing the Compendium mid-edit, a crash or a refused save does
 * not lose the author's text, and the Guides tab offers it back. The saved guide itself always lives on the server.
 *
 * Each account has a slot of its own (`ascent.guideDraft:<userId>`), so a second account writing a guide on the same
 * device can never overwrite or clear the first account's waiting guide. "One unsaved guide at a time" holds per
 * account. With no account there is no slot.
 */
import type { EditorDraft } from './guideDrafts';

const KEY = 'ascent.guideDraft';
const keyFor = (userId: string): string => `${KEY}:${userId}`;

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A stored value is a draft only if every field the editor reads has the right shape. */
function asDraft(v: unknown): EditorDraft | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const text = ['byline', 'iconCard', 'title', 'tagline', 'body'].every((k) => typeof o[k] === 'string');
  const lists = ['tribes', 'pairsWith', 'core', 'enablers'].every((k) => isStrings(o[k]));
  const aliases = Array.isArray(o.aliases) && o.aliases.every((a) => a && typeof a === 'object'
    && typeof (a as { word?: unknown }).word === 'string' && typeof (a as { card?: unknown }).card === 'string');
  const ids = (o.rowId === null || typeof o.rowId === 'string') && (o.revision === null || typeof o.revision === 'number')
    && (o.forkedFrom === null || typeof o.forkedFrom === 'string') && typeof o.official === 'boolean';
  return text && lists && aliases && ids ? (v as EditorDraft) : null;
}

/** Keep `draft` as `userId`'s one unsaved guide. */
export function saveLocalDraft(userId: string, draft: EditorDraft): void {
  if (!userId) return;
  try { localStorage.setItem(keyFor(userId), JSON.stringify({ userId, draft })); } catch { /* storage unavailable: nothing to keep */ }
}

/** `userId`'s kept draft. Only ever the one that account wrote. */
export function loadLocalDraft(userId: string): EditorDraft | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const o = JSON.parse(raw) as { userId?: unknown; draft?: unknown };
    return o && o.userId === userId ? asDraft(o.draft) : null;
  } catch {
    return null;
  }
}

/** Forget `userId`'s kept draft. No other account's is touched. */
export function clearLocalDraft(userId: string): void {
  if (!userId) return;
  try { localStorage.removeItem(keyFor(userId)); } catch { /* ignore */ }
}
