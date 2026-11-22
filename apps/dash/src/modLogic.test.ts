import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTION_ERROR, clearAction, currentNameNote, handle, logLine, openCount, reportCountLabel, resetAction, resetConfirmText, reviewAction,
  viewOfHash, when, withView,
} from './modLogic';
import { fixtureAction, fixtureQueue, fixtureSearch, resetModFixture } from './modFixture';
import { actionCall } from './server/moderation';
import type { ModAction, NameFlag } from './modTypes';

/** The Moderation tab's logic: the view in the URL, names, the confirm text, the action bodies the server accepts. */
const ID = '11111111-2222-4333-8444-555555555555';
beforeEach(() => resetModFixture());

describe('the view rides the URL hash with the range', () => {
  it('round-trips and leaves the analytics hash as it was', () => {
    expect(viewOfHash('#range=7d&view=moderation')).toBe('moderation');
    expect(viewOfHash('#range=7d')).toBe('analytics');
    expect(viewOfHash('#view=junk')).toBe('analytics');
    expect(withView('#range=7d', 'moderation')).toBe('#range=7d&view=moderation');
    expect(withView('#range=7d&view=moderation', 'analytics')).toBe('#range=7d');
  });
});

describe('labels', () => {
  it('handles, counts and times', () => {
    expect(handle({ id: ID, name: 'Kevin', tag: '1111' })).toBe('Kevin#1111');
    expect(handle({ id: ID, name: null, tag: null })).toBe('No name (11111111)');
    expect(handle(null)).toBe('Unknown player');
    expect(openCount({ reports: 2, names: 3 })).toBe(5);
    expect(openCount(null)).toBe(0);
    const now = Date.parse('2026-11-22T12:00:00Z');
    expect(when('2026-11-22T11:59:30Z', now)).toBe('just now');
    expect(when('2026-11-22T11:15:00Z', now)).toBe('45m ago');
    expect(when('2026-11-22T07:00:00Z', now)).toBe('5h ago');
    expect(when('2026-11-20T07:05:00Z', now)).toMatch(/^20 Nov \d\d:05$/);
  });
  it('the confirm text says what the reset does, plainly (no dashes)', () => {
    for (const t of [resetConfirmText('account', 'ShitStorm'), resetConfirmText('team', 'Admin Squad'), ...Object.values(ACTION_ERROR)]) {
      expect(t).not.toMatch(/[–—]|--/);
    }
    expect(resetConfirmText('account', 'X')).toContain('"Player"');
    expect(resetConfirmText('team', 'X')).toContain('default');
  });
  it('a flag notes when its target moved on', () => {
    const f = { kind: 'account', name: 'Bad', current: { exists: true, name: 'Player', tag: '1234' } } as NameFlag;
    expect(currentNameNote(f)).toBe('Now: Player#1234');
    expect(currentNameNote({ ...f, current: { exists: true, name: 'Bad' } })).toBeNull();
    expect(currentNameNote({ ...f, kind: 'team', current: { exists: true, name: null } })).toBe('Now: the default name');
    expect(currentNameNote({ ...f, current: { exists: false } })).toBe('Gone (deleted)');
  });
  it('report counts and log lines', () => {
    const q = fixtureQueue({});
    expect(reportCountLabel(q.reports[0]!)).toBe('Reported 3 times (2 open)');
    expect(reportCountLabel(q.reports[1]!)).toBe('First report');
    expect(logLine({ id: 1, at: '', actor: 'a', action: 'reset_name', kind: 'account', targetId: ID, before: { name: 'Bad', tag: '1' }, after: { name: 'Player', tag: '1' }, note: null }))
      .toBe('Reset account name "Bad#1" to "Player#1"');
    expect(logLine({ id: 1, at: '', actor: 'a', action: 'reset_name', kind: 'team', targetId: ID, before: { name: 'Bad' }, after: { name: null }, note: null }))
      .toBe('Reset team name "Bad" to the default name');
  });
});

describe('action bodies', () => {
  it('are exactly what the server accepts (blank notes left out, notes trimmed)', () => {
    const bodies: ModAction[] = [reviewAction(ID, '  ok  '), clearAction(ID), resetAction('team', ID, ''), resetAction('account', ID, 'x'.repeat(600))];
    expect(bodies[0]).toEqual({ action: 'review', reportId: ID, note: 'ok' });
    expect(bodies[1]).toEqual({ action: 'clear', flagId: ID });
    expect(bodies[2]).toEqual({ action: 'reset', kind: 'team', targetId: ID });
    for (const b of bodies) expect(actionCall(JSON.parse(JSON.stringify(b)))).not.toHaveProperty('error');
  });
});

describe('the fixture behaves like the SQL', () => {
  it('review, clear and reset move the counts and write the log', () => {
    const q0 = fixtureQueue({});
    expect(q0.counts).toEqual({ reports: 3, names: 5 });
    expect(fixtureAction(reviewAction(q0.reports[0]!.id, 'warned'))[0]).toBe(200);
    expect(fixtureAction(clearAction(q0.names[0]!.id))[0]).toBe(200);
    expect(fixtureAction(clearAction(q0.names[0]!.id))).toEqual([409, { error: 'not_open' }]);
    const team = q0.names.find((n) => n.kind === 'team')!;
    expect(fixtureAction(resetAction('team', team.targetId))[0]).toBe(200);
    const q1 = fixtureQueue({});
    expect(q1.counts).toEqual({ reports: 2, names: 3 });
    expect(q1.log.slice(0, 3).map((l) => l.action)).toEqual(['reset_name', 'clear_flag', 'review_report']);
    expect(fixtureSearch('admin').teams).toEqual([]); // the team name is gone
  });
});

describe('the page', () => {
  const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');
  it('no inline styles, no window.confirm, no secrets, and every player string escaped through esc()', () => {
    const page = src('moderation.ts');
    expect(page).not.toMatch(/style="/);
    expect(page).not.toMatch(/\bconfirm\(/);
    for (const f of ['moderation.ts', 'modLogic.ts', 'modFixture.ts', 'modTypes.ts']) expect(src(f)).not.toMatch(/SERVICE_ROLE|service_role|supabase\.co/i);
    // Player text reaches the page only through esc(...): no ${x.name} / ${x.body} / ${x.note} interpolated raw.
    expect(page).not.toMatch(/\$\{(?:r|f|l|a|t|s|e|c)\.(?:name|body|note|q)\}/);
  });
  it('the Moderation view has the tab, the queues, the search and the log', () => {
    const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
    for (const id of ['views', 'mod-count', 'view-moderation', 'mod-reports', 'mod-names', 'mod-search-form', 'mod-log']) expect(html).toContain(`id="${id}"`);
  });
});
