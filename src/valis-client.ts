import EventEmitter from 'eventemitter3';

export type ValisClientStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closing'
  | 'closed';

export type NetworkResponse = {
  stable: string;
  genesis: number;
  utime: number;
  hour: number;
  seconds: number;
  tockdatahash: string;
  rollups: number;
  numtx: number;
  failed: number;
  changes: number;
  utc: number;
  chainlag: number;
  result: 'success' | string;
};

export type TokensResponse = {
  assets: string[];
  utc: number;
  chainlag: number;
  result: 'success' | string;
};

export type ValisClientOptions = {
  /** Auto reconnect on drop */
  reconnect?: boolean;
  /** Initial reconnect delay (ms) */
  reconnectInitialDelayMs?: number;
  /** Max reconnect delay (ms) */
  reconnectMaxDelayMs?: number;
  /** Jitter factor (0..1) */
  reconnectJitter?: number;
  /** Per-command timeout (ms) */
  requestTimeoutMs?: number;
  /** Heartbeat using "network" command (ms). Set 0/null to disable. */
  heartbeatIntervalMs?: number;
  /** Optional structured logger */
  onLog?: (
    level: 'debug' | 'info' | 'warn' | 'error',
    msg: string,
    meta?: unknown,
  ) => void;
};

export type Events = {
  open: Event;
  close: CloseEvent;
  error: Error;
  message: unknown;
  reconnecting: { attempt: number; delayMs: number };
  heartbeat: { ok: boolean; rttMs?: number };
};

const DEFAULTS = {
  reconnect: true,
  reconnectInitialDelayMs: 500,
  reconnectMaxDelayMs: 12_000,
  reconnectJitter: 0.2,
  requestTimeoutMs: 8_000,
  heartbeatIntervalMs: 15_000,
} satisfies Required<
  Pick<
    ValisClientOptions,
    | 'reconnect'
    | 'reconnectInitialDelayMs'
    | 'reconnectMaxDelayMs'
    | 'reconnectJitter'
    | 'requestTimeoutMs'
    | 'heartbeatIntervalMs'
  >
>;

function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

// Generic queue item; we store them as any internally
type QueueItem<T = unknown> = {
  payload: string;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  timeoutId: any; // node/browser timers differ; keep it loose
};

export class ValisClient {
  private url: string;
  private opts: ValisClientOptions;
  private ws: WebSocket | null = null;
  private eventEmitter = new EventEmitter<Events>();
  private status: ValisClientStatus = 'idle';
  private reconnectAttempt = 0;
  private connectPromise: Promise<void> | null = null;
  private heartbeatTimer: any = null; // node/browser compatibility
  private awaitingResponse = false;
  private manualClose = false;
  private queue: Array<QueueItem<any>> = [];

  constructor(url: string, opts: ValisClientOptions = {}) {
    this.url = url;
    this.opts = { ...DEFAULTS, ...opts };
  }

  getStatus(): ValisClientStatus {
    return this.status;
  }

  on<K extends keyof Events>(
    event: K,
    fn: (payload: Events[K]) => void,
  ): () => void {
    this.eventEmitter.on(event, fn as any);
    return () => this.eventEmitter.off(event, fn as any);
  }

  private setStatus(s: ValisClientStatus) {
    this.status = s;
  }

  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    msg: string,
    meta?: unknown,
  ) {
    this.opts.onLog?.(level, msg, meta);
  }

  async connect(): Promise<void> {
    if (typeof WebSocket === 'undefined') {
      throw new Error(
        'WebSocket API not available. valis-client is browser-only.',
      );
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.manualClose = false;
    this.setStatus('connecting');

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('message', onMessage);
        ws.removeEventListener('close', onClose);
        ws.removeEventListener('error', onError);
      };

      const onOpen = () => {
        this.setStatus('open');
        this.reconnectAttempt = 0;
        this.eventEmitter.emit('open', new Event('open'));
        this.log('info', 'WebSocket open');
        this.flushQueue();
        this.startHeartbeat();

        this.connectPromise = null;
        // keep listeners for lifetime; we've already added them below
        resolve();
      };

      const onMessage = (ev: MessageEvent) => {
        let data: unknown = ev.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {
            /* keep string */
          }
        }

        // SERIAL: resolve next waiter
        this.awaitingResponse = false;
        const front = this.queue.shift();
        if (front) {
          globalThis.clearTimeout(front.timeoutId);
          front.resolve(data);
        } else {
          this.eventEmitter.emit('message', data);
        }
        this.flushQueue();
      };

      const onClose = (ev: CloseEvent) => {
        this.setStatus('closed');
        this.log('warn', 'WebSocket closed', {
          code: ev.code,
          reason: ev.reason,
        });
        this.stopHeartbeat();
        this.eventEmitter.emit('close', ev);

        // Reject pending
        while (this.queue.length) {
          const it = this.queue.shift()!;
          globalThis.clearTimeout(it.timeoutId);
          it.reject(new Error('Connection closed'));
        }

        cleanup();
        this.ws = null;
        this.connectPromise = null;

        if (!this.manualClose && this.opts.reconnect) {
          this.scheduleReconnect();
        }
      };

      const onError = (err: Event | Error) => {
        const e = err instanceof Error ? err : new Error('WebSocket error');
        this.eventEmitter.emit('error', e);
        this.log('error', 'WebSocket error', e);
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', onMessage);
      ws.addEventListener('close', onClose);
      ws.addEventListener('error', onError);

      // Guard connect wait with a timeout
      const connectTimeout = globalThis.setTimeout(() => {
        if (this.status !== 'open') {
          try {
            ws.close(4000, 'connect-timeout');
          } catch {}
          this.connectPromise = null;
          reject(
            new Error(`Connect timeout after ${this.opts.requestTimeoutMs} ms`),
          );
        }
      }, this.opts.requestTimeoutMs);

      ws.addEventListener(
        'open',
        () => {
          globalThis.clearTimeout(connectTimeout as any);
        },
        { once: true },
      );
    });

    return this.connectPromise;
  }

  async disconnect(code?: number, reason?: string): Promise<void> {
    this.manualClose = true;
    this.setStatus('closing');
    this.stopHeartbeat();
    try {
      this.ws?.close(code, reason);
    } catch {}
    this.ws = null;
    this.setStatus('closed');
    this.connectPromise = null;
  }

  // Overloads: keep a typed path if you add a CommandMap later
  async sendCommand<T = unknown>(command: string | object): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
    const payload =
      typeof command === 'string' ? command : JSON.stringify(command);

    return new Promise<T>((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        if (this.queue[0]?.payload === payload) {
          this.queue.shift();
          this.awaitingResponse = false;
        }
        reject(
          new Error(`Request timed out after ${this.opts.requestTimeoutMs} ms`),
        );
        this.maybeReconnectOnTimeout();
      }, this.opts.requestTimeoutMs) as any;

      this.queue.push({
        payload,
        resolve,
        reject,
        timeoutId,
      } as QueueItem<any>);
      this.flushQueue();
    });
  }

  async getNetwork(): Promise<NetworkResponse> {
    return this.sendCommand<NetworkResponse>('network');
  }

  async getTokens(): Promise<TokensResponse> {
    return this.sendCommand<TokensResponse>('tokens');
  }

  // ===== Internals =====

  private flushQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.awaitingResponse) return;
    const front = this.queue[0];
    if (!front) return;
    this.awaitingResponse = true;
    this.ws.send(front.payload);
  }

  private startHeartbeat() {
    const interval = this.opts.heartbeatIntervalMs;
    if (!interval || interval <= 0) return;
    this.stopHeartbeat();
    this.heartbeatTimer = globalThis.setInterval(async () => {
      // only when idle
      if (this.awaitingResponse || this.queue.length > 0) return;
      try {
        const t0 = nowMs();
        await this.sendCommand('network');
        const rtt = Math.max(0, Math.round(nowMs() - t0));
        this.eventEmitter.emit('heartbeat', { ok: true, rttMs: rtt });
      } catch {
        this.eventEmitter.emit('heartbeat', { ok: false });
        this.maybeReconnectOnTimeout();
      }
    }, interval) as any;
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer != null) {
      globalThis.clearInterval(this.heartbeatTimer as any);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    this.setStatus('reconnecting');
    const base = Math.min(
      this.opts.reconnectMaxDelayMs ?? 12_000,
      (this.opts.reconnectInitialDelayMs ?? 500) *
        Math.pow(2, this.reconnectAttempt++),
    );
    const jitter = base * (this.opts.reconnectJitter ?? 0.2) * Math.random();
    const delay = Math.floor(base + jitter);
    this.eventEmitter.emit('reconnecting', {
      attempt: this.reconnectAttempt,
      delayMs: delay,
    });
    globalThis.setTimeout(() => this.connect().catch(() => {}), delay);
  }

  private maybeReconnectOnTimeout() {
    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.opts.reconnect
    ) {
      this.log('warn', 'Timeout/heartbeat failure; reconnecting');
      try {
        this.ws.close(4001, 'timeout');
      } catch {}
      // onClose will schedule reconnect
    }
  }
}
