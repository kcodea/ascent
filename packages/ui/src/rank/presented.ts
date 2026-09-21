/**
 * The PRESENTATION-CONSUMED marker (blueprint §7): which runs' rank celebrations have already played. Kept
 * deliberately SEPARATE from rank state — the rank result is the server's durable fact, this is only "the
 * player has seen it animate". A remount (returning from Rewatch), a reload, or a duplicate confirmation must
 * settle the screen instantly rather than replay a promotion. Best-effort localStorage (the last few run ids)
 * with an in-memory mirror, so a private window still dedupes within the session.
 */
const KEY = 'ascent.rank.presented';
const KEEP = 24;

let memory: string[] | null = null;

function load(): string[] {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    memory = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    memory = [];
  }
  return memory;
}

/** Has this run's rank sequence already been shown? */
export function wasRankPresented(runId: string): boolean {
  return load().includes(runId);
}

/** Record that this run's sequence played (or was skipped) — idempotent. */
export function markRankPresented(runId: string): void {
  const list = load();
  if (list.includes(runId)) return;
  list.push(runId);
  while (list.length > KEEP) list.shift();
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* best-effort */ }
}

/** Tests / DEV preview: forget everything. */
export function resetRankPresented(): void {
  memory = [];
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
