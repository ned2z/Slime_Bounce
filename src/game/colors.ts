/** Slime colour pairs (primary + mix colour). */
export const SLIME_COLORS: { a: string; b: string; name: string }[] = [
  { a: "#4ade80", b: "#facc15", name: "มะนาว" },
  { a: "#60a5fa", b: "#c084fc", name: "บลูเบอร์รี่" },
  { a: "#f87171", b: "#fb923c", name: "สตรอว์เบอร์รี่" },
  { a: "#fbbf24", b: "#f97316", name: "มะม่วง" },
  { a: "#a78bfa", b: "#f472b6", name: "องุ่น" },
  { a: "#f472b6", b: "#fda4af", name: "ซากุระ" },
  { a: "#2dd4bf", b: "#a3e635", name: "มินต์" },
  { a: "#fb923c", b: "#fde047", name: "ส้ม" },
  { a: "#38bdf8", b: "#67e8f9", name: "ทะเล" },
  { a: "#e879f9", b: "#22d3ee", name: "นีออน" },
  { a: "#84cc16", b: "#14b8a6", name: "ป่า" },
  { a: "#f43f5e", b: "#a855f7", name: "เบอร์รี่" },
  { a: "#fde68a", b: "#fca5a5", name: "พีช" },
  { a: "#94a3b8", b: "#e2e8f0", name: "เงิน" },
  { a: "#1e293b", b: "#7c3aed", name: "ราตรี" },
  { a: "#ffffff", b: "#bae6fd", name: "หิมะ" },
];

export const MAX_PLAYERS = SLIME_COLORS.length;

export function slimeGradient(a: string, b: string) {
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}
