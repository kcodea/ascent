// MADE-UP moderation data for local work on the page (the dev / preview server answers /api/moderation/* with it; see
// vite.config.ts). It never ships: the deployed /api/moderation/* are the Pages Functions, which read the database.
// Every player, message and name here is invented. Actions change this in-memory copy, like the real SQL would.
import type { DmReport, LogEntry, ModAction, ModQueue, ModSearch, NameFlag, NamesFilter, ReportsFilter, Who } from './modTypes';

const who = (n: number, name: string, tag: string): Who => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name, tag });
const P = {
  ash: who(1, 'Ashfang', '4821'), brin: who(2, 'BrinnaLeaf', '1307'), cole: who(3, 'ColdIron', '7740'), dax: who(4, 'Daxter', '0912'),
  eve: who(5, 'EmberQueen', '3301'), fin: who(6, 'Finchley', '5566'), gus: who(7, 'Gusto', '2048'), hal: who(8, 'Halvard', '8812'),
};
const ago = (now: number, min: number): string => new Date(now - min * 60_000).toISOString();
const id = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Store { reports: DmReport[]; names: NameFlag[]; log: LogEntry[]; accounts: Array<Who & { gamesPlayed?: number }>; teams: Array<{ id: string; name: string | null; members: Who[] }>; seq: number }
let store: Store | null = null;

function seed(now: number): Store {
  const ctx = (sender: Who, lines: Array<[0 | 1, string, number]>, reportedIdx: number, rid: number) =>
    lines.map(([by, body, m], i) => ({ id: i === reportedIdx ? id('aaaaaaaa', rid) : id('bbbbbbbb', rid * 10 + i), by: by ? 'reported' as const : 'reporter' as const, body, at: ago(now, m) }));
  const reports: DmReport[] = [
    {
      id: id('11111111', 1), createdAt: ago(now, 12), reason: 'abuse', status: 'open', reviewedAt: null, reviewedBy: null, note: null,
      messageId: id('aaaaaaaa', 1), body: 'uninstall the game you are actually brain dead', sentAt: ago(now, 14), reporter: P.brin, sender: P.dax,
      senderReports: 3, senderOpen: 2,
      context: ctx(P.dax, [[0, 'gg, that last round was close', 19], [1, 'close? you got carried by your rune', 17], [0, 'it was a good rune lol', 16],
        [1, 'uninstall the game you are actually brain dead', 14], [0, 'ok, blocking you', 13]], 3, 1),
    },
    {
      id: id('11111111', 2), createdAt: ago(now, 95), reason: 'spam', status: 'open', reviewedAt: null, reviewedBy: null, note: null,
      messageId: id('aaaaaaaa', 2), body: 'free gold at my site, add me for the link', sentAt: ago(now, 97), reporter: P.eve, sender: P.gus,
      senderReports: 1, senderOpen: 1,
      context: ctx(P.gus, [[1, 'hey', 99], [1, 'free gold at my site, add me for the link', 97]], 1, 2),
    },
    {
      id: id('11111111', 3), createdAt: ago(now, 300), reason: 'abuse', status: 'open', reviewedAt: null, reviewedBy: null, note: null,
      messageId: id('aaaaaaaa', 3), body: 'report me then, nobody reads those', sentAt: ago(now, 302), reporter: P.fin, sender: P.dax,
      senderReports: 3, senderOpen: 2,
      context: ctx(P.dax, [[0, 'why did you leave the duo', 306], [1, 'cause you were throwing', 304], [0, 'I am reporting that', 303], [1, 'report me then, nobody reads those', 302]], 3, 3),
    },
    {
      id: id('11111111', 4), createdAt: ago(now, 60 * 30), reason: 'other', status: 'reviewed', reviewedAt: ago(now, 60 * 26), reviewedBy: 'kevin@example.com',
      note: 'Banter between friends. Nothing to do.', messageId: id('aaaaaaaa', 4), body: 'you absolute potato', sentAt: ago(now, 60 * 30 + 2),
      reporter: P.hal, sender: P.dax, senderReports: 3, senderOpen: 2, context: ctx(P.dax, [[1, 'you absolute potato', 60 * 30 + 2], [0, 'lol', 60 * 30 + 1]], 0, 4),
    },
  ];
  const flag = (n: number, kind: NameFlag['kind'], target: string, name: string, term: string, owner: Who, min: number, extra: Partial<NameFlag> = {}): NameFlag => ({
    id: id('22222222', n), kind, targetId: target, name, term, severity: 'flag', status: 'open', createdAt: ago(now, min), reviewedAt: null, reviewedBy: null,
    note: null, owner, current: { exists: true, name, tag: kind === 'account' ? owner.tag : null }, canReset: kind !== 'room', ...extra,
  });
  const teamId = id('33333333', 1);
  const names: NameFlag[] = [
    flag(1, 'account', P.cole.id, 'ShitStorm', 'shit', P.cole, 8),
    flag(2, 'team', teamId, 'Admin Squad', 'admin', P.ash, 41, { current: { exists: true, name: 'Admin Squad', members: [P.ash, P.eve] } }),
    flag(3, 'room', 'room-7f3a', 'wank tank 1v1', 'wank', P.gus, 66),
    flag(4, 'account', P.hal.id, 'Nazi Gold', 'nazi', P.hal, 60 * 20, { severity: 'flag' }),
    flag(5, 'account', P.fin.id, 'Finchley', 'retard', P.fin, 60 * 40, { severity: 'block', name: 'Retard Rex', current: { exists: true, name: 'Retard Rex', tag: P.fin.tag } }),
  ];
  const log: LogEntry[] = [
    { id: 2, at: ago(now, 60 * 26), actor: 'kevin@example.com', action: 'review_report', kind: 'dm_report', targetId: id('11111111', 4), before: { status: 'open', note: null }, after: { status: 'reviewed', note: 'Banter between friends. Nothing to do.' }, note: 'Banter between friends. Nothing to do.' },
    { id: 1, at: ago(now, 60 * 50), actor: 'mike@example.com', action: 'reset_name', kind: 'account', targetId: P.gus.id, before: { name: 'Wanker Prime', tag: '2048' }, after: { name: 'Player', tag: '2048' }, note: 'Sexual name' },
  ];
  const accounts = Object.values(P).map((p, i) => ({ ...p, gamesPlayed: 12 + i * 7 }));
  accounts[2] = { ...accounts[2]!, name: 'ShitStorm' };
  accounts[7] = { ...accounts[7]!, name: 'Nazi Gold' };
  accounts[5] = { ...accounts[5]!, name: 'Retard Rex' };
  const teams = [{ id: teamId, name: 'Admin Squad', members: [P.ash, P.eve] }, { id: id('33333333', 2), name: 'Moonlight Duo', members: [P.brin, P.cole] }];
  return { reports, names, log, accounts, teams, seq: 3 };
}

const get = (now: number): Store => (store ??= seed(now));
/** For tests: start over from the seed. */
export function resetModFixture(): void { store = null; }

export function fixtureQueue(q: { reports?: string | null; names?: string | null }, now = Date.now()): ModQueue {
  const s = get(now);
  const rf = (q.reports ?? 'open') as ReportsFilter;
  const nf = (q.names ?? 'open') as NamesFilter;
  return {
    counts: { reports: s.reports.filter((r) => r.status === 'open').length, names: s.names.filter((n) => n.status === 'open').length },
    reports: s.reports.filter((r) => (rf === 'open' ? r.status === 'open' : rf === 'reviewed' ? r.status !== 'open' : true)),
    names: s.names.filter((n) => (nf === 'open' ? n.status === 'open' : nf === 'done' ? n.status !== 'open' : true)),
    log: s.log,
  };
}

const verdictOf = (name: string | null): { verdict: 'ok' | 'flag' | 'block'; term: string | null } =>
  /retard/i.test(name ?? '') ? { verdict: 'block', term: 'retard' } : /shit|admin|nazi/i.test(name ?? '') ? { verdict: 'flag', term: (/shit|admin|nazi/i.exec(name ?? '')![0]).toLowerCase() } : { verdict: 'ok', term: null };

export function fixtureSearch(q: string, now = Date.now()): ModSearch {
  const s = get(now);
  const t = q.trim().toLowerCase();
  if (!t) return { q: '', accounts: [], teams: [] };
  const openFlag = (kind: string, target: string) => s.names.some((n) => n.kind === kind && n.targetId === target && n.status === 'open');
  return {
    q,
    accounts: s.accounts.filter((a) => `${a.name}#${a.tag}`.toLowerCase().includes(t) || a.id === t)
      .map((a) => ({ id: a.id, name: a.name, tag: a.tag, verdict: verdictOf(a.name), openFlag: openFlag('account', a.id) })),
    teams: s.teams.filter((x) => (x.name ?? '').toLowerCase().includes(t))
      .map((x) => ({ id: x.id, name: x.name, members: x.members, verdict: verdictOf(x.name), openFlag: openFlag('team', x.id) })),
  };
}

/** Applies an action like the SQL does. Answers [status, body]. */
export function fixtureAction(a: ModAction, actor = 'you@example.com', now = Date.now()): [number, unknown] {
  const s = get(now);
  const at = new Date(now).toISOString();
  const log = (e: Omit<LogEntry, 'id' | 'at' | 'actor'>) => s.log.unshift({ id: ++s.seq, at, actor, ...e });
  if (a.action === 'review') {
    const r = s.reports.find((x) => x.id === a.reportId);
    if (!r) return [409, { error: 'not_found' }];
    const before = { status: r.status, note: r.note };
    Object.assign(r, { status: 'reviewed', reviewedAt: at, reviewedBy: actor, note: a.note ?? r.note });
    for (const o of s.reports) if (o.sender?.id === r.sender?.id) o.senderOpen = s.reports.filter((x) => x.sender?.id === r.sender?.id && x.status === 'open').length;
    log({ action: 'review_report', kind: 'dm_report', targetId: r.id, before, after: { status: r.status, note: r.note }, note: a.note ?? null });
    return [200, { ok: true }];
  }
  if (a.action === 'clear') {
    const f = s.names.find((x) => x.id === a.flagId);
    if (!f) return [409, { error: 'not_found' }];
    if (f.status !== 'open') return [409, { error: 'not_open' }];
    Object.assign(f, { status: 'cleared', reviewedAt: at, reviewedBy: actor, note: a.note ?? null });
    log({ action: 'clear_flag', kind: f.kind, targetId: f.targetId, before: { status: 'open', name: f.name }, after: { status: 'cleared', name: f.name }, note: a.note ?? null });
    return [200, { ok: true }];
  }
  let before: Record<string, unknown>;
  let after: Record<string, unknown>;
  if (a.kind === 'account') {
    const acc = s.accounts.find((x) => x.id === a.targetId);
    if (!acc) return [409, { error: 'not_found' }];
    before = { name: acc.name, tag: acc.tag };
    acc.name = 'Player';
    after = { name: 'Player', tag: acc.tag };
  } else {
    const team = s.teams.find((x) => x.id === a.targetId);
    if (!team) return [409, { error: 'not_found' }];
    before = { name: team.name };
    team.name = null;
    after = { name: null };
  }
  for (const f of s.names) {
    if (f.kind === a.kind && f.targetId === a.targetId) {
      f.current = { ...f.current, name: after.name as string | null };
      if (f.status === 'open') Object.assign(f, { status: 'reset', reviewedAt: at, reviewedBy: actor, note: a.note ?? null });
    }
  }
  log({ action: 'reset_name', kind: a.kind, targetId: a.targetId, before, after, note: a.note ?? null });
  return [200, { ok: true, before, after }];
}
