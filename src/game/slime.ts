import * as THREE from "three";
import type * as CANNON from "cannon-es";

export const SLIME_R = 0.43;

export interface SlimeVisual {
  group: THREE.Group;
  blob: THREE.Mesh;
  eyes: THREE.Mesh[];
  phase: number;
  squash: number;
  airTime: number;
  tumble: number;
  blink: number;
  blinkT: number;
  prevVel: THREE.Vector3;
  facing: THREE.Quaternion;
  curSy: number;
  curSxz: number;
  curY: number;
  squashVel: number;
}

let blobGeo: THREE.BufferGeometry | null = null;
function getBlobGeo() {
  if (blobGeo) return blobGeo;
  const g = new THREE.SphereGeometry(SLIME_R, 28, 20);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    const x = pos.getX(i), z = pos.getZ(i);
    // flatten the bottom, keep a soft dome
    if (y < -0.12) {
      const k = (y + 0.12) / (SLIME_R - 0.12); // -1..0
      y = -0.12 + k * 0.22;
      const spread = 1 + Math.abs(k) * 0.12;
      pos.setX(i, x * spread);
      pos.setZ(i, z * spread);
    } else {
      y *= 0.9 + 0.1 * (1 - Math.abs(x) / SLIME_R); // subtle teardrop
    }
    pos.setY(i, y);
  }
  g.computeVertexNormals();
  blobGeo = g;
  return g;
}

const eyeGeo = new THREE.SphereGeometry(0.095, 12, 8);
const pupilGeo = new THREE.SphereGeometry(0.05, 10, 6);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.2 });
const mouthGeo = new THREE.TorusGeometry(0.07, 0.018, 6, 12, Math.PI);
const mouthMat = new THREE.MeshBasicMaterial({ color: 0x7f1d1d });
const badgeGeo = new THREE.CircleGeometry(0.15, 20);

export function makeSlimeTexture(c1: string, c2: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const lg = ctx.createLinearGradient(0, 0, 0, 128);
  lg.addColorStop(0, c2);
  lg.addColorStop(0.45, c1);
  lg.addColorStop(1, c1);
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, 256, 128);
  // mixed swirls of the second colour
  for (let i = 0; i < 14; i++) {
    const r = 10 + Math.random() * 26;
    const x = Math.random() * 256, y = 20 + Math.random() * 108;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c2 + "dd");
    g.addColorStop(1, c2 + "00");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // glossy specks
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 24; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 128, 1 + Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeBadge(num: number, color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = "#111";
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(num), 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSlime(texture: THREE.Texture, color: string, num: number): SlimeVisual {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({
    map: texture,
    roughness: 0.22,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    transparent: true,
    opacity: 0.93,
    envMapIntensity: 1.1,
  });
  const blob = new THREE.Mesh(getBlobGeo(), mat);
  blob.castShadow = true;
  blob.receiveShadow = true;
  group.add(blob);

  const eyes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.16, 0.16, 0.36);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(0, 0.0, 0.065);
    eye.add(pupil);
    blob.add(eye);
    eyes.push(eye);
  }
  const mouth = new THREE.Mesh(mouthGeo, mouthMat);
  mouth.position.set(0, 0.0, 0.42);
  mouth.rotation.x = Math.PI;
  blob.add(mouth);

  const badge = new THREE.Mesh(badgeGeo, new THREE.MeshBasicMaterial({ map: makeBadge(num, color), transparent: true }));
  badge.position.set(0, -0.14, 0.41);
  badge.rotation.x = -0.35;
  blob.add(badge);

  return {
    group,
    blob,
    eyes,
    phase: Math.random() * Math.PI * 2,
    squash: 0,
    airTime: 0,
    tumble: 0,
    blink: 0,
    blinkT: 1 + Math.random() * 3,
    prevVel: new THREE.Vector3(),
    facing: new THREE.Quaternion(),
    curSy: 1,
    curSxz: 1,
    curY: 0,
    squashVel: 0,
  };
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _obj = new THREE.Object3D();
const _lean = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Animation state machine:
 *  - tumble (hit / airborne): follow physics rotation, stretch along velocity
 *  - run (grounded, moving): face travel direction, hop-run squash/stretch
 *  - idle: breathing
 */
export function animateSlime(sv: SlimeVisual, body: CANNON.Body, grounded: boolean, dt: number, now: number) {
  const v = body.velocity;
  _v.set(v.x, v.y, v.z);
  const hSpeed = Math.hypot(v.x, v.z);
  const speed = _v.length();

  // impact detection (spring-driven squash)
  const dv = sv.prevVel.distanceTo(_v);
  if (dv > 4.5) sv.tumble = Math.max(sv.tumble, 0.8 + Math.min(1, dv / 12));
  if (dv > 2.5) sv.squashVel -= Math.min(6, dv * 0.9);
  sv.prevVel.copy(_v);

  if (!grounded) sv.airTime += dt;
  else {
    if (sv.airTime > 0.22) sv.squashVel -= 5;
    sv.airTime = 0;
  }
  sv.tumble = Math.max(0, sv.tumble - dt);
  // damped spring for squash: squash ~ displacement
  const k = 140, c = 14;
  sv.squashVel += (-k * sv.squash - c * sv.squashVel) * dt;
  sv.squash += sv.squashVel * dt;
  sv.squash = THREE.MathUtils.clamp(sv.squash, -0.45, 0.35);

  const airborne = sv.airTime > 0.12;
  const rolling = sv.tumble > 0 || airborne;

  let sy = 1, sxz = 1, yOff = 0;

  if (rolling) {
    const bq = body.interpolatedQuaternion;
    _q.set(bq.x, bq.y, bq.z, bq.w);
    sv.group.quaternion.slerp(_q, 1 - Math.exp(-18 * dt));
    if (airborne) {
      const stretch = THREE.MathUtils.clamp(speed / 14, 0, 0.35);
      sy = 1 + stretch;
      sxz = 1 - stretch * 0.45;
    } else {
      // wobble while tumbling on ground
      const w = Math.sin(now * 0.02) * 0.08 * Math.min(1, sv.tumble);
      sy = 1 + w;
      sxz = 1 - w * 0.5;
    }
  } else if (hSpeed > 1.2) {
    _obj.position.set(0, 0, 0);
    _obj.lookAt(v.x, 0, v.z);
    _lean.setFromAxisAngle(X_AXIS, THREE.MathUtils.clamp(hSpeed / 10, 0, 1) * 0.28);
    sv.facing.copy(_obj.quaternion).multiply(_lean);
    sv.group.quaternion.slerp(sv.facing, 1 - Math.exp(-10 * dt));
    sv.phase += dt * (7 + hSpeed * 1.8);
    const hop = Math.sin(sv.phase);
    sy = 1 + 0.17 * hop;
    sxz = 1 - 0.08 * hop;
    yOff = Math.max(0, hop) * 0.11;
  } else {
    // idle: upright, keep yaw, gentle breathing
    _v.set(0, 0, 1).applyQuaternion(sv.group.quaternion);
    _v.y = 0;
    if (_v.lengthSq() < 0.01) _v.set(0, 0, 1);
    _obj.position.set(0, 0, 0);
    _obj.lookAt(_v.x, 0, _v.z);
    sv.group.quaternion.slerp(_obj.quaternion, 1 - Math.exp(-6 * dt));
    const br = Math.sin(now * 0.004 + sv.phase);
    sy = 1 + 0.045 * br;
    sxz = 1 - 0.025 * br;
  }

  // spring squash (negative = flattened, positive = stretched)
  sy *= 1 + sv.squash;
  sxz *= 1 - sv.squash * 0.55;

  // exponential smoothing so state changes never pop
  const sm = 1 - Math.exp(-22 * dt);
  sv.curSy += (sy - sv.curSy) * sm;
  sv.curSxz += (sxz - sv.curSxz) * sm;
  sv.curY += (yOff - sv.curY) * sm;
  sv.blob.scale.set(sv.curSxz, sv.curSy, sv.curSxz);
  sv.blob.position.y = SLIME_R * 0.78 * (sv.curSy - 1) + sv.curY;

  // blink
  sv.blinkT -= dt;
  if (sv.blinkT <= 0) {
    sv.blink = 0.14;
    sv.blinkT = 1.5 + Math.random() * 3.5;
  }
  sv.blink -= dt;
  const es = sv.blink > 0 ? 0.12 : 1;
  for (const e of sv.eyes) e.scale.y = es;
}
