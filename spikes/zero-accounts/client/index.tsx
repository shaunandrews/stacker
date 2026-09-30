import type { ComponentChildren } from "preact";
export function Layout({ children }: { children: ComponentChildren }) {
  return <main>{children}</main>;
}
