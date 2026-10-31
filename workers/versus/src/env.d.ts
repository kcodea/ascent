/**
 * The slice of the Workers runtime API this package uses, declared by hand so the monorepo's TypeScript (Node types,
 * no DOM) can check it without pulling `@cloudflare/workers-types` into every project. Keep it to what we call.
 */

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStorageListOptions {
  prefix?: string;
  limit?: number;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  list<T = unknown>(options?: DurableObjectStorageListOptions): Promise<Map<string, T>>;
  put(key: string, value: unknown, options?: { allowUnconfirmed?: boolean }): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface CfWebSocket {
  accept(): void;
  send(message: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
  readonly readyState: number;
  addEventListener(type: 'message', handler: (ev: { data: string | ArrayBuffer }) => void): void;
  addEventListener(type: 'close', handler: (ev: { code: number; reason: string }) => void): void;
  addEventListener(type: 'open' | 'error', handler: (ev: unknown) => void): void;
}

declare class WebSocketPair {
  0: CfWebSocket;
  1: CfWebSocket;
}

declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
}

interface DurableObjectState {
  readonly id: DurableObjectId;
  readonly storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
  acceptWebSocket(ws: CfWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): CfWebSocket[];
  setWebSocketAutoResponse(pair?: WebSocketRequestResponsePair): void;
  getWebSocketAutoResponseTimestamp(ws: CfWebSocket): Date | null;
}

interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub & T;
}

interface CfResponseInit extends ResponseInit {
  webSocket?: CfWebSocket | null;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
  /** A named entrypoint (RPC over a service binding; never reachable from the internet). */
  export abstract class WorkerEntrypoint<Env = unknown> {
    protected ctx: ExecutionContext;
    protected env: Env;
    constructor(ctx: ExecutionContext, env: Env);
  }
}
