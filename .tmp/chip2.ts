import { CARD_INDEX } from '@game/content';
import { createRun, reduce } from '@game/sim';
const glutton = (Object.values(CARD_INDEX) as any[]).find(c => c?.effects?.some((e: any) => e.do === 'onTribePlayedConsumeShop' && e.params?.self === true))!;
const card = (uid: string, cardId: string) => { const x = CARD_INDEX[cardId]! as any; return { uid, cardId, tribe: x.tribe, attack: x.attack, health: x.health, keywords: [...x.keywords], golden: false }; };
const mate = (uid: string) => ({ ...card(uid, 'pup'), tribe: 'demon' });
const s0: any = { ...createRun(0xc41f, 'aster'), embers: 30, rngCursor: 1,
  board: [card('g', glutton.id), mate('a1'), mate('a2')], hand: [mate('m')], shop: [{ uid: 'food', cardId: 'pup' }] };
const s1 = reduce(s0, { type: 'play', uid: 'm' } as any);
console.log('board:', s1.board.map((c: any) => `${c.uid}:${c.attack}/${c.health}`).join(' '), '| shop:', s1.shop.length);
