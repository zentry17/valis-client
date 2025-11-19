type ValisClientStatus$1 = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closing' | 'closed';
type NetworkResponse$1 = {
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
type TokensResponse$1 = {
    assets: string[];
    utc: number;
    chainlag: number;
    result: 'success' | string;
};
type ValisClientOptions$1 = {
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
    onLog?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
};
type Events$1 = {
    open: Event;
    close: CloseEvent;
    error: Error;
    message: unknown;
    reconnecting: {
        attempt: number;
        delayMs: number;
    };
    heartbeat: {
        ok: boolean;
        rttMs?: number;
    };
};

type ValisClientStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closing' | 'closed';
type NetworkResponse = {
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
type TokensResponse = {
    assets: string[];
    utc: number;
    chainlag: number;
    result: 'success' | string;
};
type ValisClientOptions = {
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
    onLog?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
};
type Events = {
    open: Event;
    close: CloseEvent;
    error: Error;
    message: unknown;
    reconnecting: {
        attempt: number;
        delayMs: number;
    };
    heartbeat: {
        ok: boolean;
        rttMs?: number;
    };
};
declare class ValisClient {
    private url;
    private opts;
    private ws;
    private ee;
    private status;
    private reconnectAttempt;
    private connectPromise;
    private heartbeatTimer;
    private awaitingResponse;
    private manualClose;
    private queue;
    constructor(url: string, opts?: ValisClientOptions);
    getStatus(): ValisClientStatus;
    on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): () => void;
    private setStatus;
    private log;
    connect(): Promise<void>;
    disconnect(code?: number, reason?: string): Promise<void>;
    sendCommand<T = unknown>(command: string | object): Promise<T>;
    getNetwork(): Promise<NetworkResponse>;
    getTokens(): Promise<TokensResponse>;
    private flushQueue;
    private startHeartbeat;
    private stopHeartbeat;
    private scheduleReconnect;
    private maybeReconnectOnTimeout;
}

export { type Events$1 as Events, type NetworkResponse$1 as NetworkResponse, type TokensResponse$1 as TokensResponse, ValisClient, type ValisClientOptions$1 as ValisClientOptions, type ValisClientStatus$1 as ValisClientStatus };
