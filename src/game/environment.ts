import * as THREE from "three";
import type { Segment } from "./track";

/* ---------------- noise ---------------- */
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    s += a * vnoise(x * f, y * f);
    a *= 0.5;
    f *= 2.1;
  }
  return s;
}
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------------- terrain ---------------- */
export class Terrain {
  private segs2: { ax: number; az: number; bx: number; bz: number; ay: number; by: number; len2: number }[];
  readonly waterY = -6;
  constructor(segs: Segment[]) {
    this.segs2 = segs.map((s) => ({
      ax: s.a.x, az: s.a.z, bx: s.b.x, bz: s.b.z, ay: s.a.y, by: s.b.y,
      len2: (s.b.x - s.a.x) ** 2 + (s.b.z - s.a.z) ** 2,
    }));
  }
  nearest(x: number, z: number) {
    let best = Infinity, y = 0;
    for (const s of this.segs2) {
      const t = s.len2 > 0 ? THREE.MathUtils.clamp(((x - s.ax) * (s.bx - s.ax) + (z - s.az) * (s.bz - s.az)) / s.len2, 0, 1) : 0;
      const dx = x - (s.ax + (s.bx - s.ax) * t), dz = z - (s.az + (s.bz - s.az) * t);
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        y = s.ay + (s.by - s.ay) * t;
      }
    }
    return { d: Math.sqrt(best), y };
  }
  height(x: number, z: number) {
    const raw = -10 + fbm(x * 0.012 + 3.1, z * 0.012 + 7.7) * 36;
    const { d, y } = this.nearest(x, z);
    const k = smooth(8, 45, d);
    const near = Math.min(2, y - 5);
    let h = near + (raw - near) * k;
    const cap = y - 5 + smooth(20, 70, d) * 60;
    h = Math.min(h, cap);
    return h;
  }
}

/* ---------------- textures ---------------- */
function noiseTex(base: string, size = 256): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 6; i++) {
    const v = Math.random();
    ctx.fillStyle = `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cloudTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 14; i++) {
    const r = 22 + Math.random() * 30;
    const x = 40 + Math.random() * 176, y = 50 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bannerTex(text: string, bg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = "#fde68a";
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = "#fff7ed";
  ctx.font = "bold 72px Kanit, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- environment builder ---------------- */
export interface EnvHandles {
  water: THREE.Mesh;
  sky: THREE.Mesh;
  terrain: Terrain;
  flames: THREE.InstancedMesh;
}

export function buildRpgEnvironment(scene: THREE.Scene, segs: Segment[], isMobile: boolean): EnvHandles {
  const terrain = new Terrain(segs);

  // sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(480, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x3d7fd6) },
        mid: { value: new THREE.Color(0x9cc9f2) },
        bottom: { value: new THREE.Color(0xe6f0f7) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bottom, clamp(-h*4.0,0.0,1.0)); gl_FragColor = vec4(c,1.0); }`,
    })
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  // sun disc
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff4c2, transparent: true, opacity: 0.95, fog: false }));
  sunSprite.scale.set(40, 40, 1);
  sunSprite.position.set(180, 220, 60);
  sky.add(sunSprite);

  // clouds
  const ct = cloudTex();
  for (let i = 0; i < (isMobile ? 8 : 16); i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
    const sc = 40 + Math.random() * 60;
    sp.scale.set(sc, sc * 0.5, 1);
    const ang = Math.random() * Math.PI * 2, r = 200 + Math.random() * 200;
    sp.position.set(Math.cos(ang) * r, 90 + Math.random() * 70, Math.sin(ang) * r);
    sky.add(sp);
  }

  // terrain mesh
  const SIZE = 760, SEG = isMobile ? 72 : 110;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const cz = -190;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x5da042), grassDark = new THREE.Color(0x3f7a30), sand = new THREE.Color(0xd8c48a), rock = new THREE.Color(0x8a8578), snow = new THREE.Color(0xf3f6f8);
  const tmpC = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i) + cz;
    const h = terrain.height(x, z);
    pos.setY(i, h);
    pos.setZ(i, z);
    const n = vnoise(x * 0.08, z * 0.08);
    if (h < terrain.waterY + 1.2) tmpC.copy(sand);
    else if (h > 20) tmpC.copy(snow);
    else if (h > 12) tmpC.copy(rock).lerp(snow, (h - 12) / 8);
    else tmpC.copy(grass).lerp(grassDark, n).lerp(rock, smooth(8, 12, h));
    colors.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const gt = noiseTex("#ffffff");
  gt.repeat.set(60, 60);
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: gt, roughness: 0.95, metalness: 0 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // water
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshPhysicalMaterial({ color: 0x3aa0d8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.8, clearcoat: 1 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, terrain.waterY, cz);
  water.name = "water";
  scene.add(water);

  // distant mountains
  const mtnMat = new THREE.MeshStandardMaterial({ color: 0x6b7a8c, roughness: 1, flatShading: true });
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
    const r = 300 + Math.random() * 60;
    const h = 60 + Math.random() * 90;
    const base = new THREE.Mesh(new THREE.ConeGeometry(40 + Math.random() * 40, h, 6), mtnMat);
    base.position.set(Math.cos(ang) * r, -10 + h / 2, cz + Math.sin(ang) * r);
    base.rotation.y = Math.random() * Math.PI;
    scene.add(base);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(12, h * 0.28, 6), snowMat);
    cap.position.set(base.position.x, -10 + h - h * 0.14, base.position.z);
    cap.rotation.y = base.rotation.y;
    scene.add(cap);
  }

  // helper: random point in world away from track
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = (minD: number, maxD: number, tries = 30) => {
    for (let i = 0; i < tries; i++) {
      const x = rnd(-170, 190), z = rnd(-560, 120);
      const { d } = terrain.nearest(x, z);
      if (d < minD || d > maxD) continue;
      const h = terrain.height(x, z);
      if (h < terrain.waterY + 0.8 || h > 18) continue;
      return new THREE.Vector3(x, h, z);
    }
    return null;
  };

  // trees (instanced)
  const nTrees = isMobile ? 160 : 320;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 2.2, 6);
  const canopyGeo = new THREE.ConeGeometry(1.7, 4.2, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, nTrees);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, nTrees);
  const canopies2 = new THREE.InstancedMesh(canopyGeo, canopyMat, nTrees);
  trunks.castShadow = canopies.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const treeColors = [0x3f8f3a, 0x4fa64a, 0x2f7a3a, 0x6bb15a, 0x8fbf4a, 0xd68a3a];
  let ti = 0;
  for (let i = 0; i < nTrees * 3 && ti < nTrees; i++) {
    const p = pick(6, 140);
    if (!p) continue;
    const s = rnd(0.8, 1.7);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    sc.set(s, s, s);
    m.compose(new THREE.Vector3(p.x, p.y + 1.1 * s, p.z), q, sc);
    trunks.setMatrixAt(ti, m);
    m.compose(new THREE.Vector3(p.x, p.y + 3.6 * s, p.z), q, sc);
    canopies.setMatrixAt(ti, m);
    sc.set(s * 0.75, s * 0.8, s * 0.75);
    m.compose(new THREE.Vector3(p.x, p.y + 5.6 * s, p.z), q, sc);
    canopies2.setMatrixAt(ti, m);
    const col = new THREE.Color(treeColors[Math.floor(Math.random() * treeColors.length)]);
    canopies.setColorAt(ti, col);
    canopies2.setColorAt(ti, col.clone().offsetHSL(0, 0, 0.06));
    ti++;
  }
  trunks.count = canopies.count = canopies2.count = ti;
  scene.add(trunks, canopies, canopies2);

  // rocks
  const nRocks = isMobile ? 40 : 80;
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 1, flatShading: true }), nRocks);
  let ri = 0;
  for (let i = 0; i < nRocks * 3 && ri < nRocks; i++) {
    const p = pick(5, 120);
    if (!p) continue;
    const s = rnd(0.5, 2.2);
    q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 3, Math.random()));
    sc.set(s, s * rnd(0.5, 0.9), s);
    m.compose(new THREE.Vector3(p.x, p.y + s * 0.2, p.z), q, sc);
    rocks.setMatrixAt(ri++, m);
  }
  rocks.count = ri;
  scene.add(rocks);

  // mushrooms
  const nMush = isMobile ? 30 : 60;
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0xf5f0e6 }), nMush);
  const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), nMush);
  let mi = 0;
  for (let i = 0; i < nMush * 3 && mi < nMush; i++) {
    const p = pick(4.5, 40);
    if (!p) continue;
    const s = rnd(0.6, 1.6);
    q.identity();
    sc.set(s, s, s);
    m.compose(new THREE.Vector3(p.x, p.y + 0.25 * s, p.z), q, sc);
    stems.setMatrixAt(mi, m);
    m.compose(new THREE.Vector3(p.x, p.y + 0.5 * s, p.z), q, sc);
    caps.setMatrixAt(mi, m);
    caps.setColorAt(mi, new THREE.Color(Math.random() < 0.5 ? 0xef4444 : 0xf59e0b));
    mi++;
  }
  stems.count = caps.count = mi;
  scene.add(stems, caps);

  // flowers as coloured points
  const nFl = isMobile ? 300 : 700;
  const fp = new Float32Array(nFl * 3), fc = new Float32Array(nFl * 3);
  const flCols = [0xffffff, 0xfde047, 0xf472b6, 0xa78bfa, 0xfb7185];
  let fi = 0;
  for (let i = 0; i < nFl * 3 && fi < nFl; i++) {
    const p = pick(4.5, 60, 5);
    if (!p) continue;
    fp.set([p.x, p.y + 0.15, p.z], fi * 3);
    const c = new THREE.Color(flCols[Math.floor(Math.random() * flCols.length)]);
    fc.set([c.r, c.g, c.b], fi * 3);
    fi++;
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute("position", new THREE.BufferAttribute(fp.slice(0, fi * 3), 3));
  fg.setAttribute("color", new THREE.BufferAttribute(fc.slice(0, fi * 3), 3));
  scene.add(new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.28, vertexColors: true, sizeAttenuation: true })));

  // torches along the road
  const torchPts: { p: THREE.Vector3 }[] = [];
  for (const s of segs) {
    if (s.zone === "gap" || s.zone === "dish") continue;
    const n = Math.floor(s.len / 16);
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n) * s.len;
      const side = (i + s.index) % 2 ? 1 : -1;
      const p = s.a.clone().addScaledVector(s.dir, t).addScaledVector(s.right, side * (s.width / 2 + 0.75));
      torchPts.push({ p });
    }
  }
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.11, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1 }), torchPts.length);
  const bowls = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.12, 0.25, 8), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.5 }), torchPts.length);
  const flames = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.2, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffb020 }),
    torchPts.length
  );
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,190,80,0.9)");
    g.addColorStop(1, "rgba(255,120,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  torchPts.forEach(({ p }, i) => {
    q.identity();
    sc.set(1, 1, 1);
    m.compose(new THREE.Vector3(p.x, p.y + 1.1, p.z), q, sc);
    posts.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, p.y + 2.25, p.z), q, sc);
    bowls.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, p.y + 2.5, p.z), q, sc);
    flames.setMatrixAt(i, m);
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.scale.set(1.6, 1.6, 1);
    g.position.set(p.x, p.y + 2.6, p.z);
    scene.add(g);
  });
  scene.add(posts, bowls, flames);

  // start gate: wooden arch + banner
  const s0 = segs[0];
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4f27, roughness: 0.9 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), wood);
    post.position.copy(s0.a).addScaledVector(s0.dir, -1).addScaledVector(s0.right, side * (s0.width / 2 + 0.9)).add(new THREE.Vector3(0, 3, 0));
    scene.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(s0.width + 2.4, 0.5, 0.6), wood);
  beam.position.copy(s0.a).addScaledVector(s0.dir, -1).add(new THREE.Vector3(0, 6, 0));
  beam.quaternion.copy(s0.quat);
  scene.add(beam);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(s0.width + 1, 1.6), new THREE.MeshStandardMaterial({ map: bannerTex("START  หมู่บ้านสไลม์", "#7f1d1d"), side: THREE.DoubleSide }));
  banner.position.copy(s0.a).addScaledVector(s0.dir, -1).add(new THREE.Vector3(0, 4.9, 0));
  banner.quaternion.copy(s0.quat);
  scene.add(banner);

  // castle at the finish
  const sf = segs[segs.length - 1];
  const stone = new THREE.MeshStandardMaterial({ color: 0xb8b0a2, roughness: 0.95 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x9f2d3a, roughness: 0.8 });
  const base = sf.b.clone().addScaledVector(sf.dir, 9);
  const baseY = base.y - 3;
  const keep = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 8), stone);
  keep.position.set(base.x, baseY + 5, base.z);
  keep.quaternion.copy(sf.quat);
  scene.add(keep);
  for (const side of [-1, 1]) {
    for (const back of [0, 1]) {
      const tp = base.clone().addScaledVector(sf.right, side * 6.5).addScaledVector(sf.dir, back * 8 - 4);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.3, 15, 10), stone);
      tower.position.set(tp.x, baseY + 7.5, tp.z);
      scene.add(tower);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 4, 10), roof);
      cone.position.set(tp.x, baseY + 17, tp.z);
      scene.add(cone);
      const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5), stone);
      flagPole.position.set(tp.x, baseY + 20, tp.z);
      scene.add(flagPole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), new THREE.MeshStandardMaterial({ color: 0xfacc15, side: THREE.DoubleSide }));
      flag.position.set(tp.x + 0.7, baseY + 20.8, tp.z);
      scene.add(flag);
    }
  }
  const gateArch = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.5, 8, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x4b3621 }));
  gateArch.position.copy(base).addScaledVector(sf.dir, -4.1).add(new THREE.Vector3(0, -3 + 2.2, 0));
  gateArch.quaternion.copy(sf.quat);
  scene.add(gateArch);
  const castleBanner = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.4), new THREE.MeshStandardMaterial({ map: bannerTex("ปราสาทเส้นชัย", "#1e3a8a"), side: THREE.DoubleSide }));
  castleBanner.position.copy(base).addScaledVector(sf.dir, -4.2).add(new THREE.Vector3(0, 5, 0));
  castleBanner.quaternion.copy(sf.quat);
  scene.add(castleBanner);

  return { water, sky, terrain, flames };
}
