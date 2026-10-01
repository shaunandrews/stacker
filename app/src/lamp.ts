import { AdditiveBlending, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from '@iwsdk/core';

// A light bulb hanging above the player with a pull cord: each pull steps the room's
// lights through DIM_LEVELS. Built here; the system handles grabbing the bead.

/** Light levels a pull steps through: full, dim, low, and round again. */
export const DIM_LEVELS = [1, 0.6, 0.3];

const CORD = 0.3; // meters from the socket to the bead at rest
export const PULL_CLICK = 0.05; // pull this far and it clicks
export const PULL_MAX = 0.12;

const WARM = new Color(0xffe2a8);
const COLD = new Color(0x55504a);

export class PullLamp {
  readonly group = new Group();
  readonly bead: Mesh;
  pull = 0; // meters the cord is stretched past its rest length
  private readonly cord: Mesh;
  private readonly glass: MeshBasicMaterial;
  private readonly halo: MeshBasicMaterial;

  constructor() {
    this.group.name = 'Lamp';
    // Wire up out of sight, socket, bulb, glow.
    const metal = new MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.4, metalness: 0.6 });
    const wire = new Mesh(new CylinderGeometry(0.0015, 0.0015, 0.4, 6).translate(0, 0.2 + 0.03, 0), metal);
    const socket = new Mesh(new CylinderGeometry(0.014, 0.017, 0.032, 16).translate(0, 0.016, 0), metal);
    this.glass = new MeshBasicMaterial({ color: WARM.clone(), toneMapped: false });
    const bulb = new Mesh(new SphereGeometry(0.026, 24, 16).scale(1, 1.18, 1).translate(0, -0.026, 0), this.glass);
    this.halo = new MeshBasicMaterial({ color: WARM.clone(), transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const halo = new Mesh(new SphereGeometry(0.06, 20, 14).translate(0, -0.026, 0), this.halo);
    // The pull cord hangs from the socket's side and ends in a wooden bead.
    const string = new MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9 });
    this.cord = new Mesh(new CylinderGeometry(0.0012, 0.0012, 1, 5).translate(0, -0.5, 0), string);
    this.cord.position.set(0.018, 0.008, 0);
    this.bead = new Mesh(new SphereGeometry(0.009, 16, 12), new MeshStandardMaterial({ color: 0xb07a45, roughness: 0.55 }));
    this.bead.name = 'LampBead';
    this.group.add(wire, socket, bulb, halo, this.cord, this.bead);
    this.setPull(0);
  }

  /** Stretch the cord: 0 at rest, up to PULL_MAX. */
  setPull(d: number): void {
    this.pull = d;
    const len = CORD + d;
    this.cord.scale.set(1, len, 1);
    this.bead.position.set(0.018, 0.008 - len - 0.009, 0);
  }

  /** How brightly the bulb itself glows, 0–1 (follows the room's light level). */
  setGlow(level: number): void {
    this.glass.color.copy(COLD).lerp(WARM, level);
    this.halo.opacity = 0.08 + 0.22 * level;
  }
}
