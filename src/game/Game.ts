import * as THREE from "three";
import * as CANNON from "cannon-es";
import { buildSegments, Segment, totalLength, ZoneType } from "./track";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { buildRpgEnvironment, type EnvHandles } from "./environment";
import { animateSlime, createSlime, makeSlimeTexture, type SlimeVisual } from "./slime";

export interface PlayerConfig {
  id: number;
  name: string;
  balls: number;
  color: string;
  color2: string;
}

export interface BallInfo {
  id: number;
  playerId: number;
  number: number; // number within player
  progress: number; // 0..1
  finished: boolean;
  finishTime: number;
  rank: number;
  atk: number;
  clashes: number;
  godMode: boolean;
}

export interface Snapshot {
  time: number;
  balls: BallInfo[];
  leaderId: number;
  finishedCount: number;
  holdLeft: number; // seconds remaining on the HOLD barrier, -1 if not holding
  dishOpen: number; // 0..1 how far the dish iris has opened, -1 if idle
  godLeft: number; // seconds of GOD MODE remaining, 0 if inactive
  godCooldown: number; // seconds until GOD MODE can be used again
  clashCount: number;
}

export interface ZoneMarker {
  icon: string;
  label: string;
  at: number; // 0..1 along the course
}

export interface EventDef {
  id: number;
  zone: ZoneType;
  name: string;
  icon: string;
  desc: string;
  color: number;
}

export const EVENTS: EventDef[] = [
  { id: 1, zone: "meteor", name: "ฝนอุกกาบาต", icon: "☄️", desc: "อุกกาบาตพุ่งชนแล้วระเบิด", color: 0xfb923c },
  { id: 2, zone: "ice", name: "พื้นน้ำแข็ง", icon: "🧊", desc: "ลื่นไถล ควบคุมไม่ได้", color: 0x7dd3fc },
  { id: 3, zone: "gate", name: "ประตูกั้นจังหวะ", icon: "🚧", desc: "ประตูปิด-เปิดเป็นจังหวะ ผู้นำต้องรอ", color: 0xfbbf24 },
  { id: 4, zone: "boost", name: "แผ่นเร่งความเร็ว", icon: "⚡", desc: "เหยียบแล้วพุ่ง! สุ่มตำแหน่ง", color: 0xa3e635 },
  { id: 5, zone: "storm", name: "พายุฟ้าผ่า", icon: "🌩️", desc: "ฟ้าผ่าใส่ผู้นำในโซน", color: 0x818cf8 },
];

export interface GameCallbacks {
  onCountdown: (n: number) => void;
  onGo: () => void;
  onSnapshot: (s: Snapshot) => void;
  onFinish: (ball: BallInfo, rank: number) => void;
  onRaceEnd: () => void;
  onNotice?: (text: string, color: string) => void;
  onClash?: (attacker: BallInfo, victim: BallInfo) => void;
}

interface Ball {
  id: number;
  playerId: number;
  number: number;
  body: CANNON.Body;
  mesh: THREE.Group;
  slime: SlimeVisual;
  seg: number;
  progress: number; // absolute distance
  finished: boolean;
  finishTime: number;
  rank: number;
  stuckTimer: number;
  warps: number;
  boostCd: number;
  onNet: boolean;
  atk: number; // 1..5 attack power
  clashCd: number;
  clashes: number;
  godUntil: number;
  aura?: THREE.Mesh;
}

interface ClashFx {
  sprite: THREE.Sprite;
  ring: THREE.Mesh;
  life: number;
  vy: number;
  size: number;
}

interface Rock {
  body: CANNON.Body;
  mesh: THREE.Mesh;
  life: number;
}

interface Meteor {
  body: CANNON.Body;
  mesh: THREE.Mesh;
  trail: THREE.Mesh;
  exploded: boolean;
  life: number;
}

interface Portal {
  pos: THREE.Vector3;
  ring: THREE.Mesh;
  disc: THREE.Mesh;
  light: THREE.PointLight;
  color: THREE.Color;
}

interface Bolt {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  life: number;
}

interface Eruption {
  mesh: THREE.Mesh; // column
  ring: THREE.Mesh;
  light: THREE.PointLight;
  pos: THREE.Vector3;
  phase: "idle" | "warn" | "erupt";
  timer: number;
}

const BALL_R = 0.35;
const WALL_H = 1.8;
const FLOOR_T = 0.6;
const WALL_T = 0.4;
const PHYS_WALL_H = 7.5; // invisible extra height so balls can't fly out
const MAX_SPEED = 15;
const GOD_SPEED = 32;
const GOD_DURATION = 5;
const GOD_COOLDOWN = 20;
const CLASH_MIN_SPEED = 9; // attacker must be faster than this
const CLASH_REL_SPEED = 3.5; // and closing faster than this
const HOLD_TIME = 8;
const isDish = (s: Segment) => s.zone === "dish";
const DISH_R_OUT = 7.2;
const DISH_R_IN = 3.4;
const DISH_SLOPE = 0.1;
const DISH_HOLE_MAX = 3.4;
const DISH_WAIT = 6;
const DISH_OPEN_TIME = 13;

const ZONE_COLORS: Record<ZoneType, number> = {
  start: 0x38bdf8,
  plain: 0x6366f1,
  rocks: 0xa8a29e,
  lava: 0xf97316,
  spinners: 0xa855f7,
  pegs: 0x22c55e,
  pistons: 0x3b82f6,
  wind: 0x2dd4bf,
  hammers: 0xef4444,
  hold: 0x38bdf8,
  dish: 0xc084fc,
  ramp: 0xfb7185,
  gap: 0x22d3ee,
  landing: 0xfb7185,
  warp: 0xd946ef,
  meteor: 0xfb923c,
  ice: 0x7dd3fc,
  gate: 0xfbbf24,
  storm: 0x818cf8,
  boost: 0xa3e635,
  finish: 0xfacc15,
};

export const ZONE_LABELS: Record<ZoneType, string> = {
  start: "จุดปล่อย",
  plain: "ทางตรง",
  rocks: "หินถล่ม",
  lava: "ลาวาปะทุ",
  spinners: "ใบพัดหมุน",
  pegs: "ดงหมุด",
  pistons: "ลูกสูบผลัก",
  wind: "อุโมงค์ลม",
  hammers: "ค้อนยักษ์",
  hold: "ด่านกักรอ (HOLD)",
  dish: "ถาดหลุมยักษ์",
  ramp: "ทางกระโดด",
  gap: "กระโดดข้ามเหว!",
  landing: "จุดลงจอด",
  warp: "ประตูวาร์ป",
  meteor: "ฝนอุกกาบาต",
  ice: "พื้นน้ำแข็ง",
  gate: "ประตูกั้นจังหวะ",
  storm: "พายุฟ้าผ่า",
  boost: "แผ่นเร่งความเร็ว",
  finish: "เส้นชัย",
};

function makeGridTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = "rgba(120,240,255,0.9)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 122, 122);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, 0);
  ctx.lineTo(64, 128);
  ctx.moveTo(0, 64);
  ctx.lineTo(128, 64);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeChevronTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(10, 90);
  ctx.lineTo(64, 30);
  ctx.lineTo(118, 90);
  ctx.lineTo(118, 118);
  ctx.lineTo(64, 60);
  ctx.lineTo(10, 118);
  ctx.closePath();
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeIceTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#cfefff";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 30; i++) {
    ctx.beginPath();
    let x = Math.random() * 256, y = Math.random() * 256;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeEmojiSprite(emoji: string, size = 128): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.font = `${size * 0.8}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.05);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  sp.renderOrder = 999;
  return sp;
}

function makeFloorTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#5a5045";
  ctx.fillRect(0, 0, 256, 256);
  // cobblestones
  const cell = 32;
  for (let gy = 0; gy < 256 / cell; gy++) {
    for (let gx = 0; gx < 256 / cell; gx++) {
      const x = gx * cell + cell / 2 + (Math.random() - 0.5) * 6;
      const y = gy * cell + cell / 2 + (Math.random() - 0.5) * 6;
      const rx = cell * 0.42 + Math.random() * 3, ry = cell * 0.38 + Math.random() * 3;
      const v = 120 + Math.random() * 50;
      const warm = Math.random() * 20;
      ctx.fillStyle = `rgb(${v + warm},${v + warm * 0.5},${v - 10})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, Math.random() * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.ellipse(x - 3, y - 4, rx * 0.5, ry * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // moss flecks
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = `rgba(90,140,60,${Math.random() * 0.35})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeBrickTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#6e675c";
  ctx.fillRect(0, 0, 256, 128);
  const bw = 64, bh = 32;
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 5; col++) {
      const v = 150 + Math.random() * 45;
      ctx.fillStyle = `rgb(${v},${v - 8},${v - 22})`;
      ctx.fillRect(col * bw + off + 3, row * bh + 3, bw - 6, bh - 6);
      if (Math.random() < 0.3) {
        ctx.fillStyle = `rgba(80,130,60,${Math.random() * 0.4})`;
        ctx.fillRect(col * bw + off + 3, row * bh + bh - 12, bw - 6, 9);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeCheckerTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#f5f5f4" : "#1c1917";
      ctx.fillRect(x * 32, y * 32, 32, 32);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world: CANNON.World;
  private segs: Segment[];
  private total: number;
  private balls: Ball[] = [];
  private players: PlayerConfig[];
  private cb: GameCallbacks;
  private raf = 0;
  private lastT = 0;
  private time = 0; // race time
  private physTime = 0;
  private running = true;
  private raceStarted = false;
  private raceEnded = false;
  private countdownLeft = 3.9;
  private lastCountdown = -1;
  private snapshotTimer = 0;
  private finishOrder: Ball[] = [];
  private firstFinishTime = -1;
  private isMobile: boolean;

  // materials
  private ballPhysMat = new CANNON.Material("ball");
  private trackPhysMat = new CANNON.Material("track");
  private bumperPhysMat = new CANNON.Material("bumper");
  private icePhysMat = new CANNON.Material("ice");
  private composer?: EffectComposer;
  private bloom?: UnrealBloomPass;
  activeEvents: EventDef[] = [];
  private meteors: Meteor[] = [];
  private meteorTimer = 0;
  private portals: Portal[] = [];
  private boostPads: { pos: THREE.Vector3; mesh: THREE.Mesh }[] = [];
  private bolts: Bolt[] = [];
  private stormTimer = 0;
  private stormLight?: THREE.PointLight;
  private gateState = { closed: false, timer: 0, lights: [] as THREE.Mesh[] };
  private crown: THREE.Sprite;
  private clashFx: ClashFx[] = [];
  private clashTex?: THREE.CanvasTexture;
  private clashCount = 0;
  private godUntil = 0;
  private godReadyAt = 0;
  private godBalls: Ball[] = [];
  private ballById = new Map<number, Ball>();
  // orbit camera (user-controlled)
  private orbitYaw = 0;
  private orbitPitch = 0;
  private orbitActive = false;
  private orbitIdle = 0;
  private dragging = false;
  private lastPtr = { x: 0, y: 0 };
  private canvasEl: HTMLCanvasElement;
  private hold = { state: "idle" as "idle" | "holding" | "open", timer: 0, segIndex: -1, body: null as CANNON.Body | null, base: new THREE.Vector3(), label: null as THREE.Sprite | null, labelCanvas: null as HTMLCanvasElement | null, labelTex: null as THREE.CanvasTexture | null, lastNum: -1, barrier: null as THREE.Mesh | null };
  private dish = { state: "idle" as "idle" | "waiting" | "opening" | "open", timer: 0, d: 0, segIndex: -1, center: new THREE.Vector3(), yC: 0, dh: new THREE.Vector3(), right: new THREE.Vector3(), petals: [] as { body: CANNON.Body; dirR: THREE.Vector3 }[], glow: null as THREE.Mesh | null, rune: null as THREE.Mesh | null, label: null as THREE.Sprite | null };
  private camMarker: THREE.Sprite;
  private embers: THREE.Points;
  private gate?: CANNON.Body;
  private gateMesh?: THREE.Mesh;

  // camera
  cameraMode: "leader" | number = "leader";
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private sun: THREE.DirectionalLight;
  private env: EnvHandles;

  // obstacles
  private rocks: Rock[] = [];
  private rockTimer = 0;
  private rockGeo = new THREE.DodecahedronGeometry(1, 0);
  private rockMat = new THREE.MeshStandardMaterial({ color: 0x6b6b70, roughness: 0.95, flatShading: true });
  private eruptions: Eruption[] = [];
  private lavaTimer = 0;
  private kinematics: { body: CANNON.Body; mesh: THREE.Object3D; update: (t: number, dt: number) => void }[] = [];
  private windParticles?: THREE.Points;
  private windDir = 1;
  private windForce = 0;
  private windSeg?: Segment;
  private sparks: THREE.Points;
  private sparkVel: Float32Array;
  private sparkLife: Float32Array;

  constructor(canvas: HTMLCanvasElement, players: PlayerConfig[], cb: GameCallbacks) {
    this.players = players;
    this.cb = cb;
    this.canvasEl = canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onPtrDown);
    window.addEventListener("pointermove", this.onPtrMove);
    window.addEventListener("pointerup", this.onPtrUp);
    window.addEventListener("pointercancel", this.onPtrUp);
    this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.isMobile, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
    this.scene.fog = new THREE.Fog(0xcfe3f5, 70, 260);

    // lights
    const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x5a7a3a, 0.9);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
    this.sun.castShadow = true;
    const sm = this.isMobile ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 200;
    const sb = 32;
    this.sun.shadow.camera.left = -sb;
    this.sun.shadow.camera.right = sb;
    this.sun.shadow.camera.top = sb;
    this.sun.shadow.camera.bottom = -sb;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // physics
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = false;
    (this.world.solver as CANNON.GSSolver).iterations = 8;
    this.world.defaultContactMaterial.friction = 0.3;
    this.world.defaultContactMaterial.restitution = 0.3;
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.ballPhysMat, this.trackPhysMat, { friction: 0.35, restitution: 0.85 })
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.ballPhysMat, this.ballPhysMat, { friction: 0.1, restitution: 0.95 })
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.ballPhysMat, this.bumperPhysMat, { friction: 0.02, restitution: 0.98 })
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.ballPhysMat, this.icePhysMat, { friction: 0.0, restitution: 0.4 })
    );

    this.world.addEventListener("preStep", () => {
      this.physTime += 1 / 60;
      for (const k of this.kinematics) k.update(this.physTime, 1 / 60);
      if (this.windForce !== 0) {
        const s = this.windSeg!;
        for (const b of this.balls) {
          if (b.finished || b.seg !== s.index) continue;
          b.body.applyForce(new CANNON.Vec3(s.right.x * this.windForce, 0, s.right.z * this.windForce));
        }
      }
      // GOD MODE thrust
      if (this.godBalls.length) {
        for (const b of this.godBalls) {
          if (b.finished) continue;
          const s = this.segs[b.seg];
          const v = b.body.velocity;
          const along = v.x * s.dir.x + v.y * s.dir.y + v.z * s.dir.z;
          if (along < GOD_SPEED) b.body.applyForce(new CANNON.Vec3(s.dir.x * 60, 0, s.dir.z * 60));
        }
      }
    });
    this.world.addEventListener("beginContact", (e: { bodyA: CANNON.Body; bodyB: CANNON.Body }) => {
      const a = this.ballById.get(e.bodyA.id);
      const b = this.ballById.get(e.bodyB.id);
      if (a && b) this.tryClash(a, b);
    });

    this.segs = buildSegments();
    this.total = totalLength(this.segs);

    // roll random events for this run (each ~55%, at least 2)
    let picked = EVENTS.filter(() => Math.random() < 0.55);
    while (picked.length < 2) {
      const rest = EVENTS.filter((e) => !picked.includes(e));
      picked.push(rest[Math.floor(Math.random() * rest.length)]);
    }
    picked = picked.sort((a, b) => a.id - b.id);
    this.activeEvents = picked;
    for (const s of this.segs) {
      if (s.event) {
        const ev = picked.find((e) => e.id === s.event);
        if (ev) s.zone = ev.zone;
      }
    }

    // environment reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    // post-processing bloom (desktop only)
    if (!this.isMobile) {
      const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.5, 0.88);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.buildEnvironment();
    this.buildTrack();
    this.buildObstacles();
    this.buildBalls();

    // sparks particle pool
    const N = 240;
    const pos = new Float32Array(N * 3);
    this.sparkVel = new Float32Array(N * 3);
    this.sparkLife = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xffb347, size: 0.35, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);

    // embers floating in the air
    const EN = this.isMobile ? 120 : 260;
    const ep = new Float32Array(EN * 3);
    for (let i = 0; i < EN; i++) ep.set([0, -1000, 0], i * 3);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", new THREE.BufferAttribute(ep, 3));
    this.embers = new THREE.Points(
      eg,
      new THREE.PointsMaterial({ color: 0xf7ffb0, size: 0.14, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.embers.frustumCulled = false;
    this.scene.add(this.embers);

    // leader crown + camera marker
    this.crown = makeEmojiSprite("👑");
    this.crown.scale.set(0.9, 0.9, 1);
    this.scene.add(this.crown);
    this.camMarker = makeEmojiSprite("🔻");
    this.camMarker.scale.set(0.7, 0.7, 1);
    this.camMarker.visible = false;
    this.scene.add(this.camMarker);

    // initial camera
    const s0 = this.segs[0];
    this.camPos.copy(s0.a).addScaledVector(s0.dir, -14).add(new THREE.Vector3(0, 9, 0));
    this.camLook.copy(s0.a).addScaledVector(s0.dir, 8);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.env = buildRpgEnvironment(this.scene, this.segs, this.isMobile);

    window.addEventListener("resize", this.onResize);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------- helpers ----------
  private segPoint(s: Segment, t: number, lateral: number, h: number, out = new THREE.Vector3()) {
    return out.copy(s.a).addScaledVector(s.dir, t).addScaledVector(s.right, lateral).addScaledVector(s.up, h);
  }

  private addStaticBox(
    size: THREE.Vector3,
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    material: THREE.Material,
    opts: { shadow?: boolean; receive?: boolean; physics?: boolean; physSize?: THREE.Vector3; physOffset?: THREE.Vector3; physMat?: CANNON.Material; invisible?: boolean } = {}
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    mesh.castShadow = opts.shadow ?? false;
    mesh.receiveShadow = opts.receive ?? true;
    if (opts.invisible) mesh.visible = false;
    this.scene.add(mesh);
    if (opts.physics !== false) {
      const ps = opts.physSize ?? size;
      const body = new CANNON.Body({ mass: 0, material: opts.physMat ?? this.trackPhysMat });
      body.addShape(new CANNON.Box(new CANNON.Vec3(ps.x / 2, ps.y / 2, ps.z / 2)));
      const pp = pos.clone();
      if (opts.physOffset) pp.add(opts.physOffset);
      body.position.set(pp.x, pp.y, pp.z);
      body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      this.world.addBody(body);
    }
    return mesh;
  }

  /** wall box between two points on the track surface */
  private addWallBetween(A: THREE.Vector3, B: THREE.Vector3, material: THREE.Material, glow = false, faceTo?: THREE.Vector3) {
    const len = A.distanceTo(B) + WALL_T;
    const obj = new THREE.Object3D();
    obj.position.copy(A).add(B).multiplyScalar(0.5);
    obj.lookAt(B);
    const c = obj.position.clone().add(new THREE.Vector3(0, WALL_H / 2 - FLOOR_T / 2, 0));
    this.addStaticBox(new THREE.Vector3(WALL_T, WALL_H + FLOOR_T, len), c, obj.quaternion, material, {
      shadow: true,
      physSize: new THREE.Vector3(WALL_T, PHYS_WALL_H + FLOOR_T, len),
      physOffset: new THREE.Vector3(0, (PHYS_WALL_H - WALL_H) / 2, 0),
      physMat: glow ? this.bumperPhysMat : this.trackPhysMat,
    });
    if (glow) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(WALL_T + 0.05, 0.1, len),
        new THREE.MeshStandardMaterial({ color: 0xfb7185, emissive: 0xfb7185, emissiveIntensity: 1.6 })
      );
      strip.position.copy(c).add(new THREE.Vector3(0, (WALL_H + FLOOR_T) / 2 + 0.05, 0));
      strip.quaternion.copy(obj.quaternion);
      this.scene.add(strip);
      // bumper look: a slightly lighter panel
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, WALL_H * 0.5, len - 0.6),
        new THREE.MeshStandardMaterial({ color: 0xfb7185, emissive: 0x9f1239, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.4 })
      );
      panel.position.copy(c).add(new THREE.Vector3(0, WALL_H * 0.05, 0));
      panel.quaternion.copy(obj.quaternion);
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(obj.quaternion);
      const sign = faceTo ? Math.sign(faceTo.clone().sub(obj.position).dot(localX)) || 1 : -1;
      panel.translateX(sign * (WALL_T / 2 + 0.05));
      this.scene.add(panel);
    }
  }

  // ---------- environment ----------
  private buildEnvironment() {
    // (RPG world is built by buildRpgEnvironment after the track exists)
    const lavaLight = new THREE.PointLight(0xff5a10, 1.0, 30, 1.5);
    const lavaSeg = this.segs.find((x) => x.zone === "lava")!;
    lavaLight.position.copy(lavaSeg.a).add(lavaSeg.b).multiplyScalar(0.5).add(new THREE.Vector3(0, 3, 0));
    this.scene.add(lavaLight);
  }

  // ---------- track ----------
  private buildTrack() {
    const floorTex = makeFloorTexture();
    const checker = makeCheckerTexture();
    const brick = makeBrickTexture();
    brick.repeat.set(6, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: brick, color: 0xd8d0c2, roughness: 0.9, metalness: 0.0 });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x8c8474, roughness: 0.95, flatShading: true });

    for (const s of this.segs) {
      if (s.zone === "dish") continue; // built by buildDish()
      const zoneColor = new THREE.Color(ZONE_COLORS[s.zone]);
      const floorLen = s.len + s.mStart + s.mEnd;
      const tex = floorTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(s.width / 3, floorLen / 3);
      let floorMat: THREE.Material;
      let floorPhys: CANNON.Material = this.trackPhysMat;
      if (s.zone === "finish") {
        const c = checker.clone();
        c.needsUpdate = true;
        c.repeat.set(s.width / 2, floorLen / 2);
        floorMat = new THREE.MeshStandardMaterial({ map: c, roughness: 0.6 });
      } else if (s.zone === "gap") {
        const g = makeGridTexture();
        g.repeat.set(s.width / 1.2, floorLen / 1.2);
        floorMat = new THREE.MeshBasicMaterial({ map: g, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      } else if (s.zone === "ice") {
        const it = makeIceTexture();
        it.repeat.set(s.width / 4, floorLen / 4);
        floorMat = new THREE.MeshPhysicalMaterial({ map: it, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, color: 0xbfe8ff });
        floorPhys = this.icePhysMat;
      } else if (s.zone === "ramp" || s.zone === "landing") {
        floorMat = new THREE.MeshStandardMaterial({ map: tex, color: new THREE.Color(0xffffff).lerp(zoneColor, 0.35), roughness: 0.7, metalness: 0.1 });
      } else {
        floorMat = new THREE.MeshStandardMaterial({ map: tex, color: new THREE.Color(0xffffff).lerp(zoneColor, 0.18), roughness: 0.9, metalness: 0.0 });
      }

      const mid = s.a.clone().add(s.b).multiplyScalar(0.5);
      const floorCenter = mid
        .clone()
        .addScaledVector(s.dir, (s.mEnd - s.mStart) / 2)
        .addScaledVector(s.up, -FLOOR_T / 2);
      if (s.zone === "gap") {
        // thin "energy net" plane + physics box
        const net = new THREE.Mesh(new THREE.PlaneGeometry(s.width, floorLen), floorMat);
        net.position.copy(mid).addScaledVector(s.up, 0.02);
        net.quaternion.copy(s.quat);
        net.rotateX(-Math.PI / 2);
        this.scene.add(net);
        const body = new CANNON.Body({ mass: 0, material: this.trackPhysMat });
        body.addShape(new CANNON.Box(new CANNON.Vec3(s.width / 2, FLOOR_T / 2, floorLen / 2)));
        body.position.set(floorCenter.x, floorCenter.y, floorCenter.z);
        body.quaternion.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
        this.world.addBody(body);
      } else {
        this.addStaticBox(new THREE.Vector3(s.width, FLOOR_T, floorLen), floorCenter, s.quat, floorMat, { receive: true, physMat: floorPhys });
      }
      // side glow underside (edge light)
      if (s.zone !== "gap") {
        const under = new THREE.Mesh(
          new THREE.BoxGeometry(s.width + 0.9, 0.12, floorLen),
          new THREE.MeshStandardMaterial({ color: zoneColor, emissive: zoneColor, emissiveIntensity: 0.9 })
        );
        under.position.copy(floorCenter).addScaledVector(s.up, -FLOOR_T / 2 - 0.02);
        under.quaternion.copy(s.quat);
        this.scene.add(under);
      }

      // walls
      for (const side of [-1, 1]) {
        // side -1 = left, +1 = right
        let extS = 0.05;
        let extE = 0.05;
        if (s.turnStart !== 0) {
          const outer = (s.turnStart === 1 && side === 1) || (s.turnStart === -1 && side === -1);
          extS = outer ? s.mStart + WALL_T : -s.mStart;
        }
        if (s.turnEnd !== 0) {
          const outer = (s.turnEnd === 1 && side === 1) || (s.turnEnd === -1 && side === -1);
          extE = outer ? s.mEnd + WALL_T : -s.mEnd;
        }
        const nextSeg = this.segs[s.index + 1];
        if (nextSeg && nextSeg.zone === "dish") extE = 1.4; // collar into the dish
        const underDish = s.index > 0 && isDish(this.segs[s.index - 1]);
        const physH = underDish ? 4.0 : PHYS_WALL_H; // don't poke through the dish above
        const Lw = s.len + extS + extE;
        const c = mid
          .clone()
          .addScaledVector(s.dir, (extE - extS) / 2)
          .addScaledVector(s.right, side * (s.width / 2 + WALL_T / 2))
          .addScaledVector(s.up, WALL_H / 2 - FLOOR_T / 2);
        this.addStaticBox(new THREE.Vector3(WALL_T, WALL_H, Lw), c, s.quat, wallMat, {
          shadow: true,
          receive: true,
          physSize: new THREE.Vector3(WALL_T, physH, Lw),
          physOffset: s.up.clone().multiplyScalar((physH - WALL_H) / 2),
        });
        // glowing strip on top
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(WALL_T + 0.05, 0.1, Lw),
          new THREE.MeshStandardMaterial({ color: zoneColor, emissive: zoneColor, emissiveIntensity: 1.6, roughness: 0.4 })
        );
        strip.position.copy(c).addScaledVector(s.up, WALL_H / 2 + 0.05);
        strip.quaternion.copy(s.quat);
        this.scene.add(strip);
      }

      // full-width 45° mirror wall across the corner (deflects balls into the new direction)
      if (s.index > 0 && s.turnStart !== 0) {
        const p = this.segs[s.index - 1];
        const nPrev = p.right.clone().multiplyScalar(s.turnStart === 1 ? 1 : -1);
        const nNext = s.right.clone().multiplyScalar(s.turnStart === 1 ? 1 : -1);
        const A = s.a.clone().addScaledVector(p.dir, -p.width / 2).addScaledVector(nPrev, p.width / 2 + WALL_T / 2);
        const B = s.a.clone().addScaledVector(s.dir, s.width / 2).addScaledVector(nNext, s.width / 2 + WALL_T / 2);
        this.addWallBetween(A, B, wallMat, true, s.a.clone().addScaledVector(s.dir, s.width / 4).addScaledVector(p.dir, -p.width / 4));
      }

      // funnel walls at straight width transitions
      if (s.index > 0 && s.turnStart === 0 && !isDish(this.segs[s.index - 1])) {
        const p = this.segs[s.index - 1];
        if (Math.abs(p.width - s.width) > 0.01) {
          const dw = (p.width - s.width) / 2;
          for (const side of [-1, 1]) {
            const A = s.a.clone().addScaledVector(s.right, side * (p.width / 2 + WALL_T / 2));
            const B = s.a.clone().addScaledVector(s.right, side * (s.width / 2 + WALL_T / 2));
            if (dw > 0) A.addScaledVector(p.dir, -dw - 0.3);
            else B.addScaledVector(s.dir, -dw + 0.3);
            this.addWallBetween(A, B, wallMat);
          }
        }
      }

      // start back wall (also under the dish drop)
      if (s.index === 0 || isDish(this.segs[s.index - 1])) {
        const c = s.a.clone().addScaledVector(s.dir, -0.2).addScaledVector(s.up, WALL_H / 2);
        const ph = s.index === 0 ? PHYS_WALL_H : 4.0;
        this.addStaticBox(new THREE.Vector3(s.width + WALL_T * 2, WALL_H, WALL_T), c, s.quat, wallMat, {
          shadow: true,
          physSize: new THREE.Vector3(s.width + WALL_T * 2, ph, WALL_T),
          physOffset: s.up.clone().multiplyScalar((ph - WALL_H) / 2),
        });
      }
      // finish end wall (catch)
      if (s.index === this.segs.length - 1) {
        const c = s.b.clone().addScaledVector(s.dir, 0.4).addScaledVector(s.up, WALL_H);
        this.addStaticBox(new THREE.Vector3(s.width + WALL_T * 2, WALL_H * 2, WALL_T), c, s.quat, wallMat, { shadow: true });
      }

      // decorative pillars
      const nP = s.zone === "gap" ? 0 : Math.max(1, Math.floor(s.len / 14));
      for (let i = 0; i < nP; i++) {
        const t = ((i + 0.5) / nP) * s.len;
        const p = this.segPoint(s, t, 0, -FLOOR_T);
        const h = p.y + 6;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.2, h, 6), pillarMat);
        pillar.position.set(p.x, p.y - h / 2, p.z);
        this.scene.add(pillar);
      }
    }

    // start gate (kinematic wall that lifts)
    const s0 = this.segs[0];
    const gatePos = this.segPoint(s0, 12, 0, WALL_H / 2);
    const gate = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.trackPhysMat });
    gate.addShape(new CANNON.Box(new CANNON.Vec3(s0.width / 2, WALL_H / 2, 0.15)));
    gate.position.set(gatePos.x, gatePos.y, gatePos.z);
    gate.quaternion.set(s0.quat.x, s0.quat.y, s0.quat.z, s0.quat.w);
    this.world.addBody(gate);
    this.gate = gate;
    const gm = new THREE.Mesh(
      new THREE.BoxGeometry(s0.width, WALL_H, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x38bdf8, emissiveIntensity: 0.8, transparent: true, opacity: 0.75 })
    );
    gm.position.copy(gatePos);
    gm.quaternion.copy(s0.quat);
    gm.castShadow = true;
    this.scene.add(gm);
    this.gateMesh = gm;

    // finish arch
    const sf = this.segs[this.segs.length - 1];
    const archMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 12), archMat);
      post.position.copy(this.segPoint(sf, sf.len - 2, side * (sf.width / 2 + 0.6), 3));
      this.scene.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(sf.width + 1.7, 0.6, 0.6), archMat);
    beam.position.copy(this.segPoint(sf, sf.len - 2, 0, 6));
    beam.quaternion.copy(sf.quat);
    this.scene.add(beam);
    const flagGeo = new THREE.PlaneGeometry(sf.width + 1.2, 1.4);
    const flagTex = makeCheckerTexture();
    flagTex.repeat.set(4, 1);
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide }));
    flag.position.copy(this.segPoint(sf, sf.len - 2, 0, 5));
    flag.quaternion.copy(sf.quat);
    this.scene.add(flag);
  }

  // ---------- obstacles ----------
  private findSeg(zone: ZoneType) {
    return this.segs.find((s) => s.zone === zone)!;
  }

  private buildObstacles() {
    // ---- lava eruption pool ----
    const lavaSeg = this.findSeg("lava");
    for (let i = 0; i < 6; i++) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 1.3, 5, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      col.visible = false;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.7, 24),
        new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.visible = false;
      const light = new THREE.PointLight(0xff6a00, 0, 12, 2);
      this.scene.add(col, ring, light);
      this.eruptions.push({ mesh: col, ring, light, pos: new THREE.Vector3(), phase: "idle", timer: 0 });
    }
    // lava zone decoration: cracks glow
    for (let i = 0; i < 10; i++) {
      const crack = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4 + Math.random() * 0.6, 1.5 + Math.random() * 2.5),
        new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.55 })
      );
      crack.position.copy(this.segPoint(lavaSeg, 3 + Math.random() * (lavaSeg.len - 6), (Math.random() - 0.5) * (lavaSeg.width - 1.5), 0.02));
      crack.quaternion.copy(lavaSeg.quat);
      crack.rotateX(-Math.PI / 2);
      crack.rotateZ(Math.random() * Math.PI);
      this.scene.add(crack);
    }

    // ---- spinners ----
    const sp = this.findSeg("spinners");
    const spinMat = new THREE.MeshStandardMaterial({ color: 0xc084fc, emissive: 0x7e22ce, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.3 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.7, roughness: 0.4 });
    [0.25, 0.5, 0.75].forEach((f, i) => {
      const center = this.segPoint(sp, sp.len * f, 0, 0.45);
      const half = new CANNON.Vec3(sp.width * 0.4, 0.3, 0.22);
      const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.trackPhysMat });
      body.addShape(new CANNON.Box(half));
      body.position.set(center.x, center.y, center.z);
      body.quaternion.set(sp.quat.x, sp.quat.y, sp.quat.z, sp.quat.w);
      const w = (i % 2 === 0 ? 1 : -1) * 2.6;
      body.angularVelocity.set(sp.up.x * w, sp.up.y * w, sp.up.z * w);
      this.world.addBody(body);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), spinMat);
      mesh.castShadow = true;
      this.scene.add(mesh);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.4, 10), postMat);
      post.position.copy(this.segPoint(sp, sp.len * f, 0, 0.4));
      post.quaternion.copy(sp.quat);
      this.scene.add(post);
      this.kinematics.push({ body, mesh, update: () => {} });
    });

    // ---- pegs ----
    const pg = this.findSeg("pegs");
    const pegMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x166534, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.35 });
    const pegGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 10);
    const rows = Math.floor((pg.len - 6) / 4);
    for (let r = 0; r < rows; r++) {
      const t = 4 + r * 4;
      const offset = r % 2 ? 1.5 : 0;
      for (let l = -pg.width / 2 + 1.5 + offset; l < pg.width / 2 - 1; l += 3) {
        const p = this.segPoint(pg, t, l, 0.5);
        const body = new CANNON.Body({ mass: 0, material: this.trackPhysMat });
        body.addShape(new CANNON.Cylinder(0.3, 0.3, 1.2, 8));
        body.position.set(p.x, p.y, p.z);
        body.quaternion.set(pg.quat.x, pg.quat.y, pg.quat.z, pg.quat.w);
        this.world.addBody(body);
        const m = new THREE.Mesh(pegGeo, pegMat);
        m.position.copy(p);
        m.quaternion.copy(pg.quat);
        m.castShadow = true;
        this.scene.add(m);
      }
    }

    // ---- pistons ----
    const ps = this.findSeg("pistons");
    const pistonMat = new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x1d4ed8, emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.3 });
    const nPist = 4;
    for (let i = 0; i < nPist; i++) {
      const t = ps.len * ((i + 1) / (nPist + 1));
      const side = i % 2 === 0 ? -1 : 1;
      const halfLat = 1.5;
      const half = new CANNON.Vec3(halfLat, 0.6, 0.6);
      const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.trackPhysMat });
      body.addShape(new CANNON.Box(half));
      body.quaternion.set(ps.quat.x, ps.quat.y, ps.quat.z, ps.quat.w);
      const start = this.segPoint(ps, t, side * (ps.width / 2 + halfLat), 0.6);
      body.position.set(start.x, start.y, start.z);
      this.world.addBody(body);
      const group = new THREE.Group();
      const head = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), pistonMat);
      head.castShadow = true;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 8, 10), postMat);
      rod.rotation.z = Math.PI / 2;
      rod.position.x = -side * 4; // local X = -right (lookAt makes +Z face the target)
      group.add(head, rod);
      this.scene.add(group);
      const phase = i * 1.3;
      const travel = ps.width - 1.3; // leaves ~1.3 gap
      const tmp = new THREE.Vector3();
      this.kinematics.push({
        body,
        mesh: group,
        update: (time, dt) => {
          const k = (1 - Math.cos(time * 1.7 + phase)) / 2; // 0..1
          const lat = side * (ps.width / 2 + halfLat) - side * travel * k;
          this.segPoint(ps, t, lat, 0.6, tmp);
          body.velocity.set((tmp.x - body.position.x) / dt, (tmp.y - body.position.y) / dt, (tmp.z - body.position.z) / dt);
        },
      });
    }

    // ---- wind ----
    const wd = this.findSeg("wind");
    const N = 160;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const p = this.segPoint(wd, Math.random() * wd.len, (Math.random() - 0.5) * wd.width, 0.2 + Math.random() * 2.5);
      pos.set([p.x, p.y, p.z], i * 3);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.windParticles = new THREE.Points(wg, new THREE.PointsMaterial({ color: 0x99f6e4, size: 0.18, transparent: true, opacity: 0.7, depthWrite: false }));
    this.windParticles.frustumCulled = false;
    this.scene.add(this.windParticles);
    // fans decoration
    const fanMat = new THREE.MeshStandardMaterial({ color: 0x14b8a6, emissive: 0x0f766e, emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const fan = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.18, 8, 24), fanMat);
      fan.position.copy(this.segPoint(wd, wd.len * ((i + 1) / 4), -(wd.width / 2 + 0.8), 1.6));
      fan.quaternion.copy(wd.quat);
      fan.rotateY(Math.PI / 2);
      this.scene.add(fan);
      const fan2 = fan.clone();
      fan2.position.copy(this.segPoint(wd, wd.len * ((i + 1) / 4), wd.width / 2 + 0.8, 1.6));
      this.scene.add(fan2);
    }

    // ---- hammers ----
    const hm = this.findSeg("hammers");
    const hammerMat = new THREE.MeshStandardMaterial({ color: 0xf87171, emissive: 0x991b1b, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.35 });
    const nH = 3;
    const L = 4.3;
    const pivotH = 5;
    for (let i = 0; i < nH; i++) {
      const t = hm.len * ((i + 1) / (nH + 1));
      const pivot = this.segPoint(hm, t, 0, pivotH);
      const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.trackPhysMat });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.6, 0.6, 0.7)));
      body.quaternion.set(hm.quat.x, hm.quat.y, hm.quat.z, hm.quat.w);
      const start = this.segPoint(hm, t, 0, pivotH - L);
      body.position.set(start.x, start.y, start.z);
      this.world.addBody(body);
      const group = new THREE.Group();
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.4), hammerMat);
      head.castShadow = true;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, L, 8), postMat);
      arm.position.y = L / 2;
      group.add(head, arm);
      this.scene.add(group);
      // gantry
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, pivotH + 0.5, 8), postMat);
        post.position.copy(this.segPoint(hm, t, side * (hm.width / 2 + 0.5), pivotH / 2));
        post.quaternion.copy(hm.quat);
        this.scene.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(hm.width + 1.4, 0.35, 0.35), postMat);
      beam.position.copy(pivot);
      beam.quaternion.copy(hm.quat);
      this.scene.add(beam);
      const phase = i * 1.1;
      const tmp = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const axis = hm.dir.clone();
      this.kinematics.push({
        body,
        mesh: group,
        update: (time, dt) => {
          const th = 1.05 * Math.sin(time * 2.1 + phase);
          tmp.copy(pivot).addScaledVector(hm.right, Math.sin(th) * L).addScaledVector(hm.up, -Math.cos(th) * L);
          body.velocity.set((tmp.x - body.position.x) / dt, (tmp.y - body.position.y) / dt, (tmp.z - body.position.z) / dt);
          q.setFromAxisAngle(axis, -th).multiply(hm.quat);
          body.quaternion.set(q.x, q.y, q.z, q.w);
        },
      });
    }

    this.buildJump();
    this.buildHold();
    this.buildDish();
    this.buildWarp();
    for (const ev of this.activeEvents) this.buildEvent(ev);

    // rocks zone: decorative warning sign + cliff
    const rk = this.findSeg("rocks");
    const cliffMat = new THREE.MeshStandardMaterial({ color: 0x3f3a44, roughness: 1, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.DodecahedronGeometry(2 + Math.random() * 2, 0), cliffMat);
      c.position.copy(this.segPoint(rk, (i / 6) * rk.len + 2, (i % 2 ? 1 : -1) * (rk.width / 2 + 3), 4 + Math.random() * 6));
      c.rotation.set(Math.random(), Math.random(), Math.random());
      this.scene.add(c);
    }
  }


  // ---------- jump ----------
  private buildJump() {
    const ramp = this.findSeg("ramp");
    const gap = this.findSeg("gap");
    const land = this.findSeg("landing");
    // chevrons on ramp
    const chev = makeChevronTexture("#fda4af");
    chev.repeat.set(1, 4);
    const arrows = new THREE.Mesh(
      new THREE.PlaneGeometry(ramp.width - 1.2, ramp.len - 1),
      new THREE.MeshBasicMaterial({ map: chev, transparent: true, opacity: 0.85, depthWrite: false })
    );
    arrows.position.copy(this.segPoint(ramp, ramp.len / 2, 0, 0.03));
    arrows.quaternion.copy(ramp.quat);
    arrows.rotateX(-Math.PI / 2);
    this.scene.add(arrows);
    // lip glow at ramp end
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(ramp.width, 0.15, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xfb7185, emissive: 0xfb7185, emissiveIntensity: 2 })
    );
    lip.position.copy(this.segPoint(ramp, ramp.len - 0.15, 0, 0.05));
    lip.quaternion.copy(ramp.quat);
    this.scene.add(lip);
    // energy net pylons
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 });
    for (const side of [-1, 1]) {
      for (const t of [0, gap.len]) {
        const py = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 3, 8), pylonMat);
        py.position.copy(this.segPoint(gap, t, side * (gap.width / 2 + 0.3), 1.2));
        this.scene.add(py);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
        orb.position.copy(py.position).add(new THREE.Vector3(0, 1.6, 0));
        this.scene.add(orb);
      }
    }
    // landing target rings
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfda4af, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.6 + i * 0.9, 0.9 + i * 0.9, 32), ringMat);
      r.position.copy(this.segPoint(land, 6, 0, 0.03));
      r.quaternion.copy(land.quat);
      r.rotateX(-Math.PI / 2);
      this.scene.add(r);
    }
    // sign
    const sign = makeEmojiSprite("🪂");
    sign.scale.set(2.2, 2.2, 1);
    sign.position.copy(this.segPoint(ramp, 1, 0, 4));
    this.scene.add(sign);
  }

  // ---------- warp ----------
  private buildWarp() {
    const s = this.findSeg("warp");
    const colors = [0xf472b6, 0x22d3ee, 0x4ade80];
    const lats = [-2.6, 0, 2.6];
    for (let i = 0; i < 3; i++) {
      const color = new THREE.Color(colors[i]);
      const pos = this.segPoint(s, s.len * 0.55, lats[i], 0.05);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.0, 0.12, 10, 32),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, metalness: 0.5, roughness: 0.3 })
      );
      ring.position.copy(pos);
      ring.quaternion.copy(s.quat);
      ring.rotateX(Math.PI / 2);
      this.scene.add(ring);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.95, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      disc.position.copy(pos).addScaledVector(s.up, 0.02);
      disc.quaternion.copy(s.quat);
      disc.rotateX(-Math.PI / 2);
      this.scene.add(disc);
      const light = new THREE.PointLight(color, 1.5, 8, 2);
      light.position.copy(pos).addScaledVector(s.up, 1);
      this.scene.add(light);
      this.portals.push({ pos, ring, disc, light, color });
    }
    // arch over warp zone
    const archMat = new THREE.MeshStandardMaterial({ color: 0xd946ef, emissive: 0x86198f, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.3 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(s.width / 2 + 0.6, 0.25, 10, 32, Math.PI), archMat);
    arch.position.copy(this.segPoint(s, 3, 0, 0));
    arch.quaternion.copy(s.quat);
    this.scene.add(arch);
    const sign = makeEmojiSprite("🌀");
    sign.scale.set(2, 2, 1);
    sign.position.copy(this.segPoint(s, 3, 0, s.width / 2 + 1.8));
    this.scene.add(sign);
  }

  // ---------- random events ----------
  private buildEvent(ev: EventDef) {
    const s = this.segs.find((x) => x.event === ev.id)!;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.7, roughness: 0.4 });
    const sign = makeEmojiSprite(ev.icon);
    sign.scale.set(2.2, 2.2, 1);
    sign.position.copy(this.segPoint(s, 1.5, 0, 4));
    this.scene.add(sign);

    if (ev.zone === "meteor") {
      // smoky glow overhead
      const glow = new THREE.PointLight(0xff7a2a, 0.8, 30, 1.5);
      glow.position.copy(this.segPoint(s, s.len / 2, 0, 12));
      this.scene.add(glow);
    } else if (ev.zone === "ice") {
      const crystalMat = new THREE.MeshPhysicalMaterial({ color: 0xbae6fd, transmission: 0.6, roughness: 0.1, thickness: 1, emissive: 0x38bdf8, emissiveIntensity: 0.3 });
      for (let i = 0; i < 10; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.3 + Math.random() * 0.4, 1 + Math.random() * 2, 5), crystalMat);
        const side = i % 2 ? 1 : -1;
        c.position.copy(this.segPoint(s, 2 + Math.random() * (s.len - 4), side * (s.width / 2 + 0.9 + Math.random()), 0.5));
        c.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * Math.PI, (Math.random() - 0.5) * 0.6);
        this.scene.add(c);
      }
    } else if (ev.zone === "gate") {
      const t = s.len * 0.55;
      const center = this.segPoint(s, t, 0, 0.7);
      const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.trackPhysMat });
      body.addShape(new CANNON.Box(new CANNON.Vec3(s.width / 2, 0.7, 0.2)));
      body.position.set(center.x, center.y + 4, center.z);
      body.quaternion.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
      this.world.addBody(body);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(s.width, 1.4, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xb45309, emissiveIntensity: 0.4, metalness: 0.4, roughness: 0.4 })
      );
      mesh.castShadow = true;
      const stripeTex = makeChevronTexture("#1c1917");
      stripeTex.repeat.set(4, 1);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(s.width - 0.2, 1.0), new THREE.MeshBasicMaterial({ map: stripeTex, transparent: true }));
      stripe.position.z = 0.21;
      mesh.add(stripe);
      this.scene.add(mesh);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 6, 10), postMat);
        post.position.copy(this.segPoint(s, t, side * (s.width / 2 + 0.55), 3));
        this.scene.add(post);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
        lamp.position.copy(this.segPoint(s, t, side * (s.width / 2 + 0.55), 6.2));
        this.scene.add(lamp);
        this.gateState.lights.push(lamp);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(s.width + 1.5, 0.3, 0.3), postMat);
      beam.position.copy(this.segPoint(s, t, 0, 6));
      beam.quaternion.copy(s.quat);
      this.scene.add(beam);
      this.gateState.timer = 1 + Math.random() * 3;
      this.gateState.closed = false;
      const tmp = new THREE.Vector3();
      this.kinematics.push({
        body,
        mesh,
        update: (_t, dt) => {
          this.segPoint(s, t, 0, this.gateState.closed ? 0.7 : 4.2, tmp);
          const k = 8;
          body.velocity.set((tmp.x - body.position.x) * k, (tmp.y - body.position.y) * k, (tmp.z - body.position.z) * k);
          void dt;
        },
      });
    } else if (ev.zone === "boost") {
      const padMat = new THREE.MeshStandardMaterial({ color: 0xa3e635, emissive: 0x65a30d, emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.3 });
      const chev = makeChevronTexture("#ecfccb");
      for (let i = 0; i < 4; i++) {
        const t = 3 + ((i + Math.random() * 0.7) / 4) * (s.len - 5);
        const lat = (Math.random() - 0.5) * (s.width - 2.2);
        const pos = this.segPoint(s, t, lat, 0.05);
        const pad = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 1.6), padMat);
        pad.position.copy(pos);
        pad.quaternion.copy(s.quat);
        this.scene.add(pad);
        const arrow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshBasicMaterial({ map: chev, transparent: true }));
        arrow.position.copy(pos).addScaledVector(s.up, 0.07);
        arrow.quaternion.copy(s.quat);
        arrow.rotateX(-Math.PI / 2);
        this.scene.add(arrow);
        this.boostPads.push({ pos, mesh: pad });
      }
    } else if (ev.zone === "storm") {
      const cloudMat = new THREE.MeshStandardMaterial({ color: 0x2b2740, roughness: 1, emissive: 0x1e1b4b, emissiveIntensity: 0.4 });
      for (let i = 0; i < 12; i++) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random() * 1.8, 10, 8), cloudMat);
        c.scale.y = 0.55;
        c.position.copy(this.segPoint(s, Math.random() * s.len, (Math.random() - 0.5) * (s.width + 6), 8 + Math.random() * 2));
        this.scene.add(c);
      }
      this.stormLight = new THREE.PointLight(0xc7d2fe, 0, 40, 1.5);
      this.stormLight.position.copy(this.segPoint(s, s.len / 2, 0, 8));
      this.scene.add(this.stormLight);
      this.stormTimer = 2;
    }
  }

  // ---------- balls ----------
  private buildBalls() {
    const s0 = this.segs[0];
    let id = 0;
    const list: { pid: number; num: number; color: string; color2: string }[] = [];
    const texCache = new Map<number, THREE.Texture>();
    for (const p of this.players) {
      texCache.set(p.id, makeSlimeTexture(p.color, p.color2));
      for (let n = 1; n <= p.balls; n++) list.push({ pid: p.id, num: n, color: p.color, color2: p.color2 });
    }
    // shuffle placement for fairness
    const order = list.map((v, i) => ({ v, r: Math.random(), i })).sort((a, b) => a.r - b.r);
    const cols = Math.floor((s0.width - 1) / (BALL_R * 2.4));
    order.forEach(({ v }, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const lateral = -((cols - 1) * BALL_R * 2.4) / 2 + col * BALL_R * 2.4 + (Math.random() - 0.5) * 0.1;
      const t = 10 - row * BALL_R * 2.4;
      const p = this.segPoint(s0, t, lateral, BALL_R + 0.3 + row * 0.02);
      const body = new CANNON.Body({ mass: 1, material: this.ballPhysMat, linearDamping: 0.02, angularDamping: 0.02 });
      body.addShape(new CANNON.Sphere(BALL_R));
      body.position.set(p.x, p.y, p.z);
      this.world.addBody(body);
      const slime = createSlime(texCache.get(v.pid)!, v.color, v.num);
      slime.group.position.copy(p);
      slime.group.quaternion.copy(s0.quat);
      this.scene.add(slime.group);
      const atk = 1 + Math.floor(Math.random() * 5);
      const ball: Ball = { id: id++, playerId: v.pid, number: v.num, body, mesh: slime.group, slime, seg: 0, progress: 0, finished: false, finishTime: 0, rank: 0, stuckTimer: 0, warps: 0, boostCd: 0, onNet: false, atk, clashCd: 0, clashes: 0, godUntil: 0 };
      // ATK badge stars above head
      const star = makeEmojiSprite(atk >= 5 ? "💥" : atk >= 4 ? "🔥" : atk >= 3 ? "⚔️" : atk >= 2 ? "🗡️" : "🍃", 64);
      star.scale.set(0.42, 0.42, 1);
      star.position.set(0, 0.85, 0);
      slime.group.add(star);
      // aura ring (hidden until god mode)
      const aura = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.75, 24),
        new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = 0.05;
      aura.visible = false;
      this.scene.add(aura);
      ball.aura = aura;
      this.balls.push(ball);
      this.ballById.set(body.id, ball);
    });
  }

  // ---------- loop ----------
  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  };

  private loop = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt > 0.1) dt = 0.1;

    // countdown
    if (!this.raceStarted) {
      this.countdownLeft -= dt;
      const n = Math.ceil(this.countdownLeft);
      if (n !== this.lastCountdown && n <= 3) {
        this.lastCountdown = n;
        if (n > 0) this.cb.onCountdown(n);
      }
      if (this.countdownLeft <= 0) {
        this.raceStarted = true;
        this.cb.onGo();
      }
    } else {
      this.time += dt;
      // lift gate
      if (this.gate && this.gateMesh) {
        this.gate.velocity.set(0, 6, 0);
        if (this.gate.position.y > this.segs[0].a.y + 8) {
          this.world.removeBody(this.gate);
          this.scene.remove(this.gateMesh);
          this.gate = undefined;
        }
      }
    }

    // physics (kinematic obstacles are driven in the preStep hook)
    const stepDt = 1 / 60;
    this.world.step(stepDt, dt, 3);
    if (this.gateMesh && this.gate) {
      this.gateMesh.position.set(this.gate.position.x, this.gate.position.y, this.gate.position.z);
    }
    for (const k of this.kinematics) {
      const ip = k.body.interpolatedPosition, iq = k.body.interpolatedQuaternion;
      k.mesh.position.set(ip.x, ip.y, ip.z);
      k.mesh.quaternion.set(iq.x, iq.y, iq.z, iq.w);
    }

    this.updateBalls(dt);
    if (this.raceStarted && !this.raceEnded) {
      this.updateRocks(dt);
      this.updateLava(dt);
      this.updateWind(dt);
    }
    if (this.raceStarted && !this.raceEnded) {
      this.updateWarp();
      this.updateHold(dt);
      this.updateDish(dt);
      this.updateJump(dt);
      this.updateEvents(dt);
    }
    this.updateBoltsAndMeteorsVisual(dt);
    this.updateClashFx(dt);
    if (this.godBalls.length && this.time >= this.godUntil) this.godBalls = [];
    this.updateSparks(dt);
    this.updateEmbers(dt);
    this.updateMarkers();
    this.updateCamera(dt);

    if (this.env) {
      this.env.water.position.y = this.env.terrain.waterY + Math.sin(performance.now() * 0.0012) * 0.12;
      this.env.sky.position.copy(this.camera.position);
      const fm = this.env.flames.material as THREE.MeshBasicMaterial;
      fm.color.setHSL(0.08 + Math.sin(performance.now() * 0.01) * 0.015, 1, 0.6);
    }

    this.snapshotTimer += dt;
    if (this.snapshotTimer > 0.2) {
      this.snapshotTimer = 0;
      this.emitSnapshot();
    }

    // race end conditions
    if (this.raceStarted && !this.raceEnded) {
      const allDone = this.balls.every((b) => b.finished);
      if (allDone || (this.firstFinishTime >= 0 && this.time - this.firstFinishTime > 40) || this.time > 240) {
        this.endRace();
      }
    }

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  };

  private updateBalls(dt: number) {
    const tmp = new THREE.Vector3();
    const p = new THREE.Vector3();
    const now = performance.now();
    // which bodies are touching something this step
    const touching = new Set<number>();
    for (const c of this.world.contacts) {
      touching.add(c.bi.id);
      touching.add(c.bj.id);
    }
    for (const b of this.balls) {
      if (b.finished) continue;
      p.set(b.body.position.x, b.body.position.y, b.body.position.z);
      // find segment
      let best = b.seg;
      let bestT = 0;
      for (let i = b.seg; i <= Math.min(b.seg + 2, this.segs.length - 1); i++) {
        const s = this.segs[i];
        tmp.copy(p).sub(s.a);
        const t = tmp.dot(s.dir);
        if (t >= -0.5 && t <= s.len + 0.5) {
          const lat = Math.abs(tmp.dot(s.right));
          // the segment under the dish must not claim slimes still up on the dish
          if (i > 0 && isDish(this.segs[i - 1]) && tmp.y > 2.5) continue;
          if (lat < s.width / 2 + 1.5) {
            best = i;
            bestT = THREE.MathUtils.clamp(t, 0, s.len);
          }
        }
      }
      if (best === b.seg && bestT === 0) {
        const s = this.segs[best];
        tmp.copy(p).sub(s.a);
        bestT = THREE.MathUtils.clamp(tmp.dot(s.dir), 0, s.len);
      }
      b.seg = best;
      const s = this.segs[best];
      b.progress = s.cumStart + bestT;

      // fell off?
      const floorY = s.a.y + s.dir.y * bestT;
      if (p.y < floorY - 8) {
        this.respawn(b, s, bestT);
      }
      // stuck?
      const v = b.body.velocity;
      const speed2 = v.x * v.x + v.y * v.y + v.z * v.z;
      const parked = s.zone === "dish" || (this.hold.state === "holding" && s.index === this.hold.segIndex);
      if (this.raceStarted && speed2 < 0.04 && !parked) {
        b.stuckTimer += dt;
        if (b.stuckTimer > 3) {
          b.body.applyImpulse(new CANNON.Vec3(s.dir.x * 2 + (Math.random() - 0.5), 1.5, s.dir.z * 2 + (Math.random() - 0.5)));
          b.stuckTimer = 0;
        }
      } else b.stuckTimer = 0;
      const cap = b.godUntil > this.time ? GOD_SPEED : MAX_SPEED;
      if (speed2 > cap * cap) {
        const f = cap / Math.sqrt(speed2);
        v.scale(f, v);
      }
      b.clashCd = Math.max(0, b.clashCd - dt);
      if (b.aura) {
        const god = b.godUntil > this.time;
        b.aura.visible = god;
        if (god) {
          b.aura.position.set(b.mesh.position.x, b.mesh.position.y - BALL_R + 0.08, b.mesh.position.z);
          b.aura.rotation.z += dt * 6;
          const pulse = 1 + Math.sin(performance.now() * 0.02) * 0.15;
          b.aura.scale.setScalar(pulse);
          if (Math.random() < 0.5) this.burst(b.mesh.position, 1, new THREE.Color(0xfde047));
        }
      }

      // finish
      if (b.progress >= this.total - 2.5 && this.raceStarted) {
        b.finished = true;
        b.finishTime = this.time;
        this.finishOrder.push(b);
        b.rank = this.finishOrder.length;
        if (this.firstFinishTime < 0) this.firstFinishTime = this.time;
        this.burst(p, 40, new THREE.Color(this.players.find((pl) => pl.id === b.playerId)!.color));
        this.cb.onFinish(this.toInfo(b), b.rank);
        // park the ball at the finish area (out of the way)
        this.world.removeBody(b.body);
        const sf = this.segs[this.segs.length - 1];
        const n = b.rank - 1;
        const park = this.segPoint(sf, sf.len - 0.8 - Math.floor(n / 8) * 0.8, -sf.width / 2 + 0.6 + (n % 8) * 0.8, BALL_R);
        b.mesh.position.copy(park);
        b.mesh.quaternion.copy(sf.quat);
        b.mesh.rotateY(Math.PI);
        b.slime.blob.scale.set(1, 1, 1);
        b.slime.blob.position.y = 0;
        continue;
      }

      b.mesh.position.set(b.body.interpolatedPosition.x, b.body.interpolatedPosition.y, b.body.interpolatedPosition.z);
      animateSlime(b.slime, b.body, touching.has(b.body.id), dt, now);
    }
  }

  private respawn(b: Ball, s: Segment, t: number) {
    const p = this.segPoint(s, Math.max(1, Math.min(t, s.len - 1)), 0, BALL_R + 0.5);
    b.body.position.set(p.x, p.y, p.z);
    b.body.velocity.set(0, 0, 0);
    b.body.angularVelocity.set(0, 0, 0);
  }

  // ---------- rocks ----------
  private updateRocks(dt: number) {
    const s = this.findSeg("rocks");
    const active = this.balls.some((b) => !b.finished && b.progress > s.cumStart - 12 && b.progress < s.cumStart + s.len + 4);
    this.rockTimer -= dt;
    if (active && this.rockTimer <= 0 && this.rocks.length < 16) {
      this.rockTimer = 0.35 + Math.random() * 0.3;
      const r = 0.5 + Math.random() * 0.5;
      const p = this.segPoint(s, 4 + Math.random() * (s.len - 6), (Math.random() - 0.5) * (s.width - 1), 12 + Math.random() * 6);
      const body = new CANNON.Body({ mass: r * 10, material: this.trackPhysMat, angularDamping: 0.2 });
      body.addShape(new CANNON.Sphere(r));
      body.position.set(p.x, p.y, p.z);
      body.velocity.set((Math.random() - 0.5) * 2, -3, (Math.random() - 0.5) * 2);
      body.angularVelocity.set(Math.random() * 4, Math.random() * 4, Math.random() * 4);
      this.world.addBody(body);
      const mesh = new THREE.Mesh(this.rockGeo, this.rockMat);
      mesh.scale.setScalar(r);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.rocks.push({ body, mesh, life: 9 });
    }
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const rk = this.rocks[i];
      rk.life -= dt;
      rk.mesh.position.set(rk.body.interpolatedPosition.x, rk.body.interpolatedPosition.y, rk.body.interpolatedPosition.z);
      rk.mesh.quaternion.set(rk.body.interpolatedQuaternion.x, rk.body.interpolatedQuaternion.y, rk.body.interpolatedQuaternion.z, rk.body.interpolatedQuaternion.w);
      if (rk.life < 1) rk.mesh.scale.setScalar(Math.max(0.01, rk.mesh.scale.x * (1 - dt * 2)));
      if (rk.life <= 0 || rk.body.position.y < -4) {
        this.world.removeBody(rk.body);
        this.scene.remove(rk.mesh);
        this.rocks.splice(i, 1);
      }
    }
  }

  // ---------- lava ----------
  private updateLava(dt: number) {
    const s = this.findSeg("lava");
    const active = this.balls.some((b) => !b.finished && b.progress > s.cumStart - 10 && b.progress < s.cumStart + s.len);
    this.lavaTimer -= dt;
    if (active && this.lavaTimer <= 0) {
      this.lavaTimer = 0.45 + Math.random() * 0.4;
      const e = this.eruptions.find((x) => x.phase === "idle");
      if (e) {
        // bias eruption toward where balls are
        const near = this.balls.filter((b) => !b.finished && b.seg === s.index);
        let t = 3 + Math.random() * (s.len - 6);
        if (near.length && Math.random() < 0.7) {
          const target = near[Math.floor(Math.random() * near.length)];
          t = THREE.MathUtils.clamp(target.progress - s.cumStart + 2 + Math.random() * 4, 2, s.len - 2);
        }
        this.segPoint(s, t, (Math.random() - 0.5) * (s.width - 1.5), 0.05, e.pos);
        e.phase = "warn";
        e.timer = 0.7;
        e.ring.visible = true;
        e.ring.position.copy(e.pos);
        e.ring.quaternion.copy(s.quat);
        e.ring.rotateX(-Math.PI / 2);
        e.mesh.position.copy(e.pos).addScaledVector(s.up, 2.5);
        e.mesh.quaternion.copy(s.quat);
        e.light.position.copy(e.pos).addScaledVector(s.up, 1.5);
      }
    }
    for (const e of this.eruptions) {
      if (e.phase === "idle") continue;
      e.timer -= dt;
      if (e.phase === "warn") {
        const k = 1 - e.timer / 0.7;
        (e.ring.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.5 * Math.abs(Math.sin(k * 14));
        e.ring.scale.setScalar(0.6 + k * 0.6);
        e.light.intensity = k * 2;
        if (e.timer <= 0) {
          e.phase = "erupt";
          e.timer = 0.55;
          e.mesh.visible = true;
          this.burst(e.pos, 30, new THREE.Color(0xff6a00));
          // impulse to balls nearby
          const R = 2.0;
          for (const b of this.balls) {
            if (b.finished) continue;
            const dx = b.body.position.x - e.pos.x;
            const dy = b.body.position.y - e.pos.y;
            const dz = b.body.position.z - e.pos.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < R * R) {
              const d = Math.sqrt(d2) || 0.01;
              const f = 1 - d / R;
              b.body.applyImpulse(new CANNON.Vec3((dx / d) * 2.2 * f + (Math.random() - 0.5) * 1.5, 4.5 + 3 * f, (dz / d) * 2.2 * f + (Math.random() - 0.5) * 1.5));
            }
          }
        }
      } else {
        const k = 1 - e.timer / 0.55;
        const m = e.mesh.material as THREE.MeshBasicMaterial;
        m.opacity = (1 - k) * 0.9;
        e.mesh.scale.set(1 + k * 0.6, 0.4 + k * 1.4, 1 + k * 0.6);
        (e.ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
        e.light.intensity = (1 - k) * 6;
        if (e.timer <= 0) {
          e.phase = "idle";
          e.mesh.visible = false;
          e.ring.visible = false;
          e.light.intensity = 0;
        }
      }
    }
  }

  // ---------- wind ----------
  private updateWind(dt: number) {
    const s = this.findSeg("wind");
    const strength = Math.sin(this.time * 0.9) * 0.8 + Math.sin(this.time * 2.3) * 0.5;
    this.windDir = strength >= 0 ? 1 : -1;
    this.windSeg = s;
    this.windForce = 22 * strength;
    if (this.windParticles) {
      const arr = this.windParticles.geometry.attributes.position.array as Float32Array;
      const tmp = new THREE.Vector3();
      const speed = 6 + Math.abs(strength) * 12;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += s.right.x * speed * dt * this.windDir + s.dir.x * 3 * dt;
        arr[i + 1] += s.dir.y * 3 * dt;
        arr[i + 2] += s.right.z * speed * dt * this.windDir + s.dir.z * 3 * dt;
        tmp.set(arr[i] - s.a.x, arr[i + 1] - s.a.y, arr[i + 2] - s.a.z);
        const lat = tmp.dot(s.right);
        const t = tmp.dot(s.dir);
        if (Math.abs(lat) > s.width / 2 || t > s.len || t < 0) {
          this.segPoint(s, Math.random() * s.len, -this.windDir * (s.width / 2 - 0.1), 0.2 + Math.random() * 2.5, tmp);
          arr[i] = tmp.x;
          arr[i + 1] = tmp.y;
          arr[i + 2] = tmp.z;
        }
      }
      this.windParticles.geometry.attributes.position.needsUpdate = true;
    }
  }


  // ---------- warp ----------
  private updateWarp() {
    const s = this.findSeg("warp");
    const w = s.index;
    const far = this.segs[w + 2];
    const back = this.segs[w - 2];
    const tmp = new THREE.Vector3();
    for (const portal of this.portals) {
      portal.ring.rotation.z += 0.03;
      portal.disc.rotation.z -= 0.05;
      portal.light.intensity = 1.2 + Math.sin(performance.now() * 0.006 + portal.pos.x) * 0.5;
    }
    for (const b of this.balls) {
      if (b.finished || b.seg !== w || b.warps >= 2) continue;
      for (const portal of this.portals) {
        const dx = b.body.position.x - portal.pos.x;
        const dy = b.body.position.y - portal.pos.y;
        const dz = b.body.position.z - portal.pos.z;
        if (dx * dx + dz * dz < 0.9 && dy < 0.9) {
          const r = Math.random();
          let destSeg: Segment;
          let destT: number;
          if (r < 0.4) {
            destSeg = far;
            destT = 1.5;
          } else if (r < 0.65) {
            destSeg = s;
            destT = s.len - 1.5;
          } else {
            destSeg = back;
            destT = 1.5;
          }
          const speed = Math.max(4, b.body.velocity.length());
          this.burst(new THREE.Vector3(b.body.position.x, b.body.position.y, b.body.position.z), 25, portal.color);
          this.segPoint(destSeg, destT, (Math.random() - 0.5) * (destSeg.width - 2), BALL_R + 0.4, tmp);
          b.body.position.set(tmp.x, tmp.y, tmp.z);
          b.body.velocity.set(destSeg.dir.x * speed, destSeg.dir.y * speed, destSeg.dir.z * speed);
          b.body.angularVelocity.set(0, 0, 0);
          b.seg = destSeg.index;
          b.warps++;
          this.burst(tmp, 25, portal.color);
          break;
        }
      }
    }
  }

  // ---------- jump ----------
  private updateJump(dt: number) {
    const gap = this.findSeg("gap");
    const tmp = new THREE.Vector3();
    for (const b of this.balls) {
      if (b.finished || b.seg !== gap.index) {
        b.onNet = false;
        continue;
      }
      tmp.set(b.body.position.x - gap.a.x, b.body.position.y - gap.a.y, b.body.position.z - gap.a.z);
      const h = tmp.dot(gap.up);
      const onNet = h < BALL_R + 0.25;
      if (onNet) {
        // sticky energy net slows the ball that failed the jump
        const f = Math.max(0, 1 - dt * 1.6);
        b.body.velocity.scale(f, b.body.velocity);
        if (!b.onNet) this.burst(new THREE.Vector3(b.body.position.x, b.body.position.y, b.body.position.z), 8, new THREE.Color(0x67e8f9));
      }
      b.onNet = onNet;
    }
  }

  // ---------- events ----------
  private eventSeg(zone: ZoneType) {
    return this.segs.find((x) => x.zone === zone);
  }

  private ballsNear(s: Segment, before = 10, after = 0) {
    return this.balls.some((b) => !b.finished && b.progress > s.cumStart - before && b.progress < s.cumStart + s.len + after);
  }

  private updateEvents(dt: number) {
    // --- meteor storm ---
    const ms = this.eventSeg("meteor");
    if (ms) {
      this.meteorTimer -= dt;
      if (this.ballsNear(ms, 14) && this.meteorTimer <= 0 && this.meteors.length < 6) {
        this.meteorTimer = 0.7 + Math.random() * 0.6;
        const target = this.segPoint(ms, 2 + Math.random() * (ms.len - 4), (Math.random() - 0.5) * (ms.width - 1), 0);
        const start = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, 22, 10 + Math.random() * 6));
        const vel = target.clone().sub(start).normalize().multiplyScalar(22);
        const body = new CANNON.Body({ mass: 4, material: this.trackPhysMat });
        body.addShape(new CANNON.Sphere(0.55));
        body.position.set(start.x, start.y, start.z);
        body.velocity.set(vel.x, vel.y, vel.z);
        body.angularVelocity.set(3, 5, 2);
        this.world.addBody(body);
        const mesh = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.55, 0),
          new THREE.MeshStandardMaterial({ color: 0x3f2a1f, emissive: 0xff5a00, emissiveIntensity: 1.6, roughness: 0.9, flatShading: true })
        );
        const trail = new THREE.Mesh(
          new THREE.ConeGeometry(0.5, 4, 8, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
        );
        this.scene.add(mesh, trail);
        const m: Meteor = { body, mesh, trail, exploded: false, life: 6 };
        body.addEventListener("collide", () => {
          if (!m.exploded) m.exploded = true;
        });
        this.meteors.push(m);
      }
      for (let i = this.meteors.length - 1; i >= 0; i--) {
        const m = this.meteors[i];
        m.life -= dt;
        const p = new THREE.Vector3(m.body.position.x, m.body.position.y, m.body.position.z);
        m.mesh.position.set(m.body.interpolatedPosition.x, m.body.interpolatedPosition.y, m.body.interpolatedPosition.z);
        m.mesh.quaternion.set(m.body.interpolatedQuaternion.x, m.body.interpolatedQuaternion.y, m.body.interpolatedQuaternion.z, m.body.interpolatedQuaternion.w);
        const v = new THREE.Vector3(m.body.velocity.x, m.body.velocity.y, m.body.velocity.z);
        if (v.lengthSq() > 0.1) {
          m.trail.position.copy(p).addScaledVector(v.clone().normalize(), -2);
          m.trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize().negate());
        }
        if (m.exploded || m.life <= 0) {
          if (m.exploded) {
            this.burst(p, 45, new THREE.Color(0xff7a2a));
            const R = 3.2;
            for (const b of this.balls) {
              if (b.finished) continue;
              const dx = b.body.position.x - p.x;
              const dy = b.body.position.y - p.y;
              const dz = b.body.position.z - p.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < R * R) {
                const d = Math.sqrt(d2) || 0.01;
                const f = (1 - d / R) * 7;
                b.body.applyImpulse(new CANNON.Vec3((dx / d) * f, 3 + f * 0.6, (dz / d) * f));
              }
            }
            const flash = new THREE.PointLight(0xff8a2a, 8, 14, 2);
            flash.position.copy(p).add(new THREE.Vector3(0, 1, 0));
            this.scene.add(flash);
            this.bolts.push({ mesh: m.trail, light: flash, life: 0.35 });
            this.scene.remove(m.trail);
          } else {
            this.scene.remove(m.trail);
          }
          this.world.removeBody(m.body);
          this.scene.remove(m.mesh);
          this.meteors.splice(i, 1);
        }
      }
    }

    // --- ice ---
    const ice = this.eventSeg("ice");
    if (ice) {
      const t = this.time;
      for (const b of this.balls) {
        if (b.finished || b.seg !== ice.index) continue;
        const wob = Math.sin(t * 3 + b.id * 1.7) * 6 + Math.sin(t * 7.3 + b.id) * 3;
        b.body.applyForce(new CANNON.Vec3(ice.right.x * wob, 0, ice.right.z * wob));
      }
    }

    // --- gate ---
    const gate = this.eventSeg("gate");
    if (gate) {
      this.gateState.timer -= dt;
      if (this.gateState.timer <= 0) {
        this.gateState.closed = !this.gateState.closed;
        this.gateState.timer = this.gateState.closed ? 3.2 : 2.6;
        for (const l of this.gateState.lights) (l.material as THREE.MeshBasicMaterial).color.set(this.gateState.closed ? 0xef4444 : 0x22c55e);
      }
      if (this.gateState.closed && this.gateState.timer < 0.8) {
        for (const l of this.gateState.lights) (l.material as THREE.MeshBasicMaterial).color.set(Math.floor(this.gateState.timer * 8) % 2 ? 0xfbbf24 : 0xef4444);
      }
    }

    // --- boost pads ---
    if (this.boostPads.length) {
      const bs = this.eventSeg("boost")!;
      for (const b of this.balls) {
        if (b.finished) continue;
        b.boostCd = Math.max(0, b.boostCd - dt);
        if (b.seg !== bs.index || b.boostCd > 0) continue;
        for (const pad of this.boostPads) {
          const dx = b.body.position.x - pad.pos.x;
          const dy = b.body.position.y - pad.pos.y;
          const dz = b.body.position.z - pad.pos.z;
          if (dx * dx + dz * dz < 1.0 && dy < 1) {
            b.body.applyImpulse(new CANNON.Vec3(bs.dir.x * 6, 0.5, bs.dir.z * 6));
            b.boostCd = 1;
            this.burst(new THREE.Vector3(b.body.position.x, b.body.position.y, b.body.position.z), 14, new THREE.Color(0xbef264));
            break;
          }
        }
      }
      for (const pad of this.boostPads) (pad.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 + Math.sin(performance.now() * 0.008) * 0.5;
    }

    // --- lightning storm ---
    const st = this.eventSeg("storm");
    if (st) {
      this.stormTimer -= dt;
      if (this.stormLight) this.stormLight.intensity = Math.max(0, this.stormLight.intensity - dt * 30);
      const inZone = this.balls.filter((b) => !b.finished && b.seg === st.index);
      if (this.stormTimer <= 0 && inZone.length) {
        this.stormTimer = 2.4 + Math.random() * 1.2;
        let lead = inZone[0];
        for (const b of inZone) if (b.progress > lead.progress) lead = b;
        const p = new THREE.Vector3(lead.body.position.x, lead.body.position.y, lead.body.position.z);
        // bolt
        const bolt = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.35, 14, 6, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xe0e7ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
        );
        bolt.position.copy(p).add(new THREE.Vector3(0, 7, 0));
        bolt.rotation.z = (Math.random() - 0.5) * 0.25;
        this.scene.add(bolt);
        const flash = new THREE.PointLight(0xc7d2fe, 14, 16, 2);
        flash.position.copy(p).add(new THREE.Vector3(0, 1.5, 0));
        this.scene.add(flash);
        this.bolts.push({ mesh: bolt, light: flash, life: 0.4 });
        if (this.stormLight) this.stormLight.intensity = 12;
        this.burst(p, 30, new THREE.Color(0xa5b4fc));
        // knock the leader back
        lead.body.velocity.set(0, 0, 0);
        lead.body.applyImpulse(new CANNON.Vec3(-st.dir.x * 5 + (Math.random() - 0.5) * 3, 5, -st.dir.z * 5 + (Math.random() - 0.5) * 3));
        // small shove to neighbours
        for (const b of inZone) {
          if (b === lead) continue;
          const dx = b.body.position.x - p.x;
          const dz = b.body.position.z - p.z;
          if (dx * dx + dz * dz < 4) b.body.applyImpulse(new CANNON.Vec3(dx, 2, dz));
        }
      }
    }
  }

  private updateBoltsAndMeteorsVisual(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / 0.4);
      b.light.intensity *= 0.85;
      if (b.life <= 0) {
        this.scene.remove(b.mesh, b.light);
        this.bolts.splice(i, 1);
      }
    }
  }

  // ---------- ambience ----------
  private updateEmbers(dt: number) {
    const arr = this.embers.geometry.attributes.position.array as Float32Array;
    const c = this.camPos;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += dt * (0.6 + ((i / 3) % 5) * 0.15);
      arr[i] += Math.sin(performance.now() * 0.001 + i) * dt * 0.4;
      const dx = arr[i] - c.x, dy = arr[i + 1] - c.y, dz = arr[i + 2] - c.z;
      if (dx * dx + dy * dy + dz * dz > 45 * 45 || arr[i + 1] > c.y + 12) {
        arr[i] = c.x + (Math.random() - 0.5) * 60;
        arr[i + 1] = c.y - 14 + Math.random() * 10;
        arr[i + 2] = c.z + (Math.random() - 0.5) * 60 - 20;
      }
    }
    this.embers.geometry.attributes.position.needsUpdate = true;
  }

  private updateMarkers() {
    const alive = this.balls.filter((b) => !b.finished);
    let lead: Ball | undefined;
    for (const b of alive) if (!lead || b.progress > lead.progress) lead = b;
    const bob = Math.sin(performance.now() * 0.005) * 0.1;
    if (lead) {
      this.crown.visible = true;
      this.crown.position.set(lead.body.position.x, lead.body.position.y + 1.0 + bob, lead.body.position.z);
    } else this.crown.visible = false;
    const focus = this.getFocusBall();
    if (focus && focus !== lead && !focus.finished && this.cameraMode !== "leader") {
      this.camMarker.visible = true;
      this.camMarker.position.set(focus.body.position.x, focus.body.position.y + 1.0 + bob, focus.body.position.z);
    } else this.camMarker.visible = false;
  }


  // ---------- HOLD gate ----------
  private buildHold() {
    const s = this.findSeg("hold");
    this.hold.segIndex = s.index;
    const t = s.len * 0.62;
    const base = this.segPoint(s, t, 0, 1.5);
    this.hold.base.copy(base);
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.bumperPhysMat });
    body.addShape(new CANNON.Box(new CANNON.Vec3(s.width / 2, 1.5, 0.15)));
    body.position.set(base.x, base.y + 6, base.z);
    body.quaternion.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
    this.world.addBody(body);
    this.hold.body = body;

    // energy barrier visual
    const gtex = makeGridTexture();
    gtex.repeat.set(s.width / 1.5, 2);
    const barrier = new THREE.Mesh(
      new THREE.BoxGeometry(s.width, 3, 0.25),
      new THREE.MeshBasicMaterial({ map: gtex, color: 0x7dd3fc, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    this.scene.add(barrier);
    this.hold.barrier = barrier;
    this.kinematics.push({
      body,
      mesh: barrier,
      update: () => {
        const closed = this.hold.state === "holding";
        const ty = this.hold.base.y + (closed ? 0 : 6);
        const k = closed ? 14 : 5;
        body.velocity.set((this.hold.base.x - body.position.x) * k, (ty - body.position.y) * k, (this.hold.base.z - body.position.z) * k);
      },
    });

    // crystal pillars
    const pillar = new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.9 });
    const crystal = new THREE.MeshPhysicalMaterial({ color: 0x7dd3fc, emissive: 0x0ea5e9, emissiveIntensity: 0.8, roughness: 0.1, transmission: 0.5, thickness: 1 });
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 4.5, 8), pillar);
      p.position.copy(this.segPoint(s, t, side * (s.width / 2 + 0.7), 2.2));
      p.castShadow = true;
      this.scene.add(p);
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), crystal);
      c.position.copy(this.segPoint(s, t, side * (s.width / 2 + 0.7), 5.1));
      this.scene.add(c);
      const l = new THREE.PointLight(0x38bdf8, 1.2, 10, 2);
      l.position.copy(c.position);
      this.scene.add(l);
    }
    // rune circle at zone entry
    const rune = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.4, 32),
      new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    rune.position.copy(this.segPoint(s, 1.5, 0, 0.03));
    rune.quaternion.copy(s.quat);
    rune.rotateX(-Math.PI / 2);
    this.scene.add(rune);

    // countdown label
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    label.scale.set(2.6, 2.6, 1);
    label.position.copy(this.segPoint(s, t, 0, 5.4));
    label.visible = false;
    label.renderOrder = 999;
    this.scene.add(label);
    this.hold.label = label;
    this.hold.labelCanvas = c;
    this.hold.labelTex = tex;
    const sign = makeEmojiSprite("⏳");
    sign.scale.set(2, 2, 1);
    sign.position.copy(this.segPoint(s, 1.5, 0, 4));
    this.scene.add(sign);
  }

  private drawHoldLabel(text: string, color: string) {
    const c = this.hold.labelCanvas!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${text.length > 2 ? 44 : 72}px Kanit, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 70);
    this.hold.labelTex!.needsUpdate = true;
  }

  private updateHold(dt: number) {
    const h = this.hold;
    const s = this.segs[h.segIndex];
    if (h.barrier) {
      const m = h.barrier.material as THREE.MeshBasicMaterial;
      m.map!.offset.y -= dt * 0.4;
      m.opacity = h.state === "holding" ? 0.6 + Math.sin(performance.now() * 0.01) * 0.15 : 0.25;
    }
    if (h.state === "idle") {
      if (this.balls.some((b) => !b.finished && b.seg === s.index)) {
        h.state = "holding";
        h.timer = HOLD_TIME;
        h.label!.visible = true;
        this.burst(h.base, 30, new THREE.Color(0x7dd3fc));
        this.cb.onNotice?.("⏳ HOLD! ผู้นำต้องรอ 8 วินาที", "#0ea5e9");
      }
    } else if (h.state === "holding") {
      h.timer -= dt;
      const alive = this.balls.filter((b) => !b.finished);
      const inZone = alive.filter((b) => b.progress >= s.cumStart - 6 && b.progress <= s.cumStart + s.len).length;
      const num = Math.ceil(h.timer);
      if (num !== h.lastNum) {
        h.lastNum = num;
        this.drawHoldLabel(String(Math.max(0, num)), "#38bdf8");
      }
      if (h.timer <= 0 || inZone >= Math.ceil(alive.length * 0.7)) {
        h.state = "open";
        this.drawHoldLabel("GO", "#4ade80");
        this.burst(h.base, 50, new THREE.Color(0x4ade80));
        this.cb.onNotice?.("🟢 ประตูเปิดแล้ว! ลุยต่อ", "#16a34a");
        setTimeout(() => {
          if (h.label) h.label.visible = false;
        }, 1500);
      }
    }
  }

  // ---------- DISH (iris bowl) ----------
  private buildDish() {
    const s = this.findSeg("dish");
    const d = this.dish;
    d.segIndex = s.index;
    const E = s.a.clone();
    d.dh.copy(s.dh);
    d.right.copy(s.right);
    d.center.copy(E).addScaledVector(s.dh, 7);
    d.yC = E.y - 0.05 - 7 * DISH_SLOPE;
    d.center.y = d.yC;

    const stone = new THREE.MeshStandardMaterial({ color: 0xbfb4a3, roughness: 0.85, metalness: 0.05 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0xc084fc, emissive: 0x6b21a8, emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.35 });
    const N = 24;
    const radial = (ang: number) => new THREE.Vector3().addScaledVector(d.dh, Math.cos(ang)).addScaledVector(d.right, Math.sin(ang));
    const slabQuat = (dirR: THREE.Vector3) => {
      const o = new THREE.Object3D();
      o.position.set(0, 0, 0);
      o.lookAt(dirR.x, DISH_SLOPE, dirR.z); // local -Z = outward + up-slope
      return o.quaternion.clone();
    };
    const surfY = (r: number) => d.yC + r * DISH_SLOPE;

    // outer ring slabs
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const dirR = radial(ang);
      const rc = (DISH_R_IN + DISH_R_OUT) / 2;
      const pos = d.center.clone().addScaledVector(dirR, rc);
      pos.y = surfY(rc) - 0.15;
      this.addStaticBox(new THREE.Vector3(2.05, 0.3, DISH_R_OUT - DISH_R_IN), pos, slabQuat(dirR), stone, { receive: true });
    }
    // rim wall with entry opening (facing -dh)
    const entryAng = Math.PI; // direction of -dh
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      let da = Math.abs(ang - entryAng);
      da = Math.min(da, Math.PI * 2 - da);
      if (da < 0.62) continue;
      const dirR = radial(ang);
      const pos = d.center.clone().addScaledVector(dirR, DISH_R_OUT + 0.2);
      pos.y = surfY(DISH_R_OUT) + 1.0;
      const q = new THREE.Object3D();
      q.lookAt(dirR.x, 0, dirR.z);
      this.addStaticBox(new THREE.Vector3(2.05, 2.2, 0.4), pos, q.quaternion.clone(), stone, {
        shadow: true,
        physSize: new THREE.Vector3(2.05, 7, 0.4),
        physOffset: new THREE.Vector3(0, 2.4, 0),
      });
      // battlement tooth
      if (i % 2 === 0) {
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.45), stone);
        tooth.position.copy(pos).add(new THREE.Vector3(0, 1.4, 0));
        tooth.quaternion.copy(q.quaternion);
        this.scene.add(tooth);
      }
    }
    // collar walls closing the junction between the track and the rim
    const prev = this.segs[s.index - 1];
    for (const side of [-1, 1]) {
      const A = E.clone().addScaledVector(prev.right, side * (prev.width / 2 + WALL_T / 2)).addScaledVector(prev.dir, 1.2);
      const ang = entryAng - side * 0.62;
      const B = d.center.clone().addScaledVector(radial(ang), DISH_R_OUT + 0.2);
      B.y = A.y;
      this.addWallBetween(A, B, stone);
    }
    // iris petals (kinematic, slide outward under the ring)
    const NP = 12;
    const petalLen = 3.9;
    const petalMat = bronze;
    for (let i = 0; i < NP; i++) {
      const ang = (i / NP) * Math.PI * 2 + Math.PI / NP;
      const dirR = radial(ang);
      const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.trackPhysMat });
      body.addShape(new CANNON.Box(new CANNON.Vec3(1.02, 0.12, petalLen / 2)));
      const q = slabQuat(dirR);
      body.quaternion.set(q.x, q.y, q.z, q.w);
      const rc = petalLen / 2;
      const pos = d.center.clone().addScaledVector(dirR, rc);
      pos.y = surfY(rc) - 0.12 - 0.12;
      body.position.set(pos.x, pos.y, pos.z);
      this.world.addBody(body);
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.24, petalLen), petalMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.12), new THREE.MeshBasicMaterial({ color: 0xe9d5ff }));
      edge.position.set(0, 0.14, petalLen / 2 - 0.06); // inner edge (local +Z points toward centre)
      group.add(edge);
      this.scene.add(group);
      d.petals.push({ body, dirR });
      this.kinematics.push({
        body,
        mesh: group,
        update: () => {
          const rcc = petalLen / 2 + this.dish.d;
          const tx = d.center.x + dirR.x * rcc;
          const tz = d.center.z + dirR.z * rcc;
          const ty = surfY(rcc) - 0.24;
          const k = 10;
          body.velocity.set((tx - body.position.x) * k, (ty - body.position.y) * k, (tz - body.position.z) * k);
        },
      });
    }
    // decorative rune ring + glow under the hole
    const rune = new THREE.Mesh(
      new THREE.RingGeometry(DISH_R_IN - 0.1, DISH_R_IN + 0.25, 48),
      new THREE.MeshBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    rune.position.copy(d.center).add(new THREE.Vector3(0, surfY(DISH_R_IN) + 0.03, 0));
    rune.rotation.x = -Math.PI / 2;
    this.scene.add(rune);
    d.rune = rune;
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(DISH_HOLE_MAX, 48),
      new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    glow.position.copy(d.center).add(new THREE.Vector3(0, -2.0, 0));
    glow.rotation.x = -Math.PI / 2;
    this.scene.add(glow);
    d.glow = glow;
    const light = new THREE.PointLight(0xa855f7, 1.5, 14, 2);
    light.position.copy(d.center).add(new THREE.Vector3(0, 1.5, 0));
    this.scene.add(light);
    // outer stone rim torus
    const rim = new THREE.Mesh(new THREE.TorusGeometry(DISH_R_OUT + 0.2, 0.28, 8, 48), stone);
    rim.position.copy(d.center).add(new THREE.Vector3(0, surfY(DISH_R_OUT) - 0.05, 0));
    rim.rotation.x = Math.PI / 2;
    this.scene.add(rim);
    // support pillars under dish
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x8c8474, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.3;
      const p = d.center.clone().addScaledVector(radial(ang), DISH_R_OUT - 0.8);
      const h = p.y + 8;
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, h, 6), pillarMat);
      pil.position.set(p.x, p.y - h / 2 - 0.3, p.z);
      this.scene.add(pil);
    }
    // tall invisible walls on the landing segment beyond the dish footprint
    const under = this.segs[s.index + 1];
    const t0 = 7 + DISH_R_OUT + 0.6 - 4.5;
    const Lw = under.len - t0;
    for (const side of [-1, 1]) {
      const c = this.segPoint(under, t0 + Lw / 2, side * (under.width / 2 + WALL_T / 2), PHYS_WALL_H / 2);
      this.addStaticBox(new THREE.Vector3(WALL_T, PHYS_WALL_H, Lw), c, under.quat, stone, { invisible: true });
    }
    const sign = makeEmojiSprite("🕳️");
    sign.scale.set(2.2, 2.2, 1);
    sign.position.copy(E).add(new THREE.Vector3(0, 4, 0));
    this.scene.add(sign);
    d.label = sign;
  }

  private updateDish(dt: number) {
    const d = this.dish;
    const s = this.segs[d.segIndex];
    if (d.rune) d.rune.rotation.z += dt * 0.3;
    const alive = this.balls.filter((b) => !b.finished);
    const inDish = alive.filter((b) => b.seg === s.index).length;
    if (d.state === "idle") {
      if (inDish > 0) {
        d.state = "waiting";
        d.timer = DISH_WAIT;
        this.cb.onNotice?.("🕳️ ถาดหลุมยักษ์ — รอให้เพื่อนมาครบ แล้วรูจะค่อยๆ เปิด!", "#9333ea");
      }
    } else if (d.state === "waiting") {
      d.timer -= dt;
      if (d.timer <= 0 || inDish >= Math.ceil(alive.length * 0.6)) {
        d.state = "opening";
        d.timer = 0;
        this.cb.onNotice?.("🕳️ รูกำลังขยาย!", "#a855f7");
      }
    } else if (d.state === "opening") {
      d.timer += dt;
      const k = THREE.MathUtils.clamp(d.timer / DISH_OPEN_TIME, 0, 1);
      d.d = DISH_HOLE_MAX * (k * k * (3 - 2 * k));
      if (d.glow) (d.glow.material as THREE.MeshBasicMaterial).opacity = 0.25 + k * 0.4;
      if (k >= 1) d.state = "open";
    }
    if (d.glow) d.glow.scale.setScalar(Math.max(0.05, d.d / DISH_HOLE_MAX));
  }

  zoneMarkers(): ZoneMarker[] {
    const icons: Partial<Record<ZoneType, string>> = {
      rocks: "🪨", lava: "🌋", hold: "⏳", spinners: "🌪️", pegs: "📍", pistons: "🔩", ramp: "🪂", dish: "🕳️", wind: "💨", warp: "🌀", hammers: "🔨",
      meteor: "☄️", ice: "🧊", gate: "🚧", boost: "⚡", storm: "🌩️",
    };
    const out: ZoneMarker[] = [];
    for (const s of this.segs) {
      const ic = icons[s.zone];
      if (!ic) continue;
      out.push({ icon: ic, label: ZONE_LABELS[s.zone], at: (s.cumStart + s.len / 2) / this.total });
    }
    return out;
  }


  // ---------- orbit camera input ----------
  private onPtrDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    this.dragging = true;
    this.orbitActive = true;
    this.orbitIdle = 0;
    this.lastPtr = { x: e.clientX, y: e.clientY };
  };
  private onPtrMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPtr.x;
    const dy = e.clientY - this.lastPtr.y;
    this.lastPtr = { x: e.clientX, y: e.clientY };
    this.orbitYaw -= dx * 0.008;
    this.orbitPitch += dy * 0.006;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch, -0.5, 1.0);
  };
  private onPtrUp = () => {
    this.dragging = false;
    this.orbitIdle = 0;
  };
  resetCamera() {
    this.orbitActive = false;
    this.orbitYaw = this.orbitPitch = 0;
  }

  // ---------- POWER CLASH ----------
  private tryClash(a: Ball, b: Ball) {
    if (!this.raceStarted || a.finished || b.finished) return;
    const va = a.body.velocity, vb = b.body.velocity;
    const sa = Math.hypot(va.x, va.z), sb = Math.hypot(vb.x, vb.z);
    // attacker = faster one, must be coming from behind and closing fast
    const [atk, vic] = sa >= sb ? [a, b] : [b, a];
    const vA = atk.body.velocity, vV = vic.body.velocity;
    const speedA = Math.hypot(vA.x, vA.z);
    if (speedA < CLASH_MIN_SPEED || atk.clashCd > 0) return;
    const dx = vic.body.position.x - atk.body.position.x;
    const dz = vic.body.position.z - atk.body.position.z;
    const dl = Math.hypot(dx, dz) || 0.01;
    const nx = dx / dl, nz = dz / dl;
    const rel = (vA.x - vV.x) * nx + (vA.z - vV.z) * nz; // closing speed along contact normal
    const forward = (vA.x * nx + vA.z * nz) / speedA; // attacker moving toward victim?
    if (rel < CLASH_REL_SPEED || forward < 0.5) return;
    if (vic.godUntil > this.time && atk.godUntil <= this.time) return; // can't clash a god-mode slime

    atk.clashCd = 0.8;
    vic.clashCd = 0.4;
    atk.clashes++;
    this.clashCount++;
    const power = atk.atk;
    const s = this.segs[atk.seg];
    // attacker keeps charging forward
    const keep = 4 + power * 1.2;
    atk.body.velocity.set(vA.x, Math.max(vA.y, 0), vA.z);
    atk.body.applyImpulse(new CANNON.Vec3(s.dir.x * keep, 0.8, s.dir.z * keep));
    // victim is knocked sideways (whichever side it's already offset toward)
    const px = vic.body.position.x - s.a.x, pz = vic.body.position.z - s.a.z;
    let sideSign = Math.sign(px * s.right.x + pz * s.right.z) || (Math.random() < 0.5 ? -1 : 1);
    const lat = Math.abs(px * s.right.x + pz * s.right.z);
    if (lat > s.width / 2 - 1) sideSign = -sideSign; // bounce toward the open side if hugging a wall
    const side = 4 + power * 1.6;
    vic.body.velocity.set(vV.x * 0.3, vV.y, vV.z * 0.3);
    vic.body.applyImpulse(new CANNON.Vec3(s.right.x * sideSign * side, 2.5 + power * 0.5, s.right.z * sideSign * side));
    vic.body.angularVelocity.set(s.dir.x * 20 * sideSign, 8, s.dir.z * 20 * sideSign);
    vic.slime.tumble = 1.2;
    vic.slime.squashVel -= 4;
    atk.slime.squashVel += 3; // stretch on the charge

    const at = new THREE.Vector3(atk.body.position.x, atk.body.position.y + 0.5, atk.body.position.z).lerp(
      new THREE.Vector3(vic.body.position.x, vic.body.position.y + 0.5, vic.body.position.z),
      0.5
    );
    const col = new THREE.Color(this.players.find((p) => p.id === atk.playerId)!.color);
    this.burst(at, 20 + power * 6, col);
    this.spawnClashFx(at, power);
    this.cb.onClash?.(this.toInfo(atk), this.toInfo(vic));
  }

  private spawnClashFx(p: THREE.Vector3, power: number) {
    if (!this.clashTex) {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 128;
      const ctx = c.getContext("2d")!;
      // comic burst
      ctx.translate(128, 64);
      ctx.fillStyle = "#fde047";
      ctx.strokeStyle = "#7c2d12";
      ctx.lineWidth = 6;
      ctx.beginPath();
      const spikes = 14;
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 ? 56 : 44;
        const ang = (i / (spikes * 2)) * Math.PI * 2;
        const x = Math.cos(ang) * r * 2.1, y = Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#b91c1c";
      ctx.font = "italic 900 46px Kanit, Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 8;
      ctx.strokeText("CLASH!!", 0, 2);
      ctx.fillText("CLASH!!", 0, 2);
      this.clashTex = new THREE.CanvasTexture(c);
      this.clashTex.colorSpace = THREE.SRGBColorSpace;
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.clashTex, transparent: true, depthTest: false }));
    const sc = 2.2 + power * 0.35;
    sprite.scale.set(sc, sc / 2, 1);
    sprite.position.copy(p).add(new THREE.Vector3(0, 1.2, 0));
    sprite.renderOrder = 1000;
    sprite.material.rotation = (Math.random() - 0.5) * 0.5;
    this.scene.add(sprite);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.7, 32),
      new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    ring.position.copy(p);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    this.clashFx.push({ sprite, ring, life: 1.1, vy: 1.5, size: sc });
  }

  private updateClashFx(dt: number) {
    for (let i = this.clashFx.length - 1; i >= 0; i--) {
      const f = this.clashFx[i];
      f.life -= dt;
      const k = 1 - f.life / 1.1;
      const pop = k < 0.15 ? Math.sin((k / 0.15) * Math.PI * 0.5) * 1.25 : 1 + 0.25 * (1 - Math.min(1, (k - 0.15) / 0.2));
      const w = f.size * pop * (1 + Math.sin(k * Math.PI) * 0.08);
      f.sprite.scale.set(w, w / 2, 1);
      f.sprite.position.y += f.vy * dt;
      f.sprite.material.opacity = f.life < 0.35 ? f.life / 0.35 : 1;
      f.ring.scale.setScalar(1 + k * 5);
      (f.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - k * 1.2);
      if (f.life <= 0) {
        this.scene.remove(f.sprite, f.ring);
        f.sprite.material.dispose();
        f.ring.geometry.dispose();
        this.clashFx.splice(i, 1);
      }
    }
  }

  // ---------- GOD MODE ----------
  /** Give the 3 rearmost players' best slimes (and all their slimes) x5 speed for 5s. */
  activateGodMode(): boolean {
    if (!this.raceStarted || this.raceEnded || this.time < this.godReadyAt || this.godBalls.length) return false;
    const alive = this.balls.filter((b) => !b.finished);
    if (!alive.length) return false;
    // rank players by their best alive progress
    const best = new Map<number, number>();
    for (const b of alive) best.set(b.playerId, Math.max(best.get(b.playerId) ?? 0, b.progress));
    const order = [...best.entries()].sort((a, b) => a[1] - b[1]).map(([pid]) => pid);
    const chosen = new Set(order.slice(0, Math.min(3, order.length)));
    this.godBalls = alive.filter((b) => chosen.has(b.playerId));
    this.godUntil = this.time + GOD_DURATION;
    this.godReadyAt = this.time + GOD_COOLDOWN;
    for (const b of this.godBalls) {
      b.godUntil = this.godUntil;
      b.body.applyImpulse(new CANNON.Vec3(this.segs[b.seg].dir.x * 6, 1, this.segs[b.seg].dir.z * 6));
      this.burst(b.mesh.position, 20, new THREE.Color(0xfde047));
    }
    const names = [...chosen].map((pid) => this.players.find((p) => p.id === pid)?.name ?? "").join(", ");
    this.cb.onNotice?.(`⚡ GOD MODE! ${names} สปีด x5 เป็นเวลา 5 วิ`, "#ca8a04");
    return true;
  }

  // ---------- sparks ----------
  private sparkIdx = 0;
  private burst(p: THREE.Vector3, n: number, color: THREE.Color) {
    const arr = this.sparks.geometry.attributes.position.array as Float32Array;
    (this.sparks.material as THREE.PointsMaterial).color.lerp(color, 0.5);
    for (let k = 0; k < n; k++) {
      const i = this.sparkIdx;
      this.sparkIdx = (this.sparkIdx + 1) % this.sparkLife.length;
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) + 0.5;
      v.multiplyScalar(3 + Math.random() * 6);
      this.sparkVel[i * 3] = v.x;
      this.sparkVel[i * 3 + 1] = v.y;
      this.sparkVel[i * 3 + 2] = v.z;
      this.sparkLife[i] = 0.8 + Math.random() * 0.6;
    }
  }
  private updateSparks(dt: number) {
    const arr = this.sparks.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < this.sparkLife.length; i++) {
      if (this.sparkLife[i] <= 0) {
        arr[i * 3 + 1] = -1000;
        continue;
      }
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 9.8 * dt;
      arr[i * 3] += this.sparkVel[i * 3] * dt;
      arr[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      arr[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- camera ----------
  private getFocusBall(): Ball | undefined {
    const alive = this.balls.filter((b) => !b.finished);
    const pool = this.cameraMode === "leader" ? alive : alive.filter((b) => b.playerId === this.cameraMode);
    const list = pool.length ? pool : alive;
    if (!list.length) return this.finishOrder[this.finishOrder.length - 1];
    let best = list[0];
    for (const b of list) if (b.progress > best.progress) best = b;
    return best;
  }

  private camDir = new THREE.Vector3(0, 0, -1);
  private camFocus = new THREE.Vector3();
  private camFocusInit = false;
  private updateCamera(dt: number) {
    const target = this.getFocusBall();
    if (target) {
      const s = this.segs[target.seg];
      const ip = target.body.interpolatedPosition;
      const p = target.finished ? target.mesh.position.clone() : new THREE.Vector3(ip.x, ip.y, ip.z);
      // smooth the focus point itself (handles target switches / teleports without snapping)
      if (!this.camFocusInit) {
        this.camFocus.copy(p);
        this.camFocusInit = true;
      }
      const kf = 1 - Math.exp(-dt * 7);
      this.camFocus.lerp(p, kf);
      // smooth the travel direction (blend segment heading with velocity heading)
      const v = target.body.velocity;
      const hv = new THREE.Vector3(v.x, 0, v.z);
      const heading = hv.lengthSq() > 4 ? hv.normalize().lerp(s.dh, 0.4).normalize() : s.dh.clone();
      this.camDir.lerp(heading, 1 - Math.exp(-dt * 2.5)).normalize();
      const speed = Math.min(1, Math.hypot(v.x, v.z) / 12);
      const back = 8.5 + speed * 2.5;
      const desired = this.camFocus.clone().addScaledVector(this.camDir, -back).add(new THREE.Vector3(0, 5 + speed * 1.2, 0));
      const look = this.camFocus.clone().addScaledVector(this.camDir, 5 + speed * 3).add(new THREE.Vector3(0, -0.3, 0));
      if (!this.raceStarted) {
        desired.copy(this.segs[0].a).addScaledVector(this.segs[0].dh, -12).add(new THREE.Vector3(0, 8, 0));
        look.copy(this.segs[0].a).addScaledVector(this.segs[0].dh, 8);
      }
      // user orbit: rotate the offset around the focus point
      if (this.orbitActive) {
        if (!this.dragging) {
          this.orbitIdle += dt;
          if (this.orbitIdle > 4) {
            // ease back to auto-follow
            this.orbitYaw *= Math.exp(-dt * 1.5);
            this.orbitPitch *= Math.exp(-dt * 1.5);
            if (Math.abs(this.orbitYaw) < 0.02 && Math.abs(this.orbitPitch) < 0.02) {
              this.orbitActive = false;
              this.orbitYaw = this.orbitPitch = 0;
            }
          }
        }
        const off = desired.clone().sub(this.camFocus);
        const dist = off.length();
        const baseYaw = Math.atan2(off.x, off.z);
        const basePitch = Math.asin(THREE.MathUtils.clamp(off.y / dist, -1, 1));
        const yaw = baseYaw + this.orbitYaw;
        const pitch = THREE.MathUtils.clamp(basePitch + this.orbitPitch, 0.05, 1.3);
        desired.set(this.camFocus.x + Math.sin(yaw) * Math.cos(pitch) * dist, this.camFocus.y + Math.sin(pitch) * dist, this.camFocus.z + Math.cos(yaw) * Math.cos(pitch) * dist);
        look.copy(this.camFocus).add(new THREE.Vector3(0, 0.6, 0));
      }
      const kp = 1 - Math.exp(-dt * (this.dragging ? 14 : 4.5));
      const kl = 1 - Math.exp(-dt * (this.dragging ? 14 : 8));
      this.camPos.lerp(desired, kp);
      this.camLook.lerp(look, kl);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      // sun follows
      this.sun.position.copy(p).add(new THREE.Vector3(25, 45, 20));
      this.sun.target.position.copy(p);
      this.sun.target.updateMatrixWorld();
    }
  }

  // ---------- snapshots ----------
  private toInfo(b: Ball): BallInfo {
    return {
      id: b.id,
      playerId: b.playerId,
      number: b.number,
      progress: b.finished ? 1 : THREE.MathUtils.clamp(b.progress / this.total, 0, 1),
      finished: b.finished,
      finishTime: b.finishTime,
      rank: b.rank,
      atk: b.atk,
      clashes: b.clashes,
      godMode: b.godUntil > this.time,
    };
  }
  private emitSnapshot() {
    const infos = this.balls.map((b) => this.toInfo(b));
    const focus = this.getFocusBall();
    this.cb.onSnapshot({
      time: this.time,
      balls: infos,
      leaderId: focus ? focus.id : -1,
      finishedCount: this.finishOrder.length,
      holdLeft: this.hold.state === "holding" ? this.hold.timer : -1,
      dishOpen: this.dish.state === "opening" ? this.dish.d / DISH_HOLE_MAX : this.dish.state === "open" ? 1 : -1,
      godLeft: Math.max(0, this.godUntil - this.time),
      godCooldown: Math.max(0, this.godReadyAt - this.time),
      clashCount: this.clashCount,
    });
  }

  currentZoneLabel(): string {
    const f = this.getFocusBall();
    if (!f) return "";
    return ZONE_LABELS[this.segs[f.seg].zone];
  }

  endRace() {
    if (this.raceEnded) return;
    this.raceEnded = true;
    this.emitSnapshot();
    this.cb.onRaceEnd();
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.canvasEl.removeEventListener("pointerdown", this.onPtrDown);
    window.removeEventListener("pointermove", this.onPtrMove);
    window.removeEventListener("pointerup", this.onPtrUp);
    window.removeEventListener("pointercancel", this.onPtrUp);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
