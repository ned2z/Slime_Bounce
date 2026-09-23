import { useMemo, useState } from "react";
import { SLIME_COLORS, slimeGradient } from "../game/colors";
import { listPublicRooms } from "../lobby/roomBus";
import SlimePreview from "./SlimePreview";

interface Props {
  onCreate: (roomName: string, maxPlayers: number, playerName: string, colorIdx: number) => void;
  onJoin: (code: string, playerName: string, colorIdx: number) => string | null | Promise<string | null>;
}

export default function LobbyHome({ onCreate, onJoin }: Props) {
  const [tab, setTab] = useState<"create" | "join">("create");
  const [roomName, setRoomName] = useState("ห้องสไลม์");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [playerName, setPlayerName] = useState("ผู้เล่น 1");
  const [colorIdx, setColorIdx] = useState(0);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const rooms = useMemo(() => listPublicRooms(), [tab]);
  const c = SLIME_COLORS[colorIdx];

  const create = () => {
    if (!playerName.trim()) return setErr("ใส่ชื่อผู้เล่นก่อน");
    setErr(null);
    onCreate(roomName, maxPlayers, playerName, colorIdx);
  };

  const join = (c0?: string) => {
    const use = (c0 ?? code).trim().toUpperCase();
    if (use.length < 4) return setErr("กรอกรหัสห้อง 4 ตัว");
    if (!playerName.trim()) return setErr("ใส่ชื่อผู้เล่นก่อน");
    setErr(null);
    setJoining(true);
    Promise.resolve(onJoin(use, playerName, colorIdx))
      .then((e) => setErr(e))
      .catch(() => setErr("เชื่อมต่อห้องไม่สำเร็จ"))
      .finally(() => setJoining(false));
  };

  return (
    <div className="absolute inset-0 overflow-y-auto bg-gradient-to-b from-sky-950 via-emerald-950 to-black text-white">
      <div className="mx-auto flex min-h-full max-w-lg flex-col px-4 py-8">
        <div className="text-center">
          <div className="mb-1 text-5xl">🟢</div>
          <h1 className="text-3xl font-black sm:text-5xl">
            <span className="bg-gradient-to-r from-lime-300 via-emerald-300 to-sky-300 bg-clip-text text-transparent">Slime Run Lobby</span>
          </h1>
          <p className="mt-2 text-sm text-white/75 sm:text-base">
            สร้างห้องแข่งของตัวเอง หรือ Join รหัสห้องเพื่อน — ผู้ที่ Join จะเข้าเป็น<b className="text-sky-300">ผู้ชม</b>ก่อน เจ้าของห้องกด ➕ รับเข้าเล่น
          </p>
        </div>

        <div className="mx-auto mt-5">
          <SlimePreview a={c.a} b={c.b} size={110} />
          <div className="mt-1 text-center text-sm font-bold text-white/80">{c.name}</div>
        </div>

        <label className="mt-4 text-xs font-bold uppercase tracking-wider text-white/50">ชื่อของคุณ</label>
        <input
          value={playerName}
          maxLength={14}
          onChange={(e) => setPlayerName(e.target.value)}
          className="mt-1 rounded-xl bg-white/10 px-4 py-3 text-base font-semibold outline-none ring-emerald-400 focus:ring-2"
        />

        <div className="mt-3">
          <div className="text-xs font-bold uppercase tracking-wider text-white/50">เลือกสไลม์ของคุณ</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {SLIME_COLORS.map((col, i) => (
              <button
                key={col.name}
                onClick={() => setColorIdx(i)}
                title={col.name}
                className={`h-9 w-9 rounded-full border-2 transition ${i === colorIdx ? "scale-110 border-white ring-2 ring-amber-300" : "border-white/20"}`}
                style={{ background: slimeGradient(col.a, col.b) }}
              />
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => setTab("create")}
            className={`rounded-xl py-3 text-base font-black ${tab === "create" ? "bg-emerald-500 text-white" : "bg-white/10 text-white/70"}`}
          >
            สร้างห้อง
          </button>
          <button
            onClick={() => setTab("join")}
            className={`rounded-xl py-3 text-base font-black ${tab === "join" ? "bg-sky-500 text-white" : "bg-white/10 text-white/70"}`}
          >
            Join ห้อง
          </button>
        </div>

        {tab === "create" ? (
          <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div>
              <div className="text-xs font-bold text-white/50">ชื่อห้อง</div>
              <input
                value={roomName}
                maxLength={24}
                onChange={(e) => setRoomName(e.target.value)}
                className="mt-1 w-full rounded-xl bg-black/30 px-4 py-3 text-base font-semibold outline-none ring-emerald-400 focus:ring-2"
              />
            </div>
            <div>
              <div className="flex justify-between text-sm font-bold">
                <span>จำนวนผู้เล่นสูงสุด</span>
                <span className="text-amber-300">{maxPlayers} คน</span>
              </div>
              <input
                type="range"
                min={2}
                max={30}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(parseInt(e.target.value, 10))}
                className="mt-2 w-full accent-emerald-400"
              />
            </div>
            <p className="text-xs text-white/50">เจ้าของห้องตั้งชื่อและจำนวนคนได้ · 1 คน = 1 สไลม์ · เติม AI ในล็อบบี้ได้</p>
            <button onClick={create} className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 py-4 text-lg font-black shadow-lg shadow-emerald-500/30">
              สร้างห้องแล้วเข้าล็อบบี้
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div>
              <div className="text-xs font-bold text-white/50">รหัสห้อง 4 ตัว</div>
              <input
                value={code}
                maxLength={6}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="เช่น K7PQ"
                className="mt-1 w-full rounded-xl bg-black/30 px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.4em] outline-none ring-sky-400 focus:ring-2"
              />
            </div>
            <button
              onClick={() => join()}
              disabled={joining}
              className="w-full rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 py-4 text-lg font-black disabled:opacity-50"
            >
              {joining ? "กำลังเชื่อมต่อ..." : "เข้าห้อง (เป็นผู้ชม)"}
            </button>
            {rooms.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-white/50">ห้องที่เปิดอยู่บนเครื่องนี้</div>
                <div className="space-y-1.5">
                  {rooms.map((r) => (
                    <button
                      key={r.code}
                      onClick={() => join(r.code)}
                      className="flex w-full items-center justify-between rounded-xl bg-black/30 px-3 py-2 text-left hover:bg-black/50"
                    >
                      <span className="font-bold">
                        {r.name} <span className="font-mono text-amber-300">{r.code}</span>
                      </span>
                      <span className="text-xs text-white/60">
                        {r.members.length}/{r.maxPlayers}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-white/45">
              ผู้ที่ Join จะเข้าเป็น<b className="text-sky-300">ผู้ชม</b> (ดูได้อย่างเดียว) — เจ้าของห้องกด ➕ รับเข้าเล่นเป็นผู้เล่นได้ทีละคน
            </p>
          </div>
        )}

        {err && <div className="mt-3 rounded-xl bg-rose-500/20 px-3 py-2 text-center text-sm font-bold text-rose-200">{err}</div>}
      </div>
    </div>
  );
}
