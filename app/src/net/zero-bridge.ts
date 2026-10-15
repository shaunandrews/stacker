// Zero's browser client is hooks-only, so a hidden Preact tree holds them and hands plain
// functions to Stacker (loaded only when the page is served by a Zero Space; see zero.ts).
import { h, render } from 'preact';
import { useEffect } from 'preact/hooks';
import { useAuth, useMutation, useQuery } from '@spacefast/zero/client';
import type { ZeroApi } from './zero.js';

const MUTATIONS = ['createRoom', 'joinRoom', 'heartbeat', 'leaveRoom', 'pushEdit', 'putSnapshot', 'signal', 'ackSignals'] as const;

type Fn = (...args: unknown[]) => Promise<unknown>;

export function createBridge(): ZeroApi {
  const host = document.createElement('div');
  host.hidden = true;
  document.body.append(host);
  const muts = new Map<string, Fn>();
  let user: string | null = null;
  let ready!: () => void;
  const whenReady = new Promise<void>((r) => (ready = r));

  function Mutations() {
    for (const name of MUTATIONS) muts.set(name, useMutation(name) as Fn);
    const auth = useAuth();
    useEffect(() => {
      if (auth.isLoading) return;
      user = auth.userId ?? null;
      ready();
    }, [auth.isLoading, auth.userId]);
    return null;
  }
  const core = document.createElement('div');
  host.append(core);
  render(h(Mutations, null), core);

  function Watch(p: { name: string; args: unknown[]; cb: (v: unknown) => void }) {
    const v = useQuery(p.name, ...p.args);
    useEffect(() => p.cb(v), [v]);
    return null;
  }

  return {
    ready: () => whenReady,
    userId: () => user,
    async mutate<T>(name: string, ...args: unknown[]): Promise<T> {
      await whenReady;
      const fn = muts.get(name);
      if (!fn) throw new Error(`No mutation ${name}`);
      return (await fn(...args)) as T;
    },
    watch<T>(name: string, args: unknown[], cb: (v: T | undefined) => void): () => void {
      const mount = document.createElement('div');
      host.append(mount);
      render(h(Watch, { name, args, cb: cb as (v: unknown) => void }), mount);
      return () => {
        render(null, mount);
        mount.remove();
      };
    },
  };
}
