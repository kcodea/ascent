import { TITLE_TEXT_DEFAULTS, getTitleText, resetTitleTextConfig, setTitleTextValue, type TitleTextConfig } from './titleTextConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for the FRONT-PAGE COPY — every string on the title screen, editable in place. Type into a
 * field and press Enter (or click away) to commit; the title screen re-renders immediately behind the panel.
 *
 * Unlike the other tuners these are React strings, not CSS variables — so there is no CSS fallback to paste
 * back. SHIPPING a wording means pasting the values into `DEFAULTS` in `titleTextConfig.ts`. Until then the
 * change lives in localStorage: yours only, invisible to the other dev and to the packaged exe.
 */
const SPECS: Record<keyof TitleTextConfig, [string, string]> = {
  wordmark:       ['Wordmark', 'The big ASCENT title under the crest.'],
  play:           ['Play button', 'The primary menu plaque that starts a run.'],
  continueLabel:  ['Continue button', 'Shown only when a saved run exists.'],
  continueNote:   ['Continue sub-line', 'The small line under Continue. `{round}` is replaced with the saved run’s round number — keep it if you want the number.'],
  career:         ['Career button', 'Opens your run history and career stats.'],
  leaderboard:    ['Leaderboard button', 'Opens the global rating ladder.'],
  champions:      ['Hall of Champions button', 'Opens the champions gallery.'],
  settings:       ['Settings button', 'Opens the settings screen.'],
  namePrompt:     ['Name prompt', 'The placeholder on the name button before a player has set one.'],
};

/** Declaration order IS render order — wordmark first, then the plaques top-to-bottom as they appear. */
const ORDER: (keyof TitleTextConfig)[] = [
  'wordmark', 'play', 'continueLabel', 'continueNote',
  'career', 'leaderboard', 'champions', 'settings', 'namePrompt',
];

const controls: TunerControl<Extract<keyof TitleTextConfig, string>>[] = ORDER.map((key) => {
  const [label, hint] = SPECS[key];
  return {
    key, label, hint, kind: 'text' as const,
    placeholder: TITLE_TEXT_DEFAULTS[key],
    maxLength: key === 'wordmark' ? 24 : 40,
    // Ranges are unused by a text control but the shared schema requires them.
    min: 0, max: 0, step: 1,
  };
});

export const SPEC: TunerSpec<TitleTextConfig> = {
  id: 'titletext',                  // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Title Text',
  note: 'dev · live · strings',
  read: getTitleText as unknown as TunerSpec<TitleTextConfig>['read'],
  // Numeric `write` is never called: every control here is `kind: 'text'`, which routes through `writeColor`
  // (the schema's string channel). Present because the spec requires it.
  write: () => { /* text-only panel */ },
  writeColor: (key, value) => setTitleTextValue(key as keyof TitleTextConfig, value),
  reset: resetTitleTextConfig,
  defaults: TITLE_TEXT_DEFAULTS as unknown as TunerSpec<TitleTextConfig>['defaults'],
  controls,
};

export function TitleTextTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
