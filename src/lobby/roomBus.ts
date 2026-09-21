import type { BusMsg, RoomMember, RoomState } from "./types";

const CH = "slime-run-rooms-v1";
const LS = "slime-run-room-";
const CID = "slime-run-client-id";

export function getClientId() {
  try {
    let id = sessionStorage.getItem(CID);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      sessionStorage.setItem(CID, id);
    }
    return id;
  } catch {
    return "local-" + Math.random().toString(36).slice(2, 8);
  }
}

export function makeCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

function load(code: string): RoomState | null {
  try {
    const raw = localStorage.getItem(LS + code);
    if (!raw) return null;
    const room = JSON.parse(raw) as RoomState;
    if (!room?.code || !Array.isArray(room.members)) return null;
    if (Date.now() - (room.updatedAt || 0) > 1000 * 60 * 45) {
      localStorage.removeItem(LS + code);
      return null;
    }
    return room;
  } catch {
    return null;
  }
}

function save(room: RoomState) {
  try {
    localStorage.setItem(LS + room.code, JSON.stringify(room));
  } catch {
    /* quota */
  }
}

export function listPublicRooms(): RoomState[] {
  const out: RoomState[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(LS)) continue;
      const room = load(k.slice(LS.length));
      if (room && room.phase === "lobby") out.push(room);
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
}

type Listener = (room: RoomState | null) => void;

export class RoomBus {
  readonly id = getClientId();
  private ch: BroadcastChannel | null = null;
  private room: RoomState | null = null;
  private listeners = new Set<Listener>();
  private heartbeat: number | null = null;

  constructor() {
    try {
      this.ch = new BroadcastChannel(CH);
      this.ch.onmessage = (ev) => this.onMsg(ev.data as BusMsg);
    } catch {
      this.ch = null;
    }
  }

  get snapshot() {
    return this.room;
  }

  isHost() {
    return !!this.room && this.room.hostId === this.id;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.room);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const fn of this.listeners) fn(this.room);
  }

  private post(msg: BusMsg) {
    try {
      this.ch?.postMessage(msg);
    } catch {
      /* ignore */
    }
  }

  private clone(room: RoomState): RoomState {
    return {
      ...room,
      members: room.members.map((m) => ({ ...m })),
      updatedAt: Date.now(),
    };
  }

  private commit(room: RoomState) {
    const next = this.clone(room);
    this.room = next;
    save(next);
    this.post({ t: "state", room: next });
    this.emit();
  }

  create(name: string, maxPlayers: number, hostName: string, colorIdx: number) {
    const code = makeCode();
    const host: RoomMember = {
      id: this.id,
      name: hostName.trim() || "เจ้าของห้อง",
      colorIdx,
      balls: 1,
      ready: true,
      isHost: true,
    };
    const room: RoomState = {
      code,
      name: name.trim() || "ห้องสไลม์",
      hostId: this.id,
      maxPlayers: Math.max(2, Math.min(30, maxPlayers)),
      members: [host],
      phase: "lobby",
      seed: Math.floor(Math.random() * 1e9),
      updatedAt: Date.now(),
    };
    this.splitBalls(room);
    this.commit(room);
    this.startHeartbeat();
    return room;
  }

  join(code: string, name: string, colorIdx: number): string | null {
    const c = code.trim().toUpperCase();
    const existing = load(c);
    if (!existing) return "ไม่พบห้องนี้";
    if (existing.phase !== "lobby") return "ห้องนี้เริ่มแข่งแล้ว";
    if (existing.members.length >= existing.maxPlayers) return "ห้องเต็มแล้ว";
    if (existing.members.some((m) => m.id === this.id)) {
      this.room = existing;
      this.emit();
      this.post({ t: "hello", code: c, from: this.id });
      return null;
    }
    const member: RoomMember = {
      id: this.id,
      name: name.trim() || "ผู้เล่น",
      colorIdx,
      balls: 1,
      ready: true,
      isHost: false,
    };
    this.room = existing;
    this.post({ t: "join", code: c, member });
    // optimistic if we are somehow host (shouldn't)
    if (existing.hostId === this.id) {
      existing.members.push(member);
      this.splitBalls(existing);
      this.commit(existing);
    } else {
      this.emit();
    }
    return null;
  }

  nextFreeColor() {
    if (!this.room) return 0;
    const used = new Set(this.room.members.map((m) => m.colorIdx));
    for (let i = 0; i < 16; i++) if (!used.has(i)) return i;
    return this.room.members.length % 16;
  }

  /** Host adds a named player (AI/bot) with a custom name. */
  addPlayer(name: string): boolean {
    if (!this.room || !this.isHost()) return false;
    if (this.room.members.length >= this.room.maxPlayers) return false;
    const n = this.room.members.filter((m) => m.ai || m.local).length + 1;
    const m: RoomMember = {
      id: "ai-" + Math.random().toString(36).slice(2, 9),
      name: name.trim() || `ผู้เล่น ${n}`,
      colorIdx: this.nextFreeColor(),
      balls: 1,
      ready: true,
      isHost: false,
      ai: true,
      local: true,
    };
    this.room.members = [...this.room.members, m];
    this.normalizeBalls(this.room);
    this.commit(this.room);
    return true;
  }

  /** Host adds one CPU slime (1 player = 1 slime). */
  addAI(): boolean {
    if (!this.room || !this.isHost()) return false;
    if (this.room.members.length >= this.room.maxPlayers) return false;
    const used = new Set(this.room.members.map((m) => m.colorIdx));
    let colorIdx = 0;
    for (let i = 0; i < 16; i++) {
      if (!used.has(i)) {
        colorIdx = i;
        break;
      }
      colorIdx = i;
    }
    const n = this.room.members.filter((m) => m.ai).length + 1;
    const m: RoomMember = {
      id: "ai-" + Math.random().toString(36).slice(2, 9),
      name: `AI ${n}`,
      colorIdx,
      balls: 1,
      ready: true,
      isHost: false,
      ai: true,
    };
    this.room.members = [...this.room.members, m];
    this.normalizeBalls(this.room);
    this.commit(this.room);
    return true;
  }

  /** Remove the last AI. Humans who joined are never removed here (use kick). */
  removeAI(): boolean {
    if (!this.room || !this.isHost()) return false;
    const ais = this.room.members.filter((m) => m.ai);
    if (!ais.length) return false;
    const lastId = ais[ais.length - 1].id;
    const members = this.room.members.filter((m) => m.id !== lastId);
    const next = { ...this.room, members };
    this.renumberAI(next);
    this.normalizeBalls(next);
    this.commit(next);
    return true;
  }

  fillAI(): number {
    if (!this.room || !this.isHost()) return 0;
    let n = 0;
    while (this.room.members.length < this.room.maxPlayers) {
      if (!this.addAI()) break;
      n++;
    }
    return n;
  }

  /** @deprecated use addAI */
  addLocal(_name: string, _colorIdx: number) {
    this.addAI();
  }

  leave() {
    if (!this.room) return;
    const code = this.room.code;
    const id = this.id;
    if (this.isHost()) {
      this.room.phase = "results";
      this.commit(this.room);
      try {
        localStorage.removeItem(LS + code);
      } catch {
        /* ignore */
      }
      this.post({ t: "ended", code });
    } else {
      this.post({ t: "leave", code, id });
    }
    this.stopHeartbeat();
    this.room = null;
    this.emit();
  }

  kick(id: string) {
    if (!this.room || !this.isHost()) return;
    if (!id || id === this.id) return;
    const members = this.room.members.filter((m) => m.id !== id);
    if (members.length === this.room.members.length) return;
    this.commit({ ...this.room, members });
    this.post({ t: "kick", code: this.room.code, id });
  }

  patchSelf(patch: Partial<RoomMember>) {
    if (!this.room) return;
    if (!this.isHost()) {
      // joiners may only change color; name stays locked, always ready
      patch = { colorIdx: patch.colorIdx, ready: true };
    }
    if (this.isHost()) {
      this.room.members = this.room.members.map((m) => (m.id === this.id ? { ...m, ...patch } : m));
      this.commit(this.room);
    } else {
      this.post({ t: "patch", code: this.room.code, id: this.id, patch });
    }
  }

  patchMember(id: string, patch: Partial<RoomMember>) {
    if (!this.room || !this.isHost()) return;
    const target = this.room.members.find((m) => m.id === id);
    if (!target) return;
    // cannot rename people who joined the room
    if (!target.ai && !target.local && !target.isHost) {
      delete patch.name;
    }
    this.room.members = this.room.members.map((m) => (m.id === id ? { ...m, ...patch, balls: 1 } : m));
    this.commit(this.room);
  }

  setSettings(name: string, maxPlayers: number) {
    if (!this.room || !this.isHost()) return;
    this.room.name = name.trim() || this.room.name;
    this.room.maxPlayers = Math.max(this.room.members.length, Math.min(30, maxPlayers));
    this.commit(this.room);
  }

  splitEven() {
    if (!this.room || !this.isHost()) return;
    this.splitBalls(this.room);
    this.commit(this.room);
  }

  start() {
    if (!this.room || !this.isHost()) return;
    if (this.room.members.length < 2) return;
    this.splitBalls(this.room);
    this.room.phase = "racing";
    this.room.seed = Math.floor(Math.random() * 1e9);
    this.commit(this.room);
    this.post({ t: "start", code: this.room.code, seed: this.room.seed, members: this.room.members });
  }

  backToLobby() {
    if (!this.room || !this.isHost()) return;
    this.room.phase = "lobby";
    this.room.members = this.room.members.map((m) => ({ ...m, ready: true }));
    this.commit(this.room);
  }

  private normalizeBalls(room: RoomState) {
    room.members = room.members.map((m) => ({ ...m, balls: 1 }));
  }

  private renumberAI(room: RoomState) {
    let n = 0;
    room.members = room.members.map((m) => (m.ai ? { ...m, name: `AI ${++n}` } : m));
  }

  private splitBalls(room: RoomState) {
    this.normalizeBalls(room);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = window.setInterval(() => {
      if (this.room && this.isHost()) {
        this.room.updatedAt = Date.now();
        save(this.room);
        this.post({ t: "state", room: this.room });
      }
    }, 2000);
  }

  private stopHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private onMsg(msg: BusMsg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "state") {
      if (this.room && msg.room.code !== this.room.code) return;
      if (!this.room && msg.room.members.some((m) => m.id === this.id)) {
        this.room = msg.room;
        this.emit();
        return;
      }
      if (this.room && msg.room.code === this.room.code) {
        // host ignores own echo; guests apply
        if (!this.isHost()) {
          this.room = msg.room;
          this.emit();
        }
      }
      return;
    }
    if (msg.t === "hello" && this.room && this.isHost() && msg.code === this.room.code) {
      this.post({ t: "state", room: this.room });
      return;
    }
    if (msg.t === "join" && this.room && this.isHost() && msg.code === this.room.code) {
      if (this.room.phase !== "lobby") return;
      if (this.room.members.some((m) => m.id === msg.member.id)) return;
      if (this.room.members.length >= this.room.maxPlayers) return;
      this.room.members.push({ ...msg.member, ready: true, isHost: false, balls: 1 });
      this.normalizeBalls(this.room);
      this.commit(this.room);
      return;
    }
    if (msg.t === "leave" && this.room && this.isHost() && msg.code === this.room.code) {
      this.room.members = this.room.members.filter((m) => m.id !== msg.id);
      this.splitBalls(this.room);
      this.commit(this.room);
      return;
    }
    if (msg.t === "patch" && this.room && this.isHost() && msg.code === this.room.code) {
      this.room.members = this.room.members.map((m) => {
        if (m.id !== msg.id) return m;
        const { colorIdx } = msg.patch;
        return { ...m, colorIdx: colorIdx ?? m.colorIdx, ready: true, name: m.name, isHost: m.isHost, id: m.id, balls: 1 };
      });
      this.commit(this.room);
      return;
    }
    if (msg.t === "kick" && this.room && msg.id === this.id) {
      this.room = null;
      this.emit();
      return;
    }
    if (msg.t === "start" && this.room && msg.code === this.room.code && !this.isHost()) {
      this.room = { ...this.room, phase: "racing", seed: msg.seed, members: msg.members };
      this.emit();
      return;
    }
    if (msg.t === "ended" && this.room && msg.code === this.room.code) {
      this.room = null;
      this.emit();
    }
  }

  dispose() {
    this.stopHeartbeat();
    try {
      this.ch?.close();
    } catch {
      /* ignore */
    }
  }
}
