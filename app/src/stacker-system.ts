import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  createSystem,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Entity,
  Euler,
  HemisphereLight,
  InputComponent,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  NoToneMapping,
  Object3D,
  PCFShadowMap,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import type { ToneMapping } from '@iwsdk/core';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { blockMaterial, dims, isSymmetric, Library, studGeometry, TABS } from './blocks.js';

// ---- Platform (world meters ÷ the Size scale = platform-local units) ----
const PLATE_T = 0.008;
const MIN_STUDS = 4;
const MAX_STUDS = 64;
const START_STUDS = 32;
const MAX_LEVEL = 400; // half plates
const SNAP_DROP = 0.05;
const HANDLE_OUT = 0.024;
const LEVEL_SNAP = (7 * Math.PI) / 180;

// ---- Input ----
const CTRL_TIP = 0.035;
const CTRL_REACH = 0.04;
const HAND_REACH = 0.028;
const PINCH_ON = 0.018;
const PINCH_OFF = 0.035;
const HOLD_DIST = 0.08;
const CELL = 0.016; // connector hash cell (2 studs)
const FACING = -0.77; // connectors must face each other within ~40°
const DROP_STEPS = [0, 0.012, 0.024, 0.036, 0.048]; // world meters a held block may settle down onto studs
const NO_DROP = [0];
const RAY_MAX = 4;
const FOLLOW_CTRL = 40;
const FOLLOW_HAND = 22;
const SNAP_TIME = 0.07;
const GHOST_PULL = 0.06; // a kit piece jumps into its ghost (position and angle) within this distance

// ---- Panels (local frame: face is the XY plane, +Z toward the user, origin at center) ----
const CELL_W = 0.07;
const CELL_H = 0.062;
const GAP = 0.005;
const MARGIN = 0.012;
const PREVIEW_FIT = 0.042;
const SLOTS = 6;
const KITS = [
  { id: '7796-1', title: 'House', pieces: 56 },
  { id: '6400-1', title: 'Go-Kart', pieces: 29 },
  { id: '7910-1', title: 'Robot', pieces: 25 },
];
const TAB_NAMES = [...TABS, 'Kits', 'Saves'];
const SHELF_W = 0.34;
const SHELF_D = 0.16;

// ---- Look & render settings ----
interface SliderDef {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
const deg = (v: number) => `${Math.round(v)}°`;
const SLIDERS: SliderDef[] = [
  { id: 'size', label: 'Size', min: 0.75, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { id: 'exposure', label: 'Exposure', min: 0.3, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  { id: 'key', label: 'Key light', min: 0, max: 6, step: 0.1, fmt: (v) => v.toFixed(1) },
  { id: 'keyAz', label: 'Key angle', min: -180, max: 180, step: 5, fmt: deg },
  { id: 'keyEl', label: 'Key height', min: 5, max: 90, step: 1, fmt: deg },
  { id: 'warmth', label: 'Key warmth', min: -1, max: 1, step: 0.05, fmt: (v) => (v > 0 ? `warm ${pct(v)}` : v < 0 ? `cool ${pct(-v)}` : 'neutral') },
  { id: 'fill', label: 'Fill light', min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) },
  { id: 'env', label: 'Reflections', min: 0, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
  { id: 'envRot', label: 'Reflection turn', min: 0, max: 360, step: 5, fmt: deg },
  { id: 'rough', label: 'Roughness', min: 0, max: 1, step: 0.01, fmt: pct },
  { id: 'metal', label: 'Metalness', min: 0, max: 1, step: 0.01, fmt: pct },
  { id: 'clearcoat', label: 'Clearcoat*', min: 0, max: 1, step: 0.01, fmt: pct },
  { id: 'ccRough', label: 'Coat roughness*', min: 0, max: 1, step: 0.01, fmt: pct },
  { id: 'trans', label: 'See-through', min: 0.1, max: 1, step: 0.01, fmt: pct },
  { id: 'plate', label: 'Plate brightness', min: 0.2, max: 1.6, step: 0.05, fmt: pct },
  { id: 'plateRough', label: 'Plate roughness', min: 0, max: 1, step: 0.01, fmt: pct },
  { id: 'shadow', label: 'Shadow strength', min: 0, max: 1, step: 0.05, fmt: pct },
  { id: 'shadowSoft', label: 'Shadow softness', min: 0, max: 6, step: 0.25, fmt: (v) => v.toFixed(2) },
  { id: 'foveation', label: 'Foveation', min: 0, max: 1, step: 0.05, fmt: pct },
];
const DEFAULTS: Record<string, number> = {
  exposure: 1.05,
  key: 2.4,
  keyAz: -40,
  keyEl: 55,
  warmth: 0.3,
  fill: 0.35,
  env: 1,
  envRot: 0,
  rough: 0.3,
  metal: 0,
  clearcoat: 0,
  ccRough: 0.1,
  trans: 0.5,
  plate: 1,
  plateRough: 0.5,
  shadow: 0.8,
  shadowSoft: 1,
  foveation: 1,
};
const TONES: Array<[string, ToneMapping]> = [
  ['Neutral', NeutralToneMapping],
  ['ACES', ACESFilmicToneMapping],
  ['AgX', AgXToneMapping],
  ['None', NoToneMapping],
];
const INSTRUCTIONS = ['ghosts', 'manual', 'both'] as const;
type Instructions = (typeof INSTRUCTIONS)[number];

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];
type Btn = 'squeeze' | 'trigger' | 'a' | 'b' | 'pinch' | 'mid';
type Tool = 'build' | 'select' | 'paint';
type PanelId = 'library' | 'settings' | 'manual';
type FrameKind = 'platform' | 'shelf' | PanelId;

/** Where a block sits: a full transform in platform-local (unscaled) meters. */
interface Placement {
  m: Matrix4;
  target?: Placed; // kit ghost this placement fills
}

interface Placed extends Placement {
  part: number;
  color: number;
  slot: number;
  batch: string;
  mi?: Matrix4;
}

interface Batch {
  entity: Entity;
  mesh: InstancedMesh;
  records: Placed[];
}

interface Loose {
  entity: Entity;
  mesh: Mesh;
  part: number;
  color: number;
}

interface Piece {
  block: Loose;
  offPos: Vector3; // pose relative to the anchor (pieces[0])
  offQuat: Quaternion;
}

/** A stud (type 0) or socket (type 1) on a placed block — or a baseplate stud (rec null). */
interface Conn {
  rec: Placed | null;
  type: number;
  p: Vector3; // platform-local position
  a: Vector3; // direction it faces (out of the stud / out of the socket)
}

interface PartConns {
  male: Array<{ p: Vector3; a: Vector3 }>;
  female: Array<{ p: Vector3; a: Vector3 }>;
  joint: { pair: string; role: string; o: Vector3 } | null;
  body: { c: Vector3; h: Vector3 }; // collision box (studs trimmed off the top)
}

interface Panel {
  id: PanelId;
  entity: Entity;
  bg: Mesh;
  w: number;
  h: number;
  items: UiItem[];
  content: Entity[]; // rebuilt on layout
  bar: Mesh;
  resize: Mesh | null;
}

interface UiItem {
  id: string;
  kind: 'button' | 'tab' | 'swatch' | 'cell' | 'slider' | 'label';
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
  mesh: Mesh;
  panel: Panel;
  canvas?: HTMLCanvasElement;
  tex?: CanvasTexture;
  preview?: Mesh;
  hover: boolean;
}

type TargetKind = 'placed' | 'loose' | 'cell' | 'ui' | 'edge' | 'corner' | 'bar' | 'resize';

interface Target {
  kind: TargetKind;
  placed?: Placed;
  loose?: Loose;
  ui?: UiItem;
  corner?: number;
  frame?: FrameKind;
  obj?: Object3D;
  score: number;
}

interface HandState {
  hand: Hand;
  mode: 'none' | 'controller' | 'hand';
  rayOrigin: Vector3;
  rayDir: Vector3;
  point: Vector3;
  quat: Quaternion;
  indexTip: Vector3;
  hasTip: boolean;
  down: Set<Btn>;
  up: Set<Btn>;
  pinching: boolean;
  midPinching: boolean;
  pokeLatched: boolean;
  target: Target | null;
  targetFar: boolean;
  pieces: Piece[] | null;
  holdButton: Btn | null;
  fromSelection: boolean;
  rotTarget: Quaternion; // controller: where the held block's rotation is easing to
  painting: boolean;
  slider: UiItem | null;
  frame: FrameKind | null;
  resizing: Panel | null;
  resizeAnchor: Vector3;
  corner: number;
  anchorDist: number;
  offsetPos: Vector3;
  offsetQuat: Quaternion;
  outline: Mesh;
  ghosts: Mesh[];
  ray: Mesh;
  cursor: Mesh;
  guide: Line;
  lit: LineSegments | null; // kit ghost highlighted for the piece in hand
}

interface KitBlock {
  part: string;
  color: number;
  i?: number;
  j?: number;
  level?: number;
  turns?: number;
  fw?: number;
  fd?: number;
  m?: number[];
}

interface KitState {
  id: string;
  title: string;
  steps: KitBlock[][];
  step: number;
  page: number;
  di: number;
  dj: number;
  remaining: Array<{ rec: Placed; ghost: Entity }>;
  matched: Map<Placed, Placed>;
  stepPlaced: Placed[];
  spawned: Loose[];
}

const GRAB_BTNS: Btn[] = ['squeeze', 'trigger', 'pinch'];
const DUP_BTNS: Btn[] = ['a', 'mid'];

export class StackerSystem extends createSystem({}) {
  private lib!: Library;
  private ready = false;
  private physical = false;
  private mats!: MeshStandardMaterial[];
  private colors!: Color[];
  private opaqueMat!: MeshStandardMaterial;
  private transMat!: MeshStandardMaterial;
  private plateMat!: MeshStandardMaterial;
  private edgeGeos = new Map<number, BufferGeometry>();
  private ghostLineMat!: LineBasicMaterial;
  private ghostLitMat!: LineBasicMaterial;
  private stepLineMat!: LineBasicMaterial;
  private built: Entity[] = [];
  private time = 0;

  // Look & render
  private visual: Record<string, number> = { ...DEFAULTS };
  private tone = 0;
  private instructions: Instructions = 'ghosts';
  private hemi!: HemisphereLight;
  private keyLight!: DirectionalLight;

  // Platform
  private root!: Entity;
  private scale = 1;
  private bounds = { x0: 0, x1: 0, z0: 0, z1: 0 };
  private slab!: Mesh;
  private plateStuds!: InstancedMesh;
  private edges: Object3D[] = [];
  private corners: Object3D[] = [];
  private batches = new Map<string, Batch>();
  private pconn: PartConns[] = [];
  private connIndex = new Map<number, Conn[]>();
  private recConns = new Map<Placed, Array<[number, Conn]>>();
  private near: Conn[] = [];
  private placedRecs: Placed[] = [];
  private levelAnim: { from: Quaternion; to: Quaternion; t: number } | null = null;

  // Panels
  private panels: Panel[] = [];
  private library!: Panel;
  private settings!: Panel;
  private manual: Panel | null = null;
  private cellsPerPage = 12;
  private tab = 0;
  private page = 0;
  private color = 0;
  private slot = 0;
  private statsCanvas: HTMLCanvasElement | null = null;
  private statsTex: CanvasTexture | null = null;
  private mini: Object3D | null = null;

  // Kit shelf
  private shelf: Entity | null = null;
  private shelfBar: Object3D | null = null;
  private shelfCanvas!: HTMLCanvasElement;
  private shelfTex!: CanvasTexture;
  private shelfItems: Array<{ block: Loose; pos: Vector3 }> = [];
  private shelfParts: Entity[] = [];

  // Tools & state
  private tool: Tool = 'build';
  private selection = new Set<Placed>();
  private selOutlines: Mesh[] = [];
  private kit: KitState | null = null;
  private loose: Loose[] = [];
  private poofs: Array<{ entity: Entity; t: number }> = [];
  private snaps: Array<{ block: Loose; rec: Placed; fromPos: Vector3; fromQuat: Quaternion; t: number }> = [];
  private hands!: HandState[];
  private dirty = false;
  private visualDirty = false;
  private saveTimer = 0;
  private builtForXR = false;
  private recenterDelay = -1;
  private snapOut: Placement[] = [];

  // Stats
  private frameCount = 0;
  private frameTime = 0;
  private worstFrame = 0;
  private statsTimer = 0;
  private stats = { fps: 0, worstMs: 0 };
  private audio?: AudioContext;

  // Temps
  private v1!: Vector3;
  private v2!: Vector3;
  private v3!: Vector3;
  private v4!: Vector3;
  private v5!: Vector3;
  private v6!: Vector3;
  private q1!: Quaternion;
  private q2!: Quaternion;
  private m1!: Matrix4;
  private m2!: Matrix4;
  private axA = [new Vector3(), new Vector3(), new Vector3()];
  private axB = [new Vector3(), new Vector3(), new Vector3()];
  private euler!: Euler;
  private up!: Vector3;
  private one!: Vector3;

  init(): void {
    this.v1 = new Vector3();
    this.v2 = new Vector3();
    this.v3 = new Vector3();
    this.v4 = new Vector3();
    this.v5 = new Vector3();
    this.v6 = new Vector3();
    this.q1 = new Quaternion();
    this.q2 = new Quaternion();
    this.m1 = new Matrix4();
    this.m2 = new Matrix4();
    this.euler = new Euler();
    this.up = new Vector3(0, 1, 0);
    this.one = new Vector3(1, 1, 1);
    this.ghostLineMat = new LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9, depthWrite: false });
    this.ghostLitMat = new LineBasicMaterial({ color: 0xfde047, transparent: true, opacity: 1, depthWrite: false, depthTest: false });
    this.stepLineMat = new LineBasicMaterial({ color: 0xfde047 });

    if (import.meta.env.DEV) (window as unknown as { stacker: unknown }).stacker = this;

    for (const hand of HANDS) {
      this.input.xr.multiPointers[hand].toggleSubPointer('ray', false);
      this.input.xr.multiPointers[hand].toggleSubPointer('touch', false);
    }
    this.createLights();

    const onSessionStart = () => {
      this.renderer.xr.setFoveation(this.visual.foveation);
      const session = this.renderer.xr.getSession();
      const rates = session?.supportedFrameRates;
      if (session && rates && Array.from(rates).includes(120)) {
        void session.updateTargetFrameRate(120).then(() => this.redrawUi());
      }
    };
    this.renderer.xr.addEventListener('sessionstart', onSessionStart);

    const keys: Record<string, string> = { r: 'recenter', c: 'clear', s: 'showcase' };
    const onKey = (ev: KeyboardEvent) => {
      if (this.ready && keys[ev.key]) this.onButton(keys[ev.key]);
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(
      () => window.removeEventListener('keydown', onKey),
      () => this.renderer.xr.removeEventListener('sessionstart', onSessionStart),
      this.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible && !this.builtForXR) {
          this.builtForXR = true;
          this.recenterDelay = 0.4;
        }
      }),
    );

    void Library.load(import.meta.env.BASE_URL).then((lib) => {
      this.lib = lib;
      this.colors = lib.linearColors();
      this.color = lib.colorIndex.get(4) ?? 0;
      const v = this.readStore('stacker.visual') as { visual?: Record<string, number>; tone?: number; physical?: boolean; instructions?: Instructions } | null;
      if (v) {
        Object.assign(this.visual, v.visual ?? {});
        this.tone = v.tone ?? 0;
        this.physical = !!v.physical;
        this.instructions = v.instructions ?? 'ghosts';
      }
      this.makeMaterials();
      this.buildConnTables();
      this.hands = HANDS.map((hand) => this.createHand(hand));
      this.buildPlatform();
      this.library = this.createPanel('library', 0.32, 0.46, true);
      this.settings = this.createPanel('settings', 0.46, 0.4, false);
      this.layoutLibrary();
      this.layoutSettings();
      this.placeDefault(new Vector3(0, 0.8, -0.5), 0);
      const saved = this.readStore('stacker.autosave');
      if (saved) this.deserialize(saved);
      this.applyVisuals();
      this.ready = true;
    });
  }

  update(delta: number): void {
    if (!this.ready) return;
    this.time += delta;
    this.ghostLineMat.opacity = 0.55 + 0.4 * Math.sin(this.time * 5);
    this.tickStats(delta);
    if (this.recenterDelay >= 0) {
      this.recenterDelay -= delta;
      if (this.recenterDelay < 0) this.recenter();
    }
    for (const h of this.hands) this.updateHand(h, delta);
    this.tickSnaps(delta);
    this.tickPoofs(delta);
    this.tickLevel(delta);
    this.spinPreviews(delta);
    if (this.mini) this.mini.rotation.y += delta * 0.35;
    this.updateSelectionOutlines();
    this.saveTimer += delta;
    if (this.saveTimer > 1) {
      if (this.dirty) this.writeStore('stacker.autosave', this.serialize());
      if (this.visualDirty) {
        this.writeStore('stacker.visual', { visual: this.visual, tone: this.tone, physical: this.physical, instructions: this.instructions });
      }
      this.dirty = this.visualDirty = false;
      this.saveTimer = 0;
    }
  }

  // ================================================================ build

  private track(e: Entity): Entity {
    this.built.push(e);
    return e;
  }

  private child(parent: Entity, obj: Object3D): Entity {
    return this.track(this.world.createTransformEntity(obj, { parent }));
  }

  private createLights(): void {
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.hemi = new HemisphereLight(0xffffff, 0x6b6358, 0.35);
    this.world.createTransformEntity(this.hemi, { persistent: true });
    this.keyLight = new DirectionalLight(0xfff1e0, 2.4);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.0015;
    const cam = this.keyLight.shadow.camera;
    cam.left = -0.6;
    cam.right = 0.6;
    cam.top = 0.6;
    cam.bottom = -0.6;
    cam.near = 0.1;
    cam.far = 4;
    cam.updateProjectionMatrix();
    this.world.createTransformEntity(this.keyLight, { persistent: true });
    this.world.createTransformEntity(this.keyLight.target, { persistent: true });
  }

  /** Key light orbits the plate center: azimuth and height come from the settings. */
  private aimKeyLight(): void {
    const r = this.root.object3D!;
    r.updateMatrixWorld(true);
    const center = this.plateCenter(this.v1);
    const az = (this.visual.keyAz * Math.PI) / 180;
    const el = (this.visual.keyEl * Math.PI) / 180;
    const dist = 1.4;
    this.keyLight.position
      .set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist)
      .applyQuaternion(r.quaternion)
      .add(center);
    this.keyLight.target.position.copy(center);
  }

  private makeMaterials(): void {
    this.mats = this.lib.materials(this.physical);
    this.opaqueMat = blockMaterial(this.physical, 0xffffff, false);
    this.transMat = blockMaterial(this.physical, 0xffffff, true);
  }

  /** Swap every block material between standard and physical (clearcoat) shading. */
  private switchMaterialModel(physical: boolean): void {
    this.physical = physical;
    const old = [...this.mats, this.opaqueMat, this.transMat];
    this.makeMaterials();
    for (const b of this.batches.values()) b.mesh.material = b.mesh.material === old[old.length - 1] ? this.transMat : this.opaqueMat;
    for (const l of this.loose) l.mesh.material = this.mats[l.color];
    for (const p of this.poofs) {
      const m = p.entity.object3D as Mesh;
      const k = old.indexOf(m.material as MeshStandardMaterial);
      if (k >= 0 && k < this.mats.length) m.material = this.mats[k];
    }
    this.layoutLibrary();
    if (this.manual && this.kit) this.showPage(this.kit.page);
    for (const m of old) m.dispose();
    this.applyVisuals();
  }

  /** Push every look & render setting into lights, materials and the renderer. */
  private applyVisuals(): void {
    const v = this.visual;
    this.renderer.toneMapping = TONES[this.tone][1];
    this.renderer.toneMappingExposure = v.exposure;
    this.keyLight.intensity = v.key;
    const warm = new Color(0xffd9ad);
    const cool = new Color(0xcfe0ff);
    this.keyLight.color.set(0xffffff).lerp(v.warmth >= 0 ? warm : cool, Math.abs(v.warmth));
    this.hemi.intensity = v.fill;
    const shadows = v.shadow > 0;
    this.keyLight.castShadow = shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.keyLight.shadow.intensity = v.shadow;
    this.keyLight.shadow.radius = v.shadowSoft;
    this.scene.environmentRotation.set(0, (v.envRot * Math.PI) / 180, 0);
    for (const m of [...this.mats, this.opaqueMat, this.transMat]) {
      m.roughness = m.transparent ? Math.min(v.rough, 0.15) : v.rough;
      m.metalness = v.metal;
      m.envMapIntensity = v.env;
      if (m.transparent) m.opacity = v.trans;
      if (m instanceof MeshPhysicalMaterial) {
        m.clearcoat = v.clearcoat;
        m.clearcoatRoughness = v.ccRough;
      }
    }
    if (this.plateMat) {
      this.plateMat.color.set(0x237841).multiplyScalar(v.plate);
      this.plateMat.roughness = v.plateRough;
      this.plateMat.envMapIntensity = v.env;
    }
    if (this.renderer.xr.isPresenting) this.renderer.xr.setFoveation(v.foveation);
    if (this.root) this.aimKeyLight();
  }

  private setSlider(id: string, value: number): void {
    const def = SLIDERS.find((d) => d.id === id)!;
    value = Math.round(Math.min(def.max, Math.max(def.min, value)) / def.step) * def.step;
    if (id === 'size') {
      this.setScale(value);
    } else {
      if (this.visual[id] === value) return;
      this.visual[id] = value;
      if ((id === 'clearcoat' || id === 'ccRough') && value > 0 && !this.physical) this.switchMaterialModel(true);
      this.applyVisuals();
      this.visualDirty = true;
    }
    const item = this.settings.items.find((u) => u.id === `slider:${id}`);
    if (item) this.drawUi(item);
  }

  private sliderValue(id: string): number {
    return id === 'size' ? this.scale : this.visual[id];
  }

  // ================================================================ platform

  private buildPlatform(): void {
    const rootObj = new Object3D();
    rootObj.name = 'Platform';
    this.root = this.track(this.world.createTransformEntity(rootObj));
    this.plateMat = new MeshStandardMaterial({ color: 0x237841, roughness: 0.5 });
    this.slab = new Mesh(new BoxGeometry(1, 1, 1), this.plateMat);
    this.slab.name = 'Baseplate';
    this.slab.receiveShadow = true;
    this.child(this.root, this.slab);
    this.plateStuds = new InstancedMesh(studGeometry(), this.plateMat, MAX_STUDS * MAX_STUDS);
    this.plateStuds.frustumCulled = false;
    this.plateStuds.receiveShadow = true;
    this.child(this.root, this.plateStuds);

    const handleMat = new MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.3 });
    const cornerMat = new MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.35 });
    const edgeGeo = new CapsuleGeometry(0.008, 0.09, 4, 10);
    for (let k = 0; k < 4; k++) {
      const edge = new Mesh(edgeGeo, handleMat);
      edge.name = 'EdgeHandle';
      this.child(this.root, edge);
      this.edges.push(edge);
    }
    const cornerGeo = new SphereGeometry(0.011, 16, 12);
    for (let k = 0; k < 4; k++) {
      const corner = new Mesh(cornerGeo, cornerMat);
      corner.name = 'CornerHandle';
      this.child(this.root, corner);
      this.corners.push(corner);
    }
    const half = START_STUDS / 2;
    this.bounds = { x0: -half, x1: half, z0: -half, z1: half };
    this.updatePlate();
  }

  private updatePlate(): void {
    const P = dims.pitch;
    const s = this.scale;
    const { x0, x1, z0, z1 } = this.bounds;
    const cx = ((x0 + x1) / 2) * P;
    const cz = ((z0 + z1) / 2) * P;
    this.slab.scale.set((x1 - x0) * P, PLATE_T / s, (z1 - z0) * P);
    this.slab.position.set(cx, -PLATE_T / s / 2, cz);
    let k = 0;
    for (let i = x0; i < x1; i++) {
      for (let j = z0; j < z1; j++) {
        this.m1.makeTranslation((i + 0.5) * P, 0, (j + 0.5) * P);
        this.plateStuds.setMatrixAt(k++, this.m1);
      }
    }
    this.plateStuds.count = k;
    this.plateStuds.instanceMatrix.needsUpdate = true;
    const out = HANDLE_OUT / s;
    const y = 0.004 / s;
    const alongX = this.q1.setFromAxisAngle(this.v1.set(0, 0, 1), Math.PI / 2);
    this.edges[0].position.set(cx, y, z1 * P + out);
    this.edges[0].quaternion.copy(alongX);
    this.edges[1].position.set(cx, y, z0 * P - out);
    this.edges[1].quaternion.copy(alongX);
    const alongZ = this.q1.setFromAxisAngle(this.v1.set(1, 0, 0), Math.PI / 2);
    this.edges[2].position.set(x1 * P + out, y, cz);
    this.edges[2].quaternion.copy(alongZ);
    this.edges[3].position.set(x0 * P - out, y, cz);
    this.edges[3].quaternion.copy(alongZ);
    const c = out * 0.7;
    this.corners[0].position.set(x0 * P - c, y, z0 * P - c);
    this.corners[1].position.set(x1 * P + c, y, z0 * P - c);
    this.corners[2].position.set(x0 * P - c, y, z1 * P + c);
    this.corners[3].position.set(x1 * P + c, y, z1 * P + c);
    for (const h of [...this.edges, ...this.corners]) h.scale.setScalar(1 / s);
    this.dirty = true;
  }

  private plateCenter(out: Vector3): Vector3 {
    const P = dims.pitch;
    const { x0, x1, z0, z1 } = this.bounds;
    return this.root.object3D!.localToWorld(out.set(((x0 + x1) / 2) * P, 0, ((z0 + z1) / 2) * P));
  }

  private setScale(s: number): void {
    const def = SLIDERS[0];
    s = Math.round(Math.min(def.max, Math.max(def.min, s)) * 20) / 20;
    if (s === this.scale) return;
    const r = this.root.object3D!;
    const center = this.plateCenter(new Vector3());
    const ratio = s / this.scale;
    r.position.sub(center).multiplyScalar(ratio).add(center);
    r.scale.setScalar(s);
    this.scale = s;
    r.updateMatrixWorld(true);
    for (const l of this.loose) l.mesh.scale.setScalar(s);
    this.updatePlate();
    this.aimKeyLight();
  }

  /** Platform in front, library to its left, settings further left, manual and shelf to the right. */
  private placeDefault(pos: Vector3, yaw: number): void {
    const r = this.root.object3D!;
    r.position.copy(pos);
    r.quaternion.setFromAxisAngle(this.up, yaw);
    r.scale.setScalar(this.scale);
    r.updateMatrixWorld(true);
    const P = dims.pitch * this.scale;
    const { x0, x1, z0, z1 } = this.bounds;
    const zc = ((z0 + z1) / 2) * P;
    const place = (obj: Object3D, x: number, y: number, z: number, yawOff: number, tilt: number) => {
      obj.position.set(x, y, z).applyQuaternion(r.quaternion).add(pos);
      obj.quaternion.copy(r.quaternion).multiply(this.q1.setFromEuler(this.euler.set(tilt, yawOff, 0, 'YXZ')));
      obj.updateMatrixWorld(true);
    };
    place(this.library.entity.object3D!, x0 * P - 0.21, 0.17, zc + 0.06, 0.55, -0.3);
    place(this.settings.entity.object3D!, x0 * P - 0.6, 0.2, zc + 0.24, 1.05, -0.25);
    if (this.manual) place(this.manual.entity.object3D!, x1 * P + 0.2, 0.24, zc - 0.08, -0.55, -0.3);
    if (this.shelf) this.placeShelf();
    this.aimKeyLight();
  }

  private recenter(): void {
    const head = this.player.head;
    head.getWorldPosition(this.v3);
    head.getWorldQuaternion(this.q1);
    const fwd = this.v2.set(0, 0, -1).applyQuaternion(this.q1);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const pos = this.v4.copy(this.v3).addScaledVector(fwd, 0.45);
    pos.y = Math.max(0.45, pos.y - 0.42);
    const P = dims.pitch * this.scale;
    const { x0, x1, z0, z1 } = this.bounds;
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.q2.setFromAxisAngle(this.up, yaw);
    pos.sub(this.v1.set(((x0 + x1) / 2) * P, 0, ((z0 + z1) / 2) * P).applyQuaternion(this.q2));
    this.placeDefault(pos.clone(), yaw);
  }

  // ================================================================ panels

  private createPanel(id: PanelId, w: number, h: number, resizable: boolean): Panel {
    const bg = new Mesh(
      new RoundedBoxGeometry(1, 1, 1, 2, 0.02).translate(0, 0, -0.5),
      // Unlit, so panels read the same whatever the lighting settings are.
      new MeshBasicMaterial({ color: 0x1b1f29 }),
    );
    bg.name = `Panel:${id}`;
    const holder = new Object3D();
    const entity = this.track(this.world.createTransformEntity(holder));
    this.child(entity, bg);
    const bar = new Mesh(
      new CapsuleGeometry(0.009, 0.12, 4, 10).rotateZ(Math.PI / 2),
      new MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.3 }),
    );
    bar.name = 'PanelHandle';
    this.child(entity, bar);
    let resize: Mesh | null = null;
    if (resizable) {
      resize = new Mesh(new SphereGeometry(0.011, 16, 12), new MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.35 }));
      resize.name = 'PanelResize';
      this.child(entity, resize);
    }
    const panel: Panel = { id, entity, bg, w, h, items: [], content: [], bar, resize };
    this.panels.push(panel);
    this.sizePanel(panel);
    return panel;
  }

  private sizePanel(p: Panel): void {
    p.bg.scale.set(p.w, p.h, 0.008);
    p.bar.position.set(0, -p.h / 2 - 0.022, 0.006);
    p.resize?.position.set(p.w / 2 + 0.008, -p.h / 2 - 0.008, 0.006);
  }

  private clearPanel(p: Panel): void {
    for (const item of p.items) item.tex?.dispose();
    for (const e of p.content) e.destroy();
    const gone = new Set(p.content);
    this.built = this.built.filter((e) => !gone.has(e));
    p.items = [];
    p.content = [];
  }

  private destroyPanel(p: Panel): void {
    this.clearPanel(p);
    p.entity.destroy();
    this.panels = this.panels.filter((x) => x !== p);
  }

  private addContent(p: Panel, obj: Object3D): Entity {
    const e = this.child(p.entity, obj);
    p.content.push(e);
    return e;
  }

  private addUi(p: Panel, id: string, kind: UiItem['kind'], value: number, x: number, y: number, w: number, h: number): UiItem {
    const canvas = document.createElement('canvas');
    canvas.width = kind === 'slider' || w > 0.2 ? 512 : 256;
    canvas.height = Math.max(8, Math.round((canvas.width * h) / w));
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }));
    mesh.position.set(x, y, 0.001);
    this.addContent(p, mesh);
    const item: UiItem = { id, kind, value, x, y, w, h, mesh, panel: p, canvas, tex, hover: false };
    p.items.push(item);
    this.drawUi(item);
    return item;
  }

  /** Library: tools, tabs, a grid that grows with the panel, paging/kit/save row, colors. */
  private layoutLibrary(): void {
    const p = this.library;
    this.clearPanel(p);
    const W = p.w;
    const H = p.h;
    const left = -W / 2 + MARGIN;
    const inner = W - 2 * MARGIN;
    let y = H / 2 - MARGIN;

    const toolW = (inner - 3 * GAP) / 4;
    ['tool:build', 'tool:select', 'tool:paint', 'deselect'].forEach((id, k) =>
      this.addUi(p, id, 'button', 0, left + toolW / 2 + k * (toolW + GAP), y - 0.012, toolW, 0.024),
    );
    y -= 0.024 + GAP;
    const tabW = 0.05;
    const perRow = Math.max(1, Math.floor((inner + GAP) / (tabW + GAP)));
    TAB_NAMES.forEach((_, k) => {
      const col = k % perRow;
      const row = Math.floor(k / perRow);
      this.addUi(p, `tab:${k}`, 'tab', k, left + tabW / 2 + col * (tabW + GAP), y - 0.0115 - row * (0.023 + GAP), tabW, 0.023);
    });
    y -= Math.ceil(TAB_NAMES.length / perRow) * (0.023 + GAP) + GAP;

    // Bottom up: credits, colors, paging row.
    let yb = -H / 2 + MARGIN;
    this.addUi(p, 'credits', 'label', 0, 0, yb + 0.006, inner, 0.012);
    yb += 0.012 + GAP;
    const sw = 0.0183;
    const swPer = Math.max(4, Math.floor((inner + 0.0015) / sw));
    const swRows = Math.ceil(this.lib.colors.length / swPer);
    const swatchGeo = new RoundedBoxGeometry(0.0165, 0.0165, 0.005, 2, 0.003);
    this.lib.colors.forEach((_, k) => {
      const row = swRows - 1 - Math.floor(k / swPer);
      const inRow = Math.min(swPer, this.lib.colors.length - Math.floor(k / swPer) * swPer);
      const x = ((k % swPer) - (inRow - 1) / 2) * sw;
      const yy = yb + 0.01 + row * 0.02;
      const mesh = new Mesh(swatchGeo, this.mats[k]);
      mesh.position.set(x, yy, 0.004);
      this.addContent(p, mesh);
      p.items.push({ id: `swatch:${k}`, kind: 'swatch', value: k, x, y: yy, w: 0.018, h: 0.019, mesh, panel: p, hover: false });
    });
    yb += swRows * 0.02 + GAP;
    const rowY = yb + 0.013;
    this.addUi(p, 'row:left', 'button', 0, left + 0.035, rowY, 0.07, 0.026);
    this.addUi(p, 'row:mid', 'button', 0, 0, rowY, Math.min(0.14, inner - 0.16), 0.026);
    this.addUi(p, 'row:right', 'button', 0, -left - 0.035, rowY, 0.07, 0.026);
    yb = rowY + 0.013 + GAP;

    const cols = Math.max(1, Math.floor((inner + GAP) / (CELL_W + GAP)));
    const rows = Math.max(1, Math.floor((y - yb + GAP) / (CELL_H + GAP)));
    this.cellsPerPage = cols * rows;
    const gridW = cols * CELL_W + (cols - 1) * GAP;
    for (let k = 0; k < cols * rows; k++) {
      const x = -gridW / 2 + CELL_W / 2 + (k % cols) * (CELL_W + GAP);
      const yy = y - CELL_H / 2 - Math.floor(k / cols) * (CELL_H + GAP);
      const item = this.addUi(p, `cell:${k}`, 'cell', k, x, yy, CELL_W, CELL_H);
      const preview = new Mesh(this.lib.geometries[0], this.mats[this.color]);
      preview.name = 'CatalogItem';
      preview.position.set(x, yy + 0.007, 0.022);
      this.addContent(p, preview);
      item.preview = preview;
    }
    this.page = Math.min(this.page, this.pageCount() - 1);
    this.showTab(this.tab, this.page);
    this.selectColor(this.color);
  }

  /** Settings: stats, app buttons, rendering toggles, and two columns of sliders. */
  private layoutSettings(): void {
    const p = this.settings;
    this.clearPanel(p);
    const W = p.w;
    const H = p.h;
    const left = -W / 2 + MARGIN;
    const inner = W - 2 * MARGIN;
    let y = H / 2 - MARGIN;
    const stats = this.addUi(p, 'stats', 'label', 0, 0, y - 0.0175, inner, 0.035);
    this.statsCanvas = stats.canvas!;
    this.statsTex = stats.tex!;
    y -= 0.035 + GAP;
    const rowItems = (ids: string[]) => {
      const w = (inner - (ids.length - 1) * GAP) / ids.length;
      ids.forEach((id, k) => this.addUi(p, id, 'button', 0, left + w / 2 + k * (w + GAP), y - 0.012, w, 0.024));
      y -= 0.024 + GAP;
    };
    rowItems(['hz', 'stress', 'recenter', 'clear', 'reset']);
    rowItems(['tone', 'model', 'instructions']);
    y -= GAP;
    const colW = (inner - GAP) / 2;
    const perCol = Math.ceil(SLIDERS.length / 2);
    SLIDERS.forEach((def, k) => {
      const col = Math.floor(k / perCol);
      const row = k % perCol;
      this.addUi(p, `slider:${def.id}`, 'slider', 0, left + colW / 2 + col * (colW + GAP), y - 0.013 - row * (0.026 + GAP), colW, 0.026);
    });
    this.drawStats();
  }

  private tabName(): string {
    return TAB_NAMES[this.tab];
  }

  private tabParts(): number[] {
    const name = this.tabName();
    const out: number[] = [];
    this.lib.parts.forEach((p, i) => {
      if (p.tab === name) out.push(i);
    });
    return out;
  }

  private pageCount(): number {
    const name = this.tabName();
    if (name === 'Kits' || name === 'Saves' || name === 'Minifigs') return 1;
    return Math.max(1, Math.ceil(this.tabParts().length / this.cellsPerPage));
  }

  private cellPart(cell: number): number {
    const name = this.tabName();
    if (name === 'Kits' || name === 'Saves') return -1;
    if (name === 'Minifigs') return cell < this.lib.minifigs.presets.length ? (this.lib.byId.get('973c01') ?? -1) : -1;
    return this.tabParts()[this.page * this.cellsPerPage + cell] ?? -1;
  }

  private cellActive(cell: number): boolean {
    const name = this.tabName();
    if (name === 'Kits') return cell < KITS.length;
    if (name === 'Saves') return cell < SLOTS;
    return this.cellPart(cell) >= 0;
  }

  private cells(): UiItem[] {
    return this.library.items.filter((u) => u.kind === 'cell');
  }

  private showTab(tab: number, page = 0): void {
    this.tab = tab;
    this.page = page;
    const figs = this.tabName() === 'Minifigs';
    for (const item of this.cells()) {
      const mesh = item.preview!;
      const part = this.cellPart(item.value);
      mesh.visible = part >= 0;
      if (part < 0) continue;
      const def = this.lib.parts[part];
      mesh.geometry = this.lib.geometries[part];
      const extent = Math.max(def.w * dims.pitch, def.d * dims.pitch, def.h * dims.unit);
      mesh.scale.setScalar(Math.min(4, PREVIEW_FIT / extent));
      mesh.material = figs ? this.mats[this.colorOf(this.lib.minifigs.presets[item.value].torso)] : this.mats[this.color];
    }
    for (const item of this.library.items) if (item.kind !== 'swatch') this.drawUi(item);
  }

  private colorOf(code: number): number {
    return this.lib.colorIndex.get(code) ?? 0;
  }

  private selectColor(k: number): void {
    this.color = k;
    if (this.tabName() !== 'Minifigs') for (const c of this.cells()) c.preview!.material = this.mats[k];
    for (const item of this.library.items) {
      if (item.kind !== 'swatch') continue;
      const on = item.value === k;
      item.mesh.scale.setScalar(on ? 1.3 : item.hover ? 1.15 : 1);
      item.mesh.position.z = on ? 0.009 : 0.004;
    }
  }

  private spinPreviews(delta: number): void {
    for (const c of this.cells()) {
      const p = c.preview!;
      p.userData.spin = (p.userData.spin ?? 0) + delta * 0.5;
      p.quaternion.setFromEuler(this.euler.set(0.55, p.userData.spin, 0, 'XYZ'));
    }
  }

  private shortName(name: string): string {
    return name.replace(/^(Brick|Plate|Tile) /, '').replace(/ x /g, '×').replace(/ \[.*?\]|\(.*?\)/g, '').slice(0, 24);
  }

  private slotInfo(n: number): string {
    const data = this.readStore(`stacker.slot.${n}`) as { blocks?: unknown[] } | null;
    return data?.blocks ? `Slot ${n + 1} · ${data.blocks.length} pcs` : `Slot ${n + 1} · empty`;
  }

  private uiLabel(item: UiItem): string {
    switch (item.id) {
      case 'hz': {
        const rate = this.renderer.xr.getSession()?.frameRate;
        return rate ? `${Math.round(rate)} Hz` : 'Hz';
      }
      case 'stress':
        return 'Stress';
      case 'recenter':
        return 'Recenter';
      case 'clear':
        return 'Clear';
      case 'reset':
        return 'Reset look';
      case 'tone':
        return `Tone: ${TONES[this.tone][0]}`;
      case 'model':
        return this.physical ? 'Physical (coat)' : 'Standard';
      case 'instructions':
        return `Guide: ${{ ghosts: 'Ghosts', manual: 'Manual', both: 'Both' }[this.instructions]}`;
      case 'tool:build':
        return 'Build';
      case 'tool:select':
        return 'Select';
      case 'tool:paint':
        return 'Paint';
      case 'deselect':
        return this.selection.size ? `Deselect ${this.selection.size}` : 'Deselect';
      case 'credits':
        return 'Parts: LDraw.org (CC BY 4.0) · Catalog: Rebrickable · Kits: LDraw OMR';
      case 'man:prev':
        return '◀';
      case 'man:next':
        return '▶';
      case 'man:title':
        return this.kit ? `${this.kit.title} · step ${this.kit.page + 1} of ${this.kit.steps.length}` : '';
      case 'man:here':
        return this.kit && this.kit.page !== this.kit.step ? `Now: step ${this.kit.step + 1}` : 'Current step';
    }
    if (item.kind === 'slider') {
      const def = SLIDERS.find((d) => `slider:${d.id}` === item.id)!;
      const v = this.sliderValue(def.id);
      return `${def.label} ${def.fmt ? def.fmt(v) : v.toFixed(2)}`;
    }
    const name = this.tabName();
    if (item.id.startsWith('row:')) {
      const side = item.id.slice(4);
      if (name === 'Saves') return side === 'left' ? 'Save' : side === 'right' ? 'Load' : `Slot ${this.slot + 1}`;
      if (name === 'Kits') {
        if (!this.kit) return side === 'mid' ? 'Pick a kit' : '';
        if (side === 'left') return 'Exit kit';
        if (side === 'right') return 'Skip ▶';
        return '↺ Restart step';
      }
      if (name === 'Minifigs') return side === 'mid' ? 'Grab a figure' : '';
      if (side === 'left') return this.page > 0 ? '◀' : '';
      if (side === 'right') return this.page < this.pageCount() - 1 ? '▶' : '';
      return `${name} ${this.page + 1}/${this.pageCount()}`;
    }
    if (item.kind === 'tab') return TAB_NAMES[item.value];
    if (item.kind === 'cell') {
      if (name === 'Kits') return KITS[item.value] ? `${KITS[item.value].title} · ${KITS[item.value].pieces} pcs` : '';
      if (name === 'Saves') return item.value < SLOTS ? this.slotInfo(item.value) : '';
      if (name === 'Minifigs') return this.lib.minifigs.presets[item.value]?.name ?? '';
      const part = this.cellPart(item.value);
      return part >= 0 ? this.shortName(this.lib.parts[part].name) : '';
    }
    return item.id;
  }

  private uiSelected(item: UiItem): boolean {
    if (item.kind === 'tab') return item.value === this.tab;
    if (item.id === `tool:${this.tool}`) return true;
    if (item.kind === 'cell' && this.tabName() === 'Saves') return item.value === this.slot;
    if (item.kind === 'cell' && this.tabName() === 'Kits') return this.kit?.id === KITS[item.value]?.id;
    return false;
  }

  private drawUi(item: UiItem): void {
    if (!item.canvas || !item.tex) return;
    if (item.id === 'stats') return; // drawn by drawStats
    const { width, height } = item.canvas;
    const ctx = item.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    const label = this.uiLabel(item);
    const selected = this.uiSelected(item);
    if (item.kind === 'slider') {
      const def = SLIDERS.find((d) => `slider:${d.id}` === item.id)!;
      ctx.fillStyle = item.hover ? '#34405a' : '#252b39';
      ctx.beginPath();
      ctx.roundRect(3, 3, width - 6, height - 6, height * 0.3);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${Math.round(height * 0.36)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 14, height / 2 + 2, width * 0.5);
      const [t0, t1] = this.sliderTrack();
      const tx0 = t0 * width;
      const tx1 = t1 * width;
      ctx.fillStyle = '#10131c';
      ctx.fillRect(tx0, height / 2 - 4, tx1 - tx0, 8);
      const f = (this.sliderValue(def.id) - def.min) / (def.max - def.min);
      ctx.fillStyle = '#5b8def';
      ctx.fillRect(tx0, height / 2 - 4, (tx1 - tx0) * f, 8);
      ctx.beginPath();
      ctx.arc(tx0 + (tx1 - tx0) * f, height / 2, height * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else if (item.kind === 'cell') {
      if (!this.cellActive(item.value)) {
        item.tex.needsUpdate = true;
        return;
      }
      const textOnly = this.tabName() === 'Kits' || this.tabName() === 'Saves';
      ctx.fillStyle = selected ? '#2f4a86' : item.hover ? '#34405a' : '#252b39';
      ctx.beginPath();
      ctx.roundRect(4, 4, width - 8, height - 8, 18);
      ctx.fill();
      ctx.fillStyle = textOnly ? '#ffffff' : '#aab4c8';
      ctx.font = `600 ${Math.round(height * (textOnly ? 0.16 : 0.12))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = textOnly ? 'middle' : 'bottom';
      ctx.fillText(label, width / 2, textOnly ? height / 2 : height - 12, width - 16);
    } else {
      if (!label) {
        item.tex.needsUpdate = true;
        return;
      }
      const passive = item.kind === 'label';
      if (!passive) {
        ctx.fillStyle = selected ? '#5b8def' : item.hover ? '#34405a' : '#252b39';
        ctx.beginPath();
        ctx.roundRect(3, 3, width - 6, height - 6, height * 0.3);
        ctx.fill();
      }
      ctx.fillStyle = passive && item.id === 'credits' ? '#7c8699' : '#ffffff';
      ctx.font = `600 ${Math.round(height * (item.id === 'credits' ? 0.6 : 0.42))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, width / 2, height / 2 + 2, width - 12);
    }
    item.tex.needsUpdate = true;
  }

  private sliderTrack(): [number, number] {
    return [0.56, 0.95];
  }

  private redrawUi(filter?: (u: UiItem) => boolean): void {
    for (const p of this.panels) for (const item of p.items) if (item.kind !== 'swatch' && (!filter || filter(item))) this.drawUi(item);
  }

  private setUiHover(item: UiItem, hover: boolean): void {
    if (item.hover === hover) return;
    item.hover = hover;
    if (item.kind === 'swatch') this.selectColor(this.color);
    else this.drawUi(item);
  }

  private pressUi(item: UiItem): void {
    if (item.kind === 'label') return;
    this.tick(0.25);
    if (item.kind === 'tab') this.showTab(item.value);
    else if (item.kind === 'swatch') {
      this.selectColor(item.value);
      if (this.selection.size) this.recolor([...this.selection], item.value);
    } else if (item.kind === 'cell') this.pressCell(item.value);
    else this.onButton(item.id);
  }

  private slideTo(item: UiItem, lx: number): void {
    const def = SLIDERS.find((d) => `slider:${d.id}` === item.id)!;
    const [t0, t1] = this.sliderTrack();
    const f = (lx - (item.x - item.w / 2)) / item.w;
    const t = Math.min(1, Math.max(0, (f - t0) / (t1 - t0)));
    this.setSlider(def.id, def.min + t * (def.max - def.min));
  }

  private pressCell(cell: number): void {
    const name = this.tabName();
    if (name === 'Kits' && KITS[cell]) void this.startKit(KITS[cell].id, KITS[cell].title);
    else if (name === 'Saves' && cell < SLOTS) {
      this.slot = cell;
      this.redrawUi();
    } else if (name === 'Minifigs') {
      this.figurePieces(cell, this.frontSpot(new Vector3()));
    } else {
      const part = this.cellPart(cell);
      if (part >= 0) this.spawnLoose(part, this.color, this.frontSpot(new Vector3()), this.root.object3D!.quaternion);
    }
  }

  private frontSpot(out: Vector3): Vector3 {
    const P = dims.pitch;
    const { x0, x1, z1 } = this.bounds;
    return this.root.object3D!.localToWorld(out.set(((x0 + x1) / 2) * P, 0.05 / this.scale, z1 * P + 0.05 / this.scale));
  }

  private onButton(id: string): void {
    const name = this.tabName();
    switch (id) {
      case 'hz': {
        const session = this.renderer.xr.getSession();
        const rates = session?.supportedFrameRates;
        if (session && rates && rates.length > 0) {
          const current = session.frameRate ?? rates[0];
          const idx = Array.from(rates).findIndex((r) => Math.abs(r - current) < 1);
          void session.updateTargetFrameRate(rates[(idx + 1) % rates.length]).then(() => this.redrawUi());
        }
        break;
      }
      case 'stress':
        this.stress();
        break;
      case 'recenter':
        this.recenter();
        break;
      case 'clear':
        this.exitKit();
        this.clearPlaced();
        break;
      case 'reset':
        this.visual = { ...DEFAULTS };
        this.tone = 0;
        if (this.physical) this.switchMaterialModel(false);
        this.applyVisuals();
        this.visualDirty = true;
        break;
      case 'tone':
        this.tone = (this.tone + 1) % TONES.length;
        this.applyVisuals();
        this.visualDirty = true;
        break;
      case 'model':
        this.switchMaterialModel(!this.physical);
        this.visualDirty = true;
        break;
      case 'instructions':
        this.instructions = INSTRUCTIONS[(INSTRUCTIONS.indexOf(this.instructions) + 1) % INSTRUCTIONS.length];
        this.applyInstructions();
        this.visualDirty = true;
        break;
      case 'showcase':
        this.showcase();
        break;
      case 'tool:build':
      case 'tool:select':
      case 'tool:paint':
        this.tool = id.slice(5) as Tool;
        break;
      case 'deselect':
        this.selection.clear();
        break;
      case 'row:left':
        if (name === 'Saves') this.saveSlot();
        else if (name === 'Kits') this.exitKit();
        else if (this.page > 0) this.showTab(this.tab, this.page - 1);
        break;
      case 'row:mid':
        if (name === 'Kits') this.restartStep();
        break;
      case 'row:right':
        if (name === 'Saves') this.loadSlot();
        else if (name === 'Kits') this.skipStep();
        else if (this.page < this.pageCount() - 1) this.showTab(this.tab, this.page + 1);
        break;
      case 'man:prev':
        if (this.kit && this.kit.page > 0) this.showPage(this.kit.page - 1);
        break;
      case 'man:next':
        if (this.kit && this.kit.page < this.kit.steps.length - 1) this.showPage(this.kit.page + 1);
        break;
      case 'man:here':
        if (this.kit) this.showPage(this.kit.step);
        break;
    }
    this.redrawUi();
  }

  // ================================================================ placed blocks



  /** Per-part connectors and collision boxes, in unscaled meters. */
  private buildConnTables(): void {
    const L = dims.ldu;
    this.pconn = this.lib.parts.map((def, i) => {
      const male: Array<{ p: Vector3; a: Vector3 }> = [];
      const female: Array<{ p: Vector3; a: Vector3 }> = [];
      for (const [t, x, y, z, ax, ay, az] of def.conn ?? []) {
        (t === 0 ? male : female).push({ p: new Vector3(x * L, y * L, z * L), a: new Vector3(ax, ay, az).normalize() });
      }
      const joint = def.joint ? { pair: def.joint.pair, role: def.joint.role, o: new Vector3(...def.joint.o).multiplyScalar(L) } : null;
      const bb = this.lib.geometries[i].boundingBox!;
      const min = bb.min.clone();
      const max = bb.max.clone();
      if (male.some((c) => c.a.y > 0.9)) max.y -= 4 * L; // studs poke into whatever sits on top
      min.addScalar(0.8 * L); // touching isn't overlapping
      max.addScalar(-0.8 * L);
      const h = max.clone().sub(min).multiplyScalar(0.5).max(new Vector3(1e-4, 1e-4, 1e-4));
      return { male, female, joint, body: { c: min.add(max).multiplyScalar(0.5), h } };
    });
  }

  private hashKey(x: number, y: number, z: number): number {
    return ((Math.floor(x / CELL) + 512) * 1024 + (Math.floor(y / CELL) + 512)) * 1024 + (Math.floor(z / CELL) + 512);
  }

  /** Add or remove a placed block's studs and sockets in the spatial index. */
  private indexConns(rec: Placed, add: boolean): void {
    if (!add) {
      for (const [key, c] of this.recConns.get(rec) ?? []) {
        const list = this.connIndex.get(key);
        const k = list ? list.indexOf(c) : -1;
        if (k >= 0) list!.splice(k, 1);
        if (list && !list.length) this.connIndex.delete(key);
      }
      this.recConns.delete(rec);
      return;
    }
    const pc = this.pconn[rec.part];
    const rot = new Quaternion().setFromRotationMatrix(rec.m);
    const entries: Array<[number, Conn]> = [];
    for (const [type, list] of [
      [0, pc.male],
      [1, pc.female],
    ] as const) {
      for (const c of list) {
        const conn: Conn = { rec, type, p: c.p.clone().applyMatrix4(rec.m), a: c.a.clone().applyQuaternion(rot) };
        const key = this.hashKey(conn.p.x, conn.p.y, conn.p.z);
        let cell = this.connIndex.get(key);
        if (!cell) this.connIndex.set(key, (cell = []));
        cell.push(conn);
        entries.push([key, conn]);
      }
    }
    this.recConns.set(rec, entries);
  }

  /** Connectors of a type within r of p (platform-local), including baseplate studs. */
  private connsNear(p: Vector3, type: number, r: number, out: Conn[]): Conn[] {
    out.length = 0;
    const r2 = r * r;
    for (let x = Math.floor((p.x - r) / CELL); x <= Math.floor((p.x + r) / CELL); x++) {
      for (let y = Math.floor((p.y - r) / CELL); y <= Math.floor((p.y + r) / CELL); y++) {
        for (let z = Math.floor((p.z - r) / CELL); z <= Math.floor((p.z + r) / CELL); z++) {
          const cell = this.connIndex.get(((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512));
          if (cell) for (const c of cell) if (c.type === type && c.p.distanceToSquared(p) <= r2) out.push(c);
        }
      }
    }
    if (type === 0 && Math.abs(p.y) < r) {
      const P = dims.pitch;
      const { x0, x1, z0, z1 } = this.bounds;
      const i = Math.floor(p.x / P);
      const j = Math.floor(p.z / P);
      if (i >= x0 && i < x1 && j >= z0 && j < z1) {
        const stud = new Vector3((i + 0.5) * P, 0, (j + 0.5) * P);
        if (stud.distanceToSquared(p) <= r2) out.push({ rec: null, type: 0, p: stud, a: this.up });
      }
    }
    return out;
  }

  /** Separating-axis test between two oriented boxes. */
  private obbOverlap(ca: Vector3, A: Vector3[], ha: Vector3, cb: Vector3, B: Vector3[], hb: Vector3): boolean {
    const t = this.v6.copy(cb).sub(ca);
    const aH = [ha.x, ha.y, ha.z];
    const bH = [hb.x, hb.y, hb.z];
    const R: number[][] = [[], [], []];
    const AR: number[][] = [[], [], []];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        R[i][j] = A[i].dot(B[j]);
        AR[i][j] = Math.abs(R[i][j]) + 1e-6;
      }
    }
    const T = [t.dot(A[0]), t.dot(A[1]), t.dot(A[2])];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(T[i]) > aH[i] + bH[0] * AR[i][0] + bH[1] * AR[i][1] + bH[2] * AR[i][2]) return false;
    }
    for (let j = 0; j < 3; j++) {
      const tj = T[0] * R[0][j] + T[1] * R[1][j] + T[2] * R[2][j];
      if (Math.abs(tj) > bH[j] + aH[0] * AR[0][j] + aH[1] * AR[1][j] + aH[2] * AR[2][j]) return false;
    }
    for (let i = 0; i < 3; i++) {
      const i1 = (i + 1) % 3;
      const i2 = (i + 2) % 3;
      for (let j = 0; j < 3; j++) {
        const j1 = (j + 1) % 3;
        const j2 = (j + 2) % 3;
        const ra = aH[i1] * AR[i2][j] + aH[i2] * AR[i1][j];
        const rb = bH[j1] * AR[i][j2] + bH[j2] * AR[i][j1];
        if (Math.abs(T[i2] * R[i1][j] - T[i1] * R[i2][j]) > ra + rb) return false;
      }
    }
    return true;
  }

  private axesOf(m: Matrix4, out: Vector3[]): Vector3[] {
    out[0].setFromMatrixColumn(m, 0).normalize();
    out[1].setFromMatrixColumn(m, 1).normalize();
    out[2].setFromMatrixColumn(m, 2).normalize();
    return out;
  }

  /** Would this part at this pose overlap a placed block or sink into the plate? */
  private bodyCollides(part: number, m: Matrix4, candidates: Placed[]): boolean {
    if (this.lib.parts[part].overlap) return false;
    const body = this.pconn[part].body;
    const ca = this.v4.copy(body.c).applyMatrix4(m);
    const A = this.axesOf(m, this.axA);
    const P = dims.pitch;
    const { x0, x1, z0, z1 } = this.bounds;
    const down = Math.abs(A[0].y) * body.h.x + Math.abs(A[1].y) * body.h.y + Math.abs(A[2].y) * body.h.z;
    if (ca.y - down < -0.0004 && ca.x > x0 * P && ca.x < x1 * P && ca.z > z0 * P && ca.z < z1 * P) return true;
    const ra = body.h.length();
    const cb = this.v5;
    for (const rec of candidates) {
      if (this.lib.parts[rec.part].overlap) continue;
      const b = this.pconn[rec.part].body;
      cb.copy(b.c).applyMatrix4(rec.m);
      if (cb.distanceTo(ca) > ra + b.h.length()) continue;
      if (this.obbOverlap(ca, A, body.h, cb, this.axesOf(rec.m, this.axB), b.h)) return true;
    }
    return false;
  }

  /** Platform-local (unscaled) center of a placement. */
  private placedCenter(rec: Placement, out: Vector3): Vector3 {
    return out.setFromMatrixPosition(rec.m);
  }

  private localMatrix(rec: Placement, out: Matrix4): Matrix4 {
    return out.copy(rec.m);
  }

  private batchFor(rec: Placed): Batch {
    const key = `${rec.part}|${this.lib.isTrans(rec.color) ? 't' : 'o'}`;
    rec.batch = key;
    let b = this.batches.get(key);
    if (!b) {
      b = this.createBatch(rec.part, key.endsWith('t'), 16);
      this.batches.set(key, b);
    }
    if (b.records.length >= b.mesh.instanceMatrix.count) {
      b = this.createBatch(rec.part, key.endsWith('t'), b.mesh.instanceMatrix.count * 2, b);
      this.batches.set(key, b);
    }
    return b;
  }

  private createBatch(part: number, trans: boolean, capacity: number, from?: Batch): Batch {
    const mesh = new InstancedMesh(this.lib.geometries[part], trans ? this.transMat : this.opaqueMat, capacity);
    mesh.name = 'PlacedBlocks';
    mesh.frustumCulled = false;
    mesh.castShadow = !trans;
    mesh.receiveShadow = true;
    mesh.setColorAt(0, this.colors[0]);
    mesh.count = 0;
    if (from) {
      mesh.instanceMatrix.array.set(from.mesh.instanceMatrix.array);
      mesh.instanceColor!.array.set(from.mesh.instanceColor!.array);
      mesh.count = from.records.length;
      from.entity.destroy();
    }
    const entity = this.child(this.root, mesh);
    return { entity, mesh, records: from?.records ?? [] };
  }

  private writeInstance(batch: Batch, rec: Placed): void {
    batch.mesh.setMatrixAt(rec.slot, this.localMatrix(rec, this.m1));
    batch.mesh.setColorAt(rec.slot, this.colors[rec.color]);
    batch.mesh.instanceMatrix.needsUpdate = true;
    batch.mesh.instanceColor!.needsUpdate = true;
  }

  private addPlaced(rec: Placed): void {
    const batch = this.batchFor(rec);
    rec.slot = batch.records.length;
    batch.records.push(rec);
    batch.mesh.count = batch.records.length;
    rec.mi = rec.m.clone().invert();
    this.writeInstance(batch, rec);
    this.indexConns(rec, true);
    this.placedRecs.push(rec);
    this.dirty = true;
  }

  private removePlaced(rec: Placed): void {
    const batch = this.batches.get(rec.batch);
    if (!batch) return;
    const last = batch.records.pop()!;
    if (last !== rec) {
      last.slot = rec.slot;
      batch.records[rec.slot] = last;
      this.writeInstance(batch, last);
    }
    batch.mesh.count = batch.records.length;
    this.indexConns(rec, false);
    const k = this.placedRecs.indexOf(rec);
    if (k >= 0) this.placedRecs.splice(k, 1);
    this.selection.delete(rec);
    this.dirty = true;
    const target = this.kit?.matched.get(rec);
    if (target) {
      this.kit!.matched.delete(rec);
      this.addGhost(target);
    }
  }

  private clearPlaced(): void {
    for (const b of this.batches.values()) {
      b.records.length = 0;
      b.mesh.count = 0;
    }
    this.connIndex.clear();
    this.recConns.clear();
    this.placedRecs = [];
    this.selection.clear();
    this.dirty = true;
  }

  private recolor(recs: Placed[], color: number): void {
    for (const rec of recs) {
      const selected = this.selection.has(rec);
      this.removePlaced(rec);
      rec.color = color;
      this.addPlaced(rec);
      if (selected) this.selection.add(rec);
    }
  }

  /** Stud-grid extent of everything placed, so the plate can't shrink out from under it. */
  private placedExtent(): { minI: number; maxI: number; minJ: number; maxJ: number } {
    const P = dims.pitch;
    const e = { minI: Infinity, maxI: -Infinity, minJ: Infinity, maxJ: -Infinity };
    for (const r of this.placedRecs) {
      const c = this.v3.setFromMatrixPosition(r.m);
      const h = this.pconn[r.part].body.h;
      const rad = Math.hypot(h.x, h.z);
      e.minI = Math.min(e.minI, Math.floor((c.x - rad) / P));
      e.maxI = Math.max(e.maxI, Math.ceil((c.x + rad) / P));
      e.minJ = Math.min(e.minJ, Math.floor((c.z - rad) / P));
      e.maxJ = Math.max(e.maxJ, Math.ceil((c.z + rad) / P));
    }
    return e;
  }

  private makeRec(part: number, color: number, m: Matrix4, target?: Placed): Placed {
    return { part, color, m, target, slot: -1, batch: '' };
  }

  /** Transform for a block on the stud grid: cell (i, j), height in half plates, quarter turns. */
  private gridMatrix(part: number, i: number, j: number, level: number, turns: number): Matrix4 {
    const P = dims.pitch;
    const [fw, fd] = this.footprint(part, turns);
    const center = new Vector3((i + fw / 2) * P, (level + this.lib.parts[part].h / 2) * dims.unit, (j + fd / 2) * P);
    return new Matrix4().compose(center, new Quaternion().setFromAxisAngle(this.up, (turns * Math.PI) / 2), this.one);
  }

  private footprint(part: number, turns: number): [number, number] {
    const def = this.lib.parts[part];
    return turns % 2 === 0 ? [def.w, def.d] : [def.d, def.w];
  }

  // ================================================================ loose blocks

  private spawnLoose(part: number, color: number, pos: Vector3, quat: Quaternion): Loose {
    const mesh = new Mesh(this.lib.geometries[part], this.mats[color]);
    mesh.name = 'Block';
    mesh.castShadow = !this.lib.isTrans(color);
    mesh.receiveShadow = true;
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    mesh.scale.setScalar(this.scale);
    const entity = this.world.createTransformEntity(mesh);
    const l = { entity, mesh, part, color };
    this.loose.push(l);
    return l;
  }

  private dropLoose(l: Loose, poof: boolean): void {
    const k = this.loose.indexOf(l);
    if (k >= 0) this.loose.splice(k, 1);
    this.shelfItems = this.shelfItems.filter((s) => s.block !== l);
    if (poof) this.poofs.push({ entity: l.entity, t: 0 });
    else l.entity.destroy();
  }

  private tickPoofs(delta: number): void {
    for (let k = this.poofs.length - 1; k >= 0; k--) {
      const p = this.poofs[k];
      p.t += delta / 0.14;
      const obj = p.entity.object3D;
      if (p.t >= 1 || !obj) {
        p.entity.destroy();
        this.poofs.splice(k, 1);
      } else obj.scale.setScalar(this.scale * (1 - p.t));
    }
  }

  private placedWorldPose(rec: Placement, outPos: Vector3, outQuat: Quaternion): void {
    const r = this.root.object3D!;
    r.localToWorld(this.placedCenter(rec, outPos));
    this.q2.setFromRotationMatrix(this.m1.copy(rec.m));
    outQuat.copy(r.quaternion).multiply(this.q2);
  }

  private figurePieces(preset: number, base: Vector3): Piece[] {
    const fig = this.lib.minifigs.presets[preset];
    const asm = this.lib.minifigs.assembly;
    const u = dims.unit * this.scale;
    const spec: Array<[string, number, number]> = [
      [asm.legs[0]!, asm.legs[1], fig.legs],
      [asm.torso[0]!, asm.torso[1], fig.torso],
      [asm.head[0]!, asm.head[1], 14],
      [fig.hat[0], asm.hat[1], fig.hat[1]],
    ];
    const info = spec.map(([id, ay, code]) => {
      const part = this.lib.byId.get(id)!;
      const def = this.lib.parts[part];
      const top = def.center[1] - (def.h * 4) / 2;
      return { part, code, bottom: ay + top + def.h * 4, h: def.h };
    });
    const feet = info[0].bottom;
    const q = this.root.object3D!.quaternion;
    return info.map(({ part, code, bottom, h }) => {
      const dl = Math.round((feet - bottom) / 4);
      const y = (dl + h / 2 - info[0].h / 2) * u;
      const block = this.spawnLoose(part, this.colorOf(code), this.v1.set(0, y, 0).applyQuaternion(q).add(base), q);
      return { block, offPos: new Vector3(), offQuat: new Quaternion() };
    });
  }

  // ================================================================ snapping

  /**
   * Where would the carried pieces land? Kit pieces jump into a matching ghost.
   * Otherwise every stud and socket on the carried pieces looks for a facing socket or
   * stud nearby (on the plate, on top of, under, or beside placed blocks). Each pairing
   * proposes a pose — connectors aligned, spun to the nearest quarter turn — and the
   * pose that engages the most connectors without overlapping anything wins.
   * Fills this.snapOut (one transform per piece).
   */
  private computeSnap(pieces: Piece[]): boolean {
    const s = this.scale;
    const r = this.root.object3D!;
    r.updateMatrixWorld(true);
    const inv = this.m2.copy(r.matrixWorld).invert();
    const out = this.snapOut;
    out.length = 0;
    const cur = pieces.map((p) =>
      new Matrix4().compose(p.block.mesh.position, p.block.mesh.quaternion, new Vector3(s, s, s)).premultiply(inv),
    );
    const anchor = new Vector3().setFromMatrixPosition(cur[0]);

    if (this.kit && pieces.length === 1) {
      const target = this.nearestTarget(pieces[0].block, anchor);
      if (target && this.placedCenter(target, this.v3).distanceTo(anchor) < GHOST_PULL / s) {
        out.push({ m: target.m, target });
        return true;
      }
    }

    const reach = Math.min(CELL, Math.max(dims.pitch * 1.2, 0.02 / s));
    const cands: Array<{ D: Matrix4; score: number }> = [];
    const P = new Vector3();
    const Q = new Vector3();
    const A = new Vector3();
    const q = new Quaternion();
    pieces.forEach((piece, k) => {
      const pc = this.pconn[piece.block.part];
      q.setFromRotationMatrix(cur[k]);
      for (const [type, list] of [
        [0, pc.male],
        [1, pc.female],
      ] as const) {
        for (const c of list) {
          P.copy(c.p).applyMatrix4(cur[k]);
          A.copy(c.a).applyQuaternion(q);
          // Downward-facing sockets also look a few centimeters below, as if the block
          // had been let go and settled onto whatever studs are underneath.
          const drops = type === 1 && A.y < -0.7 ? DROP_STEPS : NO_DROP;
          for (const drop of drops) {
            Q.copy(P).y -= drop / s;
            for (const t of this.connsNear(Q, 1 - type, reach, this.near)) {
              const facing = A.dot(t.a);
              if (facing > FACING) continue;
              cands.push({ D: this.alignTransform(P, A, cur[k], t), score: P.distanceTo(t.p) / dims.pitch + (1 + facing) * 2 });
            }
          }
        }
      }
      // Paired parts (hinge halves, turntables, window glass) go exactly onto their partner.
      if (pc.joint?.role === 'top') {
        const here = new Vector3().setFromMatrixPosition(cur[k]);
        for (const rec of this.placedRecs) {
          const bj = this.pconn[rec.part].joint;
          if (!bj || bj.role !== 'base' || bj.pair !== pc.joint.pair) continue;
          const target = new Matrix4().makeTranslation(bj.o.x - pc.joint.o.x, bj.o.y - pc.joint.o.y, bj.o.z - pc.joint.o.z).premultiply(rec.m);
          const dist = this.v3.setFromMatrixPosition(target).distanceTo(here);
          if (dist > reach * 2) continue;
          cands.push({ D: target.multiply(cur[k].clone().invert()), score: dist / dims.pitch - 2 });
        }
      }
    });
    if (!cands.length) return false;

    cands.sort((a, b) => a.score - b.score);
    // Only blocks near the carried pieces can collide with them.
    const nearby = this.placedRecs.filter((rec) => this.v3.setFromMatrixPosition(rec.m).distanceTo(anchor) < 0.25);
    let best: Matrix4[] | null = null;
    let bestScore = -Infinity;
    const tried: Matrix4[] = [];
    for (const cand of cands) {
      if (tried.length >= 16) break;
      if (tried.some((d) => this.sameTransform(d, cand.D))) continue;
      tried.push(cand.D);
      const mats = cur.map((m) => m.clone().premultiply(cand.D));
      if (mats.some((m, k) => this.bodyCollides(pieces[k].block.part, m, nearby))) continue;
      const score = this.countEngaged(pieces, mats) * 2 - cand.score;
      if (score > bestScore) {
        bestScore = score;
        best = mats;
      }
    }
    if (!best) return false;
    for (const m of best) out.push({ m });
    return true;
  }

  /**
   * The rigid move that puts connector (P, A) of a carried piece onto target t: turn A to
   * face t, spin about t's axis to the nearest quarter turn of t's block, then translate.
   */
  private alignTransform(P: Vector3, A: Vector3, cur: Matrix4, t: Conn): Matrix4 {
    const axis = t.a;
    const q1 = new Quaternion().setFromUnitVectors(A, axis.clone().negate());
    const refT = this.refAxis(t.rec ? t.rec.m : null, axis, new Vector3());
    const refH = this.refAxis(cur, axis.clone().applyQuaternion(q1.clone().invert()), new Vector3()).applyQuaternion(q1);
    refH.addScaledVector(axis, -refH.dot(axis)).normalize();
    const angle = Math.atan2(new Vector3().crossVectors(refH, refT).dot(axis), refH.dot(refT));
    const snapped = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
    const R = new Quaternion().setFromAxisAngle(axis, angle - snapped).multiply(q1);
    return new Matrix4()
      .makeTranslation(t.p.x, t.p.y, t.p.z)
      .multiply(new Matrix4().makeRotationFromQuaternion(R))
      .multiply(new Matrix4().makeTranslation(-P.x, -P.y, -P.z));
  }

  /** A block axis (x, then z, then y) projected flat against `axis`, for quarter-turn snapping. */
  private refAxis(m: Matrix4 | null, axis: Vector3, out: Vector3): Vector3 {
    for (const k of [0, 2, 1]) {
      if (m) out.setFromMatrixColumn(m, k).normalize();
      else out.set(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
      out.addScaledVector(axis, -out.dot(axis));
      if (out.lengthSq() > 0.25) return out.normalize();
    }
    return out.set(1, 0, 0);
  }

  private sameTransform(a: Matrix4, b: Matrix4): boolean {
    for (let k = 0; k < 16; k++) if (Math.abs(a.elements[k] - b.elements[k]) > 2e-4) return false;
    return true;
  }

  /** How many carried connectors sit exactly on a facing connector at these poses. */
  private countEngaged(pieces: Piece[], mats: Matrix4[]): number {
    let n = 0;
    const P = new Vector3();
    const A = new Vector3();
    const q = new Quaternion();
    pieces.forEach((piece, k) => {
      const pc = this.pconn[piece.block.part];
      q.setFromRotationMatrix(mats[k]);
      for (const [type, list] of [
        [0, pc.male],
        [1, pc.female],
      ] as const) {
        for (const c of list) {
          P.copy(c.p).applyMatrix4(mats[k]);
          A.copy(c.a).applyQuaternion(q);
          if (this.connsNear(P, 1 - type, 0.0006, this.near).some((t) => A.dot(t.a) < -0.95)) n++;
        }
      }
    });
    return n;
  }

  /** The closest unfilled kit ghost for this piece (same part and color). */
  private nearestTarget(block: Loose, local: Vector3): Placed | null {
    let best: Placed | null = null;
    let bestD = Infinity;
    for (const { rec } of this.kit!.remaining) {
      if (rec.part !== block.part || rec.color !== block.color) continue;
      const d = this.placedCenter(rec, this.v3).distanceTo(local);
      if (d < bestD) {
        best = rec;
        bestD = d;
      }
    }
    return best;
  }

  private tickSnaps(delta: number): void {
    for (let k = this.snaps.length - 1; k >= 0; k--) {
      const s = this.snaps[k];
      s.t = Math.min(1, s.t + delta / SNAP_TIME);
      const e = 1 - (1 - s.t) * (1 - s.t);
      this.placedWorldPose(s.rec, this.v1, this.q1);
      s.block.mesh.position.lerpVectors(s.fromPos, this.v1, e);
      s.block.mesh.quaternion.slerpQuaternions(s.fromQuat, this.q1, e);
      if (s.t >= 1) {
        this.addPlaced(s.rec);
        this.dropLoose(s.block, false);
        this.snaps.splice(k, 1);
        this.kitCheck(s.rec);
      }
    }
  }

  // ================================================================ input

  private createHand(hand: Hand): HandState {
    const outline = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0xffffff, side: BackSide, transparent: true, opacity: 0.9 }));
    const ray = new Mesh(
      new CylinderGeometry(0.0012, 0.0012, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    const cursor = new Mesh(new SphereGeometry(0.004, 12, 8), new MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    cursor.renderOrder = 20;
    const guideGeo = new BufferGeometry();
    guideGeo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const guide = new Line(guideGeo, new LineBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.8, depthTest: false }));
    guide.frustumCulled = false;
    guide.renderOrder = 21;
    for (const m of [outline, ray, cursor, guide]) {
      this.world.createTransformEntity(m, { persistent: true });
      m.visible = false;
    }
    return {
      hand,
      mode: 'none',
      rayOrigin: new Vector3(),
      rayDir: new Vector3(0, 0, -1),
      point: new Vector3(),
      quat: new Quaternion(),
      indexTip: new Vector3(),
      hasTip: false,
      down: new Set(),
      up: new Set(),
      pinching: false,
      midPinching: false,
      pokeLatched: false,
      target: null,
      targetFar: false,
      pieces: null,
      holdButton: null,
      fromSelection: false,
      rotTarget: new Quaternion(),
      painting: false,
      slider: null,
      frame: null,
      resizing: null,
      resizeAnchor: new Vector3(),
      corner: -1,
      anchorDist: -1,
      offsetPos: new Vector3(),
      offsetQuat: new Quaternion(),
      outline,
      ghosts: [],
      ray,
      cursor,
      guide,
      lit: null,
    };
  }

  private jointPos(frame: XRFrame, ref: XRReferenceSpace, hand: XRHand, name: XRHandJoint, out: Vector3, outQuat?: Quaternion): boolean {
    const space = hand.get(name);
    const pose = space ? frame.getJointPose?.(space, ref) : undefined;
    if (!pose) return false;
    const t = pose.transform;
    out.set(t.position.x, t.position.y, t.position.z).applyMatrix4(this.player.matrixWorld);
    if (outQuat) {
      outQuat.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
      outQuat.premultiply(this.player.getWorldQuaternion(this.q2));
    }
    return true;
  }

  private readInput(h: HandState): void {
    h.down.clear();
    h.up.clear();
    h.hasTip = false;
    const session = this.renderer.xr.getSession();
    let source: XRInputSource | undefined;
    if (session) for (const s of session.inputSources) if (s.handedness === h.hand) source = s;
    const mode = !source ? 'none' : source.hand ? 'hand' : source.gamepad ? 'controller' : 'none';
    if (mode !== h.mode) {
      if (h.holdButton) h.up.add(h.holdButton);
      h.pinching = h.midPinching = false;
      h.mode = mode;
    }
    if (mode === 'none') return;

    const raySpace = this.player.raySpaces[h.hand];
    raySpace.getWorldPosition(h.rayOrigin);
    raySpace.getWorldQuaternion(this.q1);
    h.rayDir.set(0, 0, -1).applyQuaternion(this.q1);

    if (mode === 'controller') {
      h.quat.copy(this.q1);
      h.point.copy(h.rayOrigin).addScaledVector(h.rayDir, CTRL_TIP);
      const pad = this.input.xr.gamepads[h.hand];
      if (!pad) return;
      const right = h.hand === 'right';
      const map: Array<[Btn, string]> = [
        ['squeeze', InputComponent.Squeeze],
        ['trigger', InputComponent.Trigger],
        ['a', right ? InputComponent.A_Button : InputComponent.X_Button],
        ['b', right ? InputComponent.B_Button : InputComponent.Y_Button],
      ];
      for (const [btn, id] of map) {
        if (pad.getButtonDown(id)) h.down.add(btn);
        if (pad.getButtonUp(id)) h.up.add(btn);
      }
    } else if (source?.hand) {
      const frame = this.xrFrame;
      const ref = this.renderer.xr.getReferenceSpace();
      if (!frame || !ref) return;
      const thumb = this.v1;
      const index = this.v2;
      const middle = this.v3;
      if (
        !this.jointPos(frame, ref, source.hand, 'thumb-tip', thumb) ||
        !this.jointPos(frame, ref, source.hand, 'index-finger-tip', index) ||
        !this.jointPos(frame, ref, source.hand, 'middle-finger-tip', middle) ||
        !this.jointPos(frame, ref, source.hand, 'wrist', this.v4, h.quat)
      ) {
        return;
      }
      h.indexTip.copy(index);
      h.hasTip = true;
      h.point.copy(thumb).add(index).multiplyScalar(0.5);
      const gap = thumb.distanceTo(index);
      if (!h.pinching && gap < PINCH_ON) {
        h.pinching = true;
        h.down.add('pinch');
      } else if (h.pinching && gap > PINCH_OFF) {
        h.pinching = false;
        h.up.add('pinch');
      }
      const mgap = thumb.distanceTo(middle);
      if (!h.midPinching && !h.pinching && mgap < PINCH_ON) {
        h.midPinching = true;
        h.down.add('mid');
      } else if (h.midPinching && mgap > PINCH_OFF) {
        h.midPinching = false;
        h.up.add('mid');
      }
    }
  }

  private pressed(h: HandState, btns: Btn[]): Btn | null {
    for (const b of btns) if (h.down.has(b)) return b;
    return null;
  }

  private updateHand(h: HandState, delta: number): void {
    this.readInput(h);
    for (const g of h.ghosts) g.visible = false;
    h.guide.visible = false;
    if (h.lit) {
      h.lit.material = this.ghostLineMat;
      h.lit = null;
    }
    const released = h.holdButton !== null && (h.up.has(h.holdButton) || h.mode === 'none');

    if (h.pieces) {
      if (released) this.releasePieces(h);
      else if (h.down.has('b')) this.dropPieces(h);
      else this.holdPieces(h, delta);
    } else if (h.frame) {
      if (released) this.releaseFrame(h);
      else this.holdFrame(h, delta);
    } else if (h.slider) {
      if (released) {
        h.slider = null;
        h.holdButton = null;
      } else this.dragSlider(h);
    } else {
      this.findTarget(h);
      this.poke(h);
      if (h.painting) {
        if (released) {
          h.painting = false;
          h.holdButton = null;
        } else this.paintTarget(h.target);
      }
      const grab = this.pressed(h, GRAB_BTNS);
      const dup = this.pressed(h, DUP_BTNS);
      if (h.target && !h.painting) {
        if (grab) this.onGrab(h, grab);
        else if (dup) this.onDuplicate(h, dup);
        else if (h.down.has('b')) this.onDelete(h.target);
      }
    }
    this.drawPointer(h);
  }

  // ---- targeting

  private boxDist(p: Vector3, hx: number, hy: number, hz: number): number {
    const dx = Math.max(Math.abs(p.x) - hx, 0);
    const dy = Math.max(Math.abs(p.y) - hy, 0);
    const dz = Math.max(Math.abs(p.z) - hz, 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private rayBox(o: Vector3, d: Vector3, hx: number, hy: number, hz: number): number {
    let tmin = 0;
    let tmax = RAY_MAX * 10;
    const axes: Array<[number, number, number]> = [
      [o.x, d.x, hx],
      [o.y, d.y, hy],
      [o.z, d.z, hz],
    ];
    for (const [oo, dd, hh] of axes) {
      if (Math.abs(dd) < 1e-9) {
        if (Math.abs(oo) > hh) return Infinity;
        continue;
      }
      let t1 = (-hh - oo) / dd;
      let t2 = (hh - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmax < tmin) return Infinity;
    }
    return tmin;
  }

  private probeObject(h: HandState, obj: Object3D, hx: number, hy: number, hz: number, far: boolean): number {
    obj.getWorldPosition(this.v1);
    obj.getWorldQuaternion(this.q1);
    obj.getWorldScale(this.v3);
    this.q1.invert();
    hx *= this.v3.x;
    hy *= this.v3.y;
    hz *= this.v3.z;
    if (!far) return this.boxDist(this.v2.copy(h.point).sub(this.v1).applyQuaternion(this.q1), hx, hy, hz);
    const o = this.v2.copy(h.rayOrigin).sub(this.v1).applyQuaternion(this.q1);
    const d = this.v4.copy(h.rayDir).applyQuaternion(this.q1);
    return this.rayBox(o, d, hx, hy, hz);
  }

  private consider(best: Target | null, t: Target): Target | null {
    return !best || t.score < best.score ? t : best;
  }

  private halfExtents(part: number, out: Vector3): Vector3 {
    const bb = this.lib.geometries[part].boundingBox!;
    return out.set((bb.max.x - bb.min.x) / 2, (bb.max.y - bb.min.y) / 2, (bb.max.z - bb.min.z) / 2);
  }

  private collectTargets(h: HandState, far: boolean): Target | null {
    const limit = far ? RAY_MAX : h.mode === 'hand' ? HAND_REACH : CTRL_REACH;
    let best: Target | null = null;
    const P = dims.pitch;
    const u = dims.unit;
    const s = this.scale;

    this.edges.forEach((obj) => {
      const sc = this.probeObject(h, obj, 0.014, 0.06, 0.014, far);
      if (sc < limit) best = this.consider(best, { kind: 'edge', frame: 'platform', obj, score: sc });
    });
    this.corners.forEach((obj, corner) => {
      const sc = this.probeObject(h, obj, 0.016, 0.016, 0.016, far);
      if (sc < limit) best = this.consider(best, { kind: 'corner', obj, corner, score: sc });
    });
    if (this.shelfBar) {
      const sc = this.probeObject(h, this.shelfBar, 0.075, 0.014, 0.014, far);
      if (sc < limit) best = this.consider(best, { kind: 'bar', frame: 'shelf', obj: this.shelfBar, score: sc });
    }

    for (const p of this.panels) {
      const sc = this.probeObject(h, p.bar, 0.075, 0.014, 0.014, far);
      if (sc < limit) best = this.consider(best, { kind: 'bar', frame: p.id, obj: p.bar, score: sc });
      if (p.resize) {
        const rs = this.probeObject(h, p.resize, 0.016, 0.016, 0.016, far);
        if (rs < limit) best = this.consider(best, { kind: 'resize', frame: p.id, obj: p.resize, score: rs });
      }
      const obj = p.entity.object3D!;
      const lo = obj.worldToLocal(this.v1.copy(far ? h.rayOrigin : h.point));
      if (Math.abs(lo.x) > p.w / 2 + 0.05 || Math.abs(lo.y) > p.h / 2 + 0.05) {
        if (!far) continue;
      }
      let px = lo.x;
      let py = lo.y;
      let score = Infinity;
      if (far) {
        obj.getWorldQuaternion(this.q1).invert();
        const ld = this.v2.copy(h.rayDir).applyQuaternion(this.q1);
        if (ld.z < -1e-4 && lo.z > 0) {
          const t = -lo.z / ld.z;
          px = lo.x + ld.x * t;
          py = lo.y + ld.y * t;
          score = t;
        }
      } else if (lo.z > -0.005 && lo.z < 0.045) {
        score = Math.max(0, lo.z - 0.03);
      }
      if (score >= limit) continue;
      if (Math.abs(px) > p.w / 2 || Math.abs(py) > p.h / 2) continue;
      // The panel itself blocks rays to anything behind it.
      if (far) best = this.consider(best, { kind: 'ui', score: score + 1e-4 });
      for (const item of p.items) {
        if (item.kind === 'label') continue;
        if (Math.abs(px - item.x) > item.w / 2 || Math.abs(py - item.y) > item.h / 2) continue;
        if (item.kind === 'cell') {
          if (!this.cellActive(item.value)) continue;
          if (this.cellPart(item.value) >= 0) best = this.consider(best, { kind: 'cell', ui: item, obj: item.preview, score });
          else if (far) best = this.consider(best, { kind: 'ui', ui: item, score });
        } else if (far) best = this.consider(best, { kind: 'ui', ui: item, score });
      }
    }

    for (const l of this.loose) {
      if (this.isCarried(l)) continue;
      const e = this.halfExtents(l.part, this.v5);
      const sc = this.probeObject(h, l.mesh, e.x, e.y, e.z, far);
      if (sc < limit) best = this.consider(best, { kind: 'loose', loose: l, obj: l.mesh, score: sc });
    }

    const r = this.root.object3D!;
    this.q1.copy(r.quaternion).invert();
    const o = r.worldToLocal(this.v1.copy(far ? h.rayOrigin : h.point));
    const d = this.v2.copy(h.rayDir).applyQuaternion(this.q1);
    const c = this.v3;
    const lo2 = this.v4;
    const ext = this.v5;
    const dl = this.v6;
    for (const rec of this.placedRecs) {
      this.halfExtents(rec.part, ext);
      lo2.copy(o).applyMatrix4(rec.mi!);
      let sc: number;
      if (far) {
        dl.copy(d).transformDirection(rec.mi!);
        // transformDirection normalizes; rescale t back into platform units
        sc = this.rayBox(lo2, dl, ext.x, ext.y, ext.z);
      } else sc = this.boxDist(lo2, ext.x, ext.y, ext.z);
      sc *= s;
      if (sc < limit && (!best || sc < best.score)) best = { kind: 'placed', placed: rec, score: sc };
    }
    // A bare panel hit (no item) is only there to block rays; don't target it.
    return best && best.kind === 'ui' && !best.ui ? null : best;
  }

  private isCarried(l: Loose): boolean {
    return this.hands.some((h) => h.pieces?.some((p) => p.block === l)) || this.snaps.some((s) => s.block === l);
  }

  private findTarget(h: HandState): void {
    const prev = h.target?.ui;
    h.target = null;
    if (h.mode !== 'none') {
      h.target = this.collectTargets(h, false);
      h.targetFar = !h.target;
      if (!h.target) h.target = this.collectTargets(h, true);
    }
    const next = h.target?.ui;
    if (prev && prev !== next && !this.hands.some((o) => o !== h && o.target?.ui === prev)) this.setUiHover(prev, false);
    if (next) this.setUiHover(next, true);
  }

  private poke(h: HandState): void {
    if (!h.hasTip) return;
    for (const p of this.panels) {
      const lo = p.entity.object3D!.worldToLocal(this.v1.copy(h.indexTip));
      if (Math.abs(lo.x) > p.w / 2 || Math.abs(lo.y) > p.h / 2) continue;
      const slider = p.items.find((u) => u.kind === 'slider' && Math.abs(lo.x - u.x) <= u.w / 2 && Math.abs(lo.y - u.y) <= u.h / 2);
      if (slider && lo.z < 0.008 && lo.z > -0.02) {
        this.slideTo(slider, lo.x);
        h.pokeLatched = true;
        return;
      }
      if (h.pokeLatched) {
        if (lo.z > 0.02) h.pokeLatched = false;
        return;
      }
      if (lo.z > 0.008 || lo.z < -0.02) continue;
      for (const item of p.items) {
        if (item.kind === 'label') continue;
        if (item.kind === 'cell' && (this.cellPart(item.value) >= 0 || !this.cellActive(item.value))) continue;
        if (Math.abs(lo.x - item.x) <= item.w / 2 && Math.abs(lo.y - item.y) <= item.h / 2) {
          h.pokeLatched = true;
          this.pressUi(item);
          return;
        }
      }
    }
  }

  private dragSlider(h: HandState): void {
    const obj = h.slider!.panel.entity.object3D!;
    const lo = obj.worldToLocal(this.v1.copy(h.mode === 'hand' && !h.targetFar ? h.point : h.rayOrigin));
    if (h.mode === 'hand' && !h.targetFar) {
      this.slideTo(h.slider!, lo.x);
      return;
    }
    obj.getWorldQuaternion(this.q1).invert();
    const ld = this.v2.copy(h.rayDir).applyQuaternion(this.q1);
    if (ld.z < -1e-4 && lo.z > 0) this.slideTo(h.slider!, lo.x + (ld.x * -lo.z) / ld.z);
  }

  // ---- actions

  private onGrab(h: HandState, btn: Btn): void {
    const t = h.target!;
    if (t.kind === 'ui') {
      if (t.ui!.kind === 'slider') {
        h.slider = t.ui!;
        h.holdButton = btn;
        this.dragSlider(h);
        return;
      }
      this.pressUi(t.ui!);
      return;
    }
    const tapLike = btn === 'trigger' || btn === 'pinch';
    if (this.tool === 'select' && tapLike && t.kind === 'placed') {
      if (this.selection.has(t.placed!)) this.selection.delete(t.placed!);
      else this.selection.add(t.placed!);
      this.tick(0.2);
      this.redrawUi((u) => u.id === 'deselect');
      return;
    }
    if (this.tool === 'paint' && (t.kind === 'placed' || t.kind === 'loose')) {
      h.painting = true;
      h.holdButton = btn;
      this.paintTarget(t);
      return;
    }
    switch (t.kind) {
      case 'cell': {
        const item = t.ui!;
        item.preview!.getWorldPosition(this.v1);
        if (this.tabName() === 'Minifigs') {
          h.fromSelection = false;
          this.startHold(h, btn, this.figurePieces(item.value, this.v1.clone()), true);
        } else {
          const part = this.cellPart(item.value);
          this.holdLoose(h, btn, [this.spawnLoose(part, this.color, this.v1, this.root.object3D!.quaternion)], true);
        }
        return;
      }
      case 'placed': {
        const group = this.selection.has(t.placed!) && this.selection.size > 1 ? [...this.selection] : [t.placed!];
        this.holdPlaced(h, btn, t.placed!, group, false);
        return;
      }
      case 'loose':
        this.holdLoose(h, btn, [t.loose!], h.targetFar);
        return;
      case 'edge':
      case 'bar': {
        h.frame = t.frame!;
        h.holdButton = btn;
        const obj = this.frameObject(h.frame);
        h.anchorDist = h.mode === 'controller' && h.targetFar ? t.score : -1;
        this.q1.copy(h.quat).invert();
        h.offsetQuat.copy(this.q1).multiply(obj.quaternion);
        h.offsetPos.copy(obj.position).sub(this.grabPoint(h)).applyQuaternion(this.q1);
        this.levelAnim = null;
        this.tick(0.3);
        return;
      }
      case 'resize': {
        const panel = this.panels.find((p) => p.id === t.frame)!;
        h.frame = t.frame!;
        h.resizing = panel;
        h.holdButton = btn;
        h.anchorDist = h.mode === 'controller' && h.targetFar ? t.score : -1;
        // The top-left corner stays put while the bottom-right follows the hand.
        panel.entity.object3D!.localToWorld(h.resizeAnchor.set(-panel.w / 2, panel.h / 2, 0));
        this.tick(0.3);
        return;
      }
      case 'corner':
        h.frame = 'platform';
        h.holdButton = btn;
        h.corner = t.corner!;
        h.anchorDist = h.mode === 'controller' && h.targetFar ? t.score : -1;
        this.tick(0.3);
        return;
    }
  }

  private frameObject(frame: FrameKind): Object3D {
    if (frame === 'platform') return this.root.object3D!;
    if (frame === 'shelf') return this.shelf!.object3D!;
    return this.panels.find((p) => p.id === frame)!.entity.object3D!;
  }

  private onDuplicate(h: HandState, btn: Btn): void {
    const t = h.target!;
    if (t.kind === 'cell') {
      this.onGrab(h, btn);
      return;
    }
    if (t.kind === 'placed') {
      const group = this.selection.has(t.placed!) && this.selection.size > 1 ? [...this.selection] : [t.placed!];
      this.holdPlaced(h, btn, t.placed!, group, true);
    } else if (t.kind === 'loose') {
      const l = t.loose!;
      this.holdLoose(h, btn, [this.spawnLoose(l.part, l.color, l.mesh.position, l.mesh.quaternion)], h.targetFar);
    }
  }

  private onDelete(t: Target): void {
    if (t.kind === 'placed') {
      const group = this.selection.has(t.placed!) ? [...this.selection] : [t.placed!];
      for (const rec of group) {
        this.placedWorldPose(rec, this.v1, this.q1);
        this.dropLoose(this.spawnLoose(rec.part, rec.color, this.v1, this.q1), true);
        this.removePlaced(rec);
      }
      this.redrawUi((u) => u.id === 'deselect');
    } else if (t.kind === 'loose') {
      this.dropLoose(t.loose!, true);
    }
  }

  private paintTarget(t: Target | null): void {
    if (!t) return;
    if (t.kind === 'placed' && t.placed!.color !== this.color) {
      this.recolor([t.placed!], this.color);
      this.tick(0.15);
    } else if (t.kind === 'loose' && t.loose!.color !== this.color) {
      t.loose!.color = this.color;
      t.loose!.mesh.material = this.mats[this.color];
      this.tick(0.15);
    }
  }

  private grabPoint(h: HandState): Vector3 {
    return h.anchorDist >= 0 ? this.v2.copy(h.rayOrigin).addScaledVector(h.rayDir, h.anchorDist) : this.v2.copy(h.point);
  }

  private holdPlaced(h: HandState, btn: Btn, anchor: Placed, group: Placed[], duplicate: boolean): void {
    const recs = [anchor, ...group.filter((r) => r !== anchor)];
    const pieces: Piece[] = recs.map((rec) => {
      this.placedWorldPose(rec, this.v1, this.q1);
      return { block: this.spawnLoose(rec.part, rec.color, this.v1, this.q1), offPos: new Vector3(), offQuat: new Quaternion() };
    });
    h.fromSelection = group.length > 1 || this.selection.has(anchor);
    if (!duplicate) for (const rec of recs) this.removePlaced(rec);
    this.startHold(h, btn, pieces, h.targetFar);
  }

  private holdLoose(h: HandState, btn: Btn, blocks: Loose[], far: boolean): void {
    h.fromSelection = false;
    this.startHold(h, btn, blocks.map((block) => ({ block, offPos: new Vector3(), offQuat: new Quaternion() })), far);
  }

  private startHold(h: HandState, btn: Btn, pieces: Piece[], far: boolean): void {
    h.pieces = pieces;
    h.holdButton = btn;
    h.target = null;
    this.tick(0.3);
    const blocks = new Set(pieces.map((p) => p.block));
    this.shelfItems = this.shelfItems.filter((s) => !blocks.has(s.block));
    const anchor = pieces[0].block.mesh;
    this.q1.copy(anchor.quaternion).invert();
    for (const p of pieces) {
      p.offQuat.copy(this.q1).multiply(p.block.mesh.quaternion);
      p.offPos.copy(p.block.mesh.position).sub(anchor.position).applyQuaternion(this.q1);
      p.block.mesh.castShadow = !this.lib.isTrans(p.block.color);
    }
    // Held like a real object: the block keeps its rotation relative to the hand.
    this.q1.copy(h.quat).invert();
    h.offsetQuat.copy(this.q1).multiply(anchor.quaternion);
    h.rotTarget.copy(h.offsetQuat);
    if (far) h.offsetPos.set(0, 0, 0);
    else h.offsetPos.copy(anchor.position).sub(h.point).applyQuaternion(this.q1);
  }

  private holdPieces(h: HandState, delta: number): void {
    const pieces = h.pieces!;
    const anchor = pieces[0].block.mesh;
    let rate = FOLLOW_HAND;
    if (h.mode === 'controller') {
      const pad = this.input.xr.gamepads[h.hand];
      if (pad) {
        // Thumbstick: left/right spins the block a quarter turn about up; up/down tips it.
        if (pad.getAxesEnteringLeft(InputComponent.Thumbstick)) this.turnHeld(h, 'spin', 1);
        if (pad.getAxesEnteringRight(InputComponent.Thumbstick)) this.turnHeld(h, 'spin', -1);
        if (pad.getAxesEnteringUp(InputComponent.Thumbstick)) this.turnHeld(h, 'tip', -1);
        if (pad.getAxesEnteringDown(InputComponent.Thumbstick)) this.turnHeld(h, 'tip', 1);
      }
      h.offsetQuat.slerp(h.rotTarget, 1 - Math.exp(-delta * 18));
      this.v1.copy(h.rayOrigin).addScaledVector(h.rayDir, HOLD_DIST);
      if (h.offsetPos.lengthSq() > 0) this.v1.copy(h.offsetPos).applyQuaternion(h.quat).add(h.point);
      this.q1.copy(h.quat).multiply(h.offsetQuat);
      rate = FOLLOW_CTRL;
    } else {
      this.v1.copy(h.offsetPos).applyQuaternion(h.quat).add(h.point);
      this.q1.copy(h.quat).multiply(h.offsetQuat);
    }
    const a = 1 - Math.exp(-delta * rate);
    anchor.position.lerp(this.v1, a);
    anchor.quaternion.slerp(this.q1, a);
    for (let k = 1; k < pieces.length; k++) {
      const m = pieces[k].block.mesh;
      m.position.copy(pieces[k].offPos).applyQuaternion(anchor.quaternion).add(anchor.position);
      m.quaternion.copy(anchor.quaternion).multiply(pieces[k].offQuat);
    }

    // Kit guidance: light up where this piece goes and draw a line to it.
    if (this.kit && pieces.length === 1) {
      const local = this.root.object3D!.worldToLocal(this.v5.copy(anchor.position));
      const target = this.nearestTarget(pieces[0].block, local);
      const entry = target && this.kit.remaining.find((r) => r.rec === target);
      if (entry && this.instructions !== 'manual') {
        const lines = entry.ghost.object3D as LineSegments;
        lines.material = this.ghostLitMat;
        h.lit = lines;
        this.root.object3D!.localToWorld(this.placedCenter(target!, this.v6));
        const pos = h.guide.geometry.attributes.position as BufferAttribute;
        pos.setXYZ(0, anchor.position.x, anchor.position.y, anchor.position.z);
        pos.setXYZ(1, this.v6.x, this.v6.y, this.v6.z);
        pos.needsUpdate = true;
        h.guide.visible = anchor.position.distanceTo(this.v6) > GHOST_PULL;
      }
    }

    if (this.computeSnap(pieces)) {
      this.snapOut.forEach((o, k) => {
        const g = this.ghostFor(h, k);
        g.geometry = this.lib.geometries[pieces[k].block.part];
        this.placedWorldPose(o, g.position, g.quaternion);
        g.scale.setScalar(this.scale);
        g.visible = true;
      });
    }
  }

  /** Quarter-turn the held block: spin about the platform's up axis, or tip about the controller's side axis. */
  private turnHeld(h: HandState, how: 'spin' | 'tip', dir: number): void {
    const angle = (dir * Math.PI) / 2;
    if (how === 'spin') {
      const upAxis = this.v2.set(0, 1, 0).applyQuaternion(this.root.object3D!.quaternion);
      const w = new Quaternion().setFromAxisAngle(upAxis, angle);
      // world-space turn, expressed in the controller's frame
      h.rotTarget.premultiply(new Quaternion().copy(h.quat).invert().multiply(w).multiply(h.quat));
    } else {
      h.rotTarget.premultiply(new Quaternion().setFromAxisAngle(this.v2.set(1, 0, 0), angle));
    }
    this.tick(0.2);
  }

  private ghostFor(h: HandState, k: number): Mesh {
    while (h.ghosts.length <= k) {
      const g = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.5, depthWrite: false }));
      g.renderOrder = 10;
      this.world.createTransformEntity(g, { persistent: true });
      h.ghosts.push(g);
    }
    return h.ghosts[k];
  }

  private releasePieces(h: HandState): void {
    const pieces = h.pieces!;
    h.pieces = null;
    h.holdButton = null;
    const anchor = pieces[0].block.mesh;
    // Dropped on the library → put back.
    const lo = this.library.entity.object3D!.worldToLocal(this.v1.copy(anchor.position));
    if (Math.abs(lo.x) < this.library.w / 2 + 0.02 && Math.abs(lo.y) < this.library.h / 2 + 0.02 && lo.z > -0.03 && lo.z < 0.06) {
      for (const p of pieces) this.dropLoose(p.block, true);
      return;
    }
    if (this.computeSnap(pieces)) {
      const recs = this.snapOut.map((o, k) => this.makeRec(pieces[k].block.part, pieces[k].block.color, o.m, o.target));
      if (h.fromSelection) this.selection.clear();
      recs.forEach((rec, k) => {
        const m = pieces[k].block.mesh;
        this.snaps.push({ block: pieces[k].block, rec, fromPos: m.position.clone(), fromQuat: m.quaternion.clone(), t: 0 });
        if (h.fromSelection) this.selection.add(rec);
      });
      this.click();
    }
    this.redrawUi((u) => u.id === 'deselect');
  }

  private dropPieces(h: HandState): void {
    for (const p of h.pieces!) this.dropLoose(p.block, true);
    h.pieces = null;
    h.holdButton = null;
  }

  private holdFrame(h: HandState, delta: number): void {
    if (h.corner >= 0) {
      this.dragCorner(h);
      return;
    }
    if (h.resizing) {
      this.dragResize(h, h.resizing);
      return;
    }
    const obj = this.frameObject(h.frame!);
    this.v1.copy(h.offsetPos).applyQuaternion(h.quat).add(this.grabPoint(h));
    this.q1.copy(h.quat).multiply(h.offsetQuat);
    const a = 1 - Math.exp(-delta * (h.mode === 'hand' ? FOLLOW_HAND : FOLLOW_CTRL));
    obj.position.lerp(this.v1, a);
    obj.quaternion.slerp(this.q1, a);
    obj.updateMatrixWorld(true);
    if (h.frame === 'platform') this.aimKeyLight();
    if (h.frame === 'shelf') this.layoutShelfItems();
  }

  /** Resize the library: its top-left stays fixed, the grid regrows in whole cells. */
  private dragResize(h: HandState, p: Panel): void {
    const obj = p.entity.object3D!;
    obj.getWorldQuaternion(this.q1);
    const rel = this.v3.copy(this.grabPoint(h)).sub(h.resizeAnchor).applyQuaternion(this.q2.copy(this.q1).invert());
    const w = Math.round(Math.min(0.9, Math.max(0.26, rel.x)) * 100) / 100;
    const hh = Math.round(Math.min(0.9, Math.max(0.3, -rel.y)) * 100) / 100;
    if (w === p.w && hh === p.h) return;
    p.w = w;
    p.h = hh;
    obj.position.copy(h.resizeAnchor).add(this.v4.set(w / 2, -hh / 2, 0).applyQuaternion(this.q1));
    obj.updateMatrixWorld(true);
    this.sizePanel(p);
    this.layoutLibrary();
    this.pulse(h.hand, 0.1, 6);
  }

  private releaseFrame(h: HandState): void {
    if (h.frame === 'platform' && h.corner < 0) {
      const q = this.root.object3D!.quaternion;
      const up = this.v1.set(0, 1, 0).applyQuaternion(q);
      if (up.angleTo(this.up) < LEVEL_SNAP) {
        this.levelAnim = { from: q.clone(), to: new Quaternion().setFromAxisAngle(this.up, this.yawOf(q)), t: 0 };
      }
    }
    h.frame = null;
    h.resizing = null;
    h.corner = -1;
    h.holdButton = null;
  }

  private tickLevel(delta: number): void {
    const anim = this.levelAnim;
    if (!anim) return;
    anim.t = Math.min(1, anim.t + delta / 0.15);
    const r = this.root.object3D!;
    r.quaternion.slerpQuaternions(anim.from, anim.to, 1 - (1 - anim.t) * (1 - anim.t));
    r.updateMatrixWorld(true);
    this.aimKeyLight();
    if (anim.t >= 1) this.levelAnim = null;
  }

  private dragCorner(h: HandState): void {
    const P = dims.pitch;
    const local = this.root.object3D!.worldToLocal(this.v1.copy(this.grabPoint(h)));
    const b = { ...this.bounds };
    const ext = this.placedExtent();
    const gx = Math.round(local.x / P);
    const gz = Math.round(local.z / P);
    if (h.corner & 1) b.x1 = Math.min(b.x0 + MAX_STUDS, Math.max(b.x0 + MIN_STUDS, gx, ext.maxI));
    else b.x0 = Math.max(b.x1 - MAX_STUDS, Math.min(b.x1 - MIN_STUDS, gx, ext.minI));
    if (h.corner & 2) b.z1 = Math.min(b.z0 + MAX_STUDS, Math.max(b.z0 + MIN_STUDS, gz, ext.maxJ));
    else b.z0 = Math.max(b.z1 - MAX_STUDS, Math.min(b.z1 - MIN_STUDS, gz, ext.minJ));
    if (b.x0 !== this.bounds.x0 || b.x1 !== this.bounds.x1 || b.z0 !== this.bounds.z0 || b.z1 !== this.bounds.z1) {
      this.bounds = b;
      this.updatePlate();
      this.aimKeyLight();
      this.pulse(h.hand, 0.15, 8);
    }
  }

  // ---- visuals

  private drawPointer(h: HandState): void {
    const t = h.target;
    h.outline.visible = false;
    if (t && !h.pieces && !h.frame && !h.slider && t.kind !== 'ui') {
      if (t.kind === 'placed') {
        this.placedWorldPose(t.placed!, h.outline.position, h.outline.quaternion);
        h.outline.geometry = this.lib.geometries[t.placed!.part];
        h.outline.scale.setScalar(1.08 * this.scale);
      } else if (t.obj) {
        const obj = t.obj as Mesh;
        obj.getWorldPosition(h.outline.position);
        obj.getWorldQuaternion(h.outline.quaternion);
        obj.getWorldScale(h.outline.scale);
        h.outline.geometry = obj.geometry;
        h.outline.scale.multiplyScalar(t.kind === 'loose' || t.kind === 'cell' ? 1.08 : 1.3);
      }
      (h.outline.material as MeshBasicMaterial).color.set(this.tool === 'paint' ? this.lib.colors[this.color].hex : 0xffffff);
      h.outline.visible = true;
    }
    const showRay = h.mode !== 'none' && !h.pieces && !h.frame && (h.targetFar || !t || !!h.slider);
    h.ray.visible = showRay;
    h.cursor.visible = showRay && !!t;
    if (!showRay) return;
    const len = t ? t.score : 0.35;
    h.ray.position.copy(h.rayOrigin);
    h.ray.quaternion.setFromUnitVectors(this.v1.set(0, 0, 1), h.rayDir);
    h.ray.scale.set(1, 1, len);
    (h.ray.material as MeshBasicMaterial).opacity = t ? 0.7 : 0.25;
    if (t) h.cursor.position.copy(h.rayOrigin).addScaledVector(h.rayDir, len);
  }

  private updateSelectionOutlines(): void {
    let k = 0;
    for (const rec of this.selection) {
      let m = this.selOutlines[k];
      if (!m) {
        m = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0x22d3ee, side: BackSide, transparent: true, opacity: 0.9 }));
        this.child(this.root, m);
        this.selOutlines.push(m);
      }
      m.geometry = this.lib.geometries[rec.part];
      this.localMatrix(rec, m.matrix);
      m.matrix.decompose(m.position, m.quaternion, m.scale);
      m.scale.setScalar(1.1);
      m.visible = true;
      k++;
    }
    for (; k < this.selOutlines.length; k++) this.selOutlines[k].visible = false;
  }

  // ================================================================ kits

  private async startKit(id: string, title: string): Promise<void> {
    const data = (await fetch(`${import.meta.env.BASE_URL}kits/${id}.json`).then((r) => r.json())) as { steps: KitBlock[][] };
    this.exitKit();
    this.clearPlaced();
    const all = data.steps.flat();
    const xs: number[] = [];
    const zs: number[] = [];
    for (const b of all) {
      if (b.m) {
        xs.push(b.m[9] / 20);
        zs.push(b.m[11] / 20);
      } else {
        xs.push(b.i!, b.i! + b.fw!);
        zs.push(b.j!, b.j! + b.fd!);
      }
    }
    const minI = Math.floor(Math.min(...xs));
    const maxI = Math.ceil(Math.max(...xs));
    const minJ = Math.floor(Math.min(...zs));
    const maxJ = Math.ceil(Math.max(...zs));
    const b = this.bounds;
    const needW = maxI - minI + 6;
    const needD = maxJ - minJ + 6;
    if (b.x1 - b.x0 < needW || b.z1 - b.z0 < needD) {
      const w = Math.max(b.x1 - b.x0, needW);
      const d = Math.max(b.z1 - b.z0, needD);
      const cx = Math.round((b.x0 + b.x1) / 2);
      const cz = Math.round((b.z0 + b.z1) / 2);
      this.bounds = { x0: cx - Math.ceil(w / 2), x1: cx + Math.floor(w / 2), z0: cz - Math.ceil(d / 2), z1: cz + Math.floor(d / 2) };
      this.updatePlate();
    }
    this.kit = {
      id,
      title,
      steps: data.steps,
      step: 0,
      page: 0,
      di: Math.round((this.bounds.x0 + this.bounds.x1) / 2 - (minI + maxI) / 2),
      dj: Math.round((this.bounds.z0 + this.bounds.z1) / 2 - (minJ + maxJ) / 2),
      remaining: [],
      matched: new Map(),
      stepPlaced: [],
      spawned: [],
    };
    this.buildShelf();
    this.showTab(TAB_NAMES.indexOf('Kits'));
    this.beginStep();
    this.applyInstructions();
  }

  private kitRec(b: KitBlock): Placed | null {
    const kit = this.kit!;
    const part = this.lib.byId.get(b.part);
    if (part === undefined) return null;
    const color = this.colorOf(b.color);
    if (b.m) {
      const [r0, r1, r2, r3, r4, r5, r6, r7, r8, tx, ty, tz] = b.m;
      const L = dims.ldu;
      const m = new Matrix4().set(r0, r1, r2, tx * L + kit.di * dims.pitch, r3, r4, r5, ty * L, r6, r7, r8, tz * L + kit.dj * dims.pitch, 0, 0, 0, 1);
      return this.makeRec(part, color, m);
    }
    return this.makeRec(part, color, this.gridMatrix(part, b.i! + kit.di, b.j! + kit.dj, b.level!, b.turns!));
  }

  private edgeGeo(part: number): BufferGeometry {
    let g = this.edgeGeos.get(part);
    if (!g) {
      g = new EdgesGeometry(this.lib.geometries[part], 30);
      this.edgeGeos.set(part, g);
    }
    return g;
  }

  private addGhost(rec: Placed): void {
    const lines = new LineSegments(this.edgeGeo(rec.part), this.ghostLineMat);
    this.localMatrix(rec, lines.matrix);
    lines.matrix.decompose(lines.position, lines.quaternion, lines.scale);
    lines.renderOrder = 5;
    lines.visible = this.instructions !== 'manual';
    this.kit!.remaining.push({ rec, ghost: this.child(this.root, lines) });
  }

  private beginStep(): void {
    const kit = this.kit!;
    for (const r of kit.remaining) r.ghost.destroy();
    kit.remaining = [];
    kit.matched.clear();
    kit.stepPlaced = [];
    const items: Array<{ part: number; color: number }> = [];
    for (const b of kit.steps[kit.step]) {
      const rec = this.kitRec(b);
      if (!rec) continue;
      this.addGhost(rec);
      items.push({ part: rec.part, color: rec.color });
    }
    this.fillShelf(items);
    this.drawShelfLabel();
    if (this.manual && kit.page === kit.step - 1) this.showPage(kit.step);
    this.redrawUi();
  }

  private kitCheck(rec: Placed): void {
    const kit = this.kit;
    if (!kit) return;
    kit.stepPlaced.push(rec);
    let k = rec.target ? kit.remaining.findIndex((r) => r.rec === rec.target) : -1;
    if (k < 0) k = kit.remaining.findIndex(({ rec: g }) => this.samePlacement(g, rec));
    if (k < 0) return;
    kit.matched.set(rec, kit.remaining[k].rec);
    kit.remaining[k].ghost.destroy();
    kit.remaining.splice(k, 1);
    if (kit.remaining.length === 0) this.nextStep();
  }

  /** Same part, color and pose — allowing the quarter/half turns a symmetric part can't tell apart. */
  private samePlacement(g: Placed, rec: Placed): boolean {
    if (g.part !== rec.part || g.color !== rec.color) return false;
    if (this.v1.setFromMatrixPosition(g.m).distanceTo(this.v2.setFromMatrixPosition(rec.m)) > 0.0005) return false;
    const dq = new Quaternion().setFromRotationMatrix(g.m).invert().multiply(new Quaternion().setFromRotationMatrix(rec.m));
    if (2 * Math.acos(Math.min(1, Math.abs(dq.w))) < 0.17) return true;
    const def = this.lib.parts[g.part];
    if (!isSymmetric(def) || this.v3.set(0, 1, 0).applyQuaternion(dq).y < 0.98) return false;
    const yaw = 2 * Math.atan2(dq.y, dq.w);
    const step = def.w === def.d ? Math.PI / 2 : Math.PI;
    return Math.abs(yaw - Math.round(yaw / step) * step) < 0.17;
  }

  private nextStep(): void {
    const kit = this.kit!;
    this.clearShelf();
    kit.step++;
    this.chime();
    if (kit.step >= kit.steps.length) {
      this.finishKit();
      return;
    }
    this.beginStep();
  }

  private restartStep(): void {
    const kit = this.kit;
    if (!kit) return;
    kit.matched.clear();
    for (const rec of kit.stepPlaced) if (this.placedRecs.includes(rec)) this.removePlaced(rec);
    this.clearShelf();
    this.beginStep();
  }

  private skipStep(): void {
    const kit = this.kit;
    if (!kit) return;
    for (const { rec, ghost } of [...kit.remaining]) {
      ghost.destroy();
      this.addPlaced(rec);
    }
    kit.remaining = [];
    this.nextStep();
  }

  private exitKit(): void {
    const kit = this.kit;
    if (!kit) return;
    for (const r of kit.remaining) r.ghost.destroy();
    this.clearShelf();
    this.destroyShelf();
    this.kit = null;
    this.applyInstructions();
  }

  private finishKit(): void {
    this.destroyShelf();
    this.kit = null;
    this.applyInstructions();
    this.redrawUi();
  }

  /** Ghosts on the platform, a paged manual, or both. */
  private applyInstructions(): void {
    const wantManual = !!this.kit && this.instructions !== 'ghosts';
    if (wantManual && !this.manual) {
      this.manual = this.createPanel('manual', 0.3, 0.36, false);
      this.layoutManual();
      const r = this.root.object3D!;
      const P = dims.pitch * this.scale;
      const obj = this.manual.entity.object3D!;
      obj.position
        .set(this.bounds.x1 * P + 0.2, 0.24, ((this.bounds.z0 + this.bounds.z1) / 2) * P - 0.08)
        .applyQuaternion(r.quaternion)
        .add(r.position);
      obj.quaternion.copy(r.quaternion).multiply(this.q1.setFromEuler(this.euler.set(-0.3, -0.55, 0, 'YXZ')));
      this.showPage(this.kit!.step);
    } else if (!wantManual && this.manual) {
      this.destroyPanel(this.manual);
      this.manual = null;
      this.mini = null;
    }
    if (this.kit) for (const r of this.kit.remaining) r.ghost.object3D!.visible = this.instructions !== 'manual';
  }

  private layoutManual(): void {
    const p = this.manual!;
    this.clearPanel(p);
    const inner = p.w - 2 * MARGIN;
    this.addUi(p, 'man:title', 'label', 0, 0, p.h / 2 - MARGIN - 0.014, inner, 0.028);
    const y = -p.h / 2 + MARGIN + 0.013;
    this.addUi(p, 'man:prev', 'button', 0, -inner / 2 + 0.03, y, 0.06, 0.026);
    this.addUi(p, 'man:here', 'button', 0, 0, y, 0.12, 0.026);
    this.addUi(p, 'man:next', 'button', 0, inner / 2 - 0.03, y, 0.06, 0.026);
  }

  /**
   * A manual page: the step's parts across the top (with counts), and the model
   * as built through this step as a slowly turning miniature, new parts outlined.
   */
  private showPage(n: number): void {
    const kit = this.kit;
    const p = this.manual;
    if (!kit || !p) return;
    kit.page = n;
    this.layoutManual();
    // Parts callout.
    const counts = new Map<string, { part: number; color: number; n: number }>();
    for (const b of kit.steps[n]) {
      const part = this.lib.byId.get(b.part);
      if (part === undefined) continue;
      const key = `${part}:${b.color}`;
      const c = counts.get(key) ?? { part, color: this.colorOf(b.color), n: 0 };
      c.n++;
      counts.set(key, c);
    }
    const entries = [...counts.values()].slice(0, 8);
    const slotW = (p.w - 2 * MARGIN) / Math.max(4, entries.length);
    const cy = p.h / 2 - MARGIN - 0.028 - 0.03;
    entries.forEach((c, k) => {
      const x = -p.w / 2 + MARGIN + slotW / 2 + k * slotW;
      const def = this.lib.parts[c.part];
      const mesh = new Mesh(this.lib.geometries[c.part], this.mats[c.color]);
      const extent = Math.max(def.w * dims.pitch, def.d * dims.pitch, def.h * dims.unit);
      mesh.scale.setScalar(Math.min(3, 0.026 / extent));
      mesh.position.set(x, cy + 0.005, 0.015);
      mesh.rotation.set(0.5, -0.6, 0);
      this.addContent(p, mesh);
      this.addUi(p, `man:count:${k}`, 'label', 0, x, cy - 0.024, slotW - 0.004, 0.016);
      const item = p.items[p.items.length - 1];
      const ctx = item.canvas!.getContext('2d')!;
      ctx.clearRect(0, 0, item.canvas!.width, item.canvas!.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(item.canvas!.height * 0.9)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${c.n}×`, item.canvas!.width / 2, item.canvas!.height / 2);
      item.tex!.needsUpdate = true;
    });
    // Miniature of the model through this step.
    const recs: Array<{ rec: Placed; current: boolean }> = [];
    kit.steps.slice(0, n + 1).forEach((step, k) => {
      for (const b of step) {
        const rec = this.kitRec(b);
        if (rec) recs.push({ rec, current: k === n });
      }
    });
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const { rec } of recs) {
      this.placedCenter(rec, this.v1);
      min.min(this.v1);
      max.max(this.v1);
    }
    const all = kit.steps.flat().map((b) => this.kitRec(b)).filter((r): r is Placed => !!r);
    for (const rec of all) {
      this.placedCenter(rec, this.v1);
      min.min(this.v1);
      max.max(this.v1);
    }
    const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.02) + dims.pitch * 2;
    const areaH = p.h - 2 * MARGIN - 0.028 - 0.07 - 0.035;
    const fit = Math.min(areaH, p.w - 2 * MARGIN) * 0.85;
    const holder = new Object3D();
    holder.position.set(0, -p.h / 2 + MARGIN + 0.035 + areaH / 2 - 0.01, 0.06);
    holder.rotation.set(0.5, 0, 0);
    this.addContent(p, holder);
    const spin = new Object3D();
    holder.add(spin);
    const model = new Object3D();
    model.scale.setScalar(fit / size);
    model.position.set(-((min.x + max.x) / 2) * (fit / size), -((min.y + max.y) / 2) * (fit / size), -((min.z + max.z) / 2) * (fit / size));
    spin.add(model);
    for (const { rec, current } of recs) {
      const mesh = new Mesh(this.lib.geometries[rec.part], this.mats[rec.color]);
      this.localMatrix(rec, mesh.matrix);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      model.add(mesh);
      if (current) {
        const lines = new LineSegments(this.edgeGeo(rec.part), this.stepLineMat);
        lines.position.copy(mesh.position);
        lines.quaternion.copy(mesh.quaternion);
        lines.scale.setScalar(1.02);
        model.add(lines);
      }
    }
    this.mini = spin;
    this.redrawUi((u) => u.id.startsWith('man:') && !u.id.startsWith('man:count'));
  }

  // ---- shelf

  private buildShelf(): void {
    if (this.shelf) return;
    const tray = new Mesh(
      new RoundedBoxGeometry(SHELF_W, 0.008, SHELF_D, 2, 0.004).translate(0, -0.004, 0),
      new MeshStandardMaterial({ color: 0x1f2430, roughness: 0.6 }),
    );
    tray.name = 'KitShelf';
    tray.receiveShadow = true;
    this.shelf = this.track(this.world.createTransformEntity(tray));
    const bar = new Mesh(new CapsuleGeometry(0.009, 0.12, 4, 10).rotateZ(Math.PI / 2), new MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.3 }));
    bar.position.set(0, -0.004, SHELF_D / 2 + 0.02);
    this.shelfParts = [this.child(this.shelf, bar)];
    this.shelfBar = bar;
    this.shelfCanvas = document.createElement('canvas');
    this.shelfCanvas.width = 512;
    this.shelfCanvas.height = 64;
    this.shelfTex = new CanvasTexture(this.shelfCanvas);
    this.shelfTex.colorSpace = SRGBColorSpace;
    const label = new Mesh(new PlaneGeometry(SHELF_W, SHELF_W / 8), new MeshBasicMaterial({ map: this.shelfTex, toneMapped: false, transparent: true }));
    label.position.set(0, SHELF_W / 16, -SHELF_D / 2);
    this.shelfParts.push(this.child(this.shelf, label));
    this.placeShelf();
  }

  private placeShelf(): void {
    const r = this.root.object3D!;
    const P = dims.pitch * this.scale;
    const s = this.shelf!.object3D!;
    s.position
      .set(this.bounds.x1 * P + 0.22, 0.08, ((this.bounds.z0 + this.bounds.z1) / 2) * P + 0.12)
      .applyQuaternion(r.quaternion)
      .add(r.position);
    s.quaternion.copy(r.quaternion).multiply(this.q1.setFromEuler(this.euler.set(0.35, -0.55, 0, 'YXZ')));
    s.updateMatrixWorld(true);
    this.layoutShelfItems();
  }

  private destroyShelf(): void {
    if (!this.shelf) return;
    const gone = new Set([this.shelf, ...this.shelfParts]);
    for (const e of gone) e.destroy();
    this.built = this.built.filter((e) => !gone.has(e));
    this.shelfParts = [];
    this.shelf = null;
    this.shelfBar = null;
  }

  private clearShelf(): void {
    const kit = this.kit;
    for (const item of [...this.shelfItems]) this.dropLoose(item.block, true);
    this.shelfItems = [];
    if (kit) {
      for (const l of kit.spawned) if (this.loose.includes(l) && !this.isCarried(l)) this.dropLoose(l, true);
      kit.spawned = [];
    }
  }

  private fillShelf(items: Array<{ part: number; color: number }>): void {
    const kit = this.kit!;
    const S = this.scale;
    const gap = 0.014;
    let x = -SHELF_W / 2 + 0.015;
    let z = -SHELF_D / 2 + 0.02;
    let rowDepth = 0;
    for (const it of items) {
      const def = this.lib.parts[it.part];
      const w = Math.max(def.w * dims.pitch * S, 0.012);
      const d = Math.max(def.d * dims.pitch * S, 0.012);
      if (x + w > SHELF_W / 2 - 0.01 && x > -SHELF_W / 2 + 0.02) {
        x = -SHELF_W / 2 + 0.015;
        z += rowDepth + gap;
        rowDepth = 0;
      }
      const pos = new Vector3(x + w / 2, (def.h * dims.unit * S) / 2 + 0.002, z + d / 2);
      const block = this.spawnLoose(it.part, it.color, pos, this.q1.identity());
      this.shelfItems.push({ block, pos });
      kit.spawned.push(block);
      x += w + gap;
      rowDepth = Math.max(rowDepth, d);
    }
    this.layoutShelfItems();
  }

  private layoutShelfItems(): void {
    if (!this.shelf) return;
    const s = this.shelf.object3D!;
    s.updateMatrixWorld(true);
    for (const { block, pos } of this.shelfItems) {
      block.mesh.position.copy(pos).applyMatrix4(s.matrixWorld);
      block.mesh.quaternion.copy(s.quaternion);
    }
  }

  private drawShelfLabel(): void {
    if (!this.shelf || !this.kit) return;
    const ctx = this.shelfCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 64);
    ctx.fillStyle = '#10131c';
    ctx.beginPath();
    ctx.roundRect(0, 0, 512, 64, 16);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${this.kit.title} · step ${this.kit.step + 1} of ${this.kit.steps.length}`, 256, 34);
    this.shelfTex.needsUpdate = true;
  }

  // ================================================================ saves

  private serialize(): object {
    return {
      v: 4,
      scale: this.scale,
      bounds: this.bounds,
      library: { w: this.library.w, h: this.library.h },
      blocks: this.placedRecs.map((r) => [
        this.lib.parts[r.part].id,
        this.lib.colors[r.color].code,
        'm',
        ...r.m.elements.map((v) => Math.round(v * 1e5) / 1e5),
      ]),
    };
  }

  private deserialize(data: unknown): void {
    const d = data as {
      v?: number;
      scale?: number;
      bounds?: { x0: number; x1: number; z0: number; z1: number };
      library?: { w: number; h: number };
      blocks?: unknown[][];
    };
    if (!d?.blocks) return;
    this.clearPlaced();
    if (d.bounds) this.bounds = { ...d.bounds };
    if (d.scale) this.scale = d.scale;
    this.root.object3D!.scale.setScalar(this.scale);
    this.updatePlate();
    if (d.library && (d.library.w !== this.library.w || d.library.h !== this.library.h)) {
      this.library.w = d.library.w;
      this.library.h = d.library.h;
      this.sizePanel(this.library);
      this.layoutLibrary();
    }
    for (const row of d.blocks) {
      const [id, code] = row as [string, number];
      const part = this.lib.byId.get(id);
      if (part === undefined) continue;
      const color = this.colorOf(code);
      if (row[2] === 'm') {
        this.addPlaced(this.makeRec(part, color, new Matrix4().fromArray(row.slice(3) as number[])));
        continue;
      }
      // v2/v3 saves stored grid cells (v2 counted height in plates, v3 in half plates).
      const [, , i, j, level, turns] = row as [string, number, number, number, number, number];
      const lvl = (d.v ?? 2) < 3 ? level * 2 : level;
      this.addPlaced(this.makeRec(part, color, this.gridMatrix(part, i, j, lvl, turns)));
    }
    this.redrawUi((u) => u.kind === 'slider');
  }

  private readStore(key: string): unknown {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private writeStore(key: string, value: object): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable or full; saving is best-effort
    }
  }

  private saveSlot(): void {
    this.writeStore(`stacker.slot.${this.slot}`, { ...this.serialize(), at: new Date().toISOString() });
    this.click();
  }

  private loadSlot(): void {
    const data = this.readStore(`stacker.slot.${this.slot}`);
    if (!data) return;
    this.exitKit();
    this.deserialize(data);
    this.click();
  }

  // ================================================================ dev

  private showcase(): void {
    this.exitKit();
    this.clearPlaced();
    this.bounds = { x0: -32, x1: 32, z0: -32, z1: 32 };
    this.updatePlate();
    let z = this.bounds.z0 + 1;
    let n = 0;
    for (const tab of TABS) {
      let x = this.bounds.x0 + 1;
      let depth = 0;
      this.lib.parts.forEach((def, part) => {
        if (def.tab !== tab || x + def.w > this.bounds.x1 || z + def.d > this.bounds.z1) return;
        this.addPlaced(this.makeRec(part, n++ % 24, this.gridMatrix(part, x, z, 0, 0)));
        x += def.w + 1;
        depth = Math.max(depth, def.d);
      });
      z += depth + 1;
    }
  }

  private stress(): void {
    this.exitKit();
    this.clearPlaced();
    const part = this.lib.byId.get('3003') ?? 0;
    const h = this.lib.parts[part].h;
    const { x0, x1, z0, z1 } = this.bounds;
    for (let level = 0; level < h * 6; level += h) {
      for (let i = x0; i + 2 <= x1; i += 2) {
        for (let j = z0; j + 2 <= z1; j += 2) {
          this.addPlaced(this.makeRec(part, (i + j + level) & 15, this.gridMatrix(part, i, j, level, 0)));
        }
      }
    }
  }

  // ================================================================ helpers

  private yawOf(q: Quaternion): number {
    this.euler.setFromQuaternion(q, 'YXZ');
    return this.euler.y;
  }

  private beep(freq: number, at: number, len: number, type: OscillatorType, gainV: number): void {
    const ctx = (this.audio ??= new AudioContext());
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(gainV, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + len + 0.01);
  }

  private click(): void {
    try {
      this.beep(1600, 0, 0.045, 'square', 0.08);
    } catch {
      // audio is best-effort
    }
    for (const hand of HANDS) this.pulse(hand, 0.6, 25);
  }

  private chime(): void {
    try {
      [660, 880, 1320].forEach((f, k) => this.beep(f, k * 0.09, 0.25, 'sine', 0.08));
    } catch {
      // audio is best-effort
    }
  }

  private tick(intensity: number): void {
    for (const hand of HANDS) this.pulse(hand, intensity, 12);
  }

  private pulse(hand: Hand, intensity: number, ms: number): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    for (const source of session.inputSources) {
      if (source.handedness !== hand) continue;
      const actuator = (source.gamepad as unknown as { hapticActuators?: Array<{ pulse?: (v: number, ms: number) => void }> } | undefined)
        ?.hapticActuators?.[0];
      actuator?.pulse?.(intensity, ms);
    }
  }

  private tickStats(delta: number): void {
    this.frameCount++;
    this.frameTime += delta;
    this.worstFrame = Math.max(this.worstFrame, delta);
    this.statsTimer += delta;
    if (this.statsTimer < 0.5) return;
    this.stats.fps = this.frameCount / this.frameTime;
    this.stats.worstMs = this.worstFrame * 1000;
    this.frameCount = 0;
    this.frameTime = 0;
    this.worstFrame = 0;
    this.statsTimer = 0;
    this.drawStats();
  }

  private drawStats(): void {
    if (!this.statsCanvas || !this.statsTex) return;
    const ctx = this.statsCanvas.getContext('2d')!;
    const { width, height } = this.statsCanvas;
    const target = this.renderer.xr.getSession()?.frameRate;
    const ok = target ? this.stats.fps >= target * 0.95 : this.stats.fps >= 70;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#10131c';
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 14);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = ok ? '#4ade80' : '#f87171';
    ctx.font = `bold ${Math.round(height * 0.5)}px system-ui, sans-serif`;
    ctx.fillText(`${this.stats.fps.toFixed(0)} fps`, 14, height / 2);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `${Math.round(height * 0.32)}px system-ui, sans-serif`;
    const info = this.renderer.info.render;
    const kit = this.kit ? `${this.kit.title} ${this.kit.step + 1}/${this.kit.steps.length} · ` : '';
    ctx.fillText(
      `${kit}${this.placedRecs.length} pcs · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ${this.stats.worstMs.toFixed(0)} ms worst`,
      width * 0.22,
      height / 2,
      width * 0.76,
    );
    this.statsTex.needsUpdate = true;
  }
}
