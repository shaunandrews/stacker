// The desktop HUD: HTML over the canvas for playing with a keyboard and mouse (hidden in
// XR, where the parts shelf, jars and wrist menu do these jobs). A parts browser with
// search, a hotbar of recent (and pinned) parts, color and finish swatches, tools and
// undo, kits, a controls sheet, the kit's manual page, and the box-select rectangle.
// StackerSystem owns the state; it hands the HUD a host to read it and act on it.

export interface HudPart {
  index: number;
  name: string;
  tab: string;
}

export interface HudKitView {
  title: string;
  step: number;
  steps: number;
  left: number; // pieces left on this step
  pieces: Array<{ part: number; color: number }>; // the step's pieces still to place (hotbar)
}

export interface HudState {
  color: number;
  finish: number;
  tool: string;
  brush: string | null; // what's loaded, for the status line
  selection: number;
  undo: boolean;
  redo: boolean;
  kit: HudKitView | null;
}

export interface HudHost {
  tabs: string[];
  parts: HudPart[];
  colors: Array<{ name: string; hex: string; alpha: number }>;
  finishes: string[];
  kits(): Array<{ id: string; title: string; pieces: number; color: string; mine?: boolean }>;
  state(): HudState;
  thumb(part: number, color: number, finish: number): Promise<string>;
  pick(part: number, color?: number): void; // load the brush
  setColor(color: number): void;
  setFinish(finish: number): void;
  command(id: string): void; // undo, redo, deselect, tool:*, kit:*, settings
  startKit(id: string, title: string): void;
  page(canvas: HTMLCanvasElement): void; // draw the kit's current manual page
  together: HudTogether;
}

/** Rooms (net/room.ts), as the HUD shows them. */
export interface HudTogether {
  available(): Promise<boolean>;
  view(): {
    code: string | null;
    roomName: string;
    status: string;
    name: string;
    color: number;
    colors: string[];
    members: Array<{ name: string; color: string; me: boolean; host: boolean }>;
    list: Array<{ code: string; name: string; players: number }>;
    voice: { on: boolean; muted: boolean; connected: number } | null;
  };
  watchList(on: boolean): void;
  create(name: string): void;
  join(code: string): void;
  leave(): void;
  identity(name: string, color: number): void;
  setVoice(on: boolean): void;
  setMuted(muted: boolean): void;
}

const CSS = `
#play { position: fixed; inset: 0; pointer-events: none; z-index: 6; font: 13px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #f3f5f9; --panel: rgb(21 24 33 / 0.92); --line: #2c3242; --muted: #98a2b5; --accent: #5b8def; }
#play[hidden] { display: none; }
#play .box { pointer-events: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; backdrop-filter: blur(10px); box-shadow: 0 10px 30px rgb(0 0 0 / 0.35); }
#play button { font: inherit; color: inherit; background: #222837; border: 1px solid var(--line); border-radius: 9px; padding: 6px 10px; cursor: pointer; }
#play button:hover { border-color: #46506a; background: #283043; }
#play button.on { background: var(--accent); border-color: transparent; }
#play button:disabled { opacity: 0.4; cursor: default; }
#play .drawer { position: absolute; left: 12px; top: 12px; bottom: 92px; width: clamp(200px, 22vw, 280px); display: flex; flex-direction: column; overflow: hidden; transition: transform 0.18s ease; }
#play .drawer.closed { transform: translateX(-292px); }
#play .drawer.trash { border-color: #e25c5c; box-shadow: 0 0 0 2px #e25c5c inset; }
#play .drawer header { padding: 10px 10px 6px; display: flex; gap: 6px; align-items: center; }
#play .drawer header b { font-size: 14px; flex: 1; }
#play .drawer input { width: 100%; box-sizing: border-box; margin: 0 10px 8px; width: calc(100% - 20px); background: #11141c; border: 1px solid var(--line); border-radius: 9px; padding: 7px 10px; color: inherit; font: inherit; outline: none; }
#play .drawer input:focus { border-color: var(--accent); }
#play .tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 10px 8px; }
#play .tabs button { padding: 3px 8px; font-size: 12px; border-radius: 999px; }
#play .grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 0 10px 10px; align-content: start; }
#play .tile { background: #1b202c; border: 1px solid transparent; border-radius: 10px; padding: 4px; cursor: pointer; text-align: center; }
#play .tile:hover { border-color: #46506a; }
#play .tile.on { border-color: var(--accent); }
#play .tile img { width: 100%; aspect-ratio: 1; object-fit: contain; display: block; }
#play .tile img:not([src]) { visibility: hidden; }
#play .tile span { display: block; font-size: 10.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#play .opener { position: absolute; left: 12px; top: 12px; pointer-events: auto; }
#play .bottom { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); display: flex; gap: 10px; align-items: flex-end; padding: 8px 10px; max-width: calc(100vw - 24px); box-sizing: border-box; }
#play .hotbar { display: flex; gap: 6px; }
#play .slot { position: relative; width: clamp(36px, 4.6vw, 56px); height: clamp(36px, 4.6vw, 56px); flex: none; background: #1b202c; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
#play .slot.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
#play .slot img { width: 100%; height: 100%; object-fit: contain; }
#play .slot img:not([src]) { visibility: hidden; }
#play .slot i { position: absolute; left: 4px; top: 2px; font-style: normal; font-size: 10px; color: var(--muted); }
#play .slot .pin { position: absolute; right: 3px; top: 1px; font-size: 10px; opacity: 0; }
#play .slot.pinned .pin { opacity: 1; }
#play .slot:hover .pin { opacity: 0.7; }
#play .slot .dot { position: absolute; right: 4px; bottom: 4px; width: 9px; height: 9px; border-radius: 50%; border: 1px solid rgb(0 0 0 / 0.35); }
#play .paint { display: flex; flex-direction: column; gap: 6px; }
#play .swatches { display: grid; grid-template-columns: repeat(13, clamp(12px, 1.3vw, 16px)); gap: 3px; }
#play .sw { width: 100%; aspect-ratio: 1; border-radius: 4px; cursor: pointer; border: 1px solid rgb(0 0 0 / 0.3); }
#play .sw.trans { background-image: linear-gradient(45deg, #fff6 25%, transparent 25%, transparent 75%, #fff6 75%), linear-gradient(45deg, #fff6 25%, transparent 25%, transparent 75%, #fff6 75%); background-size: 8px 8px; background-position: 0 0, 4px 4px; }
#play .sw.on { outline: 2px solid #fff; outline-offset: 1px; }
#play .finishes { display: flex; gap: 4px; }
#play .finishes button { padding: 3px 8px; font-size: 12px; }
#play .top { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; align-items: center; padding: 6px; }
#play .top .status { color: var(--muted); padding: 0 6px; white-space: nowrap; }
#play .menu { position: absolute; right: 12px; top: 60px; width: 260px; padding: 8px; display: flex; flex-direction: column; gap: 4px; max-height: 60vh; overflow-y: auto; }
#play .menu[hidden] { display: none; }
#play .menu button { text-align: left; display: flex; gap: 8px; align-items: center; }
#play .menu button .chip { width: 12px; height: 12px; border-radius: 3px; flex: none; }
#play .menu small { color: var(--muted); margin-left: auto; }
#play .keys { position: absolute; right: 12px; top: 60px; width: 380px; padding: 12px 14px; display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; font-size: 12.5px; }
#play .keys[hidden] { display: none; }
#play .keys b { grid-column: 1 / -1; margin-top: 4px; }
#play .keys kbd { font: 600 11px system-ui; padding: 1px 6px; border: 1px solid #3a4152; border-bottom-width: 2px; border-radius: 5px; background: #202432; white-space: nowrap; }
#play .keys span { color: var(--muted); }
#play .kit { position: absolute; right: 12px; top: 60px; bottom: 92px; width: clamp(240px, 26vw, 360px); display: flex; flex-direction: column; overflow: hidden; }
#play .kit[hidden] { display: none; }
#play .kit header { padding: 10px 12px 6px; display: flex; gap: 6px; align-items: center; }
#play .kit header b { flex: 1; }
#play .kit canvas { width: 100%; flex: 1; min-height: 0; object-fit: contain; background: #e9e3d4; }
#play .kit footer { display: flex; gap: 6px; padding: 8px; align-items: center; }
#play .kit footer .step { flex: 1; text-align: center; color: var(--muted); }
#play .room { position: absolute; right: 12px; top: 60px; width: 300px; padding: 12px; display: flex; flex-direction: column; gap: 8px; max-height: 70vh; overflow-y: auto; }
#play .room[hidden] { display: none; }
#play .room h4 { margin: 4px 0 0; font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
#play .room .row { display: flex; gap: 6px; align-items: center; }
#play .room input { flex: 1; min-width: 0; background: #11141c; border: 1px solid var(--line); border-radius: 9px; padding: 7px 10px; color: inherit; font: inherit; outline: none; }
#play .room input:focus { border-color: var(--accent); }
#play .room .dots { display: flex; gap: 5px; }
#play .room .dots button { width: 20px; height: 20px; padding: 0; border-radius: 50%; border: 2px solid transparent; }
#play .room .dots button.on { border-color: #fff; }
#play .room .who { display: flex; gap: 8px; align-items: center; padding: 4px 2px; }
#play .room .who i { width: 10px; height: 10px; border-radius: 50%; flex: none; }
#play .room .who small, #play .room .empty { color: var(--muted); }
#play .room .code { font: 700 22px/1 ui-monospace, monospace; letter-spacing: 0.12em; }
#play .room .wide { width: 100%; }
#play .room .status { color: #fbbf24; min-height: 1em; }
#play .room .row small { color: var(--muted); margin-left: auto; }
#play .top .inroom { box-shadow: 0 0 0 1px #22c55e inset; }
#play .marquee { position: absolute; border: 1.5px solid #22d3ee; background: rgb(34 211 238 / 0.12); border-radius: 3px; display: none; }
#play .toast { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); padding: 6px 12px; border-radius: 999px; background: rgb(21 24 33 / 0.92); border: 1px solid var(--line); color: #e2e8f0; opacity: 0; transition: opacity 0.2s; }
#play .toast.on { opacity: 1; }
`;

const KEYS: Array<[string, string] | [string]> = [
  ['Camera'],
  ['Two-finger scroll', 'Pan'],
  ['Pinch · wheel', 'Zoom'],
  ['⌥ + drag · right-drag', 'Orbit'],
  ['W A S D · Q E', 'Pan · orbit (nothing held)'],
  ['Double-click', 'Focus a block'],
  ['F', 'Frame the plate'],
  ['Building'],
  ['Click a part · 1–9', 'Load the brush'],
  ['Click', 'Place (keeps the brush)'],
  ['Esc · right-click', 'Put the brush down'],
  ['R · ⇧R', 'Spin 90°'],
  ['T · ⇧T', 'Tip 90°'],
  ['Drag a block', 'Move it'],
  ['⌥-click · I', 'Eyedropper'],
  ['⇧-click · ⇧-drag', 'Select · box-select'],
  ['⌘C ⌘V ⌘D ⌘A', 'Copy · paste · duplicate · all'],
  ['Delete', 'Delete (or drag onto the parts)'],
  ['⌘Z · ⇧⌘Z', 'Undo · redo'],
];

type El = HTMLElement;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

interface HotbarEntry {
  part: number;
  pinned: boolean;
}

export class Hud {
  readonly root: El;
  private drawer: El;
  private opener: HTMLButtonElement;
  private grid: El;
  private tabsEl: El;
  private search: HTMLInputElement;
  private hotbarEl: El;
  private swatchesEl: El;
  private finishesEl: El;
  private status: El;
  private menu: El;
  private keys: El;
  private roomEl: El;
  private roomBtn: HTMLButtonElement;
  private kitEl: El;
  private kitTitle: El;
  private kitStep: El;
  private kitCanvas: HTMLCanvasElement;
  private marqueeEl: El;
  private toastEl: El;
  private toolBtns = new Map<string, HTMLButtonElement>();
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private tab = 'Bricks';
  private query = '';
  private hotbar: HotbarEntry[] = [];
  private sig = '';
  private gridSig = '';
  private pageSig = '';
  private toastTimer = 0;
  private observer: IntersectionObserver;
  private lazy = new WeakMap<Element, () => Promise<string>>();

  constructor(private host: HudHost) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = el('div');
    this.root.id = 'play';
    this.root.hidden = true;
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this.observer.unobserve(e.target);
        this.lazy.get(e.target)?.().then((src) => ((e.target as HTMLImageElement).src = src), () => {});
      }
    });
    try {
      this.hotbar = JSON.parse(localStorage.getItem('stacker.hotbar') ?? '[]');
    } catch {
      this.hotbar = [];
    }

    // Parts drawer
    this.drawer = el('div', 'box drawer');
    const head = el('header');
    head.append(el('b', '', 'Parts'));
    const close = el('button', '', '‹');
    close.title = 'Hide parts';
    close.onclick = () => this.toggleDrawer(false);
    head.append(close);
    this.search = el('input');
    this.search.placeholder = 'Search parts';
    this.search.oninput = () => {
      this.query = this.search.value.trim().toLowerCase();
      this.drawGrid();
    };
    this.tabsEl = el('div', 'tabs');
    this.grid = el('div', 'grid');
    this.drawer.append(head, this.search, this.tabsEl, this.grid);
    this.opener = el('button', 'opener', 'Parts ›');
    this.opener.hidden = true;
    this.opener.onclick = () => this.toggleDrawer(true);

    // Bottom: hotbar, colors, finishes
    const bottom = el('div', 'box bottom');
    this.hotbarEl = el('div', 'hotbar');
    const paint = el('div', 'paint');
    this.swatchesEl = el('div', 'swatches');
    this.finishesEl = el('div', 'finishes');
    paint.append(this.swatchesEl, this.finishesEl);
    bottom.append(this.hotbarEl, paint);

    // Top right: status, tools, undo, kits, settings, help
    const top = el('div', 'box top');
    this.status = el('span', 'status');
    top.append(this.status);
    for (const [id, label] of [['tool:build', 'Build'], ['tool:select', 'Select'], ['tool:paint', 'Paint']]) {
      const b = el('button', '', label);
      b.onclick = () => host.command(id);
      this.toolBtns.set(id, b);
      top.append(b);
    }
    this.undoBtn = el('button', '', '↶');
    this.undoBtn.title = 'Undo (⌘Z)';
    this.undoBtn.onclick = () => host.command('undo');
    this.redoBtn = el('button', '', '↷');
    this.redoBtn.title = 'Redo (⇧⌘Z)';
    this.redoBtn.onclick = () => host.command('redo');
    const kitsBtn = el('button', '', 'Kits ▾');
    kitsBtn.onclick = () => this.toggleMenu();
    const settingsBtn = el('button', '', '⚙');
    settingsBtn.title = 'Settings';
    settingsBtn.onclick = () => host.command('settings');
    const help = el('button', '', '?');
    help.title = 'Controls';
    help.onclick = () => {
      this.keys.hidden = !this.keys.hidden;
      this.menu.hidden = true;
      this.showRoom(false);
    };
    this.roomBtn = el('button', '', 'Together');
    this.roomBtn.title = 'Build with other people';
    this.roomBtn.hidden = true;
    this.roomBtn.onclick = () => this.showRoom(this.roomEl.hidden);
    void host.together.available().then((ok) => {
      this.roomBtn.hidden = !ok;
      if (ok) this.roomChanged();
    });
    top.append(this.undoBtn, this.redoBtn, kitsBtn, this.roomBtn, settingsBtn, help);
    this.roomEl = el('div', 'box room');
    this.roomEl.hidden = true;
    this.menu = el('div', 'box menu');
    this.menu.hidden = true;
    this.keys = el('div', 'box keys');
    this.keys.hidden = true;
    for (const row of KEYS) {
      if (row.length === 1) this.keys.append(el('b', '', row[0]));
      else this.keys.append(el('kbd', '', row[0]), el('span', '', row[1]));
    }

    // Kit panel
    this.kitEl = el('div', 'box kit');
    this.kitEl.hidden = true;
    const kh = el('header');
    this.kitTitle = el('b');
    const exit = el('button', '', 'Exit kit');
    exit.onclick = () => host.command('kit:exit');
    kh.append(this.kitTitle, exit);
    this.kitCanvas = el('canvas');
    this.kitCanvas.width = 1024;
    this.kitCanvas.height = 1205;
    const kf = el('footer');
    const prev = el('button', '', '◀');
    prev.onclick = () => host.command('kit:prev');
    this.kitStep = el('span', 'step');
    const next = el('button', '', '▶');
    next.onclick = () => host.command('kit:next');
    const place = el('button', '', 'Place it');
    place.onclick = () => host.command('kit:skip');
    const restart = el('button', '', '↺');
    restart.title = 'Restart this step';
    restart.onclick = () => host.command('kit:restart');
    kf.append(prev, this.kitStep, next, restart, place);
    this.kitEl.append(kh, this.kitCanvas, kf);

    this.marqueeEl = el('div', 'marquee');
    this.toastEl = el('div', 'toast');
    this.root.append(this.drawer, this.opener, bottom, top, this.menu, this.keys, this.roomEl, this.kitEl, this.marqueeEl, this.toastEl);
    document.body.appendChild(this.root);
    this.drawTabs();
    this.drawGrid();
  }

  show(on: boolean): void {
    this.root.hidden = !on;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** Is this point (client px) on the HUD rather than the 3D view? */
  covers(x: number, y: number): boolean {
    if (this.root.hidden) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && hit !== document.body && this.root.contains(hit) && hit !== this.root;
  }

  /** Is this point over the parts drawer (where a carried block is deleted)? */
  overDrawer(x: number, y: number): boolean {
    if (this.root.hidden || this.drawer.classList.contains('closed')) return false;
    const r = this.drawer.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  setTrash(on: boolean): void {
    this.drawer.classList.toggle('trash', on);
  }

  /** The part in hotbar slot n (0–8), with its color during a kit. */
  slot(n: number): { part: number; color?: number } | null {
    const st = this.host.state();
    if (st.kit) {
      const p = st.kit.pieces[n];
      return p ? { part: p.part, color: p.color } : null;
    }
    const e = this.hotbar[n];
    return e ? { part: e.part } : null;
  }

  /** A part was used: it goes to the front of the hotbar's unpinned slots. */
  used(part: number): void {
    const pinned = this.hotbar.map((e, i) => (e.pinned ? i : -1)).filter((i) => i >= 0);
    const recents = this.hotbar.filter((e) => !e.pinned && e.part !== part);
    if (this.hotbar.some((e) => e.pinned && e.part === part)) return;
    recents.unshift({ part, pinned: false });
    const out: HotbarEntry[] = [];
    let r = 0;
    for (let i = 0; i < 9; i++) {
      if (pinned.includes(i)) out.push(this.hotbar[i]);
      else if (r < recents.length) out.push(recents[r++]);
    }
    this.hotbar = out;
    this.saveHotbar();
    this.sig = '';
  }

  marquee(rect: { x: number; y: number; w: number; h: number } | null): void {
    const m = this.marqueeEl;
    if (!rect) {
      m.style.display = 'none';
      return;
    }
    Object.assign(m.style, { display: 'block', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 1600);
  }

  /** Each frame: redraw only what changed. */
  update(): void {
    if (this.root.hidden) return;
    const st = this.host.state();
    const kitSig = st.kit ? `${st.kit.title}|${st.kit.step}|${st.kit.left}|${st.kit.pieces.map((p) => `${p.part}:${p.color}`).join(',')}` : '';
    const sig = `${st.color}|${st.finish}|${st.tool}|${st.brush}|${st.selection}|${st.undo}|${st.redo}|${kitSig}|${JSON.stringify(this.hotbar)}`;
    if (sig === this.sig) return;
    const colorChanged = !this.sig.startsWith(`${st.color}|${st.finish}|`);
    this.sig = sig;
    this.status.textContent = st.brush ? `Brush: ${st.brush}` : st.selection ? `${st.selection} selected` : 'Pick a part';
    for (const [id, b] of this.toolBtns) b.classList.toggle('on', id === `tool:${st.tool}`);
    this.undoBtn.disabled = !st.undo;
    this.redoBtn.disabled = !st.redo;
    this.drawSwatches(st);
    this.drawHotbar(st);
    if (colorChanged) this.drawGrid();
    this.kitEl.hidden = !st.kit;
    if (st.kit) {
      this.kitTitle.textContent = st.kit.title;
      this.kitStep.textContent = `Step ${st.kit.step + 1} of ${st.kit.steps}${st.kit.left ? '' : ' ✓'}`;
      const pageSig = `${st.kit.title}|${st.kit.step}|${st.kit.left}`;
      if (pageSig !== this.pageSig) {
        this.pageSig = pageSig;
        this.host.page(this.kitCanvas);
      }
    } else this.pageSig = '';
  }

  private saveHotbar(): void {
    try {
      localStorage.setItem('stacker.hotbar', JSON.stringify(this.hotbar));
    } catch {
      // per-device convenience only
    }
  }

  private toggleDrawer(open: boolean): void {
    this.drawer.classList.toggle('closed', !open);
    this.opener.hidden = open;
  }

  /** Rooms changed (joined, left, someone came or went, the lobby list): redraw. */
  roomChanged(): void {
    const v = this.host.together.view();
    this.roomBtn.textContent = v.code ? `Together · ${v.members.length || 1}` : 'Together';
    this.roomBtn.classList.toggle('inroom', !!v.code);
    if (this.roomEl.hidden) return;
    // Rebuild only when the panel's shape changes (in or out of a room, voice on, muted),
    // so a name or code being typed isn't wiped; otherwise just refresh its lists.
    if (this.roomShape(v) === this.shape) this.drawRoomLists();
    else this.drawRoom();
  }

  private showRoom(on: boolean): void {
    this.roomEl.hidden = !on;
    this.host.together.watchList(on);
    if (!on) return;
    this.menu.hidden = this.keys.hidden = true;
    this.drawRoom();
  }

  private roomLists: El | null = null;
  private shape = '';

  private roomShape(v: ReturnType<HudTogether['view']>): string {
    return `${v.code}|${v.roomName}|${v.voice?.on}|${v.voice?.muted}`;
  }

  private drawRoom(): void {
    const t = this.host.together;
    const v = t.view();
    const r = this.roomEl;
    this.shape = this.roomShape(v);
    r.replaceChildren();
    if (v.code) {
      r.append(el('h4', '', v.roomName || 'Room'));
      const row = el('div', 'row');
      const code = el('span', 'code', v.code);
      code.style.flex = '1';
      const copy = el('button', '', 'Copy link');
      copy.onclick = () => {
        const url = new URL(location.href);
        url.searchParams.set('room', v.code!);
        void navigator.clipboard?.writeText(url.toString()).then(() => this.toast('Link copied'), () => this.toast(url.toString()));
      };
      row.append(code, copy);
      r.append(row, el('h4', '', 'Here now'));
    } else {
      r.append(el('h4', '', 'You'));
      const row = el('div', 'row');
      const name = el('input');
      name.value = v.name;
      name.maxLength = 24;
      name.onchange = () => t.identity(name.value, v.color);
      row.append(name);
      r.append(row);
      const dots = el('div', 'dots');
      v.colors.forEach((c, i) => {
        const b = el('button', i === v.color ? 'on' : '');
        b.style.background = c;
        b.onclick = () => {
          t.identity(name.value, i);
          this.drawRoom();
        };
        dots.append(b);
      });
      r.append(dots);
      const start = el('button', 'wide', 'Start a room with this build');
      start.onclick = () => t.create(`${name.value || v.name}’s room`);
      r.append(start, el('h4', '', 'Open rooms'));
    }
    this.roomLists = el('div');
    r.append(this.roomLists);
    if (v.code) {
      r.append(el('h4', '', 'Voice'));
      const vr = el('div', 'row');
      if (v.voice?.on) {
        const mute = el('button', v.voice.muted ? '' : 'on', v.voice.muted ? 'Unmute' : 'Mic on');
        mute.onclick = () => t.setMuted(!v.voice!.muted);
        const off = el('button', '', 'Leave voice');
        off.onclick = () => t.setVoice(false);
        const n = el('small', 'voice-n', '');
        vr.append(mute, off, n);
      } else {
        const on = el('button', 'wide', 'Join voice');
        on.onclick = () => t.setVoice(true);
        vr.append(on);
      }
      r.append(vr);
      const leave = el('button', 'wide', 'Leave room');
      leave.onclick = () => t.leave();
      r.append(leave);
    } else {
      r.append(el('h4', '', 'Join with a code'));
      const row = el('div', 'row');
      const code = el('input');
      code.placeholder = 'ABCDE';
      code.maxLength = 8;
      code.style.textTransform = 'uppercase';
      const go = el('button', '', 'Join');
      go.onclick = () => code.value.trim() && t.join(code.value);
      code.onkeydown = (e) => e.key === 'Enter' && go.click();
      row.append(code, go);
      r.append(row);
    }
    r.append(el('div', 'status', v.status));
    this.drawRoomLists();
  }

  /** The parts of the room panel that change on their own: players, open rooms, status. */
  private drawRoomLists(): void {
    const box = this.roomLists;
    if (!box) return;
    const t = this.host.together;
    const v = t.view();
    box.replaceChildren();
    if (v.code) {
      for (const m of v.members) {
        const w = el('div', 'who');
        const dot = el('i');
        dot.style.background = m.color;
        w.append(dot, document.createTextNode(m.name), el('small', '', [m.me ? 'you' : '', m.host ? 'host' : ''].filter(Boolean).join(' · ')));
        box.append(w);
      }
    } else if (!v.list.length) box.append(el('div', 'empty', 'No open rooms right now.'));
    else {
      for (const room of v.list) {
        const w = el('div', 'who');
        const join = el('button', '', 'Join');
        join.onclick = () => t.join(room.code);
        const label = el('span', '', `${room.name}`);
        label.style.flex = '1';
        w.append(label, el('small', '', `${room.players} here`), join);
        box.append(w);
      }
    }
    const st = this.roomEl.querySelector('.status');
    if (st) st.textContent = v.status;
    const vn = this.roomEl.querySelector('.voice-n');
    if (vn && v.voice) vn.textContent = v.voice.connected ? `${v.voice.connected} connected` : 'waiting for others';
  }

  private toggleMenu(): void {
    const m = this.menu;
    m.hidden = !m.hidden;
    this.keys.hidden = true;
    this.showRoom(false);
    if (m.hidden) return;
    m.replaceChildren();
    for (const k of this.host.kits()) {
      const b = el('button');
      const chip = el('span', 'chip');
      chip.style.background = k.color;
      b.append(chip, document.createTextNode(k.title), el('small', '', `${k.pieces} pcs`));
      b.onclick = () => {
        m.hidden = true;
        this.host.startKit(k.id, k.title);
      };
      m.append(b);
    }
  }

  private drawTabs(): void {
    this.tabsEl.replaceChildren();
    for (const t of this.host.tabs) {
      const b = el('button', t === this.tab ? 'on' : '', t);
      b.onclick = () => {
        this.tab = t;
        this.drawTabs();
        this.drawGrid();
      };
      this.tabsEl.append(b);
    }
  }

  private img(load: () => Promise<string>): HTMLImageElement {
    const i = el('img');
    this.lazy.set(i, load);
    this.observer.observe(i);
    return i;
  }

  private drawGrid(): void {
    const st = this.host.state();
    const sig = `${this.tab}|${this.query}|${st.color}|${st.finish}`;
    if (sig === this.gridSig) return;
    this.gridSig = sig;
    const parts = this.host.parts.filter((p) => (this.query ? `${p.name}`.toLowerCase().includes(this.query) : p.tab === this.tab));
    this.grid.replaceChildren(
      ...parts.slice(0, 240).map((p) => {
        const t = el('div', 'tile');
        t.title = p.name;
        t.append(this.img(() => this.host.thumb(p.index, st.color, st.finish)), el('span', '', p.name.replace(/^(Brick|Plate|Tile) /, '')));
        t.onclick = () => this.host.pick(p.index);
        return t;
      }),
    );
  }

  private drawHotbar(st: HudState): void {
    this.hotbarEl.replaceChildren();
    for (let n = 0; n < 9; n++) {
      const entry = st.kit ? st.kit.pieces[n] : this.hotbar[n];
      const s = el('div', 'slot');
      s.append(el('i', '', String(n + 1)));
      if (entry) {
        const color = st.kit ? (entry as { color: number }).color : st.color;
        s.append(this.img(() => this.host.thumb(entry.part, color, st.finish)));
        if (st.kit) {
          const dot = el('span', 'dot');
          dot.style.background = this.host.colors[color]?.hex ?? '#888';
          s.append(dot);
        } else {
          const pin = el('span', 'pin', '📌');
          pin.title = 'Pin to this slot';
          pin.onclick = (ev) => {
            ev.stopPropagation();
            const e = this.hotbar[n];
            if (e) e.pinned = !e.pinned;
            if (e?.pinned) s.classList.add('pinned');
            this.saveHotbar();
            this.sig = '';
          };
          s.append(pin);
          if ((entry as HotbarEntry).pinned) s.classList.add('pinned');
        }
        s.title = this.host.parts.find((p) => p.index === entry.part)?.name ?? '';
        s.onclick = () => this.host.pick(entry.part, st.kit ? (entry as { color: number }).color : undefined);
      }
      this.hotbarEl.append(s);
    }
  }

  private drawSwatches(st: HudState): void {
    this.swatchesEl.replaceChildren(
      ...this.host.colors.map((c, i) => {
        const s = el('div', `sw${c.alpha < 1 ? ' trans' : ''}${i === st.color ? ' on' : ''}`);
        s.style.backgroundColor = c.hex;
        if (c.alpha < 1) s.style.opacity = '0.85';
        s.title = c.name;
        s.onclick = () => this.host.setColor(i);
        return s;
      }),
    );
    this.finishesEl.replaceChildren(
      ...this.host.finishes.map((f, i) => {
        const b = el('button', i === st.finish ? 'on' : '', f);
        b.onclick = () => this.host.setFinish(i);
        return b;
      }),
    );
  }
}
