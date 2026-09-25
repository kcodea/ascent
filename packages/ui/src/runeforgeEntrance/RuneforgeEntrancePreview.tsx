import { useEffect, useState } from 'react';
import { RUNE_INDEX } from '@game/content';
import { runeArt } from '../art';
import { PixiFxLayer } from '../PixiFxLayer';
import { isPreRun, useGame } from '../store';
import { RuneforgeDialog } from './RuneforgeDialog';
import { RFE_PLAY_EVENT, type RfePlayDetail } from './runeforgeEntranceConfig';

/**
 * THE RUNEFORGE ENTRANCE SANDBOX (DEV only): what the tuner's ▶ Play (Basic) / ▶ Play (Epic) open.
 *
 * The owner asked to "sim" the entrance without playing to the forge turn, so this renders the REAL forge dialog
 * (the same component the live forge uses) over whatever screen is up, with four sample runes (a real forge offers four), and plays the
 * entrance with the current tuner values. Nothing here touches the run: a tablet click or Esc just closes it, and
 * the Re-roll button deals four other samples, which plays the re-roll variant (only the new tablets drop).
 */

/** How many tablets a real Runeforge offers (owner 2026-09-24: "runeforges have 4 options"). */
export const SAMPLE_COUNT = 4;

/** Four sample runes, preferring ones with art, rotating through the pool on each deal. */
export function sampleRunes(epic: boolean, deal: number, count = SAMPLE_COUNT): string[] {
  const all = Object.values(RUNE_INDEX).filter((r) => !!r.epic === epic);
  const withArt = all.filter((r) => !!runeArt(r.id));
  const pool = (withArt.length >= count ? withArt : all).map((r) => r.id).sort();
  if (pool.length === 0) return [];
  const start = (deal * count) % pool.length;
  return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]!).filter((id, i, a) => a.indexOf(id) === i);
}

export function RuneforgeEntrancePreview(): JSX.Element | null {
  const [open, setOpen] = useState<{ epic: boolean; play: number; deal: number } | null>(null);
  // From the TITLE there is no FX canvas (Game mounts `PixiFxLayer` only with the board or the picker), so the
  // dust, embers and flare would silently not play. Mount it here while the preview is open, the same way the rank
  // screen preview does; with a run up the game's own layer is already attached and this stays out.
  const needsFxLayer = useGame((s) => isPreRun(s) && s.heroChoices === null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onPlay = (e: Event): void => {
      const epic = !!(e as CustomEvent<RfePlayDetail>).detail?.epic;
      // A new `play` remounts the dialog, so pressing ▶ again replays the whole opening from the top.
      setOpen((o) => ({ epic, play: (o?.play ?? 0) + 1, deal: o?.deal ?? 0 }));
    };
    window.addEventListener(RFE_PLAY_EVENT, onPlay);
    return () => window.removeEventListener(RFE_PLAY_EVENT, onPlay);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  const offer = sampleRunes(open.epic, open.deal);
  return (
    <>
      {needsFxLayer && <PixiFxLayer />}
      <RuneforgeDialog
        key={open.play}
        className="rfe-preview"
        offer={offer}
        epic={open.epic}
        embers={10}
        rerollSpent={false}
        duplicating={false}
        onBuy={() => setOpen(null)}
        onReroll={() => setOpen((o) => (o ? { ...o, deal: o.deal + 1 } : o))}
      />
      <button className="rfe-preview-close" onClick={() => setOpen(null)}>Close preview (Esc)</button>
    </>
  );
}
