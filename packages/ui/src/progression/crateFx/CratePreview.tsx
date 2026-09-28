import { useEffect, useRef, useState } from 'react';
import { COSMETICS, type OpenCrateResult } from '@game/progression';
import { CrateOpener, type CrateQueueItem } from '../CrateOpener';
import type { CrateOpenOutcome } from '../progressionStore';
import { CRATE_FX_PLAY_EVENT, CRATE_RARITIES, type CrateFxPlayDetail, type CrateFxPlayMode, type CrateRarity } from './crateFxConfig';

/**
 * DEV: the Crate opening tuner's sandbox. Its Play buttons open a PRACTICE crate in the real theatre with a local
 * fake answer: nothing is sent to the server, nothing is spent, and no reward is added to the account. Renders
 * nothing until a Play is pressed; mounted in DEV builds only (Game.tsx).
 */

/** A crate title of that rarity from the catalog, for the practice reward. */
export function previewRewardFor(rarity: CrateRarity): string {
  const hit = COSMETICS.find((c) => c.category === 'title' && c.rarity === rarity && c.acquisition.type === 'crate');
  return hit?.id ?? 'title_wanderer';
}

/** The local fake answer for one practice crate (never the server). */
export function previewOutcome(crateId: string, earnedLevel: number, rarity: CrateRarity | null): CrateOpenOutcome {
  if (!rarity) return { status: 'error', reason: 'preview_failure' };
  const rewardId = previewRewardFor(rarity);
  const result: OpenCrateResult = {
    status: 'opened', rewardId, sealedRemaining: 0,
    crate: { crateId, earnedLevel, state: 'opened', rewardId, earnedAt: null, openedAt: null },
  };
  return { status: 'ok', result };
}

interface Session { key: number; queue: CrateQueueItem[]; rarities: Record<string, CrateRarity | null>; delayMs: number; openAll: boolean }

function sessionFor(mode: CrateFxPlayMode, key: number, last: CrateRarity): Session {
  if (mode === 'all') {
    const queue = CRATE_RARITIES.map((r, i) => ({ crateId: `preview-${key}-${i}`, earnedLevel: i + 2 }));
    return { key, queue, rarities: Object.fromEntries(queue.map((q, i) => [q.crateId, CRATE_RARITIES[i]!])), delayMs: 250, openAll: true };
  }
  const rarity: CrateRarity | null = mode === 'fail' ? null : mode === 'slow' ? 'rare' : mode === 'replay' ? last : mode;
  const crateId = `preview-${key}`;
  return { key, queue: [{ crateId, earnedLevel: 5 }], rarities: { [crateId]: rarity }, delayMs: mode === 'slow' ? 3000 : mode === 'fail' ? 1400 : 250, openAll: false };
}

export function CratePreview(): JSX.Element | null {
  const [session, setSession] = useState<Session | null>(null);
  const last = useRef<CrateRarity>('legendary');
  const n = useRef(0);

  useEffect(() => {
    const onPlay = (e: Event): void => {
      const mode = (e as CustomEvent<CrateFxPlayDetail>).detail?.mode ?? 'replay';
      if ((CRATE_RARITIES as readonly string[]).includes(mode)) last.current = mode as CrateRarity;
      n.current += 1;
      setSession(sessionFor(mode, n.current, last.current));
    };
    window.addEventListener(CRATE_FX_PLAY_EVENT, onPlay);
    return () => window.removeEventListener(CRATE_FX_PLAY_EVENT, onPlay);
  }, []);

  if (!session) return null;
  const open = (crateId: string): Promise<CrateOpenOutcome> => new Promise((resolve) => {
    const item = session.queue.find((q) => q.crateId === crateId);
    window.setTimeout(() => resolve(previewOutcome(crateId, item?.earnedLevel ?? 1, session.rarities[crateId] ?? null)), session.delayMs);
  });
  return (
    <CrateOpener
      key={session.key}
      queue={session.queue}
      autoOpen
      openAll={session.openAll}
      open={open}
      onClose={() => setSession(null)}
    />
  );
}
