import * as THREE from "three";

export type ZoneType =
  | "start"
  | "plain"
  | "rocks"
  | "lava"
  | "spinners"
  | "pegs"
  | "pistons"
  | "wind"
  | "hammers"
  | "hold"
  | "dish"
  | "ramp"
  | "gap"
  | "landing"
  | "warp"
  | "meteor"
  | "ice"
  | "gate"
  | "storm"
  | "boost"
  | "finish";

export interface Waypoint {
  x: number;
  y: number;
  z: number;
  /** zone of the segment starting at this waypoint */
  zone?: ZoneType;
  /** width of the segment starting at this waypoint */
  w?: number;
  /** random-event slot id (1..5) for the segment starting here */
  event?: number;
}

export interface Segment {
  index: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  dir: THREE.Vector3; // normalized a->b
  dh: THREE.Vector3; // horizontal dir normalized
  right: THREE.Vector3; // horizontal right vector
  up: THREE.Vector3; // local up (perpendicular to dir, in plane with world up)
  len: number;
  width: number;
  zone: ZoneType;
  event: number;
  cumStart: number; // cumulative length at start
  quat: THREE.Quaternion; // orientation: local -Z points along dir
  mStart: number; // miter extension at start
  mEnd: number; // miter extension at end
  turnStart: number; // +1 left, -1 right, 0 none
  turnEnd: number;
}

/** The course: descending winding path. */
export const WAYPOINTS: Waypoint[] = [
  { x: 0, y: 105.0, z: 0, zone: "start", w: 8 },
  { x: 0, y: 103.0, z: -16, zone: "rocks", w: 8 },
  { x: 0, y: 94.0, z: -46, zone: "plain", w: 7 },
  { x: 0, y: 93.2, z: -56, zone: "plain", w: 7 },
  { x: 22, y: 91.44, z: -56, zone: "plain", w: 7 },
  { x: 22, y: 90.64, z: -66, zone: "lava", w: 8 },
  { x: 22, y: 81.04, z: -98, zone: "plain", w: 7, event: 1 },
  { x: 22, y: 77.44, z: -116, zone: "hold", w: 7 },
  { x: 22, y: 76.14, z: -132, zone: "plain", w: 7 },
  { x: 22, y: 75.34, z: -142, zone: "spinners", w: 8 },
  { x: -4, y: 72.74, z: -142, zone: "plain", w: 7 },
  { x: -14, y: 71.94, z: -142, zone: "plain", w: 7 },
  { x: -14, y: 71.14, z: -152, zone: "pegs", w: 12 },
  { x: -14, y: 63.64, z: -182, zone: "plain", w: 8, event: 2 },
  { x: -14, y: 60.04, z: -200, zone: "plain", w: 7 },
  { x: -14, y: 59.24, z: -210, zone: "pistons", w: 7 },
  { x: 14, y: 56.44, z: -210, zone: "plain", w: 7 },
  { x: 22, y: 55.8, z: -210, zone: "plain", w: 7 },
  { x: 22, y: 55.0, z: -220, zone: "plain", w: 7, event: 3 },
  { x: 22, y: 51.4, z: -238, zone: "plain", w: 7, event: 4 },
  { x: 22, y: 46.9, z: -256, zone: "ramp", w: 7 },
  { x: 22, y: 48.5, z: -266, zone: "gap", w: 7 },
  { x: 22, y: 44.5, z: -273, zone: "landing", w: 10 },
  { x: 22, y: 42.7, z: -291, zone: "plain", w: 7 },
  { x: 22, y: 41.9, z: -301, zone: "dish", w: 10 },
  { x: 22, y: 36.95, z: -303.5, zone: "plain", w: 10 },
  { x: 22, y: 35.65, z: -320, zone: "wind", w: 9 },
  { x: -6, y: 32.85, z: -320, zone: "plain", w: 7 },
  { x: -16, y: 32.05, z: -320, zone: "plain", w: 7 },
  { x: -16, y: 31.25, z: -330, zone: "warp", w: 9 },
  { x: -16, y: 26.85, z: -352, zone: "plain", w: 7, event: 5 },
  { x: -16, y: 23.25, z: -370, zone: "plain", w: 7 },
  { x: -16, y: 22.45, z: -380, zone: "hammers", w: 8 },
  { x: 12, y: 19.65, z: -380, zone: "plain", w: 7 },
  { x: 20, y: 19.01, z: -380, zone: "plain", w: 7 },
  { x: 20, y: 18.21, z: -390, zone: "finish", w: 7 },
  { x: 20, y: 13.81, z: -412, zone: "finish", w: 7 },
];

const UP = new THREE.Vector3(0, 1, 0);

export function buildSegments(wps: Waypoint[] = WAYPOINTS): Segment[] {
  const segs: Segment[] = [];
  let cum = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const a = new THREE.Vector3(wps[i].x, wps[i].y, wps[i].z);
    const b = new THREE.Vector3(wps[i + 1].x, wps[i + 1].y, wps[i + 1].z);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const dh = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const right = new THREE.Vector3().crossVectors(dh, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const obj = new THREE.Object3D();
    obj.position.copy(a);
    obj.up.copy(UP);
    obj.lookAt(b);
    segs.push({
      index: i,
      a,
      b,
      dir,
      dh,
      right,
      up,
      len,
      width: wps[i].w ?? 7,
      zone: wps[i].zone ?? "plain",
      event: wps[i].event ?? 0,
      cumStart: cum,
      quat: obj.quaternion.clone(),
      mStart: 0,
      mEnd: 0,
      turnStart: 0,
      turnEnd: 0,
    });
    cum += len;
  }
  // compute miters
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (i > 0) {
      const p = segs[i - 1];
      const cross = new THREE.Vector3().crossVectors(p.dh, s.dh);
      const ang = Math.acos(THREE.MathUtils.clamp(p.dh.dot(s.dh), -1, 1));
      const w = Math.max(p.width, s.width);
      const m = Math.min((w / 2) * Math.tan(ang / 2), w);
      s.mStart = m;
      p.mEnd = m;
      const t = Math.abs(cross.y) > 0.01 ? (cross.y > 0 ? 1 : -1) : 0;
      s.turnStart = t;
      p.turnEnd = t;
    }
  }
  return segs;
}

export function totalLength(segs: Segment[]) {
  const last = segs[segs.length - 1];
  return last.cumStart + last.len;
}
