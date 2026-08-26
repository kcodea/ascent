import { CARD_INDEX } from '@game/content';
const tt = (Object.values(CARD_INDEX) as any[]).filter(c => c?.targetTribe && !c.spell);
console.log('targetTribe minions:', tt.map(c => `${c.id}(${c.targetTribe})`).join(' '));
const chip = (Object.values(CARD_INDEX) as any[]).filter(c => c?.effects?.some((e: any) => e.do === 'onTribePlayedConsumeShop'));
console.log('chipper family:', chip.map(c => `${c.id} self=${c.effects.find((e:any)=>e.do==='onTribePlayedConsumeShop').params?.self}`).join(' '));
