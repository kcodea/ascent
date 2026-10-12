import { describe, expect, it } from 'vitest';
import { guideBodyTooLarge, handleGuideWrite, type RpcCall } from './server';
import { GUIDE_LIMITS } from './types';

const UID = '00000000-0000-0000-0000-00000000000b';
const GID = '11111111-1111-4111-8111-111111111111';
const good = {
  byline: 'Mike', sets: ['set2'], tribes: ['beast'], pairsWith: [], iconCard: 'grim', title: 'A title', tagline: '',
  body: 'A body.', core: ['grim'], enablers: [], mentions: [], aliases: {},
};
const row = { id: GID, title: 'A title', body: 'A body.', icon_card: 'grim', core: ['grim'], revision: 1, byline: 'Mike' };

/** A fake service-role RPC that records what it was asked. */
function fake(answer: { data?: unknown; error?: { message: string } | null } | (() => never) = { data: row, error: null }): { rpc: RpcCall; calls: Array<{ fn: string; args: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc: RpcCall = async (fn, args) => {
    calls.push({ fn, args });
    if (typeof answer === 'function') return answer();
    return { data: answer.data ?? null, error: answer.error ?? null };
  };
  return { rpc, calls };
}

describe('handleGuideWrite: who', () => {
  it('no verified user is 401; a guest is 403 sign_in_required; neither touches the database', async () => {
    const f = fake();
    expect(await handleGuideWrite(null, false, { op: 'save', guide: good }, f.rpc)).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    expect(await handleGuideWrite(UID, true, { op: 'save', guide: good }, f.rpc)).toEqual({ status: 403, body: { error: 'sign_in_required' } });
    expect(f.calls).toEqual([]);
  });
  it('a body that is not an object, or names no known op, is 400', async () => {
    const f = fake();
    expect((await handleGuideWrite(UID, false, 'nope', f.rpc)).body).toEqual({ error: 'bad_body' });
    expect((await handleGuideWrite(UID, false, { op: 'publishEverything' }, f.rpc)).body).toEqual({ error: 'bad_op' });
    expect(f.calls).toEqual([]);
  });
});

describe('guideBodyTooLarge', () => {
  it('measures UTF-8 bytes: exactly the ceiling passes, one more fails', () => {
    expect(guideBodyTooLarge('a'.repeat(GUIDE_LIMITS.bodyBytes))).toBe(false);
    expect(guideBodyTooLarge('a'.repeat(GUIDE_LIMITS.bodyBytes + 1))).toBe(true);
  });
  it('a body of 3-byte characters is too large even though its length is well under the limit', () => {
    const cjk = String.fromCharCode(0x4e2d).repeat(Math.floor(GUIDE_LIMITS.bodyBytes / 3) + 1);
    expect(cjk.length).toBeLessThan(GUIDE_LIMITS.bodyBytes);
    expect(guideBodyTooLarge(cjk)).toBe(true);
  });
});

describe('handleGuideWrite: never throws', () => {
  it('a guide whose getter throws is a 500 guide_failed and makes no rpc call', async () => {
    const f = fake();
    const logged: string[] = [];
    const evil = Object.defineProperty({}, 'title', { enumerable: true, get() { throw new Error('boom'); } });
    const res = await handleGuideWrite(UID, false, { op: 'save', guide: evil }, f.rpc, (m) => logged.push(m));
    expect(res).toEqual({ status: 500, body: { error: 'guide_failed' } });
    expect(f.calls).toEqual([]);
    expect(logged).toEqual(['guide-write threw']);
  });
});

describe('handleGuideWrite: save', () => {
  it('passes the caller from the token and the cleaned document to guide_save, and returns the saved guide', async () => {
    const f = fake();
    const res = await handleGuideWrite(UID, false, { op: 'save', guide: { ...good, title: '  A   title ', authorId: 'someone-else' } }, f.rpc);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.fn).toBe('guide_save');
    expect(f.calls[0]!.args.p_user).toBe(UID);
    expect(f.calls[0]!.args.p_doc).toMatchObject({ title: 'A title', icon_card: 'grim', official: false });
    expect(f.calls[0]!.args.p_doc).not.toHaveProperty('authorId');
    expect(res).toMatchObject({ status: 200, body: { guide: { id: GID, title: 'A title' } } });
  });
  it('a draft over a limit is 422 bad_guide with the field, before the database', async () => {
    const f = fake();
    expect(await handleGuideWrite(UID, false, { op: 'save', guide: { ...good, title: 'x'.repeat(41) } }, f.rpc)).toEqual({ status: 422, body: { error: 'bad_guide', field: 'title' } });
    expect(f.calls).toEqual([]);
  });
  it('blocked text and a reserved by line are 422 with the field, before the database', async () => {
    const f = fake();
    expect(await handleGuideWrite(UID, false, { op: 'save', guide: { ...good, body: 'shit' } }, f.rpc)).toEqual({ status: 422, body: { error: 'blocked_text', field: 'body' } });
    expect(await handleGuideWrite(UID, false, { op: 'save', guide: { ...good, byline: 'Team Ascent' } }, f.rpc)).toEqual({ status: 422, body: { error: 'reserved_name', field: 'byline' } });
    expect(f.calls).toEqual([]);
  });
  it('maps each SQL refusal to its status', async () => {
    const cases: Array<[string, number]> = [['not_allowed', 403], ['not_found', 404], ['conflict', 409], ['too_many_guides', 422], ['rate_limited', 429], ['unauthenticated', 401]];
    for (const [code, status] of cases) {
      const f = fake({ error: { message: `P0001: ${code}` } });
      expect(await handleGuideWrite(UID, false, { op: 'save', guide: good }, f.rpc), code).toEqual({ status, body: { error: code } });
    }
  });
  it('an unknown database error, a thrown call and a malformed answer are 500s', async () => {
    expect((await handleGuideWrite(UID, false, { op: 'save', guide: good }, fake({ error: { message: 'deadlock' } }).rpc)).status).toBe(500);
    expect((await handleGuideWrite(UID, false, { op: 'save', guide: good }, fake(() => { throw new Error('boom'); }).rpc)).status).toBe(500);
    expect(await handleGuideWrite(UID, false, { op: 'save', guide: good }, fake({ data: { nothing: true } }).rpc)).toEqual({ status: 500, body: { error: 'guide_malformed' } });
  });
});

describe('handleGuideWrite: delete', () => {
  it('needs a uuid, and calls guide_delete as the caller', async () => {
    const f = fake({ data: { deleted: GID } });
    expect(await handleGuideWrite(UID, false, { op: 'delete', id: 'nope' }, f.rpc)).toEqual({ status: 400, body: { error: 'bad_id' } });
    expect(await handleGuideWrite(UID, false, { op: 'delete', id: GID }, f.rpc)).toEqual({ status: 200, body: { deleted: GID } });
    expect(f.calls).toEqual([{ fn: 'guide_delete', args: { p_user: UID, p_id: GID } }]);
  });
});

describe('handleGuideWrite: importBuiltIns', () => {
  const builtIn = { ...good, slug: 'set2-beast-sunmane' };
  it('forces every guide official, requires its slug, and sends them in order', async () => {
    const f = fake({ data: { inserted: 2, skipped: 0 } });
    const res = await handleGuideWrite(UID, false, { op: 'importBuiltIns', guides: [builtIn, { ...builtIn, slug: 'set2-beast-oona' }] }, f.rpc);
    expect(res).toEqual({ status: 200, body: { inserted: 2, skipped: 0 } });
    const docs = f.calls[0]!.args.p_docs as Array<Record<string, unknown>>;
    expect(f.calls[0]!.fn).toBe('guide_import_builtins');
    expect(docs.map((d) => d.slug)).toEqual(['set2-beast-sunmane', 'set2-beast-oona']);
    expect(docs.every((d) => d.official === true)).toBe(true);
  });
  it('overrides a caller-supplied official: false and id on every entry', async () => {
    const f = fake({ data: { inserted: 2, skipped: 0 } });
    const forged = [
      { ...builtIn, official: false, id: GID },
      { ...builtIn, slug: 'set2-beast-oona', official: false, id: '22222222-2222-4222-8222-222222222222' },
    ];
    await handleGuideWrite(UID, false, { op: 'importBuiltIns', guides: forged }, f.rpc);
    const docs = f.calls[0]!.args.p_docs as Array<Record<string, unknown>>;
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      expect(d.official).toBe(true);
      expect(d.id).toBeNull();
    }
  });
  it('refuses a missing slug, an empty list and more than 50', async () => {
    const f = fake();
    expect(await handleGuideWrite(UID, false, { op: 'importBuiltIns', guides: [good] }, f.rpc)).toEqual({ status: 422, body: { error: 'bad_guide', field: 'slug', index: 0 } });
    expect((await handleGuideWrite(UID, false, { op: 'importBuiltIns', guides: [] }, f.rpc)).body).toEqual({ error: 'bad_guides' });
    expect((await handleGuideWrite(UID, false, { op: 'importBuiltIns', guides: Array.from({ length: 51 }, () => builtIn) }, f.rpc)).body).toEqual({ error: 'bad_guides' });
    expect(f.calls).toEqual([]);
  });
});

/** A fake RPC that answers per function name and records every call. */
function fakeBy(answers: Record<string, { data?: unknown; error?: { message: string } | null }>): { rpc: RpcCall; calls: Array<{ fn: string; args: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc: RpcCall = async (fn, args) => {
    calls.push({ fn, args });
    const a = answers[fn] ?? { data: null, error: { message: `unexpected ${fn}` } };
    return { data: a.data ?? null, error: a.error ?? null };
  };
  return { rpc, calls };
}
const stored = { ...row, author_id: UID, official: false, published: false, tagline: '', aliases: {}, revision: 4 };

describe('handleGuideWrite: setPublished', () => {
  it('publishing reads the stored guide, checks its text, then publishes at the revision it checked', async () => {
    const f = fakeBy({ guide_own_row: { data: stored }, guide_set_published: { data: { ...stored, published: true, published_at: '2026-10-13T00:00:00Z' } } });
    const res = await handleGuideWrite(UID, false, { op: 'setPublished', id: GID, published: true }, f.rpc);
    expect(res.status).toBe(200);
    expect((res.body.guide as { published: boolean; publishedAt: string }).published).toBe(true);
    expect((res.body.guide as { publishedAt: string }).publishedAt).toBe('2026-10-13T00:00:00Z');
    expect(f.calls.map((c) => c.fn)).toEqual(['guide_own_row', 'guide_set_published']);
    expect(f.calls[1]!.args).toEqual({ p_user: UID, p_id: GID, p_on: true, p_revision: 4 });
  });
  it('a stored guide that now breaks the word rules is refused with its field, and nothing is published', async () => {
    const f = fakeBy({ guide_own_row: { data: { ...stored, title: 'Team Ascent Dragons' } } });
    const res = await handleGuideWrite(UID, false, { op: 'setPublished', id: GID, published: true }, f.rpc);
    expect(res).toEqual({ status: 422, body: { error: 'reserved_name', field: 'title' } });
    expect(f.calls.map((c) => c.fn)).toEqual(['guide_own_row']);
  });
  it('unpublishing never reads or checks the text', async () => {
    const f = fakeBy({ guide_set_published: { data: { ...stored, published: false } } });
    const res = await handleGuideWrite(UID, false, { op: 'setPublished', id: GID, published: false }, f.rpc);
    expect(res.status).toBe(200);
    expect(f.calls).toEqual([{ fn: 'guide_set_published', args: { p_user: UID, p_id: GID, p_on: false, p_revision: null } }]);
  });
  it('passes the row rules through: not allowed, hidden, conflict, rate limited, not found', async () => {
    const cases: Array<[string, number]> = [['not_allowed', 403], ['guide_hidden', 403], ['conflict', 409], ['rate_limited', 429], ['not_found', 404]];
    for (const [code, status] of cases) {
      const f = fakeBy({ guide_own_row: { data: stored }, guide_set_published: { error: { message: `ERROR: ${code}` } } });
      expect(await handleGuideWrite(UID, false, { op: 'setPublished', id: GID, published: true }, f.rpc)).toEqual({ status, body: { error: code } });
    }
    const g = fakeBy({ guide_own_row: { error: { message: 'not_allowed' } } });
    expect(await handleGuideWrite(UID, false, { op: 'setPublished', id: GID, published: true }, g.rpc)).toEqual({ status: 403, body: { error: 'not_allowed' } });
  });
  it('refuses a bad id or a published that is not a boolean, before the database', async () => {
    const f = fakeBy({});
    expect((await handleGuideWrite(UID, false, { op: 'setPublished', id: 'x', published: true }, f.rpc)).body).toEqual({ error: 'bad_id' });
    expect((await handleGuideWrite(UID, false, { op: 'setPublished', id: GID, published: 'yes' }, f.rpc)).body).toEqual({ error: 'bad_published' });
    expect(f.calls).toEqual([]);
  });
  it('a stored row it cannot read is a 500, not a publish', async () => {
    const f = fakeBy({ guide_own_row: { data: { nope: true } } });
    expect((await handleGuideWrite(UID, false, { op: 'setPublished', id: GID, published: true }, f.rpc)).status).toBe(500);
    expect(f.calls.map((c) => c.fn)).toEqual(['guide_own_row']);
  });
});

describe('handleGuideWrite: bookmark and unbookmark', () => {
  it('bookmark and unbookmark call guide_bookmark with on and off and answer the count', async () => {
    const f = fakeBy({ guide_bookmark: { data: { bookmarked: true, count: 3 } } });
    expect(await handleGuideWrite(UID, false, { op: 'bookmark', id: GID }, f.rpc)).toEqual({ status: 200, body: { bookmarked: true, count: 3 } });
    const g = fakeBy({ guide_bookmark: { data: { bookmarked: false, count: 2 } } });
    expect(await handleGuideWrite(UID, false, { op: 'unbookmark', id: GID }, g.rpc)).toEqual({ status: 200, body: { bookmarked: false, count: 2 } });
    expect(f.calls[0]!.args).toEqual({ p_user: UID, p_id: GID, p_on: true });
    expect(g.calls[0]!.args).toEqual({ p_user: UID, p_id: GID, p_on: false });
  });
  it('the cap is a 422 the client can name', async () => {
    const f = fakeBy({ guide_bookmark: { error: { message: 'too_many_bookmarks' } } });
    expect(await handleGuideWrite(UID, false, { op: 'bookmark', id: GID }, f.rpc)).toEqual({ status: 422, body: { error: 'too_many_bookmarks' } });
  });
  it('a guest cannot bookmark, and a bad id never reaches the database', async () => {
    const f = fakeBy({});
    expect((await handleGuideWrite(UID, true, { op: 'bookmark', id: GID }, f.rpc)).body).toEqual({ error: 'sign_in_required' });
    expect((await handleGuideWrite(UID, false, { op: 'bookmark', id: 'x' }, f.rpc)).body).toEqual({ error: 'bad_id' });
    expect(f.calls).toEqual([]);
  });
});

describe('handleGuideWrite: save carries the save id', () => {
  it('a save id reaches guide_save as save_id; a bad one is refused before the database', async () => {
    const SAVE = '22222222-2222-4222-8222-222222222222';
    const f = fake();
    await handleGuideWrite(UID, false, { op: 'save', guide: { ...good, saveId: SAVE } }, f.rpc);
    expect((f.calls[0]!.args.p_doc as { save_id: string }).save_id).toBe(SAVE);
    const g = fake();
    expect((await handleGuideWrite(UID, false, { op: 'save', guide: { ...good, saveId: 'x' } }, g.rpc)).body).toEqual({ error: 'bad_guide', field: 'saveId' });
    expect(g.calls).toEqual([]);
  });
});
