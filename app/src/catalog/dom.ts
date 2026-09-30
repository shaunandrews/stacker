// Tiny DOM helpers for the catalog page.

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string };

/** h('div', { class: 'card', onclick: fn }, 'text', child) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

let toastTimer = 0;
export function toast(msg: string, bad = false): void {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: bad ? 'toast bad' : 'toast' }, msg);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), bad ? 6000 : 2400);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
