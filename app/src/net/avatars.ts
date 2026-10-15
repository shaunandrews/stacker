// Other players in the room, drawn where they are relative to the plate: VR players as a
// head and two hands, desktop players as a camera marker and a cursor on the build. A
// block someone is holding shows as a ghost in their color. Poses arrive at about 20 Hz
// and are eased toward each frame.

import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';
import type { RemotePlayer } from './room.js';

interface View {
  color: string;
  name: string;
  head: Group;
  hands: [Mesh, Mesh];
  cam: Group;
  cursor: Mesh;
  label: Sprite;
  held: Mesh;
  heldHash: number;
  pos: Vector3[]; // eased, platform-local: head/camera, left/cursor, right, held
  quat: Quaternion[];
  fresh: boolean;
  mats: Array<MeshStandardMaterial | MeshBasicMaterial>;
}

const headGeo = new BoxGeometry(0.17, 0.13, 0.15);
const visorGeo = new BoxGeometry(0.15, 0.05, 0.02);
const handGeo = new SphereGeometry(0.03, 16, 12);
const camGeo = new ConeGeometry(0.06, 0.1, 4, 1, true);
const camBodyGeo = new BoxGeometry(0.07, 0.05, 0.05);
const ringGeo = new RingGeometry(0.012, 0.02, 24);
const dotGeo = new SphereGeometry(0.006, 10, 8);
const EMPTY = new BufferGeometry();

export class Avatars {
  readonly root = new Group();
  private views = new Map<string, View>();
  private m = new Matrix4();
  private mq = new Quaternion();
  private v = new Vector3();
  private q = new Quaternion();
  private s = new Vector3();
  private platformQ = new Quaternion();

  constructor() {
    this.root.name = 'avatars';
  }

  /**
   * Each frame. `platform` is this player's plate (remote poses are in its frame);
   * `geometry` finds the part geometry of a held block by its id hash.
   */
  update(remotes: RemotePlayer[], platform: Object3D, dt: number, geometry: (hash: number) => BufferGeometry | null): void {
    const live = new Set<string>();
    const k = 1 - Math.exp(-dt * 14);
    platform.updateWorldMatrix(true, false);
    platform.matrixWorld.decompose(this.v, this.platformQ, this.s);
    for (const r of remotes) {
      live.add(r.key);
      let view = this.views.get(r.key);
      if (!view) {
        view = this.make(r);
        this.views.set(r.key, view);
      }
      if (view.color !== r.color || view.name !== r.name) this.restyle(view, r);
      const vr = r.pose.kind === 1;
      view.head.visible = vr;
      view.hands[0].visible = view.hands[1].visible = vr;
      view.cam.visible = view.cursor.visible = !vr;
      const xf = r.pose.xf;
      for (let i = 0; i < 4; i++) {
        this.v.set(xf[i * 7], xf[i * 7 + 1], xf[i * 7 + 2]);
        this.q.set(xf[i * 7 + 3], xf[i * 7 + 4], xf[i * 7 + 5], xf[i * 7 + 6]);
        if (view.fresh) {
          view.pos[i].copy(this.v);
          view.quat[i].copy(this.q);
        } else {
          view.pos[i].lerp(this.v, k);
          view.quat[i].slerp(this.q, k);
        }
      }
      view.fresh = false;
      // Platform-local → world. Bodies keep their real-world size whatever the plate's scale.
      const place = (obj: Object3D, i: number, turn = true) => {
        obj.position.copy(view!.pos[i]).applyMatrix4(platform.matrixWorld);
        if (turn) obj.quaternion.copy(this.platformQ).multiply(view!.quat[i]);
      };
      if (vr) {
        place(view.head, 0);
        place(view.hands[0], 1);
        place(view.hands[1], 2);
        view.label.position.copy(view.head.position).y += 0.15;
      } else {
        place(view.cam, 0);
        place(view.cursor, 1, false);
        view.cursor.quaternion.copy(this.platformQ);
        view.label.position.copy(view.cam.position).y += 0.09;
      }
      // The block they hold, as a ghost in their color (platform scale: it's part of the build).
      const held = r.pose.holding && r.pose.held ? r.pose.held : 0;
      if (held !== view.heldHash) {
        view.heldHash = held;
        const g = held ? geometry(held) : null;
        view.held.geometry = g ?? EMPTY;
        view.held.visible = !!g;
        if (g) {
          view.pos[3].set(xf[21], xf[22], xf[23]);
          view.quat[3].set(xf[24], xf[25], xf[26], xf[27]);
        }
      }
      if (view.held.visible) {
        this.m.compose(view.pos[3], view.quat[3], this.s.set(1, 1, 1)).premultiply(platform.matrixWorld);
        this.m.decompose(view.held.position, view.held.quaternion, view.held.scale);
      }
    }
    for (const [key, view] of this.views) {
      if (live.has(key)) continue;
      this.root.remove(view.head, view.hands[0], view.hands[1], view.cam, view.cursor, view.label, view.held);
      for (const m of view.mats) m.dispose();
      (view.label.material as SpriteMaterial).map?.dispose();
      view.label.material.dispose();
      this.views.delete(key);
    }
  }

  clear(): void {
    this.update([], this.root, 0, () => null);
  }

  private make(r: RemotePlayer): View {
    const body = new MeshStandardMaterial({ color: r.color, roughness: 0.5 });
    const dark = new MeshStandardMaterial({ color: 0x111318, roughness: 0.25, metalness: 0.2 });
    const ghost = new MeshBasicMaterial({ color: r.color, transparent: true, opacity: 0.45, depthWrite: false });
    const flat = new MeshBasicMaterial({ color: r.color, depthTest: false, transparent: true });
    const head = new Group();
    head.add(new Mesh(headGeo, body));
    const visor = new Mesh(visorGeo, dark);
    visor.position.set(0, 0.01, -0.075);
    head.add(visor);
    const hands: [Mesh, Mesh] = [new Mesh(handGeo, body), new Mesh(handGeo, body)];
    const cam = new Group();
    const cone = new Mesh(camGeo, body);
    cone.rotation.x = -Math.PI / 2; // point down the camera's -Z
    cone.rotation.y = Math.PI / 4;
    cone.position.z = -0.06;
    cam.add(cone, new Mesh(camBodyGeo, dark));
    const cursor = new Mesh(ringGeo, flat);
    cursor.rotation.x = -Math.PI / 2;
    cursor.renderOrder = 30;
    const dot = new Mesh(dotGeo, flat);
    dot.renderOrder = 30;
    cursor.add(dot);
    const label = new Sprite(new SpriteMaterial({ depthTest: false, transparent: true }));
    label.renderOrder = 31;
    const held = new Mesh(EMPTY, ghost);
    held.visible = false;
    held.renderOrder = 5;
    const view: View = {
      color: '',
      name: '',
      head,
      hands,
      cam,
      cursor,
      label,
      held,
      heldHash: 0,
      pos: [new Vector3(), new Vector3(), new Vector3(), new Vector3()],
      quat: [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()],
      fresh: true,
      mats: [body, dark, ghost, flat],
    };
    this.restyle(view, r);
    this.root.add(head, hands[0], hands[1], cam, cursor, label, held);
    return view;
  }

  private restyle(view: View, r: RemotePlayer): void {
    view.color = r.color;
    view.name = r.name;
    view.mats[0].color.set(r.color);
    view.mats[2].color.set(r.color);
    view.mats[3].color.set(r.color);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.font = '600 30px system-ui, sans-serif';
    const w = Math.min(248, g.measureText(r.name).width + 36);
    g.fillStyle = 'rgba(17,19,24,0.85)';
    g.beginPath();
    g.roundRect((256 - w) / 2, 8, w, 48, 24);
    g.fill();
    g.fillStyle = r.color;
    g.beginPath();
    g.arc((256 - w) / 2 + 20, 32, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f3f5f9';
    g.textBaseline = 'middle';
    g.fillText(r.name, (256 - w) / 2 + 34, 33, w - 44);
    const mat = view.label.material as SpriteMaterial;
    mat.map?.dispose();
    mat.map = new CanvasTexture(c);
    mat.needsUpdate = true;
    view.label.scale.set(0.2, 0.05, 1);
  }
}
