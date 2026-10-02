import { useState } from 'react';
import { devUnlockAllOn, setDevUnlockAll } from './progression/progressionStore';
import { SPEC } from './progression/crateFx/crateFxConfig';
import { TunerPanel } from './TunerPanel';
import { devGrantPortraitFrame, devPreviewHeroTitles } from './progression/progressionStore';

/** HERO TITLES (owner 2026-09-29): preview owning them on this client (in memory; never saved or sent). Kept here, not
 *  in crateFxConfig, so the crate config module stays free of the progression store. */
const SPEC_WITH_TITLE_PREVIEW = {
  ...SPEC,
  actions: [
    ...(SPEC.actions ?? []),
    { label: 'Preview: hero titles', hint: 'Own every hero title on this client and wear Warded, to check the Career header, the Collection and the Achievements tab. In memory only: never saved or sent.', run: () => devPreviewHeroTitles('titles') },
    { label: 'Preview: master titles', hint: 'Own every hero title and its golden master on this client and wear the Warded master plate. In memory only: never saved or sent.', run: () => devPreviewHeroTitles('masters') },
    { label: 'Preview: clear titles', hint: 'Put back the saved account (undo the title previews).', run: () => devPreviewHeroTitles('clear') },
    // PORTRAIT FRAMES (owner 2026-10-01: "put a test frame in the collections, and set it to the gold one"): a local
    // grant, then equip it in Collection > Portrait Frames. Never sent; survives a reload until cleared.
    { label: 'Dev: grant Gilded frame', hint: 'Own the Gilded frame (the gold portrait frame) on this client only, then equip it in Collection > Portrait Frames. Equip and Use default frame work locally. Never sent to the server.', run: () => devGrantPortraitFrame('frame_gold') },
    { label: 'Dev: clear frame grants', hint: 'Drop every dev-granted portrait frame and put back the saved account.', run: () => devGrantPortraitFrame('clear') },
  ],
};

/**
 * DEV tuner for the CRATE OPENING (owner ask 2026-09-28: "put a tuner in for it to test it"): every beat per
 * rarity, the particle counts, shake, flash, rings, rays, colours and sound cues. The ▶ buttons open a practice
 * crate in the real theatre with a local fake answer (never the server, nothing spent), plus Replay, a slow
 * server, a failure, Open all, and slow motion. Production always plays the baked defaults.
 */
export function CrateFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC_WITH_DEV_UNLOCK} />;
}

/** UNLOCK EVERYTHING (owner 2026-10-01): own every catalog item on this client; off = the real account again. Rides
 *  the panel's readout slot (above the controls), so it sits with the other progression previews. */
const SPEC_WITH_DEV_UNLOCK = {
  ...SPEC_WITH_TITLE_PREVIEW,
  readout: (): JSX.Element => <>{SPEC_WITH_TITLE_PREVIEW.readout?.()}<DevUnlockAllToggle /></>,
};

function DevUnlockAllToggle(): JSX.Element {
  const [on, setOn] = useState(devUnlockAllOn);
  return (
    <div className="tuner-previews">
      <label className="tuner-preview" aria-label="Own every item in the Collection on this client only, so you can equip and preview anything and see it in game. Equips made while on stay local. Nothing is sent to the server, and opening real crates is paused. Off puts your real account and loadout back exactly.">
        <input type="checkbox" checked={on} onChange={(e) => { setDevUnlockAll(e.target.checked); setOn(devUnlockAllOn()); }} />
        <span>Unlock everything (dev)</span>
      </label>
    </div>
  );
}
