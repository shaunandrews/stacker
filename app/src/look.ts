import {
  BackSide,
  BufferAttribute,
  Color,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  PlaneGeometry,
  RedFormat,
  Scene,
  SphereGeometry,
} from '@iwsdk/core';
import type { Material } from '@iwsdk/core';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// ============================================================ finishes
// What a block is made of. Color comes from the palette (per block, or per instance
// for placed blocks); the finish decides how that color meets the light.

export interface Finish {
  id: string;
  label: string;
  trans?: boolean; // see-through: drawn after opaque blocks, no shadows
  env?: number; // reflection strength multiplier
  glow?: number; // emissive from the block's own color
}

export const FINISHES: Finish[] = [
  { id: 'shiny', label: 'Shiny' },
  { id: 'satin', label: 'Satin' },
  { id: 'matte', label: 'Matte' },
  { id: 'rubber', label: 'Rubber' },
  { id: 'glass', label: 'Glass', trans: true, env: 1.6 },
  { id: 'frosted', label: 'Frosted', trans: true },
  { id: 'diamond', label: 'Diamond', trans: true, env: 3 },
  { id: 'chrome', label: 'Chrome', env: 1.4 },
  { id: 'brushed', label: 'Brushed' },
  { id: 'pearl', label: 'Pearl' },
  { id: 'glow', label: 'Glow', glow: 1.4 },
  { id: 'toon', label: 'Toon' },
];

export function finishIndex(id: string): number {
  const k = FINISHES.findIndex((f) => f.id === id);
  return k < 0 ? 0 : k;
}

let toonRamp: DataTexture | null = null;
function toonGradient(): DataTexture {
  if (!toonRamp) {
    toonRamp = new DataTexture(new Uint8Array([70, 160, 255]), 3, 1, RedFormat);
    toonRamp.minFilter = toonRamp.magFilter = NearestFilter;
    toonRamp.needsUpdate = true;
  }
  return toonRamp;
}

/**
 * A block material for a finish. `color` null means white, tinted per instance
 * (placed blocks). `solid` replaces every block's color (Clay, Blueprint styles).
 */
export function makeFinish(finish: Finish, color: Color | null, solid: Color | null): Material {
  const c = solid ?? color ?? new Color(0xffffff);
  let m: MeshStandardMaterial | MeshToonMaterial;
  switch (finish.id) {
    case 'shiny':
      m = new MeshPhysicalMaterial({ color: c, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.08 });
      break;
    case 'satin':
      m = new MeshStandardMaterial({ color: c, roughness: 0.45 });
      break;
    case 'matte':
      m = new MeshStandardMaterial({ color: c, roughness: 0.85 });
      break;
    case 'rubber':
      m = new MeshStandardMaterial({ color: c, roughness: 1 });
      break;
    case 'glass':
      m = new MeshPhysicalMaterial({ color: c, roughness: 0.02, ior: 1.5, transparent: true, opacity: 0.35, depthWrite: false });
      break;
    case 'frosted':
      m = new MeshPhysicalMaterial({ color: c, roughness: 0.5, transparent: true, opacity: 0.65, depthWrite: false });
      break;
    case 'diamond':
      m = new MeshPhysicalMaterial({
        color: c,
        roughness: 0,
        ior: 2.4,
        iridescence: 0.6,
        iridescenceIOR: 1.8,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      });
      break;
    case 'chrome':
      m = new MeshStandardMaterial({ color: c, metalness: 1, roughness: 0.06 });
      break;
    case 'brushed':
      m = new MeshStandardMaterial({ color: c, metalness: 1, roughness: 0.38 });
      break;
    case 'pearl':
      m = new MeshPhysicalMaterial({ color: c, roughness: 0.35, iridescence: 1, iridescenceIOR: 1.3, sheen: 0.6, sheenColor: new Color(0xffffff) });
      break;
    case 'glow':
      m = new MeshStandardMaterial({ color: c, roughness: 0.4 });
      break;
    default:
      m = new MeshToonMaterial({ color: c, gradientMap: toonGradient() });
  }
  m.userData.envBase = finish.env ?? 1;
  return patchBlockShader(m, finish.glow ?? 0, !!solid);
}

/**
 * Per-vertex fixed colors (printed faces, yellow hands) override the main color;
 * alpha 1 — or no attribute at all — means use the main color. Glow finishes emit
 * their own color. Solid (override) materials ignore instance colors and prints.
 */
export function patchBlockShader<T extends Material>(mat: T, glow = 0, solid = false): T {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 fixedColor;\nvarying vec4 vFixedColor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFixedColor = fixedColor;');
    let frag = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vFixedColor;');
    frag = solid
      ? frag.replace('#include <color_fragment>', '')
      : frag.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb = mix(vFixedColor.rgb, diffuseColor.rgb, vFixedColor.a);',
        );
    if (glow > 0) {
      frag = frag.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${glow.toFixed(2)};`,
      );
    }
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => `stacker-block-${glow}-${solid}`;
  return mat;
}

// ============================================================ environments
// Reflection environments, rendered into a PMREM once when chosen.

export const ENVS = [
  { id: 'room', label: 'Room' },
  { id: 'studio', label: 'Studio' },
  { id: 'sky', label: 'Sky' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'night', label: 'Night' },
  { id: 'overcast', label: 'Overcast' },
];

function gradientSphere(zenith: string, horizon: string, ground: string, radius = 50): Mesh {
  const geo = new SphereGeometry(radius, 32, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const z = new Color(zenith);
  const h = new Color(horizon);
  const g = new Color(ground);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / radius;
    if (t >= 0) c.copy(h).lerp(z, Math.pow(t, 0.6));
    else c.copy(h).lerp(g, Math.min(1, -t * 4));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide }));
}

function glowPanel(color: string, power: number, w: number, h: number, x: number, y: number, z: number): Mesh {
  const panel = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(power) }));
  panel.position.set(x, y, z);
  panel.lookAt(0, 0, 0);
  return panel;
}

function glowBall(color: string, power: number, r: number, x: number, y: number, z: number): Mesh {
  const ball = new Mesh(new SphereGeometry(r, 16, 8), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(power) }));
  ball.position.set(x, y, z);
  return ball;
}

export function makeEnvScene(id: string): Scene {
  if (id === 'room') return new RoomEnvironment() as unknown as Scene;
  const s = new Scene();
  switch (id) {
    case 'studio':
      s.add(gradientSphere('#15161a', '#0d0e11', '#08080a'));
      s.add(glowPanel('#ffffff', 8, 6, 3, -8, 4, 3));
      s.add(glowPanel('#ffffff', 5, 4, 4, 8, 3, 2));
      s.add(glowPanel('#ffffff', 10, 8, 2, 0, 10, 0));
      s.add(glowPanel('#dfe8ff', 2, 10, 2, 0, 2, -9));
      break;
    case 'sky':
      s.add(gradientSphere('#3f7fd6', '#cfe4f7', '#6b6152'));
      s.add(glowBall('#fff4d6', 30, 1.6, -12, 18, 10));
      break;
    case 'sunset':
      s.add(gradientSphere('#23204a', '#ff8f4d', '#2a1b1c'));
      s.add(glowBall('#ffb46b', 35, 2.2, -16, 3, -14));
      break;
    case 'night':
      s.add(gradientSphere('#04050e', '#10183a', '#030307'));
      s.add(glowPanel('#ff3ad7', 7, 10, 0.6, -9, 3, -5));
      s.add(glowPanel('#2ee6ff', 7, 10, 0.6, 9, 2, -4));
      s.add(glowPanel('#8f7dff', 4, 12, 0.5, 0, 9, 6));
      break;
    default: // overcast
      s.add(gradientSphere('#eef0f3', '#f7f7f7', '#8f8e8b'));
      s.add(glowPanel('#ffffff', 2.5, 30, 30, 0, 20, 0));
  }
  return s;
}

// ============================================================ styles
// Complete art directions: environment, backdrop, light, camera and plate — and for a
// few, one finish or color applied to every block.

export interface Style {
  name: string;
  env: string;
  envStrength: number;
  envTurn: number;
  backdrop: [string, string]; // dome top and bottom colors
  backdropAmount: number; // 0 = your room (passthrough), 1 = fully virtual
  tone: number; // index into the renderer's tone mappings
  exposure: number;
  key: { color: string; strength: number; angle: number; height: number };
  fill: { sky: string; ground: string; strength: number };
  shadow: number;
  softness: number;
  plate: string;
  finish?: string; // every block in this finish
  solid?: string; // every block in this color
}

export const STYLES: Style[] = [
  {
    name: 'Daylight',
    env: 'room',
    envStrength: 1,
    envTurn: 0,
    backdrop: ['#bcd4ee', '#d8d2c8'],
    backdropAmount: 0,
    tone: 0,
    exposure: 1.05,
    key: { color: '#fff1e0', strength: 2.4, angle: -40, height: 55 },
    fill: { sky: '#ffffff', ground: '#6b6358', strength: 0.35 },
    shadow: 0.8,
    softness: 1,
    plate: '#237841',
  },
  {
    name: 'Studio',
    env: 'studio',
    envStrength: 1.3,
    envTurn: 0,
    backdrop: ['#1b1d24', '#07080b'],
    backdropAmount: 0.92,
    tone: 1,
    exposure: 1.15,
    key: { color: '#ffffff', strength: 3.4, angle: -60, height: 40 },
    fill: { sky: '#a8b8ff', ground: '#000000', strength: 0.15 },
    shadow: 0.9,
    softness: 2,
    plate: '#2b2f36',
  },
  {
    name: 'Product',
    env: 'overcast',
    envStrength: 1.1,
    envTurn: 0,
    backdrop: ['#fbfbfa', '#e3e2de'],
    backdropAmount: 0.95,
    tone: 0,
    exposure: 1,
    key: { color: '#ffffff', strength: 1.8, angle: -30, height: 70 },
    fill: { sky: '#ffffff', ground: '#d9d9d9', strength: 0.9 },
    shadow: 0.45,
    softness: 4,
    plate: '#f0f0ee',
  },
  {
    name: 'Golden Hour',
    env: 'sunset',
    envStrength: 1.1,
    envTurn: 0,
    backdrop: ['#ffb36b', '#3a2a4a'],
    backdropAmount: 0.35,
    tone: 2,
    exposure: 1.15,
    key: { color: '#ffae5e', strength: 3.6, angle: -80, height: 14 },
    fill: { sky: '#ffd9b0', ground: '#3b2a5a', strength: 0.45 },
    shadow: 0.9,
    softness: 1.5,
    plate: '#2f6b3a',
  },
  {
    name: 'Neon Night',
    env: 'night',
    envStrength: 1.5,
    envTurn: 0,
    backdrop: ['#0a0824', '#000000'],
    backdropAmount: 0.9,
    tone: 1,
    exposure: 1.55,
    key: { color: '#b3c6ff', strength: 2.2, angle: 60, height: 35 },
    fill: { sky: '#ff4fd8', ground: '#1b2cff', strength: 1.1 },
    shadow: 0.6,
    softness: 2,
    plate: '#141628',
  },
  {
    name: 'Pastel',
    env: 'sky',
    envStrength: 0.9,
    envTurn: 0,
    backdrop: ['#fde2f3', '#d7f0ff'],
    backdropAmount: 0.8,
    tone: 0,
    exposure: 1.15,
    key: { color: '#fff6ee', strength: 1.6, angle: -30, height: 60 },
    fill: { sky: '#fff0f8', ground: '#dff3ff', strength: 1 },
    shadow: 0.35,
    softness: 4,
    plate: '#b8e0c8',
    finish: 'matte',
  },
  {
    name: 'Cinematic',
    env: 'sunset',
    envStrength: 0.8,
    envTurn: 140,
    backdrop: ['#0e1a24', '#1a0f08'],
    backdropAmount: 0.7,
    tone: 2,
    exposure: 1,
    key: { color: '#ffc58a', strength: 3, angle: -110, height: 25 },
    fill: { sky: '#3fa8c8', ground: '#2a1408', strength: 0.5 },
    shadow: 1,
    softness: 1,
    plate: '#1f3a2e',
  },
  {
    name: 'Clay',
    env: 'overcast',
    envStrength: 0.9,
    envTurn: 0,
    backdrop: ['#dcd8d2', '#b9b4ad'],
    backdropAmount: 0.9,
    tone: 0,
    exposure: 1.05,
    key: { color: '#ffffff', strength: 2.2, angle: -45, height: 50 },
    fill: { sky: '#ffffff', ground: '#a8a39c', strength: 0.6 },
    shadow: 0.7,
    softness: 3,
    plate: '#cfcac3',
    finish: 'matte',
    solid: '#e8e2da',
  },
  {
    name: 'Blueprint',
    env: 'night',
    envStrength: 1,
    envTurn: 0,
    backdrop: ['#0b2a55', '#06162e'],
    backdropAmount: 0.95,
    tone: 0,
    exposure: 1.1,
    key: { color: '#cfe6ff', strength: 1, angle: -40, height: 55 },
    fill: { sky: '#6fb6ff', ground: '#0b2a55', strength: 1 },
    shadow: 0,
    softness: 1,
    plate: '#0e3470',
    finish: 'glass',
    solid: '#8fd3ff',
  },
  {
    name: 'Cartoon',
    env: 'sky',
    envStrength: 0.6,
    envTurn: 0,
    backdrop: ['#8fd0ff', '#e9f6ff'],
    backdropAmount: 0,
    tone: 3,
    exposure: 1,
    key: { color: '#ffffff', strength: 2.8, angle: -35, height: 55 },
    fill: { sky: '#ffffff', ground: '#a0a0a0', strength: 0.5 },
    shadow: 0.6,
    softness: 0,
    plate: '#3fae4f',
    finish: 'toon',
  },
  {
    name: 'Moonlight',
    env: 'night',
    envStrength: 0.9,
    envTurn: 200,
    backdrop: ['#0c1424', '#05070c'],
    backdropAmount: 0.6,
    tone: 1,
    exposure: 1.35,
    key: { color: '#c6d6ff', strength: 2.6, angle: 120, height: 35 },
    fill: { sky: '#7d97d8', ground: '#10131d', strength: 0.7 },
    shadow: 0.7,
    softness: 2,
    plate: '#1d3a2c',
  },
  {
    name: 'Showroom',
    env: 'studio',
    envStrength: 2,
    envTurn: 60,
    backdrop: ['#141414', '#2b2b2b'],
    backdropAmount: 0.85,
    tone: 0,
    exposure: 1,
    key: { color: '#ffffff', strength: 2.6, angle: -20, height: 60 },
    fill: { sky: '#ffffff', ground: '#202020', strength: 0.2 },
    shadow: 0.9,
    softness: 1,
    plate: '#101012',
    finish: 'shiny',
  },
];

/** Inverted gradient dome used as the virtual backdrop (fades your room out). */
export function makeBackdrop(): Mesh {
  const dome = gradientSphere('#000000', '#000000', '#000000', 30);
  const mat = dome.material as MeshBasicMaterial;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.toneMapped = false;
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  return dome;
}

/** Recolor the backdrop dome: top color above the horizon, bottom below. */
export function paintBackdrop(dome: Mesh, top: string, bottom: string): void {
  const geo = dome.geometry;
  const pos = geo.attributes.position;
  const col = geo.attributes.color as BufferAttribute;
  const t = new Color(top);
  const b = new Color(bottom);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 30;
    c.copy(b).lerp(t, Math.min(1, Math.max(0, y * 0.9 + 0.5)));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}
