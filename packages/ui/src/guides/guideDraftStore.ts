/**
 * GUIDES: the one in-progress guide kept on this device. A per-viewer convenience only (it lives in this browser's
 * storage, which can be empty or can throw): closing the Compendium mid-edit, a crash or a refused save does not
 * lose the author's text, and the Guides tab offers it back. The saved guide itself always lives on the server.
 */
import type { EditorDraft } from './guideDrafts';

const KEY = 'ascent.guideDraft';

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

export function saveLocalDraft(userId: string, draft: EditorDraft): void {
  try { localStorage.setItem(KEY, JSON.stringify({ userId, draft })); } catch { /* storage unavailable: nothing to keep */ }
}

/** The kept draft, only for the account that wrote it. */
export function loadLocalDraft(userId: string): EditorDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { userId?: unknown; draft?: unknown };
    return o && o.userId === userId ? asDraft(o.draft) : null;
  } catch {
    return null;
  }
}

export function clearLocalDraft(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
