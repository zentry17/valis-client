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
