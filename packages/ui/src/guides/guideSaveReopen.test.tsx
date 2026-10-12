// @vitest-environment jsdom
/**
 * SAVE, REOPEN, SAVE AGAIN: the editor over the REAL seam (`guidesRemote.ts`). The other editor tests replace the whole
 * seam with a double that hands back a ready-made guide, so they cannot see how the seam reads the function's answer.
 * Here only the Supabase client is a double, and it answers what `guide-write` really answers: the stored row already
 * read into a `GuideRecord` (packages/guides/src/server.ts).
 *
 * Pins: a guide whose art icon is not its first Core card, and that has a "pairs with" tribe, keeps both when it is
 * saved, opened for Edit from the list, and saved again untouched. (Read with the wrong reader, the first save came
 * back with no icon and no "pairs with", and the second save wrote that loss to the server.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { SETS } from '@game/content';
import { parseGuideRecord } from '@game/guides';
import { mount, type Mounted } from '../renderedText.mount';
import type { GuideDraftInput } from './guidesRemote';

const ROW = '44444444-4444-4444-8444-444444444444';
const SOURCE = '55555555-5555-4555-8555-555555555555';
const sent: GuideDraftInput[] = [];
let revision = 0;

/** The row the server stores for a saved document, as the SQL writes it. */
const rowOf = (doc: GuideDraftInput): Record<string, unknown> => ({
  id: doc.id ?? ROW, slug: null, author_id: 'u-1', byline: doc.byline, official: doc.official, published: false, hidden: false, sets: doc.sets,
  tribes: doc.tribes, pairs_with: doc.pairsWith, icon_card: doc.iconCard, title: doc.title, tagline: doc.tagline, body: doc.body, core: doc.core,
  enablers: doc.enablers, mentions: doc.mentions, aliases: doc.aliases, forked_from: SOURCE, forked_title: 'The source', forked_byline: 'Team Ascent',
  bookmark_count: 0, sort_order: 5, revision, created_at: '2026-10-12T10:00:00.000Z', updated_at: '2026-10-12T11:00:00.000Z',
});

vi.mock('../remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../remoteBoards')>()),
  supabaseClient: () => ({
    functions: {
      invoke: async (_fn: string, opts: { body: { op: string; guide: GuideDraftInput } }) => {
        const doc = JSON.parse(JSON.stringify(opts.body.guide)) as GuideDraftInput;
        sent.push(doc);
        revision += 1;
        // Exactly the function's answer: `{ guide: parseGuideRecord(row) }`, as JSON text.
        return { data: JSON.parse(JSON.stringify({ guide: parseGuideRecord(rowOf(doc)) })) as unknown, error: null };
      },
    },
  }),
}));

const { GuideEditor } = await import('./GuideEditor');
const { canEditGuide } = await import('./guides');
const { draftFromGuide, emptyDraft } = await import('./guideDrafts');
const { resetGuidesForTests, useGuides } = await import('./guidesStore');
const { currentIdentity, setIdentity } = await import('../identity');

let ui: Mounted | null = null;
let closed = 0;
const prevIdentity = currentIdentity();
const open = (initial: ReturnType<typeof emptyDraft>): HTMLElement => {
  ui = mount(<GuideEditor initial={initial} setId="set2" tribes={SETS.set2.tribes} run={undefined} userId="u-1" canBeOfficial={false} onClose={() => { closed++; }} />);
  return ui.container;
};
const press = async (c: HTMLElement, text: string): Promise<void> => {
  const b = [...c.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(() => {
  localStorage.clear();
  resetGuidesForTests();
  setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.test' });
  sent.length = 0;
  revision = 0;
  closed = 0;
});
afterEach(() => { ui?.unmount(); ui = null; setIdentity(prevIdentity); resetGuidesForTests(); });

describe('a guide saved, opened for Edit from the list, and saved again untouched', () => {
  it('keeps its art icon and its "pairs with", and the stored guide is whole', async () => {
    expect(SETS.set2.tribes).toEqual(expect.arrayContaining(['beast', 'dwarf']));
    const first = { ...emptyDraft('Mike'), title: 'Icon is not first', body: 'Words.', tribes: ['beast' as const], pairsWith: ['dwarf' as const], core: ['grim', 'b2_sunmane'], iconCard: 'b2_sunmane' };
    await press(open(first), 'Save');
    expect(closed).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ iconCard: 'b2_sunmane', pairsWith: ['dwarf'], core: ['grim', 'b2_sunmane'] });

    // The stored guide is what the list draws and what Edit opens.
    const stored = useGuides.getState().mine;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ rowId: ROW, authorId: 'u-1', iconCard: 'b2_sunmane', pairsWith: ['dwarf'], forkedTitle: 'The source', forkedByline: 'Team Ascent', order: 5, revision: 1 });
    expect(canEditGuide(stored[0]!, 'u-1', false)).toBe(true); // its author still gets an Edit button

    ui!.unmount();
    await press(open(draftFromGuide(stored[0]!)), 'Save');
    expect(closed).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ id: ROW, revision: 1 });
    expect(sent[1]!.iconCard).toBe(sent[0]!.iconCard);
    expect(sent[1]!.pairsWith).toEqual(sent[0]!.pairsWith);
    expect(useGuides.getState().mine[0]).toMatchObject({ iconCard: 'b2_sunmane', pairsWith: ['dwarf'], revision: 2 });
  });
});
