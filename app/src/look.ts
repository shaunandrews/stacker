import {
  BackSide,
  BufferAttribute,
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
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
}

export const FINISHES: Finish[] = [
  { id: 'plastic', label: 'Plastic' },
  { id: 'wood', label: 'Wood' },
  { id: 'clear', label: 'Clear', trans: true },
];

// Finishes from older saves map onto the three that remain.
const RETIRED: Record<string, string> = { glass: 'clear', frosted: 'clear', diamond: 'clear' };

export function finishIndex(id: string): number {
  const k = FINISHES.findIndex((f) => f.id === (RETIRED[id] ?? id));
  return k < 0 ? 0 : k;
}

/**
 * A block material for a finish. `color` null means white, tinted per instance
 * (placed blocks).
 */
export function makeFinish(finish: Finish, color: Color | null): Material {
  const c = color ?? new Color(0xffffff);
  let m: MeshStandardMaterial;
  switch (finish.id) {
    case 'wood':
      m = new MeshStandardMaterial({ color: c, roughness: 0.62 });
      break;
    case 'clear':
      m = new MeshStandardMaterial({ color: c, roughness: 0.04, transparent: true, opacity: 0.45, depthWrite: false });
      break;
    default:
      // ABS: dielectric (F0 ≈ 0.045, three's default 0.04), glossy but not mirror-like.
      m = new MeshStandardMaterial({ color: c, roughness: 0.2 });
  }
  return patchBlockShader(m, finish.id);
}

// Wood: rings around an off-block trunk along the part's X axis, warped by value
// noise, plus fine fibres. Units are millimetres of the real brick.
const WOOD_GLSL = /* glsl */ `
float woodHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float woodNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(woodHash(i), woodHash(i + vec3(1, 0, 0)), f.x), mix(woodHash(i + vec3(0, 1, 0)), woodHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(woodHash(i + vec3(0, 0, 1)), woodHash(i + vec3(1, 0, 1)), f.x), mix(woodHash(i + vec3(0, 1, 1)), woodHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float woodGrain(vec3 p) {
  vec3 q = p + vec3(0.0, 23.0, 11.0);
  float r = length(q.yz) + woodNoise(q * vec3(0.05, 0.35, 0.35)) * 2.5;
  float ring = fract(r * 0.42);
  float late = smoothstep(0.55, 0.8, ring) * (1.0 - smoothstep(0.9, 1.0, ring));
  float fibre = woodNoise(q * vec3(0.15, 3.0, 3.0));
  return clamp(1.0 - late * 0.55 - fibre * 0.08, 0.0, 1.0);
}
`;

/**
 * Block shader tweaks, per finish:
 * - Per-vertex fixed colors (printed faces, yellow hands) override the main color;
 *   alpha 1 — or no attribute at all — means use the main color.
 * - Wood: procedural grain in the part's own space (so it doesn't jump when a block is
 *   grabbed or placed), stained by the palette color.
 * - Clear: reflections stay at full strength while the body fades (premultiplied
 *   alpha), and edges turn more opaque at grazing angles (Fresnel).
 */
/** Ambient occlusion strength for every block material (the Occlusion slider). */
export const OCCLUSION = { value: 1 };

export function patchBlockShader<T extends Material>(mat: T, finish = 'plastic'): T {
  const wood = finish === 'wood';
  const clear = finish === 'clear';
  if (clear) mat.premultipliedAlpha = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOcclusion = OCCLUSION;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 fixedColor;\nattribute float ao;\nvarying vec4 vFixedColor;\nvarying vec3 vLocal;\nvarying float vAo;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFixedColor = fixedColor;\nvLocal = position * 1000.0;\nvAo = ao;');
    let frag = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec4 vFixedColor;\nvarying vec3 vLocal;\nvarying float vAo;\nuniform float uOcclusion;\n${wood ? WOOD_GLSL : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = mix(vFixedColor.rgb, diffuseColor.rgb, vFixedColor.a);',
      )
      // Baked occlusion: mostly the bounced light (environment, fill), a little of the key.
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
float occlusion = clamp(vAo * uOcclusion, 0.0, 1.0);
reflectedLight.indirectDiffuse *= 1.0 - occlusion;
reflectedLight.indirectSpecular *= 1.0 - occlusion * 0.8;
reflectedLight.directDiffuse *= 1.0 - occlusion * 0.5;`,
      );
    if (wood) {
      frag = frag
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float grain = woodGrain(vLocal);
vec3 natural = mix(vec3(0.20, 0.09, 0.035), vec3(0.58, 0.34, 0.16), grain);
diffuseColor.rgb = natural * mix(vec3(1.0), diffuseColor.rgb * 1.9, 0.55);`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (1.0 - grain) * 0.2, 0.0, 1.0);');
    }
    if (clear) {
      frag = frag
        .replace(
          'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
          `float fresnel = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.0);
diffuseColor.a = mix(diffuseColor.a, 1.0, fresnel * 0.5);
vec3 outgoingLight = totalDiffuse * diffuseColor.a * 0.55 + totalSpecular + totalEmissiveRadiance;`,
        )
        .replace('#include <premultiplied_alpha_fragment>', '');
    }
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => `stacker-block-${finish}`;
  return mat;
}

// ============================================================ environments
// Reflection environments. Most are real HDRIs (Poly Haven, CC0, 1k) from public/env/,
// PMREM'd once when first chosen; the procedural scene of the same id shows until the
// file has loaded (and is what night and overcast always are).

export const ENVS: Array<{ id: string; label: string; hdr?: string }> = [
  { id: 'interior', label: 'Interior', hdr: 'photo_studio_loft_hall' },
  { id: 'studio', label: 'Studio', hdr: 'studio_small_09' },
  { id: 'sky', label: 'Daylight', hdr: 'kloofendal_48d_partly_cloudy_puresky' },
  { id: 'sunset', label: 'Sunset', hdr: 'venice_sunset' },
  { id: 'night', label: 'Night' },
  { id: 'overcast', label: 'Overcast' },
];

/** Environment ids from older saves. */
export function envId(id: string): string {
  return id === 'room' ? 'interior' : ENVS.some((e) => e.id === id) ? id : 'interior';
}

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
  if (id === 'room' || id === 'interior') return new RoomEnvironment() as unknown as Scene;
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
// Look presets: environment, backdrop, light and plate, tuned together.

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
}

export const STYLES: Style[] = [
  {
    name: 'Daylight',
    env: 'interior',
    envStrength: 0.55,
    envTurn: 0,
    backdrop: ['#bcd4ee', '#d8d2c8'],
    backdropAmount: 0,
    tone: 0,
    exposure: 1.05,
    key: { color: '#fff1e0', strength: 3.2, angle: -55, height: 45 },
    fill: { sky: '#ffffff', ground: '#6b6358', strength: 0.2 },
    shadow: 0.85,
    softness: 1,
    plate: '#237841',
  },
  {
    name: 'Soft',
    env: 'overcast',
    envStrength: 0.7,
    envTurn: 0,
    backdrop: ['#fbfbfa', '#e3e2de'],
    backdropAmount: 0,
    tone: 0,
    exposure: 1,
    key: { color: '#ffffff', strength: 1.8, angle: -30, height: 70 },
    fill: { sky: '#ffffff', ground: '#bdbab4', strength: 0.45 },
    shadow: 0.5,
    softness: 4,
    plate: '#2a7f47',
  },
  {
    name: 'Golden Hour',
    env: 'sunset',
    envStrength: 0.45,
    envTurn: 0,
    backdrop: ['#ffb36b', '#3a2a4a'],
    backdropAmount: 0.35,
    tone: 2,
    exposure: 1.15,
    key: { color: '#ffae5e', strength: 4.2, angle: -80, height: 14 },
    fill: { sky: '#ffd9b0', ground: '#3b2a5a', strength: 0.3 },
    shadow: 0.9,
    softness: 1.5,
    plate: '#2f6b3a',
  },
  {
    name: 'Studio',
    env: 'studio',
    envStrength: 0.45,
    envTurn: 0,
    backdrop: ['#1b1d24', '#07080b'],
    backdropAmount: 0.92,
    tone: 1,
    exposure: 1.15,
    key: { color: '#ffffff', strength: 3.8, angle: -60, height: 40 },
    fill: { sky: '#a8b8ff', ground: '#000000', strength: 0.1 },
    shadow: 0.9,
    softness: 2,
    plate: '#2b2f36',
  },
  {
    name: 'Showroom',
    env: 'overcast',
    envStrength: 0.7,
    envTurn: 0,
    backdrop: ['#fbfbfa', '#e3e2de'],
    backdropAmount: 0.95,
    tone: 0,
    exposure: 1,
    key: { color: '#ffffff', strength: 2.2, angle: -30, height: 70 },
    fill: { sky: '#ffffff', ground: '#d9d9d9', strength: 0.5 },
    shadow: 0.45,
    softness: 4,
    plate: '#f0f0ee',
  },
  {
    name: 'Moonlight',
    env: 'night',
    envStrength: 0.45,
    envTurn: 200,
    backdrop: ['#0c1424', '#05070c'],
    backdropAmount: 0.6,
    tone: 1,
    exposure: 1.35,
    key: { color: '#c6d6ff', strength: 3, angle: 120, height: 35 },
    fill: { sky: '#7d97d8', ground: '#10131d', strength: 0.4 },
    shadow: 0.7,
    softness: 2,
    plate: '#1d3a2c',
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
