// A player's pose in 48 bytes (64 base64 characters, the most the relay carries; cast.ts).
// Everything is in the platform's frame (platform-local meters), so each player maps it
// through their own plate, wherever it sits and however big it is.
//
//  0      version (high nibble) | kind (bits 0–1: 0 desktop, 1 VR) | bit 2: holding
//  1–2    room (hash of its code)
//  3–6    player id (base36, as a number)
//  7      color index
//  8–16   head (VR) or camera (desktop)
//  17–25  left hand (VR) or the cursor's point (desktop)
//  26–34  right hand (VR)
//  35–38  the held block's id (hash; 0: none), for "first grab wins"
//  39–47  where that block is
//
// A transform is 9 bytes: position in millimeters (int16 ×3, ±32 m) and rotation as the
// "smallest three" quaternion components at 7 bits each (about 1°).

export const POSE_BYTES = 48;
const VERSION = 1;

export interface Pose {
  kind: 0 | 1;
  holding: boolean;
  room: number;
  player: number;
  color: number;
  held: number;
  /** Four transforms × (px, py, pz, qx, qy, qz, qw): head/camera, left/cursor, right, held. */
  xf: Float32Array;
}

export function newPose(): Pose {
  const xf = new Float32Array(28);
  for (let i = 0; i < 4; i++) xf[i * 7 + 6] = 1;
  return { kind: 0, holding: false, room: 0, player: 0, color: 0, held: 0, xf };
}

/** FNV-1a: room codes and block ids to 32 bits. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}

export function playerNumber(id: string): number {
  return parseInt(id, 36) >>> 0;
}

const Q = 127 / Math.SQRT2; // quaternion component scale: ±1/√2 → ±63.5

function putXf(v: DataView, at: number, xf: Float32Array, k: number): void {
  const o = k * 7;
  for (let i = 0; i < 3; i++) v.setInt16(at + i * 2, Math.max(-32767, Math.min(32767, Math.round(xf[o + i] * 1000))));
  let big = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(xf[o + 3 + i]) > Math.abs(xf[o + 3 + big])) big = i;
  const sign = xf[o + 3 + big] < 0 ? -1 : 1;
  let bits = big;
  let shift = 2;
  for (let i = 0; i < 4; i++) {
    if (i === big) continue;
    const c = Math.max(0, Math.min(127, Math.round(xf[o + 3 + i] * sign * Q + 63.5)));
    bits |= c << shift;
    shift += 7;
  }
  v.setUint8(at + 6, bits & 0xff);
  v.setUint8(at + 7, (bits >> 8) & 0xff);
  v.setUint8(at + 8, (bits >> 16) & 0xff);
}

function getXf(v: DataView, at: number, xf: Float32Array, k: number): void {
  const o = k * 7;
  for (let i = 0; i < 3; i++) xf[o + i] = v.getInt16(at + i * 2) / 1000;
  const bits = v.getUint8(at + 6) | (v.getUint8(at + 7) << 8) | (v.getUint8(at + 8) << 16);
  const big = bits & 3;
  let shift = 2;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    if (i === big) continue;
    const c = (((bits >> shift) & 127) - 63.5) / Q;
    xf[o + 3 + i] = c;
    sum += c * c;
    shift += 7;
  }
  xf[o + 3 + big] = Math.sqrt(Math.max(0, 1 - sum));
}

const buf = new Uint8Array(POSE_BYTES);
const view = new DataView(buf.buffer);

export function packPose(p: Pose): string {
  buf.fill(0);
  view.setUint8(0, (VERSION << 4) | p.kind | (p.holding ? 4 : 0));
  view.setUint16(1, p.room & 0xffff);
  view.setUint32(3, p.player >>> 0);
  view.setUint8(7, p.color & 0xff);
  for (let k = 0; k < 3; k++) putXf(view, 8 + k * 9, p.xf, k);
  view.setUint32(35, p.held >>> 0);
  if (p.held) putXf(view, 39, p.xf, 3);
  let s = '';
  for (let i = 0; i < POSE_BYTES; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

/** Read a packet into `out`; false if it isn't one of ours. */
export function unpackPose(s: string, out: Pose): boolean {
  if (s.length !== 64) return false;
  let raw: string;
  try {
    raw = atob(s);
  } catch {
    return false;
  }
  if (raw.length !== POSE_BYTES) return false;
  for (let i = 0; i < POSE_BYTES; i++) buf[i] = raw.charCodeAt(i);
  const head = view.getUint8(0);
  if (head >> 4 !== VERSION) return false;
  out.kind = (head & 3) as 0 | 1;
  out.holding = !!(head & 4);
  out.room = view.getUint16(1);
  out.player = view.getUint32(3);
  out.color = view.getUint8(7);
  for (let k = 0; k < 3; k++) getXf(view, 8 + k * 9, out.xf, k);
  out.held = view.getUint32(35);
  if (out.held) getXf(view, 39, out.xf, 3);
  return true;
}
