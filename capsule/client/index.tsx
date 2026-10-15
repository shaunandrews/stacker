import type { ComponentChildren } from "preact";

// Stacker itself is the static app at `/`; the capsule's own pages (like /rooms) use this layout.
export function Layout({ children }: { children: ComponentChildren }) {
  return <main style={{ font: "15px/1.5 system-ui, sans-serif", maxWidth: "36rem", margin: "3rem auto", padding: "0 16px" }}>{children}</main>;
}
