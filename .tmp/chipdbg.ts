import { CARD_INDEX } from '@game/content';
import { createRun, reduce } from '@game/sim';
const glutton = (Object.values(CARD_INDEX) as any[]).find(c => c?.effects?.some((e: any) => e.do === 'onTribePlayedConsumeShop' && e.params?.self === true))!;
const demon = (Object.values(CARD_INDEX) as any[]).find(c => c && !c.spell && !c.token && c.tribe === 'demon'
  && (c.effects?.length ?? 0) === 0 && (c.keywords?.length ?? 0) === 0 && !c.chooseOne && !c.target && !c.triggerMultiplier);
console.log('demon pick:', demon?.id ?? 'NONE(fallback)');
const d = demon ?? (Object.values(CARD_INDEX) as any[]).find(c => c && !c.spell && !c.token && c.tribe === 'demon'
  && !c.keywords.includes('FD') && !c.chooseOne && !c.target && c.effects.every((e: any) => e.on === 'startOfCombat'))!;
console.log('using:', d?.id);
const card = (uid: string, cardId: string) => { const x = CARD_INDEX[cardId]! as any; return { uid, cardId, tribe: x.tribe, attack: x.attack, health: x.health, keywords: [...x.keywords], golden: false }; };
const s0: any = { ...createRun(0xc41f, 'aster'), embers: 30, rngCursor: 1,
  board: [card('g', glutton.id), card('a1', d.id), card('a2', d.id)], hand: [card('m', d.id)], shop: [{ uid: 'food', cardId: 'pup' }] };
const s1 = reduce(s0, { type: 'play', uid: 'm' } as any);
console.log('board:', s1.board.map((c: any) => `${c.uid}:${c.cardId}:${c.attack}/${c.health}`).join(' '), '| hand:', s1.hand.length, '| shop:', s1.shop.length, '| modal:', !!(s1 as any).chooseOne, !!(s1 as any).pendingTarget);
