// Dev-server API behind catalog.html's edits. Only runs under `vite` (never in the
// static build) and only answers requests from this machine. Every write goes to a
// source file in the repo, so edits show up in `git diff`.
//
//   GET  /__catalog/ping                          → { ok, edit: true }
//   POST /__catalog/part    { id, name, tab }     → tools/<source>.json + parts.json
//   POST /__catalog/kit     { id, title, steps }  → tools/kit-edits/<id>.json, then rebuilds the kit
//   POST /__catalog/kit-reset { id, title }       → drops the edits, rebuilds the kit
//   POST /__catalog/review  { parts, colors, kits } → public/catalog/review.json

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

const ROOT = path.resolve(__dirname, '..');
const TABS = ['Bricks', 'Plates', 'Tiles', 'Slopes', 'Curves', 'Round', 'Wedges', 'Windows', 'Special', 'Minifigs', 'More'];
const ID = /^[A-Za-z0-9._-]{1,40}$/;
// Where each part's name and tab come from (tools/build-parts.mjs reads them in this order).
const SOURCES: Array<{ file: string; list: (d: any) => any[] }> = [
  { file: 'tools/special-parts.json', list: (d) => d },
  { file: 'tools/selection.json', list: (d) => d },
  { file: 'tools/kit-parts.json', list: (d) => d.parts },
  { file: 'tools/minifigs.json', list: (d) => d.parts },
];

const abs = (rel: string) => path.join(ROOT, rel);
const readJson = (rel: string) => JSON.parse(fs.readFileSync(abs(rel), 'utf8'));

/** Like Python's json.dump(indent=1): the tools' files stay byte-compatible. */
function writePyJson(rel: string, data: unknown): void {
  const text = JSON.stringify(data, null, 1).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  fs.writeFileSync(abs(rel), text);
}

function isLocal(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

async function body(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error('Too large');
  }
  return JSON.parse(raw || '{}');
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function buildKit(id: string, title: string): Promise<string> {
  const mpd = `data-src/${id}.mpd`;
  if (!fs.existsSync(abs(mpd))) return Promise.reject(new Error(`${mpd} is missing (see docs/07-development.md)`));
  return new Promise((resolve, reject) =>
    execFile('python3', ['tools/build-kit.py', 'build', mpd, title, id], { cwd: ROOT }, (err, out, errOut) =>
      err ? reject(new Error(errOut || err.message)) : resolve(out.trim()),
    ),
  );
}

function kitTitle(v: unknown): string {
  if (typeof v !== 'string' || !/^[\w .'-]{1,60}$/.test(v)) throw new Error('Bad title');
  return v;
}

const routes: Record<string, (d: any) => Promise<unknown> | unknown> = {
  part(d) {
    if (!ID.test(d.id)) throw new Error('Bad id');
    if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 200) throw new Error('Bad name');
    if (!TABS.includes(d.tab)) throw new Error('Bad tab');
    const src = SOURCES.find((s) => s.list(readJson(s.file)).some((p) => p.id === d.id));
    if (!src) throw new Error(`${d.id} is in none of the part lists`);
    const data = readJson(src.file);
    const entry = src.list(data).find((p) => p.id === d.id);
    entry.name = d.name.trim();
    entry.tab = d.tab;
    writePyJson(src.file, data);
    // Patch the built metadata too, so there's nothing to rebuild.
    const meta = readJson('app/public/parts/parts.json');
    const part = meta.parts.find((p: { id: string }) => p.id === d.id);
    if (part) {
      part.name = entry.name;
      part.tab = entry.tab;
      fs.writeFileSync(abs('app/public/parts/parts.json'), JSON.stringify(meta));
    }
    return { file: src.file };
  },

  async kit(d) {
    if (!ID.test(d.id)) throw new Error('Bad id');
    const title = kitTitle(d.title);
    const kit = readJson(`app/public/kits/${d.id}.json`);
    const all = new Set<number>(kit.steps.flat().map((b: { k: number }) => b.k));
    const steps: number[][] = d.steps;
    const seen = new Set<number>();
    if (!Array.isArray(steps) || !steps.length) throw new Error('No steps');
    for (const s of steps) {
      if (!Array.isArray(s) || !s.length) throw new Error('Empty step');
      for (const k of s) {
        if (!all.has(k) || seen.has(k)) throw new Error(`Bad piece ${k}`);
        seen.add(k);
      }
    }
    if (seen.size !== all.size) throw new Error('Every piece needs a step');
    fs.mkdirSync(abs('tools/kit-edits'), { recursive: true });
    fs.writeFileSync(abs(`tools/kit-edits/${d.id}.json`), JSON.stringify({ steps }));
    return { log: await buildKit(d.id, title) };
  },

  async 'kit-reset'(d) {
    if (!ID.test(d.id)) throw new Error('Bad id');
    const title = kitTitle(d.title);
    fs.rmSync(abs(`tools/kit-edits/${d.id}.json`), { force: true });
    return { log: await buildKit(d.id, title) };
  },

  review(d) {
    const out = { parts: d.parts ?? {}, colors: d.colors ?? {}, kits: d.kits ?? {} };
    for (const v of Object.values(out)) if (typeof v !== 'object' || Array.isArray(v)) throw new Error('Bad review');
    fs.mkdirSync(abs('app/public/catalog'), { recursive: true });
    fs.writeFileSync(abs('app/public/catalog/review.json'), JSON.stringify(out, null, 1));
    return {};
  },
};

export function catalogApi(): Plugin {
  return {
    name: 'stacker-catalog-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__catalog/', async (req, res) => {
        if (!isLocal(req)) return send(res, 403, { error: 'Catalog edits only from this machine' });
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (req.method === 'GET' && name === 'ping') return send(res, 200, { ok: true, edit: true });
        const route = routes[name];
        if (req.method !== 'POST' || !route) return send(res, 404, { error: 'Not found' });
        try {
          send(res, 200, { ok: true, ...((await route(await body(req))) as object) });
        } catch (err) {
          send(res, 400, { error: (err as Error).message });
        }
      });
    },
  };
}
