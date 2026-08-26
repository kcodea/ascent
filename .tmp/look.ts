import { CARD_INDEX } from '@game/content';
const ll = (Object.values(CARD_INDEX) as any[]).filter(c => /lantern/i.test(c?.name ?? ''));
console.log('lanterns:', ll.map(c => `${c.id}:${c.name}${c.spell?'(spell)':''}`).join(' '));
const avTok = (Object.values(CARD_INDEX) as any[]).filter(c => c?.token && c.effects?.some((e: any) => e.on === 'avenge'));
console.log('avenge tokens:', avTok.map(c => c.id).join(' ') || 'none');
const beefy = (Object.values(CARD_INDEX) as any[]).filter(c => /beefy/i.test(c?.name ?? '') || /beefy/.test(c?.id ?? ''));
console.log('beefy:', beefy.map(c => c.id).join(' '));
const oona = CARD_INDEX['b2_oona'] as any, beard = CARD_INDEX['b2_beardsley'] as any;
console.log('oona:', JSON.stringify(oona.effects), '| beardsley:', JSON.stringify(beard.effects));
