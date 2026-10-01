import type { GauntletStage } from '@game/content';

/**
 * Client for the DEV-only `/__gauntlet/stage` endpoint (`apps/web/gauntletStagePlugin.ts`). The Stage Builder
 * always reads from DISK (GET) — the running game keeps its bundled stage data until the dev server restarts.
 * Deep validation (`validateStage`) is the store's job before it calls `saveStage`.
 */

/** Load a stage's JSON straight from disk. Throws with the server's message on failure. */
export async function loadStage(n: number): Promise<GauntletStage> {
  const res = await fetch(`/__gauntlet/stage?number=${encodeURIComponent(String(n))}`);
  const body = (await res.json().catch(() => null)) as (GauntletStage & { error?: string }) | null;
  if (!res.ok || !body || typeof body.error === 'string') {
    throw new Error(body?.error ?? `could not load stage ${n} (HTTP ${res.status})`);
  }
  return body;
}

/** Write a stage back to its file. Never throws — failures come back as `{ ok: false, error }`. */
export async function saveStage(stage: GauntletStage): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/__gauntlet/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; path?: string; error?: string } | null;
    if (res.ok && body?.ok === true && typeof body.path === 'string') return { ok: true, path: body.path };
    return { ok: false, error: body?.error ?? `save failed (HTTP ${res.status})` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
