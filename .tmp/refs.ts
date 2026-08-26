import { CARD_INDEX, RUNES, EPIC_RUNES, QUEST_DEFS } from '@game/content';
const idKeys = new Map<string, number>(); const bad: string[] = [];
const check = (owner: string, obj: unknown): void => {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/Id$/.test(k) && typeof v === 'string') {
      idKeys.set(k, (idKeys.get(k) ?? 0) + 1);
      if (k !== 'sourceId' && !CARD_INDEX[v]) bad.push(`${owner}: ${k}='${v}'`);
    } else if (typeof v === 'object') check(owner, v);
  }
};
for (const c of Object.values(CARD_INDEX) as any[]) for (const e of c?.effects ?? []) check(c.id, e.params);
for (const r of [...RUNES, ...EPIC_RUNES]) check(r.id, (r as any).reward);
for (const q of QUEST_DEFS) check(q.id, (q as any).reward);
console.log('id keys:', [...idKeys.entries()].map(([k,n])=>`${k}:${n}`).join(' '));
console.log('unresolved:', bad.length ? bad.join('; ') : 'none');
