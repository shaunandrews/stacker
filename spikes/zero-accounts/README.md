# Spike: accounts on Spacefast Zero

Throwaway capsule from the accounts spike (Sept 2026). Findings and the plan: [docs/10-accounts.md](../../docs/10-accounts.md).

- `server/index.ts`: a `builds` table owned by `userId()`, a `links` table for phone pairing, a query, a mutation, and HTTP endpoints, plus the `/api/t-*` endpoints used to time request bodies
- `client/bridge.tsx`: a component with no UI that hands Zero's hooks (`useAuth`, `useQuery`, `useMutation`) to plain code through `window.zero`, the way Stacker would use them
- `pages/index.tsx`: mounts the bridge

## Run it

```bash
cd spikes/zero-accounts
npm install
sf dev --port <port from portman> --state-backend sqlite
```

Open the private URL `sf dev` prints (it carries a one-time capability in the hash; requests without the session it sets get 401). Then in the browser console:

```js
await zero.save('test', 'x'.repeat(10 * 1024), 1); // mutation over the realtime socket
zero.builds;                                       // live query result, refreshed after the save
```

Endpoints need the session cookie and, for writes, an `Origin` header matching the dev server.
