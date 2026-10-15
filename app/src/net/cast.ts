// Poses over Spacefast's realtime relay (Cast: Phoenix channels). Every page of a published
// version shares one presence room, and the relay keeps a few fields per visitor. The one
// that carries an arbitrary string is `tool`, cut to 64 characters, so a pose is packed
// into 48 bytes of base64 (pose.ts). Measured: 20 updates a second arrive in order,
// about 80 ms apart from sender to receiver (docs/11). Presence lapses after 45 s
// without an update, so an idle player still sends one every 15 s.

import type { ZeroConfig } from './zero.js';

const MIN_GAP = 50; // ms between updates (20 Hz)
const KEEPALIVE = 15_000;

/** Phoenix room names escape these characters (the relay's own client does the same). */
function escapeKey(k: string): string {
  const map: Record<string, string> = { '~': '~0', '/': '~1', ':': '~2', '\\': '~3', '%': '~4', '\0': '~5' };
  return encodeURIComponent([...k].map((c) => map[c] ?? c).join(''));
}

export class CastPresence {
  /** Each visitor's latest packet, by relay session; missing once they leave. */
  readonly peers = new Map<string, string>();
  onChange: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private topic = '';
  private ref = 1;
  private joinRef = '1';
  private beat = 0;
  private timer = 0;
  private lastSent = 0;
  private sentValue = '';
  private value = '';
  private stopped = false;
  private retry = 1000;

  constructor(private config: ZeroConfig) {}

  async start(): Promise<boolean> {
    this.stopped = false;
    return this.open();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.beat);
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.peers.clear();
  }

  /** Set this player's packet; it goes out at most 20 times a second. */
  set(value: string): void {
    this.value = value;
    this.flush();
  }

  private flush(): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    const now = performance.now();
    const due = this.value !== this.sentValue ? MIN_GAP : KEEPALIVE;
    const wait = this.lastSent + due - now;
    clearTimeout(this.timer);
    if (wait > 0) {
      this.timer = window.setTimeout(() => this.flush(), wait);
      return;
    }
    this.lastSent = now;
    this.sentValue = this.value;
    this.send('presence:update', { tool: this.value });
    this.timer = window.setTimeout(() => this.flush(), KEEPALIVE);
  }

  private send(event: string, payload: object): void {
    this.ws?.send(JSON.stringify([this.joinRef, String(++this.ref), this.topic, event, payload]));
  }

  private async open(): Promise<boolean> {
    const rt = this.config.realtime;
    const base = rt?.centralUrl ?? rt?.url;
    if (!rt?.ticketPath || !rt.resourceKey || !base) return false;
    let token: string;
    let room: string;
    try {
      const res = await fetch(rt.ticketPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ pagePath: location.pathname }),
      });
      const body = (await res.json()) as { data?: { token?: string; room?: string } };
      if (!body.data?.token || !body.data.room) return false;
      token = body.data.token;
      room = body.data.room;
    } catch {
      return false;
    }
    if (this.stopped) return false;
    this.topic = `room:${rt.resourceKey}:${escapeKey(room)}`;
    const ws = new WebSocket(`${base.replace(/\/socket\/?$/, '')}/socket/websocket?vsn=2.0.0`);
    this.ws = ws;
    this.joinRef = String(++this.ref);
    const joined = new Promise<boolean>((resolve) => {
      ws.onopen = () => {
        const id = `stacker:${Math.random().toString(36).slice(2, 10)}`;
        ws.send(JSON.stringify([this.joinRef, this.joinRef, this.topic, 'phx_join', { anonymous_id: id, session_id: id, token }]));
      };
      ws.onmessage = (m) => {
        const f = JSON.parse(m.data as string) as [string | null, string | null, string, string, Record<string, unknown>];
        if (f[3] === 'phx_reply' && f[1] === this.joinRef) resolve((f[4] as { status?: string }).status === 'ok');
        else this.frame(f[3], f[4]);
      };
      ws.onclose = () => {
        resolve(false);
        this.lost(ws);
      };
      window.setTimeout(() => resolve(false), 8000);
    });
    const ok = await joined;
    if (!ok) {
      if (this.ws === ws) ws.close();
      return false;
    }
    this.retry = 1000;
    clearInterval(this.beat);
    this.beat = window.setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify([null, String(++this.ref), 'phoenix', 'heartbeat', {}])), 25_000);
    this.sentValue = '';
    this.lastSent = 0;
    this.flush();
    return true;
  }

  /** The channel or socket went away: forget everyone and come back. */
  private lost(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    clearInterval(this.beat);
    this.peers.clear();
    this.onChange?.();
    if (this.stopped) return;
    window.setTimeout(() => void this.open(), this.retry);
    this.retry = Math.min(this.retry * 2, 15_000);
  }

  private frame(event: string, payload: Record<string, unknown>): void {
    type Metas = Record<string, { metas: Array<{ tool?: string | null }> }>;
    if (event === 'presence_state') {
      this.peers.clear();
      for (const [key, v] of Object.entries(payload as Metas)) {
        const tool = v.metas[v.metas.length - 1]?.tool;
        if (tool) this.peers.set(key, tool);
      }
      this.onChange?.();
    } else if (event === 'presence_diff') {
      const { joins, leaves } = payload as { joins?: Metas; leaves?: Metas };
      for (const key of Object.keys(leaves ?? {})) if (!joins?.[key]) this.peers.delete(key);
      for (const [key, v] of Object.entries(joins ?? {})) {
        const tool = v.metas[v.metas.length - 1]?.tool;
        if (tool) this.peers.set(key, tool);
        else this.peers.delete(key);
      }
      this.onChange?.();
    } else if (event === 'phx_close' || event === 'phx_error') {
      // The relay closes a channel it's done with (e.g. presence lapsed): rejoin.
      const ws = this.ws;
      if (ws) {
        ws.onclose = null;
        ws.close();
        this.lost(ws);
      }
    }
  }
}
