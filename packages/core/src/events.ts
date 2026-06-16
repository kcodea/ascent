import type { GameEvent } from './types';

export type EventHandler = (payload: unknown) => void;

/**
 * A minimal synchronous event bus, scoped to a single combat. Minions register
 * their effect handlers at combat start (and when summoned mid-combat); the
 * simulator emits game events as it resolves attacks, deaths, and summons.
 *
 * Handlers may themselves cause emits (a Deathrattle summon → `onSummon`); the
 * simulator's iteration guard bounds any cascade.
 */
export class CombatBus {
  private readonly handlers = new Map<GameEvent, EventHandler[]>();

  on(event: GameEvent, handler: EventHandler): void {
    const list = this.handlers.get(event);
    if (list) list.push(handler);
    else this.handlers.set(event, [handler]);
  }

  emit(event: GameEvent, payload: unknown): void {
    const list = this.handlers.get(event);
    if (!list) return;
    // Snapshot: handlers may register new handlers (summoned minions).
    for (const handler of [...list]) handler(payload);
  }
}
