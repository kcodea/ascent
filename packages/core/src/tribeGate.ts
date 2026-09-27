/**
 * THE run-tribe membership gate: is a card part of a run whose active tribes are `tribes`? Neutral cards always
 * are; a tribal card is when its tribe OR its second tribe (`tribe2`, a dual-type minion) is one of them.
 * Every-tribe (`universalTribe`) bodies are neutral-tribed, so the neutral rule already lets them in.
 *
 * With every set's full roster rolled (5 of 5 today) the `tribe2` clause changes nothing; it matters when a run
 * holds only SOME of its set's tribes, e.g. a Practice game with only Demons picked still offers a Dragon/Demon
 * (owner 2026-09-27: "that tribe's cards plus neutral cards, and all spells associated").
 */
export function inRunTribes(card: { tribe?: string; tribe2?: string }, tribes: readonly string[]): boolean {
  const t = card.tribe ?? 'neutral';
  return t === 'neutral' || tribes.includes(t) || (!!card.tribe2 && tribes.includes(card.tribe2));
}
