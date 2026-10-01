import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// The box camera: a little camera on top of the kit rack. Hold it up to your build and
// its back screen shows what the box art will be; the shutter turns your build into a
// box of your own (see StackerSystem.shootBox). The lens looks down -Z, like a three.js
// camera, so the group's pose is the shot's pose; the screen faces +Z, toward you.

export const VIEW_FOV = 34;
export const VIEW_PX = 192; // viewfinder resolution
export type CameraState = 'home' | 'held' | 'returning';

const BODY_W = 0.075;
const BODY_H = 0.05;
const BODY_D = 0.032;

export class SnapCamera {
  readonly group = new Group();
  readonly body: Mesh;
  readonly shutter: Mesh;
  readonly view: HTMLCanvasElement; // the render, drawn into the screen with a frame
  state: CameraState = 'home';
  readonly homePos = new Vector3(); // rack-local
  readonly homeQuat = new Quaternion();
  readonly fromPos = new Vector3();
  readonly fromQuat = new Quaternion();
  t = 0;
  flash = 0; // seconds of white flash left
  private readonly screen: HTMLCanvasElement;
  private readonly screenTex: CanvasTexture;

  constructor() {
    this.group.name = 'BoxCamera';
    const shell = new MeshStandardMaterial({ color: 0x23262d, roughness: 0.45, metalness: 0.2 });
    const trim = new MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.3, metalness: 0.7 });
    this.body = new Mesh(new RoundedBoxGeometry(BODY_W, BODY_H, BODY_D, 3, 0.006), shell);
    this.body.name = 'BoxCameraBody';
    this.body.castShadow = true;
    const lens = new Mesh(new CylinderGeometry(0.016, 0.018, 0.022, 28).rotateX(Math.PI / 2), shell);
    lens.position.set(0.006, 0, -BODY_D / 2 - 0.011);
    const ring = new Mesh(new CylinderGeometry(0.0185, 0.0185, 0.004, 28).rotateX(Math.PI / 2), trim);
    ring.position.set(0.006, 0, -BODY_D / 2 - 0.02);
    const glass = new Mesh(new CylinderGeometry(0.012, 0.012, 0.002, 24).rotateX(Math.PI / 2), new MeshStandardMaterial({ color: 0x0c1830, roughness: 0.05, metalness: 0.9 }));
    glass.position.set(0.006, 0, -BODY_D / 2 - 0.0225);
    this.shutter = new Mesh(new CylinderGeometry(0.0055, 0.0055, 0.004, 18), new MeshStandardMaterial({ color: 0xe11d48, roughness: 0.4 }));
    this.shutter.name = 'BoxCameraShutter';
    this.shutter.position.set(BODY_W / 2 - 0.013, BODY_H / 2 + 0.002, -0.002);
    const finder = new Mesh(new BoxGeometry(0.018, 0.008, 0.014), shell);
    finder.position.set(-BODY_W / 2 + 0.016, BODY_H / 2 + 0.004, 0);
    // Viewfinder screen on the back.
    this.view = document.createElement('canvas');
    this.view.width = this.view.height = VIEW_PX;
    this.screen = document.createElement('canvas');
    this.screen.width = 256;
    this.screen.height = 176;
    this.screenTex = new CanvasTexture(this.screen);
    this.screenTex.colorSpace = SRGBColorSpace;
    const screen = new Mesh(new PlaneGeometry(BODY_W - 0.012, BODY_H - 0.01), new MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    screen.position.set(0, 0, BODY_D / 2 + 0.0006);
    this.group.add(this.body, lens, ring, glass, this.shutter, finder, screen);
    this.drawScreen(null, '#2a2f3a', 'Hold me up to your build');
  }

  /** The screen: the view (or a hint) on the box color, a square frame, and a caption. */
  drawScreen(view: HTMLCanvasElement | null, color: string, caption: string): void {
    const c = this.screen.getContext('2d')!;
    const W = this.screen.width;
    const H = this.screen.height;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, color);
    g.addColorStop(1, '#0d0f14');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    const s = H - 26;
    const x = (W - s) / 2;
    if (view) c.drawImage(view, x, 4, s, s);
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 2;
    const k = 14;
    for (const [cx, cy, dx, dy] of [[x, 4, 1, 1], [x + s, 4, -1, 1], [x, 4 + s, 1, -1], [x + s, 4 + s, -1, -1]]) {
      c.beginPath();
      c.moveTo(cx + dx * k, cy);
      c.lineTo(cx, cy);
      c.lineTo(cx, cy + dy * k);
      c.stroke();
    }
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.font = '600 14px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(caption, W / 2, H - 11);
    if (this.flash > 0) {
      c.fillStyle = `rgba(255,255,255,${Math.min(1, this.flash / 0.15)})`;
      c.fillRect(0, 0, W, H);
    }
    this.screenTex.needsUpdate = true;
  }
}
