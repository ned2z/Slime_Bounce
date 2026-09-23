import { useEffect, useMemo, useRef, useState } from "react";
import { slimeGradient, SLIME_COLORS } from "./game/colors";
import { Game, type BallInfo, type EventDef, type PlayerConfig, type Snapshot, type ZoneMarker } from "./game/Game";
import HUD from "./components/HUD";
import ResultsScreen from "./components/ResultsScreen";
import LobbyHome from "./components/LobbyHome";
import RoomScreen from "./components/RoomScreen";
import { RoomBus } from "./lobby/roomBus";
import { NetBus } from "./lobby/netBus";
import type { FinishResult, RoomMember, RoomState } from "./lobby/types";

type Phase = "lobby" | "room" | "race" | "results";

// Cross-device transport is enabled by setting VITE_WS_URL (e.g. on Render/Railway).
// Unset → RoomBus (BroadcastChannel/localStorage), multiple tabs on one device.
const WS_URL: string | undefined = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_WS_URL;

interface Toast {
  id: number;
  text: string;
  color: string;
}

interface EventLogItem {
  id: number;
  time: number;
  text: string;
  color: string;
}

export default function App() {
  const busRef = useRef<RoomBus | NetBus | null>(null);
  if (!busRef.current) busRef.current = WS_URL ? new NetBus(WS_URL) : new RoomBus();
  const bus = busRef.current;

  const [phase, setPhase] = useState<Phase>("lobby");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [players, setPlayers] = useState<PlayerConfig[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<number | null>(null);
  const [isHost, setIsHost] = useState(true);
  const [runKey, setRunKey] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [go, setGo] = useState(false);
  const [raceStarted, setRaceStarted] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [finishers, setFinishers] = useState<BallInfo[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [cameraMode, setCameraMode] = useState<"leader" | number>("leader");
  const [cameraAngleMode, setCameraAngleMode] = useState<"auto" | "fix">("auto");
  const [zoneLabel, setZoneLabel] = useState("");
  const [events, setEvents] = useState<EventDef[]>([]);
  const [markers, setMarkers] = useState<ZoneMarker[]>([]);
  const [showEvents, setShowEvents] = useState(false);
  const [logs, setLogs] = useState<EventLogItem[]>([]);
  const [crash, setCrash] = useState<string | null>(null);
  const [netResults, setNetResults] = useState<FinishResult[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const finishersRef = useRef<BallInfo[]>([]);
  const timeRef = useRef(0);
  // NetBus bookkeeping: member order matching PlayerConfig ids, plus the last
  // roster key / seed so state broadcasts never restart a race in progress.
  const membersOrderRef = useRef<RoomMember[]>([]);
  const lastKeyRef = useRef("");
  const lastSeedRef = useRef(0);

  useEffect(() => {
    return bus.subscribe((r) => {
      setRoom(r ? { ...r, members: r.members.map((m) => ({ ...m })) } : null);
      setIsHost(!!r && r.hostId === bus.id);
      if (!r) {
        setPhase((p) => (p === "room" || p === "race" || p === "results" ? "lobby" : p));
        lastKeyRef.current = "";
        lastSeedRef.current = 0;
        return;
      }
      if (r.phase === "lobby") {
        lastKeyRef.current = "";
        lastSeedRef.current = 0;
        setPhase((p) => (p === "lobby" ? p : "room"));
        return;
      }
      // racing/results: players only (spectators never get a sim)
      const racing = r.members.filter((m) => m.balls > 0 && !m.spectator);
      const key = racing.map((m) => `${m.id}:${m.name}:${m.colorIdx}`).join("|");
      const me = r.members.find((m) => m.id === bus.id);
      const myIdx = me && !me.spectator ? racing.findIndex((m) => m.id === bus.id) : -1;
      const configs: PlayerConfig[] = racing.map((m, i) => ({
        id: i,
        name: m.name,
        balls: m.balls,
        color: SLIME_COLORS[m.colorIdx % SLIME_COLORS.length].a,
        color2: SLIME_COLORS[m.colorIdx % SLIME_COLORS.length].b,
      }));
      if (r.phase === "racing") {
        const isNewRace = lastSeedRef.current !== r.seed;
        if (isNewRace || key !== lastKeyRef.current) {
          lastKeyRef.current = key;
          lastSeedRef.current = r.seed;
          membersOrderRef.current = racing;
          setPlayers(configs);
          setMyPlayerId(myIdx >= 0 ? myIdx : null);
          setNetResults([]);
          if (isNewRace) {
            setFinishers([]);
            finishersRef.current = [];
            setPhase(() => {
              setRunKey((k) => k + 1);
              return "race";
            });
          }
        } else {
          // roster unchanged (e.g. a spectator joined mid-race) — never restart the sim
          setMyPlayerId(myIdx >= 0 ? myIdx : null);
        }
        return;
      }
      // phase === "results" (host-authoritative): make sure the roster is
      // available so late spectators can render the results screen too
      if (key !== lastKeyRef.current) {
        lastKeyRef.current = key;
        membersOrderRef.current = racing;
        setPlayers(configs);
        setMyPlayerId(myIdx >= 0 ? myIdx : null);
      }
      setPhase((p) => (p === "lobby" ? p : "results"));
    });
  }, [bus]);

  useEffect(() => {
    if (!("subscribeResults" in bus)) return;
    return (bus as NetBus).subscribeResults((rs) => setNetResults(rs));
  }, [bus]);

  useEffect(() => {
    if (phase !== "race" || !canvasRef.current || players.length === 0) return;
    setCountdown(null);
    setGo(false);
    setRaceStarted(false);
    setSnap(null);
    setFinishers([]);
    finishersRef.current = [];
    setToasts([]);
    setLogs([]);
    timeRef.current = 0;
    setCrash(null);
    const host = isHost;
    const follow = !host && myPlayerId != null ? myPlayerId : "leader";
    setCameraMode(follow);
    const byId = new Map(players.map((p) => [p.id, p]));
    const pushLog = (text: string, color: string) => {
      setLogs((l) => [...l.slice(-24), { id: Date.now() + Math.random(), time: timeRef.current, text, color }]);
    };

    let game: Game;
    try {
      game = new Game(canvasRef.current, players, {
        onCountdown: (n) => setCountdown(n),
        onGo: () => {
          setCountdown(null);
          setGo(true);
          setRaceStarted(true);
          pushLog("🚀 GO! ปล่อยสไลม์", "#fbbf24");
          setTimeout(() => setGo(false), 1200);
        },
        onSnapshot: (s) => {
          timeRef.current = s.time;
          setSnap(s);
          setZoneLabel(game.currentZoneLabel());
        },
        onFinish: (b, rank) => {
          finishersRef.current = [...finishersRef.current, b];
          setFinishers(finishersRef.current);
          const p = byId.get(b.playerId)!;
          const id = Date.now() + Math.random();
          const text = rank === 1 ? `🏆 ${p.name} #${b.number} ชนะ!` : `🏁 อันดับ ${rank}: ${p.name} #${b.number}`;
          setToasts((t) => [...t.slice(-3), { id, text, color: p.color }]);
          pushLog(text, p.color);
          // host-authoritative finish times: guests report their own slime,
          // the host reports its AI slimes — everything else is a local shadow
          const mem = membersOrderRef.current[b.playerId];
          if (mem && !mem.spectator && bus instanceof NetBus && (mem.id === bus.id || (host && !!mem.ai))) {
            bus.reportFinish(mem.id, mem.name, mem.colorIdx, b.finishTime);
          }
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
        },
        onRaceEnd: () => {
          // host ends the race for everyone and publishes the merged results
          if (host && bus instanceof NetBus) bus.publishResults();
          setPhase("results");
        },
        onClash: (atk, vic) => {
          const pa = byId.get(atk.playerId)!;
          const pv = byId.get(vic.playerId)!;
          const id = Date.now() + Math.random();
          const clashText = `💥 CLASH!! ${pa.name} #${atk.number} ชน ${pv.name} #${vic.number}`;
          setToasts((t) => [...t.slice(-3), { id, text: clashText, color: pa.color }]);
          pushLog(clashText, pa.color);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
        },
        onNotice: (text, color) => {
          const id = Date.now() + Math.random();
          setToasts((t) => [...t.slice(-3), { id, text, color }]);
          pushLog(text, color);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      console.error(err);
      setCrash(msg);
      setPhase("lobby");
      return;
    }
    gameRef.current = game;
    game.cameraMode = follow;
    if (cameraAngleMode === "fix") game.setCameraAngleMode("fix");
    setEvents(game.activeEvents);
    setMarkers(game.zoneMarkers());
    if (game.activeEvents.length) {
      pushLog(`🎲 อีเวนต์รอบนี้: ${game.activeEvents.map((e) => e.icon + e.name).join(" · ")}`, "#e879f9");
    }
    setShowEvents(true);
    const hideT = setTimeout(() => setShowEvents(false), 7000);
    return () => {
      clearTimeout(hideT);
      game.dispose();
      gameRef.current = null;
    };
  }, [phase, players, runKey]);

  useEffect(() => {
    if (!gameRef.current) return;
    if (!isHost && myPlayerId != null) gameRef.current.cameraMode = myPlayerId;
    else gameRef.current.cameraMode = cameraMode;
  }, [cameraMode, isHost, myPlayerId]);

  useEffect(() => {
    gameRef.current?.setCameraAngleMode(cameraAngleMode);
  }, [cameraAngleMode]);

  // Host-authoritative results: once the host broadcasts the merged finish
  // times, every device shows results built from that single source of truth
  // (real guest times override the host's local simulation shadow times).
  const mergedFinishers = useMemo<BallInfo[]>(() => {
    const order = membersOrderRef.current;
    if (!netResults.length || order.length === 0) return finishers;
    const idxOf = new Map(order.map((m, i) => [m.id, i]));
    const localByPlayer = new Map<number, BallInfo>();
    for (const f of finishers) if (!localByPlayer.has(f.playerId)) localByPlayer.set(f.playerId, f);
    const list: BallInfo[] = [];
    for (const res of netResults) {
      const pid = idxOf.get(res.id);
      if (pid == null) continue;
      const local = localByPlayer.get(pid);
      list.push(
        local
          ? { ...local, finishTime: res.finishTime }
          : {
              id: 1_000_000 + pid,
              playerId: pid,
              number: 1,
              progress: 1,
              finished: true,
              finishTime: res.finishTime,
              rank: 0,
              atk: 1,
              clashes: 0,
              madMode: false,
            },
      );
    }
    list.sort((a, b) => a.finishTime - b.finishTime);
    return list.map((f, i) => ({ ...f, rank: i + 1 }));
  }, [netResults, finishers]);

  const winner = mergedFinishers[0];
  const winnerPlayer = winner ? players.find((p) => p.id === winner.playerId) : undefined;

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black font-sans" style={{ touchAction: "manipulation" }}>
      {(phase === "race" || phase === "results") && <canvas key={runKey} ref={canvasRef} className="block h-full w-full" />}

      {crash && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6 text-white">
          <div className="max-w-lg rounded-2xl border border-rose-400/40 bg-rose-950/80 p-5">
            <div className="text-xl font-black text-rose-300">เกมเริ่มไม่สำเร็จ</div>
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-white/80">{crash}</pre>
            <button
              className="mt-4 w-full rounded-xl bg-white/15 py-3 font-bold"
              onClick={() => {
                setCrash(null);
                setPhase("lobby");
              }}
            >
              กลับล็อบบี้
            </button>
          </div>
        </div>
      )}

      {phase === "lobby" && (
        <LobbyHome
          onCreate={(roomName, maxPlayers, playerName, colorIdx) => {
            bus.create(roomName, maxPlayers, playerName, colorIdx);
            setPhase("room");
          }}
          onJoin={(code, playerName, colorIdx) => {
            if (bus instanceof NetBus) {
              return bus.join(code, playerName, colorIdx).then((err) => {
                if (!err) setPhase("room");
                return err;
              });
            }
            const err = bus.join(code, playerName, colorIdx);
            if (!err) setPhase("room");
            return err;
          }}
        />
      )}

      {phase === "room" && room && (
        <RoomScreen
          room={room}
          myId={bus.id}
          isHost={isHost}
          onLeave={() => bus.leave()}
          onStart={() => bus.start()}
          onKick={(id) => bus.kick(id)}
          onAdmitPlayer={(id) => {
            if (bus instanceof NetBus) bus.admitPlayer(id);
          }}
          onToSpectator={(id) => {
            if (bus instanceof NetBus) bus.demoteToSpectator(id);
          }}
          onAddAI={() => bus.addAI()}
          onRemoveAI={() => bus.removeAI()}
          onFillAI={() => bus.fillAI()}
          onAddPlayer={(name) => bus.addPlayer(name)}
          onRenameAdded={(id, name) => bus.patchMember(id, { name })}
          onPatchSelf={(p) => bus.patchSelf(p)}
          onSettings={(name, max) => bus.setSettings(name, max)}
        />
      )}

      {phase === "race" && (
        <>
          <HUD
            players={players}
            snap={snap}
            cameraMode={!isHost && myPlayerId != null ? myPlayerId : cameraMode}
            onCameraMode={setCameraMode}
            cameraAngleMode={cameraAngleMode}
            onToggleCameraAngle={() => setCameraAngleMode((m) => (m === "auto" ? "fix" : "auto"))}
            zoneLabel={zoneLabel}
            events={events}
            markers={markers}
            raceStarted={raceStarted}
            onEnd={() => gameRef.current?.endRace()}
            onResetCamera={() => gameRef.current?.resetCamera()}
            logs={logs}
            isHost={isHost}
            myPlayerId={myPlayerId}
          />

          {showEvents && (
            <div className="pointer-events-none absolute left-1/2 top-[18%] w-[92%] max-w-md -translate-x-1/2">
              <div className="events-in rounded-2xl border border-fuchsia-400/40 bg-black/60 p-3 text-white shadow-2xl backdrop-blur">
                <div className="text-center text-sm font-semibold uppercase tracking-[0.25em] text-fuchsia-300">🎲 Random Events รอบนี้</div>
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {events.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 rounded-lg bg-white/10 px-2 py-1.5">
                      <span className="text-xl">{e.icon}</span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{e.name}</div>
                        <div className="truncate text-xs text-white/60">{e.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {countdown !== null && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div key={countdown} className="countdown-pop text-[9rem] font-black leading-none text-white drop-shadow-[0_0_30px_rgba(255,140,0,0.9)] sm:text-[12rem]">
                {countdown}
              </div>
            </div>
          )}
          {go && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="countdown-pop bg-gradient-to-r from-yellow-300 to-orange-500 bg-clip-text text-[7rem] font-black leading-none text-transparent sm:text-[10rem]">
                GO!
              </div>
            </div>
          )}

          {snap && snap.holdLeft >= 0 && (
            <div className="pointer-events-none absolute left-1/2 top-[30%] -translate-x-1/2 text-center">
              <div className="text-sm font-bold uppercase tracking-[0.3em] text-sky-300">⏳ HOLD</div>
              <div key={Math.ceil(snap.holdLeft)} className="countdown-pop text-7xl font-black text-white">
                {Math.max(0, Math.ceil(snap.holdLeft))}
              </div>
            </div>
          )}

          {winner && winnerPlayer && (
            <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 sm:top-28">
              <div className="rounded-2xl border border-yellow-400/50 bg-black/60 px-4 py-2 text-center text-white shadow-lg backdrop-blur">
                <div className="text-xs font-bold uppercase tracking-widest text-yellow-300">ผู้ชนะ</div>
                <div className="flex items-center gap-2 text-lg font-extrabold sm:text-xl">
                  <span className="h-4 w-4 rounded-full" style={{ background: slimeGradient(winnerPlayer.color, winnerPlayer.color2) }} />
                  {winnerPlayer.name} #{winner.number}
                </div>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 flex-col items-end gap-1 sm:right-4">
            {toasts.map((t) => (
              <div key={t.id} className="toast-in rounded-full border px-4 py-2 text-base font-extrabold text-white shadow-lg backdrop-blur sm:text-lg" style={{ background: t.color + "cc", borderColor: t.color }}>
                {t.text}
              </div>
            ))}
          </div>
        </>
      )}

      {phase === "results" && (
        <ResultsScreen
          players={players}
          finishers={mergedFinishers}
          allBalls={snap?.balls ?? []}
          onReplay={() => {
            // start a NEW race (fresh seed) and let every device restart its sim
            if (!isHost) return;
            bus.start();
          }}
          onRestart={() => {
            if (isHost) {
              bus.backToLobby();
              setPhase("room");
            } else {
              bus.leave();
              setPhase("lobby");
            }
          }}
        />
      )}
    </div>
  );
}
