import { TABS } from '../blocks.js';
import { FINISHES } from '../look.js';
import { LEVEL_ORDER, triangles, usage, worst } from './audit.js';
import type { Issue, Level } from './audit.js';
import { api } from './data.js';
import type { Mark } from './data.js';
import { clear, h, toast } from './dom.js';
import type { Ctx } from './main.js';
import { lazyImg, Viewer } from './render.js';

// Overview, Parts, Colors and Finishes. Each view returns its cleanup.

const LEVEL_LABEL: Record<Level, string> = { error: 'Error', warn: 'Check', info: 'Note' };

export function levelBadges(issues: Issue[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const level of ['error', 'warn'] as Level[]) {
    const n = issues.filter((i) => i.level === level).length;
    if (n) out.push(h('span', { class: `badge ${level}`, title: issues.filter((i) => i.level === level).map((i) => i.msg).join('\n') }, `${n} ${LEVEL_LABEL[level].toLowerCase()}`));
  }
  return out;
}

export function issueList(issues: Issue[]): HTMLElement {
  if (!issues.length) return h('div', { class: 'issue muted' }, h('span', { class: 'dot ok' }), 'No problems found');
  return h(
    'div',
    { class: 'issue-list' },
    [...issues].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]).map((i) => h('div', { class: 'issue' }, h('span', { class: `dot ${i.level}` }), h('span', null, i.msg))),
  );
}

/** "Looks right" / "Flag" with a note; read-only shows the mark. */
export function reviewControl(ctx: Ctx, get: () => Mark | undefined, set: (m: Mark | undefined) => void, onChange?: () => void): HTMLElement {
  const box = h('div', { class: 'stack', style: 'gap:8px' });
  const draw = () => {
    const m = get();
    if (!ctx.cat.canEdit) {
      clear(
        box,
        h('div', { class: 'review' }, m ? h('span', { class: `badge ${m.s === 'ok' ? 'ok' : 'warn'}` }, m.s === 'ok' ? 'Looks right' : 'Flagged') : h('span', { class: 'badge' }, 'Not reviewed')),
        m?.note ? h('div', { class: 'muted' }, m.note) : null,
      );
      return;
    }
    const pick = (s: Mark['s']) => {
      set(m?.s === s ? undefined : { s, note: m?.note });
      void ctx.saveReview();
      draw();
      onChange?.();
    };
    clear(
      box,
      h(
        'div',
        { class: 'review' },
        h('button', { class: `btn sm${m?.s === 'ok' ? ' on' : ''}`, onclick: () => pick('ok') }, '✓ Looks right'),
        h('button', { class: `btn sm${m?.s === 'flag' ? ' on' : ''}`, onclick: () => pick('flag') }, '⚑ Flag'),
      ),
      m?.s === 'flag'
        ? h('textarea', {
            placeholder: 'What’s wrong?',
            value: m.note ?? '',
            onchange: (e: Event) => {
              set({ s: 'flag', note: (e.target as HTMLTextAreaElement).value.trim() || undefined });
              void ctx.saveReview();
            },
          })
        : null,
    );
  };
  draw();
  return box;
}

function reviewedShare(marks: Record<string, Mark>, total: number): { ok: number; flag: number; total: number } {
  const v = Object.values(marks);
  return { ok: v.filter((m) => m.s === 'ok').length, flag: v.filter((m) => m.s === 'flag').length, total };
}

function progressBar(parts: Array<[number, string]>, total: number): HTMLElement {
  return h('div', { class: 'bar' }, parts.map(([n, color]) => h('span', { style: `width:${(n / Math.max(1, total)) * 100}%;background:${color}` })));
}

// ================================================================ overview

export function overview(ctx: Ctx, view: HTMLElement): () => void {
  const { cat } = ctx;
  let area: string = 'all';
  let level: Level | 'all' = 'all';
  const table = h('div', { class: 'card' });
  const filters = h('div', { class: 'toolbar' });
  const steps = cat.kits.flatMap((k) => k.file.origin ?? k.file.steps.map(() => 'auto'));
  const origins = { file: steps.filter((o) => o === 'file').length, auto: steps.filter((o) => o === 'auto').length, edit: steps.filter((o) => o === 'edit').length };
  const kitMarks = Object.values(cat.review.kits).flatMap((k) => Object.values(k.steps));

  const stat = (href: string, label: string, big: string | number, areaName: string, extra: HTMLElement | null) =>
    h(
      'a',
      { class: 'card stat', href },
      h('h3', null, label),
      h('div', { class: 'big' }, big),
      h('div', { class: 'row' }, levelBadges(ctx.issues.filter((i) => i.area === areaName)), ctx.issues.some((i) => i.area === areaName && i.level !== 'info') ? null : h('span', { class: 'badge ok' }, 'All clear')),
      extra,
    );
  const pr = reviewedShare(cat.review.parts, cat.lib.parts.length);
  const cr = reviewedShare(cat.review.colors, cat.lib.colors.length);

  const drawTable = () => {
    const list = ctx.issues
      .filter((i) => (area === 'all' || i.area === area) && (level === 'all' || i.level === level))
      .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    const areas = ['all', 'Parts', 'Colors', 'Kits'];
    clear(
      filters,
      areas.map((a) => h('button', { class: `chip${area === a ? ' on' : ''}`, onclick: () => ((area = a), drawTable()) }, a === 'all' ? 'Everything' : a, h('span', { class: 'n' }, ctx.issues.filter((i) => a === 'all' || i.area === a).length))),
      h('span', { class: 'faint', style: 'margin:0 4px' }, '·'),
      (['all', 'error', 'warn', 'info'] as const).map((l) =>
        h('button', { class: `chip${level === l ? ' on' : ''}`, onclick: () => ((level = l), drawTable()) }, l === 'all' ? 'Any level' : LEVEL_LABEL[l], h('span', { class: 'n' }, ctx.issues.filter((i) => (l === 'all' || i.level === l) && (area === 'all' || i.area === area)).length)),
      ),
    );
    clear(
      table,
      list.length
        ? h(
            'table',
            { class: 'issues' },
            list.slice(0, 400).map((i) =>
              h(
                'tr',
                { class: 'link', onclick: () => ctx.go(i.href) },
                h('td', { style: 'width:80px' }, h('span', { class: `badge ${i.level}` }, LEVEL_LABEL[i.level])),
                h('td', { class: 'what' }, i.subject),
                h('td', null, i.msg),
              ),
            ),
          )
        : h('div', { class: 'pad muted' }, 'Nothing here.'),
    );
  };
  drawTable();

  view.append(
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Overview'), h('div', { class: 'sub' }, 'Everything Stacker ships: parts, colors, finishes, kits and their instructions.'))),
    h(
      'div',
      { class: 'callout' },
      h('b', null, 'Where kit instructions come from'),
      h(
        'p',
        null,
        `Kits are fan-made LDraw models from the Official Model Repository, not LEGO’s booklets. Steps the modeller marked are kept (`,
        h('b', { style: 'color:var(--file)' }, `${origins.file} from the file`),
        `). Steps over 6 pieces, and models with no steps at all, are chopped bottom-up by tools/build-kit.py (`,
        h('b', { style: 'color:var(--auto)' }, `${origins.auto} generated`),
        `)${origins.edit ? `; ${origins.edit} were edited here` : ''}. Generated steps don’t know what holds what, so they’re where pieces float.`,
      ),
    ),
    h(
      'div',
      { class: 'stats' },
      stat('#/parts', 'Parts', cat.lib.parts.length, 'Parts', h('div', { class: 'stack', style: 'gap:4px' }, progressBar([[pr.ok, 'var(--ok)'], [pr.flag, 'var(--warn)']], pr.total), h('span', { class: 'faint' }, `${pr.ok + pr.flag} of ${pr.total} reviewed`))),
      stat('#/colors', 'Colors', cat.lib.colors.length, 'Colors', h('div', { class: 'stack', style: 'gap:4px' }, progressBar([[cr.ok, 'var(--ok)'], [cr.flag, 'var(--warn)']], cr.total), h('span', { class: 'faint' }, `${cr.ok + cr.flag} of ${cr.total} reviewed`))),
      h('a', { class: 'card stat', href: '#/finishes' }, h('h3', null, 'Finishes'), h('div', { class: 'big' }, FINISHES.length), h('span', { class: 'faint' }, FINISHES.map((f) => f.label).join(' · '))),
      stat(
        '#/kits',
        'Kits',
        cat.kits.length,
        'Kits',
        h(
          'div',
          { class: 'stack', style: 'gap:4px' },
          progressBar([[origins.file, 'var(--file)'], [origins.auto, 'var(--auto)'], [origins.edit, 'var(--edit)']], steps.length),
          h('span', { class: 'faint' }, `${steps.length} steps · ${kitMarks.length} reviewed`),
        ),
      ),
    ),
    h('div', { class: 'head', style: 'margin-bottom:10px' }, h('h2', null, 'Issues')),
    filters,
    table,
  );
  return () => {};
}

// ================================================================ parts

export function partsView(ctx: Ctx, view: HTMLElement, selected?: string): () => void {
  const { cat } = ctx;
  const { lib } = cat;
  const use = usage(cat);
  let q = '';
  let tab = 'All';
  let filter: 'all' | 'issues' | 'unreviewed' | 'flagged' = 'all';
  let color = lib.colorIndex.get(4) ?? 0; // red reads best in a grid
  let sel = selected && lib.byId.has(selected) ? selected : null;
  const grid = h('div', { class: 'grid' });
  const toolbar = h('div', { class: 'toolbar' });
  const detail = h('div', { class: 'card detail' });
  const viewer = new Viewer(lib, ctx.mats);
  const issuesFor = (id: string) => ctx.issues.filter((i) => i.area === 'Parts' && i.key === id);

  const matches = (i: number) => {
    const p = lib.parts[i];
    if (tab !== 'All' && p.tab !== tab) return false;
    if (q && !`${p.name} ${p.id}`.toLowerCase().includes(q)) return false;
    if (filter === 'issues' && !issuesFor(p.id).some((x) => x.level !== 'info')) return false;
    if (filter === 'unreviewed' && cat.review.parts[p.id]) return false;
    if (filter === 'flagged' && cat.review.parts[p.id]?.s !== 'flag') return false;
    return true;
  };

  const drawToolbar = () => {
    const count = (t: string) => lib.parts.filter((p) => t === 'All' || p.tab === t).length;
    clear(
      toolbar,
      h('input', { type: 'search', placeholder: 'Search name or id', value: q, style: 'width:220px', oninput: (e: Event) => ((q = (e.target as HTMLInputElement).value.toLowerCase().trim()), drawGrid()) }),
      h(
        'select',
        { onchange: (e: Event) => ((filter = (e.target as HTMLSelectElement).value as typeof filter), drawGrid()) },
        [
          ['all', 'All parts'],
          ['issues', 'With problems'],
          ['unreviewed', 'Not reviewed'],
          ['flagged', 'Flagged'],
        ].map(([v, l]) => h('option', { value: v, selected: filter === v }, l)),
      ),
      h(
        'select',
        { title: 'Thumbnail color', onchange: (e: Event) => ((color = Number((e.target as HTMLSelectElement).value)), drawGrid(), drawDetail()) },
        lib.colors.map((c, i) => h('option', { value: i, selected: i === color }, c.name)),
      ),
      h('div', { style: 'flex-basis:100%;height:0' }),
      ['All', ...TABS].map((t) => h('button', { class: `chip${tab === t ? ' on' : ''}`, onclick: () => ((tab = t), drawToolbar(), drawGrid()) }, t, h('span', { class: 'n' }, count(t)))),
    );
  };

  const drawGrid = () => {
    const tiles = lib.parts
      .map((p, i) => ({ p, i }))
      .filter(({ i }) => matches(i))
      .map(({ p, i }) => {
        const iss = issuesFor(p.id);
        const w = worst(iss.filter((x) => x.level !== 'info'));
        const mark = cat.review.parts[p.id];
        const kits = use.parts.get(p.id);
        return h(
          'div',
          { class: `card tile${sel === p.id ? ' sel' : ''}`, 'data-id': p.id, onclick: () => select(p.id) },
          h(
            'div',
            { class: 'thumb' },
            lazyImg(() => ctx.thumbs.part(i, color), p.name),
            h('div', { class: 'corner' }, w ? h('span', { class: `dot ${w}`, title: iss.map((x) => x.msg).join('\n') }) : null),
            h('div', { class: 'left' }, mark ? h('span', { class: `badge ${mark.s === 'ok' ? 'ok' : 'warn'}` }, mark.s === 'ok' ? '✓' : '⚑') : null),
          ),
          h(
            'div',
            { class: 'meta' },
            h('div', { class: 'name' }, p.name),
            h('div', { class: 'sub' }, h('span', { class: 'mono' }, p.id), '·', p.tab, kits ? h('span', { title: 'Kit pieces' }, `· ${[...kits.values()].reduce((a, b) => a + b, 0)} in kits`) : null),
          ),
        );
      });
    clear(grid, tiles.length ? tiles : h('div', { class: 'muted' }, 'No parts match.'));
  };

  const drawDetail = () => {
    if (!sel) {
      clear(detail, h('div', { class: 'pad muted' }, 'Pick a part to see it in 3D, its connectors, where kits use it, and what the audit found.'));
      return;
    }
    const i = lib.byId.get(sel)!;
    const p = lib.parts[i];
    const studs = (p.conn ?? []).filter((c) => c[0] === 0).length;
    const sockets = (p.conn ?? []).length - studs;
    const kits = use.parts.get(p.id);
    let showConn = true;
    const connBtn = h('button', { class: 'btn sm on' }, 'Connectors');
    connBtn.onclick = () => {
      showConn = !showConn;
      connBtn.classList.toggle('on', showConn);
      viewer.showPart(i, color, 0, showConn);
    };
    const name = h('input', { type: 'text', value: p.name, disabled: !cat.canEdit });
    const tabSel = h('select', { disabled: !cat.canEdit }, TABS.map((t) => h('option', { value: t, selected: p.tab === t }, t)));
    const save = h('button', { class: 'btn primary', disabled: true }, 'Save');
    const dirty = () => (save.disabled = name.value.trim() === p.name && tabSel.value === p.tab);
    name.oninput = dirty;
    tabSel.onchange = dirty;
    save.onclick = async () => {
      save.disabled = true;
      try {
        const r = await api<{ file: string }>('part', { id: p.id, name: name.value.trim(), tab: tabSel.value });
        p.name = name.value.trim();
        p.tab = tabSel.value;
        toast(`Saved to ${r.file}`);
        ctx.refresh();
        drawToolbar();
        drawGrid();
        drawDetail();
      } catch (err) {
        toast((err as Error).message, true);
        dirty();
      }
    };
    clear(
      detail,
      h('div', { class: 'viewer' }, viewer.canvas, h('div', { class: 'over' }, connBtn, h('span', { class: 'badge', style: 'background:rgb(0 0 0 / .35);color:#fff' }, '● stud ', h('span', { style: 'color:#f28a3d' }, '● socket')))),
      h(
        'div',
        { class: 'pad stack' },
        h('div', null, h('h2', null, p.name), h('div', { class: 'muted mono' }, p.id)),
        h('div', { class: 'field' }, 'Name', name),
        h('div', { class: 'field' }, 'Library tab', tabSel),
        cat.canEdit ? h('div', { class: 'row' }, save, h('span', { class: 'faint' }, 'Writes the tools/ part list and parts.json')) : null,
        h(
          'dl',
          { class: 'props' },
          h('dt', null, 'Footprint'),
          h('dd', null, `${p.w} × ${p.d} studs, ${p.h / 2} plates tall`),
          h('dt', null, 'Connectors'),
          h('dd', null, `${studs} studs · ${sockets} sockets`),
          h('dt', null, 'Mesh'),
          h('dd', null, `${triangles(lib, i).toLocaleString()} triangles · ${p.vertices.toLocaleString()} vertices`),
          p.fixed ? [h('dt', null, 'Printed'), h('dd', null, 'Has fixed-color regions')] : null,
          p.joint ? [h('dt', null, 'Joint'), h('dd', null, `${p.joint.role} of ${p.joint.pair}`)] : null,
          p.hinge ? [h('dt', null, 'Swings'), h('dd', null, p.hinge.r ? `${p.hinge.r[0]}° to ${p.hinge.r[1]}°` : 'Turns freely')] : null,
          h('dt', null, 'In kits'),
          h(
            'dd',
            null,
            kits
              ? [...kits.entries()].map(([id, n], k) => [k ? ', ' : '', h('a', { href: `#/kits/${id}/${firstStep(ctx, id, p.id)}`, style: 'color:var(--accent)' }, `${cat.kits.find((x) => x.info.id === id)!.info.title} ×${n}`)])
              : h('span', { class: 'faint' }, 'None'),
          ),
        ),
        h('h3', null, 'Audit'),
        issueList(issuesFor(p.id)),
        reviewControl(
          ctx,
          () => cat.review.parts[p.id],
          (m) => (m ? (cat.review.parts[p.id] = m) : delete cat.review.parts[p.id]),
          drawGrid,
        ),
      ),
    );
    viewer.showPart(i, color, 0, showConn);
  };

  const select = (id: string) => {
    sel = id;
    history.replaceState(null, '', `#/parts/${encodeURIComponent(id)}`);
    for (const t of grid.querySelectorAll('.tile')) t.classList.toggle('sel', (t as HTMLElement).dataset.id === id);
    drawDetail();
  };

  view.append(
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Parts'), h('div', { class: 'sub' }, `${lib.parts.length} LDraw parts in ${TABS.length} library tabs, rendered with the app’s own geometry.`))),
    toolbar,
    h('div', { class: 'split' }, grid, detail),
  );
  drawToolbar();
  drawGrid();
  drawDetail();
  if (sel) requestAnimationFrame(() => grid.querySelector('.tile.sel')?.scrollIntoView({ block: 'center' }));
  return () => viewer.dispose();
}

function firstStep(ctx: Ctx, kit: string, part: string): number {
  const steps = ctx.cat.kits.find((k) => k.info.id === kit)!.file.steps;
  return steps.findIndex((s) => s.some((b) => b.part === part)) + 1;
}

// ================================================================ colors

export function colorsView(ctx: Ctx, view: HTMLElement, selected?: string): () => void {
  const { cat } = ctx;
  const { lib } = cat;
  const use = usage(cat);
  const brick = lib.byId.get('3001') ?? 0; // Brick 2 x 4
  let sel = selected !== undefined && lib.colorIndex.has(Number(selected)) ? Number(selected) : null;
  const grid = h('div', { class: 'grid' });
  const detail = h('div', { class: 'card detail' });
  const viewer = new Viewer(lib, ctx.mats);
  const issuesFor = (code: number) => ctx.issues.filter((i) => i.area === 'Colors' && i.key === String(code));

  const drawGrid = () =>
    clear(
      grid,
      lib.colors.map((c, i) => {
        const n = [...(use.colors.get(c.code)?.values() ?? [])].reduce((a, b) => a + b, 0);
        const w = worst(issuesFor(c.code).filter((x) => x.level !== 'info'));
        const mark = cat.review.colors[c.code];
        return h(
          'div',
          { class: `card tile${sel === c.code ? ' sel' : ''}`, 'data-code': c.code, onclick: () => select(c.code) },
          h('div', { class: `swatch${c.alpha < 1 ? ' trans' : ''}` }, h('span', { style: `background:${c.hex};opacity:${c.alpha}` })),
          h(
            'div',
            { class: 'thumb', style: 'aspect-ratio:16/10' },
            lazyImg(() => ctx.thumbs.part(brick, i), c.name),
            h('div', { class: 'corner' }, w ? h('span', { class: `dot ${w}` }) : null),
            h('div', { class: 'left' }, mark ? h('span', { class: `badge ${mark.s === 'ok' ? 'ok' : 'warn'}` }, mark.s === 'ok' ? '✓' : '⚑') : null),
          ),
          h(
            'div',
            { class: 'meta' },
            h('div', { class: 'name' }, c.name),
            h('div', { class: 'sub' }, h('span', { class: 'mono' }, `#${c.code}`), '·', h('span', { class: 'mono' }, c.hex), c.alpha < 1 ? h('span', { class: 'badge' }, 'trans') : null),
            h('div', { class: 'sub' }, n ? `${n} kit pieces` : h('span', { class: 'faint' }, 'Library only')),
          ),
        );
      }),
    );

  const drawDetail = () => {
    if (sel === null) {
      clear(detail, h('div', { class: 'pad muted' }, 'Pick a color to see it on a brick in 3D and where kits use it.'));
      return;
    }
    const i = lib.colorIndex.get(sel)!;
    const c = lib.colors[i];
    const kits = use.colors.get(c.code);
    clear(
      detail,
      h('div', { class: 'viewer' }, viewer.canvas),
      h(
        'div',
        { class: 'pad stack' },
        h('div', null, h('h2', null, c.name), h('div', { class: 'muted mono' }, `LDraw ${c.code} · ${c.hex}${c.alpha < 1 ? ` · ${Math.round(c.alpha * 100)}% opaque` : ''}`)),
        h('dl', { class: 'props' }, h('dt', null, 'Renders as'), h('dd', null, c.alpha < 1 ? 'Clear finish (see-through colors always are)' : 'Chosen finish'), h('dt', null, 'In kits'), h('dd', null, kits ? [...kits.entries()].map(([id, n], k) => [k ? ', ' : '', h('a', { href: `#/kits/${id}`, style: 'color:var(--accent)' }, `${cat.kits.find((x) => x.info.id === id)!.info.title} ×${n}`)]) : h('span', { class: 'faint' }, 'None'))),
        h('h3', null, 'Audit'),
        issueList(issuesFor(c.code)),
        reviewControl(
          ctx,
          () => cat.review.colors[c.code],
          (m) => (m ? (cat.review.colors[c.code] = m) : delete cat.review.colors[c.code]),
          drawGrid,
        ),
      ),
    );
    viewer.showPart(brick, i, 0, false);
  };

  const select = (code: number) => {
    sel = code;
    history.replaceState(null, '', `#/colors/${code}`);
    for (const t of grid.querySelectorAll('.tile')) t.classList.toggle('sel', Number((t as HTMLElement).dataset.code) === code);
    drawDetail();
  };

  view.append(
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Colors'), h('div', { class: 'sub' }, `${lib.colors.length} official LDraw colors: the curated palette plus any a kit needs (tools/build-colors.py).`))),
    h('div', { class: 'split' }, grid, detail),
  );
  drawGrid();
  drawDetail();
  return () => viewer.dispose();
}

// ================================================================ finishes

export function finishesView(ctx: Ctx, view: HTMLElement): () => void {
  const { lib } = ctx.cat;
  const brick = lib.byId.get('3001') ?? 0;
  const sample = [4, 14, 1, 2, 15, 0, 25, 47].map((code) => lib.colorIndex.get(code)).filter((i): i is number => i !== undefined);
  const notes: Record<string, string> = {
    plastic: 'ABS: glossy dielectric (roughness 0.25), micro-surface orange-peel, stud logo.',
    wood: 'Procedural rings and fibres along the part’s X axis (roughness 0.62).',
    clear: 'Transparent, 45% opacity, drawn after opaque blocks, no shadows. See-through colors always use it.',
  };
  view.append(
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Finishes'), h('div', { class: 'sub' }, 'What a block is made of. Defined in app/src/look.ts; read-only here.'))),
    h(
      'div',
      { class: 'stack', style: 'gap:16px' },
      FINISHES.map((f, fi) =>
        h(
          'div',
          { class: 'card pad stack' },
          h('div', { class: 'row' }, h('h2', null, f.label), h('span', { class: 'mono muted' }, f.id), f.trans ? h('span', { class: 'badge' }, 'see-through') : null),
          h('div', { class: 'muted' }, notes[f.id] ?? ''),
          h(
            'div',
            { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(120px,1fr))' },
            sample.map((c) => h('div', { class: 'card', style: 'overflow:hidden' }, h('div', { class: 'thumb' }, lazyImg(() => ctx.thumbs.part(brick, c, fi), lib.colors[c].name)), h('div', { class: 'meta faint', style: 'padding:6px 10px;font-size:12px' }, lib.colors[c].name))),
          ),
        ),
      ),
    ),
  );
  return () => {};
}
