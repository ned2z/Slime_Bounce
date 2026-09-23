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
  { a: "#22c55e", b: "#ef4444", name: "แตงโม" },
  { a: "#a3e635", b: "#3f6212", name: "กีวี" },
  { a: "#f9a8d4", b: "#e11d48", name: "มังกร" },
  { a: "#fde047", b: "#f97316", name: "สับปะรด" },
  { a: "#bbf7d0", b: "#15803d", name: "แมตชา" },
  { a: "#92400e", b: "#fcd34d", name: "กาแฟ" },
  { a: "#e0f2fe", b: "#0284c7", name: "น้ำแข็ง" },
  { a: "#0f172a", b: "#334155", name: "มิดไนท์" },
  { a: "#dc2626", b: "#f97316", name: "ลาวา" },
  { a: "#581c87", b: "#a855f7", name: "แบล็กเบอร์รี" },
  { a: "#18181b", b: "#fafafa", name: "หมากฮอส" },
  { a: "#f59e0b", b: "#fef08a", name: "ทองคำ" },
  { a: "#c2410c", b: "#fdba74", name: "ทองแดง" },
  { a: "#e9d5ff", b: "#fff1f2", name: "มุก" },
  { a: "#64748b", b: "#94a3b8", name: "โลหะ" },
  { a: "#0369a1", b: "#14b8a6", name: "มหาสมุทร" },
  { a: "#f97316", b: "#f472b6", name: "ปะการัง" },
  { a: "#c4b5fd", b: "#8b5cf6", name: "ลาเวนเดอร์" },
  { a: "#f472b6", b: "#818cf8", name: "ผีเสื้อ" },
  { a: "#451a03", b: "#a16207", name: "ช็อกโกแลต" },
  { a: "#fef3c7", b: "#fde68a", name: "วนิลา" },
  { a: "#7e22ce", b: "#be185d", name: "มังคุด" },
  { a: "#fb7185", b: "#fecdd3", name: "ลิ้นจี่" },
  { a: "#f0abfc", b: "#c026d3", name: "กล้วยไม้" },
];

export const MAX_PLAYERS = SLIME_COLORS.length;

export function slimeGradient(a: string, b: string) {
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}
