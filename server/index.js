// Slime Run Adventure — WebSocket relay server
// Role: relay + presence only. The host client stays authoritative of the room
// (members, spectators, results). Deploy target: Render/Railway free tier
// (Vercel cannot host WebSocket servers).
//
// Client → server messages:
//   create / join / hello / state / patch / leave / kick / start / ended
//   finish  (relay to host — the host merges official finish times)
//   results (broadcast from host — single authoritative results set)
//   ping    (keep-alive, refreshes room activity)

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const ROOM_TTL = 45 * 60 * 1000; // drop rooms that have been empty for > 45 minutes

// code -> { state: RoomState, hostWs, conns: Set<ws>, memberWs: Map<memberId, ws>, lastActivity }
const rooms = new Map();
const wsRoom = new Map(); // ws -> room code
const wsMember = new Map(); // ws -> memberId

function log(...args) {
  console.log(`[relay ${new Date().toISOString()}]`, ...args);
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* ignore */
    }
  }
}

function broadcast(code, obj, except) {
  const r = rooms.get(code);
  if (!r) return;
  for (const ws of r.conns) {
    if (ws !== except) send(ws, obj);
  }
}

function detach(ws) {
  wsRoom.delete(ws);
  wsMember.delete(ws);
}

function handle(ws, m) {
  if (!m || typeof m !== "object" || typeof m.t !== "string") return;
  const code = typeof m.code === "string" ? m.code.toUpperCase() : "";
  const roomCode = wsRoom.get(ws);
  const r = roomCode ? rooms.get(roomCode) : null;

  switch (m.t) {
    case "ping": {
      send(ws, { t: "pong" });
      if (r) r.lastActivity = Date.now();
      return;
    }

    case "create": {
      if (!code) return;
      if (rooms.has(code)) {
        // extremely unlikely 4-char collision — nudge the host to retry with a new code
        log(`create REJECTED (code collision) code=${code}`);
        return send(ws, { t: "joinErr", code, error: "รหัสห้องชนกับห้องอื่น ลองสร้างใหม่อีกครั้ง" });
      }
      rooms.set(code, {
        state: m.room,
        hostWs: ws,
        conns: new Set([ws]),
        memberWs: new Map([[m.id, ws]]),
        lastActivity: Date.now(),
      });
      wsRoom.set(ws, code);
      wsMember.set(ws, m.id);
      log(`create code=${code} host=${m.id} members=${m.room?.members?.length ?? "?"} (rooms=${rooms.size})`);
      return;
    }

    case "join": {
      // Joiners are ALWAYS spectators (see RoomMember.spectator). The host
      // admits them into the playing roster from its own screen. Joining is
      // allowed in any phase (lobby / racing / results) — spectators may watch.
      const target = rooms.get(code);
      if (!target) {
        log(`join FAILED (room not found) code=${code} (rooms=${rooms.size}: ${[...rooms.keys()].join(",") || "-"})`);
        return send(ws, { t: "joinErr", code, error: "ไม่พบห้องนี้" });
      }
      if (!m.member || typeof m.member.id !== "string") return;
      if (target.memberWs.has(m.member.id)) return send(ws, { t: "joinErr", code, error: "คุณอยู่ในห้องนี้แล้ว" });
      if (target.hostWs.readyState !== 1) {
        log(`join FAILED (host offline) code=${code}`);
        return send(ws, { t: "joinErr", code, error: "เจ้าของห้องออฟไลน์" });
      }
      target.conns.add(ws);
      target.memberWs.set(m.member.id, ws);
      wsRoom.set(ws, code);
      wsMember.set(ws, m.member.id);
      target.lastActivity = Date.now();
      // host is authoritative — let it apply the join and broadcast new state
      log(`join code=${code} member=${m.member.id} "${m.member.name}" (conns=${target.conns.size})`);
      send(target.hostWs, { t: "join", code, member: m.member });
      return;
    }

    case "hello": {
      // reconnect / re-sync: announce ourselves so the host pushes fresh state
      const target = rooms.get(code);
      if (!target) return;
      target.conns.add(ws);
      target.memberWs.set(m.from, ws);
      wsRoom.set(ws, code);
      wsMember.set(ws, m.from);
      if (target.hostWs === ws) send(ws, { t: "state", room: target.state });
      else send(target.hostWs, { t: "hello", code, from: m.from });
      return;
    }

    case "state": {
      // only the host may push room state
      if (!r || r.hostWs !== ws || !m.room || m.room.code !== r.state.code) return;
      r.state = m.room;
      r.lastActivity = Date.now();
      broadcast(r.state.code, { t: "state", room: m.room }, ws);
      return;
    }

    case "patch":
    case "leave": {
      if (!r || m.code !== r.state.code) return;
      if (m.t === "leave") {
        // the leaver is out — stop broadcasting room traffic to it
        r.conns.delete(ws);
        const id = wsMember.get(ws);
        if (id) r.memberWs.delete(id);
        detach(ws);
      }
      if (r.hostWs !== ws) send(r.hostWs, m);
      return;
    }

    case "kick": {
      if (!r || m.code !== r.state.code || r.hostWs !== ws) return;
      const target = r.memberWs.get(m.id);
      r.memberWs.delete(m.id);
      if (target) {
        r.conns.delete(target);
        detach(target);
        send(target, { t: "kick", code: m.code, id: m.id });
      }
      return;
    }

    case "start": {
      if (!r || m.code !== r.state.code || r.hostWs !== ws) return;
      r.lastActivity = Date.now();
      broadcast(m.code, m, ws);
      return;
    }

    case "ended": {
      if (!r || m.code !== r.state.code || r.hostWs !== ws) return;
      const conns = [...r.conns];
      rooms.delete(m.code);
      for (const c of conns) {
        send(c, { t: "ended", code: m.code });
        detach(c);
      }
      return;
    }

    case "finish": {
      // official finish times flow INTO the host; the host broadcasts "results"
      if (!r || m.code !== r.state.code || r.hostWs === ws) return;
      send(r.hostWs, m);
      return;
    }

    case "results": {
      // only the host may publish the authoritative results
      if (!r || m.code !== r.state.code || r.hostWs !== ws) return;
      r.lastActivity = Date.now();
      broadcast(m.code, m, ws);
      return;
    }
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("slime-run relay is running\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  log(`connection open (clients=${wss.clients.size})`);
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  ws.on("message", (data) => {
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    handle(ws, m);
  });
  ws.on("close", () => {
    const code = wsRoom.get(ws);
    const id = wsMember.get(ws);
    detach(ws);
    const r = code ? rooms.get(code) : null;
    if (!r) return;
    r.conns.delete(ws);
    if (id) r.memberWs.delete(id);
    if (r.hostWs === ws) {
      // host is gone — the room dies with it
      log(`host DISCONNECTED — room killed code=${code}`);
      const conns = [...r.conns];
      rooms.delete(code);
      for (const c of conns) {
        send(c, { t: "ended", code });
        detach(c);
      }
    } else if (id) {
      log(`leave code=${code} member=${id}`);
      send(r.hostWs, { t: "leave", code, id });
    }
  });
});

// heartbeat: terminate dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 30000);

// cleanup: remove rooms that have been empty for too long
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.conns.size === 0 && now - r.lastActivity > ROOM_TTL) {
      rooms.delete(code);
      for (const c of r.conns) detach(c);
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`slime-run relay listening on :${PORT}`);
});
