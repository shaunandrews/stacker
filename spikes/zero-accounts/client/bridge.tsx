import { useEffect } from "preact/hooks";
import { useAuth, useMutation, useQuery } from "@spacefast/zero/client";

// "Bridge": a component with no UI that hands Zero's hooks to plain (non-Preact) code
// through window.zero, the way Stacker's own TypeScript would use it.
type Bridge = { auth?: unknown; builds?: unknown; save?: (t: string, d: string, n: number) => Promise<unknown>; onBuilds?: (b: unknown) => void };
declare global { interface Window { zero: Bridge } }
window.zero ??= {};

export function Bridge() {
  const auth = useAuth();
  const builds = useQuery("myBuilds");
  const save = useMutation<[string, string, number], string>("saveBuild");
  useEffect(() => { window.zero.auth = auth; }, [auth]);
  useEffect(() => { window.zero.save = save; }, [save]);
  useEffect(() => { window.zero.builds = builds; window.zero.onBuilds?.(builds); }, [builds]);
  return <p id="bridge">bridge mounted · {auth.isLoading ? "…" : String(auth.userId)} · {Array.isArray(builds) ? builds.length : "?"} builds</p>;
}
