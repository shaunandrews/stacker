// The Space's Zero capsule (capsule/server), when there is one: rooms only work on a
// Spacefast Space with the capsule published. On the dev server, or any plain static host,
// connectZero() resolves null and Stacker plays solo.

export interface ZeroApi {
  ready(): Promise<void>;
  userId(): string | null;
  mutate<T>(name: string, ...args: unknown[]): Promise<T>;
  /** A live query: cb runs with each new result (undefined while loading). Returns stop. */
  watch<T>(name: string, args: unknown[], cb: (v: T | undefined) => void): () => void;
}

export interface ZeroConfig {
  realtime?: { mode?: string; centralUrl?: string; url?: string; resourceKey?: string; ticketPath?: string };
}

let pending: Promise<{ api: ZeroApi; config: ZeroConfig } | null> | null = null;

export function connectZero(): Promise<{ api: ZeroApi; config: ZeroConfig } | null> {
  pending ??= (async () => {
    try {
      const res = await fetch('/__zero/config', { headers: { accept: 'application/json' } });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const config = (await res.json()) as ZeroConfig;
      const { createBridge } = await import('./zero-bridge.js');
      const api = createBridge();
      await api.ready();
      return { api, config };
    } catch {
      return null;
    }
  })();
  return pending;
}
