// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../renderedText.mount';
import { GUIDES, type Guide } from './guides';
import { GuideText, guideCardIds, useGuideViews } from './GuideParts';

/**
 * THE READING VIEW LINKS WHOLE NAMES ONLY. A card name or nickname inside a longer word is plain text, the same rule
 * the editor uses when it finds the cards a write-up names (guideDrafts.ts). Once guides are public, a write-up is
 * read by people who did not write it; "imp" must not light up inside "important".
 */
function Probe({ guide }: { guide: Guide }): JSX.Element {
  const ids = guideCardIds(guide);
  const { views, refs } = useGuideViews(ids, undefined);
  return <GuideText guide={guide} ids={ids} views={views} refs={refs} />;
}

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const links = (g: Guide): string[] => {
  ui = mount(<Probe guide={g} />);
  return [...ui.container.querySelectorAll('.lobbyguide-name')].map((e) => e.textContent ?? '');
};
const base = GUIDES[0]!;
const card = base.core[0]!;

describe('card names in a write-up', () => {
  it('a nickname is linked only where it stands alone', () => {
    const g: Guide = { ...base, body: 'An imp is important. Simple: imp, imps, (imp) and IMP.', aliases: { imp: card } };
    expect(links(g)).toEqual(['imp', 'imp', 'imp', 'IMP']);
  });
  it('a nickname next to a digit is not linked', () => {
    const g: Guide = { ...base, body: 'imp2 and 2imp are not it, imp is.', aliases: { imp: card } };
    expect(links(g)).toEqual(['imp']);
  });
  it('text with no names is unchanged', () => {
    const g: Guide = { ...base, body: 'Nothing to see here.', aliases: undefined, mentions: undefined, core: [card], enablers: [] };
    ui = mount(<Probe guide={g} />);
    expect(ui.container.querySelector('.lobbyguide-text')!.textContent).toBe('Nothing to see here.');
  });
});
