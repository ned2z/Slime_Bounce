import { useMemo, useState } from "react";
import { SLIME_COLORS, slimeGradient } from "../game/colors";
import type { RoomState } from "../lobby/types";
import SlimePreview from "./SlimePreview";

interface Props {
  room: RoomState;
  myId: string;
  isHost: boolean;
  onLeave: () => void;
  onStart: () => void;
  onKick: (id: string) => void;
  onAddAI: () => void;
  onRemoveAI: () => void;
  onFillAI: () => void;
  onAddPlayer: (name: string) => void;
  onRenameAdded: (id: string, name: string) => void;
  onPatchSelf: (p: { name?: string; colorIdx?: number; ready?: boolean }) => void;
  onSettings: (name: string, maxPlayers: number) => void;
}

export default function RoomScreen({
  room,
  myId,
  isHost,
  onLeave,
  onStart,
  onKick,
  onAddAI,
  onRemoveAI,
  onFillAI,
  onAddPlayer,
  onRenameAdded,
  onPatchSelf,
  onSettings,
}: Props) {
  const [newName, setNewName] = useState("");
  const me = room.members.find((m) => m.id === myId) ?? room.members[0];
  const myColor = SLIME_COLORS[(me?.colorIdx ?? 0) % SLIME_COLORS.length];
  const used = useMemo(() => new Set(room.members.map((m) => m.colorIdx)), [room.members]);
  const aiCount = room.members.filter((m) => m.ai).length;
  const full = room.members.length >= room.maxPlayers;
  const canStart = isHost && room.members.length >= 2;

  const cycleMyColor = () => {
    let idx = me.colorIdx;
    for (let k = 0; k < SLIME_COLORS.length; k++) {
      idx = (idx + 1) % SLIME_COLORS.length;
      if (!used.has(idx) || idx === me.colorIdx) break;
    }
    onPatchSelf({ colorIdx: idx });
  };

  return (
    <div className="absolute inset-0 overflow-y-auto bg-gradient-to-b from-indigo-950 via-emerald-950 to-black text-white">
      <div className="mx-auto flex min-h-full max-w-lg flex-col px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-white/50">ล็อบบี้มัลติเพลเยอร์</div>
            <h1 className="text-2xl font-black sm:text-3xl">{room.name}</h1>
            <div className="mt-1 font-mono text-3xl font-black tracking-[0.35em] text-amber-300">{room.code}</div>
            <p className="mt-1 text-xs text-white/55">
              แชร์รหัสนี้ให้เพื่อน Join · {room.members.length}/{room.maxPlayers} คน · คนละ 1 สไลม์
            </p>
          </div>
          <button onClick={onLeave} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold hover:bg-rose-500/30">
            ออก
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-center text-xs font-bold uppercase tracking-wider text-white/50">
            {isHost ? "เจ้าของห้อง — ตั้งค่าได้ทั้งหมด" : "ตัวละครของคุณ (เลือกได้แค่สไลม์)"}
          </div>
          <SlimePreview a={myColor.a} b={myColor.b} size={130} />
          <div className="mt-2 text-center text-lg font-black">{me?.name}</div>
          <div className="text-center text-sm text-white/60">
            {myColor.name} · 1 สไลม์
          </div>

          <div className="mt-3 flex gap-2">
            {isHost ? (
              <input
                value={me?.name ?? ""}
                maxLength={14}
                onChange={(e) => onPatchSelf({ name: e.target.value })}
                className="min-w-0 flex-1 rounded-xl bg-black/30 px-3 py-2.5 text-sm font-semibold outline-none ring-emerald-400 focus:ring-2"
              />
            ) : (
              <div className="min-w-0 flex-1 rounded-xl bg-black/20 px-3 py-2.5 text-sm font-semibold text-white/80">{me?.name}</div>
            )}
            <button onClick={cycleMyColor} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold">
              เปลี่ยนสี
            </button>
          </div>
          {!isHost && (
            <div className="mt-3 rounded-xl bg-emerald-500/80 py-3 text-center text-base font-black">พร้อมแล้ว ✓</div>
          )}
          {!isHost && <p className="mt-2 text-center text-xs text-amber-200/80">ผู้ที่ Join ดูได้แค่สไลม์ของตัวเอง · ไม่มีปุ่ม GOD MODE</p>}
        </div>

        {isHost && (
          <div className="mt-4 space-y-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
            <div className="text-sm font-black text-amber-200">⚙️ ตั้งค่าห้อง (เจ้าของเท่านั้น)</div>
            <input
              value={room.name}
              maxLength={24}
              onChange={(e) => onSettings(e.target.value, room.maxPlayers)}
              className="w-full rounded-xl bg-black/30 px-3 py-2.5 text-sm font-semibold outline-none"
            />
            <div className="flex items-center justify-between text-sm font-bold">
              <span>จำนวนผู้เล่นสูงสุด (คนละ 1 สไลม์)</span>
              <span>{room.maxPlayers}</span>
            </div>
            <input
              type="range"
              min={Math.max(2, room.members.length)}
              max={30}
              value={room.maxPlayers}
              onChange={(e) => onSettings(room.name, parseInt(e.target.value, 10))}
              className="w-full accent-amber-400"
            />

            <div className="rounded-xl bg-black/25 p-3">
              <div className="mb-2 text-sm font-bold">➕ เพิ่มผู้เล่น (ตั้งชื่อเอง)</div>
              <div className="flex gap-2">
                <input
                  value={newName}
                  maxLength={14}
                  placeholder="ชื่อผู้เล่น เช่น โก้"
                  onChange={(e) => setNewName(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl bg-black/40 px-3 py-2.5 text-sm font-semibold outline-none ring-emerald-400 focus:ring-2"
                />
                <button
                  type="button"
                  disabled={full || !newName.trim()}
                  onClick={() => {
                    onAddPlayer(newName.trim());
                    setNewName("");
                  }}
                  className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black disabled:bg-white/10 disabled:text-white/30"
                >
                  เพิ่ม
                </button>
              </div>
              <div className="mt-3 mb-2 flex items-center justify-between text-sm font-bold">
                <span>🤖 ผู้เล่น AI</span>
                <span className="text-amber-300">{aiCount} ตัว</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onAddAI}
                  disabled={full}
                  className="rounded-xl bg-fuchsia-500 py-3 text-base font-black disabled:bg-white/10 disabled:text-white/30"
                >
                  + เพิ่ม AI
                </button>
                <button
                  type="button"
                  onClick={onRemoveAI}
                  disabled={aiCount === 0}
                  className="rounded-xl bg-rose-500 py-3 text-base font-black disabled:bg-white/10 disabled:text-white/30"
                >
                  − ลบ AI
                </button>
              </div>
              <button
                type="button"
                onClick={onFillAI}
                disabled={full}
                className="mt-2 w-full rounded-xl bg-white/15 py-2.5 text-sm font-bold disabled:opacity-30"
              >
                เติม AI ให้เต็มห้อง ({Math.max(0, room.maxPlayers - room.members.length)} ช่องว่าง)
              </button>
            </div>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-sm font-bold">
            <span>ผู้เล่นในห้อง</span>
            <span className="text-emerald-300">
              {room.members.length} สไลม์ · คนละ 1
            </span>
          </div>
          <div className="space-y-2">
            {room.members.map((m) => {
              const col = SLIME_COLORS[m.colorIdx % SLIME_COLORS.length];
              return (
                <div key={m.id} className="flex items-center gap-2 rounded-xl bg-black/35 p-2">
                  <span className="h-9 w-9 shrink-0 rounded-full border-2 border-white/40" style={{ background: slimeGradient(col.a, col.b) }} />
                  <div className="min-w-0 flex-1">
                    {isHost && (m.ai || m.local) ? (
                      <input
                        value={m.name}
                        maxLength={14}
                        onChange={(e) => onRenameAdded(m.id, e.target.value)}
                        className="w-full rounded-lg bg-black/40 px-2 py-1 text-sm font-bold outline-none ring-amber-400 focus:ring-2"
                      />
                    ) : (
                      <div className="truncate text-sm font-bold">
                        {m.name} {m.isHost && <span className="text-amber-300">HOST</span>}
                        {m.ai && <span className="text-fuchsia-300"> · AI</span>}
                        {!m.isHost && !m.ai && !m.local && <span className="text-sky-300"> · JOIN</span>}
                        {m.id === myId && <span className="text-sky-300"> · คุณ</span>}
                      </div>
                    )}
                    <div className="text-[11px] text-white/50">
                      {col.name} · 1 สไลม์ · พร้อม
                    </div>
                  </div>
                  {isHost && !m.isHost && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onKick(m.id);
                      }}
                      className="h-9 shrink-0 rounded-lg bg-rose-500 px-3 text-xs font-black text-white hover:bg-rose-400"
                      title="KICK ออกจากห้อง"
                    >
                      KICK
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {isHost ? (
          <button
            onClick={onStart}
            disabled={!canStart}
            className="mt-6 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 py-4 text-lg font-black shadow-lg disabled:from-gray-600 disabled:to-gray-700"
          >
            {!canStart ? "เพิ่ม AI หรือรอเพื่อนอย่างน้อย 2 คน" : "🚀 เริ่มแข่ง"}
          </button>
        ) : (
          <div className="mt-6 rounded-2xl bg-white/10 py-4 text-center text-base font-bold text-white/80">รอเจ้าของห้องกดเริ่มแข่ง...</div>
        )}
        <p className="mt-2 text-center text-[11px] text-white/40">1 คน = 1 สไลม์ · GOD MODE ใช้ได้เฉพาะเจ้าของห้อง</p>
      </div>
    </div>
  );
}
