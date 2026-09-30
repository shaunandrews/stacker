import { analyzeAll, auditAll } from './audit.js';
import type { Issue, KitAnalysis } from './audit.js';
import { api, loadCatalog } from './data.js';
import type { Catalog } from './data.js';
import { clear, h, toast } from './dom.js';
import { kitsView, kitView } from './kit-view.js';
import { Materials, Thumbnailer } from './render.js';
import { colorsView, finishesView, overview, partsView } from './views.js';

// Stacker catalog: browse and audit parts, colors, finishes and kits (catalog.html).
// Routes live in the hash: #/parts/3004, #/kits/374-1/12 …

export interface Ctx {
  cat: Catalog;
  mats: Materials;
  thumbs: Thumbnailer;
  analyses: Map<string, KitAnalysis>;
  issues: Issue[];
  /** Recompute the audit after data changed. */
  refresh(): void;
  /** Save review marks (dev server only). */
  saveReview(): Promise<void>;
  go(hash: string): void;
}

const nav = document.getElementById('nav')!;
const view = document.getElementById('view')!;
let cleanup: (() => void) | null = null;

async function boot(): Promise<void> {
  let cat: Catalog;
  try {
    cat = await loadCatalog();
  } catch (err) {
    clear(view, h('div', { class: 'loading' }, `Couldn’t load the catalog: ${(err as Error).message}`));
    return;
  }
  const mats = new Materials(cat.lib);
  const ctx: Ctx = {
    cat,
    mats,
    thumbs: new Thumbnailer(cat.lib, mats),
    analyses: new Map(),
    issues: [],
    refresh() {
      ctx.analyses = analyzeAll(cat);
      ctx.issues = auditAll(cat, ctx.analyses);
      drawNav(ctx);
    },
    async saveReview() {
      if (!cat.canEdit) return;
      try {
        await api('review', cat.review);
      } catch (err) {
        toast(`Couldn’t save the review: ${(err as Error).message}`, true);
      }
    },
    go(hash) {
      if (location.hash === hash) route(ctx);
      else location.hash = hash;
    },
  };
  ctx.refresh();
  (window as unknown as { catalog: Ctx }).catalog = ctx; // for poking at from devtools
  window.addEventListener('hashchange', () => route(ctx));
  route(ctx);
}

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'parts', label: 'Parts' },
  { id: 'colors', label: 'Colors' },
  { id: 'finishes', label: 'Finishes' },
  { id: 'kits', label: 'Kits' },
] as const;

function drawNav(ctx: Ctx): void {
  const here = location.hash.split('/')[1] || 'overview';
  const { cat } = ctx;
  const counts: Record<string, number> = { parts: cat.lib.parts.length, colors: cat.lib.colors.length, finishes: 3, kits: cat.kits.length };
  const problems = (area: string) => ctx.issues.filter((i) => i.area === area && i.level !== 'info').length;
  clear(
    nav,
    h('a', { class: 'brand', href: '#/overview' }, h('i', null, h('b'), h('b'), h('b'), h('b')), h('span', null, 'Stacker', h('small', null, 'Catalog & audit'))),
    SECTIONS.map((s) => {
      const bad = s.id === 'parts' ? problems('Parts') : s.id === 'colors' ? problems('Colors') : s.id === 'kits' ? problems('Kits') : 0;
      return h(
        'a',
        { class: `item${here === s.id ? ' on' : ''}`, href: `#/${s.id}` },
        s.label,
        bad ? h('span', { class: 'dot warn', title: `${bad} to look at` }) : null,
        h('span', { class: 'count' }, counts[s.id] ?? ''),
      );
    }),
    h('div', { class: 'grow' }),
    h('a', { class: 'item', href: './' }, 'Open Stacker ↗'),
    h(
      'div',
      { class: `mode${cat.canEdit ? ' edit' : ''}` },
      h('b', null, cat.canEdit ? 'Editing on' : 'Read-only'),
      cat.canEdit ? 'Local dev server: edits save to the repo.' : 'Run the dev server locally to edit.',
    ),
  );
}

function route(ctx: Ctx): void {
  cleanup?.();
  cleanup = null;
  const [, section = 'overview', a, b] = location.hash.split('/').map(decodeURIComponent);
  drawNav(ctx);
  window.scrollTo(0, 0);
  view.replaceChildren();
  switch (section) {
    case 'parts':
      cleanup = partsView(ctx, view, a);
      break;
    case 'colors':
      cleanup = colorsView(ctx, view, a);
      break;
    case 'finishes':
      cleanup = finishesView(ctx, view);
      break;
    case 'kits':
      cleanup = a ? kitView(ctx, view, a, Number(b) || 1) : kitsView(ctx, view);
      break;
    default:
      cleanup = overview(ctx, view);
  }
}

void boot();
