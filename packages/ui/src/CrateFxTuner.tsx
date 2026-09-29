import { SPEC } from './progression/crateFx/crateFxConfig';
import { TunerPanel } from './TunerPanel';
import { devPreviewHeroTitles } from './progression/progressionStore';

/** HERO TITLES (owner 2026-09-29): preview owning them on this client (in memory; never saved or sent). Kept here, not
 *  in crateFxConfig, so the crate config module stays free of the progression store. */
const SPEC_WITH_TITLE_PREVIEW = {
  ...SPEC,
  actions: [
    ...(SPEC.actions ?? []),
    { label: 'Preview: hero titles', hint: 'Own every hero title on this client and wear Warded, to check the Career header, the Collection and the Achievements tab. In memory only: never saved or sent.', run: () => devPreviewHeroTitles('titles') },
    { label: 'Preview: master titles', hint: 'Own every hero title and its golden master on this client and wear the Warded master plate. In memory only: never saved or sent.', run: () => devPreviewHeroTitles('masters') },
    { label: 'Preview: clear titles', hint: 'Put back the saved account (undo the title previews).', run: () => devPreviewHeroTitles('clear') },
  ],
};

/**
 * DEV tuner for the CRATE OPENING (owner ask 2026-09-28: "put a tuner in for it to test it"): every beat per
 * rarity, the particle counts, shake, flash, rings, rays, colours and sound cues. The ▶ buttons open a practice
 * crate in the real theatre with a local fake answer (never the server, nothing spent), plus Replay, a slow
 * server, a failure, Open all, and slow motion. Production always plays the baked defaults.
 */
export function CrateFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC_WITH_TITLE_PREVIEW} />;
}
