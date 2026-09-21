import { useEffect, useMemo, useRef, useState } from "react";
import type { EventDef, PlayerConfig, Snapshot, ZoneMarker } from "../game/Game";
import { slimeGradient } from "../game/colors";

interface Props {
  players: PlayerConfig[];
  snap: Snapshot | null;
  cameraMode: "leader" | number;
  onCameraMode: (m: "leader" | number) => void;
  zoneLabel: string;
  events: EventDef[];
  markers: ZoneMarker[];
  onEnd: () => void;
  onGodMode: () => boolean;
  onResetCamera: () => void;
  raceStarted: boolean;
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

export default function HUD({ players, snap, cameraMode, onCameraMode, zoneLabel, events, markers, onEnd, onGodMode, onResetCamera, raceStarted }: Props) {
  const godLeft = snap?.godLeft ?? 0;
  const godCd = snap?.godCooldown ?? 0;
  const godReady = raceStarted && godLeft <= 0 && godCd <= 0;
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
    return { list, rank };
  }, [players, snap]);

  // rank-up bubbles
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

  const sorted = snap ? [...snap.balls].sort((a, b) => (a.finished && b.finished ? a.rank - b.rank : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress)) : [];
  const top = sorted.slice(0, 5);
  const leaderPid = top[0]?.playerId;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 text-white sm:p-4">
      {/* top bar */}
      <div className="flex items-start justify-between gap-2">
        <div className="rounded-xl bg-black/45 px-3 py-2 backdrop-blur-sm">
          <div className="font-mono text-xl font-bold tabular-nums">{fmt(snap?.time ?? 0)}</div>
          <div className="text-[11px] text-white/70">
            🏰 {snap?.finishedCount ?? 0}/30 · {zoneLabel}
          </div>
          <div className="text-[11px] text-white/60">💥 Clash {snap?.clashCount ?? 0} · 🖐️ ลากหน้าจอเพื่อหมุนกล้อง</div>
          {events.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {events.map((e) => (
                <span key={e.id} title={e.name} className="rounded-full bg-white/10 px-1.5 py-0.5 text-[11px]">
                  {e.icon}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="max-w-[55%] rounded-xl bg-black/45 p-2 backdrop-blur-sm">
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/60">อันดับ</div>
          <ul className="space-y-0.5">
            {top.map((b, i) => {
              const p = byId.get(b.playerId)!;
              return (
                <li key={b.id} className="flex items-center gap-1.5 text-xs">
                  <span className="w-4 text-right font-mono text-white/70">{i + 1}</span>
                  <span className="h-3 w-3 shrink-0 rounded-full border border-white/40" style={{ background: slimeGradient(p.color, p.color2) }} />
                  <span className="max-w-[90px] truncate font-medium">
                    {p.name}
                    <span className="text-white/50">#{b.number}</span>
                  </span>
                  <span className="text-[10px] text-amber-300" title="ATK Power">{"⚔".repeat(Math.min(b.atk, 5))}</span>
                  {b.godMode && <span className="text-[10px]">⚡</span>}
                  <span className="ml-auto font-mono tabular-nums text-white/80">{b.finished ? "🏰" : `${Math.round(b.progress * 100)}%`}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* bottom: single race bar */}
      <div className="pointer-events-auto flex flex-col gap-2">
        <div className="rounded-2xl bg-black/50 px-3 pb-3 pt-9 backdrop-blur-sm">
          <div className="relative h-3 w-full rounded-full bg-gradient-to-r from-emerald-900/70 via-sky-900/70 to-amber-900/70 ring-1 ring-white/15">
            {/* zone markers */}
            {markers.map((m, i) => (
              <span
                key={i}
                title={m.label}
                className="absolute -top-5 -translate-x-1/2 text-[10px] leading-none opacity-70 sm:text-xs"
                style={{ left: `${m.at * 100}%` }}
              >
                {m.icon}
              </span>
            ))}
            <span className="absolute -right-1 -top-6 text-sm">🏰</span>
            <span className="absolute -left-1 -top-6 text-sm">🚩</span>

            {/* player dots */}
            {stats.list.map(({ p, best }) => {
              const r = stats.rank.get(p.id) ?? 0;
              const following = cameraMode === p.id;
              const isLeader = p.id === leaderPid;
              const bubble = bubbles.find((b) => b.playerId === p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => onCameraMode(following ? "leader" : p.id)}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-200 ease-linear"
                  style={{ left: `${best * 100}%`, zIndex: 50 - r }}
                  title={p.name}
                >
                  <span
                    className={`block h-5 w-5 rounded-full border-2 shadow-md transition-transform ${following ? "scale-125 border-white ring-2 ring-orange-400" : "border-white/70"}`}
                    style={{ background: slimeGradient(p.color, p.color2) }}
                  >
                    <span className="absolute left-[5px] top-[5px] h-1 w-1 rounded-full bg-white" />
                    <span className="absolute right-[5px] top-[5px] h-1 w-1 rounded-full bg-white" />
                  </span>
                  {isLeader && <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-xs">👑</span>}
                  {bubble && (
                    <span
                      className="bubble-pop absolute bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold text-white shadow-lg"
                      style={{ background: p.color + "e6", borderColor: p.color2 }}
                    >
                      {bubble.text}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/50">
            <span>แตะสไลม์บนแถบเพื่อตามกล้อง</span>
            <span>
              {cameraMode === "leader" ? "🎥 ตามผู้นำ" : `🎥 ตาม ${byId.get(cameraMode as number)?.name ?? ""}`}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              onCameraMode("leader");
              onResetCamera();
            }}
            className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold backdrop-blur-sm transition ${cameraMode === "leader" ? "bg-emerald-500/80" : "bg-black/45 hover:bg-black/60"}`}
          >
            🎥 ตามผู้นำ
          </button>
          <button
            onClick={() => onGodMode()}
            disabled={!godReady}
            className={`god-btn relative flex-1 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-extrabold backdrop-blur-sm transition ${
              godLeft > 0 ? "bg-gradient-to-r from-yellow-400 to-orange-500 text-black" : godReady ? "god-ready bg-gradient-to-r from-amber-500 to-rose-500 text-white" : "bg-black/45 text-white/50"
            }`}
          >
            {godLeft > 0 ? `⚡ GOD MODE ${godLeft.toFixed(1)}s` : godCd > 0 ? `⚡ GOD MODE (${Math.ceil(godCd)}s)` : "⚡ GOD MODE"}
            {godCd > 0 && godLeft <= 0 && <span className="absolute inset-y-0 left-0 bg-white/10" style={{ width: `${(1 - godCd / 20) * 100}%` }} />}
          </button>
          {raceStarted && (
            <button onClick={onEnd} className="rounded-xl bg-black/45 px-3 py-2.5 text-sm font-semibold backdrop-blur-sm hover:bg-black/60">
              จบการแข่ง
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
