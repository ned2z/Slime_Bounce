import type { BallInfo, PlayerConfig } from "../game/Game";
import { slimeGradient } from "../game/colors";

interface Props {
  players: PlayerConfig[];
  finishers: BallInfo[];
  allBalls?: BallInfo[];
  onRestart: () => void;
  onReplay: () => void;
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export default function ResultsScreen({ players, finishers, allBalls = [], onRestart, onReplay }: Props) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const winner = finishers[0];
  const brawler = [...allBalls].sort((a, b) => b.clashes - a.clashes)[0];
  const bp = brawler && brawler.clashes > 0 ? byId.get(brawler.playerId) : undefined;
  const wp = winner ? byId.get(winner.playerId) : undefined;

  // player scoreboard: points = sum for top 10 (10,9,...1)
  const score = players.map((p) => {
    const mine = finishers.filter((f) => f.playerId === p.id);
    const pts = mine.reduce((a, f) => a + Math.max(0, 11 - f.rank), 0);
    return { p, pts, finished: mine.length, bestRank: mine.length ? mine[0].rank : Infinity };
  });
  score.sort((a, b) => a.bestRank - b.bestRank || b.pts - a.pts);

  const medal = (r: number) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `#${r}`);

  return (
    <div className="absolute inset-0 overflow-y-auto bg-black/70 text-white backdrop-blur-sm">
      <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-4 py-8">
        <div className="text-center">
          <div className="text-6xl">🏆</div>
          <h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">ผลการแข่งขัน</h1>
          {winner && wp ? (
            <div className="mt-3 inline-flex items-center gap-3 rounded-2xl border border-yellow-400/40 bg-yellow-400/10 px-5 py-3">
              <span className="h-8 w-8 rounded-full border-2 border-white/60" style={{ background: slimeGradient(wp.color, wp.color2) }} />
              <div className="text-left">
                <div className="text-lg font-bold">
                  {wp.name} <span className="text-white/60">#{winner.number}</span>
                </div>
                <div className="text-xs text-yellow-200">
                  ผู้ชนะ · เวลา {fmt(winner.finishTime)} · ATK {"⚔".repeat(winner.atk)}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-white/70">ไม่มีสไลม์ตัวไหนถึงปราสาท</p>
          )}
        </div>

        {bp && brawler && (
          <div className="mx-auto mt-3 flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm">
            <span className="text-xl">💥</span>
            <span>
              นักชนแห่งรอบ: <b>{bp.name}</b> #{brawler.number} — Clash {brawler.clashes} ครั้ง (ATK {brawler.atk})
            </span>
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white/5 p-3">
            <h2 className="mb-2 text-sm font-semibold text-white/70">อันดับผู้เล่น</h2>
            <ul className="space-y-1">
              {score.map((s, i) => (
                <li key={s.p.id} className="flex items-center gap-2 rounded-lg bg-black/30 px-2 py-1.5 text-sm">
                  <span className="w-6 text-center">{medal(i + 1)}</span>
                  <span className="h-3 w-3 rounded-full" style={{ background: slimeGradient(s.p.color, s.p.color2) }} />
                  <span className="flex-1 truncate font-medium">{s.p.name}</span>
                  <span className="text-xs text-white/60">
                    เข้าเส้นชัย {s.finished}/{s.p.balls}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-white/5 p-3">
            <h2 className="mb-2 text-sm font-semibold text-white/70">สไลม์ที่ถึงปราสาท (10 อันดับแรก)</h2>
            <ul className="space-y-1">
              {finishers.slice(0, 10).map((f) => {
                const p = byId.get(f.playerId)!;
                return (
                  <li key={f.id} className="flex items-center gap-2 rounded-lg bg-black/30 px-2 py-1 text-sm">
                    <span className="w-6 text-center text-xs">{medal(f.rank)}</span>
                    <span className="h-3 w-3 rounded-full" style={{ background: slimeGradient(p.color, p.color2) }} />
                    <span className="flex-1 truncate">
                      {p.name} <span className="text-white/50">#{f.number}</span>
                    </span>
                    <span className="font-mono text-xs text-white/70">{fmt(f.finishTime)}</span>
                  </li>
                );
              })}
              {finishers.length === 0 && <li className="text-xs text-white/50">—</li>}
            </ul>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onReplay} className="flex-1 rounded-2xl bg-gradient-to-r from-orange-500 to-rose-500 py-3.5 font-bold shadow-lg shadow-orange-500/30 active:scale-[0.98]">
            🔁 แข่งอีกรอบ
          </button>
          <button onClick={onRestart} className="flex-1 rounded-2xl border border-white/20 bg-white/10 py-3.5 font-bold hover:bg-white/15">
            ⚙️ ตั้งค่าใหม่
          </button>
        </div>
      </div>
    </div>
  );
}
