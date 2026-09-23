import { useMemo, useState } from "react";
import type { PlayerConfig } from "../game/Game";
import { MAX_PLAYERS, SLIME_COLORS, slimeGradient } from "../game/colors";

const TOTAL = 30;

interface Props {
  onStart: (players: PlayerConfig[]) => void;
}

interface Row {
  name: string;
  balls: number;
  colorIdx: number;
}

export default function SetupScreen({ onStart }: Props) {
  const [rows, setRows] = useState<Row[]>([
    { name: "ผู้เล่น 1", balls: 10, colorIdx: 0 },
    { name: "ผู้เล่น 2", balls: 10, colorIdx: 1 },
    { name: "ผู้เล่น 3", balls: 10, colorIdx: 2 },
  ]);
  const total = useMemo(() => rows.reduce((a, r) => a + r.balls, 0), [rows]);
  const valid = total === TOTAL && rows.every((r) => r.name.trim().length > 0) && rows.length > 0;

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const distribute = () => {
    const n = rows.length;
    const base = Math.floor(TOTAL / n);
    let rem = TOTAL - base * n;
    setRows((rs) => rs.map((r) => ({ ...r, balls: base + (rem-- > 0 ? 1 : 0) })));
  };

  const nextFreeColor = (rs: Row[]) => {
    const used = new Set(rs.map((r) => r.colorIdx));
    for (let i = 0; i < SLIME_COLORS.length; i++) if (!used.has(i)) return i;
    return rs.length % SLIME_COLORS.length;
  };

  const addRow = () => {
    if (rows.length >= MAX_PLAYERS) return;
    setRows((rs) => [...rs, { name: `ผู้เล่น ${rs.length + 1}`, balls: Math.max(0, TOTAL - total), colorIdx: nextFreeColor(rs) }]);
  };

  const cycleColor = (i: number) => {
    setRows((rs) => {
      const used = new Set(rs.filter((_, j) => j !== i).map((r) => r.colorIdx));
      let idx = rs[i].colorIdx;
      for (let k = 0; k < SLIME_COLORS.length; k++) {
        idx = (idx + 1) % SLIME_COLORS.length;
        if (!used.has(idx)) break;
      }
      return rs.map((r, j) => (j === i ? { ...r, colorIdx: idx } : r));
    });
  };

  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const start = () => {
    if (!valid) return;
    onStart(
      rows
        .filter((r) => r.balls > 0)
        .map((r, i) => ({ id: i, name: r.name.trim(), balls: r.balls, color: SLIME_COLORS[r.colorIdx].a, color2: SLIME_COLORS[r.colorIdx].b }))
    );
  };

  return (
    <div className="absolute inset-0 overflow-y-auto bg-gradient-to-b from-sky-900/90 via-emerald-950/95 to-black/95 text-white">
      <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
        <div className="text-center">
          <div className="mb-2 text-5xl">🟢</div>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight">
            <span className="bg-gradient-to-r from-lime-300 via-emerald-300 to-sky-300 bg-clip-text text-transparent">Slime Run Adventure</span>
          </h1>
          <p className="mt-2 text-sm sm:text-base text-white/80">ปล่อยสไลม์ 30 ตัวพร้อมกันวิ่งผ่านเส้นทางผจญภัย RPG ฝ่าหินถล่ม ลาวา กระโดดเหว วาร์ป และอีเวนต์สุ่ม ตัวไหนถึงปราสาทก่อนชนะ!</p>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              ผู้เล่น &amp; จำนวนสไลม์ <span className="text-xs font-normal text-white/50">(สูงสุด {MAX_PLAYERS} คน · แตะสีเพื่อเปลี่ยน)</span>
            </h2>
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${total === TOTAL ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
              {total} / {TOTAL}
            </span>
          </div>

          <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((r, i) => {
              const c = SLIME_COLORS[r.colorIdx];
              return (
                <div key={i} className="flex items-center gap-2 rounded-xl bg-black/30 p-2">
                  <button
                    onClick={() => cycleColor(i)}
                    title={c.name}
                    className="relative h-9 w-9 shrink-0 rounded-full border-2 border-white/40 shadow-inner transition active:scale-90"
                    style={{ background: slimeGradient(c.a, c.b) }}
                  >
                    <span className="absolute left-2 top-2.5 h-1.5 w-1.5 rounded-full bg-white" />
                    <span className="absolute right-2 top-2.5 h-1.5 w-1.5 rounded-full bg-white" />
                  </button>
                  <input
                    value={r.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    maxLength={14}
                    placeholder="ชื่อผู้เล่น"
                    className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm outline-none ring-emerald-400 focus:ring-2"
                  />
                  <div className="flex items-center gap-1">
                    <button onClick={() => update(i, { balls: Math.max(0, r.balls - 1) })} className="h-9 w-9 rounded-lg bg-white/10 text-lg font-bold active:bg-white/25">
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={TOTAL}
                      value={r.balls}
                      onChange={(e) => update(i, { balls: Math.max(0, Math.min(TOTAL, parseInt(e.target.value || "0", 10))) })}
                      className="w-12 rounded-lg bg-white/10 py-2 text-center text-sm font-bold outline-none"
                    />
                    <button onClick={() => update(i, { balls: Math.min(TOTAL, r.balls + 1) })} className="h-9 w-9 rounded-lg bg-white/10 text-lg font-bold active:bg-white/25">
                      +
                    </button>
                  </div>
                  <button onClick={() => removeRow(i)} disabled={rows.length <= 1} className="h-9 w-9 rounded-lg text-white/50 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-20">
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex gap-2">
            <button onClick={addRow} disabled={rows.length >= MAX_PLAYERS} className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-30">
              + เพิ่มผู้เล่น ({rows.length}/{MAX_PLAYERS})
            </button>
            <button onClick={distribute} className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2 text-sm font-medium hover:bg-white/10">
              แบ่งเท่าๆ กัน
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-5 gap-2 text-center text-xs text-white/70">
          {[
            ["🪨", "หินถล่ม"],
            ["🌋", "ลาวาปะทุ"],
            ["🌪️", "ใบพัดหมุน"],
            ["📍", "ดงหมุด"],
            ["🔩", "ลูกสูบผลัก"],
            ["🪂", "กระโดดเหว"],
            ["💨", "อุโมงค์ลม"],
            ["🌀", "วาร์ปสุ่ม"],
            ["🔨", "ค้อนยักษ์"],
            ["🏰", "ปราสาท"],
          ].map(([ic, t]) => (
            <div key={t} className="rounded-lg bg-white/5 py-2">
              <div className="text-lg">{ic}</div>
              {t}
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-amber-100">
            💥 <b>Power Clash</b> — สไลม์ทุกตัวสุ่ม <b>ATK 1‑5</b> ⚔ พุ่งเร็วชนตัวหน้า = ตัวชนพุ่งต่อ ตัวโดนกระเด็นออกข้าง!
          </div>
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-rose-100">
            😡 <b>MAD MODE</b> — อยู่อันดับท้าย 30% นาน 10 วิ → คลั่งอัตโนมัติ! ความเร็ว ×1.2 เป็นเวลา 0.5 วิ (พัก 20 วิ)
          </div>
        </div>
        <div className="mt-2 rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-2 text-center text-xs text-fuchsia-100">
          🎲 <b>Random Events</b> 5 จุด (☄️ อุกกาบาต · 🧊 น้ำแข็ง · 🚧 ประตูกั้น · ⚡ แผ่นเร่ง · 🌩️ ฟ้าผ่า) สุ่มเปิดใช้ต่างกันทุกรอบ
        </div>

        <button
          onClick={start}
          disabled={!valid}
          className="mt-6 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 py-4 text-lg font-extrabold shadow-lg shadow-emerald-500/30 transition active:scale-[0.98] disabled:from-gray-600 disabled:to-gray-700 disabled:shadow-none"
        >
          {valid ? "🚀 เริ่มการผจญภัย" : total !== TOTAL ? `ต้องรวมได้ ${TOTAL} ตัวพอดี` : "กรอกชื่อผู้เล่นให้ครบ"}
        </button>
      </div>
    </div>
  );
}
