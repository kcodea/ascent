import { useEffect, useRef, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import { artFor } from '../art';
import type { CardView } from '../Card';
import { PixiFxLayer } from '../PixiFxLayer';
import { discoverFx } from '../pixiFx';
import { isPreRun, useGame } from '../store';
import { DiscoverDialog } from './DiscoverDialog';
import { DCE_PLAY_EVENT } from './discoverEntranceConfig';

/**
 * THE DISCOVER ENTRANCE SANDBOX (DEV only): what the tuner's ▶ Play opens.
 *
 * Renders the REAL Discover dialog (the same component the live Discover uses) over whatever screen is up, with
 * three sample cards, and plays the entrance (and the golden burst behind it) with the current tuner values.
 * Nothing here touches the run: a pick or Esc just closes it.
 */
export const SAMPLE_COUNT = 3;

/** Three sample minions with art, rotating through the pool on each play. */
export function sampleDiscover(deal: number, count = SAMPLE_COUNT): string[] {
  const pool = Object.values(CARD_INDEX)
    .filter((c) => !c.spell && !c.token && c.tier >= 1 && c.tier <= 6 && !!artFor(c.id))
    .map((c) => c.id).sort();
  if (pool.length === 0) return [];
  const step = Math.max(1, Math.floor(pool.length / 7));
  return Array.from({ length: count }, (_, i) => pool[(deal * step * count + i * step) % pool.length]!)
    .filter((id, i, a) => a.indexOf(id) === i);
}

function viewOf(id: string): CardView | null {
  const c = CARD_INDEX[id];
  if (!c) return null;
  return { name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2, universalTribe: !!c.universalTribe, attack: c.attack, health: c.health, keywords: c.keywords, text: c.text, goldenText: c.goldenText, tier: c.tier, spell: !!c.spell, ruby: !!c.ruby };
}

export function DiscoverEntrancePreview(): JSX.Element | null {
  const [play, setPlay] = useState(0);
  const [open, setOpen] = useState(false);
  const burstRef = useRef<HTMLDivElement>(null);
  // From the TITLE there is no FX canvas, so the dust and glints would silently not play. Mount one while open.
  const needsFxLayer = useGame((s) => isPreRun(s) && s.heroChoices === null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onPlay = (): void => { setOpen(true); setPlay((p) => p + 1); };
    window.addEventListener(DCE_PLAY_EVENT, onPlay);
    return () => window.removeEventListener(DCE_PLAY_EVENT, onPlay);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // The live Discover's golden burst, behind the cards, so the preview is the whole opening.
  useEffect(() => {
    const el = burstRef.current;
    if (!open || !el) return;
    void discoverFx.attach(el).then(() => discoverFx.discoverBurst(window.innerWidth / 2, window.innerHeight / 2));
  }, [open, play]);

  if (!open) return null;
  const ids = sampleDiscover(play);
  const cards = ids.map(viewOf).filter((v): v is CardView => !!v);
  return (
    <>
      {needsFxLayer && <PixiFxLayer />}
      <DiscoverDialog
        key={play}
        className="dce-preview"
        ids={ids}
        cards={cards}
        occasion={null}
        burstRef={burstRef}
        onPick={() => setOpen(false)}
      />
      <button className="dce-preview-close" onClick={() => setOpen(false)}>Close preview (Esc)</button>
    </>
  );
}
