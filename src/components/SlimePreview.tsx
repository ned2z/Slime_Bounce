import { slimeGradient } from "../game/colors";

export default function SlimePreview({ a, b, size = 120, bounce = true }: { a: string; b: string; size?: number; bounce?: boolean }) {
  return (
    <div className="relative mx-auto" style={{ width: size, height: size * 0.92 }}>
      <div
        className={`absolute inset-x-[8%] bottom-0 rounded-[50%] ${bounce ? "slime-bob" : ""}`}
        style={{
          height: "88%",
          background: slimeGradient(a, b),
          boxShadow: `inset 0 -18px 24px rgba(0,0,0,0.18), inset 0 12px 18px rgba(255,255,255,0.35), 0 12px 20px ${a}55`,
        }}
      >
        <span className="absolute left-[28%] top-[32%] h-[18%] w-[18%] rounded-full bg-white shadow" />
        <span className="absolute right-[28%] top-[32%] h-[18%] w-[18%] rounded-full bg-white shadow" />
        <span className="absolute left-[33%] top-[38%] h-[7%] w-[7%] rounded-full bg-slate-900" />
        <span className="absolute right-[33%] top-[38%] h-[7%] w-[7%] rounded-full bg-slate-900" />
        <span className="absolute left-1/2 top-[58%] h-[8%] w-[22%] -translate-x-1/2 rounded-b-full border-b-4 border-rose-900/70" />
        <span className="absolute left-[18%] top-[12%] h-[16%] w-[34%] rounded-full bg-white/30 blur-[1px]" />
      </div>
    </div>
  );
}
