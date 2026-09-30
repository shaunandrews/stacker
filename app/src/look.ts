import {
  BackSide,
  BufferAttribute,
  CanvasTexture,
  Color,
  Data3DTexture,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
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
      m = new MeshStandardMaterial({ color: c, roughness: 0.25 });
  }
  // Uncolored materials are the instanced batches of placed blocks: they also get contact occlusion.
  return patchBlockShader(m, finish.id, color === null);
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

/**
 * Contact occlusion between placed blocks: an occupancy grid over the plate (one texel
 * per stud cell × plate height, platform-local), rebuilt when the build changes.
 */
export const CONTACT = {
  grid: { value: new Data3DTexture(new Uint8Array(1), 1, 1, 1) as Data3DTexture },
  plateInv: { value: new Matrix4() }, // world → platform-local (unscaled meters)
  min: { value: new Vector3() },
  size: { value: new Vector3(1, 1, 1) },
};

const CONTACT_VERTEX = `
#ifdef STACKER_CONTACT
vec4 plateP = vec4(transformed, 1.0);
vec3 plateN = objectNormal;
#ifdef USE_INSTANCING
plateP = instanceMatrix * plateP;
plateN = mat3(instanceMatrix) * plateN;
#endif
mat4 toPlate = uPlateInv * modelMatrix;
vPlatePos = (toPlate * plateP).xyz;
vPlateNormal = mat3(toPlate) * plateN;
#endif`;

// Taps out along the normal, starting half a cell out so a block never darkens itself.
const CONTACT_FRAGMENT = `
#ifdef STACKER_CONTACT
uniform highp sampler3D uGrid;
uniform vec3 uGridMin;
uniform vec3 uGridSize;
varying vec3 vPlatePos;
varying vec3 vPlateNormal;
float contactOcclusion() {
  vec3 n = normalize(vPlateNormal);
  float occ = 0.0;
  const vec3 dist = vec3(0.0045, 0.0085, 0.0135);
  const vec3 weight = vec3(0.5, 0.32, 0.18);
  for (int i = 0; i < 3; i++) {
    vec3 t = (vPlatePos + n * dist[i] - uGridMin) / uGridSize;
    if (all(greaterThanEqual(t, vec3(0.0))) && all(lessThanEqual(t, vec3(1.0)))) occ += weight[i] * texture(uGrid, t).r;
  }
  return occ;
}
#endif`;

// Stud logo: a tiny embossed winking smiley on every stud top (not anyone's trademark).
// A height map, turned into a bump in the shader; mipmaps and a pixel-size fade keep it
// from shimmering at a distance.
function makeLogo(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  g.filter = 'blur(1.2px)';
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineCap = 'round';
  g.lineWidth = 7;
  g.beginPath(); // open eye
  g.arc(47, 50, 6.5, 0, Math.PI * 2);
  g.fill();
  g.beginPath(); // wink
  g.moveTo(72, 51);
  g.quadraticCurveTo(81, 44, 90, 51);
  g.stroke();
  g.beginPath(); // grin
  g.arc(64, 64, 26, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
export const LOGO = { value: null as CanvasTexture | null };

// Plastic micro-surface: value noise in the part's own millimetres (vLocal), offset per
// instance, for a faint orange-peel in the normal and roughness. Fades out once a feature
// gets smaller than a pixel so studs don't shimmer.
const MICRO_GLSL = `
varying float vSeed;
varying vec2 vStudUv;
uniform sampler2D uLogo;
float stackerHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float stackerNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(stackerHash(i), stackerHash(i + vec3(1, 0, 0)), f.x), mix(stackerHash(i + vec3(0, 1, 0)), stackerHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(stackerHash(i + vec3(0, 0, 1)), stackerHash(i + vec3(1, 0, 1)), f.x), mix(stackerHash(i + vec3(0, 1, 1)), stackerHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}`;

export function patchBlockShader<T extends Material>(mat: T, finish = 'plastic', contact = false): T {
  const wood = finish === 'wood';
  const clear = finish === 'clear';
  const micro = finish === 'plastic' && (mat as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial === true;
  if (clear) mat.premultipliedAlpha = true;
  if (contact) (mat as T & { defines: Record<string, string> }).defines = { ...(mat as T & { defines?: Record<string, string> }).defines, STACKER_CONTACT: '' };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOcclusion = OCCLUSION;
    shader.uniforms.uGrid = CONTACT.grid;
    shader.uniforms.uPlateInv = CONTACT.plateInv;
    shader.uniforms.uGridMin = CONTACT.min;
    shader.uniforms.uGridSize = CONTACT.size;
    if (micro) shader.uniforms.uLogo = LOGO.value ? LOGO : (LOGO.value = makeLogo(), LOGO);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 fixedColor;
attribute float ao;
varying vec4 vFixedColor;
varying vec3 vLocal;
varying float vAo;
varying float vSeed;
attribute vec2 studUv;
varying vec2 vStudUv;
#ifdef STACKER_CONTACT
uniform mat4 uPlateInv;
varying vec3 vPlatePos;
varying vec3 vPlateNormal;
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFixedColor = fixedColor;
vLocal = position * 1000.0;
vAo = ao;
vStudUv = studUv;
#ifdef USE_INSTANCING
vSeed = fract(sin(float(gl_InstanceID) * 12.9898 + 78.233) * 43758.5453);
#else
vSeed = 0.5;
#endif${CONTACT_VERTEX}`,
      );
    let frag = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec4 vFixedColor;\nvarying vec3 vLocal;\nvarying float vAo;\nuniform float uOcclusion;\n${CONTACT_FRAGMENT}\n${wood ? WOOD_GLSL : ''}${micro ? MICRO_GLSL : ''}`,
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
#ifdef STACKER_CONTACT
occlusion = 1.0 - (1.0 - occlusion) * (1.0 - clamp(contactOcclusion() * uOcclusion, 0.0, 0.85));
#endif
reflectedLight.indirectDiffuse *= 1.0 - occlusion;
reflectedLight.indirectSpecular *= 1.0 - occlusion * 0.8;
reflectedLight.directDiffuse *= 1.0 - occlusion * 0.5;${
          // ABS lets a little light through: a faint glow of its own color, strongest where open.
          micro ? '\nreflectedLight.indirectDiffuse += diffuseColor.rgb * diffuseColor.rgb * 0.035 * (1.0 - occlusion);' : ''
        }`,
      );
    if (micro) {
      frag = frag
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
// No two bricks quite alike: ~1.5% value and a touch of hue per instance.
diffuseColor.rgb *= 1.0 + (vSeed - 0.5) * 0.03;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.gbr, (fract(vSeed * 7.13) - 0.5) * 0.015);
vec3 microP = vLocal * 0.7 + vSeed * 91.0;
float micro = stackerNoise(microP);
float microFade = clamp(1.5 - length(fwidth(microP)) * 1.5, 0.0, 1.0);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (fract(vSeed * 3.71) - 0.5) * 0.06 + (micro - 0.5) * 0.06 * microFade, 0.05, 1.0);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
{
  // Screen-space bump from the noise (as three's bump map does), ~10 µm tall.
  vec2 dh = vec2(dFdx(micro), dFdy(micro)) * 1.1e-5 * microFade;
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  // Stud logo (studUv is 0–1 across the stud top; missing or off the top it's out of range).
  vec2 inStud = step(vec2(0.0), vStudUv) * step(vStudUv, vec2(1.0));
  float logoFade = clamp(1.0 - length(fwidth(vStudUv)) * 10.0, 0.0, 1.0);
  float logo = texture2D(uLogo, clamp(vStudUv, 0.0, 1.0)).r * inStud.x * inStud.y * step(0.001, vStudUv.x) * logoFade;
  dh += vec2(dFdx(logo), dFdy(logo)) * 8e-5;
  normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
}`,
        );
    }
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
  mat.customProgramCacheKey = () => `stacker-block-${finish}-${contact}`;
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
    envStrength: 0.65,
    envTurn: 90, // the loft's windows catch stud rims and roofs from the front
    backdrop: ['#bcd4ee', '#d8d2c8'],
    backdropAmount: 0,
    tone: 0,
    exposure: 1.1,
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
