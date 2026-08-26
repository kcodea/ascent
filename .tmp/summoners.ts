import { CARD_INDEX } from '@game/content';
for (const c of Object.values(CARD_INDEX) as any[]) {
  for (const e of c?.effects ?? []) {
    const tid = e.params?.tokenId;
    if (tid && CARD_INDEX[tid] && (CARD_INDEX[tid] as any).effects?.some((x: any) => x.on === 'avenge'))
      console.log(`${c.id} (${e.on}:${e.do}) summons ${tid}`);
  }
}
