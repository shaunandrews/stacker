import type { KitBlock, StepOrigin } from '../kits.js';
import { MANUAL_ZOOM, ManualPainter } from '../manual.js';
import { analyzeKit, partName } from './audit.js';
import type { Hold, KitAnalysis } from './audit.js';
import { api, fetchKit, stepKey } from './data.js';
import type { Kit } from './data.js';
import { clear, h, plural, toast } from './dom.js';
import type { Ctx } from './main.js';
import { lazyImg, Viewer } from './render.js';
import { issueList, levelBadges, reviewControl } from './views.js';

// Kits: the list, and one kit's instructions step by step: the real manual page (the
// same painter the headset uses) or a 3D view, what holds each piece, and step edits.

const ORIGIN: Record<StepOrigin, { label: string; about: string }> = {
  file: { label: 'From the file', about: 'The modeller marked this step in the LDraw file; kept as is.' },
  auto: { label: 'Generated', about: 'Split bottom-up by tools/build-kit.py (3–5 pieces by height). It doesn’t know what holds what.' },
  edit: { label: 'Edited', about: 'Regrouped here in the catalog (tools/kit-edits/). Rebuilds keep it.' },
};

const HOLD: Record<Hold, { label: string; color: string }> = {
  ground: { label: 'On the plate', color: 'var(--ok)' },
  stud: { label: 'On studs', color: 'var(--ok)' },
  touch: { label: 'Touching only', color: 'var(--warn)' },
  floating: { label: 'Floating', color: 'var(--error)' },
  missing: { label: 'Missing part', color: 'var(--error)' },
};

function origins(kit: Kit): StepOrigin[] {
  return kit.file.origin ?? kit.file.steps.map(() => 'auto');
}

function stepProblems(a: KitAnalysis, s: number): 'error' | 'warn' | null {
  if (a.duplicates.some(([ds]) => ds === s) || a.holds[s].includes('missing')) return 'error';
  return a.holds[s].includes('floating') ? 'warn' : null;
}

// ================================================================ list

export function kitsView(ctx: Ctx, view: HTMLElement): () => void {
  const { cat } = ctx;
  view.append(
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Kits'), h('div', { class: 'sub' }, 'Official models from the LDraw OMR, converted by tools/build-kit.py.'))),
    h(
      'div',
      { class: 'kits' },
      cat.kits.map((kit) => {
        const o = origins(kit);
        const a = ctx.analyses.get(kit.info.id)!;
        const floating = a.holds.flat().filter((x) => x === 'floating').length;
        const reviewed = Object.keys(cat.review.kits[kit.info.id]?.steps ?? {}).length;
        const n = (x: StepOrigin) => o.filter((y) => y === x).length;
        return h(
          'a',
          { class: 'card kit-card', href: `#/kits/${kit.info.id}/1` },
          h('div', { class: 'art', style: `background:linear-gradient(160deg, ${kit.info.color}, color-mix(in srgb, ${kit.info.color} 55%, #000))` }, h('span', { class: 'id' }, kit.info.id), lazyImg(() => ctx.thumbs.kit(kit.info.id, kit.file.steps), kit.info.title)),
          h(
            'div',
            { class: 'body' },
            h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', null, kit.info.title), h('span', { class: 'muted' }, `${kit.file.pieces} pcs · ${kit.file.steps.length} steps`)),
            h('div', { class: 'bar' }, (['file', 'auto', 'edit'] as StepOrigin[]).map((x) => h('span', { style: `width:${(n(x) / o.length) * 100}%;background:var(--${x})` }))),
            h(
              'div',
              { class: 'legend' },
              (['file', 'auto', 'edit'] as StepOrigin[]).filter((x) => n(x)).map((x) => h('span', null, h('span', { class: 'dot', style: `background:var(--${x})` }), `${n(x)} ${ORIGIN[x].label.toLowerCase()}`)),
            ),
            h(
              'div',
              { class: 'row' },
              levelBadges(ctx.issues.filter((i) => i.area === 'Kits' && i.key.startsWith(`${kit.info.id}:`))),
              floating ? h('span', { class: 'faint' }, `${plural(floating, 'floating piece')}`) : h('span', { class: 'badge ok' }, 'Nothing floats'),
              h('span', { class: 'faint', style: 'margin-left:auto' }, `${reviewed}/${kit.file.steps.length} reviewed`),
            ),
          ),
        );
      }),
    ),
  );
  return () => {};
}

// ================================================================ one kit

export function kitView(ctx: Ctx, view: HTMLElement, id: string, startStep: number): () => void {
  const { cat } = ctx;
  const { lib } = cat;
  const kit = cat.kits.find((k) => k.info.id === id);
  if (!kit) {
    view.append(h('div', { class: 'loading' }, `No kit ${id}.`));
    return () => {};
  }
  const editable = cat.canEdit && kit.file.steps.every((s) => s.every((b) => b.k !== undefined));
  let steps: KitBlock[][] = [];
  let origin: StepOrigin[] = [];
  let undo: Array<{ steps: KitBlock[][]; origin: StepOrigin[]; n: number }> = [];
  let analysis!: KitAnalysis;
  let n = Math.min(Math.max(0, startStep - 1), kit.file.steps.length - 1);
  let tab: 'page' | '3d' = 'page';
  let zoom = 0;
  const picked = new Set<number>(); // k of selected pieces in this step
  const painter = new ManualPainter(lib);
  const viewer = new Viewer(lib, ctx.mats);
  const page = document.createElement('canvas');
  page.width = 1536;
  page.height = Math.round(1536 * 1.177); // the headset page's proportions

  const reset = () => {
    steps = kit.file.steps.map((s) => [...s]);
    origin = [...origins(kit)];
    undo = [];
    analysis = analyzeKit(lib, steps);
  };
  reset();

  const rail = h('div', { class: 'card steps' });
  const stage = h('div', { class: 'card stage' });
  const side = h('div', { class: 'side-panel stack' });
  const head = h('div', { class: 'head' });
  const bar = h('div');

  // ---- edits
  const edit = (fn: () => void) => {
    undo.push({ steps: steps.map((s) => [...s]), origin: [...origin], n });
    fn();
    analysis = analyzeKit(lib, steps);
    picked.clear();
    drawAll();
  };
  const take = (): KitBlock[] => {
    const out = steps[n].filter((b) => picked.has(b.k!));
    steps[n] = steps[n].filter((b) => !picked.has(b.k!));
    origin[n] = 'edit';
    return out;
  };
  const dropEmpty = () => {
    for (let s = steps.length - 1; s >= 0; s--)
      if (!steps[s].length) {
        steps.splice(s, 1);
        origin.splice(s, 1);
        if (n > s || n >= steps.length) n = Math.max(0, n - 1);
      }
  };
  const ops = {
    toPrev: () =>
      edit(() => {
        const moved = take();
        steps[n - 1].push(...moved);
        origin[n - 1] = 'edit';
        dropEmpty();
      }),
    toNext: () =>
      edit(() => {
        const moved = take();
        steps[n + 1].unshift(...moved);
        origin[n + 1] = 'edit';
        dropEmpty();
      }),
    newBefore: () =>
      edit(() => {
        const moved = take();
        steps.splice(n, 0, moved);
        origin.splice(n, 0, 'edit');
        dropEmpty();
      }),
    newAfter: () =>
      edit(() => {
        const moved = take();
        steps.splice(n + 1, 0, moved);
        origin.splice(n + 1, 0, 'edit');
        dropEmpty();
        n = Math.min(n + (steps[n].length ? 1 : 0), steps.length - 1);
      }),
    mergeNext: () =>
      edit(() => {
        steps[n] = [...steps[n], ...steps[n + 1]];
        steps.splice(n + 1, 1);
        origin.splice(n + 1, 1);
        origin[n] = 'edit';
      }),
    moveStep: (d: number) =>
      edit(() => {
        [steps[n], steps[n + d]] = [steps[n + d], steps[n]];
        [origin[n], origin[n + d]] = [origin[n + d], origin[n]];
        origin[n] = origin[n + d] = 'edit';
        n += d;
      }),
  };
  const back = () => {
    const u = undo.pop();
    if (!u) return;
    steps = u.steps;
    origin = u.origin;
    n = u.n;
    analysis = analyzeKit(lib, steps);
    picked.clear();
    drawAll();
  };
  const reload = async () => {
    kit.file = await fetchKit(kit.info.id);
    ctx.thumbs.forget(`k:${kit.info.id}`);
    reset();
    n = Math.min(n, steps.length - 1);
    ctx.refresh();
    drawAll();
  };
  const save = async () => {
    try {
      const r = await api<{ log: string }>('kit', { id: kit.info.id, title: kit.info.title, steps: steps.map((s) => s.map((b) => b.k)) });
      await reload();
      toast(r.log || 'Saved');
    } catch (err) {
      toast((err as Error).message, true);
    }
  };
  const resetToGenerated = async () => {
    if (!confirm(`Drop every step edit for ${kit.info.title} and rebuild it from the model file?`)) return;
    try {
      await api('kit-reset', { id: kit.info.id, title: kit.info.title });
      await reload();
      toast('Back to the generated steps');
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  // ---- drawing
  const goto = (s: number) => {
    n = Math.max(0, Math.min(steps.length - 1, s));
    picked.clear();
    history.replaceState(null, '', `#/kits/${kit.info.id}/${n + 1}`);
    drawAll();
    rail.querySelector('.step-item.on')?.scrollIntoView({ block: 'nearest' });
  };

  const drawHead = () => {
    const o = origin;
    const count = (x: StepOrigin) => o.filter((y) => y === x).length;
    clear(
      head,
      h(
        'div',
        null,
        h('div', { class: 'faint', style: 'margin-bottom:4px' }, h('a', { href: '#/kits' }, '← Kits')),
        h('h1', null, kit.info.title),
        h('div', { class: 'sub' }, `${kit.info.id} · ${steps.flat().length} pieces · ${steps.length} steps · LDraw OMR`),
      ),
      h('div', { class: 'spacer' }),
      h('div', { class: 'legend' }, (['file', 'auto', 'edit'] as StepOrigin[]).map((x) => h('span', null, h('span', { class: 'dot', style: `background:var(--${x})` }), `${count(x)} ${ORIGIN[x].label.toLowerCase()}`))),
      editable && kit.file.origin?.includes('edit') ? h('button', { class: 'btn danger', onclick: resetToGenerated }, 'Reset to generated') : null,
    );
  };

  const drawRail = () => {
    const reviews = cat.review.kits[kit.info.id]?.steps ?? {};
    clear(
      rail,
      steps.map((s, i) => {
        const p = stepProblems(analysis, i);
        const mark = reviews[stepKey(s)];
        return h(
          'div',
          { class: `step-item${i === n ? ' on' : ''}`, onclick: () => goto(i), title: ORIGIN[origin[i]].label },
          h('span', { class: `origin ${origin[i]}` }),
          h('span', { class: 'num' }, i + 1),
          h('span', { class: 'pcs' }, plural(s.length, 'pc', 'pcs')),
          h('span', { class: 'tail' }, mark ? h('span', { class: `badge ${mark.s === 'ok' ? 'ok' : 'warn'}` }, mark.s === 'ok' ? '✓' : '⚑') : null, p ? h('span', { class: `dot ${p}` }) : null),
        );
      }),
    );
  };

  let paintFrame = 0;
  const drawStage = () => {
    const tabs = h(
      'div',
      { class: 'tabs' },
      h('button', { class: `btn sm${tab === 'page' ? ' on' : ''}`, onclick: () => ((tab = 'page'), drawStage()) }, 'Manual page'),
      h('button', { class: `btn sm${tab === '3d' ? ' on' : ''}`, onclick: () => ((tab = '3d'), drawStage()) }, '3D'),
      tab === 'page'
        ? [
            h('span', { class: 'faint', style: 'margin-left:8px' }, 'Zoom'),
            h('button', { class: 'btn sm', disabled: zoom === 0, onclick: () => ((zoom = Math.max(0, zoom - 1)), drawStage()) }, '−'),
            h('button', { class: 'btn sm', disabled: zoom === MANUAL_ZOOM.length - 1, onclick: () => ((zoom = Math.min(MANUAL_ZOOM.length - 1, zoom + 1)), drawStage()) }, '+'),
          ]
        : h('span', { class: 'legend', style: 'margin-left:8px' }, h('span', null, h('span', { class: 'dot', style: 'background:#5b8def' }), 'this step'), h('span', null, h('span', { class: 'dot warn' }), 'touching only'), h('span', null, h('span', { class: 'dot error' }), 'floating')),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn sm', disabled: n === 0, onclick: () => goto(n - 1), title: 'Previous step (←)' }, '◀'),
      h('span', { class: 'muted', style: 'font-variant-numeric:tabular-nums' }, `Step ${n + 1} of ${steps.length}`),
      h('button', { class: 'btn sm', disabled: n === steps.length - 1, onclick: () => goto(n + 1), title: 'Next step (→)' }, '▶'),
    );
    if (tab === 'page') {
      clear(stage, tabs, h('div', { class: 'page' }, page));
      cancelAnimationFrame(paintFrame);
      paintFrame = requestAnimationFrame(() => painter.paint(page, steps, n, zoom));
    } else {
      clear(stage, tabs, h('div', { class: 'viewer' }, viewer.canvas));
      viewer.showKit(steps, n, analysis.holds[n]);
    }
  };

  const drawSide = () => {
    const step = steps[n];
    const o = origin[n];
    const issues = ctx.issues.filter((i) => i.key === `${kit.info.id}:${n}`);
    // The audit list is for the saved kit; while editing, describe this step from the working copy.
    const floating = step.filter((_, i) => analysis.holds[n][i] === 'floating').map((b) => partName(lib, b.part));
    const live = undo.length
      ? floating.length
        ? [{ level: 'warn' as const, area: 'Kits' as const, subject: '', msg: `${plural(floating.length, 'piece')} float: ${[...new Set(floating)].join(', ')}`, href: '', key: '' }]
        : []
      : issues;
    const reviews = (cat.review.kits[kit.info.id] ??= { steps: {} }).steps;
    const key = stepKey(step);
    const sel = step.filter((b) => picked.has(b.k!)).length;

    const pieceRow = (b: KitBlock, i: number) => {
      const part = lib.byId.get(b.part);
      const ci = lib.colorIndex.get(b.color);
      const c = ci === undefined ? null : lib.colors[ci];
      const hold = analysis.holds[n][i];
      const thumb = document.createElement('canvas');
      thumb.width = 88;
      thumb.height = 70;
      if (part !== undefined) requestAnimationFrame(() => thumb.getContext('2d')!.drawImage(painter.partThumb(part, ci ?? 0), 0, 0, 88, 70));
      return h(
        'label',
        { class: 'piece', style: editable ? 'cursor:pointer' : '' },
        editable
          ? h('input', {
              type: 'checkbox',
              checked: picked.has(b.k!),
              onchange: (e: Event) => {
                if ((e.target as HTMLInputElement).checked) picked.add(b.k!);
                else picked.delete(b.k!);
                drawSide();
              },
            })
          : h('span'),
        thumb,
        h(
          'div',
          null,
          h('div', { class: 'nm' }, part === undefined ? `Missing: ${b.part}` : lib.parts[part].name),
          h(
            'div',
            { class: 'muted' },
            c ? [h('span', { class: 'sw', style: `background:${c.hex}` }), ` ${c.name}`] : `color ${b.color}?`,
            ` · ${b.m ? 'free' : 'grid'}`,
            ' · ',
            h('span', { style: `color:${HOLD[hold].color};font-weight:600` }, HOLD[hold].label),
          ),
        ),
      );
    };

    clear(
      side,
      h(
        'div',
        { class: 'card pad stack' },
        h('div', { class: 'row' }, h('h2', null, `Step ${n + 1}`), h('span', { class: `badge ${o}` }, ORIGIN[o].label), h('span', { class: 'muted', style: 'margin-left:auto' }, plural(step.length, 'piece'))),
        h('div', { class: 'muted' }, ORIGIN[o].about),
        issueList(live),
        undo.length ? null : reviewControl(ctx, () => reviews[key], (m) => (m ? (reviews[key] = m) : delete reviews[key]), drawRail),
      ),
      h(
        'div',
        { class: 'card pad stack' },
        h('div', { class: 'row' }, h('h3', null, 'Pieces'), editable ? h('span', { class: 'faint', style: 'margin-left:auto' }, sel ? `${sel} selected` : 'Tick pieces to move them') : null),
        h('div', { class: 'pieces' }, step.map(pieceRow)),
        editable
          ? [
              h(
                'div',
                { class: 'row' },
                h('button', { class: 'btn sm', disabled: !sel || n === 0, onclick: ops.toPrev }, '↑ To previous step'),
                h('button', { class: 'btn sm', disabled: !sel || n === steps.length - 1, onclick: ops.toNext }, '↓ To next step'),
                h('button', { class: 'btn sm', disabled: !sel, onclick: ops.newBefore }, 'New step before'),
                h('button', { class: 'btn sm', disabled: !sel || sel === step.length, onclick: ops.newAfter }, 'Split off after'),
              ),
              h(
                'div',
                { class: 'row' },
                h('button', { class: 'btn sm', disabled: n === steps.length - 1, onclick: ops.mergeNext }, 'Merge with next'),
                h('button', { class: 'btn sm', disabled: n === 0, onclick: () => ops.moveStep(-1) }, 'Move step earlier'),
                h('button', { class: 'btn sm', disabled: n === steps.length - 1, onclick: () => ops.moveStep(1) }, 'Move step later'),
              ),
            ]
          : null,
      ),
    );
  };

  const drawBar = () => {
    clear(
      bar,
      undo.length
        ? h(
            'div',
            { class: 'sticky-bar' },
            h('b', null, plural(undo.length, 'unsaved change')),
            h('span', { class: 'faint' }, 'Saving writes tools/kit-edits and rebuilds the kit'),
            h('span', { style: 'flex:1' }),
            h('button', { class: 'btn', onclick: back, title: '⌘Z' }, 'Undo'),
            h('button', { class: 'btn', onclick: () => (reset(), drawAll()) }, 'Discard'),
            h('button', { class: 'btn primary', onclick: save }, 'Save'),
          )
        : null,
    );
  };

  const drawAll = () => {
    drawHead();
    drawRail();
    drawStage();
    drawSide();
    drawBar();
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input[type=text], textarea, select')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), goto(n - 1));
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), goto(n + 1));
    else if (e.key === 'z' && (e.metaKey || e.ctrlKey) && undo.length) (e.preventDefault(), back());
  };
  const onLeave = (e: BeforeUnloadEvent) => {
    if (undo.length) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onLeave);

  view.append(head, h('div', { class: 'kit-layout' }, rail, h('div', null, stage, bar), side));
  drawAll();
  requestAnimationFrame(() => rail.querySelector('.step-item.on')?.scrollIntoView({ block: 'center' }));
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', onLeave);
    cancelAnimationFrame(paintFrame);
    painter.dispose();
    viewer.dispose();
  };
}
