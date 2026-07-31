import { useEffect } from 'react';
import { createCssTunerStore } from './cssTunerStore';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for the COMPENDIUM palette (styles.css "Compendium palette + scale").
 *
 * The book recolours by re-declaring the shared ink/card/line vars scoped to `.book`, so every descendant rule
 * follows and the whole palette is tunable from one place. This panel composes those declarations and applies
 * them live through a `<style>` override; "Copy CSS" emits the block to bake into `styles.css`.
 *
 * The SHIPPED look is the game's standard cream (a blue scheme was tried and reverted, owner call), so the
 * defaults mirror `:root` — opening the panel is a no-op rather than silently re-tinting the book, and Reset
 * returns you to what players see.
 *
 * Two traps this exists to avoid, both hit while hand-picking the navy:
 *  - The panel and header used to mix the GOLD accent into their surface, so a correct colour var still rendered
 *    grey. The overrides here state each surface directly — what you pick is what paints.
 *  - Inverting to a dark surface left the CONTROL CHROME (rail, tabs, Glossary, close, search) pale on pale,
 *    because it reads one shared var. That var is a control here, so the two can never silently disagree again.
 *
 * The panel edits nothing while the Compendium is closed, which was invisible in the old layout — it is now the
 * header note.
 */
interface BookVals {
  card: string; head: string; rail: string; bg2: string; line: string; ink: string; ink3: string;
  grad: number; top: string; depth: number;
}

const DEFAULTS: BookVals = {
  // These MIRROR the shipped values in styles.css — keep them in sync when you bake in new colours.
  card: '#fffdf8',
  head: '#fdf3e2',
  rail: '#f6efe2',
  bg2:  '#efe5d4',
  line: '#e7dcc7',
  ink:  '#2a2017',
  ink3: '#9c8b71',
  grad: 1,
  top: '#fdf6ea',   // the shipped cream panel's subtly warmer top edge
  depth: 16,
};

/**
 * The surface can be a FLAT fill or a GRADIENT (owner request: "give it some depth"). The gradient runs from the
 * top colour DOWN to the surface colour, so the flat pick stays the base and the second colour only lifts the top
 * edge — which is why a falloff of 0 looks identical to flat.
 */
const cssText = (v: BookVals, sel: string): string =>
  `${sel} {\n`
  + `  --card: ${v.card}; --line: ${v.line}; --ink: ${v.ink}; --ink3: ${v.ink3};\n`
  + `  --bg2: ${v.bg2}; --bg3: ${v.bg2};\n`
  + `}\n`
  + `${sel} { background: ${v.grad ? `linear-gradient(180deg, ${v.top} 0%, ${v.card} ${v.depth}%)` : v.card}; }\n`
  + `${sel} .book-head { background: ${v.head}; }\n`
  + `${sel} .book-rail { background: ${v.rail}; }`;

const store = createCssTunerStore<BookVals>({
  styleId: 'booktuner',
  defaults: DEFAULTS,
  css: (v) => cssText(v, '.book.book'),
});

const color = (key: keyof BookVals, label: string, hint: string, group: string): TunerControl<keyof BookVals & string> =>
  ({ key, label, hint, group, kind: 'color', min: 0, max: 0, step: 0 });

const controls: TunerControl<keyof BookVals & string>[] = [
  color('card', 'Surface',        'The panel body behind the cards. Also the colour a gradient surface lands on.', 'Palette'),
  color('head', 'Header bar',     'The bar across the top of the book.', 'Palette'),
  color('rail', 'Side rail',      'The vertical strip of navigation down the side.', 'Palette'),
  color('bg2',  'Buttons + tabs', 'All the control chrome at once: rail buttons, tier tabs, Glossary, Gilded, close, search. Invert the surface without moving this and it goes pale on pale.', 'Palette'),
  color('line', 'Borders',        'Every rule and divider in the book.', 'Palette'),
  color('ink',  'Text',           'Body text.', 'Palette'),
  color('ink3', 'Text, dimmed',   'Secondary text — counts and power blurbs.', 'Palette'),

  {
    key: 'grad', label: 'Gradient surface', group: 'Surface depth', kind: 'toggle',
    hint: 'Whether the panel body fades from a second colour at its top edge instead of being one flat fill.',
    onOffLabels: ['on', 'flat'], min: 0, max: 1, step: 1,
  },
  {
    ...color('top', 'Top colour', 'The colour the surface fades FROM at its top edge.', 'Surface depth'),
    note: 'Only visible while the gradient is on.',
  },
  {
    key: 'depth', label: 'Falloff', unit: '%', group: 'Surface depth',
    hint: 'How far down the panel the top colour reaches before it lands on the surface colour. At 0 the gradient is indistinguishable from flat.',
    note: 'Only visible while the gradient is on.',
    min: 2, max: 100, step: 1,
  },
];

export const SPEC: TunerSpec<BookVals> = {
  id: 'book',                       // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Compendium',
  note: 'dev · open the Compendium to see changes',
  read: store.get,
  write: store.set,
  writeColor: store.set,
  reset: store.reset,
  defaults: DEFAULTS,
  controls,
  // Undoubled selector: the doubling only exists to beat the very rule you are about to replace.
  copy: () => cssText(store.get(), '.book'),
  copyLabel: 'Copy CSS',
};

export function BookTuner(): JSX.Element {
  // The override lives only as long as the panel — a left-behind tint would recolour the book with no visible cause.
  useEffect(store.mount, []);
  return <TunerPanel spec={SPEC} />;
}
