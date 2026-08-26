import { CARD_INDEX } from '@game/content';
console.log('beetle target =', JSON.stringify((CARD_INDEX['beetle'] as any).target), 'tribe=', (CARD_INDEX['beetle'] as any).targetTribe, 'effects=', JSON.stringify((CARD_INDEX['beetle'] as any).effects));
const glutton = (Object.values(CARD_INDEX) as any[]).find(c => c?.effects?.some((e: any) => e.do === 'onTribePlayedConsumeShop' && e.params?.self === true))!;
const tribe = glutton.effects.find((e: any) => e.do === 'onTribePlayedConsumeShop').params?.tribe ?? 'demon';
const demon = (Object.values(CARD_INDEX) as any[]).find(c => c && !c.spell && !c.token && c.tribe === tribe && !c.keywords.includes('FD') && (c.effects?.length ?? 0) === 0 && !c.target);
console.log('glutton =', glutton.id, '| tribe =', tribe, '| plain demon =', demon?.id ?? 'NONE');
