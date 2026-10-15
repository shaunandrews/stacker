// Rooms (docs/11): open rooms where players on computers and in headsets build on one
// shared plate. Edits (edits.ts) go through the capsule's numbered log (Zero mutations,
// about half a second); poses go through the realtime relay's presence (cast.ts, about
// 80 ms). The room's longest-standing player is its host and folds the log into a
// snapshot now and then, so joining doesn't replay everything. If the host leaves, the
// next player takes over.

import { isEmpty, mergeEdits, splitEdit } from '../edits.js';
import type { Bounds, Edit, Spec } from '../edits.js';
import { CastPresence } from './cast.js';
import { hash32, newPose, packPose, playerNumber, unpackPose, type Pose } from './pose.js';
import { Voice } from './voice.js';
import { connectZero, type ZeroApi } from './zero.js';

export type BuildState = { bounds: Bounds; blocks: Array<[string, Spec]> };

export const PLAYER_COLORS = ['#f97316', '#22c55e', '#3b82f6', '#e11d48', '#a855f7', '#eab308', '#14b8a6', '#ec4899'];

export interface RoomInfo {
  code: string;
  name: string;
  players: number;
}

export interface Member {
  player: string;
  name: string;
  color: number;
  joined: number;
}

export interface RemotePlayer {
  key: string; // relay session
  player: string;
  name: string;
  color: string;
  pose: Pose;
  at: number; // when the latest pose arrived (performance.now)
}

/** What a room needs from the game (StackerSystem). */
export interface RoomHost {
  readonly playerId: string;
  onEdit: ((e: Edit) => void) | null;
  applyRemote(e: Edit): void;
  buildState(): BuildState;
  loadBuildState(st: BuildState): void;
  isBusy(): boolean;
  /** Fill in this player's pose (platform-local); the room fills in the ids. */
  samplePose(out: Pose): void;
  /** Leaving a room brings back the build you had before. */
  stashSolo(): void;
  restoreSolo(): void;
  roomChanged(): void;
}

const MAX_CHUNK = 50_000; // characters per row (a field holds about 64 KB)
const COMPACT_AT = 60; // log entries before the host writes a snapshot
const HEARTBEAT = 20_000;

export class Rooms {
  /** Open rooms (live), for the lobby. */
  list: RoomInfo[] = [];
  code: string | null = null;
  roomName = '';
  members: Member[] = [];
  remotes: RemotePlayer[] = [];
  status = '';
  name: string;
  color: number;
  onChange: (() => void) | null = null;
  voice: Voice | null = null;

  private zero: ZeroApi | null = null;
  private cast: CastPresence | null = null;
  private stops: Array<() => void> = [];
  private stopList: (() => void) | null = null;
  private applied = 0; // highest log entry applied here
  private logLength = 0;
  private queue: Edit[] = [];
  private pushing = false;
  private compacting = false;
  private beat = 0;
  private pose = newPose();
  private peerPose = newPose();
  private remoteByKey = new Map<string, RemotePlayer>();
  private roomHash = 0;
  private sendClock = 0;
  private joining = false;

  constructor(private host: RoomHost) {
    let saved: { name?: string; color?: number } = {};
    try {
      saved = JSON.parse(localStorage.getItem('stacker.player') ?? '{}');
    } catch {
      // first visit
    }
    this.name = saved.name || `Builder ${100 + Math.floor(Math.random() * 900)}`;
    this.color = saved.color ?? Math.floor(Math.random() * PLAYER_COLORS.length);
  }

  /** Is there a capsule to play together through? */
  async available(): Promise<boolean> {
    if (this.zero) return true;
    const z = await connectZero();
    if (!z) return false;
    this.zero = z.api;
    this.cast = new CastPresence(z.config);
    this.cast.onChange = () => this.readPeers();
    return true;
  }

  /** Keep the lobby's room list live (while the rooms panel is open). */
  watchList(on: boolean): void {
    this.stopList?.();
    this.stopList = null;
    if (!on || !this.zero) return;
    this.stopList = this.zero.watch<RoomInfo[]>('openRooms', [], (v) => {
      this.list = v ?? [];
      this.onChange?.();
    });
  }

  setIdentity(name: string, color: number): void {
    this.name = name.trim().slice(0, 24) || this.name;
    this.color = ((color % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length;
    try {
      localStorage.setItem('stacker.player', JSON.stringify({ name: this.name, color: this.color }));
    } catch {
      // per-device convenience
    }
    if (this.code) void this.zero?.mutate('joinRoom', this.code, this.host.playerId, this.name, this.color);
    this.onChange?.();
  }

  /** Start a room with the build that's on the plate now. */
  async create(name: string): Promise<string | null> {
    if (!(await this.available())) return null;
    this.setStatus('Starting a room…');
    try {
      const code = await this.zero!.mutate<string>('createRoom', name);
      const seed = this.host.buildState();
      const ok = await this.enter(code, seed);
      return ok ? code : null;
    } catch {
      this.setStatus("Couldn't start a room");
      return null;
    }
  }

  async join(code: string): Promise<boolean> {
    if (!(await this.available())) return false;
    return this.enter(code.trim().toUpperCase(), null);
  }

  private async enter(code: string, seed: BuildState | null): Promise<boolean> {
    if (this.joining) return false;
    if (this.code) this.leave();
    this.joining = true;
    this.setStatus(`Joining ${code}…`);
    try {
      const res = await this.zero!.mutate<{ ok?: boolean; error?: string; seq: number; base: number }>('joinRoom', code, this.host.playerId, this.name, this.color);
      if (!res?.ok) {
        this.setStatus(res?.error ?? "Couldn't join");
        return false;
      }
      this.host.stashSolo();
      if (seed) {
        // The room starts as your build: one edit that adds every block.
        this.applied = res.seq;
        const e: Edit = { set: seed.blocks.map(([id, spec]) => [id, null, spec]), bounds: [{ x0: 0, x1: 0, z0: 0, z1: 0 }, seed.bounds] };
        this.queue.push(e);
      } else {
        const snap = (await (await fetch(`/api/rooms/snapshot?code=${encodeURIComponent(code)}`, { credentials: 'same-origin' })).json()) as { seq: number; state: BuildState | null };
        this.host.loadBuildState(snap.state ?? { bounds: this.host.buildState().bounds, blocks: [] });
        this.applied = snap.seq;
      }
      this.code = code;
      this.roomHash = hash32(code) & 0xffff;
      this.host.onEdit = (e) => {
        this.queue.push(e);
        void this.pump();
      };
      this.stops.push(
        this.zero!.watch<Array<{ seq: number; player: string; data: string }>>('roomLog', [code], (v) => v && this.readLog(v)),
        this.zero!.watch<Member[]>('roomMembers', [code], (v) => {
          if (!v) return;
          this.members = v;
          this.voice?.keep(new Set(v.map((m) => m.player)));
          this.onChange?.();
        }),
        this.zero!.watch<{ name: string } | null>('room', [code], (v) => {
          if (v) this.roomName = v.name;
          this.onChange?.();
        }),
      );
      this.beat = window.setInterval(() => void this.zero?.mutate('heartbeat', code, this.host.playerId), HEARTBEAT);
      void this.cast!.start();
      void this.pump();
      this.setStatus('');
      this.host.roomChanged();
      const url = new URL(location.href);
      url.searchParams.set('room', code);
      history.replaceState(null, '', url);
      return true;
    } catch {
      this.setStatus("Couldn't join");
      return false;
    } finally {
      this.joining = false;
    }
  }

  leave(): void {
    if (!this.code) return;
    const code = this.code;
    void this.zero?.mutate('leaveRoom', code, this.host.playerId);
    this.setVoice(false);
    for (const s of this.stops) s();
    this.stops = [];
    clearInterval(this.beat);
    this.cast?.stop();
    this.host.onEdit = null;
    this.code = null;
    this.members = [];
    this.remotes = [];
    this.remoteByKey.clear();
    this.queue = [];
    this.host.restoreSolo();
    this.host.roomChanged();
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
    this.onChange?.();
  }

  /** Each frame: send this player's pose (at most 20 Hz; the relay paces it too). */
  tick(dt: number): void {
    if (!this.code || !this.cast) return;
    this.sendClock += dt;
    if (this.sendClock < 0.05) return;
    this.sendClock = 0;
    const p = this.pose;
    p.room = this.roomHash;
    p.player = playerNumber(this.host.playerId);
    p.color = this.color;
    p.held = 0;
    p.holding = false;
    this.host.samplePose(p);
    this.cast.set(packPose(p));
  }

  /** Join or leave the room's voice chat (call from a click). */
  async setVoice(on: boolean): Promise<void> {
    if (!on) {
      this.voice?.stop();
      this.voice = null;
      this.onChange?.();
      return;
    }
    if (!this.code || !this.zero || this.voice) return;
    const v = new Voice(this.zero, this.code, this.host.playerId);
    v.onChange = () => this.onChange?.();
    this.voice = v;
    const ok = await v.start(this.members.map((m) => m.player).filter((p) => p !== this.host.playerId));
    if (!ok) {
      this.status = v.error;
      this.voice = null;
    }
    this.onChange?.();
  }

  /** The host is the player who's been in the room longest. */
  get isHost(): boolean {
    return this.members[0]?.player === this.host.playerId;
  }

  private setStatus(s: string): void {
    this.status = s;
    this.onChange?.();
  }

  /** Send queued edits in order; whatever piles up during a send goes out as one. */
  private async pump(): Promise<void> {
    if (this.pushing || !this.code) return;
    this.pushing = true;
    const code = this.code;
    let batch: Edit[] = [];
    try {
      while (this.queue.length && this.code === code) {
        batch = splitEdit(mergeEdits(this.queue.splice(0)), MAX_CHUNK).filter((e) => !isEmpty(e));
        while (batch.length) {
          const res = await this.zero!.mutate<{ seq?: number; error?: string }>('pushEdit', code, this.host.playerId, JSON.stringify(batch[0]));
          if (res?.error) console.warn('[rooms] edit refused:', res.error);
          batch.shift();
        }
      }
    } catch (err) {
      console.warn('[rooms] edit failed, retrying', err);
      if (this.code === code) {
        this.queue.unshift(...batch);
        window.setTimeout(() => void this.pump(), 2000);
      }
    } finally {
      this.pushing = false;
    }
  }

  private readLog(rows: Array<{ seq: number; player: string; data: string }>): void {
    this.logLength = rows.length;
    rows.sort((a, b) => a.seq - b.seq);
    for (const r of rows) {
      if (r.seq <= this.applied) continue;
      this.applied = r.seq;
      if (r.player === this.host.playerId) continue; // already here
      try {
        this.host.applyRemote(JSON.parse(r.data) as Edit);
      } catch (err) {
        console.warn('[rooms] bad edit', r.seq, err);
      }
    }
    void this.compact();
  }

  /** Host: fold the log into a snapshot once it gets long. */
  private async compact(): Promise<void> {
    if (!this.isHost || this.compacting || this.logLength < COMPACT_AT || this.queue.length || this.pushing || this.host.isBusy() || !this.code) return;
    this.compacting = true;
    const code = this.code;
    const seq = this.applied;
    const text = JSON.stringify(this.host.buildState());
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += MAX_CHUNK) chunks.push(text.slice(i, i + MAX_CHUNK));
    if (!chunks.length) chunks.push('');
    try {
      for (let n = 0; n < chunks.length; n++) {
        const res = await this.zero!.mutate<{ ok?: boolean; error?: string }>('putSnapshot', code, seq, n, chunks.length, chunks[n]);
        if (!res?.ok) break;
      }
    } catch {
      // try again on the next log update
    } finally {
      this.compacting = false;
    }
  }

  /** Presence changed: who's here, and where. */
  private readPeers(): void {
    if (!this.cast) return;
    const me = playerNumber(this.host.playerId);
    const now = performance.now();
    const seen = new Set<string>();
    for (const [key, packet] of this.cast.peers) {
      if (!unpackPose(packet, this.peerPose) || this.peerPose.room !== this.roomHash || this.peerPose.player === me) continue;
      seen.add(key);
      let r = this.remoteByKey.get(key);
      if (!r) {
        r = { key, player: '', name: '', color: PLAYER_COLORS[0], pose: newPose(), at: now };
        this.remoteByKey.set(key, r);
      }
      const p = this.peerPose;
      Object.assign(r.pose, { kind: p.kind, holding: p.holding, room: p.room, player: p.player, color: p.color, held: p.held });
      r.pose.xf.set(p.xf);
      r.at = now;
      const m = this.members.find((x) => playerNumber(x.player) === p.player);
      r.player = m?.player ?? p.player.toString(36);
      r.name = m?.name ?? 'Builder';
      r.color = PLAYER_COLORS[(m?.color ?? p.color) % PLAYER_COLORS.length];
    }
    for (const key of [...this.remoteByKey.keys()]) if (!seen.has(key)) this.remoteByKey.delete(key);
    this.remotes = [...this.remoteByKey.values()];
  }
}
