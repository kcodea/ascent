import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from '@game/sim';
const pick = (tribe: string): string => (Object.values(CARD_INDEX) as any[]).find((c) => c && !c.spell && !c.token && !c.ruby && (c.tribe === tribe || c.tribe2 === tribe))!.id;
const body = (uid: string, id: string) => { const d = CARD_INDEX[id]! as any; return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], buffs: [] }; };
const fx = (): RunState => ({ ...createRun(0xd0cb07, 'aster'), wave: 8, tier: 4, embers: 999,
  board: ['beast','demon','dragon','dwarf','kobold','undead'].map((t,i)=>body(`b${i}`, pick(t))), hand: [], shop: [] } as any);
const buy = (s: RunState, id: string): RunState => reduce({ ...s, runeforgeOffer: [id] } as any, { type: 'buyRune', index: 0 } as any);
const once = buy(fx(), 'rune_gemstorm');
const twice = buy(once, 'rune_gemstorm');
for (const k of new Set([...Object.keys(once), ...Object.keys(twice)])) {
  const a = JSON.stringify((once as any)[k]), b = JSON.stringify((twice as any)[k]);
  if (a !== b) console.log(`${k}: ${String(a).slice(0,90)}  ->  ${String(b).slice(0,90)}`);
}
