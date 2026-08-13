import { useEffect, useState } from 'react';
import { createCssTunerStore } from './cssTunerStore';
import { useGame } from './store';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for the RUNEFORGE BACKDROP — the illustration behind the forge overlay (`.forge-ov` in
 * styles.css, rendered by `Recruit.tsx`). Both forge menus share it: the normal and the Epic Runeforge are the
 * same element, and `.forge-epic` only re-tones the banner and accents.
 *
 * WHY IT COMPOSES CSS rather than owning a config module. The backdrop is ONE `background` shorthand — a scrim
 * gradient layered over `url(...)` with a size and a position — so every control here is an ingredient of a
 * single declaration, not a var of its own. That is exactly the case `cssTunerStore` exists for, and it is the
 * same shape the charge glyph uses.
 *
 * IT PERSISTS (like the charge glyph, unlike the frame/palette panels). Placing art by eye is done in passes
 * against a panel you have to re-open each time, so losing the values to a reload costs a real session. Reset
 * returns the shipped look, and "Copy CSS" emits the undoubled rule to paste back into `styles.css`.
 *
 * FIT vs ZOOM. `cover` and `contain` are the two CSS answers and they ignore the zoom slider entirely — cover
 * fills the overlay and crops, contain fits the whole image and may letterbox. `zoom` is the third mode, where
 * the slider sets the image's HEIGHT as a percentage of the overlay and the width follows the aspect ratio, so
 * you can push past cover to crop in on part of the illustration. The position sliders work in all three, but
 * only bite when there is overflow to slide (i.e. not under `contain` on a matching aspect).
 */
interface ForgeBgVals {
  fit: string;      // 'cover' | 'contain' | 'zoom' — see the FIT vs ZOOM note above
  zoom: number;     // % of the overlay's HEIGHT, `fit: zoom` only
  posX: number;     // % — 0 shows the image's left edge, 100 its right
  posY: number;     // %
  scrim: number;    // opacity of the dark layer ON TOP of the art
  [k: string]: number | string;
}

/** MIRRORS the shipped `.forge-ov` rule in styles.css — so Reset returns you to what players see. */
const DEFAULTS: ForgeBgVals = {
  fit: 'cover',
  zoom: 100,
  posX: 50,
  posY: 50,
  scrim: 0.72,
};

const num = (v: ForgeBgVals, k: string): number => Number(v[k]);

/** The `background-size` term. `zoom` drives HEIGHT and lets width follow, so the art never distorts. */
const sizeTerm = (v: ForgeBgVals): string => (v.fit === 'zoom' ? `auto ${num(v, 'zoom')}%` : String(v.fit));

/** The full shorthand: the scrim gradient must stay the FIRST layer — CSS paints layer one on top, and that is
 *  what keeps the engraved banner and the rune tablets readable over the illustration. */
const bg = (v: ForgeBgVals): string => {
  const s = num(v, 'scrim');
  return `linear-gradient(rgba(14, 16, 22, ${s}), rgba(14, 16, 22, ${s})), `
    + `url('/runeforgebg2.webp') ${num(v, 'posX')}% ${num(v, 'posY')}% / ${sizeTerm(v)} no-repeat`;
};

const store = createCssTunerStore<ForgeBgVals>({
  styleId: 'runeforgebgtuner',
  defaults: DEFAULTS,
  storageKey: 'ascent.runeforgeBgTuner',
  css: (v) => `.forge-ov.forge-ov { background: ${bg(v)}; }`,
});

const copyCss = (): string =>
  `/* Runeforge backdrop — bake into styles.css, replacing the .forge-ov rule */\n`
  + `.forge-ov {\n  background: ${bg(store.get())};\n}`;

const controls: TunerControl<string>[] = [
  {
    key: 'fit', label: 'Fit', group: 'Size', kind: 'select', options: ['cover', 'contain', 'zoom'],
    hint: 'cover fills the overlay and crops; contain fits the whole image and may letterbox; zoom hands sizing to the slider below.',
    min: 0, max: 0, step: 0,
  },
  {
    key: 'zoom', label: 'Zoom', unit: '%', group: 'Size', min: 40, max: 260, step: 1,
    hint: "The image's height as a percentage of the overlay — width follows the aspect ratio, so the art never stretches.",
    note: 'Only applies when Fit is set to zoom.',
  },
  {
    key: 'posX', label: 'Horizontal position', unit: '%', group: 'Position', min: 0, max: 100, step: 1,
    hint: 'Which part of the image sits in view across — 0 pins its left edge, 100 its right. No effect when there is nothing to crop.',
  },
  {
    key: 'posY', label: 'Vertical position', unit: '%', group: 'Position', min: 0, max: 100, step: 1,
    hint: 'The same, up and down — lower values bring the top of the illustration into view.',
  },
  {
    key: 'scrim', label: 'Scrim', unit: 'opacity', group: 'Readability', min: 0, max: 1, step: 0.01,
    hint: 'The dark layer painted OVER the art. 0 shows the illustration raw; higher values buy back contrast for the engraved banner and the rune tablets.',
  },
];

/**
 * The preview harness. The Runeforge only opens on its own wave, so there is no way to judge any of this
 * without forcing it on screen — and the backdrop is the whole subject of the panel.
 *
 * It POKES RUN STATE, which nothing else about a tuner does, so it is careful about putting it back: the
 * previous offer is captured on the way in and restored when the toggle goes off or the panel closes. Without
 * that, closing the panel would leave a fabricated forge offer sitting in a real run.
 */
function ForgePreview(): JSX.Element {
  const [forced, setForced] = useState(false);
  const [epic, setEpic] = useState(false);
  const [noRun, setNoRun] = useState(false);

  useEffect(() => {
    const run = useGame.getState().run;
    if (!run) { setNoRun(true); return; }
    if (!forced) return;
    const prevOffer = run.runeforgeOffer;
    const prevEpic = run.runeforgeEpic;
    useGame.setState({ run: { ...run, runeforgeOffer: ['rune_warding'], runeforgeEpic: epic } });
    return () => {
      const cur = useGame.getState().run;
      if (cur) useGame.setState({ run: { ...cur, runeforgeOffer: prevOffer, runeforgeEpic: prevEpic } });
    };
  }, [forced, epic]);

  return (
    <div className="tuner-previews tuner-harness">
      <div className="lunge-btns">
        <button
          className="sfxmix-copy"
          onClick={() => setForced((f) => !f)}
          title="Opens the real Runeforge over the board so the backdrop can be judged in place. The offer is put back when you turn this off or close the panel."
          disabled={noRun}
        >
          {forced ? 'Close the forge' : 'Open the forge'}
        </button>
        <button
          className="sfxmix-copy"
          onClick={() => setEpic((e) => !e)}
          title="The Epic Runeforge is the same element with re-toned accents — worth a look, since it shares this backdrop."
          disabled={noRun || !forced}
        >
          {epic ? 'Showing Epic' : 'Showing Basic'}
        </button>
      </div>
      {noRun && <div className="sfxmix-name">Start a run first — the forge needs one to open over.</div>}
    </div>
  );
}

export const SPEC: TunerSpec<ForgeBgVals> = {
  id: 'runeforgebg',               // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Runeforge Backdrop',
  note: 'dev · live · persists',
  read: store.get,
  write: store.set,
  writeColor: store.set,           // the schema's string channel — carries the `fit` select
  reset: store.reset,
  defaults: DEFAULTS,
  controls,
  readout: () => <ForgePreview />,
  copy: copyCss,
  copyLabel: 'Copy CSS',
};

export function RuneforgeBgTuner(): JSX.Element {
  useEffect(store.mount, []);
  return <TunerPanel spec={SPEC} />;
}
