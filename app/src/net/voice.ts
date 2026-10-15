// Spatial voice in a room (docs/11): WebRTC audio between each pair of players who've
// joined voice, set up through the capsule's `signals` table (offers and answers with
// their ICE candidates gathered up front, so each connection is two messages). Each
// voice comes from where that player is: a Web Audio panner at their head or camera.
// There's no TURN server, so two players behind strict NATs may not connect.

import type { ZeroApi } from './zero.js';

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

type Signal = { t: 'hello' | 'ack' } | { t: 'offer' | 'answer'; sdp: string };

interface Peer {
  pc: RTCPeerConnection;
  panner: PannerNode | null;
  audio: HTMLAudioElement | null;
  source: MediaStreamAudioSourceNode | null;
}

export class Voice {
  on = false;
  muted = false;
  error = '';
  onChange: (() => void) | null = null;
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private stopWatch: (() => void) | null = null;
  private seen = new Set<string>();
  private baseline = false;

  constructor(
    private zero: ZeroApi,
    private code: string,
    private me: string,
  ) {}

  /** Join voice (needs a click: microphone permission and audio playback). */
  async start(others: string[]): Promise<boolean> {
    if (this.on) return true;
    try {
      this.ctx = new AudioContext();
      await this.ctx.resume();
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      this.error = 'Microphone not available';
      this.stop();
      this.onChange?.();
      return false;
    }
    this.on = true;
    this.error = '';
    this.baseline = false;
    this.stopWatch = this.zero.watch<Array<{ id: string; from: string; data: string }>>('mySignals', [this.code, this.me], (rows) => rows && void this.read(rows));
    for (const p of others) this.send(p, { t: 'hello' });
    this.onChange?.();
    return true;
  }

  stop(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    void this.ctx?.close();
    this.ctx = null;
    this.on = false;
    this.onChange?.();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !m));
    this.onChange?.();
  }

  /** Players still in the room: hang up on anyone who left. */
  keep(players: Set<string>): void {
    for (const id of [...this.peers.keys()]) if (!players.has(id)) this.drop(id);
  }

  /** Each frame: you're the listener; each voice sits at that player's head or camera (world space). */
  place(listener: { pos: ArrayLike<number>; fwd: ArrayLike<number>; up: ArrayLike<number> }, voices: Map<string, ArrayLike<number>>): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    const t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(listener.pos[0], t, 0.05);
      L.positionY.setTargetAtTime(listener.pos[1], t, 0.05);
      L.positionZ.setTargetAtTime(listener.pos[2], t, 0.05);
      L.forwardX.setTargetAtTime(listener.fwd[0], t, 0.05);
      L.forwardY.setTargetAtTime(listener.fwd[1], t, 0.05);
      L.forwardZ.setTargetAtTime(listener.fwd[2], t, 0.05);
      L.upX.setTargetAtTime(listener.up[0], t, 0.05);
      L.upY.setTargetAtTime(listener.up[1], t, 0.05);
      L.upZ.setTargetAtTime(listener.up[2], t, 0.05);
    }
    for (const [id, peer] of this.peers) {
      const p = voices.get(id);
      if (!p || !peer.panner) continue;
      peer.panner.positionX.setTargetAtTime(p[0], t, 0.05);
      peer.panner.positionY.setTargetAtTime(p[1], t, 0.05);
      peer.panner.positionZ.setTargetAtTime(p[2], t, 0.05);
    }
  }

  get connected(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') n++;
    return n;
  }

  private send(to: string, s: Signal): void {
    void this.zero.mutate('signal', this.code, this.me, to, JSON.stringify(s)).catch(() => {});
  }

  private async read(rows: Array<{ id: string; from: string; data: string }>): Promise<void> {
    const fresh = rows.filter((r) => !this.seen.has(r.id));
    for (const r of fresh) this.seen.add(r.id);
    if (fresh.length) void this.zero.mutate('ackSignals', this.code, this.me, fresh.map((r) => r.id)).catch(() => {});
    if (!this.baseline) {
      // What was waiting before we joined voice is stale.
      this.baseline = true;
      return;
    }
    for (const r of fresh) {
      let s: Signal;
      try {
        s = JSON.parse(r.data) as Signal;
      } catch {
        continue;
      }
      await this.handle(r.from, s);
    }
  }

  /** The player with the smaller id makes the offer; the other answers. */
  private async handle(from: string, s: Signal): Promise<void> {
    if (!this.on) return;
    if (s.t === 'hello' || s.t === 'ack') {
      // A hello means they (re)joined voice: start fresh. An ack only answers our hello.
      if (this.me < from) {
        if (s.t === 'hello' || !this.peers.has(from)) await this.offer(from);
      } else if (s.t === 'hello') this.send(from, { t: 'ack' });
    } else if (s.t === 'offer') {
      this.drop(from);
      const pc = this.connect(from);
      await pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      this.send(from, { t: 'answer', sdp: await this.gathered(pc) });
    } else if (s.t === 'answer') {
      const peer = this.peers.get(from);
      if (peer && peer.pc.signalingState === 'have-local-offer') await peer.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
    }
  }

  private async offer(to: string): Promise<void> {
    this.drop(to);
    const pc = this.connect(to);
    await pc.setLocalDescription(await pc.createOffer());
    this.send(to, { t: 'offer', sdp: await this.gathered(pc) });
  }

  private connect(id: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer: Peer = { pc, panner: null, audio: null, source: null };
    this.peers.set(id, peer);
    for (const t of this.mic?.getAudioTracks() ?? []) pc.addTrack(t, this.mic!);
    pc.ontrack = (ev) => {
      const ctx = this.ctx;
      if (!ctx || peer.source) return;
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      // Chrome only feeds a remote stream to Web Audio once a media element plays it.
      peer.audio = new Audio();
      peer.audio.muted = true;
      peer.audio.srcObject = stream;
      void peer.audio.play().catch(() => {});
      peer.source = ctx.createMediaStreamSource(stream);
      peer.panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 0.6, rolloffFactor: 0.8, maxDistance: 50 });
      peer.source.connect(peer.panner).connect(ctx.destination);
      this.onChange?.();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.drop(id);
      this.onChange?.();
    };
    return pc;
  }

  /** The local description once ICE gathering is done (or after 2.5 s). */
  private gathered(pc: RTCPeerConnection): Promise<string> {
    return new Promise((resolve) => {
      const done = () => resolve(pc.localDescription?.sdp ?? '');
      if (pc.iceGatheringState === 'complete') return done();
      const t = window.setTimeout(done, 2500);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState !== 'complete') return;
        clearTimeout(t);
        done();
      });
    });
  }

  private drop(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.source?.disconnect();
    peer.panner?.disconnect();
    if (peer.audio) peer.audio.srcObject = null;
    peer.pc.close();
  }
}
