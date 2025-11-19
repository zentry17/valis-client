import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValisClient } from '../valis-client'; // <-- adjust if your path differs

type Listener = (ev?: any) => void;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners: Record<string, Set<Listener>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent('open', new Event('open'));
    });
  }

  addEventListener(type: string, l: Listener) {
    this.listeners[type]?.add(l);
  }
  removeEventListener(type: string, l: Listener) {
    this.listeners[type]?.delete(l);
  }
  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) throw new Error('not open');
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent('close', {
      code: code ?? 1000,
      reason: reason ?? 'closed',
      wasClean: true,
    } as CloseEvent);
  }
  dispatchEvent(type: 'open' | 'message' | 'close' | 'error', ev?: any) {
    this.listeners[type]?.forEach((l) => l(ev));
  }
  emitJson(obj: unknown) {
    this.dispatchEvent('message', { data: JSON.stringify(obj) });
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket); // ✅ no redeclare, just stub
  MockWebSocket.instances.length = 0;
});

describe('ValisClient (serial queue)', () => {
  it('sends in order', async () => {
    const client = new ValisClient('wss://test', {
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 5000,
    });
    await client.connect();

    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    const ws = MockWebSocket.instances.at(-1)!;

    const p1 = client.sendCommand<any>('network');
    const p2 = client.sendCommand<any>('tokens');

    expect(ws.sent).toEqual(['network']);

    ws.emitJson({ ok: 1 });
    await expect(p1).resolves.toEqual({ ok: 1 });

    expect(ws.sent).toEqual(['network', 'tokens']);

    ws.emitJson({ ok: 2 });
    await expect(p2).resolves.toEqual({ ok: 2 });
  });

  it('times out then reconnects', async () => {
    const client = new ValisClient('wss://timeout', {
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 10,
      reconnectInitialDelayMs: 1,
      reconnectMaxDelayMs: 2,
    });

    await client.connect();
    const ws = MockWebSocket.instances.at(-1)!;

    const p = client.sendCommand<any>('network');
    await expect(p).rejects.toThrow(/timed out/i);

    expect(ws.readyState).toBe(MockWebSocket.CLOSED);

    await new Promise((r) => setTimeout(r, 5));
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    const ws2 = MockWebSocket.instances.at(-1)!;
    expect(ws2.readyState).toBe(MockWebSocket.OPEN);
  });

  it('emits heartbeat', async () => {
    const client = new ValisClient('wss://hb', {
      heartbeatIntervalMs: 5,
      requestTimeoutMs: 100,
    });
    const hb = vi.fn();
    client.on('heartbeat', hb);

    await client.connect();
    const ws = MockWebSocket.instances.at(-1)!;

    await new Promise((r) => setTimeout(r, 8));
    expect(ws.sent.includes('network')).toBe(true);

    ws.emitJson({ beat: 'ok' });
    await new Promise((r) => setTimeout(r, 0));

    expect(hb).toHaveBeenCalled();
    expect(hb.mock.calls.at(-1)?.[0].ok).toBe(true);
  });
});
