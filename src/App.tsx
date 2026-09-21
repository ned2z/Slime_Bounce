import { useCallback, useEffect, useRef, useState } from "react";
import { slimeGradient } from "./game/colors";
import { Game, type BallInfo, type EventDef, type PlayerConfig, type Snapshot, type ZoneMarker } from "./game/Game";
import SetupScreen from "./components/SetupScreen";
import HUD from "./components/HUD";
import ResultsScreen from "./components/ResultsScreen";

type Phase = "setup" | "race" | "results";

interface Toast {
  id: number;
  text: string;
  color: string;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [players, setPlayers] = useState<PlayerConfig[]>([]);
  const [runKey, setRunKey] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [go, setGo] = useState(false);
  const [raceStarted, setRaceStarted] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [finishers, setFinishers] = useState<BallInfo[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [cameraMode, setCameraMode] = useState<"leader" | number>("leader");
  const [zoneLabel, setZoneLabel] = useState("");
  const [events, setEvents] = useState<EventDef[]>([]);
  const [markers, setMarkers] = useState<ZoneMarker[]>([]);
  const [showEvents, setShowEvents] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const finishersRef = useRef<BallInfo[]>([]);

  useEffect(() => {
    if (phase !== "race" || !canvasRef.current) return;
    setCountdown(null);
    setGo(false);
    setRaceStarted(false);
    setSnap(null);
    setFinishers([]);
    finishersRef.current = [];
    setToasts([]);
    setCameraMode("leader");
    const byId = new Map(players.map((p) => [p.id, p]));

    const game = new Game(canvasRef.current, players, {
      onCountdown: (n) => setCountdown(n),
      onGo: () => {
        setCountdown(null);
        setGo(true);
        setRaceStarted(true);
        setTimeout(() => setGo(false), 1200);
      },
      onSnapshot: (s) => {
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
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
      },
      onRaceEnd: () => setPhase("results"),
      onClash: (atk, vic) => {
        const pa = byId.get(atk.playerId)!;
        const pv = byId.get(vic.playerId)!;
        const id = Date.now() + Math.random();
        setToasts((t) => [...t.slice(-3), { id, text: `💥 CLASH!! ${pa.name} #${atk.number} (ATK ${atk.atk}) ชน ${pv.name} #${vic.number} กระเด็น!`, color: pa.color }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
      },
      onNotice: (text, color) => {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t.slice(-3), { id, text, color }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
      },
    });
    gameRef.current = game;
    setEvents(game.activeEvents);
    setMarkers(game.zoneMarkers());
    setShowEvents(true);
    const hideT = setTimeout(() => setShowEvents(false), 7000);
    return () => {
      clearTimeout(hideT);
      game.dispose();
      gameRef.current = null;
    };
  }, [phase, players, runKey]);

  useEffect(() => {
    if (gameRef.current) gameRef.current.cameraMode = cameraMode;
  }, [cameraMode]);

  const startRace = useCallback((ps: PlayerConfig[]) => {
    setPlayers(ps);
    setRunKey((k) => k + 1);
    setPhase("race");
  }, []);

  const winner = finishers[0];
  const winnerPlayer = winner ? players.find((p) => p.id === winner.playerId) : undefined;

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black font-sans" style={{ touchAction: "manipulation" }}>
      {(phase === "race" || phase === "results") && <canvas key={runKey} ref={canvasRef} className="block h-full w-full" />}

      {phase === "setup" && <SetupScreen onStart={startRace} />}

      {phase === "race" && (
        <>
          <HUD
            players={players}
            snap={snap}
            cameraMode={cameraMode}
            onCameraMode={setCameraMode}
            zoneLabel={zoneLabel}
            events={events}
            markers={markers}
            raceStarted={raceStarted}
            onEnd={() => gameRef.current?.endRace()}
            onGodMode={() => gameRef.current?.activateGodMode() ?? false}
            onResetCamera={() => gameRef.current?.resetCamera()}
          />

          {/* random events banner */}
          {showEvents && (
            <div className="pointer-events-none absolute left-1/2 top-[18%] w-[92%] max-w-md -translate-x-1/2">
              <div className="events-in rounded-2xl border border-fuchsia-400/40 bg-black/60 p-3 text-white shadow-2xl backdrop-blur">
                <div className="text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-fuchsia-300">🎲 Random Events รอบนี้</div>
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {events.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 rounded-lg bg-white/10 px-2 py-1.5">
                      <span className="text-xl">{e.icon}</span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{e.name}</div>
                        <div className="truncate text-[11px] text-white/60">{e.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-center text-[11px] text-white/50">พร้อมโซนพิเศษ: 🪂 กระโดดข้ามเหว · 🌀 ประตูวาร์ปสุ่มปลายทาง</div>
              </div>
            </div>
          )}

          {/* countdown */}
          {countdown !== null && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div key={countdown} className="countdown-pop text-[9rem] font-black leading-none text-white drop-shadow-[0_0_30px_rgba(255,140,0,0.9)] sm:text-[12rem]">
                {countdown}
              </div>
            </div>
          )}
          {go && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="countdown-pop bg-gradient-to-r from-yellow-300 to-orange-500 bg-clip-text text-[7rem] font-black leading-none text-transparent drop-shadow-[0_0_30px_rgba(255,200,0,0.8)] sm:text-[10rem]">
                GO!
              </div>
            </div>
          )}

          {/* HOLD countdown / dish status */}
          {snap && snap.holdLeft >= 0 && (
            <div className="pointer-events-none absolute left-1/2 top-[30%] -translate-x-1/2 text-center">
              <div className="text-xs font-bold uppercase tracking-[0.3em] text-sky-300 drop-shadow">⏳ HOLD — รอเพื่อนตามมา</div>
              <div key={Math.ceil(snap.holdLeft)} className="countdown-pop text-7xl font-black text-white drop-shadow-[0_0_20px_rgba(56,189,248,0.9)]">
                {Math.max(0, Math.ceil(snap.holdLeft))}
              </div>
            </div>
          )}
          {snap && snap.dishOpen >= 0 && snap.dishOpen < 1 && (
            <div className="pointer-events-none absolute left-1/2 top-[22%] w-56 -translate-x-1/2 rounded-xl bg-black/50 px-3 py-2 text-center backdrop-blur">
              <div className="text-xs font-bold text-fuchsia-200">🕳️ รูถาดกำลังขยาย {Math.round(snap.dishOpen * 100)}%</div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-purple-500 transition-all duration-300" style={{ width: `${snap.dishOpen * 100}%` }} />
              </div>
            </div>
          )}

          {/* winner banner */}
          {winner && winnerPlayer && (
            <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 sm:top-28">
              <div className="rounded-2xl border border-yellow-400/50 bg-black/60 px-4 py-2 text-center text-white shadow-lg backdrop-blur">
                <div className="text-[10px] uppercase tracking-widest text-yellow-300">ผู้ชนะ</div>
                <div className="flex items-center gap-2 text-base font-bold">
                  <span className="h-4 w-4 rounded-full" style={{ background: slimeGradient(winnerPlayer.color, winnerPlayer.color2) }} />
                  {winnerPlayer.name} #{winner.number}
                </div>
              </div>
            </div>
          )}

          {/* toasts */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
            {toasts.map((t) => (
              <div key={t.id} className="toast-in rounded-full border px-4 py-1.5 text-sm font-bold text-white shadow-lg backdrop-blur" style={{ background: t.color + "cc", borderColor: t.color }}>
                {t.text}
              </div>
            ))}
          </div>
        </>
      )}

      {phase === "results" && (
        <ResultsScreen
          players={players}
          finishers={finishers}
          allBalls={snap?.balls ?? []}
          onReplay={() => {
            setRunKey((k) => k + 1);
            setPhase("race");
          }}
          onRestart={() => setPhase("setup")}
        />
      )}
    </div>
  );
}
