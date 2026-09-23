import { useEffect, useMemo, useRef, useState } from "react";
import type { EventDef, PlayerConfig, Snapshot, ZoneMarker } from "../game/Game";
import { slimeGradient } from "../game/colors";

interface Props {
  players: PlayerConfig[];
  snap: Snapshot | null;
  cameraMode: "leader" | number;
  onCameraMode: (m: "leader" | number) => void;
  cameraAngleMode: "auto" | "fix";
  onToggleCameraAngle: () => void;
  zoneLabel: string;
  events: EventDef[];
  markers: ZoneMarker[];
  onEnd: () => void;
  onResetCamera: () => void;
  raceStarted: boolean;
  logs: { id: number; time: number; text: string; color: string }[];
  isHost?: boolean;
  myPlayerId?: number | null;
}

interface Bubble {
  id: number;
  playerId: number;
  text: string;
  until: number;
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export default function HUD({
  players,
  snap,
  cameraMode,
  onCameraMode,
  cameraAngleMode,
  onToggleCameraAngle,
  zoneLabel,
  events,
  markers,
  onEnd,
  onResetCamera,
  raceStarted,
  logs,
  isHost = true,
  myPlayerId = null,
}: Props) {
  const guest = !isHost;
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  // per-player best progress & rank
  const stats = useMemo(() => {
    const list = players.map((p) => {
      const mine = snap ? snap.balls.filter((b) => b.playerId === p.id) : [];
      const best = mine.reduce((m, b) => Math.max(m, b.progress), 0);
      const finished = mine.filter((b) => b.finished).length;
      const bestRank = mine.filter((b) => b.finished).reduce((m, b) => Math.min(m, b.rank), Infinity);
      return { p, best, finished, total: mine.length, bestRank };
    });
    const order = [...list].sort((a, b) => a.bestRank - b.bestRank || b.best - a.best);
    const rank = new Map(order.map((s, i) => [s.p.id, i]));
    return { list, rank, order };
  }, [players, snap]);

  // rank-up bubbles on progress bar
  const prevRank = useRef<Map<number, number>>(new Map());
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  useEffect(() => {
    if (!snap || !raceStarted) return;
    const now = Date.now();
    const added: Bubble[] = [];
    stats.rank.forEach((r, pid) => {
      const prev = prevRank.current.get(pid);
      if (prev !== undefined && r < prev && snap.time > 2) {
        const p = byId.get(pid)!;
        added.push({ id: now + Math.random(), playerId: pid, text: `▲ ${p.name} ขึ้นที่ ${r + 1}`, until: now + 2400 });
      }
    });
    prevRank.current = new Map(stats.rank);
    if (added.length) setBubbles((b) => [...b.filter((x) => x.until > now), ...added]);
  }, [snap, stats, byId, raceStarted]);

  useEffect(() => {
    const id = setInterval(() => setBubbles((b) => (b.some((x) => x.until <= Date.now()) ? b.filter((x) => x.until > Date.now()) : b)), 300);
    return () => clearInterval(id);
  }, []);

  const sorted = snap
    ? [...snap.balls].sort((a, b) => (a.finished && b.finished ? a.rank - b.rank : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress))
    : [];
  const top = sorted.slice(0, 5);
  const leaderPid = top[0]?.playerId;

  const madLeft = snap?.madLeft ?? 0;
  const armorLeft = snap?.armorLeft ?? 0;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 text-white sm:p-5">
      {/* Top Header */}
      <div className="flex items-start justify-between gap-3">
        {/* Race Time & Zone Info */}
        <div className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3 backdrop-blur-md shadow-lg">
          <div className="font-mono text-2xl sm:text-3xl font-extrabold tracking-tight tabular-nums text-white">
            {fmt(snap?.time ?? 0)}
          </div>
          <div className="mt-0.5 text-xs sm:text-sm font-medium text-white/80">
            🏰 {snap?.finishedCount ?? 0}/{players.length} · {zoneLabel || "เริ่มต้น"}
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-white/60">
            💥 Clash {snap?.clashCount ?? 0} · 🖐️ ลากเพื่อหมุน 360°
          </div>
          {events.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {events.map((e) => (
                <span key={e.id} title={e.name} className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium">
                  {e.icon}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Top 5 Leaderboard (Right Side) */}
        <div className="max-w-[55%] rounded-2xl border border-white/10 bg-black/60 p-3 backdrop-blur-md shadow-lg">
          <div className="mb-1.5 px-1 text-sm font-bold uppercase tracking-wider text-amber-300">
            🏆 5 อันดับแรก
          </div>
          <ul className="space-y-1">
            {top.map((b, i) => {
              const p = byId.get(b.playerId)!;
              return (
                <li key={b.id} className="flex items-center gap-2 text-sm sm:text-base">
                  <span className="w-4 text-right font-mono font-bold text-white/80">{i + 1}</span>
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/50 shadow"
                    style={{ background: slimeGradient(p.color, p.color2) }}
                  />
                  <span className="max-w-[110px] truncate font-semibold">
                    {p.name}
                    <span className="ml-0.5 text-white/50 text-[11px]">#{b.number}</span>
                  </span>
                  <span className="text-[11px] text-amber-300" title={`ATK Power: ${b.atk}`}>
                    {"⚔".repeat(Math.min(b.atk, 5))}
                  </span>
                  {b.madMode && <span className="text-xs animate-bounce">😡</span>}
                  {b.armorMode && <span className="text-xs" title="ARMOR">🛡️</span>}
                  <span className="ml-auto font-mono tabular-nums font-bold text-white/90">
                    {b.finished ? "🏰" : `${Math.round(b.progress * 100)}%`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* LEFT: Event log + compact team bubbles */}
      <div className="pointer-events-auto absolute left-3 top-36 sm:left-5 sm:top-48 flex w-52 sm:w-64 flex-col gap-2 max-h-[50vh] sm:max-h-[54vh]">
        <div className="rounded-2xl border border-white/10 bg-black/65 p-2.5 shadow-lg backdrop-blur-md">
          <div className="mb-1.5 px-1 text-xs sm:text-sm font-bold uppercase tracking-wider text-sky-300">📜 อีเวนต์</div>
          <ul className="max-h-36 sm:max-h-44 space-y-1 overflow-y-auto pr-1">
            {logs.length === 0 && <li className="px-1 text-xs sm:text-sm text-white/40">รอเริ่มแข่ง...</li>}
            {[...logs].slice(-12).reverse().map((e) => (
              <li key={e.id} className="border-b border-white/5 px-1 py-0.5 last:border-0">
                <span className="font-mono text-[11px] sm:text-xs text-white/50">{fmt(e.time)}</span>
                <span className="ml-1.5 text-xs sm:text-sm font-semibold leading-snug" style={{ color: e.color }}>
                  {e.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="mb-1 px-2 text-xs sm:text-sm font-bold uppercase tracking-wider text-white/60">
          📊 ทีมสไลม์
        </div>
        <div className="flex flex-col gap-1.5">
          {stats.order.map((item, idx) => {
            const { p, best, finished, total } = item;
            const isFollowing = cameraMode === p.id;
            const isLeader = idx === 0;
            const pct = Math.round(best * 100);
            return (
                <button
                  key={p.id}
                  onClick={() => {
                    if (guest) return;
                    onCameraMode(isFollowing ? "leader" : p.id);
                  }}
                  className={`group flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-left text-xs sm:text-sm font-medium backdrop-blur-md transition-all active:scale-[0.98] ${
                  isFollowing
                    ? "border-amber-400/80 bg-black/80 ring-2 ring-amber-400 shadow-md"
                    : "border-white/10 bg-black/55 hover:bg-black/75 text-white/90"
                }`}
                title={`แตะเพื่อตาม ${p.name}`}
              >
                {/* Slime avatar */}
                <div
                  className="relative h-6 w-6 shrink-0 rounded-full border-2 border-white/60 shadow-inner"
                  style={{ background: slimeGradient(p.color, p.color2) }}
                >
                  <span className="absolute left-1 top-1 h-1 w-1 rounded-full bg-white" />
                  <span className="absolute right-1 top-1 h-1 w-1 rounded-full bg-white" />
                  {isLeader && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs">👑</span>
                  )}
                </div>

                {/* Name & Progress bar mini */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 leading-tight">
                    <span className="truncate font-bold text-white text-sm">
                      #{idx + 1} {p.name}
                    </span>
                    <span className="font-mono text-[11px] sm:text-xs font-bold text-amber-300">
                      {finished > 0 ? `🏰 ${finished}/${total}` : `${pct}%`}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${pct}%`, background: slimeGradient(p.color, p.color2) }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        </div>
      </div>

      {/* Bottom Area: 1 Single Main Race Bar + Control Buttons */}
      <div className="pointer-events-auto flex flex-col gap-2.5">
        {/* Main 1-Bar Progress Track */}
        <div className="rounded-2xl border border-white/10 bg-black/60 px-4 pb-3 pt-10 backdrop-blur-md shadow-2xl">
          <div className="relative h-3.5 w-full rounded-full bg-gradient-to-r from-emerald-950 via-sky-950 to-amber-950 ring-1 ring-white/20">
            {/* Zone Markers along the bar */}
            {markers.map((m, i) => (
              <span
                key={i}
                title={m.label}
                className="absolute -top-6 -translate-x-1/2 text-xs sm:text-sm leading-none opacity-80"
                style={{ left: `${m.at * 100}%` }}
              >
                {m.icon}
              </span>
            ))}
            <span className="absolute -right-1.5 -top-7 text-base">🏰</span>
            <span className="absolute -left-1.5 -top-7 text-base">🚩</span>

            {/* Slime Dots on 1 Bar */}
            {stats.list.map(({ p, best }) => {
              const r = stats.rank.get(p.id) ?? 0;
              const following = cameraMode === p.id;
              const isLeader = p.id === leaderPid;
              const bubble = bubbles.find((b) => b.playerId === p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    if (guest) return;
                    onCameraMode(following ? "leader" : p.id);
                  }}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-200 ease-linear"
                  style={{ left: `${best * 100}%`, zIndex: 50 - r }}
                  title={`${p.name} (${Math.round(best * 100)}%)`}
                >
                  <span
                    className={`block h-6 w-6 rounded-full border-2 shadow-lg transition-transform ${
                      following ? "scale-125 border-white ring-2 ring-amber-400" : "border-white/80"
                    }`}
                    style={{ background: slimeGradient(p.color, p.color2) }}
                  >
                    <span className="absolute left-[6px] top-[6px] h-1 w-1 rounded-full bg-white" />
                    <span className="absolute right-[6px] top-[6px] h-1 w-1 rounded-full bg-white" />
                  </span>
                  {isLeader && <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-sm">👑</span>}
                  {bubble && (
                    <span
                      className="bubble-pop absolute bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs sm:text-sm font-extrabold text-white shadow-xl"
                      style={{ background: p.color + "f2", borderColor: p.color2 }}
                    >
                      {bubble.text}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-white/60">
            <span>แตะสไลม์บนแถบเพื่อสลับกล้อง</span>
            <span className="font-medium text-amber-300">
              {cameraMode === "leader" ? "🎥 กล้อง: ตามผู้นำ" : `🎥 กล้อง: ตาม ${byId.get(cameraMode as number)?.name ?? ""}`}
              {" · "}
              {cameraAngleMode === "auto" ? "🔄 AUTO Angle" : "🔒 FIX Angle"}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap sm:flex-nowrap gap-2 sm:gap-3">
          {/* Follow Leader */}
          {!guest && (
          <button
            onClick={() => {
              onCameraMode("leader");
              onResetCamera();
            }}
            className={`rounded-lg px-3 py-2 text-sm font-semibold backdrop-blur-md transition active:scale-[0.98] ${
              cameraMode === "leader"
                ? "bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/30"
                : "bg-black/55 text-white/90 hover:bg-black/70 border border-white/10"
            }`}
          >
            🎥 ตามผู้นำ
          </button>
          )}
          {guest && (
            <div className="flex-1 rounded-xl bg-sky-500/80 px-4 py-3.5 text-center text-base font-black text-white">
              👁 ดูสไลม์ของฉัน{myPlayerId != null ? ` · ${byId.get(myPlayerId)?.name ?? ""}` : ""}
            </div>
          )}

          {/* Toggle Camera Angle (AUTO vs FIX) */}
          <button
            onClick={onToggleCameraAngle}
            className={`rounded-lg px-3 py-2 text-sm font-semibold backdrop-blur-md border border-white/10 transition active:scale-[0.98] ${
              cameraAngleMode === "fix"
                ? "bg-sky-500/90 text-white shadow-lg shadow-sky-500/30"
                : "bg-black/55 text-white/90 hover:bg-black/70"
            }`}
            title="AUTO = กล้องหมุนตามทาง · FIX = ล็อกมุม ลากจอหมุนเอง"
          >
            {cameraAngleMode === "fix" ? "🔒 FIX Angle" : "🔄 AUTO Angle"}
          </button>

          {/* MAD MODE indicator (auto skill — shown while the focused slime is mad) */}
          {madLeft > 0 && (
            <div className="mad-active flex-1 min-w-[150px] rounded-xl bg-gradient-to-r from-rose-500 via-red-500 to-fuchsia-600 px-4 py-3.5 text-center text-base sm:text-lg font-black text-white shadow-lg shadow-rose-500/40">
              😡 MAD MODE {madLeft.toFixed(1)}s
            </div>
          )}

          {/* ARMOR indicator (auto skill — starts with MAD MODE, slime slides along walls) */}
          {armorLeft > 0 && (
            <div
              className="flex-1 min-w-[150px] rounded-xl px-4 py-3.5 text-center text-base sm:text-lg font-black text-white"
              style={{
                background: "linear-gradient(90deg,#ef4444,#f97316,#facc15,#4ade80,#22d3ee,#818cf8,#e879f9,#ef4444)",
                boxShadow: "0 10px 15px -3px rgba(250,204,21,0.4)",
              }}
            >
              🛡️ ARMOR {armorLeft.toFixed(1)}s
            </div>
          )}

          {/* End Race early button — host only */}
          {isHost && raceStarted && (
            <button
              onClick={onEnd}
              className="rounded-xl border border-white/10 bg-black/55 px-4 py-3.5 text-base sm:text-lg font-semibold text-rose-300 backdrop-blur-md hover:bg-rose-500/20 active:scale-[0.98]"
            >
              จบการแข่ง
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
