// A Vite-bundled page talking to the Space's Zero capsule, the way Stacker would:
// Preact + the SDK bundled here, hooks held by a hidden component (the bridge), and
// everything else plain DOM code.
import { h, render } from "preact";
import { useEffect } from "preact/hooks";
import { authenticatedFetch, signInWithGoogle, signInWithGravatar, signOut, storage, useAuth, useMutation, useQuery } from "@spacefast/zero/client";

type Fn = (...a: unknown[]) => Promise<unknown>;
const z: { storage?: typeof storage; auth?: unknown; who?: unknown; builds?: unknown; pair?: unknown; save?: Fn; createPair?: Fn; claimPair?: Fn } = {};
z.storage = storage;
(window as unknown as { zero: typeof z }).zero = z;
const $ = (id: string) => document.getElementById(id)!;
const log = (...a: unknown[]) => ($("log").textContent = `${new Date().toLocaleTimeString()} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n` + $("log").textContent);

function Bridge() {
  const auth = useAuth();
  const who = useQuery("whoAmI");
  const builds = useQuery("myBuilds");
  const pair = useQuery("myPair");
  z.save = useMutation("saveBuild") as Fn;
  z.createPair = useMutation("createPair") as Fn;
  z.claimPair = useMutation("claimPair") as Fn;
  useEffect(() => {
    z.auth = auth;
    const a = auth as { isLoading?: boolean; userId?: string; isGuest?: boolean; isSignedIn?: boolean; displayName?: string; provider?: string; error?: string };
    $("who").textContent = JSON.stringify({ userId: a.userId, isGuest: a.isGuest, isSignedIn: a.isSignedIn, displayName: a.displayName, provider: a.provider, error: a.error, server: who }, null, 1);
  }, [auth, who]);
  useEffect(() => {
    z.builds = builds;
    $("builds").textContent = Array.isArray(builds) ? builds.map((b: { title: string; bytes: number }) => `${b.title} · ${b.bytes} bytes`).join("\n") || "none yet" : "loading…";
  }, [builds]);
  useEffect(() => {
    z.pair = pair;
    const p = pair as { code: string; account: string | null } | null | undefined;
    if (p) $("pairOut").textContent = p.account ? `Code ${p.code} claimed by ${p.account}` : `Code ${p.code} waiting to be claimed`;
  }, [pair]);
  return null;
}
const mount = document.createElement("div");
mount.hidden = true;
document.body.append(mount);
render(h(Bridge, null), mount);

const go = async (p: Promise<{ url: string }>) => {
  try {
    const { url } = await p;
    log("redirecting to sign-in");
    location.href = url;
  } catch (e) {
    log("sign-in failed", String(e));
  }
};
$("google").onclick = () => void go(signInWithGoogle({ returnTo: location.pathname + location.search }));
$("gravatar").onclick = () => void go(signInWithGravatar({ returnTo: location.pathname + location.search }));
$("out").onclick = () => void signOut().then(() => log("signed out"), (e) => log("sign-out failed", String(e)));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-kb]")) {
  b.onclick = async () => {
    const kb = Number(b.dataset.kb);
    const t0 = performance.now();
    try {
      await z.save!(`lab ${kb} KB`, "x".repeat(kb * 1024 - 64), kb);
      log(`saved ${kb} KB in ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      log(`save ${kb} KB failed after ${Math.round(performance.now() - t0)} ms:`, String((e as Error).message ?? e));
    }
  };
}
$("pair").onclick = async () => {
  try {
    $("code").textContent = String(await z.createPair!());
  } catch (e) {
    log("pair failed", String(e));
  }
};
$("claimBtn").onclick = async () => {
  try {
    log("claimed", await z.claimPair!(($("claim") as HTMLInputElement).value));
  } catch (e) {
    log("claim failed", String((e as Error).message ?? e));
  }
};
authenticatedFetch("/api/me").then((r) => r.json()).then((d) => log("GET /api/me via authenticatedFetch", d), (e) => log("authenticatedFetch failed", String(e)));
