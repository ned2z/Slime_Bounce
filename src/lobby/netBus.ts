import type { BusMsg, FinishResult, RoomMember, RoomState } from "./types";
import { SLIME_COLORS } from "../game/colors";
import { getClientId, makeCode } from "./roomBus";

type Listener = (room: RoomState | null) => void;
type ResultsListener = (results: FinishResult[]) => void;

/** Messages that only travel between client and relay server. */
type SrvMsg =
  | { t: "create"; code: string; id: string; room: RoomState }
  | { t: "joinErr"; code: string; error: string }
  | { t: "ping" }
  | { t: "pong" };

type OutMsg = BusMsg | SrvMsg;

/**
 * Cross-device lobby transport (see server/index.js). Mirrors the RoomBus API
 * so App.tsx can switch between them via VITE_WS_URL. The host client stays
 * authoritative: the server only relays messages and tracks presence.
 *
 * Multiplayer model: "Shared Lobby + Synced Start + race on real time".
 * - Joiners always enter as spectators; the host admits them into the roster.
 * - Official finish times flow to the host, which broadcasts ONE results set.
 */
export class NetBus {
  readonly id = getClientId();
  private url: string;
  private ws: WebSocket | null = null;
  private queue: OutMsg[] = [];
  private room: RoomState | null = null;
  private listeners = new Set<Listener>();
  private resultsListeners = new Set<ResultsListener>();
  private errorListeners = new Set<(text: string) => void>();
  private resultsMap = new Map<string, FinishResult>();
  private pendingJoin: { code: string; settle: (err: string | null) => void } | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private disposed = false;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  // ---------- connection ----------

  private connect() {
    if (this.disposed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.flush();
      // re-announce ourselves so the host can push fresh state (reconnect case)
      if (this.room) this.send({ t: "hello", code: this.room.code, from: this.id });
      this.pingTimer = window.setInterval(() => this.send({ t: "ping" }), 20000);
    };
    ws.onmessage = (ev) => {
      try {
        this.onSrvMsg(JSON.parse(ev.data as string) as OutMsg);
      } catch {
        /* ignore bad frame */
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2500);
  }

  private send(msg: OutMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        this.queue.push(msg);
      }
    } else {
      this.queue.push(msg);
    }
  }

  private flush() {
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.send(m);
  }

  // ---------- public API (mirrors RoomBus) ----------

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

  subscribeResults(fn: ResultsListener) {
    this.resultsListeners.add(fn);
    fn(this.results());
    return () => {
      this.resultsListeners.delete(fn);
    };
  }

  /** Server-side rejections that are not tied to a pending join (e.g. create collision). */
  subscribeError(fn: (text: string) => void) {
    this.errorListeners.add(fn);
    return () => {
      this.errorListeners.delete(fn);
    };
  }

  private emitError(text: string) {
    for (const fn of this.errorListeners) fn(text);
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
    this.room = this.clone(room);
    this.send({ t: "create", code, id: this.id, room: this.room });
    this.emit();
    return this.room;
  }

  /** Join as a spectator — the host decides who gets to play. */
  join(code: string, name: string, colorIdx: number): Promise<string | null> {
    const c = code.trim().toUpperCase();
    const member: RoomMember = {
      id: this.id,
      name: name.trim() || "ผู้เล่น",
      colorIdx,
      balls: 1,
      ready: true,
      isHost: false,
      spectator: true,
    };
    return new Promise<string | null>((resolve) => {
      let settle = (err: string | null) => resolve(err);
      const timer = window.setTimeout(() => {
        if (this.pendingJoin && this.pendingJoin.settle === settle) {
          this.pendingJoin = null;
          settle("เชื่อมต่อห้องไม่สำเร็จ (หมดเวลา)");
        }
      }, 8000);
      settle = (err: string | null) => {
        window.clearTimeout(timer);
        resolve(err);
      };
      this.pendingJoin = { code: c, settle };
      this.send({ t: "join", code: c, member });
    });
  }

  /** Host admits a spectator into the playing roster. */
  admitPlayer(id: string): boolean {
    if (!this.room || !this.isHost()) return false;
    const target = this.room.members.find((m) => m.id === id);
    if (!target || !target.spectator) return false;
    const players = this.playersOf(this.room);
    if (players.length >= this.room.maxPlayers) return false;
    const used = new Set(players.map((m) => m.colorIdx));
    const colorIdx = used.has(target.colorIdx) ? this.nextFreeColor() : target.colorIdx;
    this.room.members = this.room.members.map((m) =>
      m.id === id ? { ...m, spectator: false, colorIdx, balls: 1, ready: true } : m,
    );
    this.commit(this.room);
    return true;
  }

  /** Host sends a player back to spectating. */
  demoteToSpectator(id: string): boolean {
    if (!this.room || !this.isHost()) return false;
    const target = this.room.members.find((m) => m.id === id);
    if (!target || target.spectator || target.isHost) return false;
    this.room.members = this.room.members.map((m) =>
      m.id === id ? { ...m, spectator: true, balls: 1, ready: true } : m,
    );
    this.commit(this.room);
    return true;
  }

  nextFreeColor() {
    if (!this.room) return 0;
    const used = new Set(this.playersOf(this.room).map((m) => m.colorIdx));
    for (let i = 0; i < SLIME_COLORS.length; i++) if (!used.has(i)) return i;
    return this.playersOf(this.room).length % SLIME_COLORS.length;
  }

  /** Host adds a named player (AI/bot) with a custom name. */
  addPlayer(name: string): boolean {
    if (!this.room || !this.isHost()) return false;
    if (this.playersOf(this.room).length >= this.room.maxPlayers) return false;
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
    if (this.playersOf(this.room).length >= this.room.maxPlayers) return false;
    const colorIdx = this.nextFreeColor();
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

  /** Remove the last AI. */
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
    while (this.playersOf(this.room).length < this.room.maxPlayers) {
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
    if (this.isHost()) this.send({ t: "ended", code });
    else this.send({ t: "leave", code, id: this.id });
    this.room = null;
    this.resultsMap.clear();
    this.emit();
  }

  kick(id: string) {
    if (!this.room || !this.isHost()) return;
    if (!id || id === this.id) return;
    const members = this.room.members.filter((m) => m.id !== id);
    if (members.length === this.room.members.length) return;
    this.commit({ ...this.room, members });
    this.send({ t: "kick", code: this.room.code, id });
  }

  patchSelf(patch: Partial<RoomMember>) {
    if (!this.room) return;
    // spectators are watch-only
    if (this.room.members.find((m) => m.id === this.id)?.spectator) return;
    if (!this.isHost()) {
      // joiners may only change color; name stays locked, always ready
      patch = { colorIdx: patch.colorIdx, ready: true };
    }
    if (this.isHost()) {
      this.room.members = this.room.members.map((m) => (m.id === this.id ? { ...m, ...patch } : m));
      this.commit(this.room);
    } else {
      this.send({ t: "patch", code: this.room.code, id: this.id, patch });
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
    this.room.maxPlayers = Math.max(this.playersOf(this.room).length, Math.min(30, maxPlayers));
    this.commit(this.room);
  }

  splitEven() {
    if (!this.room || !this.isHost()) return;
    this.splitBalls(this.room);
    this.commit(this.room);
  }

  start() {
    if (!this.room || !this.isHost()) return;
    if (this.playersOf(this.room).length < 2) return;
    this.splitBalls(this.room);
    this.room.phase = "racing";
    this.room.seed = Math.floor(Math.random() * 1e9);
    this.resultsMap.clear();
    this.commit(this.room);
    this.send({ t: "start", code: this.room.code, seed: this.room.seed, members: this.room.members });
  }

  backToLobby() {
    if (!this.room || !this.isHost()) return;
    this.room.phase = "lobby";
    this.room.members = this.room.members.map((m) => ({ ...m, ready: true }));
    this.resultsMap.clear();
    this.commit(this.room);
  }

  // ---------- results (host-authoritative) ----------

  /** Report an official finish time to the host (guest = own slime, host = AI slimes). */
  reportFinish(id: string, name: string, colorIdx: number, finishTime: number) {
    if (!this.room) return;
    this.send({ t: "finish", code: this.room.code, id, name, colorIdx, finishTime });
  }

  /** Host: end the race and publish the authoritative results to everyone. */
  publishResults() {
    if (!this.room || !this.isHost()) return;
    this.room = this.clone({ ...this.room, phase: "results" });
    this.send({ t: "state", room: this.room });
    this.send({ t: "results", code: this.room.code, results: this.results() });
    this.emit();
  }

  private results(): FinishResult[] {
    return [...this.resultsMap.values()].sort((a, b) => a.finishTime - b.finishTime);
  }

  private applyResults(list: FinishResult[]) {
    this.send({ t: "results", code: this.room?.code ?? "", results: list });
    this.emitResults();
  }

  // ---------- internals ----------

  private playersOf(room: RoomState) {
    return room.members.filter((m) => !m.spectator);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.room);
  }

  private emitResults() {
    const list = this.results();
    for (const fn of this.resultsListeners) fn(list);
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
    this.send({ t: "state", room: next });
    this.emit();
  }

  private normalizeBalls(room: RoomState) {
    room.members = room.members.map((m) => (m.spectator ? m : { ...m, balls: 1 }));
  }

  private renumberAI(room: RoomState) {
    let n = 0;
    room.members = room.members.map((m) => (m.ai ? { ...m, name: `AI ${++n}` } : m));
  }

  private splitBalls(room: RoomState) {
    this.normalizeBalls(room);
  }

  private onSrvMsg(msg: OutMsg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "state") {
      if (this.room && msg.room.code !== this.room.code) return;
      if (!this.room && msg.room.members.some((m) => m.id === this.id)) {
        this.room = msg.room;
        this.pendingJoin?.settle(null);
        this.pendingJoin = null;
        this.emit();
        return;
      }
      if (this.room && msg.room.code === this.room.code && !this.isHost()) {
        this.room = msg.room;
        this.emit();
      }
      return;
    }
    if (msg.t === "results") {
      if (this.room && msg.code !== this.room.code) return;
      this.resultsMap = new Map(msg.results.map((r) => [r.id, r]));
      this.emitResults();
      return;
    }
    if (msg.t === "joinErr") {
      if (this.pendingJoin) {
        this.pendingJoin.settle(msg.error);
        this.pendingJoin = null;
      } else {
        // rejection for a message without a pending promise (e.g. create) — surface it
        this.emitError(msg.error);
      }
      return;
    }
    if (msg.t === "finish" && this.room && this.isHost() && msg.code === this.room.code) {
      // host merges the official finish times, then broadcasts ONE results set
      this.resultsMap.set(msg.id, {
        id: msg.id,
        name: msg.name,
        colorIdx: msg.colorIdx,
        finishTime: msg.finishTime,
      });
      this.applyResults(this.results());
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
    if (msg.t === "hello" && this.room && this.isHost() && msg.code === this.room.code) {
      this.send({ t: "state", room: this.room });
      return;
    }
    if (msg.t === "join" && this.room && this.isHost() && msg.code === this.room.code) {
      if (this.room.members.some((m) => m.id === msg.member.id)) return;
      const member: RoomMember = { ...msg.member, ready: true, isHost: false, balls: 1, spectator: true };
      // joiners are always spectators; reassign colour if a player owns it
      const used = new Set(this.playersOf(this.room).map((m) => m.colorIdx));
      if (used.has(member.colorIdx)) member.colorIdx = this.nextFreeColor();
      this.room.members = [...this.room.members, member];
      this.commit(this.room);
      // late arrival during results: re-push the authoritative results set
      if (this.room.phase === "results") this.applyResults(this.results());
      return;
    }
    if (msg.t === "patch" && this.room && this.isHost() && msg.code === this.room.code) {
      this.room.members = this.room.members.map((m) => {
        if (m.id !== msg.id) return m;
        const { colorIdx } = msg.patch;
        return { ...m, colorIdx: colorIdx ?? m.colorIdx, ready: true, balls: 1 };
      });
      this.commit(this.room);
      return;
    }
    if (msg.t === "leave" && this.room && this.isHost() && msg.code === this.room.code) {
      this.room.members = this.room.members.filter((m) => m.id !== msg.id);
      this.commit(this.room);
      return;
    }
    if (msg.t === "ended" && this.room && msg.code === this.room.code) {
      this.room = null;
      this.resultsMap.clear();
      this.emit();
    }
  }

  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
