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
  Data3DTexture,
  DirectionalLight,
  EdgesGeometry,
  Entity,
  Euler,
  HemisphereLight,
  InputComponent,
  InstancedMesh,
  Line,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  NoToneMapping,
  Object3D,
  PCFShadowMap,
  PMREMGenerator,
  Group,
  PlaneGeometry,
  RedFormat,
  RingGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import type { Material, Texture, ToneMapping } from '@iwsdk/core';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { dims, isSymmetric, Library, studGeometry, TABS } from './blocks.js';
import { DesktopControls } from './desktop.js';
import { ArtRenderer, KitBox, TEAR_PULL } from './kit-boxes.js';
import type { ArtPiece } from './kit-boxes.js';
import { KITS, kitPiece } from './kits.js';
import type { KitBlock } from './kits.js';
import { MANUAL_ZOOM, ManualPainter } from './manual.js';
import { DIM_LEVELS, PULL_CLICK, PULL_MAX, PullLamp } from './lamp.js';
import { SnapCamera, VIEW_FOV } from './snap-camera.js';
import { CUBBY_H, CUBBY_W, FACE_STEP, FACES, JAR_H, JAR_R, PartDrum, PER_FACE, PREVIEW_FIT as CUBBY_FIT, cubbyCenter } from './shelf.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { CONTACT, envId, ENVS, finishIndex, FINISHES, makeBackdrop, makeEnvScene, makeFinish, OCCLUSION, paintBackdrop, patchBlockShader, STYLES } from './look.js';
import { progress } from './splash.js';

// ---- Platform (world meters ÷ the Size scale = platform-local units) ----
const PLATE_T = 0.008;
const MIN_STUDS = 4;
const MAX_STUDS = 64;
const START_STUDS = 32;
const MAX_LEVEL = 400; // half plates
const SNAP_DROP = 0.05;
const HANDLE_OUT = 0.017;
const HANDLE_IDLE = 0.55; // handle opacity until a hand points at one
const LEVEL_SNAP = (7 * Math.PI) / 180;

// ---- Input ----
const CTRL_TIP = 0.035;
const CTRL_REACH = 0.04;
const HAND_REACH = 0.028;
const PINCH_ON = 0.018;
const PINCH_OFF = 0.03;
const PINCH_OPENING = 0.022; // a held block stops following once the pinch opens this far
const LOST_GRACE = 0.3; // seconds a hand may drop out of tracking before what it holds is let go (parked)
const MID_ON = 0.015; // middle-finger pinch (duplicate) needs the index finger clearly open
const INDEX_OPEN = 0.04;
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
const GAP = 0.005;
const MARGIN = 0.012;
const PANEL_BG = 0x1b1f29;
const SLOTS = 6;

/** Settings → Controls: [action, how] (no "how" = a heading). */
const CONTROLS: Array<[string, string?]> = [
  ['Controllers'],
  ['Grab a part or block', 'Grip or trigger, near or by ray'],
  ['Duplicate', 'Hold A/X on a block · or A/X + grip, then let go of A'],
  ['Turn the held block', 'Thumbstick ← → (squares it to the platform)'],
  ['Tip the held block', 'Thumbstick ↑ ↓'],
  ['Select', 'Hold B/Y + trigger · sweep to select more'],
  ['Delete', 'Tap B/Y on a block · or drop it on the shelf'],
  ['Move / tilt the platform', 'Grab a white edge bar'],
  ['Turn / scale the platform', 'An edge bar in each hand: turn or spread them'],
  ['Resize the platform', 'Grab a yellow corner'],
  ['Spin the parts shelf', 'Grab its top or bottom and swipe'],
  ['Color · finish', 'Dip into a paint jar · touch a sample tile'],
  ['Tools, undo, saves', 'Turn your left palm up (wrist menu)'],
  ['Box your build', 'Camera on the rack, then A/X'],
  ['Dim the lights', "Pull the bulb's cord"],
  ['Hands'],
  ['Grab', 'Pinch thumb and index'],
  ['Duplicate', 'Pinch thumb and middle finger'],
  ['Press a button', 'Poke it with your index finger'],
  ['Turn the held block', 'Rotate your wrist'],
  ['Color · finish', 'Dip a fingertip into a jar · touch a tile'],
  ['Wrist menu', 'Turn your left palm up'],
  ['Camera shutter', 'Poke the red button with the other hand'],
];
const SHELF_W = 0.34;
const SHELF_D = 0.16;
const SHELF_FIT = 0.075; // big pieces (baseplates) sit on the shelf shrunk to this size
// Kit box rack: two shelves of boxes, fronts facing the user.
const RACK_W = 0.64;
const RACK_TIER = 0.155;
const RACK_D = 0.09;

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
// Styles set all of these; the sliders then fine-tune the chosen style.
const SLIDERS: SliderDef[] = [
  { id: 'size', label: 'Size', min: 0.75, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { id: 'backdrop', label: 'Room ↔ virtual', min: 0, max: 1, step: 0.05, fmt: pct },
  { id: 'envStrength', label: 'Reflections', min: 0, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
  { id: 'envTurn', label: 'Reflection turn', min: 0, max: 360, step: 5, fmt: deg },
  { id: 'exposure', label: 'Exposure', min: 0.3, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  { id: 'key', label: 'Key light', min: 0, max: 6, step: 0.1, fmt: (v) => v.toFixed(1) },
  { id: 'keyAz', label: 'Key angle', min: -180, max: 180, step: 5, fmt: deg },
  { id: 'keyEl', label: 'Key height', min: 5, max: 90, step: 1, fmt: deg },
  { id: 'warmth', label: 'Key warmth', min: -1, max: 1, step: 0.05, fmt: (v) => (v > 0 ? `warm ${pct(v)}` : v < 0 ? `cool ${pct(-v)}` : 'as styled') },
  { id: 'fill', label: 'Fill light', min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) },
  { id: 'shadow', label: 'Shadows', min: 0, max: 1, step: 0.05, fmt: pct },
  { id: 'shadowSoft', label: 'Shadow softness', min: 0, max: 6, step: 0.25, fmt: (v) => v.toFixed(2) },
  { id: 'plate', label: 'Plate brightness', min: 0.2, max: 1.6, step: 0.05, fmt: pct },
  { id: 'occlusion', label: 'Occlusion', min: 0, max: 2, step: 0.05, fmt: pct },
  { id: 'foveation', label: 'Foveation', min: 0, max: 1, step: 0.05, fmt: pct },
  // Render resolution vs the headset's default; WebXR only takes it when a session starts.
  { id: 'resolution', label: 'Resolution (next XR entry)', min: 0.8, max: 1.6, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
];

/** Slider values a style implies. */
/**
 * The nearest rotation made of whole quarter turns: each axis of `q` rounded to the
 * nearest of ±X, ±Y, ±Z (largest component first, so the result is a proper rotation).
 */
function squareUp(q: Quaternion): Quaternion {
  const m = new Matrix4().makeRotationFromQuaternion(q).elements;
  const cols = [0, 1, 2].map((c) => new Vector3(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]));
  const out: Array<Vector3 | null> = [null, null, null];
  const usedAxes = new Set<number>();
  // Round the column with the most decisive component first.
  const order = [0, 1, 2].sort((a, b) => Math.max(...cols[b].toArray().map(Math.abs)) - Math.max(...cols[a].toArray().map(Math.abs)));
  for (const c of order.slice(0, 2)) {
    const v = cols[c].toArray();
    let best = -1;
    for (let k = 0; k < 3; k++) if (!usedAxes.has(k) && (best < 0 || Math.abs(v[k]) > Math.abs(v[best]))) best = k;
    usedAxes.add(best);
    const r = new Vector3();
    r.setComponent(best, Math.sign(v[best]) || 1);
    out[c] = r;
  }
  const missing = [0, 1, 2].find((c) => !out[c])!;
  const [a, b] = [(missing + 1) % 3, (missing + 2) % 3];
  out[missing] = new Vector3().crossVectors(out[a]!, out[b]!);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(out[0]!, out[1]!, out[2]!));
}

function styleValues(k: number): Record<string, number> {
  const st = STYLES[k];
  return {
    backdrop: st.backdropAmount,
    envStrength: st.envStrength,
    envTurn: st.envTurn,
    exposure: st.exposure,
    key: st.key.strength,
    keyAz: st.key.angle,
    keyEl: st.key.height,
    warmth: 0,
    fill: st.fill.strength,
    shadow: st.shadow,
    shadowSoft: st.softness,
    plate: 1,
    occlusion: 1,
    foveation: 1,
    resolution: 1.3,
  };
}
const LOOK_VERSION = 2; // bump when stored look settings stop meaning the same thing
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
type PanelId = 'wrist' | 'settings' | 'manual';
type FrameKind = 'platform' | 'shelf' | 'rack' | 'drum' | PanelId;

/** Where a block sits: a full transform in platform-local (unscaled) meters. */
interface Placement {
  m: Matrix4;
  target?: Placed; // kit ghost this placement fills
}

interface Placed extends Placement {
  part: number;
  color: number;
  finish: number;
  slot: number;
  batch: string;
  mi?: Matrix4;
  swing?: number; // radians turned about its hinge since it was placed
}

/** A hinged part being swung by a hand, with everything built onto it. */
interface Swing {
  rec: Placed; // the hinged part
  grabbed: Placed; // what the hand took hold of (it, or something built onto it)
  group: Placed[];
  start: Matrix4[]; // the group's transforms when the swing began
  pivot: Vector3; // platform-local
  axis: Vector3;
  u: Vector3; // in-plane directions the hand's angle is measured from
  w: Vector3;
  radius: number; // hand's distance from the axis at the grab
  along: number; // and along it
  prev: number;
  turned: number; // hand turn so far (unwrapped)
  angle0: number;
  step: number; // last 15° notch, for the ticks
  atLimit: boolean;
}

interface Batch {
  key: string; // `${part}|${finish}`
  entity: Entity;
  mesh: InstancedMesh;
  records: Placed[];
}

interface Loose {
  entity: Entity;
  mesh: Mesh;
  part: number;
  color: number;
  finish: number;
}

/** A box of your own build, as stored on this device (`stacker.boxes`). */
interface StoredBox {
  id: string;
  title: string;
  color: string;
  pieces: number;
  steps: KitBlock[][];
  photo: string; // data URL of the box-front photo
  at: string;
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
  joint: { pair: string; role: string; o: Vector3; mounts: Array<{ pair: string; m: Matrix4 }> } | null;
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
  owned: Array<{ dispose(): void }>; // GPU resources made for the current layout
  bar: Mesh;
  resize: Mesh | null;
}

interface UiItem {
  id: string;
  kind: 'button' | 'slider' | 'label';
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
  sig?: string; // what was last drawn (see drawUi)
  slot?: [InstancedMesh, number]; // swatches: their instance
}

type TargetKind = 'placed' | 'loose' | 'cell' | 'ui' | 'edge' | 'corner' | 'bar' | 'resize' | 'box' | 'tear' | 'pull' | 'camera' | 'spin' | 'prop';
type PropKind = 'jar' | 'tile' | 'prev' | 'next' | 'face';

interface Target {
  kind: TargetKind;
  placed?: Placed;
  loose?: Loose;
  ui?: UiItem;
  box?: KitBox;
  cubby?: { face: number; slot: number }; // a part in the shelf
  prop?: { type: PropKind; value: number }; // jars, sample tiles, shelf paging and signs
  corner?: number;
  frame?: FrameKind;
  obj?: Object3D;
  score: number;
}

interface HandState {
  hand: Hand;
  mode: 'none' | 'controller' | 'hand' | 'mouse'; // mouse: the desktop cursor, as the right hand
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
  pokeArmed: boolean; // fingertip came from in front of the panel (a poke has to arrive, not slide in)
  pinchGap: number; // thumb–index distance
  midGap: number; // thumb–middle distance
  closing: number; // seconds left of "fingers closing toward a pinch": aim is held still
  aimOrigin: Vector3; // hand: smoothed ray
  aimDir: Vector3;
  pinchRing: Mesh; // hand: shows how close the pinch is
  overTrash: boolean; // holding pieces over the library, where letting go removes them
  lost: number; // seconds this hand has been untracked while holding pieces
  recovering: boolean; // tracking came back mid-hold: re-read the pinch without firing it
  snapOk: boolean; // the landing shown for what this hand holds (committed on release)
  snapGen: number;
  snapPlatform: number;
  snapAt: Vector3;
  snapQ: Quaternion;
  snapShown: Placement[];
  snapCount: number;
  target: Target | null;
  targetFar: boolean;
  pieces: Piece[] | null;
  swing: Swing | null; // swinging a hinged part
  box: KitBox | null; // a kit box in hand
  tear: KitBox | null; // pulling this box's tear strip
  tearFrom: Vector3;
  holdButton: Btn | null;
  held: Set<Btn>; // buttons down right now (controllers and mouse)
  camera: boolean; // holding the box camera
  spin: { a0: number; drum0: number } | null; // turning the parts shelf by its cap
  dip: string | null; // the shelf prop the fingertip (or controller tip) is touching
  palm: Vector3; // world direction the palm faces (hands: from the joints; controllers: estimated)
  pulling: boolean; // holding the lamp's pull cord
  pullFrom: number; // world height where the pull started
  pullClicked: boolean; // this pull already clicked (let the cord back up to pull again)
  bArmed: boolean; // B/Y went down on a target: deletes on release unless it was used to select
  selectSweep: 'add' | 'remove' | null; // B/Y + trigger held: blocks swept over join (or leave) the selection
  fromSelection: boolean;
  rotTarget: Quaternion; // controller: where the held block's rotation is easing to
  aligned: boolean; // controller: the stick squared the held block to the platform's axes (wrist no longer turns it)
  alignQ: Quaternion; // its rotation in the platform's frame, whole quarter turns
  alignCur: Quaternion; // eases toward alignQ
  axes: LineSegments; // platform X/Y/Z guide on the held block while aligned
  turnRing: Mesh; // ring around the axis of the last turn
  turnShow: number; // seconds the ring stays up
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

interface KitState {
  id: string;
  title: string;
  steps: KitBlock[][];
  step: number;
  page: number;
  zoom: number; // manual page zoom level (index into MANUAL_ZOOM)
  di: number;
  dj: number;
  remaining: Array<{ rec: Placed; ghost: Entity }>;
  matched: Map<Placed, Placed>;
  stepPlaced: Placed[];
  spawned: Loose[];
}

const GRAB_BTNS: Btn[] = ['squeeze', 'trigger', 'pinch'];
const PAD_BUTTONS: Record<Hand, Array<[Btn, string]>> = {
  left: [
    ['squeeze', InputComponent.Squeeze],
    ['trigger', InputComponent.Trigger],
    ['a', InputComponent.X_Button],
    ['b', InputComponent.Y_Button],
  ],
  right: [
    ['squeeze', InputComponent.Squeeze],
    ['trigger', InputComponent.Trigger],
    ['a', InputComponent.A_Button],
    ['b', InputComponent.B_Button],
  ],
};
const DUP_BTNS: Btn[] = ['a', 'mid'];

export class StackerSystem extends createSystem({}) {
  private lib!: Library;
  private ready = false;
  private colors!: Color[];
  private matCache = new Map<string, Material>();
  private finish = 0; // finish for new blocks
  private style = 0;
  private advanced = false; // settings panel shows environment, tone and sliders
  private shadowDirty = true; // shadow map needs a redraw
  private envId = 'interior';
  private envTex: Texture | null = null;
  private envCache = new Map<string, Texture>();
  private envLoading = new Set<string>();
  private backdrop!: Mesh;
  private plateMat!: MeshStandardMaterial;
  private handleMat!: MeshStandardMaterial;
  private cornerMat!: MeshStandardMaterial;
  private edgeGeos = new Map<number, BufferGeometry>();
  private ghostLineMat!: LineBasicMaterial;
  private ghostLitMat!: LineBasicMaterial;
  private stepLineMat!: LineBasicMaterial;
  private built: Entity[] = [];
  private time = 0;

  // Look & render
  private visual: Record<string, number> = styleValues(0);
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
  private editGen = 0; // bumps on every change to the placed blocks
  private platformGen = 0; // bumps when the platform moves, scales or resizes (snap results are platform-local)
  private shadowFitGen = -1;
  private buildBoxGen = -1;
  private buildMin = new Vector3(); // bounds of everything placed, platform-local
  private buildMax = new Vector3();
  private levelAnim: { from: Quaternion; to: Quaternion; t: number } | null = null;
  // Both hands on the platform: it follows their midpoint, turns about up as they turn
  // around each other, and scales with the distance between them, like a map.
  private twoHand: { a: HandState; b: HandState; mid0: Vector3; pos0: Vector3; quat0: Quaternion; scale0: number; dist0: number; yaw0: number; step: number } | null = null;
  private twoHandLine!: Line;
  // The pull-cord lamp: dimLevel indexes DIM_LEVELS; dimNow eases toward it and scales the lights.
  private lamp!: PullLamp;
  private dimLevel = 0;
  private dimNow = 1;

  // Panels
  private panels: Panel[] = [];
  private drum!: PartDrum;
  private facePage = FACES.map(() => 0);
  private faceEntryCache = new Map<number, number[]>();
  private shelfFront = -1; // face the previews were last shown for
  private shelfSpinTick = 0;
  private wrist!: Panel;
  private wristOpen = 0; // 0–1, eased
  private wristPinned = false; // tests and the desktop: docked by the shelf, always open
  private controlsOpen = false;
  private settings!: Panel;
  private manual: Panel | null = null;
  private color = 0;
  private slot = 0;
  private statsCanvas: HTMLCanvasElement | null = null;
  private statsTex: CanvasTexture | null = null;
  // Manual pages: drawn like a paper instruction booklet, models rendered flat and isometric.
  private pageCanvas: HTMLCanvasElement | null = null;
  private pageTex: CanvasTexture | null = null;
  private painter: ManualPainter | null = null;

  // Kit shelf
  private shelf: Entity | null = null;
  private shelfBar: Object3D | null = null;
  private shelfCanvas!: HTMLCanvasElement;
  private shelfTex!: CanvasTexture;
  private shelfItems: Array<{ block: Loose; pos: Vector3 }> = [];
  private shelfParts: Entity[] = [];
  private shelfAt: { pos: Vector3; yaw: number } | null = null; // where the next shelf goes (an opened box)

  // Kit boxes
  private rack: Entity | null = null;
  private rackBar: Object3D | null = null;
  private boxes: KitBox[] = [];
  // Boxes of your own builds (top tier of the rack), newest first; stored on this device.
  private myBoxes: StoredBox[] = [];
  private boxEntities = new Map<KitBox, Entity>();
  private rackHint: Mesh | null = null;
  private shutterArmed = false;
  private snapCam: SnapCamera | null = null;
  private viewArt: ArtRenderer | null = null; // the camera's viewfinder renderer, while it's held
  private viewGroup: Group | null = null;
  private viewGen = -1;
  private viewFrame = 0;
  private kitData = new Map<string, Promise<KitBlock[][]>>();

  // Tools & state
  private tool: Tool = 'build';
  private selection = new Set<Placed>();
  private selOutlines: Mesh[] = [];
  private kit: KitState | null = null;
  private loose: Loose[] = [];
  private poofs: Array<{ entity: Entity; t: number }> = [];
  private snaps: Array<{ block: Loose; rec: Placed; fromPos: Vector3; fromQuat: Quaternion; t: number }> = [];
  private hands!: HandState[];
  private frameDelta = 0;
  // Undo: snapshots of the placed blocks and plate, taken whenever an edit settles.
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private stable = ''; // the last settled state
  private edited = false;
  private armed: { id: string; at: number } | null = null; // a destructive button waiting for its confirming tap
  private desktop!: DesktopControls;
  private dirty = false;
  private visualDirty = false;
  private saveTimer = 0;
  private builtForXR = false;
  private recenterDelay = -1;
  private snapOut: Placement[] = [];
  private swingM = new Matrix4();
  private contactGen = -1; // editGen/platformGen the occupancy grid was built for
  private contactPlate = -1;

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
  private q3 = new Quaternion();
  private q4 = new Quaternion();
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

    if (import.meta.env.DEV) Object.assign(window, { stacker: this, stackerContact: CONTACT });

    for (const hand of HANDS) {
      this.input.xr.multiPointers[hand].toggleSubPointer('ray', false);
      this.input.xr.multiPointers[hand].toggleSubPointer('touch', false);
    }
    this.createLights();
    // Before anything loads: a session can start while parts are still downloading.
    const look = this.readStore('stacker.look') as { visual?: Record<string, number> } | null;
    this.renderer.xr.setFramebufferScaleFactor(look?.visual?.resolution ?? styleValues(0).resolution);

    const onSessionStart = () => {
      this.renderer.xr.setFoveation(this.visual.foveation);
      const session = this.renderer.xr.getSession();
      if (session && typeof XRWebGLLayer !== 'undefined') {
        console.info(`[stacker] framebuffer scale ${this.visual.resolution} (native ${XRWebGLLayer.getNativeFramebufferScaleFactor(session)})`);
      }
      const rates = session?.supportedFrameRates;
      if (session && rates && Array.from(rates).includes(120)) {
        void session.updateTargetFrameRate(120).then(() => this.redrawUi());
      }
    };
    this.renderer.xr.addEventListener('sessionstart', onSessionStart);
    // The next session picks up a resolution changed while this one ran.
    const onSessionEnd = () => this.renderer.xr.setFramebufferScaleFactor(this.visual.resolution);
    this.renderer.xr.addEventListener('sessionend', onSessionEnd);
    this.cleanupFuncs.push(() => this.renderer.xr.removeEventListener('sessionend', onSessionEnd));

    this.desktop = new DesktopControls(this.renderer.domElement);
    const onDesktop = (ev: Event) => {
      this.desktop.enabled = (ev as CustomEvent<boolean>).detail;
      if (!this.ready) return;
      if (this.desktop.enabled) {
        const r = this.root.object3D!;
        this.placeDefault(r.position.clone(), this.yawOf(r.quaternion));
        this.frameCamera();
        this.builtForXR = false; // re-place everything around the head on the next XR entry
      } else this.desktop.setCursor('');
      this.applyVisuals();
    };
    window.addEventListener('stacker:desktop', onDesktop);
    this.cleanupFuncs.push(
      () => window.removeEventListener('stacker:desktop', onDesktop),
      () => this.desktop.dispose(),
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
      const stored = this.readStore('stacker.look') as {
        version?: number;
        style?: number;
        visual?: Record<string, number>;
        tone?: number;
        env?: string;
        finish?: number;
        instructions?: Instructions;
        dim?: number;
      } | null;
      // Looks saved before the lighting rework (v2) don't carry over; keep only the guide mode.
      const v = stored?.version === LOOK_VERSION ? stored : { instructions: stored?.instructions };
      this.style = Math.min(STYLES.length - 1, v?.style ?? 0);
      this.visual = { ...styleValues(this.style), ...(v?.visual ?? {}) };
      this.tone = v?.tone ?? STYLES[this.style].tone;
      this.envId = v?.env ?? STYLES[this.style].env;
      this.finish = v?.finish ?? 0;
      this.instructions = v?.instructions ?? 'ghosts';
      this.dimLevel = Math.max(0, Math.min(DIM_LEVELS.length - 1, stored?.dim ?? 0));
      this.dimNow = DIM_LEVELS[this.dimLevel];
      this.backdrop = makeBackdrop();
      this.world.createTransformEntity(this.backdrop, { persistent: true });
      this.buildConnTables();
      this.hands = HANDS.map((hand) => this.createHand(hand));
      const twoGeo = new BufferGeometry();
      twoGeo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
      this.twoHandLine = new Line(twoGeo, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false }));
      this.twoHandLine.frustumCulled = false;
      this.twoHandLine.renderOrder = 21;
      this.twoHandLine.visible = false;
      this.world.createTransformEntity(this.twoHandLine, { persistent: true });
      this.buildPlatform();
      const tile = this.lib.geometries[this.lib.byId.get('3003') ?? 0];
      this.drum = new PartDrum(this.lib.colors.length, FINISHES.length, tile);
      this.track(this.world.createTransformEntity(this.drum.root));
      this.wrist = this.createPanel('wrist', 0.24, 0.12, false);
      this.wrist.bar.visible = false;
      this.settings = this.createPanel('settings', 0.46, 0.57, false);
      this.setEnv(this.envId);
      this.fillPartsShelf();
      this.layoutWrist();
      this.layoutSettings();
      this.placeDefault(new Vector3(0, 0.8, -0.5), 0);
      const saved = this.readStore('stacker.autosave');
      if (saved) this.deserialize(saved);
      this.stable = this.snapshot();
      this.edited = false;
      this.buildRack();
      this.lamp = new PullLamp();
      this.lamp.setGlow(this.dimNow);
      this.track(this.world.createTransformEntity(this.lamp.group));
      this.applyVisuals();
      this.ready = true;
      if (this.desktop.enabled) this.frameCamera();
      progress(1, 'Ready');
      window.dispatchEvent(new Event('stacker:ready'));
    }).catch((err: unknown) => {
      console.error(err);
      progress(0, "Couldn't load the parts. Check your connection and reload.");
    });
  }

  update(delta: number): void {
    if (!this.ready) return;
    this.time += delta;
    this.frameDelta = delta;
    this.updateDesktop();
    // Keep our reflection environment in place (IWSDK's own IBL may reassert itself).
    if (this.envTex && this.scene.environment !== this.envTex) this.scene.environment = this.envTex;
    if (this.scene.environmentIntensity !== this.visual.envStrength * this.dimNow) this.scene.environmentIntensity = this.visual.envStrength * this.dimNow;
    this.ghostLineMat.opacity = 0.55 + 0.4 * Math.sin(this.time * 5);
    this.tickStats(delta);

    if (this.recenterDelay >= 0) {
      this.recenterDelay -= delta;
      if (this.recenterDelay < 0) this.recenter();
    }
    let trash = false;
    for (const h of this.hands) {
      this.updateHand(h, delta);
      trash ||= (!!h.pieces && h.overTrash) || (!!h.box?.kit.mine && this.overLibrary(h.box.mesh.position));
    }
    this.tickTwoHand(delta);
    this.tickLamp(delta);
    this.tickCamera(delta);
    // The library turns red while a held block is over it: letting go removes it.
    this.drum.frameMat.color.setHex(trash ? 0xe25c5c : 0xf1f2f4);
    let hot = false;
    for (const h of this.hands) hot ||= h.frame === 'platform' || h.target?.kind === 'edge' || h.target?.kind === 'corner';
    this.handleMat.opacity = this.cornerMat.opacity = hot ? 1 : HANDLE_IDLE;
    this.tickSnaps(delta);
    this.updateContact();
    this.tickBoxes(delta);
    this.tickPoofs(delta);
    this.tickLevel(delta);
    this.settleUndo();
    if (this.shadowFitGen !== this.editGen && !this.busy()) {
      this.shadowFitGen = this.editGen;
      this.aimKeyLight(); // the shadow frustum covers the build's height
    }
    if (this.armed && this.time - this.armed.at > 3) {
      this.armed = null;
      this.redrawUi();
    }
    this.tickShelf(delta);
    this.tickWrist(delta);
    this.updateSelectionOutlines();
    // Redraw shadows only while something that casts them moves, or after a change —
    // last, so everything this frame changed is in.
    let moving = this.shadowDirty || this.snaps.length > 0 || this.poofs.length > 0;
    for (const h of this.hands) moving ||= !!h.pieces || !!h.box || !!h.frame || !!h.swing;
    if (moving) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.saveTimer += delta;
    if (this.saveTimer > 1) {
      if (this.dirty && !this.busy()) this.writeStore('stacker.autosave', this.serialize());
      if (this.visualDirty) {
        this.writeStore('stacker.look', {
          version: LOOK_VERSION,
          style: this.style,
          visual: this.visual,
          tone: this.tone,
          env: this.envId,
          finish: this.finish,
          instructions: this.instructions,
          dim: this.dimLevel,
        });
      }
      if (!this.busy()) this.dirty = false;
      this.visualDirty = false;
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
    // Shadows are redrawn only when something changes (see update()).
    this.renderer.shadowMap.autoUpdate = false;
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
    this.platformGen++;
    this.fitShadow(dist);
  }

  /**
   * Fit the shadow camera tightly around the plate, and size the map so the chosen
   * softness is a few texels of blur (PCF bands past ~4 texels). Soft looks get a
   * smaller, cheaper map; crisp looks get up to 2048².
   */
  private fitShadow(dist: number): void {
    const P = dims.pitch * this.scale;
    const { x0, x1, z0, z1 } = this.bounds;
    // A sphere around the plate center holding the plate and everything built on it.
    const height = this.buildBox() ? Math.max(0, this.buildMax.y) * this.scale : 0;
    const r = Math.hypot(0.5 * Math.hypot((x1 - x0) * P, (z1 - z0) * P), height) + 0.02 * this.scale;
    const blur = Math.max(0.3, this.visual.shadowSoft) * 0.0012 * this.scale; // meters of penumbra
    const size = Math.min(2048, Math.max(512, 2 ** Math.round(Math.log2((2 * r * 3) / blur))));
    const shadow = this.keyLight.shadow;
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size);
      shadow.map?.dispose();
      shadow.map = null;
    }
    const texel = (2 * r) / size;
    shadow.radius = Math.min(4, blur / texel);
    shadow.normalBias = texel * 1.5;
    const cam = shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = Math.max(0.01, dist - 2 * r);
    cam.far = dist + 2 * r;
    cam.updateProjectionMatrix();
    this.shadowDirty = true;
  }

  /**
   * The material for a finish and color (color null = white, tinted per instance for
   * placed blocks). See-through palette colors are shown as clear plastic.
   */
  private matFor(finish: number, color: number | null): Material {
    const f = color === null ? finish : this.shownFinish(finish, color);
    const key = `${f}|${color ?? '*'}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = makeFinish(FINISHES[f], color === null ? null : this.colors[color]);
      this.matCache.set(key, m);
    }
    return m;
  }

  /** The finish a block actually renders with (see-through colors become clear plastic). */
  private shownFinish(finish: number, color: number): number {
    return this.lib.isTrans(color) && !FINISHES[finish].trans ? finishIndex('clear') : finish;
  }

  private isSeeThrough(finish: number, color: number): boolean {
    return !!FINISHES[this.shownFinish(finish, color)].trans;
  }

  /** Pick an art direction: environment, backdrop, lights, camera, plate, block overrides. */
  private applyStyle(k: number): void {
    this.style = k;
    const st = STYLES[k];
    this.visual = { ...styleValues(k), size: this.scale };
    this.tone = st.tone;
    this.setEnv(st.env);
    this.applyVisuals();
    this.visualDirty = true;
    this.redrawUi();
  }

  private setEnv(id: string): void {
    id = envId(id);
    this.envId = id;
    const env = ENVS.find((e) => e.id === id)!;
    // The HDRI once it's in; until then (or for procedural envs) the scene of the same id.
    let tex = this.envCache.get(id) ?? this.envCache.get(`${id}:procedural`);
    if (!tex) {
      const pmrem = new PMREMGenerator(this.renderer);
      tex = pmrem.fromScene(makeEnvScene(id), 0.04).texture;
      pmrem.dispose();
      this.envCache.set(env.hdr ? `${id}:procedural` : id, tex);
    }
    this.envTex = tex;
    this.scene.environment = tex;
    this.visualDirty = true;
    if (env.hdr && !this.envCache.has(id) && !this.envLoading.has(id)) {
      this.envLoading.add(id);
      new HDRLoader().load(
        `${import.meta.env.BASE_URL}env/${env.hdr}.hdr`,
        (hdr) => {
          const pmrem = new PMREMGenerator(this.renderer);
          const t = pmrem.fromEquirectangular(hdr).texture;
          pmrem.dispose();
          hdr.dispose();
          this.envLoading.delete(id);
          this.envCache.set(id, t);
          if (this.envId === id) {
            this.envTex = t;
            this.scene.environment = t;
          }
        },
        undefined,
        (err) => {
          this.envLoading.delete(id);
          console.warn(`Environment ${env.hdr} failed to load`, err);
        },
      );
    }
  }

  /** Push the style plus slider tweaks into lights, environment, backdrop, plate and renderer. */
  private applyVisuals(): void {
    const v = this.visual;
    const st = STYLES[this.style];
    this.renderer.toneMapping = TONES[this.tone][1];
    this.renderer.toneMappingExposure = v.exposure;
    this.keyLight.intensity = v.key * this.dimNow;
    this.keyLight.color.set(st.key.color).lerp(new Color(v.warmth >= 0 ? 0xffc88a : 0xbcd4ff), Math.abs(v.warmth));
    this.hemi.color.set(st.fill.sky);
    this.hemi.groundColor.set(st.fill.ground);
    this.hemi.intensity = v.fill * this.dimNow;
    const shadows = v.shadow > 0;
    this.keyLight.castShadow = shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.keyLight.shadow.intensity = v.shadow;
    this.scene.environmentRotation.set(0, (v.envTurn * Math.PI) / 180, 0);
    // three ignores material.envMapIntensity for scene.environment; this is the one dial.
    this.scene.environmentIntensity = v.envStrength * this.dimNow;
    paintBackdrop(this.backdrop, st.backdrop[0], st.backdrop[1]);
    // No passthrough on a desktop: the backdrop stands in for the room.
    const backdrop = this.desktop.enabled && !this.renderer.xr.isPresenting ? 1 : v.backdrop;
    (this.backdrop.material as MeshBasicMaterial).opacity = backdrop;
    this.backdrop.visible = backdrop > 0.01;
    if (this.plateMat) {
      this.plateMat.color.set(st.plate).multiplyScalar(v.plate);
    }
    OCCLUSION.value = v.occlusion;
    if (this.renderer.xr.isPresenting) this.renderer.xr.setFoveation(v.foveation);
    else this.renderer.xr.setFramebufferScaleFactor(v.resolution);
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
    // Occlusion like the parts, contact occlusion from the blocks on it.
    this.plateMat = patchBlockShader(new MeshStandardMaterial({ color: 0x237841, roughness: 0.5 }), 'plastic', true);
    this.slab = new Mesh(new BoxGeometry(1, 1, 1), this.plateMat);
    this.slab.name = 'Baseplate';
    this.slab.receiveShadow = true;
    this.child(this.root, this.slab);
    this.plateStuds = new InstancedMesh(studGeometry(), this.plateMat, MAX_STUDS * MAX_STUDS);
    this.plateStuds.frustumCulled = false;
    this.plateStuds.receiveShadow = true;
    this.child(this.root, this.plateStuds);

    const handleMat = (this.handleMat = new MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, transparent: true, opacity: HANDLE_IDLE }));
    const cornerMat = (this.cornerMat = new MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.4, transparent: true, opacity: HANDLE_IDLE }));
    const edgeGeo = new CapsuleGeometry(0.0045, 0.06, 4, 10);
    for (let k = 0; k < 4; k++) {
      const edge = new Mesh(edgeGeo, handleMat);
      edge.name = 'EdgeHandle';
      this.child(this.root, edge);
      this.edges.push(edge);
    }
    const cornerGeo = new SphereGeometry(0.0065, 16, 12);
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
    const { x0, x1, z0, z1 } = this.bounds;
    let k = 0;
    for (let i = x0; i < x1; i++) {
      for (let j = z0; j < z1; j++) {
        this.m1.makeTranslation((i + 0.5) * P, 0, (j + 0.5) * P);
        this.plateStuds.setMatrixAt(k++, this.m1);
      }
    }
    this.plateStuds.count = k;
    this.plateStuds.instanceMatrix.needsUpdate = true;
    this.layoutPlateHandles();
    this.dirty = this.shadowDirty = this.edited = true;
  }

  /** The slab's thickness and the edge/corner handles, which stay the same real size at any scale. */
  private layoutPlateHandles(): void {
    const P = dims.pitch;
    const s = this.scale;
    const { x0, x1, z0, z1 } = this.bounds;
    const cx = ((x0 + x1) / 2) * P;
    const cz = ((z0 + z1) / 2) * P;
    this.slab.scale.set((x1 - x0) * P, PLATE_T / s, (z1 - z0) * P);
    this.slab.position.set(cx, -PLATE_T / s / 2, cz);
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
    if (this.desktop.enabled && !this.renderer.xr.isPresenting) {
      // Desktop: panels stand upright behind the plate's sides, facing a camera out front.
      place(this.drum.root, x0 * P - 0.36, -0.06, z0 * P + 0.1, 0.35, 0);
      place(this.wrist.entity.object3D!, x0 * P - 0.08, 0.36, z0 * P + 0.08, 0.3, 0);
      place(this.settings.entity.object3D!, x1 * P + 0.28, this.settings.h / 2 - 0.02, z0 * P + 0.02, -0.3, 0);
      if (this.manual) place(this.manual.entity.object3D!, x1 * P + 0.22, 0.29, zc + 0.12, -0.7, -0.2);
    } else {
      // The shelf's front face turns toward where you stand (0.45 m in front of the plate's center).
      const sx = x0 * P - 0.34;
      place(this.drum.root, sx, -0.06, zc + 0.04, Math.atan2(((x0 + x1) / 2) * P - sx, 0.41), 0);
      place(this.settings.entity.object3D!, x0 * P - 0.74, 0.2 + (0.57 - this.settings.h) / 2, zc + 0.32, 1.1, -0.25);
      place(this.wrist.entity.object3D!, x0 * P - 0.12, 0.2, zc + 0.24, 0.6, -0.3); // docked spot (pinned / tests)
      if (this.manual) place(this.manual.entity.object3D!, x1 * P + 0.2, 0.3, zc - 0.1, -0.55, -0.3);
    }
    if (this.shelf) this.placeShelf();
    this.placeRack();
    // The lamp hangs up and to the right, its bead a little above head height.
    const xc = ((x0 + x1) / 2) * P;
    if (this.lamp && this.desktop.enabled && !this.renderer.xr.isPresenting) place(this.lamp.group, xc + 0.3, 0.5, z0 * P - 0.15, 0, 0);
    else if (this.lamp) place(this.lamp.group, xc + 0.24, 0.95, z1 * P + 0.18, 0, 0);
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
      new MeshBasicMaterial({ color: PANEL_BG }),
    );
    bg.name = `Panel:${id}`;
    const holder = new Object3D();
    const entity = this.track(this.world.createTransformEntity(holder));
    this.child(entity, bg);
    const bar = new Mesh(
      new CapsuleGeometry(0.005, 0.08, 4, 10).rotateZ(Math.PI / 2),
      new MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 }),
    );
    bar.name = 'PanelHandle';
    this.child(entity, bar);
    let resize: Mesh | null = null;
    if (resizable) {
      resize = new Mesh(new SphereGeometry(0.007, 16, 12), new MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.4 }));
      resize.name = 'PanelResize';
      this.child(entity, resize);
    }
    const panel: Panel = { id, entity, bg, w, h, items: [], content: [], owned: [], bar, resize };
    this.panels.push(panel);
    this.sizePanel(panel);
    return panel;
  }

  private sizePanel(p: Panel): void {
    p.bg.scale.set(p.w, p.h, 0.008);
    p.bar.position.set(0, -p.h / 2 - 0.016, 0.006);
    p.resize?.position.set(p.w / 2 + 0.008, -p.h / 2 - 0.008, 0.006);
  }

  private clearPanel(p: Panel): void {
    // Hands pointing at items about to go away let go of them.
    for (const h of this.hands ?? []) {
      if (h.target?.ui?.panel === p) h.target = null;
      if (h.slider?.panel === p) {
        h.slider = null;
        h.holdButton = null;
      }
    }
    // entity.destroy() doesn't free GPU buffers; shared part geometry and block
    // materials must survive, so only what this layout made is disposed.
    for (const r of p.owned) r.dispose();
    for (const e of p.content) e.destroy();
    const gone = new Set(p.content);
    this.built = this.built.filter((e) => !gone.has(e));
    p.items = [];
    p.content = [];
    p.owned = [];
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
    p.owned.push(tex, mesh.geometry, mesh.material as Material);
    mesh.position.set(x, y, 0.001);
    this.addContent(p, mesh);
    const item: UiItem = { id, kind, value, x, y, w, h, mesh, panel: p, canvas, tex, hover: false };
    p.items.push(item);
    this.drawUi(item);
    return item;
  }

  /** The wrist menu: tools, undo/redo, selection, save slots, and kit controls during a kit. */
  private layoutWrist(): void {
    const p = this.wrist;
    this.clearPanel(p);
    const rows: string[][] = [
      ['tool:build', 'tool:select', 'tool:paint'],
      ['undo', 'redo', 'deselect'],
      ['slot:prev', 'slot', 'slot:next'],
      ['save', 'load'],
    ];
    if (this.kit) rows.push(['kit:exit', 'kit:restart', 'kit:skip']);
    const rh = 0.024;
    const h = rows.length * (rh + GAP) - GAP + 2 * MARGIN;
    if (Math.abs(h - p.h) > 1e-4) {
      p.h = h;
      this.sizePanel(p);
    }
    const left = -p.w / 2 + MARGIN;
    const inner = p.w - 2 * MARGIN;
    let y = p.h / 2 - MARGIN;
    for (const ids of rows) {
      const wts = ids.map((id) => (id === 'slot' ? 2.4 : id.startsWith('slot:') ? 0.6 : 1));
      const unit = (inner - (ids.length - 1) * GAP) / wts.reduce((a, b) => a + b, 0);
      let x = left;
      ids.forEach((id, k) => {
        const w = unit * wts[k];
        this.addUi(p, id, id === 'slot' ? 'label' : 'button', 0, x + w / 2, y - rh / 2, w, rh);
        x += w + GAP;
      });
      y -= rh + GAP;
    }
  }

  /**
   * Wrist menu: open while the left palm faces up (hands: from the joints; controllers: the
   * controller rolled palm-up), floating just above the wrist and facing you. Docked by the
   * shelf and always open on the desktop or when pinned.
   */
  private tickWrist(delta: number): void {
    const obj = this.wrist.entity.object3D!;
    const docked = this.wristPinned || (this.desktop.enabled && !this.renderer.xr.isPresenting);
    if (docked) {
      obj.visible = true;
      obj.scale.setScalar(1);
      this.wristOpen = 1;
      return;
    }
    const h = this.hands[0];
    const head = this.player.head.getWorldPosition(this.v5);
    const at = this.v6.copy(h.mode === 'hand' ? h.point : h.rayOrigin);
    const up = h.palm.dot(this.up);
    const near = at.distanceTo(head) < 0.75;
    const busy = !!(h.pieces || h.frame || h.box || h.camera || h.spin || h.swing);
    const want = h.mode !== 'none' && near && !busy && up > (this.wristOpen > 0.5 ? 0.3 : 0.6);
    this.wristOpen = Math.max(0, Math.min(1, this.wristOpen + (want ? delta : -delta) / 0.15));
    obj.visible = this.wristOpen > 0.02;
    if (!obj.visible) return;
    // Above the wrist, nudged toward your eyes, facing you.
    const toHead = this.v3.copy(head).sub(at).normalize();
    obj.position.copy(at).addScaledVector(this.up, 0.1).addScaledVector(toHead, 0.04);
    obj.lookAt(head);
    obj.scale.setScalar(0.4 + 0.6 * this.wristOpen);
    obj.updateMatrixWorld(true);
  }

  // ---- parts shelf

  /** Face k's cubby contents in order: minifig presets (as −1 − preset), then parts by tab. */
  private faceEntries(k: number): number[] {
    let out = this.faceEntryCache.get(k);
    if (!out) {
      out = [];
      for (const tab of FACES[k].tabs) {
        if (tab === 'Minifigs') this.lib.minifigs.presets.forEach((_, i) => out!.push(-1 - i));
        else this.lib.parts.forEach((p, i) => p.tab === tab && out!.push(i));
      }
      this.faceEntryCache.set(k, out);
    }
    return out;
  }

  private facePages(k: number): number {
    return Math.max(1, Math.ceil(this.faceEntries(k).length / PER_FACE));
  }

  /** What's in cubby `slot` of face k on its current page: a part (≥ 0), a figure (< −0), or null. */
  private cubbyEntry(k: number, slot: number): number | null {
    return this.faceEntries(k)[this.facePage[k] * PER_FACE + slot] ?? null;
  }

  /** Put face k's parts in its cubbies (shown only on faces turned toward you). */
  private fillFace(k: number): void {
    const face = this.drum.faces[k];
    const show = Math.abs(this.drum.faceAngle(k)) < 1.75;
    const names: string[] = [];
    face.previews.forEach((mesh, slot) => {
      const entry = this.cubbyEntry(k, slot);
      if (entry === null) {
        mesh.visible = false;
        names.push('');
        return;
      }
      const fig = entry < 0 ? -1 - entry : -1;
      const part = fig >= 0 ? (this.lib.byId.get('973c01') ?? 0) : entry;
      const def = this.lib.parts[part];
      mesh.geometry = this.lib.geometries[part];
      const extent = Math.max(def.w * dims.pitch, def.d * dims.pitch, def.h * dims.unit);
      mesh.scale.setScalar(Math.min(3, CUBBY_FIT / extent));
      mesh.material = this.matFor(this.finish, fig >= 0 ? this.colorOf(this.lib.minifigs.presets[fig].torso) : this.color);
      mesh.quaternion.setFromEuler(this.euler.set(0.45, -0.6, 0, 'XYZ'));
      mesh.visible = show;
      names.push(fig >= 0 ? this.lib.minifigs.presets[fig].name : this.shortName(def.name));
    });
    this.drum.drawFace(k, names, this.facePage[k], this.facePages(k), Math.abs(this.drum.faceAngle(k)) < 0.4);
  }

  /** Every face, jar and sample tile in the current color and finish. */
  private fillPartsShelf(): void {
    for (let k = 0; k < FACES.length; k++) this.fillFace(k);
    this.shelfFront = this.drum.frontFace();
    for (const jar of this.drum.jars) {
      jar.paint.material = this.matFor(0, jar.color);
      const on = jar.color === this.color;
      jar.ring.visible = on;
      jar.group.position.y = 0.024 + (on ? 0.008 : 0);
    }
    for (const t of this.drum.tiles) {
      t.brick.material = this.matFor(t.finish, this.color);
      t.group.position.y = 0.024 + (t.finish === this.finish ? 0.008 : 0);
      t.brick.scale.setScalar(1.4);
    }
  }

  /** Each frame: ease the drum to its face (ticking past faces), refresh what's shown, turn the hovered part. */
  private tickShelf(delta: number): void {
    const d = this.drum;
    if (!this.hands.some((h) => h.spin)) d.angle += (d.target - d.angle) * (1 - Math.exp(-delta * 12));
    d.drum.rotation.y = d.angle;
    const tick = Math.round(d.angle / FACE_STEP);
    if (tick !== this.shelfSpinTick) {
      this.shelfSpinTick = tick;
      this.tick(0.15);
      this.uiTick();
    }
    if (d.frontFace() !== this.shelfFront) {
      this.shelfFront = d.frontFace();
      for (let k = 0; k < FACES.length; k++) this.fillFace(k);
    }
    const hovered = this.hands.map((h) => (h.target?.kind === 'cell' && h.target.cubby ? (h.target.obj as Mesh) : null)).find((m) => m) ?? null;
    if (d.hover && d.hover !== hovered) d.hover.quaternion.setFromEuler(this.euler.set(0.45, -0.6, 0, 'XYZ'));
    d.hover = hovered;
    if (hovered) hovered.rotateOnWorldAxis(this.up, delta * 1.2);
  }

  /** Angle of a world point around the drum's axis (the same sense faces are laid out in). */
  private drumAngleOf(p: Vector3): number {
    const lo = this.drum.root.worldToLocal(this.v3.copy(p));
    return Math.atan2(lo.x, lo.z);
  }

  private spinDrum(h: HandState): void {
    const a = this.drumAngleOf(this.grabPoint(h));
    let da = a - h.spin!.a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.drum.angle = h.spin!.drum0 + da;
    this.drum.target = this.drum.angle;
  }

  private releaseSpin(h: HandState): void {
    h.spin = null;
    h.holdButton = null;
    this.drum.target = Math.round(this.drum.angle / FACE_STEP) * FACE_STEP;
  }

  /** A jar, sample tile, page arrow or side sign: pressed by a grab, a ray press, or a touch. */
  private pressProp(prop: { type: PropKind; value: number }): void {
    switch (prop.type) {
      case 'jar':
        this.selectColor(prop.value);
        if (this.selection.size) this.recolor([...this.selection], prop.value);
        try {
          this.beep(520, 0, 0.06, 'sine', 0.06);
          this.beep(780, 0.04, 0.05, 'sine', 0.04);
        } catch {
          // audio is best-effort
        }
        break;
      case 'tile':
        this.finish = prop.value;
        this.visualDirty = true;
        if (this.selection.size) for (const rec of [...this.selection]) this.recolor([rec], rec.color, prop.value);
        this.fillPartsShelf();
        this.uiTick();
        break;
      case 'prev':
      case 'next': {
        const k = prop.value;
        const page = this.facePage[k] + (prop.type === 'next' ? 1 : -1);
        if (page < 0 || page >= this.facePages(k)) return;
        this.facePage[k] = page;
        this.fillFace(k);
        this.uiTick();
        break;
      }
      case 'face':
        this.drum.target = this.drum.angle - this.drum.faceAngle(prop.value);
        break;
    }
    this.tick(0.25);
  }

  /** Fingertip (or controller tip) dipped into a jar, or touching a tile, arrow or sign. */
  private touchShelf(h: HandState): void {
    const tip = h.mode === 'hand' ? (h.hasTip ? h.indexTip : null) : h.mode === 'controller' ? h.point : null;
    let key: string | null = null;
    let prop: { type: PropKind; value: number } | null = null;
    if (tip && this.drum.root.visible) {
      for (const jar of this.drum.jars) {
        const lo = jar.group.worldToLocal(this.v3.copy(tip));
        if (Math.hypot(lo.x, lo.z) < JAR_R + 0.004 && lo.y > -0.002 && lo.y < JAR_H + 0.006) {
          key = `jar:${jar.color}`;
          prop = { type: 'jar', value: jar.color };
          break;
        }
      }
      if (!key) {
        for (const t of this.drum.tiles) {
          const lo = t.group.worldToLocal(this.v3.copy(tip));
          if (Math.abs(lo.x) < 0.02 && Math.abs(lo.z) < 0.02 && lo.y > 0 && lo.y < 0.03) {
            key = `tile:${t.finish}`;
            prop = { type: 'tile', value: t.finish };
            break;
          }
        }
      }
      if (!key && h.mode === 'hand') {
        const k = this.drum.frontFace();
        const f = this.drum.faces[k];
        for (const [obj, type] of [[f.prev, 'prev'], [f.next, 'next']] as const) {
          const lo = obj.worldToLocal(this.v3.copy(tip));
          if (Math.abs(lo.x) < 0.02 && Math.abs(lo.y) < 0.012 && Math.abs(lo.z) < 0.008) {
            key = `${type}:${k}`;
            prop = { type, value: k };
          }
        }
      }
    }
    if (key !== h.dip) {
      h.dip = key;
      if (prop) this.pressProp(prop);
    }
  }

  /** Shelf targets: cubbies and paging on the faces toward you, side signs, caps (spin), jars, tiles, the handle. */
  private shelfTargets(h: HandState, far: boolean, limit: number, best: Target | null): Target | null {
    const d = this.drum;
    if (!d.root.visible) return best;
    const sb = this.probeObject(h, d.bar, 0.05, 0.011, 0.011, far);
    if (sb < limit) best = this.consider(best, { kind: 'bar', frame: 'drum', obj: d.bar, score: sb });
    for (let k = 0; k < FACES.length; k++) {
      const turn = Math.abs(d.faceAngle(k));
      const face = d.faces[k];
      if (turn < 0.6) {
        for (let slot = 0; slot < PER_FACE; slot++) {
          if (this.cubbyEntry(k, slot) === null) continue;
          const [x, y] = cubbyCenter(slot);
          const sc = this.probeLocal(h, face.group, x, y, -0.025, CUBBY_W / 2, CUBBY_H / 2, 0.025, far);
          if (sc < limit) best = this.consider(best, { kind: 'cell', cubby: { face: k, slot }, obj: face.previews[slot], score: sc });
        }
        if (far) {
          for (const [obj, type] of [[face.prev, 'prev'], [face.next, 'next']] as const) {
            const sc = this.probeMesh(h, obj, far);
            if (sc < limit) best = this.consider(best, { kind: 'prop', prop: { type, value: k }, obj, score: sc });
          }
        }
      } else if (turn < 1.6) {
        const sc = this.probeMesh(h, face.sign, far);
        if (sc < limit) best = this.consider(best, { kind: 'prop', prop: { type: 'face', value: k }, obj: face.sign, score: sc });
      }
    }
    for (const cap of d.caps) {
      const sc = this.probeCap(h, cap, far);
      if (sc < limit) best = this.consider(best, { kind: 'spin', obj: cap, score: sc + 0.004 });
    }
    if (far) {
      for (const jar of d.jars) {
        const sc = this.probeLocal(h, jar.group, 0, JAR_H / 2, 0, JAR_R + 0.002, JAR_H / 2, JAR_R + 0.002, far);
        if (sc < limit) best = this.consider(best, { kind: 'prop', prop: { type: 'jar', value: jar.color }, obj: jar.paint, score: sc });
      }
      for (const t of d.tiles) {
        const sc = this.probeLocal(h, t.group, 0, 0.014, 0, 0.018, 0.012, 0.018, far);
        if (sc < limit) best = this.consider(best, { kind: 'prop', prop: { type: 'tile', value: t.finish }, obj: t.brick, score: sc });
      }
    }
    return best;
  }

  /** A shelf cap as the disc it is (near: distance to it; far: the ray against its inscribed square). */
  private probeCap(h: HandState, cap: Mesh, far: boolean): number {
    const bb = cap.geometry.boundingBox ?? (cap.geometry.computeBoundingBox(), cap.geometry.boundingBox!);
    const r = bb.max.x;
    const half = (bb.max.y - bb.min.y) / 2;
    if (far) return this.probeLocal(h, cap, 0, 0, 0, r * 0.7, half, r * 0.7, true);
    cap.updateWorldMatrix(true, false);
    const lo = this.v2.copy(h.point).applyMatrix4(this.m1.copy(cap.matrixWorld).invert());
    const out = Math.max(0, Math.hypot(lo.x, lo.z) - r * 0.9);
    return Math.hypot(out, Math.max(0, Math.abs(lo.y) - half));
  }

  /** Probe a mesh by its own geometry's bounding box. */
  private probeMesh(h: HandState, m: Mesh, far: boolean): number {
    const bb = m.geometry.boundingBox ?? (m.geometry.computeBoundingBox(), m.geometry.boundingBox!);
    const c = bb.getCenter(this.v5);
    return this.probeLocal(h, m, c.x, c.y, c.z, (bb.max.x - bb.min.x) / 2, (bb.max.y - bb.min.y) / 2, (bb.max.z - bb.min.z) / 2, far);
  }

  /** Like probeObject, for a box given in an object's local frame (center and half extents, unscaled). */
  private probeLocal(h: HandState, obj: Object3D, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, far: boolean): number {
    obj.updateWorldMatrix(true, false);
    this.m1.copy(obj.matrixWorld).invert();
    if (!far) {
      const lo = this.v2.copy(h.point).applyMatrix4(this.m1);
      return this.boxDist(lo.set(lo.x - cx, lo.y - cy, lo.z - cz), hx, hy, hz);
    }
    const o = this.v2.copy(h.rayOrigin).applyMatrix4(this.m1);
    o.set(o.x - cx, o.y - cy, o.z - cz);
    const dir = this.v4.copy(h.rayDir).transformDirection(this.m1);
    return this.rayBox(o, dir, hx, hy, hz);
  }

  /** Where the parts in the front face's cubbies are (world), for tests and probes. */
  shelfPreviews(): number[][] {
    const k = this.drum.frontFace();
    return this.drum.faces[k].previews.map((m) => m.getWorldPosition(new Vector3()).toArray());
  }

  /** Settings rows: stats, app buttons, look presets and size — plus, under Advanced, environment, tone and sliders. */
  private settingsRows(): Array<[kind: 'stats' | 'head' | 'row' | 'ctl', ids: string[]]> {
    const rows: Array<['stats' | 'head' | 'row' | 'ctl', string[]]> = [
      ['stats', ['stats']],
      ['row', ['recenter', 'instructions', 'clear']],
      ['head', ['head:look']],
    ];
    for (let k = 0; k < STYLES.length; k += 3) rows.push(['row', STYLES.slice(k, k + 3).map((_, j) => `style:${k + j}`)]);
    rows.push(['row', ['slider:size', 'advanced', 'controls']]);
    if (this.controlsOpen) CONTROLS.forEach((_, i) => rows.push(['ctl', [`ctl:${i}`]]));
    if (!this.advanced) return [...rows, ['ctl', ['credits']]];
    rows.push(['head', ['head:env']], ['row', ENVS.map((e) => `env:${e.id}`)], ['row', ['tone', 'reset', 'hz', 'stress']], ['head', ['head:tune']]);
    const tune = SLIDERS.filter((d) => d.id !== 'size');
    for (let k = 0; k < tune.length; k += 2) rows.push(['row', tune.slice(k, k + 2).map((d) => `slider:${d.id}`)]);
    rows.push(['ctl', ['credits']]);
    return rows;
  }

  private rowHeight(kind: string, ids: string[]): number {
    if (kind === 'stats') return 0.035;
    if (kind === 'head') return 0.016;
    if (kind === 'ctl') return 0.017;
    return ids.some((id) => id.startsWith('slider:')) ? 0.026 : 0.024;
  }

  private layoutSettings(): void {
    const p = this.settings;
    this.clearPanel(p);
    const rows = this.settingsRows();
    const h = rows.reduce((sum, [kind, ids]) => sum + this.rowHeight(kind, ids) + GAP, 2 * MARGIN - GAP);
    if (Math.abs(h - p.h) > 1e-4) {
      // Grow or shrink downward, keeping the top edge in place.
      p.entity.object3D!.translateY((p.h - h) / 2);
      p.h = h;
      this.sizePanel(p);
    }
    const left = -p.w / 2 + MARGIN;
    const inner = p.w - 2 * MARGIN;
    let y = p.h / 2 - MARGIN;
    for (const [kind, ids] of rows) {
      const rh = this.rowHeight(kind, ids);
      const w = (inner - (ids.length - 1) * GAP) / ids.length;
      ids.forEach((id, k) => {
        const x = kind === 'row' ? left + w / 2 + k * (w + GAP) : 0;
        const itemKind = kind === 'row' ? (id.startsWith('slider:') ? 'slider' : 'button') : 'label';
        if (kind === 'ctl') {
          this.addUi(p, id, 'label', 0, 0, y - rh / 2, inner, rh);
          return;
        }
        this.addUi(p, id, itemKind, 0, x, y - rh / 2, kind === 'row' ? w : inner, rh);
      });
      y -= rh + GAP;
    }
    const stats = p.items.find((u) => u.id === 'stats')!;
    this.statsCanvas = stats.canvas!;
    this.statsTex = stats.tex!;
    this.drawStats();
  }

  private colorOf(code: number): number {
    return this.lib.colorIndex.get(code) ?? 0;
  }

  private selectColor(k: number): void {
    this.color = k;
    this.fillPartsShelf();
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
        return this.isArmed('stress') ? 'Replace build?' : 'Stress';
      case 'recenter':
        return 'Recenter';
      case 'clear':
        return this.isArmed('clear') ? 'Tap to confirm' : 'Clear';
      case 'undo':
        return '↶ Undo';
      case 'redo':
        return '↷';
      case 'reset':
        return `Reset ${STYLES[this.style].name}`;
      case 'tone':
        return `Tone: ${TONES[this.tone][0]}`;
      case 'head:look':
        return 'Look';
      case 'advanced':
        return this.advanced ? 'Advanced ▾' : 'Advanced ▸';
      case 'head:env':
        return 'Environment';
      case 'head:tune':
        return 'Fine-tune';
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
      case 'slot:prev':
        return '◀';
      case 'slot:next':
        return '▶';
      case 'slot':
        return this.slotInfo(this.slot);
      case 'save':
        return 'Save';
      case 'load':
        return 'Load';
      case 'kit:exit':
        return 'Exit kit';
      case 'kit:restart':
        return '↺ Restart';
      case 'kit:skip':
        return 'Skip ▶';
      case 'controls':
        return this.controlsOpen ? 'Controls ▾' : 'Controls ▸';
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
      case 'man:zoomin':
        return '+';
      case 'man:zoomout':
        return '−';
    }
    if (item.kind === 'slider') {
      const def = SLIDERS.find((d) => `slider:${d.id}` === item.id)!;
      const v = this.sliderValue(def.id);
      return `${def.label} ${def.fmt ? def.fmt(v) : v.toFixed(2)}`;
    }
    if (item.id.startsWith('style:')) return STYLES[Number(item.id.slice(6))].name;
    if (item.id.startsWith('env:')) return ENVS.find((e) => e.id === item.id.slice(4))!.label;
    if (item.id.startsWith('ctl:')) return CONTROLS[Number(item.id.slice(4))].join('\t');
    return item.id;
  }

  private uiSelected(item: UiItem): boolean {
    if (item.id === `style:${this.style}`) return true;
    if (item.id === `env:${this.envId}`) return true;
    if (item.id === `tool:${this.tool}`) return true;
    return false;
  }

  private drawUi(item: UiItem): void {
    if (!item.canvas || !item.tex) return;
    if (item.id === 'stats') return; // drawn by drawStats
    const label = this.uiLabel(item);
    const selected = this.uiSelected(item);
    // Skip the canvas draw and texture upload when nothing it shows has changed.
    const sig = `${label}|${selected}|${item.hover}|${this.uiDisabled(item)}|${this.isArmed(item.id)}|${
      item.kind === 'slider' ? this.sliderValue(item.id.slice(7)) : ''
    }`;
    if (sig === item.sig) return;
    item.sig = sig;
    const { width, height } = item.canvas;
    const ctx = item.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
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
    } else if (item.id.startsWith('ctl:')) {
      // Controls list: action on the left, how on the right (a heading when there's no "how").
      const [what, how] = label.split('\t');
      ctx.textBaseline = 'middle';
      if (!how) {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `700 ${Math.round(height * 0.6)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(what, 4, height / 2 + 2);
      } else {
        ctx.fillStyle = '#98a2b5';
        ctx.font = `600 ${Math.round(height * 0.52)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(what, 4, height / 2 + 2, width * 0.36);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(how, width * 0.38, height / 2 + 2, width * 0.62 - 4);
      }
    } else {
      if (!label) {
        item.tex.needsUpdate = true;
        return;
      }
      const passive = item.kind === 'label';
      const off = this.uiDisabled(item);
      if (!passive) {
        ctx.fillStyle = off ? '#1f2430' : selected ? '#5b8def' : this.isArmed(item.id) ? '#b91c1c' : item.hover ? '#34405a' : '#252b39';
        ctx.beginPath();
        ctx.roundRect(3, 3, width - 6, height - 6, height * 0.3);
        ctx.fill();
      }
      ctx.fillStyle = off ? '#5b6475' : passive && item.id === 'slot' ? '#e2e8f0' : passive ? '#8b95a8' : '#ffffff';
      const heading = passive && item.id.startsWith('head:');
      ctx.font = `${heading ? 700 : 600} ${Math.round(height * (heading ? 0.6 : 0.42))}px system-ui, sans-serif`;
      ctx.textAlign = heading ? 'left' : 'center';
      ctx.textBaseline = 'middle';
      const x = heading ? 4 : width / 2;
      ctx.fillText(label, x, height / 2 + 2, width - x - 6);
    }
    item.tex.needsUpdate = true;
  }

  /** Two-tap confirm for destructive buttons: true on the second tap within 3 s. */
  private confirm(id: string): boolean {
    if (this.isArmed(id)) {
      this.armed = null;
      return true;
    }
    this.armed = { id, at: this.time };
    return false;
  }

  private isArmed(id: string): boolean {
    return !!this.armed && this.armed.id === id && this.time - this.armed.at < 3;
  }

  private uiDisabled(item: UiItem): boolean {
    if (item.id === 'undo') return !this.undoStack.length || !!this.kit;
    if (item.id === 'redo') return !this.redoStack.length || !!this.kit;
    return false;
  }

  private sliderTrack(): [number, number] {
    return [0.56, 0.95];
  }

  private redrawUi(filter?: (u: UiItem) => boolean): void {
    for (const p of this.panels) for (const item of p.items) if (!filter || filter(item)) this.drawUi(item);
  }

  private setUiHover(item: UiItem, hover: boolean): void {
    if (item.hover === hover) return;
    item.hover = hover;
    this.drawUi(item);
  }

  private pressUi(item: UiItem, h?: HandState): void {
    if (h && h.mode !== 'controller' && item.kind !== 'label') this.uiTick();
    if (item.kind === 'label') return;
    this.tick(0.25);
    this.onButton(item.id);
  }

  private slideTo(item: UiItem, lx: number): void {
    const def = SLIDERS.find((d) => `slider:${d.id}` === item.id)!;
    const [t0, t1] = this.sliderTrack();
    const f = (lx - (item.x - item.w / 2)) / item.w;
    const t = Math.min(1, Math.max(0, (f - t0) / (t1 - t0)));
    this.setSlider(def.id, def.min + t * (def.max - def.min));
  }

  private frontSpot(out: Vector3): Vector3 {
    const P = dims.pitch;
    const { x0, x1, z1 } = this.bounds;
    return this.root.object3D!.localToWorld(out.set(((x0 + x1) / 2) * P, 0.05 / this.scale, z1 * P + 0.05 / this.scale));
  }

  private onButton(id: string): void {
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
        if (!this.placedRecs.length || this.confirm('stress')) this.stress();
        break;
      case 'recenter':
        this.recenter();
        break;
      case 'clear':
        if (this.confirm('clear')) {
          this.exitKit();
          this.clearPlaced();
        }
        break;
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'reset':
        this.applyStyle(this.style);
        break;
      case 'advanced':
        this.advanced = !this.advanced;
        this.layoutSettings();
        break;
      case 'tone':
        this.tone = (this.tone + 1) % TONES.length;
        this.applyVisuals();
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
      default:
        if (id.startsWith('style:')) this.applyStyle(Number(id.slice(6)));
        else if (id.startsWith('env:')) {
          this.setEnv(id.slice(4));
          this.applyVisuals();
        }
        break;
      case 'tool:build':
      case 'tool:select':
      case 'tool:paint':
        this.tool = id.slice(5) as Tool;
        break;
      case 'deselect':
        this.selection.clear();
        break;
      case 'slot:prev':
      case 'slot:next':
        this.slot = (this.slot + (id === 'slot:next' ? 1 : SLOTS - 1)) % SLOTS;
        break;
      case 'save':
        this.saveSlot();
        break;
      case 'load':
        this.loadSlot();
        break;
      case 'kit:exit':
        this.exitKit();
        break;
      case 'kit:restart':
        this.restartStep();
        break;
      case 'kit:skip':
        this.skipStep();
        break;
      case 'controls':
        this.controlsOpen = !this.controlsOpen;
        this.layoutSettings();
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
      case 'man:zoomin':
      case 'man:zoomout':
        if (this.kit) {
          const z = this.kit.zoom + (id === 'man:zoomin' ? 1 : -1);
          this.kit.zoom = Math.max(0, Math.min(MANUAL_ZOOM.length - 1, z));
          this.showPage(this.kit.page);
        }
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
      let joint: PartConns['joint'] = null;
      if (def.joint) {
        const o = new Vector3(...def.joint.o).multiplyScalar(L);
        // Where a top's LDraw origin goes, in this base's baked frame (LDraw → three: y and z flip).
        const mounts = (def.joint.mounts ?? [{ pair: def.joint.pair, at: [0, 0, 0] as [number, number, number], yaw: 0 }]).map((mt) => ({
          pair: mt.pair,
          m: new Matrix4()
            .makeTranslation(o.x + mt.at[0] * L, o.y - mt.at[1] * L, o.z - mt.at[2] * L)
            .multiply(new Matrix4().makeRotationY((-mt.yaw * Math.PI) / 180)),
        }));
        joint = { pair: def.joint.pair, role: def.joint.role, o, mounts };
      }
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

  /**
   * Contact occlusion: the platform's transform for the shader every frame, and — only when
   * the build or plate changed — an occupancy grid over the plate (stud cells × plate
   * heights) with every placed block's collision box rasterized into it.
   */
  private updateContact(): void {
    const r = this.root.object3D!;
    CONTACT.plateInv.value.copy(r.matrixWorld).invert();
    if (this.contactGen === this.editGen && this.contactPlate === this.platformGen) return;
    this.contactGen = this.editGen;
    this.contactPlate = this.platformGen;
    const P = dims.pitch;
    const Y = dims.unit * 2;
    const { x0, x1, z0, z1 } = this.bounds;
    const W = x1 - x0;
    const D = z1 - z0;
    const top = this.buildBox() ? this.buildMax.y : 0;
    const Hy = Math.max(2, Math.min(128, Math.ceil(top / Y) + 2));
    const data = new Uint8Array(W * Hy * D);
    const c = this.v1;
    const lo = this.v2;
    const hi = this.v3;
    for (const rec of this.placedRecs) {
      if (this.lib.parts[rec.part].overlap) continue;
      const body = this.pconn[rec.part].body;
      lo.set(Infinity, Infinity, Infinity);
      hi.set(-Infinity, -Infinity, -Infinity);
      for (let k = 0; k < 8; k++) {
        c.set(k & 1 ? body.h.x : -body.h.x, k & 2 ? body.h.y : -body.h.y, k & 4 ? body.h.z : -body.h.z).add(body.c).applyMatrix4(rec.m);
        lo.min(c);
        hi.max(c);
      }
      const i0 = Math.max(0, Math.floor(lo.x / P - x0));
      const i1 = Math.min(W - 1, Math.floor(hi.x / P - x0));
      const j0 = Math.max(0, Math.floor(lo.y / Y));
      const j1 = Math.min(Hy - 1, Math.floor(hi.y / Y));
      const k0 = Math.max(0, Math.floor(lo.z / P - z0));
      const k1 = Math.min(D - 1, Math.floor(hi.z / P - z0));
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++)
          for (let k = k0; k <= k1; k++) {
            c.set((x0 + i + 0.5) * P, (j + 0.5) * Y, (z0 + k + 0.5) * P).applyMatrix4(rec.mi!).sub(body.c);
            if (Math.abs(c.x) <= body.h.x && Math.abs(c.y) <= body.h.y && Math.abs(c.z) <= body.h.z) data[i + j * W + k * W * Hy] = 255;
          }
    }
    const old = CONTACT.grid.value;
    const tex = new Data3DTexture(data, W, Hy, D);
    tex.format = RedFormat;
    tex.minFilter = tex.magFilter = LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    CONTACT.grid.value = tex;
    old.dispose();
    CONTACT.min.value.set(x0 * P, 0, z0 * P);
    CONTACT.size.value.set(W * P, Hy * Y, D * P);
  }

  /** Platform-local (unscaled) center of a placement. */
  private placedCenter(rec: Placement, out: Vector3): Vector3 {
    return out.setFromMatrixPosition(rec.m);
  }

  private localMatrix(rec: Placement, out: Matrix4): Matrix4 {
    return out.copy(rec.m);
  }

  private batchFor(rec: Placed): Batch {
    // See-through palette colors batch as clear plastic, so each batch has one material.
    const fin = this.shownFinish(rec.finish, rec.color);
    const key = `${rec.part}|${fin}`;
    rec.batch = key;
    let b = this.batches.get(key);
    if (!b) {
      b = this.createBatch(key, 16);
      this.batches.set(key, b);
    }
    if (b.records.length >= b.mesh.instanceMatrix.count) {
      b = this.createBatch(key, b.mesh.instanceMatrix.count * 2, b);
      this.batches.set(key, b);
    }
    return b;
  }

  private createBatch(key: string, capacity: number, from?: Batch): Batch {
    const [part, fin] = key.split('|').map(Number);
    const mesh = new InstancedMesh(this.lib.geometries[part], this.matFor(fin, null), capacity);
    mesh.name = 'PlacedBlocks';
    mesh.frustumCulled = false;
    mesh.castShadow = !FINISHES[fin].trans;
    mesh.receiveShadow = true;
    mesh.setColorAt(0, this.colors[0]);
    mesh.count = 0;
    if (from) {
      mesh.instanceMatrix.array.set(from.mesh.instanceMatrix.array);
      mesh.instanceColor!.array.set(from.mesh.instanceColor!.array);
      mesh.count = from.records.length;
      from.entity.destroy();
      from.mesh.dispose(); // frees its instance buffers (geometry and material are shared)
    }
    const entity = this.child(this.root, mesh);
    return { key, entity, mesh, records: from?.records ?? [] };
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
    this.editGen++;
    this.dirty = this.shadowDirty = this.edited = true;
  }

  private removePlaced(rec: Placed): void {
    const batch = this.batches.get(rec.batch);
    if (!batch || batch.records[rec.slot] !== rec) return;
    this.editGen++;
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
    this.dirty = this.shadowDirty = this.edited = true;
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
    this.editGen++;
    // Blocks still animating into place would land after the clear.
    for (const sn of this.snaps) this.dropLoose(sn.block, false);
    this.snaps.length = 0;
    this.dirty = this.shadowDirty = this.edited = true;
  }

  private recolor(recs: Placed[], color: number, finish?: number): void {
    for (const rec of recs) {
      const selected = this.selection.has(rec);
      this.removePlaced(rec);
      rec.color = color;
      if (finish !== undefined) rec.finish = finish;
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

  private makeRec(part: number, color: number, m: Matrix4, target?: Placed, finish = 0): Placed {
    return { part, color, finish, m, target, slot: -1, batch: '' };
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

  private spawnLoose(part: number, color: number, pos: Vector3, quat: Quaternion, finish = this.finish): Loose {
    const mesh = new Mesh(this.lib.geometries[part], this.matFor(finish, color));
    mesh.name = 'Block';
    mesh.castShadow = !this.isSeeThrough(finish, color);
    mesh.receiveShadow = true;
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    mesh.scale.setScalar(this.scale);
    const entity = this.world.createTransformEntity(mesh);
    const l = { entity, mesh, part, color, finish };
    this.loose.push(l);
    this.shadowDirty = true;
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
      const block = this.spawnLoose(part, this.colorOf(code), this.v1.set(0, y, 0).applyQuaternion(q).add(base), q, this.finish);
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
    type Cand = { D: Matrix4; score: number; partner?: Placed };
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
    const cands: Cand[] = [];
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
              const D = this.alignTransform(P, A, cur[k], t);
              cands.push({ D, score: this.moveCost(anchor, D) + (1 + facing) * 2 });
            }
          }
        }
      }
      // Paired parts (hinge halves, turntables, window glass, panes, shutters) go exactly
      // onto a mount of their partner — and may sit inside it.
      if (pc.joint?.role === 'top') {
        const here = new Vector3().setFromMatrixPosition(cur[k]);
        const tj = pc.joint;
        for (const rec of this.placedRecs) {
          const bj = this.pconn[rec.part].joint;
          if (!bj || bj.role !== 'base') continue;
          for (const mount of bj.mounts) {
            if (mount.pair !== tj.pair) continue;
            const target = rec.m.clone().multiply(mount.m).multiply(new Matrix4().makeTranslation(-tj.o.x, -tj.o.y, -tj.o.z));
            const dist = this.v3.setFromMatrixPosition(target).distanceTo(here);
            if (dist > reach * 2) continue;
            // Mounts that share a spot (a shutter either side of its holder): the one the piece is held closest to.
            const turn = new Quaternion().setFromRotationMatrix(target).angleTo(q);
            cands.push({ D: target.multiply(cur[k].clone().invert()), score: dist / dims.pitch - 2 + turn * 0.5, partner: rec });
          }
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
      if (tried.length >= 24) break;
      if (tried.some((d) => this.sameTransform(d, cand.D))) continue;
      tried.push(cand.D);
      const mats = cur.map((m) => m.clone().premultiply(cand.D));
      const others = cand.partner ? nearby.filter((rec) => rec !== cand.partner) : nearby;
      if (mats.some((m, k) => this.bodyCollides(pieces[k].block.part, m, others))) continue;
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
   * How far a landing moves the held piece from where it's held, in studs: sliding sideways
   * costs full price, settling straight down about a third (it's where it would fall), and
   * popping up the most. So a block hovering over a gap drops into it rather than hopping
   * sideways onto the blocks around it, and one held over a block still stacks on it.
   */
  private moveCost(anchor: Vector3, D: Matrix4): number {
    const v = this.v3.copy(anchor).applyMatrix4(D).sub(anchor);
    const flat = Math.hypot(v.x, v.z);
    return (flat + (v.y < 0 ? -v.y * 0.35 : v.y * 1.2)) / dims.pitch;
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
    const pinchRing = new Mesh(new RingGeometry(0.8, 1, 24), new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false }));
    pinchRing.renderOrder = 22;
    // Turning guides: the platform's axes (X red, Y green, Z blue) and a ring around the turn's axis.
    const axesGeo = new BufferGeometry();
    axesGeo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]), 3));
    axesGeo.setAttribute('color', new BufferAttribute(new Float32Array([1, 0.3, 0.3, 1, 0.3, 0.3, 0.3, 1, 0.4, 0.3, 1, 0.4, 0.35, 0.6, 1, 0.35, 0.6, 1]), 3));
    const axes = new LineSegments(axesGeo, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false }));
    axes.renderOrder = 21;
    const turnRing = new Mesh(new TorusGeometry(1, 0.03, 6, 40), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
    turnRing.renderOrder = 21;
    for (const m of [outline, ray, cursor, guide, pinchRing, axes, turnRing]) {
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
      pokeArmed: false,
      pinchGap: 1,
      midGap: 1,
      closing: 0,
      aimOrigin: new Vector3(),
      aimDir: new Vector3(),
      pinchRing,
      overTrash: false,
      lost: 0,
      recovering: false,
      snapOk: false,
      snapGen: -1,
      snapPlatform: -1,
      snapAt: new Vector3(),
      snapQ: new Quaternion(),
      snapShown: [],
      snapCount: 0,
      target: null,
      targetFar: false,
      pieces: null,
      swing: null,
      box: null,
      tear: null,
      tearFrom: new Vector3(),
      holdButton: null,
      held: new Set(),
      camera: false,
      spin: null,
      dip: null,
      palm: new Vector3(0, -1, 0),
      pulling: false,
      pullFrom: 0,
      pullClicked: false,
      bArmed: false,
      selectSweep: null,
      fromSelection: false,
      rotTarget: new Quaternion(),
      aligned: false,
      alignQ: new Quaternion(),
      alignCur: new Quaternion(),
      axes,
      turnRing,
      turnShow: 0,
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
    if (h.hand === 'right' && !session && this.desktop.enabled) {
      this.readMouse(h);
      return;
    }
    let source: XRInputSource | undefined;
    if (session) for (const s of session.inputSources) if (s.handedness === h.hand) source = s;
    const mode = !source ? 'none' : source.hand ? 'hand' : source.gamepad ? 'controller' : 'none';
    if (mode !== h.mode) {
      // A hand dropping out of tracking mid-hold gets a grace period (see updateHand),
      // and when it comes back, its pinch is re-read rather than treated as new.
      const keep = !!h.pieces && ((mode === 'none' && h.mode === 'hand') || (mode === 'hand' && h.mode === 'none'));
      if (h.holdButton && !keep) h.up.add(h.holdButton);
      h.held.clear();
      h.recovering = keep && mode === 'hand';
      h.closing = 0;
      h.pinching = h.midPinching = false;
      h.aimDir.set(0, 0, 0);
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
      // Gripping a controller, the palm faces the controller's inner side: +X for the left hand.
      h.palm.set(h.hand === 'left' ? 1 : -1, 0, 0).applyQuaternion(this.q1);
      const pad = this.input.xr.gamepads[h.hand];
      if (!pad) return;
      for (const [btn, id] of PAD_BUTTONS[h.hand]) {
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
      // Palm normal from the knuckles: (index − wrist) × (pinky − wrist), signed by hand.
      if (this.jointPos(frame, ref, source.hand, 'index-finger-metacarpal', this.v5) && this.jointPos(frame, ref, source.hand, 'pinky-finger-metacarpal', this.v6)) {
        this.v5.sub(this.v4);
        this.v6.sub(this.v4);
        h.palm.crossVectors(this.v5, this.v6).normalize();
        if (h.hand === 'left') h.palm.negate();
      }
      h.indexTip.copy(index);
      h.hasTip = true;
      h.point.copy(thumb).add(index).multiplyScalar(0.5);
      const gap = thumb.distanceTo(index);
      // Fingers closing fast toward a pinch: hold the aim still for a moment, so the
      // pinch itself doesn't knock the ray (or the near target) off what you meant.
      if (!h.pinching && gap < 0.06 && h.pinchGap - gap > 0.0012) h.closing = 0.15;
      else h.closing = Math.max(0, h.closing - this.frameDelta);
      if (h.pinching) h.closing = 0;
      h.pinchGap = gap;
      // Steady the ray: damp small jitter, follow deliberate moves at once.
      if (h.aimDir.lengthSq() === 0) {
        h.aimOrigin.copy(h.rayOrigin);
        h.aimDir.copy(h.rayDir);
      } else if (h.closing <= 0) {
        h.aimDir.lerp(h.rayDir, Math.min(1, 0.3 + h.aimDir.angleTo(h.rayDir) * 15)).normalize();
        h.aimOrigin.lerp(h.rayOrigin, Math.min(1, 0.3 + h.aimOrigin.distanceTo(h.rayOrigin) * 60));
      }
      h.rayOrigin.copy(h.aimOrigin);
      h.rayDir.copy(h.aimDir);
      if (h.recovering) {
        h.recovering = false;
        h.pinching = gap < PINCH_OFF;
        h.midPinching = thumb.distanceTo(middle) < PINCH_OFF;
        if (h.holdButton && !(h.holdButton === 'mid' ? h.midPinching : h.pinching)) h.up.add(h.holdButton);
        return;
      }
      if (!h.pinching && gap < PINCH_ON) {
        h.pinching = true;
        h.down.add('pinch');
      } else if (h.pinching && gap > PINCH_OFF) {
        h.pinching = false;
        h.up.add('pinch');
      }
      const mgap = thumb.distanceTo(middle);
      h.midGap = mgap;
      if (!h.midPinching && !h.pinching && gap > INDEX_OPEN && mgap < MID_ON) {
        h.midPinching = true;
        h.down.add('mid');
      } else if (h.midPinching && mgap > PINCH_OFF) {
        h.midPinching = false;
        h.up.add('mid');
      }
    }
  }

  /** Desktop: the cursor is a ray from the camera; left button = trigger (Alt: duplicate), Delete = B. */
  private readMouse(h: HandState): void {
    const d = this.desktop;
    if (h.mode !== 'mouse') {
      if (h.holdButton) h.up.add(h.holdButton);
      h.held.clear();
      h.closing = 0;
      h.pinching = h.midPinching = false;
      h.mode = 'mouse';
    }
    this.camera.getWorldPosition(h.rayOrigin);
    this.camera.getWorldQuaternion(h.quat);
    const at = d.pressed ? d.pressNdc : d.ndc; // aim the press where the button went down
    h.rayDir.set(at.x, at.y, 0.5).unproject(this.camera).sub(h.rayOrigin).normalize();
    h.point.copy(h.rayOrigin);
    if (d.pressed) h.down.add(d.alt ? 'a' : 'trigger');
    if (d.released) h.up.add('trigger').add('a');
    if (d.actions.has('delete')) h.down.add('b');
  }

  /** Desktop view: keyboard actions and the orbit camera. */
  private updateDesktop(): void {
    const d = this.desktop;
    d.poll();
    if (!d.enabled || this.renderer.xr.isPresenting) return;
    if (d.actions.has('undo')) this.undo();
    if (d.actions.has('redo')) this.redo();
    if (d.actions.has('frame')) this.frameCamera();
    if (d.actions.has('tool1')) this.onButton('tool:build');
    if (d.actions.has('tool2')) this.onButton('tool:select');
    if (d.actions.has('tool3')) this.onButton('tool:paint');
    d.applyCamera(this.camera);
  }

  /** Point the desktop camera at the platform from the front, panels in view behind it. */
  private frameCamera(): void {
    const r = this.root.object3D!;
    const P = dims.pitch * this.scale;
    const { x0, x1, z0, z1 } = this.bounds;
    const d = this.desktop;
    this.plateCenter(d.target).addScaledVector(this.v1.set(0, 1, 0).applyQuaternion(r.quaternion), 0.08);
    d.azimuth = this.yawOf(r.quaternion);
    d.elevation = 0.55;
    d.distance = Math.max(0.8, Math.hypot((x1 - x0) * P, (z1 - z0) * P) * 2.6);
  }

  /** Where the hand's ray meets the plate's top plane, in platform-local meters (null if it doesn't). */
  private platePoint(h: HandState, out: Vector3): Vector3 | null {
    const r = this.root.object3D!;
    const o = r.worldToLocal(out.copy(h.rayOrigin));
    const d = this.v6.copy(h.rayDir).applyQuaternion(this.q2.copy(r.quaternion).invert());
    if (d.y > -1e-4) return null;
    return o.addScaledVector(d, -o.y / d.y);
  }

  /** Desktop carry: sit the held block on whatever is under the cursor — a placed block or the plate. */
  private mouseDrop(h: HandState, part: number, out: Vector3): Vector3 {
    // Over the shelf: follow the cursor onto it, where letting go removes the block.
    const shelf = this.drum.root;
    const ll = shelf.worldToLocal(this.v4.copy(h.rayOrigin));
    const ld = this.v2.copy(h.rayDir).applyQuaternion(shelf.getWorldQuaternion(this.q2).invert());
    let tLib = Infinity;
    for (let tl = 0; tl < 3; tl += 0.01) {
      if (this.drum.contains(ll.x + ld.x * tl, ll.y + ld.y * tl, ll.z + ld.z * tl)) {
        tLib = tl;
        break;
      }
    }
    const r = this.root.object3D!;
    const P = dims.pitch;
    const o = r.worldToLocal(this.v5.copy(h.rayOrigin));
    const d = this.v6.copy(h.rayDir).applyQuaternion(this.q2.copy(r.quaternion).invert());
    let t = Infinity;
    if (d.y < -1e-4) {
      const tp = -o.y / d.y;
      const px = o.x + d.x * tp;
      const pz = o.z + d.z * tp;
      const b = this.bounds;
      if (px > b.x0 * P - 0.02 && px < b.x1 * P + 0.02 && pz > b.z0 * P - 0.02 && pz < b.z1 * P + 0.02) t = tp;
    }
    for (const rec of this.placedRecs) {
      this.halfExtents(rec.part, this.v3);
      this.v4.copy(o).applyMatrix4(rec.mi!);
      this.v2.copy(d).transformDirection(rec.mi!);
      t = Math.min(t, this.rayBox(this.v4, this.v2, this.v3.x, this.v3.y, this.v3.z));
    }
    if (tLib < t * this.scale) return out.copy(h.rayOrigin).addScaledVector(h.rayDir, tLib + 0.01);
    if (t === Infinity) return out.copy(h.rayOrigin).addScaledVector(h.rayDir, 0.4);
    out.copy(o).addScaledVector(d, t);
    out.y += this.halfExtents(part, this.v3).y + 0.001;
    return r.localToWorld(out);
  }

  private pressed(h: HandState, btns: Btn[]): Btn | null {
    for (const b of btns) if (h.down.has(b)) return b;
    return null;
  }

  private updateHand(h: HandState, delta: number): void {
    this.readInput(h);
    h.axes.visible = h.turnRing.visible = false; // holdPieces shows them while turning
    for (const b of h.down) h.held.add(b);
    for (const b of h.up) h.held.delete(b);
    for (const g of h.ghosts) g.visible = false;
    h.guide.visible = false;
    if (h.lit) {
      h.lit.material = this.ghostLineMat;
      h.lit = null;
    }
    const released = h.holdButton !== null && (h.up.has(h.holdButton) || (h.mode === 'none' && !h.pieces));

    if (h.pieces && h.mode === 'none') {
      // Tracking lost mid-hold: keep the pieces still for a moment, then park them
      // where they are — never snap them somewhere the player didn't choose.
      h.lost += delta;
      if (h.lost > LOST_GRACE) {
        h.pieces = null;
        h.holdButton = null;
        h.overTrash = false;
      }
    } else if (h.pieces) {
      h.lost = 0;
      // Holding a duplicate on A/X: squeeze grip (or trigger) and it's held by that
      // instead, so A can be let go and the thumb is free for the stick.
      const takeOver = h.holdButton === 'a' && !released ? (h.down.has('squeeze') ? 'squeeze' : h.down.has('trigger') ? 'trigger' : null) : null;
      if (takeOver) {
        h.holdButton = takeOver;
        this.pulse(h.hand, 0.3, 15);
      }
      if (released) this.releasePieces(h);
      else if (h.down.has('b')) this.dropPieces(h);
      else this.holdPieces(h, delta);
    } else if (h.swing) {
      if (released) this.endSwing(h);
      else this.swingTick(h);
    } else if (h.box) {
      if (released) this.releaseBox(h);
      else if (h.down.has('b')) this.returnBox(h.box);
      else this.carryBox(h, delta);
      if (!h.box) h.holdButton = null;
    } else if (h.tear) {
      if (released) this.releaseTear(h);
      else this.pullTear(h);
    } else if (h.spin) {
      if (released) this.releaseSpin(h);
      else this.spinDrum(h);
    } else if (h.camera) {
      if (released) this.releaseCamera(h);
      else this.carryCamera(h, delta);
    } else if (h.pulling) {
      if (released) {
        h.pulling = false;
        h.holdButton = null;
      } else this.pullCord(h);
    } else if (h.frame) {
      if (released) this.releaseFrame(h);
      else this.holdFrame(h, delta);
    } else if (h.slider) {
      if (released) {
        h.slider = null;
        h.holdButton = null;
      } else this.dragSlider(h);
    } else {
      if (h.mode !== 'hand' || h.closing <= 0) this.findTarget(h);
      this.poke(h);
      this.touchShelf(h);
      if (h.painting) {
        if (released) {
          h.painting = false;
          h.holdButton = null;
        } else this.paintTarget(h.target);
      }
      const grab = this.pressed(h, GRAB_BTNS);
      const dup = this.pressed(h, DUP_BTNS);
      // Controllers: B/Y is a modifier. Held, trigger/grip selects (and sweeping selects
      // more); tapped on its own, it deletes on release. A/X held + grip duplicates.
      const pad = h.mode === 'controller';
      const bHeld = pad && h.held.has('b');
      if (h.selectSweep && !(bHeld && (h.held.has('trigger') || h.held.has('squeeze')))) h.selectSweep = null;
      if (h.selectSweep && h.target?.kind === 'placed') this.sweepSelect(h.target.placed!, h.selectSweep);
      if (pad && h.down.has('b')) {
        h.bArmed = !!h.target;
        h.selectSweep = null;
      }
      if (h.target && !h.painting) {
        if (grab && bHeld && h.target.kind === 'placed') {
          h.bArmed = false;
          h.selectSweep = this.selection.has(h.target.placed!) ? 'remove' : 'add';
          this.sweepSelect(h.target.placed!, h.selectSweep);
        } else if (grab && pad && h.held.has('a')) this.onDuplicate(h, grab);
        else if (grab) this.onGrab(h, grab);
        else if (dup) this.onDuplicate(h, dup);
        else if (!pad && h.down.has('b')) this.onDelete(h.target);
      }
      if (pad && h.up.has('b')) {
        if (h.bArmed && h.target) this.onDelete(h.target);
        h.bArmed = false;
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

  /** Ray (origin o, direction d) against a centered box: entry distance, or Infinity on a miss. */
  private rayBox(o: Vector3, d: Vector3, hx: number, hy: number, hz: number): number {
    let tmin = 0;
    let tmax = RAY_MAX * 10;
    for (let axis = 0; axis < 3; axis++) {
      const oo = axis === 0 ? o.x : axis === 1 ? o.y : o.z;
      const dd = axis === 0 ? d.x : axis === 1 ? d.y : d.z;
      const hh = axis === 0 ? hx : axis === 1 ? hy : hz;
      if (Math.abs(dd) < 1e-9) {
        if (Math.abs(oo) > hh) return Infinity;
        continue;
      }
      const t1 = (-hh - oo) / dd;
      const t2 = (hh - oo) / dd;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
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

    // Platform handles give way to blocks near them: a block within this much wins.
    const yieldTo = far ? 0.03 : 0.012;
    this.edges.forEach((obj) => {
      const sc = this.probeObject(h, obj, 0.009, 0.04, 0.009, far);
      if (sc < limit) best = this.consider(best, { kind: 'edge', frame: 'platform', obj, score: sc + yieldTo });
    });
    // With the other hand already holding the platform, anywhere on the plate is a second handle.
    if (this.hands.some((o) => o !== h && o.frame === 'platform' && o.corner < 0)) {
      const sc = this.probeObject(h, this.slab, 0.5, 0.5, 0.5, far);
      if (sc < limit) best = this.consider(best, { kind: 'edge', frame: 'platform', obj: this.slab, score: sc + yieldTo });
    }
    this.corners.forEach((obj, corner) => {
      const sc = this.probeObject(h, obj, 0.011, 0.011, 0.011, far);
      if (sc < limit) best = this.consider(best, { kind: 'corner', obj, corner, score: sc + yieldTo });
    });
    if (this.snapCam && this.rackShown() && this.snapCam.state !== 'held') {
      const sc = this.probeObject(h, this.snapCam.body, 0.045, 0.032, 0.025, far);
      if (sc < limit) best = this.consider(best, { kind: 'camera', obj: this.snapCam.body, score: sc });
    }
    if (this.lamp) {
      const sc = this.probeObject(h, this.lamp.bead, 0.014, 0.014, 0.014, far);
      if (sc < limit) best = this.consider(best, { kind: 'pull', obj: this.lamp.bead, score: sc });
    }
    if (this.shelfBar) {
      const sc = this.probeObject(h, this.shelfBar, 0.05, 0.011, 0.011, far);
      if (sc < limit) best = this.consider(best, { kind: 'bar', frame: 'shelf', obj: this.shelfBar, score: sc });
    }
    if (this.rackShown()) {
      const sc = this.probeObject(h, this.rackBar!, 0.055, 0.011, 0.011, far);
      if (sc < limit) best = this.consider(best, { kind: 'bar', frame: 'rack', obj: this.rackBar!, score: sc });
    }
    for (const b of this.boxes) {
      if (!b.mesh.visible || b.state === 'returning' || b.state === 'opening') continue;
      // The tear strip's tab, once the box is off the rack (it can be in the other hand).
      if (b.state !== 'rack') {
        const ts = this.probeObject(h, b.tab, 0.014, 0.008, 0.014, far);
        if (ts < limit) best = this.consider(best, { kind: 'tear', box: b, obj: b.tab, score: Math.max(0, ts - 0.01) });
      }
      if (b.state === 'held') continue;
      const sc = this.probeObject(h, b.mesh, b.w / 2, b.h / 2, b.d / 2, far);
      if (sc < limit) best = this.consider(best, { kind: 'box', box: b, obj: b.mesh, score: sc });
    }

    if (this.drum) best = this.shelfTargets(h, far, limit, best);
    for (const p of this.panels) {
      if (!p.entity.object3D!.visible) continue;
      if (p.bar.visible) {
        const sc = this.probeObject(h, p.bar, 0.05, 0.011, 0.011, far);
        if (sc < limit) best = this.consider(best, { kind: 'bar', frame: p.id, obj: p.bar, score: sc });
      }
      if (p.resize) {
        const rs = this.probeObject(h, p.resize, 0.012, 0.012, 0.012, far);
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
        if (far) best = this.consider(best, { kind: 'ui', ui: item, score });
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
    const lo2 = this.v4;
    const ext = this.v5;
    const dl = this.v6;
    // Skip the per-block pass when the hand is nowhere near the build.
    let skip = !this.buildBox();
    if (!skip) {
      ext.copy(this.buildMax).sub(this.buildMin).multiplyScalar(0.5);
      lo2.copy(this.buildMin).add(ext).sub(o).negate();
      skip = far ? this.rayBox(lo2, d, ext.x, ext.y, ext.z) === Infinity : this.boxDist(lo2, ext.x, ext.y, ext.z) * s > limit;
    }
    if (!skip) for (const rec of this.placedRecs) {
      this.halfExtents(rec.part, ext);
      lo2.copy(o).applyMatrix4(rec.mi!);
      let sc: number;
      if (far) {
        dl.copy(d).transformDirection(rec.mi!);
        // transformDirection normalizes; rescale t back into platform units
        sc = this.rayBox(lo2, dl, ext.x, ext.y, ext.z);
      } else {
        // Block boxes overlap (studs included): when the point is inside several,
        // the one whose center is nearest wins.
        sc = this.boxDist(lo2, ext.x, ext.y, ext.z) + lo2.length() * 0.01;
      }
      sc *= s;
      // Hinged parts sit inside their frames' boxes (panes, doors): they win within a centimeter.
      if (sc < limit && this.lib.parts[rec.part].hinge) sc = Math.max(0, sc - 0.01);
      if (sc < limit && (!best || sc < best.score)) best = { kind: 'placed', placed: rec, score: sc };
    }
    // A bare panel hit (no item) is only there to block rays; don't target it.
    return best && best.kind === 'ui' && !best.ui ? null : best;
  }

  /** Bounds of everything placed (platform-local), or false when nothing is. Cached per edit. */
  private buildBox(): boolean {
    if (!this.placedRecs.length) return false;
    if (this.buildBoxGen !== this.editGen) {
      this.buildBoxGen = this.editGen;
      this.buildMin.set(Infinity, Infinity, Infinity);
      this.buildMax.set(-Infinity, -Infinity, -Infinity);
      for (const rec of this.placedRecs) {
        const rad = this.halfExtents(rec.part, this.v3).length();
        this.v4.setFromMatrixPosition(rec.m);
        this.buildMin.min(this.v5.copy(this.v4).subScalar(rad));
        this.buildMax.max(this.v5.copy(this.v4).addScalar(rad));
      }
    }
    return true;
  }

  private isCarried(l: Loose): boolean {
    return this.hands.some((h) => h.pieces?.some((p) => p.block === l)) || this.snaps.some((s) => s.block === l);
  }

  private findTarget(h: HandState): void {
    const prev = h.target?.ui;
    h.target = null;
    if (h.mode !== 'none') {
      h.target = h.mode === 'mouse' ? null : this.collectTargets(h, false);
      h.targetFar = !h.target;
      if (!h.target) h.target = this.collectTargets(h, true);
    }
    const next = h.target?.ui;
    if (prev && prev !== next && !this.hands.some((o) => o !== h && o.target?.ui === prev)) this.setUiHover(prev, false);
    if (next) this.setUiHover(next, true);
  }

  /**
   * Finger poke on panels. A press needs the fingertip to arrive from in front
   * (armed above 6 mm) and reach the surface (4 mm, the buttons sit at 1 mm), so
   * sliding in from the side or from behind a panel doesn't fire anything.
   */
  private poke(h: HandState): void {
    if (!h.hasTip) return;
    for (const p of this.panels) {
      if (!p.entity.object3D!.visible) continue;
      const lo = p.entity.object3D!.worldToLocal(this.v1.copy(h.indexTip));
      if (Math.abs(lo.x) > p.w / 2 || Math.abs(lo.y) > p.h / 2 || lo.z > 0.05 || lo.z < -0.03) continue;
      if (lo.z > 0.006) h.pokeArmed = true;
      const slider = p.items.find((u) => u.kind === 'slider' && Math.abs(lo.x - u.x) <= u.w / 2 && Math.abs(lo.y - u.y) <= u.h / 2);
      if (slider && lo.z < 0.004 && lo.z > -0.02 && (h.pokeArmed || h.pokeLatched)) {
        this.slideTo(slider, lo.x);
        h.pokeLatched = true;
        return;
      }
      if (h.pokeLatched) {
        if (lo.z > 0.02) h.pokeLatched = false;
        return;
      }
      if (!h.pokeArmed || lo.z > 0.004 || lo.z < -0.02) return;
      for (const item of p.items) {
        if (item.kind === 'label') continue;
        if (Math.abs(lo.x - item.x) <= item.w / 2 && Math.abs(lo.y - item.y) <= item.h / 2) {
          h.pokeLatched = true;
          h.pokeArmed = false;
          this.pressUi(item, h);
          return;
        }
      }
      return;
    }
    h.pokeArmed = false;
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
      this.pressUi(t.ui!, h);
      return;
    }
    const tapLike = btn === 'trigger' || btn === 'pinch';
    const selecting = this.tool === 'select' || (h.mode === 'mouse' && this.desktop.shift);
    if (selecting && tapLike && t.kind === 'placed') {
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
      case 'box':
        this.holdBox(h, btn, t.box!);
        return;
      case 'tear':
        this.startTear(h, btn, t.box!);
        return;
      case 'cell': {
        // A part from the shelf: it comes out of its cubby full size, into your hand.
        const { face, slot } = t.cubby!;
        const entry = this.cubbyEntry(face, slot);
        if (entry === null) return;
        (t.obj as Mesh).getWorldPosition(this.v1);
        if (entry < 0) {
          h.fromSelection = false;
          this.startHold(h, btn, this.figurePieces(-1 - entry, this.v1.clone()), true);
        } else this.holdLoose(h, btn, [this.spawnLoose(entry, this.color, this.v1, this.root.object3D!.quaternion)], true);
        return;
      }
      case 'spin':
        h.holdButton = btn;
        h.anchorDist = h.mode !== 'hand' && h.targetFar ? t.score : -1;
        h.spin = { a0: this.drumAngleOf(this.grabPoint(h)), drum0: this.drum.angle };
        this.tick(0.3);
        return;
      case 'prop':
        this.pressProp(t.prop!);
        return;
      case 'placed': {
        const group = this.selection.has(t.placed!) && this.selection.size > 1 ? [...this.selection] : [t.placed!];
        // Hinged parts (hinges, turntables, doors, panes, shutters) — and whatever is built
        // onto them — swing instead of coming off.
        const hinged = group.length === 1 ? this.hingeFor(t.placed!) : null;
        if (hinged && this.startSwing(h, btn, hinged, t.placed!)) return;
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
        h.anchorDist = h.mode !== 'hand' && h.targetFar ? t.score : -1;
        this.q1.copy(h.quat).invert();
        h.offsetQuat.copy(this.q1).multiply(obj.quaternion);
        h.offsetPos.copy(obj.position).sub(this.grabPoint(h)).applyQuaternion(this.q1);
        this.levelAnim = null;
        this.tick(0.3);
        const other = h.frame === 'platform' && this.hands.find((o) => o !== h && o.frame === 'platform' && o.corner < 0 && !o.resizing);
        if (other) this.startTwoHand(other, h);
        return;
      }
      case 'camera':
        this.holdCamera(h, btn);
        return;
      case 'pull':
        h.pulling = true;
        h.pullClicked = false;
        h.holdButton = btn;
        h.anchorDist = h.mode !== 'hand' && h.targetFar ? t.score : -1;
        h.pullFrom = this.grabPoint(h).y;
        this.tick(0.2);
        return;
      case 'resize': {
        const panel = this.panels.find((p) => p.id === t.frame)!;
        h.frame = t.frame!;
        h.resizing = panel;
        h.holdButton = btn;
        h.anchorDist = h.mode !== 'hand' && h.targetFar ? t.score : -1;
        // The top-left corner stays put while the bottom-right follows the hand.
        panel.entity.object3D!.localToWorld(h.resizeAnchor.set(-panel.w / 2, panel.h / 2, 0));
        this.tick(0.3);
        return;
      }
      case 'corner':
        h.frame = 'platform';
        h.holdButton = btn;
        h.corner = t.corner!;
        h.anchorDist = h.mode !== 'hand' && h.targetFar ? t.score : -1;
        this.tick(0.3);
        return;
    }
  }

  /** B/Y + trigger: add a block to the selection (or take it out), once per block per sweep. */
  private sweepSelect(rec: Placed, mode: 'add' | 'remove'): void {
    if (mode === 'add' ? this.selection.has(rec) : !this.selection.has(rec)) return;
    if (mode === 'add') this.selection.add(rec);
    else this.selection.delete(rec);
    this.tick(0.2);
    this.redrawUi((u) => u.id === 'deselect');
  }

  private frameObject(frame: FrameKind): Object3D {
    if (frame === 'platform') return this.root.object3D!;
    if (frame === 'shelf') return this.shelf!.object3D!;
    if (frame === 'rack') return this.rack!.object3D!;
    if (frame === 'drum') return this.drum.root;
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
      this.holdLoose(h, btn, [this.spawnLoose(l.part, l.color, l.mesh.position, l.mesh.quaternion, l.finish)], h.targetFar);
    }
  }

  private onDelete(t: Target): void {
    if (t.kind === 'placed') {
      const group = this.selection.has(t.placed!) ? [...this.selection] : [t.placed!];
      for (const rec of group) {
        this.placedWorldPose(rec, this.v1, this.q1);
        this.dropLoose(this.spawnLoose(rec.part, rec.color, this.v1, this.q1, rec.finish), true);
        this.removePlaced(rec);
      }
      this.redrawUi((u) => u.id === 'deselect');
    } else if (t.kind === 'loose') {
      this.dropLoose(t.loose!, true);
    } else if (t.kind === 'box' && t.box!.state === 'loose') {
      this.returnBox(t.box!);
    }
  }

  private paintTarget(t: Target | null): void {
    if (!t) return;
    if (t.kind === 'placed' && (t.placed!.color !== this.color || t.placed!.finish !== this.finish)) {
      this.recolor([t.placed!], this.color, this.finish);
      this.tick(0.15);
    } else if (t.kind === 'loose' && (t.loose!.color !== this.color || t.loose!.finish !== this.finish)) {
      t.loose!.color = this.color;
      t.loose!.finish = this.finish;
      t.loose!.mesh.material = this.matFor(this.finish, this.color);
      t.loose!.mesh.castShadow = !this.isSeeThrough(this.finish, this.color);
      this.shadowDirty = true;
      this.tick(0.15);
    }
  }

  private grabPoint(h: HandState): Vector3 {
    return h.anchorDist >= 0 ? this.v2.copy(h.rayOrigin).addScaledVector(h.rayDir, h.anchorDist) : this.v2.copy(h.point);
  }

  // ---- hinges

  /**
   * What swings with a hinged part: it and everything connected to it through its studs,
   * transitively. Null when that group is also fixed to the plate some other way (locked).
   */
  private swingGroup(rec: Placed): Placed[] | null {
    const group = [rec];
    const seen = new Set(group);
    for (let k = 0; k < group.length; k++) {
      const node = group[k];
      for (const [, c] of this.recConns.get(node) ?? []) {
        if (node === rec && c.type !== 0) continue; // the hinged part's own mount stays put
        for (const o of this.connsNear(c.p, 1 - c.type, 0.0012, this.near)) {
          if (o.rec === node || o.a.dot(c.a) > FACING) continue;
          if (!o.rec) return null;
          if (!seen.has(o.rec)) {
            seen.add(o.rec);
            group.push(o.rec);
          }
        }
      }
      if (group.length > 120) return null;
    }
    return group;
  }

  /** The hinge that swings this block: its own, or the nearest one it's built onto. */
  private hingeFor(rec: Placed): Placed | null {
    if (this.lib.parts[rec.part].hinge) return rec;
    let best: Placed | null = null;
    let size = Infinity;
    for (const r of this.placedRecs) {
      if (!this.lib.parts[r.part].hinge) continue;
      const g = this.swingGroup(r);
      if (g && g.length < size && g.includes(rec)) {
        best = r;
        size = g.length;
      }
    }
    return best;
  }

  private startSwing(h: HandState, btn: Btn, rec: Placed, grabbed: Placed): boolean {
    const group = this.swingGroup(rec);
    if (!group) return false;
    const hinge = this.lib.parts[rec.part].hinge!;
    const pivot = new Vector3(...hinge.p).multiplyScalar(dims.ldu).applyMatrix4(rec.m);
    const axis = new Vector3(...hinge.a).applyQuaternion(this.q1.setFromRotationMatrix(rec.m)).normalize();
    h.anchorDist = h.mode !== 'hand' && h.targetFar ? h.target!.score : -1;
    const d = this.root.object3D!.worldToLocal(this.v1.copy(this.grabPoint(h))).sub(pivot);
    const along = d.dot(axis);
    d.addScaledVector(axis, -along);
    // Grabbed right on the axis: measure from the part's own center instead.
    if (d.length() < 0.002) d.setFromMatrixPosition(rec.m).sub(pivot).addScaledVector(axis, -d.dot(axis));
    if (d.length() < 1e-5) d.set(1, 0, 0).addScaledVector(axis, -axis.x);
    const radius = d.length();
    const u = d.clone().normalize();
    for (const r of group) this.indexConns(r, false); // nothing snaps to it mid-swing
    h.swing = {
      rec,
      grabbed,
      group,
      start: group.map((r) => r.m.clone()),
      pivot,
      axis,
      u,
      w: new Vector3().crossVectors(axis, u),
      radius,
      along,
      prev: 0,
      turned: 0,
      angle0: rec.swing ?? 0,
      step: Math.round((rec.swing ?? 0) / (Math.PI / 12)),
      atLimit: false,
    };
    h.holdButton = btn;
    h.target = null;
    this.tick(0.3);
    return true;
  }

  private swingTick(h: HandState): void {
    const sw = h.swing!;
    const r = this.root.object3D!;
    const p = r.worldToLocal(this.v1.copy(this.grabPoint(h)));
    let onPlane = h.anchorDist < 0;
    if (h.anchorDist >= 0) {
      // By ray or mouse: follow where the ray crosses the swing's plane.
      const o = r.worldToLocal(this.v2.copy(h.rayOrigin));
      const dir = this.v3.copy(h.rayDir).applyQuaternion(this.q1.copy(r.quaternion).invert());
      const den = dir.dot(sw.axis);
      if (Math.abs(den) > 0.15) {
        const t = this.v4.copy(sw.pivot).addScaledVector(sw.axis, sw.along).sub(o).dot(sw.axis) / den;
        if (t > 0) {
          p.copy(o).addScaledVector(dir, t);
          onPlane = true;
        }
      }
    }
    const d = p.sub(sw.pivot);
    const along = d.dot(sw.axis);
    d.addScaledVector(sw.axis, -along);
    const radius = d.length();
    // Pulled well off the arc: take what was grabbed off instead.
    if (onPlane && (Math.abs(along - sw.along) * this.scale > 0.06 || (radius - sw.radius) * this.scale > 0.06)) {
      const btn = h.holdButton!;
      const rec = sw.grabbed;
      this.endSwing(h);
      this.holdPlaced(h, btn, rec, [rec], false);
      return;
    }
    if (radius > 1e-4) {
      const a = Math.atan2(d.dot(sw.w), d.dot(sw.u));
      let delta = a - sw.prev;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      sw.prev = a;
      sw.turned += delta;
    }
    const range = this.lib.parts[sw.rec.part].hinge!.r;
    let angle = sw.angle0 + sw.turned;
    let limit = false;
    if (range) {
      const lo = (range[0] * Math.PI) / 180;
      const hi = (range[1] * Math.PI) / 180;
      limit = angle <= lo || angle >= hi;
      angle = Math.min(hi, Math.max(lo, angle));
      sw.turned = angle - sw.angle0; // pushing past the stop doesn't wind up
    }
    if (limit && !sw.atLimit) this.pulse(h.hand, 0.5, 30);
    sw.atLimit = limit;
    const step = Math.round(angle / (Math.PI / 12));
    if (step !== sw.step) {
      sw.step = step;
      this.tick(0.08);
    }
    this.applySwing(sw, angle - sw.angle0);
    sw.rec.swing = angle;
    // Show the axis it turns about.
    const pos = h.guide.geometry.attributes.position as BufferAttribute;
    const reach = 0.025 / this.scale;
    r.localToWorld(this.v2.copy(sw.pivot).addScaledVector(sw.axis, -reach));
    r.localToWorld(this.v3.copy(sw.pivot).addScaledVector(sw.axis, reach));
    pos.setXYZ(0, this.v2.x, this.v2.y, this.v2.z);
    pos.setXYZ(1, this.v3.x, this.v3.y, this.v3.z);
    pos.needsUpdate = true;
    h.guide.visible = true;
  }

  /** Turn the swinging group `rel` radians from where it started, about the hinge. */
  private applySwing(sw: Swing, rel: number): void {
    const R = this.swingM.makeTranslation(sw.pivot.x, sw.pivot.y, sw.pivot.z).multiply(this.m2.makeRotationAxis(sw.axis, rel));
    R.multiply(this.m2.makeTranslation(-sw.pivot.x, -sw.pivot.y, -sw.pivot.z));
    sw.group.forEach((rec, k) => {
      rec.m.copy(sw.start[k]).premultiply(R);
      rec.mi!.copy(rec.m).invert();
      const batch = this.batches.get(rec.batch);
      if (batch) this.writeInstance(batch, rec);
    });
    this.shadowDirty = true;
  }

  private endSwing(h: HandState): void {
    const sw = h.swing!;
    h.swing = null;
    h.holdButton = null;
    for (const r of sw.group) this.indexConns(r, true);
    this.editGen++;
    this.dirty = this.shadowDirty = this.edited = true;
  }

  private holdPlaced(h: HandState, btn: Btn, anchor: Placed, group: Placed[], duplicate: boolean): void {
    const recs = [anchor, ...group.filter((r) => r !== anchor)];
    const pieces: Piece[] = recs.map((rec) => {
      this.placedWorldPose(rec, this.v1, this.q1);
      return { block: this.spawnLoose(rec.part, rec.color, this.v1, this.q1, rec.finish), offPos: new Vector3(), offQuat: new Quaternion() };
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
    h.snapGen = -1;
    h.lost = 0;
    h.holdButton = btn;
    h.target = null;
    this.tick(0.3);
    const blocks = new Set(pieces.map((p) => p.block));
    this.shelfItems = this.shelfItems.filter((s) => !blocks.has(s.block));
    for (const b of blocks) b.mesh.scale.setScalar(this.scale); // shelf-shrunk pieces come off full size
    const anchor = pieces[0].block.mesh;
    this.q1.copy(anchor.quaternion).invert();
    for (const p of pieces) {
      p.offQuat.copy(this.q1).multiply(p.block.mesh.quaternion);
      p.offPos.copy(p.block.mesh.position).sub(anchor.position).applyQuaternion(this.q1);
      p.block.mesh.castShadow = !this.isSeeThrough(p.block.finish, p.block.color);
    }
    // Held like a real object: the block keeps its rotation relative to the hand.
    this.q1.copy(h.quat).invert();
    h.offsetQuat.copy(this.q1).multiply(anchor.quaternion);
    h.rotTarget.copy(h.offsetQuat);
    h.aligned = false;
    h.turnShow = 0;
    if (h.mode === 'mouse') {
      // Desktop holds keep their world rotation (see turnHeld).
      h.offsetQuat.copy(anchor.quaternion);
      h.rotTarget.copy(anchor.quaternion);
    }
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
        // Thumbstick: left/right spins the block a quarter turn about the platform's up;
        // up/down tips it about the platform axis nearest the controller's side. The first
        // flick squares the block to the platform (see alignHeld).
        if (pad.getAxesEnteringLeft(InputComponent.Thumbstick)) this.turnAligned(h, 'spin', 1);
        if (pad.getAxesEnteringRight(InputComponent.Thumbstick)) this.turnAligned(h, 'spin', -1);
        if (pad.getAxesEnteringUp(InputComponent.Thumbstick)) this.turnAligned(h, 'tip', -1);
        if (pad.getAxesEnteringDown(InputComponent.Thumbstick)) this.turnAligned(h, 'tip', 1);
      }
      this.v1.copy(h.rayOrigin).addScaledVector(h.rayDir, HOLD_DIST);
      if (h.offsetPos.lengthSq() > 0) this.v1.copy(h.offsetPos).applyQuaternion(h.quat).add(h.point);
      if (h.aligned) {
        h.alignCur.slerp(h.alignQ, 1 - Math.exp(-delta * 18));
        this.q1.copy(this.root.object3D!.quaternion).multiply(h.alignCur);
      } else {
        h.offsetQuat.slerp(h.rotTarget, 1 - Math.exp(-delta * 18));
        this.q1.copy(h.quat).multiply(h.offsetQuat);
      }
      rate = FOLLOW_CTRL;
    } else if (h.mode === 'mouse') {
      const d = this.desktop;
      if (d.actions.has('spinL')) this.turnHeld(h, 'spin', 1);
      if (d.actions.has('spinR')) this.turnHeld(h, 'spin', -1);
      if (d.actions.has('tipU')) this.turnHeld(h, 'tip', -1);
      if (d.actions.has('tipD')) this.turnHeld(h, 'tip', 1);
      h.offsetQuat.slerp(h.rotTarget, 1 - Math.exp(-delta * 18));
      this.q1.copy(h.offsetQuat);
      this.mouseDrop(h, pieces[0].block.part, this.v1);
      rate = FOLLOW_CTRL;
    } else {
      this.v1.copy(h.offsetPos).applyQuaternion(h.quat).add(h.point);
      this.q1.copy(h.quat).multiply(h.offsetQuat);
    }
    // Letting go of a pinch moves the fingers: the block stays put while they open.
    const holdGap = h.holdButton === 'mid' ? h.midGap : h.pinchGap;
    const a = h.mode === 'hand' && holdGap > PINCH_OPENING ? 0 : 1 - Math.exp(-delta * rate);
    anchor.position.lerp(this.v1, a);
    anchor.quaternion.slerp(this.q1, a);
    for (let k = 1; k < pieces.length; k++) {
      const m = pieces[k].block.mesh;
      m.position.copy(pieces[k].offPos).applyQuaternion(anchor.quaternion).add(anchor.position);
      m.quaternion.copy(anchor.quaternion).multiply(pieces[k].offQuat);
    }

    h.overTrash = this.overLibrary(anchor.position);
    this.drawTurnGuides(h, pieces, delta);

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

    // Snapping is only recomputed when the pieces (or the build) actually changed.
    const stale = h.snapGen !== this.editGen || h.snapPlatform !== this.platformGen;
    if (stale || anchor.position.distanceToSquared(h.snapAt) > 2.5e-7 || anchor.quaternion.angleTo(h.snapQ) > 0.01) {
      h.snapOk = this.computeSnap(pieces);
      h.snapGen = this.editGen;
      h.snapPlatform = this.platformGen;
      h.snapAt.copy(anchor.position);
      h.snapQ.copy(anchor.quaternion);
      h.snapCount = h.snapOk ? this.snapOut.length : 0;
      for (let k = 0; k < h.snapCount; k++) {
        const shown = (h.snapShown[k] ??= { m: new Matrix4() });
        shown.m.copy(this.snapOut[k].m);
        shown.target = this.snapOut[k].target;
      }
    }
    for (let k = 0; k < h.snapCount; k++) {
      const g = this.ghostFor(h, k);
      g.geometry = this.lib.geometries[pieces[k].block.part];
      this.placedWorldPose(h.snapShown[k], g.position, g.quaternion);
      g.scale.setScalar(this.scale);
      g.visible = true;
    }
  }

  /**
   * Controller turns. The first one squares the held block to the platform: its rotation
   * in the platform's frame rounds to the nearest whole quarter turns and stops following
   * the wrist. Then spin turns it about the platform's up; tip turns it about whichever
   * platform axis (X or Z) lines up best with the controller's side, so "tip away" always
   * tips away from you. Snapping then lands it exactly as shown.
   */
  private turnAligned(h: HandState, how: 'spin' | 'tip', dir: number): void {
    const rootQ = this.root.object3D!.quaternion;
    if (!h.aligned) {
      const anchor = h.pieces![0].block.mesh;
      h.alignCur.copy(rootQ).invert().multiply(anchor.quaternion);
      h.alignQ.copy(squareUp(h.alignCur));
      h.aligned = true;
    }
    const axis = this.v2;
    if (how === 'spin') axis.set(0, 1, 0);
    else {
      // The controller's side, in the platform's frame: tip about X or Z, whichever it's nearer.
      const side = this.v3.set(1, 0, 0).applyQuaternion(h.quat).applyQuaternion(this.q2.copy(rootQ).invert());
      axis.set(Math.abs(side.x) >= Math.abs(side.z) ? Math.sign(side.x) || 1 : 0, 0, Math.abs(side.x) >= Math.abs(side.z) ? 0 : Math.sign(side.z) || 1);
    }
    h.alignQ.premultiply(this.q2.setFromAxisAngle(axis, (dir * Math.PI) / 2));
    // Ring around the turn's axis, in the axis's color.
    h.turnRing.quaternion.copy(rootQ).multiply(this.q2.setFromUnitVectors(this.v3.set(0, 0, 1), axis));
    (h.turnRing.material as MeshBasicMaterial).color.setHex(how === 'spin' ? 0x4dff66 : Math.abs(axis.x) > 0 ? 0xff4d4d : 0x598fff);
    h.turnShow = 0.6;
    this.tick(0.2);
  }

  /** The platform-axis guide on a squared-up held block, and the ring after a turn. */
  private drawTurnGuides(h: HandState, pieces: Piece[], delta: number): void {
    const show = h.aligned && h.mode === 'controller';
    h.axes.visible = show;
    h.turnShow = Math.max(0, h.turnShow - delta);
    h.turnRing.visible = show && h.turnShow > 0;
    if (!show) return;
    const anchor = pieces[0].block.mesh;
    const r = this.halfExtents(pieces[0].block.part, this.v3).length() * this.scale;
    h.axes.position.copy(anchor.position);
    h.axes.quaternion.copy(this.root.object3D!.quaternion);
    h.axes.scale.setScalar(Math.max(0.02, r * 1.5));
    if (h.turnRing.visible) {
      h.turnRing.position.copy(anchor.position);
      h.turnRing.scale.setScalar(Math.max(0.015, r * 1.15));
      (h.turnRing.material as MeshBasicMaterial).opacity = Math.min(1, h.turnShow / 0.3) * 0.8;
    }
  }

  /** Quarter-turn the held block: spin about the platform's up axis, or tip about the controller's side axis. */
  private turnHeld(h: HandState, how: 'spin' | 'tip', dir: number): void {
    const angle = (dir * Math.PI) / 2;
    if (h.mode === 'mouse') {
      // Desktop holds keep a world rotation: spin about the platform's up, tip about the camera's side.
      const axis = how === 'spin' ? this.v2.set(0, 1, 0).applyQuaternion(this.root.object3D!.quaternion) : this.v2.set(1, 0, 0).applyQuaternion(h.quat);
      h.rotTarget.premultiply(this.q2.setFromAxisAngle(axis, angle));
    } else if (how === 'spin') {
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
    h.overTrash = false;
    // Dropped on the library → put back.
    if (this.overLibrary(anchor.position)) {
      for (const p of pieces) this.dropLoose(p.block, true);
      return;
    }
    // Commit the landing that was on show; recompute only if the build changed since.
    const shown = h.snapGen === this.editGen && h.snapPlatform === this.platformGen;
    if (shown ? h.snapOk : this.computeSnap(pieces)) {
      const src = shown ? h.snapShown.slice(0, h.snapCount) : this.snapOut;
      const recs = src.map((o, k) => this.makeRec(pieces[k].block.part, pieces[k].block.color, o.m.clone(), o.target, pieces[k].block.finish));
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

  /** Is this point on the library panel, where letting go of a block removes it? */
  /** Over the parts shelf, where letting go of a block (or one of your boxes) removes it. */
  private overLibrary(pos: Vector3): boolean {
    if (!this.drum?.root.visible) return false;
    const lo = this.drum.root.worldToLocal(this.v1.copy(pos));
    return this.drum.contains(lo.x, lo.y, lo.z);
  }


  private dropPieces(h: HandState): void {
    h.overTrash = false;
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
    if (this.twoHand && (this.twoHand.a === h || this.twoHand.b === h)) return; // tickTwoHand moves it
    const obj = this.frameObject(h.frame!);
    this.v1.copy(h.offsetPos).applyQuaternion(h.quat).add(this.grabPoint(h));
    this.q1.copy(h.quat).multiply(h.offsetQuat);
    const a = 1 - Math.exp(-delta * (h.mode === 'hand' ? FOLLOW_HAND : FOLLOW_CTRL));
    obj.position.lerp(this.v1, a);
    obj.quaternion.slerp(this.q1, a);
    obj.updateMatrixWorld(true);
    if (h.frame === 'platform') this.aimKeyLight();
    if (h.frame === 'shelf') this.layoutShelfItems();
    if (h.frame === 'rack') this.layoutRack();
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
    this.pulse(h.hand, 0.1, 6);
  }

  private releaseFrame(h: HandState): void {
    const two = this.twoHand;
    if (two && (two.a === h || two.b === h)) {
      this.endTwoHand(two.a === h ? two.b : two.a);
      h.frame = null;
      h.holdButton = null;
      return;
    }
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

  /** Pulling the lamp's cord: it stretches down with the hand; past PULL_CLICK it clicks the lights a level. */
  private pullCord(h: HandState): void {
    const d = Math.min(PULL_MAX, Math.max(0, h.pullFrom - this.grabPoint(h).y));
    this.lamp.setPull(d);
    if (!h.pullClicked && d > PULL_CLICK) {
      h.pullClicked = true;
      this.dimLevel = (this.dimLevel + 1) % DIM_LEVELS.length;
      this.visualDirty = true;
      this.click();
    } else if (h.pullClicked && d < PULL_CLICK * 0.4) h.pullClicked = false; // back up: ready for another pull
  }

  /** The cord springs back once let go; the lights ease to the chosen level. */
  private tickLamp(delta: number): void {
    if (!this.lamp) return;
    if (!this.hands.some((h) => h.pulling) && this.lamp.pull > 0) this.lamp.setPull(this.lamp.pull < 1e-4 ? 0 : this.lamp.pull * Math.exp(-delta * 18));
    const target = DIM_LEVELS[this.dimLevel];
    if (this.dimNow === target) return;
    this.dimNow = Math.abs(target - this.dimNow) < 0.005 ? target : this.dimNow + (target - this.dimNow) * (1 - Math.exp(-delta * 8));
    this.keyLight.intensity = this.visual.key * this.dimNow;
    this.hemi.intensity = this.visual.fill * this.dimNow;
    this.scene.environmentIntensity = this.visual.envStrength * this.dimNow;
    this.lamp.setGlow(this.dimNow);
    this.shadowDirty = true;
  }

  private startTwoHand(a: HandState, b: HandState): void {
    const r = this.root.object3D!;
    const pa = this.grabPoint(a).clone();
    const pb = this.grabPoint(b).clone();
    const d = pb.clone().sub(pa);
    this.twoHand = {
      a,
      b,
      mid0: pa.clone().add(pb).multiplyScalar(0.5),
      pos0: r.position.clone(),
      quat0: r.quaternion.clone(),
      scale0: this.scale,
      dist0: Math.max(0.05, d.length()),
      yaw0: Math.atan2(d.x, d.z),
      step: Math.round(this.scale * 4),
    };
    this.twoHandLine.visible = true;
    this.pulse(a.hand, 0.4, 20);
    this.pulse(b.hand, 0.4, 20);
  }

  /** Both hands on the platform: follow the midpoint, turn about up, scale with their spread. */
  private tickTwoHand(delta: number): void {
    const two = this.twoHand;
    if (!two) return;
    const r = this.root.object3D!;
    const pa = this.v3.copy(this.grabPoint(two.a));
    const pb = this.v4.copy(this.grabPoint(two.b));
    const line = this.twoHandLine.geometry.getAttribute('position') as BufferAttribute;
    line.setXYZ(0, pa.x, pa.y, pa.z);
    line.setXYZ(1, pb.x, pb.y, pb.z);
    line.needsUpdate = true;
    const d = this.v1.copy(pb).sub(pa);
    const def = SLIDERS[0];
    const s = Math.min(def.max, Math.max(def.min, (two.scale0 * d.length()) / two.dist0));
    const ratio = s / two.scale0;
    const yaw = Math.atan2(d.x, d.z) - two.yaw0;
    const turn = this.q1.setFromAxisAngle(this.up, yaw);
    const mid = this.v2.copy(pa).add(pb).multiplyScalar(0.5);
    const pos = this.v1.copy(two.pos0).sub(two.mid0).multiplyScalar(ratio).applyQuaternion(turn).add(mid);
    const a = 1 - Math.exp(-delta * (two.a.mode === 'hand' || two.b.mode === 'hand' ? FOLLOW_HAND : FOLLOW_CTRL));
    r.position.lerp(pos, a);
    r.quaternion.slerp(this.q2.copy(turn).multiply(two.quat0), a);
    const next = this.scale + (s - this.scale) * a;
    if (Math.abs(next - this.scale) > 1e-5) {
      r.scale.setScalar(next);
      this.scale = next;
      for (const l of this.loose) l.mesh.scale.setScalar(next);
      this.layoutPlateHandles();
    }
    r.updateMatrixWorld(true);
    this.aimKeyLight();
    // A tick each quarter step of scale.
    const step = Math.round(this.scale * 4);
    if (step !== two.step) {
      two.step = step;
      this.pulse(two.a.hand, 0.15, 8);
      this.pulse(two.b.hand, 0.15, 8);
    }
  }

  /** One hand let go: the other carries on alone from where the platform is now. */
  private endTwoHand(rest: HandState): void {
    this.twoHand = null;
    this.twoHandLine.visible = false;
    const r = this.root.object3D!;
    // Settle on the Size slider's steps (0.05).
    const snapped = Math.round(this.scale * 20) / 20;
    if (snapped !== this.scale) this.setScale(snapped);
    else this.updatePlate();
    this.redrawUi((u) => u.id === 'slider:size');
    this.q1.copy(rest.quat).invert();
    rest.offsetQuat.copy(this.q1).multiply(r.quaternion);
    rest.offsetPos.copy(r.position).sub(this.grabPoint(rest)).applyQuaternion(this.q1);
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
    const local = h.mode === 'mouse' ? this.platePoint(h, this.v1) : this.root.object3D!.worldToLocal(this.v1.copy(this.grabPoint(h)));
    if (!local) return;
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
    // Pinch ring: sits between thumb and index, shrinks as they close, fills blue on pinch.
    const ring = h.pinchRing;
    const busy = !!(h.pieces || h.frame || h.slider || h.box || h.tear || h.swing || h.pulling || h.camera || h.spin);
    ring.visible = h.mode === 'hand' && !busy && h.pinchGap < 0.07;
    if (ring.visible) {
      ring.position.copy(h.point);
      this.camera.getWorldQuaternion(ring.quaternion);
      ring.scale.setScalar(Math.min(0.012, Math.max(0.0035, h.pinchGap * 0.28)));
      const m = ring.material as MeshBasicMaterial;
      m.color.setHex(h.pinching ? 0x5b8def : t ? 0xffffff : 0x9aa4b8);
      m.opacity = Math.min(1, (0.07 - h.pinchGap) / 0.03);
    }
    h.outline.visible = false;
    if (t && !busy && t.kind !== 'ui') {
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
        h.outline.scale.multiplyScalar(t.kind === 'loose' || t.kind === 'cell' || t.kind === 'prop' ? 1.08 : t.kind === 'box' ? 1.04 : t.kind === 'spin' ? 1.02 : 1.3);
      }
      // B/Y held: the outline turns selection-cyan (trigger selects instead of grabbing).
      const selecting = h.mode === 'controller' && h.held.has('b') && !h.pieces;
      (h.outline.material as MeshBasicMaterial).color.set(selecting ? 0x22d3ee : this.tool === 'paint' ? this.lib.colors[this.color].hex : 0xffffff);
      h.outline.visible = true;
    }
    const showRay = h.mode !== 'none' && h.mode !== 'mouse' && !h.pieces && !h.frame && !h.box && (h.targetFar || !t || !!h.slider || !!h.tear || !!h.swing);
    h.ray.visible = showRay;
    h.cursor.visible = showRay && !!t;
    if (h.mode === 'mouse') {
      this.desktop.setCursor(busy ? 'grabbing' : !t ? 'default' : t.kind === 'ui' ? 'pointer' : 'grab');
    }
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

  /** A kit's steps, fetched once. */
  private kitSteps(id: string): Promise<KitBlock[][]> {
    let p = this.kitData.get(id);
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}kits/${id}.json`)
        .then((r) => r.json())
        .then((d: { steps: KitBlock[][] }) => d.steps);
      p.catch(() => this.kitData.delete(id));
      this.kitData.set(id, p);
    }
    return p;
  }

  private async startKit(id: string, title: string): Promise<void> {
    const data = { steps: await this.kitSteps(id) };
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
      zoom: 0,
      di: Math.round((this.bounds.x0 + this.bounds.x1) / 2 - (minI + maxI) / 2),
      dj: Math.round((this.bounds.z0 + this.bounds.z1) / 2 - (minJ + maxJ) / 2),
      remaining: [],
      matched: new Map(),
      stepPlaced: [],
      spawned: [],
    };
    this.buildShelf();
    this.syncRack();
    this.layoutWrist();
    this.beginStep();
    this.applyInstructions();
  }

  private kitRec(b: KitBlock): Placed | null {
    const p = this.kitPiece(b, this.kit!.di, this.kit!.dj);
    return p && this.makeRec(p.part, p.color, p.m);
  }

  /** A kit block as part, palette color and platform-local matrix, shifted by whole studs. */
  private kitPiece(b: KitBlock, di: number, dj: number): { part: number; color: number; m: Matrix4 } | null {
    return kitPiece(this.lib, b, di, dj);
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
    this.syncRack();
    this.layoutWrist();
  }

  private finishKit(): void {
    this.destroyShelf();
    this.kit = null;
    this.syncRack();
    this.applyInstructions();
    this.layoutWrist();
    this.redrawUi();
  }

  /** Ghosts on the platform, a paged manual, or both. */
  private applyInstructions(): void {
    const wantManual = !!this.kit && this.instructions !== 'ghosts';
    if (wantManual && !this.manual) {
      this.manual = this.createPanel('manual', 0.34, 0.46, false);
      this.layoutManual();
      const r = this.root.object3D!;
      const P = dims.pitch * this.scale;
      const obj = this.manual.entity.object3D!;
      obj.position
        .set(this.bounds.x1 * P + 0.2, 0.3, ((this.bounds.z0 + this.bounds.z1) / 2) * P - 0.1)
        .applyQuaternion(r.quaternion)
        .add(r.position);
      obj.quaternion.copy(r.quaternion).multiply(this.q1.setFromEuler(this.euler.set(-0.3, -0.55, 0, 'YXZ')));
      this.showPage(this.kit!.step);
    } else if (!wantManual && this.manual) {
      this.destroyPanel(this.manual);
      this.manual = null;
      this.painter?.dispose();
      this.painter = null;
      this.pageTex?.dispose();
      this.pageTex = null;
      this.pageCanvas = null;
    }
    if (this.kit) for (const r of this.kit.remaining) r.ghost.object3D!.visible = this.instructions !== 'manual';
  }

  private layoutManual(): void {
    const p = this.manual!;
    this.clearPanel(p);
    const inner = p.w - 2 * MARGIN;
    const titleY = p.h / 2 - MARGIN - 0.014;
    this.addUi(p, 'man:title', 'label', 0, 0, titleY, inner, 0.028);
    const y = -p.h / 2 + MARGIN + 0.013;
    this.addUi(p, 'man:prev', 'button', 0, -inner / 2 + 0.028, y, 0.056, 0.026);
    this.addUi(p, 'man:zoomout', 'button', 0, -0.078, y, 0.036, 0.026);
    this.addUi(p, 'man:here', 'button', 0, 0, y, 0.108, 0.026);
    this.addUi(p, 'man:zoomin', 'button', 0, 0.078, y, 0.036, 0.026);
    this.addUi(p, 'man:next', 'button', 0, inner / 2 - 0.028, y, 0.056, 0.026);
    // The page itself: a sheet of paper each step is drawn on.
    const top = titleY - 0.014 - GAP;
    const bottom = y + 0.013 + GAP;
    const ph = top - bottom;
    if (!this.pageCanvas) {
      this.pageCanvas = document.createElement('canvas');
      this.pageCanvas.width = 2048;
      this.pageCanvas.height = Math.round((2048 * ph) / inner);
      this.pageTex = new CanvasTexture(this.pageCanvas);
      this.pageTex.colorSpace = SRGBColorSpace;
      this.pageTex.anisotropy = 4;
    }
    const sheet = new Mesh(new PlaneGeometry(inner, ph), new MeshBasicMaterial({ map: this.pageTex, toneMapped: false }));
    p.owned.push(sheet.geometry, sheet.material as Material);
    sheet.position.set(0, (top + bottom) / 2, 0.001);
    this.addContent(p, sheet);
  }

  /**
   * Show manual page n (drawn by ManualPainter).
   */
  private showPage(n: number): void {
    const kit = this.kit;
    const p = this.manual;
    if (!kit || !p) return;
    kit.page = n;
    this.layoutManual();
    this.painter ??= new ManualPainter(this.lib, (part) => this.edgeGeo(part));
    this.painter.paint(this.pageCanvas!, kit.steps, n, kit.zoom);
    this.pageTex!.needsUpdate = true;
    this.redrawUi((u) => u.id.startsWith('man:'));
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
    const bar = new Mesh(new CapsuleGeometry(0.005, 0.08, 4, 10).rotateZ(Math.PI / 2), new MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 }));
    bar.position.set(0, -0.004, SHELF_D / 2 + 0.014);
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
    if (this.shelfAt) {
      // Where the box was opened, facing the player.
      s.position.copy(this.shelfAt.pos);
      s.quaternion.setFromEuler(this.euler.set(0.35, this.shelfAt.yaw, 0, 'YXZ'));
      this.shelfAt = null;
    } else {
      s.position
        .set(this.bounds.x1 * P + 0.22, 0.08, ((this.bounds.z0 + this.bounds.z1) / 2) * P + 0.12)
        .applyQuaternion(r.quaternion)
        .add(r.position);
      s.quaternion.copy(r.quaternion).multiply(this.q1.setFromEuler(this.euler.set(0.35, -0.55, 0, 'YXZ')));
    }
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
      // Anything bigger than the shelf can show is shrunk to fit; it's full size once picked up.
      const fit = Math.min(1, SHELF_FIT / (Math.max(def.w, def.d) * dims.pitch * S));
      const w = Math.max(def.w * dims.pitch * S * fit, 0.012);
      const d = Math.max(def.d * dims.pitch * S * fit, 0.012);
      if (x + w > SHELF_W / 2 - 0.01 && x > -SHELF_W / 2 + 0.02) {
        x = -SHELF_W / 2 + 0.015;
        z += rowDepth + gap;
        rowDepth = 0;
      }
      const pos = new Vector3(x + w / 2, (def.h * dims.unit * S * fit) / 2 + 0.002, z + d / 2);
      const block = this.spawnLoose(it.part, it.color, pos, this.q1.identity(), 0);
      block.mesh.scale.setScalar(S * fit);
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

  // ---- kit boxes

  /** A rack of kit boxes; the art is drawn in once the models have rendered. */
  private buildRack(): void {
    const mat = new MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.55 });
    const base = new Mesh(new RoundedBoxGeometry(RACK_W, 0.01, RACK_D, 2, 0.003), mat);
    base.name = 'KitRack';
    base.receiveShadow = true;
    this.rack = this.track(this.world.createTransformEntity(base));
    const parts: Mesh[] = [];
    const shelf = new Mesh(new RoundedBoxGeometry(RACK_W, 0.008, RACK_D, 2, 0.003), mat);
    shelf.position.y = RACK_TIER;
    shelf.receiveShadow = true;
    // A third tier on top holds boxes of your own builds; the camera sits on the roof.
    const mine = new Mesh(new RoundedBoxGeometry(RACK_W, 0.008, RACK_D, 2, 0.003), mat);
    mine.position.y = RACK_TIER * 2;
    mine.receiveShadow = true;
    const roof = new Mesh(new RoundedBoxGeometry(RACK_W, 0.008, RACK_D, 2, 0.003), mat);
    roof.position.y = RACK_TIER * 3;
    roof.receiveShadow = true;
    parts.push(mine, roof);
    const back = new Mesh(new BoxGeometry(RACK_W, RACK_TIER * 3 + 0.01, 0.006), mat);
    back.position.set(0, (RACK_TIER * 3) / 2, -RACK_D / 2 + 0.003);
    for (const x of [-1, 1]) {
      const side = new Mesh(new BoxGeometry(0.008, RACK_TIER * 3 + 0.01, RACK_D), mat);
      side.position.set((x * (RACK_W - 0.008)) / 2, (RACK_TIER * 3) / 2, 0);
      parts.push(side);
    }
    // Label on the top tier's edge, and a hint on its back wall while it's empty.
    const label = new Mesh(new PlaneGeometry(0.16, 0.016), new MeshBasicMaterial({ map: this.textTexture('YOUR BUILDS', 512, 52, '#e2e8f0', 'rgba(0,0,0,0)', 34), transparent: true, toneMapped: false }));
    label.position.set(-RACK_W / 2 + 0.1, RACK_TIER * 3 - 0.018, -RACK_D / 2 + 0.007);
    this.rackHint = new Mesh(new PlaneGeometry(0.44, 0.05), new MeshBasicMaterial({ map: this.textTexture('Grab the camera on top and photograph your build to box it', 1400, 160, '#98a2b5', 'rgba(0,0,0,0)', 46), transparent: true, toneMapped: false }));
    this.rackHint.position.set(0, RACK_TIER * 2.5, -RACK_D / 2 + 0.007);
    parts.push(label, this.rackHint);
    const bar = new Mesh(new CapsuleGeometry(0.005, 0.09, 4, 10).rotateZ(Math.PI / 2), new MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 }));
    bar.position.set(0, -0.01, RACK_D / 2 + 0.014);
    this.rackBar = bar;
    for (const m of [shelf, back, ...parts, bar]) this.child(this.rack, m);
    // Boxes: first half on the bottom shelf, the rest on the middle one, centered in each row.
    this.boxes = KITS.map((k) => new KitBox(k));
    for (const b of this.boxes) this.boxEntities.set(b, this.world.createTransformEntity(b.mesh, { persistent: true }));
    const perRow = Math.ceil(this.boxes.length / 2);
    for (let row = 0; row < 2; row++) {
      const inRow = this.boxes.slice(row * perRow, (row + 1) * perRow);
      const gap = 0.01;
      const total = inRow.reduce((a, b) => a + b.w, 0) + gap * (inRow.length - 1);
      let x = -total / 2;
      for (const b of inRow) {
        b.slotPos.set(x + b.w / 2, row * RACK_TIER + 0.005 + b.h / 2 + (row ? 0.004 : 0), 0.004);
        x += b.w + gap;
      }
    }
    // Your boxes, from this device.
    this.myBoxes = ((this.readStore('stacker.boxes') as StoredBox[] | null) ?? []).filter((b) => b && b.id && Array.isArray(b.steps));
    for (const stored of this.myBoxes) this.addMyBox(stored);
    this.layoutMyBoxes();
    // The camera, on the roof at the right.
    const cam = new SnapCamera();
    cam.homePos.set(RACK_W / 2 - 0.07, RACK_TIER * 3 + 0.004 + 0.025, 0);
    this.snapCam = cam;
    this.world.createTransformEntity(cam.group, { persistent: true });
    this.placeRack();
    void this.paintBoxes();
  }

  /** A text label as a texture (left-aligned, vertically centered). */
  private textTexture(text: string, w: number, h: number, color: string, bg: string, size: number): CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, h / 2 + 2, w - 8);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }

  /** A box for one of your builds (not yet on the rack: see layoutMyBoxes). */
  private addMyBox(stored: StoredBox): KitBox {
    const box = new KitBox({ id: stored.id, title: stored.title, pieces: stored.pieces, color: stored.color, mine: true });
    this.kitData.set(stored.id, Promise.resolve(stored.steps));
    this.boxes.push(box);
    this.boxEntities.set(box, this.world.createTransformEntity(box.mesh, { persistent: true }));
    return box;
  }

  /** Your boxes along the top tier, newest first; ones that don't fit stay off the rack. */
  private layoutMyBoxes(): void {
    const order = this.myBoxes.map((m) => this.boxes.find((b) => b.kit.id === m.id)).filter((b): b is KitBox => !!b);
    const gap = 0.01;
    let x = -RACK_W / 2 + 0.014;
    for (const b of order) {
      const fits = x + b.w <= RACK_W / 2 - 0.014;
      b.mesh.visible = fits && this.rackShown();
      if (!fits) continue;
      b.slotPos.set(x + b.w / 2, RACK_TIER * 2 + 0.009 + b.h / 2, 0.004);
      x += b.w + gap;
    }
    if (this.rackHint) this.rackHint.visible = order.length === 0;
    this.layoutRack();
  }

  private placeRack(): void {
    if (!this.rack) return;
    const r = this.root.object3D!;
    const P = dims.pitch * this.scale;
    const { x0, x1, z0, z1 } = this.bounds;
    const obj = this.rack.object3D!;
    if (this.desktop.enabled && !this.renderer.xr.isPresenting) {
      // Desktop: behind the plate, between the panels, facing the camera.
      obj.position.set(((x0 + x1) / 2) * P, 0.04, z0 * P - 0.3);
      obj.quaternion.identity();
    } else {
      obj.position.set(x1 * P + 0.42, -0.06, ((z0 + z1) / 2) * P - 0.06);
      obj.quaternion.setFromAxisAngle(this.up, -0.65);
    }
    obj.position.applyQuaternion(r.quaternion).add(r.position);
    obj.quaternion.premultiply(r.quaternion);
    obj.updateMatrixWorld(true);
    this.layoutRack();
  }

  /** Boxes that sit on the rack follow it. */
  private layoutRack(): void {
    if (!this.rack) return;
    const obj = this.rack.object3D!;
    obj.updateMatrixWorld(true);
    for (const b of this.boxes) {
      if (b.state !== 'rack') continue;
      b.mesh.position.copy(b.slotPos).applyMatrix4(obj.matrixWorld);
      b.mesh.quaternion.copy(obj.quaternion).multiply(b.slotQuat);
    }
    const cam = this.snapCam;
    if (cam && cam.state === 'home') {
      cam.group.position.copy(cam.homePos).applyMatrix4(obj.matrixWorld);
      cam.group.quaternion.copy(obj.quaternion).multiply(cam.homeQuat);
    }
    this.shadowDirty = true;
  }

  /** The rack is out while no kit is being built; any box that's out goes home either way. */
  private syncRack(): void {
    if (!this.rack) return;
    const show = !this.kit;
    this.rack.object3D!.visible = show;
    for (const b of this.boxes) {
      if (b.state === 'opening') continue;
      if (b.state !== 'rack') {
        this.returnBox(b);
        b.state = 'rack';
        b.mesh.scale.setScalar(1);
      }
      b.mesh.visible = show;
    }
    if (this.snapCam) {
      for (const h of this.hands) if (h.camera) this.releaseCamera(h);
      this.snapCam.state = 'home';
      this.snapCam.group.visible = show;
    }
    this.layoutMyBoxes();
  }

  private rackShown(): boolean {
    return !!this.rack && this.rack.object3D!.visible;
  }

  /** Render each kit's model into its box art, one kit at a time, in a throwaway context. */
  private async paintBoxes(): Promise<void> {
    let art: ArtRenderer | null = null;
    try {
      for (const box of [...this.boxes]) {
        art ??= new ArtRenderer();
        const photo = box.kit.mine ? await this.photoCanvas(this.myBoxes.find((m) => m.id === box.kit.id)?.photo) : null;
        await this.paintBox(box, art, photo);
        await new Promise((r) => setTimeout(r, 0)); // let a frame through between kits
      }
    } catch (err) {
      console.warn('Box art failed', err);
    } finally {
      art?.dispose();
    }
  }

  /** Front and back art for one box; your boxes use your photo on the front. */
  private async paintBox(box: KitBox, art: ArtRenderer, photo: HTMLCanvasElement | null): Promise<void> {
    const steps = await this.kitSteps(box.kit.id);
    const pieces: ArtPiece[] = [];
    for (const b of steps.flat()) {
      const p = this.kitPiece(b, 0, 0);
      if (p) pieces.push({ geometry: this.lib.geometries[p.part], material: this.matFor(0, p.color), matrix: p.m });
    }
    box.paint(photo ?? art.render(pieces, 'front'), art.render(pieces, 'back'), steps.length);
  }

  private photoCanvas(src: string | undefined): Promise<HTMLCanvasElement | null> {
    if (!src) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d')!.drawImage(img, 0, 0);
        resolve(c);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // ---- box camera

  private holdCamera(h: HandState, btn: Btn): void {
    const cam = this.snapCam!;
    for (const o of this.hands) if (o !== h && o.camera) o.camera = false;
    cam.state = 'held';
    h.camera = true;
    h.holdButton = btn;
    h.anchorDist = -1;
    h.target = null;
    this.tick(0.3);
    if (h.mode === 'mouse') {
      h.rotTarget.identity();
      h.offsetQuat.identity();
      return;
    }
    // In the hand, screen toward the eyes (the lens faces the way you're looking).
    this.q1.copy(h.quat).invert();
    const pos = this.v3.copy(h.point).addScaledVector(h.rayDir, 0.06);
    this.player.head.getWorldPosition(this.v4).sub(pos);
    const q = this.q2.setFromAxisAngle(this.up, Math.atan2(this.v4.x, this.v4.z));
    h.offsetQuat.copy(this.q1).multiply(q);
    h.offsetPos.copy(pos).sub(h.point).applyQuaternion(this.q1);
  }

  private carryCamera(h: HandState, delta: number): void {
    const obj = this.snapCam!.group;
    if (h.mode === 'mouse') {
      // Desktop: it floats just in front of the view, looking where you look.
      this.v1.copy(h.rayOrigin).addScaledVector(h.rayDir, 0.3);
      this.q1.copy(h.quat);
    } else {
      this.v1.copy(h.offsetPos).applyQuaternion(h.quat).add(h.point);
      this.q1.copy(h.quat).multiply(h.offsetQuat);
    }
    const a = 1 - Math.exp(-delta * (h.mode === 'hand' ? FOLLOW_HAND : FOLLOW_CTRL));
    obj.position.lerp(this.v1, a);
    obj.quaternion.slerp(this.q1, a);
    obj.updateMatrixWorld(true);
    // Shutter: A/X, or trigger when it's held by the grip; Space on the desktop.
    const shoot = h.down.has('a') || (h.holdButton === 'squeeze' && h.down.has('trigger')) || (h.mode === 'mouse' && this.desktop.actions.has('shoot'));
    if (shoot) this.shootBox();
  }

  private releaseCamera(h: HandState): void {
    const cam = this.snapCam!;
    h.camera = false;
    h.holdButton = null;
    cam.fromPos.copy(cam.group.position);
    cam.fromQuat.copy(cam.group.quaternion);
    cam.t = 0;
    cam.state = 'returning';
    cam.drawScreen(null, '#2a2f3a', 'Hold me up to your build');
    // The viewfinder's own GL context only lives while the camera is in hand.
    this.viewArt?.dispose();
    this.viewArt = null;
    this.viewGroup = null;
    this.tick(0.2);
  }

  /** Each frame: fly home, poke-to-shoot with the other hand, and the viewfinder while held. */
  private tickCamera(delta: number): void {
    const cam = this.snapCam;
    if (!cam || !cam.group.visible) return;
    if (cam.state === 'returning') {
      cam.t = Math.min(1, cam.t + delta / 0.35);
      const e = 1 - (1 - cam.t) ** 3;
      const rack = this.rack!.object3D!;
      this.v1.copy(cam.homePos).applyMatrix4(rack.matrixWorld);
      this.q1.copy(rack.quaternion).multiply(cam.homeQuat);
      cam.group.position.lerpVectors(cam.fromPos, this.v1, e);
      cam.group.quaternion.slerpQuaternions(cam.fromQuat, this.q1, e);
      if (cam.t >= 1) cam.state = 'home';
      this.shadowDirty = true;
    }
    cam.flash = Math.max(0, cam.flash - delta);
    const holder = this.hands.find((h) => h.camera);
    if (!holder) return;
    // Hands: poke the red button with the other hand's index finger.
    const other = this.hands.find((h) => h !== holder && h.mode === 'hand' && h.hasTip && !h.pieces);
    if (other) {
      const near = other.indexTip.distanceTo(cam.shutter.getWorldPosition(this.v1)) < 0.014;
      if (near && !this.shutterArmed) {
        this.shutterArmed = true;
        this.shootBox();
      } else if (!near) this.shutterArmed = false;
    }
    // Viewfinder: the build as the box art will show it, a few times a second.
    if (++this.viewFrame % 3 !== 0 && cam.flash <= 0) return;
    const caption = !this.placedRecs.length
      ? 'Build something first'
      : holder.mode === 'hand'
        ? 'Poke the red button'
        : holder.mode === 'mouse'
          ? 'Space: take the photo'
          : holder.holdButton === 'squeeze'
            ? 'Trigger or A: take the photo'
            : 'A: take the photo';
    if (!this.placedRecs.length) {
      cam.drawScreen(null, '#2a2f3a', caption);
      return;
    }
    this.viewArt ??= new ArtRenderer();
    const group = this.buildViewGroup();
    const r = this.root.object3D!;
    const pos = r.worldToLocal(cam.group.getWorldPosition(this.v5));
    const quat = this.q3.copy(r.quaternion).invert().multiply(cam.group.getWorldQuaternion(this.q4));
    this.viewArt.renderView(group, pos, quat, VIEW_FOV, cam.view);
    cam.drawScreen(cam.view, this.buildColor(), caption);
  }

  /** The build as meshes for the camera's own renderer (rebuilt when the build changes). */
  private buildViewGroup(): Group {
    if (this.viewGroup && this.viewGen === this.editGen) return this.viewGroup;
    const g = new Group();
    for (const rec of this.placedRecs) {
      const m = new Mesh(this.lib.geometries[rec.part], this.matFor(rec.finish, rec.color));
      m.matrixAutoUpdate = false;
      m.matrix.copy(rec.m);
      g.add(m);
    }
    this.viewGroup = g;
    this.viewGen = this.editGen;
    return g;
  }

  /** The most common color in the build, for its box. */
  private buildColor(): string {
    const counts = new Map<number, number>();
    for (const rec of this.placedRecs) counts.set(rec.color, (counts.get(rec.color) ?? 0) + 1);
    let best = 0;
    let n = -1;
    for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
    return this.lib.colors[best]?.hex ?? '#2a2f3a';
  }

  /** The shutter: photograph the build, box it as a kit of your own, and send the box to the rack. */
  private shootBox(): void {
    const cam = this.snapCam!;
    cam.flash = 0.3;
    try {
      this.beep(3200, 0, 0.02, 'square', 0.06);
      this.beep(1800, 0.05, 0.05, 'square', 0.05);
    } catch {
      // audio is best-effort
    }
    for (const hand of HANDS) this.pulse(hand, 0.7, 40);
    if (!this.placedRecs.length) return;
    this.viewArt ??= new ArtRenderer();
    const r = this.root.object3D!;
    const pos = r.worldToLocal(cam.group.getWorldPosition(this.v5));
    const quat = this.q3.copy(r.quaternion).invert().multiply(cam.group.getWorldQuaternion(this.q4));
    const photo = document.createElement('canvas');
    photo.width = photo.height = 640;
    this.viewArt.renderView(this.buildViewGroup(), pos, quat, VIEW_FOV, photo);
    const steps = this.buildSteps();
    const n = this.myBoxes.length + 1;
    const stored: StoredBox = {
      id: `mine-${Date.now().toString(36)}`,
      title: `My build ${n}`,
      color: this.buildColor(),
      pieces: this.placedRecs.length,
      steps,
      photo: photo.toDataURL('image/webp', 0.85),
      at: new Date().toISOString(),
    };
    this.myBoxes.unshift(stored);
    this.saveMyBoxes();
    const box = this.addMyBox(stored);
    box.mesh.visible = true;
    void this.paintBox(box, this.viewArt, photo);
    // The box pops out of the camera and flies to its place on the rack.
    box.fromPos.copy(cam.group.position);
    box.fromQuat.copy(cam.group.quaternion);
    box.mesh.position.copy(box.fromPos);
    box.t = 0;
    box.state = 'returning';
    this.layoutMyBoxes();
    box.mesh.visible = true;
  }

  private saveMyBoxes(): void {
    try {
      localStorage.setItem('stacker.boxes', JSON.stringify(this.myBoxes));
    } catch (err) {
      console.warn('Could not store your boxes', err);
    }
  }

  /** Your build as kit steps: every piece by its transform, bottom up, 3–5 a step. */
  private buildSteps(): KitBlock[][] {
    const L = dims.ldu;
    const items = this.placedRecs.map((rec) => {
      const e = rec.m.elements;
      const box = this.lib.geometries[rec.part].boundingBox!.clone().applyMatrix4(rec.m);
      const block: KitBlock = {
        part: this.lib.parts[rec.part].id,
        color: this.lib.colors[rec.color].code,
        m: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10], e[12] / L, e[13] / L, e[14] / L].map((v) => Math.round(v * 1e5) / 1e5),
      };
      return { block, bottom: Math.round(box.min.y / dims.unit) };
    });
    items.sort((a, b) => a.bottom - b.bottom);
    const steps: KitBlock[][] = [];
    let cur: KitBlock[] = [];
    let lvl: number | null = null;
    for (const it of items) {
      if (cur.length && (cur.length >= 5 || (it.bottom !== lvl && cur.length >= 3))) {
        steps.push(cur);
        cur = [];
      }
      cur.push(it.block);
      lvl = it.bottom;
    }
    if (cur.length) steps.push(cur);
    return steps;
  }

  /** Drop one of your boxes on the library: it's gone (from the rack and this device). */
  private deleteMyBox(box: KitBox): void {
    this.myBoxes = this.myBoxes.filter((m) => m.id !== box.kit.id);
    this.saveMyBoxes();
    this.boxes = this.boxes.filter((b) => b !== box);
    this.kitData.delete(box.kit.id);
    this.boxEntities.get(box)?.destroy();
    this.boxEntities.delete(box);
    this.click();
    this.layoutMyBoxes();
  }

  private holdBox(h: HandState, btn: Btn, box: KitBox): void {
    // Only one box out at a time: another floating one goes back.
    for (const b of this.boxes) if (b !== box && b.state === 'loose') this.returnBox(b);
    const fromRack = box.state === 'rack';
    box.state = 'held';
    h.box = box;
    h.holdButton = btn;
    h.anchorDist = -1;
    h.target = null;
    this.tick(0.3);
    const obj = box.mesh;
    if (h.mode === 'mouse') {
      h.rotTarget.identity();
      h.offsetQuat.identity();
      return;
    }
    this.q1.copy(h.quat).invert();
    if (h.targetFar || (fromRack && h.mode === 'controller')) {
      // Bring it to the hand, front toward the eyes.
      const pos = this.v3.copy(h.point).addScaledVector(h.rayDir, 0.05 + box.w / 2);
      this.player.head.getWorldPosition(this.v4).sub(pos);
      const q = this.q2.setFromAxisAngle(this.up, Math.atan2(this.v4.x, this.v4.z));
      h.offsetQuat.copy(this.q1).multiply(q);
      h.offsetPos.copy(pos).sub(h.point).applyQuaternion(this.q1);
    } else {
      h.offsetQuat.copy(this.q1).multiply(obj.quaternion);
      h.offsetPos.copy(obj.position).sub(h.point).applyQuaternion(this.q1);
    }
  }

  private carryBox(h: HandState, delta: number): void {
    const obj = h.box!.mesh;
    if (h.mode === 'mouse') {
      // Desktop: the box floats in front of the camera; arrows and Q/E turn it.
      const d = this.desktop;
      const quarter = Math.PI / 2;
      if (d.actions.has('spinL')) h.rotTarget.premultiply(this.q2.setFromAxisAngle(this.up, quarter));
      if (d.actions.has('spinR')) h.rotTarget.premultiply(this.q2.setFromAxisAngle(this.up, -quarter));
      if (d.actions.has('tipU')) h.rotTarget.premultiply(this.q2.setFromAxisAngle(this.v2.set(1, 0, 0), -quarter));
      if (d.actions.has('tipD')) h.rotTarget.premultiply(this.q2.setFromAxisAngle(this.v2.set(1, 0, 0), quarter));
      h.offsetQuat.slerp(h.rotTarget, 1 - Math.exp(-delta * 14));
      this.v1.copy(h.rayOrigin).addScaledVector(h.rayDir, 0.42);
      this.q1.copy(h.quat).multiply(h.offsetQuat);
    } else {
      this.v1.copy(h.offsetPos).applyQuaternion(h.quat).add(h.point);
      this.q1.copy(h.quat).multiply(h.offsetQuat);
    }
    const a = 1 - Math.exp(-delta * (h.mode === 'hand' ? FOLLOW_HAND : FOLLOW_CTRL));
    obj.position.lerp(this.v1, a);
    obj.quaternion.slerp(this.q1, a);
  }

  private releaseBox(h: HandState): void {
    const box = h.box!;
    h.box = null;
    h.holdButton = null;
    if (box.kit.mine && this.overLibrary(box.mesh.position)) {
      this.deleteMyBox(box);
      return;
    }
    if (this.overRack(box.mesh.position)) this.returnBox(box);
    else box.state = 'loose';
    this.tick(0.2);
  }

  private overRack(pos: Vector3): boolean {
    if (!this.rackShown()) return false;
    const lo = this.rack!.object3D!.worldToLocal(this.v1.copy(pos));
    return Math.abs(lo.x) < RACK_W / 2 + 0.03 && lo.y > -0.03 && lo.y < RACK_TIER * 3 + 0.06 && Math.abs(lo.z) < RACK_D / 2 + 0.06;
  }

  private returnBox(b: KitBox): void {
    for (const h of this.hands) {
      if (h.box === b) h.box = null;
      if (h.tear === b) h.tear = null;
    }
    b.setTear(0, null);
    b.warn.visible = false;
    b.fromPos.copy(b.mesh.position);
    b.fromQuat.copy(b.mesh.quaternion);
    b.t = 0;
    b.state = 'returning';
  }

  private startTear(h: HandState, btn: Btn, box: KitBox): void {
    h.tear = box;
    h.holdButton = btn;
    h.anchorDist = h.mode !== 'hand' && h.targetFar ? h.target!.score : -1;
    h.tearFrom.copy(this.grabPoint(h));
    h.target = null;
    box.warn.visible = this.placedRecs.length > 0 && !this.kit;
    box.setTear(0.02, h.tearFrom);
    this.tick(0.3);
  }

  private pullTear(h: HandState): void {
    const box = h.tear!;
    const p = this.grabPoint(h);
    const t = Math.min(1, Math.max(0.02, p.distanceTo(h.tearFrom) / TEAR_PULL));
    if (Math.floor(t * 5) > Math.floor(box.tear * 5)) this.tick(0.15 + t * 0.3); // ratchets as it rips
    box.setTear(t, p);
    if (t >= 1) {
      h.tear = null;
      h.holdButton = null;
      this.openBox(box);
    }
  }

  private releaseTear(h: HandState): void {
    const box = h.tear!;
    h.tear = null;
    h.holdButton = null;
    box.setTear(0, null);
    box.warn.visible = false;
  }

  /** Torn open: the box pops, the kit starts, and its parts shelf appears where the box was. */
  private openBox(box: KitBox): void {
    for (const h of this.hands) if (h.box === box) {
      h.box = null;
      h.holdButton = null;
    }
    box.state = 'opening';
    box.t = 0;
    box.setTear(1, null);
    box.warn.visible = false;
    this.player.head.getWorldPosition(this.v4).sub(box.mesh.position);
    this.shelfAt = { pos: box.mesh.position.clone().addScaledVector(this.up, -box.h / 2), yaw: Math.atan2(this.v4.x, this.v4.z) };
    this.chime();
  }

  private tickBoxes(delta: number): void {
    for (const b of this.boxes) {
      if (b.state === 'returning') {
        b.t = Math.min(1, b.t + delta / 0.35);
        const e = 1 - (1 - b.t) ** 3;
        const rack = this.rack!.object3D!;
        this.v1.copy(b.slotPos).applyMatrix4(rack.matrixWorld);
        this.q1.copy(rack.quaternion).multiply(b.slotQuat);
        b.mesh.position.lerpVectors(b.fromPos, this.v1, e);
        b.mesh.quaternion.slerpQuaternions(b.fromQuat, this.q1, e);
        if (b.t >= 1) b.state = 'rack';
        this.shadowDirty = true;
      } else if (b.state === 'opening') {
        b.t = Math.min(1, b.t + delta / 0.32);
        b.mesh.scale.setScalar(b.t < 0.35 ? 1 + b.t * 0.4 : 1.14 * (1 - (b.t - 0.35) / 0.65));
        this.shadowDirty = true;
        if (b.t >= 1) {
          b.mesh.visible = false;
          b.mesh.scale.setScalar(1);
          b.state = 'returning';
          b.t = 1;
          void this.startKit(b.kit.id, b.kit.title);
        }
      }
    }
  }

  // ================================================================ saves

  // ================================================================ undo

  private snapshot(): string {
    return JSON.stringify({ bounds: this.bounds, blocks: (this.serialize() as { blocks: unknown[] }).blocks });
  }

  private busy(): boolean {
    if (this.snaps.length) return true;
    for (const h of this.hands) if (h.pieces || h.painting || h.corner >= 0 || h.slider || h.swing) return true;
    return false;
  }

  /** Once an edit settles (nothing held or animating), remember the state from before it. */
  private settleUndo(): void {
    if (!this.edited || this.kit || this.busy()) return;
    this.edited = false;
    const now = this.snapshot();
    if (now === this.stable) return;
    this.undoStack.push(this.stable);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack.length = 0;
    this.stable = now;
    this.redrawUi((u) => u.id === 'undo' || u.id === 'redo');
  }

  private undo(): void {
    if (this.kit || this.busy() || !this.undoStack.length) return;
    this.redoStack.push(this.stable);
    this.restore(this.undoStack.pop()!);
  }

  private redo(): void {
    if (this.kit || this.busy() || !this.redoStack.length) return;
    this.undoStack.push(this.stable);
    this.restore(this.redoStack.pop()!);
  }

  private restore(state: string): void {
    this.stable = state;
    this.deserialize({ v: 4, ...JSON.parse(state) });
    this.edited = false;
    this.aimKeyLight();
    this.tick(0.2);
    this.redrawUi((u) => u.id === 'undo' || u.id === 'redo' || u.id === 'deselect');
  }

  private serialize(): object {
    return {
      v: 4,
      scale: this.scale,
      bounds: this.bounds,
      blocks: this.placedRecs.map((r) => [
        this.lib.parts[r.part].id,
        this.lib.colors[r.color].code,
        'm',
        ...r.m.elements.map((v) => Math.round(v * 1e5) / 1e5),
        FINISHES[r.finish].id,
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
    for (const row of d.blocks) {
      const [id, code] = row as [string, number];
      const part = this.lib.byId.get(id);
      if (part === undefined) continue;
      const color = this.colorOf(code);
      if (row[2] === 'm') {
        const finish = typeof row[19] === 'string' ? finishIndex(row[19]) : 0;
        this.addPlaced(this.makeRec(part, color, new Matrix4().fromArray(row.slice(3, 19) as number[]), undefined, finish));
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

  /** Soft tick for panel presses by hand or mouse, which have no haptics. */
  private uiTick(): void {
    try {
      this.beep(2200, 0, 0.025, 'sine', 0.05);
    } catch {
      // audio is best-effort
    }
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
